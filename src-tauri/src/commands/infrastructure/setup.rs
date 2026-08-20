use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::{FutureExt, StreamExt};
use serde::Serialize;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Extract a printable message from a panic payload returned by `catch_unwind`.
/// Mirrors the canonical pattern at `commands/execution/lab.rs::extract_panic_message`.
fn extract_panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&str>() {
        return s.to_string();
    }
    if let Some(s) = panic.downcast_ref::<String>() {
        return s.clone();
    }
    "unknown panic".to_string()
}

// Re-use the PATH probe helpers from system.rs
use super::system::{command_exists_in_path, command_version};

const SETUP_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20 * 60);

// -- Event payloads ----------------------------------------------

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

// -- Platform detection ------------------------------------------

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

// -- Emit helpers ------------------------------------------------

fn emit_output(app: &tauri::AppHandle, install_id: &str, target: &SetupTarget, line: &str) {
    let _ = app.emit(
        event_name::SETUP_OUTPUT,
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
        event_name::SETUP_STATUS,
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

// -- Cancellation helper -----------------------------------------

/// Poll an AtomicBool flag every 200ms, returning when it becomes `true`.
async fn poll_cancelled(flag: &AtomicBool) {
    loop {
        if flag.load(Ordering::Acquire) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

// -- Command runner ----------------------------------------------

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
    cancelled: &Arc<AtomicBool>,
) -> CommandResult {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Defense-in-depth: the explicit kill on cancellation below covers the
        // common path, but if the parent task is ever cancelled via
        // JoinHandle::abort while a child is stuck, kill_on_drop ensures the
        // OS process is reaped instead of leaking.
        .kill_on_drop(true);

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

    let child_pid = child.id();

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

    // Race child completion against cancellation flag
    tokio::select! {
        result = child.wait() => {
            match result {
                Ok(exit) => CommandResult { success: exit.success() },
                Err(_) => CommandResult { success: false },
            }
        }
        _ = tokio::time::sleep(SETUP_COMMAND_TIMEOUT) => {
            if let Some(pid) = child_pid {
                crate::engine::kill_process(pid);
            } else {
                let _ = child.kill().await;
            }
            emit_output(app, install_id, target, "Installation command timed out.");
            CommandResult { success: false }
        }
        _ = poll_cancelled(cancelled) => {
            if let Some(pid) = child_pid {
                crate::engine::kill_process(pid);
            } else {
                let _ = child.kill().await;
            }
            emit_output(app, install_id, target, "Installation cancelled.");
            CommandResult { success: false }
        }
    }
}

// -- HTTP download with progress ---------------------------------

async fn download_file(
    app: &tauri::AppHandle,
    install_id: &str,
    target: &SetupTarget,
    url: &str,
    filename: &str,
    cancelled: &Arc<AtomicBool>,
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
        if cancelled.load(Ordering::Acquire) {
            emit_output(app, install_id, target, "Download cancelled.");
            return Err("Cancelled".into());
        }
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

// -- Node.js LTS version lookup ----------------------------------

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
        if v.get("lts").and_then(|l| l.as_str()).is_some() {
            if let Some(version) = v.get("version").and_then(|v| v.as_str()) {
                return version.trim_start_matches('v').to_string();
            }
        }
    }

    FALLBACK_NODE_VERSION.to_string()
}

// -- Node.js installation ----------------------------------------

async fn install_node(
    app: &tauri::AppHandle,
    install_id: &str,
    platform: &PlatformInfo,
    cancelled: &Arc<AtomicBool>,
) -> bool {
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
        Platform::Windows => install_node_windows(app, install_id, platform, cancelled).await,
        Platform::MacOS => install_node_macos(app, install_id, platform, cancelled).await,
        Platform::Linux => install_node_linux(app, install_id, platform, cancelled).await,
    }
}

async fn install_node_windows(
    app: &tauri::AppHandle,
    install_id: &str,
    platform: &PlatformInfo,
    cancelled: &Arc<AtomicBool>,
) -> bool {
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
            cancelled,
        )
        .await;
        if cancelled.load(Ordering::Acquire) {
            return false;
        }
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

    let node_version = get_node_lts_version().await;
    let arch_label = if platform.arch == "arm64" {
        "arm64"
    } else {
        "x64"
    };
    let url =
        format!("https://nodejs.org/dist/v{node_version}/node-v{node_version}-{arch_label}.msi");

    match download_file(
        app,
        install_id,
        &SetupTarget::Node,
        &url,
        "node-installer.msi",
        cancelled,
    )
    .await
    {
        Ok(msi_path) => {
            if cancelled.load(Ordering::Acquire) {
                return false;
            }
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
                cancelled,
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
            emit_status(app, install_id, &SetupTarget::Node, "failed", None, Some("MSI install failed. You may need to run as administrator, or install manually.".into()), Some("winget install OpenJS.NodeJS.LTS --silent".into()));
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
    cancelled: &Arc<AtomicBool>,
) -> bool {
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
            cancelled,
        )
        .await;
        if cancelled.load(Ordering::Acquire) {
            return false;
        }
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

    let node_version = get_node_lts_version().await;
    let arch_label = if platform.arch == "arm64" {
        "arm64"
    } else {
        "x64"
    };
    let url = format!(
        "https://nodejs.org/dist/v{node_version}/node-v{node_version}-darwin-{arch_label}.pkg"
    );

    match download_file(
        app,
        install_id,
        &SetupTarget::Node,
        &url,
        "node-installer.pkg",
        cancelled,
    )
    .await
    {
        Ok(pkg_path) => {
            if cancelled.load(Ordering::Acquire) {
                return false;
            }
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
                cancelled,
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
    cancelled: &Arc<AtomicBool>,
) -> bool {
    if platform.has_apt {
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
            cancelled,
        )
        .await;
        if cancelled.load(Ordering::Acquire) {
            return false;
        }
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
                cancelled,
            )
            .await;
            if cancelled.load(Ordering::Acquire) {
                return false;
            }
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
            cancelled,
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

// -- Claude CLI installation -------------------------------------

async fn install_claude_cli(
    app: &tauri::AppHandle,
    install_id: &str,
    _platform: &PlatformInfo,
    cancelled: &Arc<AtomicBool>,
) -> bool {
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
        cancelled,
    )
    .await;

    if cancelled.load(Ordering::Acquire) {
        return false;
    }
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

// -- Install orchestrator ----------------------------------------

enum InstallScope {
    NodeOnly,
    ClaudeCliOnly,
    All,
}

struct SetupRunParams {
    app: tauri::AppHandle,
    install_id: String,
    scope: InstallScope,
    cancelled: Arc<AtomicBool>,
}

async fn run_setup_install(params: SetupRunParams) {
    let SetupRunParams {
        app,
        install_id,
        scope,
        cancelled,
    } = params;

    let platform = detect_platform();
    tracing::info!(install_id = %install_id, platform = ?platform.platform, arch = platform.arch, "Starting setup install");

    match scope {
        InstallScope::NodeOnly => {
            install_node(&app, &install_id, &platform, &cancelled).await;
        }
        InstallScope::ClaudeCliOnly => {
            install_claude_cli(&app, &install_id, &platform, &cancelled).await;
        }
        InstallScope::All => {
            let node_ok = install_node(&app, &install_id, &platform, &cancelled).await;
            if cancelled.load(Ordering::Acquire) {
                tracing::info!(install_id = %install_id, "Setup install cancelled");
                emit_status(
                    &app,
                    &install_id,
                    &SetupTarget::Node,
                    "cancelled",
                    None,
                    None,
                    None,
                );
                emit_status(
                    &app,
                    &install_id,
                    &SetupTarget::ClaudeCli,
                    "cancelled",
                    None,
                    None,
                    None,
                );
                return;
            }
            if node_ok {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                if cancelled.load(Ordering::Acquire) {
                    tracing::info!(install_id = %install_id, "Setup install cancelled during wait");
                    emit_status(
                        &app,
                        &install_id,
                        &SetupTarget::ClaudeCli,
                        "cancelled",
                        None,
                        None,
                        None,
                    );
                    return;
                }
                install_claude_cli(&app, &install_id, &platform, &cancelled).await;
            } else {
                emit_status(&app, &install_id, &SetupTarget::ClaudeCli, "failed", None, Some("Cannot install Claude CLI without Node.js. Fix Node.js installation first.".into()), Some("npm install -g @anthropic-ai/claude-code".into()));
            }
        }
    }

    // Emit final cancelled status if cancellation happened during the last install phase
    if cancelled.load(Ordering::Acquire) {
        tracing::info!(install_id = %install_id, "Setup install cancelled");
    }
}

// -- Tauri commands ----------------------------------------------

#[tauri::command]
pub async fn start_setup_install(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    target: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    let scope = match target.as_str() {
        "node" => InstallScope::NodeOnly,
        "claude_cli" => InstallScope::ClaudeCliOnly,
        "all" => InstallScope::All,
        _ => return Err(AppError::Validation(format!("Invalid target: {target}"))),
    };

    let install_id = uuid::Uuid::new_v4().to_string();

    // Only one setup install runs at a time. `try_begin` is an atomic
    // check-and-install ("is a run live?" + "install this id") under one
    // lock, so a double-click or a retry while an install is already running
    // is rejected outright instead of silently sharing the "current" slot a
    // second install used to be registered under — the previous fixed-key
    // registration let a second start's `RunGuard::drop` delete the FIRST
    // install's still-live registry entry (making it permanently
    // uncancelable), and let Cancel target whichever install happened to be
    // registered rather than the one the user actually meant to stop.
    if !state
        .process_registry
        .try_begin("setup", install_id.clone())
    {
        return Err(AppError::Validation(
            "A setup install is already in progress. Cancel it first or wait for it to complete."
                .into(),
        ));
    }

    // Multi-run registration keyed by THIS install's own id (not a shared
    // literal) so its cancellation flag / RunGuard cleanup can never collide
    // with a different install's entry. The guard ensures `unregister_run`
    // runs even if the task panics.
    let (cancelled, run_guard) = state
        .process_registry
        .register_run_guarded("setup", &install_id);

    let id_clone = install_id.clone();
    let app_for_panic = app.clone();
    let install_id_for_panic = install_id.clone();
    let install_id_for_cleanup = install_id.clone();
    let registry_for_cleanup = state.process_registry.clone();
    tokio::spawn(async move {
        let _guard = run_guard;
        let work = AssertUnwindSafe(run_setup_install(SetupRunParams {
            app,
            install_id: id_clone,
            scope,
            cancelled,
        }))
        .catch_unwind()
        .await;

        if let Err(panic) = work {
            let msg = extract_panic_message(panic);
            tracing::error!(
                install_id = %install_id_for_panic,
                panic = %msg,
                "setup install task panicked — marking install as failed"
            );
            emit_status(
                &app_for_panic,
                &install_id_for_panic,
                &SetupTarget::Node,
                "failed",
                None,
                Some(msg.clone()),
                None,
            );
            emit_status(
                &app_for_panic,
                &install_id_for_panic,
                &SetupTarget::ClaudeCli,
                "failed",
                None,
                Some(msg),
                None,
            );
        }

        // Release the single-install claim (only if it's still ours — a
        // fresh install could only have re-claimed "setup" after this one
        // cleared it, so `clear_id_if` is defensive, not load-bearing here).
        registry_for_cleanup.clear_id_if("setup", &install_id_for_cleanup);
    });

    Ok(serde_json::json!({ "install_id": install_id }))
}

#[tauri::command]
pub fn cancel_setup_install(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    // Resolve the CURRENTLY claimed install id rather than a fixed literal —
    // with the try_begin-guarded single-install claim above, at most one
    // install can be registered at a time, so this always targets the right
    // (only) run.
    if let Some(install_id) = state.process_registry.get_id("setup") {
        state.process_registry.cancel_run("setup", &install_id);
    }
    Ok(())
}

#[cfg(test)]
mod setup_install_slot_tests {
    // Regression pin for the fixed-literal-key bug: `start_setup_install`
    // used to register every install under `("setup", "current")`, so a
    // second concurrent install (double-click / retry) silently overwrote
    // the first's registry entry. This exercises the exact sequence the
    // command now uses — `try_begin` to reject a second concurrent install,
    // `register_run_guarded` keyed by the install's own id, and
    // `get_id`/`clear_id_if` for cancel/cleanup — without needing a full
    // Tauri `AppState`.
    use crate::ActiveProcessRegistry;
    use std::sync::Arc;

    #[test]
    fn second_concurrent_install_is_rejected_not_silently_shared() {
        let registry = Arc::new(ActiveProcessRegistry::new());
        let install_a = "install-a".to_string();
        let install_b = "install-b".to_string();

        // First install claims the "setup" slot.
        assert!(registry.try_begin("setup", install_a.clone()));
        // A second concurrent install must be rejected outright, not silently
        // installed over the first (the old bug: a fixed "current" key let
        // this succeed and clobber install A's guard).
        assert!(!registry.try_begin("setup", install_b.clone()));

        // Each install still gets its OWN multi-run guard entry, keyed by its
        // own id — the actual fix for the shared-slot bug.
        let (_flag_a, guard_a) = registry.register_run_guarded("setup", &install_a);
        assert!(registry.is_run_registered("setup", &install_a));
        assert!(!registry.is_run_registered("setup", &install_b));

        // cancel_setup_install resolves the CURRENT claim (install A) and
        // cancels precisely that run — not some unrelated "current" slot.
        let current = registry.get_id("setup");
        assert_eq!(current.as_deref(), Some(install_a.as_str()));
        registry.cancel_run("setup", &current.unwrap());

        // Install A's own cleanup (RunGuard drop + clear_id_if) releases the
        // slot — and ONLY install A's id can clear it; a mismatched id must
        // be a no-op (guards against a stale/late cleanup call stealing a
        // slot a different, newer install already claimed).
        registry.clear_id_if("setup", &install_b); // wrong id: no-op
        assert_eq!(
            registry.get_id("setup").as_deref(),
            Some(install_a.as_str())
        );
        drop(guard_a);
        assert!(!registry.is_run_registered("setup", &install_a));
        registry.clear_id_if("setup", &install_a); // right id: releases
        assert_eq!(registry.get_id("setup"), None);

        // The slot is now free for a genuinely new install.
        assert!(registry.try_begin("setup", "install-c".to_string()));
    }
}
