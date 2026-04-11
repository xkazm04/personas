use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::engine::crypto::SecureString;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYRING_SERVICE: &str = "personas-desktop";
const KEYRING_REFRESH: &str = "supabase-refresh-token";
const KEYRING_USER_CACHE: &str = "supabase-user-cache";
const KEYRING_GOOGLE_PROVIDER_REFRESH: &str = "google-provider-refresh-token";

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
    /// True when the user is offline but has a cached profile — local-only
    /// features may work, but cloud/remote commands should be rejected.
    pub is_offline_authenticated: bool,
    pub user: Option<AuthUser>,
    pub subscription: Option<AuthSubscription>,
}

// ---------------------------------------------------------------------------
// Internal state (stored in AppState, not serialized over IPC)
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct AuthStateInner {
    pub access_token: Option<SecureString>,
    pub user: Option<AuthUser>,
    pub subscription: Option<AuthSubscription>,
    pub is_offline: bool,
    pub token_expires_at: Option<std::time::Instant>,
    /// Cryptographic nonce generated before initiating an OAuth flow.
    /// Validated against the `state` parameter returned in the deep-link callback
    /// to prevent token injection via crafted deep links (RFC 6749 §10.12).
    pub pending_oauth_state: Option<String>,
    /// Google's raw OAuth access token (the `provider_token` from Supabase callback).
    /// Used for Google Drive API calls when the user authenticates with `drive.file` scope.
    /// This is NOT the Supabase JWT — it's the actual Google token.
    pub google_provider_token: Option<SecureString>,
    /// Google's refresh token for the provider token (allows re-requesting Drive access).
    pub google_provider_refresh_token: Option<String>,
}

impl AuthStateInner {
    fn is_token_expired(&self) -> bool {
        match self.token_expires_at {
            Some(expires_at) => std::time::Instant::now() >= expires_at,
            None => false,
        }
    }

    pub fn to_response(&self) -> AuthStateResponse {
        let offline_authed = self.is_offline && self.user.is_some() && self.access_token.is_none();
        let token_valid = self.access_token.is_some() && !self.is_token_expired();
        AuthStateResponse {
            is_authenticated: token_valid || offline_authed,
            is_offline: self.is_offline,
            is_offline_authenticated: offline_authed,
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

/// Cached Supabase URL — resolved once on first access via `OnceLock`.
///
/// Priority: compile-time `SUPABASE_URL` (set during CI build) -> runtime env var.
/// The compile-time path is the production default; runtime override is useful
/// during development.
fn supabase_url() -> Result<&'static str, AppError> {
    static URL: OnceLock<Result<String, String>> = OnceLock::new();
    let result = URL.get_or_init(|| {
        if let Some(url) = option_env!("SUPABASE_URL") {
            return Ok(url.to_string());
        }
        std::env::var("SUPABASE_URL")
            .map_err(|_| "SUPABASE_URL not configured. Set it as an environment variable or rebuild with SUPABASE_URL set at compile time.".to_string())
    });
    match result {
        Ok(s) => Ok(s.as_str()),
        Err(msg) => Err(AppError::Auth(msg.clone())),
    }
}

/// Cached Supabase anon key — resolved once on first access via `OnceLock`.
///
/// The anon key is a **public** client key by Supabase design -- it is safe to
/// embed in the binary. Security is enforced by Row Level Security policies and
/// OAuth access tokens, not by the secrecy of this key.
fn supabase_anon_key() -> Result<&'static str, AppError> {
    static KEY: OnceLock<Result<String, String>> = OnceLock::new();
    let result = KEY.get_or_init(|| {
        if let Some(key) = option_env!("SUPABASE_ANON_KEY") {
            return Ok(key.to_string());
        }
        std::env::var("SUPABASE_ANON_KEY")
            .map_err(|_| "SUPABASE_ANON_KEY not configured. Set it as an environment variable or rebuild with SUPABASE_ANON_KEY set at compile time.".to_string())
    });
    match result {
        Ok(s) => Ok(s.as_str()),
        Err(msg) => Err(AppError::Auth(msg.clone())),
    }
}

// ---------------------------------------------------------------------------
// Helpers: keyring
// ---------------------------------------------------------------------------

#[cfg(feature = "desktop")]
fn store_refresh_token(token: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH)
        .map_err(|e| AppError::Auth(format!("Keyring entry error: {e}")))?;
    entry
        .set_password(token)
        .map_err(|e| AppError::Auth(format!("Failed to store refresh token: {e}")))?;
    Ok(())
}

#[cfg(not(feature = "desktop"))]
fn store_refresh_token(_token: &str) -> Result<(), AppError> {
    Ok(())
}

#[cfg(feature = "desktop")]
fn load_refresh_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH).ok()?;
    entry.get_password().ok()
}

#[cfg(not(feature = "desktop"))]
fn load_refresh_token() -> Option<String> {
    None
}

#[cfg(feature = "desktop")]
fn clear_tokens() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_REFRESH) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CACHE) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_GOOGLE_PROVIDER_REFRESH) {
        let _ = entry.delete_credential();
    }
}

#[cfg(not(feature = "desktop"))]
fn clear_tokens() {}

#[cfg(feature = "desktop")]
fn cache_user(user: &AuthUser) {
    if let Ok(json) = serde_json::to_string(user) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CACHE) {
            let _ = entry.set_password(&json);
        }
    }
}

#[cfg(not(feature = "desktop"))]
fn cache_user(_user: &AuthUser) {}

#[cfg(feature = "desktop")]
fn load_cached_user() -> Option<AuthUser> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_CACHE).ok()?;
    let json = entry.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

#[cfg(not(feature = "desktop"))]
fn load_cached_user() -> Option<AuthUser> {
    None
}

#[cfg(feature = "desktop")]
fn store_google_provider_refresh_token(token: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_GOOGLE_PROVIDER_REFRESH)
        .map_err(|e| AppError::Auth(format!("Keyring entry error: {e}")))?;
    entry
        .set_password(token)
        .map_err(|e| AppError::Auth(format!("Failed to store Google provider refresh token: {e}")))?;
    Ok(())
}

#[cfg(not(feature = "desktop"))]
fn store_google_provider_refresh_token(_token: &str) -> Result<(), AppError> {
    Ok(())
}

#[cfg(feature = "desktop")]
fn load_google_provider_refresh_token() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_GOOGLE_PROVIDER_REFRESH).ok()?;
    entry.get_password().ok()
}

#[cfg(not(feature = "desktop"))]
fn load_google_provider_refresh_token() -> Option<String> {
    None
}

// ---------------------------------------------------------------------------
// Helpers: Supabase API
// ---------------------------------------------------------------------------

async fn fetch_user_profile(access_token: &str) -> Result<AuthUser, AppError> {
    let url = format!("{}/auth/v1/user", supabase_url()?);
    let anon_key = supabase_anon_key()?;

    let resp = crate::SHARED_HTTP
        .get(&url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {access_token}"))
        .send()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to fetch user profile: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Supabase user endpoint returned {status}: {body}"
        )));
    }

    let user: SupabaseUserResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse user response: {e}")))?;

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

    let resp = crate::SHARED_HTTP
        .post(&url)
        .header("apikey", anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() || e.is_request() {
                AppError::NetworkOffline(format!("Token refresh failed: {e}"))
            } else {
                AppError::Auth(format!("Token refresh failed: {e}"))
            }
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "Token refresh returned {status}: {body}"
        )));
    }

    resp.json::<SupabaseTokenResponse>()
        .await
        .map_err(|e| AppError::Auth(format!("Failed to parse token response: {e}")))
}

/// Parse both query parameters and fragment parameters from a callback URL.
///
/// Supabase puts tokens in the fragment (`#access_token=...`) while our CSRF
/// state nonce is embedded in the query string (`?app_state=...`).
fn parse_callback_params(url_str: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();

    // Parse query parameters (contains app_state for CSRF validation)
    if let Some(after_question) = url_str.split('?').nth(1) {
        // Query part is everything between ? and # (or end of string)
        let query_part = after_question.split('#').next().unwrap_or(after_question);
        for (key, value) in url::form_urlencoded::parse(query_part.as_bytes()) {
            params.insert(key.to_string(), value.to_string());
        }
    }

    // Parse fragment parameters (contains tokens from Supabase)
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

/// Open an in-app popup for Google OAuth sign-in.
///
/// Creates a Tauri WebView window that loads the Supabase authorize URL.
/// Supabase immediately 302-redirects to Google's consent screen, so the
/// user only ever sees the Google sign-in page.
///
/// The `on_navigation` handler intercepts the final `personas://auth/callback`
/// redirect, extracts tokens, processes authentication, and closes the popup.
#[tauri::command]
pub async fn login_with_google(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    use rand::Rng;
    use tauri::WebviewWindowBuilder;

    // Reject if an OAuth flow is already in progress (e.g. double-click)
    // to avoid overwriting the CSRF nonce that the first flow's callback needs.
    {
        let auth = state.auth.read().await;
        if auth.pending_oauth_state.is_some() {
            return Err(AppError::Auth(
                "An OAuth sign-in is already in progress".into(),
            ));
        }
    }

    // Generate 32-byte cryptographic random state nonce
    let mut buf = [0u8; 32];
    rand::thread_rng().fill(&mut buf);
    let oauth_state = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf);

    // Store the state nonce so the callback handler can verify it
    {
        let mut auth = state.auth.write().await;
        auth.pending_oauth_state = Some(oauth_state.clone());
    }

    let base_url = supabase_url()?;
    let anon_key = supabase_anon_key()?;

    // Embed our CSRF state nonce in the redirect URL as a query parameter.
    // Supabase does not forward the top-level `state` param to custom-scheme
    // redirects, so we pass it through `redirect_to` instead.
    let redirect_to = format!(
        "personas://auth/callback?app_state={}",
        urlencoding::encode(&oauth_state),
    );
    let oauth_url = format!(
        "{}/auth/v1/authorize?provider=google&redirect_to={}&apikey={}",
        base_url,
        urlencoding::encode(&redirect_to),
        urlencoding::encode(anon_key),
    );

    // Close any existing OAuth window from a previous attempt
    if let Some(existing) = app.get_webview_window("oauth") {
        let _ = existing.close();
    }

    let nav_handle = app.clone();
    WebviewWindowBuilder::new(&app, "oauth", tauri::WebviewUrl::External(
        oauth_url.parse().map_err(|e| AppError::Auth(format!("Invalid OAuth URL: {e}")))?,
    ))
    .title("Personas \u{2014} Sign in with Google")
    .inner_size(480.0, 680.0)
    .center()
    .resizable(false)
    .minimizable(false)
    .closable(true)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if url_str.starts_with("personas://auth/callback") {
            tracing::info!("OAuth popup intercepted callback redirect");
            let callback_url = url_str.to_string();
            let handle = nav_handle.clone();

            tauri::async_runtime::spawn(async move {
                // Close the popup first for immediate visual feedback
                if let Some(win) = handle.get_webview_window("oauth") {
                    let _ = win.close();
                }
                if let Err(e) = handle_auth_callback(&handle, &callback_url).await {
                    tracing::error!("OAuth callback failed: {}", e);
                    // Surface the error to the frontend so the user sees what went wrong
                    let _ = handle.emit(event_name::AUTH_ERROR, serde_json::json!({
                        "error": format!("{}", e)
                    }));
                }
            });

            return false; // Block navigation to personas:// scheme
        }
        true // Allow Supabase -> Google -> consent redirects
    })
    .build()
    .map_err(|e| AppError::Auth(format!("Failed to open sign-in window: {e}")))?;

    tracing::info!("Opened OAuth sign-in window");
    Ok(())
}

/// Re-authenticate with Google requesting the `drive.file` scope.
///
/// This triggers a new OAuth flow that includes Google Drive permissions.
/// The `provider_token` from the callback gives direct Google Drive API access.
/// If the user has already granted basic Google sign-in, Google shows an
/// incremental consent screen for just the Drive scope.
#[tauri::command]
pub async fn login_with_google_drive(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    use rand::Rng;
    use tauri::WebviewWindowBuilder;

    {
        let auth = state.auth.read().await;
        if auth.pending_oauth_state.is_some() {
            return Err(AppError::Auth(
                "An OAuth sign-in is already in progress".into(),
            ));
        }
    }

    let mut buf = [0u8; 32];
    rand::thread_rng().fill(&mut buf);
    let oauth_state = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf);

    {
        let mut auth = state.auth.write().await;
        auth.pending_oauth_state = Some(oauth_state.clone());
    }

    let base_url = supabase_url()?;
    let anon_key = supabase_anon_key()?;

    let redirect_to = format!(
        "personas://auth/callback?app_state={}",
        urlencoding::encode(&oauth_state),
    );

    // Include drive.file scope for Google Drive access.
    // Supabase passes this to Google's OAuth consent screen.
    let oauth_url = format!(
        "{}/auth/v1/authorize?provider=google&redirect_to={}&apikey={}&scopes={}",
        base_url,
        urlencoding::encode(&redirect_to),
        urlencoding::encode(anon_key),
        urlencoding::encode("https://www.googleapis.com/auth/drive.file"),
    );

    if let Some(existing) = app.get_webview_window("oauth") {
        let _ = existing.close();
    }

    let nav_handle = app.clone();
    WebviewWindowBuilder::new(&app, "oauth", tauri::WebviewUrl::External(
        oauth_url.parse().map_err(|e| AppError::Auth(format!("Invalid OAuth URL: {e}")))?,
    ))
    .title("Personas \u{2014} Connect Google Drive")
    .inner_size(480.0, 680.0)
    .center()
    .resizable(false)
    .minimizable(false)
    .closable(true)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if url_str.starts_with("personas://auth/callback") {
            let callback_url = url_str.to_string();
            let handle = nav_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(win) = handle.get_webview_window("oauth") {
                    let _ = win.close();
                }
                if let Err(e) = handle_auth_callback(&handle, &callback_url).await {
                    tracing::error!("Drive OAuth callback failed: {}", e);
                    let _ = handle.emit(event_name::AUTH_ERROR, serde_json::json!({
                        "error": format!("{}", e)
                    }));
                }
            });
            return false;
        }
        true
    })
    .build()
    .map_err(|e| AppError::Auth(format!("Failed to open Drive sign-in window: {e}")))?;

    tracing::info!("Opened Google Drive OAuth sign-in window");
    Ok(())
}

/// Check whether a Google Drive provider token is available.
#[tauri::command]
pub async fn get_google_drive_status(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, AppError> {
    let auth = state.auth.read().await;
    Ok(auth.google_provider_token.is_some())
}

/// Return the current authentication state.
#[tauri::command]
pub async fn get_auth_state(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<AuthStateResponse, AppError> {
    let auth = state.auth.read().await;
    Ok(auth.to_response())
}

/// Clear a stale pending OAuth state that blocks new login attempts.
#[tauri::command]
pub async fn clear_pending_oauth(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let mut auth = state.auth.write().await;
    auth.pending_oauth_state = None;
    tracing::info!("Cleared pending OAuth state");
    Ok(())
}

/// Log out: clear tokens from keyring and reset in-memory state.
#[tauri::command]
pub async fn logout(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), AppError> {
    clear_tokens();

    {
        let mut auth = state.auth.write().await;
        *auth = AuthStateInner::default();
    }

    // Clear cloud client's user token on logout
    if let Some(ref client) = *state.cloud_client.lock().await {
        client.set_user_token(None).await;
    }

    let _ = app.emit(event_name::AUTH_STATE_CHANGED, AuthStateResponse {
        is_authenticated: false,
        is_offline: false,
        is_offline_authenticated: false,
        user: None,
        subscription: None,
    });

    tracing::info!("User logged out, tokens cleared");
    Ok(())
}

/// Refresh the session using the stored refresh token.
///
/// A `refresh_lock` mutex serialises concurrent callers so that only one
/// token refresh executes at a time. Supabase rotates refresh tokens on
/// every use; without this guard two concurrent refreshes would both consume
/// the same token, causing one to fail and invalidating the session.
#[tauri::command]
pub async fn refresh_session(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<AuthStateResponse, AppError> {
    // Acquire the refresh lock -- subsequent callers block here until the
    // first refresh completes, then proceed with the already-refreshed state.
    let _refresh_guard = state.refresh_lock.lock().await;

    // After acquiring the lock, check whether the token is still valid.
    // A previous holder of the lock may have already completed a refresh.
    {
        let auth = state.auth.read().await;
        if let Some(expires_at) = auth.token_expires_at {
            if expires_at > std::time::Instant::now() + std::time::Duration::from_secs(30) {
                tracing::debug!("Token already refreshed by a concurrent caller, skipping");
                return Ok(auth.to_response());
            }
        }
    }

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

            let access_token = SecureString::new(token_resp.access_token);
            let response = {
                let mut auth = state.auth.write().await;
                auth.access_token = Some(access_token.duplicate());
                auth.user = Some(user);
                auth.is_offline = false;
                auth.token_expires_at = Some(expires_at);
                auth.to_response()
            };

            // Push refreshed Supabase JWT to cloud client
            if let Some(ref client) = *state.cloud_client.lock().await {
                client.set_user_token(Some(access_token.expose_secret().to_string())).await;
            }

            let _ = app.emit(event_name::AUTH_STATE_CHANGED, &response);
            Ok(response)
        }
        Err(e) => {
            // If it's a network error, go offline with cached profile
            if matches!(e, AppError::NetworkOffline(_)) {
                let cached_user = load_cached_user();
                if cached_user.is_some() {
                    let response = {
                        let mut auth = state.auth.write().await;
                        auth.user = cached_user;
                        auth.is_offline = true;
                        auth.to_response()
                    };
                    let _ = app.emit(event_name::AUTH_STATE_CHANGED, &response);
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
///
/// Validates the `app_state` query parameter against the nonce stored by
/// `login_with_google` to prevent token injection via crafted deep links
/// (RFC 6749 §10.12).
pub async fn handle_auth_callback(
    app: &AppHandle,
    url_str: &str,
) -> Result<(), AppError> {
    // Log only the non-fragment portion to avoid leaking tokens in logs
    tracing::info!("Auth callback received from: {}", url_str.split('#').next().unwrap_or("unknown"));

    let params = parse_callback_params(url_str);

    // -- State parameter validation (RFC 6749 §10.12) --------------------
    // Our CSRF nonce is in the query string as `app_state` (embedded in redirect_to).
    let state: &Arc<AppState> = &app.state::<Arc<AppState>>();
    {
        let mut auth = state.auth.write().await;
        let expected_state = auth.pending_oauth_state.take();
        let received_state = params.get("app_state");

        match (expected_state, received_state) {
            (Some(expected), Some(received)) if expected == *received => {
                tracing::debug!("OAuth state parameter validated");
            }
            (Some(_), Some(_)) => {
                tracing::warn!("OAuth callback state mismatch -- possible deep-link injection");
                return Err(AppError::Auth(
                    "OAuth state mismatch: callback did not originate from this app".into(),
                ));
            }
            (Some(_), None) => {
                tracing::warn!("OAuth callback missing state parameter");
                return Err(AppError::Auth(
                    "OAuth callback missing state parameter".into(),
                ));
            }
            (None, _) => {
                tracing::warn!("No pending OAuth state -- unsolicited callback rejected");
                return Err(AppError::Auth(
                    "No pending OAuth flow: unsolicited auth callback rejected".into(),
                ));
            }
        }
    }

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

    // Extract Google provider tokens (for Drive API access, if drive.file scope was granted)
    let provider_token = params.get("provider_token").cloned();
    let provider_refresh_token = params.get("provider_refresh_token").cloned();

    if provider_token.is_some() {
        tracing::info!("Google provider token captured (Drive API access available)");
    }

    // Store refresh token in OS keyring
    store_refresh_token(refresh_token)?;

    // Store Google provider refresh token in keyring for persistence across restarts
    if let Some(ref prt) = provider_refresh_token {
        store_google_provider_refresh_token(prt).ok();
    }

    // Fetch full user profile from Supabase
    let user = fetch_user_profile(&access_token).await?;
    cache_user(&user);

    let expires_at =
        std::time::Instant::now() + std::time::Duration::from_secs(expires_in);

    // Update in-memory state
    let access_token = SecureString::new(access_token);
    let response = {
        let mut auth = state.auth.write().await;
        auth.access_token = Some(access_token.duplicate());
        auth.user = Some(user);
        auth.subscription = None; // Fetched lazily or in Phase 12
        auth.is_offline = false;
        auth.token_expires_at = Some(expires_at);
        // Store Google provider tokens for Drive API access
        if let Some(pt) = provider_token {
            auth.google_provider_token = Some(SecureString::new(pt));
        }
        auth.google_provider_refresh_token = provider_refresh_token;
        auth.to_response()
    };

    // Push Supabase JWT to cloud client for per-user isolation
    if let Some(ref client) = *state.cloud_client.lock().await {
        client.set_user_token(Some(access_token.expose_secret().to_string())).await;
    }

    let _ = app.emit(event_name::AUTH_STATE_CHANGED, &response);

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
///
/// Acquires `refresh_lock` to prevent races with a concurrent `refresh_session`
/// call that might fire before startup restore completes.
pub async fn try_restore_session(app: &AppHandle, state: &Arc<AppState>) {
    let _refresh_guard = state.refresh_lock.lock().await;

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
                let mut auth = state.auth.write().await;
                auth.access_token = Some(SecureString::new(token_resp.access_token));
                auth.user = Some(user);
                auth.is_offline = false;
                auth.token_expires_at = Some(expires_at);
                auth.to_response()
            };

            let _ = app.emit(event_name::AUTH_STATE_CHANGED, &response);
            tracing::info!("Session restored successfully");
        }
        Err(e) => {
            // Network error -> offline mode with cached profile
            if matches!(&e, AppError::NetworkOffline(_)) {
                if let Some(cached_user) = load_cached_user() {
                    let response = {
                        let mut auth = state.auth.write().await;
                        auth.user = Some(cached_user);
                        auth.is_offline = true;
                        auth.to_response()
                    };
                    let _ = app.emit(event_name::AUTH_STATE_CHANGED, &response);
                    tracing::info!("Session restored in offline mode (cached profile)");
                    return;
                }
            }
            // Token invalid or no cached profile -> clear and stay unauthenticated
            tracing::warn!("Session restore failed: {}, clearing tokens", e);
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
    fn test_parse_callback_params_basic() {
        let url = "personas://auth/callback#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer";
        let params = parse_callback_params(url);
        assert_eq!(params.get("access_token").unwrap(), "abc123");
        assert_eq!(params.get("refresh_token").unwrap(), "def456");
        assert_eq!(params.get("expires_in").unwrap(), "3600");
        assert_eq!(params.get("token_type").unwrap(), "bearer");
    }

    #[test]
    fn test_parse_callback_params_empty() {
        let url = "personas://auth/callback";
        let params = parse_callback_params(url);
        assert!(params.is_empty());
    }

    #[test]
    fn test_parse_callback_params_encoded() {
        let url = "personas://auth/callback#name=hello+world&key=a%26b";
        let params = parse_callback_params(url);
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
            access_token: Some(SecureString::new("token".into())),
            user: Some(AuthUser {
                id: "u1".into(),
                email: "test@example.com".into(),
                display_name: Some("Test".into()),
                avatar_url: None,
            }),
            subscription: None,
            is_offline: false,
            token_expires_at: None,
            pending_oauth_state: None,
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
            pending_oauth_state: None,
        };
        let resp = inner.to_response();
        // Offline with cached user = authenticated but offline-only
        assert!(resp.is_authenticated);
        assert!(resp.is_offline);
        assert!(resp.is_offline_authenticated);
    }

    #[test]
    fn test_to_response_online_with_token_not_offline_authenticated() {
        let inner = AuthStateInner {
            access_token: Some(SecureString::new("token".into())),
            user: Some(AuthUser {
                id: "u1".into(),
                email: "test@example.com".into(),
                display_name: None,
                avatar_url: None,
            }),
            subscription: None,
            is_offline: false,
            token_expires_at: None,
            pending_oauth_state: None,
        };
        let resp = inner.to_response();
        assert!(resp.is_authenticated);
        assert!(!resp.is_offline_authenticated);
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

    #[test]
    fn test_auth_state_inner_default_has_no_pending_state() {
        let inner = AuthStateInner::default();
        assert!(inner.pending_oauth_state.is_none());
    }

    #[test]
    fn test_pending_oauth_state_cleared_on_default() {
        // Simulates logout path: resetting to default clears any pending state
        let mut inner = AuthStateInner::default();
        inner.pending_oauth_state = Some("test-nonce".into());
        // Sanity check: the setup actually took effect (also makes the
        // intermediate `inner` value a real read, not dead code).
        assert!(inner.pending_oauth_state.is_some());
        inner = AuthStateInner::default();
        assert!(inner.pending_oauth_state.is_none());
    }

    #[test]
    fn test_parse_callback_params_with_app_state() {
        let url = "personas://auth/callback?app_state=my-nonce-123#access_token=abc&refresh_token=def";
        let params = parse_callback_params(url);
        assert_eq!(params.get("app_state").unwrap(), "my-nonce-123");
        assert_eq!(params.get("access_token").unwrap(), "abc");
        assert_eq!(params.get("refresh_token").unwrap(), "def");
    }

    #[test]
    fn test_parse_callback_params_query_and_fragment() {
        // Realistic callback URL: app_state in query, tokens in fragment
        let url = "personas://auth/callback?app_state=abc123#access_token=tok&refresh_token=ref&expires_in=3600&token_type=bearer";
        let params = parse_callback_params(url);
        assert_eq!(params.get("app_state").unwrap(), "abc123");
        assert_eq!(params.get("access_token").unwrap(), "tok");
        assert_eq!(params.get("refresh_token").unwrap(), "ref");
        assert_eq!(params.get("expires_in").unwrap(), "3600");
    }

    #[test]
    fn test_oauth_state_generation_is_url_safe() {
        use rand::Rng;
        let mut buf = [0u8; 32];
        rand::thread_rng().fill(&mut buf);
        let state = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf);
        // URL-safe base64 should only contain alphanumeric, '-', and '_'
        assert!(state.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
        // 32 bytes -> 43 base64 characters (no padding)
        assert_eq!(state.len(), 43);
    }
}
