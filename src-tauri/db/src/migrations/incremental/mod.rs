//! The incremental migration chain: every schema change made after the
//! initial consolidated schema, expressed as self-probing idempotent steps.
//!
//! There is no version table. Each `IncrementalMigration` decides for itself
//! whether it has already been applied (`has_column` / `has_table` /
//! `has_index` / a DDL-text probe) and `run_step` short-circuits when it has.
//! That makes the chain safe to re-run at every boot, which is exactly what
//! happens.
//!
//! **Order is the invariant.** The steps are not independent - later ones
//! assume earlier ones ran. The era modules below are contiguous slices of
//! one original 4,800-line function, and the driver calls them in that same
//! order. Adding a step means appending it to the LAST era module (or a new
//! one at the end); never insert into the middle and never reorder.

use rusqlite::Connection;

use personas_core::error::AppError;

mod support;

mod e01_execution_and_use_cases;
mod e02_credentials_and_audit_trails;
mod e03_p2p_and_telemetry;
mod e04_trigger_vocabulary_and_hot_paths;
mod e05_twin_and_memory_review;
mod e06_teams_and_sync;
mod e07_deliberation_and_scoring;
mod e08_sla_and_dev_tools;
mod e09_devices_and_provenance;
mod e10_reports_rename;
mod e11_persona_channel;
mod e12_shared_event_routes;
mod e13_execution_numeric_repair;
mod e14_project_team_invariant;
mod e15_memory_reaper_ledger;
mod e16_persona_run_paging_index;
mod e17_chain_trace_ordering_index;

mod c01_plugin_tables;
mod c02_dev_goals_and_kpis;
mod c03_fleet_and_workspaces;
mod c04_milestones_and_autopilot;

#[cfg(test)]
mod tests;

/// Incremental migrations for columns added after the initial schema.
/// Uses "ADD COLUMN ... IF NOT EXISTS" equivalent via PRAGMA table_info check.
///
/// Each era runs to completion before the next begins; the concatenation of
/// their step sequences is byte-for-byte the sequence this function executed
/// when it was a single body.
pub(super) fn run_incremental(conn: &Connection) -> Result<(), AppError> {
    e01_execution_and_use_cases::run(conn)?;
    e02_credentials_and_audit_trails::run(conn)?;
    e03_p2p_and_telemetry::run(conn)?;
    e04_trigger_vocabulary_and_hot_paths::run(conn)?;
    e05_twin_and_memory_review::run(conn)?;
    e06_teams_and_sync::run(conn)?;
    e07_deliberation_and_scoring::run(conn)?;
    e08_sla_and_dev_tools::run(conn)?;
    e09_devices_and_provenance::run(conn)?;
    e10_reports_rename::run(conn)?;
    e11_persona_channel::run(conn)?;
    e12_shared_event_routes::run(conn)?;
    e13_execution_numeric_repair::run(conn)?;
    e14_project_team_invariant::run(conn)?;
    e15_memory_reaper_ledger::run(conn)?;
    e16_persona_run_paging_index::run(conn)?;
    e17_chain_trace_ordering_index::run(conn)?;

    Ok(())
}

/// Ensure the composite_trigger_fires table exists for persisting suppression state.
pub fn ensure_composite_fires_table(conn: &Connection) -> Result<(), AppError> {
    c01_plugin_tables::run(conn)?;
    c02_dev_goals_and_kpis::run(conn)?;
    c03_fleet_and_workspaces::run(conn)?;
    c04_milestones_and_autopilot::run(conn)?;

    Ok(())
}
