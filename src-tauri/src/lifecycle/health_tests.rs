use super::*;
use crate::db::models::{LifecyclePhase, LifecycleStep, LifecycleStepParams};

use LifecycleGateKind as K;
use LifecycleHealth as H;
use LifecycleRunOutcome as O;

const TIP: &str = "abcdef0123456789";

fn view(id: &str) -> LifecycleStepView {
    view_with(
        id,
        LifecycleStepParams::default(),
        LifecycleStepTally::default(),
    )
}

fn view_with(
    id: &str,
    params: LifecycleStepParams,
    evidence: LifecycleStepTally,
) -> LifecycleStepView {
    LifecycleStepView {
        step: LifecycleStep {
            id: id.to_string(),
            phase: LifecyclePhase::After,
            label: None,
            rule: String::new(),
            bindings: Vec::new(),
            params,
        },
        binding_views: Vec::new(),
        evidence,
    }
}

/// A run in measure `m` (`m` orders the measures: a larger `m` is newer).
fn run(m: u32, id: &str, kind: K, outcome: O, ms: u32) -> LifecycleRun {
    LifecycleRun {
        id: format!("{m}-{id}"),
        project_id: "p".into(),
        measure_id: format!("m{m:03}"),
        command_id: id.into(),
        command: format!("npm run {id}"),
        kind,
        outcome,
        exit_code: match outcome {
            O::Passed => Some(0),
            O::Failed => Some(1),
            _ => None,
        },
        duration_ms: ms,
        value_pct: None,
        first_error: (outcome == O::Failed).then(|| "error TS2304: nope".to_string()),
        head_sha: TIP.into(),
        started_at: format!("2026-10-{:02}T00:00:00.000Z", 1 + m % 28),
        finished_at: format!("2026-10-{:02}T00:{:02}:00.000Z", 1 + m % 28, m % 60),
    }
}

fn judge(steps: &[LifecycleStepView], runs: &[LifecycleRun]) -> Vec<LifecycleStepHealthView> {
    judge_with(
        steps,
        runs,
        Some(TIP),
        &HashMap::new(),
        &DocTally::default(),
    )
}

fn judge_with(
    steps: &[LifecycleStepView],
    runs: &[LifecycleRun],
    tip: Option<&str>,
    budgets: &HashMap<String, u32>,
    docs: &DocTally,
) -> Vec<LifecycleStepHealthView> {
    step_health(&HealthInput {
        steps,
        runs,
        current_tip: tip,
        budgets,
        docs,
    })
}

fn one(step: &str, runs: &[LifecycleRun]) -> LifecycleStepHealthView {
    judge(&[view(step)], runs).remove(0)
}

fn metric_of(v: &LifecycleStepHealthView, key: LifecycleMetricKey) -> &LifecycleMetric {
    v.metrics.iter().find(|m| m.key == key).expect("metric")
}

// --- instructed ---------------------------------------------------------------

#[test]
fn frame_recall_and_custom_steps_are_instructed_without_metrics() {
    let out = judge(&[view("frame"), view("recall"), view("x-pair")], &[]);
    assert!(out
        .iter()
        .all(|v| v.health == H::Instructed && v.metrics.is_empty() && v.reason.is_none()));
    assert_eq!(
        out.iter().map(|v| v.step_id.as_str()).collect::<Vec<_>>(),
        ["frame", "recall", "x-pair"],
        "step order is kept"
    );
}

#[test]
fn an_unknown_step_is_unmeasured_not_green() {
    assert_eq!(one("mystery", &[]).health, H::Unmeasured);
}

// --- gate ---------------------------------------------------------------------

#[test]
fn a_gate_never_measured_is_unmeasured_with_null_metrics() {
    let v = one("gate", &[]);
    assert_eq!(v.health, H::Unmeasured);
    assert_eq!(
        v.reason.as_deref(),
        Some("No gate commands have been measured")
    );
    for m in &v.metrics {
        assert_eq!((m.value, m.samples), (None, 0), "{:?}", m.key);
    }
    assert!(v.measured_at.is_none() && v.head_sha.is_none());
}

#[test]
fn test_runs_do_not_count_toward_the_gate() {
    let v = one("gate", &[run(1, "test", K::Test, O::Failed, 10)]);
    assert_eq!(v.health, H::Unmeasured);
}

#[test]
fn a_gate_measured_on_an_older_tip_is_stale() {
    let mut r = run(1, "lint", K::Lint, O::Failed, 1000);
    r.head_sha = "0123456aaaa".into();
    let v = one("gate", &[r]);
    assert_eq!(v.health, H::Stale);
    assert_eq!(v.stale_of, Some(H::Red), "the older measure's own verdict");
    assert!(v.reason.as_deref().unwrap_or("").contains("0123456"));
    assert_eq!(v.head_sha.as_deref(), Some("0123456aaaa"));
}

#[test]
fn without_a_current_tip_there_is_no_stale_check() {
    let mut r = run(1, "lint", K::Lint, O::Passed, 1000);
    r.head_sha = "older".into();
    let v = judge_with(
        &[view("gate")],
        &[r],
        None,
        &HashMap::new(),
        &DocTally::default(),
    )
    .remove(0);
    assert_eq!(v.health, H::Green);
}

#[test]
fn any_failed_gate_command_is_red_and_named() {
    let v = one(
        "gate",
        &[
            run(1, "lint", K::Lint, O::Passed, 1000),
            run(1, "tsc", K::Typecheck, O::Failed, 1000),
            run(1, "check", K::Check, O::Timeout, 1000),
        ],
    );
    assert_eq!(v.health, H::Red);
    assert_eq!(v.reason.as_deref(), Some("tsc failed: error TS2304: nope"));
    assert_eq!(v.head_sha.as_deref(), Some(TIP));
    assert!(v.measured_at.is_some());
}

#[test]
fn a_timeout_or_did_not_run_without_a_failure_is_unmeasured() {
    let v = one(
        "gate",
        &[
            run(1, "lint", K::Lint, O::Passed, 1000),
            run(1, "tsc", K::Typecheck, O::Timeout, 600_000),
        ],
    );
    assert_eq!(v.health, H::Unmeasured);
    assert!(v.reason.as_deref().unwrap_or("").contains("tsc timed out"));

    let mut dnr = run(1, "lint", K::Lint, O::DidNotRun, 0);
    dnr.first_error = Some("deps_missing:node_modules".into());
    let v = one("gate", &[dnr]);
    assert_eq!(v.health, H::Unmeasured);
    assert_eq!(
        v.reason.as_deref(),
        Some("lint did not run: deps_missing:node_modules")
    );
}

#[test]
fn a_passing_gate_over_its_budget_is_amber() {
    let v = one(
        "gate",
        &[
            run(1, "lint", K::Lint, O::Passed, 1000),
            run(1, "tsc", K::Typecheck, O::Passed, 74_000),
        ],
    );
    assert_eq!(v.health, H::Amber);
    assert_eq!(v.reason.as_deref(), Some("tsc 74s over 60s budget"));
}

#[test]
fn a_budget_override_moves_the_line() {
    let runs = [run(1, "tsc", K::Typecheck, O::Passed, 74_000)];
    let budgets = HashMap::from([("tsc".to_string(), 90_000)]);
    let v = judge_with(
        &[view("gate")],
        &runs,
        Some(TIP),
        &budgets,
        &DocTally::default(),
    )
    .remove(0);
    assert_eq!(v.health, H::Green);
    assert!(v.reason.is_none());
    assert!(v.stale_of.is_none(), "stale_of is null unless stale");
}

#[test]
fn median_and_pass_rate_come_from_the_last_ten_complete_measures() {
    let mut runs = Vec::new();
    // 12 measures; the two oldest (1, 2) fall outside the window.
    for m in 1..=12u32 {
        let outcome = if m == 5 { O::Failed } else { O::Passed };
        runs.push(run(m, "lint", K::Lint, outcome, 1000 * m));
        runs.push(run(m, "tsc", K::Typecheck, O::Passed, 1000));
    }
    // Measure 4 is incomplete (a timeout): out of both populations.
    runs.retain(|r| !(r.measure_id == "m004" && r.command_id == "tsc"));
    runs.push(run(4, "tsc", K::Typecheck, O::Timeout, 1000));

    let v = one("gate", &runs);
    assert_eq!(v.health, H::Green, "{:?}", v.reason);
    let median = metric_of(&v, LifecycleMetricKey::MedianMs);
    // Window = measures 3..=12; complete = 3,5..=12 (9). Totals = m*1000+1000.
    assert_eq!(median.samples, 9);
    assert_eq!(median.value, Some(9000.0)); // sorted 4k,6k..13k -> 5th = 9k
    let rate = metric_of(&v, LifecycleMetricKey::PassRate);
    assert_eq!(rate.samples, 9);
    let expected = 8.0 * 100.0 / 9.0;
    assert!((rate.value.expect("rate") - expected).abs() < 1e-9);
}

#[test]
fn a_pass_rate_below_five_samples_has_no_value() {
    let runs: Vec<_> = (1..=4u32)
        .map(|m| run(m, "lint", K::Lint, O::Passed, 1000))
        .collect();
    let v = one("gate", &runs);
    let rate = metric_of(&v, LifecycleMetricKey::PassRate);
    assert_eq!((rate.value, rate.samples), (None, 4));
    let median = metric_of(&v, LifecycleMetricKey::MedianMs);
    assert_eq!((median.value, median.samples), (Some(1000.0), 4));
}

// --- tests --------------------------------------------------------------------

fn cov(m: u32, pct: Option<f64>) -> LifecycleRun {
    let mut r = run(m, "coverage", K::Coverage, O::Passed, 1000);
    r.value_pct = pct;
    r
}

#[test]
fn tests_never_measured_is_unmeasured_with_a_null_coverage_slot() {
    let v = one("tests", &[]);
    assert_eq!(v.health, H::Unmeasured);
    let c = metric_of(&v, LifecycleMetricKey::CoveragePct);
    assert_eq!((c.value, c.samples), (None, 0));
}

#[test]
fn failing_tests_are_red() {
    let v = one(
        "tests",
        &[run(1, "test", K::Test, O::Failed, 1000), cov(1, Some(90.0))],
    );
    assert_eq!(v.health, H::Red);
}

#[test]
fn passing_tests_without_coverage_are_unmeasured() {
    let v = one("tests", &[run(1, "test", K::Test, O::Passed, 1000)]);
    assert_eq!(v.health, H::Unmeasured);
    assert_eq!(
        v.reason.as_deref(),
        Some("Tests pass; coverage is not measured")
    );
    let c = metric_of(&v, LifecycleMetricKey::CoveragePct);
    assert_eq!((c.value, c.samples), (None, 0));

    let v = one(
        "tests",
        &[run(1, "test", K::Test, O::Passed, 1000), cov(1, None)],
    );
    assert_eq!(
        v.health,
        H::Unmeasured,
        "a coverage run nothing parsed from"
    );
}

#[test]
fn coverage_bands_green_amber_red() {
    let at = |pct: f64| {
        one(
            "tests",
            &[run(1, "test", K::Test, O::Passed, 1000), cov(1, Some(pct))],
        )
    };
    assert_eq!(at(75.0).health, H::Green);
    assert_eq!(at(70.0).health, H::Green);
    let amber = at(63.0);
    assert_eq!(amber.health, H::Amber);
    assert_eq!(
        amber.reason.as_deref(),
        Some("Coverage 63% is under the 70% target")
    );
    assert_eq!(
        metric_of(&amber, LifecycleMetricKey::CoveragePct).value,
        Some(63.0)
    );
    assert_eq!(at(50.0).health, H::Amber);
    assert_eq!(at(49.9).health, H::Red);
}

#[test]
fn a_custom_coverage_target_and_a_slow_suite() {
    let params = LifecycleStepParams {
        coverage_green_pct: Some(60),
        ..Default::default()
    };
    let steps = [view_with("tests", params, LifecycleStepTally::default())];
    let runs = [run(1, "test", K::Test, O::Passed, 1000), cov(1, Some(63.0))];
    assert_eq!(judge(&steps, &runs)[0].health, H::Green);
    let slow = [
        run(1, "test", K::Test, O::Passed, 400_000),
        cov(1, Some(63.0)),
    ];
    let v = judge(&steps, &slow).remove(0);
    assert_eq!(v.health, H::Amber);
    assert_eq!(v.reason.as_deref(), Some("test 6m 40s over 5m 00s budget"));
}

#[test]
fn a_stale_tests_measure_is_stale() {
    let mut r = run(1, "test", K::Test, O::Passed, 1000);
    r.head_sha = "feedface".into();
    let v = one("tests", &[r]);
    assert_eq!(v.health, H::Stale);
    assert_eq!(
        v.stale_of,
        Some(H::Unmeasured),
        "tests passed, coverage absent"
    );
}

// --- docs ---------------------------------------------------------------------

fn docs(total: u32, broken: u32, unverifiable: u32, clean: u32) -> LifecycleStepHealthView {
    let t = DocTally {
        total,
        broken,
        unverifiable,
        clean,
        scanned_at: (total > 0).then(|| "2026-10-08 10:00:00".to_string()),
    };
    judge_with(&[view("docs")], &[], Some(TIP), &HashMap::new(), &t).remove(0)
}

#[test]
fn docs_verdicts() {
    let v = docs(0, 0, 0, 0);
    assert_eq!(v.health, H::Unmeasured);
    let m = metric_of(&v, LifecycleMetricKey::DocsCleanPct);
    assert_eq!((m.value, m.samples), (None, 0));

    assert_eq!(docs(5, 0, 5, 0).health, H::Unmeasured, "nothing verifiable");
    let red = docs(10, 1, 0, 9);
    assert_eq!(red.health, H::Red);
    assert_eq!(
        red.reason.as_deref(),
        Some("1 doc names a path that no longer exists")
    );

    let green = docs(12, 0, 2, 9);
    assert_eq!(green.health, H::Green);
    let m = metric_of(&green, LifecycleMetricKey::DocsCleanPct);
    assert_eq!((m.value, m.samples), (Some(90.0), 10));
    assert!(green.measured_at.is_some() && green.head_sha.is_none());

    let amber = docs(10, 0, 0, 8);
    assert_eq!(amber.health, H::Amber);
    assert_eq!(
        amber.reason.as_deref(),
        Some("80% of verifiable docs are clean, 90% needed")
    );
}

// --- evidence steps -------------------------------------------------------------

fn evidence(
    step: &str,
    done: i64,
    skipped: i64,
    unknown: i64,
    failed: i64,
) -> LifecycleStepHealthView {
    let t = LifecycleStepTally {
        done,
        skipped,
        unknown,
        failed,
    };
    judge(&[view_with(step, LifecycleStepParams::default(), t)], &[]).remove(0)
}

#[test]
fn evidence_steps_need_five_samples_and_ignore_unknown() {
    let v = evidence("isolate", 4, 0, 30, 0);
    assert_eq!(v.health, H::Unmeasured);
    assert_eq!(
        v.reason.as_deref(),
        Some("Only 4 changes recorded; 5 are needed")
    );
    let m = metric_of(&v, LifecycleMetricKey::DoneRate);
    assert_eq!((m.value, m.samples), (Some(100.0), 4));

    let none = evidence("sync", 0, 0, 12, 0);
    let m = metric_of(&none, LifecycleMetricKey::DoneRate);
    assert_eq!((m.value, m.samples), (None, 0));
}

#[test]
fn evidence_bands() {
    for step in EVIDENCE_STEPS {
        assert_eq!(evidence(step, 9, 1, 0, 0).health, H::Green, "{step}");
        assert_eq!(evidence(step, 6, 3, 0, 1).health, H::Amber, "{step}");
        let red = evidence(step, 4, 5, 0, 1);
        assert_eq!(red.health, H::Red, "{step}");
        assert_eq!(
            red.reason.as_deref(),
            Some("Done in 40% of recent changes, 80% needed")
        );
        assert!(red.measured_at.is_none() && red.head_sha.is_none());
    }
    let params = LifecycleStepParams {
        done_rate_pct: Some(60),
        ..Default::default()
    };
    let t = LifecycleStepTally {
        done: 6,
        skipped: 4,
        unknown: 0,
        failed: 0,
    };
    assert_eq!(
        judge(&[view_with("land", params, t)], &[])[0].health,
        H::Green
    );
}

#[test]
fn durations_format_for_a_human() {
    assert_eq!(fmt_ms(1500), "1.5s");
    assert_eq!(fmt_ms(74_000), "74s");
    assert_eq!(fmt_ms(60_000), "60s");
    assert_eq!(fmt_ms(119_000), "119s");
    assert_eq!(fmt_ms(120_000), "2m 00s");
    assert_eq!(fmt_ms(185_400), "3m 05s");
}
