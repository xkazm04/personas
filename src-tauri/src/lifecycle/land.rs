//! A finished Run Desk task's lifecycle bookkeeping, called from
//! `task_executor::finalize_task`: read the evidence from its branch, land it
//! when the project's practice says the app lands (Solo `local_merge`), and
//! store one evidence row.
//!
//! The land goes through `companion::dev_mode::apply_dev_branch`, the one
//! verified land primitive (fast-forward, else a single-commit cherry-pick,
//! else a no-ff merge; aborts on conflict, never auto-resolves, prunes the
//! worktree and branch only after it verified the content reached HEAD). It
//! takes plain paths and a branch and holds no dev-mode state, so a worktree
//! made by `engine::unattended_worktree` is as valid an input as a dev op's.
//!
//! Best-effort: nothing here can change a task's terminal status.

use std::path::Path;

use personas_engine::git_checkpoint::run_git_blocking as git;

use super::evidence::{self, TaskFacts};
use crate::db::models::{
    LifecycleDoc, LifecycleLandMode, LifecycleOutcome as O, LifecycleStepOutcome,
};
use crate::db::repos::dev::lifecycle as repo;
use crate::db::repos::dev::{projects as project_repo, tasks as task_repo};
use crate::db::DbPool;
use crate::error::AppError;

/// Uncommitted drift `apply_dev_branch` restores itself before judging the tree
/// dirty (`companion::dev_mode::LOCKFILE_NOISE`, private there); the pre-check
/// must not call a tree dirty over them either.
const LOCKFILE_NOISE: [&str; 3] = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"];

/// Longest failure reason kept on an outcome.
const REASON_MAX: usize = 400;

fn set(outcomes: &mut [LifecycleStepOutcome], id: &str, outcome: O, detail: String) {
    if let Some(o) = outcomes.iter_mut().find(|o| o.step_id == id) {
        o.outcome = outcome;
        o.detail = Some(detail);
    }
}

fn outcome_of(outcomes: &[LifecycleStepOutcome], id: &str) -> Option<O> {
    outcomes.iter().find(|o| o.step_id == id).map(|o| o.outcome)
}

/// Real uncommitted paths in `workspace` (lockfile noise excluded); `None` when
/// git could not say.
fn dirty_paths(workspace: &Path) -> Option<usize> {
    let status = git(workspace, &["status", "--porcelain"]).ok()?;
    Some(
        status
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter(|l| !LOCKFILE_NOISE.iter().any(|n| l.trim_end().ends_with(n)))
            .count(),
    )
}

/// Strategy + sha out of a verified `MergeOutcome`.
fn land_detail(message: &str, sha: &str) -> String {
    let first = message.lines().next().unwrap_or("");
    let strategy = if first.contains("already applied upstream") {
        "already applied"
    } else {
        first
            .rfind('(')
            .and_then(|i| first[i + 1..].split(')').next())
            .unwrap_or("merged")
    };
    format!("{strategy}, landed {sha}")
}

/// Decide and (for Solo) perform the land. Returns the land outcome.
fn land(
    doc: &LifecycleDoc,
    root: &Path,
    workspace: &Path,
    branch: Option<&str>,
    base: &str,
    succeeded: bool,
    ev: &evidence::TaskEvidence,
) -> Option<(O, String)> {
    let step = doc.steps.iter().find(|s| s.id == "land")?;
    let skip = |why: &str| Some((O::Skipped, why.to_string()));
    if !succeeded {
        return skip("the task did not complete");
    }
    match step.params.land_mode {
        Some(LifecycleLandMode::PullRequest) => return skip("pull request expected"),
        None => return skip("no land mode in the practice"),
        Some(LifecycleLandMode::LocalMerge) => {}
    }
    let Some(branch) = branch else {
        return skip("not isolated, nothing to land");
    };
    match ev.commits_ahead {
        None => return skip("git could not count the branch's commits"),
        Some(0) => return skip("no commits to land"),
        Some(_) => {}
    }
    match dirty_paths(workspace) {
        None => return skip("git could not read the worktree"),
        Some(0) => {}
        Some(n) => return skip(&format!("worktree has {n} uncommitted path(s)")),
    }
    if outcome_of(&ev.outcomes, "gate") == Some(O::Failed) {
        return skip("gate failed");
    }
    // `apply_dev_branch` lands onto whatever the checkout has checked out: only
    // land when that IS the base, never into an operator's feature branch.
    let head = git(root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    if head != base {
        return skip(&format!(
            "the project checkout is on `{head}`, not `{base}`"
        ));
    }
    Some(
        match crate::companion::dev_mode::apply_dev_branch(root, workspace, branch) {
            Ok(m) => (O::Done, land_detail(&m.message, &m.landed_sha)),
            Err(reason) => (O::Failed, reason.chars().take(REASON_MAX).collect()),
        },
    )
}

/// Record the lifecycle evidence of a finished task (and land it when the
/// practice says so). `Ok(None)` when the task has no project. Returns the
/// stored outcomes.
pub fn record_task(
    pool: &DbPool,
    task_id: &str,
    succeeded: bool,
    output_lines: Option<i32>,
) -> Result<Option<Vec<LifecycleStepOutcome>>, AppError> {
    let task = task_repo::get_task_by_id(pool, task_id)?;
    let Some(project_id) = task.project_id.as_deref().filter(|p| !p.trim().is_empty()) else {
        return Ok(None);
    };
    let project = project_repo::get_project_by_id(pool, project_id)?;
    let (doc, _, _) = super::current_doc(pool, project_id)?;
    let root = Path::new(&project.root_path);
    let branch = task
        .worktree_branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty());
    let workspace = task
        .worktree_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty() && branch.is_some())
        .map(Path::new)
        .unwrap_or(root);
    let base = evidence::resolve_base(root, project.main_branch.as_deref())
        .unwrap_or_else(|| "main".to_string());
    let facts = TaskFacts {
        task_id: Some(task_id),
        fallback_reason: task.worktree_fallback_reason.as_deref(),
        output_nonempty: output_lines.map(|n| n > 0),
    };
    let ev = evidence::task_evidence_with(root, workspace, branch, &base, &doc, &facts);
    let mut outcomes = ev.outcomes.clone();
    if let Some((outcome, detail)) = land(&doc, root, workspace, branch, &base, succeeded, &ev) {
        if outcome == O::Failed {
            tracing::warn!(task_id, project_id, reason = %detail,
                "lifecycle: auto-land refused; the branch is kept");
        }
        set(&mut outcomes, "land", outcome, detail);
    }
    let json = serde_json::to_string(&outcomes)
        .map_err(|e| AppError::Internal(format!("serialize lifecycle outcomes: {e}")))?;
    let occurred_at = task
        .completed_at
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    repo::upsert_task_evidence(pool, project_id, task_id, &task.title, &json, &occurred_at)?;
    Ok(Some(outcomes))
}

#[cfg(test)]
#[path = "land_tests.rs"]
mod tests;
