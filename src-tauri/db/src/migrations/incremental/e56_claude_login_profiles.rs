//! Claude plan re-login (spark `claude-plan-switch`).
//!
//! A dead stored login is revived by running the CLI's own `claude auth login`
//! in an isolated config dir while a per-account browser profile completes the
//! page. Three tables carry that, and none of them holds a secret:
//!
//! - `claude_login_profiles` - one row per browser profile (a Chrome
//!   `--user-data-dir`). `vault_credential_id` points at a vault login (the
//!   Proton mailbox password); the password itself never lives here.
//! - `claude_account_login_links` - which profile signs an account in, which
//!   profile's inbox receives its emailed code, and whether the re-login may
//!   run unattended. A SEPARATE table on purpose: `claude_accounts` rows are
//!   built field-by-field in several places, and a link is optional.
//! - `claude_relogin_runs` - the audit row, one per run, written whether or not
//!   the run succeeded. The unattended lane skips the orb's per-write approval,
//!   so this row is the compensating record.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "claude_login_profiles",
            description: "Claude re-login: browser profiles, account links and the run audit",
            already_applied: |conn| has_table(conn, "claude_login_profiles"),
            apply: |conn| {
                ddl_step(
                    conn,
                    "CREATE TABLE IF NOT EXISTS claude_login_profiles (
                        key                 TEXT PRIMARY KEY NOT NULL,
                        label               TEXT NOT NULL,
                        kind                TEXT NOT NULL DEFAULT 'chrome' CHECK (kind IN ('chrome')),
                        dir                 TEXT NOT NULL,
                        vault_credential_id TEXT,
                        last_warm_at_ms     INTEGER,
                        last_result         TEXT,
                        created_at_ms       INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS claude_account_login_links (
                        account_id             TEXT PRIMARY KEY NOT NULL,
                        profile_key            TEXT,
                        code_inbox_profile_key TEXT,
                        relogin_unattended     INTEGER NOT NULL DEFAULT 0,
                        updated_at_ms          INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS claude_relogin_runs (
                        id             INTEGER PRIMARY KEY AUTOINCREMENT,
                        account_id     TEXT NOT NULL,
                        trigger        TEXT NOT NULL,
                        started_at_ms  INTEGER NOT NULL,
                        finished_at_ms INTEGER,
                        outcome        TEXT NOT NULL,
                        reason         TEXT
                    );
                    CREATE INDEX IF NOT EXISTS idx_claude_relogin_runs_account
                        ON claude_relogin_runs(account_id, started_at_ms DESC);",
                )?;
                Ok(())
            },
        },
    )
}
