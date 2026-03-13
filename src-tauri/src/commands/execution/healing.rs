use std::sync::Arc;
use tauri::State;

use crate::db::models::{HealingKnowledge, HealingTimelineEvent, PersonaExecution, PersonaHealingIssue};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as repo;
use crate::engine::healing;
use crate::engine::healing::HealingAction;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use crate::engine::healing::MAX_RETRY_COUNT;

/// Resolve a [`KnowledgeHint`] from the healing knowledge base for the given
/// persona and failure category. Mirrors the engine-level lookup by iterating
/// over connectors associated with the persona's tools.
fn resolve_knowledge_hint(
    pool: &crate::db::DbPool,
    persona_id: &str,
    category: &healing::FailureCategory,
) -> Option<healing::KnowledgeHint> {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return None,
    };

    let tools = crate::db::repos::resources::tools::get_tools_for_persona(pool, persona_id).ok()?;
    let connectors = crate::db::repos::resources::connectors::get_all(pool).ok()?;

    for tool in &tools {
        for connector in &connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });
            if tool_listed {
                if let Ok(Some(hint)) = repo::get_knowledge_hint(pool, &connector.name, pattern_key) {
                    return Some(hint);
                }
            }
        }
    }

    None
}

/// Verify that the healing issue belongs to the expected persona.
fn verify_healing_owner(issue: &PersonaHealingIssue, caller_persona_id: &str) -> Result<(), AppError> {
    if issue.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Healing issue does not belong to the specified persona".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_healing_issues(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<PersonaHealingIssue>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db, persona_id.as_deref(), status.as_deref())
}

#[tauri::command]
pub fn get_healing_issue(
    state: State<'_, Arc<AppState>>,
    id: String,
    caller_persona_id: String,
) -> Result<PersonaHealingIssue, AppError> {
    require_auth_sync(&state)?;
    let issue = repo::get_by_id(&state.db, &id)?;
    verify_healing_owner(&issue, &caller_persona_id)?;
    Ok(issue)
}

#[tauri::command]
pub fn update_healing_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
    caller_persona_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let issue = repo::get_by_id(&state.db, &id)?;
    verify_healing_owner(&issue, &caller_persona_id)?;
    repo::update_status(&state.db, &id, &status)
}

/// Scan recent failed executions for a persona, create healing issues,
/// and execute auto-fix actions (RetryWithBackoff, RetryWithTimeout).
#[tauri::command]
pub async fn run_healing_analysis(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let pool = &state.db;

    let failures = exec_repo::get_recent_failures(pool, &persona_id, 10)?;

    let mut created = 0u32;
    let mut auto_fixed = 0u32;
    let mut auto_retried = 0u32;

    // Only retry the most recent auto-fixable failure to avoid spawning
    // multiple concurrent retries from a single scan.
    let mut retry_scheduled = false;

    // Consecutive failure count is stable for a single scan -- compute once.
    let consecutive = exec_repo::get_consecutive_failure_count(pool, &persona_id)?;

    for exec in &failures {
        let error = exec.error_message.as_deref().unwrap_or("");
        let timed_out = error.contains("timed out");
        let session_limit = error.contains("Session limit");
        let timeout_ms = exec.duration_ms.unwrap_or(600_000) as u64;

        let category = healing::classify_error(error, timed_out, session_limit);
        let kb_hint = resolve_knowledge_hint(pool, &persona_id, &category);
        let diagnosis = healing::diagnose(&category, error, timeout_ms, consecutive, exec.retry_count, kb_hint.as_ref());

        // INSERT OR IGNORE: returns None if a duplicate already exists for
        // this (persona_id, execution_id), preventing concurrent-scan races.
        let issue = match repo::create(
            pool,
            &persona_id,
            &diagnosis.title,
            &diagnosis.description,
            diagnosis.title.to_ascii_lowercase().contains("circuit breaker"),
            Some(&diagnosis.severity),
            Some(&diagnosis.db_category),
            Some(&exec.id),
            diagnosis.suggested_fix.as_deref(),
        )? {
            Some(issue) => issue,
            None => continue, // duplicate -- already handled by another scan
        };

        created += 1;

        let is_auto_fixable = healing::is_auto_fixable(&category)
            && consecutive < 3
            && exec.retry_count < MAX_RETRY_COUNT
            && matches!(diagnosis.action, HealingAction::RetryWithBackoff { .. } | HealingAction::RetryWithTimeout { .. });

        if is_auto_fixable {
            let _ = repo::mark_auto_fix_pending(pool, &issue.id);
            auto_fixed += 1;

            // Execute the healing action: schedule an actual retry
            if !retry_scheduled {
                state.engine.schedule_healing_retry(
                    &app,
                    pool,
                    &exec.id,
                    &persona_id,
                    &diagnosis,
                );
                auto_retried += 1;
                retry_scheduled = true;
            }
        }
    }

    Ok(serde_json::json!({
        "status": "completed",
        "failures_analyzed": failures.len(),
        "issues_created": created,
        "auto_fixed": auto_fixed,
        "auto_retried": auto_retried,
    }))
}

/// Get the retry chain for an execution (original + all retries).
#[tauri::command]
pub fn get_retry_chain(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    caller_persona_id: String,
) -> Result<Vec<PersonaExecution>, AppError> {
    require_auth_sync(&state)?;
    let execution = exec_repo::get_by_id(&state.db, &execution_id)?;
    if execution.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Execution does not belong to the specified persona".into(),
        ));
    }
    exec_repo::get_retry_chain(&state.db, &execution_id)
}

/// Get all entries from the fleet-wide healing knowledge base.
#[tauri::command]
pub fn list_healing_knowledge(
    state: State<'_, Arc<AppState>>,
    service_type: Option<String>,
) -> Result<Vec<HealingKnowledge>, AppError> {
    require_auth_sync(&state)?;
    match service_type {
        Some(st) => repo::get_knowledge_by_service(&state.db, &st),
        None => repo::get_all_knowledge(&state.db),
    }
}

/// Manually trigger AI healing for a failed execution (dev-mode only).
///
/// Resumes the original Claude session as a chained execution. The healing
/// runs in the background and emits `ai-healing-status` events to the frontend.
/// Requires the original execution to have a `claude_session_id`.
#[tauri::command]
pub async fn trigger_ai_healing(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    execution_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    // Only available in dev mode
    if !cfg!(debug_assertions) && std::env::var("VITE_DEVELOPMENT").as_deref() != Ok("true") {
        return Err(AppError::Internal("AI healing is only available in development mode".into()));
    }

    let pool = &state.db;
    let execution = exec_repo::get_by_id(pool, &execution_id)?;

    let session_id = execution.claude_session_id.ok_or_else(|| {
        AppError::Internal("Cannot heal: no Claude session ID on this execution".into())
    })?;

    let error_str = execution.error_message.as_deref().unwrap_or("Unknown error");
    let timed_out = error_str.contains("timed out");
    let session_limit = error_str.contains("Session limit");
    let category = healing::classify_error(error_str, timed_out, session_limit);

    // Delegate to the engine which spawns the healing chain as a background task.
    // The engine handles execution record creation, running, and fix application.
    state.engine.start_healing_chain(
        &app,
        pool,
        &execution_id,
        &execution.persona_id,
        &session_id,
        error_str,
        &format!("{category:?}"),
    );

    Ok(serde_json::json!({
        "status": "started",
        "message": "AI healing chain started -- watch ai-healing-status events for progress",
    }))
}

/// Build a resilience timeline for a persona: trigger -> classify -> diagnose ->
/// retry/heal -> outcome, linking healing issues to retry chains, AI healing
/// sessions, and knowledge-base entries.
#[tauri::command]
pub fn get_healing_timeline(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<HealingTimelineEvent>, AppError> {
    require_auth_sync(&state)?;
    let pool = &state.db;

    let issues = repo::get_all(pool, Some(&persona_id), None)?;
    let knowledge = repo::get_all_knowledge(pool)?;
    let mut events: Vec<HealingTimelineEvent> = Vec::new();

    for issue in &issues {
        let chain_id = issue
            .execution_id
            .clone()
            .unwrap_or_else(|| issue.id.clone());

        // 1. Trigger event -- the original failure
        events.push(HealingTimelineEvent {
            id: format!("{}-trigger", issue.id),
            chain_id: chain_id.clone(),
            event_type: "trigger".into(),
            timestamp: issue.created_at.clone(),
            title: issue.title.clone(),
            description: issue
                .description
                .lines()
                .next()
                .unwrap_or(&issue.description)
                .to_string(),
            severity: Some(issue.severity.clone()),
            category: Some(issue.category.clone()),
            status: Some(issue.status.clone()),
            execution_id: issue.execution_id.clone(),
            issue_id: Some(issue.id.clone()),
            knowledge_id: None,
            auto_fixed: issue.auto_fixed,
            is_circuit_breaker: issue.is_circuit_breaker,
            retry_count: None,
            suggested_fix: None,
        });

        // 2. Classify event
        events.push(HealingTimelineEvent {
            id: format!("{}-classify", issue.id),
            chain_id: chain_id.clone(),
            event_type: "classify".into(),
            timestamp: issue.created_at.clone(),
            title: format!("{} / {}", issue.category, issue.severity),
            description: format!(
                "Classified as {} severity {} issue",
                issue.severity, issue.category
            ),
            severity: Some(issue.severity.clone()),
            category: Some(issue.category.clone()),
            status: None,
            execution_id: issue.execution_id.clone(),
            issue_id: Some(issue.id.clone()),
            knowledge_id: None,
            auto_fixed: false,
            is_circuit_breaker: issue.is_circuit_breaker,
            retry_count: None,
            suggested_fix: issue.suggested_fix.clone(),
        });

        // 3. Retry chain events (if execution_id present)
        if let Some(ref exec_id) = issue.execution_id {
            if let Ok(chain) = exec_repo::get_retry_chain(pool, exec_id) {
                for exec in &chain {
                    if exec.retry_count > 0 {
                        let outcome_label = match exec.status.as_str() {
                            "success" | "completed" => "succeeded",
                            "failed" | "error" => "failed",
                            "running" => "running",
                            _ => &exec.status,
                        };
                        events.push(HealingTimelineEvent {
                            id: format!("{}-retry-{}", issue.id, exec.retry_count),
                            chain_id: chain_id.clone(),
                            event_type: "retry".into(),
                            timestamp: exec
                                .started_at
                                .clone()
                                .or_else(|| Some(exec.created_at.clone()))
                                .unwrap(),
                            title: format!("Retry #{} {}", exec.retry_count, outcome_label),
                            description: exec
                                .error_message
                                .clone()
                                .unwrap_or_else(|| format!("Retry attempt {}", outcome_label)),
                            severity: Some(issue.severity.clone()),
                            category: Some(issue.category.clone()),
                            status: Some(exec.status.clone()),
                            execution_id: Some(exec.id.clone()),
                            issue_id: Some(issue.id.clone()),
                            knowledge_id: None,
                            auto_fixed: false,
                            is_circuit_breaker: false,
                            retry_count: Some(exec.retry_count),
                            suggested_fix: None,
                        });
                    }
                }
            }
        }

        // 4. Outcome event
        let outcome_status = if issue.is_circuit_breaker {
            "circuit_breaker"
        } else if issue.auto_fixed && issue.status == "resolved" {
            "auto_healed"
        } else if issue.status == "resolved" {
            "resolved"
        } else if issue.status == "auto_fix_pending" {
            "retrying"
        } else {
            "open"
        };
        let outcome_ts = issue
            .resolved_at
            .clone()
            .unwrap_or_else(|| issue.created_at.clone());
        events.push(HealingTimelineEvent {
            id: format!("{}-outcome", issue.id),
            chain_id: chain_id.clone(),
            event_type: "outcome".into(),
            timestamp: outcome_ts,
            title: format!("Outcome: {}", outcome_status.replace('_', " ")),
            description: match outcome_status {
                "auto_healed" => "Issue automatically resolved via retry".into(),
                "resolved" => "Issue manually resolved".into(),
                "circuit_breaker" => "Persona auto-disabled after repeated failures".into(),
                "retrying" => "Auto-fix in progress".into(),
                _ => "Issue remains open".into(),
            },
            severity: Some(issue.severity.clone()),
            category: Some(issue.category.clone()),
            status: Some(outcome_status.into()),
            execution_id: issue.execution_id.clone(),
            issue_id: Some(issue.id.clone()),
            knowledge_id: None,
            auto_fixed: issue.auto_fixed,
            is_circuit_breaker: issue.is_circuit_breaker,
            retry_count: None,
            suggested_fix: None,
        });
    }

    // 5. Knowledge entries that match categories seen in this persona's issues
    let seen_categories: std::collections::HashSet<&str> =
        issues.iter().map(|i| i.category.as_str()).collect();
    for k in &knowledge {
        if seen_categories.contains(k.service_type.as_str())
            || seen_categories.contains(k.pattern_key.split(':').next().unwrap_or(""))
        {
            events.push(HealingTimelineEvent {
                id: format!("kb-{}", k.id),
                chain_id: format!("kb-{}", k.service_type),
                event_type: "knowledge".into(),
                timestamp: k.last_seen_at.clone(),
                title: format!("{}: {}", k.service_type, k.pattern_key),
                description: format!(
                    "{} (seen {} time{})",
                    k.description,
                    k.occurrence_count,
                    if k.occurrence_count != 1 { "s" } else { "" }
                ),
                severity: None,
                category: Some(k.service_type.clone()),
                status: None,
                execution_id: None,
                issue_id: None,
                knowledge_id: Some(k.id.clone()),
                auto_fixed: false,
                is_circuit_breaker: false,
                retry_count: None,
                suggested_fix: k
                    .recommended_delay_secs
                    .map(|d| format!("Recommended delay: {}s", d)),
            });
        }
    }

    // Sort chronologically (newest first)
    events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(events)
}
