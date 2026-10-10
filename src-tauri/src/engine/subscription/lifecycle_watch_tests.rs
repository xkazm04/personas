use super::*;
use crate::db::models::{LifecycleGateKind, LifecycleRun, LifecycleRunOutcome};
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::dev::lifecycle_runs::append_run;
use crate::db::repos::dev::projects::create_project;
use crate::db::settings_keys;
use personas_engine::git_checkpoint::run_git_blocking as git;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A one-commit repo on `main` and its tip, or `None` without git.
fn repo() -> Option<(tempfile::TempDir, String)> {
    let dir = tempfile::tempdir().ok()?;
    let p = dir.path();
    for args in [
        &["init", "--initial-branch=main"][..],
        &["config", "user.email", "t@example.com"],
        &["config", "user.name", "T"],
        &["config", "commit.gpgsign", "false"],
    ] {
        git(p, args).ok()?;
    }
    std::fs::write(p.join("README.md"), "hi").ok()?;
    git(p, &["add", "README.md"]).ok()?;
    git(p, &["commit", "-m", "init"]).ok()?;
    let tip = git(p, &["rev-parse", "refs/heads/main"]).ok()?;
    Some((dir, tip.trim().to_string()))
}

/// A watched project in `root`, with the Overseer switched on or off.
fn watched(pool: &DbPool, root: &Path, overseer_on: bool) -> Result<String, AppError> {
    let id = create_project(
        pool,
        "lc-watch",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id;
    crate::lifecycle::overseer::set_watch(pool, &id, true)?;
    settings_repo::set(
        pool,
        settings_keys::OVERSEER_ENABLED,
        if overseer_on { "true" } else { "false" },
    )?;
    Ok(id)
}

fn started(id: &str) -> Result<LifecycleMeasureStarted, AppError> {
    Ok(LifecycleMeasureStarted {
        measure_id: format!("m-{id}"),
    })
}

#[tokio::test]
async fn the_tick_does_nothing_while_the_overseer_is_off() -> Result<(), AppError> {
    let Some((repo, _)) = repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    watched(&pool, repo.path(), false)?;
    let calls = AtomicUsize::new(0);
    let refused = Mutex::new(HashMap::new());
    let out = lifecycle_watch_tick(&pool, &refused, |id| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move { started(&id) }
    })
    .await;
    assert_eq!(out, LifecycleWatchTick::Disabled);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    Ok(())
}

#[tokio::test]
async fn the_tick_starts_one_due_project_and_skips_when_busy() -> Result<(), AppError> {
    let Some((repo, _)) = repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    let p = watched(&pool, repo.path(), true)?;
    let refused = Mutex::new(HashMap::new());

    let busy = lifecycle_watch_tick(&pool, &refused, |_| async {
        Err(AppError::Validation(
            "another project's Measure is running; one runs at a time".into(),
        ))
    })
    .await;
    assert_eq!(busy, LifecycleWatchTick::Busy);

    let seen = Mutex::new(Vec::new());
    let out = lifecycle_watch_tick(&pool, &refused, |id| {
        seen.lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(id.clone());
        async move { started(&id) }
    })
    .await;
    assert_eq!(out, LifecycleWatchTick::Started(p.clone()));
    assert_eq!(*seen.lock().unwrap_or_else(|e| e.into_inner()), vec![p]);
    Ok(())
}

#[tokio::test]
async fn the_same_tip_is_not_measured_twice() -> Result<(), AppError> {
    let Some((repo, tip)) = repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    let p = watched(&pool, repo.path(), true)?;
    let at = "2026-10-08T10:00:00.000Z".to_string();
    append_run(
        &pool,
        &LifecycleRun {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: p,
            measure_id: "m1".into(),
            command_id: "lint".into(),
            command: "lint".into(),
            kind: LifecycleGateKind::Lint,
            outcome: LifecycleRunOutcome::Passed,
            exit_code: Some(0),
            duration_ms: 1_000,
            value_pct: None,
            first_error: None,
            head_sha: tip,
            started_at: at.clone(),
            finished_at: at,
        },
    )?;
    let calls = AtomicUsize::new(0);
    let refused = Mutex::new(HashMap::new());
    let out = lifecycle_watch_tick(&pool, &refused, |id| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move { started(&id) }
    })
    .await;
    assert_eq!(out, LifecycleWatchTick::NothingDue);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    Ok(())
}

#[tokio::test]
async fn nothing_to_measure_is_not_retried_at_the_same_tip() -> Result<(), AppError> {
    let Some((repo, tip)) = repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    let p = watched(&pool, repo.path(), true)?;
    let refused = Mutex::new(HashMap::new());
    let out = lifecycle_watch_tick(&pool, &refused, |_| async {
        Err(AppError::NotFound("nothing to measure".into()))
    })
    .await;
    assert_eq!(out, LifecycleWatchTick::NothingToMeasure(p.clone()));
    assert_eq!(
        refused.lock().unwrap_or_else(|e| e.into_inner()).get(&p),
        Some(&tip)
    );

    let calls = AtomicUsize::new(0);
    let again = lifecycle_watch_tick(&pool, &refused, |id| {
        calls.fetch_add(1, Ordering::SeqCst);
        async move { started(&id) }
    })
    .await;
    assert_eq!(again, LifecycleWatchTick::NothingDue);
    assert_eq!(calls.load(Ordering::SeqCst), 0, "no retry storm");
    Ok(())
}
