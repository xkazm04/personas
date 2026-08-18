---
layer: application
subject: retry-backoff
technique: circuit-breakers
stack: rust
---

# Circuit breakers in the Personas execution engine (Rust)

How this repo realizes the circuit-breakers technique: a per-provider breaker
nested under a global breaker in one component, a second independent
persona-level breaker in another, and a written contract for how they relate.

## 1. Two scopes in one component, deny-wins, global checked first

`src-tauri/src/engine/failover.rs` holds `ProviderCircuitBreaker`: per-provider
consecutive-failure breakers (`CIRCUIT_BREAKER_THRESHOLD = 5`, `CIRCUIT_COOLDOWN`
60s) under a global breaker that trips on **total failures across all providers
in a rolling window** (`GLOBAL_FAILURE_THRESHOLD = 10` in
`GLOBAL_FAILURE_WINDOW` 120s, `failover.rs:39-49`) — the module doc states the
purpose: "preventing the failover chain from amplifying load on already-stressed
services" (`failover.rs:161-169`). `try_acquire_and_probe` (`failover.rs:343-403`)
implements deny-wins with the global checked first; all state sits behind one
mutex so check-and-reserve is atomic.

The technique's "layered scopes need a documented precedence" rule is satisfied
by prose, not just code: the header (`failover.rs:8-15`) names the *other*
breaker in the system — the persona-level one in `healing_orchestrator` that
trips on a persona's recent failed executions — declares them independent
("they share no state and tripping one does not trip or reset the other"), and
points at `docs/architecture/circuit-breakers.md` for the full precedence/reset
contract. The two breakers also deliberately partition the evidence:
`healing.rs`'s storm-cap comment records that the persona breaker *excludes
environmental failures by design*, which is why the storm cap exists as the
cross-chain backstop (`src-tauri/core/src/healing.rs:244-275`).

## 2. Evidence discipline: only classified, failover-eligible failures count

`classify_error` (`failover.rs:73-91`) delegates to the single taxonomy
(`src-tauri/core/src/error_taxonomy.rs`) and feeds the breaker only when
`is_failover_eligible(&category)` — RateLimit, SessionLimit, Timeout,
ProviderNotFound; **not** CredentialError, Validation, or Unknown
(`error_taxonomy.rs:381-391`). Unmatched errors increment
`FAILOVER_UNCLASSIFIED_ERRORS` and log with the cumulative count — the
technique's "count the unknowns" rule, live.

A subtle piece of evidence accounting worth copying: `record_success`
(`failover.rs:484-524`) removes **at most one** of that provider's entries from
the global failure window, with the rationale in the comment — a single lucky
success must not purge the accumulated case for a fleet-level trip. Offset,
don't reset.

## 3. Persistence with a freshness bound

`ProviderCircuitBreaker::with_persistence` (`failover.rs:202-265`) rehydrates
per-provider state on startup from `circuit_breaker_state`
(`src-tauri/db/src/repos/execution/circuit_breaker.rs`), honoring
`PERSIST_TTL_MINUTES = 15`: `load_active` only returns rows updated inside the
TTL, `purge_expired` sweeps the rest, and restore failure degrades to
starting fresh with a warn — exactly the technique's "durable memory with an
honesty horizon." Every `record_failure`/`record_success` re-persists the
snapshot best-effort.

## 4. Observability as a first-class surface

`get_status` (`failover.rs:416-475`) returns a ts-rs-exported
`CircuitBreakerStatus` to the frontend: per-provider open/closed, consecutive
failures, cooldown-remaining seconds, trips-in-last-hour, global pause state,
and a 50-entry ring buffer of `CircuitTransitionEvent`s (closed→open,
open→half_open, paused→closed, each with timestamp and failure count).
Transitions log at warn/info; `record_failure` returns the transition events so
callers can emit them as UI events. This is the technique's "breaker state is an
operator surface" realized end to end.

## What to copy, what to improve

Copy: the deny-wins global-first check under one mutex; the evidence partition
between the two breakers *written down where both can be found*; success
offsetting exactly one failure; the TTL-bounded persistence; the transition
ring buffer exported to the UI.

Improve — one real deviation from the technique: the **half-open state is not a
bounded probe**. `try_acquire_and_probe` resets `consecutive_failures` to 0 on
the open→half_open transition (`failover.rs:395-397`), so a failed probe does
not re-open the breaker — the provider gets five fresh failures at full
admission before tripping again, and under sustained outage the breaker
oscillates between "open for 60s" and "five free hits." The standard: half-open
admits a strictly bounded probe count, a failed probe returns to open
immediately, and consecutive probe failures may escalate the cooldown.
