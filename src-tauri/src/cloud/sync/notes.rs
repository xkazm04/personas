//! Notepad notes (the Quest Log goals) -> `synced_notes` (PHASE2-SPEC 5.1).
//!
//! Pushed only while the operator's "Sync notes" opt-in is on
//! ([`settings_keys::CLOUD_SYNC_NOTES_ENABLED`], default off, M19).
//!
//! # A full-set replace, like the fleet queue
//!
//! A note delete is permanent and leaves no tombstone, and an archived note
//! leaves the synced set without being deleted. A cursor cannot express a row
//! leaving a set, so each push upserts the WHOLE non-archived set stamped with
//! the pass's own `synced_at`, then deletes this device's rows with an older
//! stamp. The set is small (the pad caps live notes at 10, plus finished and
//! shipped ones), and a push only happens when the projection changed: the
//! pass compares a fingerprint of the rows with the last one it pushed, so an
//! idle pad costs no request and no Realtime event on the web.
//!
//! # What leaves the machine
//!
//! Title, body (masked token by token, capped at 16 KB), status, order, where
//! it was dispatched, the `summary` of a run report, two counts from the
//! thread (open reviews, unread entries), the project's NAME, and the five
//! timestamps. Never: `dev_projects.root_path`, `fleet_session_id`,
//! `dispatch_key`, `agent_id`, `milestone_id`, the raw `result_json`, or any
//! thread body.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use serde::Serialize;

use super::redact::{project_text, NOTE_BODY_CAP, SHORT_TEXT_CAP};
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::error::AppError;

/// The cursor key of `synced_notes` in `SYNC_TABLES`. Its value is the stamp
/// of the last push; its PRESENCE also means "this device may have rows in
/// the cloud", which is what the opt-out purge keys on.
pub(super) const NOTES_CURSOR: &str = "notes";

/// Fingerprint of the last pushed projection (process memory). `None` after a
/// restart, so the first pass after a start pushes once.
static LAST_PUSHED: Mutex<Option<u64>> = Mutex::new(None);

/// Whether the operator opted into syncing notes. Default off (M19).
pub fn notes_enabled(pool: &DbPool) -> bool {
    settings::get_bool(pool, settings_keys::CLOUD_SYNC_NOTES_ENABLED, false)
}

/// One note as `synced_notes` holds it (column for column, snake_case).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SyncedNoteRow {
    pub id: String,
    pub device_id: String,
    pub project_name: Option<String>,
    pub title: String,
    pub body_md: String,
    pub status: String,
    pub order_index: i32,
    pub dispatch_target: Option<String>,
    pub result_summary: Option<String>,
    pub open_reviews: i64,
    pub unread_comments: i64,
    pub published_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// The pass stamp, written identically on every row of one push.
    pub synced_at: String,
}

/// A local timestamp as Postgres reads it unambiguously: RFC3339 in UTC with
/// `Z`. SQLite's `datetime('now')` form (`YYYY-MM-DD HH:MM:SS`, UTC, no zone)
/// is read as UTC; anything unparseable passes through unchanged.
pub(super) fn to_timestamptz(s: &str) -> String {
    use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return dt
            .with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::AutoSi, true);
    }
    for fmt in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(s, fmt) {
            return n.and_utc().to_rfc3339_opts(SecondsFormat::AutoSi, true);
        }
    }
    s.to_string()
}

/// The `summary` of a fleet run report (`{schema_version,status,summary,
/// artifacts[]}`), masked and capped. Nothing else of `result_json` leaves:
/// artifact paths are local paths, and an Athena dispatch's `{goal_ids}` means
/// nothing on a phone.
fn result_summary(result_json: Option<&str>) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(result_json?).ok()?;
    let summary = value.get("summary")?.as_str()?.trim();
    (!summary.is_empty()).then(|| project_text(summary, SHORT_TEXT_CAP))
}

/// Pending reviews per note (`kind = 'review' AND verdict = 'pending'`).
fn open_reviews(pool: &DbPool) -> Result<HashMap<String, i64>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT note_id, COUNT(*) FROM dev_note_comments \
         WHERE kind = 'review' AND verdict = 'pending' GROUP BY note_id",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<Result<HashMap<_, _>, _>>()?;
    Ok(rows)
}

/// Project names by id. The name only: `root_path` is a local filesystem path
/// and is never read here.
fn project_names(pool: &DbPool) -> Result<HashMap<String, String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT id, name FROM dev_projects")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<HashMap<_, _>, _>>()?;
    Ok(rows)
}

/// Project the whole non-archived set, `synced_at` left empty (the caller
/// fingerprints the rows first, then stamps them).
///
/// Reads through the pad's own repo reads (`list_notes`, `unread_counts`) so
/// a column added to a note cannot drift between the pad and this projection.
pub fn fetch_notes(pool: &DbPool, device_id: &str) -> Result<Vec<SyncedNoteRow>, AppError> {
    let notes = crate::db::repos::dev::notes::list_notes(pool, false)?;
    let reviews = open_reviews(pool)?;
    let unread: HashMap<String, i64> = crate::db::repos::dev::note_comments::unread_counts(pool)?
        .into_iter()
        .map(|u| (u.note_id, u.unread))
        .collect();
    let projects = project_names(pool)?;
    Ok(notes
        .into_iter()
        .filter(|n| n.status != crate::db::models::NoteStatus::Archived)
        .map(|n| SyncedNoteRow {
            project_name: n
                .project_id
                .as_deref()
                .and_then(|p| projects.get(p))
                .map(|name| project_text(name, SHORT_TEXT_CAP)),
            title: project_text(&n.title, SHORT_TEXT_CAP),
            body_md: project_text(&n.body_md, NOTE_BODY_CAP),
            status: n.status.as_str().to_string(),
            order_index: n.order_index,
            dispatch_target: n.dispatch_target.clone(),
            result_summary: result_summary(n.result_json.as_deref()),
            open_reviews: reviews.get(&n.id).copied().unwrap_or(0),
            unread_comments: unread.get(&n.id).copied().unwrap_or(0),
            published_at: n.published_at.as_deref().map(to_timestamptz),
            started_at: n.started_at.as_deref().map(to_timestamptz),
            completed_at: n.completed_at.as_deref().map(to_timestamptz),
            created_at: to_timestamptz(&n.created_at),
            updated_at: to_timestamptz(&n.updated_at),
            device_id: device_id.to_string(),
            synced_at: String::new(),
            id: n.id,
        })
        .collect())
}

/// Order-sensitive fingerprint of an unstamped projection.
fn fingerprint(rows: &[SyncedNoteRow]) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(rows).unwrap_or_default().hash(&mut h);
    h.finish()
}

/// What one notes pass should do, decided from local state alone.
#[derive(Debug, PartialEq)]
pub(super) enum NotesPlan {
    /// Opted out and nothing of ours is in the cloud: nothing to do.
    Idle,
    /// Opted out, but an earlier push left rows: delete this device's rows.
    Purge,
    /// Opted in, and the projection equals the last push: no request.
    Unchanged,
    /// Opted in and changed: push these rows (unstamped) with this fingerprint.
    Push(Vec<SyncedNoteRow>, u64),
}

pub(super) fn plan(pool: &DbPool, device_id: &str) -> Result<NotesPlan, AppError> {
    let pushed_before = super::cursor::peek_cursor(pool, NOTES_CURSOR).is_some();
    if !notes_enabled(pool) {
        return Ok(if pushed_before {
            NotesPlan::Purge
        } else {
            NotesPlan::Idle
        });
    }
    let rows = fetch_notes(pool, device_id)?;
    let fp = fingerprint(&rows);
    let same = *LAST_PUSHED.lock().unwrap_or_else(|p| p.into_inner()) == Some(fp);
    Ok(if same && pushed_before {
        NotesPlan::Unchanged
    } else {
        NotesPlan::Push(rows, fp)
    })
}

/// Record a successful push.
pub(super) fn remember_push(fp: u64) {
    *LAST_PUSHED.lock().unwrap_or_else(|p| p.into_inner()) = Some(fp);
}

/// Forget everything about earlier pushes (after a purge): the next opt-in
/// pushes from scratch.
pub(super) fn forget(pool: &DbPool) -> Result<(), AppError> {
    *LAST_PUSHED.lock().unwrap_or_else(|p| p.into_inner()) = None;
    let key = format!(
        "{}{}",
        settings_keys::CLOUD_SYNC_CURSOR_PREFIX,
        NOTES_CURSOR
    );
    settings::delete(pool, &key).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn set(pool: &DbPool, key: &str, value: &str) {
        settings::set(pool, key, value).unwrap();
    }

    fn note(pool: &DbPool, title: &str) -> String {
        crate::db::repos::dev::notes::create_note(pool, title, None)
            .unwrap()
            .id
    }

    #[test]
    fn timestamps_become_utc_rfc3339() {
        assert_eq!(
            to_timestamptz("2026-10-06T14:00:00+02:00"),
            "2026-10-06T12:00:00Z"
        );
        assert_eq!(
            to_timestamptz("2026-10-06 12:00:00"),
            "2026-10-06T12:00:00Z"
        );
        assert_eq!(to_timestamptz("not a time"), "not a time");
    }

    #[test]
    fn only_the_summary_of_a_run_report_leaves() {
        let report = r#"{"schema_version":1,"status":"ok","summary":"Shipped the fix","artifacts":["C:/repo/a.diff"]}"#;
        assert_eq!(
            result_summary(Some(report)).as_deref(),
            Some("Shipped the fix")
        );
        assert_eq!(result_summary(Some(r#"{"goal_ids":["g1"]}"#)), None);
        assert_eq!(result_summary(Some("not json")), None);
        assert_eq!(result_summary(None), None);
    }

    #[test]
    fn the_projection_masks_the_body_skips_archived_and_never_reads_root_path() {
        let pool = init_test_db().unwrap();
        let insert = |sql: &str| -> Result<usize, AppError> { Ok(pool.get()?.execute(sql, [])?) };
        insert(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p1', 'web', 'C:/secret/path/web')",
        )
        .unwrap();
        let id = note(&pool, "Ship notes");
        crate::db::repos::dev::notes::update_note(
            &pool,
            &id,
            None,
            Some("Use ghp_16C7e42F292c6912E7710c838347Ae178B4a for the push"), // gitleaks:allow
            Some(Some("p1")),
            None,
        )
        .unwrap();
        let archived = note(&pool, "Old idea");
        crate::db::repos::dev::notes::set_status(
            &pool,
            &archived,
            crate::db::models::NoteStatus::Archived,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let rows = fetch_notes(&pool, "dev-1").unwrap();
        assert_eq!(rows.len(), 1, "archived notes are not synced");
        let r = &rows[0];
        assert_eq!(r.title, "Ship notes");
        assert_eq!(r.body_md, "Use [redacted] for the push");
        assert_eq!(r.project_name.as_deref(), Some("web"));
        assert_eq!(r.status, "draft");
        assert_eq!(r.device_id, "dev-1");
        let json = serde_json::to_string(&rows).unwrap();
        assert!(
            !json.contains("C:/secret"),
            "root_path never leaves: {json}"
        );
    }

    #[test]
    fn the_body_is_capped_at_16_kb() {
        let pool = init_test_db().unwrap();
        let id = note(&pool, "Long");
        let body = "word ".repeat(10_000);
        crate::db::repos::dev::notes::update_note(&pool, &id, None, Some(&body), None, None)
            .unwrap();
        let rows = fetch_notes(&pool, "d").unwrap();
        assert!(rows[0].body_md.len() <= NOTE_BODY_CAP);
        assert!(rows[0]
            .body_md
            .ends_with(super::super::redact::TRUNCATION_MARKER));
    }

    #[test]
    fn the_plan_follows_the_opt_in_and_purges_after_an_opt_out() {
        let pool = init_test_db().unwrap();
        forget(&pool).unwrap();
        note(&pool, "A goal");
        // Default off, nothing pushed yet: idle.
        assert_eq!(plan(&pool, "d").unwrap(), NotesPlan::Idle);

        set(&pool, settings_keys::CLOUD_SYNC_NOTES_ENABLED, "true");
        let NotesPlan::Push(rows, fp) = plan(&pool, "d").unwrap() else {
            panic!("an opted-in pass with notes pushes");
        };
        assert_eq!(rows.len(), 1);
        // The pass records the push (cursor + fingerprint).
        super::super::cursor::set_cursor(&pool, NOTES_CURSOR, "2026-10-06T12:00:00.000Z").unwrap();
        remember_push(fp);
        assert_eq!(plan(&pool, "d").unwrap(), NotesPlan::Unchanged);

        note(&pool, "Another goal");
        assert!(matches!(plan(&pool, "d").unwrap(), NotesPlan::Push(r, _) if r.len() == 2));

        set(&pool, settings_keys::CLOUD_SYNC_NOTES_ENABLED, "false");
        assert_eq!(plan(&pool, "d").unwrap(), NotesPlan::Purge);
        forget(&pool).unwrap();
        assert_eq!(plan(&pool, "d").unwrap(), NotesPlan::Idle);
    }
}
