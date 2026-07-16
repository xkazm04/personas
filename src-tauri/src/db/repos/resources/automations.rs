use rusqlite::{params, Row};

use std::str::FromStr;

use crate::db::models::{
    AutomationFallbackMode, AutomationPlatform, AutomationRun, AutomationRunStatus,
    CreateAutomationInput, PersonaAutomation, UpdateAutomationInput,
};
use crate::db::DbPool;
use crate::engine::lifecycle::AutomationDeployStatus;
use crate::error::AppError;

// row_to_automation uses custom conversions (unwrap_or_default, unwrap_or_else, FromStr), stays manual.
fn row_to_automation(row: &Row) -> rusqlite::Result<PersonaAutomation> {
    Ok(PersonaAutomation {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        use_case_id: row.get("use_case_id")?,
        name: row.get("name")?,
        description: row
            .get::<_, Option<String>>("description")?
            .unwrap_or_default(),
        platform: row
            .get::<_, Option<String>>("platform")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(AutomationPlatform::Custom),
        platform_workflow_id: row.get("platform_workflow_id")?,
        platform_url: row.get("platform_url")?,
        webhook_url: row.get("webhook_url")?,
        webhook_method: row
            .get::<_, Option<String>>("webhook_method")?
            .unwrap_or_else(|| "POST".into()),
        platform_credential_id: row.get("platform_credential_id")?,
        credential_mapping: row.get("credential_mapping")?,
        input_schema: row.get("input_schema")?,
        output_schema: row.get("output_schema")?,
        timeout_ms: row.get::<_, Option<i64>>("timeout_ms")?.unwrap_or(30000),
        retry_count: row.get::<_, Option<i32>>("retry_count")?.unwrap_or(1),
        fallback_mode: row
            .get::<_, Option<String>>("fallback_mode")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(AutomationFallbackMode::Connector),
        deployment_status: AutomationDeployStatus::from_str(
            &row.get::<_, Option<String>>("deployment_status")?
                .unwrap_or_else(|| "draft".into()),
        )
        .unwrap_or(AutomationDeployStatus::Draft),
        last_triggered_at: row.get("last_triggered_at")?,
        last_result_status: row.get("last_result_status")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

row_mapper!(row_to_run -> AutomationRun {
    id, automation_id, execution_id, status, input_data, output_data,
    platform_run_id, platform_logs_url, duration_ms, error_message,
    warnings, started_at, completed_at,
});

// -- Automation CRUD --------------------------------------------------

pub fn get_by_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<PersonaAutomation>, AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::get_by_persona",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM persona_automations WHERE persona_id = ?1 ORDER BY created_at",
            )?;
            let rows = stmt.query_map(params![persona_id], row_to_automation)?;
            let items = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            Ok(items)
        }
    )
}

crud_get_by_id!(
    PersonaAutomation,
    "persona_automations",
    "Automation",
    row_to_automation
);

pub fn create(pool: &DbPool, input: CreateAutomationInput) -> Result<PersonaAutomation, AppError> {
    timed_query!("persona_automations", "persona_automations::create", {
        if input.name.trim().is_empty() {
            return Err(AppError::Validation(
                "Automation name cannot be empty".into(),
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let method = input.webhook_method.as_deref().unwrap_or("POST");
        let timeout = input.timeout_ms.unwrap_or(30000);
        let retries = input.retry_count.unwrap_or(1).clamp(1, 5);
        let fallback = input
            .fallback_mode
            .unwrap_or(AutomationFallbackMode::Connector);
        let desc = input.description.as_deref().unwrap_or("");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_automations
             (id, persona_id, use_case_id, name, description, platform,
              platform_workflow_id, platform_url, webhook_url, webhook_method,
              platform_credential_id, credential_mapping,
              input_schema, output_schema, timeout_ms, retry_count, fallback_mode,
              deployment_status, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,'draft',?18,?18)",
            params![
                id,
                input.persona_id,
                input.use_case_id,
                input.name,
                desc,
                input.platform.as_str(),
                input.platform_workflow_id,
                input.platform_url,
                input.webhook_url,
                method,
                input.platform_credential_id,
                input.credential_mapping,
                input.input_schema,
                input.output_schema,
                timeout,
                retries,
                fallback.as_str(),
                now,
            ],
        )?;

        get_by_id(pool, &id)
    })
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateAutomationInput,
) -> Result<PersonaAutomation, AppError> {
    timed_query!("persona_automations", "persona_automations::update", {
        if let Some(ref name) = input.name {
            if name.trim().is_empty() {
                return Err(AppError::Validation("Name cannot be empty".into()));
            }
        }
        // Validate existence (and transition if deployment_status is changing)
        let current = get_by_id(pool, id)?;
        if let Some(ref new_status) = input.deployment_status {
            if !current.deployment_status.can_transition_to(*new_status)
                && current.deployment_status != *new_status
            {
                return Err(AppError::Validation(format!(
                    "Invalid automation transition: '{}' -> '{}'",
                    current.deployment_status, new_status
                )));
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        push_field_param!(input.name, "name", sets, param_idx, param_values, clone);
        push_field_param!(
            input.description,
            "description",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.use_case_id,
            "use_case_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.platform_workflow_id,
            "platform_workflow_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.platform_url,
            "platform_url",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.webhook_url,
            "webhook_url",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.webhook_method,
            "webhook_method",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.platform_credential_id,
            "platform_credential_id",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.credential_mapping,
            "credential_mapping",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.input_schema,
            "input_schema",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.output_schema,
            "output_schema",
            sets,
            param_idx,
            param_values,
            clone
        );
        push_field_param!(
            input.timeout_ms,
            "timeout_ms",
            sets,
            param_idx,
            param_values,
            copy
        );
        let clamped_retry = input.retry_count.map(|r| r.clamp(1, 5));
        push_field_param!(
            clamped_retry,
            "retry_count",
            sets,
            param_idx,
            param_values,
            copy
        );
        push_field_param!(
            input.fallback_mode,
            "fallback_mode",
            sets,
            param_idx,
            param_values,
            as_str
        );
        push_field_param!(
            input.deployment_status,
            "deployment_status",
            sets,
            param_idx,
            param_values,
            as_str
        );
        push_field_param!(
            input.error_message,
            "error_message",
            sets,
            param_idx,
            param_values,
            clone
        );

        let sql = format!(
            "UPDATE persona_automations SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_by_id(pool, id)
    })
}

crud_delete!("persona_automations");

/// Returns a summary of resources affected by deleting this automation.
pub fn blast_radius(pool: &DbPool, id: &str) -> Result<Vec<(String, String)>, AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::blast_radius",
        {
            let conn = pool.get()?;
            let mut impacts: Vec<(String, String)> = Vec::new();

            let (status, running_runs, total_runs): (Option<String>, i64, i64) = conn
            .query_row(
                "SELECT pa.deployment_status,
                        COALESCE(SUM(CASE WHEN ar.status IN ('running', 'pending') THEN 1 ELSE 0 END), 0),
                        COUNT(ar.id)
                 FROM persona_automations pa
                 LEFT JOIN automation_runs ar ON ar.automation_id = pa.id
                 WHERE pa.id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;

            if status.as_deref() == Some("active") {
                impacts.push((
                    "status".into(),
                    "This automation is currently active and will stop running".into(),
                ));
            }
            if running_runs > 0 {
                impacts.push((
                    "run".into(),
                    format!("{running_runs} in-progress run(s) will be orphaned"),
                ));
            }
            if total_runs > 0 {
                impacts.push((
                    "history".into(),
                    format!("{total_runs} historical run(s) will be deleted"),
                ));
            }

            Ok(impacts)
        }
    )
}

/// Update last_triggered_at and last_result_status after a run completes.
pub fn record_trigger_result(
    pool: &DbPool,
    id: &str,
    status: &str,
    error_msg: Option<&str>,
) -> Result<(), AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::record_trigger_result",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
            "UPDATE persona_automations
             SET last_triggered_at = ?1, last_result_status = ?2, error_message = ?3, updated_at = ?1
             WHERE id = ?4",
            params![now, status, error_msg, id],
        )?;
            Ok(())
        }
    )
}

// -- Automation Runs --------------------------------------------------

pub fn create_run(
    pool: &DbPool,
    automation_id: &str,
    execution_id: Option<&str>,
    input_data: Option<&str>,
) -> Result<AutomationRun, AppError> {
    timed_query!("persona_automations", "persona_automations::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO automation_runs (id, automation_id, execution_id, status, input_data, started_at)
             VALUES (?1, ?2, ?3, 'running', ?4, ?5)",
            params![id, automation_id, execution_id, input_data, now],
        )?;
        get_run_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn complete_run(
    pool: &DbPool,
    run_id: &str,
    status: AutomationRunStatus,
    output_data: Option<&str>,
    duration_ms: Option<i64>,
    platform_run_id: Option<&str>,
    platform_logs_url: Option<&str>,
    error_message: Option<&str>,
    warnings: Option<&str>,
) -> Result<AutomationRun, AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::complete_run",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
                "UPDATE automation_runs
             SET status = ?1, output_data = ?2, duration_ms = ?3,
                 platform_run_id = ?4, platform_logs_url = ?5,
                 error_message = ?6, warnings = ?7, completed_at = ?8
             WHERE id = ?9",
                params![
                    status.as_str(),
                    output_data,
                    duration_ms,
                    platform_run_id,
                    platform_logs_url,
                    error_message,
                    warnings,
                    now,
                    run_id
                ],
            )?;
            get_run_by_id(pool, run_id)
        }
    )
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<AutomationRun, AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::get_run_by_id",
        {
            let conn = pool.get()?;
            conn.query_row(
                "SELECT * FROM automation_runs WHERE id = ?1",
                params![id],
                row_to_run,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Automation run {id}"))
                }
                other => AppError::Database(other),
            })
        }
    )
}

pub fn get_runs_by_automation(
    pool: &DbPool,
    automation_id: &str,
    limit: Option<i64>,
) -> Result<Vec<AutomationRun>, AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::get_runs_by_automation",
        {
            let lim = limit.unwrap_or(50);
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM automation_runs WHERE automation_id = ?1
             ORDER BY started_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![automation_id, lim], row_to_run)?;
            let items = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            Ok(items)
        }
    )
}

/// Count pending/running runs for an automation that are recent enough to be
/// genuinely in-flight, ignoring crash-orphaned rows older than `stale_secs`.
///
/// Used by `delete_automation` in place of the old bounded 50-row snapshot,
/// which (a) missed a long-running run older than the 50 most recent rows and
/// (b) had no staleness handling, so a `running` row orphaned by a crash blocked
/// deletion forever. Uses `julianday` math to stay agnostic to the
/// `datetime('now')` storage format (same approach as `reap_stale_runs`).
pub fn count_active_runs(
    pool: &DbPool,
    automation_id: &str,
    stale_secs: i64,
) -> Result<i64, AppError> {
    timed_query!("persona_automations", "persona_automations::count_active_runs", {
        let conn = pool.get()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM automation_runs
              WHERE automation_id = ?1
                AND status IN ('pending', 'running')
                AND (julianday('now') - julianday(started_at)) * 86400.0 < ?2",
            params![automation_id, stale_secs as f64],
            |row| row.get(0),
        )?;
        Ok(count)
    })
}

/// Additive safety grace (ms) added on top of a run's computed worst-case
/// budget before the reaper will touch it. Guards against clock skew and the
/// small window between a webhook returning and `finalize_run` writing the
/// terminal status, so a run that is genuinely about to complete is never
/// reaped out from under itself.
const REAP_SAFETY_GRACE_MS: i64 = 5_000;

/// Mark automation runs stuck in 'running' as 'failed' once they exceed their
/// **worst-case retry+backoff budget** without completing.
///
/// The previous heuristic (2× `timeout_ms`) could reap a run that was still
/// legitimately inside its retry-backoff budget: `invoke_automation` makes up
/// to `retry_count` (clamped 1..5) attempts, each allowed a full `timeout_ms`,
/// separated by exponential backoff (1s, 2s, 4s, 8s — none hit the 30s cap
/// within the 1..5 clamp). A 5-attempt / 30s-timeout automation can therefore
/// legitimately run for 5×30s + (1+2+4+8)s = 165s, yet 2×30s = 60s would reap
/// it mid-retry. The worst-case budget below is computed per-automation so the
/// reaper only ever fires on runs that truly cannot still be in flight.
///
/// `worst_case_ms = max_attempts × timeout_ms + backoff_sum(max_attempts)`,
/// where `max_attempts = clamp(retry_count, 1, 5)` and the backoff sum is the
/// closed-form total for that attempt count (0 / 1000 / 3000 / 7000 / 15000).
/// A `REAP_SAFETY_GRACE_MS` cushion is added on top. Falls back to a 30s-timeout
/// single-attempt automation's budget (+grace) when the automation row is gone.
///
/// Returns the number of runs reaped.
pub fn reap_stale_runs(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!("automation_runs", "automation_runs::reap_stale_runs", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        // Elapsed is compared in MILLISECONDS: julianday() diff is in days,
        // ×86_400_000 → ms. `ma` = clamped attempt count; the CASE is the
        // exact backoff sum for ma ∈ 1..5. `86400000.0` keeps the arithmetic
        // in floating point to match the fractional julianday delta.
        let sql = format!(
            "UPDATE automation_runs
             SET status = 'failed',
                 error_message = 'Reaped: exceeded worst-case retry + backoff budget without completion',
                 completed_at = ?1
             WHERE status = 'running'
               AND (julianday(?1) - julianday(started_at)) * 86400000.0
                   > COALESCE(
                       (SELECT
                          max(min(COALESCE(pa.retry_count, 1), 5), 1) * COALESCE(pa.timeout_ms, 30000)
                          + CASE max(min(COALESCE(pa.retry_count, 1), 5), 1)
                              WHEN 1 THEN 0
                              WHEN 2 THEN 1000
                              WHEN 3 THEN 3000
                              WHEN 4 THEN 7000
                              ELSE 15000
                            END
                        FROM persona_automations pa
                        WHERE pa.id = automation_runs.automation_id),
                       30000
                     ) + {REAP_SAFETY_GRACE_MS}"
        );
        let changed = conn.execute(&sql, params![now])?;
        Ok(changed)
    })
}

pub fn get_runs_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<AutomationRun>, AppError> {
    timed_query!(
        "persona_automations",
        "persona_automations::get_runs_by_execution",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM automation_runs WHERE execution_id = ?1 ORDER BY started_at",
            )?;
            let rows = stmt.query_map(params![execution_id], row_to_run)?;
            let items = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            Ok(items)
        }
    )
}

#[cfg(test)]
mod reaper_tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::core::personas;

    fn make_persona(pool: &DbPool) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: "Automation Owner".into(),
                system_prompt: "A real system prompt.".into(),
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
        )
        .unwrap()
        .id
    }

    fn make_automation(pool: &DbPool, persona_id: &str, timeout_ms: i64, retry_count: i32) -> String {
        create(
            pool,
            CreateAutomationInput {
                persona_id: persona_id.to_string(),
                use_case_id: None,
                name: "A".into(),
                description: None,
                platform: AutomationPlatform::Custom,
                platform_workflow_id: None,
                platform_url: None,
                webhook_url: Some("https://example.com/hook".into()),
                webhook_method: Some("POST".into()),
                platform_credential_id: None,
                credential_mapping: None,
                input_schema: None,
                output_schema: None,
                timeout_ms: Some(timeout_ms),
                retry_count: Some(retry_count),
                fallback_mode: None,
            },
        )
        .unwrap()
        .id
    }

    /// Create a `running` run and backdate its `started_at` by `secs_ago`.
    fn running_run_started_secs_ago(pool: &DbPool, automation_id: &str, secs_ago: i64) -> String {
        let run = create_run(pool, automation_id, None, None).unwrap();
        let backdated = (chrono::Utc::now() - chrono::Duration::seconds(secs_ago)).to_rfc3339();
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE automation_runs SET started_at = ?1 WHERE id = ?2",
            params![backdated, run.id],
        )
        .unwrap();
        run.id
    }

    fn status_of(pool: &DbPool, run_id: &str) -> String {
        get_run_by_id(pool, run_id).unwrap().status.as_str().to_string()
    }

    #[test]
    fn does_not_reap_run_inside_worst_case_budget() {
        // timeout=1000ms, retry=3 → max_attempts=3, budget = 3*1000 + 3000
        // backoff = 6000ms, + 5000ms grace = 11000ms (~11s).
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let auto_id = make_automation(&pool, &persona_id, 1000, 3);
        // 8s < 11s → must NOT be reaped (legitimately mid retry-backoff).
        let run_id = running_run_started_secs_ago(&pool, &auto_id, 8);

        let reaped = reap_stale_runs(&pool).unwrap();
        assert_eq!(reaped, 0, "run inside its worst-case budget must not be reaped");
        assert_eq!(status_of(&pool, &run_id), "running");
    }

    #[test]
    fn reaps_run_past_worst_case_budget() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let auto_id = make_automation(&pool, &persona_id, 1000, 3);
        // 20s > 11s → genuinely stuck, reaped.
        let run_id = running_run_started_secs_ago(&pool, &auto_id, 20);

        let reaped = reap_stale_runs(&pool).unwrap();
        assert_eq!(reaped, 1);
        assert_eq!(status_of(&pool, &run_id), "failed");
    }

    #[test]
    fn does_not_reap_high_retry_run_the_old_2x_heuristic_would_have() {
        // The exact regression the change fixes: timeout=1000ms, retry=5.
        // Old rule (2× timeout = 2s) would reap a 20s-old run mid-retry.
        // New worst-case = 5*1000 + 15000 + 5000 grace = 25000ms (25s).
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let auto_id = make_automation(&pool, &persona_id, 1000, 5);
        let run_id = running_run_started_secs_ago(&pool, &auto_id, 20);

        let reaped = reap_stale_runs(&pool).unwrap();
        assert_eq!(reaped, 0, "a run still inside its 5-attempt budget must survive");
        assert_eq!(status_of(&pool, &run_id), "running");
    }

    #[test]
    fn leaves_completed_runs_untouched() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let auto_id = make_automation(&pool, &persona_id, 1000, 1);
        let run_id = running_run_started_secs_ago(&pool, &auto_id, 999);
        complete_run(
            &pool,
            &run_id,
            AutomationRunStatus::Completed,
            Some("ok"),
            Some(10),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(reap_stale_runs(&pool).unwrap(), 0);
        assert_eq!(status_of(&pool, &run_id), "completed");
    }
}
