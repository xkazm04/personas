//! Dev-only conversation export: dumps the frontend-serialized Athena
//! transcript into the gitignored `logs/athena-conversations/` directory
//! at the repo root, for reflective development sessions. Debug builds
//! only — the whole module vanishes from release binaries.
#![cfg(debug_assertions)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::State;

use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// Keep only `[A-Za-z0-9_-]` so a hostile conversation id can never
/// escape the log directory, and cap the stem length.
fn sanitize_stem(stem: &str) -> String {
    stem.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(80)
        .collect()
}

fn write_log(dir: &Path, stem: &str, content: &str) -> Result<PathBuf, AppError> {
    let stem = sanitize_stem(stem);
    if stem.is_empty() {
        return Err(AppError::Validation(
            "conversation log: empty file stem after sanitizing".into(),
        ));
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::Internal(format!("conversation log: create dir failed: {e}")))?;
    let path = dir.join(format!("{stem}.md"));
    std::fs::write(&path, content)
        .map_err(|e| AppError::Internal(format!("conversation log: write failed: {e}")))?;
    Ok(path)
}

/// Write a markdown conversation dump under `logs/athena-conversations/`
/// (gitignored via the repo's top-level `logs/` rule) and return the
/// absolute path for the success toast.
#[tauri::command]
pub fn companion_export_conversation_log(
    state: State<'_, Arc<AppState>>,
    file_stem: String,
    markdown: String,
) -> Result<String, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let dir = crate::companion::dev_mode::repo_root()
        .join("logs")
        .join("athena-conversations");
    let path = write_log(&dir, &file_stem, &markdown)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_path_escapes_and_unicode() {
        assert_eq!(
            sanitize_stem("2026-08-05_10-00-00-default"),
            "2026-08-05_10-00-00-default"
        );
        assert_eq!(sanitize_stem("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_stem("a\\b/c:d"), "abcd");
        assert_eq!(sanitize_stem("čeština✨"), "etina");
        assert_eq!(sanitize_stem("///"), "");
        assert_eq!(sanitize_stem(&"x".repeat(200)).len(), 80);
    }

    #[test]
    fn write_log_writes_into_dir_and_refuses_empty_stem() {
        let dir = std::env::temp_dir().join(format!("athena-log-test-{}", std::process::id()));
        let path = write_log(&dir, "test-stem", "# hello\n").expect("write ok");
        assert!(path.starts_with(&dir));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# hello\n");
        assert!(write_log(&dir, "..", "x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
