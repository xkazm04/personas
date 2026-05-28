# Goals

Goals give **high-level direction** to both development and teams, and are the cross-cutting surface Athena tracks. A goal is a project-scoped objective with progress, status, an optional target date, a dependency graph, and a composed checklist; team and dev activity feed its progress, and Athena can read, propose updates to, and proactively flag goals.

> Design rationale + decisions: [`docs/concepts/goals-direction-hub.md`](../../concepts/goals-direction-hub.md).

## Where it lives

- **Top-level sidebar section** — `Goals` (between Overview and Agents), in addition to the legacy Dev Tools › Goals tab (a contextual shortcut). Both render the same surface (`src/features/plugins/dev-tools/sub_goals/`).
- **L2 sub-nav** — five surfaces: **Board · Map · Timeline · Portfolio · Attention**. Board / Map / Timeline are scoped to the active project (`LifecycleProjectPicker` in the header); **Portfolio** and **Attention** are cross-project.

## Canonical status model

All status handling funnels through `goalStatus.ts` — a `GoalStatus` type (`open | in-progress | blocked | done`), a tolerant `normalizeGoalStatus` (maps the hyphen/underscore/team-step/alias variants onto one set), predicates (`isComplete` / `isOngoing` / …), and `GOAL_STATUS_META` (icon + lane + chip + tint + map colours). `GoalStatusBadge` renders status everywhere from it. The Rust side mirrors this in `normalize_goal_status` so cross-project rollups bucket exactly like the UI. (v1 compared `in-progress` vs `in_progress` inconsistently and silently mis-laned in-progress goals — v2 makes that class of bug impossible.)

## Surfaces

### Board + Map (active project)
- **Board** — a `your turn → agent's turn → done` kanban; lane membership derives from `GOAL_STATUS_META.lane`. Cards have progress nudges, an open-details affordance, and a date that turns red when an ongoing goal is overdue.
- **Map** — a force-directed graph (`forceLayout.ts`) over parent/child + dependency edges; hovering a node spotlights it + its direct neighbours and dims the rest. Edges/colours come from the canonical model.

### Timeline (active project)
`GoalsTimeline` — ongoing goals on a vertical target-date rail, bucketed **Overdue → This week → This month → Later → No date**, each row showing the relative due date, status, and progress. Opens the goal on click.

### Portfolio (cross-project)
`GoalsPortfolio` — mission control across every project. Grand-total tiles + a card per project with a canonical-status segmented bar, at-risk / overdue surfacing, and avg progress. Click a project to switch to it and jump to its Board. Backed by the one-pass `dev_tools_portfolio_summary` rollup (no N+1).

### Attention (cross-project)
`GoalsAttention` — one ranked "needs you" queue over `dev_tools_attention_queue`: **awaiting-review** team steps (resolve inline with skip/abort), **overdue**, **stalled** (untouched ≥ 7 days), and **unstaffed** (no linked team) goals. Each row opens the goal via the active-project + spotlight handoff; a header **Ask Athena to triage** hands the whole queue to the companion.

Clicking a goal in Board / Map / Timeline / Attention opens the **detail drawer**.

### Authoring
`+ New goal` (header and empty state) opens `GoalEditorModal` — create/edit/delete with title, description, status, and target date. (Goals can also still be imported from GitHub issues.)

### Detail drawer
`GoalDetailDrawer` is the focused view for one goal:

- **Hybrid progress nudge** — `dev_tools_resolve_goal_progress` composes the goal's checklist items, sub-goals, and linked team-assignment steps into a *suggested* progress %. When it differs from the stored value, the drawer offers **Accept / edit** — progress is never written silently; a manual override always wins.
- **Composed checklist** — ad-hoc items (add / toggle / delete), sub-goals, and linked team-assignment steps in one list. A team step in `awaiting_review` gets inline **skip / abort** intervention (via the team-assignment review path).
- **Linked teams** — the team assignments advancing this goal (title + status) with **unlink**.
- **Activity feed** — recent `dev_goal_signals`, including the `team_*` and `athena_update` signals described below.

## How progress flows in

- **Dev tasks** — a task linked to a goal (`dev_tasks.goal_id`) writes a `dev_goal_signal` on completion/failure (`task_executor`).
- **Teams** — an assignment linked to a goal (`team_assignments.goal_id`, set in the assignment composer's *Advance goal* picker) writes `team_step` / `team_done` / `team_failed` / `team_awaiting_review` signals as the orchestrator runs it. Step status also feeds the hybrid progress resolver.
- **Athena** — proposed updates write an `athena_update` signal.

Progress is **hybrid**: signals + step/checklist completion compute a suggestion; the user (or Athena, gated) accepts it.

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
| `team_assignments.goal_id` | the soft link from a team assignment to the goal it advances |

Key commands — per-goal/project: `dev_tools_{list,create,update,delete,reorder}_goal(s)`, `dev_tools_{list,create,update,delete,reorder}_goal_item(s)`, `dev_tools_list_child_goals`, `dev_tools_resolve_goal_progress`, `set_team_assignment_goal`, `list_team_assignments_for_goal`.

Cross-project (v2): `dev_tools_list_all_goals`, `dev_tools_list_goal_dependencies_for_project` (single-query Map edges), `dev_tools_portfolio_summary` (one-pass per-project rollup), `dev_tools_attention_queue` (awaiting-review / overdue / stalled / unstaffed). Aggregates use the stored `progress` column + canonical status buckets, never the per-goal resolver — so they stay flat at portfolio scale (10 projects / 100 goals).
