//! Unified error taxonomy shared across healing, failover, design drift, and
//! frontend subsystems.
//!
//! This is the **single source of truth** for error classification. All
//! subsystems import from here instead of maintaining independent heuristics.
//! The TypeScript mirror lives at `src/lib/errorTaxonomy.ts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// =============================================================================
// ErrorCategory — the canonical error classification
// =============================================================================

/// Broad error category derived from error strings, flags, and context.
///
/// Covers the union of categories previously defined independently in:
/// - `healing::FailureCategory`
/// - `failover::FailoverReason`
/// - `personaSlice::DegradationCategory`
/// - `designDrift` regex-based classification
/// - `healthCheckSlice::inferSeverity`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    /// Rate limit / 429 / too many requests / quota exceeded.
    RateLimit,
    /// AI provider session or usage limit hit.
    SessionLimit,
    /// Execution timed out or deadline exceeded.
    Timeout,
    /// CLI binary or provider not found (ENOENT, spawn failure).
    ProviderNotFound,
    /// Authentication or credential failure (401, 403, decrypt, API key).
    CredentialError,
    /// Network-level failure (connection refused, fetch error, DNS).
    Network,
    /// Input validation, parse, or malformed data error.
    Validation,
    /// Tool call failure during execution.
    ToolError,
    /// API error (500, 502, 503, server-side).
    ApiError,
    /// No known pattern matched.
    Unknown,
}

// =============================================================================
// ErrorSeverity — unified severity levels
// =============================================================================

/// Severity level for a classified error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ErrorSeverity {
    /// Informational — no action needed.
    Info,
    /// Minor issue, worth noting.
    Low,
    /// Moderate issue that may need attention.
    Medium,
    /// Serious issue requiring prompt attention.
    High,
    /// System-breaking issue requiring immediate action.
    Critical,
}

// =============================================================================
// Classification
// =============================================================================

/// Classify an error message into an [`ErrorCategory`].
///
/// Optional flags (`timed_out`, `session_limit`) take priority over string
/// matching so callers can pass pre-parsed booleans.
pub fn classify_error(error: &str, timed_out: bool, session_limit: bool) -> ErrorCategory {
    if session_limit {
        return ErrorCategory::SessionLimit;
    }
    if timed_out {
        return ErrorCategory::Timeout;
    }

    let lower = error.to_lowercase();

    // Rate limit patterns
    if lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("quota exceeded")
        || lower.contains("usage limit")
        || lower.contains("429")
    {
        return ErrorCategory::RateLimit;
    }

    // Session limit (string-based fallback)
    if lower.contains("session limit") {
        return ErrorCategory::SessionLimit;
    }

    // Timeout patterns
    if lower.contains("timed out") || lower.contains("timeout") || lower.contains("deadline") {
        return ErrorCategory::Timeout;
    }

    // Provider / CLI not found
    if lower.contains("not found")
        || lower.contains("enoent")
        || lower.contains("is not recognized")
    {
        return ErrorCategory::ProviderNotFound;
    }

    // Credential / auth errors
    if lower.contains("decrypt")
        || lower.contains("credential")
        || lower.contains("api key")
        || lower.contains("unauthorized")
        || lower.contains("401")
        || lower.contains("403")
    {
        return ErrorCategory::CredentialError;
    }

    // Network errors
    if lower.contains("network")
        || lower.contains("econnrefused")
        || lower.contains("err_network")
        || lower.contains("connection refused")
        || lower.contains("dns")
        || (lower.contains("fetch") && lower.contains("fail"))
    {
        return ErrorCategory::Network;
    }

    // Tool errors
    if lower.contains("tool_use")
        || (lower.contains("tool") && (lower.contains("fail") || lower.contains("error")))
        || (lower.contains("function") && lower.contains("error"))
    {
        return ErrorCategory::ToolError;
    }

    // API / server errors
    if lower.contains("500")
        || lower.contains("502")
        || lower.contains("503")
        || lower.contains("api error")
        || lower.contains("server error")
        || lower.contains("internal server")
    {
        return ErrorCategory::ApiError;
    }

    // Validation errors
    if lower.contains("validation")
        || lower.contains("invalid")
        || lower.contains("malformed")
        || lower.contains("parse error")
    {
        return ErrorCategory::Validation;
    }

    ErrorCategory::Unknown
}

/// Convenience: classify with no pre-parsed flags (string-only).
pub fn classify_error_str(error: &str) -> ErrorCategory {
    classify_error(error, false, false)
}

// =============================================================================
// Query helpers
// =============================================================================

/// Returns `true` for categories that can be automatically retried by the
/// healing engine.
pub fn is_auto_fixable(category: &ErrorCategory) -> bool {
    matches!(category, ErrorCategory::RateLimit | ErrorCategory::Timeout)
}

/// Returns `true` for categories that should trigger provider failover.
pub fn is_failover_eligible(category: &ErrorCategory) -> bool {
    matches!(
        category,
        ErrorCategory::ProviderNotFound
            | ErrorCategory::RateLimit
            | ErrorCategory::SessionLimit
            | ErrorCategory::Timeout
    )
}

/// Map an [`ErrorCategory`] to its default [`ErrorSeverity`].
pub fn default_severity(category: &ErrorCategory) -> ErrorSeverity {
    match category {
        ErrorCategory::ProviderNotFound => ErrorSeverity::Critical,
        ErrorCategory::CredentialError => ErrorSeverity::High,
        ErrorCategory::SessionLimit => ErrorSeverity::High,
        ErrorCategory::ApiError => ErrorSeverity::High,
        ErrorCategory::RateLimit => ErrorSeverity::Medium,
        ErrorCategory::Timeout => ErrorSeverity::Medium,
        ErrorCategory::ToolError => ErrorSeverity::Medium,
        ErrorCategory::Network => ErrorSeverity::Medium,
        ErrorCategory::Validation => ErrorSeverity::Low,
        ErrorCategory::Unknown => ErrorSeverity::Medium,
    }
}

/// Map an [`ErrorCategory`] to the database category string used by healing
/// issues (preserves backwards compatibility with existing DB records).
pub fn db_category(category: &ErrorCategory) -> &'static str {
    match category {
        ErrorCategory::RateLimit
        | ErrorCategory::SessionLimit
        | ErrorCategory::Network
        | ErrorCategory::ApiError => "external",
        ErrorCategory::Timeout
        | ErrorCategory::ProviderNotFound
        | ErrorCategory::CredentialError => "config",
        ErrorCategory::ToolError => "tool",
        ErrorCategory::Validation => "prompt",
        ErrorCategory::Unknown => "external",
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- classify_error ---

    #[test]
    fn test_classify_rate_limit() {
        assert_eq!(
            classify_error_str("Error: rate limit exceeded"),
            ErrorCategory::RateLimit
        );
        assert_eq!(
            classify_error_str("Too many requests, slow down"),
            ErrorCategory::RateLimit
        );
        assert_eq!(
            classify_error_str("HTTP 429 returned from API"),
            ErrorCategory::RateLimit
        );
        assert_eq!(
            classify_error_str("Usage Limit: quota exceeded"),
            ErrorCategory::RateLimit
        );
    }

    #[test]
    fn test_classify_session_limit() {
        assert_eq!(
            classify_error("some error", false, true),
            ErrorCategory::SessionLimit
        );
        assert_eq!(
            classify_error_str("Session limit reached"),
            ErrorCategory::SessionLimit
        );
    }

    #[test]
    fn test_classify_timeout() {
        assert_eq!(
            classify_error("irrelevant", true, false),
            ErrorCategory::Timeout
        );
        assert_eq!(
            classify_error_str("Execution timed out after 600s"),
            ErrorCategory::Timeout
        );
        assert_eq!(
            classify_error_str("deadline exceeded"),
            ErrorCategory::Timeout
        );
    }

    #[test]
    fn test_classify_provider_not_found() {
        assert_eq!(
            classify_error_str("Claude CLI not found"),
            ErrorCategory::ProviderNotFound,
        );
        assert_eq!(
            classify_error_str("Claude Code not found. Please install it"),
            ErrorCategory::ProviderNotFound
        );
        assert_eq!(
            classify_error_str("Failed to spawn CLI: not found"),
            ErrorCategory::ProviderNotFound
        );
        assert_eq!(
            classify_error_str("ENOENT: no such file"),
            ErrorCategory::ProviderNotFound
        );
        assert_eq!(
            classify_error_str("'claude' is not recognized as an internal command"),
            ErrorCategory::ProviderNotFound,
        );
    }

    #[test]
    fn test_classify_credential_error() {
        assert_eq!(
            classify_error_str("HTTP 401 Unauthorized"),
            ErrorCategory::CredentialError
        );
        assert_eq!(
            classify_error_str("Failed to decrypt credential"),
            ErrorCategory::CredentialError
        );
        assert_eq!(
            classify_error_str("Invalid API key provided"),
            ErrorCategory::CredentialError
        );
    }

    #[test]
    fn test_classify_network() {
        assert_eq!(
            classify_error_str("ERR_NETWORK: fetch failed"),
            ErrorCategory::Network
        );
        assert_eq!(
            classify_error_str("ECONNREFUSED 127.0.0.1:3000"),
            ErrorCategory::Network
        );
    }

    #[test]
    fn test_classify_tool_error() {
        assert_eq!(
            classify_error_str("tool_use: execution failed"),
            ErrorCategory::ToolError
        );
        assert_eq!(
            classify_error_str("Tool call failed with error"),
            ErrorCategory::ToolError
        );
    }

    #[test]
    fn test_classify_api_error() {
        assert_eq!(
            classify_error_str("HTTP 500 internal server error"),
            ErrorCategory::ApiError
        );
        assert_eq!(
            classify_error_str("502 Bad Gateway"),
            ErrorCategory::ApiError
        );
    }

    #[test]
    fn test_classify_validation() {
        assert_eq!(
            classify_error_str("validation failed: missing field"),
            ErrorCategory::Validation
        );
        assert_eq!(
            classify_error_str("malformed JSON in request body"),
            ErrorCategory::Validation
        );
    }

    #[test]
    fn test_classify_unknown() {
        assert_eq!(
            classify_error_str("some random error"),
            ErrorCategory::Unknown
        );
    }

    // --- helpers ---

    #[test]
    fn test_is_auto_fixable() {
        assert!(is_auto_fixable(&ErrorCategory::RateLimit));
        assert!(is_auto_fixable(&ErrorCategory::Timeout));
        assert!(!is_auto_fixable(&ErrorCategory::SessionLimit));
        assert!(!is_auto_fixable(&ErrorCategory::ProviderNotFound));
        assert!(!is_auto_fixable(&ErrorCategory::CredentialError));
        assert!(!is_auto_fixable(&ErrorCategory::Unknown));
    }

    #[test]
    fn test_is_failover_eligible() {
        assert!(is_failover_eligible(&ErrorCategory::ProviderNotFound));
        assert!(is_failover_eligible(&ErrorCategory::RateLimit));
        assert!(is_failover_eligible(&ErrorCategory::SessionLimit));
        assert!(is_failover_eligible(&ErrorCategory::Timeout));
        assert!(!is_failover_eligible(&ErrorCategory::CredentialError));
        assert!(!is_failover_eligible(&ErrorCategory::Unknown));
    }

    #[test]
    fn test_default_severity() {
        assert_eq!(
            default_severity(&ErrorCategory::ProviderNotFound),
            ErrorSeverity::Critical
        );
        assert_eq!(
            default_severity(&ErrorCategory::RateLimit),
            ErrorSeverity::Medium
        );
        assert_eq!(
            default_severity(&ErrorCategory::Unknown),
            ErrorSeverity::Medium
        );
    }

    #[test]
    fn test_serde_roundtrip() {
        let cat = ErrorCategory::RateLimit;
        let json = serde_json::to_string(&cat).unwrap();
        assert_eq!(json, "\"rate_limit\"");
        let parsed: ErrorCategory = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, cat);
    }
}
