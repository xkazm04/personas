# UI Perfectionist — overview-dashboard-metrics

> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

Context: the main dashboard hub — overview dashboard, observability, analytics, director coaching, certification. The recurring theme is **status color and status-pill duplication**: many panels hand-roll `bg-emerald-500/10 text-emerald-400 border-emerald-500/20` chips inline instead of deriving from `statusTokens` / `StatusBadge`, so success/warning/error color drifts subtly panel-to-panel (e.g. `/15` vs `/10` bg, `/25` vs `/20` border) and breaks theme parity.

---

## 1. Observability panel-status chips hand-roll status pills instead of `StatusBadge`/`statusTokens`
- **Severity**: high
- **Category**: token
- **File**: src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:52-72
- **Problem**: The `PanelStatusChips` component builds three near-identical pills with raw `bg-red-500/10 text-red-400 border border-red-500/20`, `bg-amber-500/10 text-amber-400 border-amber-500/20`, and `bg-emerald-500/10 text-emerald-400 border-emerald-500/20`. These duplicate `STATUS_PALETTE.error/warning/success` from `statusTokens.ts` but with hand-picked opacities (`/20` borders instead of the token's `/30`), so the same "failed/stale/ok" semantics render in slightly different colors than every other status surface. This is the single source-of-truth violation the design system explicitly forbids.
- **Fix sketch**: Replace each inline pill with `StatusBadge` driven by a `success|warning|error` token, or at minimum spread `STATUS_PALETTE[...]` (`text`/`bg`/`border`) from `@/lib/design/statusTokens`. Map `hasError → error`, `isStale → warning`, fetched → `success`.

## 2. Hand-built grid "table" in director coaching instead of `UnifiedTable`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_director/components/PersonaCoachingTable.tsx:17, 84-105, 128-235
- **Problem**: This is a full data table — header row + sortable-by-urgency rows + per-column alignment — hand-assembled from a shared `ROW_GRID = 'grid grid-cols-[1.6fr_52px_60px_72px_1.4fr_auto_auto]'`. The catalog ships `UnifiedTable` (with `TableColumn`, sorting, density, aria) specifically to replace hand-built `<table>`/grid tables; `GroundingTable.tsx` in the same feature already uses it correctly. The hand-rolled version re-implements the header, sort, and keyboard-row semantics, and its column widths can drift from any other table.
- **Fix sketch**: Port to `UnifiedTable<DirectorRosterEntry>` with `TableColumn` render fns (agent, score, trend sparkline, value, flags, last-review, actions), reusing its built-in sort + `getRowKey` + `ariaLabel`, matching the sibling `GroundingTable`.

## 3. Director score-band number uses raw `text-[11px]` / `text-[10px]` instead of `Numeric` + type ramp
- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/overview/sub_director/components/PersonaCoachingTable.tsx:155, 170, 202
- **Problem**: The most-scanned figure on this screen — the agent score badge — is rendered as a bare string in an arbitrary `text-[11px] tabular-nums` span (and the delta in `text-[10px]`, attention tags in `text-[10px]`). Arbitrary pixel sizes fight `typography.css`'s ramp and the raw integer bypasses `Numeric` (no locale/tabular guarantee). Three different ad-hoc sizes compete in one cell, weakening hierarchy.
- **Fix sketch**: Wrap the score in `Numeric` and replace `text-[11px]`/`text-[10px]` with the nearest ramp class (`typo-caption`/`typo-label`); reserve arbitrary sizes for nothing here.

## 4. Certification `DimensionBars` & `GroundingTable` duplicate score-threshold color logic inline
- **Severity**: high
- **Category**: token
- **File**: src/features/overview/sub_certification/components/DimensionBars.tsx:5-10; src/features/overview/sub_certification/components/GroundingTable.tsx:7-12
- **Problem**: Both files define their own `barColor`/`pctColor` ramp returning raw `bg-emerald-500`/`text-emerald-400` → `amber` → `rose` at hard-coded thresholds (80/60 vs 90/70). `GateBreakdown.tsx:17,24` repeats the same `emerald/rose/zinc` mapping a third time. These are three private re-derivations of success/warning/error with inconsistent breakpoints and inconsistent palettes (`rose` here vs `red` in `statusTokens`), so "good/bad" reads differently across the cert tab.
- **Fix sketch**: Centralize a single `scoreTone(pct)` helper (the director feature already has `directorScore.scoreTone`) returning a `statusTokens` semantic key, and feed bar/text color from `STATUS_PALETTE`. Standardize on `red` not `rose`.

## 5. Observability header actions are raw `<button title=…>` instead of `Button` + `Tooltip`
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:140-169
- **Problem**: The alert-toggle, refresh, and auto-refresh icon buttons are hand-styled `<button>`s with bespoke `p-1.5 rounded-card border transition-colors` variants and native `title=` tooltips. The catalog mandates `Button` (variants/sizes/icons) and `Tooltip` over bare `title=`. The hand-rolled toggles also re-implement active/inactive border-bg states that `Button` variants already encode, and `title=` gives no styled/touch tooltip. (Same pattern repeats in `CertificationCommandCenter.tsx:74-81` and `RotationOverviewPanel.tsx:160-168,250-270`.)
- **Fix sketch**: Use `Button` (`variant="ghost"`, `size` small, `icon`) for each action and wrap in `Tooltip content={…}`; drive the active state via a variant rather than ad-hoc border classes.

## 6. Notification count badge uses arbitrary `text-[9px]` and red on `text-foreground`
- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:149
- **Problem**: The alert-count dot is a `w-3.5 h-3.5` circle with `text-[9px] font-bold text-foreground` on `bg-red-500`. `text-[9px]` is below the type ramp and `text-foreground` (theme text) on a fixed red fill can fall below contrast in light themes — the count may be illegible. This is a recurring catalog pattern (`BadgeSlot`/count badges) reinvented.
- **Fix sketch**: Use the shared count-badge/`BadgeSlot` pattern, or at minimum `text-white`/`typo-label` on the red fill, and pull `bg-red-500` from `STATUS_PALETTE.error.icon` for theme consistency.

## 7. Director value-bar and score-distribution bars mix `var(--status-success)`, `scoreTone` hex, and raw gradients
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_director/components/PersonaCoachingTable.tsx:190; src/features/overview/sub_director/components/ScoreDistribution.tsx:72
- **Problem**: The value-delivered mini-bar fills with `background: 'var(--status-success)'` (CSS var) while the score histogram fills with `linear-gradient(...scoreTone.color...)` (JS hex) and the dimension bars (finding 4) use `bg-emerald-500` Tailwind classes. Three different mechanisms express "success/score color" within the same dashboard, making green inconsistent and impossible to retheme in one place.
- **Fix sketch**: Pick one channel — prefer the CSS custom props (`var(--status-success)` / `var(--status-*)`) everywhere, or `STATUS_PALETTE` classes everywhere — and route all metric-bar fills through it.

## 8. Rotation overview panel hand-rolls its own empty state instead of `EmptyState`
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:173-182
- **Problem**: The "no rotation policies" branch builds a bespoke centered icon-circle + title + hint block. The catalog `EmptyState` (used correctly two files over in `CertOverview.tsx:18`) is the canonical empty surface; the hand-rolled version risks divergent spacing/icon-chip styling from every other empty state and re-derives the violet icon chrome inline.
- **Fix sketch**: Replace the inline block with `<EmptyState icon={RotateCw} title={…no_rotation_policies} subtitle={…no_rotation_hint} />`.

## 9. Rotation summary pills + countdown use `title=` and raw status classes (icon-only without robust labels)
- **Severity**: low
- **Category**: a11y
- **File**: src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:145-159, 240-246
- **Problem**: The active/expiring/anomaly summary pills are icon+count chips conveying status purely via raw `bg-emerald-500/10 … border-emerald-500/20` (duplicating tokens, see finding 1) with the meaning only in a native `title=`. Native `title` is not reliably announced and is unstyled; the color-only encoding has no text alternative for color-blind users beyond the tooltip.
- **Fix sketch**: Use `StatusBadge`/`Tooltip` with an `aria-label`, and derive the chip palette from `STATUS_PALETTE.success/warning/error` so the three pills match the rest of the app.
