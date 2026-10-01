//! Login lane: a real Chrome, one `--user-data-dir` per profile, driven over
//! the DevTools protocol on a loopback port (spark `claude-plan-switch`).
//!
//! WHY CHROME AND NOT THE EMBEDDED WEBVIEW. Google refuses sign-in inside an
//! embedded webview (3 of the 5 stored plans use "Continue with Google"), and
//! Proton's CSP (`connect-src 'self' *.proton.me`, measured 2026-10-01) blocks
//! the webview bridge's loopback socket. One real-Chrome host serves claude.ai,
//! Google and Proton alike, and the embedded browser module stays untouched.
//!
//! THIS FILE IS THE CONTRACT. WP0 froze the trait and the error type so the
//! re-login orchestrator (`commands/fleet/claude_accounts/relogin`) can be
//! built and tested against a fake `LaneSession` while the Chrome/CDP
//! implementation (WP1a) lands in the sibling modules. `launch` is a stub until
//! then and answers `ChromeMissing`.
//!
//! SAFETY LAW (not negotiable, enforced here rather than by callers):
//! - every navigation is checked against `origin_allowed` and refused otherwise;
//! - nothing returned from a `LaneSession` is a credential, and nothing passed
//!   to `fill` is ever logged;
//! - a launched Chrome never outlives its `LaneSession` (kill the process tree
//!   on `close` AND on drop).

use std::path::Path;

use crate::commands::fleet::claude_accounts::relogin::ReloginReason;

/// Hosts the lane may navigate to. Anything else is `LaneError::OriginRefused`.
pub const ALLOWED_HOSTS: &[&str] = &[
    "claude.ai",
    "claude.com",
    "platform.claude.com",
    "accounts.google.com",
    "mail.proton.me",
    "account.proton.me",
    "proton.me",
];

/// `http://localhost:<port>/callback` is the CLI's own OAuth redirect and is
/// allowed on loopback only.
pub fn origin_allowed(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else {
        return false;
    };
    match (u.scheme(), u.host_str()) {
        ("https", Some(h)) => ALLOWED_HOSTS
            .iter()
            .any(|a| h == *a || h.ends_with(&format!(".{a}"))),
        ("http", Some("localhost" | "127.0.0.1")) => true,
        _ => false,
    }
}

/// Headless for warm unattended runs, headed for a first sign-in or a human step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneMode {
    Headless,
    Headed,
}

/// A lane failure already shaped for the strip: `reason` is what the row shows,
/// `detail` is for logs and must never contain a credential or a code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaneError {
    pub reason: ReloginReason,
    pub detail: String,
}

impl LaneError {
    pub fn new(reason: ReloginReason, detail: impl Into<String>) -> Self {
        Self {
            reason,
            detail: detail.into(),
        }
    }
}

/// One live Chrome page on one profile.
#[allow(async_fn_in_trait)]
pub trait LaneSession: Send {
    /// Navigate and wait for the load. Refuses a URL `origin_allowed` rejects.
    async fn navigate(&mut self, url: &str) -> Result<(), LaneError>;
    async fn current_url(&mut self) -> Result<String, LaneError>;
    /// Visible text of the page body (for the code read and for state detection).
    async fn page_text(&mut self) -> Result<String, LaneError>;
    /// Click the first VISIBLE button/link/[role=button] whose text contains
    /// `text` (case-insensitive). `Ok(false)` = nothing matched.
    async fn click_text(&mut self, text: &str) -> Result<bool, LaneError>;
    /// Type `value` into the first visible input matching the CSS `selector`
    /// (real key events, not a value assignment, so frameworks see it).
    /// `Ok(false)` = no such input. `value` is never logged.
    async fn fill(&mut self, selector: &str, value: &str) -> Result<bool, LaneError>;
    /// Poll `page_text` until it contains `needle` (case-insensitive) or the
    /// timeout passes. `Ok(false)` = timed out.
    async fn wait_for_text(&mut self, needle: &str, timeout_ms: u64) -> Result<bool, LaneError>;
    /// Close the page and kill the Chrome process tree.
    async fn close(self) -> Result<(), LaneError>;
}

/// Launch Chrome on `profile_dir`. WP1a replaces this stub with the real
/// launcher (binary discovery, free loopback port, CDP attach); the return type
/// then becomes the concrete session type behind this alias.
pub async fn launch(_profile_dir: &Path, _mode: LaneMode) -> Result<StubSession, LaneError> {
    Err(LaneError::new(
        ReloginReason::ChromeMissing,
        "login lane not implemented yet (WP1a)",
    ))
}

/// Placeholder concrete session so the stub `launch` has a type. WP1a deletes it.
pub struct StubSession;

impl LaneSession for StubSession {
    async fn navigate(&mut self, _url: &str) -> Result<(), LaneError> {
        Err(LaneError::new(ReloginReason::ChromeMissing, "stub"))
    }
    async fn current_url(&mut self) -> Result<String, LaneError> {
        Err(LaneError::new(ReloginReason::ChromeMissing, "stub"))
    }
    async fn page_text(&mut self) -> Result<String, LaneError> {
        Err(LaneError::new(ReloginReason::ChromeMissing, "stub"))
    }
    async fn click_text(&mut self, _text: &str) -> Result<bool, LaneError> {
        Err(LaneError::new(ReloginReason::ChromeMissing, "stub"))
    }
    async fn fill(&mut self, _selector: &str, _value: &str) -> Result<bool, LaneError> {
        Err(LaneError::new(ReloginReason::ChromeMissing, "stub"))
    }
    async fn wait_for_text(&mut self, _needle: &str, _timeout_ms: u64) -> Result<bool, LaneError> {
        Err(LaneError::new(ReloginReason::ChromeMissing, "stub"))
    }
    async fn close(self) -> Result<(), LaneError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_the_login_hosts_and_the_cli_callback() {
        assert!(origin_allowed("https://claude.ai/login"));
        assert!(origin_allowed("https://claude.com/cai/oauth/authorize?x=1"));
        assert!(origin_allowed(
            "https://accounts.google.com/o/oauth2/v2/auth"
        ));
        assert!(origin_allowed("https://mail.proton.me/u/0/inbox"));
        assert!(origin_allowed("http://localhost:57767/callback"));
    }

    #[test]
    fn allowlist_refuses_everything_else() {
        assert!(!origin_allowed("https://evil.example/login"));
        assert!(!origin_allowed("https://claude.ai.evil.example/"));
        assert!(!origin_allowed("http://claude.ai/login"));
        assert!(!origin_allowed("file:///etc/passwd"));
        assert!(!origin_allowed("not a url"));
    }
}
