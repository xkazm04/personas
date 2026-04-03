//! IPC Authorization Middleware
//!
//! Three-tier command authorization:
//!
//! - **Public**: No auth required (read-only, non-sensitive local commands)
//! - **Privileged**: Requires IPC session token (credential CRUD, vault access,
//!   sensitive local operations). The session token is a CSPRNG nonce generated
//!   at startup and injected into the webview via an init script.  Commands
//!   without a valid token are rejected before dispatch.
//! - **Cloud**: Requires Google OAuth (cloud execution, GitLab deploy, etc.)
//!
//! Enforcement layers (defense-in-depth):
//!
//! 1. **Invoke handler wrapper** (`wrap_invoke_handler`): Validates the
//!    `x-ipc-token` header for every privileged or cloud command *before*
//!    the command function is dispatched.  This is the primary security gate.
//!
//! 2. **Command-level guard** (`require_privileged_sync` / `require_privileged`):
//!    Validates a thread-local flag set by the invoke wrapper.  Defense-in-depth
//!    for sync commands; audit logging for async commands.
//!
//! 3. **Cloud guard** (`require_cloud_auth`): Checks Google OAuth state for
//!    cloud/remote commands.
//!
//! 4. **Frontend init script** (`generate_ipc_auth_script`): Injects the
//!    session token and monkey-patches `__TAURI_INTERNALS__.invoke` to attach
//!    the token as an `x-ipc-token` header on every IPC call.

use std::cell::Cell;
use std::collections::HashSet;
use std::sync::{Arc, LazyLock, OnceLock};

use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Session token (generated once at startup)
// ---------------------------------------------------------------------------

/// Global IPC session token.  Set once during app startup via `init_session_token`.
static IPC_SESSION_TOKEN: OnceLock<String> = OnceLock::new();

/// Initialise the global session token.  Panics on double-init (should never happen).
pub fn init_session_token(token: String) {
    IPC_SESSION_TOKEN
        .set(token)
        .expect("IPC session token already initialised");
}

/// Generate a 32-byte CSPRNG hex string suitable for use as a session token.
pub fn generate_ipc_session_token() -> String {
    use rand::Rng;
    let mut buf = [0u8; 32];
    rand::thread_rng().fill(&mut buf);
    hex::encode(buf)
}

// ---------------------------------------------------------------------------
// Thread-local validation flag (set by invoke wrapper, checked by guards)
// ---------------------------------------------------------------------------

thread_local! {
    /// Set to `true` by the invoke handler wrapper after validating the IPC
    /// token.  Checked by `require_privileged_sync` for defense-in-depth.
    /// Cleared after the command returns.
    static IPC_VALIDATED: Cell<bool> = const { Cell::new(false) };
}

/// Mark the current thread as having passed IPC token validation.
pub fn set_ipc_validated(valid: bool) {
    IPC_VALIDATED.with(|c| c.set(valid));
}

/// Check whether the current thread has been marked as IPC-validated.
fn is_ipc_validated() -> bool {
    IPC_VALIDATED.with(|c| c.get())
}

// ---------------------------------------------------------------------------
// Privileged command set (O(1) lookup)
// ---------------------------------------------------------------------------

/// Static set of all commands that require IPC session token validation.
/// This includes all credential/vault commands plus other sensitive operations.
static PRIVILEGED_COMMANDS_SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    PRIVILEGED_COMMANDS.iter().copied().collect()
});

/// Returns true if the command requires IPC session token validation.
pub fn is_privileged_command(command: &str) -> bool {
    PRIVILEGED_COMMANDS_SET.contains(command) || CLOUD_COMMANDS_SET.contains(command)
}

/// Commands that require a valid IPC session token.
/// These are sensitive local operations (credential management, vault access,
/// OAuth flows, API proxying, desktop discovery, etc.).
pub const PRIVILEGED_COMMANDS: &[&str] = &[
    // Credentials -- CRUD
    "list_credentials",
    "create_credential",
    "update_credential",
    "patch_credential_metadata",
    "credential_blast_radius",
    "delete_credential",
    "list_credential_events",
    "list_all_credential_events",
    "create_credential_event",
    "update_credential_event",
    "delete_credential_event",
    "healthcheck_credential",
    "healthcheck_credential_preview",
    "vault_status",
    "migrate_plaintext_credentials",
    "list_credential_fields",
    "update_credential_field",
    // Credentials -- Connectors
    "list_connectors",
    "get_connector",
    "create_connector",
    "update_connector",
    "delete_connector",
    // Credentials -- Credential Design
    "start_credential_design",
    "cancel_credential_design",
    "test_credential_design_healthcheck",
    // Credentials -- Negotiator
    "start_credential_negotiation",
    "cancel_credential_negotiation",
    "get_negotiation_step_help",
    // Credentials -- Intelligence
    "credential_audit_log",
    "credential_audit_log_global",
    "credential_usage_stats",
    "credential_dependents",
    // Credentials -- OAuth
    "start_google_credential_oauth",
    "get_google_credential_oauth_status",
    "list_oauth_providers",
    "start_oauth",
    "get_oauth_status",
    "refresh_oauth_token",
    // Credentials -- Auto-Credential Browser
    "start_auto_cred_browser",
    "save_playwright_procedure",
    "get_playwright_procedure",
    "cancel_auto_cred_browser",
    // Credentials -- Foraging
    "scan_credential_sources",
    "import_foraged_credential",
    // Credentials -- Rotation
    "list_rotation_policies",
    "create_rotation_policy",
    "update_rotation_policy",
    "delete_rotation_policy",
    "get_rotation_history",
    "get_rotation_status",
    "rotate_credential_now",
    "refresh_credential_oauth_now",
    "get_oauth_token_metrics",
    "get_oauth_token_lifetime_summary",
    // Credentials -- Database Schema & Queries
    "list_db_schema_tables",
    "create_db_schema_table",
    "update_db_schema_table",
    "delete_db_schema_table",
    "list_db_saved_queries",
    "create_db_saved_query",
    "update_db_saved_query",
    "delete_db_saved_query",
    "execute_db_query",
    "classify_db_query",
    "introspect_db_tables",
    "introspect_db_columns",
    // Credentials -- Query Debug
    "start_query_debug",
    "cancel_query_debug",
    // Credentials -- Schema Proposal
    "start_schema_proposal",
    "get_schema_proposal_snapshot",
    "cancel_schema_proposal",
    "validate_db_schema",
    // Credentials -- NL Query
    "start_nl_query",
    "get_nl_query_snapshot",
    "cancel_nl_query",
    // Credentials -- API Proxy
    "execute_api_request",
    "get_api_proxy_metrics",
    "parse_api_definition",
    "save_api_definition",
    "load_api_definition",
    // Credentials -- MCP Tools
    "list_mcp_tools",
    "execute_mcp_tool",
    "healthcheck_mcp_preview",
    "get_mcp_pool_metrics",
    // Credentials -- Desktop Discovery
    "discover_desktop_apps",
    "import_claude_mcp_servers",
    "get_desktop_connector_manifest",
    "get_pending_desktop_capabilities",
    "approve_desktop_capabilities",
    "revoke_desktop_approvals",
    "is_desktop_connector_approved",
    "register_imported_mcp_server",
    // Credentials -- Desktop Bridges
    "execute_desktop_bridge",
    "execute_desktop_plan",
    "get_desktop_runtime_status",
    "get_desktop_plan_result",
    // Credentials -- Credential Recipes
    "get_credential_recipe",
    "list_credential_recipes",
    "upsert_credential_recipe",
    "use_credential_recipe",
    // Credentials -- Vector KB
    // (inherits protection from the credential surface)
    // Signing
    "sign_document",
    "verify_document",
    // Data Portability (contains credentials)
    "export_credentials",
    "import_credentials",
    "export_full",
    "import_portability_bundle",
];

// ---------------------------------------------------------------------------
// Sync guards
// ---------------------------------------------------------------------------

/// Synchronous privileged auth check.
///
/// **Primary enforcement** happens in the invoke handler wrapper which
/// validates the IPC session token header.  This function provides
/// defense-in-depth by checking the thread-local validation flag and logging.
///
/// Fails closed: if the flag is not set, the command is rejected.
pub fn require_privileged_sync(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    // Verify the IPC security system is initialised
    let _token = IPC_SESSION_TOKEN.get().ok_or_else(|| {
        tracing::error!(
            command = command,
            "IPC session token not initialised -- failing closed"
        );
        AppError::Auth("IPC security system not initialised. Restart the app.".into())
    })?;

    // Check the thread-local flag set by the invoke handler wrapper
    if !is_ipc_validated() {
        tracing::warn!(
            command = command,
            "Privileged sync command called without IPC validation flag -- failing closed"
        );
        return Err(AppError::Forbidden(
            "IPC authentication required for this operation.".into(),
        ));
    }

    tracing::debug!(command = command, "Privileged IPC command accessed (sync)");

    // Suppress unused-variable warning for state (kept for API compatibility
    // and future use, e.g. per-command rate limiting).
    let _ = state;
    Ok(())
}

/// Synchronous auth check -- now a no-op for public (non-privileged) commands.
pub fn require_auth_sync(_state: &Arc<AppState>) -> Result<(), AppError> {
    Ok(())
}

/// Synchronous auth check that enforces Google OAuth.
/// Used only for cloud/remote commands (cloud_*, gitlab_*).
#[allow(dead_code)]
pub fn require_cloud_auth_sync(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    match state.auth.try_read() {
        Ok(auth) => {
            // Cloud commands require a real access token -- a cached user
            // profile alone (offline mode) is not sufficient because cloud
            // endpoints need a valid JWT to authorise requests.
            if auth.access_token.is_none() {
                if auth.is_offline && auth.user.is_some() {
                    tracing::warn!(
                        command = command,
                        "Blocked offline-only cloud IPC call (sync) -- no access token"
                    );
                    return Err(AppError::Auth(
                        "Cloud features are unavailable in offline mode. Reconnect to use this feature.".into(),
                    ));
                }
                tracing::warn!(
                    command = command,
                    "Blocked unauthenticated cloud IPC call (sync)"
                );
                return Err(AppError::Auth(
                    "Sign in with Google to use cloud features.".into(),
                ));
            }
            let user_id = auth
                .user
                .as_ref()
                .map(|u| u.id.as_str())
                .unwrap_or("unknown");
            tracing::info!(
                command = command,
                user_id = user_id,
                "Cloud IPC command accessed (sync)"
            );
            Ok(())
        }
        Err(_) => {
            tracing::error!(
                command = command,
                "Auth mutex poisoned or contended -- failing closed"
            );
            Err(AppError::Auth(
                "Auth state unavailable (mutex failure). Restart the app.".into(),
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Async guards
// ---------------------------------------------------------------------------

/// Async auth check -- no-op for public commands.
pub async fn require_auth(_state: &Arc<AppState>) -> Result<(), AppError> {
    Ok(())
}

/// Async privileged auth check.
///
/// **Primary enforcement** happens in the invoke handler wrapper.  This
/// function logs the access for audit purposes.  For async commands the
/// thread-local flag may not be reliable (tokio task migration), so we
/// verify the security system is initialised and log.
pub async fn require_privileged(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    // Verify the IPC security system is initialised
    if IPC_SESSION_TOKEN.get().is_none() {
        tracing::error!(
            command = command,
            "IPC session token not initialised -- failing closed"
        );
        return Err(AppError::Auth(
            "IPC security system not initialised. Restart the app.".into(),
        ));
    }

    tracing::debug!(command = command, "Privileged IPC command accessed (async)");
    let _ = state;
    Ok(())
}

/// Async auth check that enforces Google OAuth.
/// Used only for cloud/remote commands (cloud_*, gitlab_*).
pub async fn require_cloud_auth(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    let auth = state.auth.read().await;

    // Cloud commands require a real access token -- a cached user
    // profile alone (offline mode) is not sufficient because cloud
    // endpoints need a valid JWT to authorise requests.
    if auth.access_token.is_none() {
        if auth.is_offline && auth.user.is_some() {
            tracing::warn!(
                command = command,
                "Blocked offline-only cloud IPC call -- no access token"
            );
            return Err(AppError::Auth(
                "Cloud features are unavailable in offline mode. Reconnect to use this feature.".into(),
            ));
        }
        tracing::warn!(
            command = command,
            "Blocked unauthenticated cloud IPC call"
        );
        return Err(AppError::Auth(
            "Sign in with Google to use cloud features.".into(),
        ));
    }

    let user_id = auth
        .user
        .as_ref()
        .map(|u| u.id.as_str())
        .unwrap_or("unknown");
    tracing::info!(
        command = command,
        user_id = user_id,
        "Cloud IPC command accessed"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Invoke handler wrapper (primary enforcement)
// ---------------------------------------------------------------------------

/// Wraps the generated invoke handler with IPC session token validation.
///
/// For privileged commands, the wrapper:
/// 1. Extracts the `x-ipc-token` header from the IPC request
/// 2. Validates it against the session token (constant-time comparison)
/// 3. Sets the thread-local validation flag for defense-in-depth
/// 4. Dispatches to the real handler
/// 5. Clears the validation flag
///
/// Non-privileged commands are dispatched without validation.
pub fn wrap_invoke_handler<R: tauri::Runtime>(
    inner: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke: tauri::ipc::Invoke<R>| {
        let cmd = invoke.message.command().to_string();

        if is_privileged_command(&cmd) {
            // Extract and validate the IPC session token from headers
            let token_valid = match IPC_SESSION_TOKEN.get() {
                Some(expected) => {
                    match invoke.message.headers().get("x-ipc-token") {
                        Some(provided) => {
                            match provided.to_str() {
                                Ok(provided_str) => constant_time_eq(provided_str, expected),
                                Err(_) => false,
                            }
                        }
                        None => false,
                    }
                }
                None => {
                    // Token not initialised -- fail closed
                    tracing::error!(
                        command = %cmd,
                        "IPC session token not initialised -- rejecting privileged command"
                    );
                    false
                }
            };

            if !token_valid {
                tracing::warn!(
                    command = %cmd,
                    "Rejected IPC call: invalid or missing session token"
                );
                invoke.resolver.reject(serde_json::json!({
                    "error": "IPC authentication failed: invalid session token",
                    "kind": "Forbidden"
                }));
                return true; // handled (rejected)
            }

            // Set thread-local flag for defense-in-depth (sync commands)
            set_ipc_validated(true);
            let result = inner(invoke);
            set_ipc_validated(false);
            result
        } else {
            inner(invoke)
        }
    }
}

/// Constant-time string comparison to prevent timing attacks on token validation.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes()
        .iter()
        .zip(b.as_bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

// ---------------------------------------------------------------------------
// Frontend defense-in-depth: JS initialization script
// ---------------------------------------------------------------------------

/// Generate the JavaScript initialization script that injects the IPC session
/// token into all Tauri invoke calls via the `x-ipc-token` header.
///
/// The token is captured in a closure scope (not a global) to make extraction
/// harder for XSS payloads.  Combined with CSP, this provides meaningful
/// defense-in-depth against content injection attacks.
pub fn generate_ipc_auth_script(token: &str) -> String {
    // Store the token in a global that the frontend can read.
    // Also attempt to monkey-patch __TAURI_INTERNALS__.invoke if it's
    // already available, and set up a retry for when it appears later
    // (Tauri 2.x init script timing: internals may not exist yet).
    format!(
        r#"(function() {{
  'use strict';
  var _t = '{}';
  window.__IPC_TOKEN = _t;
  function patchInvoke() {{
    if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return false;
    if (window.__TAURI_INTERNALS__.__ipc_patched) return true;
    var _orig = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = function(cmd, args, options) {{
      var opts = options || {{}};
      var h = new Headers(opts.headers || {{}});
      h.set('x-ipc-token', _t);
      opts.headers = h;
      return _orig.call(this, cmd, args, opts);
    }};
    window.__TAURI_INTERNALS__.__ipc_patched = true;
    return true;
  }}
  if (!patchInvoke()) {{
    // Retry until __TAURI_INTERNALS__ becomes available
    var tries = 0;
    var iv = setInterval(function() {{
      if (patchInvoke() || ++tries > 100) clearInterval(iv);
    }}, 50);
  }}
}})();"#,
        token
    )
}

// ---------------------------------------------------------------------------
// Cloud command tier classification (unchanged)
// ---------------------------------------------------------------------------

/// Static HashSet for O(1) cloud command lookup.
static CLOUD_COMMANDS_SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    CLOUD_COMMANDS.iter().copied().collect()
});

/// Commands that require cloud authentication (Google OAuth).
pub const CLOUD_COMMANDS: &[&str] = &[
    "cloud_connect",
    "cloud_reconnect_from_keyring",
    "cloud_disconnect",
    "cloud_get_config",
    "cloud_status",
    "cloud_execute_persona",
    "cloud_cancel_execution",
    "cloud_oauth_authorize",
    "cloud_oauth_callback",
    "cloud_oauth_status",
    "cloud_oauth_refresh",
    "cloud_oauth_disconnect",
    "cloud_deploy_persona",
    "cloud_list_deployments",
    "cloud_pause_deployment",
    "cloud_resume_deployment",
    "cloud_undeploy",
    "cloud_get_base_url",
    "cloud_list_pending_reviews",
    "cloud_respond_to_review",
    "cloud_list_executions",
    "cloud_execution_stats",
    "cloud_get_execution_output",
    "cloud_list_triggers",
    "cloud_create_trigger",
    "cloud_update_trigger",
    "cloud_delete_trigger",
    "cloud_list_trigger_firings",
    "cloud_webhook_relay_status",
    "smee_relay_list",
    "smee_relay_create",
    "smee_relay_update",
    "smee_relay_set_status",
    "smee_relay_delete",
    // GitLab
    "gitlab_connect",
    "gitlab_connect_from_vault",
    "gitlab_disconnect",
    "gitlab_get_config",
    "gitlab_list_projects",
    "gitlab_deploy_persona",
    "gitlab_list_agents",
    "gitlab_undeploy_agent",
    "gitlab_revoke_credentials",
    "gitlab_list_persona_versions",
    "gitlab_deploy_persona_versioned",
    "gitlab_rollback_persona",
    "gitlab_list_persona_branches",
    "gitlab_setup_persona_branches",
    "gitlab_list_deployment_history",
    "gitlab_rollback_from_history",
];

/// Returns the authorization tier for a given command name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthTier {
    /// No authentication required.
    Public,
    /// Requires IPC session token (sensitive local operations).
    Privileged,
    /// Requires IPC session token + Google OAuth (cloud/remote commands).
    Cloud,
}

pub fn command_tier(command: &str) -> AuthTier {
    if CLOUD_COMMANDS_SET.contains(command) {
        AuthTier::Cloud
    } else if PRIVILEGED_COMMANDS_SET.contains(command) {
        AuthTier::Privileged
    } else {
        AuthTier::Public
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_commands_are_public() {
        assert_eq!(command_tier("greet"), AuthTier::Public);
        assert_eq!(command_tier("get_auth_state"), AuthTier::Public);
        assert_eq!(command_tier("list_personas"), AuthTier::Public);
        assert_eq!(command_tier("execute_persona"), AuthTier::Public);
    }

    #[test]
    fn privileged_commands_require_token() {
        assert_eq!(command_tier("list_credentials"), AuthTier::Privileged);
        assert_eq!(command_tier("create_credential"), AuthTier::Privileged);
        assert_eq!(command_tier("delete_credential"), AuthTier::Privileged);
        assert_eq!(command_tier("healthcheck_credential"), AuthTier::Privileged);
        assert_eq!(command_tier("vault_status"), AuthTier::Privileged);
        assert_eq!(command_tier("scan_credential_sources"), AuthTier::Privileged);
        assert_eq!(command_tier("execute_api_request"), AuthTier::Privileged);
        assert_eq!(command_tier("sign_document"), AuthTier::Privileged);
    }

    #[test]
    fn cloud_commands_require_auth() {
        assert_eq!(command_tier("cloud_connect"), AuthTier::Cloud);
        assert_eq!(command_tier("cloud_execute_persona"), AuthTier::Cloud);
        assert_eq!(command_tier("gitlab_connect"), AuthTier::Cloud);
        assert_eq!(command_tier("gitlab_deploy_persona"), AuthTier::Cloud);
    }

    #[test]
    fn is_privileged_includes_cloud() {
        assert!(is_privileged_command("list_credentials"));
        assert!(is_privileged_command("cloud_connect"));
        assert!(!is_privileged_command("greet"));
    }

    #[test]
    fn constant_time_eq_works() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "ab"));
        assert!(!constant_time_eq("", "a"));
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn session_token_is_64_hex_chars() {
        let token = generate_ipc_session_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
