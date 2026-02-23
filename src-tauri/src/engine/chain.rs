use std::collections::HashSet;

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;

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
pub fn evaluate_chain_triggers(
    pool: &DbPool,
    source_persona_id: &str,
    execution_status: &str,
    execution_output: Option<&str>,
    execution_id: &str,
    chain_depth: u32,
    visited_personas: &HashSet<String>,
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
                serde_json::json!({
                    "source_persona_id": source_persona_id,
                    "source_execution_id": execution_id,
                    "source_status": execution_status,
                    "source_output": serde_json::from_str::<serde_json::Value>(o)
                        .unwrap_or(serde_json::Value::String(o.to_string())),
                    "_chain_depth": next_depth,
                    "_chain_visited": next_visited,
                })
                .to_string()
            })
        } else {
            Some(
                serde_json::json!({
                    "source_persona_id": source_persona_id,
                    "source_execution_id": execution_id,
                    "source_status": execution_status,
                    "_chain_depth": next_depth,
                    "_chain_visited": next_visited,
                })
                .to_string(),
            )
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
pub fn extract_chain_metadata(payload: Option<&str>) -> (u32, HashSet<String>) {
    let Some(payload) = payload else {
        return (0, HashSet::new());
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(payload) else {
        return (0, HashSet::new());
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
    (depth, visited)
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
        let (depth, visited) = extract_chain_metadata(None);
        assert_eq!(depth, 0);
        assert!(visited.is_empty());
    }

    #[test]
    fn test_extract_chain_metadata_no_fields() {
        let payload = r#"{"source_persona_id": "abc"}"#;
        let (depth, visited) = extract_chain_metadata(Some(payload));
        assert_eq!(depth, 0);
        assert!(visited.is_empty());
    }

    #[test]
    fn test_extract_chain_metadata_with_fields() {
        let payload = json!({
            "source_persona_id": "abc",
            "_chain_depth": 3,
            "_chain_visited": ["persona-a", "persona-b", "persona-c"]
        })
        .to_string();
        let (depth, visited) = extract_chain_metadata(Some(&payload));
        assert_eq!(depth, 3);
        assert_eq!(visited.len(), 3);
        assert!(visited.contains("persona-a"));
        assert!(visited.contains("persona-b"));
        assert!(visited.contains("persona-c"));
    }

    #[test]
    fn test_extract_chain_metadata_invalid_json() {
        let (depth, visited) = extract_chain_metadata(Some("not json"));
        assert_eq!(depth, 0);
        assert!(visited.is_empty());
    }
}
