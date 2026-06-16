# Teams & Orchestration — the end-to-end pipeline

This folder documents the **whole mechanism** that turns a codebase into an
outcome-steered, agent-run project: register a repo, map it, define what success
means, assemble a team, and put it to work. The five docs below each cover one
layer; this page is the map and the order they connect in.

The same five stages are walked by the **Teams & Orchestration** onboarding tour
(`teams-orchestration`, in `src/stores/slices/system/tourSlice.ts`) and asserted
end-to-end by the live UI test suite in
[`docs/tests/guides/teams_orchestration_pipeline.py`](../../tests/guides/teams_orchestration_pipeline.py) —
tour, test, and these docs are kept in lockstep via the shared `data-testid`s.

## The pipeline, stage by stage

| # | Stage | Where in the app | Doc |
| --- | --- | --- | --- |
| 1 | **Register your repo** — create a Dev Tools project, connect source control + standards, attach the Codebase connector | Plugins › Dev Tools › Projects → *New project* | [dev-tools.md](./dev-tools.md) |
| 2 | **Map the codebase** — scan the repo into groups / contexts / entry points; incremental re-scans + scheduled `context_scan` | Plugins › Dev Tools › Context Map → *Scan* | [dev-tools.md › Context Map](./dev-tools.md) |
| 3 | **Define success with KPIs** — the outcome layer above goals; scan for KPIs, set the critical line that derives goals | Teams › KPIs → *Scan for KPIs* | [kpis.md](./kpis.md) |
| 4 | **Assemble a team from a preset** — pick a best-practice preset, include/exclude members, adopt the blueprint | Teams › Workspace → *Preset Team* | [pipeline.md › Preset team](./pipeline.md) |
| 5 | **Put the team to work** — open the team's Studio, give it a goal, decompose, **Assign & Run** | Teams › Workspace → select a team → Orchestrate | [pipeline.md › Team Studio](./pipeline.md) · [team-orchestration.md](./team-orchestration.md) |

Goals are the connective tissue between KPIs (stage 3) and the team's work
(stage 5): a KPI off its critical line **derives a goal**, and advancing that
goal is what a team actually does — see [goals.md](./goals.md).

## The five docs

- **[dev-tools.md](./dev-tools.md)** — the Dev Tools plugin: projects, source
  control + standards, the Context Map scanner, idea scan/triage, task runner.
  Stages 1–2 of the pipeline.
- **[kpis.md](./kpis.md)** — KPIs, the outcome layer: proposal scan, the Teams
  KPI surface, and how a KPI's critical line derives goals. Stage 3.
- **[goals.md](./goals.md)** — goals: the board/timeline, hybrid progress, how
  goals steer runtime team behavior, and autonomous advancement. The layer KPIs
  derive into and teams advance.
- **[pipeline.md](./pipeline.md)** — the Teams Workspace UI: the team list,
  preset studio, and the **Team Studio** console (orchestrate / board / collab /
  red-room / memory / settings modes). Stages 4–5.
- **[team-orchestration.md](./team-orchestration.md)** — the developer-facing
  *logic* underneath: the two orchestration modes, what shared state reaches a
  running persona, advancing a goal, and the observability/analysis layer.

## Source → docs

These docs are mapped from source in
[`scripts/docs/feature-doc-map.json`](../../../scripts/docs/feature-doc-map.json)
(`src/features/plugins/dev-tools/**` → dev-tools.md; `src/features/teams/**`,
`src-tauri/src/commands/teams/**`, `src-tauri/src/engine/team_assignment_*` →
pipeline.md; `src/features/teams/sub_kpis/**` → kpis.md;
`src/features/teams/sub_goals/**` → goals.md). The Stop hook nags when coupled
source changes without a docs update in the same turn.
