//! Curator's loop - the thing that was missing.
//!
//! Everything the spine built (`fbb4dd247`) could be READ and nothing ticked:
//! `claim_next_queued` was written, tested, and called by nothing. This module
//! is the caller.
//!
//! ## It is a `ReactiveSubscription`, not a `tokio::spawn` + `loop`
//!
//! Athena's proactive scheduler is the second shape
//! (`commands/companion/mod.rs`), and this repo's own Rust conventions name
//! that family as the debt: **41 `ReactiveSubscription` impls against 22
//! perpetual loops, none of them stoppable**. The trait gives this loop the
//! three properties a bare `sleep` cannot: a shutdown the runner owns, a panic
//! boundary with backoff, and an idle cadence. It also gives the one property
//! her human lane needs - a [`wake_signal`](ReactiveSubscription::wake_signal),
//! fired when the operator files a request, so the lane they can actually see
//! does not wait out a poll interval.
//!
//! ## Lane order, and it is the operator's rule
//!
//! > "Curator similar to Athena can orchestrate Claude CLIs, her setup will
//! > allow to set max concurrent terminals (default 2) and tries to loop
//! > infinitely until all goals done or switch turned off by user."
//!
//! Every free worker slot takes **the oldest queued `curator_request` first**.
//! Only when that lane is empty does she take her own highest-scoring plan
//! item. The named consequence - a steady trickle of operator requests starves
//! her own corpus work - was put to the operator and accepted, so it is
//! implemented literally and there is no fairness rule here that he did not
//! ask for.
//!
//! ## She never idles, and that is what makes the brakes load-bearing
//!
//! With both lanes empty she does not stop: she goes to her **standing lane**,
//! which is two rungs and not one - `/harvest auto` to drain the registry's
//! source queue, and `/harvest research` to refill it when there is nothing
//! left to drain. Which rung is a measurement taken from the queue file itself;
//! the derivation, and the eight consecutive no-op refills that paid for it,
//! are in [`super::standing`]. So **nothing in this loop reaches a natural
//! resting point while the queue can be moved at all**, and
//! `curator_daily_budget_usd`, `curator_daily_run_cap`,
//! `curator_daily_commit_cap`, `curator_quiet_hours` and
//! `curator_backpressure_n` are the only things that stop her. They are checked
//! fresh every tick, together with the master switch, so flipping any of them
//! takes effect within one interval rather than at the next app start.
//!
//! The worker cap is checked HERE, before `queue::admit`, because it is HERS:
//! the fleet's own `fleet.max_parallel_sessions` governs the whole machine and
//! she must not spend it on her own behalf. A full pool is not a halt - it is
//! what she looks like while working.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::AppHandle;

use personas_core::events::curator_pulse;
use personas_core::models::{
    curator_lane, CuratorEngine, CuratorImpediment, CuratorPlanItem, CuratorPlanItemState,
    CuratorPolicy, CuratorRequest, CuratorRequestState, CuratorSkill, CURATOR_SPEND_SOURCE,
};

use crate::commands::fleet::bands;
use crate::commands::fleet::queue::{self, DispatchOrigin, DispatchRequest};
use crate::commands::fleet::registry::is_live_state;
use crate::commands::fleet::types::{FleetSessionMode, FleetSessionState};
use crate::db::repos::curator as repo;
use crate::db::{settings_keys, DbPool};
use crate::engine::subscription::ReactiveSubscription;
use crate::error::AppError;

use super::dispatch::{self, Brief};
use super::standing::{self, Marks, Rung, Standing};
use super::{instrument, pulse, sleep};

/// Poll cadence while the app is in use.
///
/// One minute, against Athena's five. Her workers run for many minutes, so the
/// tick is not what paces the work - the worker cap is. What a shorter interval
/// buys is the gap between a worker finishing and the next one starting, which
/// is dead time in a loop whose whole instruction is to keep going.
const TICK: Duration = Duration::from_secs(60);
/// Poll cadence when the app is idle. Still a real cadence rather than a stop:
/// she is meant to work unattended, and the operator being away from the
/// keyboard is not a reason to pause a corpus sweep.
const IDLE_TICK: Duration = Duration::from_secs(180);
/// The first tick waits out startup. Longer than most subscriptions' because
/// this one can spawn a `claude` process, and launch is the worst moment.
const FIRST_TICK: Duration = Duration::from_secs(120);

/// How many commits one settle will attribute to a worker.
///
/// A bound on a pathological range, not a policy: if `<head>..HEAD` somehow
/// spans hundreds of commits the worker did not make (a merge of a long branch
/// landed underneath it), writing all of them into her audit ledger would be
/// worse than writing none, and the log line says so.
const MAX_COMMITS_PER_SETTLE: usize = 100;

/// Record separator for the one `git log` this module runs. `\x1e` cannot occur
/// in a sha, a subject line or a path.
const GIT_RECORD_SEP: char = '\u{1e}';

// ---------------------------------------------------------------------------
// The subscription
// ---------------------------------------------------------------------------

/// Curator's loop. Registered in `engine::background::lifecycle` beside the
/// other engine subscriptions.
pub struct CuratorLoopSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

#[async_trait::async_trait]
impl ReactiveSubscription for CuratorLoopSubscription {
    fn name(&self) -> &'static str {
        "curator_loop"
    }

    fn interval(&self) -> Duration {
        TICK
    }

    fn idle_interval(&self) -> Duration {
        IDLE_TICK
    }

    fn initial_delay(&self) -> Duration {
        FIRST_TICK
    }

    fn wake_signal(&self) -> Option<&'static tokio::sync::Notify> {
        Some(crate::engine::subscription::curator_wake_signal())
    }

    async fn tick(&self) {
        tick_once(&self.app, &self.pool).await;
    }
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

/// The switch, the brakes, the settle, the dispatch - in that order.
///
/// The settle runs **before** the brake check and after the switch, on purpose:
/// a request left at `dispatched` because a cap was reached while its worker
/// was finishing would never be settled by anything, and the lane would wedge
/// on a row whose terminal has been gone for hours. Stopping her from starting
/// work is a brake; stopping her from recording finished work is a leak.
async fn tick_once(app: &AppHandle, pool: &DbPool) {
    if !crate::commands::companions::curator_enabled(pool) {
        // Switched off, so her RESERVED BAND must stop existing: with no
        // Curator the queue's ranks have to be dense exactly as they are on
        // an install that never turned her on (see `fleet::bands`).
        //
        // Released HERE, and not in `companions_set_enabled`, although that
        // command is the obvious seam. It is not the only way the switch goes
        // off - a settings import, a restored database and a hand-edited row
        // all land the same `false` without passing through it - and a band
        // that outlives its companion is the failure this release exists to
        // prevent. The first statement of her loop is the one place that
        // observes EVERY way she can be off, whatever wrote it, and it runs
        // whether or not she has ever ticked. The cost is a bound of one tick
        // interval on the release; the call is idempotent and writes nothing
        // when she holds no band, so paying it every minute is free.
        bands::release(app, bands::CURATOR_BAND);
        return;
    }
    let root = match super::registry_root_of(pool) {
        Ok(root) => root,
        Err(err) => {
            warn_occasionally("curator loop: no registry root", &err);
            return;
        }
    };

    settle_ended(app, pool, &root).await;
    maybe_dispatch(app, pool, &root).await;
    // **Outside `maybe_dispatch`, and that is the bug this shape exists to
    // avoid.** Every reason not to START work - a spent budget, quiet hours, a
    // full worker pool - is a reason her plan will sit un-reconciled, which is
    // exactly when the plan drifts furthest from the corpus. The reconcile
    // reads and projects; it dispatches nothing, so no brake applies to it. It
    // runs last so a pass that is actually due (at most hourly) delays the
    // dispatch of work rather than the other way round.
    sleep::maybe_reconcile(app, pool, &root).await;
}

/// The dispatch half of a tick: the brakes, her worker cap, and the lanes.
async fn maybe_dispatch(app: &AppHandle, pool: &DbPool, root: &Path) {
    let policy = super::load_policy(pool);
    let brakes = match read_brakes(pool) {
        Ok(brakes) => brakes,
        Err(err) => {
            tracing::warn!(error = %err, "curator loop: could not read her brakes - not dispatching");
            return;
        }
    };
    let halted = super::halted_reason(&brakes, &policy);
    // Announced on the EDGE, never on the state. See `halt_kind`.
    if let Some(kind) = halt_transition(halted.as_deref()) {
        pulse::emit(app, pool, kind);
    }
    if let Some(why) = halted {
        warn_occasionally("curator loop: halted", &why);
        return;
    }

    // Her cap, enforced by her, before the fleet's door is ever called.
    let running = queue::live_count_for_origin(DispatchOrigin::Curator);
    let Some(mut free) = free_slots(running, policy.worker_cap) else {
        return;
    };

    let skills = match instrument::read_skills(root) {
        Ok(skills) => skills,
        Err(err) => {
            tracing::warn!(error = %err, "curator loop: the registry's skill lane could not be read");
            return;
        }
    };
    let engines = dispatch::claimable_engines(&skills);
    let head = instrument::git_head_short(root).await;
    // Her standing lane's state, read ONCE per tick from the registry's own
    // queue file. `None` is "this app could not read it", which dispatches
    // neither rung: both of them cost real money and the whole point of the
    // measurement is that a rung is never chosen on a guess. A queue file that
    // is simply absent is not this case - it reads as an empty lane.
    let lane = match standing::read(root) {
        Ok(lane) => Some(lane),
        Err(err) => {
            warn_occasionally(
                "curator loop: her standing lane could not be measured, so neither of its rungs \
                 is dispatched",
                &err,
            );
            None
        }
    };
    let mut runs_today = brakes.runs_today;

    while free > 0 {
        // Re-checked per dispatch, not once per tick: two free slots and one
        // run left under the cap must start one worker, not two.
        if policy.daily_run_cap.is_some_and(|cap| runs_today >= cap) {
            tracing::info!(
                runs_today,
                "curator loop: today's run cap reached mid-tick - the remaining slot stays free"
            );
            break;
        }
        let now = chrono::Utc::now().to_rfc3339();
        // Re-derived per slot, not once per tick: the marks move when a rung is
        // dispatched and `harvest_in_flight` moves when one is admitted, so two
        // free slots must not put two writers into the same queue file.
        let rung = lane
            .as_ref()
            .filter(|_| !harvest_in_flight())
            .and_then(|lane| standing::standing_rung(lane, &read_marks(pool)));
        // Re-derived per slot for the same reason the rung is: a method fix
        // dispatched into the first slot must not be dispatched again into the
        // second, and the in-flight check inside `choose_method` is what sees
        // that - but only if it is asked again.
        //
        // The plan is read here rather than passed in because it MOVES: the
        // claim above marks an item `dispatched`, which is exactly the state
        // `measure` excludes, so a plan captured before the loop would rank a
        // fix by items she had since taken.
        let method = plan_items(pool)
            .as_deref()
            .and_then(|items| choose_method(pool, items, &skills, head.as_deref()));
        let chosen = match choose_work(pool, &engines, method, rung, &now) {
            Ok(Some(work)) => work,
            Ok(None) => break,
            Err(err) => {
                tracing::warn!(error = %err, "curator loop: could not choose the next piece of work");
                break;
            }
        };
        match start(app, pool, root, &policy, &skills, head.as_deref(), chosen).await {
            Ok(()) => {
                free -= 1;
                runs_today += 1;
            }
            // `start` has already settled the claimed row, so the loop is free
            // to try the next piece of work rather than spinning on this one.
            Err(err) => {
                tracing::warn!(error = %err, "curator loop: a dispatch did not start");
                break;
            }
        }
    }
}

/// Her standing plan's items, or `None` when there is no plan or it could not
/// be read.
///
/// `None` rather than an empty slice on failure, so the method lane cannot
/// mistake an unreadable plan for a plan with no impediments in it - which would
/// be the difference between "nothing is blocking her" and "nobody looked".
fn plan_items(pool: &DbPool) -> Option<Vec<CuratorPlanItem>> {
    match repo::current_plan(pool) {
        Ok(plan) => plan.map(|p| p.items),
        Err(err) => {
            tracing::warn!(
                error = %err,
                "curator loop: her standing plan could not be read, so the method lane is skipped \
                 for this tick"
            );
            None
        }
    }
}

/// Free worker slots, or `None` when she is at her cap.
///
/// `None` rather than `0` so the caller cannot accidentally enter a loop body
/// that assumes there is room, and because the two readings are different
/// things to say in a log: no slot is WORKING, which is never a halt.
fn free_slots(running: u32, cap: u32) -> Option<u32> {
    cap.checked_sub(running).filter(|free| *free > 0)
}

// ---------------------------------------------------------------------------
// The brakes
// ---------------------------------------------------------------------------

/// Everything the brakes are read against, measured once per tick.
///
/// A struct rather than seven positional parameters: the three counters and the
/// clock are all plain numbers, and a transposed pair would produce a brake
/// that binds on the wrong quantity and still compiles.
pub(super) struct BrakeReading {
    pub enabled: bool,
    pub has_registry: bool,
    pub spent_today_usd: f64,
    pub runs_today: u32,
    pub commits_today: u32,
    /// Decisions of hers nobody has answered. Backpressure is on the OPERATOR:
    /// a queue nobody is answering should stop growing.
    pub awaiting_decisions: u32,
    /// Minutes past local midnight, for the quiet-hours window.
    pub now_minute: u32,
}

/// Read every brake input. One call, so no brake is ever checked against a
/// figure measured at a different moment than its neighbours.
pub(super) fn read_brakes(pool: &DbPool) -> Result<BrakeReading, AppError> {
    Ok(BrakeReading {
        enabled: crate::commands::companions::curator_enabled(pool),
        has_registry: crate::commands::companions::curator_registry(pool).is_some(),
        spent_today_usd: crate::db::repos::llm_spend::source_today(pool, CURATOR_SPEND_SOURCE)?.0,
        runs_today: crate::db::repos::fleet_sessions::count_started_today_for_origin(
            pool,
            DispatchOrigin::Curator.token(),
        )?,
        commits_today: repo::commits_today(pool)?,
        awaiting_decisions: repo::awaiting_decisions(pool)?,
        now_minute: personas_core::quiet_hours::local_minute_of_day(),
    })
}

// ---------------------------------------------------------------------------
// Choosing the work
// ---------------------------------------------------------------------------

/// One piece of work she has CLAIMED. Every variant here has already been
/// written to the database as in-flight, which is what stops a second tick
/// taking it - so a caller that drops one without dispatching or settling it
/// leaks a row.
pub(super) enum Work {
    /// The operator's lane. Drained first, always.
    Queue(CuratorRequest),
    /// Her own plan.
    Plan(CuratorPlanItem),
    /// Her standing lane's chosen rung - drain or refill. Claims nothing,
    /// because there is no row in THIS database to claim: the registry's own
    /// queue file is the state, and [`super::standing`] measured it.
    Standing(Standing),
    /// **The gap in a method file that is blocking her plan.** Claims nothing
    /// either: the state is the registry's own `SKILL.md`, and what stops a
    /// second tick taking it is an in-flight check plus a mark keyed on the
    /// registry HEAD - the same shape the standing lane's rungs use, for the
    /// same reason.
    Method(CuratorImpediment),
}

impl Work {
    pub(super) fn lane(&self) -> &'static str {
        match self {
            Work::Queue(_) => curator_lane::QUEUE,
            Work::Plan(_) => curator_lane::PLAN,
            // ONE lane token for both rungs, deliberately. `curator_dispatch`
            // records `skill` and `argument` beside it, so `/harvest auto` and
            // `/harvest research` are already told apart in the audit; a fourth
            // token would need the table's CHECK rebuilt and a label in
            // fourteen locales to say something the row already says.
            Work::Standing(_) => curator_lane::REFILL,
            Work::Method(_) => curator_lane::METHOD,
        }
    }
}

/// **The lane order.** The operator's queue, then her plan, then her METHOD
/// lane, then her standing lane - which is itself two rungs, `/harvest auto`
/// before `/harvest research`.
///
/// **Why method sits fourth and not second.** Work she can already do outranks
/// widening what she can do: a plan item dispatched now is knowledge landed now.
/// But it sits ahead of the standing lane, and that placement is the whole
/// lesson of 2026-09-24, when eight consecutive refill passes ran at ~$0.26 each
/// against a queue that was already full. The rung that was missing was never
/// "go and find more sources" - it was "my plan is not empty, I simply cannot
/// spell the command". Between those two states the honest move is to fix the
/// grammar, not to buy more sentences.
///
/// Separated from the dispatch so it can be driven against a real database in a
/// test with no Tauri app: the ordering is the operator's own rule and the only
/// way to prove it is to seed both lanes and watch which one drains.
///
/// `standing` arrives already chosen and is `None` when neither rung may run:
/// one is already in flight, the queue file could not be read, or both rungs
/// have already been run against exactly these bytes. The in-flight case is not
/// a fairness rule - it is `harvest`'s own law ("Never let a miner or research
/// agent write to the tree; single writer, always"): two harvest passes in one
/// checkout would both write the same queue file, and it makes no difference
/// that one of them is draining it and the other refilling it.
pub(super) fn choose_work(
    pool: &DbPool,
    engines: &[CuratorEngine],
    method: Option<CuratorImpediment>,
    standing: Option<Standing>,
    now: &str,
) -> Result<Option<Work>, AppError> {
    if let Some(request) = repo::claim_next_queued(pool, None, now)? {
        return Ok(Some(Work::Queue(request)));
    }
    if let Some(item) = repo::claim_next_plan_item(pool, engines, now)? {
        return Ok(Some(Work::Plan(item)));
    }
    if let Some(impediment) = method {
        return Ok(Some(Work::Method(impediment)));
    }
    Ok(standing.map(Work::Standing))
}

/// The one impediment she may act on, or `None`.
///
/// Three gates, and every one of them fails CLOSED - because this lane edits the
/// instructions every future worker reads, and the cost of a wrong dispatch here
/// is not a wasted run but a method file with a fiction in it.
///
/// 1. **Only a self-fixable kind, and only one that is holding something.** An
///    `apply` item that cannot name a technique is a gap in *this app's*
///    projection; she may not rewrite Personas, so it is reported and never
///    dispatched. See [`super::impediment`].
///
///    **Eligibility is what it HOLDS; the rank is what it FREES**, and the two
///    were deliberately separated after the live plan was measured on 2026-09-26.
///    Gating on `frees` was tried first and was wrong: every engine except
///    `Reconcile` and `Deepen` frees nothing today, and both of those already
///    have documented skills, so the gate made the lane unable to ever fire -
///    a lane that runs green while doing nothing, which is the failure this
///    repository names in its own census doctrine. What it would have skipped is
///    `conform`, whose invocation lives only in a prose sentence inside its
///    `description:` frontmatter: no program can address it, it holds 99 items,
///    and documenting it is exactly the change the operator authorised. That it
///    releases none of those 99 immediately is a fact for the worker's brief to
///    state, not a reason to leave the defect in place.
///
///    She cannot loop on it either: the mark below allows one attempt per
///    registry HEAD, and once the file documents an invocation the impediment
///    becomes `ItemLacksArgument`, which is not hers, so she never returns.
/// 2. **Nothing already in flight.** One method worker at a time, and an
///    unreadable dispatch table counts as "in flight" rather than as "clear".
/// 3. **The registry must have moved since the last attempt.** The mark is
///    `<impediment-id>@<head>`: re-running the same fix against the same HEAD
///    would either repeat work that landed or repeat work that was refused, and
///    the file itself is the only evidence which. **With no HEAD she does
///    nothing** - a mark that cannot be compared is not a mark, and an act this
///    privileged is exactly the one not to take while blind.
pub(super) fn choose_method(
    pool: &DbPool,
    items: &[CuratorPlanItem],
    skills: &[CuratorSkill],
    head: Option<&str>,
) -> Option<CuratorImpediment> {
    let head = head?;
    if method_in_flight(pool) {
        return None;
    }
    let top = super::impediment::measure(items, skills)
        .into_iter()
        .find(|i| i.self_fixable && i.blocks > 0)?;
    let mark = method_mark(&top, head);
    if super::setting(pool, settings_keys::CURATOR_METHOD_MARK).as_deref() == Some(mark.as_str()) {
        return None;
    }
    Some(top)
}

/// What one method attempt is remembered by: the impediment, and the corpus
/// version it was attempted against.
pub(super) fn method_mark(impediment: &CuratorImpediment, head: &str) -> String {
    format!("{}@{head}", impediment.id)
}

/// Whether a method fix she dispatched is still open.
///
/// Read from her own dispatch table rather than from the fleet registry, unlike
/// [`harvest_in_flight`]: a method dispatch HAS a row of its own, and the row is
/// the more direct evidence. An unreadable table answers `true` - she does not
/// get to dispatch the most privileged thing she does on the strength of a
/// failed query.
fn method_in_flight(pool: &DbPool) -> bool {
    match repo::open_dispatches(pool) {
        Ok(rows) => rows.iter().any(|r| r.lane == curator_lane::METHOD),
        Err(err) => {
            tracing::warn!(
                error = %err,
                "curator loop: her open dispatches could not be read, so the method lane stays shut"
            );
            true
        }
    }
}

/// Whether ANY pass of her standing lane is already running or waiting.
///
/// Both rungs are matched, because both write `librarian/harvest/queue.md`:
/// a drain flips row statuses while a refill appends rows, and two writers in
/// one checkout is the situation harvest's single-writer law exists for.
///
/// Keyed on the dispatched ARGV rather than on a name: the fleet's naming lane
/// rewrites display names (collision discriminators, project labels), while the
/// args are exactly what this module put there.
pub(super) fn harvest_in_flight() -> bool {
    // The invocation is the first line of the prompt and its argument follows a
    // space - or a newline, when a bare `/harvest` is dispatched. Matching the
    // bare prefix alone would also match a future `/harvester`, so the next
    // character has to be one that ENDS the name.
    let marker = format!("/{}", dispatch::STANDING_SKILL);
    let is_standing_pass = |arg: &String| {
        arg.strip_prefix(&marker).is_some_and(|rest| {
            !rest.starts_with(|c: char| c.is_alphanumeric() || c == '-' || c == '_')
        })
    };
    crate::commands::fleet::registry::registry()
        .list_dto()
        .into_iter()
        .any(|s| {
            s.origin.as_deref() == Some(DispatchOrigin::Curator.token())
                && (matches!(s.state, FleetSessionState::Queued) || is_live_state(s.state))
                && s.args.iter().any(is_standing_pass)
        })
}

// ---------------------------------------------------------------------------
// The standing lane's marks
// ---------------------------------------------------------------------------

/// The queue fingerprint each rung was last dispatched against.
///
/// In `app_settings` rather than a table for the reason
/// `curator_last_sleep_at` is: there is exactly one Curator and these are two
/// scalars the loop writes and no person ever sets.
pub(super) fn read_marks(pool: &DbPool) -> Marks {
    Marks {
        drain: super::setting(pool, settings_keys::CURATOR_HARVEST_DRAIN_MARK),
        refill: super::setting(pool, settings_keys::CURATOR_HARVEST_REFILL_MARK),
    }
}

/// The settings key a rung's mark lives under.
fn mark_key(rung: Rung) -> &'static str {
    match rung {
        Rung::Drain => settings_keys::CURATOR_HARVEST_DRAIN_MARK,
        Rung::Refill => settings_keys::CURATOR_HARVEST_REFILL_MARK,
    }
}

/// The argument one rung's invocation takes.
fn rung_argument(rung: Rung) -> &'static str {
    match rung {
        Rung::Drain => dispatch::DRAIN_ARGUMENT,
        Rung::Refill => dispatch::REFILL_ARGUMENT,
    }
}

// ---------------------------------------------------------------------------
// Starting a worker
// ---------------------------------------------------------------------------

/// Vet, compose, admit, and record - or settle the claimed row with the reason
/// it could not start.
///
/// **A claimed row is never left in flight.** Each refusal below writes the
/// claim back to a settled state before returning, because the claim already
/// happened: `choose_work` marks the request `dispatched` and the plan item
/// `dispatched` so a second tick cannot take them, and a refusal that returned
/// without settling would wedge that row for good.
async fn start(
    app: &AppHandle,
    pool: &DbPool,
    root: &Path,
    policy: &CuratorPolicy,
    skills: &[CuratorSkill],
    head: Option<&str>,
    work: Work,
) -> Result<(), AppError> {
    let lane = work.lane();
    let now = chrono::Utc::now().to_rfc3339();

    let (skill, argument, note, subject, finding, measurement) = match &work {
        Work::Queue(request) => (
            request.skill.clone(),
            request.argument.clone(),
            request.note.clone(),
            None,
            None,
            None,
        ),
        Work::Plan(item) => {
            let Some((skill, argument)) = dispatch::plan_invocation(item) else {
                // Unreachable while `claimable_engines` and `plan_invocation`
                // agree (their test asserts exactly that), but the item is
                // already claimed, so the arm settles rather than returning.
                let settled = repo::settle_plan_item(
                    pool,
                    &item.id,
                    CuratorPlanItemState::Blocked,
                    "this app could not derive an invocation for the engine that answers this \
                     finding, so nothing was dispatched",
                    &now,
                )?;
                note_plan_settle(settled, &item.id, "no invocation derivable");
                return Err(AppError::Validation(format!(
                    "curator: no invocation derivable for {} ({:?})",
                    item.subject_id, item.engine
                )));
            };
            (
                skill.to_string(),
                Some(argument),
                None,
                Some(item.subject_id.clone()),
                item.reasons.first().map(|r| r.detail.clone()),
                None,
            )
        }
        // The rung and the count that chose it, both from `standing`. The
        // measurement travels into the brief so the worker can refute it.
        Work::Standing(chosen) => (
            dispatch::STANDING_SKILL.to_string(),
            Some(rung_argument(chosen.rung).to_string()),
            None,
            None,
            None,
            Some(chosen.because.clone()),
        ),
        // The pseudo-skill, with NO argument: this lane injects no slash
        // command, so there is nothing for an argument to be part of.
        Work::Method(impediment) => (
            dispatch::METHOD_SKILL.to_string(),
            None,
            None,
            None,
            None,
            Some(format!(
                "{} blocks {} planned item(s)",
                impediment.skill, impediment.blocks
            )),
        ),
    };

    // The operator's lane was vetted when the request was filed; the registry
    // can have moved since, and HER lanes are vetted by the stricter rule that
    // refuses an undocumented invocation outright.
    let vetted = match &work {
        Work::Queue(_) => super::vet_request(skills, &skill, argument.as_deref()),
        Work::Plan(_) | Work::Standing(_) => {
            dispatch::vet_autonomous(skills, &skill, argument.as_deref())
        }
        // Nothing to vet against the skill table: the whole premise of this lane
        // is that the skill it is about documents NO invocation, so the vet that
        // protects the other lanes would refuse the one dispatch whose purpose is
        // to end that refusal. What stands in its place is `choose_method`'s three
        // fail-closed gates and the fact that the worker runs no slash command.
        Work::Method(_) => Ok(()),
    };
    if let Err(err) = vetted {
        settle_unstarted(pool, &work, &err.to_string(), &now)?;
        return Err(err);
    }

    let prompt = match &work {
        Work::Method(impediment) => dispatch::compose_method(impediment, head),
        _ => dispatch::compose(&Brief {
            lane,
            skill: &skill,
            argument: argument.as_deref(),
            note: note.as_deref(),
            subject: subject.as_deref(),
            finding: finding.as_deref(),
            measurement: measurement.as_deref(),
            head,
        }),
    };

    let admission = queue::admit(
        app,
        DispatchRequest {
            cwd: root.to_string_lossy().into_owned(),
            name: Some(format!("curator-{lane}")),
            title: Some(match (&work, argument.as_deref()) {
                // Named for what it does, not `/method`, which is not a command
                // anybody can type - a terminal labelled with a slash form that
                // does not exist is a worse label than no slash at all.
                (Work::Method(imp), _) => format!("document {}'s invocation", imp.skill),
                (_, Some(arg)) => format!("/{skill} {arg}"),
                (_, None) => format!("/{skill}"),
            }),
            args: queue::headless_args(&prompt, Vec::new()),
            // Headless, not a PTY. An interactive session parks in `Idle` when
            // its turn ends and `Idle` is a LIVE state, so two of them would
            // hold her whole worker cap until a person closed them; a headless
            // worker exits, and the slot comes back on its own. It is also
            // what the tree's two other unattended dispatchers use.
            mode: FleetSessionMode::Headless,
            // Her own tag, never the process-global run: an unlabelled worker
            // is invisible to every sweep that retires, prunes and skips ended
            // machine sessions on restart, because those are keyed on the label.
            run_label: Some(personas_engine::unattended::curator_run_label(lane)),
            origin: DispatchOrigin::Curator,
            persona_id: None,
            goal_id: None,
            cycle_index: None,
            not_before_ms: None,
            profile: None,
        },
    )
    .await;

    let admission = match admission {
        Ok(admission) => admission,
        Err(err) => {
            settle_unstarted(pool, &work, &format!("the fleet refused it: {err}"), &now)?;
            return Err(err);
        }
    };

    let queued = matches!(admission.state, FleetSessionState::Queued);
    let session_id = admission.session_id;
    // Her band, taken only on the row that is actually WAITING: a dispatch the
    // door started immediately holds no position, so there is nothing to
    // reserve. The claim is after `queue::admit`, never instead of it - the
    // row has already been counted against the queue's depth cap and is
    // already reapable by the expiry pass, and the band changes neither. A
    // refused claim (she already holds the band with an earlier row) is the
    // ordinary case and not a failure: this one waits in its natural place.
    if queued {
        bands::claim(app, &session_id, bands::CURATOR_BAND);
    }
    let level = dispatch::authorising_level(policy, &skill);
    let dispatch_id = uuid::Uuid::new_v4().to_string();
    let (request_id, plan_item_id) = match &work {
        Work::Queue(request) => (Some(request.id.clone()), None),
        Work::Plan(item) => (None, Some(item.id.clone())),
        Work::Standing(_) | Work::Method(_) => (None, None),
    };
    repo::record_dispatch(
        pool,
        &dispatch_id,
        &repo::CuratorDispatchInput {
            lane,
            request_id: request_id.as_deref(),
            plan_item_id: plan_item_id.as_deref(),
            session_id: &session_id,
            skill: &skill,
            argument: argument.as_deref(),
            level_that_authorised: level,
            repo_path: &root.to_string_lossy(),
            head_at_dispatch: head,
            created_at: &now,
        },
    )?;
    match &work {
        Work::Queue(request) => {
            if !repo::bind_request_session(pool, &request.id, &session_id)? {
                note_unbound(lane, &request.id, &session_id);
            }
        }
        Work::Plan(item) => {
            if !repo::bind_plan_item_session(pool, &item.id, &session_id)? {
                note_unbound(lane, &item.id, &session_id);
            }
        }
        // Nothing in this database asked for it, so there is nothing to bind.
        // What is written instead is the rung's MARK: the queue fingerprint it
        // was dispatched against, so a pass that leaves the file untouched
        // cannot be handed the same bytes again on the next tick. Written after
        // the admission, never before - a rung that failed to start has not
        // been tried.
        // The same shape as the standing rung below, and for the same reason:
        // written only once the fleet has admitted the worker, because a fix
        // that never started has not been attempted. Keyed on the registry HEAD
        // as well as the impediment, so the NEXT commit to the registry - hers
        // or anybody's - lets her look again.
        Work::Method(impediment) => {
            if let Some(head) = head {
                if let Err(err) = crate::db::repos::core::settings::set(
                    pool,
                    settings_keys::CURATOR_METHOD_MARK,
                    &method_mark(impediment, head),
                ) {
                    tracing::warn!(
                        error = %err,
                        "curator: her method mark could not be written, so the same fix may be \
                         dispatched again against an unmoved registry"
                    );
                }
            }
        }
        Work::Standing(chosen) => {
            if let Err(err) =
                crate::db::repos::core::settings::set(pool, mark_key(chosen.rung), &chosen.mark)
            {
                // Logged and swallowed: a missing mark costs one repeat
                // dispatch, while a dispatch abandoned after its worker is
                // already running leaks the session.
                tracing::warn!(
                    error = %err,
                    "curator: her standing rung's mark could not be written, so the same rung \
                     may be dispatched again against unchanged inputs"
                );
            }
        }
    }

    tracing::info!(
        lane,
        skill = %skill,
        argument = argument.as_deref().unwrap_or("-"),
        session_id = %session_id,
        level = level.as_str(),
        rank = admission.rank.unwrap_or(0),
        "curator: dispatched a worker"
    );
    // Last, after every row is written: the payload carries her runtime, and a
    // runtime measured before `record_dispatch` would report one fewer terminal
    // than she now holds.
    pulse::emit(app, pool, curator_pulse::DISPATCHED);
    Ok(())
}

/// Write a claimed row back to a settled state when its worker never started.
fn settle_unstarted(pool: &DbPool, work: &Work, why: &str, now: &str) -> Result<(), AppError> {
    match work {
        Work::Queue(request) => {
            repo::settle_request(
                pool,
                &request.id,
                CuratorRequestState::Declined,
                None,
                None,
                Some(why),
                now,
            )?;
        }
        Work::Plan(item) => {
            let settled = repo::settle_plan_item(
                pool,
                &item.id,
                CuratorPlanItemState::Blocked,
                &format!("no worker started: {why}"),
                now,
            )?;
            note_plan_settle(settled, &item.id, "no worker started");
        }
        // Nothing was claimed, so there is nothing to write back - and no mark
        // either: `start` writes that only after the fleet admits the worker.
        // The method lane is the same on both counts, which is why a refused
        // method dispatch is retried on the next tick rather than lost.
        Work::Standing(_) | Work::Method(_) => {}
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Settling what has ended
// ---------------------------------------------------------------------------

/// How one of her workers ended, as the fleet registry reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ended {
    /// Still running, or still waiting in the queue. Nothing to do.
    No,
    /// It finished and said so.
    Succeeded,
    /// It ended without succeeding, or its row is gone and nothing ever
    /// recorded an outcome. **The two are reported apart** - see
    /// [`ended_how`].
    Failed(&'static str),
}

/// Read how a session ended from the live registry.
///
/// A session the registry has never heard of is `Failed`, not `Succeeded`:
/// the row was reaped, or the app restarted before the outcome was written, and
/// in both cases nothing observed a success. Calling it landed would put a
/// claim in the ledger that no evidence supports.
fn ended_how(sessions: &HashMap<String, (FleetSessionState, Option<i32>)>, id: &str) -> Ended {
    let Some((state, exit_code)) = sessions.get(id) else {
        return Ended::Failed("its fleet session is gone and no outcome was ever recorded");
    };
    if matches!(state, FleetSessionState::Queued) || is_live_state(*state) {
        return Ended::No;
    }
    match (state, exit_code) {
        (FleetSessionState::Finished, _) => Ended::Succeeded,
        (_, Some(0)) => Ended::Succeeded,
        (_, Some(_)) => Ended::Failed("its worker exited with a failure"),
        (_, None) => Ended::Failed("its worker ended without reporting an exit code"),
    }
}

/// Close every dispatch whose worker has ended: settle the row it came from,
/// and write the commits it caused into her audit ledger.
async fn settle_ended(app: &AppHandle, pool: &DbPool, root: &Path) {
    let open = match repo::open_dispatches(pool) {
        Ok(open) => open,
        Err(err) => {
            tracing::warn!(error = %err, "curator loop: could not read her open dispatches");
            return;
        }
    };
    if open.is_empty() {
        return;
    }
    let sessions: HashMap<String, (FleetSessionState, Option<i32>)> =
        crate::commands::fleet::registry::registry()
            .list_dto()
            .into_iter()
            .map(|s| (s.id, (s.state, s.exit_code)))
            .collect();

    for dispatched in open {
        let ended = ended_how(&sessions, &dispatched.session_id);
        if matches!(ended, Ended::No) {
            continue;
        }
        let now = chrono::Utc::now().to_rfc3339();
        // The settle is the claim: a `false` here means a concurrent pass took
        // it, and writing its commits a second time would double-count them
        // against the daily commit cap.
        match repo::settle_dispatch(pool, &dispatched.id, &now) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(err) => {
                tracing::warn!(error = %err, "curator loop: could not settle a dispatch");
                continue;
            }
        }
        record_commits(pool, root, &dispatched, &now).await;
        if let Err(err) = settle_source(pool, &dispatched, ended, &now) {
            tracing::warn!(error = %err, "curator loop: could not settle what a dispatch came from");
        }
        // One per settled dispatch, not one per pass: each is a row the
        // operator's lane draws, and a pass that settles three is three things
        // he watched finish. The OUTCOME is deliberately not on the payload -
        // it was just written to the row the client re-reads, and a copy on the
        // wire would be a second authority for it.
        pulse::emit(app, pool, curator_pulse::SETTLED);
    }
}

/// Settle the request or plan item one ended dispatch came from.
///
/// **A plan item that SUCCEEDED is deliberately left `dispatched`.** Whether it
/// landed or came back dry is not a question about the worker's exit code - it
/// is a question about whether the finding still exists in the corpus, and only
/// the reconcile sleep can answer that. A failed one is settled `blocked` here
/// and now, because `blocked` breaks her saturation streak while `idled`
/// deepens it: a crashed worker must never be recorded as "she tried and the
/// subject was settled ground".
fn settle_source(
    pool: &DbPool,
    dispatched: &repo::CuratorDispatchRow,
    ended: Ended,
    now: &str,
) -> Result<(), AppError> {
    if let Some(request_id) = dispatched.request_id.as_deref() {
        let (state, failure) = match ended {
            Ended::Succeeded => (CuratorRequestState::Landed, None),
            Ended::Failed(why) => (CuratorRequestState::Failed, Some(why)),
            Ended::No => return Ok(()),
        };
        repo::settle_request(
            pool,
            request_id,
            state,
            Some(&format!("session {}", dispatched.session_id)),
            None,
            failure,
            now,
        )?;
    }
    if let Some(item_id) = dispatched.plan_item_id.as_deref() {
        if let Ended::Failed(why) = ended {
            let settled = repo::settle_plan_item(
                pool,
                item_id,
                CuratorPlanItemState::Blocked,
                &format!(
                    "session {} ended without landing: {why}",
                    dispatched.session_id
                ),
                now,
            )?;
            note_plan_settle(settled, item_id, "session ended without landing");
        }
    }
    Ok(())
}

/// A plan-item settle whose guard fired: the item was already terminal, so its
/// earlier outcome and evidence stand and this call wrote nothing. Said out loud
/// because the settle feeds her saturation streak - a `blocked` that silently
/// did not land is a streak computed from a different history than the log
/// describes.
fn note_plan_settle(settled: bool, item_id: &str, cause: &'static str) {
    if !settled {
        tracing::info!(
            plan_item_id = item_id,
            cause,
            "curator: plan item was already settled - this settle wrote nothing"
        );
    }
}

/// A session binding whose guard fired: the claimed row left `dispatched`
/// between the claim and the bind, so no row points at the running worker. Its
/// `curator_dispatch` ledger row still names the session, which is what the
/// settle walks - the lane row itself just will not show it.
fn note_unbound(lane: &str, row_id: &str, session_id: &str) {
    tracing::warn!(
        lane,
        row_id,
        session_id,
        "curator: claimed row was no longer dispatched when its session was bound"
    );
}

// ---------------------------------------------------------------------------
// The commit ledger
// ---------------------------------------------------------------------------

/// Write one row per commit the ended worker caused.
///
/// The range is `<head_at_dispatch>..HEAD` in the checkout she dispatched into.
/// That is why `curator_dispatch` stores the HEAD at all: the alternative - a
/// `git log --since` window around the run - attributes a human's commit in the
/// same minutes to her, and an audit row that might be somebody else's work is
/// worse than no row.
///
/// Every failure here is logged and swallowed. A missing ledger row is bad; a
/// tick that stops settling because git was busy is worse, and the settle is
/// what keeps her lanes moving.
async fn record_commits(
    pool: &DbPool,
    root: &Path,
    dispatched: &repo::CuratorDispatchRow,
    now: &str,
) {
    let Some(head) = dispatched.head_at_dispatch.as_deref() else {
        tracing::info!(
            session_id = %dispatched.session_id,
            "curator: no HEAD was recorded at dispatch, so no commit can be attributed to this \
             worker - none is written rather than guessing from a time window"
        );
        return;
    };
    let range = format!("{head}..HEAD");
    let log = match crate::engine::git_checkpoint::run_git(
        root,
        &[
            "log",
            &range,
            "--no-merges",
            &format!("--max-count={MAX_COMMITS_PER_SETTLE}"),
            "--name-only",
            &format!("--format={GIT_RECORD_SEP}%H"),
        ],
    )
    .await
    {
        Ok(log) => log,
        Err(err) => {
            tracing::warn!(
                error = %err,
                session_id = %dispatched.session_id,
                "curator: could not read the commits this worker caused"
            );
            return;
        }
    };
    let commits = parse_git_log(&log);
    if commits.is_empty() {
        return;
    }
    let branch =
        crate::engine::git_checkpoint::run_git(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .ok()
            .filter(|b| !b.is_empty());
    let registry = crate::commands::companions::curator_registry(pool);
    let slug = registry
        .as_ref()
        .map(|r| r.full_name.clone())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    let branch = branch
        .or_else(|| registry.as_ref().map(|r| r.default_branch.clone()))
        .unwrap_or_else(|| "HEAD".into());

    let mut written = 0usize;
    for (sha, files) in &commits {
        let files_json = serde_json::to_string(files).unwrap_or_else(|_| "[]".into());
        let id = uuid::Uuid::new_v4().to_string();
        match repo::record_commit(
            pool,
            &id,
            &repo::CuratorCommitInput {
                project_slug: &slug,
                repo_path: &dispatched.repo_path,
                branch: &branch,
                sha,
                files_json: &files_json,
                level_that_authorised: dispatched.level_that_authorised,
                run_id: Some(&dispatched.session_id),
                created_at: now,
            },
        ) {
            Ok(true) => written += 1,
            Ok(false) => {}
            Err(err) => {
                tracing::warn!(error = %err, sha = %sha, "curator: a commit row could not be written");
            }
        }
    }
    tracing::info!(
        session_id = %dispatched.session_id,
        seen = commits.len(),
        written,
        level = dispatched.level_that_authorised.as_str(),
        "curator: recorded the commits this worker caused"
    );
}

/// Parse the one `git log` shape this module asks for into `(sha, files)`.
///
/// Split out and tested because the format string and the parse have to agree
/// and neither compiler nor git will say so: a record separator changed on one
/// side produces an empty ledger, which looks exactly like a worker that
/// committed nothing.
fn parse_git_log(raw: &str) -> Vec<(String, Vec<String>)> {
    raw.split(GIT_RECORD_SEP)
        .filter_map(|record| {
            let mut lines = record.lines().filter(|l| !l.trim().is_empty());
            let sha = lines.next()?.trim().to_string();
            if sha.is_empty() {
                return None;
            }
            Some((sha, lines.map(|l| l.trim().to_string()).collect()))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The halt edge
// ---------------------------------------------------------------------------

/// Which pulse a change of halt state deserves, or `None` when nothing moved.
///
/// **Edge, not state, and that is the whole point.** Her tick runs every minute
/// and her switch ships OFF, so announcing the halt STATE would push sixty
/// identical events an hour saying she is still stopped for the same reason -
/// the event equivalent of the poll the operator asked not to have.
///
/// The release arm is not symmetry for its own sake. Without it a quiet-hours
/// brake that ended at 07:00 would stay on screen until something else happened
/// to move, and on a morning with nothing queued that is never: the surface
/// would be drawing a brake that is off.
///
/// Pure, so both edges and both non-edges can be proven without a loop, a clock
/// or a database.
fn halt_kind(last: Option<&str>, now: Option<&str>) -> Option<&'static str> {
    if last == now {
        return None;
    }
    Some(if now.is_some() {
        curator_pulse::HALTED
    } else {
        curator_pulse::RESUMED
    })
}

/// [`halt_kind`] against the reason the last pulse announced.
///
/// Starts at "not halted", which is the honest presumption at boot: if her
/// first tick finds a brake on, that IS an edge and is announced; if it finds
/// none, nothing changed and the console's own mount read is what tells it so.
fn halt_transition(now: Option<&str>) -> Option<&'static str> {
    static LAST: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
    let mut guard = LAST.lock().unwrap_or_else(|p| p.into_inner());
    let kind = halt_kind(guard.as_deref(), now);
    if kind.is_some() {
        *guard = now.map(str::to_string);
    }
    kind
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/// Log at most once a minute, whatever the tick rate.
///
/// She is halted far more often than she runs - the switch ships OFF - and a
/// loop that logged "switched off" every sixty seconds would bury everything
/// else in the file. The gate is on the CLOCK rather than on the message, so a
/// halt reason that changes still waits its turn; the runtime door reports the
/// current reason at any moment, which is where a surface reads it from.
///
/// `event` is a constant naming WHICH notice this is and `detail` is the
/// per-occurrence value, kept apart as fields so the log can be grouped by event
/// and filtered by detail instead of holding one opaque string per occurrence.
fn warn_occasionally(event: &'static str, detail: &dyn std::fmt::Display) {
    static LAST_MS: AtomicU64 = AtomicU64::new(0);
    const EVERY_MS: u64 = 60_000;
    let now = crate::commands::fleet::registry::now_ms().max(0) as u64;
    let last = LAST_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < EVERY_MS {
        return;
    }
    LAST_MS.store(now, Ordering::Relaxed);
    tracing::info!(event, detail = %detail, "curator loop: throttled notice");
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_core::models::{CuratorReasonCode, CuratorSkillLane};
    use personas_db::init_test_db;

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    /// **A halt is announced on its EDGE, never on its state.**
    ///
    /// Her tick runs every minute and her switch ships OFF, so announcing the
    /// state would push sixty identical events an hour - the event equivalent
    /// of the poll the operator asked not to have. Both non-edges and both
    /// edges are pinned here, including the release, which exists so a
    /// quiet-hours brake that ended at 07:00 does not stay on screen until the
    /// next thing happens to move.
    #[test]
    fn a_halt_is_announced_once_and_its_release_is_announced_too() {
        // Still free, and still stopped for the same reason: nothing to say.
        assert_eq!(halt_kind(None, None), None);
        assert_eq!(halt_kind(Some("quiet hours"), Some("quiet hours")), None);
        // Both edges.
        assert_eq!(
            halt_kind(None, Some("quiet hours")),
            Some(curator_pulse::HALTED)
        );
        assert_eq!(
            halt_kind(Some("quiet hours"), None),
            Some(curator_pulse::RESUMED)
        );
        // A brake that hands over to a different brake is still a halt, and it
        // is announced, because the REASON on screen would otherwise be wrong.
        assert_eq!(
            halt_kind(Some("quiet hours"), Some("today's budget is spent")),
            Some(curator_pulse::HALTED)
        );
    }

    fn seed_plan(pool: &DbPool, engine: CuratorEngine, points: u32, subject: &str) -> String {
        use crate::db::repos::curator::{PlanItemInput, PlanRunInput};
        let run_id = uuid::Uuid::new_v4().to_string();
        let run = PlanRunInput {
            created_at: now(),
            scan_generated_at: now(),
            registry_head_sha: Some("abc1234".into()),
            corpus: Default::default(),
            consumers: Default::default(),
            policy: CuratorPolicy::default(),
            quiet: Vec::new(),
        };
        let items = vec![PlanItemInput {
            subject_id: subject.into(),
            domain: "localization".into(),
            at: "european/czech".into(),
            points,
            reasons: Vec::new(),
            dominant_reason: CuratorReasonCode::ExpiredApplication,
            engine,
            techniques: 3,
            applications: 1,
            stacks: Vec::new(),
            demand: None,
            last_swept: None,
            registry_dry_streak: 0,
            suppressed_by_saturation: false,
            has_applied_row: None,
        }];
        repo::insert_plan(pool, &run_id, &run, &items).unwrap();
        run_id
    }

    /// The standing rung a tick would have chosen, for the lane-order tests -
    /// which are about which LANE wins, not about which rung her standing lane
    /// picks. That decision is driven whole in `standing`'s own tests.
    fn a_rung(rung: Rung) -> Option<Standing> {
        Some(Standing {
            rung,
            because: "a measurement taken elsewhere".into(),
            mark: "fp".into(),
        })
    }

    fn skill(name: &str, runs_bare: Option<bool>) -> CuratorSkill {
        CuratorSkill {
            name: name.into(),
            lane: CuratorSkillLane::Native,
            path: format!(".claude/skills/{name}/SKILL.md"),
            title: None,
            description: None,
            version: None,
            invocation_documented: runs_bare.is_some(),
            runs_bare,
            argument_hint: None,
            lessons_path: None,
            lessons_bytes: None,
            lessons_modified_at: None,
            lessons_latest_entry: None,
            lessons_latest_at: None,
        }
    }

    /// **The operator's rule.** With work waiting in both lanes, the human lane
    /// drains completely before her own plan is touched - and he accepted the
    /// named consequence, so this asserts the starvation rather than a fairness
    /// rule nobody asked for.
    #[test]
    fn the_human_lane_drains_before_her_plan_and_then_the_standing_lane() {
        let pool = init_test_db().unwrap();
        seed_plan(&pool, CuratorEngine::Reconcile, 9, "localization/czech");
        repo::create_request(&pool, "r1", "hygiene", None, Some("first"), &now()).unwrap();
        repo::create_request(&pool, "r2", "librarian", None, None, &now()).unwrap();
        let engines = [CuratorEngine::Reconcile];

        // Both operator requests go before the plan item, oldest first, even
        // though the plan item scores and is ready - and even though her
        // standing lane has a rung ready the whole time.
        match choose_work(&pool, &engines, None, a_rung(Rung::Drain), &now()).unwrap() {
            Some(Work::Queue(r)) => assert_eq!(r.id, "r1"),
            other => panic!("the oldest request must go first: {:?}", other.is_some()),
        }
        match choose_work(&pool, &engines, None, a_rung(Rung::Drain), &now()).unwrap() {
            Some(Work::Queue(r)) => assert_eq!(r.id, "r2"),
            other => panic!("the human lane drains WHOLE: {:?}", other.is_some()),
        }
        // Only now does her own plan get a hearing.
        match choose_work(&pool, &engines, None, a_rung(Rung::Drain), &now()).unwrap() {
            Some(Work::Plan(item)) => assert_eq!(item.subject_id, "localization/czech"),
            other => panic!("the plan comes after the queue: {:?}", other.is_some()),
        }
        // And with both lanes drained she does NOT stop - she goes to her
        // standing lane, whose rung the measurement already chose.
        match choose_work(&pool, &engines, None, a_rung(Rung::Drain), &now()).unwrap() {
            Some(Work::Standing(s)) => assert_eq!(s.rung, Rung::Drain),
            other => panic!(
                "a drained pair goes to the standing lane: {:?}",
                other.is_some()
            ),
        }
    }

    /// **The correction, at the lane door.** A drained pair dispatches
    /// `/harvest auto` - the mode that CONSUMES the queue - and reaches
    /// `/harvest research` only through the thin-queue gate. It shipped the
    /// other way round and cost eight no-op passes in one day.
    #[test]
    fn a_drained_pair_dispatches_the_drain_and_the_refill_only_when_promoted() {
        let pool = init_test_db().unwrap();

        // Rung 3, against the registry's own file: the queue can furnish a
        // batch, so the rung is the one that consumes rows.
        let real = standing::parse_for_test(include_str!("fixtures/harvest-queue.md"), "fp");
        let chosen = choose_work(
            &pool,
            &[],
            None,
            standing::standing_rung(&real, &Marks::default()),
            &now(),
        )
        .unwrap();
        match chosen {
            Some(Work::Standing(s)) => {
                assert_eq!(s.rung, Rung::Drain, "268 queued rows is work to DRAIN");
                assert_eq!(rung_argument(s.rung), "auto");
                assert_eq!(mark_key(s.rung), settings_keys::CURATOR_HARVEST_DRAIN_MARK);
            }
            other => panic!("expected the drain: {:?}", other.is_some()),
        }

        // Rung 4: the same lane with nothing left to batch promotes to the
        // refill, which is the only rung that makes new rows.
        let emptied = standing::parse_for_test(
            "## se (1)\n\n| A-1 | 1 | u | t | c | x | y | z | mined: 1c |\n",
            "fp2",
        );
        let chosen = choose_work(
            &pool,
            &[],
            None,
            standing::standing_rung(&emptied, &Marks::default()),
            &now(),
        )
        .unwrap();
        match chosen {
            Some(Work::Standing(s)) => {
                assert_eq!(s.rung, Rung::Refill);
                assert_eq!(rung_argument(s.rung), "research");
                assert_eq!(mark_key(s.rung), settings_keys::CURATOR_HARVEST_REFILL_MARK);
            }
            other => panic!("expected the refill: {:?}", other.is_some()),
        }
    }

    /// **The cost brake, at the lane door.** A rung already run against exactly
    /// these bytes is not offered again, and with both rungs spent the standing
    /// lane hands back nothing rather than a ninth $0.26 pass.
    #[test]
    fn a_rung_that_found_nothing_is_not_redispatched_against_unchanged_inputs() {
        let pool = init_test_db().unwrap();
        let real = standing::parse_for_test(include_str!("fixtures/harvest-queue.md"), "88bff378");

        let spent = Marks {
            drain: Some("88bff378".into()),
            refill: Some("88bff378".into()),
        };
        assert!(
            choose_work(
                &pool,
                &[],
                None,
                standing::standing_rung(&real, &spent),
                &now()
            )
            .unwrap()
            .is_none(),
            "both rungs have been run at these bytes; another dispatch buys the same nothing"
        );

        // The operator's own lane is never gated by any of this: a request
        // filed while both rungs are spent still goes out immediately.
        repo::create_request(&pool, "r1", "hygiene", None, None, &now()).unwrap();
        match choose_work(
            &pool,
            &[],
            None,
            standing::standing_rung(&real, &spent),
            &now(),
        )
        .unwrap()
        {
            Some(Work::Queue(r)) => assert_eq!(r.id, "r1"),
            other => panic!("the human lane is never braked: {:?}", other.is_some()),
        }
    }

    /// Her standing lane is ONE writer whichever rung it is: a drain and a
    /// refill both write `queue.md`, so the in-flight check keys on the SKILL
    /// and not on the argument.
    #[test]
    fn a_standing_pass_already_in_flight_is_not_started_twice() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            choose_work(&pool, &[], None, a_rung(Rung::Drain), &now()).unwrap(),
            Some(Work::Standing(_))
        ));
        assert!(
            choose_work(&pool, &[], None, None, &now())
                .unwrap()
                .is_none(),
            "a second harvest pass into the same checkout would race the first writer"
        );
        // Nothing of hers is live in this process, so the predicate finds
        // nothing - what matters is that ONE predicate now covers both rungs
        // rather than only `/harvest research`.
        assert!(!harvest_in_flight());
    }

    /// An engine her plan cannot spell is not claimed at all. The item stays
    /// `planned` - it is not HER outcome, it is this app's limit.
    #[test]
    fn a_plan_item_whose_engine_has_no_invocation_is_left_alone() {
        let pool = init_test_db().unwrap();
        seed_plan(
            &pool,
            CuratorEngine::Deepen,
            12,
            "software-engineering/table",
        );
        // `deepen` documents no invocation, so `claimable_engines` drops it and
        // the claim list is empty.
        let engines = dispatch::claimable_engines(&[skill("deepen", None)]);
        assert!(engines.is_empty());
        assert!(
            matches!(
                choose_work(&pool, &engines, None, a_rung(Rung::Drain), &now()).unwrap(),
                Some(Work::Standing(_))
            ),
            "she goes to her standing lane rather than guessing a /deepen command"
        );
        let plan = repo::current_plan(&pool).unwrap().unwrap();
        assert_eq!(plan.items[0].state, CuratorPlanItemState::Planned);
    }

    /// Her own measured dry streak suppresses a subject, and the claim is where
    /// that brake has to bind - a suppressed item that got claimed would be
    /// dispatched before anything else looked at the flag.
    #[test]
    fn a_saturated_subject_is_never_claimed() {
        use crate::db::repos::curator::{PlanItemInput, PlanRunInput};
        let pool = init_test_db().unwrap();
        let run_id = uuid::Uuid::new_v4().to_string();
        let run = PlanRunInput {
            created_at: now(),
            scan_generated_at: now(),
            registry_head_sha: None,
            corpus: Default::default(),
            consumers: Default::default(),
            policy: CuratorPolicy::default(),
            quiet: Vec::new(),
        };
        let items = vec![PlanItemInput {
            subject_id: "localization/czech".into(),
            domain: "localization".into(),
            at: "european/czech".into(),
            points: 9,
            reasons: Vec::new(),
            dominant_reason: CuratorReasonCode::ExpiredApplication,
            engine: CuratorEngine::Reconcile,
            techniques: 3,
            applications: 1,
            stacks: Vec::new(),
            demand: None,
            last_swept: None,
            registry_dry_streak: 0,
            suppressed_by_saturation: true,
            has_applied_row: None,
        }];
        repo::insert_plan(&pool, &run_id, &run, &items).unwrap();
        assert!(
            matches!(
                choose_work(
                    &pool,
                    &[CuratorEngine::Reconcile],
                    None,
                    a_rung(Rung::Drain),
                    &now()
                )
                .unwrap(),
                Some(Work::Standing(_))
            ),
            "settled ground is not re-run"
        );
    }

    /// **The cap is hers and it is two.** A full pool is not a halt, which is
    /// why this answers `None` rather than a reason.
    #[test]
    fn the_worker_cap_is_enforced_before_the_fleets_door() {
        assert_eq!(free_slots(0, 2), Some(2));
        assert_eq!(free_slots(1, 2), Some(1));
        assert_eq!(free_slots(2, 2), None, "at her cap she starts nothing");
        // Over-admitted (the operator started one by hand through the fleet's
        // own "start now"): still nothing, and never a negative slot count.
        assert_eq!(free_slots(3, 2), None);
        assert_eq!(free_slots(0, 1), Some(1));
        assert_eq!(
            CuratorPolicy::default().worker_cap,
            2,
            "the shipped cap the operator asked for"
        );
    }

    /// A session the registry cannot account for is a failure, never a
    /// success: nothing observed a landing.
    #[test]
    fn an_unaccountable_session_is_never_read_as_landed() {
        let mut sessions = HashMap::new();
        sessions.insert("live".to_string(), (FleetSessionState::Running, None));
        sessions.insert("queued".to_string(), (FleetSessionState::Queued, None));
        sessions.insert("done".to_string(), (FleetSessionState::Finished, None));
        sessions.insert(
            "exited-ok".to_string(),
            (FleetSessionState::Exited, Some(0)),
        );
        sessions.insert(
            "exited-bad".to_string(),
            (FleetSessionState::Exited, Some(1)),
        );
        sessions.insert(
            "exited-mystery".to_string(),
            (FleetSessionState::Exited, None),
        );

        assert_eq!(ended_how(&sessions, "live"), Ended::No);
        assert_eq!(ended_how(&sessions, "queued"), Ended::No);
        assert_eq!(ended_how(&sessions, "done"), Ended::Succeeded);
        assert_eq!(ended_how(&sessions, "exited-ok"), Ended::Succeeded);
        assert!(matches!(
            ended_how(&sessions, "exited-bad"),
            Ended::Failed(_)
        ));
        assert!(matches!(
            ended_how(&sessions, "exited-mystery"),
            Ended::Failed(_)
        ));
        assert!(matches!(
            ended_how(&sessions, "never-heard-of-it"),
            Ended::Failed(_)
        ));
    }

    /// The format string and the parse must agree; nothing else checks them.
    #[test]
    fn the_commit_log_parse_matches_the_format_it_asks_for() {
        let raw = format!(
            "{sep}abc1234\nknowledge/a.md\nknowledge/b.md\n{sep}def5678\nREADME.md\n",
            sep = GIT_RECORD_SEP
        );
        let parsed = parse_git_log(&raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0, "abc1234");
        assert_eq!(parsed[0].1, vec!["knowledge/a.md", "knowledge/b.md"]);
        assert_eq!(parsed[1].0, "def5678");
        assert_eq!(parsed[1].1, vec!["README.md"]);
        // An empty range is the normal answer for a worker that committed
        // nothing, and must not produce a phantom row.
        assert!(parse_git_log("").is_empty());
        assert!(parse_git_log("\n\n").is_empty());
        // A commit with no files (an empty commit) still counts as one.
        let one = parse_git_log(&format!("{GIT_RECORD_SEP}aaa\n"));
        assert_eq!(one.len(), 1);
        assert!(one[0].1.is_empty());
    }

    /// One planned item whose engine her plan cannot derive an invocation for -
    /// built directly rather than through the DB, because `choose_method` takes
    /// the items and the skills, not a pool to read them from.
    fn blocked_plan_item(engine: CuratorEngine) -> CuratorPlanItem {
        CuratorPlanItem {
            id: uuid::Uuid::new_v4().to_string(),
            plan_run_id: "r1".into(),
            subject_id: "software-engineering/a-subject".into(),
            domain: "software-engineering".into(),
            at: "cat/sub".into(),
            points: 7,
            reasons: Vec::new(),
            dominant_reason: CuratorReasonCode::ExpiredApplication,
            engine,
            techniques: 4,
            applications: 2,
            stacks: Vec::new(),
            demand_known: false,
            demand: None,
            last_swept: None,
            registry_dry_streak: 0,
            suppressed_by_saturation: false,
            has_applied_row: None,
            state: CuratorPlanItemState::Planned,
            declined_reason: None,
            dispatched_run_id: None,
            evidence_ref: None,
            updated_at: "2026-09-26T00:00:00Z".into(),
        }
    }

    // -----------------------------------------------------------------------
    // The method lane
    // -----------------------------------------------------------------------

    /// An impediment shaped like the real one: `forge` documents no invocation.
    fn an_impediment() -> CuratorImpediment {
        CuratorImpediment {
            id: "undocumented_invocation:forge".into(),
            kind: personas_core::models::CuratorImpedimentKind::UndocumentedInvocation,
            engine: CuratorEngine::Forge,
            skill: "forge".into(),
            blocks: 110,
            frees: 0,
            file: Some(".claude/skills/forge/SKILL.md".into()),
            summary: "'forge' documents no invocation".into(),
            self_fixable: true,
            refusal: None,
        }
    }

    /// **The rung's position, asserted as an ordering rather than described.**
    ///
    /// Work she can already do outranks widening what she can do - so a ready
    /// plan item goes first. But the method lane goes ahead of the standing
    /// lane, which is the whole lesson of the eight refill passes that ran
    /// against an already-full queue: between "my plan is dry" and "go and find
    /// more sources" there is "my plan is NOT dry, I cannot spell the command".
    #[test]
    fn the_method_lane_comes_after_her_plan_and_before_the_standing_lane() {
        let pool = init_test_db().unwrap();
        seed_plan(&pool, CuratorEngine::Reconcile, 9, "localization/czech");
        let engines = [CuratorEngine::Reconcile];

        // Her plan first, with a method fix and a standing rung both waiting.
        match choose_work(
            &pool,
            &engines,
            Some(an_impediment()),
            a_rung(Rung::Drain),
            &now(),
        )
        .unwrap()
        {
            Some(Work::Plan(item)) => assert_eq!(item.subject_id, "localization/czech"),
            other => panic!("the plan outranks a method fix: {:?}", other.is_some()),
        }
        // Plan drained: now the method lane, NOT the refill.
        match choose_work(
            &pool,
            &engines,
            Some(an_impediment()),
            a_rung(Rung::Drain),
            &now(),
        )
        .unwrap()
        {
            Some(Work::Method(imp)) => {
                assert_eq!(imp.skill, "forge");
                assert_eq!(imp.blocks, 110);
            }
            other => panic!(
                "a dry plan goes to the method lane before the standing lane: {:?}",
                other.is_some()
            ),
        }
        // And with no method fix available it falls through to the standing
        // lane, exactly as it did before this lane existed.
        match choose_work(&pool, &engines, None, a_rung(Rung::Drain), &now()).unwrap() {
            Some(Work::Standing(s)) => assert_eq!(s.rung, Rung::Drain),
            other => panic!("no fix available falls through: {:?}", other.is_some()),
        }
    }

    /// The lane token is its own, so the audit can tell the most privileged
    /// thing she does from ordinary plan work.
    #[test]
    fn a_method_dispatch_records_its_own_lane() {
        assert_eq!(Work::Method(an_impediment()).lane(), curator_lane::METHOD);
        assert_ne!(Work::Method(an_impediment()).lane(), curator_lane::PLAN);
    }

    /// **Three fail-closed gates**, driven against a real database.
    #[test]
    fn she_will_not_dispatch_a_method_fix_without_a_head_or_twice_against_one() {
        let pool = init_test_db().unwrap();
        let skills = [skill("forge", None), skill("reconcile", Some(false))];
        let items = vec![blocked_plan_item(CuratorEngine::Forge)];

        // No HEAD: a mark that cannot be compared is not a mark, and this is
        // the act not to take while blind.
        assert!(
            choose_method(&pool, &items, &skills, None).is_none(),
            "with no registry HEAD she does nothing"
        );

        // With a HEAD, the fix is offered.
        let chosen = choose_method(&pool, &items, &skills, Some("abc1234"))
            .expect("forge documents nothing and blocks a planned item");
        assert_eq!(chosen.skill, "forge");

        // Once marked against that HEAD, not again - the registry has not moved,
        // so nothing could have changed.
        crate::db::repos::core::settings::set(
            &pool,
            settings_keys::CURATOR_METHOD_MARK,
            &method_mark(&chosen, "abc1234"),
        )
        .unwrap();
        assert!(
            choose_method(&pool, &items, &skills, Some("abc1234")).is_none(),
            "the same fix against an unmoved registry is not dispatched twice"
        );
        // A new commit to the registry - anybody's - lets her look again.
        assert!(
            choose_method(&pool, &items, &skills, Some("def5678")).is_some(),
            "a moved HEAD is reason enough to look again"
        );
    }

    /// **An impediment that is not hers is never dispatched**, however much it
    /// blocks. `apply` blocks the most items in the real plan and its fix is a
    /// change to Personas, which she may not make.
    #[test]
    fn an_impediment_that_is_not_hers_is_never_dispatched_however_large() {
        let pool = init_test_db().unwrap();
        let skills = [skill("intake", Some(false)), skill("conform", Some(false))];
        let mut items = Vec::new();
        for _ in 0..110 {
            items.push(blocked_plan_item(CuratorEngine::Apply));
        }
        for _ in 0..99 {
            items.push(blocked_plan_item(CuratorEngine::Conform));
        }
        assert!(
            choose_method(&pool, &items, &skills, Some("abc1234")).is_none(),
            "209 blocked items, none of them hers to fix"
        );
    }
}
