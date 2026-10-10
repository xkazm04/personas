use super::*;
use crate::db::models::LifecycleMeasureStarted;
use crate::db::DbPool;
use crate::error::AppError;
use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Overseer auto-measure (spark lifecycle-health WP2)
// ---------------------------------------------------------------------------

/// Measures one Overseer-watched project per tick, once per NEW base tip and
/// at least 30 minutes after its last measure, while the Overseer is switched
/// on (`overseer_enabled`). Spends no LLM budget: a Measure runs the project's
/// own gate and test commands. The pick is `lifecycle::overseer::due_project`;
/// the measure is `lifecycle::measure::start`, whose process-wide slot makes a
/// busy tick a skip. A project with nothing to measure is remembered at that
/// tip and not retried until its tip moves. The close-by-observation runs in
/// the measure's own follow-up, not here.
pub struct LifecycleWatchSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
    /// project -> the tip it was refused at (no commands to measure).
    /// Invariant: a plain map of retry suppressions; poisoning is recoverable.
    refused: Mutex<HashMap<String, String>>,
}

impl LifecycleWatchSubscription {
    pub fn new(pool: DbPool, app: tauri::AppHandle) -> Self {
        Self {
            pool,
            app,
            refused: Mutex::new(HashMap::new()),
        }
    }
}

/// What one tick did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleWatchTick {
    /// The Overseer is switched off.
    Disabled,
    /// No watched project is due.
    NothingDue,
    /// Another Measure holds the slot; try next tick.
    Busy,
    /// The project has nothing to measure at this tip; not retried until it moves.
    NothingToMeasure(String),
    /// A Measure started for this project.
    Started(String),
    /// The pick or the start failed for another reason (logged).
    Failed(String),
}

fn lock(m: &Mutex<HashMap<String, String>>) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One tick with the measure start injected, so the decision is testable
/// without an `AppHandle` or the process-global slot.
pub async fn lifecycle_watch_tick<S, Fut>(
    pool: &DbPool,
    refused: &Mutex<HashMap<String, String>>,
    start: S,
) -> LifecycleWatchTick
where
    S: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<LifecycleMeasureStarted, AppError>>,
{
    let skip = lock(refused).clone();
    let picked = {
        let pool = pool.clone();
        tokio::task::spawn_blocking(move || {
            if !crate::commands::companions::overseer_enabled(&pool) {
                return Ok(None);
            }
            crate::lifecycle::overseer::due_project(&pool, chrono::Utc::now(), &skip, &|p| {
                crate::lifecycle::measure::base_tip(
                    Path::new(&p.root_path),
                    p.main_branch.as_deref(),
                )
                .ok()
            })
            .map(Some)
        })
        .await
    };
    let (project_id, tip) = match picked {
        Ok(Ok(Some(Some(due)))) => due,
        Ok(Ok(Some(None))) => return LifecycleWatchTick::NothingDue,
        Ok(Ok(None)) => return LifecycleWatchTick::Disabled,
        Ok(Err(e)) => return LifecycleWatchTick::Failed(format!("could not pick a project: {e}")),
        Err(join) => {
            if join.is_panic() {
                std::panic::resume_unwind(join.into_panic());
            }
            return LifecycleWatchTick::Failed(format!("the pick was cancelled: {join}"));
        }
    };
    match start(project_id.clone()).await {
        Ok(started) => {
            tracing::debug!(project_id = %project_id, measure_id = %started.measure_id,
                "lifecycle_watch: measure id");
            LifecycleWatchTick::Started(project_id)
        }
        // The slot is process-wide: someone else's Measure is running.
        Err(AppError::Validation(_)) => LifecycleWatchTick::Busy,
        Err(AppError::NotFound(why)) => {
            tracing::debug!(project_id = %project_id, %why,
                "lifecycle_watch: nothing to measure; not retried until the tip moves");
            lock(refused).insert(project_id.clone(), tip);
            LifecycleWatchTick::NothingToMeasure(project_id)
        }
        Err(e) => LifecycleWatchTick::Failed(format!(
            "the auto-measure for {project_id} did not start: {e}"
        )),
    }
}

/// One line per cycle, so "switched off", "nothing due", "busy" and "broken"
/// stay distinguishable in the log. `Disabled` is the steady state while the
/// Overseer is off, so it logs at debug; every other outcome at info, a
/// failure at warn. A started measure also lands durably as its
/// `dev_lifecycle_runs` rows (`did_not_run` for any command that never ran).
fn log_outcome(outcome: &LifecycleWatchTick) {
    match outcome {
        LifecycleWatchTick::Disabled => {
            tracing::debug!(outcome = "disabled", "lifecycle_watch: Overseer is off")
        }
        LifecycleWatchTick::NothingDue => tracing::info!(
            outcome = "nothing_due",
            "lifecycle_watch: no watched project has a new base tip due"
        ),
        LifecycleWatchTick::Busy => tracing::info!(
            outcome = "busy",
            "lifecycle_watch: another Measure holds the slot; next tick"
        ),
        LifecycleWatchTick::NothingToMeasure(project_id) => tracing::info!(
            outcome = "nothing_to_measure", project_id = %project_id,
            "lifecycle_watch: no commands; not retried until the tip moves"
        ),
        LifecycleWatchTick::Started(project_id) => tracing::info!(
            outcome = "started", project_id = %project_id,
            "lifecycle_watch: auto-measure started"
        ),
        LifecycleWatchTick::Failed(reason) => tracing::warn!(
            outcome = "failed", %reason,
            "lifecycle_watch: the cycle failed"
        ),
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for LifecycleWatchSubscription {
    fn name(&self) -> &'static str {
        "lifecycle_watch"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(300)
    }

    /// The trait fixes `()`; the cycle's outcome is [`LifecycleWatchTick`],
    /// logged here every cycle (see [`log_outcome`]).
    async fn tick(&self) {
        let (pool, app) = (self.pool.clone(), self.app.clone());
        let outcome = lifecycle_watch_tick(&self.pool, &self.refused, move |project_id| {
            let notify = crate::lifecycle::measure::emitter(app);
            crate::lifecycle::measure::start(pool, project_id, notify)
        })
        .await;
        log_outcome(&outcome);
    }
}

#[cfg(test)]
#[path = "lifecycle_watch_tests.rs"]
mod tests;
