//! Read + undo side of the Reversible Agent change journal.
//!
//! The write side lives in `db::journal` (preupdate-hook capture + batch
//! writer). This repo answers two questions:
//!
//! 1. **"What did this run touch?"** — [`get_execution_data_diff`] returns
//!    the exact rows an execution created/modified/deleted, with
//!    before-images and a per-row "someone else wrote this row afterwards"
//!    conflict prediction.
//! 2. **"Take it back."** — [`undo_execution`] reverse-replays the journal
//!    in ONE transaction: inserts are deleted, updates restored from their
//!    before-image, deletes re-inserted. A row modified since by another
//!    writer is **flagged and parked** (`undo_status = 'conflict'`), never
//!    silently clobbered; everything else is applied and marked `'undone'`.
//!
//! Undo addresses rows by their TEXT `id` primary key (never by reusable
//! rowid) and hard-guards the table name against the journal allowlist plus
//! live `pragma_table_info` columns, so a corrupted before-image cannot be
//! escalated into arbitrary SQL.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use ts_rs::TS;

use personas_core::error::AppError;

use crate::journal::{is_journaled_table, json_to_value};
use crate::DbPool;

// ---------------------------------------------------------------------------
// Rows + DTOs
// ---------------------------------------------------------------------------

/// One `change_journal` row (internal shape).
#[derive(Debug, Clone)]
pub struct JournalRow {
    pub id: i64,
    pub execution_id: Option<String>,
    pub tbl: String,
    pub row_pk: Option<String>,
    pub action: String,
    pub before_image: Option<String>,
    pub undo_status: Option<String>,
    pub created_at: String,
}

/// A journal entry as shown in the Execution Data Diff panel.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionJournalEntry {
    #[ts(type = "number")]
    pub id: i64,
    pub table: String,
    pub row_pk: Option<String>,
    /// "insert" | "update" | "delete"
    pub action: String,
    /// JSON object of the row's OLD values (UPDATE/DELETE only). Values are
    /// exactly as stored — encrypted columns are ciphertext.
    pub before_image: Option<String>,
    /// NULL = live, "undone", or "conflict".
    pub undo_status: Option<String>,
    /// True when another writer touched this row AFTER this entry — undo
    /// would park it as a conflict rather than clobber the later write.
    pub has_later_foreign_write: bool,
    pub created_at: String,
}

/// The full data-diff payload for one execution.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionDataDiff {
    pub execution_id: String,
    pub entries: Vec<ExecutionJournalEntry>,
    /// Total journal rows for this execution (entries may be truncated).
    #[ts(type = "number")]
    pub total: i64,
    pub truncated: bool,
    /// True when at least one entry is still live (not undone/conflicted).
    pub undoable: bool,
}

/// One parked row from an undo pass.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UndoConflict {
    #[ts(type = "number")]
    pub journal_id: i64,
    pub table: String,
    pub row_pk: Option<String>,
    pub reason: String,
}

/// Outcome of [`undo_execution`].
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UndoExecutionResult {
    pub execution_id: String,
    pub undone: u32,
    pub conflicts: Vec<UndoConflict>,
    /// Entries skipped because a previous undo already processed them.
    pub skipped_already_processed: u32,
}

// ---------------------------------------------------------------------------
// Pure logic: conflict detection + undo planning
// ---------------------------------------------------------------------------

/// A later journal write to a (table, pk) key, used for conflict detection.
#[derive(Debug, Clone)]
pub struct LaterWrite {
    pub tbl: String,
    pub row_pk: String,
    pub journal_id: i64,
    pub execution_id: Option<String>,
}

/// Whether a journal write belongs to a different writer than the execution
/// being undone. Unattributed writes (user activity, previous undo passes)
/// count as foreign — conservative by design: when in doubt, park.
pub fn is_foreign_write(writer: Option<&str>, undoing_execution: &str) -> bool {
    writer != Some(undoing_execution)
}

/// The reverse operation for one journal entry.
#[derive(Debug, Clone, PartialEq)]
pub enum UndoOp {
    /// The run INSERTed this row — undo deletes it by pk.
    DeleteInserted,
    /// The run UPDATEd this row — undo restores the before-image.
    RestoreImage(serde_json::Map<String, serde_json::Value>),
    /// The run DELETEd this row — undo re-inserts the before-image.
    ReinsertImage(serde_json::Map<String, serde_json::Value>),
}

/// Why an entry cannot be undone, decided from journal data alone.
/// (Apply-time conditions — row vanished, pk collision, FK failure — are
/// detected during [`undo_execution`] itself.)
pub fn plan_entry(
    entry: &JournalRow,
    later_writes: &[LaterWrite],
    undoing_execution: &str,
) -> Result<UndoOp, String> {
    let Some(pk) = entry.row_pk.as_deref() else {
        return Err("row has no captured primary key".into());
    };
    if !is_journaled_table(&entry.tbl) {
        // Defense in depth: journal rows for tables outside the allowlist
        // are never turned into SQL.
        return Err(format!("table '{}' is not undoable", entry.tbl));
    }
    let clobbered = later_writes.iter().any(|w| {
        w.tbl == entry.tbl
            && w.row_pk == pk
            && w.journal_id > entry.id
            && is_foreign_write(w.execution_id.as_deref(), undoing_execution)
    });
    if clobbered {
        return Err("row was modified by another writer after this run".into());
    }
    match entry.action.as_str() {
        "insert" => Ok(UndoOp::DeleteInserted),
        "update" | "delete" => {
            let Some(image) = entry.before_image.as_deref() else {
                return Err("before-image missing".into());
            };
            let parsed: serde_json::Value =
                serde_json::from_str(image).map_err(|e| format!("before-image unparsable: {e}"))?;
            let serde_json::Value::Object(map) = parsed else {
                return Err("before-image is not a JSON object".into());
            };
            if entry.action == "update" {
                Ok(UndoOp::RestoreImage(map))
            } else {
                Ok(UndoOp::ReinsertImage(map))
            }
        }
        other => Err(format!("unknown journal action '{other}'")),
    }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const DIFF_ENTRY_CAP: i64 = 500;

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<JournalRow> {
    Ok(JournalRow {
        id: row.get(0)?,
        execution_id: row.get(1)?,
        tbl: row.get(2)?,
        row_pk: row.get(3)?,
        action: row.get(4)?,
        before_image: row.get(5)?,
        undo_status: row.get(6)?,
        created_at: row.get(7)?,
    })
}

const ROW_COLUMNS: &str =
    "id, execution_id, tbl, row_pk, action, before_image, undo_status, created_at";

/// Journal rows for an execution, newest first (reverse-replay order).
fn rows_for_execution(
    conn: &rusqlite::Connection,
    execution_id: &str,
    limit: i64,
) -> Result<Vec<JournalRow>, AppError> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {ROW_COLUMNS} FROM change_journal
         WHERE execution_id = ?1 ORDER BY id DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map(rusqlite::params![execution_id, limit], map_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// All later journal writes touching the (tbl, pk) keys of `entries`.
fn later_writes_for(
    conn: &rusqlite::Connection,
    entries: &[JournalRow],
) -> Result<Vec<LaterWrite>, AppError> {
    let keys: HashSet<(&str, &str)> = entries
        .iter()
        .filter_map(|e| e.row_pk.as_deref().map(|pk| (e.tbl.as_str(), pk)))
        .collect();
    let min_id = entries.iter().map(|e| e.id).min().unwrap_or(0);
    let mut out = Vec::new();
    let mut stmt = conn.prepare_cached(
        "SELECT id, execution_id FROM change_journal
         WHERE tbl = ?1 AND row_pk = ?2 AND id > ?3",
    )?;
    for (tbl, pk) in keys {
        let rows = stmt.query_map(rusqlite::params![tbl, pk, min_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        for r in rows {
            let (journal_id, execution_id) = r?;
            out.push(LaterWrite {
                tbl: tbl.to_owned(),
                row_pk: pk.to_owned(),
                journal_id,
                execution_id,
            });
        }
    }
    Ok(out)
}

/// The "Execution Data Diff": every row this run created/modified/deleted.
pub fn get_execution_data_diff(
    pool: &DbPool,
    execution_id: &str,
) -> Result<ExecutionDataDiff, AppError> {
    let conn = pool.get()?;
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM change_journal WHERE execution_id = ?1",
        [execution_id],
        |r| r.get(0),
    )?;
    let rows = rows_for_execution(&conn, execution_id, DIFF_ENTRY_CAP)?;
    let later = later_writes_for(&conn, &rows)?;
    let undoable = rows.iter().any(|r| r.undo_status.is_none());
    let entries = rows
        .into_iter()
        .map(|r| {
            let has_later_foreign_write = r.row_pk.as_deref().is_some_and(|pk| {
                later.iter().any(|w| {
                    w.tbl == r.tbl
                        && w.row_pk == pk
                        && w.journal_id > r.id
                        && is_foreign_write(w.execution_id.as_deref(), execution_id)
                })
            });
            ExecutionJournalEntry {
                id: r.id,
                table: r.tbl,
                row_pk: r.row_pk,
                action: r.action,
                before_image: r.before_image,
                undo_status: r.undo_status,
                has_later_foreign_write,
                created_at: r.created_at,
            }
        })
        .collect::<Vec<_>>();
    Ok(ExecutionDataDiff {
        execution_id: execution_id.to_owned(),
        truncated: total > entries.len() as i64,
        total,
        entries,
        undoable,
    })
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/// Live column set for `tbl`, used to validate before-image keys before any
/// SQL is built from them.
fn live_columns(conn: &rusqlite::Connection, tbl: &str) -> Result<HashSet<String>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT name FROM pragma_table_info('{}')",
        tbl.replace('\'', "''"),
    ))?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(names)
}

/// Reverse-replay every live journal entry of `execution_id` in ONE
/// transaction. Per-entry conflicts are parked (flagged `'conflict'`),
/// successful reversals are flagged `'undone'`; the transaction commits
/// with both marks so a re-run is a no-op.
pub fn undo_execution(pool: &DbPool, execution_id: &str) -> Result<UndoExecutionResult, AppError> {
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;

    // No LIMIT here: undo must see the whole run, not the display cap.
    let all_rows = rows_for_execution(&tx, execution_id, i64::MAX)?;
    let later = later_writes_for(&tx, &all_rows)?;

    let mut undone: u32 = 0;
    let mut skipped: u32 = 0;
    let mut conflicts: Vec<UndoConflict> = Vec::new();
    let mut column_cache: HashMap<String, HashSet<String>> = HashMap::new();

    for entry in &all_rows {
        if entry.undo_status.is_some() {
            skipped += 1;
            continue;
        }
        let outcome: Result<(), String> = match plan_entry(entry, &later, execution_id) {
            Err(reason) => Err(reason),
            Ok(op) => apply_undo_op(&tx, &mut column_cache, entry, &op),
        };
        match outcome {
            Ok(()) => {
                tx.execute(
                    "UPDATE change_journal
                     SET undo_status = 'undone', undone_at = datetime('now')
                     WHERE id = ?1",
                    [entry.id],
                )?;
                undone += 1;
            }
            Err(reason) => {
                tx.execute(
                    "UPDATE change_journal
                     SET undo_status = 'conflict', undone_at = datetime('now')
                     WHERE id = ?1",
                    [entry.id],
                )?;
                conflicts.push(UndoConflict {
                    journal_id: entry.id,
                    table: entry.tbl.clone(),
                    row_pk: entry.row_pk.clone(),
                    reason,
                });
            }
        }
    }

    tx.commit()?;
    tracing::info!(
        execution_id,
        undone,
        conflicts = conflicts.len(),
        skipped,
        "Reversible Agent: undo_execution completed"
    );
    Ok(UndoExecutionResult {
        execution_id: execution_id.to_owned(),
        undone,
        conflicts,
        skipped_already_processed: skipped,
    })
}

/// Apply one reverse operation inside the undo transaction. Returns
/// `Err(reason)` for apply-time conflicts (row vanished, pk collision, FK
/// failure) — the caller parks the entry, the transaction survives.
fn apply_undo_op(
    tx: &rusqlite::Transaction<'_>,
    column_cache: &mut HashMap<String, HashSet<String>>,
    entry: &JournalRow,
    op: &UndoOp,
) -> Result<(), String> {
    let pk = entry.row_pk.as_deref().expect("plan_entry guarantees pk");
    // plan_entry already checked the allowlist; re-assert before building SQL.
    assert!(is_journaled_table(&entry.tbl), "allowlist violated");

    if !column_cache.contains_key(&entry.tbl) {
        let cols = live_columns(tx, &entry.tbl).map_err(|e| e.to_string())?;
        column_cache.insert(entry.tbl.clone(), cols);
    }
    let live = column_cache.get(&entry.tbl).expect("just inserted");

    match op {
        UndoOp::DeleteInserted => {
            // Affected 0 = the row is already gone; the goal state (row
            // absent) is reached, so this still counts as undone.
            tx.execute(
                &format!("DELETE FROM \"{}\" WHERE id = ?1", entry.tbl),
                [pk],
            )
            .map_err(|e| format!("delete failed: {e}"))?;
            Ok(())
        }
        UndoOp::RestoreImage(image) => {
            // Restore every captured column present in the LIVE schema
            // (columns added after capture keep their current value).
            let cols: Vec<&String> = image
                .keys()
                .filter(|k| live.contains(*k) && k.as_str() != "id")
                .collect();
            if cols.is_empty() {
                return Err("before-image shares no columns with live schema".into());
            }
            let sets = cols
                .iter()
                .enumerate()
                .map(|(i, c)| format!("\"{c}\" = ?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "UPDATE \"{}\" SET {sets} WHERE id = ?{}",
                entry.tbl,
                cols.len() + 1
            );
            let mut params: Vec<rusqlite::types::Value> = cols
                .iter()
                .map(|c| json_to_value(image.get(*c).unwrap_or(&serde_json::Value::Null)))
                .collect();
            params.push(rusqlite::types::Value::Text(pk.to_owned()));
            let n = tx
                .execute(&sql, rusqlite::params_from_iter(params))
                .map_err(|e| format!("restore failed: {e}"))?;
            if n == 0 {
                return Err("row no longer exists".into());
            }
            Ok(())
        }
        UndoOp::ReinsertImage(image) => {
            let exists: bool = tx
                .query_row(
                    &format!("SELECT 1 FROM \"{}\" WHERE id = ?1", entry.tbl),
                    [pk],
                    |_| Ok(true),
                )
                .map(|_| true)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(false),
                    other => Err(format!("existence check failed: {other}")),
                })?;
            if exists {
                return Err("a row with this id already exists".into());
            }
            let cols: Vec<&String> = image.keys().filter(|k| live.contains(*k)).collect();
            if cols.is_empty() {
                return Err("before-image shares no columns with live schema".into());
            }
            let col_list = cols
                .iter()
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders = (1..=cols.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "INSERT INTO \"{}\" ({col_list}) VALUES ({placeholders})",
                entry.tbl
            );
            let params: Vec<rusqlite::types::Value> = cols
                .iter()
                .map(|c| json_to_value(image.get(*c).unwrap_or(&serde_json::Value::Null)))
                .collect();
            tx.execute(&sql, rusqlite::params_from_iter(params))
                .map_err(|e| format!("reinsert failed: {e}"))?;
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attribution::ThreadAttributionGuard;
    use crate::cdc::CdcCustomizer;
    use crate::journal;
    use crate::repos::test_fixtures::create_test_persona_id;
    use r2d2::Pool;
    use r2d2_sqlite::SqliteConnectionManager;

    fn row(
        id: i64,
        exec: Option<&str>,
        tbl: &str,
        pk: Option<&str>,
        action: &str,
        before: Option<&str>,
    ) -> JournalRow {
        JournalRow {
            id,
            execution_id: exec.map(str::to_owned),
            tbl: tbl.into(),
            row_pk: pk.map(str::to_owned),
            action: action.into(),
            before_image: before.map(str::to_owned),
            undo_status: None,
            created_at: "2026-07-30T00:00:00Z".into(),
        }
    }

    fn later(tbl: &str, pk: &str, id: i64, exec: Option<&str>) -> LaterWrite {
        LaterWrite {
            tbl: tbl.into(),
            row_pk: pk.into(),
            journal_id: id,
            execution_id: exec.map(str::to_owned),
        }
    }

    // --- pure planning / conflict detection --------------------------------

    #[test]
    fn later_foreign_write_parks_the_entry() {
        let e = row(
            10,
            Some("exec-a"),
            "persona_memories",
            Some("m1"),
            "update",
            Some(r#"{"id":"m1","content":"old"}"#),
        );
        // Foreign write AFTER the entry → conflict.
        let conflict = plan_entry(
            &e,
            &[later("persona_memories", "m1", 11, Some("exec-b"))],
            "exec-a",
        );
        assert!(conflict.is_err(), "later foreign write must park");
        // Unattributed later write is ALSO foreign (conservative).
        let unattr = plan_entry(&e, &[later("persona_memories", "m1", 12, None)], "exec-a");
        assert!(unattr.is_err(), "unattributed later write must park");
    }

    #[test]
    fn later_same_execution_or_earlier_writes_do_not_conflict() {
        let e = row(
            10,
            Some("exec-a"),
            "persona_memories",
            Some("m1"),
            "update",
            Some(r#"{"id":"m1","content":"old"}"#),
        );
        // Same execution wrote again later — reverse replay handles it.
        let ok = plan_entry(
            &e,
            &[later("persona_memories", "m1", 11, Some("exec-a"))],
            "exec-a",
        );
        assert!(matches!(ok, Ok(UndoOp::RestoreImage(_))));
        // A write with a SMALLER journal id (earlier) never conflicts.
        let earlier = plan_entry(
            &e,
            &[later("persona_memories", "m1", 5, Some("exec-b"))],
            "exec-a",
        );
        assert!(earlier.is_ok());
        // A foreign write to a DIFFERENT row never conflicts.
        let other_row = plan_entry(
            &e,
            &[later("persona_memories", "m2", 99, Some("exec-b"))],
            "exec-a",
        );
        assert!(other_row.is_ok());
    }

    #[test]
    fn missing_image_pk_or_allowlist_park() {
        let no_image = row(1, Some("e"), "persona_memories", Some("m1"), "update", None);
        assert!(plan_entry(&no_image, &[], "e").is_err(), "no before-image");

        let no_pk = row(2, Some("e"), "persona_memories", None, "insert", None);
        assert!(plan_entry(&no_pk, &[], "e").is_err(), "no pk");

        let bad_table = row(3, Some("e"), "change_journal", Some("x"), "insert", None);
        assert!(
            plan_entry(&bad_table, &[], "e").is_err(),
            "non-allowlisted table"
        );
    }

    #[test]
    fn actions_map_to_their_reverse_ops() {
        let ins = row(1, Some("e"), "persona_memories", Some("m1"), "insert", None);
        assert_eq!(plan_entry(&ins, &[], "e").unwrap(), UndoOp::DeleteInserted);

        let img = r#"{"id":"m1","content":"before"}"#;
        let upd = row(
            2,
            Some("e"),
            "persona_memories",
            Some("m1"),
            "update",
            Some(img),
        );
        assert!(matches!(
            plan_entry(&upd, &[], "e").unwrap(),
            UndoOp::RestoreImage(_)
        ));

        let del = row(
            3,
            Some("e"),
            "persona_memories",
            Some("m1"),
            "delete",
            Some(img),
        );
        assert!(matches!(
            plan_entry(&del, &[], "e").unwrap(),
            UndoOp::ReinsertImage(_)
        ));
    }

    // --- end-to-end: capture → journal → diff → undo ------------------------

    /// Pool with BOTH hooks (CDC + journal capture), fully migrated.
    fn journaled_pool() -> (DbPool, journal::JournalReceiver) {
        let (cdc_tx, _cdc_rx) = crate::cdc::create_cdc_channel(4096);
        let (j_tx, j_rx) = journal::create_journal_channel(4096);
        let tmp =
            std::env::temp_dir().join(format!("personas_journal_{}.db", uuid::Uuid::new_v4()));
        let manager = SqliteConnectionManager::file(&tmp);
        let pool: DbPool = Pool::builder()
            .max_size(1)
            .connection_customizer(Box::new(CdcCustomizer::with_journal(cdc_tx, j_tx)))
            .build(manager)
            .expect("build journaled pool");
        {
            let conn = pool.get().unwrap();
            crate::migrations::run(&conn).unwrap();
            crate::migrations::run_incremental(&conn).unwrap();
        }
        (pool, j_rx)
    }

    fn memory_content(pool: &DbPool, id: &str) -> Option<String> {
        let conn = pool.get().unwrap();
        conn.query_row(
            "SELECT content FROM persona_memories WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .ok()
    }

    #[test]
    fn capture_diff_undo_roundtrip_and_no_recursion() {
        let (pool, rx) = journaled_pool();
        let persona_id = create_test_persona_id(&pool, "journal-test", "prompt");
        let conn = pool.get().unwrap();

        // Pre-existing rows (unattributed).
        conn.execute(
            "INSERT INTO persona_memories (id, persona_id, title, content) VALUES ('m-upd', ?1, 'T', 'original')",
            [&persona_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO persona_memories (id, persona_id, title, content) VALUES ('m-del', ?1, 'T', 'keep-me')",
            [&persona_id],
        ).unwrap();
        drop(conn);

        // The "agent run": insert + update + delete under attribution.
        {
            let _g = ThreadAttributionGuard::enter("exec-run-1");
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_memories (id, persona_id, title, content) VALUES ('m-new', ?1, 'T', 'agent-made')",
                [&persona_id],
            ).unwrap();
            conn.execute(
                "UPDATE persona_memories SET content = 'agent-changed' WHERE id = 'm-upd'",
                [],
            )
            .unwrap();
            conn.execute("DELETE FROM persona_memories WHERE id = 'm-del'", [])
                .unwrap();
        }

        journal::drain_and_write(&pool, &rx).expect("drain");

        // NO RECURSION: persisting journal rows through the hooked pool must
        // not have produced new captures.
        assert_eq!(
            journal::drain_and_write(&pool, &rx).expect("second drain"),
            0,
            "journal writes must not re-enter the journal"
        );

        // Diff shows exactly the attributed writes, before-images intact.
        let diff = get_execution_data_diff(&pool, "exec-run-1").unwrap();
        assert_eq!(diff.total, 3);
        assert!(diff.undoable);
        assert!(!diff.truncated);
        let by_pk = |pk: &str| {
            diff.entries
                .iter()
                .find(|e| e.row_pk.as_deref() == Some(pk))
                .unwrap()
        };
        assert_eq!(by_pk("m-new").action, "insert");
        assert_eq!(by_pk("m-upd").action, "update");
        assert!(by_pk("m-upd")
            .before_image
            .as_deref()
            .unwrap()
            .contains("original"));
        assert_eq!(by_pk("m-del").action, "delete");
        assert!(by_pk("m-del")
            .before_image
            .as_deref()
            .unwrap()
            .contains("keep-me"));

        // Undo: one transaction, all three reversed.
        let result = undo_execution(&pool, "exec-run-1").unwrap();
        assert_eq!(result.undone, 3, "conflicts: {:?}", result.conflicts);
        assert!(result.conflicts.is_empty());

        assert_eq!(memory_content(&pool, "m-new"), None, "insert reversed");
        assert_eq!(
            memory_content(&pool, "m-upd").as_deref(),
            Some("original"),
            "update restored"
        );
        assert_eq!(
            memory_content(&pool, "m-del").as_deref(),
            Some("keep-me"),
            "delete re-inserted"
        );

        // Re-undo is a no-op (all entries already processed).
        let again = undo_execution(&pool, "exec-run-1").unwrap();
        assert_eq!(again.undone, 0);
        assert_eq!(again.skipped_already_processed, 3);
    }

    #[test]
    fn foreign_write_after_run_parks_that_row_only() {
        let (pool, rx) = journaled_pool();
        let persona_id = create_test_persona_id(&pool, "journal-conflict", "prompt");
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO persona_memories (id, persona_id, title, content) VALUES ('m-a', ?1, 'T', 'a-orig')",
                [&persona_id],
            ).unwrap();
        }

        {
            let _g = ThreadAttributionGuard::enter("exec-run-2");
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE persona_memories SET content = 'a-agent' WHERE id = 'm-a'",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_memories (id, persona_id, title, content) VALUES ('m-b', ?1, 'T', 'b-agent')",
                [&persona_id],
            ).unwrap();
        }

        // A HUMAN edits m-a after the run (unattributed = foreign).
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE persona_memories SET content = 'a-human' WHERE id = 'm-a'",
                [],
            )
            .unwrap();
        }

        journal::drain_and_write(&pool, &rx).expect("drain");

        // Diff predicts the conflict before any undo.
        let diff = get_execution_data_diff(&pool, "exec-run-2").unwrap();
        let m_a = diff
            .entries
            .iter()
            .find(|e| e.row_pk.as_deref() == Some("m-a"))
            .unwrap();
        assert!(
            m_a.has_later_foreign_write,
            "diff must warn about the human edit"
        );

        let result = undo_execution(&pool, "exec-run-2").unwrap();
        assert_eq!(result.undone, 1, "m-b insert is reversed");
        assert_eq!(result.conflicts.len(), 1, "m-a is parked");
        assert_eq!(result.conflicts[0].row_pk.as_deref(), Some("m-a"));

        // NEVER clobber: the human's edit survives.
        assert_eq!(memory_content(&pool, "m-a").as_deref(), Some("a-human"));
        assert_eq!(memory_content(&pool, "m-b"), None);

        // The parked entry is flagged in the journal.
        let conn = pool.get().unwrap();
        let status: String = conn.query_row(
            "SELECT undo_status FROM change_journal WHERE execution_id = 'exec-run-2' AND row_pk = 'm-a'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(status, "conflict");
    }
}
