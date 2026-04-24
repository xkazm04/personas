//! Parser — turns Claude CLI `stream-json` lines into typed `BuildEvent`s.
//!
//! The CLI with `--output-format stream-json --verbose` wraps content in
//! envelopes like `{"type":"assistant","message":{"content":[{"type":"text",
//! "text":"..."}]}}`. We unwrap the envelope to extract the LLM's text, then
//! parse that text for the structured JSON objects the build prompt asks
//! for (`behavior_core`, `capability_enumeration`, `capability_resolution`,
//! `persona_resolution`, `clarifying_question`, `agent_ir`).
//!
//! Legacy mirror: every v3 event also emits a legacy `CellUpdate` /
//! `Question` mirror so the existing 8-dim matrix UI renders the build
//! progress identically. The mapping lives in `map_*_to_legacy_dimension`
//! and `wrap_value_in_legacy_dimension_shape`.

use crate::db::models::BuildEvent;

// =============================================================================
// Helpers
// =============================================================================

/// Parse a single line of CLI output into zero or more BuildEvents.
///
/// The Claude CLI with `--output-format stream-json --verbose` wraps output in
/// envelopes like `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}`.
/// We unwrap the envelope to extract the LLM's actual text, then parse that text
/// for structured question/dimension/error JSON objects. A single response can
/// contain multiple resolved dimensions + one question.
pub(super) fn parse_build_line(line: &str, session_id: &str) -> Vec<BuildEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Try parsing as JSON
    let json: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Non-JSON lines emitted as progress
            return vec![BuildEvent::Progress {
                session_id: session_id.to_string(),
                dimension: None,
                message: trimmed.to_string(),
                percent: None,
                activity: None,
            }];
        }
    };

    let obj = match json.as_object() {
        Some(o) => o,
        None => return vec![],
    };

    // Check for CLI streaming envelope
    let envelope_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match envelope_type {
        "system" | "rate_limit_event" => return vec![], // Skip system messages
        "assistant" => {
            // Unwrap: message.content[].text
            let text = obj
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("type").and_then(|t| t.as_str()) == Some("text"))
                        .and_then(|item| item.get("text").and_then(|t| t.as_str()))
                });
            if let Some(text) = text {
                return parse_llm_text_content(text, session_id);
            }
            return vec![];
        }
        "result" => {
            // Unwrap: result field (string)
            if let Some(result_text) = obj.get("result").and_then(|v| v.as_str()) {
                return parse_llm_text_content(result_text, session_id);
            }
            return vec![];
        }
        _ => {} // Fall through to direct JSON parsing (backward compat)
    }

    // Not an envelope — try direct parsing (backward compat for non-envelope output)
    parse_json_object(obj, &json, session_id)
}

/// Parse the LLM's actual text content (unwrapped from CLI envelope).
/// Handles multiple JSON objects per response (e.g., 3 resolved dimensions + 1 question).
fn parse_llm_text_content(text: &str, session_id: &str) -> Vec<BuildEvent> {
    let mut events = Vec::new();

    // Strip markdown code fences
    let cleaned = text
        .replace("```json", "")
        .replace("```", "");

    // Try each line as a potential JSON object
    for line in cleaned.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(obj) = val.as_object() {
                events.extend(parse_json_object(obj, &val, session_id));
            }
        }
    }

    // If no structured events found, emit the text as progress
    if events.is_empty() && !text.trim().is_empty() {
        // Truncate long progress messages
        let msg = if text.len() > 200 { &text[..200] } else { text };
        events.push(BuildEvent::Progress {
            session_id: session_id.to_string(),
            dimension: None,
            message: msg.trim().to_string(),
            percent: None,
            activity: None,
        });
    }

    events
}

/// Parse a single JSON object into one or more `BuildEvent`s.
///
/// v3 events (behavior_core, capability_enumeration, capability_resolution,
/// persona_resolution, clarifying_question with a `scope`) each emit TWO
/// events: the typed v3 variant AND a legacy `CellUpdate` / `Question` mirror
/// so the existing 3×3 matrix UI keeps rendering during migration.
/// See §3.8 of C4-build-from-scratch-v3-handoff.md.
pub(super) fn parse_json_object(
    obj: &serde_json::Map<String, serde_json::Value>,
    full_val: &serde_json::Value,
    session_id: &str,
) -> Vec<BuildEvent> {
    // -----------------------------------------------------------------
    // v3 event: behavior_core
    // -----------------------------------------------------------------
    if let Some(core) = obj.get("behavior_core") {
        let mut out = vec![BuildEvent::BehaviorCoreUpdate {
            session_id: session_id.to_string(),
            data: core.clone(),
            status: "resolved".to_string(),
        }];
        // Legacy mirror: surface the core under a dedicated cell key so the
        // old matrix UI can show it as a synthetic 9th cell if desired.
        out.push(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "behavior_core".to_string(),
            data: core.clone(),
            status: "resolved".to_string(),
        });
        return out;
    }

    // -----------------------------------------------------------------
    // v3 event: capability_enumeration
    // -----------------------------------------------------------------
    if let Some(enu) = obj.get("capability_enumeration") {
        let mut out = vec![BuildEvent::CapabilityEnumerationUpdate {
            session_id: session_id.to_string(),
            data: enu.clone(),
            status: "resolved".to_string(),
        }];
        // Legacy mirror: hoist the capability list under the use-cases key so
        // the old dimensional cell renders something useful. Map each
        // capability's title to `items[]` and full list to `use_cases[]`.
        let legacy_data = capabilities_to_legacy_use_cases(enu);
        out.push(BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "use-cases".to_string(),
            data: legacy_data,
            status: "resolved".to_string(),
        });
        return out;
    }

    // -----------------------------------------------------------------
    // v3 event: capability_resolution
    // -----------------------------------------------------------------
    if let Some(res) = obj.get("capability_resolution") {
        if let Some(res_obj) = res.as_object() {
            let capability_id = res_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let field = res_obj
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = res_obj.get("value").cloned().unwrap_or_default();
            let status = res_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("resolved")
                .to_string();

            let mut out = vec![BuildEvent::CapabilityResolutionUpdate {
                session_id: session_id.to_string(),
                capability_id: capability_id.clone(),
                field: field.clone(),
                value: value.clone(),
                status: status.clone(),
            }];
            // Legacy mirror: map field → legacy dimension key and surface as CellUpdate.
            if let Some(legacy_key) = map_capability_field_to_legacy_dimension(&field) {
                let legacy_data = wrap_value_in_legacy_dimension_shape(&field, &value, &capability_id);
                out.push(BuildEvent::CellUpdate {
                    session_id: session_id.to_string(),
                    cell_key: legacy_key.to_string(),
                    data: legacy_data,
                    status,
                });
            }
            return out;
        }
    }

    // -----------------------------------------------------------------
    // v3 event: persona_resolution
    // -----------------------------------------------------------------
    if let Some(res) = obj.get("persona_resolution") {
        if let Some(res_obj) = res.as_object() {
            let field = res_obj
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let value = res_obj.get("value").cloned().unwrap_or_default();
            let status = res_obj
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("resolved")
                .to_string();

            let mut out = vec![BuildEvent::PersonaResolutionUpdate {
                session_id: session_id.to_string(),
                field: field.clone(),
                value: value.clone(),
                status: status.clone(),
            }];
            if let Some(legacy_key) = map_persona_field_to_legacy_dimension(&field) {
                let legacy_data = wrap_value_in_legacy_dimension_shape(&field, &value, "");
                out.push(BuildEvent::CellUpdate {
                    session_id: session_id.to_string(),
                    cell_key: legacy_key.to_string(),
                    data: legacy_data,
                    status,
                });
            }
            return out;
        }
    }

    // -----------------------------------------------------------------
    // Question detection — handles BOTH legacy `{question, dimension}` and
    // v3 `{clarifying_question: {scope, ...}}` / bare `{question, scope, ...}`.
    // -----------------------------------------------------------------
    if let Some(cq) = obj.get("clarifying_question") {
        if let Some(cq_obj) = cq.as_object() {
            return build_clarifying_question_events(cq_obj, session_id);
        }
    }
    if obj.contains_key("question") {
        // A v3-style question is `{question, scope, ...}`; a legacy question is
        // `{question, dimension, options}`. Detect scope to route correctly.
        if obj.contains_key("scope") {
            return build_clarifying_question_events(obj, session_id);
        }

        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let question = match obj.get("question").and_then(|v| v.as_str()) {
            Some(q) => q.to_string(),
            None => return vec![],
        };
        let options = obj.get("options").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
        });
        return vec![BuildEvent::Question {
            session_id: session_id.to_string(),
            cell_key,
            question,
            options,
            connector_category: None,
        }];
    }

    // Agent IR detection
    if obj.contains_key("agent_ir") {
        let ir_data = obj.get("agent_ir").cloned().unwrap_or_default();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "agent_ir".to_string(),
            data: ir_data,
            status: "resolved".to_string(),
        }];
    }

    // Test report detection
    if obj.contains_key("test_report") {
        let report = obj.get("test_report").cloned().unwrap_or_default();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key: "_test_report".to_string(),
            data: report,
            status: "resolved".to_string(),
        }];
    }

    // Dimension/cell update detection (legacy v2 dimensional output)
    if obj.contains_key("dimension") || obj.contains_key("cell_key") {
        let cell_key = obj
            .get("dimension")
            .or_else(|| obj.get("cell_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let data = obj
            .get("data")
            .or_else(|| obj.get("result"))
            .cloned()
            .unwrap_or(full_val.clone());
        let status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("resolved")
            .to_string();
        return vec![BuildEvent::CellUpdate {
            session_id: session_id.to_string(),
            cell_key,
            data,
            status,
        }];
    }

    // Error detection
    if obj.contains_key("error") {
        let message = obj
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error")
            .to_string();
        let retryable = obj
            .get("retryable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        return vec![BuildEvent::Error {
            session_id: session_id.to_string(),
            cell_key: obj.get("cell_key").and_then(|v| v.as_str()).map(|s| s.to_string()),
            message,
            retryable,
        }];
    }

    vec![]
}

/// Emit the typed v3 `ClarifyingQuestionV3` plus a legacy `Question` mirror
/// so the old dimension-scoped question panel keeps rendering.
pub(super) fn build_clarifying_question_events(
    obj: &serde_json::Map<String, serde_json::Value>,
    session_id: &str,
) -> Vec<BuildEvent> {
    let scope = obj
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("mission")
        .to_string();
    let capability_id = obj
        .get("capability_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let field = obj
        .get("field")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let question = match obj.get("question").and_then(|v| v.as_str()) {
        Some(q) => q.to_string(),
        None => return vec![],
    };
    let options = obj.get("options").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
    });
    // `category` is only meaningful when scope == "connector_category" but we
    // accept it as an optional field on any scope for forward-compatibility.
    let category = obj
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut events = vec![BuildEvent::ClarifyingQuestionV3 {
        session_id: session_id.to_string(),
        scope: scope.clone(),
        capability_id: capability_id.clone(),
        field: field.clone(),
        question: question.clone(),
        options: options.clone(),
        category: category.clone(),
    }];

    // Legacy Question mirror — the old UI keys by `cell_key`. Pick the most
    // sensible legacy dimension for each scope so the old question panel
    // can surface it somewhere instead of dropping it.
    let cell_key = match scope.as_str() {
        "mission" => "behavior_core".to_string(),
        "capability" => "use-cases".to_string(),
        "connector_category" => "connectors".to_string(),
        "field" => field
            .as_deref()
            .and_then(map_capability_field_to_legacy_dimension)
            .unwrap_or("use-cases")
            .to_string(),
        _ => "use-cases".to_string(),
    };
    // Pass through connector_category on the legacy mirror so the answering
    // UI can route scope=connector_category questions to the vault picker.
    let legacy_category = if scope == "connector_category" {
        category.clone()
    } else {
        None
    };
    events.push(BuildEvent::Question {
        session_id: session_id.to_string(),
        cell_key,
        question,
        options,
        connector_category: legacy_category,
    });

    events
}

/// Map a v3 capability field name to the legacy v2 dimension key the 3×3
/// matrix UI understands, for the legacy CellUpdate mirror. Returns `None`
/// for fields that have no legacy equivalent (e.g. `input_schema`,
/// `use_case_flow`) — those events surface only via v3 typed state.
pub(super) fn map_capability_field_to_legacy_dimension(field: &str) -> Option<&'static str> {
    match field {
        "suggested_trigger" => Some("triggers"),
        "connectors" => Some("connectors"),
        "notification_channels" => Some("messages"),
        "review_policy" => Some("human-review"),
        "memory_policy" => Some("memory"),
        "event_subscriptions" => Some("events"),
        "error_handling" => Some("error-handling"),
        _ => None,
    }
}

/// Map a v3 persona-wide field name to the legacy dimension key. Persona-wide
/// overlaps (connectors, error_handling, etc.) share the legacy key with
/// capability-scoped fields — the 3×3 UI rendered them as a single cell anyway.
pub(super) fn map_persona_field_to_legacy_dimension(field: &str) -> Option<&'static str> {
    match field {
        "connectors" => Some("connectors"),
        "notification_channels_default" => Some("messages"),
        "error_handling" => Some("error-handling"),
        "core_memories" => Some("memory"),
        _ => None,
    }
}

/// Wrap a v3 field value in the shape the legacy dimension cell expects.
/// The old UI consumes `{items, <dimension-key>[]}` shapes so each dimension
/// can render a summary + structured list. We reconstruct that on the fly
/// from v3 values.
fn wrap_value_in_legacy_dimension_shape(
    field: &str,
    value: &serde_json::Value,
    capability_id: &str,
) -> serde_json::Value {
    use serde_json::json;
    let suffix = if capability_id.is_empty() {
        String::new()
    } else {
        format!(" [{}]", capability_id)
    };

    match field {
        // Per-capability suggested_trigger — value is a single trigger object
        "suggested_trigger" => {
            let mut trig = value.clone();
            if let Some(obj) = trig.as_object_mut() {
                if !capability_id.is_empty() {
                    obj.insert(
                        "use_case_id".to_string(),
                        json!(capability_id),
                    );
                }
            }
            let desc = trig
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            json!({
                "items": [format!("{}{}", desc, suffix)],
                "triggers": [trig]
            })
        }

        // Persona-wide or per-capability connector list
        "connectors" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            // If entries are strings (capability references), skip legacy mirror;
            // otherwise assume they are full connector objects (persona registry).
            if arr.iter().all(|v| v.is_string()) {
                json!({
                    "items": arr.iter().filter_map(|v| v.as_str().map(|s| format!("{}{}", s, suffix))).collect::<Vec<_>>(),
                })
            } else {
                let items: Vec<String> = arr
                    .iter()
                    .map(|c| {
                        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let svc = c.get("service_type").and_then(|v| v.as_str()).unwrap_or("");
                        let purp = c.get("purpose").and_then(|v| v.as_str()).unwrap_or("");
                        format!("{} ({}) — {}", name, svc, purp)
                    })
                    .collect();
                json!({
                    "items": items,
                    "connectors": arr,
                    "alternatives": {}
                })
            }
        }

        "notification_channels" | "notification_channels_default" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let items: Vec<String> = arr
                .iter()
                .map(|c| {
                    let ch = c.get("channel").and_then(|v| v.as_str()).unwrap_or("");
                    let tgt = c.get("target").and_then(|v| v.as_str()).unwrap_or("");
                    format!("{}: {}{}", ch, tgt, suffix)
                })
                .collect();
            json!({ "items": items, "channels": arr })
        }

        "review_policy" => {
            let mode = value.get("mode").and_then(|v| v.as_str()).unwrap_or("never");
            let ctx = value.get("context").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "items": [format!("{}: {}{}", mode, ctx, suffix)],
                "policy": value.clone()
            })
        }

        "memory_policy" => {
            let enabled = value.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
            let ctx = value.get("context").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "items": [format!("enabled={}: {}{}", enabled, ctx, suffix)],
                "policy": value.clone()
            })
        }

        "event_subscriptions" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let mut subs_with_ucid = arr.clone();
            // Tag each subscription with its originating capability for
            // downstream tooling (persona_event_subscriptions.use_case_id).
            if !capability_id.is_empty() {
                for s in subs_with_ucid.iter_mut() {
                    if let Some(o) = s.as_object_mut() {
                        o.insert("use_case_id".to_string(), json!(capability_id));
                    }
                }
            }
            let items: Vec<String> = arr
                .iter()
                .map(|e| {
                    let typ = e.get("event_type").and_then(|v| v.as_str()).unwrap_or("");
                    let dir = e.get("direction").and_then(|v| v.as_str()).unwrap_or("subscribe");
                    format!("{}: {}{}", dir, typ, suffix)
                })
                .collect();
            json!({ "items": items, "subscriptions": subs_with_ucid })
        }

        "error_handling" => {
            let text = value.as_str().unwrap_or("").to_string();
            json!({ "items": [format!("{}{}", text, suffix)] })
        }

        "core_memories" => {
            let arr = value.as_array().cloned().unwrap_or_default();
            let items: Vec<String> = arr
                .iter()
                .map(|m| {
                    let t = m.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    format!("{}{}", t, suffix)
                })
                .collect();
            json!({ "items": items, "memories": arr })
        }

        _ => json!({ "items": [], "value": value.clone() }),
    }
}

/// Convert a v3 capability_enumeration value into the legacy use-cases cell shape.
fn capabilities_to_legacy_use_cases(enu: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    let caps = enu
        .get("capabilities")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let items: Vec<String> = caps
        .iter()
        .map(|c| {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let sum = c.get("capability_summary").and_then(|v| v.as_str()).unwrap_or("");
            if sum.is_empty() {
                title.to_string()
            } else {
                format!("{title}: {sum}")
            }
        })
        .collect();
    let legacy_use_cases: Vec<serde_json::Value> = caps
        .iter()
        .map(|c| {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let sum = c.get("capability_summary").and_then(|v| v.as_str()).unwrap_or("");
            let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "id": id,
                "title": title,
                "description": sum,
                "category": "other",
                "execution_mode": "e2e"
            })
        })
        .collect();
    json!({
        "items": items,
        "use_cases": legacy_use_cases
    })
}

/// Try to extract agent IR (the final JSON result) from accumulated output.
#[allow(dead_code)]
fn parse_agent_ir(output: &str) -> Option<String> {
    // Walk backwards through lines looking for the last complete JSON object
    for line in output.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                // Check if it looks like an agent IR (has typical fields)
                if let Some(obj) = val.as_object() {
                    if obj.contains_key("name")
                        || obj.contains_key("system_prompt")
                        || obj.contains_key("use_cases")
                        || obj.contains_key("result")
                    {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

