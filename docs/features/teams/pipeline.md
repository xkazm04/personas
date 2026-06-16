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
| Team Studio | The per-team console (roster rail + mode panes) opened when a team is selected — orchestration, board, collab, red-room, memory, settings | `teamStudio/TeamStudioSplitVariant.tsx` (see [Team Studio](#team-studio--the-workspace-console-orchestration-lives-here)) |
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

## Team Studio — the workspace console (orchestration lives here)

Selecting a team opens the **Team Studio** (`sub_teamWorkspace/teamStudio/TeamStudioSplitVariant.tsx`) — a split console with a **roster rail** on the left and a **mode pane** on the right. The right pane is a discriminated union (`RightMode` in `TeamStudioSplitVariant.tsx`) with these modes:

| Mode | What it is | Renders |
| --- | --- | --- |
| `member` | Adjust one member's capability scope | member detail in the studio |
| **`orchestrate`** | **Give the team a goal → decompose → assign & run** | `OrchestrationConsole` (`teamStudio/teamStudioShared.tsx`) |
| `board` | Mission-control flight deck — live per-step checklist + relay | `TeamAssignmentBoard.tsx` → `TeamAssignmentBoardFlightDeck.tsx` |
| `redroom` | Read-only comm log (see sub_redRoom below) | `RedRoomPane.tsx` |
| `collab` | Living team chat + intervention (see sub_collab below) | `CollabPane.tsx` |
| `memory` | Team memory timeline (see sub_teamMemory below) | `TeamMemoryPane.tsx` |
| `workspace` | Team settings + disband (see sub_teamWorkspace below) | `TeamWorkspacePane.tsx` |

> The earlier model — a floating `AssignmentsPanel` badge on the xyflow canvas — has been retired. Assignment composition and the live checklist now live in the studio's **Orchestrate** and **Board** modes; `src/features/teams/sub_assignments/` is now **listener-only** (`useAssignmentProgressListener.ts` / `useGlobalAssignmentProgressListener.ts` listen to `TEAM_ASSIGNMENT_PROGRESS`; `useAssignmentNotificationDispatcher.ts` fires bell-icon notifications on `awaiting_review`).

### Orchestrate mode — goal-driven assignments

`OrchestrationConsole` (in `teamStudio/teamStudioShared.tsx`) is the assignment composer: the user gives the team a **goal**, the orchestrator decomposes it into a checklist of steps, matches each step to a persona, and runs them in a parallel DAG with human review on failure.

- **Goal** — a single textarea (`data-testid="team-goal-input"`).
- **Preview / decompose** (`data-testid="team-preview-button"`) — one Sonnet call (`decomposeTeamAssignmentGoal`) turns the goal into editable step proposals with suggested personas.
- **Assign & Run** (`data-testid="team-assign-button"`) — creates + starts the assignment, then a live checklist renders inline (`data-testid="team-live-checklist"`).
- **Matching strategy** is `llm_eval` (one Sonnet call per step, via the user's Anthropic subscription through the Claude provider, picks the best persona) and **`max_parallel_steps`** is `16` — both are **hardcoded defaults in the console today**, not user-facing knobs. (The engine still supports `manual` and `embedding` strategies and a configurable cap; they're just not exposed in this UI.)

### Board mode — flight deck (checklist + review)

`TeamAssignmentBoard` → `TeamAssignmentBoardFlightDeck` is the mission-control board for a running assignment:

- Each step renders a status (`pending → matching → running → done | failed | skipped | awaiting_review`), the matched persona, match confidence + rationale (auto modes), and the output snippet / error.
- On failure the assignment pauses (only that assignment — siblings continue) and the step exposes inline **Edit requirement / Reassign / Skip** actions. A title-bar notification (`team_assignment_failed` / `team_assignment_unmatched` process types) deep-links here.
- Cascade-skip: skipping a step auto-skips every step that depends on it.
- `AssignmentReplay.tsx` replays a finished assignment's step timeline.

### Templates (backend-only today)

The assignment slice (`src/stores/slices/pipeline/assignmentSlice.ts`) and backend retain save / list / instantiate template methods (templates store the full step list as JSON and stamp out a new `team_assignments` row on use), but the studio console does **not** currently expose a save-as-template affordance.

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
- **Directives & the channel table (C1)**: the composer posts via
  `post_team_directive` → a `team_channel_messages` row (`author_kind='user'`,
  `consumer='inject'`). This table is the authoritative multi-author store
  (author kinds user/athena/director/persona — see
  [`docs/architecture/team-channel-orchestration.md`](../../architecture/team-channel-orchestration.md)).
  Delivery is at STEP BOUNDARIES: the orchestrator injects recent channel
  messages addressed to the persona or whole team
  (`team_channel::list_injectable_for_persona`, `consumer='inject'`) into every
  step's input (`user_directives`) and prompt (TEAM CHANNEL block in
  `team_context`), then writes a read-receipt into the message's `deliveries`
  column (`[{step_id,persona_id,at}]`) — rendered as ✓✓ "seen by" chips.
  Legacy `team_memories` directive rows are still read for display
  (back-compat) but no longer written or injected.
- **Persona posts (C1)**: gated roles (Implementer / QA / Architect) may
  broadcast ONE short message per step by emitting a `CHANNEL_POST: <text>`
  line — taught via the TEAM CHANNEL capability block in `team_context`,
  parsed in the orchestrator's completed-step arm, role-gated + length-capped.
  Posts land `author_kind='persona'`, `consumer='display'` (visible in Collab,
  NOT injected into other personas' steps — no persona→persona prompt loop).
- **Director bridge (C3)**: when the Director evaluates a persona that's on a
  team, its coaching verdicts are ALSO posted into that team's channel
  (`engine/director.rs::bridge_verdicts_to_channel`) — `author_kind='director'`,
  `addressed_to=[persona]`, `consumer='inject'` — so the guidance reaches the
  coached persona's next step (with a receipt) instead of dead-ending in the
  Overview UI. Severity-ranked, capped at 3/run (the §5 rate guardrail). The
  Director's evaluation payload also gains a recent-channel digest
  (`render_persona_channel_digest`) so it can coach on cooperation, not only
  solo output. **Storm trigger**: an opt-in autonomous loop
  (`DirectorStormSubscription`, setting `autonomous_director_storm`, default
  OFF) runs a focused Director evaluation on a persona whose recent team work
  shows a burst (≥2 step failures / QA change-requests in 2h), rate-limited to
  once per persona per 6h via the Director's own channel posts — complementing
  the command-driven batch runs.
- **Athena posts (C2)**: `companion_post_team_message` posts as
  `author_kind='athena'`, `consumer='inject'` (whole-team or `addressed_to`).
  Interactive use posts directly; autonomous use routes through the approval
  executor's `post_team_message` op, which is on the `AUTOAPPROVE_ALLOWLIST` —
  free under autonomous mode, gated otherwise (the §8 decision). `@athena` in
  the Collab composer also summons her: the directive still posts to the
  channel, and Athena opens with the message as context (`setPendingPrompt`).
  (The LLM post-run reconciliation — Athena narrating finished assignments into
  the channel — is a C2 follow-up; it needs a real async Athena turn rather
  than a templated post under her name.)
- **Multi-author UI**: `CollabLive` renders each author kind distinctly
  (user directive / persona / Athena / Director). **Red Room** reads the same
  channel-native rows via `listTeamChannel`, so both surfaces show identical
  channel traffic (kept separate for now per the C-on-B plan).
- **Soft-pause (C4)**: `pause_team_assignment` flips a running/queued
  assignment to the `paused` status; the orchestrator tick loop sees it next
  tick and exits, so **no new steps launch while in-flight steps finish on
  their own** (detached tasks). `resume_team_assignment` re-spawns the tick
  loop from the current step states. Surfaced as a Pause/Resume control + a
  `paused` phase on the Flight Deck board — the C-mock's "pause at checkpoint",
  made real. Honest interrupt semantics: there is no mid-step interrupt (a
  running CLI turn can't take input); pause acts at step boundaries.
- **Flagship channel (C5, `CollabLiveCorrespondence`)**: the demo-grade Collab
  surface — a bordered card with a header BAND (crest · live presence with
  status dots · a data glance), a uniform **two-row message** shape (Source +
  Event on row 1, the Message in an accent-tinted container on row 2), inline
  review/failure intervention, a designed empty state, and **reply threading**:
  `list_team_channel` carries `replyTo` (the channel table's column), the
  composer's per-message Reply affordance posts a directive with
  `post_team_directive(reply_to)`, and replies render indented under a quoted
  reference to their parent. The composer is a multiline autosizing textarea
  (Enter sends, Shift+Enter breaks) with per-team draft persistence and an
  @-mention autocomplete covering Athena and every roster member. A filter bar
  (clicking a presence avatar in the header band also inserts the mention and
  focuses the composer). A filter bar
  (text search · Conversation/Activity kind toggle · author select) narrows
  the feed; the kind + author filters persist per team across sessions (the
  text query is deliberately ephemeral). Any conversational row (hover pin)
  or system event (Pin action in the detail modal) can be **pinned as a team
  memory** via `create_team_memory` — the channel read-model unions memories
  back in, so the pin reappears as a memory row in the conversation. Messages
  from different days are divided by Today/Yesterday/date separators, the
  header crest wears the team's own icon and color, and teams holding an
  unsent composer draft show a pen hint on the Teams table.
- **Workspace settings guard**: the Team Studio's workspace pane (identity +
  shared instructions + defaults) reports unsaved edits up to the studio
  shell; switching modes, clicking a roster member, or navigating back while
  dirty raises a Discard-changes/Keep-editing confirm instead of silently
  dropping the edits. The studio header also wears the team's identity — the
  icon and color editable in Workspace settings render in the header chip —
  and the roster shows live presence: members mid-step get a pulsing
  "Working…" dot, members at a review gate a "Waiting for review" one, from
  the same step-layer derivation the channel header uses (`useTeamPresence`).

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

Composing a team (presets / auto-team) does not directly invoke executions — it produces a stored team graph, and execution happens when the assigned trigger fires (see [events/README.md](../events/README.md)) or the user runs the team manually (see [execution/README.md](../execution/README.md)). Assignments are the third path: the orchestrator drives persona executions step-by-step against a goal (the Studio's Orchestrate mode).

## Known gaps

- The dry-run debugger uses `debuggerMocks.ts` for sample variable state; it does not yet step through a real cached execution.
- The Orchestrate console hardcodes the matching strategy (`llm_eval`) and `max_parallel_steps` (`16`), and exposes no save-as-template affordance, even though the engine + assignment slice support configurable strategies/caps and templates.
