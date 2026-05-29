# Goals as cross-cutting direction (dev + teams + Athena)

Status: **design locked, execution phased** · Owner: goals-hub worktree · 2026-05-28

## Problem

"Goals" is an underused feature that should give high-level direction to **development** *and* **teams**, with **Athena** tracking and reacting to progress. Today there are **three decoupled goal concepts**:

| Concept | Storage | Shape | Driver |
|---|---|---|---|
| **DevGoal** | `dev_goals` table (dev-tools) | project-scoped, hierarchy (`parent_goal_id`), `progress` 0-100, `target_date`, status; `dev_goal_dependencies` (DAG) + `dev_goal_signals` (progress telemetry) | user (manual) + dev tasks |
| **Companion Goal** | `companion_goal` table + markdown (Athena brain) | aspirational "what the user is working toward", priority 1-5, status active/paused/completed/abandoned | Athena via gated `write_goal` op |
| **TeamAssignment.goal** | `team_assignments` table (pipeline) | free-text string + a real step checklist (`team_assignment_steps`) with state machine + `TEAM_ASSIGNMENT_PROGRESS` events | team orchestrator |

They never meet. Consequences:
- Goals can only be **created** by importing GitHub issues (`GitHubIssueImportModal`) — no authoring UI.
- Progress is **manual** (kanban nudge); `dev_goal_signals` are written by `task_executor` on linked-task completion but don't move the bar.
- Teams have **zero** goal linkage; their `goal` is a string.
- Athena has **zero** dev_goal awareness (she sees project scan metadata, not goals/signals).
- The Goals UI is 4 un-consolidated A/B viz variants (`GoalConstellation` baseline/pulse/flow/kanban) buried at dev-tools L3.

## Locked decisions (2026-05-28)

1. **Goal model = Bridge, DevGoal as hub.** Keep 3 tables. DevGoal is the canonical project "direction." Teams + Athena *reference* it. No table merges (high-churn, loses user-aspiration vs project-roadmap distinction).
2. **Surface = promote to cross-cutting.** New top-level **Goals** sidebar entry; consolidate the 4 variants into **Board + Map**.
3. **Progress = hybrid auto-suggest.** Activity computes a *suggested* progress; user/Athena accept-or-edit. Manual override always wins. Compute-on-read (no `suggested_progress` column).
4. **Athena = read + propose, writes gated.** She reads goals/signals + flags stalled goals proactively (auto); create/update/delete/assign-team stay approval-gated. Extends the existing CONSERVATIVE autoapprove stance.
5. **Checklist = lightweight `dev_goal_items` table.** Ad-hoc "jot 3 things." Detail drawer composes `goal_items ∪ sub-goals ∪ linked-assignment steps`, each with state + intervention.
6. **Scope = active project + picker** (matches data model; all-projects roll-up deferred).

## Target architecture

### Schema (additive only)
- `team_assignments.goal_id TEXT NULL` → `dev_goals(id)` (ON DELETE SET NULL). The entire teams↔goals sync.
- `companion_goal.linked_dev_goal_id TEXT NULL` (defensive `ALTER TABLE` in user-db init, like `scheduled_for`).
- `dev_goal_items` (`id`, `goal_id` FK CASCADE, `title`, `done` INTEGER, `order_index`, `created_at`, `updated_at`).
- Reuse `dev_goal_signals` as the universal progress log; add producers (teams) alongside the existing task producer.

### Progress resolver (hybrid)
`resolve_goal_progress(goal, signals, linked_assignment_steps) -> { current, suggested, reason }`.
- suggested = blended completion of linked assignment steps + checklist items + sub-goals (weighting TBD in Phase 1; start simple = `done / total` across composed checklist).
- UI surfaces `suggested ≠ current` as an **accept / edit** nudge. Accept → `update_goal(progress: suggested)`. Optionally log a `dev_goal_signal{signal_type:"progress_suggested"}` for audit.

### Teams → Goals
- Assignment composer: pick/create a goal to link (`goal_id`).
- `team_assignment_orchestrator` already emits `TEAM_ASSIGNMENT_PROGRESS` on every transition; on a linked assignment's step-done / terminal, **also** write a `dev_goal_signal` (`signal_type:"team_step" | "team_done" | "team_failed"`, `source_id = assignment_id`). The Goals surface listens for the existing event to refresh live.
- `awaiting_review` on a linked step → surfaces on the goal's Board card in the "your turn" lane with inline resolve/reassign (reuse `resolve_team_assignment_review`).

### The Goals surface (`src/features/goals/`)
- New top-level sidebar entry **Goals** + route (active-project scoped via existing `LifecycleProjectPicker` pattern).
- **Board** (default): the `your turn → agent's turn → done` kanban, lanes driven by real states (team `awaiting_review` → "your turn"). Operational heartbeat.
- **Map**: constellation force-graph + dependency edges (absorbs Flow). Pulse's spotlight becomes the **detail drawer**.
- **Authoring**: `+ New goal` / edit drawer (the missing CRUD), keep GitHub import.
- **Detail drawer**: composed checklist (`goal_items ∪ sub-goals ∪ assignment steps`) + live signal feed + hybrid progress nudge + intervention controls.

### Athena (Phase 4)
- **Read**: inject active project goals + recent signals into the prompt (new section sibling to `format_goals()` in `prompt.rs`).
- **Propose (gated)**: new op `update_dev_goal { goal_id, progress?, status?, note? }` (approval card via `dispatcher.rs` ALLOWED_ACTIONS + `execute_*` in `approvals.rs`); `assign_team_to_goal` reuses the already-gated `assign_team` with a `goal_id`.
- **React (auto)**: new `proactive::triggers` entry — project goal stalled / at-risk / target-approaching → budget-gated nudge → on engage, Athena reasons with goal context and proposes (gated). Mirrors her existing own-goal target trigger.
- **Link**: `companion_goal.linked_dev_goal_id` ties an aspirational goal to a project goal for cross-surface continuity.

## Execution phases

1. **Backbone (Rust):** migrations (`dev_goal_items`, `team_assignments.goal_id`); models + repos + bindings; progress resolver; extend signal producers to teams; live-event on linked-goal transitions. `cargo test export_bindings`, copy bindings, `--features desktop` unit tests.
2. **Goals surface (FE):** new sidebar route; Board + Map consolidation; goal CRUD authoring; detail drawer (checklist + feed + hybrid nudge + intervention).
3. **Teams↔Goals wiring (FE):** link-a-goal in assignment composer + "assign a team to this goal" from the goal; bidirectional surfacing.
4. **Athena (LAST — coordinate):** prompt injection + gated `update_dev_goal` + proactive stalled-goal trigger + `linked_dev_goal_id`.
5. **Docs/i18n/tests:** new `docs/features/goals/README.md` + `feature-doc-map.json` entry; update dev-tools.md + companion + events docs; marketing guide; i18n keys; bindings regen.

## Coordination notes
- Phases 1-3 are **path-disjoint** from all active sessions (per active-runs.md 2026-05-28).
- **Phase 4 collides** with `friend-companion-090531` (`dispatcher.rs` GUIDED_TOPICS + `constitution.md`) and `friend-companion-090423/090531` (companion UI). Sequence Phase 4 last; keep new companion-UI in **new files only**; coordinate the `dispatcher.rs`/constitution bump when those loops settle.
- `lib.rs` command registration + `src/lib/bindings/` + `en.json` are append-hotspots shared with `director-phase2` — per-file staging, additive keys only, never `git add -A`.
- ts-rs: bindings land in `src/lib/bindings/` via `build.rs` `TS_RS_EXPORT_DIR`; run `cargo test export_bindings`, verify `src/lib/bindings/` diff, commit.

## Open follow-ups (not blocking)
- Progress weighting heuristic (start `done/total`, refine later).
- All-projects roll-up glance (deferred).
- Whether a goal's `target_date` slippage should auto-create a manual-review item.
