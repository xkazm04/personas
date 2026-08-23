use super::*;
use crate::db::DbPool;
use std::time::Duration;

// ---------------------------------------------------------------------------
// KPI → Goal derivation — the outcome layer steering the goal loop
// ---------------------------------------------------------------------------

/// Opt-in autonomous loop: derive goals from OFF-TRACK KPIs (P4 of the KPI
/// plan). Candidates are gated hard — fresh measurement, one open derived
/// goal per KPI, re-measured since the last derived goal completed — and the
/// headless decision may legitimately SKIP. Business categories (value /
/// traffic) order before quality/technical: with 0 users, getting one beats
/// raising coverage. ≤2 derivations per tick; quota-gated.
pub struct KpiGoalDerivationSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

const KPI_DERIVATION_MAX_PER_TICK: usize = 2;

#[async_trait::async_trait]
impl ReactiveSubscription for KpiGoalDerivationSubscription {
    fn name(&self) -> &'static str {
        "kpi_goal_derivation"
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
        use crate::engine::autonomy::{self, Action};
        let global = autonomy::global_enabled(&self.pool, Action::KpiGoalDerivation);
        let modes = autonomy::load_modes(&self.pool);
        if !global && !autonomy::any_enabled(&modes) {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("kpi_goal_derivation: quota cooldown active — skipping tick");
            return;
        }

        let candidates = {
            let pool = self.pool.clone();
            // Over-fetch, then filter by per-project autopilot mode and truncate
            // to the per-tick cap — so projects NOT on suggest/full don't crowd
            // out eligible ones at the front of the (business-first) ordering.
            let fetch = KPI_DERIVATION_MAX_PER_TICK.max(1) * 8;
            tokio::task::spawn_blocking(move || {
                crate::engine::kpi_derivation::find_derivation_candidates(&pool, fetch)
            })
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default()
        };
        let mut candidates: Vec<_> = candidates
            .into_iter()
            .filter(|kpi| {
                autonomy::is_allowed(&modes, &kpi.project_id, global, Action::KpiGoalDerivation)
            })
            .collect();
        candidates.truncate(KPI_DERIVATION_MAX_PER_TICK);
        for kpi in candidates {
            let name = kpi.name.clone();
            match crate::engine::kpi_derivation::derive_goal_from_kpi(&self.pool, &kpi).await {
                Ok(Some(title)) => {
                    tracing::info!(kpi = %name, goal = %title, "kpi_goal_derivation: derived goal");
                    crate::notifications::send(
                        &self.app,
                        "KPI steering",
                        &format!("'{name}' is off track — derived goal: {title}"),
                    );
                }
                Ok(None) => {
                    tracing::info!(kpi = %name, "kpi_goal_derivation: skip (no actionable goal)");
                }
                Err(e) => {
                    tracing::warn!(kpi = %name, error = %e, "kpi_goal_derivation: failed");
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Autonomous KPI evaluation (default-OFF) — measure due KPIs on cadence
// ---------------------------------------------------------------------------

/// Measures due active KPIs across team-linked projects so the steering loop
/// runs unattended. Without this tick `evaluate_due_kpis` is command-only —
/// a human has to click Measure — and after 2× cadence the staleness guard in
/// `kpi_derivation::find_derivation_candidates` (correctly) stops deriving
/// goals, starving the KPI→goal loop on any multi-day run. Default-OFF
/// (`AUTONOMOUS_KPI_EVALUATION`); codebase measurements run repo commands, so
/// the tick is hourly and quota/cooldown-guarded like the other spend loops.
pub struct KpiEvaluationSubscription {
    pub pool: DbPool,
}

#[async_trait::async_trait]
impl ReactiveSubscription for KpiEvaluationSubscription {
    fn name(&self) -> &'static str {
        "kpi_evaluation"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(3600)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(3600)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(600)
    }

    async fn tick(&self) {
        use crate::engine::autonomy::{self, Action};
        // Per-project autopilot overrides the global flag; when the global flag
        // is off AND no project opted in, this tick is a no-op (as before).
        let global = autonomy::global_enabled(&self.pool, Action::KpiEvaluation);
        let modes = autonomy::load_modes(&self.pool);
        if !global && !autonomy::any_enabled(&modes) {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("kpi_evaluation: quota cooldown active — skipping tick");
            return;
        }

        // Team-linked projects that have at least one active non-manual KPI.
        // `evaluate_due_kpis` re-checks per-KPI dueness, so this is just a
        // cheap pre-filter to avoid no-op project iterations.
        let projects: Vec<String> = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || -> Vec<String> {
                let Ok(conn) = pool.get() else {
                    return Vec::new();
                };
                let Ok(mut stmt) = conn.prepare(
                    "SELECT DISTINCT dp.id FROM dev_projects dp
                     JOIN dev_kpis k ON k.project_id = dp.id
                     WHERE dp.team_id IS NOT NULL AND k.status = 'active'
                       AND k.measure_kind IN ('codebase','derived','connector')",
                ) else {
                    return Vec::new();
                };
                stmt.query_map([], |r| r.get::<_, String>(0))
                    .map(|rows| rows.filter_map(Result::ok).collect())
                    .unwrap_or_default()
            })
            .await
            .unwrap_or_default()
        };

        for project_id in projects {
            if !autonomy::is_allowed(&modes, &project_id, global, Action::KpiEvaluation) {
                continue; // this project's autopilot mode doesn't include measuring
            }
            match crate::engine::kpi_eval::evaluate_due_kpis(&self.pool, &project_id).await {
                Ok(results) if !results.is_empty() => {
                    let failed: Vec<&str> = results
                        .iter()
                        .filter_map(|(k, v)| v.is_err().then_some(k.as_str()))
                        .collect();
                    tracing::info!(
                        project_id = %project_id,
                        measured = results.len() - failed.len(),
                        failed = failed.len(),
                        failed_kpis = ?failed,
                        "kpi_evaluation: tick measured due KPIs"
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(project_id = %project_id, error = %e, "kpi_evaluation: project evaluation failed");
                }
            }
        }
    }
}
