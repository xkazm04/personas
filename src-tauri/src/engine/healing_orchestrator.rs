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
//! 2. **Rule-based retry** — exponential backoff (rate limit), timeout
//!    increase (timeout), or a durable `RetryAt` for environmental caps:
//!    usage-limit resets (`SessionLimit`) and Anthropic 5xx (`ApiError`,
//!    escalating 10/20/30 min, resumes the session). Applies for transient,
//!    auto-fixable categories when retry budget remains.
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
//! - **Auto-rollback and AI healing share the prompt columns — NOT independent.**
//!   Both `apply_db_fixes` (AI healing, `ai_healing.rs`) and `perform_rollback`
//!   (`auto_rollback.rs`) write `personas.system_prompt` / `structured_prompt`,
//!   so the old "they operate at different levels, therefore safe" claim was
//!   false — they hit the same two columns. Mutual exclusion is now enforced by
//!   the `healing_personas` slot: AI healing holds it for its whole session, and
//!   `auto_rollback_tick` acquires the SAME slot (via
//!   `ExecutionEngine::try_start_healing_blocking`) before calling
//!   `perform_rollback`, skipping any persona with an in-flight heal and
//!   releasing on every path. **Invariant: the two prompt writes can never
//!   interleave for one persona.**
//!
//!   RESOLVED: `apply_db_fixes` now snapshots the healed prompt as a new
//!   `persona_prompt_versions` row and promotes it to `production` (see
//!   `ai_healing::snapshot_healed_prompt`, called from `process_healing_result`
//!   whenever a fix mutates a prompt column). The heal is therefore a
//!   first-class version: auto-rollback's version-level error-rate metrics
//!   attribute post-heal executions to the healed version, and a rollback
//!   restores the healed prompt rather than reverting it to an older, pre-heal
//!   snapshot. The `healing_personas` slot above still prevents the concurrent
//!   prompt clobber; this closes the deferred version-visibility gap on top of
//!   it.
//!
//! - **The `healing_personas` lock** prevents concurrent AI healing sessions
//!   on the same persona — and now also blocks an auto-rollback prompt write
//!   from racing an in-flight heal (see above).
//!
//! # Circuit Breaker (persona-level)
//!
//! After `CIRCUIT_BREAKER_THRESHOLD` (5) consecutive failures, the persona
//! is disabled entirely. This takes priority over all strategies — no retry
//! or AI healing is attempted once the breaker trips.
//!
//! Note: this is the **persona-level** breaker. A separate **provider-level**
//! breaker lives in [`super::failover`] and gates the runner's failover chain
//! per `EngineKind`. The two are independent — they share no state, and
//! tripping one never trips or resets the other. See
//! `docs/architecture/circuit-breakers.md` for the full contract,
//! precedence, and reset paths.

use super::healing::{
    self, FailureCategory, HealingAction, HealingDiagnosis, KnowledgeHint, UsageLimitInfo,
    MAX_RETRY_COUNT,
};

/// Threshold of consecutive failures before the persona-level circuit breaker
/// trips and disables the persona.
pub const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;

/// The single healing strategy selected for a failure event.
#[derive(Debug, Clone)]
pub enum HealingStrategy {
    /// Rule-based retry: backoff or timeout increase.
    /// The caller should spawn a retry execution after the prescribed delay.
    RuleBasedRetry { diagnosis: HealingDiagnosis },
    /// AI-powered healing: resume the original session to diagnose and fix.
    /// Only valid in dev-mode and when a session ID is available.
    AiHealing { diagnosis: HealingDiagnosis },
    /// No automated healing — create an issue for manual investigation.
    CreateIssue { diagnosis: HealingDiagnosis },
    /// Persona disabled by circuit breaker — no healing attempted.
    CircuitBreakerTripped { diagnosis: HealingDiagnosis },
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
    /// Error string from the failed execution. Retained for diagnosis text
    /// (issue descriptions, suggested fixes) — NOT re-classified here.
    pub error: &'a str,
    /// The failure category, classified **once** upstream on the failure path
    /// (`evaluate_healing_and_retry` in `engine::mod`, via
    /// [`healing::classify_error`] with the pre-parsed `timed_out` /
    /// `session_limit_reached` flags). The decision tree consumes this instead
    /// of re-running the string ladder — one classification, consumed
    /// everywhere. The same value flows into the knowledge-base hint lookup and
    /// the manual-review suppression check, so the whole healing path sees a
    /// single, consistent category.
    pub category: FailureCategory,
    /// Parsed usage-limit details (scope + reset time) when the failure was a
    /// provider usage cap. Enables the durable retry-at-reset path.
    pub usage_limit: Option<&'a UsageLimitInfo>,
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
    // Step 1: Consume the category classified once upstream (no re-parse here).
    let category = ctx.category;

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

    // Step 3.5: Usage-limit override. A parsed provider usage cap replaces the
    // generic SessionLimit→CreateIssue rule: window caps get a durable retry
    // at the reset time, weekly caps a flavored issue. Deliberately NOT gated
    // on `consecutive_failures < 3` — usage limits are environmental (every
    // run in the window fails), and piling failures doesn't make a retry at
    // reset time any less likely to succeed. The circuit breaker above still
    // wins as the safety valve.
    if let Some(ul) = ctx.usage_limit {
        let diagnosis = healing::usage_limit_diagnosis(ul, ctx.error, ctx.retry_count);
        return match diagnosis.action {
            HealingAction::RetryAt { .. } => HealingStrategy::RuleBasedRetry { diagnosis },
            _ => HealingStrategy::CreateIssue { diagnosis },
        };
    }

    // Step 3.6: API / server error (Anthropic 5xx / overloaded). `diagnose`
    // produced either a durable escalating `RetryAt` (resume the session and
    // continue — see `healing::diagnose`'s ApiError arm) or, once the per-chain
    // retry budget is spent, `CreateIssue`. Like usage limits these failures are
    // environmental (the provider is mid-incident), so we deliberately DON'T
    // gate on `consecutive_failures < 3`; the circuit breaker (step 3) remains
    // the safety valve that stops a persona hammering a sustained outage.
    if matches!(category, FailureCategory::ApiError) {
        return match diagnosis.action {
            HealingAction::RetryAt { .. } => HealingStrategy::RuleBasedRetry { diagnosis },
            _ => HealingStrategy::CreateIssue { diagnosis },
        };
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
    if ctx.is_dev_mode
        && ctx.has_session_id
        && super::ai_healing::should_trigger_ai_healing(
            &category,
            ctx.execution_state,
            ctx.consecutive_failures,
        )
    {
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

    /// Base context. `category` defaults to `Unknown`; tests that exercise a
    /// specific category set it explicitly (mirroring how `mod::evaluate_healing_and_retry`
    /// classifies once upstream and threads the result in). `error` is kept only
    /// for the diagnosis text — the decision tree keys off `category`.
    fn base_ctx() -> HealingContext<'static> {
        HealingContext {
            error: "",
            category: FailureCategory::Unknown,
            usage_limit: None,
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
            category: FailureCategory::RateLimit,
            consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CircuitBreakerTripped { .. }
        ));
    }

    #[test]
    fn circuit_breaker_takes_priority_over_ai_healing() {
        let ctx = HealingContext {
            error: "unknown error",
            category: FailureCategory::Unknown,
            consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
            is_dev_mode: true,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CircuitBreakerTripped { .. }
        ));
    }

    // --- Rule-based retry (second priority) ---

    #[test]
    fn rate_limit_triggers_rule_based_retry() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::RateLimit,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::RuleBasedRetry { .. }
        ));
    }

    #[test]
    fn timeout_triggers_rule_based_retry() {
        let ctx = HealingContext {
            error: "timed out",
            category: FailureCategory::Timeout,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::RuleBasedRetry { .. }
        ));
    }

    #[test]
    fn rate_limit_exhausted_retries_creates_issue() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::RateLimit,
            retry_count: MAX_RETRY_COUNT,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    #[test]
    fn rate_limit_with_many_consecutive_creates_issue() {
        // consecutive_failures >= 3 disables auto_fixable
        let ctx = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::RateLimit,
            consecutive_failures: 3,
            ..base_ctx()
        };
        // Not auto_fixable, no dev mode → CreateIssue
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    // --- Rule-based retry blocks AI healing (mutual exclusion) ---

    #[test]
    fn rule_based_retry_preempts_ai_healing() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::RateLimit,
            is_dev_mode: true,
            has_session_id: true,
            consecutive_failures: 2, // would trigger AI healing if not auto-fixable
            ..base_ctx()
        };
        // Rate limit is auto-fixable → rule-based retry wins
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::RuleBasedRetry { .. }
        ));
    }

    // --- AI healing (third priority) ---

    #[test]
    fn unknown_error_triggers_ai_healing_in_dev() {
        let ctx = HealingContext {
            error: "some random error",
            category: FailureCategory::Unknown,
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
            category: FailureCategory::CredentialError,
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
            category: FailureCategory::Unknown,
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
            category: FailureCategory::Network,
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
            category: FailureCategory::Unknown,
            is_dev_mode: true,
            has_session_id: false, // no session
            ..base_ctx()
        };
        // Falls through to CreateIssue
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    #[test]
    fn ai_healing_requires_dev_mode() {
        let ctx = HealingContext {
            error: "some random error",
            category: FailureCategory::Unknown,
            is_dev_mode: false,
            has_session_id: true,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    // --- Fallback to CreateIssue ---

    #[test]
    fn non_fixable_error_in_prod_creates_issue() {
        let ctx = HealingContext {
            error: "Claude CLI not found",
            category: FailureCategory::ProviderNotFound,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    #[test]
    fn session_limit_creates_issue() {
        let ctx = HealingContext {
            error: "limit hit",
            category: FailureCategory::SessionLimit,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    // --- Strategy accessors ---

    #[test]
    fn diagnosis_accessor_works() {
        let ctx = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::RateLimit,
            ..base_ctx()
        };
        let strategy = evaluate(&ctx);
        assert!(!strategy.diagnosis().title.is_empty());
    }

    #[test]
    fn is_auto_action_correct() {
        let retry_ctx = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::RateLimit,
            ..base_ctx()
        };
        assert!(evaluate(&retry_ctx).is_auto_action());

        let issue_ctx = HealingContext {
            error: "Claude CLI not found",
            category: FailureCategory::ProviderNotFound,
            ..base_ctx()
        };
        assert!(!evaluate(&issue_ctx).is_auto_action());
    }

    // --- Threading: the provided category drives the decision, not `error` ---

    #[test]
    fn provided_category_drives_decision_not_error_string() {
        // The error string is opaque (would classify as `Unknown` → CreateIssue
        // in prod), but the pre-computed category says RateLimit. If the
        // orchestrator re-parsed `error` it would create an issue; because it
        // consumes the threaded `category`, it schedules a rule-based retry.
        // This is the guard that proves classification happens once upstream.
        let ctx = HealingContext {
            error: "an entirely opaque failure the ladder cannot bucket",
            category: FailureCategory::RateLimit,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::RuleBasedRetry { .. }
        ));

        // And the inverse: a rate-limit-looking string but a Timeout category
        // still follows the category (timeout → RetryWithTimeout, also a
        // RuleBasedRetry) — proving the string is never consulted for the branch.
        let ctx2 = HealingContext {
            error: "rate limit exceeded",
            category: FailureCategory::Timeout,
            ..base_ctx()
        };
        let strategy = evaluate(&ctx2);
        assert!(matches!(strategy, HealingStrategy::RuleBasedRetry { .. }));
        assert!(matches!(
            strategy.diagnosis().action,
            HealingAction::RetryWithTimeout { .. }
        ));
    }

    // --- Usage-limit override (step 3.5) ---

    use super::super::healing::{UsageLimitInfo, UsageLimitScope};

    #[test]
    fn window_usage_limit_schedules_retry_even_with_consecutive_failures() {
        let ul = UsageLimitInfo {
            scope: UsageLimitScope::Window,
            resets_at: None,
        };
        // consecutive_failures = 3 would block the regular auto-fix gate, but
        // usage limits are environmental — the retry-at-reset still applies.
        let ctx = HealingContext {
            error: "Claude usage limit reached (rolling window)",
            category: FailureCategory::SessionLimit,
            usage_limit: Some(&ul),
            consecutive_failures: 3,
            ..base_ctx()
        };
        let strategy = evaluate(&ctx);
        assert!(matches!(strategy, HealingStrategy::RuleBasedRetry { .. }));
        assert!(matches!(
            strategy.diagnosis().action,
            HealingAction::RetryAt { .. }
        ));
    }

    #[test]
    fn weekly_usage_limit_creates_issue() {
        let ul = UsageLimitInfo {
            scope: UsageLimitScope::Weekly,
            resets_at: None,
        };
        let ctx = HealingContext {
            error: "Claude weekly usage limit reached",
            category: FailureCategory::SessionLimit,
            usage_limit: Some(&ul),
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    #[test]
    fn circuit_breaker_still_beats_usage_limit_retry() {
        let ul = UsageLimitInfo {
            scope: UsageLimitScope::Window,
            resets_at: None,
        };
        let ctx = HealingContext {
            error: "Claude usage limit reached (rolling window)",
            category: FailureCategory::SessionLimit,
            usage_limit: Some(&ul),
            consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CircuitBreakerTripped { .. }
        ));
    }

    #[test]
    fn window_usage_limit_with_exhausted_budget_creates_issue() {
        let ul = UsageLimitInfo {
            scope: UsageLimitScope::Window,
            resets_at: None,
        };
        let ctx = HealingContext {
            error: "Claude usage limit reached (rolling window)",
            category: FailureCategory::SessionLimit,
            usage_limit: Some(&ul),
            retry_count: MAX_RETRY_COUNT,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CreateIssue { .. }
        ));
    }

    // --- API / server error (Anthropic 5xx) override (step 3.6) ----------

    #[test]
    fn api_error_with_budget_schedules_resume_retry() {
        let ctx = HealingContext {
            error: "HTTP 500 internal server error",
            category: FailureCategory::ApiError,
            ..base_ctx()
        };
        let strategy = evaluate(&ctx);
        assert!(matches!(strategy, HealingStrategy::RuleBasedRetry { .. }));
        assert!(matches!(
            strategy.diagnosis().action,
            HealingAction::RetryAt { .. }
        ));
    }

    #[test]
    fn api_error_exhausted_creates_issue() {
        let ctx = HealingContext {
            error: "503 service unavailable",
            category: FailureCategory::ApiError,
            retry_count: MAX_RETRY_COUNT,
            ..base_ctx()
        };
        assert!(matches!(evaluate(&ctx), HealingStrategy::CreateIssue { .. }));
    }

    #[test]
    fn api_error_schedules_retry_despite_consecutive_failures() {
        // Environmental — not gated on `consecutive_failures < 3`, but the
        // circuit breaker at THRESHOLD still wins (covered separately).
        let ctx = HealingContext {
            error: "internal server error",
            category: FailureCategory::ApiError,
            consecutive_failures: 3,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::RuleBasedRetry { .. }
        ));
    }

    #[test]
    fn circuit_breaker_still_beats_api_error_retry() {
        let ctx = HealingContext {
            error: "HTTP 500 internal server error",
            category: FailureCategory::ApiError,
            consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
            ..base_ctx()
        };
        assert!(matches!(
            evaluate(&ctx),
            HealingStrategy::CircuitBreakerTripped { .. }
        ));
    }
}
