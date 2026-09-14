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

use personas_db::models::agent_ir::{AgentIr, AgentIrUseCase};

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

/// An `input_schema` field that declared a type the derivation cannot express
/// as a persona parameter, so no editable knob exists for it. Carried out of
/// the derivation instead of being dropped, so callers can tell the user which
/// promised settings did not materialize.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedParam {
    /// The field's `name` in the recipe's `input_schema`.
    pub key: String,
    /// Human label, matching what the parameters editor would have shown.
    pub label: String,
    /// The declared `type` token with no persona ParamType mapping
    /// (`source_definition`, `connector_ref`, `list[string]`, ...).
    pub declared_type: String,
}

/// Derived params grouped by the capability that declared them (drives the
/// per-capability prompt section), plus the fields that were dropped.
#[derive(Debug, Clone)]
pub struct CapabilityParams {
    pub capability_title: String,
    pub params: Vec<DerivedParam>,
    /// Declared fields with an unsupported type. Never affects the rendered
    /// prompt section (only `params` does) — it exists purely so the gap can
    /// be reported instead of vanishing into a `tracing::debug!`.
    pub skipped: Vec<SkippedParam>,
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
    personas_core::utils::text::humanize_identifier(name, false)
}

/// Parse an `input_schema` array (`[{name,type,default,options,min,max,description}]`)
/// into `DerivedParam`s, returning the fields whose type has no persona
/// ParamType mapping alongside them rather than discarding those fields.
///
/// Public because it is the single source of truth for "which declared
/// settings actually become knobs" — the coverage command reports off it, so
/// the supported-type list never has to be mirrored (and drift) in TypeScript.
/// Shared by the typed (promote) and raw-JSON (instant_adopt / catalog sync)
/// derive entrypoints.
pub fn params_from_schema(schema: &[serde_json::Value]) -> (Vec<DerivedParam>, Vec<SkippedParam>) {
    let mut params = Vec::new();
    let mut skipped = Vec::new();
    for f in schema {
        // A blank name is as unusable as a missing one: it would mint a
        // `{{param.}}` placeholder and a keyless parameters-editor row. Treat
        // both the same — ignored entirely, reported as neither derived nor
        // skipped, since there is no key to report. No seeded recipe has one.
        let Some(name) = f
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
        else {
            continue;
        };
        let raw_type = f.get("type").and_then(|v| v.as_str()).unwrap_or("string");
        let Some(pt) = map_param_type(raw_type) else {
            tracing::debug!(
                field = name,
                ty = raw_type,
                "recipe_parameters: skipping unsupported input_schema type"
            );
            skipped.push(SkippedParam {
                key: name.to_string(),
                label: humanize(name),
                declared_type: raw_type.to_string(),
            });
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
    (params, skipped)
}

/// Derive tunable params from every typed use case's `input_schema`, grouped by
/// capability. Used on the promote path where use cases are `AgentIrUseCase`.
///
/// A capability that declared only unsupported fields is still emitted (with an
/// empty `params`) so the skip is visible to callers; it contributes nothing to
/// the rendered prompt section, which keys off `params` alone.
pub fn derive_capability_params(use_cases: &[AgentIrUseCase]) -> Vec<CapabilityParams> {
    let mut out = Vec::new();
    for uc in use_cases {
        let AgentIrUseCase::Structured(d) = uc else {
            continue;
        };
        let Some(schema) = d.input_schema.as_ref().and_then(|v| v.as_array()) else {
            continue;
        };
        let (params, skipped) = params_from_schema(schema);
        if !params.is_empty() || !skipped.is_empty() {
            out.push(CapabilityParams {
                capability_title: d.title.clone().unwrap_or_else(|| "Capability".to_string()),
                params,
                skipped,
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
        let (params, skipped) = params_from_schema(schema);
        if !params.is_empty() || !skipped.is_empty() {
            let title = uc
                .get("title")
                .or_else(|| uc.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Capability")
                .to_string();
            out.push(CapabilityParams {
                capability_title: title,
                params,
                skipped,
            });
        }
    }
    out
}

/// Derive tunable params from a persona's standing charters (spark
/// `agent-manifest-rebase`, WP2): each ACTIVE charter's `spec.inputSchema`
/// (the array e19 folded out of the legacy use case), grouped by charter
/// title. This is the runtime-prompt derivation for manifest personas, whose
/// `structured_prompt` (and with it the adopt-time-injected parameters block)
/// no longer renders — the `{{param.<key>}}` trusted-variable contract and
/// the `## Capability Parameters` section name are unchanged.
pub fn derive_capability_params_from_charters(
    charters: &[personas_db::models::PersonaResponsibility],
) -> Vec<CapabilityParams> {
    let mut out = Vec::new();
    for r in charters.iter().filter(|r| r.status == "active") {
        let Some(schema) = r.spec.input_schema.as_ref().and_then(|v| v.as_array()) else {
            continue;
        };
        let (params, skipped) = params_from_schema(schema);
        if !params.is_empty() || !skipped.is_empty() {
            out.push(CapabilityParams {
                capability_title: r.title.clone(),
                params,
                skipped,
            });
        }
    }
    out
}

/// Roll a derived capability set up into a coverage summary: how many
/// `input_schema` fields were declared in total, how many became editable
/// knobs, and which were dropped (deduped by key, declaration order preserved).
///
/// `declared` counts named fields only — a schema entry without a `name` is
/// malformed and is neither derived nor reported. Keys are deduped across
/// capabilities on the same first-wins rule as [`to_parameter_values`], so
/// `derived` matches the number of knobs the persona actually gains.
pub fn coverage(caps: &[CapabilityParams]) -> (usize, usize, Vec<SkippedParam>) {
    let mut seen = std::collections::HashSet::new();
    let mut skipped = Vec::new();
    let mut derived = 0usize;
    for cap in caps {
        for p in &cap.params {
            if seen.insert(p.key.clone()) {
                derived += 1;
            }
        }
        for s in &cap.skipped {
            if seen.insert(s.key.clone()) {
                skipped.push(s.clone());
            }
        }
    }
    (derived + skipped.len(), derived, skipped)
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

// ── Runtime binding of `{{param.*}}` (G23, measured live 2026-09-08) ────────
//
// Every attention-loop charter dispatch of the Grand Simulation's personas
// logged, from `prompt::variables`'s unresolved-placeholder warning:
// `keys=param.workspace_id, param.proposal_id, param.include_lessons,
// param.ask_id, param.max_requests, param.project_id, param.since,
// param.design_ref, param.dry_run, param.owner_goal, param.load_definition,
// param.standards` — so the models read raw `{{param.workspace_id}}` text.
// Four App Masters independently filed it as a defect.
//
// Two causes, both fixed here: a manifest persona carries
// `personas.parameters = NULL`, and the dispatch envelope carried no `param.*`
// keys at all. Resolution order is now, highest first:
//
//   1. `persona.parameters`     — trusted vars inside `replace_variables`
//   2. the dispatch's `param.*` — [`bind_context_parameters`] (user vars)
//   3. the schema `default`     — [`overlay_schema_defaults`] (user vars)
//   4. [`UNBOUND_PARAM_MARKER`] — [`mark_unbound_params`], after substitution
//
// Nothing here invents a value. A key with no row behind it stays unbound and
// renders the marker, which is what the charters' own field descriptions are
// written against ("Empty means read every open proposal…").

/// What a `{{param.<key>}}` renders as once no source could bind it.
///
/// A marker is not a value — it is the honest rendering of "nobody had this",
/// and it is actionable where literal template syntax is not: the model can
/// read it, and each field's own description in the rendered section says what
/// an absent value means for that charter.
pub const UNBOUND_PARAM_MARKER: &str = "(not provided)";

/// How many of a project's open goals `owner_goal` carries. The field wants
/// the owner's goal in the owner's words, not a backlog dump; past a handful
/// the value stops being a goal statement and starts being a list.
const MAX_BOUND_GOALS: usize = 5;

/// Overlay each derived param's schema `default` onto `input_data` under the
/// `param.<key>` name `replace_variables` resolves, WITHOUT displacing a key
/// the caller already bound. `None` means "nothing to add" — the caller then
/// passes its own `input_data` through untouched.
///
/// A `null` default is not a value: it is left unbound so it reads as one
/// rather than rendering an empty string that looks like a real answer.
pub fn overlay_schema_defaults(
    input_data: Option<&serde_json::Value>,
    caps: &[CapabilityParams],
) -> Option<serde_json::Value> {
    let mut map = input_data
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let mut added = false;
    for cap in caps {
        for p in &cap.params {
            if p.default.is_null() {
                continue;
            }
            let key = format!("param.{}", p.key);
            if map.contains_key(&key) {
                continue;
            }
            map.insert(key, value_for(&p.param_type, &p.default));
            added = true;
        }
    }
    added.then(|| serde_json::Value::Object(map))
}

/// Replace every `{{param.…}}` that survived variable substitution with
/// [`UNBOUND_PARAM_MARKER`].
///
/// Runs AFTER `replace_variables`, whose single warning naming the unresolved
/// keys stays the operator-facing record — this only changes what the MODEL
/// reads. The body pattern is `[^}]`, the same one the substituter matches on,
/// so the two agree on what a placeholder is.
pub fn mark_unbound_params(text: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        // INVARIANT: a compile-time literal — it cannot fail at runtime.
        regex::Regex::new(r"\{\{\s*param\.[^}]*\}\}").expect("static param placeholder regex")
    });
    re.replace_all(text, UNBOUND_PARAM_MARKER).to_string()
}

/// The `param.*` values a charter dispatch can source from the persona's OWN
/// context, shaped as the `param.<key>` entries `replace_variables` resolves
/// out of a run's `input_data`.
///
/// Every read is best-effort and every miss leaves its key unbound: a value
/// that cannot be sourced must render [`UNBOUND_PARAM_MARKER`], never a guess.
/// `design_ref` and `load_definition` have no table behind them at all and are
/// deliberately absent here.
///
/// Lives in the engine rather than at the attention loop's call site so every
/// manifest persona benefits, and so it can be tested against a real schema
/// (`personas_db::init_test_db`) instead of the app crate's test harness.
pub fn bind_context_parameters(
    pool: &personas_db::DbPool,
    persona_id: &str,
    responsibility_id: Option<&str>,
) -> serde_json::Map<String, serde_json::Value> {
    use personas_db::repos::core::{attention_ledger, personas as persona_repo, responsibilities};
    use personas_db::repos::dev::{goals, projects};

    let charter = responsibility_id.and_then(|id| {
        responsibilities::get_by_id(pool, id).unwrap_or_else(|e| {
            tracing::warn!(responsibility_id = id, error = %e,
                "param binding: charter read failed — its keys stay unbound");
            None
        })
    });

    // `project_id` — the charter's own binding first; a workspace-bound (or
    // unbound) charter falls back to the persona's project pin.
    let project_id = charter
        .as_ref()
        .and_then(|c| c.project_id.clone())
        .or_else(|| {
            persona_repo::get_by_id(pool, persona_id)
                .ok()
                .map(|p| p.project_id)
        })
        .filter(|s| !s.trim().is_empty());

    // `workspace_id` — the charter's own binding (mutually exclusive with
    // `project_id`, so at most one of the two ever answers), else the
    // workspace that owns the project.
    let workspace_id = charter
        .as_ref()
        .and_then(|c| c.workspace_id.clone())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            let pid = project_id.as_deref()?;
            let conn = pool.get().ok()?;
            personas_db::repos::workspaces::protection::workspace_of_project(&conn, pid)
                .ok()
                .flatten()
        });

    let mut out = serde_json::Map::new();
    if let Some(v) = project_id.clone() {
        out.insert("param.project_id".into(), v.into());
    }
    if let Some(v) = workspace_id {
        out.insert("param.workspace_id".into(), v.into());
    }

    // `since` — the end of this persona's last COMPLETED attention pass, which
    // is the watermark "empty means from the end of the last pass" names. No
    // completed pass yet leaves it unbound, which is the truthful answer for a
    // first wake.
    match attention_ledger::last_completed(pool, persona_id, "attention") {
        Ok(Some(entry)) => {
            if let Some(ts) = entry.completed_at.filter(|s| !s.trim().is_empty()) {
                out.insert("param.since".into(), ts.into());
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(persona_id, error = %e,
            "param binding: attention watermark read failed — `since` stays unbound"),
    }

    if let Some(pid) = project_id.as_deref() {
        // `owner_goal` — the project's still-open goals, in the owner's own
        // words. `done` is the only terminal status of the five.
        match goals::list_goals_by_project(pool, pid, None) {
            Ok(rows) => {
                let titles: Vec<String> = rows
                    .iter()
                    .filter(|g| g.status != "done")
                    .map(|g| g.title.clone())
                    .take(MAX_BOUND_GOALS)
                    .collect();
                if !titles.is_empty() {
                    out.insert("param.owner_goal".into(), titles.join("; ").into());
                }
            }
            Err(e) => tracing::warn!(project_id = pid, error = %e,
                "param binding: goal read failed — `owner_goal` stays unbound"),
        }
        // `standards` — the project's declared standards/branching envelope,
        // verbatim. It is the only place this project states its house rules.
        match projects::get_project_by_id(pool, pid) {
            Ok(p) => {
                if let Some(s) = p.standards_config.filter(|s| !s.trim().is_empty()) {
                    out.insert("param.standards".into(), s.into());
                }
            }
            Err(e) => tracing::warn!(project_id = pid, error = %e,
                "param binding: project read failed — `standards` stays unbound"),
        }
    }

    // `dry_run` — a dispatched charter pass is the real pass. The rehearsal is
    // the operator's to ask for, and no dispatch path can ask for it, so this
    // is a fact about the run rather than a default standing in for one.
    out.insert("param.dry_run".into(), serde_json::Value::Bool(false));

    out
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
    if let Some(obj) = ir
        .structured_prompt
        .as_mut()
        .and_then(|v| v.as_object_mut())
    {
        let existing = obj
            .get("instructions")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let updated = apply_to_instructions(existing, caps);
        obj.insert(
            "instructions".to_string(),
            serde_json::Value::String(updated),
        );
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
    let existing = obj
        .get("instructions")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    // Skip a pure no-op (no params and nothing to strip) so we don't add an
    // empty `instructions` key to a structured prompt that lacked one.
    if caps.iter().all(|c| c.params.is_empty()) && !existing.contains(SECTION_MARKER) {
        return;
    }
    let updated = apply_to_instructions(existing, caps);
    obj.insert(
        "instructions".to_string(),
        serde_json::Value::String(updated),
    );
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
            vec![
                "timeout_hours",
                "approval_levels",
                "require_review",
                "access_scheme",
                "dimensions"
            ]
        );
        let types: Vec<_> = caps[0]
            .params
            .iter()
            .map(|p| p.param_type.as_str())
            .collect();
        assert_eq!(
            types,
            vec!["number", "select", "boolean", "string", "string"]
        );
    }

    #[test]
    fn skipped_fields_are_reported_not_discarded() {
        let cases = vec![uc(
            "Contract Intake",
            json!([
                {"name": "timeout_hours", "type": "number", "default": 48},
                {"name": "sources", "type": "source_definition"},
                {"name": "repo", "type": "connector_ref", "connector": "codebase"},
                {"name": "watch_paths", "type": "list[string]"},
                {"name": "", "type": "number"},
            ]),
        )];
        let caps = derive_capability_params(&cases);
        assert_eq!(caps.len(), 1);
        // The three unsupported types survive the derivation, in declaration order.
        let skipped: Vec<_> = caps[0]
            .skipped
            .iter()
            .map(|s| (s.key.as_str(), s.declared_type.as_str()))
            .collect();
        assert_eq!(
            skipped,
            vec![
                ("sources", "source_definition"),
                ("repo", "connector_ref"),
                ("watch_paths", "list[string]"),
            ]
        );
        // Labels are humanized the same way derived params are.
        assert_eq!(caps[0].skipped[2].label, "Watch paths");
        // 4 named fields declared, 1 became a knob, 3 dropped. The unnamed
        // entry is malformed and counts toward neither.
        let (declared, derived, skips) = coverage(&caps);
        assert_eq!((declared, derived, skips.len()), (4, 1, 3));
    }

    #[test]
    fn capability_with_only_unsupported_fields_is_still_reported() {
        // The gap must be visible even when NOTHING derived — that is the
        // worst case for the user (a capability with no knobs at all).
        let caps = derive_capability_params_from_values(&[json!({
            "title": "Repo Watcher",
            "input_schema": [{"name": "repo", "type": "connector_ref"}]
        })]);
        assert_eq!(
            caps.len(),
            1,
            "must not be dropped just because params is empty"
        );
        assert!(caps[0].params.is_empty());
        assert_eq!(caps[0].skipped.len(), 1);
        // ...but it must not perturb the prompt section or the wire params.
        assert!(render_parameters_section(&caps).is_none());
        assert!(to_parameter_values(&caps).is_empty());
        assert_eq!(apply_to_instructions("Base.", &caps), "Base.");
    }

    #[test]
    fn coverage_dedupes_shared_keys_across_capabilities() {
        let caps = derive_capability_params_from_values(&[
            json!({"title": "A", "input_schema": [
                {"name": "shared", "type": "string"},
                {"name": "src", "type": "source_definition"}
            ]}),
            json!({"title": "B", "input_schema": [
                {"name": "shared", "type": "string"},
                {"name": "src", "type": "source_definition"}
            ]}),
        ]);
        let (declared, derived, skipped) = coverage(&caps);
        // One shared knob, one shared skip — not two of each.
        assert_eq!((declared, derived, skipped.len()), (2, 1, 1));
        assert_eq!(derived, to_parameter_values(&caps).len());
    }

    #[test]
    fn wire_objects_coerce_values() {
        let caps = vec![CapabilityParams {
            capability_title: "C".into(),
            params: vec![
                DerivedParam {
                    key: "a".into(),
                    label: "A".into(),
                    param_type: "number".into(),
                    default: json!(48),
                    description: None,
                    options: None,
                    min: Some(4.0),
                    max: Some(168.0),
                },
                DerivedParam {
                    key: "b".into(),
                    label: "B".into(),
                    param_type: "string".into(),
                    default: serde_json::Value::Null,
                    description: Some("d".into()),
                    options: None,
                    min: None,
                    max: None,
                },
                DerivedParam {
                    key: "c".into(),
                    label: "C".into(),
                    param_type: "string".into(),
                    default: json!(["x", "y"]),
                    description: None,
                    options: None,
                    min: None,
                    max: None,
                },
            ],
            skipped: Vec::new(),
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
            CapabilityParams {
                capability_title: "C1".into(),
                params: vec![DerivedParam {
                    key: "shared".into(),
                    label: "First".into(),
                    param_type: "string".into(),
                    default: json!("one"),
                    description: None,
                    options: None,
                    min: None,
                    max: None,
                }],
                skipped: Vec::new(),
            },
            CapabilityParams {
                capability_title: "C2".into(),
                params: vec![DerivedParam {
                    key: "shared".into(),
                    label: "Second".into(),
                    param_type: "string".into(),
                    default: json!("two"),
                    description: None,
                    options: None,
                    min: None,
                    max: None,
                }],
                skipped: Vec::new(),
            },
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
        let existing = vec![
            json!({"key": "risk_tolerance", "label": "Template Risk", "type": "string", "value": "high"}),
        ];
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

    // ── G23: `{{param.*}}` must never reach the model as template syntax ──

    #[test]
    fn schema_default_answers_and_a_bound_key_still_wins() {
        let caps = derive_capability_params_from_values(&[json!({
            "title": "Cap",
            "input_schema": [
                {"name": "dry_run", "type": "boolean", "default": true},
                {"name": "max_requests", "type": "number", "default": 2},
                {"name": "workspace_id", "type": "text"},
            ]
        })]);
        // Nothing bound: the two declared defaults overlay, the third does not
        // (a null default is not a value).
        let overlaid = overlay_schema_defaults(None, &caps).expect("defaults to overlay");
        assert_eq!(overlaid["param.dry_run"], json!(true));
        assert_eq!(overlaid["param.max_requests"], json!(2));
        assert!(overlaid.get("param.workspace_id").is_none());

        // A key the dispatch already bound is NOT displaced by its default.
        let bound = json!({ "param.dry_run": false, "task": "go" });
        let overlaid = overlay_schema_defaults(Some(&bound), &caps).expect("still adds one");
        assert_eq!(overlaid["param.dry_run"], json!(false));
        assert_eq!(overlaid["task"], json!("go"));
    }

    #[test]
    fn no_defaults_declared_leaves_input_data_untouched() {
        let caps = derive_capability_params_from_values(&[json!({
            "title": "Cap", "input_schema": [{"name": "ask_id", "type": "text"}]
        })]);
        assert!(
            overlay_schema_defaults(Some(&json!({"task": "go"})), &caps).is_none(),
            "nothing to add must not clone the envelope"
        );
    }

    #[test]
    fn unbound_placeholders_render_the_marker_not_template_syntax() {
        let rendered = "- Workspace: {{param.workspace_id}}\n- Ask: {{ param.ask_id }}\n\
                        - Kept: {{task}}\n";
        let out = mark_unbound_params(rendered);
        assert!(
            !out.contains("{{param."),
            "no `{{{{param.*}}}}` may survive to the model: {out}"
        );
        assert_eq!(out.matches(UNBOUND_PARAM_MARKER).count(), 2);
        assert!(
            out.contains("{{task}}"),
            "a non-param placeholder is not this function's business"
        );
    }

    #[test]
    fn binds_workspace_project_goal_and_watermark_from_real_rows() {
        use personas_db::models::{
            CreatePersonaInput, ResponsibilityCadence, ResponsibilitySpec, ResponsibilityTenure,
        };
        use personas_db::repos::core::{personas, responsibilities};
        use personas_db::repos::dev::{goals, projects};

        let pool = personas_db::init_test_db().unwrap();
        let project = projects::create_project(
            &pool,
            "Ledger Core",
            "C:/repos/ledger-core",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        goals::create_goal(
            &pool,
            &project.id,
            "Open a current account in under three minutes",
            None,
            None,
            Some("open"),
            None,
            None,
        )
        .unwrap();
        goals::create_goal(
            &pool,
            &project.id,
            "Shipped last quarter",
            None,
            None,
            Some("done"),
            None,
            None,
        )
        .unwrap();
        projects::update_standards_config(
            &pool,
            &project.id,
            Some("{\"precommit\":{\"lint\":true}}"),
        )
        .unwrap();

        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "App Master".into(),
                system_prompt: "You run the project.".into(),
                project_id: Some(project.id.clone()),
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        let cadence = ResponsibilityCadence::default();
        let tenure = ResponsibilityTenure::default();
        let spec = ResponsibilitySpec::default();
        let charter = responsibilities::create(
            &pool,
            responsibilities::CreateResponsibilityInput {
                persona_id: &persona.id,
                title: "Advance the ledger",
                domain: "engineering",
                outcomes: &[],
                objectives: &[],
                scope_rung: 2,
                refusal_classes: &[],
                approval_gates: &[],
                owner: "",
                cadence: &cadence,
                budget_monthly_usd: None,
                tenure: &tenure,
                status: "active",
                project_id: Some(&project.id),
                workspace_id: None,
                source: "operator",
                connectors: &[],
                procedure: "Advance it.",
                spec: &spec,
            },
        )
        .unwrap();

        let bound = bind_context_parameters(&pool, &persona.id, Some(&charter.id));
        assert_eq!(bound["param.project_id"], json!(project.id));
        assert_eq!(
            bound["param.owner_goal"],
            json!("Open a current account in under three minutes"),
            "a done goal is not an open one"
        );
        assert_eq!(
            bound["param.standards"],
            json!("{\"precommit\":{\"lint\":true}}")
        );
        assert_eq!(bound["param.dry_run"], json!(false));
        // No workspace assigned and no completed attention pass yet: both stay
        // UNBOUND rather than being invented.
        assert!(bound.get("param.workspace_id").is_none());
        assert!(bound.get("param.since").is_none());
        // And nothing that has no table behind it is ever bound.
        assert!(bound.get("param.design_ref").is_none());
        assert!(bound.get("param.load_definition").is_none());
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
        assert!(!sp["instructions"]
            .as_str()
            .unwrap()
            .contains(SECTION_MARKER));
    }
}
