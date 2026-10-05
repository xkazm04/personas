//! The devlog fingerprint: `fnv1a32(lvl|tgt|normalize(msg))` as 8 lowercase
//! hex characters.
//!
//! `scripts/devlog/fingerprint.mjs` is the reference implementation and
//! `scripts/devlog/fp-vectors.json` the contract both sides test against.
//! The rules, their ORDER and their tokens are copied from that file. Every
//! class is ASCII-only, except the whitespace class inside the Windows-path
//! rule, which spells out exactly the code points JavaScript's `\s` matches
//! (Rust's Unicode `\s` disagrees with it on U+FEFF).

use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::sync::LazyLock;

use regex::{NoExpand, Regex};
use tracing::callsite::Identifier;
use tracing::field::{Field, Visit};
use tracing::Event;

/// The JS `\s` set, written out: ASCII whitespace, NBSP, the Unicode space
/// separators, the line/paragraph separators and the BOM.
const JS_WHITESPACE: &str = r"\t\n\x0B\x0C\r \x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

static RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    let windows_path = format!(r#"[A-Za-z]:[\\/][^{JS_WHITESPACE}"'<>|]*"#);
    [
        (
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            "<uuid>",
        ),
        (windows_path.as_str(), "<path>"),
        (r"/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+", "<path>"),
        (r#""[^"]*""#, "<s>"),
        (r"`[^`]*`", "<s>"),
        (r"[0-9a-fA-F]{8,}", "<hex>"),
        (r"-?[0-9]+(?:\.[0-9]+)?", "<n>"),
    ]
    .into_iter()
    // Static initialiser over literal patterns: a failure here is a typo in
    // this file, caught by the vector test on the first run.
    .map(|(pattern, token)| (Regex::new(pattern).expect("devlog fp rule"), token))
    .collect()
});

/// Replace every value-shaped run in a message with its class token, in the
/// reference order.
pub fn normalize_message(msg: &str) -> String {
    let mut out = msg.to_string();
    for (re, token) in RULES.iter() {
        if re.is_match(&out) {
            out = re.replace_all(&out, NoExpand(token)).into_owned();
        }
    }
    out
}

const FNV_OFFSET: u32 = 0x811c_9dc5;
const FNV_PRIME: u32 = 0x0100_0193;

fn fnv1a32_update(mut hash: u32, bytes: &[u8]) -> u32 {
    for byte in bytes {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// Fingerprint of an application record over an already-normalized message.
pub fn fingerprint_normalized(lvl: &str, tgt: &str, norm: &str) -> u32 {
    let mut hash = fnv1a32_update(FNV_OFFSET, lvl.as_bytes());
    hash = fnv1a32_update(hash, b"|");
    hash = fnv1a32_update(hash, tgt.as_bytes());
    hash = fnv1a32_update(hash, b"|");
    fnv1a32_update(hash, norm.as_bytes())
}

/// Fingerprint of an application record (Rust or WebView source).
pub fn fingerprint(lvl: &str, tgt: &str, msg: &str) -> u32 {
    fingerprint_normalized(lvl, tgt, &normalize_message(msg))
}

/// The wire form: 8 lowercase hex characters.
pub fn fp_hex(fp: u32) -> String {
    format!("{fp:08x}")
}

// ---------------------------------------------------------------------------
// Stamping a tracing event: its message and fingerprint, computed once.
// ---------------------------------------------------------------------------

/// Pulls the `message` field out of an event, formatted.
#[derive(Default)]
struct MessageVisitor {
    msg: Option<String>,
}

impl Visit for MessageVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.msg = Some(value.to_string());
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.msg = Some(format!("{value:?}"));
        }
    }
}

/// The last message and fp seen at a callsite. A callsite with a static
/// message (the common case) hits on every event after the first, so the
/// normalization regexes run only for messages that actually vary. The
/// target is part of the entry because `log`-crate events share one callsite
/// per level across every target.
struct CacheEntry {
    target: Box<str>,
    msg: Box<str>,
    fp: u32,
}

/// A message longer than this is not cached (it is almost certainly dynamic).
const CACHE_MAX_MSG: usize = 512;
/// Per-thread entry cap; the cache is dropped and refilled past it.
const CACHE_MAX_ENTRIES: usize = 4096;

/// What the filter computed for the event this thread is dispatching.
struct Stamp {
    event_addr: usize,
    callsite: Identifier,
    msg: String,
    fp: u32,
}

thread_local! {
    static FP_CACHE: RefCell<HashMap<Identifier, CacheEntry>> = RefCell::new(HashMap::new());
    static CURRENT: RefCell<Option<Stamp>> = const { RefCell::new(None) };
}

fn compute(event: &Event<'_>) -> (String, u32) {
    let meta = event.metadata();
    let mut visitor = MessageVisitor::default();
    event.record(&mut visitor);
    let msg = visitor.msg.unwrap_or_default();
    let (lvl, tgt) = (meta.level().as_str(), meta.target());
    let callsite = meta.callsite();
    let cached = FP_CACHE
        .try_with(|cache| {
            let cache = cache.try_borrow().ok()?;
            let hit = cache.get(&callsite)?;
            (*hit.msg == *msg && *hit.target == *tgt).then_some(hit.fp)
        })
        .ok()
        .flatten();
    if let Some(fp) = cached {
        return (msg, fp);
    }
    let fp = fingerprint(lvl, tgt, &msg);
    if msg.len() <= CACHE_MAX_MSG {
        let _ = FP_CACHE.try_with(|cache| {
            if let Ok(mut cache) = cache.try_borrow_mut() {
                if cache.len() >= CACHE_MAX_ENTRIES {
                    cache.clear();
                }
                cache.insert(
                    callsite,
                    CacheEntry {
                        target: tgt.into(),
                        msg: msg.as_str().into(),
                        fp,
                    },
                );
            }
        });
    }
    (msg, fp)
}

/// Fingerprint `event` and leave its message + fp for [`take_stamp`]. Called
/// by the rate-limit filter, which sees every event before any sink does.
pub fn stamp_event(event: &Event<'_>) -> u32 {
    let (msg, fp) = compute(event);
    let _ = CURRENT.try_with(|cur| {
        if let Ok(mut cur) = cur.try_borrow_mut() {
            *cur = Some(Stamp {
                event_addr: event as *const Event<'_> as usize,
                callsite: event.metadata().callsite(),
                msg,
                fp,
            });
        }
    });
    fp
}

/// The message and fp of `event`: the filter's stamp when it is this very
/// event, otherwise computed here (a sink installed without the filter).
pub fn take_stamp(event: &Event<'_>) -> (String, u32) {
    let addr = event as *const Event<'_> as usize;
    let callsite = event.metadata().callsite();
    let stamped = CURRENT
        .try_with(|cur| {
            let mut cur = cur.try_borrow_mut().ok()?;
            match cur.take() {
                Some(s) if s.event_addr == addr && s.callsite == callsite => Some((s.msg, s.fp)),
                _ => None,
            }
        })
        .ok()
        .flatten();
    stamped.unwrap_or_else(|| compute(event))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `app[]` vector in the shared contract file reproduces byte for
    /// byte: the normalized message and the fingerprint.
    #[test]
    fn fp_vectors_match_reference() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("scripts/devlog/fp-vectors.json");
        let raw = std::fs::read_to_string(&path).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let app = doc["app"].as_array().unwrap();
        assert!(!app.is_empty(), "fp-vectors.json has no app vectors");
        for v in app {
            let (lvl, tgt, msg) = (
                v["lvl"].as_str().unwrap(),
                v["tgt"].as_str().unwrap(),
                v["msg"].as_str().unwrap(),
            );
            assert_eq!(
                normalize_message(msg),
                v["norm"].as_str().unwrap(),
                "norm of {msg:?}"
            );
            assert_eq!(
                fp_hex(fingerprint(lvl, tgt, msg)),
                v["fp"].as_str().unwrap(),
                "fp of {msg:?}"
            );
        }
    }

    /// The one place the Rust and JS whitespace classes would disagree: a BOM
    /// ends a Windows path in JS, so it must here too.
    #[test]
    fn windows_path_stops_at_js_whitespace() {
        assert_eq!(
            normalize_message("C:\\a\\b\u{FEFF}tail"),
            "<path>\u{FEFF}tail"
        );
    }
}
