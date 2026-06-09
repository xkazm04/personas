# UI Perfectionist — composition-workflows-pipeline
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

> Scope note: The documented `pipeline/components/TeamCanvas` path is empty, and the live `sub_teamWorkspace/TeamCanvas.tsx` has REPLACED the React Flow DAG with a "Split Studio" (see its header comment, lines 6–18). The entire `src/features/teams/sub_canvas/` tree (PersonaNode, edges, PipelineControls, TeamToolbar, OptimizerPanel, DryRunDebugger, etc.) is no longer mounted by any host: the only live import is `CanvasDragProvider` in `PersonasPage.tsx:14`; no file renders `<ReactFlow>` with these nodes/edges/controls. Findings below audit this canvas code as written (it is well-built and may be revived), but #6 records the orphaned-state reality so the team does not invest polish into dead UI by mistake. No `<MiniMap>`, `<Controls>`, or `<Background>` exist anywhere in `sub_canvas`, which is why the canvas-controls discoverability focus is folded into #4 rather than reported against a host that does not exist.

## 1. No accessibility affordances anywhere on the node canvas
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/teams/sub_canvas/components/nodes/PersonaNode.tsx:59 (and PipelineControls.tsx, TeamToolbar.tsx, edges/*, StickyNoteNode.tsx)
- **Scenario**: A keyboard or screen-reader user lands on the team/pipeline canvas. Nodes are plain `<div>`s with no role, label, focus ring, or tab stop; status (running/failed/completed) is conveyed only by border color + a tiny corner icon with no text alternative. The execute/dry-run/save icon-buttons have no `aria-label`. Nothing in the entire `sub_canvas` tree contains a single `aria-*`, `role`, `tabIndex`, or `sr-only` token (verified by grep — zero matches).
- **Root cause**: Node and toolbar markup was built visually-first; React Flow nodes are non-interactive divs and the surrounding chrome relies entirely on color/iconography for meaning.
- **Impact**: inaccessible — canvas is unusable without a mouse and invisible to assistive tech; pipeline status is fully color-coded with no programmatic equivalent (WCAG 1.4.1 / 4.1.2 failures).
- **Fix sketch**: Give the node root `role="group"` + `aria-label={`${name}, role ${role}, status ${effectiveStatus ?? 'idle'}`}` and a visible `focus-visible:ring-2 focus-visible:ring-indigo-400` style. Add `aria-label` to every icon-only `<button>` in `TeamToolbar` (back/add/layout/save), `PipelineControls` (execute/dry-run), and `StickyNoteNode` (delete). Add `<span className="sr-only">{status}</span>` next to each corner status badge so non-color status is announced.

## 2. "running" status uses two different colors (cyan on node, blue everywhere else)
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/teams/sub_canvas/components/nodes/PersonaNode.tsx:24 vs components/PipelineControls.tsx:27
- **Scenario**: While a pipeline runs, the active node glows cyan (`border-cyan-500`, `shadow rgba(6,182,212,...)`, and the spin-ring is `border-t-blue-400`), but the status dot for that same agent in the bottom `PipelineControls` bar is `bg-blue-500`, the tooltip status text is `text-blue-400`, and even within the node the ring is blue while the border is cyan. The user sees three different "running" colors for one state.
- **Root cause**: Status→color is defined independently in three places (`getPipelineStyles`, the local `STATUS_COLORS` map in PipelineControls, and the inline tooltip ternary) with no shared token. There is already a canonical status palette intent — it just was not centralized.
- **Impact**: inconsistency — weakens the status-color language the whole canvas depends on; cyan-vs-blue is exactly the kind of near-miss that reads as a bug.
- **Fix sketch**: Add a single `PIPELINE_STATUS_COLORS` map (border / glow / dot / text per status) to `libs/teamConstants.tsx` and consume it in `PersonaNode`, `PipelineControls` dots, and the tooltip. Pick one running hue (the cyan node and blue ring should match) and reuse it for the dot.

## 3. Node status badges are duplicated inline; one shared StatusBadge would remove ~40 lines and guarantee consistency
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/teams/sub_canvas/components/nodes/PersonaNode.tsx:75-118
- **Scenario**: Five near-identical corner badges (completed check, failed warning, cancelled/skipped ban, breakpoint, optimizer, cycle) each repeat the same `absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full ... flex items-center justify-center z-10` wrapper with only the color and icon swapped. The cancelled and skipped icons are identical, and the optimizer/breakpoint badges fight for the same `-left-1.5` corner with no precedence rule, so a node that is both breakpointed and suggestion-flagged renders one badge on top of the other.
- **Root cause**: Each indicator was added incrementally as inline JSX rather than via a reusable `<CornerBadge corner color icon title />`.
- **Impact**: unpolished / inconsistency — overlapping badges, copy-paste drift risk, and harder to keep sizing/animation in sync.
- **Fix sketch**: Extract a `CornerBadge` component taking `corner: 'tl'|'tr'|'bl'|'br'`, `color`, `icon`, and `title`. Render badges from a small config array so collisions are resolved by assigning distinct corners (e.g. status→TR, breakpoint→TL, optimizer→BL, cycle→BR) and every badge gets a `title`/`aria-label` for free.

## 4. No empty / loading state when a team has zero members (or while members load)
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/teams/sub_canvas/libs/useDerivedCanvasState.ts:57 and components/PipelineControls.tsx:33
- **Scenario**: A brand-new team with no members yields `nodes: []` — the canvas would render as a blank void with no "Add your first agent" prompt, no illustration, and no pointer to the toolbar's Add Agent button. `PipelineControls` only degrades to the bare string `'No agents in pipeline'` (line 33) with the Execute button still fully enabled and styled active. There is also no loading skeleton while members/connections fetch (the derivation just returns empty during load, indistinguishable from a truly empty team).
- **Root cause**: The derivation returns `[]` for both "loading" and "genuinely empty" and no host renders an empty-state overlay; the canvas was designed assuming members already exist.
- **Impact**: confusion — a real empty/first-run team looks broken, and Execute on an empty pipeline looks clickable.
- **Fix sketch**: When `nodes.length === 0`, render a centered empty-state (icon + "No agents yet" + a button that opens the toolbar Add-Agent dropdown). Disable/dim Execute and Dry Run in `PipelineControls` when `nodeStatuses.length === 0`. Distinguish loading by passing an `isLoading` flag and showing a skeleton/spinner instead of the empty prompt.

## 5. Failed-node error is hidden behind hover and absent on the node itself
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/teams/sub_canvas/components/PipelineControls.tsx:127-135 and nodes/PersonaNode.tsx:83-87
- **Scenario**: When a step fails, the node shows only a red dashed border + a warning triangle with no message; the actual `error` text exists but is reachable only by hovering the matching status dot in the bottom bar (and the dot row has no obvious affordance that it is hoverable). On a desktop touchpad/keyboard there is no way to read why a node failed without precise mouse hovering, and the failed node gives zero textual signal.
- **Root cause**: Error surfacing was attached to the controls-bar hover tooltip rather than to the failed node, and the dot tooltip is hover-only (no focus, no persistent state).
- **Impact**: error-blind — the most important diagnostic (why did it fail) is the hardest thing to reach.
- **Fix sketch**: On a failed node, show a small inline error chip (truncated, with `title`/full text on a click-popover) below the role badge. Make the controls-bar dots focusable (`tabIndex={0}`) so the tooltip also appears on keyboard focus, and add `role="status"` so failures are announced.

## 6. Orphaned canvas: visual polish layered onto UI that is never mounted
- **Severity**: low
- **Category**: polish
- **File**: src/features/teams/sub_teamWorkspace/TeamCanvas.tsx:6-18 (orphan declaration) and src/features/teams/sub_canvas/index.ts:1-36
- **Scenario**: The whole `sub_canvas` surface — animated edges, ghost-edge suggestions, dry-run debugger, optimizer panel, connection legend — is richly styled but, per `TeamCanvas.tsx`'s own comment, "no longer rendered; those files are now orphaned and slated for removal." Only `CanvasDragProvider` is still imported live (`PersonasPage.tsx:14`). A reader/auditor cannot tell which canvas is real, and any UI fix risks being applied to dead code.
- **Root cause**: The 2026-05-23 migration to the Split Studio left the React Flow canvas in place without a deprecation marker on the components themselves or a tracked removal.
- **Impact**: unpolished — wasted maintenance surface and ambiguous source of truth for "the canvas."
- **Fix sketch**: Either (a) delete the unused `sub_canvas` node/edge/control components and keep only the live `CanvasDragProvider`, or (b) if revival is planned, add a top-of-file `@deprecated — not mounted; see TeamStudioSplitVariant` banner to each orphaned component and an `index.ts` note, so future polish work targets the live Studio rather than this tree.
