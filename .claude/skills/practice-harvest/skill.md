---
name: practice-harvest
description: Harvest reusable best practices from a repository into a Personas workspace's shared knowledge library. Mines the repo's real conventions (design tokens, lint/CI gates, error-handling, test setup, performance patterns) across the design / code-quality / ui / performance / process layers and writes a result.json the Personas app ingests as "observed" practices for human review. Engine doctrine mirrors src/features/plugins/dev-tools/sub_workspaces/practiceHarvestPrompt.ts — the app dispatches the same contract into member repos as a Fleet Dev-runner session, so most target repos never need this skill installed. Invoke with `/practice-harvest run [--project-root <path>]`.
---

# Practice Harvest (engine reference)

This skill is a thin reference; the authoritative engine is the dispatch prompt
in `practiceHarvestPrompt.ts`. When the Personas app dispatches a harvest, it
sends that prompt directly — you do not need this file installed. Run it
standalone only to harvest a repo by hand.

## Ground truth

Read `practice-harvest/snapshot.json` at the repo root FIRST. It carries:
- the workspace name and this project's stack + standards,
- the sibling projects (name + stack) — the portfolio you're contributing to,
- `scopes` — every territory in this repo with its paths, contexts, and when
  each was last harvested,
- `existing_practice_titles` — practices already in the library (do NOT re-propose),
- `rejected_dedup_keys` — practices the workspace already rejected (do NOT re-propose).

If the snapshot is absent (standalone run), infer the repo's stack from its
manifests, pick ONE scope yourself (see below) and skip the dedup lists.

## Scope — you harvest one territory, not the repo

The dispatch names a single scope id. Find it in `scopes` and read broadly
inside its paths; you are the only session assigned to that ground, so
whatever you skip, nobody covers.

**Do not harvest outside your scope.** Root configs, lint setup, CI, hooks and
scripts belong to the `repo-global` scope. Unless that IS your scope, items
sourced from them are out of bounds — and they are the single most common way a
harvest fakes coverage, because they are the cheapest place to find something
that looks like a convention.

> Why: the first engine sent one agent at a whole repository with a ~15-item
> cap and "prefer a small number of high-signal practices over volume". A
> measured run on an 8,568-file repo spent ~11 tool calls, returned 14 items,
> and every one came from a root config file — nothing from the 236 mapped
> contexts of feature code. The agent was complying, not failing. Scope +
> coverage replaced the cap.

## What to harvest

Durable, reusable engineering practices worth sharing across the workspace,
in five layers: **design, code-quality, ui, performance, process**. Inside your
scope, mine what the code actually does — module and data boundaries, error and
result handling, state and data-flow patterns, concurrency/cancellation/retry
handling, API and IPC seams, persistence and migration patterns, test setup and
fixtures, performance techniques, and the pitfalls the code visibly defends
against (a guard, a workaround, or a comment explaining a past failure is prime
material). A practice is worth harvesting only if a **sibling project could
plausibly adopt it**.

**No item cap.** Report every practice the territory genuinely supports —
usually 5–25 for a scope of a few hundred files. The ingest door caps a run at
120 candidates and 1 MiB; those are the machine guards. Both failure modes are
real: stopping early because you have "enough" (nobody else covers your
territory), and padding with generic advice the repo does not practise or with
lint-level mechanics (`durability: "mechanical"`).

## Output

Write `practice-harvest/runs/<YYYY-MM-DD-HHmm>-<scope-id>/result.json` plus a
short `report.md`. Set `"scope": "<your scope id>"` at the top level of
result.json — it stamps the coverage ledger, and without it the run is recorded
against `repo-global`. The scope id in the directory name keeps concurrent
scope sessions from colliding.

`report.md` must say which paths inside your scope you actually read, which you
did not get to, and what you deliberately skipped. A harvest that read 10% of
its territory and says so is useful; one that implies completeness is not. You NEVER write any database — the app ingests result.json through
its one governed door. The exact `items[]` schema (kind ∈
pattern|pitfall|decision|howto|fact; required title + statement + topic;
optional detail_md / applicability object / dedup_key / confidence) is defined
canonically in `practiceHarvestPrompt.ts` (OUTPUT_CONTRACT) — follow it exactly.

### Topic — a closed vocabulary

`topic` is **exactly two segments, `area/cluster`**, drawn from the `taxonomy`
block in `snapshot.json`. Read it before writing any item.

- `topic` answers **where** the practice lives (which concern or subsystem it
  governs); `ftype` separately answers what **shape** it is. Don't encode shape
  in the topic — a repository-behind-one-interface practice is
  `data/store-boundary`, not `architecture/boundaries`.
- Areas are **precedence-ordered**. Walk them in the order given and take the
  first that genuinely governs: if the practice would be meaningless without
  that concern, it governs. `architecture` sits near the end deliberately — it
  means the codebase's own skeleton, so reach for it only when no subsystem
  area applies.
- Prefer a listed cluster; you may name a new cluster under a listed area if
  none fits, but **never invent an area** (those are quarantined on an
  `unsorted/` shelf for a human).

Free-form topics are what broke this library once already: 13 parallel harvest
agents produced 154 distinct topics for 177 items — a flat list wearing a
tree's clothes.

## Hard rules

- Only write files under `practice-harvest/runs/<id>/`. Touch nothing else.
- Ground every item in real evidence from THIS repo — no generic advice.
- Stay inside your scope.
- Skip items matching an `existing_practice_title` or a `rejected_dedup_key`.
- Items land `observed` for human review — you are proposing, not adopting.
