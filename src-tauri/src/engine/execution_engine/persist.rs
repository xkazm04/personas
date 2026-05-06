use tauri::{AppHandle, Emitter};

use crate::db::models::UpdateExecutionStatus;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::DbPool;

use super::super::event_registry::event_name;
use super::super::types::{ExecutionState, HealingEventPayload};

/// Maximum retry attempts for DB status persistence.
const PERSIST_MAX_RETRIES: u32 = 3;
/// Initial backoff delay (doubles each retry: 200ms -> 400ms -> 800ms).
const PERSIST_INITIAL_BACKOFF_MS: u64 = 200;

/// Try to write an execution status update to the DB with exponential backoff.
///
/// On each failure, waits with `tokio::time::sleep` (non-blocking) and retries.
/// After `PERSIST_MAX_RETRIES` failures, force-marks the execution as error
/// (dead-letter) so it doesn't stay stuck in "running" forever, and emits a
/// healing event so the user knows the original result was lost.
pub(crate) async fn persist_status_update(
    pool: &DbPool,
    app: Option<&AppHandle>,
    exec_id: &str,
    update: UpdateExecutionStatus,
) {
    let mut last_err = None;
    let mut backoff_ms = PERSIST_INITIAL_BACKOFF_MS;

    for attempt in 0..=PERSIST_MAX_RETRIES {
        match exec_repo::update_status(pool, exec_id, update.clone()) {
            Ok(()) => return,
            Err(e) => {
                tracing::error!(
                    execution_id = %exec_id,
                    attempt = attempt + 1,
                    max_attempts = PERSIST_MAX_RETRIES + 1,
                    error = %e,
                    "DB status update failed",
                );
                last_err = Some(e);

                if attempt < PERSIST_MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                    backoff_ms *= 2;
                }
            }
        }
    }

    let err_msg = last_err
        .as_ref()
        .map(|e| {
            format!(
                "Status persist failed after {} retries: {}",
                PERSIST_MAX_RETRIES + 1,
                e
            )
        })
        .unwrap_or_else(|| "Status persist failed".into());

    if !matches!(update.status, ExecutionState::Failed) {
        let dead_letter = exec_repo::update_status(
            pool,
            exec_id,
            UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some(err_msg.clone()),
                duration_ms: update.duration_ms,
                input_tokens: update.input_tokens,
                output_tokens: update.output_tokens,
                cost_usd: update.cost_usd,
                ..Default::default()
            },
        );
        if let Err(e) = dead_letter {
            tracing::error!(
                execution_id = %exec_id,
                error = %e,
                "Dead-letter write also failed -- execution stuck in running state",
            );
        }
    }

    if let Some(app) = app {
        let _ = app.emit(
            event_name::HEALING_EVENT,
            HealingEventPayload {
                issue_id: String::new(),
                persona_id: String::new(),
                execution_id: exec_id.into(),
                title: "Execution result lost: DB write failed".into(),
                action: "issue_created".into(),
                auto_fixed: false,
                severity: "critical".into(),
                suggested_fix: Some(err_msg),
                persona_name: String::new(),
                description: None,
                strategy: None,
                backoff_seconds: None,
                retry_number: None,
                max_retries: None,
            },
        );
    }
}

/// Conditional safety-net persist: only writes if the DB status is still `running`.
pub(crate) async fn persist_status_if_running(
    pool: &DbPool,
    exec_id: &str,
    update: UpdateExecutionStatus,
) -> bool {
    let mut backoff_ms = PERSIST_INITIAL_BACKOFF_MS;

    for attempt in 0..=PERSIST_MAX_RETRIES {
        match exec_repo::update_status_if_running(pool, exec_id, update.clone()) {
            Ok(applied) => return applied,
            Err(e) => {
                tracing::error!(
                    execution_id = %exec_id,
                    attempt = attempt + 1,
                    error = %e,
                    "Conditional DB status update failed",
                );
                if attempt < PERSIST_MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                    backoff_ms *= 2;
                }
            }
        }
    }
    false
}

/// Conditional persist for the spawned task's final write: only writes if the
/// DB status is `running` or `cancelled` (bare safety-net cancel).
pub(crate) async fn persist_status_if_not_final(
    pool: &DbPool,
    app: Option<&AppHandle>,
    exec_id: &str,
    update: UpdateExecutionStatus,
) {
    let mut last_err = None;
    let mut backoff_ms = PERSIST_INITIAL_BACKOFF_MS;

    for attempt in 0..=PERSIST_MAX_RETRIES {
        match exec_repo::update_status_if_not_final(pool, exec_id, update.clone()) {
            Ok(applied) => {
                if !applied {
                    tracing::info!(
                        execution_id = %exec_id,
                        attempted_status = %update.status,
                        "Final status write skipped: execution already in terminal state",
                    );
                }
                return;
            }
            Err(e) => {
                tracing::error!(
                    execution_id = %exec_id,
                    attempt = attempt + 1,
                    max_attempts = PERSIST_MAX_RETRIES + 1,
                    error = %e,
                    "Conditional final status update failed",
                );
                last_err = Some(e);

                if attempt < PERSIST_MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                    backoff_ms *= 2;
                }
            }
        }
    }

    let err_msg = last_err
        .as_ref()
        .map(|e| {
            format!(
                "Conditional status persist failed after {} retries: {}",
                PERSIST_MAX_RETRIES + 1,
                e
            )
        })
        .unwrap_or_else(|| "Conditional status persist failed".into());

    if !matches!(update.status, ExecutionState::Failed) {
        let _ = exec_repo::update_status(
            pool,
            exec_id,
            UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some(err_msg.clone()),
                duration_ms: update.duration_ms,
                input_tokens: update.input_tokens,
                output_tokens: update.output_tokens,
                cost_usd: update.cost_usd,
                ..Default::default()
            },
        );
    }

    if let Some(app) = app {
        let _ = app.emit(
            event_name::HEALING_EVENT,
            HealingEventPayload {
                issue_id: String::new(),
                persona_id: String::new(),
                execution_id: exec_id.into(),
                title: "Execution result lost: conditional DB write failed".into(),
                action: "issue_created".into(),
                auto_fixed: false,
                severity: "critical".into(),
                suggested_fix: Some(err_msg),
                persona_name: String::new(),
                description: None,
                strategy: None,
                backoff_seconds: None,
                retry_number: None,
                max_retries: None,
            },
        );
    }
}
