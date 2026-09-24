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
    curator_lane, CuratorConsentState, CuratorDecisionLevel, CuratorPlan, CuratorPolicy,
    CuratorProject, CuratorRequest, CuratorRuntime, CuratorSkill, CURATOR_SPEND_SOURCE,
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

// ---------------------------------------------------------------------------
// The skills she can dispatch
// ---------------------------------------------------------------------------

/// Every skill in the registry's two lanes, read off its disk.
///
/// There is no manifest to read: measured 2026-09-24, `catalog.json` carries
/// the 36 shared skills and NONE of the eight native ones. See
/// [`instrument::read_skills`].
#[tauri::command]
pub async fn curator_skills_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CuratorSkill>, AppError> {
    require_auth(&state).await?;
    let root = registry_root(state.inner())?;
    blocking("curator_skills_list", move || {
        instrument::read_skills(&root).map(|s| (*s).clone())
    })
    .await
}

// ---------------------------------------------------------------------------
// The operator's lane
// ---------------------------------------------------------------------------

/// How many requests one listing returns.
///
/// A person types into this lane, so the cap is a bound on a pathological
/// database rather than a page size the surface pages through - there is no
/// cursor and the list is ordered open-first for that reason.
const REQUEST_PAGE: u32 = 200;

/// Refuse a request the lane says cannot run, and refuse nothing else.
///
/// Two rules, and the difference between them is the rule this whole feature
/// is built around:
///
/// - A skill the registry's disk does not have is refused. A queued row naming
///   it could only ever fail at dispatch, one worker later.
/// - A skill whose documented invocation takes an argument is refused without
///   one. **A skill whose invocation is UNDOCUMENTED is not** - `runs_bare` is
///   `None` there, that is unknown rather than no, and refusing on it would be
///   this app inventing a rule the registry never wrote. Measured 2026-09-24,
///   `deepen` and `forge` are in exactly that state.
///
/// `argument` arrives NORMALISED - [`typed`] has already turned a blank into
/// `None` - so "the operator typed nothing" is one value here rather than
/// three, and this function never asks an emptiness question it would then
/// answer with a hand-written refusal. That sentence belongs to
/// `personas_core::validation`, and the door above uses it for `skill`.
pub(super) fn vet_request(
    skills: &[CuratorSkill],
    skill: &str,
    argument: Option<&str>,
) -> Result<(), AppError> {
    let Some(found) = skills.iter().find(|s| s.name == skill) else {
        let mut names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        names.sort_unstable();
        return Err(AppError::NotFound(format!(
            "the registry has no skill called '{skill}' - it carries {}",
            names.join(", ")
        )));
    };
    if found.runs_bare == Some(false) && argument.is_none() {
        return Err(AppError::Validation(format!(
            "'{skill}' documents no bare invocation, so it needs an argument{}",
            found
                .argument_hint
                .as_deref()
                .map(|hint| format!(" - the file states `{hint}`"))
                .unwrap_or_default()
        )));
    }
    Ok(())
}

/// What the operator actually typed, or nothing.
///
/// A blank and an absent field are ONE value below this line. `""` in
/// `argument` would put an empty token in a worker's brief, and `""` in `note`
/// would claim the operator wrote something when they wrote nothing - which is
/// the difference the whole lane's nullability exists to keep.
fn typed(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// The lane, open rows first and oldest first within each half.
#[tauri::command]
pub async fn curator_requests_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CuratorRequest>, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    blocking("curator_requests_list", move || {
        repo::list_requests(&db, REQUEST_PAGE)
    })
    .await
}

/// Put one request in the lane, vetted against the registry's own disk.
///
/// A blank `note` or `argument` is stored as NULL rather than as `""`: the
/// operator's words are carried into the worker's brief unchanged, and an
/// empty string would put a token there that nobody typed.
#[tauri::command]
pub async fn curator_request_create(
    state: State<'_, Arc<AppState>>,
    skill: String,
    argument: Option<String>,
    note: Option<String>,
) -> Result<CuratorRequest, AppError> {
    require_auth(&state).await?;
    personas_core::validation::require_non_empty("skill", &skill)?;
    let root = registry_root(state.inner())?;
    let db = state.db.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();
    blocking("curator_request_create", move || {
        let skills = instrument::read_skills(&root)?;
        let argument = typed(argument);
        let note = typed(note);
        vet_request(&skills, &skill, argument.as_deref())?;
        repo::create_request(&db, &id, &skill, argument.as_deref(), note.as_deref(), &now)
    })
    .await
}

/// The operator withdrawing a request. Only a queued one can be withdrawn -
/// see [`repo::cancel_request`].
#[tauri::command]
pub async fn curator_request_cancel(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<CuratorRequest, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let now = chrono::Utc::now().to_rfc3339();
    blocking("curator_request_cancel", move || {
        repo::cancel_request(&db, &id, &now)
    })
    .await
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

/// Why she is stopped, in the order the brakes bind.
///
/// The worker cap is deliberately NOT among them: every terminal being busy is
/// what she looks like while she is WORKING, and reporting it as a halt would
/// put the word "halted" on the screen at exactly the moment she is at full
/// stretch.
///
/// A cap the operator has not declared is `None` in the policy and brakes
/// nothing - never a ceiling of zero, which would read as a companion that may
/// never run.
fn halted_reason(
    enabled: bool,
    has_registry: bool,
    policy: &CuratorPolicy,
    spent_today_usd: f64,
    runs_today: u32,
    commits_today: u32,
) -> Option<String> {
    if !enabled {
        return Some("she is switched off".into());
    }
    if !has_registry {
        return Some("no knowledge registry is mapped on this disk".into());
    }
    if policy
        .daily_budget_usd
        .is_some_and(|cap| spent_today_usd >= cap)
    {
        return Some("today's budget is spent".into());
    }
    if policy.daily_run_cap.is_some_and(|cap| runs_today >= cap) {
        return Some("today's run cap is reached".into());
    }
    if policy
        .daily_commit_cap
        .is_some_and(|cap| commits_today >= cap)
    {
        return Some("today's commit cap is reached".into());
    }
    None
}

/// How many processes her terminals have fanned out to.
///
/// **Only one answer is knowable from here, and it is the zero.** No terminal
/// is no process, which is a measurement. One terminal is a Claude session
/// that may be `librarian` holding ten workers, `harvest` holding five or
/// `hygiene` holding six, and this package holds none of their pids - so the
/// honest answer is `None`, and reporting `running` would be reporting a
/// dispatcher's whole pool as one process.
///
/// A worker cap of 2 is therefore not a cap of 2 processes, which is the
/// reason this field is nullable at all.
fn fanned_out(running: u32) -> Option<u32> {
    (running == 0).then_some(0)
}

/// What her loop is doing right now, and every brake on it.
///
/// A READING, computed at call time from the policy, the fleet registry and
/// today's ledgers. Nothing is cached and there is no `curator_runtime` row:
/// a stored copy of "how many terminals are live" would be a second answer to
/// a question the registry already owns.
///
/// **This package has no loop**, so `running` is whatever a terminal somebody
/// else started with her origin reports - today, nothing. `lane` is still
/// computed rather than stubbed, because the precedence it expresses is real:
/// she drains the operator's lane before her own plan.
#[tauri::command]
pub async fn curator_runtime_get(
    state: State<'_, Arc<AppState>>,
) -> Result<CuratorRuntime, AppError> {
    require_auth(&state).await?;
    // The in-memory registry, not a row read: it is the admission authority
    // while the app runs, and it needs no pool.
    let running = crate::commands::fleet::queue::live_count_for_origin(
        crate::commands::fleet::queue::DispatchOrigin::Curator,
    );
    let db = state.db.clone();
    blocking("curator_runtime_get", move || {
        let policy = load_policy(&db);
        let enabled = crate::commands::companions::curator_enabled(&db);
        let has_registry = crate::commands::companions::curator_registry(&db).is_some();
        let spent_today_usd =
            crate::db::repos::llm_spend::source_today(&db, CURATOR_SPEND_SOURCE)?.0;
        let runs_today = crate::db::repos::fleet_sessions::count_started_today_for_origin(
            &db,
            crate::commands::fleet::queue::DispatchOrigin::Curator.token(),
        )?;
        let commits_today = repo::commits_today(&db)?;
        // She drains the operator's lane before her own plan, so an open
        // request IS the lane she is serving. Open, not queued: a dispatched
        // request is one she is still carrying out.
        let open_requests = repo::list_requests(&db, REQUEST_PAGE)?
            .into_iter()
            .any(|r| !r.state.is_settled());
        Ok(CuratorRuntime {
            enabled,
            running,
            worker_cap: policy.worker_cap,
            fanned_out: fanned_out(running),
            lane: if open_requests {
                curator_lane::QUEUE.into()
            } else {
                curator_lane::PLAN.into()
            },
            halted_reason: halted_reason(
                enabled,
                has_registry,
                &policy,
                spent_today_usd,
                runs_today,
                commits_today,
            ),
            spent_today_usd,
            // A cap the operator never declared is `None` in the policy and
            // `0` on this wire, which every consumer of it reads as "no
            // ceiling" - the convention `monthly_cost_ceiling_usd` already
            // ships. The policy door beside this one carries the nullable
            // truth, and the console prefers it for exactly that reason.
            daily_budget_usd: policy.daily_budget_usd.unwrap_or(0.0),
            runs_today,
            daily_run_cap: policy.daily_run_cap.unwrap_or(0),
            commits_today,
            daily_commit_cap: policy.daily_commit_cap.unwrap_or(0),
            // No loop, so no sleep has ever happened. `None` is the honest
            // answer and never an epoch-zero timestamp.
            last_sleep_at: None,
        })
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

    // -----------------------------------------------------------------------
    // The runtime
    // -----------------------------------------------------------------------

    fn skill(name: &str, runs_bare: Option<bool>, hint: Option<&str>) -> CuratorSkill {
        CuratorSkill {
            name: name.into(),
            lane: personas_core::models::CuratorSkillLane::Native,
            path: format!(".claude/skills/{name}/SKILL.md"),
            title: None,
            description: None,
            version: None,
            invocation_documented: runs_bare.is_some(),
            runs_bare,
            argument_hint: hint.map(str::to_string),
        }
    }

    /// The door refuses a skill the registry does not have, refuses a
    /// documented argument-taker with no argument, and **accepts a skill whose
    /// invocation is undocumented** - because `None` is unknown, not no.
    #[test]
    fn the_door_refuses_on_a_documented_no_and_never_on_an_unknown() {
        let lane = [
            skill("hygiene", Some(true), None),
            skill("assay", Some(false), Some("/assay <url|path|->")),
            skill("deepen", None, None),
        ];

        assert!(vet_request(&lane, "hygiene", None).is_ok());
        assert!(vet_request(&lane, "assay", Some("https://example.test/a")).is_ok());

        let missing = vet_request(&lane, "nonesuch", None).unwrap_err();
        assert!(matches!(missing, AppError::NotFound(_)), "{missing:?}");

        let bare = vet_request(&lane, "assay", None).unwrap_err();
        match bare {
            AppError::Validation(msg) => assert!(
                msg.contains("/assay <url|path|->"),
                "the refusal quotes the file's own line: {msg}"
            ),
            other => panic!("{other:?}"),
        }
        // Whitespace is not an argument - and it is the DOOR that decides
        // that, once, so the vetting below only ever sees `None`.
        assert_eq!(typed(Some("   ".into())), None);
        assert_eq!(
            typed(Some("  https://x.test  ".into())).as_deref(),
            Some("https://x.test")
        );
        assert_eq!(typed(None), None);
        assert!(vet_request(&lane, "assay", typed(Some("   ".into())).as_deref()).is_err());

        // The one that matters: `deepen` documents NO invocation, so this app
        // has no basis to refuse it. Reading `None` as "needs an argument" -
        // or as "runs bare" - would both be inventing a rule the registry
        // never wrote.
        assert!(vet_request(&lane, "deepen", None).is_ok());
        assert!(vet_request(&lane, "deepen", Some("anything")).is_ok());
    }

    /// The brakes bind in order, an undeclared cap brakes nothing, and a busy
    /// worker pool is NOT a halt.
    #[test]
    fn the_brakes_bind_in_order_and_a_full_pool_is_not_one() {
        let mut policy = CuratorPolicy::default();

        assert_eq!(
            halted_reason(false, true, &policy, 0.0, 0, 0).as_deref(),
            Some("she is switched off")
        );
        assert_eq!(
            halted_reason(true, false, &policy, 0.0, 0, 0).as_deref(),
            Some("no knowledge registry is mapped on this disk")
        );
        // The shipped policy declares no ceilings, so nothing else brakes -
        // however much has been spent or run.
        assert_eq!(halted_reason(true, true, &policy, 999.0, 999, 999), None);

        policy.daily_budget_usd = Some(5.0);
        assert_eq!(halted_reason(true, true, &policy, 4.99, 0, 0), None);
        assert_eq!(
            halted_reason(true, true, &policy, 5.0, 0, 0).as_deref(),
            Some("today's budget is spent")
        );

        policy.daily_budget_usd = None;
        policy.daily_run_cap = Some(3);
        assert_eq!(halted_reason(true, true, &policy, 0.0, 2, 0), None);
        assert_eq!(
            halted_reason(true, true, &policy, 0.0, 3, 0).as_deref(),
            Some("today's run cap is reached")
        );

        policy.daily_run_cap = None;
        policy.daily_commit_cap = Some(1);
        assert_eq!(
            halted_reason(true, true, &policy, 0.0, 0, 1).as_deref(),
            Some("today's commit cap is reached")
        );

        // A declared ceiling of ZERO is a real answer - "not today" - and it
        // brakes from the first unit.
        policy.daily_commit_cap = Some(0);
        assert!(halted_reason(true, true, &policy, 0.0, 0, 0).is_some());
    }

    /// **Only the zero is knowable.** No terminal is no process; one terminal
    /// may be a dispatcher holding ten, and this package holds none of their
    /// pids.
    #[test]
    fn fanned_out_is_zero_or_unknown_and_never_the_terminal_count() {
        assert_eq!(fanned_out(0), Some(0));
        for running in 1..=10 {
            assert_eq!(
                fanned_out(running),
                None,
                "a live terminal's pool is not visible from here"
            );
        }
    }

    /// The operator asked for two concurrent terminals. The default is spelled
    /// twice - here through the policy, and in `settings_keys` as the
    /// validator's own constant - because the `core` crate cannot depend on
    /// `db`.
    #[test]
    fn the_shipped_worker_cap_is_two() {
        let pool = init_test_db().unwrap();
        assert_eq!(settings_keys::CURATOR_WORKER_CAP_DEFAULT, 2);
        assert_eq!(load_policy(&pool).worker_cap, 2);
        assert_eq!(
            load_policy(&pool).worker_cap,
            settings_keys::CURATOR_WORKER_CAP_DEFAULT,
            "the two spellings of the default must agree"
        );
    }
}
