use crate::error::AppError;

/// Path to the Personas MCP server script relative to the app resources.
pub fn resolve_mcp_server_path() -> Option<std::path::PathBuf> {
    // Try relative to the binary (for dev and production)
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // Dev: the script is at project_root/scripts/mcp-server/index.mjs
    // Walk up from src-tauri/target/debug to project root
    for ancestor in exe_dir.ancestors() {
        let candidate = ancestor.join("scripts").join("mcp-server").join("index.mjs");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Get Claude Desktop config path for the current platform.
fn claude_desktop_config_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Some(std::path::PathBuf::from(appdata).join("Claude").join("claude_desktop_config.json"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(std::path::PathBuf::from(home)
                .join("Library/Application Support/Claude/claude_desktop_config.json"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(config) = std::env::var("XDG_CONFIG_HOME") {
            return Some(std::path::PathBuf::from(config).join("claude").join("claude_desktop_config.json"));
        }
        if let Ok(home) = std::env::var("HOME") {
            return Some(std::path::PathBuf::from(home).join(".config/claude/claude_desktop_config.json"));
        }
    }
    None
}

/// Check if the Personas MCP server is registered in Claude Desktop config.
pub(crate) fn is_personas_mcp_registered() -> bool {
    let config_path = match claude_desktop_config_path() {
        Some(p) if p.exists() => p,
        _ => return false,
    };
    let content = std::fs::read_to_string(&config_path).unwrap_or_default();
    let config: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    config.get("mcpServers")
        .and_then(|s| s.get("personas"))
        .is_some()
}

#[tauri::command]
pub fn register_claude_desktop_mcp() -> Result<String, AppError> {
    let mcp_server_path = resolve_mcp_server_path()
        .ok_or_else(|| AppError::NotFound("Personas MCP server script not found".into()))?;

    let config_path = claude_desktop_config_path()
        .ok_or_else(|| AppError::NotFound("Claude Desktop config path not found".into()))?;

    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Internal(format!("Failed to create config directory: {e}")))?;
    }

    // Read existing config or start fresh
    let mut config: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| AppError::Internal(format!("Failed to read Claude Desktop config: {e}")))?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Add mcpServers.personas entry
    let server_path_str = mcp_server_path.to_string_lossy().to_string();
    let servers = config.as_object_mut()
        .ok_or_else(|| AppError::Internal("Invalid config format".into()))?
        .entry("mcpServers")
        .or_insert(serde_json::json!({}));

    if let Some(obj) = servers.as_object_mut() {
        obj.insert("personas".into(), serde_json::json!({
            "command": "node",
            "args": [server_path_str]
        }));
    }

    // Write via temp file + rename for atomicity
    let output = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError::Internal(format!("Failed to serialize config: {e}")))?;
    let tmp_path = config_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &output)
        .map_err(|e| AppError::Internal(format!("Failed to write temp config: {e}")))?;
    std::fs::rename(&tmp_path, &config_path)
        .map_err(|e| AppError::Internal(format!("Failed to rename temp config: {e}")))?;

    tracing::info!(config = %config_path.display(), "Registered Personas MCP server in Claude Desktop");
    Ok(format!("Registered. Restart Claude Desktop to activate."))
}

#[tauri::command]
pub fn unregister_claude_desktop_mcp() -> Result<String, AppError> {
    let config_path = claude_desktop_config_path()
        .ok_or_else(|| AppError::NotFound("Claude Desktop config path not found".into()))?;

    if !config_path.exists() {
        return Ok("No Claude Desktop config found".into());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| AppError::Internal(format!("Failed to read config: {e}")))?;
    let mut config: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.remove("personas");
    }

    let output = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError::Internal(format!("Failed to serialize config: {e}")))?;
    let tmp_path = config_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &output)
        .map_err(|e| AppError::Internal(format!("Failed to write temp config: {e}")))?;
    std::fs::rename(&tmp_path, &config_path)
        .map_err(|e| AppError::Internal(format!("Failed to rename temp config: {e}")))?;

    tracing::info!("Unregistered Personas MCP server from Claude Desktop");
    Ok("Unregistered. Restart Claude Desktop to apply.".into())
}

#[tauri::command]
pub fn check_claude_desktop_mcp() -> Result<bool, AppError> {
    Ok(is_personas_mcp_registered())
}
