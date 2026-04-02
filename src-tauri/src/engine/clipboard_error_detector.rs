//! Clipboard Error Detector: heuristic detection of error patterns in clipboard text.
//!
//! Detects stack traces, error messages, exceptions, and panics from common
//! languages (Python, JavaScript/Node, Rust, Go, Java, C#) using simple pattern
//! matching. No ML dependencies — purely heuristic-based.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Result of analysing clipboard text for error patterns.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetection {
    /// Category: "stack_trace", "error_message", "exception", "panic".
    pub error_type: String,
    /// First meaningful error line — used as the search query for KB lookup.
    pub summary: String,
    /// Confidence score 0.0 - 1.0 based on number and strength of matching patterns.
    pub confidence: f32,
}

/// High-confidence single-line keywords (each match adds 0.4 confidence).
const HIGH_CONFIDENCE_PATTERNS: &[(&str, &str)] = &[
    ("Traceback (most recent call last)", "stack_trace"),
    ("panic:", "panic"),
    ("PANIC:", "panic"),
    ("goroutine ", "stack_trace"),
    ("Unhandled exception", "exception"),
    ("Unhandled rejection", "exception"),
    ("Exception in thread", "exception"),
    ("fatal error:", "panic"),
    ("FATAL ERROR:", "panic"),
    ("segmentation fault", "panic"),
    ("stack overflow", "panic"),
    ("thread 'main' panicked at", "panic"),
    ("thread panicked at", "panic"),
];

/// Medium-confidence patterns (each match adds 0.2 confidence).
const MEDIUM_PATTERNS: &[(&str, &str)] = &[
    // Specific exception types must come before generic "Error:" / "Exception:"
    ("TypeError:", "exception"),
    ("ReferenceError:", "exception"),
    ("SyntaxError:", "exception"),
    ("ValueError:", "exception"),
    ("KeyError:", "exception"),
    ("AttributeError:", "exception"),
    ("IndexError:", "exception"),
    ("NullPointerException", "exception"),
    ("ClassNotFoundException", "exception"),
    ("IOException", "exception"),
    ("RuntimeException", "exception"),
    ("NullReferenceException", "exception"),
    ("ArgumentException", "exception"),
    ("System.Exception", "exception"),
    ("Exception:", "exception"),
    ("EXCEPTION:", "exception"),
    // Generic error patterns after specific ones
    ("Error:", "error_message"),
    ("ERROR:", "error_message"),
    ("FAILED", "error_message"),
    ("error[E", "error_message"),     // Rust compiler errors
    ("caused by:", "error_message"),
    ("Caused by:", "error_message"),
];

/// Stack-trace line indicators (each matching line adds 0.15 confidence).
const STACK_LINE_PREFIXES: &[&str] = &[
    "    at ",       // JS/Java/C# stack frames
    "\tat ",         // Java tab-indented frames
    "  at ",         // JS stack frames
    "  File \"",     // Python stack frames
    "    File \"",   // Python stack frames (deeper)
    "      ",        // Generic deep indentation (often stack continuation)
];

/// Stack-trace line patterns checked via contains (each adds 0.1 confidence).
const STACK_LINE_CONTAINS: &[&str] = &[
    ", line ",          // Python "File ..., line N"
    ".rs:",             // Rust source locations
    ".go:",             // Go source locations
    ".java:",           // Java source locations
    ".py:",             // Python source locations
    ".js:",             // JS source locations
    ".ts:",             // TS source locations
    ".cs:",             // C# source locations
    ".cpp:",            // C++ source locations
];

/// Detect whether clipboard text looks like an error, stack trace, or exception.
///
/// Returns `None` if confidence is below the threshold (0.3).
pub fn detect_error_pattern(text: &str) -> Option<ErrorDetection> {
    // Quick reject: too short or too long to be useful
    if text.len() < 10 || text.len() > 50_000 {
        return None;
    }

    let mut confidence: f32 = 0.0;
    let mut error_type = String::new();
    let mut summary_line: Option<&str> = None;

    let lines: Vec<&str> = text.lines().collect();

    // Check high-confidence single-line patterns
    for line in &lines {
        let lower = line.to_lowercase();
        for &(pattern, etype) in HIGH_CONFIDENCE_PATTERNS {
            if lower.contains(&pattern.to_lowercase()) {
                confidence += 0.4;
                if error_type.is_empty() {
                    error_type = etype.to_string();
                }
                if summary_line.is_none() {
                    summary_line = Some(line);
                }
                break; // Only count first match per line
            }
        }
    }

    // Check medium-confidence patterns
    for line in &lines {
        for &(pattern, etype) in MEDIUM_PATTERNS {
            if line.contains(pattern) {
                confidence += 0.2;
                if error_type.is_empty() {
                    error_type = etype.to_string();
                }
                if summary_line.is_none() {
                    summary_line = Some(line);
                }
                break;
            }
        }
    }

    // Count stack trace lines
    let mut stack_line_count = 0u32;
    for line in &lines {
        let is_stack = STACK_LINE_PREFIXES.iter().any(|p| line.starts_with(p))
            || STACK_LINE_CONTAINS.iter().any(|p| line.contains(p));
        if is_stack {
            stack_line_count += 1;
            confidence += 0.15; // diminishing returns handled by cap
        }
    }

    // If we found multiple stack-trace lines but no error type yet, classify as stack_trace
    if stack_line_count >= 3 && error_type.is_empty() {
        error_type = "stack_trace".to_string();
        // Pick the first non-stack line as the summary (likely the error message)
        for line in &lines {
            let is_stack = STACK_LINE_PREFIXES.iter().any(|p| line.starts_with(p));
            if !is_stack && !line.trim().is_empty() {
                summary_line = Some(line);
                break;
            }
        }
    }

    // Cap confidence at 1.0
    confidence = confidence.min(1.0);

    // Minimum threshold
    if confidence < 0.3 {
        return None;
    }

    // Extract the summary: first meaningful error line, truncated to 200 chars
    let summary = summary_line
        .unwrap_or_else(|| lines.first().copied().unwrap_or(""))
        .trim()
        .chars()
        .take(200)
        .collect::<String>();

    if summary.is_empty() {
        return None;
    }

    if error_type.is_empty() {
        error_type = "error_message".to_string();
    }

    Some(ErrorDetection {
        error_type,
        summary,
        confidence,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_python_traceback() {
        let text = r#"Traceback (most recent call last):
  File "main.py", line 42, in <module>
    result = process(data)
  File "utils.py", line 17, in process
    return data["key"]
KeyError: 'key'"#;

        let det = detect_error_pattern(text).expect("should detect Python traceback");
        assert_eq!(det.error_type, "stack_trace");
        assert!(det.confidence >= 0.6);
        assert!(det.summary.contains("Traceback"));
    }

    #[test]
    fn test_js_stack_trace() {
        let text = r#"TypeError: Cannot read properties of undefined (reading 'map')
    at Array.map (<anonymous>)
    at processItems (/app/src/utils.js:42:15)
    at main (/app/src/index.js:10:3)"#;

        let det = detect_error_pattern(text).expect("should detect JS error");
        assert_eq!(det.error_type, "exception");
        assert!(det.confidence >= 0.6);
        assert!(det.summary.contains("TypeError"));
    }

    #[test]
    fn test_rust_panic() {
        let text = r#"thread 'main' panicked at 'index out of bounds: the len is 3 but the index is 5', src/main.rs:42:10
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace"#;

        let det = detect_error_pattern(text).expect("should detect Rust panic");
        assert_eq!(det.error_type, "panic");
        assert!(det.confidence >= 0.4);
        assert!(det.summary.contains("panicked"));
    }

    #[test]
    fn test_go_goroutine_dump() {
        let text = r#"goroutine 1 [running]:
main.main()
	/home/user/app/main.go:42 +0x1a8
goroutine 6 [chan receive]:
runtime.gopark(0xc0000b8060, 0x0, 0x0)"#;

        let det = detect_error_pattern(text).expect("should detect Go goroutine dump");
        assert_eq!(det.error_type, "stack_trace");
        assert!(det.confidence >= 0.4);
    }

    #[test]
    fn test_rust_compiler_error() {
        let text = r#"error[E0308]: mismatched types
 --> src/main.rs:4:18
  |
4 |     let x: i32 = "hello";
  |            ---   ^^^^^^^ expected `i32`, found `&str`
  |            |
  |            expected due to this"#;

        let det = detect_error_pattern(text).expect("should detect Rust compiler error");
        assert_eq!(det.error_type, "error_message");
        assert!(det.confidence >= 0.3);
    }

    #[test]
    fn test_normal_text_no_match() {
        let text = "Hello, this is a normal clipboard text with nothing special.";
        assert!(detect_error_pattern(text).is_none());
    }

    #[test]
    fn test_too_short() {
        assert!(detect_error_pattern("Error").is_none());
    }

    #[test]
    fn test_java_exception() {
        let text = r#"Exception in thread "main" java.lang.NullPointerException
	at com.example.App.process(App.java:42)
	at com.example.App.main(App.java:10)"#;

        let det = detect_error_pattern(text).expect("should detect Java exception");
        assert!(det.confidence >= 0.6);
    }
}
