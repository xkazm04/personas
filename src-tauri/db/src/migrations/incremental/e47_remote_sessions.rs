//! Remote sessions: the durable half of dispatching a fleet session to another
//! of the operator's paired devices, and of tracking it from both ends.
//!
//! Four nullable columns on `remote_jobs`:
//!
//! - `payload_json` - the kind-specific request body. `NULL` for the original
//!   `instruction` kind, whose whole request is the `instruction` text; a
//!   `fleet_session` job carries a `FleetSessionJobPayload` here.
//! - `receipt_json` - the running device's completion receipt
//!   (`FleetSessionJobReceipt`: branch, pushed SHA, push error) and, on the
//!   originating device, the harvest's `verified` verdict. `NULL` until the job
//!   is terminal, and always `NULL` for `instruction`.
//! - `mirror_json` / `mirror_at` - the originating device's last-known view of
//!   the remote session (`RemoteSessionView`), latest-wins. Persisted so a
//!   restart paints the tile from the last mirror instead of a blank, while the
//!   liveness rule still reads it as `unknown` until the peer speaks again.
//!
//! Two nullable columns on `fleet_sessions`, set only on the RUNNING device for
//! a session a peer dispatched: `remote_job_id` (the job that spawned it) and
//! `origin_peer_id` (who asked). `NULL` on every locally started session, which
//! is every pre-existing row.
//!
//! No status CHECK changes: `remote_jobs.status` never had one, so the new
//! `queued` token (an outbound job waiting for its peer to come online) needs
//! no rebuild. Guarded per column with `has_column`, exactly like e39, so a
//! half-applied run resumes. Not `p2p`-gated, for the same reason e09's tables
//! are not: a lite build must migrate the same schema.

use rusqlite::Connection;

use personas_core::error::AppError;

use super::support::*;

const REMOTE_JOB_COLUMNS: &[(&str, &str)] = &[
    ("payload_json", "TEXT"),
    ("receipt_json", "TEXT"),
    ("mirror_json", "TEXT"),
    ("mirror_at", "TEXT"),
];

const FLEET_SESSION_COLUMNS: &[(&str, &str)] =
    &[("remote_job_id", "TEXT"), ("origin_peer_id", "TEXT")];

fn every_column_present(
    conn: &Connection,
    table: &str,
    columns: &[(&str, &str)],
) -> Result<bool, AppError> {
    if !has_table(conn, table)? {
        return Ok(true);
    }
    for (column, _) in columns {
        if !has_column(conn, table, column)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn add_missing_columns(
    conn: &Connection,
    table: &str,
    columns: &[(&str, &str)],
) -> Result<(), AppError> {
    if !has_table(conn, table)? {
        return Ok(());
    }
    for (column, ddl_type) in columns {
        if has_column(conn, table, column)? {
            continue;
        }
        ddl_step(
            conn,
            &format!("ALTER TABLE {table} ADD COLUMN {column} {ddl_type};"),
        )?;
    }
    Ok(())
}

pub(super) fn run(conn: &Connection) -> Result<(), AppError> {
    run_step(
        conn,
        IncrementalMigration {
            id: "remote_jobs.remote_session_columns",
            description: "Add payload, receipt and last-mirror columns to remote_jobs (fleet_session job kind)",
            already_applied: |conn| every_column_present(conn, "remote_jobs", REMOTE_JOB_COLUMNS),
            apply: |conn| add_missing_columns(conn, "remote_jobs", REMOTE_JOB_COLUMNS),
        },
    )?;
    run_step(
        conn,
        IncrementalMigration {
            id: "fleet_sessions.remote_origin_columns",
            description: "Add remote_job_id and origin_peer_id to fleet_sessions (sessions a paired device dispatched)",
            already_applied: |conn| {
                every_column_present(conn, "fleet_sessions", FLEET_SESSION_COLUMNS)
            },
            apply: |conn| add_missing_columns(conn, "fleet_sessions", FLEET_SESSION_COLUMNS),
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_real_chain_carries_every_column_and_a_rerun_is_a_no_op() {
        let pool = crate::init_test_db().expect("test db");
        let conn = pool.get().expect("conn");
        assert!(every_column_present(&conn, "remote_jobs", REMOTE_JOB_COLUMNS).unwrap());
        assert!(every_column_present(&conn, "fleet_sessions", FLEET_SESSION_COLUMNS).unwrap());
        run(&conn).expect("a second run over an applied schema is idempotent");
        assert!(every_column_present(&conn, "remote_jobs", REMOTE_JOB_COLUMNS).unwrap());
    }
}
