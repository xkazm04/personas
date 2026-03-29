use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use crate::db::models::ChainConditionType;
use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::engine::lifecycle::TriggerStatus;
use crate::error::AppError;

/// Maximum chain depth before we refuse to fire further chain triggers.
/// Prevents infinite cascades from A->B->A or longer cycles.
const MAX_CHAIN_DEPTH: u32 = 8;

/// Metrics collected during a single cascade evaluation at one hop.
#[derive(Debug, Clone, Default)]
pub struct CascadeMetrics {
    /// Number of chain triggers evaluated (loaded from DB).
    pub triggers_evaluated: u32,
    /// Number of predicates that matched (condition passed).
    pub predicates_matched: u32,
    /// Number of events successfully published.
    pub events_published: u32,
    /// Number of events that failed to publish.
    pub events_failed: u32,
    /// Number of triggers skipped due to cycle detection.
    pub cycles_detected: u32,
    /// Number of triggers that failed to mark as triggered (and were disabled).
    pub mark_failures: u32,
    /// Number of triggers moved to errored state (mark + disable both failed).
    pub broken_triggers: u32,
    /// Wall-clock duration of this hop in milliseconds.
    pub duration_ms: u64,
    /// The chain depth at which this evaluation ran.
    pub chain_depth: u32,
}

/// Evaluate chain triggers after an execution completes.
///
/// Chain triggers have config like:
/// ```json
/// {
///   "source_persona_id": "abc123",       // Which persona's completion triggers this
///   "event_type": "chain_triggered",      // Event type to publish
///   "condition": {                         // Optional conditional predicate
///     "type": "success",                   // "success", "failure", "any", "jsonpath"
///     "jsonpath": "$.result.status",       // Only for type "jsonpath"
///     "expected": "approved"               // Only for type "jsonpath"
///   },
///   "payload_forward": true               // Forward source output as payload
/// }
/// ```
///
/// `chain_depth` tracks how many chain hops have occurred so far. The initial
/// caller passes 0. `visited_personas` tracks which persona IDs have already
/// appeared in this chain to detect cycles.
#[allow(clippy::too_many_arguments)]
pub fn evaluate_chain_triggers(
    pool: &DbPool,
    source_persona_id: &str,
    execution_status: &str,
    execution_output: Option<&str>,
    execution_id: &str,
    chain_depth: u32,
    visited_personas: &HashSet<String>,
    chain_trace_id: Option<&str>,
) -> CascadeMetrics {
    let hop_start = Instant::now();
    let mut metrics = CascadeMetrics {
        chain_depth,
        ..Default::default()
    };

    if chain_depth >= MAX_CHAIN_DEPTH {
        tracing::warn!(
            source_persona_id = %source_persona_id,
            chain_depth,
            "Chain trigger depth limit reached ({}), refusing to fire further triggers",
            MAX_CHAIN_DEPTH,
        );
        metrics.duration_ms = hop_start.elapsed().as_millis() as u64;
        return metrics;
    }
    // Get only enabled chain triggers matching this source persona (filtered at SQL level)
    let chain_triggers = match trigger_repo::get_chain_triggers_for_source(pool, source_persona_id) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Chain trigger evaluation failed: {}", e);
            metrics.duration_ms = hop_start.elapsed().as_millis() as u64;
            return metrics;
        }
    };

    if chain_triggers.is_empty() {
        metrics.duration_ms = hop_start.elapsed().as_millis() as u64;
        return metrics;
    }

    metrics.triggers_evaluated = chain_triggers.len() as u32;

    for trigger in chain_triggers {
        if !trigger.is_within_active_window(chrono::Utc::now()) {
            tracing::debug!(trigger_id = %trigger.id, "Chain trigger outside active window, skipping");
            continue;
        }
        let config: serde_json::Value = match trigger.config.as_deref() {
            Some(raw) => match serde_json::from_str(raw) {
                Ok(c) => c,
                Err(parse_err) => {
                    tracing::warn!(
                        trigger_id = %trigger.id,
                        persona_id = %trigger.persona_id,
                        raw_config = %raw,
                        error = %parse_err,
                        "Chain trigger skipped: config contains malformed JSON"
                    );
                    continue;
                }
            },
            None => {
                tracing::warn!(
                    trigger_id = %trigger.id,
                    persona_id = %trigger.persona_id,
                    "Chain trigger skipped: config is empty"
                );
                continue;
            }
        };

        // Cycle detection: skip if target persona was already visited in this chain
        if visited_personas.contains(&trigger.persona_id) {
            tracing::warn!(
                trigger_id = %trigger.id,
                source_persona_id = %source_persona_id,
                target_persona_id = %trigger.persona_id,
                chain_depth,
                "Chain trigger cycle detected: {} already visited, skipping",
                trigger.persona_id,
            );
            metrics.cycles_detected += 1;
            continue;
        }

        // Evaluate condition predicate
        let condition = config.get("condition");
        if !evaluate_predicate(condition, execution_status, execution_output) {
            tracing::debug!(
                trigger_id = %trigger.id,
                "Chain trigger skipped: predicate not satisfied"
            );
            continue;
        }

        metrics.predicates_matched += 1;

        // Build visited set for downstream, adding the target persona
        let next_depth = chain_depth + 1;
        let mut next_visited: Vec<&str> = visited_personas.iter().map(|s| s.as_str()).collect();
        next_visited.push(&trigger.persona_id);

        // Build payload
        let payload = if config
            .get("payload_forward")
            .and_then(|p| p.as_bool())
            .unwrap_or(false)
        {
            execution_output.map(|o| {
                let mut val = serde_json::json!({
                    "source_persona_id": source_persona_id,
                    "source_execution_id": execution_id,
                    "source_status": execution_status,
                    "source_output": serde_json::from_str::<serde_json::Value>(o)
                        .unwrap_or(serde_json::Value::String(o.to_string())),
                    "_chain_depth": next_depth,
                    "_chain_visited": next_visited,
                });
                if let Some(tid) = chain_trace_id {
                    val["_chain_trace_id"] = serde_json::Value::String(tid.to_string());
                }
                val.to_string()
            })
        } else {
            let mut val = serde_json::json!({
                "source_persona_id": source_persona_id,
                "source_execution_id": execution_id,
                "source_status": execution_status,
                "_chain_depth": next_depth,
                "_chain_visited": next_visited,
            });
            if let Some(tid) = chain_trace_id {
                val["_chain_trace_id"] = serde_json::Value::String(tid.to_string());
            }
            Some(val.to_string())
        };

        let event_type = config
            .get("event_type")
            .and_then(|e| e.as_str())
            .unwrap_or("chain_triggered")
            .to_string();

        // Mark trigger as fired BEFORE publishing the event — critical ordering to
        // prevent duplicate executions. If we published first and then crashed or
        // mark_triggered failed, the trigger would remain unmarked and re-fire on
        // next startup, causing a duplicate downstream execution.
        // Retry once on failure; if both attempts fail, disable the trigger and
        // skip publishing to prevent cascade re-fire loops.
        let mark_result = trigger_repo::mark_triggered(
            pool,
            &trigger.id,
            None,
            trigger.trigger_version,
        );
        let mark_ok = match mark_result {
            Ok(_) => true,
            Err(first_err) => {
                tracing::warn!(
                    trigger_id = %trigger.id,
                    error = %first_err,
                    "Chain trigger mark_triggered failed, retrying once"
                );
                // Retry once
                match trigger_repo::mark_triggered(
                    pool,
                    &trigger.id,
                    None,
                    trigger.trigger_version,
                ) {
                    Ok(_) => true,
                    Err(retry_err) => {
                        metrics.mark_failures += 1;
                        let error_ctx = format!(
                            "mark_triggered failed twice: first={first_err}, retry={retry_err}"
                        );
                        tracing::error!(
                            trigger_id = %trigger.id,
                            source_persona_id = %source_persona_id,
                            target_persona_id = %trigger.persona_id,
                            chain_depth,
                            first_error = %first_err,
                            retry_error = %retry_err,
                            "Chain trigger mark_triggered failed after retry — \
                             moving trigger to errored state and event to dead letter queue"
                        );

                        // Try set_status(Errored) first (writes both status + enabled columns),
                        // fall back to set_enabled(false) if the status column is unavailable.
                        let quarantined = trigger_repo::set_status(
                            pool,
                            &trigger.id,
                            TriggerStatus::Errored,
                        )
                        .or_else(|_| trigger_repo::set_enabled(pool, &trigger.id, false));

                        if let Err(quarantine_err) = quarantined {
                            // Both disable paths failed — record the event in the dead
                            // letter queue so the cascade cannot re-process it.
                            metrics.broken_triggers += 1;
                            tracing::error!(
                                trigger_id = %trigger.id,
                                error = %quarantine_err,
                                "Failed to quarantine trigger after mark_triggered failure — \
                                 sending event to dead letter queue to prevent cascade loop"
                            );
                        }

                        // Always publish to the dead letter queue so there is a
                        // persistent record regardless of whether the trigger was
                        // successfully quarantined.
                        let dlq_error = format!(
                            "Chain trigger {trigger_id} could not be marked as triggered \
                             and was moved to errored state. {error_ctx}",
                            trigger_id = trigger.id,
                        );
                        if let Err(dlq_err) = event_repo::publish_dead_letter(
                            pool,
                            CreatePersonaEventInput {
                                event_type: event_type.clone(),
                                source_type: "chain".into(),
                                source_id: Some(trigger.id.clone()),
                                target_persona_id: Some(trigger.persona_id.clone()),
                                project_id: None,
                                payload: payload.clone(),
                                use_case_id: trigger.use_case_id.clone(),
                            },
                            dlq_error,
                        ) {
                            tracing::error!(
                                trigger_id = %trigger.id,
                                error = %dlq_err,
                                "Failed to publish dead letter event for broken chain trigger"
                            );
                        }

                        false
                    }
                }
            }
        };

        // Only publish the event if mark_triggered succeeded — this ensures we
        // never have an event in flight for a trigger that hasn't been marked.
        if !mark_ok {
            tracing::warn!(
                trigger_id = %trigger.id,
                "Skipping event publish because mark_triggered failed"
            );
            metrics.events_failed += 1;
            continue;
        }

        match event_repo::publish(
            pool,
            CreatePersonaEventInput {
                event_type,
                source_type: "chain".into(),
                source_id: Some(trigger.id.clone()),
                target_persona_id: Some(trigger.persona_id.clone()),
                project_id: None,
                payload,
                use_case_id: trigger.use_case_id.clone(),
            },
        ) {
            Ok(event) => {
                tracing::info!(
                    trigger_id = %trigger.id,
                    source_persona_id = %source_persona_id,
                    target_persona_id = %trigger.persona_id,
                    event_id = %event.id,
                    "Chain trigger fired: {} -> {}",
                    source_persona_id,
                    trigger.persona_id,
                );
                metrics.events_published += 1;
            }
            Err(e) => {
                tracing::error!(
                    trigger_id = %trigger.id,
                    "Chain trigger: failed to publish event: {}", e
                );
                metrics.events_failed += 1;
            }
        }
    }

    metrics.duration_ms = hop_start.elapsed().as_millis() as u64;

    tracing::info!(
        source_persona_id = %source_persona_id,
        chain_depth,
        chain_trace_id = chain_trace_id.unwrap_or("none"),
        triggers_evaluated = metrics.triggers_evaluated,
        predicates_matched = metrics.predicates_matched,
        events_published = metrics.events_published,
        events_failed = metrics.events_failed,
        cycles_detected = metrics.cycles_detected,
        mark_failures = metrics.mark_failures,
        broken_triggers = metrics.broken_triggers,
        duration_ms = metrics.duration_ms,
        "Chain cascade hop completed"
    );

    metrics
}

/// Extract chain depth and visited set from a chain trigger payload.
///
/// When a chain trigger fires, it embeds `_chain_depth` and `_chain_visited`
/// in the event payload. This function extracts them so the next execution
/// can propagate cycle-detection state.
pub fn extract_chain_metadata(payload: Option<&str>) -> (u32, HashSet<String>, Option<String>) {
    let Some(payload) = payload else {
        return (0, HashSet::new(), None);
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(payload) else {
        tracing::warn!(
            payload_len = payload.len(),
            payload_prefix = %&payload[..payload.len().min(200)],
            "Chain metadata extraction failed: payload is not valid JSON — \
             chain_trace_id will be lost and downstream executions will create orphaned trace roots"
        );
        return (0, HashSet::new(), None);
    };
    let depth = val
        .get("_chain_depth")
        .and_then(|d| d.as_u64())
        .unwrap_or(0) as u32;
    let visited = val
        .get("_chain_visited")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let chain_trace_id = val
        .get("_chain_trace_id")
        .and_then(|t| t.as_str())
        .map(String::from);
    (depth, visited, chain_trace_id)
}

// =============================================================================
// Config-time cycle detection
// =============================================================================

/// Build a directed graph from all chain triggers: source_persona_id -> persona_id.
/// Then check whether adding a proposed edge would create a cycle via BFS.
///
/// Returns `Ok(())` if the proposed edge is safe, or `Err(AppError::Validation(...))`
/// with a human-readable cycle path.
///
/// `proposed_source` is the source_persona_id in the chain config.
/// `proposed_target` is the persona_id that owns the trigger being created/updated.
/// `exclude_trigger_id` can be set when updating an existing trigger so the old edge
/// is not counted.
pub fn detect_chain_cycle(
    pool: &DbPool,
    proposed_source: &str,
    proposed_target: &str,
    exclude_trigger_id: Option<&str>,
) -> Result<(), AppError> {
    // Self-loop is the simplest cycle
    if proposed_source == proposed_target {
        return Err(AppError::Validation(
            "Circular chain detected: an agent cannot chain-trigger itself".into(),
        ));
    }

    // Load all enabled chain triggers and build adjacency list: source -> [targets]
    let all_triggers = trigger_repo::get_all(pool)?;
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();

    for t in &all_triggers {
        if t.trigger_type != "chain" || !t.enabled {
            continue;
        }
        if let Some(excl) = exclude_trigger_id {
            if t.id == excl {
                continue;
            }
        }
        let source = t
            .config
            .as_deref()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
            .and_then(|v| v.get("source_persona_id")?.as_str().map(String::from));
        if let Some(src) = source {
            graph.entry(src).or_default().push(t.persona_id.clone());
        }
    }

    // Add the proposed edge
    graph
        .entry(proposed_source.to_string())
        .or_default()
        .push(proposed_target.to_string());

    // BFS from proposed_target: can we reach proposed_source?
    // If yes, proposed_source -> proposed_target -> ... -> proposed_source is a cycle.
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let mut parent: HashMap<String, String> = HashMap::new();

    visited.insert(proposed_target.to_string());
    queue.push_back(proposed_target.to_string());

    while let Some(node) = queue.pop_front() {
        if let Some(neighbors) = graph.get(&node) {
            for next in neighbors {
                if next == proposed_source {
                    // Found a cycle -- reconstruct path for the error message
                    let mut path = vec![proposed_source.to_string(), proposed_target.to_string()];
                    let mut cur = node.clone();
                    // Walk back through parent links to build the path
                    while cur != *proposed_target {
                        path.push(cur.clone());
                        cur = match parent.get(&cur) {
                            Some(p) => p.clone(),
                            None => break,
                        };
                    }
                    path.push(proposed_source.to_string());

                    // Resolve persona names for a friendly message
                    let names = resolve_persona_names(pool, &path);

                    return Err(AppError::Validation(format!(
                        "Circular chain detected: {}. This would create an infinite execution loop.",
                        names.join(" -> ")
                    )));
                }
                if visited.insert(next.clone()) {
                    parent.insert(next.clone(), node.clone());
                    queue.push_back(next.clone());
                }
            }
        }
    }

    Ok(())
}

/// Resolve persona IDs to "name (id-prefix)" for human-readable error messages.
fn resolve_persona_names(pool: &DbPool, ids: &[String]) -> Vec<String> {
    ids.iter()
        .map(|id| {
            match crate::db::repos::core::personas::get_by_id(pool, id) {
                Ok(p) => format!("\"{}\"", p.name),
                Err(_) => format!("({})", &id[..id.len().min(8)]),
            }
        })
        .collect()
}

/// Evaluate a conditional predicate against execution results.
///
/// Uses [`ChainConditionType`] to determine matching behaviour. See that enum's
/// doc comments for the full mapping between condition types and execution statuses.
fn evaluate_predicate(
    condition: Option<&serde_json::Value>,
    execution_status: &str,
    execution_output: Option<&str>,
) -> bool {
    let condition = match condition {
        Some(c) => c,
        None => return true, // No condition = always fire
    };

    let pred_type_str = condition
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("any");

    let pred_type = match pred_type_str.parse::<ChainConditionType>() {
        Ok(t) => t,
        Err(_) => {
            tracing::warn!(
                "Unknown chain condition type \"{}\". Valid values: {}. Treating as non-matching.",
                pred_type_str,
                ChainConditionType::VALID_VALUES.join(", ")
            );
            return false;
        }
    };

    match pred_type {
        ChainConditionType::Success => execution_status == "completed",
        ChainConditionType::Failure => execution_status == "failed",
        ChainConditionType::Any => true,
        ChainConditionType::Jsonpath => {
            let path = match condition.get("jsonpath").and_then(|p| p.as_str()) {
                Some(p) => p,
                None => return false,
            };
            let expected = condition.get("expected");

            let output: serde_json::Value = execution_output
                .and_then(|o| serde_json::from_str(o).ok())
                .unwrap_or(serde_json::Value::Null);

            evaluate_simple_jsonpath(&output, path)
                .map(|found| match expected {
                    Some(exp) => found == exp,
                    None => !found.is_null(), // Just check it exists and isn't null
                })
                .unwrap_or(false)
        }
    }
}

/// Simple JSONPath evaluator supporting dot notation: `$.foo.bar.baz`
///
/// This handles the most common use case without pulling in a full JSONPath crate.
fn evaluate_simple_jsonpath<'a>(
    value: &'a serde_json::Value,
    path: &str,
) -> Option<&'a serde_json::Value> {
    let path = path.strip_prefix("$.").unwrap_or(path);
    let mut current = value;

    for segment in path.split('.') {
        if segment.is_empty() {
            continue;
        }
        // Handle array index: e.g., "items[0]"
        if let Some(idx_start) = segment.find('[') {
            let key = &segment[..idx_start];
            let idx_str = segment[idx_start + 1..].strip_suffix(']')?;
            let idx: usize = idx_str.parse().ok()?;

            if !key.is_empty() {
                current = current.get(key)?;
            }
            current = current.get(idx)?;
        } else {
            current = current.get(segment)?;
        }
    }

    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_predicate_success() {
        let cond = json!({"type": "success"});
        assert!(evaluate_predicate(Some(&cond), "completed", None));
        assert!(!evaluate_predicate(Some(&cond), "failed", None));
    }

    #[test]
    fn test_predicate_failure() {
        let cond = json!({"type": "failure"});
        assert!(evaluate_predicate(Some(&cond), "failed", None));
        assert!(!evaluate_predicate(Some(&cond), "completed", None));
    }

    #[test]
    fn test_predicate_any() {
        let cond = json!({"type": "any"});
        assert!(evaluate_predicate(Some(&cond), "completed", None));
        assert!(evaluate_predicate(Some(&cond), "failed", None));
    }

    #[test]
    fn test_predicate_none_means_always() {
        assert!(evaluate_predicate(None, "completed", None));
        assert!(evaluate_predicate(None, "failed", None));
    }

    #[test]
    fn test_predicate_unknown_type_rejects() {
        // Typo like "succcess" should not match anything
        let cond = json!({"type": "succcess"});
        assert!(!evaluate_predicate(Some(&cond), "completed", None));
        assert!(!evaluate_predicate(Some(&cond), "failed", None));
    }

    #[test]
    fn test_predicate_jsonpath_match() {
        let cond = json!({
            "type": "jsonpath",
            "jsonpath": "$.result.status",
            "expected": "approved"
        });
        let output = r#"{"result":{"status":"approved","data":"ok"}}"#;
        assert!(evaluate_predicate(Some(&cond), "completed", Some(output)));
    }

    #[test]
    fn test_predicate_jsonpath_no_match() {
        let cond = json!({
            "type": "jsonpath",
            "jsonpath": "$.result.status",
            "expected": "approved"
        });
        let output = r#"{"result":{"status":"rejected"}}"#;
        assert!(!evaluate_predicate(Some(&cond), "completed", Some(output)));
    }

    #[test]
    fn test_predicate_jsonpath_existence() {
        let cond = json!({
            "type": "jsonpath",
            "jsonpath": "$.result.data"
        });
        let output = r#"{"result":{"data":"something"}}"#;
        assert!(evaluate_predicate(Some(&cond), "completed", Some(output)));
    }

    #[test]
    fn test_predicate_jsonpath_missing() {
        let cond = json!({
            "type": "jsonpath",
            "jsonpath": "$.result.missing_key"
        });
        let output = r#"{"result":{"data":"something"}}"#;
        assert!(!evaluate_predicate(Some(&cond), "completed", Some(output)));
    }

    #[test]
    fn test_simple_jsonpath() {
        let data = json!({"a": {"b": {"c": 42}}});
        assert_eq!(evaluate_simple_jsonpath(&data, "$.a.b.c"), Some(&json!(42)));
    }

    #[test]
    fn test_simple_jsonpath_array() {
        let data = json!({"items": [10, 20, 30]});
        assert_eq!(
            evaluate_simple_jsonpath(&data, "$.items[1]"),
            Some(&json!(20))
        );
    }

    #[test]
    fn test_simple_jsonpath_missing() {
        let data = json!({"a": 1});
        assert_eq!(evaluate_simple_jsonpath(&data, "$.b"), None);
    }

    #[test]
    fn test_extract_chain_metadata_none() {
        let (depth, visited, trace_id) = extract_chain_metadata(None);
        assert_eq!(depth, 0);
        assert!(visited.is_empty());
        assert!(trace_id.is_none());
    }

    #[test]
    fn test_extract_chain_metadata_no_fields() {
        let payload = r#"{"source_persona_id": "abc"}"#;
        let (depth, visited, trace_id) = extract_chain_metadata(Some(payload));
        assert_eq!(depth, 0);
        assert!(visited.is_empty());
        assert!(trace_id.is_none());
    }

    #[test]
    fn test_extract_chain_metadata_with_fields() {
        let payload = json!({
            "source_persona_id": "abc",
            "_chain_depth": 3,
            "_chain_visited": ["persona-a", "persona-b", "persona-c"],
            "_chain_trace_id": "trace-abc-123"
        })
        .to_string();
        let (depth, visited, trace_id) = extract_chain_metadata(Some(&payload));
        assert_eq!(depth, 3);
        assert_eq!(visited.len(), 3);
        assert!(visited.contains("persona-a"));
        assert!(visited.contains("persona-b"));
        assert!(visited.contains("persona-c"));
        assert_eq!(trace_id.as_deref(), Some("trace-abc-123"));
    }

    #[test]
    fn test_extract_chain_metadata_invalid_json() {
        let (depth, visited, trace_id) = extract_chain_metadata(Some("not json"));
        assert_eq!(depth, 0);
        assert!(visited.is_empty());
        assert!(trace_id.is_none());
    }

    // =========================================================================
    // Cycle detection tests
    // =========================================================================

    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreateTriggerInput};
    use crate::db::repos::core::personas as persona_repo;

    fn make_persona(pool: &crate::db::DbPool, name: &str) -> String {
        persona_repo::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
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
        .unwrap()
        .id
    }

    fn make_chain(pool: &crate::db::DbPool, source: &str, target: &str) -> String {
        let config = json!({ "source_persona_id": source }).to_string();
        trigger_repo::create(
            pool,
            CreateTriggerInput {
                persona_id: target.into(),
                trigger_type: "chain".into(),
                config: Some(config),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn test_cycle_detect_self_loop() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");

        let result = detect_chain_cycle(&pool, &a, &a, None);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("cannot chain-trigger itself"), "got: {msg}");
    }

    #[test]
    fn test_cycle_detect_direct_ab_ba() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");

        // A -> B exists
        make_chain(&pool, &a, &b);

        // Now try to add B -> A (would create A->B->A)
        let result = detect_chain_cycle(&pool, &b, &a, None);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Circular chain detected"), "got: {msg}");
    }

    #[test]
    fn test_cycle_detect_three_node() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");
        let c = make_persona(&pool, "Agent C");

        // A -> B -> C exists
        make_chain(&pool, &a, &b);
        make_chain(&pool, &b, &c);

        // Now try to add C -> A (would create A->B->C->A)
        let result = detect_chain_cycle(&pool, &c, &a, None);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Circular chain detected"), "got: {msg}");
    }

    #[test]
    fn test_cycle_detect_no_cycle_linear() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");
        let c = make_persona(&pool, "Agent C");

        // A -> B exists
        make_chain(&pool, &a, &b);

        // B -> C is fine (no cycle)
        let result = detect_chain_cycle(&pool, &b, &c, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cycle_detect_excludes_current_trigger() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");

        // A -> B exists
        let trigger_id = make_chain(&pool, &a, &b);

        // Updating the same trigger (A -> B) should not detect a false cycle
        let result = detect_chain_cycle(&pool, &a, &b, Some(&trigger_id));
        assert!(result.is_ok());
    }

    // =========================================================================
    // Cascade metrics tests
    // =========================================================================

    #[test]
    fn test_cascade_metrics_no_triggers() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");

        let visited = HashSet::new();
        let metrics = evaluate_chain_triggers(
            &pool, &a, "completed", None, "exec-1", 0, &visited, None,
        );

        assert_eq!(metrics.chain_depth, 0);
        assert_eq!(metrics.triggers_evaluated, 0);
        assert_eq!(metrics.predicates_matched, 0);
        assert_eq!(metrics.events_published, 0);
        assert_eq!(metrics.events_failed, 0);
        assert_eq!(metrics.cycles_detected, 0);
    }

    #[test]
    fn test_cascade_metrics_with_trigger() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");

        // Create chain trigger: when A completes, fire B
        let config = json!({
            "source_persona_id": a,
            "event_type": "chain_triggered",
            "condition": { "type": "success" },
        })
        .to_string();
        trigger_repo::create(
            &pool,
            CreateTriggerInput {
                persona_id: b.clone(),
                trigger_type: "chain".into(),
                config: Some(config),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let visited = HashSet::new();
        let metrics = evaluate_chain_triggers(
            &pool, &a, "completed", None, "exec-1", 0, &visited, Some("trace-1"),
        );

        assert_eq!(metrics.chain_depth, 0);
        assert_eq!(metrics.triggers_evaluated, 1);
        assert_eq!(metrics.predicates_matched, 1);
        assert_eq!(metrics.events_published, 1);
        assert_eq!(metrics.events_failed, 0);
        assert_eq!(metrics.cycles_detected, 0);
        // duration_ms should be set (at least 0)
        assert!(metrics.duration_ms < 5000, "duration should be reasonable");
    }

    #[test]
    fn test_cascade_metrics_predicate_not_met() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");

        // Trigger requires success
        let config = json!({
            "source_persona_id": a,
            "condition": { "type": "success" },
        })
        .to_string();
        trigger_repo::create(
            &pool,
            CreateTriggerInput {
                persona_id: b.clone(),
                trigger_type: "chain".into(),
                config: Some(config),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        let visited = HashSet::new();
        // Execution failed, so predicate should not match
        let metrics = evaluate_chain_triggers(
            &pool, &a, "failed", None, "exec-1", 0, &visited, None,
        );

        assert_eq!(metrics.triggers_evaluated, 1);
        assert_eq!(metrics.predicates_matched, 0);
        assert_eq!(metrics.events_published, 0);
    }

    #[test]
    fn test_cascade_metrics_cycle_detected() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");

        // Trigger: A -> B
        let config = json!({
            "source_persona_id": a,
            "condition": { "type": "any" },
        })
        .to_string();
        trigger_repo::create(
            &pool,
            CreateTriggerInput {
                persona_id: b.clone(),
                trigger_type: "chain".into(),
                config: Some(config),
                enabled: Some(true),
                use_case_id: None,
            },
        )
        .unwrap();

        // B is already visited — should detect cycle
        let mut visited = HashSet::new();
        visited.insert(b.clone());
        let metrics = evaluate_chain_triggers(
            &pool, &a, "completed", None, "exec-1", 1, &visited, None,
        );

        assert_eq!(metrics.chain_depth, 1);
        assert_eq!(metrics.triggers_evaluated, 1);
        assert_eq!(metrics.predicates_matched, 0);
        assert_eq!(metrics.events_published, 0);
        assert_eq!(metrics.cycles_detected, 1);
    }

    #[test]
    fn test_cascade_metrics_depth_limit() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");

        let visited = HashSet::new();
        let metrics = evaluate_chain_triggers(
            &pool, &a, "completed", None, "exec-1", MAX_CHAIN_DEPTH, &visited, None,
        );

        assert_eq!(metrics.chain_depth, MAX_CHAIN_DEPTH);
        assert_eq!(metrics.triggers_evaluated, 0);
        assert_eq!(metrics.events_published, 0);
    }
}
