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
//! With both lanes empty she does not stop: she dispatches `/harvest research`,
//! the registry's own refill pass, which by its file's design cannot come back
//! empty-handed. So **nothing in this loop ever reaches a natural resting
//! point**, and `curator_daily_budget_usd`, `curator_daily_run_cap`,
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

use personas_core::models::{
    curator_lane, CuratorEngine, CuratorPlanItem, CuratorPlanItemState, CuratorPolicy,
    CuratorRequest, CuratorRequestState, CuratorSkill, CURATOR_SPEND_SOURCE,
};

use crate::commands::fleet::queue::{self, DispatchOrigin, DispatchRequest};
use crate::commands::fleet::registry::is_live_state;
use crate::commands::fleet::types::{FleetSessionMode, FleetSessionState};
use crate::db::repos::curator as repo;
use crate::db::DbPool;
use crate::engine::subscription::ReactiveSubscription;
use crate::error::AppError;

use super::dispatch::{self, Brief};
use super::{instrument, sleep};

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
        return;
    }
    let root = match super::registry_root_of(pool) {
        Ok(root) => root,
        Err(err) => {
            warn_occasionally(&format!("curator loop: {err}"));
            return;
        }
    };

    settle_ended(pool, &root).await;
    maybe_dispatch(app, pool, &root).await;
    // **Outside `maybe_dispatch`, and that is the bug this shape exists to
    // avoid.** Every reason not to START work - a spent budget, quiet hours, a
    // full worker pool - is a reason her plan will sit un-reconciled, which is
    // exactly when the plan drifts furthest from the corpus. The reconcile
    // reads and projects; it dispatches nothing, so no brake applies to it. It
    // runs last so a pass that is actually due (at most hourly) delays the
    // dispatch of work rather than the other way round.
    sleep::maybe_reconcile(pool, &root).await;
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
    if let Some(why) = super::halted_reason(&brakes, &policy) {
        warn_occasionally(&format!("curator loop: halted - {why}"));
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
        let chosen = match choose_work(pool, &engines, !refill_in_flight(), &now) {
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
    /// The refill pass. Claims nothing, because there is no row to claim -
    /// the corpus's coverage gaps are the queue.
    Refill,
}

impl Work {
    pub(super) fn lane(&self) -> &'static str {
        match self {
            Work::Queue(_) => curator_lane::QUEUE,
            Work::Plan(_) => curator_lane::PLAN,
            Work::Refill => curator_lane::REFILL,
        }
    }
}

/// **The lane order.** The operator's queue, then her plan, then the refill.
///
/// Separated from the dispatch so it can be driven against a real database in a
/// test with no Tauri app: the ordering is the operator's own rule and the only
/// way to prove it is to seed both lanes and watch which one drains.
///
/// `refill_available` is false while one refill is already in flight. That is
/// not a fairness rule - it is `harvest`'s own law ("Never let a miner or
/// research agent write to the tree; single writer, always"): two refill passes
/// in one checkout would both grade and append to the same queue file.
pub(super) fn choose_work(
    pool: &DbPool,
    engines: &[CuratorEngine],
    refill_available: bool,
    now: &str,
) -> Result<Option<Work>, AppError> {
    if let Some(request) = repo::claim_next_queued(pool, None, now)? {
        return Ok(Some(Work::Queue(request)));
    }
    if let Some(item) = repo::claim_next_plan_item(pool, engines, now)? {
        return Ok(Some(Work::Plan(item)));
    }
    Ok(refill_available.then_some(Work::Refill))
}

/// Whether a refill pass is already running or waiting.
///
/// Keyed on the dispatched ARGV rather than on a name: the fleet's naming lane
/// rewrites display names (collision discriminators, project labels), while the
/// args are exactly what this module put there.
pub(super) fn refill_in_flight() -> bool {
    let marker = format!("/{} {}", dispatch::REFILL_SKILL, dispatch::REFILL_ARGUMENT);
    crate::commands::fleet::registry::registry()
        .list_dto()
        .into_iter()
        .any(|s| {
            s.origin.as_deref() == Some(DispatchOrigin::Curator.token())
                && (matches!(s.state, FleetSessionState::Queued) || is_live_state(s.state))
                && s.args.iter().any(|a| a.starts_with(&marker))
        })
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

    let (skill, argument, note, subject, finding) = match &work {
        Work::Queue(request) => (
            request.skill.clone(),
            request.argument.clone(),
            request.note.clone(),
            None,
            None,
        ),
        Work::Plan(item) => {
            let Some((skill, argument)) = dispatch::plan_invocation(item) else {
                // Unreachable while `claimable_engines` and `plan_invocation`
                // agree (their test asserts exactly that), but the item is
                // already claimed, so the arm settles rather than returning.
                repo::settle_plan_item(
                    pool,
                    &item.id,
                    CuratorPlanItemState::Blocked,
                    "this app could not derive an invocation for the engine that answers this \
                     finding, so nothing was dispatched",
                    &now,
                )?;
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
            )
        }
        Work::Refill => (
            dispatch::REFILL_SKILL.to_string(),
            Some(dispatch::REFILL_ARGUMENT.to_string()),
            None,
            None,
            None,
        ),
    };

    // The operator's lane was vetted when the request was filed; the registry
    // can have moved since, and HER lanes are vetted by the stricter rule that
    // refuses an undocumented invocation outright.
    let vetted = match &work {
        Work::Queue(_) => super::vet_request(skills, &skill, argument.as_deref()),
        Work::Plan(_) | Work::Refill => {
            dispatch::vet_autonomous(skills, &skill, argument.as_deref())
        }
    };
    if let Err(err) = vetted {
        settle_unstarted(pool, &work, &err.to_string(), &now)?;
        return Err(err);
    }

    let prompt = dispatch::compose(&Brief {
        lane,
        skill: &skill,
        argument: argument.as_deref(),
        note: note.as_deref(),
        subject: subject.as_deref(),
        finding: finding.as_deref(),
        head,
    });

    let admission = queue::admit(
        app,
        DispatchRequest {
            cwd: root.to_string_lossy().into_owned(),
            name: Some(format!("curator-{lane}")),
            title: Some(match argument.as_deref() {
                Some(arg) => format!("/{skill} {arg}"),
                None => format!("/{skill}"),
            }),
            args: queue::headless_args(&prompt, Vec::new()),
            // Headless, not a PTY. An interactive session parks in `Idle` when
            // its turn ends and `Idle` is a LIVE state, so two of them would
            // hold her whole worker cap until a person closed them; a headless
            // worker exits, and the slot comes back on its own. It is also
            // what the tree's two other unattended dispatchers use.
            mode: FleetSessionMode::Headless,
            run_label: crate::commands::fleet::run::current_run_label(),
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

    let session_id = admission.session_id;
    let level = dispatch::authorising_level(policy, &skill);
    let dispatch_id = uuid::Uuid::new_v4().to_string();
    let (request_id, plan_item_id) = match &work {
        Work::Queue(request) => (Some(request.id.clone()), None),
        Work::Plan(item) => (None, Some(item.id.clone())),
        Work::Refill => (None, None),
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
        Work::Queue(request) => repo::bind_request_session(pool, &request.id, &session_id)?,
        Work::Plan(item) => repo::bind_plan_item_session(pool, &item.id, &session_id)?,
        Work::Refill => {}
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
            repo::settle_plan_item(
                pool,
                &item.id,
                CuratorPlanItemState::Blocked,
                &format!("no worker started: {why}"),
                now,
            )?;
        }
        // Nothing was claimed, so there is nothing to write back.
        Work::Refill => {}
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
async fn settle_ended(pool: &DbPool, root: &Path) {
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
            repo::settle_plan_item(
                pool,
                item_id,
                CuratorPlanItemState::Blocked,
                &format!(
                    "session {} ended without landing: {why}",
                    dispatched.session_id
                ),
                now,
            )?;
        }
    }
    Ok(())
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
// Logging
// ---------------------------------------------------------------------------

/// Log at most once a minute, whatever the tick rate.
///
/// She is halted far more often than she runs - the switch ships OFF - and a
/// loop that logged "switched off" every sixty seconds would bury everything
/// else in the file. The gate is on the CLOCK rather than on the message, so a
/// halt reason that changes still waits its turn; the runtime door reports the
/// current reason at any moment, which is where a surface reads it from.
fn warn_occasionally(message: &str) {
    static LAST_MS: AtomicU64 = AtomicU64::new(0);
    const EVERY_MS: u64 = 60_000;
    let now = crate::commands::fleet::registry::now_ms().max(0) as u64;
    let last = LAST_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < EVERY_MS {
        return;
    }
    LAST_MS.store(now, Ordering::Relaxed);
    tracing::info!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_core::models::{CuratorReasonCode, CuratorSkillLane};
    use personas_db::init_test_db;

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
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
        }
    }

    /// **The operator's rule.** With work waiting in both lanes, the human lane
    /// drains completely before her own plan is touched - and he accepted the
    /// named consequence, so this asserts the starvation rather than a fairness
    /// rule nobody asked for.
    #[test]
    fn the_human_lane_drains_before_her_plan_and_then_the_refill() {
        let pool = init_test_db().unwrap();
        seed_plan(&pool, CuratorEngine::Reconcile, 9, "localization/czech");
        repo::create_request(&pool, "r1", "hygiene", None, Some("first"), &now()).unwrap();
        repo::create_request(&pool, "r2", "librarian", None, None, &now()).unwrap();
        let engines = [CuratorEngine::Reconcile];

        // Both operator requests go before the plan item, oldest first, even
        // though the plan item scores and is ready.
        match choose_work(&pool, &engines, true, &now()).unwrap() {
            Some(Work::Queue(r)) => assert_eq!(r.id, "r1"),
            other => panic!("the oldest request must go first: {:?}", other.is_some()),
        }
        match choose_work(&pool, &engines, true, &now()).unwrap() {
            Some(Work::Queue(r)) => assert_eq!(r.id, "r2"),
            other => panic!("the human lane drains WHOLE: {:?}", other.is_some()),
        }
        // Only now does her own plan get a hearing.
        match choose_work(&pool, &engines, true, &now()).unwrap() {
            Some(Work::Plan(item)) => assert_eq!(item.subject_id, "localization/czech"),
            other => panic!("the plan comes after the queue: {:?}", other.is_some()),
        }
        // And with both lanes drained she does NOT stop.
        assert!(
            matches!(
                choose_work(&pool, &engines, true, &now()).unwrap(),
                Some(Work::Refill)
            ),
            "a drained pair dispatches the refill rather than idling"
        );
    }

    /// The refill is the only lane with no row to claim, so it is the only one
    /// that can repeat. One at a time, for `harvest`'s own single-writer law.
    #[test]
    fn a_refill_already_in_flight_is_not_started_twice() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            choose_work(&pool, &[], true, &now()).unwrap(),
            Some(Work::Refill)
        ));
        assert!(
            choose_work(&pool, &[], false, &now()).unwrap().is_none(),
            "a second refill into the same checkout would race the first's writer"
        );
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
                choose_work(&pool, &engines, true, &now()).unwrap(),
                Some(Work::Refill)
            ),
            "she goes to the refill rather than guessing a /deepen command"
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
                choose_work(&pool, &[CuratorEngine::Reconcile], true, &now()).unwrap(),
                Some(Work::Refill)
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
}
