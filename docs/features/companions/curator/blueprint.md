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

## The docket

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
| `F` | docket: full surface |
| `1` `2` `3` | docket: answer the selected card |
| `U` | undo the last answer |
| `?` | the key sheet, and the three ways a cell can be empty |

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
