use serde::{Deserialize, Serialize};
use ts_rs::TS;

// =============================================================================
// Evolution Policy — per-persona auto-evolution configuration
// =============================================================================

/// Configuration for automatic persona evolution via lab-driven optimization.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionPolicy {
    pub id: String,
    pub persona_id: String,
    /// Whether auto-evolution is enabled.
    pub enabled: bool,
    /// JSON-serialized FitnessObjective weights.
    pub fitness_objective: String,
    /// Mutation rate for variant generation (0.0--1.0).
    pub mutation_rate: f64,
    /// Number of variants to generate per cycle.
    #[ts(type = "number")]
    pub variants_per_cycle: i32,
    /// Minimum fitness improvement required to promote a variant (0.0--1.0).
    pub improvement_threshold: f64,
    /// Minimum completed executions between evolution cycles.
    #[ts(type = "number")]
    pub min_executions_between: i32,
    /// Mutation strategy: "mechanical" (shuffle/drop/duplicate prompt
    /// segments, permute tools, jiggle timeout) or "critique" (LLM reads
    /// recent low-fitness traces and rewrites prompt segments). NULL or
    /// missing falls back to "mechanical" so legacy rows behave unchanged.
    pub mutation_strategy: Option<String>,
    /// Timestamp of last completed evolution cycle.
    pub last_cycle_at: Option<String>,
    /// Total cycles completed.
    #[ts(type = "number")]
    pub total_cycles: i32,
    /// Total successful promotions.
    #[ts(type = "number")]
    pub total_promotions: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating or updating an evolution policy.
#[derive(Debug, Clone, Deserialize)]
pub struct UpsertEvolutionPolicyInput {
    pub persona_id: String,
    pub enabled: Option<bool>,
    pub fitness_objective: Option<String>,
    pub mutation_rate: Option<f64>,
    pub variants_per_cycle: Option<i32>,
    pub improvement_threshold: Option<f64>,
    pub min_executions_between: Option<i32>,
    pub mutation_strategy: Option<String>,
}

// =============================================================================
// Evolution Cycle — record of a single evolution attempt
// =============================================================================

/// Record of a single auto-evolution cycle.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionCycle {
    pub id: String,
    pub policy_id: String,
    pub persona_id: String,
    pub status: String,
    /// Number of variants tested.
    #[ts(type = "number")]
    pub variants_tested: i32,
    /// Fitness of the best variant.
    pub winner_fitness: Option<f64>,
    /// Fitness of the incumbent persona before this cycle.
    pub incumbent_fitness: Option<f64>,
    /// Whether a variant was promoted.
    pub promoted: bool,
    /// JSON summary of the cycle result.
    pub summary: Option<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

// =============================================================================
// Evolution Promotion Proposal — human-gated promotion (Darwin Mode v1)
// =============================================================================

/// A pending promotion produced by an evolution cycle whose challenger beat the
/// incumbent by the policy's `improvement_threshold`.
///
/// Mirrors the `memory_review_proposal` pattern: the cycle FILES a proposal and
/// stops — nothing is applied until a human approves it. On approval the winner
/// genome is written onto the incumbent persona (compare-and-swap on
/// `base_updated_at`) and the change is logged to `persona_change_log`; on
/// rejection only the decision is recorded. There is NO auto-promotion path.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EvolutionPromotionProposal {
    pub id: String,
    /// Evolution cycle that produced this proposal.
    pub cycle_id: String,
    pub persona_id: String,
    /// `pending` | `approved` | `rejected`.
    pub status: String,
    /// JSON-serialized `PersonaGenome` of the winning challenger.
    pub winner_genome_json: String,
    /// The winner's reassembled system prompt (what approval would install).
    pub new_prompt: String,
    /// Incumbent's measured score on the same replay set (0.0--1.0).
    pub incumbent_score: f64,
    /// Winner's measured score on the same replay set (0.0--1.0).
    pub winner_score: f64,
    /// `winner_score - incumbent_score` at filing time.
    pub improvement: f64,
    /// The policy's `improvement_threshold` the winner had to clear.
    pub threshold: f64,
    /// `measured` — score provenance marker (inherited-only cycles never file).
    pub fitness_source: String,
    /// Raw evidence JSON: replay counts, per-side measured fitness breakdowns,
    /// scenario names, and the cycle's budget state. Inspectable in the UI.
    pub evidence_json: Option<String>,
    /// Incumbent's `updated_at` captured when the cycle started — the
    /// optimistic-lock token approval must match (stale proposals fail closed).
    pub base_updated_at: String,
    /// Optional human note recorded at decision time.
    pub decision_note: Option<String>,
    pub created_at: String,
    pub decided_at: Option<String>,
}

/// Input for filing a promotion proposal (repo fills id/status/timestamps).
#[derive(Debug, Clone)]
pub struct CreateEvolutionProposalInput {
    pub cycle_id: String,
    pub persona_id: String,
    pub winner_genome_json: String,
    pub new_prompt: String,
    pub incumbent_score: f64,
    pub winner_score: f64,
    pub improvement: f64,
    pub threshold: f64,
    pub evidence_json: Option<String>,
    pub base_updated_at: String,
}
