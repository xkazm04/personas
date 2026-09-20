# Council

**Council is a review board for the features an agent built.** One subject at a
time, five bounded members, a security hard-fail, and a rule the skill cannot
bend: *it never admits on its own*. A clean run is escorted to a human decision,
never converted into one.

This page documents what ships today (stage 1). The Council page and its human
gate are stage 2 and are marked **planned** below.

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
| `ready` | clean, waiting on a human | Awaiting your decision (stage 1 points at the report) |
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

## Planned (stage 2)

- A **Council** page: the registry as a zoomable galaxy, with the council queue
  and an evidence canvas inside it.
- The **human gate** itself, which lives only on that evidence canvas, next to
  the comparison object the decision is made against. No list anywhere in the
  app gets an approve button.
- Media from a run (screenshots, demo video) read through a path-confined
  command.
