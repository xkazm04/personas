use std::sync::Arc;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreateTriggerInput, PersonaTrigger, UpdateTriggerInput};
use crate::db::repos::resources::triggers as repo;
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
                            // Try reaching the endpoint
                            let client = reqwest::Client::builder()
                                .timeout(std::time::Duration::from_secs(5))
                                .build()
                                .unwrap_or_default();
                            match client.head(endpoint).send().await {
                                Ok(resp) => {
                                    checks.push(TriggerValidationCheck {
                                        label: "Endpoint".into(),
                                        passed: true,
                                        message: format!("Reachable (HTTP {})", resp.status().as_u16()),
                                    });
                                }
                                Err(e) => {
                                    // HEAD might not be supported; try GET
                                    match client.get(endpoint).send().await {
                                        Ok(resp) => {
                                            checks.push(TriggerValidationCheck {
                                                label: "Endpoint".into(),
                                                passed: true,
                                                message: format!("Reachable (HTTP {})", resp.status().as_u16()),
                                            });
                                        }
                                        Err(_) => {
                                            checks.push(TriggerValidationCheck {
                                                label: "Endpoint".into(),
                                                passed: false,
                                                message: format!("Unreachable: {}", e),
                                            });
                                        }
                                    }
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
                        message: format!("Configured ({}...{})", &secret[..1.min(secret.len())], &secret[secret.len().saturating_sub(4)..]),
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
