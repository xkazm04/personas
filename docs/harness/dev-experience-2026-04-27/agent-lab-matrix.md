# Agent Lab & Matrix Builder — Dev Experience Scan

> Total: 13 findings · Critical: 1 · High: 6 · Medium: 5 · Low: 1
> Scope: client-side only (src-tauri/ excluded)
> Date: 2026-04-27

> Note: three paths in the requested context list do not exist on disk and were
> skipped: `src/features/agents/sub_activity/MatrixTab.tsx`,
> `src/features/agents/components/matrix/CapabilityAddModal.tsx`, and
> `src/features/agents/components/matrix/CapabilityRowEditor.tsx`. The closest
> real files (`CapabilityAddModal.tsx`, `CapabilityRow.tsx`) live under
> `src/features/agents/components/newPersona/capabilityView/` and are
> referenced where relevant. The Capability*Editor referenced from header
> comments in `matrixBuildSlice.ts` (line 198) appears to have been renamed or
> deleted without updating the docstring — see Finding 6.

---

## 1. matrixBuildSlice.ts is a 1,303-LOC monolith maintaining mirrored state in two places

- **Severity**: Critical
- **Category**: code-organization
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:1-1303`
- **Scenario**: Any new BuildEvent variant or session field requires touching: (1) the `BuildSessionState` interface, (2) the legacy scalar fields list (~30 fields), (3) `scalarsFromSession()` projection, (4) the null-state branch of the same function, (5) `emptySessionState()`, (6) the `MatrixBuildSlice` interface, (7) the slice creator initial state. Seven coordinated edits per added field.
- **Root cause**: The post-multi-draft refactor preserved every legacy top-level scalar (`buildPhase`, `buildCellStates`, `buildPersonaResolution`, etc.) as a mirror of `buildSessions[activeBuildSessionId]` for backward compat. The mirroring is hand-rolled (`scalarsFromSession`) and the same 30-field shape is written out four separate times in the file. There is no compile-time guarantee the mirror stays exhaustive — a missed field silently becomes a stale scalar.
- **Impact**: Onboarding tax (anyone touching this file must internalize the dual-state contract before making changes); every addition risks subtle bugs where the scalar lags the session map. The "next-active-session policy" header comment hints this has bitten before.
- **Fix sketch**: Either (a) delete the scalars and migrate ~25 selectors to `s.buildSessions[s.activeBuildSessionId]?.field`, or (b) generate the projection with a single `Object.fromEntries` keyed off a typed `SCALAR_KEY_MAP` so adding a field is one edit. Split the file into `matrixBuildSlice.events.ts` (event handlers), `matrixBuildSlice.lifecycle.ts` (start/reset/hydrate), `matrixBuildSlice.editing.ts` (v3 patches) — the slice creator itself can stay thin.

---

## 2. ArenaPanelColosseum.tsx and ArenaPanelLedger.tsx are both shipped as "directional prototypes"

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/sub_lab/components/arena/ArenaPanel.tsx:1-43`
- **Scenario**: `ArenaPanel` renders a tab switcher that lets the user choose between two ~1000-LOC implementations of the same surface. Comments in both files say "Extractable pieces (consider hoisting if this wins)" — a decision that has not been made. Bug fixes must be applied twice (`computeAllTimeChampion` is duplicated verbatim in both, and the model-roster constant is forked into `HERALDRY` vs `MODEL_META`).
- **Root cause**: A/B prototype-in-production pattern with no expiry date or tracking issue. Both panels duplicate `computeAllTimeChampion`, the `ARENA_ROSTER` constant, and large chunks of run-state plumbing.
- **Impact**: 1,141 + 903 = 2,044 LOC of forked code. Every Arena change costs 2x. The "throwaway scaffold" comment in `ArenaPanel.tsx` has been rotting at least one release.
- **Fix sketch**: Pick a winner now or capture the decision in a doc with a kill date. If both must coexist, hoist the shared parts (`computeAllTimeChampion`, `ARENA_ROSTER`, model-stats math) to `arena/arenaShared.ts`. The variant-specific parts are styling/heraldry only.

---

## 3. `useAgentStore` selector tax — 7-11 single-field selectors per panel, no `useShallow`

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_lab/components/regression/RegressionPanel.tsx:?` (11 calls), `eval/EvalPanel.tsx` (10), `ab/AbPanel.tsx` (12), `arena/ArenaPanelColosseum.tsx` (8), `agents/components/matrix/UnifiedMatrixEntry.tsx` (7), `ConnectorsCellContent.tsx` (7)
- **Scenario**: The codebase memory says "TaskRunner store pattern uses `useShallow` from zustand for selective subscriptions." The matrix/lab files do not follow it. `BehaviorCoreEditor.tsx:117` is the lone correct example using `useShallow`. Every other panel issues a fresh `useAgentStore((s) => s.X)` call per field.
- **Root cause**: No lint rule, no codemod, and `useShallow` was adopted in TaskRunner but not back-ported here. New panels copy the existing wrong pattern.
- **Impact**: 7-11 store subscriptions per panel = 7-11 re-render checks on every store mutation. With ~30 BuildEvent updates per second during a build, this is measurable. Beyond perf, it bloats panel tops with 12 lines of import noise before any logic.
- **Fix sketch**: (1) Add a lint or codemod that rewrites N+ adjacent `useAgentStore((s) => s.X)` calls into one `useShallow` call with a destructured object. (2) Document the convention in a short `docs/conventions/zustand-selectors.md`. (3) Convert one panel per PR.

---

## 4. `useBuildSession.ts` mutates two `window` globals to coordinate with EventBridge

- **Severity**: High
- **Category**: code-organization
- **File**: `src/hooks/build/useBuildSession.ts:68-93`, referenced by `src/lib/eventBridge.ts:301`
- **Scenario**: Coordinating "is a Channel currently subscribed for this session?" between the hook and the global event bridge is done through `window.__BUILD_CHANNEL_ACTIVE_SESSIONS__` (a `Set<string>`) and a legacy boolean `window.__BUILD_CHANNEL_ACTIVE__`. Three places (`markSessionActive`, `markSessionInactive` × 2 callers, the EventBridge consumer) cast `window as unknown as Record<string, unknown>` to read/write these.
- **Root cause**: Avoiding circular imports between the hook and EventBridge. The header even acknowledges "A per-session Set replaces the previous global boolean flag, which had a bug" — the bug class will recur.
- **Impact**: Two name-stringly-typed globals, no schema, no type safety, no test surface. New developers grep for `__BUILD_CHANNEL_ACTIVE` and find scattered string keys. HMR persistence relies on whoever sets the flag also resetting it.
- **Fix sketch**: Extract a tiny module `src/lib/build/channelRegistry.ts` exporting `markActive(id)`, `markInactive(id)`, `isActive(id)` and `getActive(): ReadonlySet<string>`. Import it from both consumers. The `globalThis` storage can stay (HMR survival) but is encapsulated. Drop the legacy boolean — EventBridge can call `getActive().size > 0`.

---

## 5. `scoreLabel` duplicated 5x across the lab; helpers fragmented across `shared/`, `libs/`, `components/shared/`

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_lab/components/ab/AbResultsView.tsx:47`, `eval/EvalVersionCards.tsx:12`, `arena/ArenaResultsView.tsx:24`, `shared/ScenarioDetailPanel.tsx:57`, `libs/reportGenerator.ts:21`
- **Scenario**: Each results view re-defines `scoreLabel(score: number)` with the same five thresholds (80/60/40/20). Drift waiting to happen. Same story for `fmtCost`, `fmtDuration`, `escHtml` (in `reportGenerator.ts` only — but the report uses different score colors than the rest of the lab).
- **Root cause**: No central `lab/format.ts`. The `shared/labPrimitives.ts` module exists but only carries `TAG_STYLES`, `formatRelative`, and a diff engine. Callers reach for the closest definition or copy-paste.
- **Impact**: Five files to update if the bands change. Plus convention drift: there are *three* "shared" directories (`sub_lab/shared/`, `sub_lab/components/shared/`, and `lab/shared/index.ts` re-exports) — onboarding devs cannot guess which one to import from.
- **Fix sketch**: Add `sub_lab/shared/labFormatters.ts` with `scoreLabel`, `fmtCost`, `fmtDuration`, `fmtDate`. Re-export from the existing `shared/index.ts`. Codemod the 5 call-sites. Pick *one* shared directory; collapse `components/shared/` into `shared/` (or vice versa) — the current split is purely historical.

---

## 6. Stale docstrings reference deleted/renamed files (`MatrixTab.tsx`, `CapabilityRowEditor`)

- **Severity**: Medium
- **Category**: documentation
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:159-161, 198`, plus the harness scope list itself
- **Scenario**: `matrixBuildSlice.ts` line 159 says "Read-only snapshot for MatrixTab viewing promoted agents." `MatrixTab.tsx` does not exist anywhere in the codebase. Line 198 says "v3 editing actions — invoked by BehaviorCoreEditor / CapabilityRowEditor"; only the former exists. `BehaviorCoreEditor.tsx:6` references `docs/concepts/persona-capabilities/C4-build-from-scratch-v3-handoff.md` — anchors and accuracy unverified by tooling.
- **Root cause**: No automated link-check; renames did not sweep doc comments.
- **Impact**: New devs lose 10–30 minutes hunting for the file before realizing it's gone. The harness scope list itself was generated from these stale docs.
- **Fix sketch**: Add a CI check (`tsx scripts/checkCommentRefs.ts`) that greps comment-mentioned `*.tsx` paths and asserts they exist. Sweep the matrix/lab tree once.

---

## 7. `buildSessionEnricher.extractBuildHints` is dead code in the wrong directory

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/sub_lab/libs/buildSessionEnricher.ts:1-40`
- **Scenario**: `extractBuildHints` is exported, has no callers (`grep -r "extractBuildHints" src/` returns only the definition), and lives under the lab's `libs/` despite its name claiming a relationship to "build session" (which is the matrix flow, not lab).
- **Root cause**: Carry-over from a removed feature. No automated dead-code detection.
- **Impact**: 40 lines of code that look load-bearing because of the filename. Confusing during onboarding ("does the build flow consume lab telemetry?" — no, it doesn't).
- **Fix sketch**: Delete it (or run `knip` / `ts-prune`) once and add either tool to CI. The whole `libs/buildSessionEnricher.ts` and its `LabTestMetadata` import can go.

---

## 8. `UnifiedMatrixEntry.tsx` (586 LOC) inlines layout bookkeeping that belongs in a hook

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:34-46, 211-232, 412-442`
- **Scenario**: One component handles: localStorage layout preference (with migration logic for two retired values), auto-test debounce, auto-submit-answers debounce, GlyphFullLayout's quick-config state (paired ref + setState), process-activity bridging (5 separate `await import("@/stores/overviewStore")` calls), agent name sync from draft, and post-promotion fade. Six `useEffect`s, three `useRef`s, two dynamic-import patterns inlined.
- **Root cause**: The component grew organically as features landed in separate sessions. Each effect was justified locally; together they obscure the entry point.
- **Impact**: A reader needs ~3 minutes to find the actual render in a wall of useEffect noise. Tests for individual effects are hard to write because they're co-located.
- **Fix sketch**: Extract `useLayoutPreference()`, `useAutoTest()`, `useAutoSubmitAnswers()`, `useProcessActivityBridge()`, `useAgentNameSync()`. Each is 10–25 lines. The component drops to ~300 LOC and reads top-down.

---

## 9. `useMatrixBuild` exposes `handleCancel` but no caller uses it

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/features/agents/components/matrix/useMatrixBuild.ts:97-99, 118-126`
- **Scenario**: `useMatrixBuild` returns `handleCancel`. Searching the codebase for `handleCancel` against this hook's return shape (`build.handleCancel` / cancelSession) finds zero usages. Yet the cancel path is non-trivial: it bumps generation, deregisters the channel, resets the store. Devs adding a "cancel build" button discover a hook method that has been silently broken or untested for an unknown amount of time.
- **Root cause**: API exposed without UI; no test exercises the wired-through path; no `// @deprecated` marker.
- **Impact**: Onboarding tax. When someone needs the cancel flow they cannot tell whether the existing API works or whether they should rewrite.
- **Fix sketch**: Either wire it to the existing test for `cancelBuild.test.ts` (verifying the hook entry-point) or add `// FIXME(unwired)` and a tracking issue. Ideally remove from the return shape until needed.

---

## 10. `BuildPhase` and `CellBuildStatus` declared in TS, but `buildTypes.ts` header says they "will eventually be auto-generated by ts-rs"

- **Severity**: Medium
- **Category**: tooling
- **File**: `src/lib/types/buildTypes.ts:1-6`
- **Scenario**: Comment says these "will eventually be auto-generated by ts-rs". Other types in the codebase (`@/lib/bindings/Persona`, `LabArenaResult`, etc.) ARE ts-rs-generated. So the build flow types are perpetually one schema-drift away from a runtime-only failure (caught at best by `isBuildPhase` / `isCellBuildStatus` runtime guards in `matrixBuildSlice.ts:582,665` — which is why those guards exist).
- **Root cause**: Migration to ts-rs was never finished for this slice.
- **Impact**: Backend rename → silent UI breakage. The runtime guards catch it but log to console — easy to miss in dev.
- **Fix sketch**: Either complete the ts-rs migration (one file, the Rust side already exposes the enums) or delete the "eventually" promise and own the manual maintenance. If kept manual, add a CI script that compares the TS string-array against the Rust enum names.

---

## 11. No tests anywhere under `sub_lab/` (matrix tree has 13)

- **Severity**: High
- **Category**: testing
- **File**: `src/features/agents/sub_lab/**` (zero `*.test.*` files), versus `src/features/agents/components/matrix/__tests__/` (13 tests)
- **Scenario**: The matrix tree has CellStateMachine, completenessRing, useMatrixBuild, useMatrixLifecycle, cancelBuild tests, etc. The lab tree — including 800–1100 LOC monoliths like Colosseum/Ledger/GenomeBreedingPanel and the score-aggregation logic in `labAggregation.ts` — has zero. `compositeScore` math, top-N champion derivation, `aggregateAbResults` / `aggregateMatrixResults` are all untested.
- **Root cause**: Test discipline lapsed when the lab was the youngest module. Aggregation is pure-function, no DOM or DB needed; there's no excuse for the gap.
- **Impact**: Refactoring `labAggregation.ts` (e.g. to fix the "null treated as 0" issue mentioned in its header comment) means manual QA of every results view. Score-band drift goes uncaught.
- **Fix sketch**: Add one Vitest file per `libs/` module: `labAggregation.test.ts`, `evalAggregation.test.ts`, `reportGenerator.test.ts` (snapshot-test the HTML output), `dagUtils.test.ts`. Pure functions, fast tests. Copy structure from `matrix/__tests__/cellStateClasses.test.ts`.

---

## 12. `usePanelRunState` ignores its own keep-min-one-effort invariant for models

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/features/agents/sub_lab/libs/usePanelRunState.ts:54-67` vs `45-52`
- **Scenario**: `toggleEffort` refuses to leave the set empty (`"Refuse to leave the set empty — the lab needs at least one effort level"`). `toggleModel` directly above it has no such guard. A user can untoggle the last model and hit Run; every panel guards this separately in its disabled check (e.g. `selectedModels.size === 0`).
- **Root cause**: Asymmetric invariant added later for efforts, never back-applied to models.
- **Impact**: Papercut. Each panel duplicates the model-empty check; the hook should own it.
- **Fix sketch**: Mirror the effort guard in `toggleModel`, OR remove it from effort and let panels guard both uniformly. Pick one rule.

---

## 13. `BuildSessionState.draft: unknown | null` and `agentIr: unknown | null` never refined

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:64`, `lib/types/buildTypes.ts:255`
- **Scenario**: `draft` is read as `Record<string, unknown>` in 6+ call-sites (`UnifiedMatrixEntry.tsx:271`, `BuildReviewPanel.tsx:30`, `matrixBuildSlice.ts:1079, 1093, 1106, 1207`) — each does its own `as Record<string, unknown>` cast and its own field validation (`typeof draftName === "string"`). The IR shape is implicitly known but not encoded.
- **Root cause**: Backend IR shape evolves (mission, identity, voice, principles, use_cases…) and the team hesitated to encode it. The result: parse logic scattered across UI components.
- **Impact**: Adding/renaming an IR field requires updating 6+ ad-hoc string-typed reads. `BuildReviewPanel.checks` and `hydrateBuildSession` already drift apart on what counts as "promoted" because their casts disagree.
- **Fix sketch**: Define `interface AgentIR` in `buildTypes.ts` (mission, identity, voice, principles, constraints, tools, required_connectors, use_cases, name, description, structured_prompt, system_prompt). Type `draft: AgentIR | null`. Centralize parsing in one `parseAgentIr(unknown): AgentIR | null` so the runtime check happens once at the channel boundary, not in every consumer.
