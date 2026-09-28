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
/curator growth                take one growth sample from the registry's own instruments
/curator release               put a stranded claim back after an aborted pass
```

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
3. **Check whether the app is also running** (`Get-Process personas-desktop` / look at the
   tray). Both drivers are safe on the *claimed* lanes - the compare-and-set sees to that -
   but the standing lane's two rungs both write `librarian/harvest/queue.md`, and two
   harvest passes in one checkout is the single-writer violation harvest's own law names.
   If the app is up and its loop is on, drive the plan and queue lanes only, or switch her
   off in the app first, and say which you did.

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

## One pass, step by step

```bash
python .claude/skills/curator/loop.py next > claim.json          # decides AND claims
```

Read it. `claim: null` with `held_by` means a brake; `claim: null` with neither means the
ladder is genuinely empty, which is a result - say so and stop rather than inventing work.
A `declined` claim means the vet refused an invocation; report it and move on.

```bash
python .claude/skills/curator/loop.py work --claim claim.json --timeout-min 45
```

That spawns a headless `claude` in the registry checkout with the composed brief - the same
shape the app's fleet spawns, with the subscription-auth and nesting env stripped. Then
**you judge what came back**, which is the whole reason a session drives this and not a
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

`commits` records what the checkout gained as hers. **Read its caveat before trusting the
number**: the range is `since..HEAD` in a checkout other sessions also write, so a commit
somebody else landed inside the window is credited too. The app has the same defect and it
has been observed live. Pass the sha the claim actually started from.

Take one growth sample per loop, not per pass (`loop.py growth`) - it runs the registry's
instruments and costs about ten seconds.

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
  drawer counts as `open_dispatches`, and it will still be there tomorrow.

## Ending a session

Report, in this order: how many passes ran and what each settled as; what the ladder would
take next; whether the ecosystem grew (`loop.py gaps` - the verdict and the flat streak);
anything you escalated; and whether the loop stopped on a brake, the usage limit, or your
own judgement. A number the run did not measure is left absent, not estimated.
