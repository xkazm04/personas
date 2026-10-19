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
//   - migrations::ensure_composite_fires_table  — plugin tables (run by initial::run;
//                                                no caller outside this crate)
//
// Module layout (re-checked against the tree 2026-10-19):
//   schema.rs      — the SCHEMA const (CREATE TABLE / INDEX SQL) plus
//                    resolved_schema(), which substitutes its markers; the
//                    resolved text, not SCHEMA itself, is what initial.rs runs
//   initial.rs     — run() body: pre-schema ALTER TABLEs + resolved schema +
//                    post-schema tables
//   incremental/   — a directory, not a file: mod.rs holds run_incremental() and
//                    ensure_composite_fires_table(); support.rs the step
//                    driver (run_step / ddl_step / has_column ...); one era
//                    module per contiguous slice of the original function
//                    (e01.., c01..), called in the order incremental/mod.rs lists
//   fk_hygiene.rs  — retrofits ON DELETE foreign keys by rebuilding child
//                    tables (recreate_with_fk)
//   helpers.rs     — the data-shaped one-shot steps the chain calls, all
//                    pub(super): the credential blob -> field split and its
//                    clear/assert pair, credential key normalisation, the idea
//                    category reconcile and the persona-memory invariants.
//                    classify_field_type()/NON_SENSITIVE_KEYS/FIELD_KEY_RENAMES
//                    live in db::credential_fields (shared with
//                    db::repos::resources::credentials and
//                    commands::core::data_portability to avoid classification drift).

mod fk_hygiene;
mod helpers;
mod incremental;
mod initial;
mod schema;

use rusqlite::Connection;

use personas_core::error::AppError;

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
/// Also creates Obsidian, MCP gateway, lab Consensus, Twin plugin, and
/// Composition Workflow tables. Called from initial::run() (phase 1) and the
/// incremental tests; nothing outside this crate calls it.
pub fn ensure_composite_fires_table(conn: &Connection) -> Result<(), AppError> {
    incremental::ensure_composite_fires_table(conn)
}
