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
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::fleet_claude_login as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

use super::{build_snapshot, ClaudeAccountsSnapshot};

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

// ── Commands (WP0 signatures; WP1b replaces the stub bodies) ────────────────

/// Start a re-login for one stored account. Returns the state at the moment it
/// started; progress arrives as `fleet-claude-relogin-progress` events and the
/// final state on the next snapshot.
#[tauri::command]
pub async fn fleet_claude_relogin(
    state: State<'_, Arc<AppState>>,
    account_id: String,
) -> Result<ReloginState, AppError> {
    require_auth(&state).await?;
    let _ = account_id;
    Err(AppError::Validation(
        "re-login is not implemented yet (spark claude-plan-switch WP1b)".into(),
    ))
}

#[tauri::command]
pub async fn fleet_claude_profile_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<LoginProfileView>, AppError> {
    require_auth(&state).await?;
    Ok(repo::list_profiles(&state.db)?
        .iter()
        .map(profile_view)
        .collect())
}

/// Create or update a profile. The directory is derived by the backend
/// (`<app data>/claude-login-profiles/<key>`); the caller never supplies a path.
#[tauri::command]
pub async fn fleet_claude_profile_save(
    state: State<'_, Arc<AppState>>,
    key: String,
    label: String,
    vault_credential_id: Option<String>,
) -> Result<Vec<LoginProfileView>, AppError> {
    require_auth(&state).await?;
    let _ = (key, label, vault_credential_id);
    Err(AppError::Validation(
        "profile save is not implemented yet (spark claude-plan-switch WP1b)".into(),
    ))
}

/// Open the profile in a VISIBLE Chrome for a hand sign-in.
#[tauri::command]
pub async fn fleet_claude_profile_open_headed(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let _ = key;
    Err(AppError::Validation(
        "opening a profile is not implemented yet (spark claude-plan-switch WP1b)".into(),
    ))
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
