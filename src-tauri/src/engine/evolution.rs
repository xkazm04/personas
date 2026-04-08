//! Auto-evolution engine — closed-loop persona optimization via lab-driven breeding.
//!
//! After execution cycles, automatically generates variant personas, tests them
//! in the lab (arena mode), and promotes winners to replace predecessors.
//! Creates Darwinian persona evolution without user intervention.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::{EvolutionPolicy, Persona, PersonaToolDefinition};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::lab::evolution as evolution_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::genome::{
    self, breed_generation, compute_fitness, FitnessObjective, FitnessScore, PersonaGenome,
};
use super::test_runner::{generate_scenarios, execute_scenario, score_result, TestModelConfig};

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
pub async fn run_evolution_cycle(
    pool: DbPool,
    policy: EvolutionPolicy,
    cycle_id: String,
) {
    let persona_id = policy.persona_id.clone();

    // Phase 1: Breeding
    if let Err(e) = evolution_repo::update_cycle_status(
        &pool,
        &cycle_id,
        EvolutionCycleStatus::Breeding,
        None,
    ) {
        tracing::error!(cycle_id = %cycle_id, error = %e, "Failed to update cycle to breeding");
        return;
    }

    // Load incumbent persona and extract genome
    let persona = match persona_repo::get_by_id(&pool, &persona_id) {
        Ok(p) => p,
        Err(e) => {
            let _ = evolution_repo::update_cycle_status(
                &pool,
                &cycle_id,
                EvolutionCycleStatus::Failed,
                Some(&format!("Failed to load persona: {e}")),
            );
            return;
        }
    };

    let tools = tool_repo::get_tools_for_persona(&pool, &persona_id).unwrap_or_default();
    let tool_ids: Vec<String> = tools.iter().map(|t| t.id.clone()).collect();
    let incumbent_genome = PersonaGenome::from_persona(&persona, tool_ids);

    // Compute incumbent fitness
    let objective: FitnessObjective = serde_json::from_str(&policy.fitness_objective)
        .unwrap_or_default();
    let incumbent_fitness = compute_fitness(&pool, &persona_id, &objective);

    // Create variants by self-breeding (cloning + mutation)
    // We create a small population by cloning the incumbent and mutating
    let variant_count = policy.variants_per_cycle.clamp(2, 8) as usize;
    let mutation_rate = policy.mutation_rate;
    let mut variants: Vec<PersonaGenome> = Vec::with_capacity(variant_count);

    for _ in 0..variant_count {
        let mut variant = incumbent_genome.clone();
        genome::mutate(&mut variant, mutation_rate);
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

    // Update variant count so frontend shows progress
    let _ = evolution_repo::update_variants_tested(&pool, &cycle_id, variants.len() as i32);

    // Phase 2: Evaluating
    if let Err(e) = evolution_repo::update_cycle_status(
        &pool,
        &cycle_id,
        EvolutionCycleStatus::Evaluating,
        None,
    ) {
        tracing::error!(cycle_id = %cycle_id, error = %e, "Failed to update cycle to evaluating");
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
            let _ = evolution_repo::update_cycle_status(
                &pool, &cycle_id, EvolutionCycleStatus::Failed,
                Some("No test scenarios generated for evaluation"),
            );
            return;
        }
        Err(e) => {
            let _ = evolution_repo::update_cycle_status(
                &pool, &cycle_id, EvolutionCycleStatus::Failed,
                Some(&format!("Scenario generation failed: {e}")),
            );
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
    let incumbent_avg = evaluate_persona_on_scenarios(&persona, &tools, &scenarios, &eval_model).await;

    // Score each variant
    let mut best_variant_idx: Option<usize> = None;
    let mut best_variant_score: f64 = 0.0;

    for (i, variant) in variants.iter().enumerate() {
        // Create ephemeral persona from variant genome
        let mut variant_persona = persona.clone();
        variant_persona.system_prompt = variant.reassemble_prompt();
        // Clear structured_prompt so the system_prompt is used
        variant_persona.structured_prompt = None;

        let variant_avg = evaluate_persona_on_scenarios(&variant_persona, &tools, &scenarios, &eval_model).await;

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
    if let Err(e) = evolution_repo::update_cycle_status(
        &pool,
        &cycle_id,
        EvolutionCycleStatus::Promoting,
        None,
    ) {
        tracing::error!(cycle_id = %cycle_id, error = %e, "Failed to update cycle to promoting");
        return;
    }

    let threshold = policy.improvement_threshold;
    let promoted = if let Some(idx) = best_variant_idx {
        let improvement = best_variant_score - incumbent_fitness.overall;
        if improvement >= threshold {
            // Promote: update the persona with the winning variant's genome
            let winner = &variants[idx];
            let new_prompt = winner.reassemble_prompt();

            match promote_variant(&pool, &persona_id, winner, &new_prompt) {
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
        generation: 1,
        variants_tested: variants.len() as i32,
        winner_fitness: best_variant_idx.map(|_| best_variant_score),
        incumbent_fitness: Some(incumbent_fitness.overall),
        promoted,
        promoted_persona_id: if promoted { Some(persona_id.clone()) } else { None },
    };

    let summary_json = serde_json::to_string(&summary).unwrap_or_default();
    let _ = evolution_repo::complete_cycle(
        &pool,
        &cycle_id,
        promoted,
        best_variant_idx.map(|_| best_variant_score),
        incumbent_fitness.overall,
        &summary_json,
    );
}

// =============================================================================
// Variant scoring
// =============================================================================

/// Score a variant genome relative to the incumbent.
///
/// Combines the incumbent's actual fitness with structural heuristics
/// to estimate variant quality without running full executions.
#[allow(dead_code)]
fn score_variant(
    variant: &PersonaGenome,
    incumbent: &PersonaGenome,
    incumbent_fitness: &FitnessScore,
) -> f64 {
    let base = incumbent_fitness.overall;

    // Segment preservation bonus: variants that keep similar segment count score higher
    let seg_ratio = variant.prompt_segments.len() as f64
        / incumbent.prompt_segments.len().max(1) as f64;
    let seg_bonus = if (0.5..=1.5).contains(&seg_ratio) {
        0.02 // Reasonable segment count
    } else {
        -0.05 // Too much divergence
    };

    // Tool retention bonus
    let incumbent_tools: std::collections::HashSet<&str> =
        incumbent.tools.tool_ids.iter().map(|s| s.as_str()).collect();
    let retained = variant
        .tools
        .tool_ids
        .iter()
        .filter(|t| incumbent_tools.contains(t.as_str()))
        .count();
    let tool_ratio = retained as f64 / incumbent_tools.len().max(1) as f64;
    let tool_bonus = (tool_ratio - 0.5) * 0.04; // +0.02 for full retention, -0.02 for 0%

    // Config reasonableness: timeout shouldn't be too low
    let timeout_penalty = if variant.model.timeout_ms < 10_000 { -0.03 } else { 0.0 };

    // Add small random perturbation to break ties and explore
    let perturbation = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        rng.gen_range(-0.01..0.01)
    };

    (base + seg_bonus + tool_bonus + timeout_penalty + perturbation).clamp(0.0, 1.0)
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
) -> f64 {
    let mut total_score: f64 = 0.0;
    let mut count: usize = 0;

    // Run up to 3 scenarios to keep evaluation fast
    let max_scenarios = scenarios.len().min(3);
    for scenario in &scenarios[..max_scenarios] {
        match execute_scenario(persona, tools, scenario, model).await {
            Ok(output) => {
                let scores = score_result(&output, scenario, persona).await;
                let composite = (scores.tool_accuracy.unwrap_or(0) as f64 * 0.3
                    + scores.output_quality.unwrap_or(0) as f64 * 0.4
                    + scores.protocol_compliance.unwrap_or(0) as f64 * 0.3)
                    / 100.0;
                total_score += composite;
                count += 1;
            }
            Err(e) => {
                tracing::debug!("Evolution eval failed for scenario '{}': {}", scenario.name, e);
                // Count failures as 0 score
                count += 1;
            }
        }
    }

    if count == 0 { return 0.0; }
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
) -> Result<(), crate::error::AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE personas SET
            system_prompt = ?1,
            structured_prompt = ?2,
            timeout_ms = ?3,
            max_concurrent = ?4,
            model_profile = ?5,
            max_budget_usd = ?6,
            max_turns = ?7,
            updated_at = ?8
         WHERE id = ?9",
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
        ],
    )?;
    Ok(())
}

// =============================================================================
// Policy check: should we trigger an evolution cycle?
// =============================================================================

/// Check if enough executions have occurred since the last cycle to warrant evolution.
pub fn should_evolve(
    pool: &DbPool,
    policy: &EvolutionPolicy,
) -> bool {
    if !policy.enabled {
        return false;
    }

    // Count executions since last cycle
    let exec_count: i64 = pool
        .get()
        .ok()
        .and_then(|conn| {
            let since = policy.last_cycle_at.as_deref().unwrap_or("1970-01-01T00:00:00Z");
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
