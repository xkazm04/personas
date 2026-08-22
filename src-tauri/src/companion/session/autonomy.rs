//! The autonomous continuation: scheduling the next tick, and the two
//! entry points that spawn a proactive turn.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use super::interrupts::{autonomous_superseded, autonomy_gen_of};
use super::origin::{TurnOrigin, AUTONOMOUS_CONTINUATION_DELAY, AUTONOMOUS_CONTINUATION_MARKER};
use super::turn::send_turn;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;

/// Schedule the next autonomous turn on a dedicated blocking thread
/// with its own single-threaded tokio runtime.
///
/// Why blocking + current-thread: `send_turn` returns a `!Send` future
/// (Tauri command path tolerates that; `tauri::async_runtime::spawn`
/// does not). A blocking thread isn't bound by Send because no work-
/// stealing happens — the future runs on one thread for its lifetime.
///
/// Cancellation: the body polls `AUTONOMOUS_CANCEL` every 200ms
/// during the delay and before kicking off `send_turn`. A user message
/// sets the flag (`cancel_pending_autonomy`) so the tick aborts before
/// spinning up CLI work. Once `send_turn` is in flight, `A5`'s mid-
/// stream interrupt handles cancellation of the CLI process itself.
#[allow(clippy::too_many_arguments)] // +conversation_id; mirrors send_turn's param list
pub(super) fn schedule_autonomous_tick(
    app: AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    chain_index: u32,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    conversation_id: String,
) {
    // Capture the generation this tick belongs to. A user "stop" in THIS
    // conversation (or any newer schedule) advances its generation, after
    // which this tick aborts — and, unlike the old reset-the-bool scheme, it
    // can never be revived. Other conversations' ticks are independent.
    let my_gen = autonomy_gen_of(&conversation_id);
    let gen_conversation = conversation_id.clone();
    // Detached on purpose: the tick's lifetime is governed by the generation
    // counter, not by anyone awaiting it. Named so the lint can tell this
    // apart from a JoinHandle that was dropped by accident.
    let _detached = tauri::async_runtime::spawn_blocking(move || {
        // Poll the generation while waiting out the delay. A coarse
        // 200ms tick is plenty — the delay itself is 15s; finer polling
        // wouldn't change the user's experience.
        let started = Instant::now();
        while started.elapsed() < AUTONOMOUS_CONTINUATION_DELAY {
            if autonomous_superseded(&gen_conversation, my_gen) {
                tracing::debug!("autonomous tick superseded during delay");
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        if autonomous_superseded(&gen_conversation, my_gen) {
            tracing::debug!("autonomous tick superseded at delay boundary");
            return;
        }

        // Single-threaded tokio runtime for this tick. send_turn awaits
        // multiple `!Send` futures (rusqlite-touching helpers, the CLI
        // child process); current-thread doesn't require Send.
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                tracing::warn!(error = %e, "autonomous tick: failed to build runtime");
                return;
            }
        };
        rt.block_on(async move {
            let res = send_turn(
                &app,
                user_db,
                sys_db,
                #[cfg(feature = "ml")]
                embedder,
                AUTONOMOUS_CONTINUATION_MARKER.to_string(),
                TurnOrigin::Autonomous { chain_index },
                voice_enabled,
                recall_synthesis_enabled,
                true, // autonomous_mode — by definition true for a tick
                conversation_id,
            )
            .await;
            if let Err(e) = res {
                tracing::warn!(error = %e, "autonomous continuation tick failed");
            }
        });
    });
}

/// Spawn a self-initiated reasoning turn — the entry point for the
/// proactive scheduler (Goal 2: analyze recent executions) and, later,
/// the execution-finished event subscriber (Goal 1). `directive` is the
/// fully-formed prompt the caller built from the trigger context (e.g.
/// "Execution X failed with <error>; analyze and propose an improvement").
///
/// Runs on a blocking thread with a current-thread runtime for the same
/// `!Send` reason as `schedule_autonomous_tick`. Fire-and-forget: the
/// turn streams to the panel and persists like any other; the caller
/// (a 5-min tick) doesn't await it. `autonomous_mode` is passed through
/// so the turn can chain via `continue_autonomously` if it needs more
/// than one pass — by the time we call this, the caller has already
/// confirmed autonomous mode is on.
///
/// `conversation_id` routes the turn into a specific thread. Ownerless
/// proactive nudges use the system "Athena / Notices" thread (see the
/// [`spawn_proactive_turn`] convenience wrapper); an owned follow-up (e.g. an
/// action-reaction that must land next to the outcome the user just saw) passes
/// the originating thread explicitly.
pub fn spawn_proactive_turn_in(
    app: AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    trigger_kind: String,
    trigger_ref: Option<String>,
    directive: String,
    conversation_id: String,
) {
    // Detached on purpose: the tick's lifetime is governed by the generation
    // counter, not by anyone awaiting it. Named so the lint can tell this
    // apart from a JoinHandle that was dropped by accident.
    let _detached = tauri::async_runtime::spawn_blocking(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                tracing::warn!(error = %e, "proactive turn: failed to build runtime");
                return;
            }
        };
        rt.block_on(async move {
            let res = send_turn(
                &app,
                user_db,
                sys_db,
                #[cfg(feature = "ml")]
                embedder,
                directive,
                TurnOrigin::Proactive {
                    trigger_kind,
                    trigger_ref,
                },
                false, // voice off for machine-initiated turns
                false, // no recall synthesis budget on background turns
                true,  // autonomous_mode on — caller gated on this
                conversation_id,
            )
            .await;
            if let Err(e) = res {
                tracing::warn!(error = %e, "proactive reasoning turn failed");
            }
        });
    });
}

/// Convenience wrapper: spawn an ownerless proactive turn into the system
/// "Athena / Notices" thread (design §4.3) — the scheduler / exec-review /
/// daily-brief entry point. Delegates to [`spawn_proactive_turn_in`].
pub fn spawn_proactive_turn(
    app: AppHandle,
    user_db: Arc<UserDbPool>,
    sys_db: Arc<DbPool>,
    #[cfg(feature = "ml")] embedder: Option<Arc<EmbeddingManager>>,
    trigger_kind: String,
    trigger_ref: Option<String>,
    directive: String,
) {
    spawn_proactive_turn_in(
        app,
        user_db,
        sys_db,
        #[cfg(feature = "ml")]
        embedder,
        trigger_kind,
        trigger_ref,
        directive,
        crate::companion::conversation::NOTICES_CONVERSATION_ID.to_string(),
    );
}
