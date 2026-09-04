//! Restart classification for executions the app was mid-RUN on when it died.
//!
//! # The problem this replaces
//!
//! `ExecutionEngine::recover_stale_executions` marked every `running` row
//! `failed` with `"App restarted while execution was running"` — a failure
//! nobody observed. `docs/concepts/golden-paths/os-process-reconciliation.md`
//! §7.2 measured the consequence: **74 of 2,188 executions** on the
//! 2026-08-17 backup carry that marker, with no liveness check, no `unproven`
//! state and no user surface. §2(c) of the same document states the
//! prescription: *"At boot, do not declare — classify."*
//!
//! # The two keys
//!
//! Registry technique `session-continuation/stuck-loop-detection` §"The
//! interruption that leaves no signature": a healing loop stops on **failure
//! identity**, but an involuntary interruption produces no identity at all —
//! no error class, no assertion, no location; the round simply never
//! finished. So an involuntary interruption is counted on a **second key**,
//! and that counter lives with whatever restores work across restarts rather
//! than inside the loop that died. Here that is [`restart_count`], next to
//! but never merged with `retry_count` (which counts healing retries of an
//! *observed* failure).
//!
//! # The three classes
//!
//! | class | row becomes | why |
//! |---|---|---|
//! | [`RestartClass::ResumePending`] | `queued` + `recovery_state='resume_pending'`, count+1 | plausibly mid-flight; the durable-queue re-admission path already drains `queued` rows |
//! | [`RestartClass::Unproven`] | `incomplete` + `recovery_state='unproven'` | ran too long ago to be mid-flight — neither success nor failure, and a person decides |
//! | [`RestartClass::Suspended`] | `incomplete` + `recovery_state='suspended'` | [`MAX_CONSECUTIVE_RESTARTS`] reached: a run that kills the app every time it resumes must terminate itself rather than terminating the app |
//!
//! `ExecutionState` is **not** widened. `Incomplete` already means "ran, never
//! finished, not a failure anyone observed" in this codebase —
//! `sweep_zombie_executions` writes exactly that — and `queued` already means
//! "durable work waiting for a slot". `recovery_state` carries the extra bit
//! the enum would otherwise have to, at the cost of one nullable column
//! instead of a variant that crosses to TypeScript through ts-rs and is read
//! by the execution list, the inspector, the replay sandbox and the lab.
//!
//! # Marking on the way in, clearing only on success
//!
//! The mark survives the re-admission. It is cleared in
//! `executions::exec_status_update` when a run reaches `completed` — never
//! when a resume *begins*. Clearing at resume time is the mistake that costs
//! the whole mechanism: it makes every crash the first crash, so the
//! escalation below can never fire.

use rusqlite::params;

use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// A `running` row started within this window was plausibly mid-flight when
/// the process died, so it is worth one re-admission.
///
/// 30 minutes, and not a fresh number: it is
/// `executions::DEFAULT_ZOMBIE_THRESHOLD_SECS`, the point at which the live
/// zombie sweep already declares a still-`running` execution stalled and
/// moves it to `incomplete`. A row past that line was not mid-flight when the
/// app died — the app's own sweeper would have reaped it — so re-admitting it
/// would resume work whose inputs are stale.
pub const RESUME_WINDOW_SECS: i64 = 30 * 60;

/// Consecutive restarts an execution may survive before it stops being
/// re-admitted. The count carries its predicate: "restart 3" says nothing,
/// "3 consecutive restarts with this execution still active" is the verdict
/// (law `count-carries-predicate`).
pub const MAX_CONSECUTIVE_RESTARTS: i64 = 3;

/// `recovery_state` value: marked for one re-admission; cleared on a turn that
/// completes, not on the attempt.
pub const RECOVERY_RESUME_PENDING: &str = "resume_pending";
/// `recovery_state` value: interrupted, not resumable, and not a failure
/// anyone observed. A person resumes or discards it.
pub const RECOVERY_UNPROVEN: &str = "unproven";
/// `recovery_state` value: terminal — the escalation fired.
pub const RECOVERY_SUSPENDED: &str = "suspended";

/// The message the blind-fail sweep wrote on every `running` row it found.
/// Kept as a constant so [`count_legacy_restart_failures`] can measure the
/// population this module exists to empty.
pub const LEGACY_RESTART_MARKER: &str = "App restarted while execution was running";

/// What the classifier decided about one mid-run row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestartClass {
    /// Re-admit once. The mark rides along and only a completed turn clears it.
    ResumePending,
    /// Not runnable, not failed: surface it and let a person decide.
    Unproven,
    /// The restart counter reached [`MAX_CONSECUTIVE_RESTARTS`].
    Suspended,
}

impl RestartClass {
    /// The `recovery_state` string this class writes.
    pub fn as_str(self) -> &'static str {
        match self {
            RestartClass::ResumePending => RECOVERY_RESUME_PENDING,
            RestartClass::Unproven => RECOVERY_UNPROVEN,
            RestartClass::Suspended => RECOVERY_SUSPENDED,
        }
    }
}

/// The pure decision. No DB, no clock, no filesystem — every input is an
/// argument, so the policy is testable without a fixture.
///
/// * `started_at` — RFC3339, or `None` for a `running` row that never got a
///   start stamp. An unparseable or missing stamp cannot be shown to be
///   mid-flight, so it classifies `Unproven`: the honest answer is "we do not
///   know", and the row goes to a human rather than back into the engine.
/// * `restart_count` — restarts this execution has **already** survived. The
///   restart being classified right now is number `restart_count + 1`.
pub fn classify(
    started_at: Option<&str>,
    restart_count: i64,
    now: chrono::DateTime<chrono::Utc>,
) -> RestartClass {
    // The escalation outranks the window: a row that has taken the app down
    // twice already must not be re-admitted just because it looks fresh.
    if restart_count + 1 >= MAX_CONSECUTIVE_RESTARTS {
        return RestartClass::Suspended;
    }

    let Some(started_at) = started_at else {
        return RestartClass::Unproven;
    };
    let Ok(started) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return RestartClass::Unproven;
    };

    let age_secs = (now - started.with_timezone(&chrono::Utc)).num_seconds();
    if (0..=RESUME_WINDOW_SECS).contains(&age_secs) {
        RestartClass::ResumePending
    } else {
        // Either older than the window, or stamped in the future by a clock
        // change — neither is evidence of a turn in flight.
        RestartClass::Unproven
    }
}

/// The ids the sweep put in each class, in the order it found them.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RestartSweep {
    /// Now `queued`: the existing re-admission path will pick these up.
    pub resume_pending: Vec<String>,
    /// Now `incomplete`, awaiting a person.
    pub unproven: Vec<String>,
    /// Now `incomplete` and never re-admitted again.
    pub suspended: Vec<String>,
}

impl RestartSweep {
    /// Rows classified. Zero when a clean shutdown suppressed the sweep — the
    /// caller (`boot::recovery`) never calls in at all in that case, so an
    /// empty sweep here always means "nothing was mid-run".
    pub fn total(&self) -> usize {
        self.resume_pending.len() + self.unproven.len() + self.suspended.len()
    }
}

/// One mid-run row, in the only three fields the policy reads.
struct StaleRow {
    id: String,
    started_at: Option<String>,
    restart_count: i64,
}

/// Classify every `running` row instead of declaring it failed.
///
/// Best-effort per row: a row whose write fails is left `running` for the next
/// boot, which is the same crash-safety the re-admission path already relies
/// on. Nothing here kills a process, reads a pid, or asks whether anything is
/// alive — that is `os-process-reconciliation`'s leaf, and the caller has
/// already deferred to a live leadership lease before reaching this.
pub fn classify_running_rows(pool: &DbPool) -> Result<RestartSweep, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::classify_running_rows",
        {
            let conn = pool.conn("executions::classify_running_rows")?;
            let now = chrono::Utc::now();
            let now_str = now.to_rfc3339();

            let rows: Vec<StaleRow> = {
                let mut stmt = conn.prepare_cached(
                    "SELECT id, started_at, restart_count FROM persona_executions
                     WHERE status = 'running' ORDER BY created_at ASC",
                )?;
                let mapped = stmt.query_map([], |row| {
                    Ok(StaleRow {
                        id: row.get("id")?,
                        started_at: row.get("started_at")?,
                        restart_count: row.get("restart_count")?,
                    })
                })?;
                crate::repos::utils::collect_rows(
                    mapped,
                    "persona_executions::classify_running_rows",
                )
            };

            let mut sweep = RestartSweep::default();
            for row in rows {
                let class = classify(row.started_at.as_deref(), row.restart_count, now);
                let written = match class {
                    RestartClass::ResumePending => mark_resume_pending(&conn, &row.id),
                    RestartClass::Unproven => mark_terminal(
                        &conn,
                        &row.id,
                        RECOVERY_UNPROVEN,
                        "Interrupted by an app restart. The run was not in flight recently \
                         enough to re-admit, so its outcome is unproven - not failed.",
                        &now_str,
                    ),
                    RestartClass::Suspended => mark_terminal(
                        &conn,
                        &row.id,
                        RECOVERY_SUSPENDED,
                        "Suspended after 3 consecutive app restarts with this execution still \
                         active. It is no longer re-admitted; resume or discard it deliberately.",
                        &now_str,
                    ),
                };
                match written {
                    Ok(true) => match class {
                        RestartClass::ResumePending => sweep.resume_pending.push(row.id),
                        RestartClass::Unproven => sweep.unproven.push(row.id),
                        RestartClass::Suspended => sweep.suspended.push(row.id),
                    },
                    // CAS miss: another writer moved the row off `running`
                    // between the read and here. Its state is theirs, not ours.
                    Ok(false) => {}
                    Err(e) => tracing::warn!(
                        execution_id = %row.id,
                        "Failed to classify mid-run execution: {e} - left running for the next boot"
                    ),
                }
            }

            tracing::info!(
                resume_pending = sweep.resume_pending.len(),
                unproven = sweep.unproven.len(),
                suspended = sweep.suspended.len(),
                "Classified mid-run executions after an unclean start"
            );
            Ok(sweep)
        }
    )
}

/// Back to the durable queue, with the mark and the incremented count riding
/// along. The stale claim is cleared so the row can be claimed again; the
/// error message is deliberately left alone (a row that resumes and succeeds
/// should carry no explanation of a failure that never happened).
fn mark_resume_pending(conn: &rusqlite::Connection, id: &str) -> Result<bool, AppError> {
    let mut stmt = conn.prepare_cached(
        "UPDATE persona_executions SET
            status = 'queued',
            recovery_state = ?2,
            restart_count = restart_count + 1,
            claimed_by_instance = NULL,
            claim_expires_at = NULL
         WHERE id = ?1 AND status = 'running'",
    )?;
    Ok(stmt.execute(params![id, RECOVERY_RESUME_PENDING])? > 0)
}

/// `incomplete`, not `failed`: neither a success nor a failure anyone
/// observed. The reason is written where the operator already reads it.
fn mark_terminal(
    conn: &rusqlite::Connection,
    id: &str,
    recovery_state: &str,
    reason: &str,
    now_str: &str,
) -> Result<bool, AppError> {
    let mut stmt = conn.prepare_cached(
        "UPDATE persona_executions SET
            status = 'incomplete',
            recovery_state = ?2,
            error_message = ?3,
            completed_at = COALESCE(completed_at, ?4),
            claimed_by_instance = NULL,
            claim_expires_at = NULL
         WHERE id = ?1 AND status = 'running'",
    )?;
    Ok(stmt.execute(params![id, recovery_state, reason, now_str])? > 0)
}

/// Rows a restart left in a state a person still has to resolve — the surface
/// the golden path's §2(e) requires ("reconciliation cannot be complete, so
/// the residue must reach a human"). Newest first.
pub fn list_unresolved_recoveries(pool: &DbPool) -> Result<Vec<UnresolvedRecovery>, AppError> {
    timed_query!(
        "persona_executions",
        "persona_executions::list_unresolved_recoveries",
        {
            let conn = pool.conn("executions::list_unresolved_recoveries")?;
            let mut stmt = conn.prepare_cached(
                "SELECT id, persona_id, status, recovery_state, restart_count, error_message
                 FROM persona_executions
                 WHERE recovery_state IS NOT NULL AND status != 'completed'
                 ORDER BY created_at DESC",
            )?;
            let mapped = stmt.query_map([], |row| {
                Ok(UnresolvedRecovery {
                    id: row.get("id")?,
                    persona_id: row.get("persona_id")?,
                    status: row.get("status")?,
                    recovery_state: row.get("recovery_state")?,
                    restart_count: row.get("restart_count")?,
                    error_message: row.get("error_message")?,
                })
            })?;
            Ok(crate::repos::utils::collect_rows(
                mapped,
                "persona_executions::list_unresolved_recoveries",
            ))
        }
    )
}

/// One row of the unresolved-recovery surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnresolvedRecovery {
    pub id: String,
    pub persona_id: String,
    pub status: String,
    pub recovery_state: Option<String>,
    pub restart_count: i64,
    pub error_message: Option<String>,
}

/// Measurable #2 from the direction: rows sitting in a state nobody chose —
/// `failed` carrying the blind sweep's marker. Target after this change: zero
/// new ones. Pre-existing rows from before the migration keep their marker;
/// this counts them so the number can be watched, not rewritten (a historical
/// row's status is history).
pub fn count_legacy_restart_failures(pool: &DbPool) -> Result<i64, AppError> {
    timed_query!(
        "restart_recovery",
        "restart_recovery::count_legacy_restart_failures",
        {
            let conn = pool.conn("executions::count_legacy_restart_failures")?;
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) AS n FROM persona_executions
                 WHERE status = 'failed' AND error_message = ?1",
                params![LEGACY_RESTART_MARKER],
                |row| row.get("n"),
            )?;
            Ok(n)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::{CreatePersonaInput, UpdateExecutionStatus};
    use crate::repos::core::personas;
    use crate::repos::execution::executions;
    use personas_core::types::ExecutionState;

    fn make_persona(pool: &DbPool, name: &str) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a test agent.".into(),
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
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    /// Insert `count` rows straight through SQL. Building the backup's shape
    /// through `create()` + `update_status()` would be 2,188 round trips for a
    /// fixture whose only interesting property is the ratio.
    fn insert_rows(
        pool: &DbPool,
        persona_id: &str,
        prefix: &str,
        count: usize,
        status: &str,
        started_offset_secs: Option<i64>,
        error_message: Option<&str>,
    ) -> Vec<String> {
        let conn = pool
            .conn("restart_recovery::test")
            .expect("a pooled connection");
        let now = chrono::Utc::now();
        let mut ids = Vec::with_capacity(count);
        for i in 0..count {
            let id = format!("{prefix}-{i}");
            let started =
                started_offset_secs.map(|off| (now - chrono::Duration::seconds(off)).to_rfc3339());
            conn.execute(
                "INSERT INTO persona_executions
                    (id, persona_id, status, started_at, created_at, error_message)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    persona_id,
                    status,
                    started,
                    now.to_rfc3339(),
                    error_message
                ],
            )
            .unwrap();
            ids.push(id);
        }
        ids
    }

    fn status_of(pool: &DbPool, id: &str) -> String {
        let conn = pool
            .conn("restart_recovery::test")
            .expect("a pooled connection");
        conn.query_row(
            "SELECT status FROM persona_executions WHERE id = ?1",
            params![id],
            |r| r.get("status"),
        )
        .unwrap()
    }

    fn recovery_of(pool: &DbPool, id: &str) -> (Option<String>, i64) {
        let conn = pool
            .conn("restart_recovery::test")
            .expect("a pooled connection");
        conn.query_row(
            "SELECT recovery_state, restart_count FROM persona_executions WHERE id = ?1",
            params![id],
            |r| Ok((r.get("recovery_state")?, r.get("restart_count")?)),
        )
        .unwrap()
    }

    // ---------------------------------------------------------------------
    // The pure policy
    // ---------------------------------------------------------------------

    /// A row that started inside the window is worth one re-admission; the
    /// same row an hour older is not, and it is still not a failure.
    #[test]
    fn the_window_separates_mid_flight_from_long_idle() {
        let now = chrono::Utc::now();
        let fresh = (now - chrono::Duration::seconds(60)).to_rfc3339();
        let stale = (now - chrono::Duration::seconds(RESUME_WINDOW_SECS + 1)).to_rfc3339();

        assert_eq!(
            classify(Some(&fresh), 0, now),
            RestartClass::ResumePending,
            "a turn that was in flight a minute ago is resumable"
        );
        assert_eq!(
            classify(Some(&stale), 0, now),
            RestartClass::Unproven,
            "past the zombie threshold nothing was in flight - but it is unproven, not failed"
        );
    }

    /// "We do not know" is the honest classification for a row with no usable
    /// start stamp, and it must not resolve to a resume.
    #[test]
    fn an_unusable_start_stamp_is_unproven_never_resumed() {
        let now = chrono::Utc::now();
        assert_eq!(classify(None, 0, now), RestartClass::Unproven);
        assert_eq!(
            classify(Some("not a timestamp"), 0, now),
            RestartClass::Unproven
        );
        // A clock that jumped backwards leaves a future stamp; that is not
        // evidence of a turn in flight either.
        let future = (now + chrono::Duration::hours(2)).to_rfc3339();
        assert_eq!(classify(Some(&future), 0, now), RestartClass::Unproven);
    }

    /// T2 in the direction's measurable: the escalation bounds consecutive
    /// re-admissions. A poisoned run gets two resumes and then stops taking
    /// the app down.
    #[test]
    fn the_escalation_bounds_consecutive_restarts_at_three() {
        let now = chrono::Utc::now();
        let fresh = (now - chrono::Duration::seconds(30)).to_rfc3339();

        assert_eq!(classify(Some(&fresh), 0, now), RestartClass::ResumePending);
        assert_eq!(classify(Some(&fresh), 1, now), RestartClass::ResumePending);
        assert_eq!(
            classify(Some(&fresh), 2, now),
            RestartClass::Suspended,
            "the third consecutive restart with this execution still active is the verdict"
        );
        assert_eq!(classify(Some(&fresh), 9, now), RestartClass::Suspended);
    }

    // ---------------------------------------------------------------------
    // The sweep, on the backup's shape
    // ---------------------------------------------------------------------

    /// T1's precondition, measured on the 2026-08-17 backup's shape: 74
    /// `running` rows in 2,188 executions.
    ///
    /// Before: all 74 became `failed` with a marker naming a failure nobody
    /// observed. After: **0** are `failed`, and every one of them is either
    /// re-admitted (back on the durable queue the existing re-admission path
    /// drains) or `incomplete` and awaiting a person. The share that *then*
    /// completes is a replay measurement this fixture cannot make; what it
    /// pins is that the population is no longer written off unexamined.
    #[test]
    fn the_backup_shape_produces_no_failed_rows() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Restart Corpus Agent");

        // 2,114 terminal rows + 74 mid-run rows = the backup's 2,188.
        insert_rows(
            &pool,
            &persona_id,
            "done",
            2_114,
            "completed",
            Some(900),
            None,
        );
        // Of the 74, split the way a real crash splits them: most were in
        // flight, the rest had been running long enough that the app's own
        // zombie sweeper would already have reaped them.
        let fresh = insert_rows(&pool, &persona_id, "midrun", 60, "running", Some(120), None);
        let idle = insert_rows(
            &pool,
            &persona_id,
            "idle",
            14,
            "running",
            Some(RESUME_WINDOW_SECS + 600),
            None,
        );
        assert_eq!(fresh.len() + idle.len(), 74);

        let before_failed = count_legacy_restart_failures(&pool).unwrap();
        assert_eq!(before_failed, 0, "fixture starts with no marker rows");

        let sweep = classify_running_rows(&pool).unwrap();

        assert_eq!(sweep.resume_pending.len(), 60);
        assert_eq!(sweep.unproven.len(), 14);
        assert_eq!(sweep.suspended.len(), 0);
        assert_eq!(sweep.total(), 74);

        // Measurable #2: rows in a state nobody chose. Zero.
        assert_eq!(
            count_legacy_restart_failures(&pool).unwrap(),
            0,
            "no row is marked failed for a failure nobody observed"
        );
        let conn = pool
            .conn("restart_recovery::test")
            .expect("a pooled connection");
        let failed: i64 = conn
            .query_row(
                "SELECT COUNT(*) AS n FROM persona_executions WHERE status = 'failed'",
                [],
                |r| r.get("n"),
            )
            .unwrap();
        assert_eq!(failed, 0, "the sweep produces no failures at all");
        drop(conn);

        // The re-admitted rows are exactly what the existing durable-queue
        // path drains, and they carry the mark + the count.
        assert_eq!(executions::get_queued_only(&pool).unwrap().len(), 60);
        assert!(executions::get_running_only(&pool).unwrap().is_empty());
        let (state, count) = recovery_of(&pool, &fresh[0]);
        assert_eq!(state.as_deref(), Some(RECOVERY_RESUME_PENDING));
        assert_eq!(count, 1, "the count is incremented on the way in");

        // The idle ones reached a person, not the bin.
        assert_eq!(status_of(&pool, &idle[0]), "incomplete");
        let (state, _) = recovery_of(&pool, &idle[0]);
        assert_eq!(state.as_deref(), Some(RECOVERY_UNPROVEN));

        // 2,114 finished rows were not touched.
        assert_eq!(list_unresolved_recoveries(&pool).unwrap().len(), 74);
    }

    /// The mistake the peer names, pinned: clearing the mark when the resume
    /// *begins* makes every crash the first crash and the escalation can never
    /// fire. Only a completed turn clears it.
    #[test]
    fn the_mark_survives_the_resume_and_only_success_clears_it() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Poison Run Agent");
        let ids = insert_rows(&pool, &persona_id, "poison", 1, "running", Some(60), None);
        let id = &ids[0];

        // Crash 1: re-admitted, count 1, still marked.
        classify_running_rows(&pool).unwrap();
        assert_eq!(
            recovery_of(&pool, id),
            (Some(RECOVERY_RESUME_PENDING.into()), 1)
        );

        // The resume starts. The mark must NOT clear here.
        executions::update_status(
            &pool,
            id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            recovery_of(&pool, id),
            (Some(RECOVERY_RESUME_PENDING.into()), 1),
            "a resume that has not produced a result clears nothing"
        );

        // Crash 2: count 2, still re-admitted.
        classify_running_rows(&pool).unwrap();
        assert_eq!(
            recovery_of(&pool, id),
            (Some(RECOVERY_RESUME_PENDING.into()), 2)
        );
        assert_eq!(status_of(&pool, id), "queued");

        // Crash 3: the escalation fires. The run stops taking the app down.
        executions::update_status(
            &pool,
            id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();
        let sweep = classify_running_rows(&pool).unwrap();
        assert_eq!(sweep.suspended, vec![id.clone()]);
        assert_eq!(status_of(&pool, id), "incomplete");
        assert_eq!(
            recovery_of(&pool, id).0.as_deref(),
            Some(RECOVERY_SUSPENDED)
        );

        // Suspended is terminal for the sweep: it is no longer `running`, so a
        // fourth restart never sees it again.
        let again = classify_running_rows(&pool).unwrap();
        assert_eq!(again.total(), 0);
    }

    /// The other half of the rule: a turn that *completes* clears the mark and
    /// resets the count, so an execution that crashed once and then succeeded
    /// does not carry a restart into its next life.
    #[test]
    fn a_completed_turn_clears_the_mark_and_resets_the_count() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Recovering Agent");
        let ids = insert_rows(&pool, &persona_id, "recovers", 1, "running", Some(45), None);
        let id = &ids[0];

        classify_running_rows(&pool).unwrap();
        assert_eq!(
            recovery_of(&pool, id),
            (Some(RECOVERY_RESUME_PENDING.into()), 1)
        );

        executions::update_status(
            &pool,
            id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();
        executions::update_status(
            &pool,
            id,
            UpdateExecutionStatus {
                status: ExecutionState::Completed,
                output_data: Some("the work the restart nearly threw away".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(
            recovery_of(&pool, id),
            (None, 0),
            "success is the only thing that clears the mark and the counter"
        );
        assert!(
            list_unresolved_recoveries(&pool).unwrap().is_empty(),
            "a recovered run leaves the operator's surface"
        );
    }

    /// A failure the engine *did* observe is a different key and must not
    /// touch the restart counter — otherwise the two keys merge into one and
    /// the involuntary-interruption count stops meaning anything.
    #[test]
    fn an_observed_failure_leaves_the_restart_counter_alone() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Failing Agent");
        let ids = insert_rows(&pool, &persona_id, "fails", 1, "running", Some(30), None);
        let id = &ids[0];

        classify_running_rows(&pool).unwrap();
        executions::update_status(
            &pool,
            id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .unwrap();
        executions::update_status(
            &pool,
            id,
            UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some("the CLI returned a real error".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(
            recovery_of(&pool, id),
            (Some(RECOVERY_RESUME_PENDING.into()), 1),
            "a failure with a signature is the other key; it neither clears nor bumps this one"
        );
    }

    /// A `queued` row never started a process, so the sweep must not touch it
    /// — that is the P1 "never lose a queued execution" invariant the blind
    /// sweep already respected and this one inherits.
    #[test]
    fn queued_rows_are_not_swept() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Queued Agent");
        let queued = insert_rows(&pool, &persona_id, "waiting", 3, "queued", None, None);

        let sweep = classify_running_rows(&pool).unwrap();
        assert_eq!(sweep.total(), 0);
        for id in &queued {
            assert_eq!(status_of(&pool, id), "queued");
            assert_eq!(recovery_of(&pool, id), (None, 0));
        }
    }
}
