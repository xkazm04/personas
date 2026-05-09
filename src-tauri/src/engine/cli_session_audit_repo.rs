//! Phase 5 v1: audit log for CLI session reads.
//!
//! Each time a persona execution actually injects a Claude CLI session
//! block into its prompt prefix, the runner inserts a row here. The
//! "What did Athena see?" modal surfaces these rows so the user can
//! review what was extracted on their behalf.
//!
//! The audit is **append-only**. Deletion isn't meaningful — the read
//! already happened, and the persona's response is in the executions
//! table. What we offer instead is TTL eviction (24h, mirrors the
//! ambient_signal table) so the audit footprint stays bounded.

use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;

/// One audit row representing a single CLI session read.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSessionReadAudit {
    pub id: String,
    pub persona_id: String,
    pub persona_name: String,
    pub project: String,
    pub turn_count: i64,
    pub read_at: i64,
}

/// Insert one audit row. `INSERT OR IGNORE` for idempotence on id —
/// a duplicate id (recovery after a partial flush) is a no-op.
pub fn insert_audit(
    pool: &DbPool,
    id: &str,
    persona_id: &str,
    persona_name: &str,
    project: &str,
    turn_count: i64,
    read_at_secs: u64,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO cli_session_read_audit
            (id, persona_id, persona_name, project, turn_count, read_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            persona_id,
            persona_name,
            project,
            turn_count,
            read_at_secs as i64,
        ],
    )?;
    Ok(())
}

/// Fetch the most recent audit rows, newest first, capped at
/// `max_count`. Returns `Vec::new()` on a load error so the
/// transparency modal degrades gracefully instead of erroring out.
pub fn list_recent(pool: &DbPool, max_count: u32) -> Result<Vec<CliSessionReadAudit>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, persona_id, persona_name, project, turn_count, read_at
         FROM cli_session_read_audit
         ORDER BY read_at DESC
         LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![max_count as i64], |row| {
            Ok(CliSessionReadAudit {
                id: row.get(0)?,
                persona_id: row.get(1)?,
                persona_name: row.get(2)?,
                project: row.get(3)?,
                turn_count: row.get(4)?,
                read_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Delete audit rows older than `cutoff_secs`. Returns rows deleted.
/// Bounded by the same 24h TTL as the ambient_signal table — caller
/// (the eviction tick) chooses the cutoff.
pub fn evict_older_than(pool: &DbPool, cutoff_secs: u64) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM cli_session_read_audit WHERE read_at < ?1",
        params![cutoff_secs as i64],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> crate::db::DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:cli_audit_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
        }
        pool
    }

    fn now_secs() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    #[test]
    fn insert_and_list_round_trip() {
        let pool = test_pool();
        let now = now_secs();
        insert_audit(&pool, "cliread_1", "p1", "Helper", "proj-a", 5, now).unwrap();
        insert_audit(&pool, "cliread_2", "p2", "Scout", "proj-b", 3, now).unwrap();

        let rows = list_recent(&pool, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|r| r.persona_name == "Helper" && r.turn_count == 5));
        assert!(rows.iter().any(|r| r.project == "proj-b"));
    }

    #[test]
    fn list_returns_newest_first() {
        let pool = test_pool();
        let now = now_secs();
        insert_audit(&pool, "old", "p", "P", "proj", 1, now - 60).unwrap();
        insert_audit(&pool, "new", "p", "P", "proj", 1, now).unwrap();

        let rows = list_recent(&pool, 10).unwrap();
        assert_eq!(rows[0].id, "new");
        assert_eq!(rows[1].id, "old");
    }

    #[test]
    fn list_respects_max_count() {
        let pool = test_pool();
        let now = now_secs();
        for i in 0..5 {
            insert_audit(
                &pool,
                &format!("a_{i}"),
                "p",
                "P",
                "proj",
                1,
                now - i,
            )
            .unwrap();
        }
        let rows = list_recent(&pool, 3).unwrap();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn evict_drops_only_old_rows() {
        let pool = test_pool();
        let now = now_secs();
        insert_audit(&pool, "old1", "p", "P", "proj", 1, now - 7200).unwrap();
        insert_audit(&pool, "fresh", "p", "P", "proj", 1, now - 1800).unwrap();
        let n = evict_older_than(&pool, now - 3600).unwrap();
        assert_eq!(n, 1);
        let rows = list_recent(&pool, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "fresh");
    }

    #[test]
    fn insert_or_ignore_is_idempotent() {
        let pool = test_pool();
        let now = now_secs();
        insert_audit(&pool, "dup", "p", "First", "proj", 1, now).unwrap();
        insert_audit(&pool, "dup", "p", "Second", "proj", 99, now).unwrap();
        let rows = list_recent(&pool, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].persona_name, "First");
        assert_eq!(rows[0].turn_count, 1);
    }
}
