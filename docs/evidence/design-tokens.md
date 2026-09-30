---
subject: design-tokens
evidence:
  - .claude/Design.md                                       # the canonical token reference: typo recipes, semantic radii, elevation, spacing tokens
  - src/lib/utils/designTokens.ts                           # script-layer vocabulary: spacing/motion/status/border tokens, density-variable consumers
  - src/stores/themeStore.ts                                # one owner for every appearance axis: theme, text-scale, density, brightness, contrast, cvd, motion
  - src/styles/typography.css                               # type recipes (typo-*): size+weight+line-height+tracking as one named unit
  - src/lib/theme/deriveCustomTheme.ts                      # seed→complete-binding-set derivation; stores config not snapshot, re-derives at boot
  - scripts/check-themes.mjs                                # the contrast floor as a gate: parses the shipped stylesheet, hard-fails AA text pairs per theme
counter_evidence:
  - eslint.config.js                                        # the raw-value bans at warn-level (":96-101") — advisory by construction at both gates; the decay the enforcement technique names
deviations:
  - w3-design-tokens   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Design Tokens - evidence

How this codebase measures against the [`design-tokens`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
