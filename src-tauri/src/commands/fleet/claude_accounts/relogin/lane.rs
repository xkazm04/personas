//! The seam between the re-login flow and the Chrome lane.
//!
//! `LaneLauncher` is what the orchestrator asks for a browser; production hands
//! out real Chrome through [`ChromeLauncher`], tests hand out a scripted page.
//! Every launch goes through [`acquire`], so two Chrome instances can never sit
//! on one profile directory: a second one would fight the first for the
//! profile's lock file and could corrupt the cookie store.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::engine::login_lane::{self, ChromeSession, LaneError, LaneMode, LaneSession};

use super::ReloginReason;

fn held() -> &'static Mutex<HashSet<PathBuf>> {
    static H: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    H.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Windows paths are case-insensitive; one key per directory either way.
fn key_of(dir: &Path) -> PathBuf {
    PathBuf::from(dir.to_string_lossy().to_lowercase())
}

/// Proof that this process owns a profile directory. Released on drop.
#[derive(Debug)]
pub struct ProfileGuard {
    key: PathBuf,
}

impl Drop for ProfileGuard {
    fn drop(&mut self) {
        if let Ok(mut g) = held().lock() {
            g.remove(&self.key);
        }
    }
}

/// Take the profile directory, or say it is already in use. `Busy` is the
/// closest reason the strip has: a window or another run is on this profile.
pub fn acquire(dir: &Path) -> Result<ProfileGuard, LaneError> {
    let key = key_of(dir);
    let mut g = held()
        .lock()
        .map_err(|_| LaneError::new(ReloginReason::Other, "profile registry poisoned"))?;
    if !g.insert(key.clone()) {
        return Err(LaneError::new(
            ReloginReason::Busy,
            "this browser profile is already open",
        ));
    }
    Ok(ProfileGuard { key })
}

/// Hands out browser sessions on a profile directory.
#[allow(async_fn_in_trait)]
pub trait LaneLauncher: Send + Sync {
    type Session: LaneSession;
    async fn launch(&self, dir: &Path, mode: LaneMode) -> Result<Self::Session, LaneError>;
}

/// A session that keeps its profile directory reserved until it is closed or
/// dropped, whichever comes first.
pub struct LockedSession<S> {
    inner: S,
    _guard: ProfileGuard,
}

impl<S> LockedSession<S> {
    pub fn new(inner: S, guard: ProfileGuard) -> Self {
        Self {
            inner,
            _guard: guard,
        }
    }
}

impl<S: LaneSession> LaneSession for LockedSession<S> {
    async fn navigate(&mut self, url: &str) -> Result<(), LaneError> {
        self.inner.navigate(url).await
    }
    async fn current_url(&mut self) -> Result<String, LaneError> {
        self.inner.current_url().await
    }
    async fn page_text(&mut self) -> Result<String, LaneError> {
        self.inner.page_text().await
    }
    async fn click_text(&mut self, text: &str) -> Result<bool, LaneError> {
        self.inner.click_text(text).await
    }
    async fn fill(&mut self, selector: &str, value: &str) -> Result<bool, LaneError> {
        self.inner.fill(selector, value).await
    }
    async fn wait_for_text(&mut self, needle: &str, timeout_ms: u64) -> Result<bool, LaneError> {
        self.inner.wait_for_text(needle, timeout_ms).await
    }
    async fn close(self) -> Result<(), LaneError> {
        self.inner.close().await
    }
}

/// Production launcher: real Chrome, one profile directory at a time.
pub struct ChromeLauncher;

impl LaneLauncher for ChromeLauncher {
    type Session = LockedSession<ChromeSession>;

    async fn launch(&self, dir: &Path, mode: LaneMode) -> Result<Self::Session, LaneError> {
        let guard = acquire(dir)?;
        let session = login_lane::launch(dir, mode).await?;
        tracing::debug!(
            pid = session.pid(),
            port = session.port(),
            "claude relogin: lane browser launched"
        );
        Ok(LockedSession::new(session, guard))
    }
}

/// `<app data>/claude-login-profiles/<key>` for a validated key.
pub fn profile_dir(app_data: &Path, key: &str) -> Result<PathBuf, LaneError> {
    login_lane::chrome::profile_dir_for(app_data, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_claim_on_one_profile_dir_is_refused_with_a_typed_reason() {
        let dir = std::env::temp_dir().join("relogin-lock-test-a");
        let first = acquire(&dir).expect("first claim");
        let second = acquire(&dir).expect_err("second claim must fail");
        assert_eq!(second.reason, ReloginReason::Busy);
        // Case-insensitive on Windows paths.
        let upper = PathBuf::from(dir.to_string_lossy().to_uppercase());
        assert!(acquire(&upper).is_err());
        drop(first);
        assert!(acquire(&dir).is_ok(), "released on drop");
    }

    #[test]
    fn different_profile_dirs_do_not_block_each_other() {
        let a = acquire(&std::env::temp_dir().join("relogin-lock-test-b1")).expect("b1");
        let b = acquire(&std::env::temp_dir().join("relogin-lock-test-b2")).expect("b2");
        drop((a, b));
    }
}
