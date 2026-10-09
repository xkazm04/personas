//! Slow gates become Director backlog items.
//!
//! After every measure, each command is checked against two rules, on its
//! runs that actually answered (`passed` / `failed`; a timeout or a command
//! that never ran has no honest duration):
//!
//! 1. **Over budget**: its latest answered run took longer than its budget
//!    (`budget_ms`, else the kind's default - see [`default_budget_ms`]).
//! 2. **Regression**: the mean of its last 3 runs exceeds 1.3x the median of
//!    every run before those, and only once there are at least
//!    [`MIN_PRIOR_RUNS`] prior runs - a floor, so two noisy samples never file
//!    an item.
//!
//! A hit files ONE item per command through the backlog's one door
//! ([`file_idea`]) with `dedup_key = "lifecycle:slow:<command_id>"`; a second
//! hit on the same command is `Ok(None)` from the door and stays silent. The
//! item's plan forbids the cheap ways to make a gate fast: weakening it,
//! skipping tests, or editing its configuration.

use std::path::Path;

use crate::db::models::{
    BacklogSource, IdeaDraft, IdeaPlan, LifecycleGateCommand, LifecycleRun, LifecycleRunOutcome,
    PlanStep,
};
use crate::db::repos::dev::ideas::file_idea;
use crate::db::repos::dev::lifecycle_runs::{list_runs, RunQuery};
use crate::db::DbPool;
use crate::error::AppError;

use super::health::{default_budget_ms, fmt_ms};

/// Prior runs a regression needs before it can be called one.
pub const MIN_PRIOR_RUNS: usize = 5;
/// Recent runs whose mean is compared.
pub const RECENT_RUNS: usize = 3;
/// How much slower the recent mean must be than the prior median.
pub const REGRESSION_FACTOR: f64 = 1.3;
/// History read per command.
const HISTORY_RUNS: usize = 30;

/// Why a command is slow.
#[derive(Debug, Clone, PartialEq)]
pub enum SlowFinding {
    OverBudget {
        run: Box<LifecycleRun>,
        budget_ms: u32,
    },
    Regression {
        recent_mean_ms: f64,
        prior_median_ms: f64,
        recent: Vec<LifecycleRun>,
        prior_runs: usize,
    },
}

/// Judge one command from its answered runs, newest first. Pure.
pub fn judge(runs_newest_first: &[LifecycleRun], budget_ms: u32) -> Option<SlowFinding> {
    let answered: Vec<&LifecycleRun> = runs_newest_first
        .iter()
        .filter(|r| {
            matches!(
                r.outcome,
                LifecycleRunOutcome::Passed | LifecycleRunOutcome::Failed
            )
        })
        .collect();
    let latest = answered.first()?;
    if latest.duration_ms > budget_ms {
        return Some(SlowFinding::OverBudget {
            run: Box::new((*latest).clone()),
            budget_ms,
        });
    }
    if answered.len() < RECENT_RUNS + MIN_PRIOR_RUNS {
        return None;
    }
    let (recent, prior) = answered.split_at(RECENT_RUNS);
    let recent_mean_ms =
        recent.iter().map(|r| f64::from(r.duration_ms)).sum::<f64>() / recent.len() as f64;
    let mut prior_ms: Vec<u32> = prior.iter().map(|r| r.duration_ms).collect();
    prior_ms.sort_unstable();
    let mid = prior_ms.len() / 2;
    let prior_median_ms = if prior_ms.len() % 2 == 0 {
        (f64::from(prior_ms[mid - 1]) + f64::from(prior_ms[mid])) / 2.0
    } else {
        f64::from(prior_ms[mid])
    };
    (recent_mean_ms > REGRESSION_FACTOR * prior_median_ms).then(|| SlowFinding::Regression {
        recent_mean_ms,
        prior_median_ms,
        recent: recent.iter().map(|r| (*r).clone()).collect(),
        prior_runs: prior.len(),
    })
}

/// Check every command of the measure just run and file what is slow.
/// Returns how many NEW items were filed (a dedup hit is not counted).
pub fn file_slow_gates(
    pool: &DbPool,
    project_id: &str,
    root: &Path,
    commands: &[LifecycleGateCommand],
) -> Result<u32, AppError> {
    let mut filed = 0;
    for cmd in commands {
        let runs = list_runs(
            pool,
            &RunQuery {
                project_id,
                command_id: Some(&cmd.id),
                limit: Some(HISTORY_RUNS),
                ..Default::default()
            },
        )?;
        let budget = cmd.budget_ms.unwrap_or_else(|| default_budget_ms(cmd.kind));
        let Some(finding) = judge(&runs, budget) else {
            continue;
        };
        if file_idea(pool, draft(project_id, root, cmd, &finding))?.is_some() {
            filed += 1;
        }
    }
    Ok(filed)
}

fn endpoints(r: &LifecycleRun) -> String {
    format!(
        "{} ({} -> {}, base tip {}, measure {})",
        fmt_ms(u64::from(r.duration_ms)),
        r.started_at,
        r.finished_at,
        r.head_sha.get(..10).unwrap_or(&r.head_sha),
        r.measure_id
    )
}

/// The source tree a slow command most plausibly measures, repo-relative.
fn scope(root: &Path, command: &str) -> String {
    if let Some(i) = command.find("--manifest-path ") {
        let manifest = command[i + "--manifest-path ".len()..]
            .split_whitespace()
            .next()
            .unwrap_or("");
        if let Some((dir, _)) = manifest.rsplit_once('/') {
            return format!("{dir}/");
        }
    }
    if root.join("src").is_dir() {
        "src/".to_string()
    } else {
        ".".to_string()
    }
}

fn draft(
    project_id: &str,
    root: &Path,
    cmd: &LifecycleGateCommand,
    finding: &SlowFinding,
) -> IdeaDraft {
    let (title, measured, impact) = match finding {
        SlowFinding::OverBudget { run, budget_ms } => (
            format!(
                "Gate `{}` takes {}, over its {} budget",
                cmd.id,
                fmt_ms(u64::from(run.duration_ms)),
                fmt_ms(u64::from(*budget_ms))
            ),
            format!(
                "Latest answered run: {}. Budget: {} ({}).",
                endpoints(run),
                fmt_ms(u64::from(*budget_ms)),
                if cmd.budget_ms.is_some() {
                    "set on the step"
                } else {
                    "the default for its kind"
                }
            ),
            3,
        ),
        SlowFinding::Regression {
            recent_mean_ms,
            prior_median_ms,
            recent,
            prior_runs,
        } => (
            format!(
                "Gate `{}` slowed {}% (recent mean {} vs prior median {})",
                cmd.id,
                ((recent_mean_ms / prior_median_ms - 1.0) * 100.0).round() as i64,
                fmt_ms(*recent_mean_ms as u64),
                fmt_ms(*prior_median_ms as u64)
            ),
            format!(
                "Mean of the last {} runs: {} - {}. Median of the {prior_runs} runs before \
                 them: {}. Threshold: {REGRESSION_FACTOR}x.",
                recent.len(),
                fmt_ms(*recent_mean_ms as u64),
                recent.iter().map(endpoints).collect::<Vec<_>>().join("; "),
                fmt_ms(*prior_median_ms as u64)
            ),
            2,
        ),
    };
    let files = vec![scope(root, &cmd.command)];
    let mut d = IdeaDraft::new(project_id, BacklogSource::Lifecycle, title);
    d.category = Some("performance".into());
    d.scan_type = Some("lifecycle_slow_gate".into());
    d.description = Some(format!(
        "Lifecycle Measure timed `{}` ({:?}) on the base-branch tip. {measured} A slow gate is \
         usually a code-structure signal (one module everything imports, a test that builds \
         the world), so the fix belongs in the code, not in the gate.",
        cmd.command, cmd.kind
    ));
    d.evidence = Some(measured);
    d.effort = Some(3);
    d.impact = Some(impact);
    d.risk = Some(2);
    d.dedup_key = Some(format!("lifecycle:slow:{}", cmd.id));
    d.plan = Some(IdeaPlan {
        steps: vec![
            PlanStep {
                n: 1,
                action: format!(
                    "Profile `{}` and name the slowest part (a file, a suite, a compile unit)",
                    cmd.command
                ),
                files: files.clone(),
                done_when: "The slowest part is named with its own measured time".into(),
            },
            PlanStep {
                n: 2,
                action: "Split or parallelize the slowest part; do not weaken the gate, skip \
                         tests, or change gate config"
                    .into(),
                files,
                done_when: format!(
                    "A Lifecycle Measure on the base tip times `{}` under its budget with the \
                     same pass/fail result",
                    cmd.id
                ),
            },
        ],
    });
    d
}

#[cfg(test)]
#[path = "slow_tests.rs"]
mod tests;
