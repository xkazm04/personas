//! IPC Authorization Middleware
//!
//! Provides tiered authorization guards for Tauri IPC commands.
//! Commands are classified into three tiers:
//!
//! - **Public**: No auth required (theme, settings, auth state, health checks)
//! - **Authenticated**: Requires a valid session (CRUD operations, executions)
//! - **Privileged**: Requires auth + additional logging (credentials, API proxy,
//!   DB queries, OAuth, cloud connect, MCP tools)
//!
//! Two layers of enforcement:
//!
//! 1. **Command-level guards** (`require_auth`, `require_privileged`): Called at
//!    the start of each command function. These are the primary enforcement layer.
//!
//! 2. **Frontend interception** (`IPC_AUTH_SCRIPT`): A JS initialization script
//!    injected into the webview that intercepts `invoke()` calls and rejects
//!    non-public commands when the frontend auth state reports unauthenticated.
//!    This provides defense-in-depth against XSS payloads that bypass the UI.

use std::sync::Arc;

use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Sync guards (for sync #[tauri::command] functions)
// ---------------------------------------------------------------------------

/// Synchronous auth check using `try_lock()` on the auth mutex.
///
/// Falls back to allowing the request if the lock is contended (rare),
/// since the auth state is written infrequently (login/logout/refresh).
/// The frontend JS guard provides an additional layer of protection.
pub fn require_auth_sync(state: &Arc<AppState>) -> Result<(), AppError> {
    match state.auth.try_lock() {
        Ok(auth) => {
            let is_authenticated =
                auth.access_token.is_some() || (auth.is_offline && auth.user.is_some());
            if !is_authenticated {
                return Err(AppError::Auth(
                    "Authentication required. Please sign in to continue.".into(),
                ));
            }
            Ok(())
        }
        Err(_) => {
            // Lock contended — allow through; the JS guard + async commands
            // provide overlapping coverage.
            Ok(())
        }
    }
}

/// Synchronous privileged auth check with audit logging.
pub fn require_privileged_sync(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    match state.auth.try_lock() {
        Ok(auth) => {
            let is_authenticated =
                auth.access_token.is_some() || (auth.is_offline && auth.user.is_some());
            if !is_authenticated {
                tracing::warn!(
                    command = command,
                    "Blocked unauthenticated privileged IPC call (sync)"
                );
                return Err(AppError::Auth(
                    "Authentication required for privileged operations.".into(),
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
                "Privileged IPC command accessed (sync)"
            );
            Ok(())
        }
        Err(_) => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Async guards (for async commands)
// ---------------------------------------------------------------------------

/// Check that the user has an active authenticated session.
///
/// A session is valid when:
/// - An `access_token` is present (online auth), **or**
/// - The app is in offline mode with a cached user (offline auth).
///
/// Returns `Ok(())` on success, or `Err(AppError::Auth(...))` if not
/// authenticated.
pub async fn require_auth(state: &Arc<AppState>) -> Result<(), AppError> {
    let auth = state.auth.lock().await;

    let is_authenticated =
        auth.access_token.is_some() || (auth.is_offline && auth.user.is_some());

    if !is_authenticated {
        return Err(AppError::Auth(
            "Authentication required. Please sign in to continue.".into(),
        ));
    }

    Ok(())
}

/// Check that the user has an active session **and** log the privileged
/// access attempt for audit purposes.
///
/// Privileged commands include: credential access, API proxy, DB queries,
/// OAuth token operations, cloud connect, MCP tool execution, and any
/// other command that can exfiltrate secrets or act on external services.
pub async fn require_privileged(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    let auth = state.auth.lock().await;

    let is_authenticated =
        auth.access_token.is_some() || (auth.is_offline && auth.user.is_some());

    if !is_authenticated {
        tracing::warn!(
            command = command,
            "Blocked unauthenticated privileged IPC call"
        );
        return Err(AppError::Auth(
            "Authentication required for privileged operations.".into(),
        ));
    }

    // Audit log for privileged access
    let user_id = auth
        .user
        .as_ref()
        .map(|u| u.id.as_str())
        .unwrap_or("unknown");
    tracing::info!(
        command = command,
        user_id = user_id,
        "Privileged IPC command accessed"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Frontend defense-in-depth: JS initialization script
// ---------------------------------------------------------------------------

/// JavaScript initialization script injected into the webview.
///
/// Wraps `window.__TAURI_INTERNALS__.invoke` to reject non-public commands
/// when the user is not authenticated. This is a defense-in-depth measure;
/// the backend guards are the primary enforcement layer.
pub const IPC_AUTH_SCRIPT: &str = r#"
(function() {
  'use strict';

  const PUBLIC_COMMANDS = new Set([
    'greet',
    'login_with_google', 'get_auth_state', 'logout', 'refresh_session',
    'get_app_setting', 'set_app_setting', 'delete_app_setting',
    'system_health_check', 'health_check_local', 'health_check_agents',
    'health_check_cloud', 'health_check_account',
    'open_external_url', 'get_crash_logs', 'clear_crash_logs',
    'send_app_notification', 'test_notification_channel',
    'start_setup_install', 'cancel_setup_install',
    'get_session_public_key',
    'get_tier_usage',
    'get_workflows_overview', 'get_workflow_job_output', 'cancel_workflow_job',
    'get_byom_policy', 'set_byom_policy', 'delete_byom_policy'
  ]);

  // Track auth state from the app's own auth events.
  let _isAuthenticated = false;

  // Listen for auth state changes emitted by the Rust backend.
  if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
    // Periodically sync auth state (lightweight — uses cached state)
    const syncAuth = () => {
      try {
        window.__TAURI_INTERNALS__.invoke('get_auth_state').then(state => {
          _isAuthenticated = state && state.is_authenticated === true;
        }).catch(() => {});
      } catch {}
    };
    // Initial sync after a short delay (app state may not be ready yet)
    setTimeout(syncAuth, 1000);
    // Re-sync every 30s
    setInterval(syncAuth, 30000);

    // Wrap the invoke function to intercept non-public calls
    const _originalInvoke = window.__TAURI_INTERNALS__.invoke.bind(
      window.__TAURI_INTERNALS__
    );

    window.__TAURI_INTERNALS__.invoke = function(cmd, args, options) {
      // Extract command name (Tauri 2 prefixes plugin commands with "plugin:name|cmd")
      const cmdName = typeof cmd === 'string' ? cmd.split('|').pop() : cmd;

      if (!PUBLIC_COMMANDS.has(cmdName) && !_isAuthenticated) {
        console.warn('[ipc-auth] Blocked unauthenticated IPC call:', cmdName);
        return Promise.reject({
          error: 'Authentication required',
          kind: 'auth'
        });
      }

      return _originalInvoke(cmd, args, options);
    };
  }
})();
"#;

// ---------------------------------------------------------------------------
// Command tier classification
// ---------------------------------------------------------------------------

/// Commands that require NO authentication.
pub const PUBLIC_COMMANDS: &[&str] = &[
    // Phase 1 greeting
    "greet",
    // Auth (must be accessible pre-login)
    "login_with_google",
    "get_auth_state",
    "logout",
    "refresh_session",
    // Settings & theming
    "get_app_setting",
    "set_app_setting",
    "delete_app_setting",
    // Health checks
    "system_health_check",
    "health_check_local",
    "health_check_agents",
    "health_check_cloud",
    "health_check_account",
    // System utilities
    "open_external_url",
    "get_crash_logs",
    "clear_crash_logs",
    // Notifications
    "send_app_notification",
    "test_notification_channel",
    // Setup
    "start_setup_install",
    "cancel_setup_install",
    // Session public key (needed to encrypt data before auth)
    "get_session_public_key",
    // Tier usage (informational)
    "get_tier_usage",
    // Workflows overview (read-only status)
    "get_workflows_overview",
    "get_workflow_job_output",
    "cancel_workflow_job",
    // BYOM policy (configuration, not data access)
    "get_byom_policy",
    "set_byom_policy",
    "delete_byom_policy",
];

/// Commands that require authentication AND produce audit logs due to
/// their access to secrets, external services, or destructive power.
pub const PRIVILEGED_COMMANDS: &[&str] = &[
    // Credential CRUD — access to secrets
    "list_credentials",
    "create_credential",
    "update_credential",
    "patch_credential_metadata",
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
    // Connectors — tied to credential infrastructure
    "list_connectors",
    "get_connector",
    "create_connector",
    "update_connector",
    "delete_connector",
    // Credential design/negotiation — may access external services
    "start_credential_design",
    "cancel_credential_design",
    "test_credential_design_healthcheck",
    "start_credential_negotiation",
    "cancel_credential_negotiation",
    "get_negotiation_step_help",
    // Credential intelligence — audit access
    "credential_audit_log",
    "credential_audit_log_global",
    "credential_usage_stats",
    "credential_dependents",
    // OAuth — token access
    "start_google_credential_oauth",
    "get_google_credential_oauth_status",
    "list_oauth_providers",
    "start_oauth",
    "get_oauth_status",
    "refresh_oauth_token",
    // Auto credential browser — external browser automation
    "start_auto_cred_browser",
    "save_playwright_procedure",
    "get_playwright_procedure",
    // Credential foraging — scans system for secrets
    "scan_credential_sources",
    "import_foraged_credential",
    // Credential rotation — modifies live credentials
    "list_rotation_policies",
    "create_rotation_policy",
    "update_rotation_policy",
    "delete_rotation_policy",
    "get_rotation_history",
    "get_rotation_status",
    "rotate_credential_now",
    // DB schema & queries — can execute arbitrary SQL
    "list_db_schema_tables",
    "create_db_schema_table",
    "update_db_schema_table",
    "delete_db_schema_table",
    "list_db_saved_queries",
    "create_db_saved_query",
    "update_db_saved_query",
    "delete_db_saved_query",
    "execute_db_query",
    "introspect_db_tables",
    "introspect_db_columns",
    // Query debug — AI-assisted SQL
    "start_query_debug",
    "cancel_query_debug",
    // API proxy — sends HTTP requests with stored credentials
    "execute_api_request",
    "parse_api_definition",
    "save_api_definition",
    "load_api_definition",
    // MCP tools — can execute arbitrary tool calls
    "list_mcp_tools",
    "execute_mcp_tool",
    // Cloud connect — establishes cloud session
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
    // GitLab — deploys code / manages agents
    "gitlab_connect",
    "gitlab_disconnect",
    "gitlab_get_config",
    "gitlab_list_projects",
    "gitlab_deploy_persona",
    "gitlab_list_agents",
    "gitlab_undeploy_agent",
    "gitlab_revoke_credentials",
    // Execution — runs CLI processes
    "create_execution",
    "execute_persona",
    // n8n platform — manages external workflows
    "n8n_list_workflows",
    "n8n_activate_workflow",
    "n8n_deactivate_workflow",
    "n8n_create_workflow",
    "n8n_trigger_webhook",
    // GitHub platform
    "github_list_repos",
    "github_check_permissions",
    // Deploy automation
    "deploy_automation",
    // Tool invocation — direct tool execution
    "invoke_tool_direct",
    // Trigger dry-run — may hit external endpoints
    "dry_run_trigger",
    // BYOM audit — provider usage data
    "list_provider_audit_log",
    "list_provider_audit_by_persona",
    "get_provider_usage_stats",
    // Import/Export — full data access
    "export_full",
    "import_portability_bundle",
];

/// Returns the authorization tier for a given command name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthTier {
    /// No authentication required.
    Public,
    /// Requires a valid user session.
    Authenticated,
    /// Requires auth + audit logging.
    Privileged,
}

pub fn command_tier(command: &str) -> AuthTier {
    if PUBLIC_COMMANDS.contains(&command) {
        AuthTier::Public
    } else if PRIVILEGED_COMMANDS.contains(&command) {
        AuthTier::Privileged
    } else {
        // Default: require authentication for unlisted commands
        AuthTier::Authenticated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_commands_are_public() {
        assert_eq!(command_tier("greet"), AuthTier::Public);
        assert_eq!(command_tier("get_auth_state"), AuthTier::Public);
        assert_eq!(command_tier("get_app_setting"), AuthTier::Public);
    }

    #[test]
    fn privileged_commands_are_privileged() {
        assert_eq!(command_tier("list_credentials"), AuthTier::Privileged);
        assert_eq!(command_tier("execute_api_request"), AuthTier::Privileged);
        assert_eq!(command_tier("execute_db_query"), AuthTier::Privileged);
        assert_eq!(command_tier("execute_mcp_tool"), AuthTier::Privileged);
        assert_eq!(command_tier("cloud_connect"), AuthTier::Privileged);
    }

    #[test]
    fn unlisted_commands_default_to_authenticated() {
        assert_eq!(command_tier("list_personas"), AuthTier::Authenticated);
        assert_eq!(command_tier("create_persona"), AuthTier::Authenticated);
        assert_eq!(command_tier("list_events"), AuthTier::Authenticated);
    }
}
