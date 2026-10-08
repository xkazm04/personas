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

    run(&pool, &plan, "m-1", Some(Duration::from_secs(1))).await?;
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
    let unresolved = plan(&pool, &p)?;
    assert!(unresolved.head_sha.is_empty());
    run(&pool, &unresolved, "m-tip", None).await?;
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
    run(&pool, &forced, "m-wt", None).await?;
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

/// The ONLY test that takes the process-global slot (tests share a process).
#[test]
fn the_slot_is_single_flight_and_released_on_drop() {
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
    drop(first);
    assert!(!measuring("slot-a"));
    let second = MeasureSlot::acquire("slot-b").expect("released");
    assert!(measuring("slot-b"));
    drop(second);
}
