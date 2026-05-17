# Perf-Optimizer Scan — Execution Engine, Healing & Genome

> Project: Personas (frontend-only)
> Scope: 4 paths in src/
> Total: 7 findings (1 critical / 3 high / 2 medium / 1 low)

## Scope notes
- Files read in full: `src/stores/slices/agents/executionSlice.ts`, `src/stores/slices/processActivitySlice.ts`, `src/api/agents/genome.ts`, `src/api/agents/evolution.ts`.
- Cross-checked consumers via grep: `ProcessActivityIndicator.tsx`, `ProcessActivityDrawer.tsx`, `useSidebarAgentActivity.ts`, `useRunnerState.ts`, `useExecutionList.ts`, `eventBridge.ts` (PROCESS_ACTIVITY / QUEUE_STATUS), `useGenomeBreeding.ts`, `useEvolutionPanelState.ts`, `GenomeBreedingPanel.tsx`, `GenomeBreedingParts.tsx`.
- `processActivitySlice` is read by titlebar (`ProcessActivityIndicator` — always mounted) and the dock drawer — every status tick from the engine flows through these.
- Excluded: `src-tauri/` (per scope), the Rust executionSink batching is fine (microtask coalesces lines).

---

## 1. Titlebar `ProcessActivityIndicator` re-renders on every telemetry tick of every run
- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/shared/components/layout/ProcessActivityIndicator.tsx:12-14` (consumer) + `src/stores/slices/processActivitySlice.ts:230-272` (`enrichProcess` / `updateProcessStatus`)
- **Scenario**: A persona executes and the backend emits per-tool-call telemetry (`enrichProcess` for `toolCallCount`/`costUsd`/`lastEvent`) plus periodic `updateProcessStatus`. Each call does `set({ activeProcesses: { ...state.activeProcesses, [key]: {...existing, ...} } })` — a brand-new outer object every time. The always-mounted titlebar indicator selects `Object.keys(s.activeProcesses).length` wrapped in `useShallow`.
- **Root cause**: `useShallow` over a *primitive return* (a number) provides no benefit and, more importantly, the *selector* still runs on every store mutation. Worse, because `activeProcesses` is a fresh object on every enrich, any consumer that reads `s.activeProcesses` directly (`ProcessActivityDrawer.tsx:142-147` reads the whole map via `useShallow`) re-renders too — even when only `lastEvent` deep inside one entry changed.
- **Impact**: Every backend event (potentially dozens/sec during streaming) re-runs the `Object.keys(...).length` selector for the indicator AND re-renders the entire drawer + every `ProcessRow` if open. The titlebar lives on every screen, so the cost is global.
- **Fix sketch**: (a) Maintain a derived `activeProcessCount: number` in the slice and select that primitive directly (no useShallow). (b) For drawer rows, store the per-process objects keyed by id and have each `ProcessRow` subscribe to its *own* `s.activeProcesses[key]` slot via a stable selector — only the row whose telemetry changed re-renders. (c) Or split `enrichProcess` cost/toolCall mutations into a separate slice that the count selector doesn't touch.

---

## 2. `ProcessActivityDrawer` recomputes 3 filter passes + sort on every store mutation
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/shared/components/layout/ProcessActivityDrawer.tsx:184-192`
- **Scenario**: While the drawer is open during a long run, `enrichProcess` fires per tool call. The drawer reads the entire `activeProcesses` map via `useShallow`, then in the render body runs three independent `Object.entries(activeProcesses).filter(...)` passes plus a sort on the queued group. Each filter allocates a fresh array; the sort allocates again.
- **Root cause**: Filtering/sorting executed at top-level of render, not memoized. With the fresh outer object from finding #1, `useShallow` doesn't help — its reference equality on the inner object always passes only when *no* entry mutated.
- **Impact**: Linear O(n) work per status tick where n = active processes; allocates 3 arrays + 1 sorted array each time. On a multi-execution session (5–10 concurrent runs each with sub-second telemetry) this is the dominant cost when the drawer is open.
- **Fix sketch**: Wrap the three partitions in a single `useMemo` over `activeProcesses`, returning `{ running, action, queued }` in one pass; only recompute when the *set of keys/statuses* actually changes (use a status-fingerprint dep).

---

## 3. `executePersona` reads sibling slice via unsafe cast on every spawn (`personas.find`)
- **Severity**: medium
- **Category**: re-render / algorithmic
- **File**: `src/stores/slices/agents/executionSlice.ts:310-319`
- **Scenario**: When spawning a background execution, the slice does `(get() as unknown as { personas: Array<...> }).personas ?? []` then `.find((p) => p.id === personaId)`. The personas array can be hundreds of entries; this O(n) lookup runs on every background spawn.
- **Root cause**: Linear scan plus the broader concern that `backgroundExecutions: [...state.backgroundExecutions, bgExec]` creates a new array, which `useSidebarAgentActivity` and `AgentsSidebarNav` subscribe to with `useShallow`. Those hooks then iterate all background executions through a `useMemo` on every persona update.
- **Impact**: Scales with concurrent backgrounds × persona count. Sidebar dot recomputation is bounded but adds up under heavy parallel use.
- **Fix sketch**: Maintain a `Map<personaId, Persona>` in the persona slice (or memoized selector hook) and pass it in. Also extract a `denormalizedPersonaName(id)` helper that takes the id only and reads via getState() once.

---

## 4. `extractGenome` fired serially in a for-loop per breeding result load
- **Severity**: high
- **Category**: duplicate-call / async-coordination
- **File**: `src/features/agents/sub_lab/components/genome/useGenomeBreeding.ts:60-73` (consumer of `src/api/agents/genome.ts:14-15`)
- **Scenario**: User selects a breeding run with N parents. The loop `for (const pid of parentIds) { await genomeApi.extractGenome(pid); ... }` walks parents sequentially, awaiting each IPC round-trip before starting the next. Parent count goes up to 5 (the cap in `toggleParent`).
- **Root cause**: Sequential await pattern instead of `Promise.all`. Each `extractGenome` invokes a Tauri command that parses the full persona genome JSON in Rust and returns a typed object — the calls are independent and trivially parallelizable.
- **Impact**: 5 parents × ~80ms IPC = 400ms+ blocking the breeding panel before results render. Worse, this fires every time the user clicks a different run.
- **Fix sketch**: Replace with `await Promise.all(parentIds.map(pid => genomeApi.extractGenome(pid).then(g => [pid, g]).catch(() => null)))` then build the Map from non-null entries. Also memoize per-parentId at the hook level so revisiting the same run doesn't re-fetch.

---

## 5. `OffspringCard` re-parses genome + fitness JSON on every render
- **Severity**: high
- **Category**: data-layer / algorithmic
- **File**: `src/features/agents/sub_lab/components/genome/GenomeBreedingPanel.tsx:387-388` and `GenomeBreedingParts.tsx:190-195`
- **Scenario**: Each offspring card calls `parseJsonOrDefault<PersonaGenome>(result.genomeJson, null)` and `parseJsonOrDefault<FitnessScore>(result.fitnessJson, null)` directly in the render body. The genome JSON is a *full persona blob* (system prompt + tools + model config + behaviors) — typically multi-KB. With N offspring per run × parent toggle/sort interaction in the parent panel, every re-render reparses every card.
- **Root cause**: No memoization; `parseJsonOrDefault` is invoked on the raw string every time. Same string in, same object out — but JSON.parse cost is paid each time.
- **Impact**: Scales with N offspring × render frequency. Visible jank when the user adjusts sliders/objective in the parent panel (which sits above and re-renders the children grid).
- **Fix sketch**: Move parsing into a `useMemo(() => parseGenome(result.genomeJson), [result.genomeJson])`, same for fitness. Better: parse once when results arrive in `useGenomeBreeding.loadResults` and store parsed objects in state alongside the raw `GenomeBreedingResult[]`.

---

## 6. Evolution / breeding pollers do not back off and over-fetch list endpoints
- **Severity**: medium
- **Category**: duplicate-call / async-coordination
- **File**: `src/features/agents/sub_lab/components/evolution/useEvolutionPanelState.ts:152-168` and `src/features/agents/sub_lab/components/genome/useGenomeBreeding.ts:111-129`
- **Scenario**: After triggering a cycle, the hooks `setInterval(..., 3000ms / 2000ms)` and call `listCycles(personaId, 1)` or `listBreedingRuns()` (no `limit`!) on every tick. `listBreedingRuns` with no limit returns every breeding run in the DB; the polling code only needs to look up *one* runId. After a long history accumulates, every 2s the frontend pulls down the full list.
- **Root cause**: Polling endpoint mismatch — list-fetch used as a status-poll surrogate. No exponential backoff; the 2-minute fixed timeout still keeps tight intervals while waiting.
- **Impact**: O(history) payload every 2s for the 2-minute polling window. On a project with 100s of runs, that's hundreds of KB / poll, all to discover one status flip. Polled while the panel is open even if backgrounded (no `documentVisibility` gate).
- **Fix sketch**: (a) Add a `getBreedingRun(id)` single-row endpoint or pass a `limit: 1` filter for the active run id. (b) Apply exponential backoff (2s → 4s → 8s, capped). (c) Pause polling when document is hidden via `subscribeDocumentVisibility`.

---

## 7. `recentProcesses` array always allocated even when no consumer cares
- **Severity**: low
- **Category**: re-render
- **File**: `src/stores/slices/processActivitySlice.ts:224-226`
- **Scenario**: Every `processEnded` does `[ended, ...state.recentProcesses].slice(0, MAX_RECENT)`. The `recentProcesses` array is only consumed inside the drawer (`ProcessActivityDrawer.tsx:142-147`). But its mutation propagates to *any* subscriber of the slice — including the always-mounted indicator, even though it only reads `Object.keys(activeProcesses).length`.
- **Root cause**: Co-located state with mismatched subscriber sets. The indicator subscribes to the slice via `useShallow((s) => Object.keys(s.activeProcesses).length)` which is fine for the count, but every store update still runs the selector.
- **Impact**: Minor — selector runs but returns the same number, so no re-render. Worth flagging because the same fix (split into two slices or use atomic selectors) removes a class of similar issues.
- **Fix sketch**: Either keep `recentProcesses` in a separate Zustand store, or accept the harmless selector re-run as cheap compared to fixes 1–2.

---

## Out of scope / not findings
- `executionSink` ring buffer + microtask batching (in `src/lib/execution/executionSink.ts`) is well-engineered: capped at 10k lines / 10MB with tail mode + visibility-gated throttle. Not in the 4-file scope but verified as not contributing to slice re-render cost.
- `completedOutputs` Map in `executionSlice.ts:46-56` is correctly module-local (not in store state) and bounded by both TTL and cap — no leak.
- `fetchExecutions` already deduplicates in-flight promises and caches with 30s TTL (lines 471-506) — solid.
