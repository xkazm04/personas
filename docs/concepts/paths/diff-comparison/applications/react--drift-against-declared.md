---
layer: application
subject: diff-comparison
technique: drift-against-declared
stack: react
---

# Drift against declared — execution outcome vs the persona's design expectation

The repo has one clean instance of the promise-as-baseline species, and it
is a good teaching case precisely because it gets the *shape* right and
the *finding identity* wrong.

## The species, recognizably

`src/lib/execution/middleware/driftMiddleware.ts` runs at
`frontend_complete` as a registered pipeline middleware (`addMiddleware(
'frontend_complete', { key: 'drift-detection', priority: 30 }, …)`,
`:85-87`) — decoupled from the execution lifecycle by design (module
docstring `:1-10`: "moved from inline code in
`executionSlice.finishExecution`"). Its right side is the observed
outcome (`finalStatus`, `durationMs`, `costUsd`, `errorMessage`,
`recentExecutions`, `:25`); its left side is the persona's **declared
expectation** — `timeout_ms`, `max_budget_usd`, and the parsed
`last_design_result` (`AgentIR`) the design tab produced (`:63-70`). It
answers "where does the run depart from what this persona was designed
to do", not "what changed since last run" — the drift question exactly.

`src/lib/design/designDrift.ts::detectDesignDrift` (`:72-195`) is the
comparison. Against the technique's clauses:

- **Tolerance is part of the declaration.** Timeout drift fires at
  `ratio > 0.8` of the configured timeout on a *completed* run (`:147-149`)
  — a near-miss, not a tripwire at 100 %. Cost drift fires at
  `costRatio > 0.5`, severity stepping up at `> 0.8` (`:164-171`). Both
  thresholds are declared in the kernel, not discovered by alarm fatigue.
- **Directional vocabulary.** `DriftKind` (`:6`) is
  `error_pattern | tool_mismatch | timeout | cost_overrun | repeated_failure`
  — five named departures with per-kind severity, not one "mismatch".
- **The fix-or-amend fork, half present.** Every event names a
  `targetSection` (`errorHandling | toolGuidance | instructions |
  identity`, `:18`) and a `suggestion` that reads as *amend the promise*:
  "Update toolGuidance to add error recovery instructions" (`:100`),
  "Increase timeout_ms or simplify instructions" (`:112`). The surface
  (`DesignTab` via `useDriftEventsForPersona`,
  `src/features/agents/sub_design/libs/designStateHelpers.ts:125-131`)
  routes the reader toward the declaration to edit. What is missing is
  the governed half: amending the declaration is an ordinary edit with no
  before/after record that it was done *in response to* the finding.
- **Drift over a series.** `repeated_failure` (`:181-192`) consumes
  `recentFailureCount`, computed from a snapshot captured *before* state
  reset (`driftMiddleware.ts:35-47`, with the comment explaining why) —
  gate-sees-target, honored.

## Where it departs — finding identity

`makeId()` is `` `drift_${Date.now()}_${random}` `` (`designDrift.ts:64-66`).
That is unique per *observation*. The identity the technique demands is
`(declaration clause, subject entity)` — e.g. `(cost_overrun, personaId)`
— stable across runs so run N+1 updates a standing finding. Here, a
persona that consistently spends 60 % of its budget emits one new
`cost_overrun` event per execution; `dismissed: false` is per event
(`:20`), so dismissing one does nothing to the next; and the store keeps
only `events.slice(-50)` (`saveDriftEvents`, `:56-62`) — the last-N cap
the technique predicts, evicting the oldest open findings to make room
for repeats of themselves. Persistence is `localStorage` under
`dolla:design-drift` (`:44`), hydrated into `executionSlice.designDriftEvents`
(`src/stores/slices/agents/executionSlice.ts:354`), and `dismissDriftEvent`
(`:777-781`) flips the flag on one id.

There is no "resolved — no longer observed" transition: a finding is open
until dismissed or evicted, and a persona whose budget was raised keeps
its old `cost_overrun` events until the cap rolls them out.

## Coverage of the empty report

`detectDesignDrift` evaluates four clauses. When `persona.last_design_result`
fails to parse it is silently `null` (`driftMiddleware.ts:49-52`,
`silentCatch`) and the comparison proceeds against a weaker declaration
without saying so; when the whole middleware throws it logs a warning
(`:78-80`) and returns the payload unchanged — no drift events, which the
surface renders identically to "no drift". The technique's coverage
clause ("clauses checked over clauses declared; unevaluated is not
passing") is absent: an execution that produced zero events because the
detector failed and one that produced zero because the persona is healthy
are the same empty list.

## Transplant note

The pipeline-middleware wiring is the transplantable part: a drift
detector that subscribes to a completion stage, reads the declaration
from the entity, and emits typed findings with a `targetSection` is a
pattern any repo with an execution pipeline and per-entity configuration
can host. Carry the identity fix with it — mint the finding id from
`(kind, entityId)` and *update* on re-observation — or the transplant
inherits the alarm stream on day one.
