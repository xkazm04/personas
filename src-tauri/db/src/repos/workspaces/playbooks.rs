use crate::models::{WorkspacePlaybook, WorkspacePlaybookPattern};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};

use super::org::get_workspace_by_id;

pub const PLAYBOOK_STATUSES: &[&str] = &["draft", "active", "retired"];

pub const PLAYBOOK_PHASES: &[&str] = &["before", "during", "verify"];

/// Kebab slug for a playbook key. Same discipline as topics: lowercase,
/// hyphens, nothing else.
fn playbook_slug(raw: &str) -> Result<String, AppError> {
    let slug: String = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        return Err(AppError::Validation("Playbook slug cannot be empty".into()));
    }
    Ok(slug)
}

pub fn list_playbooks(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<WorkspacePlaybook>, AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::list_playbooks", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, workspace_id, slug, title, triggers, summary, status, created_at, updated_at
             FROM workspace_playbooks WHERE workspace_id = ?1 ORDER BY title",
        )?;
        let rows = stmt
            .query_map(params![workspace_id], row_to_playbook)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// Memberships for EVERY playbook of the workspace in one call — the UI joins
/// them client-side (one round-trip, not one per playbook).
pub fn list_playbook_patterns(
    pool: &DbPool,
    workspace_id: &str,
) -> Result<Vec<WorkspacePlaybookPattern>, AppError> {
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::list_playbook_patterns",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT m.playbook_id, m.practice_id, m.phase, m.ordinal, m.note
             FROM workspace_playbook_patterns m
             JOIN workspace_playbooks p ON p.id = m.playbook_id
             WHERE p.workspace_id = ?1
             ORDER BY m.playbook_id, m.phase, m.ordinal",
            )?;
            let rows = stmt
                .query_map(params![workspace_id], |r| {
                    Ok(WorkspacePlaybookPattern {
                        playbook_id: r.get(0)?,
                        practice_id: r.get(1)?,
                        phase: r.get(2)?,
                        ordinal: r.get(3)?,
                        note: r.get(4)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}

pub fn create_playbook(
    pool: &DbPool,
    workspace_id: &str,
    slug: &str,
    title: &str,
    triggers_json: &str,
    summary: &str,
) -> Result<WorkspacePlaybook, AppError> {
    let slug = playbook_slug(slug)?;
    if title.trim().is_empty() {
        return Err(AppError::Validation(
            "Playbook title cannot be empty".into(),
        ));
    }
    // Triggers must be a JSON array of strings — the consult matcher's input.
    let parsed: Vec<String> = serde_json::from_str(triggers_json)
        .map_err(|e| AppError::Validation(format!("triggers must be a JSON string array: {e}")))?;
    if parsed.is_empty() {
        return Err(AppError::Validation(
            "A playbook needs at least one trigger phrase".into(),
        ));
    }
    get_workspace_by_id(pool, workspace_id)?;
    timed_query!("dev_workspaces", "dev_workspaces::create_playbook", {
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO workspace_playbooks
                 (id, workspace_id, slug, title, triggers, summary, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?7)",
            params![
                id,
                workspace_id,
                slug,
                title.trim(),
                triggers_json,
                summary.trim(),
                now
            ],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(f, _)
                if f.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                AppError::Validation(format!("A playbook with slug '{slug}' already exists"))
            }
            other => other.into(),
        })?;
        get_playbook_by_id(pool, &id)
    })
}

pub fn update_playbook_status(
    pool: &DbPool,
    id: &str,
    status: &str,
) -> Result<WorkspacePlaybook, AppError> {
    if !PLAYBOOK_STATUSES.contains(&status) {
        return Err(AppError::Validation(format!(
            "Unknown playbook status '{status}' — expected one of {}",
            PLAYBOOK_STATUSES.join(", ")
        )));
    }
    timed_query!(
        "dev_workspaces",
        "dev_workspaces::update_playbook_status",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.get()?;
            let n = conn.execute(
                "UPDATE workspace_playbooks SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status, now, id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("Playbook {id}")));
            }
            get_playbook_by_id(pool, id)
        }
    )
}

pub fn delete_playbook(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("dev_workspaces", "dev_workspaces::delete_playbook", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM workspace_playbooks WHERE id = ?1", params![id])?;
        Ok(())
    })
}

/// Replace one playbook's whole membership atomically. Phases are validated
/// at the door; the DB CHECK is the backstop, not the message.
pub fn set_playbook_patterns(
    pool: &DbPool,
    playbook_id: &str,
    members: &[WorkspacePlaybookPattern],
) -> Result<(), AppError> {
    for m in members {
        if !PLAYBOOK_PHASES.contains(&m.phase.as_str()) {
            return Err(AppError::Validation(format!(
                "Unknown phase '{}' — expected one of {}",
                m.phase,
                PLAYBOOK_PHASES.join(", ")
            )));
        }
    }
    get_playbook_by_id(pool, playbook_id)?;
    timed_query!("dev_workspaces", "dev_workspaces::set_playbook_patterns", {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM workspace_playbook_patterns WHERE playbook_id = ?1",
            params![playbook_id],
        )?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO workspace_playbook_patterns
                     (playbook_id, practice_id, phase, ordinal, note)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for m in members {
                stmt.execute(params![
                    playbook_id,
                    m.practice_id,
                    m.phase,
                    m.ordinal,
                    m.note
                ])?;
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE workspace_playbooks SET updated_at = ?1 WHERE id = ?2",
            params![now, playbook_id],
        )?;
        tx.commit()?;
        Ok(())
    })
}

// ============================================================================
// Pattern fabric — consult telemetry
// ============================================================================

fn get_playbook_by_id(pool: &DbPool, id: &str) -> Result<WorkspacePlaybook, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT id, workspace_id, slug, title, triggers, summary, status, created_at, updated_at
         FROM workspace_playbooks WHERE id = ?1",
        params![id],
        row_to_playbook,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("Playbook {id}")))
}

fn row_to_playbook(r: &Row<'_>) -> rusqlite::Result<WorkspacePlaybook> {
    Ok(WorkspacePlaybook {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        slug: r.get(2)?,
        title: r.get(3)?,
        triggers: r.get(4)?,
        summary: r.get(5)?,
        status: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

#[cfg(test)]
mod playbook_tests {
    use super::*;
    use crate::repos::workspaces::consults::{consult_stats, insert_consult_log};

    #[test]
    fn slug_is_kebab_or_refused() {
        assert_eq!(playbook_slug("Add DB Table").unwrap(), "add-db-table");
        assert_eq!(playbook_slug("  add--db__table  ").unwrap(), "add-db-table");
        assert!(playbook_slug("   ").is_err());
        assert!(playbook_slug("///").is_err());
    }

    #[test]
    fn consult_stats_counts_hits_and_keeps_the_misses_verbatim() {
        let pool = crate::init_test_db().unwrap();
        pool.get()
            .unwrap()
            .execute_batch(
                "INSERT INTO dev_workspaces (id, name, created_at, updated_at)
                    VALUES ('ws1', 'WS', '2026-01-01', '2026-01-01');
                 INSERT INTO dev_workspaces (id, name, created_at, updated_at)
                    VALUES ('ws2', 'Other', '2026-01-01', '2026-01-01');",
            )
            .unwrap();

        insert_consult_log(
            &pool,
            "ws1",
            Some("p1"),
            "add a db table",
            &["add-db-table".into()],
        )
        .unwrap();
        insert_consult_log(
            &pool,
            "ws1",
            None,
            "add a migration",
            &["add-db-table".into(), "ship-a-migration".into()],
        )
        .unwrap();
        insert_consult_log(&pool, "ws1", None, "wire a websocket", &[]).unwrap();
        insert_consult_log(&pool, "ws1", None, "wire a websocket", &[]).unwrap();
        // Another workspace's traffic must not leak into this one's demand.
        insert_consult_log(&pool, "ws2", None, "something else", &["elsewhere".into()]).unwrap();

        let stats = consult_stats(&pool, "ws1").unwrap();
        assert_eq!(
            stats
                .per_playbook
                .iter()
                .map(|p| (p.slug.as_str(), p.matches))
                .collect::<Vec<_>>(),
            vec![("add-db-table", 2), ("ship-a-migration", 1)],
            "most-consulted first; one consult may serve several playbooks"
        );
        // The unserved intent survives verbatim, once, as the curation backlog.
        assert_eq!(stats.unmatched.len(), 1);
        assert_eq!(stats.unmatched[0].intent, "wire a websocket");
        assert!(!stats.unmatched[0].created_at.is_empty());

        // A workspace nobody has consulted reports nothing, not an error.
        let empty = consult_stats(&pool, "ws-none").unwrap();
        assert!(empty.per_playbook.is_empty() && empty.unmatched.is_empty());
    }
}
