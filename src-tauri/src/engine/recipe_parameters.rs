//! Recipe parameterization (2026-07) — bridge each recipe use-case's declared
//! `input_schema` into the persona-level parameter system so the knobs a recipe
//! ships with actually reach runtime and stay editable without a rebuild.
//!
//! Background: recipes declare tunable inputs in `input_schema`, but the
//! placeholders that would consume them only ever lived in `sample_input`
//! (dropped on promote), so the params were inert. The *working* parameter
//! mechanism is persona-level: `{{param.KEY}}` in `structured_prompt`
//! (instructions/toolGuidance) resolved every execution by
//! `engine::prompt::variables::replace_variables` from `persona.parameters`.
//! This module derives persona parameters from `input_schema` and synthesizes a
//! `## Capability Parameters` section that references them — so the recipe's
//! declared knobs become live, editable, and visible to the model.
//!
//! Design doc: docs/architecture/recipe-parameterization-roadmap.md (Option 1).

use crate::db::models::agent_ir::{AgentIr, AgentIrUseCase};

/// One tunable parameter derived from an `input_schema` field.
#[derive(Debug, Clone)]
pub struct DerivedParam {
    /// Placeholder key — becomes `{{param.<key>}}` and the persona.parameters key.
    pub key: String,
    /// Human label for the parameters editor.
    pub label: String,
    /// persona ParamType token: `number` | `string` | `boolean` | `select`.
    pub param_type: String,
    /// Default value (verbatim from input_schema; may be Null).
    pub default: serde_json::Value,
    pub description: Option<String>,
    pub options: Option<Vec<String>>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Derived params grouped by the capability that declared them (drives the
/// per-capability prompt section).
#[derive(Debug, Clone)]
pub struct CapabilityParams {
    pub capability_title: String,
    pub params: Vec<DerivedParam>,
}

/// Map an `input_schema` field `type` to a persona ParamType token, or `None`
/// for a v1-unsupported type (`source_definition` / `connector_ref` /
/// `list[string]`) — those are skipped rather than mis-typed.
fn map_param_type(t: &str) -> Option<&'static str> {
    match t {
        "number" => Some("number"),
        "boolean" => Some("boolean"),
        "enum" | "select" => Some("select"),
        // A multi-select's value is an array — model it as free string
        // (comma-joined) so the single-value parameters editor stays happy.
        "multi_select" => Some("string"),
        "text" | "textarea" | "string" => Some("string"),
        _ => None,
    }
}

/// `snake_case_name` → `Snake case name` for the editor label.
fn humanize(name: &str) -> String {
    let spaced = name.replace(['_', '-'], " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => spaced,
    }
}

/// Derive tunable params from every use case's `input_schema`, grouped by
/// capability. Unsupported field types are skipped (logged at debug).
pub fn derive_capability_params(use_cases: &[AgentIrUseCase]) -> Vec<CapabilityParams> {
    let mut out = Vec::new();
    for uc in use_cases {
        let AgentIrUseCase::Structured(d) = uc else {
            continue;
        };
        let Some(schema) = d.input_schema.as_ref().and_then(|v| v.as_array()) else {
            continue;
        };
        let mut params = Vec::new();
        for f in schema {
            let Some(name) = f.get("name").and_then(|v| v.as_str()) else {
                continue;
            };
            let raw_type = f.get("type").and_then(|v| v.as_str()).unwrap_or("string");
            let Some(pt) = map_param_type(raw_type) else {
                tracing::debug!(
                    field = name,
                    ty = raw_type,
                    "recipe_parameters: skipping unsupported input_schema type"
                );
                continue;
            };
            params.push(DerivedParam {
                key: name.to_string(),
                label: humanize(name),
                param_type: pt.to_string(),
                default: f.get("default").cloned().unwrap_or(serde_json::Value::Null),
                description: f
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                options: f.get("options").and_then(|v| v.as_array()).map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                }),
                min: f.get("min").and_then(|v| v.as_f64()),
                max: f.get("max").and_then(|v| v.as_f64()),
            });
        }
        if !params.is_empty() {
            out.push(CapabilityParams {
                capability_title: d.title.clone().unwrap_or_else(|| "Capability".to_string()),
                params,
            });
        }
    }
    out
}

/// Coerce an input_schema default into a runtime-clean parameter `value`:
/// Null → `""` (so `{{param.x}}` never renders the literal "null"); a
/// multi_select array → a comma-joined string; everything else verbatim.
fn value_for(param_type: &str, default: &serde_json::Value) -> serde_json::Value {
    match default {
        serde_json::Value::Null => serde_json::Value::String(String::new()),
        serde_json::Value::Array(arr) if param_type == "string" => {
            let joined = arr
                .iter()
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .collect::<Vec<_>>()
                .join(", ");
            serde_json::Value::String(joined)
        }
        other => other.clone(),
    }
}

/// Flatten derived params into `persona.parameters` wire objects (the exact
/// shape `populate_persona_parameters_from_design` produces). Deduped by key —
/// first capability that declares a key wins (a shared key across capabilities
/// is one shared knob).
pub fn to_parameter_values(caps: &[CapabilityParams]) -> Vec<serde_json::Value> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for cap in caps {
        for p in &cap.params {
            if !seen.insert(p.key.clone()) {
                continue;
            }
            let mut obj = serde_json::json!({
                "key": p.key,
                "label": p.label,
                "type": p.param_type,
                "default_value": p.default,
                "value": value_for(&p.param_type, &p.default),
            });
            if let Some(d) = &p.description {
                obj["description"] = serde_json::Value::String(d.clone());
            }
            if let Some(o) = &p.options {
                obj["options"] = serde_json::json!(o);
            }
            if let Some(m) = p.min {
                obj["min"] = serde_json::json!(m);
            }
            if let Some(m) = p.max {
                obj["max"] = serde_json::json!(m);
            }
            out.push(obj);
        }
    }
    out
}

/// Build the `## Capability Parameters` markdown block that references
/// `{{param.<key>}}`, grouped by capability. `None` when there are no params.
pub fn render_parameters_section(caps: &[CapabilityParams]) -> Option<String> {
    if caps.iter().all(|c| c.params.is_empty()) {
        return None;
    }
    let mut body = String::from(
        "\n\n## Capability Parameters (configured — adjustable without a rebuild)\n\n\
         These are the active settings for your capabilities. Treat them as authoritative \
         configuration and honor them in every run.\n",
    );
    for cap in caps {
        if cap.params.is_empty() {
            continue;
        }
        body.push_str(&format!("\n**{}**\n", cap.capability_title));
        for p in &cap.params {
            let desc = p
                .description
                .as_deref()
                .map(|d| format!(" — {d}"))
                .unwrap_or_default();
            // `{{{{param.{}}}}}` → literal `{{param.<key>}}` for runtime resolve.
            body.push_str(&format!("- {}: {{{{param.{}}}}}{}\n", p.label, p.key, desc));
        }
    }
    Some(body)
}

/// Append the synthesized `## Capability Parameters` section to the persona's
/// `structured_prompt.instructions` (which the runtime substitutes), so the
/// `{{param.*}}` references resolve to live values. Falls back to
/// `system_prompt` only when there is no structured prompt. No-op when there
/// are no derived params.
pub fn inject_capability_parameters_section(ir: &mut AgentIr, caps: &[CapabilityParams]) {
    let Some(section) = render_parameters_section(caps) else {
        return;
    };
    if let Some(obj) = ir.structured_prompt.as_mut().and_then(|v| v.as_object_mut()) {
        let existing = obj
            .get("instructions")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        obj.insert(
            "instructions".to_string(),
            serde_json::Value::String(format!("{existing}{section}")),
        );
        return;
    }
    match ir.system_prompt.as_mut() {
        Some(p) => p.push_str(&section),
        None => ir.system_prompt = Some(section),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn uc(title: &str, input_schema: serde_json::Value) -> AgentIrUseCase {
        serde_json::from_value(json!({
            "id": "uc_x",
            "title": title,
            "input_schema": input_schema,
        }))
        .unwrap()
    }

    #[test]
    fn maps_types_and_skips_unsupported() {
        let cases = vec![uc(
            "Contract Intake",
            json!([
                {"name": "timeout_hours", "type": "number", "default": 48, "min": 4, "max": 168, "description": "Approval timeout"},
                {"name": "approval_levels", "type": "enum", "options": ["a", "b"], "default": "a"},
                {"name": "require_review", "type": "boolean", "default": true},
                {"name": "access_scheme", "type": "text"},
                {"name": "dimensions", "type": "multi_select", "options": ["x","y"], "default": ["x","y"]},
                {"name": "sources", "type": "source_definition"},
                {"name": "repo", "type": "connector_ref", "connector": "codebase"},
            ]),
        )];
        let caps = derive_capability_params(&cases);
        assert_eq!(caps.len(), 1);
        let keys: Vec<_> = caps[0].params.iter().map(|p| p.key.as_str()).collect();
        // source_definition + connector_ref skipped; 5 supported remain.
        assert_eq!(
            keys,
            vec!["timeout_hours", "approval_levels", "require_review", "access_scheme", "dimensions"]
        );
        let types: Vec<_> = caps[0].params.iter().map(|p| p.param_type.as_str()).collect();
        assert_eq!(types, vec!["number", "select", "boolean", "string", "string"]);
    }

    #[test]
    fn wire_objects_coerce_values() {
        let caps = vec![CapabilityParams {
            capability_title: "C".into(),
            params: vec![
                DerivedParam { key: "a".into(), label: "A".into(), param_type: "number".into(), default: json!(48), description: None, options: None, min: Some(4.0), max: Some(168.0) },
                DerivedParam { key: "b".into(), label: "B".into(), param_type: "string".into(), default: serde_json::Value::Null, description: Some("d".into()), options: None, min: None, max: None },
                DerivedParam { key: "c".into(), label: "C".into(), param_type: "string".into(), default: json!(["x", "y"]), description: None, options: None, min: None, max: None },
            ],
        }];
        let vals = to_parameter_values(&caps);
        assert_eq!(vals.len(), 3);
        assert_eq!(vals[0]["value"], json!(48));
        assert_eq!(vals[0]["min"], json!(4.0));
        // Null default → empty string (never renders "null").
        assert_eq!(vals[1]["value"], json!(""));
        assert_eq!(vals[1]["description"], json!("d"));
        // multi_select array → comma-joined string.
        assert_eq!(vals[2]["value"], json!("x, y"));
    }

    #[test]
    fn dedupes_keys_first_wins() {
        let caps = vec![
            CapabilityParams { capability_title: "C1".into(), params: vec![DerivedParam { key: "shared".into(), label: "First".into(), param_type: "string".into(), default: json!("one"), description: None, options: None, min: None, max: None }] },
            CapabilityParams { capability_title: "C2".into(), params: vec![DerivedParam { key: "shared".into(), label: "Second".into(), param_type: "string".into(), default: json!("two"), description: None, options: None, min: None, max: None }] },
        ];
        let vals = to_parameter_values(&caps);
        assert_eq!(vals.len(), 1);
        assert_eq!(vals[0]["label"], json!("First"));
    }

    #[test]
    fn section_references_live_placeholders() {
        let caps = derive_capability_params(&[uc(
            "Contract Intake",
            json!([{"name": "timeout_hours", "type": "number", "default": 48, "description": "Approval timeout"}]),
        )]);
        let section = render_parameters_section(&caps).expect("section");
        assert!(section.contains("## Capability Parameters"));
        assert!(section.contains("**Contract Intake**"));
        assert!(section.contains("{{param.timeout_hours}}"));
        assert!(section.contains("— Approval timeout"));
    }

    #[test]
    fn inject_appends_to_structured_instructions() {
        let mut ir: AgentIr = serde_json::from_value(json!({
            "structured_prompt": { "identity": "id", "instructions": "Base instructions." },
            "use_cases": [],
        }))
        .unwrap();
        let caps = derive_capability_params(&[uc(
            "Cap",
            json!([{"name": "k", "type": "number", "default": 1}]),
        )]);
        inject_capability_parameters_section(&mut ir, &caps);
        let instr = ir.structured_prompt.as_ref().unwrap()["instructions"]
            .as_str()
            .unwrap();
        assert!(instr.starts_with("Base instructions."));
        assert!(instr.contains("{{param.k}}"));
    }

    #[test]
    fn no_params_is_noop() {
        assert!(render_parameters_section(&[]).is_none());
        let mut ir: AgentIr = serde_json::from_value(json!({
            "system_prompt": "sp", "use_cases": [],
        }))
        .unwrap();
        inject_capability_parameters_section(&mut ir, &[]);
        assert_eq!(ir.system_prompt.as_deref(), Some("sp"));
    }
}
