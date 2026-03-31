use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use chrono::Utc;
use serde::Deserialize;
use tauri::State;

use crate::db::models::{ArtistAsset, BlenderMcpStatus};
use crate::db::repos::resources::artist as repo;
use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "svg", "bmp", "gif", "tiff"];
const MODEL_EXTENSIONS: &[&str] = &["glb", "gltf", "obj", "fbx", "stl", "blend", "3ds", "ply"];

// ---------------------------------------------------------------------------
// Blender detection & MCP management
// ---------------------------------------------------------------------------

/// Check if Blender is installed and get its version and path.
#[tauri::command]
pub fn artist_check_blender() -> Result<BlenderMcpStatus, AppError> {
    let blender_path = find_blender_path();

    let (installed, version, path_str) = match &blender_path {
        Some(p) => {
            let version = get_blender_version(p).ok();
            (true, version, Some(p.to_string_lossy().to_string()))
        }
        None => (false, None, None),
    };

    // Check if blender-mcp is installed (via pip/uvx)
    let mcp_installed = check_blender_mcp_installed();

    Ok(BlenderMcpStatus {
        installed,
        blender_path: path_str,
        blender_version: version,
        mcp_installed,
        mcp_running: false,
        session_id: None,
    })
}

/// Install the Blender MCP server package via pip.
#[tauri::command]
pub fn artist_install_blender_mcp() -> Result<String, AppError> {
    // Try uvx first, fall back to pip
    let result = run_silent(&["uvx", "install", "blender-mcp"])
        .or_else(|_| run_silent(&["pip", "install", "blender-mcp"]))
        .or_else(|_| run_silent(&["pip3", "install", "blender-mcp"]));

    match result {
        Ok(output) => Ok(output),
        Err(e) => Err(AppError::Execution(format!(
            "Failed to install blender-mcp. Ensure pip or uvx is available: {e}"
        ))),
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
    repo::list_assets(&pool, asset_type.as_deref())
}

/// Import a scanned asset into the database.
#[tauri::command]
pub fn artist_import_asset(
    state: State<'_, Arc<AppState>>,
    asset: ArtistAsset,
) -> Result<ArtistAsset, AppError> {
    let pool = &state.db;
    repo::insert_asset(&pool, &asset)
}

/// Delete an asset from the database.
#[tauri::command]
pub fn artist_delete_asset(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    let pool = &state.db;
    repo::delete_asset(&pool, &id)
}

/// Update tags on an asset.
#[tauri::command]
pub fn artist_update_tags(
    state: State<'_, Arc<AppState>>,
    id: String,
    tags: String,
) -> Result<ArtistAsset, AppError> {
    let pool = &state.db;
    repo::update_asset_tags(&pool, &id, &tags)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn find_blender_path() -> Option<PathBuf> {
    // Try common locations
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
                return Some(p);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let p = PathBuf::from("/Applications/Blender.app/Contents/MacOS/Blender");
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Try which
        if let Ok(output) = Command::new("which").arg("blender").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }
    // Fallback: try PATH
    if let Ok(output) = Command::new("blender").arg("--version").output() {
        if output.status.success() {
            return Some(PathBuf::from("blender"));
        }
    }
    None
}

fn get_blender_version(blender_path: &Path) -> Result<String, AppError> {
    let mut cmd = Command::new(blender_path);
    cmd.args(["--version"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = cmd.output().map_err(|e| AppError::ProcessSpawn(e.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // First line is typically "Blender X.Y.Z"
    let version = stdout.lines().next().unwrap_or("").trim().to_string();
    Ok(version)
}

fn check_blender_mcp_installed() -> bool {
    let result = Command::new("pip")
        .args(["show", "blender-mcp"])
        .output();
    if let Ok(output) = result {
        if output.status.success() {
            return true;
        }
    }
    // Try pip3
    let result = Command::new("pip3")
        .args(["show", "blender-mcp"])
        .output();
    matches!(result, Ok(output) if output.status.success())
}

fn run_silent(args: &[&str]) -> Result<String, AppError> {
    if args.is_empty() {
        return Err(AppError::Execution("Empty command".into()));
    }
    let mut cmd = Command::new(args[0]);
    cmd.args(&args[1..]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().map_err(|e| AppError::ProcessSpawn(e.to_string()))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(AppError::Execution(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

fn scan_dir_recursive(dir: &Path, assets: &mut Vec<ArtistAsset>) -> Result<(), AppError> {
    let entries = std::fs::read_dir(dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_recursive(&path, assets)?;
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            let asset_type = if IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
                "2d"
            } else if MODEL_EXTENSIONS.contains(&ext_lower.as_str()) {
                "3d"
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
