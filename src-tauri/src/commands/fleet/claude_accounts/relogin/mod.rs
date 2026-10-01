//! Re-login for a dead Claude plan (spark `claude-plan-switch`).
//!
//! WP0 froze the wire types, the in-memory run state and the five command
//! signatures. WP1b fills `orchestrator` (the run itself); WP3 consumes the
//! types on the strip.
//!
//! The run: spawn `claude auth login --email <e>` with `CLAUDE_CONFIG_DIR` set
//! to a temp dir and `BROWSER` set to a shim that writes the authorize URL to a
//! file, drive the account's Chrome profile through the page, let the CLI's
//! `localhost` callback complete, verify the credentials in the temp dir belong
//! to the TARGET account, ingest them through the existing store path, wipe the
//! temp dir. The live `~/.claude` login is never touched.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::db::repos::fleet_claude_login as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use super::{build_snapshot, ClaudeAccountsSnapshot};

mod cli;
mod flows;
mod headed;
mod lane;
mod orchestrator;
#[cfg(test)]
mod tests;

use orchestrator::{Begin, ReloginEnv};

/// `ReloginState.trigger` of a click.
const TRIGGER_MANUAL: &str = "manual";

/// Why a run stopped needing a human, or failed. Snake-case strings on the wire;
/// the strip maps each to a locale string. Add a variant only with its string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ReloginReason {
    ChromeMissing,
    /// No profile is linked to this account.
    ProfileNotLinked,
    /// The profile is not signed in to claude.ai / Google (a human sign-in is needed).
    ProfileCold,
    GoogleChallenge,
    CloudflareChallenge,
    Captcha,
    /// The account signs in by emailed code but no inbox profile is linked.
    CodeInboxNotLinked,
    CodeNotFound,
    /// The inbox profile's Proton session lapsed and autofill did not finish it.
    ProtonLoggedOut,
    /// Proton asks for 2FA or the mailbox password: a human, in a visible window.
    ProtonSecondFactor,
    /// A page no longer looks like the flow expects.
    SelectorDrift,
    /// The credentials the login produced belong to a different account.
    IdentityMismatch,
    CliFailed,
    Timeout,
    /// 3 runs per hour per account.
    RateLimited,
    /// Another re-login is already running.
    Busy,
    Other,
}

/// Where a running re-login is, for the step chip.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ReloginStep {
    OpeningProfile,
    WaitingForCode,
    Authorising,
    Saving,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ReloginPhase {
    Running,
    /// A human is needed; `reason` says why.
    NeedsYou,
    /// Finished and the account is alive again.
    Done,
}

/// One account's re-login state. `None` on the account view means nothing has
/// run since the app started.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReloginState {
    pub account_id: String,
    pub phase: ReloginPhase,
    pub step: Option<ReloginStep>,
    pub reason: Option<ReloginReason>,
    /// `manual` (a click) or `proactive` (the unattended pass).
    pub trigger: String,
    #[ts(type = "number")]
    pub started_at_ms: i64,
}

/// A browser profile as the settings popover shows it. Never carries a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LoginProfileView {
    pub key: String,
    pub label: String,
    /// The bound vault login (Proton mailbox), or null.
    pub vault_credential_id: Option<String>,
    #[ts(type = "number | null")]
    pub last_warm_at_ms: Option<i64>,
    pub last_result: Option<String>,
}

/// Which profile signs an account in and which inbox receives its code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AccountLoginLink {
    pub profile_key: Option<String>,
    pub code_inbox_profile_key: Option<String>,
    pub relogin_unattended: bool,
}

// ── In-memory run state ─────────────────────────────────────────────────────

fn states() -> &'static Mutex<HashMap<String, ReloginState>> {
    static S: OnceLock<Mutex<HashMap<String, ReloginState>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn state_of(account_id: &str) -> Option<ReloginState> {
    states().lock().ok()?.get(account_id).cloned()
}

/// Forget every run state (tests share the process-wide map).
#[cfg(test)]
pub fn reset_states() {
    if let Ok(mut g) = states().lock() {
        g.clear();
    }
}

pub fn set_state(state: ReloginState) {
    if let Ok(mut g) = states().lock() {
        g.insert(state.account_id.clone(), state);
    }
}

/// True while any account's re-login is `Running` (one run at a time).
pub fn any_running() -> bool {
    states()
        .lock()
        .map(|g| g.values().any(|s| s.phase == ReloginPhase::Running))
        .unwrap_or(false)
}

pub fn profile_view(row: &repo::LoginProfileRow) -> LoginProfileView {
    LoginProfileView {
        key: row.key.clone(),
        label: row.label.clone(),
        vault_credential_id: row.vault_credential_id.clone(),
        last_warm_at_ms: row.last_warm_at_ms,
        last_result: row.last_result.clone(),
    }
}

pub fn link_view(row: &repo::AccountLinkRow) -> AccountLoginLink {
    AccountLoginLink {
        profile_key: row.profile_key.clone(),
        code_inbox_profile_key: row.code_inbox_profile_key.clone(),
        relogin_unattended: row.relogin_unattended,
    }
}

// ── Plain functions the commands adapt ──────────────────────────────────────

fn list_profile_views(db: &crate::db::DbPool) -> Result<Vec<LoginProfileView>, AppError> {
    Ok(repo::list_profiles(db)?.iter().map(profile_view).collect())
}

/// Validate, derive the directory, upsert, return the list.
fn save_profile(
    db: &crate::db::DbPool,
    app_data: &Path,
    key: &str,
    label: &str,
    vault_credential_id: Option<&str>,
) -> Result<Vec<LoginProfileView>, AppError> {
    personas_core::validation::require_non_empty("label", label)?;
    let dir = lane::profile_dir(app_data, key).map_err(headed::lane_to_app)?;
    repo::upsert_profile(
        db,
        key,
        label.trim(),
        &dir.to_string_lossy(),
        vault_credential_id,
    )?;
    list_profile_views(db)
}

/// Begin a run and, when it starts, spawn it under a panic boundary.
fn start_relogin(
    app: &AppHandle,
    db: &crate::db::DbPool,
    account_id: &str,
    trigger: &str,
) -> Result<ReloginState, AppError> {
    let env = orchestrator::production_env(app, db.clone())?;
    match orchestrator::begin(db, account_id, trigger)? {
        Begin::Refused(state) => {
            (env.emit)(&state);
            Ok(state)
        }
        Begin::Started(cx) => {
            let state = orchestrator::running_state(&cx);
            (env.emit)(&state);
            spawn_run(env, cx);
            Ok(state)
        }
    }
}

/// The run task. `run_supervised` catches a panic and settles it durably (audit
/// row, state, event), so the handle is not what reports a death.
fn spawn_run(env: ReloginEnv<lane::ChromeLauncher>, cx: orchestrator::RunCtx) {
    let _handle = tokio::spawn(async move { orchestrator::run_supervised(&env, &cx).await });
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Start a re-login for one stored account. Returns the state at the moment it
/// started (or the refusal: busy, rate limited, no profile linked); progress
/// arrives as `fleet-claude-relogin-progress` events and the final state on
/// the next snapshot.
#[tauri::command]
pub async fn fleet_claude_relogin(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    account_id: String,
) -> Result<ReloginState, AppError> {
    require_auth(&state).await?;
    start_relogin(&app, &state.db, &account_id, TRIGGER_MANUAL)
}

#[tauri::command]
pub async fn fleet_claude_profile_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<LoginProfileView>, AppError> {
    require_auth(&state).await?;
    list_profile_views(&state.db)
}

/// Create or update a profile. The directory is derived by the backend
/// (`<app data>/claude-login-profiles/<key>`); the caller never supplies a path.
#[tauri::command]
pub async fn fleet_claude_profile_save(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    key: String,
    label: String,
    vault_credential_id: Option<String>,
) -> Result<Vec<LoginProfileView>, AppError> {
    require_auth(&state).await?;
    let app_data = orchestrator::app_data_dir(&app)?;
    save_profile(
        &state.db,
        &app_data,
        &key,
        &label,
        vault_credential_id.as_deref(),
    )
}

/// Open the profile in a VISIBLE Chrome for a hand sign-in. Returns at once;
/// the window is closed by the human, or after 20 minutes.
#[tauri::command]
pub async fn fleet_claude_profile_open_headed(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    key: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    if repo::get_profile(&state.db, &key)?.is_none() {
        return Err(AppError::NotFound(format!("browser profile {key}")));
    }
    headed::open_headed(&orchestrator::app_data_dir(&app)?, &key).await
}

/// Link an account to its sign-in profile, its code inbox, and the unattended flag.
#[tauri::command]
pub async fn fleet_claude_account_profile_set(
    state: State<'_, Arc<AppState>>,
    account_id: String,
    profile_key: Option<String>,
    code_inbox_profile_key: Option<String>,
    relogin_unattended: bool,
) -> Result<ClaudeAccountsSnapshot, AppError> {
    require_auth(&state).await?;
    repo::set_link(
        &state.db,
        &repo::AccountLinkRow {
            account_id,
            profile_key,
            code_inbox_profile_key,
            relogin_unattended,
        },
    )?;
    build_snapshot(&state.db).await
}
