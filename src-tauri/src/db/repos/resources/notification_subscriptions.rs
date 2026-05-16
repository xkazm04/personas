use rusqlite::{params, Row};

use crate::db::models::{
    CreateNotificationSubscriptionInput, NotificationSubscription,
    UpdateNotificationSubscriptionInput,
};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_subscription(row: &Row) -> rusqlite::Result<NotificationSubscription> {
    Ok(NotificationSubscription {
        id: row.get("id")?,
        label: row.get("label")?,
        provider: row.get("provider")?,
        webhook_url: row.get("webhook_url")?,
        credential_id: row.get("credential_id")?,
        event_types: row.get("event_types")?,
        template_body: row.get("template_body")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        last_delivery_at: row.get("last_delivery_at")?,
        last_delivery_status: row.get("last_delivery_status")?,
        last_error: row.get("last_error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_all(pool: &DbPool) -> Result<Vec<NotificationSubscription>, AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::list_all",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM notification_subscriptions ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([], row_to_subscription)?;
            let items = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            Ok(items)
        }
    )
}

pub fn list_enabled(pool: &DbPool) -> Result<Vec<NotificationSubscription>, AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::list_enabled",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM notification_subscriptions WHERE enabled = 1 ORDER BY created_at",
            )?;
            let rows = stmt.query_map([], row_to_subscription)?;
            let items = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            Ok(items)
        }
    )
}

crud_get_by_id!(
    NotificationSubscription,
    "notification_subscriptions",
    "NotificationSubscription",
    row_to_subscription
);

fn validate_provider(provider: &str) -> Result<(), AppError> {
    match provider {
        "slack" | "discord" | "teams" | "generic" => Ok(()),
        other => Err(AppError::Validation(format!(
            "Unknown notification provider '{}': expected slack | discord | teams | generic",
            other
        ))),
    }
}

pub fn create(
    pool: &DbPool,
    input: CreateNotificationSubscriptionInput,
) -> Result<NotificationSubscription, AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::create",
        {
            if input.label.trim().is_empty() {
                return Err(AppError::Validation("Label cannot be empty".into()));
            }
            validate_provider(&input.provider)?;
            if input.webhook_url.is_none() && input.credential_id.is_none() {
                return Err(AppError::Validation(
                    "Subscription needs either an inline webhook_url or a credential_id".into(),
                ));
            }
            if input.event_types.is_empty() {
                return Err(AppError::Validation(
                    "At least one event_type pattern is required".into(),
                ));
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let event_types_json = serde_json::to_string(&input.event_types).map_err(|e| {
                AppError::Validation(format!("event_types not serializable: {}", e))
            })?;
            let enabled = input.enabled.unwrap_or(true);

            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO notification_subscriptions
                 (id, label, provider, webhook_url, credential_id, event_types,
                  template_body, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![
                    id,
                    input.label,
                    input.provider,
                    input.webhook_url,
                    input.credential_id,
                    event_types_json,
                    input.template_body,
                    enabled as i64,
                    now,
                ],
            )?;

            get_by_id(pool, &id)
        }
    )
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateNotificationSubscriptionInput,
) -> Result<NotificationSubscription, AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::update",
        {
            let current = get_by_id(pool, id)?;
            let now = chrono::Utc::now().to_rfc3339();

            let label = input.label.unwrap_or(current.label);
            if label.trim().is_empty() {
                return Err(AppError::Validation("Label cannot be empty".into()));
            }
            let provider = input.provider.unwrap_or(current.provider);
            validate_provider(&provider)?;

            // For optional-clearable fields the contract is:
            //   - Some("") -> clear (None in DB)
            //   - Some(value) -> set
            //   - None -> keep current
            fn merge_clearable(new: Option<String>, current: Option<String>) -> Option<String> {
                match new {
                    Some(v) if v.is_empty() => None,
                    Some(v) => Some(v),
                    None => current,
                }
            }
            let webhook_url = merge_clearable(input.webhook_url, current.webhook_url);
            let credential_id = merge_clearable(input.credential_id, current.credential_id);
            let template_body = merge_clearable(input.template_body, current.template_body);

            if webhook_url.is_none() && credential_id.is_none() {
                return Err(AppError::Validation(
                    "Subscription needs either a webhook_url or credential_id".into(),
                ));
            }

            let event_types_json = match input.event_types {
                Some(v) => {
                    if v.is_empty() {
                        return Err(AppError::Validation(
                            "At least one event_type pattern is required".into(),
                        ));
                    }
                    serde_json::to_string(&v).map_err(|e| {
                        AppError::Validation(format!("event_types not serializable: {}", e))
                    })?
                }
                None => current.event_types,
            };

            let enabled = input.enabled.unwrap_or(current.enabled);

            let conn = pool.get()?;
            conn.execute(
                "UPDATE notification_subscriptions
                 SET label = ?2, provider = ?3, webhook_url = ?4, credential_id = ?5,
                     event_types = ?6, template_body = ?7, enabled = ?8, updated_at = ?9
                 WHERE id = ?1",
                params![
                    id,
                    label,
                    provider,
                    webhook_url,
                    credential_id,
                    event_types_json,
                    template_body,
                    enabled as i64,
                    now,
                ],
            )?;

            get_by_id(pool, id)
        }
    )
}

pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::delete",
        {
            let conn = pool.get()?;
            let deleted = conn.execute(
                "DELETE FROM notification_subscriptions WHERE id = ?1",
                params![id],
            )?;
            if deleted == 0 {
                return Err(AppError::NotFound(format!(
                    "NotificationSubscription not found: {}",
                    id
                )));
            }
            Ok(())
        }
    )
}

pub fn record_delivery(
    pool: &DbPool,
    id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::record_delivery",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
                "UPDATE notification_subscriptions
                 SET last_delivery_at = ?2, last_delivery_status = ?3, last_error = ?4,
                     updated_at = ?2
                 WHERE id = ?1",
                params![id, now, status, error],
            )?;
            Ok(())
        }
    )
}

// --- Dispatch watermark (single-row table) -------------------------------

pub fn get_watermark(pool: &DbPool) -> Result<Option<String>, AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::get_watermark",
        {
            let conn = pool.get()?;
            let result: rusqlite::Result<String> = conn.query_row(
                "SELECT last_event_at FROM notification_dispatch_watermark WHERE id = 1",
                [],
                |row| row.get(0),
            );
            match result {
                Ok(s) => Ok(Some(s)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(AppError::Database(e)),
            }
        }
    )
}

pub fn set_watermark(pool: &DbPool, last_event_at: &str) -> Result<(), AppError> {
    timed_query!(
        "notification_subscriptions",
        "notification_subscriptions::set_watermark",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO notification_dispatch_watermark (id, last_event_at, updated_at)
                 VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET last_event_at = ?1, updated_at = ?2",
                params![last_event_at, now],
            )?;
            Ok(())
        }
    )
}
