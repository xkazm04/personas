use rusqlite::{params, Row};

use crate::db::models::PersonaTestSuite;
use crate::db::DbPool;
use crate::error::AppError;

// ── Row mapper ─────────────────────────────────────────────────

fn row_to_suite(row: &Row) -> rusqlite::Result<PersonaTestSuite> {
    Ok(PersonaTestSuite {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        scenarios: row.get("scenarios")?,
        scenario_count: row.get("scenario_count")?,
        source_run_id: row.get("source_run_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ── CRUD operations ────────────────────────────────────────────

pub fn create(
    pool: &DbPool,
    persona_id: &str,
    name: &str,
    description: Option<&str>,
    scenarios: &str,
    scenario_count: i32,
    source_run_id: Option<&str>,
) -> Result<PersonaTestSuite, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO test_suites (id, persona_id, name, description, scenarios, scenario_count, source_run_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, persona_id, name, description, scenarios, scenario_count, source_run_id, now, now],
    )?;
    get_by_id(pool, &id)
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<PersonaTestSuite, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM test_suites WHERE id = ?1",
        params![id],
        row_to_suite,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("TestSuite {id}")),
        other => AppError::Database(other),
    })
}

pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaTestSuite>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM test_suites WHERE persona_id = ?1
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(params![persona_id], row_to_suite)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    scenarios: Option<&str>,
    scenario_count: Option<i32>,
) -> Result<PersonaTestSuite, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE test_suites SET
            name = COALESCE(?1, name),
            description = COALESCE(?2, description),
            scenarios = COALESCE(?3, scenarios),
            scenario_count = COALESCE(?4, scenario_count),
            updated_at = ?5
         WHERE id = ?6",
        params![name, description, scenarios, scenario_count, now, id],
    )?;
    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM test_suites WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}
