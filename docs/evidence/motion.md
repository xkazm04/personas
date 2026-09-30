---
subject: motion
evidence:
  - src/features/shared/components/display/motionPresets.ts   # the named preset library — intent per preset, duration, ease, per-preset `reduced` fallback, taste guardrails as header doctrine (entrance ≤1.2s, ambient ≤3px, honesty rule), ambient-after-entrance sequencing
  - src/lib/utils/rafAnimationEngine.ts                       # one shared rAF spring engine — module-level registry, ref-writing frames, self-stopping loop, dt clamped after tab suspension
  - src/features/shared/components/display/MotionizedGlyph.tsx # engine escape in the wild: platform keyframes chosen BECAUSE the library's global MotionConfig switch silently snaps reveals
  - src/App.tsx                                               # the global library switch itself — MotionConfig reducedMotion flips to 'always' on document-hidden (App.tsx:321)
  - src/features/shared/components/display/RevealItem.tsx     # one-shot mechanics: id-keyed guard, entry marked on animationend not mount, stagger step 35ms capped at 8, reduced-motion marks entered immediately
  - src/hooks/utility/interaction/useProgressiveReveal.ts     # the surface-scoped seen-set (useRevealTracker) with an explicit single resetKey policy
counter_evidence:
  - src/features/shared/components/display/MotionizedGlyph.tsx # same file, other face: IntersectionObserver deliberately REPLAYS the entrance on every viewport re-entry — decorative-glyph policy that contradicts the one-shot standard
deviations:
  - w10-motion   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-design-tokens      # MOTION JS ↔ --duration-* CSS is a comment-only mirror (adoption 14 vs 196 raw) — registered under design-tokens; cited, not re-registered
  - w1-async-ui-states    # reduced-motion global reset destroys the ghost-invisibility window — registered under async-ui-states; cited, not re-registered
---

# Motion - evidence

How this codebase measures against the [`motion`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
