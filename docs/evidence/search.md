---
subject: search
evidence:
  - src-tauri/db/src/repos/execution/executions.rs              # build_fts5_query (one sanitization door: tokenize→quote→bounded) + search (bm25 ranking, snippet excerpts, join-back to source)
  - src-tauri/db/src/migrations/schema.rs                       # external-content FTS index + synchronous ai/ad/au maintenance triggers
  - src-tauri/db/src/lib.rs                                     # executions_fts_drift / ensure_executions_fts — startup reconciliation with a named rebuild path
  - src/features/templates/sub_generated/gallery/search/suggestions/useStructuredQuery.ts  # closed prefix set lifted into removable typed chips; remainder stays keyword text
  - src/features/shared/chrome/commandPaletteUtils.ts           # registry-derived palette corpus, banded fuzzy scoring with field weights, session recency
  - src/features/overview/sub_events/libs/useEventLog.ts        # saved views persisting the typed predicate (view_config), applied by re-execution
  - src/features/shared/components/display/facetedTableModel.ts # facet tree derived from data, own/total counts bubbled, deterministic child sort
counter_evidence: []
deviations:
  - w1-search   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Search - evidence

How this codebase measures against the [`search`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
