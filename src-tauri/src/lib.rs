pub mod background_job;
pub mod bench;
/// The backend boot sequence — the `.setup(...)` hook, split into named
/// phase functions. Moved out of `run()` in W1; the call order inside is an
/// invariant (see the module docs).
mod boot;
mod browser_bridge;
mod cloud;
mod commands;
mod companion;
/// The `personas-memory-sim` driver, for the `memory-year` benchmark harness.
///
/// `mod companion` is private, and the driver's whole job is to reach into it,
/// so the binary target cannot get there on its own. Feature-gated and exported
/// as a single item rather than opening the module — the same shape
/// `athena-bench-validate` takes through `pub mod bench`.
#[cfg(feature = "memory-sim")]
pub use companion::brain::memory_sim;
pub mod daemon;
// The data layer is its own crate (see src-tauri/db/). Re-exported under the
// old name so every `crate::db::…` path across commands, engine and companion
// resolves unchanged — the split moved 84k LOC out of this crate without
// touching a single call site.
pub use personas_db as db;
mod engine;
pub use commands::eval_runs;
pub use engine::provider::EngineKind;
pub use personas_core::error;
pub mod freeze_monitor;
mod gitlab;
pub mod ipc_auth;
/// The IPC command registration lists and the router over them.
mod ipc_shards;
pub mod keyed_pool;
mod local_http;
mod logging;
/// MCP tool implementations (also compiled into the `personas-mcp` binary).
/// Exposed from the lib so the split engine can call tools in-process.
pub mod mcp_server;
mod notifications;
/// Active-process / run bookkeeping for CLI-backed commands.
/// Moved out of the crate root in W1; re-exported below so every existing
/// `crate::ActiveProcessRegistry` path resolves unchanged.
pub mod process_registry;
pub use process_registry::{ActiveProcess, ActiveProcessRegistry, RunEntry, RunGuard};
mod radio;
/// Shared application state (`AppState`). Moved out of the crate root in W1;
/// re-exported below so every existing `crate::AppState` path resolves
/// unchanged.
pub mod state;
/// Unified retrieval lane — shared, pure retrieval primitives (distance
/// floor, hybrid lane ranking, excerpt-vs-full-body decision) extracted from
/// the companion brain. `pub` so the primitives are part of the lib surface
/// (companion consumes them today; persona-memory injection is the documented
/// next consumer — see the module docs).
/// Re-exported from `personas-core` (see `src-tauri/core/`). Physically moved
/// there as step 1 of the crate split; re-exporting keeps every existing
/// `crate::retrieval::…` path resolving, so the move touched 3 files instead
/// of the ~849 that reference these modules.
pub use personas_core::retrieval;
pub use state::AppState;
// Not feature-gated: the harness needs no optional dependency (std, tokio,
// serde, tauri and the fleet types), and `test_automation` calls into it
// unconditionally from four HTTP handlers whose routes are always registered.
// Gating it behind `test-automation` - a feature that exists to pull in the
// screenshot deps `xcap` and `image` - made `cargo test --features desktop`,
// which is what CI runs, fail to compile.
pub mod load_harness;
// Ungated for the same reason as `load_harness` above: it is called from there
// unconditionally. The INJECTION HOOKS that read it (in `commands::teams::
// team_channel` and `commands::design::reviews`) stay compile-gated on
// `test-automation`, so no shipped binary contains a path that can splice
// synthetic rows into a channel or a review queue.
pub mod load_harness_sources;
pub mod startup_timing;
#[cfg(debug_assertions)]
mod stream_harness;
pub mod test_automation;
#[cfg(feature = "desktop")]
mod tray;
pub use personas_core::utils;
// Moved to `personas-core` (crate-split step 3) — `db::models` validates
// through it, so it had to sit below the data layer.
pub use personas_core::validation;
// `declare_lifecycle!` is `#[macro_export]`ed from `personas_core::lifecycle`,
// which lands it at that crate's root. Re-export so `crate::declare_lifecycle!`
// keeps working (engine::process_session is the remaining caller here).
pub use personas_core::declare_lifecycle;
mod webbuild;

use std::sync::Arc;

use tauri::Manager;

// The process-wide HTTP clients live in `personas_core::http_clients` — engine
// call sites use them, and a `LazyLock` at this crate's root is unreachable
// from any crate below. Re-exported so `crate::SHARED_HTTP` and friends keep
// resolving.
//
// HTTP_ALLOW_PRIVATE is deliberately NOT re-exported: its three callers
// (engine/api_proxy.rs, engine/healthcheck.rs, engine/resource_listing.rs) all
// spell the full personas_core path, so the re-export resolved for nobody. Add
// it back in the same change that adds a `crate::`-qualified caller.
pub(crate) use personas_core::http_clients::{SHARED_HTTP, SSRF_SAFE_HTTP};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup_timing::mark_process_start();

    // Prevent ort/ONNX from finding a stale system-wide onnxruntime.dll (e.g. in System32).
    // The ort crate panics if the DLL version doesn't match its expected version.
    // By setting ORT_DYLIB_PATH to a non-existent file, ort will fail to load the DLL
    // gracefully instead of finding the wrong system DLL and panicking.
    if std::env::var_os("ORT_DYLIB_PATH").is_none() {
        let sentinel = dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("com.personas.desktop")
            .join("lib")
            .join("onnxruntime.dll");
        std::env::set_var("ORT_DYLIB_PATH", &sentinel);
    }

    // Load .env file (project root) into process environment so that
    // runtime env vars like SUPABASE_URL are available without needing
    // them baked in at compile time.
    dotenvy::dotenv().ok();

    logging::init();

    tracing::info!("Starting Personas Desktop v{}", env!("CARGO_PKG_VERSION"));

    // Resolve and announce the headless bridge test mode BEFORE anything can
    // read the flag. The gate latches on this call, so an env var set later in
    // the process (a plugin, a test helper) cannot turn it on.
    // docs/architecture/cloud-integration-bridge.md §13.
    personas_engine::headless::warn_at_boot();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    // Desktop-only plugins
    #[cfg(feature = "desktop")]
    {
        // Only enforce single-instance in release builds so dev and production
        // can run side by side on the same machine.
        #[cfg(not(debug_assertions))]
        {
            builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
                tracing::info!("Single-instance callback fired, argv: {:?}", argv);
            }));
        }

        builder = builder
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            // No accelerator is bound here — the binding is a persisted user
            // setting and the frontend pushes it down via
            // `companion_set_voice_hotkey` once the store hydrates.
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            // Native drag-out for the Drive finder (`drive_abs_paths` hands it
            // the OS paths). Desktop-only: the `drag` crate has no mobile backend.
            .plugin(tauri_plugin_drag::init());
    }

    // Generate IPC session token for privileged command validation
    let ipc_token = ipc_auth::generate_ipc_session_token();
    ipc_auth::init_session_token(ipc_token.clone());
    let ipc_auth_script = ipc_auth::generate_ipc_auth_script(&ipc_token);
    tracing::info!("IPC session token initialised (privileged commands protected)");

    // Inject a flag before page JS so the frontend knows this build's
    // automation bridge is open — it loads the perf instrument off it, and the
    // Activity board shows its Simulation toggle only when it is set.
    //
    // TWO WAYS THE BRIDGE OPENS, and this only checked one until 2026-09-07.
    // `PERSONAS_TEST_PORT` names a port (launch-isolated, e2e), and
    // `--features test-automation` starts the server on :17320 with no env var
    // at all — see `boot::test_bridge`, which has always honoured both. That
    // second case is exactly what `npm run tauri:dev:test` builds, so the build
    // made FOR driving the UI was the one whose frontend could not tell.
    let test_port = test_automation::env_test_port();
    let bridge_open = test_port.is_some() || cfg!(feature = "test-automation");
    let mut final_builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("ipc-auth")
            .js_init_script(ipc_auth_script)
            .build(),
    );
    if bridge_open {
        final_builder = final_builder.plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("test-mode-flag")
                .js_init_script(String::from("window.__PERSONAS_TEST_MODE__ = true;"))
                .build(),
        );
    }

    // Phase 1 diagnostic for idea-7452b77e: registers `stream-test://` so a
    // dev-only frontend harness can measure whether the WebView's URL loader
    // delivers a large response body incrementally or atomically. Compiled
    // only in debug builds.
    #[cfg(debug_assertions)]
    {
        final_builder = final_builder
            .register_asynchronous_uri_scheme_protocol("stream-test", stream_harness::handle);
    }

    final_builder
        .setup(boot::setup)
        .invoke_handler(ipc_auth::wrap_invoke_handler(ipc_shards::handler()))
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            // Deliberately NOT `tracing::error!`: the next statement is
            // `process::exit(1)`, which runs no destructors, so a buffered
            // subscriber would never flush this. stderr is the only sink
            // guaranteed to carry a message out of a failed startup.
            #[allow(clippy::print_stderr)]
            {
                eprintln!("Fatal: Tauri application failed to start: {e}");
            }
            std::process::exit(1);
        })
        .run(|app_handle, event| {
            // Kill any running Bun dev servers when the app exits so a closing
            // app never orphans a `bun`/`next` process tree (web-build runtime).
            if matches!(event, tauri::RunEvent::Exit) {
                // The loopback bridge's `{port, token, pid}` handshake must not
                // outlive the process that wrote it: a stale one reads to a
                // terminal caller as a live server refusing its token.
                local_http::clear_handshake();
                // Athena's warm per-conversation CLI processes live in a static
                // registry that is never dropped, so `kill_on_drop` cannot reach
                // them; end them here or they outlive the app.
                companion::session::kill_all_warm_sessions();
                if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                    state.webbuild_servers.stop_all();

                    // LAST, after the teardown above, and never optimistically:
                    // absence of this marker is the crash signal the next boot
                    // reads (`boot::recovery`), so writing it before the drain
                    // completes would be a claim about a shutdown that had not
                    // happened yet. `RunEvent::Exit` does not fire on SIGKILL,
                    // power loss or a Windows force-quit — which is the point:
                    // those are exactly the exits that must read as crashes.
                    personas_core::shutdown_marker::record_clean_shutdown(
                        state.leadership.app_data_dir(),
                    );
                }
            }
        });
}

#[cfg(test)]
mod registry_target_tests {
    use super::ActiveProcessRegistry;

    // Pins the fix for "delete_recipe blocks all recipes during any in-flight
    // task": a run's target resource id is tracked so conflict checks scope to
    // the actually-targeted recipe, not "any run in this domain".

    #[test]
    fn active_target_returns_target_only_while_run_is_active() {
        let reg = ActiveProcessRegistry::new();
        // No run yet → no target.
        assert_eq!(reg.active_target("recipe_execution"), None);

        reg.set_id("recipe_execution", "task-1".into());
        reg.set_target("recipe_execution", Some("recipe-A".into()));
        assert_eq!(
            reg.active_target("recipe_execution").as_deref(),
            Some("recipe-A")
        );
    }

    #[test]
    fn unrelated_recipe_run_does_not_match_a_different_recipe() {
        let reg = ActiveProcessRegistry::new();
        reg.set_id("recipe_execution", "task-1".into());
        reg.set_target("recipe_execution", Some("recipe-A".into()));

        // Deleting recipe-B must not see a conflict from a run targeting recipe-A.
        let blocks_b = reg.active_target("recipe_execution").as_deref() == Some("recipe-B");
        assert!(
            !blocks_b,
            "a run for recipe-A must not block deleting recipe-B"
        );
    }

    #[test]
    fn clearing_the_id_also_clears_the_target() {
        let reg = ActiveProcessRegistry::new();
        reg.set_id("recipe_versioning", "task-1".into());
        reg.set_target("recipe_versioning", Some("recipe-A".into()));

        // Completion path clears the id when it matches.
        reg.clear_id_if("recipe_versioning", "task-1");
        assert_eq!(reg.active_target("recipe_versioning"), None);

        // Cancellation path (take_id) also clears the target.
        reg.set_id("recipe_versioning", "task-2".into());
        reg.set_target("recipe_versioning", Some("recipe-B".into()));
        assert_eq!(reg.take_id("recipe_versioning").as_deref(), Some("task-2"));
        assert_eq!(reg.active_target("recipe_versioning"), None);
    }

    #[test]
    fn generation_without_a_target_never_reports_a_conflict() {
        let reg = ActiveProcessRegistry::new();
        // recipe_generation produces a brand-new recipe and sets no target.
        reg.set_id("recipe_generation", "gen-1".into());
        assert_eq!(reg.active_target("recipe_generation"), None);
    }
}
