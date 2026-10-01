//! The claude.ai side of a re-login: drive the account's Chrome profile through
//! the authorize page the CLI asked for.
//!
//! [`classify`] is a pure function of the URL and visible text, pinned by
//! fixture text; [`drive`] polls it and acts on each state:
//!
//! ```text
//! Authorize      click it, done (the CLI completes on its localhost callback)
//! SignedOut      profile cold, unless the account signs in by emailed code
//! EmailCode      read the code from the inbox profile and type it
//! GoogleChooser  pick the account whose email matches, else profile cold
//! Challenge      its own reason; a human passes it in a visible window
//! Unknown        selector drift after a grace period
//! ```

use tokio::time::{sleep, Instant};

use crate::engine::login_lane::challenge::detect_challenge;
use crate::engine::login_lane::{LaneError, LaneSession};

use super::super::lane::LaneLauncher;
use super::super::{ReloginReason, ReloginStep};
use super::email_code::{CodeReader, InboxPlan};
use super::{google, MailSecret, Timings};

const EMAIL_SELECTOR: &str = "input[type=email], input[name=email], input[autocomplete=email]";
const CODE_SELECTOR: &str = "input[autocomplete=one-time-code], input[name=code], input[inputmode=numeric], input[type=tel], input[type=text]";
const AUTHORIZE_BUTTONS: [&str; 3] = ["authorize", "allow", "continue"];
const EMAIL_SUBMIT_BUTTONS: [&str; 2] = ["continue with email", "send"];
const CODE_SUBMIT_BUTTONS: [&str; 4] = ["continue", "verify", "log in", "submit"];
/// Chooser clicks before the profile is declared not signed in as this account.
const GOOGLE_CLICK_LIMIT: u8 = 3;

const SIGNED_OUT_MARKERS: &[&str] = &[
    "continue with google",
    "continue with email",
    "enter your email",
];
const CODE_MARKERS: &[&str] = &[
    "verification code",
    "enter the code",
    "enter code",
    "6-digit",
    "check your email",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageState {
    Authorize,
    SignedOut,
    EmailCode,
    GoogleChooser,
    GoogleSignIn,
    /// The CLI's own `http://localhost:<port>/callback`.
    Callback,
    Challenge(ReloginReason),
    Unknown,
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1"
}

/// Classify a page by URL and visible text. Order matters: a challenge beats
/// everything, and the sign-in markers beat "authorize" because a login page
/// can mention Claude Code and cookie consent ("Allow").
pub fn classify(url: &str, text: &str) -> PageState {
    if let Some(r) = detect_challenge(url, text) {
        return PageState::Challenge(r);
    }
    let low = text.to_lowercase();
    let parsed = url::Url::parse(url).ok();
    let host = parsed
        .as_ref()
        .and_then(|u| u.host_str())
        .unwrap_or_default()
        .to_string();
    let path = parsed
        .as_ref()
        .map(|u| u.path().to_string())
        .unwrap_or_default();
    if is_loopback(&host) && path.starts_with("/callback") {
        return PageState::Callback;
    }
    if google::is_google(&host, &low) {
        return if google::is_chooser(&low) {
            PageState::GoogleChooser
        } else {
            PageState::GoogleSignIn
        };
    }
    let signed_out = SIGNED_OUT_MARKERS.iter().any(|m| low.contains(m));
    // The code prompt has no Google button; the login page, which can also say
    // "verify your email", does.
    if !low.contains("continue with google") && CODE_MARKERS.iter().any(|m| low.contains(m)) {
        return PageState::EmailCode;
    }
    if signed_out {
        return PageState::SignedOut;
    }
    if low.contains("claude code") && (low.contains("authorize") || low.contains("allow")) {
        return PageState::Authorize;
    }
    PageState::Unknown
}

/// The loop's bookkeeping between polls.
struct Drive<S> {
    unknown_since: Option<Instant>,
    submitted_email_at: Option<Instant>,
    code_entered_at: Option<Instant>,
    google_clicks: u8,
    reader: Option<CodeReader<S>>,
}

enum Flow {
    Continue,
    Done,
}

/// Who is signing in.
pub struct PageCtx<'a> {
    pub email: &'a str,
}

fn fail(reason: ReloginReason, detail: &str) -> LaneError {
    LaneError::new(reason, detail)
}

/// Drive the page until the authorize click is made (or the CLI finishes by
/// itself). `cli_exit` reports the CLI's exit so a flow the CLI completed alone
/// ends at once. The inbox session, if one was opened, is always closed.
pub async fn drive<S, L>(
    session: &mut S,
    ctx: &PageCtx<'_>,
    inbox: &InboxPlan<'_, L>,
    t: &Timings,
    cli_exit: &mut (dyn FnMut() -> Option<bool> + Send),
    on_step: &(dyn Fn(ReloginStep) + Sync),
) -> Result<(), LaneError>
where
    S: LaneSession,
    L: LaneLauncher,
{
    let mut st: Drive<L::Session> = Drive {
        unknown_since: None,
        submitted_email_at: None,
        code_entered_at: None,
        google_clicks: 0,
        reader: None,
    };
    let result = drive_loop(session, ctx, inbox, t, cli_exit, on_step, &mut st).await;
    if let Some(r) = st.reader.take() {
        r.close().await;
    }
    result
}

async fn drive_loop<S, L>(
    session: &mut S,
    ctx: &PageCtx<'_>,
    inbox: &InboxPlan<'_, L>,
    t: &Timings,
    cli_exit: &mut (dyn FnMut() -> Option<bool> + Send),
    on_step: &(dyn Fn(ReloginStep) + Sync),
    st: &mut Drive<L::Session>,
) -> Result<(), LaneError>
where
    S: LaneSession,
    L: LaneLauncher,
{
    let start = Instant::now();
    loop {
        if let Some(ok) = cli_exit() {
            return if ok {
                Ok(())
            } else {
                Err(fail(ReloginReason::CliFailed, "claude CLI exited"))
            };
        }
        if start.elapsed() > t.page_cap {
            return Err(fail(ReloginReason::Timeout, "sign-in page flow timed out"));
        }
        let url = session.current_url().await?;
        let text = session.page_text().await?;
        let state = classify(&url, &text);
        if state != PageState::Unknown {
            st.unknown_since = None;
        }
        let flow = match state {
            PageState::Challenge(r) => return Err(fail(r, "challenge page")),
            PageState::Callback => Flow::Done,
            PageState::GoogleSignIn => {
                return Err(fail(ReloginReason::ProfileCold, "google sign-in"))
            }
            PageState::GoogleChooser => google_chooser(session, ctx, st).await?,
            PageState::Authorize => authorize(session, on_step, st, t).await?,
            PageState::SignedOut => signed_out(session, ctx, inbox, t, st).await?,
            PageState::EmailCode => email_code(session, inbox, t, on_step, st).await?,
            PageState::Unknown => stall(st, t)?,
        };
        if matches!(flow, Flow::Done) {
            return Ok(());
        }
        sleep(t.poll).await;
    }
}

/// An unrecognised (or not yet rendered) page: wait, then call it drift.
fn stall<S>(st: &mut Drive<S>, t: &Timings) -> Result<Flow, LaneError> {
    let since = *st.unknown_since.get_or_insert_with(Instant::now);
    if since.elapsed() > t.unknown_cap {
        return Err(fail(ReloginReason::SelectorDrift, "page not recognised"));
    }
    Ok(Flow::Continue)
}

async fn google_chooser<S: LaneSession, R>(
    session: &mut S,
    ctx: &PageCtx<'_>,
    st: &mut Drive<R>,
) -> Result<Flow, LaneError> {
    st.google_clicks += 1;
    if st.google_clicks > GOOGLE_CLICK_LIMIT {
        return Err(fail(
            ReloginReason::ProfileCold,
            "google chooser did not advance",
        ));
    }
    if google::pick_account(session, ctx.email).await? {
        Ok(Flow::Continue)
    } else {
        Err(fail(
            ReloginReason::ProfileCold,
            "account not in the google chooser",
        ))
    }
}

async fn authorize<S: LaneSession, R>(
    session: &mut S,
    on_step: &(dyn Fn(ReloginStep) + Sync),
    st: &mut Drive<R>,
    t: &Timings,
) -> Result<Flow, LaneError> {
    for label in AUTHORIZE_BUTTONS {
        if session.click_text(label).await? {
            on_step(ReloginStep::Authorising);
            return Ok(Flow::Done);
        }
    }
    // The button may not be rendered yet.
    stall(st, t)
}

async fn signed_out<S, L>(
    session: &mut S,
    ctx: &PageCtx<'_>,
    inbox: &InboxPlan<'_, L>,
    t: &Timings,
    st: &mut Drive<L::Session>,
) -> Result<Flow, LaneError>
where
    S: LaneSession,
    L: LaneLauncher,
{
    if inbox.dir.is_none() {
        return Err(fail(
            ReloginReason::ProfileCold,
            "signed out, no code inbox",
        ));
    }
    if let Some(at) = st.submitted_email_at {
        if at.elapsed() > t.after_submit_cap {
            return Err(fail(
                ReloginReason::SelectorDrift,
                "email form did not advance",
            ));
        }
        return Ok(Flow::Continue);
    }
    if st.reader.is_none() {
        st.reader = Some(CodeReader::open(inbox, t).await?);
    }
    if !session.fill(EMAIL_SELECTOR, ctx.email).await? {
        return Err(fail(ReloginReason::SelectorDrift, "email field not found"));
    }
    if !click_first(session, &EMAIL_SUBMIT_BUTTONS).await? {
        return Err(fail(ReloginReason::SelectorDrift, "email submit not found"));
    }
    st.submitted_email_at = Some(Instant::now());
    Ok(Flow::Continue)
}

async fn email_code<S, L>(
    session: &mut S,
    inbox: &InboxPlan<'_, L>,
    t: &Timings,
    on_step: &(dyn Fn(ReloginStep) + Sync),
    st: &mut Drive<L::Session>,
) -> Result<Flow, LaneError>
where
    S: LaneSession,
    L: LaneLauncher,
{
    if let Some(at) = st.code_entered_at {
        if at.elapsed() > t.after_submit_cap {
            return Err(fail(
                ReloginReason::SelectorDrift,
                "code page did not advance",
            ));
        }
        return Ok(Flow::Continue);
    }
    on_step(ReloginStep::WaitingForCode);
    if st.reader.is_none() {
        // The prompt was already up: the mail may predate the snapshot, in
        // which case the wait ends in CodeNotFound rather than a stale code.
        st.reader = Some(CodeReader::open(inbox, t).await?);
    }
    let Some(reader) = st.reader.as_mut() else {
        return Err(fail(ReloginReason::Other, "inbox reader missing"));
    };
    match reader.wait(t).await? {
        MailSecret::Code(code) => {
            if !session.fill(CODE_SELECTOR, &code).await? {
                return Err(fail(ReloginReason::SelectorDrift, "code field not found"));
            }
            // Some pages submit on the sixth digit: a missing button is fine.
            click_first(session, &CODE_SUBMIT_BUTTONS).await?;
        }
        MailSecret::Link(link) => session.navigate(&link).await?,
    }
    st.code_entered_at = Some(Instant::now());
    Ok(Flow::Continue)
}

async fn click_first<S: LaneSession>(session: &mut S, labels: &[&str]) -> Result<bool, LaneError> {
    for label in labels {
        if session.click_text(label).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTH: &str =
        "Authorize Claude Code\nClaude Code would like to connect to your account\nAuthorize\nDeny";
    const LOGIN: &str = "Welcome back\nContinue with Google\nEnter your email\nContinue with email\nVerify your email address";
    const CODE: &str = "Check your email\nWe sent a verification code to a@b.c\nEnter the code";

    #[test]
    fn classifies_the_pages_a_run_meets() {
        assert_eq!(
            classify("https://claude.com/cai/oauth/authorize?x=1", AUTH),
            PageState::Authorize
        );
        assert_eq!(
            classify("https://claude.ai/login", LOGIN),
            PageState::SignedOut
        );
        assert_eq!(
            classify("https://claude.ai/login", CODE),
            PageState::EmailCode
        );
        assert_eq!(
            classify(
                "https://accounts.google.com/o/oauth2/v2/auth",
                "Choose an account\nto continue to Claude\na@b.c"
            ),
            PageState::GoogleChooser
        );
        assert_eq!(
            classify(
                "https://accounts.google.com/v3/signin/identifier",
                "Sign in\nEmail or phone"
            ),
            PageState::GoogleSignIn
        );
        assert_eq!(
            classify(
                "http://localhost:57767/callback?code=x",
                "You may close this"
            ),
            PageState::Callback
        );
        assert_eq!(
            classify("https://claude.ai/x", "Loading..."),
            PageState::Unknown
        );
    }

    #[test]
    fn challenges_win_over_everything() {
        assert_eq!(
            classify(
                "https://claude.ai/login",
                "Just a moment...\nContinue with Google"
            ),
            PageState::Challenge(ReloginReason::CloudflareChallenge)
        );
        assert_eq!(
            classify(
                "https://accounts.google.com/v3/signin/challenge/pwd",
                "Choose an account"
            ),
            PageState::Challenge(ReloginReason::GoogleChallenge)
        );
    }

    #[test]
    fn a_login_page_that_mentions_claude_code_is_not_the_authorize_page() {
        let page = "Log in to continue to Claude Code\nContinue with Google\nAllow all cookies";
        assert_eq!(
            classify("https://claude.ai/login", page),
            PageState::SignedOut
        );
    }
}
