# Code Refactor Scan — Deployment, Sharing & Plugins

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~45

## Summary

This scope is dominated by the `plugins/` tree, which is broadly healthy and reads as a deliberately-organised plugin catalogue (each plugin is a self-contained subfolder with its own `sub_*` subpages, `_shared/`, and i18n where applicable). The two clearest patterns worth fixing are: (1) **a fully-orphaned `composition` feature** sitting alongside live code, where `index.ts` exports a public API that nothing in the app imports, and (2) **time-formatting and status-icon duplication** in the deployment cloud helpers, where four near-identical `timeAgo` re-exports and two competing `statusIcon` implementations have grown up because each new helper file copy-pasted the previous one. Beyond those, there are scattered single-file issues (an unused aliased import, a hard-coded English plugin label that breaks the i18n pattern, an orphaned `GoalKanban` view) but the modules are mostly tidy. Keep an eye on the prototype-tab scaffolding (research-lab and twin both ship 2-3 layout variants behind throwaway tab strips) — that's intentional today but is the obvious next refactor once a winner is picked.

## 1. `composition` feature is fully orphaned dead code

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/composition/index.ts:1, src/features/composition/libs/dagUtils.ts:1-133
- **Scenario**: The entire `src/features/composition` module — `index.ts` plus `libs/dagUtils.ts` (133 lines, exports `topologicalSort`, `validateWorkflow`, `getUpstream`, `getDownstream`, `TopologicalResult`, `ValidationError`) — has zero importers in the codebase. A project-wide grep for `topologicalSort`, `validateWorkflow`, `@/features/composition`, and the sibling helpers returns only the file's own self-references. Meanwhile `src/lib/harness/plan-builder.ts` defines its **own** local `topologicalSort` for scenario areas (a parallel, simpler implementation), and the only other consumer of `compositionTypes` is `vault/sub_dependencies/credentialGraph.ts`, which imports types but not these helpers.
- **Root cause**: Likely the leftover façade of a "Persona Composition Engine" that was scaffolded (note the well-documented `TopologicalResult` discriminated-union design) but never wired into a UI surface, or whose UI surface was removed without taking the lib with it.
- **Impact**: Misleading — a future contributor looking for "how do we sort workflow DAGs?" will find this file, treat it as the system of record, and either build new UI on top of dead code or rewrite the parallel impl in `plan-builder.ts` against it.
- **Fix sketch**:
  - Delete `src/features/composition/` outright (both `index.ts` and `libs/dagUtils.ts`).
  - If the design is still desired, leave a one-line ADR or doc note pointing at the spec rather than keeping unreferenced code as the placeholder.
  - If `compositionTypes` itself (in `lib/types/`) is also unused outside `credentialGraph.ts`, audit that too — but that's outside this scope.

## 2. `timeAgo` re-exported four times across deployment helpers

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/deployment/components/deploymentTypes.ts:109-110, src/features/deployment/components/cloud/cloudDeploymentHelpers.ts:38-39, src/features/deployment/components/cloud/CloudHistoryHelpers.tsx:17-18, src/features/deployment/components/cloud/cloudSchedulesHelpers.tsx:70
- **Scenario**: Four separate helper files each define the same `timeAgo` constant: `export const timeAgo = (iso: string | null) => formatRelativeTime(iso, 'Never');` (or, in `CloudHistoryHelpers.tsx`, the variant without the `'Never'` fallback). Every one of them is just a thin wrapper around `formatRelativeTime` from `@/lib/utils/formatters`. Same goes for re-exports of `formatCost` and `formatDuration` — `CloudHistoryHelpers.tsx` and `cloudDeploymentHelpers.ts` both `export { formatCost } from '@/lib/utils/formatters'` for no transformation reason.
- **Root cause**: Each new helper file (`CloudHistoryHelpers`, `cloudSchedulesHelpers`, `cloudDeploymentHelpers`, `deploymentTypes`) copied the pattern from its sibling rather than importing the shared utility directly.
- **Impact**: The `'Never'` fallback divergence in `CloudHistoryHelpers.tsx` (vs. the others) is a real footgun — if a CloudHistory row's timestamp is null, it renders an empty string instead of "Never". Reader confusion: four identical helpers raise the question "does each one mean something different?" — they don't.
- **Fix sketch**:
  - Promote a single canonical `timeAgoOrNever` to `src/lib/utils/formatters.ts` (or just call `formatRelativeTime(iso, 'Never')` inline).
  - Delete the four local re-exports and have the consumers import directly from the shared formatters module.
  - Same treatment for the redundant `formatCost`/`formatDuration` re-exports in the cloud helpers files.

## 3. Two parallel `statusIcon` / `statusColor`/`statusBadge` implementations in deployment

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/deployment/components/DeploymentSubComponents.tsx:12-19, src/features/deployment/components/cloud/CloudHistoryHelpers.tsx:4-11, src/features/deployment/components/cloud/cloudDeploymentHelpers.ts:25-36, src/features/deployment/components/deploymentTypes.ts:94-102
- **Scenario**: `statusIcon` exists in two flavours: `DeploymentSubComponents.tsx` keys on the four-variant `DeployStatus` union (`active|paused|failed|unknown`) using `CheckCircle2/PauseCircle/XCircle/AlertCircle`; `CloudHistoryHelpers.tsx` keys on raw execution status strings (`completed|failed|cancelled`) with a different icon set. Separately, `statusColor` (in `cloudDeploymentHelpers.ts`) and `statusBadge` (in `deploymentTypes.ts`) emit literally the same Tailwind classes for active/paused/failed/default — two functions, identical bodies, different names.
- **Root cause**: Cloud history (executions) and the unified deployment dashboard evolved separately; no one collapsed the colour map even though it converged.
- **Impact**: When the design refreshes (new active hue, new severity tier), engineers will update one site and miss the other — the two views will silently drift. Already a small drift exists: `unknown`/default tones use slightly different secondary background classes in places.
- **Fix sketch**:
  - Move the colour map to a single `deploymentTokens` exporter and have both `statusBadge` and `statusColor` read from it.
  - For status icons, decide whether the dashboard and history view should share a vocabulary (`active`+`completed` are the same concept in different tenses). If yes, unify; if no, rename to `deployStatusIcon` vs `executionStatusIcon` so the difference is intentional and discoverable.

## 4. Unused aliased imports in CloudHistoryPanel

- **Severity**: low
- **Category**: cleanup
- **File**: src/features/deployment/components/cloud/CloudHistoryPanel.tsx:12
- **Scenario**: `import { statusIcon as _statusIcon, formatDuration, formatCost, timeAgo as _timeAgo } from './CloudHistoryHelpers';` — `_statusIcon` and `_timeAgo` are deliberately aliased with underscore prefixes, but neither is referenced anywhere in the file. `formatDuration` and `formatCost` are used; the other two are dead.
- **Root cause**: The status-icon and timeAgo rendering moved into the child `CloudExecutionRow` component, but the parent's import list was never trimmed; the underscore aliasing was probably added to silence a lint warning rather than removing the imports.
- **Impact**: Tiny — one extra import line, slight reader-confusion ("why are those aliased?"). The underscore-prefix convention is misleading: it suggests intentionally-kept-for-side-effect, when really they're just unused.
- **Fix sketch**: Drop the two aliased imports from the import statement. Keep `formatDuration` and `formatCost` only.

## 5. `GoalKanban.tsx` is an orphan view

- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/plugins/dev-tools/sub_lifecycle/GoalKanban.tsx:124-188
- **Scenario**: `GoalKanban` is a 188-line default-exported page component, but no module imports it. The lifecycle tab system in `GoalConstellation.tsx` switches between three variants (`baseline`, `pulse`, `flow`) — Kanban is not in that list. The only other reference is in `docs/features/dev-tools.md` describing the file's existence, not consuming it.
- **Root cause**: Likely a fourth variant prototype that lost the bake-off but got left on disk. The other variants (`GoalProjectPulse`, `GoalDependencyFlow`) are wired in via `GoalConstellation`'s switch.
- **Impact**: A future contributor picking up "let's add a Kanban view" will discover this file, mistake it for an active variant, and either modify it (to no effect) or wonder why the test surface doesn't render it.
- **Fix sketch**:
  - Confirm with product whether Kanban is intentionally on ice. If yes, delete the file outright (git history preserves it).
  - If it's a planned-but-not-yet-wired variant, add an explicit `// TODO: wire into GoalConstellation` header and a tracking link so it doesn't read as dead.

## 6. Two of six plugins skip the plugin-browse i18n pattern

- **Severity**: medium
- **Category**: cleanup
- **File**: src/features/plugins/PluginBrowsePage.tsx:21-28
- **Scenario**: The `PLUGINS` array uses `t.plugins.artist_label` / `t.plugins.artist_desc` for four plugins (artist, dev-tools, obsidian-brain, drive) but hardcodes English literals for `research-lab` (`label: 'Research Lab', description: 'Academic paper search and hypothesis tracking'`) and `twin` (`label: 'Twin', description: 'Build a digital twin — identity, voice, channels, and curated memory…'`). All 14 locale files (`en/zh/ar/hi/…`) already have `research_lab` keys defined for other purposes — adding `research_lab_label`/`research_lab_desc` plus `twin_label`/`twin_desc` is a small extension.
- **Root cause**: `research-lab` and `twin` were added after the four-plugin baseline; the i18n strings were never backfilled, so the developer hardcoded literals to ship.
- **Impact**: Two of six plugin tiles always render in English regardless of UI language — visible bug for non-English users on a top-level Plugins screen.
- **Fix sketch**:
  - Add `research_lab_label`, `research_lab_desc`, `twin_label`, `twin_desc` keys under `t.plugins.*` in `en.json` (let the i18n CI fan them out to other locales as today).
  - Replace the two hardcoded entries to match the pattern.
  - Bonus: lift `PLUGINS` out of the function body — recreating the array on every render serves no purpose.

## 7. `elapsedStr` / `durationStr` re-implement `formatDuration`

- **Severity**: low
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_lifecycle/competitions/timeUtils.ts:1-18
- **Scenario**: `elapsedStr(startedAtMs)` and `durationStr(startIso, endIso)` both take a duration in seconds and render `Ns`/`Nm Ss`/`Nh Nm` — exactly what `formatDuration(ms, { precision: 'integer' })` already does in `src/lib/utils/formatters.ts:250`. The competitions module's two consumers (`RacingProgress.tsx`, `CompetitionSlotRow.tsx`) could call the shared formatter directly.
- **Root cause**: The competition-racing UI was built quickly and didn't audit existing utility code; the local helpers were faster than threading the shared ones in.
- **Impact**: Light maintenance burden — when shared `formatDuration` is improved (better localisation, plural rules), competition rows won't pick it up. Reader has to learn two helper names for the same idea.
- **Fix sketch**:
  - Replace `elapsedStr(startedAtMs)` with `formatDuration(Date.now() - startedAtMs)`.
  - Replace `durationStr(a, b)` with `formatDuration(new Date(b).getTime() - new Date(a).getTime())`.
  - Delete `timeUtils.ts` once both call sites are migrated.

## 8. `STATUS_META`/`normalizeStatus` duplicated across goal views

- **Severity**: low
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_lifecycle/GoalProjectPulse.tsx:32-48, src/features/plugins/dev-tools/sub_lifecycle/GoalDependencyFlow.tsx:30-43
- **Scenario**: `GoalProjectPulse` defines `StatusKey`, `STATUS_META` (record of label/icon/tint/bg/ring/tone per status), `STATUS_ORDER`, and `normalizeStatus`. `GoalDependencyFlow` defines `ColumnKey`, `COLUMNS` (label/icon/tint/bg/ring per column), and `normalizeStatus` — the same four keys (`blocked|open|in-progress|done`), the same icon picks (`AlertCircle/Circle/Clock/CheckCircle2`), the same colour palette, just renamed and with slightly different field shapes. Both files also literally repeat the `normalizeStatus` function body.
- **Root cause**: The two views were built as separate variants of "show goals by status." Each picked its own internal vocabulary; nobody factored the shared parts.
- **Impact**: Drift risk — when a designer asks to add a `paused` status or change the blocked tint, three files (counting GoalKanban from finding 5 if it survives) need synchronised updates. Today they happen to agree; tomorrow they may not.
- **Fix sketch**:
  - Extract a `goalStatus.ts` (sibling of these views) that exports `type GoalStatus`, `GOAL_STATUS_META` (label/icon/tint/bg/ring), `GOAL_STATUS_ORDER`, and `normalizeGoalStatus`.
  - Each view picks the slice it needs (Pulse uses `tone` + `STATUS_ORDER`, Flow uses `sub` subtitles which are view-specific — keep those local).
  - This costs ~30 lines net but eliminates the divergence risk.

## 9. `CompanionMessage` type duplicated between API and store

- **Severity**: low
- **Category**: duplication
- **File**: src/api/companion.ts:54-59, src/features/plugins/companion/companionStore.ts:5-10
- **Scenario**: `CompanionMessage { id, role, content, createdAt }` is defined identically in both `@/api/companion.ts` (where it's the wire shape returned by `companionListRecentMessages`) and `companionStore.ts` (where the Zustand store stores them). The store imports `PendingApproval` from `@/api/companion` already — it could just as easily re-export `CompanionMessage`.
- **Root cause**: When the chat panel was wired up, the author inlined the type to avoid an import-cycle worry that doesn't actually exist.
- **Impact**: If the wire shape changes (e.g. `role` becomes a union of literals, or `createdAt` becomes nullable), only the API copy gets the update — the store keeps the stale shape and will type-check incorrectly. Small surface area today but a sharp edge.
- **Fix sketch**:
  - Delete the local definition in `companionStore.ts`.
  - Add `import type { CompanionMessage } from '@/api/companion';` and use it for the message slice.

> Total: 9 findings (1 high, 5 medium, 3 low)
