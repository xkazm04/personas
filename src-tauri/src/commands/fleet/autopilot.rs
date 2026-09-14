//! `fleet_autopilot_status` — everything the Activity board's Autopilot
//! switch renders, in one read: the loop's switch, the pacing verdict (the
//! seven-day debt, the five-hour headroom, the memory room, the slots), the
//! governor's stop, the running-work headroom, and which personas the loop
//! can actually serve.
//!
//! # Which personas can run autonomously
//!
//! A persona has up to four ways of being started, and only one of them is
//! the Autopilot's:
//!
//! | Mechanism | Who starts it | Counts as "autonomous" here |
//! |---|---|---|
//! | a charter with `cadence.attentionEnabled` | the attention loop, on its tick | **yes** — this is what the switch turns on |
//! | a `schedule` / `polling` / `webhook` / `file_watcher` / … trigger | the scheduler or the event, on its own | no — self-driven, runs with or without the switch, but spends the same quota |
//! | a `manual` trigger | the operator | no |
//! | a fleet dispatch (`/master`, quick dispatch, a team assignment) | a person or another persona | no |
//!
//! So `eligible` is exactly `enabled AND ≥1 active attention charter` — the
//! loop's own work list (`responsibilities::list_active_with_attention`)
//! restated per persona — and the trigger kinds are listed beside it so the
//! operator can see which personas will ALSO run on their own clock.
//!
//! The same module the tick consults produces the verdicts, so the board and
//! the loop cannot disagree about a number.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::core::attention_ledger;
use crate::db::repos::core::personas as personas_repo;
use crate::db::repos::core::responsibilities;
use crate::db::repos::resources::triggers as triggers_repo;
use crate::engine::autonomy;
use crate::engine::subscription::usage_governor;
use crate::engine::subscription::usage_pacing::{self, AutopilotPacing};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_engine::active_persona_cap::{self, ActivePersonaHeadroom};

/// The quota governor's view, as the board shows it next to the pacing.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotGovernor {
    /// The loop is stopped: the worst window is at or above `stop_pct`.
    pub blocked: bool,
    pub stop_pct: f64,
    pub worst_key: Option<String>,
    pub worst_pct: f64,
    /// Minutes — a week is 10,080 of them.
    #[ts(type = "number | null")]
    pub resets_in_minutes: Option<i64>,
    /// Minutes until the worst window reaches the stop at the measured burn
    /// rate; `None` when nothing is climbing.
    #[ts(type = "number | null")]
    pub minutes_to_stop: Option<i64>,
    pub unavailable_reason: Option<String>,
}

/// One persona's autonomy standing.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotPersona {
    pub persona_id: String,
    pub persona_name: String,
    pub enabled: bool,
    /// `enabled && attention_charters > 0` — the loop can serve it.
    pub eligible: bool,
    /// Active charters with the attention loop switched on.
    pub attention_charters: usize,
    /// Whether one of those charters binds a project or workspace — an App
    /// Master, which decides its own lane and pace on every wake.
    pub app_master: bool,
    /// Enabled trigger kinds that start this persona on their own
    /// (`schedule`, `polling`, `webhook`, …; `manual` excluded).
    pub self_driven_triggers: Vec<String>,
}

/// Everything the Autopilot switch renders.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotStatus {
    /// `autonomous_attention_loop` — the switch itself.
    pub enabled: bool,
    pub pacing: AutopilotPacing,
    pub governor: AutopilotGovernor,
    /// Personas holding work right now vs `max_active_personas`.
    pub headroom: ActivePersonaHeadroom,
    pub personas: Vec<AutopilotPersona>,
    pub eligible_count: usize,
    /// Worker dispatches the loop made today, from the attention ledger.
    #[ts(type = "number")]
    pub dispatched_today: i64,
}

/// The DB half, on the blocking pool: the switch, the headroom, the roster.
fn read_roster(
    pool: &crate::db::DbPool,
) -> Result<(bool, ActivePersonaHeadroom, Vec<AutopilotPersona>, i64), AppError> {
    let enabled = autonomy::global_enabled(pool, autonomy::Action::AttentionLoop);
    let headroom = active_persona_cap::active_persona_headroom(pool)?;
    let dispatched_today = attention_ledger::summary_today(pool)?.dispatched_today;

    let personas = personas_repo::get_all_lean(pool)?;
    let ids: Vec<String> = personas.iter().map(|p| p.id.clone()).collect();

    // Charters per persona — the loop's own work list, regrouped.
    let mut charters: HashMap<String, (usize, bool)> = HashMap::new();
    for c in responsibilities::list_active_with_attention(pool)? {
        let entry = charters.entry(c.persona_id.clone()).or_insert((0, false));
        entry.0 += 1;
        let binds = c
            .project_id
            .as_deref()
            .is_some_and(|p| !p.trim().is_empty())
            || c.workspace_id
                .as_deref()
                .is_some_and(|w| !w.trim().is_empty());
        entry.1 |= binds;
    }

    // Self-driven trigger kinds per persona.
    let mut triggers: HashMap<String, BTreeSet<String>> = HashMap::new();
    for t in triggers_repo::get_by_persona_ids(pool, &ids)? {
        if !t.enabled || t.trigger_type == "manual" {
            continue;
        }
        triggers
            .entry(t.persona_id.clone())
            .or_default()
            .insert(t.trigger_type.clone());
    }

    let mut rows: Vec<AutopilotPersona> = personas
        .into_iter()
        .map(|p| {
            let (attention_charters, app_master) =
                charters.get(&p.id).copied().unwrap_or((0, false));
            AutopilotPersona {
                eligible: p.enabled && attention_charters > 0,
                self_driven_triggers: triggers
                    .remove(&p.id)
                    .map(|s| s.into_iter().collect())
                    .unwrap_or_default(),
                persona_id: p.id,
                persona_name: p.name,
                enabled: p.enabled,
                attention_charters,
                app_master,
            }
        })
        .collect();
    // Eligible first, then by name — the order the board lists them in.
    rows.sort_by(|a, b| {
        b.eligible.cmp(&a.eligible).then_with(|| {
            a.persona_name
                .to_lowercase()
                .cmp(&b.persona_name.to_lowercase())
        })
    });
    Ok((enabled, headroom, rows, dispatched_today))
}

/// The Autopilot's standing: switch, pacing, governor, headroom, roster.
#[tauri::command]
pub async fn fleet_autopilot_status(
    state: State<'_, Arc<AppState>>,
) -> Result<AutopilotStatus, AppError> {
    require_auth(&state).await?;
    let pool = state.db.clone();
    let (enabled, headroom, personas, dispatched_today) =
        tokio::task::spawn_blocking(move || read_roster(&pool))
            .await
            .map_err(|e| AppError::Internal(format!("fleet_autopilot_status: {e}")))??;

    let pacing = usage_pacing::verdict(&state.db, &state).await;
    let stop_pct = usage_governor::stop_pct(&state.db);
    let v = usage_governor::verdict(&state.db).await;
    let governor = AutopilotGovernor {
        blocked: v.blocked,
        stop_pct,
        worst_key: v.worst_key,
        worst_pct: v.worst_pct,
        resets_in_minutes: v.resets_in_minutes,
        minutes_to_stop: v.minutes_to_stop,
        unavailable_reason: v.unavailable_reason,
    };
    let eligible_count = personas.iter().filter(|p| p.eligible).count();
    Ok(AutopilotStatus {
        enabled,
        pacing,
        governor,
        headroom,
        personas,
        eligible_count,
        dispatched_today,
    })
}

/// The Orchestration tab's read: the next tick as the loop would plan it,
/// with the pacing verdict that sets its budget. Nothing is spent, opened or
/// enqueued (see `attention::preview_tick`).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DispatchPreviewView {
    /// `autonomous_attention_loop`.
    pub enabled: bool,
    pub pacing: AutopilotPacing,
    pub headroom: ActivePersonaHeadroom,
    pub preview: crate::engine::subscription::DispatchPreview,
    /// The operator's order as stored — ids that no longer hold a charter
    /// are kept here so a persona that regains one keeps its place.
    pub dispatch_order: Vec<String>,
}

#[tauri::command]
pub async fn fleet_dispatch_preview(
    state: State<'_, Arc<AppState>>,
) -> Result<DispatchPreviewView, AppError> {
    require_auth(&state).await?;
    let pacing = usage_pacing::verdict(&state.db, &state).await;
    let slots = pacing.slots;
    let pool = state.db.clone();
    let (enabled, headroom, preview, dispatch_order) = tokio::task::spawn_blocking(move || {
        let enabled = autonomy::global_enabled(&pool, autonomy::Action::AttentionLoop);
        let headroom = active_persona_cap::active_persona_headroom(&pool)?;
        let preview = crate::engine::subscription::preview_tick(&pool, slots)?;
        let order = crate::engine::subscription::read_dispatch_order(&pool);
        Ok::<_, AppError>((enabled, headroom, preview, order))
    })
    .await
    .map_err(|e| AppError::Internal(format!("fleet_dispatch_preview: {e}")))??;
    Ok(DispatchPreviewView {
        enabled,
        pacing,
        headroom,
        preview,
        dispatch_order,
    })
}

/// Write the operator's global dispatch order — the whole list, first to
/// last. The next tick walks it. Ids are not checked against the roster on
/// purpose: an order may name a persona that is disabled today and back
/// tomorrow, and its place should survive the gap.
#[tauri::command]
pub async fn fleet_dispatch_order_set(
    state: State<'_, Arc<AppState>>,
    persona_ids: Vec<String>,
) -> Result<Vec<String>, AppError> {
    require_auth(&state).await?;
    // The size guard runs on the RAW list, before dedupe: a caller sending
    // ten thousand copies of one id is refused, not quietly collapsed.
    if persona_ids.len() > MAX_DISPATCH_ORDER_LEN {
        return Err(AppError::Validation(format!(
            "dispatch order: at most {MAX_DISPATCH_ORDER_LEN} personas"
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let ids: Vec<String> = persona_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && seen.insert(s.clone()))
        .collect();
    let json = serde_json::to_string(&ids)
        .map_err(|e| AppError::Internal(format!("dispatch order encode: {e}")))?;
    let pool = state.db.clone();
    let written = tokio::task::spawn_blocking(move || {
        crate::db::repos::core::settings::set(
            &pool,
            crate::db::settings_keys::FLEET_DISPATCH_ORDER,
            &json,
        )
    })
    .await;
    match written {
        Ok(r) => r?,
        Err(e) if e.is_panic() => {
            return Err(AppError::Internal(
                "fleet_dispatch_order_set: the settings write panicked".into(),
            ))
        }
        Err(e) => return Err(AppError::Internal(format!("fleet_dispatch_order_set: {e}"))),
    }
    Ok(ids)
}

/// Upper bound on a dispatch order — well above any roster this app holds
/// (`MAX_PERSONAS` is 200), low enough that a runaway caller is refused.
const MAX_DISPATCH_ORDER_LEN: usize = 500;
