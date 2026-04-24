//! Claude Code `.claude/settings.json` MCP-server sidecar.
//!
//! Writes an `mcpServers` entry for `personas-mcp` (the stdio MCP binary
//! built alongside the desktop app) into `exec_dir/.claude/settings.json`
//! before the runner spawns the Claude CLI. The CLI picks the entry up,
//! spawns `personas-mcp --db-path <personas.db>` as a child process, and
//! exposes the MCP tools (`drive_write_text`, `drive_read_text`, `drive_list`,
//! plus the existing `personas_*` tools) to the running persona.
//!
//! The sidecar merges with any existing settings.json so the `hooks_sidecar`
//! entries stay intact.

use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Name the CLI will see for this MCP server. Personas tools surface to the
/// LLM as `mcp__personas__<tool_name>`.
const MCP_SERVER_NAME: &str = "personas";

/// Locate the `personas-mcp` binary. Looks next to the current executable
/// first (production layout), then in the cargo target directory under the
/// repo root (dev layout). Returns `None` when neither path resolves to a
/// file — the caller treats a missing binary as "MCP tools unavailable"
/// and skips the sidecar write rather than aborting execution.
fn find_mcp_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let filename = format!("personas-mcp{ext}");

    let candidates = [
        exe_dir.join(&filename),
        // Dev layout: cargo places `personas-mcp` alongside the main binary
        // in `target/<profile>/`. current_exe usually already resolves there,
        // but production bundles drop the binary one level up next to the
        // desktop exe — keep both probes so this works in installed builds
        // too.
        exe_dir.parent().map(|p| p.join(&filename)).unwrap_or_default(),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// Install the MCP servers entry into `exec_dir/.claude/settings.json`.
///
/// Returns `Ok(true)` when the entry was written (or updated), `Ok(false)`
/// when the MCP binary or DB path is unavailable and the sidecar is
/// intentionally skipped. Never errors the execution — a missing MCP just
/// means the persona runs without the drive tools, which is the status
/// quo anyway.
pub fn install_mcp_sidecar(
    exec_dir: &Path,
    drive_root: Option<&Path>,
) -> Result<bool, AppError> {
    let Some(mcp_binary) = find_mcp_binary() else {
        tracing::debug!("cli_mcp_config: personas-mcp binary not found — skipping sidecar");
        return Ok(false);
    };
    let Some(db_path) = crate::db::primary_db_path() else {
        tracing::debug!("cli_mcp_config: db not initialised — skipping sidecar");
        return Ok(false);
    };

    let claude_dir = exec_dir.join(".claude");
    if let Err(e) = std::fs::create_dir_all(&claude_dir) {
        tracing::warn!(
            error = %e,
            dir = %claude_dir.display(),
            "cli_mcp_config: failed to create .claude/ — skipping sidecar"
        );
        return Ok(false);
    }
    let settings_path = claude_dir.join("settings.json");

    // Preserve existing settings (hooks_sidecar may have written hooks).
    let mut existing: serde_json::Value = if settings_path.exists() {
        std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !existing.is_object() {
        existing = serde_json::json!({});
    }

    // Build the server entry. PERSONAS_DRIVE_ROOT is passed through env so the
    // child MCP process resolves the same sandbox as the parent runner.
    let mut env_map = serde_json::Map::new();
    if let Some(root) = drive_root {
        env_map.insert(
            "PERSONAS_DRIVE_ROOT".to_string(),
            serde_json::Value::String(root.display().to_string()),
        );
    }

    let server_entry = serde_json::json!({
        "command": mcp_binary.display().to_string(),
        "args": ["--db-path", db_path.display().to_string()],
        "env": serde_json::Value::Object(env_map),
    });

    // Merge (or create) `mcpServers.personas`.
    let root_obj = existing.as_object_mut().expect("existing was just set to object");
    let servers = root_obj
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    servers
        .as_object_mut()
        .expect("mcpServers was just set to object")
        .insert(MCP_SERVER_NAME.to_string(), server_entry);

    let serialized = serde_json::to_string_pretty(&existing)
        .map_err(|e| AppError::Internal(format!("serialize MCP sidecar settings: {e}")))?;
    if let Err(e) = std::fs::write(&settings_path, serialized) {
        tracing::warn!(
            error = %e,
            path = %settings_path.display(),
            "cli_mcp_config: failed to write settings.json — skipping sidecar"
        );
        return Ok(false);
    }
    tracing::debug!(
        path = %settings_path.display(),
        "cli_mcp_config: wrote mcpServers entry for '{}'",
        MCP_SERVER_NAME
    );
    Ok(true)
}
