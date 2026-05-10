# Pipeline (Teams Canvas)

Pipeline is the visual workflow canvas for composing multi-persona teams. It renders persona nodes on an `@xyflow/react`-driven graph, lets users wire connections between them, supports a dry-run debugger, and surfaces optimization suggestions. Team memory — long-running shared context across the personas in a team — is owned by `sub_teamMemory/`.

## Page host

`src/features/pipeline/components/TeamCanvas.tsx` is the page host, lazy-mounted in `src/features/personas/PersonasPage.tsx` for `sidebarSection === 'teams'`. The Teams sub-view is gated and currently surfaced through dev/team builds (sidebar entry depends on tier).

## Top-level surface

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Team list | Sidebar list of existing teams with create/edit | `TeamList.tsx`, `TeamCard.tsx` |
| Canvas | xyflow graph of persona nodes + connection edges | `TeamCanvas.tsx`, `canvas/CanvasFlowLayer.tsx`, `canvas/CanvasOverlays.tsx` |
| Team config | Per-team settings panel | `TeamConfigPanel.tsx` |
| Drag panel | Drag-source for adding personas to the canvas | `TeamDragPanel.tsx`, `canvas/useCanvasDragDrop.ts` |
| Auto-team | LLM-assisted team composition | `AutoTeamModal.tsx`, `useAutoTeam.ts` |
| Pipeline templates | Curated multi-persona starters | `templates/PipelineTemplateGallery.tsx`, `templates/MiniCanvas.tsx`, `templates/pipelineTemplateData.ts` |
| Blueprint preview | Read-only render of a team blueprint | `BlueprintPreview.tsx` |

`TeamCanvas` consumes `usePipelineStore` and `useAgentStore`; `useDerivedCanvasState` and `useCanvasReducer` (in `sub_canvas/libs/`) keep canvas state separate from store state.

## sub_canvas — graph mechanics

`src/features/pipeline/sub_canvas/` owns the inside of the canvas: nodes, edges, debugger, optimizer, and assistant.

| Area | Files |
| --- | --- |
| Nodes | `components/nodes/PersonaNode.tsx`, `StickyNoteNode.tsx`, `NodeContextMenu.tsx` |
| Edges | `components/edges/ConnectionEdge.tsx`, `GhostEdge.tsx`, `EdgeDeleteTooltip.tsx`, `ConnectionLegend.tsx` |
| Debugger | `components/debugger/DryRunDebugger.tsx`, `DebuggerControls.tsx`, `DebuggerStepView.tsx`, `DebuggerVariables.tsx` (driven by `libs/useDebugger.ts`, `libs/debuggerMocks.ts`, `libs/debuggerTypes.ts`) |
| Optimizer | `components/OptimizerPanel.tsx`, `OptimizerResults.tsx` |
| Assistant | `components/assistant/CanvasAssistant.tsx`, `AssistantInput.tsx`, `AssistantMessages.tsx` |
| Toolbar / overlays | `components/PipelineControls.tsx`, `TeamToolbar.tsx`, `AlignmentGuides.tsx` |
| Reducers / state | `libs/useCanvasReducer.ts`, `libs/useDerivedCanvasState.ts`, `libs/canvasActions.ts`, `libs/teamGraph.ts`, `libs/teamConstants.tsx`, `libs/CanvasDragContext.tsx` |

The barrel `sub_canvas/index.ts` exports `CanvasDragProvider`, the toolbar, and the reducer hooks.

## sub_teamMemory — shared memory across a team

`src/features/pipeline/sub_teamMemory/` is the panel and timeline UI for memories that belong to a team rather than a single persona.

| Area | Files |
| --- | --- |
| Panel | `components/panel/TeamMemoryPanel.tsx`, `MemoryPanelHeader.tsx`, `MemoryPanelList.tsx`, `TeamMemoryRow.tsx`, `MemoryRowActions.tsx`, `MemoryRowDetail.tsx`, `AddTeamMemoryForm.tsx`, `TeamMemoryBadge.tsx` |
| Timeline | `components/timeline/MemoryTimeline.tsx`, `TimelineItem.tsx`, `TimelineControls.tsx` |
| Run diff | `components/diff/RunDiffView.tsx`, `DiffHeader.tsx`, `DiffContent.tsx` |

## State and backend

- Frontend store: `src/stores/pipelineStore.ts` (teams, groups, recipes — see [recipes/README.md](../recipes/README.md) for the recipes side).
- Frontend API: `src/api/pipeline/{teams.ts,groups.ts,scheduler.ts,teamMemories.ts}`.
- Backend commands: `src-tauri/src/commands/teams/mod.rs` plus team-memory IPC routed through pipeline-store wrappers.
- Backend repos: `src-tauri/src/db/repos/core/{teams.rs,groups.rs}`.

The composition canvas itself does not directly invoke executions — wiring nodes produces a stored team graph, and execution happens when the assigned trigger fires (see [events/README.md](../events/README.md)) or the user runs the team manually (see [execution/README.md](../execution/README.md)).

## Known gaps

- The dry-run debugger uses `debuggerMocks.ts` for sample variable state; it does not yet step through a real cached execution.
- Pipeline templates (`templates/`) are checked-in static data, not catalog-loaded — adding one requires editing `pipelineTemplateData.ts`.
