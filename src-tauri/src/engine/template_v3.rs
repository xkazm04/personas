//! Template schema v3 → flat AgentIr compatibility layer.
//!
//! Templates authored in v3 shape (see
//! `docs/concepts/persona-capabilities/C3-template-schema-v3.md`) nest every
//! chain artefact inside `use_cases[i]` and hoist persona-wide concerns
//! into a `persona` block. The existing `AgentIr` struct and downstream
//! pipeline (promote_build_draft, test_build_draft) still expect the flat
//! v2 shape — top-level `suggested_triggers[]`, `suggested_connectors[]`,
//! `suggested_event_subscriptions[]`, `structured_prompt`, etc.
//!
//! This module bridges the two. `normalize_v3_to_flat()` takes a mutable
//! JSON payload (the template's `payload` object as received from the
//! frontend), detects whether it's v3-shaped, and flattens it in place.
//! The resulting JSON has both the original v3 nested fields (kept for
//! the frontend chronology UI) AND the flat v2 fields the backend needs.
//!
//! No-op for v1/v2 templates — the detection is strict enough that
//! legacy payloads pass through unchanged.

use serde_json::{json, Map, Value};

/// Detects whether a payload is v3-shaped.
///
/// Signals:
/// - `payload.persona` is an object, OR
/// - `payload.use_cases[i]` has a nested `suggested_trigger` object, OR
/// - `payload.use_cases[i]` declares `review_policy` / `memory_policy`.
pub fn is_v3_shape(payload: &Value) -> bool {
    if payload.get("persona").and_then(|v| v.as_object()).is_some() {
        return true;
    }
    if let Some(ucs) = payload.get("use_cases").and_then(|v| v.as_array()) {
        for uc in ucs {
            if uc.get("suggested_trigger").is_some()
                || uc.get("review_policy").is_some()
                || uc.get("memory_policy").is_some()
            {
                return true;
            }
        }
    }
    false
}

/// Normalize a v3 payload in-place into the flat shape expected by the
/// existing backend pipeline. Safe to call on non-v3 payloads (no-op).
pub fn normalize_v3_to_flat(payload: &mut Value) {
    if !is_v3_shape(payload) {
        return;
    }

    let obj = match payload.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    flatten_triggers_from_use_cases(obj);
    flatten_events_from_use_cases(obj);
    flatten_notification_channels(obj);
    hoist_persona_tools(obj);
    hoist_persona_connectors(obj);
    compose_structured_prompt(obj);
    derive_protocol_capabilities(obj);
    ensure_use_case_flows(obj);
}

/// For each capability, if it has a `suggested_trigger`, append a copy to
/// the top-level `suggested_triggers[]` with `use_case_id` tagged.
/// Preserves any pre-existing flat triggers (additive).
fn flatten_triggers_from_use_cases(obj: &mut Map<String, Value>) {
    let use_cases = match obj.get("use_cases").and_then(|v| v.as_array()) {
        Some(arr) => arr.clone(),
        None => return,
    };

    let mut flat: Vec<Value> = obj
        .get("suggested_triggers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for uc in &use_cases {
        let uc_id = match uc.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };
        if let Some(trig) = uc.get("suggested_trigger").and_then(|v| v.as_object()) {
            // Skip if an existing flat trigger already has this use_case_id
            // (respects authorial intent if both shapes present).
            let already = flat.iter().any(|t| {
                t.get("use_case_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s == uc_id)
                    .unwrap_or(false)
            });
            if already {
                continue;
            }
            let mut entry = trig.clone();
            entry.insert("use_case_id".to_string(), Value::String(uc_id));
            flat.push(Value::Object(entry));
        }
    }

    if !flat.is_empty() {
        obj.insert("suggested_triggers".to_string(), Value::Array(flat));
    }
}

/// For each capability's `event_subscriptions`, append to top-level
/// `suggested_event_subscriptions[]` with `use_case_id` tagged. Preserves
/// direction metadata so the downstream pipeline can distinguish emit vs
/// listen.
fn flatten_events_from_use_cases(obj: &mut Map<String, Value>) {
    let use_cases = match obj.get("use_cases").and_then(|v| v.as_array()) {
        Some(arr) => arr.clone(),
        None => return,
    };

    let mut flat: Vec<Value> = obj
        .get("suggested_event_subscriptions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for uc in &use_cases {
        let uc_id = match uc.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };
        let subs = match uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            Some(arr) => arr,
            None => continue,
        };
        for s in subs {
            if let Some(sub_obj) = s.as_object() {
                let event_type = sub_obj
                    .get("event_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if event_type.is_empty() {
                    continue;
                }
                // Skip if an existing entry already pairs this use_case + event_type.
                let already = flat.iter().any(|e| {
                    e.get("use_case_id").and_then(|v| v.as_str()) == Some(&uc_id)
                        && e.get("event_type").and_then(|v| v.as_str()) == Some(event_type)
                });
                if already {
                    continue;
                }
                let mut entry = sub_obj.clone();
                entry.insert("use_case_id".to_string(), Value::String(uc_id.clone()));
                flat.push(Value::Object(entry));
            }
        }
    }

    if !flat.is_empty() {
        obj.insert(
            "suggested_event_subscriptions".to_string(),
            Value::Array(flat),
        );
    }
}

/// Flatten per-capability `notification_channels` + persona-wide
/// `notification_channels_default` into top-level
/// `suggested_notification_channels[]`. Deduplicates on content so
/// repeated normalization passes are idempotent.
fn flatten_notification_channels(obj: &mut Map<String, Value>) {
    let mut flat: Vec<Value> = obj
        .get("suggested_notification_channels")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let push_if_new = |flat: &mut Vec<Value>, entry: Value| {
        if !flat.iter().any(|existing| existing == &entry) {
            flat.push(entry);
        }
    };

    // Persona defaults (no use_case_id tag — apply to all capabilities).
    if let Some(persona) = obj.get("persona").and_then(|v| v.as_object()) {
        if let Some(defaults) = persona
            .get("notification_channels_default")
            .and_then(|v| v.as_array())
        {
            for ch in defaults {
                if let Some(ch_obj) = ch.as_object() {
                    push_if_new(&mut flat, Value::Object(ch_obj.clone()));
                }
            }
        }
    }

    // Per-capability channels.
    if let Some(ucs) = obj.get("use_cases").and_then(|v| v.as_array()).cloned() {
        for uc in &ucs {
            let uc_id = match uc.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };
            let channels = match uc.get("notification_channels").and_then(|v| v.as_array()) {
                Some(arr) => arr,
                None => continue,
            };
            for ch in channels {
                if let Some(ch_obj) = ch.as_object() {
                    let mut entry = ch_obj.clone();
                    entry.insert("use_case_id".to_string(), Value::String(uc_id.clone()));
                    push_if_new(&mut flat, Value::Object(entry));
                }
            }
        }
    }

    if !flat.is_empty() {
        obj.insert(
            "suggested_notification_channels".to_string(),
            Value::Array(flat),
        );
    }
}

/// Hoist `persona.tools` to top-level `suggested_tools`.
fn hoist_persona_tools(obj: &mut Map<String, Value>) {
    let persona_tools = obj
        .get("persona")
        .and_then(|v| v.get("tools"))
        .and_then(|v| v.as_array())
        .cloned();
    if let Some(tools) = persona_tools {
        if tools.is_empty() {
            return;
        }
        let has_flat = obj
            .get("suggested_tools")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);
        if !has_flat {
            obj.insert("suggested_tools".to_string(), Value::Array(tools));
        }
    }
}

/// Hoist `persona.connectors` to top-level `suggested_connectors`,
/// tagging each with `use_case_id` when the capability references it by
/// name in its `connectors: string[]` field.
fn hoist_persona_connectors(obj: &mut Map<String, Value>) {
    let persona_connectors = obj
        .get("persona")
        .and_then(|v| v.get("connectors"))
        .and_then(|v| v.as_array())
        .cloned();
    let Some(persona_connectors) = persona_connectors else {
        return;
    };

    // Build a reverse map: connector_name → first use_case_id that references it.
    let mut connector_to_uc: std::collections::HashMap<String, String> = Default::default();
    if let Some(ucs) = obj.get("use_cases").and_then(|v| v.as_array()) {
        for uc in ucs {
            let uc_id = match uc.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };
            if let Some(refs) = uc.get("connectors").and_then(|v| v.as_array()) {
                for r in refs {
                    if let Some(name) = r.as_str() {
                        connector_to_uc
                            .entry(name.to_string())
                            .or_insert_with(|| uc_id.clone());
                    }
                }
            }
        }
    }

    let flat: Vec<Value> = persona_connectors
        .into_iter()
        .filter_map(|c| {
            let c_obj = c.as_object()?;
            let name = c_obj.get("name").and_then(|v| v.as_str())?.to_string();
            let mut entry = c_obj.clone();
            if let Some(uc_id) = connector_to_uc.get(&name) {
                entry
                    .entry("use_case_id")
                    .or_insert_with(|| Value::String(uc_id.clone()));
            }
            Some(Value::Object(entry))
        })
        .collect();

    if flat.is_empty() {
        return;
    }

    let has_flat = obj
        .get("suggested_connectors")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if !has_flat {
        obj.insert("suggested_connectors".to_string(), Value::Array(flat));
    }
}

/// Compose a `structured_prompt` object from the decomposed v3 persona
/// fields (identity, voice, principles, constraints, decision_principles,
/// operating_instructions, tool_guidance, error_handling). Preserves
/// any pre-existing structured_prompt — v3 authors may supply both.
fn compose_structured_prompt(obj: &mut Map<String, Value>) {
    if obj.get("structured_prompt").is_some() {
        return;
    }
    let persona = match obj.get("persona").and_then(|v| v.as_object()) {
        Some(p) => p,
        None => return,
    };

    let mut identity = String::new();
    if let Some(id_obj) = persona.get("identity").and_then(|v| v.as_object()) {
        let role = id_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let desc = id_obj
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !role.is_empty() {
            identity.push_str("You are ");
            identity.push_str(role);
            identity.push('.');
        }
        if !desc.is_empty() {
            if !identity.is_empty() {
                identity.push('\n');
            }
            identity.push_str(desc);
        }
    }

    // Voice block (prepended to identity so LLM sees tone/style up front).
    if let Some(voice) = persona.get("voice").and_then(|v| v.as_object()) {
        let style = voice.get("style").and_then(|v| v.as_str()).unwrap_or("");
        let fmt = voice
            .get("output_format")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !style.is_empty() || !fmt.is_empty() {
            let mut voice_text = String::new();
            voice_text.push_str("\n\n## Voice\n");
            if !style.is_empty() {
                voice_text.push_str(style);
                voice_text.push('\n');
            }
            if !fmt.is_empty() {
                voice_text.push_str(fmt);
            }
            identity.push_str(&voice_text);
        }
    }

    // Principles & constraints.
    let render_list = |obj: &Map<String, Value>, key: &str, header: &str, out: &mut String| {
        if let Some(arr) = obj.get(key).and_then(|v| v.as_array()) {
            let items: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
            if !items.is_empty() {
                out.push_str("\n\n## ");
                out.push_str(header);
                out.push('\n');
                for item in items {
                    out.push_str("- ");
                    out.push_str(item);
                    out.push('\n');
                }
            }
        }
    };
    render_list(persona, "principles", "Principles", &mut identity);
    render_list(persona, "constraints", "Constraints", &mut identity);
    render_list(
        persona,
        "decision_principles",
        "Decision principles",
        &mut identity,
    );

    let operating_instructions = persona
        .get("operating_instructions")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_guidance = persona
        .get("tool_guidance")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let error_handling = persona
        .get("error_handling")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let sp = json!({
        "identity": identity,
        "instructions": operating_instructions,
        "toolGuidance": tool_guidance,
        "errorHandling": error_handling,
        "examples": "",
    });
    obj.insert("structured_prompt".to_string(), sp);
}

/// Derive `protocol_capabilities[]` from per-capability `review_policy`,
/// `memory_policy`, and emitted event subscriptions. This preserves the
/// downstream checks that look for `manual_review` / `agent_memory` /
/// `emit_event` protocol capability entries.
fn derive_protocol_capabilities(obj: &mut Map<String, Value>) {
    if obj.get("protocol_capabilities").is_some() {
        return;
    }

    let mut caps: Vec<Value> = Vec::new();
    let mut review_contexts: Vec<String> = Vec::new();
    let mut memory_contexts: Vec<String> = Vec::new();
    let mut event_types: Vec<String> = Vec::new();

    if let Some(ucs) = obj.get("use_cases").and_then(|v| v.as_array()) {
        for uc in ucs {
            if let Some(review) = uc.get("review_policy").and_then(|v| v.as_object()) {
                let mode = review.get("mode").and_then(|v| v.as_str()).unwrap_or("never");
                if mode != "never" {
                    let ctx = review.get("context").and_then(|v| v.as_str()).unwrap_or("");
                    review_contexts.push(if ctx.is_empty() {
                        format!("review ({mode})")
                    } else {
                        format!("{mode}: {ctx}")
                    });
                }
            }
            if let Some(memory) = uc.get("memory_policy").and_then(|v| v.as_object()) {
                if memory.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let ctx = memory.get("context").and_then(|v| v.as_str()).unwrap_or("");
                    if !ctx.is_empty() {
                        memory_contexts.push(ctx.to_string());
                    } else {
                        memory_contexts.push("Memory enabled".to_string());
                    }
                }
            }
            if let Some(subs) = uc.get("event_subscriptions").and_then(|v| v.as_array()) {
                for s in subs {
                    let direction = s
                        .get("direction")
                        .and_then(|v| v.as_str())
                        .unwrap_or("listen");
                    if direction == "emit" {
                        if let Some(et) = s.get("event_type").and_then(|v| v.as_str()) {
                            event_types.push(et.to_string());
                        }
                    }
                }
            }
        }
    }

    // user_message is implied when any capability has notification_channels.
    let has_messages = obj
        .get("suggested_notification_channels")
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if has_messages {
        caps.push(json!({
            "type": "user_message",
            "label": "Delivers notifications via configured channels",
            "context": ""
        }));
    }

    if !review_contexts.is_empty() {
        caps.push(json!({
            "type": "manual_review",
            "label": "Human review requested on specific conditions",
            "context": review_contexts.join(" · ")
        }));
    }

    if !memory_contexts.is_empty() {
        caps.push(json!({
            "type": "agent_memory",
            "label": "Persistent memory across executions",
            "context": memory_contexts.join(" · ")
        }));
    }

    if !event_types.is_empty() {
        caps.push(json!({
            "type": "emit_event",
            "label": format!("Emits events: {}", event_types.join(", ")),
            "context": ""
        }));
    }

    if !caps.is_empty() {
        obj.insert("protocol_capabilities".to_string(), Value::Array(caps));
    }
}

/// Ensure each `use_cases[i]` has the `nodes` / `edges` fields populated
/// from its nested `use_case_flow` object. This makes the v3 use_cases[]
/// structurally compatible with v1's `use_case_flows[]` consumer.
fn ensure_use_case_flows(obj: &mut Map<String, Value>) {
    let Some(ucs) = obj.get_mut("use_cases").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for uc in ucs.iter_mut() {
        let Some(uc_obj) = uc.as_object_mut() else {
            continue;
        };
        // If the capability already has top-level nodes (v1 / hybrid shape),
        // leave them alone.
        if uc_obj.get("nodes").is_some() {
            continue;
        }
        let Some(flow) = uc_obj.get("use_case_flow").and_then(|v| v.as_object()).cloned() else {
            continue;
        };
        if let Some(nodes) = flow.get("nodes").cloned() {
            uc_obj.insert("nodes".to_string(), nodes);
        }
        if let Some(edges) = flow.get("edges").cloned() {
            uc_obj.insert("edges".to_string(), edges);
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn v3_fixture() -> Value {
        json!({
            "persona": {
                "identity": { "role": "Email triage assistant", "description": "Daily digest." },
                "voice": { "style": "Direct", "output_format": "Bullets" },
                "principles": ["Respect attention"],
                "constraints": ["No sending email"],
                "tools": ["gmail_search", "gmail_read"],
                "connectors": [{ "name": "gmail", "label": "Gmail", "auth_type": "oauth2" }],
                "notification_channels_default": [{ "type": "built-in", "description": "In-app" }],
                "operating_instructions": "Run once per cycle.",
                "tool_guidance": "Prefer snippet field.",
                "error_handling": "On auth failure, notify user."
            },
            "use_cases": [{
                "id": "uc_morning_digest",
                "title": "Morning Digest",
                "description": "Fetch and rank overnight email.",
                "capability_summary": "Daily ranked digest.",
                "enabled_by_default": true,
                "suggested_trigger": {
                    "trigger_type": "schedule",
                    "config": { "cron": "0 7 * * *" },
                    "description": "Daily 7am"
                },
                "connectors": ["gmail"],
                "notification_channels": [{ "type": "built-in", "description": "Deliver digest" }],
                "review_policy": { "mode": "never", "context": null },
                "memory_policy": { "enabled": true, "context": "Sender model" },
                "event_subscriptions": [
                    { "event_type": "digest_delivered", "direction": "emit" },
                    { "event_type": "inbox_zero", "direction": "emit" }
                ],
                "use_case_flow": {
                    "nodes": [{ "id": "n1", "type": "start", "label": "Fire" }],
                    "edges": []
                }
            }]
        })
    }

    #[test]
    fn detects_v3_by_persona_block() {
        let payload = v3_fixture();
        assert!(is_v3_shape(&payload));
    }

    #[test]
    fn detects_v3_by_nested_trigger() {
        let payload = json!({
            "use_cases": [{ "id": "uc_x", "suggested_trigger": { "trigger_type": "manual" } }]
        });
        assert!(is_v3_shape(&payload));
    }

    #[test]
    fn passes_through_v2_payload() {
        let mut payload = json!({
            "suggested_triggers": [{ "trigger_type": "schedule", "config": { "cron": "0 7 * * *" } }],
            "suggested_connectors": [{ "name": "gmail" }],
            "use_case_flows": [{ "id": "uc_1", "name": "Digest" }]
        });
        let before = payload.clone();
        normalize_v3_to_flat(&mut payload);
        assert_eq!(payload, before, "v2 payload must be left untouched");
    }

    #[test]
    fn flattens_triggers_with_use_case_id() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let triggers = payload
            .get("suggested_triggers")
            .and_then(|v| v.as_array())
            .expect("suggested_triggers produced");
        assert_eq!(triggers.len(), 1);
        assert_eq!(
            triggers[0].get("use_case_id").and_then(|v| v.as_str()),
            Some("uc_morning_digest")
        );
        assert_eq!(
            triggers[0].get("trigger_type").and_then(|v| v.as_str()),
            Some("schedule")
        );
    }

    #[test]
    fn flattens_events_with_use_case_id() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let events = payload
            .get("suggested_event_subscriptions")
            .and_then(|v| v.as_array())
            .expect("event subscriptions produced");
        assert_eq!(events.len(), 2);
        for e in events {
            assert_eq!(
                e.get("use_case_id").and_then(|v| v.as_str()),
                Some("uc_morning_digest")
            );
        }
    }

    #[test]
    fn hoists_persona_tools() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let tools = payload
            .get("suggested_tools")
            .and_then(|v| v.as_array())
            .expect("tools produced");
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn hoists_persona_connectors_with_uc_link() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let conns = payload
            .get("suggested_connectors")
            .and_then(|v| v.as_array())
            .expect("connectors produced");
        assert_eq!(conns.len(), 1);
        assert_eq!(
            conns[0].get("use_case_id").and_then(|v| v.as_str()),
            Some("uc_morning_digest")
        );
    }

    #[test]
    fn composes_structured_prompt() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let sp = payload
            .get("structured_prompt")
            .and_then(|v| v.as_object())
            .expect("structured_prompt produced");
        let identity = sp
            .get("identity")
            .and_then(|v| v.as_str())
            .expect("identity string");
        assert!(identity.contains("Email triage assistant"));
        assert!(identity.contains("Respect attention"));
        assert!(identity.contains("No sending email"));
    }

    #[test]
    fn derives_protocol_capabilities() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let caps = payload
            .get("protocol_capabilities")
            .and_then(|v| v.as_array())
            .expect("protocol_capabilities produced");
        let types: Vec<&str> = caps
            .iter()
            .filter_map(|c| c.get("type").and_then(|v| v.as_str()))
            .collect();
        assert!(types.contains(&"user_message"));
        assert!(types.contains(&"agent_memory"));
        assert!(types.contains(&"emit_event"));
        assert!(!types.contains(&"manual_review"), "review mode=never should not emit manual_review");
    }

    #[test]
    fn copies_flow_nodes_into_use_case_root() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let ucs = payload
            .get("use_cases")
            .and_then(|v| v.as_array())
            .expect("use_cases present");
        let nodes = ucs[0]
            .get("nodes")
            .and_then(|v| v.as_array())
            .expect("nodes hoisted to root of use_cases entry");
        assert_eq!(nodes.len(), 1);
    }

    #[test]
    fn idempotent() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        let once = payload.clone();
        normalize_v3_to_flat(&mut payload);
        assert_eq!(payload, once, "double-normalize must be idempotent");
    }
}
