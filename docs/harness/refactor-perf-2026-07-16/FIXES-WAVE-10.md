# Refactor+Perf Fix Wave 10 (F1) — Render/stream churn, first half

> 8 commits, 13 findings closed. Executed by a 7-agent parallel workflow (verify-before-fix contract, no agent commits; orchestrator gated).
> Gates: tsc 0 (after fixing 2 latent type gaps + 1 new strict-index error); vitest 2304/2304; eslint clean per-commit.

## Commits

| Commit | Findings | What |
|---|---|---|
| `56ce5af28` | lib-execution #1, stores-slices-2-3 #1 | executionSink 100ms-throttled flush (forceFlush stays sync); dev-tools/artist slices batch streamed lines into one set() per 80ms. |
| `8beaed114` | studio #1 | Store buffers stream deltas per project, flushes once per rAF; StudioPage/ChatInput/TabBar select narrow fields — nothing subscribes to the stream. |
| `5e7a178de` | triggers-misc #1 | LiveStreamTab commits ALL listener state in its rAF flush (per-event setters had defeated the batching). |
| `416d94129` | plugins-dev-tools-1-3 #2, agents-executions-2-4 #1 | Per-TaskCard buffer subscription (memo + stable empty fallback); memo'd TerminalLine so highlight cost is paid once per line, not per tick. |
| `45fcdf933` | hooks-execution #1, templates-n8n-1-2 #2 | Binary-search visible-line cutoff + ~12/s playback flush (pure updaters); WeakMap serialize-per-reference cache for the n8n DB sync. |
| `b77c7dd96` | shared-components-2-4 #1, schedules-components #1 | Module-scope MOTION_TAGS (2026-07-10 memoization hadn't covered the body call); memo'd ScheduleRow + trigger_id-keyed entry cache + ref-latched entries getter. |
| `c8e160b0f` | overview-incidents #1, overview-manual-review #1, overview-observability-1-2 #1, hooks-design-1-2 #1 | Stable deps/memos: incident rows, parseDecisions, annotation composer input, coverageServiceTypes identity. |
| `4501079b1` | (latent) | UseDriveResult.moveMany interface gap (wave 7) + STAT_CARD_CLASSES `satisfies` (wave 5) — see process note. |

## Process note (important)

Two type errors introduced in waves 5/7 were only caught by THIS wave's gate. Cause: background `tsc` runs raced concurrent edits during those waves — a gate started before the last edit landed can pass stale state. **Rule going forward: the gate run must start after the wave's final edit, and any gate that overlapped an edit must be re-run before committing.** (vitest results were unaffected; the errors were type-level only.)

## Cumulative status (waves 1–10)

99 findings closed (1 Critical + 98 High) in 73 fix commits + 10 summaries. Remaining C+H: F2 render churn tail (13: O(n²) memory conflicts, detectConflicts overcount, SchemaFieldBuilder keys, RecipeVersionsTab reset, beat-anchor effect, useDebouncedSave deps, Intl.NumberFormat hot path, template complexity re-parse, lab virtualization, etc.), I duplication (19) + 2 deferred.
