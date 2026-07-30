//! Zero-Plaintext Broker consumer edges.
//!
//! One row per (credential, external-consumer-key) pair, UPSERTed on every
//! proxied management-API call. This is the *observed* half of the
//! blast-radius graph: whichever consumer identity (per-consumer handle or
//! broad key) actually used a credential through the proxy leaves a live,
//! refreshed edge here. Readers join `external_api_keys` for live key status
//! (kill-switch state) — the edge itself intentionally has no FK so revoked
//! consumers remain visible as history.

use rusqlite::params;
use std::collections::HashMap;

use crate::models::{BrokerConsumerEdge, BrokerConsumerView};
use crate::repos::utils::collect_rows;
use crate::DbPool;
use personas_core::error::AppError;

row_mapper!(row_to_edge -> BrokerConsumerEdge {
    id, credential_id, consumer_key_id, consumer_name,
    call_count,
    last_status,
    first_used_at, last_used_at,
});

/// Create or refresh the (credential, consumer) edge: bump `call_count`,
/// stamp `last_used_at` / `last_status`, and keep the freshest consumer name.
/// Called on every proxied call — must stay a single cheap UPSERT.
pub fn upsert_edge(
    pool: &DbPool,
    credential_id: &str,
    consumer_key_id: &str,
    consumer_name: &str,
    last_status: Option<i64>,
) -> Result<(), AppError> {
    timed_query!("broker_edges", "broker_edges::upsert_edge", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO credential_consumer_edges
                (id, credential_id, consumer_key_id, consumer_name,
                 call_count, last_status, first_used_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)
             ON CONFLICT(credential_id, consumer_key_id) DO UPDATE SET
                call_count = call_count + 1,
                consumer_name = excluded.consumer_name,
                last_status = excluded.last_status,
                last_used_at = excluded.last_used_at",
            params![
                uuid::Uuid::new_v4().to_string(),
                credential_id,
                consumer_key_id,
                consumer_name,
                last_status,
                now
            ],
        )?;
        Ok(())
    })
}

/// All live-usage edges for one credential, most recently used first.
/// Feeds the blast-radius / dependents merge.
pub fn list_for_credential(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<BrokerConsumerEdge>, AppError> {
    timed_query!("broker_edges", "broker_edges::list_for_credential", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, credential_id, consumer_key_id, consumer_name,
                    call_count, last_status, first_used_at, last_used_at
             FROM credential_consumer_edges
             WHERE credential_id = ?1
             ORDER BY last_used_at DESC",
        )?;
        let rows = stmt.query_map(params![credential_id], row_to_edge)?;
        Ok(collect_rows(rows, "broker_edges::list_for_credential"))
    })
}

/// Consumer-centric rollup for the vault Broker surface: one row per consumer
/// key, aggregating its edges and joining the live key state so the UI can
/// render an honest kill-switch. Ordered by most recent activity.
pub fn list_consumers(pool: &DbPool) -> Result<Vec<BrokerConsumerView>, AppError> {
    timed_query!("broker_edges", "broker_edges::list_consumers", {
        let conn = pool.get()?;

        // Aggregate edges per consumer.
        struct Agg {
            consumer_name: String,
            credential_ids: Vec<String>,
            credential_names: Vec<String>,
            total_calls: i64,
            last_status: Option<i64>,
            last_used_at: Option<String>,
        }
        let mut stmt = conn.prepare(
            "SELECT e.consumer_key_id, e.consumer_name, e.credential_id,
                    COALESCE(pc.name, e.credential_id) AS credential_name,
                    e.call_count, e.last_status, e.last_used_at
             FROM credential_consumer_edges e
             LEFT JOIN persona_credentials pc ON pc.id = e.credential_id
             ORDER BY e.last_used_at DESC",
        )?;
        let raw = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let raw = collect_rows(raw, "broker_edges::list_consumers/edges");

        let mut order: Vec<String> = Vec::new();
        let mut by_key: HashMap<String, Agg> = HashMap::new();
        for (key_id, name, cred_id, cred_name, calls, status, used_at) in raw {
            let agg = by_key.entry(key_id.clone()).or_insert_with(|| {
                order.push(key_id.clone());
                Agg {
                    consumer_name: name.clone(),
                    credential_ids: Vec::new(),
                    credential_names: Vec::new(),
                    total_calls: 0,
                    last_status: None,
                    last_used_at: None,
                }
            });
            agg.credential_ids.push(cred_id);
            agg.credential_names.push(cred_name);
            agg.total_calls += calls;
            // Rows arrive newest-first, so the first row per key wins.
            if agg.last_used_at.is_none() {
                agg.last_used_at = Some(used_at);
                agg.last_status = status;
            }
        }

        // Join live key state for the kill-switch.
        let mut views = Vec::with_capacity(order.len());
        for key_id in order {
            let agg = match by_key.remove(&key_id) {
                Some(a) => a,
                None => continue,
            };
            let key_state: Option<(String, bool, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT key_prefix, enabled, revoked_at, expires_at
                     FROM external_api_keys WHERE id = ?1",
                    params![key_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, bool>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .ok();
            let (key_prefix, active, revoked_at, expires_at) = match key_state {
                Some((prefix, enabled, revoked, expires)) => {
                    (Some(prefix), enabled && revoked.is_none(), revoked, expires)
                }
                None => (None, false, None, None),
            };
            views.push(BrokerConsumerView {
                consumer_key_id: key_id,
                consumer_name: agg.consumer_name,
                key_prefix,
                active,
                revoked_at,
                expires_at,
                credential_ids: agg.credential_ids,
                credential_names: agg.credential_names,
                total_calls: agg.total_calls,
                last_status: agg.last_status,
                last_used_at: agg.last_used_at,
            });
        }
        Ok(views)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hermetic pool with just the tables this repo touches (see the
    /// external_api_keys repo tests for why the full migration chain is
    /// avoided here).
    fn test_pool() -> DbPool {
        use std::time::Duration;
        let tmp = std::env::temp_dir().join(format!("broker_edges_{}.db", uuid::Uuid::new_v4()));
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&tmp);
        let pool = r2d2::Pool::builder()
            .max_size(2)
            .connection_timeout(Duration::from_secs(5))
            .build(manager)
            .expect("test pool build");
        pool.get()
            .expect("conn")
            .execute_batch(
                "CREATE TABLE credential_consumer_edges (
                    id TEXT PRIMARY KEY,
                    credential_id TEXT NOT NULL,
                    consumer_key_id TEXT NOT NULL,
                    consumer_name TEXT NOT NULL,
                    call_count INTEGER NOT NULL DEFAULT 0,
                    last_status INTEGER,
                    first_used_at TEXT NOT NULL DEFAULT (datetime('now')),
                    last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(credential_id, consumer_key_id)
                );
                CREATE TABLE external_api_keys (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL,
                    scopes TEXT NOT NULL DEFAULT '[]',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    last_used_at TEXT, revoked_at TEXT, expires_at TEXT,
                    bound_origin TEXT, label TEXT
                );
                CREATE TABLE persona_credentials (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    service_type TEXT NOT NULL DEFAULT 'github'
                );",
            )
            .expect("create tables");
        pool
    }

    #[test]
    fn upsert_creates_then_increments() {
        let pool = test_pool();
        upsert_edge(&pool, "cred-1", "key-1", "nightly-bot", Some(200)).unwrap();
        upsert_edge(&pool, "cred-1", "key-1", "nightly-bot", Some(401)).unwrap();
        let edges = list_for_credential(&pool, "cred-1").unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].call_count, 2);
        assert_eq!(edges[0].last_status, Some(401));
    }

    #[test]
    fn edges_are_per_consumer_and_per_credential() {
        let pool = test_pool();
        upsert_edge(&pool, "cred-1", "key-1", "a", Some(200)).unwrap();
        upsert_edge(&pool, "cred-1", "key-2", "b", Some(200)).unwrap();
        upsert_edge(&pool, "cred-2", "key-1", "a", Some(200)).unwrap();
        assert_eq!(list_for_credential(&pool, "cred-1").unwrap().len(), 2);
        assert_eq!(list_for_credential(&pool, "cred-2").unwrap().len(), 1);
    }

    #[test]
    fn list_consumers_joins_live_key_state() {
        let pool = test_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO external_api_keys (id, name, key_hash, key_prefix)
                 VALUES ('key-1', 'handle:bot', 'h1', 'pk_abc123')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_credentials (id, name) VALUES ('cred-1', 'GitHub main')",
                [],
            )
            .unwrap();
        }
        upsert_edge(&pool, "cred-1", "key-1", "handle:bot", Some(200)).unwrap();
        // key-2 was hard-deleted: edge survives, view shows inactive.
        upsert_edge(&pool, "cred-1", "key-2", "gone", Some(200)).unwrap();

        let views = list_consumers(&pool).unwrap();
        assert_eq!(views.len(), 2);
        let v1 = views.iter().find(|v| v.consumer_key_id == "key-1").unwrap();
        assert!(v1.active);
        assert_eq!(v1.key_prefix.as_deref(), Some("pk_abc123"));
        assert_eq!(v1.credential_names, vec!["GitHub main".to_string()]);
        let v2 = views.iter().find(|v| v.consumer_key_id == "key-2").unwrap();
        assert!(!v2.active, "deleted key must read as inactive");
        assert!(v2.key_prefix.is_none());
    }

    #[test]
    fn revoked_consumer_reads_inactive() {
        let pool = test_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO external_api_keys (id, name, key_hash, key_prefix, enabled, revoked_at)
                 VALUES ('key-r', 'dead', 'h2', 'pk_dead00', 0, '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        upsert_edge(&pool, "cred-1", "key-r", "dead", None).unwrap();
        let views = list_consumers(&pool).unwrap();
        assert_eq!(views.len(), 1);
        assert!(!views[0].active);
        assert!(views[0].revoked_at.is_some());
    }
}
