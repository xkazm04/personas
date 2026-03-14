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
}

impl ResolvedToken {
    pub fn plain(token: String) -> Self {
        Self { token, expires_in_secs: None }
    }

    pub fn with_expiry(token: String, expires_in_secs: u64) -> Self {
        Self { token, expires_in_secs: Some(expires_in_secs) }
    }
}

// -- Trait ----------------------------------------------------------

/// Strategy interface for connector-specific healthcheck + rotation behaviour.
#[async_trait]
pub trait ConnectorStrategy: Send + Sync {
    /// Whether this credential uses OAuth token refresh for rotation.
    fn is_oauth(&self, fields: &HashMap<String, String>) -> bool;

    /// Resolve the auth token to use for healthcheck / API requests.
    /// Returns `Ok(Some(resolved))` when a token is available, `Ok(None)` when
    /// the credential doesn't carry a token (e.g. basic-auth only).
    /// The `ResolvedToken` includes `expires_in_secs` when the provider reports it.
    async fn resolve_auth_token(
        &self,
        connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError>;

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
                if oauth_type.is_some_and(|v| v == "google") {
                    if let Some(s) = self.strategies.get("google-oauth") {
                        tracing::debug!(
                            service_type = %service_type,
                            oauth_type = "google",
                            resolution = "metadata_override",
                            ?registered,
                            "Connector strategy selected via metadata oauth_type override"
                        );
                        return s.as_ref();
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
    fn is_oauth(&self, fields: &HashMap<String, String>) -> bool {
        fields.contains_key("refresh_token") || fields.contains_key("refreshToken")
    }

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        Ok(find_auth_token(fields).map(ResolvedToken::plain))
    }

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
        // Prefer an existing access_token if present
        if let Some(token) = find_nonempty(fields, &["access_token", "accessToken"]) {
            return Ok(Some(ResolvedToken::plain(token)));
        }

        // Otherwise refresh using the refresh_token
        let refresh_token = find_nonempty(fields, &["refresh_token", "refreshToken"])
            .ok_or_else(|| AppError::Validation("Google credential is missing refresh_token".into()))?;

        let (client_id, client_secret) =
            super::google_oauth::resolve_google_oauth_env_credentials()?;
        let resolved =
            exchange_google_refresh_token(&client_id, &client_secret, &refresh_token).await?;
        Ok(Some(resolved))
    }

    /// OAuth rotation = token refresh + persist + healthcheck verify.
    async fn rotate(
        &self,
        pool: &DbPool,
        credential: &PersonaCredential,
    ) -> Result<String, AppError> {
        // Refresh the token via the shared oauth_refresh module
        let refresh_msg = super::oauth_refresh::refresh_single_credential(pool, credential).await?;

        // Verify the refreshed token with a healthcheck
        match super::healthcheck::run_healthcheck(pool, &credential.id).await {
            Ok(hc) if hc.success => Ok(format!("{refresh_msg} -- verified: {}", hc.message)),
            Ok(hc) => Ok(format!("{refresh_msg} -- healthcheck warning: {}", hc.message)),
            Err(_) => Ok(format!("{refresh_msg} -- healthcheck skipped")),
        }
    }
}

/// Exchange a Google refresh token for a fresh access token.
async fn exchange_google_refresh_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<ResolvedToken, AppError> {
    let response = crate::SHARED_HTTP
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Google token refresh request failed: {e}")))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(AppError::Internal(format!(
            "Google token refresh failed ({status}): {body}"
        )));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid Google token response JSON: {e}")))?;

    let token = value
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal("Google token refresh did not return access_token".into()))?;

    let expires_in = value.get("expires_in").and_then(|v| v.as_u64());

    Ok(match expires_in {
        Some(secs) => ResolvedToken::with_expiry(token, secs),
        None => ResolvedToken::plain(token),
    })
}

// -- Buffer ---------------------------------------------------------

pub struct BufferStrategy;

#[async_trait]
impl ConnectorStrategy for BufferStrategy {
    fn is_oauth(&self, _fields: &HashMap<String, String>) -> bool {
        false
    }

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        Ok(find_auth_token(fields).map(ResolvedToken::plain))
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

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        Ok(find_auth_token(fields).map(ResolvedToken::plain))
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
    fn is_oauth(&self, fields: &HashMap<String, String>) -> bool {
        fields.contains_key("refresh_token") || fields.contains_key("refreshToken")
    }

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        Ok(find_auth_token(fields).map(ResolvedToken::plain))
    }

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
impl ConnectorStrategy for GitHubStrategy {
    fn is_oauth(&self, fields: &HashMap<String, String>) -> bool {
        fields.contains_key("refresh_token") || fields.contains_key("refreshToken")
    }

    async fn resolve_auth_token(
        &self,
        _connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<ResolvedToken>, AppError> {
        Ok(find_auth_token(fields).map(ResolvedToken::plain))
    }
}
