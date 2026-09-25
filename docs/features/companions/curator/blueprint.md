# Blueprint

**Blueprint is what Curator would do next, drawn as a ledger.** Companions >
Curator > Blueprint. It reads one projection of the organisation's knowledge
registry - `curator_plan_current` - and draws every subject the projection
would act on as one row across nine columns, one per reason the registry's own
scan scores.

Its whole argument is a rule about absence:

> A column can be empty in three different ways, and they are three different
> facts. An instrument ran and found none. Nobody looked. The instrument ran and
> had nothing to compare against. Only the first is a zero.

The page draws each of the three as a different mark - a flat tick, a
see-through box, a hatched swatch - and the model behind it never carries a
number where one of the other two belongs.

## The two layers

**Layer one is the spread ledger and nothing else.** Nine columns, six of them
thin and headed by an icon, ARE the graphic: rank, state, subject, bundle, the
nine marks, the total. Nothing truncates into an ellipsis and nothing is
promoted into a chart elsewhere.

**Layer two is not a panel that arrives from somewhere else.** It is the row you
opened, grown. Click a row (or move to it with `J`/`K` and press `Enter`) and
each of its nine cells becomes the full drawing of its own reason, in the same
left-to-right order, each ruled against the column it came from. The band at the
top of the nested layer IS the row, still carrying its nine marks in their nine
columns; hovering a panel rings the cell it grew out of. `Esc` reverses the
descent - every panel goes back into the cell it came from - and lands the
cursor on the row you left.

With reduced motion the same descent is stated rather than played: the end state
is identical and nothing is transformed.

## What the ledger carries

| Column | What it means | Weight |
|---|---|---|
| citation gone | a consumer reports a citation that no longer resolves | 6 each |
| no application | the subject was never reconciled against real code | 6 |
| expired application | an application is past its refresh clock | 5 each |
| fewer than 4 techniques | the subject is under its design floor | 4 |
| never swept | the librarian has never swept it | 3 |
| technique with no use_when | a technique nothing can route to | 2 each |
| consumer deviation | a project judged its code against this subject and disagreed | 4 each |
| single stack | nothing says whether the subject travels | 2 |
| application near its clock | an application inside the warning horizon | 1 each |

The first six are the thin marks; the last three carry a value of their own (a
range, a name, a clock) and get room for it.

Two bands sit under the rows, on the same nine columns:

- **the quiet tail** - the subjects that score nothing on every channel that
  could be measured, read from `CuratorPlan.quiet` rather than subtracted from
  anything. Wanting nothing is a fact about the subject, so it is drawn. A
  bundle whose demand was never read wears a dotted edge, because there a
  nothing is only a nothing on seven of the nine channels.
- **the unlisted remainder** - subjects the corpus counts that neither the rows
  nor the quiet tail account for. For a whole projection there are none and the
  band is absent; when it appears, every column reads UNKNOWN, because this
  instrument carries the count and not what they score on.

## Before the instrument has run

`curator_plan_current` honestly returns `null` until someone runs the
instrument, and on a fresh registry that is the first thing anyone sees. The
page draws itself anyway: **the real page, drawn empty.** The top bar, the
verdict strip, the console with its run control, the group heads, the nine
channel heads, the ledger frame, both aggregate bands, the foot and the docket
are all present and laid out exactly as they will be; only the figures are
missing.

**No figure reads `0`.** A skeleton of zeros on a page whose entire argument is
that an unknown is not a zero would be the page telling its own central lie on
first contact, so every quantity in this state is absent rather than zero
(`model/unmeasured.ts`), and every place a figure will be wears the ledger's own
UNKNOWN ink - the same see-through hatched box the nine columns use for "nobody
looked". It is not a loading shimmer either: a shimmer promises arrival, and
nothing arrives here until someone presses the control.

Three phases stay distinct, and the ledger body says which one it is in, once,
where the rows would be:

| Phase | Says |
|---|---|
| the first read is in flight | she is reading the projection she last made |
| the instrument is running | she is walking the corpus, about eleven seconds |
| the read came back with nothing | no projection yet, and nothing here is zero |

Only the last is an offer. **The run control is in the console in every phase**,
never duplicated and never moved: `curator_plan_refresh` is an action the
operator pressed, so it wears a real spinner on the button plus `disabled` and
`aria-busy`, and a live region narrates the wait.

Two things are honestly zero rather than unknown even here: the docket's
counter, because its feed is empty by construction (see below), and the foot's
gauges when `curator_policy_get` answered - that door has nothing to do with the
plan, so the operator's real caps are drawn. Where it did not answer, the gauges
read unknown rather than "no cap declared", which would be a claim about
settings nobody has looked at.

### Running it without the page

Pressing the console's control was, until 2026-09-25, the **only** way to run
the instrument - so a registry nobody had opened Blueprint on had a
`curator_plan_run` table with zero rows, and an agent asked to populate it had
no door to knock on. Two routes on the test-automation bridge close that, and
they call the same two Tauri commands the page does rather than re-deriving the
projection:

```bash
curl -s      http://127.0.0.1:17320/curator/plan-status    # never run vs. ran-and-empty
curl -s -X POST http://127.0.0.1:17320/curator/plan-refresh # run it, land the plan
```

`plan-status` answers `{"hasPlan":false}` when nobody has ever run it and
`{"hasPlan":true,"itemCount":0,…}` when a run found nothing - the same
distinction the page draws, over a wire. **Both exist only under
`--features test-automation`** (`npm run tauri:dev:test`); they are not in a
shipped build. Contract and timeouts: `src-tauri/src/test_automation.rs`.

## Her console: the switch, the run, and what she is doing

The strip across the top of the page is three things in one row, and it stays
one row because the ledger's thirteen visible lines at 1000x640 are not a
budget to spend on chrome.

### The run control says what happened, not only that it is happening

`curator_plan_refresh` spawns up to four node processes against the registry on
disk. Cold that is about eleven seconds; a second press against the same commit
inside five minutes is answered from the reading cache in about two. **Both can
produce the same projection**, and until 2026-09-25 the page said nothing about
either fact - so the operator who pressed it twice against an unmoved registry
watched the spinner stop, saw the page not change, and reasonably concluded the
button was dead.

The live region beside the control (the same `aria-live` that narrates the
wait - there is no toast) now reports two measurements the backend takes and the
client cannot honestly derive:

| It says | Because |
|---|---|
| the projection **changed** | the new run's ranked subjects, points, engines and dominant clauses differ from the run it superseded |
| the projection is **the same** | they are identical. Two runs over an unmoved corpus produce identical projections, and that is a fact about the corpus, not a failure of the control |
| whether anything moved is **unknown** | the standing run could not be read to compare against. This is a third arm, never collapsed into "the same" |

and beside it, where the reading came from: a fresh walk with four instruments,
or the five-minute cache against this commit. `CuratorRefresh` carries all
three (`plan`, `fromCache`, `changed`), and `changed` is `null` for the third
arm rather than `false`.

### The run switch

`curator_enabled` lived only on her Setup page, two navigations from the one
surface that draws what it does. It is now in front of the strip as well,
through **the same door** the Setup page uses - `companions_set_enabled`, which
refuses to switch her ON without a mapped knowledge registry, never refuses OFF,
and broadcasts the category status. (It is deliberately *not* `set_app_setting`,
which would persist the same key while skipping all three.)

**It is a bare toggle with no word of its own, and that is measured rather than
minimal for its own sake.** The strip immediately to its right already says
"serving your queue" or "switched off", so the state is drawn in prose and a
label on the toggle would be a second authority for it. It also would not fit:
measured in a browser at 1000x640, this console row is EXACTLY full before the
switch exists (the run control 182px, the strip 781px, one 12px gap, in a 975px
box), a labelled switch is ~322px, and every extra line in this row costs a
ledger row.

**What it claims and what it refuses to claim.** ON means her loop may start
work; OFF means it may not. It does **not** mean her terminals close: a headless
worker already running runs to its end. The strip draws both halves of that fact
side by side - "switched off" and "terminals 2 of 2" - and the terminals tip
explains the pair, so no count is repeated. When her switch could not be read at
all the control says so rather than drawing itself off.

### What this row costs, measured

Driven in a real browser against the shot harness at 2026-09-25, dark and light:

| Width | rows visible, before | rows visible, after |
|---|---|---|
| 1000px, `fannedOut` known | 10 | **10** |
| 1000px, `fannedOut` UNKNOWN (the strip's widest form) | 10 | 9 |
| 1100px and above | 10 | **10** |

The one cell that costs a row is the narrowest window with the widest strip: the
run control is squeezed and its label wraps to two lines. The verdict sentence
costs nothing at any width, because its flex basis is zero - it takes only what
the control does not need, and clips (with the whole sentence still in its tip
and in what the live region announces).

### The runtime strip is live, and it is not polled

Until 2026-09-25 the strip was **a photograph**: `useCuratorLoop` read
`curator_runtime_get` once, on mount, and nothing ever read it again. Measured
against the operator's own machine that day, her loop had dispatched at 13:47,
17:38 and 20:46 UTC and two of her workers were running that minute, while the
console reported none of it - so "the loop is broken" was the reasonable
conclusion and the wrong one. **The loop was never the defect.**

The fix is her own announcement rather than a clock. Her loop emits
**`curator://pulse`** whenever its observable state moves, through the same
event registry that carries `companions://status-changed`:

| kind | emitted when |
|---|---|
| `dispatched` | a worker started |
| `settled` | a worker ended and the row it came from was settled |
| `halted` | a brake bit, or the reason she is stopped changed |
| `resumed` | the brake that was on came off |
| `slept` | a reconcile pass completed, superseding the standing plan |
| `switched` | the operator moved her switch |

**Her whole runtime rides on the payload**, so the strip re-paints with no IPC
at all; only the kinds that move rows the page draws spend a read (the operator's
lane on `dispatched`/`settled`, the projection on `settled`/`slept`). The halt
kinds are announced on the EDGE, never on the state: her tick runs every minute
and announcing "still halted" sixty times an hour would be the poll this design
exists to avoid.

`runtime` on the payload is nullable, and the null arm is load-bearing: when the
backend could not measure her the event still fires - something moved, and a
surface that was not told goes back to being a photograph - but it carries no
reading, and the client re-reads rather than being handed a zeroed stand-in.

There is **no repeating timer anywhere under `src/features/companions/curator/`**,
which is the operator's own instruction ("I would avoid polling") and is checked
by grep. The mount read stays, because the first paint happens before any event
has fired and has to come from somewhere.

## The two drawers

The page has ONE right-hand surface and two things that can hold it. They wear
the same box, the same head, the same open/close grammar and the same Escape,
and only one is ever open: the state behind them is a single drawer slot, not a
boolean each, so pressing the second key swaps rather than stacks.

### Your queue

`Q` opens the operator's own request lane - every request you filed, oldest
first, because that is the order she drains them in and a reader scanning top to
bottom is reading the order the work will happen in. One row per request: its
state, the skill and what it was given, whatever it said when it landed or
failed, when it settled, and **Withdraw** on a `queued` row, which is the only
state she has not picked up. A row that has not started has no start stamp and
no outcome, and those cells stay empty rather than drawing a dash a reader could
take for a measured nothing.

Three empty readings, three different facts: the door did not answer (nobody
knows what is queued), the door answered and nothing is filed, or a list.

**The composer that filed into it is gone from this page** (2026-09-25). The
skill picker, its argument field and its note field are moving to the app-wide
console rather than disappearing; a second place to type a skill invocation
would be a second place for the two to drift. The lane still reads and still
withdraws, and the rule the composer held travels with it: a skill whose file
documents no invocation at all is not bare-runnable, it is unknown, and whatever
composes a request must make the operator state the argument rather than guess a
command the skill's file never promised.

The button beside the docket's carries **no count pill**, and that is the page's
own rule about absence again: the docket's waiting figure is measured from
entries the page already holds, while the queue lives behind a door that may not
have answered. The count lives inside the lane, which can say which it is.

### The docket

`D` opens a drawer with three states (shut, a lane, the full surface) carrying
the decisions Curator brings to a person. Three states a decision can be in get
three visibly different forms: a raised card with armed keys (waiting for a
person), a receipt with a punched edge and a stamp (answered at the gate by a
standing grant - you get the record and the exact command that undoes it), and
flat ledger lines with no card at all (settled).

**It ships empty, and that is deliberate.** `curator_decision` has no writer in
any shipped package and there is no `curator_decisions_list` command, so there
is nothing to read. The drawer says nothing is waiting rather than drawing a
queue of zeros - the page's own rule about absence, applied to itself. The
package that raises the first decision fills the contract in
`model/docket.ts`.

## Keys

| Key | Does |
|---|---|
| `J` `K` `↑` `↓` | move the row cursor |
| `Enter` `→` | open the focused row |
| `Esc` `←` | back to the ledger, on the row you left |
| `1` - `9` | sort the ledger by one channel |
| `0` | clear the sort |
| `D` | the docket |
| `Q` | your queue, beside the docket |
| `F` | docket: full surface |
| `1` `2` `3` | docket: answer the selected card |
| `U` | undo the last answer |
| `?` | the key sheet, and the three ways a cell can be empty |

## The header

Under her name the bar carries **when the scan was taken** and that what you are
looking at is **a projection, not live truth**. It carried two more things until
2026-09-25 - the plan run's UUID and the registry HEAD sha - and neither is
something anybody reads off a header: one is a primary key, the other forty hex
characters, and between them they took the width the two facts above were
competing for. Both are still reachable, in the scan clock's own tip, so a
reader chasing a run or a commit has somewhere to go without being made to step
over it first. With no projection at all the row carries one true sentence and
no clock.

## Whose page this is

`public/companions/curator/portrait.webp` is 1024x1536 of glow on pure black -
an asset with two bad answers on a themed surface, since screening it onto a
light canvas erases it and multiplying it onto a dark one is a black rectangle.
So it is never drawn as an image. It is used as a **luminance mask** - her glow
becomes the alpha channel - filled with `--primary`, which the style doctrine
calls identity rather than decoration, so every theme paints her in its own hue
and the asset contributes shape only.

Two placements, both deliberately small. A 22px **mark** beside the page's name,
always, because that is where a page says whose it is. A full **figure** in the
queue drawer at 17% opacity, bottom-right, drawn ONLY when the lane is empty or
unread - the stylesheet withdraws it the moment a row appears, because a
watermark that survives under content has stopped being a watermark.

A full-page background was considered and rejected: this page's UNKNOWN ink is a
see-through hatched box whose meaning IS transparency, so anything textured
behind it shows through the one mark whose job is to read as "nobody looked".

## What it reads, and what it does not

Three commands, settled independently so a failed side read never costs the
ledger: `curator_plan_current` (the projection), `curator_policy_get` (the
operator's live caps, shown in the footer - where they disagree with the copy
the plan carries, the gauge says which value the plan was made under) and
`curator_projects_list` (how far Curator may reach into each checkout, marked
beside its name in the crossing).

Three things the prototype drew that this projection does not carry, stated
rather than approximated:

- **per-subject crossings.** The registry's map check reports its totals per
  project, never per subject, so every subject takes the prototype's own
  "unnamed, not absent" branch.
- **per-application expiry dates.** `at_risk_application` carries a count; the
  dates are not in the projection.
- **today's spend and today's run count.** The policy carries declared
  ceilings, not consumption, so the gauges show caps only.

## Provenance

Ported from the winner of a blind design contest (`direction-2`, "The Ledger
Opens") and held to the winner's captured style contract - computed type,
surface, width and in-parent position across thirteen roles - at **zero
deviations**, with the descent driven in a real browser from both mouse and
keyboard and under `prefers-reduced-motion`.
