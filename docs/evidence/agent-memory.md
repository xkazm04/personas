---
subject: agent-memory
evidence:
  - src-tauri/src/companion/brain/consolidation.rs        # proposal-gated distillation; provenance-mandatory writes; decay + per-scope caps
  - src-tauri/src/companion/brain/episodic.rs             # append-only evidence layer — facts rebuildable from cited episode ids
  - src-tauri/src/companion/brain/sleep_cycle/          # pressure-triggered batch cycle; drain-forward window; report-only forgetting
  - src-tauri/src/companion/brain/retrieval.rs            # three-lane budgeted recall: relevance, vector, always-include + recency floor
  - src-tauri/src/companion/orchestration/operative_memory.rs  # in-process working memory: TTL reaper, digest caps, end-of-session synthesis
  - src-tauri/db/src/memory_recall.rs                     # decay-scored budget packing; category half-lives; archive-not-delete
counter_evidence:
  - src-tauri/src/commands/companion/fleet_bridge.rs      # machine correlator records written as episodes — the flood that crowded conversation out of recall until read-side filtering
deviations:
  - w1-agent-memory   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Agent Memory - evidence

How this codebase measures against the [`agent-memory`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
