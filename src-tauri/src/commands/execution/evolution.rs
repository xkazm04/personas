use std::sync::Arc;

use tauri::State;

use crate::background_job::spawn_guarded;
use crate::db::models::*;
use crate::db::repos::lab::evolution as evolution_repo;
use crate::engine::evolution;
use crate::engine::evolution::EvolutionCycleStatus;
use crate::engine::genome::FitnessObjective;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

// ============================================================================
// Policy management
// ============================================================================

/// The only mutation strategies the evolution runtime dispatches on.
const VALID_MUTATION_STRATEGIES: &[&str] = &["mechanical", "critique", "hybrid"];

/// Validate an optional `mutation_strategy` at the IPC trust boundary.
/// `None` (field omitted) stays `None` — the repo treats that as "leave the
/// stored value alone". An unrecognised value is an error, never a silent drop.
fn validate_mutation_strategy(raw: Option<String>) -> Result<Option<String>, AppError> {
    match raw {
        None => Ok(None),
        Some(s) if VALID_MUTATION_STRATEGIES.contains(&s.as_str()) => Ok(Some(s)),
        Some(s) => Err(AppError::Validation(format!(
            "Invalid mutation_strategy '{}'. Must be one of: {}",
            s,
            VALID_MUTATION_STRATEGIES.join(", ")
        ))),
    }
}

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
    mutation_strategy: Option<String>,
) -> Result<EvolutionPolicy, AppError> {
    require_auth_sync(&state)?;

    let obj_json = match fitness_objective {
        Some(o) => Some(serde_json::to_string(&o).map_err(|e| {
            AppError::Internal(format!("Failed to serialize fitness objective: {e}"))
        })?),
        None => None,
    };

    // Boundary validation: only accept the three known strategies. REJECT
    // anything else instead of dropping it to `None` — the repo's UPDATE
    // COALESCEs every `None` field onto the stored value, so a silent drop did
    // NOT mean "legacy mechanical" (as an earlier comment here claimed): it
    // silently kept whatever strategy was already persisted while reporting
    // success, so the caller believed a strategy it never got. Mirrors the
    // explicit-reject boundary used by `lab_tag_version` and
    // `upsert_knowledge_annotation`.
    let strategy = validate_mutation_strategy(mutation_strategy)?;

    let input = UpsertEvolutionPolicyInput {
        persona_id,
        enabled,
        fitness_objective: obj_json,
        mutation_rate: mutation_rate.map(|r| r.clamp(0.0, 1.0)),
        variants_per_cycle: variants_per_cycle.map(|v| v.clamp(2, 8)),
        improvement_threshold: improvement_threshold.map(|t| t.clamp(0.0, 0.5)),
        min_executions_between: min_executions_between.map(|m| m.clamp(3, 100)),
        mutation_strategy: strategy,
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
        mutation_strategy: None,
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

/// Read the live aggregate run-budget state for any multi-spawn run — pass an
/// evolution cycle id, a lab run id, or a pipeline run id. Returns `None` once
/// the run's entry has been swept (~30 min after it finished). Uniform
/// observability across all three consumers — see `engine/run_budget.rs`.
#[tauri::command]
pub fn get_run_budget_state(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Option<crate::engine::run_budget::RunBudgetState>, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::engine::run_budget::ledger().state(&run_id))
}

/// Probe the Claude Code CLI's exposed capabilities (P4 fan-out gate). Spawns a
/// bounded `claude -p` and reads its tool/agent registry from the init event;
/// result is cached unless `force`. Surfaces whether `Workflow`/`Task` fan-out is
/// available on this machine + account (tier-gated).
#[tauri::command]
pub async fn probe_cli_capabilities(
    state: State<'_, Arc<AppState>>,
    force: Option<bool>,
) -> Result<crate::engine::cli_capabilities::CliCapabilities, AppError> {
    require_auth(&state).await?;
    crate::engine::cli_capabilities::get_or_probe(force.unwrap_or(false))
        .await
        .map_err(AppError::Internal)
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
                mutation_strategy: None,
            };
            evolution_repo::upsert_policy(&state.db, &input)?
        }
    };

    // Create cycle record
    let cycle = evolution_repo::create_cycle(&state.db, &policy.id, &persona_id)?;
    let cycle_id = cycle.id.clone();

    let pool = state.db.clone();
    let pool_for_panic = pool.clone();
    let cycle_id_for_panic = cycle_id.clone();
    spawn_guarded(
        "evolution cycle",
        cycle_id_for_panic.clone(),
        evolution::run_evolution_cycle(pool, policy, cycle_id),
        move |msg| async move {
            let _ = evolution_repo::update_cycle_status(
                &pool_for_panic,
                &cycle_id_for_panic,
                EvolutionCycleStatus::Failed,
                Some(&msg),
            );
        },
    );

    Ok(cycle)
}

// ============================================================================
// Promotion proposals (Darwin Mode v1 — human-gated, NO auto-promotion)
// ============================================================================

/// List promotion proposals, newest first. Optional persona/status filters
/// (`status`: `pending` | `approved` | `rejected`).
#[tauri::command]
pub fn evolution_list_promotion_proposals(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<EvolutionPromotionProposal>, AppError> {
    require_auth_sync(&state)?;
    crate::db::repos::lab::evolution_proposals::list(
        &state.db,
        persona_id.as_deref(),
        status.as_deref(),
        limit.unwrap_or(50),
    )
}

/// Approve or reject a PENDING promotion proposal.
///
/// This is the ONLY code path that promotes an evolved variant onto a live
/// persona. Approval applies the winner genome under an optimistic lock (the
/// `base_updated_at` token captured when the cycle started — a persona edited
/// since then fails closed) and writes field-level `persona_change_log` rows
/// with source `"evolution"`, then flips the originating cycle's `promoted`
/// flag. Rejection records the decision and touches nothing else.
#[tauri::command]
pub fn evolution_resolve_promotion_proposal(
    state: State<'_, Arc<AppState>>,
    proposal_id: String,
    approve: bool,
    note: Option<String>,
) -> Result<EvolutionPromotionProposal, AppError> {
    require_auth_sync(&state)?;
    let repo = crate::db::repos::lab::evolution_proposals::get_by_id;
    let proposal = repo(&state.db, &proposal_id)?;
    if proposal.status != "pending" {
        return Err(AppError::Validation(format!(
            "Proposal {proposal_id} is already {}",
            proposal.status
        )));
    }

    if approve {
        let winner: crate::engine::genome::PersonaGenome =
            serde_json::from_str(&proposal.winner_genome_json)
                .map_err(|e| AppError::Internal(format!("Failed to parse winner genome: {e}")))?;
        if proposal.new_prompt.trim().is_empty() {
            return Err(AppError::Validation(
                "Cannot promote: the winner's prompt reassembles to an empty system prompt".into(),
            ));
        }
        // Apply FIRST — if the persona moved since the cycle ran, this fails
        // closed and the proposal stays pending for an informed rejection.
        evolution::apply_promotion(
            &state.db,
            &proposal.persona_id,
            &winner,
            &proposal.new_prompt,
            &proposal.base_updated_at,
        )?;
        let resolved = crate::db::repos::lab::evolution_proposals::resolve(
            &state.db,
            &proposal_id,
            true,
            note.as_deref(),
        )?;
        // Best-effort stats: the promotion itself already succeeded.
        if let Err(e) = evolution_repo::mark_cycle_promoted(&state.db, &proposal.cycle_id) {
            tracing::warn!(
                cycle_id = %proposal.cycle_id,
                error = %e,
                "Promotion applied but cycle stats update failed",
            );
        }
        tracing::info!(
            persona_id = %proposal.persona_id,
            proposal_id = %proposal_id,
            improvement = proposal.improvement,
            "Evolution promotion APPROVED and applied",
        );
        Ok(resolved)
    } else {
        crate::db::repos::lab::evolution_proposals::resolve(
            &state.db,
            &proposal_id,
            false,
            note.as_deref(),
        )
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_three_known_strategies() {
        for s in ["mechanical", "critique", "hybrid"] {
            assert_eq!(
                validate_mutation_strategy(Some(s.to_string())).unwrap(),
                Some(s.to_string())
            );
        }
    }

    #[test]
    fn omitted_strategy_stays_none() {
        assert_eq!(validate_mutation_strategy(None).unwrap(), None);
    }

    #[test]
    fn unknown_strategy_is_rejected_not_silently_dropped() {
        // The regression this guards: returning Ok(None) here made the repo's
        // COALESCE keep the PREVIOUS strategy while the caller saw success.
        let err = validate_mutation_strategy(Some("genetic".into()))
            .expect_err("unknown strategy must be a validation error");
        assert!(
            matches!(err, AppError::Validation(_)),
            "expected a validation error, got {err:?}"
        );
        assert!(format!("{err:?}").contains("mechanical"));
    }
}
