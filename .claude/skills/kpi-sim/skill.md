---
name: kpi-sim
description: KPI Simulation — measure a project's KPIs locally, simulate user behavior with UAT-style Characters, and predict real-world targets from web benchmarks, writing a result.json the Personas app ingests into its KPI module (env-tagged simulated series + proposal-gated adjustments). Engine doctrine mirrors src/features/teams/sub_kpis/kpiSimPrompt.ts — the app dispatches the same contract into managed repos as a Fleet Dev-runner session, so most target repos never need this skill installed. Invoke with `/kpi-sim run [--l2] [--kpi <id>] [--project-root <path>]` or `/kpi-sim predict`.
---

# KPI Simulation (engine reference)

> Design + phasing: [`docs/plans/kpi-simulation-skill.md`](../../../docs/plans/kpi-simulation-skill.md).
> **Distribution model:** the canonical engine is the DISPATCH PROMPT
> (`src/features/teams/sub_kpis/kpiSimPrompt.ts`) — the Personas app runs it
> *into* managed repos via a Fleet session (`kpi-sim:<project>` key), so target
> repos need nothing installed. This skill file exists for (a) running the
> operation by hand from a CLI in any repo that has a `kpi-sim/snapshot.json`,
> and (b) optional adoption into a specific repo via the passport Skills module
> when a team wants to customize the bindings per-repo.

## The three epistemic classes (never blend)

| Class | KPIs | What you do | Lands as |
|---|---|---|---|
| 1 — measurable locally | technical/quality with a runnable procedure | author/verify `measure_config` (cmd + parse), RUN it, capture value + output tail | `adopt_measure_config` proposal (human accepts → the app's no-LLM evaluator owns it) |
| 2 — simulated user behavior | user-facing outcomes (completion, time-to-value) | 3–5 Characters (reuse `uat/characters/` if present) walk KPI-bound journeys over the CODE (L1); optionally drive the live app (L2, `--l2`) | measurement rows, env `test` (or `local`), source `simulation`, evidence = character/journal aggregate + confidence |
| 3 — real traffic/value | users, revenue, retention | web-research 2–4 comparable products; never emit a measurement | `adjust_target` / `new_kpi` / `retire` proposals with citations |

Honestly unsimulatable → one finding, skip. **Never invent a number.**

## Hard rules (enforced by the app's ingester — violations are dropped)

- Every measurement carries `evidence`; evidence-free rows are refused.
- `env` is `local` or `test` only — production is real telemetry's channel.
- Simulated rows never advance `current_value` / pace / autopilot (app-side).
- ≤ 8 new-KPI proposals; existing-KPI mutations are proposals, never edits.
- Only write under `kpi-sim/runs/<id>/` (+ gitignore `kpi-sim/` if needed).

## Orchestration

You (the session) are the ORCHESTRATOR: classify KPIs from
`kpi-sim/snapshot.json`, fan out research subagents via the Task/Agent tool
(sonnet-class model for research when the harness allows choosing), run class-1
commands and class-2 walks, then synthesize + adversarially self-check.

Output contract: `kpi-sim/runs/<YYYY-MM-DD-HHmm>/result.json` + `report.md` —
exact schema in `kpiSimPrompt.ts` (measurements / proposals / findings). The
app ingests via `dev_tools_kpi_sim_ingest` (auto on session exit, or the KPI
dashboard's Import button).

## Modes

- `run` — full pass (default L1-only; `--l2` adds live driving where the repo
  offers a mechanism: documented harness > playwright/puppeteer devDependency >
  plain HTTP; no mechanism → finding + L1 fallback).
- `predict` — class-3 refresh only (web benchmarks → adjustment proposals).
- `--kpi <id>` scopes to one KPI; `--project-root <path>` when run outside the
  target repo.

## L1 vs L2 (what each is for)

L1 (code-grounded walk) is cheap and mass-parallel — it catches structural
gaps and produces defensible completion/effort estimates. L2 (live driving)
additionally observes real latency, real rendering, and the actual quality of
generated output — at serial cost, contending for the app instance. The
Personas dashboard dispatches either; the sim-vs-real convergence view (plan
P3) is the scorecard for whether L2's extra cost buys better predictions.
