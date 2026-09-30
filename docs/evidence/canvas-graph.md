---
subject: canvas-graph
evidence:
  # (the Mastermind Hex Mosaic canvas — CanvasShell.tsx, useCanvasCamera.ts, useIslandDrag.ts, tidyLayout.ts, GroupLayer.tsx — was retired 2026-09-25 when Soundings, a fixed-geometry chart, replaced it; the files are recoverable from git history before that date)
  # (useGraphCanvas.ts / HierarchyNexus.tsx — the pattern-graph twin — were retired 2026-08-23 with the hierarchy-graph lane; their lessons survive in the viewport-transform application doc)
  - src/features/overview/sub_memories/components/MemoriesPageGraph.tsx  # shared node-position geometry for edges + nodes; cross-cluster (persona) edges surface only in the hovered dimension
counter_evidence:
deviations:
  - w7-canvas-graph   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Canvas Graph - evidence

How this codebase measures against the [`canvas-graph`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
