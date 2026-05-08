use rusqlite::{params, Row};

use crate::db::models::{BuildPhase, BuildSession, UpdateBuildSession};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

const UPDATE_BUILD_SESSION_SQL: &str = "
    UPDATE build_sessions SET
        phase = CASE WHEN ?1 THEN ?2 ELSE phase END,
        resolved_cells = CASE WHEN ?3 THEN ?4 ELSE resolved_cells END,
        pending_question = CASE WHEN ?5 THEN ?6 ELSE pending_question END,
        agent_ir = CASE WHEN ?7 THEN ?8 ELSE agent_ir END,
        adoption_answers = CASE WHEN ?9 THEN ?10 ELSE adoption_answers END,
        error_message = CASE WHEN ?11 THEN ?12 ELSE error_message END,
        cli_pid = CASE WHEN ?13 THEN ?14 ELSE cli_pid END,
        mode = CASE WHEN ?15 THEN ?16 ELSE mode END,
        companion_session_id = CASE WHEN ?17 THEN ?18 ELSE companion_session_id END,
        updated_at = ?19
    WHERE id = ?20";

fn row_to_build_session(row: &Row) -> rusqlite::Result<BuildSession> {
    let phase_str: String = row.get("phase")?;
    let cli_pid: Option<i64> = row.get("cli_pid")?;
    Ok(BuildSession {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        phase: BuildPhase::from_str_value(&phase_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("Unknown build phase: '{}'", phase_str).into(),
            )
        })?,
        resolved_cells: row.get("resolved_cells")?,
        pending_question: row.get("pending_question")?,
        agent_ir: row.get("agent_ir")?,
        adoption_answers: row.get("adoption_answers").unwrap_or(None),
        intent: row.get("intent")?,
        error_message: row.get("error_message")?,
        cli_pid: cli_pid.map(|p| p as u32),
        workflow_json: row.get("workflow_json").unwrap_or(None),
        parser_result_json: row.get("parser_result_json").unwrap_or(None),
        mode: row.get("mode").unwrap_or(None),
        companion_session_id: row.get("companion_session_id").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Insert a new build session.
pub fn create(pool: &DbPool, session: &BuildSession) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::create", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "INSERT INTO build_sessions
             (id, persona_id, phase, resolved_cells, pending_question, agent_ir,
              adoption_answers, intent, error_message, cli_pid, workflow_json,
              parser_result_json, mode, companion_session_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        )?;
        stmt.execute(params![
            session.id,
            session.persona_id,
            session.phase.as_str(),
            session.resolved_cells,
            session.pending_question,
            session.agent_ir,
            session.adoption_answers,
            session.intent,
            session.error_message,
            session.cli_pid.map(|p| p as i64),
            session.workflow_json,
            session.parser_result_json,
            session.mode,
            session.companion_session_id,
            session.created_at,
            session.updated_at,
        ])?;
        Ok(())
    })
}

/// Get a build session by ID.
pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Option<BuildSession>, AppError> {
    timed_query!("build_sessions", "build_sessions::get_by_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached("SELECT * FROM build_sessions WHERE id = ?1")?;
        let result = stmt.query_row(params![id], row_to_build_session);
        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Get the active (non-terminal) build session for a persona, if any.
pub fn get_active_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<BuildSession>, AppError> {
    timed_query!(
        "build_sessions",
        "build_sessions::get_active_for_persona",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM build_sessions
             WHERE persona_id = ?1 AND phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
             ORDER BY updated_at DESC LIMIT 1",
            )?;
            let result = stmt.query_row(params![persona_id], row_to_build_session);
            match result {
                Ok(session) => Ok(Some(session)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::Database(e)),
            }
        }
    )
}

/// Get the most recent build session for a persona, regardless of phase.
/// Used by MatrixTab to retrieve resolved_cells even after promotion.
pub fn get_latest_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<BuildSession>, AppError> {
    timed_query!(
        "build_sessions",
        "build_sessions::get_latest_for_persona",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM build_sessions
             WHERE persona_id = ?1
             ORDER BY updated_at DESC LIMIT 1",
            )?;
            let result = stmt.query_row(params![persona_id], row_to_build_session);
            match result {
                Ok(session) => Ok(Some(session)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::Database(e)),
            }
        }
    )
}

/// Update a build session with only the provided (non-None) fields.
/// Always updates `updated_at`.
pub fn update(pool: &DbPool, id: &str, updates: &UpdateBuildSession) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::update", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let cli_pid = updates.cli_pid.map(|value| value.map(|pid| pid as i64));

        let mut stmt = conn.prepare_cached(UPDATE_BUILD_SESSION_SQL)?;
        stmt.execute(params![
            updates.phase.is_some(),
            updates.phase.as_deref(),
            updates.resolved_cells.is_some(),
            updates.resolved_cells.as_deref(),
            updates.pending_question.is_some(),
            updates
                .pending_question
                .as_ref()
                .and_then(|value| value.as_deref()),
            updates.agent_ir.is_some(),
            updates.agent_ir.as_ref().and_then(|value| value.as_deref()),
            updates.adoption_answers.is_some(),
            updates
                .adoption_answers
                .as_ref()
                .and_then(|value| value.as_deref()),
            updates.error_message.is_some(),
            updates
                .error_message
                .as_ref()
                .and_then(|value| value.as_deref()),
            updates.cli_pid.is_some(),
            cli_pid.flatten(),
            updates.mode.is_some(),
            updates.mode.as_ref().and_then(|value| value.as_deref()),
            updates.companion_session_id.is_some(),
            updates
                .companion_session_id
                .as_ref()
                .and_then(|value| value.as_deref()),
            now,
            id,
        ])?;
        Ok(())
    })
}

/// List non-terminal build sessions, optionally filtered by persona_id.
pub fn list_non_terminal(
    pool: &DbPool,
    persona_id: Option<&str>,
) -> Result<Vec<BuildSession>, AppError> {
    timed_query!("build_sessions", "build_sessions::list_non_terminal", {
        let conn = pool.get()?;

        if let Some(pid) = persona_id {
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM build_sessions
                 WHERE persona_id = ?1 AND phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![pid], row_to_build_session)?;
            Ok(collect_rows(rows, "build_sessions::list_non_terminal"))
        } else {
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM build_sessions
                 WHERE phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], row_to_build_session)?;
            Ok(collect_rows(rows, "build_sessions::list_non_terminal"))
        }
    })
}

/// Delete a build session by ID.
pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::delete", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached("DELETE FROM build_sessions WHERE id = ?1")?;
        stmt.execute(params![id])?;
        Ok(())
    })
}
