//! Connector strategy trait + registry.
//!
//! Each connector type implements `ConnectorStrategy`, which consolidates
//! healthcheck auth, rotation, and token-refresh logic that was previously
//! scattered across `healthcheck.rs`, `rotation.rs`, and ad-hoc if-branches.

use std::collections::HashMap;
use std::sync::OnceLock;

use async_trait::async_trait;

use crate::db::models::PersonaCredential;
use crate::db::DbPool;
use crate::error::AppError;



// ── Trait ──────────────────────────────────────────────────────────

/// Strategy interface for connector-specific healthcheck + rotation behaviour.
#[async_trait]
pub trait ConnectorStrategy: Send + Sync {
    /// Whether this credential uses OAuth token refresh for rotation.
    fn is_oauth(&self, fields: &HashMap<String, String>) -> bool;

    /// Resolve the auth token to use for healthcheck / API requests.
    /// Returns `Ok(Some(token))` when a token is available, `Ok(None)` when
    /// the credential doesn't carry a token (e.g. basic-auth only).
    async fn resolve_auth_token(
        &self,
        connector_metadata: Option<&str>,
        fields: &HashMap<String, String>,
    ) -> Result<Option<String>, AppError>;

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
    async fn rotate(
        &self,
        pool: &DbPool,
        credential: &PersonaCredential,
    ) -> Result<String, AppError> {
        let result = super::healthcheck::run_healthcheck(pool, &credential.id).await?;
        if result.success {
            let fields = crate::db::repos::resources::credentials::get_decrypted_fields(pool, credential)?;
            if self.is_oauth(&fields) {
                Ok(format!("OAuth token refreshed and verified: {}", result.message))
            } else {
                Ok(format!("API key verified healthy: {}", result.message))
            }
        } else {
            Err(AppError::Internal(format!(
                "Healthcheck failed during rotation: {}",
                result.message
            )))
        }
    }
}

// ── Registry ───────────────────────────────────────────────────────

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
        // 1. Exact match
        if let Some(s) = self.strategies.get(service_type) {
            return s.as_ref();
        }

        // 2. Metadata-based override
        if let Some(meta_json) = connector_metadata {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(meta_json) {
                if val
                    .get("oauth_type")
                    .and_then(|v| v.as_str())
                    .is_some_and(|v| v == "google")
                {
                    if let Some(s) = self.strategies.get("google-oauth") {
                        return s.as_ref();
                    }
                }
            }
        }

        // 3. Substring fallback for service_type patterns
        if service_type.contains("google") {
            if let Some(s) = self.strategies.get("google-oauth") {
                return s.as_ref();
            }
        }
        if service_type.contains("clickup") {
            if let Some(s) = self.strategies.get("clickup") {
                return s.as_ref();
            }
        }

        // 4. Default
        self.default.as_ref()
    }
}

/// Initialise the global strategy registry with all built-in strategies.
/// Safe to call multiple times — only the first call takes effect.
pub fn init_registry() {
    REGISTRY.get_or_init(|| {
        let mut reg = StrategyRegistry::new();
        reg.register("google-oauth", Box::new(GoogleOAuthStrategy));
        reg.register("clickup", Box::new(ClickUpStrategy));
        reg.register("github", Box::new(GitHubStrategy));
        reg
    });
}

/// Get a reference to the global strategy registry.
/// Panics if called before `init_registry()`.
pub fn registry() -> &'static StrategyRegistry {
    REGISTRY.get().expect("connector strategy registry not initialised — call init_registry() first")
}

// ── Shared helpers ─────────────────────────────────────────────────

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

// ════════════════════════════════════════════════════════════════════
// Built-in strategies
// ════════════════════════════════════════════════════════════════════

// ── Default (generic Bearer auth / API-key rotation) ───────────────

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
    ) -> Result<Option<String>, AppError> {
        Ok(find_auth_token(fields))
    }
}

// ── Google OAuth ───────────────────────────────────────────────────

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
    ) -> Result<Option<String>, AppError> {
        // Prefer an existing access_token if present
        if let Some(token) = find_nonempty(fields, &["access_token", "accessToken"]) {
            return Ok(Some(token));
        }

        // Otherwise refresh using the refresh_token
        let refresh_token = find_nonempty(fields, &["refresh_token", "refreshToken"])
            .ok_or_else(|| AppError::Validation("Google credential is missing refresh_token".into()))?;

        let (client_id, client_secret) =
            super::google_oauth::resolve_google_oauth_env_credentials()?;
        let access_token =
            exchange_google_refresh_token(&client_id, &client_secret, &refresh_token).await?;
        Ok(Some(access_token))
    }
}

/// Exchange a Google refresh token for a fresh access token.
async fn exchange_google_refresh_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<String, AppError> {
    let response = reqwest::Client::new()
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
        .map_err(|e| AppError::Internal(format!("Google token refresh request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(AppError::Internal(format!(
            "Google token refresh failed ({}): {}",
            status, body
        )));
    }

    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::Internal(format!("Invalid Google token response JSON: {}", e)))?;

    value
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal("Google token refresh did not return access_token".into()))
}

// ── ClickUp ────────────────────────────────────────────────────────

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
    ) -> Result<Option<String>, AppError> {
        Ok(find_auth_token(fields))
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

// ── GitHub ──────────────────────────────────────────────────────────

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
    ) -> Result<Option<String>, AppError> {
        Ok(find_auth_token(fields))
    }
}
