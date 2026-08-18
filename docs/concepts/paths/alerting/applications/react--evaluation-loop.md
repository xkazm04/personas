---
layer: application
subject: alerting
technique: evaluation-loop
stack: react
---

# Evaluation loop — the always-mounted global alert evaluator

`src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts`
(67 lines) is a near-checklist implementation of the technique — and its own
doc comment records the bug that motivated each rule.

## Loop lifetime = app lifetime, learned the hard way

The header comment is the technique's first section in the past tense:

```ts
/**
 * App-wide alert evaluation. Alerts previously only fired while the Observability
 * tab was open (the only place `evaluateAlertRules` was wired, via
 * useObservabilityData) — so a user who configured alerts but didn't sit on that
 * tab was never notified. This hook lives in BackgroundServices (always mounted)
 * and evaluates on a fixed interval.
 */
```

The system "only watched while it was being watched" until the loop was
re-anchored to `BackgroundServices`, a component mounted exactly once for
the app's lifetime. Cadence is a fixed `ALERT_EVAL_INTERVAL_MS = 60_000`,
matching the Rust authority loop's `EVAL_INTERVAL_SECS: u64 = 60`.

## The overlap guard

```ts
const run = async () => {
  // Guard against overlapping ticks: if a prior pass ... is still in flight
  // when the next 60s tick fires, skip it rather than letting two
  // evaluateAlertRules calls race past the cooldown check and double-fire
  if (running) return;
  running = true;
  ...
  } finally {
    running = false;
  }
};
```

Skip-not-queue, exactly as the technique prescribes — and the comment names
the alerting-specific reason (two in-flight passes racing past the cooldown
check = double fire), not just a generic reentrancy worry.

## The private metric window

The hook fetches its **own** 1-day snapshot via
`getOverviewBundle(ALERT_EVAL_WINDOW_DAYS)` and passes it as
`evaluateAlertRules({ summary, chartData })` — the `metricsOverride`
parameter that `alertSlice.ts` documents as existing precisely "without
clobbering the user-facing observabilityMetrics (which the Observability
tab owns)". The viewed range/persona filter cannot skew what the rules see
on this path.

## Loop liveness

`alertSlice.ts` keeps an `AlertEvalHealth` record (`lastEvalAt`,
`lastEvalDurationMs`, `rulesEvaluated`, `rulesTriggered`, `lastError`,
`totalFailures`) updated on every pass including the failure branch — the
technique's "the watcher is itself watchable" decision rule, implemented as
state a panel can render.

## Where the repo deviates from the technique

Instructive precisely because the guard rules above are followed on this
path and broken on a neighboring one:

- **A third evaluator fires off the viewed filter.**
  `useObservabilityData.ts:70` calls `evaluateAlertRules()` with **no
  override** whenever the tab's metrics change — so the tab evaluates rules
  against whatever range (default 30 days, up to 90) and persona filter the
  user is viewing, and a triggered rule on that path persists a real
  `FiredAlert`. Changing a chart filter is an alert-firing action. This is
  the exact "rule silenced (or fired) by scrolling" failure the private
  window exists to prevent.
- **Empty windows coerce to zero.** Both `alertSlice.evaluateRule` and the
  Rust `evaluate_rule` return `0.0` for rates over a window with no decided
  executions, instead of skipping; on an idle install, every `<`/`<=` rule
  fires forever. The Rust test `empty_window_never_fires_rate_rules`
  asserts only the `>` direction — the direction manufactured zeros never
  set off.
- **No persisted last-evaluated stamp** — `AlertEvalHealth` is in-memory,
  so "no alerts overnight" and "app closed overnight" are indistinguishable
  afterward on the client side (the Rust loop closes most of this gap by
  running with the UI closed).
