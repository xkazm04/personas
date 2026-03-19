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
