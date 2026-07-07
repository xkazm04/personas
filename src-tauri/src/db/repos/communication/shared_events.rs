use rusqlite::params;
use uuid::Uuid;

use crate::db::models::{
    CreateSharedEventSubscriptionInput, SharedEventCatalogEntry, SharedEventChange,
    SharedEventFeedActivity, SharedEventSubscription,
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
    timed_query!("shared_events", "shared_events::list_catalog", {
        let conn = pool.get()?;
        let mut sql = String::from("SELECT * FROM shared_event_catalog WHERE status = 'active'");
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
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values
            .iter()
            .map(|v| v as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = stmt.query_map(params_refs.as_slice(), row_to_catalog)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

pub fn upsert_catalog_batch(
    pool: &DbPool,
    entries: &[SharedEventCatalogEntry],
) -> Result<usize, AppError> {
    timed_query!("shared_events", "shared_events::upsert_catalog_batch", {
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
                    e.id,
                    e.slug,
                    e.name,
                    e.description,
                    e.category,
                    e.publisher,
                    e.icon,
                    e.color,
                    e.sample_payload,
                    e.event_schema,
                    e.subscriber_count,
                    e.is_featured as i32,
                    e.status,
                    e.cloud_updated_at,
                    now,
                ],
            )?;
            count += 1;
        }
        Ok(count)
    })
}

pub fn get_catalog_entry(pool: &DbPool, id: &str) -> Result<SharedEventCatalogEntry, AppError> {
    timed_query!("shared_events", "shared_events::get_catalog_entry", {
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
    })
}

// ---------------------------------------------------------------------------
// Baked firing operations (local-first curated connector-API-change events)
// ---------------------------------------------------------------------------

fn row_to_firing(row: &rusqlite::Row) -> rusqlite::Result<SharedEventChange> {
    Ok(SharedEventChange {
        id: row.get("id")?,
        slug: row.get("slug")?,
        seq: row.get("seq")?,
        title: row.get("title")?,
        fired_at: row.get("fired_at")?,
        payload: row.get("payload")?,
        release_version: row.get("release_version")?,
    })
}

/// The highest firing `seq` currently baked for a slug (0 when none). Used to
/// set a new subscription's cursor so only *future-release* firings are
/// delivered (no historical backfill flood).
pub fn max_firing_seq(pool: &DbPool, slug: &str) -> Result<i64, AppError> {
    timed_query!("shared_events", "shared_events::max_firing_seq", {
        let conn = pool.get()?;
        let max: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) FROM shared_event_firings WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        Ok(max)
    })
}

/// Baked firings for a slug with `seq` strictly greater than `after_seq`,
/// oldest first — the delivery queue for the local relay.
pub fn list_firings_after(
    pool: &DbPool,
    slug: &str,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<SharedEventChange>, AppError> {
    timed_query!("shared_events", "shared_events::list_firings_after", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, slug, seq, title, fired_at, payload, release_version
             FROM shared_event_firings
             WHERE slug = ?1 AND seq > ?2
             ORDER BY seq ASC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![slug, after_seq, limit], row_to_firing)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

/// Full firing history for a slug, newest change first — powers the per-feed
/// event-history modal in the Marketplace.
pub fn list_firings(
    pool: &DbPool,
    slug: &str,
    limit: i64,
) -> Result<Vec<SharedEventChange>, AppError> {
    timed_query!("shared_events", "shared_events::list_firings", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, slug, seq, title, fired_at, payload, release_version
             FROM shared_event_firings
             WHERE slug = ?1
             ORDER BY seq DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![slug, limit], row_to_firing)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

/// Per-feed change-activity rollup: the newest change (payload + time) and total
/// change count for every slug that has at least one firing. One query; feeds
/// with no firings are simply absent (the UI shows "no changes yet").
pub fn change_activity(pool: &DbPool) -> Result<Vec<SharedEventFeedActivity>, AppError> {
    timed_query!("shared_events", "shared_events::change_activity", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT f.slug AS slug, agg.change_count AS change_count,
                    f.fired_at AS last_fired_at, f.payload AS last_payload
             FROM shared_event_firings f
             JOIN (
                 SELECT slug, MAX(seq) AS max_seq, COUNT(*) AS change_count
                 FROM shared_event_firings GROUP BY slug
             ) agg ON f.slug = agg.slug AND f.seq = agg.max_seq",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SharedEventFeedActivity {
                slug: row.get("slug")?,
                change_count: row.get("change_count")?,
                last_fired_at: row.get("last_fired_at")?,
                last_payload: row.get("last_payload")?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

// ---------------------------------------------------------------------------
// Subscription operations
// ---------------------------------------------------------------------------

pub fn list_subscriptions(pool: &DbPool) -> Result<Vec<SharedEventSubscription>, AppError> {
    timed_query!("shared_events", "shared_events::list_subscriptions", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT * FROM shared_event_subscriptions ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], row_to_subscription)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

pub fn list_enabled_subscriptions(pool: &DbPool) -> Result<Vec<SharedEventSubscription>, AppError> {
    timed_query!(
        "shared_events",
        "shared_events::list_enabled_subscriptions",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
            "SELECT * FROM shared_event_subscriptions WHERE enabled = 1 ORDER BY created_at DESC",
        )?;
            let rows = stmt.query_map([], row_to_subscription)?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        }
    )
}

pub fn subscribe(
    pool: &DbPool,
    input: CreateSharedEventSubscriptionInput,
) -> Result<SharedEventSubscription, AppError> {
    timed_query!("shared_events", "shared_events::subscribe", {
        let catalog = get_catalog_entry(pool, &input.catalog_entry_id)?;
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        // Seed the cursor at the current max baked firing seq so subscribing
        // delivers only *future-release* firings — no historical backfill flood.
        // (Cloud-fed feeds use a timestamp cursor; baked firings use seq. A slug
        // with no baked firings gets cursor "0", harmless for the cloud path.)
        let cursor = max_firing_seq(pool, &catalog.slug)?.to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO shared_event_subscriptions
             (id, catalog_entry_id, slug, enabled, last_cursor, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5)",
            params![id, catalog.id, catalog.slug, cursor, now],
        )?;
        get_subscription(pool, &id)
    })
}

pub fn unsubscribe(pool: &DbPool, subscription_id: &str) -> Result<(), AppError> {
    timed_query!("shared_events", "shared_events::unsubscribe", {
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
    })
}

pub fn get_subscription(pool: &DbPool, id: &str) -> Result<SharedEventSubscription, AppError> {
    timed_query!("shared_events", "shared_events::get_subscription", {
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
    })
}

pub fn update_cursor(
    pool: &DbPool,
    subscription_id: &str,
    cursor: &str,
    batch_count: u32,
) -> Result<(), AppError> {
    timed_query!("shared_events", "shared_events::update_cursor", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE shared_event_subscriptions
             SET last_cursor = ?2, events_relayed = events_relayed + ?4,
                 last_event_at = ?3, error = NULL, updated_at = ?3
             WHERE id = ?1",
            params![subscription_id, cursor, now, batch_count],
        )?;
        Ok(())
    })
}

pub fn set_error(
    pool: &DbPool,
    subscription_id: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("shared_events", "shared_events::set_error", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE shared_event_subscriptions SET error = ?2, updated_at = ?3 WHERE id = ?1",
            params![subscription_id, error, now],
        )?;
        Ok(())
    })
}

pub fn toggle_enabled(
    pool: &DbPool,
    subscription_id: &str,
    enabled: bool,
) -> Result<SharedEventSubscription, AppError> {
    timed_query!("shared_events", "shared_events::toggle_enabled", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE shared_event_subscriptions SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
            params![subscription_id, enabled as i32, now],
        )?;
        get_subscription(pool, subscription_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn insert_firing(pool: &DbPool, slug: &str, seq: i64) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO shared_event_firings (id, slug, seq, title, fired_at, payload, release_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                format!("caf-{slug}-{seq}"),
                slug,
                seq,
                format!("{slug} updated"),
                "2026-07-01T00:00:00Z",
                "{}",
                "0.0.0"
            ],
        )
        .unwrap();
    }

    /// Subscribing seeds the cursor at MAX(seq), so only *future-release*
    /// firings are delivered — no historical backfill flood.
    #[test]
    fn subscribe_seeds_cursor_at_max_seq_future_only() {
        let pool = init_test_db().unwrap();
        let slug = "connector.elevenlabs.api"; // seeded builtin catalog feed

        // Two historical firings already baked in this release.
        insert_firing(&pool, slug, 1);
        insert_firing(&pool, slug, 2);
        assert_eq!(max_firing_seq(&pool, slug).unwrap(), 2);

        // Subscribe → cursor should be "2" (skip history).
        let sub = subscribe(
            &pool,
            CreateSharedEventSubscriptionInput {
                catalog_entry_id: "shared-connector-elevenlabs".to_string(),
            },
        )
        .unwrap();
        assert_eq!(sub.last_cursor.as_deref(), Some("2"));

        // Nothing to deliver right after subscribe (all firings are historical).
        let cursor: i64 = sub.last_cursor.as_deref().unwrap().parse().unwrap();
        assert!(list_firings_after(&pool, slug, cursor, 50).unwrap().is_empty());

        // A future-release firing (seq 3) IS delivered.
        insert_firing(&pool, slug, 3);
        let due = list_firings_after(&pool, slug, cursor, 50).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].seq, 3);
    }

    /// A slug with no baked firings subscribes cleanly with cursor "0".
    #[test]
    fn subscribe_no_firings_cursor_zero() {
        let pool = init_test_db().unwrap();
        let sub = subscribe(
            &pool,
            CreateSharedEventSubscriptionInput {
                catalog_entry_id: "shared-connector-elevenlabs".to_string(),
            },
        )
        .unwrap();
        assert_eq!(sub.last_cursor.as_deref(), Some("0"));
    }
}
