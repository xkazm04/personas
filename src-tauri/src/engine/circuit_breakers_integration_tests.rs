//! Cross-breaker integration tests pinning the dual circuit-breaker contract.
//!
//! These tests live alongside the two breaker modules so they can exercise
//! both at once and catch regressions where one starts informing the other.
//! The full design contract is documented in
//! `docs/architecture/circuit-breakers.md`.
//!
//! Three scenarios are pinned here, one per axis of the contract:
//!
//! 1. **Provider down, persona healthy** — provider breaker trips while the
//!    persona-level orchestrator keeps issuing retry/healing strategies.
//! 2. **Persona broken, provider healthy** — persona breaker trips on
//!    accumulated failed runs while the provider breaker stays closed.
//! 3. **Both tripped** — both reach the open state and remain independent;
//!    closing one does not affect the other.

#![cfg(test)]

use super::failover::ProviderCircuitBreaker;
use super::healing_orchestrator::{
    self, HealingContext, HealingStrategy, CIRCUIT_BREAKER_THRESHOLD,
};
use super::provider::EngineKind;

/// Threshold the provider breaker uses internally. Kept in sync with
/// `failover::CIRCUIT_BREAKER_THRESHOLD` (which is private to that module).
const PROVIDER_BREAKER_THRESHOLD: u32 = 5;

fn persona_ctx(consecutive_failures: u32) -> HealingContext<'static> {
    HealingContext {
        // A non-auto-fixable error so the orchestrator's only knob is the
        // persona-level breaker count, not the rule-based retry path.
        error: "Claude CLI not found",
        timed_out: false,
        session_limit_reached: false,
        usage_limit: None,
        execution_state: "failed",
        timeout_ms: 600_000,
        consecutive_failures,
        retry_count: 0,
        kb_hint: None,
        has_session_id: false,
        is_dev_mode: false,
    }
}

#[test]
fn scenario_provider_down_with_healthy_persona() {
    // The provider takes 5 consecutive transport failures and opens.
    let provider_cb = ProviderCircuitBreaker::new();
    for _ in 0..PROVIDER_BREAKER_THRESHOLD {
        assert!(provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode));
        provider_cb.record_failure(EngineKind::ClaudeCode);
    }
    assert!(
        !provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode),
        "provider breaker must be open after threshold failures",
    );

    // Meanwhile a persona that has not yet accumulated failures of its
    // own keeps getting normal healing strategies — the orchestrator must
    // not cascade-disable based on provider state.
    let strategy = healing_orchestrator::evaluate(&persona_ctx(0));
    assert!(
        !matches!(strategy, HealingStrategy::CircuitBreakerTripped { .. }),
        "persona breaker must stay closed when only the provider tripped",
    );

    // And a persona at consecutive=4 (one below threshold) is still not
    // tripped, even with the provider open. This pins the no-cascade rule.
    let strategy = healing_orchestrator::evaluate(&persona_ctx(CIRCUIT_BREAKER_THRESHOLD - 1));
    assert!(
        !matches!(strategy, HealingStrategy::CircuitBreakerTripped { .. }),
        "persona breaker must not borrow the provider's count",
    );
}

#[test]
fn scenario_broken_persona_on_healthy_provider() {
    // Drive a healthy provider through many successful runs. The provider
    // breaker must stay closed regardless of how broken the persona is —
    // persona-level output failures never reach the provider breaker.
    let provider_cb = ProviderCircuitBreaker::new();
    for _ in 0..20 {
        assert!(provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode));
        provider_cb.record_success(EngineKind::ClaudeCode);
    }
    assert!(
        provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode),
        "provider breaker must remain available with only successes",
    );
    assert!(!provider_cb.is_globally_paused());

    // Persona crosses its threshold via the orchestrator's pure decision
    // function. The orchestrator returns CircuitBreakerTripped at >=5.
    let strategy = healing_orchestrator::evaluate(&persona_ctx(CIRCUIT_BREAKER_THRESHOLD));
    assert!(
        matches!(strategy, HealingStrategy::CircuitBreakerTripped { .. }),
        "persona breaker must trip once threshold is reached",
    );

    // Provider is unaffected — the persona breaker did not feed it.
    assert!(provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode));
}

#[test]
fn scenario_both_tripped_remain_independent() {
    // Provider takes its threshold of failures and opens.
    let provider_cb = ProviderCircuitBreaker::new();
    for _ in 0..PROVIDER_BREAKER_THRESHOLD {
        provider_cb.record_failure(EngineKind::ClaudeCode);
    }
    assert!(!provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode));

    // Persona tripped at the same threshold — independent count.
    let tripped = healing_orchestrator::evaluate(&persona_ctx(CIRCUIT_BREAKER_THRESHOLD));
    assert!(matches!(
        tripped,
        HealingStrategy::CircuitBreakerTripped { .. }
    ));

    // Closing the provider via record_success must NOT reset the persona.
    // The orchestrator is a pure read of the persona's recent-failures
    // count; it has no knowledge of provider state.
    provider_cb.record_success(EngineKind::ClaudeCode);
    assert!(
        provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode),
        "provider breaker should reset after success",
    );
    let still_tripped = healing_orchestrator::evaluate(&persona_ctx(CIRCUIT_BREAKER_THRESHOLD));
    assert!(
        matches!(still_tripped, HealingStrategy::CircuitBreakerTripped { .. }),
        "persona breaker must stay tripped — provider recovery is not a reset",
    );

    // Conversely, the persona being tripped does not gate the provider's
    // half-open probe. We simulate the cooldown path by re-failing the
    // provider and confirming it can still record state changes.
    for _ in 0..PROVIDER_BREAKER_THRESHOLD {
        provider_cb.record_failure(EngineKind::ClaudeCode);
    }
    assert!(
        !provider_cb.try_acquire_and_probe(EngineKind::ClaudeCode),
        "provider breaker re-opens regardless of persona state",
    );
}
