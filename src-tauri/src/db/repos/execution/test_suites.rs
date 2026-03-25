use rusqlite::params;

use crate::db::models::PersonaTestSuite;
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mapper -------------------------------------------------

row_mapper!(row_to_suite -> PersonaTestSuite {
    id, persona_id, name, description, scenarios,
    scenario_count, source_run_id, created_at, updated_at,
});

// -- CRUD operations --------------------------------------------

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

crud_get_by_id!(PersonaTestSuite, "test_suites", "TestSuite", row_to_suite);

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

/// Bulk-fetch test suites for multiple persona IDs in a single query.
pub fn list_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaTestSuite>, AppError> {
    if persona_ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders: Vec<String> = persona_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "SELECT * FROM test_suites WHERE persona_id IN ({}) ORDER BY updated_at DESC",
        placeholders.join(", ")
    );
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = persona_ids
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_ref.as_slice(), row_to_suite)?;
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

crud_delete!("test_suites");
