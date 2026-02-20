use std::sync::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use url::Url;

use std::sync::Arc;
use crate::error::AppError;
use crate::AppState;

const GOOGLE_OAUTH_SESSION_TTL_SECS: u64 = 10 * 60;

#[derive(Clone, Serialize)]
struct GoogleCredentialOAuthSession {
    status: String,
    refresh_token: Option<String>,
    access_token: Option<String>,
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

// ── Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_google_credential_oauth(
    _state: State<'_, Arc<AppState>>,
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
    scopes.push("openid".into());
    scopes.push("https://www.googleapis.com/auth/userinfo.email".into());
    scopes.sort();
    scopes.dedup();

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
    }

    let session_id_clone = session_id.clone();
    let client_id_clone = resolved_client_id.clone();
    let client_secret_clone = resolved_client_secret.clone();
    let redirect_uri_clone = redirect_uri.clone();

    tokio::spawn(async move {
        let accept_result = tokio::time::timeout(
            std::time::Duration::from_secs(GOOGLE_OAUTH_SESSION_TTL_SECS),
            listener.accept(),
        )
        .await;

        match accept_result {
            Ok(Ok((mut socket, _addr))) => {
                let mut buffer = [0_u8; 8192];
                let read_n = socket.read(&mut buffer).await.unwrap_or(0);
                let request_text = String::from_utf8_lossy(&buffer[..read_n]).to_string();
                let first_line = request_text.lines().next().unwrap_or("");
                let path_part = first_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/");

                let parsed_url = Url::parse(&format!("http://127.0.0.1{}", path_part));
                let mut status = "error".to_string();
                let mut refresh_token = None;
                let mut access_token = None;
                let mut scope = None;
                let mut error = None;

                match parsed_url {
                    Ok(url) => {
                        let code = url.query_pairs().find_map(|(k, v)| (k == "code").then(|| v.into_owned()));
                        let oauth_error = url.query_pairs().find_map(|(k, v)| (k == "error").then(|| v.into_owned()));

                        if let Some(err) = oauth_error {
                            error = Some(format!("Google OAuth error: {}", err));
                        } else if let Some(code_value) = code {
                            match exchange_google_oauth_code_for_tokens(
                                &client_id_clone,
                                &client_secret_clone,
                                &code_value,
                                &redirect_uri_clone,
                            )
                            .await
                            {
                                Ok(tokens) => {
                                    status = "success".into();
                                    refresh_token = tokens.refresh_token;
                                    access_token = tokens.access_token;
                                    scope = tokens.scope;
                                    if refresh_token.is_none() {
                                        status = "error".into();
                                        error = Some("No refresh token returned by Google. Re-authorize with prompt=consent or revoke prior app access and retry.".into());
                                    }
                                }
                                Err(e) => {
                                    error = Some(e);
                                }
                            }
                        } else {
                            error = Some("No authorization code was returned by Google".into());
                        }
                    }
                    Err(e) => {
                        error = Some(format!("Failed parsing callback URL: {}", e));
                    }
                }

                {
                    let mut sessions = google_oauth_sessions().lock().unwrap();
                    if let Some(existing) = sessions.get_mut(&session_id_clone) {
                        existing.status = status.clone();
                        existing.refresh_token = refresh_token.clone();
                        existing.access_token = access_token.clone();
                        existing.scope = scope.clone();
                        existing.error = error.clone();
                    }
                }

                let html = if status == "success" {
                    "<html><body style=\"font-family: sans-serif; padding: 24px;\"><h2>Authorization successful</h2><p>You can close this tab and return to Personas.</p></body></html>"
                } else {
                    "<html><body style=\"font-family: sans-serif; padding: 24px;\"><h2>Authorization failed</h2><p>Please return to Personas and retry.</p></body></html>"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
            Ok(Err(e)) => {
                let mut sessions = google_oauth_sessions().lock().unwrap();
                if let Some(existing) = sessions.get_mut(&session_id_clone) {
                    existing.status = "error".into();
                    existing.error = Some(format!("OAuth callback server failed: {}", e));
                }
            }
            Err(_) => {
                let mut sessions = google_oauth_sessions().lock().unwrap();
                if let Some(existing) = sessions.get_mut(&session_id_clone) {
                    existing.status = "error".into();
                    existing.error = Some("OAuth callback timed out".into());
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
    let sessions = google_oauth_sessions().lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        return Ok(json!({
            "status": session.status,
            "refresh_token": session.refresh_token,
            "access_token": session.access_token,
            "scope": session.scope,
            "error": session.error,
        }));
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
    match connector_name {
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
        _ => vec![
            "https://www.googleapis.com/auth/gmail.modify".into(),
            "https://www.googleapis.com/auth/calendar.events".into(),
            "https://www.googleapis.com/auth/drive.file".into(),
        ],
    }
}

fn resolve_google_oauth_client_credentials(
    provided_client_id: String,
    provided_client_secret: String,
) -> Result<(String, String, String), AppError> {
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
        return Ok((id, secret, "user_provided".into()));
    }

    let env_client_id = option_env!("GCP_CLIENT_ID")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| env_var_first_nonempty(&["GCP_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"]))
        .or_else(|| dotenv_var_first_nonempty(&["GCP_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"]));

    let env_client_secret = option_env!("GCP_CLIENT_SECRET")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| env_var_first_nonempty(&["GCP_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]))
        .or_else(|| dotenv_var_first_nonempty(&["GCP_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]));

    match (env_client_id, env_client_secret) {
        (Some(id), Some(secret)) => {
            Ok((id, secret, "app_managed".into()))
        }
        _ => Err(AppError::Validation(
            "Google OAuth client credentials are missing. Set GCP_CLIENT_ID and GCP_CLIENT_SECRET in app env/.env (or pass client credentials explicitly).".into(),
        )),
    }
}

fn env_var_first_nonempty(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn dotenv_var_first_nonempty(keys: &[&str]) -> Option<String> {
    let candidates = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("../../.env"),
    ];

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut map = HashMap::<String, String>::new();
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    map.insert(k.trim().to_string(), v.trim().trim_matches('"').trim_matches('\'').to_string());
                }
            }

            for key in keys {
                if let Some(value) = map.get(*key) {
                    if !value.trim().is_empty() {
                        return Some(value.trim().to_string());
                    }
                }
            }
        }
    }

    None
}

struct GoogleTokenExchangeResult {
    refresh_token: Option<String>,
    access_token: Option<String>,
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
        refresh_token: value.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.to_string()),
        access_token: value.get("access_token").and_then(|v| v.as_str()).map(|s| s.to_string()),
        scope: value.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}
