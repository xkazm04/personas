---
subject: observability-telemetry
evidence:
  - src-tauri/src/logging.rs                    # the whole recording spine: rolling non-blocking daily appender, deferred pre-init file writer, WebView console into the same file, per-crate EnvFilter, panic hook + capped crash store, walk-the-directory disk accounting
  - src-tauri/src/commands/infrastructure/system/crash_telemetry.rs   # diagnostic access: crash-log read/clear commands + log-directory stats for the settings surface
  - src/lib/utils/crashPersistence.ts           # sanitize-before-persist crash records, capped ring (20), fire-and-forget backend write, defensive corrupt-read that wipes and returns empty
  - src/lib/analytics/sink.ts                   # pluggable telemetry sink; noop sink when telemetry is off; pseudonymous random install id; deduped once-per-install conversion events
  - src/lib/silentCatch.ts                      # background failures become breadcrumbs, not events — the two-tier economics at a real door
  - src/features/overview/components/health/CrashLogsSection.tsx      # in-product crash viewer reading the actual stores (native crash dir, DB rows, local storage), with clear actions
counter_evidence:
  - docs/concepts/golden-paths/structured-logging.md   # measured: a second, unbounded, unredacted sink (per-execution logger) held 99.1% of log bytes and live credentials, beside a correctly bounded primary
deviations:
  - w5-observability-telemetry   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Observability Telemetry - evidence

How this codebase measures against the [`observability-telemetry`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
