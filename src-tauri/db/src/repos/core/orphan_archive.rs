//! Repository for `orphan_archive` (migration `e68_orphan_archive`): items the
//! operator archived from the Orphans lane. Archived, not deleted: the source
//! rows are never touched here.

use std::collections::{HashMap, HashSet};

use rusqlite::params;

use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// One item to archive: its `DecisionItem.id`, its project and its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveItem {
    pub item_id: String,
    pub project_id: String,
    pub item_kind: String,
}

/// Archive items in one transaction. Already archived ones are left as they
/// were. Returns how many were newly archived.
pub fn archive(
    pool: &DbPool,
    items: &[ArchiveItem],
    origin_device: Option<&str>,
) -> Result<u32, AppError> {
    timed_query!("orphan_archive", "orphan_archive::archive", {
        let mut conn = pool.conn("orphan_archive::archive")?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut n = 0u32;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO orphan_archive
                    (item_id, project_id, item_kind, archived_at, origin_device)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for i in items {
                n += stmt.execute(params![
                    i.item_id,
                    i.project_id,
                    i.item_kind,
                    now,
                    origin_device
                ])? as u32;
            }
        }
        tx.commit()?;
        Ok(n)
    })
}

/// Every archived item id.
pub fn archived_ids(pool: &DbPool) -> Result<HashSet<String>, AppError> {
    timed_query!("orphan_archive", "orphan_archive::archived_ids", {
        let conn = pool.conn("orphan_archive::archived_ids")?;
        let mut stmt = conn.prepare_cached("SELECT item_id FROM orphan_archive")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>("item_id"))?;
        Ok(collect_rows(rows, "orphan_archive::archived_ids")
            .into_iter()
            .collect())
    })
}

/// Archived items per project, all time.
pub fn counts_by_project(pool: &DbPool) -> Result<HashMap<String, u32>, AppError> {
    timed_query!("orphan_archive", "orphan_archive::counts_by_project", {
        let conn = pool.conn("orphan_archive::counts_by_project")?;
        let mut stmt = conn.prepare_cached(
            "SELECT project_id, COUNT(*) AS n FROM orphan_archive GROUP BY project_id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>("project_id")?, r.get::<_, i64>("n")?))
        })?;
        Ok(collect_rows(rows, "orphan_archive::counts_by_project")
            .into_iter()
            .map(|(p, n)| (p, n.max(0) as u32))
            .collect())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> ArchiveItem {
        ArchiveItem {
            item_id: id.into(),
            project_id: "proj".into(),
            item_kind: "idea".into(),
        }
    }

    #[test]
    fn archiving_is_idempotent_per_item() {
        let pool = crate::init_test_db().unwrap();
        assert_eq!(
            archive(&pool, &[item("idea:a"), item("idea:b")], None).unwrap(),
            2
        );
        assert_eq!(
            archive(&pool, &[item("idea:a"), item("idea:c")], None).unwrap(),
            1
        );
        let ids = archived_ids(&pool).unwrap();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains("idea:b"));
        assert_eq!(counts_by_project(&pool).unwrap().get("proj"), Some(&3));
    }
}
