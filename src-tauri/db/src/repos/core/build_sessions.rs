use rusqlite::{params, Row};

use crate::models::{BuildPhase, BuildSession, UpdateBuildSession};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

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
        let conn = pool.conn("build_sessions::create")?;
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
        let conn = pool.conn("build_sessions::get_by_id")?;
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
            let conn = pool.conn("build_sessions::get_active_for_persona")?;
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
            let conn = pool.conn("build_sessions::get_latest_for_persona")?;
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
        let conn = pool.conn("build_sessions::update")?;
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
pub fn append_phase_timing(pool: &DbPool, id: &str, phase: &str, ts: &str) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::append_phase_timing", {
        let conn = pool.conn("build_sessions::append_phase_timing")?;
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
        let conn = pool.conn("build_sessions::list_non_terminal")?;

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

/// Minimum age (hours since last update) before a non-terminal build session is
/// considered abandoned and swept to a terminal phase.
///
/// Conservative on purpose: an interactive build parked at `awaiting_input`
/// legitimately waits on the user, and a one-shot build's resolution turns can
/// span many minutes. 24h is far past any legal in-flight window, so a session
/// still non-terminal after it is genuinely stuck data, not live work. **The
/// floor is the whole protection and it is deliberately NOT lowered** — see
/// `expire_stale_non_terminal` for why it now also covers draft personas.
pub const STALE_SESSION_MIN_AGE_HOURS: i64 = 24;

/// Reconcile stuck build sessions: transition any build session still in a
/// NON-terminal phase to `cancelled` once it has had no activity for at least
/// `min_age_hours`.
///
/// # Why this no longer excludes draft personas
///
/// The original sweep (986aa32e4, "GC stuck non-terminal build sessions on
/// promoted personas") additionally required
/// `COALESCE(lifecycle,'active') != 'draft'`. Its recorded rationale was pure
/// conservatism — "a draft's in-flight build IS live work" — not a dependency
/// on any other cleanup path. Two facts make it wrong rather than merely
/// cautious:
///
///   * *Every* from-scratch build runs on a persona that is still `draft`, so
///     the exclusion skipped exactly the population the sweep exists for. Since
///     nothing resumes an in-memory build session after a restart, a crashed
///     draft build stayed non-terminal forever and `get_active_for_persona`
///     kept handing it back, so the persona looked permanently mid-build.
///   * Draft personas are NOT reliably deleted (with their sessions) by another
///     path: `personas::sweep_stale_drafts` is gated on the
///     `draft_retention_days` setting whose default is `0`
///     (`settings_keys::DRAFT_RETENTION_DAYS_DEFAULT`), i.e. off, and even when
///     enabled it refuses any draft that has executions.
///
/// The live-work protection therefore rests entirely on the age floor, which is
/// KEPT at `STALE_SESSION_MIN_AGE_HOURS` (24h) unchanged: an interactive build
/// awaiting a human answer is still safe for a full day of inactivity, which is
/// far beyond any legal in-flight window. Only the lifecycle predicate is
/// dropped.
///
/// `cancelled` is used deliberately: `BuildPhase::validate_transition` allows
/// EVERY non-terminal phase to move to `Cancelled` (the "any phase can
/// transition to Failed or Cancelled" rule), so this bulk sweep follows a legal
/// transition path for every row it touches — no bypass required. Reusing
/// `cancelled` (rather than a new `expired` phase) keeps the terminal set and
/// all existing `phase NOT IN (...terminal...)` filters unchanged, which is
/// also what makes `get_active_for_persona` stop returning a swept session.
///
/// The reason is written to `error_message` (only when the row has none, so a
/// real failure reason is never overwritten) and names the sweeper, because the
/// frontend surfaces that column verbatim as the session error
/// (`matrixBuildSlice.ts` -> `error: session.errorMessage`).
///
/// NEVER touches: sessions updated within `min_age_hours`, and rows already in
/// a terminal phase. Idempotent: once a row is `cancelled` it is terminal and
/// no longer matches.
///
/// Returns the number of sessions swept.
pub fn expire_stale_non_terminal(pool: &DbPool, min_age_hours: i64) -> Result<usize, AppError> {
    timed_query!(
        "build_sessions",
        "build_sessions::expire_stale_non_terminal",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.conn("build_sessions::expire_stale_non_terminal")?;
            // julianday() parses the RFC3339 timestamps this codebase stores
            // (same pattern as automation_runs::reap_stale_runs). The elapsed
            // hours = (julianday(now) - julianday(updated_at)) * 24.
            let reason = format!(
                "Auto-cancelled by the stuck build-session sweeper: no activity for over {min_age_hours}h. Start a new build to continue."
            );
            let changed = conn.execute(
                "UPDATE build_sessions
                 SET phase = 'cancelled',
                     error_message = COALESCE(error_message, ?3),
                     updated_at = ?1
                 WHERE phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
                   AND (julianday(?1) - julianday(updated_at)) * 24.0 >= ?2",
                params![now, min_age_hours, reason],
            )?;
            Ok(changed)
        }
    )
}

// =============================================================================
// Ownership + restart recovery
// =============================================================================
//
// A build session is run by exactly ONE process: the tokio task that
// `BuildSessionManager::start_session` spawned. Its state lives in this row,
// but its progress lives in that task — nothing resumes an in-memory session
// after the process dies, so before this section a restart left every
// in-flight build parked in `analyzing` (or wherever it was) until the 24h
// sweeper above cancelled it. A kp hire's status poll read `approved` /
// `analyzing` for that whole day (2026-09-25: two gig hires orphaned by a
// restart of another session's instance).
//
// Ownership is a claim + heartbeat on the row, using the two columns
// migration e07 added for exactly this and nothing had written yet:
// `claimed_by_instance` (the running process's owner id) and
// `claim_expires_at` (refreshed every `BUILD_CLAIM_HEARTBEAT_SECS` while the
// runner task is alive). The engine-leader lease is deliberately NOT the
// signal: a follower instance runs its own builds in-process, so "who leads"
// says nothing about "who is running this session".

/// How long a claim stays valid without a heartbeat. Six heartbeats: a busy
/// runtime that misses a few ticks is still the owner.
pub const BUILD_CLAIM_TTL_SECS: i64 = 180;

/// How often the runner task refreshes its claim.
pub const BUILD_CLAIM_HEARTBEAT_SECS: u64 = 30;

/// A non-terminal row with NO claim was written by a build that predates the
/// claim, or by an instance still running older code. It is treated as
/// orphaned only once it has been silent this long: the runner writes the row
/// at least once per turn, a turn is bounded by the 10-minute CLI silence
/// watchdog, and the longest healthy turn observed is ~15 minutes, so an hour
/// without a write is not a live build.
pub const LEGACY_UNCLAIMED_GRACE_SECS: i64 = 60 * 60;

/// Automatic resumes a session gets after a restart. One: a build that dies
/// with the process twice is not retried a third time, so a crash loop
/// cannot keep buying design passes.
pub const MAX_RESTART_RESUMES: usize = 1;

/// An orphan is resumed only if its last write is this recent. Past it the
/// requester has stopped waiting (kp's poller and bench driver give a hire
/// minutes, not hours), and a rebuild would spend a design pass on a persona
/// nobody is waiting for and that a rehire has likely replaced, so it is
/// failed instead.
pub const RESUME_WINDOW_SECS: i64 = 2 * 60 * 60;

/// Stable prefix of the failure reason a restart leaves on a session it could
/// not (or would no longer) resume. kp's status poll surfaces it verbatim as
/// `buildFailureReason`.
pub const INTERRUPTED_BY_RESTART: &str = "interrupted_by_restart";

/// The `phase_timings_json` entry that records an automatic resume. The
/// append-only phase ledger is the session's own history, so the retry is
/// recorded where the session's other phase changes are.
pub const RESUMED_AFTER_RESTART_PHASE: &str = "resumed_after_restart";

/// Phases in which an INTERACTIVE session has a process working on it. The
/// others (`awaiting_input`, `draft_ready`, `test_complete`) are held by a
/// human, and a restart does not change what they are waiting for.
const INTERACTIVE_WORKING_PHASES: &[&str] = &["initializing", "analyzing", "resolving", "testing"];

/// SQL predicate: this non-terminal row has no live owner as of `?now`
/// (RFC 3339). `?legacy_secs` is [`LEGACY_UNCLAIMED_GRACE_SECS`].
const ORPHAN_PREDICATE: &str = "phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')
       AND (
            (claimed_by_instance IS NOT NULL
             AND (claim_expires_at IS NULL OR julianday(claim_expires_at) < julianday(:now)))
         OR (claimed_by_instance IS NULL
             AND julianday(updated_at) < julianday(:now) - (:legacy_secs / 86400.0))
       )";

fn claim_expiry(now: chrono::DateTime<chrono::Utc>, ttl_secs: i64) -> String {
    (now + chrono::Duration::seconds(ttl_secs)).to_rfc3339()
}

/// Stamp this process as the owner of a session it is about to run.
pub fn claim(pool: &DbPool, id: &str, owner: &str, ttl_secs: i64) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::claim", {
        let conn = pool.conn("build_sessions::claim")?;
        conn.execute(
            "UPDATE build_sessions SET claimed_by_instance = ?2, claim_expires_at = ?3 WHERE id = ?1",
            params![id, owner, claim_expiry(chrono::Utc::now(), ttl_secs)],
        )?;
        Ok(())
    })
}

/// Refresh this process's claim on a session it is still running. Returns
/// `false` when the row is terminal or owned by someone else (nothing to
/// refresh) — never an error the runner has to act on.
pub fn heartbeat(pool: &DbPool, id: &str, owner: &str, ttl_secs: i64) -> Result<bool, AppError> {
    timed_query!("build_sessions", "build_sessions::heartbeat", {
        let conn = pool.conn("build_sessions::heartbeat")?;
        let changed = conn.execute(
            "UPDATE build_sessions SET claim_expires_at = ?3
             WHERE id = ?1 AND claimed_by_instance = ?2
               AND phase NOT IN ('completed', 'failed', 'cancelled', 'promoted')",
            params![id, owner, claim_expiry(chrono::Utc::now(), ttl_secs)],
        )?;
        Ok(changed > 0)
    })
}

/// How many automatic resumes this session's phase ledger records.
pub fn restart_resumes(session: &BuildSession) -> usize {
    session
        .phase_timings_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| v.as_array().cloned())
        .map(|entries| {
            entries
                .iter()
                .filter(|e| {
                    e.get("phase").and_then(|p| p.as_str()) == Some(RESUMED_AFTER_RESTART_PHASE)
                })
                .count()
        })
        .unwrap_or(0)
}

/// What restart recovery did with one orphaned session.
#[derive(Debug, Clone)]
pub enum OrphanOutcome {
    /// Reset to `initializing`, claimed by the recovering process, and
    /// recorded as a resume. The caller must now run it — the row carries the
    /// persisted intent and inputs, re-read AFTER the reset.
    Resumed(Box<BuildSession>),
    /// Failed with an [`INTERRUPTED_BY_RESTART`] reason.
    Failed { id: String, reason: String },
}

/// Settle every build session a dead process left in flight.
///
/// A session is an orphan when it is non-terminal and has no live owner (see
/// [`ORPHAN_PREDICATE`]); interactive sessions count only in phases where a
/// process was working. Each orphan is either **resumed** — when
/// `resumable(session)` says its inputs can be rebuilt from the row and it has
/// not already used its [`MAX_RESTART_RESUMES`] — or **failed** with an
/// `interrupted_by_restart` reason. Both writes are compare-and-set on the
/// orphan predicate, so two instances booting together settle each row once,
/// and a session a live instance claimed in between is left alone.
pub fn recover_orphans(
    pool: &DbPool,
    owner: &str,
    now: chrono::DateTime<chrono::Utc>,
    resumable: &dyn Fn(&BuildSession) -> bool,
) -> Result<Vec<OrphanOutcome>, AppError> {
    timed_query!("build_sessions", "build_sessions::recover_orphans", {
        let now_s = now.to_rfc3339();
        let candidates: Vec<BuildSession> = {
            let conn = pool.conn("build_sessions::recover_orphans")?;
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM build_sessions WHERE {ORPHAN_PREDICATE} ORDER BY created_at"
            ))?;
            let rows = stmt.query_map(
                rusqlite::named_params! {
                    ":now": now_s,
                    ":legacy_secs": LEGACY_UNCLAIMED_GRACE_SECS,
                },
                row_to_build_session,
            )?;
            collect_rows(rows, "build_sessions::recover_orphans")
        };

        let mut out = Vec::new();
        for session in candidates {
            let one_shot = session.mode.as_deref() == Some("one_shot");
            if !one_shot && !INTERACTIVE_WORKING_PHASES.contains(&session.phase.as_str()) {
                continue;
            }
            let prior = restart_resumes(&session);
            let recent = chrono::DateTime::parse_from_rfc3339(&session.updated_at)
                .map(|t| (now - t.with_timezone(&chrono::Utc)).num_seconds() <= RESUME_WINDOW_SECS)
                .unwrap_or(false);
            let can_resume = resumable(&session);
            let resume = recent && prior < MAX_RESTART_RESUMES && can_resume;
            let conn = pool.conn("build_sessions::recover_orphans")?;
            if resume {
                let mark = serde_json::json!({
                    "phase": RESUMED_AFTER_RESTART_PHASE,
                    "ts": now_s,
                    "from_phase": session.phase.as_str(),
                })
                .to_string();
                let changed = conn.execute(
                    &format!(
                        "UPDATE build_sessions SET
                            phase = 'initializing',
                            resolved_cells = '{{}}',
                            pending_question = NULL,
                            agent_ir = NULL,
                            error_message = NULL,
                            cli_pid = NULL,
                            claimed_by_instance = :owner,
                            claim_expires_at = :expires,
                            phase_timings_json =
                                json_insert(COALESCE(phase_timings_json, '[]'), '$[#]', json(:mark)),
                            updated_at = :now
                         WHERE id = :id AND {ORPHAN_PREDICATE}"
                    ),
                    rusqlite::named_params! {
                        ":owner": owner,
                        ":expires": claim_expiry(now, BUILD_CLAIM_TTL_SECS),
                        ":mark": mark,
                        ":now": now_s,
                        ":id": session.id,
                        ":legacy_secs": LEGACY_UNCLAIMED_GRACE_SECS,
                    },
                )?;
                drop(conn);
                if changed == 1 {
                    if let Some(fresh) = get_by_id(pool, &session.id)? {
                        out.push(OrphanOutcome::Resumed(Box::new(fresh)));
                    }
                }
            } else {
                let reason = if prior >= MAX_RESTART_RESUMES {
                    format!(
                        "{INTERRUPTED_BY_RESTART}: the app restarted while this build was in `{}`, \
                         and it had already been resumed once after an earlier restart. Start the \
                         build again.",
                        session.phase.as_str()
                    )
                } else if can_resume && !recent {
                    format!(
                        "{INTERRUPTED_BY_RESTART}: the app restarted while this build was in `{}`, \
                         more than {} hours before it could be resumed, so it was not rebuilt. \
                         Start the build again.",
                        session.phase.as_str(),
                        RESUME_WINDOW_SECS / 3600
                    )
                } else {
                    format!(
                        "{INTERRUPTED_BY_RESTART}: the app restarted while this build was in `{}`. \
                         It could not be resumed automatically; start the build again.",
                        session.phase.as_str()
                    )
                };
                let changed = conn.execute(
                    &format!(
                        "UPDATE build_sessions SET
                            phase = 'failed',
                            error_message = :reason,
                            claimed_by_instance = NULL,
                            claim_expires_at = NULL,
                            updated_at = :now
                         WHERE id = :id AND {ORPHAN_PREDICATE}"
                    ),
                    rusqlite::named_params! {
                        ":reason": reason,
                        ":now": now_s,
                        ":id": session.id,
                        ":legacy_secs": LEGACY_UNCLAIMED_GRACE_SECS,
                    },
                )?;
                if changed == 1 {
                    out.push(OrphanOutcome::Failed {
                        id: session.id.clone(),
                        reason,
                    });
                }
            }
        }
        Ok(out)
    })
}

/// Run the promote write set inside ONE transaction, committing when `f`
/// returns `Ok` and rolling back when it returns `Err`.
///
/// Promotion is the app's widest single write — tools, triggers, event
/// subscriptions, output assertions, the persona row, a prompt-version
/// snapshot and the session's own phase flip all have to land together or not
/// at all. That makes it the one place a caller genuinely needs a
/// `&Transaction`, and this is where it gets one: the **pool checkout and the
/// transaction lifetime live in the layer that owns persistence**, so the
/// command module never holds a `PooledConnection` and cannot keep one alive
/// past the commit while the post-commit steps ask the pool for another
/// (which is exactly what the hand-rolled `state.db.get()` in
/// `commands::design::build_sessions` did, for ~270 lines).
///
/// `Immediate`, not the default deferred behaviour: the snapshot step reads
/// `MAX(version_number)` and then inserts against it, and a deferred
/// transaction that upgrades to a write fails `SQLITE_BUSY_SNAPSHOT`
/// immediately, ignoring `busy_timeout`.
///
/// Deliberately NOT a general `pool.write_tx(..)` primitive: this repo's
/// standing lesson is that primitives built ahead of their callers rot
/// (`run_lanes`, 0 callers; `acquire_logged`, `#[allow(dead_code)]`). It is
/// named for the one write it serves, in the module that owns the table that
/// write finishes on.
pub fn with_promote_tx<T>(
    pool: &DbPool,
    f: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    timed_query!("build_sessions", "build_sessions::with_promote_tx", {
        let mut conn = pool.conn("build_sessions::promote")?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::Database)?;
        let out = f(&tx)?;
        tx.commit().map_err(AppError::Database)?;
        Ok(out)
    })
}

/// Delete a build session by ID.
pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("build_sessions", "build_sessions::delete", {
        let conn = pool.conn("build_sessions::delete")?;
        let mut stmt = conn.prepare_cached("DELETE FROM build_sessions WHERE id = ?1")?;
        stmt.execute(params![id])?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::{CreatePersonaInput, PersonaLifecycle};
    use crate::repos::core::personas;

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
        assert_eq!(
            personas::get_by_id(&pool, &persona_id).unwrap().lifecycle,
            "active"
        );
        let sid = insert_session(&pool, &persona_id, BuildPhase::DraftReady, &hours_ago(48));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(
            swept, 1,
            "the stuck session on a promoted persona must be swept"
        );

        let after = get_by_id(&pool, &sid).unwrap().unwrap();
        assert_eq!(after.phase, BuildPhase::Cancelled);
        assert!(after.error_message.is_some());

        // Idempotent: a second sweep is a no-op.
        assert_eq!(
            expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap(),
            0
        );
    }

    #[test]
    fn sweeps_crashed_build_on_draft_persona() {
        let pool = init_test_db().unwrap();
        // Every from-scratch build runs on a `draft` persona. Nothing resumes an
        // in-memory build session after a restart, so a crashed draft build is
        // stuck data once it is past the age floor — the case the sweep used to
        // be the only one to skip.
        let persona_id = make_persona(&pool, "Still Drafting", Some("draft"));
        let sid = insert_session(&pool, &persona_id, BuildPhase::DraftReady, &hours_ago(72));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(
            swept, 1,
            "a crashed draft build must be swept after the floor"
        );

        let after = get_by_id(&pool, &sid).unwrap().unwrap();
        assert_eq!(after.phase, BuildPhase::Cancelled);
        let reason = after.error_message.expect("swept row carries a reason");
        assert!(
            reason.contains("sweeper"),
            "the reason must name the sweeper, got: {reason}"
        );
    }

    #[test]
    fn never_sweeps_recent_draft_persona_session() {
        let pool = init_test_db().unwrap();
        // The age floor is the ONLY live-work protection now, so it has to hold
        // for a draft persona's genuinely in-flight build.
        let persona_id = make_persona(&pool, "Actively Drafting", Some("draft"));
        let sid = insert_session(&pool, &persona_id, BuildPhase::AwaitingInput, &hours_ago(2));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 0, "a live draft build inside the floor is untouched");
        assert_eq!(
            get_by_id(&pool, &sid).unwrap().unwrap().phase,
            BuildPhase::AwaitingInput
        );
    }

    #[test]
    fn swept_session_is_no_longer_active_for_persona() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Haunted Draft", Some("draft"));
        let sid = insert_session(&pool, &persona_id, BuildPhase::Resolving, &hours_ago(48));

        assert_eq!(
            get_active_for_persona(&pool, &persona_id)
                .unwrap()
                .map(|s| s.id),
            Some(sid),
            "precondition: the crashed session haunts the persona"
        );

        expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();

        assert!(
            get_active_for_persona(&pool, &persona_id)
                .unwrap()
                .is_none(),
            "a swept session must not come back as the persona's active build"
        );
    }

    #[test]
    fn never_sweeps_recent_session() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Fresh Build", None);
        // Updated 1h ago — inside the conservative window.
        let sid = insert_session(&pool, &persona_id, BuildPhase::Testing, &hours_ago(1));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 0, "recently-active sessions must never be swept");
        assert_eq!(
            get_by_id(&pool, &sid).unwrap().unwrap().phase,
            BuildPhase::Testing
        );
    }

    #[test]
    fn leaves_terminal_sessions_untouched() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Done", None);
        // Already promoted/terminal, old — not a candidate.
        let sid = insert_session(&pool, &persona_id, BuildPhase::Promoted, &hours_ago(96));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 0);
        assert_eq!(
            get_by_id(&pool, &sid).unwrap().unwrap().phase,
            BuildPhase::Promoted
        );
    }

    #[test]
    fn sweeps_archived_persona_session() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Archived One", None);
        personas::set_lifecycle(&pool, &persona_id, PersonaLifecycle::Archived).unwrap();
        let sid = insert_session(&pool, &persona_id, BuildPhase::Resolving, &hours_ago(30));

        let swept = expire_stale_non_terminal(&pool, STALE_SESSION_MIN_AGE_HOURS).unwrap();
        assert_eq!(swept, 1, "archived personas' stuck sessions are swept too");
        assert_eq!(
            get_by_id(&pool, &sid).unwrap().unwrap().phase,
            BuildPhase::Cancelled
        );
    }

    // ---- restart recovery ---------------------------------------------------

    fn one_shot_session(pool: &DbPool, persona_id: &str, phase: BuildPhase) -> String {
        let sid = insert_session(pool, persona_id, phase, &hours_ago(0));
        pool.get()
            .unwrap()
            .execute(
                "UPDATE build_sessions SET mode = 'one_shot' WHERE id = ?1",
                params![sid],
            )
            .unwrap();
        sid
    }

    fn set_claim(pool: &DbPool, sid: &str, owner: Option<&str>, expires: Option<String>) {
        pool.get()
            .unwrap()
            .execute(
                "UPDATE build_sessions SET claimed_by_instance = ?2, claim_expires_at = ?3 WHERE id = ?1",
                params![sid, owner, expires],
            )
            .unwrap();
    }

    fn secs_from_now(s: i64) -> String {
        (chrono::Utc::now() + chrono::Duration::seconds(s)).to_rfc3339()
    }

    fn always(_: &BuildSession) -> bool {
        true
    }

    fn never(_: &BuildSession) -> bool {
        false
    }

    /// The process that ran it is gone (claim expired): resumed once, in
    /// place, claimed by the recovering process, recorded in the ledger.
    #[test]
    fn an_orphaned_one_shot_session_is_resumed_once_in_place() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Hire", Some("draft"));
        let sid = one_shot_session(&pool, &persona_id, BuildPhase::Analyzing);
        set_claim(&pool, &sid, Some("dead-process"), Some(secs_from_now(-60)));

        let out = recover_orphans(&pool, "me", chrono::Utc::now(), &always).unwrap();
        assert_eq!(out.len(), 1);
        let OrphanOutcome::Resumed(s) = &out[0] else {
            panic!("expected a resume, got {out:?}")
        };
        assert_eq!(
            s.id, sid,
            "resumed IN PLACE: kp's stamped buildSessionId still points at it"
        );
        assert_eq!(s.phase, BuildPhase::Initializing);
        assert_eq!(
            s.intent, "test intent",
            "the persisted intent is what reruns"
        );
        assert_eq!(restart_resumes(s), 1);
        let owner: Option<String> = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT claimed_by_instance FROM build_sessions WHERE id = ?1",
                params![sid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(owner.as_deref(), Some("me"));
    }

    /// The resumed attempt dies with the process too: the second restart
    /// fails it with the reason, it does NOT resume again.
    #[test]
    fn a_second_restart_does_not_resume_again() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Hire", Some("draft"));
        let sid = one_shot_session(&pool, &persona_id, BuildPhase::Analyzing);
        set_claim(&pool, &sid, Some("dead-1"), Some(secs_from_now(-60)));
        recover_orphans(&pool, "boot-2", chrono::Utc::now(), &always).unwrap();
        // boot-2 dies mid-resume; its claim expires.
        set_claim(&pool, &sid, Some("boot-2"), Some(secs_from_now(-1)));

        let out = recover_orphans(&pool, "boot-3", chrono::Utc::now(), &always).unwrap();
        assert!(
            matches!(&out[..], [OrphanOutcome::Failed { .. }]),
            "{out:?}"
        );
        let s = get_by_id(&pool, &sid).unwrap().unwrap();
        assert_eq!(s.phase, BuildPhase::Failed);
        let reason = s.error_message.clone().unwrap();
        assert!(reason.starts_with("interrupted_by_restart:"), "{reason}");
        assert!(reason.contains("already been resumed once"), "{reason}");
        assert_eq!(restart_resumes(&s), 1, "no second resume was recorded");
        // A third boot finds nothing: failed is terminal.
        assert!(
            recover_orphans(&pool, "boot-4", chrono::Utc::now(), &always)
                .unwrap()
                .is_empty()
        );
    }

    /// A session a LIVE instance owns (fresh claim) is never touched, even by
    /// a recovering process that could resume it.
    #[test]
    fn a_session_owned_by_a_live_instance_is_left_alone() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Hire", Some("draft"));
        let sid = one_shot_session(&pool, &persona_id, BuildPhase::Analyzing);
        set_claim(&pool, &sid, Some("live-other"), Some(secs_from_now(120)));
        // A legacy (unclaimed) row written moments ago is also presumed live.
        let fresh_legacy = one_shot_session(&pool, &persona_id, BuildPhase::Resolving);

        let out = recover_orphans(&pool, "me", chrono::Utc::now(), &always).unwrap();
        assert!(out.is_empty(), "{out:?}");
        assert_eq!(
            get_by_id(&pool, &sid).unwrap().unwrap().phase,
            BuildPhase::Analyzing
        );
        assert_eq!(
            get_by_id(&pool, &fresh_legacy).unwrap().unwrap().phase,
            BuildPhase::Resolving
        );
        // Its owner's heartbeat still lands; nobody else's does.
        assert!(heartbeat(&pool, &sid, "live-other", BUILD_CLAIM_TTL_SECS).unwrap());
        assert!(!heartbeat(&pool, &sid, "me", BUILD_CLAIM_TTL_SECS).unwrap());
    }

    /// Completed/promoted/failed/cancelled sessions are untouched, whatever
    /// their claim says.
    #[test]
    fn a_terminal_session_is_untouched() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Hire", Some("draft"));
        let mut ids = Vec::new();
        for phase in [
            BuildPhase::Completed,
            BuildPhase::Promoted,
            BuildPhase::Failed,
            BuildPhase::Cancelled,
        ] {
            let sid = one_shot_session(&pool, &persona_id, phase);
            set_claim(&pool, &sid, Some("dead"), Some(secs_from_now(-600)));
            ids.push((sid, phase));
        }
        assert!(recover_orphans(&pool, "me", chrono::Utc::now(), &always)
            .unwrap()
            .is_empty());
        for (sid, phase) in ids {
            let s = get_by_id(&pool, &sid).unwrap().unwrap();
            assert_eq!(s.phase, phase);
            assert!(s.error_message.is_none());
        }
    }

    /// An unclaimed row (a build that predates the claim, like the
    /// 2026-09-25 orphans) is an orphan once it has been silent past the
    /// grace. Not resumable, so it is failed with the reason kp's poller
    /// surfaces.
    #[test]
    fn a_silent_unclaimed_session_is_failed_when_it_cannot_resume() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Hire", Some("draft"));
        let sid = insert_session(&pool, &persona_id, BuildPhase::Analyzing, &hours_ago(2));
        pool.get()
            .unwrap()
            .execute(
                "UPDATE build_sessions SET mode = 'one_shot' WHERE id = ?1",
                params![sid],
            )
            .unwrap();

        let out = recover_orphans(&pool, "me", chrono::Utc::now(), &never).unwrap();
        assert!(
            matches!(&out[..], [OrphanOutcome::Failed { .. }]),
            "{out:?}"
        );
        let s = get_by_id(&pool, &sid).unwrap().unwrap();
        assert_eq!(s.phase, BuildPhase::Failed);
        assert!(s.error_message.unwrap().starts_with(
            "interrupted_by_restart: the app restarted while this build was in `analyzing`"
        ));
    }

    /// A resumable orphan whose last write is older than the resume window is
    /// failed, not rebuilt: nobody is still waiting for it.
    #[test]
    fn a_resumable_orphan_past_the_window_is_failed_not_rebuilt() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Hire", Some("draft"));
        let sid = insert_session(&pool, &persona_id, BuildPhase::Analyzing, &hours_ago(3));
        pool.get()
            .unwrap()
            .execute(
                "UPDATE build_sessions SET mode = 'one_shot' WHERE id = ?1",
                params![sid],
            )
            .unwrap();

        let out = recover_orphans(&pool, "me", chrono::Utc::now(), &always).unwrap();
        assert!(
            matches!(&out[..], [OrphanOutcome::Failed { .. }]),
            "{out:?}"
        );
        let s = get_by_id(&pool, &sid).unwrap().unwrap();
        assert_eq!(s.phase, BuildPhase::Failed);
        assert!(s
            .error_message
            .clone()
            .unwrap()
            .contains("more than 2 hours"));
        assert_eq!(restart_resumes(&s), 0);
    }

    /// An interactive session parked on a human (`awaiting_input`,
    /// `draft_ready`, `test_complete`) is not in flight; a restart leaves it.
    /// One that was mid-analysis is failed truthfully.
    #[test]
    fn interactive_sessions_are_recovered_only_in_working_phases() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Human", Some("draft"));
        let parked = insert_session(&pool, &persona_id, BuildPhase::TestComplete, &hours_ago(2));
        let working = insert_session(&pool, &persona_id, BuildPhase::Analyzing, &hours_ago(2));

        let out = recover_orphans(&pool, "me", chrono::Utc::now(), &never).unwrap();
        assert_eq!(out.len(), 1, "{out:?}");
        assert_eq!(
            get_by_id(&pool, &parked).unwrap().unwrap().phase,
            BuildPhase::TestComplete
        );
        assert_eq!(
            get_by_id(&pool, &working).unwrap().unwrap().phase,
            BuildPhase::Failed
        );
    }
}
