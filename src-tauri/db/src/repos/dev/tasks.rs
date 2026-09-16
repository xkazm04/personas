use super::goals::list_goal_statuses_with_deps;
use crate::models::DevTask;
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};

fn row_to_task(row: &Row) -> rusqlite::Result<DevTask> {
    Ok(DevTask {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        source_idea_id: row.get("source_idea_id")?,
        goal_id: row.get("goal_id")?,
        status: row.get("status")?,
        session_id: row.get("session_id")?,
        progress_pct: row.get::<_, Option<i32>>("progress_pct")?.unwrap_or(0),
        output_lines: row.get::<_, Option<i32>>("output_lines")?.unwrap_or(0),
        error: row.get("error")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        // Same tolerant read as the retry-lineage columns below: a row seen
        // through a pre-migration connection (or a SELECT that omits it) must
        // still map rather than fail the whole Run Desk.
        updated_at: row.get("updated_at").unwrap_or(None),
        depth: row
            .get::<_, Option<String>>("depth")?
            .unwrap_or_else(|| "quick".to_string()),
        // Retry-lineage columns — tolerant `unwrap_or` for the same reason as
        // `dedup_key` on ideas: a row read through a pre-migration connection
        // (or a SELECT that omits them) must still map.
        parent_task_id: row.get("parent_task_id").unwrap_or(None),
        attempt: row
            .get::<_, Option<i32>>("attempt")
            .unwrap_or(None)
            .unwrap_or(1),
        // Runner-isolation columns (G12) — tolerant for the same reason as the
        // retry-lineage pair above: a row read through a pre-migration
        // connection, or one of this file's `SELECT *` queries against an old
        // database, must still map.
        worktree_path: row.get("worktree_path").unwrap_or(None),
        worktree_branch: row.get("worktree_branch").unwrap_or(None),
        worktree_fallback_reason: row.get("worktree_fallback_reason").unwrap_or(None),
    })
}

/// Warn (never reject) on a status outside `TASK_STATUSES`. Rejecting would
/// strand a task mid-run; a warning is enough to catch a new writer that
/// invents a vocabulary the Run Desk cannot render.
fn warn_unknown_task_status(status: &str, op: &str) {
    if !crate::models::TASK_STATUSES.contains(&status) {
        tracing::warn!(
            status,
            op,
            "dev_tasks: unknown status written — the Run Desk renders only {:?}",
            crate::models::TASK_STATUSES
        );
    }
}

// ============================================================================
// Tasks
// ============================================================================

pub fn list_tasks(
    pool: &DbPool,
    project_id: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_tasks", {
        let conn = pool.get()?;
        let mut qb = QueryBuilder::new();

        if let Some(v) = project_id {
            qb.where_eq("project_id", v.to_string());
        }
        if let Some(v) = status {
            qb.where_eq("status", v.to_string());
        }

        qb.order_by("created_at", "DESC");

        let sql = qb.build_select("SELECT * FROM dev_tasks");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_task)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_task_by_id(pool: &DbPool, id: &str) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::get_task_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_tasks WHERE id = ?1",
            params![id],
            row_to_task,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev task {id}")),
            other => AppError::Database(other),
        })
    })
}

/// Return up to `limit` queued tasks for `project_id` whose upstream goal
/// chain is fully `completed` (or whose `goal_id` is NULL — orphan-ready).
///
/// Tasks whose upstream contains a `failed` or `cancelled` goal are
/// **excluded** from the ready set; they remain `queued` in the DB until
/// the user manually re-runs after fixing the upstream.
///
/// Sorted FIFO by `created_at`. Used by the auto-run scheduler.
pub fn list_ready_tasks(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_ready_tasks", {
        let goal_state = list_goal_statuses_with_deps(pool, project_id)?;

        // Walks the upstream closure of `gid` and reports the *worst* status seen.
        // Returns: "completed" if every upstream goal is completed (or gid has no
        // upstream); "blocked" if any upstream is queued/in_progress; "failed" if
        // any upstream is failed/cancelled.
        fn upstream_state(gid: &str, map: &HashMap<String, (String, Vec<String>)>) -> &'static str {
            let mut visited: HashSet<String> = HashSet::new();
            let mut stack: Vec<String> = vec![gid.to_string()];
            let mut blocked = false;
            while let Some(node) = stack.pop() {
                if !visited.insert(node.clone()) {
                    continue;
                }
                if let Some((status, deps)) = map.get(&node) {
                    // The starting node's own status is irrelevant for readiness;
                    // only its upstream matters. Skip it.
                    if node != gid {
                        match status.as_str() {
                            "failed" | "cancelled" => return "failed",
                            "completed" => {}
                            _ => blocked = true,
                        }
                    }
                    for d in deps {
                        stack.push(d.clone());
                    }
                }
            }
            if blocked {
                "blocked"
            } else {
                "completed"
            }
        }

        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_tasks \
             WHERE project_id = ?1 AND status = 'queued' \
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_task)?;

        let mut out: Vec<DevTask> = Vec::new();
        for r in rows {
            let task = r.map_err(AppError::Database)?;
            let ready = match task.goal_id.as_deref() {
                None => true,
                Some(gid) => upstream_state(gid, &goal_state) == "completed",
            };
            if ready {
                out.push(task);
                if out.len() >= limit {
                    break;
                }
            }
        }
        Ok(out)
    })
}

/// The `error` prefix an App Master dispatch's ABANDONED task carries.
///
/// A decide-lane dispatch mints a `dev_tasks` row at spawn so the
/// undispatched-idea sensor stops offering an idea that is already in hand
/// (`engine/subscription/attention.rs`, `mint_dispatch_task`). When the worker
/// dies — or ends on a usage limit — without calling the write-back route, that
/// row would otherwise sit `running` forever: the idea is neither delivered nor
/// re-offered. The sweep that closes such a row stamps this prefix into `error`,
/// and it is the ONE marker that tells an abandoned dispatch apart from a task
/// a human (or the write-back door's `blocked` outcome) deliberately failed.
///
/// The undispatched sensor keys on it (`dev/attention.rs`) so — and ONLY so —
/// an abandoned dispatch hands its idea back to the backlog. It carries no SQL
/// `LIKE` wildcard (`%` / `_`), which is what lets that clause interpolate it
/// literally.
pub const ABANDONED_DISPATCH_ERROR_PREFIX: &str = "worker ended without write-back: ";

/// The fleet registry's state token for a session the stale sweeper has parked
/// (`types::state_to_token(FleetSessionState::Stale)`). Spelled here rather
/// than imported because the db crate sits below the fleet registry; the app
/// crate's `orphaned_task_tick` test pins the two together.
pub const STALE_SESSION_STATE: &str = "stale";

/// How long a fleet session must have stayed `stale` before a sweep may treat
/// its worker as gone. The stale sweeper flags a session after six minutes of
/// flat transcript, and revives it the moment the log grows again — a worker
/// inside a long test run trips it routinely. Forty-five minutes is longer than
/// any single tool call a delivery worker has been measured to make (the
/// longest gate run in the Bank: 23 min) and shorter than a wake interval, so a
/// worker that is truly dead is released before its App Master next looks.
pub const STALE_WORKER_END_MINUTES: i64 = 45;

/// `true` when a session's last transition (`updated_at_ms`) is at least
/// [`STALE_WORKER_END_MINUTES`] old. A missing timestamp reads as "old": a row
/// the registry never stamped is not one it is about to revive.
pub fn stale_long_enough_to_be_gone(updated_at_ms: Option<i64>, now_ms: i64) -> bool {
    match updated_at_ms {
        Some(t) => now_ms - t >= STALE_WORKER_END_MINUTES * 60_000,
        None => true,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn create_task(
    pool: &DbPool,
    project_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    source_idea_id: Option<&str>,
    goal_id: Option<&str>,
    status: Option<&str>,
    depth: Option<&str>,
) -> Result<DevTask, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    timed_query!("dev_tasks", "dev_tasks::create_task", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = status.unwrap_or("queued");
        warn_unknown_task_status(status, "create_task");
        let depth = depth.unwrap_or("quick");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, project_id, title, description, source_idea_id, goal_id, status, depth, now],
        )?;

        get_task_by_id(pool, &id)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update_task(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    session_id: Option<Option<&str>>,
    progress_pct: Option<i32>,
    output_lines: Option<i32>,
    error: Option<Option<&str>>,
    started_at: Option<Option<&str>>,
    completed_at: Option<Option<&str>>,
) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::update_task", {
        get_task_by_id(pool, id)?;
        if let Some(s) = status {
            warn_unknown_task_status(s, "update_task");
        }
        let conn = pool.get()?;

        let mut sets: Vec<String> = Vec::new();
        let mut param_idx = 1u32;

        push_field!(title, "title", sets, param_idx);
        push_field!(description, "description", sets, param_idx);
        push_field!(status, "status", sets, param_idx);
        push_field!(session_id, "session_id", sets, param_idx);
        push_field!(progress_pct, "progress_pct", sets, param_idx);
        push_field!(output_lines, "output_lines", sets, param_idx);
        push_field!(error, "error", sets, param_idx);
        push_field!(started_at, "started_at", sets, param_idx);
        push_field!(completed_at, "completed_at", sets, param_idx);

        if sets.is_empty() {
            // Nothing actually changed — do NOT bump updated_at. Every caller
            // that passes all-None is a no-op, and stamping one would forge a
            // heartbeat the attention queue reads as "this task is alive".
            return get_task_by_id(pool, id);
        }

        // Every real mutation stamps updated_at. This is the single choke point:
        // task_executor.rs drives all of its writes (start, progress milestones,
        // output-volume fallback, terminal status) through this function, so
        // stamping here covers every path that touches a task.
        let touched_at = chrono::Utc::now().to_rfc3339();
        sets.push(format!("updated_at = ?{param_idx}"));
        param_idx += 1;

        let sql = format!(
            "UPDATE dev_tasks SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(v) = title {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = description {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = status {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = session_id {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = progress_pct {
            param_values.push(Box::new(v));
        }
        if let Some(v) = output_lines {
            param_values.push(Box::new(v));
        }
        if let Some(v) = error {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = started_at {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = completed_at {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        param_values.push(Box::new(touched_at));
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_task_by_id(pool, id)
    })
}

/// Record where a run is actually executing (Grand Simulation G12).
///
/// A separate door rather than three more `Option` parameters on
/// [`update_task`], which already takes nine: these three are written exactly
/// once per run, by one caller, at a different moment from every other field —
/// and they are the only fields whose *combination* carries meaning
/// (`branch` xor `fallback_reason`), which a field-at-a-time signature hides.
///
/// Both `branch` and `fallback_reason` are always written, so a re-run that
/// becomes isolated clears the previous run's fallback note and a re-run that
/// falls back clears the stale branch. Stamps `updated_at` like every other
/// real mutation — the task IS alive at this point, it is about to spawn.
pub fn record_task_worktree(
    pool: &DbPool,
    id: &str,
    path: &str,
    branch: Option<&str>,
    fallback_reason: Option<&str>,
) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::record_task_worktree", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_tasks
                SET worktree_path = ?1,
                    worktree_branch = ?2,
                    worktree_fallback_reason = ?3,
                    updated_at = ?4
              WHERE id = ?5",
            params![
                path,
                branch,
                fallback_reason,
                chrono::Utc::now().to_rfc3339(),
                id
            ],
        )?;
        get_task_by_id(pool, id)
    })
}

/// Every isolated worktree a task recorded, with whether that task may still
/// be using it: `(worktree_path, possibly_live)`.
///
/// Only `completed`, `failed` and `cancelled` count as finished. Any other
/// status — including one this list does not know — reads as possibly live,
/// because being wrong in that direction keeps a directory, never deletes an
/// agent's working copy. Fallback runs (no `worktree_branch`) are excluded:
/// their path is the project root, which is never a worktree to retire.
pub fn list_task_worktree_owners(pool: &DbPool) -> Result<Vec<(String, bool)>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_task_worktree_owners", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT worktree_path, status FROM dev_tasks
              WHERE worktree_path IS NOT NULL AND worktree_branch IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>("worktree_path")?,
                r.get::<_, String>("status")?,
            ))
        })?;
        let mut owners = Vec::new();
        for row in rows {
            let (path, status) = row?;
            let finished = matches!(status.as_str(), "completed" | "failed" | "cancelled");
            owners.push((path, !finished));
        }
        Ok(owners)
    })
}

/// The projection [`row_to_task`] actually consumes, named beside the mapper
/// that reads it so the two cannot drift.
///
/// Deliberately NOT retrofitted onto the pre-existing `SELECT *` queries in
/// this file — see the twin note on `IDEA_COLUMNS` in `ideas.rs`: converting
/// them here would take the census's `select-star-in-repo` count down through
/// its baseline in a change that is not about that.
const TASK_COLUMNS: &str = "id, project_id, title, description, source_idea_id, goal_id, status, \
     session_id, progress_pct, output_lines, error, started_at, completed_at, created_at, \
     updated_at, depth, parent_task_id, attempt, worktree_path, worktree_branch, \
     worktree_fallback_reason";

/// The newest `dev_tasks` row promoted from `idea_id`, or `None` when nobody
/// ever dispatched it.
///
/// This is the exact inverse of the `NOT EXISTS (… WHERE t.source_idea_id = i.id)`
/// clause the undispatched-idea sensor keys on (`dev/attention.rs`), so a
/// caller can ask "has this idea got a task yet" through the same relation the
/// sensor answers with — rather than listing a project's tasks and filtering in
/// Rust, which is what every other reader of this relation would otherwise do.
/// Attribute an idea's delivery tasks to the goal the idea now serves, on
/// every task that serves no goal yet. Returns how many rows changed.
///
/// A task inherits its idea's goal when it is minted (G41), so this is the
/// after-the-fact half: an idea bound to a goal once its work already ran
/// leaves its tasks unattributed, and a goal's progress reads the tasks.
/// A task that already names a goal keeps it.
pub fn link_idea_tasks_to_goal(
    pool: &DbPool,
    idea_id: &str,
    goal_id: &str,
) -> Result<usize, AppError> {
    timed_query!("dev_tasks", "dev_tasks::link_idea_tasks_to_goal", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let n = conn.execute(
            "UPDATE dev_tasks SET goal_id = ?1, updated_at = ?2 \
             WHERE source_idea_id = ?3 AND goal_id IS NULL",
            params![goal_id, now, idea_id],
        )?;
        Ok(n)
    })
}

pub fn latest_task_for_idea(pool: &DbPool, idea_id: &str) -> Result<Option<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::latest_task_for_idea", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {TASK_COLUMNS} FROM dev_tasks WHERE source_idea_id = ?1 \
             ORDER BY created_at DESC, id DESC LIMIT 1"
        ))?;
        stmt.query_row(params![idea_id], row_to_task)
            .optional()
            .map_err(AppError::Database)
    })
}

/// Tasks a project has in flight right now — `running` first, then `queued`,
/// oldest-started first inside each band, capped at `limit`.
///
/// The App Master's decision reads this so a charter it dispatched last wake is
/// visible as work already under way. Without it the loop sees only the
/// *sensor* ("accepted ideas with no task"), which goes quiet the moment a task
/// exists but says nothing about the run that is still going.
pub fn list_in_flight_tasks(
    pool: &DbPool,
    project_id: &str,
    limit: usize,
) -> Result<Vec<DevTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::list_in_flight_tasks", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {TASK_COLUMNS} FROM dev_tasks \
             WHERE project_id = ?1 AND status IN ('running', 'queued') \
             ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, \
                      COALESCE(started_at, created_at) ASC, id ASC \
             LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![project_id, limit as i64], row_to_task)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// How many of a project's fleet-dispatched tasks are still holding a LIVE
/// session, judged by the fleet registry rather than by `dev_tasks.status`.
///
/// The distinction is the whole point. A fleet dispatch stamps its task
/// `running` the moment the spawn returns a session id and nothing ever stamps
/// it back — the session's own death is recorded in `fleet_sessions.state` by
/// the staleness ticker, not in the task row. So `COUNT(*) WHERE status =
/// 'running'` is a count of dispatches ever made, not of workers alive, and a
/// drain built on it would stay blocked forever after the first wave.
///
/// `live_states` is the caller's vocabulary (`spawning` | `running` |
/// `awaiting_input` | …), passed in the same way
/// [`crate::repos::fleet_sessions::count_active_for_run_label`] takes it —
/// `FleetSessionState` lives in the app crate and the db crate cannot see it.
/// An empty slice returns `0` without querying: no live state means nothing can
/// be live.
///
/// The `JOIN` is what makes this project-scoped. `fleet_sessions` carries no
/// project column at all — only `run_label`, `run_id` and `cwd` — so the task
/// row is the only thing that ties a session to a project.
pub fn count_live_fleet_tasks(
    pool: &DbPool,
    project_id: &str,
    live_states: &[&str],
) -> Result<usize, AppError> {
    if live_states.is_empty() {
        return Ok(0);
    }
    timed_query!("dev_tasks", "dev_tasks::count_live_fleet_tasks", {
        let conn = pool.get()?;
        let placeholders = (0..live_states.len())
            .map(|i| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT COUNT(*) AS n FROM dev_tasks t \
             JOIN fleet_sessions s ON s.id = t.session_id \
             WHERE t.project_id = ?1 AND t.status = 'running' \
               AND s.state IN ({placeholders})"
        );
        let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(live_states.len() + 1);
        args.push(&project_id);
        for st in live_states {
            args.push(st);
        }
        let n: i64 = conn.query_row(&sql, args.as_slice(), |r| r.get("n"))?;
        Ok(n.max(0) as usize)
    })
}

/// A `running` task row whose worker is gone, as the sweep found it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrphanedTask {
    pub id: String,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
    /// Why the row is an orphan, in the words written into `error`.
    pub reason: String,
}

/// G45 — release every `running` task whose worker is gone.
///
/// A fleet dispatch stamps its task `running` when the spawn returns a session
/// id and nothing ever stamps it back (see [`count_live_fleet_tasks`], which
/// works around exactly this for the cap). The row then holds its idea for
/// ever: the App Master cannot re-dispatch it, the "accepted, no task" sensor
/// stays quiet, and the finding it carries reaches nobody. Measured
/// 2026-09-13 across one install: **65 rows read `running`, 0 with a live
/// worker** — 32 named a session that does not exist, 21 a session that had
/// finished without a verdict written back, 12 a session reaped stale; three of
/// them had locked bank-contracts' CI-evidence cluster for four days.
///
/// `live_states` is the fleet registry's vocabulary of a worker that may still
/// deliver (`spawning` | `running` | `awaiting_input` | `idle`), passed the
/// way [`count_live_fleet_tasks`] takes it. A row is swept when it has no
/// session id, its session row is missing, or its session is in any other
/// state — but only once it has been untouched for `min_age_minutes`, so a
/// spawn that has returned an id and not yet stamped the row is left alone.
/// Swept rows go to `failed` with an `error` naming what was gone; the idea is
/// then re-dispatchable and the ledger tells the truth about the wave.
///
/// **Two corrections measured 2026-09-15, both from watching the Bank run.**
///
/// 1. *A `stale` session is not a gone worker.* The stale sweeper's flat-log
///    rule fires after six minutes without transcript growth and is revivable
///    by design (`stale:growth-revive`): a delivery worker inside a long
///    `cargo test` is exactly that. This sweep read `stale` as "not live" and
///    released the worker's whole claim within one tick — seven sessions and
///    22 tasks in the minute after 18:06 on 2026-09-14 — so a worker that later
///    finished found its rows already `failed`. A stale session now counts as
///    gone only once it has stayed stale for [`STALE_WORKER_END_MINUTES`]
///    (`fleet_sessions.updated_at_ms` is its last transition).
/// 2. *The error must carry [`ABANDONED_DISPATCH_ERROR_PREFIX`].* The
///    undispatched-idea sensor hands an idea back ONLY when its failed task's
///    `error` starts with that prefix; this sweep wrote `worker gone: …`, so
///    every idea it released was neither delivered nor re-offered — 34 of the
///    Bank's accepted ideas were invisible to their App Masters two days after
///    the sweep that claimed to free them. The reason text stays verbatim after
///    the prefix, so nothing that reads `worker gone` breaks.
pub fn sweep_orphaned_running_tasks(
    pool: &DbPool,
    live_states: &[&str],
    min_age_minutes: i64,
) -> Result<Vec<OrphanedTask>, AppError> {
    timed_query!("dev_tasks", "dev_tasks::sweep_orphaned_running_tasks", {
        let conn = pool.get()?;
        let placeholders = if live_states.is_empty() {
            "''".to_string()
        } else {
            (0..live_states.len())
                .map(|i| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let sql = format!(
            "SELECT t.id, t.project_id, t.session_id, s.state, s.updated_at_ms,                     COALESCE(t.updated_at, t.started_at, t.created_at) AS touched_at              FROM dev_tasks t LEFT JOIN fleet_sessions s ON s.id = t.session_id              WHERE t.status = 'running'                AND (t.session_id IS NULL OR s.id IS NULL OR s.state NOT IN ({placeholders}))"
        );
        let args: Vec<&dyn rusqlite::ToSql> = live_states
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        let mut stmt = conn.prepare(&sql)?;
        let candidates = stmt
            .query_map(args.as_slice(), |r| {
                Ok((
                    r.get::<_, String>("id")?,
                    r.get::<_, Option<String>>("project_id")?,
                    r.get::<_, Option<String>>("session_id")?,
                    r.get::<_, Option<String>>("state")?,
                    r.get::<_, Option<i64>>("updated_at_ms")?,
                    r.get::<_, Option<String>>("touched_at")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        let now = chrono::Utc::now();
        let cutoff = now - chrono::Duration::minutes(min_age_minutes.max(0));
        let now_s = now.to_rfc3339();
        let now_ms = now.timestamp_millis();
        let mut swept = Vec::new();
        for (id, project_id, session_id, state, session_updated_ms, touched_at) in candidates {
            // Untouched for less than the grace: a spawn may still be stamping it.
            if let Some(t) = touched_at.as_deref().and_then(parse_task_timestamp) {
                if t > cutoff {
                    continue;
                }
            }
            // Stale, but not for long enough to be gone: the worker may revive.
            if state.as_deref() == Some(STALE_SESSION_STATE)
                && !stale_long_enough_to_be_gone(session_updated_ms, now_ms)
            {
                continue;
            }
            let reason = match (&session_id, &state) {
                (None, _) => {
                    "worker gone: no fleet session was ever recorded on this row".to_string()
                }
                (Some(sid), None) => format!("worker gone: fleet session {sid} does not exist"),
                (Some(sid), Some(st)) => {
                    format!("worker gone: fleet session {sid} is '{st}' and wrote no verdict back")
                }
            };
            let error = format!(
                "{ABANDONED_DISPATCH_ERROR_PREFIX}{reason} (swept by the orphaned-task sweep at {now_s})"
            );
            // The `status = 'running'` guard is a compare-and-set: a worker
            // that wrote its verdict between the candidate read and this
            // write wins, and the row it settled must not be reported as
            // swept. The affected-row count is the only evidence of which
            // happened, so it decides whether this row joins the report.
            let changed = conn.execute(
                "UPDATE dev_tasks SET status = 'failed', error = ?1, completed_at = ?2,                  updated_at = ?2 WHERE id = ?3 AND status = 'running'",
                params![error, now_s, id],
            )?;
            if changed == 0 {
                continue; // settled by its worker in the race window — not ours
            }
            swept.push(OrphanedTask {
                id,
                project_id,
                session_id,
                reason,
            });
        }
        Ok(swept)
    })
}

/// Task timestamps are RFC 3339 (written by `create_task` / `update_task`);
/// older rows and hand edits may carry SQLite's `YYYY-MM-DD HH:MM:SS`. Both
/// parse; anything else reads as "unknown age" and the caller sweeps it.
fn parse_task_timestamp(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(t.with_timezone(&chrono::Utc));
    }
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|n| n.and_utc())
}

pub fn delete_task(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_tasks", "dev_tasks::delete_task", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_tasks WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

/// One keyset page of tasks plus per-status counts. Same cursor scheme as
/// `triage_ideas` (`"{created_at}|{id}"`, `created_at DESC, id DESC`).
/// `list_tasks` stays untouched for the existing unpaginated callers.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TasksPage {
    pub tasks: Vec<DevTask>,
    pub cursor: Option<String>,
    pub has_more: bool,
    /// Per-status totals scoped to the project (NOT to the status filter), so
    /// status chips stay truthful beyond the loaded page.
    pub counts: HashMap<String, u32>,
}

const TASKS_PAGE_DEFAULT_LIMIT: i64 = 40;
const TASKS_PAGE_MAX_LIMIT: i64 = 200;

pub fn tasks_page(
    pool: &DbPool,
    project_id: Option<&str>,
    statuses: Option<&[String]>,
    limit: Option<i64>,
    cursor: Option<&str>,
) -> Result<TasksPage, AppError> {
    timed_query!("dev_tasks", "dev_tasks::tasks_page", {
        let limit = limit
            .unwrap_or(TASKS_PAGE_DEFAULT_LIMIT)
            .clamp(1, TASKS_PAGE_MAX_LIMIT);

        let mut clauses: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(pid) = project_id {
            clauses.push("project_id = ?".to_string());
            params.push(Box::new(pid.to_string()));
        }
        // An empty `statuses` vec is "no status filter", not "match nothing" —
        // an empty IN () is a SQL error and a blank filter chip must not
        // silently blank the list.
        if let Some(list) = statuses.filter(|s| !s.is_empty()) {
            let placeholders = vec!["?"; list.len()].join(", ");
            clauses.push(format!("status IN ({placeholders})"));
            for s in list {
                params.push(Box::new(s.clone()));
            }
        }
        if let Some(raw) = cursor.filter(|c| !c.is_empty()) {
            let (created_at, id) = raw
                .split_once('|')
                .ok_or_else(|| AppError::Validation(format!("Malformed tasks cursor: {raw}")))?;
            clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(id.to_string()));
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", clauses.join(" AND "))
        };
        let sql = format!(
            "SELECT * FROM dev_tasks{where_sql} ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        );

        let conn = pool.get()?;
        let mut tasks: Vec<DevTask> = {
            let mut stmt = conn.prepare(&sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), row_to_task)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        let has_more = tasks.len() as i64 > limit;
        if has_more {
            tasks.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            tasks.last().map(|t| format!("{}|{}", t.created_at, t.id))
        } else {
            None
        };

        let counts: HashMap<String, u32> = {
            let (count_sql, count_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
                match project_id {
                    Some(pid) => (
                        "SELECT status, COUNT(*) AS n FROM dev_tasks WHERE project_id = ? GROUP BY status"
                            .to_string(),
                        vec![Box::new(pid.to_string())],
                    ),
                    None => (
                        "SELECT status, COUNT(*) AS n FROM dev_tasks GROUP BY status".to_string(),
                        Vec::new(),
                    ),
                };
            let mut stmt = conn.prepare(&count_sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                count_params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), |row| {
                    Ok((
                        row.get::<_, String>("status")?,
                        row.get::<_, i64>("n")?.max(0) as u32,
                    ))
                })?
                .collect::<Result<HashMap<_, _>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        Ok(TasksPage {
            tasks,
            cursor: next_cursor,
            has_more,
            counts,
        })
    })
}

/// Create a fresh `queued` task as a re-attempt of `task_id`.
///
/// The title is copied VERBATIM — no `[Retry] ` prefix. The prefix used to
/// accumulate across attempts and, worse, it changed the text the executor
/// prompts with, so a retry was not a re-run of the same instruction. Lineage
/// lives in `parent_task_id` / `attempt`, which the UI renders as a chip.
pub fn retry_task(pool: &DbPool, task_id: &str) -> Result<DevTask, AppError> {
    timed_query!("dev_tasks", "dev_tasks::retry_task", {
        let parent = get_task_by_id(pool, task_id)?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, status, depth, parent_task_id, attempt, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?10)",
            params![
                id,
                parent.project_id,
                parent.title,
                parent.description,
                parent.source_idea_id,
                parent.goal_id,
                parent.depth,
                parent.id,
                parent.attempt.saturating_add(1),
                now,
            ],
        )?;

        get_task_by_id(pool, &id)
    })
}

// Keyset-pagination + retry-lineage tests for the unified Backlog / Run Desk.
// Same `#[path]` arrangement as the backlog tests beside the ideas repo.
#[cfg(test)]
#[path = "tasks_page_tests.rs"]
mod page_tests;

/// G5: `count_live_fleet_tasks` reads the fleet REGISTRY, not `dev_tasks.status`.
#[cfg(test)]
mod live_fleet_task_tests {
    use super::*;
    use crate::init_test_db;
    use crate::repos::dev::projects;
    use crate::repos::fleet_sessions;
    use crate::PoolExt;

    /// The states the dispatch cap treats as holding a slot.
    const LIVE: [&str; 3] = ["spawning", "running", "awaiting_input"];

    fn session(id: &str, state: &str) -> fleet_sessions::FleetSessionRow {
        fleet_sessions::FleetSessionRow {
            id: id.into(),
            claude_session_id: format!("cs-{id}"),
            cwd: "/tmp/p".into(),
            project_label: "personas".into(),
            name: None,
            title: None,
            args_json: "[]".into(),
            mode: "headless".into(),
            state: state.into(),
            state_reason: None,
            run_id: Some("run-1".into()),
            run_label: Some("dispatch".into()),
            created_at_ms: 1,
            last_activity_ms: 1_000,
        }
    }

    fn mk_project(pool: &DbPool, name: &str) -> String {
        projects::create_project(
            pool,
            name,
            &format!("/tmp/{name}"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .id
    }

    /// A task in `project`, at `task_status`, bound to a session in `state`.
    fn dispatched(pool: &DbPool, project: &str, n: usize, state: &str, task_status: &str) {
        let sid = format!("sess-{project}-{n}");
        fleet_sessions::upsert(pool, &session(&sid, state)).unwrap();
        let t = create_task(
            pool,
            Some(project),
            &format!("task {n} {state}"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        update_task(
            pool,
            &t.id,
            None,
            None,
            Some(task_status),
            Some(Some(sid.as_str())),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    }

    fn running_tasks(pool: &DbPool, project: &str) -> i64 {
        // Through `PoolExt::conn` and by column NAME, like production code:
        // the census counts a test's `pool.get().unwrap()` and `row.get(0)`
        // the same way it counts a repo's, and a fixture is not a licence.
        let conn = pool.conn("test::running_tasks").unwrap();
        conn.query_row(
            "SELECT COUNT(*) AS n FROM dev_tasks \
             WHERE project_id = ?1 AND status = 'running'",
            params![project],
            |r| r.get("n"),
        )
        .unwrap()
    }

    /// G45: a running row whose worker is gone is released to `failed` with the
    /// reason in `error`; a row whose worker is live is untouched; a row younger
    /// than the grace is left for the spawn to finish stamping it.
    #[test]
    fn the_sweep_releases_rows_whose_worker_is_gone_and_keeps_live_ones() {
        let pool = init_test_db().unwrap();
        let p = mk_project(&pool, "sweep");
        dispatched(&pool, &p, 1, "running", "running"); // live
        dispatched(&pool, &p, 2, "finished", "running"); // finished, no verdict
        dispatched(&pool, &p, 3, "stale", "running"); // stale long enough (aged below)
        {
            // A fresh `stale` is revivable and is NOT gone; only one that has
            // held for the whole window is — see the dedicated test below.
            let conn = pool.conn("test::age_stale").unwrap();
            let old = personas_core::utils::now_ms() - (STALE_WORKER_END_MINUTES + 1) * 60_000;
            conn.execute(
                "UPDATE fleet_sessions SET updated_at_ms = ?1 WHERE id = ?2",
                params![old, format!("sess-{p}-3")],
            )
            .unwrap();
        }
        // No session at all.
        let orphan =
            create_task(&pool, Some(&p), "no session", None, None, None, None, None).unwrap();
        update_task(
            &pool,
            &orphan.id,
            None,
            None,
            Some("running"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        // A session id that no row carries.
        let ghost = create_task(
            &pool,
            Some(&p),
            "ghost session",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        update_task(
            &pool,
            &ghost.id,
            None,
            None,
            Some("running"),
            Some(Some("sess-nowhere")),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(running_tasks(&pool, &p), 5);

        // Within the grace nothing moves: every row was touched a moment ago.
        let none = sweep_orphaned_running_tasks(&pool, &LIVE, 15).unwrap();
        assert!(none.is_empty(), "{none:?}");
        assert_eq!(running_tasks(&pool, &p), 5);

        // Past the grace, four are released and the live one stays.
        let swept = sweep_orphaned_running_tasks(&pool, &LIVE, 0).unwrap();
        assert_eq!(swept.len(), 4, "{swept:?}");
        assert_eq!(running_tasks(&pool, &p), 1);
        let by_id: HashMap<String, OrphanedTask> =
            swept.into_iter().map(|o| (o.id.clone(), o)).collect();
        assert!(by_id[&orphan.id]
            .reason
            .contains("no fleet session was ever recorded"));
        assert!(by_id[&ghost.id]
            .reason
            .contains("sess-nowhere does not exist"));
        let finished_id = by_id
            .values()
            .find(|o| o.reason.contains("is 'finished'"))
            .map(|o| o.id.clone())
            .unwrap();
        let finished = get_task_by_id(&pool, &finished_id).unwrap();
        assert_eq!(finished.status, "failed");
        assert!(finished
            .error
            .as_deref()
            .unwrap_or("")
            .contains("'finished' and wrote no verdict back"));
        assert!(finished.completed_at.is_some());
        // Idempotent: a second pass finds nothing.
        assert!(sweep_orphaned_running_tasks(&pool, &LIVE, 0)
            .unwrap()
            .is_empty());
    }

    /// 2026-09-15: a `stale` session is revivable, so its tasks are released
    /// only once it has stayed stale for [`STALE_WORKER_END_MINUTES`]; and a
    /// swept row carries [`ABANDONED_DISPATCH_ERROR_PREFIX`], which is the one
    /// marker that lets the undispatched-idea sensor hand the idea back.
    #[test]
    fn a_freshly_stale_session_keeps_its_tasks_and_an_old_one_releases_them_with_the_prefix() {
        let pool = init_test_db().unwrap();
        let p = mk_project(&pool, "stale");
        dispatched(&pool, &p, 0, "stale", "running");
        assert_eq!(running_tasks(&pool, &p), 1);
        // Just flagged stale: nothing moves, even past the task grace.
        let none = sweep_orphaned_running_tasks(&pool, &LIVE, 0).unwrap();
        assert!(none.is_empty(), "{none:?}");
        assert_eq!(running_tasks(&pool, &p), 1);
        // Age the session's last transition past the stale window.
        {
            let conn = pool.conn("test::age_stale").unwrap();
            let old = personas_core::utils::now_ms() - (STALE_WORKER_END_MINUTES + 1) * 60_000;
            conn.execute(
                "UPDATE fleet_sessions SET updated_at_ms = ?1 WHERE id = ?2",
                params![old, format!("sess-{p}-0")],
            )
            .unwrap();
        }
        let swept = sweep_orphaned_running_tasks(&pool, &LIVE, 0).unwrap();
        assert_eq!(swept.len(), 1, "{swept:?}");
        let task = get_task_by_id(&pool, &swept[0].id).unwrap();
        assert_eq!(task.status, "failed");
        let error = task.error.as_deref().unwrap_or("");
        assert!(
            error.starts_with(ABANDONED_DISPATCH_ERROR_PREFIX),
            "{error}"
        );
        assert!(
            error.contains("is 'stale' and wrote no verdict back"),
            "{error}"
        );
    }

    #[test]
    fn the_stale_window_reads_a_missing_stamp_as_old() {
        let now = 10 * STALE_WORKER_END_MINUTES * 60_000;
        assert!(stale_long_enough_to_be_gone(None, now));
        assert!(!stale_long_enough_to_be_gone(Some(now - 60_000), now));
        assert!(stale_long_enough_to_be_gone(
            Some(now - STALE_WORKER_END_MINUTES * 60_000),
            now
        ));
    }

    #[test]
    fn a_task_whose_session_has_ended_stops_being_counted() {
        let pool = init_test_db().unwrap();
        let p = mk_project(&pool, "one");
        // Three dispatches, all still `status = 'running'` in dev_tasks —
        // nothing ever stamps a task back when its session dies.
        for (i, state) in ["running", "finished", "exited"].iter().enumerate() {
            dispatched(&pool, &p, i, state, "running");
        }

        // Reading the task status alone would say three are in flight.
        assert_eq!(
            running_tasks(&pool, &p),
            3,
            "the task rows all still say running"
        );

        // The registry says one. That is the number the cap uses; without it a
        // drain would stay blocked forever after the first wave.
        assert_eq!(count_live_fleet_tasks(&pool, &p, &LIVE).unwrap(), 1);
    }

    #[test]
    fn every_live_state_holds_a_slot_including_awaiting_input() {
        let pool = init_test_db().unwrap();
        let p = mk_project(&pool, "two");
        for (i, state) in LIVE.iter().enumerate() {
            dispatched(&pool, &p, i, state, "running");
        }
        assert_eq!(
            count_live_fleet_tasks(&pool, &p, &LIVE).unwrap(),
            3,
            "a session parked on a question is still a live process"
        );
    }

    #[test]
    fn the_count_is_scoped_to_one_project() {
        let pool = init_test_db().unwrap();
        let a = mk_project(&pool, "alpha");
        let b = mk_project(&pool, "beta");
        let c = mk_project(&pool, "gamma");
        dispatched(&pool, &a, 0, "running", "running");
        dispatched(&pool, &b, 1, "running", "running");
        dispatched(&pool, &b, 2, "running", "running");
        assert_eq!(count_live_fleet_tasks(&pool, &a, &LIVE).unwrap(), 1);
        assert_eq!(count_live_fleet_tasks(&pool, &b, &LIVE).unwrap(), 2);
        assert_eq!(count_live_fleet_tasks(&pool, &c, &LIVE).unwrap(), 0);
    }

    #[test]
    fn a_queued_task_holds_no_slot_even_with_a_live_session_row() {
        let pool = init_test_db().unwrap();
        let p = mk_project(&pool, "queued");
        // Bound to a live session but never started: `queued` is not in flight.
        dispatched(&pool, &p, 0, "running", "queued");
        assert_eq!(count_live_fleet_tasks(&pool, &p, &LIVE).unwrap(), 0);
    }

    /// An empty vocabulary short-circuits rather than building `IN ()`, which
    /// SQLite rejects as a syntax error.
    #[test]
    fn no_live_states_means_nothing_is_live() {
        let pool = init_test_db().unwrap();
        let p = mk_project(&pool, "empty");
        dispatched(&pool, &p, 0, "running", "running");
        assert_eq!(count_live_fleet_tasks(&pool, &p, &[]).unwrap(), 0);
    }

    /// The worktree sweep's owner map: finished statuses read as finished,
    /// every other status (an unknown one included) as possibly live, and a
    /// fallback run with no branch is not an owner at all.
    #[test]
    fn worktree_owners_treat_only_settled_statuses_as_finished() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("tasks::worktree_owners_test").unwrap();
        for (id, status, branch) in [
            ("t-done", "completed", Some("autopilot/done")),
            ("t-cancel", "cancelled", Some("autopilot/cancel")),
            ("t-run", "running", Some("autopilot/run")),
            ("t-odd", "paused_by_something_new", Some("autopilot/odd")),
            ("t-fallback", "completed", None),
        ] {
            conn.execute(
                "INSERT INTO dev_tasks (id, title, status, worktree_path, worktree_branch)
                 VALUES (?1, 'T', ?2, ?3, ?4)",
                params![id, status, format!("C:/data/worktrees/p/{id}"), branch],
            )
            .unwrap();
        }
        let mut owners = list_task_worktree_owners(&pool).unwrap();
        owners.sort();
        assert_eq!(
            owners,
            vec![
                ("C:/data/worktrees/p/t-cancel".to_string(), false),
                ("C:/data/worktrees/p/t-done".to_string(), false),
                ("C:/data/worktrees/p/t-odd".to_string(), true),
                ("C:/data/worktrees/p/t-run".to_string(), true),
            ]
        );
    }
}
