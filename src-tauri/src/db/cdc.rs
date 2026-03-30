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

use std::sync::mpsc as std_mpsc;

use r2d2::CustomizeConnection;
use rusqlite::hooks::Action;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::engine::event_registry::event_name;

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

/// Payload emitted to the frontend for tables that only need a notification
/// (no full row fetch).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdcNotification {
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
/// If the buffer is full the update hook will silently drop the event (non-blocking).
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
        // Set standard pragmas (same as SqlitePragmaCustomizer)
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -2000;",
        )?;

        // Register the CDC update hook
        let tx = self.sender.clone();
        conn.update_hook(Some(move |action: Action, _db: &str, table: &str, rowid: i64| {
            // Only capture tables we care about
            if table_to_event(table, action.into()).is_some() {
                let event = CdcEvent {
                    action: action.into(),
                    table: table.to_owned(),
                    rowid,
                };
                // Non-blocking: silently drop if channel is full
                let _ = tx.try_send(event);
            }
        }))?;

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
/// frontend event bus).  For all other tables, it emits a lightweight
/// [`CdcNotification`] payload.
pub fn spawn_cdc_drain_task(
    app_handle: AppHandle,
    receiver: CdcReceiver,
    db: crate::db::DbPool,
) {
    tauri::async_runtime::spawn(async move {
        tracing::info!("CDC drain task started");

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

            // Special handling for persona_events: fetch full row for event bus
            if event.table == "persona_events" && event.action == CdcAction::Insert {
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

            // All other tables: emit lightweight notification
            let notification = CdcNotification {
                action: event.action,
                table: event.table,
                rowid: event.rowid,
            };
            if let Err(e) = app_handle.emit(event_name, &notification) {
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

/// Fetch a PersonaEvent by SQLite rowid.
fn fetch_persona_event_by_rowid(
    db: &crate::db::DbPool,
    rowid: i64,
) -> Result<Option<crate::db::models::PersonaEvent>, crate::error::AppError> {
    let conn = db.get()?;
    let mut stmt = conn.prepare_cached(
        "SELECT id, project_id, event_type, source_type, source_id,
                target_persona_id, payload, status, error_message,
                processed_at, created_at, use_case_id, retry_count
         FROM persona_events
         WHERE rowid = ?1",
    )?;

    let event = stmt.query_row(rusqlite::params![rowid], |row| {
        let status_str: String = row.get(7)?;
        Ok(crate::db::models::PersonaEvent {
            id: row.get(0)?,
            project_id: row.get(1)?,
            event_type: row.get(2)?,
            source_type: row.get(3)?,
            source_id: row.get(4)?,
            target_persona_id: row.get(5)?,
            payload: row.get(6)?,
            status: crate::db::models::PersonaEventStatus::from_db(&status_str),
            error_message: row.get(8)?,
            processed_at: row.get(9)?,
            created_at: row.get(10)?,
            use_case_id: row.get(11)?,
            retry_count: row.get(12)?,
        })
    });

    match event {
        Ok(e) => Ok(Some(e)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}
