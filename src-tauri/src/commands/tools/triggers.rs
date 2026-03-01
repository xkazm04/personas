use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreateTriggerInput, PersonaTrigger, UpdateTriggerInput};
use crate::db::repos::resources::triggers as repo;
use crate::db::repos::communication::events as event_repo;
use crate::engine::chain;
use crate::error::AppError;
use crate::AppState;

#[tauri::command]
pub fn list_all_triggers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PersonaTrigger>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn list_triggers(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaTrigger>, AppError> {
    repo::get_by_persona_id(&state.db, &persona_id)
}

#[tauri::command]
pub fn create_trigger(
    state: State<'_, Arc<AppState>>,
    input: CreateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_trigger(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateTriggerInput,
) -> Result<PersonaTrigger, AppError> {
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_trigger(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}

/// Returns a map of trigger_id -> health status in a single DB query.
/// Replaces the N+1 IPC pattern where the frontend fetched executions per persona.
#[tauri::command]
pub fn get_trigger_health_map(
    state: State<'_, Arc<AppState>>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
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
    let trigger = repo::get_by_id(&state.db, &id)?;
    let config: serde_json::Value = trigger
        .config
        .as_deref()
        .and_then(|c| serde_json::from_str(c).ok())
        .unwrap_or(serde_json::Value::Null);

    let mut checks: Vec<TriggerValidationCheck> = Vec::new();

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
                            message: format!("Invalid cron: {}", e),
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
                        message: format!("{}s (minimum 60s)", interval),
                    });
                } else {
                    checks.push(TriggerValidationCheck {
                        label: "Interval".into(),
                        passed: false,
                        message: format!("{}s is below minimum of 60s", interval),
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
                        message: format!("{}s", interval),
                    });
                } else {
                    checks.push(TriggerValidationCheck {
                        label: "Interval".into(),
                        passed: false,
                        message: format!("{}s is below minimum of 60s", interval),
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
                    match url::Url::parse(endpoint) {
                        Ok(_) => {
                            // Use HEAD only — never GET, which can trigger
                            // side effects on OAuth callbacks, webhook confirmations, etc.
                            let client = reqwest::Client::builder()
                                .timeout(std::time::Duration::from_secs(5))
                                .build()
                                .unwrap_or_default();
                            match client.head(endpoint).send().await {
                                Ok(resp) => {
                                    let status = resp.status().as_u16();
                                    if status == 405 {
                                        // Method Not Allowed — endpoint exists but rejects HEAD
                                        checks.push(TriggerValidationCheck {
                                            label: "Endpoint".into(),
                                            passed: true,
                                            message: "Reachable (HEAD not allowed, but server responded)".into(),
                                        });
                                    } else {
                                        checks.push(TriggerValidationCheck {
                                            label: "Endpoint".into(),
                                            passed: true,
                                            message: format!("Reachable (HTTP {})", status),
                                        });
                                    }
                                }
                                Err(e) => {
                                    checks.push(TriggerValidationCheck {
                                        label: "Endpoint".into(),
                                        passed: false,
                                        message: format!("Unreachable: {}", e),
                                    });
                                }
                            }
                        }
                        Err(_) => {
                            checks.push(TriggerValidationCheck {
                                label: "Endpoint".into(),
                                passed: false,
                                message: format!("Invalid URL: {}", endpoint),
                            });
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
                            message: format!("Persona {} not found", source_id),
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
    cron_expression: String,
    count: Option<usize>,
) -> Result<CronPreview, AppError> {
    let count = count.unwrap_or(5).min(10);

    let schedule = match crate::engine::cron::parse_cron(&cron_expression) {
        Ok(s) => s,
        Err(e) => {
            return Ok(CronPreview {
                valid: false,
                description: String::new(),
                next_runs: vec![],
                error: Some(format!("Invalid cron expression: {}", e)),
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
        return format!("Cron: {}", expr);
    }
    let (min, hour, dom, mon, dow) = (fields[0], fields[1], fields[2], fields[3], fields[4]);

    // Every minute
    if min == "*" && hour == "*" && dom == "*" && mon == "*" && dow == "*" {
        return "Every minute".into();
    }

    // Every N minutes
    if min.starts_with("*/") && hour == "*" && dom == "*" && mon == "*" && dow == "*" {
        let n = &min[2..];
        return format!("Every {} minutes", n);
    }

    // Every N hours
    if min == "0" && hour.starts_with("*/") && dom == "*" && mon == "*" && dow == "*" {
        let n = &hour[2..];
        return format!("Every {} hours", n);
    }

    // Specific time patterns
    let time_str = format_time_from_cron(min, hour);

    // Daily at specific time
    if dom == "*" && mon == "*" && dow == "*" {
        return format!("Daily at {}", time_str);
    }

    // Specific days of week
    if dom == "*" && mon == "*" && dow != "*" {
        let days = format_dow(dow);
        return format!("Every {} at {}", days, time_str);
    }

    // Specific day of month
    if dom != "*" && mon == "*" && dow == "*" {
        let ordinal = format_dom(dom);
        return format!("Monthly on the {} at {}", ordinal, time_str);
    }

    // Fallback
    format!("Cron: {}", expr)
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
        format!("{} {}", h12, ampm)
    } else {
        format!("{}:{:02} {}", h12, m, ampm)
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

    let names: Vec<&str> = parts
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
                    Some(format!("{}-{}", start, end))
                } else {
                    None
                }
                .map(|s| Box::leak(s.into_boxed_str()) as &str)
            } else {
                let idx: usize = p.trim().parse().unwrap_or(8);
                DAYS.get(idx).copied()
            }
        })
        .collect();

    if names.len() == 1 {
        names[0].to_string()
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
    format!("{}{}", d, suffix)
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
