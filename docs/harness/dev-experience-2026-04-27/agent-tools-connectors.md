# Agent Tools, Connectors & Use Cases — Dev Experience Scan

> Total: 13 findings · Critical: 1 · High: 5 · Medium: 5 · Low: 2
> Scope: client-side only (src-tauri/ excluded)
> Date: 2026-04-27

---

## 1. Delete the dead `sub_tools/useToolSelectorState.ts` and `sub_tools/useToolImpactData.ts` shims — they are unimported zombies

- **Severity**: Critical
- **Category**: code-organization
- **File**: `src/features/agents/sub_tools/useToolSelectorState.ts` (219 LOC), `src/features/agents/sub_tools/useToolImpactData.ts` (204 LOC)
- **Scenario**: A developer modifying tool-selector behavior `grep`s for `useToolSelectorState` and finds two implementations: one at the top of `sub_tools/` and the new split (`libs/useToolSelectorPersona`, `useToolSelectorSearch`, `useToolSelectorActions`). The top-level file even has a meticulous "Undo-toast contract (pinned 2026-04-20)" doc-block — but no callers. The same is true for `sub_tools/useToolImpactData.ts` (top-level, 204 LOC) versus `sub_tools/libs/useToolImpactData.ts` (129 LOC, the one `ToolSelector.tsx` actually imports). Devs waste time reading the wrong file or, worse, "fix" a bug in the orphan and ship nothing.
- **Root cause**: Refactor in April 2026 split the monolithic state hook and added a typed `toolImpactTypes.ts` barrel, but the old files were never removed. `Grep` confirms zero external imports of the top-level files.
- **Impact**: ~30 min per onboarding dev to figure out which is canonical; ongoing risk of "fixed in the wrong place" PRs. The two `useToolImpactData` versions even have *different* co-occurrence algorithms (the orphan double-counts; the live one uses `i<j` pairs) — a future drift bug waiting to bite.
- **Fix sketch**: Delete `sub_tools/useToolSelectorState.ts` and `sub_tools/useToolImpactData.ts`. Update `sub_tools/index.ts` if needed (currently only exports `ToolSelector`). Add an ESLint rule or `knip`-style dead-code check in CI to flag unimported `.ts` files in `features/`.

## 2. Unify `health/HealthTab.tsx` and `sub_health/HealthTab.tsx` — two near-identical health tab wrappers

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_health/HealthTab.tsx` (29 LOC, top-level), `src/features/agents/sub_health/components/HealthTab.tsx` (47 LOC, exported by `sub_health/index.ts`)
- **Scenario**: A developer asked to "add a banner to the agent health tab" finds two `HealthTab.tsx` files in `sub_health/`. The shorter one renders the panel without auto-refresh; the longer adds a stale-data auto-refresh effect. `sub_health/index.ts` only exports the `components/` one — but the top-level file is still in the bundle and still buildable, so a dev can plausibly edit either.
- **Root cause**: Looks like the auto-refresh logic was lifted into a new file under `components/` and the old one was never deleted. Same pattern as finding #1.
- **Impact**: Onboarding confusion + risk of editing the dead file. Both files share a near-identical JSX tree, so any visual change must be made in one and sometimes leaks across.
- **Fix sketch**: Delete `sub_health/HealthTab.tsx`. Verify nothing in the routing layer imports it directly (only `sub_health/index.ts` should be the entry). Add the same dead-file lint rule as #1.

## 3. Split the 382-LOC `DependencyGraphPanel.tsx` into chip / blast-panel / main pieces

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/sub_connectors/components/connectors/DependencyGraphPanel.tsx` (382 LOC)
- **Scenario**: Devs touching the dep-graph (e.g. add a 4th node kind, change the blast-radius severity rules) currently scroll one file containing the `KIND_ICONS` map, two helper components (`HealthIndicator`, `GraphNodeChip`), the entire `BlastPanel` (75 LOC), and the main panel with three large `useMemo` blocks plus a 100-line render. Every change forces re-reading sections that have nothing to do with the task.
- **Root cause**: Co-location habit; the file grew organically and nothing forced a split.
- **Impact**: Slow Cmd-F navigation, large diff churn on small visual changes, hot-reload re-renders the whole tree on edits to the unrelated `BlastPanel`.
- **Fix sketch**: Create `dependency-graph/` subfolder with `GraphNodeChip.tsx`, `BlastPanel.tsx`, `HealthIndicator.tsx`, plus the constants in `graphTokens.ts`. Keep `DependencyGraphPanel.tsx` as the orchestrator (~150 LOC). The existing `analyzeDepBlastRadius` is already extracted to `libs/dependencyGraph.ts`, so the boundary is clean.

## 4. `useAutomationSetup` (277 LOC) bundles 14 useState calls + 5 useEffects + IPC fetches — split per-platform side-effects

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/sub_connectors/libs/useAutomationSetup.ts:61` (277 LOC)
- **Scenario**: A dev adding a new automation platform (say "Make.com") has to thread platform-specific state through the same megahook: see how GitHub repos and Zapier zaps each get their own `useState` + `useEffect` block at lines 76–82 / 134–151. Adding a 4th platform means another two effects, two state vars, a new entry in `PLATFORM_TO_SERVICE_TYPE`, and surgery in `handleClose` (line 212) which manually resets *all* of them. Easy to forget one — there is no compile-time signal.
- **Root cause**: Single hook tracking modal phase, design output, platform-specific data, deploy state, focus trap, and timeout validation. Coupling between concerns makes per-platform changes touch unrelated logic.
- **Impact**: ~20 min friction per platform tweak; high risk of forgetting a reset in `handleClose`. The 24-key return object also makes consumer prop-drilling painful.
- **Fix sketch**: Extract `usePlatformResources(platform, credentialId)` returning `{ githubRepos, githubPerms, zapierZaps, loading }` keyed by platform — its effect-cleanup naturally resets when platform changes. Pull deploy state into `useAutomationDeploy(...)`. Keep `useAutomationSetup` as a thin composer (~100 LOC).

## 5. Two diverging "View Mode" implementations: tool selector grid/grouped vs. use-case grid/glyph

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_tools/libs/useToolSelectorSearch.ts:14` and `src/features/agents/sub_use_cases/components/core/PersonaUseCasesTab.tsx:16`
- **Scenario**: Both features expose a "Grid vs. alt view" toggle. The tools selector uses in-memory `useState<'grid' | 'grouped'>`; the use-cases tab persists the choice in `localStorage` under `personas:use-cases-view`. A dev who copies the use-cases pattern into a new tab gets persistence "for free"; a dev who copies the tools pattern silently doesn't. There is no shared `useViewMode<T>(key)` helper, despite this being at least the second persona-area copy of the pattern.
- **Root cause**: Each tab implemented its toggle independently; nobody promoted the persistence pattern into a shared hook.
- **Impact**: Inconsistent UX (tool-selector view choice resets on tab switch), and the next view-toggle implementation will roll its own again.
- **Fix sketch**: Extract `usePersistedViewMode<T extends string>(key: string, fallback: T): [T, (v: T) => void]` into `@/lib/hooks/`. Migrate both call sites. Document in the persona `AGENTS.md` that all view toggles must use this hook.

## 6. No tests for the agent-tools / connectors / use-cases area despite having `__tests__/` siblings

- **Severity**: High
- **Category**: testing
- **File**: directory: `src/features/agents/sub_tools/`, `sub_connectors/`, `sub_use_cases/`, `health/`, `sub_health/`
- **Scenario**: A dev changing `toGroupKey` (the connectorGroupKey sentinel logic) in `sub_tools/libs/connectorGroupKey.ts:31` — a function that *throws in dev* on collision — has no unit test to verify the throw fires. Changing the cost-attribution math in `sub_tools/libs/useToolImpactData.ts:46-49` (executions divide cost by `toolNames.length`) has no regression test even though the formula is non-trivial. Meanwhile `src/features/agents/components/matrix/__tests__/` exists with 13 tests for the unrelated agent matrix — so the convention exists, just not here.
- **Root cause**: This area shipped fast; tests were never backfilled.
- **Impact**: High change-risk; subtle regressions in cost attribution, blast-radius severity (`>=4 = high` in `dependencyGraph.ts:71`), or sentinel collision handling will slip through.
- **Fix sketch**: Add `sub_tools/libs/__tests__/connectorGroupKey.test.ts`, `useToolImpactData.test.ts` (cost split + co-occurrence), `dependencyGraph.test.ts` (blast severity tiers, broken edges), and `useHealthCheck.test.ts` (scoring penalties — `HEALTH_SCORING` is already exported, so it's tractable). One day's work; high ROI.

## 7. PersonaUseCasesTabGrid and PersonaUseCasesTabGlyph duplicate the entire detail-tray + memories/reviews-default plumbing

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/sub_use_cases/components/core/PersonaUseCasesTabGrid.tsx` (324 LOC) and `PersonaUseCasesTabGlyph.tsx` (305 LOC)
- **Scenario**: Both files contain the same `useEffect` that fetches `getMemoryCount` + `listManualReviews` (Grid lines 79–91, Glyph lines 62–74), the same `handleToggle/handleSim` callbacks, and an identical AnimatePresence detail tray with history/config tabs (~50 lines each). Adding a third detail tab — say "Logs" — means editing both files in lockstep, and reviewers have to verify they stayed identical.
- **Root cause**: Glyph view forked from Grid, shared logic was never lifted.
- **Impact**: ~15 min per change × frequency; high risk of drift (e.g. one variant gets a new event handler, the other doesn't).
- **Fix sketch**: Extract `useUseCaseDefaults(personaId)` returning `{ memoriesDefault, reviewsDefault }`, plus a shared `<UseCaseDetailTray useCase={...} ... />` component. Each top-level component then becomes purely the layout (Grid card vs. Glyph row).

## 8. `useUseCaseDetail` (231 LOC) mixes save/dirty, fixture CRUD, model selection, manual run, and channel toggling — the surface is "everything"

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts` (231 LOC, returns 24 keys)
- **Scenario**: Touching just the manual-run flow (which has subtle persona-switch-mid-click guard logic at lines 86–96 that's worth its own test) means scrolling past test-fixture CRUD, save state, model-config selection, channel handling. The return object has 24 fields; any consumer destructure block becomes a forest.
- **Root cause**: One hook per panel grew to cover everything the panel does.
- **Impact**: Hard to test in isolation; hard to find the specific concern; large diffs for small edits.
- **Fix sketch**: Split into `useUseCaseSave(useCaseId)`, `useUseCaseFixtures(useCaseId, useCase)`, `useUseCaseModel(useCase, persona)`, and `useUseCaseManualRun(useCaseId, fixture, useCase)`. Compose them inside the detail panel rather than returning a 24-key bag.

## 9. Fixture IDs use `Date.now() + Math.random()` — switch to `crypto.randomUUID()` (already used elsewhere in the same area)

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:154`, `src/features/agents/sub_use_cases/components/core/UseCaseTestRunner.tsx:59`
- **Scenario**: Fixture IDs read `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`. Meanwhile `health/useHealthCheck.ts:117` has a thoughtful `makeIssueId()` that prefers `crypto.randomUUID()` and falls back to `Math.random()` (and explains the rationale: HMR re-evaluation collisions). New devs will copy whichever they grep first.
- **Root cause**: Two ID-generation styles co-exist with no doc on which to use.
- **Impact**: Low collision risk in practice but inconsistent; HMR can produce duplicate fixture IDs in dev.
- **Fix sketch**: Promote `makeIssueId()` (or a generic `makeId(prefix)`) into `@/lib/utils/ids.ts`, replace both fixture-creation sites, and add a brief note to the persona `AGENTS.md`.

## 10. `useToolImpactData` reparses `selectedPersona.design_context` JSON on every executions/usage change

- **Severity**: Medium
- **Category**: build-speed (runtime perf affecting dev loop)
- **File**: `src/features/agents/sub_tools/libs/useToolImpactData.ts:26`
- **Scenario**: The `useMemo` depends on `[executions, toolUsageSummary, designContext, selectedPersona?.tools, credentialTypeSet]`. Every new execution event (which can fire many times during a busy dev session) re-parses `designContext` JSON via `parseUseCaseTitles`. Combined with the executions loop building `toolCoMap`, a persona with hundreds of executions makes tool-selector typing visibly stutter while running an agent.
- **Root cause**: No memoization layer between "design_context string" and "useCaseTitles map".
- **Impact**: Noticeable jank in dev when tool-selector is open during an active execution stream; harder to dogfood quickly.
- **Fix sketch**: Wrap `parseUseCaseTitles(designContext)` in its own `useMemo([designContext])`, and consider memoizing the executions→toolUseCaseMap reduction by `executions.length` (or hashing the last execution id). Quick win.

## 11. `parseDesignResult` / `parseUseCaseTitles` / inline `JSON.parse(...)` of design_context appear in 5+ places without a shared parser

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `sub_use_cases/components/core/PersonaUseCasesTabGlyph.tsx:40` (`parseDesignResult`), `sub_tools/libs/toolImpactTypes.ts:53` (`parseUseCaseTitles`), `sub_connectors/libs/useAutomationSetup.ts:91` (`parseDesignContext`), `sub_connectors/components/channels/NotificationChannelSettings.tsx:51` (inline `JSON.parse`), plus `sub_connectors/libs/dependencyGraph.ts:177` (`JSON.parse(auto.credentialMapping)`)
- **Scenario**: Each call site has its own try/catch shape, and only some return null vs. empty. A dev who needs a new field on `design_context` has to find every parser and update it. The shared `parseDesignContext` already exists in `@/features/shared/components/use-cases/UseCasesList`, but newer code (`PersonaUseCasesTabGlyph`) rolled its own — apparently because it wanted a different return shape.
- **Root cause**: No canonical, typed `parseDesignContext()` that returns a discriminated union of all the shapes the codebase actually consumes.
- **Impact**: Drift; new fields are silently inconsistent across surfaces.
- **Fix sketch**: Promote a single `@/lib/personas/parseDesignContext.ts` with a typed return covering use cases, last design result, and credential links. Use `parseJsonOrDefault` (already imported in `useHealthCheck.ts:27`) as the safe-parse primitive everywhere.

## 12. Two near-identical `HealthTab` wrappers + auto-refresh latch logic should live with `useHealthCheck`

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/features/agents/sub_health/components/HealthTab.tsx:14-23`
- **Scenario**: The `autoRefreshed` ref + `isTimestampStale` check that retriggers a health run is in the tab JSX, not the hook. Any other consumer of `useHealthCheck` (e.g. the Digest panel, or a future inline mini-panel) will need to copy this latch.
- **Root cause**: Auto-refresh policy added late, tucked into the nearest file rather than the hook.
- **Impact**: Future copy-paste; subtle bug surface (the latch resets on persona change but not on phase change).
- **Fix sketch**: Add an optional `autoRefreshOnStale: boolean` flag to `useHealthCheck`, fold the latch inside. The tab becomes a pure presentational wrapper.

## 13. `index.ts` barrels are inconsistent across the five sibling modules — sometimes minimal, sometimes a full re-export bag

- **Severity**: Low
- **Category**: convention-drift
- **File**: `sub_tools/index.ts` (1 export), `sub_health/index.ts` (1 export), `health/index.ts` (10 exports incl. types), `sub_use_cases/index.ts` (10 exports), `sub_connectors/index.ts` (15 exports)
- **Scenario**: Importing `useConnectorStatuses` works via `@/features/agents/sub_connectors`. Importing `useToolImpactData` does NOT — `sub_tools/index.ts` only exports `ToolSelector`, so callers must do `@/features/agents/sub_tools/libs/useToolImpactData` (deep import). Either everything is internal or the barrel is the contract; right now it's neither.
- **Root cause**: No agreed convention; barrels grew ad hoc.
- **Impact**: Onboarding confusion ("why does this import path work but not that one?"). Refactors break unannounced internal-import call sites.
- **Fix sketch**: Pick a stance. Recommended: **barrel = public surface**, deep imports are a lint warning. Adopt for `sub_tools` first by exporting `useToolImpactData`, `ToolImpactData` types, and the `connectorGroupKey` helpers. Add an ESLint rule (`no-restricted-imports`) with patterns like `@/features/agents/sub_*/libs/*` and `@/features/agents/sub_*/components/*` once the barrels cover real needs.
