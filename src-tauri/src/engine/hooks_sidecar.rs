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
//! ## Reactor (post-execution)
//!
//! `drain_session_queue` reads + clears the queue file.
//! `drain_and_record_session_memories` is the post-execution reactor that the
//! runner calls after every persona run: it drains the queue and records each
//! captured hook payload as a `working`-tier persona memory in category
//! `context`. A separate maintenance pass (`compile_persona_memories`) can
//! later promote these into structured wiki articles.
//!
//! The two-step shape (record raw → compile later) keeps post-execution work
//! cheap (~one INSERT per hook fire) while preserving the option to upgrade
//! the captured material into durable knowledge on a slower cadence.

use std::path::{Path, PathBuf};

use crate::db::models::CreatePersonaMemoryInput;
use crate::db::repos::core::memories as mem_repo;
use crate::db::DbPool;
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
///
/// Uses Claude Code 2.1.139's exec-form `args: string[]` hook field so the
/// command is spawned directly without going through a shell — eliminates
/// the Windows-quoting / JS-string-in-shell-arg double-escape trap that the
/// previous shell-form `command: "node -e \"...\""` had to defend against.
fn build_settings_json(queue_path: &Path) -> Result<String, AppError> {
    let queue_str = queue_path.display().to_string();

    // The hook script:
    //   1. Reads the JSON event payload Claude Code pipes on stdin.
    //   2. Appends it as a single JSONL line to the queue file.
    //   3. Exits 0 so it never blocks the parent execution.
    //
    // serde_json escapes the path inside the JS string literal correctly on
    // all platforms (Windows backslashes included).
    let queue_str_js = serde_json::to_string(&queue_str)
        .map_err(|e| AppError::Internal(format!("escape queue path for JS literal: {e}")))?;
    let node_script = format!(
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{{try{{require('fs').appendFileSync({queue_str_js},d.trim()+'\\n');}}catch(e){{}}process.exit(0);}});"
    );

    let hook_entry = serde_json::json!({
        "type": "command",
        "command": "node",
        "args": ["-e", node_script]
    });

    let settings = serde_json::json!({
        "_personas_marker": "Auto-installed by personas hooks_sidecar — do not edit by hand. \
                              Captured session events feed the persona memory compile pipeline.",
        "hooks": {
            "Stop": [
                { "matcher": "", "hooks": [hook_entry.clone()] }
            ],
            "PreCompact": [
                { "matcher": "", "hooks": [hook_entry] }
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
/// available for future direct callers.
#[allow(dead_code)]
pub fn queue_path(exec_dir: &Path) -> PathBuf {
    exec_dir.join(QUEUE_SUBDIR).join(QUEUE_FILE)
}

/// Post-execution reactor: drain the queue file and persist each captured
/// hook payload as a `working`-tier persona memory under category `context`.
///
/// Returns the number of memories created. Returns `Ok(0)` when:
/// - the sidecar is disabled (`PERSONAS_HOOKS_SIDECAR` unset),
/// - the queue file is empty or missing,
/// - all entries fail to record (logged but not propagated).
///
/// Failures are intentionally non-fatal: memory capture is a best-effort side
/// channel and must never break the execution that owns it.
pub fn drain_and_record_session_memories(
    pool: &DbPool,
    exec_dir: &Path,
    persona_id: &str,
    execution_id: &str,
) -> Result<i64, AppError> {
    // Same env gate as install_sidecar — if the sidecar wasn't installed,
    // there's nothing in the queue and we skip the I/O entirely.
    if std::env::var(SIDECAR_ENV).ok().as_deref() != Some("1") {
        return Ok(0);
    }

    let lines = drain_session_queue(exec_dir)?;
    if lines.is_empty() {
        return Ok(0);
    }

    let mut created: i64 = 0;
    for line in &lines {
        match record_session_capture(pool, persona_id, execution_id, line) {
            Ok(()) => created += 1,
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    persona_id = %persona_id,
                    "hooks_sidecar: failed to record session capture — skipping line"
                );
            }
        }
    }

    Ok(created)
}

/// Persist a single hook payload as a working-tier context memory.
fn record_session_capture(
    pool: &DbPool,
    persona_id: &str,
    execution_id: &str,
    raw_line: &str,
) -> Result<(), AppError> {
    let payload: serde_json::Value = serde_json::from_str(raw_line)
        .map_err(|e| AppError::Internal(format!("parse session_queue line: {e}")))?;

    // Hook payload shape (as emitted by Claude Code):
    //   { "session_id": "...", "transcript_path": "...", "hook_event_name": "Stop" }
    // We extract the event name for tagging and keep the full JSON as content
    // so a later `compile_persona_memories` pass has the raw material.
    let hook_event = payload
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("session_capture");

    let title = format!(
        "Session capture ({hook_event}) — {}",
        chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")
    );

    // Pretty-print so the body is readable in the Memories UI without an
    // extra rendering step.
    let content = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| raw_line.to_string());

    let input = CreatePersonaMemoryInput {
        persona_id: persona_id.to_string(),
        title,
        content,
        category: Some("context".into()),
        source_execution_id: Some(execution_id.to_string()),
        importance: Some(2),
        tags: Some(crate::db::models::Json(vec![
            "session-capture".to_string(),
            hook_event.to_string(),
        ])),
        use_case_id: None,
    };

    let memory = mem_repo::create(pool, input)?;
    // Demote to `working` — these captures haven't proven valuable yet; the
    // standard lifecycle (working → active at access_count >= 5, working →
    // archive after 30 days unaccessed) gates which ones graduate.
    let _ = mem_repo::update_tier(pool, &memory.id, "working");
    Ok(())
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

        // Hook entries use Claude Code 2.1.139's `args: string[]` exec form,
        // not the legacy shell-form `command: "node -e \"...\""`. Verifies on
        // both Stop and PreCompact so a refactor to one without the other
        // is caught.
        for event in ["Stop", "PreCompact"] {
            let hook = &parsed["hooks"][event][0]["hooks"][0];
            assert_eq!(
                hook["command"].as_str(),
                Some("node"),
                "{event} hook should spawn 'node' directly, not via a shell"
            );
            let args = hook["args"].as_array().unwrap_or_else(|| {
                panic!("{event} hook missing args[]; legacy shell-form regression?")
            });
            assert_eq!(args[0].as_str(), Some("-e"));
            assert!(args[1]
                .as_str()
                .map(|s| s.contains("appendFileSync"))
                .unwrap_or(false));
        }
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

    /// End-to-end reactor: enabled env + populated queue → captures land in
    /// `persona_memories` with category=context, tier=working, importance=2.
    #[test]
    fn drain_and_record_creates_working_tier_context_memories() {
        use crate::db::init_test_db;
        use crate::db::models::CreatePersonaInput;
        use crate::db::repos::core::{memories as mem_repo, personas};

        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(SIDECAR_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Drainer Agent".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".personas")).unwrap();
        let qp = queue_path(tmp.path());
        std::fs::write(
            &qp,
            r#"{"hook_event_name":"Stop","session_id":"sess-1","transcript_path":"/tmp/t.jsonl"}
{"hook_event_name":"PreCompact","session_id":"sess-1","trigger":"auto"}
"#,
        )
        .unwrap();

        let exec_id = "exec-test-1";
        let created =
            drain_and_record_session_memories(&pool, tmp.path(), &persona.id, exec_id).unwrap();
        std::env::remove_var(SIDECAR_ENV);

        assert_eq!(created, 2, "both queue entries should land as memories");

        let mems = mem_repo::get_by_execution(&pool, exec_id).unwrap();
        assert_eq!(mems.len(), 2);
        for m in &mems {
            assert_eq!(m.category, "context");
            assert_eq!(m.tier, "working");
            assert_eq!(m.importance, 2);
            assert!(m.title.starts_with("Session capture ("));
            assert!(m.content.contains("hook_event_name"));
            let tags = m.tags.as_ref().unwrap();
            assert!(tags.0.contains(&"session-capture".to_string()));
        }

        // Queue file truncated — second drain is a no-op.
        let again =
            drain_and_record_session_memories(&pool, tmp.path(), &persona.id, exec_id).unwrap();
        assert_eq!(again, 0);
    }

    /// Disabled env + populated queue → no I/O, no DB writes.
    #[test]
    fn drain_and_record_is_noop_when_disabled() {
        use crate::db::init_test_db;
        use crate::db::models::CreatePersonaInput;
        use crate::db::repos::core::{memories as mem_repo, personas};

        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var(SIDECAR_ENV);

        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Disabled Agent".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".personas")).unwrap();
        std::fs::write(queue_path(tmp.path()), r#"{"hook_event_name":"Stop"}"#).unwrap();

        let created =
            drain_and_record_session_memories(&pool, tmp.path(), &persona.id, "exec").unwrap();
        assert_eq!(created, 0);

        // Queue file untouched — no truncation when disabled.
        let leftover = std::fs::read_to_string(queue_path(tmp.path())).unwrap();
        assert!(leftover.contains("hook_event_name"));

        let by_persona = mem_repo::get_by_persona(&pool, &persona.id, None).unwrap();
        assert!(by_persona.is_empty(), "no memory writes when disabled");
    }

    /// Malformed JSON in one line should not block the others.
    #[test]
    fn drain_and_record_skips_malformed_lines() {
        use crate::db::init_test_db;
        use crate::db::models::CreatePersonaInput;
        use crate::db::repos::core::{memories as mem_repo, personas};

        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(SIDECAR_ENV, "1");

        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Resilient Agent".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();

        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".personas")).unwrap();
        std::fs::write(
            queue_path(tmp.path()),
            "not valid json\n{\"hook_event_name\":\"Stop\"}\n",
        )
        .unwrap();

        let created =
            drain_and_record_session_memories(&pool, tmp.path(), &persona.id, "exec-2").unwrap();
        std::env::remove_var(SIDECAR_ENV);
        assert_eq!(created, 1, "valid line should land; malformed line skipped");

        let mems = mem_repo::get_by_execution(&pool, "exec-2").unwrap();
        assert_eq!(mems.len(), 1);
    }
}
