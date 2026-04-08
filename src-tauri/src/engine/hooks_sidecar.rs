//! Claude Code hooks sidecar.
//!
//! Inspired by Karpathy-style LLM knowledge bases (research run 2026-04-08):
//! the video's setup uses Claude Code's native `SessionStart`, `Stop`, and
//! `PreCompact` hooks to auto-capture session transcripts. Personas already
//! spawns the `claude` binary inside a per-persona `exec_dir` — by writing a
//! `.claude/settings.json` sidecar into that directory before spawn, we make
//! Claude Code execute hooks that drop a JSONL queue line we can pick up
//! later and route into the persona memory pipeline.
//!
//! ## Safety
//!
//! The sidecar is **opt-in via env var** `PERSONAS_HOOKS_SIDECAR=1` while it
//! bakes. When the env var is unset, `install_sidecar` is a complete no-op
//! and the spawn behavior is unchanged. This lets the feature land in main
//! without risking existing executions.
//!
//! ## Reactor (future)
//!
//! `drain_session_queue` reads + clears the queue file. A scheduled job can
//! call this and feed the entries into `commands::core::memory_compile`. The
//! reactor wiring is intentionally split out so the IPC-side and the
//! runner-side can land independently.

use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Env var that gates the sidecar write. Unset → no-op.
pub const SIDECAR_ENV: &str = "PERSONAS_HOOKS_SIDECAR";

/// Subdirectory inside exec_dir where the queue file lives.
const QUEUE_SUBDIR: &str = ".personas";
/// Queue filename (JSONL — one entry per session-end / pre-compact event).
const QUEUE_FILE: &str = "session_queue.jsonl";

/// Write the `.claude/settings.json` sidecar into `exec_dir` so that the
/// next spawned `claude` process picks it up. Returns `Ok(false)` when the
/// sidecar is disabled (env var unset); returns `Ok(true)` after a
/// successful write.
///
/// This is best-effort: if writing fails for any reason we log and return
/// `Ok(false)` rather than aborting the execution. Memory capture is a
/// nice-to-have, not a hard requirement.
pub fn install_sidecar(exec_dir: &Path) -> Result<bool, AppError> {
    if std::env::var(SIDECAR_ENV).ok().as_deref() != Some("1") {
        return Ok(false);
    }

    let claude_dir = exec_dir.join(".claude");
    if let Err(e) = std::fs::create_dir_all(&claude_dir) {
        tracing::warn!(
            error = %e,
            dir = %claude_dir.display(),
            "hooks_sidecar: failed to create .claude/ — skipping sidecar"
        );
        return Ok(false);
    }

    let queue_dir = exec_dir.join(QUEUE_SUBDIR);
    if let Err(e) = std::fs::create_dir_all(&queue_dir) {
        tracing::warn!(
            error = %e,
            dir = %queue_dir.display(),
            "hooks_sidecar: failed to create .personas/ — skipping sidecar"
        );
        return Ok(false);
    }

    let settings_path = claude_dir.join("settings.json");
    let queue_path = queue_dir.join(QUEUE_FILE);

    let settings_json = build_settings_json(&queue_path)?;

    if let Err(e) = std::fs::write(&settings_path, settings_json) {
        tracing::warn!(
            error = %e,
            path = %settings_path.display(),
            "hooks_sidecar: failed to write settings.json — skipping sidecar"
        );
        return Ok(false);
    }

    tracing::debug!(
        path = %settings_path.display(),
        "hooks_sidecar: installed Claude Code hooks sidecar"
    );
    Ok(true)
}

/// Build the settings.json body. The hook command uses `node` (which the
/// project already requires per `codebase-stack.md`) to append the hook
/// payload (which Claude Code pipes via stdin) to the queue file. Choosing
/// `node` over a shell-specific construct keeps the hook portable.
fn build_settings_json(queue_path: &Path) -> Result<String, AppError> {
    // Escape the path for embedding in a JSON string AND for embedding in
    // a JS string literal inside that JSON. Backslashes need double escape
    // (Windows paths are full of them) and so do quotes.
    let queue_str = queue_path.display().to_string();
    let js_escaped = queue_str.replace('\\', "\\\\").replace('"', "\\\"");

    // The hook command:
    //   1. Reads the JSON event payload Claude Code pipes on stdin.
    //   2. Appends it as a single JSONL line to the queue file.
    //   3. Exits 0 so it never blocks the parent execution.
    //
    // Wrap the whole node script in a single string and let serde_json
    // emit it as a properly-escaped JSON value.
    let node_script = format!(
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{{try{{require('fs').appendFileSync(\"{js_escaped}\",d.trim()+'\\n');}}catch(e){{}}process.exit(0);}});"
    );

    // Build the JSON value programmatically so escaping is correct on all
    // platforms.
    let settings = serde_json::json!({
        "_personas_marker": "Auto-installed by personas hooks_sidecar — do not edit by hand. \
                              Captured session events feed the persona memory compile pipeline.",
        "hooks": {
            "Stop": [
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": format!("node -e \"{}\"", node_script.replace('"', "\\\""))
                        }
                    ]
                }
            ],
            "PreCompact": [
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": format!("node -e \"{}\"", node_script.replace('"', "\\\""))
                        }
                    ]
                }
            ]
        }
    });

    serde_json::to_string_pretty(&settings)
        .map_err(|e| AppError::Internal(format!("serialize sidecar settings.json: {e}")))
}

/// Drain the queue file at `exec_dir/.personas/session_queue.jsonl`,
/// returning every JSONL line that was waiting. The file is truncated on
/// success so future calls only see new entries. If the queue file does
/// not exist (sidecar disabled or no events fired yet), returns an empty
/// vec — never an error.
///
/// Intentionally `pub` but not yet called from a runtime scheduler — the
/// reactor wiring lands in a follow-up change. `allow(dead_code)` keeps the
/// lint quiet until then.
#[allow(dead_code)]
pub fn drain_session_queue(exec_dir: &Path) -> Result<Vec<String>, AppError> {
    let queue_path = exec_dir.join(QUEUE_SUBDIR).join(QUEUE_FILE);
    if !queue_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&queue_path)
        .map_err(|e| AppError::Internal(format!("read session queue: {e}")))?;

    // Truncate immediately so concurrent hook writes don't get lost between
    // read and clear. Empty-string write is the canonical truncate.
    if let Err(e) = std::fs::write(&queue_path, "") {
        tracing::warn!(
            error = %e,
            path = %queue_path.display(),
            "hooks_sidecar: failed to truncate queue file after drain"
        );
    }

    let lines: Vec<String> = content
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(lines)
}

/// Convenience: compute where the queue file lives without needing to
/// reach across modules for the constants. Used by the test suite and
/// will be used by the reactor in a follow-up change.
#[allow(dead_code)]
pub fn queue_path(exec_dir: &Path) -> PathBuf {
    exec_dir.join(QUEUE_SUBDIR).join(QUEUE_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The enable/disable tests mutate a shared process-wide env var, so they
    /// cannot run in parallel. A single-acquire mutex serializes them and also
    /// guards against `.env`-style loaders setting the variable out-of-band.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn install_sidecar_respects_env_var_both_ways() {
        let _guard = ENV_LOCK.lock().unwrap();

        // Disabled case: ensure no files are written and the function returns false.
        std::env::remove_var(SIDECAR_ENV);
        let tmp_off = tempfile::tempdir().unwrap();
        let installed_off = install_sidecar(tmp_off.path()).unwrap();
        assert!(!installed_off);
        assert!(!tmp_off.path().join(".claude").exists());
        assert!(!tmp_off.path().join(".personas").exists());

        // Enabled case: settings.json is written with the expected shape.
        std::env::set_var(SIDECAR_ENV, "1");
        let tmp_on = tempfile::tempdir().unwrap();
        let installed_on = install_sidecar(tmp_on.path()).unwrap();
        std::env::remove_var(SIDECAR_ENV);

        assert!(installed_on);
        let settings_path = tmp_on.path().join(".claude").join("settings.json");
        assert!(settings_path.exists());
        let settings_text = std::fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&settings_text).unwrap();
        assert!(parsed.get("hooks").is_some());
        assert!(parsed
            .get("_personas_marker")
            .and_then(|v| v.as_str())
            .map(|s| s.contains("personas"))
            .unwrap_or(false));
        assert!(tmp_on.path().join(".personas").exists());
    }

    #[test]
    fn drain_session_queue_returns_empty_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let lines = drain_session_queue(tmp.path()).unwrap();
        assert!(lines.is_empty());
    }

    #[test]
    fn drain_session_queue_reads_and_truncates() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".personas")).unwrap();
        let qp = queue_path(tmp.path());
        std::fs::write(&qp, "{\"a\":1}\n{\"b\":2}\n\n").unwrap();

        let lines = drain_session_queue(tmp.path()).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "{\"a\":1}");
        assert_eq!(lines[1], "{\"b\":2}");

        // Second call should yield nothing — file was truncated.
        let lines2 = drain_session_queue(tmp.path()).unwrap();
        assert!(lines2.is_empty());
    }
}
