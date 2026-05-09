//! Stage D Phase 4 — repository for recipe-suggestion telemetry.
//!
//! Append-only event log with windowed-sample aggregation. The table is
//! created in `db::migrations::incremental` and indexed by `created_at DESC`
//! so the "last N events" query is a leading-edge scan.

use rusqlite::params;

use crate::db::models::{
    RecipeSuggestionEvent, RecipeSuggestionEventType, RecipeSuggestionStats,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Default sample window — the most recent N events used for stats. Chosen
/// to balance signal-vs-noise: 50 events is enough for the accept rate to
/// stabilize while still being responsive to recent behavior changes.
pub const DEFAULT_SAMPLE_WINDOW: i64 = 50;

/// Minimum decisive events (accepts + dismisses) before mode-2 eligibility
/// can flip true. Below this the rate is dominated by sampling noise.
pub const MIN_DECISIONS_FOR_MODE_2: i64 = 20;

/// Accept-rate threshold for mode-2 eligibility. 0.5 = users accept the
/// suggestion at least as often as they dismiss it. Conservative on
/// purpose — Phase 5's skip-build is an aggressive shortcut, so the
/// gate should require strong signal that users actually want it.
pub const MODE_2_ACCEPT_THRESHOLD: f32 = 0.5;

pub fn log_event(
    pool: &DbPool,
    recipe_id: &str,
    event_type: RecipeSuggestionEventType,
    score: f32,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO recipe_suggestion_events (recipe_id, event_type, score)
         VALUES (?1, ?2, ?3)",
        params![recipe_id, event_type.as_str(), score],
    )?;
    Ok(())
}

/// Return the most recent `limit` events, newest first. Used by debug
/// surfaces; the production aggregation goes through `compute_stats`.
pub fn list_recent(pool: &DbPool, limit: i64) -> Result<Vec<RecipeSuggestionEvent>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, recipe_id, event_type, score, created_at
           FROM recipe_suggestion_events
          ORDER BY created_at DESC, id DESC
          LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        let event_type_str: String = row.get(2)?;
        let event_type = match event_type_str.as_str() {
            "impression" => RecipeSuggestionEventType::Impression,
            "accept" => RecipeSuggestionEventType::Accept,
            "dismiss" => RecipeSuggestionEventType::Dismiss,
            // CHECK constraint should make this unreachable in practice;
            // default to Impression to keep the row visible rather than
            // poisoning the whole list with one bad value.
            _ => RecipeSuggestionEventType::Impression,
        };
        Ok(RecipeSuggestionEvent {
            id: row.get(0)?,
            recipe_id: row.get(1)?,
            event_type,
            score: row.get::<_, f64>(3)? as f32,
            created_at: row.get(4)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// Aggregate the most recent `window` events into per-type counts and
/// derived stats. Pure SQL — no scan in app memory beyond the three small
/// counts the GROUP BY returns.
pub fn compute_stats(pool: &DbPool, window: i64) -> Result<RecipeSuggestionStats, AppError> {
    let conn = pool.get()?;
    // The subquery picks the windowed sample; the outer query groups it.
    // Using a CTE keeps SQLite from re-scanning the events table per row.
    let mut stmt = conn.prepare(
        "WITH recent AS (
             SELECT event_type
               FROM recipe_suggestion_events
               ORDER BY created_at DESC, id DESC
               LIMIT ?1
         )
         SELECT event_type, COUNT(*) FROM recent GROUP BY event_type",
    )?;
    let rows = stmt.query_map([window], |row| {
        let kind: String = row.get(0)?;
        let n: i64 = row.get(1)?;
        Ok((kind, n))
    })?;

    let mut impressions = 0i64;
    let mut accepts = 0i64;
    let mut dismisses = 0i64;
    for r in rows {
        let (kind, n) = r?;
        match kind.as_str() {
            "impression" => impressions = n,
            "accept" => accepts = n,
            "dismiss" => dismisses = n,
            _ => {}
        }
    }

    let decisive_count = accepts + dismisses;
    let accept_rate = if decisive_count > 0 {
        accepts as f32 / decisive_count as f32
    } else {
        0.0
    };
    let sample_size = impressions + accepts + dismisses;
    let mode_2_eligible =
        decisive_count >= MIN_DECISIONS_FOR_MODE_2 && accept_rate >= MODE_2_ACCEPT_THRESHOLD;

    Ok(RecipeSuggestionStats {
        impressions,
        accepts,
        dismisses,
        accept_rate,
        decisive_count,
        sample_size,
        mode_2_eligible,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// In-memory pool with the full schema migrated. Uses a unique URI per
    /// call so concurrent tests don't share state. No FK seeds needed —
    /// recipe_suggestion_events has no foreign keys.
    fn test_pool() -> crate::db::DbPool {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:testdb_recipe_suggestions_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder().max_size(4).build(manager).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).unwrap();
        }
        pool
    }

    #[test]
    fn empty_table_yields_zero_stats() {
        let pool = test_pool();
        let stats = compute_stats(&pool, DEFAULT_SAMPLE_WINDOW).unwrap();
        assert_eq!(stats.impressions, 0);
        assert_eq!(stats.accepts, 0);
        assert_eq!(stats.dismisses, 0);
        assert_eq!(stats.decisive_count, 0);
        assert_eq!(stats.accept_rate, 0.0);
        assert_eq!(stats.sample_size, 0);
        assert!(!stats.mode_2_eligible);
    }

    #[test]
    fn log_and_aggregate_round_trip() {
        let pool = test_pool();
        // 30 impressions, 15 accepts, 5 dismisses → accept rate 15/20 = 0.75,
        // decisive_count 20 ≥ MIN, rate 0.75 ≥ MODE_2_ACCEPT_THRESHOLD → eligible.
        for _ in 0..30 {
            log_event(&pool, "r-1", RecipeSuggestionEventType::Impression, 0.92).unwrap();
        }
        for _ in 0..15 {
            log_event(&pool, "r-1", RecipeSuggestionEventType::Accept, 0.92).unwrap();
        }
        for _ in 0..5 {
            log_event(&pool, "r-1", RecipeSuggestionEventType::Dismiss, 0.91).unwrap();
        }
        let stats = compute_stats(&pool, DEFAULT_SAMPLE_WINDOW).unwrap();
        assert_eq!(stats.impressions, 30);
        assert_eq!(stats.accepts, 15);
        assert_eq!(stats.dismisses, 5);
        assert_eq!(stats.decisive_count, 20);
        assert!((stats.accept_rate - 0.75).abs() < 1e-6);
        assert_eq!(stats.sample_size, 50);
        assert!(stats.mode_2_eligible);
    }

    #[test]
    fn below_min_decisions_not_eligible_even_at_perfect_rate() {
        let pool = test_pool();
        // 5 accepts, 0 dismisses → rate 1.0 but decisive_count 5 < MIN.
        for _ in 0..5 {
            log_event(&pool, "r-2", RecipeSuggestionEventType::Accept, 0.95).unwrap();
        }
        let stats = compute_stats(&pool, DEFAULT_SAMPLE_WINDOW).unwrap();
        assert_eq!(stats.accept_rate, 1.0);
        assert_eq!(stats.decisive_count, 5);
        assert!(!stats.mode_2_eligible);
    }

    #[test]
    fn rate_below_threshold_not_eligible_even_with_large_sample() {
        let pool = test_pool();
        // 10 accepts, 30 dismisses → rate 0.25 < 0.5, decisive_count 40 ≥ MIN.
        for _ in 0..10 {
            log_event(&pool, "r-3", RecipeSuggestionEventType::Accept, 0.92).unwrap();
        }
        for _ in 0..30 {
            log_event(&pool, "r-3", RecipeSuggestionEventType::Dismiss, 0.92).unwrap();
        }
        let stats = compute_stats(&pool, DEFAULT_SAMPLE_WINDOW).unwrap();
        assert!((stats.accept_rate - 0.25).abs() < 1e-6);
        assert_eq!(stats.decisive_count, 40);
        assert!(!stats.mode_2_eligible);
    }

    #[test]
    fn windowing_drops_oldest_events() {
        let pool = test_pool();
        // Insert 40 dismisses first (older), then 30 accepts (newer).
        // With window=50, we sample the last 50 → 30 accepts + 20 dismisses
        // (oldest 20 dismisses fall off the window).
        for _ in 0..40 {
            log_event(&pool, "r-4", RecipeSuggestionEventType::Dismiss, 0.92).unwrap();
        }
        for _ in 0..30 {
            log_event(&pool, "r-4", RecipeSuggestionEventType::Accept, 0.92).unwrap();
        }
        let stats = compute_stats(&pool, 50).unwrap();
        assert_eq!(stats.accepts, 30);
        assert_eq!(stats.dismisses, 20);
        assert_eq!(stats.sample_size, 50);
        // 30 / 50 = 0.6 ≥ threshold; 50 ≥ MIN → eligible.
        assert!(stats.mode_2_eligible);
    }

    #[test]
    fn list_recent_orders_newest_first() {
        let pool = test_pool();
        log_event(&pool, "r-a", RecipeSuggestionEventType::Impression, 0.91).unwrap();
        log_event(&pool, "r-b", RecipeSuggestionEventType::Accept, 0.95).unwrap();
        log_event(&pool, "r-c", RecipeSuggestionEventType::Dismiss, 0.92).unwrap();
        let events = list_recent(&pool, 10).unwrap();
        assert_eq!(events.len(), 3);
        // Newest first → the dismiss row inserted last is at index 0.
        assert_eq!(events[0].recipe_id, "r-c");
        assert_eq!(events[2].recipe_id, "r-a");
    }
}
