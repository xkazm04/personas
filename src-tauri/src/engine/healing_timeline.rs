//! Healing business logic that requires DB access but belongs in the engine layer.
//!
//! Extracted from `commands::execution::healing` so the commands layer stays thin
//! (auth + delegation) and this logic can be unit-tested without Tauri State.

use std::collections::HashSet;

use crate::db::models::{
    ConnectorDefinition, HealingTimelineEvent, PersonaHealingIssue, PersonaToolDefinition,
};
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::healing::{self, HealingAction, KnowledgeHint, MAX_RETRY_COUNT};

// ---------------------------------------------------------------------------
// Knowledge hint resolution
// ---------------------------------------------------------------------------

/// Resolve a [`KnowledgeHint`] from the healing knowledge base for the given
/// persona and failure category by iterating over connectors associated with
/// the persona's tools.
#[allow(dead_code)]
pub fn resolve_knowledge_hint(
    pool: &DbPool,
    persona_id: &str,
    category: &healing::FailureCategory,
) -> Option<KnowledgeHint> {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return None,
    };

    let tools = match crate::db::repos::resources::tools::get_tools_for_persona(pool, persona_id) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(
                persona_id = %persona_id,
                error = %e,
                "Failed to fetch tools for knowledge hint resolution"
            );
            return None;
        }
    };
    let connectors = match crate::db::repos::resources::connectors::get_all(pool) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(
                error = %e,
                "Failed to fetch connectors for knowledge hint resolution"
            );
            return None;
        }
    };

    resolve_hint_from_cache(pool, pattern_key, &tools, &connectors)
}

/// Like [`resolve_knowledge_hint`] but accepts pre-fetched tools and connectors
/// to avoid redundant DB queries when called in a loop.
pub fn resolve_knowledge_hint_with_cache(
    pool: &DbPool,
    category: &healing::FailureCategory,
    tools: Option<&[PersonaToolDefinition]>,
    connectors: Option<&[ConnectorDefinition]>,
) -> Option<KnowledgeHint> {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return None,
    };

    resolve_hint_from_cache(pool, pattern_key, tools?, connectors?)
}

fn resolve_hint_from_cache(
    pool: &DbPool,
    pattern_key: &str,
    tools: &[PersonaToolDefinition],
    connectors: &[ConnectorDefinition],
) -> Option<KnowledgeHint> {
    for tool in tools {
        for connector in connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });
            if tool_listed {
                if let Ok(Some(hint)) = repo::get_knowledge_hint(pool, &connector.name, pattern_key)
                {
                    return Some(hint);
                }
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Ownership verification
// ---------------------------------------------------------------------------

/// Verify that the healing issue belongs to the expected persona.
pub fn verify_healing_owner(
    issue: &PersonaHealingIssue,
    caller_persona_id: &str,
) -> Result<(), AppError> {
    if issue.persona_id != caller_persona_id {
        return Err(AppError::Auth(
            "Healing issue does not belong to the specified persona".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Healing analysis
// ---------------------------------------------------------------------------

/// Result of a healing analysis scan.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HealingAnalysisResult {
    pub failures_analyzed: usize,
    pub issues_created: u32,
    pub auto_fixed: u32,
    pub auto_retried: u32,
}

/// Scan recent failed executions for a persona, create healing issues, and
/// return analysis results along with scheduled-retry metadata.
///
/// The caller is responsible for actually scheduling retries via
/// `Engine::schedule_healing_retry` for each entry in `retries_to_schedule`.
pub fn run_healing_analysis(
    pool: &DbPool,
    persona_id: &str,
) -> Result<(HealingAnalysisResult, Vec<HealingRetryRequest>), AppError> {
    // Revert stale auto_fix_pending issues back to open (TTL: 10 minutes).
    // This prevents zombie healing issues when the retry job crashes or the
    // app closes mid-healing.
    repo::revert_stale_auto_fix_pending(pool, persona_id, 10);

    let failures = exec_repo::get_recent_failures(pool, persona_id, 10)?;

    let mut created = 0u32;
    let mut auto_fixed = 0u32;
    let mut retry_scheduled = false;
    let mut retries: Vec<HealingRetryRequest> = Vec::new();

    let consecutive = exec_repo::get_consecutive_failure_count(pool, persona_id)?;

    let tools = match crate::db::repos::resources::tools::get_tools_for_persona(pool, persona_id) {
        Ok(t) => Some(t),
        Err(e) => {
            tracing::warn!(
                persona_id = %persona_id,
                error = %e,
                "Failed to pre-fetch tools for healing analysis knowledge hints"
            );
            None
        }
    };
    let connectors = match crate::db::repos::resources::connectors::get_all(pool) {
        Ok(c) => Some(c),
        Err(e) => {
            tracing::warn!(
                error = %e,
                "Failed to pre-fetch connectors for healing analysis knowledge hints"
            );
            None
        }
    };

    for exec in &failures {
        let error = exec.error_message.as_deref().unwrap_or("");
        let timed_out = error.contains("timed out");
        let session_limit = error.contains("Session limit");
        // Use the configured timeout from the execution config snapshot, NOT
        // the actual duration (which is how long the execution ran, not the
        // configured limit). Falls back to the persona table default (300_000ms).
        let timeout_ms = exec
            .execution_config
            .as_deref()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
            .and_then(|v| v.get("timeout_ms")?.as_i64())
            .map(|t| t.max(0) as u64)
            .unwrap_or(300_000);

        let category = healing::classify_error(error, timed_out, session_limit);
        let kb_hint =
            resolve_knowledge_hint_with_cache(pool, &category, tools.as_deref(), connectors.as_deref());
        let diagnosis =
            healing::diagnose(&category, error, timeout_ms, consecutive, exec.retry_count, kb_hint.as_ref());

        let issue = match repo::create(
            pool,
            persona_id,
            &diagnosis.title,
            &diagnosis.description,
            diagnosis.title.to_ascii_lowercase().contains("circuit breaker"),
            Some(&diagnosis.severity),
            Some(&diagnosis.db_category),
            Some(&exec.id),
            diagnosis.suggested_fix.as_deref(),
        )? {
            Some(issue) => issue,
            None => {
                repo::create_audit_entry(
                    pool, Some(persona_id), Some(&exec.id),
                    "dedup_skipped", "healing_analysis",
                    "Healing issue creation skipped (duplicate for this persona+execution)",
                    Some(&diagnosis.title),
                );
                continue;
            }
        };

        created += 1;

        let is_auto_fixable = healing::is_auto_fixable(&category)
            && consecutive < 3
            && exec.retry_count < MAX_RETRY_COUNT
            && matches!(
                diagnosis.action,
                HealingAction::RetryWithBackoff { .. } | HealingAction::RetryWithTimeout { .. }
            );

        if is_auto_fixable {
            if let Err(e) = repo::mark_auto_fix_pending(pool, &issue.id) {
                tracing::error!(
                    issue_id = %issue.id,
                    error = %e,
                    "mark_auto_fix_pending failed — skipping auto-fix to avoid orphaned retry"
                );
            } else {
                auto_fixed += 1;

                if !retry_scheduled {
                    retries.push(HealingRetryRequest {
                        execution_id: exec.id.clone(),
                        diagnosis,
                    });
                    retry_scheduled = true;
                }
            }
        }
    }

    let auto_retried = retries.len() as u32;

    Ok((
        HealingAnalysisResult {
            failures_analyzed: failures.len(),
            issues_created: created,
            auto_fixed,
            auto_retried,
        },
        retries,
    ))
}

/// A request to schedule a healing retry, returned by [`run_healing_analysis`].
#[derive(Debug, Clone)]
pub struct HealingRetryRequest {
    pub execution_id: String,
    pub diagnosis: healing::HealingDiagnosis,
}

// ---------------------------------------------------------------------------
// Timeline assembly
// ---------------------------------------------------------------------------

/// Build a resilience timeline for a persona: trigger -> classify -> diagnose ->
/// retry/heal -> outcome, linking healing issues to retry chains, AI healing
/// sessions, and knowledge-base entries.
pub fn build_healing_timeline(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<HealingTimelineEvent>, AppError> {
    let issues = repo::get_all(pool, Some(persona_id), None)?;
    let knowledge = repo::get_all_knowledge(pool)?;
    let mut events: Vec<HealingTimelineEvent> = Vec::new();

    let exec_ids: Vec<&str> = issues
        .iter()
        .filter_map(|i| i.execution_id.as_deref())
        .collect();
    let retry_chains = exec_repo::get_retry_chains_batch(pool, &exec_ids)?;

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

        // 3. Retry chain events (from batched lookup)
        if let Some(ref exec_id) = issue.execution_id {
            if let Some(chain) = retry_chains.get(exec_id) {
                for exec in chain {
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
    let seen_categories: HashSet<&str> = issues.iter().map(|i| i.category.as_str()).collect();
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
