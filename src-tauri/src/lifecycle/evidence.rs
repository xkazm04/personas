//! Git-derived evidence: what actually happened per step.
//!
//! - [`task_evidence`] reads a finished task's branch (stored by `finalize_task`
//!   through `db::repos::dev::lifecycle::upsert_task_evidence`).
//! - [`commit_evidence`] reads recent commits on the base branch for manual CLI
//!   work, derived on read and never stored.
//!
//! A step git cannot observe is `unknown`, never `done`.
//!
//! STUB (WP1): final signatures, empty output. WP2 implements both.

use std::path::Path;

use crate::db::models::{LifecycleDoc, LifecycleEvidenceItem, LifecycleStepOutcome};

/// Per-step outcomes for a task that worked on `branch` (in `workspace`, which
/// may be a worktree of `root`) against `base`.
// WP1 stub: `finalize_task` calls it in WP2.
#[allow(dead_code)]
pub fn task_evidence(
    root: &Path,
    workspace: &Path,
    branch: &str,
    base: &str,
    doc: &LifecycleDoc,
) -> Vec<LifecycleStepOutcome> {
    let _ = (root, workspace, branch, base, doc);
    Vec::new()
}

/// Evidence items for the last `limit` commits on `base` (PR merge commits for
/// Team), newest first.
pub fn commit_evidence(
    root: &Path,
    base: &str,
    doc: &LifecycleDoc,
    limit: usize,
) -> Vec<LifecycleEvidenceItem> {
    let _ = (root, base, doc, limit);
    Vec::new()
}
