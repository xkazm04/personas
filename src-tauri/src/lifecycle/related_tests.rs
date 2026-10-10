use super::*;
use crate::db::models::{
    IdeaDraft, LifecycleAuthor, LifecycleGateCommand, LifecycleGateKind, LifecyclePreset,
};
use crate::db::repos::dev::ideas::file_idea;
use crate::db::repos::dev::projects::create_project;
use crate::lifecycle::presets::preset_doc;
use rusqlite::params;

/// A project whose gate step runs `tsc` and whose tests step runs nothing.
fn project(pool: &DbPool, root: &Path) -> Result<String, AppError> {
    let p = create_project(
        pool,
        "lc-related",
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )?
    .id;
    let mut doc = preset_doc(LifecyclePreset::Solo);
    for step in doc.steps.iter_mut() {
        match step.id.as_str() {
            "gate" => {
                step.params.commands = Some(vec![LifecycleGateCommand {
                    id: "tsc".into(),
                    command: "npx tsc".into(),
                    kind: LifecycleGateKind::Typecheck,
                    budget_ms: None,
                }])
            }
            "tests" => step.params.commands = Some(Vec::new()),
            _ => {}
        }
    }
    crate::lifecycle::append(pool, &p, &doc, None, LifecycleAuthor::Operator)?;
    Ok(p)
}

fn file(
    pool: &DbPool,
    project_id: &str,
    source: BacklogSource,
    key: &str,
    status: &str,
    created_at: &str,
) -> Result<String, AppError> {
    let mut d = IdeaDraft::new(project_id, source, format!("about {key}"));
    d.dedup_key = Some(key.to_string());
    let id = file_idea(pool, d)?
        .ok_or_else(|| AppError::Internal("not filed".into()))?
        .id;
    pool.get()?.execute(
        "UPDATE dev_ideas SET status = ?1, created_at = ?2 WHERE id = ?3",
        params![status, created_at, id],
    )?;
    Ok(id)
}

#[test]
fn each_step_lists_its_own_producers_items() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let slow = file(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        "lifecycle:slow:tsc",
        "pending",
        "2026-10-01T00:00:00Z",
    )?;
    let gate_goal = file(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        "lifecycle:goal:g1:step:gate",
        "delivered",
        "2026-10-03T00:00:00Z",
    )?;
    let docs_goal = file(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        "lifecycle:goal:g1:step:docs",
        "accepted",
        "2026-10-02T00:00:00Z",
    )?;
    let rot = file(
        &pool,
        &p,
        BacklogSource::DocRot,
        "doc:README.md",
        "pending",
        "2026-10-04T00:00:00Z",
    )?;
    // A slow item for a command the gate step does not run.
    file(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        "lifecycle:slow:vitest",
        "pending",
        "2026-10-05T00:00:00Z",
    )?;

    let gate = crate::lifecycle::step_detail(&pool, &p, "gate")?.related;
    assert_eq!(
        gate.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        vec![slow.as_str(), gate_goal.as_str()],
        "open before closed"
    );
    assert_eq!(gate[0].source, LifecycleRelatedSource::SlowGate);
    assert_eq!(gate[0].command_id.as_deref(), Some("tsc"));
    assert_eq!(gate[0].status, "pending");
    assert_eq!(gate[1].source, LifecycleRelatedSource::Overseer);
    assert_eq!(gate[1].command_id, None);

    let docs = crate::lifecycle::step_detail(&pool, &p, "docs")?.related;
    assert_eq!(
        docs.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
        vec![rot.as_str(), docs_goal.as_str()],
        "newest first among open"
    );
    assert_eq!(docs[0].source, LifecycleRelatedSource::DocRot);

    assert!(crate::lifecycle::step_detail(&pool, &p, "frame")?
        .related
        .is_empty());
    Ok(())
}

#[test]
fn a_command_that_only_ran_still_finds_its_slow_item() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    let old = file(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        "lifecycle:slow:lint",
        "pending",
        "2026-10-01T00:00:00Z",
    )?;
    let items = related_items(&pool, &p, "gate", ["lint".to_string()])?;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, old);
    Ok(())
}

#[test]
fn at_most_twenty() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    let dir = tempfile::tempdir()?;
    let p = project(&pool, dir.path())?;
    for i in 0..(RELATED_LIMIT + 3) {
        file(
            &pool,
            &p,
            BacklogSource::Lifecycle,
            &format!("lifecycle:goal:g{i}:step:gate"),
            "pending",
            &format!("2026-10-01T00:00:{i:02}Z"),
        )?;
    }
    let items = related_items(&pool, &p, "gate", Vec::new())?;
    assert_eq!(items.len(), RELATED_LIMIT);
    assert!(items[0].created_at > items[RELATED_LIMIT - 1].created_at);
    Ok(())
}

#[test]
fn an_underscore_in_a_step_id_is_literal() {
    let m = related_match("my_step", &BTreeSet::new());
    assert_eq!(m.dedup_key_like, vec!["lifecycle:goal:%:step:my\\_step"]);
    assert!(m.dedup_keys.is_empty());
    assert!(m.origins.is_empty());
}
