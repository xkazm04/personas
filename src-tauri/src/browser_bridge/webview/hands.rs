//! The generic hands — ported from athena-portable's `hands.rs`.
//!
//! Source: `C:\Users\kazda\kiro\athena-portable\apps\desktop\src-tauri\src\hands.rs`
//! at athena-portable `c5ec8ca`.
//!
//! Tier 1 is what a page chose to offer (`inject.js`, WebMCP). This is what an
//! agent can do on a page that offered nothing, which is nearly every page.
//! [`super::hands_script`] runs in the page's main world and holds the ref map;
//! this module is the catalogue, the wire and the refusals.
//!
//! **What changed in the port.**
//!
//! - A tenth hand, `page_console`, backed by the ring buffer `hands.js`
//!   installs at document start. `browser_console` has nowhere else to read
//!   from: a line logged while the page was loading is gone by the time anybody
//!   asks for it.
//! - Refusals are the closed [`RefusalCode`] vocabulary of
//!   [`super::super::backend`], not athena's own strings. Athena's `unknown`
//!   catch-all has no member here, so an unrecognised reason becomes
//!   `ValidatorFailed` and the page's own words survive in the hint — a refusal
//!   the model can act on is the whole point of the vocabulary.
//! - The cut is `SNAPSHOT_CAP_CHARS`, the one cap the TS contract and the MCP
//!   layer already share, rather than a second number spelled here.
//!
//! **A hand never rejects.** [`call`] returns a [`HandResult`] on every path,
//! including the ones where nothing ran: no such tab, no such hand, the page
//! never answered. A refusal the model cannot read is a refusal it will make
//! again.
//!
//! **The class is not decided here.** These are capabilities;
//! `browser_bridge::policy` and the `browser_sites` row behind it decide
//! whether one runs. Nothing in this file may argue a hand out of a card.
//!
//! **The last hand is the shell's, not the page's.** `page_screenshot` never
//! reaches `hands.js`: a page cannot photograph itself, and one that could
//! would be photographing whatever it liked. See [`super::capture`].

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::super::backend::{RefusalCode, SNAPSHOT_CAP_CHARS};
use super::{capture, relay, tabs};

/// Who answers a hand: the page it is on, or the shell around it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Runner {
    Page,
    Shell,
}

/// One hand, as a manifest is told about it.
///
/// `reversible` and `side_effects` are the same two flags a page publishes for
/// its own tools, so a hand merges into a manifest with no special case and the
/// class comes out of the same derivation.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Hand {
    pub name: &'static str,
    pub description: &'static str,
    /// `false` for anything that changes the page, which is what keeps a hand
    /// out of `auto`.
    pub reversible: bool,
    /// `none` or `internal`. A hand never claims `external`: it cannot know
    /// whether the button it presses sends an email, and guessing low is how an
    /// irreversible write goes out unasked.
    pub side_effects: &'static str,
    /// Where the work happens, which is where [`call`] sends it.
    pub runner: Runner,
}

/// The ten, in the order a person would use them: look, then act, then show
/// what was seen.
pub const HANDS: &[Hand] = &[
    Hand {
        name: "page_read",
        description: "The visible text of the page, or of one element you have a ref for.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: FIND,
        description: "Operable elements whose label matches a query, each with a ref to act on.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: WAIT,
        description: "Wait, up to a bound, for text to appear on the page.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: CONSOLE,
        description: "The console lines this page has produced since it loaded.",
        reversible: true,
        side_effects: "none",
        runner: Runner::Page,
    },
    Hand {
        name: "page_scroll",
        description: "Bring a ref into view, or move the page by one screen.",
        reversible: true,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_click",
        description: "Click the element a ref names.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_fill",
        description: "Put a value into the field a ref names.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_select",
        description: "Choose an option, by its visible label, in the select a ref names.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: "page_submit",
        description: "Submit the form the ref sits in.",
        reversible: false,
        side_effects: "internal",
        runner: Runner::Page,
    },
    Hand {
        name: SCREENSHOT,
        description: "A picture of the page as it is now, filed as evidence for a decision card.",
        // A picture changes nothing on the page, and taking one twice is taking
        // one twice — but it still arrives GATED on an origin the operator has
        // not trusted yet, like every other hand.
        reversible: true,
        side_effects: "none",
        runner: Runner::Shell,
    },
];

/// The one hand the shell answers. Named once, because three places ask for it.
pub const SCREENSHOT: &str = "page_screenshot";
/// The hand `browser_snapshot` is built out of.
pub const FIND: &str = "page_find";
/// The hand `browser_wait_for` is.
pub const WAIT: &str = "page_wait";
/// The hand `browser_console` is.
pub const CONSOLE: &str = "page_console";

/// The hand of that name, if the table holds one.
pub fn hand(name: &str) -> Option<&'static Hand> {
    HANDS.iter().find(|hand| hand.name == name)
}

/// The hands as WebMCP tool descriptors, in the shape `inject.js` reports a
/// page's own tools in.
///
/// One shape rather than two, because a surface appends the hands to whatever
/// the page listed and hands the single list to one derivation — so a hand and
/// a page tool are classified the same way. A second, manifest-shaped emitter
/// here would be a second place the flags are spelled, and the day they
/// disagree is the day a hand is `auto` on one surface and `gated` on another.
///
/// No caller yet: the consumer is the MCP surface's `tools/list`, which appends
/// these to whatever `browser_page_tools` reported for the page. Remove the
/// allowance in the change that appends them — the parity tests below already
/// hold both halves of the table in place, so this is a declaration with a test
/// and no reader rather than a primitive built ahead of its caller.
#[allow(dead_code)]
pub fn webmcp_tools() -> Vec<Value> {
    HANDS
        .iter()
        .map(|hand| {
            json!({
                "name": hand.name,
                "title": hand.name,
                "description": hand.description,
                "inputSchema": schema_for(hand.name),
                // The standard hints, so a surface that reads only those still
                // classifies a hand correctly. They agree with the `personas`
                // block below by construction.
                "annotations": {
                    "readOnlyHint": hand.side_effects == "none",
                    "consequentialHint": !hand.reversible,
                },
                "personas": {
                    "reversible": hand.reversible,
                    "side_effects": hand.side_effects,
                },
            })
        })
        .collect()
}

/// The parameters each hand takes. Reached only through [`webmcp_tools`], so it
/// carries the same allowance and loses it at the same time.
#[allow(dead_code)]
fn schema_for(name: &str) -> Value {
    let ref_param = json!({ "type": "string", "maxLength": 64 });
    match name {
        // No parameters at all: the picture is of the page on screen, and there
        // is nothing about it for a caller to choose. A `ref` here would promise
        // a crop the capture cannot do.
        SCREENSHOT => json!({ "type": "object", "properties": {} }),
        "page_read" => json!({ "type": "object", "properties": { "ref": ref_param } }),
        FIND => json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "maxLength": 200 },
                "role": { "type": "string", "maxLength": 40 },
            },
        }),
        WAIT => json!({
            "type": "object",
            "properties": {
                "text": { "type": "string", "maxLength": 200 },
                "timeout_ms": { "type": "integer", "minimum": 100, "maximum": 15000 },
            },
            "required": ["text"],
        }),
        CONSOLE => json!({
            "type": "object",
            "properties": {
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 },
                "level": { "type": "string", "enum": ["log", "info", "warn", "error", "debug"] },
            },
        }),
        "page_scroll" => json!({
            "type": "object",
            "properties": {
                "ref": ref_param,
                "direction": { "type": "string", "enum": ["up", "down"] },
            },
        }),
        "page_fill" | "page_select" => json!({
            "type": "object",
            "properties": { "ref": ref_param, "value": { "type": "string", "maxLength": 2000 } },
            "required": ["ref", "value"],
        }),
        _ => json!({
            "type": "object",
            "properties": { "ref": ref_param },
            "required": ["ref"],
        }),
    }
}

/// What a hand answers. Never an `Err`: see the module header.
#[derive(Debug, Clone, Serialize)]
pub struct HandResult {
    pub ok: bool,
    pub output: String,
    /// A member of the closed vocabulary when `ok` is false, `null` otherwise.
    pub reason: Option<RefusalCode>,
    pub error: Option<String>,
    pub ms: u64,
    /// The capture this call filed, and `null` for every hand but
    /// `page_screenshot`.
    pub capture_id: Option<String>,
    /// Whatever structured extras the page's answer carried beside its text
    /// (`matches`, `landmarks`, `title`, `url`, `lines`). Untrusted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,
}

impl HandResult {
    pub fn refused(reason: RefusalCode, detail: impl Into<String>, ms: u64) -> Self {
        Self {
            ok: false,
            output: String::new(),
            reason: Some(reason),
            error: Some(detail.into()),
            ms,
            capture_id: None,
            extra: None,
        }
    }
}

/// Run one hand on one tab.
pub async fn call(app: &AppHandle, tab: u32, name: &str, input: Value) -> HandResult {
    let started = std::time::Instant::now();
    let elapsed = |at: std::time::Instant| at.elapsed().as_millis() as u64;

    let Some(hand) = hand(name) else {
        return HandResult::refused(
            RefusalCode::ValidatorFailed,
            format!("no hand named {name}"),
            elapsed(started),
        );
    };
    // One dispatch, off the table, so adding a shell hand is a row rather than
    // a branch.
    if hand.runner == Runner::Shell {
        return screenshot(app, tab, elapsed(started));
    }
    let body = json!({ "hand": name, "input": input });
    match relay::ask_hands(app, tab, body).await {
        // The relay could not reach the tab at all. Not a page refusing — a tab
        // that is gone.
        Err(detail) => HandResult::refused(RefusalCode::UnknownRef, detail, elapsed(started)),
        Ok(answer) => from_page(&answer, elapsed(started)),
    }
}

/// `page_screenshot`: draw the host window, crop to the page, answer with the
/// file the picture was filed at.
///
/// **Only the focused tab.** A capture is of what is on screen, and the host
/// window shows exactly one page at a time. Asked about any other tab this
/// refuses rather than handing back a picture of a different page under that
/// tab's id — a card whose picture is of somewhere else is worse than a card
/// with no picture, because the person approving it cannot tell.
fn screenshot(app: &AppHandle, tab: u32, ms: u64) -> HandResult {
    use tauri::Manager;

    let focused = app.state::<tabs::Tabs>().focused();
    if focused != Some(tab) {
        // `ValidatorFailed`: the call is well formed and the hand exists, but
        // the state it needs is not the state the window is in.
        return HandResult::refused(
            RefusalCode::ValidatorFailed,
            match focused {
                Some(other) => format!(
                    "a capture is of the page on screen, which is tab {other}, not tab {tab}; focus tab {tab} first"
                ),
                None => "no tab is focused, so there is no page to capture".to_string(),
            },
            ms,
        );
    }

    let shot = match capture::capture(app) {
        Ok(shot) => shot,
        Err(refusal) => return HandResult::refused(refusal.reason, refusal.hint, ms),
    };
    let url = app.state::<tabs::Tabs>().url_for(tab).unwrap_or_default();
    let id = match capture::file(app, tab, &shot) {
        Ok(id) => id,
        // The picture exists and could not be filed. Not the caller's fault and
        // not a policy refusal either, but there is no picture, which is what
        // `ValidatorFailed` says to a caller that has to decide what to do next.
        Err(detail) => return HandResult::refused(RefusalCode::ValidatorFailed, detail, ms),
    };

    HandResult {
        ok: true,
        output: format!(
            "{id} · a capture of {} at {}x{} pixels",
            if url.is_empty() { "the page" } else { &url },
            shot.width,
            shot.height
        ),
        reason: None,
        error: None,
        ms,
        capture_id: Some(id),
        extra: None,
    }
}

/// Read the page's answer into a result, trusting none of its shape.
///
/// A page cannot reach this path — `hands.js` runs before its scripts and the
/// relay carries only what it posts — but the reply still arrives as untyped
/// JSON from a webview, and a missing field must come out as an honest refusal
/// rather than a panic.
fn from_page(answer: &Value, ms: u64) -> HandResult {
    if answer.get("ok").and_then(Value::as_bool) == Some(true) {
        let output = answer
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return HandResult {
            ok: true,
            output: capped(output),
            reason: None,
            error: None,
            ms,
            capture_id: None,
            extra: Some(answer.clone()),
        };
    }
    let reason = answer
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let detail = answer
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("the page refused and said nothing");
    HandResult::refused(normalised(reason), detail, ms)
}

/// Map whatever came back onto the closed vocabulary.
///
/// Athena's `unknown` catch-all has no member here — the vocabulary is closed
/// on purpose — so anything unrecognised becomes `ValidatorFailed`, whose hint
/// tells a model to read the schema and resend. The page's own words travel on
/// in `error`, so nothing is lost; what is refused is letting a page mint a
/// refusal code the rest of the system would have to learn.
fn normalised(reason: &str) -> RefusalCode {
    match reason {
        "unknown_ref" => RefusalCode::UnknownRef,
        "timeout" => RefusalCode::Timeout,
        "stale_page" => RefusalCode::StalePage,
        "user_denied" => RefusalCode::UserDenied,
        _ => RefusalCode::ValidatorFailed,
    }
}

/// Cut long output at the one cap the whole browser surface shares, and say so
/// in the footer the rest of the system uses to the character.
pub fn capped(output: &str) -> String {
    if output.len() <= SNAPSHOT_CAP_CHARS {
        return output.to_string();
    }
    let kept = &output[..floor_char_boundary(output, SNAPSHOT_CAP_CHARS)];
    format!("{kept}\n(showing {} of {})", kept.len(), output.len())
}

/// The largest index at or below `at` that is a char boundary.
/// `str::floor_char_boundary` is still unstable, and cutting mid-codepoint
/// would panic on the slice.
fn floor_char_boundary(text: &str, at: usize) -> usize {
    let mut index = at.min(text.len());
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn script() -> &'static str {
        super::super::hands_script()
    }

    #[test]
    fn there_are_ten_hands_and_every_name_is_distinct() {
        let names: std::collections::BTreeSet<_> = HANDS.iter().map(|h| h.name).collect();
        assert_eq!(names.len(), HANDS.len());
        assert_eq!(HANDS.len(), 10);
    }

    #[test]
    fn nine_hands_are_the_pages_and_the_tenth_is_the_shells() {
        // Not a count for its own sake: the split is what `call` dispatches on,
        // and a hand that drifted to the wrong runner would either be asked of
        // a page that cannot answer it or answered by the shell for a page that
        // could.
        let shell: Vec<_> = HANDS
            .iter()
            .filter(|h| h.runner == Runner::Shell)
            .map(|h| h.name)
            .collect();
        assert_eq!(shell, [SCREENSHOT]);
        assert_eq!(HANDS.iter().filter(|h| h.runner == Runner::Page).count(), 9);
    }

    #[test]
    fn every_hand_that_changes_the_page_is_irreversible() {
        for hand in HANDS {
            let changes = matches!(
                hand.name,
                "page_click" | "page_fill" | "page_select" | "page_submit"
            );
            assert_eq!(
                hand.reversible, !changes,
                "{} claims the wrong reversibility",
                hand.name
            );
        }
    }

    #[test]
    fn no_hand_claims_external_side_effects() {
        for hand in HANDS {
            assert!(
                matches!(hand.side_effects, "none" | "internal"),
                "{} claims {}",
                hand.name,
                hand.side_effects
            );
        }
    }

    #[test]
    fn the_standard_hints_agree_with_the_personas_block() {
        // A surface that reads only the annotations must reach the same class
        // as one that reads the block. A disagreement would be invisible until
        // a surface that has only the hints ran a gated hand without a card.
        for tool in webmcp_tools() {
            let reversible = tool["personas"]["reversible"].as_bool().expect("a flag");
            let read_only = tool["personas"]["side_effects"] == "none";
            assert_eq!(tool["annotations"]["consequentialHint"], !reversible);
            assert_eq!(tool["annotations"]["readOnlyHint"], read_only);
        }
    }

    #[test]
    fn a_hand_that_takes_a_ref_requires_it() {
        for name in ["page_click", "page_fill", "page_select", "page_submit"] {
            let schema = schema_for(name);
            let required = schema["required"].as_array().expect("required list");
            assert!(required.iter().any(|r| r == "ref"), "{name}");
        }
        // And the ones that read the whole page do not: a read with no ref is
        // the page itself.
        for name in ["page_read", FIND, CONSOLE] {
            assert!(schema_for(name).get("required").is_none(), "{name}");
        }
    }

    #[test]
    fn the_shells_hand_takes_no_parameters() {
        let schema = schema_for(SCREENSHOT);
        assert_eq!(schema["type"], "object");
        assert_eq!(
            schema["properties"],
            json!({}),
            "a parameter here would be a promise the capture cannot keep"
        );
    }

    // ---- parity with hands.js ---------------------------------------------

    #[test]
    fn the_hands_script_declares_the_same_names_this_module_does() {
        // The two halves are one capability each, in two languages, and nothing
        // imports across. The shell's hand is exempt in one direction only,
        // which the third parity test below asserts from the other side.
        for hand in HANDS.iter().filter(|h| h.runner == Runner::Page) {
            assert!(
                script().contains(hand.name),
                "hands.js is missing {}",
                hand.name
            );
        }
    }

    #[test]
    fn the_script_claims_the_same_two_flags_for_every_hand() {
        // A drift here is a hand that is `auto` on one surface and `gated` on
        // another, and nothing else would notice.
        for hand in HANDS.iter().filter(|h| h.runner == Runner::Page) {
            let declared = format!(
                "{}: [{}, \"{}\"]",
                hand.name, hand.reversible, hand.side_effects
            );
            assert!(
                script().contains(&declared),
                "hands.js does not declare `{declared}`"
            );
        }
    }

    #[test]
    fn the_script_declares_no_hand_this_module_does_not() {
        let table = script()
            .split("const FLAGS = {")
            .nth(1)
            .and_then(|rest| rest.split("};").next())
            .expect("hands.js declares a FLAGS table");
        let mut seen = 0;
        for line in table.lines() {
            let name = line.split(':').next().map(str::trim).unwrap_or("");
            if name.is_empty() || name.starts_with("//") || name.starts_with('*') {
                continue;
            }
            assert!(
                hand(name).is_some(),
                "hands.js declares {name}, which this module does not"
            );
            seen += 1;
        }
        assert_eq!(
            seen,
            HANDS.iter().filter(|h| h.runner == Runner::Page).count(),
            "the FLAGS table and the page hands are the same set, not a subset"
        );
    }

    #[test]
    fn the_script_does_not_declare_the_shells_hand() {
        // A `page_screenshot` in `hands.js` would be a page offering to
        // photograph itself, which is a page choosing what the evidence for a
        // decision card is.
        assert!(
            !script().contains(SCREENSHOT),
            "hands.js declares {SCREENSHOT}, which only the shell can answer"
        );
    }

    #[test]
    fn the_script_is_on_the_relays_namespace_and_not_the_pages() {
        assert!(script().contains(relay::HANDS_NS));
        assert!(
            !script().contains(&format!("\"{}\"", relay::NS)),
            "a hand on the page's namespace would be answered twice"
        );
    }

    // ---- reading a page's answer -------------------------------------------

    #[test]
    fn a_page_answer_becomes_a_result_that_keeps_its_extras() {
        let answer = json!({ "ok": true, "output": "two rows", "landmarks": ["main: Invoices"] });
        let result = from_page(&answer, 12);

        assert!(result.ok);
        assert_eq!(result.output, "two rows");
        assert!(result.reason.is_none());
        assert_eq!(
            result.extra.as_ref().map(|e| e["landmarks"].clone()),
            Some(json!(["main: Invoices"]))
        );
    }

    #[test]
    fn a_page_refusal_keeps_its_reason_when_the_vocabulary_holds_it() {
        let answer = json!({ "ok": false, "reason": "unknown_ref", "error": "no element" });
        let result = from_page(&answer, 3);

        assert!(!result.ok);
        assert_eq!(result.reason, Some(RefusalCode::UnknownRef));
        assert_eq!(result.error.as_deref(), Some("no element"));
    }

    #[test]
    fn a_reason_outside_the_closed_vocabulary_collapses_and_keeps_the_detail() {
        // A page may not mint a refusal code the rest of the system would have
        // to learn — but its words are not thrown away either.
        let answer = json!({ "ok": false, "reason": "it exploded", "error": "boom" });
        let result = from_page(&answer, 0);
        assert_eq!(result.reason, Some(RefusalCode::ValidatorFailed));
        assert_eq!(result.error.as_deref(), Some("boom"));
    }

    #[test]
    fn an_answer_with_no_shape_at_all_is_still_a_refusal() {
        let result = from_page(&json!({}), 0);
        assert!(!result.ok);
        assert_eq!(result.reason, Some(RefusalCode::ValidatorFailed));
        assert!(result.error.is_some(), "a refusal always says something");
    }

    #[test]
    fn only_a_capture_carries_a_capture_id() {
        // A surface that finds an id there puts a picture on a card — and a
        // picture of the wrong moment is evidence of the wrong thing.
        assert!(from_page(&json!({ "ok": true, "output": "text" }), 1)
            .capture_id
            .is_none());
        assert!(from_page(&json!({ "ok": false }), 1).capture_id.is_none());
    }

    #[test]
    fn a_long_answer_is_cut_at_the_shared_cap_and_says_so() {
        let long = "x".repeat(SNAPSHOT_CAP_CHARS + 500);
        let result = from_page(&json!({ "ok": true, "output": long }), 0);

        assert!(result.output.len() < SNAPSHOT_CAP_CHARS + 60);
        assert!(result.output.ends_with(&format!(
            "(showing {} of {})",
            SNAPSHOT_CAP_CHARS,
            SNAPSHOT_CAP_CHARS + 500
        )));
    }

    #[test]
    fn a_cut_never_lands_mid_character() {
        // A multi-byte page is the normal case, not the exotic one.
        let long = "é".repeat(SNAPSHOT_CAP_CHARS);
        let result = from_page(&json!({ "ok": true, "output": long }), 0);
        assert!(result.output.starts_with('é'));
    }
}
