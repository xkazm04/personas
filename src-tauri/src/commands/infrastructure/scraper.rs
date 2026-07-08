//! Frontend-facing Tauri commands for the embedded local scraper (Pumper,
//! Phase 1b-2). Thin wrappers over `engine::scraper`; return untyped JSON
//! (`serde_json::Value`) so the React layer owns the display shape without a
//! ts-rs binding for the feature-gated engine types. All commands are always
//! compiled; when the `scraper` cargo feature is off they return a friendly
//! "not enabled" error instead of touching the (absent) engine module.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::AppState;

const NOT_ENABLED: &str = "The local scraper is not enabled in this build.";

/// List saved scrape configs (with schedule + last-run status).
#[tauri::command]
pub fn scraper_list_configs(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    #[cfg(feature = "scraper")]
    {
        let configs = crate::engine::scraper::config_list(&state.db)?;
        serde_json::to_value(configs).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = state;
        Err(NOT_ENABLED.to_string())
    }
}

/// Create or update a saved scrape config. Body matches the run_extract shape
/// plus `name`, optional `cron`/`enabled`/`id`.
#[tauri::command]
pub fn scraper_save_config(
    state: State<'_, Arc<AppState>>,
    config: Value,
) -> Result<Value, String> {
    #[cfg(feature = "scraper")]
    {
        let saved = crate::engine::scraper::config_save(&state.db, &config)?;
        serde_json::to_value(saved).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, config);
        Err(NOT_ENABLED.to_string())
    }
}

/// Run a saved scrape config now; returns the extract summary.
#[tauri::command]
pub async fn scraper_run_config(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Value, String> {
    #[cfg(feature = "scraper")]
    {
        let summary = crate::engine::scraper::config_run(&state.db, &id).await?;
        serde_json::to_value(summary).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, id);
        Err(NOT_ENABLED.to_string())
    }
}

/// Delete a saved scrape config.
#[tauri::command]
pub fn scraper_delete_config(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    #[cfg(feature = "scraper")]
    {
        crate::engine::scraper::config_delete(&state.db, &id)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, id);
        Err(NOT_ENABLED.to_string())
    }
}

/// Ad-hoc declarative extract (no saved config); returns the summary.
#[tauri::command]
pub async fn scraper_run_extract(
    state: State<'_, Arc<AppState>>,
    config: Value,
) -> Result<Value, String> {
    #[cfg(feature = "scraper")]
    {
        let cfg: crate::engine::scraper::ExtractConfig =
            serde_json::from_value(config).map_err(|e| format!("invalid extract config: {e}"))?;
        let summary = crate::engine::scraper::run_extract(&state.db, cfg).await?;
        serde_json::to_value(summary).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, config);
        Err(NOT_ENABLED.to_string())
    }
}

/// Per-dataset rollup (name, record count, last updated).
#[tauri::command]
pub fn scraper_list_datasets(state: State<'_, Arc<AppState>>) -> Result<Value, String> {
    #[cfg(feature = "scraper")]
    {
        let summaries = crate::engine::scraper::dataset_summaries(&state.db)?;
        Ok(Value::Array(summaries))
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = state;
        Err(NOT_ENABLED.to_string())
    }
}

/// Read change-detected records back from a dataset (newest first).
#[tauri::command]
pub fn scraper_query_dataset(
    state: State<'_, Arc<AppState>>,
    dataset: String,
    limit: Option<i64>,
    changed_only: Option<bool>,
) -> Result<Value, String> {
    #[cfg(feature = "scraper")]
    {
        let records = crate::engine::scraper::query_dataset(
            &state.db,
            &dataset,
            limit.unwrap_or(100),
            changed_only.unwrap_or(false),
        )?;
        Ok(Value::Array(records))
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, dataset, limit, changed_only);
        Err(NOT_ENABLED.to_string())
    }
}
