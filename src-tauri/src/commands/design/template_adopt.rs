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
    #[cfg(not(debug_assertions))]
    if !integrity.is_known_template {
        tracing::warn!(
            template = %template_name,
            actual = %integrity.actual_hash,
            "SECURITY: Unknown template rejected during adoption"
        );
        return Err(AppError::Validation(
            "Template integrity verification failed: template is not in the trusted checksum manifest."
                .into(),
        ));
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
}

/// Adopt-specific extras flattened into BackgroundTaskSnapshot.
#[derive(Clone, Serialize)]
struct AdoptSnapshotExtras {
    adopt_id: String,
    draft: Option<serde_json::Value>,
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

fn get_adopt_snapshot_internal(
    adopt_id: &str,
) -> Option<crate::background_job::BackgroundTaskSnapshot<AdoptSnapshotExtras>> {
    sweep_adopt_jobs();
    ADOPT_JOBS.get_task_snapshot(adopt_id, |extra| AdoptSnapshotExtras {
        adopt_id: adopt_id.to_string(),
        draft: extra.draft.clone(),
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
fn validate_json_field(name: &str, value: &str) -> Result<(), AppError> {
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
    instant_adopt_template_inner(&state, template_name, design_result_json)
}

/// Inner function callable from both Tauri command and test automation.
/// Uses create_persona_atomically to create persona + tools + triggers in one transaction.
pub fn instant_adopt_template_inner(
    state: &Arc<AppState>,
    template_name: String,
    design_result_json: String,
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

    // v3 templates ship a rich `persona` block + `use_cases[]`; the flat
    // fields this function reads (`structured_prompt`, `suggested_tools`,
    // `suggested_triggers`, `suggested_connectors`, `use_case_flows`,
    // `full_prompt_markdown`, …) don't exist until v3 normalization runs.
    // Without this call every adopted persona ends up with the default
    // "You are a helpful AI assistant." prompt and an empty design_context
    // — visible to the user as a Glyph-from-scratch empty state on click.
    // The Glyph promote path already calls this; instant-adopt was the gap.
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

    let summary = design
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
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

    // Build proper DesignContextData-format design_context instead of raw design_result.
    // `use_case_flows` is v3-flattened (populated by normalize_v3_to_flat); fall back
    // to the raw `use_cases` block on v3 templates that didn't normalize cleanly, and
    // finally to an empty list. Without this fallback the editor's Use Cases tab and
    // Matrix view both render empty for instant-adopted personas.
    let use_cases = design
        .get("use_case_flows")
        .and_then(|v| v.as_array())
        .cloned()
        .or_else(|| design.get("use_cases").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();
    let design_context_summary = design
        .get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Adopted from template: {}", template_name));
    let design_context_obj = serde_json::json!({
        "useCases": use_cases,
        "summary": design_context_summary,
        "builderMeta": {
            "creationMethod": "template_adopt"
        }
    });
    let design_context_str =
        serde_json::to_string(&design_context_obj).unwrap_or_else(|_| "{}".to_string());

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

    // Adoption pre-flight (C1): if the persona declares connectors that have
    // no matching vault credential, mark setup_status='needs_credentials' so
    // the dashboard surfaces a "Setup required" badge and the user knows the
    // persona can't run yet. Built-in local connectors (local_drive,
    // personas_database, personas_messages, personas_vector_db) are always
    // considered satisfied. Failure is best-effort — a stuck setup_status
    // write must not block the adoption response.
    if let Some(pid) = created_persona_id.as_deref() {
        match check_persona_runnability(&state.db, &draft.required_connectors) {
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

/// Built-in local connectors that don't need a vault credential — they're
/// resources the app provides directly.
const BUILTIN_LOCAL_CONNECTORS: &[&str] = &[
    "local_drive",
    "personas_database",
    "personas_messages",
    "personas_vector_db",
];

/// Walk the persona's declared connector list and return the names of any
/// that don't have a matching vault credential. Returns an empty list if
/// every required connector is either built-in or has a credential bound.
fn check_persona_runnability(
    pool: &crate::db::DbPool,
    required: &Option<Vec<super::n8n_transform::types::N8nConnectorRef>>,
) -> Result<Vec<String>, AppError> {
    let required = match required {
        Some(r) if !r.is_empty() => r,
        _ => return Ok(Vec::new()),
    };
    let conn = pool.get()?;
    let mut missing = Vec::new();
    for c in required {
        let name = c.name.trim();
        if name.is_empty() || BUILTIN_LOCAL_CONNECTORS.iter().any(|b| b.eq_ignore_ascii_case(name)) {
            continue;
        }
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM persona_credentials WHERE LOWER(service_type) = LOWER(?1) LIMIT 1",
                rusqlite::params![name],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            missing.push(name.to_string());
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
        GEN_JOBS.emit_line(&app_for_emit, &gen_id_for_emit, line.to_string());
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
