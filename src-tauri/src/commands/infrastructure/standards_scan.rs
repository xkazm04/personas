//! Golden-standard scan (Pipeline Stage 3b) — an LLM scan instructed with the
//! shipped golden ruleset (`standards_ruleset.md`). It reads the project's local
//! repo, adapts each rule to the repo's character, and reports per-rule
//! compliance to the `dev_standards` table.
//!
//! Modeled on `idea_scanner.rs`: spawns a Claude CLI process in the repo with a
//! structured prompt and parses `{"standards_finding": {...}}` protocol lines.
//! Progress/completion is surfaced via a raw Tauri event (no event-bus registry
//! entry needed); findings + the `dev_scans` row are the durable record.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::commands::design::analysis::extract_display_text;
use crate::db::models::DevStandard;
use crate::db::repos::dev_tools as repo;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Tauri frontend event channel for standards-scan lifecycle updates.
const STANDARDS_SCAN_STATUS: &str = "dev_tools_standards_scan_status";

const ALLOWED_CATEGORIES: &[&str] = &["precommit", "docs", "code_quality", "branching", "testing"];
const ALLOWED_STATUS: &[&str] = &["present", "partial", "missing"];
const ALLOWED_SEVERITY: &[&str] = &["info", "warn", "critical"];

// ----------------------------------------------------------------------------
// Protocol
// ----------------------------------------------------------------------------

#[derive(Deserialize)]
struct FindingWire {
    rule_key: String,
    category: String,
    title: String,
    status: String,
    #[serde(default)]
    severity: Option<String>,
    #[serde(default)]
    evidence: Option<String>,
    #[serde(default)]
    recommendation: Option<String>,
}

#[derive(Deserialize)]
struct FindingEnvelope {
    standards_finding: FindingWire,
}

fn parse_finding(line: &str) -> Option<FindingWire> {
    if !line.starts_with('{') || !line.contains("standards_finding") {
        return None;
    }
    serde_json::from_str::<FindingEnvelope>(line)
        .ok()
        .map(|e| e.standards_finding)
}

/// Clamp an LLM-supplied token to the allowed set, falling back to `default`.
fn norm(value: &str, allowed: &[&str], default: &str) -> String {
    let v = value.trim().to_lowercase();
    if allowed.contains(&v.as_str()) {
        v
    } else {
        default.to_string()
    }
}

// ----------------------------------------------------------------------------
// Prompt
// ----------------------------------------------------------------------------

fn build_standards_prompt() -> String {
    let ruleset = include_str!("standards_ruleset.md");
    format!(
        r#"You are a senior engineering-standards auditor. Inspect THIS repository
(your working directory is the project root) and assess it against the golden
ruleset below. Adapt each rule to the repo's actual tech stack and conventions.

For EACH rule in the ruleset, after you have looked at the relevant files, emit
exactly one JSON object on its own line (NDJSON), in this shape:

{{"standards_finding": {{"rule_key": "<rule key from the ruleset>", "category": "<precommit|docs|code_quality|branching|testing>", "title": "<short human title>", "status": "<present|partial|missing>", "severity": "<info|warn|critical>", "evidence": "<what you found / didn't find, with paths>", "recommendation": "<one concrete next step>"}}}}

Rules:
- Emit one finding per rule_key in the ruleset — no more, no less. Do not invent rule keys.
- Base every status on real evidence from the repo (read config files, CI, docs, tests). Do not guess.
- Keep evidence and recommendation to one sentence each.
- Output ONLY the NDJSON finding lines (plus any tool use needed to inspect files). No prose summary.

=== GOLDEN RULESET ===
{ruleset}
"#
    )
}

// ----------------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn dev_tools_run_standards_scan(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;

    // Fresh scan replaces the prior findings.
    let _ = repo::clear_standards_for_project(&state.db, &project_id);
    let scan = repo::create_scan(&state.db, Some(&project_id), "standards", Some("running"))?;
    let scan_id = scan.id.clone();

    let _ = app.emit(
        STANDARDS_SCAN_STATUS,
        json!({ "scan_id": scan_id, "project_id": project_id, "status": "running" }),
    );

    let prompt_text = build_standards_prompt();
    let app_handle = app.clone();
    let pool = state.db.clone();
    let scan_id_task = scan_id.clone();
    let project_id_task = project_id.clone();
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();

    tokio::spawn(async move {
        let result = run_standards_scan(&pool, &scan_id_task, &project_id_task, &root_path, prompt_text).await;
        match result {
            Ok(count) => {
                let _ = repo::update_scan(&pool, &scan_id_task, Some("complete"), Some(count), None, None, None, None);
                let _ = app_handle.emit(
                    STANDARDS_SCAN_STATUS,
                    json!({ "scan_id": scan_id_task, "project_id": project_id_task, "status": "complete", "count": count }),
                );
                crate::notifications::send(
                    &app_handle,
                    "Standards Scan Complete",
                    &format!("{project_name}: {count} rules assessed."),
                );
            }
            Err(e) => {
                let msg = format!("{e}");
                let _ = repo::update_scan(&pool, &scan_id_task, Some("error"), None, None, None, None, Some(Some(&msg)));
                let _ = app_handle.emit(
                    STANDARDS_SCAN_STATUS,
                    json!({ "scan_id": scan_id_task, "project_id": project_id_task, "status": "error", "error": msg }),
                );
            }
        }
    });

    Ok(json!({ "scan_id": scan_id }))
}

#[tauri::command]
pub async fn dev_tools_list_standards(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevStandard>, AppError> {
    require_auth(&state).await?;
    repo::list_standards_by_project(&state.db, &project_id)
}

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------

async fn run_standards_scan(
    pool: &crate::db::DbPool,
    scan_id: &str,
    project_id: &str,
    root_path: &str,
    prompt_text: String,
) -> Result<i32, AppError> {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(std::path::PathBuf::from(root_path))
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
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code".into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    // Drain stderr into a bounded buffer for error attribution.
    let stderr_buf: Arc<std::sync::Mutex<String>> = Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(mut s) = buf.lock() {
                    if s.len() < 16 * 1024 {
                        s.push_str(&line);
                        s.push('\n');
                    }
                }
            }
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut count = 0i32;
    let timeout = std::time::Duration::from_secs(1200);
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "scanner",
        trigger_kind: "standards_scan",
        model: Some("claude-sonnet-4-6"),
        project_id: Some(project_id),
        persona_id: None,
    };
    let streamed = tokio::time::timeout(timeout, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            // tiger #1: record the headless spend `result` line (no-op otherwise).
            crate::db::repos::llm_spend::observe_line(pool, &spend_ctx, &line);
            if let Some(text) = extract_display_text(&line) {
                for proto in text.lines() {
                    let proto = proto.trim();
                    if let Some(f) = parse_finding(proto) {
                        let category = norm(&f.category, ALLOWED_CATEGORIES, "code_quality");
                        let status = norm(&f.status, ALLOWED_STATUS, "missing");
                        let severity = norm(f.severity.as_deref().unwrap_or("info"), ALLOWED_SEVERITY, "info");
                        match repo::create_standard(
                            pool,
                            project_id,
                            Some(scan_id),
                            f.rule_key.trim(),
                            &category,
                            f.title.trim(),
                            &status,
                            &severity,
                            f.evidence.as_deref(),
                            f.recommendation.as_deref(),
                        ) {
                            Ok(_) => count += 1,
                            Err(e) => tracing::warn!(error = %e, "failed to persist standards finding"),
                        }
                    }
                }
            }
        }
    })
    .await;

    let _ = child.kill().await;

    if streamed.is_err() && count == 0 {
        let tail = stderr_buf.lock().map(|s| s.clone()).unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Standards scan timed out with no findings. {}",
            tail.chars().take(500).collect::<String>()
        )));
    }

    Ok(count)
}
