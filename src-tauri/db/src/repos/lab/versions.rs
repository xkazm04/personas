use crate::models::lab::PersonaVersion;
use crate::DbPool;
use personas_core::error::AppError;

/// One projection for every read of `persona_versions`, so the SELECT and the
/// mapper cannot disagree. Mirrors `CREATE TABLE persona_versions` at
/// `migrations/incremental/e03_p2p_and_telemetry.rs:307`.
const COLUMNS: &str = "id, persona_id, version_number, name, description, system_prompt, \
                       structured_prompt, model_profile, max_budget_usd, max_turns, \
                       timeout_ms, design_context, change_summary, tag, \
                       parent_version_id, created_at";

row_mapper!(row_to_version -> PersonaVersion {
    id,
    persona_id,
    version_number,
    name,
    description,
    system_prompt,
    structured_prompt,
    model_profile,
    max_budget_usd,
    max_turns,
    timeout_ms,
    design_context,
    change_summary,
    tag,
    parent_version_id,
    created_at,
});

pub fn create_version(pool: &DbPool, persona_id: &str) -> Result<PersonaVersion, AppError> {
    timed_query!("persona_versions", "persona_versions::create_version", {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;

        // Get next version number
        let next_num: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
                 FROM persona_versions WHERE persona_id = ?1",
                rusqlite::params![persona_id],
                |row| row.get("next_version_number"),
            )
            .unwrap_or(1);

        let id = uuid::Uuid::new_v4().to_string();

        // Snapshot current persona state
        conn.execute(
            "INSERT INTO persona_versions (id, persona_id, version_number, name, description, system_prompt, structured_prompt, model_profile, max_budget_usd, max_turns, timeout_ms, design_context, tag)
             SELECT ?1, p.id, ?2, p.name, p.description, p.system_prompt, p.structured_prompt, p.model_profile, p.max_budget_usd, p.max_turns, p.timeout_ms, p.design_context, 'experimental'
             FROM personas p WHERE p.id = ?3",
            rusqlite::params![id, next_num, persona_id],
        ).map_err(|e| AppError::Internal(e.to_string()))?;

        // Snapshot current tools (join through persona_tools assignment table)
        conn.execute(
            "INSERT INTO persona_version_tools (id, version_id, tool_id, tool_config)
             SELECT hex(randomblob(16)), ?1, td.id, json_object('name', td.name, 'category', td.category, 'description', td.description)
             FROM persona_tools pt
             JOIN persona_tool_definitions td ON td.id = pt.tool_id
             WHERE pt.persona_id = ?2",
            rusqlite::params![id, persona_id],
        ).map_err(|e| AppError::Internal(e.to_string()))?;

        // Read back
        let version = conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM persona_versions WHERE id = ?1"),
                rusqlite::params![id],
                row_to_version,
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(version)
    })
}

pub fn get_versions(
    pool: &DbPool,
    persona_id: &str,
    limit: i32,
) -> Result<Vec<PersonaVersion>, AppError> {
    timed_query!("persona_versions", "persona_versions::get_versions", {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM persona_versions WHERE persona_id = ?1
             ORDER BY version_number DESC LIMIT ?2"
            ))
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let versions = stmt
            .query_map(rusqlite::params![persona_id, limit], row_to_version)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(versions)
    })
}

pub fn get_version_tool_count(pool: &DbPool, version_id: &str) -> Result<i32, AppError> {
    timed_query!(
        "persona_versions",
        "persona_versions::get_version_tool_count",
        {
            let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
            let count: i32 = conn
                .query_row(
                    "SELECT COUNT(*) AS n FROM persona_version_tools WHERE version_id = ?1",
                    rusqlite::params![version_id],
                    |row| row.get("n"),
                )
                .unwrap_or(0);
            Ok(count)
        }
    )
}
