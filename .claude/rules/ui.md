---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
---

# UI and style

Reference: **`.claude/Design.md`**. Primitives: **`src/features/shared/components/CATALOG.md`**
(`@/features/shared/components/<category>/<Name>`). Doctrine: `docs/design/style-mastery/doctrine.md`,
DRAFT until Gate 0 (Design.md wins where they differ).

## What actually fails (verified 2026-09-24)

- **Census ratchets fail** `npm run check` and pre-push when a count RISES. Style rules:
  `raw-arbitrary-text-size`, `raw-palette-text-colour`, `bare-rounded`, `opacity-dimmed-text`,
  `phantom-typo-token`, `raw-button-element`, `feature-css-type-literal`, `typo-token-overpainted`,
  `hand-rolled-spinner`, `hand-rolled-disabled-state`, `native-title-tooltip`,
  `hand-painted-modal-backdrop`, `raw-select`, `local-empty-state`. Sites: `npm run census -- --rule <id> --verbose`.
  A drop your real fix caused: `npm run census -- --update` in the same commit. Never `--update` a rise.
- **ESLint `custom/*` style rules are warn and fail nothing** (no `--max-warnings` anywhere).
- **The edit-time hook** (`scripts/style/lint-edited.mjs`) reports the style findings on the lines
  you just wrote, each naming the token to use. A report is a defect to fix now; silence means clean.

## Do not hand-roll

| Need | Use |
|---|---|
| busy state on a pressed control | `buttons/AsyncButton` (promise `onClick`) or `buttons/Button loading={flag}` |
| a surface loading its data | ghost under permanent chrome: `display/UnifiedTable` (`isLoading` + `data`), `layout/RouteChunkSkeleton` as Suspense fallback |
| styled `<button>` | `buttons/Button` (icon sizes for icon-only) |
| modal, backdrop, confirm | `modals/BaseModal`, `feedback/ConfirmDialog` |
| `title=` or a custom tooltip | `display/Tooltip` |
| time, numbers, clipboard | `display/RelativeTime`, `display/Numeric`, `buttons/CopyButton` |
| switch, select, label+input+error | `forms/AccessibleToggle`, `forms/Listbox`, `forms/FormField` |
| tab strip; "no data" | `layout/PanelTabBar`, `layout/SegmentedTabs`; `feedback/ScenarioEmptyState` |
| row or tile entrance | `display/RevealItem` + `useRevealTracker` |

**Spinner boundary:** a spinner is banned for a surface loading its data and required on a control
the user just pressed. `feedback/LoadingSpinner` renders `null`: it is neither.
**Loading pattern v2:** `docs/design/overview-loading.md` (chrome always renders; a fetch never hides
rendered rows; a lazy view keeps a module cache, `createModuleCache` when it holds several entries).

## Type and colour gotchas

- `typography.css` is unlayered: a `typo-*` rule beats any Tailwind utility on the same property.
  `typo-caption font-semibold` is a silent no-op. Move to another token; do not patch it.
- Tokens that paint colour and beat a sibling `text-*`: `typo-title`, `typo-title-lg`,
  `typo-section-title`, `typo-submodule-header` (primary-tinted), `typo-card-label`. Pick them for
  that colour or use a colourless tier (`typo-body`, `typo-body-lg`, `typo-heading`) plus `text-*`.
  `typo-caption` is muted through `@layer base`, so a `text-*` next to it wins.
- Only names `typography.css` defines exist; `typo-body-sm`, `typo-overline`, `typo-h3` render unstyled.
- Colour by meaning: `text-status-*` / `STATUS_PALETTE`, `text-primary`, `text-foreground`. Hierarchy
  comes from the type scale, never from `opacity-*` or `text-foreground/60`.

## Bespoke CSS

A feature stylesheet owns layout freely. Type and colour stay tokenised: a `typo-*` class on the
element, `var(--font-*)`, `var(--foreground|--primary|--status-*)` or `color-mix()` over them;
literal px/rem sizes, font families and hex/rgb count in `feature-css-type-literal`.
