//! Wires `personas_engine::git_checkpoint` into the dev-tools auto-run loop.
//!
//! The module and its `dev_run_checkpoints` index were built, tested, migrated
//! and left with **zero call sites** — the header still describes the problem
//! ("a run that goes sideways mid-task has no clean rewind") in the present
//! tense because, from the operator's side, it was still true. This connects
//! the capability to the loop it was written for; it adds no new capability.
//!
//! Three design decisions worth stating, because two of them depart from the
//! obvious reading:
//!
//! 1. **`snapshot_stage`, not `checkpoint_stage`.** `checkpoint_stage` does
//!    `git checkout -B personas/run/<id>` then `git add -A` then commits. The
//!    auto-run executes agent CLIs *in that same repository* — often in a
//!    Claude Code worktree under it — so switching HEAD mid-run would move the
//!    checkout under a working agent and stage its in-flight edits. The module
//!    says so itself, at `snapshot_stage`: "Use this (not `checkpoint_stage`,
//!    which switches branches) for auto-checkpointing inside a repo the user
//!    owns." A snapshot touches neither HEAD, the index, nor the worktree.
//!
//! 2. **The wave boundary is the stage boundary.** A wave's `JoinSet` is fully
//!    drained before the next one starts, so between waves no agent is mid-
//!    write. There is no other moment in this loop where the tree is quiet.
//!
//! 3. **A missing checkpoint is recorded, not swallowed.** The run is the
//!    product and the checkpoint is insurance, so a checkpoint failure never
//!    fails the run — but it lands an index row with an empty SHA and a typed
//!    `gap:<reason>` status, so a later rollback offer can say what it cannot
//!    reach instead of presenting a hole as continuous coverage.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::db::repos::dev_run_checkpoints as ckpt_repo;
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Why a stage boundary produced no usable checkpoint.
///
/// Typed rather than a free-form string because these rows are read back by a
/// rollback offer that has to distinguish "nothing changed, nothing to save"
/// from "we could not save it" — and the second kind is the one that has to be
/// shown to an operator before they trust a rewind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointGap {
    /// The run's project row, or its `root_path`, could not be resolved.
    WorkspaceUnknown,
    /// `root_path` exists but is not a git repository (or git is unavailable).
    NotAGitWorkspace,
    /// git ran and refused. The detail is logged, not stored — the row records
    /// the *class* of gap, and a stored stderr string is an injection surface
    /// in a value the UI renders.
    GitRefused,
}

impl CheckpointGap {
    /// The value stored in the index row's `status` column.
    pub fn as_status(self) -> &'static str {
        match self {
            Self::WorkspaceUnknown => "gap:workspace_unknown",
            Self::NotAGitWorkspace => "gap:not_a_git_workspace",
            Self::GitRefused => "gap:git_refused",
        }
    }
}

/// Record a gap row: an index entry with an empty SHA and a typed reason.
fn record_gap(pool: &DbPool, run_id: &str, stage: &str, gap: CheckpointGap) {
    tracing::warn!(
        run_id = %run_id,
        stage = %stage,
        gap = gap.as_status(),
        "auto-run: stage boundary left no checkpoint"
    );
    if let Err(e) = ckpt_repo::insert(pool, run_id, stage, "", gap.as_status()) {
        // The gap could not even be recorded as a gap. Nothing further to do:
        // failing the run over insurance bookkeeping is the wrong trade, and
        // the log line above is the surviving record.
        tracing::warn!(run_id = %run_id, error = %e, "auto-run: could not record checkpoint gap");
    }
}

/// Resolve the repository an auto-run is operating in, from the run's own
/// project row.
///
/// Deliberately derived from the run rather than passed in: the checkpoint
/// index carries no repository of its own, so the run's project *is* the
/// binding between a SHA and the tree it means something in.
fn workspace_for_run(pool: &DbPool, run_id: &str) -> Option<String> {
    let run = repo::get_auto_run(pool, run_id).ok().flatten()?;
    let project_id = run.project_id?;
    let project = repo::get_project_by_id(pool, &project_id).ok()?;
    let root = project.root_path;
    if root.trim().is_empty() {
        None
    } else {
        Some(root)
    }
}

/// Take a checkpoint at a stage boundary. **Never fails the run.**
///
/// `root_path` is the auto-run's workspace, already resolved by the caller (the
/// loop has it; re-reading it every wave would be a DB round trip per wave for
/// a value that cannot change mid-run).
pub async fn checkpoint_stage_boundary(
    pool: &DbPool,
    run_id: &str,
    stage: &str,
    root_path: Option<&str>,
) {
    let Some(root) = root_path else {
        record_gap(pool, run_id, stage, CheckpointGap::WorkspaceUnknown);
        return;
    };
    let dir = Path::new(root);
    if !dir.join(".git").exists() {
        record_gap(pool, run_id, stage, CheckpointGap::NotAGitWorkspace);
        return;
    }

    match personas_engine::git_checkpoint::snapshot_stage(dir, run_id, stage).await {
        // A clean tree is not a gap: the wave changed nothing, so there is
        // nothing an operator could want to return to. Recording a row here
        // would inflate coverage with entries that restore nothing.
        Ok(None) => {
            tracing::debug!(run_id = %run_id, stage = %stage, "auto-run: clean tree, no checkpoint");
        }
        Ok(Some(sha)) => {
            if let Err(e) = ckpt_repo::insert(pool, run_id, stage, &sha, "captured") {
                // The snapshot ref exists in git but the index does not know
                // about it — the exact drift this pairing of SQLite with git
                // can produce. Log it loudly; the ref stays reachable under
                // `refs/personas/checkpoints/<run_id>/` for manual recovery.
                tracing::warn!(
                    run_id = %run_id, stage = %stage, sha = %sha, error = %e,
                    "auto-run: checkpoint taken but index write failed (git/index drift)"
                );
            } else {
                tracing::info!(run_id = %run_id, stage = %stage, sha = %sha, "auto-run: checkpoint");
            }
        }
        Err(detail) => {
            tracing::warn!(run_id = %run_id, stage = %stage, detail = %detail, "auto-run: git refused");
            record_gap(pool, run_id, stage, CheckpointGap::GitRefused);
        }
    }
}

// -- Operator-reachable surface ---------------------------------------------

/// One row of the checkpoint index, plus what this repository actually says
/// about it right now.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCheckpointRow {
    pub id: String,
    pub stage: String,
    pub sha: String,
    pub status: String,
    pub created_at: String,
    /// `true` when the SHA resolves in the run's workspace. A captured row that
    /// is not reachable is index/git drift — the number the wiring is judged on.
    pub reachable: bool,
}

/// A run's checkpoints and the two numbers that say whether they are worth
/// anything: how many stage boundaries were captured, and how many of those
/// the repository can no longer produce.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCheckpointsView {
    pub run_id: String,
    pub workspace: Option<String>,
    pub checkpoints: Vec<RunCheckpointRow>,
    /// Rows with a SHA (recoverable stage boundaries).
    pub captured: u32,
    /// Rows with a typed `gap:` status and no SHA (known-missing boundaries).
    pub gaps: u32,
    /// Captured rows whose SHA the workspace cannot resolve. Should be 0; any
    /// other value is the index and the repository having drifted apart.
    pub unreachable: u32,
}

/// List a run's checkpoints, annotated with reachability.
#[tauri::command]
pub async fn dev_tools_list_run_checkpoints(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<RunCheckpointsView, AppError> {
    require_auth_sync(&state)?;
    let rows = ckpt_repo::list(&state.db, &run_id)?;
    let workspace = workspace_for_run(&state.db, &run_id);

    let mut checkpoints = Vec::with_capacity(rows.len());
    let (mut captured, mut gaps, mut unreachable) = (0u32, 0u32, 0u32);
    for r in rows {
        let has_sha = !r.sha.is_empty();
        let reachable = match (&workspace, has_sha) {
            (Some(root), true) => {
                personas_engine::git_checkpoint::contains_object(Path::new(root), &r.sha).await
            }
            _ => false,
        };
        if has_sha {
            captured += 1;
            if !reachable {
                unreachable += 1;
            }
        } else {
            gaps += 1;
        }
        checkpoints.push(RunCheckpointRow {
            id: r.id,
            stage: r.stage,
            sha: r.sha,
            status: r.status,
            created_at: r.created_at,
            reachable,
        });
    }

    Ok(RunCheckpointsView {
        run_id,
        workspace,
        checkpoints,
        captured,
        gaps,
        unreachable,
    })
}

/// Roll the run's workspace back to one of its checkpoints.
///
/// Three refusals before anything moves, in order: the SHA must belong to
/// *this run's* index (not any run's), the run's workspace must be resolvable,
/// and the workspace must actually contain the object. The third is the
/// runtime binding — a checkpoint SHA means something only in the repository
/// that produced it, and a rollback aimed at the wrong tree is the one failure
/// mode from which there is no rewind.
#[tauri::command]
pub async fn dev_tools_rollback_run_checkpoint(
    state: State<'_, Arc<AppState>>,
    run_id: String,
    sha: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;

    let rows = ckpt_repo::list(&state.db, &run_id)?;
    if !rows.iter().any(|r| r.sha == sha && !r.sha.is_empty()) {
        return Err(AppError::Validation(format!(
            "checkpoint {sha} is not in run {run_id}'s index"
        )));
    }

    let root = workspace_for_run(&state.db, &run_id).ok_or_else(|| {
        AppError::Validation(format!(
            "run {run_id} has no resolvable workspace; refusing to roll anything back"
        ))
    })?;
    let dir = Path::new(&root);

    if !personas_engine::git_checkpoint::contains_object(dir, &sha).await {
        return Err(AppError::Validation(format!(
            "checkpoint {sha} does not exist in {root} — the index and this repository have drifted"
        )));
    }

    personas_engine::git_checkpoint::restore_snapshot(dir, &sha)
        .await
        .map_err(AppError::Internal)?;

    // The record outlives the rewind: this resets tracked files and nothing
    // else. The run ledger, the task rows and the companion history still
    // describe work that may no longer exist on disk — stated here because an
    // operator who rolls back and finds the ledger unchanged should have been
    // told, not surprised.
    tracing::warn!(
        run_id = %run_id, sha = %sha, workspace = %root,
        "rolled the workspace back to a checkpoint; the run ledger and task rows were NOT rewound"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbPool;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:run_ckpt_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("personas_runckpt_{tag}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    async fn git(dir: &Path, args: &[&str]) {
        let out = tokio::process::Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .await
            .expect("git");
        assert!(out.status.success(), "git {args:?}: {:?}", out);
    }

    async fn init_repo(dir: &Path) {
        git(dir, &["init", "-q"]).await;
        git(dir, &["config", "user.email", "t@t.test"]).await;
        git(dir, &["config", "user.name", "test"]).await;
        std::fs::write(dir.join("seed.txt"), "seed").unwrap();
        git(dir, &["add", "-A"]).await;
        git(dir, &["commit", "--no-verify", "-m", "seed"]).await;
    }

    /// The failure posture the spec insists on: a checkpoint that cannot be
    /// taken records a typed gap and the run continues. It must not be silent,
    /// and it must not be indistinguishable from a captured boundary.
    #[tokio::test]
    async fn a_workspace_that_is_not_a_repo_records_a_typed_gap() {
        let pool = test_pool();
        let dir = temp_dir("not_a_repo");
        checkpoint_stage_boundary(&pool, "run-gap", "wave-1", Some(dir.to_str().unwrap())).await;

        let rows = ckpt_repo::list(&pool, "run-gap").unwrap();
        assert_eq!(rows.len(), 1, "a gap is a row, not a silence");
        assert_eq!(rows[0].sha, "", "a gap carries no SHA");
        assert_eq!(rows[0].status, CheckpointGap::NotAGitWorkspace.as_status());
    }

    /// An unresolvable workspace is a different gap from a non-repo one — the
    /// point of typing the reason.
    #[tokio::test]
    async fn an_unknown_workspace_records_its_own_reason() {
        let pool = test_pool();
        checkpoint_stage_boundary(&pool, "run-unknown", "wave-0", None).await;

        let rows = ckpt_repo::list(&pool, "run-unknown").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, CheckpointGap::WorkspaceUnknown.as_status());
        assert_ne!(
            rows[0].status,
            CheckpointGap::NotAGitWorkspace.as_status(),
            "the two gap classes must not collapse into one"
        );
    }

    /// A clean tree is NOT a gap. The wave changed nothing, so there is nothing
    /// to return to; recording a row would inflate coverage with entries that
    /// restore nothing.
    #[tokio::test]
    async fn a_clean_tree_records_nothing_at_all() {
        let pool = test_pool();
        let dir = temp_dir("clean");
        init_repo(&dir).await;

        checkpoint_stage_boundary(&pool, "run-clean", "wave-1", Some(dir.to_str().unwrap())).await;

        assert!(
            ckpt_repo::list(&pool, "run-clean").unwrap().is_empty(),
            "a clean tree is not a missing checkpoint"
        );
    }

    /// The whole point: a dirty wave boundary becomes a recoverable stage
    /// boundary — captured, indexed, and reachable in the repository that
    /// produced it. This is the measurable ("recoverable stage boundaries per
    /// run: today 0 by construction") going from 0 to 1.
    #[tokio::test]
    async fn a_dirty_wave_boundary_becomes_a_reachable_checkpoint() {
        let pool = test_pool();
        let dir = temp_dir("dirty");
        init_repo(&dir).await;
        std::fs::write(dir.join("seed.txt"), "work in progress").unwrap();

        checkpoint_stage_boundary(&pool, "run-ok", "wave-1", Some(dir.to_str().unwrap())).await;

        let rows = ckpt_repo::list(&pool, "run-ok").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "captured");
        assert_eq!(
            rows[0].sha.len(),
            40,
            "expected a full SHA: {}",
            rows[0].sha
        );
        assert!(
            personas_engine::git_checkpoint::contains_object(&dir, &rows[0].sha).await,
            "the index row must name an object the workspace actually has"
        );
        // And the snapshot must have been non-disruptive: the file the agent
        // was mid-edit on is untouched.
        assert_eq!(
            std::fs::read_to_string(dir.join("seed.txt")).unwrap(),
            "work in progress",
            "snapshot_stage must not disturb the working tree"
        );
    }

    /// The runtime binding. A checkpoint SHA means something only in the
    /// repository that produced it, so a row from another workspace must read
    /// as unreachable rather than as a rollback target.
    #[tokio::test]
    async fn a_checkpoint_from_another_workspace_is_not_reachable_here() {
        let pool = test_pool();
        let mine = temp_dir("bind_mine");
        let theirs = temp_dir("bind_theirs");
        init_repo(&mine).await;
        init_repo(&theirs).await;
        std::fs::write(mine.join("seed.txt"), "mine").unwrap();

        checkpoint_stage_boundary(&pool, "run-bind", "wave-1", Some(mine.to_str().unwrap())).await;
        let sha = ckpt_repo::list(&pool, "run-bind").unwrap()[0].sha.clone();

        assert!(personas_engine::git_checkpoint::contains_object(&mine, &sha).await);
        assert!(
            !personas_engine::git_checkpoint::contains_object(&theirs, &sha).await,
            "a rollback aimed at the wrong workspace must be refusable"
        );
    }
}
