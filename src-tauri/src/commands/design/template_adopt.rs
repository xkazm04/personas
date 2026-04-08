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
/// Returns `Err(AppError::Validation)` if the template is known but its
/// content does not match the expected hash (possible tampering).
fn check_template_integrity(template_name: &str, content_json: &str) -> Result<(), AppError> {
    let integrity =
        crate::engine::template_checksums::verify_template(template_name, content_json);
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

fn get_adopt_snapshot_internal(adopt_id: &str) -> Option<crate::background_job::BackgroundTaskSnapshot<AdoptSnapshotExtras>> {
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
pub fn cancel_adopt_job(app: &tauri::AppHandle, adopt_id: &str) -> Result<(), crate::error::AppError> {
    ADOPT_JOBS.cancel(app, adopt_id)
}

/// Cancel a generate job (non-command wrapper for workflows).
pub fn cancel_generate_job(app: &tauri::AppHandle, gen_id: &str) -> Result<(), crate::error::AppError> {
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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_template_adopt_background(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    adopt_id: String,
    template_name: String,
    design_result_json: String,
    adjustment_request: Option<String>,
    previous_draft_json: Option<String>,
    user_answers_json: Option<String>,
    connector_swaps_json: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    // Validate all JSON payloads at the trust boundary
    validate_json_field("design_result_json", &design_result_json)?;
    validate_optional_json_field("previous_draft_json", &previous_draft_json)?;
    validate_optional_json_field("user_answers_json", &user_answers_json)?;
    validate_optional_json_field("connector_swaps_json", &connector_swaps_json)?;

    // Backend integrity check: verify the design result against the embedded manifest.
    check_template_integrity(&template_name, &design_result_json)?;

    let cancel_token = CancellationToken::new();
    ADOPT_JOBS.insert_running(adopt_id.clone(), cancel_token.clone(), AdoptExtra::default())?;
    ADOPT_JOBS.set_status(&app, &adopt_id, "running", None);

    // Determine if this is an adjustment re-run or initial transform
    let is_adjustment = adjustment_request.as_ref().is_some_and(|a| !a.trim().is_empty())
        || previous_draft_json.as_ref().is_some_and(|d| !d.trim().is_empty());

    let app_handle = app.clone();
    let adopt_id_for_task = adopt_id.clone();
    let token_for_task = cancel_token.clone();
    let template_name_clone = template_name.clone();

    tokio::spawn(async move {
        if is_adjustment {
            // -- Adjustment re-run: single-prompt path (no interactive questions) --
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Adoption cancelled by user".into()))
                }
                res = run_template_adopt_job(
                    &app_handle,
                    &adopt_id_for_task,
                    &template_name,
                    &design_result_json,
                    adjustment_request.as_deref(),
                    previous_draft_json.as_deref(),
                    user_answers_json.as_deref(),
                    connector_swaps_json.as_deref(),
                ) => res
            };

            handle_adopt_result(
                result.map(|d| (d, false)),
                &app_handle,
                &adopt_id_for_task,
                &template_name_clone,
            );
        } else {
            // -- Initial transform: unified prompt (may produce questions or persona) --
            let result = tokio::select! {
                _ = token_for_task.cancelled() => {
                    Err(AppError::Internal("Adoption cancelled by user".into()))
                }
                res = run_unified_adopt_turn1(
                    &app_handle,
                    &adopt_id_for_task,
                    &template_name,
                    &design_result_json,
                    connector_swaps_json.as_deref(),
                ) => res
            };

            match result {
                Ok((Some(draft), _)) => {
                    // Model skipped questions and produced persona directly
                    handle_adopt_result(
                        Ok((draft, false)),
                        &app_handle,
                        &adopt_id_for_task,
                        &template_name_clone,
                    );
                }
                Ok((None, true)) => {
                    // Questions were produced and stored -- status is awaiting_answers
                    // Frontend will poll and pick up the questions
                }
                Ok((None, false)) => {
                    // No questions and no persona -- unusual, treat as failure
                    handle_adopt_result(
                        Err(AppError::Internal("No output from unified transform".into())),
                        &app_handle,
                        &adopt_id_for_task,
                        &template_name_clone,
                    );
                }
                Err(err) => {
                    handle_adopt_result(
                        Err(err),
                        &app_handle,
                        &adopt_id_for_task,
                        &template_name_clone,
                    );
                }
            }
        }
    });

    Ok(json!({ "adopt_id": adopt_id }))
}

/// Turn 2: resume the Claude session with user answers.
#[tauri::command]
pub async fn continue_template_adopt(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    adopt_id: String,
    user_answers_json: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    validate_json_field("user_answers_json", &user_answers_json)?;

    // Validate that answers match the stored questions from Turn 1.
    // If the adopt job was evicted (10-min TTL or 50-entry cap), stored_questions
    // will be None — we MUST reject rather than skip validation, otherwise
    // unvalidated user input flows into the LLM prompt.
    let stored_questions = ADOPT_JOBS
        .read_extra(&adopt_id, |extra| extra.questions.clone())
        .flatten();
    let questions_val = stored_questions.ok_or_else(|| {
        tracing::warn!(
            adopt_id = %adopt_id,
            "Adoption session expired or evicted — cannot validate answers"
        );
        AppError::NotFound(
            "Adoption session has expired. Please restart the template adoption.".into(),
        )
    })?;
    if let Some(questions_arr) = questions_val.as_array() {
        let answers: serde_json::Value = serde_json::from_str(&user_answers_json)
            .map_err(|e| AppError::Validation(format!("user_answers_json parse error: {e}")))?;
        if let Some(answers_obj) = answers.as_object() {
            // Check that every required question has a non-empty answer
            let mut missing = Vec::new();
            for q in questions_arr {
                if let Some(id) = q.get("id").and_then(|v| v.as_str()) {
                    match answers_obj.get(id).and_then(|v| v.as_str()) {
                        Some(a) if !a.trim().is_empty() => {}
                        _ => missing.push(id.to_string()),
                    }
                }
            }
            if !missing.is_empty() {
                return Err(AppError::Validation(format!(
                    "Missing answers for questions: {}",
                    missing.join(", ")
                )));
            }
            // Check for unknown answer keys
            let valid_ids: std::collections::HashSet<&str> = questions_arr
                .iter()
                .filter_map(|q| q.get("id").and_then(|v| v.as_str()))
                .collect();
            let unknown: Vec<&String> = answers_obj
                .keys()
                .filter(|k| !valid_ids.contains(k.as_str()))
                .collect();
            if !unknown.is_empty() {
                return Err(AppError::Validation(format!(
                    "Unknown question IDs in answers: {}",
                    unknown.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                )));
            }
        }
    }

    let claude_session_id = get_adopt_claude_session(&adopt_id)
        .ok_or_else(|| AppError::NotFound("No Claude session found for this adoption".into()))?;

    // Atomically guard against duplicate concurrent continue calls:
    // check not-running + set status + set cancel token in one lock scope.
    let cancel_token = CancellationToken::new();
    ADOPT_JOBS.resume_running(&app, &adopt_id, cancel_token.clone())?;

    let app_handle = app.clone();
    let adopt_id_for_task = adopt_id.clone();
    let token_for_task = cancel_token;

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = token_for_task.cancelled() => {
                Err(AppError::Internal("Adoption cancelled by user".into()))
            }
            res = run_continue_adopt(
                &app_handle,
                &adopt_id_for_task,
                &claude_session_id,
                &user_answers_json,
            ) => res
        };

        handle_adopt_result(
            result.map(|d| (d, false)),
            &app_handle,
            &adopt_id_for_task,
            "adopted template",
        );
    });

    Ok(json!({ "adopt_id": adopt_id }))
}

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

#[tauri::command]
pub fn clear_template_adopt_snapshot(
    state: State<'_, Arc<AppState>>,
    adopt_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    ADOPT_JOBS.remove(&adopt_id)
}

#[tauri::command]
pub fn cancel_template_adopt(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    adopt_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    ADOPT_JOBS.cancel(&app, &adopt_id)
}

/// Guard against double-submission of confirm_template_adopt_draft.
/// Holds content hashes of in-flight draft confirmations so concurrent calls
/// with the same draft are rejected.
static CONFIRM_INFLIGHT: Mutex<Option<HashSet<u64>>> = Mutex::new(None);

fn confirm_inflight_insert(hash: u64) -> bool {
    let mut guard = CONFIRM_INFLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(HashSet::new).insert(hash)
}

fn confirm_inflight_remove(hash: u64) {
    let mut guard = CONFIRM_INFLIGHT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(set) = guard.as_mut() {
        set.remove(&hash);
    }
}

fn simple_hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

#[tauri::command]
pub fn confirm_template_adopt_draft(
    state: State<'_, Arc<AppState>>,
    draft_json: String,
    template_name: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let tpl_name = template_name.as_deref().unwrap_or("unknown");
    tracing::info!(template_id = %tpl_name, "confirm_template_adopt_draft: start");
    validate_json_field("draft_json", &draft_json)?;

    // Prevent double-submission: reject if an identical draft is already being processed
    let draft_hash = simple_hash(&draft_json);
    if !confirm_inflight_insert(draft_hash) {
        return Err(AppError::Validation(
            "This draft is already being processed. Please wait.".into(),
        ));
    }

    let result = (|| {
        let draft: N8nPersonaOutput = serde_json::from_str(&draft_json)
            .map_err(|e| AppError::Validation(format!("Invalid draft JSON: {e}")))?;

        let draft = normalize_n8n_persona_draft(draft, "Adopted Template");

        if draft.system_prompt.trim().is_empty() {
            return Err(AppError::Validation(
                "Draft system_prompt cannot be empty".into(),
            ));
        }

        // Atomic import: persona + tools + triggers in a single SQLite transaction
        let (response, _import_result) = super::n8n_transform::confirmation::create_persona_atomically(
            &state.db,
            &draft,
            None, // no n8n session for template adopt
        )?;

        // Track adoption count for the source template (with audit log)
        let created_persona_id = response.get("persona").and_then(|p| p.get("id")).and_then(|v| v.as_str());
        if let Some(name) = template_name.as_deref().or(draft.name.as_deref()) {
            if let Err(e) = reviews_repo::increment_adoption_count(&state.db, name, created_persona_id) {
                tracing::warn!(template = %name, error = %e, "Failed to increment adoption count");
            }
        }

        tracing::info!(template_id = %tpl_name, outcome = "success", "confirm_template_adopt_draft: completed");
        Ok(response)
    })();

    confirm_inflight_remove(draft_hash);
    result
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
    use super::n8n_transform::types::{N8nPersonaOutput, N8nToolDraft, N8nTriggerDraft, N8nConnectorRef};

    tracing::info!(template_id = %template_name, "instant_adopt_template: start");
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation("Design result JSON cannot be empty".into()));
    }
    validate_json_field("design_result_json", &design_result_json)?;

    // Backend integrity check: verify the design result against the embedded manifest.
    // This catches tampered templates even if the frontend checksums were bypassed.
    check_template_integrity(&template_name, &design_result_json)?;

    let design: serde_json::Value = serde_json::from_str(&design_result_json)
        .map_err(|e| AppError::Validation(format!("Invalid design result JSON: {e}")))?;

    let full_prompt = design.get("full_prompt_markdown")
        .and_then(|v| v.as_str())
        .unwrap_or("You are a helpful AI assistant.")
        .to_string();

    let summary = design.get("summary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| Some(format!("Adopted from template: {template_name}")));

    // Normalize structured_prompt
    let structured_prompt = design.get("structured_prompt").cloned();

    let persona_meta = design.get("persona_meta");
    let icon = persona_meta.and_then(|m| m.get("icon")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let color = persona_meta.and_then(|m| m.get("color")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let model_profile = persona_meta.and_then(|m| m.get("model_profile")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let persona_name = persona_meta
        .and_then(|m| m.get("name")).and_then(|v| v.as_str())
        .filter(|n| !n.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or(template_name.clone());

    // Build tools from suggested_tools
    let tools: Option<Vec<N8nToolDraft>> = design.get("suggested_tools")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|t| {
            let name = t.as_str().map(|s| s.to_string())
                .or_else(|| t.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))?;
            Some(N8nToolDraft {
                name: name.clone(),
                category: t.get("category").and_then(|v| v.as_str()).unwrap_or("api").to_string(),
                description: t.get("description").and_then(|v| v.as_str()).unwrap_or(&name).to_string(),
                requires_credential_type: t.get("requires_credential_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                input_schema: t.get("input_schema").cloned(),
                implementation_guide: t.get("implementation_guide").and_then(|v| v.as_str()).map(|s| s.to_string()),
            })
        }).collect());

    // Build triggers from suggested_triggers
    let triggers: Option<Vec<N8nTriggerDraft>> = design.get("suggested_triggers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|t| {
            N8nTriggerDraft {
                trigger_type: t.get("trigger_type").and_then(|v| v.as_str()).unwrap_or("manual").to_string(),
                config: t.get("config").cloned(),
                description: t.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                use_case_id: None,
            }
        }).collect());

    // Build required_connectors from suggested_connectors
    let required_connectors: Option<Vec<N8nConnectorRef>> = design.get("suggested_connectors")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|c| {
            let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if name.is_empty() { return None; }
            Some(N8nConnectorRef {
                name: name.clone(),
                n8n_credential_type: c.get("auth_type").and_then(|v| v.as_str()).unwrap_or("api_key").to_string(),
                has_credential: true,
            })
        }).collect());

    let notification_channels = design.get("suggested_notification_channels")
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    // Build proper DesignContextData-format design_context instead of raw design_result
    let use_cases = design
        .get("use_case_flows")
        .and_then(|v| v.as_array())
        .cloned()
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
    let design_context_str = serde_json::to_string(&design_context_obj).unwrap_or_else(|_| "{}".to_string());

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
        triggers,
        tools,
        required_connectors,
    };

    let draft = super::n8n_transform::types::normalize_n8n_persona_draft(draft, &template_name);

    // Atomic create: persona + tools + triggers in one transaction
    let (response, _import_result) = super::n8n_transform::confirmation::create_persona_atomically(
        &state.db,
        &draft,
        None,
    )?;

    // Track adoption count
    let created_persona_id = response.get("persona").and_then(|p| p.get("id")).and_then(|v| v.as_str());
    if let Err(e) = reviews_repo::increment_adoption_count(&state.db, &template_name, created_persona_id) {
        tracing::warn!(template = %template_name, error = %e, "Failed to increment adoption count");
    }

    tracing::info!(
        template_id = %template_name,
        persona_id = %created_persona_id.unwrap_or("?"),
        outcome = "success",
        "instant_adopt_template: completed with tools + triggers"
    );
    Ok(response)
}

// -- Question Generation (fallback for direct calls) -------------

#[tauri::command]
pub async fn generate_template_adopt_questions(
    state: State<'_, Arc<AppState>>,
    template_name: String,
    design_result_json: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    tracing::info!(template_id = %template_name, "generate_template_adopt_questions: start");
    if design_result_json.trim().is_empty() {
        return Err(AppError::Validation(
            "Design result JSON cannot be empty".into(),
        ));
    }

    let design_summary = summarize_design_result(&design_result_json);

    // Extract template-authored seed questions
    let seed_questions = extract_template_seed_questions(&design_result_json);
    let seed_section = if seed_questions.is_empty() {
        String::new()
    } else {
        let seed_json = serde_json::to_string_pretty(&seed_questions).unwrap_or_default();
        format!(
            "\n## Template-Authored Seed Questions (MANDATORY)\nInclude ALL of these verbatim or improved:\n{seed_json}\n"
        )
    };

    let prompt_text = format!(
        r##"Analyze this template design and generate 6-12 clarifying questions for the user
before adopting it into a Personas agent.

You MUST ALWAYS generate questions. The quality of the persona depends on understanding
the user's specific context, intent, and requirements. Without questions, the persona
will be generic and require many iterations to become useful.

Generate questions across these categories (MUST include "category" field on every question):

## Required categories (at least one question each):

1. "intent" — What specific problem is the user solving? What's their use case scope?
2. "domain" — User's specific context (team size, industry, current workflow, existing tools)
3. "configuration" — Template-specific operational settings (schedules, thresholds, formats)
4. "credentials" — For each connector/service: which credentials, workspace, project
5. "boundaries" — What should this persona NEVER do? Limits and escalation paths
6. "human_in_the_loop" — Approval policies for actions with external consequences
7. "memory" — What to learn and remember across runs

## Optional categories:
8. "quality" — Output format, detail level, tone preferences
9. "notifications" — When and how to notify the user
{seed_section}
Template name: {template_name}
Design analysis:
{design_summary}

Return ONLY valid JSON (no markdown fences), with this exact shape:
[{{
  "id": "unique_id",
  "category": "intent",
  "question": "What specific problem do you want this persona to solve?",
  "type": "select",
  "options": ["Option 1", "Option 2"],
  "default": "Option 1",
  "context": "Helps customize the persona's core behavior",
  "dimension": "use-cases"
}}]

Rules:
- type must be one of: "select", "text", "boolean"
- For boolean type, options should be ["Yes", "No"]
- For select type, always include options array with 2-5 concrete choices
- Each question MUST have a "dimension" field: use-cases|connectors|triggers|messages|human-review|memory|error-handling|events
- Order: intent → domain → configuration → credentials → boundaries → human_in_the_loop → memory → quality → notifications
- Each question must have a unique id
- Generate 6-12 questions total
"##,
    );

    // Use Sonnet for question generation (not Haiku) — question quality is critical
    let mut cli_args = crate::engine::prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let llm_start = std::time::Instant::now();
    let (output, _session_id, _) = run_claude_prompt_text_inner(prompt_text, &cli_args, None, None, None, 180)
        .await
        .map_err(AppError::Internal)?;
    let elapsed_ms = llm_start.elapsed().as_millis();
    tracing::info!(elapsed_ms = %elapsed_ms, phase = "unified_questions", "LLM call completed");

    let json_str = extract_first_json_object(&output)
        .or_else(|| {
            // Try extracting array
            let start = output.find('[')?;
            let end = output.rfind(']')?;
            if start < end {
                let slice = &output[start..=end];
                if serde_json::from_str::<serde_json::Value>(slice).is_ok() {
                    return Some(slice.to_string());
                }
            }
            None
        })
        .ok_or_else(|| {
            AppError::Internal("No valid JSON in question generation output".into())
        })?;

    let questions: serde_json::Value = serde_json::from_str(&json_str)?;
    let question_count = questions.as_array().map_or(0, |a| a.len());
    tracing::info!(template_id = %template_name, question_count = %question_count, outcome = "success", "generate_template_adopt_questions: completed");
    Ok(questions)
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
        Ok((draft, _)) => {
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
        summary.insert("structured_prompt".into(), serde_json::Value::Object(sp_summary));
    }

    // Always include: connectors (critical for credential questions)
    if let Some(v) = design.get("suggested_connectors") {
        summary.insert("suggested_connectors".into(), v.clone());
    }

    // Always include: triggers, tools, summary, service_flow
    for key in &["suggested_tools", "suggested_triggers", "summary", "service_flow",
                  "suggested_notification_channels", "suggested_event_subscriptions",
                  "protocol_capabilities", "adoption_questions", "adoption_requirements"] {
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
        ADOPT_JOBS.emit_line(&app_for_emit, &adopt_id_for_emit, line.to_string());
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

    ADOPT_JOBS.emit_line(
        app,
        adopt_id,
        "[Milestone] Draft ready for review.",
    );

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
    "triggers": [{{"trigger_type": "schedule|polling|webhook|manual", "config": {{}}, "description": "string", "use_case_id": "string or null"}}],
    "tools": [{{"name": "tool_name_snake_case", "category": "email|http|database|file|messaging|other", "description": "string", "requires_credential_type": "connector_name_or_null", "input_schema": null, "implementation_guide": "Step-by-step API docs"}}],
    "required_connectors": [{{"name": "connector_name", "n8n_credential_type": "service_type", "has_credential": false}}]
  }}
}}
"##
    );

    let mut cli_args = prompt::build_resume_cli_args(claude_session_id);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let app_for_emit2 = app.clone();
    let adopt_id_for_emit2 = adopt_id.to_string();
    let on_line2 = move |line: &str| {
        ADOPT_JOBS.emit_line(&app_for_emit2, &adopt_id_for_emit2, line.to_string());
    };
    let llm_start = std::time::Instant::now();
    let (output_text, _, _) = run_claude_prompt_text_inner(prompt_text, &cli_args, Some(&on_line2), None, None, 420)
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
        .map(|a| format!(
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
        ))
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
    "triggers": [{{"trigger_type": "schedule|polling|webhook|manual", "config": {{}}, "description": "string", "use_case_id": "string -- id of the use case this trigger serves, or null"}}],
    "tools": [{{"name": "tool_name_snake_case", "category": "email|http|database|file|messaging|other", "description": "string", "requires_credential_type": "connector_name_or_null", "input_schema": null, "implementation_guide": "Step-by-step API docs (REQUIRED for each tool)"}}],
    "required_connectors": [{{"name": "connector_name", "n8n_credential_type": "service_type", "has_credential": false}}]
  }}
}}

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
    let connectors_used: Option<String> = serde_json::from_str::<serde_json::Value>(&design_result_json)
        .ok()
        .and_then(|design| {
            design.get("suggested_connectors").and_then(|conns| {
                let names: Vec<String> = conns
                    .as_array()?
                    .iter()
                    .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
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

    GEN_JOBS.emit_line(app, gen_id, "[Milestone] Preparing template generation prompt...");

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

    GEN_JOBS.emit_line(app, gen_id, "[Milestone] Claude output received. Extracting design JSON...");

    // Extract JSON from output
    let json_str = extract_first_json_object(&output_text).ok_or_else(|| {
        AppError::Internal("No valid JSON found in template generation output".into())
    })?;

    // Validate it's valid JSON
    let _: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| AppError::Internal(format!("Invalid JSON in generation output: {e}")))?;

    GEN_JOBS.emit_line(app, gen_id, "[Milestone] Template design generated successfully.");

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
        ADOPT_JOBS.emit_line(&app_for_emit, &adopt_id_for_emit, line.to_string());
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
    Ok(crate::engine::template_checksums::verify_template(&path, &content))
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
    let pairs: Vec<(String, String)> = templates
        .into_iter()
        .map(|t| (t.path, t.content))
        .collect();
    Ok(crate::engine::template_checksums::verify_templates_batch(&pairs))
}

/// Get the count of templates in the backend's embedded checksum manifest.
/// Useful for the frontend to detect manifest staleness.
#[tauri::command]
pub fn get_template_manifest_count(
    state: State<'_, Arc<AppState>>,
) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    Ok(crate::engine::template_checksums::manifest_entry_count())
}

