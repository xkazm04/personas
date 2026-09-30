---
subject: ui-controls
evidence:
  - src/features/shared/components/CATALOG.md                    # the generated catalog — 128 primitives, header names its generator, entries warn about traps
  - scripts/docs/gen-shared-catalog.mjs                          # the generator: walks the tree, reads @catalog tags, CURATED overrides for load-bearing warnings
  - src/features/shared/components/buttons/Button.tsx            # closed variant/size enums → token bundles; promise-sniffing double-press guard; width lock while busy; disabledReason tooltip
  - src/features/shared/components/buttons/AsyncButton.tsx       # wrapper-not-fork over Button; synchronous in-flight ref; reduced-motion fallback path
  - src/features/shared/components/buttons/CopyButton.tsx        # copy feedback window with managed/unmanaged duality; refuses to flash success for an empty or failed write
  - src/hooks/utility/interaction/useCopyToClipboard.ts          # the ONE clipboard door (copyText); timed feedback with unmount-safe timer
  - src/features/shared/components/display/Tooltip.tsx           # open delay from the motion token ladder; aria-describedby; Escape dismiss; flip+clamp positioning
  - src/features/shared/components/forms/NumberStepper.tsx       # bounds clamped at every door; live onChange vs settled onCommit; empty-as-state via allowEmpty; hold-to-repeat acceleration
  - src/features/shared/components/forms/AccessibleToggle.tsx    # switch role/state/keyboard minted once inside the primitive
  - src/features/shared/components/layout/PanelTabBar.tsx        # id-keyed tabs, tablist role, arrow-key roving added when its absence was measured
  - .claude/CLAUDE.md                                            # the don't-hand-roll table — temptation-keyed routing in the instructions every session reads
counter_evidence:
  - src/features/shared/components/feedback/LoadingSpinner.tsx   # control-shaped shim that renders nothing — the catalog entry now carries the warning
  - src/hooks/utility/interaction/useRovingTabIndex.ts           # zero-adopter primitive: built, never routed to — a standard nobody ratified
deviations:
  - w12-ui-controls   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w1-form            # adoption inversion: 4 field-primitive adopters vs 19 shadow wrappers — the library pathology, measured
  - w10-accessibility  # zero-adopter roving-focus hook — a primitive that exists but routes nobody
---

# Ui Controls - evidence

How this codebase measures against the [`ui-controls`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
