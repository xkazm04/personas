---
subject: perf-instrumentation
evidence:
  - src/lib/ipcMetrics.ts                                       # 500-record ring + never-evicted lifetime counters; nearest-rank p50/p95/p99 derived at read; timedOut flag with the duration-heuristic trap named in a comment
  - src/lib/tauriInvoke.ts                                      # the one chokepoint: records every call at settlement; timedOut stamped from the actual timeout error type, in the branch that knows
  - src-tauri/src/startup_timing.rs                             # ~35 named phases, marks emitted by the owning setup code; frontend TTI merged into the same report; TTI is None (missing), never zero, until reported
  - src-tauri/src/freeze_monitor.rs                             # always-on production memory sampler: 10s cadence, slope alert (+100MB/10s), append-only line-delimited sink, liveness record every 60th probe
  - src/lib/debug/freezeDetector.ts                             # rAF-heartbeat freeze detector, flag-gated after its own stall-time DOM census worsened the jank it measured; runtime kill-switch, ring of 50
  - src-tauri/db/src/perf.rs                                    # embedded-db's ground, cited as cross-domain confirmation: 2048-sample shared ring grouped per-table at read, nearest-rank p95, explicit 100ms slow threshold, warn budget 5/60s with disclosed suppression summary
  - src/features/overview/sub_observability/components/IpcPerformancePanel.tsx  # the surface: subscribe + derive-on-read, per-command n rendered beside the percentiles
counter_evidence:
  - src-tauri/src/freeze_monitor.rs                             # the durable sink is truncated at every launch (create, then append) — the record of the session that crashed dies with the relaunch that follows it
deviations:
  - w5-perf-instrumentation   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Perf Instrumentation - evidence

How this codebase measures against the [`perf-instrumentation`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
