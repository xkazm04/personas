---
layer: golden-path
subject: time-travel-replay
status: forged
techniques:
  - renderer-reuse
  - timeline-derivation
  - transport-and-time-mapping
  - accrual-overlays
  - estimate-labeling
  - scrub-performance
evidence:
  - src/features/agents/sub_executions/replay/ReplaySandbox.tsx            # the replay surface: scrubber + transport over a settled execution's tool steps and log; keyboard grammar deferring to the slider; ended-not-closed
  - src/hooks/execution/useReplayTimeline.ts                               # the mapping: playhead in ms-from-start, viewer-time × speed accumulation with throttled flush, positional release by binary search, boundary stepping, proportional cost accrual
  - src/features/agents/sub_executions/replay/ReplayCostPanel.tsx          # accrual disclosed at the datum: "~" prefix on the accruing cost, unprefixed settled total, with the convention stated in-source
  - src/features/agents/sub_executions/replay/CostAccrualOverlay.tsx       # the honest comment: curve SHAPE is always a proportional reconstruction regardless of the trace's per-trace isSynthetic badge — two different facts, only one labeled
  - src/features/agents/sub_executions/replay/TimelineScrubber.tsx         # rAF-coalesced pointer scrub, real slider semantics (role/aria-valuetext), recorded tool-step markers on the track
  - src/features/agents/sub_executions/trace/SyntheticTrace.ts             # tracing's reconstruction ground that replay's overlays consume; per-trace isSynthetic flag
  - src-tauri/engine/src/logger.rs                                         # the record IS stamped per line ([rfc3339] msg) — the timing the log-track derivation currently discards
counter_evidence:
  - src/features/agents/sub_executions/replay/ReplayTerminalPanel.tsx      # a replay-only renderer (own JsonHighlight, own layout) sharing only classifyLine with the live log surfaces — the parallel-renderer divergence the standard forbids; also spells log-load failure as empty success
deviations:
  - w12-time-travel-replay   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Time-travel replay

A run finished an hour ago — or a month ago — and someone needs to **watch it
happen**. Not read its summary, not study its settled trace: watch it, the way
the operator watched it live — output arriving line by line, phases turning
over, counters climbing — under a transport the viewer owns: play, pause,
seek, faster. Time-travel replay is the discipline of re-presenting a
completed run *as if it were live*, driven entirely from the persisted record,
on a clock the viewer controls.

The uses justify the discipline. **Pedagogy**: a newcomer learns what a
healthy run looks like by watching one, at 4×, with the boring parts
compressed. **Debugging**: watching a failure *develop* — what the system
believed at each moment before it went wrong — beats inferring backwards from
the wreckage. **Async review**: "watch what happened while you were away" is a
different product than "here is a log". **Demos and audit**: a recorded run
that plays back credibly is evidence with narrative.

The defining tension: **replay is a fiction built on facts.** The presentation
pretends to be live; the data is settled history. Every principle below keeps
the fiction credible without letting it lie: reuse the real live surface so
the imitation cannot drift from the thing it imitates; derive every moment of
the timeline from the record so nothing is invented; and disclose — at the
exact spot, not in a footer — wherever the record is thinner than the live
experience was.

## What replay is not

Three neighboring disciplines own three things replay must consume, imitate,
or refuse — and each boundary, blurred, produces a recognizable defect.

- **Not the settled-record view.** The trace waterfall shows the whole run at
  once — a map, every span visible simultaneously, time as a spatial axis
  ([tracing](../tracing/tracing.md)). Replay is a **moving now**: time as
  time, one moment foregrounded, the future deliberately withheld. Replay
  *consumes* the stores tracing owns — the span tree and event record are
  tracing's ([span-model](../tracing/techniques/span-model.md) defines the
  species) — and owns only the clock that walks them. A replay feature that
  invents its own record format has built a second, drifting copy of the
  trace store; a trace viewer that grows a play button without a real time
  mapping is a slideshow wearing a transport.
- **Not the live surface.** The stream a user watches during the run —
  volatile, arriving, owned by the current attempt — belongs to
  [streaming-output](../streaming-output/streaming-output.md). Replay
  **imitates** that surface, and the imitation is credible exactly insofar as
  it *is* that surface: the same rendering, fed from the log instead of the
  wire. The moment replay gets its own renderer, the two begin to diverge —
  see the first principle below.
- **Not undo.** A replay **views** the past; undo **changes** the present
  ([undo-history](../undo-history/undo-history.md)). Scrubbing to an earlier
  moment moves a viewpoint, never the world: no store is written, no state is
  restored, and closing the replay leaves the system exactly as it was. If
  the product wants "resume from here" or "restore to this point", that is a
  checkpoint restore — undo-history's
  [checkpoint-restore](../undo-history/techniques/checkpoint-restore.md)
  owns it — and the crossing must be an explicit, separately-confirmed act,
  never a side effect of where the scrubber happens to rest.

## One surface, two feeds

The structural decision that everything else leans on: **replay reuses the
live renderers.** Same components, same layout, same phase colors, same
truncation notices — fed from the persisted record instead of the wire. A
separate replay renderer diverges from the live one the first time either
changes: a new event kind renders live but falls through silently in replay,
a restyle lands on one surface and not the other, and within two quarters
"replay looks wrong" is a standing bug class. Divergence here is not a risk
to manage but a certainty to design away — two hand-maintained presentations
of one event vocabulary are the drift the one-authority law describes
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
The seam that makes reuse possible — a feed abstraction upstream of
rendering, time injected rather than read from the wall clock, side effects
gated — is owned by [renderer-reuse](techniques/renderer-reuse.md).

## The timeline is derived, never authored

Everything the scrubber shows comes from **persisted, timestamped records** —
event logs, spans, transcript entries — by a stated derivation. Two rules
carry the honesty:

- **Gaps in the record are gaps on the scrubber.** A stretch with no records
  is rendered as disclosed silence — a marked quiet region — never
  interpolated into plausible activity. The record's thinness is information;
  smoothing it over is fabrication.
- **The timeline names its recomputation.** It is a pure derivation of the
  record ([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)),
  rebuilt from it at any time, never a second store that can drift from the
  events it was built from.

Ordering ties, unclosed items, clock anomalies, and the merge of several
record streams onto one axis are owned by
[timeline-derivation](techniques/timeline-derivation.md).

## Three clocks, one honest mapping

Replay juggles three time domains, and every transport defect is a confusion
between two of them:

| Clock | What it measures | Who owns it |
| --- | --- | --- |
| **record time** | when things actually happened, as stamped in the record | the run; immutable |
| **replay time** | the position of the moving now on the recorded span | the transport; scrubbable |
| **viewer time** | wall-clock seconds the viewer spends watching | the speed control |

Play advances replay time through record time at a chosen rate; pause freezes
it; seek jumps it; speed changes the exchange rate to viewer time. The
transport's honesty rule: **compress dead air with a marker, never
silently.** A run with eighteen idle minutes should not cost eighteen viewer
minutes — but the compression must announce itself on the scrubber and in
passing ("skipped 18m idle"), so elapsed time keeps its predicate
([count-carries-predicate](../_laws.md#count-carries-predicate)). The
transport vocabulary itself — play/pause affordances, keyboard conventions,
scrubber grammar — is the same one media surfaces use
([media-playback](../media-playback/media-playback.md)); replay adopts it
rather than inventing a dialect. The mapping function, the transport state
machine, and gap compression are owned by
[transport-and-time-mapping](techniques/transport-and-time-mapping.md).

## Numbers move with the clock

Every quantity the live surface showed as a running total — cost, tokens,
lines emitted, steps completed — must **re-accrue** as replay time advances:
the value at replay position *t* is the fold of records up to *t*. Showing
final totals at *t = 0* breaks both the illusion and the pedagogy: the
viewer came to see what the system knew *at each moment*, and a counter that
already knows the ending is a spoiler stapled to a fiction. The discipline
also cuts the other way: the accrual at *t = end* must reconcile with the
settled totals the record's rollups report, and a mismatch is a surfaced
discrepancy between record and rollup — an arbiter question, not something
replay smooths over. Accrual precomputation and the reconciliation invariant
are owned by [accrual-overlays](techniques/accrual-overlays.md); the cost
vocabulary being accrued belongs to
[cost-metering](../cost-metering/cost-metering.md).

## Reconstruction wears its label, even in motion

Products acquire replay after they acquire history, so some runs predate the
instrumentation that would have recorded them properly. Reconstructing a
playable timeline for them is legitimate — the reconstruction rules, evidence
tiers, and versioning belong to tracing's
[synthetic-and-estimated-traces](../tracing/techniques/synthetic-and-estimated-traces.md).
What replay adds is a harder rendering problem: **motion launders
estimates.** An event that *animates in* at a precise moment asserts that
moment with a confidence no static view matches — playback is a
precision-costume. So the estimate label must live **on each element** and
survive playback: visible while moving, restated at the scrubber position,
carried into whatever the viewer pauses on. A banner above an animating
timeline discloses nothing. Per-datum labeling under motion is owned by
[estimate-labeling](techniques/estimate-labeling.md).

## Scrubbing is engineered, not assumed

Replay state at time *t* is a fold over every record before *t* — so a naive
seek is a replay-from-start, and a scrub gesture is *hundreds* of seeks. The
result of shipping that naively is quiet product death: **a scrubber that
lags trains users not to scrub**, and an unscrubable replay is a video
nobody can rewind — the feature's core verb, abandoned by its own users.
Seeking needs an engineering budget: keyframes (cached fold snapshots that
name their recomputation), prefix sums for the accrual overlays, bounded
re-folds, and a cheap-preview-then-settle scrub interaction. These are owned
by [scrub-performance](techniques/scrub-performance.md).

## The lifecycle of a replay session

| Phase | What exists | What the viewer sees |
| --- | --- | --- |
| **opening** | record loaded, timeline derived, keyframes built | duration, coverage, and any estimate disclosure — before play |
| **playing** | replay clock advancing at rate × speed | the live surface, faithfully re-fed; accruals climbing |
| **paused / scrubbing** | clock frozen or jumping | any moment inspectable; overlays consistent with position |
| **ended** | replay time at record end | accruals reconciled against settled totals; scrub-back available |

Two rules fall out. **Opening discloses before playing**: coverage gaps and
estimated regions are stated up front, not discovered mid-playback. And
**ended is not closed**: reaching the end returns the viewer to a scrubbable
map of the whole run, because the second viewing — the one where they know
what to look for — is the one replay exists for.

## The techniques

- [renderer-reuse](techniques/renderer-reuse.md) — one rendering surface for
  live and replay: the feed seam, injected time, gated side effects,
  capability-flagged affordances.
- [timeline-derivation](techniques/timeline-derivation.md) — from persisted
  records to a playable timeline: ordering, ties, unclosed items, disclosed
  gaps, multi-stream merge.
- [transport-and-time-mapping](techniques/transport-and-time-mapping.md) —
  the replay-time → record-time mapping; play/pause/seek/speed semantics;
  dead-air compression with markers.
- [accrual-overlays](techniques/accrual-overlays.md) — running totals that
  re-accrue with the clock; prefix-sum precomputation; end-state
  reconciliation against settled rollups.
- [estimate-labeling](techniques/estimate-labeling.md) — per-element estimate
  marking that survives motion; precision honesty under playback; deferring
  reconstruction itself to tracing.
- [scrub-performance](techniques/scrub-performance.md) — keyframes and
  bounded re-folds; scrub latency budgets; preview-then-settle; cache
  ownership and reaping.
