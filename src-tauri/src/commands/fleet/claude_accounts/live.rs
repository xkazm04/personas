//! The CLI's live login on disk, and how to replace it safely.
//!
//! Three files matter on Windows and Linux (macOS keeps the token in the
//! Keychain, which this module does not reach):
//!   • `~/.claude/.credentials.json` — the token the CLI sends. Claude Code
//!     re-reads it whenever it changes, so a swap takes effect on the next
//!     message with no restart.
//!   • `~/.claude.json` → `oauthAccount` — the identity the CLI shows in
//!     `/status`. Patched key-scoped so every other key survives untouched.
//!   • the CLI's own lock directories — `<config>/.oauth_refresh.lock`
//!     (2.1.218+) and the legacy `~/.claude.lock`. Claude Code takes them
//!     around its own token refresh; taking them around our write is what
//!     keeps a swap from racing that refresh. `mkdir` atomicity is the mutex,
//!     a stale directory older than 60s is taken over, and both are released
//!     on drop.
//!
//! Writes are atomic: temp file in the same directory, then rename.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::Value;

use crate::error::AppError;

use super::super::claude_usage::{claude_config_dir, parse_credentials, Credentials};

/// A stale lock is one nobody has touched for this long — the CLI refreshes
/// its lock mtime while it holds it, so an old one belongs to a dead process.
const LOCK_STALE: Duration = Duration::from_secs(60);
/// How long a switch waits for the CLI to finish its own refresh.
const LOCK_WAIT: Duration = Duration::from_secs(10);

pub(super) fn credentials_path() -> Option<PathBuf> {
    claude_config_dir().map(|d| d.join(".credentials.json"))
}

/// `~/.claude.json` — beside the config dir, not inside it.
pub(super) fn global_config_path() -> Option<PathBuf> {
    let dir = claude_config_dir()?;
    Some(
        dir.parent()?
            .join(format!("{}.json", dir.file_name()?.to_string_lossy())),
    )
}

/// What `~/.claude.json` says about the signed-in account.
#[derive(Default, Clone)]
pub(super) struct LiveIdentity {
    pub account_uuid: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub organization_uuid: Option<String>,
    pub organization_name: Option<String>,
    pub organization_rate_limit_tier: Option<String>,
}

pub(super) fn read_identity() -> LiveIdentity {
    let Some(path) = global_config_path() else {
        return LiveIdentity::default();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return LiveIdentity::default();
    };
    let Ok(v) = serde_json::from_str::<Value>(&raw) else {
        return LiveIdentity::default();
    };
    let Some(acct) = v.get("oauthAccount") else {
        return LiveIdentity::default();
    };
    let s = |k: &str| {
        acct.get(k)
            .and_then(Value::as_str)
            .filter(|x| !x.is_empty())
            .map(str::to_string)
    };
    LiveIdentity {
        account_uuid: s("accountUuid"),
        email: s("emailAddress"),
        display_name: s("displayName").or_else(|| s("fullName")),
        organization_uuid: s("organizationUuid"),
        organization_name: s("organizationName"),
        organization_rate_limit_tier: s("organizationRateLimitTier"),
    }
}

/// The live credentials file: its exact text, and the parsed slice.
pub(super) struct LiveCredentials {
    pub raw: String,
    pub creds: Credentials,
}

pub(super) fn read_live() -> Option<LiveCredentials> {
    let raw = std::fs::read_to_string(credentials_path()?).ok()?;
    let doc: Value = serde_json::from_str(&raw).ok()?;
    let creds = parse_credentials(&doc)?;
    Some(LiveCredentials { raw, creds })
}

/// Atomic replace: write beside the target, then rename over it. Windows
/// refuses to rename onto an existing file, so the target is removed first —
/// the window between the two is the reason the CLI locks are held around it.
pub(super) fn write_atomic(path: &Path, contents: &str) -> Result<(), AppError> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Validation("credentials path has no parent".into()))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default(),
        std::process::id()
    ));
    std::fs::write(&tmp, contents)?;
    if std::fs::rename(&tmp, path).is_err() {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        std::fs::rename(&tmp, path)?;
    }
    Ok(())
}

pub(super) fn write_live(raw: &str) -> Result<(), AppError> {
    let path = credentials_path()
        .ok_or_else(|| AppError::Validation("no home directory for ~/.claude".into()))?;
    write_atomic(&path, raw)
}

/// Patch `oauthAccount` in `~/.claude.json` with the switched-to identity.
/// Key-scoped: only the fields below change; a missing file is left missing
/// (the CLI recreates it, and inventing one here would invent its defaults).
pub(super) fn patch_identity(
    account_uuid: &str,
    email: &str,
    display_name: Option<&str>,
    organization_uuid: Option<&str>,
    organization_name: Option<&str>,
    rate_limit_tier: Option<&str>,
) -> Result<(), AppError> {
    let Some(path) = global_config_path() else {
        return Ok(());
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let mut v: Value = serde_json::from_str(&raw)?;
    if !v.is_object() {
        return Ok(());
    }
    let acct = v
        .as_object_mut()
        .expect("checked is_object")
        .entry("oauthAccount")
        .or_insert_with(|| Value::Object(Default::default()));
    if !acct.is_object() {
        *acct = Value::Object(Default::default());
    }
    let set = |acct: &mut Value, k: &str, val: Option<&str>| {
        if let Some(val) = val {
            acct[k] = Value::String(val.to_string());
        }
    };
    set(acct, "accountUuid", Some(account_uuid));
    set(acct, "emailAddress", Some(email));
    set(acct, "displayName", display_name);
    set(acct, "organizationUuid", organization_uuid);
    set(acct, "organizationName", organization_name);
    set(acct, "organizationRateLimitTier", rate_limit_tier);
    write_atomic(&path, &serde_json::to_string_pretty(&v)?)
}

/// The CLI's lock directories, held for the life of the guard.
pub(super) struct CliLocks {
    held: Vec<PathBuf>,
}

impl CliLocks {
    fn candidates() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(dir) = claude_config_dir() {
            out.push(dir.join(".oauth_refresh.lock"));
            if let (Some(parent), Some(name)) = (dir.parent(), dir.file_name()) {
                out.push(parent.join(format!("{}.lock", name.to_string_lossy())));
            }
        }
        out
    }

    fn try_take(path: &Path) -> bool {
        match std::fs::create_dir(path) {
            Ok(()) => true,
            Err(_) => {
                // Stale takeover: nobody has touched it for LOCK_STALE.
                let stale = std::fs::metadata(path)
                    .and_then(|m| m.modified())
                    .map(|m| SystemTime::now().duration_since(m).unwrap_or_default() > LOCK_STALE)
                    .unwrap_or(false);
                if stale {
                    let _ = std::fs::remove_dir(path);
                    std::fs::create_dir(path).is_ok()
                } else {
                    false
                }
            }
        }
    }

    pub async fn acquire() -> Result<Self, AppError> {
        let candidates = Self::candidates();
        let mut held = Vec::with_capacity(candidates.len());
        let deadline = std::time::Instant::now() + LOCK_WAIT;
        for path in candidates {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            loop {
                if Self::try_take(&path) {
                    held.push(path);
                    break;
                }
                if std::time::Instant::now() >= deadline {
                    for p in &held {
                        let _ = std::fs::remove_dir(p);
                    }
                    return Err(AppError::RateLimited(
                        "Claude Code is refreshing its login; try the switch again in a moment"
                            .into(),
                    ));
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
        }
        Ok(Self { held })
    }
}

impl Drop for CliLocks {
    fn drop(&mut self) {
        for p in &self.held {
            let _ = std::fs::remove_dir(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_file() {
        let dir = std::env::temp_dir().join(format!("claude-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(".credentials.json");
        write_atomic(&p, "one").unwrap();
        write_atomic(&p, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            1,
            "no temp file left behind"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn global_config_sits_beside_the_config_dir() {
        if let (Some(dir), Some(cfg)) = (claude_config_dir(), global_config_path()) {
            assert_eq!(cfg.parent(), dir.parent());
            assert!(cfg.to_string_lossy().ends_with(".claude.json"));
        }
    }
}
