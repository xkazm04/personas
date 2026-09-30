---
subject: guided-tours
evidence:
  - src/features/onboarding/components/TourSpotlight.tsx            # anchor-to-stable-testid spotlight: re-measure on scroll/resize/ancestor mutation, missing-anchor flags (never dismisses), pointer-events-none never traps
  - src/features/onboarding/components/GuidedTour.tsx               # step driver: completeOn advancement, route choreography, modal-owns-screen precedence, panel-scoped keys, timeout reaping
  - src/stores/slices/system/tourSlice.ts                           # tour registry + typed TOUR_EVENTS vocabulary, exploration-acknowledge steps (the retired 5s timer), persisted progress/completion, testid validation door
  - scripts/docs/gen-tour-anchors.mjs                               # generated anchor manifest (JSON + native allow-list) validating composed tours before persistence
  - src-tauri/src/companion/generated_anchors.rs                    # generated allow-list mirror — the manifest gate's backend half
  - scripts/test/run-tours-fresh.mjs                                # fresh-profile tour walk against an isolated empty-data instance (test-harness ground)
counter_evidence:
  - src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx       # anchors declared as const-map values: visible to the drift test's grammar, invisible to the manifest generator's — two extractors, two authorities, six anchors in dispute
deviations:
  - w10-guided-tours   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w4-voice-io   # narration cache keyed by step-id only + object URLs never revoked (useTourNarration) — registered under voice-io; cited, not re-registered
---

# Guided Tours - evidence

How this codebase measures against the [`guided-tours`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
