//! Night Shift v1 — Athena as the JUDGMENT layer over unattended overnight
//! work (moonshot batch-2, `ai-companion.md` #2, steps 1-3 + 5).
//!
//! The loop:
//!   1. **Plan** (`jobs/night_plan.rs` + [`planner`]): in the evening, one
//!      CLI call reads goals + backlog + registered projects + dev memories
//!      and emits a bounded plan (≤ N sessions, per-repo scope, stop
//!      conditions). The plan lands as a `companion_approval` card
//!      (`night_shift_execute_plan`) — NO plan runs unapproved.
//!   2. **Unattended guidance** ([`unattended`]): while an approved plan's
//!      night window is open, a fleet worker's blocking
//!      `athena.request_guidance` that no human resolves within T minutes is
//!      answered by Athena from dev-memories + decision precedent; every
//!      answer is episode- AND decision-logged. Destructive
//!      `athena.request_approval` is ALWAYS parked (denied with a park note),
//!      never auto-approved.
//!   3. **Review station** (`jobs/session_review.rs` + [`review`]): when a
//!      dispatched session exits, a job diffs its branch and classifies
//!      ship-to-branch / park-for-human / retry-with-feedback. Branch-only
//!      writes are verified — a session that committed to the default branch
//!      is parked and flagged.
//!   5. **Morning report** (`proactive::rollup::compose_night_report`): the
//!      first proactive message at wake rolls up dispatched / reviewed /
//!      parked / answered. It deliberately references (not duplicates) the
//!      batch-1 Morning Director (`brain/briefing.rs`) — this is a rollup
//!      card, not a second briefing composer.
//!
//! Autonomy grammar: every act is *attributed* (plan id + fleet session id on
//! each `companion_night_event` row), *audited* (the event ledger is
//! append-only), *bounded* (plan bounding + registered-project allowlist +
//! session cap refuse BEFORE dispatch), and *reversible or parked* (workers
//! write to branches only; anything destructive parks for a human).
//!
//! Trust ledger + multi-night campaigns are deferred by design.

pub mod planner;
pub mod review;
pub mod unattended;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{Duration as ChronoDuration, Local, TimeZone, Timelike, Utc};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::companion::brain::sleep_cycle;
use crate::db::repos::core::settings;
use crate::db::settings_keys as keys;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

/// Hard ceiling on sessions per night regardless of settings — the bound the
/// pre-check refuses past, never apologizes after.
pub const MAX_SESSIONS_CEILING: usize = 6;

/// A proposed plan that was never approved expires after this many hours so a
/// slept-through card can't be approved days later against a stale backlog.
const PROPOSED_EXPIRY_HOURS: i64 = 18;

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

pub fn insert_plan(
    pool: &UserDbPool,
    summary: &str,
    plan_json: &str,
    max_sessions: usize,
) -> Result<NightPlan, AppError> {
    let id = format!("nplan_{}", crate::companion::util::short_id(10));
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_night_plan (id, status, summary, plan_json, max_sessions, created_at)
         VALUES (?1, 'proposed', ?2, ?3, ?4, ?5)",
        params![id, summary, plan_json, max_sessions as i64, now],
    )?;
    Ok(NightPlan {
        id,
        status: "proposed".into(),
        summary: summary.to_string(),
        plan_json: plan_json.to_string(),
        window_end: None,
        max_sessions: max_sessions as i64,
        created_at: now,
        approved_at: None,
        completed_at: None,
    })
}

pub fn get_plan(pool: &UserDbPool, id: &str) -> Result<Option<NightPlan>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            &format!("SELECT {PLAN_COLUMNS} FROM companion_night_plan WHERE id = ?1"),
            params![id],
            map_plan,
        )
        .optional()?;
    Ok(row)
}

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

pub fn set_plan_status(pool: &UserDbPool, id: &str, status: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let (approved_at, completed_at): (Option<&str>, Option<&str>) = match status {
        "approved" | "running" => (Some(now.as_str()), None),
        "completed" | "declined" | "expired" => (None, Some(now.as_str())),
        _ => (None, None),
    };
    conn.execute(
        "UPDATE companion_night_plan
         SET status = ?1,
             approved_at = COALESCE(approved_at, ?2),
             completed_at = COALESCE(completed_at, ?3)
         WHERE id = ?4",
        params![status, approved_at, completed_at, id],
    )?;
    Ok(())
}

pub fn set_window_end(pool: &UserDbPool, id: &str, window_end_iso: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_night_plan SET window_end = ?1 WHERE id = ?2",
        params![window_end_iso, id],
    )?;
    Ok(())
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

pub fn plan_hour(sys_db: &DbPool) -> u32 {
    setting_u32(
        sys_db,
        keys::COMPANION_NIGHT_SHIFT_PLAN_HOUR,
        keys::COMPANION_NIGHT_SHIFT_PLAN_HOUR_DEFAULT,
    )
    .min(23)
}

pub fn wake_hour(sys_db: &DbPool) -> u32 {
    setting_u32(
        sys_db,
        keys::COMPANION_NIGHT_SHIFT_WAKE_HOUR,
        keys::COMPANION_NIGHT_SHIFT_WAKE_HOUR_DEFAULT,
    )
    .min(23)
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

pub fn max_sessions(sys_db: &DbPool) -> usize {
    (setting_u32(
        sys_db,
        keys::COMPANION_NIGHT_SHIFT_MAX_SESSIONS,
        keys::COMPANION_NIGHT_SHIFT_MAX_SESSIONS_DEFAULT,
    ) as usize)
        .clamp(1, MAX_SESSIONS_CEILING)
}

/// Next occurrence of `hour:00` local time, returned as RFC3339 UTC.
pub fn next_local_hour_utc(hour: u32) -> String {
    let now = Local::now();
    let mut day = now.date_naive();
    if now.hour() >= hour {
        day = day + ChronoDuration::days(1);
    }
    let naive = day.and_hms_opt(hour, 0, 0).unwrap_or_else(|| {
        day.and_hms_opt(0, 0, 0).expect("midnight is always valid")
    });
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) | chrono::LocalResult::Ambiguous(dt, _) => {
            dt.with_timezone(&Utc).to_rfc3339()
        }
        chrono::LocalResult::None => (Utc::now() + ChronoDuration::hours(8)).to_rfc3339(),
    }
}

// ── Scheduler tick ─────────────────────────────────────────────────────────

/// One night-shift tick, called from the proactive scheduler. Best-effort:
/// every leg logs-and-continues so one failure can't stall the others.
pub fn tick(user_db: &UserDbPool, sys_db: &DbPool, app: &tauri::AppHandle) {
    if !enabled(sys_db) {
        return;
    }
    if let Err(e) = expire_stale_proposed(user_db) {
        tracing::warn!(error = %e, "night_shift: proposed-plan expiry failed");
    }
    if let Err(e) = maybe_enqueue_plan_job(user_db, sys_db) {
        tracing::warn!(error = %e, "night_shift: plan-job enqueue failed");
    }
    if let Err(e) = review_sweep(user_db) {
        tracing::warn!(error = %e, "night_shift: review sweep failed");
    }
    if let Err(e) = maybe_run_sleep_cycle(user_db) {
        tracing::warn!(error = %e, "night_shift: sleep-cycle admission failed");
    }
    if let Err(e) = maybe_emit_morning_report(user_db, app) {
        tracing::warn!(error = %e, "night_shift: morning report failed");
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

/// A proposed plan the user never approved goes stale rather than lingering
/// as an approvable card against yesterday's backlog.
fn expire_stale_proposed(pool: &UserDbPool) -> Result<(), AppError> {
    let cutoff = (Utc::now() - ChronoDuration::hours(PROPOSED_EXPIRY_HOURS)).to_rfc3339();
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_night_plan
         SET status = 'expired', completed_at = ?2
         WHERE status = 'proposed' AND created_at < ?1",
        params![cutoff, now],
    )?;
    Ok(())
}

/// Enqueue tonight's `night_plan` job once per local day at/after the plan
/// hour — unless a plan for tonight already exists in any live status.
fn maybe_enqueue_plan_job(user_db: &UserDbPool, sys_db: &DbPool) -> Result<(), AppError> {
    let now = Local::now();
    if now.hour() < plan_hour(sys_db) {
        return Ok(());
    }
    let today = now.format("%Y-%m-%d").to_string();
    let last = settings::get(sys_db, keys::COMPANION_NIGHT_SHIFT_PLAN_LAST)?.unwrap_or_default();
    if last == today {
        return Ok(());
    }
    // A live plan (tonight's proposal still pending, or a window still open)
    // blocks a new proposal.
    {
        let conn = user_db.get()?;
        let live: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM companion_night_plan
                 WHERE status IN ('proposed', 'approved', 'running') LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if live.is_some() {
            return Ok(());
        }
    }
    crate::companion::jobs::enqueue_task(
        user_db,
        crate::companion::jobs::night_plan::KIND,
        &serde_json::json!({}),
        None,
        Some("Planning tonight's night shift"),
        None,
        None,
    )?;
    settings::set(sys_db, keys::COMPANION_NIGHT_SHIFT_PLAN_LAST, &today)?;
    tracing::info!("night_shift: night-plan job enqueued for {today}");
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

/// Once the window has ended, roll the night up into the first proactive
/// message at wake and close the plan. The report references the batch-1
/// Morning Director rather than composing a second briefing.
fn maybe_emit_morning_report(user_db: &UserDbPool, app: &tauri::AppHandle) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = user_db.get()?;
    let plan = conn
        .query_row(
            &format!(
                "SELECT {PLAN_COLUMNS} FROM companion_night_plan
                 WHERE status IN ('approved', 'running')
                   AND window_end IS NOT NULL AND window_end <= ?1
                 ORDER BY created_at DESC LIMIT 1"
            ),
            params![now],
            map_plan,
        )
        .optional()?;
    drop(conn);
    let Some(plan) = plan else { return Ok(()) };

    let body = crate::companion::proactive::rollup::compose_night_report(user_db, &plan)?;
    let nudge = crate::companion::proactive::Nudge {
        trigger_kind: "night_shift_report".to_string(),
        trigger_ref: Some(plan.id.clone()),
        message: body,
    };
    match crate::companion::proactive::enqueue_external(user_db, &nudge) {
        Ok(Some(msg)) => crate::companion::proactive::deliver_now(user_db, app, msg),
        Ok(None) => {}
        Err(e) => tracing::warn!(error = %e, "night_shift: report enqueue failed"),
    }
    set_plan_status(user_db, &plan.id, "completed")?;
    Ok(())
}
