//! Design D — team deliberations repo (D2). CRUD for `team_deliberations` and
//! its `deliberation_agenda` backbone — persistence for the deliberation
//! governance core (`engine::deliberation`). See
//! docs/plans/team-deliberation-engine.md.

use rusqlite::{params, Row};

use crate::db::models::{CreateDeliberationInput, DeliberationAgendaItem, TeamDeliberation};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_deliberation(r: &Row) -> rusqlite::Result<TeamDeliberation> {
    Ok(TeamDeliberation {
        id: r.get("id")?,
        team_id: r.get("team_id")?,
        topic: r.get("topic")?,
        goal: r.get("goal")?,
        status: r.get("status")?,
        round: r.get("round")?,
        consecutive_stall_rounds: r.get("consecutive_stall_rounds")?,
        cost_budget_usd: r.get("cost_budget_usd")?,
        cost_spent_usd: r.get("cost_spent_usd")?,
        idle_deadline: r.get("idle_deadline")?,
        resolution: r.get("resolution")?,
        spawned_assignment_id: r.get("spawned_assignment_id")?,
        created_by: r.get("created_by")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn row_to_agenda(r: &Row) -> rusqlite::Result<DeliberationAgendaItem> {
    Ok(DeliberationAgendaItem {
        id: r.get("id")?,
        deliberation_id: r.get("deliberation_id")?,
        item: r.get("item")?,
        status: r.get("status")?,
        resolution: r.get("resolution")?,
        opened_by: r.get("opened_by")?,
        created_at: r.get("created_at")?,
        resolved_at: r.get("resolved_at")?,
    })
}

/// Open a deliberation (status 'open'). Validates topic; defaults `created_by`
/// to 'user'. The DB partial-unique index enforces one active deliberation per
/// team — a second open on the same team surfaces as a uniqueness error.
pub fn create(pool: &DbPool, input: CreateDeliberationInput) -> Result<TeamDeliberation, AppError> {
    timed_query!("deliberation", "deliberation::create", {
        let topic = input.topic.trim();
        if topic.is_empty() {
            return Err(AppError::Validation(
                "Deliberation topic cannot be empty".into(),
            ));
        }
        let id = format!("delib-{}", uuid::Uuid::new_v4());
        let created_by = input.created_by.unwrap_or_else(|| "user".into());
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO team_deliberations
               (id, team_id, topic, goal, status, round, consecutive_stall_rounds,
                cost_budget_usd, cost_spent_usd, idle_deadline, created_by,
                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'open', 0, 0, ?5, 0, ?6, ?7,
                     datetime('now'), datetime('now'))",
            params![
                id,
                input.team_id,
                topic,
                input.goal,
                input.cost_budget_usd,
                input.idle_deadline,
                created_by,
            ],
        )
        .map_err(AppError::Database)?;
        get(pool, &id)
    })
}

pub fn get(pool: &DbPool, id: &str) -> Result<TeamDeliberation, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM team_deliberations WHERE id = ?1",
        params![id],
        row_to_deliberation,
    )
    .map_err(AppError::Database)
}

/// The single active (non-terminal) deliberation for a team, if any.
pub fn get_active_for_team(
    pool: &DbPool,
    team_id: &str,
) -> Result<Option<TeamDeliberation>, AppError> {
    timed_query!("deliberation", "deliberation::get_active_for_team", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_deliberations
             WHERE team_id = ?1
               AND status IN ('open','converging','escalated','paused')
             ORDER BY datetime(updated_at) DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![team_id], |r| row_to_deliberation(r))?;
        match rows.next() {
            Some(row) => Ok(Some(row.map_err(AppError::Database)?)),
            None => Ok(None),
        }
    })
}

/// All deliberations the tick should advance — `open`/`converging` (live work).
/// `escalated`/`paused` wait on the user and are excluded; terminal ones too.
pub fn list_advanceable(pool: &DbPool) -> Result<Vec<TeamDeliberation>, AppError> {
    timed_query!("deliberation", "deliberation::list_advanceable", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM team_deliberations
             WHERE status IN ('open','converging')
             ORDER BY datetime(updated_at) ASC",
        )?;
        let rows = stmt.query_map([], |r| row_to_deliberation(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Apply a tick transition: round + stall counter + status.
pub fn update_progress(
    pool: &DbPool,
    id: &str,
    round: i32,
    consecutive_stall_rounds: i32,
    status: &str,
) -> Result<(), AppError> {
    timed_query!("deliberation", "deliberation::update_progress", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE team_deliberations
                SET round = ?2, consecutive_stall_rounds = ?3, status = ?4,
                    updated_at = datetime('now')
              WHERE id = ?1",
            params![id, round, consecutive_stall_rounds, status],
        )
        .map_err(AppError::Database)?;
        Ok(())
    })
}

/// Roll CLI spend into the deliberation's cost meter (the hard cost floor reads
/// this).
pub fn add_cost(pool: &DbPool, id: &str, usd: f64) -> Result<(), AppError> {
    timed_query!("deliberation", "deliberation::add_cost", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE team_deliberations
                SET cost_spent_usd = cost_spent_usd + ?2, updated_at = datetime('now')
              WHERE id = ?1",
            params![id, usd],
        )
        .map_err(AppError::Database)?;
        Ok(())
    })
}

/// Terminate a deliberation (resolve/abort) with an optional resolution blob +
/// spawned-assignment link.
pub fn finalize(
    pool: &DbPool,
    id: &str,
    status: &str,
    resolution: Option<&str>,
    spawned_assignment_id: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("deliberation", "deliberation::finalize", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE team_deliberations
                SET status = ?2, resolution = ?3, spawned_assignment_id = ?4,
                    updated_at = datetime('now')
              WHERE id = ?1",
            params![id, status, resolution, spawned_assignment_id],
        )
        .map_err(AppError::Database)?;
        Ok(())
    })
}

// ── Agenda backbone ─────────────────────────────────────────────────────────

pub fn add_agenda_item(
    pool: &DbPool,
    deliberation_id: &str,
    item: &str,
    opened_by: Option<&str>,
) -> Result<DeliberationAgendaItem, AppError> {
    timed_query!("deliberation", "deliberation::add_agenda_item", {
        let item = item.trim();
        if item.is_empty() {
            return Err(AppError::Validation("Agenda item cannot be empty".into()));
        }
        let id = format!("dagn-{}", uuid::Uuid::new_v4());
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO deliberation_agenda
               (id, deliberation_id, item, status, opened_by, created_at)
             VALUES (?1, ?2, ?3, 'open', ?4, datetime('now'))",
            params![id, deliberation_id, item, opened_by],
        )
        .map_err(AppError::Database)?;
        get_agenda_item(pool, &id)
    })
}

pub fn get_agenda_item(pool: &DbPool, id: &str) -> Result<DeliberationAgendaItem, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM deliberation_agenda WHERE id = ?1",
        params![id],
        row_to_agenda,
    )
    .map_err(AppError::Database)
}

/// Close an agenda item (`status` = 'resolved' | 'spawned').
pub fn resolve_agenda_item(
    pool: &DbPool,
    id: &str,
    status: &str,
    resolution: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("deliberation", "deliberation::resolve_agenda_item", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE deliberation_agenda
                SET status = ?2, resolution = ?3, resolved_at = datetime('now')
              WHERE id = ?1",
            params![id, status, resolution],
        )
        .map_err(AppError::Database)?;
        Ok(())
    })
}

pub fn list_agenda(
    pool: &DbPool,
    deliberation_id: &str,
) -> Result<Vec<DeliberationAgendaItem>, AppError> {
    timed_query!("deliberation", "deliberation::list_agenda", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM deliberation_agenda
             WHERE deliberation_id = ?1
             ORDER BY datetime(created_at) ASC",
        )?;
        let rows = stmt.query_map(params![deliberation_id], |r| row_to_agenda(r))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?)
    })
}

/// Count open agenda items — the termination signal (0 ⇒ resolve).
pub fn count_open_agenda(pool: &DbPool, deliberation_id: &str) -> Result<i64, AppError> {
    timed_query!("deliberation", "deliberation::count_open_agenda", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM deliberation_agenda
             WHERE deliberation_id = ?1 AND status = 'open'",
            params![deliberation_id],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}
