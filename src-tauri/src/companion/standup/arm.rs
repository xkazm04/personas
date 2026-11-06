//! Arming a revision: direction -> charter amendment + attention loop for the
//! project + queued dispatch (`not_before_ms` by window); create/retune via the
//! existing approval ops; idempotent per revision. WP1 owns.
//!
//! The go-gate in two halves:
//!
//! - [`arm_with`] — synchronous, over an [`ArmEffects`] seam so the decisions
//!   are unit-tested without an app: claim `draft -> armed` (one
//!   compare-and-swap, which is what makes the arm idempotent per revision),
//!   walk the accepted/edited items, refuse an item whose project a live
//!   headless App Master holds, route each direction (charter or fleet
//!   queue), retune personas, supersede the parent revision. Agent CREATES are
//!   returned, not run: they go through an async approval op.
//! - [`arm`] — the app's arm: [`AppArmEffects`] over the real doors, then the
//!   creates through the `build_oneshot` approval op (filed and approved by the
//!   go-gate itself), then ONE Athena brain episode for the decision round.
//!
//! Routes for an accepted `direction`:
//! - the project has an ACTIVE App Master charter (a mandate): its first
//!   outcome becomes the standup's direction and its attention cadence is
//!   switched on, through the operator's charter writer
//!   (`personas_engine::responsibility::update_from_input`). The window does
//!   not apply: the attention loop paces the charter.
//! - otherwise: a fleet dispatch through the ONE admission door
//!   (`fleet::queue::admit_sync`) with the direction as the task and
//!   `not_before_ms` from the item, else from its window (`night` = tonight's
//!   start, see [`night_start_ms`]; `day`/`any` = now).
//!
//! A carried item (copied from the armed parent unchanged) is not dispatched
//! again: its sessions are still running under the parent. A carried item the
//! parent refused (headless master) is retried.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveTime, TimeZone};
use tauri::{AppHandle, Manager};

use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;
use crate::AppState;

use super::model::{
    RetuneAgentSpec, Standup, StandupEvent, StandupEventKind, StandupItem, StandupItemKind,
    StandupItemState, StandupStatus, StandupWindow,
};
use super::{plan, report};

/// Outcome ids this module writes onto a charter start with this, so a later
/// arm replaces its own outcome and never touches the operator's.
const OUTCOME_PREFIX: &str = "standup:";

/// The night start when no `quiet_hours` ritual says otherwise.
const DEFAULT_NIGHT_FROM: (u32, u32) = (22, 0);
const DEFAULT_NIGHT_TO: (u32, u32) = (7, 0);

/// The real-world doors an arm goes through. A seam so [`arm_with`]'s
/// decisions (idempotency, refusal, routing, carry) are testable without an
/// app or a fleet.
pub trait ArmEffects {
    /// Why a live headless App Master holds `project_id`, when one does.
    fn headless_hold(&self, project_id: &str) -> Result<Option<String>, AppError>;
    /// The project's ACTIVE App Master charter id, if it has one.
    fn active_charter(&self, project_id: &str) -> Result<Option<String>, AppError>;
    /// Make `direction` the charter's first outcome and switch its attention
    /// cadence on.
    fn amend_charter(
        &self,
        charter_id: &str,
        outcome_id: &str,
        direction: &str,
        evidence: &str,
    ) -> Result<(), AppError>;
    /// Queue one fleet session for the project; returns its session id.
    fn dispatch(
        &self,
        project_id: &str,
        item: &StandupItem,
        direction: &str,
        not_before_ms: Option<i64>,
    ) -> Result<String, AppError>;
    /// Apply a retune; returns a one-line summary of what changed.
    fn retune(&self, spec: &RetuneAgentSpec) -> Result<String, AppError>;
    /// Write one away act (`report::append_event`). Best-effort: the act
    /// already happened, the ledger must never undo it.
    fn record(&self, event: &StandupEvent);
}

/// What one arm did.
#[derive(Debug, Clone)]
pub struct ArmOutcome {
    pub standup: Standup,
    /// False when the revision was already armed (the idempotent no-op).
    pub newly_armed: bool,
    /// One human line per dispatched / amended / retuned item.
    pub dispatched: Vec<String>,
    /// `(item id, reason)` for each item a headless App Master holds.
    pub refused: Vec<(String, String)>,
    /// One line per item that could not be carried out.
    pub failed: Vec<String>,
    /// `create_agent` items for the async approval op.
    pub creates: Vec<StandupItem>,
}

fn new_event_id() -> String {
    format!("ste_{}", uuid::Uuid::new_v4().simple())
}

pub(crate) fn event(
    standup_id: &str,
    at: i64,
    kind: StandupEventKind,
    project_id: Option<&str>,
    summary: String,
    detail: serde_json::Value,
) -> StandupEvent {
    StandupEvent {
        id: new_event_id(),
        standup_id: standup_id.to_string(),
        at,
        kind,
        project_id: project_id.map(str::to_string),
        summary,
        detail: Some(detail),
    }
}

/// The agreed direction: the operator's `chosen`, else (an accepted card the
/// operator did not type into) Athena's recommended proposal.
pub(crate) fn direction_text(item: &StandupItem) -> Option<String> {
    if let Some(c) = item
        .chosen
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        return Some(c.to_string());
    }
    item.proposals
        .iter()
        .find(|p| p.recommended)
        .or_else(|| item.proposals.first())
        .map(|p| p.text.trim().to_string())
        .filter(|t| !t.is_empty())
}

fn is_decided(item: &StandupItem) -> bool {
    matches!(
        item.state,
        StandupItemState::Accepted | StandupItemState::Edited
    )
}

/// True when the armed parent carried this item out unchanged, so its work is
/// still running and the child must not dispatch it again.
fn is_carried(item: &StandupItem, parent: Option<&Standup>, refused: &HashSet<String>) -> bool {
    let Some(parent) = parent else { return false };
    if !matches!(
        parent.status,
        StandupStatus::Armed | StandupStatus::Superseded
    ) {
        return false;
    }
    if refused.contains(&item.id) {
        return false;
    }
    parent.plan.items.iter().any(|p| {
        p.id == item.id
            && p.kind == item.kind
            && is_decided(p)
            && direction_text(p) == direction_text(item)
            && p.window == item.window
            && p.not_before_ms == item.not_before_ms
            && p.create_spec == item.create_spec
            && p.retune_spec == item.retune_spec
    })
}

fn charter_outcome_id(standup_id: &str, item_id: &str) -> String {
    format!("{OUTCOME_PREFIX}{standup_id}:{item_id}")
}

/// Arm a revision through `fx`. Idempotent per revision: an armed revision
/// returns unchanged with `newly_armed = false` and nothing dispatched; a
/// superseded or ended one refuses.
pub fn arm_with(
    pool: &UserDbPool,
    standup_id: &str,
    now_ms: i64,
    night_start_ms: i64,
    fx: &dyn ArmEffects,
) -> Result<ArmOutcome, AppError> {
    let s = plan::require(pool, standup_id)?;
    let noop = |s: Standup| ArmOutcome {
        standup: s,
        newly_armed: false,
        dispatched: Vec::new(),
        refused: Vec::new(),
        failed: Vec::new(),
        creates: Vec::new(),
    };
    match s.status {
        StandupStatus::Armed => return Ok(noop(s)),
        StandupStatus::Superseded | StandupStatus::Ended => {
            return Err(AppError::Validation(format!(
                "standup {standup_id} is {}; open the standup again to arm a new revision",
                plan::token(&s.status)?
            )))
        }
        StandupStatus::Draft => {}
    }
    if !plan::claim_armed(pool, standup_id, now_ms)? {
        // Lost the race to a concurrent arm (or an end): report what won.
        let now = plan::require(pool, standup_id)?;
        if now.status == StandupStatus::Armed {
            return Ok(noop(now));
        }
        return Err(AppError::Validation(format!(
            "standup {standup_id} is {} and cannot be armed",
            plan::token(&now.status)?
        )));
    }

    let parent = match s.parent_id.as_deref() {
        Some(pid) => plan::get(pool, pid)?,
        None => None,
    };
    let refused_before = plan::refused_item_ids(pool, standup_id)?;
    let mut out = ArmOutcome {
        standup: s.clone(),
        newly_armed: true,
        dispatched: Vec::new(),
        refused: Vec::new(),
        failed: Vec::new(),
        creates: Vec::new(),
    };

    let mut items = s.plan.items.clone();
    items.sort_by_key(|i| i.priority);
    for item in items.iter().filter(|i| is_decided(i)) {
        if is_carried(item, parent.as_ref(), &refused_before) {
            continue;
        }
        match item.kind {
            StandupItemKind::Direction => {
                arm_direction(standup_id, now_ms, night_start_ms, item, fx, &mut out)
            }
            StandupItemKind::RetuneAgent => {
                let Some(spec) = item.retune_spec.as_ref() else {
                    out.failed
                        .push(format!("{}: a retune card without a retune spec", item.id));
                    continue;
                };
                match fx.retune(spec) {
                    Ok(summary) => {
                        fx.record(&event(
                            standup_id,
                            now_ms,
                            StandupEventKind::AgentRetuned,
                            item.project_id.as_deref(),
                            summary.clone(),
                            serde_json::json!({
                                "itemId": item.id,
                                "personaId": spec.persona_id,
                                "pacingMinutes": spec.pacing_minutes,
                                "away": false,
                            }),
                        ));
                        out.dispatched.push(summary);
                    }
                    Err(e) => out.failed.push(format!("retune {}: {e}", spec.persona_id)),
                }
            }
            StandupItemKind::CreateAgent => {
                if item.create_spec.is_some() {
                    out.creates.push(item.clone());
                } else {
                    out.failed
                        .push(format!("{}: a create card without a create spec", item.id));
                }
            }
            // Filler is pulled by dead-spot backfill (WP2), never at the gate.
            StandupItemKind::Filler => {}
        }
    }

    if let Some(p) = parent.as_ref().filter(|p| p.status == StandupStatus::Armed) {
        if !plan::mark_superseded(pool, &p.id)? {
            // Ended (or superseded) between the read and now: nothing to retire.
            tracing::info!(standup_id, parent = %p.id, "standup: parent was no longer armed at supersede");
        }
    }
    out.standup = plan::require(pool, standup_id)?;
    Ok(out)
}

fn arm_direction(
    standup_id: &str,
    now_ms: i64,
    night_start_ms: i64,
    item: &StandupItem,
    fx: &dyn ArmEffects,
    out: &mut ArmOutcome,
) {
    let Some(project_id) = item.project_id.as_deref() else {
        out.failed
            .push(format!("{}: a direction card without a project", item.id));
        return;
    };
    let Some(direction) = direction_text(item) else {
        out.failed
            .push(format!("{project_id}: accepted with no direction text"));
        return;
    };
    match fx.headless_hold(project_id) {
        Ok(Some(reason)) => {
            fx.record(&event(
                standup_id,
                now_ms,
                StandupEventKind::Stop,
                Some(project_id),
                format!("Held, not dispatched: {reason}"),
                serde_json::json!({
                    "itemId": item.id,
                    "reason": plan::REFUSAL_HEADLESS_MASTER,
                    "note": reason,
                }),
            ));
            out.refused.push((item.id.clone(), reason));
            return;
        }
        Ok(None) => {}
        Err(e) => {
            out.failed
                .push(format!("{project_id}: headless check failed: {e}"));
            return;
        }
    }
    let charter = match fx.active_charter(project_id) {
        Ok(c) => c,
        Err(e) => {
            out.failed
                .push(format!("{project_id}: charter lookup failed: {e}"));
            return;
        }
    };
    if let Some(charter_id) = charter {
        let outcome_id = charter_outcome_id(standup_id, &item.id);
        match fx.amend_charter(&charter_id, &outcome_id, &direction, &item.evidence) {
            Ok(()) => {
                fx.record(&event(
                    standup_id,
                    now_ms,
                    StandupEventKind::Dispatch,
                    Some(project_id),
                    format!("Charter direction set: {direction}"),
                    serde_json::json!({
                        "itemId": item.id,
                        "route": "charter",
                        "charterId": charter_id,
                        "direction": direction,
                    }),
                ));
                out.dispatched.push(format!(
                    "{project_id}: charter {charter_id} now steers to \"{direction}\""
                ));
            }
            Err(e) => out
                .failed
                .push(format!("{project_id}: charter amend failed: {e}")),
        }
        return;
    }
    let not_before = item.not_before_ms.or(match item.window {
        StandupWindow::Night => Some(night_start_ms),
        StandupWindow::Day | StandupWindow::Any => None,
    });
    let not_before = not_before.filter(|t| *t > now_ms);
    match fx.dispatch(project_id, item, &direction, not_before) {
        Ok(session_id) => {
            fx.record(&event(
                standup_id,
                now_ms,
                StandupEventKind::Dispatch,
                Some(project_id),
                format!("Queued: {direction}"),
                serde_json::json!({
                    "itemId": item.id,
                    "route": "queue",
                    "sessionId": session_id,
                    "notBeforeMs": not_before,
                    "direction": direction,
                }),
            ));
            out.dispatched.push(match not_before {
                Some(t) => format!("{project_id}: queued `{session_id}` for {t} (epoch ms)"),
                None => format!("{project_id}: queued `{session_id}`"),
            });
        }
        Err(e) => out
            .failed
            .push(format!("{project_id}: dispatch failed: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Night start
// ---------------------------------------------------------------------------

fn parse_hhmm(raw: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M").ok()
}

/// The night window from Athena's first active `quiet_hours` ritual
/// (`{from, to}` local, `companion::proactive::quiet`), else 22:00-07:00.
fn night_window(user_db: &UserDbPool) -> (NaiveTime, NaiveTime) {
    let fallback = (
        NaiveTime::from_hms_opt(DEFAULT_NIGHT_FROM.0, DEFAULT_NIGHT_FROM.1, 0).unwrap_or_default(),
        NaiveTime::from_hms_opt(DEFAULT_NIGHT_TO.0, DEFAULT_NIGHT_TO.1, 0).unwrap_or_default(),
    );
    let rituals = match crate::companion::brain::rituals::list_rituals(user_db, None, true) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "standup: rituals unreadable; night start falls back to 22:00");
            return fallback;
        }
    };
    rituals
        .iter()
        .filter(|r| r.kind == "quiet_hours")
        .find_map(|r| {
            let v: serde_json::Value = serde_json::from_str(&r.schedule_json).ok()?;
            let from = parse_hhmm(v.get("from")?.as_str()?)?;
            let to = parse_hhmm(v.get("to")?.as_str()?)?;
            Some((from, to))
        })
        .unwrap_or(fallback)
}

/// Tonight's start as epoch ms: `now` when the night window is already open,
/// else the next local occurrence of its `from` time.
pub(crate) fn night_start_in(now: DateTime<Local>, from: NaiveTime, to: NaiveTime) -> i64 {
    let t = now.time();
    let open = if from <= to {
        t >= from && t < to
    } else {
        t >= from || t < to
    };
    if open {
        return now.timestamp_millis();
    }
    let mut day = now.date_naive();
    if t >= from {
        day += ChronoDuration::days(1);
    }
    Local
        .from_local_datetime(&day.and_time(from))
        .earliest()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| now.timestamp_millis())
}

/// Tonight's start for a `night` item, from the operator's quiet hours.
pub fn night_start_ms(user_db: &UserDbPool) -> i64 {
    let (from, to) = night_window(user_db);
    night_start_in(Local::now(), from, to)
}

// ---------------------------------------------------------------------------
// The app's doors
// ---------------------------------------------------------------------------

/// [`ArmEffects`] over the real app: the headless-master heartbeat, the
/// mandate list, the charter writer, the fleet admission door, the event
/// ledger.
pub struct AppArmEffects<'a> {
    pub app: &'a AppHandle,
    pub db: &'a DbPool,
    pub user_db: &'a UserDbPool,
    pub standup: &'a Standup,
}

impl AppArmEffects<'_> {
    fn worker_prompt(&self, project_name: &str, item: &StandupItem, direction: &str) -> String {
        let date = Local::now().format("%Y-%m-%d").to_string();
        let slug = crate::commands::fleet::naming::cli_safe_label(project_name);
        let evidence = if item.evidence.trim().is_empty() {
            "(none recorded)".to_string()
        } else {
            item.evidence.trim().to_string()
        };
        format!(
            "You are a fleet worker carrying out a direction the operator set at Athena's \
             standup (revision {rev}, {date}).\n\
             First call the MCP tool `athena.report_intent` with a one-line intent.\n\n\
             DIRECTION: {direction}\n\n\
             WHAT ATHENA SAW AT THE STANDUP: {evidence}\n\n\
             RULES (non-negotiable):\n\
             - Work on a new branch `standup/{date}-{slug}`. Never commit to the default \
               branch and never push: the standup's away rules decide every push.\n\
             - Call `athena.checkpoint` at meaningful milestones and \
               `athena.request_guidance` (blocking) when genuinely stuck.\n\
             - For ANY destructive or cost-bearing action call `athena.request_approval` \
               first; treat a denial as final and continue with safe work.\n\
             - Run the repo's own checks before finishing and leave the tree clean on your \
               branch.\n\
             - Before ending, check the DIRECTION against what actually landed (the log and \
               diff, not your memory): say what is done, what is not, and why.\n",
            rev = self.standup.revision,
        )
    }
}

impl ArmEffects for AppArmEffects<'_> {
    fn headless_hold(&self, project_id: &str) -> Result<Option<String>, AppError> {
        use crate::commands::infrastructure::headless_master as hm;
        let Some(beat) = hm::read_heartbeat(self.db, project_id)? else {
            return Ok(None);
        };
        if !hm::is_fresh(&beat, chrono::Utc::now()) {
            return Ok(None);
        }
        let until = hm::fresh_until(&beat)
            .map(|t| t.with_timezone(&Local).format("%H:%M").to_string())
            .unwrap_or_else(|| "?".into());
        Ok(Some(format!(
            "a headless App Master holds this project (state `{}`, until {until})",
            beat.state
        )))
    }

    fn active_charter(&self, project_id: &str) -> Result<Option<String>, AppError> {
        Ok(crate::db::repos::core::mandates::list(self.db)?
            .into_iter()
            .find(|m| m.project_id == project_id && m.status == "active")
            .map(|m| m.charter_id))
    }

    fn amend_charter(
        &self,
        charter_id: &str,
        outcome_id: &str,
        direction: &str,
        evidence: &str,
    ) -> Result<(), AppError> {
        let charter = crate::db::repos::core::responsibilities::get_by_id(self.db, charter_id)?
            .ok_or_else(|| AppError::NotFound(format!("Responsibility {charter_id}")))?;
        let mut outcomes: Vec<crate::db::models::ResponsibilityOutcome> = charter
            .outcomes
            .into_iter()
            .filter(|o| !o.id.starts_with(OUTCOME_PREFIX))
            .collect();
        let mut criteria = vec![format!(
            "Set by the operator at the standup (revision {})",
            self.standup.revision
        )];
        if !evidence.trim().is_empty() {
            criteria.push(format!("Standup evidence: {}", evidence.trim()));
        }
        outcomes.insert(
            0,
            crate::db::models::ResponsibilityOutcome {
                id: outcome_id.to_string(),
                statement: direction.to_string(),
                success_criteria: criteria,
            },
        );
        let mut cadence = charter.cadence;
        cadence.attention_enabled = true;
        personas_engine::responsibility::update_from_input(
            self.db,
            charter_id,
            crate::db::models::UpdatePersonaResponsibilityInput {
                outcomes: Some(outcomes),
                cadence: Some(cadence),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    fn dispatch(
        &self,
        project_id: &str,
        item: &StandupItem,
        direction: &str,
        not_before_ms: Option<i64>,
    ) -> Result<String, AppError> {
        use crate::commands::fleet::queue::{admit_sync, DispatchOrigin, DispatchRequest};
        let project = crate::db::repos::dev_tools::get_project_by_id(self.db, project_id)?;
        crate::commands::companion::approvals::validate_fleet_cwd_in_db(
            self.db,
            &project.root_path,
        )?;
        let origin = match item.window {
            // The night lane keeps Night Shift's origin (and its moon on the
            // board): standup absorbed Night Shift.
            StandupWindow::Night => DispatchOrigin::NightShift,
            StandupWindow::Day | StandupWindow::Any => DispatchOrigin::Athena,
        };
        let admission = admit_sync(
            self.app,
            DispatchRequest {
                cwd: project.root_path.clone(),
                name: Some(crate::commands::fleet::naming::cli_safe_label(&format!(
                    "standup-{}",
                    project.name
                )))
                .filter(|s| !s.is_empty()),
                title: Some(direction.chars().take(80).collect()),
                args: vec![self.worker_prompt(&project.name, item, direction)],
                mode: crate::commands::fleet::types::FleetSessionMode::Interactive,
                run_label: None,
                origin,
                persona_id: item.persona_id.clone(),
                goal_id: None,
                cycle_index: None,
                not_before_ms,
                // The charter's declared profile with measured machine/GPU
                // tags (WP2's forecast), so admission charges what it costs.
                profile: super::forecast::item_profile(self.db, item).profile,
            },
        )?;
        Ok(admission.session_id)
    }

    fn retune(&self, spec: &RetuneAgentSpec) -> Result<String, AppError> {
        let charters = crate::db::repos::core::responsibilities::list_by_persona(
            self.db,
            &spec.persona_id,
            false,
        )?;
        let active: Vec<_> = charters
            .into_iter()
            .filter(|c| c.status == "active")
            .collect();
        if active.is_empty() {
            return Err(AppError::NotFound(format!(
                "persona {} holds no active charter to retune",
                spec.persona_id
            )));
        }
        let mut changed = 0usize;
        if let Some(minutes) = spec.pacing_minutes {
            if minutes < 1 {
                return Err(AppError::Validation(format!(
                    "pacing must be at least one minute, got {minutes}"
                )));
            }
            for c in &active {
                let mut cadence = c.cadence.clone();
                cadence.interval_minutes = Some(i64::from(minutes));
                personas_engine::responsibility::update_from_input(
                    self.db,
                    &c.id,
                    crate::db::models::UpdatePersonaResponsibilityInput {
                        cadence: Some(cadence),
                        ..Default::default()
                    },
                )?;
                changed += 1;
            }
        }
        let pacing = spec
            .pacing_minutes
            .map(|m| format!(" pacing {m} min on {changed} charter(s)"))
            .unwrap_or_default();
        let note = spec
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(|n| format!(" ({n})"))
            .unwrap_or_default();
        Ok(format!("Retuned {}:{pacing}{note}", spec.persona_id))
    }

    fn record(&self, event: &StandupEvent) {
        if let Err(e) = report::append_event(self.user_db, event) {
            tracing::warn!(standup_id = %event.standup_id, error = %e, "standup: event write failed");
        }
    }
}

/// The approval row a go-gate create is filed as: the same `{action, params,
/// rationale}` payload every producer writes, so the Approvals inbox and the
/// audit read it like any other.
fn insert_go_gate_approval(
    user_db: &UserDbPool,
    action: &str,
    params: &serde_json::Value,
    rationale: &str,
) -> Result<String, AppError> {
    let id = format!("appr_{}", uuid::Uuid::new_v4().simple());
    let payload = serde_json::json!({
        "action": action,
        "params": params,
        "rationale": rationale,
    })
    .to_string();
    let conn = user_db.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, datetime('now'))",
        rusqlite::params![id, crate::companion::session::DEFAULT_SESSION_ID, payload],
    )?;
    Ok(id)
}

/// The persona a go-gate `build_oneshot` just created. The executor creates
/// the draft persona under the exact name it was given and returns only a
/// message, so the id is read back: the newest draft persona of that name.
/// `None` when it cannot be found (the build failed before the persona row).
fn created_persona_id(db: &DbPool, name: &str) -> Option<String> {
    match crate::db::repos::core::personas::get_all_by_lifecycle(db, &["draft"]) {
        Ok(all) => all
            .into_iter()
            .filter(|p| p.name == name)
            .max_by(|a, b| a.created_at.cmp(&b.created_at))
            .map(|p| p.id),
        Err(e) => {
            tracing::warn!(name, error = %e, "standup: created persona not resolvable");
            None
        }
    }
}

/// Run the arm's `create_agent` items through the existing `build_oneshot`
/// approval op, approved by the go-gate itself: the row is filed, claimed and
/// executed through the same executor table a click uses, with
/// `decidedBy = standup-go-gate:<id>` stamped so nobody reads it as a click.
async fn run_creates(app: &AppHandle, standup: &Standup, items: &[StandupItem]) -> Vec<String> {
    use crate::commands::companion::approvals as appr;
    let state = app.state::<Arc<AppState>>();
    let mut lines = Vec::new();
    for item in items {
        let Some(spec) = item.create_spec.as_ref() else {
            continue;
        };
        let mut intent = format!("{}\n\nCharter: {}", spec.role.trim(), spec.charter.trim());
        if let Some(pid) = spec.project_id.as_deref().or(item.project_id.as_deref()) {
            intent.push_str(&format!(
                "\n\nThis persona works on registered project {pid}."
            ));
        }
        if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
            intent.push_str(&format!("\nPreferred model: {model}."));
        }
        let params = serde_json::json!({ "intent": intent, "name": spec.name });
        let rationale = format!(
            "Agreed at the standup (revision {}): create {} ({}).",
            standup.revision, spec.name, spec.role
        );
        let outcome = async {
            let id = insert_go_gate_approval(&state.user_db, "build_oneshot", &params, &rationale)?;
            let (action, claimed) = appr::claim_pending(&state.user_db, &id)
                .map_err(|e| AppError::Internal(format!("standup create: claim {id}: {e:?}")))?;
            if let Err(e) = appr::stamp_decision(
                &state.user_db,
                &id,
                &format!("standup-go-gate:{}", standup.id),
                Some("approved at the standup go-gate"),
            ) {
                tracing::warn!(approval_id = %id, error = %e, "standup: could not stamp the go-gate actor");
            }
            let o = appr::execute_claimed(&state, app, id.clone(), &action, &claimed).await?;
            Ok::<_, AppError>((id, o.status))
        }
        .await;
        let (summary, detail) = match outcome {
            Ok((approval_id, status)) => {
                let persona_id = created_persona_id(&state.db, &spec.name);
                (
                    format!("Creating {} ({status})", spec.name),
                    serde_json::json!({
                        "itemId": item.id, "approvalId": approval_id, "status": status,
                        "name": spec.name, "personaId": persona_id, "away": false,
                    }),
                )
            }
            Err(e) => (
                format!("Could not create {}: {e}", spec.name),
                serde_json::json!({
                    "itemId": item.id, "status": "failed", "name": spec.name,
                    "error": e.to_string(), "away": false,
                }),
            ),
        };
        let ev = event(
            &standup.id,
            chrono::Utc::now().timestamp_millis(),
            StandupEventKind::AgentCreated,
            item.project_id.as_deref(),
            summary.clone(),
            detail,
        );
        if let Err(e) = report::append_event(&state.user_db, &ev) {
            tracing::warn!(standup_id = %standup.id, error = %e, "standup: event write failed");
        }
        lines.push(summary);
    }
    lines
}

/// The decision round as ONE self-contained Athena episode.
fn episode_text(out: &ArmOutcome, created: &[String]) -> String {
    let s = &out.standup;
    let mut text = format!(
        "Standup revision {} armed at {}. The operator passed the go-gate.",
        s.revision,
        Local::now().format("%Y-%m-%d %H:%M")
    );
    let decided: Vec<String> = s
        .plan
        .items
        .iter()
        .filter(|i| is_decided(i))
        .filter_map(|i| {
            let what = match i.kind {
                StandupItemKind::Direction => direction_text(i)?,
                StandupItemKind::CreateAgent => {
                    format!("create agent {}", i.create_spec.as_ref()?.name)
                }
                StandupItemKind::RetuneAgent => {
                    format!("retune {}", i.retune_spec.as_ref()?.persona_id)
                }
                StandupItemKind::Filler => {
                    format!("filler {}", direction_text(i).unwrap_or_default())
                }
            };
            Some(format!(
                "- {}: {what}",
                i.project_id.as_deref().unwrap_or("(no project)")
            ))
        })
        .collect();
    if !decided.is_empty() {
        text.push_str("\nAgreed:\n");
        text.push_str(&decided.join("\n"));
    }
    let skipped = s
        .plan
        .items
        .iter()
        .filter(|i| i.state == StandupItemState::Skipped)
        .count();
    if skipped > 0 {
        text.push_str(&format!("\nSkipped: {skipped} card(s)."));
    }
    if !out.dispatched.is_empty() {
        text.push_str("\nCarried out:\n- ");
        text.push_str(&out.dispatched.join("\n- "));
    }
    if !created.is_empty() {
        text.push_str("\nAgents:\n- ");
        text.push_str(&created.join("\n- "));
    }
    if !out.refused.is_empty() {
        text.push_str("\nHeld (a headless App Master owns the project):\n- ");
        text.push_str(
            &out.refused
                .iter()
                .map(|(id, why)| format!("{id}: {why}"))
                .collect::<Vec<_>>()
                .join("\n- "),
        );
    }
    if !out.failed.is_empty() {
        text.push_str("\nNot carried out:\n- ");
        text.push_str(&out.failed.join("\n- "));
    }
    let r = &s.away_rules;
    text.push_str(&format!(
        "\nAway rules: delegate {}; park {}; push targets {}.",
        r.delegate.len(),
        r.park.len(),
        r.push_targets.len()
    ));
    text
}

/// The app's arm: [`arm_with`] over [`AppArmEffects`], then the creates, then
/// the brain episode. The sync half runs on a blocking thread.
pub async fn arm(app: &AppHandle, standup_id: &str) -> Result<ArmOutcome, AppError> {
    let state = app.state::<Arc<AppState>>();
    let (db, user_db) = (state.db.clone(), state.user_db.clone());
    let app_bg = app.clone();
    let id = standup_id.to_string();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let s = plan::require(&user_db, &id)?;
        let fx = AppArmEffects {
            app: &app_bg,
            db: &db,
            user_db: &user_db,
            standup: &s,
        };
        let night = night_start_ms(&user_db);
        arm_with(
            &user_db,
            &id,
            chrono::Utc::now().timestamp_millis(),
            night,
            &fx,
        )
    })
    .await
    .map_err(|e| AppError::Internal(format!("standup arm: worker join failed: {e}")))??;
    if !out.newly_armed {
        return Ok(out);
    }
    let created = run_creates(app, &out.standup, &out.creates).await;
    let text = episode_text(&out, &created);
    if let Err(e) = crate::companion::brain::episodic::append_episode(
        &state.user_db,
        crate::companion::session::DEFAULT_SESSION_ID,
        crate::companion::brain::episodic::EpisodeRole::Assistant,
        &text,
    ) {
        tracing::warn!(standup_id = %out.standup.id, error = %e, "standup: arm episode not banked");
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::companion::standup::model::{CreateAgentSpec, DirectionProposal, StandupItemPatch};
    use crate::companion::standup::plan::ProjectSeed;

    #[derive(Default)]
    struct FakeFx {
        held: Vec<String>,
        charters: Vec<(String, String)>,
        dispatches: RefCell<Vec<(String, String, Option<i64>)>>,
        amends: RefCell<Vec<(String, String)>>,
        events: RefCell<Vec<StandupEvent>>,
    }

    impl ArmEffects for FakeFx {
        fn headless_hold(&self, project_id: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .held
                .iter()
                .any(|p| p == project_id)
                .then(|| "a headless App Master holds this project".to_string()))
        }
        fn active_charter(&self, project_id: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .charters
                .iter()
                .find(|(p, _)| p == project_id)
                .map(|(_, c)| c.clone()))
        }
        fn amend_charter(
            &self,
            charter_id: &str,
            _o: &str,
            direction: &str,
            _e: &str,
        ) -> Result<(), AppError> {
            self.amends
                .borrow_mut()
                .push((charter_id.into(), direction.into()));
            Ok(())
        }
        fn dispatch(
            &self,
            project_id: &str,
            _i: &StandupItem,
            direction: &str,
            nb: Option<i64>,
        ) -> Result<String, AppError> {
            let mut d = self.dispatches.borrow_mut();
            d.push((project_id.into(), direction.into(), nb));
            Ok(format!("sess-{}", d.len()))
        }
        fn retune(&self, spec: &RetuneAgentSpec) -> Result<String, AppError> {
            Ok(format!("Retuned {}", spec.persona_id))
        }
        fn record(&self, event: &StandupEvent) {
            self.events.borrow_mut().push(event.clone());
        }
    }

    fn seeds() -> Vec<ProjectSeed> {
        vec![
            ProjectSeed {
                id: "p1".into(),
                name: "alpha".into(),
                root: "C:/w/alpha".into(),
            },
            ProjectSeed {
                id: "p2".into(),
                name: "beta".into(),
                root: "C:/w/beta".into(),
            },
            ProjectSeed {
                id: "p3".into(),
                name: "gamma".into(),
                root: "C:/w/gamma".into(),
            },
        ]
    }

    fn choose(
        pool: &UserDbPool,
        standup_id: &str,
        item_id: &str,
        text: &str,
        window: StandupWindow,
    ) {
        plan::patch_item(
            pool,
            standup_id,
            &StandupItemPatch {
                id: item_id.into(),
                state: None,
                chosen: Some(text.into()),
                window: Some(window),
                priority: None,
                not_before_ms: None,
            },
        )
        .unwrap();
    }

    /// A draft with p1 (night, queue), p2 (charter), p3 (skipped).
    fn armed_draft(pool: &UserDbPool) -> Standup {
        let (s, _) = plan::open(pool, "dev-1", 1_000, &seeds()).unwrap();
        let ids: Vec<String> = s.plan.items.iter().map(|i| i.id.clone()).collect();
        choose(
            pool,
            &s.id,
            &ids[0],
            "Ship the importer",
            StandupWindow::Night,
        );
        choose(pool, &s.id, &ids[1], "Raise coverage", StandupWindow::Day);
        plan::patch_item(
            pool,
            &s.id,
            &StandupItemPatch {
                id: ids[2].clone(),
                state: Some(StandupItemState::Skipped),
                chosen: None,
                window: None,
                priority: None,
                not_before_ms: None,
            },
        )
        .unwrap();
        plan::require(pool, &s.id).unwrap()
    }

    #[test]
    fn arm_routes_each_direction_and_is_idempotent_per_revision() {
        let pool = crate::db::init_test_user_db().unwrap();
        let s = armed_draft(&pool);
        let fx = FakeFx {
            charters: vec![("p2".into(), "ch-2".into())],
            ..Default::default()
        };

        let first = arm_with(&pool, &s.id, 2_000, 9_000, &fx).unwrap();
        assert!(first.newly_armed);
        assert_eq!(first.standup.status, StandupStatus::Armed);
        assert_eq!(first.standup.armed_at, Some(2_000));
        assert_eq!(
            *fx.dispatches.borrow(),
            vec![(
                "p1".to_string(),
                "Ship the importer".to_string(),
                Some(9_000)
            )],
            "the night item queues at tonight's start; the charter project is not queued"
        );
        assert_eq!(
            *fx.amends.borrow(),
            vec![("ch-2".to_string(), "Raise coverage".to_string())]
        );
        let dispatch_events = fx
            .events
            .borrow()
            .iter()
            .filter(|e| e.kind == StandupEventKind::Dispatch)
            .count();
        assert_eq!(dispatch_events, 2, "one dispatch event per dispatched item");

        let second = arm_with(&pool, &s.id, 3_000, 9_000, &fx).unwrap();
        assert!(!second.newly_armed);
        assert_eq!(second.standup.armed_at, Some(2_000));
        assert_eq!(
            fx.dispatches.borrow().len(),
            1,
            "arming twice dispatches once"
        );
        assert_eq!(fx.amends.borrow().len(), 1);
    }

    #[test]
    fn a_live_headless_master_holds_its_project_and_the_reason_is_returned() {
        let pool = crate::db::init_test_user_db().unwrap();
        let s = armed_draft(&pool);
        let p1_item = s.plan.items[0].id.clone();
        let fx = FakeFx {
            held: vec!["p1".into()],
            ..Default::default()
        };
        let out = arm_with(&pool, &s.id, 2_000, 9_000, &fx).unwrap();
        assert_eq!(out.refused.len(), 1);
        assert_eq!(out.refused[0].0, p1_item);
        assert!(out.refused[0].1.contains("headless App Master"));
        assert!(fx.dispatches.borrow().iter().all(|(p, _, _)| p != "p1"));
        // The item stays on the plan, decided, for the next revision to retry.
        let kept = out
            .standup
            .plan
            .items
            .iter()
            .find(|i| i.id == p1_item)
            .unwrap();
        assert_eq!(kept.state, StandupItemState::Edited);
        let stop = fx
            .events
            .borrow()
            .iter()
            .find(|e| e.kind == StandupEventKind::Stop)
            .cloned()
            .unwrap();
        assert_eq!(
            stop.detail.unwrap()["reason"],
            plan::REFUSAL_HEADLESS_MASTER
        );
    }

    #[test]
    fn re_arming_a_revision_n_plus_one_supersedes_the_parent_and_skips_carried_items() {
        let pool = crate::db::init_test_user_db().unwrap();
        let s = armed_draft(&pool);
        let fx = FakeFx::default();
        arm_with(&pool, &s.id, 2_000, 9_000, &fx).unwrap();
        assert_eq!(fx.dispatches.borrow().len(), 2);

        let (child, created) = plan::open(&pool, "dev-1", 3_000, &seeds()).unwrap();
        assert!(created);
        // Change one direction; leave the other carried.
        choose(
            &pool,
            &child.id,
            &child.plan.items[1].id,
            "Raise coverage to 80%",
            StandupWindow::Day,
        );
        let out = arm_with(&pool, &child.id, 4_000, 9_000, &fx).unwrap();
        assert!(out.newly_armed);
        let d = fx.dispatches.borrow();
        assert_eq!(d.len(), 3, "only the changed item goes out again");
        assert_eq!(d[2].1, "Raise coverage to 80%");
        assert_eq!(
            plan::require(&pool, &s.id).unwrap().status,
            StandupStatus::Superseded
        );
        assert_eq!(plan::current(&pool).unwrap().unwrap().id, child.id);
        // A superseded revision refuses a re-arm.
        assert!(matches!(
            arm_with(&pool, &s.id, 5_000, 9_000, &fx),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn creates_are_returned_for_the_approval_op_not_run_inline() {
        let pool = crate::db::init_test_user_db().unwrap();
        let (s, _) = plan::open(&pool, "dev-1", 1_000, &[]).unwrap();
        plan::mutate_draft(&pool, &s.id, |s| {
            let mut item = plan::seed_item("p1", "dev-1", 0);
            item.kind = StandupItemKind::CreateAgent;
            item.state = StandupItemState::Accepted;
            item.create_spec = Some(CreateAgentSpec {
                name: "Docs Scribe".into(),
                role: "Keeps docs in sync".into(),
                project_id: Some("p1".into()),
                charter: "Update docs per merge".into(),
                model: None,
            });
            s.plan.items.push(item);
            Ok(())
        })
        .unwrap();
        let fx = FakeFx::default();
        let out = arm_with(&pool, &s.id, 2_000, 9_000, &fx).unwrap();
        assert_eq!(out.creates.len(), 1);
        assert!(fx.dispatches.borrow().is_empty());
    }

    #[test]
    fn direction_text_prefers_chosen_then_the_recommended_proposal() {
        let mut item = plan::seed_item("p1", "d", 0);
        item.proposals = vec![
            DirectionProposal {
                id: "a".into(),
                text: "A".into(),
                rationale: String::new(),
                recommended: false,
            },
            DirectionProposal {
                id: "b".into(),
                text: "B".into(),
                rationale: String::new(),
                recommended: true,
            },
        ];
        assert_eq!(direction_text(&item).as_deref(), Some("B"));
        item.chosen = Some("  Mine ".into());
        assert_eq!(direction_text(&item).as_deref(), Some("Mine"));
    }

    #[test]
    fn night_start_is_now_inside_the_window_else_the_next_from() {
        let from = NaiveTime::from_hms_opt(22, 0, 0).unwrap();
        let to = NaiveTime::from_hms_opt(7, 0, 0).unwrap();
        let at = |h: u32| {
            Local
                .from_local_datetime(
                    &chrono::NaiveDate::from_ymd_opt(2026, 11, 6)
                        .unwrap()
                        .and_hms_opt(h, 0, 0)
                        .unwrap(),
                )
                .earliest()
                .unwrap()
        };
        assert_eq!(night_start_in(at(23), from, to), at(23).timestamp_millis());
        assert_eq!(night_start_in(at(3), from, to), at(3).timestamp_millis());
        assert_eq!(night_start_in(at(10), from, to), at(22).timestamp_millis());
    }
}
