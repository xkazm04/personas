//! Healing decision tree with explicit precedence.
//!
//! This module is the **single orchestration layer** that determines which
//! healing strategy should handle a given failure. It replaces the ad-hoc
//! sequencing previously spread across `evaluate_healing_and_retry()`.
//!
//! # Strategy Precedence (highest → lowest)
//!
//! 1. **Failover** — provider/model switch via circuit breaker.
//!    Resolved in `runner.rs` *before* post-failure healing runs.
//!    Not represented here because the runner exhausts the failover chain
//!    before any failure reaches the healing pipeline.
//!
//! 2. **Rule-based retry** — exponential backoff (rate limit) or timeout
//!    increase (timeout). Only for transient, auto-fixable categories
//!    (`RateLimit`, `Timeout`) when retry budget remains.
//!
//! 3. **AI Healing** — resume the original Claude session to diagnose and
//!    apply fixes. Dev-mode only. Activates when rule-based healing cannot
//!    resolve the failure (unknown/credential errors, incomplete state, or
//!    repeated failures of any category).
//!
//! 4. **Auto-rollback** — periodic background check (every 5 min) that
//!    compares version-level error rates. Operates on aggregate metrics,
//!    not individual failures. Runs independently and is never selected
//!    by this decision tree.
//!
//! # Mutual Exclusion
//!
//! - **Rule-based retry and AI healing are mutually exclusive** per failure
//!   event. If rule-based retry activates, AI healing is skipped for that
//!   event (the retry itself may later trigger AI healing if it also fails).
//!
//! - **Auto-rollback is independent.** It may revert a persona's prompt
//!   version concurrently with individual-failure healing. This is safe
//!   because auto-rollback checks aggregate error rates and operates at the
//!   prompt-version level, while individual healing operates at the
//!   execution level.
//!
//! - **The `healing_personas` lock** prevents concurrent AI healing sessions
//!   on the same persona.
//!
//! # Circuit Breaker (persona-level)
//!
//! After `CIRCUIT_BREAKER_THRESHOLD` (5) consecutive failures, the persona
//! is disabled entirely. This takes priority over all strategies — no retry
//! or AI healing is attempted once the breaker trips.

use super::healing::{self, HealingDiagnosis, KnowledgeHint, MAX_RETRY_COUNT};

/// Threshold of consecutive failures before the persona-level circuit breaker
/// trips and disables the persona.
pub const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;

/// The single healing strategy selected for a failure event.
#[derive(Debug, Clone)]
pub enum HealingStrategy {
    /// Rule-based retry: backoff or timeout increase.
    /// The caller should spawn a retry execution after the prescribed delay.
    RuleBasedRetry {
        diagnosis: HealingDiagnosis,
    },
    /// AI-powered healing: resume the original session to diagnose and fix.
    /// Only valid in dev-mode and when a session ID is available.
    AiHealing {
        diagnosis: HealingDiagnosis,
    },
    /// No automated healing — create an issue for manual investigation.
    CreateIssue {
        diagnosis: HealingDiagnosis,
    },
    /// Persona disabled by circuit breaker — no healing attempted.
    CircuitBreakerTripped {
        diagnosis: HealingDiagnosis,
    },
}

impl HealingStrategy {
    /// Returns the diagnosis attached to this strategy.
    pub fn diagnosis(&self) -> &HealingDiagnosis {
        match self {
            Self::RuleBasedRetry { diagnosis }
            | Self::AiHealing { diagnosis }
            | Self::CreateIssue { diagnosis }
            | Self::CircuitBreakerTripped { diagnosis } => diagnosis,
        }
    }

    /// Whether this strategy involves an automatic retry (rule-based or AI).
    pub fn is_auto_action(&self) -> bool {
        matches!(self, Self::RuleBasedRetry { .. } | Self::AiHealing { .. })
    }
}

/// Inputs to the decision tree.
pub struct HealingContext<'a> {
    /// Error string from the failed execution.
    pub error: &'a str,
    /// Whether the execution timed out (pre-parsed flag).
    pub timed_out: bool,
    /// Whether a session limit was hit (pre-parsed flag).
    pub session_limit_reached: bool,
    /// Execution state string: "failed", "incomplete", etc.
    pub execution_state: &'a str,
    /// The persona's configured timeout in milliseconds.
    pub timeout_ms: u64,
    /// Number of recent consecutive failures for this persona.
    pub consecutive_failures: u32,
    /// Number of retries already attempted for this execution chain.
    pub retry_count: i64,
    /// Knowledge-base hint for this failure pattern.
    pub kb_hint: Option<&'a KnowledgeHint>,
    /// Whether the execution has a Claude session ID (needed for AI healing).
    pub has_session_id: bool,
    /// Whether the app is running in dev mode.
    pub is_dev_mode: bool,
}

/// Evaluate the healing decision tree and return the single strategy to apply.
///
/// This is a pure function with no side effects — callers are responsible for
/// executing the chosen strategy (spawning retries, creating issues, etc.).
pub fn evaluate(ctx: &HealingContext) -> HealingStrategy {
    // Step 1: Classify the error.
    let category = healing::classify_error(ctx.error, ctx.timed_out, ctx.session_limit_reached);

    // Step 2: Produce the rule-based diagnosis (always computed for issue creation).
    let diagnosis = healing::diagnose(
        &category,
        ctx.error,
        ctx.timeout_ms,
        ctx.consecutive_failures,
        ctx.retry_count,
        ctx.kb_hint,
    );

    // Step 3: Circuit breaker check — highest priority.
    // If the persona has too many consecutive failures, disable it.
    if ctx.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD {
        return HealingStrategy::CircuitBreakerTripped { diagnosis };
    }

    // Step 4: Rule-based retry — second priority.
    // Only for auto-fixable categories (RateLimit, Timeout) with retry budget.
    let auto_fixable = healing::is_auto_fixable(&category)
        && ctx.consecutive_failures < 3
        && ctx.retry_count < MAX_RETRY_COUNT;

    if auto_fixable {
        return HealingStrategy::RuleBasedRetry { diagnosis };
    }

    // Step 5: AI Healing — third priority.
    // Dev-mode only. Mutually exclusive with rule-based retry.
    if ctx.is_dev_mode && ctx.has_session_id
        && super::ai_healing::should_trigger_ai_healing(
            &category,
            ctx.execution_state,
            ctx.consecutive_failures,
        ) {
        return HealingStrategy::AiHealing { diagnosis };
    }

    // Step 6: Fallback — create an issue for manual investigation.
    HealingStrategy::CreateIssue { diagnosis }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn base_ctx() -> HealingContext<'static> {
        HealingContext {
            error: "",
            timed_out: false,
            session_limit_reached: false,
            execution_state: "failed",
            timeout_ms: 600_000,
            consecutive_failures: 0,
            retry_count: 0,
            kb_hint: None,
            has_session_id: false,
            is_dev_mode: false,
        }
    }

    // --- Circuit breaker (highest priority) ---

    #[test]
    fn circuit_breaker_takes_priority_over_auto_fix() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CircuitBreakerTripped { .. }));
    }

    #[test]
    fn circuit_breaker_takes_priority_over_ai_healing() {
        let ctx = HealingContext {
            error: "unknown error",
            consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
            is_dev_mode: true,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CircuitBreakerTripped { .. }));
    }

    // --- Rule-based retry (second priority) ---

    #[test]
    fn rate_limit_triggers_rule_based_retry() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::RuleBasedRetry { .. }));
    }

    #[test]
    fn timeout_triggers_rule_based_retry() {
        let ctx = HealingContext {
            error: "timed out",
            timed_out: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::RuleBasedRetry { .. }));
    }

    #[test]
    fn rate_limit_exhausted_retries_creates_issue() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            retry_count: MAX_RETRY_COUNT,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    #[test]
    fn rate_limit_with_many_consecutive_creates_issue() {
        // consecutive_failures >= 3 disables auto_fixable
        let ctx = HealingContext {
            error: "rate limit exceeded",
            consecutive_failures: 3,
            ..base_ctx()
        };
        // Not auto_fixable, no dev mode → CreateIssue
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    // --- Rule-based retry blocks AI healing (mutual exclusion) ---

    #[test]
    fn rule_based_retry_preempts_ai_healing() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            is_dev_mode: true,
            has_session_id: true,
            consecutive_failures: 2, // would trigger AI healing if not auto-fixable
            ..base_ctx()
        };
        // Rate limit is auto-fixable → rule-based retry wins
        assert!(matches!(evaluate(&ctx), HealingStrategy::RuleBasedRetry { .. }));
    }

    // --- AI healing (third priority) ---

    #[test]
    fn unknown_error_triggers_ai_healing_in_dev() {
        let ctx = HealingContext {
            error: "some random error",
            is_dev_mode: true,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::AiHealing { .. }));
    }

    #[test]
    fn credential_error_triggers_ai_healing_in_dev() {
        let ctx = HealingContext {
            error: "Invalid API key provided",
            is_dev_mode: true,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::AiHealing { .. }));
    }

    #[test]
    fn incomplete_state_triggers_ai_healing_in_dev() {
        let ctx = HealingContext {
            error: "some error",
            execution_state: "incomplete",
            is_dev_mode: true,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::AiHealing { .. }));
    }

    #[test]
    fn consecutive_failures_trigger_ai_healing_in_dev() {
        let ctx = HealingContext {
            error: "network error happened",
            consecutive_failures: 3, // >= 2 triggers AI healing for any category
            is_dev_mode: true,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::AiHealing { .. }));
    }

    #[test]
    fn ai_healing_requires_session_id() {
        let ctx = HealingContext {
            error: "some random error",
            is_dev_mode: true,
            has_session_id: false, // no session
            ..base_ctx()
        };
        // Falls through to CreateIssue
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    #[test]
    fn ai_healing_requires_dev_mode() {
        let ctx = HealingContext {
            error: "some random error",
            is_dev_mode: false,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    // --- Fallback to CreateIssue ---

    #[test]
    fn non_fixable_error_in_prod_creates_issue() {
        let ctx = HealingContext {
            error: "Claude CLI not found",
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    #[test]
    fn session_limit_creates_issue() {
        let ctx = HealingContext {
            error: "limit hit",
            session_limit_reached: true,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    // --- Strategy accessors ---

    #[test]
    fn diagnosis_accessor_works() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            ..base_ctx()
        };
        let strategy = evaluate(&ctx);
        assert!(!strategy.diagnosis().title.is_empty());
    }

    #[test]
    fn is_auto_action_correct() {
        let retry_ctx = HealingContext {
            error: "rate limit exceeded",
            ..base_ctx()
        };
        assert!(evaluate(&retry_ctx).is_auto_action());

        let issue_ctx = HealingContext {
            error: "Claude CLI not found",
            ..base_ctx()
        };
        assert!(!evaluate(&issue_ctx).is_auto_action());
    }
}
