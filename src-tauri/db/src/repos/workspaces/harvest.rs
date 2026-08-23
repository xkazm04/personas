use crate::models::WorkspaceHarvestCoverage;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;

/// One derived territory, as handed over by the scope deriver.
#[derive(Debug, Clone)]
pub struct HarvestScopeInput {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub file_count: i64,
}

/// Rebuild a project's scope inventory, PRESERVING harvest history for scopes
/// that survive. Scopes that vanished (context map re-scanned, directory
/// deleted) are dropped — a coverage row for a territory that no longer exists
/// would inflate the denominator with something nobody can harvest.
pub fn sync_harvest_scopes(
    pool: &DbPool,
    project_id: &str,
    scopes: &[HarvestScopeInput],
) -> Result<(), AppError> {
    timed_query!(
        "workspace_harvest_coverage",
        "dev_workspaces::sync_harvest_scopes",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let mut conn = pool.get()?;
            let tx = conn.transaction()?;
            for s in scopes {
                // Label/size refresh on conflict; the harvest history columns
                // are deliberately absent from the SET list.
                tx.execute(
                    "INSERT INTO workspace_harvest_coverage
                         (project_id, scope_id, scope_label, kind, file_count, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(project_id, scope_id) DO UPDATE SET
                         scope_label = excluded.scope_label,
                         kind        = excluded.kind,
                         file_count  = excluded.file_count,
                         updated_at  = excluded.updated_at",
                    params![project_id, s.id, s.label, s.kind, s.file_count, now],
                )?;
            }
            if scopes.is_empty() {
                tx.execute(
                    "DELETE FROM workspace_harvest_coverage WHERE project_id = ?1",
                    params![project_id],
                )?;
            } else {
                let placeholders = vec!["?"; scopes.len()].join(",");
                let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(scopes.len() + 1);
                args.push(&project_id);
                for s in scopes {
                    args.push(&s.id);
                }
                tx.execute(
                    &format!(
                        "DELETE FROM workspace_harvest_coverage
                         WHERE project_id = ?1 AND scope_id NOT IN ({placeholders})"
                    ),
                    args.as_slice(),
                )?;
            }
            tx.commit()?;
            Ok(())
        }
    )
}

/// Never-harvested scopes sort FIRST, then oldest-harvested. The fan-out reads
/// this order, so a wave always spends itself on unread territory before it
/// re-reads anything.
pub fn list_harvest_coverage(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<WorkspaceHarvestCoverage>, AppError> {
    timed_query!(
        "workspace_harvest_coverage",
        "dev_workspaces::list_harvest_coverage",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT * FROM workspace_harvest_coverage
                 WHERE project_id = ?1
                 ORDER BY last_harvested_at IS NOT NULL, last_harvested_at ASC,
                          file_count DESC, scope_id ASC",
            )?;
            let rows = stmt.query_map(params![project_id], |row| {
                Ok(WorkspaceHarvestCoverage {
                    project_id: row.get("project_id")?,
                    scope_id: row.get("scope_id")?,
                    scope_label: row.get("scope_label")?,
                    kind: row.get("kind")?,
                    file_count: row.get("file_count")?,
                    last_harvested_at: row.get("last_harvested_at")?,
                    last_run_dir: row.get("last_run_dir")?,
                    items_found: row.get("items_found")?,
                    run_count: row.get("run_count")?,
                    files_read: row.get("files_read")?,
                    files_total: row.get("files_total")?,
                    estimated_pct: row.get("estimated_pct")?,
                    unread_pockets: row.get("unread_pockets")?,
                    coverage_note: row.get("coverage_note")?,
                    updated_at: row.get("updated_at")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Record that a scope was harvested. Called from ingest with the run that
/// produced the items — including when the run produced ZERO, because "read
/// and found nothing" is a genuinely different state from "never read" and
/// only one of them is worth re-dispatching.
/// Self-reported read depth for one harvested scope. Every field is optional:
/// an agent that will not estimate its own coverage must leave it unknown
/// rather than have the app invent a number for it.
#[derive(Debug, Clone, Default)]
pub struct HarvestDepth {
    pub files_read: Option<i64>,
    pub files_total: Option<i64>,
    pub estimated_pct: Option<i64>,
    /// JSON array of paths the run named as unread.
    pub unread_pockets: Option<String>,
    pub note: Option<String>,
}

pub fn stamp_harvest_scope(
    pool: &DbPool,
    project_id: &str,
    scope_id: &str,
    run_dir: &str,
    items: i64,
    depth: &HarvestDepth,
) -> Result<(), AppError> {
    timed_query!(
        "workspace_harvest_coverage",
        "dev_workspaces::stamp_harvest_scope",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            // A scope id the deriver no longer knows (an agent inventing one,
            // or a run ingested after a re-scan) still gets a row rather than
            // being silently dropped — otherwise the work disappears from the
            // coverage ledger that is supposed to explain it.
            conn.execute(
                "INSERT INTO workspace_harvest_coverage
                     (project_id, scope_id, scope_label, kind, file_count,
                      last_harvested_at, last_run_dir, items_found, run_count,
                      files_read, files_total, estimated_pct, unread_pockets,
                      coverage_note, updated_at)
                 VALUES (?1, ?2, ?2, 'unknown', 0, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?3)
                 ON CONFLICT(project_id, scope_id) DO UPDATE SET
                     last_harvested_at = excluded.last_harvested_at,
                     last_run_dir      = excluded.last_run_dir,
                     items_found       = excluded.items_found,
                     run_count         = workspace_harvest_coverage.run_count + 1,
                     -- Depth reflects the LAST run, including when that run
                     -- declined to estimate: carrying an older, rosier number
                     -- forward would overstate coverage.
                     files_read        = excluded.files_read,
                     files_total       = excluded.files_total,
                     estimated_pct     = excluded.estimated_pct,
                     unread_pockets    = excluded.unread_pockets,
                     coverage_note     = excluded.coverage_note,
                     updated_at        = excluded.updated_at",
                params![
                    project_id,
                    scope_id,
                    now,
                    run_dir,
                    items,
                    depth.files_read,
                    depth.files_total,
                    depth.estimated_pct,
                    depth.unread_pockets,
                    depth.note,
                ],
            )?;
            Ok(())
        }
    )
}

// ============================================================================
// Adoption matrix
// ============================================================================
