//! Durable fleet registry — the bridge between the in-memory
//! [`super::registry::FleetRegistry`] and the `fleet_sessions` table.
//!
//! ## Why
//!
//! The registry was in-memory only, so an app restart / update / crash lost
//! the whole fleet (three total-loss restarts on 2026-07-24; eight stranded
//! conversations had to be recovered by hand). Everything needed to resurrect
//! a row — `claude_session_id`, `cwd`, `created_at_ms`, `name`, last state —
//! is already known, and the `claude --resume` wake path already works. So the
//! fix is a mirror, not a new mechanism.
//!
//! ## How it layers on what exists
//!
//! - **Writes** piggyback the two existing emit points in [`super::pty`]
//!   (`emit_session_state` / `emit_registry_changed`). Every lane that already
//!   announces a change (hooks, staleness ticker, transcript watcher, headless
//!   reader, Tauri commands) therefore persists for free; nothing gets a
//!   private write path that could drift.
//! - **Non-blocking**: the emit points run on PTY reader threads and the
//!   ticker, so the actual SQLite write happens on one dedicated writer thread
//!   fed by an unbounded channel. A DB stall can never wedge the PTY.
//! - **Rehydration** reuses the existing *doze* concept: a restored row is a
//!   `dozing` tombstone — displayed state preserved, no `child_pid`, wakeable
//!   by selecting it (exactly what a session dozed by the resource floor looks
//!   like). No new UI state, no new wake path.
//!
//! Only rows with a bound `claude_session_id` are persisted; without one there
//! is no conversation to come back to.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use tauri::{AppHandle, Manager};

use crate::db::repos::fleet_sessions::{self, FleetSessionRow};
use crate::db::DbPool;

use super::budgets::{gpu_to_token, token_to_gpu};
use super::registry::{
    now_ms, registry, AdmissionFacts, FleetSessionInner, OutputRing, OUTPUT_RING_CAP,
};
use super::types::{
    mode_to_token, state_to_token, token_to_mode, token_to_state, FleetSessionState,
};

/// Terminal rows older than this are dropped on boot — a day-old exited
/// session has no recovery value, and the table should not grow without bound.
const EXITED_RETENTION_MS: i64 = 24 * 60 * 60 * 1000;

enum Job {
    /// The row, and - for a session a paired device dispatched here - its
    /// `(remote_job_id, origin_peer_id)`, stamped right after the upsert (the
    /// row itself does not carry them; see `fleet_sessions::set_remote_origin`).
    Upsert(Box<FleetSessionRow>, Option<(String, String)>),
    Delete(String),
}

struct Writer {
    tx: Sender<Job>,
}

static WRITER: OnceLock<Mutex<Option<Writer>>> = OnceLock::new();
static REHYDRATED: AtomicBool = AtomicBool::new(false);

/// Resolve the app DB pool. `None` before AppState is managed (very early
/// boot) — callers treat persistence as best-effort and skip.
fn pool_of(app: &AppHandle) -> Option<DbPool> {
    app.try_state::<Arc<crate::AppState>>()
        .map(|s| s.db.clone())
}

/// Lazily start the single writer thread bound to `pool`, returning its sender.
fn writer(pool: DbPool) -> Option<Sender<Job>> {
    let cell = WRITER.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("fleet-persist".into())
            .spawn(move || {
                while let Ok(job) = rx.recv() {
                    let result = match &job {
                        Job::Upsert(row, origin) => {
                            fleet_sessions::upsert(&pool, row).and_then(|()| match origin {
                                Some((job_id, peer_id)) => fleet_sessions::set_remote_origin(
                                    &pool, &row.id, job_id, peer_id,
                                )
                                .map(|_| ()),
                                None => Ok(()),
                            })
                        }
                        Job::Delete(id) => fleet_sessions::delete(&pool, id),
                    };
                    if let Err(err) = result {
                        // Best-effort by contract: a persistence miss must
                        // never surface as a fleet failure.
                        tracing::warn!(error = %err, "fleet_sessions: durable write failed");
                    }
                }
            })
            .ok()?;
        *guard = Some(Writer { tx });
    }
    guard.as_ref().map(|w| w.tx.clone())
}

fn enqueue(app: &AppHandle, job: Job) {
    let Some(pool) = pool_of(app) else { return };
    let Some(tx) = writer(pool) else { return };
    let _ = tx.send(job);
}

/// Persist the current registry state of `session_id`. Called from the shared
/// emit points — cheap (one map lookup + a channel send), never blocking.
pub fn note_changed(app: &AppHandle, session_id: &str) {
    let row = {
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        map.get(session_id).and_then(row_from_inner)
    };
    let Some(row) = row else { return };
    // Read after the registry lock is released (lock order: registry, then
    // the remote link table).
    let origin = super::remote_exec::origin_of(session_id);
    enqueue(app, Job::Upsert(Box::new(row), origin));
}

/// Forget a session that left the registry (dismissed, or replaced by a wake).
pub fn note_removed(app: &AppHandle, session_id: &str) {
    enqueue(app, Job::Delete(session_id.to_string()));
}

/// Project a live registry row onto its durable shape. `None` when the session
/// has no `claude_session_id` — nothing to resume, so nothing to persist.
pub fn row_from_inner(inner: &FleetSessionInner) -> Option<FleetSessionRow> {
    let claude_session_id = inner.claude_session_id.clone()?;
    Some(FleetSessionRow {
        id: inner.id.clone(),
        claude_session_id,
        cwd: inner.cwd.to_string_lossy().into_owned(),
        project_label: inner.project_label.clone(),
        name: inner.name.clone(),
        title: inner.title.clone(),
        args_json: serde_json::to_string(&inner.args).unwrap_or_else(|_| "[]".to_string()),
        mode: mode_to_token(inner.mode).to_string(),
        state: state_to_token(inner.state).to_string(),
        state_reason: inner.state_reason.clone(),
        run_id: inner.run_id.clone(),
        run_label: inner.run_label.clone(),
        created_at_ms: inner.created_at_ms,
        last_activity_ms: inner.last_activity_ms,
        queue_rank: inner.queue_rank,
        queued_at_ms: inner.queued_at_ms,
        not_before_ms: inner.not_before_ms,
        origin: inner.origin.clone(),
        persona_id: inner.persona_id.clone(),
        goal_id: inner.goal_id.clone(),
        cycle_index: inner.cycle_index,
        machine_units: inner.admission.machine_units,
        plan_units: inner.admission.plan_units,
        gpu_class: inner.admission.gpu.map(|g| gpu_to_token(g).to_string()),
        // `0` skips is "never skipped", which the column spells as NULL.
        skip_count: Some(inner.admission.skip_count).filter(|n| *n > 0),
        first_unfit_at_ms: inner.admission.first_unfit_at_ms,
    })
}

const RESTORED_SUFFIX: &str = " · restored after restart";

/// The reason a rehydrated row wears: its own reason, marked restored ONCE.
///
/// The restored row is persisted again on its next change, so appending the
/// marker unconditionally compounded it on every boot. Measured 2026-09-14: a
/// stale worker's reason carried the marker 150 times.
fn restored_reason(reason: Option<&str>) -> String {
    let Some(reason) = reason else {
        return "Restored after restart — select to resume".to_string();
    };
    let mut base = reason;
    while let Some(stripped) = base.strip_suffix(RESTORED_SUFFIX) {
        base = stripped;
    }
    format!("{base}{RESTORED_SUFFIX}")
}

/// The rank a restored row carries: only a still-queued row has one.
fn queue_rank_for(state: FleetSessionState, rank: Option<u32>) -> Option<u32> {
    matches!(state, FleetSessionState::Queued)
        .then_some(rank)
        .flatten()
}

/// Rebuild a registry row from its durable shape as a **dozing tombstone**:
/// the displayed state is preserved (the operator sees what the session was
/// doing), but there is no process — `dozing = true` + `child_pid = None` is
/// exactly the shape the resource-floor doze produces, so `resume_target` /
/// `fleet_wake_session` resurrect it with no special-casing.
///
/// `created_at_ms` is preserved so grid slots stay where the operator left
/// them (tiles are ordered by spawn time).
pub fn inner_from_row(row: &FleetSessionRow) -> FleetSessionInner {
    // A row persisted mid-spawn never bound anything useful; anything we can't
    // parse falls back to Stale, which is honest ("we don't know, look at it")
    // and doze-compatible. Exited never reaches here (filtered by the query).
    let state = token_to_state(&row.state)
        .filter(|s| !matches!(s, FleetSessionState::Exited | FleetSessionState::Spawning))
        .unwrap_or(FleetSessionState::Stale);
    let args: Vec<String> = serde_json::from_str(&row.args_json).unwrap_or_default();
    FleetSessionInner {
        id: row.id.clone(),
        claude_session_id: Some(row.claude_session_id.clone()),
        cwd: std::path::PathBuf::from(&row.cwd),
        project_label: row.project_label.clone(),
        name: row.name.clone(),
        title: row.title.clone(),
        athena_active_until_ms: 0,
        args,
        mode: token_to_mode(&row.mode),
        cols: 120,
        rows: 32,
        state,
        last_activity_ms: row.last_activity_ms,
        // Never observed in THIS process — 0 keeps the frozen-process check
        // (`last_pty_output_ms > 0`) from flagging a restored row as hung.
        last_pty_output_ms: 0,
        last_grew_ms: 0,
        created_at_ms: row.created_at_ms,
        child_pid: None,
        exit_code: None,
        limit_reset_at_ms: 0,
        state_reason: Some(restored_reason(row.state_reason.as_deref())),
        run_id: row.run_id.clone(),
        run_label: row.run_label.clone(),
        stale_kind: None,
        // A queued row keeps its rank only while it is still queued; the
        // provenance survives whatever state the row restored into.
        queue_rank: queue_rank_for(state, row.queue_rank),
        queued_at_ms: row.queued_at_ms,
        not_before_ms: row.not_before_ms,
        origin: row.origin.clone(),
        persona_id: row.persona_id.clone(),
        goal_id: row.goal_id.clone(),
        cycle_index: row.cycle_index,
        admission: AdmissionFacts {
            machine_units: row.machine_units,
            plan_units: row.plan_units,
            gpu: row.gpu_class.as_deref().and_then(token_to_gpu),
            skip_count: row.skip_count.unwrap_or(0),
            first_unfit_at_ms: row.first_unfit_at_ms,
        },
        master: Mutex::new(None),
        writer: Mutex::new(None),
        hibernating: AtomicBool::new(false),
        // A queued row never had a process, so there is nothing to doze: it
        // comes back as exactly what it was — a dispatch waiting for a slot —
        // and the queue's boot reconcile promotes it, not the wake path.
        dozing: !matches!(state, FleetSessionState::Queued),
        // A rehydrated row has no process at all, so nothing to reap.
        reaped: false,
        output: Arc::new(Mutex::new(OutputRing::new(OUTPUT_RING_CAP))),
        killer: None,
    }
}

/// Boot-time restore. Idempotent (guarded) and safe to call from the staleness
/// ticker's first iterations — before AppState is managed it simply no-ops and
/// the next tick retries.
///
/// Returns the number of rows restored.
pub fn rehydrate(app: &AppHandle) -> usize {
    if REHYDRATED.load(Ordering::SeqCst) {
        return 0;
    }
    let Some(pool) = pool_of(app) else { return 0 };
    // Claim the flag only once we can actually read the DB, so an early
    // pool-less tick doesn't burn the one attempt.
    if REHYDRATED.swap(true, Ordering::SeqCst) {
        return 0;
    }

    // Queued write-backs first — before any restored row can be read as
    // abandoned by anything downstream of this boot. Best-effort, idempotent.
    let drained = crate::commands::infrastructure::replay_queue::drain(&pool);
    if drained.wrote_anything() {
        tracing::info!(
            applied = drained.applied,
            "fleet: replay queue drained at boot"
        );
    }

    match fleet_sessions::prune_exited_before(&pool, now_ms() - EXITED_RETENTION_MS) {
        Ok(n) if n > 0 => tracing::info!(pruned = n, "fleet_sessions: aged out exited rows"),
        Err(err) => tracing::warn!(error = %err, "fleet_sessions: prune failed"),
        _ => {}
    }

    let rows = match fleet_sessions::list_rehydratable(&pool) {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(error = %err, "fleet_sessions: rehydrate read failed");
            return 0;
        }
    };
    let mut restored = 0usize;
    let now = now_ms();
    for row in &rows {
        // A live row already owns this id (the app relaunched fast enough that
        // something respawned first) — never clobber a real process.
        if registry().session_state(&row.id).is_some() {
            continue;
        }
        // An ended machine worker is not brought back as a tile (the ticker
        // would only retire it again), and past its retention its row goes.
        if let Some(state) = token_to_state(&row.state) {
            let ended_for = |after_ms| {
                super::stale::machine_worker_ended_for(
                    row.run_label.as_deref(),
                    state,
                    row.last_activity_ms,
                    now,
                    after_ms,
                )
            };
            if ended_for(super::stale::MACHINE_WORKER_ROW_RETENTION_MS) {
                if let Err(err) = fleet_sessions::delete(&pool, &row.id) {
                    tracing::warn!(error = %err, "fleet_sessions: machine worker prune failed");
                }
                continue;
            }
            if ended_for(super::stale::MACHINE_WORKER_RETIRE_MS) {
                continue;
            }
        }
        registry().insert(inner_from_row(row));
        restored += 1;
    }
    // A session a paired device had dispatched here keeps its provenance, so
    // its restored tile still says who asked. (Its job did not survive: the
    // remote-job sweep failed it at boot.)
    super::remote_exec::restore_from(&pool);
    if restored > 0 {
        tracing::info!(
            restored,
            "fleet: rehydrated sessions from the durable registry"
        );
        super::pty::emit_registry_changed(app, "rehydrated", "");
    }
    // Queued rows came back as queued: renumber them densely and start as many
    // as the cap allows. Runs even when nothing was restored — a queue can be
    // non-empty while every live row was already re-spawned by something
    // faster than this tick.
    super::queue::reconcile_after_restore(app);
    restored
}

/// One-shot guard for [`recover_after_restart`].
static RECOVERED: AtomicBool = AtomicBool::new(false);

/// Mechanism 2 — boot recovery. A session that was mid-task
/// (`Running`/`AwaitingInput`) at the last shutdown comes back from
/// [`rehydrate`] with that state but NO live PTY: the app lost the handle on
/// restart even though the `claude` process usually survives as an orphan.
/// Left as-is it reads as a false-`Running`/silent tile and — worse — the
/// ticker would soon mark it `Stale` and the auto-forget pass would sweep it,
/// silently stranding real work.
///
/// This pass runs ONCE, right after the first successful rehydrate and BEFORE
/// `tick_once`, and force-parks each Athena-owned mid-task orphan to
/// `AwaitingInput` with a recovery reason ([`park_recovered`]). That both
/// surfaces it for reconnection (`fleet_resume`/`fleet_wake`) and shields it
/// from auto-forget. Finished/dead rows are deliberately ignored here — the
/// ticker's auto-forget pass cleans those.
///
/// It intentionally does NOT auto-kill-and-resume the orphan process at boot:
/// `fleet_resume_orphan` kills before resuming, and matching a process to a
/// session by cwd is ambiguous when several share a directory — too risky to
/// fire unattended. Reconnection stays an operator/Athena-driven action.
pub fn recover_after_restart(app: &AppHandle) {
    use super::registry::registry;
    if RECOVERED.load(Ordering::SeqCst) {
        return;
    }
    // Snapshot mid-task orphans under the lock; act outside it.
    let strays: Vec<(String, Option<String>, Option<String>)> = {
        let map = registry()
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Nothing to inspect yet (rehydrate no-ops until the DB pool is
        // managed) — don't burn the one-shot; retry on the next tick.
        if map.is_empty() {
            return;
        }
        map.values()
            .filter(|s| {
                s.child_pid.is_none()
                    && matches!(
                        s.state,
                        FleetSessionState::Running
                            | FleetSessionState::Idle
                            | FleetSessionState::AwaitingInput
                    )
            })
            .map(|s| {
                (
                    s.id.clone(),
                    s.run_label.clone(),
                    s.claude_session_id.clone(),
                )
            })
            .collect()
    };
    RECOVERED.store(true, Ordering::SeqCst);
    for (sid, run_label, claude_session_id) in strays {
        // A one-shot worker restored mid-task is settled from its transcript,
        // never from a timer: the CLI wrote what it was doing when the app
        // went down, and that record says whether the turn had ENDED or was
        // KILLED. Left to the ticker, both read "No log growth for 6 min" —
        // and the abandoned-dispatch sweep then released a merged, finished
        // delivery as "worker ended without write-back" (bank-contracts
        // 672ce81d, 2026-09-10 → 09-13, three restarts).
        if super::classify::is_one_shot_worker_label(run_label.as_deref())
            && settle_restored_worker(app, &sid, claude_session_id.as_deref())
        {
            continue;
        }
        if !registry().is_athena_owned(&sid) {
            continue;
        }
        if registry().park_recovered(
            &sid,
            "Recovered after an app restart — its live connection was lost. Resume to reconnect, or close it.",
        ) {
            super::pty::emit_registry_changed(app, "updated", &sid);
        }
    }
}

/// What a restored one-shot worker's transcript says should become of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RestoredSettlement {
    /// The turn had ended: trailing assistant text, no tool call outstanding.
    /// `reason` is the same reason the live `result`-event path would have
    /// parked it with (`Task complete: …` for a declared completion, the
    /// unmarked-finish reason otherwise), so every later reader — the
    /// abandoned-dispatch sweep included — sees a finished worker, not a
    /// silent one.
    Finished { reason: String },
    /// The turn was killed inside a tool call: a `tool_use` with no
    /// `tool_result` ever written. Parked `Stale` with a reason that says so,
    /// which is what tells "killed" apart from "went quiet".
    Killed { reason: String },
    /// The worker declared itself blocked. Parked `AwaitingInput` with the
    /// declaration, as the live path does.
    Blocked { reason: String },
    /// Nothing the transcript can settle (no transcript, a question on the
    /// screen, a limit banner, or an unreadable tail) — the caller keeps the
    /// pre-existing behaviour.
    Leave,
}

/// Classify a restored worker's transcript tail. Pure; unit-tested below.
///
/// Reuses the parked-state classifier the ticker already trusts
/// (`classify::classify_parked`) and the turn-end reader the live headless
/// path uses (`classify::worker_turn_end`), so a restart reaches the SAME
/// verdict the app would have reached had it been up when the turn ended.
pub(super) fn restored_settlement(tail: &[String]) -> RestoredSettlement {
    use super::classify::{
        classify_parked, worker_turn_end, HungKind, ParkedVerdict, WorkerTurnEnd,
    };
    // `grew_recently = false`: the app was down, so nothing about the
    // transcript is "recent" and a flat tail is exactly what we are reading.
    match classify_parked(tail, None, false) {
        ParkedVerdict::Done { summary } => match worker_turn_end(Some(&summary)) {
            WorkerTurnEnd::Declared { summary } => RestoredSettlement::Finished {
                reason: format!("Task complete: {summary}"),
            },
            WorkerTurnEnd::Unmarked { reason } => RestoredSettlement::Finished { reason },
            WorkerTurnEnd::Blocked { reason } => RestoredSettlement::Blocked { reason },
            // A limit banner as the final text: the limit-retry lane owns
            // that shape and needs a process to act on. Nothing to settle.
            WorkerTurnEnd::Limit { .. } => RestoredSettlement::Leave,
        },
        ParkedVerdict::Hung(HungKind::MidTool) => RestoredSettlement::Killed {
            reason: "Killed inside a tool call before the app restarted — the transcript \
                     ends on a tool call that never returned. Its worktree may hold \
                     unfinished work; nothing was declared."
                .to_string(),
        },
        _ => RestoredSettlement::Leave,
    }
}

/// Apply [`restored_settlement`] to one restored one-shot worker. Returns
/// `true` when the row was settled (and persisted), `false` when the caller
/// should fall through to the pre-existing recovery rules.
fn settle_restored_worker(
    app: &AppHandle,
    session_id: &str,
    claude_session_id: Option<&str>,
) -> bool {
    let Some(csid) = claude_session_id else {
        return false;
    };
    let Some(tail) = super::transcript_read::tail_lines(csid) else {
        return false;
    };
    let (to, reason) = match restored_settlement(&tail) {
        RestoredSettlement::Finished { reason } => (FleetSessionState::Finished, reason),
        RestoredSettlement::Killed { reason } => (FleetSessionState::Stale, reason),
        RestoredSettlement::Blocked { reason } => (FleetSessionState::AwaitingInput, reason),
        RestoredSettlement::Leave => return false,
    };
    let Some(prev) = registry().settle_restored(session_id, to, &reason) else {
        return false;
    };
    tracing::info!(
        session_id,
        from = prev,
        to = state_to_token(to),
        reason = %reason,
        "fleet: restored one-shot worker settled from its transcript"
    );
    super::pty::emit_registry_changed(app, "updated", session_id);
    true
}

#[cfg(test)]
mod tests {
    use super::super::types::FleetSessionMode;
    use super::*;

    fn assistant_text(text: &str) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": { "content": [ { "type": "text", "text": text } ] }
        })
        .to_string()
    }

    fn assistant_tool_use(id: &str, name: &str) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": { "content": [ { "type": "tool_use", "id": id, "name": name, "input": {} } ] }
        })
        .to_string()
    }

    fn tool_result(id: &str) -> String {
        serde_json::json!({
            "type": "user",
            "message": { "content": [ { "type": "tool_result", "tool_use_id": id, "content": "ok" } ] }
        })
        .to_string()
    }

    /// bank-contracts 672ce81d: the tail is a green `git status` result and a
    /// closing summary. That is a FINISHED worker, whatever a silence timer
    /// says three restarts later.
    #[test]
    fn a_trailing_summary_with_nothing_outstanding_is_a_finished_worker() {
        let tail = vec![
            assistant_tool_use("t1", "Bash"),
            tool_result("t1"),
            assistant_text("Done. Delivery branch is clean, main fast-forwards onto it."),
        ];
        match restored_settlement(&tail) {
            RestoredSettlement::Finished { reason } => {
                assert!(
                    reason.starts_with(super::super::classify::UNMARKED_END_PREFIX),
                    "no completion line was declared, so none is forged: {reason}"
                );
                assert!(reason.contains("Delivery branch is clean"));
            }
            other => panic!("expected Finished, got {other:?}"),
        }
    }

    #[test]
    fn a_declared_completion_keeps_its_task_complete_prefix() {
        let tail = vec![assistant_text(
            "FLEET:DONE — shipped the parser and its tests",
        )];
        match restored_settlement(&tail) {
            RestoredSettlement::Finished { reason } => {
                assert!(reason.starts_with("Task complete: "), "{reason}");
                assert!(reason.contains("shipped the parser"));
            }
            other => panic!("expected Finished, got {other:?}"),
        }
    }

    /// bank-contracts c24eb093: a Bash `tool_use` resolving a merge conflict,
    /// no `tool_result` ever written. KILLED, and the reason says so.
    #[test]
    fn a_dangling_tool_call_is_a_killed_worker() {
        let tail = vec![
            assistant_text("Resolving the conflict in context-map.json."),
            assistant_tool_use("t9", "Bash"),
        ];
        match restored_settlement(&tail) {
            RestoredSettlement::Killed { reason } => {
                assert!(reason.contains("Killed inside a tool call"), "{reason}");
            }
            other => panic!("expected Killed, got {other:?}"),
        }
    }

    #[test]
    fn a_blocked_declaration_parks_awaiting_and_a_limit_banner_is_left_alone() {
        let blocked = vec![assistant_text(
            "FLEET:BLOCKED — the vault has no GitHub token",
        )];
        assert!(matches!(
            restored_settlement(&blocked),
            RestoredSettlement::Blocked { .. }
        ));
        let limit = vec![assistant_text(
            "You've reached your Fable limit. Switch to another model, or manage usage.",
        )];
        assert_eq!(restored_settlement(&limit), RestoredSettlement::Leave);
        assert_eq!(restored_settlement(&[]), RestoredSettlement::Leave);
    }

    fn sample_inner() -> FleetSessionInner {
        FleetSessionInner {
            id: "sess-1".into(),
            claude_session_id: Some("cc-9".into()),
            cwd: std::path::PathBuf::from("C:/repo/personas"),
            project_label: "personas".into(),
            name: Some("refactor".into()),
            title: Some("Refactor the fleet".into()),
            athena_active_until_ms: 0,
            args: vec!["--session-id".into(), "cc-9".into()],
            mode: FleetSessionMode::Interactive,
            cols: 120,
            rows: 32,
            state: FleetSessionState::AwaitingInput,
            last_activity_ms: 1_700_000_100,
            last_pty_output_ms: 1_700_000_050,
            last_grew_ms: 1_700_000_020,
            created_at_ms: 1_700_000_000,
            child_pid: Some(4242),
            exit_code: None,
            state_reason: Some("Notification: permission requested".into()),
            limit_reset_at_ms: 0,
            run_id: Some("run-a".into()),
            run_label: Some("perfect round 9".into()),
            stale_kind: None,
            queue_rank: None,
            queued_at_ms: None,
            not_before_ms: None,
            origin: None,
            persona_id: None,
            goal_id: None,
            cycle_index: None,
            admission: Default::default(),
            master: Mutex::new(None),
            writer: Mutex::new(None),
            hibernating: AtomicBool::new(false),
            dozing: false,
            reaped: false,
            output: Arc::new(Mutex::new(OutputRing::new(1024))),
            killer: None,
        }
    }

    #[test]
    fn row_round_trips_the_rehydratable_identity() {
        let inner = sample_inner();
        let row = row_from_inner(&inner).expect("bound session persists");
        assert_eq!(row.id, "sess-1");
        assert_eq!(row.claude_session_id, "cc-9");
        assert_eq!(row.state, "awaiting_input");
        assert_eq!(row.mode, "interactive");
        assert_eq!(row.args_json, r#"["--session-id","cc-9"]"#);

        let back = inner_from_row(&row);
        assert_eq!(back.id, inner.id);
        assert_eq!(back.claude_session_id, inner.claude_session_id);
        assert_eq!(back.cwd, inner.cwd);
        assert_eq!(back.project_label, inner.project_label);
        assert_eq!(back.name, inner.name);
        assert_eq!(back.title, inner.title);
        assert_eq!(back.args, inner.args);
        assert_eq!(back.state, inner.state);
        assert_eq!(back.run_id, inner.run_id);
        assert_eq!(back.run_label, inner.run_label);
        // Lineage preserved → the grid tile keeps its slot after a restart.
        assert_eq!(back.created_at_ms, inner.created_at_ms);
    }

    #[test]
    fn a_queued_row_restores_as_a_queued_row_not_a_tombstone() {
        let mut inner = sample_inner();
        inner.state = FleetSessionState::Queued;
        inner.child_pid = None;
        inner.queue_rank = Some(3);
        inner.queued_at_ms = Some(1_700_000_000);
        inner.not_before_ms = Some(1_700_000_500);
        inner.origin = Some("autopilot".into());
        inner.persona_id = Some("p-1".into());
        inner.goal_id = Some("g-1".into());
        inner.cycle_index = Some(7);
        let row = row_from_inner(&inner).unwrap();
        assert_eq!(row.state, "queued");
        assert_eq!(row.queue_rank, Some(3));
        let back = inner_from_row(&row);
        assert_eq!(back.state, FleetSessionState::Queued);
        assert!(!back.dozing, "a queued row never had a process to doze");
        assert!(back.child_pid.is_none());
        assert_eq!(back.queue_rank, Some(3));
        assert_eq!(back.queued_at_ms, Some(1_700_000_000));
        assert_eq!(back.not_before_ms, Some(1_700_000_500));
        assert_eq!(back.origin.as_deref(), Some("autopilot"));
        assert_eq!(back.persona_id.as_deref(), Some("p-1"));
        assert_eq!(back.goal_id.as_deref(), Some("g-1"));
        assert_eq!(back.cycle_index, Some(7));
        // A promoted row keeps its provenance but not its rank.
        let mut promoted = row.clone();
        promoted.state = "running".into();
        let back = inner_from_row(&promoted);
        assert_eq!(back.queue_rank, None);
        assert_eq!(back.origin.as_deref(), Some("autopilot"));
    }

    #[test]
    fn rehydrated_row_is_a_wakeable_dozing_tombstone() {
        let row = row_from_inner(&sample_inner()).unwrap();
        let back = inner_from_row(&row);
        // Dozing + no pid = light sleep, the shape the wake path resumes.
        assert!(back.dozing);
        assert!(back.child_pid.is_none());
        // Never-attached / frozen-mid-run checks must not fire on it.
        assert_eq!(back.last_pty_output_ms, 0);
        assert!(back
            .state_reason
            .as_deref()
            .unwrap()
            .contains("restored after restart"));
    }

    #[test]
    fn the_restore_marker_is_written_once_however_many_boots() {
        let once = restored_reason(Some("No log growth for 6 min"));
        assert_eq!(once, "No log growth for 6 min · restored after restart");
        // Each boot re-reads the reason the previous boot persisted.
        let mut reason = once.clone();
        for _ in 0..5 {
            reason = restored_reason(Some(&reason));
        }
        assert_eq!(reason, once);
        assert!(restored_reason(None).starts_with("Restored after restart"));
    }

    #[test]
    fn unbound_sessions_are_not_persisted() {
        let mut inner = sample_inner();
        inner.claude_session_id = None;
        assert!(row_from_inner(&inner).is_none());
    }

    #[test]
    fn spawning_and_unknown_states_restore_as_stale() {
        let mut row = row_from_inner(&sample_inner()).unwrap();
        row.state = "spawning".into();
        assert_eq!(inner_from_row(&row).state, FleetSessionState::Stale);
        row.state = "some_future_state".into();
        assert_eq!(inner_from_row(&row).state, FleetSessionState::Stale);
        // Real parked states survive verbatim.
        row.state = "finished".into();
        assert_eq!(inner_from_row(&row).state, FleetSessionState::Finished);
        row.state = "hibernated".into();
        assert_eq!(inner_from_row(&row).state, FleetSessionState::Hibernated);
    }
}
