//! The re-login run: validate, start, drive, verify, ingest, settle.
//!
//! A run is `begin` (synchronous: the refusals and the audit row) followed by
//! `run` (the long part, spawned by the caller under a panic boundary).
//! `run` always ends in `settle`, which is the ONE place a run's outcome is
//! written: the audit row, the profile's last result, the in-memory state and
//! the progress event.
//!
//! The seams (`LaneLauncher`, `IdentitySource`, `VaultReader`, the CLI path,
//! the event sink, the timings) are fields of [`ReloginEnv`] so a test needs
//! neither the real CLI, nor real sites, nor a real vault.
//!
//! WHAT MUST NEVER HAPPEN, and where it is held:
//! - the live `~/.claude` login is never read or written: nothing in this file
//!   calls `live::read_live`/`write_live`; the CLI runs in a temp config dir;
//! - credentials of a DIFFERENT account never reach the store: the identity
//!   is resolved from the token itself and compared before `ingest`;
//! - no code, password, token, email body or authorize URL reaches a log, an
//!   event, an error or the audit row (the audit reason is the snake_case
//!   [`ReloginReason`] only).

use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use async_trait::async_trait;
use futures_util::FutureExt;
use tauri::{AppHandle, Emitter, Manager};
use zeroize::{Zeroize, Zeroizing};

use crate::db::repos::fleet_claude_accounts as accounts_repo;
use crate::db::repos::fleet_claude_login as repo;
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::engine::login_lane::{origin_allowed, LaneError, LaneMode, LaneSession};
use crate::error::AppError;

use super::super::live::{LiveCredentials, LiveIdentity};
use super::super::{ingest_credentials, oauth};
use super::cli::{self, ClaudeCli};
use super::flows::claude_page::{self, PageCtx};
use super::flows::email_code::InboxPlan;
use super::flows::{MailLogin, Timings, VaultReader};
use super::lane::{self, ChromeLauncher, LaneLauncher};
use super::{any_running, set_state, ReloginPhase, ReloginReason, ReloginState, ReloginStep};
use crate::commands::fleet::claude_usage::{now_ms, parse_credentials};

/// Re-logins an account may START per rolling hour.
const MAX_RUNS_PER_HOUR: i64 = 3;
const HOUR_MS: i64 = 3_600_000;
const PROTON_INBOX_URL: &str = "https://mail.proton.me/u/0/inbox";
const TEMP_DIR_NAME: &str = "personas-claude-relogin";
const CREDENTIALS_FILE: &str = ".credentials.json";

// ── Seams ───────────────────────────────────────────────────────────────────

/// Resolves who a token belongs to. Production asks Anthropic's profile
/// endpoint; a test answers from a fixture.
#[async_trait]
pub(super) trait IdentitySource: Send + Sync {
    async fn profile(&self, access_token: &str) -> Result<oauth::Profile, ReloginReason>;
}

struct OauthIdentity;

#[async_trait]
impl IdentitySource for OauthIdentity {
    async fn profile(&self, access_token: &str) -> Result<oauth::Profile, ReloginReason> {
        oauth::profile(access_token)
            .await
            .map_err(|_| ReloginReason::Other)
    }
}

/// Field names a vault login may keep the mailbox user and password under.
const USER_FIELDS: [&str; 5] = ["username", "email", "user", "login", "account"];
const PASS_FIELDS: [&str; 4] = ["password", "pass", "secret", "api_key"];

/// Reads a Proton mailbox login out of the vault, by credential id, through
/// the same repo door `browser_login` uses.
struct DbVault {
    db: DbPool,
}

impl VaultReader for DbVault {
    fn mail_login(&self, credential_id: &str) -> Option<MailLogin> {
        let cred = cred_repo::get_by_id(&self.db, credential_id).ok()?;
        let mut fields = match cred_repo::get_decrypted_fields(&self.db, &cred) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(error = %e, "claude relogin: mailbox login could not be decrypted");
                return None;
            }
        };
        let pick = |names: &[&str]| {
            names
                .iter()
                .find_map(|n| fields.get(*n).filter(|v| !v.is_empty()).cloned())
        };
        let (user, pass) = (pick(&USER_FIELDS), pick(&PASS_FIELDS));
        fields.values_mut().for_each(|v| v.zeroize());
        Some(MailLogin {
            user: Zeroizing::new(user?),
            pass: Zeroizing::new(pass?),
        })
    }
}

/// Everything a run needs from outside itself.
pub(super) struct ReloginEnv<L: LaneLauncher> {
    pub db: DbPool,
    pub launcher: L,
    pub app_data: PathBuf,
    pub temp_root: PathBuf,
    pub cli: ClaudeCli,
    pub identity: Arc<dyn IdentitySource>,
    pub vault: Arc<dyn VaultReader>,
    pub emit: Arc<dyn Fn(&ReloginState) + Send + Sync>,
    pub proton_url: String,
    pub timings: Timings,
}

/// The production wiring: real Chrome, the real CLI, the vault, the event bus.
pub(super) fn production_env(
    app: &AppHandle,
    db: DbPool,
) -> Result<ReloginEnv<ChromeLauncher>, AppError> {
    let app_data = app_data_dir(app)?;
    let events = app.clone();
    Ok(ReloginEnv {
        launcher: ChromeLauncher,
        temp_root: std::env::temp_dir().join(TEMP_DIR_NAME),
        cli: ClaudeCli::resolve(),
        identity: Arc::new(OauthIdentity),
        vault: Arc::new(DbVault { db: db.clone() }),
        emit: Arc::new(move |state: &ReloginState| {
            if let Err(e) = events.emit(event_name::FLEET_CLAUDE_RELOGIN_PROGRESS, state) {
                tracing::debug!(error = %e, "claude relogin: progress event not delivered");
            }
        }),
        proton_url: PROTON_INBOX_URL.to_string(),
        timings: Timings::PRODUCTION,
        app_data,
        db,
    })
}

pub(super) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app data directory: {e}")))
}

// ── Start ───────────────────────────────────────────────────────────────────

/// What `begin` decided.
pub(super) enum Begin {
    /// Not started; the state says why. Writes no audit row (a refusal is not
    /// a run, and a row would extend the rate-limit window it reports).
    Refused(ReloginState),
    Started(RunCtx),
}

/// A started run: the identity of the audit row the run settles.
#[derive(Debug, Clone)]
pub(super) struct RunCtx {
    pub account_id: String,
    pub trigger: String,
    pub started_at_ms: i64,
    pub run_id: i64,
}

fn start_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

fn state_for(
    account_id: &str,
    trigger: &str,
    started_at_ms: i64,
    phase: ReloginPhase,
    step: Option<ReloginStep>,
    reason: Option<ReloginReason>,
) -> ReloginState {
    ReloginState {
        account_id: account_id.to_string(),
        phase,
        step,
        reason,
        trigger: trigger.to_string(),
        started_at_ms,
    }
}

/// Validate and register a run. The check-and-set of "one run at a time" holds
/// a lock, so two clicks cannot both start.
pub(super) fn begin(db: &DbPool, account_id: &str, trigger: &str) -> Result<Begin, AppError> {
    if accounts_repo::get(db, account_id)?.is_none() {
        return Err(AppError::NotFound(format!(
            "stored Claude login {account_id}"
        )));
    }
    let _serial = start_lock().lock().unwrap_or_else(|e| e.into_inner());
    let now = now_ms();
    let refuse = |reason: ReloginReason| {
        state_for(
            account_id,
            trigger,
            now,
            ReloginPhase::NeedsYou,
            None,
            Some(reason),
        )
    };
    if any_running() {
        // Not recorded: it would overwrite the state of the run that is going.
        return Ok(Begin::Refused(refuse(ReloginReason::Busy)));
    }
    if repo::count_runs_since(db, account_id, now - HOUR_MS)? >= MAX_RUNS_PER_HOUR {
        let s = refuse(ReloginReason::RateLimited);
        set_state(s.clone());
        return Ok(Begin::Refused(s));
    }
    let linked = match repo::get_link(db, account_id)?.and_then(|l| l.profile_key) {
        Some(key) => repo::get_profile(db, &key)?.is_some(),
        None => false,
    };
    if !linked {
        let s = refuse(ReloginReason::ProfileNotLinked);
        set_state(s.clone());
        return Ok(Begin::Refused(s));
    }
    let run_id = repo::start_run(db, account_id, trigger)?;
    set_state(state_for(
        account_id,
        trigger,
        now,
        ReloginPhase::Running,
        Some(ReloginStep::OpeningProfile),
        None,
    ));
    Ok(Begin::Started(RunCtx {
        account_id: account_id.to_string(),
        trigger: trigger.to_string(),
        started_at_ms: now,
        run_id,
    }))
}

/// The state a freshly started run is in.
pub(super) fn running_state(cx: &RunCtx) -> ReloginState {
    state_for(
        &cx.account_id,
        &cx.trigger,
        cx.started_at_ms,
        ReloginPhase::Running,
        Some(ReloginStep::OpeningProfile),
        None,
    )
}

// ── The run ─────────────────────────────────────────────────────────────────

fn step_to<L: LaneLauncher>(env: &ReloginEnv<L>, cx: &RunCtx, step: ReloginStep) {
    let s = state_for(
        &cx.account_id,
        &cx.trigger,
        cx.started_at_ms,
        ReloginPhase::Running,
        Some(step),
        None,
    );
    set_state(s.clone());
    (env.emit)(&s);
}

fn other(detail: &str) -> LaneError {
    LaneError::new(ReloginReason::Other, detail)
}

/// Run to the end and settle. Never returns an error: the outcome is written.
async fn run<L: LaneLauncher>(env: &ReloginEnv<L>, cx: &RunCtx) {
    let result = execute(env, cx).await;
    settle(env, cx, result);
}

/// `run` under a panic boundary. A panic is a durable outcome (audit row,
/// state, event) rather than a silently dead task: the spawner discards the
/// handle precisely because this is what reports a death.
pub(super) async fn run_supervised<L: LaneLauncher>(env: &ReloginEnv<L>, cx: &RunCtx) {
    if AssertUnwindSafe(run(env, cx)).catch_unwind().await.is_err() {
        tracing::error!(account_id = %cx.account_id, "claude relogin: the run panicked");
        settle(env, cx, Err(other("the run panicked")));
    }
}

async fn execute<L: LaneLauncher>(env: &ReloginEnv<L>, cx: &RunCtx) -> Result<(), LaneError> {
    let account = accounts_repo::get(&env.db, &cx.account_id)
        .map_err(|_| other("account lookup"))?
        .ok_or_else(|| other("account vanished"))?;
    let link = repo::get_link(&env.db, &cx.account_id)
        .map_err(|_| other("link lookup"))?
        .ok_or_else(|| LaneError::new(ReloginReason::ProfileNotLinked, "no link"))?;
    let profile_key = link
        .profile_key
        .clone()
        .ok_or_else(|| LaneError::new(ReloginReason::ProfileNotLinked, "no profile"))?;
    let profile_dir = lane::profile_dir(&env.app_data, &profile_key)?;
    let inbox_dir = match link.code_inbox_profile_key.as_deref() {
        Some(k) => Some(lane::profile_dir(&env.app_data, k)?),
        None => None,
    };
    let credential_id = match link.code_inbox_profile_key.as_deref() {
        Some(k) => repo::get_profile(&env.db, k)
            .map_err(|_| other("inbox profile lookup"))?
            .and_then(|p| p.vault_credential_id),
        None => None,
    };

    step_to(env, cx, ReloginStep::OpeningProfile);
    std::fs::create_dir_all(&env.temp_root).map_err(|_| other("temp dir"))?;
    // Dropping the guard wipes the dir (credentials included) on EVERY path out.
    let work = tempfile::Builder::new()
        .prefix("run-")
        .tempdir_in(&env.temp_root)
        .map_err(|_| other("temp dir"))?;
    let shim = cli::write_browser_shim(work.path())?;
    let mut login = cli::spawn_login(&env.cli, &account.email, work.path(), &shim)?;
    let authorize_url = cli::wait_for_url(work.path(), &mut login, env.timings.url_wait).await?;
    let authorize_url = Zeroizing::new(authorize_url);
    if !origin_allowed(&authorize_url) {
        login.kill().await;
        return Err(other("authorize url outside the allowlist"));
    }

    let mut session = env
        .launcher
        .launch(&profile_dir, LaneMode::Headless)
        .await?;
    let plan = InboxPlan {
        launcher: &env.launcher,
        dir: inbox_dir,
        vault: env.vault.as_ref(),
        credential_id,
        url: &env.proton_url,
    };
    let ctx = PageCtx {
        email: &account.email,
    };
    let page = async {
        session.navigate(&authorize_url).await?;
        claude_page::drive(
            &mut session,
            &ctx,
            &plan,
            &env.timings,
            &mut || login.try_exit(),
            &|s| step_to(env, cx, s),
        )
        .await
    }
    .await;
    // Chrome flushes the profile's cookies on a graceful close.
    let _ = session.close().await;
    if let Err(e) = page {
        login.kill().await;
        return Err(e);
    }

    match login.wait_exit(env.timings.cli_exit).await {
        Some(true) => {}
        Some(false) => {
            return Err(LaneError::new(
                ReloginReason::CliFailed,
                "claude CLI failed",
            ))
        }
        None => {
            login.kill().await;
            return Err(LaneError::new(
                ReloginReason::Timeout,
                "claude CLI did not finish",
            ));
        }
    }

    step_to(env, cx, ReloginStep::Saving);
    save(env, &cx.account_id, work.path()).await
}

/// Read what the CLI wrote, prove it is the target account's, store it.
async fn save<L: LaneLauncher>(
    env: &ReloginEnv<L>,
    account_id: &str,
    config_dir: &std::path::Path,
) -> Result<(), LaneError> {
    let live = read_credentials(config_dir)
        .ok_or_else(|| LaneError::new(ReloginReason::CliFailed, "no credentials written"))?;
    let profile = env
        .identity
        .profile(&live.creds.access_token)
        .await
        .map_err(|reason| LaneError::new(reason, "identity not resolved"))?;
    if profile.account_uuid != account_id {
        // Nothing is written anywhere: not the store, not the live files.
        return Err(LaneError::new(
            ReloginReason::IdentityMismatch,
            "login belongs to a different account",
        ));
    }
    ingest_credentials(&env.db, &live, &LiveIdentity::default(), Some(profile))
        .map(|_| ())
        .map_err(|_| other("store the login"))
}

/// The CLI's credentials file in the temp config dir, parsed the way the live
/// file is.
fn read_credentials(dir: &std::path::Path) -> Option<LiveCredentials> {
    let raw = std::fs::read_to_string(dir.join(CREDENTIALS_FILE)).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let creds = parse_credentials(&doc)?;
    Some(LiveCredentials { raw, creds })
}

// ── Settle ──────────────────────────────────────────────────────────────────

/// The snake_case string a reason has on the wire; the only text an audit row
/// or a profile result ever carries about a failure.
pub(super) fn reason_str(reason: ReloginReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "other".to_string())
}

/// Reasons a human can fix (the strip offers a button); the rest are failures.
fn needs_a_human(reason: ReloginReason) -> bool {
    use ReloginReason::*;
    matches!(
        reason,
        ProfileCold
            | GoogleChallenge
            | CloudflareChallenge
            | Captcha
            | ProtonLoggedOut
            | ProtonSecondFactor
            | CodeInboxNotLinked
            | ProfileNotLinked
            | ChromeMissing
    )
}

/// Write a run's outcome everywhere it lives. Also the panic path's tail.
pub(super) fn settle<L: LaneLauncher>(
    env: &ReloginEnv<L>,
    cx: &RunCtx,
    result: Result<(), LaneError>,
) {
    let (outcome, reason, phase) = match &result {
        Ok(()) => ("done", None, ReloginPhase::Done),
        Err(e) if needs_a_human(e.reason) => ("needs_you", Some(e.reason), ReloginPhase::NeedsYou),
        Err(e) => ("failed", Some(e.reason), ReloginPhase::NeedsYou),
    };
    let reason_text = reason.map(reason_str);
    if let Err(e) = repo::finish_run(&env.db, cx.run_id, outcome, reason_text.as_deref()) {
        tracing::warn!(error = %e, "claude relogin: audit row not finished");
    }
    let profile_key = repo::get_link(&env.db, &cx.account_id)
        .ok()
        .flatten()
        .and_then(|l| l.profile_key);
    if let Some(key) = profile_key {
        let text = reason_text.as_deref().unwrap_or("ok");
        if let Err(e) = repo::mark_profile_result(&env.db, &key, result.is_ok(), text) {
            tracing::warn!(error = %e, "claude relogin: profile result not stamped");
        }
    }
    let state = state_for(
        &cx.account_id,
        &cx.trigger,
        cx.started_at_ms,
        phase,
        None,
        reason,
    );
    set_state(state.clone());
    (env.emit)(&state);
    tracing::info!(
        account_id = %cx.account_id,
        outcome,
        reason = reason_text.as_deref().unwrap_or(""),
        "claude relogin: run settled"
    );
}
