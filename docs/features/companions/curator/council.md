# Council

**Council is a review board for the features an agent built.** One subject at a
time, five bounded members, a security hard-fail, and a rule the skill cannot
bend: *it never admits on its own*. A clean run is escorted to a human decision,
never converted into one.

This page documents what ships today. The review reaches a person through the
**Council page**: a galaxy of the organisation's knowledge registry with the
councils laid beside it as **lanes** (one queue, every project), and one
council's **verdict card** with the gate - plus a full **browser report** for
reading the round in detail.

The page is built against one artifact the owner approved and kept:
`.claude/council-reference/` (open `index.html` from `file://`, no build, no
server). Every build of this surface is compared against it side by side, and
the shots the comparison was made from live in `shots/` (the reference) and
`shots-app/` (the app).

That artifact is **machine-local**: 32 MB of screenshots and fixture data under
the gitignored `.claude/` directory, so it is present in the owner's checkout
and in no clone. Nothing in the build, the test suite or CI reads it; only the
dev-only fixture door on the Council page does, and that door simply stays shut
where the directory is absent.

---

## What it judges

A **subject** is one of two things:

- a **feature** — a `dev_use_cases` row on the Context Map, a behavioural slice
  that cuts *through* contexts rather than subdividing one;
- an **architecture redesign** — a decision recorded as an ADR.

A feature carries a **tier**: `major` or `standard`. Only `major` reaches the
human gate. A standard feature that passes every mechanical check reaches
`machine_pass` instead and stops there, which is why the ledger offers
**Promote to major** on exactly that state.

### How features are found

The feature scan (`src-tauri/src/commands/infrastructure/use_case_scan.rs`) reads
the context map and proposes features at two altitudes:

- **Major** (at most 6): what a competitor review would name. A major feature is
  followed end to end (the surface, the API or command behind it, the engine, the
  shared services it rides) and must cross at least **2 groups**. The door
  enforces it: a proposal marked major that spans one group is stored as
  `standard`, and the scan output says so.
- **Standard**: narrower capabilities. These may sit inside one group, never
  inside one context.

A slice names **2 to 8 contexts**; contexts that only hold tests may be listed in
addition and do not count. The number of proposals scales with the map, one per
ten contexts between 12 and 24 (a 54-context product gets 12, a 191-context one
19). The scan can also report a **missing shared context**: a service several
features plainly ride that the map does not name. It is printed in the scan
output as `[Gap]` and writes nothing, because the context map has its own door.
A proposal line that lost its closing braces is repaired; one that cannot be read
is counted and reported as `[Malformed]`, never dropped in silence.

These rules were calibrated on 2026-09-21 against two projects. With the earlier
rules (1 to 5 contexts, a flat cap of 12) every one of kp's 12 features sat
inside a single group and 4 of ascent's 12 were a single context; after the
change no kp feature sits in one group and every major crosses 2 to 4.

Most contexts are in no feature's slice (38% of kp's and 59% of ascent's are),
and that is not a defect of the contexts: a slice records a feature's core, not
the platform code, tests and overflow that serve it.

## The rubric

`feature-v1` weighs value `.30` (floor `.40`), craft `.25`, rivalry `.20`,
robustness `.15` (floor `.50`) and economics `.10`. `architecture-v1` weighs
craft `.35`, robustness `.30` (floor `.50`), reversibility `.25` (floor `.50`)
and economics `.10`.

Two conventions matter more than the weights:

- **An unmeasured dimension is not a zero.** It is recorded as unmeasured with
  its reason, it leaves both sums, and `overall` is renormalised over the weight
  that was actually measured. Nothing is scored against evidence nobody gathered.
- **The judged members are uncalibrated until a calibration run exists.** While
  they are, their floors are recorded as *advisory*, `overall` only orders the
  queue, and the outcome turns on the mechanical floors, the absence of a hard
  failure, and a coverage floor of `0.60`.

## The states

State is **derived** on every read from the run chain and the decision chain.
There is no stored state column, so it cannot drift from the verdicts it
summarises.

| State | What it means | What the ledger offers |
|---|---|---|
| `none` | never councilled | Run council |
| `running` | a `/council` session is live for this subject (a frontend overlay, never stored) | nothing; the session is the surface |
| `fail` | a floor was hit or a member failed hard | Run next round |
| `incomplete` | coverage fell under the floor | Run next round |
| `stalled` | three rounds ran and it is still not clean; there is no round 4 | nothing until the operator opens the report |
| `ready` | clean, waiting on a human | Awaiting your decision, which opens the Council page on that subject's verdict card |
| `machine_pass` | clean, tier `standard`, so it never reaches a human | Promote to major |
| `approved` | a human approved it | nothing |
| `approved_drifted` | approved, and the reviewed code has changed since | Run next round |
| `rejected` | a human rejected it, with a reason | Run next round |

## The flow, through the Context Map

1. **The feature chip.** Dev Tools → Context Map, Cross-tab. Each context row
   carries a chip counting the features that slice it. The chip is interactive
   only when that count is above zero: no feature, no affordance. When the
   project has features but none of them is linked to any context, the chip
   reads **not scanned** rather than `0`, because an unscanned link layer is not
   a measured absence.
2. **The review list.** Pressing the chip opens an anchored popover listing
   exactly those features, name ascending: how far each one reaches
   (`n contexts, m groups`), its council glyph, its round marker from round 2 on,
   a **Major** switch, and the one action its state offers.
3. **The dispatch.** A CTA opens the app's shared dispatch chooser with the
   prompt `/council <slug>` (later rounds append `--round <n>`) and the Fleet key
   `council:<projectId>:<slug>`. Nothing runs until the operator confirms a
   transport. Before the transport starts, the dispatch verifies the target repo
   actually has the `/council` skill and refuses with the remedy
   (`node <registry>/scripts/link-registry.mjs`) when it does not. One key per
   subject means a second dispatch while a session holds it is refused.
4. **The ingest.** The skill writes `result.json` into
   `<repo>/.personas/council/runs/<run_id>/`. The ingest door is the only path
   from those files into SQLite: it validates everything before it writes
   anything, refuses an unknown schema version, and marks what it absorbed. The
   30-second fleet ticker sweeps pending runs, and the ledger also asks for a
   sweep the moment a session for a subject exits, so the glyph moves promptly.
5. **The decision.** One command is the only writer of a human decision. It
   requires a reason on a rejection, records the digest of what the decider saw,
   and supersedes rather than rewrites. Approvals are mirrored back to the
   ai-registry as counts and slugs only.

## Reading a glyph honestly

If the review state cannot be read, the popover says so above the list. The
features are still real; only their review state is unknown. A read failure is
never rendered as "nothing has been councilled".

## The Council page

Teams -> Council. The galaxy, the lanes beside it, and a council's verdict
card when one is opened. Redesigned 2026-10-09 (spark `council-readout`): the
old bench was a second door to the same list the decisions panel already
showed, so the panel became the one queue and the round table became a full
page plus a browser report.

### The galaxy

The knowledge registry drawn as a field: one globular cluster per domain,
categories as sub-discs, subjects as stars, techniques on a sunflower spiral
around their subject. A star's rim arc is its council state. On the left an
altitude timeline (Sky, Domain, Category, Subject, Technique) whose needle
rides the camera, the current rung as the counts card and the numbered list of
the level below with care marks. `M` cycles three modes: **Bezel**, the field
seen through a dial whose rim carries the whole registry (`←` `→` turn it, an
arc click flies); **Cross-section**, a bottom dock folded to the subjects
needing care (`S` spreads it); **None**, the galaxy alone. A pinned technique
opens as a document beside a shrunken dial. Code: `council/galaxy/fused/` and
`council/galaxy/engine/`.

Selecting a council puts the field in **council focus**: the stars that
council lands on are lit and named, everything else is dimmed rather than
hidden, and the count of what was dimmed is printed. The stage reserves the
lanes' width, so the camera frames the field beside the queue, never under it.

### The lanes - one queue

Docked right of the galaxy (`council/queue/`). Three filters with their counts:
**Waiting on you**, **Machine pass**, **Decided**. The queue spans **every
project** and is grouped by project; each lane head carries the lane's mean per
member on the same columns, so "which project is weakest at robustness" is a
glance.

Each council is one row: its title, round and the number of must-address items,
then **five heat cells** - one per rubric member, the score printed inside, the
colour a sequential ramp with the 0.70 bar between its second and third step, a
hatched cell for a member that was not measured (never a zero), a red corner for
a floor hit - and the overall. A council whose only round is **lite** is drawn
dashed and hollow. The cells come straight from the list projection
(`CouncilSubjectState.dimensions`, `mustAddressCount`), so drawing the queue
reads no run.

"The bar is advisory while the council is uncalibrated" is said once, in the
legend. Click selects a row (its stars light up), `↑` `↓` `Home` `End` move,
`W` walks the waiting rows; double-click, `Enter` or `Q` opens it.

### The header

A selected council arms one action in the page header: **Open council** when it
has a full round, **Run full council** - the shipped consent door
(`DispatchChooser`, `/council <slug>`) - when only lite passes or nothing has
run. A lite council waits on you too, but for a full round, not a decision.

### The verdict card

`Q` or Open council replaces the stage with one council's verdict card
(`council/verdict/`), a report cover a person recognises at first sight: title,
project, round and mode, a dial for the overall against the bar, the members as
one figure with a shared bar line and floor notches, outcome and trust in one
line, the must-address count with its first items, and the gate. `Esc` or `Q`
returns to the galaxy with the selection kept; rounds switch in place.

**Read full report** opens the round's `report.html` in the browser, where the
format is free: the verdict first, a drawn member score header naming the exact
round, run id and head sha, must-address items as designed claims linked to
their findings, each member's findings and evidence, and the council's own
report sections, with a contents rail. The /council skill renders it beside
`report.md` at the end of every run (`council.mjs report`, skill 0.5.0); older
runs are rendered with `node scripts/council/render-report.mjs <runDir> | --all`.
The projection's `reportPath` is set only when the file exists, so a run
without one shows the action disabled with the reason. The report is for
reading only - **the decision never leaves the app**, bound to the round on
screen.

### The gate

The gate opens **only** when the subject is `ready`, (`tier: major` **or**
`kind: architecture`), **and** its state comes from a **full** round. A lite
pass is the council's feedback, never its verdict, and the decide door refuses
it; its gate stays closed and says to run a full council. Every other state is
a closed gate carrying one sentence that says why, and a rejection shows back
the reason that was written.

- Approve is **armed and then confirmed**: the first press changes the label and
  nothing else.
- Reject opens a box that stays disabled until at least twelve characters are
  written, with a live count of what is still owed.
- **No key commits anything.**
- The write carries the digest of the round **on screen**. If the council moved
  since the person looked, the door refuses, the page refetches and says so, and
  nothing is retried behind their back.

After a decision the council moves to Decided and the stars it touches repaint
in the field.

#### Known gaps

- **The envelope and the scenarios are not stored.** `result.json` carries
  `scenarios` and `envelope`; `dev_council_runs` has no column for either. The
  browser report shows them (it reads `result.json`); the app cannot.
- **A member's unmeasured reason** lives in the verdict payload but not in the
  list projection, so a hatched cell says "not measured" without the why; the
  verdict card and the report carry it.

### The dev fixture

In a development build the page offers **Load the reference fixture**: the
checked-in topology and council fixture the design artifact was built against,
with no backend behind it. Approve and reject work in memory and the gate says
so out loud. With the fixture off and no backend, every read fails into the
page's own honest error and empty states rather than into a blank field. The
shot harness (`council/__shots__/harness.html`) also takes `?live=1`, the local
app database's councils frozen by `node scripts/council/export-live-fixture.mjs`
(gitignored output), plus `?select=<slug>` and `?open=<slug>`.

## In a dev build, decisions repaint the sky

With the fixture on there is no backend to write to, so an approval or a
rejection is held in memory - and folded into the overlay the field is
painted from, so the stars that council lands on change colour on the way
back up, exactly as they do with a backend behind the gate. The page says out
loud that it is fixture mode; nothing reaches the store.
