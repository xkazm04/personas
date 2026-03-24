//! Provider failover with circuit breaker.
//!
//! Provides automatic failover across providers and models when executions fail
//! due to retryable errors (rate limits, binary not found, session limits).
//! Implements a circuit breaker pattern: after N consecutive failures per provider,
//! the provider is "open" (skipped) for a cooldown period before probing again.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::Serialize;
use ts_rs::TS;

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

/// Maximum number of state transitions to retain in history.
const TRANSITION_HISTORY_CAPACITY: usize = 50;

/// Rolling window for trip count tracking (1 hour).
const TRIP_COUNT_WINDOW: Duration = Duration::from_secs(3600);

// =============================================================================
// Error classification (delegated to unified error_taxonomy)
// =============================================================================

use super::error_taxonomy::{self, ErrorCategory};

/// Legacy alias — use [`ErrorCategory`] directly in new code.
#[allow(dead_code)]
pub type FailoverReason = ErrorCategory;

/// Counter for errors that did not match any known failover pattern.
static FAILOVER_UNCLASSIFIED_ERRORS: AtomicU64 = AtomicU64::new(0);

/// Returns the cumulative count of errors that `classify_error` could not
/// classify. Useful for diagnostics and deciding when to add new patterns.
#[allow(dead_code)]
pub fn unclassified_error_count() -> u64 {
    FAILOVER_UNCLASSIFIED_ERRORS.load(Ordering::Relaxed)
}

/// Check if an error message indicates a retryable failure that should trigger failover.
///
/// Returns `Some(ErrorCategory)` for failover-eligible errors, `None` otherwise.
pub fn classify_error(error: &str) -> Option<ErrorCategory> {
    let category = error_taxonomy::classify_error_str(error);

    if error_taxonomy::is_failover_eligible(&category) {
        return Some(category);
    }

    // No known failover pattern matched — log for observability.
    let count = FAILOVER_UNCLASSIFIED_ERRORS.fetch_add(1, Ordering::Relaxed) + 1;
    tracing::debug!(
        event = "failover.unclassified_error",
        error = %error,
        category = ?category,
        cumulative_count = count,
        "Error not eligible for failover",
    );

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
#[derive(Debug, Default)]
struct GlobalState {
    /// Recent failures across all providers: `(timestamp, provider)` for the rolling window.
    failure_times: Vec<(Instant, EngineKind)>,
    /// When the global breaker was tripped (None = not tripped).
    paused_at: Option<Instant>,
}


// =============================================================================
// Diagnostic status types (exported to frontend via ts-rs)
// =============================================================================

/// Per-provider circuit state snapshot for diagnostics.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCircuitState {
    pub provider: String,
    pub consecutive_failures: u32,
    pub is_open: bool,
    pub cooldown_remaining_secs: f64,
    /// Number of times this provider's circuit has tripped within the last hour.
    pub trip_count_1h: u32,
}

/// A single circuit breaker state transition event.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircuitTransitionEvent {
    /// Provider name (e.g. "claude_code") or "global" for the global breaker.
    pub provider: String,
    /// Previous state: "closed", "open", "half_open", "paused".
    pub from_state: String,
    /// New state.
    pub to_state: String,
    /// ISO-8601 timestamp of the transition.
    pub timestamp: String,
    /// Consecutive failures at the time of transition (0 for global).
    pub failure_count: u32,
}

/// Full circuit breaker status snapshot.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CircuitBreakerStatus {
    pub providers: Vec<ProviderCircuitState>,
    pub global_paused: bool,
    pub global_cooldown_remaining_secs: f64,
    pub global_failure_count: u32,
    /// Recent state transitions (newest first), capped at 50.
    pub recent_transitions: Vec<CircuitTransitionEvent>,
}

/// Per-provider + global circuit breaker.
///
/// Thread-safe: all state is behind a single Mutex so `try_acquire` can
/// atomically check availability and reserve a slot, eliminating the TOCTOU
/// race between `is_available()` and the caller's use of the result.
///
/// The global failure counter tracks total failures across ALL providers
/// within a rolling window. When the threshold is reached, all failover
/// attempts are paused until the cooldown expires -- preventing the failover
/// chain from amplifying load on already-stressed services.
pub struct ProviderCircuitBreaker {
    states: Mutex<(HashMap<EngineKind, CircuitState>, GlobalState, TransitionHistory)>,
}

/// Internal history buffer for transition events.
#[derive(Debug, Default)]
struct TransitionHistory {
    /// Ring buffer of recent transitions (newest at front).
    events: VecDeque<CircuitTransitionEvent>,
    /// Per-provider trip timestamps within the rolling window (for trip_count_1h).
    trip_times: HashMap<String, Vec<Instant>>,
}

impl ProviderCircuitBreaker {
    pub fn new() -> Self {
        Self {
            states: Mutex::new((HashMap::new(), GlobalState::default(), TransitionHistory::default())),
        }
    }

    /// Push a transition event into the history ring buffer and record trip timestamps.
    fn push_transition(history: &mut TransitionHistory, event: CircuitTransitionEvent) {
        // Track trip times for trip_count_1h (only when a circuit opens)
        if event.to_state == "open" || event.to_state == "paused" {
            history
                .trip_times
                .entry(event.provider.clone())
                .or_default()
                .push(Instant::now());
        }
        history.events.push_front(event);
        if history.events.len() > TRANSITION_HISTORY_CAPACITY {
            history.events.pop_back();
        }
    }

    /// Count how many times a provider tripped within the last hour.
    fn trip_count_1h(history: &mut TransitionHistory, provider: &str) -> u32 {
        if let Some(times) = history.trip_times.get_mut(provider) {
            times.retain(|t| t.elapsed() < TRIP_COUNT_WINDOW);
            times.len() as u32
        } else {
            0
        }
    }

    fn now_iso() -> String {
        Utc::now().to_rfc3339()
    }

    /// Atomically check if a provider is available, and if a cooled-down circuit
    /// is found, transition it to half-open (reset state) to allow a probe request.
    ///
    /// **This method mutates state**: when a per-provider or global cooldown has
    /// elapsed, it resets `opened_at`, `consecutive_failures`, and `paused_at`.
    /// Calling it twice for the same provider may yield different results (first
    /// call resets, second sees clean state). Use `is_available()` for a pure
    /// read-only check that does not reset circuit state.
    ///
    /// Returns `true` if the provider can be used (circuit closed or cooldown
    /// elapsed AND global breaker not tripped). Returns `false` if the circuit
    /// is open or the global breaker is paused.
    pub fn try_acquire_and_probe(&self, kind: EngineKind) -> bool {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref mut states, ref mut global, ref mut history) = *guard;

        // 1. Check global breaker first
        if let Some(paused_at) = global.paused_at {
            if paused_at.elapsed() < CIRCUIT_COOLDOWN {
                return false;
            }
            // Global cooldown elapsed -- reset
            tracing::info!(
                event = "circuit_breaker.global.closed",
                transition = "paused -> closed",
                "Global circuit breaker reset after cooldown",
            );
            Self::push_transition(history, CircuitTransitionEvent {
                provider: "global".into(),
                from_state: "paused".into(),
                to_state: "closed".into(),
                timestamp: Self::now_iso(),
                failure_count: 0,
            });
            global.paused_at = None;
            global.failure_times.clear();
        }

        // 2. Check per-provider circuit
        let state = states.entry(kind).or_default();
        match state.opened_at {
            None => true,
            Some(opened) => {
                if opened.elapsed() >= CIRCUIT_COOLDOWN {
                    // Cooldown elapsed -- half-open: allow one probe
                    tracing::info!(
                        event = "circuit_breaker.provider.half_open",
                        provider = ?kind,
                        transition = "open -> half_open",
                        "Circuit breaker half-open: allowing probe after cooldown",
                    );
                    Self::push_transition(history, CircuitTransitionEvent {
                        provider: kind.as_setting().to_string(),
                        from_state: "open".into(),
                        to_state: "half_open".into(),
                        timestamp: Self::now_iso(),
                        failure_count: state.consecutive_failures,
                    });
                    state.opened_at = None;
                    state.consecutive_failures = 0;
                    true
                } else {
                    false
                }
            }
        }
    }

    /// Pure read-only check: is the provider currently available?
    ///
    /// Unlike `try_acquire_and_probe()`, this does NOT reset circuit state when
    /// cooldowns expire. Use this for monitoring/display; use
    /// `try_acquire_and_probe()` when you intend to actually send a request.
    #[allow(dead_code)]
    pub fn is_available(&self, kind: EngineKind) -> bool {
        let guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref states, ref global, _) = *guard;

        // Global pause check
        if let Some(paused_at) = global.paused_at {
            if paused_at.elapsed() < CIRCUIT_COOLDOWN {
                return false;
            }
        }

        // Per-provider check
        match states.get(&kind) {
            None => true,
            Some(state) => match state.opened_at {
                None => true,
                Some(opened) => opened.elapsed() >= CIRCUIT_COOLDOWN,
            },
        }
    }

    /// Check if the global breaker is currently paused (all providers blocked).
    pub fn is_globally_paused(&self) -> bool {
        let guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (_, ref global, _) = *guard;
        match global.paused_at {
            Some(paused_at) => paused_at.elapsed() < CIRCUIT_COOLDOWN,
            None => false,
        }
    }

    /// Return a snapshot of the current circuit breaker state for diagnostics.
    pub fn get_status(&self) -> CircuitBreakerStatus {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref states, ref global, ref mut history) = *guard;

        let global_paused = match global.paused_at {
            Some(paused_at) => paused_at.elapsed() < CIRCUIT_COOLDOWN,
            None => false,
        };
        let global_cooldown_remaining_secs = match global.paused_at {
            Some(paused_at) if paused_at.elapsed() < CIRCUIT_COOLDOWN => {
                (CIRCUIT_COOLDOWN - paused_at.elapsed()).as_secs_f64()
            }
            _ => 0.0,
        };

        let all_kinds = [
            EngineKind::ClaudeCode,
            EngineKind::CodexCli,
        ];

        let providers = all_kinds
            .iter()
            .map(|&kind| {
                let (consecutive_failures, is_open, cooldown_remaining_secs) =
                    match states.get(&kind) {
                        None => (0, false, 0.0),
                        Some(state) => {
                            let open = state.opened_at.is_some()
                                && state
                                    .opened_at
                                    .map(|t| t.elapsed() < CIRCUIT_COOLDOWN)
                                    .unwrap_or(false);
                            let remaining = state
                                .opened_at
                                .filter(|t| t.elapsed() < CIRCUIT_COOLDOWN)
                                .map(|t| (CIRCUIT_COOLDOWN - t.elapsed()).as_secs_f64())
                                .unwrap_or(0.0);
                            (state.consecutive_failures, open, remaining)
                        }
                    };

                let trip_count_1h = Self::trip_count_1h(history, kind.as_setting());

                ProviderCircuitState {
                    provider: kind.as_setting().to_string(),
                    consecutive_failures,
                    is_open,
                    cooldown_remaining_secs,
                    trip_count_1h,
                }
            })
            .collect();

        let recent_transitions = history.events.iter().cloned().collect();

        CircuitBreakerStatus {
            providers,
            global_paused,
            global_cooldown_remaining_secs,
            global_failure_count: global.failure_times.len() as u32,
            recent_transitions,
        }
    }

    /// Record a successful execution -- resets the per-provider failure counter
    /// and removes one of that provider's entries from the global failure window.
    ///
    /// Only the most recent failure for this provider is removed (1:1 offset).
    /// This prevents a single lucky success from purging the entire failure
    /// history, which could mask systemic failures across other providers and
    /// stop the global breaker from ever tripping.
    pub fn record_success(&self, kind: EngineKind) {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref mut states, ref mut global, ref mut history) = *guard;
        let state = states.entry(kind).or_default();
        let was_open = state.opened_at.is_some();
        state.consecutive_failures = 0;
        state.opened_at = None;

        if was_open {
            tracing::info!(
                event = "circuit_breaker.provider.closed",
                provider = ?kind,
                transition = "half_open -> closed",
                "Circuit breaker closed for {:?} after successful probe",
                kind,
            );
            Self::push_transition(history, CircuitTransitionEvent {
                provider: kind.as_setting().to_string(),
                from_state: "half_open".into(),
                to_state: "closed".into(),
                timestamp: Self::now_iso(),
                failure_count: 0,
            });
        }

        // Remove at most one failure entry for this provider (the most recent).
        // A single success offsets one failure rather than purging all, so that
        // intermittent successes on one provider cannot mask cascading failures
        // across the fleet.
        if let Some(pos) = global.failure_times.iter().rposition(|(_, k)| *k == kind) {
            global.failure_times.remove(pos);
        }
    }

    /// Record a failure. Opens the per-provider circuit if its threshold is
    /// reached, and increments the global failure counter which may pause all
    /// providers.
    ///
    /// Returns a list of transition events that occurred (0–2 events: possibly
    /// a per-provider open + a global pause). Callers with access to an
    /// `AppHandle` should emit these as Tauri events.
    pub fn record_failure(&self, kind: EngineKind) -> Vec<CircuitTransitionEvent> {
        let mut guard = self.states.lock().unwrap_or_else(|e| e.into_inner());
        let (ref mut states, ref mut global, ref mut history) = *guard;
        let mut transitions = Vec::new();

        // Per-provider tracking
        let state = states.entry(kind).or_default();
        state.consecutive_failures += 1;
        if state.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD && state.opened_at.is_none() {
            tracing::warn!(
                event = "circuit_breaker.provider.opened",
                provider = ?kind,
                failures = state.consecutive_failures,
                transition = "closed -> open",
                cooldown_secs = CIRCUIT_COOLDOWN.as_secs(),
                "Circuit breaker opened for {:?} after {} consecutive failures",
                kind,
                state.consecutive_failures,
            );
            state.opened_at = Some(Instant::now());
            let event = CircuitTransitionEvent {
                provider: kind.as_setting().to_string(),
                from_state: "closed".into(),
                to_state: "open".into(),
                timestamp: Self::now_iso(),
                failure_count: state.consecutive_failures,
            };
            Self::push_transition(history, event.clone());
            transitions.push(event);
        }

        // Global tracking: add timestamp and prune old entries outside the window
        let now = Instant::now();
        global.failure_times.push((now, kind));
        global
            .failure_times
            .retain(|(t, _)| now.duration_since(*t) < GLOBAL_FAILURE_WINDOW);

        if global.failure_times.len() as u32 >= GLOBAL_FAILURE_THRESHOLD
            && global.paused_at.is_none()
        {
            tracing::warn!(
                event = "circuit_breaker.global.opened",
                transition = "closed -> paused",
                total_failures = global.failure_times.len(),
                window_secs = GLOBAL_FAILURE_WINDOW.as_secs(),
                cooldown_secs = CIRCUIT_COOLDOWN.as_secs(),
                "Global circuit breaker tripped: {} failures across all providers in {}s -- \
                 pausing all failover attempts",
                global.failure_times.len(),
                GLOBAL_FAILURE_WINDOW.as_secs(),
            );
            global.paused_at = Some(now);
            let event = CircuitTransitionEvent {
                provider: "global".into(),
                from_state: "closed".into(),
                to_state: "paused".into(),
                timestamp: Self::now_iso(),
                failure_count: global.failure_times.len() as u32,
            };
            Self::push_transition(history, event.clone());
            transitions.push(event);
        }

        transitions
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

/// Claude model fallback chain (higher capability -> lower).
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

    // 2. Within-provider model fallback (Claude only -- other providers have single model families)
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
        EngineKind::ClaudeCode => vec![EngineKind::CodexCli],
        EngineKind::CodexCli => vec![EngineKind::ClaudeCode],
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
            Some(ErrorCategory::ProviderNotFound),
        );
        assert_eq!(
            classify_error("Failed to spawn CLI: not found"),
            Some(ErrorCategory::ProviderNotFound),
        );
    }

    #[test]
    fn test_classify_error_rate_limit() {
        assert_eq!(classify_error("rate limit exceeded"), Some(ErrorCategory::RateLimit));
        assert_eq!(classify_error("Session limit reached"), Some(ErrorCategory::SessionLimit));
        assert_eq!(classify_error("Usage Limit: quota exceeded"), Some(ErrorCategory::RateLimit));
        assert_eq!(classify_error("Too many requests, slow down"), Some(ErrorCategory::RateLimit));
        assert_eq!(classify_error("HTTP 429: rate limited"), Some(ErrorCategory::RateLimit));
    }

    #[test]
    fn test_classify_error_timeout() {
        assert_eq!(classify_error("Execution timed out after 300s"), Some(ErrorCategory::Timeout));
    }

    #[test]
    fn test_classify_error_non_retryable() {
        assert_eq!(classify_error("Syntax error in prompt"), None);
        assert_eq!(classify_error("Permission denied"), None);
    }

    #[test]
    fn test_unclassified_error_counter_increments() {
        let before = unclassified_error_count();
        classify_error("some billing issue suspended");
        let after = unclassified_error_count();
        assert!(after >= before + 1, "unclassified counter should increment for unknown patterns");
    }

    #[test]
    fn test_circuit_breaker_starts_closed() {
        let cb = ProviderCircuitBreaker::new();
        assert!(cb.try_acquire_and_probe(EngineKind::ClaudeCode));
        assert!(cb.try_acquire_and_probe(EngineKind::CodexCli));
        assert!(!cb.is_globally_paused());
    }

    #[test]
    fn test_circuit_breaker_opens_after_threshold() {
        let cb = ProviderCircuitBreaker::new();
        for _ in 0..CIRCUIT_BREAKER_THRESHOLD {
            assert!(cb.try_acquire_and_probe(EngineKind::ClaudeCode));
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // Circuit should now be open
        assert!(!cb.try_acquire_and_probe(EngineKind::ClaudeCode));
        // Other providers unaffected
        assert!(cb.try_acquire_and_probe(EngineKind::CodexCli));
    }

    #[test]
    fn test_circuit_breaker_reset_on_success() {
        let cb = ProviderCircuitBreaker::new();
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // 4 failures, still under threshold
        assert!(cb.try_acquire_and_probe(EngineKind::ClaudeCode));
        cb.record_success(EngineKind::ClaudeCode);
        // Counter reset, should be available
        assert!(cb.try_acquire_and_probe(EngineKind::ClaudeCode));
    }

    #[test]
    fn test_global_breaker_trips_after_threshold() {
        let cb = ProviderCircuitBreaker::new();
        // Spread failures across both providers to hit the global threshold
        // without hitting any single provider's threshold (5)
        for _ in 0..5 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        // Claude circuit is now open (5 consecutive), but global has 5 < 10
        assert!(!cb.is_globally_paused());

        for _ in 0..4 {
            cb.record_failure(EngineKind::CodexCli);
        }
        // 9 total failures -- still under global threshold (10)
        assert!(!cb.is_globally_paused());

        // Push past global threshold
        cb.record_failure(EngineKind::CodexCli);
        // 10 total failures -- global breaker should trip
        assert!(cb.is_globally_paused());

        // All providers should be blocked
        assert!(!cb.try_acquire_and_probe(EngineKind::ClaudeCode));
        assert!(!cb.try_acquire_and_probe(EngineKind::CodexCli));
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
            cb.record_failure(EngineKind::CodexCli);
        }
        // 1 success offsets 1 Claude failure: 3 Claude + 4 Codex = 7 < 10
        assert!(!cb.is_globally_paused());
    }

    #[test]
    fn test_success_offsets_one_failure_from_global_window() {
        let cb = ProviderCircuitBreaker::new();
        // 8 failures across providers, then Claude succeeds once
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        for _ in 0..4 {
            cb.record_failure(EngineKind::CodexCli);
        }
        assert!(!cb.is_globally_paused()); // 8 < 10

        // Claude recovers -- only 1 failure removed (1:1 offset)
        cb.record_success(EngineKind::ClaudeCode);
        // 3 Claude + 4 Codex = 7 remaining

        // 3 more Codex failures push past threshold: 3 + 4 + 3 = 10
        for _ in 0..3 {
            cb.record_failure(EngineKind::CodexCli);
        }
        assert!(cb.is_globally_paused());
    }

    #[test]
    fn test_multiple_successes_gradually_drain_failures() {
        let cb = ProviderCircuitBreaker::new();
        // 4 failures each → 8 total
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        for _ in 0..4 {
            cb.record_failure(EngineKind::CodexCli);
        }
        // Each success removes 1 failure from that provider
        cb.record_success(EngineKind::ClaudeCode); // 3 Claude + 4 Codex = 7
        cb.record_success(EngineKind::CodexCli); // 3 Claude + 3 Codex = 6
        // 2 more failures: 6 + 2 = 8 < 10
        cb.record_failure(EngineKind::ClaudeCode);
        cb.record_failure(EngineKind::CodexCli);
        assert!(!cb.is_globally_paused());
    }

    #[test]
    fn test_single_success_does_not_purge_all_provider_failures() {
        let cb = ProviderCircuitBreaker::new();
        // Provider A accumulates 6 failures, B has 3 → 9 total (just under threshold)
        for _ in 0..6 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        for _ in 0..3 {
            cb.record_failure(EngineKind::CodexCli);
        }
        assert!(!cb.is_globally_paused()); // 9 < 10

        // One lucky success on provider A: should only remove 1 of 6, not all 6
        cb.record_success(EngineKind::ClaudeCode);
        // 5 Claude + 3 Codex = 8

        // 2 more failures on Codex tip the global breaker
        cb.record_failure(EngineKind::CodexCli);
        cb.record_failure(EngineKind::CodexCli);
        // 5 + 3 + 2 = 10 → trips
        assert!(cb.is_globally_paused());
    }

    #[test]
    fn test_failover_chain_claude_primary() {
        let chain = build_failover_chain(EngineKind::ClaudeCode, None);
        // Should have: Claude(configured) + Claude model fallbacks + Codex
        assert!(chain.len() >= 3);
        assert_eq!(chain[0].engine_kind, EngineKind::ClaudeCode);
        // Last alternate should be Codex
        let last = chain.last().unwrap();
        assert_eq!(last.engine_kind, EngineKind::CodexCli);
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

    #[test]
    fn test_record_failure_returns_transition_on_circuit_open() {
        let cb = ProviderCircuitBreaker::new();
        // First 4 failures: no transition (still under threshold)
        for _ in 0..4 {
            let transitions = cb.record_failure(EngineKind::ClaudeCode);
            assert!(transitions.is_empty());
        }
        // 5th failure: circuit opens — should get a transition event
        let transitions = cb.record_failure(EngineKind::ClaudeCode);
        assert_eq!(transitions.len(), 1);
        assert_eq!(transitions[0].provider, "claude_code");
        assert_eq!(transitions[0].from_state, "closed");
        assert_eq!(transitions[0].to_state, "open");
        assert_eq!(transitions[0].failure_count, 5);
    }

    #[test]
    fn test_global_trip_returns_transition() {
        let cb = ProviderCircuitBreaker::new();
        // 4 failures on Claude, 4 on Codex (8 total, no per-provider trip yet)
        for _ in 0..4 {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        for _ in 0..4 {
            cb.record_failure(EngineKind::CodexCli);
        }
        // 9th failure
        cb.record_failure(EngineKind::ClaudeCode);
        // Claude now has 5 consecutive → per-provider circuit opens
        // 10th failure: hits global threshold
        let transitions = cb.record_failure(EngineKind::CodexCli);
        // Should have exactly 1 transition: global pause (Codex at 5 also opens, but
        // the per-provider open for Codex is a separate transition)
        assert!(transitions.iter().any(|t| t.provider == "global" && t.to_state == "paused"));
    }

    #[test]
    fn test_status_includes_history_and_trip_count() {
        let cb = ProviderCircuitBreaker::new();
        // Trip Claude's circuit
        for _ in 0..CIRCUIT_BREAKER_THRESHOLD {
            cb.record_failure(EngineKind::ClaudeCode);
        }
        let status = cb.get_status();
        // Should have at least one transition in recent_transitions
        assert!(!status.recent_transitions.is_empty());
        assert_eq!(status.recent_transitions[0].provider, "claude_code");
        assert_eq!(status.recent_transitions[0].to_state, "open");
        // trip_count_1h for Claude should be 1
        let claude = status.providers.iter().find(|p| p.provider == "claude_code").unwrap();
        assert_eq!(claude.trip_count_1h, 1);
        // Other providers should have 0
        let codex = status.providers.iter().find(|p| p.provider == "codex_cli").unwrap();
        assert_eq!(codex.trip_count_1h, 0);
    }
}
