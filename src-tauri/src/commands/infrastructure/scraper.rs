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
) -> Result<Value, String> {
    // Ground the model in real page HTML when we can.
    let sample: Option<String> = match sample_html {
        Some(h) if !h.trim().is_empty() => Some(h.chars().take(8000).collect()),
        _ => {
            #[cfg(feature = "scraper")]
            {
                match &url {
                    Some(u) => crate::engine::scraper::fetch_html_snippet(u, 8000).await.ok(),
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
    .await?;

    let json_str = crate::commands::design::n8n_transform::cli_runner::extract_first_json_object_matching(
        &res.text_output,
        |v| v.is_object(),
    )
    .ok_or_else(|| "Claude did not return a JSON ruleset — try a more specific description.".to_string())?;

    serde_json::from_str::<Value>(&json_str).map_err(|e| e.to_string())
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
