use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::db::models::{
    BulkDeleteOutcome, CreatePersonaInput, Persona, PersonaAutomation, PersonaEventSubscription,
    PersonaSummary, PersonaTeam, PersonaToolDefinition, PersonaTrigger, UpdateExecutionStatus,
    UpdatePersonaInput,
};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::personas as repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine;
use crate::engine::config_merge::{self, EffectiveModelConfig};
use crate::engine::types::ExecutionState;
use crate::error::AppError;
use crate::validation::contract::check;
use personas_macros::requires;
use crate::validation::persona as pv;
use crate::AppState;

/// List personas, optionally filtered to a set of lifecycle stages. `None`
/// (the default, back-compat) returns every persona; the roster's Archived view
/// passes `["archived"]`, the default view can pass `["active","draft"]`.
#[tauri::command]
#[requires(auth)]
pub fn list_personas(
    state: State<'_, Arc<AppState>>,
    lifecycle: Option<Vec<String>>,
) -> Result<Vec<Persona>, AppError> {
    // Lean roster projection: list-view columns only (heavy editor-only blobs
    // blank). The editor re-hydrates full fidelity via `get_persona_detail`.
    match lifecycle {
        Some(stages) if !stages.is_empty() => {
            let refs: Vec<&str> = stages.iter().map(|s| s.as_str()).collect();
            repo::get_all_by_lifecycle_lean(&state.db, &refs)
        }
        _ => repo::get_all_lean(&state.db),
    }
}

/// Archive a persona: move it to lifecycle `archived` (preserving ALL history —
/// no cascade). Blocked for system-origin personas. Returns the updated row.
#[tauri::command]
#[requires(auth)]
pub fn archive_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<Persona, AppError> {
    repo::archive_persona(&state.db, &id)
}

/// Restore an archived persona back to lifecycle `active`. Returns the updated row.
#[tauri::command]
#[requires(auth)]
pub fn restore_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<Persona, AppError> {
    repo::restore_persona(&state.db, &id)
}

/// Bulk-delete personas in one IPC, returning a per-id outcome
/// (`deleted` | `protected` | `failed`). Replaces the frontend's N sequential
/// `delete_persona` calls for the "delete drafts" / batch-delete paths.
#[tauri::command]
#[requires(auth)]
pub fn bulk_delete_personas(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<Vec<BulkDeleteOutcome>, AppError> {
    repo::bulk_delete_personas(&state.db, &ids)
}

#[tauri::command]
#[requires(auth)]
pub fn get_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<Persona, AppError> {
    repo::get_by_id(&state.db, &id)
}

/// Star/unstar a persona. A starred persona is in the Director's coaching
/// scope (the Director batch only reviews starred personas). Returns the new
/// starred value.
#[tauri::command]
#[requires(auth)]
pub fn set_persona_starred(
    state: State<'_, Arc<AppState>>,
    id: String,
    starred: bool,
) -> Result<bool, AppError> {
    repo::set_starred(&state.db, &id, starred)
}

#[tauri::command]
#[requires(auth)]
pub fn create_persona(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaInput,
) -> Result<Persona, AppError> {
    validate_create_persona(&input)?;
    repo::create(&state.db, input)
}

fn validate_create_persona(input: &CreatePersonaInput) -> Result<(), AppError> {
    let mut errors = Vec::new();
    errors.extend(pv::validate_name(&input.name));
    errors.extend(pv::validate_system_prompt(&input.system_prompt));
    if let Some(ref sp) = input.structured_prompt {
        errors.extend(pv::validate_structured_prompt(sp));
    }
    if let Some(v) = input.max_concurrent {
        errors.extend(pv::validate_max_concurrent(v));
    }
    if let Some(v) = input.timeout_ms {
        errors.extend(pv::validate_timeout_ms(v));
    }
    if let Some(v) = input.max_budget_usd {
        errors.extend(pv::validate_max_budget_usd(v));
    }
    if let Some(v) = input.max_turns {
        errors.extend(pv::validate_max_turns(v));
    }
    if let Some(ref channels) = input.notification_channels {
        errors.extend(pv::validate_notification_channels(channels));
    }
    check(errors)
}

fn validate_update_persona(input: &UpdatePersonaInput) -> Result<(), AppError> {
    let mut errors = Vec::new();
    if let Some(ref name) = input.name {
        errors.extend(pv::validate_name(name));
    }
    if let Some(ref prompt) = input.system_prompt {
        errors.extend(pv::validate_system_prompt(prompt));
    }
    if let Some(Some(ref sp)) = input.structured_prompt {
        errors.extend(pv::validate_structured_prompt(sp));
    }
    if let Some(v) = input.max_concurrent {
        errors.extend(pv::validate_max_concurrent(v));
    }
    if let Some(v) = input.timeout_ms {
        errors.extend(pv::validate_timeout_ms(v));
    }
    if let Some(Some(v)) = input.max_budget_usd {
        errors.extend(pv::validate_max_budget_usd(v));
    }
    if let Some(Some(v)) = input.max_turns {
        errors.extend(pv::validate_max_turns(v));
    }
    if let Some(ref channels) = input.notification_channels {
        errors.extend(pv::validate_notification_channels(channels));
    }
    check(errors)
}

#[tauri::command]
#[requires(auth)]
pub fn update_persona(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdatePersonaInput,
) -> Result<Persona, AppError> {
    validate_update_persona(&input)?;
    let result = repo::update(&state.db, &id, input)?;
    // Invalidate cached session AFTER successful DB update
    let pool = state.session_pool.clone();
    let pid = id.clone();
    tauri::async_runtime::spawn(async move {
        pool.invalidate(&pid).await;
    });

    // Auto-sync to cloud if connected (fire-and-forget).
    // Use the already-fetched result to avoid re-reading stale data if
    // another update races with the sync task.
    let cloud_client = state.cloud_client.clone();
    let db = state.db.clone();
    let sync_id = id.clone();
    let sync_persona = result.clone();
    tauri::async_runtime::spawn(async move {
        let client = match cloud_client.lock().await.clone() {
            Some(c) => c,
            None => return, // not connected to cloud — nothing to sync
        };
        // Check if there is an active deployment for this persona
        let deployments = match client.list_deployments().await {
            Ok(d) => d,
            Err(_) => return,
        };
        let has_deployment = deployments.iter().any(|d| d.persona_id == sync_id);
        if !has_deployment {
            return;
        }
        // Use the already-updated persona snapshot; only tools need a DB read
        let tools_list =
            match crate::db::repos::resources::tools::get_tools_for_persona(&db, &sync_id) {
                Ok(t) => t,
                Err(_) => return,
            };
        let prompt = engine::prompt::assemble_prompt(
            &sync_persona,
            &tools_list,
            None,
            None,
            None,
            None,
            #[cfg(feature = "desktop")]
            None,
        );
        let body = serde_json::json!({
            "id": sync_persona.id,
            "name": sync_persona.name,
            "description": sync_persona.description,
            "systemPrompt": prompt,
            "structuredPrompt": sync_persona.structured_prompt,
            "icon": sync_persona.icon,
            "color": sync_persona.color,
            "enabled": sync_persona.enabled,
            "maxConcurrent": sync_persona.max_concurrent,
            "timeoutMs": sync_persona.timeout_ms,
            "modelProfile": sync_persona.model_profile,
            "maxBudgetUsd": sync_persona.max_budget_usd,
            "maxTurns": sync_persona.max_turns,
            "designContext": sync_persona.design_context,
            "homeTeamId": sync_persona.home_team_id,
        });
        if let Err(e) = client.upsert_persona(&body).await {
            tracing::warn!(persona_id = %sync_id, error = %e, "Background cloud sync failed");
        } else {
            tracing::info!(persona_id = %sync_id, "Persona auto-synced to cloud after update");
        }
    });

    Ok(result)
}

/// Maximum allowed size for the parameters JSON field (64 KB).
const MAX_PARAMETERS_JSON_SIZE: usize = 65_536;

/// Lightweight parameter-only update — invalidates cached sessions so the
/// engine picks up the new parameter values immediately.
#[tauri::command]
#[requires(auth)]
pub fn update_persona_parameters(
    state: State<'_, Arc<AppState>>,
    id: String,
    parameters: Option<String>,
) -> Result<Persona, AppError> {

    // Validate the parameters JSON before storing
    if let Some(ref params_json) = parameters {
        if params_json.len() > MAX_PARAMETERS_JSON_SIZE {
            return Err(AppError::Validation(format!(
                "Parameters JSON exceeds maximum size of {} bytes",
                MAX_PARAMETERS_JSON_SIZE
            )));
        }
        // Verify it's valid JSON
        if !params_json.is_empty() {
            serde_json::from_str::<serde_json::Value>(params_json)
                .map_err(|e| AppError::Validation(format!("Parameters must be valid JSON: {e}")))?;
        }
    }

    let result = repo::update(
        &state.db,
        &id,
        UpdatePersonaInput {
            parameters: Some(parameters),
            ..Default::default()
        },
    )?;

    // Invalidate cached session so the engine uses updated parameter values
    let pool = state.session_pool.clone();
    let pid = id.clone();
    tauri::async_runtime::spawn(async move {
        pool.invalidate(&pid).await;
    });

    // Auto-sync to cloud if connected (fire-and-forget).
    // Use the already-fetched result to avoid re-reading stale data.
    let cloud_client = state.cloud_client.clone();
    let db = state.db.clone();
    let sync_id = id.clone();
    let sync_persona = result.clone();
    tauri::async_runtime::spawn(async move {
        let client = match cloud_client.lock().await.clone() {
            Some(c) => c,
            None => return,
        };
        let deployments = match client.list_deployments().await {
            Ok(d) => d,
            Err(_) => return,
        };
        if !deployments.iter().any(|d| d.persona_id == sync_id) {
            return;
        }
        let tools_list =
            match crate::db::repos::resources::tools::get_tools_for_persona(&db, &sync_id) {
                Ok(t) => t,
                Err(_) => return,
            };
        let prompt = engine::prompt::assemble_prompt(
            &sync_persona,
            &tools_list,
            None,
            None,
            None,
            None,
            #[cfg(feature = "desktop")]
            None,
        );
        let body = serde_json::json!({
            "id": sync_persona.id,
            "name": sync_persona.name,
            "description": sync_persona.description,
            "systemPrompt": prompt,
            "structuredPrompt": sync_persona.structured_prompt,
            "icon": sync_persona.icon,
            "color": sync_persona.color,
            "enabled": sync_persona.enabled,
            "maxConcurrent": sync_persona.max_concurrent,
            "timeoutMs": sync_persona.timeout_ms,
            "modelProfile": sync_persona.model_profile,
            "maxBudgetUsd": sync_persona.max_budget_usd,
            "maxTurns": sync_persona.max_turns,
            "designContext": sync_persona.design_context,
            "homeTeamId": sync_persona.home_team_id,
        });
        if let Err(e) = client.upsert_persona(&body).await {
            tracing::warn!(persona_id = %sync_id, error = %e, "Background cloud sync failed after parameter update");
        } else {
            tracing::info!(persona_id = %sync_id, "Persona auto-synced to cloud after parameter update");
        }
    });

    Ok(result)
}

/// Reconcile a persona's `persona.parameters` + injected `## Capability Parameters`
/// section against the recipe params declared by its current
/// `design_context.useCases`. Idempotent — safe to call after any catalog adopt
/// or remove (Gap 2). Derives params from every use case's `input_schema`,
/// merges them UNDER the existing param set (existing/template/user-tuned keys
/// win; new keys appended), and re-injects the section into
/// `structured_prompt.instructions` (stripping any prior copy). Params for a
/// removed capability are left in place (inert) but its section lines drop out.
#[tauri::command]
#[requires(auth)]
pub fn sync_capability_parameters(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Persona, AppError> {
    use crate::engine::recipe_parameters as rp;

    let persona = repo::get_by_id(&state.db, &persona_id)?;

    // Collect the use cases from design_context.
    let use_cases: Vec<serde_json::Value> = persona
        .design_context
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|ctx| ctx.get("useCases").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();

    // Resolve each use case's input_schema to the AUTHORITATIVE recipe source.
    // A catalog-adopted UC may carry only a lossy display projection (or no
    // input_schema at all), so prefer the recipe row's schema via
    // `source_recipe_id`; fall back to an inline `input_schema` (Foundry /
    // promote / instant_adopt UCs carry the full array).
    let enriched: Vec<serde_json::Value> = use_cases
        .iter()
        .filter_map(|uc| {
            let title = uc
                .get("title")
                .or_else(|| uc.get("name"))
                .cloned()
                .unwrap_or_else(|| serde_json::Value::String("Capability".into()));
            let schema = uc
                .get("source_recipe_id")
                .and_then(|v| v.as_str())
                .and_then(|rid| {
                    crate::db::repos::resources::recipes::get_by_id(&state.db, rid).ok()
                })
                .and_then(|recipe| {
                    serde_json::from_str::<serde_json::Value>(&recipe.prompt_template).ok()
                })
                .and_then(|tpl| tpl.get("input_schema").cloned())
                .filter(|s| s.is_array())
                .or_else(|| uc.get("input_schema").cloned().filter(|s| s.is_array()))?;
            Some(serde_json::json!({ "title": title, "input_schema": schema }))
        })
        .collect();

    let caps = rp::derive_capability_params_from_values(&enriched);

    // Merge derived params under the existing set (existing wins).
    let existing_params: Vec<serde_json::Value> = persona
        .parameters
        .as_deref()
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(s).ok())
        .unwrap_or_default();
    let derived = rp::to_parameter_values(&caps);
    let merged = rp::merge_persona_parameters(&existing_params, &derived);
    let parameters_json = serde_json::to_string(&merged)
        .map_err(|e| AppError::Validation(format!("failed to serialize parameters: {e}")))?;

    // Re-inject the section into structured_prompt.instructions (idempotent).
    let structured_prompt_json = match persona.structured_prompt.as_deref() {
        Some(s) if !s.is_empty() => {
            let mut sp: serde_json::Value = serde_json::from_str(s)
                .map_err(|e| AppError::Validation(format!("invalid structured_prompt JSON: {e}")))?;
            rp::inject_into_structured_prompt(&mut sp, &caps);
            Some(
                serde_json::to_string(&sp).map_err(|e| {
                    AppError::Validation(format!("failed to serialize structured_prompt: {e}"))
                })?,
            )
        }
        // No structured prompt to inject into — params still seeded so the
        // parameters editor surfaces them; the section lands if a structured
        // prompt is later created.
        _ => None,
    };

    let result = repo::update(
        &state.db,
        &persona_id,
        UpdatePersonaInput {
            parameters: Some(Some(parameters_json)),
            structured_prompt: structured_prompt_json.map(Some),
            ..Default::default()
        },
    )?;

    // Invalidate cached session so the engine picks up the new params/prompt.
    let pool = state.session_pool.clone();
    let pid = persona_id.clone();
    tauri::async_runtime::spawn(async move {
        pool.invalidate(&pid).await;
    });

    Ok(result)
}

/// Result of duplicating a persona: the new persona plus an honest account of
/// what its wiring copy did. `triggers`/`subscriptions` are cloned onto the
/// copy **disabled**; `automations`/`tools`/`credentialLinks` are shared or
/// skipped (reported, not cloned) so the duplicate flow can tell the user
/// exactly what carried over.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePersonaResult {
    #[serde(flatten)]
    pub persona: Persona,
    pub triggers_copied: usize,
    pub subscriptions_copied: usize,
    pub automations_skipped: usize,
    pub tools_shared: usize,
    pub credential_links_shared: usize,
}

#[tauri::command]
#[requires(auth)]
pub fn duplicate_persona(
    state: State<'_, Arc<AppState>>,
    source_id: String,
) -> Result<DuplicatePersonaResult, AppError> {
    let (persona, summary) = repo::duplicate(&state.db, &source_id)?;

    // Validate the duplicated persona against current rules. The source may
    // pre-date stricter validation, and the " (Copy)" suffix could push the
    // name beyond limits. Log warnings but don't fail the duplication.
    let mut warnings = Vec::new();
    warnings.extend(pv::validate_name(&persona.name));
    warnings.extend(pv::validate_system_prompt(&persona.system_prompt));
    if !warnings.is_empty() {
        tracing::warn!(
            source_id = %source_id,
            new_id = %persona.id,
            warnings = ?warnings,
            "Duplicated persona has validation warnings against current rules"
        );
    }

    Ok(DuplicatePersonaResult {
        persona,
        triggers_copied: summary.triggers_copied,
        subscriptions_copied: summary.subscriptions_copied,
        automations_skipped: summary.automations_skipped,
        tools_shared: summary.tools_shared,
        credential_links_shared: summary.credential_links_shared,
    })
}

#[tauri::command]
#[requires(auth)]
pub fn get_persona_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaSummary>, AppError> {
    repo::get_summaries(&state.db)
}

/// Batched persona detail: persona + tools + triggers + subscriptions + automations
/// in a single IPC round trip.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDetail {
    #[serde(flatten)]
    pub persona: Persona,
    pub tools: Vec<PersonaToolDefinition>,
    pub triggers: Vec<PersonaTrigger>,
    pub subscriptions: Vec<PersonaEventSubscription>,
    pub automations: Vec<PersonaAutomation>,
    /// Non-empty when one or more sub-resource queries failed.
    /// Each entry describes which resource could not be loaded.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[tauri::command]
#[requires(auth)]
pub fn get_persona_detail(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaDetail, AppError> {
    let persona = repo::get_by_id(&state.db, &id)?;

    let mut warnings: Vec<String> = Vec::new();

    let tools = match tool_repo::get_tools_for_persona(&state.db, &id) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(persona_id = %id, error = %e, "Failed to load tools for persona");
            warnings.push("Tools could not be loaded".into());
            Vec::new()
        }
    };

    let triggers = match trigger_repo::get_by_persona_id(&state.db, &id) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(persona_id = %id, error = %e, "Failed to load triggers for persona");
            warnings.push("Triggers could not be loaded".into());
            Vec::new()
        }
    };

    let subscriptions = match event_repo::get_subscriptions_by_persona(&state.db, &id) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(persona_id = %id, error = %e, "Failed to load subscriptions for persona");
            warnings.push("Event subscriptions could not be loaded".into());
            Vec::new()
        }
    };

    let automations = match automation_repo::get_by_persona(&state.db, &id) {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(persona_id = %id, error = %e, "Failed to load automations for persona");
            warnings.push("Automations could not be loaded".into());
            Vec::new()
        }
    };

    Ok(PersonaDetail {
        persona,
        tools,
        triggers,
        subscriptions,
        automations,
        warnings,
    })
}

/// Returns persona IDs that have at least one tool whose
/// `requires_credential_type` matches the given connector name. Cheap,
/// single-query lookup used by the Agents sidebar to surface personas
/// linked to a specific connector (e.g. `"codebase"`) without paying
/// the cost of fetching every persona's full detail.
#[tauri::command]
#[requires(auth)]
pub fn list_personas_using_connector(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<Vec<String>, AppError> {
    tool_repo::list_persona_ids_using_connector(&state.db, &connector_name)
}

/// Result of a persona deletion, reporting what happened to running executions.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DeletePersonaResult {
    /// True if the persona was successfully deleted from the database.
    pub deleted: bool,
    /// Number of executions that were cleanly cancelled via the engine.
    pub executions_cancelled: usize,
    /// Number of executions that had to be force-marked as cancelled in DB.
    pub executions_force_cancelled: usize,
    /// True if the drain timeout was reached before all engine slots cleared.
    pub timeout_reached: bool,
    /// IDs of executions that could not be cancelled or force-marked.
    pub cancel_failures: Vec<String>,
}

/// Pre-delete impact summary for a persona.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BlastRadiusItem {
    pub category: String,
    pub description: String,
}

#[tauri::command]
#[requires(auth)]
pub fn persona_blast_radius(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<BlastRadiusItem>, AppError> {
    let items = repo::blast_radius(&state.db, &id)?;
    Ok(items
        .into_iter()
        .map(|(category, description)| BlastRadiusItem {
            category,
            description,
        })
        .collect())
}

/// Reason a persona must not be deleted, or `None` when deletion is allowed.
/// System-origin personas (e.g. the Director) are protected. Kept as a pure,
/// side-effect-free function so the most safety-critical guard on the delete
/// path is unit-testable without constructing the full `AppState`/`AppHandle`
/// the `delete_persona` command otherwise requires.
fn deletion_forbidden_reason(persona: &Persona) -> Option<String> {
    if persona.trust_origin == crate::db::models::PersonaTrustOrigin::System {
        Some(format!(
            "'{}' is a system persona and cannot be deleted.",
            persona.name
        ))
    } else {
        None
    }
}

/// Maximum time to wait for engine slots to clear during persona deletion.
const DELETION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// Poll interval when waiting for engine slots to drain.
const DELETION_DRAIN_POLL: std::time::Duration = std::time::Duration::from_millis(250);

#[tauri::command]
#[requires(auth)]
pub async fn delete_persona(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<DeletePersonaResult, AppError> {

    // ── Phase 1: Mark persona as "deleting" to block new executions ──
    state.engine.mark_deleting(&id).await;

    // Ensure we always unmark on early return / error
    let state_ref: &Arc<AppState> = &state;
    let result = delete_persona_inner(state_ref, &app, &id).await;

    // Clean up the deleting marker regardless of outcome
    state.engine.unmark_deleting(&id).await;

    result
}

/// Inner two-phase deletion logic, separated so the caller can guarantee
/// cleanup of the `deleting_personas` marker via `unmark_deleting`.
async fn delete_persona_inner(
    state: &Arc<AppState>,
    app: &AppHandle,
    id: &str,
) -> Result<DeletePersonaResult, AppError> {
    // ── Phase 1a: Protect system-owned personas (the Director) from deletion ──
    // Capture the persona's custom-icon asset id (if any) so we can reclaim the
    // orphaned icon file after the row is gone.
    let mut custom_icon_asset: Option<String> = None;
    if let Ok(persona) = repo::get_by_id(&state.db, id) {
        if let Some(reason) = deletion_forbidden_reason(&persona) {
            return Err(AppError::Forbidden(reason));
        }
        custom_icon_asset = persona
            .icon
            .as_deref()
            .and_then(|i| i.strip_prefix("custom-icon:"))
            .map(|s| s.to_string());
    }

    // ── Phase 1b: Cancel all running/queued executions for this persona ──
    let running = match exec_repo::get_running(&state.db) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(
                persona_id = %id,
                error = %e,
                "Failed to query running executions before persona deletion"
            );
            return Err(AppError::Internal(format!(
                "Cannot safely delete persona {id}: failed to check running executions"
            )));
        }
    };

    let mut cleanly_cancelled: usize = 0;
    let mut force_cancelled: Vec<String> = Vec::new();
    let mut cancel_failures: Vec<String> = Vec::new();

    for exec in &running {
        if exec.persona_id == id {
            let cancelled = state
                .engine
                .cancel_execution(&exec.id, &state.db, Some(id))
                .await;
            if cancelled {
                cleanly_cancelled += 1;
            } else {
                tracing::warn!(
                    persona_id = %id,
                    execution_id = %exec.id,
                    "Engine failed to cancel execution; force-marking as cancelled in DB"
                );
                // Force-mark the execution as cancelled in DB to prevent orphaned runs
                if let Err(e) = exec_repo::update_status(
                    &state.db,
                    &exec.id,
                    UpdateExecutionStatus {
                        status: ExecutionState::Cancelled,
                        error_message: Some("Force-cancelled during persona deletion".into()),
                        ..Default::default()
                    },
                ) {
                    tracing::error!(
                        persona_id = %id,
                        execution_id = %exec.id,
                        error = %e,
                        "Failed to mark orphaned execution as cancelled"
                    );
                    cancel_failures.push(exec.id.clone());
                } else {
                    force_cancelled.push(exec.id.clone());
                }
            }
        }
    }

    // Log force-cancelled executions as warnings
    for exec_id in &force_cancelled {
        tracing::warn!(
            persona_id = %id,
            execution_id = %exec_id,
            "Execution was force-cancelled during persona deletion (engine cancel failed)"
        );
    }

    if !cancel_failures.is_empty() {
        tracing::error!(
            persona_id = %id,
            failed_executions = ?cancel_failures,
            "Some executions could not be cancelled or marked during persona deletion"
        );
    }

    // ── Phase 2: Wait for engine tracker to confirm all slots are cleared ──
    let mut timeout_reached = false;
    let deadline = tokio::time::Instant::now() + DELETION_DRAIN_TIMEOUT;
    loop {
        if state.engine.all_slots_cleared(id).await {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            tracing::warn!(
                persona_id = %id,
                "Timed out waiting for engine slots to clear; force-cancelling remaining executions"
            );
            timeout_reached = true;
            break;
        }
        tokio::time::sleep(DELETION_DRAIN_POLL).await;
    }

    // ── Phase 2b: Force-cancel any remaining stale executions after timeout ──
    // This prevents active tasks from writing to DB rows that are about
    // to be CASCADE-deleted, which would cause silent data corruption or
    // foreign-key constraint violations.
    if timeout_reached {
        let force_count = state
            .engine
            .force_cancel_all_for_persona(id, &state.db)
            .await;
        // Extend the force_cancelled list with placeholder IDs for the
        // post-timeout sweep so the count is accurately reported.
        for i in 0..force_count {
            force_cancelled.push(format!("post-timeout-{i}"));
        }
    }

    // ── Phase 2c: Finalize the delete ──
    let deleted = repo::delete(&state.db, id)?;

    // ── Phase 2d: Reclaim the persona's custom icon file if nothing else uses
    // it. Without this, deleting a persona orphans its uploaded/AI-generated
    // icon PNG on disk forever. Best-effort — never fails the deletion.
    if deleted {
        if let Some(asset_id) = custom_icon_asset {
            crate::commands::core::persona_icons::delete_icon_file_if_orphaned(
                state, app, &asset_id,
            );
        }
    }

    Ok(DeletePersonaResult {
        deleted,
        executions_cancelled: cleanly_cancelled,
        executions_force_cancelled: force_cancelled.len(),
        timeout_reached,
        cancel_failures,
    })
}

/// Resolve the effective model configuration for a persona, showing the
/// cascaded result of global -> workspace -> agent-level overrides.
#[tauri::command]
#[requires(auth)]
pub fn resolve_effective_config(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<EffectiveModelConfig, AppError> {
    let persona = repo::get_by_id(&state.db, &persona_id)?;
    let workspace = persona
        .home_team_id
        .as_deref()
        .and_then(|tid| team_repo::get_by_id(&state.db, tid).ok());
    Ok(config_merge::resolve_effective_config(
        &state.db,
        &persona,
        workspace.as_ref(),
    ))
}

/// Resolve effective model config for many personas in a single IPC call.
///
/// The per-persona `resolve_effective_config` command was being fanned out
/// one IPC + ~4 DB queries per persona by the Settings → Config panel —
/// ~142 personas turned that page's cold mount into 10 s of IPC traffic
/// (measured in the 2026-05-21 perf-walk). This bulk variant fetches all
/// personas, all groups, and the global-tier settings exactly once, then
/// resolves entirely in memory: N IPC roundtrips collapse to 1, and
/// ~4·N DB queries collapse to ~4 total.
///
/// IDs that don't match a persona are silently skipped, so the result
/// vector may be shorter than `persona_ids` and is keyed by `personaId`.
#[tauri::command]
#[requires(auth)]
pub fn resolve_effective_config_bulk(
    state: State<'_, Arc<AppState>>,
    persona_ids: Vec<String>,
) -> Result<Vec<EffectiveModelConfig>, AppError> {
    // Global tier — three DB reads, shared across every persona below.
    let ctx = config_merge::GlobalConfigContext::load(&state.db);

    // One query each for personas and home-teams; index by id for O(1) lookup.
    let personas = repo::get_all(&state.db)?;
    let persona_by_id: std::collections::HashMap<&str, &Persona> =
        personas.iter().map(|p| (p.id.as_str(), p)).collect();
    let teams = team_repo::get_all(&state.db)?;
    let team_by_id: std::collections::HashMap<&str, &PersonaTeam> =
        teams.iter().map(|t| (t.id.as_str(), t)).collect();

    let mut out = Vec::with_capacity(persona_ids.len());
    for id in &persona_ids {
        let Some(persona) = persona_by_id.get(id.as_str()) else {
            continue;
        };
        let workspace = persona
            .home_team_id
            .as_deref()
            .and_then(|tid| team_by_id.get(tid).copied());
        out.push(config_merge::resolve_effective_config_with_globals(
            persona, workspace, &ctx,
        ));
    }
    Ok(out)
}

// ===========================================================================
// Delete-drain tests
//
// The `delete_persona` command owns the app's most safety-critical path: a
// two-phase drain (mark_deleting → cancel running/queued → wait ≤15s for slots
// to clear → force-cancel survivors → cascade delete). The full command wrapper
// needs a real `AppState` + Tauri `AppHandle`, neither of which is constructible
// in a unit test (AppState has ~30 live subsystems; no `tauri::test` harness is
// wired in this crate). So we test the drain at the seams we CAN reach honestly:
//   1. the pure system-persona protection guard (`deletion_forbidden_reason`),
//   2. the engine drain primitives the command orchestrates
//      (`mark_deleting` gate, `all_slots_cleared` wait condition,
//      `force_cancel_all_for_persona` post-timeout sweep) on a real
//      `ExecutionEngine` + temp DB,
//   3. cascade completeness of the final `repo::delete` (memories/events gone,
//      target events source-nulled).
// The one piece NOT covered end-to-end is the command's own sequencing glue
// (the loop + timeout arithmetic in `delete_persona_inner`), which is unreachable
// without AppState — documented here rather than faked.
// ===========================================================================
#[cfg(test)]
mod drain_tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::PersonaTrustOrigin;
    use crate::db::DbPool;
    use crate::engine::background::SchedulerState;
    use crate::engine::ExecutionEngine;

    fn mk_persona(pool: &DbPool, name: &str) -> Persona {
        repo::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "You are a helpful assistant.".into(),
                project_id: None,
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
        .unwrap()
    }

    fn mk_engine() -> ExecutionEngine {
        let scheduler = std::sync::Arc::new(SchedulerState::new());
        // pool = None → headless engine (no resource governor spawned); the drain
        // primitives operate on the in-memory tracker + a pool passed per call.
        ExecutionEngine::new(std::env::temp_dir(), scheduler, None)
    }

    fn insert_execution(pool: &DbPool, persona_id: &str, status: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO persona_executions (id, persona_id, status, created_at) \
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, persona_id, status, now],
            )
            .unwrap();
        id
    }

    fn exec_status(pool: &DbPool, exec_id: &str) -> String {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT status FROM persona_executions WHERE id = ?1",
                rusqlite::params![exec_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
    }

    // ── Scenario 1: system-persona protection ──
    #[test]
    fn test_system_persona_is_deletion_protected() {
        let pool = init_test_db().unwrap();
        let p = mk_persona(&pool, "Ordinary");
        assert!(
            deletion_forbidden_reason(&p).is_none(),
            "a normal persona must be deletable"
        );

        // Promote to system origin (the Director's classification).
        pool.get()
            .unwrap()
            .execute(
                "UPDATE personas SET trust_origin = 'system' WHERE id = ?1",
                rusqlite::params![p.id],
            )
            .unwrap();
        let sys = repo::get_by_id(&pool, &p.id).unwrap();
        assert_eq!(sys.trust_origin, PersonaTrustOrigin::System);
        let reason = deletion_forbidden_reason(&sys);
        assert!(reason.is_some(), "system personas must be protected");
        assert!(reason.unwrap().contains("system persona"));
    }

    // ── Scenario 2a: the drain wait condition + new-execution gate ──
    #[tokio::test]
    async fn test_drain_gate_and_wait_condition() {
        let pool = init_test_db().unwrap();
        let engine = mk_engine();
        let p = mk_persona(&pool, "Drainable");

        // Fresh persona: no slots tracked → the wait loop would exit immediately.
        assert!(engine.all_slots_cleared(&p.id).await);
        assert!(!engine.is_deleting(&p.id).await);

        // Phase 1: mark_deleting blocks new executions; a running slot means the
        // wait condition is NOT yet satisfied.
        engine.mark_deleting(&p.id).await;
        assert!(engine.is_deleting(&p.id).await);
        let exec_id = insert_execution(&pool, &p.id, "running");
        engine.tracker().lock().await.add_running(&p.id, &exec_id);
        assert!(
            !engine.all_slots_cleared(&p.id).await,
            "a tracked running slot must keep the drain waiting"
        );

        // Cleanup marker is always removed (mirrors the command's guaranteed unmark).
        engine.unmark_deleting(&p.id).await;
        assert!(!engine.is_deleting(&p.id).await);
    }

    // ── Scenario 2b: force-cancel survivors after the drain timeout ──
    #[tokio::test]
    async fn test_force_cancel_after_timeout_sweep() {
        let pool = init_test_db().unwrap();
        let engine = mk_engine();
        let p = mk_persona(&pool, "Stuck");

        // Two running slots that never clear (simulating a wedged CLI process).
        let e1 = insert_execution(&pool, &p.id, "running");
        let e2 = insert_execution(&pool, &p.id, "running");
        {
            let mut t = engine.tracker().lock().await;
            t.add_running(&p.id, &e1);
            t.add_running(&p.id, &e2);
        }
        assert!(!engine.all_slots_cleared(&p.id).await);

        // The post-timeout force-cancel sweep (Phase 2b of the command).
        let forced = engine.force_cancel_all_for_persona(&p.id, &pool).await;
        assert_eq!(forced, 2, "both wedged executions must be force-cancelled");

        // Slots are cleared and DB rows are now terminal (won't write to a row
        // about to be cascade-deleted).
        assert!(engine.all_slots_cleared(&p.id).await);
        assert_eq!(exec_status(&pool, &e1), "cancelled");
        assert_eq!(exec_status(&pool, &e2), "cancelled");
    }

    // ── Scenario 3: cascade completeness of the final delete ──
    #[test]
    fn test_delete_cascade_is_complete() {
        let pool = init_test_db().unwrap();
        let victim = mk_persona(&pool, "Victim");
        let bystander = mk_persona(&pool, "Bystander");
        let now = chrono::Utc::now().to_rfc3339();

        {
            let conn = pool.get().unwrap();
            // A learned memory (FK cascade on delete).
            conn.execute(
                "INSERT INTO persona_memories (id, persona_id, title, content, created_at, updated_at) \
                 VALUES (?1, ?2, 'm', 'c', ?3, ?3)",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), victim.id, now],
            )
            .unwrap();
            // An event the victim SOURCED (polymorphic source_id → hard-deleted).
            conn.execute(
                "INSERT INTO persona_events (id, event_type, source_type, source_id, created_at) \
                 VALUES (?1, 'x', 'persona', ?2, ?3)",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), victim.id, now],
            )
            .unwrap();
            // An event that merely TARGETS the victim (FK set-null → survives).
            conn.execute(
                "INSERT INTO persona_events (id, event_type, source_type, source_id, target_persona_id, created_at) \
                 VALUES (?1, 'y', 'persona', ?2, ?3, ?4)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    bystander.id,
                    victim.id,
                    now
                ],
            )
            .unwrap();
        }

        assert!(repo::delete(&pool, &victim.id).unwrap());
        assert!(repo::get_by_id(&pool, &victim.id).is_err(), "persona row gone");

        let conn = pool.get().unwrap();
        let memories: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?1",
                rusqlite::params![victim.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(memories, 0, "memories must cascade-delete");

        let sourced: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_events WHERE source_id = ?1",
                rusqlite::params![victim.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sourced, 0, "events sourced by the persona are deleted");

        let targeted_survivors: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_events WHERE target_persona_id = ?1",
                rusqlite::params![victim.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            targeted_survivors, 0,
            "targeting FK must be set NULL, not left dangling"
        );
        // The bystander's event row still exists (only its target was nulled).
        let bystander_events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_events WHERE source_id = ?1",
                rusqlite::params![bystander.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bystander_events, 1, "unrelated event history is preserved");
    }
}
