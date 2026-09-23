//! Layered voice, the dispatcher's half: reference links and reply shape.
//!
//! Layer one links to layer two as `[<phrase>](ref:<kind>/<handle>)`
//! (contract: `docs/features/companion/layered-voice.md`). This module walks
//! the CLEANED reply (after the OP/QR/TTS/PROGRESS lines are gone), keeps
//! every link whose target resolves, rewrites `report/new` to the report this
//! reply minted, and turns every other link back into its plain phrase, so
//! prose still reads when a handle was invented. Code is left alone: a link
//! inside a fenced block or an inline code span is display text, not a link.
//!
//! It also owns the reply-shape counters the turn ledger stores
//! (`replyWords`, `replySentences`, `bareIds`). They are a port of
//! `scripts/test/lib/reply-shape.mjs` (`wordCount`, `countSentences`,
//! `countBareIds`), which is the reference behaviour: a bench number and a
//! production number must be computed the same way.

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::companion::reports::{
    MAX_REPORT_BODY_CHARS, MAX_REPORT_SUMMARY_CHARS, MAX_REPORT_TITLE_CHARS,
    REPORT_TRUNCATED_MARKER,
};
use crate::db::UserDbPool;

/// Link kinds the contract defines.
pub const REF_KINDS: &[&str] = &[
    "approval", "card", "decision", "report", "session", "job", "memory", "goal", "persona",
];

/// `companion_node.kind` values a `memory` link may point at. Mirrors the
/// kinds the brain viewer opens (`parseBrainLinks.ts` `KIND_TOKENS`).
const MEMORY_NODE_KINDS: &[&str] = &[
    "design_decision",
    "reflection",
    "procedural",
    "doctrine",
    "backlog",
    "episode",
    "ritual",
    "fact",
    "goal",
];

/// Longest handle considered at all. Every real id is far shorter; this only
/// keeps a runaway token out of a SQL parameter.
const MAX_HANDLE_CHARS: usize = 128;

/// One link that survived validation, as it now reads in the reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLink {
    pub kind: String,
    pub handle: String,
    pub phrase: String,
}

/// What the ref pass did to one reply.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefScan {
    /// Links kept (with `report/new` already rewritten to the minted id).
    pub links: Vec<RefLink>,
    /// Links replaced by their plain phrase: unknown kind, missing handle, or
    /// a handle that does not resolve.
    pub dropped: u32,
}

/// The decision for one well-formed link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RefVerdict {
    Keep,
    /// Keep the link, with this handle instead of the one written.
    Rewrite(String),
    Drop,
}

/// Walk `text`, rewriting every `[phrase](ref:kind/handle)` outside code by
/// `verdict(kind, handle)`. Malformed links (unknown kind, empty or spaced
/// handle, empty phrase) never reach `verdict`; they become their phrase and
/// count as dropped. Text that is not a ref link is copied byte for byte.
pub(super) fn rewrite_refs(
    text: &str,
    mut verdict: impl FnMut(&str, &str) -> RefVerdict,
) -> (String, RefScan) {
    let mut out = String::with_capacity(text.len());
    let mut scan = RefScan::default();
    let mut in_fence = false;
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }
        rewrite_line(line, &mut out, &mut scan, &mut verdict);
    }
    (out, scan)
}

fn rewrite_line(
    line: &str,
    out: &mut String,
    scan: &mut RefScan,
    verdict: &mut impl FnMut(&str, &str) -> RefVerdict,
) {
    let bytes = line.as_bytes();
    let mut i = 0;
    // Start of the not-yet-copied run; copied in slices so multi-byte text
    // is never split.
    let mut copied = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => {
                // An inline code span: a run of N backticks closed by the next
                // run of exactly N. Unclosed, the backticks are literal.
                let run = bytes[i..].iter().take_while(|b| **b == b'`').count();
                let after = i + run;
                match find_backtick_run(&bytes[after..], run) {
                    Some(close) => i = after + close + run,
                    None => i = after,
                }
            }
            b'[' => match parse_ref_link(&line[i..]) {
                Some(link) => {
                    out.push_str(&line[copied..i]);
                    let end = i + link.len;
                    let decision = if link.phrase.trim().is_empty()
                        || !REF_KINDS.contains(&link.kind)
                        || link.handle.is_empty()
                        || link.handle.chars().count() > MAX_HANDLE_CHARS
                    {
                        RefVerdict::Drop
                    } else {
                        verdict(link.kind, link.handle)
                    };
                    match decision {
                        RefVerdict::Keep => {
                            out.push_str(&line[i..end]);
                            scan.links.push(RefLink {
                                kind: link.kind.to_string(),
                                handle: link.handle.to_string(),
                                phrase: link.phrase.to_string(),
                            });
                        }
                        RefVerdict::Rewrite(handle) => {
                            out.push_str(&format!(
                                "[{}](ref:{}/{})",
                                link.phrase, link.kind, handle
                            ));
                            scan.links.push(RefLink {
                                kind: link.kind.to_string(),
                                handle,
                                phrase: link.phrase.to_string(),
                            });
                        }
                        RefVerdict::Drop => {
                            out.push_str(link.phrase);
                            scan.dropped += 1;
                        }
                    }
                    i = end;
                    copied = end;
                }
                None => i += 1,
            },
            _ => i += 1,
        }
    }
    out.push_str(&line[copied..]);
}

/// Offset of the next run of exactly `n` backticks in `bytes`.
fn find_backtick_run(bytes: &[u8], n: usize) -> Option<usize> {
    let mut j = 0;
    while j < bytes.len() {
        if bytes[j] == b'`' {
            let run = bytes[j..].iter().take_while(|b| **b == b'`').count();
            if run == n {
                return Some(j);
            }
            j += run;
        } else {
            j += 1;
        }
    }
    None
}

/// A `[phrase](ref:…)` at the start of `s`. `kind` and `handle` are raw here;
/// the caller decides whether they are well formed.
struct ParsedLink<'a> {
    phrase: &'a str,
    kind: &'a str,
    handle: &'a str,
    /// Bytes consumed, `[` through `)`.
    len: usize,
}

fn parse_ref_link(s: &str) -> Option<ParsedLink<'_>> {
    let rest = s.strip_prefix('[')?;
    let close = rest.find(']')?;
    let phrase = &rest[..close];
    if phrase.contains('[') {
        // `[a [b](ref:…)` — the link starts at the inner bracket.
        return None;
    }
    let after = &rest[close + 1..];
    let target = after.strip_prefix("(ref:")?;
    let end = target.find(')')?;
    let body = &target[..end];
    let (kind, handle) = match body.split_once('/') {
        Some((k, h)) => (k, h),
        None => (body, ""),
    };
    // A handle with whitespace is not an id; the parse still consumes the
    // whole parenthetical so the phrase replaces it cleanly.
    let handle = if handle.chars().any(char::is_whitespace) {
        ""
    } else {
        handle
    };
    Some(ParsedLink {
        phrase,
        kind,
        handle,
        len: 1 + close + 1 + "(ref:".len() + end + 1,
    })
}

/// Does `handle` name a real `kind` target, as far as the USER database can
/// tell? One indexed lookup per link, no network. `minted_report` is the
/// report this reply created, if any, which is what `report/new` resolves to.
///
/// Returns `None` when the answer lives in the app (system) database — a
/// persona, or a goal that is not a companion goal. This function never holds
/// that store, so it can never mistake "store not reachable" for "target does
/// not exist": the caller, which knows whether it has the store, finishes the
/// check with [`validate_system_ref`] or, on a path that genuinely has no app
/// database, [`validate_ref_without_system_store`].
pub(super) fn validate_ref(
    pool: &UserDbPool,
    kind: &str,
    handle: &str,
    minted_report: Option<&str>,
) -> Option<RefVerdict> {
    let found = match kind {
        "report" if handle == "new" => {
            return Some(match minted_report {
                Some(id) => RefVerdict::Rewrite(id.to_string()),
                None => RefVerdict::Drop,
            });
        }
        "report" => user_exists(
            pool,
            "SELECT 1 FROM companion_chat_card WHERE id = ?1 AND kind = 'report'",
            handle,
        ),
        "approval" => user_exists(
            pool,
            "SELECT 1 FROM companion_approval WHERE id = ?1 AND status = 'pending'",
            handle,
        ),
        // There is no decision store of its own; a decision the reply points
        // at is a card (a decisions panel, a plan) until one exists.
        "card" | "decision" => user_exists(
            pool,
            "SELECT 1 FROM companion_chat_card WHERE id = ?1",
            handle,
        ),
        "job" => user_exists(
            pool,
            "SELECT 1 FROM companion_background_job WHERE id = ?1",
            handle,
        ),
        "memory" => memory_exists(pool, handle),
        "goal" => {
            if user_exists(pool, "SELECT 1 FROM companion_goal WHERE id = ?1", handle) {
                true
            } else {
                // Not a companion goal; it may still be a dev goal.
                return None;
            }
        }
        "persona" => return None,
        "session" => crate::commands::fleet::registry::registry()
            .resolve_session_id(handle)
            .is_some(),
        _ => false,
    };
    Some(verdict_of(found))
}

/// Finish a [`validate_ref`] that answered `None`, against the app database.
pub(super) fn validate_system_ref(db: &crate::db::DbPool, kind: &str, handle: &str) -> RefVerdict {
    let found = match kind {
        "goal" => sys_exists(db, "SELECT 1 FROM dev_goals WHERE id = ?1", handle),
        "persona" => sys_exists(db, "SELECT 1 FROM personas WHERE id = ?1", handle),
        _ => false,
    };
    verdict_of(found)
}

/// Finish a [`validate_ref`] that answered `None` on a path that has NO app
/// database at all (the bench harness builds only a user DB). A persona id's
/// shape is the only check available there, so a well-formed UUID is kept; a
/// dev goal cannot be confirmed by shape, so its link is dropped to its plain
/// phrase — the reply still reads, it just carries no link it cannot vouch for.
pub(super) fn validate_ref_without_system_store(kind: &str, handle: &str) -> RefVerdict {
    verdict_of(kind == "persona" && is_uuid(handle))
}

fn verdict_of(found: bool) -> RefVerdict {
    if found {
        RefVerdict::Keep
    } else {
        RefVerdict::Drop
    }
}

fn user_exists(pool: &UserDbPool, sql: &str, id: &str) -> bool {
    let Ok(conn) = pool.get() else {
        return false;
    };
    conn.query_row(sql, params![id], |_| Ok(()))
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn sys_exists(db: &crate::db::DbPool, sql: &str, id: &str) -> bool {
    let Ok(conn) = db.get() else {
        return false;
    };
    conn.query_row(sql, params![id], |_| Ok(()))
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn memory_exists(pool: &UserDbPool, id: &str) -> bool {
    let Ok(conn) = pool.get() else {
        return false;
    };
    let kind: Option<String> = conn
        .query_row(
            "SELECT kind FROM companion_node WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    kind.is_some_and(|k| {
        // A scoped kind (`fact:project`) is still a fact.
        let base = k.split(':').next().unwrap_or("");
        MEMORY_NODE_KINDS.contains(&base)
    })
}

// ---------------------------------------------------------------------------
// Reply shape. Port of scripts/test/lib/reply-shape.mjs.
// ---------------------------------------------------------------------------

/// The shape of one displayed reply, as the turn ledger stores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplyShape {
    pub words: u32,
    pub sentences: u32,
    pub bare_ids: u32,
}

/// Measure a cleaned reply (machine lines already removed).
pub fn reply_shape(text: &str) -> ReplyShape {
    ReplyShape {
        words: word_count(text),
        sentences: count_sentences(text),
        bare_ids: count_bare_ids(text),
    }
}

/// `wordCount`: whitespace-separated runs.
pub fn word_count(text: &str) -> u32 {
    text.split_whitespace().count() as u32
}

/// Replace every fenced block (```…```, the lazy match the JS uses) with a
/// single space. An unclosed fence is left as text, as the JS regex does.
fn strip_fenced(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("```") {
        let after = &rest[open + 3..];
        match after.find("```") {
            Some(close) => {
                out.push_str(&rest[..open]);
                out.push(' ');
                rest = &after[close + 3..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    out
}

/// Replace every single-backtick inline span with no newline (`` `[^`\n]*` ``)
/// with a space.
fn strip_inline_code(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('`') {
        let after = &rest[open + 1..];
        match after.find(['`', '\n']) {
            Some(close) if after.as_bytes()[close] == b'`' => {
                out.push_str(&rest[..open]);
                out.push(' ');
                rest = &after[close + 1..];
            }
            _ => {
                out.push_str(&rest[..open + 1]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Replace every `(ref:<letters>/<non-space, non-paren>)` with a space. The
/// handle is the point of the feature, not a leaked id.
fn strip_ref_handles(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = find_ascii_ci(rest, "(ref:") {
        let after = &rest[open + 5..];
        let kind_len = after
            .bytes()
            .take_while(|b| b.is_ascii_alphabetic())
            .count();
        let tail = &after[kind_len..];
        let matched = if kind_len > 0 && tail.starts_with('/') {
            let handle = &tail[1..];
            let h_len = handle
                .char_indices()
                .find(|(_, c)| *c == ')' || c.is_whitespace())
                .map(|(i, _)| i)
                .unwrap_or(handle.len());
            if handle[h_len..].starts_with(')') {
                Some(5 + kind_len + 1 + h_len + 1)
            } else {
                None
            }
        } else {
            None
        };
        match matched {
            Some(len) => {
                out.push_str(&rest[..open]);
                out.push(' ');
                rest = &rest[open + len..];
            }
            None => {
                out.push_str(&rest[..open + 1]);
                rest = &rest[open + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn find_ascii_ci(hay: &str, needle: &str) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    (0..h.len().saturating_sub(n.len() - 1)).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// `isBareIdToken`: a uuid, a 7-40 char hex run with at least one digit and
/// one letter, or a brain/orchestration prefixed id.
pub fn is_bare_id_token(tok: &str) -> bool {
    if is_uuid(tok) {
        return true;
    }
    let len = tok.len();
    if (7..=40).contains(&len)
        && tok.bytes().all(|b| b.is_ascii_hexdigit())
        && tok.bytes().any(|b| b.is_ascii_digit())
        && tok.bytes().any(|b| b.is_ascii_alphabetic())
    {
        return true;
    }
    const PREFIXES: &[&str] = &[
        "ep", "op", "sess", "job", "appr", "goal", "fact", "doc", "proc", "bl", "dec", "card",
        "task",
    ];
    if let Some((prefix, tail)) = tok.split_once('_') {
        return PREFIXES.contains(&prefix)
            && !tail.is_empty()
            && tail.bytes().all(|b| b.is_ascii_alphanumeric());
    }
    false
}

fn is_uuid(tok: &str) -> bool {
    let b = tok.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// `countBareIds`: ids in the reply outside fenced code blocks and ref-link
/// handles. Ids inside INLINE code count — today's habit is to backtick them,
/// and exempting that undercounts it about 3.4x (WP4 measurement).
pub fn count_bare_ids(text: &str) -> u32 {
    let cleaned = strip_ref_handles(&strip_fenced(text));
    tokens(&cleaned).filter(|t| is_bare_id_token(t)).count() as u32
}

/// Tokens as `/[0-9a-zA-Z][0-9a-zA-Z_-]*/g` finds them.
fn tokens(text: &str) -> impl Iterator<Item = &str> {
    let bytes = text.as_bytes();
    let mut i = 0;
    std::iter::from_fn(move || {
        while i < bytes.len() && !bytes[i].is_ascii_alphanumeric() {
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }
        let start = i;
        while i < bytes.len()
            && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'-')
        {
            i += 1;
        }
        Some(&text[start..i])
    })
}

/// `countSentences`: prose lines split on `[.!?]` followed by whitespace or
/// the end of the line (a line with no terminator but some text is one); a
/// markdown list of at most 3 consecutive items is ONE sentence, a longer one
/// counts each item. Code (fenced and inline) is not prose.
pub fn count_sentences(text: &str) -> u32 {
    let cleaned = strip_inline_code(&strip_fenced(text));
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return 0;
    }
    let lines: Vec<&str> = cleaned.split('\n').collect();
    let mut sentences = 0u32;
    let mut i = 0;
    while i < lines.len() {
        if is_list_item(lines[i]) {
            let mut items = 0u32;
            while i < lines.len() && is_list_item(lines[i]) {
                items += 1;
                i += 1;
            }
            sentences += if items <= 3 { 1 } else { items };
            continue;
        }
        let line = lines[i];
        let b = line.as_bytes();
        let ends = b
            .iter()
            .enumerate()
            .filter(|(j, c)| {
                matches!(c, b'.' | b'!' | b'?')
                    && b.get(j + 1).map_or(true, |n| n.is_ascii_whitespace())
            })
            .count() as u32;
        sentences += if ends > 0 {
            ends
        } else if line.trim().is_empty() {
            0
        } else {
            1
        };
        i += 1;
    }
    sentences
}

/// `^\s*(?:[-*]\s+|\d+\.\s+)`.
fn is_list_item(line: &str) -> bool {
    let t = line.trim_start();
    let b = t.as_bytes();
    if matches!(b.first(), Some(b'-' | b'*')) {
        return b.get(1).is_some_and(|c| c.is_ascii_whitespace());
    }
    let digits = b.iter().take_while(|c| c.is_ascii_digit()).count();
    digits > 0
        && b.get(digits) == Some(&b'.')
        && b.get(digits + 1).is_some_and(|c| c.is_ascii_whitespace())
}

// ---------------------------------------------------------------------------
// The two layered-voice ops: `show_report` and `adjust_register`.
// ---------------------------------------------------------------------------

/// A validated `show_report` op, capped to the contract's limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ReportOp {
    pub(super) title: String,
    pub(super) summary: Option<String>,
    pub(super) body: String,
}

/// Cut `s` to at most `max` chars, ending in an ellipsis when it was cut.
fn cap_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('\u{2026}');
    out
}

/// The op's fields. The reference teaches the `propose_action` envelope
/// (`"action":"show_report","params":{…}`); the contract doc also spells a
/// bare `{"op":"show_report","title":…}`. Both are accepted so neither
/// spelling silently drops a report: for the bare one the fields sit at the
/// top level of the op line.
pub(super) fn op_fields(op: &str, params: &serde_json::Value, payload: &str) -> serde_json::Value {
    if op == "propose_action" {
        return params.clone();
    }
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .or_else(|| {
            super::envelope::repair_op_json(payload)
                .and_then(|fixed| serde_json::from_str(&fixed).ok())
        })
        .unwrap_or(serde_json::Value::Null)
}

fn str_field<'a>(fields: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    fields
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Validate a `show_report` op. A missing title or body drops the op (the
/// error is the warning Athena reads next turn); an over-long field is cut,
/// the body with a visible marker so a truncated report never reads as whole.
pub(super) fn parse_show_report(fields: &serde_json::Value) -> Result<ReportOp, String> {
    let title = str_field(fields, "title").ok_or("`title` is required")?;
    let body = fields
        .get("body")
        .and_then(|v| v.as_str())
        .map(str::trim_end)
        .filter(|s| !s.trim().is_empty())
        .ok_or("`body` (markdown) is required; a report with nothing to read is not a report")?;
    let body = if body.chars().count() > MAX_REPORT_BODY_CHARS {
        let keep = MAX_REPORT_BODY_CHARS - REPORT_TRUNCATED_MARKER.chars().count();
        let mut cut: String = body.chars().take(keep).collect();
        cut.push_str(REPORT_TRUNCATED_MARKER);
        cut
    } else {
        body.to_string()
    };
    Ok(ReportOp {
        title: cap_chars(title, MAX_REPORT_TITLE_CHARS),
        summary: str_field(fields, "summary").map(|s| cap_chars(s, MAX_REPORT_SUMMARY_CHARS)),
        body,
    })
}

/// A parsed `adjust_register` op: `(scope, sentences, reason)`. The range and
/// scope rules live in `register::apply_op`, the one place both the chat op
/// and the approval executor go through.
pub(crate) fn parse_adjust_register(
    fields: &serde_json::Value,
) -> Result<(String, i64, Option<String>), String> {
    let scope = str_field(fields, "scope")
        .unwrap_or(crate::companion::register::DEFAULT_SCOPE)
        .to_string();
    let sentences = fields
        .get("sentences")
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        })
        .ok_or("`sentences` must be a whole number 1..=8")?;
    let reason = str_field(fields, "reason").map(str::to_string);
    Ok((scope, sentences, reason))
}

// ---------------------------------------------------------------------------
// The turn ledger's layered-voice keys.
// ---------------------------------------------------------------------------

/// Add the layered-voice keys to a turn's `outcome_json` object: the shape
/// of the reply he saw (`replyWords`, `replySentences`, `bareIds`) and what
/// the dispatcher did with its links and reports (`refLinks`, `refsDropped`,
/// `reportEmitted`). The caller decides whether the turn is measured at all;
/// an unmeasured turn carries none of these keys (absent is not 0).
pub fn stamp_reply_metrics(outcome: &mut serde_json::Value, dispatched: &super::Dispatched) {
    let Some(obj) = outcome.as_object_mut() else {
        return;
    };
    let shape = reply_shape(&dispatched.cleaned_text);
    obj.insert("replyWords".into(), shape.words.into());
    obj.insert("replySentences".into(), shape.sentences.into());
    obj.insert("bareIds".into(), shape.bare_ids.into());
    obj.insert(
        "refLinks".into(),
        (dispatched.refs.links.len() as u64).into(),
    );
    obj.insert("refsDropped".into(), dispatched.refs.dropped.into());
    obj.insert(
        "reportEmitted".into(),
        (!dispatched.reports.is_empty()).into(),
    );
}
