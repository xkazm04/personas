//! MCP config installation for Claude Code and Cursor.

use std::path::PathBuf;

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

    let server_config = serde_json::json!({
        "command": binary_path,
        "args": ["--db-path", db_path.to_string_lossy()],
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
    println!("\nRestart {} to activate.", target);
}
