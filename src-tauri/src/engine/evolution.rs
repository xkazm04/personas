//! Auto-evolution engine — closed-loop persona optimization via lab-driven breeding.
//!
//! Darwin Mode v1: after execution cycles, generates challenger variants,
//! MEASURES incumbent and challengers on the same replay set (synthetic
//! fixtures + the persona's recent real workload inputs, scored on assertion
//! pass-rate + cost + latency via `engine::fitness_driver`), and — when a
//! challenger beats the incumbent by the policy threshold — FILES a
//! human-review promotion proposal. There is NO auto-promotion path: the only
//! way a winner reaches the live persona is an explicit approval command,
//! which applies under an optimistic lock and logs to `persona_change_log`.
//!
//! Feedback-loop hygiene: challenger replays never write executions, knowledge
//! or assertion rows (outputs are discarded), so a challenger cannot feed its
//! own future evidence. All replay spend is recorded against the cycle's
//! budget ledger and the evaluation loop HARD-stops at the ceiling.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::fitness_driver::{
    self, replay_candidate, score_measured_fitness, MeasuredFitness, ReplaySample,
};
use super::test_runner::generate_scenarios;
use crate::db::models::{EvolutionPolicy, UpdatePersonaInput};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::lab::evolution as evolution_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::genome::{
    self, breed_generation, compute_fitness, parse_fitness_objective, PersonaGenome,
};
use crate::engine::inflight_guard::InflightGuard;
use std::sync::LazyLock;

/// Single-flight guard keyed by persona_id. Both the manual
/// `evolution_start_cycle` command and the post-execution auto-trigger can
/// spawn a cycle for the same persona; without this they run concurrently —
/// doubling breeding/eval CLI spend and racing two promotions onto one
/// incumbent.
static EVOLUTION_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

// =============================================================================
// Types
// =============================================================================

// Moved to `personas_core::evolution_status` — `db::repos::lab::evolution`
// persists this value and cannot depend on the evolution engine above it.
pub use personas_core::evolution_status::EvolutionCycleStatus;

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
    /// Always `false` at cycle end in Darwin Mode v1 — promotion is
    /// proposal-gated. Flips true only when a human approves the proposal.
    pub promoted: bool,
    pub promoted_persona_id: Option<String>,
    /// Id of the promotion proposal FILED by this cycle (winner beat incumbent
    /// by the threshold). `None` when no challenger cleared the bar.
    #[serde(default)]
    pub proposal_id: Option<String>,
    /// `"measured"` on Darwin cycles — incumbent/winner fitness came from
    /// replay measurement, not historical prediction.
    #[serde(default)]
    pub fitness_source: Option<String>,
    /// How many of the replay scenarios were rebuilt from REAL workload inputs.
    #[serde(default)]
    pub workload_replays: i32,
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
// Backoff-clock guard
// =============================================================================

/// RAII guard that advances the policy's backoff clock (`last_cycle_at`) when a
/// cycle ends on a *failure* path.
///
/// The SUCCESS path calls `complete_cycle` (which stamps `last_cycle_at` and
/// bumps `total_cycles`) and then sets `finalized = true`, so this guard does
/// NOT double-stamp. Any early `return` from `run_evolution_cycle` (persona
/// load failure, empty scenarios, a status write that won't land, etc.) drops
/// the guard with `finalized == false`, stamping `last_cycle_at = now` via
/// `mark_cycle_attempted` so `should_evolve` waits a fresh
/// `min_executions_between` window before retrying — closing the failed-cycle
/// auto-trigger retry storm. `total_cycles` is never bumped here (success-only).
struct CycleClockGuard<'a> {
    pool: &'a DbPool,
    policy_id: String,
    finalized: bool,
}

impl Drop for CycleClockGuard<'_> {
    fn drop(&mut self) {
        if self.finalized {
            return;
        }
        if let Err(e) = evolution_repo::mark_cycle_attempted(self.pool, &self.policy_id) {
            tracing::warn!(
                policy_id = %self.policy_id,
                error = %e,
                "Failed to advance last_cycle_at after a failed evolution cycle — \
                 next completed execution may re-fire the cycle prematurely",
            );
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

    // Refuse a second concurrent cycle for the same persona. The caller has
    // already created the cycle row, so on refusal we mark it failed rather
    // than leave it stuck in a non-terminal "breeding" state forever. The RAII
    // handle releases the key on every return path below.
    let _inflight = match EVOLUTION_INFLIGHT.guard(&persona_id) {
        Some(handle) => handle,
        None => {
            try_status_update(
                &pool,
                &cycle_id,
                EvolutionCycleStatus::Failed,
                Some("another evolution cycle for this persona is already in flight"),
            );
            tracing::warn!(
                persona_id = %persona_id,
                cycle_id = %cycle_id,
                "Refused concurrent evolution cycle (single-flight guard)"
            );
            return;
        }
    };

    let mut status_reliable = true;

    // Backoff-clock guard. Created AFTER the single-flight guard so the
    // concurrent-refusal path above does NOT stamp (the in-flight holder owns
    // the clock). On every *failure* return below this drops with
    // `finalized == false` and advances `last_cycle_at`; the success path sets
    // `finalized = true` after `complete_cycle` so we never double-stamp.
    let mut clock_guard = CycleClockGuard {
        pool: &pool,
        policy_id: policy.id.clone(),
        finalized: false,
    };

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
    let scenarios = match generate_scenarios(&persona, &tools, None, None, &pool).await {
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
    let eval_model = fitness_driver::default_eval_model();

    // Build the shared replay set: a couple of synthetic fixtures plus the
    // persona's most recent REAL workload inputs (challenger harness) — every
    // candidate and the incumbent are measured on the SAME set. Replay outputs
    // are discarded; only measurements survive.
    let workload =
        fitness_driver::workload_replay_scenarios(&pool, &persona_id, fitness_driver::WORKLOAD_REPLAY_COUNT);
    let workload_count = workload.len() as i32;
    let mut replay_set: Vec<super::test_runner::TestScenario> =
        scenarios.iter().take(2).cloned().collect();
    replay_set.extend(workload);

    // Measure the incumbent first (baseline) — assertion pass-rate + cost +
    // latency folded by the pure scorer.
    let incumbent_samples: Vec<ReplaySample> = replay_candidate(
        &pool, &persona, &tools, &replay_set, &eval_model, &cycle_id, &persona_id,
    )
    .await;
    let incumbent_measured = match score_measured_fitness(&incumbent_samples, &objective) {
        Some(m) => m,
        None => {
            // Sparse-data honesty: without a measured baseline there is no
            // legitimate comparison — fail the cycle rather than fall back to
            // a historical prediction that isn't like-for-like.
            if !try_status_update(
                &pool,
                &cycle_id,
                EvolutionCycleStatus::Failed,
                Some("Could not measure incumbent fitness (no replay samples — budget exhausted before the first replay?)"),
            ) {
                status_reliable = false;
            }
            let _ = status_reliable;
            return;
        }
    };

    // Measure each challenger on the same replay set.
    let mut best_variant_idx: Option<usize> = None;
    let mut best_measured: Option<MeasuredFitness> = None;
    let mut per_variant_overall: Vec<Option<f64>> = Vec::with_capacity(variants.len());

    for (i, variant) in variants.iter().enumerate() {
        // HARD budget cap: stop evaluating once the cycle's ceiling is crossed,
        // regardless of the global enforce toggle — evolution spend is always
        // capped. Already-measured variants still compete below.
        if crate::engine::run_budget::ledger().is_exceeded(&cycle_id) {
            tracing::warn!(
                cycle_id = %cycle_id,
                evaluated = i,
                "Evolution cycle hard-stopped variant evaluation — budget ceiling reached",
            );
            per_variant_overall.resize(variants.len(), None);
            break;
        }
        let variant_persona = fitness_driver::candidate_from_genome(&persona, variant);

        let samples = replay_candidate(
            &pool, &variant_persona, &tools, &replay_set, &eval_model, &cycle_id, &persona_id,
        )
        .await;
        let measured = score_measured_fitness(&samples, &objective);
        per_variant_overall.push(measured.as_ref().map(|m| m.overall));

        if let Some(m) = measured {
            tracing::debug!(
                cycle_id = %cycle_id,
                variant = i,
                score = m.overall,
                incumbent = incumbent_measured.overall,
                "Evolution: variant {} measured {:.3} (incumbent: {:.3})",
                i, m.overall, incumbent_measured.overall,
            );
            if best_measured.as_ref().map_or(true, |b| m.overall > b.overall) {
                best_measured = Some(m);
                best_variant_idx = Some(i);
            }
        }
    }

    // Phase 3: Proposing (status string kept for frontend compatibility)
    if !try_status_update(&pool, &cycle_id, EvolutionCycleStatus::Promoting, None) {
        tracing::error!(cycle_id = %cycle_id, "Failed to set promoting status even after retry");
        return;
    }

    // Promotion-as-proposal: a winner that beats the measured incumbent by the
    // policy threshold FILES a review proposal. NOTHING is applied here — the
    // human decides via `evolution_resolve_promotion_proposal`.
    let threshold = policy.improvement_threshold;
    let best_variant_score = best_measured.as_ref().map(|m| m.overall);
    let mut proposal_id: Option<String> = None;

    if let (Some(idx), Some(ref winner_measured)) = (best_variant_idx, best_measured.as_ref()) {
        // LIKE-for-LIKE: both sides are measured by the same scorer on the
        // same replay set (assertion pass-rate + cost + latency).
        let improvement = winner_measured.overall - incumbent_measured.overall;
        if improvement >= threshold {
            let winner = &variants[idx];
            let new_prompt = winner.reassemble_prompt();

            let evidence = serde_json::json!({
                "incumbent": incumbent_measured,
                "winner": winner_measured,
                "perVariantOverall": per_variant_overall,
                "replayScenarios": replay_set.iter().map(|s| s.name.clone()).collect::<Vec<_>>(),
                "workloadReplays": workload_count,
                "syntheticReplays": (replay_set.len() as i32) - workload_count,
                "variantsBred": variants.len(),
                "budget": crate::engine::run_budget::ledger().state(&cycle_id),
            });

            let input = crate::db::models::CreateEvolutionProposalInput {
                cycle_id: cycle_id.clone(),
                persona_id: persona_id.clone(),
                winner_genome_json: serde_json::to_string(winner).unwrap_or_default(),
                new_prompt,
                incumbent_score: incumbent_measured.overall,
                winner_score: winner_measured.overall,
                improvement,
                threshold,
                evidence_json: serde_json::to_string(&evidence).ok(),
                base_updated_at: base_updated_at.clone(),
            };
            match crate::db::repos::lab::evolution_proposals::create(&pool, &input) {
                Ok(p) => {
                    tracing::info!(
                        persona_id = %persona_id,
                        cycle_id = %cycle_id,
                        proposal_id = %p.id,
                        improvement = improvement,
                        "Evolution: challenger beat incumbent by {:.1}% — promotion proposal filed for review",
                        improvement * 100.0,
                    );
                    proposal_id = Some(p.id);
                }
                Err(e) => {
                    tracing::warn!(
                        cycle_id = %cycle_id,
                        error = %e,
                        "Evolution: failed to file promotion proposal"
                    );
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
        }
    }

    // Finalize cycle. `promoted` is ALWAYS false here — it flips only when a
    // human approves the filed proposal (see mark_cycle_promoted).
    let promoted = false;
    let summary = EvolutionCycleSummary {
        cycle_id: cycle_id.clone(),
        persona_id: persona_id.clone(),
        generation: policy.total_cycles + 1,
        variants_tested: variants.len() as i32,
        winner_fitness: best_variant_score,
        incumbent_fitness: Some(incumbent_measured.overall),
        promoted,
        promoted_persona_id: None,
        proposal_id: proposal_id.clone(),
        fitness_source: Some("measured".to_string()),
        workload_replays: workload_count,
        status_reliable,
        warnings: objective_warnings,
        raw_fitness_objective: Some(policy.fitness_objective.clone()),
        budget: crate::engine::run_budget::ledger().state(&cycle_id),
    };
    // Historical (knowledge-derived) fitness is retained for logs only — the
    // decision above never mixes it with measured numbers.
    tracing::debug!(
        cycle_id = %cycle_id,
        historical_incumbent = incumbent_fitness.overall,
        measured_incumbent = incumbent_measured.overall,
        "Evolution: incumbent historical vs measured fitness",
    );

    let summary_json = serde_json::to_string(&summary).unwrap_or_default();
    // complete_cycle is critical — retry once on failure. It stamps
    // `last_cycle_at` AND bumps `total_cycles` (success-only). On success we mark
    // the clock guard finalized so it does not double-stamp; if BOTH attempts
    // fail the guard stays armed and advances `last_cycle_at` on its own (the
    // clock still moves, just without the `total_cycles` bump), preventing a
    // retry storm even when the completion write itself is failing.
    let completed = match evolution_repo::complete_cycle(
        &pool,
        &cycle_id,
        promoted,
        best_variant_score,
        incumbent_measured.overall,
        &summary_json,
    ) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(cycle_id = %cycle_id, error = %e, "complete_cycle failed, retrying");
            match evolution_repo::complete_cycle(
                &pool,
                &cycle_id,
                promoted,
                best_variant_score,
                incumbent_measured.overall,
                &summary_json,
            ) {
                Ok(()) => true,
                Err(retry_err) => {
                    tracing::error!(
                        cycle_id = %cycle_id,
                        error = %retry_err,
                        "complete_cycle retry also failed — cycle will appear stuck in DB",
                    );
                    false
                }
            }
        }
    };
    if completed {
        clock_guard.finalized = true;
    }

    // P2: finalize + persist the cycle's budget (retained 30m in-memory; the row
    // survives restarts for cost-trend dashboards).
    if let Some(budget) = crate::engine::run_budget::ledger().finish(&cycle_id) {
        if let Err(e) = crate::db::repos::run_budget::persist(&pool, &budget) {
            tracing::warn!(cycle_id = %cycle_id, "run-budget persist failed: {e}");
        }
    }
}

// =============================================================================
// Promotion (approval-time apply — the ONLY path that touches the persona)
// =============================================================================

/// Apply an APPROVED proposal's winning genome onto the incumbent persona.
///
/// Called exclusively from the human-review approval command
/// (`evolution_resolve_promotion_proposal`) — the evolution cycle itself never
/// calls this. Runs as one transaction: a compare-and-swap UPDATE on
/// `updated_at` (the token captured when the cycle started — if the persona
/// changed since, the proposal is stale and we fail closed instead of
/// clobbering newer state) plus field-level `persona_change_log` rows
/// (source `"evolution"`) so the promotion is attributable and revertible.
pub(crate) fn apply_promotion(
    pool: &DbPool,
    persona_id: &str,
    winner: &PersonaGenome,
    new_prompt: &str,
    expected_updated_at: &str,
) -> Result<(), crate::error::AppError> {
    // Load the incumbent OUTSIDE the write txn to diff for the change log.
    let existing = persona_repo::get_by_id(pool, persona_id)?;

    let mut conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let rows = tx.execute(
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
            now,
            persona_id,
            expected_updated_at,
        ],
    )?;
    if rows == 0 {
        return Err(crate::error::AppError::Validation(
            "Persona changed after this proposal was filed — promotion abandoned to avoid overwriting the newer state. Reject the proposal and run a fresh cycle.".into(),
        ));
    }

    // Provenance: field-level change-log rows commit atomically with the
    // UPDATE. Secret-bearing fields are redacted by write_diff.
    let diff_input = UpdatePersonaInput {
        system_prompt: Some(new_prompt.to_string()),
        structured_prompt: Some(winner.structured_prompt.clone()),
        timeout_ms: Some(winner.model.timeout_ms),
        max_concurrent: Some(winner.config.max_concurrent),
        model_profile: Some(winner.model.model_profile.clone()),
        max_budget_usd: Some(winner.model.max_budget_usd),
        max_turns: Some(winner.model.max_turns),
        ..Default::default()
    };
    if let Err(e) = crate::db::repos::resources::persona_change_log::write_diff(
        &tx,
        persona_id,
        &existing,
        &diff_input,
        Some("evolution"),
        &now,
    ) {
        // Never fail the approved promotion over audit rows — log loudly.
        tracing::warn!(
            persona_id = %persona_id,
            error = %e,
            "Promotion applied but change-log write failed",
        );
    }

    tx.commit()?;
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
