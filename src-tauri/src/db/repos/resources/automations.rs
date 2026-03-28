use rusqlite::{params, Row};

use std::str::FromStr;

use crate::db::models::{
    AutomationRun, CreateAutomationInput, PersonaAutomation, UpdateAutomationInput,
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
        description: row.get::<_, Option<String>>("description")?.unwrap_or_default(),
        platform: row.get("platform")?,
        platform_workflow_id: row.get("platform_workflow_id")?,
        platform_url: row.get("platform_url")?,
        webhook_url: row.get("webhook_url")?,
        webhook_method: row.get::<_, Option<String>>("webhook_method")?.unwrap_or_else(|| "POST".into()),
        platform_credential_id: row.get("platform_credential_id")?,
        credential_mapping: row.get("credential_mapping")?,
        input_schema: row.get("input_schema")?,
        output_schema: row.get("output_schema")?,
        timeout_ms: row.get::<_, Option<i64>>("timeout_ms")?.unwrap_or(30000),
        retry_count: row.get::<_, Option<i32>>("retry_count")?.unwrap_or(1),
        fallback_mode: row.get::<_, Option<String>>("fallback_mode")?.unwrap_or_else(|| "connector".into()),
        deployment_status: AutomationDeployStatus::from_str(
            &row.get::<_, Option<String>>("deployment_status")?.unwrap_or_else(|| "draft".into()),
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
    timed_query!("persona_automations", "persona_automations::get_by_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM persona_automations WHERE persona_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_automation)?;
        let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(items)
    })
}

crud_get_by_id!(PersonaAutomation, "persona_automations", "Automation", row_to_automation);

pub fn create(pool: &DbPool, input: CreateAutomationInput) -> Result<PersonaAutomation, AppError> {
    timed_query!("persona_automations", "persona_automations::create", {
        if input.name.trim().is_empty() {
            return Err(AppError::Validation("Automation name cannot be empty".into()));
        }
        let valid_platforms = ["n8n", "github_actions", "zapier", "custom"];
        if !valid_platforms.contains(&input.platform.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid platform '{}'. Must be one of: {}",
                input.platform,
                valid_platforms.join(", ")
            )));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let method = input.webhook_method.as_deref().unwrap_or("POST");
        let timeout = input.timeout_ms.unwrap_or(30000);
        let retries = input.retry_count.unwrap_or(1);
        let fallback = input.fallback_mode.as_deref().unwrap_or("connector");
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
                id, input.persona_id, input.use_case_id, input.name, desc, input.platform,
                input.platform_workflow_id, input.platform_url, input.webhook_url, method,
                input.platform_credential_id, input.credential_mapping,
                input.input_schema, input.output_schema, timeout, retries, fallback,
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
        push_field_param!(input.description, "description", sets, param_idx, param_values, clone);
        push_field_param!(input.use_case_id, "use_case_id", sets, param_idx, param_values, clone);
        push_field_param!(input.platform_workflow_id, "platform_workflow_id", sets, param_idx, param_values, clone);
        push_field_param!(input.platform_url, "platform_url", sets, param_idx, param_values, clone);
        push_field_param!(input.webhook_url, "webhook_url", sets, param_idx, param_values, clone);
        push_field_param!(input.webhook_method, "webhook_method", sets, param_idx, param_values, clone);
        push_field_param!(input.platform_credential_id, "platform_credential_id", sets, param_idx, param_values, clone);
        push_field_param!(input.credential_mapping, "credential_mapping", sets, param_idx, param_values, clone);
        push_field_param!(input.input_schema, "input_schema", sets, param_idx, param_values, clone);
        push_field_param!(input.output_schema, "output_schema", sets, param_idx, param_values, clone);
        push_field_param!(input.timeout_ms, "timeout_ms", sets, param_idx, param_values, copy);
        push_field_param!(input.retry_count, "retry_count", sets, param_idx, param_values, copy);
        push_field_param!(input.fallback_mode, "fallback_mode", sets, param_idx, param_values, clone);
        push_field_param!(input.deployment_status, "deployment_status", sets, param_idx, param_values, as_str);
        push_field_param!(input.error_message, "error_message", sets, param_idx, param_values, clone);

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
    timed_query!("persona_automations", "persona_automations::blast_radius", {
        let conn = pool.get()?;
        let mut impacts: Vec<(String, String)> = Vec::new();

        // Check if automation is active
        let status: Option<String> = conn
            .query_row(
                "SELECT deployment_status FROM persona_automations WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        if status.as_deref() == Some("active") {
            impacts.push(("status".into(), "This automation is currently active and will stop running".into()));
        }

        // Running automation runs
        let running_runs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ?1 AND status IN ('running', 'pending')",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if running_runs > 0 {
            impacts.push(("run".into(), format!("{running_runs} in-progress run(s) will be orphaned")));
        }

        // Historical runs that will be deleted
        let total_runs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM automation_runs WHERE automation_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if total_runs > 0 {
            impacts.push(("history".into(), format!("{total_runs} historical run(s) will be deleted")));
        }

        Ok(impacts)
    })
}

/// Update last_triggered_at and last_result_status after a run completes.
pub fn record_trigger_result(
    pool: &DbPool,
    id: &str,
    status: &str,
    error_msg: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("persona_automations", "persona_automations::record_trigger_result", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_automations
             SET last_triggered_at = ?1, last_result_status = ?2, error_message = ?3, updated_at = ?1
             WHERE id = ?4",
            params![now, status, error_msg, id],
        )?;
        Ok(())
    })
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
    status: &str,
    output_data: Option<&str>,
    duration_ms: Option<i64>,
    platform_run_id: Option<&str>,
    platform_logs_url: Option<&str>,
    error_message: Option<&str>,
    warnings: Option<&str>,
) -> Result<AutomationRun, AppError> {
    timed_query!("persona_automations", "persona_automations::complete_run", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE automation_runs
             SET status = ?1, output_data = ?2, duration_ms = ?3,
                 platform_run_id = ?4, platform_logs_url = ?5,
                 error_message = ?6, warnings = ?7, completed_at = ?8
             WHERE id = ?9",
            params![status, output_data, duration_ms, platform_run_id, platform_logs_url, error_message, warnings, now, run_id],
        )?;
        get_run_by_id(pool, run_id)
    })
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<AutomationRun, AppError> {
    timed_query!("persona_automations", "persona_automations::get_run_by_id", {
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
    })
}

pub fn get_runs_by_automation(
    pool: &DbPool,
    automation_id: &str,
    limit: Option<i64>,
) -> Result<Vec<AutomationRun>, AppError> {
    timed_query!("persona_automations", "persona_automations::get_runs_by_automation", {
        let lim = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM automation_runs WHERE automation_id = ?1
             ORDER BY started_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![automation_id, lim], row_to_run)?;
        let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(items)
    })
}

/// Mark automation runs stuck in 'running' as 'failed' when they exceed
/// 2× their automation's configured timeout_ms without completion.
///
/// Returns the number of runs reaped.
pub fn reap_stale_runs(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!("automation_runs", "automation_runs::reap_stale_runs", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        // Find runs stuck in 'running' whose elapsed time exceeds 2× the
        // automation's timeout_ms (converted from ms to seconds for SQLite).
        // Falls back to 60s (2×30s default) when the automation is missing.
        let changed = conn.execute(
            "UPDATE automation_runs
             SET status = 'failed',
                 error_message = 'Reaped: exceeded maximum expected duration without completion',
                 completed_at = ?1
             WHERE status = 'running'
               AND (julianday(?1) - julianday(started_at)) * 86400.0
                   > COALESCE(
                       (SELECT 2.0 * pa.timeout_ms / 1000.0
                        FROM persona_automations pa
                        WHERE pa.id = automation_runs.automation_id),
                       60.0
                     )",
            params![now],
        )?;
        Ok(changed)
    })
}

pub fn get_runs_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<AutomationRun>, AppError> {
    timed_query!("persona_automations", "persona_automations::get_runs_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM automation_runs WHERE execution_id = ?1 ORDER BY started_at",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_run)?;
        let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
        Ok(items)
    })
}
