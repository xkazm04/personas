//! The Brain dashboard aggregate (spark `agent-manifest-rebase`, WP1): one
//! read that folds the repo aggregates into `PersonaBrainDashboard`.
//!
//! Every series is an empty vec when the persona has recorded nothing (the
//! queries ran); the `Option` fields stay `None` when the thing has never
//! happened. The pressure gauge reuses the sleep cycle's own boundary rule
//! (`sleep_cycle::gauge`) so the dashboard and the admission logic can never
//! disagree about how much is waiting.

use crate::db::models::{AnomalyStrip, PersonaBrainDashboard, PressureGauge};
use crate::db::repos::core::{
    attention_ledger, episodes as episodes_repo, memories as memories_repo,
    memory_claims as claims_repo, memory_review_proposal as proposal_repo,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Days of episode history the activity series covers.
const EPISODE_SERIES_DAYS: i64 = 30;
/// Completed consolidation passes the series carries.
const CONSOLIDATION_SERIES_LIMIT: u32 = 30;
/// Window for the rejected-drafts anomaly cell.
const REJECTED_DRAFTS_DAYS: i64 = 7;

pub fn build(pool: &DbPool, persona_id: &str) -> Result<PersonaBrainDashboard, AppError> {
    let tier_counts = memories_repo::count_by_tier(pool, persona_id)?;
    let category_counts = memories_repo::count_by_category(pool, persona_id)?;
    let episode_series =
        episodes_repo::count_by_day_and_role(pool, persona_id, EPISODE_SERIES_DAYS)?;
    let consolidation_series =
        attention_ledger::consolidation_series(pool, persona_id, CONSOLIDATION_SERIES_LIMIT)?;
    let ledger = attention_ledger::summary_for_persona(pool, persona_id)?;
    let (reading, _boundary) = super::sleep_cycle::gauge(pool, persona_id)?;
    let since = (chrono::Utc::now() - chrono::Duration::days(REJECTED_DRAFTS_DAYS)).to_rfc3339();
    Ok(PersonaBrainDashboard {
        tier_counts,
        category_counts,
        episode_series,
        consolidation_series,
        pressure: PressureGauge {
            chars_waiting: reading.chars_waiting,
            threshold: personas_core::cycle::PRESSURE_CHARS,
            last_cycle_at: ledger.last_consolidation_at,
        },
        anomaly: AnomalyStrip {
            failed_streak: ledger.failed_streak,
            refused_today: ledger.refused_today,
            open_disputes: claims_repo::count_disputed_for_persona(pool, persona_id)?,
            rejected_drafts_7d: proposal_repo::count_discarded_since(pool, persona_id, &since)?,
        },
        coverage: episodes_repo::count_by_responsibility(pool, persona_id)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    #[test]
    fn empty_persona_reads_as_measured_zeros_and_honest_absence() -> Result<(), AppError> {
        let pool = init_test_db()?;
        pool.get()?.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'p1', 'sp', datetime('now'), datetime('now'))",
            [],
        )?;
        let d = build(&pool, "p1")?;
        assert!(d.tier_counts.is_empty());
        assert!(d.category_counts.is_empty());
        assert!(d.episode_series.is_empty());
        assert!(d.consolidation_series.is_empty());
        assert!(d.coverage.is_empty());
        assert_eq!(d.pressure.chars_waiting, 0);
        assert_eq!(d.pressure.threshold, personas_core::cycle::PRESSURE_CHARS);
        assert!(
            d.pressure.last_cycle_at.is_none(),
            "never ran → None, not epoch"
        );
        assert_eq!(d.anomaly, AnomalyStrip::default());
        Ok(())
    }

    #[test]
    fn dashboard_folds_the_repo_aggregates() -> Result<(), AppError> {
        let pool = init_test_db()?;
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES ('p1', 'p1', 'sp', datetime('now'), datetime('now'))",
            [],
        )?;
        conn.execute(
            "INSERT INTO persona_memories (id, persona_id, title, content, category, tier, open_claim_count)
             VALUES ('m1', 'p1', 't', 'c', 'fact', 'active', 1),
                    ('m2', 'p1', 't', 'c', 'fact', 'working', 0)",
            [],
        )?;
        conn.execute(
            "INSERT INTO persona_episodes
                (id, persona_id, responsibility_id, role, source, body_excerpt, content_hash, chars, created_at)
             VALUES ('e1', 'p1', 'resp_a', 'assistant', 'execution', 'b', 'h1', 500, ?1)",
            [chrono::Utc::now().to_rfc3339()],
        )?;
        conn.execute(
            "INSERT INTO persona_memory_review_proposal
                (id, persona_id, threshold, proposal_json, status, decided_at)
             VALUES ('mp1', 'p1', 0, '{}', 'discarded', datetime('now'))",
            [],
        )?;
        drop(conn);
        let f = attention_ledger::insert_started(&pool, "p1", None, "consolidation", None)?;
        attention_ledger::complete(&pool, &f, "failed", "boom", None, None, None)?;

        let d = build(&pool, "p1")?;
        assert_eq!(d.tier_counts.active, 1);
        assert_eq!(d.tier_counts.working, 1);
        assert_eq!(d.category_counts.len(), 1);
        assert_eq!(d.category_counts[0].count, 2);
        assert_eq!(d.episode_series.len(), 1);
        assert_eq!(d.episode_series[0].chars, 500);
        assert_eq!(d.consolidation_series.len(), 1);
        assert_eq!(d.consolidation_series[0].verdict, "failed");
        assert_eq!(d.pressure.chars_waiting, 500);
        assert!(d.pressure.last_cycle_at.is_some());
        assert_eq!(d.anomaly.failed_streak, 1);
        assert_eq!(d.anomaly.open_disputes, 1);
        assert_eq!(d.anomaly.rejected_drafts_7d, 1);
        assert_eq!(d.coverage[0].key, "resp_a");
        Ok(())
    }
}
