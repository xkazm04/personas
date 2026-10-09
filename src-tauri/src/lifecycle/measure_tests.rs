use super::*;
use crate::db::models::{LifecycleAuthor, LifecyclePreset};
use crate::db::repos::dev::projects::create_project;
use crate::lifecycle::presets::preset_doc;

fn git_ok(dir: &Path, args: &[&str]) -> bool {
    git(dir, args).is_ok()
}

/// A one-commit repo on `main`, or `None` without git.
fn repo() -> Option<tempfile::TempDir> {
    let dir = tempfile::tempdir().ok()?;
    let p = dir.path();
    for args in [
        &["init", "--initial-branch=main"][..],
        &["config", "user.email", "t@example.com"],
        &["config", "user.name", "T"],
        &["config", "commit.gpgsign", "false"],
    ] {
        if !git_ok(p, args) {
            return None;
        }
    }
    std::fs::write(p.join("README.md"), "hi").ok()?;
    if !git_ok(p, &["add", "README.md"]) || !git_ok(p, &["commit", "-m", "init"]) {
        return None;
    }
    Some(dir)
}

fn cmd(id: &str, command: &str, kind: LifecycleGateKind) -> LifecycleGateCommand {
    LifecycleGateCommand {
        id: id.into(),
        command: command.into(),
        kind,
        budget_ms: None,
    }
}

/// A project at `root` whose gate step runs `gate` and whose tests step runs
/// nothing (an explicit empty list, so nothing is auto-detected).
fn project_with(
    pool: &DbPool,
    root: &Path,
    gate: Vec<LifecycleGateCommand>,
) -> Result<String, AppError> {
    let p = create_project(
        pool,
        "lc-measure",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id;
    let mut doc = preset_doc(LifecyclePreset::Solo);
    for step in doc.steps.iter_mut() {
        match step.id.as_str() {
            "gate" => step.params.commands = Some(gate.clone()),
            "tests" => step.params.commands = Some(Vec::new()),
            _ => {}
        }
    }
    super::super::append(pool, &p, &doc, None, LifecycleAuthor::Operator)?;
    Ok(p)
}

fn ignore_start(_: usize, _: String) {}

/// A run nobody watches, stopped only by `cancel`.
fn quiet(cancel: &CancellationToken) -> RunControl<'_> {
    RunControl {
        cancel,
        on_start: &ignore_start,
    }
}

fn runs_of(pool: &DbPool, project_id: &str, measure_id: &str) -> Vec<LifecycleRun> {
    let mut v = list_runs(
        pool,
        &RunQuery {
            project_id,
            measure_id: Some(measure_id),
            ..Default::default()
        },
    )
    .expect("runs");
    v.reverse(); // oldest first = command order
    v
}

#[tokio::test]
async fn a_measure_records_passed_failed_and_timeout_rows() -> Result<(), AppError> {
    let Some(repo) = repo() else { return Ok(()) };
    let stall = if cfg!(target_os = "windows") {
        "ping -n 4 127.0.0.1 > NUL"
    } else {
        "sleep 3"
    };
    let pool = crate::db::init_test_db()?;
    let p = project_with(
        &pool,
        repo.path(),
        vec![
            cmd("ok", "exit 0", LifecycleGateKind::Lint),
            cmd("bad", "exit 1", LifecycleGateKind::Check),
            cmd("slow", stall, LifecycleGateKind::Other),
        ],
    )?;
    let plan = plan(&pool, &p)?;
    assert_eq!(plan.commands.len(), 3);
    let tip = base_tip(repo.path(), None).expect("tip");
    assert_eq!(plan.head_sha, tip);

    let never = CancellationToken::new();
    let end = run(
        &pool,
        &plan,
        "m-1",
        Some(Duration::from_secs(1)),
        &quiet(&never),
    )
    .await?;
    assert_eq!(end, RunEnd::Completed);
    let rows = runs_of(&pool, &p, "m-1");
    let outcomes: Vec<_> = rows
        .iter()
        .map(|r| (r.command_id.as_str(), r.outcome))
        .collect();
    assert_eq!(
        outcomes,
        vec![
            ("ok", LifecycleRunOutcome::Passed),
            ("bad", LifecycleRunOutcome::Failed),
            ("slow", LifecycleRunOutcome::Timeout),
        ]
    );
    assert_eq!(rows[0].exit_code, Some(0));
    assert_eq!(rows[1].exit_code, Some(1));
    assert!(rows[2].exit_code.is_none());
    assert!(rows.iter().all(|r| r.head_sha == tip));
    assert!(rows.iter().all(|r| r.finished_at >= r.started_at));
    assert!(rows[2].duration_ms >= 900, "timed at the child");
    assert!(rows[0].started_at.ends_with('Z'), "{}", rows[0].started_at);

    // The snapshot reads it back as measured health: the gate is red, and
    // names the failing command.
    let snap = crate::lifecycle::snapshot(&pool, &p)?;
    let gate = snap
        .health
        .iter()
        .find(|h| h.step_id == "gate")
        .expect("gate health");
    assert_eq!(gate.health, crate::db::models::LifecycleHealth::Red);
    assert!(gate
        .reason
        .as_deref()
        .unwrap_or("")
        .starts_with("bad failed"));
    assert_eq!(gate.head_sha.as_deref(), Some(tip.as_str()));
    assert_eq!(snap.health.len(), snap.steps.len());
    assert!(!snap.measuring);
    // (No worktree-count assertion: on Windows the timed-out child's orphaned
    // grandchild can hold the worktree directory open past cleanup.)
    Ok(())
}

#[tokio::test]
async fn a_worktree_that_cannot_be_created_records_did_not_run_never_failed() -> Result<(), AppError>
{
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let gone = dir.path().join("not-a-repo");
    let p = project_with(
        &pool,
        &gone,
        vec![
            cmd("lint", "npm run lint", LifecycleGateKind::Lint),
            cmd("tsc", "npm run tsc", LifecycleGateKind::Typecheck),
        ],
    )?;

    // The tip cannot resolve: every command did not run, with the reason.
    let never = CancellationToken::new();
    let unresolved = plan(&pool, &p)?;
    assert!(unresolved.head_sha.is_empty());
    run(&pool, &unresolved, "m-tip", None, &quiet(&never)).await?;
    let rows = runs_of(&pool, &p, "m-tip");
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|r| r.outcome == LifecycleRunOutcome::DidNotRun && r.exit_code.is_none()));
    assert!(rows[0]
        .first_error
        .as_deref()
        .unwrap_or("")
        .contains("base branch tip"));

    // A tip that resolves but a root that is gone: the worktree add fails.
    let mut forced = unresolved.clone();
    forced.head_sha = "0123456789abcdef".into();
    run(&pool, &forced, "m-wt", None, &quiet(&never)).await?;
    let rows = runs_of(&pool, &p, "m-wt");
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|r| r.outcome == LifecycleRunOutcome::DidNotRun));
    assert!(rows[0]
        .first_error
        .as_deref()
        .unwrap_or("")
        .contains("worktree could not be created"));

    // record_missing never duplicates a recorded command.
    assert_eq!(record_missing(&pool, &forced, "m-wt", "again")?, 0);
    Ok(())
}

fn long_stall() -> &'static str {
    if cfg!(target_os = "windows") {
        "ping -n 30 127.0.0.1 > NUL"
    } else {
        "sleep 30"
    }
}

#[tokio::test]
async fn a_cancel_records_the_running_and_pending_commands_did_not_run() -> Result<(), AppError> {
    let Some(repo) = repo() else { return Ok(()) };
    let pool = crate::db::init_test_db()?;
    let p = project_with(
        &pool,
        repo.path(),
        vec![
            cmd("ok", "exit 0", LifecycleGateKind::Lint),
            cmd("stall", long_stall(), LifecycleGateKind::Check),
            cmd("never", "exit 0", LifecycleGateKind::Other),
        ],
    )?;
    let plan = plan(&pool, &p)?;
    let cancel = CancellationToken::new();
    let starts = Mutex::new(Vec::new());
    // Raised when the stalled command starts; the canceller waits on it.
    let stalled = tokio::sync::Notify::new();
    let on_start = |index: usize, at: String| {
        starts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((index, at));
        if index == 1 {
            stalled.notify_one();
        }
    };
    let control = RunControl {
        cancel: &cancel,
        on_start: &on_start,
    };
    let begun = std::time::Instant::now();
    let canceller = async {
        stalled.notified().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        cancel.cancel();
    };
    let (end, ()) = tokio::join!(run(&pool, &plan, "m-c", None, &control), canceller);
    let end = end?;
    assert_eq!(end, RunEnd::Cancelled);
    assert!(begun.elapsed() < Duration::from_secs(20), "not waited out");
    let starts = starts.into_inner().unwrap_or_else(|e| e.into_inner());
    assert_eq!(
        starts.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert!(starts[0].1.ends_with('Z'));

    // The two cancelled rows share one timestamp, so read them in plan order.
    let rows = runs_of(&pool, &p, "m-c");
    let got: Vec<_> = ["ok", "stall", "never"]
        .iter()
        .filter_map(|id| rows.iter().find(|r| r.command_id == *id))
        .map(|r| (r.command_id.as_str(), r.outcome, r.first_error.as_deref()))
        .collect();
    assert_eq!(rows.len(), 3);
    assert_eq!(
        got,
        vec![
            ("ok", LifecycleRunOutcome::Passed, None),
            (
                "stall",
                LifecycleRunOutcome::DidNotRun,
                Some(CANCELLED_REASON)
            ),
            (
                "never",
                LifecycleRunOutcome::DidNotRun,
                Some(CANCELLED_REASON)
            ),
        ]
    );
    Ok(())
}

#[tokio::test]
async fn a_cancel_before_the_run_records_everything_cancelled() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project_with(
        &pool,
        dir.path(),
        vec![cmd("lint", "npm run lint", LifecycleGateKind::Lint)],
    )?;
    let plan = plan(&pool, &p)?;
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        run(&pool, &plan, "m-pre", None, &quiet(&cancel)).await?,
        RunEnd::Cancelled
    );
    let rows = runs_of(&pool, &p, "m-pre");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].first_error.as_deref(), Some(CANCELLED_REASON));
    Ok(())
}

#[test]
fn nothing_to_measure_is_refused() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project_with(&pool, dir.path(), Vec::new())?;
    assert!(matches!(plan(&pool, &p), Err(AppError::NotFound(_))));
    Ok(())
}

#[test]
fn null_params_fall_back_to_detected_commands_per_step() {
    let dir = tempfile::tempdir().expect("tmp");
    std::fs::write(
        dir.path().join("package.json"),
        r#"{"scripts":{"lint":"eslint","test":"vitest"}}"#,
    )
    .expect("write");
    let mut doc = preset_doc(LifecyclePreset::Solo);
    let cmds = commands_for(&doc, dir.path());
    assert_eq!(
        cmds.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        ["lint", "test"]
    );
    // An explicit gate list replaces detection for the gate step only.
    for step in doc.steps.iter_mut().filter(|s| s.id == "gate") {
        step.params.commands = Some(vec![cmd("tsc", "npx tsc", LifecycleGateKind::Typecheck)]);
    }
    let cmds = commands_for(&doc, dir.path());
    assert_eq!(
        cmds.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        ["tsc", "test"]
    );
}

#[test]
fn timeouts_never_cut_an_over_budget_run_short() {
    let lint = cmd("lint", "x", LifecycleGateKind::Lint);
    assert_eq!(timeout_for(&lint), DEFAULT_TIMEOUT);
    let mut long = cmd("cov", "x", LifecycleGateKind::Coverage);
    long.budget_ms = Some(900_000);
    assert_eq!(timeout_for(&long), Duration::from_secs(1800));
}

/// The ONLY test that takes the process-global slot (tests share a process),
/// so every slot behaviour lives here, in sequence.
#[tokio::test]
async fn the_slot_is_single_flight_observable_cancellable_and_released() -> Result<(), AppError> {
    // Single flight, released on drop.
    let first = MeasureSlot::acquire("slot-a").expect("free");
    assert!(measuring("slot-a"));
    assert!(!measuring("slot-b"));
    assert!(matches!(
        MeasureSlot::acquire("slot-a"),
        Err(AppError::Validation(_))
    ));
    assert!(
        matches!(MeasureSlot::acquire("slot-b"), Err(AppError::Validation(_))),
        "one project at a time, globally"
    );

    // Nothing to show until the plan resolved; then the plan and the running
    // command are visible, and only for the holder's project.
    assert!(active_measure("slot-a").is_none());
    let plan = MeasurePlan {
        project_id: "slot-a".into(),
        root: PathBuf::from("."),
        head_sha: "abc".into(),
        tip_error: None,
        commands: vec![
            cmd("lint", "x", LifecycleGateKind::Lint),
            cmd("tsc", "y", LifecycleGateKind::Typecheck),
        ],
    };
    first.begin(&plan, "m-slot");
    mark_running("m-other", 0, "t0".into());
    let a = active_measure("slot-a").expect("planned");
    assert_eq!(a.measure_id, "m-slot");
    assert_eq!(a.commands.len(), 2);
    assert_eq!(a.running, None, "another measure's start is ignored");
    mark_running("m-slot", 1, "t1".into());
    assert_eq!(
        active_measure("slot-a").and_then(|a| a.running),
        Some((1, "t1".to_string()))
    );
    assert!(active_measure("slot-b").is_none());

    // Cancel: only for the running project, idempotent, visible at once.
    assert!(!cancel("slot-b"));
    assert!(!first.cancel_token().is_cancelled());
    assert!(cancel("slot-a"));
    assert!(cancel("slot-a"));
    assert!(first.cancel_token().is_cancelled());
    assert!(active_measure("slot-a").is_some_and(|a| a.cancel.is_cancelled()));

    drop(first);
    assert!(!measuring("slot-a"));
    assert!(!cancel("slot-a"), "nothing left to cancel");
    let second = MeasureSlot::acquire("slot-b").expect("released");
    assert!(measuring("slot-b"));
    assert!(
        !second.cancel_token().is_cancelled(),
        "a new slot starts uncancelled"
    );
    drop(second);

    // End to end through `start`: cancel a running Measure, the slot is
    // released, every unfinished command is recorded cancelled, and the
    // listeners heard the start, each command start and the release.
    let Some(repo) = repo() else { return Ok(()) };
    let pool = crate::db::init_test_db()?;
    let p = project_with(
        &pool,
        repo.path(),
        vec![
            cmd("ok", "exit 0", LifecycleGateKind::Lint),
            cmd("stall", long_stall(), LifecycleGateKind::Check),
        ],
    )?;
    let heard = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let notify: Arc<dyn Fn() + Send + Sync> = {
        let heard = heard.clone();
        Arc::new(move || {
            heard.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        })
    };
    let started = start(pool.clone(), p.clone(), notify).await?;
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    // Wait until the stalled command runs, then cancel it.
    while active_measure(&p).and_then(|a| a.running).map(|r| r.0) != Some(1) {
        assert!(
            std::time::Instant::now() < deadline,
            "the stall never started"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let snap = crate::lifecycle::snapshot(&pool, &p)?;
    let progress = snap.progress.expect("running measure shows progress");
    assert_eq!(progress.measure_id, started.measure_id);
    assert_eq!(
        progress
            .commands
            .iter()
            .map(|c| c.state)
            .collect::<Vec<_>>(),
        vec![
            crate::db::models::LifecycleCommandState::Done,
            crate::db::models::LifecycleCommandState::Running
        ]
    );
    assert!(cancel(&p));
    while measuring(&p) {
        assert!(
            std::time::Instant::now() < deadline,
            "the cancel never landed"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let rows = runs_of(&pool, &p, &started.measure_id);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].outcome, LifecycleRunOutcome::Passed);
    assert_eq!(rows[1].first_error.as_deref(), Some(CANCELLED_REASON));
    assert!(crate::lifecycle::snapshot(&pool, &p)?.progress.is_none());
    // start, two command starts, release.
    assert!(heard.load(std::sync::atomic::Ordering::SeqCst) >= 4);
    Ok(())
}
