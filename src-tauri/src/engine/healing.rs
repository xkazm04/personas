//! Healing engine: error classification, diagnosis, and auto-fix logic.
//!
//! Pure functions -- no DB or async dependencies -- for testability.
//!
//! Error classification is delegated to the unified [`super::error_taxonomy`]
//! module. This module re-exports the shared types for backwards compatibility.

pub use super::error_taxonomy::ErrorCategory as FailureCategory;
pub use super::error_taxonomy::{classify_error, is_auto_fixable};

/// Recommended action for a diagnosed failure.
#[derive(Debug, Clone, PartialEq)]
pub enum HealingAction {
    RetryWithBackoff { delay_secs: u64 },
    RetryWithTimeout { new_timeout_ms: u64 },
    AiHealing,
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
// Diagnosis
// ---------------------------------------------------------------------------

/// Maximum backoff delay in seconds (5 minutes).
const MAX_BACKOFF_SECS: u64 = 300;
/// Maximum timeout in milliseconds — derived from the engine hard ceiling.
const MAX_TIMEOUT_MS: u64 = super::ENGINE_MAX_EXECUTION_SECS * 1000;
/// Maximum number of retries for a single execution chain.
pub const MAX_RETRY_COUNT: i64 = 3;
/// Occurrence count threshold at which the knowledge base triggers preemptive
/// escalation (skip retries and go straight to [`HealingAction::CreateIssue`]).
const KB_ESCALATION_THRESHOLD: i64 = 5;

/// Fleet-wide knowledge about a failure pattern, looked up from the
/// `healing_knowledge` table before diagnosis.
#[derive(Debug, Clone, Default)]
pub struct KnowledgeHint {
    /// Recommended backoff delay (seconds) learned from past failures.
    pub recommended_delay_secs: Option<u64>,
    /// How many times this pattern has been observed fleet-wide.
    pub occurrence_count: i64,
}

/// Produce a full [`HealingDiagnosis`] with a recommended action.
///
/// `consecutive_failures` is the number of recent consecutive failures for the
/// same persona -- used to escalate backoff or switch from retry to manual issue.
///
/// `retry_count` is the number of retries already attempted for this specific
/// execution chain. When it reaches [`MAX_RETRY_COUNT`], retryable actions
/// escalate to [`HealingAction::CreateIssue`].
///
/// `kb_hint` is an optional [`KnowledgeHint`] from the healing knowledge base.
/// When present, the recommended delay overrides the computed backoff and high
/// occurrence counts trigger preemptive escalation.
pub fn diagnose(
    category: &FailureCategory,
    error: &str,
    current_timeout_ms: u64,
    consecutive_failures: u32,
    retry_count: i64,
    kb_hint: Option<&KnowledgeHint>,
) -> HealingDiagnosis {
    match category {
        FailureCategory::RateLimit => {
            // Escalation policy: exhaust MAX_RETRY_COUNT retries with
            // exponential backoff before creating a manual issue.
            // Knowledge-base preemptive escalation also applies.
            let kb_escalate = kb_hint
                .map(|h| h.occurrence_count >= KB_ESCALATION_THRESHOLD)
                .unwrap_or(false);

            if retry_count >= MAX_RETRY_COUNT || kb_escalate {
                return HealingDiagnosis {
                    category: *category,
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
            // Use knowledge-base recommended delay when available, otherwise
            // fall back to exponential backoff.
            let computed_delay = std::cmp::min(30u64.saturating_mul(1 << consecutive_failures), MAX_BACKOFF_SECS);
            let delay = kb_hint
                .and_then(|h| h.recommended_delay_secs)
                .map(|kb_delay| std::cmp::min(kb_delay, MAX_BACKOFF_SECS))
                .unwrap_or(computed_delay);
            HealingDiagnosis {
                category: *category,
                action: HealingAction::RetryWithBackoff { delay_secs: delay },
                title: "Rate limit hit".into(),
                description: format!(
                    "Execution was rate-limited. Will retry after {}s backoff. Error: {}",
                    delay,
                    truncate(error, 200),
                ),
                severity: "medium".into(),
                db_category: "external".into(),
                suggested_fix: Some(format!("Automatic retry with {delay}s backoff.")),
            }
        }
        FailureCategory::SessionLimit => HealingDiagnosis {
            category: *category,
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
            // Escalation policy (consistent with RateLimit): exhaust
            // MAX_RETRY_COUNT retries before creating a manual issue.
            // Knowledge-base preemptive escalation also applies.
            let kb_escalate = kb_hint
                .map(|h| h.occurrence_count >= KB_ESCALATION_THRESHOLD)
                .unwrap_or(false);

            if retry_count >= MAX_RETRY_COUNT || kb_escalate {
                HealingDiagnosis {
                    category: *category,
                    action: HealingAction::CreateIssue,
                    title: "Timeout retries exhausted".into(),
                    description: format!(
                        "Execution timed out and {} retries have been exhausted. Current timeout: {}ms. Error: {}",
                        MAX_RETRY_COUNT,
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
                    category: *category,
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
                        "Automatic retry with increased timeout ({new_timeout}ms).",
                    )),
                }
            }
        }
        FailureCategory::ProviderNotFound => HealingDiagnosis {
            category: *category,
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
            category: *category,
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
        FailureCategory::Network => HealingDiagnosis {
            category: *category,
            action: HealingAction::CreateIssue,
            title: "Network error".into(),
            description: format!(
                "A network-level failure was detected. Error: {}",
                truncate(error, 200),
            ),
            severity: "medium".into(),
            db_category: "external".into(),
            suggested_fix: Some(
                "Check network connectivity and firewall settings.".into(),
            ),
        },
        FailureCategory::ToolError => HealingDiagnosis {
            category: *category,
            action: HealingAction::CreateIssue,
            title: "Tool call failure".into(),
            description: format!(
                "A tool call failed during execution. Error: {}",
                truncate(error, 200),
            ),
            severity: "medium".into(),
            db_category: "tool".into(),
            suggested_fix: Some(
                "Review tool configuration and add error recovery instructions.".into(),
            ),
        },
        FailureCategory::ApiError => HealingDiagnosis {
            category: *category,
            action: HealingAction::CreateIssue,
            title: "API server error".into(),
            description: format!(
                "An API server error was detected. Error: {}",
                truncate(error, 200),
            ),
            severity: "high".into(),
            db_category: "external".into(),
            suggested_fix: Some(
                "API provider may be experiencing issues. Retry later or check status page.".into(),
            ),
        },
        FailureCategory::Validation => HealingDiagnosis {
            category: *category,
            action: HealingAction::CreateIssue,
            title: "Validation error".into(),
            description: format!(
                "Input validation or parsing failed. Error: {}",
                truncate(error, 200),
            ),
            severity: "low".into(),
            db_category: "prompt".into(),
            suggested_fix: Some(
                "Check input data format and prompt structure.".into(),
            ),
        },
        FailureCategory::Unknown => HealingDiagnosis {
            category: *category,
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

use super::str_utils::truncate_str as truncate;

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
            FailureCategory::ProviderNotFound,
        );
        assert_eq!(
            classify_error("ENOENT: no such file", false, false),
            FailureCategory::ProviderNotFound,
        );
        assert_eq!(
            classify_error("'claude' is not recognized as an internal command", false, false),
            FailureCategory::ProviderNotFound,
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
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, 0, None);
        assert_eq!(d.action, HealingAction::RetryWithBackoff { delay_secs: 30 });
        assert_eq!(d.severity, "medium");
    }

    #[test]
    fn test_diagnose_rate_limit_escalating_backoff() {
        // consecutive_failures = 3 -> 30 * 2^3 = 240
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 3, 0, None);
        assert_eq!(
            d.action,
            HealingAction::RetryWithBackoff { delay_secs: 240 }
        );

        // consecutive_failures = 5 -> 30 * 32 = 960 -> capped at 300
        let d2 = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 5, 0, None);
        assert_eq!(
            d2.action,
            HealingAction::RetryWithBackoff { delay_secs: 300 }
        );
    }

    #[test]
    fn test_diagnose_rate_limit_retries_exhausted() {
        // retry_count = MAX_RETRY_COUNT -> escalate to CreateIssue
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, MAX_RETRY_COUNT, None);
        assert_eq!(d.action, HealingAction::CreateIssue);
        assert_eq!(d.severity, "high");

        // retry_count > MAX_RETRY_COUNT -> still CreateIssue
        let d2 = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, MAX_RETRY_COUNT + 1, None);
        assert_eq!(d2.action, HealingAction::CreateIssue);
    }

    #[test]
    fn test_diagnose_timeout_retry() {
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 0, 0, None);
        assert_eq!(
            d.action,
            HealingAction::RetryWithTimeout {
                new_timeout_ms: 1_200_000
            }
        );
    }

    #[test]
    fn test_diagnose_timeout_max_cap() {
        // 1_200_000 * 2 = 2_400_000 -> capped at MAX_TIMEOUT_MS (1_200_000)
        let d = diagnose(&FailureCategory::Timeout, "timed out", 1_200_000, 0, 0, None);
        assert_eq!(
            d.action,
            HealingAction::RetryWithTimeout {
                new_timeout_ms: 1_200_000
            }
        );
    }

    #[test]
    fn test_diagnose_timeout_consecutive_still_retries() {
        // consecutive_failures alone no longer escalates; retry_count governs escalation
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 1, 0, None);
        assert_eq!(
            d.action,
            HealingAction::RetryWithTimeout { new_timeout_ms: 1_200_000 }
        );
        assert_eq!(d.severity, "medium");
    }

    #[test]
    fn test_diagnose_timeout_retries_exhausted() {
        // Even with consecutive_failures = 0, retry_count at limit should escalate
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 0, MAX_RETRY_COUNT, None);
        assert_eq!(d.action, HealingAction::CreateIssue);
    }

    #[test]
    fn test_is_auto_fixable() {
        assert!(is_auto_fixable(&FailureCategory::RateLimit));
        assert!(is_auto_fixable(&FailureCategory::Timeout));
        assert!(!is_auto_fixable(&FailureCategory::SessionLimit));
        assert!(!is_auto_fixable(&FailureCategory::ProviderNotFound));
        assert!(!is_auto_fixable(&FailureCategory::CredentialError));
        assert!(!is_auto_fixable(&FailureCategory::Unknown));
    }

    // --- knowledge hint ---

    #[test]
    fn test_kb_hint_overrides_backoff_delay() {
        let hint = KnowledgeHint {
            recommended_delay_secs: Some(120),
            occurrence_count: 3,
        };
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, 0, Some(&hint));
        // KB delay (120) overrides computed delay (30)
        assert_eq!(d.action, HealingAction::RetryWithBackoff { delay_secs: 120 });
    }

    #[test]
    fn test_kb_hint_delay_capped_at_max() {
        let hint = KnowledgeHint {
            recommended_delay_secs: Some(999),
            occurrence_count: 2,
        };
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, 0, Some(&hint));
        assert_eq!(d.action, HealingAction::RetryWithBackoff { delay_secs: MAX_BACKOFF_SECS });
    }

    #[test]
    fn test_kb_high_occurrence_escalates_rate_limit() {
        let hint = KnowledgeHint {
            recommended_delay_secs: Some(60),
            occurrence_count: 5, // meets KB_ESCALATION_THRESHOLD
        };
        // Even with retry_count=0 and consecutive_failures=0, high occurrence escalates
        let d = diagnose(&FailureCategory::RateLimit, "rate limited", 600_000, 0, 0, Some(&hint));
        assert_eq!(d.action, HealingAction::CreateIssue);
    }

    #[test]
    fn test_kb_high_occurrence_escalates_timeout() {
        let hint = KnowledgeHint {
            recommended_delay_secs: None,
            occurrence_count: 5,
        };
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 0, 0, Some(&hint));
        assert_eq!(d.action, HealingAction::CreateIssue);
    }

    #[test]
    fn test_kb_low_occurrence_does_not_escalate() {
        let hint = KnowledgeHint {
            recommended_delay_secs: None,
            occurrence_count: 4, // below threshold
        };
        let d = diagnose(&FailureCategory::Timeout, "timed out", 600_000, 0, 0, Some(&hint));
        // Should still retry, not escalate
        assert_eq!(
            d.action,
            HealingAction::RetryWithTimeout { new_timeout_ms: 1_200_000 }
        );
    }
}
