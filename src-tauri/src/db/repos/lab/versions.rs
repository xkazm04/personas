use crate::db::DbPool;
use crate::db::models::lab::PersonaVersion;
use crate::error::AppError;

pub fn create_version(
    pool: &DbPool,
    persona_id: &str,
) -> Result<PersonaVersion, AppError> {
    timed_query!("persona_versions", "persona_versions::create_version", {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;

        // Get next version number
        let next_num: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_versions WHERE persona_id = ?1",
                rusqlite::params![persona_id],
                |row| row.get(0),
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
        let version = conn.query_row(
            "SELECT id, persona_id, version_number, name, description, system_prompt, structured_prompt, model_profile, max_budget_usd, max_turns, timeout_ms, design_context, change_summary, tag, parent_version_id, created_at
             FROM persona_versions WHERE id = ?1",
            rusqlite::params![id],
            row_to_version,
        ).map_err(|e| AppError::Internal(e.to_string()))?;

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
        let mut stmt = conn.prepare(
            "SELECT id, persona_id, version_number, name, description, system_prompt, structured_prompt, model_profile, max_budget_usd, max_turns, timeout_ms, design_context, change_summary, tag, parent_version_id, created_at
             FROM persona_versions WHERE persona_id = ?1
             ORDER BY version_number DESC LIMIT ?2"
        ).map_err(|e| AppError::Internal(e.to_string()))?;

        let versions = stmt.query_map(rusqlite::params![persona_id, limit], row_to_version)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(versions)
    })
}

pub fn get_version_tool_count(
    pool: &DbPool,
    version_id: &str,
) -> Result<i32, AppError> {
    timed_query!("persona_versions", "persona_versions::get_version_tool_count", {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM persona_version_tools WHERE version_id = ?1",
            rusqlite::params![version_id],
            |row| row.get(0),
        ).unwrap_or(0);
        Ok(count)
    })
}

fn row_to_version(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersonaVersion> {
    Ok(PersonaVersion {
        id: row.get(0)?,
        persona_id: row.get(1)?,
        version_number: row.get(2)?,
        name: row.get(3)?,
        description: row.get(4)?,
        system_prompt: row.get(5)?,
        structured_prompt: row.get(6)?,
        model_profile: row.get(7)?,
        max_budget_usd: row.get(8)?,
        max_turns: row.get(9)?,
        timeout_ms: row.get(10)?,
        design_context: row.get(11)?,
        change_summary: row.get(12)?,
        tag: row.get(13)?,
        parent_version_id: row.get(14)?,
        created_at: row.get(15)?,
    })
}
