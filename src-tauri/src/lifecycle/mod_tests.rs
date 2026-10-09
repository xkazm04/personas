use super::*;
use crate::db::models::LifecycleBindingState;
use crate::db::repos::dev::projects::create_project;
use crate::db::repos::dev::tasks::create_task;
use personas_engine::git_checkpoint::run_git_blocking as git;

fn project(pool: &DbPool, root: &Path) -> Result<String, AppError> {
    Ok(create_project(
        pool,
        "lc-snap",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id)
}

#[test]
fn a_project_without_rows_is_solo_v0_default() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let snap = snapshot(&pool, &p)?;
    assert_eq!(snap.preset, LifecyclePreset::Solo);
    assert_eq!(snap.version, 0);
    assert_eq!(snap.author, LifecycleAuthor::Default);
    assert!(snap.change_note.is_none() && snap.created_at.is_none());
    assert_eq!(snap.steps.len(), 10);
    assert!(snap.steps.iter().all(|s| s.step.label.is_none()));
    assert!(snap.evidence.is_empty());
    assert!(snap.install_task_id.is_none() && snap.install_task_status.is_none());
    Ok(())
}

#[test]
fn append_makes_v1_and_rewrites_standards() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let doc = presets::preset_doc(LifecyclePreset::Team);
    append(
        &pool,
        &p,
        &doc,
        Some("Preset set to team"),
        LifecycleAuthor::Operator,
    )?;
    let snap = snapshot(&pool, &p)?;
    assert_eq!(snap.version, 1);
    assert_eq!(snap.preset, LifecyclePreset::Team);
    assert_eq!(snap.author, LifecycleAuthor::Operator);
    assert_eq!(snap.change_note.as_deref(), Some("Preset set to team"));
    assert_eq!(snap.steps.len(), 11);
    let stored = project_repo::get_project_by_id(&pool, &p)?.standards_config;
    assert_eq!(stored, Some(presets::standards_projection(&doc)));
    let (current, version, _) = current_doc(&pool, &p)?;
    assert_eq!((current, version), (doc, 1));
    Ok(())
}

#[test]
fn the_default_author_is_never_stored() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let doc = presets::preset_doc(LifecyclePreset::Solo);
    assert!(append(&pool, &p, &doc, None, LifecycleAuthor::Default).is_err());
    Ok(())
}

#[test]
fn a_live_install_task_makes_missing_bindings_pending() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let doc = presets::preset_doc(LifecyclePreset::Solo);
    append(&pool, &p, &doc, None, LifecycleAuthor::Operator)?;
    let task = create_task(
        &pool,
        Some(&p),
        "Lifecycle v1: install",
        None,
        None,
        None,
        Some("running"),
        None,
    )?;
    repo::set_install_task(&pool, &p, 1, &task.id)?;

    let snap = snapshot(&pool, &p)?;
    assert_eq!(snap.install_task_id.as_deref(), Some(task.id.as_str()));
    assert_eq!(snap.install_task_status.as_deref(), Some("running"));
    let gate = snap
        .steps
        .iter()
        .find(|s| s.step.id == "gate")
        .expect("gate");
    assert_eq!(gate.binding_views[0].state, LifecycleBindingState::Pending);

    crate::db::repos::dev::tasks::update_task(
        &pool,
        &task.id,
        None,
        None,
        Some("completed"),
        None,
        None,
        None,
        None,
        None,
        None,
    )?;
    let snap = snapshot(&pool, &p)?;
    let gate = snap
        .steps
        .iter()
        .find(|s| s.step.id == "gate")
        .expect("gate");
    assert_eq!(gate.binding_views[0].state, LifecycleBindingState::Missing);
    Ok(())
}

#[test]
fn task_evidence_is_merged_and_tallied() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let outcomes = vec![
        LifecycleStepOutcome {
            step_id: "gate".into(),
            outcome: LifecycleOutcome::Done,
            detail: None,
        },
        LifecycleStepOutcome {
            step_id: "tests".into(),
            outcome: LifecycleOutcome::Skipped,
            detail: Some("no test files touched".into()),
        },
    ];
    let json = serde_json::to_string(&outcomes)?;
    repo::upsert_task_evidence(&pool, &p, "t1", "older", &json, "2026-09-01T00:00:00Z")?;
    repo::upsert_task_evidence(&pool, &p, "t2", "newer", &json, "2026-09-02T00:00:00Z")?;
    let snap = snapshot(&pool, &p)?;
    assert_eq!(snap.evidence.len(), 2);
    assert_eq!(snap.evidence[0].title, "newer", "newest first");
    assert_eq!(snap.evidence[0].source_kind, LifecycleSourceKind::Task);
    let gate = snap
        .steps
        .iter()
        .find(|s| s.step.id == "gate")
        .expect("gate");
    assert_eq!(gate.evidence.done, 2);
    let tests = snap
        .steps
        .iter()
        .find(|s| s.step.id == "tests")
        .expect("tests");
    assert_eq!(tests.evidence.skipped, 2);
    Ok(())
}

#[test]
fn set_preset_appends_once_and_rewrites_standards() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    assert!(
        set_preset(&pool, &p, LifecyclePreset::Solo)?,
        "v0 -> v1 appends"
    );
    assert!(
        !set_preset(&pool, &p, LifecyclePreset::Solo)?,
        "same preset is a no-op"
    );
    assert!(set_preset(&pool, &p, LifecyclePreset::Team)?);
    let snap = snapshot(&pool, &p)?;
    assert_eq!((snap.version, snap.preset), (2, LifecyclePreset::Team));
    assert_eq!(snap.change_note.as_deref(), Some("Preset set to team"));
    let stored = project_repo::get_project_by_id(&pool, &p)?.standards_config;
    assert_eq!(
        stored,
        Some(presets::standards_projection(&presets::preset_doc(
            LifecyclePreset::Team
        )))
    );
    Ok(())
}

#[test]
fn a_standards_edit_is_a_version_append() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let edit = r#"{"precommit":{"lint":false,"docs_required":true,"code_quality":true},"branching":{"pr_base":"test","automerge":{"enabled":true,"target":"main"}}}"#;
    apply_standards_edit(&pool, &p, Some(edit))?;
    let (doc, version, row) = current_doc(&pool, &p)?;
    assert_eq!(version, 1);
    let row = row.expect("stored");
    assert_eq!(row.author, "operator");
    assert_eq!(row.change_note.as_deref(), Some("Standards edited"));
    let gate = doc.steps.iter().find(|s| s.id == "gate").expect("gate");
    assert_eq!(gate.params.lint, Some(false));
    let stored = project_repo::get_project_by_id(&pool, &p)?.standards_config;
    assert_eq!(
        stored.as_deref(),
        Some(edit),
        "the projection round-trips the edit"
    );

    apply_standards_edit(&pool, &p, Some(edit))?;
    assert_eq!(
        current_doc(&pool, &p)?.1,
        1,
        "an unchanged edit appends nothing"
    );
    assert!(matches!(
        apply_standards_edit(&pool, &p, Some("{nope")),
        Err(AppError::Validation(_))
    ));
    Ok(())
}

fn gate_cmd(id: &str, kind: crate::db::models::LifecycleGateKind) -> LifecycleGateCommand {
    LifecycleGateCommand {
        id: id.into(),
        command: format!("npm run {id}"),
        kind,
        budget_ms: None,
    }
}

#[test]
fn set_step_params_validates_then_appends_an_operator_version() -> Result<(), AppError> {
    use crate::db::models::LifecycleGateKind as K;
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let with = |cmds: Vec<LifecycleGateCommand>| LifecycleStepParams {
        commands: Some(cmds),
        ..Default::default()
    };
    let refused = |step: &str, params: LifecycleStepParams| {
        matches!(
            set_step_params(&pool, &p, step, params),
            Err(AppError::Validation(_))
        )
    };
    assert!(refused(
        "gate",
        with(vec![gate_cmd("lint", K::Lint), gate_cmd("lint", K::Check)])
    ));
    let mut empty = gate_cmd("lint", K::Lint);
    empty.command = "  ".into();
    assert!(refused("gate", with(vec![empty])));
    let mut zero = gate_cmd("lint", K::Lint);
    zero.budget_ms = Some(0);
    assert!(refused("gate", with(vec![zero])));
    assert!(
        refused("gate", with(vec![gate_cmd("test", K::Test)])),
        "a test under gate"
    );
    assert!(
        refused("docs", with(vec![gate_cmd("lint", K::Lint)])),
        "docs runs no commands"
    );
    assert!(refused(
        "tests",
        LifecycleStepParams {
            coverage_green_pct: Some(101),
            ..Default::default()
        }
    ));
    assert!(matches!(
        set_step_params(&pool, &p, "nope", LifecycleStepParams::default()),
        Err(AppError::NotFound(_))
    ));
    assert_eq!(current_doc(&pool, &p)?.1, 0, "nothing refused was stored");

    let cmds = vec![gate_cmd("lint", K::Lint), gate_cmd("tsc", K::Typecheck)];
    set_step_params(&pool, &p, "gate", with(cmds.clone()))?;
    let (doc, version, row) = current_doc(&pool, &p)?;
    assert_eq!(version, 1);
    assert_eq!(row.expect("stored").author, "operator");
    let gate = doc.steps.iter().find(|s| s.id == "gate").expect("gate");
    assert_eq!(gate.params.commands.as_deref(), Some(cmds.as_slice()));
    Ok(())
}

#[test]
fn step_detail_carries_runs_for_command_steps_only() -> Result<(), AppError> {
    use crate::db::models::{LifecycleGateKind as K, LifecycleRun, LifecycleRunOutcome};
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    for (i, (id, kind)) in [("lint", K::Lint), ("test", K::Test)]
        .into_iter()
        .enumerate()
    {
        runs_repo::append_run(
            &pool,
            &LifecycleRun {
                id: format!("r{i}"),
                project_id: p.clone(),
                measure_id: "m1".into(),
                command_id: id.into(),
                command: format!("npm run {id}"),
                kind,
                outcome: LifecycleRunOutcome::Passed,
                exit_code: Some(0),
                duration_ms: 10,
                value_pct: None,
                first_error: None,
                head_sha: "abc".into(),
                started_at: format!("2026-10-08T00:00:0{i}.000Z"),
                finished_at: format!("2026-10-08T00:00:0{i}.500Z"),
            },
        )?;
    }
    let gate = step_detail(&pool, &p, "gate")?;
    assert_eq!(gate.runs.len(), 1);
    assert_eq!(gate.runs[0].command_id, "lint");
    assert!(gate.docs.is_empty());
    assert_eq!(step_detail(&pool, &p, "tests")?.runs[0].command_id, "test");
    let other = step_detail(&pool, &p, "commit")?;
    assert!(other.runs.is_empty() && other.docs.is_empty());
    assert!(
        step_detail(&pool, &p, "docs")?.docs.is_empty(),
        "never scanned"
    );
    Ok(())
}

// --- tip + rules ----------------------------------------------------------------

/// A one-commit repo on `main`, or `None` without git.
fn git_repo() -> Option<tempfile::TempDir> {
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
    commit(p, "init")?;
    Some(dir)
}

/// One more commit on the current branch; its sha.
fn commit(root: &Path, name: &str) -> Option<String> {
    std::fs::write(root.join(format!("{name}.md")), name).ok()?;
    git(root, &["add", "."]).ok()?;
    git(root, &["commit", "-m", name]).ok()?;
    Some(git(root, &["rev-parse", "HEAD"]).ok()?.trim().to_string())
}

fn measured_on(pool: &DbPool, project_id: &str, sha: &str) -> Result<(), AppError> {
    use crate::db::models::{LifecycleGateKind, LifecycleRun, LifecycleRunOutcome};
    runs_repo::append_run(
        pool,
        &LifecycleRun {
            id: "r-tip".into(),
            project_id: project_id.into(),
            measure_id: "m-tip".into(),
            command_id: "lint".into(),
            command: "npm run lint".into(),
            kind: LifecycleGateKind::Lint,
            outcome: LifecycleRunOutcome::Passed,
            exit_code: Some(0),
            duration_ms: 10,
            value_pct: None,
            first_error: None,
            head_sha: sha.into(),
            started_at: "2026-10-08T00:00:00.000Z".into(),
            finished_at: "2026-10-08T00:00:01.000Z".into(),
        },
    )
}

#[test]
fn a_non_repo_root_has_no_tip_but_carries_the_rules() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let snap = snapshot(&pool, &p)?;
    assert!(snap.tip.is_none());
    assert_eq!(snap.rules, health::rules_view());
    Ok(())
}

#[test]
fn the_tip_before_any_measure_has_no_measured_sha() -> Result<(), AppError> {
    let Some(repo) = git_repo() else {
        return Ok(());
    };
    let pool = crate::db::init_test_db()?;
    let p = project(&pool, repo.path())?;
    let head = git(repo.path(), &["rev-parse", "HEAD"])
        .map_err(AppError::Internal)?
        .trim()
        .to_string();
    let tip = snapshot(&pool, &p)?.tip.expect("a repo has a tip");
    assert_eq!(
        (tip.branch.as_str(), tip.sha.as_str()),
        ("main", head.as_str())
    );
    assert!(tip.measured_sha.is_none() && tip.measured_at.is_none());
    assert!(tip.commits_behind.is_none());
    Ok(())
}

#[test]
fn the_tip_counts_commits_since_the_newest_measure() -> Result<(), AppError> {
    let Some(repo) = git_repo() else {
        return Ok(());
    };
    let root = repo.path();
    let pool = crate::db::init_test_db()?;
    let p = project(&pool, root)?;
    let measured = git(root, &["rev-parse", "HEAD"])
        .map_err(AppError::Internal)?
        .trim()
        .to_string();
    measured_on(&pool, &p, &measured)?;
    let tip = snapshot(&pool, &p)?.tip.expect("tip");
    assert_eq!(tip.commits_behind, Some(0), "measured on the tip itself");

    commit(root, "two").expect("commit");
    let now = commit(root, "three").expect("commit");
    let tip = snapshot(&pool, &p)?.tip.expect("tip");
    assert_eq!(tip.sha, now);
    assert_eq!(tip.measured_sha.as_deref(), Some(measured.as_str()));
    assert_eq!(tip.measured_at.as_deref(), Some("2026-10-08T00:00:01.000Z"));
    assert_eq!(tip.commits_behind, Some(2));

    // A measured sha git does not know is not a count.
    let pool = crate::db::init_test_db()?;
    let p = project(&pool, root)?;
    measured_on(&pool, &p, "0123456789abcdef0123456789abcdef01234567")?;
    let tip = snapshot(&pool, &p)?.tip.expect("tip");
    assert!(tip.commits_behind.is_none());
    Ok(())
}

// --- previous + history -----------------------------------------------------------

/// Measure `n` (1-based, larger is newer): lint then test, both passing, on `sha-<n>`.
fn measure_n(pool: &DbPool, project_id: &str, n: u32) -> Result<(), AppError> {
    use crate::db::models::{LifecycleGateKind as K, LifecycleRun, LifecycleRunOutcome};
    for (i, (id, kind)) in [("lint", K::Lint), ("test", K::Test)]
        .into_iter()
        .enumerate()
    {
        runs_repo::append_run(
            pool,
            &LifecycleRun {
                id: format!("r{n}-{id}"),
                project_id: project_id.into(),
                measure_id: format!("m{n}"),
                command_id: id.into(),
                command: format!("npm run {id}"),
                kind,
                outcome: LifecycleRunOutcome::Passed,
                exit_code: Some(0),
                duration_ms: 100 * (i as u32 + 1),
                value_pct: None,
                first_error: None,
                head_sha: format!("sha-{n}"),
                started_at: format!("2026-10-0{n}T00:00:0{i}.000Z"),
                finished_at: format!("2026-10-0{n}T00:00:0{i}.500Z"),
            },
        )?;
    }
    Ok(())
}

#[test]
fn history_with_zero_one_and_three_measures() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;

    let h = history(&pool, &p)?;
    assert!(h.measures.is_empty());
    assert_eq!(
        h.step_ids,
        ["gate", "tests"],
        "the Solo doc's command steps"
    );

    measure_n(&pool, &p, 1)?;
    let h = history(&pool, &p)?;
    assert_eq!(h.measures.len(), 1);
    let c = &h.measures[0];
    assert_eq!(
        (c.measure_id.as_str(), c.head_sha.as_str()),
        ("m1", "sha-1")
    );
    assert_eq!(c.duration_ms, 300);
    assert_eq!(
        (c.started_at.as_str(), c.finished_at.as_str()),
        ("2026-10-01T00:00:00.000Z", "2026-10-01T00:00:01.500Z")
    );
    assert_eq!(
        c.runs
            .iter()
            .map(|r| r.command_id.as_str())
            .collect::<Vec<_>>(),
        ["lint", "test"]
    );
    assert_eq!(
        c.cells
            .iter()
            .map(|x| x.step_id.as_str())
            .collect::<Vec<_>>(),
        ["gate", "tests"]
    );
    let snap = snapshot(&pool, &p)?;
    let gate = snap
        .health
        .iter()
        .find(|v| v.step_id == "gate")
        .expect("gate");
    assert!(gate.previous.is_none(), "nothing before the first Measure");

    measure_n(&pool, &p, 2)?;
    measure_n(&pool, &p, 3)?;
    let h = history(&pool, &p)?;
    assert_eq!(
        h.measures
            .iter()
            .map(|c| c.measure_id.as_str())
            .collect::<Vec<_>>(),
        ["m3", "m2", "m1"],
        "newest first"
    );
    // Not a repo: the snapshot has no tip, so nothing is stale and its gate
    // verdict is the newest column's; `previous` is the next column's.
    let snap = snapshot(&pool, &p)?;
    let gate = snap
        .health
        .iter()
        .find(|v| v.step_id == "gate")
        .expect("gate");
    assert_eq!(gate.health, h.measures[0].cells[0].health);
    let previous = gate.previous.as_ref().expect("previous");
    assert_eq!(previous.health, h.measures[1].cells[0].health);
    assert_eq!(previous.metrics, h.measures[1].cells[0].metrics);
    assert_eq!(previous.head_sha.as_deref(), Some("sha-2"));
    assert_eq!(
        previous.measured_at.as_deref(),
        Some("2026-10-02T00:00:00.500Z"),
        "when measure 2 ran the gate"
    );
    Ok(())
}

#[test]
fn evidence_previous_excludes_the_newest_change() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let snap = snapshot(&pool, &p)?;
    let commit_step = |snap: &LifecycleSnapshot| {
        snap.health
            .iter()
            .find(|v| v.step_id == "commit")
            .cloned()
            .expect("commit")
    };
    assert!(commit_step(&snap).previous.is_none(), "no evidence at all");

    let outcome = |o: LifecycleOutcome| {
        serde_json::to_string(&vec![LifecycleStepOutcome {
            step_id: "commit".into(),
            outcome: o,
            detail: None,
        }])
    };
    // Five done changes, then a newest skipped one.
    for day in 1..=5 {
        repo::upsert_task_evidence(
            &pool,
            &p,
            &format!("t{day}"),
            "done",
            &outcome(LifecycleOutcome::Done)?,
            &format!("2026-09-0{day}T00:00:00Z"),
        )?;
    }
    repo::upsert_task_evidence(
        &pool,
        &p,
        "t6",
        "skipped",
        &outcome(LifecycleOutcome::Skipped)?,
        "2026-09-06T00:00:00Z",
    )?;
    let commit = commit_step(&snapshot(&pool, &p)?);
    let rate = |m: &[crate::db::models::LifecycleMetric]| (m[0].value, m[0].samples);
    assert_eq!(rate(&commit.metrics).1, 6);
    let previous = commit.previous.expect("previous");
    assert_eq!(
        rate(&previous.metrics),
        (Some(100.0), 5),
        "the skip excluded"
    );
    assert_eq!(previous.health, crate::db::models::LifecycleHealth::Green);
    assert_eq!(
        previous.measured_at.as_deref(),
        Some("2026-09-05T00:00:00Z")
    );
    assert!(previous.head_sha.is_none());
    Ok(())
}

#[test]
fn a_full_evidence_window_shifts_by_one_change() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let json = serde_json::to_string(&vec![LifecycleStepOutcome {
        step_id: "commit".into(),
        outcome: LifecycleOutcome::Done,
        detail: None,
    }])?;
    // One more change than the window holds: `previous` still counts a full window.
    for i in 0..=EVIDENCE_LIMIT {
        repo::upsert_task_evidence(
            &pool,
            &p,
            &format!("t{i:02}"),
            "done",
            &json,
            &format!("2026-09-{:02}T00:00:00Z", i + 1),
        )?;
    }
    let snap = snapshot(&pool, &p)?;
    assert_eq!(snap.evidence.len(), EVIDENCE_LIMIT);
    let commit = snap
        .health
        .iter()
        .find(|v| v.step_id == "commit")
        .expect("commit");
    let limit = EVIDENCE_LIMIT as u32;
    assert_eq!(commit.metrics[0].samples, limit);
    let previous = commit.previous.as_ref().expect("previous");
    assert_eq!(previous.metrics[0].samples, limit);
    assert_eq!(
        previous.measured_at.as_deref(),
        Some("2026-09-20T00:00:00Z")
    );
    Ok(())
}
