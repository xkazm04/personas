use serde::Serialize;
use ts_rs::TS;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct HealthCheckItem {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SystemHealthReport {
    pub checks: Vec<HealthCheckItem>,
    pub all_ok: bool,
}

#[tauri::command]
pub async fn system_health_check() -> Result<SystemHealthReport, AppError> {
    let mut checks = Vec::new();

    // Check 1: Claude CLI in PATH
    match std::process::Command::new("claude").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("unknown")
                .trim()
                .to_string();
            checks.push(HealthCheckItem {
                id: "claude_cli".into(),
                label: "Claude CLI".into(),
                status: "ok".into(),
                detail: Some(version),
            });
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            checks.push(HealthCheckItem {
                id: "claude_cli".into(),
                label: "Claude CLI".into(),
                status: "error".into(),
                detail: Some(if stderr.is_empty() {
                    "Command failed with no error output".into()
                } else {
                    stderr
                }),
            });
        }
        Err(e) => {
            checks.push(HealthCheckItem {
                id: "claude_cli".into(),
                label: "Claude CLI".into(),
                status: "error".into(),
                detail: Some(format!("Not found in PATH: {e}")),
            });
        }
    }

    // Check 2: Node.js available (for sidecars)
    match std::process::Command::new("node").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            checks.push(HealthCheckItem {
                id: "node".into(),
                label: "Node.js".into(),
                status: "ok".into(),
                detail: Some(version),
            });
        }
        _ => {
            checks.push(HealthCheckItem {
                id: "node".into(),
                label: "Node.js".into(),
                status: "warn".into(),
                detail: Some("Not found — optional, needed for some tool scripts".into()),
            });
        }
    }

    let all_ok = checks.iter().all(|c| c.status == "ok");
    Ok(SystemHealthReport { checks, all_ok })
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
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"status\":\"ok\""));
    }

    #[test]
    fn test_system_health_report_serialization() {
        let report = SystemHealthReport {
            checks: vec![
                HealthCheckItem {
                    id: "a".into(),
                    label: "A".into(),
                    status: "ok".into(),
                    detail: None,
                },
                HealthCheckItem {
                    id: "b".into(),
                    label: "B".into(),
                    status: "error".into(),
                    detail: Some("fail".into()),
                },
            ],
            all_ok: false,
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"all_ok\":false"));
    }
}
