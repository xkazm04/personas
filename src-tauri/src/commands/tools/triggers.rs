use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreateTriggerInput, PersonaTrigger, UpdateTriggerInput};
use crate::db::models::webhook_log::WebhookRequestLog;
use crate::db::repos::resources::triggers as repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::repos::resources::webhook_log as webhook_log_repo;
use crate::db::repos::communication::events as event_repo;
use crate::engine::chain;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync, require_privileged};
use crate::validation::contract::check;
use crate::validation::trigger as tv;
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

/// Validate trigger creation input using the validation contract layer.
fn validate_trigger_input(trigger_type: &str, config: Option<&str>) -> Result<(), AppError> {
    let mut errors = Vec::new();
    errors.extend(tv::validate_config_json(config));
    errors.extend(tv::validate_polling_url(trigger_type, config));
    check(errors)
}

/// If the trigger is a chain type, validate the condition type and extract
/// source_persona_id from config to run cycle detection.
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
    let val = config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok());

    // Validate condition type if present
    if let Some(ref v) = val {
        if let Some(condition) = v.get("condition") {
            if let Some(ctype) = condition.get("type").and_then(|t| t.as_str()) {
                use crate::db::models::ChainConditionType;
                ctype.parse::<ChainConditionType>().map_err(|e| {
                    AppError::Validation(e)
                })?;
            }
        }
    }

    // Cycle detection
    let source = val
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
    validate_trigger_input(&input.trigger_type, input.config.as_deref())?;
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
    check(tv::validate_config_json(input.config.as_deref()))?;
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
        check(tv::validate_polling_url(trigger_type, config))?;
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

    // Fix 4a: cascade-delete the paired auto-listener event_listener, if any,
    // BEFORE the primary delete. Best-effort — a failure here doesn't block
    // the intentional delete because the orphan sweep in cleanup_tick will
    // pick up any stragglers on the next minute.
    if let Err(e) = repo::delete_auto_listeners_for(&state.db, &id) {
        tracing::warn!(
            trigger_id = %id,
            error = %e,
            "delete_trigger: failed to cascade-delete auto-listener (will be caught by cleanup sweep)"
        );
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
                // Return early -- all downstream checks depend on valid config
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
                        let next_msg = crate::engine::cron::next_fire_time_local(&schedule, chrono::Utc::now())
                            .map(|t| {
                                let local = t.with_timezone(&chrono::Local);
                                format!("Valid -- next fire: {}", local.format("%Y-%m-%d %H:%M"))
                            })
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
            // Validate polling URL reachability.
            // The engine reads `url` from TriggerConfig::Polling; fall back to
            // `endpoint` for backward compatibility with older configs.
            let polling_url = config.get("url")
                .or_else(|| config.get("endpoint"))
                .and_then(|v| v.as_str());
            if let Some(endpoint) = polling_url {
                if endpoint.is_empty() {
                    checks.push(TriggerValidationCheck {
                        label: "Polling URL".into(),
                        passed: false,
                        message: "Polling URL is empty".into(),
                    });
                } else {
                    // SSRF protection: block private/internal IPs before making any request
                    match crate::engine::url_safety::validate_url_safety(endpoint) {
                        Err(reason) => {
                            checks.push(TriggerValidationCheck {
                                label: "Polling URL".into(),
                                passed: false,
                                message: format!("Blocked: {reason}"),
                            });
                        }
                        Ok(()) => match url::Url::parse(endpoint) {
                            Ok(_) => {
                                // Use HEAD only -- never GET, which can trigger
                                // side effects on OAuth callbacks, webhook confirmations, etc.
                                // Redirects disabled to prevent SSRF via redirect to internal IPs.
                                // DNS resolver rejects private/internal IPs at connect time,
                                // closing the DNS-rebinding gap left by the string-only
                                // validate_url_safety check above.
                                let client = reqwest::Client::builder()
                                    .timeout(std::time::Duration::from_secs(5))
                                    .redirect(reqwest::redirect::Policy::none())
                                    .dns_resolver(std::sync::Arc::new(
                                        crate::engine::ssrf_safe_dns::SsrfSafeDnsResolver,
                                    ))
                                    .build()
                                    .unwrap_or_default();
                                match client.head(endpoint).send().await {
                                    Ok(resp) => {
                                        let status = resp.status().as_u16();
                                        if status == 405 {
                                            checks.push(TriggerValidationCheck {
                                                label: "Polling URL".into(),
                                                passed: true,
                                                message: "Reachable (HEAD not allowed, but server responded)".into(),
                                            });
                                        } else if (300..400).contains(&status) {
                                            let location = resp.headers()
                                                .get("location")
                                                .and_then(|v| v.to_str().ok())
                                                .unwrap_or("unknown");
                                            checks.push(TriggerValidationCheck {
                                                label: "Polling URL".into(),
                                                passed: true,
                                                message: format!("Reachable (HTTP {status} redirect to {location})"),
                                            });
                                        } else {
                                            checks.push(TriggerValidationCheck {
                                                label: "Polling URL".into(),
                                                passed: true,
                                                message: format!("Reachable (HTTP {status})"),
                                            });
                                        }
                                    }
                                    Err(e) => {
                                        checks.push(TriggerValidationCheck {
                                            label: "Polling URL".into(),
                                            passed: false,
                                            message: format!("Unreachable: {e}"),
                                        });
                                    }
                                }
                            }
                            Err(_) => {
                                checks.push(TriggerValidationCheck {
                                    label: "Polling URL".into(),
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
            // Webhook triggers are passive -- validate that the webhook server is alive
            let webhook_alive = state.scheduler.is_webhook_alive();
            checks.push(TriggerValidationCheck {
                label: "Webhook listener".into(),
                passed: webhook_alive,
                message: if webhook_alive {
                    format!("Active on http://localhost:9420/webhook/{}", trigger.id)
                } else {
                    "Webhook server is not running -- webhook won't receive events".into()
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

    // Compute next N fire times (cron evaluated in local timezone)
    let mut runs = Vec::with_capacity(count);
    let mut from = chrono::Utc::now();
    for _ in 0..count {
        match crate::engine::cron::next_fire_time_local(&schedule, from) {
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
// Builder: persona <-> event linking
// See docs/design/event-routing-proposal.md
// =============================================================================

/// Atomically wire a persona as a listener for an event_type. Creates an
/// event_listener trigger AND patches the persona's structured_prompt so the
/// persona actually knows what to do with the event at runtime.
///
/// `handler_text` is optional: when omitted, a generic placeholder is used.
/// Returns the newly created trigger.
#[tauri::command]
pub fn link_persona_to_event(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    event_type: String,
    handler_text: Option<String>,
) -> Result<PersonaTrigger, AppError> {
    require_auth_sync(&state)?;
    repo::link_persona_to_event(
        &state.db,
        &persona_id,
        &event_type,
        handler_text.as_deref(),
    )
}

/// Inverse of `link_persona_to_event`: delete the trigger AND remove its
/// matching eventHandlers entry in a single transaction.
#[tauri::command]
pub fn unlink_persona_from_event(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::unlink_persona_from_event(&state.db, &trigger_id)?;
    Ok(true)
}

/// Seed a persona's eventHandlers from its existing event_listener triggers.
/// Returns the number of handler entries created. Idempotent.
#[tauri::command]
pub fn initialize_event_handlers_for_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<u32, AppError> {
    require_auth_sync(&state)?;
    repo::initialize_event_handlers_for_persona(&state.db, &persona_id)
}

/// Update a single event handler's text. Used by the "Refine handler" action
/// in the Builder. Creates the eventHandlers map if it doesn't exist yet.
#[tauri::command]
pub fn update_persona_event_handler(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    event_type: String,
    handler_text: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::update_persona_event_handler(&state.db, &persona_id, &event_type, &handler_text)?;
    Ok(true)
}

// =============================================================================
// Fix 1 + Fix 4a: trigger / event cleanup + backfill
// See docs/design/event-routing-proposal.md Fix 1, Fix 2, Fix 4a
// =============================================================================

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TriggerCleanupResult {
    pub orphaned_triggers_deleted: u32,
    pub orphaned_events_deleted: u32,
    pub auto_listeners_backfilled: u32,
    pub source_triggers_scanned: u32,
}

/// Atomically rename an event type everywhere it's referenced: persona_events,
/// persona_event_subscriptions, persona_triggers (config event_type /
/// listen_event_type / _handler_key), and personas.structured_prompt
/// .eventHandlers. Rejects reserved infrastructure event types and collisions.
#[tauri::command]
pub fn rename_event_type(
    state: State<'_, Arc<AppState>>,
    old_event_type: String,
    new_event_type: String,
) -> Result<repo::RenameEventTypeResult, AppError> {
    require_auth_sync(&state)?;
    repo::rename_event_type(&state.db, &old_event_type, &new_event_type)
}

/// One-shot cleanup + self-healing sweep for the trigger / event subsystem.
///
/// 1. Deletes triggers whose owning persona no longer exists (with cascade
///    to their paired auto-listeners).
/// 2. Deletes persona_events rows whose `source_id` no longer matches any
///    trigger in persona_triggers (dead audit log rows).
/// 3. Backfills missing auto-listeners for schedule / polling / webhook
///    triggers that predate Fix 4a.
///
/// All three steps are idempotent and safe to run on app boot or from a
/// Builder "Clean up" button. Returns counts for UI feedback.
#[tauri::command]
pub fn cleanup_dead_trigger_events(
    state: State<'_, Arc<AppState>>,
) -> Result<TriggerCleanupResult, AppError> {
    require_auth_sync(&state)?;

    let orphaned_triggers_deleted = repo::delete_orphaned_triggers(&state.db)?;
    let orphaned_events_deleted = event_repo::delete_orphaned_trigger_events(&state.db)?;
    let (scanned, backfilled) = repo::backfill_auto_listeners(&state.db)?;

    Ok(TriggerCleanupResult {
        orphaned_triggers_deleted,
        orphaned_events_deleted,
        auto_listeners_backfilled: backfilled,
        source_triggers_scanned: scanned,
    })
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

    // 4. Find downstream chain triggers using SQL-level filtering instead of get_all
    let chain_triggers = repo::get_chain_triggers_for_source(&state.db, &target_persona_id)
        .unwrap_or_default();

    // 5. Batch-fetch all persona names needed for subscriptions + chain targets
    let mut persona_ids_needed: Vec<String> = subs.iter().map(|s| s.persona_id.clone()).collect();
    persona_ids_needed.extend(chain_triggers.iter().map(|t| t.persona_id.clone()));
    persona_ids_needed.sort_unstable();
    persona_ids_needed.dedup();

    let personas = crate::db::repos::core::personas::get_by_ids(&state.db, &persona_ids_needed)
        .unwrap_or_default();
    let persona_name_map: std::collections::HashMap<String, String> = personas
        .into_iter()
        .map(|p| (p.id, p.name))
        .collect();

    let matched_subscriptions: Vec<DryRunMatchedSubscription> = subs
        .into_iter()
        .map(|sub| {
            let persona_name = persona_name_map
                .get(&sub.persona_id)
                .cloned()
                .unwrap_or_else(|| "Unknown".into());
            DryRunMatchedSubscription {
                subscription_id: sub.id,
                persona_id: sub.persona_id,
                persona_name,
                event_type: sub.event_type,
                source_filter: sub.source_filter,
            }
        })
        .collect();

    let chain_targets: Vec<DryRunChainTarget> = chain_triggers
        .into_iter()
        .map(|t| {
            let config: serde_json::Value = t.config.as_deref()
                .and_then(|c| serde_json::from_str(c).ok())
                .unwrap_or(serde_json::Value::Null);
            let condition_type = config.get("condition")
                .and_then(|c| c.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("any")
                .to_string();
            let persona_name = persona_name_map
                .get(&t.persona_id)
                .cloned()
                .unwrap_or_else(|| "Unknown".into());
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
// Cron Agents -- unified view of personas with schedule triggers
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

// -- Dev seed: mock schedule trigger -------------------------------------------

const MOCK_CRON_EXPRESSIONS: &[&str] = &[
    "*/5 * * * *",   // every 5 minutes
    "0 * * * *",     // every hour
    "0 */6 * * *",   // every 6 hours
    "0 9 * * 1-5",   // weekdays at 9am
    "0 0 * * *",     // daily at midnight
    "*/15 * * * *",  // every 15 minutes
];

#[tauri::command]
pub fn seed_mock_cron_agent(
    state: State<'_, Arc<AppState>>,
) -> Result<CronAgent, AppError> {
    require_auth_sync(&state)?;

    #[cfg(not(debug_assertions))]
    {
        return Err(crate::error::AppError::Validation(
            "seed_mock_cron_agent is only available in debug builds".into(),
        ));
    }

    #[cfg(debug_assertions)]
    {
    let personas = crate::db::repos::core::personas::get_all(&state.db)?;
    let t = chrono::Utc::now().timestamp_millis() as usize;
    let idx = t % std::cmp::max(personas.len(), 1);

    // Fallback persona info when no real personas exist
    let fallback_id = "mock-persona".to_string();
    let fallback_name = "Mock Agent".to_string();
    let (p_id, p_name, p_icon, p_color, p_enabled, p_headless) = if let Some(p) = personas.get(idx) {
        (p.id.clone(), p.name.clone(), p.icon.clone(), p.color.clone(), p.enabled, p.headless)
    } else {
        (fallback_id, fallback_name, Some("\u{1F916}".to_string()), Some("#6366f1".to_string()), true, false)
    };

    let cron_expr = MOCK_CRON_EXPRESSIONS[t % MOCK_CRON_EXPRESSIONS.len()];
    let config = serde_json::json!({ "cron": cron_expr }).to_string();
    let trigger_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    let next = (now + chrono::Duration::minutes(((t % 60) + 5) as i64)).to_rfc3339();

    let conn = state.db.get()?;

    // Ensure the persona row exists so list_cron_agents JOIN succeeds
    if personas.is_empty() {
        conn.execute(
            "INSERT OR IGNORE INTO personas (id, name, system_prompt, icon, color, enabled, headless, created_at, updated_at)
             VALUES (?1, ?2, 'Mock scheduled agent for development testing', ?3, ?4, 1, 0, ?5, ?5)",
            rusqlite::params![p_id, p_name, p_icon, p_color, now_str],
        )?;
    }

    conn.execute(
        "INSERT INTO persona_triggers
         (id, persona_id, trigger_type, config, enabled, last_triggered_at, next_trigger_at, created_at, updated_at)
         VALUES (?1, ?2, 'schedule', ?3, 1, ?4, ?5, ?4, ?4)",
        rusqlite::params![trigger_id, p_id, config, now_str, next],
    )?;

    let description = cron_to_human(cron_expr);

    Ok(CronAgent {
        persona_id: p_id,
        persona_name: p_name,
        persona_icon: p_icon,
        persona_color: p_color,
        persona_enabled: p_enabled,
        headless: p_headless,
        trigger_id,
        cron_expression: Some(cron_expr.to_string()),
        interval_seconds: None,
        trigger_enabled: true,
        last_triggered_at: Some(now_str.clone()),
        next_trigger_at: Some(next),
        description,
        recent_executions: 0,
        recent_failures: 0,
    })
    }
}

// =============================================================================
// Webhook Request Inspector
// =============================================================================

/// List recent webhook request logs for a trigger (last 100, newest first).
#[tauri::command]
pub fn list_webhook_request_logs(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
) -> Result<Vec<WebhookRequestLog>, AppError> {
    require_auth_sync(&state)?;
    webhook_log_repo::list_by_trigger(&state.db, &trigger_id)
}

/// Clear all webhook request logs for a trigger.
#[tauri::command]
pub fn clear_webhook_request_logs(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    webhook_log_repo::delete_by_trigger(&state.db, &trigger_id)
}

/// Replay a previously captured webhook request by re-posting its payload to the webhook endpoint.
#[tauri::command]
pub async fn replay_webhook_request(
    state: State<'_, Arc<AppState>>,
    log_id: String,
) -> Result<String, AppError> {
    require_auth(&state).await?;
    let log_entry = webhook_log_repo::get_by_id(&state.db, &log_id)?;

    // Look up the trigger to get the HMAC secret
    let trigger = repo::get_by_id(&state.db, &log_entry.trigger_id)?;
    let cfg = trigger.parse_config();
    let webhook_secret = match &cfg {
        crate::db::models::TriggerConfig::Webhook { webhook_secret, .. } => webhook_secret.clone(),
        _ => None,
    };

    let body_bytes = log_entry.body.unwrap_or_default();
    let url = format!("http://localhost:9420/webhook/{}", log_entry.trigger_id);

    let mut req = crate::SHARED_HTTP
        .post(&url)
        .header("content-type", "application/json");

    // Compute HMAC signature for the replayed payload
    if let Some(ref secret) = webhook_secret {
        if !secret.is_empty() {
            use hmac::{Hmac, Mac};
            use sha2::Sha256;
            type HmacSha256 = Hmac<Sha256>;
            let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
                .map_err(|e| AppError::Internal(format!("HMAC init failed: {e}")))?;
            mac.update(body_bytes.as_bytes());
            let sig = hex::encode(mac.finalize().into_bytes());
            req = req.header("x-hub-signature-256", format!("sha256={sig}"));
        }
    }

    let resp = req
        .body(body_bytes)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Replay request failed: {e}")))?;

    let status = resp.status().as_u16();
    let resp_body = resp.text().await.unwrap_or_default();

    if status == 200 {
        // Extract event_id from response
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&resp_body) {
            if let Some(eid) = parsed.get("event_id").and_then(|v| v.as_str()) {
                return Ok(eid.to_string());
            }
        }
        Ok(resp_body)
    } else {
        Err(AppError::Internal(format!("Replay failed with status {status}: {resp_body}")))
    }
}

/// Generate a curl command string for a webhook request log entry.
#[tauri::command]
pub fn webhook_request_to_curl(
    state: State<'_, Arc<AppState>>,
    log_id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let log_entry = webhook_log_repo::get_by_id(&state.db, &log_id)?;

    let url = format!("http://localhost:9420/webhook/{}", log_entry.trigger_id);
    let mut parts = vec![format!("curl -X {} '{}'", log_entry.method, url)];

    // Add headers (skip content-length and host as curl handles them)
    if let Some(ref headers_json) = log_entry.headers {
        if let Ok(headers) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(headers_json) {
            for (key, value) in &headers {
                let k = key.to_lowercase();
                if k == "content-length" || k == "host" {
                    continue;
                }
                if let Some(v) = value.as_str() {
                    parts.push(format!("  -H '{}: {}'", key, v));
                }
            }
        }
    }

    // Add body
    if let Some(ref body) = log_entry.body {
        if !body.is_empty() {
            // Escape single quotes in body for shell safety
            let escaped = body.replace('\'', "'\\''");
            parts.push(format!("  -d '{}'", escaped));
        }
    }

    Ok(parts.join(" \\\n"))
}

// =============================================================================
// Config warnings (chain triggers + tool kind ambiguity)
// =============================================================================

/// A config-level warning surfaced to the frontend health check system.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ConfigWarning {
    pub id: String,
    pub severity: String,
    pub category: String,
    pub description: String,
}

/// Validate chain trigger configs and tool kind for a persona, returning
/// any warnings. Used by the frontend health check to surface silent failures.
#[tauri::command]
pub fn get_persona_config_warnings(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<ConfigWarning>, AppError> {
    require_auth_sync(&state)?;
    let mut warnings: Vec<ConfigWarning> = Vec::new();

    // 1. Check chain trigger configs for malformed JSON
    let triggers = repo::get_by_persona_id(&state.db, &persona_id)?;
    for trigger in &triggers {
        if trigger.trigger_type != "chain" {
            continue;
        }
        match trigger.config.as_deref() {
            Some(raw) => {
                if let Err(e) = serde_json::from_str::<serde_json::Value>(raw) {
                    warnings.push(ConfigWarning {
                        id: format!("chain_parse_{}", trigger.id),
                        severity: "warning".into(),
                        category: "chain_trigger".into(),
                        description: format!(
                            "Chain trigger '{}' has malformed config JSON: {}",
                            trigger.id, e
                        ),
                    });
                }
            }
            None => {
                warnings.push(ConfigWarning {
                    id: format!("chain_empty_{}", trigger.id),
                    severity: "warning".into(),
                    category: "chain_trigger".into(),
                    description: format!(
                        "Chain trigger '{}' has no config — it will be silently skipped at runtime",
                        trigger.id
                    ),
                });
            }
        }
    }

    // 2. Check tool kind ambiguity (both script_path and implementation_guide set)
    let tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    for tool in &tools {
        if tool.category == crate::db::models::VirtualToolId::CATEGORY {
            continue;
        }
        let has_script = !tool.script_path.is_empty();
        let has_api = tool.implementation_guide.as_ref().is_some_and(|g| !g.is_empty());
        if has_script && has_api {
            warnings.push(ConfigWarning {
                id: format!("tool_conflict_{}", tool.id),
                severity: "warning".into(),
                category: "tool_config".into(),
                description: format!(
                    "Tool '{}' has both script_path and implementation_guide set. Remove one to resolve the ambiguity.",
                    tool.name
                ),
            });
        } else if !has_script && !has_api {
            warnings.push(ConfigWarning {
                id: format!("tool_no_strategy_{}", tool.id),
                severity: "warning".into(),
                category: "tool_config".into(),
                description: format!(
                    "Tool '{}' has no execution strategy: no script_path and no implementation_guide",
                    tool.name
                ),
            });
        }
    }

    Ok(warnings)
}

// =============================================================================
// Composite Partial-Match Observability
// =============================================================================

/// Returns the latest partial-match evaluation snapshots for all composite triggers.
/// Each result shows how many conditions were met vs total, with per-condition detail.
#[tauri::command]
pub fn get_composite_partial_matches(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::engine::composite::PartialMatchResult>, AppError> {
    require_auth_sync(&state)?;
    Ok(state.composite_state.get_partial_matches())
}

/// Returns the partial-match snapshot for a single composite trigger.
#[tauri::command]
pub fn get_composite_partial_match(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
) -> Result<Option<crate::engine::composite::PartialMatchResult>, AppError> {
    require_auth_sync(&state)?;
    Ok(state.composite_state.get_partial_match_for(&trigger_id))
}
