//! Repository for composition_workflows table — CRUD operations for
//! multi-agent DAG workflow definitions.

use chrono::Utc;
use rusqlite::params;

use crate::db::models::CompositionWorkflow;
use crate::db::models::composition_workflow::{
    CreateCompositionWorkflowInput, UpdateCompositionWorkflowInput,
};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_workflow(row: &rusqlite::Row) -> Result<CompositionWorkflow, rusqlite::Error> {
    Ok(CompositionWorkflow {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        nodes_json: row.get("nodes_json")?,
        edges_json: row.get("edges_json")?,
        input_schema_json: row.get("input_schema_json")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<CompositionWorkflow, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM composition_workflows WHERE id = ?1",
        params![id],
        row_to_workflow,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Workflow {id} not found"))
        }
        _ => AppError::Database(e),
    })
}

pub fn list_all(pool: &DbPool) -> Result<Vec<CompositionWorkflow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM composition_workflows ORDER BY updated_at DESC",
    )?;
    let rows = stmt
        .query_map([], row_to_workflow)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create(
    pool: &DbPool,
    input: CreateCompositionWorkflowInput,
) -> Result<CompositionWorkflow, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO composition_workflows (id, name, description, nodes_json, edges_json, input_schema_json, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            input.name,
            input.description.unwrap_or_default(),
            input.nodes_json.unwrap_or_else(|| "[]".into()),
            input.edges_json.unwrap_or_else(|| "[]".into()),
            input.input_schema_json,
            if input.enabled.unwrap_or(true) { 1 } else { 0 },
            now,
        ],
    )?;
    get_by_id(pool, &id)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateCompositionWorkflowInput,
) -> Result<CompositionWorkflow, AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;

    // Build dynamic SET clause
    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = input.name {
        sets.push(format!("name = ?{}", values.len() + 1));
        values.push(Box::new(name.clone()));
    }
    if let Some(ref desc) = input.description {
        sets.push(format!("description = ?{}", values.len() + 1));
        values.push(Box::new(desc.clone()));
    }
    if let Some(ref nodes) = input.nodes_json {
        sets.push(format!("nodes_json = ?{}", values.len() + 1));
        values.push(Box::new(nodes.clone()));
    }
    if let Some(ref edges) = input.edges_json {
        sets.push(format!("edges_json = ?{}", values.len() + 1));
        values.push(Box::new(edges.clone()));
    }
    if let Some(ref schema) = input.input_schema_json {
        sets.push(format!("input_schema_json = ?{}", values.len() + 1));
        values.push(Box::new(schema.clone()));
    }
    if let Some(enabled) = input.enabled {
        sets.push(format!("enabled = ?{}", values.len() + 1));
        values.push(Box::new(if enabled { 1i64 } else { 0i64 }));
    }

    // Always update timestamp
    sets.push(format!("updated_at = ?{}", values.len() + 1));
    values.push(Box::new(now));

    // Add the WHERE clause parameter
    values.push(Box::new(id.to_string()));
    let where_idx = values.len();

    let sql = format!(
        "UPDATE composition_workflows SET {} WHERE id = ?{}",
        sets.join(", "),
        where_idx,
    );

    let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM composition_workflows WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

/// Bulk import workflows from frontend localStorage migration.
/// Inserts each workflow, skipping duplicates by ID.
pub fn bulk_import(
    pool: &DbPool,
    workflows: Vec<CompositionWorkflow>,
) -> Result<u32, AppError> {
    let conn = pool.get()?;
    let mut imported = 0u32;
    for wf in workflows {
        let result = conn.execute(
            "INSERT OR IGNORE INTO composition_workflows (id, name, description, nodes_json, edges_json, input_schema_json, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                wf.id,
                wf.name,
                wf.description,
                wf.nodes_json,
                wf.edges_json,
                wf.input_schema_json,
                if wf.enabled { 1 } else { 0 },
                wf.created_at,
                wf.updated_at,
            ],
        )?;
        if result > 0 {
            imported += 1;
        }
    }
    Ok(imported)
}
