//! Lifecycle v2 - each project's development practice.
//!
//! The document ([`LifecycleDoc`]) is an ordered set of steps before and after
//! every dev task, versioned append-only in `dev_lifecycle_versions`. An absent
//! row is the implicit Solo default (version 0, author `default`).
//!
//! - [`presets`] - the two built-in documents and the `standards_config`
//!   projection (the column is derived, written with every version append).
//! - [`detect`] - binding states read from the repo.
//! - [`contract`] - the block injected into sessions the app starts.
//! - [`evidence`] - per-step outcomes read from git.
//! - [`install`] - "Install into repo" as a Run Desk task.
//! - [`land`] - a finished task's evidence row and the Solo auto-land.
//! - [`measure`] - Measure: the gate/test/coverage commands run on the base
//!   tip in a throwaway worktree, timed, into `dev_lifecycle_runs`.
//! - [`health`] - the measured verdict per step (pure);
//!   [`detect_commands`] - the commands a step runs when none are configured;
//!   [`slow`] - over-budget and regressing commands filed as backlog items.
//! - [`overseer`] - the Overseer's "All steps green" goal: watch, send, and
//!   close by observation after every Measure.
//!
//! [`snapshot`] is the one read model; [`current_doc`] and [`append`] are the
//! read and write doors every writer (commands, Athena ops) goes through.

pub mod contract;
pub mod detect;
pub mod detect_commands;
pub mod evidence;
pub mod health;
pub mod install;
pub mod land;
pub mod measure;
pub mod overseer;
pub mod presets;
pub mod slow;

pub use contract::{contract_for_project, ContractContext};

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::db::models::{
    LifecycleAuthor, LifecycleDoc, LifecycleDocRow, LifecycleEvidenceItem, LifecycleGateCommand,
    LifecycleOutcome, LifecyclePreset, LifecycleSnapshot, LifecycleSourceKind, LifecycleStepDetail,
    LifecycleStepHealthView, LifecycleStepOutcome, LifecycleStepParams, LifecycleStepTally,
    LifecycleStepView,
};
use crate::db::repos::dev::doc_status::{self as doc_status_repo, DocStatusRow};
use crate::db::repos::dev::lifecycle::{self as repo, VersionRow};
use crate::db::repos::dev::lifecycle_runs::{self as runs_repo, RunQuery};
use crate::db::repos::dev::{projects as project_repo, tasks as task_repo};
use crate::db::DbPool;
use crate::error::AppError;

/// At most this many evidence items in a snapshot.
pub const EVIDENCE_LIMIT: usize = 20;

/// Dev task statuses after which an install task is no longer pending.
const TERMINAL_TASK_STATUSES: [&str; 3] = ["completed", "failed", "cancelled"];

/// The project's current document, its version (0 = implicit default) and the
/// stored row it came from (`None` for the implicit default).
pub fn current_doc(
    pool: &DbPool,
    project_id: &str,
) -> Result<(LifecycleDoc, i64, Option<VersionRow>), AppError> {
    match repo::latest_version(pool, project_id)? {
        None => Ok((presets::preset_doc(LifecyclePreset::Solo), 0, None)),
        Some(row) => {
            let doc = parse_doc(&row);
            Ok((doc, row.version, Some(row)))
        }
    }
}

/// A stored document; an unreadable one falls back to its preset's built-in
/// document rather than bricking every reader.
fn parse_doc(row: &VersionRow) -> LifecycleDoc {
    serde_json::from_str::<LifecycleDoc>(&row.doc_json).unwrap_or_else(|e| {
        tracing::warn!(
            project_id = %row.project_id,
            version = row.version,
            error = %e,
            "unreadable lifecycle doc_json; falling back to the preset document"
        );
        presets::preset_doc(LifecyclePreset::parse(&row.preset).unwrap_or(LifecyclePreset::Solo))
    })
}

/// Append `doc` as the project's next version and rewrite `standards_config`
/// with its projection, in one transaction. `author` must not be `Default`
/// (the default is never stored).
pub fn append(
    pool: &DbPool,
    project_id: &str,
    doc: &LifecycleDoc,
    change_note: Option<&str>,
    author: LifecycleAuthor,
) -> Result<VersionRow, AppError> {
    if author == LifecycleAuthor::Default {
        return Err(AppError::Validation(
            "the implicit default lifecycle is never stored".into(),
        ));
    }
    let doc_json = serde_json::to_string(doc)
        .map_err(|e| AppError::Internal(format!("serialize lifecycle doc: {e}")))?;
    repo::append_version(
        pool,
        project_id,
        doc.preset.as_str(),
        &doc_json,
        change_note,
        author.as_str(),
        &presets::standards_projection(doc),
    )
}

/// Switch the project to a built-in preset (author `operator`). A no-op when
/// the latest stored version already IS that preset's document; returns whether
/// a version was appended. An implicit v0 always appends (v0 -> v1).
pub fn set_preset(
    pool: &DbPool,
    project_id: &str,
    preset: LifecyclePreset,
) -> Result<bool, AppError> {
    let target = presets::preset_doc(preset);
    if let Some(row) = repo::latest_version(pool, project_id)? {
        let stored = serde_json::from_str::<LifecycleDoc>(&row.doc_json).ok();
        if row.preset == preset.as_str() && stored.as_ref() == Some(&target) {
            return Ok(false);
        }
    }
    let note = format!("Preset set to {}", preset.as_str());
    append(
        pool,
        project_id,
        &target,
        Some(&note),
        LifecycleAuthor::Operator,
    )?;
    Ok(true)
}

/// The old standards door (`dev_tools_set_standards_config`): map a
/// `standards_config` envelope onto the current document and append it as a new
/// version (author `operator`), which rewrites the column through the
/// projection. `None` (clear) maps to "nothing enabled". An edit that changes
/// nothing on an already-stored version appends nothing.
pub fn apply_standards_edit(
    pool: &DbPool,
    project_id: &str,
    config: Option<&str>,
) -> Result<(), AppError> {
    if let Some(json) = config {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| AppError::Validation(format!("Invalid standards_config JSON: {e}")))?;
    }
    let (doc, _, row) = current_doc(pool, project_id)?;
    let next = presets::apply_standards(&doc, config.unwrap_or("{}"));
    if row.is_some() && next == doc {
        return Ok(());
    }
    append(
        pool,
        project_id,
        &next,
        Some("Standards edited"),
        LifecycleAuthor::Operator,
    )?;
    Ok(())
}

/// The one read model: preset, version, steps with binding states and evidence
/// tallies, the install task, and the newest evidence. Reads files and runs git
/// (through [`evidence`]); call it off the IPC thread.
pub fn snapshot(pool: &DbPool, project_id: &str) -> Result<LifecycleSnapshot, AppError> {
    let project = project_repo::get_project_by_id(pool, project_id)?;
    let (doc, version, row) = current_doc(pool, project_id)?;
    let root = Path::new(&project.root_path);
    // The recorded branch when it exists, else main/master: a repo whose default
    // is `master` and whose row records none must still show its commits.
    let base = evidence::resolve_base(root, project.main_branch.as_deref())
        .unwrap_or_else(|| "main".to_string());

    let install_task_id = row.as_ref().and_then(|r| r.install_task_id.clone());
    let install_task_status = install_task_id
        .as_deref()
        .and_then(|id| task_repo::get_task_by_id(pool, id).ok())
        .map(|t| t.status);
    let install_pending = install_task_id.is_some()
        && !install_task_status
            .as_deref()
            .is_some_and(|s| TERMINAL_TASK_STATUSES.contains(&s));

    let bindings = detect::detect_bindings(root, &doc, version, install_pending);

    let mut items: Vec<LifecycleEvidenceItem> =
        repo::list_task_evidence(pool, project_id, EVIDENCE_LIMIT)?
            .into_iter()
            .map(|e| LifecycleEvidenceItem {
                source_kind: LifecycleSourceKind::Task,
                outcomes: serde_json::from_str::<Vec<LifecycleStepOutcome>>(&e.outcomes_json)
                    .unwrap_or_else(|err| {
                        tracing::warn!(
                            task_id = %e.source_ref,
                            error = %err,
                            "unreadable lifecycle evidence outcomes; showing none"
                        );
                        Vec::new()
                    }),
                source_ref: e.source_ref,
                title: e.title,
                occurred_at: e.occurred_at,
            })
            .collect();
    items.extend(evidence::commit_evidence(root, &base, &doc, EVIDENCE_LIMIT));
    items.sort_by(|a, b| b.occurred_at.cmp(&a.occurred_at));
    items.truncate(EVIDENCE_LIMIT);

    let steps: Vec<LifecycleStepView> = doc
        .steps
        .iter()
        .zip(bindings)
        .map(|(step, binding_views)| LifecycleStepView {
            evidence: tally(&items, &step.id),
            step: step.clone(),
            binding_views,
        })
        .collect();
    let health = measured_health(
        pool,
        project_id,
        root,
        project.main_branch.as_deref(),
        &steps,
    )?;
    let goal = overseer::goal_view(pool, project_id, &health)?;

    Ok(LifecycleSnapshot {
        project_id: project_id.to_string(),
        preset: doc.preset,
        version,
        author: row
            .as_ref()
            .and_then(|r| LifecycleAuthor::parse(&r.author))
            .unwrap_or(LifecycleAuthor::Default),
        change_note: row.as_ref().and_then(|r| r.change_note.clone()),
        created_at: row.as_ref().map(|r| r.created_at.clone()),
        steps,
        install_task_id,
        install_task_status,
        evidence: items,
        health,
        goal,
        watched: overseer::is_watched(pool, project_id),
        measuring: measure::measuring(project_id),
    })
}

/// The measured verdict of every step, in step order (see [`health`]).
fn measured_health(
    pool: &DbPool,
    project_id: &str,
    root: &Path,
    recorded_base: Option<&str>,
    steps: &[LifecycleStepView],
) -> Result<Vec<LifecycleStepHealthView>, AppError> {
    let runs = runs_repo::list_recent_measure_runs(pool, project_id, health::HISTORY_MEASURES)?;
    // No tip (not a repo, git missing) means no stale check, not a stale step.
    let current_tip = measure::base_tip(root, recorded_base).ok();
    let budgets: HashMap<String, u32> = steps
        .iter()
        .filter_map(|v| v.step.params.commands.as_ref())
        .flatten()
        .filter_map(|c| c.budget_ms.map(|b| (c.id.clone(), b)))
        .collect();
    let docs = doc_tally(&doc_status_repo::list_doc_status(pool, project_id)?);
    Ok(health::step_health(&health::HealthInput {
        steps,
        runs: &runs,
        current_tip: current_tip.as_deref(),
        budgets: &budgets,
        docs: &docs,
    }))
}

/// A doc row's verdict, named by the doc-rot scan's own label function.
fn doc_status_of(row: &DocStatusRow) -> (&'static str, Vec<String>) {
    let broken: Vec<String> = row
        .broken_refs
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_default();
    let status = crate::commands::infrastructure::doc_rot::doc_status_label(
        row.coupled_scope.is_none(),
        row.dirty_since.is_some(),
        &broken,
    );
    (status, broken)
}

fn doc_tally(rows: &[DocStatusRow]) -> health::DocTally {
    let mut t = health::DocTally::default();
    for row in rows {
        t.total += 1;
        match doc_status_of(row).0 {
            "broken" => t.broken += 1,
            "unverifiable" => t.unverifiable += 1,
            "clean" => t.clean += 1,
            _ => {}
        }
        if t.scanned_at.as_deref() < Some(row.scanned_at.as_str()) {
            t.scanned_at = Some(row.scanned_at.clone());
        }
    }
    t
}

/// Most runs a step detail carries.
pub const STEP_DETAIL_RUNS: usize = 30;

/// Layer-2 data for one step: `gate` / `tests` get their command runs (newest
/// first, at most [`STEP_DETAIL_RUNS`]), `docs` gets the per-doc rot rows,
/// every other step two empty lists.
pub fn step_detail(
    pool: &DbPool,
    project_id: &str,
    step_id: &str,
) -> Result<LifecycleStepDetail, AppError> {
    let kinds = detect_commands::kinds_of(step_id);
    let runs = if kinds.is_empty() {
        Vec::new()
    } else {
        runs_repo::list_runs(
            pool,
            &RunQuery {
                project_id,
                kinds,
                limit: Some(STEP_DETAIL_RUNS),
                ..Default::default()
            },
        )?
    };
    let docs = if step_id == "docs" {
        doc_status_repo::list_doc_status(pool, project_id)?
            .into_iter()
            .map(|row| {
                let (status, broken_refs) = doc_status_of(&row);
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
    Ok(LifecycleStepDetail {
        step_id: step_id.to_string(),
        runs,
        docs,
    })
}

/// Commands a step's params may carry: non-empty, unique ids, a positive
/// budget, and a kind that belongs to the step (Lint/Typecheck/Check/Other
/// under `gate`, Test/Coverage under `tests`) - the kind decides which step a
/// run is judged under, so a mismatch would measure it in the wrong place.
pub fn validate_commands(step_id: &str, cmds: &[LifecycleGateCommand]) -> Result<(), AppError> {
    if !matches!(step_id, "gate" | "tests") {
        return Err(AppError::Validation(format!(
            "step {step_id} runs no commands; only gate and tests do"
        )));
    }
    let kinds = detect_commands::kinds_of(step_id);
    let mut seen = HashSet::new();
    for c in cmds {
        personas_core::validation::require_non_empty("Command id", &c.id)?;
        personas_core::validation::require_non_empty("Command", &c.command)?;
        if !seen.insert(c.id.as_str()) {
            return Err(AppError::Validation(format!(
                "command id {} is used twice",
                c.id
            )));
        }
        if c.budget_ms == Some(0) {
            return Err(AppError::Validation(format!(
                "command {} needs a budget above zero",
                c.id
            )));
        }
        if !kinds.contains(&c.kind) {
            return Err(AppError::Validation(format!(
                "command {} is {:?}, which is measured under {}, not {step_id}",
                c.id,
                c.kind,
                detect_commands::step_of(c.kind)
            )));
        }
    }
    Ok(())
}

/// Replace one step's params in the current document and append it as a new
/// version authored `operator`. Commands are validated ([`validate_commands`])
/// and so are the percentage targets (0-100).
pub fn set_step_params(
    pool: &DbPool,
    project_id: &str,
    step_id: &str,
    params: LifecycleStepParams,
) -> Result<(), AppError> {
    if let Some(cmds) = &params.commands {
        validate_commands(step_id, cmds)?;
    }
    for (name, pct) in [
        ("coverageGreenPct", params.coverage_green_pct),
        ("docsCleanPct", params.docs_clean_pct),
        ("doneRatePct", params.done_rate_pct),
    ] {
        if pct.is_some_and(|p| p > 100) {
            return Err(AppError::Validation(format!("{name} must be 0-100")));
        }
    }
    let (mut doc, _, _) = current_doc(pool, project_id)?;
    let step = doc
        .steps
        .iter_mut()
        .find(|s| s.id == step_id)
        .ok_or_else(|| AppError::NotFound(format!("lifecycle step {step_id}")))?;
    step.params = params;
    append(
        pool,
        project_id,
        &doc,
        Some(&format!("Step {step_id} settings edited")),
        LifecycleAuthor::Operator,
    )?;
    Ok(())
}

/// Called after every Measure, once its rows are durable: the Overseer closes
/// what the measure observed green ([`overseer::after_measure`]). A cheap
/// no-op when the project has no open "All steps green" goal.
pub fn overseer_after_measure(pool: &DbPool, project_id: &str) -> Result<(), AppError> {
    let closed = overseer::after_measure(pool, project_id)?;
    if closed.closed_items > 0 || closed.goal_closed {
        tracing::info!(
            project_id,
            closed_items = closed.closed_items,
            goal_closed = closed.goal_closed,
            "lifecycle overseer: closed by observation"
        );
    }
    Ok(())
}

/// Outcome counts for one step over the snapshot's evidence window.
fn tally(items: &[LifecycleEvidenceItem], step_id: &str) -> LifecycleStepTally {
    let mut t = LifecycleStepTally::default();
    for o in items
        .iter()
        .flat_map(|i| i.outcomes.iter())
        .filter(|o| o.step_id == step_id)
    {
        match o.outcome {
            LifecycleOutcome::Done => t.done += 1,
            LifecycleOutcome::Skipped => t.skipped += 1,
            LifecycleOutcome::Unknown => t.unknown += 1,
            LifecycleOutcome::Failed => t.failed += 1,
        }
    }
    t
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
