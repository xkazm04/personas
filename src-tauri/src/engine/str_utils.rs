/// Truncate `s` to at most `max` *characters*, appending `"..."` when shortened.
/// Returns an owned `String`.
pub fn truncate_owned(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((byte_offset, _)) => format!("{}...", &s[..byte_offset]),
        None => s.to_string(),
    }
}
