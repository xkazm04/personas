# Code Refactor Scan — Overview Dashboard

> Scanned: 2026-05-02 | Findings: 10 | Files reviewed: ~50

## Summary

`src/features/overview/` is one of the largest contexts in the app (~210 files across 16 `sub_*` modules). Overall organisation per the in-folder `README.md` is clear (the three-tier `sub_realtime → sub_events → sub_observability` rubric is genuinely useful), and most domains have a sensible `components/` + `libs/` layout. The dominant rot pattern is **abandoned-but-not-deleted predecessor code**: `sub_usage/charts/` was renamed to `components/`+`libs/`, `sub_memories/hooks/` was renamed to `libs/`, `sub_observability/chartAnnotations.ts` moved into `libs/`, and `sub_cron_agents/CronAgentsPage.tsx` moved into `components/`. In every case both copies still ship and they have **drifted** — the abandoned variants now lack bug fixes (corruption-recovery, zero-fill of chart data, dev "seed mock" buttons) that exist in their successors. A secondary pattern is **layered indirection** introduced for past iterations of the layout: `DashboardHome.tsx`, `DashboardWithSubtabs.tsx`, and `KnowledgeHub.tsx` are all 2–6-line passthrough wrappers whose original purpose (subtabs, alternate variants) has been removed. A third issue is the parallel feature-scoped `i18n/` directory contradicting the project-wide i18n contract documented in this very feature's own README.

## 1. Abandoned `sub_usage/charts/` directory shadows the live `components/`+`libs/`

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/overview/sub_usage/charts/ (5 files)
- **Scenario**: `sub_usage/` contains three nearly-identical pairs: `charts/ChartErrorBoundary.tsx` ↔ `components/ChartErrorBoundary.tsx`, `charts/ChartTooltip.tsx` ↔ `components/ChartTooltip.tsx`, `charts/MetricChart.tsx` ↔ `components/MetricChart.tsx`, plus `charts/periodComparison.ts` ↔ `libs/periodComparison.ts` and `charts/pivotToolUsage.ts` ↔ `libs/pivotToolUsage.ts`. A project-wide grep for `sub_usage/charts/` returns **zero importers** — the entire `charts/` directory is unreferenced, while every consumer in `sub_activity`, `sub_observability`, `sub_analytics`, `components/dashboard/widgets/`, and `features/agents/sub_lab/` imports from `components/` and `libs/`.
- **Root cause**: A reorganisation moved the Recharts wrappers into a structured `components/`+`libs/` split, but the previous `charts/` siblings were never removed. The `pivotToolUsage` variants have already drifted: the abandoned `charts/` copy has a comment that says "unlike the `libs/` sibling, this variant does NOT zero-fill" — i.e. the live `libs/` version was patched to fix NaN tooltips on stacked AreaCharts, and the dead copy is a buggy snapshot.
- **Impact**: Future readers searching for `pivotToolUsageOverTime` or `MetricChart` find two definitions and cannot tell which is canonical without running grep. The dead `charts/pivotToolUsage.ts` is actively misleading because it documents a "deliberate" lack of zero-filling that was actually the bug the live version fixed. Bundle size cost is real (5 files including a 60-line `MetricChart` and the boundary/tooltip pair).
- **Fix sketch**:
  - Delete the entire `src/features/overview/sub_usage/charts/` directory.
  - No import-site updates needed — every consumer already targets `components/` / `libs/`.
  - Verify with `tsc --noEmit` after deletion.

## 2. `sub_memories/hooks/` is a stale duplicate of `sub_memories/libs/`

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/overview/sub_memories/hooks/ (4 files)
- **Scenario**: Both `hooks/memoryActions.ts` and `libs/memoryActions.ts` exist; same for `memoryConflicts.ts`, plus `hooks/conflictBadges.tsx` ↔ `libs/conflictHelpers.tsx` and a free-floating `hooks/mergeMemories.ts`. Every consumer (`overviewStore.ts → memorySlice.ts`, the `MemoryActionCard.tsx`, `ConflictCard.tsx`, `MemoryConflictReview.tsx`) imports from `../libs/`. A grep across `src/` shows no importers of `sub_memories/hooks/`.
- **Root cause**: `hooks/` was the original location; the directory was renamed to `libs/` (matching the convention used by every other `sub_*`) but the old copies were never removed. Drift is significant and dangerous: `libs/memoryActions.loadActions` now has a `_sessionBackup` mirror, `silentCatch` Sentry routing, and a "shape-guard" branch that throws on non-array `JSON.parse` results to recover from `localStorage` corruption mid-session. The dead `hooks/memoryActions.ts` is a 5-line `try/catch` that returns `[]` on any error — silently losing user data if a future contributor "fixes" by importing the wrong file.
- **Impact**: Any contributor who autocompletes `mergeMemories` in their IDE may pull in the dead `hooks/mergeMemories.ts` and silently bypass the corruption-recovery and badge logic. Files appear to be legitimate code, not obvious dead copies.
- **Fix sketch**:
  - Delete the entire `src/features/overview/sub_memories/hooks/` directory.
  - Files to remove: `memoryActions.ts`, `memoryConflicts.ts`, `mergeMemories.ts`, `conflictBadges.tsx`.
  - The `libs/conflictHelpers.tsx` already exports `mergeMemories`, `kindBadge`, and `similarityBadge` (re-exported via `sub_memories/index.ts`).

## 3. Top-level `CronAgentsPage.tsx` shadows the maintained `components/CronAgentsPage.tsx`

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/overview/sub_cron_agents/CronAgentsPage.tsx
- **Scenario**: A 191-line `CronAgentsPage.tsx` lives at the top level of `sub_cron_agents/`, alongside `components/CronAgentsPage.tsx` (also a default export). The folder's `index.ts` re-exports `./components/CronAgentsPage`; nothing imports the top-level file (`grep "sub_cron_agents/CronAgentsPage"` returns zero non-self matches).
- **Root cause**: The page was moved into `components/` to match the rest of the folder, but the original was left behind. The two files now diverge meaningfully — the live `components/CronAgentsPage.tsx` includes a `seedMockCronAgent` dev-only button (gated by `import.meta.env.DEV`) and a `useCallback`-memoised handler; the dead top-level copy lacks those entirely and re-defines `formatInterval` inline instead of importing from `libs/cronHelpers`.
- **Impact**: Two competing `CronAgentsPage` definitions in the same folder is exactly the kind of "which one runs?" confusion the README warns against. Anyone working on the cron page is one bad jump-to-definition away from editing the wrong file.
- **Fix sketch**:
  - Delete `src/features/overview/sub_cron_agents/CronAgentsPage.tsx`.
  - Confirm `index.ts` (which already points at `./components/CronAgentsPage`) is the only entry.

## 4. Top-level `sub_observability/chartAnnotations.ts` shadows `libs/chartAnnotations.ts`

- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/overview/sub_observability/chartAnnotations.ts
- **Scenario**: `sub_observability/` has both a top-level `chartAnnotations.ts` and a `libs/chartAnnotations.ts`. Every consumer (the index re-exports, `useAnnotationData.ts`, `useObservabilityData.ts`, `MetricsCharts.tsx`) imports from `./libs/chartAnnotations`. The top-level copy is unreferenced.
- **Root cause**: File was moved to `libs/` for consistency with sibling `sub_*` modules, but the source was never deleted. The two are nearly identical except for cosmetic separator-comment widths.
- **Impact**: Mostly noise, but it is in a "load-bearing" file (annotation types and a custom hook) so any divergence in the future could cascade through the observability dashboard.
- **Fix sketch**:
  - Delete `src/features/overview/sub_observability/chartAnnotations.ts`.
  - No import updates needed.

## 5. `sub_messages/messageListConstants.ts` is a stale parallel of `libs/messageHelpers.ts`

- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/overview/sub_messages/messageListConstants.ts
- **Scenario**: `messageListConstants.ts` (top-level) and `libs/messageHelpers.ts` both export `priorityConfig`, `FILTER_LABELS`, `COLUMN_WIDTHS`, `GRID_TEMPLATE_COLUMNS`, `deliveryStatusConfig`, and `channelLabels`. Only `libs/messageHelpers.ts` is imported (by `MessageList.tsx`). The constants have drifted significantly:
  - `priorityConfig.high.color`: `text-status-error` (dead) vs `text-red-400` (live)
  - `COLUMN_WIDTHS`: `{persona: 180, priority: 90, status: 70, created: 100}` (dead) vs `{persona: 280, priority: 180, status: 120, created: 140}` (live)
  - `deliveryStatusConfig` uses `iconName: string` (dead, with comment "we store icon references as strings to avoid importing React") vs imported lucide components (live).
- **Root cause**: An earlier iteration tried a "pure constants file with string icon names" approach to keep React out of the constants module; that constraint was abandoned but the file wasn't.
- **Impact**: Easy to grab the wrong `priorityConfig` via autocomplete. The `text-status-error` semantic-token style in the dead copy is actually closer to the project's modern token system, which makes the dead file *look* more correct on review — it's an attractive nuisance.
- **Fix sketch**:
  - Delete `src/features/overview/sub_messages/messageListConstants.ts`.
  - If anyone wants the semantic-token colours on the live `priorityConfig`, port them in a separate change.

## 6. Orphan visualization renderers in `sub_realtime` (replaced by EventBus renderers)

- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/overview/sub_realtime/components/renderers/VisualizationNodes.tsx, VisualizationParticles.tsx
- **Scenario**: `renderers/` exports two parallel renderer pairs. The live one (`EventBusNodeRenderers`, `EventBusParticleRenderers`) is consumed by `views/EventBusVisualization.tsx`. The other pair (`VisualizationNodes` exporting `ToolNodeGroup`/`PersonaNodeGroup`, `VisualizationParticles` exporting `InboundParticles`/`ReturnFlowParticles`) has zero importers across `src/`. They share the `SwarmNode`/`ProcessingInfo` types from `libs/visualizationHelpers.ts`, which makes them look alive.
- **Root cause**: The realtime visualizer went through a redesign — the `Tool*`/`Persona*` ring layout was superseded by the `Outer*`/`Inner*` orbit layout used by `EventBusVisualization`. The old renderer files were left for "reference" and never deleted.
- **Impact**: ~120 lines of SVG rendering code that doesn't render anywhere. New contributors searching for "how does the swarm work?" land on `ToolNodeGroup` (pretty, well-commented) and waste time before realising the prod page calls `OuterNodeGroup` instead.
- **Fix sketch**:
  - Delete `VisualizationNodes.tsx` and `VisualizationParticles.tsx`.
  - Keep `SwarmNode` and `ProcessingInfo` in `visualizationHelpers.ts` — they're still used by the live renderers.

## 7. Three-deep passthrough wrapper chain on the home dashboard route

- **Severity**: medium
- **Category**: structure
- **File**: src/features/overview/components/dashboard/DashboardHome.tsx, DashboardWithSubtabs.tsx, ExecutionsWithSubtabs.tsx
- **Scenario**: `OverviewPage.tsx` lazy-imports `DashboardWithSubtabs`, which is a 14-line `ErrorBoundary`-wrapped passthrough to `DashboardHome` (a 1-line re-export of `DashboardHomeMissionControl`). Similarly `ExecutionsWithSubtabs.tsx` is an 11-line passthrough to `GlobalExecutionList`. The component-level comment in `DashboardWithSubtabs.tsx` literally says "previously hosted Overview/Analytics/Realtime/Timeline subtabs. Those have been consolidated into the single DashboardHome view." The "WithSubtabs" name is now actively misleading — there are no subtabs.
- **Root cause**: Subtab consolidation happened but the wrapper layer was kept "in case we add subtabs back." The naming was never updated.
- **Impact**: Three levels of indirection (`OverviewPage → DashboardWithSubtabs → DashboardHome → DashboardHomeMissionControl`) for what is conceptually one page. Each `lazyRetry` boundary creates a Suspense + chunk-loading hop on tab switches. The misleading `WithSubtabs` name causes contributors to look for subtab plumbing that doesn't exist.
- **Fix sketch**:
  - Inline `DashboardHome.tsx` (1 line) — let `DashboardWithSubtabs` lazy-import `DashboardHomeMissionControl` directly, or rename to `DashboardLazy`.
  - Move the `ErrorBoundary` wrapping into `OverviewPage.tsx` (which already wraps everything in `<ErrorBoundary name={`Overview/${overviewTab}`}>` anyway — `DashboardWithSubtabs`'s inner `<ErrorBoundary name="Dashboard">` is redundant nesting).
  - Same treatment for `ExecutionsWithSubtabs` (rename to `ExecutionsLazy` or inline directly).
  - Optional: rename `KnowledgeHub.tsx` (5 lines, returns `<MemoriesPage />`) — its "knowledge" badge no longer reflects the actual `MemoriesPage` content.

## 8. Parallel feature-scoped i18n contradicts the documented project-wide contract

- **Severity**: medium
- **Category**: structure
- **File**: src/features/overview/i18n/ (15 files)
- **Scenario**: `src/features/overview/i18n/` contains 14 locale files (`en.ts`, `ar.ts`, `bn.ts`, `cs.ts`, …) plus a `useOverviewTranslation.ts` hook. The feature's own `README.md` (line 73) explicitly lists this as an **anti-pattern**: "Adding a feature-scoped `i18n/` under a sub-folder. → All new strings go into `src/i18n/en.ts` per the root CLAUDE.md." Eleven non-English locale files start with `// TODO(i18n-XX): translate from English placeholders. Structure must match en.ts exactly.` so they exist only to satisfy a key-completeness check that's already enforced by the project-wide `i18n/CONTRACT.md` and `src/i18n/locales/en.json` codegen.
- **Root cause**: Someone added a feature-local `useOverviewTranslation()` hook for a small set of strings (anomaly badges, trend arrows, event log header), and per-language stubs were generated to keep the type compile-clean. The project-wide i18n system was rewritten around `src/i18n/locales/*.json` with codegen, but the feature-local copy stayed.
- **Impact**: Components like `AlertHistoryPanel.tsx` import **both** `useTranslation` (project-wide, for `t.common.dismiss`) and `useOverviewTranslation` (feature-local, for `ot.*`) in the same file — every reader has to context-switch between two translation hooks with overlapping namespaces. The 14 stub locale files clutter the directory and show up in `git blame`/`git grep` results.
- **Fix sketch**:
  - Migrate the ~10 keys in `overview/i18n/en.ts` (anomaly, trend, eventLog, reviewFocus, emptyState, errorRecovery sub-trees) into `src/i18n/locales/en.json` under their matching `overview.*` paths (most are already mirrored there based on the `t.overview.*` usage elsewhere in this feature).
  - Delete `src/features/overview/i18n/` entirely.
  - Replace the 11 `useOverviewTranslation()` call sites with `useTranslation()` (the same hook used everywhere else in this feature).
  - One-shot rewrite — every stale locale file has a `TODO(i18n-XX)` comment, so there's no human-translated content to migrate carefully.

## 9. Local `EVENT_TYPE_LABELS` shadows shared `visualizationHelpers.EVENT_TYPE_LABELS`

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/overview/sub_realtime/components/panels/EventBusFilterBar.tsx:30-35
- **Scenario**: `visualizationHelpers.ts` exports a canonical `EVENT_TYPE_LABELS` consumed by `SwimLaneVisualization`, `EventBusVisualization`, and `EventLogSidebar`. `EventBusFilterBar.tsx` defines its own local `EVENT_TYPE_LABELS` with drifted strings: shared has `deploy_started: 'Deploy'`, local has `deploy_started: 'Deploy Started'`; shared has `deploy_succeeded: 'Deployed'`, local has `'Deploy OK'`. The shared map also has entries (`deploy_paused`, `deploy_resumed`, `system`/`trigger`) that the local map is missing.
- **Root cause**: The filter bar was likely written before the shared map existed, or the author preferred slightly-longer labels in the dropdown than in the bus visualization. Either way, two labels for the same event type now ship simultaneously.
- **Impact**: A user filtering by "Deploy Started" in the filter bar sees that exact label, then watches a particle for the same event animate into the bus visualization labelled "Deploy" — a real consistency bug, not just a code smell.
- **Fix sketch**:
  - Delete the local `EVENT_TYPE_LABELS` in `EventBusFilterBar.tsx`.
  - `import { EVENT_TYPE_LABELS } from '../../libs/visualizationHelpers'`.
  - If a longer-label variant is genuinely wanted in dropdowns, add a second export (e.g. `EVENT_TYPE_LABELS_VERBOSE`) so the divergence is named and intentional.

## 10. Inline `HighlightedJson` in `EventLogItem.tsx` shadows the file-level component

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/overview/sub_events/components/EventLogItem.tsx:38, src/features/overview/sub_events/HighlightedJson.tsx
- **Scenario**: `sub_events/HighlightedJson.tsx` exports a `HighlightedJson` component used by `EventDetailModal.tsx`. `sub_events/components/EventLogItem.tsx` defines an inline `HighlightedJson` (with its own `colorizeJson` helper, identical regex) that ships in addition. Both render coloured JSON; the file-level version splits into per-line spans (with line-number CSS counters from `typography.css`) and adds a `CopyButton` overlay; the inline version is plain `<pre>` with no copy button and no line splitting.
- **Root cause**: `EventLogItem.tsx` originally had its own renderer. When the modal version was added with line numbers + copy button, the inline one was left behind. There are also further `HighlightedJson` variants in `features/triggers/sub_live_stream/`, `features/agents/sub_executions/.../HighlightedJsonBlock.tsx`, and inline in `DetailMetadata.tsx` — at least 5 forks of the same regex tokeniser ship today (cross-context observation; only the two inside `sub_events/` are within this scan's scope).
- **Impact**: The two `sub_events` viewers behave inconsistently — copy works in the detail modal but not in the inline log item, line numbers appear in one but not the other. Same regex maintained in two places, with a third copy in adjacent contexts.
- **Fix sketch**:
  - Delete the inline `colorizeJson` + `HighlightedJson` from `EventLogItem.tsx` (lines ~12-53).
  - `import { HighlightedJson } from '../HighlightedJson'`.
  - Consider promoting `sub_events/HighlightedJson.tsx` to `features/shared/components/display/` so the triggers and executions copies can also collapse — out of scope for this finding but flagged for the cross-context refactor pass.

> Total: 10 findings (3 high, 7 medium, 0 low)
