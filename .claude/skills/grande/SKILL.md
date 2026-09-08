---
name: grande
description: The Grand Simulation - an autonomous organisation of personas builds a fake bank for one million users from scratch, on this machine, across many sessions. The orchestrating session enters here, prepares the environment, runs the app itself, reads its Obsidian memory and starts or continues from the recorded act. Modes start | status | act0 | design | hire | build | load | reflect | end.
version: 0.3.0
---

# /grande — the Grand Simulation

> The plan, the measured gaps, the services and the reference architecture are in
> `docs/architecture/grand-simulation.md` and `docs/architecture/grand-simulation/`. This skill is
> the operating procedure a session follows; it does not restate the plan.

## Why this test matters (read every session)

The operator's words, 2026-09-08: this simulation exists to break through in three areas that
nobody has solved properly, and any effort it takes is worth spending:

1. **Hiring AI agents and adopting them in companies.** A need becomes a role, a role becomes a
   working persona with a charter, without a human composing either.
2. **Letting AI agents autonomously develop and care about their projects**, with the human
   serving only as a CEO-level manager who counsels their decisions rather than making them.
3. **Orchestrating dozens of projects and agents without an overhaul**: the same mechanisms that
   run one project must run thirty, and the operator must be able to read the whole at a glance.

Every act, every gap fixed and every lesson filed is measured against these three. When a choice
arises between finishing an act quickly and learning something true about one of the three, the
learning wins: this runs over many days and many sessions, quality over quantity.

Rules that never bend: no paid cloud; the bank runs on this machine; at most 10 active personas
app-wide; every agent may run Opus, the orchestrator stays on Fable; the workspace's last working
version is never deleted; the machine keeps headroom (stop dispatching at 60% memory). The
operator's decisions on the plan's section 5 are accepted as proposed and are not reopened.

## Roles

- **Orchestrator (this session).** Owns the environment and the app process, runs the acts, reads
  the evidence, extends Personas or kp when the simulation needs it, never writes application code
  for the bank, and brings the operator only CEO-level decisions.
- **Architect (a persona, workspace-bound).** Designs the solution, creates projects, adopts App
  Masters, sets goals, speaks in the channel as an authority, asks kp for roles, adjusts scope.
- **App Masters (one persona per project).** The first day's charters plus the four charters in
  `scripts/templates/_app_master/` (service-contract-stewardship, gate-authorship,
  threat-and-evidence on money-path projects, acceptance-certification). They decide, dispatch,
  file, measure, ask.
- **Hired roles.** Composed by kp from a need, adopted through the build session, enrolled in the
  attention loop on arrival.

## State

```
.claude/grande/
  state.json          # { workspace, act, projects[], personas[], lastSession, decisions[] }
  acts/<n>-<slug>.md  # per act: entry criteria, what ran, evidence, exit criteria met?
  log.jsonl           # append-only: {at, act, event, evidence}
  app.json, app.log   # the app instance this session launched
```
`.claude/grande/` is gitignored by the repo's `.claude/*` rule: it is this machine's local state,
like the decision ledger. The vault and the committed act notes in the plan are what other
sessions read.
The Obsidian vault is the memory people and later sessions read: `Grand Simulation/Grand
Simulation.md` (the map: acts, checklist, decisions, open questions) and one note per session
`Grand Simulation/<date> <slug>.md`. Re-read the map before every write; never overwrite a note
this session did not create.

## `start` (every session begins here)

1. **Recall.** Read the vault map, the most recent session note, `.claude/grande/state.json`,
   and the auto-memory entry for the simulation. Say in one paragraph which act is current, what
   the last session left open, and what this session intends. Never re-derive what the map says.
2. **Environment.** `git status` on the Personas checkout (classify foreign work; touch none of
   it); `git log --oneline -5` to see what siblings merged; memory headroom under 60%. kp must be
   running for Act 2 onwards (`npm run dev` in `C:\Users\kazda\kiro\kp`). The shared secret
   `KP_AUTOMATION_TOKEN` lives in `~/.personas/grande.env.json` (generated once, 2026-09-08) and in
   kp's `.env.local`; `sim-app.mjs up` reads it from there, so an app launched before the file
   existed must be restarted (`down`, then `up`). The bank repositories live under
   `C:\Users\kazda\kiro\bank\`.
3. **The app.** `node scripts/e2e/sim-app.mjs up`: reuses a healthy instance, otherwise launches
   `npm run tauri:dev:test` detached with `PERSONAS_HEADLESS_BRIDGE=1`, waits for
   `:17320/health` and the dev-tools handshake, records the pid. The orchestrator owns this
   process for the whole session: it reads `app.log` when something is odd, restarts after a
   merge (`down`, then `up`), and never asks the operator to launch or close it.
4. **`status`** (below), then continue with the current act's mode.

## `end` (every session ends here)

Append the act note and `log.jsonl`; write the session note in the vault with a `next:` line;
update the map's checklist and decisions; update auto-memory; commit Personas work with the
isolated-index ritual and never push. Leave the app running when personas are mid-cycle (their
wakes continue), stop it with `sim-app.mjs down` when the machine is needed for something else,
and say which in the note.

## Modes

Every mode starts with `status` and ends by appending to `log.jsonl` and the session note.

### `status`
Read `state.json`, the ledger (`GET /dev-tools/app-master/{project}` per project, `GET
/dev-tools/workspaces`, `GET /dev-tools/architect/{workspace}`), the fleet (`fleet_sessions`
running), the active-persona count against the cap, and the open asks in Approvals. Print one
table: act, projects with their App Master's last note and next wake, open asks, active personas
/ cap, queued and running tasks, memory headroom. Nothing else.

### `act0` (Act 0 exit)
Entry: the app is up with the test-automation server and the dev-tools handshake exists. Steps:
run `node scripts/e2e/sim-act0-dryrun.mjs` (throwaway workspace + project with a repository,
protect, adopt an App Master and the Architect, switches, enable within the cap) and read every
line: each door must answer, the workspace must list as protected, and the enable must land inside
the cap. Then `node scripts/e2e/sim-uat-fixtures.mjs --workspace <the throwaway>` must print the
fixture section with the Architect and the App Master present. Exit: both scripts green, quoted
in the act note. The throwaway workspace stays (it is protected by design); disable its two
personas.

### `design` (Act 1)
Entry: `act0` passed. Steps: switch the simulation settings on with
`node scripts/e2e/sim-switches.mjs --projects <names>` (attention loop, cap 10, autopilot `full`,
the risk-below-3 triage rule per project); create the workspace "Bank" and protect it
(`POST /dev-tools/projects/create` creates both, `POST /dev-tools/workspaces/{id}/protect` tags
it); adopt the Architect (`POST /dev-tools/architect/adopt`) with the five Architect recipes;
enable it; observe until it has written the solution design, created the projects with their
self-declarations, adopted an App Master each, set goals and posted the first directive. Exit:
six projects registered under `C:\Users\kazda\kiro\bank\`, six App Masters adopted, a design
document in the platform project naming bounded contexts, money-path services and a BIAN Service
Domain per service, one directive in the channel. Evidence: the ledger rows, the repositories,
the design file.

### `hire` (Act 2)
Entry: at least one App Master ask of kind `unblock` or a `workforce-planning` decision naming a
role. Steps: let the Architect's workforce charter request the hire (the plan's `hires` verb,
`POST /dev-tools/hire`), watch kp compose and dispatch (`POST /api/agents/hire-from-need`), watch
Personas mint the persona through the build session and enrol it, confirm it holds a charter and
is enabled within the cap. `bank-invest` hires first: it has no reference to copy. Exit: each
project has at least one hired role running.

### `build` (Act 3, with 3b Gates)
Entry: hired roles present. Steps: observe wakes; keep the machine within headroom (the fleet
dispatch cap, the active-persona cap); merge nothing yourself; answer asks that are the
operator's only if the operator has delegated them in `decisions[]`; when a defect recurs, expect
a gate, not a note. Exit: every project has a walking skeleton and every money-path service
carries the per-service contract (plan §2, Act 3); `docker compose ps` is green from the platform
project; `bank-platform` ships a `gates.yaml` the other five run, each gate with a self-test that
proves red is reachable.

### `load` (Act 4, with 4b Abuse)
Entry: the skeleton runs together. Steps: the platform App Master's load charter runs the
accepted envelope (100k accounts, 600 payments a minute for 20 minutes, p95 under 1 s, failed
requests under 1%, checks 1.0); the orchestrator watches memory and CPU and stops the run at the
ceiling; then the abuse-smoke suite per project, where the rejection is the subject. Exit: a load
report with the percentiles and the failed-request rate, the ceiling respected, the abuse suites
green with one deliberately weakened route turning one red.

### `reflect` (Act 5)
Entry: any act's evidence. Steps: read the responsibility proposals, the lessons filed, the `/uat`
drains per repository; let the Architect's scope-reflection charter decide (a charter, the design,
a gate, or nothing); promote lessons that generalise to the registry (`recipes/<domain>/<topic>/
<slug>/LESSONS.md`, version bump by PR). Exit: every proposal decided with a reason; lessons
landed; a compliance matrix and an ADR index per project.

## Guardrails the orchestrator enforces itself

- Before any dispatch, read memory headroom; refuse to start work above 60% use.
- A session edits Personas only in a worktree; a merge restarts the app and kills workers, so merge
  between wakes, restart with `sim-app.mjs`, and record it in the log.
- The workspace tagged as the last working version is never deleted, and nothing in this skill
  runs a delete against it.
- Evidence over narration: every act's exit is a query, a file, or a process list, quoted in the
  act note.
- At most two Rust builders compile at once against the shared cargo target, and every cargo
  invocation stays under eight minutes (five at once were all killed by the tool watchdog on
  2026-09-07). Resume, never restart, a killed builder: its worktree holds its work.
- Bring the operator decisions, not chores: what a CEO would be asked (scope, money, risk, a
  conflict between two Characters), never a relaunch, a merge or a triage click.

## Act 0 ledger (2026-09-08)

Merged on master: `POST /dev-tools/projects/create`, `GET /dev-tools/workspaces`, the protect
tag (`232fbffde`); `max_active_personas` and the fleet dispatch cap (`47cf93ed6`); channel
authority, persona-to-persona wake and `say` (`b30fa597c`); workspace-bound charters, the
Architect door and the five Architect recipes (`9071b88ed`); runner worktree isolation
(`2c49c3c6b`); the outbound hire and hired-role enrolment (`b01cf4bff`); the open-bank-oss
reference digest applied to the plan and `/uat` (`b1248b1d9`); the reference-derived recipes,
bundle 116 to 130 (`8af6e51fe`); the switches, dry-run and fixture scripts. kp's hire route is
on its `spark/intake-studio` branch. Still owed: the registry's own banking knowledge bundle
(the operator's registry work), the first `act0` run, and the auto-run wave checkpoints that
still snapshot the project root.
