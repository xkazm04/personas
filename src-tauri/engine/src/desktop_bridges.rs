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

use crate::desktop_security::DesktopConnectorManifest;
use personas_core::error::AppError;

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

impl BridgeActionResult {
    /// Build a `BridgeActionResult` from the outcome of running a bridge action,
    /// folding the success/error envelope construction that every bridge's
    /// `execute` fn used to repeat inline.
    fn finish(
        bridge: &str,
        action: String,
        duration_ms: u64,
        result: Result<String, AppError>,
    ) -> Self {
        match result {
            Ok(output) => Self {
                success: true,
                output,
                error: None,
                duration_ms,
                bridge: bridge.into(),
                action,
            },
            Err(e) => Self {
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms,
                bridge: bridge.into(),
                action,
            },
        }
    }
}

/// Derive a short action name from an action enum's `{:?}` representation,
/// taking just the variant name (the token before the first whitespace or
/// opening brace/paren of its debug-formatted fields).
fn first_variant_name<T: std::fmt::Debug>(action: &T) -> String {
    format!("{:?}", action)
        .split_whitespace()
        .next()
        .unwrap_or("unknown")
        .to_string()
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
        RunTask {
            task_name: String,
            folder: Option<String>,
        },
        /// Get the VS Code version.
        Version,
    }

    pub async fn execute(
        binary: &str,
        action: VsCodeAction,
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = first_variant_name(&action);

        let result = match action {
            VsCodeAction::OpenFile { path, line } => {
                let goto = match line {
                    Some(l) => format!("{path}:{l}"),
                    None => path,
                };
                run_cli(binary, &["--goto", &goto]).await
            }
            VsCodeAction::OpenFolder { path } => run_cli(binary, &[&path]).await,
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
                let mut args = vec![
                    "--command".to_string(),
                    format!("workbench.action.tasks.runTask:{task_name}"),
                ];
                if let Some(f) = folder {
                    args.insert(0, f);
                }
                let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                run_cli(binary, &arg_refs).await
            }
            VsCodeAction::Version => run_cli(binary, &["--version"]).await,
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        Ok(BridgeActionResult::finish(
            "vscode",
            action_name,
            duration_ms,
            result,
        ))
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
        ContainerLogs {
            container: String,
            tail: Option<u32>,
        },
        /// Inspect a container (JSON output).
        InspectContainer { container: String },
        /// Run a command in a running container.
        Exec {
            container: String,
            command: Vec<String>,
        },
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
        let action_name = first_variant_name(&action);

        let result = match action {
            DockerAction::ListContainers { all } => {
                let mut args = vec![
                    "ps",
                    "--format",
                    "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}",
                ];
                if all {
                    args.push("-a");
                }
                run_cli(binary, &args).await
            }
            DockerAction::ListImages => {
                run_cli(
                    binary,
                    &[
                        "images",
                        "--format",
                        "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}",
                    ],
                )
                .await
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
                    return Err(AppError::Validation(
                        "Docker exec requires at least one command argument".into(),
                    ));
                }
                // Security: validate command doesn't contain shell metacharacters
                for arg in &command {
                    if arg.contains(';')
                        || arg.contains('|')
                        || arg.contains('&')
                        || arg.contains('`')
                    {
                        return Err(AppError::Validation(
                            "Docker exec arguments cannot contain shell metacharacters (;|&`)"
                                .into(),
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
                if detach {
                    args.push("-d");
                }
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
            DockerAction::Version => run_cli(binary, &["version", "--format", "json"]).await,
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        Ok(BridgeActionResult::finish(
            "docker",
            action_name,
            duration_ms,
            result,
        ))
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
        Execute {
            command: Vec<String>,
            working_dir: Option<String>,
        },
        /// Read a file's contents.
        ReadFile { path: String },
        /// Write content to a file.
        WriteFile { path: String, content: String },
        /// List directory contents.
        ListDir { path: String },
        /// Check if a path exists.
        PathExists { path: String },
    }

    /// Environment variable names that are blocked because they can subvert
    /// process security (library injection, PATH hijacking, config redirection).
    /// Checked case-insensitively.
    const BLOCKED_ENV_VARS: &[&str] = &[
        // Linux/glibc library injection
        "ld_preload",
        "ld_library_path",
        "ld_audit",
        "ld_debug",
        "ld_debug_output",
        "ld_dynamic_weak",
        "ld_origin_path",
        "ld_profile",
        "ld_show_auxv",
        "ld_use_load_bias",
        // macOS dyld injection
        "dyld_insert_libraries",
        "dyld_library_path",
        "dyld_framework_path",
        "dyld_fallback_library_path",
        "dyld_fallback_framework_path",
        "dyld_image_suffix",
        "dyld_force_flat_namespace",
        "dyld_print_libraries",
        // PATH hijacking — can redirect command resolution to attacker-controlled dirs
        "path",
        // Home/config redirection — can change where apps load settings from
        "home",
        "userprofile",
        "xdg_config_home",
        "xdg_data_home",
        "xdg_cache_home",
        "xdg_runtime_dir",
        "xdg_config_dirs",
        "xdg_data_dirs",
        // Misc dangerous
        "ifs",               // shell field separator — can alter arg parsing
        "bash_env",          // sourced on non-interactive bash startup
        "env",               // sourced on non-interactive sh startup
        "cdpath",            // can cause unexpected directory changes
        "pythonpath",        // Python module injection
        "rubylib",           // Ruby module injection
        "node_options",      // Node.js flag injection (e.g. --require)
        "perl5lib",          // Perl module injection
        "classpath",         // Java classpath injection
        "java_tool_options", // JVM flag injection
        "_java_options",     // JVM flag injection (alternative)
    ];

    /// Returns an error if any env var key is on the blocklist.
    fn validate_env_vars(env_vars: &HashMap<String, String>) -> Result<(), AppError> {
        for key in env_vars.keys() {
            let lower = key.to_lowercase();
            if BLOCKED_ENV_VARS.contains(&lower.as_str()) {
                return Err(AppError::Forbidden(format!(
                    "Environment variable '{}' is blocked for security. \
                     It can be used to bypass command sandboxing.",
                    key,
                )));
            }
        }
        Ok(())
    }

    /// Blocked commands that should never be executed via the terminal bridge.
    const BLOCKED_COMMANDS: &[&str] = &[
        "rm",
        "rmdir",
        "del",
        "format",
        "mkfs",
        "dd",
        "shred",
        "wipefs",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
        "passwd",
        "useradd",
        "userdel",
        "usermod",
        "chmod",
        "chown",
        "chgrp",
        "mount",
        "umount",
        "iptables",
        "firewall-cmd",
        "ufw",
        "curl",
        "wget", // use API proxy instead
        "ssh",
        "scp",
        "sftp",
        "sudo",
        "su",
        "doas",
        "runas",
        "reg",
        "regedit",
        "net",
        "sc",
        "wmic",
    ];

    pub async fn execute(
        _shell: &str,
        action: TerminalAction,
        env_vars: &HashMap<String, String>,
        manifest: &DesktopConnectorManifest,
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = first_variant_name(&action);

        let result = match action {
            TerminalAction::Execute {
                command,
                working_dir,
            } => {
                if command.is_empty() {
                    return Err(AppError::Validation("Command cannot be empty".into()));
                }

                // Block dangerous environment variables before anything else
                validate_env_vars(env_vars)?;

                // Check against blocked commands
                let base_cmd = command[0].rsplit('/').next().unwrap_or(&command[0]);
                let base_cmd = base_cmd.rsplit('\\').next().unwrap_or(base_cmd);
                let base_cmd_lower = base_cmd.to_lowercase();
                // Strip all Windows-executable extensions, not just .exe
                let base_cmd_no_ext = strip_executable_extension(&base_cmd_lower);

                if BLOCKED_COMMANDS.contains(&base_cmd_no_ext) {
                    return Err(AppError::Forbidden(format!(
                        "Command '{}' is blocked for security. Use the appropriate connector instead.",
                        base_cmd
                    )));
                }

                // Validate no shell metacharacters in any argument
                for arg in &command {
                    if arg.contains('|')
                        || arg.contains(';')
                        || arg.contains('`')
                        || arg.contains("$(")
                        || arg.contains("${")
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

                cmd.kill_on_drop(true);
                let output = tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output())
                    .await
                    .map_err(|_| AppError::Execution("Command timed out after 30 seconds".into()))?
                    .map_err(|e| {
                        AppError::ProcessSpawn(format!("Failed to execute command: {e}"))
                    })?;

                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                if output.status.success() {
                    Ok(stdout.to_string())
                } else {
                    Err(AppError::Execution(format!(
                        "Command exited with {}: {}{}",
                        output.status,
                        stderr.chars().take(2000).collect::<String>(),
                        if stderr.len() > 2000 {
                            "...[truncated]"
                        } else {
                            ""
                        }
                    )))
                }
            }

            TerminalAction::ReadFile { path } => {
                // Validate path doesn't escape
                validate_path_safety(&path)?;
                // Enforce connector security manifest path allowlist
                if !manifest.is_path_allowed(&path) {
                    return Err(AppError::Forbidden(format!(
                        "Path '{}' is not within the terminal connector's allowed paths",
                        path
                    )));
                }
                match tokio::fs::read_to_string(&path).await {
                    Ok(content) => {
                        // Cap at 1MB for safety
                        if content.len() > 1_048_576 {
                            Ok(format!(
                                "{}...\n[truncated at 1MB, total {} bytes]",
                                personas_core::utils::text::truncate_on_char_boundary(
                                    &content, 1048576
                                ),
                                content.len()
                            ))
                        } else {
                            Ok(content)
                        }
                    }
                    Err(e) => Err(AppError::Io(e)),
                }
            }

            TerminalAction::WriteFile { path, content } => {
                validate_path_safety(&path)?;
                // Enforce connector security manifest path allowlist
                if !manifest.is_path_allowed(&path) {
                    return Err(AppError::Forbidden(format!(
                        "Path '{}' is not within the terminal connector's allowed paths",
                        path
                    )));
                }
                if content.len() > 10_485_760 {
                    return Err(AppError::Validation(
                        "File content exceeds 10MB limit".into(),
                    ));
                }
                tokio::fs::write(&path, &content)
                    .await
                    .map_err(AppError::Io)?;
                Ok(format!("Written {} bytes to {}", content.len(), path))
            }

            TerminalAction::ListDir { path } => {
                validate_path_safety(&path)?;
                // Enforce connector security manifest path allowlist
                if !manifest.is_path_allowed(&path) {
                    return Err(AppError::Forbidden(format!(
                        "Path '{}' is not within the terminal connector's allowed paths",
                        path
                    )));
                }
                let mut entries = tokio::fs::read_dir(&path).await.map_err(AppError::Io)?;
                let mut listing = Vec::new();
                while let Some(entry) = entries.next_entry().await.map_err(AppError::Io)? {
                    let meta = entry.metadata().await.ok();
                    let kind = meta
                        .as_ref()
                        .map(|m| if m.is_dir() { "dir" } else { "file" })
                        .unwrap_or("?");
                    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    listing.push(format!(
                        "{}\t{}\t{}",
                        kind,
                        size,
                        entry.file_name().to_string_lossy()
                    ));
                }
                Ok(listing.join("\n"))
            }

            TerminalAction::PathExists { path } => {
                validate_path_safety(&path)?;
                // Enforce connector security manifest path allowlist
                if !manifest.is_path_allowed(&path) {
                    return Err(AppError::Forbidden(format!(
                        "Path '{}' is not within the terminal connector's allowed paths",
                        path
                    )));
                }
                let exists = tokio::fs::metadata(&path).await.is_ok();
                Ok(exists.to_string())
            }
        };

        let duration_ms = start.elapsed().as_millis() as u64;
        Ok(BridgeActionResult::finish(
            "terminal",
            action_name,
            duration_ms,
            result,
        ))
    }

    /// Windows-executable extensions that must be stripped before blocklist comparison.
    const EXECUTABLE_EXTENSIONS: &[&str] = &[".exe", ".cmd", ".bat", ".com", ".ps1"];

    /// Strip any known Windows-executable extension from a lowercased command name.
    fn strip_executable_extension(cmd: &str) -> &str {
        for ext in EXECUTABLE_EXTENSIONS {
            if let Some(stripped) = cmd.strip_suffix(ext) {
                return stripped;
            }
        }
        cmd
    }

    /// Reject paths that attempt directory traversal or access sensitive directories.
    fn validate_path_safety(path: &str) -> Result<(), AppError> {
        let normalized = path.replace('\\', "/");

        // Block traversal
        if normalized.contains("../") || normalized.contains("/..") || normalized == ".." {
            return Err(AppError::Forbidden(
                "Path traversal (..) is not allowed".into(),
            ));
        }

        // Block absolute system paths and sensitive user directories
        #[cfg(target_os = "windows")]
        {
            let lower = normalized.to_lowercase();
            let blocked_prefixes = ["c:/windows", "c:/program files", "c:/program files (x86)"];
            for prefix in &blocked_prefixes {
                if lower.starts_with(prefix) {
                    return Err(AppError::Forbidden(
                        "Access to system directories is blocked".into(),
                    ));
                }
            }

            // Block sensitive user-profile directories (resolve %USERPROFILE% patterns)
            if let Ok(home) = std::env::var("USERPROFILE") {
                let home_norm = home.replace('\\', "/").to_lowercase();
                let sensitive_dirs = [
                    ".ssh",
                    ".gnupg",
                    ".aws",
                    ".azure",
                    ".kube",
                    "AppData/Local/Google/Chrome",
                    "AppData/Local/Microsoft/Edge",
                    "AppData/Roaming/Mozilla/Firefox",
                ];
                for dir in &sensitive_dirs {
                    let blocked = format!("{}/{}", home_norm, dir.to_lowercase());
                    if lower.starts_with(&blocked) {
                        return Err(AppError::Forbidden(format!(
                            "Access to sensitive directory '{}' is blocked",
                            dir
                        )));
                    }
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let system_prefixes = [
                "/etc/", "/usr/", "/bin/", "/sbin/", "/boot/", "/sys/", "/proc/",
            ];
            for prefix in &system_prefixes {
                if normalized.starts_with(prefix) {
                    return Err(AppError::Forbidden(
                        "Access to system directories is blocked".into(),
                    ));
                }
            }

            // Block sensitive user home directories
            if let Ok(home) = std::env::var("HOME") {
                let home_norm = if home.ends_with('/') {
                    home.clone()
                } else {
                    format!("{}/", home)
                };
                let sensitive_dirs = [
                    ".ssh",
                    ".gnupg",
                    ".aws",
                    ".azure",
                    ".kube",
                    ".config/google-chrome",
                    ".mozilla/firefox",
                    ".config/chromium",
                ];
                for dir in &sensitive_dirs {
                    let blocked = format!("{}{}", home_norm, dir);
                    if normalized.starts_with(&blocked) {
                        return Err(AppError::Forbidden(format!(
                            "Access to sensitive directory '~/{dir}' is blocked"
                        )));
                    }
                }
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
        SearchNotes {
            query: String,
            max_results: Option<usize>,
        },
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
        let action_name = first_variant_name(&action);

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
        Ok(BridgeActionResult::finish(
            "obsidian",
            action_name,
            duration_ms,
            result,
        ))
    }

    /// Execute via Obsidian Local REST API plugin.
    async fn execute_via_api(
        port: u16,
        api_key: &str,
        action: &ObsidianAction,
    ) -> Result<String, AppError> {
        // Deliberately NOT routed through `personas_core::url_safety::build_ssrf_safe_client`.
        // `base_url` below is a literal `https://127.0.0.1:{port}` — only `port`
        // (`DesktopBridgeConfig::obsidian_api_port: Option<u16>`, set via the
        // Obsidian Local REST API plugin setting) is caller-influenced, the host
        // is not: there is no config, vault setting, or persisted value anywhere
        // in this call chain that can substitute a different host string. An
        // SSRF-safe client's private-IP-blocking DNS resolver would reject this
        // very loopback target and break every Obsidian bridge call, for no
        // additional protection since the host can't be redirected off-loopback
        // by anything this function accepts as input.
        // The vault fragment is interpolated into `{base_url}/vault/{path}`,
        // so a `..` segment escapes the `/vault/` namespace into the Local
        // REST API's other endpoints once the URL is normalised. Same
        // fragment contract as the filesystem arm, so it gets the same lexical
        // guard (the filesystem half additionally proves containment on disk).
        match action {
            ObsidianAction::ReadNote { path }
            | ObsidianAction::WriteNote { path, .. }
            | ObsidianAction::AppendToNote { path, .. } => {
                crate::path_safety::validate_relative_fragment(path)
                    .map_err(AppError::Forbidden)?;
            }
            ObsidianAction::ListNotes { folder: Some(f) } => {
                crate::path_safety::validate_relative_fragment(f).map_err(AppError::Forbidden)?;
            }
            _ => {}
        }

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
                resp.text()
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
            }
            ObsidianAction::ReadNote { path } => {
                let resp = client
                    .get(format!("{base_url}/vault/{path}"))
                    .header("Authorization", format!("Bearer {api_key}"))
                    .header("Accept", "text/markdown")
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("Obsidian API request failed: {e}")))?;
                resp.text()
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
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
                    Err(AppError::Internal(format!(
                        "Obsidian API returned {}",
                        resp.status()
                    )))
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
                resp.text()
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
            }
            _ => Err(AppError::Validation(
                "Action not supported via REST API, using filesystem".into(),
            )),
        }
    }

    /// Resolve a caller-supplied, vault-relative fragment inside `vault`.
    ///
    /// EVERY command that joins a caller-supplied fragment to the vault MUST
    /// go through this, so the guard cannot diverge between siblings. It
    /// delegates to the shared anchored resolver
    /// (`crate::path_safety::resolve_within_root`) rather than re-deriving a
    /// local one — the four call sites below previously each carried their own
    /// `vault.join(path).starts_with(vault)`, which is not a containment check
    /// at all: `Path::starts_with` compares whole components and never
    /// resolves `..`, so `vault.join("../../.ssh/id_rsa")` starts with `vault`,
    /// the check returned `true` while printing "Path traversal detected", and
    /// the un-normalised path went to an OS call that DOES resolve the `..`.
    ///
    /// `vault` must already be canonical (see `execute_via_filesystem`).
    /// Returns the resolved path — use only the returned value.
    fn resolve_vault_path(
        vault: &std::path::Path,
        rel: &str,
    ) -> Result<std::path::PathBuf, AppError> {
        crate::path_safety::resolve_within_root(vault, rel).map_err(AppError::Forbidden)
    }

    /// Execute via direct filesystem access to the vault directory.
    ///
    /// All filesystem I/O is offloaded to a blocking thread via
    /// `tokio::task::spawn_blocking` so the async runtime is never starved,
    /// even for large vaults with thousands of notes.
    async fn execute_via_filesystem(
        vault_path: &str,
        action: &ObsidianAction,
    ) -> Result<String, AppError> {
        let vault_path = vault_path.to_owned();
        let action = action.clone();

        tokio::task::spawn_blocking(move || {
            let vault_raw = std::path::Path::new(&vault_path);
            if !vault_raw.exists() {
                return Err(AppError::NotFound(format!(
                    "Vault path not found: {vault_path}"
                )));
            }
            // Canonicalise the root ONCE. Containment is only meaningful
            // between two canonical paths, and `collect_markdown_files`'
            // `strip_prefix(vault_root)` silently drops every result if the
            // root it is handed is not the same form the walk produced.
            let vault_buf = std::fs::canonicalize(vault_raw).map_err(AppError::Io)?;
            let vault = vault_buf.as_path();

            match &action {
                ObsidianAction::ListNotes { folder } => {
                    let search_path = match folder {
                        Some(f) => resolve_vault_path(vault, f)?,
                        None => vault.to_path_buf(),
                    };
                    let mut notes = Vec::new();
                    collect_markdown_files(&search_path, vault, &mut notes)?;
                    Ok(notes.join("\n"))
                }
                ObsidianAction::ReadNote { path } => {
                    let full_path = resolve_vault_path(vault, path)?;
                    std::fs::read_to_string(&full_path).map_err(AppError::Io)
                }
                ObsidianAction::WriteNote { path, content } => {
                    let full_path = resolve_vault_path(vault, path)?;
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
                        if results.len() >= max {
                            break;
                        }
                        // `note_path` comes from our own walk, but the walk
                        // follows symlinked directories, so a link inside the
                        // vault could still surface a file outside it. Resolve
                        // it like any other fragment and skip what escapes.
                        let Ok(full) = resolve_vault_path(vault, &note_path) else {
                            continue;
                        };
                        if let Ok(content) = std::fs::read_to_string(&full) {
                            if content.to_lowercase().contains(&query_lower) {
                                let context = content
                                    .lines()
                                    .find(|line| line.to_lowercase().contains(&query_lower))
                                    .unwrap_or("")
                                    .chars()
                                    .take(200)
                                    .collect::<String>();
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
                    let full_path = resolve_vault_path(vault, path)?;
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
        if !dir.is_dir() {
            return Ok(());
        }
        let entries = std::fs::read_dir(dir).map_err(AppError::Io)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip hidden directories
                if entry.file_name().to_string_lossy().starts_with('.') {
                    continue;
                }
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
        if !dir.is_dir() {
            return Ok(());
        }
        let entries = std::fs::read_dir(dir).map_err(AppError::Io)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if entry.file_name().to_string_lossy().starts_with('.') {
                    continue;
                }
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

    cmd.kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output())
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
            personas_core::utils::text::truncate_on_char_boundary(&combined, MAX_OUTPUT_BYTES),
            MAX_OUTPUT_BYTES,
            combined.len()
        ))
    } else if output.status.success() {
        Ok(combined)
    } else {
        Err(AppError::Execution(combined))
    }
}

#[cfg(test)]
mod tests {
    use super::obsidian::{execute, ObsidianAction};

    /// `<tmp>/vault/notes/nested.md` plus a sibling `<tmp>/outside/secret.txt`
    /// the vault must never be able to reach.
    fn vault_fixture() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let vault = dir.path().join("vault");
        std::fs::create_dir_all(vault.join("notes")).unwrap();
        std::fs::write(vault.join("notes").join("nested.md"), "# nested").unwrap();
        std::fs::create_dir_all(dir.path().join("outside")).unwrap();
        std::fs::write(dir.path().join("outside").join("secret.txt"), "PRIVATE KEY").unwrap();
        (dir, vault)
    }

    async fn run(vault: &std::path::Path, action: ObsidianAction) -> super::BridgeActionResult {
        // `api_port`/`api_key` both None forces the filesystem arm.
        execute(&vault.to_string_lossy(), None, None, action)
            .await
            .expect("bridge execute must not error out of band")
    }

    /// REGRESSION: `ReadNote` was an arbitrary file read. The old guard was
    /// `vault.join(path).starts_with(vault)`, which is TRUE for a `..` escape
    /// because `Path::starts_with` is component-wise and never resolves `..`.
    #[tokio::test]
    async fn read_note_rejects_parent_traversal() {
        let (_tmp, vault) = vault_fixture();
        for path in [
            "../outside/secret.txt",
            "notes/../../outside/secret.txt",
            r"..\outside\secret.txt",
        ] {
            let r = run(
                &vault,
                ObsidianAction::ReadNote {
                    path: path.to_string(),
                },
            )
            .await;
            assert!(!r.success, "traversal must be rejected: {path}");
            assert!(
                !r.output.contains("PRIVATE KEY"),
                "traversal leaked file contents: {path}"
            );
        }
    }

    /// REGRESSION: an absolute path also passed the old guard on Unix
    /// (`Path::join` with an absolute argument discards the base entirely, so
    /// the result did NOT start with the vault — but nothing rejected the
    /// Windows drive-relative form, and the error message was wrong either
    /// way). Both forms must be refused explicitly.
    #[tokio::test]
    async fn read_note_rejects_absolute_and_drive_relative_paths() {
        let (tmp, vault) = vault_fixture();
        let absolute = tmp.path().join("outside").join("secret.txt");
        for path in [
            absolute.to_string_lossy().to_string(),
            "/etc/shadow".to_string(),
            r"\\server\share\secret.txt".to_string(),
            "C:evil.md".to_string(),
        ] {
            let r = run(&vault, ObsidianAction::ReadNote { path: path.clone() }).await;
            assert!(!r.success, "absolute path must be rejected: {path}");
            assert!(!r.output.contains("PRIVATE KEY"));
        }
    }

    /// REGRESSION: `WriteNote` was an arbitrary write that also
    /// `create_dir_all`'d the parent on the way out of the vault.
    #[tokio::test]
    async fn write_note_rejects_traversal_and_creates_nothing_outside() {
        let (tmp, vault) = vault_fixture();
        let r = run(
            &vault,
            ObsidianAction::WriteNote {
                path: "../escaped/pwned.md".into(),
                content: "x".into(),
            },
        )
        .await;
        assert!(!r.success, "traversal write must be rejected");
        // One level up from the vault is the per-test tempdir, so this
        // assertion cannot be polluted by another run.
        assert!(
            !tmp.path().join("escaped").exists(),
            "rejected write still created directories outside the vault"
        );
    }

    /// REGRESSION: `AppendToNote` is an append-OR-CREATE, so the same escape
    /// produced a new file at an arbitrary path.
    #[tokio::test]
    async fn append_to_note_rejects_traversal() {
        let (tmp, vault) = vault_fixture();
        let r = run(
            &vault,
            ObsidianAction::AppendToNote {
                path: "../outside/secret.txt".into(),
                content: "appended".into(),
            },
        )
        .await;
        assert!(!r.success, "traversal append must be rejected");
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("outside").join("secret.txt")).unwrap(),
            "PRIVATE KEY",
            "rejected append still modified a file outside the vault"
        );
    }

    #[tokio::test]
    async fn list_notes_rejects_traversal_folder() {
        let (_tmp, vault) = vault_fixture();
        let r = run(
            &vault,
            ObsidianAction::ListNotes {
                folder: Some("../outside".into()),
            },
        )
        .await;
        assert!(!r.success, "traversal folder must be rejected");
    }

    /// The other half of the contract: legitimate vault-relative work must
    /// still succeed, including creating a note in a folder that does not
    /// exist yet (the case `canonicalize` alone cannot handle).
    #[tokio::test]
    async fn legitimate_nested_paths_still_work() {
        let (_tmp, vault) = vault_fixture();

        let read = run(
            &vault,
            ObsidianAction::ReadNote {
                path: "notes/nested.md".into(),
            },
        )
        .await;
        assert!(read.success, "legitimate read failed: {:?}", read.error);
        assert_eq!(read.output, "# nested");

        let write = run(
            &vault,
            ObsidianAction::WriteNote {
                path: "new/deeper/note.md".into(),
                content: "created".into(),
            },
        )
        .await;
        assert!(write.success, "legitimate write failed: {:?}", write.error);
        assert_eq!(
            std::fs::read_to_string(vault.join("new").join("deeper").join("note.md")).unwrap(),
            "created"
        );

        let append = run(
            &vault,
            ObsidianAction::AppendToNote {
                path: "notes/nested.md".into(),
                content: "more".into(),
            },
        )
        .await;
        assert!(
            append.success,
            "legitimate append failed: {:?}",
            append.error
        );
        assert!(
            std::fs::read_to_string(vault.join("notes").join("nested.md"))
                .unwrap()
                .contains("more")
        );

        let list = run(&vault, ObsidianAction::ListNotes { folder: None }).await;
        assert!(list.success, "legitimate list failed: {:?}", list.error);
        assert!(
            list.output.contains("nested.md"),
            "vault walk returned nothing: {:?}",
            list.output
        );

        let list_sub = run(
            &vault,
            ObsidianAction::ListNotes {
                folder: Some("notes".into()),
            },
        )
        .await;
        assert!(list_sub.success, "legitimate subfolder list failed");
        assert!(list_sub.output.contains("nested.md"));
    }
}
