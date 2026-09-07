# App Master e2e cycles — the arc record

> Started 2026-09-07. Operator directive (near-verbatim in the decision ledger): the recipe
> corpus is a starting line, not a library; usefulness is proven by long-running e2e cycles of
> an autonomous App Master over three real projects. This file is the running record: what was
> measured, what was decided, what each cycle changed. Sections are appended, never rewritten.

## 0. The directive, condensed

1. Every recipe: no version, status `draft`. Templates and presets stay as they are and are
   ignored for now.
2. Headless adoption first; UI follows once the process settles.
3. App Master = one persona per project, for CandiDate (`C:\Users\kazda\kiro\kp`), ascent and
   personas-web, combining: `codebase-architecture-review`, `codebase-security-scan`,
   `codebase-static-analysis-sweep`, `technical-decision-capture`, plus two recipes that do not
   exist yet: development itself (accepted idea to main/master: execution, checklist validation,
   tests, post-development) and project KPI stewardship (context coverage, identifying needs
   and populating the backlog, executing and back-measuring).
4. No connector parametrization: Claude Code CLI native tools, the Codebase connector for the
   local repo, the operator's own authenticated GitHub login for shipping.
5. Three trigger kinds: time (periodic), event, none (the persona decides each wake and
   memorizes coverage of cycle-based work). Each responsibility carries an optional priority;
   when empty the App Master decides.
6. Execution = the persona switched on or off. On start it reconciles its responsibilities and
   decides what needs doing (pending accepted ideas, empty backlog, scans never run, coverage
   gaps). Max parallel sessions: 2 per project, so 6 workers + 3 App Masters during the test.
7. Director duties: resolve the task list, run cycles and improve everything each cycle, run
   overnight in a 5-hour loop or until the limit; development and App Master executions on Opus.

## 1. What exists (measured 2026-09-07, file:line in the scout reports)

**App Master is already a runtime role, not a template.** `src-tauri/engine/src/app_master.rs`
holds the mandate law: scope rungs `READ=0 / RETRY=1 / BRANCH=2` (`MAX_GRANTABLE_RUNG = 2`;
deploy/merge and gate edits are never grantable) and the closed `ForbiddenClass` vocabulary
scanned deterministically over every diff. The hire flow
(`src-tauri/src/commands/companion/approvals/app_master_hire.rs`) mints the persona bound to a
`DevProject`, seeds objectives as `dev_kpis`, installs cadence triggers, persists the mandate as
a `persona_responsibilities` charter, and puts the project on `suggest` autopilot (probation).
It is driven by a kp approval payload, not by a script. The live database already holds one
product of it: persona "KP Gate Steward" with an empty "App master for CandiDate" charter
(`cadence {"attentionEnabled":false}`, no procedure, spec `{}`).

**The living-agent attention loop is all admission and no decision.**
`src-tauri/src/engine/subscription/attention.rs`: OFF by default (`autonomous_attention_loop`,
requires rung 2), ticks every 300 s, five-step admission ladder (in-flight, interval floor,
quiet hours, daily cap, budget), then ONE lane per tick by fixed priority
`arrivals > maintenance > improve > advance`, ONE dispatch per tick globally. The charter pick
for `advance` is least-recently-advanced from the ledger. `self_paced` is honored exactly once,
at adoption (`template_adopt.rs:2709`, sets `cadence.attentionEnabled`). No priority field
anywhere on a charter; no start hook when `personas.enabled` flips; no per-charter coverage or
debt state (only `persona_attention_ledger` + `persona_episodes.responsibility_id`).

**Triggers.** `persona_triggers.responsibility_id` exists (e19) but the fire path never reads
it: the scheduler publishes an event carrying `use_case_id` only (`scheduler.rs:1307-1317`).
`execute_persona(persona_id, trigger_id?, input_data?, use_case_id?, …)` already resolves a
charter id passed as `use_case_id` (`executions.rs:289-312`).

**Parallelism machinery exists and is unused by the loop.** `ConcurrencyTracker` with
`personas.max_concurrent` (default 1) and global `max_parallel_executions` (default 10);
`unattended::dispatch_capacity(live_slot_cap, live_sessions, want)` with
`MAX_DISPATCH_PER_PROJECT_PER_NIGHT = 3`; every unattended session authors in its own
`git worktree` on `autopilot/<slug>` with the finish-never-ask guardrails.

**Model.** Resolution chain: charter `spec.modelOverride` (slug `opus` maps to
`claude-opus-4-8`) > `persona.model_profile` > default sonnet. The fleet PTY path pushes no
`--model` and rides the account default.

**Accepted ideas.** `dev_ideas.status` `pending -> accepted | rejected`; the single verdict door
is `apply_idea_verdict_cas`. "An accepted idea becomes a row and NOTHING ELSE HAPPENS"
(`useAcceptedDispatch.ts:6`). The sensor for forgotten accepted ideas exists
(`undispatched_ideas_rows`, `dev_tools_undispatched_ideas`); the only autonomous dispatcher
is the Overnight Portfolio Engine (15-min tick inside 22:00-06:00, once per night, `full`
autopilot only, budget governor, `dispatch_ideas_core`). `dev_ideas.priority` is written only
by the Strategist's rank action and never orders dispatch (FIFO by `created_at`).

**Live state of the three targets** (read-only, `%APPDATA%/com.personas.desktop/personas.db`):
CandiDate 5 accepted / 41 pending / 62 archived ideas, 3 milestones; ascent 7 accepted,
4 milestones; personas-web 0 ideas, 0 milestones. 1,203 KPIs across projects, 7 measurements.

**"Plans management" on origin main.** Three disjoint mechanisms, none reading Claude Code plan
files: Claude subscription plan slots (`claude_accounts`, auto-rotate picks the coolest login
under 80% on both windows), the Overnight engine above, and Athena's `companion_night_plan`.
Working assumption: "plans" = subscription capacity, and responsibility priorities decide who
gets scarce capacity. To confirm with the operator; nothing in cycle 1 depends on it.

**Recipe coverage of the two missing recipes.** Development: nine recipes cover the arc as nine
hand-offs across five templates; nothing owns an item's identity from accepted to merged, nothing
re-validates an accepted item before building, nothing verifies post-merge that the change did
what the idea claimed. KPI stewardship: nothing at all; the measurable vocabulary the app already
computes is context/group count and scan age, use-case count + proposed, active KPIs + proposed,
contexts with zero active KPI (the coverage gap), KPI attainment % (min across a context), lane
freshness verdict (`full | incremental | skip`, 14-day staleness).

**Headless doors, measured.** Two reach adoption today and neither does the whole job. The
test-automation server (:17320, `--features test-automation`, NO auth) has `POST /adopt-template`
which calls `instant_adopt_template_inner` with `parameter_overrides = None`, so it cannot answer
the codebase question and leaves the persona unpinned; its `POST /eval` +
`window.__TEST__.invokeCommand` reaches any of the 1,655 IPC commands with the in-page IPC token.
The dev-tools bridge (:17400+, token) has projects/scans/KPIs/contexts routes and no adoption
route. The management API (:9420, `pk_` keys) has build and Ship routes only. The codebase
binding is a pin, not a credential: `personas.design_context.devProjectId`, resolved leniently by
id | name | root_path, injected at runtime as `PERSONAS_DEV_PROJECT_ID` for the MCP sidecar;
the `codebase` connector is a GlobalProbe with no credential row. `gh auth status` is already an
accepted readiness signal for GitHub, so the operator's login is reused without a PAT. The v3
charter mapper to reuse is `template_adopt.rs:2610 charter_input_from_recipe`. `manifest.md` is
seeded lazily on first read, not by adoption.

## 2. Design for cycle 1 (Director decisions; revisable per cycle)

- **D1 Starting line.** Recipe `version` becomes optional and absent while `status: draft`;
  vocabulary `draft | seed | maturing | proven`; a non-draft recipe must carry a version. Charter
  `recipeRef.version` optional. Templates untouched, with a note in `TEMPLATE_DECISIONS.md`.
- **D2 Adoption door.** A new unattended dev-tools bridge route (loopback, token) that adopts an
  App Master for a `dev_projects` row: find-or-create the persona (name `App Master <project>`),
  write the law manifest (Mandate from the runtime role's own text, rung 2, forbidden classes),
  mint one charter per recipe with `spec.recipeRef {slug}`, `spec.priority`, `spec.modelOverride
  "opus"`, `project_id`, cadence from the recipe's recommended trigger, `personas.max_concurrent
  = 2`, and the Codebase connector bound to the project root. Idempotent on (project, slug).
  Reuses `app_master_hire`'s persistence pieces rather than the kp payload contract.
- **D3 Priority.** `ResponsibilitySpec.priority: Option<u8>` (1 = highest .. 5), absent = the
  persona decides. Spec JSON only; no migration.
- **D4 Reconcile-and-decide lane.** When a persona is switched on (new command
  `set_persona_enabled`, and once per attention tick when the persona has self-paced charters), the
  loop runs a DECISION step on Opus: the persona reads its charters, their priorities, the ledger
  (last run per charter), and the project's state (undispatched accepted ideas, pending count,
  context-scan age, KPI coverage gaps) and returns a bounded plan `{dispatch: [{charterId,
  reason}], defer: [...], note}`; the loop dispatches up to free capacity (`max_concurrent`) in
  priority order. Coverage memory = the ledger plus a per-charter `spec.pacing {lastDecidedAt,
  coverageNote}` written back after each decision. This replaces least-recently-advanced for
  personas that have a project.
- **D5 Trigger fire path.** The scheduler and event bus propagate `responsibility_id` (falling
  back to `use_case_id`) so time and event charters execute as charters.
- **D6 Guardrails for the workers.** Workers run under the unattended worktree contract (branch
  `autopilot/<slug>`, no default-branch writes). Shipping to main/master is the operator's
  authenticated GitHub login and is a rung the mandate does not grant in cycle 1; the development
  recipe delivers a reviewable branch plus a PR when `gh` is authenticated, and records the PR as
  the outcome.
- **D7 e2e pipeline.** `scripts/e2e/app-master-cycle.mjs`: boots the dev app if the handshake is
  stale, adopts (or re-adopts) the three App Masters, enables them, waits one attention window,
  then reports per persona: decision plan, dispatched executions, ledger rows, episodes, branches
  created in the target repos, KPI writes. The report is the cycle's evidence; the improvement
  pass reads it.
- **D8 Overnight loop.** The Director self-paces cycles with the dynamic loop; each cycle =
  run pipeline, read evidence, improve one layer (recipe text, decision prompt, loop, adoption),
  commit, re-run. Stop on the usage limit or after five hours.

## 3. Task list (cycle 0 = build the loop)

| # | Task | Owner | Status |
|---|---|---|---|
| T1 | Draft baseline for the corpus + Rust/TS readers + bindings | builder (Opus) | done: 111 recipes draft, `version` optional, non-draft requires one |
| T2 | Two new recipes: `accepted-idea-delivery`, `project-kpi-stewardship` (v3, draft) | author (Opus) | done: `scripts/templates/_app_master/`, merged into the bundle under virtual owner `app-master` |
| T3 | `ResponsibilitySpec.priority`, `pacing`; `set_persona_enabled` command; trigger fire path reads `responsibility_id` | builder (Opus) | done: wake carrier = settings row `attention_wake_requests`; `responsibility_id` had never been read into Rust (live defect closed); merged `bf54ddc0c` |
| T4 | Decision lane in the attention loop (Opus prompt, bounded JSON plan, capacity-aware dispatch) | builder (Opus) | done: lane `decide` replaces only the `advance` rung for App Masters; code charters run as fleet sessions in an isolated authoring worktree (`execute_persona_inner` takes no cwd); `MAX_DECIDE_DISPATCH = 4`; unusable decision falls back to least-recently-advanced |
| T5 | Headless adoption route on the dev-tools bridge (idempotent) | builder (Opus) | done: `POST /dev-tools/app-master/adopt`, `GET /dev-tools/app-master/{project}`, command `adopt_app_master`; merged `535fc1552` + fix `24d7bc20f` |
| T6 | `scripts/e2e/app-master-cycle.mjs` + evidence report | Director | written; runs once T3-T5 merge |

**Build-time finding (T1):** the shared `CARGO_TARGET_DIR` across worktrees served stale
`personas-core` artifacts (errors naming fields that existed in a sibling worktree only). A
workspace-wide result from the shared target is suspect until the core crate is force-rebuilt
(`touch` its model files). Every merge of this arc re-runs its gates in the main checkout.
| T7 | Cycle 1 run over the three projects; improvement pass | Director | pending |
| T8 | Seeder upgrades builtin payloads to the bundle (found by the first headless adoption: the 109 rows seeded in June still carried v2 payloads, so no slug resolved) | Director | built, `recipe_seed.rs` `InsertOutcome::Upgraded` + `SeedReport.upgraded` |

**Build-time finding (T5, T8):** the shared cargo target is unsafe across worktrees building
concurrently. Cargo's freshness check is mtime-based, so a crate compiled from one worktree's
sources is reused by another worktree whose files are older: master's test build failed on
fields that exist only in the loop worktree. Sequence builds, and `touch` the crate roots
before trusting a build after a sibling worktree has compiled.

## 4. Cycle log

(appended per cycle: what ran, what the evidence said, what changed)

### Cycle 1 (2026-09-07, 00:27 to 00:49 UTC)

**Ran:** headless adoption of the three App Masters (idempotent, verified twice), attention loop
switched on, personas enabled by `set_persona_enabled`, observed 15 minutes.

**Evidence:** CandiDate's first wake went to the `improve` lane (a 54 s Opus self-review, one
episode, one execution), its second to `maintenance` (memory consolidation, noop). The next tick
came 15 minutes later, not 5: the loop had dropped to its 900 s idle interval. That tick served
one persona again (ascent, `improve`). No App Master reached the decision lane in the window; the
wake requests for ascent and personas-web were still queued because a wake was only consumed when
the interval floor refused, and a fresh persona has no completed pass for a floor to measure.

**Diagnosis:** the loop's own pacing starved the decision: fixed precedence (arrivals >
maintenance > improve > decide), one persona per tick, and an idle interval that treats three
switched-on App Masters as an idle system.

**Changed:** a wake request is consumed at admission and sends an App Master straight to the
decision lane; a tick that spent a wake re-arms the wake signal while other requests are queued,
so the next persona is served on the next loop iteration; the idle interval now equals the active
one. Pinned by `a_woken_app_master_decides_before_its_daily_self_review`.

**Process lesson:** any edit under `src-tauri/src` restarts the dev app, which resets an
observation window mid-flight (the fleet sessions it spawned die with it). Edit between windows,
never during one.
