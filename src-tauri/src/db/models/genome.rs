use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::LabRunStatus;

// =============================================================================
// Genome Breeding Run
// =============================================================================

/// A genome breeding run that cross-breeds parent personas to produce offspring.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GenomeBreedingRun {
    pub id: String,
    /// Project scope (all parents must share this project).
    pub project_id: String,
    pub status: LabRunStatus,
    /// JSON array of parent persona IDs.
    pub parent_ids: String,
    /// JSON-serialized FitnessObjective.
    pub fitness_objective: String,
    /// Mutation rate (0.0--1.0).
    pub mutation_rate: f64,
    /// Number of generations to breed.
    #[ts(type = "number")]
    pub generations: i32,
    /// Total offspring produced.
    #[ts(type = "number")]
    pub offspring_count: i32,
    /// JSON summary of top results.
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// Input for creating a new breeding run.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateBreedingRunInput {
    pub project_id: String,
    pub parent_ids: Vec<String>,
    pub fitness_objective: String,
    pub mutation_rate: f64,
    pub generations: i32,
}

// =============================================================================
// Genome Breeding Result (one per offspring)
// =============================================================================

/// A single offspring result from a breeding run.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GenomeBreedingResult {
    pub id: String,
    pub run_id: String,
    /// JSON-serialized PersonaGenome.
    pub genome_json: String,
    /// JSON array of parent IDs for this specific offspring.
    pub parent_ids: String,
    /// Which generation this offspring belongs to.
    #[ts(type = "number")]
    pub generation: i32,
    /// JSON-serialized FitnessScore (null until evaluated).
    pub fitness_json: Option<String>,
    /// Overall fitness score (for sorting/ranking).
    pub fitness_overall: Option<f64>,
    /// Whether user adopted this offspring as a new persona.
    pub adopted: bool,
    /// The persona ID if this offspring was adopted.
    pub adopted_persona_id: Option<String>,
    pub created_at: String,
}

/// Input for creating a breeding result.
#[derive(Debug, Clone)]
pub struct CreateBreedingResultInput {
    pub run_id: String,
    pub genome_json: String,
    pub parent_ids: String,
    pub generation: i32,
    pub fitness_json: Option<String>,
    pub fitness_overall: Option<f64>,
}
