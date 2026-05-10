# Bug Hunt — Pipeline Canvas

> Group: Pipelines, Recipes & Execution
> Files scanned: 9 (drift: closest analogues — TeamCanvas.tsx, CanvasFlowLayer.tsx, TeamDragPanel.tsx, ConnectionEdge.tsx, useCanvasHandlers.ts, useCanvasDragDrop.ts, useCanvasPipelineActions.ts, TeamMemoryPanel.tsx, pipelineStore.ts + recipeSlice.ts + teamSlice.ts)
> Total: 2C / 5H / 4M / 1L = 12 findings

---

## 1. Auto-layout debounced save loses team-id capture, can persist to wrong team

- **Severity**: critical
- **Category**: save-race
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:152`
- **Scenario**: User clicks Auto-Layout on team A, then clicks Back / selects team B within 1500 ms. The debounced timer fires `saveRef.current()` with no argument; inside `handleSave`, `selectedTeamId` is now team B and `nodes` still contains team-A node ids (until the derived sync effect re-runs). `updateTeamMember` is called for team-A member ids while user perceives team B as active; the dirty-flag check `saveForTeamId !== selectedTeamId` is skipped because no id was passed.
- **Root cause**: Unlike `onNodesChange` (line 137) which captures `debouncedTeamId`, the auto-layout path at line 152 calls `saveRef.current()` with no argument so `handleSave` falls back to `selectedTeamId` and bypasses the staleness guard at line 115.
- **Impact**: Silent persistence of stale node positions against the wrong team's member ids; depending on backend behaviour the call 404s silently or, if member ids collide in tests, corrupts another team's layout.
- **Fix sketch**: Capture `const tid = selectedTeamId; setTimeout(() => saveRef.current(tid ?? undefined), 1500)` mirroring the `onNodesChange` pattern, and treat a missing `saveForTeamId` as "fail-closed" rather than fall through.

## 2. `handleBack` fires save without awaiting pending debounced save — last-write-wins inversion

- **Severity**: critical
- **Category**: save-race
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:191`
- **Scenario**: User drags a node (`onNodesChange` fires, `saveStatus='unsaved'`, 1500 ms timer armed), drags a second node 300 ms later (timer rearmed), then clicks Back at 1400 ms. `handleBack` sees `saveStatus==='unsaved'`, clears the autosave timer, and calls `handleSave()` which reads the still-mutating `nodes` prop. If a `setNodes` from React Flow is still in flight (drag-stop change event), the saved positions are off by one frame. After save resolves, `selectTeam(null)` runs but no further save will fire — last user gesture is silently dropped.
- **Root cause**: `handleBack` doesn't await the in-flight React-state flush, and `handleSave` closes over the `nodes` snapshot of the render that produced the back-click handler, which is stale relative to the most-recent drag end.
- **Impact**: User's final position adjustment vanishes after navigating back; reproducible on slower hardware where React batches drag-stop changes across frames.
- **Fix sketch**: Capture the team id, then either flush via a synchronous ref to the latest nodes (`nodesRef.current`) or await an explicit `flushSync` before reading `nodes`.

## 3. Cycle detection is fully server-side — UI accepts a cycle silently until a backend event arrives

- **Severity**: high
- **Category**: cycle
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:84`
- **Scenario**: User drags an edge from member B back to A, where A→B already exists. `isValidConnection` only blocks self-loops (`source !== target`), and `onConnect` only blocks exact duplicates. The 2-cycle is created optimistically; the user can then run the pipeline. Only on `executeTeam` does the Rust side emit `PIPELINE_CYCLE_WARNING` (listener at `useCanvasPipelineActions.ts:80`), and the cycle ids merely color the nodes — nothing prevents the bad run.
- **Root cause**: No client-side topological/cycle check before `createTeamConnection` is fired.
- **Impact**: Accidental cycles persist to DB; user sees the run kick off, then hits an error or deadlock; the optimistic edge stays on canvas because rollback doesn't happen on a successful create.
- **Fix sketch**: Run a quick DFS over `teamConnections + {source→target}` in `onConnect` before calling `createTeamConnection`; reject and toast if a cycle would result.

## 4. Derived-vs-React-Flow node sync drops drag positions on every external change

- **Severity**: high
- **Category**: dnd-desync
- **File**: `src/features/pipeline/components/TeamCanvas.tsx:67-75`
- **Scenario**: User drags member node X to (400, 400) — React Flow `setNodes` updates local state. Concurrently, `derived.nodes` recomputes (e.g. because analytics arrived → cs.analytics changed → `useDerivedCanvasState` recomputes with members from the store at their *server* positions, which are the pre-drag values). The effect at line 67 spreads the *derived* node first, then re-applies `posMap` from the *previous* React-Flow state — this works only because `posMap` was captured before `derived.nodes` overwrites positions. But: a member added optimistically via drag-drop has its temp id swapped to the real id in `addTeamMember` (teamSlice:172). Between the optimistic insert and the swap, `prev` contains `temp-member-…`, `derived.nodes` contains the real id; `posMap.get(realId)` is undefined → node renders at server-default position, then jumps when next render aligns.
- **Root cause**: `posMap` is keyed by id; id changes during the optimistic→real swap, so positions are not preserved across the swap.
- **Impact**: Newly dropped node visibly jumps from drop location to default `(100 + count*220, 80)` for a frame, or settles at the wrong spot if the backend stored a default.
- **Fix sketch**: Match by `persona_id` for nodes whose id starts with `temp-member-`, or merge by member.persona_id key during the swap window.

## 5. `EventName.PIPELINE_STATUS` listener registers per-team but stale closure can leak between teams

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/pipeline/components/canvas/useCanvasPipelineActions.ts:48-73`
- **Scenario**: User selects team A. `listen<…>(PIPELINE_STATUS, …)` is called and returns a Promise. Before that resolves, user switches to team B. The cleanup runs (sets `cancelled=true`); when the original `listen()` resolves it calls `fn()` to detach. But: a second effect run for team B has *already started*, and if the first `then(fn)` resolves *after* team-B's `listen()` returns its `unlistenFn`, both unlisten functions point to different subscriptions. There is a window where two listeners are simultaneously alive (one for A, one for B). The team-B listener's closure also reads `selectedTeamId` from the closure (B), so it filters correctly — but the team-A listener (still attached if `then` hasn't run yet) inside its callback compares `event.payload.team_id === selectedTeamId` where `selectedTeamId` is captured A's closure value — still A. Status events for team A while user views team B will be processed and dispatched into the canvas reducer (which reset on team switch), corrupting A-specific state that bleeds back when user returns to A.
- **Root cause**: `cancelled` flag covers the resolution path, but state captured inside the event callback is the *first effect-run's* `selectedTeamId`; multiple stacked effect runs race.
- **Impact**: Status updates from a previous team's run flicker the cycle highlight / running indicator on the current team's canvas; "memories pulsing" can fire when user is no longer on that team.
- **Fix sketch**: Inside the callback, read latest store state via `usePipelineStore.getState().selectedTeamId` rather than relying on the captured `selectedTeamId`.

## 6. Drop handler bypasses the same-position dedupe and doesn't validate persona id is in `personas`

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/pipeline/components/canvas/useCanvasDragDrop.ts:55-64`
- **Scenario**: User drags a persona panel item; in the panel's `handleDragStart` (TeamDragPanel.tsx:18), `canvasDragRef.current = personaId` and `dataTransfer.setData('application/persona-id', personaId)`. If the user drops *outside* the canvas (over a resize-panel handle), `handleDragEnd` runs and clears `canvasDragRef.current = null`. But if drop fires the canvas `onCanvasDrop` first (event ordering varies on Windows), `e.dataTransfer.getData('application/persona-id')` still works, *but no validation that the persona still exists in the store* — a persona deleted between dragstart and drop creates a phantom team member that maps to no persona on render.
- **Root cause**: No `personas.find((p) => p.id === personaId)` guard in `onCanvasDrop`; pure trust of the drag payload.
- **Impact**: Optimistic member with `agentNames[id] = 'Agent'` fallback (useCanvasHandlers.ts:60), backend `addTeamMember` likely fails on FK; rollback removes member but a brief flash and console error appear.
- **Fix sketch**: Validate `personas.some((p) => p.id === personaId)` before calling `addTeamMember`; toast otherwise.

## 7. `handleAssistantApply` index-based connection wiring breaks on partial member-create failure

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/pipeline/components/canvas/useCanvasPipelineActions.ts:117-127`
- **Scenario**: Blueprint has 5 members and 6 connections referencing indices 0..4. The third `addTeamMember` await fails (network blip) — `addTeamMember` returns `null` in slice (teamSlice:182). The loop at line 122 just doesn't push to `newMemberIds`; it does NOT rethrow. Subsequent connection wiring uses `newMemberIds[c.source_index]`. With one member missing, indices 3 and 4 are now off-by-one, so connections wire **wrong** members together. No error; the user accepts a misshapen blueprint.
- **Root cause**: Index-based mapping assumes 1:1 success; null returns silently shift indices.
- **Impact**: Blueprints from the AI assistant are silently mis-wired; very hard to notice in graphs ≥4 nodes.
- **Fix sketch**: Use a `Map<number, string>` (`blueprintIndex → realId`); push `null` placeholders on failure and reject the whole operation if any are null, or rollback already-created members.

## 8. Sticky-note auto-save bypasses backend — purely in-reducer state, lost on page reload

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:69-82, 130`
- **Scenario**: User adds sticky notes via `handleAddNote`. `dispatch({ type: 'ADD_STICKY_NOTE', … })` updates `cs.stickyNotes` (canvas reducer). `onNodesChange` only persists position via `UPDATE_STICKY_NOTE_POSITION` (also reducer-only). `handleSave` filters `n.type !== 'stickyNote'` (line 118) — no backend write for notes at all. User refreshes; notes are gone.
- **Root cause**: Sticky notes are local-only state but the UI suggests they're part of the team canvas (alongside saved members).
- **Impact**: Documentation / annotations vanish silently on reload, on `handleBack` (resets reducer), or on team switch.
- **Fix sketch**: Persist notes in `team_config` JSON or a dedicated table, or label them clearly as ephemeral session notes.

## 9. Duplicate-edge guard uses `===` against optimistic temp ids — race with concurrent connect

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:89`
- **Scenario**: User drags A→B, then immediately A→B again before the first `createTeamConnection` resolves. First call inserts `temp-conn-…` with `source_member_id=A`, `target_member_id=B`. Second `onConnect` checks `teamConnections.some(c => c.source_member_id===A && c.target_member_id===B)` — that *does* find the optimistic temp, so the duplicate is correctly blocked. Good. BUT: if the temp swap happens between `getState()` reads and the second `onConnect` (i.e. the realConn replaces temp), the same check works — also fine. However: the `teamConnections` value in `onConnect`'s closure is from the render in which `useCanvasHandlers` re-ran. If two connect events fire in the same React batch (e.g. autosuggested apply of a blueprint), both see the *pre-insert* connection list and both create the same edge. No backend uniqueness check is enforced UI-side.
- **Root cause**: Closure-captured `teamConnections` is stale within a single React batch; the deduplication is best-effort, not atomic.
- **Impact**: Rare duplicate connections in DB during AI-blueprint apply / paste flows; visual: two overlapping edges with same color.
- **Fix sketch**: Read `usePipelineStore.getState().teamConnections` inside the callback.

## 10. TeamMemoryPanel resize listeners attach `mousemove` globally with no `pointerleave/blur` cleanup

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/pipeline/sub_teamMemory/components/panel/TeamMemoryPanel.tsx:71-88`
- **Scenario**: User starts resizing the panel (mousedown sets `draggingRef.current = true`), then drags off the window into the OS taskbar and releases the mouse there. `mouseup` doesn't fire on `window` because the OS captured it. `draggingRef.current` stays `true`; `document.body.style.cursor = 'col-resize'` and `userSelect = 'none'` remain; every subsequent mouse move on the page re-triggers `resizePanelFrame`, resizing the panel as the cursor moves.
- **Root cause**: No `pointercancel`, `blur`, or `visibilitychange` fallback to release the drag.
- **Impact**: Panel resizes "ghost-drag" until user clicks somewhere; cursor stuck as col-resize.
- **Fix sketch**: Use `pointermove`/`pointerup` with `setPointerCapture` on the handle, or add window `blur` listener that resets `draggingRef`.

## 11. Memory-search debounce + category change race causes wrong filter on backend

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/pipeline/sub_teamMemory/components/panel/TeamMemoryPanel.tsx:108-114`
- **Scenario**: User types "auth" (debounce armed for 300 ms with `q="auth"`, `activeCategory="all"`). Before 300 ms elapses, user clicks category "decision" — `handleCategoryChange` immediately fires `onFilter('decision', "auth")` (uses local `searchQuery`, OK). Then the debounced callback fires `onFilter(undefined, "auth")` — it captured `activeCategory="all"` from the render in which the timeout was scheduled, *not* the new "decision" value. Backend now serves all categories matching "auth", but UI shows category filter pill = "decision". User sees memories that don't match the visible filter.
- **Root cause**: `setTimeout` callback closes over `activeCategory` at scheduling time; doesn't read latest state.
- **Impact**: UI/data divergence in memory list — confusing during debugging.
- **Fix sketch**: Use a ref for `activeCategory` or read from a callback that reads latest state via `useRef`-mirrored value.

## 12. `removeTeamMember` doesn't clear `selectedMember` if context menu / dialog references it

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:162`
- **Scenario**: User opens node context menu on member M (`setContextMenu({…member:M})`), opens detail panel (`setSelectedMember(M)`), then triggers Remove from somewhere else (toolbar / API event). `handleRemoveMember` sets `selectedMember=null`, but `cs.contextMenu` still holds M. On next `onPaneClick` the context menu disappears, but during the window the user can re-click "remove" → `removeTeamMember(M.id)` is called twice (second is a no-op since member is gone, but rolls forward an error toast via `reportError`).
- **Root cause**: Only one of two per-member ephemeral selections is cleared on remove.
- **Impact**: Spurious "Failed to remove team member" toast after a successful remove.
- **Fix sketch**: In `handleRemoveMember`, also call `setContextMenu(null)` and `setEdgeTooltip(null)` for any tooltip whose edge references the removed member id.
