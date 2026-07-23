//! Knowledge-health snapshots (Brainiac-adoption P3 — docs/plans/brainiac-
//! adoption-skills-memory-docs.md).
//!
//! Brainiac's health pillars, computed over the app's OWN memory engine and
//! scoped to dev projects (project → bound team → roster personas → their
//! memories). Three pillars, 0–100:
//!   • currency    — share of active-tier memories NOT stale (stale = older,
//!     by last access, than 2× their category half-life — the same half-life
//!     table `engine::memory_recall` decays by, so the report and the recall
//!     path can never disagree about what "old" means);
//!   • consistency — disputed memories (open negative claims) drag it down;
//!   • governance  — review-proposal backlog depth + age vs a 7-day SLO.
//! Composite = 0.4·currency + 0.35·consistency + 0.25·governance, CAPPED
//! below 70 while ≥3 memories stand disputed (one Brainiac cap idea: enough
//! unresolved disputes deny "healthy" regardless of the weighted sum).
//!
//! Snapshots are append-only trend points (Brainiac 0014): one row per scope
//! per scan, throttled to 6h unless forced. New signals here follow the
//! adoption doctrine: they become attention/findings, not new score weights,
//! until they earn calibration.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

const RESCAN_MIN_HOURS: i64 = 6;
const GOVERNANCE_SLO_DAYS: f64 = 7.0;
/// ≥ this many disputed memories caps the composite below "healthy".
const DISPUTE_CAP_THRESHOLD: i64 = 3;
const DISPUTE_CAP_SCORE: i64 = 69;

/// The half-life table from `engine::memory_recall::category_half_life_days`,
/// as a SQL CASE so staleness is computed set-wide in one query.
const HALF_LIFE_CASE: &str = "CASE m.category \
     WHEN 'constraint' THEN 365.0 WHEN 'instruction' THEN 180.0 \
     WHEN 'preference' THEN 120.0 WHEN 'fact' THEN 90.0 \
     WHEN 'learned' THEN 60.0 WHEN 'context' THEN 21.0 ELSE 60.0 END";

#[derive(Debug, Default, Serialize)]
pub struct MemoryHealthScanSummary {
    pub projects_scanned: u32,
    pub projects_skipped_fresh: u32,
    /// Projects with no bound team — memory health has no roster to measure.
    pub projects_no_team: u32,
}

#[derive(Debug, Serialize)]
pub struct MemoryHealthRow {
    pub project_id: String,
    pub score: i64,
    /// Previous snapshot's score — the trend delta's other end. None on the
    /// first snapshot.
    pub prev_score: Option<i64>,
    pub currency: i64,
    pub consistency: i64,
    pub governance: i64,
    pub stale_count: i64,
    pub total_count: i64,
    pub open_claims: i64,
    /// Memories currently carrying open negative claims (live, not snapshot).
    pub disputed: i64,
    pub captured_at: String,
}

struct RosterMetrics {
    total: i64,
    stale: i64,
    disputed: i64,
    open_claims: i64,
    pending_proposals: i64,
    oldest_pending_days: f64,
}

fn roster_metrics(
    conn: &rusqlite::Connection,
    team_id: &str,
) -> Result<RosterMetrics, rusqlite::Error> {
    // Roster membership mirrors `memory_claims::disputed_overview`: explicit
    // team members ∪ home-team personas ∪ memories anchored to the team.
    let member_filter = "(m.home_team_id = ?1 \
        OR EXISTS (SELECT 1 FROM personas p WHERE p.id = m.persona_id AND p.home_team_id = ?1) \
        OR EXISTS (SELECT 1 FROM persona_team_members ptm \
                    WHERE ptm.persona_id = m.persona_id AND ptm.team_id = ?1))";

    let (total, stale, disputed, open_claims): (i64, i64, i64, i64) = conn.query_row(
        &format!(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN m.tier = 'active'
                          AND julianday('now') - julianday(COALESCE(m.last_accessed_at, m.created_at))
                              > 2 * {HALF_LIFE_CASE}
                        THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.open_claim_count > 0 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(m.open_claim_count), 0)
             FROM persona_memories m
             WHERE m.tier IN ('core','active','working') AND {member_filter}"
        ),
        rusqlite::params![team_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;

    let (pending_proposals, oldest_pending_days): (i64, f64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(MAX(julianday('now') - julianday(created_at)), 0.0)
         FROM persona_memory_review_proposal
         WHERE status = 'pending_review'
           AND (team_id = ?1
                OR persona_id IN (SELECT ptm.persona_id FROM persona_team_members ptm WHERE ptm.team_id = ?1)
                OR persona_id IN (SELECT p.id FROM personas p WHERE p.home_team_id = ?1))",
        rusqlite::params![team_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    Ok(RosterMetrics { total, stale, disputed, open_claims, pending_proposals, oldest_pending_days })
}

fn pillars(m: &RosterMetrics) -> (i64, i64, i64, i64) {
    let currency = if m.total == 0 { 100 } else { ((m.total - m.stale) * 100 / m.total).max(0) };
    let consistency = (100 - 20 * m.disputed).max(0);
    let age_over = (m.oldest_pending_days - GOVERNANCE_SLO_DAYS).max(0.0);
    let governance =
        (100 - (10 * m.pending_proposals).min(50) - ((age_over * 5.0) as i64).min(50)).max(0);
    let mut score =
        (0.4 * currency as f64 + 0.35 * consistency as f64 + 0.25 * governance as f64).round() as i64;
    if m.disputed >= DISPUTE_CAP_THRESHOLD {
        score = score.min(DISPUTE_CAP_SCORE);
    }
    (score, currency, consistency, governance)
}

#[tauri::command]
pub fn memory_health_scan(
    state: State<'_, Arc<AppState>>,
    force: Option<bool>,
) -> Result<MemoryHealthScanSummary, AppError> {
    require_auth_sync(&state)?;
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;
    let force = force.unwrap_or(false);
    let mut summary = MemoryHealthScanSummary::default();

    let projects: Vec<(String, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, team_id FROM dev_projects")
            .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
            .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;
        rows.flatten().collect()
    };

    for (pid, team) in &projects {
        let Some(team_id) = team.as_deref().filter(|t| !t.is_empty()) else {
            summary.projects_no_team += 1;
            continue;
        };
        if !force {
            let fresh: bool = conn
                .query_row(
                    "SELECT MAX(captured_at) >= datetime('now', ?2)
                     FROM knowledge_health_snapshots
                     WHERE scope_kind = 'project' AND scope_id = ?1",
                    rusqlite::params![pid, format!("-{RESCAN_MIN_HOURS} hours")],
                    |r| r.get::<_, Option<bool>>(0),
                )
                .ok()
                .flatten()
                .unwrap_or(false);
            if fresh {
                summary.projects_skipped_fresh += 1;
                continue;
            }
        }

        let metrics = roster_metrics(&conn, team_id)?;
        let (score, currency, consistency, governance) = pillars(&metrics);
        conn.execute(
            "INSERT INTO knowledge_health_snapshots
               (id, scope_kind, scope_id, score, currency, consistency, governance,
                stale_count, total_count, open_claims)
             VALUES (?1, 'project', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                pid,
                score,
                currency,
                consistency,
                governance,
                metrics.stale,
                metrics.total,
                metrics.open_claims,
            ],
        )?;
        summary.projects_scanned += 1;
    }

    Ok(summary)
}

#[tauri::command]
pub fn memory_health_overview(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<MemoryHealthRow>, AppError> {
    require_auth_sync(&state)?;
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;

    let mut stmt = conn
        .prepare(
            "SELECT s.scope_id, s.score, s.currency, s.consistency, s.governance,
                    s.stale_count, s.total_count, s.open_claims, s.captured_at,
                    (SELECT s2.score FROM knowledge_health_snapshots s2
                      WHERE s2.scope_kind = 'project' AND s2.scope_id = s.scope_id
                        AND s2.captured_at < s.captured_at
                      ORDER BY s2.captured_at DESC LIMIT 1) AS prev_score,
                    (SELECT COUNT(*) FROM persona_memories m
                      JOIN dev_projects dp ON dp.id = s.scope_id
                      WHERE m.open_claim_count > 0 AND (
                            m.home_team_id = dp.team_id
                         OR EXISTS (SELECT 1 FROM personas p
                                     WHERE p.id = m.persona_id AND p.home_team_id = dp.team_id)
                         OR EXISTS (SELECT 1 FROM persona_team_members ptm
                                     WHERE ptm.persona_id = m.persona_id AND ptm.team_id = dp.team_id)
                      )) AS disputed
             FROM knowledge_health_snapshots s
             WHERE s.scope_kind = 'project'
               AND s.captured_at = (SELECT MAX(s3.captured_at) FROM knowledge_health_snapshots s3
                                     WHERE s3.scope_kind = 'project' AND s3.scope_id = s.scope_id)",
        )
        .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;

    let rows = stmt
        .query_map([], |r| {
            Ok(MemoryHealthRow {
                project_id: r.get(0)?,
                score: r.get(1)?,
                currency: r.get(2)?,
                consistency: r.get(3)?,
                governance: r.get(4)?,
                stale_count: r.get(5)?,
                total_count: r.get(6)?,
                open_claims: r.get(7)?,
                captured_at: r.get(8)?,
                prev_score: r.get(9)?,
                disputed: r.get(10)?,
            })
        })
        .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;

    Ok(rows.flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::{pillars, RosterMetrics};

    fn m(total: i64, stale: i64, disputed: i64, pending: i64, oldest_days: f64) -> RosterMetrics {
        RosterMetrics {
            total,
            stale,
            disputed,
            open_claims: disputed,
            pending_proposals: pending,
            oldest_pending_days: oldest_days,
        }
    }

    #[test]
    fn empty_corpus_is_healthy_not_zero() {
        let (score, currency, ..) = pillars(&m(0, 0, 0, 0, 0.0));
        assert_eq!(currency, 100);
        assert_eq!(score, 100);
    }

    #[test]
    fn disputes_cap_the_composite_below_healthy() {
        // Perfect currency/governance, but 3 disputed memories → capped.
        let (score, ..) = pillars(&m(100, 0, 3, 0, 0.0));
        assert!(score <= 69, "3 disputes must deny 'healthy', got {score}");
        // ...while 1 dispute only dents consistency.
        let (score1, ..) = pillars(&m(100, 0, 1, 0, 0.0));
        assert!(score1 > 69);
    }

    #[test]
    fn governance_penalizes_backlog_age_past_slo_only() {
        let (_, _, _, fresh) = pillars(&m(10, 0, 0, 1, 3.0)); // inside 7d SLO
        let (_, _, _, old) = pillars(&m(10, 0, 0, 1, 20.0)); // 13d over
        assert!(old < fresh);
        assert_eq!(fresh, 90); // depth penalty only
    }
}
