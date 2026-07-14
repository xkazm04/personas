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
///
/// The string ladder is tuned against the **real** failure templates this
/// fleet produces. The dominant one by volume is the runner's
/// `Execution failed (exit code {N}): {stderr}` (see `runner::mod`), whose
/// stderr is raw Claude Code CLI / Anthropic API output — so the ladder
/// carries the Anthropic wire shapes (`overloaded_error`/529,
/// `not_found_error`/404 for a retired model, `authentication_error`/401,
/// `permission_error`/403, oversized `prompt is too long`, "Credit balance is
/// too low") alongside the generic ones. Patterns are message-SHAPE based —
/// never persona- or id-specific — so `Unknown` stays an honest signal that a
/// genuinely new template appeared.
///
/// **Tuning against your own fleet:** these patterns cover the repo's known
/// producers, but every deployment sees its own long tail. To list the raw
/// strings the ladder still buckets as `Unknown`, an operator can run:
///
/// ```sql
/// SELECT error_message, COUNT(*) AS n
/// FROM persona_executions
/// WHERE status = 'failed' AND error_message IS NOT NULL AND error_message <> ''
/// GROUP BY error_message
/// ORDER BY n DESC
/// LIMIT 50;
/// ```
///
/// then add the dominant new SHAPES here (and mirror them into
/// `src/lib/errorTaxonomy.ts` + both `PARITY_FIXTURES` lists).
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
    // `etimedout` (Node's socket-timeout errno) is ported from the TS ladder —
    // this file is the source of truth, so the match lives here and TS mirrors
    // it. See PARITY_FIXTURES below and `errorTaxonomy.parity.test.ts`.
    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("deadline")
        || lower.contains("etimedout")
    {
        return ErrorCategory::Timeout;
    }

    // Provider / CLI / model not found. Includes Anthropic's `not_found_error`
    // (404) for a retired or unknown model id — the 2026-06 retired-model
    // failure the fleet actually hit — plus the raw CLI/spawn shapes.
    if lower.contains("not found")
        || lower.contains("enoent")
        || lower.contains("is not recognized")
        || lower.contains("not_found_error")
        || lower.contains("404")
        || lower.contains("model not found")
        || lower.contains("unknown model")
        || lower.contains("no such model")
    {
        return ErrorCategory::ProviderNotFound;
    }

    // Credential / auth / billing errors. Anthropic wire types
    // (`authentication_error` 401, `permission_error` 403) plus the classic
    // Claude Code "Credit balance is too low" billing block — all account-level,
    // user-actionable, and not fixable by failover.
    if lower.contains("decrypt")
        || lower.contains("credential")
        || lower.contains("api key")
        || lower.contains("unauthorized")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("authentication_error")
        || lower.contains("permission_error")
        || lower.contains("forbidden")
        || lower.contains("credit balance")
        || lower.contains("billing_error")
        || lower.contains("payment required")
    {
        return ErrorCategory::CredentialError;
    }

    // Network errors — connection refused/reset, dropped sockets, DNS. The
    // reset / hang-up / broken-pipe shapes are the transient TCP drops Claude
    // Code CLI surfaces mid-stream (distinct from the runner's exit-code
    // `TransientProcessFailure`, which carries no stderr).
    if lower.contains("network")
        || lower.contains("econnrefused")
        || lower.contains("econnreset")
        || lower.contains("err_network")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("reset by peer")
        || lower.contains("socket hang up")
        || lower.contains("epipe")
        || lower.contains("broken pipe")
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

    // API / server errors — 5xx and Anthropic's `overloaded_error` (529), the
    // dominant real failure when the provider is at capacity.
    if lower.contains("500")
        || lower.contains("502")
        || lower.contains("503")
        || lower.contains("529")
        || lower.contains("overloaded")
        || lower.contains("api error")
        || lower.contains("server error")
        || lower.contains("internal server")
    {
        return ErrorCategory::ApiError;
    }

    // Validation / oversized-input errors. Anthropic `invalid_request_error`
    // already lands here via "invalid"; the phrasings below catch the
    // human-readable oversize shapes ("prompt is too long", context-window
    // overflow, 413 request-too-large) that carry no "invalid" token.
    if lower.contains("validation")
        || lower.contains("invalid")
        || lower.contains("malformed")
        || lower.contains("parse error")
        || lower.contains("prompt is too long")
        || lower.contains("context length")
        || lower.contains("context window")
        || lower.contains("request_too_large")
        || lower.contains("request too large")
        || lower.contains("payload too large")
        || lower.contains("413")
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

    // Boot-recovery sweep: the engine marks orphaned running executions as
    // failed with this exact message when the app restarts mid-run
    // (engine/mod.rs `recover_orphaned_executions`). It is an environmental
    // interruption, not a provider or config error — the 2026-07-14 live
    // smoke found it as the single most common real failure message in a
    // fleet (9/9 in the window), all landing in Unknown before this arm.
    if lower.contains("app restarted while execution was running") {
        return ErrorCategory::TransientProcessFailure;
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
///
/// This is the **guard on the failover/breaker layer entry**: only eligible
/// categories cross into the provider circuit breaker. It is consumed in two
/// load-bearing places, both keyed off this single predicate so the FFI never
/// drifts from the engine:
/// - [`super::failover::classify_error`] returns `Some(category)` iff eligible;
///   the runner records a provider-circuit-breaker failure only when that is
///   `Some` (see `runner::mod` — "Record circuit breaker outcome"). An
///   ineligible category (credential/validation/tool/unknown) never counts
///   toward the provider breaker.
/// - `AppError`'s serializer emits a `failover_eligible` hint over IPC so the
///   frontend can branch without re-running any classifier (`crate::error`).
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
    fn test_classify_real_fleet_shapes() {
        // Anthropic / Claude Code CLI stderr templates that previously fell
        // through to Unknown on the failures-by-category dashboard. Each maps
        // to an existing category by message SHAPE, never by id.

        // 529 overloaded_error — provider at capacity (the dominant class).
        assert_eq!(classify_error_str("Overloaded"), ErrorCategory::ApiError);
        assert_eq!(
            classify_error_str("API Error: 529 overloaded_error"),
            ErrorCategory::ApiError
        );

        // 404 not_found_error for a retired/unknown model id.
        assert_eq!(
            classify_error_str("API Error: 404 not_found_error: model: claude-sonnet-4-20250514"),
            ErrorCategory::ProviderNotFound
        );
        assert_eq!(
            classify_error_str("unknown model requested"),
            ErrorCategory::ProviderNotFound
        );

        // Billing / auth account blocks.
        assert_eq!(
            classify_error_str("Credit balance is too low"),
            ErrorCategory::CredentialError
        );
        assert_eq!(
            classify_error_str("permission_error: your API key does not have access"),
            ErrorCategory::CredentialError
        );
        assert_eq!(
            classify_error_str("authentication_error"),
            ErrorCategory::CredentialError
        );

        // Oversized input (prompt/context/413).
        assert_eq!(
            classify_error_str("prompt is too long: 300000 tokens > 200000 maximum"),
            ErrorCategory::Validation
        );
        assert_eq!(
            classify_error_str("context length exceeded"),
            ErrorCategory::Validation
        );
        assert_eq!(
            classify_error_str("413 request too large"),
            ErrorCategory::Validation
        );

        // Transient TCP drops (distinct from empty-stderr TransientProcessFailure).
        assert_eq!(
            classify_error_str("read ECONNRESET"),
            ErrorCategory::Network
        );
        assert_eq!(
            classify_error_str("socket hang up"),
            ErrorCategory::Network
        );

        // A real fleet failure end-to-end: the runner wrapper carrying an
        // overloaded stderr now classifies instead of burying as Unknown.
        assert_eq!(
            classify_error_str("Execution failed (exit code 1): API Error: 529 overloaded_error"),
            ErrorCategory::ApiError
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

    // --- Cross-FFI parity fixtures -------------------------------------------
    //
    // MIRRORED PAIR — this list is kept byte-for-byte in sync with
    // `src/lib/errors/__tests__/errorTaxonomy.parity.test.ts` (PARITY_FIXTURES).
    // Both ladders (Rust `classify_error` and TS `classifyError`) must map every
    // fixture string to the same category. When you add a case to one side, add
    // the SAME case with the SAME expected category to the other file. The
    // parity guarantee is what lets the frontend trust the Rust-computed
    // `category` on the IPC envelope.
    //
    // `snake_case` here == the TS string-literal category on the other side.
    const PARITY_FIXTURES: &[(&str, ErrorCategory)] = &[
        ("Error: rate limit exceeded", ErrorCategory::RateLimit),
        ("Too many requests", ErrorCategory::RateLimit),
        ("HTTP 429 from provider", ErrorCategory::RateLimit),
        ("quota exceeded for this key", ErrorCategory::RateLimit),
        ("usage limit reached", ErrorCategory::RateLimit),
        ("Session limit reached", ErrorCategory::SessionLimit),
        ("Execution timed out after 600s", ErrorCategory::Timeout),
        ("Request timeout", ErrorCategory::Timeout),
        ("deadline exceeded", ErrorCategory::Timeout),
        ("connect ETIMEDOUT 10.0.0.1:443", ErrorCategory::Timeout),
        ("Claude CLI not found", ErrorCategory::ProviderNotFound),
        ("spawn ENOENT", ErrorCategory::ProviderNotFound),
        ("'claude' is not recognized", ErrorCategory::ProviderNotFound),
        ("Failed to decrypt credential", ErrorCategory::CredentialError),
        ("Invalid API key provided", ErrorCategory::CredentialError),
        ("HTTP 401 Unauthorized", ErrorCategory::CredentialError),
        ("403 returned", ErrorCategory::CredentialError),
        ("ECONNREFUSED 127.0.0.1:3000", ErrorCategory::Network),
        ("ERR_NETWORK while fetching", ErrorCategory::Network),
        ("connection refused", ErrorCategory::Network),
        ("fetch failed", ErrorCategory::Network),
        ("tool_use failed", ErrorCategory::ToolError),
        ("Tool call failed", ErrorCategory::ToolError),
        ("HTTP 500 internal server error", ErrorCategory::ApiError),
        ("502 Bad Gateway", ErrorCategory::ApiError),
        ("validation failed: missing field", ErrorCategory::Validation),
        ("malformed JSON in body", ErrorCategory::Validation),
        // Real fleet shapes — Claude Code CLI / Anthropic API stderr as it lands
        // inside `Execution failed (exit code N): <stderr>`. These are the
        // templates the failures-by-category dashboard was burying under Unknown.
        ("API Error: 529 {\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}", ErrorCategory::ApiError),
        ("Overloaded", ErrorCategory::ApiError),
        ("API Error: 404 not_found_error: model: claude-sonnet-4-20250514", ErrorCategory::ProviderNotFound),
        ("model not found", ErrorCategory::ProviderNotFound),
        ("Credit balance is too low", ErrorCategory::CredentialError),
        ("API Error: 403 permission_error", ErrorCategory::CredentialError),
        ("authentication_error: invalid x-api-key", ErrorCategory::CredentialError),
        ("prompt is too long: exceeds the model maximum", ErrorCategory::Validation),
        ("Request too large (413)", ErrorCategory::Validation),
        ("read ECONNRESET", ErrorCategory::Network),
        (
            "App restarted while execution was running",
            ErrorCategory::TransientProcessFailure,
        ),
        ("socket hang up", ErrorCategory::Network),
        ("Execution failed (exit code 137): Killed", ErrorCategory::TransientProcessFailure),
        ("Execution failed (exit code 1): ", ErrorCategory::TransientProcessFailure),
        ("some entirely novel failure", ErrorCategory::Unknown),
    ];

    #[test]
    fn test_parity_fixtures_classify_consistently() {
        for (input, expected) in PARITY_FIXTURES {
            assert_eq!(
                classify_error_str(input),
                *expected,
                "parity fixture {input:?} classified wrong"
            );
        }
    }
}
