//! Measure: run the project's gate / test / coverage commands on the base
//! branch tip in a throwaway worktree, timed, and append one
//! `dev_lifecycle_runs` row per command under a shared `measure_id`.
//!
//! - **The runner is the App Master's**, extracted to
//!   [`personas_engine::gate_exec`]: detached worktree, borrowed environment,
//!   `CI=1`, per-command timeout. Nothing is forked.
//! - **One Measure at a time, process-wide** ([`MeasureSlot`]). That is also
//!   single-flight per project. The commands are whole test suites; two at
//!   once would fight for the CPU and both durations would lie.
//! - **Never `failed` for a command that never answered.** A worktree that
//!   cannot be created, or a base tip that cannot be resolved, records every
//!   command `did_not_run` with the reason; a command killed at its timeout is
//!   `timeout`.
//! - **Who waits.** [`start`] returns at once; a supervisor task owns the
//!   work's `JoinHandle`, and a panic or error becomes a DURABLE row
//!   (`did_not_run` for every command the measure had not recorded yet), then
//!   the slot is released and listeners are told.
//! - After the runs: the docs rot scan for this project (its 6 h throttle
//!   respected), [`super::slow::file_slow_gates`], and
//!   [`super::overseer_after_measure`].
//! - **Live and stoppable.** The slot ([`ActiveMeasure`]) records the plan and
//!   which command runs since when, so the snapshot derives per-command
//!   progress ([`super::progress`]); each command start emits the changed
//!   event. [`cancel`] fires the slot's token: the running child is abandoned
//!   as at a timeout, it and every unrun command are recorded `did_not_run`
//!   ([`CANCELLED_REASON`]), and the follow-ups do not run.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::SecondsFormat;
use personas_engine::gate_exec::{self, CommandExec, ExecCommand, ExecEvent, ExecStatus};
use personas_engine::git_checkpoint::run_git_blocking as git;
use tokio_util::sync::CancellationToken;

use crate::db::models::{
    LifecycleDoc, LifecycleGateCommand, LifecycleGateKind, LifecycleMeasureStarted, LifecycleRun,
    LifecycleRunOutcome,
};
use crate::db::repos::dev::lifecycle_runs::{append_run, list_runs, RunQuery};
use crate::db::repos::dev::projects as project_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::detect_commands::{detect_commands, kinds_of};
use super::health::default_budget_ms;

/// The worktree directory prefix, so a leaked one names its owner.
pub const TEMP_PREFIX: &str = "personas-lifecycle-measure-";
/// The floor of every command's timeout. A command is given twice its budget
/// when that is longer, so an over-budget run is still timed, not killed.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);

// ---------------------------------------------------------------------------
// The process-global slot
// ---------------------------------------------------------------------------

/// The running Measure, as the slot records it. Progress is derived from this
/// plus the `dev_lifecycle_runs` rows already written (see `progress`).
#[derive(Debug, Clone)]
pub struct ActiveMeasure {
    pub project_id: String,
    /// Empty until the plan resolved ([`MeasureSlot::begin`]).
    pub measure_id: String,
    /// When the slot was taken.
    pub started_at: String,
    pub head_sha: String,
    /// The plan's commands, in run order; empty until the plan resolved.
    pub commands: Vec<LifecycleGateCommand>,
    /// The command the runner is executing: its index in `commands` and when
    /// it started.
    pub running: Option<(usize, String)>,
    /// Set by [`cancel`]; the runner checks it before each command and races
    /// it against the running child.
    pub cancel: CancellationToken,
}

/// The running Measure, if any.
///
/// Invariant this lock protects: at most ONE Measure runs in this process.
/// It is in-memory on purpose - no row claims "running", so a crash or a
/// restart can never strand a project as measuring. Poisoning is recoverable
/// (the value is a plain record; every writer leaves it whole).
static ACTIVE: Mutex<Option<ActiveMeasure>> = Mutex::new(None);

fn active() -> std::sync::MutexGuard<'static, Option<ActiveMeasure>> {
    ACTIVE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Is a Measure running for `project_id` right now?
pub fn measuring(project_id: &str) -> bool {
    active()
        .as_ref()
        .is_some_and(|a| a.project_id == project_id)
}

/// The running Measure of `project_id`, once its plan resolved.
pub fn active_measure(project_id: &str) -> Option<ActiveMeasure> {
    active()
        .as_ref()
        .filter(|a| a.project_id == project_id && !a.measure_id.is_empty())
        .cloned()
}

/// Ask the running Measure of `project_id` to stop. `true` when one is
/// running for it (asking twice is still `true`); the slot is released when
/// the runner has recorded every unrun command and cleaned up.
pub fn cancel(project_id: &str) -> bool {
    match active().as_ref().filter(|a| a.project_id == project_id) {
        Some(a) => {
            a.cancel.cancel();
            true
        }
        None => false,
    }
}

/// Record that command `index` of Measure `measure_id` started at `at`. A
/// no-op once that Measure no longer holds the slot.
pub fn mark_running(measure_id: &str, index: usize, at: String) {
    if let Some(a) = active()
        .as_mut()
        .filter(|a| !measure_id.is_empty() && a.measure_id == measure_id)
    {
        a.running = Some((index, at));
    }
}

/// The right to run a Measure. Released on drop - including on unwind.
#[derive(Debug)]
pub struct MeasureSlot {
    project_id: String,
    cancel: CancellationToken,
}

impl MeasureSlot {
    /// Take the slot, or refuse with who holds it.
    pub fn acquire(project_id: &str) -> Result<Self, AppError> {
        let mut slot = active();
        if let Some(holder) = slot.as_ref() {
            return Err(AppError::Validation(if holder.project_id == project_id {
                "a Measure is already running for this project".to_string()
            } else {
                "another project's Measure is running; one runs at a time".to_string()
            }));
        }
        let cancel = CancellationToken::new();
        *slot = Some(ActiveMeasure {
            project_id: project_id.to_string(),
            measure_id: String::new(),
            started_at: rfc3339(chrono::Utc::now()),
            head_sha: String::new(),
            commands: Vec::new(),
            running: None,
            cancel: cancel.clone(),
        });
        Ok(Self {
            project_id: project_id.to_string(),
            cancel,
        })
    }

    /// The plan resolved: record what will run, so progress can be shown.
    pub fn begin(&self, plan: &MeasurePlan, measure_id: &str) {
        if let Some(a) = active()
            .as_mut()
            .filter(|a| a.project_id == self.project_id)
        {
            a.measure_id = measure_id.to_string();
            a.head_sha = plan.head_sha.clone();
            a.commands = plan.commands.clone();
            a.running = None;
        }
    }

    /// The token [`cancel`] fires for this Measure.
    pub fn cancel_token(&self) -> CancellationToken {
        self.cancel.clone()
    }
}

impl Drop for MeasureSlot {
    fn drop(&mut self) {
        let mut slot = active();
        if slot
            .as_ref()
            .is_some_and(|a| a.project_id == self.project_id)
        {
            *slot = None;
        }
    }
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/// What one Measure will run, resolved before anything is spawned.
#[derive(Debug, Clone, PartialEq)]
pub struct MeasurePlan {
    pub project_id: String,
    pub root: PathBuf,
    /// The base branch tip; empty when it could not be resolved.
    pub head_sha: String,
    /// Why `head_sha` is empty.
    pub tip_error: Option<String>,
    pub commands: Vec<LifecycleGateCommand>,
}

/// The commands of the `gate` and `tests` steps: each step's
/// `params.commands`, else what the manifests under `root` say for that
/// step's kinds. A step the document does not have contributes nothing.
pub fn commands_for(doc: &LifecycleDoc, root: &Path) -> Vec<LifecycleGateCommand> {
    let mut detected: Option<Vec<LifecycleGateCommand>> = None;
    let mut out = Vec::new();
    for step_id in ["gate", "tests"] {
        let Some(step) = doc.steps.iter().find(|s| s.id == step_id) else {
            continue;
        };
        match &step.params.commands {
            Some(cmds) => out.extend(cmds.iter().cloned()),
            None => {
                let all = detected.get_or_insert_with(|| detect_commands(root));
                out.extend(
                    all.iter()
                        .filter(|c| kinds_of(step_id).contains(&c.kind))
                        .cloned(),
                );
            }
        }
    }
    out
}

/// Resolve the project's root, base tip and command list. Reads files and
/// runs git: call it off the IPC thread.
pub fn plan(pool: &DbPool, project_id: &str) -> Result<MeasurePlan, AppError> {
    let project = project_repo::get_project_by_id(pool, project_id)?;
    let (doc, _, _) = super::current_doc(pool, project_id)?;
    let root = PathBuf::from(&project.root_path);
    let commands = commands_for(&doc, &root);
    // Not caller input: the project has no command to run, configured or
    // detected, so the refusal names what was not found.
    if commands.is_empty() {
        return Err(AppError::NotFound(
            "nothing to measure: no gate or test commands are configured, and none were \
             detected in package.json or Cargo.toml"
                .into(),
        ));
    }
    let (head_sha, tip_error) = match base_tip(&root, project.main_branch.as_deref()) {
        Ok(sha) => (sha, None),
        Err(e) => (String::new(), Some(e)),
    };
    Ok(MeasurePlan {
        project_id: project_id.to_string(),
        root,
        head_sha,
        tip_error,
        commands,
    })
}

/// The base branch's tip sha.
pub fn base_tip(root: &Path, recorded: Option<&str>) -> Result<String, String> {
    let base = super::evidence::resolve_base(root, recorded)
        .ok_or_else(|| format!("no base branch resolves in {}", root.display()))?;
    branch_tip(root, &base)
}

/// The tip sha of an already-resolved branch `base` (one `git rev-parse`).
pub fn branch_tip(root: &Path, base: &str) -> Result<String, String> {
    let sha = git(root, &["rev-parse", &format!("refs/heads/{base}")])?;
    let sha = sha.trim().to_string();
    if sha.is_empty() {
        return Err(format!("the base branch {base} has no tip"));
    }
    Ok(sha)
}

/// Commits reachable from `tip` but not from `since` (one `git rev-list
/// --count`). `None` when git cannot say (e.g. `since` left the history), and
/// when `tip` is not ahead of a different `since` (a rewound base): a count of
/// 0 there would read as "fresh" while the shas disagree.
pub fn commits_since(root: &Path, since: &str, tip: &str) -> Option<u32> {
    if since == tip {
        return Some(0);
    }
    let out = git(root, &["rev-list", "--count", &format!("{since}..{tip}")]).ok()?;
    out.trim().parse::<u32>().ok().filter(|&n| n > 0)
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

fn rfc3339(t: chrono::DateTime<chrono::Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn timeout_for(cmd: &LifecycleGateCommand) -> Duration {
    let budget = cmd.budget_ms.unwrap_or_else(|| default_budget_ms(cmd.kind));
    DEFAULT_TIMEOUT.max(Duration::from_millis(u64::from(budget) * 2))
}

fn row_from_exec(
    plan: &MeasurePlan,
    measure_id: &str,
    cmd: &LifecycleGateCommand,
    exec: &CommandExec,
) -> LifecycleRun {
    let outcome = match exec.status {
        ExecStatus::Passed => LifecycleRunOutcome::Passed,
        ExecStatus::Failed => LifecycleRunOutcome::Failed,
        ExecStatus::TimedOut => LifecycleRunOutcome::Timeout,
        ExecStatus::DidNotRun => LifecycleRunOutcome::DidNotRun,
    };
    // A coverage figure is read from a coverage command's own output with the
    // KPI evaluator's parser - pass or fail (a threshold miss exits non-zero
    // and still prints the number).
    let value_pct = (cmd.kind == LifecycleGateKind::Coverage)
        .then(|| crate::engine::kpi_eval::parse_value(&exec.output_tail, "coverage_pct"))
        .flatten();
    LifecycleRun {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: plan.project_id.clone(),
        measure_id: measure_id.to_string(),
        command_id: cmd.id.clone(),
        command: cmd.command.clone(),
        kind: cmd.kind,
        outcome,
        exit_code: exec.exit_code,
        duration_ms: u32::try_from(exec.duration_ms).unwrap_or(u32::MAX),
        value_pct,
        first_error: exec.first_error.clone(),
        head_sha: plan.head_sha.clone(),
        started_at: rfc3339(exec.started_at),
        finished_at: rfc3339(exec.finished_at),
    }
}

/// Record `did_not_run` with `reason` for every planned command this measure
/// has no row for yet. The durable answer for every path that could not run.
pub fn record_missing(
    pool: &DbPool,
    plan: &MeasurePlan,
    measure_id: &str,
    reason: &str,
) -> Result<usize, AppError> {
    let recorded: Vec<String> = list_runs(
        pool,
        &RunQuery {
            project_id: &plan.project_id,
            measure_id: Some(measure_id),
            ..Default::default()
        },
    )?
    .into_iter()
    .map(|r| r.command_id)
    .collect();
    let now = rfc3339(chrono::Utc::now());
    let mut written = 0;
    for cmd in plan.commands.iter().filter(|c| !recorded.contains(&c.id)) {
        append_run(
            pool,
            &LifecycleRun {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: plan.project_id.clone(),
                measure_id: measure_id.to_string(),
                command_id: cmd.id.clone(),
                command: cmd.command.clone(),
                kind: cmd.kind,
                outcome: LifecycleRunOutcome::DidNotRun,
                exit_code: None,
                duration_ms: 0,
                value_pct: None,
                first_error: Some(reason.to_string()),
                head_sha: plan.head_sha.clone(),
                started_at: now.clone(),
                finished_at: now.clone(),
            },
        )?;
        written += 1;
    }
    Ok(written)
}

/// The `first_error` of every command a cancelled Measure did not finish.
pub const CANCELLED_REASON: &str = "cancelled by the operator";

/// How a [`run`] ended. A cancelled Measure skips its follow-ups.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnd {
    /// Every command has a row (some may be `did_not_run`).
    Completed,
    /// Stopped by [`cancel`]: the abandoned command and every one after it
    /// are recorded `did_not_run` with [`CANCELLED_REASON`].
    Cancelled,
}

/// What a [`run`] is steered and observed by.
pub struct RunControl<'a> {
    /// Stops the run (see [`RunEnd::Cancelled`]).
    pub cancel: &'a CancellationToken,
    /// Called as command `index` (plan order) starts, with the start time.
    pub on_start: &'a (dyn Fn(usize, String) + Send + Sync),
}

/// Run the plan and append its rows. `timeout` overrides every command's
/// timeout (tests); `None` is [`DEFAULT_TIMEOUT`] or twice the budget.
pub async fn run(
    pool: &DbPool,
    plan: &MeasurePlan,
    measure_id: &str,
    timeout: Option<Duration>,
    control: &RunControl<'_>,
) -> Result<RunEnd, AppError> {
    if control.cancel.is_cancelled() {
        record_missing(pool, plan, measure_id, CANCELLED_REASON)?;
        return Ok(RunEnd::Cancelled);
    }
    if plan.head_sha.is_empty() {
        let reason = format!(
            "could not resolve the base branch tip: {}",
            plan.tip_error.as_deref().unwrap_or("unknown")
        );
        record_missing(pool, plan, measure_id, &reason)?;
        return Ok(RunEnd::Completed);
    }
    let exec_plan: Vec<ExecCommand> = plan
        .commands
        .iter()
        .map(|c| ExecCommand {
            command: c.command.clone(),
            timeout: timeout.unwrap_or_else(|| timeout_for(c)),
        })
        .collect();
    let mut write_error: Option<AppError> = None;
    let executed = gate_exec::exec_in_worktree_with(
        &plan.root,
        &plan.head_sha,
        &exec_plan,
        TEMP_PREFIX,
        control.cancel,
        |event| match event {
            ExecEvent::Started { index, at } => (control.on_start)(index, rfc3339(at)),
            ExecEvent::Finished { index, exec } => {
                if let Some(cmd) = plan.commands.get(index) {
                    if let Err(e) = append_run(pool, &row_from_exec(plan, measure_id, cmd, exec)) {
                        tracing::warn!(project_id = %plan.project_id, error = %e,
                            "lifecycle measure: could not record a run");
                        write_error.get_or_insert(e);
                    }
                }
            }
        },
    )
    .await;
    let end = match executed {
        Ok(done) if done.cancelled => {
            record_missing(pool, plan, measure_id, CANCELLED_REASON)?;
            RunEnd::Cancelled
        }
        Ok(_) => RunEnd::Completed,
        Err(reason) => {
            record_missing(
                pool,
                plan,
                measure_id,
                &format!("the measure worktree could not be created: {reason}"),
            )?;
            RunEnd::Completed
        }
    };
    match write_error {
        Some(e) => Err(e),
        None => Ok(end),
    }
}

/// The follow-ups after the runs landed. Each is logged and never fatal: the
/// readings are already durable.
pub fn after_measure(pool: &DbPool, plan: &MeasurePlan) {
    let root = plan.root.to_string_lossy();
    if let Err(e) = crate::commands::infrastructure::doc_rot::scan_project_docs(
        pool,
        &plan.project_id,
        &root,
        false,
    ) {
        tracing::warn!(project_id = %plan.project_id, error = %e,
            "lifecycle measure: the docs rot scan failed");
    }
    if let Err(e) = super::slow::file_slow_gates(pool, &plan.project_id, &plan.root, &plan.commands)
    {
        tracing::warn!(project_id = %plan.project_id, error = %e,
            "lifecycle measure: filing slow gates failed");
    }
    if let Err(e) = super::overseer_after_measure(pool, &plan.project_id) {
        tracing::warn!(project_id = %plan.project_id, error = %e,
            "lifecycle measure: the Overseer follow-up failed");
    }
}

/// The `notify` [`start`] wants, for a caller holding an `AppHandle`: emits
/// `DEV_TOOLS_LIFECYCLE_CHANGED` with the same `CdcEvent` payload shape the
/// CDC arm sends for a `dev_lifecycle_runs` write, so listeners need no
/// second shape. Used for the moments no row marks: start, each command
/// start, a cancel request, and release.
pub fn emitter(app: tauri::AppHandle) -> Arc<dyn Fn() + Send + Sync> {
    use tauri::Emitter;
    Arc::new(move || {
        let payload = crate::db::cdc::CdcEvent {
            action: crate::db::cdc::CdcAction::Update,
            table: "dev_lifecycle_runs".to_string(),
            rowid: 0,
        };
        if let Err(e) = app.emit(
            personas_core::events::event_name::DEV_TOOLS_LIFECYCLE_CHANGED,
            &payload,
        ) {
            tracing::warn!(error = %e, "lifecycle measure: could not emit the changed event");
        }
    })
}

/// Start a Measure in the background and return its id at once. `notify` is
/// called when it starts (so `measuring: true` shows) and after it ended and
/// released the slot. Refuses (`Validation`) while any Measure runs.
pub async fn start(
    pool: DbPool,
    project_id: String,
    notify: Arc<dyn Fn() + Send + Sync>,
) -> Result<LifecycleMeasureStarted, AppError> {
    let slot = MeasureSlot::acquire(&project_id)?;
    let plan = {
        let pool = pool.clone();
        let pid = project_id.clone();
        tokio::task::spawn_blocking(move || plan(&pool, &pid))
            .await
            .map_err(|e| AppError::Internal(format!("lifecycle measure plan: {e}")))??
    };
    let measure_id = uuid::Uuid::new_v4().to_string();
    slot.begin(&plan, &measure_id);
    notify();
    // Nobody waits on the supervisor: it IS the boundary. It owns the work's
    // handle and turns every way the work can end into rows and an event.
    tokio::spawn(supervise(pool, plan, measure_id.clone(), slot, notify));
    Ok(LifecycleMeasureStarted { measure_id })
}

async fn supervise(
    pool: DbPool,
    plan: MeasurePlan,
    measure_id: String,
    slot: MeasureSlot,
    notify: Arc<dyn Fn() + Send + Sync>,
) {
    let work = {
        let (pool, plan, measure_id) = (pool.clone(), plan.clone(), measure_id.clone());
        let cancel = slot.cancel_token();
        let notify = notify.clone();
        tokio::spawn(async move {
            // Each command start moves the running row; no ledger row marks
            // it, so listeners are told here (each finished row rides CDC).
            let on_start = |index: usize, at: String| {
                mark_running(&measure_id, index, at);
                notify();
            };
            let control = RunControl {
                cancel: &cancel,
                on_start: &on_start,
            };
            if run(&pool, &plan, &measure_id, None, &control).await? == RunEnd::Cancelled {
                return Ok(());
            }
            tokio::task::spawn_blocking(move || after_measure(&pool, &plan))
                .await
                .map_err(|e| AppError::Internal(format!("lifecycle measure follow-up: {e}")))
        })
    };
    let failure = match work.await {
        Ok(Ok(())) => None,
        Ok(Err(e)) => Some(format!("the measure stopped: {e}")),
        Err(join) if join.is_panic() => Some(format!(
            "the measure panicked: {}",
            personas_core::utils::extract_panic_message(join.into_panic())
        )),
        Err(join) => Some(format!("the measure was cancelled: {join}")),
    };
    if let Some(reason) = failure {
        tracing::error!(project_id = %plan.project_id, measure_id = %measure_id, %reason,
            "lifecycle measure ended abnormally");
        let p = pool.clone();
        let (pl, mid) = (plan.clone(), measure_id.clone());
        let durable =
            tokio::task::spawn_blocking(move || record_missing(&p, &pl, &mid, &reason)).await;
        if !matches!(durable, Ok(Ok(_))) {
            tracing::error!(project_id = %plan.project_id, measure_id = %measure_id,
                "lifecycle measure: could not record the abnormal end");
        }
    }
    drop(slot);
    notify();
}

#[cfg(test)]
#[path = "measure_tests.rs"]
mod tests;
