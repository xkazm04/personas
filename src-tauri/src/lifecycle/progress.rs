//! The running Measure, command by command - derived on read, never stored.
//!
//! The slot ([`super::measure::ActiveMeasure`]) knows the plan and which
//! command the runner is executing; the ledger knows which commands already
//! answered. So: **Done** = a `dev_lifecycle_runs` row of this measure (its
//! outcome and duration), **Running** = the command the slot names (its start
//! time), **Pending** = the rest. The ETA (`median_ms`) is each command's
//! median over its complete runs (passed or failed) in the recent measures
//! the snapshot already loaded for health - no query of its own.

use std::collections::HashMap;

use crate::db::models::{
    LifecycleCommandProgress, LifecycleCommandState, LifecycleMeasureProgress, LifecycleRun,
    LifecycleRunOutcome,
};

use super::health::{median, HISTORY_MEASURES};
use super::measure::ActiveMeasure;

/// The progress of `active` given `runs` (the project's recent measure runs,
/// newest first, any measures). `None` until the Measure's plan resolved.
pub fn progress_view(
    active: &ActiveMeasure,
    runs: &[LifecycleRun],
) -> Option<LifecycleMeasureProgress> {
    if active.measure_id.is_empty() {
        return None;
    }
    let done: HashMap<&str, &LifecycleRun> = runs
        .iter()
        .filter(|r| r.measure_id == active.measure_id)
        .map(|r| (r.command_id.as_str(), r))
        .collect();
    let medians = command_medians(runs, &active.measure_id);
    let commands = active
        .commands
        .iter()
        .enumerate()
        .map(|(index, cmd)| {
            let median_ms = medians.get(cmd.id.as_str()).copied();
            let mut view = LifecycleCommandProgress {
                command_id: cmd.id.clone(),
                command: cmd.command.clone(),
                kind: cmd.kind,
                state: LifecycleCommandState::Pending,
                started_at: None,
                outcome: None,
                duration_ms: None,
                median_ms,
            };
            if let Some(row) = done.get(cmd.id.as_str()) {
                view.state = LifecycleCommandState::Done;
                view.started_at = Some(row.started_at.clone());
                view.outcome = Some(row.outcome);
                view.duration_ms = Some(row.duration_ms);
            } else if let Some((_, at)) = active.running.as_ref().filter(|(i, _)| *i == index) {
                view.state = LifecycleCommandState::Running;
                view.started_at = Some(at.clone());
            }
            view
        })
        .collect();
    Some(LifecycleMeasureProgress {
        measure_id: active.measure_id.clone(),
        started_at: active.started_at.clone(),
        head_sha: active.head_sha.clone(),
        commands,
        cancelling: active.cancel.is_cancelled(),
    })
}

/// Each command's median duration, in ms, over its newest
/// [`HISTORY_MEASURES`] complete runs outside the measure `running`.
fn command_medians<'a>(runs: &'a [LifecycleRun], running: &str) -> HashMap<&'a str, u32> {
    let mut samples: HashMap<&str, Vec<u64>> = HashMap::new();
    for r in runs.iter().filter(|r| {
        r.measure_id != running
            && matches!(
                r.outcome,
                LifecycleRunOutcome::Passed | LifecycleRunOutcome::Failed
            )
    }) {
        let v = samples.entry(r.command_id.as_str()).or_default();
        if v.len() < HISTORY_MEASURES {
            v.push(u64::from(r.duration_ms));
        }
    }
    samples
        .into_iter()
        .filter_map(|(id, mut v)| {
            let m = median(&mut v)?;
            Some((id, u32::try_from(m.round() as u64).unwrap_or(u32::MAX)))
        })
        .collect()
}

#[cfg(test)]
#[path = "progress_tests.rs"]
mod tests;
