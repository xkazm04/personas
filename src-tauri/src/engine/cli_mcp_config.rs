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
    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let filename = format!("personas-mcp{ext}");

    let candidates = [
        exe_dir.join(&filename),
        // Dev layout: cargo places `personas-mcp` alongside the main binary
        // in `target/<profile>/`. current_exe usually already resolves there,
        // but production bundles drop the binary one level up next to the
        // desktop exe — keep both probes so this works in installed builds
        // too.
        exe_dir
            .parent()
            .map(|p| p.join(&filename))
            .unwrap_or_default(),
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
///
/// When `project_root` is `Some`, also reads
/// `<project_root>/.claude/settings.json` and merges its `mcpServers.*`
/// entries into the exec_dir settings. This surfaces any project-local MCP
/// servers the user has registered (e.g. via `npx gitnexus setup` for
/// codebase-aware tools, or by hand for project-specific helpers) without
/// requiring the user to configure each one through the credential-managed
/// `mcp_gateways` flow. Personas-MCP always wins on name conflict so the
/// drive/personas_* tools are never shadowed. Missing file, unreadable file,
/// or invalid JSON is silently ignored — best-effort, never fails the run.
pub fn install_mcp_sidecar(
    exec_dir: &Path,
    drive_root: Option<&Path>,
    project_root: Option<&Path>,
    api_key: Option<&str>,
    dev_project_id: Option<&str>,
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
    // Connector bridge: lets the sidecar's vault-connector tools (e.g.
    // gmail_list_messages) call the desktop app's credential proxy on :9420,
    // which resolves the OAuth token. The sidecar holds no secrets — it only
    // forwards with this short-lived system API key. Omitted if we couldn't
    // mint a key (the tools then return a clear "bridge unavailable" message).
    if let Some(key) = api_key {
        env_map.insert(
            "PERSONAS_BRIDGE_URL".to_string(),
            serde_json::Value::String("http://127.0.0.1:9420".to_string()),
        );
        env_map.insert(
            "PERSONAS_API_KEY".to_string(),
            serde_json::Value::String(key.to_string()),
        );
    }
    // Codebase pin: the executing persona's `design_context.dev_project_id`.
    // The sidecar's `resolve_context_project` reads this env first so a persona
    // adopted for repo X always queries repo X's dev_project, regardless of the
    // global first-project default. Omitted for unpinned personas (they fall
    // back to the global probe). Mirrors the twin connector's per-persona pin.
    if let Some(pid) = dev_project_id {
        if !pid.is_empty() {
            env_map.insert(
                "PERSONAS_DEV_PROJECT_ID".to_string(),
                serde_json::Value::String(pid.to_string()),
            );
        }
    }

    // `alwaysLoad: true` skips the CLI's tool-search deferral so personas-mcp
    // tools (`drive_*`, `personas_*`) are deterministically discoverable on
    // every spawn. Field added in CLI 2.1.121; older CLIs ignore unknown
    // server-config fields per the MCP schema, so this is safe across versions.
    let server_entry = serde_json::json!({
        "command": mcp_binary.display().to_string(),
        "args": ["--db-path", db_path.display().to_string()],
        "env": serde_json::Value::Object(env_map),
        "alwaysLoad": true,
    });

    // Merge (or create) `mcpServers.personas`.
    let root_obj = existing
        .as_object_mut()
        .expect("existing was just set to object");
    let servers = root_obj
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    let servers_map = servers
        .as_object_mut()
        .expect("mcpServers was just set to object");

    // Merge project-local MCP servers BEFORE inserting personas-mcp, so the
    // personas entry overwrites any project-local entry under the same name.
    if let Some(root) = project_root {
        merge_project_local_mcp_servers(root, servers_map);
    }

    servers_map.insert(MCP_SERVER_NAME.to_string(), server_entry);

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

/// Read `<project_root>/.claude/settings.json` and copy any `mcpServers.*`
/// entries into `target`. Best-effort: missing file, unreadable file,
/// non-JSON, or non-object payloads silently skip — the function is meant to
/// surface project-local servers when they're already there, never to
/// validate the project's settings.
fn merge_project_local_mcp_servers(
    project_root: &Path,
    target: &mut serde_json::Map<String, serde_json::Value>,
) {
    let project_settings = project_root.join(".claude").join("settings.json");
    let Ok(text) = std::fs::read_to_string(&project_settings) else {
        return;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
        tracing::debug!(
            path = %project_settings.display(),
            "cli_mcp_config: project-local settings.json is not valid JSON — skipping merge"
        );
        return;
    };
    let Some(servers) = parsed.get("mcpServers").and_then(|v| v.as_object()) else {
        return;
    };
    for (name, entry) in servers {
        if name == MCP_SERVER_NAME {
            // Personas-MCP is added by the caller below this point and must
            // never be shadowed by a project-local entry of the same name.
            continue;
        }
        target.insert(name.clone(), entry.clone());
    }
    tracing::debug!(
        path = %project_settings.display(),
        count = servers.len(),
        "cli_mcp_config: merged project-local mcpServers entries"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_servers_map() -> serde_json::Map<String, serde_json::Value> {
        serde_json::Map::new()
    }

    #[test]
    fn merge_skips_when_project_settings_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut target = make_servers_map();
        merge_project_local_mcp_servers(dir.path(), &mut target);
        assert!(target.is_empty(), "expected no merge when settings.json missing");
    }

    #[test]
    fn merge_skips_when_settings_json_is_invalid() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join(".claude").join("settings.json"), "{ not json").unwrap();
        let mut target = make_servers_map();
        merge_project_local_mcp_servers(dir.path(), &mut target);
        assert!(target.is_empty(), "invalid JSON must be a no-op merge");
    }

    #[test]
    fn merge_skips_when_mcp_servers_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(
            dir.path().join(".claude").join("settings.json"),
            json!({ "hooks": {} }).to_string(),
        )
        .unwrap();
        let mut target = make_servers_map();
        merge_project_local_mcp_servers(dir.path(), &mut target);
        assert!(target.is_empty(), "settings without mcpServers is a no-op");
    }

    #[test]
    fn merge_imports_project_local_entries() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        let project_settings = json!({
            "mcpServers": {
                "gitnexus": { "command": "npx", "args": ["gitnexus", "mcp"] },
                "custom-tool": { "command": "/usr/local/bin/my-tool" }
            }
        });
        std::fs::write(
            dir.path().join(".claude").join("settings.json"),
            project_settings.to_string(),
        )
        .unwrap();

        let mut target = make_servers_map();
        merge_project_local_mcp_servers(dir.path(), &mut target);

        assert_eq!(target.len(), 2);
        assert_eq!(
            target.get("gitnexus").and_then(|v| v.get("command")).and_then(|v| v.as_str()),
            Some("npx")
        );
        assert!(target.contains_key("custom-tool"));
    }

    #[test]
    fn merge_skips_personas_entry_to_avoid_shadowing() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        // A misconfigured project that tries to register its own "personas"
        // server must NOT shadow our outbound stdio binary — the caller
        // inserts the canonical entry after this merge, but defense in depth
        // here keeps the invariant local to the helper.
        let project_settings = json!({
            "mcpServers": {
                MCP_SERVER_NAME: { "command": "/evil/path" },
                "harmless": { "command": "echo" }
            }
        });
        std::fs::write(
            dir.path().join(".claude").join("settings.json"),
            project_settings.to_string(),
        )
        .unwrap();

        let mut target = make_servers_map();
        merge_project_local_mcp_servers(dir.path(), &mut target);

        assert!(
            !target.contains_key(MCP_SERVER_NAME),
            "merge must skip the reserved personas server name"
        );
        assert!(target.contains_key("harmless"));
    }
}

