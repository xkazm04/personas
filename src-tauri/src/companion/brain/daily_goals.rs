//! Daily goals — the dev-only gamification ritual in the companion
//! panel. One active set of 1-3 operator-authored goals; evaluation is
//! strictly manual (the operator toggles each goal; Athena never marks
//! one done). When the last open goal is toggled done the whole set
//! flips to `completed` inside the same transaction and the LOCAL
//! completion date becomes the streak key; a set can also be discarded,
//! which never counts. The streak is recomputed from history on every
//! read — at one row set per day there is nothing worth caching.
//!
//! Plain rusqlite on the user DB, same convention as the sibling brain
//! modules; no disk markdown — this is a ritual scoreboard, not a
//! memory node.

use chrono::{Duration, NaiveDate};
use rusqlite::params;
use std::collections::HashSet;

use crate::companion::brain::util;
use crate::db::UserDbPool;
use crate::error::AppError;

pub const MAX_GOALS_PER_SET: usize = 3;
const MAX_TITLE_CHARS: usize = 120;

#[derive(Debug, Clone)]
pub struct DailyGoalRow {
    pub id: String,
    pub slot: i64,
    pub title: String,
    pub done: bool,
}

#[derive(Debug, Clone)]
pub struct DailyGoalsSnapshot {
    /// The active set's goals, slot order. Empty = no active set.
    pub goals: Vec<DailyGoalRow>,
    /// Consecutive days (ending today or yesterday) with a completed set.
    pub streak: u32,
    /// True when a set was completed on the local `today`.
    pub completed_today: bool,
}

fn local_today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

fn fmt(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Walk back from `today` (grace: from yesterday when today's set isn't
/// done yet) counting consecutive completed days. Pure for testability.
fn compute_streak(done_dates: &HashSet<String>, today: NaiveDate) -> u32 {
    let mut cursor = if done_dates.contains(&fmt(today)) {
        today
    } else {
        today - Duration::days(1)
    };
    let mut streak = 0u32;
    while done_dates.contains(&fmt(cursor)) {
        streak += 1;
        cursor -= Duration::days(1);
    }
    streak
}

fn completed_dates(pool: &UserDbPool) -> Result<HashSet<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT completed_date FROM companion_daily_goal
         WHERE status = 'completed' AND completed_date IS NOT NULL",
    )?;
    let dates = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(dates)
}

fn active_rows(pool: &UserDbPool) -> Result<Vec<DailyGoalRow>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, slot, title, done_at IS NOT NULL FROM companion_daily_goal
         WHERE status = 'active' ORDER BY slot ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DailyGoalRow {
                id: r.get(0)?,
                slot: r.get(1)?,
                title: r.get(2)?,
                done: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_state(pool: &UserDbPool) -> Result<DailyGoalsSnapshot, AppError> {
    let goals = active_rows(pool)?;
    let dates = completed_dates(pool)?;
    let today = local_today();
    Ok(DailyGoalsSnapshot {
        streak: compute_streak(&dates, today),
        completed_today: dates.contains(&fmt(today)),
        goals,
    })
}

/// Create a fresh set of 1-3 goals. Refuses while another set is active.
pub fn create_set(pool: &UserDbPool, titles: &[String]) -> Result<DailyGoalsSnapshot, AppError> {
    let titles: Vec<String> = titles
        .iter()
        .map(|t| t.trim().chars().take(MAX_TITLE_CHARS).collect::<String>())
        .filter(|t| !t.is_empty())
        .collect();
    if titles.is_empty() || titles.len() > MAX_GOALS_PER_SET {
        return Err(AppError::Validation(format!(
            "daily goals: a set needs 1 to {MAX_GOALS_PER_SET} non-empty goals"
        )));
    }
    if !active_rows(pool)?.is_empty() {
        return Err(AppError::Validation(
            "daily goals: finish or discard the current set before starting a new one".into(),
        ));
    }
    let set_id = format!("dgset_{}", util::short_id(8));
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    for (slot, title) in titles.iter().enumerate() {
        tx.execute(
            "INSERT INTO companion_daily_goal (id, set_id, slot, title, status, created_at)
             VALUES (?1, ?2, ?3, ?4, 'active', ?5)",
            params![
                format!("dgoal_{}", util::short_id(8)),
                set_id,
                slot as i64,
                title,
                now
            ],
        )?;
    }
    tx.commit()?;
    get_state(pool)
}

/// Toggle one active goal. Marking the last open goal done completes the
/// whole set atomically (status='completed', completed_date=local today).
/// Returns the fresh snapshot plus whether this call closed the set.
pub fn toggle_goal(
    pool: &UserDbPool,
    id: &str,
    done: bool,
) -> Result<(DailyGoalsSnapshot, bool), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    let updated = tx.execute(
        "UPDATE companion_daily_goal
         SET done_at = CASE WHEN ?1 THEN ?2 ELSE NULL END
         WHERE id = ?3 AND status = 'active'",
        params![done, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::Validation(format!(
            "daily goals: no active goal `{id}`"
        )));
    }
    let open: i64 = tx.query_row(
        "SELECT COUNT(*) FROM companion_daily_goal WHERE status = 'active' AND done_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    let just_completed = open == 0;
    if just_completed {
        tx.execute(
            "UPDATE companion_daily_goal
             SET status = 'completed', completed_date = ?1
             WHERE status = 'active'",
            params![fmt(local_today())],
        )?;
    }
    tx.commit()?;
    Ok((get_state(pool)?, just_completed))
}

/// Discard the active set (never counts toward the streak).
pub fn discard_set(pool: &UserDbPool) -> Result<DailyGoalsSnapshot, AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_daily_goal SET status = 'discarded' WHERE status = 'active'",
        [],
    )?;
    get_state(pool)
}

/// Prompt addendum block for Athena's awareness of the ritual — active
/// goals + streak, with the hard rule that evaluation is the operator's
/// alone. Empty when there is nothing to say (no active set, no streak).
pub fn prompt_addendum(pool: &UserDbPool) -> String {
    let Ok(snap) = get_state(pool) else {
        return String::new();
    };
    if snap.goals.is_empty() && snap.streak == 0 {
        return String::new();
    }
    let mut out = String::from("\n## Daily goals (operator ritual)\n\n");
    out.push_str(&format!(
        "Current streak: {} consecutive day(s) with all daily goals accomplished.{}\n",
        snap.streak,
        if snap.completed_today {
            " Today's set is already complete."
        } else {
            ""
        }
    ));
    if snap.goals.is_empty() {
        out.push_str("No active goal set right now.\n");
    } else {
        out.push_str("Today's goals:\n");
        for g in &snap.goals {
            out.push_str(&format!(
                "- [{}] {}\n",
                if g.done { "done" } else { "open" },
                g.title
            ));
        }
    }
    out.push_str(
        "You may reference and encourage these, but evaluation is MANUAL and the \
         operator's alone: never mark a goal done, never propose marking one done, \
         never treat a goal as finished until the operator says so.\n",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn dates(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn streak_counts_back_from_today() {
        let set = dates(&["2026-08-05", "2026-08-04", "2026-08-03"]);
        assert_eq!(compute_streak(&set, d("2026-08-05")), 3);
    }

    #[test]
    fn streak_grace_when_today_incomplete() {
        let set = dates(&["2026-08-04", "2026-08-03"]);
        assert_eq!(compute_streak(&set, d("2026-08-05")), 2);
    }

    #[test]
    fn streak_resets_on_gap() {
        let set = dates(&["2026-08-05", "2026-08-03", "2026-08-02"]);
        assert_eq!(compute_streak(&set, d("2026-08-05")), 1);
    }

    #[test]
    fn streak_zero_without_history() {
        assert_eq!(compute_streak(&HashSet::new(), d("2026-08-05")), 0);
        let stale = dates(&["2026-08-01"]);
        assert_eq!(compute_streak(&stale, d("2026-08-05")), 0);
    }

    fn test_pool() -> UserDbPool {
        use r2d2_sqlite::SqliteConnectionManager;
        let manager = SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder().max_size(1).build(manager).unwrap();
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_daily_goal (
                    id             TEXT PRIMARY KEY,
                    set_id         TEXT NOT NULL,
                    slot           INTEGER NOT NULL,
                    title          TEXT NOT NULL,
                    done_at        TEXT,
                    status         TEXT NOT NULL DEFAULT 'active',
                    completed_date TEXT,
                    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
                );",
            )
            .unwrap();
        pool
    }

    #[test]
    fn create_validates_and_refuses_second_active_set() {
        let pool = test_pool();
        assert!(create_set(&pool, &[]).is_err());
        assert!(create_set(&pool, &["  ".into()]).is_err());
        assert!(create_set(
            &pool,
            &["a".into(), "b".into(), "c".into(), "d".into()]
        )
        .is_err());
        let snap = create_set(&pool, &["Ship the fix".into(), "Test Athena".into()]).unwrap();
        assert_eq!(snap.goals.len(), 2);
        assert!(create_set(&pool, &["another".into()]).is_err());
    }

    #[test]
    fn partial_set_does_not_complete_but_last_toggle_does() {
        let pool = test_pool();
        let snap = create_set(&pool, &["one".into(), "two".into(), "three".into()]).unwrap();
        let ids: Vec<String> = snap.goals.iter().map(|g| g.id.clone()).collect();

        let (s1, done1) = toggle_goal(&pool, &ids[0], true).unwrap();
        assert!(!done1);
        assert_eq!(s1.goals.iter().filter(|g| g.done).count(), 1);
        assert_eq!(s1.streak, 0);

        // Un-toggling works while the set is active.
        let (s2, _) = toggle_goal(&pool, &ids[0], false).unwrap();
        assert_eq!(s2.goals.iter().filter(|g| g.done).count(), 0);

        let _ = toggle_goal(&pool, &ids[0], true).unwrap();
        let _ = toggle_goal(&pool, &ids[1], true).unwrap();
        let (s3, done3) = toggle_goal(&pool, &ids[2], true).unwrap();
        assert!(done3, "third toggle closes the set");
        assert!(s3.goals.is_empty(), "completed set leaves no active rows");
        assert_eq!(s3.streak, 1);
        assert!(s3.completed_today);

        // Completed goals are frozen: no active row left to toggle.
        assert!(toggle_goal(&pool, &ids[0], false).is_err());
    }

    #[test]
    fn discarded_sets_never_count() {
        let pool = test_pool();
        let snap = create_set(&pool, &["one".into()]).unwrap();
        let id = snap.goals[0].id.clone();
        let _ = toggle_goal(&pool, &id, true); // completes + counts
        let snap2 = create_set(&pool, &["two".into()]).unwrap();
        let _ = snap2;
        let after = discard_set(&pool).unwrap();
        assert!(after.goals.is_empty());
        // Streak still 1 from the completed set; the discarded one is inert.
        assert_eq!(after.streak, 1);
        // A discarded set frees the slot for a new one.
        assert!(create_set(&pool, &["three".into()]).is_ok());
    }

    #[test]
    fn prompt_addendum_reflects_state_and_stays_silent_when_empty() {
        let pool = test_pool();
        assert!(prompt_addendum(&pool).is_empty());
        let snap = create_set(&pool, &["Ship it".into()]).unwrap();
        let text = prompt_addendum(&pool);
        assert!(text.contains("[open] Ship it"));
        assert!(text.contains("never mark a goal done"));
        let _ = toggle_goal(&pool, &snap.goals[0].id, true).unwrap();
        let done_text = prompt_addendum(&pool);
        assert!(done_text.contains("Current streak: 1"));
        assert!(done_text.contains("already complete"));
    }
}
