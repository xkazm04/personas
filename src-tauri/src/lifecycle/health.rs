//! Measured step health - pure. One [`LifecycleStepHealthView`] per step, in
//! step order, from what was MEASURED: `dev_lifecycle_runs` (gate, tests), the
//! doc-rot scan's `doc_status` (docs) and the evidence tally (isolate, link,
//! sync, commit, land, record). Green means measured and passing; a step with
//! no sample, or below its sample floor, is `unmeasured`, never green.
//!
//! | step | verdict |
//! |---|---|
//! | frame, recall, `x-*` | `instructed` (unobservable by design) |
//! | gate | none ever -> unmeasured; latest measure on another base tip -> stale (its verdict in `stale_of`); any failed -> red; any timeout / did-not-run -> unmeasured; any over budget -> amber; else green |
//! | tests | as gate, then coverage: none -> unmeasured; >= target (70) -> green; >= 50 -> amber; else red |
//! | docs | any broken -> red; no verifiable doc -> unmeasured; clean share >= target (90) -> green; else amber |
//! | evidence steps | < 5 samples -> unmeasured; done rate >= target (80) -> green; >= 50 -> amber; else red |
//!
//! Metrics follow the absent-value convention: no sample is `value: None,
//! samples: 0`. Rates and shares are percentages (0-100).

use std::collections::HashMap;

use crate::db::models::{
    LifecycleGateKind, LifecycleHealth, LifecycleMetric, LifecycleMetricKey, LifecycleRun,
    LifecycleRunOutcome, LifecycleStepHealthView, LifecycleStepTally, LifecycleStepView,
};

use super::detect_commands::kinds_of;

/// Measures the median and the pass rate look back over.
pub const HISTORY_MEASURES: usize = 10;
/// Below this many samples a rate is not reported and an evidence step is
/// `unmeasured`.
pub const MIN_SAMPLES: u32 = 5;
pub const DEFAULT_COVERAGE_GREEN_PCT: u32 = 70;
pub const DEFAULT_DOCS_CLEAN_PCT: u32 = 90;
pub const DEFAULT_DONE_RATE_PCT: u32 = 80;
/// The amber floor shared by coverage and done rate.
pub const AMBER_FLOOR_PCT: f64 = 50.0;

/// Steps judged from the evidence tally.
pub const EVIDENCE_STEPS: [&str; 6] = ["isolate", "link", "sync", "commit", "land", "record"];

/// The default time budget of a command kind, in milliseconds.
pub fn default_budget_ms(kind: LifecycleGateKind) -> u32 {
    match kind {
        LifecycleGateKind::Lint | LifecycleGateKind::Typecheck => 60_000,
        LifecycleGateKind::Test | LifecycleGateKind::Other => 300_000,
        LifecycleGateKind::Check | LifecycleGateKind::Coverage => 600_000,
    }
}

/// The doc-rot scan's verdicts for one project, tallied.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DocTally {
    pub total: u32,
    pub broken: u32,
    pub unverifiable: u32,
    pub clean: u32,
    /// Newest `scanned_at`, when any row exists.
    pub scanned_at: Option<String>,
}

/// Everything the verdicts are computed from.
pub struct HealthInput<'a> {
    pub steps: &'a [LifecycleStepView],
    /// Runs of the project's newest measures (any order; at least
    /// [`HISTORY_MEASURES`] of them when that many exist).
    pub runs: &'a [LifecycleRun],
    /// The base branch tip now; `None` when git cannot say (no stale check).
    pub current_tip: Option<&'a str>,
    /// Per-command budget overrides (`command_id -> budget_ms`).
    pub budgets: &'a HashMap<String, u32>,
    pub docs: &'a DocTally,
}

/// One verdict per step, in step order.
pub fn step_health(input: &HealthInput<'_>) -> Vec<LifecycleStepHealthView> {
    input
        .steps
        .iter()
        .map(|view| {
            let id = view.step.id.as_str();
            let params = &view.step.params;
            match id {
                "gate" => command_step(id, input, None),
                "tests" => command_step(
                    id,
                    input,
                    Some(
                        params
                            .coverage_green_pct
                            .unwrap_or(DEFAULT_COVERAGE_GREEN_PCT),
                    ),
                ),
                "docs" => docs_step(
                    input.docs,
                    params.docs_clean_pct.unwrap_or(DEFAULT_DOCS_CLEAN_PCT),
                ),
                _ if EVIDENCE_STEPS.contains(&id) => evidence_step(
                    id,
                    &view.evidence,
                    params.done_rate_pct.unwrap_or(DEFAULT_DONE_RATE_PCT),
                ),
                _ if id == "frame" || id == "recall" || id.starts_with("x-") => {
                    verdict(id, LifecycleHealth::Instructed, None, Vec::new())
                }
                _ => verdict(
                    id,
                    LifecycleHealth::Unmeasured,
                    Some("No measurement is defined for this step".into()),
                    Vec::new(),
                ),
            }
        })
        .collect()
}

fn verdict(
    step_id: &str,
    health: LifecycleHealth,
    reason: Option<String>,
    metrics: Vec<LifecycleMetric>,
) -> LifecycleStepHealthView {
    LifecycleStepHealthView {
        step_id: step_id.to_string(),
        health,
        stale_of: None,
        reason,
        metrics,
        measured_at: None,
        head_sha: None,
    }
}

fn metric(key: LifecycleMetricKey, value: Option<f64>, samples: u32) -> LifecycleMetric {
    // The convention, enforced here once: no sample, no value.
    LifecycleMetric {
        key,
        value: if samples == 0 { None } else { value },
        samples,
    }
}

/// One measure's runs for one step.
struct Measure<'a> {
    runs: Vec<&'a LifecycleRun>,
    finished_at: &'a str,
    head_sha: &'a str,
}

impl Measure<'_> {
    fn complete(&self) -> bool {
        self.runs.iter().all(|r| {
            matches!(
                r.outcome,
                LifecycleRunOutcome::Passed | LifecycleRunOutcome::Failed
            )
        })
    }
    fn all_passed(&self) -> bool {
        self.runs
            .iter()
            .all(|r| r.outcome == LifecycleRunOutcome::Passed)
    }
    fn total_ms(&self) -> u64 {
        self.runs.iter().map(|r| u64::from(r.duration_ms)).sum()
    }
}

/// The step's measures, newest first, at most [`HISTORY_MEASURES`].
fn measures_for<'a>(runs: &'a [LifecycleRun], kinds: &[LifecycleGateKind]) -> Vec<Measure<'a>> {
    let mut by_id: HashMap<&str, Vec<&LifecycleRun>> = HashMap::new();
    for r in runs.iter().filter(|r| kinds.contains(&r.kind)) {
        by_id.entry(r.measure_id.as_str()).or_default().push(r);
    }
    let mut out: Vec<Measure<'a>> = by_id
        .into_values()
        .map(|mut runs| {
            runs.sort_by(|a, b| a.started_at.cmp(&b.started_at));
            let finished_at = runs
                .iter()
                .map(|r| r.finished_at.as_str())
                .max()
                .unwrap_or("");
            let head_sha = runs.first().map(|r| r.head_sha.as_str()).unwrap_or("");
            Measure {
                runs,
                finished_at,
                head_sha,
            }
        })
        .collect();
    out.sort_by(|a, b| b.finished_at.cmp(a.finished_at));
    out.truncate(HISTORY_MEASURES);
    out
}

fn median(values: &mut [u64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    let mid = values.len() / 2;
    Some(if values.len() % 2 == 0 {
        (values[mid - 1] + values[mid]) as f64 / 2.0
    } else {
        values[mid] as f64
    })
}

/// "1.5s", "74s" (seconds up to two minutes), "3m 05s".
pub fn fmt_ms(ms: u64) -> String {
    if ms < 10_000 {
        format!("{:.1}s", ms as f64 / 1000.0)
    } else if ms < 120_000 {
        format!("{}s", (ms + 500) / 1000)
    } else {
        let secs = (ms + 500) / 1000;
        format!("{}m {:02}s", secs / 60, secs % 60)
    }
}

fn short(sha: &str) -> &str {
    sha.get(..7).unwrap_or(sha)
}

fn pct(v: f64) -> String {
    format!("{}%", v.round() as i64)
}

/// `gate` or `tests` (with `coverage_green` set).
fn command_step(
    step_id: &str,
    input: &HealthInput<'_>,
    coverage_green: Option<u32>,
) -> LifecycleStepHealthView {
    let measures = measures_for(input.runs, kinds_of(step_id));
    let complete: Vec<&Measure<'_>> = measures.iter().filter(|m| m.complete()).collect();
    let mut totals: Vec<u64> = complete.iter().map(|m| m.total_ms()).collect();
    let samples = complete.len() as u32;
    let passed = complete.iter().filter(|m| m.all_passed()).count() as u32;
    let pass_rate =
        (samples >= MIN_SAMPLES).then(|| f64::from(passed) * 100.0 / f64::from(samples));
    let mut metrics = vec![
        metric(LifecycleMetricKey::MedianMs, median(&mut totals), samples),
        LifecycleMetric {
            key: LifecycleMetricKey::PassRate,
            value: pass_rate,
            samples,
        },
    ];

    let Some(latest) = measures.first() else {
        let what = if coverage_green.is_some() {
            "test"
        } else {
            "gate"
        };
        if coverage_green.is_some() {
            metrics.insert(0, metric(LifecycleMetricKey::CoveragePct, None, 0));
        }
        return verdict(
            step_id,
            LifecycleHealth::Unmeasured,
            Some(format!("No {what} commands have been measured")),
            metrics,
        );
    };

    let coverage = latest
        .runs
        .iter()
        .filter(|r| r.kind == LifecycleGateKind::Coverage)
        .find_map(|r| r.value_pct);
    if coverage_green.is_some() {
        metrics.insert(
            0,
            metric(
                LifecycleMetricKey::CoveragePct,
                coverage,
                u32::from(coverage.is_some()),
            ),
        );
    }

    let (fresh, fresh_reason) = command_verdict(input, latest, coverage, coverage_green);
    // A measurement on an older base tip says nothing about the tip now; the
    // verdict it gave rides along as `stale_of` so the UI can still show it.
    let (health, stale_of, reason) = match input.current_tip {
        Some(tip) if latest.head_sha != tip => (
            LifecycleHealth::Stale,
            Some(fresh),
            format!(
                "Last measured on an older base tip ({}; the base is now {})",
                short(latest.head_sha),
                short(tip)
            ),
        ),
        _ => (fresh, None, fresh_reason),
    };
    LifecycleStepHealthView {
        step_id: step_id.to_string(),
        health,
        stale_of,
        reason: Some(reason).filter(|r| !r.is_empty()),
        metrics,
        measured_at: Some(latest.finished_at.to_string()),
        head_sha: Some(latest.head_sha.to_string()),
    }
}

/// The newest measure's verdict, ignoring which base tip it ran on (the
/// caller turns a measure on an older tip into `stale`).
fn command_verdict(
    input: &HealthInput<'_>,
    latest: &Measure<'_>,
    coverage: Option<f64>,
    coverage_green: Option<u32>,
) -> (LifecycleHealth, String) {
    if let Some(r) = latest
        .runs
        .iter()
        .find(|r| r.outcome == LifecycleRunOutcome::Failed)
    {
        let why = r
            .first_error
            .clone()
            .unwrap_or_else(|| format!("exit {}", r.exit_code.unwrap_or(-1)));
        return (
            LifecycleHealth::Red,
            format!("{} failed: {why}", r.command_id),
        );
    }
    if let Some(r) = latest.runs.iter().find(|r| {
        matches!(
            r.outcome,
            LifecycleRunOutcome::Timeout | LifecycleRunOutcome::DidNotRun
        )
    }) {
        let why = if r.outcome == LifecycleRunOutcome::Timeout {
            format!(
                "{} timed out after {}",
                r.command_id,
                fmt_ms(u64::from(r.duration_ms))
            )
        } else {
            format!(
                "{} did not run: {}",
                r.command_id,
                r.first_error.as_deref().unwrap_or("no reason recorded")
            )
        };
        return (LifecycleHealth::Unmeasured, why);
    }
    let over_budget = latest.runs.iter().find_map(|r| {
        let budget = input
            .budgets
            .get(&r.command_id)
            .copied()
            .unwrap_or_else(|| default_budget_ms(r.kind));
        (r.duration_ms > budget).then(|| {
            format!(
                "{} {} over {} budget",
                r.command_id,
                fmt_ms(u64::from(r.duration_ms)),
                fmt_ms(u64::from(budget))
            )
        })
    });
    if let Some(green_pct) = coverage_green {
        let Some(cov) = coverage else {
            return (
                LifecycleHealth::Unmeasured,
                "Tests pass; coverage is not measured".into(),
            );
        };
        if cov < AMBER_FLOOR_PCT {
            return (
                LifecycleHealth::Red,
                format!("Coverage {} is under the {}% target", pct(cov), green_pct),
            );
        }
        if cov < f64::from(green_pct) {
            return (
                LifecycleHealth::Amber,
                format!("Coverage {} is under the {}% target", pct(cov), green_pct),
            );
        }
    }
    match over_budget {
        Some(reason) => (LifecycleHealth::Amber, reason),
        None => (LifecycleHealth::Green, String::new()),
    }
}

fn docs_step(t: &DocTally, clean_pct: u32) -> LifecycleStepHealthView {
    let verifiable = t.total.saturating_sub(t.unverifiable);
    let share = (verifiable > 0).then(|| f64::from(t.clean) * 100.0 / f64::from(verifiable));
    let metrics = vec![metric(LifecycleMetricKey::DocsCleanPct, share, verifiable)];
    let (health, reason) = if t.broken > 0 {
        (
            LifecycleHealth::Red,
            Some(if t.broken == 1 {
                "1 doc names a path that no longer exists".to_string()
            } else {
                format!("{} docs name paths that no longer exist", t.broken)
            }),
        )
    } else if t.total == 0 {
        (
            LifecycleHealth::Unmeasured,
            Some("Docs have not been scanned yet".to_string()),
        )
    } else if verifiable == 0 {
        (
            LifecycleHealth::Unmeasured,
            Some(format!(
                "None of the {} docs can be verified against their sources",
                t.total
            )),
        )
    } else if share.unwrap_or(0.0) >= f64::from(clean_pct) {
        (LifecycleHealth::Green, None)
    } else {
        (
            LifecycleHealth::Amber,
            Some(format!(
                "{} of verifiable docs are clean, {}% needed",
                pct(share.unwrap_or(0.0)),
                clean_pct
            )),
        )
    };
    LifecycleStepHealthView {
        step_id: "docs".to_string(),
        health,
        stale_of: None,
        reason,
        metrics,
        measured_at: t.scanned_at.clone(),
        head_sha: None,
    }
}

fn evidence_step(step_id: &str, t: &LifecycleStepTally, target: u32) -> LifecycleStepHealthView {
    let counted = t.done + t.skipped + t.failed;
    let samples = u32::try_from(counted.max(0)).unwrap_or(u32::MAX);
    let rate = (samples > 0).then(|| t.done as f64 * 100.0 / counted as f64);
    let metrics = vec![metric(LifecycleMetricKey::DoneRate, rate, samples)];
    let (health, reason) = if samples < MIN_SAMPLES {
        (
            LifecycleHealth::Unmeasured,
            Some(format!(
                "Only {samples} changes recorded; {MIN_SAMPLES} are needed"
            )),
        )
    } else {
        let r = rate.unwrap_or(0.0);
        let why = Some(format!(
            "Done in {} of recent changes, {target}% needed",
            pct(r)
        ));
        if r >= f64::from(target) {
            (LifecycleHealth::Green, None)
        } else if r >= AMBER_FLOOR_PCT {
            (LifecycleHealth::Amber, why)
        } else {
            (LifecycleHealth::Red, why)
        }
    };
    verdict(step_id, health, reason, metrics)
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod tests;
