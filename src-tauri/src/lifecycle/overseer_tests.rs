use super::*;
use crate::db::models::{
    LifecycleAuthor, LifecycleGateKind, LifecyclePreset, LifecycleRun, LifecycleRunOutcome,
};
use crate::db::repos::dev::lifecycle_runs::append_run;
use crate::db::repos::dev::projects::create_project;
use crate::lifecycle::presets::preset_doc;
use personas_engine::git_checkpoint::run_git_blocking as git;

fn project(pool: &DbPool, root: &Path) -> Result<String, AppError> {
    Ok(create_project(
        pool,
        "lc-overseer",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id)
}

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

/// Keep only these steps of the Solo document (a smaller goal).
fn only_steps(pool: &DbPool, project_id: &str, ids: &[&str]) -> Result<(), AppError> {
    let mut doc = preset_doc(LifecyclePreset::Solo);
    doc.steps.retain(|s| ids.contains(&s.id.as_str()));
    super::super::append(pool, project_id, &doc, None, LifecycleAuthor::Operator)?;
    Ok(())
}

struct Run<'a> {
    measure: &'a str,
    command: &'a str,
    kind: LifecycleGateKind,
    outcome: LifecycleRunOutcome,
    value_pct: Option<f64>,
    head: &'a str,
    at: &'a str,
}

fn run(pool: &DbPool, project_id: &str, r: Run<'_>) -> Result<(), AppError> {
    append_run(
        pool,
        &LifecycleRun {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            measure_id: r.measure.to_string(),
            command_id: r.command.to_string(),
            command: format!("run {}", r.command),
            kind: r.kind,
            outcome: r.outcome,
            exit_code: Some(i32::from(r.outcome != LifecycleRunOutcome::Passed)),
            duration_ms: 1_000,
            value_pct: r.value_pct,
            first_error: (r.outcome == LifecycleRunOutcome::Failed).then(|| "boom".to_string()),
            head_sha: r.head.to_string(),
            started_at: r.at.to_string(),
            finished_at: r.at.to_string(),
        },
    )
}

fn gate(pool: &DbPool, p: &str, m: &str, ok: bool, head: &str, at: &str) -> Result<(), AppError> {
    let outcome = if ok {
        LifecycleRunOutcome::Passed
    } else {
        LifecycleRunOutcome::Failed
    };
    run(
        pool,
        p,
        Run {
            measure: m,
            command: "lint",
            kind: LifecycleGateKind::Lint,
            outcome,
            value_pct: None,
            head,
            at,
        },
    )
}

/// A passing test command and a coverage reading in measure `m`.
fn tests(pool: &DbPool, p: &str, m: &str, cov: f64, head: &str, at: &str) -> Result<(), AppError> {
    run(
        pool,
        p,
        Run {
            measure: m,
            command: "test",
            kind: LifecycleGateKind::Test,
            outcome: LifecycleRunOutcome::Passed,
            value_pct: None,
            head,
            at,
        },
    )?;
    run(
        pool,
        p,
        Run {
            measure: m,
            command: "cov",
            kind: LifecycleGateKind::Coverage,
            outcome: LifecycleRunOutcome::Passed,
            value_pct: Some(cov),
            head,
            at,
        },
    )
}

fn item(pool: &DbPool, project_id: &str, goal_id: &str, step: &str) -> Option<DevIdea> {
    idea_repo::find_idea_by_dedup_key(pool, project_id, &dedup_key(goal_id, step))
        .ok()
        .flatten()
}

#[test]
fn watch_round_trips_and_lists_only_watched_projects() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let (a, b) = (tempfile::tempdir()?, tempfile::tempdir()?);
    let pa = project(&pool, a.path())?;
    let pb = project(&pool, b.path())?;
    assert!(!is_watched(&pool, &pa));
    assert!(set_watch(&pool, &pa, true)?);
    assert!(is_watched(&pool, &pa));
    assert!(!is_watched(&pool, &pb));
    assert_eq!(watched_project_ids(&pool)?, vec![pa.clone()]);
    assert!(super::super::snapshot(&pool, &pa)?.watched);
    assert!(!set_watch(&pool, &pa, false)?);
    assert!(!is_watched(&pool, &pa));
    assert!(watched_project_ids(&pool)?.is_empty());
    assert!(matches!(
        set_watch(&pool, "no-such-project", true),
        Err(AppError::NotFound(_))
    ));
    Ok(())
}

#[test]
fn send_files_one_accepted_item_per_non_green_measurable_step() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    // Not a git repo: no base tip, so nothing is stale and nothing closes.
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    gate(&pool, &p, "m1", true, "abc", "2026-10-08T10:00:00.000Z")?;
    tests(&pool, &p, "m1", 80.0, "abc", "2026-10-08T10:00:00.000Z")?;
    assert!(super::super::snapshot(&pool, &p)?.goal.is_none());

    let sent = send(&pool, &p)?;
    // Solo: 10 steps; frame + recall instructed, gate + tests green.
    assert_eq!((sent.filed, sent.already_open), (6, 0));
    let goal = goal_repo::get_goal_by_id(&pool, &sent.goal_id)?;
    assert_eq!(goal.title, GOAL_TITLE);
    for step in ["isolate", "sync", "docs", "commit", "land", "record"] {
        let idea = item(&pool, &p, &goal.id, step).expect(step);
        assert_eq!(idea.status, "accepted", "{step}");
        assert_eq!(idea.origin.as_deref(), Some("lifecycle"));
        assert_eq!(idea.goal_id.as_deref(), Some(goal.id.as_str()));
        assert_eq!(idea.completeness.as_deref(), Some("full"), "{step}");
        let plan = idea.plan.as_deref().unwrap_or_default();
        assert!(plan.contains("suppression directives"), "{step}: {plan}");
        assert!(plan.contains("base tip"), "{step} names the target: {plan}");
    }
    for step in ["frame", "recall", "gate", "tests"] {
        assert!(item(&pool, &p, &goal.id, step).is_none(), "{step} filed");
    }
    assert!(is_watched(&pool, &p), "send also sets watch");

    let snap = super::super::snapshot(&pool, &p)?;
    assert_eq!(
        snap.goal,
        Some(LifecycleGoalView {
            goal_id: goal.id.clone(),
            measurable_total: 8,
            measurable_green: 2,
            instructed: 2,
            open_items: 6,
        })
    );

    let again = send(&pool, &p)?;
    assert_eq!(again.goal_id, goal.id, "the open goal is reused");
    assert_eq!((again.filed, again.already_open), (0, 6));
    Ok(())
}

#[test]
fn unmeasured_items_are_about_making_the_step_measurable() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    std::fs::write(dir.path().join("package.json"), "{}")?;
    let p = project(&pool, dir.path())?;
    only_steps(&pool, &p, &["frame", "tests"])?;
    let sent = send(&pool, &p)?;
    assert_eq!(sent.filed, 1);
    let idea = item(&pool, &p, &sent.goal_id, "tests").expect("tests item");
    assert!(idea.title.contains("measurable"), "{}", idea.title);
    let plan = idea.plan.unwrap_or_default();
    assert!(plan.contains("coverage command"), "{plan}");
    assert!(plan.contains("package.json"), "{plan}");
    Ok(())
}

#[test]
fn nothing_closes_off_the_current_tip_and_the_goal_closes_at_all_green() -> Result<(), AppError> {
    let Some((repo, tip)) = repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    let p = project(&pool, repo.path())?;
    only_steps(&pool, &p, &["frame", "gate", "tests"])?;
    gate(&pool, &p, "m1", false, &tip, "2026-10-08T10:00:00.000Z")?;
    tests(&pool, &p, "m1", 80.0, &tip, "2026-10-08T10:00:00.000Z")?;
    let sent = send(&pool, &p)?;
    assert_eq!(sent.filed, 1, "gate is red; tests green; frame instructed");
    let gate_item = item(&pool, &p, &sent.goal_id, "gate").expect("gate item");

    // A green gate measured on ANOTHER tip closes nothing.
    gate(
        &pool,
        &p,
        "m2",
        true,
        "0000000old",
        "2026-10-08T11:00:00.000Z",
    )?;
    assert_eq!(after_measure(&pool, &p)?, CloseOutcome::default());
    assert!(is_open(
        &item(&pool, &p, &sent.goal_id, "gate").expect("item")
    ));
    assert!(open_goal(&pool, &p)?.is_some());

    // Measured green on the current tip: the item and the goal close.
    gate(&pool, &p, "m3", true, &tip, "2026-10-08T12:00:00.000Z")?;
    assert_eq!(
        after_measure(&pool, &p)?,
        CloseOutcome {
            closed_items: 1,
            goal_closed: true
        }
    );
    let closed = idea_repo::get_idea_by_id(&pool, &gate_item.id)?;
    assert_eq!(closed.status, "delivered");
    assert_eq!(closed.verify_state.as_deref(), Some("cleared"));
    let evidence = closed.verify_evidence.unwrap_or_default();
    assert!(
        evidence.contains(&format!("Lifecycle measure m3 on {tip}: gate green")),
        "{evidence}"
    );
    let goal = goal_repo::get_goal_by_id(&pool, &sent.goal_id)?;
    assert_eq!(goal.status, "done");
    assert!(goal.completed_at.is_some());
    assert!(open_goal(&pool, &p)?.is_none());
    let view = super::super::snapshot(&pool, &p)?
        .goal
        .expect("closed goal still shows");
    assert_eq!((view.measurable_green, view.measurable_total), (2, 2));
    assert_eq!(view.open_items, 0);

    // A closed goal is not reopened: the next send opens a new one.
    gate(&pool, &p, "m4", false, &tip, "2026-10-08T13:00:00.000Z")?;
    let next = send(&pool, &p)?;
    assert_ne!(next.goal_id, sent.goal_id);
    assert_eq!(next.filed, 1);
    Ok(())
}

#[test]
fn a_step_that_regresses_under_the_open_goal_is_reopened() -> Result<(), AppError> {
    let Some((repo, tip)) = repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    let p = project(&pool, repo.path())?;
    only_steps(&pool, &p, &["gate", "tests"])?;
    gate(&pool, &p, "m1", false, &tip, "2026-10-08T10:00:00.000Z")?;
    tests(&pool, &p, "m1", 30.0, &tip, "2026-10-08T10:00:00.000Z")?;
    let sent = send(&pool, &p)?;
    assert_eq!(sent.filed, 2);

    gate(&pool, &p, "m2", true, &tip, "2026-10-08T11:00:00.000Z")?;
    let closed = after_measure(&pool, &p)?;
    assert_eq!((closed.closed_items, closed.goal_closed), (1, false));

    gate(&pool, &p, "m3", false, &tip, "2026-10-08T12:00:00.000Z")?;
    let again = send(&pool, &p)?;
    assert_eq!(again.goal_id, sent.goal_id);
    assert_eq!((again.filed, again.already_open), (1, 1));
    let gate_item = item(&pool, &p, &sent.goal_id, "gate").expect("gate item");
    assert_eq!(gate_item.status, "accepted");
    assert_eq!(gate_item.verify_state.as_deref(), Some("regressed"));
    Ok(())
}

#[test]
fn after_measure_is_a_no_op_without_an_open_goal() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    gate(&pool, &p, "m1", true, "abc", "2026-10-08T10:00:00.000Z")?;
    assert_eq!(after_measure(&pool, &p)?, CloseOutcome::default());
    assert!(goal_repo::list_goals_by_project(&pool, &p, None)?.is_empty());
    Ok(())
}

#[test]
fn due_project_picks_one_new_tip_spaced_and_least_recently_measured() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let now: DateTime<Utc> = "2026-10-08T12:00:00Z"
        .parse()
        .map_err(|e| AppError::Internal(format!("parse: {e}")))?;
    let mut ids = HashMap::new();
    let dirs: Vec<tempfile::TempDir> = (0..5)
        .map(|_| tempfile::tempdir())
        .collect::<Result<_, _>>()?;
    for (name, dir) in ["a", "b", "c", "d", "e"].iter().zip(&dirs) {
        let id = project(&pool, dir.path())?;
        if *name != "d" {
            set_watch(&pool, &id, true)?;
        }
        ids.insert(id.clone(), *name);
    }
    let by_name = |n: &str| -> String {
        ids.iter()
            .find(|(_, v)| **v == n)
            .map(|(k, _)| k.clone())
            .unwrap_or_default()
    };
    let (a, b, c, d, e) = (
        by_name("a"),
        by_name("b"),
        by_name("c"),
        by_name("d"),
        by_name("e"),
    );
    // a: measured 2h ago on an older tip -> due.
    gate(&pool, &a, "ma", true, "a1", "2026-10-08T10:00:00.000Z")?;
    // b: measured on its current tip -> not due.
    gate(&pool, &b, "mb", true, "b1", "2026-10-08T09:00:00.000Z")?;
    // c: new tip, but measured 10 minutes ago -> not due yet.
    gate(&pool, &c, "mc", true, "c1", "2026-10-08T11:50:00.000Z")?;
    // d: due by every rule, but not watched.
    let tips: HashMap<String, String> = [
        (a.clone(), "a2"),
        (b.clone(), "b1"),
        (c.clone(), "c2"),
        (d.clone(), "d1"),
        (e.clone(), "e1"),
    ]
    .into_iter()
    .map(|(k, v)| (k, v.to_string()))
    .collect();
    let tip_of = |p: &DevProject| tips.get(&p.id).cloned();

    // e has never been measured: it goes first.
    let none = HashMap::new();
    assert_eq!(
        due_project(&pool, now, &none, &tip_of)?,
        Some((e.clone(), "e1".to_string()))
    );
    // e refused at this tip (nothing to measure): a is next.
    let refused: HashMap<String, String> = [(e.clone(), "e1".to_string())].into_iter().collect();
    assert_eq!(
        due_project(&pool, now, &refused, &tip_of)?,
        Some((a.clone(), "a2".to_string()))
    );
    // a measured on its new tip: nothing is due.
    gate(&pool, &a, "ma2", true, "a2", "2026-10-08T11:59:00.000Z")?;
    assert_eq!(due_project(&pool, now, &refused, &tip_of)?, None);
    // Unwatched entirely: nothing.
    for id in [&a, &b, &c, &e] {
        set_watch(&pool, id, false)?;
    }
    assert_eq!(due_project(&pool, now, &none, &tip_of)?, None);
    Ok(())
}
