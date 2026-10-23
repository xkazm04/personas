//! MCP config installation for Claude Code and Cursor.
//!
//! Where each client reads (Claude Code docs, "MCP installation scopes",
//! <https://code.claude.com/docs/en/mcp>): user-scope servers live in
//! `~/.claude.json` under a top-level `mcpServers` key, project scope in
//! `.mcp.json`. `~/.claude/mcp.json` is NOT read, so `claude-code` writes
//! `~/.claude.json`, merging into the file (it also holds Claude Code's own
//! state, which must survive). We merge directly instead of shelling out to
//! `claude mcp add --scope user` because that would put the plaintext token
//! on a command line visible in the process list. Cursor reads
//! `~/.cursor/mcp.json`.
//!
//! Provisions a `pk_` capability token in the app's `external_api_keys` registry
//! and writes it into the generated config `env` block so the stdio server
//! can authenticate tool calls. The plaintext token is returned exactly once by
//! [`crate::db::repos::resources::external_api_keys::create`] and is written ONLY
//! into the client config — never logged, never persisted elsewhere.

// `personas-mcp install` is a CLI subcommand: this module's prints ARE its user
// interface, and it runs in the `personas-mcp` binary with no tracing subscriber
// attached. Scoped to the module so the rest of the library stays under the
// workspace-wide print lints.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::auth::MCP_REQUIRED_SCOPE;

/// Config file each target reads, relative to `home`.
fn config_path_for(target: &str, home: &Path) -> Option<PathBuf> {
    match target {
        "claude-code" => Some(home.join(".claude.json")),
        "cursor" => Some(home.join(".cursor").join("mcp.json")),
        _ => None,
    }
}

/// Read the existing config. A missing file is an empty config; anything
/// present but unreadable, unparseable or not an object is an error, never
/// silently replaced (that would drop every other server the user had).
fn read_config(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&content).map_err(|e| {
        format!(
            "{} is not valid JSON ({e}); fix or move it, nothing was changed.",
            path.display()
        )
    })?;
    if !value.is_object() {
        return Err(format!(
            "{} is not a JSON object; nothing was changed.",
            path.display()
        ));
    }
    Ok(value)
}

/// Insert/replace the `personas` entry under top-level `mcpServers`, leaving
/// every other key untouched.
fn merge_server(config: &mut Value, server_config: Value) -> Result<(), String> {
    let root = config
        .as_object_mut()
        .ok_or_else(|| "Config must be a JSON object".to_string())?;
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| "mcpServers must be a JSON object; nothing was changed.".to_string())?;
    servers.insert("personas".to_string(), server_config);
    Ok(())
}

/// Write via a sibling temp file + rename so a crash or full disk cannot
/// leave a truncated config behind.
fn write_atomic(path: &Path, config: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".personas-tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, json).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Cannot replace {}: {e}", path.display())
    })
}

/// Install MCP configuration for the specified target.
pub fn install_mcp_config(target: &str) {
    let Some(home) = dirs::home_dir() else {
        eprintln!("Cannot determine home directory");
        std::process::exit(1);
    };
    let Some(config_path) = config_path_for(target, &home) else {
        eprintln!("Unknown target: {target}. Supported: claude-code, cursor");
        std::process::exit(1);
    };

    let binary_path = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(e) => {
            eprintln!("Cannot determine current executable path: {e}");
            std::process::exit(1);
        }
    };

    // Determine DB path
    let db_path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.personas.desktop")
        .join("personas.db");

    if !db_path.exists() {
        eprintln!(
            "Database not found at: {}\n\
             Launch the Personas desktop app at least once before installing the \
             MCP server, so the token registry exists.",
            db_path.display()
        );
        std::process::exit(1);
    }

    // Validate the existing config BEFORE minting a token: an unparseable file
    // must stop the install while nothing live exists yet.
    let mut config = match read_config(&config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = merge_server(&mut config, Value::Null) {
        eprintln!("{e}");
        std::process::exit(1);
    }

    // Provision a capability token in the shared registry. The stdio server
    // validates tool calls against this exact registry (no parallel auth).
    let pool = match crate::db::open_pool_at(&db_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to open database at {}: {e}", db_path.display());
            std::process::exit(1);
        }
    };
    let key_name = format!("personas-mcp ({target})");
    let created = match crate::db::repos::resources::external_api_keys::create(
        &pool,
        &key_name,
        vec![MCP_REQUIRED_SCOPE.to_string()],
        None,
        None,
        Some("MCP stdio server".to_string()),
    ) {
        Ok(resp) => resp,
        Err(e) => {
            eprintln!("Failed to provision MCP token: {e}");
            std::process::exit(1);
        }
    };
    let key_id = created.record.id.clone();

    // Note: this entry used to carry `"transport": "stdio"` — a key no MCP or
    // Agent Plugins schema defines, so every reader ignored it. The typed
    // builder emits the `"type"` discriminator these clients actually read.
    let server_config = personas_core::mcp_config::McpServer::stdio(
        binary_path,
        [
            "--db-path".to_string(),
            db_path.to_string_lossy().into_owned(),
        ],
    )
    .with_env("PERSONAS_MCP_TOKEN", created.plaintext_token)
    .to_json();

    let written =
        merge_server(&mut config, server_config).and_then(|()| write_atomic(&config_path, &config));
    if let Err(e) = written {
        // The token was never delivered anywhere: do not leave it live.
        if let Err(re) = crate::db::repos::resources::external_api_keys::revoke(&pool, &key_id) {
            eprintln!("Warning: could not revoke the unused token {key_id}: {re}");
        }
        eprintln!("{e}");
        std::process::exit(1);
    }

    println!("MCP config installed at: {}", config_path.display());
    println!("Personas MCP server registered as 'personas'");
    println!("DB path: {}", db_path.display());
    println!("Capability token provisioned (scope: {MCP_REQUIRED_SCOPE}) and written to the config env block.");
    println!("\nRestart {target} to activate.");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_code_target_is_the_user_scope_file() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            config_path_for("claude-code", home.path()).unwrap(),
            home.path().join(".claude.json")
        );
        assert_eq!(
            config_path_for("cursor", home.path()).unwrap(),
            home.path().join(".cursor").join("mcp.json")
        );
        assert!(config_path_for("vim", home.path()).is_none());
    }

    #[test]
    fn merge_preserves_unrelated_keys_and_servers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{"numStartups":7,"projects":{"/x":{"mcpServers":{"a":{}}}},"mcpServers":{"other":{"type":"http","url":"u"}}}"#,
        )
        .unwrap();
        let mut cfg = read_config(&path).unwrap();
        merge_server(&mut cfg, json!({"type":"stdio"})).unwrap();
        write_atomic(&path, &cfg).unwrap();
        let back: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(back["numStartups"], 7);
        assert_eq!(back["projects"]["/x"]["mcpServers"]["a"], json!({}));
        assert_eq!(back["mcpServers"]["other"]["url"], "u");
        assert_eq!(back["mcpServers"]["personas"]["type"], "stdio");
        assert!(!dir.path().join(".claude.json.personas-tmp").exists());
    }

    #[test]
    fn unparseable_or_non_object_config_is_refused_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        std::fs::write(&path, r#"{"mcpServers":{"a":{},}}"#).unwrap();
        assert!(read_config(&path).is_err());
        std::fs::write(&path, "[1]").unwrap();
        assert!(read_config(&path).is_err());
        let mut bad = json!({"mcpServers": []});
        assert!(merge_server(&mut bad, json!({})).is_err());
        assert_eq!(bad, json!({"mcpServers": []}));
    }

    #[test]
    fn missing_config_is_an_empty_object() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_config(&dir.path().join("nope.json")).unwrap(),
            json!({})
        );
    }
}
