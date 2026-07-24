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

use super::registry::{now_ms, registry, FleetSessionInner, OutputRing, OUTPUT_RING_CAP};
use super::types::{
    mode_to_token, state_to_token, token_to_mode, token_to_state, FleetSessionState,
};

/// Terminal rows older than this are dropped on boot — a day-old exited
/// session has no recovery value, and the table should not grow without bound.
const EXITED_RETENTION_MS: i64 = 24 * 60 * 60 * 1000;

enum Job {
    Upsert(Box<FleetSessionRow>),
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
                        Job::Upsert(row) => fleet_sessions::upsert(&pool, row),
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
        let map = registry().sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).and_then(row_from_inner)
    };
    let Some(row) = row else { return };
    enqueue(app, Job::Upsert(Box::new(row)));
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
    })
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
        state_reason: Some(
            row.state_reason
                .clone()
                .map(|r| format!("{r} · restored after restart"))
                .unwrap_or_else(|| "Restored after restart — select to resume".to_string()),
        ),
        run_id: row.run_id.clone(),
        run_label: row.run_label.clone(),
        master: Mutex::new(None),
        writer: Mutex::new(None),
        hibernating: AtomicBool::new(false),
        dozing: true,
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
    for row in &rows {
        // A live row already owns this id (the app relaunched fast enough that
        // something respawned first) — never clobber a real process.
        if registry().session_state(&row.id).is_some() {
            continue;
        }
        registry().insert(inner_from_row(row));
        restored += 1;
    }
    if restored > 0 {
        tracing::info!(restored, "fleet: rehydrated sessions from the durable registry");
        super::pty::emit_registry_changed(app, "rehydrated", "");
    }
    restored
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::FleetSessionMode;

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
            run_id: Some("run-a".into()),
            run_label: Some("perfect round 9".into()),
            master: Mutex::new(None),
            writer: Mutex::new(None),
            hibernating: AtomicBool::new(false),
            dozing: false,
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
