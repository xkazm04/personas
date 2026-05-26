//! Live integration tests for the knowledge-mirror backend (P0/P2 + the shared
//! P1 primitive). These exercise the real functions against a fully-migrated
//! temp DB (`init_test_db`) and a real temp vault directory — no mocks.

use super::{
    mirror_config, mirror_execution_knowledge_for_persona, mirror_write_note, resolve_availability,
    MIRROR_SETTINGS_KEY, SETTINGS_KEY,
};
use crate::db::init_test_db;
use crate::db::models::{ObsidianMirrorConfig, ObsidianVaultConfig};
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::DbPool;
use std::path::{Path, PathBuf};

fn temp_vault() -> PathBuf {
    let p = std::env::temp_dir().join(format!("obs_mirror_vault_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn set_vault(pool: &DbPool, vault: &Path) {
    let cfg = ObsidianVaultConfig {
        vault_path: vault.to_string_lossy().to_string(),
        vault_name: "Test".into(),
        ..Default::default()
    };
    settings_repo::set(pool, SETTINGS_KEY, &serde_json::to_string(&cfg).unwrap()).unwrap();
}

fn set_mirror(pool: &DbPool, cfg: ObsidianMirrorConfig) {
    settings_repo::set(pool, MIRROR_SETTINGS_KEY, &serde_json::to_string(&cfg).unwrap()).unwrap();
}

#[test]
fn mirror_config_defaults_off_and_roundtrips() {
    let pool = init_test_db().unwrap();
    let c = mirror_config(&pool);
    assert!(!c.athena && !c.execution_knowledge && !c.research_lab && !c.offer_dismissed);

    set_mirror(
        &pool,
        ObsidianMirrorConfig {
            research_lab: true,
            ..Default::default()
        },
    );
    assert!(mirror_config(&pool).research_lab);
    assert!(!mirror_config(&pool).athena);
}

#[test]
fn availability_requires_a_configured_vault() {
    let pool = init_test_db().unwrap();
    // No config → the vault signal is off (binary detection may be either way
    // in CI, so we assert specifically on vault_configured).
    assert!(!resolve_availability(&pool).vault_configured);

    let vault = temp_vault();
    set_vault(&pool, &vault);
    let a = resolve_availability(&pool);
    assert!(a.vault_configured, "vault should register as configured");
    assert!(a.available, "available must be true once a vault is configured");
    let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn mirror_write_note_is_incremental() {
    let pool = init_test_db().unwrap();
    let vault = temp_vault();
    let vp = vault.to_string_lossy().to_string();

    // First write → created.
    assert!(mirror_write_note(&pool, &vp, "Knowledge/a.md", "test_kind", "id1", "hello").unwrap());
    assert!(vault.join("Knowledge/a.md").exists());

    // Unchanged content → skipped.
    assert!(!mirror_write_note(&pool, &vp, "Knowledge/a.md", "test_kind", "id1", "hello").unwrap());

    // Changed content → written again.
    assert!(mirror_write_note(&pool, &vp, "Knowledge/a.md", "test_kind", "id1", "world").unwrap());
    assert_eq!(
        std::fs::read_to_string(vault.join("Knowledge/a.md")).unwrap(),
        "world"
    );
    let _ = std::fs::remove_dir_all(&vault);
}

#[test]
fn execution_knowledge_mirror_writes_then_skips() {
    let pool = init_test_db().unwrap();
    let vault = temp_vault();
    set_vault(&pool, &vault);
    set_mirror(
        &pool,
        ObsidianMirrorConfig {
            execution_knowledge: true,
            ..Default::default()
        },
    );

    knowledge_repo::upsert(
        &pool,
        "persona-x",
        None,
        "tool_sequence",
        "fetch -> write",
        "{\"tools\":[\"fetch\",\"write\"]}",
        true,
        0.01,
        1200.0,
        "exec-1",
    )
    .unwrap();

    let written = mirror_execution_knowledge_for_persona(&pool, "persona-x");
    assert!(written >= 1, "expected >=1 note written, got {written}");

    let dir = vault.join("Knowledge").join("tool_sequence");
    let any_md = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|e| e.path().extension().map(|x| x == "md").unwrap_or(false));
    assert!(any_md, "expected an .md note under {}", dir.display());

    // Re-run with no changes → incremental skip → nothing written.
    assert_eq!(mirror_execution_knowledge_for_persona(&pool, "persona-x"), 0);

    // Disabled toggle → no-op even though a row exists.
    set_mirror(&pool, ObsidianMirrorConfig::default());
    assert_eq!(mirror_execution_knowledge_for_persona(&pool, "persona-x"), 0);

    let _ = std::fs::remove_dir_all(&vault);
}
