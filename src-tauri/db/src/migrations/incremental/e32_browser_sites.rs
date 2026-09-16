//! `browser_sites` — the Whitelist, the origin gate's only table.
//!
//! The row is the persistent, multi-origin generalisation of the single
//! pinned origin `browser_bridge::register_test_session` used to hold. It
//! descends from `athena-portable`'s `store.rs` `origins` table, whose one
//! decision is kept verbatim and is the whole point of the table:
//!
//! 1. **`enabled INTEGER NOT NULL DEFAULT 0` — deny by default.** A row can
//!    be created by an agent asking for a site (`browser_request_site`), so
//!    the row's existence must not by itself grant anything. Adding is
//!    cheap; enabling is the operator's act.
//! 2. **The origin IS the primary key.** The gate decides on an origin, so
//!    two rows claiming one origin would make "is this allowed" ambiguous.
//! 3. **`credential_id` is nullable with `ON DELETE SET NULL`.** Deleting a
//!    vault credential must un-bind the site, not delete the whitelist
//!    decision that outlives it — cascade would.
//! 4. **`scan_status` carries a CHECK.** The vocabulary is enforced here so
//!    a write through any other door (the management HTTP API, an importer)
//!    cannot mint a status the UI has no presentation for. The transitions
//!    themselves stay in Rust (`BrowserScanStatus`).
//!
//! The one index is `(enabled)`: the gate's only hot read is "the enabled
//! rows", and the Whitelist page reads the whole (small) table.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "browser_sites",
            description: "Browser control: browser_sites (deny-by-default origin whitelist)",
            already_applied: |conn| has_table(conn, "browser_sites"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS browser_sites (
                        origin         TEXT PRIMARY KEY NOT NULL,
                        label          TEXT NOT NULL DEFAULT '',
                        enabled        INTEGER NOT NULL DEFAULT 0,
                        overrides      TEXT NOT NULL DEFAULT '{}',
                        budget         INTEGER NOT NULL DEFAULT 50,
                        credential_id  TEXT NULL REFERENCES persona_credentials(id) ON DELETE SET NULL,
                        scan_status    TEXT NOT NULL DEFAULT 'none'
                                       CHECK (scan_status IN ('none','running','proposed','confirmed','failed')),
                        scan_tier      INTEGER NULL,
                        scan_report    TEXT NULL,
                        scan_at        INTEGER NULL,
                        first_seen     INTEGER NOT NULL,
                        last_seen      INTEGER NOT NULL,
                        created_by     TEXT NOT NULL
                    );",
                )?;
                Ok(())
            },
        },
    )?;

    Ok(())
}
