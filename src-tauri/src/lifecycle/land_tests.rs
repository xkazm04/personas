use std::path::{Path, PathBuf};

use personas_engine::git_checkpoint::run_git_blocking as git;

use super::*;
use crate::db::models::LifecyclePreset;

fn repo_at(dir: &Path) -> Option<()> {
    git(dir, &["init", "--initial-branch=main"]).ok()?;
    git(dir, &["config", "user.email", "t@example.com"]).ok()?;
    git(dir, &["config", "user.name", "T"]).ok()?;
    git(dir, &["config", "commit.gpgsign", "false"]).ok()?;
    std::fs::write(dir.join("README.md"), "hello\n").ok()?;
    git(dir, &["add", "-A"]).ok()?;
    git(dir, &["commit", "-m", "chore: initial"]).ok()?;
    Some(())
}

fn write_commit(dir: &Path, file: &str, body: &str, msg: &str) {
    std::fs::write(dir.join(file), body).unwrap();
    git(dir, &["add", "-A"]).unwrap();
    git(dir, &["commit", "-m", msg]).unwrap();
}

/// A project at `root` and a task `t-1` recorded as running in a fresh
/// worktree on `autopilot/x` (created under `wt_parent`).
fn seed(pool: &DbPool, root: &Path, wt_parent: &Path) -> Result<PathBuf, AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p-1', 'Proj', ?1)",
        rusqlite::params![root.to_string_lossy()],
    )?;
    conn.execute(
        "INSERT INTO dev_tasks (id, project_id, title, status)
         VALUES ('t-1', 'p-1', 'Add a feature', 'running')",
        [],
    )?;
    // The test pool holds one connection; the repo calls below take their own.
    drop(conn);
    let wt = wt_parent.join("wt");
    git(
        root,
        &[
            "worktree",
            "add",
            "-b",
            "autopilot/x",
            &wt.to_string_lossy(),
        ],
    )
    .map_err(AppError::Internal)?;
    crate::db::repos::dev_tools::record_task_worktree(
        pool,
        "t-1",
        &wt.to_string_lossy(),
        Some("autopilot/x"),
        None,
    )?;
    Ok(wt)
}

fn land_of(outcomes: &[LifecycleStepOutcome]) -> &LifecycleStepOutcome {
    outcomes
        .iter()
        .find(|o| o.step_id == "land")
        .expect("a land outcome")
}

fn branch_exists(root: &Path) -> bool {
    git(
        root,
        &["rev-parse", "--verify", "--quiet", "refs/heads/autopilot/x"],
    )
    .is_ok()
}

#[test]
fn a_completed_solo_task_with_a_commit_lands_by_fast_forward() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return Ok(());
    };
    let wt_parent = tempfile::tempdir().unwrap();
    let pool = crate::db::init_test_db()?;
    let wt = seed(&pool, root.path(), wt_parent.path())?;
    write_commit(&wt, "feature.rs", "fn f() {}\n", "feat: add f");

    let outcomes = record_task(&pool, "t-1", true, Some(12))?.expect("a project task");
    let land = land_of(&outcomes);
    assert_eq!(land.outcome, O::Done, "{land:?}");
    assert!(
        land.detail
            .as_deref()
            .unwrap()
            .starts_with("fast-forward, landed "),
        "{land:?}"
    );
    assert!(
        root.path().join("feature.rs").is_file(),
        "the work is on the base"
    );
    assert!(
        !branch_exists(root.path()),
        "a verified land prunes the branch"
    );
    let record = outcomes.iter().find(|o| o.step_id == "record").unwrap();
    assert_eq!(record.outcome, O::Done);

    let rows = repo::list_task_evidence(&pool, "p-1", 10)?;
    assert_eq!(rows.len(), 1, "one evidence row per finished task");
    assert_eq!(rows[0].title, "Add a feature");
    assert!(rows[0].outcomes_json.contains("\"stepId\":\"land\""));
    Ok(())
}

#[test]
fn a_conflicting_base_records_land_failed_and_keeps_the_branch() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return Ok(());
    };
    let wt_parent = tempfile::tempdir().unwrap();
    let pool = crate::db::init_test_db()?;
    let wt = seed(&pool, root.path(), wt_parent.path())?;
    write_commit(&wt, "README.md", "branch text\n", "docs: branch readme");
    write_commit(root.path(), "README.md", "main text\n", "docs: main readme");

    let outcomes = record_task(&pool, "t-1", true, Some(3))?.expect("a project task");
    let land = land_of(&outcomes);
    assert_eq!(land.outcome, O::Failed, "{land:?}");
    assert!(
        !land.detail.as_deref().unwrap_or("").is_empty(),
        "the reason is kept"
    );
    assert!(
        branch_exists(root.path()),
        "a refused land never loses the branch"
    );
    assert_eq!(
        git(root.path(), &["status", "--porcelain"]).unwrap_or_default(),
        "",
        "the aborted land leaves the checkout clean"
    );
    assert_eq!(repo::list_task_evidence(&pool, "p-1", 10)?.len(), 1);
    let _ = git(
        root.path(),
        &["worktree", "remove", "--force", &wt.to_string_lossy()],
    );
    Ok(())
}

#[test]
fn a_team_task_is_never_landed_by_the_app() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return Ok(());
    };
    let wt_parent = tempfile::tempdir().unwrap();
    let pool = crate::db::init_test_db()?;
    let wt = seed(&pool, root.path(), wt_parent.path())?;
    crate::lifecycle::set_preset(&pool, "p-1", LifecyclePreset::Team)?;
    write_commit(&wt, "feature.rs", "fn f() {}\n", "feat: add f");

    let outcomes = record_task(&pool, "t-1", true, Some(1))?.expect("a project task");
    let land = land_of(&outcomes);
    assert_eq!(land.outcome, O::Skipped);
    assert_eq!(land.detail.as_deref(), Some("pull request expected"));
    assert!(branch_exists(root.path()));
    assert!(!root.path().join("feature.rs").exists());
    let _ = git(
        root.path(),
        &["worktree", "remove", "--force", &wt.to_string_lossy()],
    );
    Ok(())
}

#[test]
fn dirty_or_empty_or_failed_work_is_skipped_not_landed() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return Ok(());
    };
    let wt_parent = tempfile::tempdir().unwrap();
    let pool = crate::db::init_test_db()?;
    let wt = seed(&pool, root.path(), wt_parent.path())?;

    let none = record_task(&pool, "t-1", true, Some(0))?.unwrap();
    assert_eq!(land_of(&none).detail.as_deref(), Some("no commits to land"));

    write_commit(&wt, "feature.rs", "fn f() {}\n", "feat: add f");
    std::fs::write(wt.join("scratch.txt"), "left over").unwrap();
    let dirty = record_task(&pool, "t-1", true, Some(4))?.unwrap();
    assert_eq!(land_of(&dirty).outcome, O::Skipped);
    assert!(land_of(&dirty)
        .detail
        .as_deref()
        .unwrap()
        .contains("uncommitted"));

    let failed = record_task(&pool, "t-1", false, None)?.unwrap();
    assert_eq!(
        land_of(&failed).detail.as_deref(),
        Some("the task did not complete")
    );
    // Re-recording the same task replaces its row rather than adding one.
    assert_eq!(repo::list_task_evidence(&pool, "p-1", 10)?.len(), 1);
    assert!(branch_exists(root.path()));
    let _ = git(
        root.path(),
        &["worktree", "remove", "--force", &wt.to_string_lossy()],
    );
    Ok(())
}

#[test]
fn the_land_detail_names_the_strategy_and_the_sha() {
    assert_eq!(
        land_detail("applied `b` → verified on `abc123` (cherry-pick)", "abc123"),
        "cherry-pick, landed abc123"
    );
    assert_eq!(
        land_detail(
            "`b` was already applied upstream — its commits are ...",
            "d1"
        ),
        "already applied, landed d1"
    );
}
