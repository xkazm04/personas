//! Small text utilities.

/// Largest char-boundary index `<= idx` in `s` (backward scan).
///
/// The building block behind [`truncate_on_char_boundary`]: use this directly
/// when you need the boundary index itself rather than a truncated slice
/// (e.g. draining a prefix, or computing a start offset for a snippet).
pub fn floor_char_boundary(s: &str, idx: usize) -> usize {
    let mut end = idx.min(s.len());
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    end
}

/// Smallest char-boundary index `>= idx` in `s` (forward scan).
///
/// Use this — not [`floor_char_boundary`] — when truncating from the
/// *front* of a string (keeping a suffix, e.g. a ring buffer or "last N
/// bytes of output" tail): scanning backward from a mid-char index would
/// keep bytes from a split codepoint, and scanning forward is the correct
/// direction to land on the next full character instead.
pub fn ceil_char_boundary(s: &str, idx: usize) -> usize {
    let mut start = idx.min(s.len());
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    start
}

/// Truncate `s` to at most `max_bytes` **without splitting a UTF-8 char**.
/// Returns a borrowed slice (no allocation).
///
/// Replaces the unsafe `&s[..N]` pattern, which panics when byte `N` lands
/// inside a multi-byte char (`≤`, `$`, em-dash, accents, CJK — ubiquitous in
/// LLM / tool / user content). One such slice (`runner/mod.rs`) failed a
/// persona execution and stalled an autonomous team cascade; this helper (and
/// its forward-scanning sibling [`ceil_char_boundary`] for front-truncation
/// sites) is the safe replacement now applied across the content-truncation
/// call sites in the codebase.
pub fn truncate_on_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    &s[..floor_char_boundary(s, max_bytes)]
}

/// Convert a `snake_case`/`kebab-case` identifier into a human-readable
/// label: replace `_`/`-` with spaces, then either title-case every word
/// (`per_word = true`) or capitalize only the first character of the whole
/// string (`per_word = false`).
///
/// Consolidates two independently-written `humanize` helpers that diverged on
/// exactly this per-word-vs-first-word behavior (`desktop_discovery::
/// humanize_mcp_name` and `recipe_parameters::humanize`; see
/// refactor-bughunt-2026-07-10, tauri-engine-4-10 #9).
pub fn humanize_identifier(name: &str, per_word: bool) -> String {
    let spaced = name.replace(['-', '_'], " ");
    if per_word {
        spaced
            .split_whitespace()
            .map(|word| {
                let mut chars = word.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => {
                        let mut s = first.to_uppercase().to_string();
                        s.extend(chars);
                        s
                    }
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        let mut chars = spaced.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => spaced,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ceil_char_boundary, floor_char_boundary, truncate_on_char_boundary};

    #[test]
    fn never_splits_multibyte() {
        // "a≤b" — '≤' is 3 bytes (a=1, ≤=2..5). Slicing at byte 2 would panic.
        let s = "a≤b";
        for n in 0..=s.len() + 2 {
            let t = truncate_on_char_boundary(s, n);
            assert!(s.starts_with(t)); // always a valid prefix
            assert!(t.len() <= n.max(0)); // never exceeds the budget
        }
    }

    #[test]
    fn short_string_unchanged() {
        assert_eq!(truncate_on_char_boundary("hi", 500), "hi");
    }

    #[test]
    fn ascii_truncates_exactly() {
        assert_eq!(truncate_on_char_boundary("abcdef", 3), "abc");
    }

    #[test]
    fn ceil_advances_to_next_boundary() {
        let s = "a≤b"; // a=1 byte, ≤=3 bytes (indices 1,2,3), b at index 4
        assert_eq!(ceil_char_boundary(s, 0), 0);
        assert_eq!(ceil_char_boundary(s, 1), 1);
        assert_eq!(ceil_char_boundary(s, 2), 4); // mid-char -> next boundary
        assert_eq!(ceil_char_boundary(s, 3), 4);
        assert_eq!(ceil_char_boundary(s, 4), 4);
        assert_eq!(ceil_char_boundary(s, 10), s.len());
    }

    #[test]
    fn floor_backs_off_to_prior_boundary() {
        let s = "a≤b";
        assert_eq!(floor_char_boundary(s, 2), 1); // mid-char -> back off
        assert_eq!(floor_char_boundary(s, 4), 4);
        assert_eq!(floor_char_boundary(s, 10), s.len());
    }
}
