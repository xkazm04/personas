//! The `{"op": ...}` envelope Athena emits, and the bounded repair applied
//! to op-shaped lines that fail to parse.
//!
//! Moved verbatim out of the former single-file `dispatcher.rs`.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(super) struct OpEnvelope {
    pub(super) op: String,
    #[serde(default)]
    pub(super) action: String,
    #[serde(default)]
    pub(super) params: serde_json::Value,
    #[serde(default)]
    pub(super) rationale: String,
}

/// Bounded repair for op-shaped lines that fail JSON parsing: append the
/// missing closing braces when (a) the line doesn't end inside a string
/// literal and (b) the brace deficit is 1..=3. Returns `None` for anything
/// else — a truncated string value, balanced-but-invalid JSON, or a large
/// deficit are not safely completable and keep their original parse error.
pub(super) fn repair_op_json(raw: &str) -> Option<String> {
    let mut depth: i32 = 0;
    let mut in_str = false;
    let mut esc = false;
    for c in raw.chars() {
        if esc {
            esc = false;
            continue;
        }
        match c {
            '\\' if in_str => esc = true,
            '"' => in_str = !in_str,
            '{' if !in_str => depth += 1,
            '}' if !in_str => depth -= 1,
            _ => {}
        }
    }
    if in_str || !(1..=3).contains(&depth) {
        return None;
    }
    let mut fixed = raw.to_string();
    for _ in 0..depth {
        fixed.push('}');
    }
    Some(fixed)
}
