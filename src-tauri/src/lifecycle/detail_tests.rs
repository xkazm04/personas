use super::*;
use crate::db::models::{
    LifecycleAuthor, LifecycleGateKind as K, LifecycleOutcome, LifecyclePreset, LifecycleRun,
    LifecycleRunOutcome, LifecycleStepOutcome,
};
use crate::db::repos::dev::lifecycle::upsert_task_evidence;
use crate::db::repos::dev::projects::create_project;
use crate::lifecycle::presets::preset_doc;

fn project(pool: &DbPool, root: &Path) -> Result<String, AppError> {
    Ok(create_project(
        pool,
        "lc-detail",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id)
}

fn run(project_id: &str, n: usize, command_id: &str, kind: K) -> LifecycleRun {
    // Minutes past a fixed hour, so `n` orders the runs.
    let at = format!("2026-10-08T{:02}:{:02}:00.000Z", 10 + n / 60, n % 60);
    LifecycleRun {
        id: format!("{command_id}-{n}"),
        project_id: project_id.to_string(),
        measure_id: format!("m{n}"),
        command_id: command_id.to_string(),
        command: format!("npm run {command_id}"),
        kind,
        outcome: LifecycleRunOutcome::Passed,
        exit_code: Some(0),
        duration_ms: 10,
        value_pct: None,
        first_error: None,
        head_sha: "abc".into(),
        started_at: at.clone(),
        finished_at: at,
    }
}

#[test]
fn step_detail_caps_runs_per_command_not_in_total() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    // `tsc` ran once, first; `lint` ran 35 times after it.
    runs_repo::append_run(&pool, &run(&p, 0, "tsc", K::Typecheck))?;
    for n in 1..=35 {
        runs_repo::append_run(&pool, &run(&p, n, "lint", K::Lint))?;
    }
    runs_repo::append_run(&pool, &run(&p, 36, "test", K::Test))?;

    let gate = step_detail(&pool, &p, "gate")?;
    let lint: Vec<&LifecycleRun> = gate
        .runs
        .iter()
        .filter(|r| r.command_id == "lint")
        .collect();
    assert_eq!(lint.len(), STEP_DETAIL_RUNS);
    assert_eq!(lint[0].id, "lint-35", "newest first");
    assert_eq!(lint[STEP_DETAIL_RUNS - 1].id, "lint-6");
    assert_eq!(
        gate.runs.last().map(|r| r.id.as_str()),
        Some("tsc-0"),
        "the rarely-run command is not crowded out"
    );
    assert_eq!(gate.runs.len(), STEP_DETAIL_RUNS + 1);
    assert!(gate
        .runs
        .windows(2)
        .all(|w| w[0].finished_at >= w[1].finished_at));
    assert_eq!(step_detail(&pool, &p, "tests")?.runs.len(), 1);
    Ok(())
}

fn outcome(step_id: &str, outcome: LifecycleOutcome) -> LifecycleStepOutcome {
    LifecycleStepOutcome {
        step_id: step_id.to_string(),
        outcome,
        detail: None,
    }
}

#[test]
fn step_evidence_is_the_steps_own_newest_first_and_bounded() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    // Not a git repo: the evidence is the stored tasks only.
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    for n in 0..210 {
        // Every 10th task carries no `gate` outcome.
        let mut outcomes = vec![outcome("commit", LifecycleOutcome::Done)];
        if n % 10 != 0 {
            outcomes.push(outcome("gate", LifecycleOutcome::Skipped));
        }
        let json = serde_json::to_string(&outcomes)
            .map_err(|e| AppError::Internal(format!("serialize: {e}")))?;
        let at = format!("2026-10-{:02}T{:02}:00:00Z", 1 + n / 24, n % 24);
        upsert_task_evidence(&pool, &p, &format!("task-{n:03}"), "t", &json, &at)?;
    }

    let gate = step_detail(&pool, &p, "gate")?.evidence;
    // The newest 200 changes, minus the 20 among them with no gate outcome.
    assert_eq!(gate.len(), 180);
    assert_eq!(gate[0].source_ref, "task-209");
    assert!(gate
        .windows(2)
        .all(|w| w[0].occurred_at >= w[1].occurred_at));
    assert!(gate
        .iter()
        .all(|i| i.outcomes.len() == 1 && i.outcomes[0].step_id == "gate"));
    assert!(gate.iter().all(|i| i.source_ref.as_str() >= "task-010"));
    let commit = step_detail(&pool, &p, "commit")?.evidence;
    assert_eq!(commit.len(), STEP_DETAIL_EVIDENCE);
    assert!(step_detail(&pool, &p, "frame")?.evidence.is_empty());
    Ok(())
}

#[test]
fn project_step_keeps_only_that_steps_outcome() {
    let item = LifecycleEvidenceItem {
        source_kind: crate::db::models::LifecycleSourceKind::Commit,
        source_ref: "abc".into(),
        title: "t".into(),
        occurred_at: "2026-10-08T00:00:00Z".into(),
        outcomes: vec![
            outcome("gate", LifecycleOutcome::Done),
            outcome("docs", LifecycleOutcome::Skipped),
        ],
    };
    let docs = project_step(item.clone(), "docs").expect("docs outcome");
    assert_eq!(
        docs.outcomes,
        vec![outcome("docs", LifecycleOutcome::Skipped)]
    );
    assert!(project_step(item, "land").is_none());
}

#[test]
fn run_output_answers_only_for_the_owning_project() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let (a, b) = (tempfile::tempdir()?, tempfile::tempdir()?);
    let p = project(&pool, a.path())?;
    let other = project(&pool, b.path())?;
    let failed = run(&p, 1, "lint", K::Lint);
    runs_repo::append_run_with_output(&pool, &failed, Some("--- stderr ---\nerror TS2322"))?;
    let unrun = run(&p, 2, "tsc", K::Typecheck);
    runs_repo::append_run(&pool, &unrun)?;

    assert_eq!(
        run_output(&pool, &p, &failed.id)?.as_deref(),
        Some("--- stderr ---\nerror TS2322")
    );
    assert_eq!(run_output(&pool, &p, &unrun.id)?, None);
    assert!(matches!(
        run_output(&pool, &other, &failed.id),
        Err(AppError::NotFound(_))
    ));
    Ok(())
}

#[test]
fn detected_commands_ignore_the_configured_ones() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    std::fs::write(
        dir.path().join("package.json"),
        r#"{"scripts":{"lint":"eslint .","test":"vitest run"}}"#,
    )?;
    std::fs::write(
        dir.path().join("Cargo.toml"),
        "[package]\nname = \"x\"\nversion = \"0.1.0\"\n",
    )?;
    let p = project(&pool, dir.path())?;
    // The gate step is configured to run something else entirely.
    let mut doc = preset_doc(LifecyclePreset::Solo);
    if let Some(gate) = doc.steps.iter_mut().find(|s| s.id == "gate") {
        gate.params.commands = Some(vec![LifecycleGateCommand {
            id: "custom".into(),
            command: "make check".into(),
            kind: K::Check,
            budget_ms: None,
        }]);
    }
    super::super::append(&pool, &p, &doc, None, LifecycleAuthor::Operator)?;

    let found: Vec<(String, String, K)> = detected_commands(&pool, &p)?
        .into_iter()
        .map(|c| (c.id, c.command, c.kind))
        .collect();
    assert_eq!(
        found,
        vec![
            ("lint".into(), "npm run lint".into(), K::Lint),
            ("cargo-clippy".into(), "cargo clippy".into(), K::Lint),
            ("test".into(), "npm run test".into(), K::Test),
            ("cargo-test".into(), "cargo test".into(), K::Test),
        ]
    );
    let empty = tempfile::tempdir()?;
    let bare = project(&pool, empty.path())?;
    assert!(detected_commands(&pool, &bare)?.is_empty());
    assert!(matches!(
        detected_commands(&pool, "no-such-project"),
        Err(AppError::NotFound(_))
    ));
    Ok(())
}
