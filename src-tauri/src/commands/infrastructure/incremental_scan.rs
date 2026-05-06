//! Incremental rescan support — graphify-inspired per-file content cache.
//!
//! Walks a project root, computes SHA256 per file, and diffs against the
//! `dev_context_file_hashes` cache populated by the last successful
//! `dev_tools_scan_codebase` run. The {added, modified, deleted} delta is
//! handed to `context_generation.rs::run_context_generation`, which feeds
//! the LLM only the changed surface — unchanged files short-circuit.
//!
//! Why this exists: a full LLM rescan of a personas-sized repo takes ~30
//! minutes and costs real tokens. Most rescans land on a working tree where
//! 99% of files haven't changed since the last scan; the cache turns those
//! rescans into ~30-second delta scans. See `/research` run on graphify
//! (cache.py:32-194) for the prior art.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Directory names skipped during the walk. Kept inline (not user-configurable)
/// because these are universal build/cache directories that never carry source
/// the LLM should reason about. Per-project ignores belong in a future
/// `.personasignore` file (deferred — not part of this finding).
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".vscode",
    ".idea",
    ".next",
    ".vite",
    ".turbo",
    ".cache",
    ".pytest_cache",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".gradle",
    ".mvn",
    ".terraform",
    "coverage",
    ".nyc_output",
    "out",
    "tmp",
    ".tmp",
    "logs",
    ".research-cache",
];

/// File extensions whose content the LLM is likely to find meaningful for
/// codebase context. Anything outside this set is hashed only (presence/
/// absence still tracked) but never streamed to the LLM. Conservative on
/// purpose — false negatives here just mean "this file won't drive a context
/// update", not "this file is invisible".
const SOURCE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "py", "go", "java", "kt", "swift", "c", "cpp", "cc",
    "h", "hpp", "cs", "rb", "php", "scala", "lua", "ex", "exs", "vue", "svelte", "sql", "toml",
    "yaml", "yml", "json", "md", "mdx",
];

/// Cap per-file size; anything larger is skipped entirely (no hash, no scan).
/// Generated bundles, lockfiles, and minified assets routinely exceed this and
/// add no LLM-usable signal.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MB

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanFileEntry {
    pub path: String,
    pub sha256: String,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScanDelta {
    pub added: Vec<String>,
    pub modified: Vec<String>,
    pub deleted: Vec<String>,
    pub unchanged_count: i32,
    pub total_files: i32,
    /// True when there is no cache yet (first scan) — caller should treat
    /// this as "full scan required" regardless of the empty added/modified.
    pub cache_empty: bool,
}

impl ScanDelta {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.modified.is_empty() && self.deleted.is_empty()
    }

    pub fn changed_count(&self) -> i32 {
        (self.added.len() + self.modified.len() + self.deleted.len()) as i32
    }
}

/// Walk a project root and compute the SHA256 + size of every source file
/// under `MAX_FILE_BYTES`. File paths are returned relative to `root` with
/// forward slashes (LLM-friendly, cross-platform stable).
pub fn walk_project_files(root: &Path) -> Result<Vec<ScanFileEntry>, AppError> {
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "walk_project_files: not a directory: {}",
            root.display()
        )));
    }

    let mut out = Vec::new();
    walk_recursive(root, root, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk_recursive(base: &Path, cur: &Path, out: &mut Vec<ScanFileEntry>) -> Result<(), AppError> {
    let entries = match std::fs::read_dir(cur) {
        Ok(e) => e,
        Err(e) => {
            // Permission errors / missing dirs are not fatal — skip and warn.
            tracing::warn!(error = %e, path = %cur.display(), "walk: read_dir failed, skipping");
            return Ok(());
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = match entry.file_name().into_string() {
            Ok(n) => n,
            Err(_) => continue, // non-UTF8 filename — skip
        };

        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        if ft.is_symlink() {
            // Skip symlinks to avoid loops + because graphify-style cache keys
            // assume content lives at the resolved path, not the link path.
            continue;
        }

        if ft.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') && name != ".github" {
                continue;
            }
            walk_recursive(base, &path, out)?;
            continue;
        }

        if !ft.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if !SOURCE_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = meta.len();
        if size > MAX_FILE_BYTES {
            continue;
        }

        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let digest = Sha256::digest(&bytes);
        let sha = hex::encode(digest);

        let rel = match path.strip_prefix(base) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        out.push(ScanFileEntry {
            path: rel,
            sha256: sha,
            size_bytes: size as i64,
        });
    }
    Ok(())
}

/// Diff a fresh walk result against the cached hashes. Caller owns both sides.
pub fn compute_delta(cached: &HashMap<String, String>, current: &[ScanFileEntry]) -> ScanDelta {
    let cache_empty = cached.is_empty();
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = 0i32;

    let current_paths: HashSet<&str> = current.iter().map(|e| e.path.as_str()).collect();

    for entry in current {
        match cached.get(&entry.path) {
            None => added.push(entry.path.clone()),
            Some(prev_sha) if prev_sha != &entry.sha256 => modified.push(entry.path.clone()),
            _ => unchanged += 1,
        }
    }

    let mut deleted: Vec<String> = cached
        .keys()
        .filter(|k| !current_paths.contains(k.as_str()))
        .cloned()
        .collect();
    deleted.sort();

    ScanDelta {
        added,
        modified,
        deleted,
        unchanged_count: unchanged,
        total_files: current.len() as i32,
        cache_empty,
    }
}

/// Tauri command: preview a delta without running a scan. Lets the UI render
/// "12 files changed since last scan — rescan?" without spending tokens.
#[tauri::command]
pub async fn dev_tools_compute_scan_delta(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<ScanDelta, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let root = PathBuf::from(&project.root_path);
    let cached = repo::get_file_hashes(&state.db, &project_id)?;

    // Walking is sync I/O; offload to a blocking task so the IPC handler
    // doesn't park a Tokio worker for the duration.
    let current = tokio::task::spawn_blocking(move || walk_project_files(&root))
        .await
        .map_err(|e| AppError::Internal(format!("scan delta join error: {e}")))??;

    Ok(compute_delta(&cached, &current))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, sha: &str) -> ScanFileEntry {
        ScanFileEntry {
            path: path.to_string(),
            sha256: sha.to_string(),
            size_bytes: 100,
        }
    }

    #[test]
    fn delta_first_scan_is_empty_cache() {
        let delta = compute_delta(&HashMap::new(), &[entry("a.rs", "x")]);
        assert!(delta.cache_empty);
        assert_eq!(delta.added, vec!["a.rs"]);
        assert!(delta.modified.is_empty());
        assert!(delta.deleted.is_empty());
    }

    #[test]
    fn delta_detects_added_modified_deleted() {
        let mut cached = HashMap::new();
        cached.insert("a.rs".to_string(), "x".to_string());
        cached.insert("b.rs".to_string(), "y".to_string());
        cached.insert("gone.rs".to_string(), "z".to_string());

        let current = vec![
            entry("a.rs", "x"),   // unchanged
            entry("b.rs", "y2"),  // modified
            entry("new.rs", "n"), // added
        ];

        let delta = compute_delta(&cached, &current);
        assert!(!delta.cache_empty);
        assert_eq!(delta.added, vec!["new.rs"]);
        assert_eq!(delta.modified, vec!["b.rs"]);
        assert_eq!(delta.deleted, vec!["gone.rs"]);
        assert_eq!(delta.unchanged_count, 1);
        assert_eq!(delta.total_files, 3);
    }

    #[test]
    fn delta_unchanged_when_identical() {
        let mut cached = HashMap::new();
        cached.insert("a.rs".to_string(), "x".to_string());
        let current = vec![entry("a.rs", "x")];
        let delta = compute_delta(&cached, &current);
        assert!(delta.is_empty());
        assert_eq!(delta.unchanged_count, 1);
    }
}
