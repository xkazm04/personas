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

/// Parse an `input_schema` array (`[{name,type,default,options,min,max,description}]`)
/// into `DerivedParam`s, skipping unsupported field types. Shared by the typed
/// (promote) and raw-JSON (instant_adopt / catalog sync) derive entrypoints.
fn params_from_schema(schema: &[serde_json::Value]) -> Vec<DerivedParam> {
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
    params
}

/// Derive tunable params from every typed use case's `input_schema`, grouped by
/// capability. Used on the promote path where use cases are `AgentIrUseCase`.
pub fn derive_capability_params(use_cases: &[AgentIrUseCase]) -> Vec<CapabilityParams> {
    let mut out = Vec::new();
    for uc in use_cases {
        let AgentIrUseCase::Structured(d) = uc else {
            continue;
        };
        let Some(schema) = d.input_schema.as_ref().and_then(|v| v.as_array()) else {
            continue;
        };
        let params = params_from_schema(schema);
        if !params.is_empty() {
            out.push(CapabilityParams {
                capability_title: d.title.clone().unwrap_or_else(|| "Capability".to_string()),
                params,
            });
        }
    }
    out
}

/// Derive tunable params from raw-JSON use-case values, grouped by capability.
/// Used where use cases live as untyped `serde_json::Value` — the instant_adopt
/// `design["use_cases"]` array and a persona's persisted
/// `design_context.useCases`. Reads each object's `title`/`name` + `input_schema`.
pub fn derive_capability_params_from_values(
    use_cases: &[serde_json::Value],
) -> Vec<CapabilityParams> {
    let mut out = Vec::new();
    for uc in use_cases {
        let Some(schema) = uc.get("input_schema").and_then(|v| v.as_array()) else {
            continue;
        };
        let params = params_from_schema(schema);
        if !params.is_empty() {
            let title = uc
                .get("title")
                .or_else(|| uc.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Capability")
                .to_string();
            out.push(CapabilityParams {
                capability_title: title,
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

/// The H2 marker that opens the synthesized section. Used both to render and to
/// strip a prior copy so re-injection is idempotent.
const SECTION_MARKER: &str = "## Capability Parameters";

/// Merge derived recipe params UNDER an existing `persona.parameters` set:
/// existing keys win (template-authored or user-tuned), new derived keys are
/// appended in order. Idempotent — re-deriving the same recipe adds nothing.
pub fn merge_persona_parameters(
    existing: &[serde_json::Value],
    derived: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    let mut keys: std::collections::HashSet<String> = existing
        .iter()
        .filter_map(|p| p.get("key").and_then(|v| v.as_str()).map(str::to_string))
        .collect();
    let mut out = existing.to_vec();
    for d in derived {
        if let Some(k) = d.get("key").and_then(|v| v.as_str()) {
            if keys.insert(k.to_string()) {
                out.push(d.clone());
            }
        }
    }
    out
}

/// Remove any previously-injected `## Capability Parameters` block from an
/// instructions string (from its H2 marker to the next H2 or end of string),
/// so a fresh section can be appended without stacking duplicates.
fn strip_parameters_section(instructions: &str) -> String {
    let Some(pos) = instructions.find(SECTION_MARKER) else {
        return instructions.to_string();
    };
    let after = pos + SECTION_MARKER.len();
    // The block runs until the next markdown H2 (`\n## `) or the end.
    let tail = instructions[after..]
        .find("\n## ")
        .map(|rel| &instructions[after + rel + 1..])
        .unwrap_or("");
    let head = instructions[..pos].trim_end();
    if tail.is_empty() {
        head.to_string()
    } else if head.is_empty() {
        tail.to_string()
    } else {
        format!("{head}\n\n{tail}")
    }
}

/// Idempotently apply the capability-parameters section to an instructions
/// string: strip any prior copy, then append the freshly-rendered block. With
/// no params it just strips (used when a capability was removed).
pub fn apply_to_instructions(instructions: &str, caps: &[CapabilityParams]) -> String {
    let base = strip_parameters_section(instructions);
    match render_parameters_section(caps) {
        Some(section) => format!("{}{}", base.trim_end(), section),
        None => base,
    }
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
    if caps.iter().all(|c| c.params.is_empty()) {
        return;
    }
    if let Some(obj) = ir.structured_prompt.as_mut().and_then(|v| v.as_object_mut()) {
        let existing = obj.get("instructions").and_then(|v| v.as_str()).unwrap_or("");
        let updated = apply_to_instructions(existing, caps);
        obj.insert("instructions".to_string(), serde_json::Value::String(updated));
        return;
    }
    let existing = ir.system_prompt.as_deref().unwrap_or("");
    ir.system_prompt = Some(apply_to_instructions(existing, caps));
}

/// Inject the section into a bare `structured_prompt` JSON value's
/// `instructions` field (idempotently). For paths that hold the persona's
/// structured prompt as untyped JSON rather than a typed `AgentIr` — the
/// instant_adopt pipeline and the catalog `sync_capability_parameters` command.
/// No-op if the value isn't a JSON object. When `caps` is empty this strips any
/// prior section (so removing a capability drops its lines).
pub fn inject_into_structured_prompt(sp: &mut serde_json::Value, caps: &[CapabilityParams]) {
    let Some(obj) = sp.as_object_mut() else {
        return;
    };
    let existing = obj.get("instructions").and_then(|v| v.as_str()).unwrap_or("");
    // Skip a pure no-op (no params and nothing to strip) so we don't add an
    // empty `instructions` key to a structured prompt that lacked one.
    if caps.iter().all(|c| c.params.is_empty()) && !existing.contains(SECTION_MARKER) {
        return;
    }
    let updated = apply_to_instructions(existing, caps);
    obj.insert("instructions".to_string(), serde_json::Value::String(updated));
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

    #[test]
    fn derives_from_raw_json_use_cases() {
        let ucs = vec![
            json!({"title": "Contract Intake", "input_schema": [
                {"name": "risk_tolerance", "type": "enum", "options": ["low", "high"], "default": "low"}
            ]}),
            json!({"name": "No Schema Cap"}), // no input_schema → skipped
        ];
        let caps = derive_capability_params_from_values(&ucs);
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].capability_title, "Contract Intake");
        assert_eq!(caps[0].params[0].key, "risk_tolerance");
        assert_eq!(caps[0].params[0].param_type, "select");
    }

    #[test]
    fn reinjection_is_idempotent_no_duplicate_block() {
        let caps = derive_capability_params_from_values(&[json!({
            "title": "Cap", "input_schema": [{"name": "k", "type": "number", "default": 1}]
        })]);
        let once = apply_to_instructions("Base.", &caps);
        let twice = apply_to_instructions(&once, &caps);
        assert_eq!(once, twice, "re-applying must not stack a second block");
        assert_eq!(twice.matches(SECTION_MARKER).count(), 1);
        assert!(twice.starts_with("Base."));
        assert!(twice.contains("{{param.k}}"));
    }

    #[test]
    fn strip_removes_block_and_preserves_following_heading() {
        let caps = derive_capability_params_from_values(&[json!({
            "title": "Cap", "input_schema": [{"name": "k", "type": "number", "default": 1}]
        })]);
        let with = apply_to_instructions("Intro text.\n\n## Examples\nfoo", &caps);
        // Section was inserted at end (after the Examples heading in this input);
        // stripping it must leave the Examples heading intact.
        let stripped = apply_to_instructions(&with, &[]);
        assert!(!stripped.contains(SECTION_MARKER));
        assert!(stripped.contains("## Examples"));
        assert!(stripped.contains("Intro text."));
    }

    #[test]
    fn merge_existing_wins_and_appends_new() {
        let existing = vec![json!({"key": "risk_tolerance", "label": "Template Risk", "type": "string", "value": "high"})];
        let derived = vec![
            json!({"key": "risk_tolerance", "label": "Derived Risk", "type": "select", "value": "low"}),
            json!({"key": "contract_types", "label": "Contract types", "type": "string", "value": ""}),
        ];
        let merged = merge_persona_parameters(&existing, &derived);
        assert_eq!(merged.len(), 2);
        // Existing key preserved verbatim (template wins).
        assert_eq!(merged[0]["label"], json!("Template Risk"));
        assert_eq!(merged[0]["value"], json!("high"));
        // New derived key appended.
        assert_eq!(merged[1]["key"], json!("contract_types"));
    }

    #[test]
    fn inject_into_structured_prompt_value_is_idempotent() {
        let caps = derive_capability_params_from_values(&[json!({
            "title": "Cap", "input_schema": [{"name": "k", "type": "string", "default": "v"}]
        })]);
        let mut sp = json!({"identity": "id", "instructions": "Do the thing."});
        inject_into_structured_prompt(&mut sp, &caps);
        inject_into_structured_prompt(&mut sp, &caps);
        let instr = sp["instructions"].as_str().unwrap();
        assert_eq!(instr.matches(SECTION_MARKER).count(), 1);
        assert!(instr.starts_with("Do the thing."));
        // Empty caps strips it back out.
        inject_into_structured_prompt(&mut sp, &[]);
        assert!(!sp["instructions"].as_str().unwrap().contains(SECTION_MARKER));
    }
}
