//! Curator's IPC surface - what she knows, and the two switches that are the
//! operator's.
//!
//! Placed in its own `commands/curator/` module rather than under
//! `infrastructure/` because the instrument and the projection are hers alone
//! and are a third of this file's neighbours by size; `commands/companions/`
//! stays the CATEGORY (who exists, who may be on), exactly as its header says.
//!
//! ## Six commands, where the design asked for eight
//!
//! Three were dropped and one was replaced, each with its call graph:
//!
//! - **`curator_settings_get` / `curator_settings_set` -> one
//!   `curator_policy_get`.** The SETTER is already `set_app_setting`, whose
//!   `require_valid_key` + `repos::core::settings::set` -> `validate_value`
//!   path is the real gate, now typed for all nine keys; a second door would
//!   be a second place to forget one. The GETTER is not redundant and is kept:
//!   reading nine keys one at a time and resolving each default in TypeScript
//!   is how two answers to "what is the policy" start to exist, and the
//!   projection needs the same typed value anyway.
//! - **`curator_decisions_list` dropped.** `curator_decision` has no writer in
//!   this package - no dispatch, no loop - so the command could only ever
//!   return `[]`, and a door with neither a caller nor a producer is dead
//!   surface twice over. The table and its constraints are built and tested;
//!   the package that raises the first decision adds the read with it.
//!
//! ## Where the registry checkout comes from
//!
//! [`crate::commands::companions::curator_registry`] and nowhere else. That
//! door is a row read AND an `is_dir()` stat, because a registry row can claim
//! everything is wired while the checkout has been deleted - and it is the same
//! door that decides whether Curator is `eligible` at all, so her status and
//! her instrument can never disagree about which corpus she is looking at. The
//! `app_settings.knowledge_registry_root` scalar is NOT used: it is a derived
//! convenience for the consult lane, and it carries no stat.

pub mod instrument;
pub mod process;
pub mod projection;

use std::sync::Arc;

use tauri::State;

use crate::db::{repos::curator as repo, settings_keys};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use personas_core::models::{
    CuratorConsentState, CuratorDecisionLevel, CuratorPlan, CuratorPolicy, CuratorProject,
};

/// Run a blocking read/write off the IPC worker. The curator lane touches
/// rusqlite AND the filesystem, so a sync command here would block it.
async fn blocking<T, F>(what: &'static str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("{what}: task failed: {e}")))?
}

/// The registry checkout Curator works in, or the typed refusal that names the
/// missing prerequisite.
///
/// `Validation` rather than `Forbidden` for `overseer_inactive_error`'s reason:
/// nothing is denied to the caller, a prerequisite is missing, and the message
/// says which and where to fix it.
fn registry_root(state: &Arc<AppState>) -> Result<std::path::PathBuf, AppError> {
    crate::commands::companions::curator_registry(&state.db)
        .map(|r| std::path::PathBuf::from(r.clone_path))
        .ok_or_else(|| {
            AppError::Validation(
                "Curator has no registry to curate: map a knowledge registry in Dev Tools > \
                 Workspaces, and make sure its checkout is on this disk"
                    .into(),
            )
        })
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/// Read a setting, treating blank as ABSENT - which is how every optional
/// setting in this file is written and cleared.
fn setting(db: &crate::db::DbPool, key: &str) -> Option<String> {
    crate::db::repos::core::settings::get(db, key)
        .ok()
        .flatten()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn level(db: &crate::db::DbPool, key: &str) -> CuratorDecisionLevel {
    setting(db, key)
        .and_then(|v| CuratorDecisionLevel::parse(&v))
        // A value the validator would have refused can only arrive by a
        // hand-edited database. `L0` is the reading that claims least: always
        // ask, never a permission nobody gave.
        .unwrap_or(CuratorDecisionLevel::L0)
}

/// The nine settings keys, as one typed value with the defaults resolved.
///
/// The four caps stay `None` when unset, which is NOT zero: `None` means the
/// operator has declared no ceiling, and a `0` would say she may never run.
pub fn load_policy(db: &crate::db::DbPool) -> CuratorPolicy {
    let defaults = CuratorPolicy::default();
    CuratorPolicy {
        level_research: level(db, settings_keys::CURATOR_LEVEL_RESEARCH),
        level_forge: level(db, settings_keys::CURATOR_LEVEL_FORGE),
        level_conform: level(db, settings_keys::CURATOR_LEVEL_CONFORM),
        level_sweep: level(db, settings_keys::CURATOR_LEVEL_SWEEP),
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

/// Curator's standing policy, typed, with defaults resolved.
///
/// Writes go through `set_app_setting`, not through a second door here - see
/// this module's header.
#[tauri::command]
pub async fn curator_policy_get(
    state: State<'_, Arc<AppState>>,
) -> Result<CuratorPolicy, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    blocking("curator_policy_get", move || Ok(load_policy(&db))).await
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/// Every checkout Curator may be given, reconciled against the disk first.
///
/// **This read writes, deliberately and narrowly.** It runs the registry's own
/// fleet resolver and records `root_path` and `last_seen_at` for every checkout
/// that exists - and nothing else. `enabled` and `consent_state` are the
/// operator's and [`repo::upsert_seen`] cannot touch them, which is what makes
/// a reconcile safe to do on a read: a project reappearing on disk is not the
/// operator changing their mind.
///
/// A checkout the resolver knows about but that is NOT on this disk is left
/// out entirely rather than recorded as absent - the allowlist is about paths
/// she could reach, and a row for a path that is not there would be a boundary
/// around nothing.
///
/// It reaches for [`instrument::read_fleet_only`], not the whole instrument:
/// measured 2026-09-23 the resolver is 0.3-0.5 s and the full pass ~11 s, and
/// listing projects has no business paying for a corpus scan.
#[tauri::command]
pub async fn curator_projects_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CuratorProject>, AppError> {
    require_auth(&state).await?;
    let root = registry_root(state.inner())?;
    let (fleet, problems) = instrument::read_fleet_only(&root).await?;
    let db = state.db.clone();
    let now = chrono::Utc::now().to_rfc3339();
    for problem in &problems {
        tracing::info!(problem = %problem, "curator: the registry's fleet resolver reported a problem");
    }
    blocking("curator_projects_list", move || {
        for project in fleet.iter().filter(|p| p.exists) {
            repo::upsert_seen(&db, &project.slug, &project.path, &now)?;
        }
        repo::list_projects(&db)
    })
    .await
}

/// The operator's switch for one checkout.
#[tauri::command]
pub async fn curator_project_set_enabled(
    state: State<'_, Arc<AppState>>,
    slug: String,
    enabled: bool,
) -> Result<CuratorProject, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let now = chrono::Utc::now().to_rfc3339();
    blocking("curator_project_set_enabled", move || {
        repo::set_enabled(&db, &slug, enabled, &now)
    })
    .await
}

/// The operator's answer for one checkout. `never_asked` is a real state and is
/// accepted here, because withdrawing a question is not the same as refusing
/// it.
#[tauri::command]
pub async fn curator_project_set_consent(
    state: State<'_, Arc<AppState>>,
    slug: String,
    consent: CuratorConsentState,
) -> Result<CuratorProject, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let now = chrono::Utc::now().to_rfc3339();
    blocking("curator_project_set_consent", move || {
        repo::set_consent(&db, &slug, consent, &now)
    })
    .await
}

// ---------------------------------------------------------------------------
// The process
// ---------------------------------------------------------------------------

/// The fleet's development sessions as structure-only process instances.
///
/// A read of the registry's extraction; the page derives the path and every
/// per-station figure. Cached for a minute (see `process::read`).
#[tauri::command]
pub async fn curator_process_read(
    state: State<'_, Arc<AppState>>,
) -> Result<process::CuratorProcess, AppError> {
    require_auth(&state).await?;
    let root = registry_root(state.inner())?;
    let reading = process::read(&root).await?;
    Ok((*reading).clone())
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/// The standing plan, or `None` when no projection has ever been made.
///
/// A pure read: it never runs the instrument. A surface that wants a fresh
/// reading asks for one.
#[tauri::command]
pub async fn curator_plan_current(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<CuratorPlan>, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    blocking("curator_plan_current", move || repo::current_plan(&db)).await
}

/// Run the instrument, project a plan, and land it as the standing one.
///
/// Async because it spawns up to four node processes - measured ~11 s cold,
/// and cached on the registry's HEAD for five minutes after that. The DB half
/// runs over `spawn_blocking` for the usual reason.
///
/// The projection's two alarms are LOGGED rather than swallowed: a clause this
/// app does not recognise, or recognised weights that do not add up to the
/// scan's own `points`, both mean the registry moved under the matcher. Neither
/// fails the refresh - a plan missing one clause is still worth showing, and
/// failing here would leave the operator with no plan at all and no way to see
/// why.
#[tauri::command]
pub async fn curator_plan_refresh(
    state: State<'_, Arc<AppState>>,
) -> Result<CuratorPlan, AppError> {
    require_auth(&state).await?;
    let root = registry_root(state.inner())?;
    let reading = instrument::read(&root).await?;
    let db = state.db.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let run_id = uuid::Uuid::new_v4().to_string();

    blocking("curator_plan_refresh", move || {
        let policy = load_policy(&db);
        let streaks = repo::idle_streaks(&db)?;
        let projected = projection::project(&reading, &policy, &streaks, &now);

        for miss in &projected.unmatched {
            tracing::warn!(
                subject = %miss.subject_id,
                clause = %miss.sentence,
                "curator: the registry wrote a clause this app does not recognise - the finding \
                 is carried in the item's reasons but routes nowhere"
            );
        }
        for subject in &projected.arithmetic_disagreements {
            tracing::warn!(
                subject = %subject,
                "curator: recognised clause weights do not sum to the scan's own points - the \
                 matcher and the registry's scoring have drifted"
            );
        }

        repo::insert_plan(&db, &run_id, &projected.run, &projected.items)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::init_test_db;

    /// An untouched install reads as "ask me about everything, no ceilings
    /// declared". Nothing here may default to a permission or to a zero.
    #[test]
    fn an_untouched_policy_is_the_shipped_default() {
        let pool = init_test_db().unwrap();
        assert_eq!(load_policy(&pool), CuratorPolicy::default());
    }

    /// Every key reaches its field, and the four caps come back as numbers
    /// rather than as strings the client would have to parse.
    #[test]
    fn every_setting_reaches_its_field() {
        let pool = init_test_db().unwrap();
        let set = |k: &str, v: &str| {
            crate::db::repos::core::settings::set(&pool, k, v).unwrap();
        };
        set(settings_keys::CURATOR_LEVEL_RESEARCH, "L3");
        set(settings_keys::CURATOR_LEVEL_FORGE, "L1");
        set(settings_keys::CURATOR_LEVEL_CONFORM, "L2");
        set(settings_keys::CURATOR_LEVEL_SWEEP, "L3");
        set(settings_keys::CURATOR_DAILY_BUDGET_USD, "12.50");
        set(settings_keys::CURATOR_DAILY_RUN_CAP, "20");
        set(settings_keys::CURATOR_DAILY_COMMIT_CAP, "3");
        set(settings_keys::CURATOR_QUIET_HOURS, "22:00-07:00");
        set(settings_keys::CURATOR_BACKPRESSURE_N, "5");
        set(settings_keys::CURATOR_WORKER_CAP, "4");

        let p = load_policy(&pool);
        assert_eq!(p.level_research, CuratorDecisionLevel::L3);
        assert_eq!(p.level_forge, CuratorDecisionLevel::L1);
        assert_eq!(p.level_conform, CuratorDecisionLevel::L2);
        assert_eq!(p.level_sweep, CuratorDecisionLevel::L3);
        assert_eq!(p.daily_budget_usd, Some(12.50));
        assert_eq!(p.daily_run_cap, Some(20));
        assert_eq!(p.daily_commit_cap, Some(3));
        assert_eq!(p.quiet_hours.as_deref(), Some("22:00-07:00"));
        assert_eq!(p.backpressure_n, 5);
        assert_eq!(p.worker_cap, 4);
    }

    /// Clearing a cap must give back "no ceiling declared", not zero. The
    /// validator accepts a blank precisely so this path exists.
    #[test]
    fn a_cleared_cap_is_absent_rather_than_zero() {
        let pool = init_test_db().unwrap();
        crate::db::repos::core::settings::set(&pool, settings_keys::CURATOR_DAILY_RUN_CAP, "20")
            .unwrap();
        assert_eq!(load_policy(&pool).daily_run_cap, Some(20));

        crate::db::repos::core::settings::set(&pool, settings_keys::CURATOR_DAILY_RUN_CAP, "   ")
            .unwrap();
        assert_eq!(
            load_policy(&pool).daily_run_cap,
            None,
            "a cleared cap is no ceiling, not a ceiling of zero"
        );

        // A declared ceiling of zero is a DIFFERENT, legitimate answer and must
        // survive: "she may not run today".
        crate::db::repos::core::settings::set(&pool, settings_keys::CURATOR_DAILY_RUN_CAP, "0")
            .unwrap();
        assert_eq!(load_policy(&pool).daily_run_cap, Some(0));
    }

    /// A value the validator would have refused can only arrive through a
    /// hand-edited database. `L0` is the reading that claims least.
    #[test]
    fn an_impossible_stored_level_reads_as_ask_me() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        // Past the validator, straight into the row.
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, 'L9')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![settings_keys::CURATOR_LEVEL_SWEEP],
        )
        .unwrap();
        drop(conn);
        assert_eq!(load_policy(&pool).level_sweep, CuratorDecisionLevel::L0);
        Ok(())
    }
}
