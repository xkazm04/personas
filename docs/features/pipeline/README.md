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
