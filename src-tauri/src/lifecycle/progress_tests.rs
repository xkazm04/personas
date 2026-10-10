use super::*;
use crate::db::models::{LifecycleGateCommand, LifecycleGateKind};
use tokio_util::sync::CancellationToken;

fn cmd(id: &str) -> LifecycleGateCommand {
    LifecycleGateCommand {
        id: id.into(),
        command: format!("npm run {id}"),
        kind: LifecycleGateKind::Lint,
        budget_ms: None,
    }
}

fn run(measure: &str, command: &str, outcome: LifecycleRunOutcome, ms: u32) -> LifecycleRun {
    LifecycleRun {
        id: format!("{measure}-{command}"),
        project_id: "p".into(),
        measure_id: measure.into(),
        command_id: command.into(),
        command: format!("npm run {command}"),
        kind: LifecycleGateKind::Lint,
        outcome,
        exit_code: None,
        duration_ms: ms,
        value_pct: None,
        first_error: None,
        head_sha: "abc".into(),
        started_at: format!("2026-10-09T00:00:0{}Z", ms % 10),
        finished_at: "2026-10-09T00:01:00Z".into(),
    }
}

fn active(running: Option<(usize, &str)>) -> ActiveMeasure {
    ActiveMeasure {
        project_id: "p".into(),
        measure_id: "now".into(),
        started_at: "2026-10-09T00:00:00.000Z".into(),
        head_sha: "abc".into(),
        commands: vec![cmd("lint"), cmd("tsc"), cmd("test")],
        running: running.map(|(i, at)| (i, at.to_string())),
        cancel: CancellationToken::new(),
    }
}

fn states(p: &LifecycleMeasureProgress) -> Vec<LifecycleCommandState> {
    p.commands.iter().map(|c| c.state).collect()
}

#[test]
fn done_running_and_pending_come_from_rows_and_the_slot() {
    use LifecycleCommandState::*;
    let runs = vec![run("now", "lint", LifecycleRunOutcome::Failed, 1200)];
    let a = active(Some((1, "2026-10-09T00:00:05.000Z")));
    let p = progress_view(&a, &runs).expect("planned");
    assert_eq!(states(&p), vec![Done, Running, Pending]);
    assert_eq!(p.measure_id, "now");
    assert_eq!(p.head_sha, "abc");
    assert!(!p.cancelling);

    let lint = &p.commands[0];
    assert_eq!(lint.outcome, Some(LifecycleRunOutcome::Failed));
    assert_eq!(lint.duration_ms, Some(1200));
    assert!(lint.started_at.is_some());
    let tsc = &p.commands[1];
    assert_eq!(tsc.started_at.as_deref(), Some("2026-10-09T00:00:05.000Z"));
    assert_eq!(tsc.outcome, None);
    assert_eq!(tsc.duration_ms, None);
    let test = &p.commands[2];
    assert_eq!(test.started_at, None);
    assert_eq!(test.outcome, None);
}

#[test]
fn a_row_wins_over_the_slots_running_mark() {
    // The row landed before the next command's start was recorded.
    let runs = vec![run("now", "lint", LifecycleRunOutcome::Passed, 900)];
    let p = progress_view(&active(Some((0, "t"))), &runs).expect("planned");
    assert_eq!(p.commands[0].state, LifecycleCommandState::Done);
    assert_eq!(p.commands[1].state, LifecycleCommandState::Pending);
}

#[test]
fn the_eta_is_the_median_of_complete_runs_outside_this_measure() {
    let runs = vec![
        run("now", "lint", LifecycleRunOutcome::Passed, 9_000),
        run("m3", "lint", LifecycleRunOutcome::Passed, 1_000),
        run("m2", "lint", LifecycleRunOutcome::Failed, 3_000),
        run("m1", "lint", LifecycleRunOutcome::Passed, 2_000),
        // Never complete, never part of an ETA.
        run("m3", "tsc", LifecycleRunOutcome::Timeout, 60_000),
        run("m2", "tsc", LifecycleRunOutcome::DidNotRun, 0),
        run("m1", "test", LifecycleRunOutcome::Passed, 4_000),
        run("m2", "test", LifecycleRunOutcome::Passed, 5_000),
    ];
    let p = progress_view(&active(None), &runs).expect("planned");
    assert_eq!(
        p.commands[0].median_ms,
        Some(2_000),
        "this measure excluded"
    );
    assert_eq!(p.commands[1].median_ms, None, "no complete history");
    assert_eq!(p.commands[2].median_ms, Some(4_500), "even count averages");
}

#[test]
fn nothing_shows_before_the_plan_and_a_cancel_shows_at_once() {
    let mut a = active(None);
    a.measure_id.clear();
    assert!(progress_view(&a, &[]).is_none());

    let a = active(Some((0, "t")));
    a.cancel.cancel();
    let p = progress_view(&a, &[]).expect("planned");
    assert!(p.cancelling);
}
