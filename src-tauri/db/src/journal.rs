//! Durable change journal — the write side of the Reversible Agent.
//!
//! A second CDC consumer, parallel to the frontend-notification path in
//! [`crate::cdc`]: SQLite's `preupdate_hook` (registered per pooled
//! connection by [`crate::cdc::CdcCustomizer`]) captures every
//! INSERT/UPDATE/DELETE on an allowlisted table, including the row's
//! **before-image** for UPDATE/DELETE, and pushes it through a bounded sync
//! channel. A dedicated writer thread drains that channel in batches and
//! persists rows into the `change_journal` table, stamped with the active
//! execution id from [`crate::attribution`]. Unlike the frontend CDC stream,
//! overflow here spills nothing silently useful — it is counted and logged
//! as a permanent audit gap.
//!
//! ## Invariants (Reversible Agent v1)
//!
//! - **No recursion**: `change_journal` itself is NEVER captured — excluded
//!   from the allowlist AND guarded explicitly in the hook, so the writer
//!   thread's own inserts cannot re-enter the journal.
//! - **Allowlist + batching**: only [`JOURNAL_TABLES`] are captured
//!   (persona_events is hot; the batch writer amortizes its volume), and
//!   the hook itself does no I/O — just an owned-value copy and a
//!   non-blocking channel send.
//! - **Ciphertext only**: before-images serialize the values *as stored*.
//!   Encrypted columns (e.g. `persona_events.payload`) therefore journal
//!   ciphertext; nothing in this module ever decrypts. (Contrast with
//!   `cdc::map_persona_event_row`, which decrypts because it feeds the UI.)
//! - **Attributed**: rows carry the `execution_id` active at write time
//!   (task-local scope set by the execution runner), NULL for ordinary
//!   user-driven writes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc as std_mpsc;

use rusqlite::hooks::PreUpdateCase;
use rusqlite::types::Value;

use crate::cdc::CdcAction;

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/// Tables captured by the change journal.
///
/// Curated to the data agents actually write, each with a TEXT `id` PRIMARY
/// KEY (undo addresses rows by pk, never by reusable rowid). Deliberately
/// excluded:
/// - `change_journal` — recursion guard (also re-checked in the hook).
/// - `persona_executions` — the run record itself; undoing a run must not
///   erase the evidence that the run happened.
/// - `persona_credentials` — resurrecting revoked credentials via undo is a
///   security hazard; the vault has its own audit trail.
/// - `memory_edges` — composite PK; out of scope for pk-addressed undo v1.
pub const JOURNAL_TABLES: &[&str] = &[
    "personas",
    "persona_memories",
    "persona_messages",
    "persona_events",
    "persona_triggers",
    "persona_automations",
    "persona_tool_definitions",
    "memory_nodes",
    "dev_memories",
];

/// Whether writes to `table` are captured into the change journal.
pub fn is_journaled_table(table: &str) -> bool {
    // Explicit recursion guard first — the writer thread inserts into
    // change_journal through a pooled (hooked) connection.
    if table == "change_journal" {
        return false;
    }
    JOURNAL_TABLES.contains(&table)
}

// ---------------------------------------------------------------------------
// Drop observability (same pattern as cdc::note_cdc_drop)
// ---------------------------------------------------------------------------

static JOURNAL_DROPPED: AtomicU64 = AtomicU64::new(0);

/// Captures dropped because the bounded channel was full. Every drop is a
/// permanent gap in the audit ledger, so the first one warns loudly.
pub fn journal_dropped_count() -> u64 {
    JOURNAL_DROPPED.load(Ordering::Relaxed)
}

fn note_journal_drop(table: &str) {
    let prev = JOURNAL_DROPPED.fetch_add(1, Ordering::Relaxed);
    if prev == 0 {
        tracing::warn!(
            table,
            "change journal: bounded channel full — a change capture was DROPPED. \
             This is a permanent gap in the reversibility ledger for that row."
        );
    } else if (prev + 1) % 1000 == 0 {
        tracing::warn!(
            table,
            total_dropped = prev + 1,
            "change journal: channel-full drops ongoing — writer thread is behind"
        );
    }
}

// ---------------------------------------------------------------------------
// Capture type + channel
// ---------------------------------------------------------------------------

/// One captured change, produced inside the preupdate hook.
///
/// `values` holds the OLD row values for UPDATE/DELETE (the before-image)
/// and the NEW row values for INSERT (used only to resolve the pk — the
/// after-image is never persisted). Values are copied as stored — encrypted
/// columns stay ciphertext.
#[derive(Debug)]
pub struct JournalCapture {
    pub action: CdcAction,
    pub table: String,
    pub rowid: i64,
    /// Execution attribution stamped AT CAPTURE TIME (the hook runs on the
    /// writing thread, inside the writing task's poll).
    pub execution_id: Option<String>,
    pub values: Vec<Value>,
}

pub type JournalSender = std_mpsc::SyncSender<JournalCapture>;
pub type JournalReceiver = std_mpsc::Receiver<JournalCapture>;

/// Bounded channel pair for journal captures.
pub fn create_journal_channel(capacity: usize) -> (JournalSender, JournalReceiver) {
    std_mpsc::sync_channel(capacity)
}

// ---------------------------------------------------------------------------
// Hook registration (called from cdc::CdcCustomizer::on_acquire)
// ---------------------------------------------------------------------------

/// Register the journal's `preupdate_hook` on a pooled connection.
///
/// Must stay allocation-light and non-blocking: it runs synchronously inside
/// every write transaction on this connection.
pub fn register_preupdate_capture(
    conn: &rusqlite::Connection,
    sender: JournalSender,
) -> Result<(), rusqlite::Error> {
    conn.preupdate_hook(Some(
        move |_action: rusqlite::hooks::Action,
              _db: &str,
              table: &str,
              case: &PreUpdateCase| {
            if !is_journaled_table(table) {
                return;
            }
            let capture = match case {
                PreUpdateCase::Insert(acc) => {
                    let count = acc.get_column_count();
                    let mut values = Vec::with_capacity(count as usize);
                    for i in 0..count {
                        match acc.get_new_column_value(i) {
                            Ok(v) => values.push(Value::from(v)),
                            Err(_) => values.push(Value::Null),
                        }
                    }
                    JournalCapture {
                        action: CdcAction::Insert,
                        table: table.to_owned(),
                        rowid: acc.get_new_row_id(),
                        execution_id: crate::attribution::current_execution_id(),
                        values,
                    }
                }
                PreUpdateCase::Delete(acc) => {
                    let count = acc.get_column_count();
                    let mut values = Vec::with_capacity(count as usize);
                    for i in 0..count {
                        match acc.get_old_column_value(i) {
                            Ok(v) => values.push(Value::from(v)),
                            Err(_) => values.push(Value::Null),
                        }
                    }
                    JournalCapture {
                        action: CdcAction::Delete,
                        table: table.to_owned(),
                        rowid: acc.get_old_row_id(),
                        execution_id: crate::attribution::current_execution_id(),
                        values,
                    }
                }
                PreUpdateCase::Update {
                    old_value_accessor: acc,
                    ..
                } => {
                    let count = acc.get_column_count();
                    let mut values = Vec::with_capacity(count as usize);
                    for i in 0..count {
                        match acc.get_old_column_value(i) {
                            Ok(v) => values.push(Value::from(v)),
                            Err(_) => values.push(Value::Null),
                        }
                    }
                    JournalCapture {
                        action: CdcAction::Update,
                        table: table.to_owned(),
                        rowid: acc.get_old_row_id(),
                        execution_id: crate::attribution::current_execution_id(),
                        values,
                    }
                }
                PreUpdateCase::Unknown => return,
            };
            match sender.try_send(capture) {
                Ok(()) => {}
                Err(std_mpsc::TrySendError::Full(dropped)) => {
                    note_journal_drop(&dropped.table);
                }
                Err(std_mpsc::TrySendError::Disconnected(_)) => {}
            }
        },
    ))
}

// ---------------------------------------------------------------------------
// Value serialization (ciphertext-preserving, lossless-enough for undo)
// ---------------------------------------------------------------------------

/// Serialize one stored SQLite value to JSON for the before-image.
///
/// TEXT stays a string exactly as stored (ciphertext for encrypted columns).
/// BLOBs become `{"$hexBlob": "..."}` so undo can restore the exact bytes.
/// REALs and INTEGERs round-trip through JSON numbers.
pub fn value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::Value::from(*i),
        Value::Real(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Text(s) => serde_json::Value::String(s.clone()),
        Value::Blob(b) => serde_json::json!({ "$hexBlob": hex::encode(b) }),
    }
}

/// Inverse of [`value_to_json`], used by undo to rebuild bind parameters.
pub fn json_to_value(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Integer(i64::from(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        serde_json::Value::String(s) => Value::Text(s.clone()),
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(hexed)) = map.get("$hexBlob") {
                if let Ok(bytes) = hex::decode(hexed) {
                    return Value::Blob(bytes);
                }
            }
            Value::Text(v.to_string())
        }
        serde_json::Value::Array(_) => Value::Text(v.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Writer thread
// ---------------------------------------------------------------------------

/// Max captures folded into one INSERT transaction.
const BATCH_MAX: usize = 256;

/// Attributed journal rows older than this are pruned at writer startup.
const RETENTION_DAYS_ATTRIBUTED: u32 = 60;
/// Unattributed rows (ordinary user activity, kept only to make conflict
/// detection complete) are pruned sooner.
const RETENTION_DAYS_UNATTRIBUTED: u32 = 14;

/// Spawn the journal writer thread: drains the capture channel in batches
/// and persists into `change_journal`. Runs a retention prune first.
///
/// A plain `std::thread` (not a tokio task): the receiver is a blocking sync
/// channel and rusqlite is synchronous, so nothing here needs a runtime.
pub fn spawn_journal_writer(pool: crate::DbPool, receiver: JournalReceiver) {
    std::thread::Builder::new()
        .name("change-journal-writer".into())
        .spawn(move || {
            if let Err(e) = prune_journal(&pool) {
                tracing::warn!(error = %e, "change journal: retention prune failed");
            }
            let mut column_cache: HashMap<String, Vec<String>> = HashMap::new();
            loop {
                // Block for the first capture, then greedily drain up to a
                // batch. persona_events bursts land as one transaction.
                let first = match receiver.recv() {
                    Ok(c) => c,
                    Err(_) => {
                        tracing::info!("change journal: channel closed, writer exiting");
                        break;
                    }
                };
                let mut batch = vec![first];
                while batch.len() < BATCH_MAX {
                    match receiver.try_recv() {
                        Ok(c) => batch.push(c),
                        Err(_) => break,
                    }
                }
                if let Err(e) = write_batch(&pool, &mut column_cache, batch) {
                    tracing::warn!(error = %e, "change journal: batch write failed");
                }
            }
        })
        .expect("Failed to spawn change-journal writer thread");
}

/// Test/support helper: synchronously drain everything currently buffered in
/// `receiver` and persist it. Returns the number of rows written.
pub fn drain_and_write(
    pool: &crate::DbPool,
    receiver: &JournalReceiver,
) -> Result<usize, personas_core::error::AppError> {
    let mut column_cache = HashMap::new();
    let mut batch = Vec::new();
    while let Ok(c) = receiver.try_recv() {
        batch.push(c);
    }
    let n = batch.len();
    if n > 0 {
        write_batch(pool, &mut column_cache, batch)?;
    }
    Ok(n)
}

/// Column names for `table` in schema order (matches preupdate value order),
/// cached per writer lifetime. Schema is append-only at runtime, so a stale
/// cache is only possible across a migration — which happens before the
/// writer starts.
fn column_names<'a>(
    conn: &rusqlite::Connection,
    cache: &'a mut HashMap<String, Vec<String>>,
    table: &str,
) -> Result<&'a [String], personas_core::error::AppError> {
    if !cache.contains_key(table) {
        let mut stmt = conn.prepare(&format!(
            "SELECT name FROM pragma_table_info('{}') ORDER BY cid",
            table.replace('\'', "''"),
        ))?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        cache.insert(table.to_owned(), names);
    }
    Ok(cache.get(table).expect("just inserted").as_slice())
}

/// Persist one batch of captures in a single transaction.
fn write_batch(
    pool: &crate::DbPool,
    column_cache: &mut HashMap<String, Vec<String>>,
    batch: Vec<JournalCapture>,
) -> Result<(), personas_core::error::AppError> {
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO change_journal
                (execution_id, tbl, row_pk, row_id, action, before_image)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for capture in &batch {
            let names = column_names(&conn, column_cache, &capture.table)?;
            // pk = value of the `id` column. Every allowlisted table has a
            // TEXT id PRIMARY KEY; a missing/non-text id journals as NULL pk
            // (the row is then visible in the diff but not undoable).
            let row_pk = names
                .iter()
                .position(|n| n == "id")
                .and_then(|idx| capture.values.get(idx))
                .and_then(|v| match v {
                    Value::Text(s) => Some(s.clone()),
                    _ => None,
                });
            // Before-image only for UPDATE/DELETE — the values captured for
            // INSERT are the new row, kept transient for pk extraction only.
            let before_image = match capture.action {
                CdcAction::Update | CdcAction::Delete => {
                    let mut map = serde_json::Map::new();
                    for (i, name) in names.iter().enumerate() {
                        let v = capture.values.get(i).unwrap_or(&Value::Null);
                        map.insert(name.clone(), value_to_json(v));
                    }
                    Some(serde_json::Value::Object(map).to_string())
                }
                CdcAction::Insert => None,
            };
            let action = match capture.action {
                CdcAction::Insert => "insert",
                CdcAction::Update => "update",
                CdcAction::Delete => "delete",
            };
            stmt.execute(rusqlite::params![
                capture.execution_id,
                capture.table,
                row_pk,
                capture.rowid,
                action,
                before_image,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Retention: drop attributed rows older than [`RETENTION_DAYS_ATTRIBUTED`]
/// and unattributed rows older than [`RETENTION_DAYS_UNATTRIBUTED`]. Runs at
/// writer startup (i.e. once per app launch).
pub fn prune_journal(pool: &crate::DbPool) -> Result<usize, personas_core::error::AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM change_journal
         WHERE (execution_id IS NOT NULL AND created_at < datetime('now', ?1))
            OR (execution_id IS NULL AND created_at < datetime('now', ?2))",
        rusqlite::params![
            format!("-{RETENTION_DAYS_ATTRIBUTED} days"),
            format!("-{RETENTION_DAYS_UNATTRIBUTED} days"),
        ],
    )?;
    if n > 0 {
        tracing::info!(pruned = n, "change journal: retention prune");
    }
    Ok(n)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_excludes_journal_and_unknown_tables() {
        // The recursion guard: journal writes must NEVER be re-captured.
        assert!(!is_journaled_table("change_journal"));
        assert!(!is_journaled_table("persona_executions"));
        assert!(!is_journaled_table("persona_credentials"));
        assert!(!is_journaled_table("sqlite_sequence"));
        assert!(!is_journaled_table("some_random_table"));
        // The hot table IS captured (batching absorbs it).
        assert!(is_journaled_table("persona_events"));
        assert!(is_journaled_table("persona_memories"));
        // And the allowlist itself never contains the journal.
        assert!(!JOURNAL_TABLES.contains(&"change_journal"));
    }

    #[test]
    fn value_json_roundtrip_preserves_stored_forms() {
        let cases = vec![
            Value::Null,
            Value::Integer(42),
            Value::Real(1.5),
            Value::Text("ciphertext-as-stored==".into()),
            Value::Blob(vec![0xde, 0xad, 0xbe, 0xef]),
        ];
        for v in cases {
            let json = value_to_json(&v);
            let back = json_to_value(&json);
            assert_eq!(format!("{v:?}"), format!("{back:?}"), "roundtrip {v:?}");
        }
    }

    #[test]
    fn text_values_are_serialized_verbatim_never_decoded() {
        // Ciphertext discipline: whatever is stored is what the journal
        // keeps. No base64/crypto interpretation of TEXT.
        let ct = "gcm:abc123==";
        match value_to_json(&Value::Text(ct.into())) {
            serde_json::Value::String(s) => assert_eq!(s, ct),
            other => panic!("expected string, got {other:?}"),
        }
    }
}
