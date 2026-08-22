use crate::models::DevScan;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

fn row_to_scan(row: &Row) -> rusqlite::Result<DevScan> {
    Ok(DevScan {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        scan_type: row.get("scan_type")?,
        status: row.get("status")?,
        idea_count: row.get::<_, Option<i32>>("idea_count")?.unwrap_or(0),
        input_tokens: row.get("input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        duration_ms: row.get("duration_ms")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
    })
}

// ============================================================================
// Scans
// ============================================================================

pub fn list_scans(
    pool: &DbPool,
    project_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<DevScan>, AppError> {
    timed_query!("dev_scans", "dev_scans::list_scans", {
        let conn = pool.get()?;
        let limit = limit.unwrap_or(50);
        if let Some(project_id) = project_id {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_scans WHERE project_id = ?1 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![project_id, limit], row_to_scan)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        } else {
            let mut stmt =
                conn.prepare("SELECT * FROM dev_scans ORDER BY created_at DESC LIMIT ?1")?;
            let rows = stmt.query_map(params![limit], row_to_scan)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    })
}

pub fn get_scan_by_id(pool: &DbPool, id: &str) -> Result<DevScan, AppError> {
    timed_query!("dev_scans", "dev_scans::get_scan_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_scans WHERE id = ?1",
            params![id],
            row_to_scan,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev scan {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn create_scan(
    pool: &DbPool,
    project_id: Option<&str>,
    scan_type: &str,
    status: Option<&str>,
) -> Result<DevScan, AppError> {
    timed_query!("dev_scans", "dev_scans::create_scan", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = status.unwrap_or("running");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_scans (id, project_id, scan_type, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, project_id, scan_type, status, now],
        )?;

        get_scan_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_scan(
    pool: &DbPool,
    id: &str,
    status: Option<&str>,
    idea_count: Option<i32>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<Option<&str>>,
) -> Result<DevScan, AppError> {
    timed_query!("dev_scans", "dev_scans::update_scan", {
        get_scan_by_id(pool, id)?;
        let conn = pool.get()?;

        let mut sets: Vec<String> = Vec::new();
        let mut param_idx = 1u32;

        push_field!(status, "status", sets, param_idx);
        push_field!(idea_count, "idea_count", sets, param_idx);
        push_field!(input_tokens, "input_tokens", sets, param_idx);
        push_field!(output_tokens, "output_tokens", sets, param_idx);
        push_field!(duration_ms, "duration_ms", sets, param_idx);
        push_field!(error, "error", sets, param_idx);

        if sets.is_empty() {
            return get_scan_by_id(pool, id);
        }

        let sql = format!(
            "UPDATE dev_scans SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(v) = status {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = idea_count {
            param_values.push(Box::new(v));
        }
        if let Some(v) = input_tokens {
            param_values.push(Box::new(v));
        }
        if let Some(v) = output_tokens {
            param_values.push(Box::new(v));
        }
        if let Some(v) = duration_ms {
            param_values.push(Box::new(v));
        }
        if let Some(v) = error {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_scan_by_id(pool, id)
    })
}
