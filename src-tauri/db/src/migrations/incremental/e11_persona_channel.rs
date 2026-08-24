//! Persona channel chat lens (channels-v2 Lane B, W3): a nullable
//! `persona_id` on `team_channel_messages` so a basic (non-team) persona's
//! conversation can live in the SAME multi-author table the team channel
//! uses — no second message table, no second slice.
//!
//! Persona-channel rows carry a sentinel `team_id = 'persona:<persona_id>'`
//! (the column is NOT NULL with no FK; a sentinel keeps team-scoped readers
//! and the orchestrator's delivery machinery — which all filter on real team
//! ids — structurally blind to these rows) AND the real id in `persona_id`,
//! which is what the persona read-model filters on.
//!
//! Two boot paths converge: fresh installs get the column + index from the
//! canonical DDL in `support.rs` (the team_channel_messages CREATE TABLE
//! runs in phase 1); upgrade DBs get them here. Same-boot convergence works
//! exactly like e07's `deliberation_id`: the phase-1 index create fails
//! silently on an upgrade DB that lacks the column, and this step then adds
//! both.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "team_channel_messages.persona_id",
            description: "Add persona_id to team_channel_messages (channels-v2 persona channel)",
            already_applied: |conn| has_column(conn, "team_channel_messages", "persona_id"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "ALTER TABLE team_channel_messages ADD COLUMN persona_id TEXT;",
                )
            },
        },
    )?;

    run_step(
        conn,
        IncrementalMigration {
            id: "idx_team_channel_messages_persona",
            description:
                "Index team_channel_messages(persona_id, created_at DESC) for the persona chat lens",
            already_applied: |conn| has_index(conn, "idx_team_channel_messages_persona"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE INDEX IF NOT EXISTS idx_team_channel_messages_persona
                        ON team_channel_messages(persona_id, created_at DESC);",
                )
            },
        },
    )?;

    Ok(())
}
