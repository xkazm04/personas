# Shared Component Reuse — audit, quick reference & backlog

> Authored 2026-05-24. Companion to the auto-generated
> [`src/features/shared/components/CATALOG.md`](../../src/features/shared/components/CATALOG.md)
> (the full index) and enforced by the CLAUDE.md "Reusing shared components" rule.

The problem this addresses: feature code keeps **re-implementing UI that already
exists in `shared/`** because there was no discoverable index and no rule pointing
to it. This doc has three parts: the **quick reference** (use X, not hand-rolled Y),
the **audit** (what's actually being reinvented, with counts), and the **backlog**
(what to extract/consolidate next).

---

## 1. Quick reference — use these, don't hand-roll

| Instead of hand-rolling… | Use | Import |
|---|---|---|
| `<div className="animate-spin">` / local Spinner | `LoadingSpinner` | `@/features/shared/components/feedback/LoadingSpinner` |
| a "no data / nothing here" block | `EmptyState` | `@/features/shared/components/feedback/EmptyState` |
| `<button className="…">` with styling | `Button` / `AsyncButton` | `@/features/shared/components/buttons/Button` |
| `navigator.clipboard.writeText(…)` + feedback | `CopyButton` / `useCopyToClipboard` | `@/features/shared/components/buttons/CopyButton` |
| `fixed inset-0` backdrop + escape handling | `BaseModal` / `ConfirmDialog` | `@/features/shared/components/modals/BaseModal` |
| `title="…"` / custom hover tooltip | `Tooltip` | `@/features/shared/components/display/Tooltip` |
| `new Date().toLocaleString()` "ago"/recency display | `RelativeTime` | `@/features/shared/components/display/RelativeTime` |
| `new Date().toLocaleString()` fixed date in JSX | `AbsoluteTime` | `@/features/shared/components/display/AbsoluteTime` |
| date formatting in a string (non-JSX) | `formatTimestamp` / `formatRelativeTime` | `@/lib/utils/formatters` |
| `value.toFixed(n)` / `toLocaleString()` for display | `Numeric` (+ `formatters` in `@/lib/utils/formatters`) | `@/features/shared/components/display/Numeric` |
| `<input type="checkbox">` styled as a switch | `AccessibleToggle` | `@/features/shared/components/forms/AccessibleToggle` |
| `<select>` / custom dropdown | `Listbox` | `@/features/shared/components/forms/Listbox` |
| label + input + error wrapper | `FormField` | `@/features/shared/components/forms/FormField` |
| custom tab strip | `PanelTabBar` / `SegmentedTabs` | `@/features/shared/components/layout/PanelTabBar` |
| grouped content panel | `SectionCard` + `SectionHeader` | `@/features/shared/components/layout/SectionCard` |

Already enforced by custom ESLint rules: `custom/enforce-base-modal` (raw modal
overlays), `custom/no-direct-white-colors`, `custom/no-raw-*-classes` (design
tokens), `custom/role-button-requires-keydown`.

---

## Migration status (2026-05-24)

- ✅ **Clipboard — DONE.** Added `copyText()` as the single canonical owner of
  `navigator.clipboard.writeText`; both hooks (`useCopyToClipboard`,
  `useKeyedCopyFlag`) delegate to it; 25 feature call sites migrated. Enforced
  going forward by `custom/prefer-shared-clipboard`. (Only an e2e test + the
  deferred-dead `ChatMessageContent` retain a raw call.)
- ✅ **Dates — sweep done (meaningful sites migrated).** Created
  `display/AbsoluteTime`. Migrated **~58 JSX date-display sites** across ~44 files
  to `<AbsoluteTime>` (fixed) / `<RelativeTime>` (recency) / `formatTimestamp`
  (string contexts). The **32 remaining `new Date().toLocale*` sites are left by
  design**, not debt: 13 are bespoke compact-format JSX (`{month:'short',hour:'2-digit'}`
  — deliberate, AbsoluteTime's 4 variants don't match), 6 are `.ts` local string
  formatters, 5 are in the active overview-empty-states / twin prototypes, and 8
  are string-context (`.replace`, `title={tx()}`) marginal swaps. **Optional future
  unification:** extend `AbsoluteTime` with a custom-`Intl.DateTimeFormatOptions`
  passthrough to absorb the 13 bespoke-format ones. **Caveat:** the original "131"
  count over-counted — many `toLocaleString()` hits are on **numbers** (e.g.
  NetworkDashboard) → those are the Numeric backlog, not dates.
- ⏸️ **Spinners — LEAVE (design decision 2026-05-24).** `LoadingSpinner` is an
  intentional no-op ("spinners disabled app-wide"); inline `Loader2` is accepted.
  Not migrating — converting to the no-op would silently strip 141 loaders.

## 2. Audit — what's being reinvented (2026-05-24 scan of `src/features/*`, excl. `shared/`)

| Pattern | Occurrences | Worst offenders (examples) | Verdict |
|---|---:|---|---|
| Raw `<button>` w/ styling | ~2,154 across 737 files | pipeline `AssignmentsPanel` (21), langfuse `ManagedStackPanel` (14), overview `MessageDetailModal` (14) | Real but huge — migrate opportunistically + via the `Button` adoption, not a big-bang. |
| Numeric formatting (`toFixed`/`toLocaleString`) | ~240 across 100+ files | settings `NetworkDashboard` (8), overview `PredictiveAlerts` (8) | High ROI, easy — swap to `Numeric`. |
| Date/time formatting | ~131 across 40+ files | settings `PeerDetailDrawer`, overview `MetricsCharts` | Swap to `RelativeTime` (add an absolute-mode if needed). |
| Loading spinners (`animate-spin`, no `LoadingSpinner`) | 141 files | plugins (49), agents (25), vault (18) | Mixed — inline `Loader2` in buttons is fine; full-element loaders should use `LoadingSpinner`. |
| Copy-to-clipboard (`navigator.clipboard.writeText`) | ~31 across 21 files | settings `BundleExportDialog` (4), dev-tools `PrBridge` (4) | Clean swap to `CopyButton`/`useCopyToClipboard`. **Best ESLint-rule candidate.** |
| Custom modal overlays (`fixed inset-0`) | ~20 files | glyph `ComposerPickerShell`, cockpit `DecisionDrawer` | Mostly already `BaseModal`; ~4 real one-offs. |
| Raw checkbox/radio as toggle | ~6 | triggers `Toolbar`, fleet `FleetBroadcastModal` | Low volume; swap to `AccessibleToggle`. |

**Highest ROI migrations:** `Numeric` (240), `CopyButton` (31, cleanest), full-element `LoadingSpinner` swaps. Buttons (2,154) are a long-tail opportunistic migration, not a single task.

### Adoption status (Phase 3)

| Pattern | Rule | Status |
|---|---|---|
| **`Numeric`** (`.toFixed`/`.toLocaleString` in JSX) | `custom/prefer-numeric` | ✅ **Done 2026-06-19** — **0** across `src/features`, enforced (warn). |
| **`StatusBadge`** (hand-rolled variant/accent color combos) | `custom/prefer-status-badge` | ✅ **Done 2026-06-19** — **0** across `src/features`, enforced (warn). |
| **`SectionCard`** (exact-shell reimplementation) | `custom/prefer-section-card` | ✅ **Enforced 2026-06-19** — see note below. |
| **`BaseModal`** (`fixed inset-0`) | `custom/enforce-base-modal` | ⏳ ~4 real one-offs left. |

> **SectionCard — no faithful backlog (the "~350" was a mirage).** `prefer-section-card`
> flags only a `<div>` reimplementing SectionCard's *exact* shell signature
> (`bg-secondary/30` + `border-primary/12` + `shadow-elevation-1`). Across `src/features`
> exactly **2** such elements existed — and both are *bespoke* cards (a rich collapsible
> header; a bordered-header + flush `divide-y` list) that SectionCard's fixed header/padded
> body can't express, so both carry a documented `eslint-disable` rather than a forced
> migration. The "~350 hand-rolled card shells" from the audit are **differently-styled**
> divs (`bg-card-bg`, `border-border`, other radii); converting them to SectionCard would
> *change their appearance* — that is a deliberate **visual redesign with human/visual
> review**, not a mechanical refactor, and is explicitly **out of scope** for the headless
> adoption sweep. The rule's value is therefore purely forward: it stops a future plain
> card from copy-pasting the shell instead of importing `SectionCard`.

~205 sites migrated across 4 subagent waves (settings/vault/teams/triggers/schedules →
plugins/templates/home/shared → agents/overview sub-areas → scattered closeout).
**Key lesson:** the raw audit counts were *heavily inflated* by look-alikes — the true
`Numeric` backlog was ~98 (not ~240; the rest were **dates**, SVG **coords/attr values**,
and **formatter callbacks**), and the true `StatusBadge` backlog was ~75 (not ~250; the
rest were **alert banners**, **step-circles**, **code chips**, and **message boxes** that
merely borrow a status *color*). Both rules were sharpened iteratively against those
false-positive shapes (see `eslint-rules/prefer-numeric.cjs` / `prefer-status-badge.cjs`
header comments), so they now precisely flag *only* genuine display/badge reimplementations.

---

## 3. Backlog — components to CREATE or CONSOLIDATE

| Rank | Action | Spread | Proposed | Effort |
|---|---|---|---|---|
| 1 | **Consolidate the two `EmptyState`s** — `display/EmptyState` (SVG variants, 4 uses) + `feedback/EmptyState` (icon variants, 21 uses) | 2 files / 25 uses | one `feedback/EmptyState` supporting both icon + SVG modes; re-export from display/ | M ⚠️ *coordinate — a `/prototype overview empty-states` session is touching this; do after it lands* |
| 2 | **Extract a `PanelShell` / `DetailPanel`** (header+icon+body+actions+close) | ~100 bespoke `*Panel.tsx` | `layout/PanelShell` | L |
| 3 | **Extract a `ContentCard` / `FeatureCard`** (icon+title+badges+body+actions) | ~69 bespoke `*Card.tsx` | `layout/ContentCard` (or expand `SectionCard`) | L |
| 4 | **Extract `FilterToolbar`** (search + dropdowns + actions row) | ~15 `*Filters.tsx`/`*Toolbar.tsx` | `overlays/FilterToolbar` (FilterBar exists, underused) | M |
| 5 | **Extract `MetricCard`** (StatCard/MetricCard/MetricDeltaCard variants) | ~6 | `display/MetricCard` | S |
| 6 | **Error-banner cleanup** — fold `ErrorRecoveryBanner` into `ErrorBanner` variant; review `InlineErrorRecovery` (0 external uses) | 4 files | — | S |

Adoption of existing primitives is as important as creation: `SectionCard` (~15 uses,
should be ~50+) and `overlays/FilterBar` are underutilized.

---

## 4. The discoverability harness (why this won't regress)

Built 2026-05-24 to close the "new code doesn't know shared components exist" gap:

1. **Generated catalog** — `scripts/docs/gen-shared-catalog.mjs` → `CATALOG.md`, run in
   predev/prebuild codegen + a `check:catalog` drift gate in `npm run check`. Always fresh.
2. **CLAUDE.md rule** — a MANDATORY "Reusing shared components" section every session
   loads, pointing here + to the catalog.
3. **ESLint** — existing `custom/enforce-base-modal` etc.; `navigator.clipboard.writeText`
   is the cleanest next rule candidate (see audit row).

To improve a component's catalog row, add a `@catalog <one-line>` JSDoc tag to it
(or extend the curated map in the generator for the core primitives).

---

## 5. Component families — pick the right one (keep-distinct guide)

> Added 2026-06-18 by the catalog curation (see
> [`catalog-curation.md`](./catalog-curation.md)). Several clusters were reviewed
> for **merging** and deliberately kept **distinct** — they're different
> *treatments*, not copy-paste duplicates, so folding them into one mode-switch
> component would just create a god-component. The real problem they cause is
> "which do I use?", which this table answers. **This supersedes backlog item #1**
> (the EmptyState consolidation): the three empty-state components are distinct and
> stay separate.

| Family | Use… | …for |
|---|---|---|
| **Empty states** | `feedback/EmptyState` | first-run / scenario empties (preset `variant`s + generic icon/title/action; convenience `NoResults`, `InboxZero`) |
| | `display/EmptyIllustration` | a compact, generic "nothing here" block (double-ring icon + heading + CTA) |
| | `display/ChartEmptyState` | an empty **chart panel** (inline area/bar/trace/healing SVGs + glow title) |
| **Status / badge** | `display/StatusBadge` | a semantic status pill (resolve token via `tokenLabel()`) |
| | `display/StatusDot` | an accessibility-first state dot (shape-coded for colorblind safety) |
| | `display/Badge` | a generic tag / count pill (not status) |
| | `display/LiveStatusDot` · `ActivityDot` | decorative, aria-hidden liveness dots in dense rows |
| **Error / recovery** | `feedback/ErrorBanner` | the layout shell (inline / banner / panel) |
| | `feedback/InlineErrorBanner` | a severity-gated (info/warn/error) inline message |
| | `feedback/ErrorRecoveryBanner` | a named recovery action (retry / check-connection / open-settings) |
| | `feedback/InlineErrorRecovery` | when you have a **raw error** to resolve + a success path |
| **Count / number** | `display/Numeric` | format + tabular figures — **wrap** the animators with it |
| | `display/AnimatedCounter` | fade/roll digit animation |
| | `display/SpringCount` | physics-based count-up (cloud feel) |
| **Section headers** | `layout/SectionCard` | a grouped content card (it renders its own header) |
| | `layout/SectionHeader` | a standalone panel header (icon + title + badge + actions) |
| | `display/SectionLabel` | a small uppercase form-group label |
| **Time** | `display/RelativeTime` | a live-updating "2h ago" |
| | `display/AbsoluteTime` | a fixed timestamp (relative time on hover) |
| **Pickers** | `forms/ColorPicker` · `forms/IconSelector` | the **inline** layout (in a form/step) |
| | `forms/PopupColorPicker` · `agents/…/PopupIconSelector` | the **popover** layout (compact trigger) — both already share `useClickOutside` |

If two of these ever genuinely converge (one becomes a strict subset of another
with no visual difference), *then* merge — but verify call sites and visual parity
first. The 2026-06-18 review found none that qualified.
