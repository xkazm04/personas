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
        disabled_dims_json = CASE WHEN ?19 THEN ?20 ELSE disabled_dims_json END,
        total_cost_usd = CASE WHEN ?21 THEN ?22 ELSE total_cost_usd END,
        input_tokens = CASE WHEN ?23 THEN ?24 ELSE input_tokens END,
        output_tokens = CASE WHEN ?25 THEN ?26 ELSE output_tokens END,
        num_turns = CASE WHEN ?27 THEN ?28 ELSE num_turns END,
        updated_at = ?29
    WHERE id = ?30";

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
        disabled_dims_json: row.get("disabled_dims_json").unwrap_or(None),
        phase_timings_json: row.get("phase_timings_json").unwrap_or(None),
        total_cost_usd: row.get("total_cost_usd").unwrap_or(None),
        input_tokens: row.get("input_tokens").unwrap_or(None),
        output_tokens: row.get("output_tokens").unwrap_or(None),
        num_turns: row.get("num_turns").unwrap_or(None),
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
              parser_result_json, mode, companion_session_id, disabled_dims_json,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
            session.disabled_dims_json,
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
            updates.disabled_dims_json.is_some(),
            updates
                .disabled_dims_json
                .as_ref()
                .and_then(|value| value.as_deref()),
            updates.total_cost_usd.is_some(),
            updates.total_cost_usd.flatten(),
            updates.input_tokens.is_some(),
            updates.input_tokens.flatten(),
            updates.output_tokens.is_some(),
            updates.output_tokens.flatten(),
            updates.num_turns.is_some(),
            updates.num_turns.flatten(),
            now,
            id,
        ])?;
        Ok(())
    })
}

/// Append one `{phase, ts}` entry to the append-only `phase_timings_json`
/// ledger (build-orchestration Phase 0 telemetry). Uses `json_insert` at
/// `$[#]` so it is a single atomic UPDATE with no read-modify-write race;
/// `COALESCE(...,'[]')` seeds the array on the first call. `ts` is RFC3339.
pub fn append_phase_timing(
    pool: &DbPool,
    id: &str,
    phase: &str,
    ts: &str,
) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::append_phase_timing", {
        let conn = pool.get()?;
        let entry = serde_json::json!({ "phase": phase, "ts": ts }).to_string();
        let mut stmt = conn.prepare_cached(
            "UPDATE build_sessions
                SET phase_timings_json =
                    json_insert(COALESCE(phase_timings_json, '[]'), '$[#]', json(?1))
              WHERE id = ?2",
        )?;
        stmt.execute(params![entry, id])?;
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

/// Minimum age (hours since last update) before a non-terminal build session on
/// a non-draft persona is considered abandoned and swept to a terminal phase.
///
/// Conservative on purpose: an interactive build parked at `awaiting_input`
/// legitimately waits on the user, and a one-shot build's resolution turns can
/// span many minutes. 24h is far past any legal in-flight window, so a session
/// still non-terminal after it — on a persona that has already been promoted to
/// `active` (or later `archived`) — is genuinely stuck data, not live work.
pub const STALE_SESSION_MIN_AGE_HOURS: i64 = 24;

/// Reconcile stuck build sessions: transition any build session that is still in
/// a NON-terminal phase to `cancelled` when BOTH hold:
///   * its owning persona's lifecycle is NOT `draft` (i.e. `active`/`archived`,
///     or a legacy NULL which `COALESCE` treats as `active`) — the persona has
///     already been promoted/adopted, so its build session is orphaned data; and
///   * the session has had no activity for at least `min_age_hours`.
///
/// Real, promoted personas (e.g. GitHub Issue Sentinel, Tech News Brief) were
/// observed carrying build sessions parked forever at `draft_ready`/`testing`;
/// those ghosts resurface anywhere sessions are listed. This closes them at the
/// source.
///
/// `cancelled` is used deliberately: `BuildPhase::validate_transition` allows
/// EVERY non-terminal phase to move to `Cancelled` (the "any phase can
/// transition to Failed or Cancelled" rule), so this bulk sweep follows a legal
/// transition path for every row it touches — no bypass required. Reusing
/// `cancelled` (rather than a new `expired` phase) keeps the terminal set and
/// all existing `phase NOT IN (...terminal...)` filters unchanged.
///
/// NEVER touches: sessions of personas still `lifecycle = 'draft'` (a draft's
/// in-flight build IS live work), and sessions updated within `min_age_hours`.
/// Idempotent: once a row is `cancelled` it is terminal and no longer matches.
///
/// Returns the number of sessions swept.
pub fn expire_stale_non_terminal(
    pool: &DbPool,
    min_age_hours: i64,
) -> Result<usize, AppError> {
    timed_query!(
        "build_sessions",
        "build_sessions::expire_stale_non_terminal",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            // julianday() parses the RFC3339 timestamps this codebase stores
            // (same pattern as automation_runs::reap_stale_runs). The elapsed
            // hours = (julianday(now) - julianday(updated_at)) * 24.
            let changed = conn.execute(
                "UPDATE build_sessions
                 SET phase = 'cancelled',
                     error_message = COALESCE(
                         error_message,
                         'Auto-cancelled: build session left in a non-terminal phase on an active/archived persona with no activity for over 24h'
                     ),
                     updated_at = ?1
                 WHERE phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
                   AND (julianday(?1) - julianday(updated_at)) * 24.0 >= ?2
                   AND persona_id IN (
                       SELECT id FROM personas WHERE COALESCE(lifecycle, 'active') != 'draft'
                   )",
                params![now, min_age_hours],
            )?;
            Ok(changed)
        }
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, PersonaLifecycle};
    use crate::db::repos::core::personas;

    fn make_persona(pool: &DbPool, name: &str, lifecycle: Option<&str>) -> String {
        let input = CreatePersonaInput {
            name: name.into(),
            system_prompt: "A real, fully-built system prompt for this persona.".into(),
            project_id: None,
            description: None,
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            notification_channels: None,
            lifecycle: lifecycle.map(|s| s.to_string()),
        };
        personas::create(pool, input).unwrap().id
    }

    fn insert_session(
        pool: &DbPool,
        persona_id: &str,
        phase: BuildPhase,
        updated_at: &str,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let session = BuildSession {
            id: id.clone(),
            persona_id: persona_id.to_string(),
            phase,
            resolved_cells: "{}".into(),
            pending_question: None,
            agent_ir: None,
            adoption_answers: None,
            intent: "test intent".into(),
            error_message: None,
            cli_pid: None,
            workflow_json: None,
            parser_result_json: None,
            mode: Some("interactive".into()),
            companion_session_id: None,
            disabled_dims_json: None,
            phase_timings_json: None,
            total_cost_usd: None,
            input_tokens: None,
            output_tokens: None,
            num_turns: None,
            created_at: updated_at.to_string(),
            updated_at: updated_at.to_string(),
        };
        create(pool, &session).unwrap();
        // `create` does not stamp updated_at from the struct's own field via the
        // UPDATE path, but the INSERT above uses the struct value directly, so
        // the row carries `updated_at`. Confirm.
        assert_eq!(
            get_by_id(pool, &id).unwrap().unwrap().updated_at,
            updated_at
        );
        id
    }

    fn hours_ago(h: i64) -> String {
        (chrono::Utc::now() - chrono::Duration::hours(h)).to_rfc3339()
    }

    #[test]
    fn sweeps_stuck_session_on_promoted_persona() {
        let pool = init_test_db().unwrap();
        // Promoted (active) persona with a session parked at draft_ready 48h ago.
        let persona_id = make_persona(&pool, "Promoted Sentinel", None);
        assert_eq!(personas::get_by_id(&pool, &persona_id).unwrap().lifecycle, "active");
        let sid = insert_session(&pool, &persona_id, BuildPhase::DraftReady, &hours_ago(48));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 1, "the stuck session on a promoted persona must be swept");

        let after = get_by_id(&pool, &sid).unwrap().unwrap();
        assert_eq!(after.phase, BuildPhase::Cancelled);
        assert!(after.error_message.is_some());

        // Idempotent: a second sweep is a no-op.
        assert_eq!(expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap(), 0);
    }

    #[test]
    fn never_sweeps_draft_lifecycle_persona() {
        let pool = init_test_db().unwrap();
        // Draft persona: its in-flight build is live work — must be left alone
        // even when old.
        let persona_id = make_persona(&pool, "Still Drafting", Some("draft"));
        let sid = insert_session(&pool, &persona_id, BuildPhase::DraftReady, &hours_ago(72));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 0, "draft-lifecycle personas must never be swept");
        assert_eq!(get_by_id(&pool, &sid).unwrap().unwrap().phase, BuildPhase::DraftReady);
    }

    #[test]
    fn never_sweeps_recent_session() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Fresh Build", None);
        // Updated 1h ago — inside the conservative window.
        let sid = insert_session(&pool, &persona_id, BuildPhase::Testing, &hours_ago(1));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 0, "recently-active sessions must never be swept");
        assert_eq!(get_by_id(&pool, &sid).unwrap().unwrap().phase, BuildPhase::Testing);
    }

    #[test]
    fn leaves_terminal_sessions_untouched() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Done", None);
        // Already promoted/terminal, old — not a candidate.
        let sid = insert_session(&pool, &persona_id, BuildPhase::Promoted, &hours_ago(96));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 0);
        assert_eq!(get_by_id(&pool, &sid).unwrap().unwrap().phase, BuildPhase::Promoted);
    }

    #[test]
    fn sweeps_archived_persona_session() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Archived One", None);
        personas::set_lifecycle(&pool, &persona_id, PersonaLifecycle::Archived).unwrap();
        let sid = insert_session(&pool, &persona_id, BuildPhase::Resolving, &hours_ago(30));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 1, "archived personas' stuck sessions are swept too");
        assert_eq!(get_by_id(&pool, &sid).unwrap().unwrap().phase, BuildPhase::Cancelled);
    }
}
