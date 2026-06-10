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
    /// Transient CLI process failure — non-zero exit with no meaningful stderr.
    ///
    /// Emitted by the runner when the spawned CLI process exits with a non-zero
    /// code but produces no diagnostic output. Common after OOM kills, signal
    /// interrupts, brief network hiccups inside the provider's own retry loop,
    /// and other process-level transients. Distinct from `ApiError` (5xx from
    /// the provider) and `Network` (connection refused / DNS) — those produce
    /// stderr content that classifies them precisely. One-shot retry via the
    /// healing rule-based path typically resolves these; the persona-level
    /// `consecutive_failures < 3` guard prevents an infinite transient loop.
    TransientProcessFailure,
    /// No known pattern matched.
    Unknown,
}

// =============================================================================
// UsageLimitInfo — parsed provider usage-limit details
// =============================================================================

/// Which usage-limit bucket a provider error refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageLimitScope {
    /// Rolling window limit (Claude Code's ~5-hour session window). Resets on
    /// its own — eligible for a scheduled retry at the reset time.
    Window,
    /// Weekly (or longer) cap. Too far out to auto-retry — the run stays
    /// failed and a healing issue is created.
    Weekly,
}

/// Details parsed from a provider usage-limit error message (see
/// `parser::parse_usage_limit`). Carried on `ExecutionResult` so healing can
/// schedule a retry at the actual reset time instead of blind backoff.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UsageLimitInfo {
    pub scope: UsageLimitScope,
    /// When the limit resets, if the message carried a timestamp.
    pub resets_at: Option<chrono::DateTime<chrono::Utc>>,
}

// =============================================================================
// ErrorSeverity — unified severity levels
// =============================================================================

/// Severity level for a classified error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
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

    // Transient CLI process failure — last specific check before the Unknown
    // fallback. Pattern emitted by `runner::mod` at line 2241:
    //     format!("Execution failed (exit code {}): {}", exit_code, stderr_text.trim())
    // When `stderr_text.trim()` is empty/whitespace or extremely short (≤16
    // chars, e.g. "Killed", "Signal 9"), the process exited without
    // producing diagnostic output — the transient signature. Real errors
    // (auth, network, rate-limit, validation) emit informative stderr that
    // gets classified by the earlier matchers above.
    if lower.starts_with("execution failed (exit code") {
        if let Some(colon_pos) = lower.find("): ") {
            let suffix = lower[colon_pos + 3..].trim();
            if suffix.is_empty() || suffix.len() <= 16 {
                return ErrorCategory::TransientProcessFailure;
            }
        } else {
            // Format without trailing message — treat as transient.
            return ErrorCategory::TransientProcessFailure;
        }
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
    matches!(
        category,
        ErrorCategory::RateLimit
            | ErrorCategory::Timeout
            | ErrorCategory::TransientProcessFailure
    )
}

/// Phase C5b — returns `true` for categories that represent **technical**
/// failures of the run itself (auth/network/provider/timeout). These are NOT
/// the LLM's signals — the LLM may have emitted a `ManualReview` protocol
/// message before the technical error propagated, but those reviews shouldn't
/// queue for human resolution because they describe a run that never produced
/// real output.
///
/// Excludes `ToolError`, `Validation`, and `Unknown` — those can legitimately
/// surface review-worthy state from the LLM's perspective.
pub fn is_technical_failure(category: &ErrorCategory) -> bool {
    matches!(
        category,
        ErrorCategory::RateLimit
            | ErrorCategory::SessionLimit
            | ErrorCategory::Timeout
            | ErrorCategory::ProviderNotFound
            | ErrorCategory::CredentialError
            | ErrorCategory::Network
            | ErrorCategory::ApiError
            | ErrorCategory::TransientProcessFailure
    )
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
#[allow(dead_code)]
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
        ErrorCategory::TransientProcessFailure => ErrorSeverity::Low,
        ErrorCategory::Unknown => ErrorSeverity::Medium,
    }
}

/// Map an [`ErrorCategory`] to the database category string used by healing
/// issues (preserves backwards compatibility with existing DB records).
#[allow(dead_code)]
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
        ErrorCategory::TransientProcessFailure => "external",
        ErrorCategory::Unknown => "external",
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- is_technical_failure (Phase C5b) ---

    #[test]
    fn test_is_technical_failure_classifies_infra_categories_as_technical() {
        for cat in [
            ErrorCategory::RateLimit,
            ErrorCategory::SessionLimit,
            ErrorCategory::Timeout,
            ErrorCategory::ProviderNotFound,
            ErrorCategory::CredentialError,
            ErrorCategory::Network,
            ErrorCategory::ApiError,
        ] {
            assert!(is_technical_failure(&cat), "{cat:?} should be technical");
        }
    }

    #[test]
    fn test_is_technical_failure_excludes_llm_signals() {
        // ToolError / Validation / Unknown can legitimately surface review-worthy
        // state — we don't suppress reviews for them.
        for cat in [
            ErrorCategory::ToolError,
            ErrorCategory::Validation,
            ErrorCategory::Unknown,
        ] {
            assert!(
                !is_technical_failure(&cat),
                "{cat:?} should NOT be technical"
            );
        }
    }

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

    #[test]
    fn test_classify_transient_process_failure() {
        // Exact runner pattern with empty stderr after the colon.
        assert_eq!(
            classify_error_str("Execution failed (exit code 1): "),
            ErrorCategory::TransientProcessFailure
        );
        // Exit code with empty tail (just "Execution failed (exit code N)").
        assert_eq!(
            classify_error_str("Execution failed (exit code 137)"),
            ErrorCategory::TransientProcessFailure
        );
        // Short generic kill signal — still transient.
        assert_eq!(
            classify_error_str("Execution failed (exit code 137): Killed"),
            ErrorCategory::TransientProcessFailure
        );
        // Long informative stderr — NOT transient, falls through to Unknown.
        // (Real categories would already have matched earlier.)
        assert_eq!(
            classify_error_str(
                "Execution failed (exit code 2): garbage that is sufficiently long to look diagnostic"
            ),
            ErrorCategory::Unknown
        );
        // Real categorized errors still classify correctly even if they
        // happen to share the prefix (they don't in practice — the runner
        // pattern only fires for true exit-code-based failures).
        assert_eq!(
            classify_error_str("Execution failed (exit code 1): rate limit exceeded"),
            ErrorCategory::RateLimit
        );
    }

    // --- helpers ---

    #[test]
    fn test_is_auto_fixable() {
        assert!(is_auto_fixable(&ErrorCategory::RateLimit));
        assert!(is_auto_fixable(&ErrorCategory::Timeout));
        assert!(is_auto_fixable(&ErrorCategory::TransientProcessFailure));
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
