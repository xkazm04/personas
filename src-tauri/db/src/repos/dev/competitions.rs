use crate::models::{DevCompetition, DevCompetitionSlot};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

// ============================================================================
// Dev Competitions (multi-clone parallel task execution)
// ============================================================================

fn row_to_competition(row: &Row) -> rusqlite::Result<DevCompetition> {
    Ok(DevCompetition {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        task_title: row.get("task_title")?,
        task_description: row.get("task_description")?,
        source_idea_id: row.get("source_idea_id")?,
        source_goal_id: row.get("source_goal_id")?,
        slot_count: row.get("slot_count")?,
        status: row.get("status")?,
        winner_task_id: row.get("winner_task_id")?,
        winner_insight: row
            .get::<_, Option<String>>("winner_insight")
            .ok()
            .flatten(),
        baseline_json: row.get::<_, Option<String>>("baseline_json").ok().flatten(),
        reviewer_notes: row.get("reviewer_notes")?,
        worktree_base_ref: row
            .get::<_, Option<String>>("worktree_base_ref")
            .ok()
            .flatten(),
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

fn row_to_competition_slot(row: &Row) -> rusqlite::Result<DevCompetitionSlot> {
    Ok(DevCompetitionSlot {
        id: row.get("id")?,
        competition_id: row.get("competition_id")?,
        task_id: row.get("task_id")?,
        strategy_label: row.get("strategy_label")?,
        strategy_prompt: row.get("strategy_prompt")?,
        worktree_name: row.get("worktree_name")?,
        branch_name: row.get("branch_name")?,
        slot_index: row.get("slot_index")?,
        disqualified: row.get::<_, i32>("disqualified").unwrap_or(0) != 0,
        disqualify_reason: row
            .get::<_, Option<String>>("disqualify_reason")
            .ok()
            .flatten(),
        diff_hash: row.get::<_, Option<String>>("diff_hash").ok().flatten(),
        diff_stats_json: row
            .get::<_, Option<String>>("diff_stats_json")
            .ok()
            .flatten(),
        diff_analyzed_at: row
            .get::<_, Option<String>>("diff_analyzed_at")
            .ok()
            .flatten(),
        created_at: row.get("created_at")?,
    })
}

pub fn create_competition(
    pool: &DbPool,
    project_id: &str,
    task_title: &str,
    task_description: Option<&str>,
    source_idea_id: Option<&str>,
    source_goal_id: Option<&str>,
    slot_count: i32,
    worktree_base_ref: Option<&str>,
) -> Result<DevCompetition, AppError> {
    if task_title.trim().is_empty() {
        return Err(AppError::Validation(
            "Competition title cannot be empty".into(),
        ));
    }
    if !(2..=4).contains(&slot_count) {
        return Err(AppError::Validation("slot_count must be 2..=4".into()));
    }
    timed_query!("dev_competitions", "dev_competitions::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_competitions (id, project_id, task_title, task_description, source_idea_id, source_goal_id, slot_count, status, worktree_base_ref, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, ?9)",
            params![id, project_id, task_title, task_description, source_idea_id, source_goal_id, slot_count, worktree_base_ref, now],
        )?;
        get_competition_by_id(pool, &id)
    })
}

pub fn get_competition_by_id(pool: &DbPool, id: &str) -> Result<DevCompetition, AppError> {
    timed_query!("dev_competitions", "dev_competitions::get", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_competitions WHERE id = ?1",
            params![id],
            row_to_competition,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Competition {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn list_competitions_by_project(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevCompetition>, AppError> {
    timed_query!("dev_competitions", "dev_competitions::list", {
        let conn = pool.get()?;
        let rows: Vec<DevCompetition> = if let Some(s) = status {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_competitions WHERE project_id = ?1 AND status = ?2 ORDER BY created_at DESC",
            )?;
            let result = stmt
                .query_map(params![project_id, s], row_to_competition)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            result
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_competitions WHERE project_id = ?1 ORDER BY created_at DESC",
            )?;
            let result = stmt
                .query_map(params![project_id], row_to_competition)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            result
        };
        Ok(rows)
    })
}

pub fn update_competition_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    winner_task_id: Option<&str>,
    reviewer_notes: Option<&str>,
    winner_insight: Option<&str>,
) -> Result<DevCompetition, AppError> {
    timed_query!("dev_competitions", "dev_competitions::update_status", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let is_final = matches!(status, "resolved" | "cancelled");
        conn.execute(
            "UPDATE dev_competitions SET status = ?1, winner_task_id = COALESCE(?2, winner_task_id),
             reviewer_notes = COALESCE(?3, reviewer_notes),
             winner_insight = COALESCE(?4, winner_insight),
             resolved_at = CASE WHEN ?5 = 1 THEN ?6 ELSE resolved_at END
             WHERE id = ?7",
            params![status, winner_task_id, reviewer_notes, winner_insight, is_final as i32, now, id],
        )?;
        get_competition_by_id(pool, id)
    })
}

/// Persist diff analysis for a slot. Pass None for disqualify_reason to clear it.
pub fn update_slot_diff_analysis(
    pool: &DbPool,
    slot_id: &str,
    diff_hash: Option<&str>,
    diff_stats_json: Option<&str>,
    disqualified: bool,
    disqualify_reason: Option<&str>,
) -> Result<DevCompetitionSlot, AppError> {
    timed_query!(
        "dev_competition_slots",
        "dev_competition_slots::update_diff",
        {
            let conn = pool.get()?;
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE dev_competition_slots SET
                diff_hash = ?1,
                diff_stats_json = ?2,
                disqualified = ?3,
                disqualify_reason = ?4,
                diff_analyzed_at = ?5
             WHERE id = ?6",
                params![
                    diff_hash,
                    diff_stats_json,
                    disqualified as i32,
                    disqualify_reason,
                    now,
                    slot_id
                ],
            )?;
            conn.query_row(
                "SELECT * FROM dev_competition_slots WHERE id = ?1",
                params![slot_id],
                row_to_competition_slot,
            )
            .map_err(AppError::Database)
        }
    )
}

/// Aggregate per-strategy win/loss/DQ stats across all resolved competitions in a project.
pub fn get_strategy_leaderboard(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<crate::models::DevStrategyStats>, AppError> {
    use crate::models::DevStrategyStats;
    timed_query!(
        "dev_competition_slots",
        "dev_competition_slots::leaderboard",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
            "SELECT
                s.strategy_label,
                SUM(CASE WHEN c.winner_task_id = s.task_id THEN 1 ELSE 0 END) AS wins,
                COUNT(*) AS total,
                SUM(CASE WHEN s.disqualified = 1 THEN 1 ELSE 0 END) AS dq_count,
                MAX(CASE WHEN c.winner_task_id = s.task_id THEN c.resolved_at ELSE NULL END) AS last_win_at
             FROM dev_competition_slots s
             JOIN dev_competitions c ON c.id = s.competition_id
             WHERE c.project_id = ?1 AND c.status = 'resolved'
             GROUP BY s.strategy_label
             ORDER BY wins DESC, total DESC",
        )?;
            let rows = stmt.query_map(params![project_id], |row| {
                let wins: i32 = row.get("wins")?;
                let total: i32 = row.get("total")?;
                let dq: i32 = row.get("dq_count")?;
                Ok(DevStrategyStats {
                    label: row.get("strategy_label")?,
                    wins,
                    total,
                    disqualified_count: dq,
                    win_rate: if total > 0 {
                        wins as f64 / total as f64
                    } else {
                        0.0
                    },
                    last_win_at: row.get::<_, Option<String>>("last_win_at").ok().flatten(),
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn create_competition_slot(
    pool: &DbPool,
    competition_id: &str,
    task_id: &str,
    strategy_label: &str,
    strategy_prompt: Option<&str>,
    worktree_name: &str,
    slot_index: i32,
) -> Result<DevCompetitionSlot, AppError> {
    timed_query!("dev_competition_slots", "dev_competition_slots::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_competition_slots (id, competition_id, task_id, strategy_label, strategy_prompt, worktree_name, slot_index, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, competition_id, task_id, strategy_label, strategy_prompt, worktree_name, slot_index, now],
        )?;
        conn.query_row(
            "SELECT * FROM dev_competition_slots WHERE id = ?1",
            params![id],
            row_to_competition_slot,
        )
        .map_err(AppError::Database)
    })
}

pub fn list_competition_slots(
    pool: &DbPool,
    competition_id: &str,
) -> Result<Vec<DevCompetitionSlot>, AppError> {
    timed_query!("dev_competition_slots", "dev_competition_slots::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM dev_competition_slots WHERE competition_id = ?1 ORDER BY slot_index ASC",
        )?;
        let rows = stmt.query_map(params![competition_id], row_to_competition_slot)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}
