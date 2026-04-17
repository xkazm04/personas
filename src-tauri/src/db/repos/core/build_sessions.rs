use rusqlite::{params, Row};

use crate::db::models::{BuildPhase, BuildSession, UpdateBuildSession};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

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
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Insert a new build session.
pub fn create(pool: &DbPool, session: &BuildSession) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::create", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO build_sessions
             (id, persona_id, phase, resolved_cells, pending_question, agent_ir,
              adoption_answers, intent, error_message, cli_pid, workflow_json,
              parser_result_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
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
                session.created_at,
                session.updated_at,
            ],
        )?;
        Ok(())
    })
}

/// Get a build session by ID.
pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Option<BuildSession>, AppError> {
    timed_query!("build_sessions", "build_sessions::get_by_id", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT * FROM build_sessions WHERE id = ?1",
            params![id],
            row_to_build_session,
        );
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
    timed_query!("build_sessions", "build_sessions::get_active_for_persona", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT * FROM build_sessions
             WHERE persona_id = ?1 AND phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
             ORDER BY updated_at DESC LIMIT 1",
            params![persona_id],
            row_to_build_session,
        );
        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Get the most recent build session for a persona, regardless of phase.
/// Used by MatrixTab to retrieve resolved_cells even after promotion.
pub fn get_latest_for_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<BuildSession>, AppError> {
    timed_query!("build_sessions", "build_sessions::get_latest_for_persona", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT * FROM build_sessions
             WHERE persona_id = ?1
             ORDER BY updated_at DESC LIMIT 1",
            params![persona_id],
            row_to_build_session,
        );
        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Update a build session with only the provided (non-None) fields.
/// Always updates `updated_at`.
pub fn update(pool: &DbPool, id: &str, updates: &UpdateBuildSession) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::update", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();

        let mut set_clauses: Vec<String> = Vec::new();
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref phase) = updates.phase {
            set_clauses.push(format!("phase = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(phase.clone()));
        }
        if let Some(ref resolved_cells) = updates.resolved_cells {
            set_clauses.push(format!("resolved_cells = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(resolved_cells.clone()));
        }
        if let Some(ref pending_question) = updates.pending_question {
            set_clauses.push(format!("pending_question = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(pending_question.clone()));
        }
        if let Some(ref agent_ir) = updates.agent_ir {
            set_clauses.push(format!("agent_ir = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(agent_ir.clone()));
        }
        if let Some(ref adoption_answers) = updates.adoption_answers {
            set_clauses.push(format!("adoption_answers = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(adoption_answers.clone()));
        }
        if let Some(ref error_message) = updates.error_message {
            set_clauses.push(format!("error_message = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(error_message.clone()));
        }
        if let Some(ref cli_pid) = updates.cli_pid {
            set_clauses.push(format!("cli_pid = ?{}", set_clauses.len() + 1));
            param_values.push(Box::new(cli_pid.map(|p| p as i64)));
        }

        // Always update updated_at
        set_clauses.push(format!("updated_at = ?{}", set_clauses.len() + 1));
        param_values.push(Box::new(now));

        // Add the id parameter
        let id_param_idx = set_clauses.len() + 1;
        param_values.push(Box::new(id.to_string()));

        let sql = format!(
            "UPDATE build_sessions SET {} WHERE id = ?{}",
            set_clauses.join(", "),
            id_param_idx,
        );

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        conn.execute(&sql, params_ref.as_slice())?;
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
            let mut stmt = conn.prepare(
                "SELECT * FROM build_sessions
                 WHERE persona_id = ?1 AND phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![pid], row_to_build_session)?;
            Ok(collect_rows(rows, "build_sessions::list_non_terminal"))
        } else {
            let mut stmt = conn.prepare(
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
        conn.execute("DELETE FROM build_sessions WHERE id = ?1", params![id])?;
        Ok(())
    })
}
