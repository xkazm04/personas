---
name: appmaster
description: The headless App Master - one App Master per project (pof, ascent, kp) run from this terminal while the Personas app is closed or under development. This session is the clock; each wake renders a context document from a read-only snapshot of the app database plus a local file journal, one Opus subagent per due project returns ONE decision JSON (dispatch at most one builder, defer the rest, up to 3 asks, idea verdicts, a coverage note, the next wake), this session dispatches one background Sonnet builder per project into its own worktree, verifies what came back, and fast-forward merges only through the gate (project gates green, no touched file dirty in the checkout). Every write the app owns is queued in an outbox and replayed through the app's own doors when it is up; the app database is never written. Invoke with `/appmaster` (status), `/appmaster <project>` (boot), `/appmaster onboard <project>`, `/appmaster run` (the loop), `/appmaster say|asks|answer|outbox|release|limit|end`.
version: 0.1.0
---

# /appmaster - the headless App Master

> The app-closed twin of `/master`. Same role, a per-project App Master that decides what
> moves its project forward, but the app's attention tick, fleet and doors are replaced by
> this session as the clock and a file journal as the record. Use `/master` when the app is
> running (it watches the in-app master and writes through the app's doors); use
> `/appmaster` when the app is closed, mid-restart, or under active development and you still
> want pof, ascent and kp to move. Never run both for the same project at once: two masters
> would decide over one backlog. Design and failure modes:
> `docs/architecture/headless-app-master.md`.

## Topology

```
Director (this session)    the clock: status -> context -> decide -> dispatch -> watch -> settle
  master subagent (Opus)   one per due project, read-only, returns ONE decision JSON
  builder (Sonnet)         one per project, background `claude -p` in its own worktree
  merge gate               verifies the claim, then ff-merges or holds with an ask
  journal + outbox         files under .claude/master/<slug>/headless/, replayed later
  app DB                   read-only, mode=ro; never written by this skill
```

## State, numbers, projects

- **Journal** (local, gitignored by `.claude/*`): `.claude/master/<slug>/headless/` holds
  `wakes.jsonl`, `asks.jsonl`, `channel.jsonl`, `outbox.jsonl`, `context/<wakeId>.md` and
  `runs/<runId>/` (`run.json`, the builder's stream and its `result.json`). The brief is the
  shared `/master` file `.claude/master/<slug>/brief.json`. The usage-limit mark is global:
  `.claude/master/_headless-limit.json`. JSONL files are append-only; the latest line per id wins.
- **Worktrees**: `~/.personas/headless-masters/worktrees/<project>/<runId8>`, branch
  `autopilot/<charter>-<runId8>`, cut from the base branch tip. Outside every repo, so a
  recursive delete can never reach a checkout.
- **Numbers** live once in `lib/contract.mjs` (caps, memory brake, quiet and timeout flags,
  wake bounds, the ScheduleWakeup clamp, the models). Quote them from there, not from memory.
- **Managed projects**: `pof` (`C:\Users\kazda\kiro\pof`, base `master`, not onboarded yet),
  `ascent` (`C:\Users\kazda\kiro\ascent`, `master`), `kp` (`C:\Users\kazda\kiro\kp`, base
  **`main`**; "CandiDate" in `dev_projects`). A project is addressed by its slug, the root's
  last path segment. `status` lists every slug that has a `brief.json`, which includes
  projects `/master` onboarded (firetv); this skill drives only pof, ascent and kp unless the
  operator names another.

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
watch    [--project p]
settle   --run <runId>
release  --run <runId> --reason <text> [--kill]
say      --project p --file <msg.md>
asks     [--project p]
answer   --ask <askId> --choice <label> --notes <text>
outbox   list|replay [--dry-run] [--project p]
limit    set|clear|show [--reason <text>] [--resets <iso>]
onboard  --project p --brief <brief.json>
```

`--run` takes the full run id or its 8-character short form. `settle` also takes `--retry`,
which re-settles a `held` run (otherwise a held run is returned as it is). Below, `AM` stands
for `node .claude/skills/appmaster/appmaster.mjs`.

## `/appmaster` (status)

1. `AM status --text`.
2. One paragraph from that evidence only: per project, what it last decided and when its next
   wake is due, what is running or held, open asks, outbox depth; the brakes (memory, limit).
   A number the output did not show is left out, not estimated.

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

1. **Status.** `AM status`. Note each project's `due`, running and held runs, open asks.
2. **Brakes.** `status` reports memory and the usage-limit mark. Memory at or above the
   brake, or a limit mark set: say which, in one line, schedule a long wake (3600 s), and do
   nothing else this wake.
3. **Context.** For each managed project with `due: true`: `AM context --project <p>`.
   Collect `{wakeId, path}`. A refusal here is reported and that project skips this wake.
4. **Masters, in parallel.** In ONE message, one `Agent` call per due project:
   `subagent_type: "general-purpose"`, `model: "opus"`, description `App Master <p>`, prompt:
   > You are the App Master of <p>. Read `.claude/skills/appmaster/roles/app-master.md` and
   > then the context document at <path>. Return ONLY the decision JSON for wake <wakeId>.
   > You may Read, Grep and run read-only git/Bash for evidence. You must not edit or create
   > files, spawn builders or subagents, run appmaster.mjs, or write the journal.
5. **Decide.** Save each reply verbatim to `<scratchpad>/decision-<slug>-<wakeId8>.json`,
   then `AM decide --project <p> --wake <wakeId> --file <that file>`. `wake already decided`
   or `unknown wake` means a stale or mistyped id: report it, do not retry. On
   `invalid decision` (its `errors` list), `SendMessage` the errors back to the SAME subagent ONCE and decide again
   on its corrected reply; a second refusal parks the project for this wake and goes into the
   digest with the errors. Never edit a master's JSON yourself.
6. **Dispatch.** For each run id `decide` returned: `AM dispatch --run <runId>`, which cuts
   the worktree and starts the builder in the background. A typed refusal (`usage limit`,
   `memory`, `project cap`, `global cap`, `run not planned`) is reported and left for the next
   wake, never retried in a loop.
7. **Watch and settle.** `AM watch` (it moves a run whose pid is gone to `exited`). For each
   run whose state is `exited`: `AM settle --run <runId>`; it ends `merged`, `held` (with an
   ask), `failed` (no commits) or `released` (the builder hit the usage limit). Builders take
   minutes; never block on one, come back on a later wake. A `quiet` or `timedOut` flag is
   reported, never acted on: no kill without the operator's word (see `release`). A
   `limitHit` row means the mark is now set: stop after this wake.
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
   when the operator says the checkout is clean, `AM settle --run <runId> --retry`.
9. **Digest.** Print it (format below).
10. **Sleep.** `ScheduleWakeup` at the earliest `nextWakeAt` over the managed projects,
    clamped to 60..3600 s; about 120 s while a builder is running or a run is `exited`, so
    `settle` happens promptly. On a quiet wake say one line and reschedule.

**Stop** when the usage-limit mark is set (say when it resets if known), memory is at or above
the brake, or the operator says stop. Then run `end`.

### Digest format (terminal only)

Short sentences; lead with what moved. Start from `AM status --text`, whose renderer IS the
base format: one machine line, then one block per project (decided, merged, running with model
and last-output age, held with reason, the note, the master's say, asks open, outbox depth); a
project where nothing moved collapses to one line.

```
Machine: memory 48% used; no usage limit; builders running 1 of 3.
ascent - decided 14:15, dispatched accepted-idea-delivery; next wake 14:40.
  Running 9a41c7e2 accepted-idea-delivery (claude-sonnet-5-5), last output 3 min ago.
  Held 2c7e01bb codebase-security-scan: uncommitted changes in the checkout overlap the branch: ...
  Note: Dispatched delivery of 4c2e81aa/7d90b3f1. Next wake: settle, then KPI readings.
  1 ask(s) open; 4 outbox entries queued.
kp - quiet, next wake 16:05.
```

Then add what this wake did that status cannot show: `QUIET` / `TIMEOUT` flags from `watch`,
refusals from `decide` or `dispatch`, asks the Director answered itself and why. Every claim
cites a run id, SHA, wake id or file; never narrate what the journal does not show.

## `say`, `asks` / `answer`

- **say**: write the operator's words to `<scratchpad>/say-<slug>.md`, then
  `AM say --project <p> --file <it>` (`--text "<msg>"` also works for one line). The next wake's context shows it as an operator note,
  and the say is also queued for the app channel.
- **asks** / **answer**: as in loop step 8. Quote the ask id, the choice and the notes back.

## `outbox`

The outbox is the list of writes the app owns (idea verdicts, a finished task with its SHA,
ask answers, the operator's says) that this skill could not make because it never writes the
app database. Each entry is idempotent (its id is a hash of kind and payload) and is replayed
through the app's own doors when the app is up; replay checks the database before and after
each post. `AM outbox list [--project p]` shows the queue; `AM outbox replay --dry-run` shows
what would be posted (without the app); `AM outbox replay` posts, and refuses with
`app is not running` otherwise. Ask raises and the master's own says have no door and replay
as `skipped`: those live in the journal and the digest only.

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
2. Say what the next wake will do, project by project. Leave running builders running; they
   are settled by the next `/appmaster run`.
3. Nothing to commit unless skill or doc files changed in this session. If they did: the
   isolated-index ritual from `.claude/CLAUDE.md`, one bash invocation, your paths only, then
   `git show --name-status HEAD`. Never push.

## Guardrails

- The Director never merges by hand, never kills a worker without the operator's word, never
  edits a project's code, never writes the app database, never accepts ideas in bulk, and
  never edits a master's decision.
- **Rung 3 means the gate merges, not the Director.** A held run is reported with its reason
  and an ask; it is never forced.
- Evidence over narration: every claim cites a run id, a SHA, a wake id or a file.
- Memory headroom before every dispatch (`dispatch` refuses at the brake; do not work around it).
- Builders run `--dangerously-skip-permissions` in their worktree. The risk, named once: that
  confines the working directory, it is not a sandbox; a builder could still write elsewhere.
- pof, ascent and kp all carry uncommitted foreign work in their checkouts. The merge gate
  exists because of it: never stash, checkout, reset or `git add -A` in a project checkout.
- Bring the operator CEO-level decisions only (scope, money, risk, goal conflicts, a held
  merge); restarts, re-dispatches and cursor bumps are the Director's.
- The app database is read-only. When the app comes up, post nothing by hand: run
  `outbox replay --dry-run` first, read it, then `outbox replay`.

## Known gaps

- Outbox replay against the live app is unverified until the app runs (tests use a fake bridge).
- pof has no goals until it is onboarded here and then through `/master onboard`.
- Nested subagents are unverified and not needed: masters return JSON, the Director spawns.
- The in-app master and this one share no lock. Do not run `/master run` and `/appmaster run`
  on the same project at the same time.
