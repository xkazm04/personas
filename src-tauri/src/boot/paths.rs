//! Boot phase: where the app data lives, and getting logs onto disk.

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::logging;
use crate::startup_timing::StartupTimer;

// Data-dir override for parallel-CLI / multi-instance testing
// (multi-driver orchestration, ADR 2026-05-26). When
// PERSONAS_DATA_DIR is set, use it instead of the OS app-data dir so
// a cluster of test instances can share an ISOLATED DB + engine-leader
// lock (`engine-leader.lock` lives in this dir) without ever touching
// the user's real production data dir — the DB-isolation counterpart
// to PERSONAS_WEBHOOK_PORT / PERSONAS_VITE_PORT / PERSONAS_TEST_PORT.
// Unset (default) keeps unchanged production behavior. Created if
// missing.
pub fn resolve_app_data_dir(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let app_data_dir = match std::env::var("PERSONAS_DATA_DIR") {
        Ok(dir) if !dir.trim().is_empty() => {
            let p = std::path::PathBuf::from(dir.trim());
            std::fs::create_dir_all(&p)
                .map_err(|e| format!("Failed to create PERSONAS_DATA_DIR {}: {e}", p.display()))?;
            tracing::info!(
                data_dir = %p.display(),
                "using PERSONAS_DATA_DIR override (multi-instance test isolation)"
            );
            p
        }
        _ => app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {e}"))?,
    };

    Ok(app_data_dir)
}

// File logging must be installed BEFORE the database opens.
//
// Moved here 2026-08-15 from just after `connector_registry`. The
// migration chain's only receipt is `tracing::info!("Applied
// incremental migration …")`, and with the file layer installed at
// the ~5.1 s checkpoint while `db_init` runs from 0 to ~4.6 s, every
// one of those lines went to a sink that did not exist yet. Six days
// of rolling logs contain ZERO "Applied incremental migration", zero
// "Initializing database", and zero "Pre-migration DB backup
// created" — while three backup files on disk prove the backup ran
// three times today.
//
// That is how a migration could undo and redo itself on every launch
// for nine weeks without leaving a trace. `app_data_dir` is already
// resolved above, so this is purely an ordering change.
pub fn install_file_logging(app_data_dir: &Path, st: &mut StartupTimer) {
    logging::add_file_layer(app_data_dir);
    st.checkpoint("file_logging");
}
