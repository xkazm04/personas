# overview/director — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 21 | Missing: 0

## 1. Localized flag/momentum label maps duplicated across four components
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_director/components/PersonaCoachingTable.tsx:44
- **Scenario**: `FLAG_LABEL` (needs_review/low/declining/stale → t.director.flag_*) is hand-built in AttentionTriageBar.tsx:30, PersonaCoachingTable.tsx:44, and PersonaDetailModal.tsx:32 (there fused with hints); `FLAG_HINT` is duplicated in PersonaCoachingTable.tsx:50 and PersonaDetailModal.tsx:33-36; `MOMENTUM_LABEL` is duplicated in MomentumSummary.tsx:36 and PersonaCoachingTable.tsx:56. Adding a fifth attention flag (the `AttentionFlag` union invites it) requires touching 3-4 render files, and a missed one is a silent `undefined` label at runtime, not a compile error at the source of truth.
- **Root cause**: `attention.ts` and `momentum.ts` centralize order/tone maps but not the localized label/hint lookup, so each consumer re-derives it — even though the same module already solved this pattern for categories (`categoryLabel(t, c)` in categoryMeta.ts).
- **Impact**: Real maintenance hazard on a surface that already grew four consumers; ~40 lines of copy-paste that will drift.
- **Fix sketch**: Mirror categoryMeta: add `flagLabel(t, f)` / `flagHint(t, f)` to attention.ts and `momentumLabel(t, m)` to momentum.ts (taking `Translations`), delete the four local record literals, and import the helpers. `Record<AttentionFlag, …>` return types keep exhaustiveness checking when the union grows.

## 2. Date.now() as a useMemo dependency defeats the roster memoization every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_director/components/PersonaCoachingTable.tsx:42
- **Scenario**: `const now = Date.now()` at the top of the render is a dep of both the `rows` memo (line 75) and the `flaggedCount` memo (line 77-80), so both recompute on every parent re-render (e.g. the header's refresh spinner toggling, modal open/close, any facet click). Each recompute runs `attentionFlags` (with `new Date(...).getTime()` parsing) plus a full sort over the roster. DirectorCoachingTab.tsx:64-66 compounds it: `filteredAgents` and `staleAgents` call `filterRoster(..., Date.now())` inline on every render, re-running `attentionFlags` over the whole roster two more times.
- **Root cause**: Staleness is time-derived, so `Date.now()` was threaded in for correctness, but it was sampled per-render instead of per-data-change — turning three memo/derivation sites into always-recompute paths.
- **Impact**: O(4 × roster) flag derivation + a sort on every render of the tab. Bounded today (roster = in-scope personas, likely tens), but it silently converts every `useMemo` on this hot surface into dead weight and will scale linearly with scope size.
- **Fix sketch**: Sample time once per data refresh instead of per render: e.g. `const now = useMemo(() => Date.now(), [roster])` (staleness has 14-day granularity — sub-refresh precision is irrelevant), or have DirectorCoachingTab compute `now` once and pass it down. Then memoize `filteredAgents`/`staleAgents` in DirectorCoachingTab with `[p, rosterFilter, now]` deps, and have `flaggedCount` reuse the already-decorated `rows` input rather than re-deriving flags.

## 3. PersonaCoachingTable re-implements flaggedAgentCount from attention.ts
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_director/components/PersonaCoachingTable.tsx:78
- **Scenario**: The "only flagged" toggle count is computed as `roster.filter((r) => attentionFlags(r, now).length > 0).length`, which is exactly `flaggedAgentCount(roster, now)` exported from attention.ts:66 and already used by src/hooks/sidebar/useBadgeCounts.ts:49.
- **Root cause**: The helper was extracted for the sidebar badge after the table already had its inline version; the table was never pointed at it.
- **Impact**: Two definitions of "agent needs attention" can drift apart, making the table's toggle count disagree with the sidebar badge if either changes.
- **Fix sketch**: Replace the inline filter with `flaggedAgentCount(roster, now)` (one-line change plus import); keep the `useMemo` wrapper with the same deps.
