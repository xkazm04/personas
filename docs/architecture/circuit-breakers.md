# Circuit Breakers

Personas runs **two independent circuit breakers** that watch overlapping
populations of failures but trip on different signals and disable different
things. Operators debugging an outage often see one without the other and
guess at precedence; this doc pins the contract down.

## TL;DR

| Breaker | Scope | Trips at | What it disables | How it resets |
| --- | --- | --- | --- | --- |
| **Provider** (`engine::failover`) | per `EngineKind` (e.g. `claude_code`) | 5 consecutive provider failures | The provider is skipped in the failover chain | 60 s cooldown → half-open probe → success closes |
| **Provider — global** (`engine::failover`) | every provider together | 10 failures across all providers in a 120 s window | All failover paused | 60 s cooldown |
| **Persona** (`engine::healing_orchestrator`) | one persona | 5 most-recent failed executions for that persona | The persona's `enabled` flag is set to `false`; scheduler stops queueing it | **Manual** — operator re-enables the persona |

The two breakers do **not** inform each other. Tripping one never trips or
resets the other. They share no state.

## Provider breaker — `engine/failover.rs`

Implementation: [`ProviderCircuitBreaker`](../../src-tauri/src/engine/failover.rs).
Persistence: [`db/repos/execution/circuit_breaker.rs`](../../src-tauri/src/db/repos/execution/circuit_breaker.rs)
(15 minute TTL, restored on startup).

**Where it runs.** Inside the runner's failover loop. Every spawn attempt
calls `try_acquire_and_probe(kind)`; every CLI failure that
[`failover::classify_error`](../../src-tauri/src/engine/failover.rs) flags
as failover-eligible (rate limit, timeout, session limit, provider-not-found,
network) calls `record_failure(kind)`. Every successful CLI completion calls
`record_success(kind)`.

**What "failure" means here.** A failure is a *transport-level* failure
visible to the runner: the CLI couldn't spawn, errored out, hit a rate
limit, or timed out. Persona-level "the AI returned bad output" outcomes
never reach this breaker — those runs are recorded as `success` from the
runner's perspective.

**Per-provider state machine.** Closed → (5 consecutive failures) → Open →
(60 s cooldown elapsed) → Half-Open (one probe allowed) →
(success) Closed | (failure) Open. State transitions emit
`CIRCUIT_BREAKER_TRANSITION` Tauri events for the dashboard.

**Global state machine.** Closed → (10 failures across all providers in 120 s)
→ Paused → (60 s cooldown) → Closed. While Paused, *every* call to
`try_acquire_and_probe` returns `false`, so failover is suspended entirely.
A successful execution removes one — only one — entry from the rolling
failure window; this prevents a lucky single success from masking a fleet
outage.

**What tripping disables.** Only the runner's failover chain. The provider
is skipped as a candidate; if no provider in the chain is acquirable, the
execution fails with `"All providers failed or have open circuit breakers"`.
Existing in-flight executions are not killed.

## Persona breaker — `engine/healing_orchestrator.rs`

Implementation: [`healing_orchestrator::evaluate`](../../src-tauri/src/engine/healing_orchestrator.rs)
plus [`engine::mod::check_circuit_breaker`](../../src-tauri/src/engine/mod.rs).
Threshold constant: `CIRCUIT_BREAKER_THRESHOLD = 5`.

**Where it runs.** Inside `evaluate_healing_and_retry`, *after* the runner
has already exhausted its failover chain and the execution row is marked
`failed`. The healing orchestrator pulls the count via
`exec_repo::get_recent_failures(persona_id, 5)`, which returns the persona's
**5 most recent rows where `status = 'failed'`** — `LIMIT 5` over a
`WHERE status='failed' ORDER BY created_at DESC` query. There is no
"consecutive" requirement on the SQL side; intervening successful executions
do not clear the count, only push the failed rows further into history.

**State.** No in-memory state. The breaker is a pure read of the
`persona_executions` table on every failed execution.

**What "failure" means here.** Anything that ends up with
`persona_executions.status = 'failed'`. This includes both transport
failures the provider breaker counts *and* persona-output failures it
ignores. As a result, a sustained provider outage can trip the persona
breaker indirectly — but the reverse is not true.

**What tripping disables.** The orchestrator returns
`HealingStrategy::CircuitBreakerTripped`, which `evaluate_healing_and_retry`
handles by calling `personas::update(..., enabled: Some(false))`. From that
point, every scheduler entry point gates on `persona.enabled` and refuses
to queue new runs:
[`engine/background.rs:760`](../../src-tauri/src/engine/background.rs),
[`engine/management_api.rs:361`](../../src-tauri/src/engine/management_api.rs),
[`engine/mod.rs:2194`](../../src-tauri/src/engine/mod.rs).
A `circuit_breaker` healing issue is created at `severity=critical` for the
operator.

**Reset.** Manual only. The operator must re-enable the persona via the UI
(or directly toggle `personas.enabled`). There is no time-based reset and
no automatic probe — the assumption is that hitting 5 failures means the
persona's prompt, capability config, or upstream dependency needs human
review before another run is worth attempting. AI healing is explicitly
forbidden from setting `enabled=false` (and therefore from re-enabling
either, see [`ai_healing.rs:422`](../../src-tauri/src/engine/ai_healing.rs)).

## Precedence — which breaker an operator sees first

For a multi-persona outage caused by a provider going down:

1. The **provider breaker** observes the failures first because it sits on
   the spawn-and-execute path. Five failures (across any persona using
   that provider) opens it. The runner stops attempting that provider for
   60 s. Until cross-provider failover is re-introduced, this typically
   produces immediate user-visible failures with the
   `"All providers failed or have open circuit breakers"` message.
2. Each `failed` row also feeds the **persona breaker** count for the
   persona that owned the run. After 5 failed rows on a single persona
   (which can take longer than the provider breaker's 60 s window because
   the count is per-persona, not across all callers), the persona is
   disabled.
3. If the global threshold (10 failures / 120 s) is reached at any point,
   the global provider breaker pauses *all* failover for 60 s — usually
   the loudest signal in an incident.

For a broken-prompt outage on one persona with a healthy provider:

- Each run completes its CLI invocation and `record_success` is called on
  the provider breaker, so it stays closed regardless of how many runs
  produce bad output. The provider breaker counter does **not** track
  persona-output failures.
- The persona's own `failed` rows accumulate; after 5 the persona breaker
  trips and `enabled=false`. The provider breaker is unaffected.

For a fully degraded fleet (both tripped):

- The provider breaker (and likely the global breaker) trips first because
  failures hit it on every spawn. Personas using that provider start
  collecting `failed` rows. As each one crosses 5, its persona breaker
  trips, disabling it independently of the provider state.
- When the provider recovers and its breaker closes, **disabled personas
  do not auto-resume**. The operator must re-enable each one. This is
  intentional: the persona breaker assumes 5 failures warrants a human
  glance before more runs go out.

## Reset summary

| Breaker | Time-based reset? | Probe reset? | Operator reset? |
| --- | --- | --- | --- |
| Provider per-provider | Yes — 60 s cooldown to half-open | Yes — first success after cooldown closes it | Restart of the app (in-memory state lost; persisted state honors a 15 min TTL) |
| Provider global | Yes — 60 s cooldown | No (drains via the rolling 120 s window + per-success offset) | Restart of the app |
| Persona | No | No | Yes — toggle `personas.enabled = true` |

## Tests

Cross-breaker integration scenarios live in
[`src-tauri/src/engine/circuit_breakers_integration_tests.rs`](../../src-tauri/src/engine/circuit_breakers_integration_tests.rs).
The three pinning scenarios:

1. **Provider down, persona healthy.** The provider breaker opens after 5
   transport failures while the persona's healing-orchestrator count stays
   below threshold. Verifies that the runner-side breaker trips
   independently and the orchestrator does not cascade-disable the persona.
2. **Persona broken, provider healthy.** The provider breaker stays closed
   across many runs (each `record_success`) while the persona's failure
   count crosses the threshold and the orchestrator returns
   `CircuitBreakerTripped`. Verifies the orchestrator trips without
   touching provider state.
3. **Both tripped.** Drive both to the open state. Verifies they coexist
   without interaction — closing one (probe-success on the provider) does
   not reset the persona, and the persona's tripped state does not gate
   the provider breaker's probe.
