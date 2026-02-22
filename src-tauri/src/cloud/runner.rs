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
    let base_interval = std::time::Duration::from_millis(800);
    let max_backoff = std::time::Duration::from_secs(30);
    let max_consecutive_errors: u32 = 10;
    let max_polls = 7500; // ~100 minutes max

    let mut consecutive_errors: u32 = 0;

    for _ in 0..max_polls {
        if cancelled.load(Ordering::Acquire) {
            return CloudRunResult {
                success: false,
                error: Some("Cancelled".into()),
                duration_ms: 0,
                cost_usd: None,
            };
        }

        // Apply exponential backoff when experiencing consecutive errors,
        // otherwise use the normal poll interval.
        let sleep_duration = if consecutive_errors > 0 {
            let backoff = base_interval * 2u32.saturating_pow(consecutive_errors - 1);
            backoff.min(max_backoff)
        } else {
            base_interval
        };
        tokio::time::sleep(sleep_duration).await;

        let poll = match client.poll_execution(&cloud_execution_id, offset).await {
            Ok(p) => {
                if consecutive_errors > 0 {
                    tracing::info!(
                        execution_id = %local_execution_id,
                        previous_errors = consecutive_errors,
                        "Cloud poll recovered after {} consecutive errors", consecutive_errors
                    );
                }
                consecutive_errors = 0;
                p
            }
            Err(e) => {
                consecutive_errors += 1;
                tracing::warn!(
                    execution_id = %local_execution_id,
                    consecutive_errors,
                    "Cloud poll error ({}/{}): {}", consecutive_errors, max_consecutive_errors, e
                );

                if consecutive_errors >= max_consecutive_errors {
                    let _ = app.emit(
                        "execution-status",
                        serde_json::json!({
                            "execution_id": local_execution_id,
                            "status": "failed",
                        }),
                    );
                    return CloudRunResult {
                        success: false,
                        error: Some(format!(
                            "Cloud orchestrator unreachable after {} consecutive poll failures: {}",
                            max_consecutive_errors, e
                        )),
                        duration_ms: 0,
                        cost_usd: None,
                    };
                }

                // Notify UI that polling is degraded
                if consecutive_errors == 1 {
                    let _ = app.emit(
                        "execution-status",
                        serde_json::json!({
                            "execution_id": local_execution_id,
                            "status": "warning",
                            "message": "Cloud orchestrator connection issue, retrying...",
                        }),
                    );
                }

                continue;
            }
        };

        // Emit new output lines — use safe slice to avoid panic if the
        // orchestrator restarted and returned fewer lines than our offset.
        let new_lines = if poll.output_lines < offset {
            tracing::warn!(
                execution_id = %local_execution_id,
                expected_offset = offset,
                actual_lines = poll.output_lines,
                "Cloud orchestrator returned fewer output lines than offset — possible state reset"
            );
            poll.output.as_slice()
        } else {
            poll.output.get(offset as usize..).unwrap_or(&[])
        };
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
