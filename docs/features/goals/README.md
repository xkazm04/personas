# Goals

Goals give **high-level direction** to both development and teams, and are the cross-cutting surface Athena tracks. A goal is a project-scoped objective with progress, status, an optional target date, a dependency graph, and a composed checklist; team and dev activity feed its progress, and Athena can read, propose updates to, and proactively flag goals.

> Design rationale + decisions: [`docs/concepts/goals-direction-hub.md`](../../concepts/goals-direction-hub.md).

## Where it lives

- **Top-level sidebar section** — `Goals` (between Overview and Agents), in addition to the legacy Dev Tools › Goals tab (a contextual shortcut). Both render the same surface (`src/features/plugins/dev-tools/sub_goals/`).
- **L2 sub-nav** — four surfaces: **Board · Map · Timeline · Portfolio**. Board / Map / Timeline are scoped to the active project (`LifecycleProjectPicker` in the header); **Portfolio** is cross-project (and now carries the per-project "needs you" drawer — the former standalone Attention tab was folded into it).
- **Persistence** — the active project is persisted (`systemStore` partialize), so goals re-fetch after a hard refresh.

## Canonical status model

All status handling funnels through `goalStatus.ts` — a `GoalStatus` type (`open | in-progress | blocked | done`), a tolerant `normalizeGoalStatus` (maps the hyphen/underscore/team-step/alias variants onto one set), predicates (`isComplete` / `isOngoing` / …), and `GOAL_STATUS_META` (icon + lane + chip + tint + map colours). `GoalStatusBadge` renders status everywhere from it. The Rust side mirrors this in `normalize_goal_status` so cross-project rollups bucket exactly like the UI. (v1 compared `in-progress` vs `in_progress` inconsistently and silently mis-laned in-progress goals — v2 makes that class of bug impossible.)

## Surfaces

### Board + Map (active project)
- **Board** — a `your turn → agent's turn → done` kanban; lane membership derives from `GOAL_STATUS_META.lane`. Each card surfaces its **checklist inline**: the first few to-dos render as checkboxes you toggle in place, and the rest fold into a "+N more" link to the detail drawer. **When a goal has to-dos, they drive its completeness** — `done / total` is written back to the goal's `progress` (so Map and Portfolio agree); a goal with no to-dos keeps the manual ± progress nudge. Items are fetched in one batch query per project (`dev_tools_list_goal_items_for_project`), not per card. Cards also carry an open-details affordance and a date that turns red when an ongoing goal is overdue.
- **Map** — a pan/zoom **React Flow canvas** (`GoalGraphMap` + `goalGraphLayout.ts`) over parent/child + dependency edges, built to read at 100+ nodes. Nodes are **freely draggable** and positions **persist per project** (localStorage); the force sim (`forceLayout.ts`) only seeds the initial layout. A **minimap + zoom controls** make large graphs navigable, and nodes are **level-of-detail**: zoomed out each goal collapses to a colour-coded progress dot (high-level overview), zoomed in it expands to a titled card with a progress bar. **"Now" / "Next" highlighting** orients the user — *Now* = in-progress goals (amber pulsing ring), *Next* = open goals whose every blocker (dependency source + parent) is done (blue ring). Edges are **type-distinct**: parent (violet, solid), `blocks`/depends-on (red, dashed, animated), `follows` (sky, dashed), with a matching legend. Authored from the detail drawer's Dependencies section. Each node also shows an **advancing-team badge** (▶ team name) when a `team_assignment` is working that goal — sourced from `dev_tools_goal_advancing_teams` (the canonical team↔goal link), so the graph shows *who owns each goal*.

### Timeline (active project)
`GoalsTimeline` — ongoing goals on a vertical target-date rail, bucketed **Overdue → This week → This month → Later → No date**, each row showing the relative due date, status, and progress. Opens the goal on click.

### Portfolio (cross-project)
`GoalsPortfolio` — mission control across every project. Grand-total tiles + a card per project with a canonical-status segmented bar, at-risk / overdue surfacing, and avg progress. Click a project to switch to it and jump to its Board. Backed by the one-pass `dev_tools_portfolio_summary` rollup (no N+1).

### Attention (per-project, inside Portfolio)
Folded into Portfolio: it fetches the cross-project `dev_tools_attention_queue` and groups items by project, so each project card shows a **"N need attention"** pill (covering awaiting-review / overdue / stalled / unstaffed). Clicking it opens `GoalAttentionDrawer` — a right-edge slide-over (`BaseModal placement="right-drawer"`) scoped to that project, with the same inline **skip / abort** (awaiting-review) + **open goal** actions; resolving refreshes the queue.

Clicking a goal in Board / Map / Timeline / the attention drawer opens the **detail drawer**.

### Authoring
`+ New goal` (header and empty state) opens `GoalEditorModal` — create/edit/delete with title, description, status, and target date. (Goals can also still be imported from GitHub issues.)

### Detail drawer
`GoalDetailDrawer` is the focused view for one goal:

- **Description** — rendered as **markdown** (`MarkdownRenderer`, GFM + code-span/heading/list/table support), so autonomously-generated goal descriptions (which carry code-span file paths, structure, and a backlog-provenance footer) read cleanly instead of as a flat blob. The Board card shows a markdown-stripped single-line preview (`goalPreview`) under its 2-line clamp.
- **Hybrid progress nudge** — `dev_tools_resolve_goal_progress` composes the goal's checklist items, sub-goals, and linked team-assignment steps into a *suggested* progress %. When it differs from the stored value, the drawer offers **Accept / edit** — progress is never written silently; a manual override always wins.
- **Composed checklist** — ad-hoc items (add / toggle / delete), sub-goals, and linked team-assignment steps in one list. A team step in `awaiting_review` gets inline **skip / abort** intervention (via the team-assignment review path). A step that produced an `outputSummary` is **expandable** (chevron) — its output renders as markdown inline (`StepRow`), so the actual work each role did is reviewable from the goal, not just the step title.
- **Linked teams** — the team assignments advancing this goal (title + status) with **unlink**.
- **Dependencies & follow-ups** — author cross-goal links: **Depends on** (a `blocks` edge — must finish first; backend cycle-checks) and **Follows** (a `follows` edge — sequence). Pick from the project's goals; add/remove via `add_goal_dependency` / `remove_goal_dependency`. These render on the Map.
- **Activity feed** — recent `dev_goal_signals`, including the `team_*` and `athena_update` signals described below.

## How progress flows in

- **Dev tasks** — a task linked to a goal (`dev_tasks.goal_id`) writes a `dev_goal_signal` on completion/failure (`task_executor`).
- **Teams** — an assignment linked to a goal (`team_assignments.goal_id`, set in the assignment composer's *Advance goal* picker) writes `team_step` / `team_done` / `team_failed` / `team_awaiting_review` signals as the orchestrator runs it. Step status also feeds the hybrid progress resolver.
- **Athena** — proposed updates write an `athena_update` signal.

Progress is **hybrid**: signals + step/checklist completion compute a suggestion; the user (or Athena, gated) accepts it.

## How goals reach team executions

Goals are not just a planning view — since 2026-05-29 they **steer runtime team behavior**. Every member of a team executes with a compact `## Team Alignment` block in its prompt (`engine/runner/team_context.rs`) that lists the team's **active goals** alongside the teammate roster, and instructs the persona to judge — from its own capabilities — whether and how its work advances them (align where it relates, don't force-fit). See [team-orchestration.md › Shared state](../pipeline/team-orchestration.md#shared-state-reaching-a-running-persona).

The block resolves a team's goals by walking **team → project → goals** via the canonical durable link **`dev_projects.team_id`** ("this team owns this project"; goals belong to the project). This makes `dev_projects.team_id` the team-mission link and `team_assignments.goal_id` the granular per-task "advancing" link — both pointing at the **same `dev_goals` spine**, so a goal authored anywhere (Goals UI, an assignment's *Advance goal* picker) flows into executions. Resolution order: the persona's pinned project (`design_context.dev_project_id`) → `dev_projects.team_id` → goals the team is directly advancing.

## Advancing a goal (teams work it)

Linking a goal to a team makes it *visible* to executions; **advancing** is the team actually working it. An advance turns a goal into a running, goal-linked `team_assignment`:

- **Initiator** — `engine/goal_advance.rs::advance_goal` (command `advance_team_goal`) builds an assignment **with `goal_id` set** and runs it on the orchestrator, behind a one-active-assignment-per-goal guard. **Hybrid step source**: if the goal has open to-dos (`dev_goal_items`), one step per to-do (title verbatim); otherwise the goal is LLM-decomposed.
- **Triggers** — the **Advance with team** button in the goal detail drawer (shown when the goal's project has an owning team and the goal isn't complete); Athena (team path); and the autonomous tick below.
- **Progress closes automatically — and moves live per step.** When a goal-linked *step* completes, the orchestrator immediately checks off its matching to-do (step title ↔ to-do title) and recomputes progress via `apply_resolved_goal_progress`; when the whole assignment reaches `done` the same close-loop finalizes it. A decomposed goal also gets its steps **mirrored into `dev_goal_items`** at advance time, so the Board card shows a live checklist that ticks as the team works (and a future re-advance takes the open-items path verbatim). `dev_goal_signals` are observational. Status flips `open → in-progress` the moment the first step runs and `→ done` at a composed 100%; progress never regresses a hand-set value, and a QA bounce (rework loop) keeps 100 unreachable until the clean pass.
- **Autonomous advancement** — `GoalAdvanceSubscription`, gated by the **default-OFF** `autonomous_goal_advancement` setting, ticks every 5 min and keeps each goal-linked team's active goal moving unattended. Guardrails: one active assignment per goal, a 30-min per-goal cooldown after any assignment (no failure-retry stampede), eligible-persona check, and a per-tick cap. Nothing spends tokens autonomously until you opt in.

## Athena integration

- **Reads** — active project goals (id, progress, status, latest signal) are injected into Athena's system prompt, so she's aware of project direction and can reference goals by id.
- **Proposes (gated)** — the `update_dev_goal` op lets Athena propose a status/progress change; it is **approval-gated** (never auto-approved) and writes an `athena_update` signal on approval.
- **Reacts (proactive)** — the `dev_goal_target` / `dev_goal_stalled` proactive triggers surface budget-gated nudges when a goal is target-approaching/overdue or has been stalled (in-progress/blocked, untouched ≥ 7 days). On engage, Athena reasons with the goal context and can propose the gated update.

## Data model (main DB)

| Table | Purpose |
|---|---|
| `dev_goals` | the goal: project-scoped, `parent_goal_id` hierarchy, `progress`, `status`, `target_date` |
| `dev_goal_dependencies` | cross-goal blocking edges (Map) |
| `dev_goal_items` | lightweight ad-hoc checklist items |
| `dev_goal_signals` | progress/activity log (dev, team, and athena signals) |
| `team_assignments.goal_id` | the soft link from a team assignment to the goal it advances (granular "advancing" signal) |
| `dev_projects.team_id` | the durable team↔project link — a team owns a project, so the project's goals are the team's mission (drives execution-time goal awareness) |

Key commands — per-goal/project: `dev_tools_{list,create,update,delete,reorder}_goal(s)`, `dev_tools_{list,create,update,delete,reorder}_goal_item(s)`, `dev_tools_list_child_goals`, `dev_tools_resolve_goal_progress`, `set_team_assignment_goal`, `list_team_assignments_for_goal`.

Cross-project (v2): `dev_tools_list_all_goals`, `dev_tools_list_goal_dependencies_for_project` (single-query Map edges), `dev_tools_list_goal_items_for_project` (single-query Board card to-dos), `dev_tools_portfolio_summary` (one-pass per-project rollup), `dev_tools_attention_queue` (awaiting-review / overdue / stalled / unstaffed). Aggregates use the stored `progress` column + canonical status buckets, never the per-goal resolver — so they stay flat at portfolio scale (10 projects / 100 goals).
