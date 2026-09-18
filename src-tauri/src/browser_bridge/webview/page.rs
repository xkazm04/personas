//! The focused page as a chat turn's context (athena-browser-react).
//!
//! No athena-portable source: this is Personas' own. A plain chat turn used
//! to carry nothing of the page the operator was looking at — the Whitelist
//! block says which origins exist, not what is on screen — so "what do you
//! think about this page?" was a question Athena could only guess at.
//! [`page_capture`] answers it with the FOCUSED tab's url, its title and up to
//! [`PAGE_CAPTURE_CAP_CHARS`] of its visible text, read through the same door
//! every other hand uses (`page_read`, over the page relay), and the prompt
//! composer renders it as a dynamic block (`prompt::capabilities::
//! format_browser_page`).
//!
//! **Never an error, never a long wait.** A closed Browser page, no focused
//! tab, a tab whose relay socket a strict CSP blocked, or a page that does not
//! answer inside [`PAGE_CAPTURE_TIMEOUT`] are all `None`: the turn goes on
//! without the block, exactly as it did before this existed. The timeout is
//! the whole bound on what a capture can cost a turn.
//!
//! **The cut is announced twice, deliberately.** `hands.js` reports
//! `truncated` beside the text it cut, and [`shape_text`] cuts again at the
//! same cap after collapsing whitespace — so the flag is right whichever half
//! did the cutting, and a caller gets `(String, bool)` rather than a string
//! with an ellipsis spliced in.

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::super::backend::SNAPSHOT_CAP_CHARS;
use super::{hands, tabs::Tabs};

/// The most visible text a capture carries. The one cap the whole browser
/// surface shares (`BROWSER_SNAPSHOT_CAP_CHARS`), not a second number.
pub const PAGE_CAPTURE_CAP_CHARS: usize = SNAPSHOT_CAP_CHARS;

/// How long a chat turn waits for the page before going on without it. A
/// page answers a `page_read` in tens of milliseconds; a page that has not
/// answered in this long has a blocked socket, and the turn must not pay for
/// it.
pub const PAGE_CAPTURE_TIMEOUT: Duration = Duration::from_millis(1_500);

/// What the focused page looked like at the top of a turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageCapture {
    /// Where the tab is, from the tab registry (the page's own `location`
    /// is the fallback when the registry has no url for it).
    pub url: String,
    /// The title the page last announced (`Tabs::set_title`), or the one
    /// the page reported with its text, or empty.
    pub title: String,
    /// The visible text, whitespace collapsed, at most
    /// [`PAGE_CAPTURE_CAP_CHARS`] chars.
    pub text: String,
    /// The page held more text than `text` carries.
    pub truncated: bool,
    /// How long the capture took, relay round trip included.
    pub captured_ms: u64,
}

/// Capture the FOCUSED tab of the embedded Browser, or `None`.
///
/// `None` when the browser backend was never installed (no `Tabs` state),
/// when no tab is focused, when the page refuses or does not answer within
/// [`PAGE_CAPTURE_TIMEOUT`]. Every miss is logged at debug and none is an
/// error: the caller composes a turn with or without the block.
pub async fn page_capture(app: &AppHandle) -> Option<PageCapture> {
    let tabs = app.try_state::<Tabs>()?;
    let id = tabs.focused()?;
    let started = Instant::now();
    let result = hands::call_with_timeout(
        app,
        id,
        hands::READ,
        json!({ "limit": PAGE_CAPTURE_CAP_CHARS }),
        PAGE_CAPTURE_TIMEOUT,
    )
    .await;
    if !result.ok {
        tracing::debug!(
            tab = id,
            reason = ?result.reason,
            error = ?result.error,
            "browser page capture: no text for this turn"
        );
        return None;
    }
    // `extra` is the page's whole answer, with `output` as the page sent it —
    // before `hands::from_page` applied its own announced cut, which would
    // otherwise footer the text a second time at the same cap.
    let answer = result.extra.clone().unwrap_or_else(|| json!({}));
    let raw = answer
        .get("output")
        .and_then(Value::as_str)
        .unwrap_or(&result.output);
    let page_truncated = answer
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (text, truncated) = shape_text(raw, page_truncated, PAGE_CAPTURE_CAP_CHARS);
    if text.is_empty() {
        tracing::debug!(
            tab = id,
            "browser page capture: the page has no visible text"
        );
        return None;
    }
    let url = tabs
        .url_for(id)
        .filter(|u| !u.is_empty())
        .or_else(|| {
            answer
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let title = tabs
        .title_for(id)
        .filter(|t| !t.trim().is_empty())
        .or_else(|| {
            answer
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    Some(PageCapture {
        url,
        title: title.trim().to_string(),
        text,
        truncated,
        captured_ms: started.elapsed().as_millis() as u64,
    })
}

/// The page's text as the prompt carries it: the hand's announced-cut footer
/// removed (the block states the cut in its own words), whitespace collapsed
/// (a run holding a newline becomes one newline, any other run one space),
/// trimmed, and cut at `cap` on a char boundary. The flag is true when either
/// the page or this function cut something.
pub fn shape_text(raw: &str, page_truncated: bool, cap: usize) -> (String, bool) {
    let body = if page_truncated {
        strip_showing_footer(raw)
    } else {
        raw
    };
    let mut out = String::with_capacity(body.len().min(cap + 1));
    let mut pending_ws: Option<char> = None;
    for c in body.chars() {
        if c.is_whitespace() {
            pending_ws = Some(match pending_ws {
                Some('\n') => '\n',
                _ if c == '\n' || c == '\r' => '\n',
                _ => ' ',
            });
            continue;
        }
        if let Some(ws) = pending_ws.take() {
            if !out.is_empty() {
                out.push(ws);
            }
        }
        out.push(c);
    }
    let mut truncated = page_truncated;
    if out.len() > cap {
        let kept = crate::utils::text::truncate_on_char_boundary(&out, cap);
        out = kept.trim_end().to_string();
        truncated = true;
    }
    (out, truncated)
}

/// Drop the `(showing N of M)` line `hands.js` appends when it cut the text.
fn strip_showing_footer(raw: &str) -> &str {
    let trimmed = raw.trim_end();
    match trimmed.rfind('\n') {
        Some(at) => {
            let last = trimmed[at + 1..].trim();
            if last.starts_with("(showing ") && last.ends_with(')') {
                &trimmed[..at]
            } else {
                trimmed
            }
        }
        None => trimmed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_collapses_and_the_text_is_trimmed() {
        let (text, truncated) = shape_text(
            "  Lumen   Desk\t Lamp \n\n\n Pro  \r\n  $149 ",
            false,
            8_000,
        );
        assert_eq!(text, "Lumen Desk Lamp\nPro\n$149");
        assert!(!truncated);
    }

    #[test]
    fn the_cap_cuts_on_a_char_boundary_and_says_so() {
        let raw = "é".repeat(20); // 2 bytes each
        let (text, truncated) = shape_text(&raw, false, 11);
        assert_eq!(text, "é".repeat(5), "11 bytes floors to 10, five chars");
        assert!(truncated);
        // Under the cap: untouched, and not truncated.
        let (text, truncated) = shape_text("short", false, 11);
        assert_eq!(text, "short");
        assert!(!truncated);
    }

    #[test]
    fn the_pages_own_cut_is_honoured_and_its_footer_dropped() {
        let raw = "the visible text\n(showing 16 of 4000)";
        let (text, truncated) = shape_text(raw, true, 8_000);
        assert_eq!(text, "the visible text");
        assert!(
            truncated,
            "the page said it cut, so the capture says so too"
        );
        // A footer-shaped LAST LINE is only dropped when the page said it cut.
        let (text, truncated) = shape_text(raw, false, 8_000);
        assert_eq!(text, "the visible text\n(showing 16 of 4000)");
        assert!(!truncated);
    }

    #[test]
    fn an_empty_page_is_an_empty_capture() {
        assert_eq!(shape_text("   \n\t ", false, 100), (String::new(), false));
        assert_eq!(shape_text("", true, 100), (String::new(), true));
    }

    #[test]
    fn the_capture_cap_is_the_one_snapshot_cap() {
        assert_eq!(PAGE_CAPTURE_CAP_CHARS, SNAPSHOT_CAP_CHARS);
        assert!(PAGE_CAPTURE_TIMEOUT < Duration::from_secs(2));
    }
}
