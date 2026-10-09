# Headless App Master - the app-closed chair

> **Status:** v0.3.0, 2026-10-07 (v0.1.0 built 2026-10-05: WP0 `4b41e833d`, then three
> packages). v0.3.0 adds, for the ten-master day: `GLOBAL_CAP` 8, the durable admission queue,
> multi-repo runs with repo lanes, the plan wake, the council lane, the UX gate, recipes in the
> context, Opus `claude-opus-5-5`. Not yet run against the live app; see Known gaps.
> **Related:** [`.claude/skills/appmaster/SKILL.md`](../../.claude/skills/appmaster/SKILL.md)
> (the Director's procedure), [`roles/app-master.md`](../../.claude/skills/appmaster/roles/app-master.md)
> (what the master reads), [`app-master-e2e.md`](app-master-e2e.md) (the in-app role's
> history), [`.claude/skills/master/SKILL.md`](../../.claude/skills/master/SKILL.md) (the
> app-running chair). Design record: the vault note `Spark/ideas/headless-app-master.md`.

---

## Why

The App Master is a runtime role the app owns: its tick is a `ReactiveSubscription` inside
the running process, its decision prompt is `render_decision_prompt`
(`src-tauri/src/engine/subscription/attention_decide.rs`), its builders are fleet sessions,
and every write goes through the app's doors. While Personas itself is under active
development the app restarts often, and a restart kills its workers. `/appmaster` keeps its
managed projects moving without the app (`DEFAULT_MANAGED` pof, ascent, kp, plus every brief
marked `"headless": true`; ten on 2026-10-07): same role, same decision contract, but the clock
is a Claude Code session and the record is a file journal.

## What it is

```
        operator (CEO-level counsel)
              |  AskUserQuestion, say
              v
  +---------------------------+     context --project p      +-------------------+
  | Director (Claude session) | ---------------------------> | app DB (mode=ro)  |
  | the clock: ScheduleWakeup |                              +-------------------+
  +---------------------------+
     |  Agent x N, in parallel        ^ decision JSON
     v                                |
  master subagent (Opus, read-only) --+
     |
     |  decide -> run ids; dispatch --refused for a slot--> admission queue (_queue.jsonl)
     v                                                      ^ promote (in order, after each settle)
  builder (Sonnet or Opus, `claude -p`, background; up to two per project, eight in all,
     on disjoint paths per repo root; a reviewer on a council charter writes no code)
     in ~/.personas/headless-masters/worktrees/<p>/<run8>, cut from the project repo
     or from a second repo the brief names (Personas, the knowledge registry)
     |  exited (seen by the background `await`: a pid check every few seconds)
     v
  settle: verify claim -> merge gate --ff-only--> the target repo's checkout (its base branch)
                                 \--held--> ask
          a review: the council's run dir -> copied to the journal -> `reviewed`
  journal: .claude/master/<slug>/headless/   (wakes, runs, asks, channel, outbox, council/)
  outbox --replay, only when the app is up--> app doors (idea, task, ask, channel, milestones,
                                               goals, council ingest, tier, report + approval)
```

The master never spawns anything: it returns one JSON object and the Director acts on it.
This keeps every process under one owner who can see its pid.

## The contract

All shared numbers, vocabularies, paths and record shapes are defined once in
`.claude/skills/appmaster/lib/contract.mjs`; this document names them and does not restate
values that could drift. The subcommand table is `appmaster.mjs` (`COMMANDS`).

- **Decision JSON**: `schema/decision.schema.json`. Keys `wakeId`, `dispatch` (at most
  `MAX_DISPATCH`; each entry may carry `model` and `paths`, see "Two builders per project"), `defer`, `asks` (at most `MAX_ASKS`, kinds `ASK_KINDS`, 2 to 4 options),
  `ideaVerdicts` (`VERDICT_STATUSES`), `say` (string or null), `note`, `nextWakeMinutes`
  (`WAKE_MIN`..`WAKE_MAX`). Absent-value convention: every array present, `say` null, nothing
  omitted. Every charter appears exactly once across `dispatch` and `defer`
  (`lib/decision.mjs` `validateDecision`). Parity with the in-app contract is deliberate, so a
  later replay into the app loses nothing; the in-app prompt's `charterId` becomes
  `charterSlug` here because there is no persona-responsibility id without the app.
- **Run states** (`RUN_STATES`): `planned` (minted by `decide` before any effect) ->
  `running` (`dispatch`) -> `exited` (`await` or `watch` saw the process gone) -> `verifying` (`settle`)
  -> `merged` | `held` | `failed`, or `reviewed` for a council review run; any non-merged,
  non-reviewed state may go to `released`. Only `lib/worker.mjs` writes planned/running/exited;
  only `lib/merge.mjs` writes the rest. `LIVE_RUN_STATES` are the ones that hold a project's
  slot; `SETTLED_STATES` are the ones settle never moves. A `planned` run may also be QUEUED
  (an entry in `_queue.jsonl`): still `planned`, but a promise the loop keeps.
- **Outbox** (`OUTBOX_KINDS`, `OUTBOX_STATES`): id = `<kind>:<sha1(canonical payload)>`, so
  the same write queues once. Replay doors (the authority is the header of `lib/outbox.mjs`):
  `idea-verdict` -> `dev_tools_update_idea` (`commands/infrastructure/dev_tools.rs:491`);
  `task-complete` -> the worker write-back route `POST /dev-tools/ideas/{id}/outcome` per idea
  (it mints or reuses the task and records the commit), or `dev_tools_create_task`
  (`dev_tools.rs:991`) with the SHA in the description when no idea is named; `ask` resolve ->
  `update_manual_review_status`; `say` from the operator -> `post_persona_channel_message`
  (`commands/communication/persona_channel.rs:499`). **Two kinds have no door** and replay
  marks them `skipped` with the reason: an ask RAISE (`persona_manual_reviews` has no create
  command; the in-app raise needs a `persona_executions` row as its anchor), and the master's
  own `say` (the channel door authors every message as the operator). Those stay in the
  journal and the terminal. Replay reads the database before and after each post. Four kinds
  added on 2026-10-07 replay through routes built the same night: `plan` (POST
  `/dev-tools/milestones` -> `{milestoneId}`, then POST `/dev-tools/goals` with that
  `milestoneId` -> `{goalId}`; every created id is recorded on the entry as `created` and never
  posted again), `council` (POST `/dev-tools/council/ingest {projectId, runDir}`), `tier`
  (GET `/dev-tools/use-cases/{projectId}` to resolve the id by slug, then POST
  `/dev-tools/use-cases/{id}/tier`), `report` (POST `/dev-tools/reports`: the council's report,
  its screenshots, an Approval). An UNROUTED 404 (axum's empty body) from any of them leaves the
  entry `queued` with the evidence `route missing (404)`; a handler's own 404 carries a reason
  ("No project registered with id ...") and fails the entry with it.
- **Caps and brakes**: `GLOBAL_CAP` builders across projects, `PER_PROJECT_CAP` per project
  (two only on disjoint declared paths), `REPO_LANES` live runs per shared repo,
  `MEM` (free GB: a dispatch needs a floor plus a reserve per running builder; a gate run needs more) refuses a dispatch, `QUIET_MIN` and `TIMEOUT_MIN` flag (never kill), the
  Director's sleep is clamped to `SLEEP_MIN_SEC`..`SLEEP_MAX_SEC`. Models: `MODELS` (Opus
  decides, Sonnet builds; `builderByCharter` and the brief's `models.byCharter` override; a
  dispatch's `model` from `BUILDER_MODEL_CHOICES` overrides the charter default but not a model
  the brief pins).
- **Exit codes** (`EXIT`): 0 ok, 2 refused by a brake or gate (`{refused}` on stdout), 1 error.

## State layout

```
.claude/master/<slug>/                 gitignored (.claude/*), shared with /master
  brief.json                           /master's schema; this skill only reads it (onboard writes it)
  headless/
    wakes.jsonl                        one line per context, completed by decide (latest wins)
    asks.jsonl  channel.jsonl  outbox.jsonl
    context/<wakeId>.md                the rendered wake context the master read
    runs/<runId>/run.json              the Run record; plus the builder's stream and result.json
    council/<YYYY-MM-DD>-<feature>-r<n>/   durable copies of the council run dirs reviews produced
.claude/master/_headless-limit.json    global usage-limit mark {limitedAt, reason, resetsAt}
.claude/master/_queue.jsonl            global admission queue (latest line per runId wins) + _queue.lock
~/.personas/headless-masters/worktrees/<project>/<runId8>   branch autopilot/<charter>-<runId8>
```

Every path is a helper in `contract.mjs` (`headlessDir`, `runDir`, `limitPath`, `WORKTREE_ROOT`).
Tests redirect the roots with `APPMASTER_STATE_ROOT` and `APPMASTER_WORKTREE_ROOT`.

## The merge gate (rung 3)

The operator granted rung 3 (merge locally, no push) for this skill, against the recommended
branch-only rung, and a gate was chosen to carry the risk. `settle` treats the builder's
`result.json` as a claim and checks it (`lib/merge.mjs` `cmdSettle`); `mergeGate` merges only
if all eight hold, each measured in the run's TARGET repo (`repoOf(run)`: the project's own
checkout, or the second repo its dispatch named), and a council review never reaches it (see
"The council lane"):

1. the branch has at least one commit beyond the base it was cut from (none = `failed`);
2. the diff touches no path-glob in the brief's `boundaries` (a boundary written as prose is
   passed to the builder as a rule, not checked here);
3. the project's own gates (per gate: brief `gates{}`, else `.ai/manifest.yaml` capabilities,
   else the `package.json` script; typecheck / lint / test) exit 0 in a clean worktree whose
   HEAD is the branch tip, and at least one of them ran (a skipped gate is not a pass). Since
   2026-10-09 `test` is FOCUSED (see "Two gates" below);
4. the project checkout is on its base branch;
5. it has no merge, rebase, cherry-pick or revert in progress;
6. no path in `git status --porcelain --no-renames` of the checkout is in the branch's diff;
7. if the base moved (another builder of the project merged first, or the operator committed),
   the branch rebases cleanly onto the new tip inside its worktree BEFORE the gates run (under the
   gate slot, so condition 3 verifies the rebased tip), and if the base moves again while the
   gates run, it rebases again and the full gates re-run; a conflict aborts the rebase, the
   worktree is checked clean with the branch unchanged, and the run is held;
8. `merge --ff-only` succeeds and the checkout's HEAD equals the branch tip afterwards.

Any failed condition leaves the run `held`, keeps the branch and worktree, and raises a
`merge-held` ask with the reason (options: merge it myself, discard the branch, re-dispatch
after a commit), also queued in the outbox. `settle --retry` takes a held run through the gate
again once the operator has cleaned the checkout. The gate never stashes, checks out, resets or `git add -A`s in a
project checkout: all three carry foreign uncommitted work, which is why condition 6 exists.

### Two gates: a focused merge gate and a full gate (2026-10-09)

Measured the night of 10-08: with about ten builders on the machine, ascent's and devsecops'
full test suites outran the 15-minute gate limit, and three runs were held on a TIMEOUT (exit
null), not on a failing test. Retries merged them only once the machine was quieter. The operator
chose to split the gate rather than raise the limit:

- **Merge gate** (every settle, 15 minutes): typecheck and lint unchanged; `test` narrowed to what
  the branch's changed code files reach (`lib/gate.mjs` `testFocus` / `focusedTestCommand`). A test
  gate that is plain `vitest run` becomes `npx vitest related --run --passWithNoTests <files>`; a
  brief's `gates.testFocused` template (`{files}`) narrows any other runner; anything else runs
  full. The base re-run that tells an inherited failure from the branch's own asks the same
  narrowed question of the base. A branch with no changed code file passes `test` as "no related
  tests"; a branch past `FOCUS_MAX_FILES` code files runs the full suite.
- **Full gate** (`AM verify`, 45 minutes): every gate, full test command, on a throwaway checkout
  of the base tip, under the gate slot. One line per run in `headless/verify.jsonl`; red raises one
  `verify-red` ask per repo, which a later green closes. Run it before any push or release.

The accepted risk is the operator's: a change that breaks a feature its import graph does not
reach can merge; `verify` is where that is caught, before anything leaves the machine.

## What it deliberately does not do

- **No app database writes.** `mode=ro` only; app-owned writes wait in the outbox.
- **No push**, no pull request. Merges are local fast-forwards.
- **No scheduled or unattended tick.** It runs only while a Director session loops.
- **No HTML page**, no notifications, no vault session note: one terminal digest per wake.
- **No app change beyond the state door** (next section), and no edit of a project's code
  by the Director or the master.

## Failure modes and their handling

| Situation | Handling |
|---|---|
| Builder process dies | The run's `await` (or a `watch`) sees the pid gone, state `exited`; `settle` verifies by git, so a dead builder with no commits ends `failed` and one with commits goes through the gate. |
| An `await` is lost (the Director session restarted) | Its lock names a dead pid and holds nothing; the next wake's `watch` finds the run `running` or `exited` and the Director starts a new `await`. The lock also expires on its own (`AWAIT.lockSlackMin` past the wait), so a reused pid cannot hold a run. |
| An `await` times out | `{timedOut: true}`, exit 0, the run still `running`, nothing killed. |
| Builder goes quiet or runs long | Flagged `quiet` / `timedOut` in `watch` and the digest; never killed. Only `release --kill`, on the operator's word. |
| Usage limit | A builder's output matching `LIMIT_SIGNATURES` (scanned on stderr and non-conversation stream lines only, so a repo that mentions "usage limit" does not trip it) writes the global mark from `watch` or `settle`; `settle` releases that run; `dispatch` refuses while the mark stands (a mark whose `resetsAt` has passed reads as cleared); the loop stops. |
| Memory short (free GB, not used %) | `dispatch` refuses and the loop pauses dispatch and master wakes, still verifies; `settle` takes the single machine-wide gate slot and WAITS (bounded) for headroom, then refuses leaving the run untouched. A short sleep, never a long one: a sibling process holding memory is transient. `status --text` names who is using it. |
| App starts mid-run | The app's stale sweep (`STALE_AFTER_SECS`, `src-tauri/src/commands/fleet/stale.rs:65`, 6 min) marks fleet sessions stale, but these builders write no `fleet_sessions` rows, so it cannot touch them. Replay the outbox only after `--dry-run`. |
| Merge held | Branch kept, ask raised and queued; the operator decides. |
| Invalid decision | `decide` refuses with the errors; the Director sends them back to the same master once, then parks the project for the wake and reports it. |
| No slot for a dispatch (caps, lane, paths, memory) | `dispatch` exits 2 with `queued: true`; the run waits in `_queue.jsonl` and the next `promote` (after any settle, or by hand) starts it in order. Never dropped silently: only `promote`, `queue drop` or `release` take it out. |
| Two awaits promote at once | One machine-wide queue lock (`_queue.lock`, pid + age; a dead or stale holder is taken over) serialises dispatch and promote; a promote that cannot take it in `QUEUE_LOCK.waitMs` reports `queue busy` and the Director runs `promote` again. |
| A route the outbox needs is not built yet | The door answers 404: the entry stays `queued` with `route missing (404)`; a plan keeps the ids it already created. |
| A reviewer commits, or leaves no council result | Held with review options (`Discard the review`, `Settle again`); nothing reaches the app. |
| A feature's council does not converge | A mode's round 4 is refused at `decide` (stalled); the master asks the operator instead. |
| The app DB cannot be read at decide | Idea and feature checks are skipped (never a block); the UX gate falls back to the count its wake recorded, and refuses `ux-proposal` when it has none. |

## Two builders per project

Added 2026-10-06. `PER_PROJECT_CAP` is two, `MAX_DISPATCH` two, `GLOBAL_CAP` eight (four
until 2026-10-07, raised for the ten-master day); the
free-memory brake (`MEM`) is unchanged and still decides whether the machine can carry one
more builder. Two builders of one project are safe only if they do not collide, so:

- **Declared paths.** Each dispatch carries `paths`: repo-relative prefixes or globs the
  builder will touch (validated: no whitespace, not absolute, no `..`, no negation). The builder
  is told them and to stay inside. `lib/paths.mjs` decides overlap CONSERVATIVELY: a spec's
  scope is its literal directory before the first glob character (`src/app*` is all of
  `src/`, `*.md` the whole repo), two specs overlap when one scope is a segment-prefix of the
  other, case-insensitively, and an empty list is the whole repo.
- **At decide.** Two dispatches need non-empty, pairwise-disjoint `paths` and no shared idea;
  a dispatch may not name a charter or an idea that a started run of an earlier wake still
  carries (one builder per charter, as when the cap was one). `model` must be one of
  `BUILDER_MODEL_CHOICES`. Any violation is `invalid decision` with the errors.
- **At dispatch.** The run's paths must not overlap any live run of the project: running,
  exited, verifying, and planned once it has a worktree (a crash after the spawn may have left
  a live builder). A never-started planned run is skipped, because whichever of the two is
  dispatched second is checked against the first, and a refused, never-retried planned run
  must not jam the project. The refusal is `paths overlap`, naming the runs and the pairs.
  `run.json` keeps `paths`, `model` and `modelSource`; the model reaches `claude --model`.
- **At settle.** The rebase above (merge gate condition 7). What the branch touched outside its
  declared paths is recorded as `verdict.outsidePaths` for the master, not held: the
  declaration keeps builders apart, and a rebase conflict is what actually stops a collision.
- **The master** (roles/app-master.md) dispatches two only when both are independent and
  disjoint, uses `opus` for discovery (security scan, architecture review, KPI or measure
  design) and `sonnet` for fixing a chosen shape, delivering a well-specified idea and
  mechanical sweeps, and always declares `paths`. Its context lists every live run's model and
  paths and the free slots per project.

## Exit watchers: `await` instead of a polling Director

Added 2026-10-06. The Director used to find a finished builder by polling `watch` on its
wake cadence (about 15 minutes), so a builder that had exited waited 17.8 minutes on average
(p90 30) before `settle` started. Now `dispatch` prints an `awaitCommand`, and the Director
starts it with `run_in_background` at once:

- `await --run <id> [--timeout-min N]` (`lib/await.mjs`) blocks until the run's builder pid is
  gone, polling it every `AWAIT.pollSec` seconds with `process.kill(pid, 0)`: no model, no
  journal write while it waits. Then it does exactly what `watch` does for that run (running
  -> exited, the usage-limit mark) and then `settle`'s own code path, so the machine-wide gate
  slot, the memory wait and every refusal are settle's. It prints the settled run plus
  `waitedSec` (the wait for the exit, not the gates). `--project p` awaits the first of the
  project's `running`/`exited` runs to finish instead.
- **Many at once, one per run.** Awaits run side by side; their gates still run one at a time
  because settling takes the gate slot. Each run is locked (`runs/<id>/await.lock`, pid +
  expiry): a second await on it is refused `already awaited`, and `settle` refuses `awaited`
  while another process holds the lock, so a run is never settled twice concurrently.
- **Refusals** (exit 2): `not awaitable` for a run not `running`/`exited` (also when the
  operator releases it mid-wait), `nothing to await`, `already awaited`, and settle's own
  (`memory`, `gate busy`, ...), each carrying the slug, run id and `waitedSec`.
- **Timeout** (default `TIMEOUT_MIN`): `{timedOut: true}`, exit 0, and nothing is killed;
  the skill kills a worker only on the operator's word (`release --kill`).
- The Director's `ScheduleWakeup` becomes a fallback heartbeat (1200 s or more); a
  background-task notification is the primary wake. `watch` stays for runs no await covers.

## The state door: the app sees the headless chair

Added 2026-10-06. Before it, the app showed a headless-run project's in-app master as idle
or stale (the kp master note frozen at its last in-app decision, pof with no master at all,
"Running" never shown), and nothing stopped the in-app tick from deciding on the same
backlog. Scope is the master's STATE only; the Fleet builder rows, `persona_executions` and
`fleet_sessions` are untouched.

- **Storage**: one `app_settings` row per project, `headless_master:<project_id>`
  (`HEADLESS_MASTER_PREFIX`, `src-tauri/db/src/settings_keys.rs`), JSON
  `{ state: running|idle|ended, note (<= 600 chars, cut server-side), nextWakeAt, beatAt
  (server-stamped), runId, source: "appmaster" }`. Excluded from the settings audit, so a
  beat never floods Settings -> History. Rejected alternatives: a fake `persona_executions`
  row (takes a concurrency slot and is swept as stale at startup), an attention-ledger row,
  and the charter's `spec.pacing` (distorts the interval floor and the daily cap).
- **Write**: `POST /dev-tools/app-master/{project_id}/heartbeat`
  (`dev_tools_http.rs` -> `commands/infrastructure/headless_master.rs`
  `record_heartbeat`). The project resolves by id, name or root path like the adopt door.
  A bad state, an unparseable `nextWakeAt`, a run id over 100 characters or a note over
  16,384 characters after trimming is a 400; a note between 600 and that is stored cut.
  The answer is the stored beat plus `suppressing`. A beat is accepted for a project with
  no master persona yet (pof before adoption) and displays once the persona exists.
- **Freshness**: fresh while
  `now < min(max(beatAt, nextWakeAt) + 15 min, beatAt + 6 h)` and the state is not
  `ended` (`HEADLESS_GRACE_MINUTES`, `HEADLESS_HARD_CAP_HOURS`). The grace covers the
  minutes a wake takes to decide and settle, since a headless wake can be up to 240 minutes
  after the last; the hard cap stops a Director that died without `ended` from holding the
  in-app master aside forever. `ended` releases at once.
- **The in-app tick stands aside**: the top rung of `admit_persona`
  (`src-tauri/src/engine/subscription/attention.rs`) refuses a persona any of whose active
  charters is bound to a project with a fresh beat, as
  `AttentionRefusal::HeadlessMaster` (kind `headless_master`). It sits before the wake
  request is consumed, so a pending wake survives, and it covers the live tick and the
  Orchestration preview alike.
- **Read side**: `HeadlessState { state, note, nextWakeAt, beatAt, fresh }` on
  `AppMasterAdoption.headless` (`GET /dev-tools/app-master/{project_id}`; `None` on the
  adopt path) and on each Orchestration preview row, resolved to the project's App Master
  persona by the adopt door's rule (design-context pin + the "App Master" name prefix). The
  preview fills it whatever the persona's own switch says, so a switched-off in-app master
  whose project a terminal runs does not read only "Switched off". The Orchestration panel
  shows it as a chip (`docs/features/monitor.md`).
- **The skill side**: `lib/heartbeat.mjs` posts best-effort through `lib/bridge.mjs` at the
  end of `decide`, `dispatch`, `watch`, `settle`, `await` (also after its refusals) and
  `release`, and `heartbeat --project p
  [--state ended]` posts by hand; `end` posts `ended` for every managed project. It never
  throws, never blocks past about two seconds and never changes an exit code; with the app
  down it does nothing.

**Known gap (v1)**: only the attention TICK stands aside. A channel reply to the in-app
master (the arrivals path) and a manual wake from the UI still start an in-app run while a
headless chair holds the project.

**pof adoption note**: adopt pof's master with the adopt route only. A channel brief
(`/master onboard`'s brief post) calls `dispatch_channel_followup` and WOULD start an in-app
run, which the v1 door does not stop.

## v0.3.0: ten masters, one queue (2026-10-07)

Ten App Masters run from this skill on 2026-10-07 (pof, ascent, kp, gravitone-gcloud,
personas-web; firetv, garden-vr, mage-arena-vr, paypal, devsecops). The operator watches three
things: the masters' design and recipe use across web, TV and VR; the council (feedback
quality, rework until it passes, a final report waiting on a human gate); and the queue and
loops (eight builders at most, a queue whose order is visible after every loop cycle).

### The admission queue

The admission-queue doctrine: later is a promise, and a held request is owed an execution or
an explicit refusal. `dispatch` refused for `global cap`, `project cap`, `repo lane`,
`paths overlap` or `memory` (`QUEUE_REASONS`) appends the planned run to
`.claude/master/_queue.jsonl` as `{runId, slug, charterSlug, repo, model, decidedAt, enqueuedAt,
reason, state, position?}` and still exits 2, with `queued: true` and the position. A `usage
limit` is not a slot and never queues. Order: entries pinned by `queue move` (a `position`) first,
then FIFO by `decidedAt`. `promote` (`lib/promote.mjs`) walks that order under the queue lock,
dispatches every run that fits, skips one that does not (a later one may), stops on `global cap`,
`memory` or `usage limit`, and accounts for every queued run in `{promoted, stillQueued,
refusals, awaitCommands}`. `await` promotes after each settle, so a freed slot refills at once;
the Director starts each new `awaitCommand`. `queue drop` is the explicit refusal: it releases
the run with the reason. A queued run is in flight for `decide`, listed in the master's context
with its position, and the status digest ends with the queue table.

`dispatch` now checks cheapest first (limit, state, project cap, repo lane, paths, global cap,
then the 5-sample memory reading), so a refusal names the binding constraint and a promote
pass samples memory only for a run that fits everything else.

### Multi-repo runs and repo lanes

A brief may name `repos: [{key, root, baseBranch, lane?, gates?}]`; `self` is the project's own
checkout. A dispatch's `repo` (validated at `decide`) is resolved once into `run.json` as
`repo`, `repoRoot`, `repoBase`, and every git step after that uses it (`contract.mjs` `repoOf`):
the worktree, the gates (`gates` in the entry, else that repo's manifest / package.json; never the
project's own), the rebase, the ff-merge into that repo's base, boundaries and the dirty
overlap. Heartbeat and outbox stay keyed by the project. Two rules hold across ALL projects,
keyed by the target repo ROOT: declared paths stay disjoint, and `REPO_LANES` caps the live runs
one shared repo carries (the Personas repo 1, the knowledge registry 1; a brief's `lane` can
only tighten a cap, never loosen it). A run in the Personas repo gets
`CARGO_TARGET_DIR=<personas>\src-tauri\target` in its builder and gate env: one Rust target.
`gates` in a repos entry exists because the registry has neither a manifest nor a
package.json: without it every registry run would be held "no verifiable gate"; its own gate is
`node scripts/gate.mjs --all`.

### The plan wake

When a project has no plan in its journal AND `dev_milestones` holds nothing for it (an
unreadable table does not count as empty), its context opens with `PLAN WAKE`, the wake line
carries `planWake: true`, and `decide` requires `plan: {milestones: [{name, goal, targetDate?,
goals: [{title, measure, description?}]}]}` (1..5 milestones of 1..5 goals, strings bounded by
`PLAN`, names and titles unique) and refuses one on any other wake. ONE outbox entry `plan`
carries it; replay posts milestones then goals (the measure travels in the goal's
description: the goals door has no measure field), records each id in `created`, adopts a row
already there (a milestone by name, a goal by title linked to that milestone) instead of
posting it again, and reads every id back. Later wakes show `YOUR PLAN` with each milestone's
and goal's state in the app; a project whose milestones exist in the app sees those instead.

### The council lane

`council-lite-review` and `council-review` are review charters (`REVIEW_CHARTERS`). Their
builder role, `roles/council-reviewer.md`, runs `/council --lite <feature>` or `/council
<feature>` in a worktree of the project repo and names the run directory the council wrote; it
writes no code. A review dispatch carries `featureSlug` (a `dev_use_cases` slug, checked when
the DB is readable), runs in `self` only, needs no paths and collides with no builder. One
council per feature at a time; a mode's round 4 is refused at `decide` (the council itself
refuses it as stalled). Dispatch seeds the worktree with the feature's earlier rounds of the
same mode (the journal's copies; a full council also takes the checkout's interactive rounds)
and the checkout's `state.json`, so the council counts its round and opens with the last human
rejection; what was there is recorded as `councilSeeded` and never taken for this run's output.
Settle (`settleReview`): a commit holds it; so does no run directory of its own, or a
`result.json` that is missing, unparseable or carries an unknown outcome. Otherwise the run
directory is copied to `.claude/master/<slug>/headless/council/`, outbox `council` is queued,
the outcome is recorded on the run, the worktree is removed and the run ends `reviewed`. A FULL
council `ready` also queues `tier` (`major`) and `report` (`report.md` bounded, screenshots and
evidence files as attachments, an Approval with severity `info`). The context's COUNCIL
section lists each feature's state from the journal and the DB (none, lite- or full- ready /
fail / incomplete, stalled, approved, rejected), its must-address lines, the rounds per mode and
what is in flight. The rule the master follows: every feature passes council-lite, reworked
(a delivery carrying the must-address) until lite-ready; major features then get the full
council; a full ready goes to the operator. The council never approves.

### The UX gate

pof's brief may list `ux-proposal`. Its context shows `uxPending`, the project's pending
`dev_ideas` titled `[UX]...`, and `decide` refuses a `ux-proposal` dispatch while it exceeds
`UX.pendingMax` (10), counting the DB as it is at decide time and falling back to the count the
wake recorded. A proposal is an idea filed through the ideas door plus a prototype merged as a
`/layout` lab variant.

### Recipes in the context

Each charter quotes its v3 recipe's `description.need` and `description.coreAction` from
`recipe_definitions` (matched by `prompt_template.$.slug`, the newest row winning), at every
budget level. A slug with no row says so; `council-lite-review` and `ux-proposal` carry a
built-in purpose (`BUILTIN_CHARTERS`). `council-review` turned out to have a recipe row in the
real DB, so it quotes that. `MAX_CONTEXT_CHARS` is 20000 (12000 before): measured that day at
the fullest budget level, kp 19446, ascent 16782, pof 12602 characters.

### Models

Opus is `claude-opus-5-5` (one `claude -p --model claude-opus-5-5 "say ok"` answered on
2026-10-07); the retired `claude-opus-5` is accepted as an alias and resolves to it.

## Relationship to /master and the app

`/master` is the chair for the in-app master and needs the app running for every write;
`/appmaster` replaces the clock, the builders and the writes, and shares only `brief.json`.
Running both on one project at once would put two deciders on one backlog; nothing locks it.

**Finding: the rung documents disagree with the code.** `MAX_GRANTABLE_RUNG = RUNG_MERGE` (3)
in `src-tauri/engine/src/app_master.rs:81`, grantable since 2026-09-09 (`495ade3b3`, "rung 3
(merge) is grantable"). The `/master` skill still says "Rung is always 2 (branch and PR; the
operator merges)" (`.claude/skills/master/SKILL.md`, Wave 3), its `master.mjs` adopts with
`scopeRung: 2` (`master.mjs:348`), and `docs/architecture/app-master-e2e.md` records
`MAX_GRANTABLE_RUNG = 2` (section 1). Those claims are left as they are here; the in-app
default (`Mandate::default`) is still rung 2, so `/master`'s choice may be policy rather than
error, but the "never grantable" wording is out of date. This skill runs at rung 3 through its
own gate, independent of the app's mandate.

## Known gaps / unverified

- Outbox replay against the live app: tests use a fake bridge; the door names come from
  `master.mjs` and the scouts.
- Asks raised headless never reach the app's Approvals (no raise door), and the master's own
  `say` never reaches its channel; both live only in the journal and the digest. Closing that
  needs an app-side door, which is out of scope while the app is mid-development.
- Nested subagents: unverified, and the topology does not need them.
- Windows junction hazards: a worktree's `node_modules` is a junction; it must be unlinked
  before any recursive delete, and `ln -s` under MSYS makes a copy, not a link.
- `Discard the branch` releases the run but `release` keeps the branch and worktree; deleting
  them is left to the operator.
- The state door holds the in-app tick only; channel replies and manual wakes are not
  stopped (see "The state door").
- The `plan` doors (POST `/dev-tools/milestones`, `/dev-tools/goals`) are on master since
  `0fe21a3e29`, and the replay was checked against that contract (bodies, `{milestoneId}` /
  `{goalId}`, the goal bound through `dev_milestone_items`). The `council`, `tier` and `report`
  doors landed on master the same night (`34ec8e5f5a` reports, `61f95dc81c` council ingest +
  tier, with per-mode council rounds in `e61_council_run_mode`); the replay has not been driven
  against them on a live app yet. Contract: `docs/development/headless-bridge.md`, "Headless App
  Master doors".
- `/council --lite` is not in the council skill linked on 2026-10-07 (v0.3.1); a reviewer told
  to run it stops `blocked` rather than run a full council. Lite and full rounds of one feature
  share the council's on-disk round counter; this skill counts and seeds rounds per mode.
- A `ux-proposal` builder needs the app up to file its idea through the ideas door; with the
  app down it lists the idea in its result instead.
- Review runs, the queue and multi-repo merges are verified by tests against temp repos, a
  fixture DB and a fake bridge only; no live run yet.

## Replay checklist (the day the app is back)

1. Start the app with the test-automation server (`node scripts/e2e/sim-app.mjs up`).
2. `/appmaster end` first if a loop is running; do not run both chairs at once.
3. `AM outbox list` for each project; `AM outbox replay --dry-run`; read every entry. A
   `report` entry carries an Approval: it is the operator's gate, replay it only when he is
   ready to answer it.
   An operator `say` replays as a channel message and starts a follow-up run of the in-app
   master persona; drop or accept that before replaying.
4. `AM outbox replay`; confirm each entry reads `replayed` (or `skipped` with a reason you
   accept) with database evidence; a `failed` entry is retried by the next replay.
5. pof: `/master onboard pof` with the brief this skill wrote, so its goals land in `dev_goals`.
6. Check the merged SHAs against `dev_tasks` and the ideas' outcomes.
7. Asks raised headless are not in Approvals (no door); answered ones are in `asks.jsonl`.
8. Then decide whether the in-app master takes over (`/master <p> run`) or this one continues.
