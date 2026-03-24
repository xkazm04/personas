//! Idea Scanner — LLM-powered codebase analysis that generates improvement ideas.
//!
//! Spawns a Claude CLI process with agent-specific prompts. The LLM explores the
//! codebase through the lens of selected scan agents (e.g. "security-auditor",
//! "code-optimizer") and outputs structured idea protocol messages. Ideas are
//! persisted as DevIdea records. Progress streams via Tauri events.

use std::sync::Arc;

use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

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
// Built-in scan agent registry
// =============================================================================

fn get_scan_agents() -> Vec<ScanAgentMeta> {
    vec![
        ScanAgentMeta {
            key: "code-optimizer".into(),
            label: "Code Optimizer".into(),
            emoji: "⚡".into(),
            abbreviation: "OPT".into(),
            color: "#3B82F6".into(),
            category_group: "technical".into(),
            description: "Identifies performance bottlenecks and optimization opportunities".into(),
            examples: "Reduce bundle size, Optimize database queries, Improve render performance"
                .into(),
        },
        ScanAgentMeta {
            key: "security-auditor".into(),
            label: "Security Auditor".into(),
            emoji: "🔒".into(),
            abbreviation: "SEC".into(),
            color: "#EF4444".into(),
            category_group: "technical".into(),
            description: "Identifies security vulnerabilities and best practice violations".into(),
            examples: "XSS prevention, SQL injection risks, Authentication gaps".into(),
        },
        ScanAgentMeta {
            key: "architecture-analyst".into(),
            label: "Architecture Analyst".into(),
            emoji: "🏗️".into(),
            abbreviation: "ARC".into(),
            color: "#8B5CF6".into(),
            category_group: "technical".into(),
            description: "Evaluates system architecture and suggests structural improvements"
                .into(),
            examples: "Reduce coupling, Improve modularity, Better separation of concerns".into(),
        },
        ScanAgentMeta {
            key: "test-strategist".into(),
            label: "Test Strategist".into(),
            emoji: "🧪".into(),
            abbreviation: "TST".into(),
            color: "#10B981".into(),
            category_group: "technical".into(),
            description: "Identifies gaps in test coverage and suggests testing strategies".into(),
            examples: "Missing edge cases, Integration test gaps, E2E scenarios".into(),
        },
        ScanAgentMeta {
            key: "dependency-auditor".into(),
            label: "Dependency Auditor".into(),
            emoji: "📦".into(),
            abbreviation: "DEP".into(),
            color: "#F59E0B".into(),
            category_group: "technical".into(),
            description: "Analyzes dependencies for updates, vulnerabilities, and bloat".into(),
            examples: "Outdated packages, Unused dependencies, Version conflicts".into(),
        },
        ScanAgentMeta {
            key: "ux-reviewer".into(),
            label: "UX Reviewer".into(),
            emoji: "🎨".into(),
            abbreviation: "UXR".into(),
            color: "#EC4899".into(),
            category_group: "user".into(),
            description: "Reviews user experience patterns and suggests improvements".into(),
            examples: "Loading states, Error handling UX, Navigation clarity".into(),
        },
        ScanAgentMeta {
            key: "accessibility-checker".into(),
            label: "Accessibility Checker".into(),
            emoji: "♿".into(),
            abbreviation: "A11Y".into(),
            color: "#6366F1".into(),
            category_group: "user".into(),
            description: "Identifies accessibility issues and WCAG compliance gaps".into(),
            examples: "Missing ARIA labels, Color contrast, Keyboard navigation".into(),
        },
        ScanAgentMeta {
            key: "mobile-specialist".into(),
            label: "Mobile Specialist".into(),
            emoji: "📱".into(),
            abbreviation: "MOB".into(),
            color: "#14B8A6".into(),
            category_group: "user".into(),
            description: "Evaluates mobile experience and responsive design".into(),
            examples: "Touch targets, Viewport handling, Mobile performance".into(),
        },
        ScanAgentMeta {
            key: "error-handler".into(),
            label: "Error Handler".into(),
            emoji: "🚨".into(),
            abbreviation: "ERR".into(),
            color: "#F97316".into(),
            category_group: "user".into(),
            description: "Reviews error handling, recovery flows, and user messaging".into(),
            examples: "Graceful degradation, Retry logic, Error boundaries".into(),
        },
        ScanAgentMeta {
            key: "onboarding-designer".into(),
            label: "Onboarding Designer".into(),
            emoji: "🎯".into(),
            abbreviation: "ONB".into(),
            color: "#06B6D4".into(),
            category_group: "user".into(),
            description: "Evaluates first-time user experience and onboarding flows".into(),
            examples: "Setup wizards, Progressive disclosure, Empty states".into(),
        },
        ScanAgentMeta {
            key: "feature-scout".into(),
            label: "Feature Scout".into(),
            emoji: "🔭".into(),
            abbreviation: "SCT".into(),
            color: "#8B5CF6".into(),
            category_group: "business".into(),
            description: "Identifies missing features and enhancement opportunities".into(),
            examples: "Competitive features, User-requested features, Market gaps".into(),
        },
        ScanAgentMeta {
            key: "monetization-advisor".into(),
            label: "Monetization Advisor".into(),
            emoji: "💰".into(),
            abbreviation: "MON".into(),
            color: "#F59E0B".into(),
            category_group: "business".into(),
            description: "Suggests revenue optimization and pricing strategies".into(),
            examples: "Premium features, Usage limits, Conversion funnels".into(),
        },
        ScanAgentMeta {
            key: "analytics-planner".into(),
            label: "Analytics Planner".into(),
            emoji: "📊".into(),
            abbreviation: "ANA".into(),
            color: "#3B82F6".into(),
            category_group: "business".into(),
            description: "Plans analytics instrumentation and data collection".into(),
            examples: "Event tracking, Funnel analysis, User behavior insights".into(),
        },
        ScanAgentMeta {
            key: "documentation-auditor".into(),
            label: "Documentation Auditor".into(),
            emoji: "📝".into(),
            abbreviation: "DOC".into(),
            color: "#10B981".into(),
            category_group: "business".into(),
            description: "Reviews documentation completeness and quality".into(),
            examples: "API docs, README quality, Code comments".into(),
        },
        ScanAgentMeta {
            key: "growth-hacker".into(),
            label: "Growth Hacker".into(),
            emoji: "🚀".into(),
            abbreviation: "GRW".into(),
            color: "#EC4899".into(),
            category_group: "business".into(),
            description: "Identifies growth opportunities and viral mechanics".into(),
            examples: "Sharing features, Referral programs, Network effects".into(),
        },
        ScanAgentMeta {
            key: "tech-debt-tracker".into(),
            label: "Tech Debt Tracker".into(),
            emoji: "🏦".into(),
            abbreviation: "TDT".into(),
            color: "#EF4444".into(),
            category_group: "mastermind".into(),
            description: "Catalogs technical debt and prioritizes repayment".into(),
            examples: "Legacy code, Missing abstractions, Workarounds".into(),
        },
        ScanAgentMeta {
            key: "innovation-catalyst".into(),
            label: "Innovation Catalyst".into(),
            emoji: "💡".into(),
            abbreviation: "INN".into(),
            color: "#F59E0B".into(),
            category_group: "mastermind".into(),
            description: "Suggests innovative approaches and paradigm shifts".into(),
            examples: "AI integration, New architectures, Emerging patterns".into(),
        },
        ScanAgentMeta {
            key: "risk-assessor".into(),
            label: "Risk Assessor".into(),
            emoji: "⚠️".into(),
            abbreviation: "RSK".into(),
            color: "#F97316".into(),
            category_group: "mastermind".into(),
            description: "Identifies project risks and mitigation strategies".into(),
            examples: "Single points of failure, Scaling risks, Data loss scenarios".into(),
        },
        ScanAgentMeta {
            key: "integration-planner".into(),
            label: "Integration Planner".into(),
            emoji: "🔗".into(),
            abbreviation: "INT".into(),
            color: "#6366F1".into(),
            category_group: "mastermind".into(),
            description: "Plans system integrations and API design".into(),
            examples: "Third-party APIs, Webhook design, Data synchronization".into(),
        },
        ScanAgentMeta {
            key: "devops-optimizer".into(),
            label: "DevOps Optimizer".into(),
            emoji: "🔧".into(),
            abbreviation: "OPS".into(),
            color: "#14B8A6".into(),
            category_group: "mastermind".into(),
            description: "Optimizes build, deploy, and operations workflows".into(),
            examples: "CI/CD pipelines, Docker optimization, Monitoring gaps".into(),
        },
    ]
}

// =============================================================================
// Prompt
// =============================================================================

fn build_idea_scan_prompt(
    project_id: &str,
    agents: &[&ScanAgentMeta],
    context_summary: Option<&str>,
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

    format!(
        r#"# Idea Scanner

You are analyzing a codebase to generate actionable improvement ideas. You have been activated with specific scan agent perspectives that determine what to look for.

## Project ID: {project_id}
{context_hint}
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
- **category**: One of: technical, user, business, mastermind
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

fn parse_idea_protocol(text: &str) -> Option<IdeaProtocol> {
    let val: serde_json::Value = serde_json::from_str(text).ok()?;

    if let Some(idea) = val.get("scan_idea") {
        return Some(IdeaProtocol::Idea {
            project_id: idea.get("project_id")?.as_str()?.to_string(),
            scan_type: idea.get("scan_type")?.as_str()?.to_string(),
            category: idea
                .get("category")
                .and_then(|c| c.as_str())
                .unwrap_or("technical")
                .to_string(),
            title: idea.get("title")?.as_str()?.to_string(),
            description: idea
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            reasoning: idea
                .get("reasoning")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string()),
            effort: idea
                .get("effort")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32),
            impact: idea
                .get("impact")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32),
            risk: idea.get("risk").and_then(|v| v.as_i64()).map(|v| v as i32),
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
    Ok(get_scan_agents())
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

    let project = repo::get_project_by_id(&state.db, &project_id)?;

    // Create scan record
    let scan_type_str = scan_types.join(",");
    let scan = repo::create_scan(
        &state.db,
        Some(&project_id),
        &scan_type_str,
        Some("running"),
    )?;
    let scan_id = scan.id.clone();

    let cancel_token = CancellationToken::new();
    IDEA_SCAN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), IdeaScanExtra)?;
    IDEA_SCAN_JOBS.set_status(&app, &scan_id, "running", None);

    // Resolve agents
    let all_agents = get_scan_agents();
    let selected_agents: Vec<&ScanAgentMeta> = all_agents
        .iter()
        .filter(|a| scan_types.contains(&a.key))
        .collect();

    if selected_agents.is_empty() {
        IDEA_SCAN_JOBS.set_status(
            &app,
            &scan_id,
            "failed",
            Some("No valid agents selected".into()),
        );
        return Err(AppError::Validation("No valid scan agents selected".into()));
    }

    // Get existing context summary for richer analysis
    let contexts = repo::list_contexts_by_project(&state.db, &project_id, None).unwrap_or_default();
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

    let prompt_text =
        build_idea_scan_prompt(&project_id, &selected_agents, context_summary.as_deref());

    let app_handle = app.clone();
    let pool = state.db.clone();
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

// =============================================================================
// Core scan logic
// =============================================================================

async fn run_idea_scan(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    _project_id: &str,
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

    let mut ideas_created = 0i32;

    let timeout_duration = std::time::Duration::from_secs(300); // 5 min
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
                                project_id: pid,
                                scan_type,
                                category,
                                title,
                                description,
                                reasoning,
                                effort,
                                impact,
                                risk,
                            } => {
                                match repo::create_idea(
                                    pool,
                                    Some(&pid),
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
                        let preview = &input_preview[..input_preview.len().min(100)];
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

    let _ = child.wait().await;

    if stream_result.is_err() {
        return Err(AppError::Internal(
            "Idea scan timed out after 5 minutes".into(),
        ));
    }

    IDEA_SCAN_JOBS.emit_line(
        app,
        scan_id,
        format!("[Complete] Generated {ideas_created} ideas"),
    );

    Ok(ideas_created)
}
