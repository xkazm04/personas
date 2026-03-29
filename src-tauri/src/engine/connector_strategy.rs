//! Connector strategy trait + registry.
//!
//! Each connector type implements `ConnectorStrategy`, which consolidates
//! healthcheck auth, rotation, and token-refresh logic that was previously
//! scattered across `healthcheck.rs`, `rotation.rs`, and ad-hoc if-branches.

use std::collections::HashMap;
use std::sync::OnceLock;

use async_trait::async_trait;

use crate::db::models::PersonaCredential;
use crate::db::repos::resources::audit_log;
use crate::db::DbPool;
use crate::error::AppError;

/// Token returned by `resolve_auth_token`, carrying the access token and
/// an optional provider-reported expiry so callers can track real TTLs.
pub struct ResolvedToken {
    pub token: String,
    /// Seconds until the token expires, as reported by the OAuth provider.
    /// `None` when the provider didn't include `expires_in` or the credential
    /// is not OAuth (e.g. API key).
    pub expires_in_secs: Option<u64>,
    /// Rotated refresh token returned by the provider during token exchange.
    /// Many providers (Google, Microsoft, GitHub) may return a new refresh_token
    /// alongside the access_token. Must be persisted to avoid credential death
    /// when providers enforce refresh token rotation (RFC 6749 Section 6).
    pub refresh_token: Option<String>,
}

impl ResolvedToken {
    pub fn plain(token: String) -> Self {
        Self { token, expires_in_secs: None, refresh_token: None }
    }

    pub fn with_expiry(token: String, expires_in_secs: u64) -> Self {
        Self { token, expires_in_secs: Some(expires_in_secs), refresh_token: None }
    }
}

// -- Trait ----------------------------------------------------------

/// Strategy interface for connector-specific healthcheck + rotation behaviour.
#[async_trait]
pub trait ConnectorStrategy: Send + Sync {
    /// Whether this credential uses OAuth token refresh for rotation.
    /// Default: checks for `refresh_token` key in fields.
    fn is_oauth(&self, fields: &HashMap<String, String>) -> bool {
        fields.contains_key("refresh_token")
    }

    /// Resolve the auth token to use for healthcheck / API requests.
    /// Returns `Ok(Some(resolved))` when a token is available, `Ok(None)` when
    /// the credential doesn't carry a token (e.g. basic-auth only).
    /// The `ResolvedToken` includes `expires_in_secs` when the provider reports it.
    /// Default: finds the first common token key and returns it as a plain token.
    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        Ok(find_auth_token(fields).map(ResolvedToken::plain))
    }

    /// Apply authentication to an outgoing healthcheck request.
    /// Default: `Authorization: Bearer <token>`.
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> reqwest::RequestBuilder {
        request.bearer_auth(token)
    }

    /// Perform rotation for this credential.
    /// The default implementation delegates to a healthcheck round-trip.
    /// On failure, restores the original decrypted fields to prevent data loss.
    async fn rotate(
        &self,
        pool: &DbPool,
        credential: &PersonaCredential,
    ) -> Result<String, AppError> {
        // 1. Snapshot current fields before rotation attempt
        let original_fields = crate::db::repos::resources::credentials::get_decrypted_fields(pool, credential)?;
        let _ = audit_log::log_decrypt(pool, &credential.id, &credential.name, "connector_strategy:rotate_snapshot", None, None);

        // 2. Attempt rotation via healthcheck
        let result = super::healthcheck::run_healthcheck(pool, &credential.id).await;

        match result {
            Ok(hc) if hc.success => {
                let fields = crate::db::repos::resources::credentials::get_decrypted_fields(pool, credential)?;
                let _ = audit_log::log_decrypt(pool, &credential.id, &credential.name, "connector_strategy:rotate_verify", None, None);
                if self.is_oauth(&fields) {
                    Ok(format!("OAuth token refreshed and verified: {}", hc.message))
                } else {
                    Ok(format!("API key verified healthy: {}", hc.message))
                }
            }
            Ok(hc) => {
                // 3. Failed -- restore original credentials
                let _ = crate::db::repos::resources::credentials::save_fields(pool, &credential.id, &original_fields);
                Err(AppError::Internal(format!(
                    "Rotation failed (credentials restored): {}", hc.message
                )))
            }
            Err(e) => {
                // Restore original credentials on error
                let _ = crate::db::repos::resources::credentials::save_fields(pool, &credential.id, &original_fields);
                Err(e)
            }
        }
    }
}

// -- Registry -------------------------------------------------------

/// Global strategy registry, initialised once at startup.
static REGISTRY: OnceLock<StrategyRegistry> = OnceLock::new();

pub struct StrategyRegistry {
    /// Exact-match strategies keyed by connector `service_type` / `name`.
    strategies: HashMap<String, Box<dyn ConnectorStrategy>>,
    /// Fallback for any service_type without a registered strategy.
    default: Box<dyn ConnectorStrategy>,
}

impl StrategyRegistry {
    fn new() -> Self {
        Self {
            strategies: HashMap::new(),
            default: Box::new(DefaultStrategy),
        }
    }

    fn register(&mut self, service_type: &str, strategy: Box<dyn ConnectorStrategy>) {
        self.strategies.insert(service_type.to_string(), strategy);
    }

    /// Look up a strategy by service_type.
    ///
    /// 1. Exact match in the registry.
    /// 2. If the connector's metadata contains `oauth_type: "google"`, return
    ///    the Google OAuth strategy.
    /// 3. If service_type contains a known substring ("google", "clickup"),
    ///    return the corresponding strategy.
    /// 4. Default strategy.
    pub fn get(
        &self,
        service_type: &str,
        connector_metadata: Option<&str>,
    ) -> &dyn ConnectorStrategy {
        let registered: Vec<&str> = self.strategies.keys().map(|k| k.as_str()).collect();

        // 1. Exact match
        if let Some(s) = self.strategies.get(service_type) {
            tracing::debug!(
                service_type = %service_type,
                resolution = "exact_match",
                "Connector strategy selected via exact match"
            );
            return s.as_ref();
        }

        // 2. Metadata-based override
        if let Some(meta_json) = connector_metadata {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(meta_json) {
                let oauth_type = val.get("oauth_type").and_then(|v| v.as_str());
                if let Some(ot) = oauth_type {
                    let strategy_key = match ot {
                        "google" => Some("google-oauth"),
                        "microsoft" => Some("microsoft-oauth"),
                        _ => None,
                    };
                    if let Some(key) = strategy_key {
                        if let Some(s) = self.strategies.get(key) {
                            tracing::debug!(
                                service_type = %service_type,
                                oauth_type = ot,
                                resolution = "metadata_override",
                                ?registered,
                                "Connector strategy selected via metadata oauth_type override"
                            );
                            return s.as_ref();
                        }
                    }
                }
            }
        }

        // 3. Substring fallback for service_type patterns
        if service_type.contains("google") {
            if let Some(s) = self.strategies.get("google-oauth") {
                tracing::debug!(
                    service_type = %service_type,
                    resolution = "substring_match",
                    matched = "google-oauth",
                    ?registered,
                    "Connector strategy selected via substring match"
                );
                return s.as_ref();
            }
        }
        if service_type.contains("clickup") {
            if let Some(s) = self.strategies.get("clickup") {
                tracing::debug!(
                    service_type = %service_type,
                    resolution = "substring_match",
                    matched = "clickup",
                    ?registered,
                    "Connector strategy selected via substring match"
                );
                return s.as_ref();
            }
        }

        // 4. Default
        tracing::debug!(
            service_type = %service_type,
            resolution = "default",
            ?registered,
            "No matching connector strategy found, using default"
        );
        self.default.as_ref()
    }
}

/// Initialise the global strategy registry with all built-in strategies.
/// Safe to call multiple times -- only the first call takes effect.
pub fn init_registry() {
    REGISTRY.get_or_init(|| {
        let mut reg = StrategyRegistry::new();
        reg.register("google-oauth", Box::new(GoogleOAuthStrategy));
        reg.register("microsoft-oauth", Box::new(MicrosoftOAuthStrategy));
        reg.register("buffer", Box::new(BufferStrategy));
        reg.register("circleci", Box::new(CircleCIStrategy));
        reg.register("clickup", Box::new(ClickUpStrategy));
        reg.register("github", Box::new(GitHubStrategy));
        reg
    });
}

/// Get a reference to the global strategy registry.
/// Returns an error if called before `init_registry()`.
pub fn registry() -> Result<&'static StrategyRegistry, crate::error::AppError> {
    REGISTRY.get().ok_or_else(|| crate::error::AppError::Internal(
        "Connector strategy registry not initialised -- call init_registry() first".into()
    ))
}

// -- Shared helpers -------------------------------------------------

/// Find the first non-empty value for any of the given keys.
fn find_nonempty(fields: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = fields.get(*key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Look for an auth token in credential fields by checking common key names.
fn find_auth_token(fields: &HashMap<String, String>) -> Option<String> {
    const TOKEN_KEYS: &[&str] = &[
        "token",
        "api_key",
        "bot_token",
        "access_token",
        "api_token",
        "personal_access_token",
        "personal_token",
        "apiKey",
        "apiToken",
        "accessToken",
        "botToken",
        "bearer_token",
    ];
    for key in TOKEN_KEYS {
        if let Some(val) = fields.get(*key) {
            if !val.is_empty() {
                return Some(val.clone());
            }
        }
    }
    None
}

// ====================================================================
// Built-in strategies
// ====================================================================

// -- Default (generic Bearer auth / API-key rotation) ---------------

pub struct DefaultStrategy;

#[async_trait]
impl ConnectorStrategy for DefaultStrategy {
    /// For OAuth credentials, rotate via token refresh; for API keys, use default healthcheck.
    async fn rotate(
        &self,
        pool: &DbPool,
        credential: &PersonaCredential,
    ) -> Result<String, AppError> {
        let fields = crate::db::repos::resources::credentials::get_decrypted_fields(pool, credential)?;
        let _ = audit_log::log_decrypt(pool, &credential.id, &credential.name, "connector_strategy:rotate", None, None);
        if self.is_oauth(&fields) {
            // OAuth path: refresh + verify
            let refresh_msg = super::oauth_refresh::refresh_single_credential(pool, credential).await?;
            match super::healthcheck::run_healthcheck(pool, &credential.id).await {
                Ok(hc) if hc.success => Ok(format!("{refresh_msg} -- verified: {}", hc.message)),
                Ok(hc) => Ok(format!("{refresh_msg} -- healthcheck warning: {}", hc.message)),
                Err(_) => Ok(format!("{refresh_msg} -- healthcheck skipped")),
            }
        } else {
            // API key path: default healthcheck-based rotation
            let original_fields = fields;
            let result = super::healthcheck::run_healthcheck(pool, &credential.id).await;
            match result {
                Ok(hc) if hc.success => Ok(format!("API key verified healthy: {}", hc.message)),
                Ok(hc) => {
                    let _ = crate::db::repos::resources::credentials::save_fields(pool, &credential.id, &original_fields);
                    Err(AppError::Internal(format!("Rotation failed (credentials restored): {}", hc.message)))
                }
                Err(e) => {
                    let _ = crate::db::repos::resources::credentials::save_fields(pool, &credential.id, &original_fields);
                    Err(e)
                }
            }
        }
    }
}

// -- Google OAuth ---------------------------------------------------

pub struct GoogleOAuthStrategy;

#[async_trait]
impl ConnectorStrategy for GoogleOAuthStrategy {
    fn is_oauth(&self, _fields: &HashMap<String, String>) -> bool {
        true
    }

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        resolve_oauth_token(
            "Google",
            "https://oauth2.googleapis.com/token",
            super::google_oauth::resolve_google_desktop_oauth_credentials,
            fields,
        )
        .await
    }

    /// OAuth rotation = token refresh + persist + healthcheck verify.
    async fn rotate(
        &self,
        pool: &DbPool,
        credential: &PersonaCredential,
    ) -> Result<String, AppError> {
        rotate_via_refresh_and_healthcheck(pool, credential).await
    }
}

// -- Microsoft OAuth ------------------------------------------------

pub struct MicrosoftOAuthStrategy;

#[async_trait]
impl ConnectorStrategy for MicrosoftOAuthStrategy {
    fn is_oauth(&self, _fields: &HashMap<String, String>) -> bool {
        true
    }

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        resolve_oauth_token(
            "Microsoft",
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            super::google_oauth::resolve_microsoft_oauth_credentials,
            fields,
        )
        .await
    }

    async fn rotate(
        &self,
        pool: &DbPool,
        credential: &PersonaCredential,
    ) -> Result<String, AppError> {
        rotate_via_refresh_and_healthcheck(pool, credential).await
    }
}

// -- Shared OAuth helpers -------------------------------------------

/// Detect whether an OAuth token refresh error indicates the grant has been
/// permanently revoked or invalidated. These errors mean the user must
/// re-authorize -- retrying with the same refresh token will never succeed.
///
/// Checks for standard OAuth error codes returned in the JSON response body:
/// - `invalid_grant` -- token expired, revoked, or invalid (Google, Microsoft, generic)
/// - `unauthorized_client` -- client no longer authorized for this grant
/// - `interaction_required` -- Microsoft: user consent withdrawn, MFA policy changed
/// - `consent_required` -- user must re-consent
fn is_revocation_error(response_body: &str) -> bool {
    const REVOCATION_INDICATORS: &[&str] = &[
        "invalid_grant",
        "unauthorized_client",
        "interaction_required",
        "consent_required",
        // Google-specific sub-error descriptions
        "Token has been expired or revoked",
        "Token has been revoked",
    ];
    let body_lower = response_body.to_lowercase();
    REVOCATION_INDICATORS
        .iter()
        .any(|indicator| body_lower.contains(&indicator.to_lowercase()))
}

/// Generic OAuth token exchange: POST form-encoded params to a token URL,
/// extract access_token/expires_in/refresh_token from the JSON response.
/// Delegates HTTP + JSON boilerplate to the shared `token_endpoint_request` helper.
async fn exchange_oauth_refresh_token(
    provider: &str,
    token_url: &str,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<ResolvedToken, AppError> {
    let params: Vec<(&str, String)> = vec![
        ("client_id", client_id.to_string()),
        ("client_secret", client_secret.to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("grant_type", "refresh_token".to_string()),
    ];

    let label = format!("{provider} token refresh");
    let value = crate::commands::credentials::oauth::token_endpoint_request(token_url, &params, &label)
        .await
        .map_err(|e| {
            // Detect revocation-class errors from the provider's error response.
            if let Some(ref body) = e.body {
                if is_revocation_error(body) {
                    return AppError::OAuthRevoked(format!(
                        "{provider} grant revoked: {}", e.message
                    ));
                }
            }
            AppError::Internal(e.message)
        })?;

    let token = value
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal(format!("{provider} token refresh did not return access_token")))?;

    let expires_in = value.get("expires_in").and_then(|v| v.as_u64());
    let new_refresh_token = value
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(ResolvedToken {
        token,
        expires_in_secs: expires_in,
        refresh_token: new_refresh_token,
    })
}

/// Shared resolve_auth_token logic for OAuth strategies: return existing
/// access_token if present **and not expired**, otherwise exchange
/// refresh_token via the provider's token endpoint.
async fn resolve_oauth_token(
    provider: &str,
    token_url: &str,
    resolve_credentials: fn() -> Result<(String, String), AppError>,
    fields: &HashMap<String, String>,
) -> Result<Option<ResolvedToken>, AppError> {
    if let Some(token) = find_nonempty(fields, &["access_token"]) {
        // Check oauth_token_expires_at (stored alongside access_token during refresh).
        // If the token is expired, skip returning it so we fall through to the
        // refresh path — prevents using stale tokens after a background refresh
        // updated the DB while the caller held old decrypted fields.
        let expired = fields
            .get("oauth_token_expires_at")
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|expires_at| chrono::Utc::now() >= expires_at)
            .unwrap_or(false);

        if !expired {
            return Ok(Some(ResolvedToken::plain(token)));
        }

        tracing::debug!(
            provider,
            "Stored access_token is expired — falling through to refresh"
        );
    }

    let refresh_token = find_nonempty(fields, &["refresh_token"])
        .ok_or_else(|| AppError::Validation(format!("{provider} credential is missing refresh_token")))?;

    let (client_id, client_secret) = resolve_credentials()?;
    let resolved =
        exchange_oauth_refresh_token(provider, token_url, &client_id, &client_secret, &refresh_token).await?;
    Ok(Some(resolved))
}

/// Shared rotation logic for OAuth strategies: refresh token + healthcheck verify.
async fn rotate_via_refresh_and_healthcheck(
    pool: &DbPool,
    credential: &PersonaCredential,
) -> Result<String, AppError> {
    let refresh_msg = super::oauth_refresh::refresh_single_credential(pool, credential).await?;
    match super::healthcheck::run_healthcheck(pool, &credential.id).await {
        Ok(hc) if hc.success => Ok(format!("{refresh_msg} -- verified: {}", hc.message)),
        Ok(hc) => Ok(format!("{refresh_msg} -- healthcheck warning: {}", hc.message)),
        Err(_) => Ok(format!("{refresh_msg} -- healthcheck skipped")),
    }
}

// -- Buffer ---------------------------------------------------------

pub struct BufferStrategy;

#[async_trait]
impl ConnectorStrategy for BufferStrategy {
    fn is_oauth(&self, _fields: &HashMap<String, String>) -> bool {
        false
    }

    /// Buffer expects the access token as a query parameter, not a header.
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> reqwest::RequestBuilder {
        request.query(&[("access_token", token)])
    }
}

// -- CircleCI -------------------------------------------------------

pub struct CircleCIStrategy;

#[async_trait]
impl ConnectorStrategy for CircleCIStrategy {
    fn is_oauth(&self, _fields: &HashMap<String, String>) -> bool {
        false
    }

    /// CircleCI expects a `Circle-Token` header, not Bearer.
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> reqwest::RequestBuilder {
        request.header("Circle-Token", token)
    }
}

// -- ClickUp --------------------------------------------------------

pub struct ClickUpStrategy;

#[async_trait]
impl ConnectorStrategy for ClickUpStrategy {
    /// ClickUp expects a raw `Authorization: <token>` header, not Bearer.
    fn apply_auth(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> reqwest::RequestBuilder {
        request.header("Authorization", token)
    }
}

// -- GitHub ----------------------------------------------------------

pub struct GitHubStrategy;

#[async_trait]
impl ConnectorStrategy for GitHubStrategy {}
