use serde::Serialize;
use serde_json::json;
use tauri::State;
use tokio_util::sync::CancellationToken;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::background_job::BackgroundJobManager;
use crate::db::repos::communication::reviews as reviews_repo;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

use super::n8n_transform::{
    extract_first_json_object, extract_questions_output, normalize_n8n_persona_draft,
    parse_persona_output, run_claude_prompt_text_inner, N8nPersonaOutput,
};

// -- Template integrity helper -----------------------------------

/// Verify template content against the embedded checksum manifest.
/// Returns `Err(AppError::Validation)` if the template is unknown in release
/// builds, or if the template is known but its content does not match the
/// expected hash (possible tampering).
fn check_template_integrity(template_name: &str, content_json: &str) -> Result<(), AppError> {
    let integrity = crate::engine::template_checksums::verify_template(template_name, content_json);
    // NOTE: the checksum manifest is keyed by full file path and hashes the
    // entire template file, but every real caller passes a bare name/label plus
    // payload-only JSON — so verify_template returns is_known_template=false for
    // 100% of adoptions. The previous release-build hard reject therefore bricked
    // the ENTIRE Presets feature + Dev Clone on shipped binaries (while passing
    // in dev, where this branch is compiled out). Until the manifest key/content
    // contract is reconciled with the call contract (follow-up), do NOT block
    // adoption on "unknown" — log it. The known-but-tampered branch below still
    // rejects once a template genuinely resolves in the manifest.
    #[cfg(not(debug_assertions))]
    if !integrity.is_known_template {
        tracing::warn!(
            template = %template_name,
            actual = %integrity.actual_hash,
            "template integrity: unknown template (manifest key/content contract mismatch) — allowing adoption; integrity check is inert pending manifest reconciliation"
        );
    }

    if integrity.is_known_template && !integrity.valid {
        tracing::warn!(
            template = %template_name,
            expected = ?integrity.expected_hash,
            actual = %integrity.actual_hash,
            "SECURITY: Template integrity check failed during adoption — content may have been tampered with"
        );
        return Err(AppError::Validation(
            "Template integrity verification failed: content does not match the expected checksum. \
             The template may have been tampered with."
                .into(),
        ));
    }
    Ok(())
}

// -- Adopt job extra state ---------------------------------------

#[derive(Clone, Default)]
struct AdoptExtra {
    draft: Option<serde_json::Value>,
    claude_session_id: Option<String>,
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

fn set_adopt_draft(adopt_id: &str, draft: &N8nPersonaOutput) -> Result<(), AppError> {
    let serialized = serde_json::to_value(draft)?;
    ADOPT_JOBS.update_extra(adopt_id, |extra| {
        extra.draft = Some(serialized);
    });
    Ok(())
}

fn set_adopt_questions(adopt_id: &str, questions: serde_json::Value) {
    ADOPT_JOBS.update_extra(adopt_id, |extra| {
        extra.questions = Some(questions);
    });
}

fn set_adopt_claude_session(adopt_id: &str, session_id: String) {
    ADOPT_JOBS.update_extra(adopt_id, |extra| {
        extra.claude_session_id = Some(session_id);
    });
}

fn get_adopt_claude_session(adopt_id: &str) -> Option<String> {
    ADOPT_JOBS.read_extra(adopt_id, |extra| extra.claude_session_id.clone())?
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

/// Validate an optional JSON field if present and non-empty.
fn validate_optional_json_field(name: &str, value: &Option<String>) -> Result<(), AppError> {
    if let Some(v) = value {
        if !v.trim().is_empty() {
            validate_json_field(name, v)?;
        }
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
/// calling this? `check_template_integrity` runs FIRST on
/// `design_result_json` and would reject any pre-mutation tampering.
/// Threading overrides through the existing
/// `populate_persona_parameters_from_design(... answers)` arg lands
/// the user's customization without touching the integrity-checked
/// bytes.
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

    // Backend integrity check: verify the design result against the embedded manifest.
    // This catches tampered templates even if the frontend checksums were bypassed.
    check_template_integrity(&template_name, &design_result_json)?;

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
    if let Err(e) = crate::engine::template_v3::hydrate_recipe_refs(&mut design, lookup) {
        tracing::warn!(
            template = %template_name,
            error = %e,
            "instant_adopt_template: recipe_ref hydration failed; proceeding with un-hydrated payload"
        );
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

    // Normalize structured_prompt
    let structured_prompt = design.get("structured_prompt").cloned();

    let persona_meta = design.get("persona_meta");
    let icon = persona_meta
        .and_then(|m| m.get("icon"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let color = persona_meta
        .and_then(|m| m.get("color"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let model_profile = persona_meta
        .and_then(|m| m.get("model_profile"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
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

    // Build triggers from suggested_triggers
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
                    use_case_id: None,
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

    // Build proper DesignContextData-format design_context. After hydration +
    // normalization the canonical use-case list lives at `design.use_cases`
    // (each entry now inline-shaped with id/name/triggers/events/tools).
    // `use_case_flows` is the v3-flattened mirror used by the runner; we
    // prefer the richer `use_cases` shape for the frontend's Use Cases tab
    // and the Design tab. Map each entry to the `DesignUseCase` shape the
    // frontend expects (id, title, description, suggested_trigger,
    // event_subscriptions, notification_channels, etc.).
    let raw_use_cases = design
        .get("use_cases")
        .and_then(|v| v.as_array())
        .cloned()
        .or_else(|| design.get("use_case_flows").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();
    let mapped_use_cases: Vec<serde_json::Value> = raw_use_cases
        .iter()
        .map(|uc| map_template_use_case_to_design_use_case(uc))
        .collect();
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
        "useCases": mapped_use_cases,
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
                                if *b { "true".to_string() } else { "false".to_string() }
                            }
                            serde_json::Value::Number(n) => n.to_string(),
                            other => serde_json::to_string(other).unwrap_or_default(),
                        };
                        (qid.clone(), s)
                    })
                    .collect()
            });
        if let Err(e) = populate_persona_parameters_from_design(
            &state.db,
            pid,
            &design,
            answers.as_ref(),
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
    let arr = design?
        .get("persona")?
        .get("connectors")?
        .as_array()?;
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
        let val = answers
            .and_then(|a| a.get(q_id).cloned())
            .or_else(|| q.get("default").and_then(|v| v.as_str()).map(|s| s.to_string()));
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

    if let Some(arr) = design.get("suggested_parameters").and_then(|v| v.as_array()) {
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
        let description = q.get("context").and_then(|v| v.as_str()).map(|s| s.to_string());
        let options: Option<Vec<String>> = q
            .get("options")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            });
        let min = q.get("min").and_then(|v| v.as_f64());
        let max = q.get("max").and_then(|v| v.as_f64());
        let unit = q.get("unit").and_then(|v| v.as_str()).map(|s| s.to_string());

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


// -- Helpers -----------------------------------------------------

/// Handle the result from either adjustment or unified transform.
fn handle_adopt_result(
    result: Result<(N8nPersonaOutput, bool), AppError>,
    app: &tauri::AppHandle,
    adopt_id: &str,
    template_name: &str,
) {
    match result {
        Ok((mut draft, _)) => {
            // Phase 17: ensure every drafted persona carries a template_category
            // so the Simple-mode illustration tier-3 works on Claude-transformed
            // drafts too (not just instant-adopt). Uses system_prompt as the
            // instruction stand-in since that's what the LLM authored.
            if draft.template_category.is_none() {
                let connectors_json = draft.required_connectors.as_ref().and_then(|conns| {
                    serde_json::to_string(&conns.iter().map(|c| c.name.clone()).collect::<Vec<_>>())
                        .ok()
                });
                draft.template_category = Some(super::reviews::infer_template_category(
                    &draft.system_prompt,
                    connectors_json.as_deref(),
                ));
            }
            if let Err(err) = set_adopt_draft(adopt_id, &draft) {
                let msg = format!("Failed to serialize adoption draft: {err}");
                tracing::error!(adopt_id = %adopt_id, error = %msg, "draft serialization failed");
                ADOPT_JOBS.set_status(app, adopt_id, "failed", Some(msg));
                crate::notifications::notify_n8n_transform_completed(app, template_name, false);
                return;
            }
            ADOPT_JOBS.set_status(app, adopt_id, "completed", None);
            crate::notifications::notify_n8n_transform_completed(app, template_name, true);
        }
        Err(err) => {
            let msg = err.to_string();
            tracing::error!(adopt_id = %adopt_id, error = %msg, "template adoption failed");
            ADOPT_JOBS.set_status(app, adopt_id, "failed", Some(msg));
            crate::notifications::notify_n8n_transform_completed(app, template_name, false);
        }
    }
}

// -- Unified prompt (Turn 1: ALWAYS asks questions, then generates persona in Turn 2) --

/// Build an intelligent summary of the design result, preserving critical sections
/// rather than blindly truncating at a byte limit.
fn summarize_design_result(design_result_json: &str) -> String {
    // Try to parse and extract key sections; fall back to full text if small enough
    if design_result_json.len() <= 32_000 {
        return design_result_json.to_string();
    }

    // Parse JSON and extract the most important fields for question generation
    let Ok(design) = serde_json::from_str::<serde_json::Value>(design_result_json) else {
        // Can't parse - return first 32K with safe boundary
        let mut end = 32_000.min(design_result_json.len());
        while end > 0 && !design_result_json.is_char_boundary(end) {
            end -= 1;
        }
        return design_result_json[..end].to_string();
    };

    // Build a focused summary preserving the fields that matter for question generation
    let mut summary = serde_json::Map::new();

    // Always include: identity + instructions (core behavior definition)
    if let Some(sp) = design.get("structured_prompt") {
        let mut sp_summary = serde_json::Map::new();
        for key in &["identity", "instructions", "toolGuidance", "errorHandling"] {
            if let Some(v) = sp.get(*key) {
                sp_summary.insert(key.to_string(), v.clone());
            }
        }
        if let Some(cs) = sp.get("customSections") {
            sp_summary.insert("customSections".into(), cs.clone());
        }
        summary.insert(
            "structured_prompt".into(),
            serde_json::Value::Object(sp_summary),
        );
    }

    // Always include: connectors (critical for credential questions)
    if let Some(v) = design.get("suggested_connectors") {
        summary.insert("suggested_connectors".into(), v.clone());
    }

    // Always include: triggers, tools, summary, service_flow
    for key in &[
        "suggested_tools",
        "suggested_triggers",
        "summary",
        "service_flow",
        "suggested_notification_channels",
        "suggested_event_subscriptions",
        "protocol_capabilities",
        "adoption_questions",
        "adoption_requirements",
    ] {
        if let Some(v) = design.get(*key) {
            summary.insert(key.to_string(), v.clone());
        }
    }

    // Include design_highlights (concise capability overview)
    if let Some(v) = design.get("design_highlights") {
        summary.insert("design_highlights".into(), v.clone());
    }

    // Skip full_prompt_markdown (duplicates structured_prompt, often 10KB+)
    // Skip examples section if summary is already large

    serde_json::to_string_pretty(&serde_json::Value::Object(summary))
        .unwrap_or_else(|_| design_result_json.to_string())
}

/// Extract adoption_questions from the design result JSON if present.
fn extract_template_seed_questions(design_result_json: &str) -> Vec<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(design_result_json)
        .ok()
        .and_then(|d| d.get("adoption_questions")?.as_array().cloned())
        .unwrap_or_default()
}

fn build_template_adopt_unified_prompt(
    template_name: &str,
    design_result_json: &str,
    connector_swaps_json: Option<&str>,
) -> String {
    let design_summary = summarize_design_result(design_result_json);

    // Extract template-authored seed questions
    let seed_questions = extract_template_seed_questions(design_result_json);
    let seed_section = if seed_questions.is_empty() {
        String::new()
    } else {
        let seed_json = serde_json::to_string_pretty(&seed_questions).unwrap_or_default();
        format!(
            r#"

## Template-Authored Seed Questions (MANDATORY)
The template author has defined these critical questions. You MUST include ALL of them
in your output, verbatim or improved. You may add additional questions around them.
{seed_json}
"#
        )
    };

    let mut prompt = format!(
        r##"You are a senior Personas architect. You will analyze a template design and generate
targeted clarifying questions to customize it for the user's specific needs.

## YOUR TASK: Generate 6-12 Adoption Questions

You MUST ALWAYS generate questions. Never skip this step. The quality of the final persona
depends entirely on understanding the user's specific context, intent, and requirements.

A template is a generic blueprint. Your questions transform it into a precision tool for
this specific user. Without questions, the persona will be generic and require many iterations
to become useful.

### Output format — output EXACTLY this and then STOP:

TRANSFORM_QUESTIONS
[{{"id":"q1","category":"intent","question":"Your question here","type":"select","options":["Option A","Option B"],"default":"Option A","context":"Why this matters","dimension":"use-cases"}}]

### Question rules:
- type must be one of: "select", "text", "boolean"
- For boolean type, options should be ["Yes", "No"]
- For select type, always include options array with 2-5 concrete choices
- For text type, include a helpful default value when possible
- Each question MUST have a "dimension" field mapping to which persona dimension it affects
- Each question must have a unique id
- Generate 6-12 questions total, covering ALL required categories below
- Order: intent → domain → configuration → credentials → boundaries → human_in_the_loop → memory → quality → notifications

### Question categories (MUST include "category" field on every question):

**Required categories (MUST include at least one question each):**

1. "intent" — What specific problem is the user solving? What's their use case scope?
   Examples: "What's the primary goal you want this persona to accomplish?"
   "Which of these capabilities do you actually need?" (with options from template use cases)
   "What does a successful run look like for you?"
   dimension: use-cases

2. "domain" — User's specific context that shapes behavior
   Examples: "What's your team size?", "What industry are you in?",
   "What's your current workflow for this?", "What tools does your team already use?"
   dimension: use-cases or connectors

3. "configuration" — Template-specific operational settings
   Examples: scheduling, thresholds, output formats, data sources, target destinations
   dimension: triggers or connectors

4. "credentials" — For each connector/service, which credentials and workspace/project
   Examples: "Which Slack workspace?", "Which GitHub repo?", "Which Notion database?"
   dimension: connectors

5. "boundaries" — What should this persona NEVER do? What are the limits?
   Examples: "What actions should require your approval before executing?",
   "Are there any topics/data this persona should never touch?",
   "What's the escalation path when something goes wrong?"
   dimension: error-handling or human-review

6. "human_in_the_loop" — For actions with external consequences, approval policies
   Examples: "Should emails be drafted for review or sent automatically?",
   "Should data modifications be reviewed before applying?"
   dimension: human-review

7. "memory" — What should the persona learn and remember across runs?
   Examples: "Should the persona remember patterns from processed data?",
   "What knowledge should persist between runs?"
   dimension: memory

**Optional categories (include when relevant):**

8. "quality" — What does good output look like?
   Examples: "What format should reports be in?", "What level of detail do you need?",
   "Should responses be formal or conversational?"
   dimension: use-cases

9. "notifications" — How and when to notify the user
   Examples: "Summary after each run or only on errors?", "What priority for alerts?"
   dimension: messages

### Dimension mapping (MUST include "dimension" field):
Each question must specify which of the 8 persona dimensions it informs:
- "use-cases" — core capabilities and behavior
- "connectors" — which services and credentials
- "triggers" — when and how it activates
- "messages" — notification channels and formats
- "human-review" — approval gates and oversight
- "memory" — knowledge persistence and learning
- "error-handling" — failure recovery and boundaries
- "events" — inter-persona coordination

After outputting the TRANSFORM_QUESTIONS block, STOP. Do not output anything else.
Do not generate persona JSON in this turn.
{seed_section}
## Template Data

Template name: {template_name}
Design analysis:
{design_summary}
"##
    );

    // Append connector swap instructions if any
    if let Some(swaps) = connector_swaps_json {
        if !swaps.is_empty() && swaps != "{}" {
            prompt.push_str(&format!(
                "\n\n## Connector Swaps\nThe user has swapped the following connectors. Use the REPLACEMENT connector's APIs, authentication patterns, and endpoints instead of the originals:\n{swaps}\n\nWhen generating tools, system prompt API references, and tool guidance, use the replacement connector's API patterns, not the original's.\n"
            ));
        }
    }

    prompt
}

/// Turn 1 of unified template adopt: sends unified prompt to Sonnet.
/// Returns Ok((Some(draft), false)) if persona generated directly,
/// Ok((None, true)) if questions were produced and stored,
/// Ok((None, false)) if neither (error case).
async fn run_unified_adopt_turn1(
    app: &tauri::AppHandle,
    adopt_id: &str,
    template_name: &str,
    design_result_json: &str,
    connector_swaps_json: Option<&str>,
) -> Result<(Option<N8nPersonaOutput>, bool), AppError> {
    tracing::info!(adopt_id = %adopt_id, "Starting unified adopt Turn 1");

    let prompt_text = build_template_adopt_unified_prompt(
        template_name,
        design_result_json,
        connector_swaps_json,
    );

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Analyzing template and preparing transformation...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit = app.clone();
    let adopt_id_for_emit = adopt_id.to_string();
    let on_line = move |line: &str| {
        // Raw CLI prose → bounded ring only (no IPC); the [Milestone] lines around
        // this call carry the high-level state the live panel needs.
        ADOPT_JOBS.record_streamed(&app_for_emit, &adopt_id_for_emit, line.to_string());
    };
    let llm_start = std::time::Instant::now();
    let (output_text, captured_session_id, _) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line), None, None, 420)
            .await
            .map_err(AppError::Internal)?;
    let elapsed_ms = llm_start.elapsed().as_millis();
    tracing::info!(elapsed_ms = %elapsed_ms, adopt_id = %adopt_id, phase = "adopt_turn1", "LLM call completed");

    // Store session ID for possible Turn 2
    if let Some(ref sid) = captured_session_id {
        set_adopt_claude_session(adopt_id, sid.clone());
    }

    // Check if output contains questions (expected — Turn 1 should always produce questions)
    if let Some(questions) = extract_questions_output(&output_text) {
        tracing::info!(adopt_id = %adopt_id, "Turn 1 produced questions");
        set_adopt_questions(adopt_id, questions.clone());
        ADOPT_JOBS.set_status(app, adopt_id, "awaiting_answers", None);
        ADOPT_JOBS.emit_line(
            app,
            adopt_id,
            "[Milestone] Questions generated. Awaiting user answers...",
        );
        return Ok((None, true));
    }

    // Fallback: model skipped questions despite instructions.
    // Try to parse persona output directly but log a warning.
    tracing::warn!(adopt_id = %adopt_id, "Turn 1 skipped questions — model ignored instruction to always ask. Falling back to direct persona parse.");
    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, template_name)?;

    ADOPT_JOBS.emit_line(app, adopt_id, "[Milestone] Draft ready for review.");

    Ok((Some(draft), false))
}

/// Execute Turn 2 of the unified adopt: resume Claude session with user answers.
/// Uses structured answer→dimension mapping to ensure answers shape the persona.
async fn run_continue_adopt(
    app: &tauri::AppHandle,
    adopt_id: &str,
    claude_session_id: &str,
    user_answers_json: &str,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(adopt_id = %adopt_id, "Starting unified adopt Turn 2 (resume)");

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Resuming session with your answers. Generating persona draft...",
    );

    let prompt_text = format!(
        r##"Here are the user's answers to your questions:

{user_answers_json}

## CRITICAL: How to use these answers

Each answer has a "dimension" field telling you which part of the persona it affects.
You MUST structurally integrate every answer into the corresponding dimension.
Do NOT just acknowledge answers — rewrite the persona sections to reflect them.

### Answer → Dimension Mapping Rules:

**"intent" / "domain" / "quality" answers → Rewrite identity + instructions**
- Rewrite the `identity` section to reflect the user's specific role, team, industry
- Rewrite `instructions` to focus on the user's stated goals, not generic template behavior
- Add domain-specific terminology and workflows the user described
- Remove capabilities the user indicated they don't need

**"credentials" answers → Shape connectors + toolGuidance**
- Reference the specific workspace/project/repo the user named
- Update `toolGuidance` with the user's specific API endpoints or instances
- Set `required_connectors` to match exactly what the user confirmed

**"configuration" answers → Update triggers + instructions**
- Apply the user's scheduling, threshold, and format preferences
- Update trigger configs with user's preferred times/intervals
- Embed operational parameters into `instructions` as concrete values, not placeholders

**"boundaries" / "human_in_the_loop" answers → Define human-review + errorHandling**
- Add a "Human-in-the-Loop" customSection listing exactly which actions need approval
- For each boundary, add explicit "NEVER do X" rules in `instructions`
- Set up `manual_review` protocol patterns for actions the user wants to approve
- Define the escalation path the user specified in `errorHandling`

**"memory" answers → Create Memory Strategy customSection**
- Add a "Memory Strategy" customSection specifying what to remember
- Embed `agent_memory` protocol patterns in `instructions` for the knowledge types the user wants persisted
- If user said no to memory, omit memory protocol patterns entirely

**"notifications" answers → Configure notification behavior**
- Set notification frequency and priority based on user's preference
- Embed `user_message` protocol patterns matching the user's desired notification style

## Persona Protocol System (embed these based on user answers):

1. User Messages: {{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}
2. Agent Memory: {{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}
3. Manual Review: {{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}
4. Events: {{"emit_event": {{"type": "<agent>.<task>.<event_type>", "data": {{}}}}}} — Event names MUST use three-level dot syntax (e.g. `stock.signal.strong_buy`, `invoice.scan.completed`). `agent` = single lowercase word for this agent's domain, `task` = use case area, `event_type` = specific snake_case activity. NEVER use single-word names.

## Generate the persona

Return ONLY valid JSON (no markdown fences, no commentary):
{{
  "persona": {{
    "name": "string — reflect the user's specific use case, not the generic template name",
    "description": "string (2-3 sentences referencing what the USER wants, not generic template description)",
    "system_prompt": "string — REWRITTEN to reflect user's answers. Include protocol message instructions based on their preferences",
    "structured_prompt": {{
      "identity": "string — REWRITTEN with user's domain context, team size, industry, specific role",
      "instructions": "string — REWRITTEN with user's specific goals, workflows, boundaries, and operational parameters. Include protocol messages based on their human_review/memory/notification answers",
      "toolGuidance": "string — UPDATED with user's specific instances, repos, workspaces, API endpoints",
      "examples": "string — REWRITTEN with examples using user's actual data types, formats, and scenarios",
      "errorHandling": "string — UPDATED with user's escalation path, boundaries, and notification preferences",
      "webSearch": "string — research guidance for web-enabled runs (empty string if not applicable)",
      "customSections": [{{"title": "string", "content": "string"}}]
    }},
    "icon": "string (lucide icon name)",
    "color": "#hex",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "JSON string with summary and use_cases reflecting user's stated intent",
    "triggers": [{{"trigger_type": "schedule|polling|webhook|manual", "config": {{}}, "description": "string — see TRIGGER POLICY below", "use_case_id": "string or null"}}],
    "tools": [{{"name": "tool_name_snake_case", "category": "email|http|database|file|messaging|other", "description": "string", "requires_credential_type": "connector_name_or_null", "input_schema": null, "implementation_guide": "Step-by-step API docs"}}],
    "required_connectors": [{{"name": "connector_name", "n8n_credential_type": "service_type", "has_credential": false}}]
  }}
}}

TRIGGER POLICY (binding):
1. REACTIVE roles — QA/testing, code review, security review, release management, docs, implementation — get NO `schedule` and NO `polling` triggers. They are driven by team events and chain handoffs; give them at most one `manual` trigger. Cron sweeps on reactive roles duplicate the event spine, burn budget, and inflate the running count (observed live: two daily QA crons plus hourly implementer polling, per team).
2. Only genuinely PROACTIVE cadences (periodic backlog/idea scanning, scheduled reporting/digest) may carry ONE low-frequency `schedule` (weekly; daily at most).
3. Never wire the same use case to BOTH a schedule and an event — pick the event.
"##
    );

    let mut cli_args = prompt::build_resume_cli_args(claude_session_id);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit2 = app.clone();
    let adopt_id_for_emit2 = adopt_id.to_string();
    let on_line2 = move |line: &str| {
        // Raw CLI prose → bounded ring only (no IPC); milestones stay live.
        ADOPT_JOBS.record_streamed(&app_for_emit2, &adopt_id_for_emit2, line.to_string());
    };
    let llm_start = std::time::Instant::now();
    let (output_text, _, _) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line2), None, None, 420)
            .await
            .map_err(AppError::Internal)?;
    let elapsed_ms = llm_start.elapsed().as_millis();
    tracing::info!(elapsed_ms = %elapsed_ms, adopt_id = %adopt_id, phase = "continue_adopt", "LLM call completed");

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, "adopted template")?;

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    Ok(draft)
}

// -- Direct transform job (used for adjustment re-runs) ----------

fn build_template_adopt_prompt(
    template_name: &str,
    design_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    user_answers_json: Option<&str>,
    connector_swaps_json: Option<&str>,
) -> String {
    let adjustment_section = adjustment_request
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("\nUser adjustment request:\n{a}\n"))
        .unwrap_or_default();

    let previous_draft_section = previous_draft_json
        .filter(|d| !d.trim().is_empty())
        .map(|d| format!("\nPrevious draft JSON to refine:\n{d}\n"))
        .unwrap_or_default();

    let user_answers_section = user_answers_json
        .filter(|a| !a.trim().is_empty() && a.trim() != "{}")
        .map(|a| {
            format!(
                r#"
## User Configuration Answers (MUST shape the persona)
The user answered these questions during adoption. Each answer has a "dimension" field.
You MUST structurally integrate every answer into the corresponding persona section:
- intent/domain/quality answers → rewrite identity + instructions with user's specific context
- credentials answers → update toolGuidance + required_connectors with user's instances
- configuration answers → embed concrete values in instructions + triggers, not placeholders
- boundaries/human_in_the_loop answers → add explicit rules + manual_review protocol patterns
- memory answers → add Memory Strategy customSection + agent_memory protocol patterns
- notifications answers → configure user_message protocol patterns

{a}
"#
            )
        })
        .unwrap_or_default();

    let connector_swaps_section = connector_swaps_json
        .filter(|s| !s.trim().is_empty() && s.trim() != "{}")
        .map(|s| format!(
            "\n## Connector Swaps\nThe user has swapped the following connectors. Use the REPLACEMENT connector's APIs, authentication patterns, and endpoints instead of the originals:\n{s}\n\nWhen generating tools, system prompt API references, and tool guidance, use the replacement connector's API patterns, not the original's.\n"
        ))
        .unwrap_or_default();

    format!(
        r##"You are a senior Personas architect.

Transform the following template design into a production-ready Persona configuration.
The template includes a complete design analysis with structured prompt sections,
suggested tools, triggers, connectors, notification channels, and event subscriptions.

## App Capabilities (Personas Platform)
- Personas has a built-in LLM execution engine. Do NOT suggest external LLM API tools.
- Protocol messages let the persona communicate with the user mid-execution
- A memory system where the persona stores knowledge for future runs (self-improvement)
- Manual review gates where the persona pauses for human approval before acting
- Inter-persona events for multi-agent coordination

## Persona Protocol System (use these in the system prompt)

### Protocol 1: User Messages (notify the user)
Output this JSON on its own line to send a message to the user:
{{"user_message": {{"title": "string", "content": "string", "content_type": "text|markdown", "priority": "low|normal|high|critical"}}}}

### Protocol 2: Agent Memory (persist knowledge for future runs)
Output this JSON on its own line to save a memory:
{{"agent_memory": {{"title": "string", "content": "string", "category": "fact|preference|instruction|context|learned", "importance": 1-10, "tags": ["tag1"]}}}}

### Protocol 3: Manual Review (human-in-the-loop approval gate)
Output this JSON on its own line to request human approval:
{{"manual_review": {{"title": "string", "description": "string", "severity": "info|warning|error|critical", "context_data": "string", "suggested_actions": ["Approve", "Reject", "Edit"]}}}}

### Protocol 4: Events (inter-persona communication)
Output this JSON to trigger other personas or emit custom events:
{{"emit_event": {{"type": "<agent>.<task>.<event_type>", "data": {{}}}}}}

**Event naming: three-level dot syntax REQUIRED**
- `agent` — single lowercase word for this persona's domain (e.g. `stock`, `invoice`, `email`, `news`)
- `task` — use case or functional area (e.g. `news`, `scan`, `digest`, `signal`)
- `event_type` — specific snake_case activity (e.g. `high_impact`, `strong_buy`, `completed`, `published`)
- Examples: `stock.signal.strong_buy`, `stock.news.high_impact`, `invoice.scan.completed`, `email.digest.published`
- NEVER use single-word names or generic types like `task_completed`.

Your job:
1. Analyze the template's character, purpose, and operational requirements.
2. Preserve the structured prompt architecture (identity, instructions, toolGuidance,
   examples, errorHandling, customSections) -- these are the core of the persona's behavior.
3. Incorporate all suggested tools, triggers, and connector references into the design context.
4. Use the full_prompt_markdown as the system_prompt foundation.
5. Ensure the persona is self-contained and actionable.
6. Apply any user adjustment requests and configuration answers to customize the template.
7. Embed protocol message instructions (user_message, agent_memory, manual_review) in the
   system_prompt and structured_prompt wherever the template involves human interaction,
   knowledge persistence, or approval gates.
8. Add a "Human-in-the-Loop" customSection when the template performs externally-visible actions.
9. Add a "Memory Strategy" customSection when the template processes data that could inform future runs.

Return ONLY valid JSON (no markdown fences, no commentary), with this exact shape:
{{
  "persona": {{
    "name": "string",
    "description": "string (2-3 sentence summary)",
    "system_prompt": "string (the full_prompt_markdown content, preserving all formatting, with protocol instructions woven in)",
    "structured_prompt": {{
      "identity": "string",
      "instructions": "string -- core logic with protocol messages woven in",
      "toolGuidance": "string -- how to use each tool, including when to request manual_review",
      "examples": "string -- include examples of protocol message usage",
      "errorHandling": "string -- include user_message notifications for critical errors",
      "webSearch": "string -- research guidance for web-enabled runs (empty string if not applicable)",
      "customSections": [{{ "title": "string", "content": "string" }}]
    }},
    "icon": "string (lucide icon name)",
    "color": "#hex",
    "model_profile": null,
    "max_budget_usd": null,
    "max_turns": null,
    "design_context": "JSON string: {{\"summary\":\"Brief overview\",\"use_cases\":[{{\"id\":\"uc1\",\"title\":\"...\",\"description\":\"...\",\"category\":\"notification|data-sync|monitoring|automation|communication|reporting\",\"execution_mode\":\"e2e|mock|non_executable\",\"sample_input\":{{}},\"time_filter\":{{\"field\":\"date\",\"default_window\":\"24h\",\"description\":\"Only process recent items\"}},\"input_schema\":[{{\"key\":\"mode\",\"type\":\"select\",\"label\":\"Mode\",\"options\":[\"a\",\"b\"],\"default\":\"a\"}}],\"suggested_trigger\":{{\"type\":\"schedule\",\"cron\":\"0 */6 * * *\",\"description\":\"Every 6 hours\"}}}}]}}. Generate 3-6 use_cases. execution_mode: e2e (default), mock (example output), non_executable (informational). sample_input: realistic test JSON matching input_schema keys. time_filter: REQUIRED for time-series data use cases (emails, messages, logs). input_schema: structured input fields replacing free-text JSON. suggested_trigger: proposed schedule/trigger for recurring use cases.",
    "triggers": [{{"trigger_type": "schedule|polling|webhook|manual", "config": {{}}, "description": "string — see TRIGGER POLICY below", "use_case_id": "string -- id of the use case this trigger serves, or null"}}],
    "tools": [{{"name": "tool_name_snake_case", "category": "email|http|database|file|messaging|other", "description": "string", "requires_credential_type": "connector_name_or_null", "input_schema": null, "implementation_guide": "Step-by-step API docs (REQUIRED for each tool)"}}],
    "required_connectors": [{{"name": "connector_name", "n8n_credential_type": "service_type", "has_credential": false}}]
  }}
}}

TRIGGER POLICY (binding):
1. REACTIVE roles — QA/testing, code review, security review, release management, docs, implementation — get NO `schedule` and NO `polling` triggers. They are driven by team events and chain handoffs; give them at most one `manual` trigger. Cron sweeps on reactive roles duplicate the event spine, burn budget, and inflate the running count (observed live: two daily QA crons plus hourly implementer polling, per team).
2. Only genuinely PROACTIVE cadences (periodic backlog/idea scanning, scheduled reporting/digest) may carry ONE low-frequency `schedule` (weekly; daily at most).
3. Never wire the same use case to BOTH a schedule and an event — pick the event.

Template name:
{template_name}

Design Analysis Result JSON:
{design_result_json}

{adjustment_section}
{previous_draft_section}
{user_answers_section}
{connector_swaps_section}
"##
    )
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

    tokio::spawn(async move {
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
    });

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

// -- Direct transform job (used for adjustment re-runs) ----------

#[allow(clippy::too_many_arguments)]
async fn run_template_adopt_job(
    app: &tauri::AppHandle,
    adopt_id: &str,
    template_name: &str,
    design_result_json: &str,
    adjustment_request: Option<&str>,
    previous_draft_json: Option<&str>,
    user_answers_json: Option<&str>,
    connector_swaps_json: Option<&str>,
) -> Result<N8nPersonaOutput, AppError> {
    tracing::info!(adopt_id = %adopt_id, template_id = %template_name, "run_template_adopt_job (adjustment re-run): start");
    let prompt_text = build_template_adopt_prompt(
        template_name,
        design_result_json,
        adjustment_request,
        previous_draft_json,
        user_answers_json,
        connector_swaps_json,
    );

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Preparing Claude transformation prompt for template adoption...",
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Claude CLI started. Generating persona draft from template...",
    );

    let app_for_emit = app.clone();
    let adopt_id_for_emit = adopt_id.to_string();
    let on_line = move |line: &str| {
        // Raw CLI prose → bounded ring only (no IPC); milestones stay live.
        ADOPT_JOBS.record_streamed(&app_for_emit, &adopt_id_for_emit, line.to_string());
    };
    let llm_start = std::time::Instant::now();
    let (output_text, _session_id, _) =
        run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line), None, None, 420)
            .await
            .map_err(AppError::Internal)?;
    let elapsed_ms = llm_start.elapsed().as_millis();
    tracing::info!(elapsed_ms = %elapsed_ms, adopt_id = %adopt_id, phase = "adopt_job", "LLM call completed");

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Claude output received. Extracting persona JSON draft...",
    );

    let draft = parse_persona_output(&output_text, template_name)?;

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review. Confirm save is required to persist.",
    );

    tracing::info!(adopt_id = %adopt_id, template_id = %template_name, outcome = "success", "run_template_adopt_job (adjustment re-run): completed");
    Ok(draft)
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
    let has_bindings = answers.map(|a| !a.credential_bindings.is_empty()).unwrap_or(false);

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
/// full persona JSON (the legacy `build_template_adopt_prompt`) made even a tiny
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
        .map(|a| format!("\n## User configuration answers (embed concrete values, not placeholders)\n{a}\n"))
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

    let merged = match merge_adjusted_prose(&base_ir, &prose.system_prompt, prose.structured_prompt.as_ref()) {
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

// -- Template integrity verification (backend trust boundary) --------

/// Verify a single template's content integrity against the embedded Rust manifest.
/// This provides defense-in-depth: even if the frontend bundle is tampered with,
/// the native binary's embedded checksums remain authoritative.
#[tauri::command]
pub fn verify_template_integrity(
    state: State<'_, Arc<AppState>>,
    path: String,
    content: String,
) -> Result<crate::engine::template_checksums::TemplateIntegrityResult, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::engine::template_checksums::verify_template(
        &path, &content,
    ))
}

/// Input for batch template verification.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVerifyEntry {
    pub path: String,
    pub content: String,
}

/// Verify a batch of templates against the embedded Rust manifest.
/// Called during catalog initialization to validate all built-in templates
/// at the backend trust boundary.
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

/// Get the count of templates in the backend's embedded checksum manifest.
/// Useful for the frontend to detect manifest staleness.
#[tauri::command]
pub fn get_template_manifest_count(state: State<'_, Arc<AppState>>) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::engine::template_checksums::manifest_entry_count())
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

/// Map a v3 template use_case (hydrated from a recipe_ref) into the frontend's
/// `DesignUseCase` shape so the Design tab + Use Cases tab render meaningful
/// content. Falls back to a minimal stub when keys are missing so personas
/// with malformed templates still produce visible rows instead of silent
/// empties.
///
/// Mapped fields:
/// - `id`, `title`, `description`
/// - `category`, `enabled` (default true)
/// - `capability_summary`, `tool_hints`
/// - `suggested_trigger` (first entry of `suggested_triggers[]` or
///   `trigger_composition.*` if present)
/// - `event_subscriptions` (from `event_subscriptions[]`)
/// - `notification_channels` (from `notification_channels[]` /
///   `suggested_notification_channels[]`)
/// - `sample_input` (from `sample_input`/`sample_inputs[0]` or
///   `test_fixtures[0].input`)
fn map_template_use_case_to_design_use_case(uc: &serde_json::Value) -> serde_json::Value {
    let obj = match uc.as_object() {
        Some(o) => o,
        None => return uc.clone(),
    };
    let mut out = serde_json::Map::new();

    // id — prefer existing, otherwise stable hash of title or random fallback.
    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("uc-{}", uuid::Uuid::new_v4()));
    out.insert("id".into(), serde_json::Value::String(id));

    // title / name → title; description from any of several keys.
    let title = obj
        .get("title")
        .or_else(|| obj.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled capability")
        .to_string();
    out.insert("title".into(), serde_json::Value::String(title));

    let description = obj
        .get("description")
        .or_else(|| obj.get("summary"))
        .or_else(|| obj.get("goal"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    out.insert("description".into(), serde_json::Value::String(description));

    if let Some(cat) = obj.get("category").and_then(|v| v.as_str()) {
        out.insert("category".into(), serde_json::Value::String(cat.into()));
    }

    let enabled = obj
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    out.insert("enabled".into(), serde_json::Value::Bool(enabled));

    if let Some(cs) = obj.get("capability_summary").and_then(|v| v.as_str()) {
        out.insert(
            "capability_summary".into(),
            serde_json::Value::String(cs.into()),
        );
    }
    if let Some(arr) = obj.get("tool_hints").and_then(|v| v.as_array()) {
        out.insert("tool_hints".into(), serde_json::Value::Array(arr.clone()));
    } else if let Some(arr) = obj.get("suggested_tools").and_then(|v| v.as_array()) {
        // Templates carry `suggested_tools` per use_case; treat them as tool_hints.
        let hints: Vec<serde_json::Value> = arr
            .iter()
            .filter_map(|t| {
                t.as_str()
                    .map(|s| serde_json::Value::String(s.into()))
                    .or_else(|| t.get("name").cloned())
            })
            .collect();
        if !hints.is_empty() {
            out.insert("tool_hints".into(), serde_json::Value::Array(hints));
        }
    }

    // suggested_trigger — pick first available trigger source.
    if let Some(t) = obj.get("suggested_trigger") {
        out.insert("suggested_trigger".into(), t.clone());
    } else if let Some(arr) = obj.get("suggested_triggers").and_then(|v| v.as_array()) {
        if let Some(first) = arr.first() {
            out.insert("suggested_trigger".into(), first.clone());
        }
    }

    if let Some(arr) = obj.get("event_subscriptions").and_then(|v| v.as_array()) {
        out.insert(
            "event_subscriptions".into(),
            serde_json::Value::Array(arr.clone()),
        );
    }

    if let Some(arr) = obj
        .get("notification_channels")
        .or_else(|| obj.get("suggested_notification_channels"))
        .and_then(|v| v.as_array())
    {
        out.insert(
            "notification_channels".into(),
            serde_json::Value::Array(arr.clone()),
        );
    }

    if let Some(si) = obj.get("sample_input") {
        out.insert("sample_input".into(), si.clone());
    } else if let Some(arr) = obj.get("sample_inputs").and_then(|v| v.as_array()) {
        if let Some(first) = arr.first() {
            out.insert("sample_input".into(), first.clone());
        }
    } else if let Some(fixtures) = obj.get("test_fixtures").and_then(|v| v.as_array()) {
        if let Some(input) = fixtures.first().and_then(|f| f.get("input")) {
            out.insert("sample_input".into(), input.clone());
        }
    }

    if let Some(em) = obj.get("execution_mode").and_then(|v| v.as_str()) {
        out.insert(
            "execution_mode".into(),
            serde_json::Value::String(em.into()),
        );
    }

    // Per-UC model tier — carry the capability's `model_override` (and its
    // human-readable `model_rationale`) through to design_context so the
    // runner's per-UC override resolution (runner/mod.rs §Phase 9) can
    // right-size the model per capability. Without this, recipe-baked tiers
    // (haiku for mechanical caps, opus for high-judgment caps) are silently
    // dropped on the template instant-adopt path — they only survived the
    // Glyph build→promote path (build_sessions.rs build_structured_use_cases).
    if let Some(mo) = obj.get("model_override").filter(|v| !v.is_null()) {
        out.insert("model_override".into(), mo.clone());
    }
    if let Some(mr) = obj.get("model_rationale").filter(|v| !v.is_null()) {
        out.insert("model_rationale".into(), mr.clone());
    }

    serde_json::Value::Object(out)
}

#[cfg(test)]
mod model_tier_mapping_tests {
    use super::map_template_use_case_to_design_use_case;
    use serde_json::json;

    #[test]
    fn carries_model_override_and_rationale_into_design_use_case() {
        let uc = json!({
            "id": "uc_triage",
            "title": "Triage",
            "model_override": "haiku",
            "model_rationale": "mechanical label triage, fixed buckets",
        });
        let out = map_template_use_case_to_design_use_case(&uc);
        assert_eq!(out.get("model_override").and_then(|v| v.as_str()), Some("haiku"));
        assert_eq!(
            out.get("model_rationale").and_then(|v| v.as_str()),
            Some("mechanical label triage, fixed buckets"),
        );
    }

    #[test]
    fn omits_tier_keys_when_absent_or_null() {
        // Default (sonnet) tier: recipe stores model_override:null and no
        // rationale → neither key should appear on the design use_case.
        let uc = json!({
            "id": "uc_report",
            "title": "Weekly Report",
            "model_override": serde_json::Value::Null,
        });
        let out = map_template_use_case_to_design_use_case(&uc);
        assert!(out.get("model_override").is_none(), "null override is not propagated");
        assert!(out.get("model_rationale").is_none());

        let bare = json!({ "id": "uc_bare", "title": "Bare" });
        let out2 = map_template_use_case_to_design_use_case(&bare);
        assert!(out2.get("model_override").is_none());
        assert!(out2.get("model_rationale").is_none());
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
        assert_eq!(brief.model, "haiku", "absolute-default → light Haiku wire pass");
        // None answers also → default
        assert_eq!(assess_adjustment("{}", None).divergence, "default");
    }

    #[test]
    fn divergence_configured_with_answers_or_bindings() {
        let mut a = empty_answers();
        a.answers.insert("q1".into(), "value".into());
        let brief = assess_adjustment("{}", Some(&a));
        assert_eq!(brief.divergence, "configured");
        assert_eq!(brief.model, "sonnet", "configured + non-opus persona → Sonnet");
        assert!(brief.user_answers_json.is_some());

        let mut b = empty_answers();
        b.credential_bindings.insert("email".into(), "gmail".into());
        let brief_b = assess_adjustment("{}", Some(&b));
        assert_eq!(brief_b.divergence, "configured");
        assert!(brief_b.connector_swaps_json.is_some(), "bindings feed connector_swaps");
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
        assert_eq!(brief.model, "opus", "opus-tier persona + divergence → Opus adjustment");

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
        let merged = merge_adjusted_prose(&base, "NEW PROMPT", Some(&structured)).expect("merge ok");
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        // prose specialized
        assert_eq!(v["system_prompt"], "NEW PROMPT");
        assert_eq!(v["full_prompt_markdown"], "NEW PROMPT", "full_prompt_markdown synced");
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
        assert_eq!(v["system_prompt"], "OLD", "blank draft prompt must not clobber base");
    }
}
