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

use crate::db::models::RecipeDefinition;
use crate::error::AppError;

/// Stage B Phase 2 — hydrate any `recipe_ref` shaped use cases in `payload`
/// in place by looking up the referenced recipe and replacing the
/// `recipe_ref` UC with the inline UC shape stored in the recipe's
/// `prompt_template` field (which holds the serialized UC JSON, set by
/// `derive_recipes_from_template_inner` in Phase 1b).
///
/// `lookup_recipe` is a closure taking a recipe id and returning either the
/// recipe row or an `AppError` (typically `AppError::NotFound`). The closure
/// abstraction keeps this function testable without a live DB — the
/// production caller wires it to `recipe_repo::get_by_id`.
///
/// **Hydration is destructive on mismatched prompt_template:** if a recipe's
/// `prompt_template` is not valid JSON (e.g. a hand-edited recipe stored a
/// raw LLM prompt instead of a serialized UC), this returns
/// `AppError::Validation` rather than silently producing a malformed
/// `agent_ir`. That error surfaces to the user with the offending recipe id.
///
/// **Bindings substitution** is text-based for v1: each `{{<key>}}` token
/// inside the hydrated UC's serialized form is replaced with the
/// corresponding binding value. Phase 1b's migration leaves bindings empty,
/// so the substitution is a no-op for derived recipes today; the path is
/// here for future template authors who introduce parameterization.
pub fn hydrate_recipe_refs<F>(
    payload: &mut Value,
    lookup_recipe: F,
) -> Result<(), AppError>
where
    F: Fn(&str) -> Result<RecipeDefinition, AppError>,
{
    let Some(obj) = payload.as_object_mut() else {
        return Ok(());
    };
    let Some(use_cases) = obj.get_mut("use_cases").and_then(|v| v.as_array_mut())
    else {
        return Ok(());
    };

    // Stage B Phase 2.3 — strict mode. Every UC in a v3 payload MUST be a
    // `recipe_ref`. Inline UCs are a Phase 2.2-or-earlier shape and were
    // retired by the catalog conversion. Reject them at the boundary so
    // a malformed or stale template fails loudly here, instead of producing
    // a half-hydrated `agent_ir` that confuses the downstream pipeline.
    //
    // The check fires only when at least one UC IS a recipe_ref — payloads
    // with zero UCs at all (or pure-v2 payloads that don't look like v3 in
    // the first place) are still no-ops, so callers can pass arbitrary
    // payloads without fear of false-positive errors.
    let any_recipe_ref = use_cases.iter().any(|uc| {
        uc.as_object()
            .and_then(|o| o.get("recipe_ref"))
            .is_some()
    });
    if any_recipe_ref {
        for (idx, uc) in use_cases.iter().enumerate() {
            let has_ref = uc
                .as_object()
                .and_then(|o| o.get("recipe_ref"))
                .is_some();
            if !has_ref {
                let uc_id = uc
                    .as_object()
                    .and_then(|o| o.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("<unknown>");
                return Err(AppError::Validation(format!(
                    "use_cases[{idx}] (id={uc_id}) is inline-shaped; \
                     Stage B Phase 2.3 retired inline UCs in mixed templates — \
                     every UC in a recipe_ref-bearing template must itself be a recipe_ref"
                )));
            }
        }
    }

    for uc in use_cases.iter_mut() {
        let recipe_ref_data = uc
            .as_object()
            .and_then(|uc_obj| uc_obj.get("recipe_ref"))
            .and_then(|v| v.as_object())
            .cloned();

        let Some(recipe_ref) = recipe_ref_data else {
            continue; // pure-inline payload (no recipe_refs anywhere) — pass through
        };

        let recipe_id = recipe_ref
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::Validation(
                    "use_case.recipe_ref is missing required `id` field".into(),
                )
            })?
            .to_string();

        let bindings = recipe_ref
            .get("bindings")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        // Look up the recipe row.
        let recipe = lookup_recipe(&recipe_id)?;

        // Deserialize the recipe's prompt_template back into a UC value.
        // Phase 1b stores the original UC JSON here verbatim, so this round-trip
        // restores the inline UC shape that downstream normalize_v3_to_flat()
        // expects.
        let mut hydrated: Value = serde_json::from_str(&recipe.prompt_template)
            .map_err(|e| {
                AppError::Validation(format!(
                    "recipe {recipe_id} has malformed prompt_template (expected serialized UC JSON): {e}"
                ))
            })?;

        // Apply bindings substitutions if any.
        if !bindings.is_empty() {
            apply_bindings(&mut hydrated, &bindings)?;
        }

        // Replace the recipe_ref UC with the hydrated inline shape.
        *uc = hydrated;
    }

    Ok(())
}

/// Replace `{{<key>}}` placeholders inside `value`'s serialized form with
/// the corresponding binding value, then deserialize. v1 implementation:
/// string-level find-and-replace, slow-but-correct.
///
/// String bindings substitute as-is. Non-string bindings (numbers, bools,
/// arrays, objects) substitute as their JSON serialization — so a binding
/// `count: 5` replaces `{{count}}` with `5` in the serialized form, which
/// will deserialize back as the number 5 if the placeholder was the entire
/// JSON value. Mixed substitutions (`"prefix-{{count}}-suffix"`) produce
/// strings.
fn apply_bindings(value: &mut Value, bindings: &Map<String, Value>) -> Result<(), AppError> {
    if bindings.is_empty() {
        return Ok(());
    }

    let mut serialized = serde_json::to_string(value).map_err(|e| {
        AppError::Internal(format!("hydrate apply_bindings serialize: {e}"))
    })?;

    for (key, binding_value) in bindings.iter() {
        let placeholder = format!("{{{{{}}}}}", key); // produces literal {{key}}
        let replacement = match binding_value {
            Value::String(s) => s.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        serialized = serialized.replace(&placeholder, &replacement);
    }

    *value = serde_json::from_str(&serialized).map_err(|e| {
        AppError::Internal(format!("hydrate apply_bindings deserialize: {e}"))
    })?;

    Ok(())
}

/// Detects whether a payload is v3-shaped.
///
/// Signals (post Stage B Phase 2.3 retirement):
/// - `payload.persona` is an object — every canonical template carries one.
/// - `payload.use_cases[i]` has a `recipe_ref` — converted templates are
///   recipe_ref-shaped at every UC slot.
///
/// The earlier inline-UC field detectors (`suggested_trigger`,
/// `review_policy`, `memory_policy`) were retired in Phase 2.3 once
/// the catalog conversion (Phase 2.2) ensured no published template
/// reaches this code path with inline-only UCs. If a future template
/// author re-introduces those fields without a `persona` block or a
/// `recipe_ref`, the payload will be (correctly) treated as legacy
/// flat-shape and pass through normalize_v3_to_flat as a no-op.
pub fn is_v3_shape(payload: &Value) -> bool {
    if payload.get("persona").and_then(|v| v.as_object()).is_some() {
        return true;
    }
    if let Some(ucs) = payload.get("use_cases").and_then(|v| v.as_array()) {
        for uc in ucs {
            if uc.get("recipe_ref").is_some() {
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
    // v3.1 additions — see docs/concepts/persona-capabilities/C3-schema-v3.1-delta.md
    migrate_adoption_questions(obj);
    default_connector_required(obj);
    hoist_composition_fields(obj);
    hoist_output_assertions(obj);
    // v3.2 additions — see docs/concepts/persona-capabilities/C3-schema-v3.2-delta.md
    hoist_sample_outputs(obj);
    hoist_notify_titlebar_flags(obj);
    hoist_channel_shape_v2_in_template(obj);
}

/// v3.1 — Collect persona-level and per-UC `output_assertions[]` into the flat
/// `suggested_output_assertions[]` list that `promote_build_draft_inner`
/// persists to the `output_assertions` table at promote time. Each entry is
/// tagged with the originating `use_case_id` (null for persona-level entries).
///
/// Also injects a baseline `not_contains` assertion that flags common
/// "credentials are not configured" / "no access" prose — the symptom of a
/// silent setup failure that the CLI-exit-code success gate misses. Authors
/// can opt out persona-wide by setting
/// `persona.output_assertions_opt_out_baseline: true`, or per-UC by setting
/// `use_cases[i].skip_baseline_assertions: true` (the baseline still applies
/// persona-wide unless opted out at the persona level).
fn hoist_output_assertions(obj: &mut Map<String, Value>) {
    use serde_json::Value as V;
    let mut flat: Vec<Value> = Vec::new();
    let mut persona_opts_out = false;

    // Persona-level assertions
    if let Some(persona) = obj.get("persona").and_then(|v| v.as_object()) {
        persona_opts_out = persona
            .get("output_assertions_opt_out_baseline")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if let Some(arr) = persona.get("output_assertions").and_then(|v| v.as_array()) {
            for a in arr {
                let mut entry = a.clone();
                if let Some(o) = entry.as_object_mut() {
                    o.insert("use_case_id".to_string(), V::Null);
                }
                flat.push(entry);
            }
        }
    }

    // Per-UC assertions
    if let Some(ucs) = obj.get("use_cases").and_then(|v| v.as_array()) {
        for uc in ucs {
            let Some(uc_obj) = uc.as_object() else {
                continue;
            };
            let uc_id = uc_obj
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| V::String(s.to_string()))
                .unwrap_or(V::Null);
            if let Some(arr) = uc_obj.get("output_assertions").and_then(|v| v.as_array()) {
                for a in arr {
                    let mut entry = a.clone();
                    if let Some(o) = entry.as_object_mut() {
                        o.insert("use_case_id".to_string(), uc_id.clone());
                    }
                    flat.push(entry);
                }
            }
        }
    }

    // Baseline injection — runs unless the persona explicitly opts out. Even
    // when authors declare their own assertions, the baseline is still
    // additive so a careless author can't disable the "credentials missing"
    // safety net by accident.
    if !persona_opts_out {
        let has_baseline = flat
            .iter()
            .any(|a| a.get("name").and_then(|n| n.as_str()) == Some(BASELINE_ASSERTION_NAME));
        if !has_baseline {
            flat.push(baseline_not_contains_assertion());
        }
    }

    if !flat.is_empty() {
        obj.insert(
            "suggested_output_assertions".to_string(),
            Value::Array(flat),
        );
    }
}

const BASELINE_ASSERTION_NAME: &str = "Baseline blocker detection";

/// Phrase set that every persona runs against its final output. These are all
/// signals that the LLM produced prose instead of actually doing the work —
/// typically because a connector was misconfigured but the CLI still returned
/// 0. Fails with `severity: critical` so the post-exec downgrade path flips
/// the execution from `completed` to `incomplete`.
fn baseline_not_contains_assertion() -> Value {
    json!({
        "name": BASELINE_ASSERTION_NAME,
        "description": "Flags LLM output that admits a silent setup failure (missing credentials, unavailable tool, skipped step). When this fires, the execution is downgraded to `incomplete` so it surfaces in the notification center.",
        "type": "not_contains",
        "config": {
            "patterns": [
                "credentials are not configured",
                "cannot proceed without",
                "skipping this step because",
                "I don't have access to",
                "is not available in this environment"
            ],
            "case_sensitive": false
        },
        "severity": "critical",
        "on_failure": "log",
        "enabled": true,
        "use_case_id": null
    })
}

/// v3.1 — Migrate deprecated singular `use_case_id` on adoption questions
/// to the plural `use_case_ids: [<id>]` form. Idempotent: questions that
/// already have `use_case_ids` are left alone. Both fields are preserved
/// so the downstream UI can read either.
fn migrate_adoption_questions(obj: &mut Map<String, Value>) {
    let Some(qs) = obj
        .get_mut("adoption_questions")
        .and_then(|v| v.as_array_mut())
    else {
        return;
    };
    for q in qs.iter_mut() {
        let Some(q_obj) = q.as_object_mut() else {
            continue;
        };
        if q_obj
            .get("use_case_ids")
            .and_then(|v| v.as_array())
            .is_some()
        {
            continue;
        }
        if let Some(single) = q_obj.get("use_case_id").and_then(|v| v.as_str()) {
            let migrated = vec![Value::String(single.to_string())];
            q_obj.insert("use_case_ids".to_string(), Value::Array(migrated));
        }
    }
}

/// v3.1 — Default `persona.connectors[].required` to `true` when missing
/// so downstream UI can branch on the field unconditionally. Preserves
/// explicit `false` (optional connectors).
fn default_connector_required(obj: &mut Map<String, Value>) {
    let Some(connectors) = obj
        .get_mut("persona")
        .and_then(|v| v.get_mut("connectors"))
        .and_then(|v| v.as_array_mut())
    else {
        return;
    };
    for c in connectors.iter_mut() {
        let Some(c_obj) = c.as_object_mut() else {
            continue;
        };
        if !c_obj.contains_key("required") {
            c_obj.insert("required".to_string(), Value::Bool(true));
        }
    }
    // Also patch the flat copy if hoist_persona_connectors already wrote it.
    if let Some(flat) = obj
        .get_mut("suggested_connectors")
        .and_then(|v| v.as_array_mut())
    {
        for c in flat.iter_mut() {
            if let Some(c_obj) = c.as_object_mut() {
                if !c_obj.contains_key("required") {
                    c_obj.insert("required".to_string(), Value::Bool(true));
                }
            }
        }
    }
}

/// v3.1 — Surface `persona.trigger_composition` and
/// `persona.message_composition` at the payload top level so the
/// adoption UI and promote pipeline can read them without drilling
/// into `persona`. Defaults when missing: `per_use_case` for both.
fn hoist_composition_fields(obj: &mut Map<String, Value>) {
    let (trig, msg) = {
        let persona = obj.get("persona").and_then(|v| v.as_object());
        let trig = persona
            .and_then(|p| p.get("trigger_composition"))
            .and_then(|v| v.as_str())
            .unwrap_or("per_use_case")
            .to_string();
        let msg = persona
            .and_then(|p| p.get("message_composition"))
            .and_then(|v| v.as_str())
            .unwrap_or("per_use_case")
            .to_string();
        (trig, msg)
    };
    obj.entry("trigger_composition")
        .or_insert(Value::String(trig));
    obj.entry("message_composition")
        .or_insert(Value::String(msg));
}

// v3.2 — Normalize `use_cases[i].sample_output` in place:
//   • Defaults missing `format` to `"plain"` (D-04).
//   • Warn-and-coerces any unknown `format` string to `"plain"` and logs
//     a `tracing::warn!` with the template/use-case context (D-01 interpreted
//     as warn-and-coerce; see phase RESEARCH.md § Risk 1 / Pitfall 1).
//   • Missing `sample_output` on a UC is a no-op — field is optional (D-04).
// Idempotent: second call finds `format: "plain"` (concrete) and does nothing.
fn hoist_sample_outputs(obj: &mut Map<String, Value>) {
    const KNOWN_FORMATS: [&str; 4] = ["markdown", "plain", "json", "html"];

    let template_id_for_log = obj
        .get("template_id")
        .or_else(|| obj.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>")
        .to_string();

    let Some(use_cases) = obj.get_mut("use_cases").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for uc in use_cases.iter_mut() {
        let Some(uc_obj) = uc.as_object_mut() else {
            continue;
        };
        let uc_id = uc_obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("<unknown>")
            .to_string();
        let Some(sample) = uc_obj
            .get_mut("sample_output")
            .and_then(|v| v.as_object_mut())
        else {
            continue;
        };
        match sample.get("format").and_then(|v| v.as_str()) {
            None => {
                sample.insert("format".to_string(), Value::String("plain".to_string()));
            }
            Some(fmt) if !KNOWN_FORMATS.contains(&fmt) => {
                tracing::warn!(
                    template = %template_id_for_log,
                    use_case_id = %uc_id,
                    format = %fmt,
                    "sample_output.format unknown; coercing to \"plain\" (v3.2 D-01)"
                );
                sample.insert("format".to_string(), Value::String("plain".to_string()));
            }
            Some(_) => { /* known value — leave untouched */ }
        }
    }
}

// v3.2 — Default `event_subscriptions[j].notify_titlebar` to `false` when
// absent (D-03 — conservative opt-in; old templates get zero bell chatter).
// Applies ONLY to `direction: "emit"` entries — listen-direction subscriptions
// never trigger TitleBar notifications, so the field is meaningless there
// (see RESEARCH.md § Pitfall 3).
//
// Operates on both `use_cases[i].event_subscriptions` (template input) and
// any flattened copy at the top level — the existing `flatten_events_from_use_cases`
// copies event objects verbatim, so defaulting in the source use_cases[] is
// sufficient.  Idempotent: second call finds the key present and does nothing.
fn hoist_notify_titlebar_flags(obj: &mut Map<String, Value>) {
    fn default_in_subs_array(subs: &mut Vec<Value>) {
        for sub in subs.iter_mut() {
            let Some(sub_obj) = sub.as_object_mut() else {
                continue;
            };
            let direction = sub_obj
                .get("direction")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if direction != "emit" {
                continue;
            }
            if !sub_obj.contains_key("notify_titlebar") {
                sub_obj.insert("notify_titlebar".to_string(), Value::Bool(false));
            }
        }
    }

    // Template per-UC event subscriptions.
    if let Some(use_cases) = obj.get_mut("use_cases").and_then(|v| v.as_array_mut()) {
        for uc in use_cases.iter_mut() {
            let Some(uc_obj) = uc.as_object_mut() else {
                continue;
            };
            if let Some(subs) = uc_obj
                .get_mut("event_subscriptions")
                .and_then(|v| v.as_array_mut())
            {
                default_in_subs_array(subs);
            }
        }
    }
    // Any persona-level / flat event_subscriptions array that upstream passes
    // bypassing the per-UC path.
    if let Some(flat_subs) = obj
        .get_mut("event_subscriptions")
        .and_then(|v| v.as_array_mut())
    {
        default_in_subs_array(flat_subs);
    }
}

// v3.2 — Template-side placeholder for shape-v2 channel defaults.
// Shape v2 lives on the persona row (assembled at adoption time in Phase 20).
// When a template declares `persona.notification_channels_default` with
// shape-v2 entries, the existing `flatten_notification_channels` already copies
// objects verbatim (keys like `use_case_ids`, `event_filter` survive). This
// function is a documented no-op hook for future template-side validation —
// e.g. rejecting `use_case_ids: []` at template-compile time. We leave the
// guard to the persona-row validator for now (see RESEARCH.md § Risk 7).
#[allow(clippy::ptr_arg)]
fn hoist_channel_shape_v2_in_template(_obj: &mut Map<String, Value>) {
    // Intentionally empty. Present for call-chain completeness + marker comment.
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
                let mode = review
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("never");
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
                if memory
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
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
        let Some(flow) = uc_obj
            .get("use_case_flow")
            .and_then(|v| v.as_object())
            .cloned()
        else {
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
    fn inline_uc_markers_no_longer_signal_v3_after_retirement() {
        // Stage B Phase 2.3 — the inline-UC field detectors (suggested_trigger,
        // review_policy, memory_policy) were dropped from is_v3_shape now that
        // every published template is recipe_ref-shaped (Phase 2.2). A payload
        // with ONLY those fields (no persona block, no recipe_ref) is no longer
        // recognized as v3, and falls through normalize_v3_to_flat as a no-op.
        let payload = json!({
            "use_cases": [{ "id": "uc_x", "suggested_trigger": { "trigger_type": "manual" } }]
        });
        assert!(
            !is_v3_shape(&payload),
            "post-2.3, inline UC v3 markers without persona/recipe_ref shouldn't register as v3"
        );
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
        assert!(
            !types.contains(&"manual_review"),
            "review mode=never should not emit manual_review"
        );
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

    // ------------------------------------------------------------------
    // v3.1 — adoption question migration, required connectors, composition
    // ------------------------------------------------------------------

    #[test]
    fn migrates_singular_use_case_id_on_questions() {
        let mut payload = json!({
            "persona": { "identity": { "role": "X" } },
            "use_cases": [{ "id": "uc_a", "title": "A" }],
            "adoption_questions": [
                { "id": "aq1", "scope": "capability", "use_case_id": "uc_a", "question": "Q1" },
                { "id": "aq2", "scope": "persona", "question": "Q2" },
                { "id": "aq3", "scope": "capability", "use_case_ids": ["uc_a", "uc_b"], "question": "Q3" }
            ]
        });
        normalize_v3_to_flat(&mut payload);
        let qs = payload
            .get("adoption_questions")
            .and_then(|v| v.as_array())
            .unwrap();

        // aq1: singular → plural of length 1
        let aq1_ids = qs[0]
            .get("use_case_ids")
            .and_then(|v| v.as_array())
            .unwrap();
        assert_eq!(aq1_ids.len(), 1);
        assert_eq!(aq1_ids[0].as_str(), Some("uc_a"));

        // aq2: persona scope, no migration
        assert!(qs[1].get("use_case_ids").is_none());

        // aq3: already plural, untouched
        let aq3_ids = qs[2]
            .get("use_case_ids")
            .and_then(|v| v.as_array())
            .unwrap();
        assert_eq!(aq3_ids.len(), 2);
    }

    #[test]
    fn defaults_connector_required_to_true() {
        let mut payload = json!({
            "persona": {
                "identity": { "role": "X" },
                "connectors": [
                    { "name": "jira", "label": "Jira" },                          // missing → default true
                    { "name": "notion", "label": "Notion", "required": true },    // explicit true stays
                    { "name": "alpha_vantage", "label": "AV", "required": false } // explicit false stays
                ]
            },
            "use_cases": [{ "id": "uc_a", "title": "A", "connectors": ["jira", "notion"] }]
        });
        normalize_v3_to_flat(&mut payload);

        let conns = payload
            .get("persona")
            .and_then(|v| v.get("connectors"))
            .and_then(|v| v.as_array())
            .unwrap();
        assert_eq!(
            conns[0].get("required").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            conns[1].get("required").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            conns[2].get("required").and_then(|v| v.as_bool()),
            Some(false)
        );

        // Flat copy carries the same values.
        let flat = payload
            .get("suggested_connectors")
            .and_then(|v| v.as_array())
            .unwrap();
        let by_name: std::collections::HashMap<&str, bool> = flat
            .iter()
            .map(|c| {
                (
                    c.get("name").and_then(|v| v.as_str()).unwrap(),
                    c.get("required").and_then(|v| v.as_bool()).unwrap(),
                )
            })
            .collect();
        assert_eq!(by_name.get("jira"), Some(&true));
        assert_eq!(by_name.get("notion"), Some(&true));
        assert_eq!(by_name.get("alpha_vantage"), Some(&false));
    }

    #[test]
    fn hoists_composition_defaults() {
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        assert_eq!(
            payload.get("trigger_composition").and_then(|v| v.as_str()),
            Some("per_use_case")
        );
        assert_eq!(
            payload.get("message_composition").and_then(|v| v.as_str()),
            Some("per_use_case")
        );
    }

    #[test]
    fn hoists_composition_explicit_shared() {
        let mut payload = json!({
            "persona": {
                "identity": { "role": "X" },
                "trigger_composition": "shared",
                "message_composition": "combined"
            },
            "use_cases": [{ "id": "uc_a", "title": "A" }]
        });
        normalize_v3_to_flat(&mut payload);
        assert_eq!(
            payload.get("trigger_composition").and_then(|v| v.as_str()),
            Some("shared")
        );
        assert_eq!(
            payload.get("message_composition").and_then(|v| v.as_str()),
            Some("combined")
        );
    }

    // ------------------------------------------------------------------
    // v3.2 — sample_output + notify_titlebar + shape-v2 channel defaults
    // ------------------------------------------------------------------

    fn v32_fixture() -> Value {
        let mut base = v3_fixture();
        // Inject v3.2 fields onto the first use case.
        if let Some(ucs) = base.get_mut("use_cases").and_then(|v| v.as_array_mut()) {
            if let Some(uc0) = ucs.get_mut(0).and_then(|v| v.as_object_mut()) {
                uc0.insert(
                    "sample_output".to_string(),
                    json!({ "title": "Daily digest", "body": "3 urgent, 12 normal.", "format": "markdown" }),
                );
                uc0.insert(
                    "event_subscriptions".to_string(),
                    json!([
                        { "direction": "emit",   "event": "email.digest.ready", "notify_titlebar": true  },
                        { "direction": "emit",   "event": "email.digest.error"                            },
                        { "direction": "listen", "event": "calendar.day.start"                            }
                    ]),
                );
            }
        }
        base
    }

    #[test]
    fn test_hoist_sample_outputs_passes_through() {
        let mut payload = v32_fixture();
        normalize_v3_to_flat(&mut payload);
        let uc0 = &payload["use_cases"][0];
        assert_eq!(uc0["sample_output"]["title"], "Daily digest");
        assert_eq!(uc0["sample_output"]["body"], "3 urgent, 12 normal.");
        assert_eq!(uc0["sample_output"]["format"], "markdown");
    }

    #[test]
    fn test_hoist_sample_outputs_defaults_format_to_plain() {
        let mut payload = v32_fixture();
        // Remove format to test default.
        payload["use_cases"][0]["sample_output"]
            .as_object_mut()
            .unwrap()
            .remove("format");
        normalize_v3_to_flat(&mut payload);
        assert_eq!(payload["use_cases"][0]["sample_output"]["format"], "plain");
    }

    #[test]
    fn test_hoist_sample_outputs_warn_and_coerce_unknown_format() {
        let mut payload = v32_fixture();
        payload["use_cases"][0]["sample_output"]["format"] = json!("xml");
        normalize_v3_to_flat(&mut payload);
        // Coerced to "plain" — warn side-effect not asserted here (log layer).
        assert_eq!(payload["use_cases"][0]["sample_output"]["format"], "plain");
    }

    #[test]
    fn test_hoist_sample_outputs_missing_field_is_noop() {
        let mut payload = v3_fixture(); // no sample_output anywhere
        let before = serde_json::to_string(&payload).unwrap();
        normalize_v3_to_flat(&mut payload);
        // v3_fixture normalization is unaffected by v3.2 additions — verifies
        // regression safety via content equality on use_cases[0].sample_output absence.
        assert!(payload["use_cases"][0].get("sample_output").is_none());
        let _ = before; // retained for debugging
    }

    #[test]
    fn test_hoist_notify_titlebar_defaults_false_on_emit() {
        let mut payload = v32_fixture();
        normalize_v3_to_flat(&mut payload);
        let subs = payload["use_cases"][0]["event_subscriptions"]
            .as_array()
            .unwrap();
        // Entry 0: explicit true — preserved.
        assert_eq!(subs[0]["notify_titlebar"], true);
        // Entry 1: emit, no explicit — defaulted to false.
        assert_eq!(subs[1]["notify_titlebar"], false);
        // Entry 2: listen — no notify_titlebar injected.
        assert!(subs[2].get("notify_titlebar").is_none());
    }

    #[test]
    fn test_hoist_notify_titlebar_preserves_explicit_values() {
        let mut payload = v32_fixture();
        payload["use_cases"][0]["event_subscriptions"][1]["notify_titlebar"] = json!(true);
        normalize_v3_to_flat(&mut payload);
        let subs = payload["use_cases"][0]["event_subscriptions"]
            .as_array()
            .unwrap();
        assert_eq!(subs[0]["notify_titlebar"], true);
        assert_eq!(subs[1]["notify_titlebar"], true);
    }

    #[test]
    fn test_hoist_notify_titlebar_skips_listen_direction() {
        // Separate fixture: single listen-only UC.
        let mut payload = json!({
            "use_cases": [{
                "id": "uc_a",
                "event_subscriptions": [{ "direction": "listen", "event": "ext.x" }]
            }]
        });
        normalize_v3_to_flat(&mut payload);
        assert!(payload["use_cases"][0]["event_subscriptions"][0]
            .get("notify_titlebar")
            .is_none());
    }

    #[test]
    fn test_v32_idempotent() {
        let mut payload = v32_fixture();
        normalize_v3_to_flat(&mut payload);
        let first = payload.clone();
        normalize_v3_to_flat(&mut payload);
        assert_eq!(first, payload, "v3.2 normalization must be idempotent");
    }

    #[test]
    fn test_v3_1_regression_after_v32_additions() {
        // v3_fixture carries no v3.2 fields — after normalize, the composition
        // hoist (v3.1) still runs and the v3.2 code paths leave zero footprint
        // on fields they don't own.
        let mut payload = v3_fixture();
        normalize_v3_to_flat(&mut payload);
        // v3.1 invariants — existing tests already cover these; this is a smoke check.
        assert_eq!(payload["trigger_composition"], "per_use_case");
        assert_eq!(payload["message_composition"], "per_use_case");
        // v3.2 fields absent.
        assert!(payload["use_cases"][0].get("sample_output").is_none());
    }

    #[test]
    fn test_sample_output_serde_roundtrip() {
        let json = r#"{"title":"T","body":"B","format":"markdown"}"#;
        let parsed: crate::db::models::SampleOutput =
            serde_json::from_str(json).expect("valid markdown format parses");
        let out = serde_json::to_string(&parsed).unwrap();
        assert!(out.contains("\"format\":\"markdown\""));
    }

    #[test]
    fn test_sample_output_format_unknown_value_deserialize_error() {
        let json = r#"{"format":"xml"}"#;
        let parsed: Result<crate::db::models::SampleOutput, _> = serde_json::from_str(json);
        assert!(
            parsed.is_err(),
            "unknown format must fail at serde layer (D-01)"
        );
    }

    // ========================================================================
    // Stage B Phase 2: hydrate_recipe_refs tests
    // ========================================================================

    /// Build a minimal RecipeDefinition fixture with the given prompt_template
    /// (which Phase 1b sets to the serialized UC JSON).
    fn recipe_fixture(id: &str, prompt_template: &str) -> RecipeDefinition {
        RecipeDefinition {
            id: id.to_string(),
            project_id: "default".to_string(),
            credential_id: None,
            use_case_id: None,
            name: "test recipe".to_string(),
            description: None,
            category: None,
            prompt_template: prompt_template.to_string(),
            input_schema: None,
            output_contract: None,
            tool_requirements: None,
            credential_requirements: None,
            model_preference: None,
            sample_inputs: None,
            tags: None,
            icon: None,
            color: None,
            is_builtin: true,
            created_at: "2026-05-09T00:00:00Z".to_string(),
            updated_at: "2026-05-09T00:00:00Z".to_string(),
            source_template_id: Some("test-template".to_string()),
            source_use_case_id: Some("uc_x".to_string()),
            source_use_case_name: Some("Test UC".to_string()),
            source_version: Some("1.0.0".to_string()),
        }
    }

    #[test]
    fn hydrate_no_recipe_refs_is_noop() {
        // A v3 payload with only inline UCs (no recipe_refs) still passes
        // through unchanged. The Phase 2.3 strict check fires only on
        // *mixed* payloads — pure-inline isn't a regression on its own,
        // it just won't be hydrated.
        let mut payload = json!({
            "use_cases": [{
                "id": "uc_inline",
                "name": "Inline UC",
                "suggested_trigger": { "trigger_type": "manual" }
            }]
        });
        let before = payload.clone();
        let lookup = |_id: &str| -> Result<RecipeDefinition, AppError> {
            panic!("lookup must not be called for inline-only payloads")
        };
        hydrate_recipe_refs(&mut payload, lookup).expect("hydrate ok");
        assert_eq!(payload, before, "inline-only payload must be untouched");
    }

    #[test]
    fn hydrate_rejects_mixed_inline_and_recipe_ref_payload() {
        // Stage B Phase 2.3 strict mode: a payload that mixes recipe_ref
        // UCs with inline UCs is a malformed-template bug. We hard-error
        // here rather than half-hydrating and producing a confusing
        // agent_ir downstream.
        let mut payload = json!({
            "use_cases": [
                { "recipe_ref": { "id": "recipe-a", "version": "1.0.0", "bindings": {} } },
                { "id": "uc_inline_intruder", "suggested_trigger": { "trigger_type": "manual" } },
            ]
        });
        let lookup = |_id: &str| -> Result<RecipeDefinition, AppError> {
            panic!("lookup must not be reached when the strict check fires first")
        };
        let result = hydrate_recipe_refs(&mut payload, lookup);
        assert!(result.is_err(), "mixed-shape payload must be rejected");
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("uc_inline_intruder"),
            "error must name the offending inline UC for debugging; got: {err}"
        );
        assert!(
            err.contains("Phase 2.3"),
            "error must reference the retirement phase so future readers find context; got: {err}"
        );
    }

    #[test]
    fn hydrate_replaces_recipe_ref_with_inline_uc() {
        let stored_uc = json!({
            "id": "uc_x",
            "name": "Hydrated UC",
            "suggested_trigger": { "trigger_type": "schedule" },
            "tools": ["http_request"]
        });
        let stored_uc_json = serde_json::to_string(&stored_uc).unwrap();

        let mut payload = json!({
            "use_cases": [{
                "recipe_ref": {
                    "id": "recipe-123",
                    "version": "1.0.0",
                    "bindings": {}
                }
            }]
        });

        let lookup = |id: &str| -> Result<RecipeDefinition, AppError> {
            assert_eq!(id, "recipe-123", "lookup called with wrong recipe id");
            Ok(recipe_fixture("recipe-123", &stored_uc_json))
        };

        hydrate_recipe_refs(&mut payload, lookup).expect("hydrate ok");

        let ucs = payload
            .get("use_cases")
            .and_then(|v| v.as_array())
            .unwrap();
        assert_eq!(ucs.len(), 1);
        // The recipe_ref UC was replaced with the stored inline shape.
        assert_eq!(ucs[0].get("id").and_then(|v| v.as_str()), Some("uc_x"));
        assert_eq!(
            ucs[0].get("name").and_then(|v| v.as_str()),
            Some("Hydrated UC")
        );
        assert!(ucs[0].get("recipe_ref").is_none(), "recipe_ref should be gone post-hydration");
    }

    // Test removed in Stage B Phase 2.3: the mixed inline-+-recipe_ref shape
    // it asserted is now explicitly rejected — see
    // `hydrate_rejects_mixed_inline_and_recipe_ref_payload` for the inverted
    // assertion.

    #[test]
    fn hydrate_returns_error_when_recipe_not_found() {
        let mut payload = json!({
            "use_cases": [{
                "recipe_ref": { "id": "missing-recipe" }
            }]
        });
        let lookup = |_id: &str| -> Result<RecipeDefinition, AppError> {
            Err(AppError::NotFound("recipe missing-recipe".into()))
        };
        let result = hydrate_recipe_refs(&mut payload, lookup);
        assert!(result.is_err(), "missing recipe should surface as error");
    }

    #[test]
    fn hydrate_errors_when_prompt_template_is_not_valid_json() {
        let mut payload = json!({
            "use_cases": [{
                "recipe_ref": { "id": "broken-recipe" }
            }]
        });
        let lookup = |_id: &str| -> Result<RecipeDefinition, AppError> {
            Ok(recipe_fixture("broken-recipe", "not valid json {{{"))
        };
        let result = hydrate_recipe_refs(&mut payload, lookup);
        assert!(result.is_err(), "malformed prompt_template should error");
        let msg = format!("{}", result.unwrap_err());
        assert!(
            msg.contains("malformed prompt_template"),
            "error should mention malformed prompt_template: {msg}"
        );
    }

    #[test]
    fn hydrate_recipe_ref_missing_id_errors() {
        let mut payload = json!({
            "use_cases": [{
                "recipe_ref": { "version": "1.0.0" } // missing `id`
            }]
        });
        let lookup = |_id: &str| -> Result<RecipeDefinition, AppError> {
            panic!("should not call lookup when recipe_ref id is missing")
        };
        let result = hydrate_recipe_refs(&mut payload, lookup);
        assert!(result.is_err());
    }

    #[test]
    fn hydrate_with_string_bindings_substitutes_placeholders() {
        let stored_uc = json!({
            "id": "uc_x",
            "description": "Send to {{platform}} every {{frequency}}"
        });
        let stored_uc_json = serde_json::to_string(&stored_uc).unwrap();

        let mut payload = json!({
            "use_cases": [{
                "recipe_ref": {
                    "id": "recipe-Y",
                    "bindings": {
                        "platform": "Slack",
                        "frequency": "morning"
                    }
                }
            }]
        });

        let lookup = |_id: &str| Ok(recipe_fixture("recipe-Y", &stored_uc_json));
        hydrate_recipe_refs(&mut payload, lookup).expect("hydrate ok");

        let desc = payload
            .pointer("/use_cases/0/description")
            .and_then(|v| v.as_str())
            .expect("description present");
        assert_eq!(desc, "Send to Slack every morning");
    }

    #[test]
    fn hydrate_with_empty_bindings_is_passthrough() {
        // Empty bindings (the Phase 1b default) should not trigger the
        // serialize-replace-deserialize cycle. We can't assert that directly,
        // but we can confirm correctness on a complex structure.
        let stored_uc = json!({
            "id": "uc_x",
            "tools": ["http_request"],
            "tags": [{"k": "v"}],
            "config": { "deeply": { "nested": "value" } }
        });
        let stored_uc_json = serde_json::to_string(&stored_uc).unwrap();

        let mut payload = json!({
            "use_cases": [{
                "recipe_ref": {
                    "id": "recipe-empty",
                    "bindings": {}
                }
            }]
        });

        let lookup = |_id: &str| Ok(recipe_fixture("recipe-empty", &stored_uc_json));
        hydrate_recipe_refs(&mut payload, lookup).expect("hydrate ok");

        let hydrated_uc = payload
            .pointer("/use_cases/0")
            .expect("first UC present")
            .clone();
        assert_eq!(hydrated_uc, stored_uc, "empty bindings = exact passthrough");
    }

    #[test]
    fn is_v3_shape_detects_recipe_ref() {
        let payload = json!({
            "use_cases": [{ "recipe_ref": { "id": "x" } }]
        });
        assert!(
            is_v3_shape(&payload),
            "payload with recipe_ref UC must register as v3-shaped"
        );
    }

    // ========================================================================
    // Stage B Phase 1b ↔ 2.1 round-trip parity tests
    //
    // Prove the load-bearing contract for the Phase 2 migration: a template
    // with INLINE UCs and the same template with `recipe_ref` UCs (whose
    // recipes hold the original UC JSON in prompt_template, per Phase 1b)
    // must produce IDENTICAL output through normalize_v3_to_flat. If these
    // tests fail, the migration is unsafe — adopting a converted template
    // would produce a different persona than adopting the original.
    // ========================================================================

    /// Convert a v3 fixture's inline UCs into recipe_ref shape, building an
    /// in-memory recipe map from the originals. Mirrors what the actual
    /// migration would do (Phase 1b creates recipe rows with prompt_template
    /// = serialized UC; Phase 2.2 rewrites template UCs as recipe_refs).
    fn convert_to_recipe_refs(
        payload: &Value,
    ) -> (Value, std::collections::HashMap<String, RecipeDefinition>) {
        let mut recipe_map = std::collections::HashMap::new();
        let mut converted = payload.clone();
        let inline_ucs: Vec<Value> = payload
            .get("use_cases")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let new_ucs: Vec<Value> = inline_ucs
            .iter()
            .map(|uc| {
                let uc_id = uc.get("id").and_then(|v| v.as_str()).unwrap();
                let recipe_id = format!("test-recipe-{uc_id}");
                let serialized_uc = serde_json::to_string(uc).unwrap();
                recipe_map.insert(
                    recipe_id.clone(),
                    recipe_fixture(&recipe_id, &serialized_uc),
                );
                json!({
                    "recipe_ref": {
                        "id": recipe_id,
                        "version": "1.0.0",
                        "bindings": {}
                    }
                })
            })
            .collect();
        converted
            .as_object_mut()
            .unwrap()
            .insert("use_cases".into(), Value::Array(new_ucs));
        (converted, recipe_map)
    }

    #[test]
    fn round_trip_hydrate_yields_byte_equivalent_use_cases() {
        // Strict pre-normalization parity: hydrated UCs must equal the
        // original inline UCs byte-for-byte. This catches subtle issues
        // (key reordering, type coercion) that would only surface during
        // normalization tests as obscure failures.
        let original = v3_fixture();
        let original_ucs = original["use_cases"].clone();

        let (mut converted, recipe_map) = convert_to_recipe_refs(&original);
        let lookup = |id: &str| -> Result<RecipeDefinition, AppError> {
            recipe_map
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("recipe {id}")))
        };
        hydrate_recipe_refs(&mut converted, lookup).expect("hydrate ok");

        assert_eq!(
            converted["use_cases"], original_ucs,
            "post-hydrate use_cases must equal pre-conversion inline use_cases"
        );
    }

    #[test]
    fn round_trip_normalize_parity_inline_vs_recipe_ref() {
        // The load-bearing contract for the Phase 2 migration: a converted
        // template + hydrate must produce the SAME flat agent_ir as the
        // original inline template. If this fails, Phase 2.2 cannot ship.
        let original = v3_fixture();

        // Path 1 — original inline template through normalize.
        let mut path_inline = original.clone();
        normalize_v3_to_flat(&mut path_inline);

        // Path 2 — converted template, hydrated, then normalized.
        let (mut path_recipe_ref, recipe_map) = convert_to_recipe_refs(&original);
        let lookup = |id: &str| -> Result<RecipeDefinition, AppError> {
            recipe_map
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("recipe {id}")))
        };
        hydrate_recipe_refs(&mut path_recipe_ref, lookup).expect("hydrate ok");
        normalize_v3_to_flat(&mut path_recipe_ref);

        // Both paths must produce identical flat output.
        assert_eq!(
            path_inline, path_recipe_ref,
            "normalize-after-hydrate must equal normalize-of-inline"
        );
    }

    #[test]
    fn round_trip_preserves_flat_triggers() {
        // Spot-check a load-bearing flatten output: triggers carry use_case_id
        // through the recipe_ref → hydrate → flatten pipeline.
        let original = v3_fixture();
        let (mut converted, recipe_map) = convert_to_recipe_refs(&original);
        let lookup = |id: &str| -> Result<RecipeDefinition, AppError> {
            recipe_map
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("recipe {id}")))
        };
        hydrate_recipe_refs(&mut converted, lookup).unwrap();
        normalize_v3_to_flat(&mut converted);

        let triggers = converted
            .get("suggested_triggers")
            .and_then(|v| v.as_array())
            .expect("suggested_triggers produced");
        assert_eq!(triggers.len(), 1);
        assert_eq!(
            triggers[0].get("use_case_id").and_then(|v| v.as_str()),
            Some("uc_morning_digest"),
            "use_case_id must survive through recipe_ref round-trip"
        );
    }

    #[test]
    fn round_trip_preserves_flat_events() {
        // Same load-bearing check for event subscriptions.
        let original = v3_fixture();
        let (mut converted, recipe_map) = convert_to_recipe_refs(&original);
        let lookup = |id: &str| -> Result<RecipeDefinition, AppError> {
            recipe_map
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("recipe {id}")))
        };
        hydrate_recipe_refs(&mut converted, lookup).unwrap();
        normalize_v3_to_flat(&mut converted);

        let events = converted
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
}
