use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::db::models::*;
use crate::db::repos::core::personas::{self as persona_repo, row_to_persona};
use crate::db::repos::execution::metrics::{self as metrics_repo, row_to_prompt_version};
use crate::db::repos::lab;
use crate::db::repos::lab::arena as arena_repo;
use crate::db::repos::lab::ab as ab_repo;
use crate::db::repos::lab::matrix as matrix_repo;
use crate::db::repos::lab::eval as eval_repo;
use crate::db::repos::lab::ratings as ratings_repo;
use crate::db::repos::resources::tools::{self as tool_repo, row_to_tool_def};
use crate::engine::test_runner::{self, parse_model_configs};
use crate::engine::types::EphemeralPersona;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::validation;
use crate::AppState;

/// Cancel an active run (if registered) and wait briefly for the background task to wind down
/// before proceeding with deletion. All lab run types use the "test" domain.
async fn cancel_active_run_before_delete(state: &AppState, run_id: &str) {
    if state.process_registry.is_run_registered("test", run_id) {
        state.process_registry.cancel_run("test", run_id);
        // Give the background task up to 500ms to notice cancellation and unregister.
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if !state.process_registry.is_run_registered("test", run_id) {
                break;
            }
        }
        // Force-unregister if it didn't stop in time — the task will no-op on next DB write.
        state.process_registry.unregister_run("test", run_id);
    }
}

// ============================================================================
// Arena -- Multi-model comparison (mirrors existing test_runner flow)
// ============================================================================

#[tauri::command]
pub async fn lab_start_arena(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
) -> Result<LabArenaRun, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    let model_configs = parse_model_configs(models)?;

    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let run = arena_repo::create_run(&state.db, &persona_id, &models_json, use_case_filter.as_deref())?;
    let run_id = run.id.clone();

    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("test", &run_id);

    let pool = state.db.clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_arena_test(
            app,
            pool,
            run_id_clone.clone(),
            ephemeral,
            model_configs,
            std::env::temp_dir(),
            cancelled_clone,
            use_case_filter,
        )
        .await;
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_arena_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabArenaRun>, AppError> {
    require_auth_sync(&state)?;
    arena_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_arena_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabArenaResult>, AppError> {
    require_auth_sync(&state)?;
    arena_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub async fn lab_delete_arena_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    cancel_active_run_before_delete(&state, &id).await;
    arena_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_arena(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    state.process_registry.cancel_run("test", &id);
    let now = chrono::Utc::now().to_rfc3339();
    arena_repo::update_run_status(&state.db, &id, LabRunStatus::Cancelled, None, None, None, Some(&now))?;
    Ok(())
}

// ============================================================================
// A/B -- Prompt version comparison (multi-scenario, multi-model)
// ============================================================================

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn lab_start_ab(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    version_a_id: String,
    version_b_id: String,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
    test_input: Option<String>,
) -> Result<LabAbRun, AppError> {
    require_auth(&state).await?;

    // Snapshot persona, versions, and tools in a single read transaction to prevent
    // a concurrent persona update from creating a hybrid base+version state.
    let (persona, version_a, version_b, tools) = {
        let conn = state.db.get()?;
        let tx = conn.unchecked_transaction()?;

        let persona = tx.query_row(
            "SELECT * FROM personas WHERE id = ?1",
            params![persona_id],
            row_to_persona,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Persona {persona_id}")),
            other => AppError::Database(other),
        })?;

        let version_a = tx.query_row(
            "SELECT * FROM persona_prompt_versions WHERE id = ?1",
            params![version_a_id],
            row_to_prompt_version,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Prompt version {version_a_id}")),
            other => AppError::Database(other),
        })?;

        let version_b = tx.query_row(
            "SELECT * FROM persona_prompt_versions WHERE id = ?1",
            params![version_b_id],
            row_to_prompt_version,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Prompt version {version_b_id}")),
            other => AppError::Database(other),
        })?;

        let mut stmt = tx.prepare(
            "SELECT d.* FROM persona_tool_definitions d
             INNER JOIN persona_tools pt ON pt.tool_id = d.id
             WHERE pt.persona_id = ?1
             ORDER BY d.category, d.name",
        )?;
        let tools = stmt.query_map(params![persona_id], row_to_tool_def)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;

        // Read-only — no commit needed, drop releases the snapshot.
        (persona, version_a, version_b, tools)
    };

    if version_a.persona_id != persona_id || version_b.persona_id != persona_id {
        return Err(AppError::Validation("Both versions must belong to the specified persona".into()));
    }

    let model_configs = parse_model_configs(models)?;

    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let run = ab_repo::create_run(
        &state.db,
        &persona_id,
        &version_a.id,
        &version_b.id,
        version_a.version_number,
        version_b.version_number,
        &models_json,
        use_case_filter.as_deref(),
        test_input.as_deref(),
    )?;
    let run_id = run.id.clone();

    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("test", &run_id);

    // Build persona variants — apply both fields from version to avoid hybrid state
    let mut persona_a = persona.clone();
    persona_a.structured_prompt = version_a.structured_prompt.clone();
    persona_a.system_prompt = version_a.system_prompt.clone().unwrap_or_default();

    let mut persona_b = persona;
    persona_b.structured_prompt = version_b.structured_prompt.clone();
    persona_b.system_prompt = version_b.system_prompt.clone().unwrap_or_default();

    let pool = state.db.clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();
    let va_id = version_a.id.clone();
    let vb_id = version_b.id.clone();
    let va_num = version_a.version_number;
    let vb_num = version_b.version_number;

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_ab_test(
            app,
            pool,
            run_id_clone.clone(),
            vec![
                (va_id, va_num, persona_a),
                (vb_id, vb_num, persona_b),
            ],
            tools,
            model_configs,
            cancelled_clone,
            use_case_filter,
        )
        .await;
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_ab_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabAbRun>, AppError> {
    require_auth_sync(&state)?;
    ab_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_ab_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabAbResult>, AppError> {
    require_auth_sync(&state)?;
    ab_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub async fn lab_delete_ab_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    cancel_active_run_before_delete(&state, &id).await;
    ab_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_ab(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    state.process_registry.cancel_run("test", &id);
    let now = chrono::Utc::now().to_rfc3339();
    ab_repo::update_run_status(&state.db, &id, LabRunStatus::Cancelled, None, None, None, Some(&now))?;
    Ok(())
}

// ============================================================================
// Matrix -- Draft generation + current vs draft comparison
// ============================================================================

#[tauri::command]
pub async fn lab_start_matrix(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    user_instruction: String,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
) -> Result<LabMatrixRun, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    let model_configs = parse_model_configs(models)?;

    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let run = matrix_repo::create_run(
        &state.db,
        &persona_id,
        &user_instruction,
        &models_json,
        use_case_filter.as_deref(),
    )?;
    let run_id = run.id.clone();

    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("test", &run_id);

    let pool = state.db.clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_matrix_test(
            app,
            pool,
            run_id_clone.clone(),
            ephemeral,
            user_instruction,
            model_configs,
            cancelled_clone,
            use_case_filter,
        )
        .await;
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_matrix_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabMatrixRun>, AppError> {
    require_auth_sync(&state)?;
    matrix_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_matrix_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabMatrixResult>, AppError> {
    require_auth_sync(&state)?;
    matrix_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub async fn lab_delete_matrix_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    cancel_active_run_before_delete(&state, &id).await;
    matrix_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_matrix(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    state.process_registry.cancel_run("test", &id);
    let now = chrono::Utc::now().to_rfc3339();
    matrix_repo::update_run_status(&state.db, &id, LabRunStatus::Cancelled, None, None, None, Some(&now))?;
    Ok(())
}

#[tauri::command]
pub fn lab_accept_matrix_draft(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Persona, AppError> {
    require_auth_sync(&state)?;
    let run = matrix_repo::get_run_by_id(&state.db, &run_id)?;

    // Fast-path idempotency check: if the draft was already accepted, return
    // the current persona without re-applying. This is only an optimization;
    // the authoritative guard is the conditional UPDATE inside the transaction
    // below, which closes the TOCTOU window between concurrent accept calls.
    if run.draft_accepted {
        return persona_repo::get_by_id(&state.db, &run.persona_id);
    }

    let draft_json = run.draft_prompt_json.ok_or_else(|| {
        AppError::Validation("No draft prompt available for this run".into())
    })?;

    // Validate the LLM-generated draft against the structured prompt schema
    // before writing it to the persona. This prevents silent corruption from
    // malformed LLM output.
    let draft_errors = validation::persona::validate_structured_prompt(&draft_json);
    validation::contract::check(draft_errors)?;

    // Wrap persona update + draft acceptance + version creation in a single
    // transaction to prevent inconsistent state on partial failure.
    let mut conn = state.db.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let now = chrono::Utc::now().to_rfc3339();

    // Authoritative idempotency guard: conditionally claim the accept within
    // the transaction. If another concurrent call already flipped the flag,
    // rows_affected will be 0 and we roll back without creating a duplicate
    // version row.
    let claimed = tx.execute(
        "UPDATE lab_matrix_runs SET draft_accepted = 1 WHERE id = ?1 AND draft_accepted = 0",
        rusqlite::params![run_id],
    )?;
    if claimed == 0 {
        drop(tx);
        return persona_repo::get_by_id(&state.db, &run.persona_id);
    }

    // Apply draft prompt to the persona
    tx.execute(
        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![draft_json, now, run.persona_id],
    )?;

    // Auto-version the new prompt within the same transaction.
    // Check if latest version already has the same prompt to avoid duplicates.
    let latest_prompt: Option<String> = tx
        .query_row(
            "SELECT structured_prompt FROM persona_prompt_versions
             WHERE persona_id = ?1 ORDER BY version_number DESC LIMIT 1",
            rusqlite::params![run.persona_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::Database)?
        .flatten();

    if latest_prompt.as_deref() != Some(&draft_json) {
        let version_id = uuid::Uuid::new_v4().to_string();
        let next_version: i32 = tx
            .query_row(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM persona_prompt_versions WHERE persona_id = ?1",
                rusqlite::params![run.persona_id],
                |row| row.get(0),
            )
            .map_err(AppError::Database)?;
        tx.execute(
            "INSERT INTO persona_prompt_versions (id, persona_id, version_number, structured_prompt, system_prompt, change_summary, tag, created_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, 'experimental', ?6)",
            rusqlite::params![version_id, run.persona_id, next_version, draft_json, "Auto-saved", now],
        )?;
    }

    tx.commit().map_err(AppError::Database)?;

    persona_repo::get_by_id(&state.db, &run.persona_id)
}

// ============================================================================
// Eval -- N prompt versions × M models evaluation matrix
// ============================================================================

#[tauri::command]
pub async fn lab_start_eval(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    version_ids: Vec<String>,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
    test_input: Option<String>,
) -> Result<LabEvalRun, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    if version_ids.len() < 2 {
        return Err(AppError::Validation("Select at least 2 prompt versions for evaluation".into()));
    }

    // Load and validate all versions
    let mut versions = Vec::new();
    for vid in &version_ids {
        let v = metrics_repo::get_prompt_version_by_id(&state.db, vid)?;
        if v.persona_id != persona_id {
            return Err(AppError::Validation(format!("Version {vid} does not belong to this persona")));
        }
        versions.push(v);
    }

    let model_configs = parse_model_configs(models)?;

    let version_ids_json = serde_json::to_string(&version_ids).unwrap_or_default();
    let version_numbers_json = serde_json::to_string(
        &versions.iter().map(|v| v.version_number).collect::<Vec<_>>(),
    ).unwrap_or_default();
    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    ).unwrap_or_default();

    let run = eval_repo::create_run(
        &state.db,
        &persona_id,
        &version_ids_json,
        &version_numbers_json,
        &models_json,
        use_case_filter.as_deref(),
        test_input.as_deref(),
    )?;
    let run_id = run.id.clone();

    let (cancelled, run_guard) =
        state.process_registry.register_run_guarded("test", &run_id);

    // Build persona variants -- one per version, applying both fields to avoid hybrid state
    let mut variants: Vec<(String, i32, crate::db::models::Persona)> = Vec::new();
    for version in &versions {
        let mut p = persona.clone();
        p.structured_prompt = version.structured_prompt.clone();
        p.system_prompt = version.system_prompt.clone().unwrap_or_default();
        variants.push((version.id.clone(), version.version_number, p));
    }

    let pool = state.db.clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_eval_test(
            app,
            pool,
            run_id_clone.clone(),
            variants,
            tools,
            model_configs,
            cancelled_clone,
            use_case_filter,
        )
        .await;
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_eval_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabEvalRun>, AppError> {
    require_auth_sync(&state)?;
    eval_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_eval_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabEvalResult>, AppError> {
    require_auth_sync(&state)?;
    eval_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub async fn lab_delete_eval_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    cancel_active_run_before_delete(&state, &id).await;
    eval_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_eval(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    state.process_registry.cancel_run("test", &id);
    let now = chrono::Utc::now().to_rfc3339();
    eval_repo::update_run_status(&state.db, &id, LabRunStatus::Cancelled, None, None, None, Some(&now))?;
    Ok(())
}

// ============================================================================
// Version management (moved from observability commands)
// ============================================================================

#[tauri::command]
pub fn lab_get_versions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaPromptVersion>, AppError> {
    require_auth_sync(&state)?;
    metrics_repo::get_prompt_versions(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_tag_version(
    state: State<'_, Arc<AppState>>,
    id: String,
    tag: String,
) -> Result<PersonaPromptVersion, AppError> {
    require_auth_sync(&state)?;
    let valid_tags = ["production", "experimental", "archived"];
    if !valid_tags.contains(&tag.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid tag '{}'. Must be one of: {}", tag, valid_tags.join(", ")
        )));
    }

    if tag == "production" {
        // Demote any existing production version and promote this one atomically;
        // a partial failure here would leave two rows tagged "production".
        return metrics_repo::promote_to_production(&state.db, &id);
    }

    metrics_repo::update_prompt_version_tag(&state.db, &id, &tag)
}

#[tauri::command]
pub fn lab_rollback_version(
    state: State<'_, Arc<AppState>>,
    version_id: String,
) -> Result<PersonaPromptVersion, AppError> {
    require_auth_sync(&state)?;
    let version = metrics_repo::get_prompt_version_by_id(&state.db, &version_id)?;

    // Validate the version snapshot's structured prompt (if present) before
    // applying it. Old snapshots may predate schema changes.
    if let Some(ref sp) = version.structured_prompt {
        let sp_errors = validation::persona::validate_structured_prompt(sp);
        validation::contract::check(sp_errors)?;
    }

    // Verify that the version snapshot has the core prompt data needed for a
    // clean restore. COALESCE fallbacks would silently produce a hybrid state
    // mixing old persona fields with the version's prompt — reject instead.
    if version.structured_prompt.is_none() && version.system_prompt.as_deref().map_or(true, |s| s.trim().is_empty()) {
        return Err(AppError::Validation(
            "Version snapshot is incomplete: missing both structured_prompt and system_prompt. Cannot rollback safely.".into(),
        ));
    }

    let mut conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    // Wrap persona update + version tag swap in a single transaction to prevent
    // inconsistent state if the process crashes mid-rollback.
    let tx = conn.transaction().map_err(AppError::Database)?;

    // Apply all versioned fields explicitly. For optional snapshot fields
    // (design_context, last_design_result, icon, color), use COALESCE to
    // preserve the current value when the snapshot predates those fields.
    // The core prompt fields (structured_prompt, system_prompt) are always
    // overwritten — validated above.
    tx.execute(
        "UPDATE personas SET
         structured_prompt = ?1, system_prompt = COALESCE(?2, ''),
         design_context = COALESCE(?5, design_context),
         last_design_result = COALESCE(?6, last_design_result),
         icon = COALESCE(?7, icon),
         color = COALESCE(?8, color),
         updated_at = ?3
         WHERE id = ?4",
        rusqlite::params![
            version.structured_prompt, version.system_prompt, now, version.persona_id,
            version.design_context, version.last_design_result, version.icon, version.color,
        ],
    )?;

    // Demote current production version (if different from target)
    let current_prod_id: Option<String> = tx.query_row(
        "SELECT id FROM persona_prompt_versions WHERE persona_id = ?1 AND tag = 'production' ORDER BY version_number DESC LIMIT 1",
        rusqlite::params![version.persona_id],
        |row| row.get(0),
    ).optional().map_err(AppError::Database)?;

    if let Some(ref prod_id) = current_prod_id {
        if prod_id != &version_id {
            tx.execute(
                "UPDATE persona_prompt_versions SET tag = 'experimental' WHERE id = ?1",
                rusqlite::params![prod_id],
            )?;
        }
    }

    // Promote target version to production
    let rows = tx.execute(
        "UPDATE persona_prompt_versions SET tag = 'production' WHERE id = ?1",
        rusqlite::params![version_id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("Prompt version {version_id}")));
    }

    tx.commit().map_err(AppError::Database)?;

    // Return the updated version
    metrics_repo::get_prompt_version_by_id(&state.db, &version_id)
}

#[tauri::command]
pub fn lab_get_error_rate(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    window: Option<i64>,
) -> Result<f64, AppError> {
    require_auth_sync(&state)?;
    metrics_repo::get_recent_error_rate(&state.db, &persona_id, window.unwrap_or(10))
}

// ============================================================================
// Prompt Improvement Engine -- Analyze results, generate improved prompt
// ============================================================================

#[tauri::command]
pub async fn lab_improve_prompt(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    run_id: String,
    mode: String,
) -> Result<PersonaPromptVersion, AppError> {
    require_auth(&state).await?;
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;

    // Verify run is completed before generating improvements from its results
    let run_status = match mode.as_str() {
        "arena" => arena_repo::get_run_by_id(&state.db, &run_id)?.status,
        "ab" => ab_repo::get_run_by_id(&state.db, &run_id)?.status,
        "matrix" => matrix_repo::get_run_by_id(&state.db, &run_id)?.status,
        "eval" => eval_repo::get_run_by_id(&state.db, &run_id)?.status,
        _ => return Err(AppError::Validation(format!("Invalid mode: {mode}"))),
    };

    if run_status != LabRunStatus::Completed {
        return Err(AppError::Validation(format!(
            "Cannot improve prompt from a {} run — only completed runs are allowed",
            run_status.as_str()
        )));
    }

    // Load results based on mode and build a summary JSON
    let results_summary = match mode.as_str() {
        "arena" => {
            let results = arena_repo::get_results_by_run(&state.db, &run_id)?;
            if results.is_empty() {
                return Err(AppError::Validation("No results found for this run — cannot generate improvement suggestions without data".into()));
            }
            build_results_summary_arena(&results)
        }
        "ab" => {
            let results = ab_repo::get_results_by_run(&state.db, &run_id)?;
            if results.is_empty() {
                return Err(AppError::Validation("No results found for this run — cannot generate improvement suggestions without data".into()));
            }
            build_results_summary_ab(&results)
        }
        "matrix" => {
            let results = matrix_repo::get_results_by_run(&state.db, &run_id)?;
            if results.is_empty() {
                return Err(AppError::Validation("No results found for this run — cannot generate improvement suggestions without data".into()));
            }
            build_results_summary_matrix(&results)
        }
        "eval" => {
            let results = eval_repo::get_results_by_run(&state.db, &run_id)?;
            if results.is_empty() {
                return Err(AppError::Validation("No results found for this run — cannot generate improvement suggestions without data".into()));
            }
            build_results_summary_eval(&results)
        }
        _ => unreachable!(),
    };

    // Load user ratings for this run
    let ratings = ratings_repo::get_ratings_for_run(&state.db, &run_id)?;
    let user_feedback = if ratings.is_empty() {
        None
    } else {
        let feedback_parts: Vec<String> = ratings
            .iter()
            .map(|r| {
                let rating_label = if r.rating > 0 { "thumbs-up" } else { "thumbs-down" };
                let fb = r.feedback.as_deref().unwrap_or("");
                format!("- Scenario '{}': {} {}", r.scenario_name, rating_label, fb)
            })
            .collect();
        Some(feedback_parts.join("\n"))
    };

    // Generate improvements via LLM
    let (improved_prompt, change_summary) = test_runner::generate_targeted_improvements(
        &state.db,
        &persona,
        &results_summary,
        user_feedback.as_deref(),
    )
    .await
    .map_err(|e| AppError::Internal(format!("Improvement generation failed: {e}")))?;

    // Save as a new prompt version with "experimental" tag
    let improved_json_str = serde_json::to_string(&improved_prompt)
        .map_err(|e| AppError::Internal(format!("Failed to serialize improved prompt: {e}")))?;

    let version = metrics_repo::create_prompt_version(
        &state.db,
        &persona_id,
        Some(improved_json_str),
        None,
        Some(change_summary),
    )?;

    Ok(version)
}

// -- Helpers: build results summary strings for the improvement prompt -------

fn build_results_summary_arena(results: &[LabArenaResult]) -> String {
    let entries: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "scenario": r.base.scenario_name,
                "model": r.base.model_id,
                "tool_accuracy": r.base.tool_accuracy_score,
                "output_quality": r.base.output_quality_score,
                "protocol_compliance": r.base.protocol_compliance,
                "rationale": r.base.rationale,
                "suggestions": r.base.suggestions,
                "status": r.base.status,
            })
        })
        .collect();
    serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into())
}

fn build_results_summary_ab(results: &[LabAbResult]) -> String {
    let entries: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "scenario": r.base.scenario_name,
                "model": r.base.model_id,
                "version_id": r.version_id,
                "version_number": r.version_number,
                "tool_accuracy": r.base.tool_accuracy_score,
                "output_quality": r.base.output_quality_score,
                "protocol_compliance": r.base.protocol_compliance,
                "rationale": r.base.rationale,
                "suggestions": r.base.suggestions,
                "status": r.base.status,
            })
        })
        .collect();
    serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into())
}

fn build_results_summary_matrix(results: &[LabMatrixResult]) -> String {
    let entries: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "scenario": r.base.scenario_name,
                "model": r.base.model_id,
                "variant": r.variant,
                "tool_accuracy": r.base.tool_accuracy_score,
                "output_quality": r.base.output_quality_score,
                "protocol_compliance": r.base.protocol_compliance,
                "rationale": r.base.rationale,
                "suggestions": r.base.suggestions,
                "status": r.base.status,
            })
        })
        .collect();
    serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into())
}

fn build_results_summary_eval(results: &[LabEvalResult]) -> String {
    let entries: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "scenario": r.base.scenario_name,
                "model": r.base.model_id,
                "version_id": r.version_id,
                "version_number": r.version_number,
                "tool_accuracy": r.base.tool_accuracy_score,
                "output_quality": r.base.output_quality_score,
                "protocol_compliance": r.base.protocol_compliance,
                "rationale": r.base.rationale,
                "suggestions": r.base.suggestions,
                "status": r.base.status,
            })
        })
        .collect();
    serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into())
}

// ============================================================================
// Progress -- Active run progress hydration
// ============================================================================

#[tauri::command]
pub fn lab_get_active_progress(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // Single UNION ALL query across all 4 lab run tables — returns ALL active runs
    let active = lab::get_all_active_progress(&state.db, &persona_id)?;
    let entries: Vec<serde_json::Value> = active
        .into_iter()
        .filter_map(|(mode, run_id, progress_json)| {
            serde_json::from_str::<serde_json::Value>(&progress_json)
                .ok()
                .map(|val| serde_json::json!({ "mode": mode, "runId": run_id, "progress": val }))
        })
        .collect();
    Ok(serde_json::Value::Array(entries))
}

// ============================================================================
// Ratings -- User thumbs up/down feedback on lab results
// ============================================================================

#[tauri::command]
pub fn lab_rate_result(
    state: State<'_, Arc<AppState>>,
    run_id: String,
    result_id: Option<String>,
    scenario_name: String,
    rating: i32,
    feedback: Option<String>,
) -> Result<LabUserRating, AppError> {
    require_auth_sync(&state)?;
    let input = crate::db::models::CreateRatingInput {
        run_id,
        result_id,
        scenario_name,
        rating,
        feedback,
    };
    ratings_repo::upsert_rating(&state.db, &input)
}

#[tauri::command]
pub fn lab_get_ratings(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabUserRating>, AppError> {
    require_auth_sync(&state)?;
    ratings_repo::get_ratings_for_run(&state.db, &run_id)
}
