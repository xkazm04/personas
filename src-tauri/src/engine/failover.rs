//! Provider failover with circuit breaker.
//!
//! Provides automatic failover across providers and models when executions fail
//! due to retryable errors (rate limits, binary not found, session limits).
//! Implements a circuit breaker pattern: after N consecutive failures per provider,
//! the provider is "open" (skipped) for a cooldown period before probing again.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::byom::PolicyDecision;
use super::provider::EngineKind;
use super::types::ModelProfile;

// =============================================================================
// Constants
// =============================================================================

/// Consecutive failures before a provider circuit opens.
const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;

/// How long an open circuit stays open before allowing a probe request.
const CIRCUIT_COOLDOWN: Duration = Duration::from_secs(60);

/// Total failures across ALL providers within the rolling window before
/// the global breaker pauses all failover attempts.
const GLOBAL_FAILURE_THRESHOLD: u32 = 10;

/// Rolling time window for the global failure counter.
const GLOBAL_FAILURE_WINDOW: Duration = Duration::from_secs(120);

// =============================================================================
// Error classification
// =============================================================================

/// Classifies an execution error to determine if failover should be attempted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailoverReason {
    /// Provider binary not found (ENOENT).
    ProviderNotFound,
    /// Rate limit / session limit / quota exceeded.
    RateLimited,
    /// Execution timed out.
    Timeout,
}

/// Check if an error message indicates a retryable failure that should trigger failover.
pub fn classify_error(error: &str) -> Option<FailoverReason> {
    let lower = error.to_lowercase();

    // Binary not found
    if lower.contains("not found") && (lower.contains("install") || lower.contains("spawn")) {
        return Some(FailoverReason::ProviderNotFound);
    }

    // Rate / session / quota limits
    if lower.contains("rate limit")
        || lower.contains("session limit")
        || lower.contains("usage limit")
        || lower.contains("quota exceeded")
        || lower.contains("too many requests")
        || lower.contains("429")
    {
        return Some(FailoverReason::RateLimited);
    }

    // Timeout
    if lower.contains("timed out") {
        return Some(FailoverReason::Timeout);
    }

    None
}

// =============================================================================
// Circuit breaker state
// =============================================================================

#[derive(Debug, Clone, Default)]
struct CircuitState {
    /// Number of consecutive failures.
    consecutive_failures: u32,
    /// When the circuit was opened (None = closed).
    opened_at: Option<Instant>,
}

/// Global failure tracking state.
#[derive(Debug)]
struct GlobalState {
    /// Timestamps of recent failures across all providers, used as a rolling window.
    failure_times: Vec<Instant>,
    /// When the global breaker was tripped (None = not tripped).
    paused_at: Option<Instant>,
}

impl Default for GlobalState {
    fn default() -> Self {
        Self {
            failure_times: Vec::new(),
            paused_at: None,
        }
    }
}

/// Per-provider + global circuit breaker.
///
/// Thread-safe: all state is behind a single Mutex so `try_acquire` can
/// atomically check availability and reserve a slot, eliminating the TOCTOU
/// race between `is_available()` and the caller's use of the result.
///
/// The global failure counter tracks total failures across ALL providers
/// within a rolling window. When the threshold is reached, all failover
/// attempts are paused until the cooldown expires — preventing the failover
/// chain from amplifying load on already-stressed services.
pub struct ProviderCircuitBreaker {
    states: Mutex<(HashMap<EngineKind, CircuitState>, GlobalState)>,
}

impl ProviderCircuitBreaker {
    pub fn new() -> Self {
        Self {
            states: Mutex::new((HashMap::new(), GlobalState::default())),
        }
    }

    /// Atomically check if a provider is available and reserve a slot.
    ///
    /// Returns `true` if the provider can be used (circuit closed or cooldown
    /// elapsed AND global breaker not tripped). Returns `false` if the circuit
    /// is open or the global breaker is paused.
    ///
    /// This replaces the old `is_available()` to eliminate the TOCTOU race
    /// where another thread could open the circuit between check and use.
    pub fn try_acquire(&self, kind: EngineKind) -> bool {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref mut states, ref mut global) = *guard;

        // 1. Check global breaker first
        if let Some(paused_at) = global.paused_at {
            if paused_at.elapsed() < CIRCUIT_COOLDOWN {
                return false;
            }
            // Global cooldown elapsed — reset
            tracing::info!("Global circuit breaker reset after cooldown");
            global.paused_at = None;
            global.failure_times.clear();
        }

        // 2. Check per-provider circuit
        let state = states.entry(kind).or_default();
        match state.opened_at {
            None => true,
            Some(opened) => {
                if opened.elapsed() >= CIRCUIT_COOLDOWN {
                    // Cooldown elapsed — half-open: allow one probe
                    tracing::info!(
                        provider = ?kind,
                        "Circuit breaker half-open: allowing probe after cooldown",
                    );
                    state.opened_at = None;
                    state.consecutive_failures = 0;
                    true
                } else {
                    false
                }
            }
        }
    }

    /// Check if a provider is available (delegates to try_acquire).
    ///
    /// Kept for backward compatibility with callers that only need a read check.
    pub fn is_available(&self, kind: EngineKind) -> bool {
        self.try_acquire(kind)
    }

    /// Check if the global breaker is currently paused (all providers blocked).
    pub fn is_globally_paused(&self) -> bool {
        let guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (_, ref global) = *guard;
        match global.paused_at {
            Some(paused_at) => paused_at.elapsed() < CIRCUIT_COOLDOWN,
            None => false,
        }
    }

    /// Record a successful execution — resets the per-provider failure counter.
    pub fn record_success(&self, kind: EngineKind) {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref mut states, _) = *guard;
        let state = states.entry(kind).or_default();
        state.consecutive_failures = 0;
        state.opened_at = None;
    }

    /// Record a failure. Opens the per-provider circuit if its threshold is
    /// reached, and increments the global failure counter which may pause all
    /// providers.
    pub fn record_failure(&self, kind: EngineKind) {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref mut states, ref mut global) = *guard;

        // Per-provider tracking
        let state = states.entry(kind).or_default();
        state.consecutive_failures += 1;
        if state.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD && state.opened_at.is_none() {
            tracing::warn!(
                provider = ?kind,
                failures = state.consecutive_failures,
                "Circuit breaker opened for {:?} after {} consecutive failures",
                kind,
                state.consecutive_failures,
            );
            state.opened_at = Some(Instant::now());
        }

        // Global tracking: add timestamp and prune old entries outside the window
        let now = Instant::now();
        global.failure_times.push(now);
        global
            .failure_times
            .retain(|t| now.duration_since(*t) < GLOBAL_FAILURE_WINDOW);

        if global.failure_times.len() as u32 >= GLOBAL_FAILURE_THRESHOLD
            && global.paused_at.is_none()
        {
            tracing::warn!(
                total_failures = global.failure_times.len(),
                window_secs = GLOBAL_FAILURE_WINDOW.as_secs(),
                "Global circuit breaker tripped: {} failures across all providers in {}s — \
                 pausing all failover attempts",
                global.failure_times.len(),
                GLOBAL_FAILURE_WINDOW.as_secs(),
            );
            global.paused_at = Some(now);
        }
    }
}

impl Default for ProviderCircuitBreaker {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Failover candidate
// =============================================================================

/// A single failover candidate: a provider + optional model override.
#[derive(Debug, Clone)]
pub struct FailoverCandidate {
    pub engine_kind: EngineKind,
    /// Model to use (None = use persona's configured model or provider default).
    pub model: Option<String>,
    /// Human-readable label for logging.
    pub label: String,
}

// =============================================================================
// Model fallback chains per provider
// =============================================================================

/// Claude model fallback chain (higher capability → lower).
const CLAUDE_MODEL_CHAIN: &[&str] = &[
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
];

/// Build the complete failover chain given a primary engine and model profile.
///
/// Strategy:
/// 1. Try the primary provider with the configured model
/// 2. Try the primary provider with progressively smaller models (within-provider fallback)
/// 3. Try alternate providers with their default models
pub fn build_failover_chain(
    primary: EngineKind,
    model_profile: Option<&ModelProfile>,
) -> Vec<FailoverCandidate> {
    let mut chain = Vec::new();

    // 1. Primary provider with configured model
    let configured_model = model_profile.and_then(|p| p.model.clone()).filter(|m| !m.is_empty());
    chain.push(FailoverCandidate {
        engine_kind: primary,
        model: configured_model.clone(),
        label: format!("{primary:?} (configured)"),
    });

    // 2. Within-provider model fallback (Claude only — other providers have single model families)
    if primary == EngineKind::ClaudeCode {
        // Find where the configured model sits in the chain, add everything below it
        let start_idx = configured_model
            .as_deref()
            .and_then(|m| CLAUDE_MODEL_CHAIN.iter().position(|c| m.contains(c.split('-').nth(1).unwrap_or(""))))
            .map(|i| i + 1)  // skip the already-added configured model
            .unwrap_or(0);

        for &model in &CLAUDE_MODEL_CHAIN[start_idx..] {
            // Skip if it matches the already-added configured model
            if configured_model.as_deref() == Some(model) {
                continue;
            }
            chain.push(FailoverCandidate {
                engine_kind: EngineKind::ClaudeCode,
                model: Some(model.to_string()),
                label: format!("Claude ({})", model.split('-').nth(1).unwrap_or(model)),
            });
        }
    }

    // 3. Cross-provider failover: add alternate providers
    let alternates = match primary {
        EngineKind::ClaudeCode => vec![EngineKind::GeminiCli, EngineKind::CodexCli, EngineKind::CopilotCli],
        EngineKind::GeminiCli => vec![EngineKind::ClaudeCode, EngineKind::CodexCli, EngineKind::CopilotCli],
        EngineKind::CodexCli => vec![EngineKind::ClaudeCode, EngineKind::GeminiCli, EngineKind::CopilotCli],
        EngineKind::CopilotCli => vec![EngineKind::ClaudeCode, EngineKind::GeminiCli, EngineKind::CodexCli],
    };

    for alt in alternates {
        chain.push(FailoverCandidate {
            engine_kind: alt,
            model: None, // use provider default
            label: format!("{alt:?} (failover)"),
        });
    }

    chain
}

// =============================================================================
// BYOM-aware failover chain
// =============================================================================

/// Build the failover chain with BYOM policy applied.
///
/// If a policy decision has a preferred provider, it becomes the primary.
/// Blocked providers are filtered out of the chain entirely.
pub fn build_failover_chain_with_policy(
    primary: EngineKind,
    model_profile: Option<&ModelProfile>,
    policy: &PolicyDecision,
) -> Vec<FailoverCandidate> {
    // Determine effective primary: policy preference overrides configured primary
    let effective_primary = policy.preferred_provider.unwrap_or(primary);

    // Build effective model profile: policy model overrides configured model
    let effective_profile = if policy.preferred_model.is_some() {
        let mut p = model_profile.cloned().unwrap_or_default();
        p.model = policy.preferred_model.clone();
        Some(p)
    } else {
        model_profile.cloned()
    };

    // Build the base chain
    let base_chain = build_failover_chain(effective_primary, effective_profile.as_ref());

    // Filter out blocked providers
    base_chain
        .into_iter()
        .filter(|c| !policy.blocked_providers.contains(&c.engine_kind))
        .collect()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_error_not_found() {
        assert_eq!(
            classify_error("Claude Code not found. Please install it or select a different engine in Settings."),
            Some(FailoverReason::ProviderNotFound),
        );
        assert_eq!(
            classify_error("Failed to spawn Gemini CLI: not found"),
            Some(FailoverReason::ProviderNotFound),
        );
    }

    #[test]
    fn test_classify_error_rate_limit() {
        assert_eq!(classify_error("rate limit exceeded"), Some(FailoverReason::RateLimited));
        assert_eq!(classify_error("Session limit reached"), Some(FailoverReason::RateLimited));
        assert_eq!(classify_error("Usage Limit: quota exceeded"), Some(FailoverReason::RateLimited));
        assert_eq!(classify_error("Too many requests, slow down"), Some(FailoverReason::RateLimited));
        assert_eq!(classify_error("HTTP 429: rate limited"), Some(FailoverReason::RateLimited));
    }

    #[test]
    fn test_classify_error_timeout() {
        assert_eq!(classify_error("Execution timed out after 300s"), Some(FailoverReason::Timeout));
    }

    #[test]
    fn test_classify_error_non_retryable() {
        assert_eq!(classify_error("Syntax error in prompt"), None);
        assert_eq!(classify_error("Permission denied"), None);
    }

    #[test]
    fn test_circuit_breaker_starts_closed() {
        let cb = ProviderCircuitBreaker::new();
        assert!(cb.try_acquire(EngineKind::ClaudeCode));
        assert!(cb.try_acquire(EngineKind::GeminiCli));
        assert!(cb.try_acquire(EngineKind::CodexCli));
        assert!(!cb.is_globally_paused());
    }

    #[test]
    fn test_circuit_breaker_opens_after_threshold() {
        let cb = ProviderCircuitBreaker::new();
        for _ in 0..CIRCUIT_BREAKER_THRESHOLD {
            assert!(cb.try_acquire(EngineKind::ClaudeCode));
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // Circuit should now be open
        assert!(!cb.try_acquire(EngineKind::ClaudeCode));
        // Other providers unaffected
        assert!(cb.try_acquire(EngineKind::GeminiCli));
    }

    #[test]
    fn test_circuit_breaker_reset_on_success() {
        let cb = ProviderCircuitBreaker::new();
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // 4 failures, still under threshold
        assert!(cb.try_acquire(EngineKind::ClaudeCode));
        cb.record_success(EngineKind::ClaudeCode);
        // Counter reset, should be available
        assert!(cb.try_acquire(EngineKind::ClaudeCode));
    }

    #[test]
    fn test_global_breaker_trips_after_threshold() {
        let cb = ProviderCircuitBreaker::new();
        // Spread failures across multiple providers to hit the global threshold
        // without hitting any single provider's threshold (5)
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        for _ in 0..4 {
            cb.record_failure(EngineKind::GeminiCli);
        }
        // 8 total failures — still under global threshold (10)
        assert!(!cb.is_globally_paused());
        assert!(cb.try_acquire(EngineKind::CodexCli));

        // Push past global threshold
        cb.record_failure(EngineKind::CodexCli);
        cb.record_failure(EngineKind::CodexCli);
        // 10 total failures — global breaker should trip
        assert!(cb.is_globally_paused());

        // All providers should be blocked
        assert!(!cb.try_acquire(EngineKind::ClaudeCode));
        assert!(!cb.try_acquire(EngineKind::GeminiCli));
        assert!(!cb.try_acquire(EngineKind::CodexCli));
        assert!(!cb.try_acquire(EngineKind::CopilotCli));
    }

    #[test]
    fn test_global_breaker_does_not_trip_with_successes() {
        let cb = ProviderCircuitBreaker::new();
        // Record failures interleaved with successes
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        cb.record_success(EngineKind::ClaudeCode);
        for _ in 0..4 {
            cb.record_failure(EngineKind::GeminiCli);
        }
        // 8 total failures (successes don't reduce the global counter, but
        // we're still under 10)
        assert!(!cb.is_globally_paused());
    }

    #[test]
    fn test_failover_chain_claude_primary() {
        let chain = build_failover_chain(EngineKind::ClaudeCode, None);
        // Should have: Claude(configured) + Claude model fallbacks + Gemini + Codex + Copilot
        assert!(chain.len() >= 5);
        assert_eq!(chain[0].engine_kind, EngineKind::ClaudeCode);
        // Last three should be alternate providers
        let last_three: Vec<_> = chain.iter().rev().take(3).collect();
        assert!(last_three.iter().any(|c| c.engine_kind == EngineKind::GeminiCli));
        assert!(last_three.iter().any(|c| c.engine_kind == EngineKind::CodexCli));
        assert!(last_three.iter().any(|c| c.engine_kind == EngineKind::CopilotCli));
    }

    #[test]
    fn test_failover_chain_gemini_primary() {
        let chain = build_failover_chain(EngineKind::GeminiCli, None);
        assert_eq!(chain[0].engine_kind, EngineKind::GeminiCli);
        // No model-level fallback for Gemini, so alternates follow immediately
        assert_eq!(chain.len(), 4); // Gemini + Claude + Codex + Copilot
    }

    #[test]
    fn test_failover_chain_skips_configured_model() {
        let profile = ModelProfile {
            model: Some("claude-sonnet-4-20250514".into()),
            ..Default::default()
        };
        let chain = build_failover_chain(EngineKind::ClaudeCode, Some(&profile));
        // First should be configured (sonnet), then haiku, then alternates
        assert_eq!(chain[0].model.as_deref(), Some("claude-sonnet-4-20250514"));
        // Should not have sonnet duplicated
        let sonnet_count = chain.iter().filter(|c| c.model.as_deref() == Some("claude-sonnet-4-20250514")).count();
        assert_eq!(sonnet_count, 1);
    }
}
