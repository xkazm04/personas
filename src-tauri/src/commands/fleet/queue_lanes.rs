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
//! WITH ONE ASYMMETRY, STATED RATHER THAN SMOOTHED OVER. The lane scheduler
//! now exists (`super::lanes`), and the BULK command below
//! ([`fleet_queue_assign_lanes`]) re-ranks through `registry::renumber_queue`
//! after its writes, because a modal that lanes a dozen rows and then hands
//! back a snapshot with the OLD ranks would be showing the operator a queue
//! that is not the queue. [`fleet_queue_set_lane`] deliberately still does
//! not: its contract — "validates no lane number and reorders nothing" — is
//! what three packages were written against, and changing it is a decision
//! for whoever owns them, not a side effect of adding a sibling. The
//! consequence is real and worth knowing: a single `set_lane` takes effect at
//! the next renumber (a claim, a release, a reorder, a promotion, a boot),
//! and the snapshot it returns in the meantime shows the pre-assignment
//! ranks. Prefer the bulk command, even for one row.
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

use serde::Deserialize;
use ts_rs::TS;

use super::queue::{emit_queue_changed, persist_ranks, snapshot, FleetQueueSnapshot};
use super::registry::registry;
use crate::db::repos::fleet_sessions;
use crate::error::AppError;
use crate::AppState;

/// The highest queue lane an operator may assign.
///
/// A GOVERNANCE number, not a throughput one: eight is what a lane modal can
/// show as distinct strands and what a human can plausibly have meant by
/// "parallel lanes". It bounds nothing about the machine — the live-session
/// cap and the queue depth cap do that, and a lane grants no exemption from
/// either. Lane numbers need not be contiguous (1, 4 and 9 would be three
/// strands), but 9 is still refused: the ceiling is the ceiling.
pub const MAX_LANE: u32 = 8;

/// The most rows one [`fleet_queue_assign_lanes`] call may touch.
///
/// Also governance: it is the queue's own DEFAULT depth
/// (`FLEET_MAX_QUEUED_SESSIONS_DEFAULT`), i.e. the most rows a lane modal can
/// have been showing when the operator pressed the button. Over it the call
/// is REFUSED, never truncated — a silent slice would report success for
/// rows it never looked at.
pub const MAX_LANE_ASSIGNMENTS: usize =
    crate::db::settings_keys::FLEET_MAX_QUEUED_SESSIONS_DEFAULT as usize;

/// One row's new queue-lane assignment. `lane: None` clears it.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LaneAssignment {
    pub session_id: String,
    pub lane: Option<u32>,
}

/// Everything about a batch that can be judged WITHOUT the registry: the
/// ceiling, the lane range, and the operator having said two things about one
/// row. Pure, so it is tested without a fleet.
///
/// Hoisted versus per-item, per the `bulk-command-variant` golden path's P4:
/// the ceiling is a property of the REQUEST and is checked once; the lane
/// range and the duplicate check are properties of each ITEM and are checked
/// N times, which is why each error names the offending `session_id` and
/// value rather than reporting that something somewhere was wrong.
fn validate_assignments(assignments: &[LaneAssignment]) -> Result<(), AppError> {
    if assignments.len() > MAX_LANE_ASSIGNMENTS {
        return Err(AppError::Validation(format!(
            "lane_batch_too_large: {} assignments, the ceiling is {MAX_LANE_ASSIGNMENTS}",
            assignments.len()
        )));
    }
    let mut seen: Vec<&str> = Vec::with_capacity(assignments.len());
    for a in assignments {
        if let Some(lane) = a.lane {
            if lane == 0 || lane > MAX_LANE {
                return Err(AppError::Validation(format!(
                    "lane_out_of_range: session {} asked for lane {lane}; lanes are 1..={MAX_LANE}, or null to clear",
                    a.session_id
                )));
            }
        }
        if seen.contains(&a.session_id.as_str()) {
            return Err(AppError::Validation(format!(
                "lane_duplicate_session: session {} appears twice in one batch",
                a.session_id
            )));
        }
        seen.push(&a.session_id);
    }
    Ok(())
}

/// Assign (or clear) the queue lane of MANY sessions in one round trip, for a
/// modal that lanes a dozen rows at once.
///
/// **ALL OR NOTHING, and that is the answer to "what does it say when 5 of 12
/// landed".** The `bulk-command-variant` golden path's P1/P2 are that N
/// operations have N outcomes and a count is not a report; this command's
/// answer is to make a partial outcome UNREACHABLE for everything it can
/// decide in advance. Every item is judged — ceiling, lane range, duplicate
/// row, unknown session id — BEFORE the first write, and the first failure
/// refuses the whole batch naming the offending row. Nothing is clamped and
/// nothing is truncated (P6).
///
/// The residue it cannot hoist is the durable column write, which can fail
/// per row after the in-memory assignment has already been made. That is
/// reported as an error NAMING EXACTLY WHICH ids did not reach their row —
/// never folded into a success count — with the registry left holding the
/// full assignment: the same choice, and the same wording, as the panic arm
/// of [`fleet_queue_set_lane`] below.
///
/// It is NOT the singular in a loop, and it does not re-implement it either
/// (P3/P8): both go through the same two statements —
/// `registry().set_lane(..)` and `fleet_sessions::set_lane(..)` — and both end
/// at the same re-rank / announce / snapshot tail. There is no gate on the
/// singular path that this one skips; the lane RANGE is this command's
/// addition, and the singular keeps its "validates no lane number" contract
/// because three packages were written against it.
///
/// No `#[requires(auth)]`, for the reason this module's header gives.
#[tauri::command]
pub async fn fleet_queue_assign_lanes(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    assignments: Vec<LaneAssignment>,
) -> Result<FleetQueueSnapshot, AppError> {
    validate_assignments(&assignments)?;
    // An empty batch is a no-op, said out loud rather than silently
    // succeeding on a write that never happened: nothing is assigned, nothing
    // is persisted, nothing is announced, and the caller still gets the
    // truthful current queue.
    if assignments.is_empty() {
        return snapshot(&app, state.db.clone()).await;
    }
    // An unknown id is the per-item precondition that needs the registry, so
    // it is checked for EVERY row before any row is written.
    {
        let missing: Vec<&str> = assignments
            .iter()
            .map(|a| a.session_id.as_str())
            .filter(|id| !registry().has_session(id))
            .collect();
        if !missing.is_empty() {
            return Err(AppError::NotFound(format!(
                "fleet sessions {} (nothing was assigned)",
                missing.join(", ")
            )));
        }
    }
    for a in &assignments {
        // Cannot be false: the id was proved known above, under the same
        // process-wide registry, which never drops a session.
        registry().set_lane(&a.session_id, a.lane);
    }
    let pool = state.db.clone();
    let rows: Vec<(String, Option<u32>)> = assignments
        .iter()
        .map(|a| (a.session_id.clone(), a.lane))
        .collect();
    // Blocking rusqlite off the IPC worker, like every writer in this file.
    // Each row is attempted even after one fails, so the report below names
    // the whole residue rather than the first casualty.
    let failed: Vec<String> = match tokio::task::spawn_blocking(move || {
        let mut failed = Vec::new();
        for (id, lane) in rows {
            if fleet_sessions::set_lane(&pool, &id, lane).is_err() {
                failed.push(id);
            }
        }
        failed
    })
    .await
    {
        Ok(failed) => failed,
        Err(e) if e.is_panic() => {
            return Err(AppError::Internal(
                "fleet queue assign lanes: the column writes PANICKED; the in-memory lanes are applied, the rows are not".into(),
            ));
        }
        Err(e) => return Err(AppError::Internal(format!("fleet queue assign lanes: {e}"))),
    };
    // The lanes changed, so the order changed: re-rank through the one
    // ranker, exactly as `bands::claim` does after a claim.
    let ranks = registry().renumber_queue(&[]);
    persist_ranks(&app, &ranks);
    emit_queue_changed(&app, "lane_changed", None);
    if !failed.is_empty() {
        return Err(AppError::Internal(format!(
            "fleet queue assign lanes: the lanes are applied in memory but these rows were not written: {}",
            failed.join(", ")
        )));
    }
    snapshot(&app, state.db.clone()).await
}

/// Put one session in a queue lane, or take it out of one (`lane: None`).
///
/// Lanes are 1-BASED, matching `queue_rank`; `None` means "no lane" and is a
/// different fact from lane 0, which is why the column is nullable (see the
/// e58 migration's module doc for why a `NOT NULL DEFAULT 0` would read as
/// "lane 0, highest priority" to anyone sorting on it).
///
/// An unknown session id is `NotFound`; a session with no durable row yet is
/// not an error, exactly as in `fleet_set_athena_flag` - the registry holds
/// the assignment and the first persist carries it.
///
/// THE RANGE IS CHECKED HERE AND THE QUEUE IS RE-RANKED HERE, and until the
/// scheduler landed neither was true. This command shipped in `50fc50895` as
/// a thin writer whose own doc said it "validates no lane NUMBER: which lanes
/// exist, and how many, is the lane scheduler's question and it does not exist
/// yet". The scheduler is `super::lanes` now, and the two consequences of
/// leaving this door as it was are not hypothetical:
///
/// * An unvalidated number beside a validated one is the same hole
///   [`fleet_queue_reserve_band`] had below. [`MAX_LANE`] is the ceiling for
///   both doors or it is the ceiling for neither, and lane 0 is refused here
///   for the reason the column is nullable at all.
/// * Without the re-rank the assignment had NO EFFECT until some unrelated
///   edit happened to renumber the queue - and the snapshot this function
///   returns would have reported the pre-assignment order, so the caller would
///   render the queue as it was and believe itself wrong.
///
/// It had no callers when this was corrected, so nothing was written against
/// the old contract.
#[tauri::command]
pub async fn fleet_queue_set_lane(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    lane: Option<u32>,
) -> Result<FleetQueueSnapshot, AppError> {
    if let Some(n) = lane {
        if n == 0 || n > MAX_LANE {
            return Err(AppError::Validation(format!(
                "lane_out_of_range: lane {n} is not between 1 and {MAX_LANE}"
            )));
        }
    }
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
    // The lane changed, so the order changed: re-rank through the one ranker,
    // exactly as the bulk command above and `bands::claim` beside it do.
    let ranks = registry().renumber_queue(&[]);
    persist_ranks(&app, &ranks);
    emit_queue_changed(&app, "lane_changed", Some(&session_id));
    snapshot(&app, state.db.clone()).await
}

/// Reserve a band for one session, or release it (`band: None`).
///
/// The column IS the reservation: `None` means the row holds none. Nullable
/// for the same reason `lane` is - band 0 and "no band" would otherwise be
/// indistinguishable at every call site.
///
/// THIS GOES THROUGH `bands::claim`, NOT THE RAW SETTER, AND THAT IS THE WHOLE
/// POINT OF THE FUNCTION. The first cut of this command wrote the column
/// directly and said in its own doc that entitlement and exclusivity "belong to
/// the reservation package". That package now exists, and leaving an
/// unvalidated door open beside it is how a single reserved seat becomes the
/// general priority field migration e37 deleted: an arbitrary caller writing an
/// arbitrary band on an arbitrary row IS `fleet_autopilot.dispatch_order`
/// wearing a different column name. See `bands.rs` for that history.
///
/// So a claim here obeys the same two rules the engine obeys - the row must be
/// `Queued`, and an incumbent is never evicted - and a refusal is reported
/// rather than silently recorded. Releasing is unconstrained on purpose:
/// clearing your own reservation takes nothing from anyone.
#[tauri::command]
pub async fn fleet_queue_reserve_band(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    band: Option<u32>,
) -> Result<FleetQueueSnapshot, AppError> {
    match band {
        Some(b) => {
            if registry().reserved_band_of(&session_id).is_none()
                && !registry()
                    .queued_in_order()
                    .iter()
                    .any(|(id, ..)| id == &session_id)
            {
                return Err(AppError::Validation(format!(
                    "band_refused: fleet session {session_id} is not queued, so it has no position to reserve"
                )));
            }
            // `claim` does the registry write, the column write, the re-rank
            // and the announce; it returns false when the band is already held
            // by another waiting row.
            if !super::bands::claim(&app, &session_id, b) {
                return Err(AppError::Validation(format!(
                    "band_refused: band {b} is already held by another waiting session"
                )));
            }
        }
        None => {
            if !registry().set_reserved_band(&session_id, None) {
                return Err(AppError::NotFound(format!("fleet session {session_id}")));
            }
            let pool = state.db.clone();
            let id = session_id.clone();
            // Same panic boundary as `fleet_queue_set_lane` above, for the same
            // reason: the registry already dropped the reservation.
            match tokio::task::spawn_blocking(move || {
                fleet_sessions::set_reserved_band(&pool, &id, None)
            })
            .await
            {
                Ok(r) => {
                    r?;
                }
                Err(e) if e.is_panic() => {
                    return Err(AppError::Internal(
                        "fleet queue reserve band: the column write PANICKED; the in-memory release is applied, the row is not".into(),
                    ));
                }
                Err(e) => return Err(AppError::Internal(format!("fleet queue reserve band: {e}"))),
            }
            // A release changes who sits where, so the queue is re-ranked for
            // the same reason a claim re-ranks it.
            let ranks = registry().renumber_queue(&[]);
            crate::commands::fleet::queue::persist_ranks(&app, &ranks);
            emit_queue_changed(&app, "band_changed", Some(&session_id));
        }
    }
    snapshot(&app, state.db.clone()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(session_id: &str, lane: Option<u32>) -> LaneAssignment {
        LaneAssignment {
            session_id: session_id.to_string(),
            lane,
        }
    }

    fn message(err: AppError) -> String {
        match err {
            AppError::Validation(m) => m,
            other => panic!("expected a Validation refusal, got {other:?}"),
        }
    }

    #[test]
    fn an_out_of_range_lane_is_refused_rather_than_clamped() {
        // The ceiling, one past it.
        let msg = message(validate_assignments(&[a("s1", Some(MAX_LANE + 1))]).unwrap_err());
        assert!(msg.starts_with("lane_out_of_range:"), "{msg}");
        assert!(msg.contains("s1"), "the refusal names the row: {msg}");
        assert!(
            msg.contains(&format!("1..={MAX_LANE}")),
            "and the legal range: {msg}"
        );
        // Lane 0 is not "no lane" - the column is nullable precisely so that
        // "no lane" has its own spelling - so it is refused too.
        assert!(
            message(validate_assignments(&[a("s1", Some(0))]).unwrap_err())
                .starts_with("lane_out_of_range:")
        );
        // And the legal edges are accepted.
        assert!(validate_assignments(&[a("s1", Some(1)), a("s2", Some(MAX_LANE))]).is_ok());
        // `None` clears and is always legal.
        assert!(validate_assignments(&[a("s1", None)]).is_ok());
    }

    #[test]
    fn one_row_named_twice_in_a_batch_is_refused() {
        let msg = message(validate_assignments(&[a("s1", Some(1)), a("s1", Some(2))]).unwrap_err());
        assert!(msg.starts_with("lane_duplicate_session:"), "{msg}");
        assert!(msg.contains("s1"), "{msg}");
    }

    #[test]
    fn a_batch_over_the_ceiling_is_refused_not_truncated() {
        let over: Vec<LaneAssignment> = (0..=MAX_LANE_ASSIGNMENTS)
            .map(|i| a(&format!("s{i}"), Some(1)))
            .collect();
        let msg = message(validate_assignments(&over).unwrap_err());
        assert!(msg.starts_with("lane_batch_too_large:"), "{msg}");
        // Exactly at the ceiling is fine - the refusal is `>`, not `>=`.
        assert!(validate_assignments(&over[..MAX_LANE_ASSIGNMENTS]).is_ok());
    }

    #[test]
    fn an_empty_batch_validates() {
        assert!(validate_assignments(&[]).is_ok());
    }
}
