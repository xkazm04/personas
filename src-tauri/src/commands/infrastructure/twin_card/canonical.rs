//! RFC 8785 JSON Canonicalization Scheme, and the SHA-256 a part is hashed
//! with (SPEC.md 9).
//!
//! Canonical form: object members sorted by their names' UTF-16 code units,
//! no whitespace, strings escaped exactly as ECMAScript's `JSON.stringify`
//! escapes them, numbers as ECMAScript prints a double. A part never holds a
//! non-integer (SPEC.md 9), so its numbers print as plain integers; the
//! double formatting exists because a signature covers the WHOLE card, and
//! `extensions` may hold any JSON a producer likes.

use serde_json::{Number, Value};
use sha2::{Digest, Sha256};

/// The largest integer a double holds exactly (2^53). Beyond it ECMAScript
/// prints the nearest double, so RFC 8785 does too.
const EXACT_INTEGER_MAX: u64 = 1 << 53;

/// `value` in canonical form.
pub(super) fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

/// Lowercase hex SHA-256 of `bytes`.
pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A part's integrity hash: SHA-256 over its canonical UTF-8 bytes.
pub(super) fn part_hash(value: &Value) -> String {
    sha256_hex(canonical_json(value).as_bytes())
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&number(n)),
        Value::String(s) => write_string(out, s),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut members: Vec<(&String, &Value)> = map.iter().collect();
            members.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (i, (key, item)) in members.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write_value(out, item);
            }
            out.push('}');
        }
    }
}

/// ECMAScript `JSON.stringify` string escaping: the two mandatory escapes,
/// the five short control escapes, `\u00xx` (lowercase) for every other
/// control character, everything else literal.
fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn number(n: &Number) -> String {
    if let Some(u) = n.as_u64() {
        if u <= EXACT_INTEGER_MAX {
            return u.to_string();
        }
    }
    if let Some(i) = n.as_i64() {
        if i.unsigned_abs() <= EXACT_INTEGER_MAX {
            return i.to_string();
        }
    }
    // serde_json only holds finite numbers, so `as_f64` always answers.
    es_number(n.as_f64().unwrap_or(0.0))
}

/// ECMAScript `Number::toString` for a finite double: the shortest digits
/// that round-trip (Rust's `{:e}` produces exactly those), laid out by the
/// ES rules for where the decimal point and the exponent go.
fn es_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string(); // also -0
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let exp_form = format!("{:e}", value.abs());
    let Some((mantissa, exponent)) = exp_form.split_once('e') else {
        return format!("{sign}{exp_form}");
    };
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    // `n` is where the decimal point sits relative to the digits.
    let n = exponent + 1;
    let k = digits.len() as i32;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (int, frac) = digits.split_at(n as usize);
        format!("{int}.{frac}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let e_sign = if e < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        if rest.is_empty() {
            format!("{first}e{e_sign}{}", e.unsigned_abs())
        } else {
            format!("{first}.{rest}e{e_sign}{}", e.unsigned_abs())
        }
    };
    format!("{sign}{body}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MINIMAL: &str =
        include_str!("../../../../../docs/standards/twin-card/1.0/examples/minimal.twin.json");
    const FULL: &str =
        include_str!("../../../../../docs/standards/twin-card/1.0/examples/full.twin.json");

    /// The conformance anchor: the part hashes the Director's reference
    /// implementation wrote into the published examples.
    #[test]
    fn the_canonicalizer_reproduces_the_published_example_hashes() {
        for (name, text) in [("minimal", MINIMAL), ("full", FULL)] {
            let card: Value = serde_json::from_str(text).expect("example parses");
            let parts = card["integrity"]["parts"].as_object().expect("parts");
            assert!(!parts.is_empty(), "{name}: no part hashes to check");
            for (key, expected) in parts {
                assert_eq!(
                    part_hash(&card[key.as_str()]),
                    expected.as_str().expect("hex"),
                    "{name}.{key}"
                );
            }
        }
    }

    #[test]
    fn members_sort_by_utf16_code_units_not_by_utf8_bytes() {
        // U+FF61 sorts before U+1F600 in UTF-8 byte order and after it in
        // UTF-16 (the emoji's high surrogate 0xD83D < 0xFF61).
        let value = json!({ "\u{ff61}": 1, "\u{1f600}": 2, "b": 3, "a": 4, "": 5 });
        assert_eq!(
            canonical_json(&value),
            "{\"\":5,\"a\":4,\"b\":3,\"\u{1f600}\":2,\"\u{ff61}\":1}"
        );
    }

    #[test]
    fn strings_escape_exactly_as_ecmascript() {
        let value = json!("q\"b\\s\u{8}f\u{c}n\nr\rt\tc\u{1}\u{1f}del\u{7f}é\u{2028}");
        assert_eq!(
            canonical_json(&value),
            "\"q\\\"b\\\\s\\bf\\fn\\nr\\rt\\tc\\u0001\\u001fdel\u{7f}é\u{2028}\""
        );
    }

    #[test]
    fn no_whitespace_and_nested_order() {
        let value = json!({ "z": [1, { "y": null, "x": true }], "a": "v" });
        assert_eq!(
            canonical_json(&value),
            r#"{"a":"v","z":[1,{"x":true,"y":null}]}"#
        );
    }

    /// RFC 8785 appendix B and the ECMAScript layout boundaries. Inputs are
    /// short enough for serde_json's default float parser to round them
    /// correctly; the long RFC vector is built from a Rust literal below,
    /// because that parser (without its `float_roundtrip` feature) can land
    /// one ULP off on 17+ significant digits.
    #[test]
    fn numbers_print_as_ecmascript_doubles() {
        assert_eq!(
            canonical_json(&json!(333_333_333.333_333_29_f64)),
            "333333333.3333333"
        );
        let cases: [(&str, &str); 13] = [
            ("0", "0"),
            ("-0.0", "0"),
            ("1E30", "1e+30"),
            ("4.50", "4.5"),
            ("2e-3", "0.002"),
            ("0.000000000000000000000000001", "1e-27"),
            ("1e21", "1e+21"),
            ("1e20", "100000000000000000000"),
            ("0.000001", "0.000001"),
            ("1e-7", "1e-7"),
            ("-1.5", "-1.5"),
            ("9007199254740993", "9007199254740992"),
            ("5e-324", "5e-324"),
        ];
        for (input, expected) in cases {
            let value: Value = serde_json::from_str(input).expect("number parses");
            assert_eq!(canonical_json(&value), expected, "input {input}");
        }
        assert_eq!(canonical_json(&json!(1000)), "1000");
        assert_eq!(canonical_json(&json!(-42)), "-42");
        assert_eq!(canonical_json(&json!(3.0)), "3");
    }
}
