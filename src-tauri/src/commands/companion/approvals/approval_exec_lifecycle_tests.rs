use serde_json::json;

use super::*;
use crate::db::models::{LifecycleAuthor, LifecyclePreset};
use crate::lifecycle::presets::preset_doc;

/// One registered project (empty temp root) + one pending proposal card that
/// adds a custom `claude_md` step and drops `docs`. Returns the card id.
fn seed(db: &DbPool, user_db: &UserDbPool) -> Result<String, AppError> {
    let root = std::env::temp_dir().join(format!("lc_apply_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).map_err(AppError::Io)?;
    {
        let conn = db.get()?;
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1', 'personas', ?1, 'active', '2026-09-25', '2026-09-25')",
            rusqlite::params![root.to_string_lossy()],
        )?;
    }
    let mut steps: Vec<serde_json::Value> = preset_doc(LifecyclePreset::Solo)
        .steps
        .iter()
        .filter(|s| s.id != "docs")
        .map(|s| json!({"id": s.id}))
        .collect();
    steps.push(json!({"id": "x-demo", "phase": "after", "label": "Demo", "rule": "Record a demo.", "bindings": ["claude_md"]}));
    let card = lifecycle_ops::build_proposal_card(
        db,
        &json!({"project": "personas", "change_note": "demo, no docs", "steps": steps}),
    )
    .map_err(AppError::Validation)?;
    let config = serde_json::to_string(&card).map_err(|e| AppError::Internal(e.to_string()))?;
    chat_cards::insert_card(
        user_db,
        "conv_1",
        None,
        lifecycle_ops::LIFECYCLE_PROPOSAL_KIND,
        None,
        config,
    )
}

#[test]
fn confirm_appends_an_athena_version_with_only_the_ticked_changes() -> Result<(), AppError> {
    let db = crate::db::init_test_db()?;
    let user_db = crate::db::init_test_user_db()?;
    let card_id = seed(&db, &user_db)?;

    let done = apply_lifecycle_proposal_inner(&db, &user_db, &card_id, &["x-demo".to_string()])?;
    assert_eq!(done.version, 1);
    assert_eq!(done.applied, 1);
    assert!(
        done.install_wanted,
        "a new claude_md step asks the repo for more"
    );
    assert_eq!(done.conversation_id, "conv_1");

    let (doc, version, row) = crate::lifecycle::current_doc(&db, "p1")?;
    assert_eq!(version, 1);
    let row = row.ok_or_else(|| AppError::Internal("no stored row".into()))?;
    assert_eq!(row.author, LifecycleAuthor::Athena.as_str());
    assert_eq!(row.change_note.as_deref(), Some("demo, no docs"));
    let ids: Vec<&str> = doc.steps.iter().map(|s| s.id.as_str()).collect();
    assert!(ids.contains(&"x-demo"));
    assert!(
        ids.contains(&"docs"),
        "the unticked removal was not applied"
    );

    // The card is claimed: a second confirm is refused and writes nothing.
    assert_eq!(
        chat_cards::get_card(&user_db, &card_id)?.status,
        "dispatched"
    );
    assert!(
        apply_lifecycle_proposal_inner(&db, &user_db, &card_id, &["x-demo".to_string()]).is_err()
    );
    assert_eq!(crate::lifecycle::current_doc(&db, "p1")?.1, 1);
    Ok(())
}

#[test]
fn confirm_refuses_a_stale_from_version_and_supersedes_the_card() -> Result<(), AppError> {
    let db = crate::db::init_test_db()?;
    let user_db = crate::db::init_test_user_db()?;
    let card_id = seed(&db, &user_db)?;
    // The operator switched preset after the card was drawn.
    crate::lifecycle::set_preset(&db, "p1", LifecyclePreset::Team)?;

    let err = apply_lifecycle_proposal_inner(&db, &user_db, &card_id, &["x-demo".to_string()])
        .unwrap_err()
        .to_string();
    assert!(err.contains("changed since this proposal"), "{err}");
    assert!(err.contains("v0") && err.contains("v1"), "{err}");
    assert_eq!(
        chat_cards::get_card(&user_db, &card_id)?.status,
        "superseded"
    );
    assert_eq!(
        crate::lifecycle::current_doc(&db, "p1")?.1,
        1,
        "nothing appended"
    );
    Ok(())
}

#[test]
fn confirm_refuses_an_unknown_change_id_without_burning_the_card() -> Result<(), AppError> {
    let db = crate::db::init_test_db()?;
    let user_db = crate::db::init_test_user_db()?;
    let card_id = seed(&db, &user_db)?;
    let err = apply_lifecycle_proposal_inner(&db, &user_db, &card_id, &["frame".to_string()])
        .unwrap_err()
        .to_string();
    assert!(err.contains("`frame` is not one of"), "{err}");
    assert_eq!(chat_cards::get_card(&user_db, &card_id)?.status, "pending");
    assert_eq!(crate::lifecycle::current_doc(&db, "p1")?.1, 0);
    Ok(())
}
