---
subject: error-handling
evidence:
  - src-tauri/core/src/error_taxonomy.rs        # canonical closed taxonomy — one enum consumed by healing, failover, severity, and (via ts-rs + parity fixtures) the frontend
  - src/lib/errorTaxonomy.ts                    # the language-boundary mirror, held in sync by byte-identical PARITY_FIXTURES on both sides
  - src/lib/silentCatch.ts                      # the two named doors: toastCatch (user + telemetry) vs silentCatch (telemetry + log), one call each
  - src/lib/silentFailureTelemetry.ts           # recordSwallow — the swallow rate made measurable (per-tag rollup + sampled capture)
  - src/lib/errors/errorPipeline.ts             # classifyErrorFull — one memoized classification pass instead of three independent matchers per consumer
  - src/lib/errors/errorRegistry.ts             # raw-error → friendly message + suggestion + fault-line category, ordered most-specific-first
  - src/lib/utils/apiError.ts                   # transient/permanent classification with retryAfterMs; structured `kind` fast path before any prose matching
  - src/lib/utils/crashPersistence.ts           # sanitize-at-capture, persist-first-ship-later, bounded spool with its reaper
  - src-tauri/engine/src/failure_signature.rs   # normalized failure signatures — identity-keyed dedup for the repeat-failure breaker
counter_evidence:
  - docs/concepts/golden-paths/swallowed-error-telemetry.md   # measured: 760 of 2,752 catch bodies reach no door while the empty-catch lint sits at "error" with 0 findings
deviations:
  - w2-error-handling   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Error Handling - evidence

How this codebase measures against the [`error-handling`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
