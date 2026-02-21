# Overview UI Phase 2 — Visual Token Audit

Date: 2026-02-19
Scope: `src/features/overview/**/*.tsx`
Objective: audit typography, spacing, density, and visual primitives before defining upgrade rounds.

## 1) Token Inventory (Current)

### Typography Scale Observed
- Display/KPI: `text-2xl`
- Page title: `text-xl`, `text-lg`
- Standard body/headline: `text-sm`
- Compact/meta/action: `text-xs`
- Micro labels/badges: `text-[11px]`, `text-[10px]`, `text-[9px]`
- Monospace metadata is pervasive (`font-mono`) for labels/status/meta strips.

### Spacing Scale Observed
- Shell wrappers: mostly `p-6`, often `pt-4`; alternative shell in usage uses `px-6 py-5`.
- Card internals: mostly `p-4`; summary/feature cards sometimes `p-5`.
- Row height rhythm: commonly `py-2.5` or `py-3` in list rows.
- Micro spacing: frequent `gap-1.5`, `px-2`, `py-0.5`, `mb-1.5`.

### Shape & Surface Tokens
- Radius: dominant `rounded-lg` + `rounded-xl`; occasional `rounded-2xl` for overlays/major containers; `rounded-full` for status dots/pills.
- Borders: dominant `border-primary/10`, `border-primary/15`, with variant drift to `border-border/30` in executions.
- Surface fills: dominant `bg-secondary/20`, `bg-secondary/30`, `bg-secondary/40`; modals/drawers use `bg-background/95` with blur.

### Interaction/State Tokens
- Hover baseline usually `hover:bg-secondary/40` or `hover:bg-secondary/50`.
- Active pill styles vary by module (primary, blue, and mixed semantic variants).
- Empty-state icon containers are mostly `w-12 h-12 rounded-xl` but not fully standardized.

## 2) Per-Module Visual Profile

## Executions (`sub_executions/GlobalExecutionList.tsx`)
- Density: compact list-first; high information-per-row.
- Typography: strong `text-sm` titles + `text-xs` meta + `text-[11px]` section labels.
- Spacing: shell `p-6 pt-4`; row `px-4 py-3`; expanded body `px-4 pb-4`.
- Drift: uses `border-border/*` unlike most overview modules using `border-primary/*`.

## Manual Review (`sub_manual-review/ManualReviewList.tsx`)
- Density: compact list-first, similar to executions/messages.
- Typography: near-identical compact ladder (`text-sm`, `text-xs`, `text-[11px]`).
- Spacing: shell `p-6 pt-4`; row `px-3 py-2.5`; expanded body `px-3 pb-3`.
- Drift: visually aligned with messages more than with executions.

## Messages (`sub_messages/MessageList.tsx`)
- Density: highest complexity among list modules (desktop + mobile row modes + delivery section).
- Typography: extensive micro-label usage (`text-[11px]`, `text-[10px]`) plus prose path.
- Spacing: shell `p-6 pt-4`; row `px-3 py-2.5`; expanded body `px-3 pb-3`.
- Drift: adds blue-accented filter/button language distinct from other tabs.

## Events (`sub_events/EventLogList.tsx`)
- Density: compact card list with expanded technical details.
- Typography: `text-xs` rows + `text-[10px]/[11px]` badges/meta.
- Spacing: shell `p-6 pt-4`; card row `p-3`; expanded details `p-3`.
- Drift: subtle difference in active pill styling and lower metadata contrast in places.

## Usage (`sub_usage/UsageDashboard.tsx`)
- Density: chart-first, low row density, larger section rhythm.
- Typography: mainly `text-sm` section titles and `text-xs` legends/empty hints.
- Spacing: wrapper `px-6 py-5 gap-6`; chart cards `p-4`.
- Drift: shell spacing differs from most tabs (`px-6 py-5` vs `p-6 pt-4`).

## Observability (`sub_observability/ObservabilityDashboard.tsx`)
- Density: hybrid dashboard + issue list; visually richest module.
- Typography: `text-xl` page title + KPI cards + micro issue labels `text-[9px]/[10px]`.
- Spacing: shell `p-6 space-y-6`; cards `p-4`; issue section header/rows `px-5 py-3`.
- Drift: introduces strongest stylistic variance (title weight, section architecture, mixed densities).

## Realtime (`sub_realtime/*`)
- Density: visualization-first with separate stats bar and drawer.
- Typography: heavy micro typography in stats (`text-[9px]/[10px]`) and drawer metadata.
- Spacing: stats bar `px-5 py-3`; drawer internal `px-5 py-3`.
- Drift: unique visual language (canvas/glow particles) intentionally diverges from list/dashboard modules.

## Memories (`sub_memories/MemoriesPage.tsx`)
- Density: compact but feature-rich (filters, sorting, responsive table/card rows, expanded details).
- Typography: broadest ladder usage from `text-lg` to `text-[9px]`.
- Spacing: header block `px-4 md:px-6 py-5`; table rows `px-6 py-3`; mobile rows `px-4 py-3`.
- Drift: most mature and structured typography hierarchy; good candidate baseline donor for data-table modules.

## Budget (`sub_budget/BudgetSettingsPage.tsx`)
- Density: medium (cards + inline edit controls).
- Typography: clear heading hierarchy (`text-xl`, `text-2xl`, `text-sm`, `text-[11px]`).
- Spacing: shell `p-6 space-y-6`; card internals vary (`p-5` summary, `p-4` rows).
- Drift: status/progress style consistent, but heading treatment aligns more with observability than list tabs.

## 3) Cross-Module Drift Findings

High-impact drift:
1. **Shell padding inconsistency**
   - `p-6 pt-4` vs `p-6` vs `px-6 py-5` vs `px-4 md:px-6 py-5`.
2. **Border token inconsistency**
   - `border-primary/*` and `border-border/*` mixed without clear rule.
3. **Filter pill styling divergence**
   - Similar controls have different active/inactive color semantics per module.
4. **Micro-type over-variation**
   - Frequent switching between `text-xs`, `text-[10px]`, `text-[11px]`, `text-[9px]`.
5. **Section title hierarchy mismatch**
   - Some tabs are title-heavy (`text-xl` pages), others title-light (filter-first).

Medium-impact drift:
- Badge geometry mostly aligned but color semantics vary by module intent.
- Empty state blocks are conceptually similar but not tokenized as one pattern.
- Expanded detail bodies use varying horizontal rhythm (`px-3` vs `px-4` vs `px-5`).

## 4) Baseline Candidate (Pre-Pass Recommendation)

### Suggested baseline primitives (for pass planning)
- **Shell:** `p-6` + optional compact top reduction only when needed.
- **Card:** `rounded-xl border border-primary/15 bg-secondary/30`.
- **Row interactive height:** target around `py-2.5` to `py-3`.
- **Section title:** `text-sm font-semibold text-foreground/80` (cards), tab title optional based on module type.
- **Body text:** `text-sm`.
- **Meta text:** `text-xs`, reserve `text-[10px]` for badges/ultra-compact labels, avoid broad `text-[9px]` spread except dense visualizations.
- **Badge capsule:** `px-2 py-0.5 rounded-md text-[11px] border`.

## 5) Phase 2 Output for Next Stage

This audit is complete and provides the token map required for:
- Phase 3 consistency audit (component/state behavior alignment),
- Phase 4 scoring rubric application,
- and final pass-round sequencing.

Potential fast wins for first polish round:
1. normalize shell paddings,
2. normalize border token usage,
3. normalize filter pill active/inactive treatment,
4. reduce unnecessary micro-size fragmentation.
