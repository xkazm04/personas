# Design.md — Personas Desktop Design System

> Canonical reference for tokens, typography, color, spacing, radius, elevation,
> motion, and component primitives. Read this before adding any new UI surface.
> Every value below is copied from live source; the defining file is cited per
> section. Cross-references: [`src/features/shared/components/CATALOG.md`](../src/features/shared/components/CATALOG.md)
> (primitive inventory) and [`docs/refactor/shared-component-reuse.md`](../docs/refactor/shared-component-reuse.md)
> (don't-hand-roll table).

---

## 1. Principles

1. **Token-first.** Never hardcode a size, color, radius, shadow, or duration
   that a token covers. Tokens live in `src/styles/globals.css` (CSS custom
   properties, bridged into Tailwind 4 via the `@theme` block) and
   `src/lib/utils/designTokens.ts` (JS-side class-string tokens).
2. **Semantic over raw.** `typo-heading` over `text-sm font-bold`,
   `rounded-card` over `rounded-xl`, `shadow-elevation-2` over `shadow-md`,
   `text-status-success` over a named Tailwind color. Custom ESLint rules warn
   on the raw forms (see §8).
3. **Both themes, always.** The app ships 10 named themes (7 dark, 3 light) on
   one token contract. Any literal `white`/`black` styling breaks the light
   themes; use `--foreground`/`--background`-derived tokens and add
   `[data-theme^="light"]` overrides when a surface needs light-specific tuning.
4. **Hierarchy by type + color tokens, not opacity.** Muted/low-opacity text is
   the #1 legibility bug across themes; `custom/no-low-contrast-text-classes`
   enforces this (§8).
5. **Accessibility is gated.** `npm run check:themes` (CI) hard-fails any theme
   whose body/muted text pairs drop below WCAG AA 4.5:1. Reduced-motion is a
   contract, not a nice-to-have (§6).

---

## 2. Typography

Defined in **`src/styles/typography.css`**. Use semantic `.typo-*` classes, not
raw Tailwind text-size combos (`custom/no-raw-text-classes` warns). Gate 0
(2026-09-24) decided the current system; doctrine and history:
`docs/design/style-mastery/doctrine.md`.

> **Weight is a signal, not decoration.** Body and secondary prose (`typo-body`,
> `typo-caption`, `typo-code`) sit at **400**, because they are what most of the
> app is made of. Weight climbs only when something earns it: 600 for titles and
> section headers, 700 for headings, hero, labels and eyebrows. If a description
> renders as heavy as the title above it, the hierarchy is gone. When a caption
> needs to stand out, promote it to `typo-title` rather than adding a `font-*`
> utility: the utility now applies (§2 cascade below), but it is a second voice
> where a token already exists.

Sizes are `calc(step * --type-f)`: a seven-step ramp times ONE factor per text
scale. The sizes below are at the default **Standard** scale (`larger`, 16.5px
root, factor 1).

| Class | Size (Standard) | Weight | Line-height | Notes |
|---|---|---|---|---|
| `typo-hero` | 2.75rem (step 6) | 700 | 1.15 | Page greeting; `-0.015em` tracking |
| `typo-heading-lg` | 1.5rem (step 4) | 700 | 1.3 | Page or modal title |
| `typo-submodule-header` | 1.25rem (step 3) | 600 | 1.3 | Agent submodule dividers; primary-tinted |
| `typo-section-title` | 1.25rem (step 3) | 600 | 1.3 | Section dividers; primary-tinted (dark) / 80% foreground (light). Was 1.125rem until Gate 0 |
| `typo-title-lg` | 1.125rem (step 2) | 600 | 1.45 | Content headline; primary-tinted |
| `typo-body-lg` | 1.125rem (step 2) | 400 | 1.7 | Lead prose |
| `typo-heading` | 1rem (step 1) | 700 | 1.4 | Card and panel heads |
| `typo-title` | 1rem (step 1) | 600 | 1.4 | Name of a thing in a row or field; primary-tinted |
| `typo-body` | 1rem (step 1) | 400 | 1.65 | Paragraphs, descriptions |
| `typo-caption` | 1rem (step 1) | 400 | 1.5 | Secondary text; **normal weight on purpose**. Color = 70% foreground via `@layer base`, so a `text-*` beside it wins |
| `typo-data` | 1rem (step 1) | 500 | 1.4 | Numbers/metrics; tabular + lining nums |
| `typo-data-lg` | 1.75rem (step 5) | 700 | 1.2 | Lead metric |
| `typo-label` | 0.875rem (step 0) | 600 | 1.4 | Sentence case, `0.01em`; badges, chips, column heads. **Not for sentences**: ~6+ words or wrapping text is `typo-caption` |
| `typo-eyebrow` | 0.875rem (step 0) | 700 | 1.4 | NEW (Gate 0): tracked (`0.06em`) uppercase head of a section inside a surface. Colourless. Replaces hand-composed `typo-* uppercase tracking-*` as modules migrate |
| `typo-code` | 0.875rem (step 0) | 400 | 1.5 | `--font-mono` (Cascadia Mono); slashed zero, ligatures off |
| `typo-card-label` | 0.875rem (step 0) | 600 | 1.3 | Theme-adaptive card label with primary text-shadow glow (dark) / subtle shadow (light) |

Nothing sits below step 0 (0.875rem) at Standard. The tinted tokens
(`typo-title`, `typo-title-lg`, `typo-section-title`, `typo-submodule-header`,
`typo-card-label`) keep their colour: removing it was considered and rejected at
Gate 0.

Composable feature presets: `.font-data` (tabular+lining nums), `.font-code`
(slashed zero), `.font-display` (kern+liga+calt), `.font-smallcaps`. Modifier:
`.typo-weight-light` (unlayered, beats the token weight and any `font-*`).

**Text scale & density.** `[data-text-scale]` sets the root font-size (large 15,
larger 16.5, xl 18 px; the retired compact 13 and default 14 keep their rules)
AND one factor `--type-f` (0.9375 / 1 / 1.0625; 0.8125 / 0.875). Body-sized
tokens render 14.06 / 16.5 / 19.13 px, and a caption is never smaller than body.
`[data-density="compact|cozy"]` also adjusts `typo-body`/`typo-body-lg`
line-height. Never assume a fixed pixel size.

**Fonts.** `--font-sans` = `system-ui, 'Segoe UI Variable Text', 'Segoe UI',
-apple-system, sans-serif` (renders Segoe UI on Windows); `--font-mono` =
`'Cascadia Mono', Consolas, 'Fira Code', ui-monospace, monospace`. No web font is
bundled: 'Inter' and 'JetBrains Mono' were named here and never loaded, so they
were removed at Gate 0.

**Language awareness.** `[data-lang]` on `<html>` selects the font stack
(`Noto Sans SC/JP/KR/Arabic/Devanagari/Bengali` fall back to `--font-sans`).
CJK/Devanagari/Arabic get taller line-heights; Arabic and CJK `typo-label` and
`typo-eyebrow` drop letter-spacing (and the eyebrow its uppercase). Don't fight
these overrides in components.

> **Cascade (since 2026-09-24):** the `.typo-*` tokens live in
> `@layer components`, below Tailwind's `utilities`. A utility beside a token
> **wins**: `typo-heading text-lg` renders the larger size, `typo-caption
> font-semibold` renders 600, and a `text-*` beside a tinted token replaces its
> tint. That is why a patch is now a real choice, not a no-op: prefer the token
> that already says it, and never add a `text-*` colour to a tinted title just to
> repeat what it is. Still unlayered (they beat utilities): the text-scale rules
> for `.text-xs` / `.text-sm` / `.text-[Npx]` in globals.css, `.typo-weight-light`,
> `.fleet-typescale` overrides. `[&_x]:typo-*` arbitrary variants generate no CSS
> at all: a token cannot be delivered to a child that way.

---

## 3. Color

Defined in **`src/styles/globals.css`** — `:root` holds the dark base defaults,
each `[data-theme="..."]` block overrides them, and the `@theme` block bridges
every variable into Tailwind (`--color-*` → `bg-/text-/border-` utilities).
Tailwind-class status tokens live in **`src/lib/design/statusTokens.ts`**.

### Core surface & text tokens (`:root` dark base)

| Token | Utility | Dark-base value | Role |
|---|---|---|---|
| `--background` | `bg-background` | `#0a0e14` | App canvas |
| `--foreground` | `text-foreground` | `#e2e8f0` | Body text (white in dark, black in light) |
| `--muted-foreground` | `text-muted-foreground` | `#bcc8d8` | Structural micro-labels ONLY — forbidden on body content (§8) |
| `--muted` / `--muted-dark` | `text-muted` | `#8c9aae` / `#6e7e92` | Tertiary/dim text |
| `--primary` | `text-primary`, `bg-primary` | `#06b6d4` | Theme accent — titles, active states, focus |
| `--secondary` | `bg-secondary` | `#1e293b` | Raised surface fill |
| `--accent` | (focus ring source) | `#22d3ee` | Bright accent |
| `--card-bg` / `--card-border` | `bg-card-bg`, `border-card-border` | `rgba(255,255,255,0.05)` / `0.10` | Card chrome |
| `--border` | `border-border` | `#1e293b` | Generic borders |
| `--btn-primary` / `--btn-primary-fg` | `bg-btn-primary` | `#0e7490` / `#ffffff` | Solid CTA |

Border hierarchy (JS tokens, `designTokens.ts`): `BORDER_SUBTLE`
(`border-primary/5` — dividers), `BORDER_DEFAULT` (`border-primary/12` — cards,
inputs at rest), `BORDER_EMPHASIS` (`border-primary/20` — focus/hover/active),
plus `BORDER_HOVER`, `DIVIDE_SUBTLE`.

### Status tokens

Two parallel systems, both derived from the same palette:

- **CSS variables** (`globals.css`): `--status-{success,warning,error,info,pending,processing,neutral}`
  → utilities `text-status-success`, `bg-status-error`, etc. Dark-base raws:
  success `#34d399`, warning `#fbbf24`, error `#f87171`, info `#60a5fa`,
  neutral `#94a3b8`. These are brightness-compensated per
  `[data-brightness=…]` tier so they render true under the global brightness
  filter — another reason to never bypass them.
- **Tailwind class bundles** (`statusTokens.ts`): `STATUS_PALETTE` (success /
  warning / error / info / neutral) and `STATUS_PALETTE_EXTENDED` (+ ai/violet,
  rotation/cyan, critical/rose, caution/orange). Each `StatusToken` gives
  `{ text, bg, border, ring, icon }`, e.g. success = `text-emerald-400` /
  `bg-emerald-500/10` / `border-emerald-500/30`. Derive badges/chips/severity
  accents from here (`SEVERITY_ACCENTS`, `STATUS_COLORS` in `designTokens.ts`)
  — never invent a new red.

### Themes & the light-override pattern

Theme roster (`globals.css` `[data-theme=…]` blocks): dark base (`:root`),
`dark-cyan`, `dark-bronze`, `dark-frost`, `dark-purple`, `dark-pink`,
`dark-red`, `dark-matrix`, `light`, `light-ice`, `light-news`. Two structural
families exist by convention (see e.g. the `dark-bronze` block comment): the
**all-over-tint** themes color the whole canvas, while **reserved-accent**
themes (Red, Matrix, Bronze) keep a near-achromatic canvas and put the hue only
in `--primary`/`--accent`. New themes must pick a family and must pass
`npm run check:themes` — a WCAG audit (`scripts/check-themes.mjs`, CI-gated)
that hard-fails if foreground / muted-foreground (incl. at the 0.8
caption-opacity floor) / muted vs background drop below AA 4.5:1 in ANY theme.

Light-specific tuning uses the prefix selector, matching all three light themes:

```css
[data-theme^="light"] .my-surface { /* light override */ }
```

(typography.css also pairs it with `:root[class*="light"]`.)

### Caveats

- **`text-white/*` and `bg-white/*` are forbidden** — they don't flip under
  `[data-theme^="light"]`. Use `text-foreground` / `bg-secondary` (or
  `bg-background/N`). Enforced by `custom/no-direct-white-colors` (§8).
- **`bg-/ring-/border-brand-*` are unreliable under Tailwind v4** — the
  `--color-brand-{cyan,purple,emerald,amber,rose}` bridge exists in `@theme`,
  but these utilities have been observed to drop out of the build. Use
  `primary` and the `status-*` tokens instead for new work.
- Glass surfaces: `.glass-sm` (z-10 dropdowns), `.glass-md` (z-20 modals),
  `.glass-lg` (z-30 blocking overlays) — background + blur + primary-tinted
  border in one class. Backdrop-blur tiers `surface-blur-{modal,popover,tooltip}`
  (12/8/4 px) mirror z-depth and are disabled under reduced motion.

---

## 4. Spacing & Layout

Defined in **`src/lib/utils/designTokens.ts`** (JS class-string tokens) backed
by CSS variables in `globals.css`.

| JS token | Emits | Resolves to (comfortable default) | Use for |
|---|---|---|---|
| `CARD_PADDING.standard` | `p-[var(--density-pad)]` | 16px | Normal card body |
| `CARD_PADDING.compact` | `p-[var(--density-pad-sm)]` | 12px | Dense cards |
| `CARD_PADDING.dense` | `px-4 py-[var(--density-pad-sm)]` | 16/12px | Mobile-compact card body |
| `CARD_PADDING.modalSection` | `px-6 py-4` | fixed | Modal header/tabs/footer bands (does NOT breathe with density) |
| `SECTION_GAP.within` | `space-y-[var(--density-gap)]` | 16px | Sections inside a panel |
| `SECTION_GAP.between` | `space-y-[var(--density-gap-lg)]` | 24px | Page-level sections |
| `LIST_ITEM_GAP.dense` / `.cards` | `gap-1.5` / `gap-2.5` | 6/10px | List rows / card grids |
| `FORM_FIELD_GAP` | `space-y-4` | 16px | Between form fields |
| `INPUT_FIELD` / `inputFieldClass(hasError)` | full input class string | — | Every text input (incl. error variant) |
| `TOOLS_BTN_STANDARD` / `TOOLS_BTN_COMPACT` | `px-3 py-1.5` / `px-2 py-1` | — | Tool/connector action buttons |
| `STATE_DISABLED_OPACITY` | `disabled:is-disabled` | opacity `--disabled-opacity` = 0.45 + cursor + pointer-events-none | Disabled controls |
| `STATE_LOCKED` | overlay classes | — | Locked cards (overlay, not compounded opacity) |

**When JS tokens vs raw Tailwind spacing:** use the JS tokens for the
intent-bearing cases above (card padding, section gaps, inputs, disabled state)
— they are density-aware via `--density-pad*`/`--density-gap*`, which the
Appearance "Density" setting re-maps (`cozy` loosens, `compact` tightens; see
`[data-density]` blocks in globals.css). Raw Tailwind spacing on the 4px grid
(`SPACING`: 1,2,3,4,6,8,12,16) is fine for one-off internal micro-layout that
no token names. `custom/no-raw-spacing-classes` exists but is currently `off`.

Content min-width tiers for desktop surfaces: `--content-min-width-{sm,md,lg,xl}`
= 640 / 800 / 920 / 1180 px (prefer breakpoint-tiered Tailwind classes; the
vars are for imperative width math). Extra breakpoints: `3xl` 1920px, `4xl` 2560px.

---

## 5. Radius & Elevation

Defined in **`src/styles/globals.css`** (`:root` + `@theme`).

### Semantic radii — use these, not `rounded-sm/md/lg/xl`

| Utility | Value | Use for |
|---|---|---|
| `rounded-interactive` | 0.375rem (6px) | Buttons, toggles, chips |
| `rounded-input` | 0.5rem (8px) | Inputs, selects, textareas |
| `rounded-card` | 0.75rem (12px) | Cards, panels, tiles |
| `rounded-modal` | 1rem (16px) | Modals, dialogs, sheets |
| `rounded-pill` | 9999px | Pills, badges (allowed alongside `rounded-full`/`rounded-none`) |

Back-compat aliases: `rounded-container` (= card), `rounded-secondary` (= sm).
Enforced by `custom/no-raw-radius-classes` (warn).

### Elevation — use these, not `shadow-sm/md/lg/xl/2xl`

| Utility | Value | Use for |
|---|---|---|
| `shadow-elevation-1` | `0 1px 2px rgba(0,0,0,.3), 0 1px 3px rgba(0,0,0,.15)` | Cards, subtle surfaces |
| `shadow-elevation-2` | `0 2px 4px rgba(0,0,0,.35), 0 4px 8px rgba(0,0,0,.2)` | Dropdowns, raised panels |
| `shadow-elevation-3` | `0 4px 8px rgba(0,0,0,.4), 0 8px 16px rgba(0,0,0,.25)` | Modals, popovers |
| `shadow-elevation-4` | `0 8px 16px rgba(0,0,0,.5), 0 16px 32px rgba(0,0,0,.3)` | Toasts, floating overlays |

The `@theme` block re-points Tailwind's default shadow scale at these tiers
(`shadow-md` → elevation-2, etc.), so accidental raw usage still resolves
correctly — but write the semantic name (`custom/no-raw-shadow-classes` warns).

---

## 6. Motion

Sources: **`globals.css`** (`--duration-*`, keyframes), **`designTokens.ts`**
(`MOTION` registry), **`src/hooks/utility/interaction/useMotion.ts`** and
**`src/lib/utils/animation/animationPresets.ts`** (Framer presets + the
reduced-motion gate).

### Durations & easing

| Tier | CSS var / JS | Value | Use for |
|---|---|---|---|
| instant | `--duration-instant` / `MOTION.duration.instant` | 50ms | Micro-interactions |
| fast | `--duration-fast` / `.fast` | 150ms | Dropdowns, toggles (`MOTION_PRESETS.snappy`) |
| normal | `--duration-normal` / `.normal` | 250ms | Panels, modals (`MOTION_PRESETS.smooth`, `TRANSITION_NORMAL`) |
| slow | `--duration-slow` / `.slow` | 400ms | Page transitions, large reveals (`MOTION_PRESETS.gentle`, `TRANSITION_SLOW`) |

Standard ease curve: `[0.22, 1, 0.36, 1]` (`EASE_CURVE`); standard spring:
`stiffness 300 / damping 25`. Stagger: `staggerContainer`/`staggerItem` (40ms
children, y:12 fade-up) and `dashboardContainer`/`dashboardItem` (50ms, y:8).
Tooltip hover-intent delays: `MOTION.delay.tooltip` = 150ms (deliberate help)
/ 400ms (incidental reveals). Every `setTimeout`/transition driving UI motion
should derive from this registry. Shared CSS keyframes (float, pulse-slow,
tooltip-in, expand-in, fade-*, shake-error, draw-check, …) live in globals.css
— reuse before adding new ones.

### Reduced-motion posture (contract)

1. The app root wraps everything in `<MotionConfig reducedMotion={...}>`
   (`src/App.tsx` — "always" when the document is hidden), which kills one-shot
   transform/layout animations under `prefers-reduced-motion`.
2. That global gate does NOT stop **looping** non-transform animations (opacity
   pulses, dash marches). `custom/enforce-reduced-motion-fallback` flags
   `repeat:` animations in files with no fallback. Satisfy it with
   `useMotionVariants()` (preferred — strips transforms/timing, keeps opacity),
   `useReducedMotion()` / `useMotion().shouldAnimate`, or a
   `// reduced-motion-ok: <reason>` opt-out.
3. CSS side: pair transitions with `motion-reduce:` variants
   (`CSS_DURATION_CLASS` bundles this), and note globals.css disables
   backdrop-blur and several `animate-*` classes under
   `@media (prefers-reduced-motion: reduce)`.

Higher-level motion vocabulary (draw, staggered-draw, fade-pop, float, pulse,
hover-response, success-settle) for icon/empty-state reveals comes from the
**`/motionize` skill** — see [`.claude/skills/motionize/SKILL.md`](./skills/motionize/SKILL.md)
and the `MotionizedGlyph` shared component; don't re-invent reveal choreography.

---

## 7. Component Primitives

**Check [`src/features/shared/components/CATALOG.md`](../src/features/shared/components/CATALOG.md)
before writing any UI** — ~115+ domain-agnostic primitives across categories:
buttons · display · editors · feedback · forms · icons · kanban · layout ·
overlays · progress · terminal. Import as
`@/features/shared/components/<category>/<Name>`.

The don't-hand-roll quick table (full version in
[`docs/refactor/shared-component-reuse.md`](../docs/refactor/shared-component-reuse.md)):
empty state → `feedback/ScenarioEmptyState` (default export, imported as
`EmptyState`; `NoResults`/`InboxZero` wrappers alongside it) — chart panels use
`display/ChartEmptyState`, a compact generic block `display/EmptyIllustration`;
styled `<button>` → `buttons/Button`/`AsyncButton`; clipboard →
`buttons/CopyButton`; modal backdrop → `modals/BaseModal`/`feedback/ConfirmDialog`;
tooltip → `display/Tooltip`; timestamps → `display/RelativeTime`; number
formatting → `display/Numeric`; switch → `forms/AccessibleToggle`; dropdown →
`forms/Listbox`; label+input+error → `forms/FormField`; tab strip →
`layout/PanelTabBar`/`SegmentedTabs`; table + its skeleton/empty/stagger →
`display/UnifiedTable` (pass `isLoading` + `data`).

**Loading is deliberately absent from that list, because there is no single
answer — there are two opposite ones.** A **surface** fetching its data gets a
calm delayed ghost under permanent chrome and **never** a spinner
([`docs/design/overview-loading.md`](../docs/design/overview-loading.md)); a
**control the user just pressed** gets a real spinner, and that is what
`buttons/AsyncButton` renders
([`docs/concepts/golden-paths/inline-busy-state.md`](../docs/concepts/golden-paths/inline-busy-state.md)).
**`feedback/LoadingSpinner` serves neither** — it renders `null` (spinners are
disabled app-wide) and survives only for import compatibility plus an `sr-only`
`role="status"` when given a `label`. Earlier revisions of this file listed it
as the canonical spinner; that was wrong, and it is why 184 files under
`src/features/**` hand-roll `animate-spin`. Never render it as a busy branch.

Rules of the folder: `shared/components/**` stays **primitives-only** (no
`@/stores`, `@/api`, `@/lib/bindings`, or feature imports — advisory ESLint
boundary warning). App-shell chrome lives in `shared/chrome/`; domain
components in their feature. New reusable primitives go INTO the catalog folder
with a `@catalog <one-line>` JSDoc tag, then `npm run gen:catalog`.

**Component size:** keep component files under ~200 LOC — extract
sub-components instead of growing one file (operator directive).

Focus & disabled primitives (globals.css utilities): `focus-ring` on every
interactive element (`--focus-ring-color` = 60% accent, 2px width/offset);
`is-disabled` for the unified inert state; `.btn-sm/.btn-md/.btn-lg` size
presets; `.icon-frame[-xs|-sm|-md|-lg]` (+ `-pop`) for persona icons.

---

## 8. Do's and Don'ts

Every Don't is paired with the automated check that catches it. Measured
2026-09-24 in `eslint.config.js`: 22 custom rules, 5 at `error`
(`no-silent-catch`, `no-loose-event-payload`, `role-button-requires-keydown`,
`no-whole-store-subscription`, `no-unstable-store-selector`), 16 at `warn`,
1 `off`. Every style rule is `warn`, which fails no gate (`npm run check` has
no `--max-warnings`); treat a warning as an error in new code anyway. What
fails a style slip is a **census ratchet** in `scripts/census/rules.json`: its
count may not rise (`npm run census -- --rule <id> --verbose` lists the sites).

| Don't | Do instead | Caught by |
|---|---|---|
| Raw text-size classes (`text-xs`…`text-4xl`) in JSX | Semantic `typo-*` class (§2 mapping) | `custom/no-raw-text-classes` |
| `text-white`, `bg-white` (any opacity) | `text-foreground`, `bg-secondary` | `custom/no-direct-white-colors` |
| `text-muted-foreground[/N]` or `text-foreground/≤80` on body content | Bare `text-foreground`; hierarchy via type scale + `text-primary`, never opacity | `custom/no-low-contrast-text-classes` |
| Raw `rounded-sm/md/lg/xl` | `rounded-interactive/input/card/modal/pill` | `custom/no-raw-radius-classes` |
| Raw `shadow-sm/md/lg/xl/2xl` | `shadow-elevation-1..4` | `custom/no-raw-shadow-classes` |
| Hand-rolled `role="dialog"` / `fixed inset-0` modal | `modals/BaseModal` / `feedback/ConfirmDialog` | `custom/enforce-base-modal` |
| Hardcoded English strings in JSX / placeholder / title / aria-label | `t.section.key` via `useTranslation()` | `custom/no-hardcoded-jsx-text` + `check:i18n:strict` |
| Looping framer animation without a reduced-motion fallback | `useMotionVariants()` / `useMotion().shouldAnimate` | `custom/enforce-reduced-motion-fallback` |
| Raw `.toFixed()` / `.toLocaleString()` for display | `display/Numeric` | `custom/prefer-numeric` |
| `navigator.clipboard.writeText` | `buttons/CopyButton` / `useCopyToClipboard` | `custom/prefer-shared-clipboard` |
| Ad-hoc status pill markup | `display/StatusBadge` + `tokenLabel()` | `custom/prefer-status-badge` |
| Empty `catch {}` | `toastCatch()` / `silentCatch()` | `custom/no-silent-catch` |
| `bg-/ring-/border-brand-*` in new work | `primary` + `status-*` tokens | (no lint — known Tailwind v4 build unreliability, §3) |
| Utility patch over a `typo-*` token (`typo-heading font-bold`) | Move to another token, or restyle it in `typography.css` | census `typo-token-overpainted` (font-weight patches; a size or colour patch is not matched) |
| Raw palette text colour (`text-emerald-400`, `text-red-500/70`) | `text-status-*` / `STATUS_PALETTE`, `text-primary`, `text-foreground` | census `raw-palette-text-colour` |
| Arbitrary text size (`text-[11px]`, `text-[0.8rem]`) | A `typo-*` tier (§2) | census `raw-arbitrary-text-size` + `custom/no-raw-text-classes` |
| Bare `rounded` (the 0.25rem default, off the radius scale) | `rounded-interactive/input/card/modal` | census `bare-rounded` |
| `text-foreground` dimmed with `opacity-10`..`opacity-89` | Bare `text-foreground` on a smaller `typo-*` tier | census `opacity-dimmed-text` |
| A `typo-*` name no stylesheet defines (`typo-body-sm`, `typo-overline`) | A defined token from §2 | `scripts/style/typo-allowlist.mjs` in `npm run check` (zero tolerance since 2026-09-24) + `custom/no-raw-text-classes` |
| Styled raw `<button>` outside `shared/components` | `buttons/Button` / `buttons/AsyncButton` | census `raw-button-element` |
| px/rem `font-size`, literal `font-family`, hex/rgb colour in feature CSS | `typo-*` on the element; `var(--font-*)`; `var(--foreground/--primary/--status-*)` | census `feature-css-type-literal` |
| New theme or token color shipped unchecked | Run `npm run check:themes` (AA gate, CI) | `scripts/check-themes.mjs` |
| Raw ad-hoc spacing where a token exists | `CARD_PADDING` / `SECTION_GAP` / `INPUT_FIELD` (§4) | `custom/no-raw-spacing-classes` (currently off — self-discipline) |
| 200+ LOC component file | Extract sub-components | (review convention) |

**Do, affirmatively:**

- Start from tokens: `typo-*` + `text-foreground`/`text-primary` +
  `rounded-*` semantic + `shadow-elevation-*` + `CARD_PADDING`/`SECTION_GAP`.
- Add `focus-ring` to every interactive element; use `is-disabled` for inert
  states; keep touch targets ≥44px (globals.css enforces on `pointer: coarse`).
- Check CATALOG.md first; give new primitives a `@catalog` tag.
- Add `[data-theme^="light"]` overrides whenever a surface hand-tunes color.
- Derive all status coloring from `STATUS_PALETTE[_EXTENDED]` / `status-*` vars.
- Source every duration from `MOTION` / `MOTION_PRESETS`; respect
  reduced-motion on anything that loops.
