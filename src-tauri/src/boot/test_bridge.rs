//! Boot phase: the test-automation HTTP bridge.

use tauri::Manager;

use crate::test_automation;

// Test automation HTTP server.
//
// Bind happens synchronously here so an EADDRINUSE failure is logged
// with the actual port immediately — instead of letting the test
// harness time out polling a server that never started. Setup is
// not aborted on bind failure: the server is non-critical and the
// rest of the app should still come up.
pub fn start_test_automation_server(app: &tauri::App) {
    {
        let pending = app
            .state::<test_automation::PendingResponses>()
            .inner()
            .clone();
        let handle = app.handle().clone();

        // Dev mode (`--features test-automation`): always on, default
        // :17320 — but still let PERSONAS_TEST_PORT override it so a
        // second instance on one device (parallel-CLI / multi-driver,
        // ADR 2026-05-26) gets a DETERMINISTIC distinct bridge port
        // instead of relying on the EADDRINUSE fallback scan.
        #[cfg(feature = "test-automation")]
        let requested_port = Some(
            test_automation::env_test_port()
                .inspect(|port| {
                    tracing::info!(
                        "test-automation bridge port overridden via PERSONAS_TEST_PORT={}",
                        port
                    );
                })
                .unwrap_or(test_automation::DEFAULT_PORT),
        );

        // Without the compile feature, the env override only works in
        // DEBUG builds. Release installers must never expose the
        // bridge: it has no auth and its routes include /eval
        // (arbitrary JS in the webview) and /list-credentials, so an
        // env var alone must not be able to open it on an end user's
        // machine (ship-loop security audit 2026-07-02). Every
        // harness flow (tauri:dev:test, launchIsolated, e2e) runs
        // debug builds and keeps working.
        #[cfg(all(not(feature = "test-automation"), debug_assertions))]
        let requested_port = test_automation::env_test_port().inspect(|port| {
            tracing::info!("Debug test mode enabled via PERSONAS_TEST_PORT={}", port);
        });

        #[cfg(all(not(feature = "test-automation"), not(debug_assertions)))]
        let requested_port: Option<u16> = {
            if test_automation::env_test_port().is_some() {
                tracing::warn!(
                    "PERSONAS_TEST_PORT is set but ignored: the test-automation bridge is disabled in release builds (build with --features test-automation for a bridged build)"
                );
            }
            None
        };

        if let Some(port) = requested_port {
            match tauri::async_runtime::block_on(test_automation::start_server(
                handle, pending, port,
            )) {
                Ok(bound_port) if bound_port != port => {
                    tracing::warn!(
                        "Test automation server bound to fallback port {} (requested {})",
                        bound_port,
                        port
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(
                        "Test automation server did not start: {}. Test harness will be unable to connect.",
                        e
                    );
                }
            }
        }
    }
}
