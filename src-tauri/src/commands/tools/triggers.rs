use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreateTriggerInput, PersonaTrigger, UpdateTriggerInput};
use crate::db::repos::resources::triggers as repo;
use crate::db::repos::communication::events as event_repo;
use crate::engine::chain;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync, require_privileged};
use crate::AppState;

#[tauri::command]
pub fn list_all_triggers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaTrigger>, AppError> {
    require_auth_sync(&state)?;
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn list_triggers(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaTrigger>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_persona_id(&state.db, &persona_id)
}

/// Validate that a config string, if non-empty, is valid JSON.
fn validate_config_json(config: Option<&str>) -> Result<(), AppError> {
    if let Some(c) = config {
        let trimmed = c.trim();
        if !trimmed.is_empty() {
            serde_json::from_str::<serde_json::Value>(trimmed).map_err(|e| {
                AppError::Validation(format!("Invalid config JSON: {e}"))
            })?;
        }
    }
    Ok(())
}

/// If the trigger is a polling type, validate that any configured URL does not
/// point to a private/internal address (SSRF protection).
fn validate_polling_url(trigger_type: &str, config: Option<&str>) -> Result<(), AppError> {
    if trigger_type != "polling" {
        return Ok(());
    }
    let url = config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
        .and_then(|v| {
            v.get("url")
                .or(v.get("endpoint"))
                .and_then(|u| u.as_str().map(String::from))
        });
    if let Some(u) = url {
        if !u.is_empty() {
            crate::engine::url_safety::validate_url_safety(&u)
                .map_err(|reason| AppError::Validation(format!("Polling URL blocked: {reason}")))?;
        }
    }
    Ok(())
}

/// If the trigger is a chain type, extract source_persona_id from config and
/// run cycle detection to prevent infinite execution loops.
fn validate_chain_cycle(
    pool: &crate::db::DbPool,
    trigger_type: &str,
    config: Option<&str>,
    target_persona_id: &str,
    exclude_trigger_id: Option<&str>,
) -> Result<(), AppError> {
    if trigger_type != "chain" {
        return Ok(());
    }
    let source = config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
        .and_then(|v| v.get("source_persona_id")?.as_str().map(String::from));
    if let Some(src) = source {
        chain::detect_chain_cycle(pool, &src, target_persona_id, exclude_trigger_id)?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_trigger(
    state: State<'_, Arc<AppState>>,
    input: CreateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    require_auth_sync(&state)?;
    validate_config_json(input.config.as_deref())?;
    validate_polling_url(&input.trigger_type, input.config.as_deref())?;
    validate_chain_cycle(
        &state.db,
        &input.trigger_type,
        input.config.as_deref(),
        &input.persona_id,
        None,
    )?;
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_trigger(
    state: State<'_, Arc<AppState>>,
    id: String,
    persona_id: String,
    input: UpdateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    require_auth_sync(&state)?;
    validate_config_json(input.config.as_deref())?;
    // Verify ownership: the trigger must belong to the specified persona
    let existing = repo::get_by_id(&state.db, &id)?;
    if existing.persona_id != persona_id {
        return Err(AppError::Validation(format!(
            "Trigger {} does not belong to persona {}",
            id, persona_id
        )));
    }
    // For chain cycle detection and polling URL validation on update, we need
    // the existing trigger's data to fill in fields not being changed.
    if input.trigger_type.is_some() || input.config.is_some() {
        let trigger_type = input.trigger_type.as_deref().unwrap_or(&existing.trigger_type);
        let config = input.config.as_deref().or(existing.config.as_deref());
        validate_polling_url(trigger_type, config)?;
        validate_chain_cycle(&state.db, trigger_type, config, &existing.persona_id, Some(&id))?;
    }
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_trigger(
    state: State<'_, Arc<AppState>>,
    id: String,
    persona_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    // Verify ownership: the trigger must belong to the specified persona
    let existing = repo::get_by_id(&state.db, &id)?;
    if existing.persona_id != persona_id {
        return Err(AppError::Validation(format!(
            "Trigger {} does not belong to persona {}",
            id, persona_id
        )));
    }
    repo::delete(&state.db, &id)
}

/// Returns a map of trigger_id -> health status in a single DB query.
/// Replaces the N+1 IPC pattern where the frontend fetched executions per persona.
#[tauri::command]
pub fn get_trigger_health_map(
    state: State<'_, Arc<AppState>>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    require_auth_sync(&state)?;
    repo::get_health_map(&state.db)
}

// =============================================================================
// Trigger Validation
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TriggerValidationResult {
    pub valid: bool,
    pub checks: Vec<TriggerValidationCheck>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TriggerValidationCheck {
    pub label: String,
    pub passed: bool,
    pub message: String,
}

/// Validate trigger configuration without executing.
/// Checks type-specific config: cron syntax, interval bounds,
/// endpoint reachability, chain source existence, etc.
#[tauri::command]
pub async fn validate_trigger(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<TriggerValidationResult, AppError> {
    require_auth(&state).await?;
    let trigger = repo::get_by_id(&state.db, &id)?;

    let mut checks: Vec<TriggerValidationCheck> = Vec::new();

    // Parse config JSON, reporting malformed JSON as a validation failure
    let config: serde_json::Value = match trigger.config.as_deref() {
        Some(c) if !c.trim().is_empty() => match serde_json::from_str(c) {
            Ok(v) => v,
            Err(e) => {
                checks.push(TriggerValidationCheck {
                    label: "Config JSON".into(),
                    passed: false,
                    message: format!("Malformed JSON in config: {e}"),
                });
                // Return early — all downstream checks depend on valid config
                checks.push(TriggerValidationCheck {
                    label: "Target persona".into(),
                    passed: true,
                    message: "Skipped (config invalid)".into(),
                });
                return Ok(TriggerValidationResult { valid: false, checks });
            }
        },
        _ => serde_json::Value::Null,
    };

    match trigger.trigger_type.as_str() {
        "schedule" => {
            // Validate cron expression if present
            if let Some(cron_expr) = config.get("cron").or(config.get("cron_expression")).and_then(|v| v.as_str()) {
                match crate::engine::cron::parse_cron(cron_expr) {
                    Ok(schedule) => {
                        let next_msg = crate::engine::cron::next_fire_time(&schedule, chrono::Utc::now())
                            .map(|t| format!("Valid — next fire: {}", t.format("%Y-%m-%d %H:%M UTC")))
                            .unwrap_or_else(|| "Valid syntax (no upcoming fire time)".into());
                        checks.push(TriggerValidationCheck {
                            label: "Cron syntax".into(),
                            passed: true,
                            message: next_msg,
                        });
                    }
                    Err(e) => {
                        checks.push(TriggerValidationCheck {
                            label: "Cron syntax".into(),
                            passed: false,
                            message: format!("Invalid cron: {e}"),
                        });
                    }
                }
            }
            // Validate interval_seconds if present
            if let Some(interval) = config.get("interval_seconds").and_then(|v| v.as_i64()) {
                if interval >= 60 {
                    checks.push(TriggerValidationCheck {
                        label: "Interval".into(),
                        passed: true,
                        message: format!("{interval}s (minimum 60s)"),
                    });
                } else {
                    checks.push(TriggerValidationCheck {
                        label: "Interval".into(),
                        passed: false,
                        message: format!("{interval}s is below minimum of 60s"),
                    });
                }
            }
            if checks.is_empty() {
                checks.push(TriggerValidationCheck {
                    label: "Config".into(),
                    passed: false,
                    message: "No cron expression or interval_seconds configured".into(),
                });
            }
        }
        "polling" => {
            // Validate interval
            if let Some(interval) = config.get("interval_seconds").and_then(|v| v.as_i64()) {
                if interval >= 60 {
                    checks.push(TriggerValidationCheck {
                        label: "Interval".into(),
                        passed: true,
                        message: format!("{interval}s"),
                    });
                } else {
                    checks.push(TriggerValidationCheck {
                        label: "Interval".into(),
                        passed: false,
                        message: format!("{interval}s is below minimum of 60s"),
                    });
                }
            }
            // Validate endpoint reachability
            if let Some(endpoint) = config.get("endpoint").and_then(|v| v.as_str()) {
                if endpoint.is_empty() {
                    checks.push(TriggerValidationCheck {
                        label: "Endpoint".into(),
                        passed: false,
                        message: "Endpoint URL is empty".into(),
                    });
                } else {
                    // SSRF protection: block private/internal IPs before making any request
                    match crate::engine::url_safety::validate_url_safety(endpoint) {
                        Err(reason) => {
                            checks.push(TriggerValidationCheck {
                                label: "Endpoint".into(),
                                passed: false,
                                message: format!("Blocked: {reason}"),
                            });
                        }
                        Ok(()) => match url::Url::parse(endpoint) {
                            Ok(_) => {
                                // Use HEAD only — never GET, which can trigger
                                // side effects on OAuth callbacks, webhook confirmations, etc.
                                // Redirects disabled to prevent SSRF via redirect to internal IPs.
                                let client = reqwest::Client::builder()
                                    .timeout(std::time::Duration::from_secs(5))
                                    .redirect(reqwest::redirect::Policy::none())
                                    .build()
                                    .unwrap_or_default();
                                match client.head(endpoint).send().await {
                                    Ok(resp) => {
                                        let status = resp.status().as_u16();
                                        if status == 405 {
                                            checks.push(TriggerValidationCheck {
                                                label: "Endpoint".into(),
                                                passed: true,
                                                message: "Reachable (HEAD not allowed, but server responded)".into(),
                                            });
                                        } else if (300..400).contains(&status) {
                                            let location = resp.headers()
                                                .get("location")
                                                .and_then(|v| v.to_str().ok())
                                                .unwrap_or("unknown");
                                            checks.push(TriggerValidationCheck {
                                                label: "Endpoint".into(),
                                                passed: true,
                                                message: format!("Reachable (HTTP {status} redirect to {location})"),
                                            });
                                        } else {
                                            checks.push(TriggerValidationCheck {
                                                label: "Endpoint".into(),
                                                passed: true,
                                                message: format!("Reachable (HTTP {status})"),
                                            });
                                        }
                                    }
                                    Err(e) => {
                                        checks.push(TriggerValidationCheck {
                                            label: "Endpoint".into(),
                                            passed: false,
                                            message: format!("Unreachable: {e}"),
                                        });
                                    }
                                }
                            }
                            Err(_) => {
                                checks.push(TriggerValidationCheck {
                                    label: "Endpoint".into(),
                                    passed: false,
                                    message: format!("Invalid URL: {endpoint}"),
                                });
                            }
                        }
                    }
                }
            }
        }
        "webhook" => {
            // Webhook triggers are passive — validate that the webhook server is alive
            let webhook_alive = state.scheduler.is_webhook_alive();
            checks.push(TriggerValidationCheck {
                label: "Webhook listener".into(),
                passed: webhook_alive,
                message: if webhook_alive {
                    format!("Active on http://localhost:9420/webhook/{}", trigger.id)
                } else {
                    "Webhook server is not running — webhook won't receive events".into()
                },
            });
            if let Some(secret) = config.get("hmac_secret").or(config.get("webhook_secret")).and_then(|v| v.as_str()) {
                if secret.is_empty() {
                    checks.push(TriggerValidationCheck {
                        label: "HMAC secret".into(),
                        passed: false,
                        message: "HMAC secret is empty".into(),
                    });
                } else {
                    checks.push(TriggerValidationCheck {
                        label: "HMAC secret".into(),
                        passed: true,
                        message: format!("Configured ({} chars)", secret.len()),
                    });
                }
            }
        }
        "chain" => {
            // Validate source persona exists
            if let Some(source_id) = config.get("source_persona_id").and_then(|v| v.as_str()) {
                match crate::db::repos::core::personas::get_by_id(&state.db, source_id) {
                    Ok(p) => {
                        checks.push(TriggerValidationCheck {
                            label: "Source persona".into(),
                            passed: true,
                            message: format!("\"{}\" exists", p.name),
                        });
                    }
                    Err(_) => {
                        checks.push(TriggerValidationCheck {
                            label: "Source persona".into(),
                            passed: false,
                            message: format!("Persona {source_id} not found"),
                        });
                    }
                }

                // Check for circular chain dependencies
                match chain::detect_chain_cycle(&state.db, source_id, &trigger.persona_id, Some(&trigger.id)) {
                    Ok(()) => {
                        checks.push(TriggerValidationCheck {
                            label: "Cycle check".into(),
                            passed: true,
                            message: "No circular dependencies detected".into(),
                        });
                    }
                    Err(AppError::Validation(msg)) => {
                        checks.push(TriggerValidationCheck {
                            label: "Cycle check".into(),
                            passed: false,
                            message: msg,
                        });
                    }
                    Err(_) => {
                        checks.push(TriggerValidationCheck {
                            label: "Cycle check".into(),
                            passed: false,
                            message: "Failed to check for circular dependencies".into(),
                        });
                    }
                }
            } else {
                checks.push(TriggerValidationCheck {
                    label: "Source persona".into(),
                    passed: false,
                    message: "No source_persona_id configured".into(),
                });
            }
        }
        "manual" => {
            checks.push(TriggerValidationCheck {
                label: "Manual trigger".into(),
                passed: true,
                message: "No configuration needed".into(),
            });
        }
        "file_watcher" => {
            if let Some(paths) = config.get("watch_paths").and_then(|v| v.as_array()) {
                let valid_paths: Vec<_> = paths.iter()
                    .filter_map(|p| p.as_str())
                    .filter(|p| std::path::Path::new(p).exists())
                    .collect();
                let total = paths.len();
                if total == 0 {
                    checks.push(TriggerValidationCheck {
                        label: "Watch paths".into(),
                        passed: false,
                        message: "No watch paths configured".into(),
                    });
                } else if valid_paths.len() == total {
                    checks.push(TriggerValidationCheck {
                        label: "Watch paths".into(),
                        passed: true,
                        message: format!("All {total} path(s) exist"),
                    });
                } else {
                    checks.push(TriggerValidationCheck {
                        label: "Watch paths".into(),
                        passed: false,
                        message: format!("{}/{} path(s) exist on disk", valid_paths.len(), total),
                    });
                }
            } else {
                checks.push(TriggerValidationCheck {
                    label: "Watch paths".into(),
                    passed: false,
                    message: "No watch_paths configured".into(),
                });
            }
            if let Some(events) = config.get("events").and_then(|v| v.as_array()) {
                let valid_events = ["create", "modify", "delete", "rename"];
                let all_valid = events.iter().all(|e| {
                    e.as_str().is_some_and(|s| valid_events.contains(&s))
                });
                checks.push(TriggerValidationCheck {
                    label: "Event types".into(),
                    passed: all_valid,
                    message: if all_valid {
                        format!("{} event type(s) configured", events.len())
                    } else {
                        "Unknown event types (valid: create, modify, delete, rename)".into()
                    },
                });
            }
        }
        "clipboard" => {
            let ct = config.get("content_type").and_then(|v| v.as_str()).unwrap_or("text");
            let valid_types = ["text", "image", "any"];
            checks.push(TriggerValidationCheck {
                label: "Content type".into(),
                passed: valid_types.contains(&ct),
                message: format!("Monitoring: {ct}"),
            });
            if let Some(pattern) = config.get("pattern").and_then(|v| v.as_str()) {
                match regex::Regex::new(pattern) {
                    Ok(_) => {
                        checks.push(TriggerValidationCheck {
                            label: "Pattern".into(),
                            passed: true,
                            message: format!("Valid regex: {pattern}"),
                        });
                    }
                    Err(e) => {
                        checks.push(TriggerValidationCheck {
                            label: "Pattern".into(),
                            passed: false,
                            message: format!("Invalid regex: {e}"),
                        });
                    }
                }
            }
        }
        "app_focus" => {
            checks.push(TriggerValidationCheck {
                label: "App focus monitor".into(),
                passed: cfg!(target_os = "windows"),
                message: if cfg!(target_os = "windows") {
                    "Windows platform supported".into()
                } else {
                    "App focus monitoring only supported on Windows".into()
                },
            });
            if let Some(pattern) = config.get("title_pattern").and_then(|v| v.as_str()) {
                match regex::Regex::new(pattern) {
                    Ok(_) => {
                        checks.push(TriggerValidationCheck {
                            label: "Title pattern".into(),
                            passed: true,
                            message: format!("Valid regex: {pattern}"),
                        });
                    }
                    Err(e) => {
                        checks.push(TriggerValidationCheck {
                            label: "Title pattern".into(),
                            passed: false,
                            message: format!("Invalid regex: {e}"),
                        });
                    }
                }
            }
        }
        "composite" => {
            if let Some(conditions) = config.get("conditions").and_then(|v| v.as_array()) {
                if conditions.len() < 2 {
                    checks.push(TriggerValidationCheck {
                        label: "Conditions".into(),
                        passed: false,
                        message: "Composite triggers require at least 2 conditions".into(),
                    });
                } else {
                    let all_have_type = conditions.iter().all(|c| {
                        c.get("event_type").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty())
                    });
                    checks.push(TriggerValidationCheck {
                        label: "Conditions".into(),
                        passed: all_have_type,
                        message: if all_have_type {
                            format!("{} conditions configured", conditions.len())
                        } else {
                            "All conditions must have a non-empty event_type".into()
                        },
                    });
                }
            } else {
                checks.push(TriggerValidationCheck {
                    label: "Conditions".into(),
                    passed: false,
                    message: "No conditions configured".into(),
                });
            }
            if let Some(window) = config.get("window_seconds").and_then(|v| v.as_u64()) {
                checks.push(TriggerValidationCheck {
                    label: "Time window".into(),
                    passed: window >= 5,
                    message: if window >= 5 {
                        format!("{window}s window")
                    } else {
                        "Time window must be at least 5 seconds".into()
                    },
                });
            } else {
                checks.push(TriggerValidationCheck {
                    label: "Time window".into(),
                    passed: false,
                    message: "No window_seconds configured".into(),
                });
            }
            let op = config.get("operator").and_then(|v| v.as_str()).unwrap_or("all");
            let valid_ops = ["all", "any", "sequence"];
            checks.push(TriggerValidationCheck {
                label: "Operator".into(),
                passed: valid_ops.contains(&op),
                message: format!("Operator: {op}"),
            });
        }
        "event_listener" => {
            if let Some(evt) = config.get("listen_event_type").and_then(|v| v.as_str()) {
                checks.push(TriggerValidationCheck {
                    label: "Event type".into(),
                    passed: !evt.is_empty(),
                    message: format!("Listening for: {evt}"),
                });
            } else {
                checks.push(TriggerValidationCheck {
                    label: "Event type".into(),
                    passed: false,
                    message: "No listen_event_type configured".into(),
                });
            }
        }
        _ => {
            checks.push(TriggerValidationCheck {
                label: "Trigger type".into(),
                passed: false,
                message: format!("Unknown trigger type: {}", trigger.trigger_type),
            });
        }
    }

    // Check that the associated persona exists
    match crate::db::repos::core::personas::get_by_id(&state.db, &trigger.persona_id) {
        Ok(p) => {
            checks.push(TriggerValidationCheck {
                label: "Target persona".into(),
                passed: true,
                message: format!("\"{}\"", p.name),
            });
        }
        Err(_) => {
            checks.push(TriggerValidationCheck {
                label: "Target persona".into(),
                passed: false,
                message: "Persona no longer exists".into(),
            });
        }
    }

    let valid = checks.iter().all(|c| c.passed);
    Ok(TriggerValidationResult { valid, checks })
}

// =============================================================================
// Cron Preview
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CronPreview {
    pub valid: bool,
    pub description: String,
    pub next_runs: Vec<String>,
    pub error: Option<String>,
}

/// Parse a cron expression and return a human-readable description + next N fire times.
#[tauri::command]
pub fn preview_cron_schedule(
    state: State<'_, Arc<AppState>>,
    cron_expression: String,
    count: Option<usize>,
) -> Result<CronPreview, AppError> {
    require_auth_sync(&state)?;
    let count = count.unwrap_or(5).min(10);

    let schedule = match crate::engine::cron::parse_cron(&cron_expression) {
        Ok(s) => s,
        Err(e) => {
            return Ok(CronPreview {
                valid: false,
                description: String::new(),
                next_runs: vec![],
                error: Some(format!("Invalid cron expression: {e}")),
            });
        }
    };

    // Compute next N fire times
    let mut runs = Vec::with_capacity(count);
    let mut from = chrono::Utc::now();
    for _ in 0..count {
        match crate::engine::cron::next_fire_time(&schedule, from) {
            Some(next) => {
                runs.push(next.to_rfc3339());
                from = next;
            }
            None => break,
        }
    }

    let description = cron_to_human(&cron_expression);

    Ok(CronPreview {
        valid: true,
        description,
        next_runs: runs,
        error: None,
    })
}

/// Convert a 5-field cron expression to a human-readable string.
fn cron_to_human(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return format!("Cron: {expr}");
    }
    let (min, hour, dom, mon, dow) = (fields[0], fields[1], fields[2], fields[3], fields[4]);

    // Every minute
    if min == "*" && hour == "*" && dom == "*" && mon == "*" && dow == "*" {
        return "Every minute".into();
    }

    // Every N minutes
    if min.starts_with("*/") && hour == "*" && dom == "*" && mon == "*" && dow == "*" {
        let n = &min[2..];
        return format!("Every {n} minutes");
    }

    // Every N hours
    if min == "0" && hour.starts_with("*/") && dom == "*" && mon == "*" && dow == "*" {
        let n = &hour[2..];
        return format!("Every {n} hours");
    }

    // Specific time patterns
    let time_str = format_time_from_cron(min, hour);

    // Daily at specific time
    if dom == "*" && mon == "*" && dow == "*" {
        return format!("Daily at {time_str}");
    }

    // Specific days of week
    if dom == "*" && mon == "*" && dow != "*" {
        let days = format_dow(dow);
        return format!("Every {days} at {time_str}");
    }

    // Specific day of month
    if dom != "*" && mon == "*" && dow == "*" {
        let ordinal = format_dom(dom);
        return format!("Monthly on the {ordinal} at {time_str}");
    }

    // Fallback
    format!("Cron: {expr}")
}

fn format_time_from_cron(min: &str, hour: &str) -> String {
    let h: u32 = hour.parse().unwrap_or(0);
    let m: u32 = min.parse().unwrap_or(0);
    let (h12, ampm) = if h == 0 {
        (12, "AM")
    } else if h < 12 {
        (h, "AM")
    } else if h == 12 {
        (12, "PM")
    } else {
        (h - 12, "PM")
    };
    if m == 0 {
        format!("{h12} {ampm}")
    } else {
        format!("{h12}:{m:02} {ampm}")
    }
}

fn format_dow(dow: &str) -> String {
    const DAYS: &[&str] = &["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let parts: Vec<&str> = dow.split(',').collect();

    // Common patterns
    if dow == "1-5" {
        return "weekday".into();
    }
    if dow == "0,6" || dow == "6,0" {
        return "weekend".into();
    }

    let names: Vec<String> = parts
        .iter()
        .filter_map(|p| {
            if p.contains('-') {
                // Range like 1-5
                let bounds: Vec<&str> = p.splitn(2, '-').collect();
                let lo: usize = bounds[0].parse().unwrap_or(0);
                let hi: usize = bounds[1].parse().unwrap_or(6);
                if lo <= hi && hi < 7 {
                    let start = DAYS.get(lo).unwrap_or(&"?");
                    let end = DAYS.get(hi).unwrap_or(&"?");
                    Some(format!("{start}-{end}"))
                } else {
                    None
                }
            } else {
                let idx: usize = p.trim().parse().unwrap_or(8);
                DAYS.get(idx).map(|d| d.to_string())
            }
        })
        .collect();

    if names.len() == 1 {
        names[0].clone()
    } else {
        names.join(", ")
    }
}

fn format_dom(dom: &str) -> String {
    let d: u32 = dom.parse().unwrap_or(0);
    let suffix = match d % 10 {
        1 if d != 11 => "st",
        2 if d != 12 => "nd",
        3 if d != 13 => "rd",
        _ => "th",
    };
    format!("{d}{suffix}")
}

// =============================================================================
// Chain Triggers
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TriggerChainLink {
    pub trigger_id: String,
    pub source_persona_id: String,
    pub source_persona_name: String,
    pub target_persona_id: String,
    pub target_persona_name: String,
    pub condition_type: String,
    pub enabled: bool,
}

/// List all chain trigger links for visualization.
/// Uses a single SQL query with JOINs instead of N+1 persona lookups.
#[tauri::command]
pub fn list_trigger_chains(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TriggerChainLink>, AppError> {
    require_auth_sync(&state)?;
    let rows = repo::get_chain_links(&state.db)?;
    Ok(rows
        .into_iter()
        .map(
            |(trigger_id, source_persona_id, source_persona_name, target_persona_id, target_persona_name, condition_type, enabled)| {
                TriggerChainLink {
                    trigger_id,
                    source_persona_id,
                    source_persona_name,
                    target_persona_id,
                    target_persona_name,
                    condition_type,
                    enabled,
                }
            },
        )
        .collect())
}

// =============================================================================
// Webhook Info
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct WebhookStatus {
    pub listening: bool,
    pub port: u16,
    pub base_url: String,
}

/// Get the webhook server status.
#[tauri::command]
pub fn get_webhook_status(
    state: State<'_, Arc<AppState>>,
) -> Result<WebhookStatus, AppError> {
    require_auth_sync(&state)?;
    Ok(WebhookStatus {
        listening: state.scheduler.is_webhook_alive(),
        port: 9420,
        base_url: "http://localhost:9420".into(),
    })
}

// =============================================================================
// Dry-Run Mode
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DryRunMatchedSubscription {
    pub subscription_id: String,
    pub persona_id: String,
    pub persona_name: String,
    pub event_type: String,
    pub source_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DryRunResult {
    pub valid: bool,
    pub validation: TriggerValidationResult,
    pub simulated_event: DryRunSimulatedEvent,
    pub matched_subscriptions: Vec<DryRunMatchedSubscription>,
    pub chain_targets: Vec<DryRunChainTarget>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DryRunSimulatedEvent {
    pub event_type: String,
    pub source_type: String,
    pub source_id: String,
    pub target_persona_id: String,
    pub target_persona_name: String,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DryRunChainTarget {
    pub trigger_id: String,
    pub target_persona_id: String,
    pub target_persona_name: String,
    pub condition_type: String,
    pub enabled: bool,
}

/// Simulate trigger execution without actually running any agents.
/// Validates config, generates the event that would be published,
/// finds matching subscriptions, and identifies downstream chain triggers.
#[tauri::command]
pub async fn dry_run_trigger(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DryRunResult, AppError> {
    require_privileged(&state, "dry_run_trigger").await?;
    // 1. Run full validation
    let validation = validate_trigger(state.clone(), id.clone()).await?;

    // 2. Load trigger and build simulated event
    let trigger = repo::get_by_id(&state.db, &id)?;
    let parsed = trigger.parse_config();
    let event_type = parsed.event_type().to_string();
    let payload_val = parsed.payload().and_then(|p| serde_json::from_str(&p).ok());

    // Resolve target persona name
    let (target_persona_id, target_persona_name) =
        match crate::db::repos::core::personas::get_by_id(&state.db, &trigger.persona_id) {
            Ok(p) => (p.id.clone(), p.name.clone()),
            Err(_) => (trigger.persona_id.clone(), "Unknown".into()),
        };

    let simulated_event = DryRunSimulatedEvent {
        event_type: event_type.clone(),
        source_type: format!("trigger:{}", trigger.trigger_type),
        source_id: trigger.id.clone(),
        target_persona_id: target_persona_id.clone(),
        target_persona_name: target_persona_name.clone(),
        payload: payload_val,
    };

    // 3. Find matching event subscriptions
    let subs = event_repo::get_subscriptions_by_event_type(&state.db, &event_type)
        .unwrap_or_default();

    let matched_subscriptions: Vec<DryRunMatchedSubscription> = subs
        .into_iter()
        .map(|sub| {
            let persona_name =
                match crate::db::repos::core::personas::get_by_id(&state.db, &sub.persona_id) {
                    Ok(p) => p.name,
                    Err(_) => "Unknown".into(),
                };
            DryRunMatchedSubscription {
                subscription_id: sub.id,
                persona_id: sub.persona_id,
                persona_name,
                event_type: sub.event_type,
                source_filter: sub.source_filter,
            }
        })
        .collect();

    // 4. Find downstream chain triggers that would fire from this persona's output
    let all_triggers = repo::get_all(&state.db).unwrap_or_default();
    let chain_targets: Vec<DryRunChainTarget> = all_triggers
        .into_iter()
        .filter(|t| {
            if t.trigger_type != "chain" { return false; }
            let config: serde_json::Value = t.config.as_deref()
                .and_then(|c| serde_json::from_str(c).ok())
                .unwrap_or(serde_json::Value::Null);
            config.get("source_persona_id")
                .and_then(|v| v.as_str())
                .map(|sid| sid == target_persona_id)
                .unwrap_or(false)
        })
        .map(|t| {
            let config: serde_json::Value = t.config.as_deref()
                .and_then(|c| serde_json::from_str(c).ok())
                .unwrap_or(serde_json::Value::Null);
            let condition_type = config.get("condition")
                .or(config.get("condition_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("any")
                .to_string();
            let persona_name =
                match crate::db::repos::core::personas::get_by_id(&state.db, &t.persona_id) {
                    Ok(p) => p.name,
                    Err(_) => "Unknown".into(),
                };
            DryRunChainTarget {
                trigger_id: t.id,
                target_persona_id: t.persona_id,
                target_persona_name: persona_name,
                condition_type,
                enabled: t.enabled,
            }
        })
        .collect();

    Ok(DryRunResult {
        valid: validation.valid,
        validation,
        simulated_event,
        matched_subscriptions,
        chain_targets,
    })
}

// =============================================================================
// Cron Agents — unified view of personas with schedule triggers
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CronAgent {
    pub persona_id: String,
    pub persona_name: String,
    pub persona_icon: Option<String>,
    pub persona_color: Option<String>,
    pub persona_enabled: bool,
    pub headless: bool,
    pub trigger_id: String,
    pub cron_expression: Option<String>,
    pub interval_seconds: Option<u64>,
    pub trigger_enabled: bool,
    pub last_triggered_at: Option<String>,
    pub next_trigger_at: Option<String>,
    pub description: String,
    /// Recent execution count (last 24h)
    pub recent_executions: i64,
    /// Recent failure count (last 24h)
    pub recent_failures: i64,
}

/// List all personas that have at least one schedule trigger, enriched with
/// cron metadata and recent execution stats. This powers the "Cron Agents" panel.
#[tauri::command]
pub fn list_cron_agents(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CronAgent>, AppError> {
    require_auth_sync(&state)?;

    let conn = state.db.get()?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339();

    let mut stmt = conn.prepare(
        "SELECT
            p.id            AS persona_id,
            p.name          AS persona_name,
            p.icon          AS persona_icon,
            p.color         AS persona_color,
            p.enabled       AS persona_enabled,
            p.headless      AS headless,
            t.id            AS trigger_id,
            t.config        AS trigger_config,
            t.enabled       AS trigger_enabled,
            t.last_triggered_at,
            t.next_trigger_at,
            COALESCE((SELECT COUNT(*) FROM persona_executions e
                       WHERE e.persona_id = p.id AND e.created_at >= ?1), 0)
                            AS recent_executions,
            COALESCE((SELECT COUNT(*) FROM persona_executions e
                       WHERE e.persona_id = p.id AND e.status = 'failed' AND e.created_at >= ?1), 0)
                            AS recent_failures
         FROM persona_triggers t
         JOIN personas p ON p.id = t.persona_id
         WHERE t.trigger_type = 'schedule'
         ORDER BY t.next_trigger_at ASC NULLS LAST"
    )?;

    let rows = stmt.query_map([&cutoff], |row| {
        let config_json: Option<String> = row.get("trigger_config")?;
        let (cron_expression, interval_seconds) = config_json
            .as_deref()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
            .map(|v| {
                (
                    v.get("cron").and_then(|c| c.as_str().map(String::from)),
                    v.get("interval_seconds").and_then(|i| i.as_u64()),
                )
            })
            .unwrap_or((None, None));

        let description = cron_expression
            .as_deref()
            .map(cron_to_human)
            .or_else(|| interval_seconds.map(|s| {
                if s >= 3600 { format!("Every {} hours", s / 3600) }
                else { format!("Every {} minutes", s / 60) }
            }))
            .unwrap_or_else(|| "No schedule configured".into());

        Ok(CronAgent {
            persona_id: row.get("persona_id")?,
            persona_name: row.get("persona_name")?,
            persona_icon: row.get("persona_icon")?,
            persona_color: row.get("persona_color")?,
            persona_enabled: row.get::<_, i32>("persona_enabled")? != 0,
            headless: row.get::<_, i32>("headless").unwrap_or(0) != 0,
            trigger_id: row.get("trigger_id")?,
            cron_expression,
            interval_seconds,
            trigger_enabled: row.get::<_, i32>("trigger_enabled")? != 0,
            last_triggered_at: row.get("last_triggered_at")?,
            next_trigger_at: row.get("next_trigger_at")?,
            description,
            recent_executions: row.get("recent_executions")?,
            recent_failures: row.get("recent_failures")?,
        })
    })?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}
