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

**After the fix (00:54 to 01:20 UTC):** the loop admitted ascent and personas-web on their wakes and
planned both decisions in the same second (the re-armed signal works); a dev-app restart from a
test edit orphaned those two open rows, which then refused their personas as `in_flight`. CandiDate
decided at 00:58:25 on Opus: dispatched priority 1 KPI stewardship ("280 of 285 contexts carry no
active KPI") and priority 2 accepted-idea delivery ("oldest of 5 taskless: 297f6ba4"), deferred
the other four with reasons, wrote a coverage note. Both dispatches became fleet sessions in
isolated authoring worktrees. The delivery worker re-validated the idea (premise half stale: the
guards it asked for already existed), delivered the remaining ask as `3935d589` on
`autopilot/accepted-idea-delivery-to-the-main-branch`, ran the suite, attributed a flaky test to
untouched code, and reported `FLEET:DONE`. The steward committed `be2e8c93` (a self-scheduling
booking-rate KPI probe, baseline 50%, target 70%) and reported that adopting the KPI row "needs a
human because no bridge route creates one".

**Gap for cycle 2 (measured, not guessed):** the workers wrote nothing back into Personas. Idea
`297f6ba4` is still `accepted` with no `dev_tasks` row, so the undispatched sensor re-offers it;
no `dev_kpis` row, no measurement, no backlog items. A fleet session has neither the Personas MCP
nor an ideas route on the bridge. Cycle 2 builds: bridge write-back routes (`POST /dev-tools/ideas`,
`/ideas/{id}/outcome`, `/kpis`, `/kpis/{id}/measure`), a dispatch-time task row for a named idea,
a write-back block in every worker's task text, an in-flight list in the decision prompt, and a
boot sweep that closes orphaned open ledger rows. Also observed: fleet sessions stay `running` in
the registry after `FLEET:DONE`.

**Second wave (01:28 to 01:35 UTC):** ascent and personas-web decided on their first admitted
pass after the orphaned rows aged out; CandiDate's second wake rotated to its two never-run
priority-3 scans and deferred the in-flight pair. Coverage notes read like a colleague's
("Wake 2: ... rotate next"). Non-code charters run through `execute_persona_inner` on Opus
(security scans 4-5 min, about $1.2-1.4 each by the engine's estimate; the subscription pays).

**Two more defects, from the execution logs:** (1) the MCP sidecar is launched with
`PERSONAS_API_KEY` while `personas-mcp` authorizes from `PERSONAS_MCP_TOKEN`, so every
`mcp__personas__*` call in a persona execution fails `-32001 Authentication required`; the
personas-web scan found its repository by guessing on disk. (2) The scans emitted
`{"propose_backlog": ...}` as text; the runner intercepts protocol verbs only as tool calls to
tools the CLI does not have, so nothing was filed. Both handed to the cycle-2 builder (P6, P7).
(3) The decision context sees a dispatch but not its outcome: CandiDate deferred KPI stewardship
as "still in flight" 25 minutes after that worker's `FLEET:DONE` (P4 addendum).

**Third wave (02:08 UTC, CandiDate wake 3):** re-dispatched priority 1 and 2 on `-2` branches with
a brief that told the workers to verify wake 1's item first and take a fresh one otherwise; the
coverage memory carried what the database could not. The delivery worker took idea `e38c24b7`,
found its premise overtaken by emit sites that landed on 2026-09-05, delivered the defect
underneath (`cb71f912`, ten files) and said so. The steward measured a JD build failure rate
KPI and wired it to the existing Personas row through the bridge. The ascent steward finished
with six measured KPIs and nine backlog items filed as docs on its branch, for want of a route.
Seven App Master executions so far, the engine's estimate about $8.6, on the subscription.

### Cycle 2 (merged 02:43 UTC, `58dc4c06d`)

**Built from cycle 1's evidence:** bridge write-back routes (`POST /dev-tools/ideas`,
`/ideas/{id}/outcome`, `/kpis`, `/kpis/{id}/measure`), a dispatch-time `dev_tasks` row for a
named accepted idea, a write-back block in every worker's task text, in-flight tasks and each
charter's last-dispatch outcome in the decision prompt, a boot sweep closing orphaned attention
rows, `PERSONAS_MCP_TOKEN` on the MCP sidecar (every persona execution's Personas tool call had
been failing), and `propose_backlog` in the protocol text parser (the verb was missing from the
key table, so text fallbacks were dropped). Left out with evidence: `origin = app-master` on filed
ideas (a closed 11-value allowlist mirrored in UI and 14 locales; `scan_type` carries the producer
instead), `evidence` on filed ideas, `measured_at` on measurements.

**Cycle 2 observed (02:46 to 03:19 UTC):** the boot sweep closed 3 orphaned passes. CandiDate wake 4
cleared its never-run backlog (architecture review, decision capture) and rested the rest with
reasons that cite last-dispatch outcomes ("just finished at 02:09 delivering cb71f912"; "failed
with 'codebase not in CWD', needs the connector fix"). Ascent wake 2 dispatched KPI stewardship
and its first static analysis; personas-web took its daily self-review. Thirty-three backlog
items reached `dev_ideas` in this wave across all three projects: CandiDate's architecture review
and decision capture filed six through the routes (`scan_type = app-master`), ascent's static
analysis six and its steward seventeen (K1 to K17, KPI measurement functions and governance
proposals), personas-web's static analysis four through the repaired `propose_backlog` text path,
one of them a critique of the loop: "priority-1 KPI charter unserved while priority-3 scans ran
twice". The KPI routes were used too: the ascent steward declared 17 KPIs and recorded 20
measurements (env `local`, so they land as simulation readings and do not roll `current_value`),
taking ascent from 39 to 49 of 49 contexts with an active KPI by its own count; CandiDate's steward
declared one. A first read of this claimed "no KPI rows": the KPI tables store timestamps with a
space separator, and a string compare against an ISO `T` timestamp excluded every row. Compare
through `datetime()`, as the codebase's own quota gate learned. The `propose_backlog` items carry
`scan_type = team_proposed`, the route-filed ones `app-master`.

**Cycle 3 candidates:** (a) self-pacing proper: the decision returns `nextWakeMinutes` (bounded)
and admission honours it instead of the 30-minute default; (b) the KPI stewardship recipe says
which `env` a reading belongs to (a local probe is `local`; only a production reading moves
`current_value`); (c) the two scan charters that
failed before the MCP token fix should show as `failed` in the last-dispatch line so the App
Master re-runs them deliberately; (d) an operator surface for the 33 pending items is the
existing triage deck, nothing new to build.

### Cycle 3 (merged 05:34 UTC, `c8f9a7da3`)

**Built:** self-pacing proper. The decision plan carries `nextWakeMinutes` (10 to 240, clamped;
a non-integer costs only the sleep choice, never the dispatch list), stamped on every considered
charter's pacing; admission uses the newest choice as the interval for an App Master and keeps the
declared-cadence rule for every other persona. The prompt shows the UTC clock and the previous
choice. The KPI stewardship recipe says which `env` a reading belongs to. Two census rises the
builder attributed to my own committed scripts were fixed in code (`b04529574`): the driver now
discovers the harness port, the bundle merge refuses an empty enumeration.

**Evidence from the cycle-2 tail (03:19 to 03:45):** the outcome route works end to end: the
wake-5 delivery worker wrote wake 1's outcome back (task for `297f6ba4` completed with branch and
commit). CandiDate's note now carries an operational lesson ("security scan failed on empty CWD,
pass the code path"). Three fleet workers ended with "You've reached your Fable limit": the fleet
path pushes no `--model`, so the workers rode the account default instead of the charter's Opus,
and the registry filed the limit as a finished task. Cycle 4 builds: `--model` on the fleet path
from the charter's override, a limit or `FLEET:BLOCKED` end reported as `failed` in the decision
context, and a sweep that closes a dispatch-minted task whose worker ended without writing back.

**Cycle 3 observed (05:45 to 06:10 UTC):** self-pacing is used. personas-web chose 15 then 12
minute sleeps and the admission log now says "interval floor refuses, 10 minutes of sleep left".
Its notes read like an operator's: "KPI (p1) 4th try, 3 prior deaths (crash + Fable). Brief:
NON-Fable, find WHY KPI declares don't persist, get one PERSISTING"; the fifth steward run then
took the project from 78 to 74 contexts without a KPI with four active, context-bound meters, so
the persona diagnosed and fixed its own worker's mistake across wakes. CandiDate was refused by
the daily cap (`runs_today 26, cap 24`): every wake writes a decide row plus one per dispatch, so
the default cap of 24 passes is reached after about eight wakes; handed to cycle 4 as P4 (count
charter dispatches only, App Master default 96). Across the day so far: 28 KPIs declared (15
active, 13 proposed), 33 measurements (20 local, 13 production), well over forty backlog items.

### Cycle 4 (merged 06:44 UTC, `5c841775d`)

**Built:** the fleet path pins the charter's resolved model (`--model claude-opus-4-8`); a pure
end-of-run classifier (Limit | Blocked | Finished | Unknown) reusing the registry's limit shapes
plus the model-limit sentence the registry had never matched; a limit or `FLEET:BLOCKED` end is
reported as `failed` in the decision context; a dispatch-minted task whose worker ended without
writing back is closed with a marker that the undispatched sensor exempts, so the idea is
offered again while a reported refusal still silences it; the daily cap counts charter
dispatches only for an App Master, default 96.

**The finding that bounds the whole arc (06:10 to 06:41 UTC):** the App Masters have run out of
permitted work. Ascent, wake 7: "dispatched none. Loop operator-blocked: 27 pending / 0 accepted,
delivery starves without accepts. All code charters scanned unchanged code today; re-run = dupes.
KPI 49/49, back-measure blocked on delivery", and it chose a 120-minute sleep. personas-web:
"DELIVERY blocked: 0 accepted / 13 pending, stalled at upstream triage, not starved by me."
CandiDate's steward took its project from 74 to 68 contexts without a KPI. Sixty backlog items
today across the three projects, all `pending`. The loop's throughput is now bounded by the one
act the mandate reserves for a person: accepting an idea. The product already has a door for
that (`Action::BacklogTriage` under a project's `full` autopilot with triage rules, the Overnight
engine's mechanical accept), but granting it is the operator's decision, not the Director's.
Cycles 5 to 10 run under that ceiling unless the operator accepts items or opens the door.
