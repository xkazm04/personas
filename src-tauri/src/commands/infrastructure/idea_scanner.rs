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
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use super::cli_stderr::{push_stderr_line, snapshot_stderr};
use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::models::ScanAgentMeta;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::engine::parser::parse_stream_line;
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
    live_titles: Option<&str>,
    outcomes: Option<&str>,
    team_ledger: Option<&str>,
    scoped: bool,
    target_count: Option<i32>,
) -> String {
    let mut agent_section = String::new();
    for agent in agents {
        agent_section.push_str(&format!(
            "\n### {} {} ({})\n{}\nExamples: {}\n",
            agent.emoji, agent.label, agent.key, agent.description, agent.examples
        ));
    }

    let context_hint = context_summary
        .map(|s| {
            if scoped {
                format!("\n## Contexts In Scope — analyze ONLY these areas of the codebase; ignore everything outside them\n{s}\n")
            } else {
                format!("\n## Existing Context Map\n{s}\n")
            }
        })
        .unwrap_or_default();

    // Granularity / target volume (optional). Aims the run at a desired number
    // of findings without padding — quality stays the gate.
    let granularity_hint = match target_count {
        Some(n) if n > 0 => {
            let scope_word = if scoped { "per context in scope" } else { "in total" };
            format!("\n## Target volume\nAim for roughly {n} high-quality ideas {scope_word}. Favor signal over volume — produce fewer than {n} if the code doesn't warrant them; never pad with low-value or speculative findings.\n")
        }
        _ => String::new(),
    };

    // Triage learning loop: feed back ideas the human already rejected so the
    // scan stops re-surfacing them (the dev-backlog equivalent of the
    // human-review learned memory).
    let rejected_hint = rejected_titles
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Already Rejected — the human triaged these away; do NOT re-surface them or close variants\n{s}\n"))
        .unwrap_or_default();

    // Duplicate suppression (prompt half — see run_scan_core). The backlog
    // already holds these; re-proposing one is wasted work that the dedup gate
    // will drop on insert anyway.
    let live_hint = live_titles
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Already In The Backlog — these are open or accepted right now; do NOT propose them again or reword them as new ideas. Find NEW ground.\n{s}\n"))
        .unwrap_or_default();

    // The owning team's shared ledger — settled decisions + hard constraints
    // from prior increments. Ideas must BUILD ON these, never contradict or
    // re-propose them.
    // What earlier runs actually produced. Ideas should extend or repair these,
    // not rediscover them.
    let outcome_hint = outcomes
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Recent Run Outcomes - what shipped and what failed here lately (build on these; do NOT re-propose completed work)\n{s}\n"))
        .unwrap_or_default();

    let ledger_hint = team_ledger
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Team Shared Knowledge — settled decisions & constraints from prior work (build on these; do NOT contradict or re-propose)\n{s}\n"))
        .unwrap_or_default();

    // The `category` token list MUST stay in sync with `db::models::IdeaCategory`.
    // That enum is the canonical vocabulary; legacy values from older code
    // paths or LLM hallucinations are remapped at insert time by
    // `repo::create_idea`. See `db::models::dev_tools` for the mapping.
    format!(
        r#"# Idea Scanner

You are analyzing a codebase to generate actionable improvement ideas. You have been activated with specific scan agent perspectives that determine what to look for.

## Project ID: {project_id}
{context_hint}{rejected_hint}{live_hint}{outcome_hint}{ledger_hint}
## Active Scan Agents
{agent_section}
{granularity_hint}
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
    /// Backlog-triage decision from the Product Strategist job: rank a pending
    /// idea (`priority` 1 = do next) or reject it (with a reason that feeds the
    /// scanner-suppress + team-memory learning loops).
    Triage {
        idea_id: String,
        action: String,
        priority: Option<i32>,
        reason: Option<String>,
    },
    /// Strategist goal-relation: writes a `depends`/`follows` edge between two
    /// OPEN goals so autonomously-promoted goals stop living as unrelated
    /// islands (the edges render on the Goals Map and drive Now/Next).
    RelateGoals {
        from_goal_id: String,
        to_goal_id: String,
        relation: String,
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

    if let Some(triage) = val.get("triage") {
        let idea_id = triage.get("idea_id")?.as_str()?.to_string();
        let action = triage.get("action")?.as_str()?.to_string();
        if !matches!(action.as_str(), "rank" | "reject") {
            return None;
        }
        return Some(IdeaProtocol::Triage {
            idea_id,
            action,
            priority: triage
                .get("priority")
                .and_then(|p| p.as_i64())
                .filter(|p| (1..=20).contains(p))
                .map(|p| p as i32),
            reason: triage
                .get("reason")
                .and_then(|r| r.as_str())
                .map(|s| s.to_string()),
        });
    }

    if let Some(rel) = val.get("relate_goals") {
        let from_goal_id = rel.get("from_goal_id")?.as_str()?.to_string();
        let to_goal_id = rel.get("to_goal_id")?.as_str()?.to_string();
        let relation = rel.get("relation")?.as_str()?.to_string();
        if from_goal_id == to_goal_id || !matches!(relation.as_str(), "depends" | "follows") {
            return None;
        }
        return Some(IdeaProtocol::RelateGoals {
            from_goal_id,
            to_goal_id,
            relation,
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
    context_id: Option<String>,
    context_ids: Option<Vec<String>>,
    target_count: Option<i32>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    // Multi-select scope takes precedence; fall back to the single legacy
    // `context_id` (per-context "scan this context" + auto-scan callers).
    let ids = context_ids
        .filter(|v| !v.is_empty())
        .or_else(|| context_id.filter(|c| !c.is_empty()).map(|c| vec![c]));
    run_scan_core(app, state.db.clone(), project_id, scan_types, ids, target_count).await
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
    // When `Some(non-empty)`, scope the scan to exactly these context ids and
    // instruct the agents to focus only on them. `None`/empty = whole project.
    context_ids: Option<Vec<String>>,
    // Optional target number of findings (granularity); injected into the prompt.
    target_count: Option<i32>,
) -> Result<serde_json::Value, AppError> {
    let project = repo::get_project_by_id(&db, &project_id)?;

    // Backlog aging (Phase 1, docs/plans/backlog-memory-loop.md): before
    // measuring backpressure, retire pending ideas that have sat untouched past
    // the stale window and never became work. Reversible (status → 'archived',
    // row + dedup_key intact), so this frees the cap for fresh signal without
    // ever deleting a decision or reopening the duplication door.
    match repo::archive_stale_ideas(&db, Some(&project_id), crate::engine::dispatch::IDEA_STALE_DAYS) {
        Ok(n) if n > 0 => {
            tracing::info!(project_id = %project_id, archived = n, "Archived stale pending ideas before scan");
        }
        Err(e) => tracing::warn!(error = %e, "Stale-idea archival failed; continuing scan"),
        _ => {}
    }

    // Backlog backpressure: skip the whole scan round when the project's
    // pending backlog is already saturated — producers must not stack ideas
    // faster than triage + promotion can drain them (mirrors the per-idea
    // guard at the `propose_backlog` dispatch chokepoint).
    let pending: i64 = db
        .get()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND status = 'pending'",
                rusqlite::params![project_id],
                |r| r.get(0),
            )
            .ok()
        })
        .unwrap_or(0);
    if pending >= crate::engine::dispatch::IDEA_BACKLOG_CAP {
        return Err(AppError::Validation(format!(
            "Idea scan skipped: backlog saturated ({pending} pending ideas ≥ cap {}). \
             Triage / promote the existing backlog first.",
            crate::engine::dispatch::IDEA_BACKLOG_CAP
        )));
    }

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

    // Get existing context summary for richer analysis. When the caller scoped
    // the scan to specific contexts, summarize ONLY those and tell the agents to
    // focus there (the prompt flips its heading accordingly).
    let all_contexts = repo::list_contexts_by_project(&db, &project_id, None).unwrap_or_default();
    let scoped = context_ids.as_ref().is_some_and(|v| !v.is_empty());
    let contexts: Vec<_> = match &context_ids {
        Some(ids) if !ids.is_empty() => all_contexts
            .into_iter()
            .filter(|c| ids.contains(&c.id))
            .collect(),
        _ => all_contexts,
    };
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

    // Duplicate suppression, prompt half (Phase 1): the `dedup_key` guard in
    // `create_idea_deduped` catches exact re-proposals, but only AFTER the model
    // has spent tokens writing them. Showing the model what the backlog already
    // holds (pending + accepted, the LIVE items) makes it spend those tokens on
    // new ground instead — and catches paraphrases a normalized key cannot.
    let live_titles: Option<String> = {
        let mut live: Vec<String> = Vec::new();
        for status in ["pending", "accepted"] {
            if let Ok(rows) =
                repo::list_ideas(&db, Some(&project_id), Some(status), None, Some(40), None)
            {
                live.extend(rows.into_iter().map(|i| format!("- {}", i.title)));
            }
        }
        (!live.is_empty()).then(|| live.join("\n"))
    };

    // Cooperation through memory: when the project is team-owned, give the
    // scan the team's shared ledger (decisions/constraints from prior work) so
    // new ideas build on what shipped and respect settled constraints instead
    // of re-proposing or contradicting them.
    let team_ledger: Option<String> = project.team_id.as_deref().and_then(|team_id| {
        crate::db::repos::resources::team_memories::get_for_injection(&db, team_id, 12)
            .ok()
            .filter(|m| !m.is_empty())
            .map(|m| {
                m.iter()
                    .map(|tm| format!("- [{}] {}: {}", tm.category, tm.title, tm.content))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
    });

    // Loop closure (docs/plans/backlog-memory-loop.md Phase 2): what recent
    // runs actually LEARNED. Rejected titles tell the scan what not to propose;
    // outcomes tell it what already shipped and what already failed, so the next
    // round of ideas builds on real results instead of re-deriving them.
    let outcomes: Option<String> = crate::db::repos::dev_memories::list_recent_by_kind(
        &db,
        &project_id,
        "task_outcome",
        12,
    )
    .ok()
    .and_then(|rows| crate::db::repos::dev_memories::render_for_prompt(&rows, 1_200));

    let prompt_text = build_idea_scan_prompt(
        &project_id,
        &selected_agents,
        context_summary.as_deref(),
        rejected_titles.as_deref(),
        live_titles.as_deref(),
        outcomes.as_deref(),
        team_ledger.as_deref(),
        scoped,
        target_count,
    );

    // Scope token for the dedup key: the same title raised against two
    // different areas of the codebase is genuinely two ideas, so scope is part
    // of an idea's identity. Sorted for stability across call orderings.
    let scope_token = match &context_ids {
        Some(ids) if !ids.is_empty() => {
            let mut sorted = ids.clone();
            sorted.sort();
            sorted.join("+")
        }
        _ => "all".to_string(),
    };

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
                &scope_token,
            ) => res
        };

        match result {
            Ok(counts) => {
                // Update scan record with results -- `idea_count` for a normal
                // scan means ideas created, not triage/goal-relation actions.
                let idea_count = counts.ideas_created;
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

/// Separate tallies for the three protocol outcomes `run_idea_scan` handles.
/// A normal scan (`run_scan_core`) only creates ideas; a backlog-triage run
/// (`run_backlog_triage`) only applies triage/goal-relation decisions -- but
/// both funnel through the same stream loop and previously shared one
/// `ideas_created` counter, so a triage run's "decisions" and a scan's
/// incidental protocol lines could inflate/misreport each other's number.
#[derive(Debug, Clone, Copy, Default)]
struct IdeaScanCounts {
    ideas_created: i32,
    /// Ideas the model proposed that the dedup gate suppressed as already-held
    /// (any status). Surfaced so suppression is visible, never silent.
    ideas_deduped: i32,
    triage_decisions: i32,
    relations_created: i32,
}

impl IdeaScanCounts {
    /// Total protocol actions applied, regardless of kind -- used for the
    /// "did anything happen" checks (partial-success-on-timeout, non-zero
    /// exit tolerance) where the kind doesn't matter, only whether progress
    /// was made.
    fn total(&self) -> i32 {
        self.ideas_created + self.ideas_deduped + self.triage_decisions + self.relations_created
    }
}

async fn run_idea_scan(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
    prompt_text: String,
    // Context scoping of this scan, folded into every idea's dedup key so the
    // same title raised for two different areas stays two distinct ideas.
    scope_token: &str,
) -> Result<IdeaScanCounts, AppError> {
    IDEA_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Starting idea scan...");

    let exec_dir = std::path::PathBuf::from(root_path);
    let mut child = crate::engine::cli_process::spawn_headless_claude(
        prompt_text,
        "claude-sonnet-4-6",
        &[],
        Some(&exec_dir),
        true,
    )?;

    IDEA_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Claude CLI started. Scanning...");

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

    let mut counts = IdeaScanCounts::default();

    // Extended to 20 minutes. If timeout fires but ideas were created,
    // the scan is treated as a partial success (see check below).
    let timeout_duration = std::time::Duration::from_secs(1200);
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "scanner",
        trigger_kind: "idea_scan",
        model: Some("claude-sonnet-4-6"),
        project_id: Some(project_id),
        persona_id: None,
    };
    let stream_result = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            // tiger #1: record the headless spend `result` line (no-op otherwise).
            crate::db::repos::llm_spend::observe_line(pool, &spend_ctx, &line);

            if let Some(text) = extract_display_text(&line) {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }

                // Verbose model prose → bounded ring only; the milestones below
                // carry the high-level state the live panel needs.
                IDEA_SCAN_JOBS.record_line(scan_id, trimmed.to_string());

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
                                // Guarded insert (Phase 1): the same gate the
                                // findings spine uses. An idea whose dedup key
                                // already exists for this project in ANY status
                                // — pending, accepted, rejected, archived — is
                                // suppressed rather than stacked, so re-scans
                                // stop rebuilding the same backlog.
                                let dedup_key =
                                    repo::scan_dedup_key(&scan_type, Some(scope_token), &title);
                                match repo::create_idea_deduped(
                                    pool,
                                    project_id,
                                    None, // context_id
                                    &scan_type,
                                    Some(&category),
                                    &title,
                                    description.as_deref(),
                                    reasoning.as_deref(),
                                    effort,
                                    impact,
                                    risk,
                                    Some("claude"),
                                    Some("claude-sonnet-4-6"),
                                    &dedup_key,
                                ) {
                                    Ok(None) => {
                                        counts.ideas_deduped += 1;
                                        IDEA_SCAN_JOBS.emit_line(
                                            app,
                                            scan_id,
                                            format!("[Duplicate] [{scan_type}] {title} — already in the backlog, suppressed"),
                                        );
                                    }
                                    Ok(Some(_)) => {
                                        counts.ideas_created += 1;
                                        IDEA_SCAN_JOBS.emit_line(
                                            app,
                                            scan_id,
                                            format!("[Idea #{}] [{scan_type}] {title}", counts.ideas_created),
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
                            IdeaProtocol::Triage {
                                idea_id,
                                action,
                                priority,
                                reason,
                            } => {
                                if apply_triage_decision(
                                    pool, project_id, &idea_id, &action, priority,
                                    reason.as_deref(),
                                ) {
                                    counts.triage_decisions += 1;
                                    IDEA_SCAN_JOBS.emit_line(
                                        app,
                                        scan_id,
                                        format!("[Triage] {action} {idea_id} (priority={priority:?})"),
                                    );
                                }
                            }
                            IdeaProtocol::RelateGoals {
                                from_goal_id,
                                to_goal_id,
                                relation,
                            } => {
                                if apply_goal_relation(
                                    pool, project_id, &from_goal_id, &to_goal_id, &relation,
                                ) {
                                    counts.relations_created += 1;
                                    IDEA_SCAN_JOBS.emit_line(
                                        app,
                                        scan_id,
                                        format!("[Relate] {from_goal_id} {relation} {to_goal_id}"),
                                    );
                                }
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

        // Smart timeout handling: if anything was created/applied, treat as partial success.
        if counts.total() > 0 {
            IDEA_SCAN_JOBS.emit_line(
                app,
                scan_id,
                format!(
                    "[Warning] Scan timed out after 20 minutes but {} ideas / {} duplicates suppressed / {} triage decisions / {} goal relations were applied. Treating as partial success.",
                    counts.ideas_created, counts.ideas_deduped, counts.triage_decisions, counts.relations_created
                ),
            );
            return Ok(counts);
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
        if !status.success() && counts.total() == 0 {
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
        format!(
            "[Complete] Generated {} ideas ({} suppressed as duplicates), applied {} triage decisions, {} goal relations",
            counts.ideas_created, counts.ideas_deduped, counts.triage_decisions, counts.relations_created
        ),
    );

    Ok(counts)
}

// =============================================================================
// Backlog triage — the Product Strategist's prioritization job (roster redesign)
// =============================================================================

/// Apply one strategist triage decision. Validates the idea belongs to THIS
/// project and is still pending (a hallucinated id can't touch other projects).
/// `rank` writes `dev_ideas.priority`; `reject` persists the rejection + the
/// shared-team constraint memory (the same learning loop human triage uses).
fn apply_triage_decision(
    pool: &crate::db::DbPool,
    project_id: &str,
    idea_id: &str,
    action: &str,
    priority: Option<i32>,
    reason: Option<&str>,
) -> bool {
    let idea = match repo::get_idea_by_id(pool, idea_id) {
        Ok(i) => i,
        Err(_) => return false,
    };
    if idea.project_id.as_deref() != Some(project_id) || idea.status != "pending" {
        return false;
    }
    match action {
        "rank" => {
            let Some(p) = priority else { return false };
            repo::set_idea_priority(pool, idea_id, Some(p)).is_ok()
        }
        "reject" => {
            match repo::update_idea(
                pool, idea_id, None, None, Some("rejected"), None, None, None, None,
                Some(reason),
            ) {
                Ok(updated) => {
                    super::dev_tools::record_idea_decision_by(
                        pool, &updated, "rejected", "Strategist",
                    );
                    true
                }
                Err(_) => false,
            }
        }
        _ => false,
    }
}

/// Apply a strategist goal-relation. Both goals must belong to THIS project
/// (hallucinated ids can't bridge projects). `depends` maps to the schema's
/// `blocks` edge (cycle-checked by the repo); `follows` is the sequence edge.
fn apply_goal_relation(
    pool: &crate::db::DbPool,
    project_id: &str,
    from_goal_id: &str,
    to_goal_id: &str,
    relation: &str,
) -> bool {
    let in_project = |gid: &str| {
        pool.get().ok().and_then(|conn| {
            conn.query_row(
                "SELECT 1 FROM dev_goals WHERE id = ?1 AND project_id = ?2",
                rusqlite::params![gid, project_id],
                |_| Ok(true),
            )
            .ok()
        })
        .unwrap_or(false)
    };
    if !in_project(from_goal_id) || !in_project(to_goal_id) {
        return false;
    }
    let dep_type = if relation == "depends" { "blocks" } else { "follows" };
    match repo::add_goal_dependency(pool, from_goal_id, to_goal_id, Some(dep_type)) {
        Ok(_) => true,
        Err(e) => {
            tracing::debug!(from_goal_id, to_goal_id, relation, error = %e, "goal relation skipped (duplicate/cycle)");
            false
        }
    }
}

/// Build the Product Strategist's backlog-triage prompt: every pending idea
/// (with lens + self-scores), the team's shared ledger, and what recently
/// shipped — the strategist ranks the top items (1 = do next), rejects
/// low-value/duplicate ones with reasons, and leaves the rest unranked.
fn build_backlog_triage_prompt(
    project_name: &str,
    strategist_identity: Option<&str>,
    ideas: &[crate::db::models::DevIdea],
    team_ledger: Option<&str>,
    shipped: Option<&str>,
    open_goals: Option<&str>,
) -> String {
    let identity = strategist_identity
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("## Your identity\n{s}\n\n"))
        .unwrap_or_else(|| {
            "## Your identity\nYou are the team's Product Strategist — the business seat. \
             You think in user value, revenue, retention, and momentum, not in refactors. \
             You own WHAT gets built next.\n\n"
                .into()
        });
    let mut ideas_block = String::new();
    for i in ideas {
        ideas_block.push_str(&format!(
            "- id={} | lens={} | impact={:?} effort={:?} risk={:?} | {}\n  {}\n",
            i.id,
            i.scan_type,
            i.impact,
            i.effort,
            i.risk,
            i.title,
            i.description.as_deref().unwrap_or("").trim(),
        ));
    }
    let ledger = team_ledger
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Team Shared Knowledge — settled decisions & constraints (respect these)\n{s}\n"))
        .unwrap_or_default();
    let shipped_block = shipped
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Recently shipped (don't re-do; build on it)\n{s}\n"))
        .unwrap_or_default();
    let goals_block = open_goals
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\n## Open goals (relate these where natural sequences/dependencies exist)\n{s}\n"))
        .unwrap_or_default();
    format!(
        r#"# Backlog Triage — {project_name}

{identity}You are triaging the project's pending backlog. Rank what the team should do NEXT
for maximum real-world value, reject what isn't worth doing, and leave the rest.
{ledger}{shipped_block}{goals_block}
## Pending ideas
{ideas_block}
## Rules
- RANK at most 5 ideas: priority 1 = do next, 2 = after that, … Balance the THEMES —
  a healthy next-up queue mixes business/user value with technical health; never rank
  five same-lens refactors in a row.
- REJECT ideas that are low-value, duplicate, contradict a settled decision, or solve a
  problem no user has. Give a one-sentence reason — it becomes a durable team memory and
  suppresses re-surfacing.
- Leave everything else untouched (pending, unranked).
- Do NOT read the codebase in depth — judge from the idea descriptions, the ledger, and
  what shipped. This is a prioritization pass, not a re-scan.
- RELATE the open goals where a REAL ordering exists: if goal B builds on goal A's output,
  emit relation "depends" (B depends on A); if B is the natural next phase after A without
  a hard blocker, emit "follows". Only relate when the connection is genuine — most goals
  are legitimately independent; do NOT invent links.

## Output protocol
One JSON object per line, nothing else around them:
{{"triage": {{"idea_id": "<id from the list>", "action": "rank", "priority": 1, "reason": "<why now>"}}}}
{{"triage": {{"idea_id": "<id from the list>", "action": "reject", "reason": "<why not>"}}}}
{{"relate_goals": {{"from_goal_id": "<open goal id>", "to_goal_id": "<open goal id>", "relation": "depends|follows", "reason": "<one line>"}}}}

End with: {{"scan_summary": {{"ideas_generated": <decisions made>, "agents_used": 1}}}}
"#
    )
}

/// Run the strategist backlog-triage job for one project. Mirrors
/// `run_scan_core`'s shape (dev_scans record with scan_type `backlog-triage`,
/// background CLI run via the scanner plumbing, triage protocol applied by the
/// shared stream loop). Engine-callable (no auth) — used by
/// `engine::subscription::BacklogTriageSubscription`.
pub async fn run_backlog_triage(
    app: tauri::AppHandle,
    db: crate::db::DbPool,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    let project = repo::get_project_by_id(&db, &project_id)?;
    let ideas = repo::list_ideas(&db, Some(&project_id), Some("pending"), None, Some(60), None)?;
    if ideas.len() < 3 {
        return Err(AppError::Validation(
            "Backlog triage skipped: fewer than 3 pending ideas".into(),
        ));
    }

    // The team's Product Strategist persona lends its identity when present.
    let strategist_identity: Option<String> = project.team_id.as_deref().and_then(|team_id| {
        db.get().ok().and_then(|conn| {
            conn.query_row(
                "SELECT p.system_prompt FROM personas p
                 JOIN persona_team_members ptm ON ptm.persona_id = p.id
                 WHERE ptm.team_id = ?1
                   AND (p.name LIKE '%Product Strategist%' OR p.template_category = 'product-strategist')
                 LIMIT 1",
                rusqlite::params![team_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        })
    });

    let team_ledger: Option<String> = project.team_id.as_deref().and_then(|team_id| {
        crate::db::repos::resources::team_memories::get_for_injection(&db, team_id, 12)
            .ok()
            .filter(|m| !m.is_empty())
            .map(|m| {
                m.iter()
                    .map(|tm| format!("- [{}] {}: {}", tm.category, tm.title, tm.content))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
    });

    let shipped: Option<String> = db.get().ok().and_then(|conn| {
        conn.prepare(
            "SELECT title FROM dev_goals WHERE project_id = ?1
             AND status IN ('done','completed') ORDER BY updated_at DESC LIMIT 8",
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![project_id], |r| r.get::<_, String>(0))
                .ok()
                .map(|rows| {
                    rows.flatten()
                        .map(|t| format!("- {t}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
        })
        .filter(|s| !s.is_empty())
    });

    // Open goals — the strategist relates them (depends/follows) where real
    // sequences exist, so autonomously-promoted goals stop being islands.
    let open_goals: Option<String> = db.get().ok().and_then(|conn| {
        conn.prepare(
            "SELECT id, title, status, progress FROM dev_goals WHERE project_id = ?1
             AND status NOT IN ('done','completed') AND progress < 100
             ORDER BY created_at DESC LIMIT 12",
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![project_id], |r| {
                Ok(format!(
                    "- id={} [{} {}%] {}",
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i32>(3)?,
                    r.get::<_, String>(1)?
                ))
            })
            .ok()
            .map(|rows| rows.flatten().collect::<Vec<_>>().join("\n"))
        })
        .filter(|s| !s.is_empty())
    });

    let prompt_text = build_backlog_triage_prompt(
        &project.name,
        strategist_identity.as_deref(),
        &ideas,
        team_ledger.as_deref(),
        shipped.as_deref(),
        open_goals.as_deref(),
    );

    let scan = repo::create_scan(&db, Some(&project_id), "backlog-triage", Some("running"))?;
    let scan_id = scan.id.clone();
    let cancel_token = CancellationToken::new();
    IDEA_SCAN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), IdeaScanExtra)?;
    IDEA_SCAN_JOBS.set_status(&app, &scan_id, "running", None);

    let app_handle = app.clone();
    let pool = db.clone();
    let scan_id_for_task = scan_id.clone();
    let root_path = project.root_path.clone();
    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => {
                Err(AppError::Internal("Backlog triage cancelled".into()))
            }
            res = run_idea_scan(
                &app_handle,
                &scan_id_for_task,
                &pool,
                &project_id,
                &root_path,
                prompt_text,
                // Backlog triage is a project-wide pass, not a scoped scan.
                "all",
            ) => res
        };
        match result {
            Ok(counts) => {
                // A backlog-triage run only ever produces triage/goal-relation
                // decisions (never `IdeaProtocol::Idea`), so this is the
                // decisions tally, not an ideas-created count.
                let decisions = counts.triage_decisions + counts.relations_created;
                let _ = repo::update_scan(
                    &pool, &scan_id_for_task, Some("complete"), Some(decisions),
                    None, None, None, None,
                );
                IDEA_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "completed", None);
                tracing::info!(scan_id = %scan_id_for_task, decisions, "backlog triage complete");
            }
            Err(e) => {
                let msg = format!("{e}");
                let _ = repo::update_scan(
                    &pool, &scan_id_for_task, Some("error"), None, None, None, None,
                    Some(Some(&msg)),
                );
                IDEA_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "failed", Some(msg));
            }
        }
    });

    Ok(json!({ "scan_id": scan_id, "scan_type": "backlog-triage" }))
}
