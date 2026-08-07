---
slug: staleness-sees-ideas-and-tasks
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: robustness
status: shipped
size: M
proposed: 2026-08-05
accepted: 2026-08-05
shipped: 2026-08-05
commit: 9fc8c42ff, 5ee89681a
---
## What & why

Nothing in this app can answer "what did I approve that never actually got dispatched?"
An accepted idea with no task is invisible work that never happens — the codebase says
exactly that, in the comment justifying the order of operations when a task IS created
(`triageDispatch.ts:170-176`) — and yet there is no query anywhere that finds the case where
it wasn't.

Meanwhile a complete staleness engine already exists, is wired to nothing, and is marked for
deletion.

## Evidence

- `dev_tools_attention_queue` — `repos/dev_tools.rs:1543-1701`, command at
  `commands/infrastructure/dev_tools/goals.rs:520-527`. Four categories, rank-ordered,
  7-day cutoff. **Zero frontend consumers**; the only references are the generated binding
  and its re-export. Standing delete recommendation at `docs/development/ipc-orphans.md:105`.
- It is **goal-shaped end to end** — it never reads `dev_ideas` or `dev_tasks`.
- Two latent bugs inside it:
  - `overdue` (`:1633`) and `stalled` (`:1641`) compare RFC3339 timestamps **lexicographically
    as strings**, never parsed.
  - `days_between` (`:1704-1720`) **returns 0 on parse failure**, turning a malformed date
    into a confident "0 days".
- `dev_tasks` (`schema.rs:1267-1288`) has `created_at` / `started_at` / `completed_at` and
  **no `updated_at`**. A task stuck `running` for six hours is indistinguishable from one
  running six minutes except via `started_at`.
- The only prior art for "does this idea have a task yet" is `archive_stale_ideas`
  (`repos/dev_tools.rs:3551`) — `NOT EXISTS (... dev_tasks.source_idea_id ...)`, scoped to
  `pending` ideas only, never `accepted`.
- Client-side derivation is not available either: `triage_ideas` is cross-project and
  `tasks_page` has no `source_idea_id` filter, so neither page shape exposes the join key.

## Acceptance criteria

- [ ] `dev_tasks.updated_at` added via the **incremental** migration path, backfilled from
      `COALESCE(completed_at, started_at, created_at)`, and written by every task mutation.
- [ ] "Accepted with no task" is first-class queryable data, not a client-side guess.
- [ ] The attention queue reports ideas and tasks alongside goals; the existing four goal
      categories keep their current behaviour and rank ordering.
- [ ] Lexicographic timestamp comparisons replaced with parsed ones.
- [ ] `days_between` no longer returns a plausible-looking 0 on unparseable input.
- [ ] Counts are `u32` (ts-rs maps `i64` → `bigint`, which the frontend cannot sum).
- [ ] `ipc-orphans.md` no longer lists the command for deletion.
- [ ] Repo-level tests via `init_test_db()`, including: accepted-with-task is NOT
      undispatched, accepted-without IS, settled rows never appear.

## Risks / non-goals

The goal categories are the current contract — widening must not change what they mean.
Thresholds are a product judgement; whoever builds it states them explicitly rather than
burying a second hard-coded `days(7)`.

Not a UI direction — this is the engine the dispatch panel consumes.
[[dispatch-panel-one-truth]] depends on it and forks after it merges.

## Build record

Builder C dispatched 2026-08-05, in parallel with wave 1's Builder B (disjoint scope:
`src-tauri/**` + generated bindings vs `src/features/agents/quick-answer/**` + i18n).
