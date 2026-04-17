//! Safe JSON deserialization with size and nesting-depth limits.
//!
//! Prevents denial-of-service attacks where a deeply nested or extremely large
//! JSON payload causes exponential memory allocation during `serde_json` parsing.
//!
//! Also provides **lenient** parsing for LLM-generated JSON that may be wrapped
//! in markdown code fences, have trailing commas, or be truncated.
//!
//! Usage:
//! ```ignore
//! use crate::engine::safe_json;
//!
//! // Strict (existing behavior):
//! let val: serde_json::Value = safe_json::from_str(input)?;
//! let typed: MyStruct = safe_json::from_str_as(input)?;
//!
//! // Lenient (for LLM output):
//! let val: serde_json::Value = safe_json::lenient_from_str(input)?;
//! let typed: MyStruct = safe_json::lenient_from_str_as(input)?;
//! ```

use crate::error::AppError;

/// Maximum input size in bytes (16 MiB).  Large enough for any reasonable
/// query response; small enough to prevent memory-bomb payloads.
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;

/// Maximum nesting depth (objects/arrays).  `serde_json` itself has a
/// recursion limit of 128 by default, but we enforce a tighter limit
/// to bound memory consumption earlier.
const MAX_NESTING_DEPTH: usize = 128;

/// Validate that `input` does not exceed size or nesting-depth limits.
///
/// This is a fast O(n) scan that only tracks `[{` / `]}` transitions and
/// skips characters inside JSON strings (including escaped quotes).
fn validate_limits(input: &str) -> Result<(), AppError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(AppError::Validation(format!(
            "JSON input too large ({} bytes, max {MAX_INPUT_BYTES})",
            input.len()
        )));
    }

    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escape = false;

    for byte in input.bytes() {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            match byte {
                b'\\' => escape = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'[' | b'{' => {
                depth += 1;
                if depth > MAX_NESTING_DEPTH {
                    return Err(AppError::Validation(format!(
                        "JSON nesting too deep (>{MAX_NESTING_DEPTH} levels)"
                    )));
                }
            }
            b']' | b'}' => {
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }

    Ok(())
}

/// Deserialize `input` into `serde_json::Value` with safety limits.
pub fn from_str(input: &str) -> Result<serde_json::Value, AppError> {
    validate_limits(input)?;
    serde_json::from_str(input).map_err(AppError::from)
}

/// Deserialize `input` into an arbitrary `Deserialize` type with safety limits.
pub fn from_str_as<T: serde::de::DeserializeOwned>(input: &str) -> Result<T, AppError> {
    validate_limits(input)?;
    serde_json::from_str(input).map_err(AppError::from)
}

// ============================================================================
// Lenient parsing — for LLM-generated JSON
// ============================================================================

/// Deserialize LLM output into `serde_json::Value`, applying recovery heuristics
/// when strict parsing fails.
///
/// Recovery steps (applied only if strict parse fails):
/// 1. Strip markdown code fences (```json ... ```)
/// 2. Trim prefix chatter before the first `{` or `[`
/// 3. Trim suffix chatter after the last matching `}` or `]`
/// 4. Remove trailing commas before `}` or `]`
/// 5. Complete truncated keywords (`tru` → `true`, `fal` → `false`, `nul` → `null`)
#[allow(dead_code)] // planned API — no Tauri command wires into lenient parsing yet
pub fn lenient_from_str(input: &str) -> Result<serde_json::Value, AppError> {
    validate_limits(input)?;

    // Fast path: try strict parse first.
    if let Ok(val) = serde_json::from_str(input) {
        return Ok(val);
    }

    // Slow path: attempt recovery.
    let recovered = recover_json(input);
    serde_json::from_str(&recovered).map_err(AppError::from)
}

/// Deserialize LLM output into an arbitrary type, applying recovery heuristics
/// when strict parsing fails.
#[allow(dead_code)] // planned API — no Tauri command wires into lenient parsing yet
pub fn lenient_from_str_as<T: serde::de::DeserializeOwned>(input: &str) -> Result<T, AppError> {
    validate_limits(input)?;

    // Fast path: try strict parse first.
    if let Ok(val) = serde_json::from_str(input) {
        return Ok(val);
    }

    // Slow path: attempt recovery.
    let recovered = recover_json(input);
    serde_json::from_str(&recovered).map_err(AppError::from)
}

/// Apply recovery heuristics to malformed LLM JSON output.
#[allow(dead_code)] // called by lenient_from_str* which are not yet wired to any command
fn recover_json(input: &str) -> String {
    let mut text = input.to_string();

    // Step 1: Strip markdown code fences.
    text = strip_code_fences(&text);

    // Step 2+3: Extract the JSON body (first `{`/`[` to last `}`/`]`).
    text = extract_json_body(&text);

    // Step 4: Remove trailing commas before `}` or `]`.
    text = remove_trailing_commas(&text);

    // Step 5: Fix truncated keywords at the end.
    text = fix_truncated_keywords(&text);

    text
}

/// Strip markdown code fences from LLM output.
/// Handles: ```json\n...\n```, ```\n...\n```, and prefix chatter before the fence.
#[allow(dead_code)] // used by recover_json → lenient_from_str* (not yet wired to a command)
fn strip_code_fences(input: &str) -> String {
    // Find the opening fence
    let Some(fence_start) = input.find("```") else {
        return input.to_string();
    };

    // Skip the opening fence line (```json or ```)
    let after_fence = &input[fence_start + 3..];
    let content_start = after_fence.find('\n').map(|i| i + 1).unwrap_or(0);
    let content = &after_fence[content_start..];

    // Find the closing fence
    if let Some(end) = content.find("```") {
        content[..end].to_string()
    } else {
        // No closing fence — treat everything after the opening as content
        content.to_string()
    }
}

/// Extract the JSON body by finding the first `{`/`[` and the last matching `}`/`]`.
#[allow(dead_code)] // used by recover_json → lenient_from_str* (not yet wired to a command)
fn extract_json_body(input: &str) -> String {
    let trimmed = input.trim();

    // Find the first JSON-starting character
    let start_idx = trimmed.find(|c| c == '{' || c == '[');
    let Some(start) = start_idx else {
        return trimmed.to_string();
    };

    let opener = trimmed.as_bytes()[start];
    let closer = if opener == b'{' { b'}' } else { b']' };

    // Find the last matching closer
    let end_idx = trimmed.rfind(|c: char| c as u8 == closer);
    let Some(end) = end_idx else {
        return trimmed[start..].to_string();
    };

    trimmed[start..=end].to_string()
}

/// Remove trailing commas before `}` or `]`.
/// Handles: `{"a": 1, "b": 2,}` → `{"a": 1, "b": 2}`
#[allow(dead_code)] // used by recover_json → lenient_from_str* (not yet wired to a command)
fn remove_trailing_commas(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut in_string = false;
    let mut escape = false;

    for i in 0..bytes.len() {
        if escape {
            escape = false;
            result.push(bytes[i]);
            continue;
        }
        if in_string {
            match bytes[i] {
                b'\\' => escape = true,
                b'"' => in_string = false,
                _ => {}
            }
            result.push(bytes[i]);
            continue;
        }

        match bytes[i] {
            b'"' => {
                in_string = true;
                result.push(bytes[i]);
            }
            b',' => {
                // Look ahead past whitespace for `}` or `]`
                let rest = &bytes[i + 1..];
                let next_non_ws = rest.iter().position(|&b| !b.is_ascii_whitespace());
                if let Some(pos) = next_non_ws {
                    if rest[pos] == b'}' || rest[pos] == b']' {
                        // Skip this trailing comma
                        continue;
                    }
                }
                result.push(bytes[i]);
            }
            _ => {
                result.push(bytes[i]);
            }
        }
    }

    // SAFETY: we only removed ASCII commas from valid UTF-8 input.
    String::from_utf8(result).unwrap_or_else(|_| input.to_string())
}

/// Fix truncated boolean/null keywords in JSON value positions.
/// Common when LLM output is cut off mid-token or model omits trailing chars.
///
/// Scans for patterns like `: tru}`, `: fal,`, `: nul]` outside of string
/// literals and replaces them with the full keyword.
#[allow(dead_code)] // used by recover_json → lenient_from_str* (not yet wired to a command)
fn fix_truncated_keywords(input: &str) -> String {
    let replacements: &[(&str, &str)] = &[
        ("tru", "true"),
        ("fals", "false"),
        ("fal", "false"),
        ("nul", "null"),
    ];

    let bytes = input.as_bytes();
    let mut result = input.to_string();
    let mut in_string = false;
    let mut escape = false;

    // Collect replacement sites (offset, len, replacement) working backwards
    // so offsets stay valid after each splice.
    let mut fixes: Vec<(usize, usize, &str)> = Vec::new();

    for i in 0..bytes.len() {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            match bytes[i] {
                b'\\' => escape = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        if bytes[i] == b'"' {
            in_string = true;
            continue;
        }

        // Check if position i starts a truncated keyword
        for &(partial, full) in replacements {
            let pb = partial.as_bytes();
            if i + pb.len() > bytes.len() {
                continue;
            }
            if &bytes[i..i + pb.len()] != pb {
                continue;
            }
            // Verify this is in a value position: preceded by `:` or `,` or `[`
            // (with optional whitespace)
            let before = &input[..i];
            let prev = before.trim_end().bytes().last();
            if !matches!(prev, Some(b':') | Some(b',') | Some(b'[')) {
                continue;
            }
            // Verify what follows is a delimiter, not more identifier chars
            let after_idx = i + pb.len();
            if after_idx < bytes.len() {
                let next = bytes[after_idx];
                if next.is_ascii_alphanumeric() || next == b'_' {
                    // Part of a longer token (e.g. "tru" inside "trust") — skip
                    continue;
                }
            }
            fixes.push((i, pb.len(), full));
            break; // Only one replacement per position
        }
    }

    // Apply fixes in reverse order so byte offsets remain valid
    for (offset, len, full) in fixes.into_iter().rev() {
        result.replace_range(offset..offset + len, full);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_json_succeeds() {
        let val = from_str(r#"{"a": [1, 2, {"b": true}]}"#).unwrap();
        assert!(val.is_object());
    }

    #[test]
    fn deeply_nested_json_rejected() {
        // 200 levels of nesting — well above the 128 limit
        let open: String = "{\"a\":".repeat(200);
        let close: String = "1".to_string() + &"}".repeat(200);
        let payload = format!("{open}{close}");
        let err = from_str(&payload).unwrap_err();
        assert!(err.to_string().contains("nesting too deep"), "{err}");
    }

    #[test]
    fn oversized_input_rejected() {
        let huge = "\"".to_string() + &"x".repeat(MAX_INPUT_BYTES + 1) + "\"";
        let err = from_str(&huge).unwrap_err();
        assert!(err.to_string().contains("too large"), "{err}");
    }

    #[test]
    fn strings_with_braces_ignored() {
        // Braces inside strings should not count toward depth
        let json = r#"{"data": "lots of {{{{{{{{{{{ braces"}"#;
        assert!(from_str(json).is_ok());
    }

    #[test]
    fn escaped_quotes_handled() {
        let json = r#"{"data": "he said \"hello\" {{"}"#;
        assert!(from_str(json).is_ok());
    }

    #[test]
    fn typed_deserialization_works() {
        let result: Vec<i32> = from_str_as("[1, 2, 3]").unwrap();
        assert_eq!(result, vec![1, 2, 3]);
    }

    // ========================================================================
    // Lenient parsing tests
    // ========================================================================

    #[test]
    fn lenient_valid_json_passes_through() {
        let val = lenient_from_str(r#"{"a": 1, "b": true}"#).unwrap();
        assert_eq!(val["a"], 1);
        assert_eq!(val["b"], true);
    }

    #[test]
    fn lenient_strips_markdown_code_fence() {
        let input = "Here's the JSON:\n```json\n{\"status\": \"ok\"}\n```\nDone!";
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["status"], "ok");
    }

    #[test]
    fn lenient_strips_bare_code_fence() {
        let input = "```\n[1, 2, 3]\n```";
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val.as_array().unwrap().len(), 3);
    }

    #[test]
    fn lenient_strips_prefix_chatter() {
        let input = "Sure! Here is the result:\n{\"answer\": 42}";
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["answer"], 42);
    }

    #[test]
    fn lenient_strips_suffix_chatter() {
        let input = "{\"data\": [1,2,3]}\n\nLet me know if you need anything else!";
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["data"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn lenient_removes_trailing_comma_in_object() {
        let input = r#"{"a": 1, "b": 2,}"#;
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["a"], 1);
        assert_eq!(val["b"], 2);
    }

    #[test]
    fn lenient_removes_trailing_comma_in_array() {
        let input = r#"[1, 2, 3,]"#;
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val.as_array().unwrap().len(), 3);
    }

    #[test]
    fn lenient_removes_nested_trailing_commas() {
        let input = r#"{"items": [{"x": 1,}, {"y": 2,},]}"#;
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["items"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn lenient_preserves_commas_in_strings() {
        let input = r#"{"msg": "hello, world",}"#;
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["msg"], "hello, world");
    }

    #[test]
    fn lenient_fixes_truncated_true() {
        let input = r#"{"enabled": tru}"#;
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["enabled"], true);
    }

    #[test]
    fn lenient_fixes_truncated_false() {
        let input = r#"{"enabled": fal}"#;
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["enabled"], false);
    }

    #[test]
    fn lenient_fixes_truncated_null() {
        let input = r#"{"value": nul}"#;
        let val = lenient_from_str(input).unwrap();
        assert!(val["value"].is_null());
    }

    #[test]
    fn lenient_combined_fence_and_trailing_comma() {
        let input = "```json\n{\"a\": 1, \"b\": [2, 3,],}\n```";
        let val = lenient_from_str(input).unwrap();
        assert_eq!(val["a"], 1);
        assert_eq!(val["b"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn lenient_typed_deserialization() {
        let input = "```json\n[1, 2, 3,]\n```";
        let result: Vec<i32> = lenient_from_str_as(input).unwrap();
        assert_eq!(result, vec![1, 2, 3]);
    }

    #[test]
    fn lenient_still_rejects_oversized() {
        let huge = "\"".to_string() + &"x".repeat(MAX_INPUT_BYTES + 1) + "\"";
        let err = lenient_from_str(&huge).unwrap_err();
        assert!(err.to_string().contains("too large"), "{err}");
    }

    #[test]
    fn lenient_still_rejects_deep_nesting() {
        let open: String = "{\"a\":".repeat(200);
        let close: String = "1".to_string() + &"}".repeat(200);
        let payload = format!("{open}{close}");
        let err = lenient_from_str(&payload).unwrap_err();
        assert!(err.to_string().contains("nesting too deep"), "{err}");
    }
}
