//! The two queue-assignment writers: a session's LANE and its reserved BAND.
//!
//! Both columns arrive with migration e58, and both are deliberately
//! assignments rather than positions. `queue_rank` is the queue's live truth
//! and `renumber_queue` rewrites every rank wholesale (`registry.rs`, stamping
//! `i + 1`); a lane and a band must survive exactly that, which is why they
//! are their own columns and not a derived reading of rank.
//!
//! A LANE IS AN ORDERING DEVICE, NOT A CONCURRENCY WIDTH. N strands, each of
//! which moves to the queue's tail after one of its tasks finishes. Three
//! backend sites have already deleted a per-batch width (`let _ =
//! max_parallel;` in `dev_tools.rs` and twice in `task_executor.rs`); nothing
//! here re-adds one.
//!
//! THESE ARE THIN WRITERS AND NOTHING ELSE. They set the registry field, set
//! the column, announce the change and return the snapshot. No renumbering,
//! no reordering, no admission, no scheduling: three packages build that
//! behaviour behind this contract, and they need these names and parameter
//! names to hold still more than they need this file to be clever.
//!
//! NO `#[requires(auth)]` ON EITHER COMMAND, DELIBERATELY - the same note
//! `athena_flag.rs` carries, repeated here rather than referenced because the
//! failure mode is a reader "restoring" the attribute to match neighbours that
//! still have it. The macro's `auth` arm expands to `require_auth_sync`, whose
//! entire body is `Ok(())` (`ipc_auth.rs:455-457`), so the annotation cannot
//! fail and advertises a tier the code does not enforce. The census rule
//! `unfalsifiable-tier-guard` baselines 92 sites of that shape and names
//! deleting the annotation as the legal fix for the `auth` tier. The real gate
//! is the router-level `ipc_auth::wrap_invoke_handler`, which these pass
//! through like every other command. Note that the `fleet_queue_*` commands in
//! `queue.rs` call `require_auth(&state).await?` in-body, which is the same
//! unfalsifiable shape spelled as a statement; do not copy that either.

use std::sync::Arc;

use tauri::{AppHandle, State};

use super::queue::{emit_queue_changed, snapshot, FleetQueueSnapshot};
use super::registry::registry;
use crate::db::repos::fleet_sessions;
use crate::error::AppError;
use crate::AppState;

/// Put one session in a queue lane, or take it out of one (`lane: None`).
///
/// Lanes are 1-BASED, matching `queue_rank`; `None` means "no lane" and is a
/// different fact from lane 0, which is why the column is nullable (see the
/// e58 migration's module doc for why a `NOT NULL DEFAULT 0` would read as
/// "lane 0, highest priority" to anyone sorting on it).
///
/// Validates no lane NUMBER: which lanes exist, and how many, is the lane
/// scheduler's question and it does not exist yet. An unknown session id is
/// `NotFound`; a session with no durable row yet is not an error, exactly as
/// in `fleet_set_athena_flag` - the registry holds the assignment and the
/// first persist carries it.
#[tauri::command]
pub async fn fleet_queue_set_lane(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    lane: Option<u32>,
) -> Result<FleetQueueSnapshot, AppError> {
    if !registry().set_lane(&session_id, lane) {
        return Err(AppError::NotFound(format!("fleet session {session_id}")));
    }
    let pool = state.db.clone();
    let id = session_id.clone();
    // The column write is blocking; a sync command must not touch rusqlite on
    // the IPC worker. The `is_panic` arm is `fleet_queue_reorder`'s shape and
    // is load-bearing: the registry field is ALREADY set by the time we get
    // here, so a panicking column write leaves memory and row disagreeing and
    // the caller has to be told that, not handed a generic join error.
    match tokio::task::spawn_blocking(move || fleet_sessions::set_lane(&pool, &id, lane)).await {
        Ok(r) => {
            r?;
        }
        Err(e) if e.is_panic() => {
            return Err(AppError::Internal(
                "fleet queue set lane: the column write PANICKED; the in-memory lane is applied, the row is not".into(),
            ));
        }
        Err(e) => return Err(AppError::Internal(format!("fleet queue set lane: {e}"))),
    }
    emit_queue_changed(&app, "lane_changed", Some(&session_id));
    snapshot(&app, state.db.clone()).await
}

/// Reserve a band for one session, or release it (`band: None`).
///
/// The column IS the reservation: `None` means the row holds none. Nullable
/// for the same reason `lane` is - band 0 and "no band" would otherwise be
/// indistinguishable at every call site.
///
/// Validates no band NUMBER and enforces no exclusivity: whether this session
/// is entitled to the band, and what happens to whoever held it, belongs to
/// the reservation package. This writer only records the claim.
#[tauri::command]
pub async fn fleet_queue_reserve_band(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    band: Option<u32>,
) -> Result<FleetQueueSnapshot, AppError> {
    if !registry().set_reserved_band(&session_id, band) {
        return Err(AppError::NotFound(format!("fleet session {session_id}")));
    }
    let pool = state.db.clone();
    let id = session_id.clone();
    // Same panic boundary as `fleet_queue_set_lane` above, for the same
    // reason: the registry already holds the claim.
    match tokio::task::spawn_blocking(move || fleet_sessions::set_reserved_band(&pool, &id, band))
        .await
    {
        Ok(r) => {
            r?;
        }
        Err(e) if e.is_panic() => {
            return Err(AppError::Internal(
                "fleet queue reserve band: the column write PANICKED; the in-memory reservation is applied, the row is not".into(),
            ));
        }
        Err(e) => return Err(AppError::Internal(format!("fleet queue reserve band: {e}"))),
    }
    emit_queue_changed(&app, "band_changed", Some(&session_id));
    snapshot(&app, state.db.clone()).await
}
