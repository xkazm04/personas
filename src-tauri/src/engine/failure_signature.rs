//! Failure-signature circuit breaker (fabro F7 lesson).
//!
//! Fabro hashes each failure into a normalized `FailureSignature(node, category,
//! message)` and aborts a fix-loop when the same signature recurs — so a loop
//! can't burn budget re-hitting an identical deterministic failure. The research
//! flagged the *normalization* as independently worth stealing for personas'
//! chains/healing today (a retry that keeps hitting the same error should stop).
//!
//! `normalize` collapses the volatile parts of a message (line numbers, hex
//! digests, UUIDs, addresses, timestamps) so two instances of the *same* failure
//! produce the *same* signature even when their text differs in incidental detail.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        .expect("valid uuid regex")
});
static HEX_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b0x[0-9a-fA-F]+\b|\b[0-9a-fA-F]{8,}\b").expect("valid hex regex"));
static NUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").expect("valid num regex"));
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("valid ws regex"));

/// Normalize a failure reason so the same underlying failure groups stably.
/// Order matters: UUIDs and hex digests first (they contain digits), then bare
/// numbers, then whitespace; finally lowercase + length-cap.
#[must_use]
pub fn normalize(reason: &str) -> String {
    let s = UUID_RE.replace_all(reason, "<UUID>");
    let s = HEX_RE.replace_all(&s, "<HEX>");
    let s = NUM_RE.replace_all(&s, "<N>");
    let s = WS_RE.replace_all(&s, " ");
    let s = s.trim().to_ascii_lowercase();
    s.chars().take(300).collect()
}

/// Tracks how often each normalized failure signature has been seen and trips
/// once a signature reaches `limit` occurrences.
#[derive(Debug)]
pub struct FailureBreaker {
    counts: HashMap<String, u32>,
    limit: u32,
}

impl FailureBreaker {
    /// `limit` = occurrences of the *same* signature that trip the breaker.
    #[must_use]
    pub fn new(limit: u32) -> Self {
        Self { counts: HashMap::new(), limit: limit.max(1) }
    }

    fn signature(persona_id: &str, category: &str, reason: &str) -> String {
        format!("{persona_id}|{category}|{}", normalize(reason))
    }

    /// Record an occurrence; returns the new count for this signature.
    pub fn record(&mut self, persona_id: &str, category: &str, reason: &str) -> u32 {
        let sig = Self::signature(persona_id, category, reason);
        let entry = self.counts.entry(sig).or_insert(0);
        *entry += 1;
        *entry
    }

    /// Has this signature recurred at or beyond the limit?
    #[must_use]
    pub fn tripped(&self, persona_id: &str, category: &str, reason: &str) -> bool {
        let sig = Self::signature(persona_id, category, reason);
        self.counts.get(&sig).copied().unwrap_or(0) >= self.limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_collapses_volatile_parts() {
        let a = normalize("Error at line 42 in file deadbeefcafe1234: timeout after 3000ms");
        let b = normalize("Error at line 7 in file 00112233aabbccdd: timeout after 500ms");
        assert_eq!(a, b, "same failure should normalize identically:\n  a={a}\n  b={b}");
    }

    #[test]
    fn normalize_collapses_uuids() {
        let a = normalize("run 550e8400-e29b-41d4-a716-446655440000 failed");
        let b = normalize("run 123e4567-e89b-12d3-a456-426614174000 failed");
        assert_eq!(a, b);
        assert!(a.contains("<uuid>"));
    }

    #[test]
    fn different_failures_differ() {
        assert_ne!(
            normalize("compilation failed: missing semicolon"),
            normalize("test failed: assertion error"),
        );
    }

    #[test]
    fn breaker_trips_after_limit() {
        let mut b = FailureBreaker::new(3);
        let (p, c) = ("persona1", "deterministic");
        assert_eq!(b.record(p, c, "line 1 failed"), 1);
        assert!(!b.tripped(p, c, "line 99 failed")); // same signature, count 1
        assert_eq!(b.record(p, c, "line 5 failed"), 2);
        assert_eq!(b.record(p, c, "line 9 failed"), 3);
        assert!(b.tripped(p, c, "line 2 failed"), "should trip at limit");
    }

    #[test]
    fn breaker_isolates_distinct_signatures() {
        let mut b = FailureBreaker::new(2);
        b.record("p1", "x", "alpha failure");
        b.record("p1", "x", "alpha failure");
        assert!(b.tripped("p1", "x", "alpha failure"));
        assert!(!b.tripped("p1", "x", "beta failure"));
        assert!(!b.tripped("p2", "x", "alpha failure"));
    }
}
