//! The supervisor: re-adopt what outlived the last session, then every
//! [`TICK`] re-derive the whole view and emit `dev-servers-changed` only when
//! it differs from the last emission.
//!
//! Its wait races the registry's shutdown token inside `tokio::select!`, so
//! the exit hook can stop it. Each pass runs behind its own panic boundary: a
//! pass that panics is logged and the next tick tries again, rather than the
//! Server control page freezing for the rest of the session.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::Duration;

use futures_util::FutureExt;
use tauri::AppHandle;

use crate::db::DbPool;
use crate::webbuild::devserver::DevServerRegistry;

/// How often the view is re-derived.
pub const TICK: Duration = Duration::from_secs(3);

/// Boot: re-adopt the servers recorded in `dev_server_runs`, then run the
/// supervisor until the registry's shutdown token is cancelled.
pub fn start(app: AppHandle, pool: DbPool, reg: Arc<DevServerRegistry>) {
    let shutdown = reg.shutdown_token();
    tauri::async_runtime::spawn(async move {
        if let Err(panic) = AssertUnwindSafe(readopt(&reg)).catch_unwind().await {
            tracing::error!(
                panic = %personas_core::utils::extract_panic_message(panic),
                "server control: the boot re-adopt panicked; recorded servers read as stopped"
            );
        }
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => break,
                _ = ticker.tick() => {}
            }
            let pass = AssertUnwindSafe(super::publish_if_changed(&app, &pool, &reg));
            match pass.catch_unwind().await {
                Ok(Ok(_)) => {}
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "server control: a supervisor pass failed; the next tick retries");
                }
                Err(panic) => {
                    tracing::error!(
                        panic = %personas_core::utils::extract_panic_message(panic),
                        "server control: a supervisor pass panicked; the next tick retries"
                    );
                }
            }
        }
        tracing::info!("server control: supervisor stopped");
    });
}

/// Re-adopt every recorded server whose process is still the one we spawned,
/// and drop the rest.
async fn readopt(reg: &Arc<DevServerRegistry>) {
    let r = reg.clone();
    match tokio::task::spawn_blocking(move || r.adopt_runs()).await {
        Ok(Ok(outcome)) => tracing::info!(
            adopted = outcome.adopted,
            dropped = outcome.dropped,
            "server control: re-adopted the dev servers that outlived the last session"
        ),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "server control: the boot re-adopt failed; recorded servers read as stopped");
        }
        Err(e) => {
            tracing::warn!(error = %e, "server control: the boot re-adopt task failed");
        }
    }
}
