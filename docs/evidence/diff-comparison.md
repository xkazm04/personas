---
subject: diff-comparison
evidence:
  - src/features/agents/sub_executions/workers/comparisonDiff.worker.ts    # the one off-thread kernel: request ids, chunked streaming, error shape distinct from empty result
  - src/features/agents/sub_executions/libs/comparisonDiffWorkerClient.ts  # request identity, content-fingerprint cache keys, synchronous small-input fallback
  - src/features/agents/sub_executions/libs/comparisonHelpers.ts           # set-membership line diff with its limitations disclosed in-source; top-level-key structural diff; thresholded "what changed" summary
  - src/features/agents/sub_executions/components/list/ComparisonDiff.tsx  # side-by-side field diff + inline line diff, difference counts on the header
  - src/features/agents/sub_lab/shared/labPrimitives.ts                    # the guarded kernel: DP cell ceiling (MAX_DP_CELLS), prefix/suffix strip, tiered degradation token→line→coarse
  - src/features/plugins/obsidian-brain/sub_sync/conflictDiff.ts           # real LCS chosen for prose because order and duplicates matter — level selected from the entity, contrast documented in-source
  - src/lib/execution/middleware/driftMiddleware.ts                        # the drift species wired as pipeline middleware: outcome vs persona design expectation, decoupled from the execution lifecycle
  - src/lib/design/designDrift.ts                                          # declared expectations with tolerances (80% of timeout, 50/80% of budget); each finding names the design section to amend
  - docs/concepts/golden-paths/version-diff-view.md                        # measured census: 4 client kernels / 2 server deltas, replayed pathologies, stringify-decided-equality census rule
counter_evidence:
  - src/features/agents/sub_lab/shared/DiffViewer.tsx                      # projection reads 5 of 7 fields and the empty state affirms "no structural difference" over the projection — a diff that can deny a change it cannot see
  - src/features/teams/sub_teamMemory/libs/memoryDiff.ts                   # id-set alignment across runs whose ids never match — byte-identical runs render as all-added + all-removed
deviations:
  - w12-diff-comparison   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Diff Comparison - evidence

How this codebase measures against the [`diff-comparison`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
