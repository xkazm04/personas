use std::collections::{HashMap, HashSet, VecDeque};

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Maximum chain depth before we refuse to fire further chain triggers.
/// Prevents infinite cascades from A->B->A or longer cycles.
const MAX_CHAIN_DEPTH: u32 = 8;

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
) {
    if chain_depth >= MAX_CHAIN_DEPTH {
        tracing::warn!(
            source_persona_id = %source_persona_id,
            chain_depth,
            "Chain trigger depth limit reached ({}), refusing to fire further triggers",
            MAX_CHAIN_DEPTH,
        );
        return;
    }
    // Get only enabled chain triggers matching this source persona (filtered at SQL level)
    let chain_triggers = match trigger_repo::get_chain_triggers_for_source(pool, source_persona_id) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Chain trigger evaluation failed: {}", e);
            return;
        }
    };

    if chain_triggers.is_empty() {
        return;
    }

    for trigger in chain_triggers {
        let config: serde_json::Value = match trigger
            .config
            .as_deref()
            .and_then(|c| serde_json::from_str(c).ok())
        {
            Some(c) => c,
            None => continue,
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

        // Publish event targeting the chain trigger's persona
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

                // Mark trigger as fired
                let _ = trigger_repo::mark_triggered(pool, &trigger.id, None);
            }
            Err(e) => {
                tracing::error!(
                    trigger_id = %trigger.id,
                    "Chain trigger: failed to publish event: {}", e
                );
            }
        }
    }
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

/// Build a directed graph from all chain triggers: source_persona_id → persona_id.
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

    // Load all enabled chain triggers and build adjacency list: source → [targets]
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
    // If yes, proposed_source → proposed_target → ... → proposed_source is a cycle.
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let mut parent: HashMap<String, String> = HashMap::new();

    visited.insert(proposed_target.to_string());
    queue.push_back(proposed_target.to_string());

    while let Some(node) = queue.pop_front() {
        if let Some(neighbors) = graph.get(&node) {
            for next in neighbors {
                if next == proposed_source {
                    // Found a cycle — reconstruct path for the error message
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
                        names.join(" → ")
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
/// Predicate types:
/// - `success`: Only fire if execution succeeded
/// - `failure`: Only fire if execution failed
/// - `any`: Always fire (default if no condition specified)
/// - `jsonpath`: Fire if a JSONPath expression on the output matches expected value
fn evaluate_predicate(
    condition: Option<&serde_json::Value>,
    execution_status: &str,
    execution_output: Option<&str>,
) -> bool {
    let condition = match condition {
        Some(c) => c,
        None => return true, // No condition = always fire
    };

    let pred_type = condition
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("any");

    match pred_type {
        "success" => execution_status == "completed",
        "failure" => execution_status == "failed",
        "any" => true,
        "jsonpath" => {
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
        _ => {
            tracing::warn!("Unknown predicate type: {}", pred_type);
            false
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
        assert!(msg.contains("cannot chain-trigger itself"), "got: {}", msg);
    }

    #[test]
    fn test_cycle_detect_direct_ab_ba() {
        let pool = init_test_db().unwrap();
        let a = make_persona(&pool, "Agent A");
        let b = make_persona(&pool, "Agent B");

        // A -> B exists
        make_chain(&pool, &a, &b);

        // Now try to add B -> A (would create A→B→A)
        let result = detect_chain_cycle(&pool, &b, &a, None);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Circular chain detected"), "got: {}", msg);
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

        // Now try to add C -> A (would create A→B→C→A)
        let result = detect_chain_cycle(&pool, &c, &a, None);
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Circular chain detected"), "got: {}", msg);
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
}
