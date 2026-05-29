# Team orchestration — the logic

> Developer-facing mental model of how a **team** actually runs, for the next
> wave of team/orchestration work. The [pipeline README](./README.md) maps the
> UI surfaces; this doc explains the *logic* underneath — how members relate,
> the **two orchestration modes**, what shared state reaches a running persona,
> and the observability/analysis layer that judges the result.

## TL;DR mental model

A "team" is a set of personas plus the wiring that decides **who runs, when, and with what shared context**. There are **two independent orchestration modes**, and a team can use either (today, almost all running teams use the first):

| | **A. Event-chain** (original) | **B. Goal-driven assignment** (newer) |
|---|---|---|
| Trigger | A persona finishes → emits an event → a subscribed persona runs | User/Athena gives the team a **goal**; orchestrator decomposes + drives it |
| Wiring | `persona_team_connections` + `persona_event_subscriptions` / `PersonaTrigger` | `team_assignments` → `team_assignment_steps` (DAG) |
| Driver | `engine/bus.rs` event matching | `engine/team_assignment_orchestrator.rs` tick loop (~1s) |
| Goal tracking | none intrinsic | links to `dev_goals` via `team_assignments.goal_id` |
| Pacing | reactive, per-event | up to `max_parallel_steps` concurrent, cascade-skip, review gates |

Both modes execute the same primitive — a single `persona_executions` run — and feed the same shared state and the same observability layer. The mode is a property of *how work is initiated*, not of the team object itself.

> **Field-observed (2026-05-29):** the fleet was consolidated to **7 active teams**, all running in mode A. Each is now **linked to its project's goal** via `dev_projects.team_id` (backfilled by name match), and those goals now reach every member's execution through the team-alignment block (below) — closing the `NO-GOAL-LINK` injection gap. They still show `has-goal/NOT-advancing` (no `team_assignments.goal_id` yet), so the next step is for teams to actually *work* their goals via assignments. The Athena fleet analysis + the CICD goal remain the broader direction (see [Direction](#direction)).

## The team object

`PersonaTeam` (`src-tauri/src/db/models/team.rs`) + three relations:

- **`persona_team_members`** — the declared roster (role, canvas position, `NodeConfig` JSON: `node_type` persona|command, `model_profile_override`, `approval_gate`).
- **`persona_team_connections`** — directed edges between members (`source_member_id → target_member_id`, `connection_type`, optional `condition`). This is the canvas graph for mode A.
- **`personas.home_team_id`** — the *runtime anchor*: the one team whose `shared_instructions` + defaults apply when that persona executes. Roster membership (`persona_team_members`) and runtime anchor (`home_team_id`) are **distinct** — a persona is rostered on a team's canvas, and separately anchored to a team for context resolution. Query "all of a team's personas" via the **union** of both (this is what `fleet-analyze.mjs` does).

Team-level defaults that cascade to members: `shared_instructions`, `default_model_profile`, `default_max_budget_usd`, `default_max_turns`.

## Mode A — event-chain execution

The original SDLC-team flow. No central driver; work propagates by events:

1. A persona execution completes and writes `output_data` + structured `execution_flows`.
2. `engine/bus.rs` (`MatchableSubscription`, `match_event`) evaluates subscriptions/triggers against the source execution. Two subscription shapes, unified behind one trait:
   - `PersonaEventSubscription` (legacy named-event listener)
   - `PersonaTrigger` with `TriggerConfig::EventListener` or `::Chain` (modern), with `ChainConditionType::{Any,Success,Failure,Jsonpath}`.
3. Matched subscriptions emit an `ExecutionRequest` → the next persona runs.

`persona_events` records the handoff graph actually traversed (source → target, status, `processed_at`) — the audit trail for "did A→B→C fire as designed". Adoption **must** wire `persona_event_subscriptions` or the chain silently no-ops (a known historical bug class; the certification health-lint checks for it).

## Mode B — goal-driven assignments

Layered on top of a team; the user/Athena supplies a **goal** instead of pre-wiring. Three cooperating layers (keep them separate — see [athena-team-orchestration.md](../companion/athena-team-orchestration.md)):

1. **Decompose (Sonnet, one-shot)** — `engine/team_assignment_matching.rs::decompose_goal` turns goal + roster into ordered `DecomposedStep`s. Stateless "what should the team do?".
2. **Orchestrate (deterministic, no LLM in the loop)** — `engine/team_assignment_orchestrator.rs` runs a background tokio tick loop (~1s, `run_assignment` → `tick_loop`): resolves the DAG (`team_assignment_steps.depends_on`), matches each ready step to a persona (`manual` / `embedding` (ml-gated, fastembed cosine, falls back to `llm_eval` < 0.45) / `llm_eval` (Sonnet)), launches up to `max_parallel_steps` concurrent executions via the shared `ExecutionEngine::start_execution`, handles **cascade-skip** (skipping a step skips its dependents) and **per-step review** (`awaiting_review` pauses *only that assignment*; siblings continue). Emits `team-assignment-progress` on every transition.
3. **Reconcile (Athena, post-run)** — *after* terminal status, Athena reads the run and writes a summary/next-steps into OperativeMemory. **Not yet shipped** — the seam is documented in [athena-team-orchestration.md](../companion/athena-team-orchestration.md).

Status machines: assignment `queued → running → awaiting_review | done | failed | aborted`; step `pending → matching → running → awaiting_review | done | skipped | failed`. Tables: `team_assignments`, `team_assignment_steps`, `team_assignment_events`, `team_assignment_templates`. `team_assignments.goal_id` is the soft link to a `dev_goal`.

**Provenance matters:** `source = 'athena'` assignments carry a `companion_op_id` (tie back to a companion operation); `source = 'team_ui'` assignments surface via the checklist/board only.

## Shared state reaching a running persona

What a member actually sees at execution time is assembled in `engine/runner/mod.rs`:

- **`shared_instructions`** — the team directive from `home_team_id`, appended to the persona's prompt (~L184-188).
- **Structured team memory** — a compact top-15 digest of `team_memories` (decisions/constraints, ranked by `importance`) via `team_memory_repo::get_for_injection(pool, team_id, 15)` (~L771-796). `team_memories` (team_id, run_id, member_id, category, importance 1-10) is the shared knowledge store; team members + the orchestrator write to it during/after runs.
- **Team-alignment "pre-ritual"** *(2026-05-29 — idea 3a, shipped)* — a compact `## Team Alignment` block injected for every member execution (`engine/runner/team_context.rs`, wired at ~L809, right after the team-memory seam). It gives the persona, in the same wrapper for every teammate: **who it is** (its role on the team — its own capabilities are already in `## Active Capabilities`), **who wraps it** (the roster: each teammate + a one-line capability, so it coordinates instead of duplicating a lane), **the team's active goals** (the team's non-done `dev_goals` — see [how goals resolve](#how-a-teams-goals-are-resolved) — flagged `▶` when a `team_assignment` is canonically advancing them), and **the alignment doctrine**: the persona self-decides, *from its own capabilities*, whether/how the work advances a goal — align where it genuinely relates, don't force-fit, record real progress via team memory / goal signal. Relevance is **LLM-driven** (the persona self-filters against the goals), not a per-execution match — cheaper on the hot path and "driven inner from persona design." Hard-bounded (roster ≤8, goals ≤6, lines truncated) per the run-10 prompt-bloat guardrail; skipped on session resume.

### How a team's goals are resolved

The block answers "what is my team's mission?" by walking **team → project → goals**, via the canonical durable link **`dev_projects.team_id`** (the column built for "this team owns this project"; set in the project editor or by backfill). Resolution order in `team_context.rs::gather_active_goals`: the executing persona's pinned project (`design_context.dev_project_id`) first, else `dev_projects.team_id = <team>`, else the goals the team is directly advancing (`team_assignments.goal_id`). This is the **same `dev_goals` spine** the Goals UI and team assignments use — so goals authored in either surface now steer runtime team behavior, not just the Goals views. (The per-task "advancing" link `team_assignments.goal_id` stays the granular signal; `dev_projects.team_id` is the durable team-mission link.)

**Still NOT injected** (remaining cooperation gaps, spec'd in [team-engagement.md](../../plans/team-engagement.md)): a product/business vision and live peer workload. Idea 3b (independent product validation of outputs) is also still open.

## Observability & analysis layer

Every execution (either mode) lands in `persona_executions` with the signals the analysis layer mines:

- **`business_outcome`** — `value_delivered | partial | precondition_failed | no_input_available | unknown`, *self-assessed* by the executing LLM (`engine/parser.rs` parses the `outcome_assessment` block). Not independent validation (idea 3b).
- **`director_score`** (0-5) + **`director_review_md`** — set by the **Director** (`engine/director.rs`), an LLM evaluator that scores executions and emits verdicts (`prompt|health|triggers|credentials|memory|usefulness`) routed to `persona_manual_reviews`, with Brain long-term memory. Scoped to **starred** personas; manual `run_director_batch` or per-execution.
- **Value rollup** (`db/repos/execution/metrics.rs::get_value_rollup`) — per-persona/window aggregation of outcomes, cost-per-value, per-model efficiency.
- **Goals + Attention** (`dev_tools_*`) — when a team is goal-linked, `dev_goals.progress` + the attention queue (awaiting_review/overdue/stalled/unstaffed) track on-track state.
- **Fleet analysis** (`scripts/test/fleet-analyze.mjs`) — read-only per-team rollup of all of the above into an on-track/gap report (the watcher behind the planned Athena "Analyze fleet" skill).

## Direction

The pieces above are mostly siloed. The active work threads them together:

1. **Goal-link the teams** — every team should tie to a `dev_goal` so progress is trackable (the `NO-GOAL-LINK` gap). The CICD goal is the first concrete instance.
2. **Athena fleet analysis** — a manually-triggered skill that gathers the per-team analysis (Director + value rollup + goal progress + fleet-analyze), recalls the team's long-term timeline from graph memory, applies the certification rubric, and proposes improvements. Engine = `fleet-analyze.mjs`; wiring plan in [`docs/plans/fleet-cicd-status.md`](../../plans/fleet-cicd-status.md).
3. **Cooperation context (3a) — ✅ shipped 2026-05-29** as the team-alignment block above (roster + capabilities + active goals + self-filter doctrine). Remaining: product/business vision + peer-workload awareness, and **product validation (3b)** — [`docs/plans/team-engagement.md`](../../plans/team-engagement.md).

## Key files

| Concern | File |
|---|---|
| Team model + relations | `src-tauri/src/db/models/{team.rs,team_memory.rs,team_assignment.rs}` |
| Mode A — event matching | `src-tauri/src/engine/bus.rs`; `db/models/trigger.rs` |
| Mode B — orchestrator | `src-tauri/src/engine/team_assignment_orchestrator.rs`, `team_assignment_matching.rs` |
| Runtime context injection | `src-tauri/src/engine/runner/mod.rs` (~L184, ~L771, ~L809) |
| Team-alignment block | `src-tauri/src/engine/runner/team_context.rs` |
| Shared memory | `src-tauri/src/db/repos/resources/team_memories.rs` |
| Director / scoring | `src-tauri/src/engine/director.rs`, `director_brain.rs` |
| Value rollup | `src-tauri/src/db/repos/execution/metrics.rs` |
| Fleet analysis | `scripts/test/fleet-analyze.mjs` |
| Frontend canvas/assignments | `src/features/pipeline/**` |
