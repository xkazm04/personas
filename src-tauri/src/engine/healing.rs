//! Healing engine: error classification, diagnosis, and auto-fix logic.
//!
//! Pure functions — no DB or async dependencies — for testability.

/// Broad failure category derived from error strings and flags.
#[derive(Debug, Clone, PartialEq)]
pub enum FailureCategory {
    RateLimit,
    SessionLimit,
    Timeout,
    CliNotFound,
    CredentialError,
    Unknown,
}

/// Recommended action for a diagnosed failure.
#[derive(Debug, Clone, PartialEq)]
pub enum HealingAction {
    RetryWithBackoff { delay_secs: u64 },
    RetryWithTimeout { new_timeout_ms: u64 },
    CreateIssue,
}

/// Full diagnosis produced by [`diagnose`].
#[derive(Debug, Clone)]
pub struct HealingDiagnosis {
    #[allow(dead_code)]
    pub category: FailureCategory,
    pub action: HealingAction,
    pub title: String,
    pub description: String,
    /// "low" | "medium" | "high" | "critical"
    pub severity: String,
    /// "config" | "external" | "prompt" | "tool"
    pub db_category: String,
    pub suggested_fix: Option<String>,
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/// Classify an error into a [`FailureCategory`].
///
/// Flags (`timed_out`, `session_limit`) take priority over string matching so
/// that the caller can pass pre-parsed booleans from [`ExecutionResult`].
pub fn classify_error(error: &str, timed_out: bool, session_limit: bool) -> FailureCategory {
    if session_limit {
        return FailureCategory::SessionLimit;
    }
    if timed_out {
        return FailureCategory::Timeout;
    }

    let lower = error.to_lowercase();

    if lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("429")
    {
        return FailureCategory::RateLimit;
    }

    if lower.contains("timed out") || lower.contains("timeout") {
        return FailureCategory::Timeout;
    }

    if lower.contains("not found")
        || lower.contains("enoent")
        || lower.contains("is not recognized")
    {
        return FailureCategory::CliNotFound;
    }

    if lower.contains("decrypt")
        || lower.contains("credential")
        || lower.contains("api key")
        || lower.contains("unauthorized")
        || lower.contains("401")
        || lower.contains("403")
    {
        return FailureCategory::CredentialError;
    }

    FailureCategory::Unknown
}

/// Returns `true` for categories that can be automatically retried.
pub fn is_auto_fixable(category: &FailureCategory) -> bool {
    matches!(
        category,
        FailureCategory::RateLimit | FailureCategory::Timeout
    )
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

/// Maximum backoff delay in seconds (5 minutes).
const MAX_BACKOFF_SECS: u64 = 300;
/// Maximum timeout in milliseconds (30 minutes).
const MAX_TIMEOUT_MS: u64 = 1_800_000;
/// Maximum number of retries for a single execution chain.
pub const MAX_RETRY_COUNT: i64 = 3;

/// Produce a full [`HealingDiagnosis`] with a recommended action.
///
/// `consecutive_failures` is the number of recent consecutive failures for the
/// same persona — used to escalate backoff or switch from retry to manual issue.
///
/// `retry_count` is the number of retries already attempted for this specific
/// execution chain. When it reaches [`MAX_RETRY_COUNT`], retryable actions
/// escalate to [`HealingAction::CreateIssue`].
pub fn diagnose(
    category: &FailureCategory,
    error: &str,
    current_timeout_ms: u64,
    consecutive_failures: u32,
    retry_count: i64,
) -> HealingDiagnosis {
    match category {
        FailureCategory::RateLimit => {
            if retry_count >= MAX_RETRY_COUNT {
                return HealingDiagnosis {
                    category: category.clone(),
                    action: HealingAction::CreateIssue,
                    title: "Rate limit retries exhausted".into(),
                    description: format!(
                        "Execution was rate-limited and {} retries have been exhausted. Manual investigation required. Error: {}",
                        MAX_RETRY_COUNT,
                        truncate(error, 200),
                    ),
                    severity: "high".into(),
                    db_category: "external".into(),
                    suggested_fix: Some(
                        "Check API rate limits, consider reducing execution frequency or upgrading your plan.".into(),
                    ),
                };
            }
            let delay = std::cmp::min(30u64.saturating_mul(1 << consecutive_failures), MAX_BACKOFF_SECS);
            HealingDiagnosis {
                category: category.clone(),
                action: HealingAction::RetryWithBackoff { delay_secs: delay },
                title: "Rate limit hit".into(),
                description: format!(
                    "Execution was rate-limited. Will retry after {}s backoff. Error: {}",
                    delay,
                    truncate(error, 200),
                ),
                severity: "medium".into(),
                db_category: "external".into(),
                suggested_fix: Some(format!("Automatic retry with {}s backoff.", delay)),
            }
        }
        FailureCategory::SessionLimit => HealingDiagnosis {
            category: category.clone(),
            action: HealingAction::CreateIssue,
            title: "Session limit reached".into(),
            description: format!(
                "The AI provider session/usage limit was hit. Manual action required. Error: {}",
                truncate(error, 200),
            ),
            severity: "high".into(),
            db_category: "external".into(),
            suggested_fix: Some(
                "Wait for the usage limit to reset, or upgrade your plan.".into(),
            ),
        },
        FailureCategory::Timeout => {
            if consecutive_failures >= 1 || retry_count >= MAX_RETRY_COUNT {
                // Already retried once or retry limit exhausted — escalate to manual issue
                HealingDiagnosis {
                    category: category.clone(),
                    action: HealingAction::CreateIssue,
                    title: "Repeated timeout".into(),
                    description: format!(
                        "Execution timed out after a previous timeout retry. Current timeout: {}ms. Error: {}",
                        current_timeout_ms,
                        truncate(error, 200),
                    ),
                    severity: "high".into(),
                    db_category: "config".into(),
                    suggested_fix: Some(
                        "Consider simplifying the prompt or splitting the task into smaller steps.".into(),
                    ),
                }
            } else {
                let new_timeout = std::cmp::min(current_timeout_ms.saturating_mul(2), MAX_TIMEOUT_MS);
                HealingDiagnosis {
                    category: category.clone(),
                    action: HealingAction::RetryWithTimeout { new_timeout_ms: new_timeout },
                    title: "Execution timed out".into(),
                    description: format!(
                        "Execution exceeded the {}ms timeout. Will retry with {}ms timeout. Error: {}",
                        current_timeout_ms,
                        new_timeout,
                        truncate(error, 200),
                    ),
                    severity: "medium".into(),
                    db_category: "config".into(),
                    suggested_fix: Some(format!(
                        "Automatic retry with increased timeout ({}ms).",
                        new_timeout,
                    )),
                }
            }
        }
        FailureCategory::CliNotFound => HealingDiagnosis {
            category: category.clone(),
            action: HealingAction::CreateIssue,
            title: "Claude CLI not found".into(),
            description: format!(
                "The Claude CLI binary could not be located. Error: {}",
                truncate(error, 200),
            ),
            severity: "critical".into(),
            db_category: "config".into(),
            suggested_fix: Some(
                "Install Claude CLI: https://docs.anthropic.com/en/docs/claude-code".into(),
            ),
        },
        FailureCategory::CredentialError => HealingDiagnosis {
            category: category.clone(),
            action: HealingAction::CreateIssue,
            title: "Credential / auth error".into(),
            description: format!(
                "An authentication or credential issue was detected. Error: {}",
                truncate(error, 200),
            ),
            severity: "high".into(),
            db_category: "config".into(),
            suggested_fix: Some(
                "Check that the API key or credential is valid and not expired.".into(),
            ),
        },
        FailureCategory::Unknown => HealingDiagnosis {
            category: category.clone(),
            action: HealingAction::CreateIssue,
            title: "Execution failed".into(),
            description: format!(
                "Execution failed with an unrecognised error. Error: {}",
                truncate(error, 200),
            ),
            severity: "medium".into(),
            db_category: "external".into(),
            suggested_fix: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        // Find the largest byte index <= max that is a valid char boundary
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- classify_error ---

    #[test]
    fn test_classify_rate_limit() {
        assert_eq!(
            classify_error("Error: rate limit exceeded", false, false),
            FailureCategory::RateLimit,
        );
    }

    #[test]
    fn test_classify_too_many_requests() {
        assert_eq!(
            classify_error("Too many requests, slow down", false, false),
            FailureCategory::RateLimit,
        );
    }

    #[test]
    fn test_classify_429() {
        assert_eq!(
            classify_error("HTTP 429 returned from API", false, false),
            FailureCategory::RateLimit,
        );
    }

    #[test]
    fn test_classify_session_limit() {
        // session_limit flag takes priority
        assert_eq!(
            classify_error("some error", false, true),
            FailureCategory::SessionLimit,
        );
    }

    #[test]
    fn test_classify_timeout() {
        assert_eq!(
            classify_error("irrelevant", true, false),
            FailureCategory::Timeout,
        );
        // Also via error string
        assert_eq!(
            classify_error("Execution timed out after 600s", false, false),
            FailureCategory::Timeout,
        );
    }

    #[test]
    fn test_classify_cli_not_found() {
        assert_eq!(
            classify_error("Claude CLI not found", false, false),
            FailureCategory::CliNotFound,
        );
        assert_eq!(
            classify_error("ENOENT: no such file", false, false),
            FailureCategory::CliNotFound,
        );
        assert_eq!(
            classify_error("'claude' is not recognized as an internal command", false, false),
            FailureCategory::CliNotFound,
        );
    }

    #[test]
    fn test_classify_credential_error() {
        assert_eq!(
            classify_error("HTTP 401 Unauthorized", false, false),
            FailureCategory::CredentialError,
        );
        assert_eq!(
            classify_error("Failed to decrypt credential", false, false),
            FailureCategory::CredentialError,
        );
        assert_eq!(
            classify_error("Invalid API key provided", false, false),
            FailureCategory::CredentialError,
        );
    }

    #[test]
    fn test_classify_unknown() {
        assert_eq!(
            classify_error("some random error", false, false),
            FailureCategory::Unknown,
        );
    }

    // --- diagnose ---

    #[test]
    fn test_diagnose_rate_limit_backoff() {
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, 0);
        assert_eq!(d.action, HealingAction::RetryWithBackoff { delay_secs: 30 });
        assert_eq!(d.severity, "medium");
    }

    #[test]
    fn test_diagnose_rate_limit_escalating_backoff() {
        // consecutive_failures = 3 → 30 * 2^3 = 240
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 3, 0);
        assert_eq!(
            d.action,
            HealingAction::RetryWithBackoff { delay_secs: 240 }
        );

        // consecutive_failures = 5 → 30 * 32 = 960 → capped at 300
        let d2 = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 5, 0);
        assert_eq!(
            d2.action,
            HealingAction::RetryWithBackoff { delay_secs: 300 }
        );
    }

    #[test]
    fn test_diagnose_rate_limit_retries_exhausted() {
        // retry_count = MAX_RETRY_COUNT → escalate to CreateIssue
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, MAX_RETRY_COUNT);
        assert_eq!(d.action, HealingAction::CreateIssue);
        assert_eq!(d.severity, "high");

        // retry_count > MAX_RETRY_COUNT → still CreateIssue
        let d2 = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, MAX_RETRY_COUNT + 1);
        assert_eq!(d2.action, HealingAction::CreateIssue);
    }

    #[test]
    fn test_diagnose_timeout_retry() {
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 0, 0);
        assert_eq!(
            d.action,
            HealingAction::RetryWithTimeout {
                new_timeout_ms: 1_200_000
            }
        );
    }

    #[test]
    fn test_diagnose_timeout_max_cap() {
        // 1_200_000 * 2 = 2_400_000 → capped at 1_800_000
        let d = diagnose(&FailureCategory::Timeout, "timed out", 1_200_000, 0, 0);
        assert_eq!(
            d.action,
            HealingAction::RetryWithTimeout {
                new_timeout_ms: 1_800_000
            }
        );
    }

    #[test]
    fn test_diagnose_timeout_consecutive_creates_issue() {
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 1, 0);
        assert_eq!(d.action, HealingAction::CreateIssue);
        assert_eq!(d.severity, "high");
    }

    #[test]
    fn test_diagnose_timeout_retries_exhausted() {
        // Even with consecutive_failures = 0, retry_count at limit should escalate
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 0, MAX_RETRY_COUNT);
        assert_eq!(d.action, HealingAction::CreateIssue);
    }

    #[test]
    fn test_is_auto_fixable() {
        assert!(is_auto_fixable(&FailureCategory::RateLimit));
        assert!(is_auto_fixable(&FailureCategory::Timeout));
        assert!(!is_auto_fixable(&FailureCategory::SessionLimit));
        assert!(!is_auto_fixable(&FailureCategory::CliNotFound));
        assert!(!is_auto_fixable(&FailureCategory::CredentialError));
        assert!(!is_auto_fixable(&FailureCategory::Unknown));
    }
}
