# teams/canvas [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Impure nested state updaters in useDebugger.executeStep
- **Severity**: High
- **Lens**: code-refactor
- **Category**: impure-updater
- **File**: src/features/teams/sub_canvas/libs/useDebugger.ts:68-100
- **Scenario**: `setStepIndex((prev) => { ... })` performs side effects inside the updater: it calls `setNodeData`, and the `setNodeData` updater in turn calls `setCompletedEdges` and `setActiveEdge`; `setInspectedNode`/`setPaused` are also invoked from within the outer updater. React requires updaters to be pure — under React StrictMode (dev) updaters are double-invoked, so completed-edge sets and inspection state get applied twice per step, and any future React batching change can reorder these writes.
- **Root cause**: The step transition was written as one giant `setStepIndex` updater instead of computing the next step outside and issuing sibling setState calls (or using a reducer).
- **Impact**: Latent double-fire/ordering bugs on the dry-run hot path (runs every 800 ms during auto-step); also the edge-completion loop (lines 81-84) is duplicated nearly verbatim in `finalize` (lines 113-116), so a fix to one is easy to miss in the other.
- **Fix sketch**: Convert the debugger's step state (`stepIndex`, `nodeData`, `completedEdges`, `activeEdge`, `inspectedNode`) into a single `useReducer` with a pure `STEP` action, or compute `nextIdx` from a ref/current value and issue the setState calls at the top level of `executeStep` rather than inside updaters. Extract a shared `completeOutgoingEdges(nodeId)` helper used by both `executeStep` and `finalize`.

## 2. Node `data` objects recreated wholesale defeat memo() on every canvas state change
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_canvas/libs/useDerivedCanvasState.ts:86-132
- **Scenario**: The single-pass `useMemo` rebuilds a fresh `data` object for every node whenever ANY input changes — a pipeline-status poll tick, one suggestion dismissed, or each 800 ms dry-run step. Since `data` identity changes for all nodes, `memo(PersonaNodeComponent)` / `memo(StickyNoteNodeComponent)` never bail out and every node re-renders, including the untouched ones.
- **Root cause**: Enrichment fields (pipelineStatus, dryRunStatus, optimizer flags, cycle flag) are merged into one new object per node per recompute instead of preserving reference identity for nodes whose derived data did not actually change.
- **Impact**: O(all nodes) re-render on every dry-run step and every pipeline status update; with larger teams each PersonaNode render includes lucide icons, avatar, and handle wrappers. Bounded by team size today, but it makes the `memo()` wrappers on both node components dead weight.
- **Fix sketch**: Keep a `useRef<Map<string, data>>` cache keyed by member id; after computing the candidate data object, shallow-compare against the cached one and reuse the cached reference when equal (a ~10-line `stableData` helper). Alternatively split the memo so per-node volatile fields (status) are read by the node via a store selector instead of being baked into `data`.

## 3. Hand-rolled click-outside logic duplicates an existing shared hook
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_canvas/components/TeamToolbar.tsx:30-38
- **Scenario**: `TeamToolbar` (lines 30-38) and `EdgeDeleteTooltip.tsx:38-46` each register their own `document.addEventListener('mousedown', ...)` + `ref.contains` handler, while the repo already ships `useClickOutside` (src/hooks/utility/interaction/useClickOutside.ts, re-exported from src/hooks/index.ts) used by 10+ components. `NodeContextMenu.tsx:25` in the same folder repeats it a third time.
- **Root cause**: Canvas components were written before (or without awareness of) the shared interaction hook.
- **Impact**: Three copies of subtly divergent listener logic in one feature folder; the TeamToolbar copy also has a latent quirk (closes even when clicking the toggle button is intended to toggle) that a shared hook already handles consistently.
- **Fix sketch**: Replace the local `useEffect` blocks in TeamToolbar, EdgeDeleteTooltip, and NodeContextMenu with `useClickOutside(ref, onClose)` from `@/hooks`. Behavior-preserving, ~20 lines removed.

## 4. O(n²) membership check in buildTeamGraph cycle detection
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src/features/teams/sub_canvas/libs/teamGraph.ts:80
- **Scenario**: `if (!sorted.includes(id))` runs an O(n) array scan inside a loop over all node ids, making cycle detection O(n²). `buildTeamGraph` is invoked inside the `useDerivedCanvasState` memo, i.e. on every canvas re-derivation (each drag save, status tick, dry-run step).
- **Root cause**: `sorted` is an array; membership should be tested against a Set.
- **Impact**: Negligible at today's team sizes (tens of nodes) but it is a hot-path helper called from three consumers (layout, dry-run, derivation); trivially fixable.
- **Fix sketch**: Build `const sortedSet = new Set(sorted);` before the loop and test `!sortedSet.has(id)`. One-line change, same output.

## 5. Duplicated pipeline-status type and default role-color literal
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_canvas/components/PipelineControls.tsx:6-11
- **Scenario**: `PipelineControls` declares a private `NodeStatus` interface that mirrors `PipelineNodeStatus` exported from `useDerivedCanvasState.ts:9-16` (same fields, looser optionality). Similarly, the fallback role-color literal `{ bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/25' }` is duplicated in `PersonaNode.tsx:52` and `AssistantMessages.tsx:20`.
- **Root cause**: Local re-declaration instead of importing the shared type/constant.
- **Impact**: Field drift risk — the two status types already disagree on optionality of `persona_id`; the role fallback must be edited in two places to stay visually consistent.
- **Fix sketch**: Import `PipelineNodeStatus` in PipelineControls (or move the type next to `ROLE_COLORS` in teamConstants). Add a `DEFAULT_ROLE_COLOR` export beside `ROLE_COLORS` in `libs/teamConstants` and use it in both PersonaNode and AssistantMessages.
