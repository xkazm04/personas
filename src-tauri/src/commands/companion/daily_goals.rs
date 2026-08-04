//! Daily-goals gamification commands (dev-only ritual in the companion
//! panel). Thin auth + debug-build guards over
//! `companion::brain::daily_goals`; the UI is gated by
//! `companion_beta_flags().dev_mode_available`, and these commands
//! refuse in release builds as defense in depth.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::companion::brain::daily_goals;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DailyGoal {
    pub id: String,
    pub slot: u32,
    pub title: String,
    pub done: bool,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DailyGoalsState {
    /// The active set's goals in slot order; empty = no active set.
    pub goals: Vec<DailyGoal>,
    /// Consecutive days with a fully accomplished set.
    pub streak: u32,
    /// True when a set was completed today (local day).
    pub completed_today: bool,
    /// True only on the toggle response that closed the set.
    pub just_completed: bool,
}

fn to_state(snap: daily_goals::DailyGoalsSnapshot, just_completed: bool) -> DailyGoalsState {
    DailyGoalsState {
        goals: snap
            .goals
            .into_iter()
            .map(|g| DailyGoal {
                id: g.id,
                slot: g.slot.max(0) as u32,
                title: g.title,
                done: g.done,
            })
            .collect(),
        streak: snap.streak,
        completed_today: snap.completed_today,
        just_completed,
    }
}

fn require_dev_build() -> Result<(), AppError> {
    if !cfg!(debug_assertions) {
        return Err(AppError::Validation(
            "daily goals are a development-build feature".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn companion_daily_goals_state(
    state: State<'_, Arc<AppState>>,
) -> Result<DailyGoalsState, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    require_dev_build()?;
    Ok(to_state(daily_goals::get_state(&state.user_db)?, false))
}

#[tauri::command]
pub fn companion_daily_goals_create(
    state: State<'_, Arc<AppState>>,
    titles: Vec<String>,
) -> Result<DailyGoalsState, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    require_dev_build()?;
    Ok(to_state(
        daily_goals::create_set(&state.user_db, &titles)?,
        false,
    ))
}

#[tauri::command]
pub fn companion_daily_goals_toggle(
    state: State<'_, Arc<AppState>>,
    id: String,
    done: bool,
) -> Result<DailyGoalsState, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    require_dev_build()?;
    let (snap, just_completed) = daily_goals::toggle_goal(&state.user_db, &id, done)?;
    Ok(to_state(snap, just_completed))
}

#[tauri::command]
pub fn companion_daily_goals_discard(
    state: State<'_, Arc<AppState>>,
) -> Result<DailyGoalsState, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    require_dev_build()?;
    Ok(to_state(daily_goals::discard_set(&state.user_db)?, false))
}
