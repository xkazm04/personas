use serde::Serialize;
use serde_json::json;
use tauri::State;
use tokio_util::sync::CancellationToken;

use std::collections::HashSet;
use std::sync::Arc;

use crate::background_job::BackgroundJobManager;
use crate::db::repos::communication::reviews as reviews_repo;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use super::n8n_transform::{extract_first_json_object, run_claude_prompt_text_inner};

// -- Template integrity: where it actually happens ---------------
//
// There used to be a `check_template_integrity` here, called at the top of
// `instant_adopt_template_inner` and documented as the authoritative security
// gate for adoption. It was inert, and it was inert for a structural reason
// that could not be fixed at this call site:
//
//   - `CHECKSUM_MANIFEST` (engine::template_checksums) is keyed by the
//     template's relative FILE PATH (`development/dev-clone.json`) and hashes
//     the ENTIRE template file. Every real caller passes a bare label or id
//     ("Dev Clone") plus the payload-only `design_result` JSON. So
//     `is_known_template` was false for 100% of adoptions — and normalising
//     just the KEY would not have helped, because the hashed CONTENT is a
//     different document from the one the manifest was generated over.
//   - Consequently the "known but tampered → reject" branch was unreachable,
//     and the release build only `tracing::warn!`ed and allowed. (An earlier
//     revision hard-rejected on "unknown", which bricked Presets + Dev Clone
//     on shipped binaries while passing in dev, where that branch is compiled
//     out.)
//
// A control that looks like security and is inert is worse than none, because
// the docs told the reader it was protecting them. It has been removed rather
// than left as decoration.
//
// Integrity for built-in templates is enforced at CATALOG LOAD, one layer up:
// `src/lib/personas/templates/templateCatalog.ts` hashes each template's
// canonical JSON and SKIPS any entry whose hash is missing from or disagrees
// with `TEMPLATE_CHECKSUMS`. A tampered template therefore never enters the
// catalog, never gets seeded into `persona_design_reviews`, and so can never
// reach adoption at all. `verify_template_integrity_batch` (below) is the
// compiled-in second opinion on the same (path, whole-file) pairs — it works
// because it is given the shape the manifest was generated from, but its
// caller only reports; it is a detector, not a gate.
//
// Reconciling a payload-keyed manifest so a per-adoption re-check could be
// meaningful is a codegen change (`scripts/generate-template-checksums.mjs`
// plus both generated manifests) and is NOT a drop-in: the whole-file hashes
// are exactly what makes the catalog-load gate work. See
// `docs/features/templates/06-integrity-and-security.md`.

// -- Adopt job extra state ---------------------------------------

#[derive(Clone, Default)]
struct AdoptExtra {
    draft: Option<serde_json::Value>,
    questions: Option<serde_json::Value>,
}

/// Adopt-specific extras flattened into BackgroundTaskSnapshot.
#[derive(Clone, Serialize)]
struct AdoptSnapshotExtras {
    adopt_id: String,
    draft: Option<serde_json::Value>,
    questions: Option<serde_json::Value>,
}

static ADOPT_JOBS: BackgroundJobManager<AdoptExtra> = BackgroundJobManager::new(
    "template adopt job lock poisoned",
    event_name::TEMPLATE_ADOPT_STATUS,
    event_name::TEMPLATE_ADOPT_OUTPUT,
);

/// 10-minute TTL for completed adopt jobs, max 50 entries.
const ADOPT_JOB_TTL: std::time::Duration = std::time::Duration::from_secs(10 * 60);
const ADOPT_MAX_ENTRIES: usize = 50;

/// Sweep completed adopt jobs past 10-minute TTL and enforce 50-entry cap.
fn sweep_adopt_jobs() {
    if let Ok(mut jobs) = ADOPT_JOBS.lock() {
        ADOPT_JOBS.evict_completed_with_cap(&mut jobs, ADOPT_JOB_TTL, ADOPT_MAX_ENTRIES);
    }
}

fn get_adopt_snapshot_internal(
    adopt_id: &str,
) -> Option<crate::background_job::BackgroundTaskSnapshot<AdoptSnapshotExtras>> {
    sweep_adopt_jobs();
    ADOPT_JOBS.get_task_snapshot(adopt_id, |extra| AdoptSnapshotExtras {
        adopt_id: adopt_id.to_string(),
        draft: extra.draft.clone(),
        questions: extra.questions.clone(),
    })
}

/// List all template adopt job snapshots (for unified workflows view).
pub fn list_adopt_jobs() -> Vec<crate::background_job::JobSnapshot> {
    sweep_adopt_jobs();
    ADOPT_JOBS.list_snapshots()
}

/// List all template generate job snapshots (for unified workflows view).
pub fn list_generate_jobs() -> Vec<crate::background_job::JobSnapshot> {
    GEN_JOBS.list_snapshots()
}

/// Cancel an adopt job (non-command wrapper for workflows).
pub fn cancel_adopt_job(
    app: &tauri::AppHandle,
    adopt_id: &str,
) -> Result<(), crate::error::AppError> {
    ADOPT_JOBS.cancel(app, adopt_id)
}

/// Cancel a generate job (non-command wrapper for workflows).
pub fn cancel_generate_job(
    app: &tauri::AppHandle,
    gen_id: &str,
) -> Result<(), crate::error::AppError> {
    GEN_JOBS.cancel(app, gen_id)
}

// -- Payload validation ------------------------------------------

/// Maximum size for any single JSON payload field (512 KB).
const MAX_JSON_PAYLOAD_BYTES: usize = 512 * 1024;

/// Validate that a JSON string field is well-formed and within the size limit.
///
/// `pub(super)` so sibling commands in `commands::design` (notably
/// `build_sessions::save_adoption_answers`) can enforce the same trust-boundary
/// validation rather than duplicating the size cap + parse.
pub(super) fn validate_json_field(name: &str, value: &str) -> Result<(), AppError> {
    if value.len() > MAX_JSON_PAYLOAD_BYTES {
        return Err(AppError::Validation(format!(
            "{name} exceeds maximum size ({} bytes, limit {MAX_JSON_PAYLOAD_BYTES})",
            value.len()
        )));
    }
    // Validate it's well-formed JSON
    if let Err(e) = serde_json::from_str::<serde_json::Value>(value) {
        return Err(AppError::Validation(format!(
            "{name} contains invalid JSON: {e}"
        )));
    }
    Ok(())
}

// -- Commands ----------------------------------------------------

#[tauri::command]
pub fn get_template_adopt_snapshot(
    state: State<'_, Arc<AppState>>,
    adopt_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let snapshot = get_adopt_snapshot_internal(&adopt_id)
        .ok_or_else(|| AppError::NotFound("Template adoption not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| json!({})))
}

// -- Instant Adopt (no AI transform -- creates persona directly from design) --

#[tauri::command]
pub fn instant_adopt_template(
    state: State<'_, Arc<AppState>>,
    template_name: String,
    design_result_json: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    instant_adopt_template_inner(&state, template_name, design_result_json, None)
}

/// Inner function callable from both Tauri command and test automation.
/// Uses create_persona_atomically to create persona + tools + triggers in one transaction.
///
/// `parameter_overrides` is an optional map of `question_id -> answer`
/// used by the preset adopter's combined-questionnaire path: the
/// answers are forwarded verbatim to
/// `populate_persona_parameters_from_design`, which prefers them over
/// the template's `default` values when populating
/// `persona.parameters[]`. Existing callers (the single-template
/// "Adopt with defaults" path, the test bridge) pass `None` and the
/// behavior is unchanged.
///
/// Why a separate channel instead of mutating the design JSON before
/// calling this? The design payload is what the catalog-load integrity
/// gate verified before it was seeded, so rewriting those bytes on the
/// way in would put the persona out of step with the verified template.
/// Threading overrides through the existing
/// `populate_persona_parameters_from_design(... answers)` arg lands
/// the user's customization without touching them.
pub fn instant_adopt_template_inner(
    state: &Arc<AppState>,
    template_name: String,
    design_result_json: String,
    parameter_overrides: Option<&std::collections::HashMap<String, serde_json::Value>>,
) -> Result<serde_json::Value, AppError> {
    use super::n8n_transform::types::{
        N8nConnectorRef, N8nPersonaOutput, N8nToolDraft, N8nTriggerDraft,
    };

    tracing::info!(template_id = %template_name, "instant_adopt_template: start");
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }
    validate_json_field("design_result_json", &design_result_json)?;

    // NO per-adoption checksum re-check here — see the module note above.
    // Built-in template integrity is enforced at catalog load
    // (`templateCatalog.ts`), which drops a tampered template before it can
    // ever be seeded and therefore before it can ever be adopted. The check
    // that used to sit on this line could not fire and has been removed.

    let mut design: serde_json::Value = serde_json::from_str(&design_result_json)
        .map_err(|e| AppError::Validation(format!("Invalid design result JSON: {e}")))?;

    // v3 templates ship a rich `persona` block + `use_cases[]` where each UC
    // is a `recipe_ref` stub. We need two passes to land usable content on
    // the persona row:
    //  1. `hydrate_recipe_refs` — replaces each recipe_ref with the inline
    //     UC content pulled from the recipe catalog (resolved via DB).
    //     Without this the resulting `design_context.useCases` is just a
    //     list of recipe_ref pointers, which the Use Cases tab renders as
    //     empty entries.
    //  2. `normalize_v3_to_flat` — composes structured_prompt from the
    //     persona block, hoists per-UC tools/triggers/connectors to the
    //     flat `suggested_*` fields, populates use_case_flows. Without
    //     this every adopted persona ends up with the default "You are a
    //     helpful AI assistant." prompt and an empty design_context —
    //     visible as a Glyph-from-scratch empty state on click.
    //
    // The Glyph promote path calls both in this order (see
    // `commands::design::build_sessions:228`); instant-adopt was missing
    // both gates until 2026-05-12.
    let pool_for_lookup = state.db.clone();
    let lookup = |id: &str| -> Result<crate::db::models::RecipeDefinition, AppError> {
        crate::db::repos::resources::recipes::get_by_id(&pool_for_lookup, id)
    };
    // Hydration is FATAL, not best-effort. `hydrate_recipe_refs` mutates
    // `use_cases` IN PLACE per entry, so a mid-list failure (a referenced
    // recipe is missing, or its `prompt_template` isn't valid serialized-UC
    // JSON) leaves earlier UCs hydrated and later ones as bare
    // `{recipe_ref: …}` stubs. `normalize_v3_to_flat` then maps those stubs
    // to EMPTY use cases (no trigger/connectors/events) and we'd return Ok for
    // a structurally broken persona — a green "adopted" modal over a persona
    // with missing capabilities and the default prompt. Propagate the error
    // (which carries the offending recipe id) so the adoption row goes
    // `failed` instead of silently adopting a half-hydrated payload.
    crate::engine::template_v3::hydrate_recipe_refs(&mut design, lookup).map_err(|e| {
        AppError::Validation(format!(
            "Template '{template_name}' adoption failed during recipe hydration: {e}. \
             No persona was created to avoid a partially-configured result."
        ))
    })?;
    // Defense in depth: even if hydration returned Ok, assert no `recipe_ref`
    // stubs survive in `use_cases` before normalization. A surviving stub
    // would normalize to an empty Use Case and be silently adopted — fail the
    // adoption instead so a partial hydrate can never be reported as success.
    if let Some(stub_id) = first_unhydrated_recipe_ref(&design) {
        return Err(AppError::Validation(format!(
            "Template '{template_name}' adoption failed: a use case still references \
             un-hydrated recipe '{stub_id}' after hydration — refusing to adopt a \
             partially-configured persona."
        )));
    }
    if crate::engine::template_v3::is_v3_shape(&design) {
        crate::engine::template_v3::normalize_v3_to_flat(&mut design);
    }

    // After normalization the structured prompt is the canonical content;
    // the system_prompt field becomes a fallback for the runner when
    // structured_prompt is missing. We synthesize a readable markdown
    // version from the persona's identity/voice/principles blocks so the
    // editor's plain-text view isn't blank either.
    let full_prompt = design
        .get("full_prompt_markdown")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| synthesize_system_prompt_markdown(&design))
        .unwrap_or_else(|| "You are a helpful AI assistant.".to_string());

    // V3 templates carry the human-readable summary at `payload.persona.goal`
    // (the one-line "what this persona does"). The legacy top-level `summary`
    // field is preserved for older payloads. Fall back to a generic label
    // only when neither exists, so the persona's description column tells the
    // user what the persona DOES instead of where it came from.
    let summary = design
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            design
                .get("persona")
                .and_then(|p| p.get("goal"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| Some(format!("Adopted from template: {template_name}")));

    // Recipe parameterization (Gap 1): derive tunable params from the hydrated
    // use_cases' input_schema (input_schema survives normalize_v3_to_flat), then
    // inject the `## Capability Parameters` section into structured_prompt.instructions
    // so `{{param.*}}` resolves at runtime — the same bridge the promote path uses.
    let recipe_caps = design
        .get("use_cases")
        .and_then(|v| v.as_array())
        .map(|ucs| crate::engine::recipe_parameters::derive_capability_params_from_values(ucs))
        .unwrap_or_default();
    let recipe_param_values = crate::engine::recipe_parameters::to_parameter_values(&recipe_caps);

    // Normalize structured_prompt, injecting the capability-parameters section.
    let structured_prompt = {
        let mut sp = design.get("structured_prompt").cloned();
        if let Some(ref mut spv) = sp {
            crate::engine::recipe_parameters::inject_into_structured_prompt(spv, &recipe_caps);
        }
        sp
    };

    let persona_meta = design.get("persona_meta");
    let icon = persona_meta
        .and_then(|m| m.get("icon"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let color = persona_meta
        .and_then(|m| m.get("color"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    // Untrusted door: see `super::sanitized_model_profile`.
    let model_profile = persona_meta
        .and_then(|m| m.get("model_profile"))
        .and_then(|v| v.as_str())
        .and_then(|s| super::sanitized_model_profile(s, "template_adopt"));
    // Phase 2 / cert: bake `timeout_ms` + `max_concurrent` from persona_meta so
    // adoptions don't regress to the create-defaults (300s/1) — autonomous code
    // work needs longer timeouts + concurrent capacity. Sane bounds applied so
    // a bad template can't set absurd values. Applied post-create (the n8n
    // draft doesn't carry these columns, same pattern as last_design_result).
    let template_timeout_ms: Option<i32> = persona_meta
        .and_then(|m| m.get("timeout_ms"))
        .and_then(|v| v.as_i64())
        .filter(|n| (10_000..=24 * 3_600_000).contains(n))
        .map(|n| n as i32);
    let template_max_concurrent: Option<i32> = persona_meta
        .and_then(|m| m.get("max_concurrent"))
        .and_then(|v| v.as_i64())
        .filter(|n| (1..=64).contains(n))
        .map(|n| n as i32);
    // Design D: the persona's authored `core` (motivation/stance/dials — its
    // distinct deliberation viewpoint). Applied post-create to `core_profile`,
    // same pattern as timeout_ms (the n8n draft doesn't carry it).
    // `persona_meta.core` was the original Design-D contract, but no template
    // on disk ever carried it there — the authored dials live at
    // `payload.persona.core` (9 SDLC templates + every Foundry archetype).
    // The persona object survives `normalize_v3_to_flat`, so read it as the
    // fallback; without this the stamp below was dead code on every adoption
    // (found in the 2026-07-06 Foundry audit).
    let template_core: Option<String> = persona_meta
        .and_then(|m| m.get("core"))
        .filter(|c| !c.is_null())
        .or_else(|| design.pointer("/persona/core").filter(|c| !c.is_null()))
        .map(|c| c.to_string());
    let persona_name = persona_meta
        .and_then(|m| m.get("name"))
        .and_then(|v| v.as_str())
        .filter(|n| !n.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or(template_name.clone());

    // Build tools from suggested_tools
    let tools: Option<Vec<N8nToolDraft>> = design
        .get("suggested_tools")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let name = t.as_str().map(|s| s.to_string()).or_else(|| {
                        t.get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                    })?;
                    Some(N8nToolDraft {
                        name: name.clone(),
                        category: t
                            .get("category")
                            .and_then(|v| v.as_str())
                            .unwrap_or("api")
                            .to_string(),
                        description: t
                            .get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&name)
                            .to_string(),
                        requires_credential_type: t
                            .get("requires_credential_type")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        input_schema: t.get("input_schema").cloned(),
                        implementation_guide: t
                            .get("implementation_guide")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                })
                .collect()
        });

    // Build triggers from suggested_triggers. `normalize_v3_to_flat` tags
    // each hoisted per-UC trigger with its `use_case_id` — carried through so
    // the post-create charter mint can remap the created trigger rows onto
    // their charter ids (`responsibility_id`); it was discarded (`None`) here
    // until the WP4 cutover, leaving adopt-born triggers unattributed.
    let triggers: Option<Vec<N8nTriggerDraft>> = design
        .get("suggested_triggers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|t| N8nTriggerDraft {
                    trigger_type: t
                        .get("trigger_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("manual")
                        .to_string(),
                    config: t.get("config").cloned(),
                    description: t
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    use_case_id: t
                        .get("use_case_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                })
                .collect()
        });

    // Build required_connectors from suggested_connectors
    let required_connectors: Option<Vec<N8nConnectorRef>> = design
        .get("suggested_connectors")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let name = c
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if name.is_empty() {
                        return None;
                    }
                    Some(N8nConnectorRef {
                        name: name.clone(),
                        n8n_credential_type: c
                            .get("auth_type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("api_key")
                            .to_string(),
                        has_credential: true,
                    })
                })
                .collect()
        });

    let notification_channels = design
        .get("suggested_notification_channels")
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    // The canonical use-case list after hydration + normalization lives at
    // `design.use_cases` (each entry inline-shaped, or a v2 responsibility
    // payload for transformed recipe seeds); `use_case_flows` is the
    // v3-flattened mirror. Stage B WP4: these entries are minted as
    // `persona_responsibilities` charters post-create — `design_context`
    // no longer carries a `useCases` array (the historical write asymmetry
    // where adopt dropped review/memory/error fields that promote preserved
    // dies with it; the full payload still lands in `last_design_result`).
    let raw_use_cases = design
        .get("use_cases")
        .and_then(|v| v.as_array())
        .cloned()
        .or_else(|| {
            design
                .get("use_case_flows")
                .and_then(|v| v.as_array())
                .cloned()
        })
        .unwrap_or_default();
    let design_context_summary = design
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            design
                .get("persona")
                .and_then(|p| p.get("goal"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| format!("Adopted from template: {}", template_name));
    // service_flow surfaces in the Design tab's connector pipeline panel —
    // pull through if the template carried one.
    let service_flow_json = design.get("service_flow").cloned();
    let design_context_obj = serde_json::json!({
        "summary": design_context_summary,
        "connectorPipeline": service_flow_json,
        "builderMeta": {
            "creationMethod": "template_adopt"
        }
    });
    let design_context_str =
        serde_json::to_string(&design_context_obj).unwrap_or_else(|_| "{}".to_string());

    // The Design tab reads `persona.last_design_result` as the AgentIR. After
    // hydration + normalization, `design` is already AgentIR-shaped — it
    // carries `structured_prompt`, `suggested_tools`, `suggested_triggers`,
    // `suggested_connectors`, `suggested_notification_channels`,
    // `suggested_event_subscriptions`, `service_flow`,
    // `protocol_capabilities`, `use_case_flows`, plus the synthesized
    // `full_prompt_markdown`/`summary` we inject below. Persisting the whole
    // payload as last_design_result is what makes the Design tab show real
    // content instead of an empty intent panel for instant-adopted personas.
    let mut design_for_persist = design.clone();
    if let Some(obj) = design_for_persist.as_object_mut() {
        if !obj.contains_key("full_prompt_markdown") {
            obj.insert(
                "full_prompt_markdown".to_string(),
                serde_json::Value::String(full_prompt.clone()),
            );
        }
        if !obj.contains_key("summary") {
            obj.insert(
                "summary".to_string(),
                serde_json::Value::String(design_context_summary.clone()),
            );
        }
    }
    let last_design_result_str = serde_json::to_string(&design_for_persist).ok();

    // Phase 17: derive template_category from the instruction text + connector names
    // so Simple-mode's tier-3 illustration resolver can bucket this persona.
    // Uses the same heuristic as `review_from_execution` to keep vocabularies aligned.
    let connectors_json_for_category = required_connectors.as_ref().and_then(|conns| {
        serde_json::to_string(&conns.iter().map(|c| c.name.clone()).collect::<Vec<_>>()).ok()
    });
    let inferred_category = super::reviews::infer_template_category(
        &full_prompt,
        connectors_json_for_category.as_deref(),
    );

    // Build the N8nPersonaOutput draft
    let draft = N8nPersonaOutput {
        name: Some(persona_name),
        description: summary,
        system_prompt: full_prompt,
        structured_prompt,
        icon,
        color,
        model_profile,
        max_budget_usd: None,
        max_turns: None,
        design_context: Some(design_context_str),
        notification_channels,
        template_category: Some(inferred_category),
        triggers,
        tools,
        required_connectors,
    };

    let draft = super::n8n_transform::types::normalize_n8n_persona_draft(draft, &template_name);

    // Atomic create: persona + tools + triggers in one transaction
    let (mut response, _import_result) =
        super::n8n_transform::confirmation::create_persona_atomically(&state.db, &draft, None)?;

    // Track adoption count
    let created_persona_id = response
        .get("persona")
        .and_then(|p| p.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Err(e) = reviews_repo::increment_adoption_count(
        &state.db,
        &template_name,
        created_persona_id.as_deref(),
    ) {
        tracing::warn!(template = %template_name, error = %e, "Failed to increment adoption count");
    }

    // Stage B WP4 — mint the adopted capabilities as charters
    // (`persona_responsibilities`). This IS the adoption's capability write
    // now that design_context.useCases is gone; a persona without charters
    // is exactly the "structurally broken persona reported as adopted" this
    // function refuses elsewhere, so a mint failure fails the adoption and
    // removes the just-created persona instead of leaving a ghost.
    if let Some(pid) = created_persona_id.as_deref() {
        match mint_charters_from_use_cases(&state.db, pid, &raw_use_cases) {
            Ok(minted) => {
                // Remap the freshly created trigger rows onto their charter
                // ids: the drafts carried the hoisted `use_case_id` tag and
                // each charter remembers its source use case at
                // `spec.migrated_from_use_case_id` (e19's remap contract).
                // The row keeps its legacy `use_case_id` value — the INSERT
                // lives in `create_persona_atomically`
                // (n8n_transform::confirmation), which the raw n8n import
                // path shares; see the WP4 report.
                if let Ok(conn) = state.db.get() {
                    for charter in &minted {
                        let Some(uc_id) = charter.spec.migrated_from_use_case_id.as_deref() else {
                            continue;
                        };
                        if let Err(e) = conn.execute(
                            "UPDATE persona_triggers SET responsibility_id = ?1 \
                             WHERE persona_id = ?2 AND use_case_id = ?3",
                            rusqlite::params![charter.id, pid, uc_id],
                        ) {
                            tracing::warn!(
                                persona_id = %pid,
                                charter_id = %charter.id,
                                error = %e,
                                "instant_adopt_template: trigger→charter remap failed (continuing)"
                            );
                        }
                    }
                }
                tracing::info!(
                    persona_id = %pid,
                    charters = minted.len(),
                    "instant_adopt_template: minted capability charters"
                );
            }
            Err(e) => {
                // Best-effort unwind: the persona row (and its tx-created
                // tools/triggers) must not survive as a capability-less ghost.
                if let Err(del_err) = crate::db::repos::core::personas::delete(&state.db, pid) {
                    tracing::warn!(
                        persona_id = %pid,
                        error = %del_err,
                        "instant_adopt_template: cleanup delete after failed charter mint also failed"
                    );
                }
                return Err(AppError::Validation(format!(
                    "Template '{template_name}' adoption failed while minting capability \
                     charters: {e}. The partially-created persona was removed."
                )));
            }
        }
    }

    // Persist last_design_result so the Design tab has the AgentIR to render.
    // create_persona_atomically + N8nPersonaOutput don't carry this column;
    // we write it directly post-create. Best-effort — a failure here doesn't
    // abort the adoption (persona row is already valid), but the Design tab
    // would show a less-rich state.
    if let (Some(pid), Some(ref ldr)) = (created_persona_id.as_deref(), &last_design_result_str) {
        if let Ok(conn) = state.db.get() {
            let _ = conn.execute(
                "UPDATE personas SET last_design_result = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![ldr, chrono::Utc::now().to_rfc3339(), pid],
            );
        }
    }

    // Apply persona_meta's timeout_ms / max_concurrent post-create (the n8n draft
    // doesn't carry these). Without this, code-track templates (SDLC) regress to
    // 300s/1 every adoption — the run-4 / capstone-run blocker. Best-effort.
    if let Some(pid) = created_persona_id.as_deref() {
        if template_timeout_ms.is_some() || template_max_concurrent.is_some() {
            if let Ok(conn) = state.db.get() {
                let now = chrono::Utc::now().to_rfc3339();
                if let Some(t) = template_timeout_ms {
                    let _ = conn.execute(
                        "UPDATE personas SET timeout_ms = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![t, &now, pid],
                    );
                }
                if let Some(mc) = template_max_concurrent {
                    let _ = conn.execute(
                        "UPDATE personas SET max_concurrent = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![mc, &now, pid],
                    );
                }
            }
        }
    }

    // Design D: stamp the authored core into `core_profile` (the deliberation
    // moderator routes by it; persona turns speak from it). Best-effort.
    // Seed-if-absent (living-agent): adoption never overwrites an operator-
    // edited Core — the guard makes this a no-op on rows that already have one.
    if let (Some(pid), Some(core)) = (created_persona_id.as_deref(), &template_core) {
        if let Ok(conn) = state.db.get() {
            match conn.execute(
                "UPDATE personas SET core_profile = ?1, updated_at = ?2 \
                 WHERE id = ?3 AND (core_profile IS NULL OR core_profile = '')",
                rusqlite::params![core, chrono::Utc::now().to_rfc3339(), pid],
            ) {
                Ok(0) => tracing::info!(
                    persona_id = %pid,
                    "adopt: core_profile already present — seed skipped (operator-owned)",
                ),
                Ok(_) => tracing::info!(
                    persona_id = %pid,
                    "adopt: stamped persona core_profile (seed-if-absent)",
                ),
                Err(e) => tracing::warn!(
                    persona_id = %pid,
                    error = %e,
                    "adopt: core_profile stamp failed (non-fatal)",
                ),
            }
        }
    }

    // Translate `adoption_questions[].maps_to == persona.parameters[KEY]`
    // declarations into a `PersonaParameter[]` array on the persona row.
    // The instant-adopt path doesn't carry user answers (the test bridge
    // skips the questionnaire) so every parameter lands at its template
    // default — exactly what the user expects from "adopt with defaults".
    //
    // The preset combined-questionnaire path threads its per-question
    // overrides through `parameter_overrides`; we stringify the JSON
    // values here to match the `HashMap<String, String>` answers
    // contract `populate_persona_parameters_from_design` already
    // expects from the build-session UI path. The stringification
    // covers every type the questionnaire renders today: text,
    // number, select, boolean, vault category — all of which round-
    // trip through their string forms identically (the downstream
    // normalizer re-parses them per the question's declared `type`).
    //
    // Best-effort: a failure here logs and continues; the persona still
    // works, it just won't have tunable parameters surfaced.
    if let Some(pid) = created_persona_id.as_deref() {
        let answers: Option<std::collections::HashMap<String, String>> =
            parameter_overrides.map(|m| {
                m.iter()
                    .map(|(qid, val)| {
                        let s = match val {
                            serde_json::Value::String(s) => s.clone(),
                            serde_json::Value::Null => String::new(),
                            serde_json::Value::Bool(b) => {
                                if *b {
                                    "true".to_string()
                                } else {
                                    "false".to_string()
                                }
                            }
                            serde_json::Value::Number(n) => n.to_string(),
                            other => serde_json::to_string(other).unwrap_or_default(),
                        };
                        (qid.clone(), s)
                    })
                    .collect()
            });
        // Recipe-derived params (from input_schema) — seeded here too (Gap 1),
        // merged UNDER any template-authored suggested_parameters/adoption_questions
        // of the same key. The matching section was injected into structured_prompt
        // above, so the seeded params resolve at runtime.
        if let Err(e) = populate_persona_parameters_from_design(
            &state.db,
            pid,
            &design,
            answers.as_ref(),
            &recipe_param_values,
        ) {
            tracing::warn!(
                persona_id = %pid,
                error = %e,
                "instant_adopt_template: failed to populate persona.parameters (continuing)"
            );
        }
        // Codebase pin: route the codebase adoption question's answer onto
        // design_context.dev_project_id so this persona reads its team's repo.
        if let Err(e) = apply_codebase_pin_from_design(&state.db, pid, &design, answers.as_ref()) {
            tracing::warn!(
                persona_id = %pid,
                error = %e,
                "instant_adopt_template: failed to apply codebase pin (continuing)"
            );
        }
    }

    // Wire cross-persona event subscriptions from the hydrated use_cases.
    // `create_persona_atomically` only inserts triggers + tools, so without this
    // an adopted persona EMITS events (via its prompt) but never auto-LISTENS —
    // a team-preset's event handoffs (architecture.analysis.completed → reviewer,
    // release.published → docs, …) would never fire and the "team" wouldn't run
    // as a pipeline. Mirrors the glyph build path's `create_event_subscriptions_in_tx`.
    // Best-effort: a failure logs and continues; the persona row is already valid.
    if let Some(pid) = created_persona_id.as_deref() {
        match wire_event_subscriptions_from_use_cases(&state.db, pid, &raw_use_cases) {
            Ok(n) if n > 0 => tracing::info!(
                persona_id = %pid,
                subscriptions = n,
                "instant_adopt_template: wired cross-persona event subscriptions"
            ),
            Ok(_) => {}
            Err(e) => tracing::warn!(
                persona_id = %pid,
                error = %e,
                "instant_adopt_template: event subscription wiring failed (continuing)"
            ),
        }
    }

    // Adoption pre-flight (C1): if the persona declares connectors that have
    // no matching vault credential, mark setup_status='needs_credentials' so
    // the dashboard surfaces a "Setup required" badge and the user knows the
    // persona can't run yet. Built-in local connectors (local_drive,
    // personas_database, personas_messages, personas_vector_db) are always
    // considered satisfied. Failure is best-effort — a stuck setup_status
    // write must not block the adoption response.
    if let Some(pid) = created_persona_id.as_deref() {
        match check_persona_runnability(&state.db, &draft.required_connectors, Some(&design)) {
            Ok(missing) if !missing.is_empty() => {
                tracing::info!(
                    persona_id = %pid,
                    missing_count = missing.len(),
                    missing = ?missing,
                    "adoption pre-flight: persona declares connectors without vault credentials",
                );
                if let Err(e) = set_persona_setup_status(&state.db, pid, "needs_credentials") {
                    tracing::warn!(persona_id = %pid, error = %e, "Failed to write setup_status");
                }
                // Surface to caller so UI can display the warning immediately.
                if let serde_json::Value::Object(ref mut map) = response {
                    map.insert(
                        "setup_status".to_string(),
                        serde_json::json!("needs_credentials"),
                    );
                    map.insert(
                        "missing_credentials".to_string(),
                        serde_json::json!(missing),
                    );
                }
            }
            Ok(_) => {
                // No missing creds — column default 'ready' is correct, no write needed.
            }
            Err(e) => {
                tracing::warn!(persona_id = %pid, error = %e, "adoption pre-flight check failed");
            }
        }
    }

    tracing::info!(
        template_id = %template_name,
        persona_id = %created_persona_id.as_deref().unwrap_or("?"),
        outcome = "success",
        "instant_adopt_template: completed with tools + triggers"
    );
    Ok(response)
}

/// Return the id of the first `use_cases[]` entry that still carries a
/// `recipe_ref` stub (i.e. was NOT hydrated), if any. Used as a post-
/// hydration guard in `instant_adopt_template_inner`: a surviving stub
/// normalizes to an empty Use Case (no trigger / connectors / events), so a
/// partial hydrate would otherwise be reported as a successful adoption.
/// Failing on a surviving stub keeps that from ever happening.
fn first_unhydrated_recipe_ref(design: &serde_json::Value) -> Option<String> {
    let use_cases = design.get("use_cases").and_then(|v| v.as_array())?;
    for uc in use_cases {
        if let Some(recipe_ref) = uc.get("recipe_ref") {
            let id = recipe_ref
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("<unknown>");
            return Some(id.to_string());
        }
    }
    None
}

/// Auth types that mean "no vault credential needed". Templates use these
/// when the "connector" is really a config-only data source (e.g. a list of
/// RSS URLs the persona reads directly, no auth) or when access is handled
/// by the runtime (native CLI capability).
fn is_credential_free_auth(auth_type: Option<&str>) -> bool {
    match auth_type.map(|s| s.trim().to_ascii_lowercase()) {
        Some(s) => matches!(
            s.as_str(),
            "" | "none" | "config" | "config_only" | "no_auth" | "public" | "anonymous"
        ),
        None => false,
    }
}

/// Look up a per-connector `auth_type` from the raw template payload's
/// `persona.connectors[]` array (where v3 templates declare auth shape).
/// Returns None when the template doesn't carry an explicit auth_type, so
/// the caller falls back to the historical "needs credential" assumption.
fn lookup_connector_auth_type<'a>(
    design: Option<&'a serde_json::Value>,
    connector_name: &str,
) -> Option<&'a str> {
    let arr = design?.get("persona")?.get("connectors")?.as_array()?;
    for c in arr {
        let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name.eq_ignore_ascii_case(connector_name) {
            return c.get("auth_type").and_then(|v| v.as_str());
        }
    }
    None
}

/// Walk the persona's declared connector list and return the names of any
/// that still need setup.
///
/// The authoritative readiness check is the unified resolver in
/// `commands::design::connector_readiness` — the same one the build promote
/// path uses, so adoption pre-flight and promote can no longer disagree. It
/// understands every connector class: zero-config builtins, vault-credential
/// connectors, binding-backed builtins (`codebase` → a Dev Tools project),
/// and global-singleton builtins (`obsidian_memory` → an Obsidian vault).
///
/// Two escape hatches stay HERE rather than in the resolver because they
/// depend on the raw template payload, which the resolver never sees:
///  1. a connector whose template `category` is a native CLI capability
///     (some templates write `category: web_scraping`, `name: rss_feeds`);
///  2. a connector whose template entry explicitly declares a
///     credential-free `auth_type` (a config-only data source).
///
/// `design` is the normalized template payload; per-connector `auth_type`
/// and `category` are read off `design.persona.connectors[]` when present.
fn check_persona_runnability(
    pool: &crate::db::DbPool,
    required: &Option<Vec<super::n8n_transform::types::N8nConnectorRef>>,
    design: Option<&serde_json::Value>,
) -> Result<Vec<String>, AppError> {
    let required = match required {
        Some(r) if !r.is_empty() => r,
        _ => return Ok(Vec::new()),
    };
    let conn = pool.get()?;

    let mut missing = Vec::new();
    for c in required {
        let name = c.name.trim();
        if name.is_empty() {
            continue;
        }
        // Template-payload escape hatch: the connector's declared category
        // resolves to a native CLI capability.
        let category_from_template = design
            .and_then(|d| d.get("persona"))
            .and_then(|p| p.get("connectors"))
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter().find(|e| {
                    e.get("name")
                        .and_then(|v| v.as_str())
                        .is_some_and(|n| n.eq_ignore_ascii_case(name))
                })
            })
            .and_then(|e| e.get("category"))
            .and_then(|v| v.as_str());
        if let Some(cat) = category_from_template {
            if super::connector_readiness::is_native_cli_capability(cat) {
                continue;
            }
        }
        // Template-payload escape hatch: template explicitly declared a
        // credential-free auth_type (config-only data source).
        let auth_type = lookup_connector_auth_type(design, name);
        if auth_type.is_some() && is_credential_free_auth(auth_type) {
            continue;
        }
        // Authoritative, class-aware readiness check.
        match super::connector_readiness::connector_readiness(&conn, name) {
            super::connector_readiness::Readiness::Ready => {}
            super::connector_readiness::Readiness::NeedsSetup { connector, kind } => {
                tracing::debug!(
                    connector = %connector,
                    setup_kind = %kind.as_str(),
                    "adoption pre-flight: connector needs setup"
                );
                missing.push(connector);
            }
        }
    }
    Ok(missing)
}

fn set_persona_setup_status(
    pool: &crate::db::DbPool,
    persona_id: &str,
    status: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE personas SET setup_status = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![status, chrono::Utc::now().to_rfc3339(), persona_id],
    )?;
    Ok(())
}

/// Walk `design.adoption_questions[]` and write a `PersonaParameter[]` array
/// into the persona's `parameters` column. A question contributes a parameter
/// iff its `maps_to` field is shaped `persona.parameters[<key>]`. The
/// parameter's `value` is the user's answer (when present in `answers`) or
/// the question's `default` otherwise — so the test-bridge "instant adopt"
/// path (no answers, defaults applied) and the UI build path (answers
/// collected via questionnaire) converge on the same persona shape.
///
/// `PersonaParameter` is the schema declared in `db/models/persona.rs`:
///   { key, label, type, default_value, value, description?, options?,
///     min?, max?, unit? }
///
/// The `value` is normalized to the parameter's declared `type`:
///   number  → JSON Number (f64 parse; falls back to default on failure)
///   boolean → JSON Bool (true/yes/1/on or false/no/0/off; else default)
///   select  → JSON String (raw answer string)
///   string  → JSON String
/// Wire `persona_event_subscriptions` for a freshly-adopted persona from its
/// hydrated template use_cases. This is the template-adopt-path equivalent of
/// the glyph build path's `create_event_subscriptions_in_tx`
/// (`build_sessions.rs`): every `use_cases[].event_subscriptions[]` entry whose
/// `direction` is "listen" becomes one subscription row. `source_filter`
/// defaults to `"*"` — the cross-persona-chain default, so the bus delivers the
/// event regardless of which persona emitted it — unless this persona itself
/// emits that event type, in which case it stays self-scoped (`NULL`). Rows are
/// de-duped on `(event_type, source_filter)`. Returns the number created.
///
/// Without this, `create_persona_atomically` (which only inserts triggers +
/// tools) leaves an adopted persona able to EMIT events but never LISTEN, so a
/// team preset's event handoffs never fire.
fn wire_event_subscriptions_from_use_cases(
    pool: &crate::db::DbPool,
    persona_id: &str,
    use_cases: &[serde_json::Value],
) -> Result<u32, AppError> {
    fn is_listen(d: Option<&str>) -> bool {
        matches!(d, Some("listen") | Some("subscribe") | Some("consume"))
    }

    // Event types this persona EMITS — drives the self-scope vs cross-persona
    // `source_filter` default (mirrors `collect_persona_emit_event_types`).
    let mut emits: HashSet<String> = HashSet::new();
    for uc in use_cases {
        if let Some(subs) = uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            for s in subs {
                if s.get("direction").and_then(|v| v.as_str()) == Some("emit") {
                    if let Some(et) = s.get("event_type").and_then(|v| v.as_str()) {
                        if !et.is_empty() {
                            emits.insert(et.to_string());
                        }
                    }
                }
            }
        }
    }

    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut seen: HashSet<(String, Option<String>)> = HashSet::new();
    let mut created = 0u32;

    for uc in use_cases {
        let uc_id = uc.get("id").and_then(|v| v.as_str());
        let subs = match uc.get("event_subscriptions").and_then(|v| v.as_array()) {
            Some(s) => s,
            None => continue,
        };
        for s in subs {
            if !is_listen(s.get("direction").and_then(|v| v.as_str())) {
                continue;
            }
            let event_type = match s.get("event_type").and_then(|v| v.as_str()) {
                Some(et) if !et.is_empty() => et.to_string(),
                _ => continue,
            };
            let source_filter: Option<String> = s
                .get("source_filter")
                .and_then(|v| v.as_str())
                .map(|x| x.to_string())
                .or_else(|| {
                    if emits.contains(&event_type) {
                        None
                    } else {
                        Some("*".to_string())
                    }
                });
            if !seen.insert((event_type.clone(), source_filter.clone())) {
                continue;
            }
            let sub_id = uuid::Uuid::new_v4().to_string();
            let rows = conn
                .execute(
                    "INSERT OR IGNORE INTO persona_event_subscriptions
                     (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
                    rusqlite::params![sub_id, persona_id, event_type, source_filter, uc_id, now],
                )
                .map_err(AppError::Database)?;
            created += rows as u32;
        }
    }
    Ok(created)
}

/// The `maps_to` token that pins a persona to a specific Dev Tools project
/// (codebase). An adoption question declaring this maps_to writes its answered
/// dev_project id onto `design_context.dev_project_id` (JSON `devProjectId`).
pub(super) const CODEBASE_PIN_MAPS_TO: &str = "persona.design_context[dev_project_id]";

/// Codebase pin: if the template declares an adoption question with
/// `maps_to: persona.design_context[dev_project_id]`, write its answered (or
/// default) dev_project id onto the persona's `design_context.dev_project_id`.
/// A team adopted for repo X sets every member's pin to X's dev_project, so each
/// persona's codebase/context tools resolve repo X at runtime
/// (`resolve_context_project` reads it via the runner-injected
/// `PERSONAS_DEV_PROJECT_ID`). The pin lives on the persona, so it survives team
/// disband. Best-effort: merges into the existing design_context without
/// clobbering useCases/summary. A blank answer (or the placeholder default
/// `"codebase"`) leaves the persona unpinned → global-probe fallback.
pub(super) fn apply_codebase_pin_from_design(
    pool: &crate::db::DbPool,
    persona_id: &str,
    design: &serde_json::Value,
    answers: Option<&std::collections::HashMap<String, String>>,
) -> Result<(), AppError> {
    let questions = match design.get("adoption_questions").and_then(|v| v.as_array()) {
        Some(q) => q,
        None => return Ok(()),
    };
    let mut pinned: Option<String> = None;
    for q in questions {
        if q.get("maps_to").and_then(|v| v.as_str()) != Some(CODEBASE_PIN_MAPS_TO) {
            continue;
        }
        let q_id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let val = answers.and_then(|a| a.get(q_id).cloned()).or_else(|| {
            q.get("default")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
        if let Some(v) = val {
            let v = v.trim().to_string();
            // Skip blanks and the placeholder connector-name default — those mean
            // "no specific project chosen" → leave unpinned.
            if !v.is_empty() && v != "codebase" {
                pinned = Some(v);
                break;
            }
        }
    }
    let answer = match pinned {
        Some(p) => p,
        None => return Ok(()),
    };

    let conn = pool.get()?;
    // Resolve the answer to a real dev_project id. The codebase question's
    // option VALUE can be the project name (LocalCodebases discovery returns
    // `value: name`), an id (driver/override), or a root_path — accept any,
    // preferring an exact id match. If none resolves, leave unpinned rather
    // than writing a dangling id (resolve_context_project would ignore it).
    let project_id: String = match conn
        .query_row(
            "SELECT id FROM dev_projects \
             WHERE id = ?1 OR name = ?1 OR root_path = ?1 \
             ORDER BY (id = ?1) DESC, (status = 'active') DESC LIMIT 1",
            rusqlite::params![answer],
            |r| r.get(0),
        )
        .ok()
    {
        Some(id) => id,
        None => {
            tracing::warn!(persona_id = %persona_id, answer = %answer, "codebase pin: no dev_project matched answer — leaving unpinned");
            return Ok(());
        }
    };

    let existing: Option<String> = conn
        .query_row(
            "SELECT design_context FROM personas WHERE id = ?1",
            rusqlite::params![persona_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let mut dc: serde_json::Value = existing
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !dc.is_object() {
        dc = serde_json::json!({});
    }
    if let Some(obj) = dc.as_object_mut() {
        // DesignContextData is `rename_all = "camelCase"` → JSON key `devProjectId`.
        obj.insert(
            "devProjectId".to_string(),
            serde_json::Value::String(project_id.clone()),
        );
    }
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![dc.to_string(), now, persona_id],
    )
    .map_err(AppError::Database)?;
    tracing::info!(persona_id = %persona_id, dev_project_id = %project_id, "codebase pin set on adopted persona");
    Ok(())
}

pub(super) fn populate_persona_parameters_from_design(
    pool: &crate::db::DbPool,
    persona_id: &str,
    design: &serde_json::Value,
    answers: Option<&std::collections::HashMap<String, String>>,
    // Params derived from recipe `input_schema` (Foundry arc, 2026-07). Lowest
    // precedence: seeded first so a template's own `suggested_parameters` /
    // `adoption_questions` with the same KEY override them.
    recipe_params: &[serde_json::Value],
) -> Result<(), AppError> {
    // Two authoring paths converge here:
    //   1. `suggested_parameters[]` — direct PersonaParameter array on the
    //      template payload. Used when the template author has a fixed
    //      knob set unrelated to the questionnaire.
    //   2. `adoption_questions[]` with `maps_to: persona.parameters[KEY]` —
    //      the question's `default` becomes the parameter's default and
    //      the user's answer (when present) becomes the value. Used when
    //      the knob is something we want to ask the user about during
    //      adoption.
    // The second path takes precedence: if the same KEY appears in both
    // sources, the questionnaire-derived definition (with the user's
    // answer baked in) wins.
    let mut params_by_key: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();

    // Recipe-derived params first (lowest precedence) — overridden below by any
    // template-authored suggested_parameters / adoption_questions of the same key.
    for p in recipe_params {
        if let Some(k) = p.get("key").and_then(|v| v.as_str()) {
            params_by_key.insert(k.to_string(), p.clone());
        }
    }

    if let Some(arr) = design
        .get("suggested_parameters")
        .and_then(|v| v.as_array())
    {
        for p in arr {
            if let Some(k) = p.get("key").and_then(|v| v.as_str()) {
                params_by_key.insert(k.to_string(), p.clone());
            }
        }
    }

    let questions = match design.get("adoption_questions").and_then(|v| v.as_array()) {
        Some(arr) => arr.as_slice(),
        None => &[],
    };
    if params_by_key.is_empty() && questions.is_empty() {
        return Ok(());
    }

    // Build the regex once per call. Adoption is rare enough that the
    // per-call compile is invisible; avoids a once_cell dep.
    let param_re = regex::Regex::new(r"^persona\.parameters\[([A-Za-z0-9_]+)\]$")
        .map_err(|e| AppError::Internal(format!("compile param regex: {e}")))?;

    for q in questions {
        let maps_to = q.get("maps_to").and_then(|v| v.as_str()).unwrap_or("");
        let key = match param_re.captures(maps_to) {
            Some(c) => c.get(1).unwrap().as_str().to_string(),
            None => continue,
        };
        let q_id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let label = q
            .get("variable_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| key.clone());
        let q_type = q
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("string")
            .to_string();
        let default = q.get("default").cloned().unwrap_or(serde_json::Value::Null);
        let description = q
            .get("context")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let options: Option<Vec<String>> = q.get("options").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        });
        let min = q.get("min").and_then(|v| v.as_f64());
        let max = q.get("max").and_then(|v| v.as_f64());
        let unit = q
            .get("unit")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let raw_answer = answers.and_then(|a| a.get(q_id));
        let value = match raw_answer {
            Some(s) => coerce_answer_to_param_value(s, &q_type, &default),
            None => default.clone(),
        };

        let mut param = serde_json::json!({
            "key": key.clone(),
            "label": label,
            "type": q_type,
            "default_value": default,
            "value": value,
        });
        if let Some(d) = description {
            param["description"] = serde_json::Value::String(d);
        }
        if let Some(o) = options {
            param["options"] = serde_json::json!(o);
        }
        if let Some(m) = min {
            param["min"] = serde_json::json!(m);
        }
        if let Some(m) = max {
            param["max"] = serde_json::json!(m);
        }
        if let Some(u) = unit {
            param["unit"] = serde_json::Value::String(u);
        }
        params_by_key.insert(key, param);
    }

    if params_by_key.is_empty() {
        return Ok(());
    }

    // Sort by key for deterministic ordering — the UI lists parameters in
    // whatever order they arrive, and a stable order makes diffs readable.
    let mut params: Vec<serde_json::Value> = params_by_key.into_values().collect();
    params.sort_by(|a, b| {
        a.get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .cmp(b.get("key").and_then(|v| v.as_str()).unwrap_or(""))
    });

    let json_str = serde_json::to_string(&params)
        .map_err(|e| AppError::Internal(format!("serialize persona parameters: {e}")))?;
    let conn = pool.get()?;
    conn.execute(
        "UPDATE personas SET parameters = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![json_str, chrono::Utc::now().to_rfc3339(), persona_id],
    )?;
    Ok(())
}

fn coerce_answer_to_param_value(
    raw: &str,
    q_type: &str,
    default: &serde_json::Value,
) -> serde_json::Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return default.clone();
    }
    match q_type {
        "number" => match trimmed.parse::<f64>() {
            Ok(n) => serde_json::Value::from(n),
            Err(_) => default.clone(),
        },
        "boolean" => match trimmed.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" | "on" => serde_json::Value::Bool(true),
            "false" | "no" | "0" | "off" => serde_json::Value::Bool(false),
            _ => default.clone(),
        },
        _ => serde_json::Value::String(trimmed.to_string()),
    }
}

// ==================================================================
// Template Generation (create new templates from user description)
// ==================================================================

// -- Gen job extra state -----------------------------------------

#[derive(Clone, Default)]
struct GenExtra {
    result_json: Option<String>,
}

/// Generate-specific extras flattened into BackgroundTaskSnapshot.
#[derive(Clone, Serialize)]
struct GenSnapshotExtras {
    gen_id: String,
    result_json: Option<String>,
}

static GEN_JOBS: BackgroundJobManager<GenExtra> = BackgroundJobManager::new(
    "template gen job lock poisoned",
    event_name::TEMPLATE_GENERATE_STATUS,
    event_name::TEMPLATE_GENERATE_OUTPUT,
);

#[tauri::command]
pub async fn generate_template_background(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    gen_id: String,
    template_name: String,
    description: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    if description.trim().is_empty() {
        return Err(AppError::Validation(
            "Template description cannot be empty".into(),
        ));
    }

    let cancel_token = CancellationToken::new();
    GEN_JOBS.insert_running(gen_id.clone(), cancel_token.clone(), GenExtra::default())?;
    GEN_JOBS.set_status(&app, &gen_id, "running", None);

    let app_handle = app.clone();
    let gen_id_for_task = gen_id.clone();
    let token_for_task = cancel_token;
    let app_handle_for_panic = app_handle.clone();
    let gen_id_for_panic = gen_id_for_task.clone();

    GEN_JOBS.spawn_job(
        app_handle_for_panic,
        gen_id_for_panic,
        "template generation",
        async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Template generation cancelled by user".into()))
            }
            res = run_template_generate_job(
                &app_handle,
                &gen_id_for_task,
                &template_name,
                &description,
            ) => res
        };

        match result {
            Ok(result_json) => {
                GEN_JOBS.update_extra(&gen_id_for_task, |extra| {
                    extra.result_json = Some(result_json);
                });
                GEN_JOBS.set_status(&app_handle, &gen_id_for_task, "completed", None);
            }
            Err(err) => {
                let msg = err.to_string();
                tracing::error!(gen_id = %gen_id_for_task, error = %msg, "template generation failed");
                GEN_JOBS.set_status(&app_handle, &gen_id_for_task, "failed", Some(msg));
            }
        }
        },
    );

    Ok(json!({ "gen_id": gen_id }))
}

#[tauri::command]
pub fn get_template_generate_snapshot(
    state: State<'_, Arc<AppState>>,
    gen_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let snapshot = GEN_JOBS
        .get_task_snapshot(&gen_id, |extra| GenSnapshotExtras {
            gen_id: gen_id.clone(),
            result_json: extra.result_json.clone(),
        })
        .ok_or_else(|| AppError::NotFound("Template generation not found".into()))?;
    Ok(serde_json::to_value(snapshot).unwrap_or_else(|_| json!({})))
}

#[tauri::command]
pub fn clear_template_generate_snapshot(
    state: State<'_, Arc<AppState>>,
    gen_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    GEN_JOBS.remove(&gen_id)
}

#[tauri::command]
pub fn cancel_template_generate(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    gen_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    GEN_JOBS.cancel(&app, &gen_id)
}

#[tauri::command]
pub fn save_custom_template(
    state: State<'_, Arc<AppState>>,
    template_name: String,
    instruction: String,
    design_result_json: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    // Extract connectors_used from the design result if available
    let connectors_used: Option<String> =
        serde_json::from_str::<serde_json::Value>(&design_result_json)
            .ok()
            .and_then(|design| {
                design.get("suggested_connectors").and_then(|conns| {
                    let names: Vec<String> = conns
                        .as_array()?
                        .iter()
                        .filter_map(|c| {
                            c.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        })
                        .collect();
                    if names.is_empty() {
                        None
                    } else {
                        Some(names.join(","))
                    }
                })
            });

    let now = chrono::Utc::now().to_rfc3339();
    let test_case_id = uuid::Uuid::new_v4().to_string();

    use crate::db::models::CreateDesignReviewInput;
    use crate::db::repos::communication::reviews as review_repo;

    let review = review_repo::create_review(
        &state.db,
        &CreateDesignReviewInput {
            test_case_id,
            test_case_name: template_name,
            instruction,
            status: "passed".into(),
            structural_score: None,
            semantic_score: None,
            connectors_used,
            trigger_types: None,
            design_result: Some(design_result_json),
            structural_evaluation: None,
            semantic_evaluation: None,
            test_run_id: "custom-template".into(),
            had_references: None,
            suggested_adjustment: None,
            adjustment_generation: None,
            use_case_flows: None,
            reviewed_at: now,
            category: None,
        },
    )?;

    Ok(json!({ "review": review }))
}

/// Run the template generation job -- prompts Claude to generate a DesignAnalysisResult.
async fn run_template_generate_job(
    app: &tauri::AppHandle,
    gen_id: &str,
    template_name: &str,
    description: &str,
) -> Result<String, AppError> {
    tracing::info!(gen_id = %gen_id, "Starting template generation");

    GEN_JOBS.emit_line(
        app,
        gen_id,
        "[Milestone] Preparing template generation prompt...",
    );

    let prompt_text = format!(
        r##"You are a senior Personas architect. Generate a complete template design (DesignAnalysisResult)
from the user's description below.

## What You Must Generate

Create a JSON object with this exact structure (DesignAnalysisResult):

{{
  "structured_prompt": {{
    "identity": "Who this persona is and what role it plays",
    "instructions": "Step-by-step instructions for how to operate -- include protocol message patterns",
    "toolGuidance": "How to use each tool and when to request manual_review",
    "examples": "Example interactions showing protocol message usage",
    "errorHandling": "How to handle errors with user_message notifications",
    "customSections": [
      {{"key": "unique_key", "label": "Section Label", "content": "Section content"}}
    ]
  }},
  "full_prompt_markdown": "Complete system prompt in markdown format -- comprehensive and self-contained",
  "summary": "2-3 sentence description of the persona's purpose",
  "suggested_tools": [
    {{"name": "tool_name", "description": "What it does", "category": "http_request|system|utility"}}
  ],
  "suggested_triggers": [
    {{"type": "cron|webhook|event|manual", "config": "trigger configuration"}}
  ],
  "suggested_connectors": [
    {{
      "name": "ConnectorName",
      "role": "functional_role (e.g. chat_messaging, project_tracking)",
      "category": "broad_category (e.g. messaging, development)",
      "auth_type": "api_key|oauth2|basic",
      "credential_fields": ["field1", "field2"],
      "purpose": "What this connector enables"
    }}
  ],
  "adoption_requirements": [
    {{
      "key": "variable_key",
      "label": "Human Readable Label",
      "description": "What this variable controls",
      "type": "text|select|url|cron",
      "required": true,
      "default_value": "optional default",
      "options": ["only for select type"],
      "source": "user_input"
    }}
  ],
  "feasibility": {{
    "score": 85,
    "notes": "Assessment of how feasible this template is"
  }},
  "persona_meta": {{
    "name": "{template_name}",
    "icon": "lucide-icon-name",
    "color": "#hex-color",
    "model_profile": null
  }}
}}

## Persona Protocol System

The Personas platform supports these protocol messages in system prompts:

1. User Messages: {{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}
2. Agent Memory: {{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}
3. Manual Review: {{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}
4. Events: {{"emit_event": {{"type": "<agent>.<task>.<event_type>", "data": {{}}}}}} — Event names MUST use three-level dot syntax (e.g. `stock.signal.strong_buy`, `invoice.scan.completed`). `agent` = single lowercase word for this agent's domain, `task` = use case area, `event_type` = specific snake_case activity. NEVER use single-word names.

## Variable Placeholders

For any user-specific values (email addresses, API endpoints, usernames, intervals, thresholds, etc.),
use {{{{variable_key}}}} placeholder syntax in the prompts and include a corresponding entry in
adoption_requirements. This lets users customize templates without AI transformation.

## Guidelines

- The full_prompt_markdown should be comprehensive (500+ words) and production-ready
- Include at least 2-3 adoption_requirements for meaningful template variables
- Suggest appropriate tools based on the description
- Include protocol messages in the instructions and examples
- Add a "Human-in-the-Loop" customSection for any external actions
- Add a "Memory Strategy" customSection for knowledge-building scenarios
- Pick appropriate lucide icon and a distinctive color

## User Request

Template name: {template_name}
Description: {description}

Return ONLY valid JSON (no markdown fences, no commentary).
"##
    );

    GEN_JOBS.emit_line(app, gen_id, "[Milestone] Starting Claude generation...");

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit = app.clone();
    let gen_id_for_emit = gen_id.to_string();
    let on_line = move |line: &str| {
        // Raw CLI prose → bounded ring only (no IPC); milestones stay live.
        GEN_JOBS.record_streamed(&app_for_emit, &gen_id_for_emit, line.to_string());
    };

    let llm_start = std::time::Instant::now();
    let (output_text, _session_id, _) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line), None, None, 420)
            .await
            .map_err(AppError::Internal)?;
    let elapsed_ms = llm_start.elapsed().as_millis();
    tracing::info!(elapsed_ms = %elapsed_ms, gen_id = %gen_id, phase = "generate_template", "LLM call completed");

    GEN_JOBS.emit_line(
        app,
        gen_id,
        "[Milestone] Claude output received. Extracting design JSON...",
    );

    // Extract JSON from output
    let json_str = extract_first_json_object(&output_text).ok_or_else(|| {
        AppError::Internal("No valid JSON found in template generation output".into())
    })?;

    // Validate it's valid JSON
    let _: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in generation output: {e}")))?;

    GEN_JOBS.emit_line(
        app,
        gen_id,
        "[Milestone] Template design generated successfully.",
    );

    Ok(json_str)
}

// -- Always-on adoption adjustment (Approach 1) ----------------------
//
// The pre-built base `agent_ir` seeded by `create_adoption_session` is
// authored at the connector-CATEGORY level, so it can't reference the user's
// ACTUAL connector/credential picks or questionnaire answers concretely. This
// step runs an LLM "adjustment" pass that specializes the base to those picks,
// then writes the adjusted IR back to the session so `promote_build_draft`
// materializes the specialized persona.
//
// Scope + safety:
//   * Only the PROSE (`system_prompt` + `structured_prompt`) is merged back;
//     the deterministic structural IR (use_cases, triggers, events, connectors)
//     is preserved untouched.
//   * Divergence-scaled: an absolute-default adoption (no answers, no
//     credential bindings) gets a light, cheap "just wire it, don't rewrite"
//     pass; a diverged adoption gets a fuller Sonnet specialization.
//   * HARD FALLBACK: any failure leaves the base IR untouched (never worse
//     than the deterministic path).

struct AdjustmentBrief {
    /// "default" (light wire) | "configured" (full adjust)
    divergence: &'static str,
    /// model alias passed to --model (ties into the Approach 3 tier philosophy)
    model: &'static str,
    /// instruction injected as the adjustment_request
    instruction: String,
    user_answers_json: Option<String>,
    connector_swaps_json: Option<String>,
}

/// Scan the base IR for any capability tiered to Opus (per the per-capability
/// model tiers baked into the recipe seeds). A persona that carries opus-tier
/// (high-judgment / high-stakes) capabilities warrants an Opus adjustment pass
/// when the user diverges, so the specialization quality matches the stakes.
fn persona_has_opus_capability(base_ir_json: &str) -> bool {
    fn scan(node: &serde_json::Value) -> bool {
        match node {
            serde_json::Value::Object(map) => {
                if let Some(mo) = map.get("model_override") {
                    let tier = mo
                        .as_str()
                        .or_else(|| mo.get("model").and_then(|m| m.as_str()));
                    if matches!(tier, Some(t) if t.to_ascii_lowercase().contains("opus")) {
                        return true;
                    }
                }
                map.values().any(scan)
            }
            serde_json::Value::Array(arr) => arr.iter().any(scan),
            _ => false,
        }
    }
    serde_json::from_str::<serde_json::Value>(base_ir_json)
        .map(|v| scan(&v))
        .unwrap_or(false)
}

/// Decide how much adjustment the user's choices warrant. Absolute-default
/// (no answers, no credential bindings) → a LIGHT pass on Haiku that preserves
/// the authored character but still finalizes protocol wiring (the LLM is
/// always in the loop, just cheap). Anything configured → a fuller
/// specialization that adapts instructions/tool-guidance to the actual
/// connectors + answers; Opus when the persona carries opus-tier capabilities,
/// Sonnet otherwise.
fn assess_adjustment(
    base_ir_json: &str,
    answers: Option<&crate::engine::adoption_answers::AdoptionAnswers>,
) -> AdjustmentBrief {
    let has_answers = answers.map(|a| !a.answers.is_empty()).unwrap_or(false);
    let has_bindings = answers
        .map(|a| !a.credential_bindings.is_empty())
        .unwrap_or(false);

    let user_answers_json = answers
        .filter(|a| !a.answers.is_empty())
        .and_then(|a| serde_json::to_string(&a.answers).ok());
    // The user's concrete connector→credential-service bindings double as the
    // "connector swaps" context the refine prompt consumes to rewrite API
    // references to the chosen services.
    let connector_swaps_json = answers
        .filter(|a| !a.credential_bindings.is_empty())
        .and_then(|a| serde_json::to_string(&a.credential_bindings).ok());

    if !has_answers && !has_bindings {
        AdjustmentBrief {
            divergence: "default",
            model: "haiku",
            instruction:
                "The user kept all defaults (no answers, no bound credentials). Keep the authored \
                 persona's character, structure, principles, and constraints intact — do NOT \
                 rewrite or restructure them. Lightly finalize only: ensure the Personas protocol \
                 instructions (user_message / agent_memory / manual_review) are present and coherent \
                 where the persona interacts with the user, and substitute any {{param.*}} \
                 placeholders that have values. Do not invent new behavior or connectors, and do \
                 not shorten the authored content."
                    .to_string(),
            user_answers_json,
            connector_swaps_json,
        }
    } else {
        let model = if persona_has_opus_capability(base_ir_json) {
            "opus"
        } else {
            "sonnet"
        };
        AdjustmentBrief {
            divergence: "configured",
            model,
            instruction:
                "Specialize this persona to the user's chosen connectors/credentials and \
                 configuration answers: rewrite toolGuidance, instructions, and the system_prompt's \
                 API references so they match the ACTUAL connectors the user selected, and embed the \
                 user's concrete answer values (not placeholders). Preserve the persona's authored \
                 character, principles, constraints, and overall structure — ADAPT it, do not \
                 replace it. Quality and fidelity to the authored design matter more than brevity."
                    .to_string(),
            user_answers_json,
            connector_swaps_json,
        }
    }
}

/// Safety net: flag an adjustment whose `system_prompt` collapsed to a fraction
/// of the authored base (likely truncation or a model that gutted the prompt),
/// so a bad pass can never degrade the authored quality — the caller keeps the
/// base IR instead. Empty outputs are handled upstream by
/// `merge_adjusted_prose` (which keeps the base), so this only guards the
/// non-empty-but-drastically-shorter case. Tiny base prompts are ignored.
fn adjustment_prose_degraded(base_ir_json: &str, new_system_prompt: &str) -> bool {
    let new_len = new_system_prompt.trim().len();
    if new_len == 0 {
        return false;
    }
    let base_len = serde_json::from_str::<serde_json::Value>(base_ir_json)
        .ok()
        .and_then(|v| {
            v.get("system_prompt")
                .and_then(|s| s.as_str())
                .map(|s| s.trim().len())
        })
        .unwrap_or(0);
    base_len > 200 && new_len < base_len * 2 / 5
}

/// Merge the LLM-refined PROSE back onto the deterministic base IR. Only
/// `system_prompt` / `full_prompt_markdown` / `structured_prompt` are written;
/// every structural field of the base is preserved. Returns the merged IR JSON
/// string, or None if the base is unparseable.
fn merge_adjusted_prose(
    base_ir_json: &str,
    new_system_prompt: &str,
    new_structured_prompt: Option<&serde_json::Value>,
) -> Option<String> {
    let mut base: serde_json::Value = serde_json::from_str(base_ir_json).ok()?;
    let obj = base.as_object_mut()?;

    if !new_system_prompt.trim().is_empty() {
        obj.insert(
            "system_prompt".to_string(),
            serde_json::Value::String(new_system_prompt.to_string()),
        );
        // Keep full_prompt_markdown in sync when the base carries it (the
        // editor's plain-text panel and some composers read it).
        if obj.contains_key("full_prompt_markdown") {
            obj.insert(
                "full_prompt_markdown".to_string(),
                serde_json::Value::String(new_system_prompt.to_string()),
            );
        }
    }
    if let Some(structured) = new_structured_prompt {
        if structured.is_object() {
            obj.insert("structured_prompt".to_string(), structured.clone());
        }
    }

    serde_json::to_string(&base).ok()
}

/// The narrow shape the scoped adjustment prompt returns — just the prose we
/// merge. (Avoids making the LLM regenerate the whole persona JSON.)
#[derive(serde::Deserialize)]
struct AdjustedProse {
    #[serde(default)]
    system_prompt: String,
    #[serde(default)]
    structured_prompt: Option<serde_json::Value>,
}

/// Build a FOCUSED adjustment prompt that returns ONLY the refined prose
/// (system_prompt + structured_prompt), not a whole persona. Regenerating the
/// full persona JSON (the legacy full-transform prompt, since removed) made even a tiny
/// persona take 77s (haiku) / 235s+ (sonnet, hitting the 420s timeout) — scoping
/// the OUTPUT to the two fields we actually merge cuts output tokens ~5-10x.
fn build_adoption_adjust_prompt(
    base_system_prompt: &str,
    base_structured_prompt_json: &str,
    instruction: &str,
    user_answers_json: Option<&str>,
    connector_swaps_json: Option<&str>,
) -> String {
    let answers = user_answers_json
        .filter(|a| !a.trim().is_empty() && a.trim() != "{}")
        .map(|a| {
            format!(
                "\n## User configuration answers (embed concrete values, not placeholders)\n{a}\n"
            )
        })
        .unwrap_or_default();
    let swaps = connector_swaps_json
        .filter(|s| !s.trim().is_empty() && s.trim() != "{}")
        .map(|s| format!(
            "\n## Chosen connectors (connector -> credential service)\nRewrite tool/API references to the REPLACEMENT service's APIs, authentication, and endpoints:\n{s}\n"
        ))
        .unwrap_or_default();

    format!(
        r#"You are refining ONE existing persona's instructions to fit the user's actual setup. Do NOT invent a new persona, add tools, or change its purpose.

CURRENT system_prompt:
---
{base_system_prompt}
---

CURRENT structured_prompt (JSON):
---
{base_structured_prompt_json}
---
{swaps}{answers}
TASK: {instruction}

Preserve the persona's authored character, principles, constraints, the Personas protocol-message instructions (user_message / agent_memory / manual_review), and overall structure.

Return ONLY a single JSON object with EXACTLY these two top-level keys and nothing else — no commentary, no markdown fences:
{{"system_prompt": "<full refined system prompt markdown>", "structured_prompt": {{"identity": "...", "instructions": "...", "toolGuidance": "...", "examples": "...", "errorHandling": "...", "webSearch": "...", "customSections": [{{"title": "...", "content": "..."}}]}}}}
"#
    )
}

fn parse_adjusted_prose(output: &str) -> Result<AdjustedProse, AppError> {
    let json_str = extract_first_json_object(output)
        .ok_or_else(|| AppError::Internal("no JSON object in adjustment output".into()))?;
    serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("adjustment output parse error: {e}")))
}

/// Result of an always-on adoption adjustment pass.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionAdjustResult {
    /// true if the session's agent_ir was specialized; false = base kept (fallback or no-op)
    pub adjusted: bool,
    pub divergence: String,
    pub model: Option<String>,
    /// human-readable note (e.g. fallback reason)
    pub note: Option<String>,
    pub elapsed_ms: u64,
}

/// Run the always-on adjustment pass for a draft build session and write the
/// specialized IR back to `build_sessions.agent_ir`. Safe to call before
/// `promote_build_draft`. On any failure it returns `adjusted: false` and
/// leaves the base IR intact — the caller can promote regardless.
#[tauri::command]
pub async fn adjust_adoption_draft(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<AdoptionAdjustResult, AppError> {
    require_auth_sync(&state)?;
    let pool = state.db.clone();
    let started = std::time::Instant::now();

    let session = crate::db::repos::core::build_sessions::get_by_id(&pool, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Build session {session_id}")))?;

    let base_ir = match session.agent_ir.as_deref() {
        Some(s) if !s.trim().is_empty() => s.to_string(),
        _ => {
            return Ok(AdoptionAdjustResult {
                adjusted: false,
                divergence: "none".into(),
                model: None,
                note: Some("session has no base agent_ir".into()),
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
        }
    };

    let answers: Option<crate::engine::adoption_answers::AdoptionAnswers> = session
        .adoption_answers
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    let brief = assess_adjustment(&base_ir, answers.as_ref());

    // Optimization 1 — skip the LLM entirely on an absolute-default adopt.
    // When the user supplied no answers and no credential bindings, there is
    // nothing to specialize: the deterministic base IR (authored prose + the
    // promote-time `{{param.*}}` substitution) is already correct. Running the
    // pass here was measured at ~42s of pure overhead for zero value. Any real
    // divergence (a credential binding, a custom answer, a connector swap) is
    // classified "configured" and still runs the full specialization below.
    if brief.divergence == "default" {
        tracing::info!(
            session_id = %session_id,
            "adjust_adoption_draft: no divergence (default adopt) — skipping LLM, keeping deterministic base"
        );
        return Ok(AdoptionAdjustResult {
            adjusted: false,
            divergence: "default".into(),
            model: None,
            note: Some(
                "no answers or credential bindings — deterministic base already correct; LLM adjustment skipped"
                    .into(),
            ),
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    // Scoped output: feed the base prose, ask for ONLY the refined prose back.
    let base_val: serde_json::Value =
        serde_json::from_str(&base_ir).unwrap_or(serde_json::Value::Null);
    let base_system_prompt = base_val
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let base_structured_prompt_json = base_val
        .get("structured_prompt")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".to_string());

    let prompt_text = build_adoption_adjust_prompt(
        &base_system_prompt,
        &base_structured_prompt_json,
        &brief.instruction,
        brief.user_answers_json.as_deref(),
        brief.connector_swaps_json.as_deref(),
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(brief.model.to_string());

    tracing::info!(
        session_id = %session_id,
        divergence = brief.divergence,
        model = brief.model,
        "adjust_adoption_draft: starting always-on adjustment pass"
    );

    let noop = |_line: &str| {};
    // 600s safety margin for large personas (scoped output keeps the typical
    // pass well under this; raised from the legacy 420s).
    let llm_result =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&noop), None, None, 600).await;

    let elapsed_ms = started.elapsed().as_millis() as u64;

    let output_text = match llm_result {
        Ok((text, _sid, _)) => text,
        Err(e) => {
            tracing::warn!(session_id = %session_id, error = %e, "adjust_adoption_draft: LLM failed; keeping base IR");
            return Ok(AdoptionAdjustResult {
                adjusted: false,
                divergence: brief.divergence.into(),
                model: Some(brief.model.into()),
                note: Some(format!("adjustment LLM failed; base kept: {e}")),
                elapsed_ms,
            });
        }
    };

    let prose = match parse_adjusted_prose(&output_text) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(session_id = %session_id, error = %e, "adjust_adoption_draft: output parse failed; keeping base IR");
            return Ok(AdoptionAdjustResult {
                adjusted: false,
                divergence: brief.divergence.into(),
                model: Some(brief.model.into()),
                note: Some(format!("adjustment output unparseable; base kept: {e}")),
                elapsed_ms,
            });
        }
    };

    // Quality safety net: never let a collapsed/truncated adjustment replace the
    // authored base prose.
    if adjustment_prose_degraded(&base_ir, &prose.system_prompt) {
        tracing::warn!(
            session_id = %session_id,
            "adjust_adoption_draft: adjusted system_prompt drastically shorter than base; keeping base IR"
        );
        return Ok(AdoptionAdjustResult {
            adjusted: false,
            divergence: brief.divergence.into(),
            model: Some(brief.model.into()),
            note: Some("adjusted prompt too short vs authored base; base kept".into()),
            elapsed_ms,
        });
    }

    let merged = match merge_adjusted_prose(
        &base_ir,
        &prose.system_prompt,
        prose.structured_prompt.as_ref(),
    ) {
        Some(m) => m,
        None => {
            return Ok(AdoptionAdjustResult {
                adjusted: false,
                divergence: brief.divergence.into(),
                model: Some(brief.model.into()),
                note: Some("nothing to merge; base kept".into()),
                elapsed_ms,
            })
        }
    };

    crate::db::repos::core::build_sessions::update(
        &pool,
        &session_id,
        &crate::db::models::UpdateBuildSession {
            agent_ir: Some(Some(merged)),
            ..Default::default()
        },
    )?;

    tracing::info!(
        session_id = %session_id,
        divergence = brief.divergence,
        model = brief.model,
        elapsed_ms,
        "adjust_adoption_draft: specialized IR written back to session"
    );

    Ok(AdoptionAdjustResult {
        adjusted: true,
        divergence: brief.divergence.into(),
        model: Some(brief.model.into()),
        note: None,
        elapsed_ms,
    })
}

// -- Template integrity verification (reporting) ---------------------
//
// These read the compiled-in manifest and REPORT. They do not gate anything:
// the only caller (`templateCatalog.ts`) logs the batch verdict and keeps
// every template regardless. Calling this the "backend trust boundary" — as
// this section used to — overstated it; the boundary is the catalog-load
// checksum check on the TS side, which actually drops a mismatched template.
// `verify_template_integrity` (singular) and `get_template_manifest_count`
// below are additionally NOT registered in `lib.rs`, so they are unreachable
// over IPC today.

/// Input for batch template verification.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVerifyEntry {
    pub path: String,
    pub content: String,
}

/// Verify a batch of templates against the embedded Rust manifest.
/// Called during catalog initialization. The (path, whole-file) pairs it
/// receives match how the manifest was generated, so the verdict is
/// meaningful — but its caller only logs it, so this detects tampering
/// rather than preventing it.
#[tauri::command]
pub fn verify_template_integrity_batch(
    state: State<'_, Arc<AppState>>,
    templates: Vec<TemplateVerifyEntry>,
) -> Result<crate::engine::template_checksums::BatchIntegrityResult, AppError> {
    require_auth_sync(&state)?;
    let pairs: Vec<(String, String)> = templates.into_iter().map(|t| (t.path, t.content)).collect();
    Ok(crate::engine::template_checksums::verify_templates_batch(
        &pairs,
    ))
}

/// Synthesize a readable `system_prompt` markdown body from a v3 template's
/// `persona` block. The runner prefers `structured_prompt` when present, so
/// this fallback only surfaces when the editor renders the plain-text
/// system_prompt panel — but having something there is the difference
/// between "looks like an adopted persona" and "looks like an empty draft
/// from the Glyph from-scratch flow". Returns `None` when there's no
/// persona block to render (caller falls back to the historical default).
fn synthesize_system_prompt_markdown(design: &serde_json::Value) -> Option<String> {
    let persona = design.get("persona")?.as_object()?;
    let mut out = String::new();

    if let Some(id_obj) = persona.get("identity").and_then(|v| v.as_object()) {
        let role = id_obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let desc = id_obj
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !role.is_empty() {
            out.push_str("You are ");
            out.push_str(role);
            out.push('.');
        }
        if !desc.is_empty() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(desc);
        }
    }

    if let Some(goal) = persona.get("goal").and_then(|v| v.as_str()) {
        if !goal.is_empty() {
            out.push_str("\n\n## Goal\n");
            out.push_str(goal);
        }
    }

    if let Some(voice) = persona.get("voice").and_then(|v| v.as_object()) {
        let style = voice.get("style").and_then(|v| v.as_str()).unwrap_or("");
        let fmt = voice
            .get("output_format")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !style.is_empty() || !fmt.is_empty() {
            out.push_str("\n\n## Voice\n");
            if !style.is_empty() {
                out.push_str(style);
                out.push('\n');
            }
            if !fmt.is_empty() {
                out.push_str(fmt);
            }
        }
    }

    let render_list = |key: &str, header: &str, out: &mut String| {
        if let Some(arr) = persona.get(key).and_then(|v| v.as_array()) {
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
    render_list("principles", "Principles", &mut out);
    render_list("constraints", "Constraints", &mut out);
    render_list("decision_principles", "Decision principles", &mut out);

    if let Some(ops) = persona
        .get("operating_instructions")
        .and_then(|v| v.as_str())
    {
        if !ops.is_empty() {
            out.push_str("\n\n## Operating instructions\n");
            out.push_str(ops);
        }
    }

    if out.trim().is_empty() {
        None
    } else {
        Some(out)
    }
}

// ============================================================================
// Charter mint — Stage B WP4 (agent-manifest rebase)
// ============================================================================
//
// The adoption cutover: adopted/promoted capabilities become
// `persona_responsibilities` rows (charters) minted through the ONE engine
// door (`personas_engine::responsibility::create_from_input`, which stamps
// `source = 'operator'` — instant adopt and Glyph promote are both
// operator-initiated). `design_context.useCases` is no longer written by
// either path; it survives only on pre-e19 rows (until their one-way
// migration mint runs), on dry-run simulation snapshots
// (`build_simulate::build_simulation_design_context`, restored after the
// run), and on the catalog per-recipe adoption path
// (`useAdoption.ts` → `mutateUseCases`) which a later UI WP re-anchors.

/// Map one use-case-shaped JSON value into the charter create input.
///
/// Two input shapes, detected structurally:
/// - **v2 responsibility payload** (transformed recipe seeds — has a
///   `procedure` string): deserialized directly; the camelCase keys mirror
///   `CreatePersonaResponsibilityInput`.
/// - **legacy use case** (LLM-built IR entries, v1 recipe rows on existing
///   installs, hand-authored design contexts): mapped field-by-field with
///   full preservation into the charter shape — including `review`-adjacent
///   `memory_policy` and structured `error_policy`, which the old instant-
///   adopt mapper dropped and only the promote path preserved (the write
///   asymmetry this cutover kills).
///
/// `spec.migrated_from_use_case_id` is stamped with the use case's id in both
/// shapes: it is the provenance pointer trigger/subscription rows resolve
/// through (e19's remap contract), and the marker `retire_use_case_born_charters`
/// keys on so a re-promote replaces its own prior mint without ever touching
/// hand-authored charters.
///
/// Keys with no `ResponsibilitySpec` slot yet (`review_policy`,
/// `generation_settings`, `model_rationale`, `tool_hints`, prose
/// `error_handling`) do not survive the mint — they remain readable in
/// `last_design_result` / the recipe row. See the WP4 report; adding slots is
/// a `personas-core` change outside this file's walls.
pub(crate) fn map_use_case_to_charter_input(
    persona_id: &str,
    uc: &serde_json::Value,
) -> crate::db::models::CreatePersonaResponsibilityInput {
    use crate::db::models::CreatePersonaResponsibilityInput;

    let uc_id = uc.get("id").and_then(|v| v.as_str()).map(str::to_string);

    // v2 payload: inject personaId and let serde do the field mapping.
    // A v2 blob that fails to deserialize falls through to the legacy
    // mapper, which still yields a valid (if sparser) charter.
    if uc.get("procedure").map(|p| p.is_string()).unwrap_or(false) {
        let mut with_pid = uc.clone();
        if let Some(obj) = with_pid.as_object_mut() {
            obj.insert(
                "personaId".to_string(),
                serde_json::Value::String(persona_id.to_string()),
            );
        }
        match serde_json::from_value::<CreatePersonaResponsibilityInput>(with_pid) {
            Ok(mut input) => {
                if input.spec.migrated_from_use_case_id.is_none() {
                    input.spec.migrated_from_use_case_id = uc_id;
                }
                // Blank connector entries fail charter validation; a seed
                // must degrade to "whatever the persona holds", not refuse.
                input.connectors.retain(|c| !c.trim().is_empty());
                return input;
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "charter mint: v2 payload failed typed deserialization — using the legacy mapper"
                );
            }
        }
    }

    let str_of = |key: &str| uc.get(key).and_then(|v| v.as_str()).map(str::to_string);
    let non_null = |key: &str| uc.get(key).filter(|v| !v.is_null()).cloned();

    let title = str_of("title")
        .or_else(|| str_of("name"))
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| "Untitled capability".to_string());

    // Procedure: the curated one-liner first, the long description appended,
    // and the prose error-handling doctrine (structured `error_policy` maps
    // to the typed spec field instead) folded in so it keeps steering runs.
    let mut procedure_parts: Vec<String> = Vec::new();
    if let Some(s) = str_of("capability_summary").filter(|s| !s.trim().is_empty()) {
        procedure_parts.push(s);
    }
    if let Some(s) = str_of("description").filter(|s| !s.trim().is_empty()) {
        procedure_parts.push(s);
    }
    if uc.get("error_policy").and_then(|v| v.as_object()).is_none() {
        if let Some(s) = str_of("error_handling").filter(|s| !s.trim().is_empty()) {
            procedure_parts.push(format!("Error handling: {s}"));
        }
    }
    let procedure = procedure_parts.join("\n\n");

    let connectors: Vec<String> = uc
        .get("connectors")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    c.as_str()
                        .map(str::to_string)
                        .or_else(|| c.get("name").and_then(|n| n.as_str()).map(str::to_string))
                })
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    // Runtime toggle parity: a capability shipped disabled becomes a
    // suspended charter, not an active one.
    let status = match uc.get("enabled").and_then(|v| v.as_bool()) {
        Some(false) => Some("suspended".to_string()),
        _ => None,
    };

    // model_override may be a plain tier string OR a ModelProfile object;
    // the spec pin is a string, so an object contributes its `model` field
    // (or its compact JSON as a last resort — provenance beats loss).
    let model_override = uc.get("model_override").and_then(|v| match v {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        serde_json::Value::Object(o) => o
            .get("model")
            .and_then(|m| m.as_str())
            .map(str::to_string)
            .or_else(|| serde_json::to_string(v).ok()),
        _ => None,
    });

    let notification_channels: Option<Vec<String>> = uc
        .get("notification_channels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    c.as_str()
                        .map(str::to_string)
                        .or_else(|| c.get("type").and_then(|t| t.as_str()).map(str::to_string))
                })
                .filter(|s| !s.trim().is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|v| !v.is_empty());

    // Structured error policy — lenient manual read: the frontend wire shape
    // is snake_case (`escalate_after`), a v2 spec would be camelCase, and a
    // typed serde parse would silently drop the mismatched casing.
    let error_policy = uc.get("error_policy").and_then(|v| v.as_object()).map(|o| {
        crate::db::models::ResponsibilityErrorPolicy {
            incident: o.get("incident").and_then(|b| b.as_bool()),
            lab: o.get("lab").and_then(|b| b.as_bool()),
            escalate_after: o
                .get("escalate_after")
                .or_else(|| o.get("escalateAfter"))
                .and_then(|n| n.as_i64()),
        }
    });

    let spec = crate::db::models::ResponsibilitySpec {
        input_schema: non_null("input_schema"),
        sample_input: non_null("sample_input"),
        model_override,
        engine_mode: str_of("execution_mode"),
        notification_channels,
        event_subscriptions: non_null("event_subscriptions"),
        error_policy,
        time_filter: non_null("time_filter"),
        test_fixtures: non_null("test_fixtures"),
        source_recipe_id: str_of("source_recipe_id"),
        source_recipe_version: str_of("source_recipe_version"),
        migrated_from_use_case_id: uc_id,
        memory_policy: non_null("memory_policy"),
        suggested_trigger: non_null("suggested_trigger"),
        // Carried, not dropped. A charter minted here has no use case behind
        // it, so anything the prompt path cannot read off `spec` is simply
        // gone — and `review_policy` decides whether outputs reach a human
        // queue. Losing these silently is the defect the legacy
        // `DesignUseCase` struct shipped for years; both key spellings are
        // read because the seed corpus is camelCase and the frontend wire is
        // snake_case.
        review_policy: non_null("review_policy").or_else(|| non_null("reviewPolicy")),
        generation_settings: non_null("generation_settings")
            .or_else(|| non_null("generationSettings")),
        error_handling: str_of("error_handling").or_else(|| str_of("errorHandling")),
        tool_hints: uc
            .get("tool_hints")
            .or_else(|| uc.get("toolHints"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_str().map(str::to_string))
                    .filter(|s| !s.trim().is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty()),
        model_rationale: str_of("model_rationale").or_else(|| str_of("modelRationale")),
        use_case_flow: non_null("use_case_flow").or_else(|| non_null("useCaseFlow")),
        enabled_by_default: uc
            .get("enabled_by_default")
            .or_else(|| uc.get("enabledByDefault"))
            .and_then(|v| v.as_bool()),
    };

    CreatePersonaResponsibilityInput {
        persona_id: persona_id.to_string(),
        title,
        domain: str_of("category").filter(|c| !c.trim().is_empty()),
        outcomes: Vec::new(),
        objectives: Vec::new(),
        scope_rung: 0,
        refusal_classes: Vec::new(),
        approval_gates: Vec::new(),
        owner: String::new(),
        cadence: cadence_hint_from_trigger(uc.get("suggested_trigger")),
        budget_monthly_usd: None,
        tenure: Default::default(),
        status,
        project_id: None,
        connectors,
        procedure,
        spec,
    }
}

/// Best-effort cadence hint from a legacy `suggested_trigger`. Attention
/// stays OFF — minting a charter must not silently enrol the persona in the
/// attention loop (WP1 posture; the loop ships in WP5). `interval_minutes`
/// is derived only from cron patterns whose meaning is unambiguous (every-N
/// minutes / hourly / daily / weekly); everything else carries no interval —
/// the verbatim trigger survives at `spec.suggested_trigger` regardless.
/// Mirrors `deriveCadence` in
/// `scripts/templates/transform-recipes-to-responsibilities.mjs`.
fn cadence_hint_from_trigger(
    trigger: Option<&serde_json::Value>,
) -> crate::db::models::ResponsibilityCadence {
    let mut cadence = crate::db::models::ResponsibilityCadence::default();
    let Some(t) = trigger.filter(|v| v.is_object()) else {
        return cadence;
    };
    let kind = t
        .get("trigger_type")
        .or_else(|| t.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if kind != "schedule" && kind != "polling" {
        return cadence;
    }
    let cron = t
        .pointer("/config/cron")
        .or_else(|| t.get("cron"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let parts: Vec<&str> = cron.split_whitespace().collect();
    if parts.len() != 5 {
        return cadence;
    }
    let is_num = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    let is_num_list = |s: &str| !s.is_empty() && s.split(',').all(is_num);
    let (min, hour, dom, mon, dow) = (parts[0], parts[1], parts[2], parts[3], parts[4]);
    let every_n = min
        .strip_prefix("*/")
        .filter(|n| is_num(n))
        .and_then(|n| n.parse::<i64>().ok());
    cadence.interval_minutes = match (every_n, hour, dom, mon, dow) {
        (Some(n), "*", "*", "*", "*") => Some(n),
        (None, "*", "*", "*", "*") if is_num(min) => Some(60),
        (None, h, "*", "*", "*") if is_num(min) && is_num_list(h) => Some(1440),
        (None, h, "*", "*", d) if is_num(min) && is_num_list(h) && is_num_list(d) => Some(10080),
        _ => None,
    };
    cadence
}

/// Mint one charter per use-case-shaped entry through the engine's operator
/// door, in order. All-or-nothing: a mid-list failure deletes the charters
/// this call already minted (raw best-effort delete — the rows never existed
/// publicly) and returns the error, so a caller never sees a half-minted
/// roster reported as success.
pub(crate) fn mint_charters_from_use_cases(
    pool: &crate::db::DbPool,
    persona_id: &str,
    use_cases: &[serde_json::Value],
) -> Result<Vec<crate::db::models::PersonaResponsibility>, AppError> {
    let mut minted: Vec<crate::db::models::PersonaResponsibility> = Vec::new();
    for uc in use_cases {
        let input = map_use_case_to_charter_input(persona_id, uc);
        match personas_engine::responsibility::create_from_input(pool, &input) {
            Ok(row) => minted.push(row),
            Err(e) => {
                let ids: Vec<String> = minted.iter().map(|r| r.id.clone()).collect();
                delete_charter_rows(pool, &ids);
                return Err(AppError::Validation(format!(
                    "charter mint failed for capability '{}': {e}",
                    input.title
                )));
            }
        }
    }
    Ok(minted)
}

/// Best-effort hard delete of freshly minted charter rows — the rollback for
/// `mint_charters_from_use_cases` / a failed promote transaction. Only ever
/// called with ids minted moments earlier in the same operation; established
/// charters are retired through the status door, never deleted.
pub(crate) fn delete_charter_rows(pool: &crate::db::DbPool, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let Ok(conn) = pool.get() else {
        tracing::warn!("charter rollback: pool checkout failed; rows left for manual cleanup");
        return;
    };
    for id in ids {
        if let Err(e) = conn.execute(
            "DELETE FROM persona_responsibilities WHERE id = ?1",
            rusqlite::params![id],
        ) {
            tracing::warn!(charter_id = %id, error = %e, "charter rollback delete failed");
        }
    }
}

/// Retire (never delete) the persona's ACTIVE use-case-born charters — the
/// ones carrying `spec.migrated_from_use_case_id`, i.e. minted from a design
/// use case by adopt/promote/e19-migration. A re-promote calls this after its
/// new mint commits, mirroring the wholesale `design_context.useCases`
/// overwrite the legacy path did — while hand-authored charters (Life tab,
/// kp-hire) never carry the marker and are never touched. Best-effort: a
/// failure leaves a superseded charter visibly active, which the operator can
/// retire by hand; it must not unwind an otherwise-committed promote.
pub(crate) fn retire_use_case_born_charters(
    pool: &crate::db::DbPool,
    persona_id: &str,
    keep_ids: &std::collections::HashSet<String>,
) {
    let rows =
        match crate::db::repos::core::responsibilities::list_by_persona(pool, persona_id, false) {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(persona_id, error = %e, "charter retire sweep: list failed");
                return;
            }
        };
    for row in rows {
        if keep_ids.contains(&row.id) || row.spec.migrated_from_use_case_id.is_none() {
            continue;
        }
        if let Err(e) = crate::db::repos::core::responsibilities::set_status(
            pool,
            &row.id,
            crate::db::models::ResponsibilityStatus::Retired,
        ) {
            tracing::warn!(charter_id = %row.id, error = %e, "charter retire sweep: set_status failed");
        }
    }
}

#[cfg(test)]
mod charter_mint_tests {
    use super::{cadence_hint_from_trigger, map_use_case_to_charter_input};
    use serde_json::json;

    #[test]
    fn legacy_use_case_maps_with_full_field_preservation() {
        let uc = json!({
            "id": "uc_triage",
            "title": "Triage",
            "description": "Sort the inbox.",
            "capability_summary": "Label triage on new mail.",
            "category": "workflow",
            "execution_mode": "e2e",
            "connectors": ["email", {"name": "slack"}, "  "],
            "notification_channels": [{"type": "slack", "description": "alerts"}],
            "event_subscriptions": [{"event_type": "mail.received", "direction": "listen"}],
            "error_handling": "Retry once, then flag.",
            "memory_policy": {"enabled": true, "context": "sender stats"},
            "model_override": "haiku",
            "input_schema": [{"name": "window_hours", "type": "number"}],
            "sample_input": {"window_hours": 24},
            "test_fixtures": [{"input": {"window_hours": 2}}],
            "source_recipe_id": "recipe-1",
            "source_recipe_version": "1.0.0",
            "suggested_trigger": {"trigger_type": "polling", "config": {"cron": "*/10 * * * *"}},
        });
        let input = map_use_case_to_charter_input("persona-1", &uc);
        assert_eq!(input.persona_id, "persona-1");
        assert_eq!(input.title, "Triage");
        assert_eq!(input.domain.as_deref(), Some("workflow"));
        assert_eq!(input.connectors, vec!["email", "slack"]);
        assert!(input.procedure.starts_with("Label triage on new mail."));
        assert!(input.procedure.contains("Sort the inbox."));
        assert!(
            input
                .procedure
                .contains("Error handling: Retry once, then flag."),
            "prose error handling folds into the procedure"
        );
        assert!(
            !input.cadence.attention_enabled,
            "attention stays OFF at mint"
        );
        assert_eq!(input.cadence.interval_minutes, Some(10));
        assert_eq!(input.spec.engine_mode.as_deref(), Some("e2e"));
        assert_eq!(input.spec.model_override.as_deref(), Some("haiku"));
        assert_eq!(
            input.spec.notification_channels.as_deref(),
            Some(&["slack".to_string()][..])
        );
        assert_eq!(input.spec.source_recipe_id.as_deref(), Some("recipe-1"));
        assert_eq!(
            input.spec.migrated_from_use_case_id.as_deref(),
            Some("uc_triage"),
            "provenance pointer stamped for trigger remap + re-promote sweep"
        );
        assert!(
            input.spec.memory_policy.is_some(),
            "memory policy preserved"
        );
        assert!(input.spec.event_subscriptions.is_some());
        assert!(input.spec.test_fixtures.is_some());
        assert!(input.status.is_none(), "enabled-by-default → active");
    }

    #[test]
    fn structured_error_policy_maps_typed_and_skips_the_prose_fold() {
        let uc = json!({
            "id": "uc_x",
            "title": "X",
            "description": "Do X.",
            "error_policy": {"incident": true, "lab": false, "escalate_after": 3},
            "error_handling": "legacy prose that must not double-land",
        });
        let input = map_use_case_to_charter_input("p", &uc);
        let policy = input.spec.error_policy.expect("typed policy mapped");
        assert_eq!(policy.incident, Some(true));
        assert_eq!(policy.lab, Some(false));
        assert_eq!(policy.escalate_after, Some(3));
        assert!(
            !input.procedure.contains("legacy prose"),
            "structured policy wins; prose is not folded on top"
        );
    }

    #[test]
    fn v2_payload_deserializes_directly() {
        // The transformed recipe-seed shape (camelCase, procedure + spec).
        let uc = json!({
            "id": "uc_report",
            "title": "Weekly Report",
            "domain": "reporting",
            "outcomes": [],
            "procedure": "Screen the sector weekly.\n\nLong description.",
            "connectors": ["spreadsheet"],
            "cadence": {"attentionEnabled": false, "intervalMinutes": 1440},
            "approvalGates": [],
            "spec": {
                "engineMode": "e2e",
                "modelOverride": "haiku",
                "sourceRecipeId": "recipe-9",
                "sourceRecipeVersion": "1.0.0",
                "errorHandling": "prose kept in the seed, no typed slot yet"
            }
        });
        let input = map_use_case_to_charter_input("p2", &uc);
        assert_eq!(input.persona_id, "p2");
        assert_eq!(input.title, "Weekly Report");
        assert_eq!(input.domain.as_deref(), Some("reporting"));
        assert_eq!(
            input.procedure,
            "Screen the sector weekly.\n\nLong description."
        );
        assert_eq!(input.connectors, vec!["spreadsheet"]);
        assert_eq!(input.cadence.interval_minutes, Some(1440));
        assert_eq!(input.spec.model_override.as_deref(), Some("haiku"));
        assert_eq!(input.spec.source_recipe_id.as_deref(), Some("recipe-9"));
        assert_eq!(
            input.spec.migrated_from_use_case_id.as_deref(),
            Some("uc_report"),
            "the mint stamps provenance even on v2 payloads"
        );
    }

    #[test]
    fn disabled_capability_mints_a_suspended_charter() {
        let uc = json!({"id": "uc_off", "title": "Off", "description": "d", "enabled": false});
        let input = map_use_case_to_charter_input("p", &uc);
        assert_eq!(input.status.as_deref(), Some("suspended"));
    }

    #[test]
    fn model_profile_object_contributes_its_model_string() {
        // The id is deliberately NOT a real `claude-*` string: this asserts
        // that the object's `model` FIELD is what reaches the spec, and
        // pinning a dated vendor id in a fixture that does not care about it
        // is how a test rots (census `bare-model-id-literal`).
        let uc = json!({
            "id": "uc_m", "title": "M", "description": "d",
            "model_override": {"model": "tier-from-profile-object"}
        });
        let input = map_use_case_to_charter_input("p", &uc);
        assert_eq!(
            input.spec.model_override.as_deref(),
            Some("tier-from-profile-object")
        );
    }

    #[test]
    fn cadence_hints_cover_the_unambiguous_cron_family() {
        let hint = |cron: &str| {
            cadence_hint_from_trigger(Some(&json!({
                "trigger_type": "schedule", "config": {"cron": cron}
            })))
            .interval_minutes
        };
        assert_eq!(hint("*/10 * * * *"), Some(10));
        assert_eq!(hint("15 * * * *"), Some(60));
        assert_eq!(hint("0 18 * * *"), Some(1440));
        assert_eq!(hint("0 9 * * 1"), Some(10080));
        assert_eq!(hint("0 9 1 * *"), None, "monthly is not guessed");
        assert_eq!(hint("bogus"), None);
        assert!(
            cadence_hint_from_trigger(Some(&json!({"trigger_type": "webhook"})))
                .interval_minutes
                .is_none()
        );
    }
}

#[cfg(test)]
mod adoption_adjust_tests {
    use super::{
        adjustment_prose_degraded, assess_adjustment, merge_adjusted_prose,
        persona_has_opus_capability,
    };
    use crate::engine::adoption_answers::AdoptionAnswers;
    use serde_json::json;
    use std::collections::HashMap;

    fn empty_answers() -> AdoptionAnswers {
        AdoptionAnswers {
            answers: HashMap::new(),
            questions: vec![],
            credential_bindings: HashMap::new(),
        }
    }

    #[test]
    fn divergence_default_when_no_answers_or_bindings() {
        let a = empty_answers();
        let brief = assess_adjustment("{}", Some(&a));
        assert_eq!(brief.divergence, "default");
        assert_eq!(
            brief.model, "haiku",
            "absolute-default → light Haiku wire pass"
        );
        // None answers also → default
        assert_eq!(assess_adjustment("{}", None).divergence, "default");
    }

    #[test]
    fn divergence_configured_with_answers_or_bindings() {
        let mut a = empty_answers();
        a.answers.insert("q1".into(), "value".into());
        let brief = assess_adjustment("{}", Some(&a));
        assert_eq!(brief.divergence, "configured");
        assert_eq!(
            brief.model, "sonnet",
            "configured + non-opus persona → Sonnet"
        );
        assert!(brief.user_answers_json.is_some());

        let mut b = empty_answers();
        b.credential_bindings.insert("email".into(), "gmail".into());
        let brief_b = assess_adjustment("{}", Some(&b));
        assert_eq!(brief_b.divergence, "configured");
        assert!(
            brief_b.connector_swaps_json.is_some(),
            "bindings feed connector_swaps"
        );
    }

    #[test]
    fn configured_escalates_to_opus_for_opus_tier_persona() {
        let base = json!({
            "use_cases": [
                {"id": "uc_a", "model_override": "sonnet"},
                {"id": "uc_b", "model_override": "opus"}
            ]
        })
        .to_string();
        assert!(persona_has_opus_capability(&base));
        let mut a = empty_answers();
        a.answers.insert("q1".into(), "v".into());
        let brief = assess_adjustment(&base, Some(&a));
        assert_eq!(brief.divergence, "configured");
        assert_eq!(
            brief.model, "opus",
            "opus-tier persona + divergence → Opus adjustment"
        );

        // No opus capability → stays Sonnet
        let base2 = json!({"use_cases": [{"id": "uc_a", "model_override": "haiku"}]}).to_string();
        assert!(!persona_has_opus_capability(&base2));
        assert_eq!(assess_adjustment(&base2, Some(&a)).model, "sonnet");
    }

    #[test]
    fn degradation_guard_flags_collapsed_prompt() {
        let long = "x".repeat(1000);
        let base = json!({"system_prompt": long}).to_string();
        // A 100-char output vs a 1000-char base → degraded (< 40%).
        assert!(adjustment_prose_degraded(&base, &"y".repeat(100)));
        // A 900-char output → acceptable restructuring, not degraded.
        assert!(!adjustment_prose_degraded(&base, &"y".repeat(900)));
        // Empty output is handled upstream (merge keeps base), not flagged here.
        assert!(!adjustment_prose_degraded(&base, "   "));
        // Tiny base prompts are not guarded.
        let tiny = json!({"system_prompt": "short"}).to_string();
        assert!(!adjustment_prose_degraded(&tiny, "y"));
    }

    #[test]
    fn merge_replaces_prose_preserves_structure() {
        let base = json!({
            "name": "Base",
            "system_prompt": "OLD",
            "full_prompt_markdown": "OLD",
            "structured_prompt": {"identity": "old"},
            "use_cases": [{"id": "uc_1"}],
            "triggers": [{"trigger_type": "manual"}]
        })
        .to_string();
        let structured = json!({"identity": "new", "instructions": "do x"});
        let merged =
            merge_adjusted_prose(&base, "NEW PROMPT", Some(&structured)).expect("merge ok");
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        // prose specialized
        assert_eq!(v["system_prompt"], "NEW PROMPT");
        assert_eq!(
            v["full_prompt_markdown"], "NEW PROMPT",
            "full_prompt_markdown synced"
        );
        assert_eq!(v["structured_prompt"]["identity"], "new");
        assert_eq!(v["structured_prompt"]["instructions"], "do x");
        // deterministic structure preserved untouched
        assert_eq!(v["use_cases"][0]["id"], "uc_1");
        assert_eq!(v["triggers"][0]["trigger_type"], "manual");
        assert_eq!(v["name"], "Base");
    }

    #[test]
    fn merge_keeps_base_prompt_when_draft_prompt_blank() {
        let base = json!({"system_prompt": "OLD", "use_cases": []}).to_string();
        let merged = merge_adjusted_prose(&base, "   ", None).expect("merge ok");
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(
            v["system_prompt"], "OLD",
            "blank draft prompt must not clobber base"
        );
    }
}
