//! Idea Scanner — LLM-powered codebase analysis that generates improvement ideas.
//!
//! Spawns a Claude CLI process with agent-specific prompts. The LLM explores the
//! codebase through the lens of selected scan agents (e.g. "security-auditor",
//! "code-optimizer") and outputs structured idea protocol messages. Ideas are
//! persisted as DevIdea records. Progress streams via Tauri events.

use std::sync::{Arc, Mutex, OnceLock};

use serde::Deserialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use super::cli_stderr::{push_stderr_line, snapshot_stderr};
use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::models::ScanAgentMeta;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::engine::parser::parse_stream_line;
use crate::engine::prompt;
use crate::engine::types::StreamLineType;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// =============================================================================
// Job state
// =============================================================================

#[derive(Clone, Default)]
struct IdeaScanExtra;

static IDEA_SCAN_JOBS: BackgroundJobManager<IdeaScanExtra> = BackgroundJobManager::new(
    "idea-scanner lock poisoned",
    event_name::IDEA_SCAN_STATUS,
    event_name::IDEA_SCAN_OUTPUT,
);

// =============================================================================
// Built-in scan agent registry (loaded from embedded TOML)
// =============================================================================

#[derive(Deserialize)]
struct ScanAgentRegistry {
    agents: Vec<ScanAgentMeta>,
}

static SCAN_AGENTS: OnceLock<Vec<ScanAgentMeta>> = OnceLock::new();

fn get_scan_agents() -> &'static Vec<ScanAgentMeta> {
    SCAN_AGENTS.get_or_init(|| {
        let raw = include_str!("scan_agents.toml");
        let registry: ScanAgentRegistry = toml::from_str(raw).expect("scan_agents.toml is invalid");
        registry.agents
    })
}

// =============================================================================
// Prompt
// =============================================================================

fn build_idea_scan_prompt(
    project_id: &str,
    agents: &[&ScanAgentMeta],
    context_summary: Option<&str>,
    rejected_titles: Option<&str>,
) -> String {
    let mut agent_section = String::new();
    for agent in agents {
        agent_section.push_str(&format!(
            "\n### {} {} ({})\n{}\nExamples: {}\n",
            agent.emoji, agent.label, agent.key, agent.description, agent.examples
        ));
    }

    let context_hint = context_summary
        .map(|s| format!("\n## Existing Context Map\n{s}\n"))
        .unwrap_or_default();

    // Triage learning loop: feed back ideas the human already rejected so the
    // scan stops re-surfacing them (the dev-backlog equivalent of the
    // human-review learned memory).
    let rejected_hint = rejected_titles
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Already Rejected — the human triaged these away; do NOT re-surface them or close variants\n{s}\n"))
        .unwrap_or_default();

    // The `category` token list MUST stay in sync with `db::models::IdeaCategory`.
    // That enum is the canonical vocabulary; legacy values from older code
    // paths or LLM hallucinations are remapped at insert time by
    // `repo::create_idea`. See `db::models::dev_tools` for the mapping.
    format!(
        r#"# Idea Scanner

You are analyzing a codebase to generate actionable improvement ideas. You have been activated with specific scan agent perspectives that determine what to look for.

## Project ID: {project_id}
{context_hint}{rejected_hint}
## Active Scan Agents
{agent_section}

## Your Task

1. **Explore the codebase** using the file system tools available.
2. **Analyze through each agent's lens** — look for the specific patterns each active agent is designed to find.
3. **Generate concrete, actionable ideas** for each finding.
4. **Output ideas** using the protocol below.

## Idea Protocol

Output each idea as a JSON object on its own line:

```
{{"scan_idea": {{"project_id": "{project_id}", "scan_type": "<agent-key>", "category": "<technical|user|business|mastermind>", "title": "Short actionable title", "description": "Detailed description of the improvement", "reasoning": "Why this matters and what evidence you found", "effort": <1-10>, "impact": <1-10>, "risk": <1-10>}}}}
```

Field guidelines:
- **scan_type**: The agent key that found this (e.g., "security-auditor")
- **category**: One of: technical, user, business, mastermind (canonical IdeaCategory enum)
- **title**: Concise action item (max ~80 chars)
- **description**: What to do and how (2-3 sentences)
- **reasoning**: Evidence from the codebase that supports this idea
- **effort**: 1=trivial, 2=minimal, 3=small, 4=easy, 5=moderate, 6=medium, 7=substantial, 8=large, 9=very large, 10=epic
- **impact**: 1=negligible, 2=minimal, 3=minor, 4=low, 5=moderate, 6=notable, 7=significant, 8=major, 9=critical, 10=transformative
- **risk**: 1=none, 2=trivial, 3=low, 4=minor, 5=moderate, 6=notable, 7=high, 8=risky, 9=dangerous, 10=critical

At the end, output a summary:
```
{{"scan_summary": {{"ideas_generated": N, "agents_used": N}}}}
```

## Rules
- Generate 3-8 ideas per active agent
- Be specific — reference actual files, functions, patterns you found
- Focus on actionable improvements, not vague suggestions
- Each idea should be independently implementable
- Prioritize high-impact, low-effort improvements
- Do NOT re-propose anything under "Already Rejected" — the human triaged it away; skip it and its close variants

Begin by exploring the codebase structure."#
    )
}

// =============================================================================
// Protocol parsing
// =============================================================================

#[derive(Debug)]
enum IdeaProtocol {
    Idea {
        project_id: String,
        scan_type: String,
        category: String,
        title: String,
        description: Option<String>,
        reasoning: Option<String>,
        effort: Option<i32>,
        impact: Option<i32>,
        risk: Option<i32>,
    },
    Summary {
        ideas_generated: i32,
        agents_used: i32,
    },
}

/// Score fields (effort/impact/risk) must be present and inside 1..=10. The LLM
/// can hallucinate any integer (negative, 0, 999, INT64_MAX) and that value
/// would otherwise be persisted unchanged. Returns `None` if missing or out of
/// range so the caller can drop the idea entirely.
fn validate_score(idea: &serde_json::Value, field: &str) -> Option<i32> {
    let raw = idea.get(field).and_then(|v| v.as_i64())?;
    if (1..=10).contains(&raw) {
        Some(raw as i32)
    } else {
        None
    }
}

fn parse_idea_protocol(text: &str) -> Option<IdeaProtocol> {
    let val: serde_json::Value = serde_json::from_str(text).ok()?;

    if let Some(idea) = val.get("scan_idea") {
        let title = idea.get("title")?.as_str()?.to_string();
        let effort = validate_score(idea, "effort");
        let impact = validate_score(idea, "impact");
        let risk = validate_score(idea, "risk");

        if effort.is_none() || impact.is_none() || risk.is_none() {
            tracing::warn!(
                title = %title,
                effort = ?idea.get("effort"),
                impact = ?idea.get("impact"),
                risk = ?idea.get("risk"),
                "Dropping idea with missing or out-of-range score (must be 1..=10)"
            );
            return None;
        }

        return Some(IdeaProtocol::Idea {
            project_id: idea.get("project_id")?.as_str()?.to_string(),
            scan_type: idea.get("scan_type")?.as_str()?.to_string(),
            category: idea
                .get("category")
                .and_then(|c| c.as_str())
                .unwrap_or("technical")
                .to_string(),
            title,
            description: idea
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            reasoning: idea
                .get("reasoning")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string()),
            effort,
            impact,
            risk,
        });
    }

    if let Some(summary) = val.get("scan_summary") {
        return Some(IdeaProtocol::Summary {
            ideas_generated: summary
                .get("ideas_generated")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
            agents_used: summary
                .get("agents_used")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32,
        });
    }

    None
}

// =============================================================================
// Tauri commands
// =============================================================================

#[tauri::command]
pub fn dev_tools_list_scan_agents(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ScanAgentMeta>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    Ok(get_scan_agents().clone())
}

#[tauri::command]
pub async fn dev_tools_run_scan(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
    scan_types: Vec<String>,
    _context_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    run_scan_core(app, state.db.clone(), project_id, scan_types).await
}

/// Core scan launcher — shared by the `dev_tools_run_scan` command and the
/// autonomous idea-replenishment subscription (G7,
/// `engine::subscription::IdeaReplenishSubscription`). Creates the scan
/// record, spawns the agent run in the background, and returns the scan id
/// immediately (the scan itself takes minutes).
pub async fn run_scan_core(
    app: tauri::AppHandle,
    db: crate::db::DbPool,
    project_id: String,
    scan_types: Vec<String>,
) -> Result<serde_json::Value, AppError> {
    let project = repo::get_project_by_id(&db, &project_id)?;

    // Resolve agents before creating any DB records to avoid orphaned "running" scans
    let all_agents = get_scan_agents();
    let selected_agents: Vec<&ScanAgentMeta> = all_agents
        .iter()
        .filter(|a| scan_types.contains(&a.key))
        .collect();

    if selected_agents.is_empty() {
        return Err(AppError::Validation("No valid scan agents selected".into()));
    }

    // Create scan record
    let scan_type_str = scan_types.join(",");
    let scan = repo::create_scan(
        &db,
        Some(&project_id),
        &scan_type_str,
        Some("running"),
    )?;
    let scan_id = scan.id.clone();

    let cancel_token = CancellationToken::new();
    IDEA_SCAN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), IdeaScanExtra)?;
    IDEA_SCAN_JOBS.set_status(&app, &scan_id, "running", None);

    // Get existing context summary for richer analysis
    let contexts = repo::list_contexts_by_project(&db, &project_id, None).unwrap_or_default();
    let context_summary = if contexts.is_empty() {
        None
    } else {
        let mut s = String::new();
        for ctx in &contexts {
            s.push_str(&format!(
                "- {} ({}): {}\n",
                ctx.name,
                ctx.file_paths,
                ctx.description.as_deref().unwrap_or(""),
            ));
        }
        Some(s)
    };

    // Triage learning loop: feed rejected ideas back so the scan won't
    // re-surface items the human already triaged away.
    let rejected_titles: Option<String> =
        repo::list_ideas(&db, Some(&project_id), Some("rejected"), None, Some(50), None)
            .ok()
            .filter(|v| !v.is_empty())
            .map(|v| {
                v.iter()
                    .map(|i| format!("- {}", i.title))
                    .collect::<Vec<_>>()
                    .join("\n")
            });

    let prompt_text = build_idea_scan_prompt(
        &project_id,
        &selected_agents,
        context_summary.as_deref(),
        rejected_titles.as_deref(),
    );

    let app_handle = app.clone();
    let pool = db.clone();
    let scan_id_for_task = scan_id.clone();
    let token_for_task = cancel_token;
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();
    let agent_count = selected_agents.len();

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Idea scan cancelled by user".into()))
            }
            res = run_idea_scan(
                &app_handle,
                &scan_id_for_task,
                &pool,
                &project_id,
                &root_path,
                prompt_text,
            ) => res
        };

        match result {
            Ok(idea_count) => {
                // Update scan record with results
                let _ = repo::update_scan(
                    &pool,
                    &scan_id_for_task,
                    Some("complete"),
                    Some(idea_count),
                    None,
                    None,
                    None,
                    None,
                );
                IDEA_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "completed", None);
                let _ = app_handle.emit(
                    event_name::IDEA_SCAN_COMPLETE,
                    json!({ "scan_id": scan_id_for_task, "idea_count": idea_count }),
                );
                crate::notifications::send(
                    &app_handle,
                    "Idea Scan Complete",
                    &format!("{project_name}: {idea_count} ideas from {agent_count} agents.",),
                );
            }
            Err(e) => {
                let msg = format!("{e}");
                let _ = repo::update_scan(
                    &pool,
                    &scan_id_for_task,
                    Some("error"),
                    None,
                    None,
                    None,
                    None,
                    Some(Some(&msg)),
                );
                IDEA_SCAN_JOBS.set_status(
                    &app_handle,
                    &scan_id_for_task,
                    "failed",
                    Some(msg.clone()),
                );
                IDEA_SCAN_JOBS.emit_line(&app_handle, &scan_id_for_task, format!("[Error] {msg}"));
                crate::notifications::send(
                    &app_handle,
                    "Idea Scan Failed",
                    &format!("{project_name}: {msg}"),
                );
            }
        }
    });

    Ok(json!({ "scan_id": scan_id, "scan_type": scan_type_str }))
}

#[tauri::command]
pub async fn dev_tools_cancel_scan(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    scan_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if let Some(token) = IDEA_SCAN_JOBS.get_cancel_token(&scan_id)? {
        token.cancel();
        IDEA_SCAN_JOBS.set_status(&app, &scan_id, "cancelled", None);
        let _ = repo::update_scan(
            &state.db,
            &scan_id,
            Some("error"),
            None,
            None,
            None,
            None,
            Some(Some("Cancelled by user")),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Poll the status of an idea scan job. Used by the frontend to resync state
/// after navigating away during a scan and missing the completion event.
#[tauri::command]
pub fn dev_tools_get_idea_scan_status(
    state: State<'_, Arc<AppState>>,
    scan_id: String,
) -> Result<serde_json::Value, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let jobs = IDEA_SCAN_JOBS.lock()?;
    if let Some(job) = jobs.get(&scan_id) {
        Ok(json!({
            "scan_id": scan_id,
            "status": job.status,
            "error": job.error,
            "lines": job.lines,
        }))
    } else {
        Ok(json!({ "scan_id": scan_id, "status": "not_found" }))
    }
}

// =============================================================================
// Core scan logic
// =============================================================================

async fn run_idea_scan(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
    prompt_text: String,
) -> Result<i32, AppError> {
    IDEA_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Starting idea scan...");

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let exec_dir = std::path::PathBuf::from(root_path);
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
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

    IDEA_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Claude CLI started. Scanning...");

    // Write prompt to stdin in separate task to prevent pipe deadlock
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt_bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    // Capture stderr into a bounded ring buffer AND tee it to the live log
    // panel so the user can see auth errors / rate-limit notices / missing
    // config in real time. The buffer is also attached to any Err the
    // outer scan returns, turning "scan timed out" into actionable detail.
    let stderr_ring: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let ring = stderr_ring.clone();
        let app_clone = app.clone();
        let scan_id_clone = scan_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                push_stderr_line(&ring, &line);
                IDEA_SCAN_JOBS.emit_line(&app_clone, &scan_id_clone, format!("[stderr] {line}"));
            }
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut ideas_created = 0i32;

    // Extended to 20 minutes. If timeout fires but ideas were created,
    // the scan is treated as a partial success (see check below).
    let timeout_duration = std::time::Duration::from_secs(1200);
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

                IDEA_SCAN_JOBS.emit_line(app, scan_id, trimmed.to_string());

                // Parse protocol messages
                for proto_line in trimmed.lines() {
                    let proto_trimmed = proto_line.trim();
                    if let Some(protocol) = parse_idea_protocol(proto_trimmed) {
                        match protocol {
                            IdeaProtocol::Idea {
                                project_id: _pid,
                                scan_type,
                                category,
                                title,
                                description,
                                reasoning,
                                effort,
                                impact,
                                risk,
                            } => {
                                // Use the caller-supplied project_id, not the
                                // LLM-parsed one, to prevent data integrity
                                // violations from hallucinated project IDs.
                                match repo::create_idea(
                                    pool,
                                    Some(project_id),
                                    None, // context_id
                                    &scan_type,
                                    Some(&category),
                                    &title,
                                    description.as_deref(),
                                    reasoning.as_deref(),
                                    Some("pending"),
                                    effort,
                                    impact,
                                    risk,
                                    Some("claude"),
                                    Some("claude-sonnet-4-6"),
                                ) {
                                    Ok(_) => {
                                        ideas_created += 1;
                                        IDEA_SCAN_JOBS.emit_line(
                                            app,
                                            scan_id,
                                            format!("[Idea #{ideas_created}] [{scan_type}] {title}"),
                                        );
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Failed to create idea: {title}");
                                    }
                                }
                            }
                            IdeaProtocol::Summary {
                                ideas_generated,
                                agents_used,
                            } => {
                                IDEA_SCAN_JOBS.emit_line(
                                    app,
                                    scan_id,
                                    format!(
                                        "[Summary] {ideas_generated} ideas from {agents_used} agents"
                                    ),
                                );
                            }
                        }
                    }
                }
            } else {
                let (line_type, _) = parse_stream_line(&line);
                match line_type {
                    StreamLineType::AssistantToolUse {
                        tool_name,
                        input_preview,
                    } => {
                        let preview =
                            crate::utils::text::truncate_on_char_boundary(&input_preview, 100);
                        IDEA_SCAN_JOBS.emit_line(
                            app,
                            scan_id,
                            format!("[Tool] {tool_name}: {preview}"),
                        );
                    }
                    StreamLineType::Result { .. } => {
                        IDEA_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Scan complete.");
                    }
                    _ => {}
                }
            }
        }
    })
    .await;

    if stream_result.is_err() {
        // Timeout fired — explicitly kill the child to prevent zombie processes.
        let _ = child.kill().await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;

        // Smart timeout handling: if ideas were created, treat as partial success.
        if ideas_created > 0 {
            IDEA_SCAN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Warning] Scan timed out after 20 minutes but {ideas_created} ideas were created. Treating as partial success."
                ),
            );
            return Ok(ideas_created);
        }
        // Attach captured stderr so the user can attribute the timeout —
        // an auth error / rate limit / missing config produces stderr
        // long before the 20-minute timeout fires, and we now surface it.
        let stderr_tail = snapshot_stderr(&stderr_ring);
        let detail = if stderr_tail.is_empty() {
            String::from("Idea scan timed out after 20 minutes with no ideas created (no Claude CLI stderr captured)")
        } else {
            format!(
                "Idea scan timed out after 20 minutes with no ideas created. Claude CLI stderr (last {} bytes):\n{stderr_tail}",
                stderr_tail.len()
            )
        };
        IDEA_SCAN_JOBS.emit_line(app, scan_id, format!("[Error] {detail}"));
        return Err(AppError::Internal(detail));
    }

    let exit = child.wait().await;
    // If the CLI exited non-zero AND we have nothing to show for it, treat
    // it as a failure even if stdout closed normally — and attach stderr
    // so the user can see the cause.
    if let Ok(status) = exit {
        if !status.success() && ideas_created == 0 {
            let stderr_tail = snapshot_stderr(&stderr_ring);
            let detail = if stderr_tail.is_empty() {
                format!(
                    "Claude CLI exited with status {} and produced no ideas (no stderr captured)",
                    status.code().unwrap_or(-1)
                )
            } else {
                format!(
                    "Claude CLI exited with status {} and produced no ideas. stderr (last {} bytes):\n{stderr_tail}",
                    status.code().unwrap_or(-1),
                    stderr_tail.len()
                )
            };
            IDEA_SCAN_JOBS.emit_line(app, scan_id, format!("[Error] {detail}"));
            return Err(AppError::Internal(detail));
        }
    }

    IDEA_SCAN_JOBS.emit_line(
        app,
        scan_id,
        format!("[Complete] Generated {ideas_created} ideas"),
    );

    Ok(ideas_created)
}
