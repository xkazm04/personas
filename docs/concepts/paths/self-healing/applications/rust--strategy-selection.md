---
layer: application
subject: self-healing
technique: strategy-selection
stack: rust
---

# Strategy selection in the Personas healing engine (Rust)

How this repo realizes the strategy-selection technique: one pure decision tree
with its precedence written in the module doc, mutual exclusion enforced both by
the tree and by a resource lock for the actor the tree never selects, and a
storm cap whose do-nothing outcome is spelled distinguishably.

## 1. One tree, one winner, pure function

`src-tauri/engine/src/healing_orchestrator.rs` is "the **single orchestration
layer** that determines which healing strategy should handle a given failure.
It replaces the ad-hoc sequencing previously spread across
`evaluate_healing_and_retry()`" (module doc, `healing_orchestrator.rs:1-5`) —
the exact independent-handlers → single-tree migration the technique
prescribes. `evaluate(ctx) -> HealingStrategy` (`healing_orchestrator.rs:182-287`)
is a pure function ("no side effects — callers are responsible for executing
the chosen strategy", `:180-181`), returning exactly one of a closed enum:
`RuleBasedRetry | AiHealing | CreateIssue | CircuitBreakerTripped`
(`:109-120`). Purity is what lets the whole precedence contract live in unit
tests (`circuit_breaker_takes_priority_over_auto_fix`,
`rule_based_retry_preempts_ai_healing`, `circuit_breaker_beats_storm_cap`,
`:319-347,:410-424,:821-835`).

## 2. Precedence documented — including the strategies the tree never selects

The module doc's "Strategy Precedence (highest → lowest)" list
(`healing_orchestrator.rs:7-28`) covers **four** strategies, of which only the
middle two are actually representable by `evaluate`: failover is "resolved in
`runner.rs` *before* post-failure healing runs" (#1), and auto-rollback
"operates on aggregate metrics, not individual failures. Runs independently
and is never selected by this decision tree" (#4). Documenting the out-of-tree
actors inside the tree's own contract is the technique's "the exclusion story
must cover the whole cast" rule, realized.

And the file records why that rule earns its keep: the doc's mutual-exclusion
section (`:36-57`) preserves the corrected mistake — "the old 'they operate at
different levels, therefore safe' claim was **false** — they hit the same two
columns" (`personas.system_prompt` / `structured_prompt`, written by both AI
healing and `perform_rollback`). Exclusion-by-selection could never fix that,
so exclusion-by-resource does: AI healing holds the `healing_personas` slot for
its whole session, and `auto_rollback_tick` acquires the **same** slot via
`try_start_healing_blocking` before `perform_rollback`, skipping any persona
with an in-flight heal and releasing on every path
(`src-tauri/src/engine/auto_rollback.rs:363-382`). Invariant, stated: "the two
prompt writes can never interleave for one persona."

## 3. Consume the classification, never re-parse

`HealingContext.category` is "classified **once** upstream on the failure path
… The decision tree consumes this instead of re-running the string ladder —
one classification, consumed everywhere" (`healing_orchestrator.rs:144-152`);
`error` is retained "for diagnosis text … NOT re-classified here" (`:142-143`).
The guard test `provided_category_drives_decision_not_error_string`
(`:569-600`) proves it both directions: an opaque string with a RateLimit
category schedules a retry; a rate-limit-looking string with a Timeout
category follows the category. This is failure-diagnosis's "consume the
authority" contract, enforced by test.

## 4. Budgets, exemptions, and the named backstop

The tree walks the guards in stated order: persona circuit breaker first
(`consecutive_failures >= 5`, `:196-199`), then the environmental overrides.
Usage-limit and API-error arms *deliberately bypass* the `consecutive < 3`
gate — "usage limits are environmental (every run in the window fails), and
piling failures doesn't make a retry at reset time any less likely to succeed"
(`:204-208`) — and the persona breaker "*excludes* environmental failures by
design", so during a sustained provider incident **neither guard fires**
(`STORM_RETRY_CAP` doc, `:85-99`). The repo's answer is the technique's
"every exemption names its backstop" rule made concrete: a dedicated storm cap
(8 environmental failures per 60-minute window, `:99-105`) folds further
durable retries into a manual issue, with the reasoning written at the
constant's definition. Note the honest scoping: the cap "bounds the **retry
COUNT within a window**, never the wait time — a single legitimate
usage-window wait (which may be hours) still schedules normally."

## 5. The do-nothing lane is spelled, not silent

When the storm cap trips, the selection is still a first-class outcome:
`CreateIssue` with `storm_capped_diagnosis` — and the test asserts it is
*distinguishable* from the ordinary exhausted-budget issue
(`d.title.contains("Provider incident")`, category preserved "for correct
attribution", `:769-789`). Likewise `CircuitBreakerTripped` is its own
variant, not a silent skip. Decline-with-reason, as an enum.

## What to copy, what to improve

Copy: the pure `evaluate` over a closed strategy enum; precedence prose that
names the out-of-tree actors; the resource lock shared with the actor the tree
cannot exclude; the exemption→backstop pairing written at the constant that
implements it; distinguishable do-nothing diagnoses; the category-not-string
guard test.

Improve — two honest gaps against the technique: (1) the category→strategy
mapping is code (match arms and `is_auto_fixable`), not data — retuning "what
is eligible for a credential failure" is a recompile-and-ship, which the
technique flags for the same reason breaker thresholds want to be data; and
(2) selections that *decline* (CreateIssue via consent-absent-style paths,
e.g. AI healing skipped because `is_dev_mode` is false, `:274-283`) do not
record *which* branch lost and why — the do-nothing reason taxonomy exists in
the diagnosis text but not as a queryable field, so "how often did the
dev-gate suppress a heal that would have run" is not a query today.
