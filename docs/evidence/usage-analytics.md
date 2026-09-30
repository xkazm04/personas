---
subject: usage-analytics
evidence:
  - src/lib/analytics/index.ts       # per-session counters, one session_summary flush, visited+ignored+activation reporting
  - src/lib/analytics/navCatalog.ts  # tracked-surface list derived from the nav registry — coverage cannot drift from the shell
  - src/lib/analytics/sink.ts        # pluggable sink boundary; scrubbed default; null sink for opt-out
  - src/lib/analytics/activation.ts  # activation as completed actions (closed const funnel, once-per-install dedupe), never visits
counter_evidence:
  - src/lib/execution/middleware/analyticsMiddleware.ts   # usage-shaped telemetry emitted outside the sink — the second door the standard forbids
deviations:
  - w5-usage-analytics   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Usage Analytics - evidence

How this codebase measures against the [`usage-analytics`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
