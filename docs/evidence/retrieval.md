---
subject: retrieval
evidence:
  - src-tauri/src/companion/brain/retrieval.rs        # lane fusion: keyword + vector + recency, always-include tiers, shared recall window (budget not quota), overfetch-then-split
  - src-tauri/core/src/retrieval/mod.rs               # shared pure primitives: distance floor (1.30 w/ geometry rationale), model filter, lane ranking, one sanitization door
  - src-tauri/src/companion/brain/embeddings.rs       # embedding-model stamping on every vector + guard on read (counted, warned) + idempotent reindex/backfill
  - src-tauri/src/engine/kb_ingest.rs                 # content-hash idempotent re-ingest: skip unchanged, supersede changed (cascade delete, no orphaned vectors)
  - src-tauri/engine/src/chunker.rs                   # sentence-aware chunking, per-page provenance, extraction confidence, empty-page honesty
  - src-tauri/engine/src/kb_index.rs                  # the browse-not-retrieve complement: auto-maintained navigable index for small corpora
  - src-tauri/src/commands/credentials/vector_kb.rs   # KB search: model/dims guard, floor before RRF fusion, floor_filtered count returned, filter-then-cut
  - src-tauri/db/src/memory_recall.rs                 # decay×similarity blended scoring, character-budget packing (budget in consumer units)
  - src-tauri/db/src/vector_store.rs                  # per-corpus vector index provisioning, KNN query surface, transactional batch writes
counter_evidence: []
deviations:
  - w8-retrieval   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Retrieval - evidence

How this codebase measures against the [`retrieval`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
