# Council

**Council is a review board for the features an agent built.** One subject at a
time, five bounded members, a security hard-fail, and a rule the skill cannot
bend: *it never admits on its own*. A clean run is escorted to a human decision,
never converted into one.

This page documents what ships today. The review reaches a person through the
**Council page**: a galaxy of the organisation's knowledge registry, a bench of
councils waiting on a decision, and one council's round table with the gate
pinned in its footer.

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
| `ready` | clean, waiting on a human | Awaiting your decision, which opens the Council page on that subject's round table |
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

Teams -> Council. Three layers, one state, and the layer below is never hidden
by the layer above.

### The galaxy

The knowledge registry drawn as a field: one globular cluster per domain,
categories as sub-discs, subjects as stars, techniques on a sunflower spiral
around their subject. A star's rim arc is its council state. `L` turns on a
lens that magnifies under the pointer without changing the zoom, `/` filters
the level you are standing at, `0` frames the whole field, and `Esc` climbs one
layer with the camera returning exactly where it was.

Opening a council puts the whole field in **council focus**: the stars that
council lands on are lit and named, everything else is dimmed rather than
hidden, and the count of what was dimmed is printed rather than implied.

`Esc` out of the bench gives the reader their own view back **exactly**: the
camera is read off the canvas engine when the drawer goes up and flown back
to when it comes down, and the flight's last frame snaps to its target rather
than interpolating to within a float epsilon of it.

### The bench

`Q` raises the queue **over** the field without hiding it: the sky keeps its
full height behind the drawer, the docked rail stays beside it, and the
engine is told the drawer's height so the camera frames the focused set in
the band that is left. The queue spans **every project**, so a person who
works across repositories has one queue; each row carries its project's name
for that reason.

Three groups, each with its one-line note:

- **Yours to decide** — the decidable rows, and the only ones the headline
  counts. Ordered by hard failures, then floor hits, then the thinnest
  coverage, then the latest round.
- **Not waiting on you** — machine passes and anything sent back to the
  builders. A `machine_pass` is deliberately here and deliberately not in the
  count.
- **Decided** — your past decisions, and whether the code has moved since.

The sentence *"the instrument is uncalibrated, so judged floors are advisory;
mechanical floors bind"* is said **once**, in the bench header. Everywhere else
an advisory floor is simply drawn dotted.

Each row carries a 54 px **glyph** - the overall as a disc, the threshold as
a ring, the coverage as an arc on the rim - and NOT the rose. A row is drawn
from the list projection, which has no per-member scores, so a rose there
would draw five hatched wedges and say "we measured nothing" when the truth
is "we have not read the round". The rose belongs to the preview and the
round table, where the members are actually on hand. Selecting a row aims the
sky behind the bench at that council's stars; `Enter` sits at the round table.

### The round table

A fixed frame the reader never loses:

- the header names where it came from, what it is, how its rounds went against
  the threshold (`[` and `]` move between rounds) and the constellation of
  stars it lands on;
- the left column holds the **rose**, the council's one-line reading, and the
  **coverage ring** against the floor below which there is no overall at all;
- the right column holds the five member seats (`1`..`5`, or the arrows; the
  weakest is marked) and the chosen member's reading: its score against its
  threshold and its floor on a rail, its kind and weight, its findings with
  severity and recurrence, and its **evidence well**;
- the footer holds the gate, always in view.

**The rose** is the whole council in one figure. A wedge's width is its
member's weight, its reach is the score, the ring is the threshold, an arc is
the floor (dotted when the floor is advisory), a striped wedge was carried from
the previous round, and a member that was never measured is **hatched at full
reach**. That last one is the rule the whole design rests on: absence of a
measurement is not a low score, and it contributes nothing to the overall.

**The evidence well** is composed by the app, deterministically, from that
member's own `evidence[]` and `findings[]`, and rendered through the cockpit
widget registry. The skill never authors it and no model is ever asked to. A
metric becomes figures, a URL becomes a followable row, a file becomes an
excerpt, findings become a list, and a screenshot or recording becomes the
`council_media` widget, which reads its bytes through the path-confined
`dev_tools_council_read_media` door and turns them into an object URL. A file
the run recorded but that is not on disk renders a labelled placeholder frame,
never a broken image. `council_media` is app-composed only: it is deliberately
absent from Athena's constitution and from every Rust op allowlist.

**What the round says about itself** sits under the open member's reading:
the council's **synthesis** - the one sentence `synthesis.md` calls the one
that must survive being read alone - and the **must-address** list.

Both are rendered defensively, because the first real run showed why:

- a `must_address` entry arrived at **1,269 characters**. The skill clamps
  generated lines to 200 as of council 0.3.0, but runs supersede and are never
  rewritten, so stored rows keep whatever they were written with. Items are
  one-line items - clamped to two lines, with the whole text on hover.
- another entry **repeated a finding title word for word**, a few centimetres
  below the finding itself. An item that matches a finding already on screen is
  dropped, and the number dropped is printed rather than swallowed.
- the `summary` column held the **feature's own description**, not a verdict:
  `result.json` shipped an empty summary and the ingest door substituted the
  blurb. The door now **refuses** an empty summary rather than substituting,
  and for the rows written before it did it computes
  `summary_is_subject_fallback` at read time. The round table renders the
  summary only when that flag is false; otherwise it says *"No synthesis was
  recorded for this round."* The client never compares the two strings itself -
  the store holds no subject description to compare against, which is why the
  flag exists.

#### Known gaps

- **The envelope and the scenarios are not stored.** `result.json` carries
  `scenarios` and `envelope`; `dev_council_runs` has no column for either and
  `dev_council_verdicts.payload_json` holds only `{delta, evidence, findings,
  techniques, unmeasuredReason}`. On a subject that declares branches, the page
  prints an outcome with no way to say "weak for one branch, never measured for
  another" - the exact failure the scenario machinery exists to prevent.
- **The Features feature tab cannot list must-address.** It renders
  `feature.council`, the list projection, which carries overall / coverage /
  round / state and no run. Listing the items there needs a run fetch in that
  panel, which is a new surface rather than a rendering change.

### The gate

The gate opens **only** when the subject is `ready` **and** (`tier: major`
**or** `kind: architecture`). Every other state is a closed gate carrying one
sentence that says why, and a rejection shows back the reason that was written.

- Approve is **armed and then confirmed**: the first press changes the label and
  nothing else.
- Reject opens a box that stays disabled until at least twelve characters are
  written, with a live count of what is still owed.
- **No key commits anything.** `G` moves the focus to Approve and stops there.
- The write carries the digest of the round **on screen**. If the council moved
  since the person looked, the door refuses, the page refetches and says so, and
  nothing is retried behind their back.

After a decision the row moves into Decided, the headline count drops, and the
stars it touches repaint in the field above the bench.

### The dev fixture

In a development build the page offers **Load the reference fixture**: the
checked-in topology and council fixture the design artifact was built against,
with no backend behind it. Approve and reject work in memory and the gate says
so out loud. With the fixture off and no backend, every read fails into the
page's own honest error and empty states rather than into a blank field.

### The fused instrument (variant)

A **Classic / Fused** switch in the page header (remembered per person; an unknown saved value falls back to Classic) selects a second stage over the same registry galaxy: the fused HUD, the owner's fusion of the 2026-09-22/23 design contest's Cross-section and Bezel (`.contest/Contest/contests/council-hud-r2-r3.md`), ported onto the product's own galaxy engine with a `fused` style profile (labels never cover a star and fall back to the rank number, one level is named at a time, halos and council rings are capped at half the gap to the nearest neighbour, one claim palette is shared by stars, bars and arcs) and measured against the winner's captured style contract. On the left an altitude timeline (Sky, Domain, Category, Subject, Technique) whose needle rides the camera, the current rung as the counts card, soundings for what lies below, and the numbered list of the level below with care marks; at the top right the decisions waiting on the person, named with their overall (`W` lights their stars). `M` cycles three modes, named where they are switched and announced: **Bezel**, the field seen through a dial whose rim carries the whole registry, one notch per technique, re-engraved at every altitude so 12 o'clock is where you stand (`←` `→` turn it, an arc click flies); **Cross-section**, a bottom dock that opens folded to the subjects needing care at desktop width (the three chips filter it, `S` spreads it to one row per altitude with the preview row under the pointer; at 1600 x 900 and above it opens spread); **None**, the galaxy alone. A pinned technique opens as a document beside a shrunken dial. The classic stage, its strip and its counts card are unchanged. Code: `council/galaxy/fused/` and `council/galaxy/engine/profile.ts`; the contract and shots live machine-local under `.claude/council-reference/`.

## In a dev build, decisions repaint the sky

With the fixture on there is no backend to write to, so an approval or a
rejection is held in memory - and folded into the overlay the field is
painted from, so the stars that council lands on change colour on the way
back up, exactly as they do with a backend behind the gate. The page says out
loud that it is fixture mode; nothing reaches the store.
