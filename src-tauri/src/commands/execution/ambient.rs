//! Tauri commands for the ambient context fusion system and context rule engine.
//!
//! Provides frontend access to:
//! - Get the current ambient context snapshot for a persona
//! - Toggle ambient context on/off
//! - Set/get sensory policies per persona
//! - CRUD for context rules (pattern-based ambient subscriptions)
//! - Context stream stats

use std::sync::Arc;

use tauri::State;

use crate::error::AppError;
use crate::AppState;
use crate::engine::ambient_context::{AmbientContextSnapshot, ContextStreamStats, SensoryPolicy};
use crate::engine::context_rules::{ContextRule, ContextRuleMatch};

/// Get the ambient context snapshot for a specific persona, filtered by its sensory policy.
#[tauri::command]
pub async fn get_ambient_context_snapshot(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<AmbientContextSnapshot, AppError> {
    let ctx = state.ambient_context.lock().await;
    Ok(ctx.snapshot_for_persona(&persona_id))
}

/// Toggle ambient context collection globally.
#[tauri::command]
pub async fn set_ambient_context_enabled(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> Result<bool, AppError> {
    let mut ctx = state.ambient_context.lock().await;
    ctx.set_enabled(enabled);
    Ok(ctx.is_enabled())
}

/// Check if ambient context collection is globally enabled.
#[tauri::command]
pub async fn get_ambient_context_enabled(
    state: State<'_, Arc<AppState>>,
) -> Result<bool, AppError> {
    let ctx = state.ambient_context.lock().await;
    Ok(ctx.is_enabled())
}

/// Set the sensory policy for a specific persona.
#[tauri::command]
pub async fn set_ambient_sensory_policy(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    policy: SensoryPolicy,
) -> Result<(), AppError> {
    let mut ctx = state.ambient_context.lock().await;
    ctx.set_policy(persona_id, policy);
    Ok(())
}

/// Get the effective sensory policy for a persona (persona-specific or default).
#[tauri::command]
pub async fn get_ambient_sensory_policy(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<SensoryPolicy, AppError> {
    let ctx = state.ambient_context.lock().await;
    Ok(ctx.get_policy(&persona_id).clone())
}

/// Remove a persona's custom sensory policy (reverts to default).
#[tauri::command]
pub async fn remove_ambient_sensory_policy(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<(), AppError> {
    let mut ctx = state.ambient_context.lock().await;
    ctx.remove_policy(&persona_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Context Rules (pattern-based ambient subscriptions)
// ---------------------------------------------------------------------------

/// Add or update a context rule for a persona.
#[tauri::command]
pub async fn add_context_rule(
    state: State<'_, Arc<AppState>>,
    rule: ContextRule,
) -> Result<(), AppError> {
    let mut engine = state.context_rule_engine.lock().await;
    engine.add_rule(rule);
    Ok(())
}

/// Remove a context rule by ID.
#[tauri::command]
pub async fn remove_context_rule(
    state: State<'_, Arc<AppState>>,
    rule_id: String,
) -> Result<bool, AppError> {
    let mut engine = state.context_rule_engine.lock().await;
    Ok(engine.remove_rule(&rule_id))
}

/// List all context rules for a persona.
#[tauri::command]
pub async fn list_context_rules(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<ContextRule>, AppError> {
    let engine = state.context_rule_engine.lock().await;
    Ok(engine.list_rules(&persona_id))
}

/// Get recent context rule match history.
#[tauri::command]
pub async fn get_context_rule_matches(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ContextRuleMatch>, AppError> {
    let engine = state.context_rule_engine.lock().await;
    Ok(engine.recent_matches().to_vec())
}

/// Get context stream statistics.
#[tauri::command]
pub async fn get_context_stream_stats(
    state: State<'_, Arc<AppState>>,
) -> Result<ContextStreamStats, AppError> {
    let ctx = state.ambient_context.lock().await;
    Ok(ctx.stream_stats())
}
