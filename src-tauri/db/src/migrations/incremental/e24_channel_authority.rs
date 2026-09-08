//! Authority on a channel message (Grand Simulation G3).
//!
//! One nullable column on `team_channel_messages`:
//!
//! * `authority` — `'directive'` | `'request'` | `'note'`, or NULL.
//!
//! Until this column existed a channel message carried no rank at all. The
//! nearest thing was `author_kind` (user / persona / athena / slack), which
//! says WHO spoke, not with what weight — so an Architect persona directing
//! six App Masters was, to every reader in the engine, indistinguishable from
//! a persona thinking out loud. The wake predicate
//! (`team_channel::oldest_unanswered_persona_message`) read `author_kind =
//! 'user'` only, which is why no persona could ever be woken by another.
//!
//! **Nullable, and no backfill.** Every row written before this column existed
//! declared no authority, and there is nothing to infer one from: a `'user'`
//! row may have been an order or an aside and the row does not say which.
//! Stamping them all `note` (or all `directive`) would manufacture exactly the
//! rank this column exists to record honestly. Readers therefore treat NULL as
//! "no authority declared", never as `note`.
//!
//! **No CHECK, deliberately.** `team_channel_messages` constrains neither
//! `author_kind` nor `consumer` in SQL, and an `ALTER TABLE ADD COLUMN` CHECK
//! would bind upgrade databases while the canonical `CREATE TABLE` in
//! `support.rs` left fresh installs unconstrained — two schemas for one
//! column. The vocabulary is enforced at the one repo door that writes it
//! (`team_channel::create_with_authority`), which is also the only place that
//! can return a `Validation` error the caller can read.
//!
//! **No index.** The wake predicate already narrows by persona membership and
//! the created_at window before it ever looks at `authority`; the decision
//! context reads the newest N rows of a team through
//! `idx_team_channel_messages_team`. Neither filters on this column first.
//!
//! Two boot paths converge exactly as e11's `persona_id` does: fresh installs
//! get the column from the canonical DDL in `support.rs` (phase 1), upgrade
//! databases get it here (phase 2), and this step's `has_column` probe makes
//! the fresh path a no-op.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "team_channel_messages.authority",
            description: "Add authority to team_channel_messages (directive | request | note; G3)",
            already_applied: |conn| has_column(conn, "team_channel_messages", "authority"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_channel_messages ADD COLUMN authority TEXT;",
                )
            },
        },
    )?;

    Ok(())
}
