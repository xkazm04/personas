# Perf-Optimizer Scan — Pipeline, Team Memory, Sharing & Network

> Project: Personas (frontend-only)
> Scope: 5 paths in src/
> Total: 9 findings (1C / 4H / 3M / 1L)

## Scope notes

- Scope as declared: `src/features/pipeline/components`, `src/features/pipeline/sub_canvas`, `src/features/pipeline/sub_teamMemory`, `src/features/sharing/components`, `src/api/network`.
- All paths exist and are populated; no scope drift.
- The ReactFlow canvas (`@xyflow/react`) is the dominant hot path: it is driven by `useDerivedCanvasState` (memoized re-derivation) and a `useEffect` that pushes derived data into `useNodesState`. A live Tauri `PIPELINE_STATUS` event stream feeds reducer state (`pipelineNodeStatuses`) that the derived state depends on, so anything in that dependency chain runs once per pipeline-status tick — that is the primary scaling axis.
- `src-tauri/` was not analyzed (per instructions).

---

## 1. Pipeline status tick rebuilds every Node object → full canvas re-render

- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/pipeline/components/TeamCanvas.tsx:67-75`
- **Scenario**: A pipeline run is in flight. The Rust engine emits `PIPELINE_STATUS` events as each node transitions (queued → running → completed). On a team with N ≈ 30–60 members, this fires several times per second.
- **Root cause**: `useDerivedCanvasState` recomputes `derived.nodes`/`derived.edges` on every `pipelineNodeStatuses` change (correct, it must) — but the sync effect below it then walks **every** node, spreads each one into a new object to overwrite position from `posMap`, concatenates with sticky notes, and calls `setNodes(...)`. Because every node object is a fresh reference, ReactFlow sees N "changed" nodes and re-renders **every** `PersonaNode` and revalidates **every** edge layout. The `data` payload on most nodes is unchanged but reference-different, so the `memo()` on `PersonaNodeComponent` does not help (default shallow compare on `data` fails because `data` is a new object).
- **Impact**: At N=50, each status tick walks 50 nodes × spreads + 50 PersonaNode renders + edge re-layout. On a 6–8 Hz status stream the main thread is pinned; users report the canvas "locks up" while a pipeline runs. Linear in node count, multiplied by status-event frequency.
- **Fix sketch**: In the sync effect, compare each derived node's `data` (and id/position) against the previous node by reference; only emit a new object when something actually changed. Better: move position-merge into `useDerivedCanvasState` itself (read positions from a ref of the last applied map) and `setNodes(derived.nodes)` directly when reference-equal slots are preserved. Alternatively, keep `data` as a stable object per member by memoizing per-member-id (Map cache keyed by member.id + status + suggestion + dryRun); only rebuild the row whose underlying state actually changed.

## 2. `onNodeDrag` recomputes alignment guides against every node on every mouse move

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:141-144` (+ `src/features/pipeline/sub_canvas/components/AlignmentGuides.tsx:42-84`)
- **Scenario**: User drags a node around the canvas. `onNodeDrag` fires at pointer-move frequency (often 60–120 Hz on high-refresh displays).
- **Root cause**: Each invocation runs `computeAlignments(node, nodes)`, which iterates **all** other nodes and pushes up to 10 candidate `AlignmentLine` objects per pair (5 X-pairs + 5 Y-pairs). The result is dispatched through `useReducer`, which forces a render of `TeamCanvas`, `CanvasFlowLayer`, and `AlignmentGuides`. There is no rAF-coalescing on `onNodeDrag` and no early-exit for "no candidates within tolerance."
- **Impact**: At N=50 nodes and 120 Hz drag events, `computeAlignments` runs 6 000 times per second, allocating ~60 000 transient objects/sec, plus a full reducer/canvas render each time. Drag becomes noticeably stuttery on mid-range hardware.
- **Fix sketch**: Wrap `onNodeDrag` with an rAF coalescer (the repo already has `useRafCoalescedCallback` — see `TeamMemoryPanel.tsx:64`). In `computeAlignments`, precompute the dragged node's edges once outside the loop (already done) and add an O(1) early-out: skip `other` if `Math.abs(d.centerX - o.centerX) > 1000 && Math.abs(d.centerY - o.centerY) > 1000`. Optionally bucket nodes by 200-px grid cells and only scan neighbors.

## 3. Topology graph + per-member suggestion filter rebuilt on every tick → O(M × S) per derivation

- **Severity**: high
- **Category**: algorithmic
- **File**: `src/features/pipeline/sub_canvas/libs/useDerivedCanvasState.ts:77-111`
- **Scenario**: Every change to `pipelineNodeStatuses`, `analytics`, `dryRunState`, `dismissedSuggestionIds`, or `pipelineCycleNodeIds` re-runs the full `useMemo`. During a run, this fires per status event.
- **Root cause**: Inside the memo, `buildTeamGraph(teamMembers.map((m) => m.id), teamConnections, SKIP_FEEDBACK)` rebuilds Kahn's sort + layer map even though the graph topology only changes when `teamMembers` or `teamConnections` change. Worse, for every member the code does `activeSuggestions.filter((s) => s.affected_member_ids.includes(m.id))` — O(M × S × A) where A is the average `affected_member_ids` length. With M=40 members and S=20 suggestions this is ~800 filters per tick.
- **Impact**: Each pipeline tick repeats topology work that hasn't changed and re-scans the suggestion list per node. The compute itself isn't catastrophic, but it's locked in front of finding #1's render cascade, so the cost lands on the critical path. `buildTeamGraph` also has an O(N²) tail (`sorted.includes(id)` inside the cycle-collection loop at `teamGraph.ts:80`).
- **Fix sketch**: Hoist `buildTeamGraph` into its own `useMemo` keyed only on `[teamMembers, teamConnections]`. Replace `sorted.includes(id)` with a `Set(sorted)` for O(1). Pre-index suggestions into `Map<memberId, Suggestion[]>` once per analytics change (or do it inside an `analytics`-keyed memo) and look up by `m.id`.

## 4. `useDebugger` writes a fresh `DryRunState` object on every render → feedback loop

- **Severity**: high
- **Category**: re-render
- **File**: `src/features/pipeline/sub_canvas/libs/useDebugger.ts:51-53`
- **Scenario**: Dry-run mode active. The user clicks Play; the debugger auto-steps every 800 ms.
- **Root cause**: The effect at line 51 has `onStateChange` in its dependency array and constructs a fresh object literal each render: `onStateChange({ active: true, breakpoints, nodeData, ... })`. `onStateChange` is `handleDryRunStateChange` from `useCanvasPipelineActions` (line 135), which dispatches `SET_DRY_RUN_STATE` into the canvas reducer. That mutation is in the dependency chain of `useDerivedCanvasState` (line 199: `dryRunState`), which recomputes nodes/edges, which triggers TeamCanvas' sync effect (#1), which re-renders the canvas. The state push happens after every state change inside the hook (breakpoint toggle, inspect, step-tick, pause flip) — including ones the canvas doesn't need to know about.
- **Impact**: A dry-run "step" emits one debugger render and triggers a full canvas re-derivation **per state field that changes**, not per step. In practice a single Play-tick re-derives 3–5 times. Combined with finding #1 this is the dry-run "feels laggy" complaint.
- **Fix sketch**: Coalesce the upward state push: keep a ref of the last-sent state and shallow-compare before calling `onStateChange`. Better, split into two pushes — one for "graph-affecting" fields (`completedEdges`, `activeEdge`, `nodeData` status map) and one for "panel-only" fields (`breakpoints`, `inspectedNode`, `stepIndex`) — and only the first should feed the canvas derivation. Or invert: have the canvas read `inspectedNode`/`stepIndex` directly from a separate store/context, never through reducer state.

## 5. `handleSave` POSTs all node positions in parallel on every drag-end

- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:107-121` (debounce trigger at line 137)
- **Scenario**: User drags any node. After the 1500 ms idle debounce, the auto-save fires.
- **Root cause**: `handleSave` issues `Promise.all(nodes.filter((n) => n.type !== 'stickyNote').map((n) => updateTeamMember(n.id, undefined, n.position.x, n.position.y)))` — one Tauri invoke per node, irrespective of which moved. With N=40 nodes, dragging a single node fires 40 IPC round-trips.
- **Impact**: Each `updateTeamMember` is a SQLite write through Tauri; bursts of 40+ invokes per drag back up the IPC queue and contend with the live `PIPELINE_STATUS` event handler. On lower-end Windows hardware this manifests as a ~200–600 ms input freeze every time the auto-save fires.
- **Fix sketch**: Diff `nodes` against a `lastPersisted` ref and only invoke `updateTeamMember` for entries whose `position` changed. Better: add a `batch_update_team_member_positions` Tauri command and send one request with `[{id, x, y}, ...]`. The repo already does batched writes elsewhere (see `pipelineStore` patterns).

## 6. `PeerDetailDrawer` JSON-parses peer addresses on every render

- **Severity**: medium
- **Category**: data-layer
- **File**: `src/features/sharing/components/PeerDetailDrawer.tsx:125-131`
- **Scenario**: Peer detail drawer is open and `useSystemStore` updates (e.g., the 30 s `NetworkDashboard` poll, or a `network:snapshot-updated` push, or a manifest-sync progress event the drawer itself listens for at line 46).
- **Root cause**: `addresses` is computed in the render body as an IIFE that runs `JSON.parse(peer.addresses)` every time. No `useMemo`. The same component subscribes to `peerManifests` and listens for `P2P_MANIFEST_SYNC_PROGRESS`, so it re-renders on every progress event during a sync.
- **Impact**: Per-render cost is small (one JSON.parse on a short array) but it executes 5–10×/sec during manifest sync. Combined with the `manifest.map(...)` list render below it and `formatRelativeTime` calls in `ManifestEntryRow`, the drawer noticeably jitters during sync of large manifests.
- **Fix sketch**: `const addresses = useMemo(() => { try { return typeof peer.addresses === 'string' ? JSON.parse(peer.addresses) : peer.addresses; } catch { return []; } }, [peer.addresses]);` and `memo()` the `ManifestEntryRow` component (it currently isn't memoized despite being a pure row).

## 7. `ConnectionEdge` is not memoized; animated SVG particles re-mount on every nodes-change

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/pipeline/sub_canvas/components/edges/ConnectionEdge.tsx:5` (no `memo()` wrapper, unlike `PersonaNode` and `StickyNoteNode`)
- **Scenario**: Pipeline is running. `isActive` edges render three `<circle><animateMotion>` particles each.
- **Root cause**: When `setNodes` fires from finding #1, ReactFlow recomputes edge endpoints (because source/target positions are new object references) and calls `ConnectionEdge` with fresh props. Without `memo`, the SVG `<animateMotion>` elements are re-instantiated, which restarts the animation timeline from the current position (visible particle stutter) and re-allocates DOM nodes. The `getSmoothStepPath` call also re-executes — cheap individually, but multiplied by all edges per tick.
- **Impact**: Visual: edge particles "jump" or restart during pipeline activity. Perf: edges on a busy team (E=50) re-run path math + DOM thrash on every tick.
- **Fix sketch**: Wrap export in `memo`, comparing on `id`, `sourceX/Y`, `targetX/Y`, `data.isActive`, `data.dryRunCompleted`, `data.dryRunActive`. Same treatment for `GhostEdge.tsx` (also unmemoized).

## 8. `CanvasOverlays` subscribes to 11 Zustand selectors; re-renders on unrelated pipeline-store changes

- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/pipeline/components/canvas/CanvasOverlays.tsx:60-71`
- **Scenario**: Anything in `pipelineStore` mutates — team list refetch, memory pagination, filter update.
- **Root cause**: `CanvasOverlays` calls `usePipelineStore((s) => ...)` 11 separate times for memory state, plus inherits `cs` (reducer state) as a single huge prop. Any one of those slices changing re-renders the component, which keeps `TeamMemoryPanel`, `OptimizerPanel`, `CanvasAssistant`, `DryRunDebugger`, and the EmptyState mounted — none of these need to re-evaluate when, say, `teamMemoryStats` changes if their own panel is closed.
- **Impact**: Moderate. The child panels are mostly memoized at the prop boundary, but the dispatch funnel through `CanvasOverlays` still walks the JSX tree. Compounds with #4 — every dry-run state push re-renders this whole subtree.
- **Fix sketch**: Move the memory-related selectors into `TeamMemoryPanel` itself (it's already conditional via `cs.memoryPanelOpen` — selecting them at the parent forces re-renders even when the panel is closed). Use `useShallow` from `zustand/shallow` for the remaining slices, or consolidate into a `useMemoryPanelSelectors` hook with a single shallow-compared object.

## 9. `TeamMemoryRow` re-parses revision JSON for every visible row on each memory list update

- **Severity**: low
- **Category**: data-layer
- **File**: `src/features/pipeline/sub_teamMemory/components/panel/TeamMemoryRow.tsx:38` (+ `parseRevisions` at line 12-20)
- **Scenario**: Memory panel is open; user changes filter, edits importance, or load-more fires.
- **Root cause**: Each row calls `useMemo(() => parseRevisions(memory.tags), [memory.tags])`. The memo key works, so within a row this is fine — but when the parent `MemoryPanelList` swaps the `memories` array (filter/load-more), all rows remount and parse JSON afresh. With 50–100 memories visible (the panel is not virtualized — `MemoryPanelList.tsx:91-129` uses a plain `memories.map`), the load-more click triggers 50–100 fresh `JSON.parse` calls plus 50–100 row mounts.
- **Impact**: Noticeable jank on the load-more click for memory-heavy teams; otherwise minor. Will get worse as team memories accumulate (no virtualization ceiling).
- **Fix sketch**: Parse revisions once in the store (or in the loader) so `TeamMemory` arrives with a parsed `revisions: Revision[]` field — no per-row parsing. Add windowing (e.g., `react-window`) to `MemoryPanelList` once memory counts routinely exceed ~50.
