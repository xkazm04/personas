//! Athena flags: a per-session grant and a per-persona default.
//!
//! Two columns, not one, because they have different lifetimes:
//!
//! - `fleet_sessions.athena_flagged` IS the grant. It says "Athena may act on
//!   this session" and lives and dies with the session row.
//! - `personas.athena_auto_flag` is a DEFAULT that stamps FUTURE sessions of
//!   that persona when they start. It grants nothing to a session that already
//!   exists.
//!
//! Folding them into one column would make "flag this persona" either silently
//! retroactive (every live session suddenly granted) or silently forgetful
//! (the flag vanishes with the session and the next one starts unflagged).
//!
//! `NOT NULL DEFAULT 0`: nothing is flagged until someone says so.
//!
//! Guarded with `has_table` / `has_column` like every other step here.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.athena_flagged",
            description: "Add athena_flagged to fleet_sessions (per-session Athena grant)",
            already_applied: |conn| {
                Ok(!has_table(conn, "fleet_sessions")?
                    || has_column(conn, "fleet_sessions", "athena_flagged")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE fleet_sessions ADD COLUMN athena_flagged INTEGER NOT NULL DEFAULT 0;",
                )
            },
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "personas.athena_auto_flag",
            description: "Add athena_auto_flag to personas (default that stamps future sessions)",
            already_applied: |conn| {
                Ok(!has_table(conn, "personas")?
                    || has_column(conn, "personas", "athena_auto_flag")?)
            },
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE personas ADD COLUMN athena_auto_flag INTEGER NOT NULL DEFAULT 0;",
                )
            },
        },
    )
}
