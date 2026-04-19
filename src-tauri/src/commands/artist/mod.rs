pub mod ffmpeg;
pub mod persistence;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command as TokioCommand;

use chrono::Utc;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::models::{ArtistAsset, BlenderMcpStatus};
use crate::db::repos::resources::artist as repo;
use crate::engine::event_registry::event_name;
use crate::engine::parser::parse_stream_line;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Background job state for creative sessions
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct CreativeSessionExtra;

static CREATIVE_JOBS: BackgroundJobManager<CreativeSessionExtra> = BackgroundJobManager::new(
    "creative-session lock poisoned",
    event_name::ARTIST_SESSION_STATUS,
    event_name::ARTIST_SESSION_OUTPUT,
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "svg", "bmp", "gif", "tiff"];
const MODEL_EXTENSIONS: &[&str] = &["glb", "gltf", "obj", "fbx", "stl", "blend", "3ds", "ply"];

// ---------------------------------------------------------------------------
// Blender detection & MCP management
// ---------------------------------------------------------------------------

/// Check if Blender is installed and get its version and path.
///
/// Fully async — all subprocess spawns use tokio so the IPC worker thread
/// is never blocked. Blender + MCP checks run concurrently.
#[tauri::command]
pub async fn artist_check_blender() -> Result<BlenderMcpStatus, AppError> {
    let (blender, mcp_installed) = tokio::join!(
        detect_blender_async(),
        check_blender_mcp_installed_async(),
    );

    let (installed, version, path_str) = match blender {
        Some((path, ver)) => (true, ver, Some(path.to_string_lossy().to_string())),
        None => (false, None, None),
    };

    Ok(BlenderMcpStatus {
        installed,
        blender_path: path_str,
        blender_version: version,
        mcp_installed,
        mcp_running: false,
        session_id: None,
    })
}

/// Probe common Blender install locations and return `(path, version)` if found.
///
/// Never blocks — uses `tokio::process::Command`. Existence checks are cheap
/// filesystem syscalls that we keep synchronous.
async fn detect_blender_async() -> Option<(PathBuf, Option<String>)> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
            r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
        ];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                let ver = get_blender_version_async(&p).await.ok();
                return Some((p, ver));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let p = PathBuf::from("/Applications/Blender.app/Contents/MacOS/Blender");
        if p.exists() {
            let ver = get_blender_version_async(&p).await.ok();
            return Some((p, ver));
        }
    }

    // Fallback: try PATH via `blender --version`
    let mut cmd = TokioCommand::new("blender");
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    if let Ok(output) = cmd.output().await {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let ver = stdout.lines().next().map(|l| l.trim().to_string());
            return Some((PathBuf::from("blender"), ver));
        }
    }
    None
}

async fn get_blender_version_async(blender_path: &Path) -> Result<String, AppError> {
    let mut cmd = TokioCommand::new(blender_path);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(e.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().next().unwrap_or("").trim().to_string())
}

async fn check_blender_mcp_installed_async() -> bool {
    for bin in &["pip", "pip3"] {
        let mut cmd = TokioCommand::new(bin);
        cmd.args(["show", "blender-mcp"]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        if let Ok(output) = cmd.output().await {
            if output.status.success() {
                return true;
            }
        }
    }
    false
}

/// Install the Blender MCP server package via pip. Fully async.
#[tauri::command]
pub async fn artist_install_blender_mcp() -> Result<String, AppError> {
    for args in [
        &["uvx", "install", "blender-mcp"][..],
        &["pip", "install", "blender-mcp"][..],
        &["pip3", "install", "blender-mcp"][..],
    ] {
        match run_silent_async(args).await {
            Ok(output) => return Ok(output),
            Err(_) => continue,
        }
    }
    Err(AppError::Execution(
        "Failed to install blender-mcp. Ensure pip or uvx is available.".into(),
    ))
}

async fn run_silent_async(args: &[&str]) -> Result<String, AppError> {
    if args.is_empty() {
        return Err(AppError::Execution("Empty command".into()));
    }
    let mut cmd = TokioCommand::new(args[0]);
    cmd.args(&args[1..]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(e.to_string()))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(AppError::Execution(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Asset management
// ---------------------------------------------------------------------------

/// Scan a directory for artist assets (images and 3D models).
#[tauri::command]
pub fn artist_scan_folder(folder: String) -> Result<Vec<ArtistAsset>, AppError> {
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("Directory not found: {folder}")));
    }

    let mut assets = Vec::new();
    scan_dir_recursive(dir, &mut assets)?;
    Ok(assets)
}

/// List assets from the database, optionally filtered by type ("2d" or "3d").
#[tauri::command]
pub fn artist_list_assets(
    state: State<'_, Arc<AppState>>,
    asset_type: Option<String>,
) -> Result<Vec<ArtistAsset>, AppError> {
    let pool = &state.db;
    repo::list_assets(pool, asset_type.as_deref())
}

/// Import a scanned asset into the database. Returns null if already exists.
#[tauri::command]
pub fn artist_import_asset(
    state: State<'_, Arc<AppState>>,
    asset: ArtistAsset,
) -> Result<Option<ArtistAsset>, AppError> {
    let pool = &state.db;
    repo::insert_asset(pool, &asset)
}

/// Delete an asset from the database.
#[tauri::command]
pub fn artist_delete_asset(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    let pool = &state.db;
    repo::delete_asset(pool, &id)
}

/// Update tags on an asset.
#[tauri::command]
pub fn artist_update_tags(
    state: State<'_, Arc<AppState>>,
    id: String,
    tags: String,
) -> Result<ArtistAsset, AppError> {
    let pool = &state.db;
    repo::update_asset_tags(pool, &id, &tags)
}

/// Get the default artist folder path (~/Personas/Artist).
#[tauri::command]
pub fn artist_get_default_folder() -> Result<String, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Internal("Cannot determine home directory".into()))?;
    let folder = home.join("Personas").join("Artist");
    Ok(folder.to_string_lossy().to_string())
}

/// Ensure the artist folder structure exists (~/Personas/Artist/2d and 3d).
#[tauri::command]
pub fn artist_ensure_folders(folder: String) -> Result<(), AppError> {
    let base = Path::new(&folder);
    std::fs::create_dir_all(base.join("2d"))?;
    std::fs::create_dir_all(base.join("3d"))?;
    Ok(())
}

/// Read a local image file and return it as a base64 data URL.
/// Used by the gallery to render images without needing the asset protocol.
#[tauri::command]
pub fn artist_read_image_base64(file_path: String) -> Result<String, AppError> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine as _;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::NotFound(format!("File not found: {file_path}")));
    }

    let bytes = std::fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = mime_from_ext(&ext);
    let b64 = B64.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

// ---------------------------------------------------------------------------
// Creative Session — CLI-backed background execution
// ---------------------------------------------------------------------------

/// Run a creative session prompt through Claude CLI with streaming output.
/// Supports Blender MCP, image generation, and general creative tasks.
#[tauri::command]
pub async fn artist_run_creative_session(
    app: tauri::AppHandle,
    session_id: String,
    user_prompt: String,
    tools: Vec<String>,
    output_folder: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let cancel_token = CancellationToken::new();
    CREATIVE_JOBS.insert_running(session_id.clone(), cancel_token.clone(), CreativeSessionExtra)?;
    CREATIVE_JOBS.set_status(&app, &session_id, "running", None);

    let app_handle = app.clone();
    let sid = session_id.clone();
    let token = cancel_token;

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token.cancelled() => {
                Err(AppError::Internal("Creative session cancelled by user".into()))
            }
            res = run_creative_cli(&app_handle, &sid, &user_prompt, &tools, output_folder.as_deref()) => res
        };

        match result {
            Ok(line_count) => {
                CREATIVE_JOBS.set_status(&app_handle, &sid, "completed", None);
                let _ = app_handle.emit(
                    event_name::ARTIST_SESSION_COMPLETE,
                    json!({ "session_id": sid, "output_lines": line_count }),
                );
                crate::notifications::send(
                    &app_handle,
                    "Creative Session Complete",
                    &format!("Session finished with {line_count} output lines."),
                );
            }
            Err(e) => {
                let msg = e.to_string();
                CREATIVE_JOBS.set_status(&app_handle, &sid, "failed", Some(msg));
            }
        }
    });

    Ok(json!({ "session_id": session_id }))
}

/// Cancel a running creative session.
#[tauri::command]
pub async fn artist_cancel_creative_session(
    session_id: String,
    app: tauri::AppHandle,
) -> Result<bool, AppError> {
    if let Some(token) = CREATIVE_JOBS.get_cancel_token(&session_id)? {
        token.cancel();
        CREATIVE_JOBS.set_status(&app, &session_id, "cancelled", None);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Core CLI execution for creative sessions.
async fn run_creative_cli(
    app: &tauri::AppHandle,
    session_id: &str,
    user_prompt: &str,
    tools: &[String],
    output_folder: Option<&str>,
) -> Result<i32, AppError> {
    use std::io::Write as _;

    CREATIVE_JOBS.emit_line(app, session_id, "[Creative] Starting session...".to_string());

    let has_blender = tools.contains(&"blender".to_string());
    let has_leonardo = tools.contains(&"leonardo_ai".to_string());
    let has_gemini = tools.contains(&"gemini".to_string());

    // Build system prompt that enables creative tool usage
    let mut system_parts = vec![
        "You are a creative assistant specializing in visual art and 3D content creation.".to_string(),
    ];
    if has_blender {
        system_parts.push(
            "You have the Blender MCP server connected. Use the mcp__blender__* tools to create, modify, and render 3D scenes and models directly in Blender. Always prefer using these MCP tools over writing scripts.".to_string(),
        );
    }
    if has_leonardo {
        system_parts.push(
            "You have access to Leonardo AI for image generation.".to_string(),
        );
    }
    if has_gemini {
        system_parts.push(
            "You have access to Gemini AI for vision analysis and image understanding.".to_string(),
        );
    }

    // Instruct the CLI to save all generated files to the artist output folder
    if let Some(folder) = output_folder {
        system_parts.push(format!(
            "IMPORTANT: Save ALL generated files (images, 3D models, renders) into the directory: {folder}\n\
             Create subdirectories 2d/ for images and 3d/ for 3D models if they don't exist. \
             Always use absolute paths when saving files."
        ));
    }

    let full_prompt = format!(
        "{}\n\n## User Request\n{}\n\nExecute the creative task. Describe what you create step by step.",
        system_parts.join("\n"),
        user_prompt,
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    // -- MCP config: wire up Blender MCP server so the CLI has real tools --
    // Keep the temp file alive for the entire function scope.
    let _mcp_config_file: Option<tempfile::NamedTempFile> = if has_blender {
        let mcp_config = json!({
            "mcpServers": {
                "blender": {
                    "command": "uvx",
                    "args": ["blender-mcp"],
                    "type": "stdio"
                }
            }
        });
        let mut tmp = tempfile::NamedTempFile::new()
            .map_err(|e| AppError::Internal(format!("Failed to create MCP config temp file: {e}")))?;
        tmp.write_all(serde_json::to_string_pretty(&mcp_config)?.as_bytes())
            .map_err(|e| AppError::Internal(format!("Failed to write MCP config: {e}")))?;
        tmp.flush()
            .map_err(|e| AppError::Internal(format!("Failed to flush MCP config: {e}")))?;

        cli_args.args.push("--mcp-config".to_string());
        cli_args.args.push(tmp.path().to_string_lossy().to_string());

        CREATIVE_JOBS.emit_line(
            app,
            session_id,
            format!("[Creative] Blender MCP config: {}", tmp.path().display()),
        );
        Some(tmp)
    } else {
        None
    };

    let mut cmd = tokio::process::Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    CREATIVE_JOBS.emit_line(app, session_id, "[Creative] CLI started. Processing...".to_string());

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = full_prompt.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt_bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    // Drain stderr
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = String::new();
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut reader, &mut buf).await;
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();
    let mut output_lines = 0i32;

    let timeout_duration = std::time::Duration::from_secs(600);
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                output_lines += 1;
                CREATIVE_JOBS.emit_line(app, session_id, trimmed.to_string());
            } else {
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::AssistantToolUse {
                        tool_name,
                        input_preview,
                    } => {
                        let preview = &input_preview[..input_preview.len().min(120)];
                        CREATIVE_JOBS.emit_line(
                            app,
                            session_id,
                            format!("[Tool] {tool_name}: {preview}"),
                        );
                        output_lines += 1;
                    }
                    StreamLineType::Result { .. } => {
                        CREATIVE_JOBS.emit_line(
                            app,
                            session_id,
                            "[Creative] Session complete.".to_string(),
                        );
                    }
                    _ => {}
                }
            }
        }
    })
    .await;

    let _ = child.wait().await;

    if stream_result.is_err() {
        return Err(AppError::Internal(
            "Creative session timed out after 10 minutes".into(),
        ));
    }

    CREATIVE_JOBS.emit_line(
        app,
        session_id,
        format!("[Complete] Session finished with {output_lines} output lines"),
    );

    Ok(output_lines)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn scan_dir_recursive(dir: &Path, assets: &mut Vec<ArtistAsset>) -> Result<(), AppError> {
    let entries = std::fs::read_dir(dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_recursive(&path, assets)?;
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();

            // Determine asset type: use parent folder name as hint.
            // Files under a "3d" folder are 3D assets (including renders).
            // Files under a "2d" folder are 2D assets.
            // Otherwise fall back to extension-based classification.
            let in_3d_folder = path.ancestors().any(|a| {
                a.file_name().and_then(|n| n.to_str()).map(|n| n == "3d").unwrap_or(false)
            });
            let in_2d_folder = path.ancestors().any(|a| {
                a.file_name().and_then(|n| n.to_str()).map(|n| n == "2d").unwrap_or(false)
            });

            let asset_type = if in_3d_folder {
                // Everything in 3d/ folder is a 3D asset (models + renders)
                "3d"
            } else if in_2d_folder {
                "2d"
            } else if MODEL_EXTENSIONS.contains(&ext_lower.as_str()) {
                "3d"
            } else if IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
                "2d"
            } else {
                continue;
            };

            let metadata = std::fs::metadata(&path).ok();
            let file_size = metadata.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let file_name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            assets.push(ArtistAsset {
                id: uuid::Uuid::new_v4().to_string(),
                file_name,
                file_path: path.to_string_lossy().to_string(),
                asset_type: asset_type.to_string(),
                mime_type: Some(mime_from_ext(&ext_lower)),
                file_size,
                width: None,
                height: None,
                thumbnail_path: None,
                tags: None,
                source: Some("scan".to_string()),
                created_at: Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
            });
        }
    }
    Ok(())
}

fn mime_from_ext(ext: &str) -> String {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "obj" => "model/obj",
        "fbx" => "model/fbx",
        "stl" => "model/stl",
        "blend" => "application/x-blender",
        "3ds" => "model/3ds",
        "ply" => "model/ply",
        _ => "application/octet-stream",
    }
    .to_string()
}
