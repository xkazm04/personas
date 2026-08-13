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
// The counter itself lives in `personas_core::ipc_gauge` so `db` can poll it
// for a quiet maintenance window without depending on this module.
pub use personas_core::ipc_gauge::ipc_in_flight;

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

struct IpcInFlightGuard;

impl IpcInFlightGuard {
    fn new() -> Self {
        personas_core::ipc_gauge::enter();
        Self
    }
}

impl Drop for IpcInFlightGuard {
    fn drop(&mut self) {
        personas_core::ipc_gauge::leave();
    }
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
static PRIVILEGED_COMMANDS_SET: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| PRIVILEGED_COMMANDS.iter().copied().collect());

/// Returns true if the command requires IPC session token validation.
pub fn is_privileged_command(command: &str) -> bool {
    PRIVILEGED_COMMANDS_SET.contains(command) || CLOUD_COMMANDS_SET.contains(command)
}

/// Commands that require a valid IPC session token.
/// These are sensitive write/delete operations. Read-only commands that are
/// needed at startup (list_credentials, list_connectors, vault_status, etc.)
/// are intentionally PUBLIC so the app boots reliably on all platforms.
/// The IPC token monkey-patch has a race condition on Windows WebView2 where
/// the native bridge may not forward `Headers` objects before the patch fires.
pub const PRIVILEGED_COMMANDS: &[&str] = &[
    // Promoted 2026-08-13: each already carried #[requires(privileged)] but was
    // absent from this list, which for an async command is ZERO enforcement.
    // Verified before listing: none opens a native file dialog (the documented
    // WebView2 header-forwarding failure at the Data Portability note below),
    // and none is a boot-path call. tauriInvoke attaches x-ipc-token to every
    // invoke, so listing is safe for user-initiated commands.
    "add_mcp_gateway_member",
    "remove_mcp_gateway_member",
    "set_mcp_gateway_member_enabled",
    "cli_capture_save",
    "refresh_credential_cli_now",
    "deploy_automation",
    "n8n_create_workflow",
    "n8n_activate_workflow",
    "n8n_deactivate_workflow",
    "n8n_trigger_webhook",
    "github_create_patch_release",
    "invoke_tool_direct",
    "probe_mcp_server",
    "openapi_parse_from_url",
    "openapi_playground_test",
    "dry_run_trigger",
    "simulate_use_case",
    "set_use_case_enabled",
    "set_use_case_generation_settings",
    "rename_event_listeners",
    "cloud_sync_set_enabled",
    "discover_connector_resources",
    "execute_persona",
    // Credentials -- Write/Delete CRUD (reads are public)
    "create_credential",
    "update_credential",
    "patch_credential_metadata",
    "delete_credential",
    // Impact preview for `delete_credential` — enumerates the personas,
    // rotation policies and event triggers bound to a secret. A preview must
    // cost at least what the action costs; it was Public while the delete was
    // privileged, which made reconnaissance cheaper than the attack.
    "credential_blast_radius",
    "create_credential_event",
    "update_credential_event",
    "delete_credential_event",
    "migrate_plaintext_credentials",
    "update_credential_field",
    // Credentials -- Resource scoping (post-save sub-resource picker)
    "save_scoped_resources",
    "list_connector_resources",
    "set_credential_scope_enforcement",
    // Credentials -- Connectors (writes only; list/get are public)
    "create_connector",
    "update_connector",
    "delete_connector",
    // Credentials -- Healthcheck (uses live secrets to perform outbound HTTP;
    // not a startup-required read-only command, so safe to gate at the
    // wrapper level — also has body-level require_privileged for audit/depth)
    "healthcheck_credential",
    "healthcheck_credential_preview",
    "healthcheck_all_credentials",
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
    "get_rotation_history_bulk",
    "get_rotation_status",
    "get_all_rotation_statuses",
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
    "cancel_db_query",
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
    // `execute_api_request` / `get_api_proxy_metrics` / `save_api_definition`
    // are NOT listed here because the wrapper-level `x-ipc-token` check fails
    // intermittently on Windows WebView2 when the renderer batches several
    // privileged invokes during page initialisation (e.g. Project Overview
    // loading GitHub + Sentry stats in parallel). Their command bodies call
    // `require_privileged` (async) which still verifies the IPC security
    // system is initialised and emits an audit trace, so this is defense-in-
    // depth at the inner layer instead of the wrapper.
    // "execute_api_request",
    // "get_api_proxy_metrics",
    // "save_api_definition",
    "parse_api_definition",
    "load_api_definition",
    // Credentials -- OpenAPI Autopilot (sync commands carrying
    // `#[requires(privileged)]` that were missing from this list -- currently
    // unreachable, since neither is wired into `generate_handler!` yet, but a
    // sync privileged command missing here fails closed on every call the
    // moment it IS wired up, so it belongs here now per the invariant below).
    "openapi_parse_from_content",
    "openapi_generate_connector",
    // Credentials -- Dynamic discovery (adoption questionnaire)
    // NOT listed here because the wrapper-level header check fails
    // intermittently on Windows WebView2 (same race as the data-portability
    // commands below). The command body calls `require_privileged` for
    // defense-in-depth + audit logging, and the only data ever returned is
    // a list of resource names — credential secrets never leave the backend.
    // "discover_connector_resources",
    // Credentials -- MCP Tools
    "list_mcp_tools",
    "execute_mcp_tool",
    "healthcheck_mcp_preview",
    "get_mcp_pool_metrics",
    // Credentials -- Desktop Discovery
    "discover_desktop_apps",
    "discover_desktop_clis",
    "import_claude_mcp_servers",
    "get_desktop_connector_manifest",
    "get_pending_desktop_capabilities",
    "approve_desktop_capabilities",
    "revoke_desktop_approvals",
    "is_desktop_connector_approved",
    "register_imported_mcp_server",
    // System -- Claude Desktop MCP integration (writes attacker-controllable
    // JSON into Claude Desktop's global config; must be gated)
    "register_claude_desktop_mcp",
    "unregister_claude_desktop_mcp",
    "check_claude_desktop_mcp",
    // System -- Crash telemetry (read surfaces leak React error-boundary
    // stacks that often contain BYOM keys / passphrases; clear surfaces
    // can be used to wipe forensic evidence)
    "get_crash_logs",
    "clear_crash_logs",
    "get_log_directory_stats",
    "report_frontend_crash",
    "get_frontend_crashes",
    "clear_frontend_crashes",
    "get_frontend_crash_count",
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
    // External API keys (management HTTP API credentials surfaced in Settings →
    // API Keys). These call `require_privileged_sync` in their bodies, so the
    // wrapper MUST set the validated flag — without these entries every
    // settings load fails with "IPC authentication required for this operation".
    "create_external_api_key",
    "list_external_api_keys",
    "revoke_external_api_key",
    "delete_external_api_key",
    "get_system_api_key",
    "list_api_key_audit",
    "list_pending_pairings",
    "approve_pairing",
    "reject_pairing",
    "revoke_pairing",
    // Zero-Plaintext Broker (sync privileged commands — see warning below).
    "mint_credential_handle",
    "list_broker_consumers",
    "list_broker_consumer_activity",
    "revoke_broker_consumer",
    // Reversible Agent: undo mutates arbitrary allowlisted tables (sync
    // privileged command — body calls require_privileged_sync via the
    // #[requires(privileged)] macro, so it MUST be listed here).
    "undo_execution",
    // Execution -- create_execution carries `#[requires(privileged)]` but was
    // missing from this list. Currently unreachable (not wired into
    // `generate_handler!`), so no live call ever hit the always-fail-closed
    // path this omission produces on a registered sync command — listed here
    // to close the drift before it is ever wired up.
    "create_execution",
    // Provider usage audit + health bundle. These are SYNC commands whose
    // bodies call `require_privileged_sync`, which hard-requires the wrapper's
    // thread-local validation flag — and the wrapper only validates commands
    // on THIS list. A sync `#[requires(privileged)]` command that is missing
    // here fails closed on EVERY IPC call (observed live 2026-07-14: 78
    // "without IPC validation flag" log entries for get_provider_usage_stats /
    // get_health_bundle — provider stats never loaded in the health dashboard,
    // the true root of the "Incomplete health data" banner). The async
    // `require_privileged` tolerates absence (portability compromise below);
    // the sync one does not. If you add a sync privileged command, ADD IT HERE.
    "get_provider_usage_stats",
    "get_provider_usage_timeseries",
    "list_provider_audit_log",
    "list_provider_audit_by_persona",
    "get_health_bundle",
    // Signing
    "sign_document",
    "verify_document",
    // Artist -- Transcription (reads/writes user-supplied media paths; gated to
    // catch renderer-context exploits steering the file_path arg at sensitive files)
    "artist_transcribe_media",
    "artist_load_transcript",
    // Artist -- ffmpeg surface (every command spawns ffmpeg/ffprobe with
    // user-controllable paths and is therefore a subprocess-spawn + arbitrary-
    // path read/write primitive; must require IPC privilege)
    "artist_check_ffmpeg",
    "artist_probe_media",
    "artist_compile_render_plan",
    "artist_export_composition",
    "artist_extract_audio",
    "artist_save_thumbnail",
    "artist_measure_loudness",
    "artist_trim_file",
    "artist_cancel_export",
    // Artist -- Composition persistence (writes/reads a caller-supplied absolute
    // file_path; without gating any IPC caller could overwrite an arbitrary file).
    "artist_save_composition",
    "artist_load_composition",
    "artist_autosave_composition",
    // ...and the destructive members of the same surface, which were the only
    // artist commands left ungated: `artist_delete_asset` unlinks a file from
    // disk and drops a row whose delete cascades to `artist_tags`;
    // `artist_clear_autosave` destroys the user's unsaved composition.
    "artist_delete_asset",
    "artist_clear_autosave",
    // Drive -- the managed-sandbox recursive-destroy primitive. `resolve_safe`
    // constrains WHAT it can address; this entry constrains WHO may call it.
    // A second call on a `.trash/` path hard-deletes.
    "drive_delete",
    // Fleet -- `Registry::remove` drops ANY session row, including one holding
    // a live PTY child (the liveness-checked variant is `forget_dead`).
    // Removing a live row orphans a running Claude Code process.
    "fleet_remove_session",
    // Auth -- clears the RFC 6749 §10.12 OAuth CSRF nonce. Not a CSRF bypass
    // (the callback fails closed when no nonce is pending) but a denial of
    // login, and it releases the "sign-in already in progress" interlock.
    "clear_pending_oauth",
    // Scraper -- destroys a saved scrape config together with its cron
    // schedule. No undo.
    "scraper_delete_config",
    // Persona icon generation -- decrypts a vault credential and spends the
    // user's image-gen API key, so it must be privileged like other secret-using
    // commands (its sibling `list_image_gen_credentials` is read-only metadata).
    "generate_persona_icon",
    // ...and its delete counterpart, which removes the icon file AND runs an
    // unscoped `UPDATE personas SET icon = ''` over every persona using it.
    "delete_persona_icon",
    // Network -- Persona bundle export/import (file + clipboard) + share link
    // + enclave seal. Every entry here reads/writes a caller-supplied file
    // path, clipboard payload, or persona secret bundle, and all but
    // `import_from_share_link` carry `#[requires(privileged)]` (that one
    // calls `require_privileged_sync` directly in its body, before any
    // `.await`, so the thread-local flag is still reliable). All seven were
    // missing from this list — a LIVE bug: every call from
    // `src/api/network/bundle.ts` / `enclave.ts` failed closed with "IPC
    // authentication required for this operation" (the same drift mode
    // documented above for `get_provider_usage_stats`).
    "export_persona_bundle",
    "apply_bundle_import",
    "export_bundle_to_clipboard",
    "apply_bundle_from_clipboard",
    "create_share_link",
    "import_from_share_link",
    "seal_enclave",
    // Data Portability — NOT in PRIVILEGED_COMMANDS because the wrapper-level
    // header check fails intermittently on Windows WebView2 (the monkey-patch
    // may not reliably forward headers for commands that open native file dialogs).
    // These commands have `require_privileged` / `require_auth` inside their
    // function bodies as defense-in-depth.
    // "export_credentials",
    // "import_credentials",
    // "export_full",
    // "import_portability_bundle",
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
                "Cloud features are unavailable in offline mode. Reconnect to use this feature."
                    .into(),
            ));
        }
        tracing::warn!(command = command, "Blocked unauthenticated cloud IPC call");
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
        let _in_flight = IpcInFlightGuard::new();
        let cmd = invoke.message.command().to_string();

        if is_privileged_command(&cmd) {
            // Extract and validate the IPC session token from headers
            let token_valid = match IPC_SESSION_TOKEN.get() {
                Some(expected) => match invoke.message.headers().get("x-ipc-token") {
                    Some(provided) => match provided.to_str() {
                        Ok(provided_str) => constant_time_eq(provided_str, expected),
                        Err(_) => false,
                    },
                    None => false,
                },
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
/// The token is exposed as `window.__IPC_TOKEN` so the frontend
/// `invokeWithTimeout` wrapper can inject it explicitly as a fallback when the
/// `__TAURI_INTERNALS__.invoke` monkey-patch races with the first privileged
/// call (observed on Windows WebView2). CSP + the wrapper-level validation
/// still gate abuse.
pub fn generate_ipc_auth_script(token: &str) -> String {
    // Monkey-patch __TAURI_INTERNALS__.invoke if it's already available,
    // and set up a retry for when it appears later
    // (Tauri 2.x init script timing: internals may not exist yet).
    // We ALSO assign the token to `window.__IPC_TOKEN` so the frontend
    // wrapper can inject the header itself when the monkey-patch is late --
    // both paths must attach the token, otherwise privileged calls like
    // `create_credential` reject with "IPC authentication failed".
    format!(
        r#"(function() {{
  'use strict';
  var _t = '{}';
  try {{ window.__IPC_TOKEN = _t; }} catch(_e) {{}}
  function patchInvoke() {{
    if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return false;
    if (window.__TAURI_INTERNALS__.__ipc_patched) return true;
    try {{
      var _orig = window.__TAURI_INTERNALS__.invoke;
      // Property may be read-only (frozen object) in newer WebView2/Tauri.
      // Try direct assignment first, fall back to defineProperty.
      try {{
        window.__TAURI_INTERNALS__.invoke = function(cmd, args, options) {{
          var opts = options || {{}};
          var h = new Headers(opts.headers || {{}});
          h.set('x-ipc-token', _t);
          opts.headers = h;
          return _orig.call(this, cmd, args, opts);
        }};
      }} catch(_e) {{
        Object.defineProperty(window.__TAURI_INTERNALS__, 'invoke', {{
          value: function(cmd, args, options) {{
            var opts = options || {{}};
            var h = new Headers(opts.headers || {{}});
            h.set('x-ipc-token', _t);
            opts.headers = h;
            return _orig.call(this, cmd, args, opts);
          }},
          writable: true,
          configurable: true
        }});
      }}
      window.__TAURI_INTERNALS__.__ipc_patched = true;
      return true;
    }} catch(_e) {{
      return true; // Give up patching — IPC token is still injected via header
    }}
  }}
  if (!patchInvoke()) {{
    // Retry until __TAURI_INTERNALS__ becomes available.
    // Use 10ms interval (fast) with 200 tries (2s max) so the patch
    // is applied before any JS invoke() call fires.
    var tries = 0;
    var iv = setInterval(function() {{
      if (patchInvoke() || ++tries > 200) clearInterval(iv);
    }}, 10);
  }}
}})();"#,
        token
    )
}

// ---------------------------------------------------------------------------
// Cloud command tier classification (unchanged)
// ---------------------------------------------------------------------------

/// Static HashSet for O(1) cloud command lookup.
static CLOUD_COMMANDS_SET: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| CLOUD_COMMANDS.iter().copied().collect());

/// Commands that require cloud authentication (Google OAuth).
/// Read-only config/status checks (cloud_get_config, cloud_status,
/// gitlab_get_config) are public to allow startup without auth.
pub const CLOUD_COMMANDS: &[&str] = &[
    // Promoted 2026-08-13 — same reasoning as the PRIVILEGED block above.
    "remote_command_approve",
    "remote_command_reject",
    "cloud_sync_persona",
    "cloud_adopt_deployment",
    "cloud_sync_now",
    "cloud_connect",
    "cloud_reconnect_from_keyring",
    "cloud_disconnect",
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
    // C7 — `smee_relay_list` removed from cloud commands. It's a read-only
    // DB query equivalent to `list_credentials` / `list_connectors`, both
    // of which are Public tier. Inner handler still calls `require_auth`.
    "smee_relay_create",
    "smee_relay_update",
    "smee_relay_set_status",
    // C7 — `smee_relay_delete` removed from cloud commands. Local DB
    // delete with `require_auth`; smee.io is account-less so no OAuth.
    // Stays under the IPC token gate via the PRIVILEGED list below.
    // GitLab (gitlab_get_config is public — read-only startup check)
    "gitlab_connect",
    "gitlab_connect_from_vault",
    "gitlab_disconnect",
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
        // execute_persona was asserted Public here purely because it was
        // missing from PRIVILEGED_COMMANDS — a description of the drift, not a
        // requirement. Its own #[requires(privileged)] attribute is the stated
        // intent, and it spends money. Promoted 2026-08-13.
        assert_eq!(command_tier("execute_persona"), AuthTier::Privileged);
    }

    #[test]
    fn privileged_commands_require_token() {
        // Write/delete operations are privileged
        assert_eq!(command_tier("create_credential"), AuthTier::Privileged);
        assert_eq!(command_tier("delete_credential"), AuthTier::Privileged);
        assert_eq!(
            command_tier("scan_credential_sources"),
            AuthTier::Privileged
        );
        // `execute_api_request` deliberately omitted from PRIVILEGED_COMMANDS — see the
        // commented entry in the list. The inner async `require_privileged` covers it.
        assert_eq!(command_tier("execute_api_request"), AuthTier::Public);
        assert_eq!(command_tier("sign_document"), AuthTier::Privileged);
        // Healthcheck commands trigger outbound HTTP using live secrets,
        // so they require the IPC session token even though their callers
        // (status pages) feel read-only.
        assert_eq!(
            command_tier("healthcheck_credential"),
            AuthTier::Privileged
        );
        assert_eq!(
            command_tier("healthcheck_credential_preview"),
            AuthTier::Privileged
        );
        // Writing into Claude Desktop's global mcpServers config is a host-level
        // change that must require IPC privilege.
        assert_eq!(
            command_tier("register_claude_desktop_mcp"),
            AuthTier::Privileged
        );
        assert_eq!(
            command_tier("unregister_claude_desktop_mcp"),
            AuthTier::Privileged
        );
    }

    #[test]
    fn read_only_commands_are_public() {
        // Read-only startup commands are public (no IPC token required)
        assert_eq!(command_tier("list_credentials"), AuthTier::Public);
        assert_eq!(command_tier("list_connectors"), AuthTier::Public);
        assert_eq!(command_tier("vault_status"), AuthTier::Public);
        assert_eq!(command_tier("gitlab_get_config"), AuthTier::Public);
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
        assert!(is_privileged_command("create_credential"));
        assert!(is_privileged_command("cloud_connect"));
        assert!(!is_privileged_command("list_credentials"));
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

    // -----------------------------------------------------------------------
    // Registry-drift guard
    // -----------------------------------------------------------------------
    //
    // The `#[requires(privileged)]` macro (src-tauri/macros) and
    // PRIVILEGED_COMMANDS above are two independent sources of truth that must
    // agree for every SYNC command: `require_privileged_sync` hard-fails
    // unless the wrapper already set the thread-local validation flag, and the
    // wrapper only does that for commands on this list. A sync command
    // annotated `#[requires(privileged)]` (or calling `require_privileged_sync`
    // directly before its first `.await`) but missing from PRIVILEGED_COMMANDS
    // fails closed on EVERY call — this is exactly what happened live on
    // 2026-07-14 with `get_provider_usage_stats` / `get_health_bundle`, and
    // (discovered while writing this test) with the persona-bundle
    // export/import, clipboard, share-link, and enclave-seal commands, whose
    // frontend callers (`src/api/network/bundle.ts`, `enclave.ts`) were
    // silently broken the same way until this pass added them above.
    //
    // Async commands are exempt: `require_privileged` (the async guard) does
    // NOT check the thread-local flag (unreliable across tokio task
    // migration), so an async command's absence from this list is tolerated
    // by design (see the `execute_api_request` precedent above).

    /// Extract the command name from a `pub fn NAME(` / `pub async fn NAME(`
    /// signature line. Returns `None` (async) when the line is async.
    fn sync_fn_name(sig_line: &str) -> Option<&str> {
        let trimmed = sig_line.trim();
        if trimmed.starts_with("pub async fn ") {
            return None;
        }
        let rest = trimmed.strip_prefix("pub fn ")?;
        let name_end = rest.find(['(', '<', ' ']).unwrap_or(rest.len());
        let name = &rest[..name_end];
        (!name.is_empty()).then_some(name)
    }

    /// Extract the command name from a direct
    /// `require_privileged_sync(&state, "name")` call (used by the handful of
    /// commands that call the guard in their body instead of via the macro,
    /// e.g. `import_from_share_link`). Skips comments and the guard's own
    /// definition.
    fn direct_call_command(line: &str) -> Option<&str> {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") || trimmed.starts_with("pub fn require_privileged_sync") {
            return None;
        }
        let idx = line.find("require_privileged_sync(&state,")?;
        let after = &line[idx..];
        let q1 = after.find('"')? + 1;
        let after_q1 = &after[q1..];
        let q2 = after_q1.find('"')?;
        Some(&after_q1[..q2])
    }

    fn scan_file(path: &std::path::Path, missing: &mut Vec<String>, checked: &mut usize) {
        let Ok(content) = std::fs::read_to_string(path) else {
            return;
        };
        let lines: Vec<&str> = content.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim() == "#[requires(privileged)]" {
                // The macro attribute is always immediately followed by the
                // `pub fn` / `pub async fn` signature line, with no other
                // attributes in between (verified across all call sites).
                if let Some(sig_line) = lines.get(i + 1) {
                    if let Some(name) = sync_fn_name(sig_line) {
                        *checked += 1;
                        if !PRIVILEGED_COMMANDS_SET.contains(name) {
                            missing.push(format!("{name} ({}:{})", path.display(), i + 2));
                        }
                    }
                }
            } else if let Some(name) = direct_call_command(line) {
                *checked += 1;
                if !PRIVILEGED_COMMANDS_SET.contains(name) {
                    missing.push(format!("{name} (direct call, {}:{})", path.display(), i + 1));
                }
            }
        }
    }

    fn scan_dir(dir: &std::path::Path, missing: &mut Vec<String>, checked: &mut usize) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_dir(&path, missing, checked);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                scan_file(&path, missing, checked);
            }
        }
    }

    #[test]
    fn all_sync_requires_privileged_commands_are_registered() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut missing = Vec::new();
        let mut checked = 0usize;
        scan_dir(&root, &mut missing, &mut checked);
        assert!(
            checked > 50,
            "expected to scan well over 50 `#[requires(privileged)]`/direct-call \
             sites, only found {checked} — the source walk is probably broken \
             (check CARGO_MANIFEST_DIR / directory layout), not that the app shrank"
        );
        assert!(
            missing.is_empty(),
            "sync privileged commands missing from PRIVILEGED_COMMANDS: {missing:#?}\n\
             A sync privileged command not in this list fails closed on EVERY \
             call (require_privileged_sync hard-requires the wrapper's \
             thread-local flag, which the wrapper only sets for commands on \
             this list) — add each one to PRIVILEGED_COMMANDS above."
        );
    }

    // ── Async annotation drift ──────────────────────────────────────────
    //
    // The sibling test above walks `require_privileged_sync` CALL SITES, so it
    // only ever sees sync commands. That blind spot is not cosmetic: for a sync
    // command, annotated-but-unlisted fails closed on every call and someone
    // notices. For an ASYNC command it is ZERO enforcement — `require_privileged`
    // merely checks the session token exists at boot and returns Ok(()), and
    // `require_auth` / `require_auth_sync` are unconditional Ok(()). So an async
    // command can carry `#[requires(privileged)]`, be absent from the list, and
    // be silently public.
    //
    // This test walks the ANNOTATIONS instead — both tiers, sync and async.

    /// Commands annotated but not listed as of 2026-08-13, with the reason each
    /// is tolerated. **This list may only shrink.** A new annotated-but-unlisted
    /// command fails the test; removing an entry means either listing the command
    /// or deleting a wrong annotation.
    ///
    /// Deliberately NOT bulk-listed: adding a name to PRIVILEGED_COMMANDS makes
    /// the command fail closed without a session token, so a wrong entry breaks a
    /// live feature. Each OWED entry needs its UI call path verified first.
    const DRIFT_BASELINE: &[(&str, &str)] = &[
        // — read-only; the annotation is arguably the wrong tier —
        ("list_mcp_gateway_members", "read-only listing"),
        ("count_event_listeners", "read-only count"),
        ("get_use_case_cascade", "read-only read"),
        ("github_list_repos", "read-only listing"),
        ("n8n_list_workflows", "read-only listing"),
        ("cloud_sync_status", "read-only status"),
        ("github_check_permissions", "read-only probe"),
        ("get_simulation_artefacts", "read-only read"),
        ("remote_command_list_pending", "read-only listing"),
        ("cloud_get_config", "read-only config read"),
        ("cloud_diagnose", "read-only diagnostic"),
        ("cloud_status", "read-only status"),
        ("gitlab_get_config", "read-only config read"),
        ("gitlab_deployment_status", "read-only status"),
        ("list_deployment_history_all", "read-only listing"),
        // — sensitive writes that SHOULD be listed; verify the UI call path
        //   carries the IPC token before listing, or the feature breaks —
        ("import_portability_bundle_from_path", "OWED: bulk import"),
        // — deliberate exclusions, documented at ipc_auth.rs:396: the wrapper
        //   already gates these and listing them would double-guard —
        ("export_credentials", "deliberate: wrapper-level gate, see :396"),
        ("import_credentials", "deliberate: wrapper-level gate, see :396"),
        ("export_full", "deliberate: wrapper-level gate, see :396"),
        ("import_portability_bundle", "deliberate: wrapper-level gate, see :396"),
        ("get_api_proxy_metrics", "OWED: verify tier"),
        // — deliberate exclusions (ipc_auth.rs:245-252): the wrapper x-ipc-token
        //   check fails intermittently on Windows WebView2 when the renderer
        //   BATCHES several privileged invokes during page init. Their bodies call
        //   async require_privileged, which verifies init and emits an audit trace
        //   but does NOT authorize — audit depth, not access control. —
        ("execute_api_request", "deliberate: WebView2 batched-invoke race, see :245"),
        ("save_api_definition", "deliberate: WebView2 batched-invoke race, see :245"),
        // — OPERATOR DECISION REQUIRED —
    ];

    fn scan_annotations(dir: &std::path::Path, found: &mut Vec<(String, String)>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_annotations(&path, found);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                let Ok(text) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let lines: Vec<&str> = text.lines().collect();
                for (i, line) in lines.iter().enumerate() {
                    let tier = if line.contains("#[requires(privileged)]") {
                        "privileged"
                    } else if line.contains("#[requires(cloud)]") {
                        "cloud"
                    } else {
                        continue;
                    };
                    for probe in lines.iter().skip(i + 1).take(5) {
                        let trimmed = probe.trim();
                        let rest = trimmed
                            .strip_prefix("pub async fn ")
                            .or_else(|| trimmed.strip_prefix("pub fn "));
                        if let Some(rest) = rest {
                            let name: String = rest
                                .chars()
                                .take_while(|c| c.is_alphanumeric() || *c == '_')
                                .collect();
                            if !name.is_empty() {
                                found.push((name, tier.to_string()));
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn every_requires_annotation_is_listed_or_baselined() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = Vec::new();
        scan_annotations(&root, &mut found);

        // Assert the INSTRUMENT before the result. A walk that silently matched
        // nothing would otherwise report perfect compliance — the exact failure
        // shape this repo keeps shipping (golden-path-contract.md section 9).
        assert!(
            found.len() > 150,
            "expected well over 150 `#[requires(...)]` annotations, found {} — the \
             source walk is broken, not the codebase suddenly clean",
            found.len()
        );

        let baselined: std::collections::HashSet<&str> =
            DRIFT_BASELINE.iter().map(|(n, _)| *n).collect();

        let mut unlisted: Vec<String> = found
            .iter()
            .filter(|(name, _)| {
                !PRIVILEGED_COMMANDS.contains(&name.as_str())
                    && !CLOUD_COMMANDS.contains(&name.as_str())
                    && !baselined.contains(name.as_str())
            })
            .map(|(name, tier)| format!("{name} (#[requires({tier})])"))
            .collect();
        unlisted.sort();
        unlisted.dedup();
        assert!(
            unlisted.is_empty(),
            "These commands carry a `#[requires(...)]` attribute but appear in \
             neither PRIVILEGED_COMMANDS nor CLOUD_COMMANDS. For an ASYNC command \
             that is ZERO enforcement, not a missing signal. Add each to the \
             correct list, or remove the wrong annotation:\n  {}",
            unlisted.join("\n  ")
        );

        // The baseline may only shrink: an entry now listed, or no longer
        // annotated, is stale and must be deleted from it.
        let annotated: std::collections::HashSet<&str> =
            found.iter().map(|(n, _)| n.as_str()).collect();
        let stale: Vec<&str> = DRIFT_BASELINE
            .iter()
            .map(|(n, _)| *n)
            .filter(|n| {
                !annotated.contains(n)
                    || PRIVILEGED_COMMANDS.contains(n)
                    || CLOUD_COMMANDS.contains(n)
            })
            .collect();
        assert!(
            stale.is_empty(),
            "DRIFT_BASELINE entries are resolved (listed, or no longer annotated). \
             Delete them — the baseline may only shrink:\n  {}",
            stale.join("\n  ")
        );
    }
}
