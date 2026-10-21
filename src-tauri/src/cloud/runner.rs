use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

use super::client::{is_terminal_execution_status, CloudClient};

/// Result of a cloud execution polling loop.
#[derive(Debug)]
pub struct CloudRunResult {
    pub success: bool,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub cost_usd: Option<f64>,
}

/// Ask the orchestrator to stop a run this desktop is about to stop watching.
/// A run the desktop reports as ended must not keep executing (and billing) in
/// the cloud, so every give-up exit that can still reach the orchestrator goes
/// through here. Failure is logged, not fatal: the verdict is already decided.
async fn cancel_abandoned_run(
    client: &CloudClient,
    local_execution_id: &str,
    cloud_execution_id: &str,
) {
    if let Err(e) = client.cancel_execution(cloud_execution_id).await {
        tracing::warn!(
            execution_id = %local_execution_id,
            cloud_execution_id = %cloud_execution_id,
            error = %e,
            "Failed to cancel cloud execution on orchestrator",
        );
    }
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
    let mut high_water_mark: u32 = 0;
    let base_interval = std::time::Duration::from_millis(800);
    let max_backoff = std::time::Duration::from_secs(30);
    let max_consecutive_errors: u32 = 10;
    let max_polls = 7500; // ~100 minutes max

    let mut consecutive_errors: u32 = 0;

    for _ in 0..max_polls {
        if cancelled.load(Ordering::Acquire) {
            cancel_abandoned_run(&client, &local_execution_id, &cloud_execution_id).await;
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
                        event_name::EXECUTION_STATUS,
                        serde_json::json!({
                            "execution_id": local_execution_id,
                            "status": "failed",
                        }),
                    );
                    return CloudRunResult {
                        success: false,
                        error: Some(format!(
                            "Cloud orchestrator unreachable after {max_consecutive_errors} consecutive poll failures: {e}"
                        )),
                        duration_ms: 0,
                        cost_usd: None,
                    };
                }

                // Notify UI that polling is degraded
                if consecutive_errors == 1 {
                    let _ = app.emit(
                        event_name::EXECUTION_STATUS,
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

        // Emit execution progress if available (stage, tool, percent)
        if let Some(progress) = &poll.progress {
            let _ = app.emit(
                event_name::EXECUTION_PROGRESS,
                serde_json::json!({
                    "execution_id": local_execution_id,
                    "progress": progress,
                }),
            );
        }

        // Emit pending review requests if any
        if let Some(reviews) = &poll.pending_reviews {
            if !reviews.is_empty() {
                let _ = app.emit(
                    event_name::EXECUTION_REVIEW_REQUEST,
                    serde_json::json!({
                        "execution_id": local_execution_id,
                        "reviews": reviews,
                    }),
                );
            }
        }

        // Emit new output lines -- use high_water_mark to avoid re-emitting
        // lines the frontend already received after an orchestrator restart.
        if poll.output_lines < offset {
            tracing::warn!(
                execution_id = %local_execution_id,
                expected_offset = offset,
                actual_lines = poll.output_lines,
                high_water_mark,
                "Cloud orchestrator returned fewer output lines than offset -- possible state reset"
            );
            offset = poll.output_lines;
        }
        let emit_from = offset.max(high_water_mark) as usize;
        let new_lines = poll.output.get(emit_from..).unwrap_or(&[]);
        for line in new_lines {
            let _ = app.emit(
                event_name::EXECUTION_OUTPUT,
                serde_json::json!({
                    "execution_id": local_execution_id,
                    "line": line,
                }),
            );
        }
        offset = poll.output_lines;
        if offset > high_water_mark {
            high_water_mark = offset;
        }

        // Check terminal status
        match poll.status.as_str() {
            "completed" => {
                let _ = app.emit(
                    event_name::EXECUTION_STATUS,
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
            status if is_terminal_execution_status(status) => {
                let _ = app.emit(
                    event_name::EXECUTION_STATUS,
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
                // Still running -- continue polling
            }
        }
    }

    // Timed out waiting for cloud execution: the run is still going on the
    // orchestrator, so stop it before reporting the desktop's verdict.
    cancel_abandoned_run(&client, &local_execution_id, &cloud_execution_id).await;
    let _ = app.emit(
        event_name::EXECUTION_STATUS,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// One-shot HTTP stub: answers the first request with 200 and returns the
    /// request line it saw.
    async fn serve_once() -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let base = format!("http://{}", listener.local_addr().expect("addr"));
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.expect("accept");
            let mut buf = vec![0u8; 4096];
            let n = sock.read(&mut buf).await.expect("read");
            sock.write_all(
                b"HTTP/1.1 200 OK
content-length: 0
connection: close

",
            )
            .await
            .expect("write");
            String::from_utf8_lossy(&buf[..n])
                .lines()
                .next()
                .unwrap_or("")
                .to_string()
        });
        (base, handle)
    }

    #[tokio::test]
    async fn an_abandoned_run_is_cancelled_on_the_orchestrator() {
        let (base, seen) = serve_once().await;
        let client = CloudClient::new(base, "key".into()).expect("client");
        cancel_abandoned_run(&client, "local-1", "cloud-1").await;
        assert_eq!(
            seen.await.expect("server"),
            "POST /api/executions/cloud-1/cancel HTTP/1.1"
        );
    }
}
