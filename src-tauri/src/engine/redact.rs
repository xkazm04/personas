//! Secret redaction for the trace-persistence boundary.
//!
//! Personas spawns the Claude Code CLI with `--dangerously-skip-permissions` and
//! persists its raw output (`output_data`, `error_message`, `business_outcome`) to
//! SQLite — which then feeds the execution inspector, exports, Sentry, and companion
//! memory. A secret echoed into agent output therefore leaks at rest. This module is a
//! conservative redaction pass applied **at persistence**, not at stream emission: the
//! live terminal still shows the user their own output; only the stored/forwarded copy
//! is scrubbed.
//!
//! Design (ported from fabro's `fabro-redact`, conservatively):
//!   1. A small set of **high-confidence** credential patterns (AWS, Anthropic, OpenAI,
//!      GitHub, Slack, Google, JWTs, PEM private keys, `Bearer` tokens).
//!   2. A **Shannon-entropy** sweep over long alphanumeric tokens, tuned to AVOID
//!      false-positives on UUIDs / git SHAs / hex digests (threshold 4.5 bits/byte,
//!      min length 20, must mix character classes, never pure-hex).
//!
//! Better to miss an exotic secret than to corrupt legitimate IDs/output — this is a
//! default-on transform, so the bias is toward precision.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

use regex::Regex;

/// Marker spliced in place of a detected secret.
const MARKER: &str = "[REDACTED]";

/// Process-level kill switch (default on). Toggled from the
/// `REDACT_TRACES_ENABLED` setting at startup / when the user changes it.
static ENABLED: AtomicBool = AtomicBool::new(true);

/// Settings key persisting the user's redaction preference.
pub const REDACT_TRACES_ENABLED_KEY: &str = "redact_traces_enabled";

/// Whether trace redaction is currently active.
#[must_use]
pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Set the redaction kill switch (called from the settings load path).
pub fn set_enabled(value: bool) {
    ENABLED.store(value, Ordering::Relaxed);
}

/// High-confidence credential patterns. Each match is replaced wholesale with
/// the marker (the `Bearer ` prefix is preserved for readability).
static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        // AWS access key id
        r"AKIA[0-9A-Z]{16}",
        // Anthropic keys (covers sk-ant-… and sk-ant-oat… OAuth tokens)
        r"sk-ant-[A-Za-z0-9_\-]{20,}",
        // OpenAI / generic sk- keys
        r"sk-[A-Za-z0-9]{20,}",
        // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
        r"gh[pousr]_[A-Za-z0-9]{20,}",
        // Slack tokens
        r"xox[baprs]-[A-Za-z0-9\-]{10,}",
        // Google API key
        r"AIza[0-9A-Za-z_\-]{35}",
        // JSON Web Token (header.payload.signature)
        r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+",
        // PEM private key block
        r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("valid redaction pattern"))
    .collect()
});

/// `Bearer <token>` — handled separately so the `Bearer ` prefix survives.
static BEARER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._\-]{20,}").expect("valid bearer pattern"));

/// Candidate high-entropy token shape for the entropy sweep.
static TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9+/_=\-]{20,}").expect("valid token pattern"));

/// Redact an owned `Option<String>` in place (no-op when disabled or `None`).
pub fn redact_opt(field: &mut Option<String>) {
    if !enabled() {
        return;
    }
    if let Some(s) = field {
        let redacted = redact_string(s);
        if redacted != *s {
            *s = redacted;
        }
    }
}

/// Return a redacted copy of `input`. Plain-text and JSON-as-text are both safe:
/// only the matched secret substring is replaced, so surrounding JSON stays valid.
#[must_use]
pub fn redact_string(input: &str) -> String {
    if input.is_empty() {
        return input.to_string();
    }

    // 1. High-confidence patterns.
    let mut out = input.to_string();
    for re in PATTERNS.iter() {
        if re.is_match(&out) {
            out = re.replace_all(&out, MARKER).into_owned();
        }
    }
    if BEARER.is_match(&out) {
        out = BEARER.replace_all(&out, format!("Bearer {MARKER}")).into_owned();
    }

    // 2. Entropy sweep over remaining long tokens.
    if TOKEN.is_match(&out) {
        out = TOKEN
            .replace_all(&out, |caps: &regex::Captures| {
                let tok = &caps[0];
                if looks_like_secret(tok) {
                    MARKER.to_string()
                } else {
                    tok.to_string()
                }
            })
            .into_owned();
    }

    out
}

/// Entropy + character-class heuristic tuned to skip UUIDs, git SHAs, and hex
/// digests (which are legitimate identifiers) while catching random key material.
fn looks_like_secret(tok: &str) -> bool {
    if tok.len() < 20 {
        return false;
    }
    // Pure hex / hex-with-dashes (UUIDs, SHAs, digests) are identifiers, not secrets.
    if tok
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return false;
    }
    // Real key material mixes classes; an all-lowercase or all-uppercase slug is
    // usually a path segment / identifier, not a credential.
    let has_lower = tok.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = tok.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = tok.chars().any(|c| c.is_ascii_digit());
    if !(has_lower && has_upper && has_digit) {
        return false;
    }
    shannon_entropy(tok) >= 4.5
}

/// Shannon entropy in bits per byte.
fn shannon_entropy(s: &str) -> f64 {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return 0.0;
    }
    let mut counts = [0u32; 256];
    for &b in bytes {
        counts[b as usize] += 1;
    }
    let len = bytes.len() as f64;
    let mut entropy = 0.0;
    for &c in counts.iter() {
        if c > 0 {
            let p = f64::from(c) / len;
            entropy -= p * p.log2();
        }
    }
    entropy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_anthropic_and_aws_keys() {
        let s = "key=sk-ant-api03-AbCdEf012345678901234567890XyZ and AKIAIOSFODNN7EXAMPLE end"; // gitleaks:allow
        let r = redact_string(s);
        assert!(!r.contains("sk-ant-api03"), "anthropic key not redacted: {r}");
        assert!(!r.contains("AKIAIOSFODNN7EXAMPLE"), "aws key not redacted: {r}");
        assert!(r.contains(MARKER));
        assert!(r.contains("key=") && r.contains("end"), "surrounding text dropped: {r}");
    }

    #[test]
    fn redacts_bearer_and_jwt_preserving_prefix() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36"; // gitleaks:allow
        let s = format!("Authorization: Bearer {jwt}");
        let r = redact_string(&s);
        assert!(r.contains("Bearer [REDACTED]"), "bearer prefix lost: {r}");
        assert!(!r.contains("SflKxwRJSMeKKF2QT4fwpMeJf36"));
    }

    #[test]
    fn preserves_uuids_and_shas() {
        // UUID + 40-char git SHA must survive (they are identifiers, not secrets).
        let s = "run 550e8400-e29b-41d4-a716-446655440000 at da39a3ee5e6b4b0d3255bfef95601890afd80709";
        let r = redact_string(s);
        assert_eq!(r, s, "identifier was wrongly redacted: {r}");
    }

    #[test]
    fn preserves_normal_prose() {
        let s = "The agent completed the refactor and updated three files successfully.";
        assert_eq!(redact_string(s), s);
    }

    #[test]
    fn high_entropy_mixed_token_is_redacted() {
        // 40-char base64-ish mixed-class random token.
        let s = "token Xy7Kp2Qr9Wm4Zb8Nv3Lc6Hs1Td5Fg0Aj4Ue2Ri end"; // gitleaks:allow
        let r = redact_string(s);
        assert!(r.contains(MARKER), "high-entropy token not caught: {r}");
    }

    #[test]
    fn redact_opt_respects_kill_switch() {
        set_enabled(false);
        let mut f = Some("sk-ant-api03-AbCdEf012345678901234567890XyZ".to_string()); // gitleaks:allow
        redact_opt(&mut f);
        assert!(f.as_deref().unwrap().contains("sk-ant-api03"), "redacted while disabled");
        set_enabled(true);
        redact_opt(&mut f);
        assert!(!f.as_deref().unwrap().contains("sk-ant-api03"), "not redacted while enabled");
    }
}
