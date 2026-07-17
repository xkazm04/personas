//! Reactive SQLite Change Data Capture (CDC).
//!
//! Registers a `rusqlite::Connection::update_hook` on every pooled connection
//! via [`CdcCustomizer`].  The hook fires synchronously inside write
//! transactions and MUST NOT block, so it pushes lightweight [`CdcEvent`]s
//! through a bounded `std::sync::mpsc` channel.  A background tokio task
//! drains that channel and emits Tauri events to the frontend.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────┐  sync mpsc   ┌──────────────┐  Tauri emit  ┌──────────┐
//! │ update_hook  │ ──────────> │ drain task    │ ──────────> │ Frontend │
//! │ (per conn)   │             │ (tokio spawn) │             │          │
//! └─────────────┘              └──────────────┘              └──────────┘
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc as std_mpsc;

use r2d2::CustomizeConnection;
use rusqlite::hooks::Action;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

// ---------------------------------------------------------------------------
// Drop observability
// ---------------------------------------------------------------------------

/// Total CDC change events dropped because the bounded channel was full when
/// the (synchronous, non-blocking) SQLite update hook fired.
///
/// A full channel means the drain task fell behind the write rate; the frontend
/// silently misses a live update until the next poll / refetch. This counter
/// makes that observable. Incremented only from [`note_cdc_drop`].
static CDC_DROPPED: AtomicU64 = AtomicU64::new(0);

/// Number of CDC change events dropped so far because the bounded channel was
/// full. Exposed so a future stat / telemetry surface can read CDC backpressure
/// (the drain task is otherwise silent about it).
pub fn cdc_dropped_count() -> u64 {
    CDC_DROPPED.load(Ordering::Relaxed)
}

/// Record one dropped CDC event: bump the counter and log. Warns loudly on the
/// FIRST drop (so a newly-overloaded channel is immediately visible) and then
/// once per 1000 drops thereafter (so a persistently saturated channel keeps a
/// heartbeat in the log without flooding it). Kept tiny and allocation-free —
/// it runs inside the SQLite write-transaction update hook, which must not block.
fn note_cdc_drop(table: &str) {
    let prev = CDC_DROPPED.fetch_add(1, Ordering::Relaxed);
    if prev == 0 {
        tracing::warn!(
            table,
            "CDC: bounded channel full — dropping a change event. The frontend \
             may miss a live update for this table until its next poll/refetch. \
             First drop; subsequent drops are logged every 1000."
        );
    } else if (prev + 1) % 1000 == 0 {
        tracing::warn!(
            table,
            total_dropped = prev + 1,
            "CDC: channel-full drops ongoing — drain task is behind the write rate"
        );
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// The action that triggered the CDC event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CdcAction {
    Insert,
    Update,
    Delete,
}

impl From<Action> for CdcAction {
    fn from(a: Action) -> Self {
        match a {
            Action::SQLITE_INSERT => Self::Insert,
            Action::SQLITE_UPDATE => Self::Update,
            Action::SQLITE_DELETE => Self::Delete,
            _ => Self::Update, // fallback for UNKNOWN
        }
    }
}

/// A lightweight change notification produced by the SQLite update hook.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdcEvent {
    pub action: CdcAction,
    pub table: String,
    pub rowid: i64,
}

// ---------------------------------------------------------------------------
// Channel infrastructure
// ---------------------------------------------------------------------------

/// Bounded sync sender shared by all connection hooks.
///
/// Created once at app startup via [`create_cdc_channel`].
pub type CdcSender = std_mpsc::SyncSender<CdcEvent>;

/// Receiver end, consumed by the drain task.
pub type CdcReceiver = std_mpsc::Receiver<CdcEvent>;

/// Create the sync channel pair.  `capacity` controls the bounded buffer size.
/// If the buffer is full the update hook drops the event (non-blocking) and
/// records it via [`note_cdc_drop`] so the loss is observable
/// ([`cdc_dropped_count`]).
pub fn create_cdc_channel(capacity: usize) -> (CdcSender, CdcReceiver) {
    std_mpsc::sync_channel(capacity)
}

// ---------------------------------------------------------------------------
// Connection customizer
// ---------------------------------------------------------------------------

/// Wraps an existing connection customizer and additionally registers the
/// CDC update hook on every acquired connection.
#[derive(Debug)]
pub struct CdcCustomizer {
    sender: CdcSender,
}

impl CdcCustomizer {
    pub fn new(sender: CdcSender) -> Self {
        Self { sender }
    }
}

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for CdcCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        // Set standard pragmas. Delegates to the same shared helper as
        // `SqlitePragmaCustomizer` (crate::db::apply_standard_pragmas) so this
        // customizer can never silently drift from the canonical pragma set —
        // see refactor-bughunt-2026-07-10/tauri-db.md #3.
        crate::db::apply_standard_pragmas(conn)?;

        // Register the CDC update hook
        let tx = self.sender.clone();
        conn.update_hook(Some(
            move |action: Action, _db: &str, table: &str, rowid: i64| {
                // Only capture tables we care about
                if table_to_event(table, action.into()).is_some() {
                    let event = CdcEvent {
                        action: action.into(),
                        table: table.to_owned(),
                        rowid,
                    };
                    // Non-blocking. A full channel means the drain task fell
                    // behind — drop the event but RECORD it (drops were
                    // previously silent). A disconnected channel means the drain
                    // task is gone (shutdown); nothing to record there.
                    match tx.try_send(event) {
                        Ok(()) => {}
                        Err(std_mpsc::TrySendError::Full(dropped)) => {
                            note_cdc_drop(&dropped.table);
                        }
                        Err(std_mpsc::TrySendError::Disconnected(_)) => {}
                    }
                }
            },
        ))?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Table-to-event mapping
// ---------------------------------------------------------------------------

/// Maps a table name + action to a Tauri event name.
///
/// Returns `None` for tables we don't track, which means the update hook
/// skips them entirely (no channel send).
fn table_to_event(table: &str, action: CdcAction) -> Option<&'static str> {
    match table {
        // Event bus: primary event stream
        "persona_events" => Some(event_name::EVENT_BUS),

        // Executions: status changes
        "persona_executions" => Some(event_name::EXECUTION_STATUS),

        // Messages: new messages
        "persona_messages" => Some(event_name::MESSAGE_CREATED),

        // Memories: created/updated/deleted
        "persona_memories" => Some("memory-updated"),

        // Credentials: changes to credential store
        "persona_credentials" => Some("credential-updated"),

        // Personas: persona CRUD
        "personas" => Some("persona-health-changed"),

        // Triggers: trigger config changes
        "persona_triggers" => Some("trigger-updated"),

        // Healing issues: observability updates
        "healing_issues" => Some(event_name::HEALING_ISSUE_UPDATED),

        // Subscriptions: event subscription changes
        "persona_event_subscriptions" => Some("subscription-updated"),

        // Automations: workflow definition changes
        "persona_automations" => Some("automation-updated"),

        // Audit log: only emit on insert (new audit entries)
        "audit_log" if action == CdcAction::Insert => Some("audit-entry-created"),

        // Tool definitions: tool registry changes
        "persona_tool_definitions" => Some("tool-updated"),

        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Drain task
// ---------------------------------------------------------------------------

/// Spawns a background tokio task that drains CDC events from the sync channel
/// and emits them to the frontend via Tauri.
///
/// For `persona_events`, the task fetches the full row by rowid (needed by the
/// frontend event bus).  For all other tables, it emits the lightweight
/// [`CdcEvent`] itself as the notification payload.
pub fn spawn_cdc_drain_task(app_handle: AppHandle, receiver: CdcReceiver, db: crate::db::DbPool) {
    tauri::async_runtime::spawn(async move {
        // Capture the persona_events high-water rowid BEFORE the startup wait.
        // Anything inserted during the 6s blackout below is normally buffered in
        // the bounded channel and delivered once draining starts — but if that
        // buffer overflowed (a burst larger than its capacity before the reader
        // thread existed), those inserts were dropped and the frontend event bus
        // would never see them. This watermark lets us replay the gap from the
        // DB after the wait (see below).
        let startup_watermark = max_persona_event_rowid(&db);

        // Wait for the WebView IPC bridge to be established before emitting
        // events.  Without this delay, every `app_handle.emit()` fires a
        // "send was called before connect" unhandled‐promise rejection on the
        // frontend, producing tens of thousands of log lines and wasting CPU.
        // This is why we can't emit earlier — hence the replay-after-wait above
        // rather than draining immediately.
        tokio::time::sleep(std::time::Duration::from_secs(6)).await;
        tracing::info!("CDC drain task started");

        // Startup blackout recovery: re-emit every persona_events row inserted
        // during the wait, directly from the DB. The bounded channel will also
        // redeliver any survivors it still holds, but the frontend event log
        // dedupes by id (useEventLog.ts), so double-delivery is harmless — and
        // this path additionally recovers rows the channel dropped on overflow.
        replay_persona_events_after(&app_handle, &db, startup_watermark);

        // We run the blocking recv in a dedicated thread to avoid holding up
        // the tokio runtime.  The thread sends batched events to the async
        // world via a tokio mpsc channel.
        let (tx, mut rx) = tokio::sync::mpsc::channel::<CdcEvent>(256);

        // Sync reader thread
        std::thread::Builder::new()
            .name("cdc-reader".into())
            .spawn(move || {
                loop {
                    match receiver.recv() {
                        Ok(event) => {
                            if tx.blocking_send(event).is_err() {
                                // Async side dropped — shutting down
                                break;
                            }
                        }
                        Err(_) => {
                            // All senders dropped — shutting down
                            tracing::info!("CDC channel closed, reader thread exiting");
                            break;
                        }
                    }
                }
            })
            .expect("Failed to spawn CDC reader thread");

        // Async consumer
        while let Some(event) = rx.recv().await {
            let event_name = match table_to_event(&event.table, event.action) {
                Some(name) => name,
                None => continue,
            };

            // Cloud sync: nudge the writer when a synced table mutates so the
            // web dashboard reflects changes promptly. The sync loop debounces
            // and no-ops when sync is disabled, so this is cheap.
            if matches!(
                event.table.as_str(),
                "personas" | "persona_executions" | "persona_events" | "persona_messages"
            ) {
                crate::cloud::sync::notify_dirty();
            }

            // Special handling for persona_events: fetch the full row for the
            // event bus on INSERT *and* UPDATE. Previously only INSERT fetched
            // the full payload; a status change (UPDATE) fell through to the
            // lightweight {action,table,rowid} notification below, which the
            // live-stream UI rejects (it has no event_type) — so the row froze
            // on its first-seen status and later transitions were silently
            // dropped. UPDATE re-fetches the now-current row and re-emits it
            // under the same EVENT_BUS name, which the UI replaces in place.
            // DELETE stays lightweight: the row is gone, so there's nothing to
            // fetch.
            if event.table == "persona_events"
                && matches!(event.action, CdcAction::Insert | CdcAction::Update)
            {
                // Push fan-out (Direction 3): a NEW persona_events row means
                // there may be dispatch work. Wake the event-bus subscription
                // immediately instead of leaving the event to its 2s/10s poll.
                // Signalled from HERE (the drain consumer) rather than the
                // update hook so the writing transaction has effectively
                // committed by the time the tick's `claim_pending` runs; in the
                // rare case the tick still races the commit and claims nothing,
                // the retained poll heartbeat picks the event up next interval.
                // UPDATE is a status transition, not new work — no signal.
                if event.action == CdcAction::Insert {
                    crate::engine::subscription::event_bus_wake_signal().notify_one();
                }

                match fetch_persona_event_by_rowid(&db, event.rowid) {
                    Ok(Some(persona_event)) => {
                        if let Err(e) = app_handle.emit(event_name, &persona_event) {
                            tracing::warn!(
                                event_name,
                                rowid = event.rowid,
                                error = %e,
                                "CDC: failed to emit persona_event"
                            );
                        }
                    }
                    Ok(None) => {
                        tracing::debug!(
                            rowid = event.rowid,
                            "CDC: persona_event row not found (likely deleted)"
                        );
                    }
                    Err(e) => {
                        tracing::warn!(
                            rowid = event.rowid,
                            error = %e,
                            "CDC: failed to fetch persona_event by rowid"
                        );
                    }
                }
                continue;
            }

            // All other tables: emit the lightweight CdcEvent itself as the
            // notification payload (previously rebuilt into a field-for-field
            // duplicate `CdcNotification` — see
            // refactor-bughunt-2026-07-10/tauri-db.md #6).
            if let Err(e) = app_handle.emit(event_name, &event) {
                tracing::warn!(
                    event_name,
                    error = %e,
                    "CDC: failed to emit notification"
                );
            }
        }

        tracing::info!("CDC drain task exiting");
    });
}

/// Column list shared by every persona_events fetch below. Kept in one place so
/// the positional [`map_persona_event_row`] indices stay in lockstep.
const PERSONA_EVENT_COLUMNS: &str = "id, project_id, event_type, source_type, source_id,
     target_persona_id, payload, payload_iv, status, error_message,
     processed_at, created_at, use_case_id, retry_count";

/// Map a persona_events row (selected via [`PERSONA_EVENT_COLUMNS`]) into a
/// [`PersonaEvent`], DECRYPTING the payload when it was stored encrypted at rest.
///
/// This mirrors the canonical `repos::communication::events::row_to_event`: the
/// payload is AES-encrypted at rest (see `events::publish`), so a fetch that
/// emitted the raw column would push ciphertext to the frontend. Every other
/// read path decrypts; the CDC delivery path must too, or the event bus shows
/// unreadable payloads. On decrypt failure we drop the payload (never leak
/// ciphertext) and surface the reason in `error_message`.
fn map_persona_event_row(
    row: &rusqlite::Row,
) -> rusqlite::Result<crate::db::models::PersonaEvent> {
    let raw_payload: Option<String> = row.get(6)?;
    let payload_iv: Option<String> = row.get(7).unwrap_or(None);
    let raw_error: Option<String> = row.get(9)?;

    let (payload, error_message) = match (raw_payload, payload_iv) {
        (Some(ct), Some(ref iv)) if !iv.is_empty() => {
            match crate::engine::crypto::decrypt_from_db(&ct, iv) {
                Ok(pt) => (Some(pt), raw_error),
                Err(e) => {
                    tracing::warn!("CDC: failed to decrypt event payload: {}", e);
                    let decrypt_err = format!("[Decryption failed: {}]", e);
                    let combined = match raw_error {
                        Some(existing) => Some(format!("{existing}; {decrypt_err}")),
                        None => Some(decrypt_err),
                    };
                    (None, combined)
                }
            }
        }
        (p, _) => (p, raw_error), // plaintext or no payload
    };

    let status_str: String = row.get(8)?;
    Ok(crate::db::models::PersonaEvent {
        id: row.get(0)?,
        project_id: row.get(1)?,
        event_type: row.get(2)?,
        source_type: row.get(3)?,
        source_id: row.get(4)?,
        target_persona_id: row.get(5)?,
        payload,
        status: crate::db::models::PersonaEventStatus::from_db(&status_str),
        error_message,
        processed_at: row.get(10)?,
        created_at: row.get(11)?,
        use_case_id: row.get(12)?,
        retry_count: row.get(13).unwrap_or(0),
    })
}

/// Fetch a PersonaEvent by SQLite rowid.
fn fetch_persona_event_by_rowid(
    db: &crate::db::DbPool,
    rowid: i64,
) -> Result<Option<crate::db::models::PersonaEvent>, crate::error::AppError> {
    let conn = db.get()?;
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {PERSONA_EVENT_COLUMNS} FROM persona_events WHERE rowid = ?1"
    ))?;
    let event = stmt.query_row(rusqlite::params![rowid], map_persona_event_row);
    match event {
        Ok(e) => Ok(Some(e)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Current `MAX(rowid)` of persona_events (0 when empty or on error). Used to
/// watermark the startup blackout window.
fn max_persona_event_rowid(db: &crate::db::DbPool) -> i64 {
    let Ok(conn) = db.get() else { return 0 };
    conn.query_row(
        "SELECT COALESCE(MAX(rowid), 0) FROM persona_events",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// Fetch every persona_events row with `rowid > after`, oldest first. Used to
/// replay the startup blackout window.
fn fetch_persona_events_after_rowid(
    db: &crate::db::DbPool,
    after: i64,
) -> Result<Vec<crate::db::models::PersonaEvent>, crate::error::AppError> {
    let conn = db.get()?;
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {PERSONA_EVENT_COLUMNS} FROM persona_events
         WHERE rowid > ?1 ORDER BY rowid ASC"
    ))?;
    let rows = stmt.query_map(rusqlite::params![after], map_persona_event_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Re-emit every persona_events row with `rowid > after` under the event-bus
/// channel. Runs once at drain-task startup (after the bridge-warmup wait) to
/// recover events inserted during the blackout that the bounded channel may
/// have dropped. Frontend dedupes by id, so redundant re-emits are harmless.
fn replay_persona_events_after(app: &AppHandle, db: &crate::db::DbPool, after: i64) {
    let rows = match fetch_persona_events_after_rowid(db, after) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "CDC: startup blackout replay query failed");
            return;
        }
    };
    if rows.is_empty() {
        return;
    }
    tracing::info!(
        count = rows.len(),
        after_rowid = after,
        "CDC: replaying persona_events inserted during the startup blackout"
    );
    for event in rows {
        if let Err(e) = app.emit(event_name::EVENT_BUS, &event) {
            tracing::warn!(error = %e, "CDC: startup blackout replay emit failed");
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{CreatePersonaEventInput, PersonaEventStatus};
    use crate::db::repos::communication::events as event_repo;
    use crate::db::DbPool;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    fn sample_input(event_type: &str, payload: Option<&str>) -> CreatePersonaEventInput {
        CreatePersonaEventInput {
            event_type: event_type.to_string(),
            source_type: "test".to_string(),
            project_id: None,
            source_id: None,
            target_persona_id: None,
            payload: payload.map(|p| p.to_string()),
            use_case_id: None,
        }
    }

    /// rowid of a persona_events row given its id.
    fn rowid_of(pool: &DbPool, id: &str) -> i64 {
        let conn = pool.get().unwrap();
        conn.query_row(
            "SELECT rowid FROM persona_events WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    // --- table_to_event mapping --------------------------------------------

    #[test]
    fn table_to_event_maps_known_and_unknown_tables() {
        assert_eq!(
            table_to_event("persona_events", CdcAction::Insert),
            Some(event_name::EVENT_BUS)
        );
        assert_eq!(
            table_to_event("persona_executions", CdcAction::Update),
            Some(event_name::EXECUTION_STATUS)
        );
        // audit_log only tracks INSERTs.
        assert_eq!(
            table_to_event("audit_log", CdcAction::Insert),
            Some("audit-entry-created")
        );
        assert_eq!(table_to_event("audit_log", CdcAction::Update), None);
        // Untracked table → skipped entirely.
        assert_eq!(table_to_event("some_random_table", CdcAction::Insert), None);
    }

    // --- drop path ----------------------------------------------------------

    #[test]
    fn note_cdc_drop_increments_counter() {
        // Global counter: assert on the DELTA so parallel tests don't interfere.
        let before = cdc_dropped_count();
        note_cdc_drop("persona_events");
        note_cdc_drop("persona_events");
        note_cdc_drop("persona_executions");
        assert_eq!(cdc_dropped_count(), before + 3);
    }

    #[test]
    fn update_hook_records_drops_when_channel_full() {
        // A capacity-1 channel with no drain: after the buffer fills, every
        // further tracked INSERT must be counted as a drop (previously silent).
        let (sender, _receiver) = create_cdc_channel(1);
        let tmp = std::env::temp_dir()
            .join(format!("personas_cdc_drop_{}.db", uuid::Uuid::new_v4()));
        let manager = SqliteConnectionManager::file(&tmp);
        let pool: DbPool = Pool::builder()
            .max_size(1)
            .connection_customizer(Box::new(CdcCustomizer::new(sender)))
            .build(manager)
            .expect("build cdc pool");
        {
            let conn = pool.get().unwrap();
            crate::db::migrations::run(&conn).unwrap();
            crate::db::migrations::run_incremental(&conn).unwrap();
        }

        let before = cdc_dropped_count();
        // Insert many rows; the undrained capacity-1 channel overflows fast.
        for i in 0..50 {
            let _ = event_repo::publish(&pool, sample_input(&format!("drop.test.{i}"), None));
        }
        let dropped = cdc_dropped_count() - before;
        assert!(
            dropped > 0,
            "expected the full channel to record at least one drop, got {dropped}"
        );
    }

    // --- fetch by rowid + INSERT/UPDATE re-fetch in place -------------------

    #[test]
    fn fetch_by_rowid_roundtrips_and_reflects_updates() {
        let pool = crate::db::init_test_db().expect("init test db");
        let event = event_repo::publish(&pool, sample_input("fetch.roundtrip", None))
            .expect("publish");
        let rowid = rowid_of(&pool, &event.id);

        // INSERT visible: fetch returns the row, status pending.
        let fetched = fetch_persona_event_by_rowid(&pool, rowid)
            .expect("fetch ok")
            .expect("row present");
        assert_eq!(fetched.id, event.id);
        assert_eq!(fetched.event_type, "fetch.roundtrip");
        assert_eq!(fetched.status, PersonaEventStatus::Pending);

        // UPDATE re-fetch in place: after a status transition, the SAME rowid
        // now returns the CURRENT row (processing), not the first-seen one.
        event_repo::update_status(&pool, &event.id, PersonaEventStatus::Processing, None)
            .expect("update status");
        let refetched = fetch_persona_event_by_rowid(&pool, rowid)
            .expect("refetch ok")
            .expect("row present");
        assert_eq!(refetched.id, event.id);
        assert_eq!(refetched.status, PersonaEventStatus::Processing);

        // Missing rowid → None (not an error).
        assert!(fetch_persona_event_by_rowid(&pool, 999_999)
            .expect("fetch ok")
            .is_none());
    }

    #[test]
    fn fetch_by_rowid_decrypts_payload() {
        // A published event with a payload is encrypted at rest; the CDC fetch
        // must return the DECRYPTED plaintext (not ciphertext) so the frontend
        // event bus is readable. Roundtrips regardless of whether the test
        // binary has a crypto key (falls back to plaintext-at-rest).
        let pool = crate::db::init_test_db().expect("init test db");
        let secret = r#"{"secret":"hello-world"}"#;
        let event = event_repo::publish(&pool, sample_input("payload.decrypt", Some(secret)))
            .expect("publish");
        let rowid = rowid_of(&pool, &event.id);
        let fetched = fetch_persona_event_by_rowid(&pool, rowid)
            .expect("fetch ok")
            .expect("row present");
        assert_eq!(fetched.payload.as_deref(), Some(secret));
    }

    // --- startup replay / watermark ----------------------------------------

    #[test]
    fn replay_query_returns_only_rows_after_watermark() {
        let pool = crate::db::init_test_db().expect("init test db");

        // Pre-blackout rows.
        let e1 = event_repo::publish(&pool, sample_input("pre.1", None)).unwrap();
        let _e2 = event_repo::publish(&pool, sample_input("pre.2", None)).unwrap();
        let watermark = max_persona_event_rowid(&pool);
        assert_eq!(watermark, rowid_of(&pool, &e1.id) + 1, "watermark = max rowid");

        // Blackout-window rows.
        let e3 = event_repo::publish(&pool, sample_input("gap.1", None)).unwrap();
        let e4 = event_repo::publish(&pool, sample_input("gap.2", None)).unwrap();

        let replayed = fetch_persona_events_after_rowid(&pool, watermark).expect("replay query");
        let ids: Vec<&str> = replayed.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec![e3.id.as_str(), e4.id.as_str()], "only gap rows, in order");
    }

    #[test]
    fn max_rowid_is_zero_on_empty_table() {
        let pool = crate::db::init_test_db().expect("init test db");
        assert_eq!(max_persona_event_rowid(&pool), 0);
    }
}
