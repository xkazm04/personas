use std::collections::HashMap;

use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

/// Load all persisted watermarks into a trigger_id -> last_seen_ts map.
pub fn load_all(pool: &DbPool) -> Result<HashMap<String, String>, AppError> {
    timed_query!("cloud_webhook_watermarks", "cloud_webhook_watermarks::load_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT trigger_id, last_seen_ts FROM cloud_webhook_watermarks",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            if let Ok((tid, ts)) = row {
                map.insert(tid, ts);
            }
        }
        Ok(map)
    })
}

/// Upsert the watermark for a single trigger.
pub fn upsert(pool: &DbPool, trigger_id: &str, last_seen_ts: &str) -> Result<(), AppError> {
    timed_query!("cloud_webhook_watermarks", "cloud_webhook_watermarks::upsert", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO cloud_webhook_watermarks (trigger_id, last_seen_ts, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(trigger_id) DO UPDATE SET last_seen_ts = ?2, updated_at = ?3",
            params![trigger_id, last_seen_ts, now],
        )?;
        Ok(())
    })
}

/// Remove watermarks for triggers that no longer exist.
/// Keeps only rows whose trigger_id is in the `active_ids` set.
pub fn prune(pool: &DbPool, active_ids: &[&str]) -> Result<(), AppError> {
    timed_query!("cloud_webhook_watermarks", "cloud_webhook_watermarks::prune", {
        if active_ids.is_empty() {
            let conn = pool.get()?;
            conn.execute("DELETE FROM cloud_webhook_watermarks", [])?;
            return Ok(());
        }
        let conn = pool.get()?;
        let placeholders: Vec<String> = (1..=active_ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "DELETE FROM cloud_webhook_watermarks WHERE trigger_id NOT IN ({})",
            placeholders.join(", ")
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = active_ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
        conn.execute(&sql, params.as_slice())?;
        Ok(())
    })
}
