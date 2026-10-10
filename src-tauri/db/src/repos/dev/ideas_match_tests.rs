//! [`list_ideas_matching`]: which ideas a match selects and in what order.
//!
//! Included from `ideas.rs` via `#[path]` so `use super::*` reaches the
//! repo's private items exactly as an inline `mod tests` would.
use super::*;
use crate::repos::dev::projects::create_project;
use crate::repos::utils::escape_like;

fn project(pool: &DbPool, name: &str) -> String {
    create_project(
        pool,
        name,
        &format!("/tmp/{name}"),
        None,
        None,
        None,
        None,
        None,
    )
    .expect("project")
    .id
}

/// File one idea and stamp its status and creation time.
fn idea(
    pool: &DbPool,
    project_id: &str,
    source: BacklogSource,
    key: Option<&str>,
    status: &str,
    created_at: &str,
) -> Result<String, AppError> {
    let mut d = IdeaDraft::new(project_id, source, format!("item {created_at}"));
    d.dedup_key = key.map(str::to_string);
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
fn each_clause_selects_and_only_this_projects_rows() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "a");
    let other = project(&pool, "b");
    let slow = idea(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        Some("lifecycle:slow:tsc"),
        "pending",
        "2026-10-01T00:00:00Z",
    )?;
    let goal = idea(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        Some("lifecycle:goal:g1:step:gate"),
        "accepted",
        "2026-10-02T00:00:00Z",
    )?;
    let doc = idea(
        &pool,
        &p,
        BacklogSource::DocRot,
        Some("doc:README.md"),
        "pending",
        "2026-10-03T00:00:00Z",
    )?;
    // Same key, other project: never selected.
    idea(
        &pool,
        &other,
        BacklogSource::Lifecycle,
        Some("lifecycle:slow:tsc"),
        "pending",
        "2026-10-04T00:00:00Z",
    )?;
    // The overseer key of another step: not selected by the gate pattern.
    idea(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        Some("lifecycle:goal:g1:step:gate_x"),
        "pending",
        "2026-10-05T00:00:00Z",
    )?;

    let ids = |m: &IdeaMatch| -> Vec<String> {
        list_ideas_matching(&pool, &p, m, 20)
            .expect("list")
            .into_iter()
            .map(|i| i.id)
            .collect()
    };
    assert_eq!(
        ids(&IdeaMatch {
            dedup_keys: vec!["lifecycle:slow:tsc".into()],
            ..Default::default()
        }),
        vec![slow.clone()]
    );
    // `_` in the step id is escaped, so `gate` does not also match `gate_x`.
    assert_eq!(
        ids(&IdeaMatch {
            dedup_key_like: vec![format!("lifecycle:goal:%:step:{}", escape_like("gate"))],
            ..Default::default()
        }),
        vec![goal.clone()]
    );
    assert_eq!(
        ids(&IdeaMatch {
            origins: vec![BacklogSource::DocRot.as_str().into()],
            ..Default::default()
        }),
        vec![doc.clone()]
    );
    assert!(ids(&IdeaMatch::default()).is_empty(), "no clause, no rows");
    Ok(())
}

#[test]
fn open_before_closed_newest_first_and_capped() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "a");
    let old_open = idea(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        Some("lifecycle:slow:a"),
        "pending",
        "2026-10-01T00:00:00Z",
    )?;
    let new_closed = idea(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        Some("lifecycle:slow:b"),
        "delivered",
        "2026-10-05T00:00:00Z",
    )?;
    let new_open = idea(
        &pool,
        &p,
        BacklogSource::Lifecycle,
        Some("lifecycle:slow:c"),
        "accepted",
        "2026-10-03T00:00:00Z",
    )?;
    let m = IdeaMatch {
        dedup_key_like: vec!["lifecycle:slow:%".into()],
        ..Default::default()
    };
    let ids: Vec<String> = list_ideas_matching(&pool, &p, &m, 20)?
        .into_iter()
        .map(|i| i.id)
        .collect();
    assert_eq!(ids, vec![new_open.clone(), old_open, new_closed]);
    let capped: Vec<String> = list_ideas_matching(&pool, &p, &m, 1)?
        .into_iter()
        .map(|i| i.id)
        .collect();
    assert_eq!(capped, vec![new_open]);
    assert!(list_ideas_matching(&pool, &p, &m, 0)?.is_empty());
    Ok(())
}
