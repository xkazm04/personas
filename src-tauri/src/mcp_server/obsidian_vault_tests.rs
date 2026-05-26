//! Live integration tests for the P3 Athena vault tools in the personas-mcp
//! sidecar. Drives the public `call_tool` dispatch against a real temp DB
//! (with the minimal schema the sidecar reads) and a real temp vault dir — no
//! mocks. Verifies the Athena-toggle gating, TF-IDF search, and note write.

use super::db::{open_pool, McpDbPool};
use super::tools::call_tool;
use serde_json::json;
use std::path::{Path, PathBuf};

fn unique(prefix: &str) -> PathBuf {
    std::env::temp_dir().join(format!("{prefix}_{}", uuid::Uuid::new_v4()))
}

/// Build a temp SQLite DB carrying just what the sidecar reads: a `personas`
/// table (verify_schema gate) and `app_settings` rows for the Brain + mirror
/// configs. Returns (db_path, pool).
fn setup_db(vault: &Path, athena_on: bool) -> (PathBuf, McpDbPool) {
    let db_path = unique("obs_mcp_test").with_extension("db");
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE personas (id TEXT PRIMARY KEY);
             CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);",
        )
        .unwrap();
        let cfg = json!({
            "vaultPath": vault.to_string_lossy(),
            "folderMapping": { "athenaFolder": "Athena" }
        })
        .to_string();
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('obsidian_brain_config', ?1)",
            [&cfg],
        )
        .unwrap();
        let mirror = json!({ "athena": athena_on }).to_string();
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('obsidian_mirror_config', ?1)",
            [&mirror],
        )
        .unwrap();
    }
    let pool = open_pool(&db_path).unwrap();
    (db_path, pool)
}

fn is_error(res: &serde_json::Value) -> bool {
    res.get("isError").and_then(|v| v.as_bool()).unwrap_or(true)
}

fn text(res: &serde_json::Value) -> String {
    res["content"][0]["text"].as_str().unwrap_or("").to_string()
}

#[test]
fn search_and_write_when_athena_enabled() {
    let vault = unique("obs_mcp_vault");
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::write(
        vault.join("Stoicism.md"),
        "Notes on stoicism and resilience under pressure.",
    )
    .unwrap();
    let (db_path, pool) = setup_db(&vault, true);

    // Search finds the note.
    let res = call_tool("obsidian_vault_search", &json!({ "query": "stoicism" }), &pool);
    assert!(!is_error(&res), "search errored: {}", text(&res));
    assert!(
        text(&res).contains("Stoicism"),
        "expected the note in results, got: {}",
        text(&res)
    );

    // Write creates a slugged note under the Athena folder.
    let res = call_tool(
        "obsidian_vault_write_note",
        &json!({ "title": "My Finding", "content": "A durable analysis." }),
        &pool,
    );
    assert!(!is_error(&res), "write errored: {}", text(&res));
    assert!(
        vault.join("Athena/my-finding.md").exists(),
        "expected Athena/my-finding.md to be written"
    );

    let _ = std::fs::remove_dir_all(&vault);
    let _ = std::fs::remove_file(&db_path);
}

#[test]
fn tools_are_gated_off_when_toggle_disabled() {
    let vault = unique("obs_mcp_vault_off");
    std::fs::create_dir_all(&vault).unwrap();
    let (db_path, pool) = setup_db(&vault, false);

    let res = call_tool("obsidian_vault_search", &json!({ "query": "x" }), &pool);
    assert!(is_error(&res), "search should be gated off when athena=false");

    let res = call_tool(
        "obsidian_vault_write_note",
        &json!({ "title": "T", "content": "C" }),
        &pool,
    );
    assert!(is_error(&res), "write should be gated off when athena=false");

    let _ = std::fs::remove_dir_all(&vault);
    let _ = std::fs::remove_file(&db_path);
}
