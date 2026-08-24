//! The persona "Messages" -> "Reports" rebrand (channels-v2 Lane B, W1):
//! `persona_messages` -> `persona_reports` and `persona_message_deliveries`
//! -> `persona_report_deliveries`, plus index renames.
//!
//! Two boot paths must converge on the same shape:
//!
//! - **Fresh install**: `schema.rs` creates `persona_reports` /
//!   `persona_report_deliveries` directly (including `use_case_id`). The
//!   legacy tables never exist, so this step no-ops.
//! - **Upgrade**: by the time this runs, `initial::run()` has ALREADY
//!   executed the renamed schema batch this same boot, so an EMPTY
//!   `persona_reports` exists beside the data-bearing `persona_messages`.
//!   A bare `ALTER TABLE ... RENAME` would collide with it; instead the
//!   rows are copied into the new tables and the legacy ones dropped. The
//!   bare-rename branch is kept for the standalone-`run_incremental`
//!   callers that never went through `schema.rs` in the same boot.
//!
//! Ordering guarantees the legacy column set is complete before the copy:
//! `initial::run()` adds `thread_id` to the legacy table (pre-schema ALTER)
//! and e01 adds `use_case_id` to whichever table name is live, both earlier
//! in the same boot. This module must stay LAST in the e-chain.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

const REPORT_COLS: &str = "id, persona_id, execution_id, title, content, content_type, \
                           priority, is_read, metadata, created_at, read_at, thread_id, \
                           use_case_id";

const DELIVERY_COLS: &str = "id, message_id, channel_type, status, error_message, \
                             external_id, delivered_at, created_at";

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    let legacy_msgs = has_table(conn, "persona_messages")?;
    let legacy_dels = has_table(conn, "persona_message_deliveries")?;

    if legacy_msgs || legacy_dels {
        // One transactional batch, ordered so FK enforcement (ON for pooled
        // connections) never bites: copy parents, copy children, drop the
        // legacy child BEFORE the legacy parent (dropping the parent first
        // would fire the child's ON DELETE CASCADE and wipe the rows we are
        // about to copy). The whole batch runs inside one ddl_step
        // transaction, so a partial earlier attempt cannot persist and plain
        // INSERT is sufficient.
        let mut batch = String::new();
        let mut drops: Vec<&str> = Vec::new();

        if legacy_msgs {
            if has_table(conn, "persona_reports")? {
                // Scrub orphans first: OR IGNORE does NOT cover FK violations,
                // and a legacy DB that never went through fk_hygiene can hold
                // rows whose parent persona is gone (same predicate as
                // fk_hygiene's cleanup and lib.rs::cleanup_orphan_rows).
                batch.push_str(
                    "DELETE FROM persona_messages
                       WHERE persona_id NOT IN (SELECT id FROM personas);
",
                );
                batch.push_str(&format!(
                    "INSERT INTO persona_reports ({REPORT_COLS})
                       SELECT {REPORT_COLS} FROM persona_messages;\n"
                ));
                drops.push("DROP TABLE persona_messages;");
            } else {
                batch.push_str("ALTER TABLE persona_messages RENAME TO persona_reports;\n");
            }
        }
        if legacy_dels {
            if has_table(conn, "persona_report_deliveries")? {
                batch.push_str(
                    "DELETE FROM persona_message_deliveries
                       WHERE message_id NOT IN (SELECT id FROM persona_messages);
",
                );
                batch.push_str(&format!(
                    "INSERT INTO persona_report_deliveries ({DELIVERY_COLS})
                       SELECT {DELIVERY_COLS} FROM persona_message_deliveries;\n"
                ));
                // Child drop must precede the parent drop.
                drops.insert(0, "DROP TABLE persona_message_deliveries;");
            } else {
                batch.push_str(
                    "ALTER TABLE persona_message_deliveries RENAME TO persona_report_deliveries;\n",
                );
            }
        }
        for drop in drops {
            batch.push_str(drop);
            batch.push('\n');
        }
        ddl_step(conn, &batch)?;
        tracing::info!(
            copied_messages = legacy_msgs,
            copied_deliveries = legacy_dels,
            "Renamed persona_messages -> persona_reports (Reports rebrand)"
        );
    }

    // SQLite's ALTER ... RENAME keeps old index names attached to the renamed
    // table, so recreate them under persona_reports-based names. Idempotent in
    // every branch: the copy branch drops legacy indexes with the legacy
    // tables, and fresh installs already carry the new names from schema.rs.
    if has_table(conn, "persona_reports")? {
        ddl_step(
            conn,
            "DROP INDEX IF EXISTS idx_pmsg_persona;
             DROP INDEX IF EXISTS idx_pmsg_is_read;
             DROP INDEX IF EXISTS idx_pmsg_created;
             DROP INDEX IF EXISTS idx_pmsg_thread;
             DROP INDEX IF EXISTS idx_pmsg_use_case;
             DROP INDEX IF EXISTS idx_pmd_message;
             DROP INDEX IF EXISTS idx_persona_messages_sync_watermark;
             CREATE INDEX IF NOT EXISTS idx_prpt_persona ON persona_reports(persona_id);
             CREATE INDEX IF NOT EXISTS idx_prpt_is_read ON persona_reports(is_read);
             CREATE INDEX IF NOT EXISTS idx_prpt_created ON persona_reports(created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_prpt_thread ON persona_reports(thread_id);
             CREATE INDEX IF NOT EXISTS idx_prpt_use_case ON persona_reports(use_case_id);",
        )?;
    }
    if has_table(conn, "persona_report_deliveries")? {
        ddl_step(
            conn,
            "CREATE INDEX IF NOT EXISTS idx_prd_message ON persona_report_deliveries(message_id);",
        )?;
    }

    Ok(())
}
