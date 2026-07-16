//! Persona change-log persistence — append-only field-level edit trail.
//!
//! Every `update_persona` writes one row per *changed* field (see
//! [`write_diff`]). The diff is computed from the already-loaded `existing`
//! persona row against the incoming `UpdatePersonaInput`, so no extra SELECT is
//! added to the autosave path. Secret-bearing fields (`model_profile`,
//! `notification_channels`) are logged with values redacted to `"(changed)"` —
//! the raw JSON (which carries `auth_token`s) is never stored.
//!
//! Noise control:
//!  * **Coalescing** — a change to the same field within
//!    [`COALESCE_WINDOW_SECS`] of a prior row updates that row's `after_value`
//!    (keeping the original `before_value`) instead of appending a new one, so
//!    a debounced burst of saves collapses to one row.
//!  * **Retention** — per-persona history is capped at [`RETAIN_PER_PERSONA`];
//!    the oldest rows beyond the cap are pruned on every insert.

use rusqlite::{params, Connection};

use crate::db::models::{Persona, PersonaChangeEntry, UpdatePersonaInput};
use crate::db::DbPool;
use crate::error::AppError;

/// Redaction placeholder stored in place of secret-bearing field values.
const REDACTED: &str = "(changed)";
/// Max characters kept for a displayed before/after value.
const VALUE_MAX_CHARS: usize = 200;
/// Same-field edits within this window collapse into the prior row.
const COALESCE_WINDOW_SECS: i64 = 30;
/// Per-persona history cap. Oldest rows beyond this are pruned on insert.
const RETAIN_PER_PERSONA: i64 = 200;

row_mapper!(row_to_persona_change_entry -> PersonaChangeEntry {
    id, persona_id, field, before_value, after_value, source, created_at,
});

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

fn truncate(s: &str) -> String {
    if s.chars().count() <= VALUE_MAX_CHARS {
        s.to_string()
    } else {
        let cut: String = s.chars().take(VALUE_MAX_CHARS).collect();
        format!("{cut}…")
    }
}

fn disp(s: &str) -> Option<String> {
    Some(truncate(s))
}
fn disp_opt(s: &Option<String>) -> Option<String> {
    s.as_ref().map(|v| truncate(v))
}
fn bool_str(b: bool) -> Option<String> {
    Some(if b { "true".into() } else { "false".into() })
}

type Change = (&'static str, Option<String>, Option<String>);

/// Compute the ordered list of `(field, before, after)` changes implied by
/// `input` relative to `existing`. Only fields the user cares about are
/// tracked; secret fields are redacted.
fn compute_changes(existing: &Persona, input: &UpdatePersonaInput) -> Vec<Change> {
    let mut changes: Vec<Change> = Vec::new();

    if let Some(ref v) = input.name {
        if *v != existing.name {
            changes.push(("name", disp(&existing.name), disp(v)));
        }
    }
    if let Some(ref v) = input.description {
        if *v != existing.description {
            changes.push(("description", disp_opt(&existing.description), disp_opt(v)));
        }
    }
    if let Some(ref v) = input.system_prompt {
        if *v != existing.system_prompt {
            changes.push(("system_prompt", disp(&existing.system_prompt), disp(v)));
        }
    }
    if let Some(ref v) = input.structured_prompt {
        if *v != existing.structured_prompt {
            changes.push((
                "structured_prompt",
                disp_opt(&existing.structured_prompt),
                disp_opt(v),
            ));
        }
    }
    if let Some(ref v) = input.icon {
        if *v != existing.icon {
            changes.push(("icon", disp_opt(&existing.icon), disp_opt(v)));
        }
    }
    if let Some(ref v) = input.color {
        if *v != existing.color {
            changes.push(("color", disp_opt(&existing.color), disp_opt(v)));
        }
    }
    if let Some(v) = input.enabled {
        if v != existing.enabled {
            changes.push(("enabled", bool_str(existing.enabled), bool_str(v)));
        }
    }
    if let Some(v) = input.sensitive {
        if v != existing.sensitive {
            changes.push(("sensitive", bool_str(existing.sensitive), bool_str(v)));
        }
    }
    if let Some(v) = input.headless {
        if v != existing.headless {
            changes.push(("headless", bool_str(existing.headless), bool_str(v)));
        }
    }
    if let Some(v) = input.max_concurrent {
        if v != existing.max_concurrent {
            changes.push((
                "max_concurrent",
                Some(existing.max_concurrent.to_string()),
                Some(v.to_string()),
            ));
        }
    }
    if let Some(v) = input.timeout_ms {
        if v != existing.timeout_ms {
            changes.push((
                "timeout_ms",
                Some(existing.timeout_ms.to_string()),
                Some(v.to_string()),
            ));
        }
    }
    if let Some(ref v) = input.max_budget_usd {
        if *v != existing.max_budget_usd {
            changes.push((
                "max_budget_usd",
                existing.max_budget_usd.map(|x| x.to_string()),
                v.map(|x| x.to_string()),
            ));
        }
    }
    if let Some(ref v) = input.max_turns {
        if *v != existing.max_turns {
            changes.push((
                "max_turns",
                existing.max_turns.map(|x| x.to_string()),
                v.map(|x| x.to_string()),
            ));
        }
    }
    if let Some(ref v) = input.design_context {
        if *v != existing.design_context {
            changes.push((
                "design_context",
                disp_opt(&existing.design_context),
                disp_opt(v),
            ));
        }
    }
    if let Some(ref v) = input.parameters {
        if *v != existing.parameters {
            changes.push(("parameters", disp_opt(&existing.parameters), disp_opt(v)));
        }
    }
    if let Some(ref v) = input.lifecycle {
        if *v != existing.lifecycle {
            changes.push(("lifecycle", disp(&existing.lifecycle), disp(v)));
        }
    }
    if let Some(v) = input.cli_awareness_enabled {
        if v != existing.cli_awareness_enabled {
            changes.push((
                "cli_awareness_enabled",
                bool_str(existing.cli_awareness_enabled),
                bool_str(v),
            ));
        }
    }
    // --- Secret-bearing fields: values redacted, never stored raw. ---
    if let Some(ref v) = input.model_profile {
        // `existing.model_profile` is decrypted on read; comparing the raw JSON
        // detects real changes while the stored value stays "(changed)".
        if *v != existing.model_profile {
            changes.push((
                "model_profile",
                existing.model_profile.as_ref().map(|_| REDACTED.to_string()),
                v.as_ref().map(|_| REDACTED.to_string()),
            ));
        }
    }
    if let Some(ref v) = input.notification_channels {
        let differs = match &existing.notification_channels {
            Some(old) => old != v,
            None => !v.trim().is_empty(),
        };
        if differs {
            changes.push((
                "notification_channels",
                existing
                    .notification_channels
                    .as_ref()
                    .map(|_| REDACTED.to_string()),
                Some(REDACTED.to_string()),
            ));
        }
    }

    changes
}

// ---------------------------------------------------------------------------
// Writer (runs inside the update_persona transaction)
// ---------------------------------------------------------------------------

/// Write field-level change rows for one `update_persona` call. Operates on the
/// caller's connection/transaction so the audit rows commit atomically with the
/// UPDATE. Never fails the update: returns the number of rows written.
pub fn write_diff(
    conn: &Connection,
    persona_id: &str,
    existing: &Persona,
    input: &UpdatePersonaInput,
    source: Option<&str>,
    now: &str,
) -> Result<usize, AppError> {
    let changes = compute_changes(existing, input);
    if changes.is_empty() {
        return Ok(0);
    }

    let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(COALESCE_WINDOW_SECS)).to_rfc3339();

    for (field, before, after) in &changes {
        // Coalesce: if a recent row for the same (persona, field, source) exists
        // within the window, update its after_value + timestamp in place —
        // keeping the ORIGINAL before_value — instead of appending noise.
        let recent_id: Option<String> = conn
            .query_row(
                "SELECT id FROM persona_change_log
                 WHERE persona_id = ?1 AND field = ?2
                   AND (source IS ?3 OR source = ?3)
                   AND created_at >= ?4
                 ORDER BY created_at DESC
                 LIMIT 1",
                params![persona_id, field, source, cutoff],
                |row| row.get(0),
            )
            .ok();

        if let Some(rid) = recent_id {
            conn.execute(
                "UPDATE persona_change_log SET after_value = ?1, created_at = ?2 WHERE id = ?3",
                params![after, now, rid],
            )?;
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO persona_change_log
                    (id, persona_id, field, before_value, after_value, source, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, persona_id, field, before, after, source, now],
            )?;
        }
    }

    // Retention: cap per-persona history. Bounded DELETE keyed on the index.
    conn.execute(
        "DELETE FROM persona_change_log
         WHERE persona_id = ?1
           AND id NOT IN (
               SELECT id FROM persona_change_log
               WHERE persona_id = ?1
               ORDER BY created_at DESC
               LIMIT ?2
           )",
        params![persona_id, RETAIN_PER_PERSONA],
    )?;

    Ok(changes.len())
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/// Newest-first change history for one persona. `limit` clamped to `[1, 500]`.
pub fn list_for_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: u32,
) -> Result<Vec<PersonaChangeEntry>, AppError> {
    timed_query!("persona_change_log", "persona_change_log::list_for_persona", {
        let bounded = limit.clamp(1, 500);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, persona_id, field, before_value, after_value, source, created_at
             FROM persona_change_log
             WHERE persona_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, bounded], row_to_persona_change_entry)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> crate::db::DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:persona_change_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn base_persona() -> Persona {
        let mut p = Persona::default();
        p.id = "p1".to_string();
        p.name = "Original".to_string();
        p.system_prompt = "old prompt".to_string();
        p.max_budget_usd = Some(1.0);
        p.model_profile = Some(r#"{"model":"claude-x","auth_token":"secret-abc"}"#.to_string());
        p
    }

    #[test]
    fn writes_one_row_per_changed_field() {
        let pool = test_pool();
        let existing = base_persona();
        let input = UpdatePersonaInput {
            name: Some("Renamed".into()),
            max_budget_usd: Some(Some(5.0)),
            ..Default::default()
        };
        let conn = pool.get().unwrap();
        let n = write_diff(&conn, "p1", &existing, &input, Some("editor"), &now()).unwrap();
        assert_eq!(n, 2);
        let rows = list_for_persona(&pool, "p1", 10).unwrap();
        assert_eq!(rows.len(), 2);
        let fields: Vec<&str> = rows.iter().map(|r| r.field.as_str()).collect();
        assert!(fields.contains(&"name"));
        assert!(fields.contains(&"max_budget_usd"));
    }

    #[test]
    fn unchanged_fields_write_nothing() {
        let pool = test_pool();
        let existing = base_persona();
        // Provide the SAME name — no diff, no row.
        let input = UpdatePersonaInput {
            name: Some("Original".into()),
            ..Default::default()
        };
        let conn = pool.get().unwrap();
        let n = write_diff(&conn, "p1", &existing, &input, Some("editor"), &now()).unwrap();
        assert_eq!(n, 0);
        assert_eq!(list_for_persona(&pool, "p1", 10).unwrap().len(), 0);
    }

    #[test]
    fn secret_fields_are_redacted() {
        let pool = test_pool();
        let existing = base_persona();
        let input = UpdatePersonaInput {
            model_profile: Some(Some(
                r#"{"model":"claude-y","auth_token":"secret-xyz"}"#.into(),
            )),
            ..Default::default()
        };
        let conn = pool.get().unwrap();
        write_diff(&conn, "p1", &existing, &input, Some("editor"), &now()).unwrap();
        let rows = list_for_persona(&pool, "p1", 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].field, "model_profile");
        // Neither token may appear anywhere in the stored values.
        let blob = format!("{:?}{:?}", rows[0].before_value, rows[0].after_value);
        assert!(!blob.contains("secret-abc"), "old token leaked: {blob}");
        assert!(!blob.contains("secret-xyz"), "new token leaked: {blob}");
        assert_eq!(rows[0].after_value.as_deref(), Some("(changed)"));
    }

    #[test]
    fn coalesces_same_field_within_window() {
        let pool = test_pool();
        let existing = base_persona();
        let conn = pool.get().unwrap();
        // Two edits to name in quick succession, same source.
        write_diff(
            &conn,
            "p1",
            &existing,
            &UpdatePersonaInput { name: Some("First".into()), ..Default::default() },
            Some("editor"),
            &now(),
        )
        .unwrap();
        write_diff(
            &conn,
            "p1",
            &existing,
            &UpdatePersonaInput { name: Some("Second".into()), ..Default::default() },
            Some("editor"),
            &now(),
        )
        .unwrap();
        let rows = list_for_persona(&pool, "p1", 10).unwrap();
        assert_eq!(rows.len(), 1, "same-field edits should coalesce");
        // before keeps the true original; after reflects the latest.
        assert_eq!(rows[0].before_value.as_deref(), Some("Original"));
        assert_eq!(rows[0].after_value.as_deref(), Some("Second"));
    }

    #[test]
    fn retention_caps_history() {
        let pool = test_pool();
        let existing = base_persona();
        let conn = pool.get().unwrap();
        // Write RETAIN_PER_PERSONA + 5 distinct rows by toggling different
        // fields with non-coalescing timestamps (bump created_at each call).
        for i in 0..(RETAIN_PER_PERSONA + 5) {
            let ts = format!("2026-01-01T00:00:{:02}Z", i % 60);
            let ts = format!("{ts}-{i}"); // unique-ish sort key
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO persona_change_log (id, persona_id, field, before_value, after_value, source, created_at)
                 VALUES (?1, 'p1', 'name', 'a', 'b', 'editor', ?2)",
                params![id, ts],
            )
            .unwrap();
        }
        // Trigger a real write_diff to run the prune step.
        write_diff(
            &conn,
            "p1",
            &existing,
            &UpdatePersonaInput { name: Some("Trigger".into()), ..Default::default() },
            Some("editor"),
            &now(),
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_change_log WHERE persona_id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            count <= RETAIN_PER_PERSONA,
            "history should be capped at {RETAIN_PER_PERSONA}, got {count}"
        );
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }
}
