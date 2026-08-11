//! Recipe outcome attribution — which recipes are actually worth anything.
//!
//! With 299 seeded recipes the product had no way to answer "which of these do
//! people actually run, and do they succeed?" The provenance existed
//! (`design_context.useCases[].source_recipe_id`, written at adoption) but was
//! never joined to a run. The only persisted per-recipe telemetry,
//! `recipe_suggestion_events`, measures composer chip impressions — an
//! interest signal, not an outcome one — and `dev_llm_spend`'s coarse
//! `source:"recipe"` tag comes from the dead playground path.
//!
//! Executions now carry `source_recipe_id` + `source_recipe_version`, stamped
//! at insert time from that existing provenance (see
//! `personas_db::repos::execution::executions::resolve_recipe_provenance`).
//! This command is the single, minimal read over it. Deliberately NOT a
//! dashboard: one query, one command.

use std::sync::Arc;

use tauri::State;

use crate::db::repos::execution::executions as exec_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Default tally page size. Generous enough that the long tail is visible
/// without pulling one row per seeded recipe.
const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;

/// One recipe's run outcomes.
///
/// Raw counts, not a pre-computed rate: what belongs in the denominator of
/// "success rate" is a product judgement (does a cancelled run count against
/// the recipe?) and baking one in would hide it. `terminal` is the honest
/// denominator — queued and running rows are not outcomes yet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RecipeOutcomeTally {
    pub recipe_id: String,
    /// `None` when the recipe row has since been deleted. The runs stay
    /// attributed regardless — provenance is a fact about the past.
    pub recipe_name: Option<String>,
    /// Every execution stamped with this recipe, any status.
    pub runs: i64,
    /// Runs that reached a terminal status.
    pub terminal: i64,
    pub completed: i64,
    pub failed: i64,
    /// Runs whose persona self-assessed that it actually delivered its job.
    /// A stricter and more meaningful bar than `completed`.
    pub value_delivered: i64,
    pub last_run_at: Option<String>,
}

/// Runs-per-recipe and success-rate-per-recipe, ordered by run count desc.
///
/// Recipes that have never been run are absent — this reports outcomes, and a
/// recipe with no runs has none. Executions that predate provenance stamping
/// carry a NULL recipe id and are excluded rather than guessed at, so an
/// established install's early history is honestly missing instead of wrong.
#[tauri::command]
pub async fn get_recipe_outcome_tallies(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<RecipeOutcomeTally>, AppError> {
    require_auth(&state).await?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    Ok(exec_repo::recipe_run_tallies(&state.db, limit)?
        .into_iter()
        .map(|t| RecipeOutcomeTally {
            recipe_id: t.recipe_id,
            recipe_name: t.recipe_name,
            runs: t.runs,
            terminal: t.terminal,
            completed: t.completed,
            failed: t.failed,
            value_delivered: t.value_delivered,
            last_run_at: t.last_run_at,
        })
        .collect())
}
