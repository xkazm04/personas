---
subject: time-travel-replay
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

# Time Travel Replay - evidence

How this codebase measures against the [`time-travel-replay`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
