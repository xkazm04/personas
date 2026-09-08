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
 ├─ Project: bank-core (accounts, ledger, payments)   MONEY-PATH · the largest by an order of
 │      magnitude (14 reference services, the ledger alone 27 migrations): hires first and most
 ├─ Project: bank-contracts (contract exchange, e-sign)    designed from parts, no reference model
 ├─ Project: bank-lending (loans, scoring)                 MONEY-PATH
 ├─ Project: bank-invest (investments, portfolios)         designed from scratch, no reference at all
 ├─ Project: bank-edge (API gateway, auth, channels)       consent, SCA, sanctions are money-path
 └─ Project: bank-platform (infra as code, queues, observability, load test,
        AND the gate manifest the other five run: gates.yaml with self-tests)  App Master + roles
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
| 3 Build | every project has a walking skeleton (service, schema, queue, test, container) and every money-path service carries the per-service contract (hexagonal layout with a pure domain, `openapi.yaml`, a first migration, an idempotency key on every write, a transactional outbox, an injected clock, a threat model, domain metrics, a runbook); the platform runs them together with Docker Compose plus Postgres, Kafka, Temporal, Keycloak and OPA | `docker compose ps` green; the Architect's goals moving; the contract certified per service |
| 3b Gates | `bank-platform` ships a `gates.yaml` the other five projects run: at least twelve gates, each with `min_subjects`, `rationale`, `review_after` and a self-test that proves its red state is reachable | the manifest, and one deliberately broken subject turning a gate red |
| 4 Load | the corrected envelope (§5: 100k accounts, 600 payments a minute for 20 minutes, p95 under 1 s, failed requests under 1%, checks 1.0) runs against the composed stack | a load report with the percentiles, the failed-request rate, and the machine's resource ceiling respected |
| 4b Abuse | an abuse-smoke suite per project where every request is invalid by construction and the rejection is the subject: no token and malformed token answer 401/403, a NUL byte answers 400 and never 500, an enumeration sweep never answers 200 | the suite green, and one deliberately weakened route turning it red |
| 5 Reflection | personas have proposed responsibility changes, the Architect has adjusted scope, lessons have reached the registry; each project carries a compliance matrix (regulation to control to artefact) and an ADR index with decision status separate from delivery status | `responsibility_draft` proposals, recipe `LESSONS.md` entries, `/uat` findings drained, the matrices and ADR indexes present |

Acts 3b and 4b, the per-service contract in Act 3 and the matrices in Act 5 come from the
reference digest (§7.2 there); they are what make the build enterprise-grade rather than six
walking skeletons. Act 1's target list also grows: each repository carries a `version.txt`, a
`governance.yaml`-shaped self-declaration (data domain, datastore, classification, retention,
lineage), a per-project `CLAUDE.md`, conventional commits, and a named BIAN Service Domain per
service.

**Roles, as charters.** Architect: solution design, project creation, App Master adoption, goal
setting, channel direction, scope adjustment (workspace-bound). App Master: the six charters of
the first day plus a hiring charter ("ask kp for a role when a responsibility has no holder"), and
from 2026-09-08 the four enterprise-grade charters in `scripts/templates/_app_master/` (service
contract stewardship, gate authorship, threat and evidence on money-path projects only, acceptance
certification). Hired roles: whatever kp composes, adopted through the build session with recipes
from the registry where one fits, and from the ten craft payloads in `scripts/templates/_bank/`
where the work is one of the obligations the reference digest names.

## 3. Gaps (measured, not guessed) and what closes each

| # | Gap | Closes it | Size |
|---|---|---|---|
| G1 | ~~No cross-project persona; App-Master-ness is project-bound~~ **CLOSED** | a **workspace-bound charter** (`persona_responsibilities.workspace_id`, migration `e25_workspace_charters`, mutually exclusive with `project_id` and refused as a pair by `personas_engine::responsibility::validate`); `is_app_master` now reads "holds a project- **or workspace**-bound charter" (`attention.rs`, renamed nothing — the widening is documented on the function); the decision context gains `workspace: Option<WorkspaceView>` (`attention_decide.rs`) carrying every member project with its App Master state, the goals across the portfolio (capped at 30, count always stated) and the active-persona figure, rendered under `YOUR WORKSPACE`; each member project also gets the same per-project snapshot an App Master would get. The door is `POST /dev-tools/architect/adopt` + `adopt_architect` (`architect_adopt.rs`), which shares its whole body with the App Master door through a `Binding::Project \| Binding::Workspace` enum. The five Architect recipes are merged into the seed bundle as owner `architect`. | medium |
| G2 | ~~Personas cannot ask kp for a hire~~ **CLOSED** | outbound **`request_hire`** (`src-tauri/src/engine/kp_hire_request.rs`): resolves the kp base URL from the asking persona's `design_context.kpLink` first and the new `kp_base_url` setting second, reads the credential from the **`KP_AUTOMATION_TOKEN` environment variable** (never a settings row — `app_settings.value` is plain TEXT, which is what the `settings-key-holding-secret` census rule exists to stop growing), checks the G4 active-persona cap BEFORE the network so a full roster costs kp no billed composer call, POSTs through `crate::SHARED_HTTP` with the token in an `x-kp-automation-token` header, and records the outcome in the asking persona's attention ledger (lane `hire`) and the project's `dev_memories` (`hire_request`). Three doors onto one operation: the Tauri command `request_hire_from_kp`, the bridge route `POST /dev-tools/hire`, and the decision plan's `hires` verb (at most 1 per wake, need bounded to 1200 chars, licensed by `spec.canHire` **or** `spec.authority` **or** the `workforce-planning` recipe — an unlicensed plan keeps its dispatches and the drop is counted). kp's half is `POST /api/agents/hire-from-need`, a sequencer over kp's own scan → intake → composer → dispatch, gated by `KP_AUTOMATION_TOKEN` (refused when unset, 503, never open by default). | medium, both repos |
| G3 | A persona's channel message never wakes another persona | arrivals lane accepts `author_kind IN ('user','athena','persona')` when `addressed_to` names the persona or the message carries a **directive** marker; a new `authority` on messages (`directive | note`) written by the Architect's charter and the operator; App Masters answer directives in their decision ("what the channel asked of me") | small |
| G4 | No app-level active-persona cap | setting **`max_active_personas`** (default 10) enforced at `set_persona_enabled`, adoption doors and the kp hire; a refused enable returns the count; the decision context shows "N of 10 personas active" | small |
| G5 | Fleet dispatch spawns one session per idea with no cap | `dev_tools_dispatch_ideas` honours `max_parallel` for the fleet target by queueing tasks and draining them, the same way the runner target does | small, and needed today |
| G6 | No one-step repository + project creation | `POST /dev-tools/projects/create {workspace, name, template}`: `git init` under the dedicated root (`~/.personas/sim/<workspace>/<name>` or an operator path), a README and `.personas/project.json`, then `register_project`, assign to the workspace | small |
| G7 | The kp hire needs a human click | `PERSONAS_HEADLESS_BRIDGE=1` already auto-executes; the simulation runs the app in that mode; the App Master's own ask mechanism keeps the operator informed | config |
| G8 | ~~Hired App Masters are not enrolled in the attention loop (`attention_enabled = false`)~~ **CLOSED** | the hire door sets it, and only when the request body carries `"simulation": true` — `HireOrigin` in `app_master_hire.rs`, applied as an update immediately after `record_hire` rather than as a field on `MandateRecord`, because `attention_enabled` is not something kp knows about or should be able to set. An ORDINARY hire keeps today's operator-confirmed OFF, and both halves of that rule are now asserted by adjacent tests so neither can be changed alone. The same body's `originPersonaId` is recorded in the hired persona's setup notes, so the roster can answer "who asked for this?". kp passes both through as top-level keys (`DispatchPassthrough`), each omitted when it has nothing to say. | small |
| G9 | No banking knowledge in the registry; recipes docs stale | **Partially served from inside Personas as of 2026-09-08**: the fourteen new payloads in `scripts/templates/_bank/` (10) and `scripts/templates/_app_master/` (4) carry the enterprise-grade banking obligations the digest extracted, each grounded in a named gate id or ADR, and they reach a hired role through adoption without the registry lane existing. What that does NOT close is the registry side, which stays the operator's work: there is still no `banking` knowledge bundle, so nothing here is versioned, proposal-governed or reachable by a repo that is not this workspace, and lessons from these charters have nowhere to be promoted to. Still owed: a `banking` bundle seeded from the Architect's design plus kp's Česká spořitelna corpus, and the lane's three declarations corrected to the real recipe count | registry, medium |
| G10 | `/uat` has no scenario object or fixture generator | a **scenario file** in the overlay (`uat/scenarios/*.md`: Characters × Journeys × fixture set × load envelope) and a fixture generator that reads the simulation's own data (accounts, contracts, loans) into `env.md`'s table; findings drain into the projects' backlogs through the write-back route | medium, skill-side |
| G11 | Persona → persona addressing in the decision | the decision plan gains `say: [{to, body, authority}]` so an App Master can answer the Architect and ask a sibling; written through the channel table | small |
| G12 | ~~The runner arm executes in the project's ROOT checkout — a backlog wave dispatched through `dev_tools_start_auto_run` edits the operator's live tree while they are working in it~~ **CLOSED** | `run_task_execution` (`task_executor.rs`) — the one point all three arms (single execute, batch, auto-run) funnel through — resolves an isolated worktree before it spawns, through the **same** `personas_engine::unattended_worktree::prepare_authoring_worktree` the fleet arm already authors with, so there is one branch namespace, one free-slot rule and one dependency borrow for both arms. One worktree per task at `<app_data>/worktrees/<project_id>/<slug>` on `autopilot/<slug>`, reused on a retry via the task row; the exec dir (and with it the CLI's transcript) and the auto-PR push all follow it. A project whose root is not a git work tree still runs, in the root, with the reason logged, emitted to the live panel and written to the row (`worktree_fallback_reason`) — never silently. Migration `e26_runner_task_worktree` adds `worktree_path` / `worktree_branch` / `worktree_fallback_reason` to `dev_tasks`. The worktree is left in place for merge/review; only the existing prune sweep retires it. | small |
| G13 | ~~The Architect's mandate names powers it has no door for: `propose_backlog` from a workspace-bound persona lands NOWHERE (the handler resolves `design_context.devProjectId`, which a workspace binding does not have, so every proposal took the project-less branch while the run reported success), the decision plan has no verb to create a project, adopt an App Master or set a goal, and a design document has no file home — the run's working directory is a scratch dir under the system temp~~ **CLOSED** | **A home pin and three authority verbs.** `design_context.homeProjectId` (`DesignContextData`, `personas_engine::design_context::{pinned,home,working}_project_id`) is the workspace-bound persona's writing surface, deliberately NOT `devProjectId` — that key is what `app_master_of_project` reads as ownership, so reusing it would report the Architect as the platform project's App Master. Set by `POST /dev-tools/architect/adopt`'s new optional `homeProject` (id or name, resolved inside the workspace only, defaulting to its oldest project by `created_at`); read by `propose_backlog` as the fallback (`dispatch.rs`) and used as the **working directory** of a persona that has no codebase pin of its own (`runner/mod.rs`), so a solution design is committed into the platform repository instead of a temp folder. The decision plan gains `createProjects` / `adoptAppMasters` / `goals` (`attention_decide.rs`), licensed by `spec.authority` on any active charter through `may_command` — narrower than `may_hire`, because these write this machine's own portfolio rather than asking kp for anything; an unlicensed plan keeps its dispatches and the drop is counted as `droppedUnlicensedCommands`, exactly as an unlicensed hire is. Executed after the dispatches by `run_plan_projects` / `run_plan_adoptions` / `run_plan_goals` (`attention.rs`) with `run_plan_hires`'s discipline — every outcome data, never a failed wake — capped at 3/3/5 per wake and ledgered under `createdProjects` / `adoptedAppMasters` / `setGoals`. A created project is BOTH a git repository and a registered `dev_projects` row in one step (`project_scaffold::create_in_root`), scaffolded as a sibling of the workspace's existing projects by walking a member's `root_path` back through `<root>/<workspace-slug>/<project>`, so the Architect never names a path; an adoption runs on `claude-opus-5` and honours `enabled` only within the G4 active-persona cap, adopting switched-OFF with `active_persona_cap`'s own refusal text recorded rather than refusing the whole adoption over a slot that can be freed later. | medium |

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
8. **The recipe corpus the roles adopt**, in three seed directories under `scripts/templates/`:
   `_architect/` (5, workspace-bound, amended 2026-09-08 against the reference digest's §8.2),
   `_app_master/` (6 project-bound, four of them new from §8.3: `service-contract-stewardship`,
   `gate-authorship`, `threat-and-evidence` for money-path projects only, `acceptance-certification`)
   and the new `_bank/` (10 craft recipes from §8.4: money-path service certification, gate
   authorship from a recurring defect, regulatory acceptance mapping, threat model for a money path,
   load envelope authorship, abuse-path smoke, service self-declaration and lineage, contract-first
   API stewardship, ADR authorship with split status, governance drift audit). All are `status:
   draft` with no version; each merges into `_recipe_seeds.json` through the same
   `_app_master/merge-into-bundle.mjs --dir <folder> --owner <name>`, idempotent by recipe id.
   **Bundle: 116 recipes before, 130 after.**

## 5. Open decisions for the operator

> **Accepted as proposed, 2026-09-08.** The operator took every item below in its current state
> rather than add to an already complex scenario: the bank lives in `C:\Users\kazda\kiro\bank\`;
> kp's one-call route is the hire path (built); the Architect holds the five Architect recipes on
> day one and may hire; the load envelope is the corrected one; the `/uat` roster is the nine
> Characters in `grand-simulation/uat-scenario.md`. Two further directions from the same message:
> the orchestrating session owns the app process (launches, monitors, restarts it itself, through
> `scripts/e2e/sim-app.mjs`), and every session enters through the `/grande` skill, which prepares
> the environment, reads the Obsidian map and continues from the recorded state. The simulation is
> expected to take many sessions over many days, quality over quantity.

- The dedicated folder for the bank's repositories (proposal: `C:\Users\kazda\kiro\bank\`).
- kp changes: a one-call "compose and dispatch from a need" route is the smallest; is the intake
  dialog (9 messages) worth keeping for realism, or should the App Master's need text go straight
  to compose?
- Which charters the Architect holds on day one, and whether it may also hire.
- The load envelope that stands in for a million users on this machine. ~~Proposal: 1M synthetic
  accounts in the store, 10k payments per minute through the queue for 10 minutes, p95 under
  200 ms at the gateway.~~ **Corrected 2026-09-08 against the reference's only measurement**
  (open-bank-oss `perf/reports/2026-07-10-money-path-write-benchmark.md`: 16.7 req/s, p95 2.25 s
  on an M2 Max with a JDBC pool of 5): 100,000 seeded accounts, 600 payments per minute sustained
  for 20 minutes, p95 under 1 s at the gateway, `http_req_failed` under 0.01, checks rate exactly
  1.0, machine memory under 60%. The million-user figure is stated as arithmetic from the
  measured ceiling, the way the reference states its Tier-A, never as a run. See
  [`grand-simulation/open-bank-reference.md`](grand-simulation/open-bank-reference.md) §7.1.
- The `/uat` Characters for the bank (proposal: nine, in
  [`grand-simulation/uat-scenario.md`](grand-simulation/uat-scenario.md)).

**The reference architecture (operator, 2026-09-08).** The bank is designed against
[JiRaska/open-bank-oss](https://github.com/JiRaska/open-bank-oss): 74 `openbank-*` modules, a
declared money-path subset with stricter rules, ISO 20022 / SEPA / PSD2 / DORA / BIAN mappings, a
per-service `governance.yaml` self-declaration, and 217 governance gates each with a self-test.
The digest that turns it into requirements, per-service contract, agent charters and the act
targets is [`grand-simulation/open-bank-reference.md`](grand-simulation/open-bank-reference.md);
its §8 edits are applied to this plan, the Architect recipes and the `/uat` scenario.

## 6. The `/uat` dimension (G10), proposed shape

> **2026-09-08:** the shape below is now written out in
> [`grand-simulation/uat-scenario.md`](grand-simulation/uat-scenario.md) (seven bank Characters,
> eight journeys, the `scenario.json` object with a proposed load envelope, who runs what inside
> the simulation), and direction 1 is built: `scripts/e2e/sim-uat-fixtures.mjs` reads the live
> database and emits the FIXTURES section for one workspace with provenance per line. The
> `acceptance-certification` charter recipe and the bank overlays themselves wait for the bank
> repositories to exist.

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

- 2026-09-08: **G13 found and closed.** The Architect woke for real, its decision lane dispatched the
  enterprise-solution-design charter, and the run produced a good design that then had nowhere to go:
  its `propose_backlog` calls left `dev_ideas` at zero because a workspace binding carries no
  `devProjectId`, and it declined to create repositories or adopt App Masters at all — in its own
  words, "creating bare repos on disk would produce exactly the orphan class the design exists to
  prevent" — because the only doors it could reach made a folder without a project row. It committed
  the design to `bank-platform/docs/solution-design.md` on a branch by itself. G13 gives it
  `design_context.homeProjectId` (the writing surface and the backlog fallback, kept distinct from the
  ownership pin) and the three authority verbs `createProjects` / `adoptAppMasters` / `goals`, each
  capped per wake, licensed by `spec.authority`, and ledgered like a hire. The `createProjects` prompt
  states in as many words that one step makes both the repository and the registered project, because
  the doubt it removes is the one that actually stopped the live run.
