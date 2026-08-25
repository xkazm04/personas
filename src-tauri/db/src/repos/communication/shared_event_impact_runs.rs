//! Ingested feed-impact runs — what a dispatched `feed_impact_dispatch` Fleet
//! session concluded for one (firing, project) pair.
//!
//! Rows arrive ONLY through the gated ingest door
//! (`dev_tools_feed_impact_ingest`): the CLI session writes
//! `<root>/feed-impact/runs/<id>/result.json` and never touches the database.

use rusqlite::params;

use crate::models::SharedEventImpactRun;
use crate::DbPool;
use personas_core::error::AppError;

const COLUMNS: &str =
    "id, firing_id, catalog_entry_id, project_id, verdict, summary, commit_sha, details_md, created_at";

row_mapper!(row_to_run -> SharedEventImpactRun {
    id, firing_id, catalog_entry_id, project_id, verdict, summary,
    commit_sha, details_md, created_at,
});

/// Fields the ingest door supplies for one run; `id`/`created_at` are minted here.
pub struct NewImpactRun<'a> {
    pub firing_id: &'a str,
    pub catalog_entry_id: &'a str,
    pub project_id: &'a str,
    pub verdict: &'a str,
    pub summary: &'a str,
    pub commit_sha: Option<&'a str>,
    pub details_md: Option<&'a str>,
}

/// Insert one ingested impact run.
pub fn insert_impact_run(
    pool: &DbPool,
    input: NewImpactRun<'_>,
) -> Result<SharedEventImpactRun, AppError> {
    timed_query!(
        "shared_event_impact_runs",
        "shared_event_impact_runs::insert_impact_run",
        {
            let conn = pool.get()?;
            let id = uuid::Uuid::new_v4().to_string();
            let created_at = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO shared_event_impact_runs
                 (id, firing_id, catalog_entry_id, project_id, verdict, summary,
                  commit_sha, details_md, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    input.firing_id,
                    input.catalog_entry_id,
                    input.project_id,
                    input.verdict,
                    input.summary,
                    input.commit_sha,
                    input.details_md,
                    created_at,
                ],
            )?;
            Ok(SharedEventImpactRun {
                id,
                firing_id: input.firing_id.to_string(),
                catalog_entry_id: input.catalog_entry_id.to_string(),
                project_id: input.project_id.to_string(),
                verdict: input.verdict.to_string(),
                summary: input.summary.to_string(),
                commit_sha: input.commit_sha.map(str::to_string),
                details_md: input.details_md.map(str::to_string),
                created_at,
            })
        }
    )
}

/// Impact runs for one catalog entry, newest first — powers the impact section
/// of the Marketplace event-history modal.
pub fn list_impact_runs_for_entry(
    pool: &DbPool,
    entry_id: &str,
    limit: i64,
) -> Result<Vec<SharedEventImpactRun>, AppError> {
    timed_query!(
        "shared_event_impact_runs",
        "shared_event_impact_runs::list_impact_runs_for_entry",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM shared_event_impact_runs
                 WHERE catalog_entry_id = ?1
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![entry_id, limit], row_to_run)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        }
    )
}

/// Impact runs for one firing, newest first.
pub fn list_impact_runs_for_firing(
    pool: &DbPool,
    firing_id: &str,
) -> Result<Vec<SharedEventImpactRun>, AppError> {
    timed_query!(
        "shared_event_impact_runs",
        "shared_event_impact_runs::list_impact_runs_for_firing",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM shared_event_impact_runs
                 WHERE firing_id = ?1
                 ORDER BY created_at DESC, id DESC"
            ))?;
            let rows = stmt.query_map(params![firing_id], row_to_run)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn insert(pool: &DbPool, firing: &str, entry: &str, project: &str, verdict: &str) {
        insert_impact_run(
            pool,
            NewImpactRun {
                firing_id: firing,
                catalog_entry_id: entry,
                project_id: project,
                verdict,
                summary: "summary",
                commit_sha: if verdict == "committed" {
                    Some("abc1234")
                } else {
                    None
                },
                details_md: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn insert_and_list_by_entry_and_firing() {
        let pool = init_test_db().unwrap();
        let entry = "shared-connector-elevenlabs";
        insert(&pool, "fire-1", entry, "proj_a", "committed");
        insert(&pool, "fire-1", entry, "proj_b", "no_impact");
        insert(&pool, "fire-2", entry, "proj_a", "assessed");
        insert(&pool, "fire-x", "other-entry", "proj_a", "failed");

        let by_entry = list_impact_runs_for_entry(&pool, entry, 50).unwrap();
        assert_eq!(by_entry.len(), 3);
        assert!(by_entry.iter().all(|r| r.catalog_entry_id == entry));

        let by_firing = list_impact_runs_for_firing(&pool, "fire-1").unwrap();
        assert_eq!(by_firing.len(), 2);
        let committed = by_firing.iter().find(|r| r.verdict == "committed").unwrap();
        assert_eq!(committed.commit_sha.as_deref(), Some("abc1234"));
        assert_eq!(committed.project_id, "proj_a");
    }

    #[test]
    fn list_for_entry_honors_limit() {
        let pool = init_test_db().unwrap();
        let entry = "shared-connector-elevenlabs";
        for i in 0..5 {
            insert(&pool, &format!("fire-{i}"), entry, "proj_a", "no_impact");
        }
        assert_eq!(
            list_impact_runs_for_entry(&pool, entry, 2).unwrap().len(),
            2
        );
    }
}
