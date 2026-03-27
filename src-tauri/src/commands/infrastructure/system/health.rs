use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::settings_keys;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::binary_probe::BinaryProbeCache;
use super::mcp_integration::is_personas_mcp_registered;

// =============================================================================
// Health Check Types
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum HealthCheckStatus {
    Ok,
    Warn,
    Error,
    Inactive,
    Info,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct HealthCheckItem {
    pub id: String,
    pub label: String,
    pub status: HealthCheckStatus,
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

// =============================================================================
// Full Health Check Command
// =============================================================================

#[tauri::command]
pub async fn system_health_check(
    state: State<'_, Arc<AppState>>,
) -> Result<SystemHealthReport, AppError> {
    require_auth_sync(&state)?;
    let mut sections = Vec::new();

    // -- Section 1: Local Environment --
    let active_engine = crate::db::repos::core::settings::get(&state.db, settings_keys::CLI_ENGINE)
        .ok()
        .flatten()
        .unwrap_or_else(|| "claude_code".to_string());

    let local_section = build_local_section(&active_engine, state.scheduler.is_running(), &state.binary_probe_cache);
    sections.push(local_section);

    // -- Section 2: Agents --
    sections.push(build_agents_section(&state.db));

    // -- Section 3: Cloud Deployment --
    let cloud_connected = state.cloud_client.lock().await.is_some();
    sections.push(build_cloud_section(cloud_connected));

    // -- Section 4: Account --
    let auth = state.auth.lock().await;
    let auth_resp = auth.to_response();
    drop(auth);
    sections.push(build_account_section(&auth_resp));

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
            (HealthCheckStatus::Warn, format!("{crash_count_24h} crash(es) in the last 24h ({crash_count_7d} in 7d)"))
        } else if crash_count_24h > 0 {
            (HealthCheckStatus::Info, format!("{crash_count_24h} crash(es) in the last 24h ({crash_count_7d} in 7d)"))
        } else {
            (HealthCheckStatus::Ok, format!("No recent crashes (past 24h), {crash_count_7d} in last 7d"))
        };

        sections.push(HealthCheckSection {
            id: "frontend_stability".into(),
            label: "Frontend Stability".into(),
            items: vec![HealthCheckItem {
                id: "frontend_crashes".into(),
                label: "React Crashes".into(),
                status: fe_status,
                detail: Some(fe_detail),
                installable: false,
            }],
        });
    }

    let all_ok = sections.iter().all(|s| {
        s.items
            .iter()
            .all(|c| matches!(c.status, HealthCheckStatus::Ok | HealthCheckStatus::Info | HealthCheckStatus::Inactive))
    });

    Ok(SystemHealthReport { sections, all_ok })
}

// =============================================================================
// Per-Section Health Check Commands (cascade loading)
// =============================================================================

#[tauri::command]
pub async fn health_check_local(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    require_auth_sync(&state)?;
    let active_engine = crate::db::repos::core::settings::get(&state.db, settings_keys::CLI_ENGINE)
        .ok()
        .flatten()
        .unwrap_or_else(|| "claude_code".to_string());

    Ok(build_local_section(&active_engine, state.scheduler.is_running(), &state.binary_probe_cache))
}

#[tauri::command]
pub async fn health_check_agents(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    require_auth_sync(&state)?;
    Ok(build_agents_section(&state.db))
}

#[tauri::command]
pub async fn health_check_cloud(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    require_auth_sync(&state)?;
    let cloud_connected = state.cloud_client.lock().await.is_some();
    Ok(build_cloud_section(cloud_connected))
}

#[tauri::command]
pub async fn health_check_account(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    require_auth_sync(&state)?;
    let auth = state.auth.lock().await;
    let auth_resp = auth.to_response();
    drop(auth);
    Ok(build_account_section(&auth_resp))
}

#[tauri::command]
pub fn health_check_circuit_breaker(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    require_auth_sync(&state)?;
    Ok(build_circuit_breaker_section(&state))
}

#[tauri::command]
pub fn health_check_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<HealthCheckSection, AppError> {
    require_auth_sync(&state)?;
    Ok(build_subscriptions_section(&state))
}

// =============================================================================
// Section Builders
// =============================================================================

struct EngineProbe {
    id: &'static str,
    label: &'static str,
    setting_key: &'static str,
    candidates: &'static [&'static str],
}

fn build_local_section(active_engine: &str, sched_running: bool, cache: &BinaryProbeCache) -> HealthCheckSection {
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
            let probe = cache.get_or_probe(candidate);
            if probe.exists_in_path {
                detected_in_path = true;
            }
            if let Some(version) = probe.version {
                version_result = Some(((*candidate).to_string(), version));
                break;
            }
        }

        if let Some((command_name, version)) = version_result {
            local_items.push(HealthCheckItem {
                id: engine.id.into(),
                label: format!("{}{}", engine.label, suffix),
                status: HealthCheckStatus::Ok,
                detail: Some(format!("{version} ({command_name})")),
                installable: false,
            });
        } else if detected_in_path {
            local_items.push(HealthCheckItem {
                id: engine.id.into(),
                label: format!("{}{}", engine.label, suffix),
                status: if is_active { HealthCheckStatus::Warn } else { HealthCheckStatus::Inactive },
                detail: Some(
                    "CLI executable detected in PATH, but version probe failed. Try opening a new terminal session or reinstalling.".into(),
                ),
                installable: true,
            });
        } else {
            local_items.push(HealthCheckItem {
                id: engine.id.into(),
                label: format!("{}{}", engine.label, suffix),
                status: if is_active { HealthCheckStatus::Error } else { HealthCheckStatus::Inactive },
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
        let probe = cache.get_or_probe(candidate);
        if let Some(version) = probe.version {
            node_ok = Some((candidate.to_string(), version));
            break;
        }
    }

    if let Some((command_name, version)) = node_ok {
        local_items.push(HealthCheckItem {
            id: "node".into(),
            label: "Node.js".into(),
            status: HealthCheckStatus::Ok,
            detail: Some(format!("{version} ({command_name})")),
            installable: false,
        });
    } else {
        local_items.push(HealthCheckItem {
            id: "node".into(),
            label: "Node.js".into(),
            status: HealthCheckStatus::Warn,
            detail: Some(
                "Not found -- required for Claude CLI. Click Install to set up automatically."
                    .into(),
            ),
            installable: true,
        });
    }

    // Claude Desktop MCP integration check
    let mcp_registered = is_personas_mcp_registered();
    local_items.push(HealthCheckItem {
        id: "claude_desktop_mcp".into(),
        label: "Claude Desktop Integration".into(),
        status: if mcp_registered { HealthCheckStatus::Ok } else { HealthCheckStatus::Inactive },
        detail: Some(if mcp_registered {
            "Personas MCP server registered in Claude Desktop".into()
        } else {
            "Not connected -- click Connect to enable Personas tools in Claude Desktop".into()
        }),
        installable: false,
    });

    local_items.push(HealthCheckItem {
        id: "scheduler".into(),
        label: "Event Bus".into(),
        status: if sched_running { HealthCheckStatus::Ok } else { HealthCheckStatus::Warn },
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

fn build_agents_section(db: &crate::db::DbPool) -> HealthCheckSection {
    let mut agent_items = Vec::new();

    let ollama_key_configured = crate::db::repos::core::settings::get(db, settings_keys::OLLAMA_API_KEY)
        .ok()
        .flatten()
        .is_some_and(|k| !k.is_empty());

    agent_items.push(HealthCheckItem {
        id: "ollama_api_key".into(),
        label: "Ollama Cloud API Key".into(),
        status: if ollama_key_configured { HealthCheckStatus::Ok } else { HealthCheckStatus::Inactive },
        detail: Some(if ollama_key_configured {
            "Configured -- free Ollama Cloud models available for all agents".into()
        } else {
            "Not configured (optional) -- add a free API key to unlock Ollama Cloud models like Qwen3 Coder, GLM-5, and Kimi K2.5".into()
        }),
        installable: false,
    });

    let litellm_url_configured = crate::db::repos::core::settings::get(db, settings_keys::LITELLM_BASE_URL)
        .ok()
        .flatten()
        .is_some_and(|u| !u.is_empty());
    let litellm_key_configured = crate::db::repos::core::settings::get(db, settings_keys::LITELLM_MASTER_KEY)
        .ok()
        .flatten()
        .is_some_and(|k| !k.is_empty());
    let litellm_configured = litellm_url_configured && litellm_key_configured;

    agent_items.push(HealthCheckItem {
        id: "litellm_proxy".into(),
        label: "LiteLLM Proxy".into(),
        status: if litellm_configured { HealthCheckStatus::Ok } else { HealthCheckStatus::Inactive },
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

    HealthCheckSection {
        id: "agents".into(),
        label: "Agents".into(),
        items: agent_items,
    }
}

fn build_cloud_section(cloud_connected: bool) -> HealthCheckSection {
    HealthCheckSection {
        id: "cloud".into(),
        label: "Cloud Deployment".into(),
        items: vec![HealthCheckItem {
            id: "cloud_orchestrator".into(),
            label: "Cloud Orchestrator".into(),
            status: if cloud_connected { HealthCheckStatus::Ok } else { HealthCheckStatus::Info },
            detail: Some(if cloud_connected {
                "Connected -- agents can run when this device is off".into()
            } else {
                "Not deployed -- agents only run while this app is open".into()
            }),
            installable: false,
        }],
    }
}

fn build_account_section(auth_resp: &super::super::auth::AuthStateResponse) -> HealthCheckSection {
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
            status: if auth_resp.is_offline { HealthCheckStatus::Warn } else { HealthCheckStatus::Ok },
            detail: Some(user_detail),
            installable: false,
        });
    } else {
        auth_items.push(HealthCheckItem {
            id: "google_auth".into(),
            label: "Google Account".into(),
            status: HealthCheckStatus::Inactive,
            detail: Some("Not signed in -- optional, enables sync and extended features".into()),
            installable: false,
        });
    }

    HealthCheckSection {
        id: "account".into(),
        label: "Account".into(),
        items: auth_items,
    }
}

fn build_circuit_breaker_section(state: &AppState) -> HealthCheckSection {
    let cb_status = state.engine.circuit_breaker.get_status();
    let mut items = Vec::new();

    for p in &cb_status.providers {
        let (status, detail) = if p.is_open {
            (
                HealthCheckStatus::Error,
                format!(
                    "Circuit OPEN — {} consecutive failures, cooldown {:.0}s remaining",
                    p.consecutive_failures, p.cooldown_remaining_secs,
                ),
            )
        } else if p.consecutive_failures > 0 {
            (
                HealthCheckStatus::Warn,
                format!("{} consecutive failure{}", p.consecutive_failures, if p.consecutive_failures > 1 { "s" } else { "" }),
            )
        } else {
            (HealthCheckStatus::Ok, "Healthy — no recent failures".into())
        };

        items.push(HealthCheckItem {
            id: format!("cb_{}", p.provider),
            label: format!("{} Circuit", p.provider),
            status,
            detail: Some(detail),
            installable: false,
        });
    }

    // Global breaker item
    let (global_status, global_detail) = if cb_status.global_paused {
        (
            HealthCheckStatus::Error,
            format!(
                "ALL PROVIDERS PAUSED — {} failures in rolling window, resumes in {:.0}s",
                cb_status.global_failure_count, cb_status.global_cooldown_remaining_secs,
            ),
        )
    } else if cb_status.global_failure_count > 0 {
        (
            HealthCheckStatus::Warn,
            format!(
                "{} failure{} in rolling window (threshold: 10)",
                cb_status.global_failure_count,
                if cb_status.global_failure_count > 1 { "s" } else { "" },
            ),
        )
    } else {
        (HealthCheckStatus::Ok, "No failures in rolling window".into())
    };

    items.push(HealthCheckItem {
        id: "cb_global".into(),
        label: "Global Breaker".into(),
        status: global_status,
        detail: Some(global_detail),
        installable: false,
    });

    HealthCheckSection {
        id: "circuit_breaker".into(),
        label: "Provider Circuit Breakers".into(),
        items,
    }
}

fn build_subscriptions_section(state: &AppState) -> HealthCheckSection {
    let health = state.scheduler.subscription_health();
    let mut items = Vec::new();

    if health.is_empty() {
        items.push(HealthCheckItem {
            id: "subscriptions_empty".into(),
            label: "Subscriptions".into(),
            status: HealthCheckStatus::Info,
            detail: Some("Scheduler not started yet -- no subscriptions registered".into()),
            installable: false,
        });
    } else {
        for sub in &health {
            let (status, detail) = if !sub.alive {
                (
                    HealthCheckStatus::Error,
                    format!(
                        "Dead -- {} crash(es), last active {}",
                        sub.error_count,
                        sub.last_tick_at.as_deref().unwrap_or("never"),
                    ),
                )
            } else if sub.consecutive_panics > 0 {
                (
                    HealthCheckStatus::Warn,
                    format!(
                        "Unstable -- {} consecutive panic(s), {} total crash(es)",
                        sub.consecutive_panics, sub.error_count,
                    ),
                )
            } else if sub.overrun {
                (
                    HealthCheckStatus::Warn,
                    format!(
                        "Overrun -- last tick {}ms (interval {}ms)",
                        sub.last_tick_duration_ms, sub.interval_ms,
                    ),
                )
            } else {
                (
                    HealthCheckStatus::Ok,
                    format!(
                        "Healthy -- {} ticks, avg {}ms",
                        sub.tick_count, sub.avg_tick_duration_ms,
                    ),
                )
            };

            items.push(HealthCheckItem {
                id: format!("sub_{}", sub.name),
                label: sub.name.replace('_', " "),
                status,
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

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check_item_serialization() {
        let item = HealthCheckItem {
            id: "test".into(),
            label: "Test Check".into(),
            status: HealthCheckStatus::Ok,
            detail: Some("v1.0".into()),
            installable: false,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"status\":\"ok\""));
    }

    #[test]
    fn test_health_check_status_variants() {
        assert_eq!(serde_json::to_string(&HealthCheckStatus::Ok).unwrap(), "\"ok\"");
        assert_eq!(serde_json::to_string(&HealthCheckStatus::Warn).unwrap(), "\"warn\"");
        assert_eq!(serde_json::to_string(&HealthCheckStatus::Error).unwrap(), "\"error\"");
        assert_eq!(serde_json::to_string(&HealthCheckStatus::Inactive).unwrap(), "\"inactive\"");
        assert_eq!(serde_json::to_string(&HealthCheckStatus::Info).unwrap(), "\"info\"");
    }

    #[test]
    fn test_health_check_section_serialization() {
        let section = HealthCheckSection {
            id: "local".into(),
            label: "Local Environment".into(),
            items: vec![HealthCheckItem {
                id: "a".into(),
                label: "A".into(),
                status: HealthCheckStatus::Ok,
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
                        status: HealthCheckStatus::Ok,
                        detail: None,
                        installable: false,
                    },
                    HealthCheckItem {
                        id: "b".into(),
                        label: "B".into(),
                        status: HealthCheckStatus::Error,
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
