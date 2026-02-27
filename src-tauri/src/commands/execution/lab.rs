use std::sync::Arc;

use tauri::State;

use crate::db::models::*;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::metrics as metrics_repo;
use crate::db::repos::lab::arena as arena_repo;
use crate::db::repos::lab::ab as ab_repo;
use crate::db::repos::lab::matrix as matrix_repo;
use crate::db::repos::lab::eval as eval_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::engine::test_runner::{self, TestModelConfig};
use crate::engine::types::EphemeralPersona;
use crate::error::AppError;
use crate::AppState;

// ============================================================================
// Arena — Multi-model comparison (mirrors existing test_runner flow)
// ============================================================================

#[tauri::command]
pub async fn lab_start_arena(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    models: Vec<serde_json::Value>,
    use_case_filter: Option<String>,
) -> Result<LabArenaRun, AppError> {
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    let mut model_configs: Vec<TestModelConfig> = Vec::new();
    for v in models {
        match serde_json::from_value(v.clone()) {
            Ok(config) => model_configs.push(config),
            Err(e) => return Err(AppError::Validation(format!("Invalid model config: {}", e))),
        }
    }
    if model_configs.is_empty() {
        return Err(AppError::Validation("No valid models provided".into()));
    }

    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let run = arena_repo::create_run(&state.db, &persona_id, &models_json, use_case_filter.as_deref())?;
    let run_id = run.id.clone();

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = state.active_test_run_cancelled.lock().unwrap();
        flags.insert(run_id.clone(), cancelled.clone());
    }

    let pool = state.db.clone();
    let state_arc = state.inner().clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
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

        if let Ok(mut flags) = state_arc.active_test_run_cancelled.lock() {
            flags.remove(&run_id_clone);
        }
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_arena_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabArenaRun>, AppError> {
    arena_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_arena_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabArenaResult>, AppError> {
    arena_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub fn lab_delete_arena_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    arena_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_arena(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    if let Ok(flags) = state.active_test_run_cancelled.lock() {
        if let Some(flag) = flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Release);
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    arena_repo::update_run_status(&state.db, &id, "cancelled", None, None, None, Some(&now))?;
    Ok(())
}

// ============================================================================
// A/B — Prompt version comparison (multi-scenario, multi-model)
// ============================================================================

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
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    let version_a = metrics_repo::get_prompt_version_by_id(&state.db, &version_a_id)?;
    let version_b = metrics_repo::get_prompt_version_by_id(&state.db, &version_b_id)?;

    if version_a.persona_id != persona_id || version_b.persona_id != persona_id {
        return Err(AppError::Validation("Both versions must belong to the specified persona".into()));
    }

    let mut model_configs: Vec<TestModelConfig> = Vec::new();
    for v in models {
        match serde_json::from_value(v.clone()) {
            Ok(config) => model_configs.push(config),
            Err(e) => return Err(AppError::Validation(format!("Invalid model config: {}", e))),
        }
    }
    if model_configs.is_empty() {
        return Err(AppError::Validation("No valid models provided".into()));
    }

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

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = state.active_test_run_cancelled.lock().unwrap();
        flags.insert(run_id.clone(), cancelled.clone());
    }

    // Build persona variants
    let mut persona_a = persona.clone();
    if let Some(ref sp) = version_a.structured_prompt {
        persona_a.structured_prompt = Some(sp.clone());
    }
    if let Some(ref sys) = version_a.system_prompt {
        persona_a.system_prompt = sys.clone();
    }

    let mut persona_b = persona;
    if let Some(ref sp) = version_b.structured_prompt {
        persona_b.structured_prompt = Some(sp.clone());
    }
    if let Some(ref sys) = version_b.system_prompt {
        persona_b.system_prompt = sys.clone();
    }

    let pool = state.db.clone();
    let state_arc = state.inner().clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();
    let va_id = version_a.id.clone();
    let vb_id = version_b.id.clone();
    let va_num = version_a.version_number;
    let vb_num = version_b.version_number;

    tokio::spawn(async move {
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

        if let Ok(mut flags) = state_arc.active_test_run_cancelled.lock() {
            flags.remove(&run_id_clone);
        }
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_ab_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabAbRun>, AppError> {
    ab_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_ab_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabAbResult>, AppError> {
    ab_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub fn lab_delete_ab_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    ab_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_ab(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    if let Ok(flags) = state.active_test_run_cancelled.lock() {
        if let Some(flag) = flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Release);
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    ab_repo::update_run_status(&state.db, &id, "cancelled", None, None, None, Some(&now))?;
    Ok(())
}

// ============================================================================
// Matrix — Draft generation + current vs draft comparison
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
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    let mut model_configs: Vec<TestModelConfig> = Vec::new();
    for v in models {
        match serde_json::from_value(v.clone()) {
            Ok(config) => model_configs.push(config),
            Err(e) => return Err(AppError::Validation(format!("Invalid model config: {}", e))),
        }
    }
    if model_configs.is_empty() {
        return Err(AppError::Validation("No valid models provided".into()));
    }

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

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = state.active_test_run_cancelled.lock().unwrap();
        flags.insert(run_id.clone(), cancelled.clone());
    }

    let pool = state.db.clone();
    let state_arc = state.inner().clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
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

        if let Ok(mut flags) = state_arc.active_test_run_cancelled.lock() {
            flags.remove(&run_id_clone);
        }
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_matrix_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabMatrixRun>, AppError> {
    matrix_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_matrix_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabMatrixResult>, AppError> {
    matrix_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub fn lab_delete_matrix_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    matrix_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_matrix(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    if let Ok(flags) = state.active_test_run_cancelled.lock() {
        if let Some(flag) = flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Release);
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    matrix_repo::update_run_status(&state.db, &id, "cancelled", None, None, None, Some(&now))?;
    Ok(())
}

#[tauri::command]
pub fn lab_accept_matrix_draft(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Persona, AppError> {
    let run = matrix_repo::get_run_by_id(&state.db, &run_id)?;

    let draft_json = run.draft_prompt_json.ok_or_else(|| {
        AppError::Validation("No draft prompt available for this run".into())
    })?;

    // Apply draft prompt to the persona
    let conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![draft_json, now, run.persona_id],
    )?;

    // Mark draft as accepted
    matrix_repo::accept_draft(&state.db, &run_id)?;

    // Auto-version the new prompt
    let _ = metrics_repo::create_prompt_version_if_changed(
        &state.db,
        &run.persona_id,
        Some(draft_json),
        None,
    );

    persona_repo::get_by_id(&state.db, &run.persona_id)
}

// ============================================================================
// Eval — N prompt versions × M models evaluation matrix
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
            return Err(AppError::Validation(format!("Version {} does not belong to this persona", vid)));
        }
        versions.push(v);
    }

    let mut model_configs: Vec<TestModelConfig> = Vec::new();
    for v in models {
        match serde_json::from_value(v.clone()) {
            Ok(config) => model_configs.push(config),
            Err(e) => return Err(AppError::Validation(format!("Invalid model config: {}", e))),
        }
    }
    if model_configs.is_empty() {
        return Err(AppError::Validation("No valid models provided".into()));
    }

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

    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = state.active_test_run_cancelled.lock().unwrap();
        flags.insert(run_id.clone(), cancelled.clone());
    }

    // Build persona variants — one per version
    let mut variants: Vec<(String, i32, crate::db::models::Persona)> = Vec::new();
    for version in &versions {
        let mut p = persona.clone();
        if let Some(ref sp) = version.structured_prompt {
            p.structured_prompt = Some(sp.clone());
        }
        if let Some(ref sys) = version.system_prompt {
            p.system_prompt = sys.clone();
        }
        variants.push((version.id.clone(), version.version_number, p));
    }

    let pool = state.db.clone();
    let state_arc = state.inner().clone();
    let cancelled_clone = cancelled.clone();
    let run_id_clone = run_id.clone();

    tokio::spawn(async move {
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

        if let Ok(mut flags) = state_arc.active_test_run_cancelled.lock() {
            flags.remove(&run_id_clone);
        }
    });

    Ok(run)
}

#[tauri::command]
pub fn lab_list_eval_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<LabEvalRun>, AppError> {
    eval_repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_get_eval_results(
    state: State<'_, Arc<AppState>>,
    run_id: String,
) -> Result<Vec<LabEvalResult>, AppError> {
    eval_repo::get_results_by_run(&state.db, &run_id)
}

#[tauri::command]
pub fn lab_delete_eval_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    eval_repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn lab_cancel_eval(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    if let Ok(flags) = state.active_test_run_cancelled.lock() {
        if let Some(flag) = flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Release);
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    eval_repo::update_run_status(&state.db, &id, "cancelled", None, None, None, Some(&now))?;
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
    metrics_repo::get_prompt_versions(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn lab_tag_version(
    state: State<'_, Arc<AppState>>,
    id: String,
    tag: String,
) -> Result<PersonaPromptVersion, AppError> {
    let valid_tags = ["production", "experimental", "archived"];
    if !valid_tags.contains(&tag.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid tag '{}'. Must be one of: {}", tag, valid_tags.join(", ")
        )));
    }

    if tag == "production" {
        let version = metrics_repo::get_prompt_version_by_id(&state.db, &id)?;
        if let Ok(Some(current_prod)) = metrics_repo::get_production_version(&state.db, &version.persona_id) {
            if current_prod.id != id {
                let _ = metrics_repo::update_prompt_version_tag(&state.db, &current_prod.id, "experimental");
            }
        }
    }

    metrics_repo::update_prompt_version_tag(&state.db, &id, &tag)
}

#[tauri::command]
pub fn lab_rollback_version(
    state: State<'_, Arc<AppState>>,
    version_id: String,
) -> Result<PersonaPromptVersion, AppError> {
    let version = metrics_repo::get_prompt_version_by_id(&state.db, &version_id)?;

    let conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(ref sp) = version.structured_prompt {
        conn.execute(
            "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![sp, now, version.persona_id],
        )?;
    }
    if let Some(ref sys) = version.system_prompt {
        conn.execute(
            "UPDATE personas SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![sys, now, version.persona_id],
        )?;
    }

    if let Ok(Some(current_prod)) = metrics_repo::get_production_version(&state.db, &version.persona_id) {
        if current_prod.id != version_id {
            let _ = metrics_repo::update_prompt_version_tag(&state.db, &current_prod.id, "experimental");
        }
    }
    metrics_repo::update_prompt_version_tag(&state.db, &version_id, "production")
}

#[tauri::command]
pub fn lab_get_error_rate(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    window: Option<i64>,
) -> Result<f64, AppError> {
    metrics_repo::get_recent_error_rate(&state.db, &persona_id, window.unwrap_or(10))
}
