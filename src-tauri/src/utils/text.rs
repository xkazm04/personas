//! Small text utilities.

/// Truncate `s` to at most `max_bytes` **without splitting a UTF-8 char**.
/// Returns a borrowed slice (no allocation).
///
/// Replaces the unsafe `&s[..N]` pattern, which panics when byte `N` lands
/// inside a multi-byte char (`≤`, `$`, em-dash, accents, CJK — ubiquitous in
/// LLM / tool / user content). One such slice (`runner/mod.rs`) failed a
/// persona execution and stalled an autonomous team cascade; this helper is
/// the safe replacement applied across the content-truncation sites.
pub fn truncate_on_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::truncate_on_char_boundary;

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
}
