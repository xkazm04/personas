---
name: kpi-sim
contexts: tracked
category: Data
memory: project
description: KPI Simulation — measure a project's KPIs locally, simulate user behavior with UAT-style Characters, and predict real-world targets from web benchmarks, writing a result.json the Personas app ingests into its KPI module (env-tagged simulated series + proposal-gated adjustments). Engine doctrine mirrors src/features/teams/sub_kpis/kpiSimPrompt.ts — the app dispatches the same contract into managed repos as a Fleet Dev-runner session, so most target repos never need this skill installed. Invoke with `/kpi-sim run [--l2] [--kpi <id>] [--project-root <path>]` or `/kpi-sim predict`.
---

# KPI Simulation (engine reference)

> **Maintenance: authority = `src/features/teams/sub_kpis/kpiSimPrompt.ts`**
> (+ `src-tauri/src/commands/infrastructure/kpi_sim.rs` for ingest guardrails).
> When this file and they disagree, fix THIS file.
> Design + phasing: [`docs/plans/kpi-simulation-skill.md`](../../../docs/plans/kpi-simulation-skill.md).

**Distribution:** the canonical engine is the dispatch prompt — the app runs it
*into* managed repos via a Fleet session (`kpi-sim:<project>` key). This skill
is for hand-running the operation from a CLI, or per-repo adoption via the
passport Skills module.

## Standalone run — preconditions and lifecycle

1. **`kpi-sim/snapshot.json` must exist at the repo root** — ground truth
   (project identity + every managed KPI + env axis). Only the app writes it
   (`dev_tools_kpi_sim_prepare`); no snapshot → stop and have the user trigger
   the sim from the KPI dashboard once. KPI ids in output MUST come from it
   verbatim. Status `"proposed"` KPIs await review — never re-propose (by id
   or name) or measure them; context only.
2. **Write `kpi-sim/runs/<YYYY-MM-DD-HHmm>/result.json` + `report.md`.** Only
   writes: that run dir + appending `kpi-sim/` to `.gitignore` if needed.
   Never touch app code, config, or KPIs.
3. **Ingest** is app-side (`dev_tools_kpi_sim_ingest`): auto on Fleet session
   exit, or the dashboard's Import button. Picks the newest run dir with
   `result.json` and no `ingested.json` marker; idempotent. A valid run:
   parseable JSON, ≤1 MiB, ≤50 measurements, ≤8 proposals; bad rows are
   skipped and reported, not fatal.

## result.json (exact schema: kpiSimPrompt.ts OUTPUT_CONTRACT)

```
{ "sim_run_id": "<run dir name>",
  "measurements": [ { kpi_id, value, env: "local"|"test", confidence: 0-1,
                      evidence: { ..., cert: "L1"|"L2" }, note } ],
  "proposals":    [ { kind: "adopt_measure_config"|"adjust_target"|"retire"|"new_kpi",
                      kpi_id, payload, rationale, citations: [] } ],
  "findings":     [ { title, description, kpi_id?, evidence } ] }
```

`new_kpi` payload = a full KPI (name, description, category, measure_kind,
measure_config, unit, direction, baseline_value, target_value, cadence);
`adjust_target` payload = `{"target_value": <n>, "target_date"?: "YYYY-MM-DD"}`.

## The three epistemic classes (never blend)

| Class | KPIs | What you do | Lands as |
|---|---|---|---|
| 1 — measurable locally | technical/quality with a runnable procedure | author/verify `measure_config` (cmd + parse), RUN it | `adopt_measure_config` proposal, evidence = verified value + output tail |
| 2 — simulated user behavior | user-facing outcomes (completion, time-to-value) | 3–5 Characters (reuse `uat/characters/` if present — never invent a second cast) walk KPI-bound journeys over the CODE (L1); `--l2` adds live driving | measurements, env `local` (repo cmds) or `test` (walks/live), evidence = `{characters, completed, journals}` + confidence |
| 3 — real traffic/value | users, revenue, retention | web-research 2–4 comparable products; NEVER emit a measurement | `adjust_target` / `new_kpi` / `retire` proposals with citations |

Honestly unsimulatable → one finding, skip. **Never invent a number.**

## Hard rules (ingester-enforced — violations are dropped)

- Every measurement carries `evidence`; evidence-free rows are refused.
- `env` is `local`/`test` only — `production` is real telemetry's channel and
  is rejected. Simulated rows never advance `current_value`/pace (app-side).
- ≤8 proposals per run; prefer adjust/adopt over inventing. All KPI mutations
  are proposals — applied only after a human accepts.
- A failing command = a class-1 gap (finding), never a reason to fabricate.

## Modes

- `run` — full pass, L1-only by default. `--l2`: probe for a driver in order —
  documented test/automation harness → Playwright/Puppeteer already in
  devDependencies (minimal per-journey script) → plain HTTP curl. Act → wait
  to settle → capture REAL output and judge that, not your expectation. No
  mechanism / app won't start → one "no live-simulation path" finding + L1
  fallback; never fake L2. L2 rows: env `test`, `"cert":"L2"` in evidence.
- `predict` — class-3-only research refresh: 2–4 current, named benchmarks →
  proposals + findings. **`"measurements": []` REQUIRED**; every proposal
  needs ≥1 citation. No repo commands, no journey walks.
- `--kpi <id>` scopes to one snapshot KPI; `--project-root <path>` when run
  outside the target repo.

## Orchestration

Classify every snapshot KPI into exactly one class, fan out research via the
Task/Agent tool (sonnet-class; keep synthesis in this session), run class-1
commands and class-2 walks. Before finishing: adversarially re-check
result.json — delete any value you cannot trace to evidence, validate it
parses, print measurements/proposals/findings counts.

## App context coverage (Personas-managed repos)

This skill declares `contexts: tracked` — the Personas app measures per-context memory coverage for it. When run inside a Personas-managed repo (a `.personas/` dir exists, or the app dispatched this run), before finishing append JSON lines to `.personas/memory-outbox.jsonl` at the repo root (append, never rewrite) — one node per context you meaningfully worked on:

```json
{"type":"node","kind":"progress","title":"<=200 chars: what you did in this context","body":"optional detail","context":"<exact context name from .claude/codebase-context.md>","skill":"kpi-sim"}
```

**Which name — this is the part that silently fails.** The ingest anchors a node
by matching `context` against the names the app actually knows, case-insensitively.
A name it does not recognize is NOT an error: the node is stored with a null
context and simply never counts toward coverage. Use the **product-level context
names in `.claude/codebase-context.md`** (49 names under 8 groups — the taxonomy
CLAUDE's project map describes). Do NOT use repo-root `context-map.json`: it is a
stale (2026-07-10) Vibeman auto-map with 236 mechanical names like
`tauri:engine [3/10]` and `plugins/dev-tools [2/3]`, none of which the app knows.

Always set both `"skill":"kpi-sim"` and `"context":"<name>"` — together they drive the per-skill context-coverage % (last 30 days). The app ingests and deletes the file when the session ends. Skip silently when not Personas-managed.
