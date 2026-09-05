//! Stored Claude Code logins — the Activity board's multi-plan switcher.
//!
//! One row per Claude account the operator has captured from the CLI's live
//! login. The credentials file is stored WHOLE, encrypted with the app's
//! master key (`crypto::encrypt_for_db`), so a switch writes back exactly
//! what the CLI wrote and nothing this app invented. `slot` is the stable
//! human ordinal ("plan 3"); `id` is the account uuid Anthropic assigns.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "claude_accounts",
            description: "Stored Claude Code logins for the multi-plan usage switcher",
            already_applied: |conn| has_table(conn, "claude_accounts"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS claude_accounts (
                        id                  TEXT PRIMARY KEY,
                        email               TEXT NOT NULL,
                        display_name        TEXT,
                        organization_uuid   TEXT,
                        organization_name   TEXT,
                        rate_limit_tier     TEXT,
                        subscription_type   TEXT,
                        slot                INTEGER NOT NULL,
                        creds_ciphertext    TEXT NOT NULL,
                        creds_nonce         TEXT NOT NULL,
                        quarantine_reason   TEXT,
                        added_at_ms         INTEGER NOT NULL,
                        updated_at_ms       INTEGER NOT NULL,
                        last_switched_at_ms INTEGER
                    );
                    CREATE INDEX IF NOT EXISTS idx_claude_accounts_slot
                        ON claude_accounts(slot);",
                )?;
                Ok(())
            },
        },
    )?;
    Ok(())
}
