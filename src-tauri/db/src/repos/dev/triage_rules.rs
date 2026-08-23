use crate::models::TriageRule;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

fn row_to_triage_rule(row: &Row) -> rusqlite::Result<TriageRule> {
    Ok(TriageRule {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        conditions: row.get("conditions")?,
        action: row.get("action")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        times_fired: row.get::<_, Option<i32>>("times_fired")?.unwrap_or(0),
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Triage Rules
// ============================================================================

pub fn list_triage_rules(
    pool: &DbPool,
    project_id: Option<&str>,
) -> Result<Vec<TriageRule>, AppError> {
    timed_query!("dev_triage_rules", "dev_triage_rules::list_triage_rules", {
        let conn = pool.get()?;
        if let Some(project_id) = project_id {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_triage_rules WHERE project_id = ?1 ORDER BY created_at",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_triage_rule)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt = conn.prepare("SELECT * FROM dev_triage_rules ORDER BY created_at")?;
            let rows = stmt.query_map([], row_to_triage_rule)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    })
}

pub fn create_triage_rule(
    pool: &DbPool,
    project_id: Option<&str>,
    name: &str,
    conditions: &str,
    action: &str,
    enabled: Option<bool>,
) -> Result<TriageRule, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    timed_query!(
        "dev_triage_rules",
        "dev_triage_rules::create_triage_rule",
        {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let enabled = if enabled.unwrap_or(true) { 1 } else { 0 };

            let conn = pool.get()?;
            conn.execute(
            "INSERT INTO dev_triage_rules (id, project_id, name, conditions, action, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, project_id, name, conditions, action, enabled, now],
        )?;

            conn.query_row(
                "SELECT * FROM dev_triage_rules WHERE id = ?1",
                params![id],
                row_to_triage_rule,
            )
            .map_err(AppError::Database)
        }
    )
}

pub fn update_triage_rule(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    conditions: Option<&str>,
    action: Option<&str>,
    enabled: Option<bool>,
    times_fired: Option<i32>,
) -> Result<TriageRule, AppError> {
    timed_query!(
        "dev_triage_rules",
        "dev_triage_rules::update_triage_rule",
        {
            let conn = pool.get()?;

            let mut sets: Vec<String> = Vec::new();
            let mut param_idx = 1u32;

            push_field!(name, "name", sets, param_idx);
            push_field!(conditions, "conditions", sets, param_idx);
            push_field!(action, "action", sets, param_idx);
            // Handle bool -> i32 conversion for enabled
            let enabled_i32 = enabled.map(|b| if b { 1i32 } else { 0i32 });
            push_field!(enabled_i32, "enabled", sets, param_idx);
            push_field!(times_fired, "times_fired", sets, param_idx);

            if sets.is_empty() {
                return conn
                    .query_row(
                        "SELECT * FROM dev_triage_rules WHERE id = ?1",
                        params![id],
                        row_to_triage_rule,
                    )
                    .map_err(|e| match e {
                        rusqlite::Error::QueryReturnedNoRows => {
                            AppError::NotFound(format!("Triage rule {id}"))
                        }
                        other => AppError::Database(other),
                    });
            }

            let sql = format!(
                "UPDATE dev_triage_rules SET {} WHERE id = ?{}",
                sets.join(", "),
                param_idx
            );

            let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            if let Some(v) = name {
                param_values.push(Box::new(v.to_string()));
            }
            if let Some(v) = conditions {
                param_values.push(Box::new(v.to_string()));
            }
            if let Some(v) = action {
                param_values.push(Box::new(v.to_string()));
            }
            if let Some(v) = enabled_i32 {
                param_values.push(Box::new(v));
            }
            if let Some(v) = times_fired {
                param_values.push(Box::new(v));
            }
            param_values.push(Box::new(id.to_string()));

            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                param_values.iter().map(|p| p.as_ref()).collect();
            conn.execute(&sql, params_ref.as_slice())?;

            conn.query_row(
                "SELECT * FROM dev_triage_rules WHERE id = ?1",
                params![id],
                row_to_triage_rule,
            )
            .map_err(AppError::Database)
        }
    )
}

pub fn delete_triage_rule(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!(
        "dev_triage_rules",
        "dev_triage_rules::delete_triage_rule",
        {
            let conn = pool.get()?;
            let rows = conn.execute("DELETE FROM dev_triage_rules WHERE id = ?1", params![id])?;
            Ok(rows > 0)
        }
    )
}
