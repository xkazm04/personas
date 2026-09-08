# The Grand Simulation — plan, gaps, and the headless services it needs

> Started 2026-09-07 (evening), after the App Master's first day
> (`docs/architecture/app-master-e2e.md`). Operator directive, condensed: design a special kind of
> test in which an autonomous organisation of personas builds a fake banking system for one million
> users from scratch, using three systems together: the ai-registry (recipe design and coverage),
> kp (defining requirements for an agentic workforce and hiring it into projects through Personas),
> and Personas (the orchestrator that runs the system of applications, keeps them healthy, and
> lets personas reflect and adjust their own scope). This session designs the plan, names the gaps,
> and prepares the headless services; later sessions execute, through a skill built for it, with
> Obsidian as the progress map.

## 0. The rules as given

1. Goal: a banking application for payments, contract exchange, loans, investments, basic accounts.
2. Start: an empty Workspace; an **Architect** (a cross-project role) designs the enterprise
   solution, creates Personas projects, and assigns an App Master to each.
3. App Masters can ask for more roles through kp: a headless integration where another LLM
   describes the need and composes a job description; Personas turns it into an agent through
   adoption, with new responsibilities or existing recipes. kp itself may be changed for gaps.
4. App Masters can request responsibility adjustments or new responsibilities. The simulation's
   orchestrator (this session's Director, on Fable) may extend Personas in any capacity.
5. The Architect makes sure the solution design is fulfilled: creates Goals, speaks in
   Conversation Channels as an authority; App Masters and other roles listen and reflect the
   channel in their own responsibilities.
6. New repos in a dedicated folder; any open-source tech, Docker, infrastructure-as-code; no paid
   cloud, the bank runs on this machine.
7. "One million users" is the stress-test definition that forces enterprise-grade architecture
   (queues, async integration) and code quality; languages are free (Rust, Python, TypeScript);
   the project should not consume all machine resources.
8. Every agent may run Opus; only the orchestrator stays on Fable.
9. At most 10 active personas at once, app-wide: find the threshold, check it works, apply it.
10. Never delete data Personas considers the "last working version" in the workspace; it becomes a
    close-to-real ecosystem for future agent and responsibility tests.
11. Bring the `/uat` skill into it: fixtures and simulated scenarios as a data dimension, both ways.

## 1. What exists today (measured 2026-09-07; file:line in the scout reports)

**Hiring.** The wire runs kp → Personas only: kp composes a role (`RoleBrief` → `AppMasterSpec`,
`pipeline/jobfit/appmaster.py`; JD build `app/_lib/jd-build-run.ts`) and POSTs
`/api/kp/persona-requests` on the management API (:9420, scope `personas:build`); Personas
queues a `companion_approval` that a human clicks, then a headless one-shot **build session**
mints the persona (`approval_exec_core.rs:868`), and for an `appMaster` block `bind_app_master`
creates/finds the project (root path must exist), team, KPIs, triggers, mandate charter, memory
(`app_master_hire.rs:1115`). With `PERSONAS_HEADLESS_BRIDGE=1` the request executes immediately
(`management_api.rs:3126`). The only outbound call is the report push
(`kp_reporter.rs:355`). **Personas cannot ask kp for a hire.** kp's own bench driver already runs
the whole hire unattended (`scripts/app-master-bench/run.mjs`: pair → scan → intake → 9-message
dialog → compose → dispatch → activate → seed → nights → probation) and ships a mock Personas
bridge for tests.

**Channels.** One table, `team_channel_messages` (`author_kind` user | persona | athena | slack,
`addressed_to` JSON of persona ids, `consumer` inject | display). A persona hears a channel only
in two ways: injected at a team-assignment step boundary (`list_injectable_for_persona`), or the
attention loop's arrivals lane, which reads **`author_kind = 'user'` only**
(`team_channel.rs:448`). No rank or authority field; the nearest is `author_kind` and the team
role CHECK `orchestrator | worker | reviewer | router`. The MCP `post_message` tool writes
`persona_reports`, not a channel.

**Goals.** `dev_goals` per project with sub-goals, items, signals, dependencies, a KPI soft link;
headless routes `POST /api/dev/milestones/{id}/goals` and `POST /api/dev/goals/{id}`; advanced by
`goal_advance.rs` into a goal-linked team assignment on the project's team, gated by
`Action::GoalAdvancement` (default off) with a 2-hour per-goal cooldown and 3 per tick.

**Workspaces and roles.** `dev_workspaces` with `dev_projects.workspace_id`; workspace knowledge,
practices, harvest; cross-project reads (`portfolio.rs`, `cross_project.rs`). ~~**Every persona
binds to at most one project**; App-Master-ness is defined as holding a project-bound charter.
No cross-project persona exists.~~ **Superseded by G1 (below), which closed it:** a charter now
binds to a project OR a workspace, and the Architect is the first cross-project persona. The
sentence above is the state measured 2026-09-07 and is kept because §3's gap table is written
against it.

**Caps.** No `max_active_personas` anywhere. Enforced: `max_parallel_executions` (default 10,
1..20, hot-applied, over the cap queues) and per-persona `max_concurrent`. Soft, in memory:
fleet `live_slots` (evicts idle sessions only). `MAX_PERSONAS = 200` is bundle-import validation.
Since the first day: App Master fleet workers count against the persona's `max_concurrent`
(cycle 9). Today's dispatch route `dev_tools_dispatch_ideas(..., target = "fleet")` spawns one
session per idea with no cap at all: 51 ideas became 51 concurrent Claude Code processes and
had to be killed back to two per project by hand.

**Project creation.** `POST /dev-tools/projects {name, root_path}` registers an existing
directory (idempotent, marker-healed, one team per project). Nothing creates a repository and a
project in one step; `git init` appears only in test fixtures and in the web-build scaffold,
which is not wired to registration.

**Registry.** The recipes lane holds 113 recipes across 10 domains (41 software engineering,
8 finance: investing, SaaS revenue, cloud cost, none retail banking); its three prose declarations
still say "one worked example, declared ahead of its corpus". There is no banking, finance or
fintech knowledge bundle; `recruiting` and `software-engineering` are the bundles a bank build
consumes. 29 skills; `consult`, `conform`, `project-populate`, `uat`, `tiger`, `kpi-sim`,
`value-ledger`, `i18n-translate`, `ship-loop`, `mvp` are the load-bearing ones.

**`/uat`.** Evaluative testing by Characters (never "personas") × Journeys, L1 theoretical over a
code-derived surface model then L2 empirical in a browser, a finding schema with impact-derived
severity, verdicts as exit codes. Fixtures are the per-app preconditions enumerated in
`uat/env.md` with the rule "distinct, realistic data per Character, a clone is untestable";
there is no scenario object and no fixture generator: the hooks are the `env.md` fixture table,
the shared grounding denominators, the Character surface binding, and the driver's `api.*`.
kp's own close-out names the dimension that is missing: value ledger never measured, C1 untested
because all work was seeded, no journey lane, "kp's /uat apparatus is unconnected".

## 2. The shape of the simulation

```
Workspace "Bank"  (dev_workspaces)                      last working version is never deleted
 ├─ Architect (cross-project persona, workspace-bound charters)
 │    designs the solution → creates projects (repo + registration in one step)
 │    → adopts an App Master per project → sets Goals → speaks in the workspace channel
 ├─ Project: bank-core (accounts, ledger, payments)        App Master + hired roles
 ├─ Project: bank-contracts (contract exchange, e-sign)    App Master + hired roles
 ├─ Project: bank-lending (loans, scoring)                 App Master + hired roles
 ├─ Project: bank-invest (investments, portfolios)         App Master + hired roles
 ├─ Project: bank-edge (API gateway, auth, channels)       App Master + hired roles
 └─ Project: bank-platform (infra as code, queues, observability, load test)  App Master + roles
kp (the hiring product): composes roles from a need + the repo dossier, dispatches persona requests
ai-registry: recipes the roles adopt; a new banking knowledge bundle; lessons flow back
/uat: Characters (a retail customer, a teller, a compliance officer, a fraud analyst, an SRE)
       × Journeys, with fixtures generated from the simulation's own data
```

**Acts.** The simulation runs in acts that each end in a measurable state, so a later session
can resume from any act:

| Act | Ends when | Measured by |
|---|---|---|
| 0 Foundation | the headless services in §4 exist and are proven by a dry run on a throwaway workspace | the gap list below, each with a test |
| 1 Architect | an empty workspace holds a solution design, the six projects with repositories, one App Master each, workspace goals, and the first channel directive | `GET /dev-tools/app-master/{project}` for six projects; the design doc in `bank-platform` |
| 2 Hiring | each App Master has asked kp for at least one role and the role runs as a persona with a charter | `hired_agents` in kp, personas with `kpLink` in Personas |
| 3 Build | every project has a walking skeleton (service, schema, queue, test, container), the platform runs them together with Docker Compose | `docker compose ps` green; the Architect's goals moving |
| 4 Load | a load test at a scale that stands in for a million users (synthetic accounts, payment bursts through the queues) with a stated envelope | a load report with p95 latencies and the machine's resource ceiling respected |
| 5 Reflection | personas have proposed responsibility changes, the Architect has adjusted scope, lessons have reached the registry | `responsibility_draft` proposals, recipe `LESSONS.md` entries, `/uat` findings drained |

**Roles, as charters.** Architect: solution design, project creation, App Master adoption, goal
setting, channel direction, scope adjustment (workspace-bound). App Master: the six charters of
the first day plus a hiring charter ("ask kp for a role when a responsibility has no holder").
Hired roles: whatever kp composes, adopted through the build session with recipes from the
registry where one fits.

## 3. Gaps (measured, not guessed) and what closes each

| # | Gap | Closes it | Size |
|---|---|---|---|
| G1 | ~~No cross-project persona; App-Master-ness is project-bound~~ **CLOSED** | a **workspace-bound charter** (`persona_responsibilities.workspace_id`, migration `e25_workspace_charters`, mutually exclusive with `project_id` and refused as a pair by `personas_engine::responsibility::validate`); `is_app_master` now reads "holds a project- **or workspace**-bound charter" (`attention.rs`, renamed nothing — the widening is documented on the function); the decision context gains `workspace: Option<WorkspaceView>` (`attention_decide.rs`) carrying every member project with its App Master state, the goals across the portfolio (capped at 30, count always stated) and the active-persona figure, rendered under `YOUR WORKSPACE`; each member project also gets the same per-project snapshot an App Master would get. The door is `POST /dev-tools/architect/adopt` + `adopt_architect` (`architect_adopt.rs`), which shares its whole body with the App Master door through a `Binding::Project \| Binding::Workspace` enum. The five Architect recipes are merged into the seed bundle as owner `architect`. | medium |
| G2 | Personas cannot ask kp for a hire | outbound **`request_hire`**: a bridge route and command that calls kp's intake (`POST /api/intake`, `/message`, `/compose-app-master` or the JD build) with a need text, and a kp route that composes and dispatches a persona request in one call for a headless caller; kp's bench driver already does the sequence | medium, both repos |
| G3 | A persona's channel message never wakes another persona | arrivals lane accepts `author_kind IN ('user','athena','persona')` when `addressed_to` names the persona or the message carries a **directive** marker; a new `authority` on messages (`directive | note`) written by the Architect's charter and the operator; App Masters answer directives in their decision ("what the channel asked of me") | small |
| G4 | No app-level active-persona cap | setting **`max_active_personas`** (default 10) enforced at `set_persona_enabled`, adoption doors and the kp hire; a refused enable returns the count; the decision context shows "N of 10 personas active" | small |
| G5 | Fleet dispatch spawns one session per idea with no cap | `dev_tools_dispatch_ideas` honours `max_parallel` for the fleet target by queueing tasks and draining them, the same way the runner target does | small, and needed today |
| G6 | No one-step repository + project creation | `POST /dev-tools/projects/create {workspace, name, template}`: `git init` under the dedicated root (`~/.personas/sim/<workspace>/<name>` or an operator path), a README and `.personas/project.json`, then `register_project`, assign to the workspace | small |
| G7 | The kp hire needs a human click | `PERSONAS_HEADLESS_BRIDGE=1` already auto-executes; the simulation runs the app in that mode; the App Master's own ask mechanism keeps the operator informed | config |
| G8 | Hired App Masters are not enrolled in the attention loop (`attention_enabled = false`) | the adoption/hire door sets it for the simulation, or the Architect's adoption call does | small |
| G9 | No banking knowledge in the registry; recipes docs stale | a `banking` bundle seeded from the Architect's design plus kp's Česká spořitelna corpus; the lane's three declarations corrected to the 113-recipe reality | registry, medium |
| G10 | `/uat` has no scenario object or fixture generator | a **scenario file** in the overlay (`uat/scenarios/*.md`: Characters × Journeys × fixture set × load envelope) and a fixture generator that reads the simulation's own data (accounts, contracts, loans) into `env.md`'s table; findings drain into the projects' backlogs through the write-back route | medium, skill-side |
| G11 | Persona → persona addressing in the decision | the decision plan gains `say: [{to, body, authority}]` so an App Master can answer the Architect and ask a sibling; written through the channel table | small |
| G12 | ~~The runner arm executes in the project's ROOT checkout — a backlog wave dispatched through `dev_tools_start_auto_run` edits the operator's live tree while they are working in it~~ **CLOSED** | `run_task_execution` (`task_executor.rs`) — the one point all three arms (single execute, batch, auto-run) funnel through — resolves an isolated worktree before it spawns, through the **same** `personas_engine::unattended_worktree::prepare_authoring_worktree` the fleet arm already authors with, so there is one branch namespace, one free-slot rule and one dependency borrow for both arms. One worktree per task at `<app_data>/worktrees/<project_id>/<slug>` on `autopilot/<slug>`, reused on a retry via the task row; the exec dir (and with it the CLI's transcript) and the auto-PR push all follow it. A project whose root is not a git work tree still runs, in the root, with the reason logged, emitted to the live panel and written to the row (`worktree_fallback_reason`) — never silently. Migration `e26_runner_task_worktree` adds `worktree_path` / `worktree_branch` / `worktree_fallback_reason` to `dev_tasks`. The worktree is left in place for merge/review; only the existing prune sweep retires it. | small |

## 4. Headless services to prepare first (Act 0)

1. **Workspace and project creation route** (G6) with the dedicated root and the never-delete rule
   encoded as a refusal in every delete path that meets a project tagged `last_working_version`.
2. **Active-persona cap** (G4) and **fleet dispatch cap** (G5).
3. ~~**Workspace-bound charters and the Architect adoption door** (G1)~~ **DONE**:
   `POST /dev-tools/architect/adopt {workspace, recipes[], model?, maxConcurrent?, scopeRung?,
   enabled?, name?}` and `GET /dev-tools/architect/{workspace}`. It does not merely *mirror* the App
   Master door — it IS that door, generalised over what the persona binds to, so the two cannot
   drift in their idempotency key, their partial-success reporting or their manifest law. The
   Architect's charters carry `spec.authority = true`, and `workforce-planning` additionally carries
   `spec.canHire = true`. **One follow-up is deliberately left open:** the workspace view reports the
   active-persona ceiling from a compiled-in constant, because G4's `max_active_personas` setting
   did not exist on this branch and declaring the key locally is the shadow-key defect the census
   rule `settings-key-declared-outside-registry` refuses. Once G4 lands, `active_persona_cap`
   (`attention.rs`) becomes a one-line read of `settings_keys::MAX_ACTIVE_PERSONAS`.
4. **Channel authority and persona wake** (G3, G11).
5. **Outbound hire** (G2): Personas side first with kp's existing routes; then the one-call kp route.
6. **Simulation switches**: headless bridge on, Opus for all agents, cap 10, autopilot `full` for
   the six projects with triage rules that auto-accept low-risk items (the first day's ceiling).
7. **The skill** `/grand-sim` with acts as modes (`design | hire | build | load | reflect | status`),
   state under `.claude/grand-sim/`, and an Obsidian folder `Grand Simulation/` for the map.

## 5. Open decisions for the operator

- The dedicated folder for the bank's repositories (proposal: `C:\Users\kazda\kiro\bank\`).
- kp changes: a one-call "compose and dispatch from a need" route is the smallest; is the intake
  dialog (9 messages) worth keeping for realism, or should the App Master's need text go straight
  to compose?
- Which charters the Architect holds on day one, and whether it may also hire.
- The load envelope that stands in for a million users on this machine (proposal: 1M synthetic
  accounts in the store, 10k payments per minute through the queue for 10 minutes, p95 under
  200 ms at the gateway, memory under 60% of the machine).
- The `/uat` Characters for the bank (proposal: five, above).

## 6. The `/uat` dimension (G10), proposed shape

`/uat` evaluates by Characters × Journeys over a code-derived surface model (L1) and a live
browser (L2); its fixtures are the per-app preconditions in `uat/env.md`, with the rule that a
Character without distinct, realistic data is untestable. The simulation gives it what it lacks:
data with provenance. Two additions, both in the overlay first and promoted to the registry skill
when they have earned it:

- **A scenario file** `uat/scenarios/<slug>.md` binding Characters × Journeys to a fixture set
  and a load envelope: `characters: [retail-customer, teller, compliance-officer, fraud-analyst,
  sre]`, `journeys: [...]`, `fixtures: {source: simulation, accounts: 1000, contracts: 200, loans:
  50, snapshot: <workspace last-working-version tag>}`, `load: {accounts: 1_000_000, payments_per_min:
  10_000, minutes: 10, p95_ms: 200, memory_ceiling: 0.6}`. A scenario is a Journey set with a data
  contract; it does not change the finding schema.
- **A fixture generator** `uat/driver/fixtures-from-sim.mjs` that reads the simulation's own data
  (accounts, contracts, loans, investments from the bank's services through their APIs, never
  invented) into the `env.md` fixture table with provenance per row, honouring the skill's residue
  rule (every row the run wrote is recorded as written by the run). The grounding denominators
  gain the bank's sources (ledger, contract store, loan book, portfolio, gateway logs).
- **The other direction**: `/uat` findings drain into the projects' backlogs through the write-back
  route, so the App Masters deliver them; a finding with `type: trust` becomes an ask to the
  Architect.

## 7. Session log

- 2026-09-07 evening: plan written; 51 low-risk backlog items approved and dispatched (the fleet
  dispatch ignored its cap, throttled by hand, drained at two per project); scouts settled §1;
  Act-0 builders dispatched for G4+G5, G6, G3+G11, G2 (both repos), G1 (with the Architect
  recipes merged into the bundle); the five Architect recipes drafted (`24bb2f7be`); the
  `/grand-sim` skill skeleton (`6443930c1`); vault map and session note. Owed by the operator:
  the location of the prepared ticket section syntax; the five open decisions in §5.

- 2026-09-08 morning: caps (G4, G5) and one-step project creation with the never-delete tag (G6)
  merged (`47cf93ed6`, `232fbffde`); both builders also repaired the app crate's test binary,
  broken at the base by two files outside this arc. The five builders had been killed overnight
  by the tool watchdog (five cargo jobs on one target); resumed one at a time. The dev app exited
  cleanly twice during the operator's working hours; not relaunched without their word. G12 found.
  **G12 closed the same day**: the runner arm now resolves an isolated `autopilot/<slug>` worktree in
  `run_task_execution` — the chokepoint all three arms share — reusing the fleet arm's
  `prepare_authoring_worktree` rather than growing a second helper, with the exec dir, the CLI's
  transcript and the auto-PR push following it, a never-silent fallback for a non-repository root,
  and `e26_runner_task_worktree` recording path + branch + fallback reason on the task row.
