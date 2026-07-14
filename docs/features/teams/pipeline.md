# Pipeline (Teams Canvas)

Pipeline is the visual workflow canvas for composing multi-persona teams. It renders persona nodes on an `@xyflow/react`-driven graph, lets users wire connections between them, supports a dry-run debugger, and surfaces optimization suggestions. Team memory — long-running shared context across the personas in a team — is owned by `sub_teamMemory/`.

> **For the orchestration logic** — the two execution modes (event-chain vs goal-driven assignments), how shared state reaches a running persona, and the observability/analysis layer — see **[team-orchestration.md](./team-orchestration.md)**. This README maps the UI surfaces; that doc explains the model underneath.

## Page host

`src/features/teams/sub_teamWorkspace/TeamCanvas.tsx` is the host for the Teams workspace, lazy-mounted in `src/features/personas/PersonasPage.tsx` for `sidebarSection === 'teams'`. That section is split into four L2 tabs (the `teamsTab` state, set via `setTeamsTab`): **Workspace** (default), **Goals** (`GoalsPage`, see [goals.md](./goals.md)), **KPIs** (`KPIsPage`, see [kpis.md](./kpis.md)), and **Factory**. `TeamCanvas` owns the Workspace tab: with no team selected it renders the `TeamList` management table; with a team selected it renders the **Team Studio** (`teamStudio/TeamStudioSplitVariant.tsx`). The Teams sub-view is gated and currently surfaced through dev/team builds (sidebar entry depends on tier).

## Top-level surface (the Workspace tab)

`TeamCanvas.tsx` is the Workspace-tab router: no team selected → the `TeamList` management table; a team selected → the **Team Studio** (see below). It consumes `usePipelineStore`.

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Team list | The teams management table with create/edit. The create form (`CreateTeamForm.tsx`) checks the team name against existing teams inline as you type — a debounced spinner → emerald "Name available" → amber "Already in use, try X" via `useAsyncFieldValidation` + `FormField`'s `availability` prop — so collisions surface at type-time, not on save. The form also has a **Codebase repository** section (GitHub connector picker + repo selector + optional main branch); when a repo is set, submitting provisions a `Codebase — <team>` connector (`service_type: codebase`) carrying `team_id` + `github_url` (+ `main_branch`, `mode: 'team'`), giving the team a single source-control truth that Dev Tools' "Team" source mode consumes | `TeamList.tsx`, `CreateTeamForm.tsx` |
| Team Studio | The per-team **configuration** console (roster rail + mode panes) opened when a team is selected — member scope, team memory, settings. Watching/driving a team moved to the Monitor in 2026-07. | `teamStudio/TeamStudioSplitVariant.tsx` (see [Team Studio](#team-studio--configuration-only)) |
| Auto-team | LLM-assisted team composition | `AutoTeamModal.tsx`, `useAutoTeam.ts` |
| Preset team | "Preset Team" button (+ empty-state CTA) opens the in-app **`PresetStudio`** (full content area, routed by `pipelineStore.presetFlowOpen` in `TeamCanvas` — not a modal): a gallery of best-practice, pre-wired presets under `scripts/templates/_team_presets/` (e.g. the **Web Development Team**) → on pick, the **Blueprint** adoption process. Its connection graph (`PresetConnectionGraph`) is the hero and the include/exclude surface — tap a node to toggle a member; sequential vs feedback edges are distinguished, and edge event-labels reveal on hover. Adopts the selected subset in one pass. Shares the `usePresetAdoption` state machine with the Templates → Presets modal. See [templates/08-team-presets.md](../templates/08-team-presets.md) | `TeamList.tsx`, `TeamCanvas.tsx`, `presetStudio/` (`PresetStudio`, `PresetProcessHost`, `PresetProcessBlueprint`, `PresetConnectionGraph`, `PresetGalleryShowcase`), `sub_presets/usePresetAdoption.ts` |
| Blueprint preview | Read-only render of a team blueprint | `BlueprintPreview.tsx` |

> The earlier standalone, edge-wiring **xyflow canvas** (with `TeamConfigPanel` / `TeamDragPanel` / a pipeline-template gallery) is no longer the primary composition surface — teams are now assembled from presets / auto-team and operated from the **Team Studio**. The node/edge primitives in `sub_canvas/` survive as the graph mechanics behind the preset **blueprint** graph and the dry-run debugger.

## sub_canvas — graph mechanics

`src/features/teams/sub_canvas/` owns the graph primitives — nodes, edges, debugger, optimizer, and assistant — reused by the preset blueprint graph and dry-run debugger.

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

`src/features/teams/sub_teamMemory/` is the panel and timeline UI for memories that belong to a team rather than a single persona.

| Area | Files |
| --- | --- |
| Panel | `components/panel/TeamMemoryPanel.tsx`, `MemoryPanelHeader.tsx`, `MemoryPanelList.tsx`, `TeamMemoryRow.tsx`, `MemoryRowActions.tsx`, `MemoryRowDetail.tsx`, `AddTeamMemoryForm.tsx`, `TeamMemoryBadge.tsx` |
| Timeline | `components/timeline/MemoryTimeline.tsx`, `TimelineItem.tsx`, `TimelineControls.tsx` |
| Run diff | `components/diff/RunDiffView.tsx`, `DiffHeader.tsx`, `DiffContent.tsx` |

## Team Studio — configuration only

> **Changed 2026-07 (Monitor consolidation).** Teams used to be *both* where you
> composed a team and where you watched and drove it. It is now only the first.
> **Teams = who the team is and what it knows. Monitor = what's happening.**
> See [`docs/plans/monitor-consolidation.md`](../../plans/monitor-consolidation.md).

Selecting a team opens the **Team Studio** (`sub_teamWorkspace/teamStudio/TeamStudioSplitVariant.tsx`) — a split console with a **roster rail** on the left and a **mode pane** on the right (`RightMode`):

| Mode | What it is | Renders |
| --- | --- | --- |
| `member` | Adjust one member's capability scope (tier · trust · use-case toggles) | member detail in the studio |
| `memory` | Team memory — the **authoring** surface (create / edit / delete, importance, revision history) | `TeamMemoryPane.tsx` |
| `workspace` | Team settings + disband | `TeamWorkspacePane.tsx` |

Nothing in the Studio watches or drives a team. Where the retired modes went:

| Retired mode | Where it lives now |
| --- | --- |
| `orchestrate` (`OrchestrationConsole`) | **Monitor → Channels → Conversations → the composer.** Describe work and it decomposes into a **proposal card** — routed steps, suggested personas — that you Confirm. The console's only distinctive affordance was preview-before-commit, which *is* the proposal card. |
| `board` (`TeamAssignmentBoardFlightDeck`) | **Goals → Missions** (see [goals.md](./goals.md)). Project-scoped, and goal-less missions are first-class. |
| `collab` (`CollabPane` / `CollabLiveCorrespondence`) | **Monitor → Channels → Conversations.** A virtualized messenger with a sidebar of projects; assignments and deliberations render as bands in the conversation. |
| `redroom` (`RedRoomPane`) | **Monitor → Channels → Stream.** Its 8 event families, callsign lens and "Heard by" survive as lenses over the shared channel read-model. |
| `deliberations` (`DeliberationsPane`) | **Monitor → Channels → Conversations** — a band in the conversation; **Drive** opens its controls in the right rail. See [deliberations.md](../deliberations.md). |

Team memory is *read* in the Stream (as a lens, with the run-timeline and run-diff views) and *authored* here — the Stream is a read-only observatory by construction.

> `src/features/teams/sub_assignments/` is **listener-only** (`useAssignmentProgressListener.ts` / `useGlobalAssignmentProgressListener.ts` listen to `TEAM_ASSIGNMENT_PROGRESS`; `useAssignmentNotificationDispatcher.ts` fires bell-icon notifications on `awaiting_review`).

### Assigning work — the conversation composer

> Retired 2026-07: the Studio's **Orchestrate** mode (`OrchestrationConsole`). It was a
> second place to type a goal, for a thing the team's conversation was already about.

Assignment composition lives in **Monitor → Channels → Conversations**. Describe a piece
of work in the composer and, instead of posting a remark, it **decomposes** the goal
(`decomposeTeamAssignmentGoal` — one Sonnet call) and drops a **proposal card** into the
conversation: the routed steps, each with its suggested persona (or an amber *unrouted*).
**Run it** creates + starts the assignment; **Drop** discards it. The preview-before-commit
the old console offered *is* the proposal card, so nothing was lost by deleting the pane.

- **Matching strategy** is `llm_eval` (one Sonnet call per step, via the user's Anthropic
  subscription through the Claude provider, picks the best persona) and
  **`max_parallel_steps`** is `16` — both remain **hardcoded defaults**, not user-facing
  knobs. (The engine still supports `manual` and `embedding` strategies and a configurable
  cap; they are just not exposed in the UI.) The proposal's suggested persona is a routing
  *hint*: personas are re-resolved at run time.

Once running, the assignment speaks for itself in the conversation as a live **band** —
step-progress strip, persona stack, rework badges, expandable per-step output, pause/resume.

### Watching a running assignment — Goals ▸ Missions

> Retired 2026-07: the Studio's **Board** mode (`TeamAssignmentBoardFlightDeck`).

The mission-control view is now **Goals → Missions** (see [goals.md](./goals.md)), which is
project-scoped rather than team-scoped and shows goal-less missions as first-class rows.

- Each step renders a status (`pending → matching → running → done | failed | skipped | awaiting_review`), the matched persona, match confidence + rationale (auto modes), and the output snippet / error.
- On failure the assignment pauses (only that assignment — siblings continue) and the step exposes inline **Edit requirement / Reassign / Skip** actions. A title-bar notification (`team_assignment_failed` / `team_assignment_unmatched` process types) deep-links here.
- Cascade-skip: skipping a step auto-skips every step that depends on it.
- `AssignmentReplay.tsx` replays a finished assignment's step timeline.

### Templates (backend-only today)

The assignment slice (`src/stores/slices/pipeline/assignmentSlice.ts`) and backend retain save / list / instantiate template methods (templates store the full step list as JSON and stamp out a new `team_assignments` row on use), but the studio console does **not** currently expose a save-as-template affordance.

### Athena chat dispatch

Athena (the companion) can create assignments from chat: "have the X team handle Y" → she emits an `assign_team` op → an approval card → on approval, `companion_assign_team` decomposes + creates + starts the assignment with `source='athena'`, tied to a companion `OperativeMemory` operation. Progress shows as inline cards in the chat panel (`CompanionAssignmentCards`). See [companion/README.md](../companion/README.md).

## Retired: sub_redRoom + sub_collab (2026-07 Monitor consolidation)

Both folders are **deleted**. They were two of the five UIs that sat on one substrate —
`list_team_channel`, a server-side union read-model over `team_assignment_events` ∪
`persona_events` ∪ `team_memories` ∪ `team_channel_messages` — and the consolidation
collapsed them into two surfaces under **Monitor → Channels**:

| Was | Is now |
| --- | --- |
| `sub_redRoom/` — a read-only comm log, client-fused from four `list*` calls on a 10s timer pulling 500 unscoped `persona_events` | **Stream** (`fleet/monitor/channels/Stream.tsx`) — one virtualized log with composable lenses. Red Room's 8 event families, its callsign lens (personas ranked by traffic) and its "Heard by" chips all survive; "Heard by" is now a **server-side subscription join** (`consumers`) rather than an N-per-member client fan-out. |
| `sub_collab/CollabPane` + `CollabLiveCorrespondence` — the living chat, unvirtualized and paging upward forever | **Conversations** (`fleet/monitor/channels/ConversationBriefing.tsx`) — a virtualized messenger (`measureElement`) with a sidebar of projects-as-conversations, unread badges, and assignments/deliberations rendered as bands. |

What survives from `sub_collab/`: `useTeamChannel.ts` (now a thin selector over the shared
`channelSlice`), `collabRender.tsx`, `payloadView.ts`, and `ChannelDetailModal.tsx` (which
absorbed Red Room's richer detail — raw-payload inspector, "Heard by", memory importance).
The event vocabulary (`eventFamily` / `memberColor` / `parsePayload` / `toEpochUtc`) moved to
`src/lib/channel/eventModel.ts`.

The channel plumbing itself lives in `src/stores/slices/pipeline/channelSlice.ts`: a
refcounted **(team, kinds)** cache with one poll loop and one `TEAM_ASSIGNMENT_PROGRESS`
listener for the whole app (it was 3N of each), composite `(at, id)` keyset paging, and a
k-way **merge horizon** so a cross-team stream never rewrites history above your scroll
position. See [`docs/plans/monitor-consolidation.md`](../../plans/monitor-consolidation.md).

## sub_teamWorkspace — Settings (team workspace defaults + disband)

Studio workspace mode, reached from the left rail's **Settings** entry
(`TeamWorkspacePane.tsx`). A team *is* the workspace, so this pane edits the
shared facets that apply to every member: **shared instructions** (appended to
each member's prompt), a **default model**, **default budget (USD)**, and
**default max turns**. Saving sends only the workspace facet of
`UpdateTeamInput` (the other fields go as `null` = skip), so it never disturbs
name/description/canvas.

The pane also hosts the **Disband team** danger zone — a two-click confirm
(arms, then **Confirm disband**; auto-disarms after a few seconds) wired to the
store's `deleteTeam`. Disbanding deletes the `PersonaTeam` and cascades its
membership + connections but **keeps the member personas** — they survive
ungrouped. On success the store clears `selectedTeamId`, which returns the user
to the Teams table. This mirrors the per-row Disband action in `TeamList`; the
backend `delete_team` refuses while a pipeline is running or when the team is a
dev project's canonical team.

**Share with the community (UGC preset).** The workspace pane also carries a
**Publish to community** action (`PublishPresetButton` → `gallery_publish_preset`)
that serializes the team into a self-contained, sanitized blueprint — team meta +
each member's `.persona.json` bundle (no credentials) + the connection graph by
member index (`commands::core::gallery::build_team_blueprint`) — and POSTs it to
personas-web (`/api/presets/publish`, backed by the `shared_presets` table). This
is the UGC half of the preset flywheel: any user's good team becomes an adoptable
community preset. It records the `shared` activation milestone (growth F3).

## State and backend

- Frontend store: `src/stores/pipelineStore.ts` (teams, groups, recipes, assignments — see [recipes/README.md](../recipes/README.md) for the recipes side). The assignment slice is `src/stores/slices/pipeline/assignmentSlice.ts`.
- Frontend API: `src/api/pipeline/{teams.ts,groups.ts,scheduler.ts,teamMemories.ts,assignments.ts}`.
- Backend commands: `src-tauri/src/commands/teams/{mod.rs,teams.rs,assignments.rs}` plus team-memory IPC routed through pipeline-store wrappers.
- Backend repos: `src-tauri/src/db/repos/core/{teams.rs,groups.rs}` + `src-tauri/src/db/repos/orchestration/team_assignments.rs`.
- Orchestration engine: `src-tauri/src/engine/{team_assignment_orchestrator.rs,team_assignment_matching.rs}`. Tables: `team_assignments`, `team_assignment_steps`, `team_assignment_events`, `team_assignment_templates`.

Composing a team (presets / auto-team) does not directly invoke executions — it produces a stored team graph, and execution happens when the assigned trigger fires (see [events/README.md](../events/README.md)) or the user runs the team manually (see [execution/README.md](../execution/README.md)). Assignments are the third path: the orchestrator drives persona executions step-by-step against a goal (composed in the Conversations composer; watched in Goals → Missions).

## Known gaps

- The dry-run debugger uses `debuggerMocks.ts` for sample variable state; it does not yet step through a real cached execution.
- The Orchestrate console hardcodes the matching strategy (`llm_eval`) and `max_parallel_steps` (`16`), and exposes no save-as-template affordance, even though the engine + assignment slice support configurable strategies/caps and templates.
