//! IPC Authorization Middleware
//!
//! Google OAuth is **optional** -- it only unlocks cloud features.
//! All local operations (personas, credentials, executions, etc.) work
//! without signing in.
//!
//! Commands are classified into two tiers:
//!
//! - **Local**: No auth required (all local operations)
//! - **Cloud**: Requires Google OAuth (cloud execution, GitLab deploy, etc.)
//!
//! Two layers of enforcement for cloud commands:
//!
//! 1. **Command-level guard** (`require_cloud_auth`): Called at the start of
//!    cloud/gitlab command functions. Primary enforcement layer.
//!
//! 2. **Frontend interception** (`IPC_AUTH_SCRIPT`): A JS initialization script
//!    injected into the webview that intercepts cloud commands when the user
//!    is not authenticated.
//!
//! Legacy `require_auth` / `require_privileged` guards are kept as no-ops
//! for backward compatibility -- they always return `Ok(())`.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};

use crate::error::AppError;
use crate::AppState;

/// Static HashSet for O(1) cloud command lookup.
static CLOUD_COMMANDS_SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    CLOUD_COMMANDS.iter().copied().collect()
});

// ---------------------------------------------------------------------------
// Sync guards (for sync #[tauri::command] functions)
// ---------------------------------------------------------------------------

/// Synchronous auth check -- now a no-op.
///
/// Google OAuth is optional; it only unlocks cloud features.
/// Local operations work without authentication.
pub fn require_auth_sync(_state: &Arc<AppState>) -> Result<(), AppError> {
    Ok(())
}

/// Synchronous privileged auth check -- now a no-op for local operations.
///
/// Google OAuth is optional; it only unlocks cloud features.
/// Use `require_cloud_auth_sync` for cloud/remote commands.
pub fn require_privileged_sync(_state: &Arc<AppState>, _command: &str) -> Result<(), AppError> {
    Ok(())
}

/// Synchronous auth check that actually enforces authentication.
/// Used only for cloud/remote commands (cloud_*, gitlab_*).
#[allow(dead_code)]
pub fn require_cloud_auth_sync(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    match state.auth.try_lock() {
        Ok(auth) => {
            let is_authenticated =
                auth.access_token.is_some() || (auth.is_offline && auth.user.is_some());
            if !is_authenticated {
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
        Err(_) => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Async guards (for async commands)
// ---------------------------------------------------------------------------

/// Async auth check -- now a no-op.
///
/// Google OAuth is optional; it only unlocks cloud features.
/// Local operations work without authentication.
pub async fn require_auth(_state: &Arc<AppState>) -> Result<(), AppError> {
    Ok(())
}

/// Async privileged auth check -- now a no-op for local operations.
///
/// Google OAuth is optional; it only unlocks cloud features.
/// Use `require_cloud_auth` for cloud/remote commands.
pub async fn require_privileged(_state: &Arc<AppState>, _command: &str) -> Result<(), AppError> {
    Ok(())
}

/// Async auth check that actually enforces authentication.
/// Used only for cloud/remote commands (cloud_*, gitlab_*).
pub async fn require_cloud_auth(state: &Arc<AppState>, command: &str) -> Result<(), AppError> {
    let auth = state.auth.lock().await;

    let is_authenticated =
        auth.access_token.is_some() || (auth.is_offline && auth.user.is_some());

    if !is_authenticated {
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
// Frontend defense-in-depth: JS initialization script
// ---------------------------------------------------------------------------

/// JavaScript initialization script injected into the webview.
///
/// Google OAuth is optional -- it only gates cloud features.
/// This script only blocks cloud/remote commands when unauthenticated.
/// All local operations work without signing in.
/// The IPC auth script is now a no-op since Google OAuth is optional.
/// Cloud commands are guarded by `require_cloud_auth` on the backend.
/// The frontend sidebar disables the Cloud tab when not authenticated.
pub const IPC_AUTH_SCRIPT: &str = "/* ipc-auth: no-op -- auth is optional, cloud guards are backend-only */";

// ---------------------------------------------------------------------------
// Command tier classification
// ---------------------------------------------------------------------------

/// Commands that require cloud authentication (Google OAuth).
/// All other commands are local and work without signing in.
pub const CLOUD_COMMANDS: &[&str] = &[
    // Cloud execution & management
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
    // GitLab -- deploys code / manages remote agents
    "gitlab_connect",
    "gitlab_disconnect",
    "gitlab_get_config",
    "gitlab_list_projects",
    "gitlab_deploy_persona",
    "gitlab_list_agents",
    "gitlab_undeploy_agent",
    "gitlab_revoke_credentials",
];

/// Returns the authorization tier for a given command name.
///
/// Google OAuth is optional -- only cloud commands require it.
/// All local commands are public (no auth needed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthTier {
    /// No authentication required (all local commands).
    Local,
    /// Requires Google OAuth (cloud/remote commands only).
    Cloud,
}

pub fn command_tier(command: &str) -> AuthTier {
    if CLOUD_COMMANDS_SET.contains(command) {
        AuthTier::Cloud
    } else {
        AuthTier::Local
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_commands_are_local() {
        assert_eq!(command_tier("greet"), AuthTier::Local);
        assert_eq!(command_tier("get_auth_state"), AuthTier::Local);
        assert_eq!(command_tier("list_credentials"), AuthTier::Local);
        assert_eq!(command_tier("list_personas"), AuthTier::Local);
        assert_eq!(command_tier("execute_persona"), AuthTier::Local);
        assert_eq!(command_tier("execute_api_request"), AuthTier::Local);
    }

    #[test]
    fn cloud_commands_require_auth() {
        assert_eq!(command_tier("cloud_connect"), AuthTier::Cloud);
        assert_eq!(command_tier("cloud_execute_persona"), AuthTier::Cloud);
        assert_eq!(command_tier("gitlab_connect"), AuthTier::Cloud);
        assert_eq!(command_tier("gitlab_deploy_persona"), AuthTier::Cloud);
    }
}
