use rusqlite::params;

use crate::models::{EvolutionCycle, EvolutionPolicy, UpsertEvolutionPolicyInput};
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::evolution_status::EvolutionCycleStatus;

// -- Row mappers ------------------------------------------------

row_mapper!(row_to_policy -> EvolutionPolicy {
    id, persona_id,
    enabled [bool],
    fitness_objective, mutation_rate, variants_per_cycle,
    improvement_threshold, min_executions_between,
    mutation_strategy [opt],
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
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::upsert_policy",
        {
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
                    mutation_strategy = COALESCE(?7, mutation_strategy),
                    updated_at = ?8
                 WHERE id = ?9",
                    params![
                        input.enabled.map(|b| b as i32),
                        input.fitness_objective,
                        input.mutation_rate,
                        input.variants_per_cycle,
                        input.improvement_threshold,
                        input.min_executions_between,
                        input.mutation_strategy,
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
                     mutation_strategy, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        id,
                        input.persona_id,
                        enabled as i32,
                        fitness_obj,
                        mutation_rate,
                        variants,
                        threshold,
                        min_execs,
                        input.mutation_strategy,
                        now,
                        now,
                    ],
                )?;
                get_policy_by_id(pool, &id)
            }
        }
    )
}

pub fn get_policy_by_id(pool: &DbPool, id: &str) -> Result<EvolutionPolicy, AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::get_policy_by_id",
        {
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
    )
}

pub fn get_policy_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<EvolutionPolicy>, AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::get_policy_for_persona",
        {
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
    )
}

pub fn delete_policy(pool: &DbPool, persona_id: &str) -> Result<bool, AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::delete_policy",
        {
            let conn = pool.get()?;
            let rows = conn.execute(
                "DELETE FROM evolution_policies WHERE persona_id = ?1",
                params![persona_id],
            )?;
            Ok(rows > 0)
        }
    )
}

// -- Evolution Cycles ------------------------------------------

pub fn create_cycle(
    pool: &DbPool,
    policy_id: &str,
    persona_id: &str,
) -> Result<EvolutionCycle, AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::create_cycle",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let conn = pool.get()?;
            // One cycle per policy at a time. `should_evolve` counts runs
            // since the last cycle ENDED, so every success during a running
            // cycle would otherwise spawn another (parallel CLI spend). The
            // guard is part of the INSERT so two racing callers cannot both
            // pass a separate pre-check; a crash leftover is cleared by the
            // boot reaper, not by this guard.
            let inserted = conn.execute(
                "INSERT INTO evolution_cycles
                (id, policy_id, persona_id, status, started_at)
             SELECT ?1, ?2, ?3, 'breeding', ?4
              WHERE NOT EXISTS (
                SELECT 1 FROM evolution_cycles
                 WHERE policy_id = ?2
                   AND status IN ('breeding', 'evaluating', 'promoting'))",
                params![id, policy_id, persona_id, now],
            )?;
            if inserted == 0 {
                return Err(AppError::Validation(
                    "An evolution cycle is already running for this persona".into(),
                ));
            }
            get_cycle_by_id(pool, &id)
        }
    )
}

pub fn get_cycle_by_id(pool: &DbPool, id: &str) -> Result<EvolutionCycle, AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::get_cycle_by_id",
        {
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
    )
}

pub fn list_cycles_for_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<EvolutionCycle>, AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::list_cycles_for_persona",
        {
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
    )
}

pub fn update_cycle_status(
    pool: &DbPool,
    id: &str,
    status: EvolutionCycleStatus,
    error: Option<&str>,
) -> Result<(), AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::update_cycle_status",
        {
            let conn = pool.get()?;
            conn.execute(
            "UPDATE evolution_cycles SET status = ?1, error = COALESCE(?2, error) WHERE id = ?3",
            params![status.as_str(), error, id],
        )?;
            Ok(())
        }
    )
}

pub fn update_variants_tested(pool: &DbPool, id: &str, count: i32) -> Result<(), AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::update_variants_tested",
        {
            let conn = pool.get()?;
            conn.execute(
                "UPDATE evolution_cycles SET variants_tested = ?1 WHERE id = ?2",
                params![count, id],
            )?;
            Ok(())
        }
    )
}

pub fn complete_cycle(
    pool: &DbPool,
    id: &str,
    promoted: bool,
    winner_fitness: Option<f64>,
    incumbent_fitness: f64,
    summary: &str,
) -> Result<(), AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::complete_cycle",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;

            // Both UPDATEs must land together: a crash/error between them would
            // leave a cycle marked completed/promoted while total_cycles /
            // total_promotions never increment, under-counting the policy stats
            // and possibly letting should_evolve re-fire immediately.
            let tx = conn.transaction().map_err(AppError::Database)?;

            tx.execute(
                "UPDATE evolution_cycles SET
                status = 'completed',
                promoted = ?1,
                winner_fitness = ?2,
                incumbent_fitness = ?3,
                summary = ?4,
                completed_at = ?5
             WHERE id = ?6",
                params![
                    promoted as i32,
                    winner_fitness,
                    incumbent_fitness,
                    summary,
                    now,
                    id
                ],
            )?;

            // Update policy stats
            tx.execute(
                "UPDATE evolution_policies SET
                last_cycle_at = ?1,
                total_cycles = total_cycles + 1,
                total_promotions = total_promotions + CASE WHEN ?2 THEN 1 ELSE 0 END,
                updated_at = ?1
             WHERE id = (SELECT policy_id FROM evolution_cycles WHERE id = ?3)",
                params![now, promoted as i32, id],
            )?;

            tx.commit().map_err(AppError::Database)?;

            Ok(())
        }
    )
}

/// Flip a completed cycle's `promoted` flag and bump the policy's
/// `total_promotions`. Called ONLY from the human-approval path of a
/// promotion proposal (Darwin Mode v1) — cycles themselves always complete
/// with `promoted = false`.
pub fn mark_cycle_promoted(pool: &DbPool, cycle_id: &str) -> Result<(), AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::mark_cycle_promoted",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;
            let tx = conn.transaction().map_err(AppError::Database)?;
            let rows = tx.execute(
                "UPDATE evolution_cycles SET promoted = 1 WHERE id = ?1 AND promoted = 0",
                params![cycle_id],
            )?;
            if rows > 0 {
                tx.execute(
                    "UPDATE evolution_policies SET
                        total_promotions = total_promotions + 1,
                        updated_at = ?1
                     WHERE id = (SELECT policy_id FROM evolution_cycles WHERE id = ?2)",
                    params![now, cycle_id],
                )?;
            }
            tx.commit().map_err(AppError::Database)?;
            Ok(())
        }
    )
}

/// Advance ONLY the policy's `last_cycle_at`/`updated_at` clock — without
/// touching `total_cycles` or `total_promotions`. Called on a *failed*
/// terminal evolution path so `should_evolve` requires a fresh
/// `min_executions_between` window before retrying. Without this, a persona
/// whose cycle fails persistently (e.g. zero scenarios generated) leaves
/// `last_cycle_at` frozen, so the post-execution gate re-fires the same failing
/// cycle on every subsequent execution — a real CLI/$$ retry storm with zero
/// forward progress. `total_cycles` stays success-only (bumped solely by
/// `complete_cycle`).
pub fn mark_cycle_attempted(pool: &DbPool, policy_id: &str) -> Result<(), AppError> {
    timed_query!(
        "lab_evolution_cycles",
        "lab_evolution_cycles::mark_cycle_attempted",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
                "UPDATE evolution_policies SET last_cycle_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, policy_id],
            )?;
            Ok(())
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::CreatePersonaInput;
    use crate::repos::core::personas;

    fn make_persona(pool: &DbPool, name: &str) -> Result<String, AppError> {
        Ok(personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a test agent.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )?
        .id)
    }

    fn policy_for(pool: &DbPool, persona_id: &str) -> Result<EvolutionPolicy, AppError> {
        upsert_policy(
            pool,
            &UpsertEvolutionPolicyInput {
                persona_id: persona_id.into(),
                enabled: Some(true),
                fitness_objective: None,
                mutation_rate: None,
                variants_per_cycle: None,
                improvement_threshold: None,
                min_executions_between: None,
                mutation_strategy: None,
            },
        )
    }

    #[test]
    fn a_second_cycle_is_refused_until_the_first_ends() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let persona = make_persona(&pool, "Evolving")?;
        let policy = policy_for(&pool, &persona)?;

        let first = create_cycle(&pool, &policy.id, &persona)?;
        let second = create_cycle(&pool, &policy.id, &persona);
        assert!(
            matches!(second, Err(AppError::Validation(_))),
            "an in-flight cycle must block another: {second:?}"
        );
        for status in [
            EvolutionCycleStatus::Evaluating,
            EvolutionCycleStatus::Promoting,
        ] {
            update_cycle_status(&pool, &first.id, status, None)?;
            assert!(create_cycle(&pool, &policy.id, &persona).is_err());
        }

        update_cycle_status(&pool, &first.id, EvolutionCycleStatus::Completed, None)?;
        let third = create_cycle(&pool, &policy.id, &persona)?;
        assert_ne!(third.id, first.id);

        // A failed cycle also frees the slot.
        update_cycle_status(&pool, &third.id, EvolutionCycleStatus::Failed, Some("boom"))?;
        create_cycle(&pool, &policy.id, &persona)?;
        Ok(())
    }
}
