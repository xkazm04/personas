---
subject: drag-drop
evidence:
  - src/features/shared/components/kanban/KanbanBoard.tsx            # ownership-boundary exemplar: display-only lanes when status is backend-owned; id+status drop signature; typed drag payload gating
  - src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx  # the reference complete reorder: id in payload, refuse-before-accept, persist once, persisted order treated as untrusted
  # (useIslandDrag.ts, the lifecycle-contract exemplar — pointer capture, 4px click-vs-drag threshold, one commit on release — was retired 2026-09-25 with the Mastermind canvas; recoverable from git history)
  - src/features/shared/components/display/DropIndicator.tsx         # position preview: one gliding indicator per list, reduced-motion aware
counter_evidence:
deviations:
  - w7-drag-drop   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Drag Drop - evidence

How this codebase measures against the [`drag-drop`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
