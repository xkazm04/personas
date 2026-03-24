use rusqlite::params;
use uuid::Uuid;

use crate::db::models::{
    CreateSharedEventSubscriptionInput, SharedEventCatalogEntry, SharedEventSubscription,
};
use crate::db::DbPool;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

row_mapper!(row_to_catalog -> SharedEventCatalogEntry {
    id, slug, name, description, category, publisher, icon, color,
    sample_payload, event_schema, subscriber_count,
    is_featured [bool],
    status, cloud_updated_at, cached_at,
});

row_mapper!(row_to_subscription -> SharedEventSubscription {
    id, catalog_entry_id, slug,
    enabled [bool],
    last_cursor, events_relayed, last_event_at, error,
    created_at, updated_at,
});

// ---------------------------------------------------------------------------
// Catalog operations
// ---------------------------------------------------------------------------

pub fn list_catalog(
    pool: &DbPool,
    category: Option<&str>,
    search: Option<&str>,
) -> Result<Vec<SharedEventCatalogEntry>, AppError> {
    let conn = pool.get()?;
    let mut sql = String::from(
        "SELECT * FROM shared_event_catalog WHERE status = 'active'",
    );
    let mut param_values: Vec<String> = Vec::new();

    if let Some(cat) = category {
        sql.push_str(&format!(" AND category = ?{}", param_values.len() + 1));
        param_values.push(cat.to_string());
    }
    if let Some(q) = search {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(
            " AND (name LIKE ?{idx} OR slug LIKE ?{idx} OR description LIKE ?{idx})"
        ));
        param_values.push(format!("%{q}%"));
    }

    sql.push_str(" ORDER BY is_featured DESC, subscriber_count DESC, name ASC");

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params_refs.as_slice(), row_to_catalog)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn upsert_catalog_batch(
    pool: &DbPool,
    entries: &[SharedEventCatalogEntry],
) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut count = 0;
    for e in entries {
        conn.execute(
            "INSERT INTO shared_event_catalog
             (id, slug, name, description, category, publisher, icon, color,
              sample_payload, event_schema, subscriber_count, is_featured, status,
              cloud_updated_at, cached_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, description=excluded.description,
               category=excluded.category, publisher=excluded.publisher,
               icon=excluded.icon, color=excluded.color,
               sample_payload=excluded.sample_payload, event_schema=excluded.event_schema,
               subscriber_count=excluded.subscriber_count, is_featured=excluded.is_featured,
               status=excluded.status, cloud_updated_at=excluded.cloud_updated_at,
               cached_at=excluded.cached_at",
            params![
                e.id, e.slug, e.name, e.description, e.category, e.publisher,
                e.icon, e.color, e.sample_payload, e.event_schema,
                e.subscriber_count, e.is_featured as i32, e.status,
                e.cloud_updated_at, now,
            ],
        )?;
        count += 1;
    }
    Ok(count)
}

pub fn get_catalog_entry(pool: &DbPool, id: &str) -> Result<SharedEventCatalogEntry, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM shared_event_catalog WHERE id = ?1",
        params![id],
        row_to_catalog,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Catalog entry {id} not found"))
        }
        e => AppError::Database(e),
    })
}

// ---------------------------------------------------------------------------
// Subscription operations
// ---------------------------------------------------------------------------

pub fn list_subscriptions(pool: &DbPool) -> Result<Vec<SharedEventSubscription>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM shared_event_subscriptions ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_subscription)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn list_enabled_subscriptions(
    pool: &DbPool,
) -> Result<Vec<SharedEventSubscription>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM shared_event_subscriptions WHERE enabled = 1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_subscription)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn subscribe(
    pool: &DbPool,
    input: CreateSharedEventSubscriptionInput,
) -> Result<SharedEventSubscription, AppError> {
    let catalog = get_catalog_entry(pool, &input.catalog_entry_id)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO shared_event_subscriptions
         (id, catalog_entry_id, slug, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![id, catalog.id, catalog.slug, now],
    )?;
    get_subscription(pool, &id)
}

pub fn unsubscribe(pool: &DbPool, subscription_id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM shared_event_subscriptions WHERE id = ?1",
        params![subscription_id],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!(
            "Subscription {subscription_id} not found"
        )));
    }
    Ok(())
}

pub fn get_subscription(
    pool: &DbPool,
    id: &str,
) -> Result<SharedEventSubscription, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM shared_event_subscriptions WHERE id = ?1",
        params![id],
        row_to_subscription,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Subscription {id} not found"))
        }
        e => AppError::Database(e),
    })
}

pub fn update_cursor(
    pool: &DbPool,
    subscription_id: &str,
    cursor: &str,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shared_event_subscriptions
         SET last_cursor = ?2, events_relayed = events_relayed + 1,
             last_event_at = ?3, error = NULL, updated_at = ?3
         WHERE id = ?1",
        params![subscription_id, cursor, now],
    )?;
    Ok(())
}

pub fn set_error(
    pool: &DbPool,
    subscription_id: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shared_event_subscriptions SET error = ?2, updated_at = ?3 WHERE id = ?1",
        params![subscription_id, error, now],
    )?;
    Ok(())
}

pub fn toggle_enabled(
    pool: &DbPool,
    subscription_id: &str,
    enabled: bool,
) -> Result<SharedEventSubscription, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE shared_event_subscriptions SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
        params![subscription_id, enabled as i32, now],
    )?;
    get_subscription(pool, subscription_id)
}
