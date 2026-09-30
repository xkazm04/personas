---
subject: schema-driven-ui
evidence:
  - src/features/shared/components/surface/surfaceSpec.ts            # closed node vocabulary, validation door, salvage/repair with dropped count
  - src/features/shared/components/surface/SurfaceRenderer.tsx       # blessed-primitives-only realization, consent-gated actions, host capability context
  - src/features/shared/components/surface/SPEC.md                   # emitter-facing vocabulary documentation beside the schema authority
  - src/features/home/sub_cockpit/widgetRegistry.ts                  # kind→component registry for agent-composed dashboard widgets
  - src/features/home/sub_cockpit/CockpitPanel.tsx                   # spec-as-data rendering: parse-failure ≠ empty, unknown-kind handling, action re-validation on render
  - src-tauri/src/companion/brain/cockpit.rs                         # persisted spec blob, write lock over read-modify-write, pin-preserving recomposition merge
  - src/features/home/sub_cockpit/widgets/__tests__/UseCaseSetWidget.test.tsx  # widget contract pinned by tests: config in, rendered surface out
counter_evidence: []
deviations:
  - w7-schema-driven-ui   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w4-prompt-assembly                # cockpit widget kinds not validated at dispatch; emitter doctrine hand-synced to the registry
---

# Schema Driven Ui - evidence

How this codebase measures against the [`schema-driven-ui`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
