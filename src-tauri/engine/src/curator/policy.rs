//! Her standing policy and the registry she curates, read straight from the
//! database.
//!
//! Three thin readers that lived in `app_lib`'s command module for no reason
//! other than that the first caller was a `#[tauri::command]`. Nothing here
//! touches Tauri, an `AppState` or an `AppHandle`; it is `personas-db` plus
//! `personas-core`, which is exactly the reach this crate has.
//!
//! They moved so the headless re-projection binary can resolve which registry is
//! hers and what her policy says without linking the app. The alternative was the
//! binary re-deriving both, and two answers to "which registry is hers" is one
//! too many.

use personas_core::error::AppError;
use personas_core::models::{CuratorDecisionLevel, CuratorPolicy};
use personas_db::{repos, settings_keys, DbPool};

/// Read a setting, treating blank as ABSENT - which is how every optional
/// setting in her policy is written and cleared.
pub fn setting(db: &DbPool, key: &str) -> Option<String> {
    repos::core::settings::get(db, key)
        .ok()
        .flatten()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// One authority level, defaulting to the reading that claims least.
fn level(db: &DbPool, key: &str) -> CuratorDecisionLevel {
    setting(db, key)
        .and_then(|v| CuratorDecisionLevel::parse(&v))
        // A value the validator would have refused can only arrive by a
        // hand-edited database. `L0` is the reading that claims least: always
        // ask, never a permission nobody gave.
        .unwrap_or(CuratorDecisionLevel::L0)
}

/// The ten settings keys, as one typed value with the defaults resolved.
///
/// The four caps stay `None` when unset, which is NOT zero: `None` means the
/// operator has declared no ceiling, and a `0` would say she may never run.
pub fn load_policy(db: &DbPool) -> CuratorPolicy {
    let defaults = CuratorPolicy::default();
    CuratorPolicy {
        level_research: level(db, settings_keys::CURATOR_LEVEL_RESEARCH),
        level_forge: level(db, settings_keys::CURATOR_LEVEL_FORGE),
        level_conform: level(db, settings_keys::CURATOR_LEVEL_CONFORM),
        level_sweep: level(db, settings_keys::CURATOR_LEVEL_SWEEP),
        level_method: level(db, settings_keys::CURATOR_LEVEL_METHOD),
        daily_budget_usd: setting(db, settings_keys::CURATOR_DAILY_BUDGET_USD)
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 0.0),
        daily_run_cap: setting(db, settings_keys::CURATOR_DAILY_RUN_CAP)
            .and_then(|v| v.parse::<u32>().ok()),
        daily_commit_cap: setting(db, settings_keys::CURATOR_DAILY_COMMIT_CAP)
            .and_then(|v| v.parse::<u32>().ok()),
        quiet_hours: setting(db, settings_keys::CURATOR_QUIET_HOURS),
        backpressure_n: setting(db, settings_keys::CURATOR_BACKPRESSURE_N)
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|v| *v >= 1)
            .unwrap_or(defaults.backpressure_n),
        worker_cap: setting(db, settings_keys::CURATOR_WORKER_CAP)
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|v| *v >= 1)
            .unwrap_or(defaults.worker_cap),
    }
}

/// The registry she curates, for a caller that holds a pool rather than an
/// `AppState` - her loop, and the headless re-projection binary.
///
/// The first mapped registry whose `clone_path` is a real directory on this
/// disk. A path that is configured but absent is not a registry, which is the
/// reading that keeps "mapped" and "present" from being confused.
pub fn registry_root_of(db: &DbPool) -> Result<std::path::PathBuf, AppError> {
    let found = match repos::dev_registries::mapped(db) {
        Ok(rows) => rows.into_iter().map(|r| r.clone_path).find(|p| {
            let t = p.trim();
            !t.is_empty() && std::path::Path::new(t).is_dir()
        }),
        // A failed read must NOT report a wiring that may well be there - and it
        // must not propagate either, because both would tell the operator
        // something the read never established. Blocked is the reading that
        // claims least, and its remedy ("map a registry") is harmless if one
        // already is. Carried over verbatim from
        // `commands::companions::curator_registry`, whose behaviour this
        // function replaced: a move must not quietly change what a failure means.
        Err(e) => {
            tracing::warn!(error = %e, "curator: registry read failed - reporting no registry");
            None
        }
    };
    found.map(std::path::PathBuf::from).ok_or_else(|| {
        AppError::Validation(
            "Curator has no registry to curate: map a knowledge registry in Dev Tools > \
             Workspaces, and make sure its checkout is on this disk"
                .into(),
        )
    })
}
