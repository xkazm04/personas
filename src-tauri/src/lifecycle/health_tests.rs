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
        previous_evidence: None,
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

// --- rules view -----------------------------------------------------------------

/// The shipped rules are the ones `step_health` judges with: every boundary
/// below is read from `rules_view()` and probed against the verdict, so a
/// number changed (or inlined) in one place only turns this red.
#[test]
fn rules_view_is_what_step_health_judges_with() {
    let rules = rules_view();

    // Budgets: one per kind, in the fixed order; at the budget is green, one
    // millisecond over is amber, under whichever step measures that kind.
    assert_eq!(
        rules
            .default_budgets
            .iter()
            .map(|b| b.kind)
            .collect::<Vec<_>>(),
        [
            K::Lint,
            K::Typecheck,
            K::Test,
            K::Check,
            K::Coverage,
            K::Other
        ]
    );
    for b in &rules.default_budgets {
        let step = crate::lifecycle::detect_commands::step_of(b.kind);
        let at = |ms: u32| {
            let mut runs = vec![run(1, "cmd", b.kind, O::Passed, ms)];
            if step == "tests" {
                runs.push(cov(1, Some(100.0)));
                runs[0].value_pct = (b.kind == K::Coverage).then_some(100.0);
            }
            one(step, &runs).health
        };
        assert_eq!(at(b.budget_ms), H::Green, "{:?} at budget", b.kind);
        assert_eq!(at(b.budget_ms + 1), H::Amber, "{:?} over budget", b.kind);
    }

    // Step kinds: each listed kind is judged under that step (a failure there
    // turns it red) and under no other.
    assert_eq!(
        rules
            .step_kinds
            .iter()
            .map(|s| s.step_id.as_str())
            .collect::<Vec<_>>(),
        ["gate", "tests"]
    );
    for s in &rules.step_kinds {
        for &kind in &s.kinds {
            let failed = [run(1, "cmd", kind, O::Failed, 10)];
            assert_eq!(one(&s.step_id, &failed).health, H::Red, "{kind:?}");
            let other = if s.step_id == "gate" { "tests" } else { "gate" };
            assert_eq!(one(other, &failed).health, H::Unmeasured, "{kind:?}");
        }
    }

    // Coverage: green at the target, amber just under it and at the floor,
    // red just under the floor.
    let coverage = |pct: u32| {
        one(
            "tests",
            &[
                run(1, "test", K::Test, O::Passed, 10),
                cov(1, Some(f64::from(pct))),
            ],
        )
        .health
    };
    assert_eq!(coverage(rules.coverage_green_pct), H::Green);
    assert_eq!(coverage(rules.coverage_green_pct - 1), H::Amber);
    assert_eq!(coverage(rules.amber_floor_pct), H::Amber);
    assert_eq!(coverage(rules.amber_floor_pct - 1), H::Red);

    // Docs: 100 verifiable docs, clean share at the target is green.
    let docs_at = |clean: u32| docs(100, 0, 0, clean).health;
    assert_eq!(docs_at(rules.docs_clean_pct), H::Green);
    assert_eq!(docs_at(rules.docs_clean_pct - 1), H::Amber);

    // Evidence: 100 counted changes; done rate bands, then the sample floor.
    let done = |n: u32| evidence("commit", i64::from(n), i64::from(100 - n), 0, 0).health;
    assert_eq!(done(rules.done_rate_pct), H::Green);
    assert_eq!(done(rules.done_rate_pct - 1), H::Amber);
    assert_eq!(done(rules.amber_floor_pct), H::Amber);
    assert_eq!(done(rules.amber_floor_pct - 1), H::Red);
    let floor = i64::from(rules.min_samples);
    assert_eq!(evidence("commit", floor, 0, 0, 0).health, H::Green);
    assert_eq!(evidence("commit", floor - 1, 0, 0, 0).health, H::Unmeasured);
}

// --- previous + history ---------------------------------------------------------

/// Twelve measures of gate (lint) and tests (test + coverage); the newest
/// fails lint and lifts coverage over the target.
fn twelve_measures() -> Vec<LifecycleRun> {
    let mut runs = Vec::new();
    for m in 1..=12u32 {
        let lint = if m == 12 { O::Failed } else { O::Passed };
        runs.push(run(m, "lint", K::Lint, lint, 1000 * m));
        runs.push(run(m, "test", K::Test, O::Passed, 500));
        runs.push(cov(m, Some(if m == 12 { 75.0 } else { 65.0 })));
    }
    runs
}

#[test]
fn previous_is_the_judgment_without_the_newest_measure() {
    let runs = twelve_measures();
    let steps = [view("gate"), view("tests")];
    let now = judge(&steps, &runs);
    let without: Vec<LifecycleRun> = runs
        .iter()
        .filter(|r| r.measure_id != "m012")
        .cloned()
        .collect();
    let before = judge(&steps, &without);
    for (n, b) in now.iter().zip(&before) {
        let p = n.previous.as_ref().expect("two measures or more");
        assert_eq!(p.health, b.health, "{}", n.step_id);
        assert_eq!(p.metrics, b.metrics, "{}", n.step_id);
        assert_eq!(p.measured_at, b.measured_at, "{}", n.step_id);
        assert_eq!(p.head_sha, b.head_sha, "{}", n.step_id);
    }
    assert_eq!((now[0].health, before[0].health), (H::Red, H::Green));
    assert_eq!((now[1].health, before[1].health), (H::Green, H::Amber));
    assert!(before.iter().all(|b| b.previous.is_some()), "11 measures");

    assert!(one("gate", &[]).previous.is_none(), "never measured");
    assert!(
        one("gate", &[run(1, "lint", K::Lint, O::Passed, 10)])
            .previous
            .is_none(),
        "one measure has nothing before it"
    );
    let only_tests = [
        run(1, "test", K::Test, O::Passed, 10),
        run(2, "test", K::Test, O::Passed, 10),
    ];
    assert!(
        one("gate", &only_tests).previous.is_none(),
        "the gate never ran in the earlier window"
    );
    assert!(one("tests", &only_tests).previous.is_some());
}

#[test]
fn a_past_column_is_judged_on_its_own_tip_and_never_stale() {
    let runs: Vec<LifecycleRun> = (1..=3u32)
        .map(|m| {
            let mut r = run(m, "lint", K::Lint, O::Passed, 1000);
            r.head_sha = format!("sha-{m}");
            r
        })
        .collect();
    let h = history(&[view("gate").step], &runs, &HashMap::new());
    assert_eq!(h.measures.len(), 3);
    for c in &h.measures {
        assert_eq!(c.cells[0].health, H::Green, "{}", c.measure_id);
    }
    // The current verdict against a moved base is stale; `previous`, judged
    // on its own Measure's tip, is not.
    let now = one("gate", &runs);
    assert_eq!(now.health, H::Stale);
    let p = now.previous.expect("previous");
    assert_eq!(p.health, H::Green);
    assert_eq!(p.head_sha.as_deref(), Some("sha-2"));
}

#[test]
fn the_newest_column_is_the_current_verdict_and_the_next_is_previous() {
    let runs = twelve_measures();
    let budgets = HashMap::from([("lint".to_string(), 5_000)]);
    let steps = [view("frame"), view("tests"), view("docs"), view("gate")];
    let now = judge_with(&steps, &runs, Some(TIP), &budgets, &DocTally::default());
    let doc_steps: Vec<LifecycleStep> = steps.iter().map(|v| v.step.clone()).collect();
    let h = history(&doc_steps, &runs, &budgets);
    assert_eq!(
        h.step_ids,
        ["tests", "gate"],
        "command steps, in step order"
    );
    assert_eq!(h.measures.len(), 12);
    for (i, id) in h.step_ids.iter().enumerate() {
        let current = now.iter().find(|v| &v.step_id == id).expect("judged");
        let newest = &h.measures[0].cells[i];
        assert_eq!(&newest.step_id, id);
        assert_eq!(newest.health, current.health, "{id}");
        assert_eq!(newest.reason, current.reason, "{id}");
        assert_eq!(newest.metrics, current.metrics, "{id}");
        let earlier = &h.measures[1].cells[i];
        let previous = current.previous.as_ref().expect("previous");
        assert_eq!(earlier.health, previous.health, "{id}");
        assert_eq!(earlier.metrics, previous.metrics, "{id}");
    }
    // Lint over its 5s override from measure 6 on: the window moves the line.
    let gate = |c: &LifecycleMeasureColumn| c.cells[1].health;
    assert_eq!(gate(&h.measures[0]), H::Red);
    assert_eq!(gate(&h.measures[1]), H::Amber);
    assert_eq!(gate(&h.measures[11]), H::Green);
}

#[test]
fn history_columns_are_capped_newest_first_with_runs_as_planned() {
    let mut runs = Vec::new();
    for m in 1..=29u32 {
        let mut lint = run(m, "lint", K::Lint, O::Passed, 1_000);
        let mut tsc = run(m, "tsc", K::Typecheck, O::Passed, 2_500);
        lint.started_at = format!("2026-10-{m:02}T00:00:01.000Z");
        tsc.started_at = format!("2026-10-{m:02}T00:00:02.000Z");
        lint.finished_at = format!("2026-10-{m:02}T00:00:03.000Z");
        tsc.finished_at = lint.finished_at.clone();
        // Newest first, as the ledger reads.
        runs.insert(0, lint);
        runs.insert(0, tsc);
    }
    let h = history(&[view("gate").step], &runs, &HashMap::new());
    assert_eq!(h.measures.len(), HISTORY_COLUMNS);
    assert_eq!(h.measures[0].measure_id, "m029");
    assert_eq!(h.measures[19].measure_id, "m010");
    let c = &h.measures[0];
    assert_eq!(
        c.runs
            .iter()
            .map(|r| r.command_id.as_str())
            .collect::<Vec<_>>(),
        ["lint", "tsc"]
    );
    assert_eq!(c.duration_ms, 3_500);
    assert_eq!(c.started_at, "2026-10-29T00:00:01.000Z");
    assert_eq!(c.head_sha, TIP);
    // The oldest column still sees a full window of older measures.
    let samples = metric_of_cell(&h.measures[19].cells[0], LifecycleMetricKey::MedianMs);
    assert_eq!(samples, HISTORY_MEASURES as u32);

    // A tie in start time keeps the ledger's insertion order.
    let mut a = run(1, "a", K::Lint, O::DidNotRun, 0);
    let mut b = run(1, "b", K::Check, O::DidNotRun, 0);
    a.started_at = "2026-10-01T00:00:00.000Z".into();
    b.started_at = a.started_at.clone();
    let h = history(&[view("gate").step], &[b, a], &HashMap::new());
    assert_eq!(
        h.measures[0]
            .runs
            .iter()
            .map(|r| r.command_id.as_str())
            .collect::<Vec<_>>(),
        ["a", "b"]
    );
    assert!(history(&[view("gate").step], &[], &HashMap::new())
        .measures
        .is_empty());
}

fn metric_of_cell(c: &LifecycleHistoryCell, key: LifecycleMetricKey) -> u32 {
    c.metrics
        .iter()
        .find(|m| m.key == key)
        .map(|m| m.samples)
        .expect("metric")
}

#[test]
fn evidence_previous_is_the_window_without_the_newest_change() {
    let tally = |done, skipped| LifecycleStepTally {
        done,
        skipped,
        unknown: 0,
        failed: 0,
    };
    let earlier = PreviousEvidence {
        tallies: HashMap::from([("commit".to_string(), tally(3, 2))]),
        measured_at: Some("2026-10-07T00:00:00Z".into()),
    };
    let steps = [
        view_with("commit", LifecycleStepParams::default(), tally(9, 1)),
        view("land"),
        view("gate"),
        view("docs"),
        view("frame"),
    ];
    let (budgets, docs) = (HashMap::new(), DocTally::default());
    let input = |previous_evidence| HealthInput {
        steps: &steps,
        runs: &[],
        current_tip: Some(TIP),
        budgets: &budgets,
        docs: &docs,
        previous_evidence,
    };
    let out = step_health(&input(Some(&earlier)));
    assert_eq!(out[0].health, H::Green);
    let p = out[0].previous.as_ref().expect("commit previous");
    assert_eq!(p.health, H::Amber, "3 of 5 done");
    assert_eq!(p.measured_at.as_deref(), Some("2026-10-07T00:00:00Z"));
    assert!(p.head_sha.is_none());
    let land = out[1].previous.as_ref().expect("land previous");
    assert_eq!(land.health, H::Unmeasured, "nothing tallied in that window");
    assert!(
        out[2..].iter().all(|v| v.previous.is_none()),
        "gate unmeasured, docs, frame"
    );

    let out = step_health(&input(None));
    assert!(
        out.iter().all(|v| v.previous.is_none()),
        "no evidence at all"
    );
}
