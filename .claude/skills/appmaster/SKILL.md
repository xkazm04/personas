---
name: appmaster
description: The headless App Master - one App Master per managed project (pof, ascent, kp plus every brief marked headless) run from this terminal while the Personas app is closed or under development. This session is the clock; each wake renders a context document from a read-only snapshot of the app database plus a local file journal (with the project's plan, its charters' recipes, its council state and the admission queue), one Opus subagent per due project returns ONE decision JSON (dispatch up to two builders on disjoint paths, each Sonnet or Opus, in the project's repo or a second repo its brief names; council reviews of features; a plan on a project's first wake; defer the rest, up to 3 asks, idea verdicts, a coverage note, the next wake), this session dispatches each background builder into its own worktree (a refused dispatch waits in a durable queue, promoted in order when a slot frees), settles it the moment it exits (`await`), verifies what came back, and fast-forward merges only through the gate (project gates green, no touched file dirty in the checkout); a council review settles `reviewed` and a full `ready` goes to the operator as a Report with an Approval. Every write the app owns is queued in an outbox and replayed through the app's own doors when it is up; the app database is never written. Invoke with `/appmaster` (status), `/appmaster <project>` (boot), `/appmaster onboard <project>`, `/appmaster run` (the loop), `/appmaster say|asks|answer|outbox|queue|release|limit|end`.
version: 0.3.0
---

# /appmaster - the headless App Master

> The app-closed twin of `/master`. Same role, a per-project App Master that decides what
> moves its project forward, but the app's attention tick, fleet and doors are replaced by
> this session as the clock and a file journal as the record. Use `/master` when the app is
> running (it watches the in-app master and writes through the app's doors); use
> `/appmaster` when the app is closed, mid-restart, or under active development and you still
> want the managed projects to move. Never run both for the same project at once: two masters
> would decide over one backlog. Design and failure modes:
> `docs/architecture/headless-app-master.md`.

## Topology

```
Director (this session)    the clock: status -> context -> decide -> dispatch -> await (watch + settle + promote)
  master subagent (Opus)   one per due project, read-only, returns ONE decision JSON (+ a plan on a PLAN WAKE)
  builder (Sonnet|Opus)    up to PER_PROJECT_CAP per project, GLOBAL_CAP in all, on disjoint declared paths,
                           background `claude -p`, each in its own worktree of the project repo
                           or of a second repo the brief names (repo lanes cap shared repos)
  reviewer                 a builder on a council charter: runs /council on one feature, writes no code
  admission queue          a dispatch refused for a slot waits in _queue.jsonl; promote starts it in order
  await                    one background exit watcher per run; settles it when its pid is gone, then promotes
  merge gate               verifies the claim, rebases onto a moved base, then ff-merges or holds;
                           a review settles `reviewed` from the council's own run directory instead
  journal + outbox         files under .claude/master/<slug>/headless/, replayed later
  app DB                   read-only, mode=ro; never written by this skill
```

## State, numbers, projects

- **Journal** (local, gitignored by `.claude/*`): `.claude/master/<slug>/headless/` holds
  `wakes.jsonl`, `asks.jsonl`, `channel.jsonl`, `outbox.jsonl`, `context/<wakeId>.md` and
  `runs/<runId>/` (`run.json`, the builder's stream and its `result.json`), and `council/<run dir>/`
  (the durable copy of each council run directory a review produced). The brief is the
  shared `/master` file `.claude/master/<slug>/brief.json`. Global files: the usage-limit mark
  `.claude/master/_headless-limit.json` and the admission queue `.claude/master/_queue.jsonl`
  (with its lock `_queue.lock`). JSONL files are append-only; the latest line per id wins.
- **Worktrees**: `~/.personas/headless-masters/worktrees/<project>/<runId8>`, branch
  `autopilot/<charter>-<runId8>`, cut from the base branch tip. Outside every repo, so a
  recursive delete can never reach a checkout.
- **Numbers** live once in `lib/contract.mjs` (caps, the `MEM` free-memory numbers, quiet and timeout flags,
  wake bounds, the ScheduleWakeup clamp, the models, `REPO_LANES`, `PLAN`, `COUNCIL`, `UX`, the
  queue reasons). Quote them from there, not from memory. On 2026-10-07: `GLOBAL_CAP` 8,
  `PER_PROJECT_CAP` 2, `MAX_DISPATCH` 2, Opus `claude-opus-5-5`.
- **Two builders per project.** `PER_PROJECT_CAP` builders may run in one project and
  `GLOBAL_CAP` in all, and one decision may dispatch `MAX_DISPATCH`, but two only on disjoint
  declared `paths` (`lib/paths.mjs`, conservative: a glob counts as its whole directory, and no
  paths means the whole repo). `decide` refuses two dispatches without disjoint paths, one that
  names a charter or idea an earlier wake's started (or queued) run still carries, or an unknown `model`;
  `dispatch` refuses `paths overlap` against any live run targeting the same repo root, in ANY
  project (a never-started `planned` run excepted). Each dispatch may set `model` (`sonnet` / `opus` or the full ids in
  `MODELS`); it overrides the charter default, but a model the brief pins wins (a warning in
  `decide`'s result says so). `run.json` keeps `paths`, `model` and `modelSource`. The
  free-memory brake (`MEM`) still decides whether the machine can carry another builder.
- **A moved base.** With two builders the second to settle finds the base moved. `settle`
  rebases the branch onto the base tip inside its worktree under the gate slot, BEFORE the gates
  (so the gates verify what would merge), and records the new `baseSha` (the cut-time base stays
  as `originalBaseSha`). A conflict aborts the rebase, checks the worktree is clean and the
  branch unchanged, and holds the run with a `merge-held` ask; nothing is ever forced. A base
  that moves again WHILE the gates run is rebased again at the merge gate and the full gates
  re-run.
- **Managed projects**: the managed set is `DEFAULT_MANAGED` (`pof`, `ascent`, `kp`) plus every
  project whose `brief.json` says `"headless": true` (for 2026-10-07: gravitone-gcloud,
  personas-web, firetv, garden-vr, mage-arena-vr, paypal, devsecops once their briefs say so).
  A brief WITHOUT `headless: true` (firetv and the bank-* briefs `/master` keeps) is never woken,
  dispatched or listed by `status`. `pof` is `C:\Users\kazda\kiro\pof` (base `master`), `ascent`
  `C:\Users\kazda\kiro\ascent` (`master`), `kp` `C:\Users\kazda\kiro\kp` (base **`main`**;
  "CandiDate" in `dev_projects`). A project is addressed by its slug, the root's last path segment.
- **Repos and lanes.** A brief may name `repos: [{key, root, baseBranch, lane?, gates?}]`; the
  project's own checkout is the implicit key `self`. A dispatch's `repo` picks one (default
  `self`; `decide` refuses an unknown key) and `run.json` records `repo`, `repoRoot`, `repoBase`:
  the worktree is cut from that repo's base, its gates run (`gates` in the entry, else that
  repo's manifest / package.json; the project's own `gates` never apply there), the rebase and
  the ff-merge land in its base branch, and boundaries and the dirty overlap are checked in ITS
  checkout. Heartbeat and outbox stay keyed by the project. Paths stay disjoint per repo ROOT
  across all projects, and `REPO_LANES` caps live runs per shared repo (the Personas repo 1,
  the knowledge registry 1; a brief's `lane` may only tighten one): a dispatch past it is
  refused `repo lane` and queued. A run in the Personas repo gets
  `CARGO_TARGET_DIR=<personas>\src-tauri\target` in its builder and gate env (one Rust target).
  The registry has no manifest or package.json, so a brief that targets it names its gate
  (`"gates": {"test": "node scripts/gate.mjs --all"}`), or every run there is held.
- **The plan wake.** A project with no plan in its journal AND no `dev_milestones` row in the
  app (an unreadable table never counts as empty) gets a context that OPENS with `PLAN WAKE`; its
  wake line carries `planWake: true`, and `decide` then requires `plan` (1-5 milestones of 1-5
  goals, bounded; `PLAN`) and refuses one on any other wake. It queues ONE outbox entry `plan`;
  replay posts the milestones, then their goals, records every id it creates and never posts one
  twice. Later wakes show `YOUR PLAN` with its progress in the app.
- **The council lane.** Charters `council-lite-review` and `council-review` are REVIEW runs: the
  builder role is `roles/council-reviewer.md` (`/council --lite <feature>` or `/council <feature>`
  in a worktree of the project repo, no code). A review dispatch carries `featureSlug`, needs no
  paths and collides with no builder; one council per feature at a time; a mode's round 4 is
  refused (stalled). Dispatch seeds the worktree with the feature's earlier rounds and the
  checkout's `state.json`. Settle: a commit -> held; no run directory of its own or no parseable
  `result.json` -> held; else the run directory is copied to `council/`, outbox `council` is
  queued, the run ends `reviewed`; a FULL `ready` also queues `tier` (major) and `report` (the
  report plus an Approval: the human gate). The COUNCIL section of the context shows each
  feature's state, must-address and rounds. The council never approves; only the operator does.
- **The UX gate.** pof's brief may list `ux-proposal`. Its context shows `uxPending` (pending
  `[UX]` ideas), and `decide` REFUSES a `ux-proposal` dispatch while it is above `UX.pendingMax`
  (10), naming the count.

## The instrument

`node .claude/skills/appmaster/appmaster.mjs <subcommand>` owns every read, journal write,
spawn and merge. It prints ONE JSON document; exit 0 ok, **exit 2 = refused by a brake or a
gate** (`{refused: "<reason>", ...}`; the refusal IS the result, report it), exit 1 = error on
stderr. Do not open `personas.db`, edit journal files, or run git in a project checkout by hand.

```
status   [--project p] [--text]
context  --project p
decide   --project p --wake <wakeId> --file <decision.json>
dispatch --run <runId>
queue    list | move --run <id> --to <n> | drop --run <id> --reason <text>
promote
watch    [--project p]
settle   --run <runId> [--retry]
await    --run <runId> | --project p [--timeout-min N]
release  --run <runId> --reason <text> [--kill]
say      --project p --file <msg.md>
asks     [--project p]
answer   --ask <askId> --choice <label> --notes <text>
outbox   list|replay [--dry-run] [--project p]
limit    set|clear|show [--reason <text>] [--resets <iso>]
onboard  --project p --brief <brief.json> [--force]
heartbeat [--project p] [--state running|idle|ended]
```

`--run` takes the full run id or its 8-character short form. `settle` also takes `--retry`,
which re-settles a `held` run (otherwise a held run is returned as it is). `await` is the exit
watcher: it blocks until the run's builder pid is gone (a cheap pid check every `AWAIT.pollSec`
seconds, no LLM), then does what `watch` does for that run, then settles it through `settle`'s
own code path (same gate slot, memory wait and refusals), then runs a `promote` pass, and
prints the settled run plus `waitedSec` (the wait for the exit) and `promoted` (what the freed
slot started, with each new run's `awaitCommand`). Below, `AM` stands for
`node .claude/skills/appmaster/appmaster.mjs`.

## `/appmaster` (status)

1. `AM status --text`.
2. One paragraph from that evidence only: per project, what it last decided and when its next
   wake is due, what is running, queued or held, open asks, outbox depth; the brakes (memory,
   limit); the queue in its order. A number the output did not show is left out, not estimated.

## `/appmaster <project>` (boot)

1. `AM status --project <p>`, `AM asks --project <p>`, `AM outbox list --project <p>`.
   A project with no `brief.json` (pof today) is not managed yet: `status` errors; offer
   `onboard`.
2. Read the last wake's coverage note (`lastNote` in status; the full decision is the newest
   line of `wakes.jsonl`).
3. Say where it stands in one paragraph: the last decision and its note, runs in flight with
   their state, held runs with their reason, asks waiting on the operator, writes waiting for
   the app. Then the mode the operator asked for, or ask.

## `/appmaster onboard <project>`

Used first for **pof**, which has no brief. For **ascent** and **kp** a brief already exists
(written by `/master` on 2026-09-14): show it in five lines and offer `Keep it` / `Revise one
wave`; never re-run the whole questionnaire over a live brief. A revision copies the brief to
the scratch file, changes that wave's keys only, and writes it with `--force` (`onboard`
refuses `brief exists` without it and keeps a `.bak` copy with it).

Four waves of `AskUserQuestion`, ported from `/master`. After EACH wave write the answers into
a scratch brief file at once (`<scratchpad>/brief-<slug>.json`), so a dropped session loses
one wave, not four. Free text comes through the built-in `Other`.

1. **The product.** What it is in one sentence (free text, required). Stage: `idea` /
   `working prototype` / `used daily` / `live with users`. Who the operator is to this master:
   `CEO-level counsel` (default) / `hands-on reviewer` / `silent owner`.
2. **The key goals.** Up to three, in priority order: the goal in one line, what would prove
   it moved (`measure`), a target date or none.
3. **The mandate.** Charters (multi-select, defaults on): `project-kpi-stewardship` (1),
   `accepted-idea-delivery` (2), `codebase-security-scan` (3), `codebase-static-analysis-sweep`
   (3), `codebase-architecture-review` (4), `technical-decision-capture` (unset). Models:
   `Opus decides, Sonnet builds` (default; architecture review and security scan build on Opus)
   / `Opus everywhere`. Boundaries (multi-select, then `Other`): `never touch <path>`, `no
   dependency changes`, `no schema migrations without an ask`, `no new external services`.
   Gates: `the project's .ai/manifest.yaml capabilities` (default) / `name the commands`.
4. **How you work together.** What counts as an ask (multi-select, becomes `askFor`): scope
   change, spending beyond the daily cap, risk on the money or data path, a conflict between
   two goals, a recipe failing three runs straight. Pacing: `self-paced` (default, 10 to 240
   minutes) / `every hour` / `once a day`. Report style: `plain and short, lead with what
   moved` (default) / `narrative, with reasoning` / `numbers first`.

The file uses `/master`'s keys: `project`, `product`, `stage`, `operatorRole`, `goals`
(`[{title, measure, targetDate}]`), `charters` (`[{slug, priority}]`, priority 1..5 or null),
`models` (`{builder}` only when the operator chose `Opus everywhere`; the per-charter Opus
defaults live in `contract.mjs`), `boundaries` (strings; a path glob is enforced by the merge
gate, prose is passed to the builder as a rule), `gates` (`{typecheck, lint, test}` commands,
only when named), `askFor` (strings), `pacing`, `reportStyle`.

Then `AM onboard --project <p> --brief <scratch file>` and quote the `briefPath` it returns.
`invalid brief` lists its `errors`: fix the scratch file and run it again.
**This mode writes `brief.json` only.** Goals reach the app database later, when the app is
up, through `/master onboard`; until then pof's context shows no goals and that is honest.

## `/appmaster run` (THE LOOP)

Every step is the Director's. `ScheduleWakeup`, `AskUserQuestion`, `Agent` and `SendMessage`
are used here, in this session, and never inside a master subagent.

1. **Status.** `AM status`. Note each project's `due`, running, queued and held runs, open asks,
   and the `queue` (its order is the promotion order).
2. **Brakes.** `status` reports free memory and the usage-limit mark. The memory brake is
   FREE GB (a dispatch needs `MEM.dispatchMinFreeGb` plus `MEM.perBuilderReserveGb` per builder
   already running), not a used percentage, so another tool's big process cannot hold the loop
   hostage for hours: it clears by itself. **Memory tripped:** dispatch nothing and wake no
   master this tick, but still `watch` and let the awaits settle (settle waits for its own headroom, below),
   say who is using the memory (`status --text` names the biggest other processes and what
   the builders use), and schedule a SHORT wake (300 to 600 s). **Usage limit marked:** say so,
   do nothing else, schedule a long wake (3600 s).
3. **Context.** For each managed project with `due: true`: `AM context --project <p>`.
   Collect `{wakeId, path}`. A refusal here is reported and that project skips this wake.
4. **Masters, in parallel.** In ONE message, one `Agent` call per due project:
   `subagent_type: "general-purpose"`, `model: "opus"`, description `App Master <p>`, prompt:
   > You are the App Master of <p>. Read `.claude/skills/appmaster/roles/app-master.md` and
   > then the context document at <path>. Return ONLY the decision JSON for wake <wakeId>.
   > You may Read, Grep and run read-only git/Bash for evidence. You must not edit or create
   > files, spawn builders or subagents, run appmaster.mjs, or write the journal.

   A context that opens with `PLAN WAKE` asks its master for a `plan` as well (the role says
   how); `context` reports `planWake: true` for it. Nothing else changes for the Director.
5. **Decide.** Save each reply verbatim to `<scratchpad>/decision-<slug>-<wakeId8>.json`,
   then `AM decide --project <p> --wake <wakeId> --file <that file>`. `wake already decided`
   or `unknown wake` means a stale or mistyped id: report it, do not retry. On
   `invalid decision` (its `errors` list), `SendMessage` the errors back to the SAME subagent ONCE and decide again
   on its corrected reply; a second refusal parks the project for this wake and goes into the
   digest with the errors. Never edit a master's JSON yourself.
6. **Dispatch, then await.** For each run id `decide` returned: `AM dispatch --run <runId>`,
   which cuts the worktree and starts the builder in the background. A refusal for a slot
   (`global cap`, `project cap`, `repo lane`, `paths overlap`, `memory`) still exits 2 but says
   `queued: true` and the `position`: the run is now held in the admission queue (below) and a
   later `promote` starts it; do not retry it by hand. Any other refusal (`usage limit`, `run not
   planned`) is reported and left for the next wake. On success, start the `awaitCommand` that `dispatch`
   printed (`AM await --run <runId>`) with `run_in_background`, at once. That background task's
   notification is the PRIMARY wake: when it arrives, read its JSON (the settled run,
   `waitedSec` and `promoted`) and go to step 8. Several awaits run side by side safely: settling takes the one
   machine-wide gate slot, so their gates still run one at a time.
   - **After every await notification, inspect `promoted`.** The await ran a `promote` pass when
     its run settled: `promoted.awaitCommands` lists every queued run the freed slot started.
     Start each of those `awaitCommand`s with `run_in_background` at once, exactly as after a
     dispatch. `promoted.refusals` says why the rest still wait; `promoted.error` (e.g. `queue
     busy`) means run `AM promote` yourself.
   - **One await per run.** `await` locks the run (`runs/<id>/await.lock`); a second await on it
     is refused `already awaited`, and so is a `settle` (`awaited`) while another process
     awaits it. Never start `await` and `settle` on the same run: the await settles it.
   - `await` refuses (exit 2) a run that is not `running` or `exited` (`not awaitable`); an
     already `exited` run settles at once. A settle refusal (`memory`, `gate busy`) comes back
     with `waitedSec` and leaves the run `exited`: start `await` on it again next wake.
   - On `timedOut: true` (after `--timeout-min`, default `TIMEOUT_MIN`) nothing was killed and
     the run is still `running`: report it like a `timedOut` watch flag and start a new await
     only if the operator wants it watched further. No kill without the operator's word.
7. **Watch (fallback).** `AM watch` on every wake, for what no await covers: a run dispatched
   before this session, an await that was lost with a restarted session, or a builder flagged
   `quiet` / `timedOut` (reported, never acted on; see `release`). For an `exited` run with no
   await running, start `AM await --run <runId>` in the background rather than `settle`
   (same result, and it holds the run's lock); `settle` by hand only for `--retry` of a held
   run. A settle ends `merged`, `held` (with an ask), `failed` (no commits), `released` (the
   builder hit the usage limit) or, for a council review, `reviewed`. A `limitHit` row means the
   mark is now set: stop after this wake.
   Then `AM promote` once per wake, and after any `release` or `queue drop` (a slot freed
   without an await): it starts every queued run that now fits and prints `{promoted,
   stillQueued, refusals, awaitCommands}`; start each `awaitCommand` in the background. A
   refusal there is information (the run keeps its place), not an error. The operator reorders
   with `AM queue move --run <id> --to <n>` and refuses with `AM queue drop --run <id> --reason
   "<why>"`; the Director never drops a queued run on its own judgment.
8. **Asks.** `AM asks`. An ask is the operator's when its kind matches the brief's `askFor`
   (scope change -> `scope`, spending -> `spend`, money or data path risk -> `risk`, two goals
   in conflict -> `goal-conflict`, a recipe failing -> `recipe-failing`) and always when it is
   `merge-held`. Present each of the operator's asks as ONE `AskUserQuestion` whose options are
   the master's own labels, then `AM answer --ask <askId> --choice <label> --notes "<the
   operator's words>"`. When the operator answers through the built-in `Other`, pass
   `--choice Other --notes "<their text>"` (notes are required then). An ask outside `askFor` the Director may answer itself, with its
   reasoning in `--notes`, and must say in the digest that it did. Never leave an ask open
   silently. Anything the operator says to a master goes through `say`.
   A `merge-held` answer is carried out by the Director, not the master: `Merge it myself` ->
   nothing more (the operator merges; the Director never does); `Discard the branch` ->
   `AM release --run <runId> --reason "operator discarded"` (release keeps the branch and
   worktree, so give the operator the branch name to delete); `Re-dispatch after I commit` ->
   when the operator says the checkout is clean, `AM settle --run <runId> --retry`. A held
   council REVIEW offers `Discard the review` -> `AM release --run <runId> --reason "operator
   discarded the review"`, and `Settle again` -> `AM settle --run <runId> --retry` once what held
   it (a commit, a missing or unreadable council `result.json`) is fixed.
9. **Digest.** Print it (format below). It ends with the queue table, every wake, so the
   order the queue will promote in is visible after each loop cycle.
10. **Sleep.** `ScheduleWakeup` at the earliest `nextWakeAt` over the managed projects,
    clamped to 60..3600 s. While builders run, the await notifications wake you, so the
    `ScheduleWakeup` is only a FALLBACK heartbeat: long, 1200 s or more (it never needs to be
    short to catch an exit any more). On a quiet wake say one line and reschedule.

**Stop** when the usage-limit mark is set (say when it resets if known) or the operator says
stop. A tripped memory brake is NOT a stop: it pauses dispatch and waking until it clears.
Then run `end`.

### Digest format (terminal only)

Short sentences; lead with what moved. Start from `AM status --text`, whose renderer IS the
base format: one machine line, then one block per project (decided, merged, reviewed, running
with model and last-output age, queued with position, held with reason, the note, the master's
say, asks open, outbox depth); a project where nothing moved collapses to one line; the queue
table closes it.

```
Machine: 31.2 GB free; no usage limit; builders running 8 of 8.
ascent - decided 14:15, dispatched accepted-idea-delivery; next wake 14:40.
  Reviewed 7f30aa12 org-journey: lite council fail.
  Running 9a41c7e2 accepted-idea-delivery (claude-sonnet-5-5), last output 3 min ago; paths src/app/org/.
  Running 5b20d4c1 codebase-security-scan (claude-opus-5-5), last output 1 min ago; paths src/lib/auth/.
  Queued 3c11d0e9 council-lite-review at position 1, waiting on global cap.
  Held 2c7e01bb codebase-security-scan: uncommitted changes in the checkout overlap the branch: ...
  Note: Dispatched delivery of 4c2e81aa/7d90b3f1. Next wake: settle, then KPI readings.
  1 ask(s) open; 4 outbox entries queued.
kp - quiet, next wake 16:05.
Queue: 2 waiting, in promotion order (FIFO by decision; `queue move` pins).
  #  project       charter              model              repo      waited  waits on
  1  ascent        council-lite-review  claude-sonnet-5-5  self      6 min   global cap
  2  mage-arena-vr knowledge-forge      claude-opus-5-5    registry  2 min   repo lane
```

Then add what this wake did that status cannot show: `QUIET` / `TIMEOUT` flags from `watch`,
refusals from `decide` or `dispatch`, asks the Director answered itself and why. Every claim
cites a run id, SHA, wake id or file; never narrate what the journal does not show.

## The admission queue ("later is a promise")

A dispatch refused for a slot is not dropped. `dispatch` appends the planned run to the global
`.claude/master/_queue.jsonl` (append-only, latest line per run wins) and the run stays `planned`
until `promote` starts it or `queue drop` refuses it explicitly. Semantics, exactly:

- **What is queued**: only a run whose `dispatch` was tried and refused for `global cap`,
  `project cap`, `repo lane`, `paths overlap` or `memory`. A planned run whose wake is decided
  but whose dispatch was never tried is NOT in the queue. A `usage limit` is not a slot and
  never queues: it stops the loop.
- **Order**: runs the operator pinned with `queue move` first (lower position first), then
  FIFO by the time the run's wake was decided. A run queued again keeps its place.
- **In flight**: a queued run counts as in flight for `decide` (its charter and its ideas are
  not dispatched again) and the master's context lists it with its position.
- **Promote**: `AM promote` walks the queue in order under one machine-wide lock and dispatches
  every run that now fits the caps, lanes, paths and memory; a run that does not fit is skipped
  (a later one may fit), and a `global cap`, `memory` or `usage limit` refusal stops the walk.
  It prints `{promoted, stillQueued, refusals, awaitCommands}`. `await` runs it after every
  settle, so a freed slot refills at once.
- **Refusal**: `AM queue drop --run <id> --reason "<why>"` releases the run with that reason; a
  `release` of a queued run drops it too. Nothing leaves the queue silently.
- `AM queue list` prints the ordered table; `status --text` and the digest end with it.

## `say`, `asks` / `answer`

- **say**: write the operator's words to `<scratchpad>/say-<slug>.md`, then
  `AM say --project <p> --file <it>` (`--text "<msg>"` also works for one line). The next wake's context shows it as an operator note,
  and the say is also queued for the app channel.
- **asks** / **answer**: as in loop step 8. Quote the ask id, the choice and the notes back.

## `outbox`

The outbox is the list of writes the app owns (idea verdicts, a finished task with its SHA,
ask answers, the operator's says, a plan's milestones and goals, a council run to ingest, a
feature's tier, a council report with its Approval) that this skill could not make because it
never writes the app database. Each entry is idempotent (its id is a hash of kind and payload)
and is replayed through the app's own doors when the app is up; replay checks the database
before and after each post. `AM outbox list [--project p]` shows the queue; `AM outbox replay
--dry-run` shows what would be posted (without the app); `AM outbox replay` posts, and refuses
with `app is not running` otherwise. Ask raises and the master's own says have no door and
replay as `skipped`: those live in the journal and the digest only.

The kinds added on 2026-10-07 use routes a sibling builds the same night: `plan` (POST
`/dev-tools/milestones`, then `/dev-tools/goals`), `council` (POST `/dev-tools/council/ingest`),
`tier` (GET `/dev-tools/use-cases/{projectId}`, POST `/dev-tools/use-cases/{id}/tier`), `report`
(POST `/dev-tools/reports`). Until a route answers, a 404 leaves the entry `queued` with the
evidence `route missing (404)` and the next replay tries again. A `plan` records every id it
creates on the entry (`created`) and never posts one twice, so a replay that failed halfway
resumes where it stopped.

## `release`

`AM release --run <runId> --reason "<why>"` settles a run as released (the operator discarded
it, or the usage limit stopped it). A quiet worker is flagged, not killed: add `--kill` ONLY
when the operator has said to kill that run, and say so in the digest.

## `limit`

`AM limit show` reads the global mark. `AM limit clear` after the operator confirms the
subscription has reset. `AM limit set --reason "<text>" [--resets <iso>]` records a limit seen
outside a builder (builders that hit one set it themselves).

## `end`

No vault note (the operator's choice). In order:
1. `AM watch`; list every run in flight with its state, and every held run with its reason.
2. Say what the next wake will do, project by project. Leave running builders running, and
   their background awaits too (an await never kills; it settles the run if this session is
   still alive when the builder exits). Whatever is left `running` or `exited` is settled by
   the next `/appmaster run` (step 7).
3. `AM heartbeat --state ended`: posts `ended` for every managed project, so the app stops
   showing them as run from here and each in-app master's tick may run again at once. Quote
   the `beats` it returns (`posted: false` with the app down is normal; nothing else to do).
4. Nothing to commit unless skill or doc files changed in this session. If they did: the
   isolated-index ritual from `.claude/CLAUDE.md`, one bash invocation, your paths only, then
   `git show --name-status HEAD`. Never push.

## The state door (what the app sees)

The app cannot see this chair unless it is told. After `decide`, `dispatch`, `watch`, `settle`,
`await`, `release`, `promote` and `queue` succeed (and after an `await` refusal, whose wait may have moved a run), `appmaster.mjs` posts the project's state through the dev-tools bridge
(`POST /dev-tools/app-master/{project_id}/heartbeat`, `lib/heartbeat.mjs`): `running` while a
run is running, exited or verifying, else `idle`, with the latest wake note and next wake.
While that beat is fresh the app shows the master as run from a terminal and its in-app tick
stands aside; `ended` (step 3 of `end`) hands the project back. It is best-effort: never
throws, gives up after about 2 s, never changes an output or an exit code, and does nothing
while the app is down. It writes no app table but the project's one `headless_master:<id>`
setting, through the app's own door. `AM heartbeat --project <p> [--state ended]` posts by
hand. Design: `docs/architecture/headless-app-master.md`, "The state door".

## Guardrails

- The Director never merges by hand, never kills a worker without the operator's word, never
  edits a project's code, never writes the app database, never accepts ideas in bulk, and
  never edits a master's decision.
- **Rung 3 means the gate merges, not the Director.** A held run is reported with its reason
  and an ask; it is never forced.
- Evidence over narration: every claim cites a run id, a SHA, a wake id or a file.
- Free memory before every dispatch and every gate run (`dispatch` refuses; `settle` waits then refuses; do not work around either). Never kill a process to make room: name who is using it and tell the operator.
- Builders run `--dangerously-skip-permissions` in their worktree. The risk, named once: that
  confines the working directory, it is not a sandbox; a builder could still write elsewhere.
- pof, ascent and kp all carry uncommitted foreign work in their checkouts, and so do the
  Personas repo and the knowledge registry that other masters target. The merge gate exists
  because of it: never stash, checkout, reset or `git add -A` in any checkout.
- One Personas cargo target: a run in the Personas repo gets `CARGO_TARGET_DIR` set to it;
  never start a second Rust build tree.
- The council never approves, and neither does the Director: `approved` and `rejected` are the
  operator's, through the Approval a full `ready` queues. A reviewer writes no code.
- A queued run is a promise: it leaves the queue only by `promote`, by the operator's
  `queue drop`, or by a `release`; never by silence.
- Bring the operator CEO-level decisions only (scope, money, risk, goal conflicts, a held
  merge, a stalled council); restarts, re-dispatches, promotes and cursor bumps are the Director's.
- The app database is read-only. When the app comes up, post nothing by hand: run
  `outbox replay --dry-run` first, read it, then `outbox replay`.

## Known gaps

- Outbox replay against the live app is unverified until the app runs (tests use a fake bridge).
  The `plan`, `council`, `tier` and `report` routes did not exist when this was written: their
  request bodies follow the brief of 2026-10-07, not a route that answered.
- `/council --lite` is unverified: the council skill linked on 2026-10-07 (v0.3.1) documents no
  `--lite` flag. The reviewer is told to stop `blocked` rather than fall back to a full council.
  A lite and a full council of one feature share the council's own round counter on disk; this
  skill counts rounds per mode and seeds only the same mode's earlier rounds into a worktree.
- A `ux-proposal` builder files its `[UX]` idea through the ideas door, which needs the app
  running; with the app down it lists the idea in its result's `questions` instead.
- pof has no goals until it is onboarded here and then through `/master onboard`.
- Nested subagents are unverified and not needed: masters return JSON, the Director spawns.
- The in-app master and this one share no lock beyond the state door: a fresh beat holds the
  in-app master's attention TICK aside, but a channel reply or a manual wake in the app still
  starts an in-app run. Do not run `/master run` and `/appmaster run` on the same project at
  the same time, and adopt pof's in-app master with the adopt route only (a `/master onboard`
  brief post starts an in-app run).
