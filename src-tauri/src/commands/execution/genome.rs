use std::sync::Arc;

use tauri::State;

use crate::db::models::*;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::lab::genome as genome_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::engine::genome::{
    self, BreedingOffspring, FitnessObjective, FitnessScore, PersonaGenome,
};
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

// ============================================================================
// Genome extraction
// ============================================================================

/// Extract a PersonaGenome from an existing persona.
#[tauri::command]
pub fn genome_extract(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<PersonaGenome, AppError> {
    require_auth_sync(&state)?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let tool_ids: Vec<String> = tools.iter().map(|t| t.id.clone()).collect();
    Ok(PersonaGenome::from_persona(&persona, tool_ids))
}

/// Compute fitness score for a persona from its execution knowledge.
#[tauri::command]
pub fn genome_fitness(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    objective: Option<FitnessObjective>,
) -> Result<FitnessScore, AppError> {
    require_auth_sync(&state)?;
    let obj = objective.unwrap_or_default();
    Ok(genome::compute_fitness(&state.db, &persona_id, &obj))
}

// ============================================================================
// Breeding runs
// ============================================================================

/// Start a new genome breeding run.
///
/// Selects 2-5 parent personas, breeds offspring across generations,
/// computes fitness, and persists results.
#[tauri::command]
pub async fn genome_start_breeding(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    parent_ids: Vec<String>,
    fitness_objective: FitnessObjective,
    mutation_rate: Option<f64>,
    generations: Option<i32>,
) -> Result<GenomeBreedingRun, AppError> {
    require_auth(&state).await?;

    if parent_ids.len() < 2 {
        return Err(AppError::Validation(
            "At least 2 parent personas are required for breeding".into(),
        ));
    }
    if parent_ids.len() > 5 {
        return Err(AppError::Validation(
            "At most 5 parent personas can be selected".into(),
        ));
    }

    let mutation_rate = mutation_rate.unwrap_or(0.15).clamp(0.0, 1.0);
    let generations = generations.unwrap_or(1).clamp(1, 5);

    // Validate all parents exist and get project_id from the first
    let first_persona = persona_repo::get_by_id(&state.db, &parent_ids[0])?;
    let project_id = first_persona.project_id.clone();

    for pid in &parent_ids[1..] {
        let p = persona_repo::get_by_id(&state.db, pid)?;
        if p.project_id != project_id {
            return Err(AppError::Validation(
                "All parent personas must belong to the same project".into(),
            ));
        }
    }

    let objective_json =
        serde_json::to_string(&fitness_objective).unwrap_or_else(|_| "{}".into());

    let input = CreateBreedingRunInput {
        project_id,
        parent_ids: parent_ids.clone(),
        fitness_objective: objective_json,
        mutation_rate,
        generations,
    };
    let run = genome_repo::create_run(&state.db, &input)?;
    let run_id = run.id.clone();

    let pool = state.db.clone();
    let _app = app; // Keep handle alive for event emission

    tokio::spawn(async move {
        run_breeding_pipeline(pool, run_id, parent_ids, fitness_objective, mutation_rate, generations).await;
    });

    Ok(run)
}

/// Background breeding pipeline.
async fn run_breeding_pipeline(
    pool: crate::db::DbPool,
    run_id: String,
    parent_ids: Vec<String>,
    objective: FitnessObjective,
    mutation_rate: f64,
    max_generations: i32,
) {
    // Transition to running
    if let Err(e) = genome_repo::update_run_status(
        &pool,
        &run_id,
        LabRunStatus::Running,
        None,
        None,
        None,
        None,
    ) {
        tracing::error!(run_id = %run_id, error = %e, "Failed to transition breeding run to running");
        return;
    }

    // Extract parent genomes
    let mut parent_genomes = Vec::new();
    for pid in &parent_ids {
        match persona_repo::get_by_id(&pool, pid) {
            Ok(persona) => {
                let tools = tool_repo::get_tools_for_persona(&pool, pid).unwrap_or_default();
                let tool_ids: Vec<String> = tools.iter().map(|t| t.id.clone()).collect();
                let g = PersonaGenome::from_persona(&persona, tool_ids);
                parent_genomes.push(g);
            }
            Err(e) => {
                let _ = genome_repo::update_run_status(
                    &pool,
                    &run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some(&format!("Failed to load parent {pid}: {e}")),
                    Some(&chrono::Utc::now().to_rfc3339()),
                );
                return;
            }
        }
    }

    // Compute parent fitness scores
    let mut parent_fitness: Vec<(usize, f64)> = parent_genomes
        .iter()
        .enumerate()
        .map(|(i, _)| {
            let score = genome::compute_fitness(&pool, &parent_ids[i], &objective);
            (i, score.overall)
        })
        .collect();
    parent_fitness.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut all_offspring: Vec<BreedingOffspring> = Vec::new();
    let mut current_genomes = parent_genomes;

    for gen in 1..=max_generations {
        let generation_offspring = genome::breed_generation(&current_genomes, mutation_rate, gen);

        for offspring in generation_offspring {
            // Persist each offspring
            let genome_json = serde_json::to_string(&offspring.genome).unwrap_or_default();
            let parent_json = serde_json::to_string(&offspring.parent_ids).unwrap_or_default();

            let input = CreateBreedingResultInput {
                run_id: run_id.clone(),
                genome_json,
                parent_ids: parent_json,
                generation: offspring.generation,
                fitness_json: None,
                fitness_overall: None,
            };

            if let Err(e) = genome_repo::create_result(&pool, &input) {
                tracing::warn!(error = %e, "Failed to persist breeding offspring");
            }

            all_offspring.push(offspring);
        }

        // For subsequent generations, use top offspring as new parents
        if gen < max_generations && !all_offspring.is_empty() {
            // Take top 3-5 offspring by prompt diversity (just use the latest generation)
            let gen_offspring: Vec<&BreedingOffspring> = all_offspring
                .iter()
                .filter(|o| o.generation == gen)
                .collect();
            if gen_offspring.len() >= 2 {
                current_genomes = gen_offspring
                    .iter()
                    .take(4)
                    .map(|o| o.genome.clone())
                    .collect();
            }
        }
    }

    let offspring_count = all_offspring.len() as i32;
    let summary = format!(
        "Bred {} offspring across {} generations from {} parents",
        offspring_count,
        max_generations,
        parent_ids.len()
    );

    let now = chrono::Utc::now().to_rfc3339();
    let _ = genome_repo::update_run_status(
        &pool,
        &run_id,
        LabRunStatus::Completed,
        Some(offspring_count),
        Some(&summary),
        None,
        Some(&now),
    );
}

// ============================================================================
// Run management
// ============================================================================

#[tauri::command]
pub fn genome_list_breeding_runs(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<GenomeBreedingRun>, AppError> {
    require_auth_sync(&state)?;
    let project_id = project_id.unwrap_or_else(|| "default".into());
    genome_repo::get_runs_by_project(&state.db, &project_id, limit)
}

#[tauri::command]
pub fn genome_get_breeding_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<GenomeBreedingResult>, AppError> {
    require_auth_sync(&state)?;
    genome_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub fn genome_delete_breeding_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    genome_repo::delete_run(&state.db, &id)
}

// ============================================================================
// Adopt offspring as a new persona
// ============================================================================

/// Adopt a breeding offspring as a new persona.
///
/// Creates a new persona with the offspring's genome configuration
/// and marks it as adopted in the breeding results.
#[tauri::command]
pub fn genome_adopt_offspring(
    state: State<'_, Arc<AppState>>,
    result_id: String,
    name: Option<String>,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;

    let conn = state.db.get()?;
    let genome_json: String = conn
        .query_row(
            "SELECT genome_json FROM genome_breeding_results WHERE id = ?1",
            rusqlite::params![result_id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Breeding result {result_id}"))
            }
            other => AppError::Database(other),
        })?;

    let genome: PersonaGenome = serde_json::from_str(&genome_json)
        .map_err(|e| AppError::Internal(format!("Failed to parse offspring genome: {e}")))?;

    // Determine project_id from first parent
    let first_parent_id = genome
        .source_persona_id
        .split('+')
        .next()
        .unwrap_or("default");
    let project_id = persona_repo::get_by_id(&state.db, first_parent_id)
        .map(|p| p.project_id)
        .unwrap_or_else(|_| "default".into());

    let persona_name = name.unwrap_or_else(|| {
        format!("Offspring: {}", genome.source_persona_name)
    });

    let input = CreatePersonaInput {
        name: persona_name,
        system_prompt: genome.reassemble_prompt(),
        project_id: Some(project_id),
        description: genome.description,
        structured_prompt: genome.structured_prompt,
        icon: None,
        color: None,
        enabled: Some(true),
        max_concurrent: Some(genome.config.max_concurrent),
        timeout_ms: Some(genome.model.timeout_ms),
        model_profile: genome.model.model_profile,
        max_budget_usd: genome.model.max_budget_usd,
        max_turns: genome.model.max_turns,
        design_context: None,
        group_id: None,
        notification_channels: None,
    };

    let persona = persona_repo::create(&state.db, input)?;

    // Assign tools from genome
    for tool_id in &genome.tools.tool_ids {
        let _ = tool_repo::assign_tool(&state.db, &persona.id, tool_id, None);
    }

    // Mark as adopted
    let _ = genome_repo::mark_adopted(&state.db, &result_id, &persona.id);

    Ok(persona)
}
