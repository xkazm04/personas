use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{
    CreatePersonaInput, Persona, PersonaAutomation, PersonaEventSubscription, PersonaSummary,
    PersonaToolDefinition, PersonaTrigger, UpdateExecutionStatus, UpdatePersonaInput,
};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::groups as group_repo;
use crate::db::repos::core::personas as repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::automations as automation_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::engine::config_merge::{self, EffectiveModelConfig};
use crate::engine::types::ExecutionState;
use crate::engine;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::validation::contract::check;
use crate::validation::persona as pv;
use crate::AppState;

#[tauri::command]
pub fn list_personas(state: State<'_, Arc<AppState>>) -> Result<Vec<Persona>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_persona(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaInput,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
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
pub fn update_persona(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdatePersonaInput,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    validate_update_persona(&input)?;
    let result = repo::update(&state.db, &id, input)?;
    // Invalidate cached session AFTER successful DB update
    let pool = state.session_pool.clone();
    let pid = id.clone();
    tauri::async_runtime::spawn(async move { pool.invalidate(&pid).await; });

    // Auto-sync to cloud if connected (fire-and-forget)
    let cloud_client = state.cloud_client.clone();
    let db = state.db.clone();
    let sync_id = id.clone();
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
        // Re-read persona + tools and upsert to cloud
        let persona = match crate::db::repos::core::personas::get_by_id(&db, &sync_id) {
            Ok(p) => p,
            Err(_) => return,
        };
        let tools_list = match crate::db::repos::resources::tools::get_tools_for_persona(&db, &sync_id) {
            Ok(t) => t,
            Err(_) => return,
        };
        let prompt = engine::prompt::assemble_prompt(&persona, &tools_list, None, None, None, #[cfg(feature = "desktop")] None);
        let body = serde_json::json!({
            "id": persona.id,
            "name": persona.name,
            "description": persona.description,
            "systemPrompt": prompt,
            "structuredPrompt": persona.structured_prompt,
            "icon": persona.icon,
            "color": persona.color,
            "enabled": true,
            "maxConcurrent": persona.max_concurrent,
            "timeoutMs": persona.timeout_ms,
            "modelProfile": persona.model_profile,
            "maxBudgetUsd": persona.max_budget_usd,
            "maxTurns": persona.max_turns,
            "designContext": persona.design_context,
            "groupId": persona.group_id,
        });
        if let Err(e) = client.upsert_persona(&body).await {
            tracing::warn!(persona_id = %sync_id, error = %e, "Background cloud sync failed");
        } else {
            tracing::info!(persona_id = %sync_id, "Persona auto-synced to cloud after update");
        }
    });

    Ok(result)
}

/// Lightweight parameter-only update — invalidates cached sessions so the
/// engine picks up the new parameter values immediately.
#[tauri::command]
pub fn update_persona_parameters(
    state: State<'_, Arc<AppState>>,
    id: String,
    parameters: Option<String>,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
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
    tauri::async_runtime::spawn(async move { pool.invalidate(&pid).await; });

    // Auto-sync to cloud if connected (fire-and-forget)
    let cloud_client = state.cloud_client.clone();
    let db = state.db.clone();
    let sync_id = id.clone();
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
        let persona = match crate::db::repos::core::personas::get_by_id(&db, &sync_id) {
            Ok(p) => p,
            Err(_) => return,
        };
        let tools_list = match crate::db::repos::resources::tools::get_tools_for_persona(&db, &sync_id) {
            Ok(t) => t,
            Err(_) => return,
        };
        let prompt = engine::prompt::assemble_prompt(&persona, &tools_list, None, None, None, #[cfg(feature = "desktop")] None);
        let body = serde_json::json!({
            "id": persona.id,
            "name": persona.name,
            "description": persona.description,
            "systemPrompt": prompt,
            "structuredPrompt": persona.structured_prompt,
            "icon": persona.icon,
            "color": persona.color,
            "enabled": true,
            "maxConcurrent": persona.max_concurrent,
            "timeoutMs": persona.timeout_ms,
            "modelProfile": persona.model_profile,
            "maxBudgetUsd": persona.max_budget_usd,
            "maxTurns": persona.max_turns,
            "designContext": persona.design_context,
            "groupId": persona.group_id,
        });
        if let Err(e) = client.upsert_persona(&body).await {
            tracing::warn!(persona_id = %sync_id, error = %e, "Background cloud sync failed after parameter update");
        } else {
            tracing::info!(persona_id = %sync_id, "Persona auto-synced to cloud after parameter update");
        }
    });

    Ok(result)
}

#[tauri::command]
pub fn duplicate_persona(
    state: State<'_, Arc<AppState>>,
    source_id: String,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    repo::duplicate(&state.db, &source_id)
}

#[tauri::command]
pub fn get_persona_summaries(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaSummary>, AppError> {
    require_auth_sync(&state)?;
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
pub fn get_persona_detail(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaDetail, AppError> {
    require_auth_sync(&state)?;
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
pub fn persona_blast_radius(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Vec<BlastRadiusItem>, AppError> {
    require_auth_sync(&state)?;
    let items = repo::blast_radius(&state.db, &id)?;
    Ok(items
        .into_iter()
        .map(|(category, description)| BlastRadiusItem { category, description })
        .collect())
}

/// Maximum time to wait for engine slots to clear during persona deletion.
const DELETION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// Poll interval when waiting for engine slots to drain.
const DELETION_DRAIN_POLL: std::time::Duration = std::time::Duration::from_millis(250);

#[tauri::command]
pub async fn delete_persona(state: State<'_, Arc<AppState>>, id: String) -> Result<DeletePersonaResult, AppError> {
    require_auth(&state).await?;

    // ── Phase 1: Mark persona as "deleting" to block new executions ──
    state.engine.mark_deleting(&id).await;

    // Ensure we always unmark on early return / error
    let state_ref: &Arc<AppState> = &state;
    let result = delete_persona_inner(state_ref, &id).await;

    // Clean up the deleting marker regardless of outcome
    state.engine.unmark_deleting(&id).await;

    result
}

/// Inner two-phase deletion logic, separated so the caller can guarantee
/// cleanup of the `deleting_personas` marker via `unmark_deleting`.
async fn delete_persona_inner(
    state: &Arc<AppState>,
    id: &str,
) -> Result<DeletePersonaResult, AppError> {
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
        for exec_id in &force_cancelled {
            // The earlier force_cancelled list already counted; only add
            // new ones discovered in the tracker after the drain loop.
            let _ = exec_id;
        }
        // Add force-cancelled count from the post-timeout sweep
        force_cancelled.reserve(force_count);
        // Note: individual IDs were already logged inside force_cancel_all_for_persona
    }

    // ── Phase 2c: Finalize the delete ──
    let deleted = repo::delete(&state.db, id)?;

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
pub fn resolve_effective_config(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<EffectiveModelConfig, AppError> {
    require_auth_sync(&state)?;
    let persona = repo::get_by_id(&state.db, &persona_id)?;
    let workspace = persona
        .group_id
        .as_deref()
        .and_then(|gid| group_repo::get_by_id(&state.db, gid).ok());
    Ok(config_merge::resolve_effective_config(
        &state.db,
        &persona,
        workspace.as_ref(),
    ))
}
