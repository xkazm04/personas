//! Native desktop application bridges (Phase 3).
//!
//! Each bridge provides typed actions for a specific desktop app, executed
//! via the app's CLI, local API, or file system. All actions are gated by
//! the desktop_security capability approval system.
//!
//! Bridges are invoked by the local agent runtime or directly via Tauri commands.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Result of a desktop bridge action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeActionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub bridge: String,
    pub action: String,
}

// ========================================================================
// VS Code Bridge
// ========================================================================

pub mod vscode {
    use super::*;

    /// Actions available via the VS Code CLI.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "action", content = "params")]
    pub enum VsCodeAction {
        /// Open a file at an optional line number.
        OpenFile { path: String, line: Option<u32> },
        /// Open a folder/workspace.
        OpenFolder { path: String },
        /// Open a diff between two files.
        DiffFiles { left: String, right: String },
        /// List installed extensions.
        ListExtensions,
        /// Install an extension by ID.
        InstallExtension { extension_id: String },
        /// Run a task from tasks.json.
        RunTask { task_name: String, folder: Option<String> },
        /// Get the VS Code version.
        Version,
    }

    pub async fn execute(
        binary: &str,
        action: VsCodeAction,
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = format!("{:?}", &action).split_whitespace().next().unwrap_or("unknown").to_string();

        let result = match action {
            VsCodeAction::OpenFile { path, line } => {
                let goto = match line {
                    Some(l) => format!("{path}:{l}"),
                    None => path,
                };
                run_cli(binary, &["--goto", &goto]).await
            }
            VsCodeAction::OpenFolder { path } => {
                run_cli(binary, &[&path]).await
            }
            VsCodeAction::DiffFiles { left, right } => {
                run_cli(binary, &["--diff", &left, &right]).await
            }
            VsCodeAction::ListExtensions => {
                run_cli(binary, &["--list-extensions", "--show-versions"]).await
            }
            VsCodeAction::InstallExtension { extension_id } => {
                run_cli(binary, &["--install-extension", &extension_id]).await
            }
            VsCodeAction::RunTask { task_name, folder } => {
                // VS Code doesn't have a direct CLI for tasks, use --folder-uri approach
                let mut args = vec!["--command".to_string(), format!("workbench.action.tasks.runTask:{task_name}")];
                if let Some(f) = folder {
                    args.insert(0, f);
                }
                let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                run_cli(binary, &arg_refs).await
            }
            VsCodeAction::Version => {
                run_cli(binary, &["--version"]).await
            }
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        match result {
            Ok(output) => Ok(BridgeActionResult {
                success: true,
                output,
                error: None,
                duration_ms,
                bridge: "vscode".into(),
                action: action_name,
            }),
            Err(e) => Ok(BridgeActionResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                bridge: "vscode".into(),
                action: action_name,
            }),
        }
    }
}

// ========================================================================
// Docker Bridge
// ========================================================================

pub mod docker {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "action", content = "params")]
    pub enum DockerAction {
        /// List running containers.
        ListContainers { all: bool },
        /// List images.
        ListImages,
        /// Start a container by name/ID.
        StartContainer { container: String },
        /// Stop a container by name/ID.
        StopContainer { container: String },
        /// Restart a container.
        RestartContainer { container: String },
        /// Get container logs (last N lines).
        ContainerLogs { container: String, tail: Option<u32> },
        /// Inspect a container (JSON output).
        InspectContainer { container: String },
        /// Run a command in a running container.
        Exec { container: String, command: Vec<String> },
        /// Docker compose up.
        ComposeUp { file: Option<String>, detach: bool },
        /// Docker compose down.
        ComposeDown { file: Option<String> },
        /// Docker compose ps.
        ComposePs { file: Option<String> },
        /// Docker system info.
        SystemInfo,
        /// Docker version.
        Version,
    }

    pub async fn execute(
        binary: &str,
        action: DockerAction,
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = format!("{:?}", &action).split_whitespace().next().unwrap_or("unknown").to_string();

        let result = match action {
            DockerAction::ListContainers { all } => {
                let mut args = vec!["ps", "--format", "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"];
                if all { args.push("-a"); }
                run_cli(binary, &args).await
            }
            DockerAction::ListImages => {
                run_cli(binary, &["images", "--format", "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"]).await
            }
            DockerAction::StartContainer { container } => {
                run_cli(binary, &["start", &container]).await
            }
            DockerAction::StopContainer { container } => {
                run_cli(binary, &["stop", &container]).await
            }
            DockerAction::RestartContainer { container } => {
                run_cli(binary, &["restart", &container]).await
            }
            DockerAction::ContainerLogs { container, tail } => {
                let tail_str = tail.unwrap_or(100).to_string();
                run_cli(binary, &["logs", "--tail", &tail_str, &container]).await
            }
            DockerAction::InspectContainer { container } => {
                run_cli(binary, &["inspect", &container]).await
            }
            DockerAction::Exec { container, command } => {
                if command.is_empty() {
                    return Err(AppError::Validation("Docker exec requires at least one command argument".into()));
                }
                // Security: validate command doesn't contain shell metacharacters
                for arg in &command {
                    if arg.contains(';') || arg.contains('|') || arg.contains('&') || arg.contains('`') {
                        return Err(AppError::Validation(
                            "Docker exec arguments cannot contain shell metacharacters (;|&`)".into()
                        ));
                    }
                }
                let mut args = vec!["exec", &container];
                let cmd_refs: Vec<&str> = command.iter().map(|s| s.as_str()).collect();
                args.extend(&cmd_refs);
                run_cli(binary, &args).await
            }
            DockerAction::ComposeUp { file, detach } => {
                let mut args = vec!["compose"];
                let file_owned;
                if let Some(ref f) = file {
                    file_owned = f.clone();
                    args.extend(&["-f", &file_owned]);
                }
                args.push("up");
                if detach { args.push("-d"); }
                run_cli(binary, &args).await
            }
            DockerAction::ComposeDown { file } => {
                let mut args = vec!["compose"];
                let file_owned;
                if let Some(ref f) = file {
                    file_owned = f.clone();
                    args.extend(&["-f", &file_owned]);
                }
                args.push("down");
                run_cli(binary, &args).await
            }
            DockerAction::ComposePs { file } => {
                let mut args = vec!["compose"];
                let file_owned;
                if let Some(ref f) = file {
                    file_owned = f.clone();
                    args.extend(&["-f", &file_owned]);
                }
                args.push("ps");
                run_cli(binary, &args).await
            }
            DockerAction::SystemInfo => {
                run_cli(binary, &["system", "info", "--format", "json"]).await
            }
            DockerAction::Version => {
                run_cli(binary, &["version", "--format", "json"]).await
            }
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        match result {
            Ok(output) => Ok(BridgeActionResult {
                success: true,
                output,
                error: None,
                duration_ms,
                bridge: "docker".into(),
                action: action_name,
            }),
            Err(e) => Ok(BridgeActionResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                bridge: "docker".into(),
                action: action_name,
            }),
        }
    }
}

// ========================================================================
// Terminal Bridge
// ========================================================================

pub mod terminal {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "action", content = "params")]
    pub enum TerminalAction {
        /// Execute a shell command (string split into args, NO shell involved).
        Execute { command: Vec<String>, working_dir: Option<String> },
        /// Read a file's contents.
        ReadFile { path: String },
        /// Write content to a file.
        WriteFile { path: String, content: String },
        /// List directory contents.
        ListDir { path: String },
        /// Check if a path exists.
        PathExists { path: String },
    }

    /// Blocked commands that should never be executed via the terminal bridge.
    const BLOCKED_COMMANDS: &[&str] = &[
        "rm", "rmdir", "del", "format", "mkfs",
        "dd", "shred", "wipefs",
        "shutdown", "reboot", "halt", "poweroff",
        "passwd", "useradd", "userdel", "usermod",
        "chmod", "chown", "chgrp",
        "mount", "umount",
        "iptables", "firewall-cmd", "ufw",
        "curl", "wget",  // use API proxy instead
        "ssh", "scp", "sftp",
        "sudo", "su", "doas", "runas",
        "reg", "regedit",
        "net", "sc", "wmic",
    ];

    pub async fn execute(
        _shell: &str,
        action: TerminalAction,
        env_vars: &HashMap<String, String>,
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = format!("{:?}", &action).split_whitespace().next().unwrap_or("unknown").to_string();

        let result = match action {
            TerminalAction::Execute { command, working_dir } => {
                if command.is_empty() {
                    return Err(AppError::Validation("Command cannot be empty".into()));
                }

                // Check against blocked commands
                let base_cmd = command[0].rsplit('/').next().unwrap_or(&command[0]);
                let base_cmd = base_cmd.rsplit('\\').next().unwrap_or(base_cmd);
                let base_cmd_lower = base_cmd.to_lowercase();
                let base_cmd_no_ext = base_cmd_lower.strip_suffix(".exe").unwrap_or(&base_cmd_lower);

                if BLOCKED_COMMANDS.contains(&base_cmd_no_ext) {
                    return Err(AppError::Forbidden(format!(
                        "Command '{}' is blocked for security. Use the appropriate connector instead.",
                        base_cmd
                    )));
                }

                // Validate no shell metacharacters in any argument
                for arg in &command {
                    if arg.contains('|') || arg.contains(';') || arg.contains('`')
                        || arg.contains("$(") || arg.contains("${")
                    {
                        return Err(AppError::Validation(
                            "Shell metacharacters (|;`$()) are not allowed. Pass individual arguments instead.".into()
                        ));
                    }
                }

                let mut cmd = tokio::process::Command::new(&command[0]);
                if command.len() > 1 {
                    cmd.args(&command[1..]);
                }
                if let Some(ref wd) = working_dir {
                    cmd.current_dir(wd);
                }
                for (k, v) in env_vars {
                    cmd.env(k, v);
                }

                #[cfg(target_os = "windows")]
                {
                    #[allow(unused_imports)]
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000);
                }

                let output = tokio::time::timeout(
                    std::time::Duration::from_secs(30),
                    cmd.output(),
                )
                .await
                .map_err(|_| AppError::Execution("Command timed out after 30 seconds".into()))?
                .map_err(|e| AppError::ProcessSpawn(format!("Failed to execute command: {e}")))?;

                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                if output.status.success() {
                    Ok(stdout.to_string())
                } else {
                    Err(AppError::Execution(format!(
                        "Command exited with {}: {}{}",
                        output.status,
                        stderr.chars().take(2000).collect::<String>(),
                        if stderr.len() > 2000 { "...[truncated]" } else { "" }
                    )))
                }
            }

            TerminalAction::ReadFile { path } => {
                // Validate path doesn't escape
                validate_path_safety(&path)?;
                match tokio::fs::read_to_string(&path).await {
                    Ok(content) => {
                        // Cap at 1MB for safety
                        if content.len() > 1_048_576 {
                            Ok(format!("{}...\n[truncated at 1MB, total {} bytes]",
                                &content[..1_048_576], content.len()))
                        } else {
                            Ok(content)
                        }
                    }
                    Err(e) => Err(AppError::Io(e)),
                }
            }

            TerminalAction::WriteFile { path, content } => {
                validate_path_safety(&path)?;
                if content.len() > 10_485_760 {
                    return Err(AppError::Validation("File content exceeds 10MB limit".into()));
                }
                tokio::fs::write(&path, &content).await.map_err(AppError::Io)?;
                Ok(format!("Written {} bytes to {}", content.len(), path))
            }

            TerminalAction::ListDir { path } => {
                validate_path_safety(&path)?;
                let mut entries = tokio::fs::read_dir(&path).await.map_err(AppError::Io)?;
                let mut listing = Vec::new();
                while let Some(entry) = entries.next_entry().await.map_err(AppError::Io)? {
                    let meta = entry.metadata().await.ok();
                    let kind = meta.as_ref().map(|m| {
                        if m.is_dir() { "dir" } else { "file" }
                    }).unwrap_or("?");
                    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    listing.push(format!("{}\t{}\t{}", kind, size, entry.file_name().to_string_lossy()));
                }
                Ok(listing.join("\n"))
            }

            TerminalAction::PathExists { path } => {
                validate_path_safety(&path)?;
                let exists = tokio::fs::metadata(&path).await.is_ok();
                Ok(exists.to_string())
            }
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        match result {
            Ok(output) => Ok(BridgeActionResult {
                success: true,
                output,
                error: None,
                duration_ms,
                bridge: "terminal".into(),
                action: action_name,
            }),
            Err(e) => Ok(BridgeActionResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                bridge: "terminal".into(),
                action: action_name,
            }),
        }
    }

    /// Reject paths that attempt directory traversal or access system directories.
    fn validate_path_safety(path: &str) -> Result<(), AppError> {
        let normalized = path.replace('\\', "/");

        // Block traversal
        if normalized.contains("../") || normalized.contains("/..") {
            return Err(AppError::Forbidden("Path traversal (..) is not allowed".into()));
        }

        // Block absolute system paths
        #[cfg(target_os = "windows")]
        {
            let lower = normalized.to_lowercase();
            if lower.starts_with("c:/windows") || lower.starts_with("c:/program files") {
                return Err(AppError::Forbidden("Access to system directories is blocked".into()));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            if normalized.starts_with("/etc/") || normalized.starts_with("/usr/")
                || normalized.starts_with("/bin/") || normalized.starts_with("/sbin/")
                || normalized.starts_with("/boot/") || normalized.starts_with("/sys/")
                || normalized.starts_with("/proc/")
            {
                return Err(AppError::Forbidden("Access to system directories is blocked".into()));
            }
        }

        Ok(())
    }
}

// ========================================================================
// Obsidian Bridge
// ========================================================================

pub mod obsidian {
    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "action", content = "params")]
    pub enum ObsidianAction {
        /// List all markdown files in the vault.
        ListNotes { folder: Option<String> },
        /// Read a note by its vault-relative path.
        ReadNote { path: String },
        /// Create or update a note.
        WriteNote { path: String, content: String },
        /// Search notes by content (simple text match).
        SearchNotes { query: String, max_results: Option<usize> },
        /// Get vault structure (folders only).
        VaultStructure,
        /// Append content to an existing note.
        AppendToNote { path: String, content: String },
    }

    pub async fn execute(
        vault_path: &str,
        api_port: Option<u16>,
        api_key: Option<&str>,
        action: ObsidianAction,
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = format!("{:?}", &action).split_whitespace().next().unwrap_or("unknown").to_string();

        // Try REST API first, fall back to filesystem
        let result = if let (Some(port), Some(key)) = (api_port, api_key) {
            match execute_via_api(port, key, &action).await {
                Ok(v) => Ok(v),
                Err(_) => {
                    tracing::debug!("Obsidian REST API unavailable, falling back to filesystem");
                    execute_via_filesystem(vault_path, &action).await
                }
            }
        } else {
            execute_via_filesystem(vault_path, &action).await
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        match result {
            Ok(output) => Ok(BridgeActionResult {
                success: true,
                output,
                error: None,
                duration_ms,
                bridge: "obsidian".into(),
                action: action_name,
            }),
            Err(e) => Ok(BridgeActionResult {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                bridge: "obsidian".into(),
                action: action_name,
            }),
        }
    }

    /// Execute via Obsidian Local REST API plugin.
    async fn execute_via_api(
        port: u16,
        api_key: &str,
        action: &ObsidianAction,
    ) -> Result<String, AppError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

        let base_url = format!("https://127.0.0.1:{port}");

        match action {
            ObsidianAction::ListNotes { folder } => {
                let path = folder.as_deref().unwrap_or("/");
                let resp = client
                    .get(format!("{base_url}/vault/{path}"))
                    .header("Authorization", format!("Bearer {api_key}"))
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("Obsidian API request failed: {e}")))?;
                resp.text().await.map_err(|e| AppError::Internal(e.to_string()))
            }
            ObsidianAction::ReadNote { path } => {
                let resp = client
                    .get(format!("{base_url}/vault/{path}"))
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Accept", "text/markdown")
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("Obsidian API request failed: {e}")))?;
                resp.text().await.map_err(|e| AppError::Internal(e.to_string()))
            }
            ObsidianAction::WriteNote { path, content } => {
                let resp = client
                    .put(format!("{base_url}/vault/{path}"))
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Content-Type", "text/markdown")
                    .body(content.clone())
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("Obsidian API request failed: {e}")))?;
                if resp.status().is_success() {
                    Ok(format!("Note saved: {path}"))
                } else {
                    Err(AppError::Internal(format!("Obsidian API returned {}", resp.status())))
                }
            }
            ObsidianAction::SearchNotes { query, .. } => {
                let resp = client
                    .post(format!("{base_url}/search/simple/"))
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Content-Type", "text/plain")
                    .body(query.clone())
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("Obsidian API request failed: {e}")))?;
                resp.text().await.map_err(|e| AppError::Internal(e.to_string()))
            }
            _ => Err(AppError::Validation("Action not supported via REST API, using filesystem".into())),
        }
    }

    /// Execute via direct filesystem access to the vault directory.
    ///
    /// All filesystem I/O is offloaded to a blocking thread via
    /// `tokio::task::spawn_blocking` so the async runtime is never starved,
    /// even for large vaults with thousands of notes.
    async fn execute_via_filesystem(vault_path: &str, action: &ObsidianAction) -> Result<String, AppError> {
        let vault_path = vault_path.to_owned();
        let action = action.clone();

        tokio::task::spawn_blocking(move || {
            let vault = std::path::Path::new(&vault_path);
            if !vault.exists() {
                return Err(AppError::NotFound(format!("Vault path not found: {vault_path}")));
            }

            match &action {
                ObsidianAction::ListNotes { folder } => {
                    let search_path = match folder {
                        Some(f) => vault.join(f),
                        None => vault.to_path_buf(),
                    };
                    let mut notes = Vec::new();
                    collect_markdown_files(&search_path, vault, &mut notes)?;
                    Ok(notes.join("\n"))
                }
                ObsidianAction::ReadNote { path } => {
                    let full_path = vault.join(path);
                    if !full_path.starts_with(vault) {
                        return Err(AppError::Forbidden("Path traversal detected".into()));
                    }
                    std::fs::read_to_string(&full_path)
                        .map_err(AppError::Io)
                }
                ObsidianAction::WriteNote { path, content } => {
                    let full_path = vault.join(path);
                    if !full_path.starts_with(vault) {
                        return Err(AppError::Forbidden("Path traversal detected".into()));
                    }
                    if let Some(parent) = full_path.parent() {
                        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
                    }
                    std::fs::write(&full_path, content).map_err(AppError::Io)?;
                    Ok(format!("Note saved: {path}"))
                }
                ObsidianAction::SearchNotes { query, max_results } => {
                    let max = max_results.unwrap_or(20);
                    let query_lower = query.to_lowercase();
                    let mut results = Vec::new();
                    let mut all_notes = Vec::new();
                    collect_markdown_files(vault, vault, &mut all_notes)?;

                    for note_path in all_notes {
                        if results.len() >= max { break; }
                        let full = vault.join(&note_path);
                        if let Ok(content) = std::fs::read_to_string(&full) {
                            if content.to_lowercase().contains(&query_lower) {
                                let context = content.lines()
                                    .find(|line| line.to_lowercase().contains(&query_lower))
                                    .unwrap_or("")
                                    .chars().take(200).collect::<String>();
                                results.push(format!("{note_path}\t{context}"));
                            }
                        }
                    }
                    Ok(results.join("\n"))
                }
                ObsidianAction::VaultStructure => {
                    let mut dirs = Vec::new();
                    collect_directories(vault, vault, &mut dirs)?;
                    Ok(dirs.join("\n"))
                }
                ObsidianAction::AppendToNote { path, content } => {
                    let full_path = vault.join(path);
                    if !full_path.starts_with(vault) {
                        return Err(AppError::Forbidden("Path traversal detected".into()));
                    }
                    use std::io::Write;
                    let mut file = std::fs::OpenOptions::new()
                        .append(true)
                        .create(true)
                        .open(&full_path)
                        .map_err(AppError::Io)?;
                    writeln!(file, "\n{content}").map_err(AppError::Io)?;
                    Ok(format!("Appended to: {path}"))
                }
            }
        })
        .await
        .map_err(|e| AppError::Internal(format!("Blocking task panicked: {e}")))?
    }

    fn collect_markdown_files(
        dir: &std::path::Path,
        vault_root: &std::path::Path,
        results: &mut Vec<String>,
    ) -> Result<(), AppError> {
        if !dir.is_dir() { return Ok(()); }
        let entries = std::fs::read_dir(dir).map_err(AppError::Io)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip hidden directories
                if entry.file_name().to_string_lossy().starts_with('.') { continue; }
                collect_markdown_files(&path, vault_root, results)?;
            } else if path.extension().is_some_and(|ext| ext == "md") {
                if let Ok(relative) = path.strip_prefix(vault_root) {
                    results.push(relative.to_string_lossy().to_string());
                }
            }
        }
        Ok(())
    }

    fn collect_directories(
        dir: &std::path::Path,
        vault_root: &std::path::Path,
        results: &mut Vec<String>,
    ) -> Result<(), AppError> {
        if !dir.is_dir() { return Ok(()); }
        let entries = std::fs::read_dir(dir).map_err(AppError::Io)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if entry.file_name().to_string_lossy().starts_with('.') { continue; }
                if let Ok(relative) = path.strip_prefix(vault_root) {
                    results.push(relative.to_string_lossy().to_string());
                }
                collect_directories(&path, vault_root, results)?;
            }
        }
        Ok(())
    }
}

// ========================================================================
// Shared CLI runner
// ========================================================================

/// Maximum output size from a bridge CLI command (2 MB).
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

/// Run a CLI command and capture its output.
/// No shell involved -- args are passed directly to prevent injection.
async fn run_cli(binary: &str, args: &[&str]) -> Result<String, AppError> {
    let mut cmd = tokio::process::Command::new(binary);
    cmd.args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        cmd.output(),
    )
    .await
    .map_err(|_| AppError::Execution("CLI command timed out after 30 seconds".into()))?
    .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn '{}': {}", binary, e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Truncate oversized output
    let combined = if output.status.success() {
        stdout.to_string()
    } else {
        format!("STDERR: {}\nSTDOUT: {}", stderr, stdout)
    };

    if combined.len() > MAX_OUTPUT_BYTES {
        Ok(format!(
            "{}...\n[truncated at {} bytes, total {} bytes]",
            &combined[..MAX_OUTPUT_BYTES],
            MAX_OUTPUT_BYTES,
            combined.len()
        ))
    } else if output.status.success() {
        Ok(combined)
    } else {
        Err(AppError::Execution(combined))
    }
}
