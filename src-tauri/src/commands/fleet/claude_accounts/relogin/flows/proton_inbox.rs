//! Reading a sign-in code out of a Proton inbox, in a Chrome profile that is
//! (usually) already signed in to Proton.
//!
//! Deterministic code only: classify the page by its URL and visible text,
//! sign in with the vault login when the profile has lapsed, then look for a
//! 6-digit code in message text that mentions Claude or Anthropic. The only
//! interaction beyond navigation is "click the newest row whose text matches".
//!
//! FRESHNESS. The inbox is read ONCE before the sign-in email is requested, and
//! every code and Claude/Anthropic mention already in it is remembered
//! (the [`Baseline`]). A code only counts if it was not in that snapshot, so an
//! old verification email can never be typed in place of the new one.
//!
//! Nothing read from the inbox reaches a log, an event or an error string.

use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use tokio::time::{sleep, Instant};
use zeroize::Zeroizing;

use crate::engine::login_lane::challenge::detect_challenge;
use crate::engine::login_lane::{LaneError, LaneSession};

use super::super::ReloginReason;
use super::{MailLogin, MailSecret, Timings};

/// Text that means Proton wants a second factor or the mailbox password.
const SECOND_FACTOR: &[&str] = &[
    "two-factor",
    "two factor",
    "2fa",
    "authentication code",
    "authenticator app",
    "mailbox password",
    "unlock your mailbox",
    "security key",
];

const USER_SELECTOR: &str = "#username, input[name=username], input[type=email], input[type=text]";
const PASS_SELECTOR: &str = "#password, input[type=password]";
const SIGN_IN: &str = "sign in";
/// Rows are opened by the sender or subject text they carry.
const ROW_NEEDLES: [&str; 2] = ["anthropic", "claude"];

#[allow(clippy::expect_used)] // static initialiser over a literal
static CODE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)").expect("literal regex"));
#[allow(clippy::expect_used)] // static initialiser over a literal
static LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"https://claude\.ai/[^\s<>"')\]]+"#).expect("literal regex"));

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtonPage {
    Inbox,
    LoginForm,
    SecondFactor,
    Challenge(ReloginReason),
    Unknown,
}

/// Classify a Proton page. The inbox is recognised by its URL path first:
/// message rows can mention anything ("your authentication code"), so row text
/// must never be what decides the page is a second-factor prompt.
pub fn classify_proton(url: &str, text: &str) -> ProtonPage {
    let low = text.to_lowercase();
    let path = url::Url::parse(url)
        .map(|u| u.path().to_lowercase())
        .unwrap_or_default();
    if path.contains("/inbox") && low.contains("inbox") {
        return ProtonPage::Inbox;
    }
    if let Some(r) = detect_challenge(url, text) {
        return ProtonPage::Challenge(r);
    }
    if SECOND_FACTOR.iter().any(|m| low.contains(m)) {
        return ProtonPage::SecondFactor;
    }
    if low.contains(SIGN_IN) && low.contains("password") {
        return ProtonPage::LoginForm;
    }
    ProtonPage::Unknown
}

fn mentions_claude(lower: &str) -> bool {
    ROW_NEEDLES.iter().any(|n| lower.contains(n))
}

/// How far from a Claude/Anthropic mention a code may sit.
/// A list row is sender then subject, so a code counts when the mention is on
/// its own line or the line above; the next row's sender must not count.
const LIST_REACH: (usize, usize) = (1, 0);
/// An opened message is one mail, so a code a few lines from the mention counts.
const MESSAGE_REACH: (usize, usize) = (3, 3);

/// 6-digit codes that sit within `reach` (lines before, lines after) of a
/// Claude/Anthropic mention, in page order (the inbox lists newest first).
pub fn code_candidates(text: &str, reach: (usize, usize)) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<String> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(cap) = CODE_RE.captures(line) else {
            continue;
        };
        let lo = i.saturating_sub(reach.0);
        let hi = (i + reach.1 + 1).min(lines.len());
        let window = lines[lo..hi].join("\n").to_lowercase();
        if mentions_claude(&window) {
            let code = cap[1].to_string();
            if !out.contains(&code) {
                out.push(code);
            }
        }
    }
    out
}

/// How many lines mention Claude or Anthropic (a new message raises it).
pub fn mention_count(text: &str) -> usize {
    text.lines()
        .filter(|l| mentions_claude(&l.to_lowercase()))
        .count()
}

/// A `https://claude.ai/...` link in text that mentions Claude, host-checked.
pub fn magic_link(text: &str) -> Option<String> {
    LINK_RE.find_iter(text).find_map(|m| {
        let link = m.as_str();
        let host_ok = url::Url::parse(link)
            .ok()
            .and_then(|u| u.host_str().map(|h| h == "claude.ai"))
            .unwrap_or(false);
        host_ok.then(|| link.to_string())
    })
}

/// What the inbox already showed before the sign-in email was requested.
#[derive(Debug, Default, Clone)]
pub struct Baseline {
    codes: HashSet<String>,
    mentions: usize,
}

impl Baseline {
    fn from_text(text: &str) -> Self {
        Self {
            codes: code_candidates(text, LIST_REACH).into_iter().collect(),
            mentions: mention_count(text),
        }
    }
}

fn fail(reason: ReloginReason, detail: &str) -> LaneError {
    LaneError::new(reason, detail)
}

/// The inbox list is rendered asynchronously: read it again until two reads
/// 'settle' apart agree.
async fn settled_text<S: LaneSession>(s: &mut S, settle: Duration) -> Result<String, LaneError> {
    let mut prev = s.page_text().await?;
    for _ in 0..SETTLE_READS {
        sleep(settle).await;
        let cur = s.page_text().await?;
        if cur == prev {
            return Ok(cur);
        }
        prev = cur;
    }
    Ok(prev)
}

const SETTLE_READS: usize = 10;
const LOGIN_POLL: Duration = Duration::from_millis(400);

/// Open the inbox (signing in with the vault login if the profile lapsed) and
/// snapshot it. Fails fast, BEFORE any sign-in email is requested, when the
/// inbox cannot be reached.
pub async fn open_inbox<S: LaneSession>(
    s: &mut S,
    mut login: Option<MailLogin>,
    inbox_url: &str,
    t: &Timings,
) -> Result<Baseline, LaneError> {
    s.navigate(inbox_url).await?;
    let end = Instant::now() + t.inbox_open;
    let mut signed_in_at: Option<Instant> = None;
    loop {
        let url = s.current_url().await?;
        let text = s.page_text().await?;
        match classify_proton(&url, &text) {
            ProtonPage::Inbox => {
                let text = settled_text(s, t.settle).await?;
                return Ok(Baseline::from_text(&text));
            }
            ProtonPage::Challenge(r) => return Err(fail(r, "proton challenge")),
            ProtonPage::SecondFactor => {
                return Err(fail(
                    ReloginReason::ProtonSecondFactor,
                    "proton second factor",
                ))
            }
            ProtonPage::LoginForm => match (signed_in_at, login.take()) {
                (Some(at), _) if at.elapsed() > t.login_grace => {
                    return Err(fail(
                        ReloginReason::ProtonLoggedOut,
                        "proton login did not take",
                    ))
                }
                (Some(_), _) => {}
                (None, None) => {
                    return Err(fail(ReloginReason::ProtonLoggedOut, "proton logged out"))
                }
                (None, Some(creds)) => {
                    sign_in(s, &creds).await?;
                    signed_in_at = Some(Instant::now());
                    // Returns as soon as the inbox is on screen; the loop
                    // below decides what a miss means.
                    let _ = s
                        .wait_for_text("inbox", t.login_grace.as_millis() as u64)
                        .await?;
                }
            },
            ProtonPage::Unknown => {}
        }
        if Instant::now() >= end {
            return Err(fail(
                ReloginReason::SelectorDrift,
                "proton page not recognised",
            ));
        }
        sleep(LOGIN_POLL).await;
    }
}

async fn sign_in<S: LaneSession>(s: &mut S, creds: &MailLogin) -> Result<(), LaneError> {
    if !s.fill(USER_SELECTOR, &creds.user).await? || !s.fill(PASS_SELECTOR, &creds.pass).await? {
        return Err(fail(ReloginReason::SelectorDrift, "proton login fields"));
    }
    if !s.click_text(SIGN_IN).await? {
        return Err(fail(ReloginReason::SelectorDrift, "proton sign in button"));
    }
    Ok(())
}

/// Poll the inbox until a code (or sign-in link) that was not in `baseline`
/// shows up in a message that mentions Claude or Anthropic.
pub async fn read_code<S: LaneSession>(
    s: &mut S,
    inbox_url: &str,
    baseline: &Baseline,
    t: &Timings,
) -> Result<MailSecret, LaneError> {
    let end = Instant::now() + t.code_wait;
    loop {
        s.navigate(inbox_url).await?;
        let text = settled_text(s, t.settle).await?;
        if let Some(code) = fresh_code(&text, baseline, LIST_REACH) {
            return Ok(MailSecret::Code(Zeroizing::new(code)));
        }
        if mention_count(&text) > baseline.mentions {
            if let Some(found) = open_newest_and_read(s, baseline, t).await? {
                return Ok(found);
            }
        }
        if Instant::now() + t.code_poll >= end {
            return Err(fail(
                ReloginReason::CodeNotFound,
                "no new code in the inbox",
            ));
        }
        sleep(t.code_poll).await;
    }
}

fn fresh_code(text: &str, baseline: &Baseline, reach: (usize, usize)) -> Option<String> {
    code_candidates(text, reach)
        .into_iter()
        .find(|c| !baseline.codes.contains(c))
}

/// The list row did not carry the code: open the newest row that matches and
/// read the message pane.
async fn open_newest_and_read<S: LaneSession>(
    s: &mut S,
    baseline: &Baseline,
    t: &Timings,
) -> Result<Option<MailSecret>, LaneError> {
    let mut clicked = false;
    for needle in ROW_NEEDLES {
        if s.click_text(needle).await? {
            clicked = true;
            break;
        }
    }
    if !clicked {
        return Ok(None);
    }
    let text = settled_text(s, t.settle).await?;
    if let Some(code) = fresh_code(&text, baseline, MESSAGE_REACH) {
        return Ok(Some(MailSecret::Code(Zeroizing::new(code))));
    }
    // Only a message that mentions Claude may hand over a link.
    if mentions_claude(&text.to_lowercase()) {
        return Ok(magic_link(&text).map(|l| MailSecret::Link(Zeroizing::new(l))));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_inbox_login_second_factor_and_challenge() {
        assert_eq!(
            classify_proton(
                "https://mail.proton.me/u/0/inbox",
                "Inbox\nYour authentication code"
            ),
            ProtonPage::Inbox,
            "row text must not turn the inbox into a 2FA prompt"
        );
        assert_eq!(
            classify_proton(
                "https://account.proton.me/login",
                "Sign in\nEmail or username\nPassword"
            ),
            ProtonPage::LoginForm
        );
        assert_eq!(
            classify_proton(
                "https://account.proton.me/login",
                "Two-factor authentication\nEnter the code"
            ),
            ProtonPage::SecondFactor
        );
        assert_eq!(
            classify_proton(
                "https://account.proton.me/login",
                "Unlock your mailbox\nMailbox password"
            ),
            ProtonPage::SecondFactor
        );
        assert_eq!(
            classify_proton("https://account.proton.me/x", "Just a moment..."),
            ProtonPage::Challenge(ReloginReason::CloudflareChallenge)
        );
        assert_eq!(
            classify_proton("https://account.proton.me/x", "Loading"),
            ProtonPage::Unknown
        );
    }

    #[test]
    fn a_code_counts_only_next_to_a_claude_or_anthropic_mention() {
        let text = "Inbox
Bank
Your code is 111111
Anthropic
Your Claude verification code is 123456
Other
Order 999999";
        assert_eq!(
            code_candidates(text, LIST_REACH),
            vec!["123456".to_string()]
        );
        assert!(code_candidates(
            "Inbox
Bank
Your code is 111111",
            LIST_REACH
        )
        .is_empty());
        // Seven digits is not a code.
        assert!(code_candidates("Claude 1234567", LIST_REACH).is_empty());
        // In an opened message the mention may be a few lines away.
        assert_eq!(
            code_candidates(
                "Claude
Your login
code
123456",
                MESSAGE_REACH
            ),
            vec!["123456".to_string()]
        );
    }

    #[test]
    fn baseline_codes_are_never_fresh() {
        let before = "Inbox\nYour Claude verification code is 654321";
        let base = Baseline::from_text(before);
        assert_eq!(fresh_code(before, &base, LIST_REACH), None);
        let after = "Inbox\nYour Claude verification code is 123456\nYour Claude verification code is 654321";
        assert_eq!(
            fresh_code(after, &base, LIST_REACH).as_deref(),
            Some("123456")
        );
        assert!(mention_count(after) > base.mentions);
    }

    #[test]
    fn magic_links_are_host_checked() {
        assert_eq!(
            magic_link("Log in: https://claude.ai/magic-link#abc123 thanks").as_deref(),
            Some("https://claude.ai/magic-link#abc123")
        );
        assert_eq!(magic_link("https://claude.ai.evil.example/x"), None);
    }
}
