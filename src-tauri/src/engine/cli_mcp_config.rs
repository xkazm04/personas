//! Claude Code `personas-mcp` sidecar config (`--mcp-config` file).
//!
//! Writes an `mcpServers` entry for `personas-mcp` (the stdio MCP binary
//! built alongside the desktop app) into `exec_dir/.claude/personas-mcp-config.json`
//! before the runner spawns the Claude CLI. The runner passes this file to
//! `claude -p` via `--mcp-config <file>`; the CLI spawns
//! `personas-mcp --db-path <personas.db>` as a child process and exposes the
//! MCP tools (`drive_write_text`, `drive_read_text`, `drive_list`, plus the
//! existing `personas_*` tools) to the running persona.
//!
//! Secret hygiene: this config file embeds short-lived secrets for the run —
//! the `PERSONAS_API_KEY` bridge key and any delegate API key — in plaintext.
//! The default `exec_dir` is a *stable, reused* per-persona temp dir that the
//! runner never deletes, so the file MUST be scrubbed at run termination via
//! [`scrub_mcp_sidecar`] on every exit path (normal, error, cancel, timeout,
//! kill). [`install_mcp_sidecar`] also sweeps a stale config from a prior,
//! possibly app-killed run before writing, as belt-and-suspenders.
//!
//! Historical note: earlier versions also wrote `mcpServers.personas` into
//! `exec_dir/.claude/settings.json`. Claude Code ignores `mcpServers` in
//! `settings.json` (only `--mcp-config` / `.mcp.json` are honored), so that
//! write was dead — a second plaintext copy of the same secrets for no
//! behavioral gain. It has been removed; the sidecar now writes ONLY the
//! `--mcp-config` file, and `settings.json` is left untouched so any
//! `hooks_sidecar` entries stay intact.

use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Name the CLI will see for this MCP server. Personas tools surface to the
/// LLM as `mcp__personas__<tool_name>`.
const MCP_SERVER_NAME: &str = "personas";

/// Path to the standalone `--mcp-config` file the runner passes to `claude -p`.
/// (Claude Code ignores `mcpServers` in `.claude/settings.json`; the headless run
/// must be given the MCP config explicitly via `--mcp-config <file>`.)
pub fn mcp_config_path(exec_dir: &Path) -> PathBuf {
    exec_dir.join(".claude").join("personas-mcp-config.json")
}

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

/// Install the `personas-mcp` entry into the `--mcp-config` file
/// (`exec_dir/.claude/personas-mcp-config.json`).
///
/// Returns `Ok(true)` when the entry was written, `Ok(false)` when the MCP
/// binary or DB path is unavailable and the sidecar is intentionally skipped.
/// Never errors the execution — a missing MCP just means the persona runs
/// without the drive tools, which is the status quo anyway.
///
/// When `project_root` is `Some`, also reads
/// `<project_root>/.claude/settings.json` and merges its `mcpServers.*`
/// entries into the `--mcp-config` file. This surfaces any project-local MCP
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
    delegate: Option<(&str, &str, Option<&str>)>,
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

    // Belt-and-suspenders hygiene: the default exec_dir is a stable, reused
    // per-persona dir. If a previous run's teardown scrub never fired (e.g. the
    // whole desktop app was force-killed mid-run), a stale secret-bearing config
    // could linger here. Sweep it before writing the fresh one for this run.
    scrub_mcp_sidecar(exec_dir);

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

    // Mixed-engine delegate (docs/plans/mixed-engine-byom.md): arms the
    // sidecar's `llm_delegate` tool with the local model endpoint. Only
    // written for capabilities that opted in (engine_mode == "mixed") — the
    // sidecar advertises the tool only when these vars are present.
    if let Some((base_url, model, delegate_api_key)) = delegate {
        env_map.insert(
            "PERSONAS_DELEGATE_BASE_URL".to_string(),
            serde_json::Value::String(base_url.to_string()),
        );
        env_map.insert(
            "PERSONAS_DELEGATE_MODEL".to_string(),
            serde_json::Value::String(model.to_string()),
        );
        env_map.insert(
            "PERSONAS_DELEGATE_AUDIT".to_string(),
            serde_json::Value::String(
                exec_dir.join(".claude").join("delegate-audit.jsonl").display().to_string(),
            ),
        );
        // Hosted delegate backends (Ollama Cloud) need a Bearer token. Only
        // written when configured; local Ollama leaves it unset.
        if let Some(key) = delegate_api_key.filter(|k| !k.trim().is_empty()) {
            env_map.insert(
                "PERSONAS_DELEGATE_API_KEY".to_string(),
                serde_json::Value::String(key.to_string()),
            );
        }
    }

    // `alwaysLoad: true` skips the CLI's tool-search deferral so personas-mcp
    // tools (`drive_*`, `personas_*`) are deterministically discoverable on
    // every spawn. Field added in CLI 2.1.121; older CLIs ignore unknown
    // server-config fields per the MCP schema, so this is safe across versions.
    let server_entry = serde_json::json!({
        "type": "stdio",
        "command": mcp_binary.display().to_string(),
        "args": ["--db-path", db_path.display().to_string()],
        "env": serde_json::Value::Object(env_map),
        "alwaysLoad": true,
    });

    // CRITICAL: Claude Code does NOT load `mcpServers` from `.claude/settings.json`
    // (that key is ignored there). For a headless `claude -p` run, MCP servers must
    // come from `.mcp.json` (needs approval) or, deterministically, from a config
    // file passed via `--mcp-config <file>`. This `--mcp-config` file is the ONLY
    // MCP config the sidecar writes; the runner appends
    // `--mcp-config <mcp_config_path(exec_dir)>` to the spawn so personas-mcp tools
    // (drive_*, personas_*, obsidian_vault_*) actually load.
    let mut servers_obj = serde_json::Map::new();

    // Merge project-local MCP servers BEFORE inserting personas-mcp, so the
    // personas entry overwrites any project-local entry under the same name.
    // These land in the `--mcp-config` file (the one the CLI actually reads),
    // not the ignored settings.json.
    if let Some(root) = project_root {
        merge_project_local_mcp_servers(root, &mut servers_obj);
    }

    servers_obj.insert(MCP_SERVER_NAME.to_string(), server_entry);

    let mcp_config = serde_json::json!({ "mcpServers": serde_json::Value::Object(servers_obj) });
    let mcp_config_file = mcp_config_path(exec_dir);
    let serialized = serde_json::to_string_pretty(&mcp_config)
        .map_err(|e| AppError::Internal(format!("serialize MCP sidecar config: {e}")))?;
    if let Err(e) = std::fs::write(&mcp_config_file, serialized) {
        tracing::warn!(error = %e, path = %mcp_config_file.display(), "cli_mcp_config: failed to write --mcp-config file — skipping sidecar");
        return Ok(false);
    }
    tracing::debug!(
        path = %mcp_config_file.display(),
        "cli_mcp_config: wrote --mcp-config entry for '{}'",
        MCP_SERVER_NAME
    );
    Ok(true)
}

/// Scrub the run's `personas-mcp` sidecar config from `exec_dir`.
///
/// Deletes `exec_dir/.claude/personas-mcp-config.json`, which embeds the run's
/// plaintext `PERSONAS_API_KEY` bridge key and any delegate API key. The runner
/// calls this on every execution exit path (normal, error, cancel, timeout,
/// kill) so secrets don't sit in the reused per-persona temp dir between runs.
///
/// Also strips a stale `mcpServers.personas` entry from any pre-existing
/// `settings.json` (written by older builds that dual-wrote the config there).
/// Never fails: a missing file or unwritable dir is a no-op — this is
/// best-effort hygiene, never a gate on execution teardown. Never logs key
/// values.
pub fn scrub_mcp_sidecar(exec_dir: &Path) {
    let config_file = mcp_config_path(exec_dir);
    match std::fs::remove_file(&config_file) {
        Ok(()) => tracing::debug!(
            path = %config_file.display(),
            "cli_mcp_config: scrubbed --mcp-config file at teardown"
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!(
            error = %e,
            path = %config_file.display(),
            "cli_mcp_config: failed to scrub --mcp-config file"
        ),
    }

    // Legacy cleanup: older builds wrote a second plaintext secret copy into
    // settings.json under mcpServers.personas. If such a file exists, drop just
    // that key (preserving hooks and anything else) so no stale secret lingers.
    let settings_path = exec_dir.join(".claude").join("settings.json");
    let Ok(text) = std::fs::read_to_string(&settings_path) else {
        return;
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let removed = value
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
        .map(|m| m.remove(MCP_SERVER_NAME).is_some())
        .unwrap_or(false);
    if removed {
        if let Ok(serialized) = serde_json::to_string_pretty(&value) {
            let _ = std::fs::write(&settings_path, serialized);
            tracing::debug!(
                path = %settings_path.display(),
                "cli_mcp_config: stripped legacy mcpServers.personas from settings.json"
            );
        }
    }
}

/// RAII guard that scrubs the run's `personas-mcp` sidecar config on drop.
///
/// The runner holds one of these for the duration of an execution. Because it
/// scrubs in `Drop`, secrets are cleaned up on EVERY exit path the runner can
/// take — normal completion, error early-returns, cancel, timeout, and a
/// panic-unwind — without threading a scrub call through each site. The default
/// `exec_dir` is a reused per-persona temp dir that is never deleted, so this is
/// what actually keeps the plaintext bridge/delegate keys from lingering between
/// runs. Idempotent with any explicit [`scrub_mcp_sidecar`] call (e.g. the
/// pre-worktree-commit scrub); a second scrub of an already-gone file is a no-op.
pub struct SidecarScrubGuard {
    exec_dir: PathBuf,
}

impl SidecarScrubGuard {
    pub fn new(exec_dir: PathBuf) -> Self {
        SidecarScrubGuard { exec_dir }
    }
}

impl Drop for SidecarScrubGuard {
    fn drop(&mut self) {
        scrub_mcp_sidecar(&self.exec_dir);
    }
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

    #[test]
    fn scrub_removes_the_mcp_config_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exec_dir = dir.path();
        std::fs::create_dir_all(exec_dir.join(".claude")).unwrap();
        let config = mcp_config_path(exec_dir);
        std::fs::write(&config, r#"{"mcpServers":{"personas":{"env":{"PERSONAS_API_KEY":"sekret"}}}}"#)
            .unwrap();
        assert!(config.exists(), "precondition: config file present");

        scrub_mcp_sidecar(exec_dir);

        assert!(!config.exists(), "scrub must delete the --mcp-config file");
    }

    #[test]
    fn scrub_is_a_noop_when_config_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        // No .claude/, no config file — scrub must not panic or error.
        scrub_mcp_sidecar(dir.path());
    }

    #[test]
    fn scrub_strips_legacy_personas_entry_from_settings_json() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exec_dir = dir.path();
        std::fs::create_dir_all(exec_dir.join(".claude")).unwrap();
        let settings_path = exec_dir.join(".claude").join("settings.json");
        std::fs::write(
            &settings_path,
            json!({
                "hooks": { "keep": "me" },
                "mcpServers": {
                    MCP_SERVER_NAME: { "env": { "PERSONAS_API_KEY": "sekret" } },
                    "other": { "command": "keep" }
                }
            })
            .to_string(),
        )
        .unwrap();

        scrub_mcp_sidecar(exec_dir);

        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
        // personas stripped, everything else preserved.
        assert!(after
            .get("mcpServers")
            .and_then(|m| m.as_object())
            .map(|m| !m.contains_key(MCP_SERVER_NAME) && m.contains_key("other"))
            .unwrap_or(false));
        assert_eq!(
            after.get("hooks").and_then(|h| h.get("keep")).and_then(|v| v.as_str()),
            Some("me")
        );
    }
}

