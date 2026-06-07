# Pipeline (Teams Canvas)

Pipeline is the visual workflow canvas for composing multi-persona teams. It renders persona nodes on an `@xyflow/react`-driven graph, lets users wire connections between them, supports a dry-run debugger, and surfaces optimization suggestions. Team memory — long-running shared context across the personas in a team — is owned by `sub_teamMemory/`.

> **For the orchestration logic** — the two execution modes (event-chain vs goal-driven assignments), how shared state reaches a running persona, and the observability/analysis layer — see **[team-orchestration.md](./team-orchestration.md)**. This README maps the UI surfaces; that doc explains the model underneath.

## Page host

`src/features/pipeline/components/TeamCanvas.tsx` is the page host, lazy-mounted in `src/features/personas/PersonasPage.tsx` for `sidebarSection === 'teams'`. The Teams sub-view is gated and currently surfaced through dev/team builds (sidebar entry depends on tier).

## Top-level surface

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Team list | Sidebar list of existing teams with create/edit. The create form (`CreateTeamForm.tsx`) checks the team name against existing teams inline as you type — a debounced spinner → emerald "Name available" → amber "Already in use, try X" via `useAsyncFieldValidation` + `FormField`'s `availability` prop — so collisions surface at type-time, not on save. The form also has a **Codebase repository** section (GitHub connector picker + repo selector + optional main branch); when a repo is set, submitting provisions a `Codebase — <team>` connector (`service_type: codebase`) carrying `team_id` + `github_url` (+ `main_branch`, `mode: 'team'`), giving the team a single source-control truth that Dev Tools' "Team" source mode consumes | `TeamList.tsx`, `CreateTeamForm.tsx`, `TeamCard.tsx` |
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

## sub_assignments — goal-driven team assignments

`src/features/pipeline/sub_assignments/` is the assignment system layered on top of a team: instead of pre-wiring every node, the user gives the team a **goal**, the orchestrator decomposes it into a checklist of steps, matches each step to a persona, and runs them in a parallel DAG with human review on failure.

The surface is a floating panel on the canvas (the orange `ListChecks` badge at bottom-left, next to the team-memory brain badge). It is **not** a separate sidebar route — assignments are scoped to the team whose canvas you're viewing.

| Area | Files |
| --- | --- |
| Badge + panel | `AssignmentsButton.tsx`, `AssignmentsPanel.tsx` (mounted in `canvas/CanvasOverlays.tsx`) |
| Live updates | `useAssignmentProgressListener.ts` (listens to `TEAM_ASSIGNMENT_PROGRESS`), `useAssignmentNotificationDispatcher.ts` (global, fires bell-icon notifications on `awaiting_review`) |

### Composer

- **Goal** + per-step rows (title, optional description, persona picker, use-case picker). The use-case dropdown is sourced from the persona's `design_context.use_cases` array.
- **Matching strategy** dropdown:
  - `manual` — the user pins a persona per step at creation time.
  - `embedding` — local fastembed cosine match between the step text and each eligible candidate's capability summary (requires the `ml` build; auto-falls back to `llm_eval` below 0.45 confidence).
  - `llm_eval` — one Sonnet call per step (via the user's Anthropic subscription through the Claude provider) picks the best persona.
- **Auto-decompose** (violet Sparkles button) — one Sonnet call turns the goal into 2–6 editable step proposals with suggested personas.
- **`max_parallel_steps`** slider (1–8) caps concurrent step executions.
- **Save as template** — persists the current title/goal/strategy/steps as a reusable template for this team.

### Checklist + review

- Each step renders a status dot (`pending → matching → running → done | failed | skipped | awaiting_review`), the matched persona, match confidence + rationale (auto modes), and the output snippet / error.
- On failure the assignment pauses (only that assignment — siblings continue) and the step row exposes inline **Edit requirement / Reassign / Skip** actions. A title-bar notification (`team_assignment_failed` / `team_assignment_unmatched` process types) deep-links here.
- Cascade-skip: skipping a step auto-skips every step that depends on it.

### Templates

Saved templates appear as violet chips above the assignment list. Click a chip to instantiate (clones into a fresh assignment + auto-expands); hover-X deletes. Templates store the full step list as JSON and stamp out a new `team_assignments` row on use.

### Athena chat dispatch

Athena (the companion) can create assignments from chat: "have the X team handle Y" → she emits an `assign_team` op → an approval card → on approval, `companion_assign_team` decomposes + creates + starts the assignment with `source='athena'`, tied to a companion `OperativeMemory` operation. Progress shows as inline cards in the chat panel (`CompanionAssignmentCards`). See [companion/README.md](../companion/README.md).

## sub_redRoom — the team's communication log (Red room)

Studio workspace mode. A read-only comm log composed from existing data: the
persona-event bus (what members emitted), event subscriptions (who listens =
addressed-to), and team memories (pinned knowledge). Two views: **Transcript**
(mission radio log — monospace rows, universal member colours, family + member
filters, 20-item infinite batches, click → full-transmission modal with raw
payload) and **Relay** (handoff edges emitter → event → consumers + a
shared-memory rail). Feed: `useRedRoomFeed` (unscoped recent events filtered
to member-or-project, 10s poll).

## sub_collab — Collab, the living chat (Design B)

Studio workspace mode; the production "watch the team cooperate + intervene"
surface chosen from a three-way design comparison (A wire-only / B read-model
/ C dialogue-native — C's mock is kept as a tab for the future
Director/Athena orchestration discussion).

- **Read-model**: `list_team_channel` (commands/teams/team_channel.rs) unions
  the authoritative step layer (`team_assignment_events`, noisy kinds
  filtered), member bus traffic (`persona_events`, telemetry excluded) and
  `team_memories` server-side, timestamps normalized to RFC3339, keyset-paged
  (`before` cursor). Frontend: `useTeamChannel` — head refresh on
  TEAM_ASSIGNMENT_PROGRESS push + 15s poll fallback, infinite history at the
  top sentinel, presence derived from running steps.
- **Directives**: the composer posts via `post_team_directive` → a
  `team_memories` row (category `directive`, importance 10, persona_id NULL =
  the user). Delivery is at STEP BOUNDARIES: the orchestrator injects the
  team's recent directives into every step's input (`user_directives`) and
  prompt (USER DIRECTIVES block in `team_context`), then writes a read-receipt
  into the directive's `tags` (`{"deliveries":[{step_id,persona_id,at}]}`) —
  rendered as ✓✓ "seen by" chips under the message.

## State and backend

- Frontend store: `src/stores/pipelineStore.ts` (teams, groups, recipes, assignments — see [recipes/README.md](../recipes/README.md) for the recipes side). The assignment slice is `src/stores/slices/pipeline/assignmentSlice.ts`.
- Frontend API: `src/api/pipeline/{teams.ts,groups.ts,scheduler.ts,teamMemories.ts,assignments.ts}`.
- Backend commands: `src-tauri/src/commands/teams/{mod.rs,teams.rs,assignments.rs}` plus team-memory IPC routed through pipeline-store wrappers.
- Backend repos: `src-tauri/src/db/repos/core/{teams.rs,groups.rs}` + `src-tauri/src/db/repos/orchestration/team_assignments.rs`.
- Orchestration engine: `src-tauri/src/engine/{team_assignment_orchestrator.rs,team_assignment_matching.rs}`. Tables: `team_assignments`, `team_assignment_steps`, `team_assignment_events`, `team_assignment_templates`.

The composition canvas itself does not directly invoke executions — wiring nodes produces a stored team graph, and execution happens when the assigned trigger fires (see [events/README.md](../events/README.md)) or the user runs the team manually (see [execution/README.md](../execution/README.md)). Assignments are the third path: the orchestrator drives persona executions step-by-step against a goal.

## Known gaps

- The dry-run debugger uses `debuggerMocks.ts` for sample variable state; it does not yet step through a real cached execution.
- Pipeline templates (`templates/`) are checked-in static data, not catalog-loaded — adding one requires editing `pipelineTemplateData.ts`.
