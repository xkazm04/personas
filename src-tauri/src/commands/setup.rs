use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::error::AppError;
use crate::AppState;

// Re-use the PATH probe helpers from system.rs
use super::system::{command_exists_in_path, command_version};

// ── Event payloads ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum SetupTarget {
    #[serde(rename = "node")]
    Node,
    #[serde(rename = "claude_cli")]
    ClaudeCli,
}

#[derive(Clone, Serialize)]
struct SetupOutputEvent {
    install_id: String,
    target: SetupTarget,
    line: String,
}

#[derive(Clone, Serialize)]
struct SetupStatusEvent {
    install_id: String,
    target: SetupTarget,
    status: String,
    progress_pct: Option<u8>,
    error: Option<String>,
    manual_command: Option<String>,
}

// ── Platform detection ──────────────────────────────────────────

#[derive(Debug, Clone)]
enum Platform {
    Windows,
    MacOS,
    Linux,
}

#[derive(Debug, Clone)]
struct PlatformInfo {
    platform: Platform,
    arch: &'static str, // "x64" | "arm64"
    has_winget: bool,
    has_brew: bool,
    has_apt: bool,
}

fn detect_platform() -> PlatformInfo {
    let platform = if cfg!(target_os = "windows") {
        Platform::Windows
    } else if cfg!(target_os = "macos") {
        Platform::MacOS
    } else {
        Platform::Linux
    };

    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };

    let has_winget = cfg!(target_os = "windows") && command_exists_in_path("winget");
    let has_brew = cfg!(target_os = "macos") && command_exists_in_path("brew");
    let has_apt = cfg!(target_os = "linux") && command_exists_in_path("apt-get");

    PlatformInfo {
        platform,
        arch,
        has_winget,
        has_brew,
        has_apt,
    }
}

// ── Emit helpers ────────────────────────────────────────────────

fn emit_output(app: &tauri::AppHandle, install_id: &str, target: &SetupTarget, line: &str) {
    let _ = app.emit(
        "setup-output",
        SetupOutputEvent {
            install_id: install_id.to_string(),
            target: target.clone(),
            line: line.to_string(),
        },
    );
}

fn emit_status(
    app: &tauri::AppHandle,
    install_id: &str,
    target: &SetupTarget,
    status: &str,
    progress_pct: Option<u8>,
    error: Option<String>,
    manual_command: Option<String>,
) {
    let _ = app.emit(
        "setup-status",
        SetupStatusEvent {
            install_id: install_id.to_string(),
            target: target.clone(),
            status: status.to_string(),
            progress_pct,
            error,
            manual_command,
        },
    );
}

// ── Command runner ──────────────────────────────────────────────

struct CommandResult {
    success: bool,
}

/// Spawn a process, stream stdout/stderr as setup-output events, wait for exit.
async fn run_command_streamed(
    app: &tauri::AppHandle,
    install_id: &str,
    target: &SetupTarget,
    command: &str,
    args: &[&str],
) -> CommandResult {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit_output(
                app,
                install_id,
                target,
                &format!("Failed to run {command}: {e}"),
            );
            return CommandResult { success: false };
        }
    };

    // Stream stdout in background
    if let Some(stdout) = child.stdout.take() {
        let app_c = app.clone();
        let id = install_id.to_string();
        let t = target.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_output(&app_c, &id, &t, &line);
            }
        });
    }

    // Stream stderr in background
    if let Some(stderr) = child.stderr.take() {
        let app_c = app.clone();
        let id = install_id.to_string();
        let t = target.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_output(&app_c, &id, &t, &line);
            }
        });
    }

    match child.wait().await {
        Ok(exit) => CommandResult {
            success: exit.success(),
        },
        Err(_) => CommandResult { success: false },
    }
}

// ── HTTP download with progress ─────────────────────────────────

async fn download_file(
    app: &tauri::AppHandle,
    install_id: &str,
    target: &SetupTarget,
    url: &str,
    filename: &str,
) -> Result<std::path::PathBuf, String> {
    emit_output(app, install_id, target, &format!("Downloading {url}..."));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total_size = response.content_length();
    let temp_dir = std::env::temp_dir().join("personas-setup");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| e.to_string())?;
    let file_path = temp_dir.join(filename);

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if let Some(total) = total_size {
            let pct = ((downloaded as f64 / total as f64) * 70.0) as u8; // 0-70% for download phase
            emit_status(
                app,
                install_id,
                target,
                "downloading",
                Some(pct),
                None,
                None,
            );
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;
    emit_output(app, install_id, target, "Download complete.");
    Ok(file_path)
}

// ── Node.js LTS version lookup ──────────────────────────────────

const FALLBACK_NODE_VERSION: &str = "22.14.0";

async fn get_node_lts_version() -> String {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    else {
        return FALLBACK_NODE_VERSION.to_string();
    };

    let Ok(resp) = client
        .get("https://nodejs.org/dist/index.json")
        .send()
        .await
    else {
        return FALLBACK_NODE_VERSION.to_string();
    };

    let Ok(versions) = resp.json::<Vec<serde_json::Value>>().await else {
        return FALLBACK_NODE_VERSION.to_string();
    };

    for v in &versions {
        // LTS entries have a non-false "lts" field (e.g. "Jod")
        if v.get("lts").and_then(|l| l.as_str()).is_some() {
            if let Some(version) = v.get("version").and_then(|v| v.as_str()) {
                return version.trim_start_matches('v').to_string();
            }
        }
    }

    FALLBACK_NODE_VERSION.to_string()
}

// ── Node.js installation ────────────────────────────────────────

async fn install_node(app: &tauri::AppHandle, install_id: &str, platform: &PlatformInfo) -> bool {
    // Already installed?
    if command_version("node").is_ok() {
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "Node.js is already installed.",
        );
        emit_status(
            app,
            install_id,
            &SetupTarget::Node,
            "completed",
            Some(100),
            None,
            None,
        );
        return true;
    }

    emit_status(
        app,
        install_id,
        &SetupTarget::Node,
        "downloading",
        Some(0),
        None,
        None,
    );

    match &platform.platform {
        Platform::Windows => install_node_windows(app, install_id, platform).await,
        Platform::MacOS => install_node_macos(app, install_id, platform).await,
        Platform::Linux => install_node_linux(app, install_id, platform).await,
    }
}

async fn install_node_windows(
    app: &tauri::AppHandle,
    install_id: &str,
    platform: &PlatformInfo,
) -> bool {
    // Tier 1: winget (no admin for user-scope)
    if platform.has_winget {
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "Installing Node.js via winget...",
        );
        let result = run_command_streamed(
            app,
            install_id,
            &SetupTarget::Node,
            "winget",
            &[
                "install",
                "OpenJS.NodeJS.LTS",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ],
        )
        .await;

        if result.success {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "completed",
                Some(100),
                None,
                None,
            );
            return true;
        }
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "winget install failed, trying direct download...",
        );
    }

    // Tier 2: Download MSI from nodejs.org
    let node_version = get_node_lts_version().await;
    let arch_label = if platform.arch == "arm64" {
        "arm64"
    } else {
        "x64"
    };
    let url = format!(
        "https://nodejs.org/dist/v{}/node-v{}-{}.msi",
        node_version, node_version, arch_label
    );

    match download_file(
        app,
        install_id,
        &SetupTarget::Node,
        &url,
        "node-installer.msi",
    )
    .await
    {
        Ok(msi_path) => {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "installing",
                Some(80),
                None,
                None,
            );
            emit_output(
                app,
                install_id,
                &SetupTarget::Node,
                "Running Node.js installer...",
            );

            let msi_str = msi_path.to_string_lossy().to_string();
            let result = run_command_streamed(
                app,
                install_id,
                &SetupTarget::Node,
                "msiexec",
                &["/i", &msi_str, "/qn", "/norestart"],
            )
            .await;

            let _ = tokio::fs::remove_file(&msi_path).await;

            if result.success {
                emit_status(
                    app,
                    install_id,
                    &SetupTarget::Node,
                    "completed",
                    Some(100),
                    None,
                    None,
                );
                return true;
            }

            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "failed",
                None,
                Some(
                    "MSI install failed. You may need to run as administrator, or install manually."
                        .into(),
                ),
                Some("winget install OpenJS.NodeJS.LTS --silent".into()),
            );
            false
        }
        Err(e) => {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "failed",
                None,
                Some(format!("Download failed: {e}")),
                Some("winget install OpenJS.NodeJS.LTS --silent".into()),
            );
            false
        }
    }
}

async fn install_node_macos(
    app: &tauri::AppHandle,
    install_id: &str,
    platform: &PlatformInfo,
) -> bool {
    // Tier 1: brew (no sudo needed)
    if platform.has_brew {
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "Installing Node.js via Homebrew...",
        );
        let result = run_command_streamed(
            app,
            install_id,
            &SetupTarget::Node,
            "brew",
            &["install", "node"],
        )
        .await;

        if result.success {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "completed",
                Some(100),
                None,
                None,
            );
            return true;
        }
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "brew install failed, trying direct download...",
        );
    }

    // Tier 2: Download .pkg from nodejs.org
    let node_version = get_node_lts_version().await;
    let arch_label = if platform.arch == "arm64" {
        "arm64"
    } else {
        "x64"
    };
    let url = format!(
        "https://nodejs.org/dist/v{}/node-v{}-darwin-{}.pkg",
        node_version, node_version, arch_label
    );

    match download_file(
        app,
        install_id,
        &SetupTarget::Node,
        &url,
        "node-installer.pkg",
    )
    .await
    {
        Ok(pkg_path) => {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "installing",
                Some(80),
                None,
                None,
            );
            emit_output(
                app,
                install_id,
                &SetupTarget::Node,
                "Running Node.js installer (may require password)...",
            );

            let pkg_str = pkg_path.to_string_lossy().to_string();
            let result = run_command_streamed(
                app,
                install_id,
                &SetupTarget::Node,
                "sudo",
                &["installer", "-pkg", &pkg_str, "-target", "/"],
            )
            .await;

            let _ = tokio::fs::remove_file(&pkg_path).await;

            if result.success {
                emit_status(
                    app,
                    install_id,
                    &SetupTarget::Node,
                    "completed",
                    Some(100),
                    None,
                    None,
                );
                return true;
            }

            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "failed",
                None,
                Some("Package installer failed.".into()),
                Some("brew install node".into()),
            );
            false
        }
        Err(e) => {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "failed",
                None,
                Some(format!("Download failed: {e}")),
                Some("brew install node".into()),
            );
            false
        }
    }
}

async fn install_node_linux(
    app: &tauri::AppHandle,
    install_id: &str,
    platform: &PlatformInfo,
) -> bool {
    if platform.has_apt {
        // Tier 1: NodeSource setup + apt install
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "Setting up NodeSource repository...",
        );

        let setup_result = run_command_streamed(
            app,
            install_id,
            &SetupTarget::Node,
            "bash",
            &[
                "-c",
                "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -",
            ],
        )
        .await;

        if setup_result.success {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "installing",
                Some(60),
                None,
                None,
            );
            let result = run_command_streamed(
                app,
                install_id,
                &SetupTarget::Node,
                "sudo",
                &["apt-get", "install", "-y", "nodejs"],
            )
            .await;

            if result.success {
                emit_status(
                    app,
                    install_id,
                    &SetupTarget::Node,
                    "completed",
                    Some(100),
                    None,
                    None,
                );
                return true;
            }
        }

        // Tier 2: plain apt fallback
        emit_output(
            app,
            install_id,
            &SetupTarget::Node,
            "Trying system package manager...",
        );
        let result = run_command_streamed(
            app,
            install_id,
            &SetupTarget::Node,
            "sudo",
            &["apt-get", "install", "-y", "nodejs", "npm"],
        )
        .await;

        if result.success {
            emit_status(
                app,
                install_id,
                &SetupTarget::Node,
                "completed",
                Some(100),
                None,
                None,
            );
            return true;
        }
    }

    emit_status(
        app,
        install_id,
        &SetupTarget::Node,
        "failed",
        None,
        Some("Automatic install failed. You may need sudo access.".into()),
        Some("sudo apt-get install -y nodejs npm".into()),
    );
    false
}

// ── Claude CLI installation ─────────────────────────────────────

async fn install_claude_cli(
    app: &tauri::AppHandle,
    install_id: &str,
    _platform: &PlatformInfo,
) -> bool {
    // Already installed?
    let cli_candidates: &[&str] = if cfg!(target_os = "windows") {
        &["claude", "claude.cmd", "claude.exe", "claude-code"]
    } else {
        &["claude", "claude-code"]
    };

    for candidate in cli_candidates {
        if command_version(candidate).is_ok() {
            emit_output(
                app,
                install_id,
                &SetupTarget::ClaudeCli,
                "Claude CLI is already installed.",
            );
            emit_status(
                app,
                install_id,
                &SetupTarget::ClaudeCli,
                "completed",
                Some(100),
                None,
                None,
            );
            return true;
        }
    }

    emit_status(
        app,
        install_id,
        &SetupTarget::ClaudeCli,
        "installing",
        Some(0),
        None,
        None,
    );
    emit_output(
        app,
        install_id,
        &SetupTarget::ClaudeCli,
        "Installing Claude Code CLI via npm...",
    );

    let npm_cmd = if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    };

    let result = run_command_streamed(
        app,
        install_id,
        &SetupTarget::ClaudeCli,
        npm_cmd,
        &["install", "-g", "@anthropic-ai/claude-code"],
    )
    .await;

    if result.success {
        emit_status(
            app,
            install_id,
            &SetupTarget::ClaudeCli,
            "completed",
            Some(100),
            None,
            None,
        );
        true
    } else {
        emit_status(
            app,
            install_id,
            &SetupTarget::ClaudeCli,
            "failed",
            None,
            Some(
                "npm install failed. Check your network connection and Node.js installation."
                    .into(),
            ),
            Some("npm install -g @anthropic-ai/claude-code".into()),
        );
        false
    }
}

// ── Install orchestrator ────────────────────────────────────────

enum InstallScope {
    NodeOnly,
    ClaudeCliOnly,
    All,
}

struct SetupRunParams {
    app: tauri::AppHandle,
    install_id: String,
    scope: InstallScope,
    cancelled: Arc<Mutex<bool>>,
}

async fn run_setup_install(params: SetupRunParams) {
    let SetupRunParams {
        app,
        install_id,
        scope,
        cancelled,
    } = params;

    let platform = detect_platform();
    tracing::info!(
        install_id = %install_id,
        platform = ?platform.platform,
        arch = platform.arch,
        "Starting setup install"
    );

    match scope {
        InstallScope::NodeOnly => {
            install_node(&app, &install_id, &platform).await;
        }
        InstallScope::ClaudeCliOnly => {
            install_claude_cli(&app, &install_id, &platform).await;
        }
        InstallScope::All => {
            let node_ok = install_node(&app, &install_id, &platform).await;

            // Check cancellation between steps
            if *cancelled.lock().unwrap() {
                tracing::info!(install_id = %install_id, "Setup install cancelled");
                return;
            }

            if node_ok {
                // Brief delay for PATH propagation (especially on Windows)
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                install_claude_cli(&app, &install_id, &platform).await;
            } else {
                // Node failed — report claude_cli as failed too since it depends on node
                emit_status(
                    &app,
                    &install_id,
                    &SetupTarget::ClaudeCli,
                    "failed",
                    None,
                    Some("Cannot install Claude CLI without Node.js. Fix Node.js installation first.".into()),
                    Some("npm install -g @anthropic-ai/claude-code".into()),
                );
            }
        }
    }
}

// ── Tauri commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn start_setup_install(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    target: String,
) -> Result<serde_json::Value, AppError> {
    let scope = match target.as_str() {
        "node" => InstallScope::NodeOnly,
        "claude_cli" => InstallScope::ClaudeCliOnly,
        "all" => InstallScope::All,
        _ => return Err(AppError::Validation(format!("Invalid target: {target}"))),
    };

    let install_id = uuid::Uuid::new_v4().to_string();
    let cancelled = state.active_setup_cancelled.clone();

    // Reset cancellation flag
    {
        let mut guard = cancelled.lock().unwrap();
        *guard = false;
    }

    let id_clone = install_id.clone();
    tokio::spawn(async move {
        run_setup_install(SetupRunParams {
            app,
            install_id: id_clone,
            scope,
            cancelled,
        })
        .await;
    });

    Ok(serde_json::json!({ "install_id": install_id }))
}

#[tauri::command]
pub fn cancel_setup_install(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    let mut guard = state.active_setup_cancelled.lock().unwrap();
    *guard = true;
    Ok(())
}
