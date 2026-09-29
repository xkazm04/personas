//! `dev_lifecycle_*` repo tests.
//!
//! Included from `lifecycle.rs` via `#[path]` so `use super::*` reaches the
//! repo's private items exactly as an inline `mod tests` would.

use super::*;
use crate::repos::dev::projects::{create_project, get_project_by_id};

fn project(pool: &DbPool, name: &str) -> Result<String, AppError> {
    Ok(create_project(
        pool,
        name,
        &format!("/tmp/{name}"),
        None,
        None,
        None,
        None,
        None,
    )?
    .id)
}

#[test]
fn a_project_without_rows_has_no_latest_version() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "lc-empty")?;
    assert!(latest_version(&pool, &p)?.is_none());
    assert!(list_versions(&pool, &p)?.is_empty());
    Ok(())
}

/// The append allocates 1, 2, ... and rewrites standards_config in the same
/// transaction.
#[test]
fn append_version_numbers_and_rewrites_standards() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "lc-append")?;
    let v1 = append_version(
        &pool,
        &p,
        "solo",
        "{\"a\":1}",
        Some("first"),
        "operator",
        "{\"s\":1}",
    )?;
    assert_eq!(v1.version, 1);
    assert_eq!(v1.change_note.as_deref(), Some("first"));
    assert_eq!(
        get_project_by_id(&pool, &p)?.standards_config.as_deref(),
        Some("{\"s\":1}")
    );
    let v2 = append_version(&pool, &p, "team", "{\"a\":2}", None, "athena", "{\"s\":2}")?;
    assert_eq!(v2.version, 2);
    assert_eq!(
        get_project_by_id(&pool, &p)?.standards_config.as_deref(),
        Some("{\"s\":2}")
    );
    let latest = latest_version(&pool, &p)?.expect("latest");
    assert_eq!(latest.version, 2);
    assert_eq!(latest.preset, "team");
    let all = list_versions(&pool, &p)?;
    assert_eq!(
        all.iter().map(|v| v.version).collect::<Vec<_>>(),
        vec![2, 1]
    );
    Ok(())
}

/// A refused INSERT (CHECK) rolls the standards rewrite back with it.
#[test]
fn a_refused_append_leaves_standards_untouched() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "lc-rollback")?;
    append_version(&pool, &p, "solo", "{}", None, "operator", "{\"s\":1}")?;
    assert!(append_version(&pool, &p, "enterprise", "{}", None, "operator", "{\"s\":9}").is_err());
    assert_eq!(
        get_project_by_id(&pool, &p)?.standards_config.as_deref(),
        Some("{\"s\":1}")
    );
    assert_eq!(list_versions(&pool, &p)?.len(), 1);
    Ok(())
}

#[test]
fn append_to_unknown_project_is_not_found() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let err = append_version(&pool, "nope", "solo", "{}", None, "operator", "{}");
    assert!(matches!(err, Err(AppError::NotFound(_))));
    Ok(())
}

#[test]
fn install_task_is_set_once() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "lc-install")?;
    append_version(&pool, &p, "solo", "{}", None, "operator", "{}")?;
    assert!(set_install_task(&pool, &p, 1, "task-a")?);
    assert!(
        !set_install_task(&pool, &p, 1, "task-b")?,
        "second set is refused"
    );
    assert_eq!(
        latest_version(&pool, &p)?
            .and_then(|v| v.install_task_id)
            .as_deref(),
        Some("task-a")
    );
    Ok(())
}

#[test]
fn task_evidence_upserts_per_task_and_lists_newest_first() -> Result<(), AppError> {
    let pool = crate::init_test_db()?;
    let p = project(&pool, "lc-evidence")?;
    upsert_task_evidence(&pool, &p, "t1", "one", "[]", "2026-09-01T00:00:00Z")?;
    upsert_task_evidence(&pool, &p, "t2", "two", "[]", "2026-09-02T00:00:00Z")?;
    let again = upsert_task_evidence(&pool, &p, "t1", "one again", "[1]", "2026-09-03T00:00:00Z")?;
    assert_eq!(again.title, "one again");
    assert_eq!(again.source_kind, "task");
    let rows = list_task_evidence(&pool, &p, 10)?;
    assert_eq!(rows.len(), 2, "re-finalizing replaces, never adds");
    assert_eq!(rows[0].source_ref, "t1");
    assert_eq!(rows[0].outcomes_json, "[1]");
    assert_eq!(list_task_evidence(&pool, &p, 1)?.len(), 1);
    Ok(())
}
