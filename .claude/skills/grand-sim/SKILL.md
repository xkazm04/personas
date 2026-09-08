---
name: grand-sim
description: The Grand Simulation - an autonomous organisation of personas builds a fake banking system for one million users from scratch, on this machine, across sessions. Modes status | act0 | design | hire | build | load | reflect. State in .claude/grand-sim/, the map in the Obsidian vault.
version: 0.2.0
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

### `act0` (Act 0 exit)
Entry: the app is up with the test-automation server (`npm run tauri:dev:test`, with
`PERSONAS_HEADLESS_BRIDGE=1` in its environment) and the dev-tools handshake exists. Steps: run
`node scripts/e2e/sim-act0-dryrun.mjs` (throwaway workspace + project with a repository, protect,
adopt an App Master and the Architect, switches, enable within the cap) and read every line: each
door must answer, the workspace must list as protected, and the enable must land inside the cap.
Then `node scripts/e2e/sim-uat-fixtures.mjs --workspace <the throwaway>` must print the fixture
section with the Architect and the App Master present. Exit: both scripts green, quoted in the act
note. The throwaway workspace stays (it is protected by design); disable its two personas.

### `design` (Act 1)
Entry: `act0` passed. Steps: switch the simulation settings on with
`node scripts/e2e/sim-switches.mjs --projects <names>` (attention loop, cap 10, autopilot `full`,
the risk-below-3 triage rule per project; the headless kp bridge is an environment variable of
the app process); create the workspace and protect it (`POST /dev-tools/projects/create` creates
both, `POST /dev-tools/workspaces/{id}/protect` tags it); adopt the Architect
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
- At most two Rust builders compile at once against the shared cargo target, and every cargo
  invocation stays under eight minutes; five at once each blocked on the lock past the tool
  watchdog's ten-minute limit and all five were killed mid-run (2026-09-07). Resume, never
  restart, a killed builder: its worktree holds its work.

## Act 0 ledger (2026-09-08)

Merged on master: `POST /dev-tools/projects/create`, `GET /dev-tools/workspaces`, the protect
tag (`232fbffde`); `max_active_personas` and the fleet dispatch cap (`47cf93ed6`); channel
authority, persona-to-persona wake and `say` (`b30fa597c`); workspace-bound charters, the
Architect door and the five Architect recipes in the bundle (`9071b88ed`); the switches script
(`a5319790a`), the dry-run driver (`c0cc02df3`), the `/uat` shape and fixture generator
(`f00f23623`). Still owed: the outbound hire and hired-role enrolment (G2, G8), runner worktree
isolation (G12), the `acceptance-certification` recipe (needs the bank repositories), the
registry's banking bundle (G9, the operator's registry work), and the first `act0` run.
