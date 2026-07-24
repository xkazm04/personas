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
- `existing_practice_titles` — practices already in the library (do NOT re-propose),
- `rejected_dedup_keys` — practices the workspace already rejected (do NOT re-propose).

If the snapshot is absent (standalone run), infer the repo's stack from its
manifests and skip the dedup lists.

## What to harvest

Durable, reusable engineering practices worth sharing across the workspace,
in five layers: **design, code-quality, ui, performance, process**. Mine the
repo's *real* conventions — lint/format configs, design-token/theme systems,
test setup + fixtures, CI/pre-commit gates, error-handling patterns,
performance techniques, migration/IPC/build patterns. A practice is worth
harvesting only if a **sibling project could plausibly adopt it**. Prefer a
small number of high-signal practices over volume (≤ ~15).

## Output

Write `practice-harvest/runs/<YYYY-MM-DD-HHmm>/result.json` plus a short
`report.md`. You NEVER write any database — the app ingests result.json through
its one governed door. The exact `items[]` schema (kind ∈
pattern|pitfall|decision|howto|fact; required title + statement; optional
detail_md / topic / applicability object / dedup_key / confidence) is defined
canonically in `practiceHarvestPrompt.ts` (OUTPUT_CONTRACT) — follow it exactly.

## Hard rules

- Only write files under `practice-harvest/runs/<id>/`. Touch nothing else.
- Ground every item in real evidence from THIS repo — no generic advice.
- Skip items matching an `existing_practice_title` or a `rejected_dedup_key`.
- Items land `observed` for human review — you are proposing, not adopting.
