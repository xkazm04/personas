use std::sync::Arc;

use tauri::State;

use crate::db::models::*;
use crate::db::repos::lab::evolution as evolution_repo;
use crate::engine::evolution;
use crate::engine::genome::FitnessObjective;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

// ============================================================================
// Policy management
// ============================================================================

/// Get the evolution policy for a persona (or null if none exists).
#[tauri::command]
pub fn evolution_get_policy(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Option<EvolutionPolicy>, AppError> {
    require_auth_sync(&state)?;
    evolution_repo::get_policy_for_persona(&state.db, &persona_id)
}

/// Create or update the evolution policy for a persona.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn evolution_upsert_policy(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    enabled: Option<bool>,
    fitness_objective: Option<FitnessObjective>,
    mutation_rate: Option<f64>,
    variants_per_cycle: Option<i32>,
    improvement_threshold: Option<f64>,
    min_executions_between: Option<i32>,
) -> Result<EvolutionPolicy, AppError> {
    require_auth_sync(&state)?;

    let obj_json = match fitness_objective {
        Some(o) => Some(serde_json::to_string(&o)
            .map_err(|e| AppError::Internal(format!("Failed to serialize fitness objective: {e}")))?),
        None => None,
    };

    let input = UpsertEvolutionPolicyInput {
        persona_id,
        enabled,
        fitness_objective: obj_json,
        mutation_rate: mutation_rate.map(|r| r.clamp(0.0, 1.0)),
        variants_per_cycle: variants_per_cycle.map(|v| v.clamp(2, 8)),
        improvement_threshold: improvement_threshold.map(|t| t.clamp(0.0, 0.5)),
        min_executions_between: min_executions_between.map(|m| m.clamp(3, 100)),
    };

    evolution_repo::upsert_policy(&state.db, &input)
}

/// Toggle auto-evolution on or off for a persona.
#[tauri::command]
pub fn evolution_toggle(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    enabled: bool,
) -> Result<EvolutionPolicy, AppError> {
    require_auth_sync(&state)?;

    let input = UpsertEvolutionPolicyInput {
        persona_id,
        enabled: Some(enabled),
        fitness_objective: None,
        mutation_rate: None,
        variants_per_cycle: None,
        improvement_threshold: None,
        min_executions_between: None,
    };

    evolution_repo::upsert_policy(&state.db, &input)
}

/// Delete evolution policy for a persona (disables auto-evolution).
#[tauri::command]
pub fn evolution_delete_policy(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    evolution_repo::delete_policy(&state.db, &persona_id)
}

// ============================================================================
// Cycle management
// ============================================================================

/// List evolution cycles for a persona.
#[tauri::command]
pub fn evolution_list_cycles(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<EvolutionCycle>, AppError> {
    require_auth_sync(&state)?;
    evolution_repo::list_cycles_for_persona(&state.db, &persona_id, limit)
}

/// Manually trigger an evolution cycle for a persona.
#[tauri::command]
pub async fn evolution_trigger_cycle(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<EvolutionCycle, AppError> {
    require_auth(&state).await?;

    // Get or create policy
    let policy = match evolution_repo::get_policy_for_persona(&state.db, &persona_id)? {
        Some(p) => p,
        None => {
            // Create default policy
            let input = UpsertEvolutionPolicyInput {
                persona_id: persona_id.clone(),
                enabled: Some(true),
                fitness_objective: None,
                mutation_rate: None,
                variants_per_cycle: None,
                improvement_threshold: None,
                min_executions_between: None,
            };
            evolution_repo::upsert_policy(&state.db, &input)?
        }
    };

    // Create cycle record
    let cycle = evolution_repo::create_cycle(&state.db, &policy.id, &persona_id)?;
    let cycle_id = cycle.id.clone();

    let pool = state.db.clone();
    tokio::spawn(async move {
        evolution::run_evolution_cycle(pool, policy, cycle_id).await;
    });

    Ok(cycle)
}

/// Check if a persona is eligible for an evolution cycle.
#[tauri::command]
pub fn evolution_check_eligibility(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;

    match evolution_repo::get_policy_for_persona(&state.db, &persona_id)? {
        Some(policy) => Ok(evolution::should_evolve(&state.db, &policy)),
        None => Ok(false),
    }
}
