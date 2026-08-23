//! Frontend-facing Tauri commands for the embedded local scraper (Pumper,
//! Phase 1b-2). Thin wrappers over `engine::scraper`; return untyped JSON
//! (`serde_json::Value`) so the React layer owns the display shape without a
//! ts-rs binding for the feature-gated engine types. All commands are always
//! compiled; when the `scraper` cargo feature is off they return a friendly
//! "not enabled" error instead of touching the (absent) engine module.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

#[cfg(not(feature = "scraper"))]
const NOT_ENABLED: &str = "The local scraper is not enabled in this build.";

/// The `scraper` cargo feature is off in this build — a capability gap, not a
/// user input problem, so it maps to `Internal` rather than `Validation`.
#[cfg(not(feature = "scraper"))]
fn not_enabled() -> AppError {
    AppError::Internal(NOT_ENABLED.to_string())
}

/// List saved scrape configs (with schedule + last-run status).
#[tauri::command]
pub fn scraper_list_configs(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let configs =
            crate::engine::scraper::config_list(&state.db).map_err(AppError::Execution)?;
        Ok(serde_json::to_value(configs)?)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = state;
        Err(not_enabled())
    }
}

/// Create or update a saved scrape config. Body matches the run_extract shape
/// plus `name`, optional `cron`/`enabled`/`id`.
#[tauri::command]
pub fn scraper_save_config(
    state: State<'_, Arc<AppState>>,
    config: Value,
) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let saved =
            crate::engine::scraper::config_save(&state.db, &config).map_err(AppError::Execution)?;
        Ok(serde_json::to_value(saved)?)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, config);
        Err(not_enabled())
    }
}

/// Run a saved scrape config now; returns the extract summary.
#[tauri::command]
pub async fn scraper_run_config(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let summary = crate::engine::scraper::config_run(&state.db, &id)
            .await
            .map_err(AppError::Execution)?;
        Ok(serde_json::to_value(summary)?)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, id);
        Err(not_enabled())
    }
}

/// Delete a saved scrape config.
///
/// Privileged: destroys a user-authored config together with its cron
/// schedule, with no undo and no confirmation on the backend side. Sync, so
/// `require_privileged_sync` fails closed and the drift guard keeps the
/// `PRIVILEGED_COMMANDS` entry honest.
#[tauri::command]
#[requires(privileged)]
pub fn scraper_delete_config(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    #[cfg(feature = "scraper")]
    {
        crate::engine::scraper::config_delete(&state.db, &id).map_err(AppError::Execution)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, id);
        Err(not_enabled())
    }
}

/// Ad-hoc declarative extract (no saved config); returns the summary.
#[tauri::command]
pub async fn scraper_run_extract(
    state: State<'_, Arc<AppState>>,
    config: Value,
) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let cfg: crate::engine::scraper::ExtractConfig = serde_json::from_value(config)
            .map_err(|e| AppError::Validation(format!("invalid extract config: {e}")))?;
        let summary = crate::engine::scraper::run_extract(&state.db, cfg)
            .await
            .map_err(AppError::Execution)?;
        Ok(serde_json::to_value(summary)?)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, config);
        Err(not_enabled())
    }
}

/// Dry-run the extraction against the first URL(s) and return what the rules
/// WOULD pull — no dataset write, no persona. The Wizard's "preview" step uses
/// this to validate selectors in isolation before saving.
#[tauri::command]
pub async fn scraper_preview_extract(
    _state: State<'_, Arc<AppState>>,
    config: Value,
    max_urls: Option<usize>,
) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let urls: Vec<String> = config
            .get("urls")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        if urls.is_empty() {
            return Err(AppError::Validation(
                "Add at least one URL to preview.".into(),
            ));
        }
        let rules: pumper_core::extract::RuleSet =
            serde_json::from_value(config.get("rules").cloned().unwrap_or(Value::Null))
                .map_err(|e| AppError::Validation(format!("invalid rules: {e}")))?;
        let rows = crate::engine::scraper::preview_extract(urls, rules, max_urls.unwrap_or(1))
            .await
            .map_err(AppError::Execution)?;
        Ok(serde_json::to_value(rows)?)
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (config, max_urls);
        Err(not_enabled())
    }
}

/// Per-dataset rollup (name, record count, last updated).
#[tauri::command]
pub fn scraper_list_datasets(state: State<'_, Arc<AppState>>) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let summaries =
            crate::engine::scraper::dataset_summaries(&state.db).map_err(AppError::Execution)?;
        Ok(Value::Array(summaries))
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = state;
        Err(not_enabled())
    }
}

/// Generate an extraction ruleset from a natural-language description via the
/// Claude Code CLI — the LLM alternative to hand-writing the rules JSON. When a
/// `url` is given (and the scraper feature is on) the page's HTML is fetched and
/// passed to the model so the selectors match the real DOM. Returns the parsed
/// JSON ruleset (field → rule). Always compiled; only the HTML-grounding step
/// needs the scraper feature.
#[tauri::command]
pub async fn scraper_generate_rules(
    _state: State<'_, Arc<AppState>>,
    description: String,
    url: Option<String>,
    sample_html: Option<String>,
) -> Result<Value, AppError> {
    // Ground the model in real page HTML when we can.
    let sample: Option<String> = match sample_html {
        Some(h) if !h.trim().is_empty() => Some(h.chars().take(8000).collect()),
        _ => {
            #[cfg(feature = "scraper")]
            {
                match &url {
                    Some(u) => crate::engine::scraper::fetch_html_snippet(u, 8000)
                        .await
                        .ok(),
                    None => None,
                }
            }
            #[cfg(not(feature = "scraper"))]
            {
                let _ = &url;
                None
            }
        }
    };

    let prompt_text = format!(
        "You are configuring a web scraper's extraction step. Produce a JSON \"ruleset\": an \
         object mapping each output field name to ONE rule. Rule shapes:\n\
         - CSS text/attr: {{\"type\":\"css\",\"selector\":\"<css selector>\",\"attr\":null,\"all\":false}} \
         (set \"attr\" to e.g. \"href\" to read an attribute; set \"all\":true to collect every match)\n\
         - Regex over raw HTML: {{\"type\":\"regex\",\"pattern\":\"<regex>\",\"group\":0}}\n\
         - JSON pointer (for JSON endpoints): {{\"type\":\"json\",\"pointer\":\"/path/0/field\"}}\n\n\
         Prefer stable, specific CSS selectors. Use concise snake_case or camelCase field names. \
         Return ONLY the JSON object — no markdown, no commentary.\n\n\
         ## What to extract\n{description}\n\n\
         ## Target URL\n{}\n\n\
         ## Sample HTML (may be truncated)\n{}",
        url.as_deref().unwrap_or("(none)"),
        sample.as_deref().unwrap_or("(none provided — infer from the description)"),
    );

    let mut cli_args = crate::engine::prompt::build_cli_args(None, None);
    cli_args.args.push("--model".into());
    cli_args.args.push("claude-haiku-4-5-20251001".into());
    cli_args.args.push("--max-turns".into());
    cli_args.args.push("1".into());

    let res = crate::commands::credentials::ai_artifact_flow::spawn_claude_and_collect(
        &cli_args,
        prompt_text,
        90,
        |_, _| {},
        None,
    )
    .await
    .map_err(AppError::ProcessSpawn)?;

    let json_str =
        crate::commands::design::n8n_transform::cli_runner::extract_first_json_object_matching(
            &res.text_output,
            |v| v.is_object(),
        )
        .ok_or_else(|| {
            AppError::Execution(
                "Claude did not return a JSON ruleset — try a more specific description."
                    .to_string(),
            )
        })?;

    Ok(serde_json::from_str::<Value>(&json_str)?)
}

/// Read change-detected records back from a dataset (newest first).
#[tauri::command]
pub fn scraper_query_dataset(
    state: State<'_, Arc<AppState>>,
    dataset: String,
    limit: Option<i64>,
    changed_only: Option<bool>,
) -> Result<Value, AppError> {
    #[cfg(feature = "scraper")]
    {
        let records = crate::engine::scraper::query_dataset(
            &state.db,
            &dataset,
            limit.unwrap_or(100),
            changed_only.unwrap_or(false),
        )
        .map_err(AppError::Execution)?;
        Ok(Value::Array(records))
    }
    #[cfg(not(feature = "scraper"))]
    {
        let _ = (state, dataset, limit, changed_only);
        Err(not_enabled())
    }
}
