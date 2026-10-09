//! A step's layer-2 data, one run's output, and the auto-detection preview.
//!
//! - [`step_detail`] - what the step screen draws: runs (per command), doc
//!   rows, related backlog items and the step's evidence history.
//! - [`run_output`] - the stored tail of one run's output, kept out of every
//!   list payload (see `measure::stored_output` for its shape).
//! - [`detected_commands`] - what auto-detection would run for the project
//!   right now, whatever the steps are configured to run.

use std::path::Path;

use crate::db::models::{
    DevProject, LifecycleDocRow, LifecycleEvidenceItem, LifecycleGateCommand, LifecycleStepDetail,
};
use crate::db::repos::dev::doc_status as doc_status_repo;
use crate::db::repos::dev::lifecycle_runs as runs_repo;
use crate::db::repos::dev::projects as project_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::detect_commands::{detect_commands, kinds_of};

/// Most runs a step detail carries PER COMMAND of the step.
pub const STEP_DETAIL_RUNS: usize = 30;
/// Most changes a step detail's evidence history looks back over.
pub const STEP_DETAIL_EVIDENCE: usize = 200;

/// Layer-2 data for one step: `gate` / `tests` get their command runs (the
/// newest [`STEP_DETAIL_RUNS`] of each command, merged newest first), `docs`
/// gets the per-doc rot rows, other steps two empty lists. Every step gets
/// its related backlog items ([`super::related`]) and its evidence history
/// ([`step_evidence`]). Reads manifests and runs git: call it off the IPC
/// thread.
pub fn step_detail(
    pool: &DbPool,
    project_id: &str,
    step_id: &str,
) -> Result<LifecycleStepDetail, AppError> {
    let project = project_repo::get_project_by_id(pool, project_id)?;
    let kinds = kinds_of(step_id);
    let runs = if kinds.is_empty() {
        Vec::new()
    } else {
        runs_repo::list_runs_per_command(pool, project_id, kinds, STEP_DETAIL_RUNS)?
    };
    let docs = if step_id == "docs" {
        doc_status_repo::list_doc_status(pool, project_id)?
            .into_iter()
            .map(|row| {
                let (status, broken_refs) = super::doc_status_of(&row);
                LifecycleDocRow {
                    status: status.to_string(),
                    broken_refs,
                    changed_sources: row
                        .changed_sources
                        .as_deref()
                        .and_then(|j| serde_json::from_str(j).ok())
                        .unwrap_or_default(),
                    scanned_at: Some(row.scanned_at),
                    doc_path: row.doc_path,
                }
            })
            .collect()
    } else {
        Vec::new()
    };
    let related = super::related::related_items(
        pool,
        project_id,
        step_id,
        runs.iter().map(|r| r.command_id.clone()),
    )?;
    let evidence = step_evidence(pool, &project, step_id)?;
    Ok(LifecycleStepDetail {
        step_id: step_id.to_string(),
        runs,
        docs,
        related,
        evidence,
    })
}

/// The step's evidence: of the newest [`STEP_DETAIL_EVIDENCE`] changes (the
/// snapshot's sources, see [`super::evidence_items`]), those carrying an
/// outcome for `step_id`, each reduced to that one outcome. Newest first.
fn step_evidence(
    pool: &DbPool,
    project: &DevProject,
    step_id: &str,
) -> Result<Vec<LifecycleEvidenceItem>, AppError> {
    let (doc, _, _) = super::current_doc(pool, &project.id)?;
    let root = Path::new(&project.root_path);
    let base = super::evidence::resolve_base(root, project.main_branch.as_deref())
        .unwrap_or_else(|| "main".to_string());
    Ok(
        super::evidence_items(pool, &project.id, root, &base, &doc, STEP_DETAIL_EVIDENCE)?
            .into_iter()
            .filter_map(|item| project_step(item, step_id))
            .collect(),
    )
}

/// `item` with only `step_id`'s outcome; `None` when it has none. Pure.
pub fn project_step(
    mut item: LifecycleEvidenceItem,
    step_id: &str,
) -> Option<LifecycleEvidenceItem> {
    item.outcomes.retain(|o| o.step_id == step_id);
    (!item.outcomes.is_empty()).then_some(item)
}

/// The stored output of run `run_id`: `None` when nothing was captured,
/// `Some("")` when the command ran and printed nothing. `NotFound` when the
/// project has no such run (a run of another project included).
pub fn run_output(
    pool: &DbPool,
    project_id: &str,
    run_id: &str,
) -> Result<Option<String>, AppError> {
    runs_repo::run_output(pool, project_id, run_id)?
        .ok_or_else(|| AppError::NotFound(format!("lifecycle run {run_id} of this project")))
}

/// What auto-detection ([`detect_commands`]) finds in the project's
/// manifests right now, regardless of the commands the steps configure: the
/// "we found these" list before the first Measure. Reads files: call it off
/// the IPC thread.
pub fn detected_commands(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<LifecycleGateCommand>, AppError> {
    let project = project_repo::get_project_by_id(pool, project_id)?;
    Ok(detect_commands(Path::new(&project.root_path)))
}

#[cfg(test)]
#[path = "detail_tests.rs"]
mod tests;
