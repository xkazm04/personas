//! Safe JSON deserialization with size and nesting-depth limits.
//!
//! Prevents denial-of-service attacks where a deeply nested or extremely large
//! JSON payload causes exponential memory allocation during `serde_json` parsing.
//!
//! Also provides `parse_lenient_json` / `extract_balanced_object` for
//! LLM-generated JSON wrapped in prose or code fences.
//!
//! Usage:
//! ```ignore
//! use crate::safe_json;
//!
//! // Strict (existing behavior):
//! let val: serde_json::Value = safe_json::from_str(input)?;
//! let typed: MyStruct = safe_json::from_str_as(input)?;
//! ```

use personas_core::error::AppError;

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
// Balanced-brace extraction — shared across engine LLM-JSON parsers
// ============================================================================

/// Extract the outermost brace-balanced `{...}` JSON object from text that
/// may carry surrounding prose or markdown fences (e.g. raw LLM output).
/// String- and escape-aware: a `}` inside a string value does not close the
/// object early, unlike a naive `find('{')`/`rfind('}')` slice. Returns a
/// borrowed slice of `s` on success.
///
/// This is the canonical brace-matcher for engine modules that need to pull
/// one JSON object out of noisy LLM prose — consolidated from several
/// independent copies (memory_reflection, auto_triage, output_assertions;
/// see refactor-bughunt-2026-07-10, tauri-engine-3-10 #8).
pub fn extract_balanced_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Parse LLM output that may wrap valid JSON in prose: try a strict parse of
/// the trimmed input first, then fall back to extracting the first balanced
/// `{...}` object via [`extract_balanced_object`]. Shared by call sites that
/// tolerate "Claude wraps JSON in prose" chatter despite being told to
/// respond with ONLY JSON (see refactor-bughunt-2026-07-10, tauri-engine-4-10 #7).
pub fn parse_lenient_json<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, AppError> {
    let trimmed = raw.trim();
    if let Ok(parsed) = serde_json::from_str::<T>(trimmed) {
        return Ok(parsed);
    }
    if let Some(obj) = extract_balanced_object(trimmed) {
        if let Ok(parsed) = serde_json::from_str::<T>(obj) {
            return Ok(parsed);
        }
    }
    let head = personas_core::utils::text::truncate_on_char_boundary(trimmed, 300);
    Err(AppError::Internal(format!(
        "Unparseable LLM JSON response. Head (\u{2264}300 chars): {head}"
    )))
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
}
