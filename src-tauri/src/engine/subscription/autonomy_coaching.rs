use super::*;
use crate::db::DbPool;
use crate::engine::inflight_guard::InflightGuard;
use std::sync::LazyLock;
use std::time::Duration;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Director storm trigger (C3) — focused coaching when a persona's team work
// shows a burst of failures / QA change-requests.
// ---------------------------------------------------------------------------

/// Opt-in autonomous loop: when a team persona hits a STORM (≥2 step failures
/// or QA change-requests in the last 2h) and the Director hasn't coached it via
/// the channel in the last 6h, run a focused Director evaluation. The coaching
/// is bridged into the team channel by `run_director_cycle_for` (C3), so it
/// reaches the persona's next step. Complements the command-driven batch runs.
pub struct DirectorStormSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// A persona whose recent team work shows a storm and who hasn't been coached
/// in the channel recently (the rate-limit). Returns its persona id.
fn find_storm_persona(pool: &DbPool) -> Result<Option<String>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT s.assigned_persona_id, COUNT(*) AS bursts
         FROM team_assignment_events e
         JOIN team_assignment_steps s ON s.id = e.step_id
         JOIN team_assignments a ON a.id = e.assignment_id
         WHERE e.kind IN ('step_failed', 'qa_changes_requested_rework')
           AND datetime(e.created_at) > datetime('now', '-2 hours')
           AND s.assigned_persona_id IS NOT NULL
           AND a.team_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM team_channel_messages m
               WHERE m.author_kind = 'director'
                 AND m.addressed_to LIKE '%\"' || s.assigned_persona_id || '\"%'
                 AND datetime(m.created_at) > datetime('now', '-6 hours')
           )
         GROUP BY s.assigned_persona_id
         HAVING bursts >= 2
         ORDER BY bursts DESC
         LIMIT 1",
    )?;
    let row = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(Result::ok)
        .next();
    Ok(row)
}

#[async_trait::async_trait]
impl ReactiveSubscription for DirectorStormSubscription {
    fn name(&self) -> &'static str {
        "director_storm"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(3600)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(600)
    }

    async fn tick(&self) {
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::DirectorStorm);
        if !enabled {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("director_storm: quota cooldown active — skipping tick");
            return;
        }

        let persona = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || find_storm_persona(&pool))
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
        };
        let Some(persona_id) = persona else {
            return;
        };

        let Some(state) = self.app.try_state::<std::sync::Arc<crate::AppState>>() else {
            return;
        };
        tracing::info!(persona_id = %persona_id, "director_storm: storm detected — running focused Director coaching");
        match crate::engine::director::run_director_cycle_for(
            state.inner(),
            self.app.clone(),
            &persona_id,
        )
        .await
        {
            Ok(n) => {
                tracing::info!(persona_id = %persona_id, verdicts = n, "director_storm: coaching complete")
            }
            Err(e) => {
                tracing::warn!(persona_id = %persona_id, error = %e, "director_storm: coaching failed")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Athena channel reactions (cert: visible autonomous decisions in the channel)
// ---------------------------------------------------------------------------

/// Opt-in autonomous loop: Athena watches each goal-managed team's delivery
/// stream and reacts IN THE TEAM CHANNEL at reaction-worthy moments — an
/// awaiting-review cap-out she escalates to the user, a QA Guardian bounce, a
/// shipped goal — making a genuine react/decline decision per team (a headless
/// Claude call; she usually chooses silence). Lets the user SEE how Athena
/// decides throughout development (the channel carries each reaction + its
/// rationale footer). Restraint: at most `ATHENA_REACTION_MAX_PER_TICK` teams
/// per tick, deduped against her last channel post per team (the detection
/// cursor in `find_athena_reaction_signals`). Gated by
/// `AUTONOMOUS_ATHENA_REACTIONS` (default OFF) and the AI quota cooldown (each
/// reaction is one CLI decision).
pub struct AthenaChannelReactionSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// Backstop cap on Athena reactions per tick (one CLI decision each). The real
/// debounce is the per-team "newer than her last post" cursor; this only bounds
/// a cold-start burst across many teams.
// Batch-size cap (was a per-CALL cap of 4 when reactions ran one CLI call
// per signal). Signals are already deduped to one per team, so 10 covers the
// whole fleet; the CLI-call count per tick is now exactly 1.
const ATHENA_REACTION_MAX_PER_TICK: usize = 10;

#[async_trait::async_trait]
impl ReactiveSubscription for AthenaChannelReactionSubscription {
    fn name(&self) -> &'static str {
        "athena_channel_reactions"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(180)
    }

    async fn tick(&self) {
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::AthenaReactions);
        if !enabled {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("athena_channel_reactions: quota cooldown active — skipping tick");
            return;
        }

        // Review-resolution pass FIRST (B): parked awaiting_review cap-outs
        // starve the whole pipeline (goal-slot held → re-advance blocked →
        // backlog promotion starved — the 06-09 fleet deadlock), so draining
        // them outranks commentary. Opt-in via its own setting; each candidate
        // is one CLI decision + (on approve) one resumed QA round.
        let resolution_on = autonomy::global_enabled(&self.pool, Action::AthenaReviewResolution);
        if resolution_on {
            const MAX_RESOLUTIONS_PER_TICK: usize = 2;
            let candidates = {
                let pool = self.pool.clone();
                tokio::task::spawn_blocking(move || {
                    crate::companion::athena_reaction::find_review_resolution_candidates(
                        &pool,
                        MAX_RESOLUTIONS_PER_TICK,
                    )
                })
                .await
                .ok()
                .and_then(|r| r.ok())
                .unwrap_or_default()
            };
            for candidate in candidates {
                let team = candidate.team_name.clone();
                let aid = candidate.assignment_id.clone();
                match crate::companion::athena_reaction::run_athena_review_resolution(
                    &self.app, &self.pool, candidate,
                )
                .await
                {
                    Ok(outcome) => {
                        tracing::info!(team = %team, assignment = %aid, outcome, "athena_channel_reactions: review resolution done");
                    }
                    Err(e) => {
                        tracing::warn!(team = %team, assignment = %aid, error = %e, "athena_channel_reactions: review resolution failed");
                    }
                }
            }
        }

        // In-flight guard (mirrors `exec_triage` in execution_review.rs:660).
        // The wake gate below is a non-atomic read and `log_wake` lands only
        // AFTER the batch `run_athena_reaction_batch` CLI turn completes. A
        // reaction turn can outlast the 300s tick interval, so an overlapping
        // tick would pass the gate before the first logged its wake and
        // double-fire the CLI — duplicate channel posts and double token/$
        // spend. Hold a process-wide lease across the gate→CLI→log_wake region
        // so a concurrent tick early-returns instead of starting a second CLI
        // turn; the RAII handle releases the key on every exit (incl. panic).
        static CHANNEL_REACTIONS_INFLIGHT: LazyLock<InflightGuard> =
            LazyLock::new(InflightGuard::new);
        let _inflight = match CHANNEL_REACTIONS_INFLIGHT.guard("channel_reactions") {
            Some(handle) => handle,
            None => return,
        };

        let signals = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || {
                crate::companion::athena_reaction::find_athena_reaction_signals(&pool)
            })
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default()
        };
        if signals.is_empty() {
            return;
        }

        // Batched wake (docs/plans/athena-reaction-batching.md): ONE CLI call
        // decides every pending signal — Athena sees the fleet side by side
        // (cross-team patterns) and the doctrine is paid once per tick
        // instead of once per signal.
        let batch: Vec<_> = signals
            .into_iter()
            .take(ATHENA_REACTION_MAX_PER_TICK)
            .collect();
        let n = batch.len();
        // Wake window (docs/plans/athena-wake-window.md): awaiting-review
        // cap-outs are human-blocking — they bypass the timer.
        let has_priority = batch.iter().any(|s| s.kind == "awaiting_review");
        let wake =
            crate::companion::wake_window::gate(&self.pool, "channel_reactions", n, has_priority);
        if !wake.due {
            return; // per-team cursors keep the signals queued
        }
        let wake_started = std::time::Instant::now();
        match crate::companion::athena_reaction::run_athena_reaction_batch(
            &self.app, &self.pool, batch,
        )
        .await
        {
            Ok(posted) if posted > 0 => {
                tracing::info!(
                    posted,
                    signals = n,
                    "athena_channel_reactions: batch posted Athena reactions"
                );
                crate::companion::wake_window::log_wake(
                    &self.pool,
                    "channel_reactions",
                    wake.reason,
                    n,
                    1,
                    posted,
                    wake_started.elapsed().as_millis() as u64,
                );
            }
            Ok(_) => {
                tracing::debug!(
                    signals = n,
                    "athena_channel_reactions: batch declined all signals"
                );
                crate::companion::wake_window::log_wake(
                    &self.pool,
                    "channel_reactions",
                    wake.reason,
                    n,
                    1,
                    0,
                    wake_started.elapsed().as_millis() as u64,
                );
            }
            Err(e) => {
                tracing::warn!(signals = n, error = %e, "athena_channel_reactions: batch failed");
            }
        }
    }
}
