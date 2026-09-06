//! Multi-plan Claude logins — monitor every stored subscription, switch the
//! CLI's live login on click, and (opt-in) rotate before a ceiling is hit.
//!
//! WHAT IS STORED. The CLI's own credentials file, whole, encrypted with the
//! app's master key (`claude_accounts` table). A switch writes back exactly
//! the bytes the CLI wrote — plus, when the stored token is about to expire,
//! a refresh through Anthropic's OAuth token endpoint, applied in place.
//!
//! WHOSE TOKEN IS CURRENT. Refresh tokens rotate: every refresh Claude Code
//! performs on the live login invalidates the copy this app stored for that
//! account. So before ANY read or switch, the live file is synced back into
//! the store for the account it belongs to (`stash_live`). The active
//! account is always read from the live file, never from its stored copy.
//!
//! WHAT LEAVES THE MACHINE. Tokens go to the host that issued them (refresh,
//! profile, usage) and nowhere else; none is returned over IPC or logged.
//! The view the frontend gets is identity + percentages.

pub mod live;
pub mod oauth;
pub mod rotate;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::fleet_claude_accounts as repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::crypto::{decrypt_from_db, encrypt_for_db};

use super::claude_usage::{now_ms, ClaudeUsageWindow};
use live::{LiveCredentials, LiveIdentity};
use oauth::OauthFailure;
pub use rotate::{ClaudeAutoRotateConfig, ClaudeRotationEvent};

/// Per-account usage cache — the same 45s the single-login strip uses.
const USAGE_TTL: Duration = Duration::from_secs(45);
/// A stored token this close to expiry is refreshed before it is read.
const REFRESH_AHEAD_READ_MS: i64 = 60_000;
/// …and this close before it is made the live login (a switch must land a
/// token the CLI can use for a while without refreshing it immediately).
const REFRESH_AHEAD_SWITCH_MS: i64 = 5 * 60_000;

/// One stored account as the strip shows it. Never carries a token.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccountView {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub organization_name: Option<String>,
    pub rate_limit_tier: Option<String>,
    #[ts(type = "number")]
    pub slot: i64,
    /// This account is the CLI's live login right now.
    pub is_active: bool,
    /// The stored refresh token died; a `claude login` + re-capture fixes it.
    pub quarantine_reason: Option<String>,
    #[ts(type = "number | null")]
    pub token_expires_at_ms: Option<i64>,
    /// Empty when the read failed — see `usage_reason`.
    pub usage: Vec<ClaudeUsageWindow>,
    /// Machine reason in the `fleet_claude_usage` vocabulary, or null.
    pub usage_reason: Option<String>,
    #[ts(type = "number | null")]
    pub usage_fetched_at_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub last_switched_at_ms: Option<i64>,
}

/// Everything the strip's multi-plan mode renders, in one read.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccountsSnapshot {
    /// The live login's account uuid, whether or not it is stored.
    pub active_account_id: Option<String>,
    /// The live login's email as `~/.claude.json` reports it.
    pub live_email: Option<String>,
    /// Whether the live login is one of the stored accounts.
    pub live_captured: bool,
    pub accounts: Vec<ClaudeAccountView>,
    pub auto_rotate: ClaudeAutoRotateConfig,
    pub last_rotation: Option<ClaudeRotationEvent>,
}

type UsageResult = Result<Vec<ClaudeUsageWindow>, String>;
/// account id → (cached at, fetched epoch ms, result)
type UsageCache = HashMap<String, (Instant, i64, UsageResult)>;

fn usage_cache() -> &'static Mutex<UsageCache> {
    static C: OnceLock<Mutex<UsageCache>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clear_usage_cache() {
    if let Ok(mut g) = usage_cache().lock() {
        g.clear();
    }
}

fn decrypt_raw(row: &repo::ClaudeAccountRow) -> Result<String, AppError> {
    Ok(decrypt_from_db(&row.creds_ciphertext, &row.creds_nonce)?)
}

fn encrypt_raw(raw: &str) -> Result<(String, String), AppError> {
    Ok(encrypt_for_db(raw)?)
}

fn access_token_of(doc: &Value) -> Option<String> {
    super::claude_usage::parse_credentials(doc).map(|c| c.access_token)
}

/// Sync the live file back into the store for the account it belongs to.
/// Returns the live account's uuid when `~/.claude.json` names one.
fn stash_live(
    pool: &DbPool,
    rows: &[repo::ClaudeAccountRow],
    live: Option<&LiveCredentials>,
    identity: &LiveIdentity,
) -> Option<String> {
    let active_id = identity.account_uuid.clone()?;
    let live = live?;
    let row = rows.iter().find(|r| r.id == active_id)?;
    let stored_token = decrypt_raw(row)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|d| access_token_of(&d));
    if stored_token.as_deref() != Some(live.creds.access_token.as_str()) {
        match encrypt_raw(&live.raw) {
            Ok((ct, nonce)) => {
                if let Err(e) = repo::set_creds(pool, &row.id, &ct, &nonce) {
                    tracing::warn!(error = %e, "claude accounts: live sync failed");
                }
            }
            Err(e) => tracing::warn!(error = %e, "claude accounts: live sync encrypt failed"),
        }
    }
    Some(active_id)
}

/// A stored account's document, refreshed if it expires within `ahead_ms`.
/// Persists the renewed tokens; quarantines the row on a dead refresh token.
async fn fresh_document(
    pool: &DbPool,
    row: &repo::ClaudeAccountRow,
    ahead_ms: i64,
) -> Result<(String, Value), OauthFailure> {
    let raw = decrypt_raw(row).map_err(|e| OauthFailure::Other(e.to_string()))?;
    let mut doc: Value =
        serde_json::from_str(&raw).map_err(|e| OauthFailure::Other(e.to_string()))?;
    let expires = oauth::expires_at_of(&doc).unwrap_or(0);
    if expires - now_ms() > ahead_ms {
        return Ok((raw, doc));
    }
    let Some(refresh_token) = oauth::refresh_token_of(&doc) else {
        return Err(OauthFailure::InvalidGrant(
            "stored login has no refresh token".into(),
        ));
    };
    match oauth::refresh(&refresh_token).await {
        Ok(set) => {
            oauth::apply_token_set(&mut doc, &set);
            let raw = serde_json::to_string_pretty(&doc)
                .map_err(|e| OauthFailure::Other(e.to_string()))?;
            let (ct, nonce) = encrypt_raw(&raw).map_err(|e| OauthFailure::Other(e.to_string()))?;
            repo::set_creds(pool, &row.id, &ct, &nonce)
                .map_err(|e| OauthFailure::Other(e.to_string()))?;
            Ok((raw, doc))
        }
        Err(OauthFailure::InvalidGrant(msg)) => {
            let _ = repo::set_quarantine(pool, &row.id, Some("invalid_grant"));
            Err(OauthFailure::InvalidGrant(msg))
        }
        Err(other) => Err(other),
    }
}

async fn usage_cached(id: &str, token: &str) -> (UsageResult, i64) {
    if let Ok(g) = usage_cache().lock() {
        if let Some((at, fetched, res)) = g.get(id) {
            if at.elapsed() < USAGE_TTL {
                return (res.clone(), *fetched);
            }
        }
    }
    let res = oauth::usage(token).await;
    let fetched = now_ms();
    if let Ok(mut g) = usage_cache().lock() {
        g.insert(id.to_string(), (Instant::now(), fetched, res.clone()));
    }
    (res, fetched)
}

/// The whole picture: stored accounts with live usage, the live login's
/// identity, and the rotation policy.
pub(super) async fn build_snapshot(pool: &DbPool) -> Result<ClaudeAccountsSnapshot, AppError> {
    let rows = repo::list(pool)?;
    let live = live::read_live();
    let identity = live::read_identity();
    let active_id = stash_live(pool, &rows, live.as_ref(), &identity);
    // `stash_live` may have rewritten a row; re-read so views reflect it.
    let rows = if active_id.is_some() {
        repo::list(pool)?
    } else {
        rows
    };

    let mut accounts = Vec::with_capacity(rows.len());
    for row in &rows {
        let is_active = active_id.as_deref() == Some(row.id.as_str());
        let mut quarantine = row.quarantine_reason.clone();
        let mut token_expires = None;
        let token: Option<String> = if is_active {
            live.as_ref().map(|l| {
                token_expires = l.creds.expires_at_ms;
                l.creds.access_token.clone()
            })
        } else if quarantine.is_some() {
            None
        } else {
            match fresh_document(pool, row, REFRESH_AHEAD_READ_MS).await {
                Ok((_, doc)) => {
                    token_expires = oauth::expires_at_of(&doc);
                    access_token_of(&doc)
                }
                Err(OauthFailure::InvalidGrant(_)) => {
                    quarantine = Some("invalid_grant".into());
                    None
                }
                Err(_) => None,
            }
        };
        let (usage, usage_reason, fetched) = match token {
            Some(t) => match usage_cached(&row.id, &t).await {
                (Ok(w), at) => (w, None, Some(at)),
                (Err(reason), at) => (Vec::new(), Some(reason), Some(at)),
            },
            None => (
                Vec::new(),
                Some(
                    if quarantine.is_some() {
                        "unauthorized"
                    } else {
                        "network"
                    }
                    .to_string(),
                ),
                None,
            ),
        };
        accounts.push(ClaudeAccountView {
            id: row.id.clone(),
            email: row.email.clone(),
            display_name: row.display_name.clone(),
            organization_name: row.organization_name.clone(),
            rate_limit_tier: row.rate_limit_tier.clone(),
            slot: row.slot,
            is_active,
            quarantine_reason: quarantine,
            token_expires_at_ms: token_expires,
            usage,
            usage_reason,
            usage_fetched_at_ms: fetched,
            last_switched_at_ms: row.last_switched_at_ms,
        });
    }

    let live_captured = active_id
        .as_ref()
        .is_some_and(|id| rows.iter().any(|r| &r.id == id));
    Ok(ClaudeAccountsSnapshot {
        active_account_id: active_id,
        live_email: identity.email,
        live_captured,
        accounts,
        auto_rotate: rotate::read_config(pool),
        last_rotation: rotate::read_last(pool),
    })
}

/// Make a stored account the CLI's live login. Idempotent on the active one.
pub(super) async fn switch_inner(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let rows = repo::list(pool)?;
    let row = rows
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| AppError::NotFound(format!("stored Claude login {id}")))?;
    let live = live::read_live();
    let identity = live::read_identity();
    let active = stash_live(pool, &rows, live.as_ref(), &identity);
    if active.as_deref() == Some(id) {
        return Ok(());
    }
    // Re-read: the stash may have renewed the row we are about to leave, and
    // the target row must be the freshest copy before it is refreshed.
    let row = repo::get(pool, &row.id)?
        .ok_or_else(|| AppError::NotFound(format!("stored Claude login {id}")))?;
    let (raw, doc) = match fresh_document(pool, &row, REFRESH_AHEAD_SWITCH_MS).await {
        Ok(v) => v,
        Err(OauthFailure::InvalidGrant(msg)) => {
            return Err(AppError::OAuthRevoked(format!(
            "{}: the stored login is dead — run `claude login` for it and capture again ({msg})",
            row.email
        )))
        }
        Err(OauthFailure::Network(msg)) => return Err(AppError::NetworkOffline(msg)),
        Err(OauthFailure::Other(msg)) => return Err(AppError::Auth(msg)),
    };
    let _ = &doc;

    let locks = live::CliLocks::acquire().await?;
    live::write_live(&raw)?;
    live::patch_identity(
        &row.id,
        &row.email,
        row.display_name.as_deref(),
        row.organization_uuid.as_deref(),
        row.organization_name.as_deref(),
        row.rate_limit_tier.as_deref(),
    )?;
    drop(locks);

    repo::mark_switched(pool, &row.id)?;
    clear_usage_cache();
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Every stored login with its live usage; the strip's multi-plan read.
#[tauri::command]
pub async fn fleet_claude_accounts_list(
    state: State<'_, Arc<AppState>>,
) -> Result<ClaudeAccountsSnapshot, AppError> {
    require_auth(&state).await?;
    build_snapshot(&state.db).await
}

/// Store the CLI's live login as an account (or refresh its stored copy).
#[tauri::command]
pub async fn fleet_claude_account_capture(
    state: State<'_, Arc<AppState>>,
) -> Result<ClaudeAccountsSnapshot, AppError> {
    require_auth(&state).await?;
    let pool = &state.db;
    let live = live::read_live().ok_or_else(|| {
        AppError::NotFound("no Claude Code login on this machine — run `claude login` first".into())
    })?;
    if live.creds.expires_at_ms.is_some_and(|e| e < now_ms()) {
        return Err(AppError::OAuthRevoked(
            "the live Claude Code login has expired — run `claude` once to refresh it".into(),
        ));
    }
    let identity = live::read_identity();
    // Identity from the profile endpoint, falling back to what the CLI wrote
    // into ~/.claude.json — the two agree on a healthy install.
    let profile = oauth::profile(&live.creds.access_token).await.ok();
    let account_uuid = profile
        .as_ref()
        .map(|p| p.account_uuid.clone())
        .or_else(|| identity.account_uuid.clone())
        .ok_or_else(|| AppError::Auth("could not identify the live Claude login".into()))?;
    let email = profile
        .as_ref()
        .and_then(|p| p.email.clone())
        .or_else(|| identity.email.clone())
        .unwrap_or_else(|| account_uuid.clone());
    let existing = repo::get(pool, &account_uuid)?;
    let slot = match &existing {
        Some(r) => r.slot,
        None => repo::next_slot(pool)?,
    };
    let (ct, nonce) = encrypt_raw(&live.raw)?;
    repo::upsert(
        pool,
        &repo::ClaudeAccountRow {
            id: account_uuid,
            email,
            display_name: profile
                .as_ref()
                .and_then(|p| p.display_name.clone())
                .or_else(|| identity.display_name.clone()),
            organization_uuid: profile
                .as_ref()
                .and_then(|p| p.organization_uuid.clone())
                .or_else(|| identity.organization_uuid.clone()),
            organization_name: profile
                .as_ref()
                .and_then(|p| p.organization_name.clone())
                .or_else(|| identity.organization_name.clone()),
            rate_limit_tier: live
                .creds
                .rate_limit_tier
                .clone()
                .or_else(|| identity.organization_rate_limit_tier.clone()),
            subscription_type: live.creds.subscription_type.clone(),
            slot,
            creds_ciphertext: ct,
            creds_nonce: nonce,
            quarantine_reason: None,
            added_at_ms: existing
                .as_ref()
                .map(|r| r.added_at_ms)
                .unwrap_or_else(now_ms),
            updated_at_ms: now_ms(),
            last_switched_at_ms: existing.as_ref().and_then(|r| r.last_switched_at_ms),
        },
    )?;
    clear_usage_cache();
    build_snapshot(pool).await
}

/// Make a stored login the CLI's live one.
#[tauri::command]
pub async fn fleet_claude_account_switch(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ClaudeAccountsSnapshot, AppError> {
    require_auth(&state).await?;
    switch_inner(&state.db, &id).await?;
    build_snapshot(&state.db).await
}

/// Forget a stored login. Never touches the live file.
#[tauri::command]
pub async fn fleet_claude_account_remove(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ClaudeAccountsSnapshot, AppError> {
    require_auth(&state).await?;
    if !repo::delete(&state.db, &id)? {
        return Err(AppError::NotFound(format!("stored Claude login {id}")));
    }
    if let Ok(mut g) = usage_cache().lock() {
        g.remove(&id);
    }
    build_snapshot(&state.db).await
}

/// Set the auto-rotate policy.
#[tauri::command]
pub async fn fleet_claude_auto_rotate_set(
    state: State<'_, Arc<AppState>>,
    config: ClaudeAutoRotateConfig,
) -> Result<ClaudeAutoRotateConfig, AppError> {
    require_auth(&state).await?;
    if !(1.0..=100.0).contains(&config.threshold_pct) {
        return Err(AppError::Validation(
            "threshold must be between 1 and 100".into(),
        ));
    }
    if config.cooldown_secs < 0 {
        return Err(AppError::Validation("cooldown cannot be negative".into()));
    }
    rotate::write_config(&state.db, &config)?;
    Ok(config)
}
