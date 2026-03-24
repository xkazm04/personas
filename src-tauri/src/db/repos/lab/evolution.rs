use rusqlite::params;

use crate::db::models::{EvolutionCycle, EvolutionPolicy, UpsertEvolutionPolicyInput};
use crate::db::DbPool;
use crate::engine::evolution::EvolutionCycleStatus;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

row_mapper!(row_to_policy -> EvolutionPolicy {
    id, persona_id,
    enabled [bool],
    fitness_objective, mutation_rate, variants_per_cycle,
    improvement_threshold, min_executions_between,
    last_cycle_at, total_cycles, total_promotions,
    created_at, updated_at,
});

row_mapper!(row_to_cycle -> EvolutionCycle {
    id, policy_id, persona_id, status, variants_tested,
    winner_fitness, incumbent_fitness,
    promoted [bool],
    summary, error, started_at, completed_at,
});

// -- Evolution Policies ------------------------------------------

/// Get or create an evolution policy for a persona (upsert).
pub fn upsert_policy(
    pool: &DbPool,
    input: &UpsertEvolutionPolicyInput,
) -> Result<EvolutionPolicy, AppError> {
    let conn = pool.get()?;

    // Check if policy exists
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM evolution_policies WHERE persona_id = ?1",
            params![input.persona_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        // Update existing
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE evolution_policies SET
                enabled = COALESCE(?1, enabled),
                fitness_objective = COALESCE(?2, fitness_objective),
                mutation_rate = COALESCE(?3, mutation_rate),
                variants_per_cycle = COALESCE(?4, variants_per_cycle),
                improvement_threshold = COALESCE(?5, improvement_threshold),
                min_executions_between = COALESCE(?6, min_executions_between),
                updated_at = ?7
             WHERE id = ?8",
            params![
                input.enabled.map(|b| b as i32),
                input.fitness_objective,
                input.mutation_rate,
                input.variants_per_cycle,
                input.improvement_threshold,
                input.min_executions_between,
                now,
                id,
            ],
        )?;
        get_policy_by_id(pool, &id)
    } else {
        // Create new
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let enabled = input.enabled.unwrap_or(false);
        let fitness_obj = input
            .fitness_objective
            .clone()
            .unwrap_or_else(|| r#"{"speed":0.33,"quality":0.34,"cost":0.33}"#.into());
        let mutation_rate = input.mutation_rate.unwrap_or(0.15);
        let variants = input.variants_per_cycle.unwrap_or(4);
        let threshold = input.improvement_threshold.unwrap_or(0.05);
        let min_execs = input.min_executions_between.unwrap_or(10);

        conn.execute(
            "INSERT INTO evolution_policies
                (id, persona_id, enabled, fitness_objective, mutation_rate,
                 variants_per_cycle, improvement_threshold, min_executions_between,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                input.persona_id,
                enabled as i32,
                fitness_obj,
                mutation_rate,
                variants,
                threshold,
                min_execs,
                now,
                now,
            ],
        )?;
        get_policy_by_id(pool, &id)
    }
}

pub fn get_policy_by_id(pool: &DbPool, id: &str) -> Result<EvolutionPolicy, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM evolution_policies WHERE id = ?1",
        params![id],
        row_to_policy,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("EvolutionPolicy {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_policy_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<EvolutionPolicy>, AppError> {
    let conn = pool.get()?;
    match conn.query_row(
        "SELECT * FROM evolution_policies WHERE persona_id = ?1",
        params![persona_id],
        row_to_policy,
    ) {
        Ok(policy) => Ok(Some(policy)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

pub fn list_enabled_policies(pool: &DbPool) -> Result<Vec<EvolutionPolicy>, AppError> {
    let conn = pool.get()?;
    let mut stmt =
        conn.prepare("SELECT * FROM evolution_policies WHERE enabled = 1 ORDER BY updated_at")?;
    let rows = stmt.query_map([], row_to_policy)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn delete_policy(pool: &DbPool, persona_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM evolution_policies WHERE persona_id = ?1",
        params![persona_id],
    )?;
    Ok(rows > 0)
}

// -- Evolution Cycles ------------------------------------------

pub fn create_cycle(
    pool: &DbPool,
    policy_id: &str,
    persona_id: &str,
) -> Result<EvolutionCycle, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO evolution_cycles
            (id, policy_id, persona_id, status, started_at)
         VALUES (?1, ?2, ?3, 'breeding', ?4)",
        params![id, policy_id, persona_id, now],
    )?;
    get_cycle_by_id(pool, &id)
}

pub fn get_cycle_by_id(pool: &DbPool, id: &str) -> Result<EvolutionCycle, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM evolution_cycles WHERE id = ?1",
        params![id],
        row_to_cycle,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("EvolutionCycle {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn list_cycles_for_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<EvolutionCycle>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM evolution_cycles WHERE persona_id = ?1
         ORDER BY started_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_cycle)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn update_cycle_status(
    pool: &DbPool,
    id: &str,
    status: EvolutionCycleStatus,
    error: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE evolution_cycles SET status = ?1, error = COALESCE(?2, error) WHERE id = ?3",
        params![status.as_str(), error, id],
    )?;
    Ok(())
}

pub fn update_variants_tested(pool: &DbPool, id: &str, count: i32) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE evolution_cycles SET variants_tested = ?1 WHERE id = ?2",
        params![count, id],
    )?;
    Ok(())
}

pub fn complete_cycle(
    pool: &DbPool,
    id: &str,
    promoted: bool,
    winner_fitness: Option<f64>,
    incumbent_fitness: f64,
    summary: &str,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    conn.execute(
        "UPDATE evolution_cycles SET
            status = 'completed',
            promoted = ?1,
            winner_fitness = ?2,
            incumbent_fitness = ?3,
            summary = ?4,
            completed_at = ?5
         WHERE id = ?6",
        params![promoted as i32, winner_fitness, incumbent_fitness, summary, now, id],
    )?;

    // Update policy stats
    conn.execute(
        "UPDATE evolution_policies SET
            last_cycle_at = ?1,
            total_cycles = total_cycles + 1,
            total_promotions = total_promotions + CASE WHEN ?2 THEN 1 ELSE 0 END,
            updated_at = ?1
         WHERE id = (SELECT policy_id FROM evolution_cycles WHERE id = ?3)",
        params![now, promoted as i32, id],
    )?;

    Ok(())
}
