//! Per-competition `worktree.baseRef` settings merger.
//!
//! Claude CLI 2.1.133 added a `worktree.baseRef` setting (`fresh` | `head`)
//! that controls whether `--worktree`, `EnterWorktree`, and agent-isolation
//! worktrees branch from `origin/<default>` or local `HEAD`. The setting is
//! read from `<project_root>/.claude/settings.json` at worktree creation
//! time. There is no equivalent CLI flag, so personas writes the value into
//! the project-root settings.json before spawning competition slots.
//!
//! ## Merge semantics
//!
//! The user may already have authored content in `.claude/settings.json`
//! (hooks, theme, permissions, etc.). This helper performs a **shallow
//! merge** — it touches only the `worktree.baseRef` key and preserves every
//! other top-level key the user has set. If the file does not exist it is
//! created with just the `worktree` block.
//!
//! ## Failure mode
//!
//! Filesystem errors are returned as `AppError` so the caller can decide
//! whether to abort the competition. The caller in
//! `commands/infrastructure/dev_tools.rs::dev_tools_start_competition`
//! treats merge failures as non-fatal: it logs and proceeds with whatever
//! settings.json already contains.
//!
//! Malformed pre-existing settings.json is treated as a hard error rather
//! than an opportunity to overwrite — we never destroy user content.

use std::path::Path;

use crate::error::AppError;

/// Allowed values for `worktree.baseRef`. Validated at the command boundary;
/// this helper trusts its input.
pub const VALID_BASE_REFS: &[&str] = &["head", "fresh"];

/// Merge `worktree.baseRef = <base_ref>` into
/// `<project_root>/.claude/settings.json`, preserving every other key the
/// user has authored. Creates the file if it does not exist.
///
/// `base_ref` must be one of `VALID_BASE_REFS`; the caller is responsible
/// for validating user input before calling.
pub fn apply_worktree_base_ref(project_root: &Path, base_ref: &str) -> Result<(), AppError> {
    let claude_dir = project_root.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    let mut root: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).map_err(|e| {
            AppError::Internal(format!(
                "worktree_settings: read {}: {e}",
                settings_path.display()
            ))
        })?;
        if content.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&content).map_err(|e| {
                AppError::Internal(format!(
                    "worktree_settings: parse {}: {e} (refusing to overwrite user-authored content)",
                    settings_path.display()
                ))
            })?
        }
    } else {
        serde_json::json!({})
    };

    // Ensure root is an object (a top-level array or scalar would mean the
    // user's settings.json is shaped wrong; refuse rather than coerce).
    let root_obj = root.as_object_mut().ok_or_else(|| {
        AppError::Internal(format!(
            "worktree_settings: {} top-level value is not an object",
            settings_path.display()
        ))
    })?;

    // Get-or-insert the `worktree` block, then set baseRef.
    let worktree_entry = root_obj
        .entry("worktree".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let worktree_obj = worktree_entry.as_object_mut().ok_or_else(|| {
        AppError::Internal(format!(
            "worktree_settings: {} `worktree` is not an object",
            settings_path.display()
        ))
    })?;
    worktree_obj.insert(
        "baseRef".to_string(),
        serde_json::Value::String(base_ref.to_string()),
    );

    if !claude_dir.exists() {
        std::fs::create_dir_all(&claude_dir).map_err(|e| {
            AppError::Internal(format!(
                "worktree_settings: create {}: {e}",
                claude_dir.display()
            ))
        })?;
    }

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| AppError::Internal(format!("worktree_settings: serialize settings: {e}")))?;

    std::fs::write(&settings_path, serialized).map_err(|e| {
        AppError::Internal(format!(
            "worktree_settings: write {}: {e}",
            settings_path.display()
        ))
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_settings(dir: &Path) -> serde_json::Value {
        let p = dir.join(".claude").join("settings.json");
        let s = std::fs::read_to_string(p).unwrap();
        serde_json::from_str(&s).unwrap()
    }

    #[test]
    fn applies_to_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        apply_worktree_base_ref(tmp.path(), "fresh").unwrap();
        let v = read_settings(tmp.path());
        assert_eq!(v["worktree"]["baseRef"], "fresh");
        // No other top-level keys.
        assert_eq!(v.as_object().unwrap().len(), 1);
    }

    #[test]
    fn preserves_user_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.json"),
            r#"{"hooks":{"Stop":[]},"theme":"dark"}"#,
        )
        .unwrap();

        apply_worktree_base_ref(tmp.path(), "fresh").unwrap();
        let v = read_settings(tmp.path());
        assert_eq!(v["worktree"]["baseRef"], "fresh");
        assert_eq!(v["theme"], "dark");
        assert!(v["hooks"]["Stop"].is_array());
    }

    #[test]
    fn overwrites_existing_baseref() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.json"),
            r#"{"worktree":{"baseRef":"head","other":"keep"}}"#,
        )
        .unwrap();

        apply_worktree_base_ref(tmp.path(), "fresh").unwrap();
        let v = read_settings(tmp.path());
        assert_eq!(v["worktree"]["baseRef"], "fresh");
        // Sibling keys inside `worktree` survive.
        assert_eq!(v["worktree"]["other"], "keep");
    }

    #[test]
    fn tolerates_empty_file() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(claude_dir.join("settings.json"), "").unwrap();

        apply_worktree_base_ref(tmp.path(), "head").unwrap();
        let v = read_settings(tmp.path());
        assert_eq!(v["worktree"]["baseRef"], "head");
    }

    #[test]
    fn rejects_malformed_json() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let path = claude_dir.join("settings.json");
        let original = "{not valid json";
        std::fs::write(&path, original).unwrap();

        let err = apply_worktree_base_ref(tmp.path(), "fresh").unwrap_err();
        match err {
            AppError::Internal(msg) => assert!(msg.contains("parse")),
            other => panic!("expected Internal, got {other:?}"),
        }
        // Original file untouched — no destruction of user content.
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(after, original);
    }

    #[test]
    fn idempotent_repeated_calls() {
        let tmp = tempfile::tempdir().unwrap();
        apply_worktree_base_ref(tmp.path(), "fresh").unwrap();
        let first =
            std::fs::read_to_string(tmp.path().join(".claude").join("settings.json")).unwrap();
        apply_worktree_base_ref(tmp.path(), "fresh").unwrap();
        let second =
            std::fs::read_to_string(tmp.path().join(".claude").join("settings.json")).unwrap();
        assert_eq!(first, second);
    }
}
