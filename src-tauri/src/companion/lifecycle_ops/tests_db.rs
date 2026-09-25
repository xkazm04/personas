//! The DB-backed half: project resolution, the card build, the read op.

use serde_json::json;

use super::super::*;
use crate::db::models::{LifecycleAuthor, LifecycleChangeKind, LifecyclePreset};
use crate::db::DbPool;
use crate::error::AppError;
use crate::lifecycle::presets::preset_doc;

/// A registered project whose root is an empty temp dir (no repo bindings).
pub(crate) fn seed_project(pool: &DbPool, id: &str, name: &str) -> Result<(), AppError> {
    let root = std::env::temp_dir().join(format!("lc_ops_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).map_err(AppError::Io)?;
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', '2026-09-25', '2026-09-25')",
        rusqlite::params![id, name, root.to_string_lossy()],
    )?;
    Ok(())
}

fn stubs(preset: LifecyclePreset) -> Vec<serde_json::Value> {
    preset_doc(preset)
        .steps
        .iter()
        .map(|s| json!({"id": s.id}))
        .collect()
}

#[test]
fn the_card_resolves_the_project_by_name_and_diffs_against_v0() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    seed_project(&pool, "p1", "personas")?;
    let mut steps = stubs(LifecyclePreset::Solo);
    steps.push(json!({"id": "x-demo", "phase": "after", "label": "Demo", "rule": "Record a demo.", "bindings": ["advisory"]}));
    let card = build_proposal_card(
        &pool,
        &json!({"project": "personas", "change_note": "demo step", "steps": steps}),
    )
    .map_err(AppError::Validation)?;
    assert_eq!(card.project_id, "p1");
    assert_eq!(card.project_name, "personas");
    assert_eq!(card.from_version, 0);
    assert_eq!(card.changes.len(), 1);
    assert_eq!(card.changes[0].kind, LifecycleChangeKind::Added);
    // The card round-trips through the durable config JSON (camelCase).
    let config = serde_json::to_value(&card).map_err(|e| AppError::Internal(e.to_string()))?;
    assert_eq!(config["fromVersion"], json!(0));
    assert_eq!(config["changes"][0]["stepId"], json!("x-demo"));
    let back: crate::db::models::LifecycleProposalCard =
        serde_json::from_value(config).map_err(|e| AppError::Internal(e.to_string()))?;
    assert_eq!(back, card);
    Ok(())
}

#[test]
fn an_identical_proposal_is_refused_with_its_version() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    seed_project(&pool, "p1", "personas")?;
    crate::lifecycle::append(
        &pool,
        "p1",
        &preset_doc(LifecyclePreset::Team),
        Some("team"),
        LifecycleAuthor::Operator,
    )?;
    let err = build_proposal_card(
        &pool,
        &json!({"project": "p1", "change_note": "noop", "doc": {"preset": "team", "steps": stubs(LifecyclePreset::Team)}}),
    )
    .unwrap_err();
    assert!(err.contains("identical to v1"), "{err}");
    Ok(())
}

#[test]
fn an_unknown_project_fails_closed_and_lists_real_names() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    seed_project(&pool, "p1", "personas")?;
    let err = resolve_project(&pool, "nope").unwrap_err();
    assert!(
        err.contains("no registered project matches `nope`"),
        "{err}"
    );
    assert!(err.contains("personas"), "{err}");
    Ok(())
}

#[test]
fn describe_answers_a_compact_digest() -> Result<(), AppError> {
    let pool = crate::db::init_test_db()?;
    seed_project(&pool, "p1", "personas")?;
    let body = describe_lifecycle(&pool, "personas");
    assert!(
        body.starts_with("LIFECYCLE personas (`p1`): preset solo, v0 by default"),
        "{body}"
    );
    assert!(
        body.contains("- frame [before] bindings=app:live evidence=0/0/0/0"),
        "{body}"
    );
    assert!(
        body.contains("- recall [before] bindings=claude_md:missing"),
        "{body}"
    );
    assert!(body.contains("Newest evidence: none yet."), "{body}");
    assert!(body.contains("`show_lifecycle_proposal`"), "{body}");
    assert!(body.chars().count() <= describe::DESCRIBE_MAX_CHARS);
    let miss = describe_lifecycle(&pool, "ghost");
    assert!(miss.contains("no registered project matches"), "{miss}");
    Ok(())
}
