use rusqlite::params;

use crate::db::models::webhook_log::{CreateWebhookRequestLogInput, WebhookRequestLog};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_log -> WebhookRequestLog {
    id, trigger_id, method, headers, body,
    status_code, response_body, event_id,
    error_message, received_at,
});

crud_get_by_id!(WebhookRequestLog, "webhook_request_log", "WebhookRequestLog", row_to_log);

/// List the most recent webhook request logs for a trigger (newest first, max 100).
pub fn list_by_trigger(pool: &DbPool, trigger_id: &str) -> Result<Vec<WebhookRequestLog>, AppError> {
    timed_query!("webhook_log", "webhook_log::list_by_trigger", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM webhook_request_log WHERE trigger_id = ?1 ORDER BY received_at DESC LIMIT 100",
        )?;
        let rows = stmt.query_map(params![trigger_id], row_to_log)?;
        Ok(collect_rows(rows, "webhook_log::list_by_trigger"))

    })
}

/// Insert a new webhook request log entry and enforce the 100-per-trigger cap.
pub fn create(pool: &DbPool, input: CreateWebhookRequestLogInput) -> Result<WebhookRequestLog, AppError> {
    timed_query!("webhook_log", "webhook_log::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        conn.execute(
            "INSERT INTO webhook_request_log (id, trigger_id, method, headers, body, status_code, response_body, event_id, error_message, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                input.trigger_id,
                input.method,
                input.headers,
                input.body,
                input.status_code,
                input.response_body,
                input.event_id,
                input.error_message,
                now,
            ],
        )?;

        // Enforce 100-per-trigger cap: delete oldest entries beyond 100
        conn.execute(
            "DELETE FROM webhook_request_log WHERE trigger_id = ?1 AND id NOT IN (
                SELECT id FROM webhook_request_log WHERE trigger_id = ?1 ORDER BY received_at DESC LIMIT 100
            )",
            params![input.trigger_id],
        )?;

        get_by_id(pool, &id)

    })
}

/// Delete all logs for a trigger.
pub fn delete_by_trigger(pool: &DbPool, trigger_id: &str) -> Result<i64, AppError> {
    timed_query!("webhook_log", "webhook_log::delete_by_trigger", {
        let conn = pool.get()?;
        let deleted = conn.execute(
            "DELETE FROM webhook_request_log WHERE trigger_id = ?1",
            params![trigger_id],
        )?;
        Ok(deleted as i64)

    })
}
