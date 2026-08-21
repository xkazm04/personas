use crate::models::{PlaybookConsultCount, UnmatchedIntent, WorkspaceConsultStats};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;
use std::collections::HashMap;

/// Record one `/patterns/consult` call. `matched_slugs` empty = the session
/// asked for help and the library had none, which is the row worth having.
///
/// Callers treat this as best-effort: a telemetry write must never fail a
/// consult (the session is mid-task and the answer is already computed).
pub fn insert_consult_log(
    pool: &DbPool,
    workspace_id: &str,
    project_id: Option<&str>,
    intent: &str,
    matched_slugs: &[String],
) -> Result<(), AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::insert_consult_log", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO workspace_consult_log
                 (id, workspace_id, project_id, intent, matched_slugs, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                uuid::Uuid::new_v4().to_string(),
                workspace_id,
                project_id,
                intent.trim(),
                serde_json::to_string(matched_slugs).unwrap_or_else(|_| "[]".into()),
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    })
}

/// Consult demand for one workspace: what got served, and what went unserved.
///
/// The 30-day window is on the served side only. A stale *hit* count is
/// misleading (a playbook nobody has needed for a quarter is not hot), but a
/// stale *miss* is still a real gap — so `unmatched` is time-unbounded and
/// bounded by recency instead: the 10 most recent distinct intents.
pub fn consult_stats(pool: &DbPool, workspace_id: &str) -> Result<WorkspaceConsultStats, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::consult_stats", {
        let conn = pool.get()?;
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();

        // Counting happens in Rust: the slugs live in a JSON array, and one
        // consult legitimately serves several playbooks.
        let mut counts: HashMap<String, i32> = HashMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT matched_slugs FROM workspace_consult_log
                 WHERE workspace_id = ?1 AND created_at >= ?2",
            )?;
            let rows = stmt
                .query_map(params![workspace_id, cutoff], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for json in rows {
                for slug in serde_json::from_str::<Vec<String>>(&json).unwrap_or_default() {
                    *counts.entry(slug).or_insert(0) += 1;
                }
            }
        }
        let mut per_playbook: Vec<PlaybookConsultCount> = counts
            .into_iter()
            .map(|(slug, matches)| PlaybookConsultCount { slug, matches })
            .collect();
        // Most-consulted first; ties by slug so the order is stable.
        per_playbook.sort_by(|a, b| b.matches.cmp(&a.matches).then_with(|| a.slug.cmp(&b.slug)));

        let unmatched = {
            let mut stmt = conn.prepare(
                "SELECT intent, MAX(created_at) AS last_seen FROM workspace_consult_log
                 WHERE workspace_id = ?1 AND (matched_slugs = '[]' OR matched_slugs = '')
                 GROUP BY intent
                 ORDER BY last_seen DESC
                 LIMIT 10",
            )?;
            let rows = stmt
                .query_map(params![workspace_id], |r| {
                    Ok(UnmatchedIntent {
                        intent: r.get(0)?,
                        created_at: r.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        Ok(WorkspaceConsultStats {
            per_playbook,
            unmatched,
        })
    })
}
