# Perf-Optimizer Scan — Lab, Use Cases, Tools & Connectors

> Project: Personas (frontend-only)
> Scope: 18 paths in src/
> Total: 9 findings (1 critical / 4 high / 3 medium / 1 low)

## Scope notes

- The directory `src/features/agents/sub_health` only contains `components/HealthTab.tsx` (a thin wrapper); the substantive health logic lives in `src/features/agents/health/*` which is in scope and was read in full.
- `src/features/agents/sub_settings` contains only two thin tab components — verified, nothing perf-relevant beyond them.
- "Largest" lab variant is `ArenaPanelColosseum.tsx` (~1060 LOC); read in full. `RecipesVariantSigilGrid.tsx` (~717 LOC) and its `shared/*` siblings were read in full because they drive every tile on the Use Cases tab.

---

## 1. SigilGrid tile renders N hook subscriptions + Listbox per slot, with no memoization

- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/agents/sub_use_cases/components/recipes-prototype/RecipesVariantSigilGrid.tsx:244-277` (slots map) + `shared/TilePolicyToggles.tsx:19-23` + `shared/TileModelStrip.tsx:39-66` + `shared/usePolicyControls.ts:55-100`
- **Scenario**: Editor's Use Cases tab. The grid lays out up to `GRID_SLOT_COUNT = 9` tiles. Each `SigilTile` renders `TileModelStrip` + `TilePolicyToggles`, and each of those calls `usePolicyControls(...)` → which calls `useAgentStore((s) => s.fetchDetail)`, `useTranslation()`, builds a fresh `settings` `useMemo`, holds local `pending` state, and creates 3 `useCallback`s. `TileModelStrip` does its own `useAgentStore`, `useTranslation`, and renders a `Listbox` (with its own event listeners) per tile. Neither `SigilTile`, `TilePolicyToggles`, nor `TileModelStrip` is wrapped in `React.memo`.
- **Root cause**: A single store change that touches the agent slice (very frequent: `selectedPersona`, `isExecuting`, lab progress, tool defs cache, executions list, etc.) re-renders the parent and cascades into all 9 tiles × 2 sub-strips × 3 hooks. `usePolicyControls.settings` is memoed on `uc.raw.generation_settings` but `uc` is recreated upstream in `RecipesVariantSigilGrid.tsx:144-147` (`rawUseCases.map(...)`) every render unless `rawUseCases` and `personaConnectors` are both referentially stable — and `useUseCasesTab` returns a fresh `useCases` reference (`contextData.useCases ?? []` at `libs/useUseCasesTab.ts:21`) whenever `useParsedDesignContext` rebuilds.
- **Impact**: Every keystroke in any sibling editor (input form, terminal output line, executions progress tick) re-renders every tile, re-mounts Listbox listeners, and re-computes resolveEffectiveModel(...) per tile. Compounds when the runner is streaming output.
- **Fix sketch**:
  - Wrap `SigilTile`, `TilePolicyToggles`, `TileModelStrip` in `React.memo` with stable `uc` identity.
  - Stabilise `items` in `RecipesVariantSigilGrid.tsx:144` by caching `toDisplayUseCase` results keyed by `(uc.id, personaConnectors snapshot version)`.
  - Pull `useTranslation` out of `TileModelStrip` body (the labels only change on locale switch — render once at parent and pass strings down).
  - Have `TilePolicyToggles` subscribe only to its `pending` slice rather than re-invoking `usePolicyControls` (which subscribes to `fetchDetail` even though that reference is stable).

---

## 2. Per-tile cascading `fetchDetail` refetches the entire persona on each toggle

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/agents/sub_use_cases/components/recipes-prototype/shared/usePolicyControls.ts:78` + `shared/TileModelStrip.tsx:60` + `shared/ConnectorDimCard.tsx:61` + `shared/NotificationsDimCard.tsx:48` + `src/features/agents/sub_use_cases/libs/useCapabilityToggle.ts:93`
- **Scenario**: User clicks the memory / review / events toggle on a tile, swaps the model, edits a connector/notification chip, or toggles the capability — each handler does `await setX(...); await fetchDetail(personaId)`.
- **Root cause**: Five separate code paths all call the full `fetchDetail` after a single-field mutation. `fetchDetail` re-fetches the whole persona (`tools`, `automations`, `design_context`, etc.) and invalidates every downstream selector. Toggling memories + reviews + events on the same tile in succession fires three sequential full refetches and three full re-renders of the grid.
- **Impact**: A user fluently tweaking three policy toggles on one tile pays for three full persona loads back-to-back, each re-rendering the whole editor + grid + every other tile.
- **Fix sketch**:
  - Return the patched fields from `setUseCaseGenerationSettings` and apply them in-place in the store (optimistic patch), without a follow-up `fetchDetail`.
  - If a refetch is truly required (cascade side-effects), debounce the trailing `fetchDetail` per `(personaId, useCaseId)` by ~250 ms so back-to-back toggles coalesce.
  - Alternatively, add a `fetchUseCase(personaId, useCaseId)` API that returns just the one use-case row and apply that delta.

---

## 3. `ExecutionLogViewer` splits/classifies the entire log on every render

- **Severity**: high
- **Category**: data-layer / algorithmic
- **File**: `src/features/agents/sub_executions/detail/views/ExecutionLogViewer.tsx:87-95`
- **Scenario**: User opens an execution detail with a long log (multi-MB CLI runs are common per the runner code path).
- **Root cause**: `logContent.split('\n').map((line, i) => { const style = classifyLine(line); ... })` runs on every render with no `useMemo`. There is no virtualization and `whitespace-pre-wrap break-words` lays out every node in a single scroll container with `max-h-96 overflow-y-auto`. A re-render from any sibling state change (the parent `ExecutionList` has many useState calls that fan out) re-classifies and re-creates every line node.
- **Impact**: Opening the log expands to N DOM divs (N = line count), and every parent state change re-runs `classifyLine` × N. For a 5k-line log: visible jank on toggle + ongoing CPU per render.
- **Fix sketch**:
  - Memoize the classified array: `const lines = useMemo(() => logContent?.split('\n').map(l => ({ text: l, cls: TERMINAL_STYLE_MAP[classifyLine(l)] })) ?? [], [logContent])`.
  - Use the existing `getExecutionLogLines(id, callerId, offset, limit)` API (already in `src/api/agents/executions.ts:89`) with pagination instead of fetching the whole file.
  - Virtualize the row list (project already ships a `VirtualizedTableBody` in `sub_lab/components/shared`).

---

## 4. `LabEventStream.deriveToolCallDurations` is O(n²) and recomputed every render

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/agents/sub_lab/components/shared/LabEventStream.tsx:18-29` and call site `:48`
- **Scenario**: User expands the event stream on any lab result (Arena/AB/Matrix/Eval scenario detail).
- **Root cause**: For each `tool_use` event the function does `events.slice(i + 1).find(...)` — O(n²) in event count with an allocation per outer iteration. The result Map is also recomputed on every render because `const toolDurations = events ? deriveToolCallDurations(events) : new Map(...)` sits in render body with no `useMemo`. CLI runs routinely emit hundreds of events.
- **Impact**: Hundreds-of-events streams visibly stall on open + on every subsequent re-render (e.g. when the parent ScenarioDetailPanel toggles a rating).
- **Fix sketch**:
  - Single forward pass: when seeing `tool_use`, push its `(index, tsMsRelative)` onto a small stack; on `tool_result` pop and emit `Map.set(toolUseIndex, { durationMs })`.
  - Wrap in `useMemo` keyed on `events`.

---

## 5. Lab CRUD slice triple-fetches matrix/ab/eval and refetches results on every expand

- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/stores/slices/agents/labSlice.ts:332-335` and `usePanelRunState.ts:30-36`
- **Scenario**: User switches between Arena/AB/Matrix/Eval/Regression tabs and expands a row.
- **Root cause**: `usePanelRunState` runs `fetchRuns(personaId)` on every mount keyed on `selectedPersona?.id` — every panel switch refetches the run list. Worse, in `useAbPanelState.ts:29` and `EvalPanel.tsx:31` the `fetchRuns` callback is `(pid) => { fetchVersions(pid); fetchAbRuns(pid); }` (or `…fetchEvalRuns`), and these are not memoized. Each tab switch fires `fetchVersions` again even though it's the same `promptVersions` slice that other panels populated seconds earlier. The slice already has `fetchResults` skip caching for terminal runs (`labSlice.ts:166-175`), but `fetchRuns` has no `lastFetchedAt` guard.
- **Impact**: Frequent panel switching during a single editor session yields 2–3× the necessary IPC traffic and a perceptible flash of "Loading runs…".
- **Fix sketch**:
  - Add `_runsCachedAt[personaId]` TTL guard in `createLabCrud.fetchRuns` mirroring the `toolSlice` 60 s TTL pattern (`toolSlice.ts:57-64`).
  - Memoize the composed `fetchRuns` lambdas in `useAbPanelState` / `EvalPanel` with `useCallback` so the `usePanelRunState` effect doesn't re-fire on every render.
  - Share `promptVersions` fetch across panels with a single TTL guard rather than re-fetching from each composed lambda.

---

## 6. `DependencyGraphPanel` performs nested `graph.nodes.find()` lookups inside maps

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/agents/sub_connectors/components/connectors/DependencyGraphPanel.tsx:312-332` (selected node detail) and `:354-371` (relationships list); also `libs/dependencyGraph.ts:77`, `:87`, `:129`, `:185-187`, `:207`
- **Scenario**: User selects a credential node or scrolls the relationships list.
- **Root cause**: Detail panel calls `graph.nodes.find((n) => n.id === otherId)` inside `.map((edge) => ...)` (twice per edge) — O(nodes × edges). Same pattern in `dependencyGraph.ts:87` (inside `analyzeDepBlastRadius`'s loop), `:129`/`:185` (`credentials.find(...)` inside automation loops). For personas with many tools/automations this is a hot path on selection.
- **Impact**: Click latency grows quadratically with the size of the persona's connector graph; cheaply fixed but currently a step function.
- **Fix sketch**:
  - Build `nodeById = new Map(graph.nodes.map(n => [n.id, n]))` once with `useMemo`, look up in O(1).
  - In `buildPersonaDependencyGraph`, build `credentialById` once (already partially done via `credNodeMap`) and reuse it instead of `credentials.find(...)`.

---

## 7. `useConnectorStatuses` auto-test effect re-walks all statuses every render and chains a separate `setStatuses` rebuild

- **Severity**: medium
- **Category**: re-render / data-layer
- **File**: `src/features/agents/sub_connectors/libs/useConnectorStatuses.ts:64-85`, `:119-128`, `:132-147`
- **Scenario**: Connectors tab is open; any credential change or a single connector status update.
- **Root cause**: Three effects fan out from `statuses`. The "build connector statuses" effect (`:64`) depends on `requiredCredTypes`, `credentials`, `credentialLinks`, `credentialsByServiceType`, `credentialsByIdMap` — five inputs that frequently change identity together. It uses `setStatuses` with a functional updater that always returns a new array even when nothing changed (rebuilds via `.map`), feeding the next two effects (`:119` and `:132`) which each iterate the new statuses array. So a single re-link triggers: rebuild statuses → fire prevCredentialIdsRef sweep → fire auto-test sweep → render → rebuild statuses (if any test result lands).
- **Impact**: On a persona with many tools/connectors a single credential edit creates a render storm of ~4–6 cascading effects. Not a single-frame stall, but observable in profiling and grows linearly with connector count.
- **Fix sketch**:
  - Inside the build effect, short-circuit if the produced array is structurally equal to `prev` (same names + credentialIds + result identity) and return `prev` to bypass the downstream effect chain.
  - Merge the two `for (const status of statuses)` loops at `:120` and `:133` into one effect — they have identical dependency arrays.
  - Move `prevCredentialIdsRef` invalidation into the build effect's callback (where the new credentialId is computed) to avoid the extra render-pass.

---

## 8. `ArenaPanelColosseum` allocates new model option rows + heraldry lookups every render

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/agents/sub_lab/components/arena/ArenaPanelColosseum.tsx:258-272` (roster) and `:329-348` (Contenders list)
- **Scenario**: Arena tab is open; any state change (toggle a model, useCase popover open, healthCheck refresh, persona switch).
- **Root cause**: `ARENA_ROSTER.map((m) => { … heraldryFor(m.id, m.provider) … })` and the parallel `ARENA_ROSTER.filter(...).map(...)` inside the JSX rebuild on every render. `heraldryFor` is a tiny pure function but its call site is inside JSX with no memoization, and the resulting `ModelRowCard` props (`heraldry` object) are fresh refs every render — so all `ModelRowCard`s re-render even when `selectedModels` didn't change. `arenaRuns`-driven `computeAllTimeChampion` is correctly memoed at `:219` but the Roster grid is not.
- **Impact**: Per-toggle Arena panel re-renders are heavier than needed; doesn't scale once OLLAMA models pile up.
- **Fix sketch**:
  - `const heraldryByModelId = useMemo(() => new Map(ARENA_ROSTER.map(m => [m.id, heraldryFor(m.id, m.provider)])), [])` (ARENA_ROSTER is module-const).
  - Wrap `ModelRowCard` in `React.memo` with `selected: boolean` and primitive props only.
  - Pull `championModel` and `effectiveModel` out into a child component to avoid re-rendering the entire panel when only the conditions list changes.

---

## 9. `useToolRunner.runTool` rebuilds the setTimeout race promise per call (minor)

- **Severity**: low
- **Category**: memory
- **File**: `src/features/agents/sub_tool_runner/libs/useToolRunner.ts:92-97`
- **Scenario**: User clicks Run on a tool.
- **Root cause**: A fresh `Promise.race([..., timeoutPromise])` is created each call; on success the unfilled timeout is never cleared via `clearTimeout`, so the 120 s timer fires after success/failure (no observable bug — `setStates` is gated on persona ref — but it pins a closure and a timer in memory).
- **Impact**: Negligible per-click; relevant only if a power user runs hundreds of tools per session — orphaned timers and closures accumulate until the 120 s window passes.
- **Fix sketch**:
  - Hold the timer id with `let timerId: number; const timeout = new Promise<never>((_, reject) => { timerId = window.setTimeout(...) })` and `clearTimeout(timerId)` in `finally`.
