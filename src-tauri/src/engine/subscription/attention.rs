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
use crate::db::repos::core::{attention_ledger, personas as persona_repo, responsibilities};
use crate::db::repos::execution::executions as executions_repo;
use crate::db::repos::resources::team_channel;
use crate::db::DbPool;
use crate::error::AppError;

const KIND_ATTENTION: &str = "attention";
pub(crate) const LANE_ARRIVALS: &str = "arrivals";
pub(crate) const LANE_MAINTENANCE: &str = "maintenance";
pub(crate) const LANE_ADVANCE: &str = "advance";
pub(crate) const LANE_IMPROVE: &str = "improve";

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

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(120)
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
        if let Some(plan) = dispatch {
            execute_dispatch(self.state.clone(), self.app.clone(), plan);
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
        let persona = match admission {
            Admission::Refused(reason) => {
                counts.refused += 1;
                record_refusal_if_work_pends(pool, pid, persona_charters, &reason, &mut counts);
                continue;
            }
            Admission::Admitted(p) => p,
        };

        // 5. Lane choice — arrivals > maintenance > improve > advance.
        let Some(work) = find_work(pool, pid, persona_charters)? else {
            counts.idle += 1; // plain nothing-to-do: no rows
            continue;
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
    Admitted(Box<Persona>),
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
    let interval = charters
        .iter()
        .filter_map(|c| c.cadence.interval_minutes)
        .max()
        .unwrap_or(DEFAULT_INTERVAL_MINUTES)
        .max(1);
    if let Some(last) = attention_ledger::last_completed(pool, persona_id, KIND_ATTENTION)? {
        let minutes = last.completed_at.as_deref().and_then(minutes_since_ts);
        if let Some(refusal) = interval_floor_refusal(minutes, interval) {
            return Ok(Admission::Refused(refusal));
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
    let persona = persona_repo::get_by_id(pool, persona_id)?;
    if let Some(budget) = persona.max_budget_usd {
        if budget > 0.0 {
            let spent = executions_repo::get_monthly_spend(pool, persona_id)?;
            if spent >= budget {
                return Ok(Admission::Refused(AttentionRefusal::BudgetExhausted {
                    spent_usd: spent,
                    limit_usd: budget,
                }));
            }
        }
    }

    Ok(Admission::Admitted(Box::new(persona)))
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
    Arrivals { message_id: String, content: String },
    Maintenance,
    Advance { responsibility_id: String },
    Improve,
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
    Ok(choose_lane(arrival, maintenance, advance, improve))
}

/// The lane priority — arrivals > maintenance > improve > advance — as one
/// pure decision over pre-measured inputs. Improve sits ABOVE advance so the
/// daily self-review takes the day's first otherwise-eligible slot exactly
/// once (`improve_available` is false for the rest of the day), after which
/// advancement wins every remaining pass; below advance it would be
/// unreachable, since a charter with outcomes always gives advance a
/// candidate.
fn choose_lane(
    arrival: Option<(String, String)>,
    maintenance_admitted: bool,
    advance_responsibility: Option<String>,
    improve_available: bool,
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
         pass — review and propose only.\n\n",
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
                DispatchWork::Improve { task } => spawn_attention_execution(
                    &state,
                    app.clone(),
                    &persona_id,
                    &ledger_id,
                    None,
                    LANE_IMPROVE,
                    &task,
                )
                .await
                .map(|execution_id| serde_json::json!({ "executionId": execution_id })),
            };
            record_dispatch_outcome(&pool, &ledger_id, outcome);
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
async fn spawn_attention_execution(
    state: &Arc<crate::AppState>,
    app: AppHandle,
    persona_id: &str,
    ledger_id: &str,
    responsibility_id: Option<&str>,
    lane: &str,
    task: &str,
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
        None, // use_case_id
        None, // continuation
        Some(format!("attention:{persona_id}:{ledger_id}")),
        false, // is_simulation
    )
    .await?;
    Ok(execution.id)
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
            choose_lane(arrival.clone(), true, Some("r1".into()), true),
            Some(LaneWork::Arrivals {
                message_id: "m1".into(),
                content: "hello".into()
            })
        );
        // No arrivals → maintenance.
        assert_eq!(
            choose_lane(None, true, Some("r1".into()), true),
            Some(LaneWork::Maintenance)
        );
        // No maintenance → the daily self-review PREEMPTS advance…
        assert_eq!(
            choose_lane(None, false, Some("r1".into()), true),
            Some(LaneWork::Improve)
        );
        // …and once consumed for the day, advance wins the remaining passes.
        assert_eq!(
            choose_lane(None, false, Some("r1".into()), false),
            Some(LaneWork::Advance {
                responsibility_id: "r1".into()
            })
        );
        // Improve fires even with nothing to advance; empty plate → None.
        assert_eq!(
            choose_lane(None, false, None, true),
            Some(LaneWork::Improve)
        );
        assert_eq!(choose_lane(None, false, None, false), None);
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
        assert!(improve.chars().count() <= MAX_TASK_CHARS);
    }

    // -- DB: the tick paths --------------------------------------------------

    fn seed_persona(pool: &DbPool, id: &str) {
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                 VALUES (?1, ?1, 'sp', 1, datetime('now'), datetime('now'))",
                params![id],
            )
            .unwrap();
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
    fn backdate_completed(pool: &DbPool, ledger_id: &str, minutes: i64) {
        pool.get()
            .unwrap()
            .execute(
                "UPDATE persona_attention_ledger SET completed_at = ?1 WHERE id = ?2",
                params![
                    (chrono::Utc::now() - chrono::Duration::minutes(minutes)).to_rfc3339(),
                    ledger_id
                ],
            )
            .unwrap();
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
        backdate_completed(pool, &id, 60);
    }

    #[test]
    fn off_means_zero_rows_and_zero_reads() {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");
        seed_charter(&pool, "p1", "Charter", &one_outcome());
        // The key is absent → the gate answers None before any roster read.
        assert!(plan_tick_gated(&pool).is_none());
        assert!(ledger_rows(&pool, "p1").is_empty(), "zero ledger rows");
        assert_eq!(
            pool.get()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM persona_background_job", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
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
        seed_persona(&pool, "p1");
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
        seed_persona(&pool, "p1");
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
        backdate_completed(&pool, &plan.ledger_id, 60); // clear the floor, keep today

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
        backdate_completed(&pool, &plan2.ledger_id, 60);

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
        seed_persona(&pool, "p1");
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
    fn stale_open_row_is_ignored_not_wedging() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1");
        seed_charter(&pool, "p1", "Charter", &one_outcome());
        // A crashed pass from an hour ago: open, but past the window.
        let stale =
            attention_ledger::insert_started(&pool, "p1", None, KIND_ATTENTION, Some(LANE_ADVANCE))
                .unwrap();
        pool.get()
            .unwrap()
            .execute(
                "UPDATE persona_attention_ledger SET started_at = ?1 WHERE id = ?2",
                params![
                    (chrono::Utc::now() - chrono::Duration::minutes(90)).to_rfc3339(),
                    stale
                ],
            )
            .unwrap();
        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.stale_open, 1);
        assert!(dispatch.is_some(), "stale open row must not wedge the loop");
    }

    #[test]
    fn maintenance_lane_enqueues_exactly_one_job_and_is_idempotent() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1");
        seed_charter(&pool, "p1", "Charter", &one_outcome());
        // Episodes over pressure (20k chars), fresh — maintenance outranks
        // advance in the lane order.
        let now = chrono::Utc::now();
        for i in 0..5 {
            pool.get()
                .unwrap()
                .execute(
                    "INSERT INTO persona_episodes
                        (id, persona_id, role, source, body_excerpt, content_hash, chars, created_at)
                     VALUES (?1, 'p1', 'run', 'execution', 'body', ?1, 5000, ?2)",
                    params![
                        format!("ep_{i}"),
                        (now - chrono::Duration::minutes(30 - i)).to_rfc3339()
                    ],
                )
                .unwrap();
        }

        let (counts, dispatch) = plan_tick_gated(&pool).expect("enabled");
        assert_eq!(counts.dispatched, Some(LANE_MAINTENANCE));
        assert!(
            dispatch.is_none(),
            "maintenance is fully executed in the plan"
        );

        // Exactly one queued sleep_consolidation_run job with the camelCase
        // params contract.
        let (job_count, params_json): (i64, String) = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*), MAX(params_json) FROM persona_background_job
                 WHERE kind = 'sleep_consolidation_run' AND persona_id = 'p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
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
        let job_count2: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM persona_background_job
                 WHERE kind = 'sleep_consolidation_run'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(job_count2, 1, "idempotent across ticks");
    }

    #[test]
    fn arrivals_outrank_advance_and_daily_cap_refuses() {
        let pool = init_test_db().unwrap();
        enable_loop(&pool);
        seed_persona(&pool, "p1");
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
        pool.get()
            .unwrap()
            .execute(
                "UPDATE team_channel_messages
                 SET created_at = datetime('now', '-2 hours') WHERE id = ?1",
                params![msg_id],
            )
            .unwrap();

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
        pool.get()
            .unwrap()
            .execute(
                "UPDATE persona_attention_ledger
                 SET completed_at = ?1 WHERE completed_at IS NOT NULL",
                params![(chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339()],
            )
            .unwrap();

        let (counts2, dispatch2) = plan_tick_gated(&pool).expect("enabled");
        assert!(dispatch2.is_none());
        assert_eq!(counts2.refused, 1);
        let rows = ledger_rows(&pool, "p1");
        let refusal = rows.iter().find(|r| r.verdict == "refused").expect("row");
        let reason: serde_json::Value = serde_json::from_str(&refusal.reason).unwrap();
        assert_eq!(reason["kind"], "daily_cap_reached");
        assert_eq!(reason["cap"], 1);
    }
}
