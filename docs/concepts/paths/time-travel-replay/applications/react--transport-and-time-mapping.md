---
layer: application
subject: time-travel-replay
technique: transport-and-time-mapping
stack: react
---

# ReplaySandbox + useReplayTimeline — the execution-replay transport (and its orphaned sibling)

This repo implements the technique's mapping twice, for two different records:
`src/hooks/execution/useReplayTimeline.ts` (one execution's tool steps + log,
driven by `src/features/agents/sub_executions/replay/ReplaySandbox.tsx`) and
`src/hooks/realtime/useTimelineReplay.ts` (a 1d/7d range of persona events,
virtual cursor over wall-clock time). Comparing them against the technique is
instructive in both directions.

## The mapping, done right

`useReplayTimeline` keeps the playhead as **ms from execution start**
(`currentMs`), directly expressible as record time. The play loop (`:170-190`)
accumulates elapsed viewer time × speed per animation frame
(`pendingDelta += (now - lastTick) * speed`) but flushes state only every
`PLAYBACK_FLUSH_MS = 80` (`:100`) — time accuracy at frame rate, render cost
at ~12fps, exactly the technique's "advance by elapsed × rate" shape with an
engineering-honest cadence split. `scrubTo` clamps into `[0, totalMs]`
(`:208-210`); crossing detection is positional (`timestamp_ms <= cutoffMs`
via binary search, `:88-97`), so a jumped window releases everything inside
it and a paused playhead releases nothing — release-by-position, not
release-by-tick.

`useTimelineReplay` does the same with refs for the tick loop (`:109-158`):
`advance = dt * speedRef`, cursor clamped to range end, events emitted while
`created_at <= cursorTime`. Its `seekTo` (`:249-282`) is the technique's
seek contract in miniature: stop the loop mid-seek (`isSeekingRef`),
reposition, binary-search the next-event index (`findFirstAfter`), clear the
in-flight animation particles (a viewpoint moved, so presentation state from
the old position is discarded), then resume **only if it was playing** —
seek preserves intent instead of toggling it.

## Transport states and grammar

- **ended is not closed**: `useReplayTimeline` stops playback at the end via
  an effect (`:194-196`) but keeps the position scrubbable; `ReplaySandbox`
  wires `Home`/`End`/`Space`/arrows (`:62-98`), deferring to the scrubber
  when it has focus because it "is a real slider now and owns its own arrow
  keys" (`:65-72`) — the borrowed media grammar, without double-handling.
  `useTimelineReplay.togglePlay` (`:231-242`) auto-rewinds when at the end,
  making replay-again one gesture.
- **Stepping is boundary-aware**: `stepForward`/`stepBackward` (`:218-226`)
  move between a precomputed sorted set of tool-step start/end points
  (`boundaries`, `:199-206`) — "next event" stepping, exact because these
  points are recorded, not reconstructed.
- **Speed changes take effect from the playhead forward** by construction:
  the multiplier applies to future `dt` only.

## Where it deviates from the technique

- **No dead-air compression, anywhere.** Neither transport compresses idle
  stretches: an execution that spent 18 minutes waiting plays 18 minutes at
  1× (the speed presets — 1/2/4/8× in the sandbox, 2–64× for events — are
  the only remedy, and they compress the action exactly as much as the
  silence). No gap markers exist on either scrubber. For the event replay
  over a 7-day range this is why the default speed is 8× and the max is 64×:
  brute-force uniform compression standing in for disclosed selective
  compression.
- **`useTimelineReplay` is orphaned.** Zero importers in the tree (verified
  by search over `src/`: only the defining file matches). The
  better-engineered of the two seek implementations is dead code — its
  consumer surface was removed and the hook stayed. Worth either rewiring or
  reaping; as-is it is a second transport implementation available to drift.
- **Event emission has a flood valve with a side effect on the mapping**:
  the tick loop emits at most `batchLimit = 12` events per 50ms tick
  (`:125-127`), so a dense burst plays *slower than the mapping says* —
  position advances but presentation lags it, undisclosed. The bounded
  replay-events window (`next.length > 60 ? slice` `:143-146`) is honest for
  a particle surface, but the batch cap quietly decouples playhead from
  content during bursts.
