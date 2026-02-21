use std::sync::Arc;

use serde::Serialize;
use tauri::{Manager, State};
use ts_rs::TS;

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
            let version = stdout
                .lines()
                .next()
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
    let mut local_items = Vec::new();

    let claude_candidates: &[&str] = if cfg!(target_os = "windows") {
        &["claude", "claude.cmd", "claude.exe", "claude-code"]
    } else {
        &["claude", "claude-code"]
    };

    let mut claude_errors = Vec::new();
    let mut claude_detected_in_path = false;
    let mut claude_version_result: Option<(String, String)> = None;

    for candidate in claude_candidates {
        if command_exists_in_path(candidate) {
            claude_detected_in_path = true;
        }

        match command_version(candidate) {
            Ok(version) => {
                claude_version_result = Some(((*candidate).to_string(), version));
                break;
            }
            Err(err) => {
                claude_errors.push(format!("{candidate}: {err}"));
            }
        }
    }

    if let Some((command_name, version)) = claude_version_result {
        local_items.push(HealthCheckItem {
            id: "claude_cli".into(),
            label: "Claude CLI".into(),
            status: "ok".into(),
            detail: Some(format!("{version} ({command_name})")),
            installable: false,
        });
    } else if claude_detected_in_path {
        local_items.push(HealthCheckItem {
            id: "claude_cli".into(),
            label: "Claude CLI".into(),
            status: "warn".into(),
            detail: Some(
                "CLI executable detected in PATH, but version probe failed. Try opening a new terminal session or reinstalling Claude Code CLI.".into(),
            ),
            installable: true,
        });
    } else {
        local_items.push(HealthCheckItem {
            id: "claude_cli".into(),
            label: "Claude CLI".into(),
            status: "error".into(),
            detail: Some(if claude_errors.is_empty() {
                "Not found. Click Install to set up automatically.".into()
            } else {
                format!(
                    "Not found. Click Install to set up automatically. Last probe: {}",
                    claude_errors.join(" | ")
                )
            }),
            installable: true,
        });
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
                "Not found — required for Claude CLI. Click Install to set up automatically."
                    .into(),
            ),
            installable: true,
        });
    }

    let sched_running = state.scheduler.is_running();
    local_items.push(HealthCheckItem {
        id: "scheduler".into(),
        label: "Event Bus".into(),
        status: if sched_running { "ok" } else { "warn" }.into(),
        detail: Some(if sched_running {
            "Running — processing events and triggers".into()
        } else {
            "Not started yet".into()
        }),
        installable: false,
    });

    sections.push(HealthCheckSection {
        id: "local".into(),
        label: "Local Environment".into(),
        items: local_items,
    });

    // -- Section 2: Agents --
    let mut agent_items = Vec::new();

    let ollama_key_configured = crate::db::repos::core::settings::get(&state.db, "ollama_api_key")
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
            "Configured — free Ollama Cloud models available for all agents".into()
        } else {
            "Not configured (optional) — add a free API key to unlock Ollama Cloud models like Qwen3 Coder, GLM-5, and Kimi K2.5"
                .into()
        }),
        installable: false,
    });

    let litellm_url_configured = crate::db::repos::core::settings::get(&state.db, "litellm_base_url")
        .ok()
        .flatten()
        .map_or(false, |u| !u.is_empty());
    let litellm_key_configured = crate::db::repos::core::settings::get(&state.db, "litellm_master_key")
        .ok()
        .flatten()
        .map_or(false, |k| !k.is_empty());
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
                "Configured — LiteLLM proxy available for all agents".into()
            } else if litellm_url_configured {
                "Base URL set but master key missing — add master key to complete setup".into()
            } else if litellm_key_configured {
                "Master key set but base URL missing — add proxy URL to complete setup".into()
            } else {
                "Not configured (optional) — add a LiteLLM proxy URL and master key to route agents through your proxy".into()
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
            "Connected — agents can run when this device is off".into()
        } else {
            "Not deployed — agents only run while this app is open".into()
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
                    format!("{} (offline mode)", name)
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
            detail: Some("Not signed in — optional, enables sync and extended features".into()),
            installable: false,
        });
    }

    sections.push(HealthCheckSection {
        id: "account".into(),
        label: "Account".into(),
        items: auth_items,
    });

    let all_ok = sections.iter().all(|s| {
        s.items
            .iter()
            .all(|c| c.status == "ok" || c.status == "info" || c.status == "inactive")
    });

    Ok(SystemHealthReport { sections, all_ok })
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

// ── Crash log commands ──────────────────────────────────────────

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
