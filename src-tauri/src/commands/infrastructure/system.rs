use std::sync::Arc;

use serde::Serialize;
use tauri::{Manager, State};
use ts_rs::TS;

use crate::db::settings_keys;
use crate::error::AppError;
use crate::AppState;

pub(crate) fn command_exists_in_path(command: &str) -> bool {
    let probe = if cfg!(target_os = "windows") {
        std::process::Command::new("where").arg(command).output()
    } else {
        std::process::Command::new("which").arg(command).output()
    };

    matches!(probe, Ok(output) if output.status.success())
}

pub(crate) fn command_version(command: &str) -> Result<String, String> {
    match std::process::Command::new(command)
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Find the first line that looks like a version (contains a digit).
            // CLI tools sometimes emit non-version output (e.g. update-check
            // warnings) before or instead of the actual version string.
            let version = stdout
                .lines()
                .find(|line| line.chars().any(|c| c.is_ascii_digit()))
                .unwrap_or("unknown")
                .trim()
                .to_string();
            Ok(version)
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                Err("Command failed with no error output".into())
            } else {
                Err(stderr)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct HealthCheckItem {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: Option<String>,
    pub installable: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct HealthCheckSection {
    pub id: String,
    pub label: String,
    pub items: Vec<HealthCheckItem>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SystemHealthReport {
    pub sections: Vec<HealthCheckSection>,
    pub all_ok: bool,
}

#[tauri::command]
pub async fn system_health_check(
    state: State<'_, Arc<AppState>>,
) -> Result<SystemHealthReport, AppError> {
    let mut sections = Vec::new();

    // -- Section 1: Local Environment --
    let active_engine = crate::db::repos::core::settings::get(&state.db, settings_keys::CLI_ENGINE)
        .ok()
        .flatten()
        .unwrap_or_else(|| "claude_code".to_string());

    let local_section = build_local_section(&active_engine, state.scheduler.is_running());
    sections.push(local_section);

    // -- Section 2: Agents --
    let mut agent_items = Vec::new();

    let ollama_key_configured = crate::db::repos::core::settings::get(&state.db, settings_keys::OLLAMA_API_KEY)
        .ok()
        .flatten()
        .is_some_and(|k| !k.is_empty());

    agent_items.push(HealthCheckItem {
        id: "ollama_api_key".into(),
        label: "Ollama Cloud API Key".into(),
        status: if ollama_key_configured {
            "ok"
        } else {
            "inactive"
        }
        .into(),
        detail: Some(if ollama_key_configured {
            "Configured -- free Ollama Cloud models available for all agents".into()
        } else {
            "Not configured (optional) -- add a free API key to unlock Ollama Cloud models like Qwen3 Coder, GLM-5, and Kimi K2.5"
                .into()
        }),
        installable: false,
    });

    let litellm_url_configured = crate::db::repos::core::settings::get(&state.db, settings_keys::LITELLM_BASE_URL)
        .ok()
        .flatten()
        .is_some_and(|u| !u.is_empty());
    let litellm_key_configured = crate::db::repos::core::settings::get(&state.db, settings_keys::LITELLM_MASTER_KEY)
        .ok()
        .flatten()
        .is_some_and(|k| !k.is_empty());
    let litellm_configured = litellm_url_configured && litellm_key_configured;

    agent_items.push(HealthCheckItem {
        id: "litellm_proxy".into(),
        label: "LiteLLM Proxy".into(),
        status: if litellm_configured {
            "ok"
        } else {
            "inactive"
        }
        .into(),
        detail: Some(
            if litellm_configured {
                "Configured -- LiteLLM proxy available for all agents".into()
            } else if litellm_url_configured {
                "Base URL set but master key missing -- add master key to complete setup".into()
            } else if litellm_key_configured {
                "Master key set but base URL missing -- add proxy URL to complete setup".into()
            } else {
                "Not configured (optional) -- add a LiteLLM proxy URL and master key to route agents through your proxy".into()
            },
        ),
        installable: false,
    });

    sections.push(HealthCheckSection {
        id: "agents".into(),
        label: "Agents".into(),
        items: agent_items,
    });

    // -- Section 3: Cloud Deployment --
    let cloud_connected = state.cloud_client.lock().await.is_some();
    let mut cloud_items = Vec::new();

    cloud_items.push(HealthCheckItem {
        id: "cloud_orchestrator".into(),
        label: "Cloud Orchestrator".into(),
        status: if cloud_connected { "ok" } else { "info" }.into(),
        detail: Some(if cloud_connected {
            "Connected -- agents can run when this device is off".into()
        } else {
            "Not deployed -- agents only run while this app is open".into()
        }),
        installable: false,
    });

    sections.push(HealthCheckSection {
        id: "cloud".into(),
        label: "Cloud Deployment".into(),
        items: cloud_items,
    });

    // -- Section 4: Account --
    let auth = state.auth.lock().await;
    let auth_resp = auth.to_response();
    drop(auth);

    let mut auth_items = Vec::new();

    if auth_resp.is_authenticated {
        let user_detail = auth_resp
            .user
            .as_ref()
            .map(|u| {
                let name = u.display_name.as_deref().unwrap_or(&u.email);
                if auth_resp.is_offline {
                    format!("{name} (offline mode)")
                } else {
                    name.to_string()
                }
            })
            .unwrap_or_else(|| "Signed in".into());

        auth_items.push(HealthCheckItem {
            id: "google_auth".into(),
            label: "Google Account".into(),
            status: if auth_resp.is_offline { "warn" } else { "ok" }.into(),
            detail: Some(user_detail),
            installable: false,
        });
    } else {
        auth_items.push(HealthCheckItem {
            id: "google_auth".into(),
            label: "Google Account".into(),
            status: "inactive".into(),
            detail: Some("Not signed in -- optional, enables sync and extended features".into()),
            installable: false,
        });
    }

    sections.push(HealthCheckSection {
        id: "account".into(),
        label: "Account".into(),
        items: auth_items,
    });

    // -- Section 5: Circuit Breaker --
    sections.push(build_circuit_breaker_section(&state));

    // -- Section 6: Subscription Health --
    sections.push(build_subscriptions_section(&state));

    // -- Section 7: Frontend Stability --
    let crash_count_24h = crate::db::repos::core::frontend_crashes::count_since(&state.db, 24)
        .unwrap_or(0);
    let crash_count_7d = crate::db::repos::core::frontend_crashes::count_since(&state.db, 168)
        .unwrap_or(0);

    if crash_count_7d > 0 {
        let (fe_status, fe_detail) = if crash_count_24h >= 5 {
            ("warn", format!("{crash_count_24h} crash(es) in the last 24h ({crash_count_7d} in 7d)"))
        } else if crash_count_24h > 0 {
            ("info", format!("{crash_count_24h} crash(es) in the last 24h ({crash_count_7d} in 7d)"))
        } else {
            ("ok", format!("No recent crashes (past 24h), {crash_count_7d} in last 7d"))
        };

        sections.push(HealthCheckSection {
            id: "frontend_stability".into(),
            label: "Frontend Stability".into(),
            items: vec![HealthCheckItem {
                id: "frontend_crashes".into(),
                label: "React Crashes".into(),
                status: fe_status.into(),
                detail: Some(fe_detail),
                installable: false,
            }],
        });
    }

    let all_ok = sections.iter().all(|s| {
        s.items
            .iter()
            .all(|c| c.status == "ok" || c.status == "info" || c.status == "inactive")
    });

    Ok(SystemHealthReport { sections, all_ok })
}

// -- Per-section health checks (cascade loading) ----------------------------

// -- Shared local-section builder (used by both full and cascade endpoints) --

struct EngineProbe {
    id: &'static str,
    label: &'static str,
    setting_key: &'static str,
    candidates: &'static [&'static str],
}

fn build_local_section(active_engine: &str, sched_running: bool) -> HealthCheckSection {
    let mut local_items = Vec::new();

    let engines = [
        EngineProbe {
            id: "claude_cli",
            label: "Claude Code CLI",
            setting_key: "claude_code",
            candidates: if cfg!(target_os = "windows") {
                &["claude", "claude.cmd", "claude.exe", "claude-code"]
            } else {
                &["claude", "claude-code"]
            },
        },
    ];

    for engine in &engines {
        let is_active = active_engine == engine.setting_key;
        let suffix = if is_active { " (active)" } else { "" };

        let mut detected_in_path = false;
        let mut version_result: Option<(String, String)> = None;

        for candidate in engine.candidates {
            if command_exists_in_path(candidate) {
                detected_in_path = true;
            }
            if let Ok(version) = command_version(candidate) {
                version_result = Some(((*candidate).to_string(), version));
                break;
            }
        }

        if let Some((command_name, version)) = version_result {
            local_items.push(HealthCheckItem {
                id: engine.id.into(),
                label: format!("{}{}", engine.label, suffix),
                status: "ok".into(),
                detail: Some(format!("{version} ({command_name})")),
                installable: false,
            });
        } else if detected_in_path {
            local_items.push(HealthCheckItem {
                id: engine.id.into(),
                label: format!("{}{}", engine.label, suffix),
                status: if is_active { "warn" } else { "inactive" }.into(),
                detail: Some(
                    "CLI executable detected in PATH, but version probe failed. Try opening a new terminal session or reinstalling.".into(),
                ),
                installable: true,
            });
        } else {
            local_items.push(HealthCheckItem {
                id: engine.id.into(),
                label: format!("{}{}", engine.label, suffix),
                status: if is_active { "error" } else { "inactive" }.into(),
                detail: Some(if is_active {
                    "Not found. Click Install to set up, or select a different engine in Settings.".into()
                } else {
                    "Not installed (optional)".into()
                }),
                installable: true,
            });
        }
    }

    let node_candidates = ["node", "nodejs"];
    let mut node_ok = None;

    for candidate in node_candidates {
        if let Ok(version) = command_version(candidate) {
            node_ok = Some((candidate.to_string(), version));
            break;
        }
    }

    if let Some((command_name, version)) = node_ok {
        local_items.push(HealthCheckItem {
            id: "node".into(),
            label: "Node.js".into(),
            status: "ok".into(),
            detail: Some(format!("{version} ({command_name})")),
            installable: false,
        });
    } else {
        local_items.push(HealthCheckItem {
            id: "node".into(),
            label: "Node.js".into(),
            status: "warn".into(),
            detail: Some(
                "Not found -- required for Claude CLI. Click Install to set up automatically."
                    .into(),
            ),
            installable: true,
        });
    }

    local_items.push(HealthCheckItem {
        id: "scheduler".into(),
        label: "Event Bus".into(),
        status: if sched_running { "ok" } else { "warn" }.into(),
        detail: Some(if sched_running {
            "Running -- processing events and triggers".into()
        } else {
            "Not started yet".into()
        }),
        installable: false,
    });

    HealthCheckSection {
        id: "local".into(),
        label: "Local Environment".into(),
        items: local_items,
    }
}

#[tauri::command]
pub async fn health_check_local(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    let active_engine = crate::db::repos::core::settings::get(&state.db, settings_keys::CLI_ENGINE)
        .ok()
        .flatten()
        .unwrap_or_else(|| "claude_code".to_string());

    Ok(build_local_section(&active_engine, state.scheduler.is_running()))
}

#[tauri::command]
pub async fn health_check_agents(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    let mut agent_items = Vec::new();

    let ollama_key_configured = crate::db::repos::core::settings::get(&state.db, settings_keys::OLLAMA_API_KEY)
        .ok()
        .flatten()
        .is_some_and(|k| !k.is_empty());

    agent_items.push(HealthCheckItem {
        id: "ollama_api_key".into(),
        label: "Ollama Cloud API Key".into(),
        status: if ollama_key_configured { "ok" } else { "inactive" }.into(),
        detail: Some(if ollama_key_configured {
            "Configured -- free Ollama Cloud models available for all agents".into()
        } else {
            "Not configured (optional) -- add a free API key to unlock Ollama Cloud models like Qwen3 Coder, GLM-5, and Kimi K2.5".into()
        }),
        installable: false,
    });

    let litellm_url_configured = crate::db::repos::core::settings::get(&state.db, settings_keys::LITELLM_BASE_URL)
        .ok()
        .flatten()
        .is_some_and(|u| !u.is_empty());
    let litellm_key_configured = crate::db::repos::core::settings::get(&state.db, settings_keys::LITELLM_MASTER_KEY)
        .ok()
        .flatten()
        .is_some_and(|k| !k.is_empty());
    let litellm_configured = litellm_url_configured && litellm_key_configured;

    agent_items.push(HealthCheckItem {
        id: "litellm_proxy".into(),
        label: "LiteLLM Proxy".into(),
        status: if litellm_configured { "ok" } else { "inactive" }.into(),
        detail: Some(
            if litellm_configured {
                "Configured -- LiteLLM proxy available for all agents".into()
            } else if litellm_url_configured {
                "Base URL set but master key missing -- add master key to complete setup".into()
            } else if litellm_key_configured {
                "Master key set but base URL missing -- add proxy URL to complete setup".into()
            } else {
                "Not configured (optional) -- add a LiteLLM proxy URL and master key to route agents through your proxy".into()
            },
        ),
        installable: false,
    });

    Ok(HealthCheckSection {
        id: "agents".into(),
        label: "Agents".into(),
        items: agent_items,
    })
}

#[tauri::command]
pub async fn health_check_cloud(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    let cloud_connected = state.cloud_client.lock().await.is_some();
    let mut cloud_items = Vec::new();

    cloud_items.push(HealthCheckItem {
        id: "cloud_orchestrator".into(),
        label: "Cloud Orchestrator".into(),
        status: if cloud_connected { "ok" } else { "info" }.into(),
        detail: Some(if cloud_connected {
            "Connected -- agents can run when this device is off".into()
        } else {
            "Not deployed -- agents only run while this app is open".into()
        }),
        installable: false,
    });

    Ok(HealthCheckSection {
        id: "cloud".into(),
        label: "Cloud Deployment".into(),
        items: cloud_items,
    })
}

#[tauri::command]
pub async fn health_check_account(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    let auth = state.auth.lock().await;
    let auth_resp = auth.to_response();
    drop(auth);

    let mut auth_items = Vec::new();

    if auth_resp.is_authenticated {
        let user_detail = auth_resp
            .user
            .as_ref()
            .map(|u| {
                let name = u.display_name.as_deref().unwrap_or(&u.email);
                if auth_resp.is_offline {
                    format!("{name} (offline mode)")
                } else {
                    name.to_string()
                }
            })
            .unwrap_or_else(|| "Signed in".into());

        auth_items.push(HealthCheckItem {
            id: "google_auth".into(),
            label: "Google Account".into(),
            status: if auth_resp.is_offline { "warn" } else { "ok" }.into(),
            detail: Some(user_detail),
            installable: false,
        });
    } else {
        auth_items.push(HealthCheckItem {
            id: "google_auth".into(),
            label: "Google Account".into(),
            status: "inactive".into(),
            detail: Some("Not signed in -- optional, enables sync and extended features".into()),
            installable: false,
        });
    }

    Ok(HealthCheckSection {
        id: "account".into(),
        label: "Account".into(),
        items: auth_items,
    })
}

fn build_circuit_breaker_section(state: &AppState) -> HealthCheckSection {
    let cb_status = state.engine.circuit_breaker.get_status();
    let mut items = Vec::new();

    for p in &cb_status.providers {
        let (status, detail) = if p.is_open {
            (
                "error",
                format!(
                    "Circuit OPEN — {} consecutive failures, cooldown {:.0}s remaining",
                    p.consecutive_failures, p.cooldown_remaining_secs,
                ),
            )
        } else if p.consecutive_failures > 0 {
            (
                "warn",
                format!("{} consecutive failure{}", p.consecutive_failures, if p.consecutive_failures > 1 { "s" } else { "" }),
            )
        } else {
            ("ok", "Healthy — no recent failures".into())
        };

        items.push(HealthCheckItem {
            id: format!("cb_{}", p.provider),
            label: format!("{} Circuit", p.provider),
            status: status.into(),
            detail: Some(detail),
            installable: false,
        });
    }

    // Global breaker item
    let (global_status, global_detail) = if cb_status.global_paused {
        (
            "error",
            format!(
                "ALL PROVIDERS PAUSED — {} failures in rolling window, resumes in {:.0}s",
                cb_status.global_failure_count, cb_status.global_cooldown_remaining_secs,
            ),
        )
    } else if cb_status.global_failure_count > 0 {
        (
            "warn",
            format!(
                "{} failure{} in rolling window (threshold: 10)",
                cb_status.global_failure_count,
                if cb_status.global_failure_count > 1 { "s" } else { "" },
            ),
        )
    } else {
        ("ok", "No failures in rolling window".into())
    };

    items.push(HealthCheckItem {
        id: "cb_global".into(),
        label: "Global Breaker".into(),
        status: global_status.into(),
        detail: Some(global_detail),
        installable: false,
    });

    HealthCheckSection {
        id: "circuit_breaker".into(),
        label: "Provider Circuit Breakers".into(),
        items,
    }
}

#[tauri::command]
pub fn health_check_circuit_breaker(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    Ok(build_circuit_breaker_section(&state))
}

fn build_subscriptions_section(state: &AppState) -> HealthCheckSection {
    let health = state.scheduler.subscription_health();
    let mut items = Vec::new();

    if health.is_empty() {
        items.push(HealthCheckItem {
            id: "subscriptions_empty".into(),
            label: "Subscriptions".into(),
            status: "info".into(),
            detail: Some("Scheduler not started yet -- no subscriptions registered".into()),
            installable: false,
        });
    } else {
        for sub in &health {
            let (status, detail) = if !sub.alive {
                (
                    "error",
                    format!(
                        "Dead -- {} crash(es), last active {}",
                        sub.error_count,
                        sub.last_tick_at.as_deref().unwrap_or("never"),
                    ),
                )
            } else if sub.consecutive_panics > 0 {
                (
                    "warn",
                    format!(
                        "Unstable -- {} consecutive panic(s), {} total crash(es)",
                        sub.consecutive_panics, sub.error_count,
                    ),
                )
            } else if sub.overrun {
                (
                    "warn",
                    format!(
                        "Overrun -- last tick {}ms (interval {}ms)",
                        sub.last_tick_duration_ms, sub.interval_ms,
                    ),
                )
            } else {
                (
                    "ok",
                    format!(
                        "Healthy -- {} ticks, avg {}ms",
                        sub.tick_count, sub.avg_tick_duration_ms,
                    ),
                )
            };

            items.push(HealthCheckItem {
                id: format!("sub_{}", sub.name),
                label: sub.name.replace('_', " "),
                status: status.into(),
                detail: Some(detail),
                installable: false,
            });
        }
    }

    HealthCheckSection {
        id: "subscriptions".into(),
        label: "Subscription Health".into(),
        items,
    }
}

#[tauri::command]
pub fn health_check_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    Ok(build_subscriptions_section(&state))
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), AppError> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(AppError::Validation(
            "Only http/https URLs are allowed".into(),
        ));
    }

    tracing::info!(url = %trimmed, "open_external_url requested");

    open::that(trimmed)
        .map_err(|e| AppError::Internal(format!("Failed to open URL: {e}")))?;

    Ok(())
}

// -- Crash log commands ------------------------------------------

#[tauri::command]
pub fn get_crash_logs(app: tauri::AppHandle) -> Result<Vec<crate::logging::CrashLogEntry>, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    Ok(crate::logging::read_crash_logs(&app_data_dir))
}

#[tauri::command]
pub fn clear_crash_logs(app: tauri::AppHandle) -> Result<(), AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to resolve app data dir: {e}")))?;

    crate::logging::clear_crash_logs(&app_data_dir);
    Ok(())
}

// -- Frontend crash telemetry commands --------------------------------

#[tauri::command]
pub async fn report_frontend_crash(
    state: State<'_, Arc<AppState>>,
    component: String,
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
) -> Result<crate::db::models::FrontendCrashRow, AppError> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    crate::db::repos::core::frontend_crashes::insert(
        &state.db,
        &component,
        &message,
        stack.as_deref(),
        component_stack.as_deref(),
        Some(&version),
    )
}

#[tauri::command]
pub async fn get_frontend_crashes(
    state: State<'_, Arc<AppState>>,
    limit: Option<u32>,
) -> Result<Vec<crate::db::models::FrontendCrashRow>, AppError> {
    crate::db::repos::core::frontend_crashes::list_recent(&state.db, limit.unwrap_or(50))
}

#[tauri::command]
pub async fn clear_frontend_crashes(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    crate::db::repos::core::frontend_crashes::clear_all(&state.db)
}

#[tauri::command]
pub async fn get_frontend_crash_count(
    state: State<'_, Arc<AppState>>,
    hours: Option<u32>,
) -> Result<u32, AppError> {
    crate::db::repos::core::frontend_crashes::count_since(&state.db, hours.unwrap_or(24))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check_item_serialization() {
        let item = HealthCheckItem {
            id: "test".into(),
            label: "Test Check".into(),
            status: "ok".into(),
            detail: Some("v1.0".into()),
            installable: false,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"status\":\"ok\""));
    }

    #[test]
    fn test_health_check_section_serialization() {
        let section = HealthCheckSection {
            id: "local".into(),
            label: "Local Environment".into(),
            items: vec![HealthCheckItem {
                id: "a".into(),
                label: "A".into(),
                status: "ok".into(),
                detail: None,
                installable: false,
            }],
        };
        let json = serde_json::to_string(&section).unwrap();
        assert!(json.contains("\"id\":\"local\""));
    }

    #[test]
    fn test_system_health_report_serialization() {
        let report = SystemHealthReport {
            sections: vec![HealthCheckSection {
                id: "local".into(),
                label: "Local Environment".into(),
                items: vec![
                    HealthCheckItem {
                        id: "a".into(),
                        label: "A".into(),
                        status: "ok".into(),
                        detail: None,
                        installable: false,
                    },
                    HealthCheckItem {
                        id: "b".into(),
                        label: "B".into(),
                        status: "error".into(),
                        detail: Some("fail".into()),
                        installable: true,
                    },
                ],
            }],
            all_ok: false,
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"all_ok\":false"));
        assert!(json.contains("\"sections\""));
    }
}
