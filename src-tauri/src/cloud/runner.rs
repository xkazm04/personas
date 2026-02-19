use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use super::client::CloudClient;

/// Result of a cloud execution polling loop.
#[derive(Debug)]
pub struct CloudRunResult {
    pub success: bool,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub cost_usd: Option<f64>,
}

/// Poll the cloud orchestrator for execution output and emit Tauri events.
///
/// This function mirrors the local runner's event contract: it emits
/// `execution-output` for each new output line and `execution-status`
/// on terminal state. The frontend streaming hooks are 100% mode-agnostic.
pub async fn run_cloud_execution(
    app: AppHandle,
    client: Arc<CloudClient>,
    local_execution_id: String,
    cloud_execution_id: String,
    cancelled: Arc<AtomicBool>,
) -> CloudRunResult {
    let mut offset: u32 = 0;
    let poll_interval = std::time::Duration::from_millis(800);
    let max_polls = 7500; // ~100 minutes max

    for _ in 0..max_polls {
        if cancelled.load(Ordering::Acquire) {
            return CloudRunResult {
                success: false,
                error: Some("Cancelled".into()),
                duration_ms: 0,
                cost_usd: None,
            };
        }

        tokio::time::sleep(poll_interval).await;

        let poll = match client.poll_execution(&cloud_execution_id, offset).await {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(
                    execution_id = %local_execution_id,
                    "Cloud poll error: {}", e
                );
                // Transient error — retry on next poll
                continue;
            }
        };

        // Emit new output lines
        let new_lines = &poll.output[offset as usize..];
        for line in new_lines {
            let _ = app.emit(
                "execution-output",
                serde_json::json!({
                    "execution_id": local_execution_id,
                    "line": line,
                }),
            );
        }
        offset = poll.output_lines;

        // Check terminal status
        match poll.status.as_str() {
            "completed" => {
                let _ = app.emit(
                    "execution-status",
                    serde_json::json!({
                        "execution_id": local_execution_id,
                        "status": "completed",
                    }),
                );
                return CloudRunResult {
                    success: true,
                    error: None,
                    duration_ms: poll.duration_ms.unwrap_or(0),
                    cost_usd: poll.cost_usd,
                };
            }
            "failed" | "cancelled" | "error" => {
                let _ = app.emit(
                    "execution-status",
                    serde_json::json!({
                        "execution_id": local_execution_id,
                        "status": poll.status,
                    }),
                );
                return CloudRunResult {
                    success: false,
                    error: Some(format!("Cloud execution {}", poll.status)),
                    duration_ms: poll.duration_ms.unwrap_or(0),
                    cost_usd: poll.cost_usd,
                };
            }
            _ => {
                // Still running — continue polling
            }
        }
    }

    // Timed out waiting for cloud execution
    let _ = app.emit(
        "execution-status",
        serde_json::json!({
            "execution_id": local_execution_id,
            "status": "failed",
        }),
    );
    CloudRunResult {
        success: false,
        error: Some("Cloud execution timed out after polling limit".into()),
        duration_ms: 0,
        cost_usd: None,
    }
}
