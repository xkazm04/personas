---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# UI and style

Reference: **`.claude/Design.md`**. Primitives: **`src/features/shared/components/CATALOG.md`**
(`@/features/shared/components/<category>/<Name>`). Doctrine: `docs/design/style-mastery/doctrine.md`
(Gate 0 decided 2026-09-24; Design.md wins where they differ).

## What actually fails (verified 2026-09-24)

- **Census ratchets fail** `npm run check` and pre-push when a count RISES. Style rules:
  `raw-arbitrary-text-size`, `raw-palette-text-colour`, `bare-rounded`, `opacity-dimmed-text`,
  `raw-button-element`, `feature-css-type-literal`, `typo-token-overpainted`,
  `hand-rolled-spinner`, `hand-rolled-disabled-state`, `native-title-tooltip`,
  `hand-painted-modal-backdrop`, `raw-select`, `local-empty-state`. Sites: `npm run census -- --rule <id> --verbose`.
  A drop your real fix caused: `npm run census -- --update` in the same commit. Never `--update` a rise.
- **A `typo-*` name no stylesheet defines fails `npm run check`** (`scripts/style/typo-allowlist.mjs`, zero tolerance).
- **ESLint `custom/*` style rules are warn and fail nothing** (no `--max-warnings` anywhere).
- **The edit-time hook** (`scripts/style/lint-edited.mjs`) reports the style findings on the lines
  you just wrote, each naming the token to use. A report is a defect to fix now; silence means clean.

## Do not hand-roll

| Need | Use |
|---|---|
| busy state on a pressed control | `buttons/AsyncButton` (promise `onClick`) or `buttons/Button loading={flag}` |
| a surface loading its data | ghost under permanent chrome: `display/UnifiedTable` (`isLoading` + `data`), `layout/RouteChunkSkeleton` as Suspense fallback |
| styled `<button>` | `buttons/Button` (icon sizes for icon-only); a tinted one is `variant="accent" tone="success\|error\|agent\|..."`, never a hue |
| modal, backdrop, confirm | `modals/BaseModal`, `feedback/ConfirmDialog` |
| `title=`/tooltip; time, numbers, clipboard | `display/Tooltip`; `display/RelativeTime`, `display/Numeric`, `buttons/CopyButton` |
| switch, select, label+input+error | `forms/AccessibleToggle`, `forms/Listbox`, `forms/FormField` |
| tab strip; "no data" | `layout/PanelTabBar`, `layout/SegmentedTabs`; `feedback/ScenarioEmptyState` |
| row or tile entrance | `display/RevealItem` + `useRevealTracker` |
| section head, trail, stat tile, key-value, chip strip, filter bar, list or table row, tile, detail pane, hint on a mark, unit quantum | the composition kit `@/features/shared/components/kit` (Section, Crumbs, StatStrip, KeyValueGrid, ChipRow, Toolbar/KitButton, Rows/DataTable, ContextCard (few) / ContextOverview (many), Tiles/Tile (dashboard), Split/Drawer, Hint, quantumFor; props: ContextCard `art`, KitButton `tone`/`icon`, UnitStrip `legend`, ListRow `onPress`, Rows `cap`); a one-off duplicate is a finding (doctrine 6b) |

**The kit governs STRUCTURE, not FIGURE (doctrine 6c, 2026-10-03).** The do-not-hand-roll table
above is law for chrome: layout, rhythm, row height, density, status, controls, lists, facts,
empty and loading states. It is **not** law for a drawn figure - geometry, illustration, diagram,
bespoke SVG, a visualization whose point is its shape. The kit exports ~30 parts and exactly two
can draw anything (`UnitStrip`, `ChartFrame`), so treating "compose from the kit" as "everything
must be a kit part" left expressive surfaces with no legal move and produced austere rows. A
figure is **composed into a kit frame and free inside it**, under section 6's existing law: free
layout, tokenised type and colour, reduced-motion honoured, every theme. The test: if replacing
the thing with a labelled list of the same numbers loses nothing, it is structure and the kit owns
it; if that loses the point, it is a figure. A hand-built section head *beside* a figure is still
a finding - the exemption covers the drawing, not its furniture.

**`compact` is for dense tool lists ONLY (doctrine 6c).** Measured with
`scripts/style/kit-type-probe/`: a compact kit host renders every row token **11.1-12.5% smaller**
than the same token outside the kit (`typo-body` 13.20px -> 11.55px at the default appearance
setting). Do not put a showcase, diagnostic or reading surface on `KitHost compact`. Kit tokens
*do* track the appearance setting - that part is not a defect; the size gap is the density tier.

**Spinner boundary:** a spinner is banned for a surface loading its data and required on a control the user just pressed. `feedback/LoadingSpinner` renders `null`: it is neither.
**Loading pattern v2:** `docs/design/overview-loading.md` (chrome always renders; a fetch never hides
rendered rows; a lazy view keeps a module cache, `createModuleCache` when it holds several entries).

## Type and colour gotchas

- Tokens live in `@layer components` (2026-09-24): a utility beside one WINS (`typo-caption
  font-semibold` renders 600). Prefer the token that says it; a common pair is a missing token.
- Tinted tokens keep their colour (Gate 0): `typo-title`, `typo-title-lg`, `typo-section-title`,
  `typo-submodule-header` (primary), `typo-card-label` (glow). A `text-*` beside one now REPLACES
  the tint, so write it only when you mean to lose the tint; otherwise use a colourless tier
  (`typo-body`, `typo-body-lg`, `typo-heading`) plus `text-*`. `typo-caption` mutes via `@layer base`.
- Only names `typography.css` defines exist (`typo-eyebrow` is new); `[&_h1]:typo-*` makes no CSS. Dense tool surfaces opt into `data-type-density="compact"` (ramp one step down; one emphasis per row by weight, figures and meta at 400).
- Colour by meaning: `text-status-*` / `STATUS_PALETTE`, roles `text-role-agent|human|external|highlight`,
  `text-primary`, `text-foreground`. Hierarchy comes from the type scale, never `opacity-*`.

## Bespoke CSS

A feature stylesheet owns layout freely. Type and colour stay tokenised: a `typo-*` class on the
element, `var(--font-*)`, `var(--foreground|--primary|--status-*)` or `color-mix()` over them;
literal px/rem sizes, font families and hex/rgb count in `feature-css-type-literal`.
