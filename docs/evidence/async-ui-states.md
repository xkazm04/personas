---
subject: async-ui-states
evidence:
  - docs/design/overview-loading.md                                    # the five loading laws — this repo's own surface doctrine, matched by the state model
  - src/features/shared/components/display/UnifiedTable.tsx            # three-state body under permanent chrome; cascade coupled to the load cycle (resolveRowReveal)
  - src/features/shared/components/buttons/AsyncButton.tsx             # the pressed-control contract: synchronous disarm, promise-tied busy, finally-released guard
  - src/features/shared/components/layout/RouteChunkSkeleton.tsx       # code arrival as data arrival: delayed, header-band-only lazy fallback
  - src/features/shared/components/feedback/ScenarioEmptyState.tsx     # cause-typed empty states: scenario variants, NoResults (no-match), InboxZero (zero-as-goal)
  - src/hooks/utility/interaction/useProgressiveReveal.ts              # the surface-scoped seen-set behind one-shot entrance (useRevealTracker)
counter_evidence:
  - src/features/shared/components/feedback/LoadingSpinner.tsx         # renders null by design — every call site treating it as a busy affordance ships invisible feedback
deviations:
  - w1-async-ui-states   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Async Ui States - evidence

How this codebase measures against the [`async-ui-states`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
