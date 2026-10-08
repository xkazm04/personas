use super::*;
use crate::db::models::LifecycleGateKind;
use crate::db::repos::dev::lifecycle_runs::append_run;
use crate::db::repos::dev::projects::create_project;

fn run(n: u32, ms: u32, outcome: LifecycleRunOutcome) -> LifecycleRun {
    LifecycleRun {
        id: format!("r{n}"),
        project_id: String::new(),
        measure_id: format!("m{n:03}"),
        command_id: "tsc".into(),
        command: "npm run tsc".into(),
        kind: LifecycleGateKind::Typecheck,
        outcome,
        exit_code: Some(0),
        duration_ms: ms,
        value_pct: None,
        first_error: None,
        head_sha: "abc".into(),
        started_at: format!("2026-10-01T00:{:02}:00.000Z", n),
        finished_at: format!("2026-10-01T00:{:02}:30.000Z", n),
    }
}

/// `durations` oldest first; returned newest first, as the repo returns them.
fn history(durations: &[u32]) -> Vec<LifecycleRun> {
    let mut v: Vec<_> = durations
        .iter()
        .enumerate()
        .map(|(i, ms)| run(i as u32, *ms, LifecycleRunOutcome::Passed))
        .collect();
    v.reverse();
    v
}

#[test]
fn the_latest_answered_run_over_budget_is_a_finding() {
    let runs = history(&[10_000, 74_000]);
    match judge(&runs, 60_000) {
        Some(SlowFinding::OverBudget { run, budget_ms }) => {
            assert_eq!(run.duration_ms, 74_000);
            assert_eq!(budget_ms, 60_000);
        }
        other => panic!("expected over budget, got {other:?}"),
    }
}

#[test]
fn a_timeout_is_not_a_duration() {
    let mut runs = history(&[10_000]);
    runs.insert(0, run(9, 600_000, LifecycleRunOutcome::Timeout));
    assert!(judge(&runs, 60_000).is_none());
}

#[test]
fn a_regression_over_the_floor_is_a_finding() {
    // 5 prior at ~10s, then 3 recent at ~14s: 14 > 1.3 * 10.
    let runs = history(&[
        10_000, 9_000, 11_000, 10_000, 10_000, 14_000, 14_000, 14_000,
    ]);
    match judge(&runs, 60_000) {
        Some(SlowFinding::Regression {
            recent_mean_ms,
            prior_median_ms,
            prior_runs,
            recent,
        }) => {
            assert_eq!(recent_mean_ms, 14_000.0);
            assert_eq!(prior_median_ms, 10_000.0);
            assert_eq!(prior_runs, 5);
            assert_eq!(recent.len(), 3);
        }
        other => panic!("expected a regression, got {other:?}"),
    }
    // 12.9s is under 1.3x: no finding.
    let mild = history(&[
        10_000, 10_000, 10_000, 10_000, 10_000, 12_900, 12_900, 12_900,
    ]);
    assert!(judge(&mild, 60_000).is_none());
}

#[test]
fn a_regression_below_the_sample_floor_is_not_called() {
    // Only 4 prior runs: a doubling is still not enough evidence.
    let runs = history(&[10_000, 10_000, 10_000, 10_000, 20_000, 20_000, 20_000]);
    assert!(judge(&runs, 60_000).is_none());
}

#[test]
fn filing_is_deduplicated_per_command() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    std::fs::create_dir_all(dir.path().join("src"))?;
    let p = create_project(
        &pool,
        "lc-slow",
        &dir.path().to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id;
    let mut r = run(1, 74_000, LifecycleRunOutcome::Passed);
    r.project_id = p.clone();
    append_run(&pool, &r)?;
    let cmds = [LifecycleGateCommand {
        id: "tsc".into(),
        command: "npm run tsc".into(),
        kind: LifecycleGateKind::Typecheck,
        budget_ms: None,
    }];
    assert_eq!(file_slow_gates(&pool, &p, dir.path(), &cmds)?, 1);
    assert_eq!(
        file_slow_gates(&pool, &p, dir.path(), &cmds)?,
        0,
        "the second hit is a silent dedup"
    );

    let ideas = crate::db::repos::dev::ideas::list_ideas(&pool, Some(&p), None, None, None, None)?;
    assert_eq!(ideas.len(), 1);
    let idea = &ideas[0];
    assert_eq!(idea.title, "Gate `tsc` takes 74s, over its 60s budget");
    assert_eq!(idea.origin.as_deref(), Some("lifecycle"));
    assert_eq!(idea.dedup_key.as_deref(), Some("lifecycle:slow:tsc"));
    Ok(())
}

#[test]
fn a_draft_is_complete_and_forbids_weakening_the_gate() {
    let cmd = LifecycleGateCommand {
        id: "cargo-test".into(),
        command: "cargo test --manifest-path src-tauri/Cargo.toml".into(),
        kind: LifecycleGateKind::Test,
        budget_ms: Some(120_000),
    };
    let finding = SlowFinding::OverBudget {
        run: Box::new(run(1, 200_000, LifecycleRunOutcome::Failed)),
        budget_ms: 120_000,
    };
    let d = draft("p", Path::new("/nowhere"), &cmd, &finding);
    assert_eq!(d.completeness(), crate::db::models::IdeaCompleteness::Full);
    let plan = d.plan.as_ref().expect("plan");
    assert!(plan.steps[1].action.contains("do not weaken the gate"));
    assert_eq!(plan.steps[0].files, vec!["src-tauri/".to_string()]);
    assert!(d
        .evidence
        .as_deref()
        .unwrap_or("")
        .contains("2026-10-01T00:01:00.000Z -> 2026-10-01T00:01:30.000Z"));
    assert!(d
        .description
        .as_deref()
        .unwrap_or("")
        .contains("set on the step"));
}
