/// Truncate `s` to at most `max` *characters*, appending `"..."` when shortened.
/// Returns an owned `String`.
pub fn truncate_owned(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((byte_offset, _)) => format!("{}...", &s[..byte_offset]),
        None => s.to_string(),
    }
}

/// Extract balanced top-level `{...}` JSON objects from arbitrary text.
///
/// Walks the text tracking brace depth so a `{ ... }` block that spans multiple
/// lines (pretty-printed) or sits inside ```` ```json ```` code fences is
/// captured whole -- fence backticks and prose outside of braces are simply not
/// `{`, so they are ignored. Once inside an object the scan is string- and
/// escape-aware, so braces or quotes embedded in a payload string (e.g. a file
/// diff or a JSON-encoded `payload`) never prematurely close the object. Each
/// returned slice is a balanced candidate the caller can attempt to deserialize.
///
/// Shared by callers that need to recover JSON from messy LLM output (fenced,
/// prose-wrapped, or otherwise not a clean top-level document) -- e.g. healing-fix
/// parsing and design-result parsing, which both need this same brace-depth scan.
pub fn balanced_json_objects(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut objects = Vec::new();
    let mut depth: u32 = 0;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;

    for (i, &c) in bytes.iter().enumerate() {
        if depth == 0 {
            // Outside any object: only an opening brace is meaningful.
            if c == b'{' {
                start = Some(i);
                depth = 1;
            }
            continue;
        }

        // Inside an object: respect string literals and escape sequences.
        if in_string {
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
            continue;
        }

        match c {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(s) = start.take() {
                        // `{` and `}` are ASCII, so `s` and `i` always land on
                        // char boundaries even within multi-byte UTF-8 text.
                        objects.push(&text[s..=i]);
                    }
                }
            }
            _ => {}
        }
    }

    objects
}
