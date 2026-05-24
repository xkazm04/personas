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
- 🟡 **Dates — primitive built + representative batch done.** Created
  `display/AbsoluteTime` (the missing fixed-date component). Migrated a 4-file /
  9-site batch (PeerDetailDrawer, CloudExecutionRow, CloudOAuthPanel,
  ApiKeysSettings) establishing the JSX→component / string→formatter pattern.
  ~35 genuine date files remain (mechanical follow-up). **Caveat:** the "131"
  count over-counts — many `toLocaleString()` hits are on **numbers** (e.g.
  NetworkDashboard) → those belong to the Numeric backlog, not dates.
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
