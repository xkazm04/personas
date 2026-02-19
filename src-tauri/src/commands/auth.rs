use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYRING_SERVICE: &str = "personas-desktop";
const KEYRING_REFRESH: &str = "supabase-refresh-token";
const KEYRING_USER_CACHE: &str = "supabase-user-cache";

// ---------------------------------------------------------------------------
// Public types (exported to TypeScript via ts-rs)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AuthSubscription {
    pub plan: String,
    pub status: String,
    pub current_period_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AuthStateResponse {
    pub is_authenticated: bool,
    pub is_offline: bool,
    pub user: Option<AuthUser>,
    pub subscription: Option<AuthSubscription>,
}

// ---------------------------------------------------------------------------
// Internal state (stored in AppState, not serialized over IPC)
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct AuthStateInner {
    pub access_token: Option<String>,
    pub user: Option<AuthUser>,
    pub subscription: Option<AuthSubscription>,
    pub is_offline: bool,
    pub token_expires_at: Option<std::time::Instant>,
}

impl AuthStateInner {
    pub fn to_response(&self) -> AuthStateResponse {
        AuthStateResponse {
            is_authenticated: self.access_token.is_some() || (self.is_offline && self.user.is_some()),
            is_offline: self.is_offline,
            user: self.user.clone(),
            subscription: self.subscription.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// Supabase API response types (internal)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SupabaseTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: String,
    user: SupabaseUserResponse,
}

#[derive(Debug, Deserialize)]
struct SupabaseUserResponse {
    id: String,
    email: Option<String>,
    user_metadata: Option<serde_json::Value>,
}

impl SupabaseUserResponse {
    fn to_auth_user(&self) -> AuthUser {
        let meta = self.user_metadata.as_ref();
        AuthUser {
            id: self.id.clone(),
            email: self.email.clone().unwrap_or_default(),
            display_name: meta
                .and_then(|m| m.get("full_name").or_else(|| m.get("name")))
                .and_then(|v| v.as_str())
                .map(String::from),
            avatar_url: meta
                .and_then(|m| m.get("avatar_url").or_else(|| m.get("picture")))
                .and_then(|v| v.as_str())
                .map(String::from),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers: environment
// ---------------------------------------------------------------------------

/// Resolve Supabase URL.
///
/// Priority: compile-time `SUPABASE_URL` (set during CI build) → runtime env var.
/// The compile-time path is the production default; runtime override is useful
/// during development.
fn supabase_url() -> Result<String, AppError> {
    if let Some(url) = option_env!("SUPABASE_URL") {
        return Ok(url.to_string());
    }
    std::env::var("SUPABASE_URL")
        .map_err(|_| AppError::Auth("SUPABASE_URL not configured. Set it as an environment variable or rebuild with SUPABASE_URL set at compile time.".into()))
}

/// Resolve Supabase anon key.
///
/// The anon key is a **public** client key by Supabase design — it is safe to
/// embed in the binary. Security is enforced by Row Level Security policies and
/// OAuth access tokens, not by the secrecy of this key.
fn supabase_anon_key() -> Result<String, AppError> {
    if let Some(key) = option_env!("SUPABASE_ANON_KEY") {
        return Ok(key.to_string());
    }
    std::env::var("SUPABASE_ANON_KEY")
        .map_err(|_| AppError::Auth("SUPABASE_ANON_KEY not configured. Set it as an environment variable or rebuild with SUPABASE_ANON_KEY set at compile time.".into()))
}

// ---------------------------------------------------------------------------
// Helpers: keyring
// ---------------------------------------------------------------------------

fn store_refresh_token(token: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH)
        .map_err(|e| AppError::Auth(format!("Keyring entry error: {}", e)))?;
    entry
        .set_password(token)
        .map_err(|e| AppError::Auth(format!("Failed to store refresh token: {}", e)))?;
    Ok(())
}

fn load_refresh_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH).ok()?;
    entry.get_password().ok()
}

fn clear_tokens() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CACHE) {
        let _ = entry.delete_credential();
    }
}

fn cache_user(user: &AuthUser) {
    if let Ok(json) = serde_json::to_string(user) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CACHE) {
            let _ = entry.set_password(&json);
        }
    }
}

fn load_cached_user() -> Option<AuthUser> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CACHE).ok()?;
    let json = entry.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

// ---------------------------------------------------------------------------
// Helpers: Supabase API
// ---------------------------------------------------------------------------

async fn fetch_user_profile(access_token: &str) -> Result<AuthUser, AppError> {
    let url = format!("{}/auth/v1/user", supabase_url()?);
    let anon_key = supabase_anon_key()?;

    let resp = reqwest::Client::new()
        .get(&url)
        .header("apikey", &anon_key)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to fetch user profile: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Supabase user endpoint returned {}: {}",
            status, body
        )));
    }

    let user: SupabaseUserResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse user response: {}", e)))?;

    Ok(user.to_auth_user())
}

async fn refresh_access_token(
    refresh_token: &str,
) -> Result<SupabaseTokenResponse, AppError> {
    let url = format!(
        "{}/auth/v1/token?grant_type=refresh_token",
        supabase_url()?
    );
    let anon_key = supabase_anon_key()?;

    let resp = reqwest::Client::new()
        .post(&url)
        .header("apikey", &anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Token refresh failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Token refresh returned {}: {}",
            status, body
        )));
    }

    resp.json::<SupabaseTokenResponse>()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse token response: {}", e)))
}

fn parse_url_fragment(url_str: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    if let Some(fragment) = url_str.split('#').nth(1) {
        for (key, value) in url::form_urlencoded::parse(fragment.as_bytes()) {
            params.insert(key.to_string(), value.to_string());
        }
    }
    params
}

// ---------------------------------------------------------------------------
// IPC Commands
// ---------------------------------------------------------------------------

/// Open system browser to Supabase Google OAuth.
#[tauri::command]
pub async fn login_with_google() -> Result<(), AppError> {
    let base_url = supabase_url()?;
    let oauth_url = format!(
        "{}/auth/v1/authorize?provider=google&redirect_to=personas://auth/callback",
        base_url
    );

    open::that(&oauth_url)
        .map_err(|e| AppError::Auth(format!("Failed to open browser: {}", e)))?;

    tracing::info!("Opened browser for Google OAuth");
    Ok(())
}

/// Return the current authentication state.
#[tauri::command]
pub async fn get_auth_state(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<AuthStateResponse, AppError> {
    let auth = state.auth.lock().await;
    Ok(auth.to_response())
}

/// Log out: clear tokens from keyring and reset in-memory state.
#[tauri::command]
pub async fn logout(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), AppError> {
    clear_tokens();

    {
        let mut auth = state.auth.lock().await;
        *auth = AuthStateInner::default();
    }

    let _ = app.emit("auth-state-changed", AuthStateResponse {
        is_authenticated: false,
        is_offline: false,
        user: None,
        subscription: None,
    });

    tracing::info!("User logged out, tokens cleared");
    Ok(())
}

/// Refresh the session using the stored refresh token.
#[tauri::command]
pub async fn refresh_session(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<AuthStateResponse, AppError> {
    let refresh_token = load_refresh_token()
        .ok_or_else(|| AppError::Auth("No refresh token stored".into()))?;

    match refresh_access_token(&refresh_token).await {
        Ok(token_resp) => {
            let user = token_resp.user.to_auth_user();

            // Store the new refresh token (Supabase rotates it)
            store_refresh_token(&token_resp.refresh_token)?;
            cache_user(&user);

            let expires_at = std::time::Instant::now()
                + std::time::Duration::from_secs(token_resp.expires_in);

            let response = {
                let mut auth = state.auth.lock().await;
                auth.access_token = Some(token_resp.access_token);
                auth.user = Some(user);
                auth.is_offline = false;
                auth.token_expires_at = Some(expires_at);
                auth.to_response()
            };

            let _ = app.emit("auth-state-changed", &response);
            Ok(response)
        }
        Err(e) => {
            // If it's a network error, go offline with cached profile
            let err_str = e.to_string();
            if err_str.contains("Failed to fetch")
                || err_str.contains("Token refresh failed")
                || err_str.contains("dns error")
                || err_str.contains("connect error")
            {
                let cached_user = load_cached_user();
                if cached_user.is_some() {
                    let response = {
                        let mut auth = state.auth.lock().await;
                        auth.user = cached_user;
                        auth.is_offline = true;
                        auth.to_response()
                    };
                    let _ = app.emit("auth-state-changed", &response);
                    return Ok(response);
                }
            }
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// Internal: deep-link callback handler
// ---------------------------------------------------------------------------

/// Handle the OAuth callback deep link. Called by the deep-link event handler.
pub async fn handle_auth_callback(
    app: &AppHandle,
    url_str: &str,
) -> Result<(), AppError> {
    tracing::info!("Auth callback received");

    let params = parse_url_fragment(url_str);

    let access_token = params
        .get("access_token")
        .ok_or_else(|| AppError::Auth("Missing access_token in callback".into()))?
        .clone();

    let refresh_token = params
        .get("refresh_token")
        .ok_or_else(|| AppError::Auth("Missing refresh_token in callback".into()))?;

    let expires_in: u64 = params
        .get("expires_in")
        .and_then(|s| s.parse().ok())
        .unwrap_or(3600);

    // Store refresh token in OS keyring
    store_refresh_token(refresh_token)?;

    // Fetch full user profile from Supabase
    let user = fetch_user_profile(&access_token).await?;
    cache_user(&user);

    let expires_at =
        std::time::Instant::now() + std::time::Duration::from_secs(expires_in);

    // Update in-memory state
    let state: &Arc<AppState> = &app.state::<Arc<AppState>>();
    let response = {
        let mut auth = state.auth.lock().await;
        auth.access_token = Some(access_token);
        auth.user = Some(user);
        auth.subscription = None; // Fetched lazily or in Phase 12
        auth.is_offline = false;
        auth.token_expires_at = Some(expires_at);
        auth.to_response()
    };

    let _ = app.emit("auth-state-changed", &response);

    tracing::info!(
        user_email = response.user.as_ref().map(|u| u.email.as_str()),
        "User authenticated via OAuth callback"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal: session restore on app startup
// ---------------------------------------------------------------------------

/// Attempt to restore an existing session from the keyring. Called once at startup.
pub async fn try_restore_session(app: &AppHandle, state: &Arc<AppState>) {
    let refresh_token = match load_refresh_token() {
        Some(t) => t,
        None => {
            tracing::debug!("No stored refresh token, starting unauthenticated");
            return;
        }
    };

    tracing::info!("Found stored refresh token, attempting session restore...");

    match refresh_access_token(&refresh_token).await {
        Ok(token_resp) => {
            let user = token_resp.user.to_auth_user();

            // Store the rotated refresh token
            if let Err(e) = store_refresh_token(&token_resp.refresh_token) {
                tracing::warn!("Failed to store rotated refresh token: {}", e);
            }
            cache_user(&user);

            let expires_at = std::time::Instant::now()
                + std::time::Duration::from_secs(token_resp.expires_in);

            let response = {
                let mut auth = state.auth.lock().await;
                auth.access_token = Some(token_resp.access_token);
                auth.user = Some(user);
                auth.is_offline = false;
                auth.token_expires_at = Some(expires_at);
                auth.to_response()
            };

            let _ = app.emit("auth-state-changed", &response);
            tracing::info!("Session restored successfully");
        }
        Err(e) => {
            let err_str = e.to_string();
            // Network error → offline mode with cached profile
            if err_str.contains("Token refresh failed")
                || err_str.contains("dns error")
                || err_str.contains("connect error")
            {
                if let Some(cached_user) = load_cached_user() {
                    let response = {
                        let mut auth = state.auth.lock().await;
                        auth.user = Some(cached_user);
                        auth.is_offline = true;
                        auth.to_response()
                    };
                    let _ = app.emit("auth-state-changed", &response);
                    tracing::info!("Session restored in offline mode (cached profile)");
                    return;
                }
            }
            // Token invalid or no cached profile → clear and stay unauthenticated
            tracing::warn!("Session restore failed: {}, clearing tokens", err_str);
            clear_tokens();
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_url_fragment_basic() {
        let url = "personas://auth/callback#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer";
        let params = parse_url_fragment(url);
        assert_eq!(params.get("access_token").unwrap(), "abc123");
        assert_eq!(params.get("refresh_token").unwrap(), "def456");
        assert_eq!(params.get("expires_in").unwrap(), "3600");
        assert_eq!(params.get("token_type").unwrap(), "bearer");
    }

    #[test]
    fn test_parse_url_fragment_empty() {
        let url = "personas://auth/callback";
        let params = parse_url_fragment(url);
        assert!(params.is_empty());
    }

    #[test]
    fn test_parse_url_fragment_encoded() {
        let url = "personas://auth/callback#name=hello+world&key=a%26b";
        let params = parse_url_fragment(url);
        assert_eq!(params.get("name").unwrap(), "hello world");
        assert_eq!(params.get("key").unwrap(), "a&b");
    }

    #[test]
    fn test_auth_state_inner_default() {
        let inner = AuthStateInner::default();
        assert!(inner.access_token.is_none());
        assert!(inner.user.is_none());
        assert!(!inner.is_offline);
    }

    #[test]
    fn test_to_response_unauthenticated() {
        let inner = AuthStateInner::default();
        let resp = inner.to_response();
        assert!(!resp.is_authenticated);
        assert!(!resp.is_offline);
        assert!(resp.user.is_none());
    }

    #[test]
    fn test_to_response_authenticated() {
        let inner = AuthStateInner {
            access_token: Some("token".into()),
            user: Some(AuthUser {
                id: "u1".into(),
                email: "test@example.com".into(),
                display_name: Some("Test".into()),
                avatar_url: None,
            }),
            subscription: None,
            is_offline: false,
            token_expires_at: None,
        };
        let resp = inner.to_response();
        assert!(resp.is_authenticated);
        assert!(!resp.is_offline);
        assert_eq!(resp.user.as_ref().unwrap().email, "test@example.com");
    }

    #[test]
    fn test_to_response_offline_with_cached_user() {
        let inner = AuthStateInner {
            access_token: None,
            user: Some(AuthUser {
                id: "u1".into(),
                email: "test@example.com".into(),
                display_name: None,
                avatar_url: None,
            }),
            subscription: None,
            is_offline: true,
            token_expires_at: None,
        };
        let resp = inner.to_response();
        // Offline with cached user = still authenticated
        assert!(resp.is_authenticated);
        assert!(resp.is_offline);
    }

    #[test]
    fn test_supabase_user_to_auth_user() {
        let su = SupabaseUserResponse {
            id: "abc".into(),
            email: Some("user@test.com".into()),
            user_metadata: Some(serde_json::json!({
                "full_name": "John Doe",
                "picture": "https://example.com/avatar.png"
            })),
        };
        let user = su.to_auth_user();
        assert_eq!(user.id, "abc");
        assert_eq!(user.email, "user@test.com");
        assert_eq!(user.display_name.as_deref(), Some("John Doe"));
        assert_eq!(
            user.avatar_url.as_deref(),
            Some("https://example.com/avatar.png")
        );
    }

    #[test]
    fn test_supabase_user_to_auth_user_no_metadata() {
        let su = SupabaseUserResponse {
            id: "abc".into(),
            email: None,
            user_metadata: None,
        };
        let user = su.to_auth_user();
        assert_eq!(user.email, "");
        assert!(user.display_name.is_none());
        assert!(user.avatar_url.is_none());
    }
}
