//! Feed → project routes for the shared-events quick-dispatch door.
//!
//! A route pins one catalog feed to one dev project; the set of routes for an
//! entry is always REPLACED as a whole (`set_routes`), mirroring how the UI
//! edits them — a multi-select saved in one gesture, not row-by-row edits.

use rusqlite::params;

use crate::models::SharedEventProjectRoute;
use crate::DbPool;
use personas_core::error::AppError;

const COLUMNS: &str = "catalog_entry_id, project_id, created_at";

row_mapper!(row_to_route -> SharedEventProjectRoute {
    catalog_entry_id, project_id, created_at,
});

/// Every feed→project route, ordered stably for the routing table UI.
pub fn list_routes(pool: &DbPool) -> Result<Vec<SharedEventProjectRoute>, AppError> {
    timed_query!("shared_event_routes", "shared_event_routes::list_routes", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM shared_event_project_routes
             ORDER BY catalog_entry_id ASC, project_id ASC"
        ))?;
        let rows = stmt.query_map([], row_to_route)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    })
}

/// The routes pinned to one catalog entry.
pub fn list_routes_for_entry(
    pool: &DbPool,
    entry_id: &str,
) -> Result<Vec<SharedEventProjectRoute>, AppError> {
    timed_query!(
        "shared_event_routes",
        "shared_event_routes::list_routes_for_entry",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM shared_event_project_routes
                 WHERE catalog_entry_id = ?1
                 ORDER BY project_id ASC"
            ))?;
            let rows = stmt.query_map(params![entry_id], row_to_route)?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        }
    )
}

/// Replace an entry's route set: delete its rows, insert the new ones — one
/// Immediate transaction, because the delete informs the inserts and two
/// concurrent saves must serialize rather than interleave.
pub fn set_routes(pool: &DbPool, entry_id: &str, project_ids: &[String]) -> Result<(), AppError> {
    timed_query!("shared_event_routes", "shared_event_routes::set_routes", {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute(
            "DELETE FROM shared_event_project_routes WHERE catalog_entry_id = ?1",
            params![entry_id],
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        for project_id in project_ids {
            // OR IGNORE: a duplicate project id in the incoming list is a
            // caller quirk, not an error worth aborting the whole save over.
            tx.execute(
                "INSERT OR IGNORE INTO shared_event_project_routes
                 (catalog_entry_id, project_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![entry_id, project_id, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    /// `set_routes` is a whole-set replace: set 2, re-set 1, list shows 1.
    #[test]
    fn set_routes_replaces_the_previous_set() {
        let pool = init_test_db().unwrap();
        let entry = "shared-connector-elevenlabs";

        set_routes(&pool, entry, &["proj_a".to_string(), "proj_b".to_string()]).unwrap();
        let routes = list_routes_for_entry(&pool, entry).unwrap();
        assert_eq!(routes.len(), 2);
        assert_eq!(routes[0].project_id, "proj_a");
        assert_eq!(routes[1].project_id, "proj_b");

        set_routes(&pool, entry, &["proj_b".to_string()]).unwrap();
        let routes = list_routes_for_entry(&pool, entry).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].project_id, "proj_b");
        assert_eq!(routes[0].catalog_entry_id, entry);

        // The global listing sees the surviving row and nothing else for this entry.
        let all: Vec<_> = list_routes(&pool)
            .unwrap()
            .into_iter()
            .filter(|r| r.catalog_entry_id == entry)
            .collect();
        assert_eq!(all.len(), 1);
    }

    /// An empty set clears the entry's routes entirely.
    #[test]
    fn set_routes_with_empty_list_clears_the_entry() {
        let pool = init_test_db().unwrap();
        let entry = "shared-connector-elevenlabs";
        set_routes(&pool, entry, &["proj_a".to_string()]).unwrap();
        set_routes(&pool, entry, &[]).unwrap();
        assert!(list_routes_for_entry(&pool, entry).unwrap().is_empty());
    }
}
