//! MCP config installation for Claude Code and Cursor.
//!
//! Provisions a `pk_` capability token in the app's `external_api_keys` registry
//! and writes it into the generated `mcp.json` `env` block so the stdio server
//! can authenticate tool calls. The plaintext token is returned exactly once by
//! [`crate::db::repos::resources::external_api_keys::create`] and is written ONLY
//! into the client config — never logged, never persisted elsewhere.

use std::path::PathBuf;

use super::auth::MCP_REQUIRED_SCOPE;

/// Install MCP configuration for the specified target.
pub fn install_mcp_config(target: &str) {
    let config_path = match target {
        "claude-code" => {
            let home = dirs::home_dir().expect("Cannot determine home directory");
            home.join(".claude").join("mcp.json")
        }
        "cursor" => {
            let home = dirs::home_dir().expect("Cannot determine home directory");
            home.join(".cursor").join("mcp.json")
        }
        _ => {
            eprintln!("Unknown target: {target}. Supported: claude-code, cursor");
            std::process::exit(1);
        }
    };

    let binary_path = std::env::current_exe()
        .expect("Cannot determine current executable path")
        .to_string_lossy()
        .to_string();

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
    let token = match crate::db::repos::resources::external_api_keys::create(
        &pool,
        &key_name,
        vec![MCP_REQUIRED_SCOPE.to_string()],
        None,
        None,
        Some("MCP stdio server".to_string()),
    ) {
        Ok(resp) => resp.plaintext_token,
        Err(e) => {
            eprintln!("Failed to provision MCP token: {e}");
            std::process::exit(1);
        }
    };

    let server_config = serde_json::json!({
        "command": binary_path,
        "args": ["--db-path", db_path.to_string_lossy()],
        "env": { "PERSONAS_MCP_TOKEN": token },
        "transport": "stdio"
    });

    // Read existing config or create new
    let mut config: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Add or update the personas-mcp server entry
    let servers = config
        .as_object_mut()
        .expect("Config must be a JSON object")
        .entry("mcpServers")
        .or_insert(serde_json::json!({}));

    servers
        .as_object_mut()
        .expect("mcpServers must be a JSON object")
        .insert("personas".to_string(), server_config);

    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // Write config
    let json = serde_json::to_string_pretty(&config).expect("Failed to serialize config");
    std::fs::write(&config_path, json).expect("Failed to write config file");

    println!("MCP config installed at: {}", config_path.display());
    println!("Personas MCP server registered as 'personas'");
    println!("DB path: {}", db_path.display());
    println!("Capability token provisioned (scope: {MCP_REQUIRED_SCOPE}) and written to the config env block.");
    println!("\nRestart {target} to activate.");
}
