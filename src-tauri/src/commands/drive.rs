//! Drive plugin — managed local filesystem for agent exports.
//!
//! Provides a sandboxed directory (app_data_dir/drive in release, ./.dev-drive
//! at the repo root in debug) that agents and the Drive plugin UI share. All
//! path arguments are *relative to the managed root* — absolute paths and any
//! `..` traversal are rejected before touching disk. The root is canonicalised
//! once at startup and every incoming path is re-canonicalised before use, so
//! symlinks that escape the sandbox are also caught.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Cap on a single `drive_read` call. The UI previews text/images; bulk copies
/// should go through `drive_copy_*` which stream. Protects against OOM on a
/// pathologically large file.
const MAX_READ_BYTES: u64 = 50 * 1024 * 1024; // 50 MB

/// Cap on a single `drive_write` payload. Matches `MAX_READ_BYTES`.
const MAX_WRITE_BYTES: usize = 50 * 1024 * 1024;

/// Subdirectory under `app_data_dir` (release) where the managed drive lives.
const RELEASE_SUBDIR: &str = "drive";

/// Folder at the repo root where the dev drive lives. Should be gitignored.
const DEV_SUBDIR: &str = ".dev-drive";

/// Cached canonical managed root — resolved lazily on first call.
static MANAGED_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Return the cached managed root if [`managed_root`] has already been
/// resolved (at least one `drive_*` command has run this session). Lets
/// engine code (which doesn't hold an `AppHandle`) address the drive sandbox
/// without bootstrapping it from cwd/app_data_dir itself. Returns `None`
/// before the first call — callers must tolerate a missing drive.
pub(crate) fn cached_managed_root() -> Option<PathBuf> {
    MANAGED_ROOT.get().cloned()
}

/// Publish a `drive.document.*` event directly via the DB pool. Mirrors
/// [`emit_drive_event`] but without an `AppHandle`, so engine-side callers
/// (post-execution drive sync in `runner.rs`) can report file changes the
/// persona produced during a run. Best-effort — returns unit regardless of
/// DB outcome so a publish failure can't cancel the caller's happy path.
pub(crate) fn publish_drive_event_from_engine(
    pool: &crate::db::DbPool,
    event_type: &str,
    rel_path: &str,
    extra: Option<serde_json::Value>,
) {
    let name = std::path::Path::new(rel_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = std::path::Path::new(rel_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    let mut payload = serde_json::json!({
        "path": rel_path,
        "name": name,
        "extension": ext,
    });
    if let (Some(obj), Some(extra)) = (payload.as_object_mut(), extra) {
        if let Some(extra_obj) = extra.as_object() {
            for (k, v) in extra_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    let input = crate::db::models::CreatePersonaEventInput {
        event_type: event_type.to_string(),
        source_type: DRIVE_SOURCE_TYPE.to_string(),
        project_id: None,
        source_id: Some(rel_path.to_string()),
        target_persona_id: None,
        payload: serde_json::to_string(&payload).ok(),
        use_case_id: None,
    };

    if let Err(e) = crate::db::repos::communication::events::publish(pool, input) {
        tracing::warn!(
            event_type = %event_type,
            path = %rel_path,
            "publish_drive_event_from_engine failed: {}", e
        );
    }
}

/// Snapshot of one file under the managed drive — path relative to root,
/// last-modified time, and size. Used by the engine runner to detect which
/// files a persona execution actually produced.
#[derive(Debug, Clone)]
pub(crate) struct DriveSnapshotEntry {
    pub mtime_ms: i64,
    pub size: u64,
}

/// Walk the managed drive root and return a map of relative-path → entry.
/// Returns an empty map on any IO error — callers treat failures as
/// "no snapshot available" and skip diff emission.
pub(crate) fn snapshot_drive(root: &Path) -> std::collections::HashMap<String, DriveSnapshotEntry> {
    let mut out = std::collections::HashMap::new();
    walk_snapshot(root, root, &mut out);
    out
}

fn walk_snapshot(
    root: &Path,
    dir: &Path,
    out: &mut std::collections::HashMap<String, DriveSnapshotEntry>,
) {
    let iter = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in iter.flatten() {
        let path = entry.path();
        let ft = match entry.file_type() {
            Ok(f) => f,
            Err(_) => continue,
        };
        if ft.is_dir() {
            walk_snapshot(root, &path, out);
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let rel = to_relative_display(root, &path);
        // Skip OS clutter so snapshot diffs don't fire spurious events.
        let name = std::path::Path::new(&rel)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" {
            continue;
        }
        out.insert(
            rel,
            DriveSnapshotEntry {
                mtime_ms,
                size: meta.len(),
            },
        );
    }
}

/// Diff two snapshots and emit `drive.document.added` / `drive.document.edited`
/// / `drive.document.deleted` events for every file that changed. Uses
/// [`publish_drive_event_from_engine`] so the caller only needs a `DbPool`.
/// Rename detection is out of scope — a rename will surface as delete+add.
pub(crate) fn diff_and_emit_drive_events(
    pool: &crate::db::DbPool,
    before: &std::collections::HashMap<String, DriveSnapshotEntry>,
    after: &std::collections::HashMap<String, DriveSnapshotEntry>,
) -> usize {
    let mut emitted = 0usize;
    for (path, after_entry) in after {
        match before.get(path) {
            None => {
                publish_drive_event_from_engine(
                    pool,
                    drive_event::ADDED,
                    path,
                    Some(serde_json::json!({ "size": after_entry.size })),
                );
                emitted += 1;
            }
            Some(before_entry)
                if before_entry.mtime_ms != after_entry.mtime_ms
                    || before_entry.size != after_entry.size =>
            {
                publish_drive_event_from_engine(
                    pool,
                    drive_event::EDITED,
                    path,
                    Some(serde_json::json!({ "size": after_entry.size })),
                );
                emitted += 1;
            }
            _ => {}
        }
    }
    for path in before.keys() {
        if !after.contains_key(path) {
            publish_drive_event_from_engine(pool, drive_event::DELETED, path, None);
            emitted += 1;
        }
    }
    emitted
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DriveEntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveEntry {
    /// Basename (without parent directories).
    pub name: String,
    /// Path relative to the managed root, using forward slashes. "" for root.
    pub path: String,
    pub kind: DriveEntryKind,
    /// File size in bytes. 0 for folders (folder size is an explicit opt-in).
    pub size: u64,
    /// Last modified time, ISO-8601 UTC.
    pub modified: String,
    /// Best-effort mime type. None for folders.
    pub mime: Option<String>,
    /// Lowercase file extension without the dot. None for folders and
    /// extensionless files.
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveTreeNode {
    pub name: String,
    pub path: String,
    pub children: Vec<DriveTreeNode>,
    /// True when the folder has at least one subfolder that was not traversed
    /// (depth cap reached) — lets the UI show an expander.
    pub has_more_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DriveStorageInfo {
    /// Canonical absolute path of the managed root.
    pub root: String,
    /// Bytes used inside the managed root.
    pub used_bytes: u64,
    /// Total file+folder count inside the managed root.
    pub entry_count: u64,
    /// True when running with `./.dev-drive`, false when using `app_data_dir`.
    pub is_dev: bool,
}

// ---------------------------------------------------------------------------
// Root resolution + path sandboxing
// ---------------------------------------------------------------------------

/// Resolve and cache the managed drive root. Creates it on first call.
pub(crate) fn managed_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    if let Some(root) = MANAGED_ROOT.get() {
        return Ok(root.clone());
    }

    let base = if cfg!(debug_assertions) {
        // Dev build: repo-relative `.dev-drive/`. Using cwd is fine here —
        // `cargo tauri dev` runs with cwd at the repo root.
        std::env::current_dir()
            .map_err(|e| AppError::Internal(format!("cwd unavailable: {e}")))?
            .join(DEV_SUBDIR)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| AppError::Internal(format!("app_data_dir unavailable: {e}")))?
            .join(RELEASE_SUBDIR)
    };

    std::fs::create_dir_all(&base)?;

    // Canonicalise once so every later comparison is apples-to-apples. On
    // Windows this also resolves the `\\?\` extended-length prefix which we
    // have to strip when presenting paths to the UI.
    let canonical = std::fs::canonicalize(&base)?;

    // First writer wins — if two callers race, both see the same value.
    let _ = MANAGED_ROOT.set(canonical.clone());
    Ok(MANAGED_ROOT.get().cloned().unwrap_or(canonical))
}

/// Sandbox a user-supplied relative path. Rejects absolute paths, `..`
/// components, and anything that canonicalises outside the managed root
/// (e.g. symlinks). For paths that do not yet exist (create/write/mkdir),
/// the parent is canonicalised and the final component is appended back.
pub(crate) fn resolve_safe(root: &Path, rel: &str) -> Result<PathBuf, AppError> {
    let rel = rel.trim_start_matches('/').trim_start_matches('\\');

    // Empty or "." means the root itself.
    if rel.is_empty() || rel == "." {
        return Ok(root.to_path_buf());
    }

    let candidate = PathBuf::from(rel);
    if candidate.is_absolute() {
        return Err(AppError::Validation(
            "Drive paths must be relative to the managed root".into(),
        ));
    }
    for comp in candidate.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::Validation(
                    "Drive paths may not contain '..'".into(),
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::Validation(
                    "Drive paths must be relative".into(),
                ));
            }
        }
    }

    let joined = root.join(&candidate);

    // If the target exists, canonicalising it catches symlink escapes.
    // If it doesn't yet exist, canonicalise the parent and re-append the
    // basename so `drive_write("new/file.txt")` still works.
    let canonical = if joined.exists() {
        std::fs::canonicalize(&joined)?
    } else {
        let parent = joined.parent().ok_or_else(|| {
            AppError::Validation("Drive path has no parent directory".into())
        })?;
        // Walk up until we find an existing ancestor to canonicalise. This
        // lets mkdir build a deep chain in one call.
        let mut ancestor = parent.to_path_buf();
        loop {
            if ancestor.exists() {
                break;
            }
            match ancestor.parent() {
                Some(p) => ancestor = p.to_path_buf(),
                None => {
                    return Err(AppError::Validation(
                        "Drive path resolves above the managed root".into(),
                    ));
                }
            }
        }
        let canonical_ancestor = std::fs::canonicalize(&ancestor)?;
        // Re-append the relative tail between ancestor and joined.
        let tail = joined
            .strip_prefix(&ancestor)
            .map_err(|_| AppError::Internal("path prefix strip failed".into()))?;
        canonical_ancestor.join(tail)
    };

    if !canonical.starts_with(root) {
        return Err(AppError::Forbidden(format!(
            "Path escapes managed drive root: {}",
            rel
        )));
    }
    Ok(canonical)
}

/// Canonical path → UI-friendly forward-slash path relative to root. Strips
/// the `\\?\` prefix on Windows.
fn to_relative_display(root: &Path, abs: &Path) -> String {
    let stripped = abs.strip_prefix(root).unwrap_or(abs);
    stripped
        .to_string_lossy()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string()
}

fn mime_for_extension(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "txt" | "log" | "md" | "markdown" => "text/plain",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "application/javascript",
        "ts" | "tsx" => "application/typescript",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        _ => return None,
    })
}

fn build_entry(root: &Path, abs: &Path) -> Result<DriveEntry, AppError> {
    let meta = std::fs::metadata(abs)?;
    let name = abs
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let kind = if meta.is_dir() {
        DriveEntryKind::Folder
    } else {
        DriveEntryKind::File
    };
    let size = if kind == DriveEntryKind::File { meta.len() } else { 0 };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| Some(DateTime::<Utc>::from(t).to_rfc3339()))
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let extension = abs
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    let mime = extension
        .as_deref()
        .and_then(mime_for_extension)
        .map(|s| s.to_string())
        .filter(|_| kind == DriveEntryKind::File);

    Ok(DriveEntry {
        name,
        path: to_relative_display(root, abs),
        kind,
        size,
        modified,
        mime,
        extension: extension.filter(|_| kind == DriveEntryKind::File),
    })
}

// ---------------------------------------------------------------------------
// Persona event emission — `drive.document.*`
// ---------------------------------------------------------------------------

/// Canonical connector name declared by `scripts/connectors/builtin/local-drive.json`.
/// Also the `source_type` for every drive persona event so subscribers can filter.
const DRIVE_SOURCE_TYPE: &str = "local_drive";

/// Event names the drive surface publishes. Three-level dot syntax per C3 v3.1.
mod drive_event {
    pub const ADDED: &str = "drive.document.added";
    pub const EDITED: &str = "drive.document.edited";
    pub const RENAMED: &str = "drive.document.renamed";
    pub const DELETED: &str = "drive.document.deleted";
}

/// Publish a `drive.document.*` event to `persona_events`. Best-effort — drive
/// operations must not fail because the event bus can't ingest. `source_id` is
/// the file path so subscriptions with `source_filter: "some-folder/*"` can
/// narrow scope (e.g. a persona that only watches `/inbox/*`).
fn emit_drive_event(
    app: &AppHandle,
    event_type: &str,
    rel_path: &str,
    extra: Option<serde_json::Value>,
) {
    // Under tests the AppState may not be attached yet; skip silently.
    let state = match app.try_state::<Arc<AppState>>() {
        Some(s) => s,
        None => return,
    };

    let name = std::path::Path::new(rel_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = std::path::Path::new(rel_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    let mut payload = serde_json::json!({
        "path": rel_path,
        "name": name,
        "extension": ext,
    });
    if let (Some(obj), Some(extra)) = (payload.as_object_mut(), extra) {
        if let Some(extra_obj) = extra.as_object() {
            for (k, v) in extra_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    let input = crate::db::models::CreatePersonaEventInput {
        event_type: event_type.to_string(),
        source_type: DRIVE_SOURCE_TYPE.to_string(),
        project_id: None,
        source_id: Some(rel_path.to_string()),
        target_persona_id: None,
        payload: serde_json::to_string(&payload).ok(),
        use_case_id: None,
    };

    if let Err(e) = crate::db::repos::communication::events::publish(&state.db, input) {
        tracing::warn!(
            event_type = %event_type,
            path = %rel_path,
            "Failed to publish drive event: {}", e
        );
    } else {
        tracing::debug!(
            event_type = %event_type,
            path = %rel_path,
            "Published drive event"
        );
    }
}

// ---------------------------------------------------------------------------
// Commands — introspection
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn drive_get_root(app: AppHandle) -> Result<String, AppError> {
    let root = managed_root(&app)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn drive_storage_info(app: AppHandle) -> Result<DriveStorageInfo, AppError> {
    let root = managed_root(&app)?;
    let (used_bytes, entry_count) = compute_folder_size(&root)?;
    Ok(DriveStorageInfo {
        root: root.to_string_lossy().to_string(),
        used_bytes,
        entry_count,
        is_dev: cfg!(debug_assertions),
    })
}

fn compute_folder_size(dir: &Path) -> Result<(u64, u64), AppError> {
    let mut total = 0u64;
    let mut count = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let read = match std::fs::read_dir(&current) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            count += 1;
            let path = entry.path();
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => stack.push(path),
                Ok(ft) if ft.is_file() => {
                    if let Ok(meta) = entry.metadata() {
                        total += meta.len();
                    }
                }
                _ => {}
            }
        }
    }
    Ok((total, count))
}

// ---------------------------------------------------------------------------
// Commands — listing
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn drive_list(app: AppHandle, rel_path: String) -> Result<Vec<DriveEntry>, AppError> {
    let root = managed_root(&app)?;
    let dir = resolve_safe(&root, &rel_path)?;
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!(
            "Not a directory: {}",
            rel_path
        )));
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        // Skip OS clutter so the UI stays tidy.
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".DS_Store" || name_str == "Thumbs.db" || name_str == "desktop.ini" {
            continue;
        }
        entries.push(build_entry(&root, &entry.path())?);
    }
    // Folders first, then alphabetical.
    entries.sort_by(|a, b| match (a.kind, b.kind) {
        (DriveEntryKind::Folder, DriveEntryKind::File) => std::cmp::Ordering::Less,
        (DriveEntryKind::File, DriveEntryKind::Folder) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn drive_list_tree(
    app: AppHandle,
    rel_path: String,
    max_depth: Option<u32>,
) -> Result<DriveTreeNode, AppError> {
    let root = managed_root(&app)?;
    let base = resolve_safe(&root, &rel_path)?;
    if !base.is_dir() {
        return Err(AppError::NotFound(format!(
            "Not a directory: {}",
            rel_path
        )));
    }
    let depth = max_depth.unwrap_or(4);
    Ok(walk_tree(&root, &base, depth))
}

fn walk_tree(root: &Path, dir: &Path, depth_remaining: u32) -> DriveTreeNode {
    let name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "".to_string());
    let path = to_relative_display(root, dir);

    let mut children = Vec::new();
    let mut has_more = false;

    if depth_remaining == 0 {
        // Peek one level down just to know whether to show an expander.
        if let Ok(read) = std::fs::read_dir(dir) {
            has_more = read
                .flatten()
                .any(|e| e.file_type().map(|f| f.is_dir()).unwrap_or(false));
        }
        return DriveTreeNode { name, path, children, has_more_children: has_more };
    }

    if let Ok(read) = std::fs::read_dir(dir) {
        let mut dirs: Vec<PathBuf> = read
            .flatten()
            .filter(|e| e.file_type().map(|f| f.is_dir()).unwrap_or(false))
            .map(|e| e.path())
            .collect();
        dirs.sort_by(|a, b| {
            a.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
                .cmp(
                    &b.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase(),
                )
        });
        for sub in dirs {
            children.push(walk_tree(root, &sub, depth_remaining - 1));
        }
    }

    DriveTreeNode { name, path, children, has_more_children: has_more }
}

#[tauri::command]
pub fn drive_stat(app: AppHandle, rel_path: String) -> Result<DriveEntry, AppError> {
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Not found: {}", rel_path)));
    }
    build_entry(&root, &abs)
}

// ---------------------------------------------------------------------------
// Commands — read / write
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn drive_read(app: AppHandle, rel_path: String) -> Result<Vec<u8>, AppError> {
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    let meta = std::fs::metadata(&abs)?;
    if meta.len() > MAX_READ_BYTES {
        return Err(AppError::Validation(format!(
            "File too large to read in full ({} bytes, cap {})",
            meta.len(),
            MAX_READ_BYTES
        )));
    }
    Ok(std::fs::read(&abs)?)
}

#[tauri::command]
pub fn drive_read_text(app: AppHandle, rel_path: String) -> Result<String, AppError> {
    let bytes = drive_read(app, rel_path)?;
    String::from_utf8(bytes)
        .map_err(|e| AppError::Validation(format!("File is not valid UTF-8: {e}")))
}

#[tauri::command]
pub fn drive_write(
    app: AppHandle,
    rel_path: String,
    content: Vec<u8>,
) -> Result<DriveEntry, AppError> {
    if content.len() > MAX_WRITE_BYTES {
        return Err(AppError::Validation(format!(
            "Payload too large ({} bytes, cap {})",
            content.len(),
            MAX_WRITE_BYTES
        )));
    }
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    // "Added" vs "edited" is decided BEFORE std::fs::write creates the file.
    let existed_before = abs.exists();
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&abs, &content)?;
    let entry = build_entry(&root, &abs)?;

    let event_type = if existed_before {
        drive_event::EDITED
    } else {
        drive_event::ADDED
    };
    emit_drive_event(
        &app,
        event_type,
        &entry.path,
        Some(serde_json::json!({ "size": entry.size, "mime": entry.mime })),
    );

    Ok(entry)
}

#[tauri::command]
pub fn drive_write_text(
    app: AppHandle,
    rel_path: String,
    content: String,
) -> Result<DriveEntry, AppError> {
    drive_write(app, rel_path, content.into_bytes())
}

// ---------------------------------------------------------------------------
// Commands — mutations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn drive_mkdir(app: AppHandle, rel_path: String) -> Result<DriveEntry, AppError> {
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    std::fs::create_dir_all(&abs)?;
    build_entry(&root, &abs)
}

#[tauri::command]
pub fn drive_delete(app: AppHandle, rel_path: String) -> Result<(), AppError> {
    let root = managed_root(&app)?;
    // Refuse to delete the root itself.
    if rel_path.trim_matches(|c| c == '/' || c == '\\').is_empty() {
        return Err(AppError::Validation("Refusing to delete drive root".into()));
    }
    let abs = resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Not found: {}", rel_path)));
    }
    let was_dir = abs.is_dir();
    if was_dir {
        std::fs::remove_dir_all(&abs)?;
    } else {
        std::fs::remove_file(&abs)?;
    }

    emit_drive_event(
        &app,
        drive_event::DELETED,
        &rel_path,
        Some(serde_json::json!({ "was_folder": was_dir })),
    );

    Ok(())
}

#[tauri::command]
pub fn drive_rename(
    app: AppHandle,
    rel_path: String,
    new_name: String,
) -> Result<DriveEntry, AppError> {
    validate_basename(&new_name)?;
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    let parent = abs
        .parent()
        .ok_or_else(|| AppError::Validation("Cannot rename root".into()))?;
    let dst = parent.join(&new_name);
    // Re-check that the rename destination is still inside the sandbox.
    let dst_rel = to_relative_display(&root, &dst);
    let dst_resolved = resolve_safe(&root, &dst_rel)?;
    if dst_resolved.exists() {
        return Err(AppError::Validation(format!(
            "A file or folder named '{}' already exists",
            new_name
        )));
    }
    std::fs::rename(&abs, &dst_resolved)?;
    let entry = build_entry(&root, &dst_resolved)?;

    emit_drive_event(
        &app,
        drive_event::RENAMED,
        &entry.path,
        Some(serde_json::json!({ "from_path": rel_path })),
    );

    Ok(entry)
}

#[tauri::command]
pub fn drive_move(
    app: AppHandle,
    src_rel: String,
    dst_rel: String,
) -> Result<DriveEntry, AppError> {
    let root = managed_root(&app)?;
    let src = resolve_safe(&root, &src_rel)?;
    let dst = resolve_safe(&root, &dst_rel)?;
    if !src.exists() {
        return Err(AppError::NotFound(format!("Source not found: {}", src_rel)));
    }
    if dst.exists() {
        return Err(AppError::Validation(format!(
            "Destination already exists: {}",
            dst_rel
        )));
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Refuse to move a folder inside itself.
    if src.is_dir() && dst.starts_with(&src) {
        return Err(AppError::Validation(
            "Cannot move a folder inside itself".into(),
        ));
    }
    std::fs::rename(&src, &dst)?;
    let entry = build_entry(&root, &dst)?;

    emit_drive_event(
        &app,
        drive_event::RENAMED,
        &entry.path,
        Some(serde_json::json!({ "from_path": src_rel })),
    );

    Ok(entry)
}

#[tauri::command]
pub fn drive_copy(
    app: AppHandle,
    src_rel: String,
    dst_rel: String,
) -> Result<DriveEntry, AppError> {
    let root = managed_root(&app)?;
    let src = resolve_safe(&root, &src_rel)?;
    let dst = resolve_safe(&root, &dst_rel)?;
    if !src.exists() {
        return Err(AppError::NotFound(format!("Source not found: {}", src_rel)));
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if src.is_dir() {
        if dst.starts_with(&src) {
            return Err(AppError::Validation(
                "Cannot copy a folder inside itself".into(),
            ));
        }
        copy_dir_recursive(&src, &dst)?;
    } else {
        std::fs::copy(&src, &dst)?;
    }
    let entry = build_entry(&root, &dst)?;

    // A copy always produces a NEW node at the destination. Emit `added` so
    // subscribed personas trigger on incoming duplicates the same way they do
    // for newly-written files.
    emit_drive_event(
        &app,
        drive_event::ADDED,
        &entry.path,
        Some(serde_json::json!({ "from_path": src_rel, "copied": true })),
    );

    Ok(entry)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Validate a single basename — no separators, no traversal, no reserved
/// Windows device names.
fn validate_basename(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }
    if name.len() > 255 {
        return Err(AppError::Validation("Name is too long (max 255 chars)".into()));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(AppError::Validation(
            "Name cannot contain path separators".into(),
        ));
    }
    if name == "." || name == ".." {
        return Err(AppError::Validation("Invalid name".into()));
    }
    // Reject characters that are illegal on Windows (harmless elsewhere).
    for c in name.chars() {
        if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || (c as u32) < 0x20 {
            return Err(AppError::Validation(format!(
                "Name contains invalid character: {:?}",
                c
            )));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands — shell integration
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn drive_open_in_os(app: AppHandle, rel_path: String) -> Result<(), AppError> {
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Not found: {}", rel_path)));
    }
    open::that(&abs).map_err(|e| AppError::Internal(format!("Failed to open: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn drive_reveal_in_os(app: AppHandle, rel_path: String) -> Result<(), AppError> {
    let root = managed_root(&app)?;
    let abs = resolve_safe(&root, &rel_path)?;
    if !abs.exists() {
        return Err(AppError::NotFound(format!("Not found: {}", rel_path)));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // `explorer /select,<path>` highlights the file in its parent folder.
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", abs.display()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to reveal in Explorer: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&abs)
            .spawn()
            .map_err(|e| AppError::Internal(format!("Failed to reveal in Finder: {e}")))?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        // Linux: no universal "select item" affordance, so open the parent.
        let target = if abs.is_dir() { abs.clone() } else {
            abs.parent().map(Path::to_path_buf).unwrap_or(abs.clone())
        };
        open::that(&target)
            .map_err(|e| AppError::Internal(format!("Failed to open file manager: {e}")))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "personas-drive-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();
        fs::canonicalize(&base).unwrap()
    }

    #[test]
    fn sandbox_rejects_absolute_paths() {
        let root = temp_root();
        assert!(resolve_safe(&root, "/etc/passwd").is_err());
    }

    #[test]
    fn sandbox_rejects_parent_traversal() {
        let root = temp_root();
        assert!(resolve_safe(&root, "../outside.txt").is_err());
        assert!(resolve_safe(&root, "safe/../../outside.txt").is_err());
    }

    #[test]
    fn sandbox_accepts_nested_new_paths() {
        let root = temp_root();
        let resolved = resolve_safe(&root, "a/b/c/new.txt").unwrap();
        assert!(resolved.starts_with(&root));
    }

    #[test]
    fn sandbox_accepts_root_as_empty() {
        let root = temp_root();
        assert_eq!(resolve_safe(&root, "").unwrap(), root);
        assert_eq!(resolve_safe(&root, ".").unwrap(), root);
    }

    #[test]
    fn basename_validation() {
        assert!(validate_basename("ok.txt").is_ok());
        assert!(validate_basename("").is_err());
        assert!(validate_basename("..").is_err());
        assert!(validate_basename("a/b").is_err());
        assert!(validate_basename("q?x").is_err());
    }
}
