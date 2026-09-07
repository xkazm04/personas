//! Persona attention loop (living-agent WP5) — the standing scheduler that
//! keeps a chartered persona *alive*: answering what arrived, consolidating
//! what it lived, advancing what it owns, and once a day reviewing itself.
//!
//! One dispatch per tick, chosen by lane priority
//! **arrivals > maintenance > improve > advance** — the self-review
//! (`improve`) takes the day's FIRST otherwise-eligible work slot (at most
//! once per day, via `count_today(lane='improve')`), then advancement resumes
//! for the rest of the day; without the preemption, advance always has a
//! candidate and the self-review would be unreachable — for the FIRST persona
//! that clears the admission ladder (first refusal wins, in order):
//!
//! 1. **in-flight** — an open attention ledger row younger than
//!    [`IN_FLIGHT_WINDOW_MINUTES`]; older open rows are ignored and counted
//!    in the tick summary (a crashed pass must not wedge the loop);
//! 2. **interval floor** — last completed pass + the persona's most
//!    conservative charter interval (`max(intervalMinutes)`, default 30);
//! 3. **quiet hours** — any charter's `"HH:MM-HH:MM"` local window (parsed
//!    leniently: an unparseable spec quiets nothing and warns once);
//! 4. **daily cap** — `count_today` vs the most conservative declared
//!    `maxRunsPerDay` (`min`, default 24);
//! 5. **monthly budget** — the SAME `get_monthly_spend` vs `max_budget_usd`
//!    check `execute_persona_inner` enforces, pre-flighted so the ledger
//!    refuses loudly instead of the spawn dying in a Validation error.
//!
//! Every decision is ledgered in `persona_attention_ledger` (kind
//! `attention`): a dispatch opens a `started` row BEFORE the spawn and closes
//! it `dispatched`/`enqueued`/`failed`/`panicked` — the row records the
//! attention DECISION; the run's own outcome lives in `persona_executions`
//! (or the job / channel rows). A refusal that suppressed real pending work
//! lands as a typed [`AttentionRefusal`] refusal row, **deduped to one row
//! per refusal episode per day** (deliberate deviation from
//! "every refusal writes a row": at a 5-minute tick the interval floor
//! refuses most ticks *by design*, and ~240 identical rows/day/persona would
//! bury the ledger's audit value; the per-tick aggregate `tracing::info!`
//! still narrates every count). Plain nothing-to-do skips write no rows.
//!
//! Default OFF behind `autonomous_attention_loop`
//! ([`crate::engine::autonomy::Action::AttentionLoop`]) — the tick is free
//! when disabled and free when no charter has `cadence.attentionEnabled`.

use super::*;
use std::cmp::Ordering as CmpOrdering;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use personas_core::cycle::{AttentionRefusal, CycleVerdict};
use tauri::AppHandle;

use crate::db::models::{Persona, PersonaResponsibility};
use crate::db::repos::core::{
    attention_ledger, personas as persona_repo, responsibilities, settings,
};
use crate::db::repos::execution::executions as executions_repo;
use crate::db::repos::resources::team_channel;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

const KIND_ATTENTION: &str = "attention";
pub(crate) const LANE_ARRIVALS: &str = "arrivals";
pub(crate) const LANE_MAINTENANCE: &str = "maintenance";
pub(crate) const LANE_ADVANCE: &str = "advance";
pub(crate) const LANE_IMPROVE: &str = "improve";
/// The App Master lane (see [`super::attention_decide`]): one bounded model
/// call decides WHICH charters move the project this wake, and up to the
/// persona's free capacity are dispatched. Stands in for `advance` on a
/// persona holding a project-bound charter; every other persona is untouched.
///
/// `persona_attention_ledger.lane` is a plain nullable TEXT with no CHECK
/// (`e16_living_agent.rs`, the table DDL), so a new lane needs no migration —
/// verified against the DDL rather than assumed.
pub(crate) const LANE_DECIDE: &str = "decide";

/// Charter interval floor when no charter declares `intervalMinutes`.
const DEFAULT_INTERVAL_MINUTES: i64 = 30;
/// Daily cap when no charter declares `maxRunsPerDay`.
const DEFAULT_MAX_RUNS_PER_DAY: i64 = 24;
/// An open `started` row younger than this refuses a new pass; older open
/// rows are treated as crashed and ignored (noted in the tick summary).
const IN_FLIGHT_WINDOW_MINUTES: i64 = 30;
/// Arrivals recovery only looks at user messages at least this old — younger
/// ones are still owned by the live post path's own reply-waiter.
const ARRIVALS_MIN_AGE_MINUTES: i64 = 10;
/// …and no older than this: recovery re-answers the recent past, it does not
/// resurrect the archive.
const ARRIVALS_LOOKBACK_DAYS: i64 = 7;
/// Hard bound on a dispatched task brief.
const MAX_TASK_CHARS: usize = 4000;

/// Trimmed guardrail preamble for attention-dispatched executions — modeled
/// on `personas_engine::unattended::UNATTENDED_DISPATCH_GUARDRAILS` (the
/// finish-don't-ask contract), narrowed to what a charter pass may do:
/// propose-only for anything structural, never touch its own gates, protocol
/// verbs for findings.
const ATTENTION_GUARDRAILS: &str = "\
--- Attention-pass guardrails ---\n\
You are running UNATTENDED under your standing charter. Hard rules:\n\
1. PROPOSE, never restructure: for anything structural (schema, architecture, \
ownership, processes) record a propose_backlog entry instead of changing it.\n\
2. NEVER touch your own gates: your charters, guardrails, budgets, approval \
gates and this loop's settings are read-only to you.\n\
3. Record durable findings with emit_memory and improvement ideas with \
propose_backlog — the protocol verbs, not ad-hoc files.\n\
4. Stay inside the scope rung named above; anything past it is a proposal, \
not an action.\n\
5. NOBODY IS THERE: never end with a question or a request for confirmation. \
Finish with a short report of what advanced and what is blocked.";

// ── Wake requests (the switch-on carrier) ──────────────────────────────────

/// Record that `persona_id` was just switched ON and is owed ONE pass that
/// skips the interval floor, then nudge the loop so it runs in seconds rather
/// than at the next 300 s poll.
///
/// The durable half is a settings row (`ATTENTION_WAKE_REQUESTS`, a JSON array
/// of persona ids); the signal is only latency. See the settings key's own doc
/// for why a row beats a `persona_background_job` here.
///
/// Never fails the caller: a persona that switched on and did not get its
/// early pass simply waits out the interval floor, which is the behaviour that
/// exists today. A failure to record is warned, not returned.
pub(crate) fn request_wake(pool: &DbPool, persona_id: &str) {
    let mut ids = read_wake_requests(pool);
    if !ids.iter().any(|id| id == persona_id) {
        ids.push(persona_id.to_string());
        // Oldest-first drop: a wake is a nudge, and the newest switch-on is
        // the one the operator is watching.
        while ids.len() > settings_keys::ATTENTION_WAKE_REQUESTS_MAX {
            ids.remove(0);
        }
        if let Err(e) = write_wake_requests(pool, &ids) {
            tracing::warn!(persona_id, error = %e,
                "persona_attention: could not record the wake request — the persona \
                 will start at its next ordinary tick instead");
            return;
        }
    }
    super::attention_wake_signal().notify_one();
}

/// The persona ids owed a floor-skipping pass. An absent or unparseable row
/// means "none owed" — the loop must never refuse to tick because a settings
/// value went bad.
fn read_wake_requests(pool: &DbPool) -> Vec<String> {
    let raw = match settings::get(pool, settings_keys::ATTENTION_WAKE_REQUESTS) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "persona_attention: wake-request read failed");
            return Vec::new();
        }
    };
    let Some(raw) = raw else { return Vec::new() };
    // INVARIANT: this row is written only by `write_wake_requests` below, so a
    // parse failure means foreign/corrupt data, which reads as "none owed".
    match serde_json::from_str::<Vec<String>>(&raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e,
                "persona_attention: unparseable wake-request row — treating as none owed");
            Vec::new()
        }
    }
}

fn write_wake_requests(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        settings::delete(pool, settings_keys::ATTENTION_WAKE_REQUESTS)?;
        return Ok(());
    }
    let json = serde_json::to_string(ids)
        .map_err(|e| AppError::Internal(format!("serialize attention wake requests: {e}")))?;
    settings::set(pool, settings_keys::ATTENTION_WAKE_REQUESTS, &json)
}

/// Take ONE persona's wake request, clearing it so the bypass is spent exactly
/// once. Returns whether a request was held.
fn consume_wake_request(pool: &DbPool, persona_id: &str) -> bool {
    let mut ids = read_wake_requests(pool);
    let before = ids.len();
    ids.retain(|id| id != persona_id);
    if ids.len() == before {
        return false;
    }
    if let Err(e) = write_wake_requests(pool, &ids) {
        // Leaving the request in place would let the persona bypass the floor
        // on every tick — worse than losing the bypass. Refuse the bypass.
        tracing::warn!(persona_id, error = %e,
            "persona_attention: could not clear the wake request — declining the \
             floor bypass rather than granting it repeatedly");
        return false;
    }
    true
}

// ── Subscription ───────────────────────────────────────────────────────────

/// The attention scheduler. Registered in `background::lifecycle::start_loops`
/// beside the other autonomy subscriptions (leadership default `true`: one
/// scheduler per shared DB).
pub struct AttentionSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    pub state: Arc<crate::AppState>,
}

#[async_trait::async_trait]
impl ReactiveSubscription for AttentionSubscription {
    fn name(&self) -> &'static str {
        "persona_attention"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }

    /// Same as the active interval on purpose. Cycle 1 (2026-09-07) measured
    /// the 900 s idle fallback stretching three App Masters' first decisions
    /// over most of an hour: the plan is a handful of indexed reads, and a
    /// switched-on persona that waits fifteen minutes between wakes is not
    /// idle, it is starved.
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(300)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(120)
    }

    /// Switching a persona ON runs the tick within seconds instead of at the
    /// next poll. The poll is unchanged and remains the heartbeat: the wake
    /// REQUEST is durable (a settings row), so a missed signal costs latency
    /// and never the pass.
    fn wake_signal(&self) -> Option<&'static tokio::sync::Notify> {
        Some(super::attention_wake_signal())
    }

    async fn tick(&self) {
        // Plan on the blocking pool (rusqlite is sync — the GoalAdvance
        // idiom; `run_blocking_tick` cannot hand a value back). A panic in
        // the plan re-propagates so run_single's catch_unwind still records
        // the crash and applies backoff.
        let pool = self.pool.clone();
        let planned = match tokio::task::spawn_blocking(move || plan_tick_gated(&pool)).await {
            Ok(p) => p,
            Err(join_err) => {
                if join_err.is_panic() {
                    std::panic::resume_unwind(join_err.into_panic());
                }
                return;
            }
        };
        let Some((counts, dispatch)) = planned else {
            return; // gated off / cooling down / plan failed (already logged)
        };
        if counts.personas > 0 {
            // One aggregate narration per tick (the ProbationSummary idiom).
            tracing::info!(
                personas = counts.personas,
                refused = counts.refused,
                refusal_rows = counts.refusal_rows,
                stale_open = counts.stale_open,
                idle = counts.idle,
                lane = counts.dispatched.unwrap_or("none"),
                "persona_attention: tick summary"
            );
        }
        let woke = counts.woke;
        if let Some(plan) = dispatch {
            execute_dispatch(self.state.clone(), self.app.clone(), plan);
        }
        // A tick serves one persona. When this tick spent a wake and other
        // wake requests are still queued, re-arm the signal so the next persona
        // is served on the next loop iteration instead of a poll later. Gated
        // on progress: a wake-holder refused in-flight leaves its request
        // queued, and re-arming on that would spin the loop.
        if woke > 0 {
            let pool = self.pool.clone();
            let pending = tokio::task::spawn_blocking(move || read_wake_requests(&pool))
                .await
                .unwrap_or_default();
            if !pending.is_empty() {
                super::attention_wake_signal().notify_one();
            }
        }
    }
}

// ── Plan (DB-only, testable without an AppHandle) ──────────────────────────

/// Per-tick counters for the aggregate narration line.
#[derive(Debug, Default)]
pub(crate) struct TickCounts {
    /// Personas holding ≥1 active, attention-enabled charter this tick.
    pub personas: usize,
    /// Personas refused by the admission ladder.
    pub refused: usize,
    /// Refusal rows actually written (refusals with pending work, deduped).
    pub refusal_rows: usize,
    /// Stale open ledger rows ignored by the in-flight probe.
    pub stale_open: usize,
    /// Admitted personas with no pending work in any lane (no rows written).
    pub idle: usize,
    /// The lane dispatched this tick, if any (one per tick).
    pub dispatched: Option<&'static str>,
    /// Wake requests consumed at admission this tick.
    pub woke: usize,
}

/// What the executor must spawn. Maintenance is absent by design: its whole
/// action (enqueue a `sleep_consolidation_run` job) is DB-only and already
/// done by the plan.
pub(crate) enum DispatchWork {
    Arrivals {
        message_id: String,
        content: String,
    },
    Advance {
        responsibility_id: String,
        task: String,
    },
    Improve {
        task: String,
    },
    /// The App Master decision. The context is gathered at PLAN time (DB-only,
    /// on the blocking pool); the model call, the parse, the fan-out and the
    /// pacing write-back all happen in the executor.
    Decide {
        /// Boxed: `DecisionContext` carries the whole charter roster and the
        /// project snapshots, and this enum otherwise holds two short strings.
        context: Box<attention_decide::DecisionContext>,
        /// The deterministic fallback, computed here so a failed model call
        /// costs one dispatch rather than a second round trip to the database
        /// from the async half: `(responsibility_id, standing task text)` of
        /// the least-recently-advanced charter, exactly what the `advance`
        /// lane would have picked.
        fallback: Option<(String, String)>,
    },
}

/// One planned dispatch: the ledger row is already open (`started`), the
/// work payload is fully built. [`execute_dispatch`] spawns it;
/// [`record_dispatch_outcome`] closes the row (tests drive it directly as
/// the spawn-stub seam).
pub(crate) struct PlannedDispatch {
    pub persona_id: String,
    pub persona_name: String,
    pub ledger_id: String,
    pub work: DispatchWork,
}

/// Gates 1–2 plus the plan, as one blocking body. `None` = the tick is over
/// (disabled / quota cooldown / plan error, already logged) — zero rows,
/// zero spend.
pub(crate) fn plan_tick_gated(pool: &DbPool) -> Option<(TickCounts, Option<PlannedDispatch>)> {
    use crate::engine::autonomy::{self, Action};
    // 1. Default-OFF opt-in — the ONE autonomy front door.
    if !autonomy::global_enabled(pool, Action::AttentionLoop) {
        return None;
    }
    // 2. Global spend-safety cooldown.
    if quota_cooldown_active(pool) {
        return None;
    }
    match plan_tick(pool) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(error = %e, "persona_attention: plan failed");
            None
        }
    }
}

/// The decision half: roster → admission ladder per persona → lane choice for
/// the first admitted persona → ledger `started` row + built payload.
/// Maintenance executes fully here (enqueue is DB-only).
pub(crate) fn plan_tick(pool: &DbPool) -> Result<(TickCounts, Option<PlannedDispatch>), AppError> {
    let mut counts = TickCounts::default();
    // 3. The work list — free when unused.
    let charters = responsibilities::list_active_with_attention(pool)?;
    if charters.is_empty() {
        return Ok((counts, None));
    }

    // 4. Group per persona, preserving roster order (created ASC).
    let mut order: Vec<&str> = Vec::new();
    let mut grouped: HashMap<&str, Vec<&PersonaResponsibility>> = HashMap::new();
    for c in &charters {
        let entry = grouped.entry(c.persona_id.as_str()).or_default();
        if entry.is_empty() {
            order.push(c.persona_id.as_str());
        }
        entry.push(c);
    }
    counts.personas = order.len();

    for pid in order {
        let persona_charters = &grouped[pid];
        let admission = match admit_persona(pool, pid, persona_charters, &mut counts) {
            Ok(a) => a,
            Err(e) => {
                tracing::warn!(persona_id = %pid, error = %e,
                    "persona_attention: admission failed — skipping persona");
                continue;
            }
        };
        let (persona, woke) = match admission {
            Admission::Refused(reason) => {
                counts.refused += 1;
                record_refusal_if_work_pends(pool, pid, persona_charters, &reason, &mut counts);
                continue;
            }
            Admission::Admitted { persona, woke } => (persona, woke),
        };
        if woke {
            counts.woke += 1;
        }

        // 5. Lane choice — arrivals > maintenance > improve > advance.
        //
        // A WAKE is the operator switching an App Master on, and what they
        // asked for is the decision: "reconcile your responsibilities and
        // decide what needs doing". Cycle 1 measured the plain precedence
        // spending the first two wakes of every new App Master on the daily
        // self-review and a memory pass, with the decision an hour away. So a
        // woken App Master decides first; the other lanes take later ticks.
        let work = if woke && is_app_master(persona_charters) {
            LaneWork::Decide
        } else {
            let Some(work) = find_work(pool, pid, persona_charters)? else {
                counts.idle += 1; // plain nothing-to-do: no rows
                continue;
            };
            work
        };

        // 6. Ledger discipline: the DECISION row opens BEFORE any spawn.
        match work {
            LaneWork::Maintenance => {
                counts.dispatched = Some(LANE_MAINTENANCE);
                let ledger_id = attention_ledger::insert_started(
                    pool,
                    pid,
                    None,
                    KIND_ATTENTION,
                    Some(LANE_MAINTENANCE),
                )?;
                // The non-forced scheduling path WP4 left open: the job's own
                // handler re-admits, runs, and writes its own consolidation
                // ledger row — this attention row records only the decision.
                let enqueued = crate::engine::persona_jobs::enqueue(
                    pool,
                    crate::engine::persona_jobs::KIND_SLEEP_CONSOLIDATION,
                    &serde_json::json!({ "personaId": pid, "force": false }),
                    Some(pid),
                );
                match enqueued {
                    Ok(job_id) => record_dispatch_outcome_with(
                        pool,
                        &ledger_id,
                        "enqueued",
                        Ok(serde_json::json!({ "jobId": job_id })),
                    ),
                    Err(e) => record_dispatch_outcome_with(pool, &ledger_id, "enqueued", Err(e)),
                }
                return Ok((counts, None));
            }
            LaneWork::Arrivals {
                message_id,
                content,
            } => {
                counts.dispatched = Some(LANE_ARRIVALS);
                let ledger_id = attention_ledger::insert_started(
                    pool,
                    pid,
                    None,
                    KIND_ATTENTION,
                    Some(LANE_ARRIVALS),
                )?;
                return Ok((
                    counts,
                    Some(PlannedDispatch {
                        persona_id: pid.to_string(),
                        persona_name: persona.name.clone(),
                        ledger_id,
                        work: DispatchWork::Arrivals {
                            message_id,
                            content,
                        },
                    }),
                ));
            }
            LaneWork::Advance { responsibility_id } => {
                counts.dispatched = Some(LANE_ADVANCE);
                let charter = persona_charters
                    .iter()
                    .find(|c| c.id == responsibility_id)
                    .copied();
                let task = charter.map(build_advance_task).unwrap_or_default();
                let ledger_id = attention_ledger::insert_started(
                    pool,
                    pid,
                    Some(&responsibility_id),
                    KIND_ATTENTION,
                    Some(LANE_ADVANCE),
                )?;
                return Ok((
                    counts,
                    Some(PlannedDispatch {
                        persona_id: pid.to_string(),
                        persona_name: persona.name.clone(),
                        ledger_id,
                        work: DispatchWork::Advance {
                            responsibility_id,
                            task,
                        },
                    }),
                ));
            }
            LaneWork::Decide => {
                counts.dispatched = Some(LANE_DECIDE);
                // The decision's OWN row: `responsibility_id` is None because
                // the decision is about the whole roster. Each charter it
                // dispatches opens its own row naming that charter.
                let context =
                    build_decision_context(pool, &persona, persona_charters).map(Box::new);
                let context = match context {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::warn!(persona_id = %pid, error = %e,
                            "persona_attention: decision context read failed — skipping persona");
                        continue;
                    }
                };
                let fallback = pick_advance_charter(pool, pid, persona_charters)?.and_then(|rid| {
                    persona_charters
                        .iter()
                        .find(|c| c.id == rid)
                        .map(|c| (rid.clone(), build_advance_task(c)))
                });
                let ledger_id = attention_ledger::insert_started(
                    pool,
                    pid,
                    None,
                    KIND_ATTENTION,
                    Some(LANE_DECIDE),
                )?;
                return Ok((
                    counts,
                    Some(PlannedDispatch {
                        persona_id: pid.to_string(),
                        persona_name: persona.name.clone(),
                        ledger_id,
                        work: DispatchWork::Decide { context, fallback },
                    }),
                ));
            }
            LaneWork::Improve => {
                counts.dispatched = Some(LANE_IMPROVE);
                let ledger_id = attention_ledger::insert_started(
                    pool,
                    pid,
                    None,
                    KIND_ATTENTION,
                    Some(LANE_IMPROVE),
                )?;
                return Ok((
                    counts,
                    Some(PlannedDispatch {
                        persona_id: pid.to_string(),
                        persona_name: persona.name.clone(),
                        ledger_id,
                        work: DispatchWork::Improve {
                            task: build_improve_task(),
                        },
                    }),
                ));
            }
        }
    }
    Ok((counts, None))
}

// ── Admission ladder ───────────────────────────────────────────────────────

enum Admission {
    /// Boxed: `Persona` is a wide row and this enum lives on the happy path.
    /// `woke` is true when a pending wake request was consumed on the way in.
    Admitted {
        persona: Box<Persona>,
        woke: bool,
    },
    Refused(AttentionRefusal),
}

/// The five checks IN ORDER; the first refusal wins.
fn admit_persona(
    pool: &DbPool,
    persona_id: &str,
    charters: &[&PersonaResponsibility],
    counts: &mut TickCounts,
) -> Result<Admission, AppError> {
    // (a) in-flight: a young open row refuses; stale open rows are noted.
    for row in attention_ledger::list_open(pool, persona_id, KIND_ATTENTION)? {
        match minutes_since_ts(&row.started_at) {
            Some(m) if m < IN_FLIGHT_WINDOW_MINUTES => {
                return Ok(Admission::Refused(AttentionRefusal::InFlight {
                    started_at: row.started_at,
                }));
            }
            // Older than the window OR unparseable: a crashed pass must not
            // wedge the persona forever — ignore, but say so.
            _ => counts.stale_open += 1,
        }
    }

    // (b) interval floor: last completed pass + the most conservative
    // declared interval (max over the persona's charters, default 30m).
    //
    // A pending WAKE request (the persona was just switched on) skips THIS
    // rung and only this one — the in-flight probe above already ran, and
    // quiet hours, the daily cap and the budget below still refuse. Switching
    // a persona on is permission to start, not permission to exceed its
    // declared limits. The request is consumed as soon as the persona passes
    // the in-flight probe, whether or not the floor would have refused: a
    // persona with no completed pass yet has no floor to spend it on, and a
    // wake that lingered until its first refusal was the reason cycle 1's
    // App Masters never reached their decision.
    let woke = consume_wake_request(pool, persona_id);
    if woke {
        tracing::info!(
            persona_id,
            "persona_attention: wake request admits the persona for one pass"
        );
    }
    let interval = charters
        .iter()
        .filter_map(|c| c.cadence.interval_minutes)
        .max()
        .unwrap_or(DEFAULT_INTERVAL_MINUTES)
        .max(1);
    if let Some(last) = attention_ledger::last_completed(pool, persona_id, KIND_ATTENTION)? {
        let minutes = last.completed_at.as_deref().and_then(minutes_since_ts);
        if let Some(refusal) = interval_floor_refusal(minutes, interval) {
            if !woke {
                return Ok(Admission::Refused(refusal));
            }
        }
    }

    // (c) quiet hours: any charter's local window refuses; an unparseable
    // spec quiets nothing (lenient) and warns once per process.
    let now_minute = {
        use chrono::Timelike;
        let now = chrono::Local::now();
        now.hour() * 60 + now.minute()
    };
    for c in charters {
        let Some(spec) = c.cadence.quiet_hours.as_deref() else {
            continue;
        };
        let spec = spec.trim();
        if spec.is_empty() {
            continue;
        }
        match parse_quiet_hours(spec) {
            Some((start, end)) if in_quiet_window(now_minute, start, end) => {
                return Ok(Admission::Refused(AttentionRefusal::QuietHours {
                    window: spec.to_string(),
                }));
            }
            Some(_) => {}
            None => {
                static QUIET_HOURS_WARNED: std::sync::Once = std::sync::Once::new();
                QUIET_HOURS_WARNED.call_once(|| {
                    tracing::warn!(
                        responsibility_id = %c.id,
                        spec = %spec,
                        "persona_attention: unparseable quietHours (want \"HH:MM-HH:MM\") — treated as no quiet hours"
                    );
                });
            }
        }
    }

    // (d) daily cap: today's non-refused passes vs the most conservative
    // declared cap (min over charters, default 24; a declared 0 = never).
    let cap = charters
        .iter()
        .filter_map(|c| c.cadence.max_runs_per_day)
        .min()
        .unwrap_or(DEFAULT_MAX_RUNS_PER_DAY)
        .max(0);
    let runs_today = attention_ledger::count_today(pool, persona_id, KIND_ATTENTION, None)?;
    if runs_today >= cap {
        return Ok(Admission::Refused(AttentionRefusal::DailyCapReached {
            runs_today,
            cap,
        }));
    }

    // (e) monthly budget — the SAME check execute_persona_inner runs
    // (get_monthly_spend vs persona.max_budget_usd), pre-flighted so the
    // ledger refuses loudly instead of the spawn failing Validation.
    // `0.0` spells "no limit" for max_budget_usd (the documented persona-
    // budget convention); resolve that ONCE at the read — the director_lab
    // `weekly_budget_usd` reader shape — instead of re-asking positivity at
    // the compare (spend-ceilings golden path, §4 step 3).
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    let configured_ceiling = persona.max_budget_usd.filter(|b| b.is_finite() && *b > 0.0);
    if let Some(limit) = configured_ceiling {
        let spent = executions_repo::get_monthly_spend(pool, persona_id)?;
        if spent >= limit {
            return Ok(Admission::Refused(AttentionRefusal::BudgetExhausted {
                spent_usd: spent,
                limit_usd: limit,
            }));
        }
    }

    Ok(Admission::Admitted {
        persona: Box::new(persona),
        woke,
    })
}

/// A refusal that suppressed real pending work lands in the ledger; a refusal
/// over an empty plate does not. Deduped to one row per (reason kind, day) —
/// see the module docs for why the literal every-tick row would be noise.
fn record_refusal_if_work_pends(
    pool: &DbPool,
    persona_id: &str,
    charters: &[&PersonaResponsibility],
    reason: &AttentionRefusal,
    counts: &mut TickCounts,
) {
    let pending = match find_work(pool, persona_id, charters) {
        Ok(w) => w.is_some(),
        Err(e) => {
            tracing::warn!(persona_id = %persona_id, error = %e,
                "persona_attention: pending-work probe failed — refusal not ledgered");
            return;
        }
    };
    if !pending {
        return;
    }
    match should_record_refusal(pool, persona_id, reason) {
        Ok(true) => {
            let json = serde_json::to_string(reason).unwrap_or_else(|_| reason.describe());
            match attention_ledger::insert_refusal(
                pool,
                persona_id,
                None,
                KIND_ATTENTION,
                None,
                &json,
            ) {
                Ok(_) => counts.refusal_rows += 1,
                Err(e) => tracing::warn!(persona_id = %persona_id, error = %e,
                    "persona_attention: failed to write refusal row"),
            }
        }
        Ok(false) => {}
        Err(e) => tracing::warn!(persona_id = %persona_id, error = %e,
            "persona_attention: refusal dedupe probe failed"),
    }
}

/// Skip the row when the persona's newest attention entry is already a
/// refusal with the same serialized `kind`, from today (UTC) — one row per
/// refusal episode per day.
fn should_record_refusal(
    pool: &DbPool,
    persona_id: &str,
    reason: &AttentionRefusal,
) -> Result<bool, AppError> {
    let Some(last) = attention_ledger::last_row(pool, persona_id, KIND_ATTENTION)? else {
        return Ok(true);
    };
    if last.verdict != "refused" {
        return Ok(true);
    }
    let same_kind = serde_json::from_str::<serde_json::Value>(&last.reason)
        .ok()
        .and_then(|v| {
            v.get("kind")
                .and_then(|k| k.as_str())
                .map(|k| k == reason.kind())
        })
        .unwrap_or(false);
    if !same_kind {
        return Ok(true);
    }
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    Ok(!last.started_at.starts_with(&today))
}

// ── Lane choice ────────────────────────────────────────────────────────────

/// A lane with concrete work attached (pre-payload).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LaneWork {
    Arrivals {
        message_id: String,
        content: String,
    },
    Maintenance,
    Advance {
        responsibility_id: String,
    },
    Improve,
    /// The App Master decision — see [`LANE_DECIDE`].
    Decide,
}

/// Measure all four lanes, then decide purely via [`choose_lane`].
fn find_work(
    pool: &DbPool,
    persona_id: &str,
    charters: &[&PersonaResponsibility],
) -> Result<Option<LaneWork>, AppError> {
    let arrival = team_channel::oldest_unanswered_persona_message(
        pool,
        persona_id,
        ARRIVALS_MIN_AGE_MINUTES,
        ARRIVALS_LOOKBACK_DAYS,
    )?;
    let maintenance = matches!(
        crate::engine::persona_brain::sleep_cycle::admit(pool, persona_id, false)?,
        CycleVerdict::Admit(_)
    );
    let advance = pick_advance_charter(pool, persona_id, charters)?;
    let improve =
        attention_ledger::count_today(pool, persona_id, KIND_ATTENTION, Some(LANE_IMPROVE))? == 0;
    Ok(choose_lane(
        arrival,
        maintenance,
        advance,
        improve,
        is_app_master(charters),
    ))
}

/// An **App Master** is a persona holding at least one admitted charter bound
/// to a project. That is the whole test: a project-bound charter is what gives
/// the decision something to be about (a codebase with ideas, contexts and
/// KPIs), and a persona with none of them has nothing the decision could read.
pub(crate) fn is_app_master(charters: &[&PersonaResponsibility]) -> bool {
    charters.iter().any(|c| {
        c.project_id
            .as_deref()
            .is_some_and(|p| !p.trim().is_empty())
    })
}

/// The lane priority — arrivals > maintenance > improve > advance — as one
/// pure decision over pre-measured inputs. Improve sits ABOVE advance so the
/// daily self-review takes the day's first otherwise-eligible slot exactly
/// once (`improve_available` is false for the rest of the day), after which
/// advancement wins every remaining pass; below advance it would be
/// unreachable, since a charter with outcomes always gives advance a
/// candidate.
/// `is_app_master` swaps the LAST rung only: `decide` stands exactly where
/// `advance` stood, so arrivals recovery, consolidation and the daily
/// self-review keep their precedence for an App Master too. Answering a human
/// and keeping memory healthy are not "which responsibility moves the project"
/// questions, and routing them through a model call would be both slower and
/// less correct than the rules that already decide them.
///
/// An App Master reaches `decide` even when `advance` has no candidate: the
/// advance lane only considers charters carrying an outcome or an objective,
/// while the decision considers everything the persona holds.
fn choose_lane(
    arrival: Option<(String, String)>,
    maintenance_admitted: bool,
    advance_responsibility: Option<String>,
    improve_available: bool,
    app_master: bool,
) -> Option<LaneWork> {
    if let Some((message_id, content)) = arrival {
        return Some(LaneWork::Arrivals {
            message_id,
            content,
        });
    }
    if maintenance_admitted {
        return Some(LaneWork::Maintenance);
    }
    if improve_available {
        return Some(LaneWork::Improve);
    }
    if app_master {
        return Some(LaneWork::Decide);
    }
    if let Some(responsibility_id) = advance_responsibility {
        return Some(LaneWork::Advance { responsibility_id });
    }
    None
}

/// The advance lane's charter pick: among charters that carry something to
/// advance (≥1 outcome or objective), the least-recently-advanced first —
/// derived from ledger history (the house derive-from-history idiom), never
/// a stored cursor.
fn pick_advance_charter(
    pool: &DbPool,
    persona_id: &str,
    charters: &[&PersonaResponsibility],
) -> Result<Option<String>, AppError> {
    let candidates: Vec<&PersonaResponsibility> = charters
        .iter()
        .filter(|c| !c.outcomes.is_empty() || !c.objectives.is_empty())
        .copied()
        .collect();
    if candidates.is_empty() {
        return Ok(None);
    }
    let history: HashMap<String, String> = attention_ledger::latest_started_per_responsibility(
        pool,
        persona_id,
        KIND_ATTENTION,
        LANE_ADVANCE,
    )?
    .into_iter()
    .collect();
    Ok(select_least_recently_advanced(&candidates, &history))
}

/// Pure rotation: never-advanced beats any timestamp; among advanced, the
/// oldest `started_at` wins; ties keep roster order (min_by_key is stable).
fn select_least_recently_advanced(
    candidates: &[&PersonaResponsibility],
    history: &HashMap<String, String>,
) -> Option<String> {
    candidates
        .iter()
        .min_by_key(|c| match history.get(&c.id) {
            None => (0u8, String::new()),
            Some(ts) => (1u8, ts.clone()),
        })
        .map(|c| c.id.clone())
}

// ── Decision context (the DB half of the decide lane) ──────────────────────

/// Connector ROLE that means "this charter's runs author code in a real
/// repository". Matched case-insensitively against
/// `spec.connectorBindings[].role`.
const REPOSITORY_ROLE: &str = "repository";
/// Connector TYPES that mean the same thing when the role is unnamed — the
/// charter binds a code host, so its run edits a checkout.
const CODE_CONNECTOR_TYPES: &[&str] = &["repository", "codebase", "git", "version_control"];

/// Gather everything the decision is allowed to know. DB-only and synchronous,
/// so it runs on the blocking pool inside `plan_tick` beside every other read.
///
/// `free_capacity` is deliberately left at 0 here and filled by the executor
/// immediately before the model call — a capacity measured at plan time and
/// spent seconds later is a guess, and the one number the plan must not guess
/// is how many runs it may start.
///
/// Every project read is best-effort: a project whose ideas/contexts/KPIs
/// cannot be read contributes a snapshot with the fields it did get, and the
/// prompt says "not measured" rather than printing a zero. A decision made on
/// partial state is still a decision; a decision made on a fabricated zero is
/// not.
fn build_decision_context(
    pool: &DbPool,
    persona: &Persona,
    charters: &[&PersonaResponsibility],
) -> Result<attention_decide::DecisionContext, AppError> {
    use attention_decide::{DecisionCharter, ProjectSnapshot, MAX_NAMED_IDEAS};

    // One ledger read for the whole roster; newest-first, so the FIRST row
    // naming a charter is its most recent.
    let history = attention_ledger::list_by_persona(pool, &persona.id, 200)?;
    let last_for = |rid: &str| -> (Option<String>, Option<String>) {
        history
            .iter()
            .find(|r| r.responsibility_id.as_deref() == Some(rid) && r.verdict != "refused")
            .map(|r| (Some(r.started_at.clone()), Some(r.verdict.clone())))
            .unwrap_or((None, None))
    };

    let decision_charters: Vec<DecisionCharter> = charters
        .iter()
        .map(|c| {
            let (last_started_at, last_verdict) = last_for(&c.id);
            DecisionCharter {
                id: c.id.clone(),
                title: c.title.clone(),
                priority: c.spec.priority,
                recipe_slug: c.spec.recipe_ref.as_ref().map(|r| r.slug.clone()),
                need: c.spec.description.as_ref().map(|d| d.need.clone()),
                core_action: c.spec.description.as_ref().map(|d| d.core_action.clone()),
                interval_minutes: c.cadence.interval_minutes,
                max_runs_per_day: c.cadence.max_runs_per_day,
                quiet_hours: c.cadence.quiet_hours.clone(),
                pacing: c.spec.pacing.clone(),
                last_started_at,
                last_verdict,
                writes_code: charter_writes_code(c),
                project_id: c.project_id.clone(),
            }
        })
        .collect();

    // Distinct project ids, in roster order.
    let mut project_ids: Vec<String> = Vec::new();
    for c in charters {
        if let Some(pid) = c.project_id.as_deref().filter(|p| !p.trim().is_empty()) {
            if !project_ids.iter().any(|p| p == pid) {
                project_ids.push(pid.to_string());
            }
        }
    }

    let projects = project_ids
        .into_iter()
        .map(|project_id| project_snapshot(pool, &project_id, MAX_NAMED_IDEAS))
        .collect::<Vec<ProjectSnapshot>>();

    Ok(attention_decide::DecisionContext {
        persona_id: persona.id.clone(),
        persona_name: persona.name.clone(),
        max_concurrent: persona.max_concurrent,
        free_capacity: 0,
        model: decision_model(persona, charters),
        charters: decision_charters,
        projects,
    })
}

/// The model the decision itself runs on — the SAME chain
/// `execute_persona_inner` walks for a dispatched run (`executions.rs`, the
/// `model_override` block): a charter's `spec.modelOverride` first (the App
/// Master carries `"opus"`), then the persona's own profile, then the
/// capability default.
///
/// The first charter that declares one wins. A persona whose charters disagree
/// about the model has a configuration problem the loop cannot resolve, and
/// picking the first in roster order is at least deterministic and visible.
fn decision_model(persona: &Persona, charters: &[&PersonaResponsibility]) -> String {
    charters
        .iter()
        .find_map(|c| c.spec.model_override.clone())
        .map(serde_json::Value::String)
        .and_then(|v| crate::engine::prompt::resolve_use_case_model_override(&v))
        .and_then(|p| p.model)
        .or_else(|| {
            crate::engine::prompt::parse_model_profile(persona.model_profile.as_deref())
                .and_then(|p| p.model)
        })
        .unwrap_or_else(|| crate::engine::prompt::DEFAULT_CAPABILITY_MODEL.to_string())
}

/// Does a run of this charter author code in a real repository? Two signals,
/// both read off the charter itself — a declared `repository` connector ROLE,
/// or a bound connector whose TYPE is a code host. A charter that says neither
/// is treated as not-code, which is the SAFE direction here: the consequence of
/// a false negative is a run in a scratch dir that finds no repo, and the
/// consequence of a false positive would be spending a worktree on a charter
/// that never needed one.
fn charter_writes_code(charter: &PersonaResponsibility) -> bool {
    let Some(bindings) = charter.spec.connector_bindings.as_ref() else {
        return false;
    };
    bindings.iter().any(|b| {
        b.role.trim().eq_ignore_ascii_case(REPOSITORY_ROLE)
            || CODE_CONNECTOR_TYPES
                .iter()
                .any(|t| b.connector_type.trim().eq_ignore_ascii_case(t))
    })
}

/// One project's state, each field independently best-effort. A read that
/// fails leaves its field at the "not measured" value and warns — it never
/// fails the wake.
fn project_snapshot(
    pool: &DbPool,
    project_id: &str,
    max_named_ideas: usize,
) -> attention_decide::ProjectSnapshot {
    use crate::db::repos::dev::{attention as dev_attention, contexts, ideas, kpis};

    let project_name = crate::db::repos::dev_tools::get_project_by_id(pool, project_id)
        .ok()
        .map(|p| p.name);

    let undispatched =
        dev_attention::list_undispatched_ideas(pool, Some(project_id), None).unwrap_or_else(|e| {
            tracing::warn!(project_id, error = %e, "persona_attention: undispatched-idea read failed");
            Vec::new()
        });

    // `triage_ideas` returns EXACT bucket counts beside a one-row page, so the
    // pending figure is a real count rather than the length of a capped list.
    let pending_idea_count = ideas::triage_ideas(
        pool,
        &ideas::TriageFilter {
            project_id: Some(project_id.to_string()),
            status: Some("pending".to_string()),
            origin: None,
            category: None,
        },
        Some(1),
        None,
    )
    .map(|page| page.counts.pending as usize)
    .unwrap_or_else(|e| {
        tracing::warn!(project_id, error = %e, "persona_attention: pending-idea count failed");
        0
    });

    let project_contexts = contexts::list_contexts_by_project(pool, project_id, None)
        .unwrap_or_else(|e| {
            tracing::warn!(project_id, error = %e, "persona_attention: context read failed");
            Vec::new()
        });
    let context_newest_at = project_contexts.iter().map(|c| c.updated_at.clone()).max();

    // KPI coverage gap: contexts carrying no ACTIVE KPI. Computed rather than
    // read, because no repo answers it — but only when BOTH reads succeeded,
    // so an unreadable KPI table reports "not measured" instead of claiming
    // every context is uncovered.
    let kpi_coverage_gap = match kpis::list_kpis(pool, project_id, Some("active")) {
        Ok(active) if !project_contexts.is_empty() => {
            let covered: std::collections::HashSet<&str> = active
                .iter()
                .filter_map(|k| k.context_id.as_deref())
                .collect();
            Some(
                project_contexts
                    .iter()
                    .filter(|c| !covered.contains(c.id.as_str()))
                    .count(),
            )
        }
        Ok(_) => None, // no contexts mapped — "0 uncovered" would be a lie
        Err(e) => {
            tracing::warn!(project_id, error = %e, "persona_attention: KPI read failed");
            None
        }
    };

    attention_decide::ProjectSnapshot {
        project_id: project_id.to_string(),
        project_name,
        undispatched_idea_count: undispatched.len(),
        undispatched_ideas: undispatched
            .into_iter()
            .take(max_named_ideas)
            .map(|i| (i.id, i.title))
            .collect(),
        pending_idea_count,
        context_count: project_contexts.len(),
        context_newest_at,
        kpi_coverage_gap,
    }
}

// ── Time math (pure) ───────────────────────────────────────────────────────

/// Whole minutes since an RFC-3339 instant; `None` when unparseable (the
/// caller treats that as "no floor" / "stale", loudly — the sleep_cycle
/// gauge precedent: a bad timestamp must not wedge the loop forever).
fn minutes_since_ts(ts: &str) -> Option<i64> {
    match chrono::DateTime::parse_from_rfc3339(ts) {
        Ok(t) => Some(
            chrono::Utc::now()
                .signed_duration_since(t)
                .num_minutes()
                .max(0),
        ),
        Err(_) => {
            tracing::warn!(timestamp = %ts, "persona_attention: unparseable ledger timestamp");
            None
        }
    }
}

/// The interval-floor decision over a measured gap. `None` minutes (never
/// completed / unparseable) = no floor.
fn interval_floor_refusal(
    minutes_since: Option<i64>,
    interval_minutes: i64,
) -> Option<AttentionRefusal> {
    match minutes_since {
        Some(m) if m < interval_minutes => Some(AttentionRefusal::IntervalFloor {
            minutes_since: m,
            interval_minutes,
        }),
        _ => None,
    }
}

/// Lenient `"HH:MM-HH:MM"` → (start, end) minutes-of-day. `None` = no window.
fn parse_quiet_hours(spec: &str) -> Option<(u32, u32)> {
    let (start, end) = spec.split_once('-')?;
    Some((parse_hhmm(start.trim())?, parse_hhmm(end.trim())?))
}

fn parse_hhmm(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    (h <= 23 && m <= 59).then_some(h * 60 + m)
}

/// Wrap-aware window membership: `22:00-07:00` covers the night across
/// midnight. Equal endpoints are an EMPTY window (a charter saying
/// "09:00-09:00" quiets nothing rather than everything — lenient).
fn in_quiet_window(now_minute: u32, start: u32, end: u32) -> bool {
    match start.cmp(&end) {
        CmpOrdering::Less => now_minute >= start && now_minute < end,
        CmpOrdering::Greater => now_minute >= start || now_minute < end,
        CmpOrdering::Equal => false,
    }
}

// ── Task briefs ────────────────────────────────────────────────────────────

/// The advance lane's bounded work brief: charter title, ONE outcome with its
/// success criteria, the objectives with their current figures, the scope
/// rung, and the guardrail preamble. ≤ [`MAX_TASK_CHARS`].
fn build_advance_task(charter: &PersonaResponsibility) -> String {
    let mut s = format!(
        "Attention pass — advance your standing charter \"{}\" (domain: {}).\n\n",
        charter.title, charter.domain
    );
    if let Some(outcome) = charter.outcomes.first() {
        s.push_str(&format!("Chosen outcome: {}\n", outcome.statement));
        if !outcome.success_criteria.is_empty() {
            s.push_str("Success criteria:\n");
            for c in &outcome.success_criteria {
                s.push_str(&format!("- {c}\n"));
            }
        }
    }
    if !charter.objectives.is_empty() {
        s.push_str("\nObjectives (current figures):\n");
        for o in &charter.objectives {
            let unit = o.unit.as_deref().unwrap_or("");
            let dir = o.direction.as_deref().unwrap_or("up");
            let baseline = o
                .baseline
                .map(|v| format!("{v}"))
                .unwrap_or_else(|| "?".into());
            let target = o
                .target
                .map(|v| format!("{v}"))
                .unwrap_or_else(|| "?".into());
            let measured = o
                .last_measured_at
                .as_deref()
                .map(|t| format!(", last measured {t}"))
                .unwrap_or_default();
            s.push_str(&format!(
                "- {}: {baseline} → {target}{unit} ({dir}{measured})\n",
                o.label
            ));
        }
    }
    s.push_str(&format!(
        "\nScope rung: {} — you may act autonomously only up to this rung.\n",
        charter.scope_rung
    ));
    if !charter.owner.is_empty() {
        s.push_str(&format!("Accountable owner: {}\n", charter.owner));
    }
    if !charter.refusal_classes.is_empty() {
        s.push_str(&format!(
            "Refuse outright: {}\n",
            charter.refusal_classes.join("; ")
        ));
    }
    s.push('\n');
    s.push_str(ATTENTION_GUARDRAILS);
    bound_task(s)
}

/// The improve lane's self-review brief (max one per day).
fn build_improve_task() -> String {
    let mut s = String::from(
        "Attention pass — self-review (at most one per day).\n\n\
         Review your Recent Episodes (rendered in your prompt) and what your \
         recent runs actually delivered: what worked, what failed, what you \
         were repeatedly slow or wrong about.\n\
         File ONE propose_backlog entry per improvement idea about your own \
         prompt, charters, cadence or tooling. Do NOT change anything in this \
         pass — review and propose only.\n\n\
         Additionally, if the review reveals a STANDING responsibility you \
         keep serving without a charter for it, you may propose ONE draft \
         charter by emitting this JSON on its own line in your final report \
         (nothing else on that line):\n\
         {\"op\":\"propose_responsibility_draft\",\"input\":{\"title\":\"...\",\
\"domain\":\"general\",\"procedure\":\"how you would carry it out\",\
\"connectors\":[],\"outcomes\":[{\"id\":\"o1\",\"statement\":\"...\",\
\"successCriteria\":[\"...\"]}],\"scopeRung\":1},\"motivation\":\"the \
recurring evidence, citing episode/run ids\"}\n\
         The input is a camelCase CreatePersonaResponsibilityInput; it is \
         filed as a DRAFT proposal your operator reviews — it grants nothing \
         until a human approves it, and at most one is accepted per day.\n\n",
    );
    s.push_str(ATTENTION_GUARDRAILS);
    bound_task(s)
}

fn bound_task(s: String) -> String {
    if s.chars().count() <= MAX_TASK_CHARS {
        return s;
    }
    // Byte budget ≥ char budget is safe for the boundary helper; recheck chars.
    let mut out = crate::utils::text::truncate_on_char_boundary(&s, MAX_TASK_CHARS).to_string();
    while out.chars().count() > MAX_TASK_CHARS {
        out.pop();
    }
    out
}

// ── Execute (thin, spawning) ───────────────────────────────────────────────

/// Fire the planned lane behind `spawn_guarded` and close the ledger row with
/// the dispatch outcome; a panic closes it `panicked`. The decision row is
/// already durable — this half only spawns and reports.
pub(crate) fn execute_dispatch(state: Arc<crate::AppState>, app: AppHandle, plan: PlannedDispatch) {
    let pool = state.db.clone();
    let entity_id = plan.persona_id.clone();
    let panic_pool = pool.clone();
    let panic_ledger = plan.ledger_id.clone();
    crate::background_job::spawn_guarded(
        "persona_attention",
        entity_id,
        async move {
            let PlannedDispatch {
                persona_id,
                persona_name,
                ledger_id,
                work,
            } = plan;
            // Set by the improve arm: the spawned execution whose output the
            // draft harvest reads back after the decision row closes.
            let mut improve_execution: Option<String> = None;
            let outcome: Result<serde_json::Value, AppError> = match work {
                DispatchWork::Arrivals {
                    message_id,
                    content,
                } => {
                    // The SAME channel follow-up path (and the SAME
                    // idempotency key) the live post path uses — re-dispatch
                    // is safe by dedupe, and a completed-but-unanswered run
                    // just gets its reply written by the fresh waiter.
                    crate::commands::communication::persona_channel::dispatch_channel_followup(
                        state.clone(),
                        app.clone(),
                        &persona_id,
                        &persona_name,
                        &message_id,
                        &content,
                    )
                    .map(|()| serde_json::json!({ "messageId": message_id }))
                }
                DispatchWork::Advance {
                    responsibility_id,
                    task,
                } => {
                    match spawn_attention_execution(
                        &state,
                        app.clone(),
                        &persona_id,
                        &ledger_id,
                        Some(&responsibility_id),
                        LANE_ADVANCE,
                        &task,
                        None,
                    )
                    .await
                    {
                        Ok(execution_id) => {
                            // Touch the served charter so staleness ordering
                            // stays honest (repo-documented contract).
                            if let Err(e) =
                                responsibilities::touch_updated_at(&state.db, &responsibility_id)
                            {
                                tracing::warn!(
                                    responsibility_id = %responsibility_id, error = %e,
                                    "persona_attention: post-advance touch failed"
                                );
                            }
                            Ok(serde_json::json!({
                                "executionId": execution_id,
                                "responsibilityId": responsibility_id,
                            }))
                        }
                        Err(e) => Err(e),
                    }
                }
                DispatchWork::Decide { context, fallback } => {
                    run_decision_lane(&state, app.clone(), &ledger_id, *context, fallback).await
                }
                DispatchWork::Improve { task } => {
                    match spawn_attention_execution(
                        &state,
                        app.clone(),
                        &persona_id,
                        &ledger_id,
                        None,
                        LANE_IMPROVE,
                        &task,
                        None,
                    )
                    .await
                    {
                        Ok(execution_id) => {
                            improve_execution = Some(execution_id.clone());
                            Ok(serde_json::json!({ "executionId": execution_id }))
                        }
                        Err(e) => Err(e),
                    }
                }
            };
            record_dispatch_outcome(&pool, &ledger_id, outcome);
            // WP3: the improve lane is the ONE lane whose run output the loop
            // reads back — a completed self-review may carry a
            // `propose_responsibility_draft` op line. The decision row above
            // is already closed (it records the DISPATCH, exactly as before);
            // this bounded follow-up only files a propose-only draft proposal
            // and dies silently with the process (best-effort by design).
            if let Some(execution_id) = improve_execution {
                harvest_improve_draft(&pool, &persona_id, &execution_id).await;
            }
        },
        move |panic_msg| async move {
            if let Err(e) = attention_ledger::complete(
                &panic_pool,
                &panic_ledger,
                "panicked",
                &panic_msg,
                None,
                None,
                None,
            ) {
                tracing::warn!(error = %e,
                    "persona_attention: failed to close panicked ledger row");
            }
        },
    );
}

/// One attention-dispatched execution: the standard envelope
/// (`source: "attention"` + `_attention` metadata + the bounded task), NO
/// trigger_id ever (a trigger_id advances that trigger's schedule), a
/// per-decision idempotency key. Returns at SPAWN time with the execution id.
/// `capability_id` fills `execute_persona_inner`'s `use_case_id` slot. The four
/// original lanes pass `None` (their historical behaviour, unchanged); the
/// decide lane passes the CHARTER id, which is what makes the charter's
/// `spec.modelOverride` take effect — the resolution block in
/// `executions.rs` only runs when that argument is `Some`, so the older lanes
/// have always dispatched on the persona's default model regardless of what
/// their charter declared. That is a real gap, left alone here rather than
/// silently changed under four lanes this task did not scope.
#[allow(clippy::too_many_arguments)]
async fn spawn_attention_execution(
    state: &Arc<crate::AppState>,
    app: AppHandle,
    persona_id: &str,
    ledger_id: &str,
    responsibility_id: Option<&str>,
    lane: &str,
    task: &str,
    capability_id: Option<&str>,
) -> Result<String, AppError> {
    let input_data = serde_json::json!({
        "source": "attention",
        "_attention": {
            "ledgerId": ledger_id,
            "responsibilityId": responsibility_id,
            "lane": lane,
        },
        "task": task,
    });
    let execution = crate::commands::execution::executions::execute_persona_inner(
        state,
        app,
        persona_id.to_string(),
        None, // trigger_id: ALWAYS None
        Some(input_data.to_string()),
        capability_id.map(str::to_string),
        None, // continuation
        Some(format!("attention:{persona_id}:{ledger_id}")),
        false, // is_simulation
    )
    .await?;
    Ok(execution.id)
}

// ── The decide lane's executor ─────────────────────────────────────────────

/// How long the decision call may take before the wake gives up and falls back.
const DECISION_TIMEOUT: Duration = Duration::from_secs(180);
/// Hard ceiling on how many charters ONE wake may dispatch, independent of the
/// persona's declared concurrency. A `max_concurrent` of 20 is a statement
/// about how many runs may COEXIST, not about how many a single autonomous
/// decision should start at once.
const MAX_DECIDE_DISPATCH: usize = 4;

/// The App Master's wake: measure capacity, ask the persona's own model which
/// of its charters moves the project, dispatch the answer, remember what it
/// decided.
///
/// Returns the stats blob for the decision's ledger row. Any model-side
/// failure degrades to the deterministic `advance` pick rather than to nothing
/// — an App Master that cannot reach its model still advances a charter.
async fn run_decision_lane(
    state: &Arc<crate::AppState>,
    app: AppHandle,
    ledger_id: &str,
    mut context: attention_decide::DecisionContext,
    fallback: Option<(String, String)>,
) -> Result<serde_json::Value, AppError> {
    let pool = state.db.clone();
    let persona_id = context.persona_id.clone();

    context.free_capacity = decide_free_capacity(state, &persona_id, context.max_concurrent).await;
    if context.free_capacity == 0 {
        // Not a failure and not a refusal: the persona is already running as
        // much as it may. Spending a model call to be told "dispatch nothing"
        // would be paying for a conclusion we already hold.
        tracing::info!(
            persona_id,
            "persona_attention: decide lane has no free slot this wake"
        );
        return Ok(serde_json::json!({ "lane": LANE_DECIDE, "freeCapacity": 0, "dispatched": 0 }));
    }

    let prompt = attention_decide::render_decision_prompt(&context);
    let reply = crate::companion::brain::oneshot::call_claude_text(
        &state.user_db,
        &prompt,
        &context.model,
        crate::companion::brain::oneshot::leg::APP_MASTER_DECISION,
        DECISION_TIMEOUT,
    )
    .await;

    let plan = match reply.map_err(|e| e.to_string()).and_then(|text| {
        attention_decide::parse_decision(&text, &context.charters, context.free_capacity)
            .map_err(|e| e.to_string())
    }) {
        Ok(plan) => plan,
        Err(why) => {
            tracing::warn!(persona_id, model = %context.model, reason = %why,
                "persona_attention: decision unusable — falling back to the \
                 least-recently-advanced charter");
            return decide_fallback(state, app, &persona_id, ledger_id, fallback, &why).await;
        }
    };

    if !plan.dropped_unknown.is_empty() {
        tracing::warn!(persona_id, dropped = ?plan.dropped_unknown,
            "persona_attention: decision named charters this persona does not hold");
    }

    // One named fleet run for everything this wake spawns, exactly as the
    // overnight dispatcher does. The active run is process-global, so this
    // technically closes an operator's open run — the same trade the overnight
    // path documents, and `claim_run_for_spawn` would have opened an unnamed
    // run for this burst regardless. The only thing added is the label.
    let run_label = format!("app-master:{persona_id}");
    crate::commands::fleet::run::begin_run(Some(run_label.clone()));

    let mut dispatched: Vec<serde_json::Value> = Vec::new();
    let mut failed: Vec<serde_json::Value> = Vec::new();
    for item in &plan.dispatch {
        let Some(charter) = context.charters.iter().find(|c| c.id == item.charter_id) else {
            continue; // unreachable: the parser only keeps known ids
        };
        // One ledger row PER dispatched charter, opened before its spawn —
        // the same discipline the single-dispatch lanes keep.
        let row = match attention_ledger::insert_started(
            &pool,
            &persona_id,
            Some(&charter.id),
            KIND_ATTENTION,
            Some(LANE_DECIDE),
        ) {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(persona_id, charter = %charter.id, error = %e,
                    "persona_attention: could not open the dispatch row — not spawning");
                continue;
            }
        };
        let outcome =
            dispatch_decided_charter(state, app.clone(), &context, charter, item, &row).await;
        match outcome {
            Ok(stats) => {
                record_dispatch_outcome(&pool, &row, Ok(stats.clone()));
                if let Err(e) = responsibilities::touch_updated_at(&pool, &charter.id) {
                    tracing::warn!(responsibility_id = %charter.id, error = %e,
                        "persona_attention: post-decide touch failed");
                }
                dispatched.push(stats);
            }
            Err(e) => {
                let reason = e.to_string();
                record_dispatch_outcome(&pool, &row, Err(e));
                failed.push(serde_json::json!({ "charterId": charter.id, "error": reason }));
            }
        }
    }
    crate::commands::fleet::run::end_run();

    // Coverage memory: every charter the decision CONSIDERED is stamped, not
    // just the dispatched ones — a charter deferred four wakes running is the
    // fact the next wake most needs, and the ledger cannot record it because a
    // deferral writes no ledger row.
    let dispatched_ids: Vec<&str> = plan
        .dispatch
        .iter()
        .map(|i| i.charter_id.as_str())
        .collect();
    write_back_pacing(&pool, &context, &dispatched_ids, plan.note.as_deref());

    Ok(serde_json::json!({
        "lane": LANE_DECIDE,
        "model": context.model,
        "freeCapacity": context.free_capacity,
        "dispatched": dispatched,
        "failed": failed,
        "deferred": plan.defer.iter()
            .map(|d| serde_json::json!({ "charterId": d.charter_id, "reason": d.reason }))
            .collect::<Vec<_>>(),
        "droppedUnknown": plan.dropped_unknown,
        "trimmedForCapacity": plan.trimmed_for_capacity,
        "note": plan.note,
        "runLabel": run_label,
    }))
}

/// Slots this persona may fill right now — the minimum of its own remaining
/// concurrency, the engine's global headroom, and [`MAX_DECIDE_DISPATCH`].
/// Reads the LIVE tracker (`AppState.engine`), the same one `start_execution`
/// admits against, so the decision cannot plan past what the queue will accept.
async fn decide_free_capacity(
    state: &Arc<crate::AppState>,
    persona_id: &str,
    max_concurrent: i32,
) -> usize {
    let tracker = state.engine.tracker().lock().await;
    if !tracker.has_global_capacity() {
        return 0;
    }
    let global_cap = tracker.global_max_concurrent();
    // `0` spells "no global limit" in the tracker's own convention.
    let global_headroom = if global_cap == 0 {
        MAX_DECIDE_DISPATCH
    } else {
        global_cap.saturating_sub(tracker.total_running())
    };
    // …and `<= 0` spells "no per-persona limit" in `personas.max_concurrent`.
    let own_headroom = if max_concurrent <= 0 {
        MAX_DECIDE_DISPATCH
    } else {
        (max_concurrent as usize).saturating_sub(tracker.running_count(persona_id))
    };
    own_headroom.min(global_headroom).min(MAX_DECIDE_DISPATCH)
}

/// The deterministic degrade path: the charter the `advance` lane would have
/// picked, dispatched exactly as `advance` would have dispatched it.
async fn decide_fallback(
    state: &Arc<crate::AppState>,
    app: AppHandle,
    persona_id: &str,
    ledger_id: &str,
    fallback: Option<(String, String)>,
    why: &str,
) -> Result<serde_json::Value, AppError> {
    let Some((responsibility_id, task)) = fallback else {
        // Nothing to advance either. Not an error — the decision row closes
        // saying so, which is more honest than a failure the operator would
        // read as a broken loop.
        return Ok(serde_json::json!({
            "lane": LANE_DECIDE,
            "fallback": "none",
            "reason": why,
        }));
    };
    let execution_id = spawn_attention_execution(
        state,
        app,
        persona_id,
        ledger_id,
        Some(&responsibility_id),
        LANE_ADVANCE,
        &task,
        None,
    )
    .await?;
    if let Err(e) = responsibilities::touch_updated_at(&state.db, &responsibility_id) {
        tracing::warn!(responsibility_id = %responsibility_id, error = %e,
            "persona_attention: post-fallback touch failed");
    }
    Ok(serde_json::json!({
        "lane": LANE_DECIDE,
        "fallback": LANE_ADVANCE,
        "reason": why,
        "executionId": execution_id,
        "responsibilityId": responsibility_id,
    }))
}

/// Dispatch ONE decided charter, choosing the worker's ground by whether the
/// charter authors code.
async fn dispatch_decided_charter(
    state: &Arc<crate::AppState>,
    app: AppHandle,
    context: &attention_decide::DecisionContext,
    charter: &attention_decide::DecisionCharter,
    item: &attention_decide::DecisionItem,
    ledger_id: &str,
) -> Result<serde_json::Value, AppError> {
    let task = decided_task_text(charter, item);
    if charter.writes_code {
        return dispatch_into_worktree(state, app, context, charter, &task).await;
    }
    let execution_id = spawn_attention_execution(
        state,
        app,
        &context.persona_id,
        ledger_id,
        Some(&charter.id),
        LANE_DECIDE,
        &task,
        // The CHARTER id, so `execute_persona_inner` resolves the charter and
        // applies its `spec.modelOverride` — the reason the decide lane passes
        // this where the older lanes pass None.
        Some(&charter.id),
    )
    .await?;
    Ok(serde_json::json!({
        "charterId": charter.id,
        "executionId": execution_id,
        "worker": "execution",
        "reason": item.reason,
    }))
}

/// The dispatched brief: the charter's standing contract plus THIS wake's
/// argument for it. The decision's reason and brief are additive — they say
/// which slice to take, never what the charter is allowed to do, which stays
/// the charter's own guardrails.
fn decided_task_text(
    charter: &attention_decide::DecisionCharter,
    item: &attention_decide::DecisionItem,
) -> String {
    let mut s = format!(
        "Attention pass — advance your standing charter \"{}\", chosen by your own \
         wake decision.\n\n",
        charter.title
    );
    if !item.reason.trim().is_empty() {
        s.push_str(&format!("Why this charter, this wake: {}\n", item.reason));
    }
    if !item.brief.trim().is_empty() {
        s.push_str(&format!("What to do: {}\n", item.brief));
    }
    if let Some(need) = charter.need.as_deref().filter(|n| !n.trim().is_empty()) {
        s.push_str(&format!("\nWhy this charter exists: {need}\n"));
    }
    if let Some(action) = charter
        .core_action
        .as_deref()
        .filter(|a| !a.trim().is_empty())
    {
        s.push_str(&format!("Its core action: {action}\n"));
    }
    s.push('\n');
    s.push_str(ATTENTION_GUARDRAILS);
    bound_task(s)
}

/// A code-authoring charter never runs in the operator's checkout.
///
/// `execute_persona_inner` takes no working directory: the runner picks
/// `exec_dir` itself (`engine/runner/mod.rs`) — either a per-persona temp
/// scratch dir, or a per-execution worktree gated by the GLOBAL
/// `execution_worktree_isolation` setting, which is an operator switch this
/// loop is forbidden to touch ("NEVER touch your own gates"). So a charter
/// that authors code goes down the same road the overnight dispatcher paved:
/// a fresh `autopilot/<slug>` worktree off the project's main branch, and a
/// headless fleet session whose cwd IS that worktree.
///
/// A worktree that cannot be prepared is a REFUSAL, never a fallback into
/// `root_path` — falling back to the shared checkout is precisely the
/// behaviour `personas_engine::unattended_worktree` exists to remove.
async fn dispatch_into_worktree(
    state: &Arc<crate::AppState>,
    app: AppHandle,
    context: &attention_decide::DecisionContext,
    charter: &attention_decide::DecisionCharter,
    task: &str,
) -> Result<serde_json::Value, AppError> {
    let project_id = charter.project_id.clone().ok_or_else(|| {
        AppError::Validation(format!(
            "charter {} authors code but is bound to no project — nothing to isolate",
            charter.id
        ))
    })?;
    let project = crate::db::repos::dev_tools::get_project_by_id(&state.db, &project_id)?;
    // The shared vocabulary, not a hand-written sentence: this keeps the
    // {field, rule} identity a refusal carries (command-input-validation).
    personas_core::validation::require_non_empty(
        &format!("project {project_id} root_path"),
        &project.root_path,
    )?;
    let worktrees_root = crate::commands::infrastructure::dev_tools::authoring_worktrees_root(&app)
        .map_err(AppError::Internal)?;
    let worktree = personas_engine::unattended_worktree::prepare_authoring_worktree(
        std::path::Path::new(&project.root_path),
        &worktrees_root,
        &project_id,
        &charter.title,
        project.main_branch.as_deref(),
    )
    .await
    .map_err(|e| AppError::Internal(format!("no isolated authoring worktree: {e}")))?;

    let worktree_path = worktree.path.to_string_lossy().to_string();
    let text = personas_engine::unattended::unattended_worktree_task_text(
        task,
        &worktree.branch,
        &worktree_path,
    );
    let session_id = crate::commands::fleet::commands::fleet_spawn_headless_session(
        app,
        worktree_path.clone(),
        text,
        None,
    )
    .await
    .map_err(|e| AppError::ProcessSpawn(format!("fleet session for {}: {e}", charter.id)))?;

    tracing::info!(
        persona_id = %context.persona_id,
        charter = %charter.id,
        branch = %worktree.branch,
        worktree = %worktree_path,
        "persona_attention: code charter dispatched into an isolated authoring worktree"
    );
    Ok(serde_json::json!({
        "charterId": charter.id,
        "worker": "fleet",
        "sessionId": session_id,
        "branch": worktree.branch,
        "worktreePath": worktree_path,
    }))
}

/// Stamp the coverage memory on every charter the decision considered.
///
/// Best-effort per charter: one unwritable spec must not lose the rest. An
/// absent plan note KEEPS the previous one rather than erasing it — a model
/// that returned no note said nothing about coverage, which is not the same as
/// saying there is nothing to remember.
fn write_back_pacing(
    pool: &DbPool,
    context: &attention_decide::DecisionContext,
    dispatched_ids: &[&str],
    note: Option<&str>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    for charter in &context.charters {
        let mut pacing = charter.pacing.clone().unwrap_or_default();
        pacing.last_decided_at = Some(now.clone());
        if dispatched_ids.contains(&charter.id.as_str()) {
            pacing.last_dispatched_at = Some(now.clone());
        }
        if let Some(note) = note {
            pacing.coverage_note = Some(note.to_string());
        }
        match responsibilities::merge_spec_pacing(pool, &charter.id, &pacing) {
            Ok(true) => {}
            Ok(false) => tracing::warn!(responsibility_id = %charter.id,
                "persona_attention: pacing write-back matched no charter row"),
            Err(e) => tracing::warn!(responsibility_id = %charter.id, error = %e,
                "persona_attention: pacing write-back failed"),
        }
    }
}

// ── Improve-lane draft harvest (WP3) ───────────────────────────────────────

/// How long the harvest waits for the improve run to reach a terminal state
/// — the same bound the channel reply-waiter uses.
const IMPROVE_HARVEST_DEADLINE_SECS: u64 = 30 * 60;
const IMPROVE_HARVEST_POLL_SECS: u64 = 5;

/// Where the improve run stands, as far as the harvest cares.
enum ImproveRunState {
    Running,
    /// Terminal with a (possibly absent) output to scan.
    Completed(Option<String>),
    /// Failed / cancelled / vanished — nothing to harvest.
    Ended,
}

fn improve_run_state(pool: &DbPool, execution_id: &str) -> Result<ImproveRunState, AppError> {
    use rusqlite::OptionalExtension;
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT status, output_data FROM persona_executions WHERE id = ?1",
            rusqlite::params![execution_id],
            |r| {
                Ok((
                    r.get::<_, String>("status")?,
                    r.get::<_, Option<String>>("output_data")?,
                ))
            },
        )
        .optional()?;
    Ok(match row {
        None => ImproveRunState::Ended,
        Some((status, output)) => match status.as_str() {
            "completed" => ImproveRunState::Completed(output),
            "failed" | "cancelled" => ImproveRunState::Ended,
            _ => ImproveRunState::Running,
        },
    })
}

/// Bounded wait for the improve execution's terminal state, then scan its
/// output for a `propose_responsibility_draft` op. The chosen seam: the loop
/// does not observe run outcomes anywhere today (`execute_persona_inner`
/// returns at SPAWN time and the decision row closes at dispatch), so the
/// harvest lives in the SAME guarded task after the row closes — the channel
/// reply-waiter's shape, and the only propose-only seam that reads the real
/// ledger'd output without holding the decision row open for the run's
/// whole duration.
async fn harvest_improve_draft(pool: &DbPool, persona_id: &str, execution_id: &str) {
    let deadline = tokio::time::Instant::now()
        + tokio::time::Duration::from_secs(IMPROVE_HARVEST_DEADLINE_SECS);
    let output = loop {
        match improve_run_state(pool, execution_id) {
            Ok(ImproveRunState::Completed(output)) => break output,
            Ok(ImproveRunState::Ended) => return,
            Ok(ImproveRunState::Running) => {
                if tokio::time::Instant::now() >= deadline {
                    tracing::info!(
                        persona_id,
                        execution_id,
                        "persona_attention: improve run outlived the harvest window; \
                         any draft op in its output goes unharvested"
                    );
                    return;
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(IMPROVE_HARVEST_POLL_SECS))
                    .await;
            }
            Err(e) => {
                tracing::warn!(persona_id, execution_id, error = %e,
                    "persona_attention: improve harvest probe failed");
                return;
            }
        }
    };
    let Some(output) = output else { return };
    absorb_improve_output(pool, persona_id, &output);
}

/// The sync half of the harvest (the testable seam): extract the op, run it
/// through the growth door (validate → dedupe → file as a
/// `responsibility_draft` proposal), and ledger the drop when the draft was
/// invalid — a terminal `refused` note, which `count_today` excludes, so
/// neither the daily cap nor the improve once-per-day gate tighten.
pub(crate) fn absorb_improve_output(pool: &DbPool, persona_id: &str, output: &str) {
    use crate::engine::persona_brain::growth;
    let op = match growth::extract_responsibility_draft_op(output) {
        Ok(Some(op)) => op,
        // Nothing proposed — the ordinary outcome of an improve pass.
        Ok(None) => return,
        // The pass DID try and the envelope was unreadable. Same terminal
        // `refused` note an invalid draft gets, under its own kind, so a
        // grammar the model cannot follow shows up in the ledger instead of
        // reading as a run that proposed nothing.
        Err(reason) => {
            ledger_draft_refusal(pool, persona_id, "responsibility_draft_unparsed", &reason);
            return;
        }
    };
    match growth::file_responsibility_draft(pool, persona_id, &op) {
        Ok(growth::DraftFiling::Filed { proposal_id }) => tracing::info!(
            persona_id,
            proposal_id = %proposal_id,
            "persona_attention: improve pass proposed a draft charter"
        ),
        Ok(growth::DraftFiling::DedupedToday) => tracing::info!(
            persona_id,
            "persona_attention: draft charter op deduped — one per persona per day"
        ),
        Ok(growth::DraftFiling::Invalid { reason }) => {
            ledger_draft_refusal(pool, persona_id, "responsibility_draft_rejected", &reason);
        }
        Err(e) => tracing::warn!(persona_id, error = %e,
            "persona_attention: draft charter filing failed"),
    }
}

/// One terminal `refused` note for a draft that never became a proposal.
/// `count_today` excludes refusals, so neither the daily cap nor the improve
/// once-per-day gate tighten because the model got the grammar wrong.
fn ledger_draft_refusal(pool: &DbPool, persona_id: &str, kind: &str, reason: &str) {
    let note = serde_json::json!({ "kind": kind, "error": reason });
    if let Err(e) = attention_ledger::insert_refusal(
        pool,
        persona_id,
        None,
        KIND_ATTENTION,
        Some(LANE_IMPROVE),
        &note.to_string(),
    ) {
        tracing::warn!(persona_id, kind, error = %e,
            "persona_attention: failed to ledger the dropped draft");
    }
}

/// Close a dispatch's ledger row with `dispatched`/`failed` — the spawn-stub
/// seam the DB tests drive directly.
pub(crate) fn record_dispatch_outcome(
    pool: &DbPool,
    ledger_id: &str,
    outcome: Result<serde_json::Value, AppError>,
) {
    record_dispatch_outcome_with(pool, ledger_id, "dispatched", outcome);
}

fn record_dispatch_outcome_with(
    pool: &DbPool,
    ledger_id: &str,
    ok_verdict: &str,
    outcome: Result<serde_json::Value, AppError>,
) {
    let result = match outcome {
        Ok(stats) => attention_ledger::complete(
            pool,
            ledger_id,
            ok_verdict,
            "",
            None,
            Some(&stats.to_string()),
            None,
        ),
        Err(e) => {
            attention_ledger::complete(pool, ledger_id, "failed", &e.to_string(), None, None, None)
        }
    };
    if let Err(e) = result {
        tracing::warn!(ledger_id, error = %e,
            "persona_attention: failed to close dispatch ledger row");
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod attention_tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{
        ResponsibilityCadence, ResponsibilityObjective, ResponsibilityOutcome,
    };
    use crate::db::repos::core::responsibilities::CreateResponsibilityInput;
    use crate::db::settings_keys;
    use rusqlite::params;

    // -- pure: quiet hours ---------------------------------------------------

    #[test]
    fn quiet_hours_parse_is_lenient_and_bounded() {
        assert_eq!(parse_quiet_hours("22:00-07:00"), Some((22 * 60, 7 * 60)));
        assert_eq!(
            parse_quiet_hours(" 9:15 - 17:45 "),
            Some((9 * 60 + 15, 17 * 60 + 45))
        );
        assert_eq!(parse_quiet_hours("22:00"), None, "no dash");
        assert_eq!(parse_quiet_hours("25:00-07:00"), None, "hour out of range");
        assert_eq!(
            parse_quiet_hours("22:61-07:00"),
            None,
            "minute out of range"
        );
        assert_eq!(parse_quiet_hours("evening-morning"), None, "prose");
        assert_eq!(parse_quiet_hours(""), None);
    }

    #[test]
    fn quiet_window_wraps_midnight_and_equal_is_empty() {
        let (s, e) = parse_quiet_hours("22:00-07:00").unwrap();
        assert!(in_quiet_window(23 * 60, s, e), "late evening");
        assert!(in_quiet_window(3 * 60, s, e), "small hours");
        assert!(!in_quiet_window(12 * 60, s, e), "midday");
        assert!(!in_quiet_window(7 * 60, s, e), "end is exclusive");
        assert!(in_quiet_window(22 * 60, s, e), "start is inclusive");
        // Non-wrapping window.
        let (s, e) = parse_quiet_hours("09:00-17:00").unwrap();
        assert!(in_quiet_window(12 * 60, s, e));
        assert!(!in_quiet_window(8 * 60, s, e));
        // Equal endpoints quiet NOTHING (lenient), not everything.
        assert!(!in_quiet_window(9 * 60, 9 * 60, 9 * 60));
    }

    // -- pure: interval floor ------------------------------------------------

    #[test]
    fn interval_floor_math() {
        // Inside the floor → typed refusal with both figures.
        assert_eq!(
            interval_floor_refusal(Some(10), 30),
            Some(AttentionRefusal::IntervalFloor {
                minutes_since: 10,
                interval_minutes: 30
            })
        );
        // On/after the boundary → clear.
        assert_eq!(interval_floor_refusal(Some(30), 30), None);
        assert_eq!(interval_floor_refusal(Some(31), 30), None);
        // Never completed / unparseable → no floor.
        assert_eq!(interval_floor_refusal(None, 30), None);
    }

    #[test]
    fn minutes_since_parses_rfc3339_and_rejects_garbage() {
        let recent = (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339();
        let m = minutes_since_ts(&recent).unwrap();
        assert!((4..=6).contains(&m), "{m}");
        assert_eq!(minutes_since_ts("not a timestamp"), None);
        // A future timestamp clamps to 0 rather than going negative.
        let future = (chrono::Utc::now() + chrono::Duration::minutes(10)).to_rfc3339();
        assert_eq!(minutes_since_ts(&future), Some(0));
    }

    // -- pure: lane chooser --------------------------------------------------

    #[test]
    fn lane_priority_is_arrivals_maintenance_improve_advance() {
        let arrival = Some(("m1".to_string(), "hello".to_string()));
        // Everything pending → arrivals wins.
        assert_eq!(
            choose_lane(arrival.clone(), true, Some("r1".into()), true, false),
            Some(LaneWork::Arrivals {
                message_id: "m1".into(),
                content: "hello".into()
            })
        );
        // No arrivals → maintenance.
        assert_eq!(
            choose_lane(None, true, Some("r1".into()), true, false),
            Some(LaneWork::Maintenance)
        );
        // No maintenance → the daily self-review PREEMPTS advance…
        assert_eq!(
            choose_lane(None, false, Some("r1".into()), true, false),
            Some(LaneWork::Improve)
        );
        // …and once consumed for the day, advance wins the remaining passes.
        assert_eq!(
            choose_lane(None, false, Some("r1".into()), false, false),
            Some(LaneWork::Advance {
                responsibility_id: "r1".into()
            })
        );
        // Improve fires even with nothing to advance; empty plate → None.
        assert_eq!(
            choose_lane(None, false, None, true, false),
            Some(LaneWork::Improve)
        );
        assert_eq!(choose_lane(None, false, None, false, false), None);
    }

    /// The App Master swap is exactly ONE rung: `decide` stands where
    /// `advance` stood and nothing above it moves.
    #[test]
    fn app_master_swaps_only_the_advance_rung() {
        let arrival = Some(("m1".to_string(), "hello".to_string()));
        // Arrivals and maintenance still outrank the decision — answering a
        // human is not a "which responsibility" question.
        assert_eq!(
            choose_lane(arrival, true, Some("r1".into()), true, true),
            Some(LaneWork::Arrivals {
                message_id: "m1".into(),
                content: "hello".into()
            })
        );
        assert_eq!(
            choose_lane(None, true, Some("r1".into()), true, true),
            Some(LaneWork::Maintenance)
        );
        // So does the once-a-day self-review.
        assert_eq!(
            choose_lane(None, false, Some("r1".into()), true, true),
            Some(LaneWork::Improve)
        );
        // Where advance WOULD have run, the decision runs instead…
        assert_eq!(
            choose_lane(None, false, Some("r1".into()), false, true),
            Some(LaneWork::Decide)
        );
        // …and it runs even when advance has no candidate at all: the advance
        // lane only considers charters with an outcome or an objective, the
        // decision considers everything the persona holds.
        assert_eq!(
            choose_lane(None, false, None, false, true),
            Some(LaneWork::Decide)
        );
    }

    /// The App Master test is "holds a project-bound charter", and a blank
    /// `project_id` is not a project.
    #[test]
    fn app_master_is_decided_by_a_project_bound_charter() {
        let plain = charter_fixture("r1");
        let mut bound = charter_fixture("r2");
        bound.project_id = Some("proj_1".into());
        let mut blank = charter_fixture("r3");
        blank.project_id = Some("   ".into());

        assert!(!is_app_master(&[&plain]));
        assert!(!is_app_master(&[]));
        assert!(
            !is_app_master(&[&plain, &blank]),
            "a blank id is not a project"
        );
        assert!(is_app_master(&[&bound]));
        assert!(is_app_master(&[&plain, &bound]), "one is enough");
    }

    // -- pure: advance rotation ---------------------------------------------

    fn charter_fixture(id: &str) -> PersonaResponsibility {
        PersonaResponsibility {
            id: id.into(),
            outcomes: vec![ResponsibilityOutcome {
                id: "o".into(),
                statement: "s".into(),
                success_criteria: vec![],
            }],
            ..Default::default()
        }
    }

    #[test]
    fn rotation_prefers_never_advanced_then_oldest() {
        let a = charter_fixture("resp-a");
        let b = charter_fixture("resp-b");
        let c = charter_fixture("resp-c");
        let candidates = vec![&a, &b, &c];
        let mut history = HashMap::new();
        history.insert("resp-a".to_string(), "2026-01-02T00:00:00Z".to_string());
        history.insert("resp-c".to_string(), "2026-01-01T00:00:00Z".to_string());
        // b never advanced → wins over both timestamps.
        assert_eq!(
            select_least_recently_advanced(&candidates, &history),
            Some("resp-b".into())
        );
        // All advanced → oldest timestamp (c) wins.
        history.insert("resp-b".to_string(), "2026-01-03T00:00:00Z".to_string());
        assert_eq!(
            select_least_recently_advanced(&candidates, &history),
            Some("resp-c".into())
        );
        // Ties keep roster order (stable min).
        let empty = HashMap::new();
        assert_eq!(
            select_least_recently_advanced(&candidates, &empty),
            Some("resp-a".into())
        );
    }

    // -- pure: task briefs ---------------------------------------------------

    #[test]
    fn advance_task_names_the_contract_and_stays_bounded() {
        let mut charter = charter_fixture("resp-a");
        charter.title = "Keep the docs honest".into();
        charter.scope_rung = 1;
        charter.outcomes[0].statement = "Docs match shipped behavior".into();
        charter.outcomes[0].success_criteria = vec!["zero stale pages".into()];
        charter.objectives = vec![ResponsibilityObjective {
            key: "stale".into(),
            label: "Stale pages".into(),
            baseline: Some(12.0),
            target: Some(0.0),
            unit: Some(" pages".into()),
            direction: Some("down".into()),
            ..Default::default()
        }];
        let task = build_advance_task(&charter);
        assert!(task.contains("Keep the docs honest"));
        assert!(task.contains("Docs match shipped behavior"));
        assert!(task.contains("zero stale pages"));
        assert!(task.contains("Stale pages"));
        assert!(task.contains("Scope rung: 1"));
        assert!(task.contains("propose_backlog"), "guardrails ride along");
        assert!(task.contains("emit_memory"));
        assert!(task.chars().count() <= MAX_TASK_CHARS);

        // A pathologically fat charter is truncated, not shipped whole.
        charter.outcomes[0].success_criteria = vec!["x".repeat(500); 20];
        let fat = build_advance_task(&charter);
        assert!(fat.chars().count() <= MAX_TASK_CHARS);

        let improve = build_improve_task();
        assert!(improve.contains("propose_backlog"));
        assert!(improve.contains("Do NOT change anything"));
        // WP3: the draft-charter grammar rides in the improve brief, named
        // by the same op const the parser matches on.
        assert!(
            improve.contains(crate::engine::persona_brain::growth::OP_PROPOSE_RESPONSIBILITY_DRAFT)
        );
        assert!(improve.contains("CreatePersonaResponsibilityInput"));
        assert!(improve.contains("DRAFT proposal"));
        assert!(improve.chars().count() <= MAX_TASK_CHARS);
    }

    // -- DB: the tick paths --------------------------------------------------

    fn seed_persona(pool: &DbPool, id: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
             VALUES (?1, ?1, 'sp', 1, datetime('now'), datetime('now'))",
            params![id],
        )?;
        Ok(())
    }

    fn seed_charter(
        pool: &DbPool,
        persona_id: &str,
        title: &str,
        outcomes: &[ResponsibilityOutcome],
    ) -> String {
        let cadence = ResponsibilityCadence {
            attention_enabled: true,
            ..Default::default()
        };
        responsibilities::create(
            pool,
            CreateResponsibilityInput {
                persona_id,
                title,
                domain: "general",
                outcomes,
                objectives: &[],
                scope_rung: 1,
                refusal_classes: &[],
                approval_gates: &[],
                owner: "",
                cadence: &cadence,
                budget_monthly_usd: None,
                tenure: &Default::default(),
                status: "active",
                project_id: None,
                source: "operator",
                connectors: &[],
                procedure: "",
                spec: &Default::default(),
            },
        )
        .unwrap()
        .id
    }

    fn one_outcome() -> Vec<ResponsibilityOutcome> {
        vec![ResponsibilityOutcome {
            id: "o1".into(),
            statement: "The thing holds".into(),
            success_criteria: vec!["it holds".into()],
        }]
    }

    fn enable_loop(pool: &DbPool) {
        crate::db::repos::core::settings::set(
            pool,
            settings_keys::AUTONOMOUS_ATTENTION_LOOP,
            "true",
        )
        .unwrap();
    }

    fn ledger_rows(
        pool: &DbPool,
        persona_id: &str,
    ) -> Vec<crate::db::models::AttentionLedgerEntry> {
        attention_ledger::list_by_persona(pool, persona_id, 50).unwrap()
    }

    /// Backdate a ledger row's completion so the interval floor is clear
    /// while its `started_at` stays today (count_today still sees it).
    fn backdate_completed(pool: &DbPool, ledger_id: &str, minutes: i64) -> Result<(), AppError> {
        pool.get()?.execute(
            "UPDATE persona_attention_ledger SET completed_at = ?1 WHERE id = ?2",
            params![
                (chrono::Utc::now() - chrono::Duration::minutes(minutes)).to_rfc3339(),
                ledger_id
            ],
        )?;
        Ok(())
    }

    /// Spend today's improve slot (a completed improve-lane pass, floor
    /// already clear) so a test can reach the advance lane directly.
    fn consume_improve_for_today(pool: &DbPool, persona_id: &str) {
        let id = attention_ledger::insert_started(
            pool,
            persona_id,
            None,
            KIND_ATTENTION,
            Some(LANE_IMPROVE),
        )
        .unwrap();
        attention_ledger::complete(pool, &id, "dispatched", "", None, None, None).unwrap();
        backdate_completed(pool, &id, 60).unwrap();
    }

    #[test]
    fn off_means_zero_rows_and_zero_reads() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1")?;
        seed_charter(&pool, "p1", "Charter", &one_outcome());
        // The key is absent → the gate answers None before any roster read.
        assert!(plan_tick_gated(&pool).is_none());
        assert!(ledger_rows(&pool, "p1").is_empty(), "zero ledger rows");
        assert_eq!(
            pool.get()?
                .query_row("SELECT COUNT(*) FROM persona_background_job", [], |r| r
                    .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn empty_roster_is_free_even_when_enabled() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.personas, 0);
        assert!(dispatch.is_none());
    }

    #[test]
    fn admitted_advance_path_ledgers_started_then_dispatched() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1").unwrap();
        let resp = seed_charter(&pool, "p1", "Charter A", &one_outcome());
        // Improve preempts advance for the day's first slot — spend it so
        // this test exercises the advance path directly.
        consume_improve_for_today(&pool, "p1");

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.personas, 1);
        assert_eq!(counts.dispatched, Some(LANE_ADVANCE));
        let plan = dispatch.expect("advance dispatch planned");
        assert_eq!(plan.persona_id, "p1");
        match &plan.work {
            DispatchWork::Advance {
                responsibility_id,
                task,
            } => {
                assert_eq!(responsibility_id, &resp);
                assert!(task.contains("Charter A"));
            }
            _ => panic!("expected advance work"),
        }

        // The DECISION row is open before any spawn.
        let rows = ledger_rows(&pool, "p1");
        assert_eq!(rows.len(), 2, "seeded improve row + open advance row");
        let started = rows.iter().find(|r| r.id == plan.ledger_id).expect("row");
        assert_eq!(started.verdict, "started");
        assert_eq!(started.lane.as_deref(), Some(LANE_ADVANCE));
        assert_eq!(started.responsibility_id.as_deref(), Some(resp.as_str()));

        // Stub the spawn seam: close the row the way the executor would.
        record_dispatch_outcome(
            &pool,
            &plan.ledger_id,
            Ok(serde_json::json!({ "executionId": "exec-1" })),
        );
        let rows = ledger_rows(&pool, "p1");
        let closed = rows.iter().find(|r| r.id == plan.ledger_id).expect("row");
        assert_eq!(closed.verdict, "dispatched");
        assert!(closed.stats_json.as_deref().unwrap().contains("exec-1"));
        assert!(closed.completed_at.is_some());

        // A second tick is refused by the interval floor (30m default), and
        // — since real work still pends — writes exactly ONE refusal row…
        let (counts2, dispatch2) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch2.is_none());
        assert_eq!(counts2.refused, 1);
        assert_eq!(counts2.refusal_rows, 1);
        let rows = ledger_rows(&pool, "p1");
        assert_eq!(rows.len(), 3);
        let refusal = rows.iter().find(|r| r.verdict == "refused").expect("row");
        let reason: serde_json::Value = serde_json::from_str(&refusal.reason).unwrap();
        assert_eq!(reason["kind"], "interval_floor");
        // …and a third tick dedupes the identical refusal (no third row).
        let (counts3, _) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts3.refused, 1);
        assert_eq!(counts3.refusal_rows, 0);
        assert_eq!(ledger_rows(&pool, "p1").len(), 3);
    }

    #[test]
    fn improve_preempts_advance_exactly_once_per_day() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1").unwrap();
        let resp = seed_charter(&pool, "p1", "Charter A", &one_outcome());

        // Tick 1: advance HAS a candidate, but the day's first slot goes to
        // the self-review.
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.dispatched, Some(LANE_IMPROVE));
        let plan = dispatch.expect("improve dispatch planned");
        match &plan.work {
            DispatchWork::Improve { task } => {
                assert!(task.contains("Do NOT change anything"));
            }
            _ => panic!("expected improve work"),
        }
        let rows = ledger_rows(&pool, "p1");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].lane.as_deref(), Some(LANE_IMPROVE));
        assert!(rows[0].responsibility_id.is_none());
        record_dispatch_outcome(&pool, &plan.ledger_id, Ok(serde_json::json!({})));
        backdate_completed(&pool, &plan.ledger_id, 60).unwrap(); // clear the floor, keep today

        // Tick 2: improve is spent for the day → advance takes over.
        let (counts2, dispatch2) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts2.dispatched, Some(LANE_ADVANCE));
        let plan2 = dispatch2.expect("advance dispatch planned");
        match &plan2.work {
            DispatchWork::Advance {
                responsibility_id, ..
            } => assert_eq!(responsibility_id, &resp),
            _ => panic!("expected advance work"),
        }
        record_dispatch_outcome(&pool, &plan2.ledger_id, Ok(serde_json::json!({})));
        backdate_completed(&pool, &plan2.ledger_id, 60).unwrap();

        // Tick 3: still the same day → advance again, never a second review.
        let (counts3, dispatch3) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts3.dispatched, Some(LANE_ADVANCE));
        let plan3 = dispatch3.expect("advance again");
        assert!(matches!(plan3.work, DispatchWork::Advance { .. }));
        assert_eq!(
            attention_ledger::count_today(&pool, "p1", KIND_ATTENTION, Some(LANE_IMPROVE)).unwrap(),
            1,
            "exactly one improve pass today"
        );
    }

    #[test]
    fn open_row_refuses_in_flight_and_failed_outcome_closes_it() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1").unwrap();
        seed_charter(&pool, "p1", "Charter", &one_outcome());

        let (_, dispatch) = plan_tick_gated(&pool).expect("enabled");
        let plan = dispatch.expect("advance planned");
        // While the row is open, a new tick refuses with in_flight.
        let (counts, dispatch2) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch2.is_none());
        assert_eq!(counts.refused, 1);
        let rows = ledger_rows(&pool, "p1");
        let refusal = rows.iter().find(|r| r.verdict == "refused").unwrap();
        let reason: serde_json::Value = serde_json::from_str(&refusal.reason).unwrap();
        assert_eq!(reason["kind"], "in_flight");

        // A failed spawn closes the decision row as 'failed'.
        record_dispatch_outcome(
            &pool,
            &plan.ledger_id,
            Err(AppError::Validation("budget".into())),
        );
        let rows = ledger_rows(&pool, "p1");
        let closed = rows.iter().find(|r| r.id == plan.ledger_id).unwrap();
        assert_eq!(closed.verdict, "failed");
        assert!(closed.reason.contains("budget"));
    }

    #[test]
    fn stale_open_row_is_ignored_not_wedging() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        seed_charter(&pool, "p1", "Charter", &one_outcome());
        // A crashed pass from an hour ago: open, but past the window.
        let stale =
            attention_ledger::insert_started(&pool, "p1", None, KIND_ATTENTION, Some(LANE_ADVANCE))
                .unwrap();
        pool.get()?.execute(
            "UPDATE persona_attention_ledger SET started_at = ?1 WHERE id = ?2",
            params![
                (chrono::Utc::now() - chrono::Duration::minutes(90)).to_rfc3339(),
                stale
            ],
        )?;
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.stale_open, 1);
        assert!(dispatch.is_some(), "stale open row must not wedge the loop");
        Ok(())
    }

    #[test]
    fn maintenance_lane_enqueues_exactly_one_job_and_is_idempotent() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        seed_charter(&pool, "p1", "Charter", &one_outcome());
        // Episodes over pressure (20k chars), fresh — maintenance outranks
        // advance in the lane order.
        let now = chrono::Utc::now();
        for i in 0..5 {
            pool.get()?.execute(
                "INSERT INTO persona_episodes
                    (id, persona_id, role, source, body_excerpt, content_hash, chars, created_at)
                 VALUES (?1, 'p1', 'run', 'execution', 'body', ?1, 5000, ?2)",
                params![
                    format!("ep_{i}"),
                    (now - chrono::Duration::minutes(30 - i)).to_rfc3339()
                ],
            )?;
        }

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.dispatched, Some(LANE_MAINTENANCE));
        assert!(
            dispatch.is_none(),
            "maintenance is fully executed in the plan"
        );

        // Exactly one queued sleep_consolidation_run job with the camelCase
        // params contract.
        let (job_count, params_json): (i64, String) = pool.get()?.query_row(
            "SELECT COUNT(*), MAX(params_json) FROM persona_background_job
                 WHERE kind = 'sleep_consolidation_run' AND persona_id = 'p1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        assert_eq!(job_count, 1);
        let p: serde_json::Value = serde_json::from_str(&params_json).unwrap();
        assert_eq!(p["personaId"], "p1");
        assert_eq!(p["force"], false);

        // The attention ledger row records the DECISION as 'enqueued'.
        let rows = ledger_rows(&pool, "p1");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].verdict, "enqueued");
        assert_eq!(rows[0].lane.as_deref(), Some(LANE_MAINTENANCE));
        assert!(rows[0].stats_json.as_deref().unwrap().contains("jobId"));

        // Second tick: refused by the interval floor (the enqueued row
        // completed just now) — no second job.
        let (counts2, dispatch2) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch2.is_none());
        assert!(counts2.refused == 1, "floor refusal, not a second enqueue");
        let job_count2: i64 = pool.get()?.query_row(
            "SELECT COUNT(*) FROM persona_background_job
                 WHERE kind = 'sleep_consolidation_run'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(job_count2, 1, "idempotent across ticks");
        Ok(())
    }

    /// WP3 — the improve-output harvest seam, driven directly (the async
    /// waiter is a thin bounded poll around this).
    #[test]
    fn improve_output_files_valid_drafts_and_ledgers_invalid_ones() -> Result<(), AppError> {
        use crate::db::repos::core::memory_review_proposal as proposal_repo;
        use crate::engine::persona_brain::growth;

        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1")?;

        // No op in the output: nothing filed, nothing ledgered.
        absorb_improve_output(&pool, "p1", "reviewed my runs; filed two backlog ideas");
        assert!(ledger_rows(&pool, "p1").is_empty());
        assert_eq!(proposal_repo::list(&pool, Some("p1"), false, 10)?.len(), 0);

        // A valid draft op: filed as ONE pending responsibility_draft
        // proposal; no charter row minted (propose-only).
        let valid = format!(
            "self-review report\n{}\ndone",
            serde_json::json!({
                "op": growth::OP_PROPOSE_RESPONSIBILITY_DRAFT,
                "input": {
                    "title": "Own the weekly digest",
                    "procedure": "Collect the week's runs, post a digest.",
                },
                "motivation": "did it by hand three weeks running",
            })
        );
        absorb_improve_output(&pool, "p1", &valid);
        let proposals = proposal_repo::list(&pool, Some("p1"), true, 10)?;
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].kind, growth::KIND_RESPONSIBILITY_DRAFT);
        let summary = proposals[0].summary.as_deref().unwrap();
        assert!(
            summary.starts_with("Draft charter: Own the weekly digest"),
            "{summary}"
        );
        assert!(summary.contains("three weeks running"), "{summary}");
        assert!(
            responsibilities::list_by_persona(&pool, "p1", true)?.is_empty(),
            "propose-only: no charter until a human applies"
        );

        // An INVALID draft (rung past the ceiling) on a fresh persona: not
        // filed, dropped with a terminal ledger note that tightens no cap.
        seed_persona(&pool, "p2")?;
        let invalid = serde_json::json!({
            "op": growth::OP_PROPOSE_RESPONSIBILITY_DRAFT,
            "input": { "title": "Too mighty", "scopeRung": 4 },
            "motivation": "m",
        })
        .to_string();
        absorb_improve_output(&pool, "p2", &invalid);
        assert_eq!(proposal_repo::list(&pool, Some("p2"), false, 10)?.len(), 0);
        let rows = ledger_rows(&pool, "p2");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].verdict, "refused");
        assert_eq!(rows[0].lane.as_deref(), Some(LANE_IMPROVE));
        let reason: serde_json::Value = serde_json::from_str(&rows[0].reason).unwrap();
        assert_eq!(reason["kind"], "responsibility_draft_rejected");
        assert_eq!(
            attention_ledger::count_today(&pool, "p2", KIND_ATTENTION, Some(LANE_IMPROVE))?,
            0,
            "the drop note is a refusal — the improve once-per-day gate stays open"
        );
        Ok(())
    }

    // -- P2/P4: the wake request and the decision lane ----------------------

    /// Seed a charter bound to a project (the App Master shape).
    fn seed_project_charter(
        pool: &DbPool,
        persona_id: &str,
        title: &str,
        project_id: &str,
    ) -> String {
        let cadence = ResponsibilityCadence {
            attention_enabled: true,
            ..Default::default()
        };
        responsibilities::create(
            pool,
            CreateResponsibilityInput {
                persona_id,
                title,
                domain: "software_engineering",
                outcomes: &one_outcome(),
                objectives: &[],
                scope_rung: 1,
                refusal_classes: &[],
                approval_gates: &[],
                owner: "",
                cadence: &cadence,
                budget_monthly_usd: None,
                tenure: &Default::default(),
                status: "active",
                project_id: Some(project_id),
                source: "operator",
                connectors: &[],
                procedure: "",
                spec: &Default::default(),
            },
        )
        .unwrap()
        .id
    }

    /// A persona switched ON gets ONE pass that skips the interval floor —
    /// and only one, and only that rung.
    #[test]
    fn wake_request_spends_the_interval_floor_exactly_once() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        seed_charter(&pool, "p1", "Charter A", &one_outcome());
        consume_improve_for_today(&pool, "p1");

        // A completed pass just now: the floor refuses everything.
        let (_, dispatch) = plan_tick_gated(&pool).expect("enabled");
        let plan = dispatch.expect("first pass");
        record_dispatch_outcome(&pool, &plan.ledger_id, Ok(serde_json::json!({})));
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch.is_none(), "floor refuses");
        assert_eq!(counts.refused, 1);

        // Switching the persona on records a wake…
        request_wake(&pool, "p1");
        assert_eq!(read_wake_requests(&pool), vec!["p1".to_string()]);

        // …which buys exactly one pass through the floor…
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.refused, 0, "the wake spent the floor");
        let plan = dispatch.expect("the wake bought a pass");
        record_dispatch_outcome(&pool, &plan.ledger_id, Ok(serde_json::json!({})));
        assert!(
            read_wake_requests(&pool).is_empty(),
            "the request is consumed, not standing"
        );

        // …and the very next tick is refused by the floor again.
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch.is_none());
        assert_eq!(counts.refused, 1, "one bypass, not a standing exemption");
        Ok(())
    }

    /// Cycle 1 (2026-09-07) measured three freshly switched-on App Masters
    /// spending their first wakes on the daily self-review and a memory pass,
    /// with the decision the better part of an hour away. A wake now means
    /// "decide": a woken App Master takes the decide lane ahead of improve, and
    /// the request is consumed at admission even when no interval floor stood
    /// in its way (a fresh persona has no completed pass to measure a floor
    /// from, so the old floor-only consumption left its request standing).
    #[test]
    fn a_woken_app_master_decides_before_its_daily_self_review() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "am")?;
        seed_project_charter(&pool, "am", "Own the codebase", "proj_1");
        // Improve is deliberately NOT consumed: without the wake it would win.
        request_wake(&pool, "am");

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.woke, 1, "the wake was consumed at admission");
        assert_eq!(counts.dispatched, Some(LANE_DECIDE), "a wake means decide");
        let plan = dispatch.expect("decide dispatch planned");
        assert!(matches!(plan.work, DispatchWork::Decide { .. }));
        assert!(
            read_wake_requests(&pool).is_empty(),
            "consumed even though no floor refused"
        );
        record_dispatch_outcome(&pool, &plan.ledger_id, Ok(serde_json::json!({})));

        // Without a wake the plain precedence stands again: the next admitted
        // pass (after the floor, simulated by clearing history) is improve's.
        let (counts, _) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.woke, 0, "no standing exemption");
        Ok(())
    }

    /// The bypass is scoped to the interval floor. Every other rung — here the
    /// daily cap — still refuses a woken persona, because switching a persona
    /// on is permission to START, not permission to exceed its declared limits.
    #[test]
    fn wake_request_does_not_bypass_the_daily_cap() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        let charter_id = seed_charter(&pool, "p1", "Charter A", &one_outcome());
        responsibilities::update(
            &pool,
            &charter_id,
            crate::db::repos::core::responsibilities::UpdateResponsibilityInput {
                cadence: Some(ResponsibilityCadence {
                    attention_enabled: true,
                    max_runs_per_day: Some(0), // a declared 0 = never
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();

        request_wake(&pool, "p1");
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch.is_none(), "the cap still refuses a woken persona");
        assert_eq!(counts.refused, 1);
        let rows = ledger_rows(&pool, "p1");
        let refusal = rows.iter().find(|r| r.verdict == "refused").expect("row");
        let reason: serde_json::Value = serde_json::from_str(&refusal.reason).unwrap();
        assert_eq!(reason["kind"], "daily_cap_reached");
        Ok(())
    }

    /// A corrupt or absent wake row reads as "none owed" and never wedges the
    /// loop — the same leniency the rest of the ladder keeps.
    #[test]
    fn wake_requests_degrade_to_none_when_the_row_is_unreadable() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        assert!(read_wake_requests(&pool).is_empty(), "absent = none owed");

        // Well-formed JSON of the wrong SHAPE gets past the settings-layer
        // validator (which only checks well-formedness) and must still read as
        // "none owed" rather than panicking the tick.
        crate::db::repos::core::settings::set(
            &pool,
            settings_keys::ATTENTION_WAKE_REQUESTS,
            "{\"not\":\"an array\"}",
        )
        .unwrap();
        assert!(
            read_wake_requests(&pool).is_empty(),
            "wrong shape = none owed"
        );

        // Genuinely corrupt text can only arrive around the repo (a hand-edited
        // database, a partial write) — the validator refuses it at the front
        // door, which is itself worth pinning.
        assert!(
            matches!(
                crate::db::repos::core::settings::set(
                    &pool,
                    settings_keys::ATTENTION_WAKE_REQUESTS,
                    "{not json at all",
                ),
                Err(AppError::Validation(_))
            ),
            "the settings validator refuses a malformed wake row at write time"
        );
        pool.get()?.execute(
            "UPDATE app_settings SET value = '{not json at all' WHERE key = ?1",
            params![settings_keys::ATTENTION_WAKE_REQUESTS],
        )?;
        assert!(read_wake_requests(&pool).is_empty(), "corrupt = none owed");
        seed_persona(&pool, "p1")?;
        assert!(!consume_wake_request(&pool, "p1"), "nothing to consume");
        Ok(())
    }

    /// A persona with NO project-bound charter never reaches the decision
    /// lane: it keeps the exact advance behaviour it had before this change.
    #[test]
    fn a_persona_without_a_project_charter_still_takes_the_advance_lane() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        let resp = seed_charter(&pool, "p1", "Charter A", &one_outcome());
        consume_improve_for_today(&pool, "p1");

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.dispatched, Some(LANE_ADVANCE), "not the decide lane");
        let plan = dispatch.expect("advance dispatch");
        assert!(matches!(
            &plan.work,
            DispatchWork::Advance { responsibility_id, .. } if responsibility_id == &resp
        ));
        let rows = ledger_rows(&pool, "p1");
        let started = rows.iter().find(|r| r.id == plan.ledger_id).expect("row");
        assert_eq!(started.lane.as_deref(), Some(LANE_ADVANCE));
        Ok(())
    }

    /// A project-bound charter routes the same persona into the decision lane,
    /// with the context gathered and the deterministic fallback precomputed.
    #[test]
    fn a_project_bound_charter_routes_into_the_decide_lane() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        let resp = seed_project_charter(&pool, "p1", "Own the codebase", "proj_1");
        consume_improve_for_today(&pool, "p1");

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.dispatched, Some(LANE_DECIDE));
        let plan = dispatch.expect("decide dispatch planned");
        let DispatchWork::Decide { context, fallback } = &plan.work else {
            panic!("expected the decide lane");
        };
        assert_eq!(context.persona_id, "p1");
        assert_eq!(context.charters.len(), 1);
        assert_eq!(context.charters[0].id, resp);
        assert_eq!(context.charters[0].title, "Own the codebase");
        assert_eq!(
            context.free_capacity, 0,
            "capacity is measured by the executor, never guessed at plan time"
        );
        // The project state read ran even though the project has no rows yet.
        assert_eq!(context.projects.len(), 1);
        assert_eq!(context.projects[0].project_id, "proj_1");
        assert_eq!(context.projects[0].undispatched_idea_count, 0);
        // No context rows mapped → the KPI gap is NOT MEASURED, not zero.
        assert_eq!(context.projects[0].kpi_coverage_gap, None);
        // The deterministic degrade path is precomputed.
        let (fb_id, fb_task) = fallback.as_ref().expect("fallback charter");
        assert_eq!(fb_id, &resp);
        assert!(fb_task.contains("Own the codebase"));

        // The decision's own ledger row names no charter — it is about the
        // whole roster; the per-charter rows are opened by the executor.
        let rows = ledger_rows(&pool, "p1");
        let started = rows.iter().find(|r| r.id == plan.ledger_id).expect("row");
        assert_eq!(started.verdict, "started");
        assert_eq!(started.lane.as_deref(), Some(LANE_DECIDE));
        assert!(started.responsibility_id.is_none());
        Ok(())
    }

    /// The decision runs on the charter's declared model, resolved through the
    /// same chain a dispatched run walks.
    #[test]
    fn decision_model_follows_the_charter_then_persona_then_default() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1")?;
        let persona = persona_repo::get_by_id(&pool, "p1")?;

        // No override anywhere → the capability default.
        let plain = charter_fixture("r1");
        assert_eq!(
            decision_model(&persona, &[&plain]),
            crate::engine::prompt::DEFAULT_CAPABILITY_MODEL
        );

        // A charter tier slug wins and is resolved to a concrete model id.
        let mut opus = charter_fixture("r2");
        opus.spec.model_override = Some("opus".into());
        let resolved = decision_model(&persona, &[&plain, &opus]);
        assert!(resolved.starts_with("claude-opus-"), "{resolved}");
        assert_ne!(resolved, "opus", "the slug is resolved, not passed through");
        Ok(())
    }

    /// A charter that authors code is detected from its connector bindings —
    /// by ROLE or by connector TYPE — and everything else is not.
    #[test]
    fn code_authoring_charters_are_detected_from_their_bindings() {
        use crate::db::models::CharterConnectorBinding;
        let binding = |role: &str, ty: &str| CharterConnectorBinding {
            role: role.into(),
            connector_type: ty.into(),
            connector: None,
        };

        let mut none = charter_fixture("r1");
        assert!(!charter_writes_code(&none), "no bindings at all");
        none.spec.connector_bindings = Some(vec![binding("notifier", "slack")]);
        assert!(
            !charter_writes_code(&none),
            "a chat connector writes no code"
        );

        let mut by_role = charter_fixture("r2");
        by_role.spec.connector_bindings = Some(vec![binding("Repository", "github")]);
        assert!(
            charter_writes_code(&by_role),
            "role match is case-insensitive"
        );

        let mut by_type = charter_fixture("r3");
        by_type.spec.connector_bindings = Some(vec![binding("source", "codebase")]);
        assert!(charter_writes_code(&by_type), "type match");
    }

    #[test]
    fn arrivals_outrank_advance_and_daily_cap_refuses() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1")?;
        let charter_id = seed_charter(&pool, "p1", "Charter", &one_outcome());
        // An unanswered user message, 2h old.
        let (msg_id, _) = team_channel::create_persona_channel_message(
            &pool,
            team_channel::CreatePersonaChannelMessageInput {
                id: None,
                persona_id: "p1".into(),
                author_kind: "user".into(),
                author_id: None,
                author_label: None,
                body: "anyone home?".into(),
                reply_to: None,
                failed: false,
            },
        )
        .unwrap();
        pool.get()?.execute(
            "UPDATE team_channel_messages
                 SET created_at = datetime('now', '-2 hours') WHERE id = ?1",
            params![msg_id],
        )?;

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.dispatched, Some(LANE_ARRIVALS));
        let plan = dispatch.expect("arrivals dispatch");
        match &plan.work {
            DispatchWork::Arrivals {
                message_id,
                content,
            } => {
                assert_eq!(message_id, &msg_id);
                assert_eq!(content, "anyone home?");
            }
            _ => panic!("expected arrivals work"),
        }
        record_dispatch_outcome(&pool, &plan.ledger_id, Ok(serde_json::json!({})));

        // Cap the day at 1 via the charter: the next tick refuses with
        // daily_cap_reached (the completed arrivals pass counts).
        responsibilities::update(
            &pool,
            &charter_id,
            crate::db::repos::core::responsibilities::UpdateResponsibilityInput {
                cadence: Some(ResponsibilityCadence {
                    attention_enabled: true,
                    interval_minutes: Some(0), // floor out of the way (clamped to 1m — backdate below)
                    quiet_hours: None,
                    max_runs_per_day: Some(1),
                }),
                ..Default::default()
            },
        )
        .unwrap();
        // Push the completed pass past even a 1-minute floor.
        pool.get()?.execute(
            "UPDATE persona_attention_ledger
                 SET completed_at = ?1 WHERE completed_at IS NOT NULL",
            params![(chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339()],
        )?;

        let (counts2, dispatch2) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch2.is_none());
        assert_eq!(counts2.refused, 1);
        let rows = ledger_rows(&pool, "p1");
        let refusal = rows.iter().find(|r| r.verdict == "refused").expect("row");
        let reason: serde_json::Value = serde_json::from_str(&refusal.reason).unwrap();
        assert_eq!(reason["kind"], "daily_cap_reached");
        assert_eq!(reason["cap"], 1);
        Ok(())
    }
}
