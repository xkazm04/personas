---
layer: application
subject: time-travel-replay
technique: timeline-derivation
stack: react
---

# useReplayTimeline — where the execution replay's timeline comes from, and where it is invented

`src/hooks/execution/useReplayTimeline.ts` derives the sandbox's timeline
from two records: `execution.tool_steps` (a `ToolCallStep[]` with recorded
`started_at_ms` / `ended_at_ms`, `src/lib/bindings/ToolCallStep.ts`) and the
persisted execution log fetched by `getExecutionLog` (`ReplaySandbox.tsx:39`).
The two halves land on opposite sides of the technique.

## The recorded half: tool steps

Tool-step state at the playhead is a pure positional derivation (`:139-153`):
`completedSteps` = ended ≤ *t*, `activeStep` = started ≤ *t* < ended (or
never ended), `pendingSteps` = started > *t*. Nothing is stored; the three
lists are memoized folds over the record and `currentMs`. Boundaries for
stepping (`:199-206`) are the union of recorded start/end stamps plus `0` and
`totalMs`, sorted — the "ordered by recorded time" rule, with the honest
consequence that an unclosed step (`ended_at_ms == null`) stays *active
until the end* rather than being assigned a duration (`:146`).

## The invented half: log lines

`buildTimelineLines` (`:75-85`) is the deviation the technique's gap rule
exists for. Each line is stamped

```ts
timestamp_ms: (index / Math.max(raw.length - 1, 1)) * totalMs
```

— **evenly spread across the run's total duration**. The `TimelineLogLine`
type documents the field as "Estimated timestamp in ms from execution start"
(`:16`), but nothing downstream carries that estimate to the viewer: the
terminal panel (`ReplayTerminalPanel.tsx`) renders lines appearing at the
playhead with no estimate marking, the scrubber shows no reconstructed
region, and the lines-counter reads as measured (`lines_counter`, `:145`).
The result is the technique's *interpolation* failure exactly: a run that
emitted 2,000 lines in its first ten seconds and then waited nine minutes
plays back as a steady trickle for nine and a half minutes. Tempo — the
thing a viewer opens replay to read — is fabricated, and the fabrication is
disclosed only in a type comment.

**The record already contains the truth the derivation discards.** The
execution log writer stamps every line —
`writeln!(w, "[{timestamp}] {msg}")` with an RFC3339 UTC stamp,
`src-tauri/engine/src/logger.rs:60-62` — and `get_execution_log`
(`src-tauri/src/commands/execution/executions.rs:633-658`) returns the file
verbatim (secret-masked, not restructured). So `logContent` arrives with a
real timestamp at the head of each line, and `buildTimelineLines` overwrites
it with an index-proportional guess. This is the interpolation the technique
forbids at its most avoidable: not "the evidence is missing, so we
reconstruct", but "the evidence is present, so we ignore it". The fix is a
parse of the leading `[…]` stamp relative to `execution.started_at`, falling
back to the current interpolation *only for unstamped lines* — and rendering
those as *ordering known, timing reconstructed* per the estimate-labeling
technique. Doing this also makes log-track gaps real: dense bursts and idle
stretches become visible on the scrubber for the first time.

## Gaps and coverage

Because line timestamps are interpolated, **the log track cannot have gaps**
— every idle stretch is filled with proportionally-spaced lines. The
tool-step track *can* show gaps (steps are markers on the scrubber,
`TimelineScrubber.tsx:120-145`), but nothing renders the space between them
as disclosed silence versus dense activity; it's the same bar fill either
way. So the derivation neither interpolates the step track (good) nor
discloses its gaps (missing).

Derivation failure is spelled the same as empty success in one place:
`getExecutionLog` failure is `silentCatch`'d and logged (`ReplaySandbox.tsx:43`),
leaving `logContent === null` → `allLines = []` → a terminal panel that says
"scrub forward" (`ReplayTerminalPanel.tsx:185`) as if the log were simply
short. A run whose log could not load and a run that emitted nothing render
identically.

## The accrual is a derivation of a derivation

`accumulatedCost` (`:155-165`) is not a fold over recorded per-step costs
(none are recorded on `ToolCallStep`); it apportions `execution.cost_usd` by
*fraction of steps completed* plus a linear share of the active step. The
panel discloses this — `ReplayCostPanel.tsx:41-46` prefixes the figure with
`~` and its comment states the convention — which is the right instinct
(per-datum, at the number), and by construction it reconciles to the settled
total at *t = end*. Two things it does not do: state *what* the estimate is
apportioned by (the viewer sees `~$0.0231`, not "estimated by step
progress"), and coarsen its precision to match the evidence (four decimals
of an apportionment). The dashed-curve `CostAccrualOverlay.tsx:95-107`
comment is the more careful sibling: it explains that the curve *shape* is
always a `* 0.95` proportional reconstruction regardless of whether span
timing was captured — the per-trace `isSynthetic` badge from
`SyntheticTrace.ts` labels a *different* fact than the one the curve
fabricates. That per-trace-not-per-datum labeling gap is tracing's
registered deviation (`docs/concepts/golden-path-deferred-fixes.md#w5-tracing`);
replay inherits it and adds the interpolated log track on top.
