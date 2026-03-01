use std::sync::Mutex;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Sha256, Digest};
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use url::Url;
use zeroize::{Zeroize, ZeroizeOnDrop};

use std::sync::Arc;
use crate::db::repos::resources::audit_log;
use crate::engine::crypto::{EncryptedToken, SecureString};
use crate::error::AppError;
use crate::AppState;

const GOOGLE_OAUTH_SESSION_TTL_SECS: u64 = 10 * 60;
const OAUTH_SESSION_TTL_SECS: u64 = 10 * 60;

// ── Shared OAuth Callback Server ─────────────────────────────────

/// Outcome returned by `run_oauth_callback_server` after accepting one callback.
enum OAuthCallbackOutcome {
    /// Token exchange succeeded.
    Success(OAuthCallbackTokens),
    /// An error occurred (OAuth error, missing code, parse failure, etc).
    Error(String),
    /// The TCP accept timed out.
    Timeout,
    /// The TCP accept itself failed.
    AcceptFailed(String),
}

/// Token fields returned on a successful callback.
struct OAuthCallbackTokens {
    access_token: Option<SecureString>,
    refresh_token: Option<SecureString>,
    scope: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    extra: Option<serde_json::Value>,
}

/// Accept one OAuth callback on `listener`, parse the code parameter, call
/// `exchange` to convert the code into tokens, write an HTML response, and
/// return the outcome.
///
/// The `exchange` closure receives `(code, redirect_uri)` and returns either
/// `OAuthCallbackTokens` on success or an error string.
///
/// `expected_state` is validated against the `state` query parameter in the
/// callback to prevent CSRF attacks (RFC 6749 §10.12).
async fn run_oauth_callback_server<F, Fut>(
    listener: TcpListener,
    timeout_secs: u64,
    expected_state: String,
    exchange: F,
) -> OAuthCallbackOutcome
where
    F: FnOnce(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<OAuthCallbackTokens, String>>,
{
    let redirect_uri = format!(
        "http://127.0.0.1:{}",
        listener.local_addr().map(|a| a.port()).unwrap_or(0)
    );

    let accept_result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        listener.accept(),
    )
    .await;

    match accept_result {
        Ok(Ok((mut socket, _addr))) => {
            let mut buffer = [0_u8; 8192];
            let read_n = socket.read(&mut buffer).await.unwrap_or(0);
            let request_text = String::from_utf8_lossy(&buffer[..read_n]).to_string();
            let first_line = request_text.lines().next().unwrap_or("");
            let path_part = first_line.split_whitespace().nth(1).unwrap_or("/");

            let parsed_url = Url::parse(&format!("http://127.0.0.1{}", path_part));

            let outcome = match parsed_url {
                Ok(url) => {
                    let code = url.query_pairs().find_map(|(k, v)| (k == "code").then(|| v.into_owned()));
                    let oauth_error = url.query_pairs().find_map(|(k, v)| (k == "error").then(|| v.into_owned()));
                    let error_desc = url.query_pairs().find_map(|(k, v)| (k == "error_description").then(|| v.into_owned()));
                    let callback_state = url.query_pairs().find_map(|(k, v)| (k == "state").then(|| v.into_owned()));

                    // Validate state parameter to prevent CSRF
                    let state_valid = callback_state.as_deref() == Some(&expected_state);
                    if !state_valid {
                        OAuthCallbackOutcome::Error(
                            "OAuth state mismatch — possible CSRF attack. Please retry the authorization.".into(),
                        )
                    } else if let Some(err) = oauth_error {
                        let msg = if let Some(desc) = error_desc {
                            format!("OAuth error: {} {}", err, desc).trim().to_string()
                        } else {
                            format!("OAuth error: {}", err)
                        };
                        OAuthCallbackOutcome::Error(msg)
                    } else if let Some(code_value) = code {
                        match exchange(code_value, redirect_uri).await {
                            Ok(tokens) => OAuthCallbackOutcome::Success(tokens),
                            Err(e) => OAuthCallbackOutcome::Error(e),
                        }
                    } else {
                        OAuthCallbackOutcome::Error("No authorization code returned".into())
                    }
                }
                Err(e) => OAuthCallbackOutcome::Error(format!("Failed parsing callback URL: {}", e)),
            };

            let is_success = matches!(outcome, OAuthCallbackOutcome::Success(_));
            let html = if is_success {
                "<html><body style=\"font-family: sans-serif; padding: 24px;\"><h2>Authorization successful</h2><p>You can close this tab and return to Personas.</p></body></html>"
            } else {
                "<html><body style=\"font-family: sans-serif; padding: 24px;\"><h2>Authorization failed</h2><p>Please return to Personas and retry.</p></body></html>"
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(), html
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;

            outcome
        }
        Ok(Err(e)) => OAuthCallbackOutcome::AcceptFailed(format!("OAuth callback server failed: {}", e)),
        Err(_) => OAuthCallbackOutcome::Timeout,
    }
}

/// Identity scopes required in every Google OAuth request.
const GOOGLE_IDENTITY_SCOPES: &[&str] = &[
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
];

/// Default Google OAuth scopes for the generic/workspace connector.
/// This is the single source of truth — the frontend delegates scope
/// selection to the backend via `default_google_scopes_for_connector()`.
const DEFAULT_GOOGLE_OAUTH_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
];

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
struct GoogleCredentialOAuthSession {
    status: String,
    refresh_token: Option<EncryptedToken>,
    access_token: Option<EncryptedToken>,
    scope: Option<String>,
    error: Option<String>,
    created_at: u64,
}

static GOOGLE_CREDENTIAL_OAUTH_SESSIONS: OnceLock<Mutex<HashMap<String, GoogleCredentialOAuthSession>>> = OnceLock::new();

fn google_oauth_sessions() -> &'static Mutex<HashMap<String, GoogleCredentialOAuthSession>> {
    GOOGLE_CREDENTIAL_OAUTH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cleanup_google_oauth_sessions() {
    let now = now_unix_secs();
    let mut sessions = google_oauth_sessions().lock().unwrap();
    sessions.retain(|_, session| now.saturating_sub(session.created_at) <= GOOGLE_OAUTH_SESSION_TTL_SECS);
}

// ── Token encryption helpers ────────────────────────────────────

/// Encrypt a `SecureString` token into an `EncryptedToken` for at-rest storage.
/// Returns `None` (and logs the error) if encryption fails — fail-secure.
fn encrypt_token(token: Option<SecureString>) -> Option<EncryptedToken> {
    token.and_then(|t| match EncryptedToken::seal(t) {
        Ok(enc) => Some(enc),
        Err(e) => {
            tracing::error!("Failed to encrypt OAuth token at rest: {}", e);
            None
        }
    })
}

/// Decrypt an `EncryptedToken` into a short-lived `SecureString` for immediate
/// serialization. The returned value is zeroized on drop.
fn decrypt_token(token: &Option<EncryptedToken>) -> Option<SecureString> {
    token.as_ref().and_then(|t| match t.unseal() {
        Ok(s) => Some(s),
        Err(e) => {
            tracing::error!("Failed to decrypt OAuth token: {}", e);
            None
        }
    })
}

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_google_credential_oauth(
    state: State<'_, Arc<AppState>>,
    client_id: String,
    client_secret: String,
    connector_name: String,
    extra_scopes: Option<Vec<String>>,
) -> Result<serde_json::Value, AppError> {
    let (resolved_client_id, resolved_client_secret, credential_source) =
        resolve_google_oauth_client_credentials(client_id, client_secret)?;

    cleanup_google_oauth_sessions();

    let session_id = format!("goauth_{}_{}", now_unix_secs(), uuid::Uuid::new_v4());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start OAuth callback server: {}", e)))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("Failed to resolve callback port: {}", e)))?
        .port();

    {
        let mut sessions = google_oauth_sessions().lock().unwrap();
        sessions.insert(
            session_id.clone(),
            GoogleCredentialOAuthSession {
                status: "pending".into(),
                refresh_token: None,
                access_token: None,
                scope: None,
                error: None,
                created_at: now_unix_secs(),
            },
        );
    }

    let redirect_uri = format!("http://127.0.0.1:{}", port);

    let default_scopes = default_google_scopes_for_connector(&connector_name);
    let mut scopes = default_scopes;
    if let Some(extra) = extra_scopes {
        scopes.extend(extra.into_iter().filter(|s| !s.trim().is_empty()));
    }
    // Identity scopes are already included by default_google_scopes_for_connector,
    // but extra_scopes callers may omit them, so ensure they're present.
    for s in GOOGLE_IDENTITY_SCOPES {
        scopes.push((*s).to_string());
    }
    scopes.sort();
    scopes.dedup();

    let oauth_state = generate_oauth_state();

    let mut auth_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|e| AppError::Internal(format!("Failed to build auth URL: {}", e)))?;
    {
        let mut query = auth_url.query_pairs_mut();
        query.append_pair("client_id", resolved_client_id.trim());
        query.append_pair("redirect_uri", &redirect_uri);
        query.append_pair("response_type", "code");
        query.append_pair("scope", &scopes.join(" "));
        query.append_pair("access_type", "offline");
        query.append_pair("prompt", "consent");
        query.append_pair("state", &oauth_state);
    }

    let _ = audit_log::insert(
        &state.db, &session_id, &connector_name,
        "oauth_initiated", None, None,
        Some(&format!("google oauth for {}", connector_name)),
    );

    let session_id_clone = session_id.clone();
    let client_id_clone = resolved_client_id.clone();
    let client_secret_clone = resolved_client_secret.clone();
    let db_pool = state.db.clone();
    let audit_connector = connector_name.clone();

    tokio::spawn(async move {
        let outcome = run_oauth_callback_server(
            listener,
            GOOGLE_OAUTH_SESSION_TTL_SECS,
            oauth_state,
            |code_value, redir_uri| async move {
                let tokens = exchange_google_oauth_code_for_tokens(
                    &client_id_clone,
                    client_secret_clone.expose_secret(),
                    &code_value,
                    &redir_uri,
                )
                .await?;
                if tokens.refresh_token.is_none() {
                    return Err("No refresh token returned by Google. Re-authorize with prompt=consent or revoke prior app access and retry.".into());
                }
                Ok(OAuthCallbackTokens {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    scope: tokens.scope,
                    token_type: None,
                    expires_in: None,
                    extra: None,
                })
            },
        )
        .await;

        let mut sessions = google_oauth_sessions().lock().unwrap();
        if let Some(existing) = sessions.get_mut(&session_id_clone) {
            match outcome {
                OAuthCallbackOutcome::Success(tokens) => {
                    existing.status = "success".into();
                    existing.refresh_token = encrypt_token(tokens.refresh_token);
                    existing.access_token = encrypt_token(tokens.access_token);
                    existing.scope = tokens.scope;
                    let _ = audit_log::insert(
                        &db_pool, &session_id_clone, &audit_connector,
                        "oauth_completed", None, None, Some("google oauth succeeded"),
                    );
                }
                OAuthCallbackOutcome::Error(ref e) => {
                    existing.status = "error".into();
                    existing.error = Some(e.clone());
                    let _ = audit_log::insert(
                        &db_pool, &session_id_clone, &audit_connector,
                        "oauth_failed", None, None, Some(e),
                    );
                }
                OAuthCallbackOutcome::Timeout => {
                    existing.status = "error".into();
                    existing.error = Some("OAuth callback timed out".into());
                    let _ = audit_log::insert(
                        &db_pool, &session_id_clone, &audit_connector,
                        "oauth_failed", None, None, Some("callback timed out"),
                    );
                }
                OAuthCallbackOutcome::AcceptFailed(ref e) => {
                    existing.status = "error".into();
                    existing.error = Some(e.clone());
                    let _ = audit_log::insert(
                        &db_pool, &session_id_clone, &audit_connector,
                        "oauth_failed", None, None, Some(e),
                    );
                }
            }
        }
    });

    Ok(json!({
        "session_id": session_id,
        "auth_url": auth_url.to_string(),
        "redirect_uri": redirect_uri,
        "credential_source": credential_source,
    }))
}

#[tauri::command]
pub fn get_google_credential_oauth_status(
    _state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<serde_json::Value, AppError> {
    cleanup_google_oauth_sessions();
    let mut sessions = google_oauth_sessions().lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        // Decrypt tokens into short-lived SecureStrings for serialization only
        let decrypted_refresh = decrypt_token(&session.refresh_token);
        let decrypted_access = decrypt_token(&session.access_token);
        let result = json!({
            "status": session.status,
            "refresh_token": decrypted_refresh,
            "access_token": decrypted_access,
            "scope": session.scope,
            "error": session.error,
        });
        // decrypted_refresh / decrypted_access are zeroized on drop here
        // Remove completed sessions immediately so tokens don't linger in memory
        if session.status == "success" || session.status == "error" {
            sessions.remove(&session_id);
        }
        return Ok(result);
    }

    Ok(json!({
        "status": "not_found",
        "refresh_token": null,
        "access_token": null,
        "scope": null,
        "error": "OAuth session not found or expired",
    }))
}

// ── Helpers ─────────────────────────────────────────────────────

fn default_google_scopes_for_connector(connector_name: &str) -> Vec<String> {
    let mut scopes = match connector_name {
        "gmail" => vec![
            "https://www.googleapis.com/auth/gmail.modify".into(),
            "https://www.googleapis.com/auth/gmail.send".into(),
            "https://www.googleapis.com/auth/gmail.readonly".into(),
        ],
        "google_calendar" => vec![
            "https://www.googleapis.com/auth/calendar.events".into(),
            "https://www.googleapis.com/auth/calendar.readonly".into(),
        ],
        "google_drive" => vec![
            "https://www.googleapis.com/auth/drive.file".into(),
            "https://www.googleapis.com/auth/drive.readonly".into(),
        ],
        _ => DEFAULT_GOOGLE_OAUTH_SCOPES.iter().map(|s| (*s).to_string()).collect(),
    };
    // Always include identity scopes regardless of connector
    for s in GOOGLE_IDENTITY_SCOPES {
        scopes.push((*s).to_string());
    }
    scopes
}

fn resolve_google_oauth_client_credentials(
    provided_client_id: String,
    provided_client_secret: String,
) -> Result<(String, SecureString, String), AppError> {
    let provided_id = Some(provided_client_id)
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());
    let provided_secret = Some(provided_client_secret)
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());

    if let (Some(id), Some(secret)) = (provided_id, provided_secret) {
        return Ok((id, SecureString::new(secret), "user_provided".into()));
    }

    let (id, secret) = crate::engine::google_oauth::resolve_google_oauth_env_credentials()?;
    Ok((id, SecureString::new(secret), "app_managed".into()))
}

struct GoogleTokenExchangeResult {
    refresh_token: Option<SecureString>,
    access_token: Option<SecureString>,
    scope: Option<String>,
}

async fn exchange_google_oauth_code_for_tokens(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<GoogleTokenExchangeResult, String> {
    tracing::debug!(
        code_len = code.len(),
        redirect_uri = %redirect_uri,
        client_id_len = client_id.len(),
        client_secret_len = client_secret.len(),
        "Exchanging Google OAuth code for tokens"
    );

    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Invalid token response JSON: {}", e))?;

    Ok(GoogleTokenExchangeResult {
        refresh_token: value.get("refresh_token").and_then(|v| v.as_str()).map(|s| SecureString::new(s.to_string())),
        access_token: value.get("access_token").and_then(|v| v.as_str()).map(|s| SecureString::new(s.to_string())),
        scope: value.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}

// =====================================================================
// Universal OAuth 2.0 / OIDC Gateway
// =====================================================================

/// A known OAuth provider with pre-configured endpoints.
#[derive(Clone, Debug, Serialize)]
struct OAuthProviderConfig {
    id: &'static str,
    name: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    /// Whether this provider supports PKCE (all standard ones should).
    supports_pkce: bool,
    /// Extra query params to add to the authorize URL.
    extra_auth_params: &'static [(&'static str, &'static str)],
    /// Default scopes if none provided.
    default_scopes: &'static [&'static str],
}

/// Built-in provider registry.
static PROVIDER_REGISTRY: &[OAuthProviderConfig] = &[
    OAuthProviderConfig {
        id: "microsoft",
        name: "Microsoft",
        authorize_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        supports_pkce: true,
        extra_auth_params: &[("response_mode", "query")],
        default_scopes: &["openid", "profile", "email", "offline_access"],
    },
    OAuthProviderConfig {
        id: "github",
        name: "GitHub",
        authorize_url: "https://github.com/login/oauth/authorize",
        token_url: "https://github.com/login/oauth/access_token",
        supports_pkce: false,
        extra_auth_params: &[],
        default_scopes: &["repo", "read:user", "user:email"],
    },
    OAuthProviderConfig {
        id: "slack",
        name: "Slack",
        authorize_url: "https://slack.com/oauth/v2/authorize",
        token_url: "https://slack.com/api/oauth.v2.access",
        supports_pkce: false,
        extra_auth_params: &[],
        default_scopes: &["chat:write", "channels:read", "users:read"],
    },
    OAuthProviderConfig {
        id: "atlassian",
        name: "Atlassian",
        authorize_url: "https://auth.atlassian.com/authorize",
        token_url: "https://auth.atlassian.com/oauth/token",
        supports_pkce: true,
        extra_auth_params: &[("audience", "api.atlassian.com"), ("prompt", "consent")],
        default_scopes: &["read:jira-work", "write:jira-work", "read:confluence-content.all", "offline_access"],
    },
    OAuthProviderConfig {
        id: "salesforce",
        name: "Salesforce",
        authorize_url: "https://login.salesforce.com/services/oauth2/authorize",
        token_url: "https://login.salesforce.com/services/oauth2/token",
        supports_pkce: true,
        extra_auth_params: &[],
        default_scopes: &["api", "refresh_token", "openid"],
    },
    OAuthProviderConfig {
        id: "discord",
        name: "Discord",
        authorize_url: "https://discord.com/oauth2/authorize",
        token_url: "https://discord.com/api/oauth2/token",
        supports_pkce: false,
        extra_auth_params: &[],
        default_scopes: &["identify", "email", "guilds"],
    },
    OAuthProviderConfig {
        id: "spotify",
        name: "Spotify",
        authorize_url: "https://accounts.spotify.com/authorize",
        token_url: "https://accounts.spotify.com/api/token",
        supports_pkce: true,
        extra_auth_params: &[],
        default_scopes: &["user-read-email", "user-read-private"],
    },
    OAuthProviderConfig {
        id: "linear",
        name: "Linear",
        authorize_url: "https://linear.app/oauth/authorize",
        token_url: "https://api.linear.app/oauth/token",
        supports_pkce: true,
        extra_auth_params: &[("response_type", "code"), ("prompt", "consent")],
        default_scopes: &["read", "write"],
    },
    OAuthProviderConfig {
        id: "notion",
        name: "Notion",
        authorize_url: "https://api.notion.com/v1/oauth/authorize",
        token_url: "https://api.notion.com/v1/oauth/token",
        supports_pkce: false,
        extra_auth_params: &[("owner", "user")],
        default_scopes: &[],
    },
];

fn find_provider(provider_id: &str) -> Option<&'static OAuthProviderConfig> {
    PROVIDER_REGISTRY.iter().find(|p| p.id == provider_id)
}

/// OIDC discovery response (only the fields we need).
#[derive(Deserialize)]
struct OidcDiscovery {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
}

/// Validate that a URL is safe for outbound requests (HTTPS, no private IPs).
fn validate_issuer_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw)
        .map_err(|e| format!("Invalid issuer URL: {}", e))?;

    if parsed.scheme() != "https" {
        return Err("OIDC issuer must use HTTPS".into());
    }

    let host = parsed.host_str()
        .ok_or_else(|| "OIDC issuer URL has no host".to_string())?;

    // Block localhost hostnames
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Err("OIDC issuer must not point to localhost".into());
    }

    // Block private / reserved IP ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let is_private = match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()             // 127.0.0.0/8
                || v4.is_private()           // 10/8, 172.16/12, 192.168/16
                || v4.is_link_local()        // 169.254/16
                || v4.is_broadcast()         // 255.255.255.255
                || v4.is_unspecified()       // 0.0.0.0
                || v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64  // 100.64/10 (CGN)
            }
            std::net::IpAddr::V6(v6) => {
                v6.is_loopback()             // ::1
                || v6.is_unspecified()       // ::
            }
        };
        if is_private {
            return Err("OIDC issuer must not point to a private or reserved IP address".into());
        }
    }

    Ok(parsed)
}

/// Extract an approximate registrable domain (last two labels) from a hostname.
///
/// This handles common TLDs (.com, .org, .io, .app, etc.) correctly.
/// Multi-part public suffixes like .co.uk are not handled — for those,
/// the base domain would be `co.uk` instead of `example.co.uk`. This is
/// defence-in-depth alongside the HTTPS-only and SSRF-guard checks.
fn base_domain(host: &str) -> &str {
    if let Some(last_dot) = host.rfind('.') {
        let before = &host[..last_dot];
        if let Some(second_dot) = before.rfind('.') {
            return &host[second_dot + 1..];
        }
    }
    host
}

/// Verify a discovered endpoint URL belongs to the same registrable domain
/// as the OIDC issuer and uses HTTPS. Prevents a tampered discovery response
/// from redirecting OAuth flows to attacker-controlled servers.
fn validate_endpoint_domain(
    issuer: &url::Url,
    endpoint_url: &str,
    endpoint_name: &str,
) -> Result<(), String> {
    let endpoint = url::Url::parse(endpoint_url)
        .map_err(|e| format!("OIDC {} is not a valid URL: {}", endpoint_name, e))?;

    if endpoint.scheme() != "https" {
        return Err(format!(
            "OIDC {} must use HTTPS (got {})",
            endpoint_name,
            endpoint.scheme()
        ));
    }

    let issuer_host = issuer
        .host_str()
        .ok_or_else(|| "OIDC issuer has no host".to_string())?;
    let endpoint_host = endpoint
        .host_str()
        .ok_or_else(|| format!("OIDC {} has no host", endpoint_name))?;

    let issuer_base = base_domain(issuer_host);
    let endpoint_base = base_domain(endpoint_host);

    if !issuer_base.eq_ignore_ascii_case(endpoint_base) {
        return Err(format!(
            "OIDC {} domain mismatch: issuer domain is '{}' but {} points to '{}'. \
             Discovery response may have been tampered with.",
            endpoint_name, issuer_host, endpoint_name, endpoint_host
        ));
    }

    Ok(())
}

/// Fetch OIDC configuration from .well-known/openid-configuration.
async fn discover_oidc(issuer_url: &str) -> Result<OidcDiscovery, String> {
    let parsed = validate_issuer_url(issuer_url)?;
    let well_known = format!(
        "{}/.well-known/openid-configuration",
        parsed.as_str().trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .get(&well_known)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("OIDC discovery failed for {}: {}", well_known, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "OIDC discovery returned {} for {}",
            resp.status(),
            well_known
        ));
    }

    let discovery = resp
        .json::<OidcDiscovery>()
        .await
        .map_err(|e| format!("Invalid OIDC discovery JSON: {}", e))?;

    // Validate that discovered endpoints belong to the same domain as the issuer.
    // This prevents a tampered discovery response from redirecting authorization
    // codes or client secrets to attacker-controlled servers.
    validate_endpoint_domain(&parsed, &discovery.authorization_endpoint, "authorization_endpoint")?;
    validate_endpoint_domain(&parsed, &discovery.token_endpoint, "token_endpoint")?;

    Ok(discovery)
}

// ── PKCE & State ─────────────────────────────────────────────────

fn generate_pkce_pair() -> (SecureString, String) {
    use aes_gcm::aead::rand_core::{OsRng, RngCore};
    let mut verifier_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut verifier_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let code_challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    (SecureString::new(code_verifier), code_challenge)
}

/// Generate a cryptographically random OAuth state parameter (RFC 6749 §10.12).
fn generate_oauth_state() -> String {
    use aes_gcm::aead::rand_core::{OsRng, RngCore};
    let mut state_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut state_bytes);
    URL_SAFE_NO_PAD.encode(state_bytes)
}

// ── Universal OAuth Sessions ─────────────────────────────────────

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
#[allow(dead_code)]
struct OAuthSession {
    status: String,          // pending | success | error
    provider_id: String,
    access_token: Option<EncryptedToken>,
    refresh_token: Option<EncryptedToken>,
    scope: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    #[zeroize(skip)]
    extra: Option<serde_json::Value>,
    error: Option<String>,
    created_at: u64,
    token_url: String,
    client_id: String,
    client_secret: Option<SecureString>,
    code_verifier: Option<SecureString>,
    redirect_uri: String,
}

static OAUTH_SESSIONS: OnceLock<Mutex<HashMap<String, OAuthSession>>> = OnceLock::new();

fn oauth_sessions() -> &'static Mutex<HashMap<String, OAuthSession>> {
    OAUTH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cleanup_oauth_sessions() {
    let now = now_unix_secs();
    let mut sessions = oauth_sessions().lock().unwrap();
    sessions.retain(|_, s| now.saturating_sub(s.created_at) <= OAUTH_SESSION_TTL_SECS);
}

// ── Universal OAuth Commands ─────────────────────────────────────

/// List available OAuth providers.
#[tauri::command]
pub fn list_oauth_providers(
    _state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    let providers: Vec<serde_json::Value> = PROVIDER_REGISTRY
        .iter()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "supports_pkce": p.supports_pkce,
                "default_scopes": p.default_scopes,
            })
        })
        .collect();

    Ok(json!({ "providers": providers }))
}

/// Start a universal OAuth flow for any provider.
///
/// Params:
/// - `provider_id`: Known provider ID (e.g. "github") OR "custom"
/// - `client_id`: OAuth app client ID
/// - `client_secret`: Optional (not needed for PKCE public clients)
/// - `scopes`: Optional scope override
/// - `authorize_url`: Required if provider_id == "custom"
/// - `token_url`: Required if provider_id == "custom"
/// - `oidc_issuer`: Optional OIDC issuer URL for auto-discovery (alternative to authorize_url/token_url)
/// - `use_pkce`: Whether to use PKCE (auto-detected from provider, overridable)
/// - `extra_params`: Optional extra query params for the authorization URL
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_oauth(
    state: State<'_, Arc<AppState>>,
    provider_id: String,
    client_id: String,
    client_secret: Option<String>,
    scopes: Option<Vec<String>>,
    authorize_url: Option<String>,
    token_url: Option<String>,
    oidc_issuer: Option<String>,
    use_pkce: Option<bool>,
    extra_params: Option<HashMap<String, String>>,
) -> Result<serde_json::Value, AppError> {
    // Wrap secret immediately so the bare String is dropped
    let client_secret: Option<SecureString> = client_secret.map(SecureString::new);

    cleanup_oauth_sessions();

    // Resolve endpoints from provider registry, OIDC discovery, or custom
    let (resolved_auth_url, resolved_token_url, resolved_pkce, default_scopes, extra_auth_params) =
        if let Some(provider) = find_provider(&provider_id) {
            (
                provider.authorize_url.to_string(),
                provider.token_url.to_string(),
                use_pkce.unwrap_or(provider.supports_pkce),
                provider.default_scopes.iter().map(|s| (*s).to_string()).collect::<Vec<_>>(),
                provider.extra_auth_params.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>(),
            )
        } else if let Some(issuer) = oidc_issuer.as_deref().filter(|s| !s.is_empty()) {
            let discovery = discover_oidc(issuer)
                .await
                .map_err(AppError::Internal)?;
            let pkce = use_pkce.unwrap_or_else(|| {
                discovery.code_challenge_methods_supported.contains(&"S256".to_string())
            });
            (discovery.authorization_endpoint, discovery.token_endpoint, pkce, vec!["openid".to_string()], vec![])
        } else if let (Some(auth), Some(tok)) = (authorize_url.as_deref(), token_url.as_deref()) {
            (auth.to_string(), tok.to_string(), use_pkce.unwrap_or(false), vec![], vec![])
        } else {
            return Err(AppError::Validation(
                "Unknown provider. Supply authorize_url + token_url, or an oidc_issuer for auto-discovery.".into(),
            ));
        };

    // Bind TCP listener for redirect
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start OAuth callback server: {}", e)))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Internal(format!("Failed to resolve callback port: {}", e)))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    // Resolve scopes
    let effective_scopes = scopes.filter(|s| !s.is_empty()).unwrap_or(default_scopes);

    // Generate PKCE if needed
    let (code_verifier, code_challenge) = if resolved_pkce {
        let (v, c) = generate_pkce_pair();
        (Some(v), Some(c))
    } else {
        (None, None)
    };

    // Generate CSRF-protection state parameter
    let oauth_state = generate_oauth_state();

    // Build authorization URL
    let mut auth_url = Url::parse(&resolved_auth_url)
        .map_err(|e| AppError::Internal(format!("Invalid authorize URL: {}", e)))?;
    {
        let mut query = auth_url.query_pairs_mut();
        query.append_pair("client_id", client_id.trim());
        query.append_pair("redirect_uri", &redirect_uri);
        query.append_pair("response_type", "code");
        query.append_pair("state", &oauth_state);
        if !effective_scopes.is_empty() {
            query.append_pair("scope", &effective_scopes.join(" "));
        }
        // PKCE
        if let Some(ref challenge) = code_challenge {
            query.append_pair("code_challenge", challenge);
            query.append_pair("code_challenge_method", "S256");
        }
        // Provider-specific extra params
        for (k, v) in &extra_auth_params {
            // Don't override response_type if already set by provider config
            if k == "response_type" {
                continue;
            }
            query.append_pair(k, v);
        }
        // User-provided extra params
        if let Some(ref ep) = extra_params {
            for (k, v) in ep {
                query.append_pair(k, v);
            }
        }
    }

    let session_id = format!("oauth_{}_{}", now_unix_secs(), uuid::Uuid::new_v4());

    {
        let mut sessions = oauth_sessions().lock().unwrap();
        sessions.insert(session_id.clone(), OAuthSession {
            status: "pending".into(),
            provider_id: provider_id.clone(),
            access_token: None,
            refresh_token: None,
            scope: None,
            token_type: None,
            expires_in: None,
            extra: None,
            error: None,
            created_at: now_unix_secs(),
            token_url: resolved_token_url.clone(),
            client_id: client_id.clone(),
            client_secret: client_secret.clone(),
            code_verifier: code_verifier.clone(),
            redirect_uri: redirect_uri.clone(),
        });
    }

    let _ = audit_log::insert(
        &state.db, &session_id, &provider_id,
        "oauth_initiated", None, None,
        Some(&format!("universal oauth for provider '{}'", provider_id)),
    );

    // Spawn TCP listener to wait for callback
    let sid = session_id.clone();
    let tok_url = resolved_token_url;
    let cid = client_id.clone();
    let csec = client_secret.clone();
    let cv = code_verifier;
    let db_pool = state.db.clone();
    let audit_provider = provider_id.clone();

    tokio::spawn(async move {
        let outcome = run_oauth_callback_server(
            listener,
            OAUTH_SESSION_TTL_SECS,
            oauth_state,
            |code_value, redir_uri| async move {
                let tokens = exchange_oauth_code(
                    &tok_url,
                    &cid,
                    csec.as_ref().map(|s| s.expose_secret()),
                    &code_value,
                    &redir_uri,
                    cv.as_ref().map(|s| s.expose_secret()),
                )
                .await?;
                Ok(OAuthCallbackTokens {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    scope: tokens.scope,
                    token_type: tokens.token_type,
                    expires_in: tokens.expires_in,
                    extra: tokens.extra,
                })
            },
        )
        .await;

        let mut sessions = oauth_sessions().lock().unwrap();
        if let Some(s) = sessions.get_mut(&sid) {
            match outcome {
                OAuthCallbackOutcome::Success(tokens) => {
                    s.status = "success".into();
                    s.access_token = encrypt_token(tokens.access_token);
                    s.refresh_token = encrypt_token(tokens.refresh_token);
                    s.scope = tokens.scope;
                    s.token_type = tokens.token_type;
                    s.expires_in = tokens.expires_in;
                    s.extra = tokens.extra;
                    let _ = audit_log::insert(
                        &db_pool, &sid, &audit_provider,
                        "oauth_completed", None, None, Some("universal oauth succeeded"),
                    );
                }
                OAuthCallbackOutcome::Error(ref e) => {
                    s.status = "error".into();
                    s.error = Some(e.clone());
                    let _ = audit_log::insert(
                        &db_pool, &sid, &audit_provider,
                        "oauth_failed", None, None, Some(e),
                    );
                }
                OAuthCallbackOutcome::Timeout => {
                    s.status = "error".into();
                    s.error = Some("OAuth callback timed out".into());
                    let _ = audit_log::insert(
                        &db_pool, &sid, &audit_provider,
                        "oauth_failed", None, None, Some("callback timed out"),
                    );
                }
                OAuthCallbackOutcome::AcceptFailed(ref e) => {
                    s.status = "error".into();
                    s.error = Some(e.clone());
                    let _ = audit_log::insert(
                        &db_pool, &sid, &audit_provider,
                        "oauth_failed", None, None, Some(e),
                    );
                }
            }
        }
    });

    Ok(json!({
        "session_id": session_id,
        "auth_url": auth_url.to_string(),
        "redirect_uri": redirect_uri,
        "provider_id": provider_id,
        "pkce_used": code_challenge.is_some(),
    }))
}

#[tauri::command]
pub fn get_oauth_status(
    _state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<serde_json::Value, AppError> {
    cleanup_oauth_sessions();
    let mut sessions = oauth_sessions().lock().unwrap();
    if let Some(s) = sessions.get(&session_id) {
        // Decrypt tokens into short-lived SecureStrings for serialization only
        let decrypted_access = decrypt_token(&s.access_token);
        let decrypted_refresh = decrypt_token(&s.refresh_token);
        let result = json!({
            "status": s.status,
            "provider_id": s.provider_id,
            "access_token": decrypted_access,
            "refresh_token": decrypted_refresh,
            "scope": s.scope,
            "token_type": s.token_type,
            "expires_in": s.expires_in,
            "extra": s.extra,
            "error": s.error,
        });
        // decrypted_access / decrypted_refresh are zeroized on drop here
        // Remove completed sessions immediately so tokens don't linger in memory
        if s.status == "success" || s.status == "error" {
            sessions.remove(&session_id);
        }
        return Ok(result);
    }

    Ok(json!({
        "status": "not_found",
        "error": "OAuth session not found or expired",
    }))
}

/// Refresh an access token using a refresh token.
#[tauri::command]
pub async fn refresh_oauth_token(
    state: State<'_, Arc<AppState>>,
    provider_id: String,
    client_id: String,
    client_secret: Option<String>,
    refresh_token: String,
    token_url: Option<String>,
    oidc_issuer: Option<String>,
) -> Result<serde_json::Value, AppError> {
    // Wrap secrets immediately so bare Strings are dropped
    let client_secret = client_secret.map(SecureString::new);
    let refresh_token = SecureString::new(refresh_token);

    let resolved_token_url = if let Some(provider) = find_provider(&provider_id) {
        provider.token_url.to_string()
    } else if let Some(url) = token_url.filter(|s| !s.is_empty()) {
        url
    } else if let Some(issuer) = oidc_issuer.filter(|s| !s.is_empty()) {
        let discovery = discover_oidc(&issuer)
            .await
            .map_err(AppError::Internal)?;
        discovery.token_endpoint
    } else {
        return Err(AppError::Validation(
            "Cannot resolve token URL. Provide provider_id, token_url, or oidc_issuer.".into(),
        ));
    };

    let mut form_params = vec![
        ("client_id".to_string(), client_id),
        ("grant_type".to_string(), "refresh_token".to_string()),
        ("refresh_token".to_string(), refresh_token.expose_secret().to_string()),
    ];
    if let Some(ref secret) = client_secret {
        form_params.push(("client_secret".to_string(), secret.expose_secret().to_string()));
    }

    let response = reqwest::Client::new()
        .post(&resolved_token_url)
        .header("Accept", "application/json")
        .form(&form_params)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Token refresh request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        let _ = audit_log::insert(
            &state.db, &provider_id, &provider_id,
            "token_refresh_failed", None, None,
            Some(&format!("HTTP {}", status)),
        );
        return Err(AppError::Internal(format!("Token refresh failed ({}): {}", status, body)));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid token refresh JSON: {}", e)))?;

    let _ = audit_log::insert(
        &state.db, &provider_id, &provider_id,
        "token_refreshed", None, None,
        Some(&format!("provider '{}'", provider_id)),
    );

    Ok(json!({
        "access_token": value.get("access_token").and_then(|v| v.as_str()),
        "refresh_token": value.get("refresh_token").and_then(|v| v.as_str()),
        "expires_in": value.get("expires_in").and_then(|v| v.as_u64()),
        "token_type": value.get("token_type").and_then(|v| v.as_str()),
        "scope": value.get("scope").and_then(|v| v.as_str()),
    }))
}

// ── Universal Token Exchange ─────────────────────────────────────

struct OAuthTokenResult {
    access_token: Option<SecureString>,
    refresh_token: Option<SecureString>,
    scope: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
    extra: Option<serde_json::Value>,
}

async fn exchange_oauth_code(
    token_url: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    redirect_uri: &str,
    code_verifier: Option<&str>,
) -> Result<OAuthTokenResult, String> {
    let mut form_params = vec![
        ("client_id", client_id.to_string()),
        ("code", code.to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect_uri.to_string()),
    ];

    if let Some(secret) = client_secret {
        form_params.push(("client_secret", secret.to_string()));
    }
    if let Some(verifier) = code_verifier {
        form_params.push(("code_verifier", verifier.to_string()));
    }

    let response = reqwest::Client::new()
        .post(token_url)
        .header("Accept", "application/json")
        .form(&form_params)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Invalid token response JSON: {}", e))?;

    Ok(OAuthTokenResult {
        access_token: value.get("access_token").and_then(|v| v.as_str()).map(|s| SecureString::new(s.to_string())),
        refresh_token: value.get("refresh_token").and_then(|v| v.as_str()).map(|s| SecureString::new(s.to_string())),
        scope: value.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
        token_type: value.get("token_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
        expires_in: value.get("expires_in").and_then(|v| v.as_u64()),
        extra: {
            // Capture any provider-specific extra fields (e.g. Slack's team, Atlassian's cloud IDs)
            let known_keys = ["access_token", "refresh_token", "scope", "token_type", "expires_in"];
            let extras: serde_json::Map<String, serde_json::Value> = value.as_object()
                .map(|obj| obj.iter()
                    .filter(|(k, _)| !known_keys.contains(&k.as_str()))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect())
                .unwrap_or_default();
            if extras.is_empty() { None } else { Some(serde_json::Value::Object(extras)) }
        },
    })
}
