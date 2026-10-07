//! Desktop → cloud sync writer (Phase 1a, v2).
//!
//! Periodically (and on local-mutation nudges) pushes a read-projection of the
//! local SQLite data up to the user's own Supabase tenant, scoped server-side
//! by Row-Level Security on `auth.uid()`. Execution and the credential vault
//! never leave the device — only the secret-free projections in `rows` are sent.
//!
//! ## v2 — fault-isolated passes
//!
//! A pass syncs each table independently. A single table's failure (a transient
//! network blip, a schema drift on one table) no longer aborts the whole pass or
//! strands the *other* tables' cursors — every healthy table still advances and
//! its rows still land. The per-table outcome (rows + error + last-synced) is
//! surfaced through [`CloudSyncStatus`] so the Settings panel can show exactly
//! what synced and what didn't.

pub(crate) mod athena_chat;
pub mod client;
pub(crate) mod cursor;
pub(crate) mod notes;
pub(crate) mod persona_chat;
pub(crate) mod redact;
mod rows;

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use tokio::sync::{Mutex, Notify};
use ts_rs::TS;

use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;
use crate::AppState;
use client::SyncClient;

/// Woken by `notify_dirty()` (fired from the CDC drain on local mutations) so
/// the loop can sync promptly instead of waiting for the next periodic tick.
static SYNC_WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);

/// Persistent "local data changed since the last pass started" flag. `Notify`
/// alone is lossy here: its single permit can be consumed by the `notified()`
/// future that `tokio::select!` drops when the periodic tick wins the same
/// poll, and a mutation that lands mid-pass (after its table was already read)
/// has nothing durable to force a follow-up. The loop clears this BEFORE each
/// pass and re-wakes itself if it's set again afterward, so no wake is lost.
static SYNC_DIRTY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// In-memory status surfaced by `cloud_sync_status`.
static RUNTIME: LazyLock<Mutex<RuntimeState>> =
    LazyLock::new(|| Mutex::new(RuntimeState::default()));

/// Canonical list of synced tables — the single source of truth for both the
/// pass (below) and the status enumeration. Tuple = `(remote table, cursor key,
/// full_backfill, resync_recent_window)`.
///
/// `full_backfill`: first run starts at the epoch (sync the whole table) vs 90
/// days back (bound the first push for append-heavy logs).
/// `resync`: also re-read rows whose `created_at` is within the last 24h, to
/// capture in-place mutations (status/read-flag transitions) on append tables.
const SYNC_TABLES: &[(&str, &str, bool, bool)] = &[
    ("synced_personas", "personas", true, false),
    ("synced_executions", "executions", false, true),
    ("synced_events", "events", false, true),
    ("synced_manual_reviews", "reviews", false, false),
    ("synced_messages", "messages", false, true),
    ("synced_metrics_snapshots", "metrics", false, true),
    ("synced_tool_usage", "tool_usage", false, false),
    ("synced_memories", "memories", true, false),
    (
        "synced_knowledge_patterns",
        "knowledge_patterns",
        true,
        false,
    ),
    ("synced_healing_issues", "healing_issues", false, true),
    ("synced_triggers", "triggers", true, false),
    // The twelfth table, and the only one that is NOT cursor-synced. Its two
    // flags are therefore inert: the pass reads the WHOLE queue every time and
    // reconciles by deleting what it did not just write. The entry is here so
    // the Settings grid shows the queue beside the other eleven and so the
    // cursor key cannot collide; see `sync_fleet_queue` and the long comment
    // over `rows::fetch_fleet_queue` for why a cursor cannot express a row
    // LEAVING a set. `full_backfill = true` keeps `get_cursor`'s unused
    // fallback at the epoch rather than 90 days back, so nothing reads as a
    // bounded first push that is not one.
    ("synced_fleet_queue", "fleet_queue", true, false),
    // The thirteenth: Notepad notes, a full-set replace like the queue (its
    // flags are inert for the same reason) and only behind the "Sync notes"
    // opt-in. See `notes`.
    ("synced_notes", notes::NOTES_CURSOR, true, false),
    // The fourteenth and fifteenth: Athena's threads and turns, behind the
    // "Sync chats" opt-in. Not cursor-synced through `sync_table` either: the
    // per-thread ledger in `athena_chat` keeps its own keyset cursors (and
    // its own 90-day floor), so these flags are inert too and the cursors
    // here only feed the status grid.
    (
        "synced_chat_sessions",
        athena_chat::SESSIONS_CURSOR,
        true,
        false,
    ),
    (
        "synced_chat_messages",
        athena_chat::MESSAGES_CURSOR,
        true,
        false,
    ),
    // The sixteenth and seventeenth: persona chats, into the SAME two tables
    // (thread_kind = 'persona'), behind the same "Sync chats" opt-in. Real
    // cursors this time (sessions on updated_at, messages on created_at, 90
    // days back on the first push), read by `persona_chat` itself because it
    // compares them with julianday. The status grid folds them into the two
    // rows above (see `grid`).
    (
        "synced_chat_sessions",
        persona_chat::SESSIONS_CURSOR,
        false,
        false,
    ),
    (
        "synced_chat_messages",
        persona_chat::MESSAGES_CURSOR,
        false,
        false,
    ),
];

/// Last-pass result for one table, retained in memory for the status surface.
#[derive(Debug, Clone, Default)]
struct LastTable {
    remote: String,
    rows: u64,
    error: Option<String>,
}

#[derive(Default, Clone)]
struct RuntimeState {
    syncing: bool,
    last_error: Option<String>,
    rows_synced_last: u64,
    /// Per-table rows + error from the most recent pass, keyed by remote name.
    tables: Vec<LastTable>,
}

/// Per-table status surfaced to the UI.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TableSyncStatus {
    /// Remote table name, e.g. `synced_executions`.
    pub table: String,
    /// Rows pushed for this table in the most recent pass.
    pub rows_last: u64,
    /// RFC3339 cursor watermark — the table's last successful sync, or null if
    /// it has never synced.
    pub last_synced_at: Option<String>,
    /// Error from the most recent pass for this table, if it failed.
    pub error: Option<String>,
}

/// Cloud-sync status surfaced by `cloud_sync_status` / returned by `cloud_sync_now`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncStatus {
    pub enabled: bool,
    /// True while a pass is in flight (drives the "syncing…" UI state).
    pub syncing: bool,
    /// This device's stable sync id, or null before the first pass.
    pub device_id: Option<String>,
    /// The operator-set name the heartbeat sends, or null for the platform
    /// label.
    pub device_name: Option<String>,
    /// RFC3339 time of the last fully-successful pass.
    pub last_sync_at: Option<String>,
    /// First error from the most recent pass (null when the last pass was clean).
    pub last_error: Option<String>,
    /// Rows pushed in the most recent pass (across all tables).
    pub rows_synced_last: u64,
    /// Lifetime rows pushed across all passes (persisted, monotonic).
    pub total_rows_synced: u64,
    /// Per-table breakdown for the most recent pass + cursor watermarks.
    pub tables: Vec<TableSyncStatus>,
    /// The "Sync notes" opt-in (default off).
    pub sync_notes: bool,
    /// The "Sync chats" opt-in (default off).
    pub sync_chats: bool,
}

/// Internal result of one pass — drives both the persisted counters and the
/// in-memory status snapshot.
struct SyncReport {
    tables: Vec<LastTable>,
    total: u64,
}

impl SyncReport {
    fn is_clean(&self) -> bool {
        self.tables.iter().all(|t| t.error.is_none())
    }
    fn first_error(&self) -> Option<String> {
        self.tables.iter().find_map(|t| t.error.clone())
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Mirror of the "Sync notes" opt-in, so the CDC hook (which has no pool) can
/// skip waking the loop for a note edit nobody is syncing. Refreshed at every
/// pass and by [`set_data_class`]; a stale `false` only costs an edit its
/// prompt push, never the push itself (the periodic tick still runs).
static NOTES_SYNC_ON: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The notes-only debounce: `(first nudge, due)` while a wake is pending.
static NOTES_DUE: std::sync::Mutex<Option<(Instant, Instant)>> = std::sync::Mutex::new(None);

/// Quiet time after the last note edit before the pass runs. The pad saves
/// 500 ms after typing stops, so the plain 2 s debounce would run a pass every
/// few seconds of a typing session (PHASE2-SPEC 5.1).
const NOTES_DEBOUNCE: Duration = Duration::from_secs(10);

/// A typing session that never pauses still syncs this often.
const NOTES_MAX_WAIT: Duration = Duration::from_secs(60);

/// When the notes wake is due, given the pending window (if any). Pure, so
/// the trailing-debounce arithmetic is tested.
fn notes_due(pending: Option<(Instant, Instant)>, now: Instant) -> (Instant, Instant) {
    let first = pending.map_or(now, |(first, _)| first);
    (first, (now + NOTES_DEBOUNCE).min(first + NOTES_MAX_WAIT))
}

/// Wakes the loop to re-read [`NOTES_DUE`] (without running a pass).
static NOTES_WAKE: LazyLock<Notify> = LazyLock::new(Notify::new);

/// A note or a note-thread entry changed (CDC on `dev_notes` /
/// `dev_note_comments`). Schedules a pass [`NOTES_DEBOUNCE`] after the LAST
/// such change (at most [`NOTES_MAX_WAIT`] after the first), and only while
/// "Sync notes" is on. The sync loop owns the timer, so no task is spawned.
pub fn notify_notes_dirty() {
    if !NOTES_SYNC_ON.load(std::sync::atomic::Ordering::Acquire) {
        return;
    }
    {
        let mut g = NOTES_DUE.lock().unwrap_or_else(|p| p.into_inner());
        *g = Some(notes_due(*g, Instant::now()));
    }
    NOTES_WAKE.notify_one();
}

/// The pending notes deadline, if any.
fn notes_deadline() -> Option<Instant> {
    NOTES_DUE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .map(|(_, due)| due)
}

/// Resolve at `due`, or never.
async fn until(due: Option<Instant>) {
    match due {
        Some(due) => tokio::time::sleep_until(tokio::time::Instant::from_std(due)).await,
        None => std::future::pending::<()>().await,
    }
}

/// The per-class opt-ins of PHASE2-SPEC 5 (owner decision M19).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum SyncDataClass {
    /// Notepad notes -> `synced_notes`.
    Notes,
    /// Athena's conversations and persona chats -> `synced_chat_*` (and a
    /// paired phone's `chat_send`, to Athena or to a persona).
    Chats,
}

/// Turn one data class on or off. Off is honoured by the next pass, which
/// deletes this device's rows of that class; the loop is woken either way so
/// that happens within seconds.
pub fn set_data_class(pool: &DbPool, class: SyncDataClass, enabled: bool) -> Result<(), AppError> {
    let key = match class {
        SyncDataClass::Notes => crate::db::settings_keys::CLOUD_SYNC_NOTES_ENABLED,
        SyncDataClass::Chats => crate::db::settings_keys::CLOUD_SYNC_CHATS_ENABLED,
    };
    crate::db::repos::core::settings::set(pool, key, if enabled { "true" } else { "false" })?;
    if class == SyncDataClass::Notes {
        NOTES_SYNC_ON.store(enabled, std::sync::atomic::Ordering::Release);
    }
    notify_dirty();
    Ok(())
}

/// Signal that local data changed; the sync loop debounces and pushes.
pub fn notify_dirty() {
    // Set the durable flag first, then wake — so even if the wake permit is
    // lost to a select!-drop, the loop still observes the dirty flag.
    SYNC_DIRTY.store(true, std::sync::atomic::Ordering::Release);
    SYNC_WAKE.notify_one();
}

/// Toggle cloud sync. Enabling also kicks an immediate sync.
pub fn set_enabled(pool: &DbPool, enabled: bool) -> Result<(), AppError> {
    cursor::set_enabled(pool, enabled)?;
    if enabled {
        notify_dirty();
    }
    Ok(())
}

/// Current sync status: persisted facts (enabled, device, last-at, lifetime
/// total, per-table cursors) merged with the in-memory last-pass snapshot
/// (syncing flag, per-table rows/errors).
pub async fn status(pool: &DbPool) -> CloudSyncStatus {
    let rt = RUNTIME.lock().await.clone();
    let tables = grid(&rt.tables, |key| cursor::peek_cursor(pool, key));

    CloudSyncStatus {
        enabled: cursor::is_enabled(pool),
        syncing: rt.syncing,
        device_id: cursor::peek_device_id(pool),
        device_name: cursor::get_device_name(pool),
        last_sync_at: cursor::get_last_at(pool),
        last_error: rt.last_error,
        rows_synced_last: rt.rows_synced_last,
        total_rows_synced: cursor::get_total_rows(pool),
        tables,
        sync_notes: notes::notes_enabled(pool),
        sync_chats: athena_chat::chats_enabled(pool),
    }
}

/// The status grid: ONE row per remote table, in `SYNC_TABLES` order. Two
/// writers share `synced_chat_sessions` and `synced_chat_messages` (Athena's
/// threads and persona chats), so their pass results are summed, the first
/// error is shown, and "last synced" is the newer of their watermarks.
fn grid(last: &[LastTable], peek: impl Fn(&str) -> Option<String>) -> Vec<TableSyncStatus> {
    let mut out: Vec<TableSyncStatus> = Vec::new();
    for (remote, cursor_key, _, _) in SYNC_TABLES {
        let watermark = peek(cursor_key);
        if let Some(row) = out.iter_mut().find(|r| r.table == *remote) {
            row.last_synced_at = newer(row.last_synced_at.take(), watermark);
            continue;
        }
        let mine = || last.iter().filter(|t| t.remote == *remote);
        out.push(TableSyncStatus {
            table: (*remote).to_string(),
            rows_last: mine().map(|t| t.rows).sum(),
            last_synced_at: watermark,
            error: mine().find_map(|t| t.error.clone()),
        });
    }
    out
}

/// The later of two watermarks, compared as times (they are written in more
/// than one format), keeping the text of the winner.
fn newer(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a, b) {
        (Some(a), Some(b)) => {
            let at = chrono::DateTime::parse_from_rfc3339(&notes::to_timestamptz(&a)).ok();
            let bt = chrono::DateTime::parse_from_rfc3339(&notes::to_timestamptz(&b)).ok();
            Some(if bt > at { b } else { a })
        }
        (a, b) => a.or(b),
    }
}

/// Sync one table: read rows changed since the cursor, upsert them, advance the
/// cursor on success. Captures its own failure into the returned [`LastTable`]
/// rather than propagating — so one table's error can't abort the pass.
// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
async fn sync_table<T, F>(
    pool: &DbPool,
    client: &SyncClient,
    remote_table: &str,
    cursor_name: &str,
    full_backfill: bool,
    resync: bool,
    device_id: &str,
    fetch: F,
) -> LastTable
where
    T: Serialize + Send + 'static,
    F: Fn(&DbPool, String, Option<String>, String) -> Result<(Vec<T>, Option<String>), AppError>
        + Send
        + 'static,
{
    match sync_table_inner(
        pool,
        client,
        remote_table,
        cursor_name,
        full_backfill,
        resync,
        device_id,
        fetch,
    )
    .await
    {
        Ok(rows) => LastTable {
            remote: remote_table.to_string(),
            rows,
            error: None,
        },
        Err(e) => {
            tracing::warn!(table = remote_table, error = %e, "cloud sync: table failed (isolated)");
            LastTable {
                remote: remote_table.to_string(),
                rows: 0,
                error: Some(e.to_string()),
            }
        }
    }
}

// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
async fn sync_table_inner<T, F>(
    pool: &DbPool,
    client: &SyncClient,
    remote_table: &str,
    cursor_name: &str,
    full_backfill: bool,
    resync: bool,
    device_id: &str,
    fetch: F,
) -> Result<u64, AppError>
where
    T: Serialize + Send + 'static,
    F: Fn(&DbPool, String, Option<String>, String) -> Result<(Vec<T>, Option<String>), AppError>
        + Send
        + 'static,
{
    let cursor_prev = cursor::get_cursor(pool, cursor_name, full_backfill);
    let resync_floor = if resync {
        Some((chrono::Utc::now() - chrono::Duration::hours(24)).to_rfc3339())
    } else {
        None
    };

    let pool_c = pool.clone();
    let device = device_id.to_string();
    // Keep a copy for the cursor fallback; the closure moves its own.
    let cursor_prev_fallback = cursor_prev.clone();
    let (rows, observed_max) =
        tokio::task::spawn_blocking(move || fetch(&pool_c, cursor_prev, resync_floor, device))
            .await
            .map_err(|e| AppError::Internal(format!("cloud sync fetch join: {e}")))??;

    let n = rows.len() as u64;
    client.upsert(remote_table, &rows).await?;
    // Advance the cursor to the MAX watermark value actually present in the rows
    // we just synced, or leave it unchanged if none. Previously this set the
    // cursor to wall-clock `now()` captured at pass start, which moved it past
    // any row committed to SQLite after the SELECT's read snapshot but stamped
    // before that instant — permanently excluding it from every later pass
    // (`get_recent_after`/the changed-since filter only return rows newer than
    // the cursor). The observed max can never be ahead of a row this pass didn't
    // read. The read filter wraps both sides in datetime(), so the stored value's
    // exact format doesn't affect future comparisons.
    let new_cursor = observed_max.unwrap_or(cursor_prev_fallback);
    cursor::set_cursor(pool, cursor_name, &new_cursor)?;
    Ok(n)
}

/// Collect every table's outcome for one pass. Device heartbeat first so the
/// dashboard always knows this device exists; then each Phase-1 table, fault
/// isolated. The heartbeat's outcome influences `is_clean()`/`last_error` but is
/// not shown as a per-table grid row (it has no cursor).
async fn collect_pass(
    pool: &DbPool,
    user_db: &UserDbPool,
    client: &SyncClient,
    device_id: &str,
) -> SyncReport {
    let mut tables: Vec<LastTable> = Vec::with_capacity(SYNC_TABLES.len() + 1);

    // Device heartbeat (own outcome, kept out of the displayed grid).
    let dev = rows::device_row(device_id, cursor::get_device_name(pool));
    let heartbeat = match client
        .upsert("synced_devices", std::slice::from_ref(&dev))
        .await
    {
        Ok(()) => LastTable {
            remote: "synced_devices".into(),
            rows: 1,
            error: None,
        },
        Err(e) => {
            tracing::warn!(error = %e, "cloud sync: device heartbeat failed");
            LastTable {
                remote: "synced_devices".into(),
                rows: 0,
                error: Some(e.to_string()),
            }
        }
    };
    tables.push(heartbeat);

    // Each Phase-1 table, in SYNC_TABLES order. Typed fetch fns can't live in a
    // homogeneous list, so the dispatch is explicit — but the (remote, cursor,
    // backfill, resync) tuples are read from SYNC_TABLES so they can't drift.
    macro_rules! sync {
        ($idx:expr, $fetch:expr) => {{
            let (remote, cursor_key, bf, rs) = SYNC_TABLES[$idx];
            sync_table(pool, client, remote, cursor_key, bf, rs, device_id, $fetch).await
        }};
    }
    tables.push(sync!(0, rows::fetch_personas));
    tables.push(sync!(1, rows::fetch_executions));
    tables.push(sync!(2, rows::fetch_events));
    tables.push(sync!(3, rows::fetch_reviews));
    tables.push(sync!(4, rows::fetch_messages));
    tables.push(sync!(5, rows::fetch_metrics));
    tables.push(sync!(6, rows::fetch_tool_usage));
    tables.push(sync!(7, rows::fetch_memories));
    tables.push(sync!(8, rows::fetch_knowledge_patterns));
    tables.push(sync!(9, rows::fetch_healing_issues));
    tables.push(sync!(10, rows::fetch_triggers));

    // The queue (index 11) does not go through `sync!`: it is a full-set
    // replace with a reconcile delete, not a cursor read. Fault-isolated the
    // same way - it returns its own LastTable and never propagates.
    tables.push(sync_fleet_queue(pool, client, device_id).await);

    // Notes (index 12) and Athena's chats (13, 14): opt-in classes, each
    // fault-isolated like a table. Off with rows in the cloud = purge.
    tables.push(sync_notes(pool, client, device_id).await);
    tables.extend(sync_athena_chat(pool, user_db, client, device_id).await);
    // Persona chats (15, 16): the same two tables, thread_kind = 'persona'.
    tables.extend(sync_persona_chat(pool, client, device_id).await);

    // Delete propagation (v2): mirror local persona deletions into the cloud.
    // Kept out of the displayed grid (it has no upsert cursor of its own row),
    // but its outcome still influences is_clean()/last_error.
    tables.push(process_tombstones(pool, client).await);

    // "Rows synced" counts upserted data rows — not the heartbeat or deletes.
    let total = tables
        .iter()
        .filter(|t| t.remote != "synced_devices" && t.remote != "deletes")
        .map(|t| t.rows)
        .sum();
    SyncReport { tables, total }
}

/// Sync the fleet dispatch queue: a full-set replace.
///
/// Unlike the eleven cursor-synced tables this pushes the ENTIRE queue every
/// pass and then deletes this device's rows the pass did not write, which is
/// the only shape that can express a row *leaving* the queue (promoted,
/// cancelled, expired). `rows::fetch_fleet_queue`'s module comment carries the
/// derivation and the staleness window.
///
/// The reconcile delete keys on `synced_at`, not on a list of session ids. An
/// id list would have to be interpolated into a PostgREST `not.in.(...)`
/// filter, and `remote_commands::validate_command_id` exists precisely because
/// unvalidated interpolation into a PostgREST path lets a value widen the
/// WHERE clause. The stamp is a value this function minted; the device id is
/// one `cursor::resolve_device_id` minted. Neither comes from outside.
///
/// Order is upsert-then-delete, so a crash between them leaves the remote with
/// a superset carrying honest `synced_at` stamps, never a gap.
///
/// The cursor is written for the status grid's "last synced" column ONLY - it
/// is never read back as a watermark, because this table has none. It is set
/// to the pass stamp, and only on success.
async fn sync_fleet_queue(pool: &DbPool, client: &SyncClient, device_id: &str) -> LastTable {
    let (remote, cursor_key, _, _) = SYNC_TABLES[11];
    match sync_fleet_queue_inner(pool, client, remote, cursor_key, device_id).await {
        Ok(rows) => LastTable {
            remote: remote.to_string(),
            rows,
            error: None,
        },
        Err(e) => {
            tracing::warn!(table = remote, error = %e, "cloud sync: queue failed (isolated)");
            LastTable {
                remote: remote.to_string(),
                rows: 0,
                error: Some(e.to_string()),
            }
        }
    }
}

/// The queue pass's stamp. **`Z`, not `+00:00`, and that is load-bearing.**
/// This value is the only timestamp in this module that is interpolated into a
/// URL rather than a JSON body, and `chrono`'s default `to_rfc3339()` renders
/// the offset as `+00:00`. A literal `+` in a query string decodes to a SPACE,
/// so the reconcile filter below would compare against a malformed timestamp -
/// and a `synced_at=lt.<garbage>` either errors or, worse, matches nothing and
/// leaves every superseded row in place while the pass reports success.
fn queue_stamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

async fn sync_fleet_queue_inner(
    pool: &DbPool,
    client: &SyncClient,
    remote: &str,
    cursor_key: &str,
    device_id: &str,
) -> Result<u64, AppError> {
    let stamp = queue_stamp();
    let pool_c = pool.clone();
    let device = device_id.to_string();
    let stamp_c = stamp.clone();
    let rows =
        tokio::task::spawn_blocking(move || rows::fetch_fleet_queue(&pool_c, &device, &stamp_c))
            .await
            .map_err(|e| AppError::Internal(format!("cloud sync queue fetch join: {e}")))??;

    let n = rows.len() as u64;
    client.upsert(remote, &rows).await?;
    // Everything this device had queued that the pass above did not re-write
    // is no longer queued. Idempotent, and a no-op on the very first pass.
    client
        .delete(&format!(
            "{remote}?device_id=eq.{device_id}&synced_at=lt.{stamp}"
        ))
        .await?;
    cursor::set_cursor(pool, cursor_key, &stamp)?;
    Ok(n)
}

/// Sync the Notepad notes: a full-set replace when the projection changed, a
/// purge after an opt-out, nothing otherwise. See `notes`.
async fn sync_notes(pool: &DbPool, client: &SyncClient, device_id: &str) -> LastTable {
    let (remote, cursor_key, _, _) = SYNC_TABLES[12];
    NOTES_SYNC_ON.store(
        notes::notes_enabled(pool),
        std::sync::atomic::Ordering::Release,
    );
    match sync_notes_inner(pool, client, remote, cursor_key, device_id).await {
        Ok(rows) => LastTable {
            remote: remote.to_string(),
            rows,
            error: None,
        },
        Err(e) => {
            tracing::warn!(table = remote, error = %e, "cloud sync: notes failed (isolated)");
            LastTable {
                remote: remote.to_string(),
                rows: 0,
                error: Some(e.to_string()),
            }
        }
    }
}

async fn sync_notes_inner(
    pool: &DbPool,
    client: &SyncClient,
    remote: &str,
    cursor_key: &str,
    device_id: &str,
) -> Result<u64, AppError> {
    let pool_c = pool.clone();
    let device = device_id.to_string();
    let plan = tokio::task::spawn_blocking(move || notes::plan(&pool_c, &device))
        .await
        .map_err(|e| AppError::Internal(format!("cloud sync notes join: {e}")))??;
    match plan {
        notes::NotesPlan::Idle | notes::NotesPlan::Unchanged => Ok(0),
        notes::NotesPlan::Purge => {
            client
                .delete(&format!("{remote}?device_id=eq.{device_id}"))
                .await?;
            notes::forget(pool)?;
            Ok(0)
        }
        notes::NotesPlan::Push(mut rows, fp) => {
            // The same URL-safe stamp the queue uses: it goes into the
            // reconcile filter below.
            let stamp = queue_stamp();
            for r in &mut rows {
                r.synced_at = stamp.clone();
            }
            let n = rows.len() as u64;
            client.upsert(remote, &rows).await?;
            client
                .delete(&format!(
                    "{remote}?device_id=eq.{device_id}&synced_at=lt.{stamp}"
                ))
                .await?;
            cursor::set_cursor(pool, cursor_key, &stamp)?;
            notes::remember_push(fp);
            Ok(n)
        }
    }
}

/// Sync Athena's conversations: two status rows (sessions, messages) from one
/// ledger walk. See `athena_chat`.
async fn sync_athena_chat(
    pool: &DbPool,
    user_db: &UserDbPool,
    client: &SyncClient,
    device_id: &str,
) -> [LastTable; 2] {
    let (sessions_remote, sessions_key, _, _) = SYNC_TABLES[13];
    let (messages_remote, messages_key, _, _) = SYNC_TABLES[14];
    let cloud = athena_chat::PostgrestChat {
        client,
        device_id: device_id.to_string(),
    };
    match athena_chat::run_pass(pool, user_db, &cloud, device_id).await {
        Ok(report) => {
            if athena_chat::chats_enabled(pool) {
                // Status-grid cursors only (the ledger is the real watermark
                // and is saved inside the pass); a failed write is logged.
                let stamp = now_rfc3339();
                for key in [sessions_key, messages_key] {
                    if let Err(e) = cursor::set_cursor(pool, key, &stamp) {
                        tracing::warn!(cursor = key, error = %e, "cloud sync: chat status cursor not saved");
                    }
                }
            }
            if report.more {
                // The pass budget ran out: drain the rest promptly.
                notify_dirty();
            }
            [
                LastTable {
                    remote: sessions_remote.to_string(),
                    rows: report.sessions,
                    error: None,
                },
                LastTable {
                    remote: messages_remote.to_string(),
                    rows: report.messages,
                    error: None,
                },
            ]
        }
        Err(e) => {
            tracing::warn!(error = %e, "cloud sync: Athena chat failed (isolated)");
            let error = Some(e.to_string());
            [
                LastTable {
                    remote: sessions_remote.to_string(),
                    rows: 0,
                    error: error.clone(),
                },
                LastTable {
                    remote: messages_remote.to_string(),
                    rows: 0,
                    error,
                },
            ]
        }
    }
}

/// Sync the persona chats: two status rows (sessions, messages) from one
/// pass, with the session deletions processed in it. See `persona_chat`.
async fn sync_persona_chat(pool: &DbPool, client: &SyncClient, device_id: &str) -> [LastTable; 2] {
    let (sessions_remote, _, _, _) = SYNC_TABLES[15];
    let (messages_remote, _, _, _) = SYNC_TABLES[16];
    let cloud = persona_chat::PostgrestPersonaChat {
        client,
        device_id: device_id.to_string(),
    };
    let (sessions, messages, error) = match persona_chat::run_pass(pool, &cloud, device_id).await {
        Ok(report) => {
            if report.more {
                // A full page: drain the rest promptly.
                notify_dirty();
            }
            (report.sessions, report.messages, None)
        }
        Err(e) => {
            tracing::warn!(error = %e, "cloud sync: persona chat failed (isolated)");
            (0, 0, Some(e.to_string()))
        }
    };
    [
        LastTable {
            remote: sessions_remote.to_string(),
            rows: sessions,
            error: error.clone(),
        },
        LastTable {
            remote: messages_remote.to_string(),
            rows: messages,
            error,
        },
    ]
}

/// Synced child tables keyed by `persona_id` (mirror of the local
/// `ON DELETE CASCADE` from `personas`). The chat tables also hold Athena's
/// rows, under the sentinel `persona_id = 'athena'`, which no persona id (a
/// UUID) can equal, so a persona's delete never reaches them.
const PERSONA_SCOPED_TABLES: &[&str] = &[
    "synced_executions",
    "synced_manual_reviews",
    "synced_messages",
    "synced_metrics_snapshots",
    "synced_tool_usage",
    "synced_memories",
    "synced_knowledge_patterns",
    // Messages before sessions, as everywhere else in the chat projection.
    "synced_chat_messages",
    "synced_chat_sessions",
];

/// Delete every cloud row belonging to a deleted persona, mirroring the local
/// cascade. RLS scopes each delete to this user. Personas row deleted last so a
/// mid-cascade failure leaves the persona present (and thus retried next pass)
/// rather than orphaning its children.
async fn delete_persona_cascade(client: &SyncClient, persona_id: &str) -> Result<(), AppError> {
    for table in PERSONA_SCOPED_TABLES {
        client
            .delete(&format!("{table}?persona_id=eq.{persona_id}"))
            .await?;
    }
    // Events reference the persona via target_persona_id, not persona_id.
    client
        .delete(&format!("synced_events?target_persona_id=eq.{persona_id}"))
        .await?;
    client
        .delete(&format!("synced_personas?id=eq.{persona_id}"))
        .await?;
    Ok(())
}

/// Process persona tombstones since the cursor: cascade-delete each in the
/// cloud, then advance the cursor only if all deletes succeeded (so a failure
/// is retried next pass). Fault-isolated like a table — returns its outcome.
async fn process_tombstones(pool: &DbPool, client: &SyncClient) -> LastTable {
    let cursor_prev = cursor::get_cursor(pool, "tombstones", false);
    let tick_start = now_rfc3339();
    let tombstones = match rows::fetch_tombstones(pool, &cursor_prev) {
        Ok(t) => t,
        Err(e) => {
            return LastTable {
                remote: "deletes".into(),
                rows: 0,
                error: Some(e.to_string()),
            };
        }
    };

    let mut deleted: u64 = 0;
    for tomb in &tombstones {
        if let Err(e) = delete_persona_cascade(client, &tomb.persona_id).await {
            tracing::warn!(persona_id = %tomb.persona_id, error = %e, "cloud sync: delete propagation failed");
            // Don't advance the cursor — the failed (and any later) tombstone
            // is reprocessed next pass. Deletes are idempotent.
            return LastTable {
                remote: "deletes".into(),
                rows: deleted,
                error: Some(e.to_string()),
            };
        }
        deleted += 1;
    }

    let _ = cursor::set_cursor(pool, "tombstones", &tick_start);
    LastTable {
        remote: "deletes".into(),
        rows: deleted,
        error: None,
    }
}

/// Run one full sync pass. No-op when sync is disabled or no Supabase JWT is
/// available — both are "nothing to do", not errors. Persists the lifetime
/// total, advances `last_sync_at` only on a fully-clean pass, and writes the
/// in-memory status snapshot (including the `syncing` flag). Per-table failures
/// are logged inside `sync_table` and surfaced via `status()`.
pub async fn run_sync_once(state: &Arc<AppState>) {
    let pool = state.db.clone();
    if !cursor::is_enabled(&pool) {
        return;
    }

    let jwt = {
        let auth = state.auth.read().await;
        match auth.access_token.as_ref() {
            Some(s) => s.expose_secret().to_string(),
            None => return,
        }
    };

    // Flip the syncing flag so a concurrent status() call reflects the in-flight
    // pass. Reset on every exit path below.
    RUNTIME.lock().await.syncing = true;

    let report = match SyncClient::new(jwt) {
        Ok(client) => {
            let device_id = cursor::resolve_device_id(&pool);
            collect_pass(&pool, &state.user_db, &client, &device_id).await
        }
        Err(e) => SyncReport {
            tables: vec![LastTable {
                remote: "client".into(),
                rows: 0,
                error: Some(e.to_string()),
            }],
            total: 0,
        },
    };

    // Persist: lifetime total always; last-at only on a clean pass.
    let _ = cursor::add_total_rows(&pool, report.total);
    if report.is_clean() {
        let _ = cursor::set_last_at(&pool, &now_rfc3339());
    }

    let mut rt = RUNTIME.lock().await;
    rt.syncing = false;
    rt.rows_synced_last = report.total;
    rt.last_error = report.first_error();
    rt.tables = report.tables;
}

/// Spawn the background sync loop: a ~45s periodic tick plus event-driven wakes
/// from `notify_dirty()` (debounced 2s to coalesce bursts). Leader-gated so a
/// multi-instance checkout doesn't double-push.
pub fn spawn_sync_loop(_app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(45));
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = SYNC_WAKE.notified() => {
                    // Coalesce a burst of mutations into one pass.
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                // A note edit moved the notes deadline: re-read it.
                _ = NOTES_WAKE.notified() => continue,
                // The notes deadline passed: run the pass below.
                _ = until(notes_deadline()) => {}
            }

            if !state.leadership.is_leader() || !cursor::is_enabled(&state.db) {
                continue;
            }

            // Clear the dirty flag BEFORE the pass: a mutation that lands during
            // the pass (after its table was already read) re-sets it and forces
            // a follow-up below, instead of being silently folded into a pass
            // that already missed it.
            SYNC_DIRTY.store(false, std::sync::atomic::Ordering::Release);
            // This pass reads the notes too: a pending notes deadline is met.
            *NOTES_DUE.lock().unwrap_or_else(|p| p.into_inner()) = None;

            // run_sync_once writes the status snapshot internally and logs any
            // per-table failures (in sync_table); nothing more for the loop to do.
            run_sync_once(&state).await;

            // A mutation arrived mid-pass — wake ourselves so the next select
            // returns immediately and re-syncs, rather than waiting for the
            // 45s tick (or losing the wake entirely to a select!-drop).
            if SYNC_DIRTY.load(std::sync::atomic::Ordering::Acquire) {
                SYNC_WAKE.notify_one();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_clean_when_no_table_errors() {
        let r = SyncReport {
            tables: vec![
                LastTable {
                    remote: "a".into(),
                    rows: 3,
                    error: None,
                },
                LastTable {
                    remote: "b".into(),
                    rows: 0,
                    error: None,
                },
            ],
            total: 3,
        };
        assert!(r.is_clean());
        assert_eq!(r.first_error(), None);
    }

    #[test]
    fn report_surfaces_first_error_and_is_not_clean() {
        // One table failing must NOT mask the others' row counts — fault
        // isolation: total still reflects the tables that succeeded.
        let r = SyncReport {
            tables: vec![
                LastTable {
                    remote: "a".into(),
                    rows: 5,
                    error: None,
                },
                LastTable {
                    remote: "b".into(),
                    rows: 0,
                    error: Some("boom".into()),
                },
                LastTable {
                    remote: "c".into(),
                    rows: 2,
                    error: None,
                },
            ],
            total: 7,
        };
        assert!(!r.is_clean());
        assert_eq!(r.first_error(), Some("boom".into()));
        assert_eq!(
            r.total, 7,
            "healthy tables still contribute rows when a sibling fails"
        );
    }

    #[test]
    fn sync_tables_cover_all_phase1_tables() {
        // The grid + dispatch are driven off this list; guard its length so a
        // table added to collect_pass without a SYNC_TABLES entry fails CI.
        assert_eq!(SYNC_TABLES.len(), 17);
        // cursor keys must be unique (they key app_settings rows).
        let mut keys: Vec<&str> = SYNC_TABLES.iter().map(|(_, c, _, _)| *c).collect();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(
            keys.len(),
            SYNC_TABLES.len(),
            "duplicate cursor key in SYNC_TABLES"
        );
    }

    /// The reconcile filter is the one timestamp this module puts in a URL.
    /// A `+00:00` offset would decode to a space and silently stop the delete
    /// from matching anything.
    #[test]
    fn queue_stamp_is_url_safe() {
        let s = queue_stamp();
        assert!(
            !s.contains('+'),
            "a `+` in a query string decodes to a space: {s}"
        );
        assert!(s.ends_with('Z'), "{s}");
        assert!(
            chrono::DateTime::parse_from_rfc3339(&s).is_ok(),
            "still RFC3339: {s}"
        );
        assert!(
            now_rfc3339().contains('+'),
            "the default form is why this exists"
        );
    }

    /// `sync_notes`, `sync_athena_chat` and `sync_persona_chat` read their
    /// tuples by INDEX, like the queue: pin them.
    #[test]
    fn notes_and_chat_are_the_last_five_entries() {
        assert_eq!(SYNC_TABLES[12].0, "synced_notes");
        assert_eq!(SYNC_TABLES[13].0, "synced_chat_sessions");
        assert_eq!(SYNC_TABLES[14].0, "synced_chat_messages");
        for (_, _, full_backfill, resync) in &SYNC_TABLES[12..15] {
            assert!(*full_backfill && !*resync, "their flags are inert");
        }
        assert_eq!(
            SYNC_TABLES[15],
            (
                "synced_chat_sessions",
                "persona_chat_sessions",
                false,
                false
            ),
            "persona sessions: a real cursor, 90 days back, no resync"
        );
        assert_eq!(
            SYNC_TABLES[16],
            (
                "synced_chat_messages",
                "persona_chat_messages",
                false,
                false
            ),
            "persona messages: append-only, no resync"
        );
    }

    /// One grid row per remote table: the two writers of the chat tables are
    /// folded - rows summed, first error shown, newer watermark kept.
    #[test]
    fn the_grid_folds_the_two_chat_writers_into_one_row_per_table() {
        let t = |remote: &str, rows: u64, error: Option<&str>| LastTable {
            remote: remote.into(),
            rows,
            error: error.map(str::to_string),
        };
        let last = vec![
            t("synced_chat_sessions", 2, None),
            t("synced_chat_messages", 5, None),
            t("synced_chat_sessions", 1, Some("persona boom")),
            t("synced_chat_messages", 3, None),
        ];
        let rows = grid(&last, |key| match key {
            k if k == athena_chat::SESSIONS_CURSOR => Some("2026-10-06T10:00:00+00:00".into()),
            k if k == persona_chat::SESSIONS_CURSOR => Some("2026-10-06 11:00:00".into()),
            k if k == persona_chat::MESSAGES_CURSOR => Some("2026-10-06T09:00:00Z".into()),
            _ => None,
        });
        assert_eq!(rows.len(), 15, "one row per remote table");
        let sessions = rows
            .iter()
            .find(|r| r.table == "synced_chat_sessions")
            .expect("sessions row");
        assert_eq!(sessions.rows_last, 3);
        assert_eq!(sessions.error.as_deref(), Some("persona boom"));
        assert_eq!(
            sessions.last_synced_at.as_deref(),
            Some("2026-10-06 11:00:00")
        );
        let messages = rows
            .iter()
            .find(|r| r.table == "synced_chat_messages")
            .expect("messages row");
        assert_eq!(messages.rows_last, 8);
        assert_eq!(
            messages.last_synced_at.as_deref(),
            Some("2026-10-06T09:00:00Z")
        );
    }

    /// A persona delete sweeps its chat rows too, messages before sessions.
    #[test]
    fn a_persona_delete_reaches_its_chats() {
        let at = |name: &str| PERSONA_SCOPED_TABLES.iter().position(|t| *t == name);
        let (m, s) = (at("synced_chat_messages"), at("synced_chat_sessions"));
        assert!(m.is_some() && s.is_some() && m < s, "{m:?} {s:?}");
    }

    /// The notes debounce is trailing: each edit pushes the wake out by 10 s,
    /// but never past 60 s after the first edit.
    #[test]
    fn the_notes_debounce_trails_and_is_capped() {
        let t0 = Instant::now();
        let (first, due) = notes_due(None, t0);
        assert_eq!((first, due), (t0, t0 + NOTES_DEBOUNCE));
        let t1 = t0 + Duration::from_secs(4);
        assert_eq!(notes_due(Some((first, due)), t1), (t0, t1 + NOTES_DEBOUNCE));
        let late = t0 + Duration::from_secs(55);
        assert_eq!(
            notes_due(Some((first, due)), late),
            (t0, t0 + NOTES_MAX_WAIT)
        );
    }

    /// `sync_fleet_queue` reads its tuple by INDEX (it is the one table the
    /// `sync!` macro cannot dispatch), so a reorder of SYNC_TABLES would
    /// silently point it at another table's cursor key. Pin the index.
    #[test]
    fn fleet_queue_is_the_twelfth_entry() {
        let (remote, cursor_key, full_backfill, resync) = SYNC_TABLES[11];
        assert_eq!(remote, "synced_fleet_queue");
        assert_eq!(cursor_key, "fleet_queue");
        assert!(
            full_backfill,
            "the unused cursor fallback stays at the epoch"
        );
        assert!(
            !resync,
            "a resync window is meaningless for a full-set replace"
        );
    }
}
