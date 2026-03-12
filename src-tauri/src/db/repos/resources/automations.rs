use rusqlite::{params, Row};

use crate::db::models::{
    AutomationRun, CreateAutomationInput, PersonaAutomation, UpdateAutomationInput,
};
use crate::db::DbPool;
use crate::error::AppError;

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
        deployment_status: row.get::<_, Option<String>>("deployment_status")?.unwrap_or_else(|| "draft".into()),
        last_triggered_at: row.get("last_triggered_at")?,
        last_result_status: row.get("last_result_status")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_run(row: &Row) -> rusqlite::Result<AutomationRun> {
    Ok(AutomationRun {
        id: row.get("id")?,
        automation_id: row.get("automation_id")?,
        execution_id: row.get("execution_id")?,
        status: row.get("status")?,
        input_data: row.get("input_data")?,
        output_data: row.get("output_data")?,
        platform_run_id: row.get("platform_run_id")?,
        platform_logs_url: row.get("platform_logs_url")?,
        duration_ms: row.get("duration_ms")?,
        error_message: row.get("error_message")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
    })
}

// -- Automation CRUD --------------------------------------------------

pub fn get_by_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<PersonaAutomation>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_automations WHERE persona_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map(params![persona_id], row_to_automation)?;
    let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(items)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaAutomation, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_automations WHERE id = ?1",
        params![id],
        row_to_automation,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Automation {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create(pool: &DbPool, input: CreateAutomationInput) -> Result<PersonaAutomation, AppError> {
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
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateAutomationInput,
) -> Result<PersonaAutomation, AppError> {
    if let Some(ref name) = input.name {
        if name.trim().is_empty() {
            return Err(AppError::Validation("Name cannot be empty".into()));
        }
    }
    if let Some(ref status) = input.deployment_status {
        let valid = ["draft", "active", "paused", "error"];
        if !valid.contains(&status.as_str()) {
            return Err(AppError::Validation(format!("Invalid deployment_status '{status}'")));
        }
    }

    get_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_idx = 2u32;

    push_field!(input.name, "name", sets, param_idx);
    push_field!(input.description, "description", sets, param_idx);
    push_field!(input.use_case_id, "use_case_id", sets, param_idx);
    push_field!(input.platform_workflow_id, "platform_workflow_id", sets, param_idx);
    push_field!(input.platform_url, "platform_url", sets, param_idx);
    push_field!(input.webhook_url, "webhook_url", sets, param_idx);
    push_field!(input.webhook_method, "webhook_method", sets, param_idx);
    push_field!(input.platform_credential_id, "platform_credential_id", sets, param_idx);
    push_field!(input.credential_mapping, "credential_mapping", sets, param_idx);
    push_field!(input.input_schema, "input_schema", sets, param_idx);
    push_field!(input.output_schema, "output_schema", sets, param_idx);
    push_field!(input.timeout_ms, "timeout_ms", sets, param_idx);
    push_field!(input.retry_count, "retry_count", sets, param_idx);
    push_field!(input.fallback_mode, "fallback_mode", sets, param_idx);
    push_field!(input.deployment_status, "deployment_status", sets, param_idx);
    push_field!(input.error_message, "error_message", sets, param_idx);

    let sql = format!(
        "UPDATE persona_automations SET {} WHERE id = ?{}",
        sets.join(", "),
        param_idx
    );

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref v) = input.name { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.description { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.use_case_id { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.platform_workflow_id { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.platform_url { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.webhook_url { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.webhook_method { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.platform_credential_id { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.credential_mapping { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.input_schema { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.output_schema { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.timeout_ms { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.retry_count { param_values.push(Box::new(*v)); }
    if let Some(ref v) = input.fallback_mode { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.deployment_status { param_values.push(Box::new(v.clone())); }
    if let Some(ref v) = input.error_message { param_values.push(Box::new(v.clone())); }
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM persona_automations WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Update last_triggered_at and last_result_status after a run completes.
pub fn record_trigger_result(
    pool: &DbPool,
    id: &str,
    status: &str,
    error_msg: Option<&str>,
) -> Result<(), AppError> {
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

// -- Automation Runs --------------------------------------------------

pub fn create_run(
    pool: &DbPool,
    automation_id: &str,
    execution_id: Option<&str>,
    input_data: Option<&str>,
) -> Result<AutomationRun, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, execution_id, status, input_data, started_at)
         VALUES (?1, ?2, ?3, 'running', ?4, ?5)",
        params![id, automation_id, execution_id, input_data, now],
    )?;
    get_run_by_id(pool, &id)
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
) -> Result<AutomationRun, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE automation_runs
         SET status = ?1, output_data = ?2, duration_ms = ?3,
             platform_run_id = ?4, platform_logs_url = ?5,
             error_message = ?6, completed_at = ?7
         WHERE id = ?8",
        params![status, output_data, duration_ms, platform_run_id, platform_logs_url, error_message, now, run_id],
    )?;
    get_run_by_id(pool, run_id)
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<AutomationRun, AppError> {
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

pub fn get_runs_by_automation(
    pool: &DbPool,
    automation_id: &str,
    limit: Option<i64>,
) -> Result<Vec<AutomationRun>, AppError> {
    let lim = limit.unwrap_or(50);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM automation_runs WHERE automation_id = ?1
         ORDER BY started_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![automation_id, lim], row_to_run)?;
    let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(items)
}

pub fn get_runs_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<AutomationRun>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM automation_runs WHERE execution_id = ?1 ORDER BY started_at",
    )?;
    let rows = stmt.query_map(params![execution_id], row_to_run)?;
    let items = rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?;
    Ok(items)
}
