// db: split migrations.rs into per-version modules
//
// Why: The monolithic migrations.rs (4,187 LOC) was a merge-conflict
// magnet: every new migration required reading the whole file to find
// the right place to insert, and parallel PRs adding migrations at the
// end would conflict. Splitting into submodules lets each migration
// group live in isolation while the public API remains unchanged.
//
// Public API (unchanged):
//   - migrations::run(&conn)                    — initial schema + early migrations
//   - migrations::run_incremental(&conn)        — column/index/table additions
//   - migrations::ensure_composite_fires_table  — plugin tables (pub for engine use)
//
// Module layout:
//   schema.rs      — SCHEMA const (1,517 lines of CREATE TABLE / INDEX SQL)
//   initial.rs     — run() body: pre-schema ALTER TABLEs + SCHEMA + post-schema tables
//   incremental.rs — run_incremental() + ensure_composite_fires_table() bodies
//   helpers.rs     — migrate_blob_credentials_to_fields(), normalize_credential_field_keys(),
//                    classify_field_type() (all pub(super))

mod helpers;
mod incremental;
mod initial;
mod schema;

use rusqlite::Connection;

use crate::error::AppError;

/// Run the consolidated schema migration.
/// All 11 Vibeman migrations (090--112) are merged into a single idempotent schema.
pub fn run(conn: &Connection) -> Result<(), AppError> {
    initial::run(conn)
}

/// Incremental migrations for columns added after the initial schema.
pub fn run_incremental(conn: &Connection) -> Result<(), AppError> {
    incremental::run_incremental(conn)
}

/// Ensure the composite_trigger_fires table exists for persisting suppression state.
/// Also creates Artist, Obsidian, MCP gateway, lab Consensus, Twin plugin, and
/// Composition Workflow tables. Called from both run() and the engine directly.
pub fn ensure_composite_fires_table(conn: &Connection) -> Result<(), AppError> {
    incremental::ensure_composite_fires_table(conn)
}
