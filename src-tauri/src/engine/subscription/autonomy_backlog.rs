use super::*;
use crate::db::DbPool;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Autonomous backlog → goal (default-OFF) — keep the goal-advance loop fed
// ---------------------------------------------------------------------------

/// Max goals promoted per tick (one per idling project; this caps the total).
const BACKLOG_TO_GOAL_MAX_PER_TICK: usize = 5;

/// Keeps the unattended goal-advance loop self-sustaining (analysis §G7): when a
/// goal-linked project has run out of open goals (the loop would otherwise
/// idle), promote that project's single BEST pending backlog idea (highest
/// impact, lowest risk, lowest effort) into a new `dev_goals` row and mark the
/// idea accepted. ONE goal per idling project per tick — flood-safe; nothing
/// happens for a project that still has an open goal or no pending ideas.
/// Default-OFF (`AUTONOMOUS_BACKLOG_TO_GOAL`).
pub struct BacklogToGoalSubscription {
    pub pool: DbPool,
}

/// The best pending idea for an idling goal-linked project.
struct PromotableIdea {
    idea_id: String,
    project_id: String,
    title: String,
    description: Option<String>,
}

fn find_promotable_ideas(pool: &DbPool) -> Result<Vec<PromotableIdea>, crate::error::AppError> {
    let conn = pool.get()?;
    // One row per IDLING goal-linked project (no open, non-done, progress<100
    // goal): that project's single best pending idea. STRATEGIST-RANKED ideas
    // win first (`priority` ASC, 1 = do next — written by the backlog-triage
    // job); unranked ideas fall back to the scanner self-scores (impact desc,
    // risk asc, effort asc, oldest first).
    let mut stmt = conn.prepare(
        "SELECT i.id, i.project_id, i.title, i.description
         FROM dev_ideas i
         JOIN dev_projects dp ON dp.id = i.project_id
         WHERE dp.team_id IS NOT NULL
           AND i.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM dev_goals g
             WHERE g.project_id = i.project_id
               AND g.status NOT IN ('done','completed')
               AND g.progress < 100
           )
           AND i.id IN (
             SELECT i2.id FROM dev_ideas i2
             WHERE i2.project_id = i.project_id AND i2.status = 'pending'
             ORDER BY (i2.priority IS NULL) ASC, i2.priority ASC,
                      COALESCE(i2.impact,0) DESC, COALESCE(i2.risk,99) ASC, COALESCE(i2.effort,99) ASC, i2.created_at ASC
             -- X1: promote the TOP 3 (not 1) per idling project so the project
             -- holds a small set of coexisting open goals — the Product
             -- Strategist's triage can then RELATE them (depends/follows). With
             -- one-at-a-time promotion the relate feature was starved: no project
             -- ever held >=2 open goals, so 0 relations were ever written.
             LIMIT 3
           )
         ORDER BY i.project_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PromotableIdea {
            idea_id: r.get(0)?,
            project_id: r.get(1)?,
            title: r.get(2)?,
            description: r.get(3)?,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[async_trait::async_trait]
impl ReactiveSubscription for BacklogToGoalSubscription {
    fn name(&self) -> &'static str {
        "backlog_to_goal"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(600)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(150)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::BacklogToGoal);
        if !enabled {
            return;
        }
        // Don't generate new work while inside a quota-limit window (G1).
        if quota_cooldown_active(&self.pool) {
            tracing::info!("backlog_to_goal: quota cooldown active — skipping tick");
            return;
        }

        let pool = self.pool.clone();
        let promoted = tokio::task::spawn_blocking(move || {
            let ideas = match find_promotable_ideas(&pool) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(error = %e, "backlog_to_goal: query failed");
                    return 0usize;
                }
            };
            let mut n = 0usize;
            for idea in ideas.into_iter().take(BACKLOG_TO_GOAL_MAX_PER_TICK) {
                let desc = format!(
                    "{}\n\n(Promoted from backlog idea {} to keep the team's goal queue fed.)",
                    idea.description.as_deref().unwrap_or("").trim(),
                    idea.idea_id,
                );
                match crate::db::repos::dev_tools::create_goal(
                    &pool,
                    &idea.project_id,
                    &idea.title,
                    Some(desc.trim()),
                    None,
                    Some("open"),
                    None,
                    None,
                ) {
                    Ok(_) => {
                        // Mark the idea consumed so it is never re-promoted.
                        // Through the shared verdict core (plan 1B), so this
                        // autonomous accept is remembered like every other one
                        // instead of being an invisible raw status write.
                        let _ = crate::commands::infrastructure::dev_tools::apply_idea_verdict_by(
                            &pool,
                            &idea.idea_id,
                            crate::commands::infrastructure::dev_tools::IdeaVerdict::Accept,
                            "Autonomy",
                        );
                        n += 1;
                        tracing::info!(project_id = %idea.project_id, idea_id = %idea.idea_id, "backlog_to_goal: promoted backlog idea to goal");
                    }
                    Err(e) => {
                        tracing::warn!(idea_id = %idea.idea_id, error = %e, "backlog_to_goal: create_goal failed")
                    }
                }
            }
            n
        })
        .await
        .unwrap_or(0);

        if promoted > 0 {
            tracing::info!(
                count = promoted,
                "backlog_to_goal: promoted {promoted} backlog idea(s) to goals"
            );
        }
    }
}

// =============================================================================
// G7 — Autonomous idea replenishment (last link of the self-sustaining loop)
// =============================================================================

/// When a goal-managed project is FULLY idle — no open goals AND no pending
/// backlog ideas — the loop starves: `backlog_to_goal` has nothing to promote
/// and `goal_advance` nothing to advance. This subscription replenishes the
/// backlog by running an idea scan (architecture-analyst agent) on ONE such
/// project per tick. Guardrails: a 20h per-project cooldown via the
/// `dev_scans` history (scans spawn a paid CLI agent, ~$1-3 / ~6 min), the
/// quota gate, and the default-OFF `autonomous_idea_scan` setting.
pub struct IdeaReplenishSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// The roster-aligned ideation lenses the replenish loop rotates through —
/// each maps to a team perspective so the backlog carries real-life variety
/// instead of architecture-only items: Architect (architecture), Security
/// Sentinel (security), QA (test), engineer (optimizer/error-handling), the UX
/// seat (ux/accessibility/onboarding), and the Product Strategist (business).
const REPLENISH_LENSES: &[&str] = &[
    "architecture-analyst",
    "business-strategist",
    "ux-reviewer",
    "security-auditor",
    "test-strategist",
    "code-optimizer",
    "accessibility-checker",
    "onboarding-designer",
    "error-handler",
];

/// Pick the 2 least-recently-used lenses for a project from the rotation,
/// based on the `dev_scans` history (scan_type is a comma-joined list).
/// Never-used lenses come first, then oldest-used — so every perspective gets
/// its turn before any repeats.
///
/// `pub(crate)` because the headless test bridge's ideation tick (§13.13) runs
/// the SAME rotation: a compressed night that always scanned through the
/// architecture lens would report a backlog this loop would never have
/// produced, and the bench would be grading the wrong night.
pub(crate) fn pick_replenish_lenses(pool: &DbPool, project_id: &str) -> Vec<String> {
    let mut last_used: std::collections::HashMap<&str, String> = Default::default();
    if let Ok(conn) = pool.get() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT scan_type, MAX(created_at) FROM dev_scans
             WHERE project_id = ?1 GROUP BY scan_type",
        ) {
            if let Ok(rows) = stmt.query_map([project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }) {
                for (types, at) in rows.flatten() {
                    for t in types.split(',').map(str::trim) {
                        if let Some(lens) = REPLENISH_LENSES.iter().find(|l| **l == t) {
                            let e = last_used.entry(lens).or_default();
                            if at > *e {
                                *e = at.clone();
                            }
                        }
                    }
                }
            }
        }
    }
    let mut ordered: Vec<&str> = REPLENISH_LENSES.to_vec();
    ordered.sort_by_key(|l| last_used.get(l).cloned().unwrap_or_default());
    ordered.into_iter().take(2).map(String::from).collect()
}

/// One fully-idle, scan-cooled project: `(project_id, name)`.
fn find_replenish_candidate(
    pool: &DbPool,
) -> Result<Option<(String, String)>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT dp.id, dp.name FROM dev_projects dp
         WHERE dp.team_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dev_goals g WHERE g.project_id = dp.id
                             AND g.status NOT IN ('done','completed') AND g.progress < 100)
           AND NOT EXISTS (SELECT 1 FROM dev_ideas i WHERE i.project_id = dp.id
                             AND i.status = 'pending')
           AND NOT EXISTS (SELECT 1 FROM dev_scans s WHERE s.project_id = dp.id
                             AND datetime(s.created_at) > datetime('now','-20 hours'))
         ORDER BY dp.updated_at ASC
         LIMIT 1",
    )?;
    let row = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .next();
    Ok(row)
}

#[async_trait::async_trait]
impl ReactiveSubscription for IdeaReplenishSubscription {
    fn name(&self) -> &'static str {
        "idea_replenish"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(300)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::IdeaScan);
        if !enabled {
            return;
        }
        // Don't spend on scans while inside a quota-limit window (G1).
        if quota_cooldown_active(&self.pool) {
            tracing::info!("idea_replenish: quota cooldown active — skipping tick");
            return;
        }

        let candidate = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || find_replenish_candidate(&pool))
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
        };
        let Some((project_id, name)) = candidate else {
            return;
        };

        // Rotate roster-aligned lenses (LRU) so backlog variety mirrors a real
        // team: architecture one round, business/UX/security/test the next.
        let lenses = {
            let pool = self.pool.clone();
            let pid = project_id.clone();
            tokio::task::spawn_blocking(move || pick_replenish_lenses(&pool, &pid))
                .await
                .unwrap_or_else(|_| vec!["architecture-analyst".to_string()])
        };
        tracing::info!(project_id = %project_id, project = %name, lenses = ?lenses, "idea_replenish: project fully idle (no goals, no ideas) — running backlog scan");
        match crate::commands::infrastructure::idea_scanner::run_scan_core(
            self.app.clone(),
            self.pool.clone(),
            project_id.clone(),
            lenses,
            None,
            None,
        )
        .await
        {
            Ok(v) => {
                tracing::info!(project_id = %project_id, scan = %v, "idea_replenish: scan launched");
            }
            Err(e) => {
                tracing::warn!(project_id = %project_id, error = %e, "idea_replenish: scan launch failed");
            }
        }
    }
}

// =============================================================================
// Roster redesign — Product Strategist backlog triage
// =============================================================================

/// When a goal-managed project's pending backlog grows past a threshold with
/// unranked items, run the Product Strategist triage job: it RANKS the next-up
/// queue (`dev_ideas.priority`, promotion prefers ranked) balancing business /
/// UX / technical themes, and REJECTS low-value items (reason → shared team
/// constraint memory + scanner suppression). Replaces the naive
/// impact/effort-only promotion shortcut. One project per tick; 24h
/// per-project cooldown via `dev_scans` (`backlog-triage`); default-OFF
/// `autonomous_backlog_triage`.
pub struct BacklogTriageSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// One project needing triage: ≥ 6 pending ideas, ≥ 3 of them unranked, and no
/// `backlog-triage` run in the last 24h.
fn find_triage_candidate_project(
    pool: &DbPool,
) -> Result<Option<(String, String)>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT dp.id, dp.name FROM dev_projects dp
         WHERE dp.team_id IS NOT NULL
           AND (SELECT COUNT(*) FROM dev_ideas i WHERE i.project_id = dp.id
                  AND i.status = 'pending') >= 6
           AND (SELECT COUNT(*) FROM dev_ideas i WHERE i.project_id = dp.id
                  AND i.status = 'pending' AND i.priority IS NULL) >= 3
           AND NOT EXISTS (SELECT 1 FROM dev_scans s WHERE s.project_id = dp.id
                             AND s.scan_type = 'backlog-triage'
                             AND datetime(s.created_at) > datetime('now','-24 hours'))
         ORDER BY dp.updated_at ASC
         LIMIT 1",
    )?;
    let row = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .next();
    Ok(row)
}

#[async_trait::async_trait]
impl ReactiveSubscription for BacklogTriageSubscription {
    fn name(&self) -> &'static str {
        "backlog_triage"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(1200)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(2400)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(420)
    }

    async fn tick(&self) {
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::BacklogTriage);
        if !enabled {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("backlog_triage: quota cooldown active — skipping tick");
            return;
        }

        let candidate = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || find_triage_candidate_project(&pool))
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
        };
        let Some((project_id, name)) = candidate else {
            return;
        };

        tracing::info!(project_id = %project_id, project = %name, "backlog_triage: pending backlog needs ranking — running strategist triage");
        match crate::commands::infrastructure::idea_scanner::run_backlog_triage(
            self.app.clone(),
            self.pool.clone(),
            project_id.clone(),
        )
        .await
        {
            Ok(v) => {
                tracing::info!(project_id = %project_id, scan = %v, "backlog_triage: triage launched");
            }
            Err(e) => {
                tracing::warn!(project_id = %project_id, error = %e, "backlog_triage: launch failed");
            }
        }
    }
}
