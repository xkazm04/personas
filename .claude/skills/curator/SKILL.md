---
name: curator
description: Drive Curator's work loop from a terminal instead of from the Personas app - read her real ladder out of the same SQLite database, claim the next piece of work, spawn a headless Claude worker at it in the knowledge registry, judge what came back, settle it honestly, and keep going until the subscription's usage limit or a brake stops her. The alternative driver for while the app is closed or its fleet is unavailable. Invoke with `/curator` (status) or `/curator loop`.
---

# Curator - the terminal driver

> The Personas app being closed stops Curator's *fleet*, not her work. Her plan, her
> request queue, her dispatch ledger, her commits and her growth samples are SQLite on
> this machine, and the registry she curates is a git checkout beside it. So a terminal
> loop is not a simulation of her loop: it takes the same claims out of the same tables
> and writes the same rows back, and the app's Blueprint and Gaps drawer show the result
> as if the app had done it. **One ledger, two steering wheels.**

## Invocation

```
/curator                       status: the ladder, the brakes, the gaps; changes nothing
/curator run                   ONE pass: claim the next work, run its worker, settle it
/curator loop [N]              passes until N, or until a brake or the usage limit stops her
/curator gaps                  what blocks her, what her running cost, whether the corpus grew
/curator project               re-project her plan from the current checkout, no app needed
/curator growth                take one growth sample from the registry's own instruments
/curator release               put a stranded claim back after an aborted pass
/curator release-stranded      release every open dispatch whose worker process is provably gone
/curator pool                  run-pool: several conform workers at once, RAM-scaled, until a brake
/curator pool stop|status      ask a running pool to stop after its workers settle / read it
/curator --multi [N]           N rounds; each round codex, grok and agy judge DIFFERENT conform subjects at once
/curator --multi report        the provider-by-topic scoreboard the rounds built
```

`next` takes `--lane queue,plan,method,refill` to drive part of the ladder. The filter
only SKIPS rungs, never reorders them, so a restricted run still drains the operator's
queue before her plan. Two situations need it and both have happened: the app is up and
owns the standing lane, or her plan is still the one projected from an older checkout and
only the queue file is current.

`next --engine conform,deepen,apply,reconcile` filters the PLAN lane the same way (skip, never reorder). `--engine conform` is the one that cannot publish registry content: `conform` workers run in this repo, write only their own run file under `.ai/conform-runs/` and are told never to commit or push, while `apply` and `deepen` workers commit in the registry and may push its default branch. Use it when the registry's `main` carries commits that are not Curator's.

`next --terminal-owns` waives ONLY the `curator_enabled` brake, for when the operator switched
the app's tick off precisely so this terminal drives her (quiet hours and backpressure still
hold, and the waiver is printed). `work` sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`: the
CLI's default 600 s background ceiling killed a `harvest auto` mid fan-out, so `--timeout-min`
is the only bound.

Plan items of engine `apply` and `conform` are dispatchable: the item cannot carry its own
argument, so `loop.py` derives it at claim time. `apply` becomes `/intake apply <technique>`
with the first technique in the subject's index entry that has no application row (none left
= the item is skipped, never guessed). `conform` becomes `/conform --subject <slug>` and runs
in THIS repo. **It never writes `.ai/registry-map.json`.** It writes ONE run file,
`.ai/conform-runs/<dispatch-id>.json` (the brief carries the shape), and the registry's
`scripts/merge-conform-runs.mjs` - `loop.py merge` - is the map's only writer: it takes a
lock, keeps the newer verdict when two disagree and records the older in
`.ai/conform-detail.json`, refuses `unknown` and anchors on a blank line, appends the run's
`consults` to `.ai/consults.jsonl`, and archives the file in `.ai/conform-runs/merged/`. A file
merged twice changes nothing. The worker is told not to commit or push, so the operator reads
and commits the map diff.

`conform` items are also filtered by scope: the scan ranks a subject without knowing which
bundles this repo consumes, so `loop.py` skips any item whose domain is not in
`.ai/manifest.yaml` `knowledge.domains` (an unreadable or absent declaration filters nothing).
Measured 2026-10-05: `recruiting/candidate-consent-and-retention` idled for exactly this reason.

There is **no bare worker form**: every pass goes through the ladder, because a run that
picked its own subject would be a person using her credentials rather than her loop.

## The instrument - never hand-roll a query

`python .claude/skills/curator/loop.py <subcommand>` owns every database read and write,
the ladder, the brakes, the worker spawn and the bookkeeping. It prints JSON. Do not open
`personas.db` yourself: the claims are compare-and-set inside IMMEDIATE transactions
precisely so this driver and a running app cannot take the same item, and a hand-written
`UPDATE` is how that guarantee gets lost.

## Boot ritual (every invocation)

1. `python .claude/skills/curator/loop.py status` - the registry it resolved, the brakes,
   the standing plan, the queue file, and **what the ladder would take next**.
2. Read the `brakes.held_by` list. If it is non-empty, say which brake and stop; do not
   work around one. `curator_enabled` being off means the operator has not switched her on.
3. **`app_running`** is in that same output - do not shell out for it. Both drivers are
   safe on the *claimed* lanes (the compare-and-set sees to that), but the standing lane's
   two rungs both write `librarian/harvest/queue.md`, and two harvest passes in one checkout
   is the single-writer violation harvest's own law names. If the app is up, drive the plan
   and queue lanes only (`next --lane queue,plan`), or switch her off in the app first, and
   say which you did.
4. **`corpus` and `corpus_is_stale`** - how far the checkout the plan was ranked from is
   from its own origin. See **The corpus brake** below. This is the first thing to read,
   because it decides whether any pass is worth paying for.

## The ladder (the same four rungs the app's tick runs)

1. **The operator's queue** - requests they filed, oldest first, drained whole before
   anything of hers. A request may name a skill whose file documents no invocation, because
   a request IS an explicit invocation somebody typed; her own lanes may not.
2. **Her plan** - the highest-scoring subject whose engine can be turned into a command.
   Two engines can today: `reconcile` takes the bundle, `deepen` takes the subject
   **address** (`<domain>/<slug>`, the item's own id, never rebuilt from its parts).
3. **The method lane** - when her plan is dry, repair the instruction that is blocking it
   rather than reaching for more sources. Only an *undocumented invocation* is hers to fix;
   an item that cannot carry its argument is a gap in Personas and is reported, never
   dispatched.
4. **The standing lane** - `/harvest auto` to drain the registry's source queue, or
   `/harvest research` to refill it, chosen by counting the queue file, and never re-run
   against bytes that rung already saw.

## The corpus brake - read this before running a loop

**Her plan is projected from the LOCAL checkout.** If that checkout is behind its origin,
the ranking is computed from a corpus somebody else has already moved, so the highest-
scoring subjects are the ones upstream runs have already handled - and every worker sent at
one comes back having honestly found nothing, at full price.

> Measured on this skill's first live run, 2026-09-28. The registry's local `main` was
> **242 commits behind `origin/main`** and 4 ahead with unpushed local work. That day's 43
> dispatches settled **39 `blocked`, 2 `idled`, 1 commit** - about a 2% yield. The first CLI
> pass idled and its worker diagnosed the cause from inside the registry; nothing in either
> driver was looking at it. The app's loop had been running at ~13 dispatches an hour into
> that.

`next` now refuses when the checkout is more than 50 commits behind, and says the number.
**That refusal is the result** - report it and stop. The fix is hygiene, not code, and it is
the operator's: the checkout needs its local commits pushed and origin merged in. Do not
push on their behalf. `--allow-stale` exists because an unreachable origin must not make the
loop unusable, and `--fetch` measures against a freshly fetched origin rather than a stale
remote-tracking ref; neither is a reason to run a loop you already know will idle.

**There are TWO staleness axes and a merge only fixes one.** `status` reports both:

| | What it compares | Fixed by |
|---|---|---|
| `corpus` | this checkout vs its origin | merging |
| `projection` | the plan's `registry_head_sha` vs this checkout's HEAD | re-projecting |

A checkout can sit at 0 behind while the plan ranked from it is hundreds of commits old,
because a projection is a snapshot taken at a moment. Measured 2026-09-28: the merge took
the corpus to 0 behind and left the projection 258 behind, and the plan lane was still not
worth a dispatch. `next` refuses on EITHER axis, and the projection message names the
remedy.

**`loop.py project` is that remedy, and it needs no app.** It runs
`personas-curator-project`, a binary in this repo that wraps the app's OWN instrument and
projection - not a re-implementation, because a second copy of the 1,300-line scoring
function would be a second source of truth for the number her whole loop is ranked on. It
takes about 80 seconds. Build it once:

```bash
cargo build --release -p personas-engine --bin personas-curator-project --manifest-path src-tauri/Cargo.toml
```

Re-project after any merge that moves the registry, then read `status` again: both axes
should say 0. The standing lane never needed this - it reads the queue file directly - so
`--lane refill` stays available even when the projection is stale.

## One pass, step by step

```bash
python .claude/skills/curator/loop.py next > claim.json          # decides AND claims
```

Read it. `claim: null` with `held_by` means a brake - including the corpus brake above;
`claim: null` with neither means the ladder is genuinely empty, which is a result - say so
and stop rather than inventing work. A `declined` claim means the vet refused an invocation;
report it and move on.

Pass that file straight to the other subcommands. They accept the wrapper `next` writes as
well as a bare claim, so there is nothing to hand-edit between steps - the first live run
normalised it by hand three times, and each of those was a chance to hand a half-written
file to a settle.

```bash
python .claude/skills/curator/loop.py work --claim claim.json --timeout-min 40 \
  --pidfile worker.pid            # ALWAYS in the background - see below
```

That spawns a headless `claude` in the registry checkout with the composed brief - the same
shape the app's fleet spawns, with the subscription-auth and nesting env stripped.

**Run it in the background.** A `/deepen` pass takes minutes and the harness's foreground
shell tops out at 600 s, so a foreground call is killed before the worker finishes and the
claim strands. `--print` also buffers the whole run, so there is no incremental output: the
worker is a black box until it exits. What you get instead is the pid (on stderr and in
`--pidfile`) and the registry's git log - watch those, not the empty stdout file. The first
live run needed three process-grep attempts to find its own child, which is why the pid is
printed now.

Then **you judge what came back**, which is the whole reason a session drives this and not a
cron job:

| What the output shows | Settle as | Evidence to write |
|---|---|---|
| it landed work, with commits | `landed` | what it landed, and the sha range |
| it ran and honestly found nothing | `idled` | the instrument's own sentence for why |
| it refused, or the brief was wrong for it | `declined` | its reason, verbatim |
| it crashed, or the output is unreadable | `blocked` | what failed, not a guess at why |
| `usage_limited: true` | **`release`, not a settle** | the limit is not a verdict on the subject |

```bash
python .claude/skills/curator/loop.py settle --claim claim.json --state idled --evidence "..."
python .claude/skills/curator/loop.py commits --claim claim.json --since <head-at-dispatch>
```

A **conform** pass is judged through the merger, not from stdout: run
`loop.py merge --only <dispatch-id>.json` first and read its per-file counts (`merged`,
`unchanged`, `older`, `declined`, `skipped` with reasons). Verdicts it accepted are `landed`;
a run file whose every verdict it refused is `declined`, with its reasons.

`commits` records what the checkout gained as hers. **Read its caveat before trusting the
number**: the range is `since..HEAD` in a checkout other sessions also write, so a commit
somebody else landed inside the window is credited too. The app has the same defect and it
has been observed live. Pass the sha the claim actually started from.

Take one growth sample per loop, not per pass (`loop.py growth`) - it runs the registry's
instruments and costs about ten seconds.

## The pool - several workers at once

`loop.py run-pool` is the unattended form: it claims with the same ladder, runs a worker per
claim in parallel, settles each as it ends, merges after each settle, and re-projects when the
projection goes stale. Measure it with `--dry` first, which claims nothing and lists what it
would take, in order, with the memory figures it decided on.

**What may run beside what.** Only `conform` workers run in parallel: each runs in THIS repo
and writes only its own run file, so N of them share nothing but the merger's lock. Every lane
that writes the registry checkout (deepen, apply, reconcile, the queue, method and standing
lanes) has ONE serial slot, and while it is taken only conform plan items are admitted. No
two running workers - nor a worker and any other driver's open dispatch - ever hold one
subject. The default is `--lane plan --engine conform`; anything wider is opt-in.

**How many.** `N = min(--max, floor((free_gb - 6) / 2.5))`, recomputed from a fresh sample
(the median of five, /appmaster's method) before EVERY claim. The constants are named and
argued in `loop.py` (`RESERVE_GB`, `PER_WORKER_GB`, `MAX_WORKERS = 4`); unreadable memory
allows one worker. A running worker is charged twice on purpose - it has not grown yet.

**How it settles, and how that differs from a pass you drive.** A pool settles mechanically,
from evidence it can read: for conform, the merger's counts for that worker's run file (no
run file is `blocked`, a lock held by a live merger defers the settle rather than guessing);
for a registry lane, the commits since dispatch, with the `commits` caveat in the evidence.
Every settle carries the worker's last words, and `~/.personas/curator-pool/done/` keeps each
worker's whole stdout. That is weaker than a session reading the output, which is why the
operator reads the map diff before committing it.

**State lives outside the repo** - `~/.personas/curator-pool/` (`CURATOR_POOL_DIR` overrides):
`pool.lock`, `pool.jsonl` (every event), `workers/` while a worker runs, `done/` after, and
`STOP`. Workers run in their own process group, so a pool that dies leaves them running; the
next pool adopts them by pid AND creation time and settles the ones that ended meanwhile.

**The usage limit.** `--on-limit stop` (the default) stops after the running workers settle,
as a pass does. `--on-limit doze` stops claiming, then every `--doze-min` (30) sends a one-line
probe - no claim, no row - and resumes when the limit has lifted. A limited worker's item is
released, never settled.

```bash
# the weekend run - in the background, so a reaped shell does not take the pool with it
mkdir -p ~/.personas/curator-pool
python .claude/skills/curator/loop.py run-pool --terminal-owns --on-limit doze \
  >> ~/.personas/curator-pool/pool.out 2>&1
python .claude/skills/curator/loop.py run-pool --status   # pool, workers, last events
python .claude/skills/curator/loop.py run-pool --stop     # no new claims; exits once its workers settle
```

To stop it NOW instead: end the pool pid from `run-pool --status`, end its workers' pids, then
`loop.py release-stranded`. If the map is ever reverted under a run (a sibling's hook stash
that failed to restore), `loop.py merge --reapply` folds the `merged/` archive back in.

## --multi - several providers, one round at a time

`/curator --multi` widens conform coverage with models that are not Claude. Its code is
`multi.py`, reached through `loop.py multi <cmd>`; the SESSION reviews every round before
starting the next.

```bash
L=".claude/skills/curator/loop.py"
python $L multi start --terminal-owns [--keep-raw]   # one round, DETACHED; prints pid + summary path
python $L multi finish                               # settle a round whose driver died, from its journal
python $L multi withdraw --run <file.json> --contexts a,b --why "<review finding>"
python $L multi revalidate --round <n> --provider <p> --why "<validator defect>"   # needs --keep-raw
python $L multi clean                                # delete raw dirs of finished rounds (after review)
python $L multi report                               # scoreboard: provider, provider x category
python $L multi reset-dropped                        # bring a limited provider back after its reset
```

**Always `start`, never `round`, from a session.** `round` runs in the foreground. Measured
2026-10-12: Claude Code's low-memory reaper killed the background shell running round 2, and the
round's driver with it. `start` launches a driver no shell owns (breakaway from the job), and the
session waits on `rounds/<n>.json` with an until-loop. Each seat is journaled to
`rounds/<n>/seats.json` the moment it spawns; if a driver still dies, `finish` waits for live seats,
settles finished ones from their files, and RELEASES a seat that left no answer (its subject goes
back, unscored), because nothing says whether the seat or the driver's death ended it. `start`
and `round` both refuse while an unfinished round exists.

**Seats.** `codex` (codex-cli, `gpt-6.1-sol`, effort high), `grok` (grok-cli, `grok-4.7`, high) and
`agy` (Antigravity CLI, the newest `gemini-X.Y-flash-high` that `agy models` lists). `--providers`
narrows them. Each round rotates which seat takes the top-ranked subject, and prefers a different
registry category for each seat, so the scoreboard sees every provider on every kind of topic.

**Why conform only.** A conform verdict can be checked mechanically against the code, so a weaker
model's answer is evidence to verify rather than a change to trust. Registry-writing lanes
(apply, deepen, reconcile) are not offered to these seats.

**Where the subject comes from.** First her plan (in-scope `conform` items). When that is dry for
this repo (it was on 2026-10-12, when all 27 planned conform items were in domains this repo does not
consume), the subject comes from the map's own backlog in /conform's bare order: stale pairs, then
strong unknowns, then probable unknowns, with `priorNotApplicable` pairs discounted. Each one is
FILED into the operator's request queue (`conform --subject <slug>`, the note names this
instruction) and claimed through the queue lane, so every seat has a real ledger row. A subject
`--multi` has tried is not retried (`state.json` `tried`).

**What makes a weaker seat safe.**
- The orchestrator builds the dossier: the golden path, every technique file, and up to five pairs
  with each context's REAL file list from `context-map.json`. The seat resolves nothing itself.
- Seats are read-only and return one JSON object through their CLI's schema flag (codex
  `--output-schema` in a `read-only` sandbox, grok `--json-schema`, agy `--json-schema`).
  `multi.py` writes the run file; the registry's merger stays the map's only writer.
- `validate()` checks every anchor: a tracked file, a non-blank line, and the seat's verbatim
  `quote` of that line. A quote found up to three lines away, or uniquely elsewhere in the file,
  REPAIRS the line number (counted as a repair). A quote found nowhere, a placeholder, an absolute
  path that is not in the repo, a technique that is not the subject's, or a context outside the
  dossier is REFUSED. A conformant pair below /conform's evidence floor, or one that calls a
  technique a deviation, is declined with the reason. A refused pair becomes a `declined` row,
  never a verdict.
- **Whole-answer refusals.** A seat that provably opened nothing (codex ran no command, grok
  answered in one turn), or whose `notes` disclaim the answer (draft, not verified, do not keep).
- **The floor counts DISTINCT anchors.** One line reused for several techniques is one piece of
  evidence, and a conformant pair also needs at least two techniques shown realized.
- **Smears.** One anchor outside every context it is pinned on, carried by two or more pairs, is
  a repo-wide fact and a verdict about none of them: all those pairs are declined.

Each rule above was a measured failure, not a guess (round 1-2, 2026-10-12):
| Seat | What it did | Rule it produced |
|---|---|---|
| grok 4.7 | with `--json-schema` it answered in ONE turn, opened no file, and its notes said "DRAFT ONLY - do not keep"; its one surviving verdict echoed the stale verdict the dossier showed it | grok runs without `--json-schema`; read-proof; self-disclaimer; "an earlier verdict is a claim to re-check" |
| agy flash | four `conformant` verdicts reached the floor by anchoring 5-6 `not-applicable` techniques each on `mod tests {` or one vitest include line | distinct-anchor floor; two realized techniques |
| codex gpt-6.1-sol | pinned one true repo-wide finding (`lefthook.yml:32`) on four UI contexts with one sentence | smear rule; "judge each context by its own code" |
| the validator | refused codex's good round-3 answer whole because its notes honestly said "enforcement was not verified" and "no placeholder anchors" | the disclaimer rule reads only statements about the ANSWER; `revalidate` lands what a wrong rule refused |

**A validator rule can be wrong too.** When the review finds the refusal was the rule's fault, fix
the rule, then `multi revalidate` the kept raw answer: it re-judges under the current validator,
lands the passing pairs in a NEW run file (`<dispatch>-rv.json`, so the original archive still shows
what the old rule did), rewrites the ledger row's outcome to say so, and scores it for the seat.
Keep `--keep-raw` on rounds you intend to review closely for exactly this reason.

**`withdraw` is the review's undo.** The merger has none, and `--reapply` re-folds its archive,
so `multi withdraw` changes all three places under the merger's own lock: the map row goes back
to the verdict it replaced (or `unknown`), `conform-detail.json` records the withdrawal, and the
archived run file moves the pair to `declined` so it cannot come back. It also writes a review
row to the scoreboard, so a withdrawn verdict counts against its seat. A row a later run has
already overwritten is left alone and reported.

**Settling.** Through the merger, exactly as the pool settles a conform worker: `landed` when it
accepted verdicts, `declined` with its reasons, `blocked` when nothing survived. The evidence is
prefixed `[provider:model]`, so a reader can tell which seat judged it.

**The usage limit.** A seat whose output carries a quota banner and no usable answer is DROPPED:
its claim is released, its filed request cancelled, its partial answer thrown away, and
`state.json` `dropped` keeps it out of later rounds. The other seats continue. `multi
reset-dropped` brings a provider back once its window resets.

**Cleanup is part of the round, not an afterthought.** After the round settles, `multi.py` deletes:
the round's raw directory (prompts, stdout, the schema), each provider's own session files for
that seat (grok `~/.grok/sessions/<cwd>/<id>` by the session id the round assigned it, plus that
session's lines in the cwd's shared `prompt_history.jsonl` - only its own `session_id`, because the
operator's grok history lives in the same file; agy
`~/.gemini/antigravity-cli/{annotations,brain,conversations,presence}/<id>*` by its conversation id;
codex runs `--ephemeral` and writes none), and any provider junk that appeared at the repo root
(`.grok/`, `.agents/`, `.gemini/`, `.codex/`, `tmp*.{txt,json,md,...}`). Anything else new in the
repo is LISTED in the round summary and never deleted, because siblings write this checkout too.
What stays: `rounds/<n>.json` (the summary) and one `scoreboard.jsonl` row per seat. `--keep-raw`
keeps the raw directory for the review; `multi clean` then deletes it, and the driver logs
(`round.out`, `finish*.out`) once no round is pending.

**Between rounds the session reviews, then hardens.** Read `rounds/<n>.json`: per seat, what came
back, what was accepted, every repair and refusal. Spot-check two accepted anchors per seat by
printing the line (does it SAY what the evidence claims? the validator only proves the quote is
real). A refusal pattern that repeats across seats is a defect in the brief or the validator, so
fix it before the next round. A seat that is merely weak is a scoreboard fact, not a defect.
`multi report` aggregates the scoreboard by provider and by provider x category; carry the feel
into memory once there are enough rounds to say something.

**The feel after the first five rounds (2026-10-12, n = 5 seats each, one repo, all
`software-engineering` subjects - a weak prior, not a ranking):**
| Seat | Kept / returned | Avg wall | Reads as |
|---|---|---|---|
| agy `gemini-3.8-flash-high` | 20 / 25 (4 withdrawn) | ~7.5 min | fastest; strongest on llm-agent subjects (orchestration, companion, memory, eval); padded its one test-harness conformant run, then followed the distinct-anchor rule cleanly |
| codex `gpt-6.1-sol` high | 18 / 25 (4 withdrawn, 4 revalidated) | ~11.5 min | most exhaustive (78+ commands, every technique file); best on UI and standards subjects; over-reaches with repo-wide findings unless told to judge each context by its own code |
| grok `grok-4.7` high | 14 / 20 (1 withdrawn, 1 lost) | ~15 min | slowest, but precise once it can use tools: real security (`bundle.rs` fail-open allowlist) and module-design findings; useless under `--json-schema` |


## Conduct

- **Judge, do not rubber-stamp.** The app's tick settles mechanically because nothing is
  watching it. You are. A worker that reports success while its own instrument said the
  queue was empty is an `idled`, not a `landed`, and a worker that contradicts the
  measurement it was dispatched on is the most valuable result this loop produces - carry
  the contradiction into the evidence rather than flattening it.
- **Never invent an invocation.** If `loop.py` refuses a skill because its `SKILL.md`
  documents none, that is the answer. Unknown is not permission. The fix is to document the
  file (the method lane), not to guess a command line.
- **Never settle what you did not read.** An item settled from the exit code alone is a row
  that says something about a run nobody looked at.
- **Escalate rather than decide** anything that needs a person: a request whose intent is
  unclear, an impediment that is not hers, a worker asking for a decision. Say it plainly in
  your report; there is no decision table write on this channel.

## What stops her

**There is no daily budget and none is wanted** - the operator's standing decision. No
spend, run or commit cap is declared, so none of them can halt her, and `loop.py status`
reports each as "no ceiling declared" rather than as a cap of zero. What does stop her:
`curator_enabled` off, her quiet hours, backpressure from decisions awaiting a person, and
**the subscription's usage limit**, which is the intended hard stop.

A pass that comes back `usage_limited` is not a failure. Release the claim, tell the
operator the limit is reached and roughly when it resets if the banner said, and stop the
loop - do not retry in a tight circle. The app's fleet has a limit-retry lane that dozes
and resumes; this driver does not, and pretending otherwise would burn the reset window.

## Honesty rails

- **Degrade, never pretend.** No database on this machine, no registry mapped, no `claude`
  on PATH, a locked database: say which, once, and stop. Retry a lock once.
- **Say which driver did it.** Every dispatch this skill records carries `cli:<uuid>` as its
  session id, so a reader can tell a terminal pass from a fleet one. Never describe a
  terminal pass as something the app did.
- **The app's doors are the authority while it runs.** `loop.py`'s attrition read comes from
  the `fleet_sessions` table rather than the app's in-memory registry, because without the
  app there is no registry to ask. If the app is up, its Gaps drawer is the better reading
  and this one may lag it.
- **Stranded claims are yours to clear.** If a pass is interrupted, `release` the claim in
  the same session. An item left `dispatched` with nothing running is the leak the Gaps
  drawer counts as `open_dispatches`, and it will still be there tomorrow. For one nobody
  holds a claim file for, `loop.py release-stranded` (`--dry` first) releases it **only when
  its worker process is provably gone**: a pool record whose pid and creation time no longer
  match, and no live claude/node process whose command line names its dispatch, session,
  fleet session or argument. Never on the row's age - a row records the last transition,
  not a heartbeat, and three live workers were once killed on that reading.

## Ending a session

Report, in this order: how many passes ran and what each settled as; **the corpus state**
(behind/ahead, and whether that is what stopped you); what the ladder would take next;
whether the ecosystem grew (`loop.py gaps` - the verdict and the flat streak); anything you
escalated; and whether the loop stopped on a brake, the usage limit, or your own judgement.
A number the run did not measure is left absent, not estimated.

**Stopping early on evidence is a good outcome.** A loop that keeps dispatching after a pass
has shown the next one will idle is buying a known-zero result with the operator's
subscription. Say what you learned and why you stopped; that is worth more than a pass
count.
