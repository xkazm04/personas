/// Truncate `s` to at most `max` bytes, splitting on a valid UTF-8 char boundary.
/// Returns a borrowed slice — zero allocation.
pub fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

/// Truncate `s` to at most `max` *characters*, appending `"..."` when shortened.
/// Returns an owned `String`.
pub fn truncate_owned(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((byte_offset, _)) => format!("{}...", &s[..byte_offset]),
        None => s.to_string(),
    }
}
