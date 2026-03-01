//! Provider failover with circuit breaker.
//!
//! Provides automatic failover across providers and models when executions fail
//! due to retryable errors (rate limits, binary not found, session limits).
//! Implements a circuit breaker pattern: after N consecutive failures per provider,
//! the provider is "open" (skipped) for a cooldown period before probing again.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::provider::EngineKind;
use super::types::ModelProfile;

// =============================================================================
// Constants
// =============================================================================

/// Consecutive failures before a provider circuit opens.
const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;

/// How long an open circuit stays open before allowing a probe request.
const CIRCUIT_COOLDOWN: Duration = Duration::from_secs(60);

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

/// Per-provider circuit breaker.
///
/// Thread-safe: the inner state is behind a Mutex so multiple async tasks
/// (concurrent executions) can record failures and check availability.
pub struct ProviderCircuitBreaker {
    states: Mutex<HashMap<EngineKind, CircuitState>>,
}

impl ProviderCircuitBreaker {
    pub fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
        }
    }

    /// Check if a provider is available (circuit closed or cooldown elapsed).
    pub fn is_available(&self, kind: EngineKind) -> bool {
        let mut states = self.states.lock().unwrap();
        let state = states.entry(kind).or_default();
        match state.opened_at {
            None => true,
            Some(opened) => {
                let elapsed: Duration = opened.elapsed();
                if elapsed >= CIRCUIT_COOLDOWN {
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

    /// Record a successful execution — resets the failure counter.
    pub fn record_success(&self, kind: EngineKind) {
        let mut states = self.states.lock().unwrap();
        let state = states.entry(kind).or_default();
        state.consecutive_failures = 0;
        state.opened_at = None;
    }

    /// Record a failure. If threshold is reached, open the circuit.
    pub fn record_failure(&self, kind: EngineKind) {
        let mut states = self.states.lock().unwrap();
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
        label: format!("{:?} (configured)", primary),
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
        EngineKind::ClaudeCode => vec![EngineKind::GeminiCli, EngineKind::CodexCli],
        EngineKind::GeminiCli => vec![EngineKind::ClaudeCode, EngineKind::CodexCli],
        EngineKind::CodexCli => vec![EngineKind::ClaudeCode, EngineKind::GeminiCli],
    };

    for alt in alternates {
        chain.push(FailoverCandidate {
            engine_kind: alt,
            model: None, // use provider default
            label: format!("{:?} (failover)", alt),
        });
    }

    chain
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
        assert!(cb.is_available(EngineKind::ClaudeCode));
        assert!(cb.is_available(EngineKind::GeminiCli));
        assert!(cb.is_available(EngineKind::CodexCli));
    }

    #[test]
    fn test_circuit_breaker_opens_after_threshold() {
        let cb = ProviderCircuitBreaker::new();
        for _ in 0..CIRCUIT_BREAKER_THRESHOLD {
            assert!(cb.is_available(EngineKind::ClaudeCode));
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // Circuit should now be open
        assert!(!cb.is_available(EngineKind::ClaudeCode));
        // Other providers unaffected
        assert!(cb.is_available(EngineKind::GeminiCli));
    }

    #[test]
    fn test_circuit_breaker_reset_on_success() {
        let cb = ProviderCircuitBreaker::new();
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // 4 failures, still under threshold
        assert!(cb.is_available(EngineKind::ClaudeCode));
        cb.record_success(EngineKind::ClaudeCode);
        // Counter reset, should be available
        assert!(cb.is_available(EngineKind::ClaudeCode));
    }

    #[test]
    fn test_failover_chain_claude_primary() {
        let chain = build_failover_chain(EngineKind::ClaudeCode, None);
        // Should have: Claude(configured) + Claude model fallbacks + Gemini + Codex
        assert!(chain.len() >= 4);
        assert_eq!(chain[0].engine_kind, EngineKind::ClaudeCode);
        // Last two should be alternate providers
        let last_two: Vec<_> = chain.iter().rev().take(2).collect();
        assert!(last_two.iter().any(|c| c.engine_kind == EngineKind::GeminiCli));
        assert!(last_two.iter().any(|c| c.engine_kind == EngineKind::CodexCli));
    }

    #[test]
    fn test_failover_chain_gemini_primary() {
        let chain = build_failover_chain(EngineKind::GeminiCli, None);
        assert_eq!(chain[0].engine_kind, EngineKind::GeminiCli);
        // No model-level fallback for Gemini, so alternates follow immediately
        assert_eq!(chain.len(), 3); // Gemini + Claude + Codex
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
