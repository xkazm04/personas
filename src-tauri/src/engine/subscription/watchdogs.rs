use super::*;
use crate::db::DbPool;
use crate::engine::ExecutionEngine;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

// ---------------------------------------------------------------------------
// Fleet liveness watchdog — a stalled autonomous fleet must never be silent
// ---------------------------------------------------------------------------

/// Always-on stall detector for the autonomous fleet. The 06-09 deadlock —
/// parked reviews holding goal slots, starving re-advance AND backlog
/// promotion — left the fleet producing NOTHING for two days with autonomy
/// fully on, and no surface said so. This watchdog closes that gap: when
/// autonomous goal advancement is ON, actionable work exists (open goals,
/// pending backlog, or parked reviews), no quota cooldown explains the
/// silence, and NO persona execution has started in `FLEET_STALL_HOURS`,
/// it raises ONE deduped `fleet_stall` incident (severity high) + a desktop
/// notification. Not gated by a setting — it spends nothing and only speaks
/// when the fleet that should be moving isn't.
pub struct FleetLivenessWatchdog {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// Hours of zero execution starts (with work available) that count as a stall.
const FLEET_STALL_HOURS: i64 = 2;

#[async_trait::async_trait]
impl ReactiveSubscription for FleetLivenessWatchdog {
    fn name(&self) -> &'static str {
        "fleet_liveness_watchdog"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    // Deliberately NOT slower when idle — "idle" is precisely the state this
    // watchdog exists to interrogate.
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(600)
    }

    async fn tick(&self) {
        use crate::engine::autonomy::{self, Action};
        let advancement_on = autonomy::global_enabled(&self.pool, Action::GoalAdvancement);
        // A project on `full` autopilot advances even with the global flag off,
        // so the stall watchdog must arm for it too — otherwise per-project
        // advancement would have no liveness protection.
        let any_full = autonomy::load_modes(&self.pool)
            .values()
            .any(|m| *m == crate::engine::autopilot::AutopilotMode::Full);
        if !advancement_on && !any_full {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            return; // silence is explained — the provider limit is in cooldown
        }

        let pool = self.pool.clone();
        let stall: Option<(i64, i64, i64)> = tokio::task::spawn_blocking(move || {
            let conn = pool.get().ok()?;
            // Zero executions started in the stall window? (RFC3339 'T'
            // timestamps — datetime()-wrap before comparing, the recurring
            // bit class.)
            let recent: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM persona_executions
                     WHERE datetime(created_at) > datetime('now', ?1)",
                    rusqlite::params![format!("-{FLEET_STALL_HOURS} hours")],
                    |r| r.get(0),
                )
                .ok()?;
            if recent > 0 {
                return None;
            }
            // Actionable work that SHOULD be producing executions.
            let open_goals: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_goals g
                     JOIN dev_projects dp ON dp.id = g.project_id
                     WHERE dp.team_id IS NOT NULL
                       AND g.status NOT IN ('done','completed') AND g.progress < 100",
                    [],
                    |r| r.get(0),
                )
                .ok()?;
            let pending_ideas: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_ideas i
                     JOIN dev_projects dp ON dp.id = i.project_id
                     WHERE dp.team_id IS NOT NULL AND i.status = 'pending'",
                    [],
                    |r| r.get(0),
                )
                .ok()?;
            let parked: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM team_assignments
                     WHERE status = 'awaiting_review' AND team_id IS NOT NULL",
                    [],
                    |r| r.get(0),
                )
                .ok()?;
            if open_goals + pending_ideas + parked == 0 {
                return None; // genuinely nothing to do — not a stall
            }
            Some((open_goals, pending_ideas, parked))
        })
        .await
        .ok()
        .flatten();

        let Some((open_goals, pending_ideas, parked)) = stall else {
            return;
        };

        tracing::warn!(
            open_goals,
            pending_ideas,
            parked,
            "fleet_liveness_watchdog: FLEET STALL — autonomy on, work available, no executions in {FLEET_STALL_HOURS}h"
        );
        let detail = format!(
            "Autonomous goal advancement is ON and work is available (open goals: {open_goals}, \
             pending backlog ideas: {pending_ideas}, parked awaiting-review: {parked}), but NO \
             persona execution has started in the last {FLEET_STALL_HOURS}h and no quota cooldown \
             explains the silence. Likely causes: parked reviews holding every goal slot \
             (resolve or enable Athena review resolution), disabled team members, or a \
             subscription failure. The fleet is NOT making progress."
        );
        let promoted = crate::db::repos::execution::audit_incidents::promote(
            &self.pool,
            crate::db::models::CreateAuditIncidentInput {
                source_table: "fleet".to_string(),
                source_id: "fleet_stall".to_string(), // stable → dedupes to ONE open incident
                persona_id: None,
                persona_name: Some("Fleet watchdog".to_string()),
                execution_id: None,
                severity: "high".to_string(),
                kind: "fleet_stall".to_string(),
                title: format!(
                    "Fleet stalled: no executions in {FLEET_STALL_HOURS}h with work available"
                ),
                detail: Some(detail),
            },
        );
        // Notify only when the incident is NEW (promote dedupes re-raises while
        // one is open) — one stall, one page.
        if let Ok(Some(_)) = promoted {
            crate::notifications::send(
                &self.app,
                "Fleet stalled",
                &format!(
                    "No executions in {FLEET_STALL_HOURS}h with {open_goals} open goals, {pending_ideas} backlog ideas, {parked} parked reviews."
                ),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Queue drain watchdog — re-drain the execution queue after a quota cooldown
// ---------------------------------------------------------------------------

/// Re-attempts draining the execution queue on a timer. The queue is normally
/// drained on each execution COMPLETION (a freed slot promotes the next queued
/// item) — but quota-aware admission can pause ALL admission while the AI
/// provider's limit is in cooldown, and once every in-flight execution has
/// drained there is no completion left to trigger a re-drain when the cooldown
/// later expires. This watchdog closes that gap: each tick, while the quota
/// cooldown has lifted and there is spare capacity with work waiting, it
/// promotes queued executions (each promotion's completion then cascades the
/// rest via the normal drain path). Also a general safety net for an otherwise
/// stuck queue. Always-on and a cheap no-op when idle. NOT gated by a setting —
/// it only ever drains work that was already admitted-then-queued.
pub struct QueueDrainWatchdog {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

#[async_trait::async_trait]
impl ReactiveSubscription for QueueDrainWatchdog {
    fn name(&self) -> &'static str {
        "queue_drain_watchdog"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(30)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(60)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(45)
    }

    async fn tick(&self) {
        // Promote up to a bounded number of queued executions per tick so a
        // post-cooldown queue fills its free slots promptly. Stop early when:
        // the quota is still in cooldown, there's no global capacity, the queue
        // is empty, OR a drain promoted nothing (e.g. all queued items are at
        // their per-persona cap) — the no-progress break prevents spinning.
        const MAX_PROMOTE_PER_TICK: usize = 16;
        for _ in 0..MAX_PROMOTE_PER_TICK {
            let (proceed, before) = {
                let t = self.engine.tracker().lock().await;
                (
                    t.quota_available() && t.has_global_capacity() && t.total_queued() > 0,
                    t.total_running(),
                )
            };
            if !proceed {
                break;
            }
            self.engine
                .drain_after_slot_freed(self.app.clone(), self.pool.clone())
                .await;
            let after = self.engine.tracker().lock().await.total_running();
            if after <= before {
                break;
            }
        }
    }
}
