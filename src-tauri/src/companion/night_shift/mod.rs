//! Night Shift — Athena as the JUDGMENT layer over unattended overnight
//! work (moonshot batch-2, `ai-companion.md` #2).
//!
//! **Standup absorbed the planning half on 2026-11-06** (spark app-standup,
//! `companion::standup`). The evening `night_plan` job, its
//! `night_shift_execute_plan` approval card and the morning report are gone:
//! the operator plans day AND night on the Standup page, an armed standup
//! queues night work with `not_before_ms` at the night start, and the
//! "since last standup" report replaces the morning report. Nothing creates a
//! `companion_night_plan` row any more.
//!
//! What remains here, all reading the legacy ledger:
//!   - **Unattended guidance** ([`unattended`]): while an approved plan's
//!     night window is open, a fleet worker's blocking
//!     `athena.request_guidance` that no human resolves within T minutes is
//!     answered by Athena; destructive `athena.request_approval` is ALWAYS
//!     parked. With no new plans this is inert; the standup supervisor owns
//!     away asks now.
//!   - **Review station** (`jobs/session_review.rs` + [`review`]): a dispatched
//!     session of a still-open legacy window gets a branch review.
//!   - **The sleep-cycle heartbeat** ([`tick`]), which is memory maintenance,
//!     not night-shift autonomy, and runs regardless of the night-shift flag.
//!   - [`record_event`]: the `companion_night_event` writer, which the memory
//!     lifecycle sweep (`brain::consolidation`) also uses.

pub mod review;
pub mod unattended;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::companion::brain::sleep_cycle;
use crate::db::repos::core::settings;
use crate::db::settings_keys as keys;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// Event kinds on the `companion_night_event` audit ledger.
pub const EVENT_DISPATCH: &str = "dispatch";
pub const EVENT_UNATTENDED_GUIDANCE: &str = "unattended_guidance";
pub const EVENT_APPROVAL_PARKED: &str = "approval_parked";
pub const EVENT_REVIEW_ENQUEUED: &str = "review_enqueued";
pub const EVENT_REVIEW_VERDICT: &str = "review_verdict";

/// One night plan row. `plan_json` is the bounded [`planner::DraftPlan`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightPlan {
    pub id: String,
    /// proposed → approved → running → completed | declined | expired
    pub status: String,
    pub summary: String,
    pub plan_json: String,
    /// RFC3339 UTC end of the night window (wake time). Set at approval.
    pub window_end: Option<String>,
    pub max_sessions: i64,
    pub created_at: String,
    pub approved_at: Option<String>,
    pub completed_at: Option<String>,
}

fn map_plan(row: &rusqlite::Row<'_>) -> rusqlite::Result<NightPlan> {
    Ok(NightPlan {
        id: row.get(0)?,
        status: row.get(1)?,
        summary: row.get(2)?,
        plan_json: row.get(3)?,
        window_end: row.get(4)?,
        max_sessions: row.get(5)?,
        created_at: row.get(6)?,
        approved_at: row.get(7)?,
        completed_at: row.get(8)?,
    })
}

const PLAN_COLUMNS: &str = "id, status, summary, plan_json, window_end, max_sessions, created_at, approved_at, completed_at";

/// The plan whose night window is currently open (approved or running, window
/// not yet ended). At most one is expected; newest wins if data drifts.
pub fn active_plan(pool: &UserDbPool) -> Result<Option<NightPlan>, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let row = conn
        .query_row(
            &format!(
                "SELECT {PLAN_COLUMNS} FROM companion_night_plan
                 WHERE status IN ('approved', 'running')
                   AND window_end IS NOT NULL AND window_end > ?1
                 ORDER BY created_at DESC LIMIT 1"
            ),
            params![now],
            map_plan,
        )
        .optional()?;
    Ok(row)
}

/// Append one row to the night audit ledger. Best-effort by design at most
/// call sites (the act already happened; the ledger must never abort it) —
/// callers that need the error can use the Result.
pub fn record_event(
    pool: &UserDbPool,
    plan_id: Option<&str>,
    kind: &str,
    fleet_session_id: Option<&str>,
    project_label: Option<&str>,
    payload: &serde_json::Value,
) -> Result<String, AppError> {
    let id = format!("nev_{}", crate::companion::util::short_id(10));
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_night_event
            (id, plan_id, kind, fleet_session_id, project_label, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            plan_id,
            kind,
            fleet_session_id,
            project_label,
            payload.to_string(),
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(id)
}

/// (fleet_session_id, payload_json) pairs for one event kind on a plan.
pub fn events_for_plan(
    pool: &UserDbPool,
    plan_id: &str,
    kind: &str,
) -> Result<Vec<(Option<String>, String)>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT fleet_session_id, payload_json FROM companion_night_event
         WHERE plan_id = ?1 AND kind = ?2 ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(params![plan_id, kind], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn session_has_event(
    pool: &UserDbPool,
    plan_id: &str,
    kind: &str,
    fleet_session_id: &str,
) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let hit: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM companion_night_event
             WHERE plan_id = ?1 AND kind = ?2 AND fleet_session_id = ?3 LIMIT 1",
            params![plan_id, kind, fleet_session_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(hit.is_some())
}

// ── Settings readers ───────────────────────────────────────────────────────

pub fn enabled(sys_db: &DbPool) -> bool {
    settings::get(sys_db, keys::COMPANION_NIGHT_SHIFT)
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(keys::COMPANION_NIGHT_SHIFT_DEFAULT)
}

fn setting_u32(sys_db: &DbPool, key: &str, default: u32) -> u32 {
    settings::get(sys_db, key)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(default)
}

/// Minutes an unresolved `request_guidance` waits for a human before the
/// unattended policy answers. Clamped 1..=8 so it always undershoots the
/// 10-minute MCP request TTL.
pub fn guidance_minutes(sys_db: &DbPool) -> u64 {
    (setting_u32(
        sys_db,
        keys::COMPANION_NIGHT_SHIFT_GUIDANCE_MINUTES,
        keys::COMPANION_NIGHT_SHIFT_GUIDANCE_MINUTES_DEFAULT,
    ) as u64)
        .clamp(1, 8)
}

// ── Scheduler tick ─────────────────────────────────────────────────────────

/// One night-shift tick, called from the proactive scheduler. Best-effort:
/// every leg logs-and-continues so one failure can't stall the others.
///
/// `_app` is kept for the caller's signature: it fed the morning report, which
/// the standup report replaced (spark app-standup).
pub fn tick(user_db: &UserDbPool, sys_db: &DbPool, _app: &tauri::AppHandle) {
    // The sleep cycle runs BEFORE the night-shift enable gate, deliberately.
    // It is memory maintenance, not autonomy — the operator's 2026-08-08
    // ruling decoupled it from night-shift consent, and its spend is governed
    // by its own pressure model (threshold/floor/staleness in
    // `brain::sleep_cycle`), not by this flag. L1c removed the
    // `night_window_active` gate inside the admission but left the call BELOW
    // the `enabled()` early return one level up, so on the default-off
    // night-shift setting the heartbeat never beat: 110k chars of pressure
    // accumulated live on 2026-08-09 with zero automatic cycles. The fix that
    // lands on an unreachable path ships nothing — again.
    if let Err(e) = maybe_run_sleep_cycle(user_db) {
        tracing::warn!(error = %e, "night_shift: sleep-cycle admission failed");
    }
    if !enabled(sys_db) {
        return;
    }
    // No plan job is enqueued here any more: the standup plans the night
    // (spark app-standup). The review sweep still serves a legacy window that
    // was open when the app updated.
    if let Err(e) = review_sweep(user_db) {
        tracing::warn!(error = %e, "night_shift: review sweep failed");
    }
}

/// How often this tick is allowed to weigh sleep pressure.
///
/// The scheduler ticks every 30 seconds. Admission is no longer a single
/// indexed read — under the pressure model it fetches and sums the conversation
/// window (`sleep_cycle::measure`) — so measuring on every tick would re-read
/// the same episodes 120 times an hour to answer "not yet" 119 of them. Ten
/// minutes is far below the 6h floor, so throttling costs no responsiveness:
/// the worst case is that a cycle starts up to ten minutes after the pressure
/// crossed the line, on a job that takes minutes and runs at most every 6h.
const PRESSURE_CHECK_INTERVAL: Duration = Duration::from_secs(10 * 60);

/// When the last pressure measurement ran. In-process and best-effort — a
/// restart simply measures once more, which is harmless.
static LAST_PRESSURE_CHECK: Mutex<Option<Instant>> = Mutex::new(None);

/// True at most once per [`PRESSURE_CHECK_INTERVAL`].
fn pressure_check_due() -> bool {
    let now = Instant::now();
    let mut slot = match LAST_PRESSURE_CHECK.lock() {
        Ok(g) => g,
        // A poisoned lock must not silently stop the heartbeat forever.
        Err(e) => e.into_inner(),
    };
    match *slot {
        Some(prev) if now.duration_since(prev) < PRESSURE_CHECK_INTERVAL => false,
        _ => {
            *slot = Some(now);
            true
        }
    }
}

/// Run Athena's memory sleep cycle (`brain::sleep_cycle`) when enough new
/// conversation has accumulated — compress it into long-term memory, reconcile
/// it, report what it would forget.
///
/// **This is the heartbeat the memory model never had.** Every maintenance
/// capability under `brain/` was reachable only from a button
/// (`companion_consolidation`: 0 rows in 77 days), so the corpus only ever
/// grew. The sleep cycle is a new job family for THIS scheduler rather than new
/// infrastructure, which is the whole reason phase L1 fits in one wave —
/// `docs/plans/athena-longevity.md`, "the heartbeat already exists".
///
/// **No longer gated on `night_window_active`** (L1c). That gate means "the
/// operator approved a night plan", and it guards *autonomy-answering* — Athena
/// acting on the fleet unattended. Memory maintenance is not that: it reads the
/// conversation she already had and writes to her own index. Requiring a plan
/// approval for it meant a user who never approved one got no memory
/// consolidation at all, ever, while the heartbeat looked shipped. The
/// night-shift `enabled` flag in `tick` still gates the whole family, so the
/// spend consent is still explicit; what changed is that it no longer needs a
/// second, unrelated approval on top.
///
/// Admission is synchronous and only a successful one spawns. That ordering is
/// deliberate: calling the one-shot `run_sleep_cycle` inside a spawn instead
/// would create a task per tick that exists only to discover it must skip. The
/// single-flight guard travels inside the admission, so it is held from here
/// until the spawned task ends — a double-spawn is impossible rather than
/// merely harmless.
fn maybe_run_sleep_cycle(user_db: &UserDbPool) -> Result<(), AppError> {
    if !pressure_check_due() {
        return Ok(());
    }
    match sleep_cycle::admit(user_db, false)? {
        sleep_cycle::CycleAdmission::Admitted(admitted) => {
            let cycle_id = admitted.cycle_id().to_string();
            let pool = user_db.clone();
            tracing::info!(cycle_id = %cycle_id, "night_shift: sleep cycle starting");
            tauri::async_runtime::spawn(async move {
                match sleep_cycle::run_admitted(&pool, admitted).await {
                    Ok(outcome) => {
                        tracing::info!(?outcome, "night_shift: sleep cycle finished")
                    }
                    // The cycle itself records its own failure as a `failed`
                    // row; reaching here means even THAT could not be written.
                    Err(e) => tracing::warn!(
                        error = %e, cycle_id = %cycle_id,
                        "night_shift: sleep cycle could not be closed out"
                    ),
                }
            });
        }
        // The overwhelmingly common branch — the interval has not elapsed.
        // Debug, not warn: "not yet" is the correct answer on almost every tick.
        sleep_cycle::CycleAdmission::Skipped(reason) => {
            tracing::debug!(reason, "night_shift: sleep cycle not due");
        }
    }
    Ok(())
}

/// For the running plan: any dispatched session that has reached a terminal
/// state (exited/finished, or vanished from the registry) and has no review
/// yet gets a `session_review` job. `review_enqueued` events dedupe the sweep.
fn review_sweep(user_db: &UserDbPool) -> Result<(), AppError> {
    let Some(plan) = active_plan(user_db)? else {
        return Ok(());
    };
    if plan.status != "running" {
        return Ok(());
    }
    for (session_id, payload) in events_for_plan(user_db, &plan.id, EVENT_DISPATCH)? {
        let Some(sid) = session_id else { continue };
        if session_has_event(user_db, &plan.id, EVENT_REVIEW_ENQUEUED, &sid)? {
            continue;
        }
        let terminal = match crate::commands::fleet::registry::registry().session_state(&sid) {
            None => true, // gone from the registry — treat as exited
            Some(s) => matches!(
                s,
                crate::commands::fleet::types::FleetSessionState::Exited
                    | crate::commands::fleet::types::FleetSessionState::Finished
            ),
        };
        if !terminal {
            continue;
        }
        let dispatch: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::json!({}));
        let params = serde_json::json!({
            "planId": plan.id,
            "sessionId": sid,
            "cwd": dispatch.get("cwd").and_then(|v| v.as_str()).unwrap_or(""),
            "project": dispatch.get("project").and_then(|v| v.as_str()).unwrap_or(""),
            "objective": dispatch.get("objective").and_then(|v| v.as_str()).unwrap_or(""),
        });
        crate::companion::jobs::enqueue_task(
            user_db,
            crate::companion::jobs::session_review::KIND,
            &params,
            None,
            Some("Reviewing a night-shift session"),
            None,
            None,
        )?;
        record_event(
            user_db,
            Some(&plan.id),
            EVENT_REVIEW_ENQUEUED,
            Some(&sid),
            dispatch.get("project").and_then(|v| v.as_str()),
            &serde_json::json!({}),
        )?;
    }
    Ok(())
}
