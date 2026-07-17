//! Shared string/id helpers used across the brain modules
//! (`semantic`, `procedural`, `goals`, `doctrine`, `retrieval`, `reflection`,
//! `backlog`, `episodic`, `rituals`, `cockpit`, `consolidation`, ...).
//!
//! ## Why this module exists
//!
//! `sha256_hex`, `excerpt`, `short_id`, `slugify`, `body_after_frontmatter`,
//! and `escape_yaml` were re-implemented near-verbatim in file after file —
//! pure functions with no module-specific behavior beyond a slug fallback
//! word, a slug length cap, or an excerpt cap. Consolidated here so a fix to
//! the shared logic (e.g. the char-boundary-safe truncation) only needs to
//! land once. See refactor-bughunt-2026-07-10 finding #8.

use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Stable `sha256:<hex>` content hash, used as a dedupe/change-detection key
/// across brain writes.
pub fn sha256_hex(s: &str) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(s.as_bytes())))
}

/// Truncate `s` to at most `n` bytes on a char boundary (never panics on a
/// multibyte split), for excerpt/preview display.
pub fn excerpt(s: &str, n: usize) -> String {
    crate::utils::text::truncate_on_char_boundary(s, n).to_string()
}

/// Random lowercase-hex id: the first `n` chars of a UUIDv4 with dashes
/// stripped.
pub fn short_id(n: usize) -> String {
    Uuid::new_v4().simple().to_string().chars().take(n).collect()
}

/// Lowercase-ascii-alphanumeric slug with single-dash separators (leading/
/// trailing/duplicate separators collapsed). Falls back to `fallback` when
/// the input has no alphanumeric characters at all; caps the result to `max`
/// chars when `Some`.
pub fn slugify(s: &str, fallback: &str, max: Option<usize>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        fallback.to_string()
    } else if let Some(max) = max {
        out.chars().take(max).collect()
    } else {
        out
    }
}

/// Strip a leading `---\n ... \n---` YAML frontmatter block, returning the
/// trimmed body that follows it. Returns `md` unchanged if there is no
/// well-formed frontmatter block.
pub fn body_after_frontmatter(md: &str) -> String {
    if let Some(after) = md.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            return after[end + 4..].trim_start().to_string();
        }
    }
    md.to_string()
}

/// Escape a string for embedding inside a double-quoted YAML scalar
/// (backslashes and double quotes).
pub fn escape_yaml(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_is_stable_and_prefixed() {
        let a = sha256_hex("hello");
        let b = sha256_hex("hello");
        assert_eq!(a, b);
        assert!(a.starts_with("sha256:"));
        assert_ne!(a, sha256_hex("world"));
    }

    #[test]
    fn excerpt_truncates_on_char_boundary() {
        // multibyte string; naive byte slicing at n=1 would panic
        let s = "é".repeat(10);
        let out = excerpt(&s, 5);
        assert!(out.len() <= 5);
    }

    #[test]
    fn short_id_respects_length() {
        assert_eq!(short_id(8).len(), 8);
        assert_eq!(short_id(10).len(), 10);
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello, World!", "fallback", None), "hello-world");
        assert_eq!(slugify("   ", "fallback", None), "fallback");
        assert_eq!(
            slugify("a very long title that exceeds forty characters for sure", "goal", Some(10)),
            "averylongt"
        );
    }

    #[test]
    fn body_after_frontmatter_strips_block() {
        let md = "---\nid: \"x\"\n---\n\nbody text";
        assert_eq!(body_after_frontmatter(md), "body text");
        assert_eq!(body_after_frontmatter("no frontmatter"), "no frontmatter");
    }

    #[test]
    fn escape_yaml_escapes_backslash_and_quote() {
        assert_eq!(escape_yaml(r#"a\b"c"#), r#"a\\b\"c"#);
    }
}
