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
//!
//! [`snapshot`] is the one read model; [`current_doc`] and [`append`] are the
//! read and write doors every writer (commands, Athena ops) goes through.

pub mod contract;
pub mod detect;
pub mod evidence;
pub mod install;
pub mod presets;

use std::path::Path;

use crate::db::models::{
    LifecycleAuthor, LifecycleDoc, LifecycleEvidenceItem, LifecycleOutcome, LifecyclePreset,
    LifecycleSnapshot, LifecycleSourceKind, LifecycleStepOutcome, LifecycleStepTally,
    LifecycleStepView,
};
use crate::db::repos::dev::lifecycle::{self as repo, VersionRow};
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
    let base = project
        .main_branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .unwrap_or("main")
        .to_string();

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

    let steps = doc
        .steps
        .iter()
        .zip(bindings)
        .map(|(step, binding_views)| LifecycleStepView {
            evidence: tally(&items, &step.id),
            step: step.clone(),
            binding_views,
        })
        .collect();

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
    })
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
