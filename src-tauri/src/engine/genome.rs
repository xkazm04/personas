//! Persona Genetic Programming — cross-breeding top-performing personas.
//!
//! Defines a `PersonaGenome` that decomposes a Persona into crossover-compatible
//! segments. Implements single-point crossover, point mutation, and a fitness
//! function derived from execution knowledge data.

use rand::Rng;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::Persona;
#[cfg(test)]
use crate::db::models::{PersonaTrustLevel, PersonaTrustOrigin};
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::DbPool;

// =============================================================================
// Genome segments
// =============================================================================

/// A segment of a persona's system prompt, split at paragraph boundaries.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PromptSegment {
    /// Index within the parent prompt (0-based).
    pub index: usize,
    /// The text content of this segment.
    pub text: String,
}

/// Tool selection gene: which tools are assigned and their ordering.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ToolGene {
    /// Tool definition IDs in execution order.
    pub tool_ids: Vec<String>,
}

/// Model preference gene: which provider/model to prefer and routing hints.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ModelGene {
    /// Model profile string (e.g. "balanced", "quality", "speed").
    pub model_profile: Option<String>,
    /// Max budget cap.
    pub max_budget_usd: Option<f64>,
    /// Max turns cap.
    pub max_turns: Option<i32>,
    /// Timeout in milliseconds.
    pub timeout_ms: i32,
}

/// Configuration gene: behavioral settings for the persona.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConfigGene {
    pub max_concurrent: i32,
    pub sensitive: bool,
    pub headless: bool,
}

/// The complete decomposed genome of a persona.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaGenome {
    /// Source persona ID this genome was extracted from.
    pub source_persona_id: String,
    /// Source persona name (for display).
    pub source_persona_name: String,
    /// System prompt decomposed into paragraph-level segments.
    pub prompt_segments: Vec<PromptSegment>,
    /// Structured prompt JSON (kept as opaque string for crossover).
    pub structured_prompt: Option<String>,
    /// Tool selection and ordering.
    pub tools: ToolGene,
    /// Model/provider preferences.
    pub model: ModelGene,
    /// Behavioral configuration.
    pub config: ConfigGene,
    /// Description text.
    pub description: Option<String>,
}

/// Fitness objective weights (must sum to 1.0 in the frontend, enforced here).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FitnessObjective {
    /// Weight for speed (lower duration = higher fitness).
    pub speed: f64,
    /// Weight for quality (higher success rate = higher fitness).
    pub quality: f64,
    /// Weight for cost (lower cost = higher fitness).
    pub cost: f64,
}

impl Default for FitnessObjective {
    fn default() -> Self {
        Self {
            speed: 0.33,
            quality: 0.34,
            cost: 0.33,
        }
    }
}

/// Fitness score computed from execution knowledge.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FitnessScore {
    /// Overall weighted fitness (0.0--1.0).
    pub overall: f64,
    /// Speed component (0.0--1.0, inverted duration).
    pub speed: f64,
    /// Quality component (0.0--1.0, success rate).
    pub quality: f64,
    /// Cost component (0.0--1.0, inverted cost).
    pub cost: f64,
}

// =============================================================================
// Genome extraction
// =============================================================================

impl PersonaGenome {
    /// Decompose a `Persona` + its tool IDs into a crossover-compatible genome.
    pub fn from_persona(persona: &Persona, tool_ids: Vec<String>) -> Self {
        let segments = split_prompt_segments(&persona.system_prompt);
        PersonaGenome {
            source_persona_id: persona.id.clone(),
            source_persona_name: persona.name.clone(),
            prompt_segments: segments,
            structured_prompt: persona.structured_prompt.clone(),
            tools: ToolGene { tool_ids },
            model: ModelGene {
                model_profile: persona.model_profile.clone(),
                max_budget_usd: persona.max_budget_usd,
                max_turns: persona.max_turns,
                timeout_ms: persona.timeout_ms,
            },
            config: ConfigGene {
                max_concurrent: persona.max_concurrent,
                sensitive: persona.sensitive,
                headless: persona.headless,
            },
            description: persona.description.clone(),
        }
    }

    /// Reassemble the genome's prompt segments back into a full system prompt.
    pub fn reassemble_prompt(&self) -> String {
        self.prompt_segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

// =============================================================================
// Crossover
// =============================================================================

/// Single-point crossover between two parent genomes.
///
/// Selects a random crossover point and swaps genome segments between the two
/// parents. Returns two offspring genomes.
pub fn crossover(parent_a: &PersonaGenome, parent_b: &PersonaGenome) -> (PersonaGenome, PersonaGenome) {
    let mut rng = rand::thread_rng();

    // For prompt segments, do single-point crossover at paragraph level
    let max_seg = parent_a.prompt_segments.len().max(parent_b.prompt_segments.len());
    let crossover_point = if max_seg > 1 { rng.gen_range(1..max_seg) } else { 1 };

    let (segs_a, segs_b) = crossover_segments(
        &parent_a.prompt_segments,
        &parent_b.prompt_segments,
        crossover_point,
    );

    // For tools, swap entire tool gene based on coin flip
    let (tools_a, tools_b) = if rng.gen_bool(0.5) {
        (parent_b.tools.clone(), parent_a.tools.clone())
    } else {
        (parent_a.tools.clone(), parent_b.tools.clone())
    };

    // For model gene, swap fields independently
    let (model_a, model_b) = crossover_model(&parent_a.model, &parent_b.model, &mut rng);

    // For config, take from one parent or the other
    let (config_a, config_b) = if rng.gen_bool(0.5) {
        (parent_a.config.clone(), parent_b.config.clone())
    } else {
        (parent_b.config.clone(), parent_a.config.clone())
    };

    // Structured prompt: one child gets A's, the other gets B's
    let (struct_a, struct_b) = if rng.gen_bool(0.5) {
        (parent_a.structured_prompt.clone(), parent_b.structured_prompt.clone())
    } else {
        (parent_b.structured_prompt.clone(), parent_a.structured_prompt.clone())
    };

    let offspring_a = PersonaGenome {
        source_persona_id: format!("{}+{}", parent_a.source_persona_id, parent_b.source_persona_id),
        source_persona_name: format!("{} × {}", parent_a.source_persona_name, parent_b.source_persona_name),
        prompt_segments: segs_a,
        structured_prompt: struct_a,
        tools: tools_a,
        model: model_a,
        config: config_a,
        description: parent_a.description.clone(),
    };

    let offspring_b = PersonaGenome {
        source_persona_id: format!("{}+{}", parent_b.source_persona_id, parent_a.source_persona_id),
        source_persona_name: format!("{} × {}", parent_b.source_persona_name, parent_a.source_persona_name),
        prompt_segments: segs_b,
        structured_prompt: struct_b,
        tools: tools_b,
        model: model_b,
        config: config_b,
        description: parent_b.description.clone(),
    };

    (offspring_a, offspring_b)
}

/// Swap prompt segments at the given crossover point.
fn crossover_segments(
    a: &[PromptSegment],
    b: &[PromptSegment],
    point: usize,
) -> (Vec<PromptSegment>, Vec<PromptSegment>) {
    let mut child_a = Vec::new();
    let mut child_b = Vec::new();

    // Before crossover point: keep original parent
    for i in 0..point {
        if let Some(seg) = a.get(i) {
            child_a.push(seg.clone());
        }
        if let Some(seg) = b.get(i) {
            child_b.push(seg.clone());
        }
    }

    // After crossover point: swap parents
    let max_len = a.len().max(b.len());
    for i in point..max_len {
        if let Some(seg) = b.get(i) {
            child_a.push(PromptSegment {
                index: child_a.len(),
                text: seg.text.clone(),
            });
        }
        if let Some(seg) = a.get(i) {
            child_b.push(PromptSegment {
                index: child_b.len(),
                text: seg.text.clone(),
            });
        }
    }

    // Re-index
    for (i, seg) in child_a.iter_mut().enumerate() {
        seg.index = i;
    }
    for (i, seg) in child_b.iter_mut().enumerate() {
        seg.index = i;
    }

    (child_a, child_b)
}

/// Crossover model genes by independently swapping each field.
fn crossover_model(a: &ModelGene, b: &ModelGene, rng: &mut impl Rng) -> (ModelGene, ModelGene) {
    let (profile_a, profile_b) = if rng.gen_bool(0.5) {
        (a.model_profile.clone(), b.model_profile.clone())
    } else {
        (b.model_profile.clone(), a.model_profile.clone())
    };

    let (budget_a, budget_b) = if rng.gen_bool(0.5) {
        (a.max_budget_usd, b.max_budget_usd)
    } else {
        (b.max_budget_usd, a.max_budget_usd)
    };

    let (turns_a, turns_b) = if rng.gen_bool(0.5) {
        (a.max_turns, b.max_turns)
    } else {
        (b.max_turns, a.max_turns)
    };

    let (timeout_a, timeout_b) = if rng.gen_bool(0.5) {
        (a.timeout_ms, b.timeout_ms)
    } else {
        (b.timeout_ms, a.timeout_ms)
    };

    (
        ModelGene {
            model_profile: profile_a,
            max_budget_usd: budget_a,
            max_turns: turns_a,
            timeout_ms: timeout_a,
        },
        ModelGene {
            model_profile: profile_b,
            max_budget_usd: budget_b,
            max_turns: turns_b,
            timeout_ms: timeout_b,
        },
    )
}

// =============================================================================
// Mutation
// =============================================================================

/// Point mutation: randomly modify one genome segment.
///
/// `mutation_rate` is probability (0.0--1.0) that each gene is mutated.
pub fn mutate(genome: &mut PersonaGenome, mutation_rate: f64) {
    let mut rng = rand::thread_rng();

    // Mutate prompt segments: shuffle order or drop one
    if rng.gen_bool(mutation_rate.min(1.0)) && genome.prompt_segments.len() > 1 {
        let action: u8 = rng.gen_range(0..3);
        match action {
            0 => {
                // Swap two random segments
                let i = rng.gen_range(0..genome.prompt_segments.len());
                let j = rng.gen_range(0..genome.prompt_segments.len());
                genome.prompt_segments.swap(i, j);
                // Re-index
                for (idx, seg) in genome.prompt_segments.iter_mut().enumerate() {
                    seg.index = idx;
                }
            }
            1 => {
                // Drop a random segment (keep at least 1)
                if genome.prompt_segments.len() > 1 {
                    let idx = rng.gen_range(0..genome.prompt_segments.len());
                    genome.prompt_segments.remove(idx);
                    for (i, seg) in genome.prompt_segments.iter_mut().enumerate() {
                        seg.index = i;
                    }
                }
            }
            _ => {
                // Duplicate a random segment
                let idx = rng.gen_range(0..genome.prompt_segments.len());
                let dup = genome.prompt_segments[idx].clone();
                genome.prompt_segments.push(dup);
                for (i, seg) in genome.prompt_segments.iter_mut().enumerate() {
                    seg.index = i;
                }
            }
        }
    }

    // Mutate tool ordering
    if rng.gen_bool(mutation_rate.min(1.0)) && genome.tools.tool_ids.len() > 1 {
        let i = rng.gen_range(0..genome.tools.tool_ids.len());
        let j = rng.gen_range(0..genome.tools.tool_ids.len());
        genome.tools.tool_ids.swap(i, j);
    }

    // Mutate model preferences
    if rng.gen_bool(mutation_rate.min(1.0)) {
        // Adjust timeout by ±20%
        let factor = rng.gen_range(0.8..1.2);
        genome.model.timeout_ms = ((genome.model.timeout_ms as f64) * factor) as i32;
        genome.model.timeout_ms = genome.model.timeout_ms.clamp(5_000, super::ENGINE_MAX_EXECUTION_MS); // floor 5s, ceiling engine max
    }

    // Mutate max_concurrent
    if rng.gen_bool(mutation_rate.min(1.0)) {
        genome.config.max_concurrent = rng.gen_range(1..=5);
    }
}

// =============================================================================
// Fitness evaluation
// =============================================================================

/// Compute a fitness score for a persona from its execution knowledge.
///
/// Uses `cost_quality` knowledge entries to derive success rate, avg cost,
/// and avg duration, then combines them using the objective weights.
pub fn compute_fitness(
    pool: &DbPool,
    persona_id: &str,
    objective: &FitnessObjective,
) -> FitnessScore {
    // Load cost_quality knowledge for this persona
    let entries = knowledge_repo::list_for_persona(pool, persona_id, Some("cost_quality"), Some(50))
        .unwrap_or_default();

    if entries.is_empty() {
        return FitnessScore {
            overall: 0.0,
            speed: 0.0,
            quality: 0.0,
            cost: 0.0,
        };
    }

    // Aggregate across all knowledge entries
    let mut total_success: i64 = 0;
    let mut total_failure: i64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut total_duration: f64 = 0.0;
    let mut count: i64 = 0;

    for entry in &entries {
        total_success += entry.success_count;
        total_failure += entry.failure_count;
        total_cost += entry.avg_cost_usd;
        total_duration += entry.avg_duration_ms;
        count += 1;
    }

    let total_runs = total_success + total_failure;
    let quality = if total_runs > 0 {
        total_success as f64 / total_runs as f64
    } else {
        0.0
    };

    let avg_cost = if count > 0 { total_cost / count as f64 } else { 0.0 };
    let avg_duration = if count > 0 { total_duration / count as f64 } else { 0.0 };

    // Normalize: speed = 1.0 - (duration / 60_000ms), clamped to [0, 1]
    let speed = (1.0 - (avg_duration / 60_000.0)).clamp(0.0, 1.0);
    // Normalize: cost = 1.0 - (cost / $1.00), clamped to [0, 1]
    let cost = (1.0 - (avg_cost / 1.0)).clamp(0.0, 1.0);

    let overall = (objective.speed * speed + objective.quality * quality + objective.cost * cost)
        .clamp(0.0, 1.0);

    FitnessScore {
        overall,
        speed,
        quality,
        cost,
    }
}

// =============================================================================
// Breeding pipeline
// =============================================================================

/// Result of a single breeding generation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BreedingOffspring {
    /// Unique ID for this offspring.
    pub id: String,
    /// The offspring genome.
    pub genome: PersonaGenome,
    /// Parent persona IDs that contributed to this offspring.
    pub parent_ids: Vec<String>,
    /// Generation number (0 = parent, 1+ = bred).
    #[ts(type = "number")]
    pub generation: i32,
    /// Fitness score (populated after evaluation).
    pub fitness: Option<FitnessScore>,
}

/// Breed a generation of offspring from a set of parent genomes.
///
/// - Performs pairwise crossover among all parents
/// - Applies point mutations to offspring
/// - Returns the offspring (unevaluated)
pub fn breed_generation(
    parents: &[PersonaGenome],
    mutation_rate: f64,
    generation: i32,
) -> Vec<BreedingOffspring> {
    let mut offspring = Vec::new();

    // Pairwise crossover: for N parents, produce N*(N-1)/2 pairs of offspring
    for i in 0..parents.len() {
        for j in (i + 1)..parents.len() {
            let (mut child_a, mut child_b) = crossover(&parents[i], &parents[j]);

            mutate(&mut child_a, mutation_rate);
            mutate(&mut child_b, mutation_rate);

            offspring.push(BreedingOffspring {
                id: uuid::Uuid::new_v4().to_string(),
                genome: child_a,
                parent_ids: vec![
                    parents[i].source_persona_id.clone(),
                    parents[j].source_persona_id.clone(),
                ],
                generation,
                fitness: None,
            });

            offspring.push(BreedingOffspring {
                id: uuid::Uuid::new_v4().to_string(),
                genome: child_b,
                parent_ids: vec![
                    parents[j].source_persona_id.clone(),
                    parents[i].source_persona_id.clone(),
                ],
                generation,
                fitness: None,
            });
        }
    }

    offspring
}

// =============================================================================
// Helpers
// =============================================================================

/// Split a system prompt into paragraph-level segments.
fn split_prompt_segments(prompt: &str) -> Vec<PromptSegment> {
    prompt
        .split("\n\n")
        .filter(|s| !s.trim().is_empty())
        .enumerate()
        .map(|(i, text)| PromptSegment {
            index: i,
            text: text.to_string(),
        })
        .collect()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_persona(name: &str, prompt: &str) -> Persona {
        Persona {
            id: format!("test-{name}"),
            project_id: "default".into(),
            name: name.into(),
            description: Some(format!("{name} test persona")),
            system_prompt: prompt.into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            max_concurrent: 3,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            model_profile: Some("balanced".into()),
            max_budget_usd: Some(0.50),
            max_turns: Some(10),
            design_context: None,
            group_id: None,
            source_review_id: None,
            trust_level: PersonaTrustLevel::Verified,
            trust_origin: PersonaTrustOrigin::System,
            trust_verified_at: None,
            trust_score: 0.0,
            parameters: None,
            gateway_exposure: crate::db::models::PersonaGatewayExposure::LocalOnly,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn test_genome_extraction() {
        let persona = make_test_persona("Alpha", "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
        let genome = PersonaGenome::from_persona(&persona, vec!["tool-1".into(), "tool-2".into()]);

        assert_eq!(genome.prompt_segments.len(), 3);
        assert_eq!(genome.prompt_segments[0].text, "First paragraph.");
        assert_eq!(genome.tools.tool_ids.len(), 2);
        assert_eq!(genome.model.model_profile.as_deref(), Some("balanced"));
    }

    #[test]
    fn test_prompt_reassembly() {
        let persona = make_test_persona("Beta", "Hello world.\n\nGoodbye world.");
        let genome = PersonaGenome::from_persona(&persona, vec![]);

        assert_eq!(genome.reassemble_prompt(), "Hello world.\n\nGoodbye world.");
    }

    #[test]
    fn test_crossover_produces_two_offspring() {
        let a = make_test_persona("A", "Seg A1.\n\nSeg A2.\n\nSeg A3.");
        let b = make_test_persona("B", "Seg B1.\n\nSeg B2.\n\nSeg B3.");

        let ga = PersonaGenome::from_persona(&a, vec!["t1".into()]);
        let gb = PersonaGenome::from_persona(&b, vec!["t2".into()]);

        let (child_a, child_b) = crossover(&ga, &gb);

        // Both children should have some segments
        assert!(!child_a.prompt_segments.is_empty());
        assert!(!child_b.prompt_segments.is_empty());
    }

    #[test]
    fn test_mutation_preserves_at_least_one_segment() {
        let persona = make_test_persona("M", "Only one segment.");
        let mut genome = PersonaGenome::from_persona(&persona, vec!["t1".into()]);

        // Even with 100% mutation rate, should keep at least 1 segment
        for _ in 0..100 {
            mutate(&mut genome, 1.0);
        }
        assert!(!genome.prompt_segments.is_empty());
    }

    #[test]
    fn test_breed_generation_count() {
        let a = make_test_persona("A", "Prompt A.");
        let b = make_test_persona("B", "Prompt B.");
        let c = make_test_persona("C", "Prompt C.");

        let genomes = vec![
            PersonaGenome::from_persona(&a, vec![]),
            PersonaGenome::from_persona(&b, vec![]),
            PersonaGenome::from_persona(&c, vec![]),
        ];

        let offspring = breed_generation(&genomes, 0.1, 1);
        // 3 parents => 3 pairs => 6 offspring
        assert_eq!(offspring.len(), 6);
        assert!(offspring.iter().all(|o| o.generation == 1));
    }

    #[test]
    fn test_fitness_score_defaults_for_no_data() {
        let score = FitnessScore {
            overall: 0.0,
            speed: 0.0,
            quality: 0.0,
            cost: 0.0,
        };
        assert_eq!(score.overall, 0.0);
    }
}
