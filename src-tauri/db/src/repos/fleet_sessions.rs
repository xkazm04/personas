//! Repository for the durable fleet session registry (`fleet_sessions`).
//!
//! The Fleet registry ([`crate::commands::fleet::registry::FleetRegistry`]) is
//! an in-memory `HashMap` — an app restart, update or crash used to lose the
//! entire fleet. This table mirrors it so a restart is a non-event: every
//! non-exited row rehydrates on boot as a *dozing tombstone* (state kept,
//! process gone) that the existing `claude --resume` wake path resurrects.
//!
//! Contract:
//! - Only sessions with a BOUND `claude_session_id` are persisted — they are
//!   the only ones that can be resumed.
//! - Writes are best-effort and must never block or fail a PTY/state path
//!   (see [`crate::commands::fleet::persist`], which owns the writer thread).
//! - Exited rows age out on boot ([`prune_exited_before`]); the live registry
//!   remains the source of truth while the app runs.

use rusqlite::{params, OptionalExtension};

use crate::DbPool;
use personas_core::error::AppError;

/// One persisted fleet session — a faithful projection of the registry row's
/// rehydratable fields. PTY handles, the output ring and the child pid are
/// deliberately absent: they die with the process and are re-established by a
/// wake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetSessionRow {
    /// Registry id (UUID v4). Stable across a restart so grid identity holds.
    pub id: String,
    /// Claude Code's own conversation id — the `--resume` key.
    pub claude_session_id: String,
    pub cwd: String,
    pub project_label: String,
    pub name: Option<String>,
    pub title: Option<String>,
    /// The spawn argv, JSON-encoded (`["--session-id","…"]`).
    pub args_json: String,
    /// `interactive` | `headless` (matches `FleetSessionMode`'s serde tokens).
    pub mode: String,
    /// State token (matches `types::state_to_token`).
    pub state: String,
    pub state_reason: Option<String>,
    /// Run-harvest grouping key. `None` = ad-hoc spawn.
    pub run_id: Option<String>,
    pub run_label: Option<String>,
    pub created_at_ms: i64,
    pub last_activity_ms: i64,
    /// Dispatch-queue position (1-based, dense) while `state = 'queued'`;
    /// `NULL` otherwise. See `commands::fleet::queue`.
    pub queue_rank: Option<u32>,
    /// When the dispatch was admitted to the queue. Kept after promotion.
    pub queued_at_ms: Option<i64>,
    /// Earliest promotion time; a future gate is skipped, not waited on.
    pub not_before_ms: Option<i64>,
    /// `DispatchOrigin` token (`manual`, `autopilot`, …). `NULL` for rows
    /// written before the queue existed.
    pub origin: Option<String>,
    pub persona_id: Option<String>,
    pub goal_id: Option<String>,
    pub cycle_index: Option<i64>,
}

/// The projection every read shares — named, so a mid-table `ADD COLUMN`
/// cannot shift a field (the queue columns were added by migration e36).
const COLUMNS: &str = "id, claude_session_id, cwd, project_label, name, title, args_json,
                    mode, state, state_reason, run_id, run_label,
                    created_at_ms, last_activity_ms,
                    queue_rank, queued_at_ms, not_before_ms, origin, persona_id, goal_id,
                    cycle_index";

/// Insert-or-replace a session row. Keyed on the registry id, so a state
/// change is a single cheap UPSERT rather than a read-modify-write.
pub fn upsert(pool: &DbPool, row: &FleetSessionRow) -> Result<(), AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::upsert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO fleet_sessions
                (id, claude_session_id, cwd, project_label, name, title, args_json,
                 mode, state, state_reason, run_id, run_label,
                 created_at_ms, last_activity_ms, updated_at_ms,
                 queue_rank, queued_at_ms, not_before_ms, origin, persona_id, goal_id,
                 cycle_index)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                     ?16, ?17, ?18, ?19, ?20, ?21, ?22)
             ON CONFLICT(id) DO UPDATE SET
                claude_session_id = excluded.claude_session_id,
                cwd               = excluded.cwd,
                project_label     = excluded.project_label,
                name              = excluded.name,
                title             = excluded.title,
                args_json         = excluded.args_json,
                mode              = excluded.mode,
                state             = excluded.state,
                state_reason      = excluded.state_reason,
                -- run identity is stamped once at spawn; a later state write
                -- must never null it out.
                run_id            = COALESCE(excluded.run_id, fleet_sessions.run_id),
                run_label         = COALESCE(excluded.run_label, fleet_sessions.run_label),
                created_at_ms     = excluded.created_at_ms,
                last_activity_ms  = excluded.last_activity_ms,
                updated_at_ms     = excluded.updated_at_ms,
                -- the rank is the queue's live truth (cleared on promotion);
                -- the provenance is stamped once and never nulled by a later
                -- state write.
                queue_rank        = excluded.queue_rank,
                queued_at_ms      = COALESCE(excluded.queued_at_ms, fleet_sessions.queued_at_ms),
                not_before_ms     = excluded.not_before_ms,
                origin            = COALESCE(excluded.origin, fleet_sessions.origin),
                persona_id        = COALESCE(excluded.persona_id, fleet_sessions.persona_id),
                goal_id           = COALESCE(excluded.goal_id, fleet_sessions.goal_id),
                cycle_index       = COALESCE(excluded.cycle_index, fleet_sessions.cycle_index)",
            params![
                row.id,
                row.claude_session_id,
                row.cwd,
                row.project_label,
                row.name,
                row.title,
                row.args_json,
                row.mode,
                row.state,
                row.state_reason,
                row.run_id,
                row.run_label,
                row.created_at_ms,
                row.last_activity_ms,
                personas_core::utils::now_ms(),
                row.queue_rank,
                row.queued_at_ms,
                row.not_before_ms,
                row.origin,
                row.persona_id,
                row.goal_id,
                row.cycle_index,
            ],
        )?;
        Ok(())
    })
}

/// Drop a persisted row (the operator dismissed it, or a wake replaced it with
/// a fresh registry id).
pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::delete", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM fleet_sessions WHERE id = ?1", params![id])?;
        Ok(())
    })
}

/// One session by its REGISTRY id — the handle a spawn hands back and the
/// attention loop stores in its ledger stats. `None` when the row was pruned
/// (`prune_exited_before`) or never persisted; the caller reports that as
/// "unknown", never as "still running".
pub fn get(pool: &DbPool, id: &str) -> Result<Option<FleetSessionRow>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::get", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS}
             FROM fleet_sessions WHERE id = ?1"
        ))?;
        stmt.query_row(params![id], map_row)
            .optional()
            .map_err(AppError::Database)
    })
}

/// When a session's row last changed state (`updated_at_ms`), or `None` when
/// the row is gone. The stale sweeper re-stamps this on every transition, so
/// for a `stale` session it is the moment the flag was raised — which is what
/// [`crate::repos::dev::tasks::stale_long_enough_to_be_gone`] measures a
/// worker's silence from.
pub fn updated_at_ms(pool: &DbPool, id: &str) -> Result<Option<i64>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::updated_at_ms", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT updated_at_ms FROM fleet_sessions WHERE id = ?1",
            params![id],
            |r| r.get::<_, i64>("updated_at_ms"),
        )
        .optional()
        .map_err(AppError::Database)
    })
}

/// Every row that could still be resurrected — i.e. not terminal. Newest
/// spawn first (the grid sorts the same way).
pub fn list_rehydratable(pool: &DbPool) -> Result<Vec<FleetSessionRow>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_rehydratable", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS}
             FROM fleet_sessions
             WHERE state <> 'exited'
             ORDER BY created_at_ms DESC"
        ))?;
        let rows = stmt.query_map([], map_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

/// All rows belonging to one run (harvest surface). `run_id` is the batch tag
/// stamped at spawn.
pub fn list_by_run(pool: &DbPool, run_id: &str) -> Result<Vec<FleetSessionRow>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_by_run", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS}
             FROM fleet_sessions
             WHERE run_id = ?1
             ORDER BY created_at_ms ASC"
        ))?;
        let rows = stmt.query_map(params![run_id], map_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

/// Run index for the harvest picker: one entry per `run_id`, newest run first.
/// Rows with no `run_id` (spawned before the run lane existed) are skipped —
/// there is no run to report on.
pub fn list_runs(
    pool: &DbPool,
    limit: u32,
) -> Result<Vec<(String, Option<String>, i64, i32, i32)>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_runs", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT run_id                                               AS run_id,
                    MAX(run_label)                                       AS label,
                    MIN(created_at_ms)                                   AS started,
                    COUNT(*)                                             AS n,
                    SUM(CASE WHEN state = 'finished' THEN 1 ELSE 0 END)  AS finished
             FROM fleet_sessions
             WHERE run_id IS NOT NULL
             GROUP BY run_id
             ORDER BY started DESC
             LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok((
                    r.get("run_id")?,
                    r.get("label")?,
                    r.get("started")?,
                    r.get("n")?,
                    r.get("finished")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// How many of ONE run label's sessions are still occupying a slot.
///
/// The slot arithmetic an App Master persona's wake does
/// (`engine::subscription::attention::decide_free_capacity`) counts executions
/// out of the live tracker — and a code charter is dispatched as a headless
/// FLEET session, which creates no execution and therefore never appears
/// there. This is the other half of that count, and it reads the DURABLE table
/// rather than the in-memory registry on purpose: the number must survive an
/// app restart (the registry does not) and must be reachable from a test with
/// nothing but `init_test_db()`.
///
/// Two filters, both the caller's to choose:
/// - `active_states` is the caller's vocabulary, not this module's. The tokens
///   are `types::state_to_token`'s and live in the app crate; passing them in
///   keeps one spelling of the state machine rather than a second copy here.
///   An EMPTY slice counts nothing and says so by returning `0` — never "all
///   states", which is how an accidental empty list would silently uncap a
///   concurrency limit.
/// - `since_ms` drops rows whose `last_activity_ms` is older than it. A worker
///   parked in `awaiting_input` is swept by the fleet's unattended sweeper, but
///   the sweep runs on a ticker; without this bound a worker that nobody will
///   ever answer holds a slot for however long the sweeper takes to notice.
///   Pass the same cutoff that sweeper uses. The cost is symmetric and
///   deliberate: a genuinely busy worker that emits no hook for that long is
///   also not counted, which errs toward dispatching rather than toward a
///   persona that has silently stopped working.
pub fn count_active_for_run_label(
    pool: &DbPool,
    run_label: &str,
    active_states: &[&str],
    since_ms: i64,
) -> Result<usize, AppError> {
    if active_states.is_empty() {
        return Ok(0);
    }
    timed_query!(
        "fleet_sessions",
        "fleet_sessions::count_active_for_run_label",
        {
            let conn = pool.get()?;
            // Explicitly numbered from ?3 — bare `?` would be numbered by
            // SQLite relative to what came before it, which is exactly the
            // kind of positional coupling this repo's row mapping bans.
            let placeholders = (3..3 + active_states.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT COUNT(id) AS n
                 FROM fleet_sessions
                 WHERE run_label = ?1
                   AND last_activity_ms >= ?2
                   AND state IN ({placeholders})"
            );
            let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(2 + active_states.len());
            args.push(&run_label);
            args.push(&since_ms);
            for s in active_states {
                args.push(s);
            }
            // By NAME, not by index — the projection is named `n` for exactly
            // that reason, and a positional read here would be one more site
            // bound to an order instead of a name.
            let n: i64 = conn.query_row(&sql, args.as_slice(), |r| r.get("n"))?;
            Ok(n.max(0) as usize)
        }
    )
}

// ---------------------------------------------------------------------------
// Dispatch queue (`commands::fleet::queue`). The queue's durable half: a
// `queued` row is a dispatch that waited for a live slot, and these are the
// reads and writes that survive a restart.
// ---------------------------------------------------------------------------

/// The state tokens that occupy a live slot. The caller's vocabulary
/// (`types::state_to_token`) spelled once here so the SQL and the in-memory
/// registry (`registry::is_live_state`) cannot drift.
pub const LIVE_STATES: &[&str] = &["spawning", "running", "awaiting_input", "idle"];

/// Every queued row in promotion order: rank ascending, then admission time.
pub fn list_queued_ordered(pool: &DbPool) -> Result<Vec<FleetSessionRow>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_queued_ordered", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS}
             FROM fleet_sessions
             WHERE state = 'queued'
             ORDER BY queue_rank ASC, queued_at_ms ASC"
        ))?;
        // A row that fails to map is a corrupt queue entry, and the queue's
        // order is the promotion order: surface it rather than skip it.
        let rows = stmt
            .query_map([], map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Stamp one row's rank (`None` clears it — a promoted or cancelled row).
/// Returns whether a row was written: a rank is only meaningful on a row
/// that is (or was, at promotion) part of the queue, so the write is guarded
/// on the row carrying a rank OR being queued, and the verdict is returned
/// rather than dropped.
pub fn set_queue_rank(pool: &DbPool, id: &str, rank: Option<u32>) -> Result<bool, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::set_queue_rank", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE fleet_sessions SET queue_rank = ?2, updated_at_ms = ?3
             WHERE id = ?1 AND (state = 'queued' OR queue_rank IS NOT NULL)",
            params![id, rank, personas_core::utils::now_ms()],
        )?;
        Ok(changed == 1)
    })
}

/// The highest rank held by a queued row (`0` when the queue is empty), so a
/// new admission takes `max + 1`.
pub fn max_queue_rank(pool: &DbPool) -> Result<u32, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::max_queue_rank", {
        let conn = pool.get()?;
        let n: Option<i64> = conn.query_row(
            "SELECT MAX(queue_rank) AS n FROM fleet_sessions WHERE state = 'queued'",
            [],
            |r| r.get("n"),
        )?;
        Ok(n.unwrap_or(0).max(0) as u32)
    })
}

/// How many DURABLE rows sit in a live state ([`LIVE_STATES`]). The registry's
/// in-memory count is the admission authority while the app runs; this is the
/// restart-safe reading a test or a boot-time reconcile can reach.
pub fn count_live(pool: &DbPool) -> Result<u32, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::count_live", {
        let conn = pool.get()?;
        let placeholders = (1..=LIVE_STATES.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql =
            format!("SELECT COUNT(id) AS n FROM fleet_sessions WHERE state IN ({placeholders})");
        let args: Vec<&dyn rusqlite::ToSql> = LIVE_STATES
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        let n: i64 = conn.query_row(&sql, args.as_slice(), |r| r.get("n"))?;
        Ok(n.max(0) as u32)
    })
}

/// Re-rank the queue densely (`1..`) in the given `(id, rank)` order, in one
/// transaction. Ids that are not queued rows are left untouched by the
/// `state = 'queued'` guard; the number of rows the guard let through is
/// returned so a caller can see a rank that named a promoted row.
pub fn renumber_queue(pool: &DbPool, ranks: &[(String, u32)]) -> Result<usize, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::renumber_queue", {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let now = personas_core::utils::now_ms();
        let mut written = 0usize;
        for (id, rank) in ranks {
            written += tx.execute(
                "UPDATE fleet_sessions SET queue_rank = ?2, updated_at_ms = ?3
                 WHERE id = ?1 AND state = 'queued'",
                params![id, rank, now],
            )?;
        }
        tx.commit()?;
        Ok(written)
    })
}

/// Wall-clock durations (`last_activity_ms - created_at_ms`) of the most
/// recently ended sessions (`finished` or `exited`), newest first, capped at
/// `limit`. The queue's start estimate is a mean over these; an empty history
/// means no estimate, never a made-up one.
pub fn recent_ended_durations_ms(pool: &DbPool, limit: u32) -> Result<Vec<i64>, AppError> {
    timed_query!(
        "fleet_sessions",
        "fleet_sessions::recent_ended_durations_ms",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT last_activity_ms - created_at_ms AS duration_ms
             FROM fleet_sessions
             WHERE state IN ('finished', 'exited')
               AND last_activity_ms > created_at_ms
             ORDER BY last_activity_ms DESC
             LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], |r| r.get::<_, i64>("duration_ms"))?;
            Ok(rows.filter_map(Result::ok).collect())
        }
    )
}

/// Retention: drop terminal rows last touched before `cutoff_ms`. Called once
/// on boot — a 24h-old exited session has no recovery value.
pub fn prune_exited_before(pool: &DbPool, cutoff_ms: i64) -> Result<usize, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::prune_exited_before", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM fleet_sessions WHERE state = 'exited' AND updated_at_ms < ?1",
            params![cutoff_ms],
        )?;
        Ok(n)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// The states an App Master wake treats as "this worker still holds one of
    /// my slots". Spelled out here so the test fails if the production caller
    /// silently narrows the set.
    const ACTIVE: &[&str] = &["spawning", "running", "awaiting_input", "idle"];

    fn row(id: &str, label: &str, state: &str, last_activity_ms: i64) -> FleetSessionRow {
        FleetSessionRow {
            id: id.into(),
            claude_session_id: format!("cs-{id}"),
            cwd: "C:/tmp".into(),
            project_label: "personas".into(),
            name: None,
            title: None,
            args_json: "[]".into(),
            mode: "headless".into(),
            state: state.into(),
            state_reason: None,
            run_id: Some("run-1".into()),
            run_label: Some(label.into()),
            created_at_ms: 1,
            last_activity_ms,
            queue_rank: None,
            queued_at_ms: None,
            not_before_ms: None,
            origin: None,
            persona_id: None,
            goal_id: None,
            cycle_index: None,
        }
    }

    #[test]
    fn counts_only_active_states_of_the_named_run_label() {
        let pool = init_test_db().unwrap();
        let label = "app-master:p1";
        for (i, state) in ACTIVE.iter().enumerate() {
            upsert(&pool, &row(&format!("a{i}"), label, state, 1_000)).unwrap();
        }
        // Terminal / dormant states hold nothing.
        for (i, state) in ["finished", "exited", "stale", "hibernated"]
            .iter()
            .enumerate()
        {
            upsert(&pool, &row(&format!("t{i}"), label, state, 1_000)).unwrap();
        }
        // Another persona's workers, and an operator's own run, are not mine.
        upsert(&pool, &row("other", "app-master:p2", "running", 1_000)).unwrap();
        upsert(&pool, &row("human", "my notes", "running", 1_000)).unwrap();

        assert_eq!(
            count_active_for_run_label(&pool, label, ACTIVE, 0).unwrap(),
            ACTIVE.len(),
            "one per active state, and nothing else"
        );
        assert_eq!(
            count_active_for_run_label(&pool, "app-master:p2", ACTIVE, 0).unwrap(),
            1
        );
        assert_eq!(
            count_active_for_run_label(&pool, "app-master:nobody", ACTIVE, 0).unwrap(),
            0
        );
    }

    #[test]
    fn the_cutoff_drops_a_worker_that_has_gone_quiet() {
        let pool = init_test_db().unwrap();
        let label = "app-master:p1";
        upsert(&pool, &row("fresh", label, "running", 10_000)).unwrap();
        upsert(&pool, &row("parked", label, "awaiting_input", 1_000)).unwrap();

        assert_eq!(
            count_active_for_run_label(&pool, label, ACTIVE, 0).unwrap(),
            2,
            "no cutoff — both still hold a slot"
        );
        assert_eq!(
            count_active_for_run_label(&pool, label, ACTIVE, 5_000).unwrap(),
            1,
            "the parked worker is older than the cutoff and stops holding one"
        );
        // The boundary is inclusive: a row touched exactly at the cutoff counts.
        assert_eq!(
            count_active_for_run_label(&pool, label, ACTIVE, 10_000).unwrap(),
            1
        );
        assert_eq!(
            count_active_for_run_label(&pool, label, ACTIVE, 10_001).unwrap(),
            0
        );
    }

    /// An empty state list must count NOTHING. The dangerous reading is "no
    /// filter, so every row" — that would uncap the persona limit this count
    /// exists to enforce, in the one case (a caller bug) where it is least
    /// likely to be noticed.
    #[test]
    fn an_empty_state_list_counts_nothing() {
        let pool = init_test_db().unwrap();
        upsert(&pool, &row("a", "app-master:p1", "running", 1)).unwrap();
        assert_eq!(
            count_active_for_run_label(&pool, "app-master:p1", &[], 0).unwrap(),
            0
        );
    }
}

row_mapper!(map_row -> FleetSessionRow {
    id,
    claude_session_id,
    cwd,
    project_label,
    name,
    title,
    args_json,
    mode,
    state,
    state_reason,
    run_id,
    run_label,
    created_at_ms,
    last_activity_ms,
    queue_rank,
    queued_at_ms,
    not_before_ms,
    origin,
    persona_id,
    goal_id,
    cycle_index,
});
