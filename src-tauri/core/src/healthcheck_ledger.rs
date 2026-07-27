//! Credential healthcheck ledger primitives.
//!
//! The ring-buffer append, the transient/permanent error classification and the
//! HTTP-status extraction that feeds it. Extracted from `engine::rotation` in
//! crate-split step 4d: the repo layer appends an entry every time it persists a
//! credential ledger, and `rotation` itself depends on `connector_strategy`, so
//! the whole module could not travel down.
//!
//! The rotation *policy* — anomaly scoring, backoff, remediation — stays in the
//! engine. Only the ledger mechanics are here.

use ts_rs::TS;

use crate::models::LedgerHealthEntry;
use crate::utils::sanitization::sanitize_secrets;

/// Ring buffer capacity -- last N healthcheck results per credential.
pub const HEALTHCHECK_RING_BUFFER_SIZE: usize = 20;

/// Alias kept for readability at call sites; the row shape itself is a model.
pub type HealthcheckEntry = LedgerHealthEntry;

/// Classify an HTTP status code extracted from a healthcheck/rotation message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub enum ErrorClass {
    /// Transient: rate-limit (429), service unavailable (503), gateway timeout (504), or network timeout.
    Transient,
    /// Permanent: unauthorized (401), forbidden (403), not found (404 for auth endpoints).
    Permanent,
    /// Unknown -- could not classify.
    Unknown,
}

impl ErrorClass {
    pub fn from_status_code(code: u16) -> Self {
        match code {
            429 | 502 | 503 | 504 => Self::Transient,
            401 | 403 => Self::Permanent,
            _ if code >= 500 => Self::Transient,
            _ => Self::Unknown,
        }
    }

    /// Parse an error class from a healthcheck/rotation message string.
    /// Looks for patterns like "HTTP 429", "HTTP 401", "Connection failed", "timeout".
    pub fn from_message(msg: &str) -> Self {
        // Try to extract HTTP status code
        if let Some(code) = extract_http_status(msg) {
            return Self::from_status_code(code);
        }
        let lower = msg.to_lowercase();
        if lower.contains("timeout")
            || lower.contains("timed out")
            || lower.contains("connection refused")
        {
            return Self::Transient;
        }
        if lower.contains("unauthorized")
            || lower.contains("forbidden")
            || lower.contains("revoked")
        {
            return Self::Permanent;
        }
        Self::Unknown
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Transient => "transient",
            Self::Permanent => "permanent",
            Self::Unknown => "unknown",
        }
    }
}

fn extract_http_status(msg: &str) -> Option<u16> {
    // Match "HTTP 4xx" or "HTTP 5xx" patterns
    let patterns = ["HTTP ", "http "];
    for pat in &patterns {
        if let Some(idx) = msg.find(pat) {
            let after = &msg[idx + pat.len()..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(code) = digits.parse::<u16>() {
                if (100..=599).contains(&code) {
                    return Some(code);
                }
            }
        }
    }
    None
}

/// Append a healthcheck result to the credential's ring buffer stored in metadata.
/// Returns the updated entries vector (capped at HEALTHCHECK_RING_BUFFER_SIZE).
pub fn append_healthcheck_entry(
    existing_entries: &[HealthcheckEntry],
    success: bool,
    message: &str,
) -> Vec<HealthcheckEntry> {
    let error_class = if success {
        None
    } else {
        Some(ErrorClass::from_message(message).as_str().to_string())
    };

    let status_code = extract_http_status(message);

    // Defense-in-depth: sanitize the message before storing in the ring buffer,
    // even if callers have already sanitized, to guard against future call sites.
    let safe_message = sanitize_secrets(message);

    let entry = HealthcheckEntry {
        success,
        status_code,
        error_class,
        message: safe_message.chars().take(200).collect(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    let mut entries = existing_entries.to_vec();
    entries.push(entry);

    // Maintain ring buffer size
    if entries.len() > HEALTHCHECK_RING_BUFFER_SIZE {
        entries = entries.split_off(entries.len() - HEALTHCHECK_RING_BUFFER_SIZE);
    }

    entries
}
