//! The page flows of a re-login: the claude.ai authorize page (and the Google
//! sign-in it can bounce through), and the Proton inbox an emailed code lands in.
//!
//! Everything here is deterministic code over the lane's page text; no model
//! reads a page. A code or a password lives in a [`Zeroizing`] string for the
//! few lines between being read and being typed, and is never logged.

use std::time::Duration;

use zeroize::Zeroizing;

pub mod claude_page;
pub mod email_code;
pub mod google;
pub mod proton_inbox;

/// Every wait a run makes, named so a test can shorten them and so no deadline
/// is an anonymous literal at its use site.
#[derive(Debug, Clone, Copy)]
pub struct Timings {
    /// The CLI hands over its authorize URL.
    pub url_wait: Duration,
    /// Hard cap on the claude page flow as a whole.
    pub page_cap: Duration,
    /// A page the classifier does not know, before it is called selector drift.
    pub unknown_cap: Duration,
    /// Poll interval of the claude page loop.
    pub poll: Duration,
    /// How long after the email form is submitted the page may stay unchanged.
    pub after_submit_cap: Duration,
    /// The CLI exits after the page is authorised.
    pub cli_exit: Duration,
    /// The inbox shows a new code.
    pub code_wait: Duration,
    /// Poll (and reload) interval of the inbox.
    pub code_poll: Duration,
    /// The Proton page reaches the inbox (or a login form) after navigation.
    pub inbox_open: Duration,
    /// Quiet period that means the inbox list has finished loading.
    pub settle: Duration,
    /// A login form that reappears sooner than this after Sign in is the same page.
    pub login_grace: Duration,
}

impl Timings {
    pub const PRODUCTION: Timings = Timings {
        url_wait: Duration::from_secs(20),
        page_cap: Duration::from_secs(120),
        unknown_cap: Duration::from_secs(20),
        poll: Duration::from_millis(500),
        after_submit_cap: Duration::from_secs(20),
        cli_exit: Duration::from_secs(30),
        code_wait: Duration::from_secs(90),
        code_poll: Duration::from_secs(5),
        inbox_open: Duration::from_secs(30),
        settle: Duration::from_millis(600),
        login_grace: Duration::from_secs(4),
    };
}

/// What an email gave us to finish the sign-in.
pub enum MailSecret {
    /// A 6-digit code to type into the page.
    Code(Zeroizing<String>),
    /// A sign-in link (host-checked by the caller before it is opened).
    Link(Zeroizing<String>),
}

/// A mailbox login read from the vault. Both halves are zeroized on drop.
pub struct MailLogin {
    pub user: Zeroizing<String>,
    pub pass: Zeroizing<String>,
}

/// Reads the Proton login bound to a profile. Production reads the vault; a
/// test returns a fixture.
pub trait VaultReader: Send + Sync {
    fn mail_login(&self, credential_id: &str) -> Option<MailLogin>;
}
