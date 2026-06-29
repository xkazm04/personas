use std::collections::{HashMap, HashSet};
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
/// Breeds offspring from 2-5 parent personas across one or more generations.
/// Parent fitness is *measured* from execution knowledge and used to seed the
/// first generation (fittest first) and to direct multi-generation selection.
/// Each offspring is assigned an *inherited* (mid-parent) fitness prediction —
/// a cheap directed-search prior, NOT a measured evaluation of the offspring
/// itself. Measuring offspring fitness directly (which requires running each
/// offspring) is a deferred follow-up. Results are persisted with this
/// predicted fitness so they can be ranked.
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

    let objective_json = serde_json::to_string(&fitness_objective)
        .map_err(|e| AppError::Internal(format!("Failed to serialize fitness objective: {e}")))?;

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
        run_breeding_pipeline(
            pool,
            run_id,
            parent_ids,
            fitness_objective,
            mutation_rate,
            generations,
        )
        .await;
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

    // Compute parent fitness from real execution knowledge. These are the ONLY
    // *measured* fitness signals in the pipeline: offspring have no execution
    // history of their own, so their fitness (below) is a *predicted* inherited
    // estimate, not a measurement.
    let mut scored_parents: Vec<(PersonaGenome, FitnessScore)> = parent_genomes
        .into_iter()
        .enumerate()
        .map(|(i, g)| {
            let score = genome::compute_fitness(&pool, &parent_ids[i], &objective);
            (g, score)
        })
        .collect();
    // Seed generation 1 from the FITTEST parents first (NaN sinks to the bottom),
    // so the measured parent fitness actually drives breeding order + the
    // multi-generation selection below — instead of being computed then discarded.
    scored_parents.sort_by(|a, b| cmp_fitness_desc(a.1.overall, b.1.overall));

    // Each entry pairs a genome with its fitness (measured for gen-1 parents,
    // predicted for the parents of later generations).
    let mut current: Vec<(PersonaGenome, FitnessScore)> = scored_parents;
    let mut offspring_count: i32 = 0;

    for gen in 1..=max_generations {
        let gen_parents: Vec<PersonaGenome> = current.iter().map(|(g, _)| g.clone()).collect();
        // Map each parent's source id -> fitness so every offspring can inherit a
        // mid-parent fitness prediction from the two parents that produced it.
        let parent_scores: HashMap<String, FitnessScore> = current
            .iter()
            .map(|(g, f)| (g.source_persona_id.clone(), f.clone()))
            .collect();

        let generation_offspring = genome::breed_generation(&gen_parents, mutation_rate, gen);

        // Assign each offspring a PREDICTED (inherited, mid-parent) fitness. This
        // is a cheap directed-search prior, NOT a measured evaluation of the
        // offspring — running each offspring to measure real fitness is a deferred
        // follow-up (see genome_start_breeding).
        let mut scored_offspring: Vec<(BreedingOffspring, FitnessScore)> = generation_offspring
            .into_iter()
            .map(|mut o| {
                let predicted = predict_offspring_fitness(&parent_scores, &o.parent_ids);
                o.fitness = Some(predicted.clone());
                (o, predicted)
            })
            .collect();

        // Persist every offspring with its predicted fitness so results can be
        // ranked (get_results_by_run sorts by fitness_overall).
        for (offspring, score) in &scored_offspring {
            let genome_json = serde_json::to_string(&offspring.genome).unwrap_or_default();
            let parent_json = serde_json::to_string(&offspring.parent_ids).unwrap_or_default();
            let fitness_json = serde_json::to_string(score).ok();

            let input = CreateBreedingResultInput {
                run_id: run_id.clone(),
                genome_json,
                parent_ids: parent_json,
                generation: offspring.generation,
                fitness_json,
                fitness_overall: Some(score.overall),
            };

            if let Err(e) = genome_repo::create_result(&pool, &input) {
                tracing::warn!(error = %e, "Failed to persist breeding offspring");
            }
            offspring_count += 1;
        }

        // Seed the next generation from THIS generation's fittest offspring (by
        // predicted fitness), not by emission/index order.
        if gen < max_generations && scored_offspring.len() >= 2 {
            scored_offspring.sort_by(|a, b| cmp_fitness_desc(a.1.overall, b.1.overall));
            current = scored_offspring
                .into_iter()
                .take(4)
                .map(|(o, score)| (o.genome, score))
                .collect();
        }
    }

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

/// Compare two fitness `overall` values descending, treating NaN as the WORST
/// (it sinks to the bottom). A plain `partial_cmp(...).unwrap_or(Equal)` would
/// make a NaN score compare equal to everything, letting an uncomputable genome
/// displace the real best.
fn cmp_fitness_desc(a: f64, b: f64) -> std::cmp::Ordering {
    match (a.is_nan(), b.is_nan()) {
        (true, true) => std::cmp::Ordering::Equal,
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        (false, false) => b.partial_cmp(&a).unwrap_or(std::cmp::Ordering::Equal),
    }
}

/// Predict an offspring's fitness by inheritance: the mid-parent average of its
/// parents' fitness scores. This is a cheap, directed-search prior — it is NOT a
/// measured evaluation of the offspring (measuring that requires running the
/// offspring, a deferred follow-up). It is used to rank offspring for the next
/// generation's parent set and to populate `fitness_overall` so results sort.
/// Falls back to a zero score if no parent fitness is available (e.g. a lookup
/// miss), so an unrankable offspring sinks rather than crashes the run.
fn predict_offspring_fitness(
    parent_scores: &HashMap<String, FitnessScore>,
    parent_ids: &[String],
) -> FitnessScore {
    let parents: Vec<&FitnessScore> = parent_ids
        .iter()
        .filter_map(|id| parent_scores.get(id))
        .collect();

    if parents.is_empty() {
        return FitnessScore {
            overall: 0.0,
            speed: 0.0,
            quality: 0.0,
            cost: 0.0,
        };
    }

    let n = parents.len() as f64;
    let (mut overall, mut speed, mut quality, mut cost) = (0.0, 0.0, 0.0, 0.0);
    for p in &parents {
        overall += p.overall;
        speed += p.speed;
        quality += p.quality;
        cost += p.cost;
    }

    FitnessScore {
        overall: overall / n,
        speed: speed / n,
        quality: quality / n,
        cost: cost / n,
    }
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
///
/// All three operations (persona creation, tool assignment, adoption marker)
/// run inside a single SQLite transaction so a partial failure cannot leave
/// orphan persona records or unmarked adoption results.
#[tauri::command]
pub fn genome_adopt_offspring(
    state: State<'_, Arc<AppState>>,
    result_id: String,
    name: Option<String>,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;

    let mut conn = state.db.get()?;
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

    // Fail closed on a blank prompt. Mutation/crossover (or a source persona
    // with no prompt) can leave a genome whose segments all reassemble to
    // nothing; adopting it would mint a persona with an empty system prompt —
    // a silently broken agent. Reject it instead of promoting the blank.
    let system_prompt = genome.reassemble_prompt();
    if system_prompt.trim().is_empty() {
        return Err(AppError::Validation(
            "Cannot adopt this genome: its prompt segments reassemble to an empty system prompt"
                .into(),
        ));
    }

    // Determine project_id from first parent
    let first_parent_id = genome
        .source_persona_id
        .split('+')
        .next()
        .unwrap_or("default");
    let project_id = persona_repo::get_by_id(&state.db, first_parent_id)
        .map(|p| p.project_id)
        .unwrap_or_else(|_| "default".into());

    let persona_name = name.unwrap_or_else(|| format!("Offspring: {}", genome.source_persona_name));

    // Encrypt model_profile if it contains an auth_token
    let encrypted_profile = encrypt_profile_for_adoption(&genome.model.model_profile)?;

    let persona_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Wrap all three operations in a single transaction to prevent orphan records
    let tx = conn.transaction().map_err(AppError::Database)?;

    // 1. Create persona
    tx.execute(
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, structured_prompt,
          icon, color, enabled, sensitive, max_concurrent, timeout_ms,
          model_profile, max_budget_usd, max_turns, design_context,
          notification_channels, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
        rusqlite::params![
            persona_id,
            project_id,
            persona_name,
            genome.description,
            system_prompt,
            genome.structured_prompt,
            Option::<String>::None, // icon
            Option::<String>::None, // color
            1i32,                   // enabled
            0i32,                   // sensitive
            genome.config.max_concurrent,
            genome.model.timeout_ms,
            encrypted_profile,
            genome.model.max_budget_usd,
            genome.model.max_turns,
            Option::<String>::None, // design_context
            Option::<String>::None, // notification_channels
            now,
        ],
    )?;

    // 2. Assign tools from genome (deduplicate to handle crossover artifacts)
    let mut seen_tools = HashSet::new();
    for tool_id in &genome.tools.tool_ids {
        if !seen_tools.insert(tool_id.as_str()) {
            continue;
        }
        let tool_assign_id = uuid::Uuid::new_v4().to_string();
        let tool_now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
             VALUES (?1, ?2, ?3, NULL, ?4)",
            rusqlite::params![tool_assign_id, persona_id, tool_id, tool_now],
        )
        .map_err(|e| {
            AppError::Internal(format!("Failed to assign tool {tool_id} to offspring: {e}"))
        })?;
    }

    // 3. Mark as adopted
    tx.execute(
        "UPDATE genome_breeding_results SET adopted = 1, adopted_persona_id = ?1 WHERE id = ?2",
        rusqlite::params![persona_id, result_id],
    )?;

    tx.commit().map_err(AppError::Database)?;

    // Return the fully materialized persona (with decrypted fields)
    persona_repo::get_by_id(&state.db, &persona_id)
}

/// Encrypt model_profile for adoption if it contains an auth_token.
fn encrypt_profile_for_adoption(profile: &Option<String>) -> Result<Option<String>, AppError> {
    let json = match profile {
        Some(ref j) if !j.trim().is_empty() => j,
        _ => return Ok(profile.clone()),
    };

    let mut val: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| AppError::Validation(format!("Invalid model_profile JSON: {e}")))?;

    let obj = match val.as_object_mut() {
        Some(o) => o,
        None => return Ok(Some(json.to_string())),
    };

    let token = obj
        .get("auth_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if token.is_empty() {
        return Ok(Some(json.to_string()));
    }

    let (ciphertext, nonce) = crate::engine::crypto::encrypt_for_db(&token)?;
    obj.remove("auth_token");
    obj.insert(
        "auth_token_enc".into(),
        serde_json::Value::String(ciphertext),
    );
    obj.insert("auth_token_iv".into(), serde_json::Value::String(nonce));

    serde_json::to_string(&val)
        .map(Some)
        .map_err(|e| AppError::Internal(format!("Failed to serialize model_profile: {e}")))
}
