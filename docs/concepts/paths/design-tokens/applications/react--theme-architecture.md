---
layer: application
subject: design-tokens
technique: theme-architecture
stack: react
---

# React application — theme architecture

How this repo realizes themes-as-rebinding, where its axes live, and the two
places its own standard is thinner than the technique.

## Rebinding at the scope root

`src/stores/themeStore.ts` is the single owner of every appearance axis. A
theme switch is exactly the technique's move — `applyThemeToDOM()`
(`themeStore.ts:133-164`) stamps `data-theme="<id>"` on `document.documentElement`
and nothing else re-renders; the 11 built-in themes (`THEMES`,
`themeStore.ts:68-80`) are pure binding sets in `src/styles/globals.css`
(`:root` defaults layered under `[data-theme="..."]` override blocks). The
default theme (`dark-midnight`) *is* the bare `:root` binding — stamping is
`removeAttribute` (`themeStore.ts:148-152`) — so the "complete binding in the
default scope" clause holds by construction.

Components never branch on theme identity; the one sanctioned read is the
derived selector `useIsDarkTheme()` (`themeStore.ts:274-281`), and the store
also mirrors a `dark` class for utility-variant compatibility
(`themeStore.ts:154-163`) — both are *bindings about the theme*, not forks
inside components.

## The axes, all token transforms

Every axis from the density-and-scale technique exists here, each as an
attribute stamped by its own `apply*` function and consumed by token override
blocks in `globals.css`:

- **Text scale** — `data-text-scale` (`themeStore.ts:166-168`), three steps,
  plus `useScaledFontSize()` (`themeStore.ts:111-115`) for surfaces where
  class scaling can't reach (chart props, SVG attributes) — the scripting-side
  consumer of the same multipliers.
- **Density** — `data-density` (`themeStore.ts:210-212`) drives
  `--density-pad/-gap` variables; the script-layer spacing tokens
  (`CARD_PADDING`, `SECTION_GAP` in `src/lib/utils/designTokens.ts:67-82`)
  consume those variables, so density reflows every tokenized card without
  any component knowing the axis exists.
- **Brightness** — a numeric filter (`--app-brightness`,
  `themeStore.ts:226-245`) with per-mode ladders (`DARK_BRIGHTNESS_LEVELS` /
  `LIGHT_BRIGHTNESS_LEVELS`, `themeStore.ts:34-45`). The
  `BRIGHTNESS_EXEMPT_TOKENS` list (`themeStore.ts:220-224`) snapshots status
  and brand colors to `--<token>-raw` before the filter applies — semantic
  status hues are deliberately immune to the brightness axis, an instance of
  "axes own disjoint slices". But the axis itself is the technique's named
  trap: a **whole-document pixel filter** (`globals.css` `html { filter:
  brightness(...) }`), not a ramp rebinding. The legacy audit
  (`docs/concepts/golden-paths/theming-and-contrast.md:249-262,361-383`)
  measured the consequences: the 1.25–1.5× dark levels clamp all eight dark
  `--foreground` values to `#ffffff` (making `text-foreground/90` — the
  codebase's most common opacity tint — a pixel-level no-op on six themes),
  and on the light themes the 0.82 default drops `muted-foreground@80%` from
  a passing 4.6:1 to 4.0–4.1:1 — below AA, invisible to `check-themes.mjs`,
  which reads the pre-filter declarations. The exempt-token snapshot is a
  patch over the filter's reach, not a boundary.
- **Reduced motion, high contrast, CVD-safe, dim** — `data-motion`,
  `data-contrast`, `data-cvd`, `data-saturation` (`themeStore.ts:170-204`).
  The reduce-motion block (`globals.css:5138-5153`) is the technique's
  one-door collapse, and it uses **0.01ms, not 0** — the comment states the
  reason: near-instant preserves the *final state* of transition-driven
  styling while removing the travel.

## Startup ordering and deprecation

- Rehydration (`themeStore.ts:361-385`) re-stamps every axis in
  `onRehydrateStorage`, and re-*derives* the custom theme from its stored
  config before applying — the derivation runs at every boot, not once at
  save.
- `RETIRED_THEME_FALLBACKS` (`themeStore.ts:86-89`) is token deprecation done
  right: retired theme ids map to a live replacement at rehydrate, so a
  persisted-but-removed id cannot strand a user on an unbound theme.

## Derived themes: the seed is stored, the gate is advisory

`src/lib/theme/deriveCustomTheme.ts` is the derivation algorithm: full
binding set from a seed (`deriveCustomThemeVars`, `deriveCustomTheme.ts:119-196`)
— hue-locked background/border ladders, fixed per-mode status colors
(`DARK_STATUS`/`LIGHT_STATUS`, lines 92-110, status semantics never derived
from the seed), hue-rotated brand accents, injected as a
`[data-theme="custom"]` block at runtime (`injectCustomThemeStyle`, lines
204-225). The stored artifact is the **config, not the snapshot**
(`CustomThemeConfig`, lines 8-22), so adding a derived variable propagates to
every saved custom theme at next boot — the
`derivation-names-recomputation` clause, satisfied structurally.

**Where it falls short of the technique:** the derived-theme contrast gate is
advisory. `CustomThemeCreator.tsx` renders a live AAA/AA/Low readout
(`CustomThemeCreator.tsx:243-254`, via `src/lib/theme/contrastRatio.ts`), but
a "Low" theme can still be saved — the generator neither adjusts nor refuses,
and the readout grades only the body/button/accent pairs, never the
muted-text pairs the hard gate treats as its floor. Meanwhile that hard gate,
`scripts/check-themes.mjs`, parses `globals.css` only: authored themes are
AA-enforced in CI (`ci.yml:144`), runtime-derived themes are enforced by
nothing. The gap is not hypothetical — the 2026-08 legacy audit
(`docs/concepts/golden-paths/theming-and-contrast.md:473-493`) swept the
derivation formulas across the hue circle and measured the derived dark
`muted/background` pair at **3.07–3.73:1 at every hue** — below the 4.5:1
row every built-in theme is held to. Every derived dark theme would fail the
gate it never meets. The two systems together cover the technique's clause
"derived themes pass the same gates" only for the themes that were never at
risk.
