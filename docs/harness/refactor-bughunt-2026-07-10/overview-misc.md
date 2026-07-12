> Context: overview (misc)
> Total: 9
> Critical: 0  High: 0  Medium: 5  Low: 4

## 1. Cost-spike card presents sigma as a cost multiplier ("Nx above normal")
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: data-truth
- **File**: src/features/overview/libs/fleetOptimizer.ts:186-192 (and anomalySeverity.ts:29)
- **Scenario**: A recent anomaly with `deviation_sigma = 4.0` on a day that cost $120 vs a $80 moving average renders as "Spending … was **4.0x above normal** ($120 vs $80 avg)". The real ratio is 1.5x; 4.0 is standard deviations, not a multiple of the average.
- **Root cause**: `const multiplier = worst.deviation_sigma.toFixed(1)` is interpolated with a trailing `x` and the words "above normal", conflating a z-score with a ratio. The `impact` line just below (`worst.cost - worst.moving_avg`) is correct, so the two figures contradict each other.
- **Impact**: UX / trust — the headline number on a "critical" card users act on is materially wrong (often much larger than the real overspend), eroding confidence in the analytics.
- **Fix sketch**: Either label it as sigma (`${sigma}σ above normal`) or compute the true multiple `worst.cost / worst.moving_avg` for the "x" figure. Apply the same correction to `getAnomalyLabel`'s `multiplier` string if that file is kept.

## 2. Structured output silently dropped for reviews/outcome/knowledge-only payloads
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/overview/ExecutionDetailModal/outputParser.ts:26-37,41-56
- **Scenario**: An execution whose `output_data` is a single JSON object whose only structured field is `reviews`/`manual_reviews`, `outcome_assessment`, or `knowledge_annotation` (but none of `user_message`/`execution_flow`/`memories`/`events`) fails the guard on line 27. It then falls to the NDJSON branch, which (a) only inspects the singular `manual_review`/`outcome_assessment` keys and never the `reviews` array, and (b) for a pretty-printed multi-line object skips every line that doesn't `startsWith('{')`. Result: `parseOutputData` returns `null` and the Reviews/Outcome/Insights tabs never appear — the user sees only "Raw JSON".
- **Root cause**: The single-JSON fast path gates on a hard-coded subset of top-level keys; the NDJSON fallback assumes minified single-line records.
- **Impact**: UX / data loss (display) — legitimately-structured deliverables render as raw blobs, hiding manual-review flags and outcome assessments.
- **Fix sketch**: Add `data.reviews || data.manual_reviews || data.outcome_assessment || data.knowledge_annotation` to the line-27 guard (it already populates those fields once inside), so any recognized structured key qualifies the single-JSON path.

## 3. `loadOlder` pagination relies on lexicographic timestamp comparison
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/overview/sub_events/libs/useEventLog.ts:234-264
- **Scenario**: `loadOlder` picks the oldest event via `if (e.created_at < oldest.created_at)` and then filters server results with `e.created_at < oldest.created_at` — both string comparisons. The sibling `RotationOverviewPanel` documents that this backend emits *both* RFC3339 (`2026-07-10T12:00:00Z`) and SQLite-naive (`2026-07-10 12:00:00`) timestamp shapes. Space (0x20) sorts before `T` (0x54), so if the two shapes ever mix, the "oldest" pick and the `< oldest` filter misclassify events: `newOnes` can come back empty and flip `hasMoreOlder` to false, stalling infinite scroll (or dropping valid rows).
- **Root cause**: String comparison of timestamps instead of parsed epoch ms (the `filteredEvents` sort correctly uses `new Date(...).getTime()`, but `loadOlder` does not).
- **Impact**: UX — "load older" can dead-end prematurely; older events silently unreachable.
- **Fix sketch**: Parse once (reuse a `parseServerMs`-style helper) and compare numeric epoch ms for both the oldest-pick and the `newOnes` filter; guard NaN.

## 4. Period trend reports a flat +100% for any growth-from-zero average metric
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/overview/libs/computeTrends.ts:35-41,66-67
- **Scenario**: `makeTrend(previous=0, current>0)` always returns `{ pctChange: 100, direction: 'up' }`. For the `successRate` and `latency` trends (which use `avgField`, where a `0` previous typically means "no data in the prior period"), a jump from no-data to any value shows a fixed "+100%", regardless of the actual value, presenting missing data as a precise 100% improvement.
- **Root cause**: A single from-zero convention (`100`) applied uniformly to sum metrics (cost/executions) and average metrics (rate/latency).
- **Impact**: UX — misleading KPI delta on the comparison cards when a prior period has no samples.
- **Fix sketch**: For average metrics, return `direction:'up'` with `pctChange` suppressed (e.g. render "new" / "—") when `previous===0`, rather than a literal 100.

## 5. Dead duplicate `CronAgentsPage.tsx` — also hides a stale timezone bug
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/overview/sub_cron_agents/CronAgentsPage.tsx:1-192
- **Scenario**: Two near-identical `CronAgentsPage` implementations exist. `sub_cron_agents/index.ts` re-exports **only** `./components/CronAgentsPage`; the top-level `sub_cron_agents/CronAgentsPage.tsx` has no other importer (verified by grep). The stale top-level copy inlines its own `AgentSection`/`AgentRow`/`formatInterval` (duplicating `cronHelpers.formatInterval`) and — unlike the live `CronAgentCard.tsx` — omits the timezone label fix (it never shows `agent.timezone`), so the dead file also preserves the previously-fixed "no zone shown" behavior.
- **Root cause**: A refactor moved the page into `components/` + `CronAgentCard.tsx` but left the original file behind.
- **Impact**: Maintainability — ~192 lines of dead code that diverge from the live version and can mislead future edits.
- **Fix sketch**: Delete `sub_cron_agents/CronAgentsPage.tsx` (keep `components/CronAgentsPage.tsx` + `CronAgentCard.tsx` + `cronHelpers.ts`).

## 6. Dead duplicate `knowledgeTypes.ts` shadowing `knowledgeHelpers.ts`
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/overview/sub_knowledge/knowledgeTypes.ts:1-24
- **Scenario**: This file exports `KNOWLEDGE_TYPES`, `COLOR_MAP`, `formatDuration`, `formatCost`, but nothing imports it (grep for `knowledgeTypes` / any `from '.../knowledgeTypes'` returns zero hits). Every consumer (`KnowledgeRow`, `KnowledgeGraphDashboard`, `AnnotateModal`) imports the richer `../libs/knowledgeHelpers`, which defines a superset `KNOWLEDGE_TYPES` (7 types with custom SVG icons vs. 5 here with lucide icons) plus `SCOPE_TYPES`. `COLOR_MAP` here is also unused (pills use `StatusBadge` accents).
- **Root cause**: Leftover earlier version of the knowledge type config, never removed after `knowledgeHelpers.ts` superseded it.
- **Impact**: Maintainability — a second, subtly-different source of truth for knowledge-type labels/colors invites edits to the wrong file.
- **Fix sketch**: Delete `sub_knowledge/knowledgeTypes.ts`; confirm no test references it.

## 7. Fully unused module `anomalySeverity.ts`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/overview/libs/anomalySeverity.ts:1-38
- **Scenario**: `getAnomalyLabel`, `AnomalyLabel`, `AnomalySeverity`, and the local `SEVERITY_STYLES` are referenced only within this file (verified: grep for `anomalySeverity` / `getAnomalyLabel` / `AnomalyLabel` across `src` returns only self-references; the many other `SEVERITY_STYLES` hits are unrelated files). fleetOptimizer formats its own sigma string inline rather than using this helper.
- **Root cause**: Helper written but never wired into a component.
- **Impact**: Maintainability — dead module; also note it embeds the same sigma-as-"Nx" mislabel as finding #1, so deleting it removes a second copy of that mistake.
- **Fix sketch**: Delete the file (or, if intended for the fleet card, wire it in and fix the multiplier label per #1).

## 8. Unused `CostPatternIcon` export
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/overview/sub_knowledge/libs/KnowledgeTypeIcons.tsx:59-68
- **Scenario**: `KnowledgeTypeIcons.tsx` exports 8 icons; `knowledgeHelpers.ts` imports 7 of them and maps `cost_quality → CostQualityIcon`. `CostPatternIcon` is imported/used nowhere (verified by grep).
- **Root cause**: An alternate cost icon left behind when `CostQualityIcon` became the chosen glyph.
- **Impact**: Maintainability — minor dead export.
- **Fix sketch**: Remove `CostPatternIcon`, or repoint `cost_quality` to it if it was the intended design and delete `CostQualityIcon` instead.

## 9. `useEventLog` exposes a sort API the UI never uses
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/overview/sub_events/libs/useEventLog.ts:360-375; components/EventLogList.tsx:76
- **Scenario**: The hook returns `sortDirection` / `toggleSortDirection`, but the only consumer (`EventLogList`) destructures them as `_sortDirection` / `_toggleSortDirection` and never renders a control to flip direction. `sortDirection` stays `'desc'` forever, so the `sortDirection === 'desc'` branch in `filteredEvents` is effectively constant.
- **Root cause**: A sort toggle was planned/removed from the UI but its state + return surface remained in the hook.
- **Impact**: Maintainability — dead public API on a shared hook; slightly misleading (implies a sort control exists).
- **Fix sketch**: Either wire a direction toggle into the events header, or drop `sortDirection`/`toggleSortDirection` from the hook and hard-code the desc sort.
