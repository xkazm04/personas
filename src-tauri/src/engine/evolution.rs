//! Auto-evolution engine — closed-loop persona optimization via lab-driven breeding.
//!
//! After execution cycles, automatically generates variant personas, tests them
//! in the lab (arena mode), and promotes winners to replace predecessors.
//! Creates Darwinian persona evolution without user intervention.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::test_runner::{execute_scenario, generate_scenarios, score_result, TestModelConfig};
use crate::db::models::{EvolutionPolicy, Persona, PersonaToolDefinition};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::lab::evolution as evolution_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::genome::{
    self, breed_generation, compute_fitness, parse_fitness_objective, PersonaGenome,
};

// =============================================================================
// Types
// =============================================================================

/// Status of an evolution cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EvolutionCycleStatus {
    Breeding,
    Evaluating,
    Promoting,
    Completed,
    Failed,
}

impl EvolutionCycleStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Breeding => "breeding",
            Self::Evaluating => "evaluating",
            Self::Promoting => "promoting",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    #[allow(dead_code)]
    pub fn from_db(s: &str) -> Self {
        match s {
            "breeding" => Self::Breeding,
            "evaluating" => Self::Evaluating,
            "promoting" => Self::Promoting,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => Self::Failed,
        }
    }
}

/// Summary of an evolution cycle result.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionCycleSummary {
    pub cycle_id: String,
    pub persona_id: String,
    pub generation: i32,
    pub variants_tested: i32,
    pub winner_fitness: Option<f64>,
    pub incumbent_fitness: Option<f64>,
    pub promoted: bool,
    pub promoted_persona_id: Option<String>,
    /// Whether all status updates succeeded during the cycle.
    /// `false` means the frontend may have shown stale status at some point.
    pub status_reliable: bool,
    /// Warnings encountered during the cycle (e.g. fitness objective fallback).
    pub warnings: Vec<String>,
    /// Raw fitness objective JSON from the policy, preserved for forensic debugging.
    pub raw_fitness_objective: Option<String>,
    /// Aggregate cost-budget state for this cycle's many CLI spawns (P2). `None`
    /// on cycles that ran before budget tracking. Surfaced in the cycle UI.
    #[serde(default)]
    pub budget: Option<crate::engine::run_budget::RunBudgetState>,
}

// =============================================================================
// Retry helpers for status updates
// =============================================================================

/// Try a status-update DB write, retrying once on failure.
/// Returns `true` if the write eventually succeeded.
fn try_status_update(
    pool: &DbPool,
    cycle_id: &str,
    status: EvolutionCycleStatus,
    error: Option<&str>,
) -> bool {
    match evolution_repo::update_cycle_status(pool, cycle_id, status, error) {
        Ok(()) => true,
        Err(first_err) => {
            tracing::warn!(
                cycle_id = %cycle_id,
                status = %status.as_str(),
                error = %first_err,
                "Status update failed, retrying once",
            );
            match evolution_repo::update_cycle_status(pool, cycle_id, status, error) {
                Ok(()) => true,
                Err(retry_err) => {
                    tracing::warn!(
                        cycle_id = %cycle_id,
                        status = %status.as_str(),
                        error = %retry_err,
                        "Status update retry also failed — frontend may show stale status",
                    );
                    false
                }
            }
        }
    }
}

// =============================================================================
// Evolution loop
// =============================================================================

/// Run a single evolution cycle for a persona.
///
/// 1. Extract genome from current persona
/// 2. Create self-bred variants via mutation (single-parent breeding)
/// 3. Compute fitness for each variant based on historical data
/// 4. If best variant beats incumbent by the improvement threshold, promote it
pub async fn run_evolution_cycle(pool: DbPool, policy: EvolutionPolicy, cycle_id: String) {
    let persona_id = policy.persona_id.clone();
    let mut status_reliable = true;

    // P2: track aggregate cost across this cycle's many CLI spawns (variants ×
    // scenarios × run+eval). Warn-only — see engine/run_budget.rs.
    crate::engine::run_budget::ledger().register(
        &cycle_id,
        "evolution",
        crate::engine::run_budget::evolution_ceiling_usd(),
    );

    // Phase 1: Breeding
    if !try_status_update(&pool, &cycle_id, EvolutionCycleStatus::Breeding, None) {
        tracing::error!(cycle_id = %cycle_id, "Failed to set breeding status even after retry");
        return;
    }

    // Load incumbent persona and extract genome
    let persona = match persona_repo::get_by_id(&pool, &persona_id) {
        Ok(p) => p,
        Err(e) => {
            if !try_status_update(
                &pool,
                &cycle_id,
                EvolutionCycleStatus::Failed,
                Some(&format!("Failed to load persona: {e}")),
            ) {
                status_reliable = false;
            }
            let _ = status_reliable; // consumed below; silence unused warning on early return
            return;
        }
    };

    let tools = tool_repo::get_tools_for_persona(&pool, &persona_id).unwrap_or_default();
    let tool_ids: Vec<String> = tools.iter().map(|t| t.id.clone()).collect();
    let incumbent_genome = PersonaGenome::from_persona(&persona, tool_ids);

    // Snapshot updated_at now as an optimistic-lock token for promotion below: if
    // a concurrent cycle or a user edit changes the persona during the (minutes-
    // long) evaluation, promotion is abandoned rather than clobbering it.
    let base_updated_at = persona.updated_at.clone();

    // Compute incumbent fitness
    let (objective, objective_warnings) = parse_fitness_objective(&policy.fitness_objective);
    if !objective_warnings.is_empty() {
        let warning_msg = objective_warnings.join("; ");
        tracing::warn!(
            cycle_id = %cycle_id,
            persona_id = %persona_id,
            raw_objective = %policy.fitness_objective,
            "Evolution cycle using fitness objective with warnings: {warning_msg}",
        );
        // Persist warning in cycle error field so frontend can show it
        let _ = evolution_repo::update_cycle_status(
            &pool,
            &cycle_id,
            EvolutionCycleStatus::Breeding,
            Some(&format!("Warning: {warning_msg}")),
        );
    }
    let incumbent_fitness = compute_fitness(&pool, &persona_id, &objective);

    // Create variants by self-breeding (cloning + mutation)
    // We create a small population by cloning the incumbent and mutating.
    //
    // Mutation strategy resolution:
    //   - "mechanical" or NULL — point mutation (shuffle/drop/permute/jiggle).
    //     Cheap, deterministic, no LLM calls. The legacy default.
    //   - "critique" — LLM reads recent failure-leaning knowledge and
    //     rewrites the prompt segments. Expensive (one CLI call per variant)
    //     but introduces NEW prompt content rather than just rearranging.
    //     Falls back to mechanical when the gradient is empty or the CLI
    //     errors, so a "critique" policy still always produces variants.
    //   - "hybrid" — first variant uses critique, the rest use mechanical.
    //     Cheap-by-default with one expensive exploration variant per cycle.
    let variant_count = policy.variants_per_cycle.clamp(2, 8) as usize;
    let mutation_rate = policy.mutation_rate;
    let strategy = policy.mutation_strategy.as_deref().unwrap_or("mechanical");
    let mut variants: Vec<PersonaGenome> = Vec::with_capacity(variant_count);

    for variant_idx in 0..variant_count {
        let use_critique = match strategy {
            "critique" => true,
            "hybrid" => variant_idx == 0,
            _ => false,
        };

        let mut variant = if use_critique {
            match crate::engine::genome_critique::mutate_via_critique(
                &pool,
                &persona,
                &incumbent_genome,
            )
            .await
            {
                Ok(g) => g,
                Err(e) => {
                    tracing::info!(
                        cycle_id = %cycle_id,
                        persona_id = %persona_id,
                        reason = %e,
                        "Critique mutator failed; falling back to mechanical for this variant",
                    );
                    let mut g = incumbent_genome.clone();
                    genome::mutate(&mut g, mutation_rate);
                    g
                }
            }
        } else {
            let mut g = incumbent_genome.clone();
            genome::mutate(&mut g, mutation_rate);
            g
        };

        variant.source_persona_id = format!("evo-{}", uuid::Uuid::new_v4());
        variant.source_persona_name = format!("{} (variant)", persona.name);
        variants.push(variant);
    }

    // Also breed pairs if we have enough variants
    if variants.len() >= 2 {
        let bred = breed_generation(&variants[..2.min(variants.len())], mutation_rate, 1);
        for offspring in bred.into_iter().take(2) {
            variants.push(offspring.genome);
        }
    }

    // Update variant count so frontend shows progress (retry once on failure)
    if let Err(e) = evolution_repo::update_variants_tested(&pool, &cycle_id, variants.len() as i32)
    {
        tracing::warn!(cycle_id = %cycle_id, error = %e, "Variant count update failed, retrying");
        if let Err(retry_err) =
            evolution_repo::update_variants_tested(&pool, &cycle_id, variants.len() as i32)
        {
            tracing::warn!(cycle_id = %cycle_id, error = %retry_err, "Variant count retry also failed");
            status_reliable = false;
        }
    }

    // Phase 2: Evaluating
    if !try_status_update(&pool, &cycle_id, EvolutionCycleStatus::Evaluating, None) {
        tracing::error!(cycle_id = %cycle_id, "Failed to set evaluating status even after retry");
        return;
    }

    // Evaluate variants by running them through real test scenarios via CLI.
    // 1. Generate test scenarios from the incumbent persona
    // 2. Execute each variant against the scenarios
    // 3. Score results with LLM eval
    // 4. Compare variant scores against incumbent

    // Generate scenarios from incumbent
    let scenarios = match generate_scenarios(&persona, &tools, None, None).await {
        Ok(s) if !s.is_empty() => s,
        Ok(_) => {
            if !try_status_update(
                &pool,
                &cycle_id,
                EvolutionCycleStatus::Failed,
                Some("No test scenarios generated for evaluation"),
            ) {
                status_reliable = false;
            }
            let _ = status_reliable;
            return;
        }
        Err(e) => {
            if !try_status_update(
                &pool,
                &cycle_id,
                EvolutionCycleStatus::Failed,
                Some(&format!("Scenario generation failed: {e}")),
            ) {
                status_reliable = false;
            }
            let _ = status_reliable;
            return;
        }
    };

    // Default model for evaluation
    let eval_model = TestModelConfig {
        id: "sonnet".to_string(),
        model: Some("claude-sonnet-4-6".to_string()),
        provider: "anthropic".to_string(),
        base_url: None,
        auth_token: None,
        effort: None, // falls back to prompt::DEFAULT_EFFORT
    };

    // Score the incumbent first (baseline)
    let incumbent_avg =
        evaluate_persona_on_scenarios(&persona, &tools, &scenarios, &eval_model, &cycle_id).await;

    // Score each variant
    let mut best_variant_idx: Option<usize> = None;
    let mut best_variant_score: f64 = 0.0;

    for (i, variant) in variants.iter().enumerate() {
        // P2 enforce-mode: stop evaluating further variants once the cycle's
        // budget is exhausted (warn-only mode never halts). Already-evaluated
        // variants still compete for promotion below.
        if crate::engine::run_budget::ledger().should_halt(&cycle_id) {
            tracing::warn!(
                cycle_id = %cycle_id,
                evaluated = i,
                "Evolution cycle halted variant evaluation — budget ceiling reached (enforce mode)",
            );
            break;
        }
        // Create ephemeral persona from variant genome
        let mut variant_persona = persona.clone();
        variant_persona.system_prompt = variant.reassemble_prompt();
        // Clear structured_prompt so the system_prompt is used
        variant_persona.structured_prompt = None;

        let variant_avg =
            evaluate_persona_on_scenarios(&variant_persona, &tools, &scenarios, &eval_model, &cycle_id)
                .await;

        tracing::debug!(
            cycle_id = %cycle_id,
            variant = i,
            score = variant_avg,
            incumbent = incumbent_avg,
            "Evolution: variant {} scored {:.2} (incumbent: {:.2})", i, variant_avg, incumbent_avg,
        );

        if variant_avg > best_variant_score {
            best_variant_score = variant_avg;
            best_variant_idx = Some(i);
        }
    }

    // Phase 3: Promoting
    if !try_status_update(&pool, &cycle_id, EvolutionCycleStatus::Promoting, None) {
        tracing::error!(cycle_id = %cycle_id, "Failed to set promoting status even after retry");
        return;
    }

    let threshold = policy.improvement_threshold;
    let promoted = if let Some(idx) = best_variant_idx {
        let improvement = best_variant_score - incumbent_fitness.overall;
        if improvement >= threshold {
            // Promote: update the persona with the winning variant's genome
            let winner = &variants[idx];
            let new_prompt = winner.reassemble_prompt();

            match promote_variant(&pool, &persona_id, winner, &new_prompt, &base_updated_at) {
                Ok(()) => {
                    tracing::info!(
                        persona_id = %persona_id,
                        cycle_id = %cycle_id,
                        improvement = improvement,
                        "Evolution: promoted variant with {:.2}% improvement",
                        improvement * 100.0,
                    );
                    true
                }
                Err(e) => {
                    tracing::warn!(
                        cycle_id = %cycle_id,
                        error = %e,
                        "Evolution: failed to promote variant"
                    );
                    false
                }
            }
        } else {
            tracing::debug!(
                persona_id = %persona_id,
                cycle_id = %cycle_id,
                improvement = improvement,
                threshold = threshold,
                "Evolution: no variant met improvement threshold"
            );
            false
        }
    } else {
        false
    };

    // Finalize cycle
    let summary = EvolutionCycleSummary {
        cycle_id: cycle_id.clone(),
        persona_id: persona_id.clone(),
        generation: policy.total_cycles + 1,
        variants_tested: variants.len() as i32,
        winner_fitness: best_variant_idx.map(|_| best_variant_score),
        incumbent_fitness: Some(incumbent_fitness.overall),
        promoted,
        promoted_persona_id: if promoted {
            Some(persona_id.clone())
        } else {
            None
        },
        status_reliable,
        warnings: objective_warnings,
        raw_fitness_objective: Some(policy.fitness_objective.clone()),
        budget: crate::engine::run_budget::ledger().state(&cycle_id),
    };

    let summary_json = serde_json::to_string(&summary).unwrap_or_default();
    // complete_cycle is critical — retry once on failure
    if let Err(e) = evolution_repo::complete_cycle(
        &pool,
        &cycle_id,
        promoted,
        best_variant_idx.map(|_| best_variant_score),
        incumbent_fitness.overall,
        &summary_json,
    ) {
        tracing::warn!(cycle_id = %cycle_id, error = %e, "complete_cycle failed, retrying");
        if let Err(retry_err) = evolution_repo::complete_cycle(
            &pool,
            &cycle_id,
            promoted,
            best_variant_idx.map(|_| best_variant_score),
            incumbent_fitness.overall,
            &summary_json,
        ) {
            tracing::error!(
                cycle_id = %cycle_id,
                error = %retry_err,
                "complete_cycle retry also failed — cycle will appear stuck in DB",
            );
        }
    }

    // P2: release the cycle's budget entry (retained 30m for post-run reads).
    crate::engine::run_budget::ledger().finish(&cycle_id);
}

// =============================================================================
// Real variant evaluation via CLI execution
// =============================================================================

/// Run a persona against test scenarios and return average composite score (0.0-1.0).
async fn evaluate_persona_on_scenarios(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    scenarios: &[super::test_runner::TestScenario],
    model: &TestModelConfig,
    run_id: &str,
) -> f64 {
    let mut total_score: f64 = 0.0;
    let mut count: usize = 0;

    // Run up to 3 scenarios to keep evaluation fast
    let max_scenarios = scenarios.len().min(3);
    for scenario in &scenarios[..max_scenarios] {
        match execute_scenario(persona, tools, scenario, model).await {
            Ok(output) => {
                let scores = score_result(&output, scenario, persona).await;
                // P2: record this scenario's cost against the cycle's aggregate
                // budget (warn-only — the cycle is not aborted). score_result
                // copies output.cost_usd into scores.cost_usd, so record it once
                // (summing them would double-count).
                let outcome = crate::engine::run_budget::ledger()
                    .record(run_id, output.cost_usd);
                if outcome.exceeded_now {
                    tracing::warn!(
                        run_id = %run_id,
                        spent_usd = outcome.spent_usd,
                        ceiling_usd = outcome.ceiling_usd,
                        "Evolution cycle exceeded its aggregate budget ceiling (warn-only; cycle continues)",
                    );
                }
                let composite = (scores.tool_accuracy.unwrap_or(0) as f64 * 0.3
                    + scores.output_quality.unwrap_or(0) as f64 * 0.4
                    + scores.protocol_compliance.unwrap_or(0) as f64 * 0.3)
                    / 100.0;
                total_score += composite;
                count += 1;
            }
            Err(e) => {
                tracing::debug!(
                    "Evolution eval failed for scenario '{}': {}",
                    scenario.name,
                    e
                );
                // Count failures as 0 score
                count += 1;
            }
        }
    }

    if count == 0 {
        return 0.0;
    }
    total_score / count as f64
}

// =============================================================================
// Promotion
// =============================================================================

/// Apply a winning variant's genome back to the incumbent persona.
fn promote_variant(
    pool: &DbPool,
    persona_id: &str,
    winner: &PersonaGenome,
    new_prompt: &str,
    expected_updated_at: &str,
) -> Result<(), crate::error::AppError> {
    let conn = pool.get()?;
    // Compare-and-swap on updated_at: the cycle captured the incumbent at its
    // start and spent minutes evaluating. If the persona changed since then —
    // a concurrent cycle promoting, or the user editing the prompt in the UI —
    // updated_at no longer matches, the UPDATE affects 0 rows, and we abandon
    // promotion instead of silently overwriting the newer state (lost update).
    let rows = conn.execute(
        "UPDATE personas SET
            system_prompt = ?1,
            structured_prompt = ?2,
            timeout_ms = ?3,
            max_concurrent = ?4,
            model_profile = ?5,
            max_budget_usd = ?6,
            max_turns = ?7,
            updated_at = ?8
         WHERE id = ?9 AND updated_at = ?10",
        rusqlite::params![
            new_prompt,
            winner.structured_prompt,
            winner.model.timeout_ms,
            winner.config.max_concurrent,
            winner.model.model_profile,
            winner.model.max_budget_usd,
            winner.model.max_turns,
            chrono::Utc::now().to_rfc3339(),
            persona_id,
            expected_updated_at,
        ],
    )?;
    if rows == 0 {
        return Err(crate::error::AppError::Validation(
            "Persona changed during the evolution cycle — promotion abandoned to avoid overwriting the newer state".into(),
        ));
    }
    Ok(())
}

// =============================================================================
// Policy check: should we trigger an evolution cycle?
// =============================================================================

/// Check if enough executions have occurred since the last cycle to warrant evolution.
pub fn should_evolve(pool: &DbPool, policy: &EvolutionPolicy) -> bool {
    if !policy.enabled {
        return false;
    }

    // Count executions since last cycle
    let exec_count: i64 = pool
        .get()
        .ok()
        .and_then(|conn| {
            let since = policy
                .last_cycle_at
                .as_deref()
                .unwrap_or("1970-01-01T00:00:00Z");
            conn.query_row(
                "SELECT COUNT(*) FROM persona_executions
                 WHERE persona_id = ?1 AND status = 'completed' AND created_at > ?2",
                rusqlite::params![policy.persona_id, since],
                |row| row.get(0),
            )
            .ok()
        })
        .unwrap_or(0);

    exec_count >= policy.min_executions_between as i64
}
