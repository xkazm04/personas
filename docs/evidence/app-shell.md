---
subject: app-shell
evidence:
  - src/lib/navigation/registry.ts                          # the single-authority nav registry: closed vocabulary, gates, reachability, compile-time exhaustiveness
  - src/features/shared/chrome/sidebar/Sidebar.tsx          # two-level nav, collapse persistence, per-section scroll memory, tier redirect
  - src/features/shared/chrome/BackgroundServices.tsx       # the one enumerable host for always-mounted background workers
counter_evidence:
  - src/lib/types/types.ts   # ~23 sub-destination tab unions the registry does not govern — the vocabulary discipline stops at level 1
deviations:
  - w3-app-shell   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# App Shell - evidence

How this codebase measures against the [`app-shell`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
