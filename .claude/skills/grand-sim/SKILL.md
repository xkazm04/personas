---
name: grand-sim
description: The Grand Simulation - an autonomous organisation of personas builds a fake banking system for one million users from scratch, on this machine, across sessions. Modes design | hire | build | load | reflect | status. State in .claude/grand-sim/, the map in the Obsidian vault.
version: 0.1.0
---

# /grand-sim — the Grand Simulation

> The plan, the measured gaps and the services are in `docs/architecture/grand-simulation.md`.
> This skill is the operating procedure a session follows; it does not restate the plan.
> Rules that never bend: no paid cloud; the bank runs on this machine; at most 10 active personas
> app-wide; every agent may run Opus, the orchestrator stays on Fable; the workspace's last working
> version is never deleted; the machine keeps headroom (stop dispatching at 60% memory).

## Roles

- **Orchestrator (this session).** Runs the acts, reads the evidence, extends Personas or kp when
  the simulation needs it, never writes application code for the bank.
- **Architect (a persona, workspace-bound).** Designs the solution, creates projects, adopts App
  Masters, sets goals, speaks in the channel as an authority, asks kp for roles, adjusts scope.
- **App Masters (one persona per project).** The six charters of the first day plus a hiring
  charter. They decide, dispatch, file, measure, ask.
- **Hired roles.** Composed by kp from an App Master's need, adopted through the build session.

## State

```
.claude/grand-sim/
  state.json          # { workspace, act, projects[], personas[], lastSession, decisions[] }
  acts/<n>-<slug>.md  # per act: entry criteria, what ran, evidence, exit criteria met?
  log.jsonl           # append-only: {at, act, event, evidence}
```
The Obsidian vault mirrors it for people: `Grand Simulation/Grand Simulation.md` (the map: acts,
checklist, decisions, open questions) and one note per session `Grand Simulation/<date> <slug>.md`.
Re-read the map before every write; never overwrite a note this session did not create.

## Modes

Every mode starts with `status` (below) and ends by appending to `log.jsonl` and the session note.

### `status`
Read `state.json`, the ledger (`GET /dev-tools/app-master/{project}` per project, `GET
/dev-tools/workspaces`), the fleet (`fleet_sessions` running), the active-persona count against
the cap, and the open asks in Approvals. Print one table: act, projects with their App Master's
last note and next wake, open asks, active personas / cap, queued and running tasks, memory
headroom. Nothing else.

### `design` (Act 1)
Entry: the Act-0 services exist (the checklist in the map). Steps: switch the simulation
settings on (headless bridge, cap 10, autopilot `full` with the low-risk triage rule for each
project); create the workspace and protect it; adopt the Architect
(`POST /dev-tools/architect/adopt`) with the five Architect recipes; enable it; observe until it has
written the solution design, created the projects, adopted an App Master each, set goals and
posted the first directive. Exit: six projects registered, six App Masters adopted, a design
document in the platform project, one directive in the channel. Evidence: the ledger rows, the
repositories, the design file.

### `hire` (Act 2)
Entry: at least one App Master ask of kind `unblock` or a `workforce-planning` decision naming a
role. Steps: let the Architect's workforce charter request the hire (outbound), watch kp compose
and dispatch, watch Personas mint the persona through the build session, confirm it holds a
charter and is enabled within the cap. Exit: each project has at least one hired role running.

### `build` (Act 3)
Entry: hired roles present. Steps: observe wakes; keep the machine within headroom (the fleet
dispatch cap, the active-persona cap); merge nothing yourself; answer asks that are the
operator's only if the operator has delegated them in `decisions[]`. Exit: every project has a
walking skeleton (service, schema, queue, test, container) and `docker compose ps` is green from
the platform project.

### `load` (Act 4)
Entry: the skeleton runs together. Steps: the platform App Master's load charter runs the stated
envelope; the orchestrator watches memory and CPU and stops the run at the ceiling. Exit: a load
report with p95 latencies against the envelope, and the resource ceiling respected.

### `reflect` (Act 5)
Entry: any act's evidence. Steps: read the responsibility proposals, the lessons filed, the `/uat`
findings; let the Architect's scope-reflection charter decide; promote lessons that generalise to
the registry (`recipes/<domain>/<topic>/<slug>/LESSONS.md`, version bump by PR). Exit: every
proposal decided with a reason; lessons landed.

## Guardrails the orchestrator enforces itself

- Before any dispatch, read memory headroom; refuse to start work above 60% use.
- A session edits Personas only in a worktree; a merge restarts the app and kills workers, so merge
  between wakes and record it in the log.
- The workspace tagged as the last working version is never deleted, and nothing in this skill
  runs a delete against it.
- Evidence over narration: every act's exit is a query, a file, or a process list, quoted in the
  act note.

## Owed to this skill (Act 0 in progress)

`POST /dev-tools/projects/create` and `GET /dev-tools/workspaces` (sim-projects),
`max_active_personas` and the fleet dispatch cap (sim-caps), channel authority and `say`
(sim-channels), workspace-bound charters and `POST /dev-tools/architect/adopt`, the outbound hire,
the Architect recipes under `scripts/templates/_architect/`, the `/uat` scenario file.
