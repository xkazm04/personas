---
layer: application
subject: codebase-scanning
technique: sensor-pipeline
stack: react
---

# The findings sweep — sensor pipeline in the dev-tools triage loop

`src/features/plugins/dev-tools/sub_triage/findings/sweep.ts` is the
technique's canonical manifestation: one function, `runFindingSweep`, whose
header comment states the stage contract verbatim — *"gather (tolerantly) →
emit (pure) → dedup → cap → persist"* — and whose body holds every boundary
the technique demands.

## Gather tolerantly: eight sensors, all optional

Each sensor block (E1–E8, `sweep.ts:100-228`) is wrapped in its own failure
boundary. The Sentry sensor is representative (`sweep.ts:141-152`): the
fetch is tried, a failure lands in `silentCatch` and pushes `'sentry'` onto
`skippedSensors`, and the sweep continues. Missing preconditions take the
same door — no monitoring credential or unparseable project slug is a skip,
not a crash. The comment at the top of the file is the contract: *"A sweep
must never fail because one integration is down."*

Two sensors demonstrate that "skipped" is a semantic judgment, not a
mechanical one:

- **Dormant skills** (`sweep.ts:166-196`): zero telemetry rows means the
  miner never ran, so the sensor is *skipped* — "empty telemetry … yields
  zero rows → the sensor is skipped, never guessed."
- **Disputed memories** (`sweep.ts:217-228`): zero rows here is a *healthy*
  reading, so the sensor still counts as probed. Same empty array, opposite
  meaning — the pipeline encodes the difference per sensor instead of
  guessing one policy for all.

The `probedOrigins` set (`sweep.ts:98`) is the machine-readable form of the
skip report: only origins whose sensor actually ran this sweep may have
absence interpreted as evidence (see verify.ts below).

## Emit purely: the emitters take data, return drafts

All emission goes through pure functions imported from `./emitters`
(`emitStandardsFindings`, `emitSentryFindings`, `emitDocRotFindings`, …) —
each takes the gathered rows plus context and returns `FindingDraft[]`,
performing no fetches of its own. The gather stage resolves everything the
emitters need (credentials, use-case slug maps, the passport) before any
emitter runs, so the emitters are testable against fixtures and
deterministic over a snapshot.

## Verify before dedup — deliberately

The verification join (`sweep.ts:230-250`) runs on the *full* draft set,
before dedup filters it: "we need every fresh draft here, including the
ones dedup is about to drop as 'already known' (a still-known finding is
exactly the `unchanged`/`regressed` case)." `verify.ts` supplies the
verdict engine, and its `verdictFor` (`verify.ts:95-146`) enforces HONESTY
RULE 0 at the type level — `probedOrigins` is a required parameter, "so no
call site can forget it" — returning `pending`, never `cleared`, when the
sensor did not run.

## Dedup, cap with disclosed truncation, persist

- Dedup runs against **every** existing key including rejected findings
  (`sweep.ts:252-254`), so an operator's rejection is never overwritten by
  the next sweep re-filing the same signal.
- Within-sweep duplicates keep the highest-scored copy: the sort by
  `score()` — impact over effort (`sweep.ts:81-83`) — happens *before* the
  uniqueness filter and the cap, so when `SWEEP_CAP` bites, what survives
  is the work most worth doing.
- The cap's cost is reported, not swallowed: `dropped = unique.length -
  keep.length` (`sweep.ts:263`) travels out in the `SweepResult`, per the
  header's rationale — "a silent truncation reads as 'nothing else to do'."
- Persistence (`sweep.ts:265-288`) writes each kept draft through
  `createFinding` with its `dedupKey`, and a `null` return is understood as
  "the backend's own dedup won the race with another sweep" — the store,
  not the sweep, is the final arbiter of identity.

The returned `SweepResult` (`sweep.ts:290-297`) is the pipeline reporting
on itself: `created`, `duplicates`, `dropped`, `skippedSensors`, `errors`,
and the per-verdict `verified` tally — findings *and* instrument health in
one record.

## Where the application stops short of the technique

The gathered readings are not an immutable snapshot in the strict sense —
sensors fetch sequentially and each emitter runs as its data arrives, so a
long sweep spans minutes of wall clock. The window is acceptable here
because each sensor's emit consumes only that sensor's own fetch; no rule
reads across two sensors' moments. A cross-sensor rule would force the
snapshot to become explicit.
