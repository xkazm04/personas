use std::sync::Arc;

use tauri::State;

use crate::db::models::PersonaTestRun;
use crate::db::models::PersonaTestResult;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::test_runs as repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::engine::test_runner::{self, TestModelConfig};
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub async fn start_test_run(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    models: Vec<serde_json::Value>,
) -> Result<PersonaTestRun, AppError> {
    let persona = persona_repo::get_by_id(&state.db, &persona_id)?;
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;

    // Parse model configs from frontend
    let model_configs: Vec<TestModelConfig> = models
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();

    if model_configs.is_empty() {
        return Err(AppError::Validation("No valid models provided".into()));
    }

    let models_json = serde_json::to_string(
        &model_configs.iter().map(|m| &m.id).collect::<Vec<_>>(),
    )
    .unwrap_or_default();

    let run = repo::create_run(&state.db, &persona_id, &models_json)?;
    let run_id = run.id.clone();

    let pool = state.db.clone();
    let log_dir = state
        .engine
        .child_pids
        .lock()
        .await;
    drop(log_dir); // just used to verify engine is alive

    // Create cancellation flag and register in AppState
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = state.active_test_run_cancelled.lock().unwrap();
        flags.insert(run_id.clone(), cancelled.clone());
    }

    let cancelled_clone = cancelled.clone();
    let run_id_for_cancel = run_id.clone();
    let state_arc = state.inner().clone();

    tokio::spawn(async move {
        test_runner::run_test(
            app,
            pool,
            run_id_for_cancel.clone(),
            persona,
            tools,
            model_configs,
            std::env::temp_dir(),
            cancelled_clone,
        )
        .await;

        // Clean up cancellation flag
        if let Ok(mut flags) = state_arc.active_test_run_cancelled.lock() {
            flags.remove(&run_id_for_cancel);
        }
    });

    Ok(run)
}

#[tauri::command]
pub fn list_test_runs(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    limit: Option<i64>,
) -> Result<Vec<PersonaTestRun>, AppError> {
    repo::get_runs_by_persona(&state.db, &persona_id, limit)
}

#[tauri::command]
pub fn get_test_results(
    state: State<'_, Arc<AppState>>,
    test_run_id: String,
) -> Result<Vec<PersonaTestResult>, AppError> {
    repo::get_results_by_run(&state.db, &test_run_id)
}

#[tauri::command]
pub fn delete_test_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_run(&state.db, &id)
}

#[tauri::command]
pub fn cancel_test_run(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    // Set cancellation flag — the test runner checks this between iterations
    if let Ok(flags) = state.active_test_run_cancelled.lock() {
        if let Some(flag) = flags.get(&id) {
            flag.store(true, std::sync::atomic::Ordering::Release);
        }
    }

    // Update DB status immediately
    let now = chrono::Utc::now().to_rfc3339();
    repo::update_run_status(&state.db, &id, "cancelled", None, None, None, Some(&now))?;

    Ok(())
}
