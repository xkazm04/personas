# Features

**Projects > Development > Features.** The roster of what a codebase claims to
do, and the ground each claim is staked on.

A *feature* (a use case, in the store's own vocabulary) is a slice through
contexts. So every context in the map has a **role** relative to the features
that exist, and a feature is not uniform: it is certified as a whole and can
still behave differently by branch. Those two ideas are the page.

The page is ONE read. `dev_tools_feature_board(projectId)` returns the whole
board in a single payload, because a project carries 50-100 features over 200+
contexts and a per-feature round trip would be a hundred IPC calls to paint one
screen.

---

## The header band

One compact row of figures, not sentences, always present whether or not the
read landed:

- **The state strip** — one mark per feature, ordered by whose move it is
  (waiting on you / in trouble / on the work / settled / never councilled). A
  never-councilled feature is drawn **hatched**, never as an empty bar: absence
  of a council is a fact, and a blank reads as a zero.
- **The claim bar** — one stacked bar over `core / platform / tests /
  unclaimed`, with the claimed share as the band's single large number. The
  unclaimed slice is hollow with a dashed rule, because it is the page's to-do
  list rather than a fourth kind of progress.
- **Four counted chips** that are also filters: waiting on you, in trouble,
  unclaimed contexts, untouched groups.

## The feature column

A virtualised list (`@tanstack/react-virtual`) that stays smooth at a hundred
features. Under the default sort it is grouped under sticky headings by whose
move it is; the heading is an item in the same flat list and is pinned through
the virtualiser's range extractor, which is what lets a sticky heading survive
virtualisation at all.

One row is one line of identity (state glyph, name, a **Major** mark) over one
line of figures (the group span as a drawn `n/m` strip, the overall as a number
or the words **not measured**). A name that has to be clipped carries the full
name in the shared tooltip.

- **Sort:** whose move · name · score · span. A feature with no overall sorts
  LAST under *score*, never first as if it scored zero.
- **Keyboard:** `↑`/`↓` move, `Enter` opens the Feature tab, `/` focuses the
  filter.
- The column collapses to give the content the room.

## The content area: two tabs

**Map** and **Feature** are standalone contents, never a three-way split.
Selecting a feature keeps the tab you are on, because moving the reader is not
the same as answering them.

### Map

Every group is a plot of context squares, and a square is coloured by **who
claims it**:

| Square | Meaning |
| --- | --- |
| at the gate | a `core` context whose claiming feature is `ready` and major |
| in trouble | its claimant failed, stalled, was rejected, or drifted after approval |
| on the work | a council is running, or the run is incomplete |
| settled | approved, or a machine pass |
| claimed, never councilled | a feature claims it and no council has ever judged that feature |
| platform | shared machinery nobody should expect a feature to claim |
| tests | a context that holds a behaviour's tests rather than the behaviour |
| unclaimed | hollow. Code no declared feature reaches, and that is not tests and not platform |

A context several features claim carries a violet pip. A group not one `core`
context belongs to is outlined dashed and says so. A plot with more than thirty
contexts scrolls inside its own frame; it never overflows into its neighbour.

With a feature selected, its slice is lit, everything else dims, and **the
dimmed count is said out loud** — hiding a hundred squares and hiding nothing
look identical once they are faded.

Clicking a `core` square selects its feature (or opens a small anchored list
when several claim it). Clicking an unclaimed square opens the Context Map.

Below the plots, the four actionable lists: **unclaimed contexts** grouped by
group, **untouched groups**, **load-bearing contexts** (three or more features
go through each), and **shared services the map does not name** — which is
deliberately a labelled absence, because the board does not carry that finding
yet and a fake list would be the exact conflation this page exists to prevent.

### Feature

- **Header** — name, kind, the state chip, a **Major tier** toggle, and the ONE
  action that state offers. Only a `ready` AND `major` feature offers **Open the
  decision**, which navigates to the Council page focused on that subject. *The
  decision itself is never made here.* No key alone starts a council: running a
  round goes through the shared dispatch chooser, like every other dispatch in
  the app.
- **Rating** — the Council page's own figures, not a second set: the rose (wedge
  width is a member's weight, reach is its score, the ring is the threshold, a
  floor is an arc drawn dotted when advisory, a member never measured is hatched
  at full reach rather than shown as zero), the overall against 0.70, the
  coverage ring against its floor, the round history, and per-member bars with
  their floor ticks.
- **Slice** — the contexts this feature claims, grouped by group, with the
  primary one marked, and a door into the Context Map.
- **Scenarios** — see below.
- **History** — the rounds with their dates, the decision, and the rejection
  reason when there is one.

---

## Scenarios and the envelope

A feature certified as a whole can still behave differently by branch: an AI
interview that is excellent with IT candidates and poor with marketing ones is
not one number. A **scenario** is the feature applied to one condition.

Each scenario carries **axes** (`candidate_family: marketing`), a **scope**, a
**floor**, and the latest run's result.

| Scope | What it means |
| --- | --- |
| `must_hold` | governed by its own floor. Only this scope can be FAILED by one. |
| `tracked` | watched against a flat default of 0.5, not by a declared floor. |
| `out_of_scope` | a standing decision that this branch does not apply. |
| `proposed` | a council named the branch and nobody has ruled on it. It moves no number. |

A result records its **sample size** and its place on the **proof ladder** —
`observed` > `replayed` > `simulated` > `claimed`, drawn as four rungs. The
ladder is RECORDED and never gated: a model playing a marketing candidate is not
a marketing candidate, so `simulated` evidence can flag a weakness and cannot,
alone, certify a `must_hold` branch — but that judgement belongs to the member
and the person, not to a rule.

**The envelope** sits above the cells in one line: how many branches hold, how
many are weak, how many were never measured, how many are out of scope, and the
worst in-scope branch by name. Every scenario lands in **exactly one** bucket,
which is what makes it an envelope rather than five overlapping lists.

> **The envelope is computed once, in Rust.** `aggregate_scenarios`
> (`src-tauri/core/src/models/feature_board.rs`, rules S1-S10) is the same
> function the council ingest door recomputes an incoming result with, and it is
> the same rule set the `/council` skill uses. The page RENDERS
> `BoardFeature.envelope` and never folds one of its own, so the app cannot show
> a second answer. A feature that declares no branches has **no** envelope,
> which is not the same as an empty one.

An **advisory** floor hit — a floor crossed by an instrument that has not earned
the authority yet — is said once for the panel, not repeated on every cell.

Council-proposed branches sit in their own strip with **Adopt as must-hold**,
**Adopt as tracked** and **Dismiss**. Branches are added, edited and deleted
from the panel itself.

---

## Empty, loading and failure

- **Loading** — the permanent chrome renders and a calm ghost sits under it.
  Never a spinner: a spinner is for an action a person just pressed.
- **A read failure** — an inline message with a retry. The raw error goes to
  Sentry; the sentence a person reads is resolved through the error registry.
- **`neverScanned`** — the project has features and not one context link. The
  page says *features exist but are not linked to contexts yet* rather than
  drawing 200 unclaimed contexts and implying the codebase is abandoned.
- **No features at all** — an empty state pointing at the scan.

## The dev fixture switch

In a development build the header carries a **Reference fixture** toggle. It
loads the checked-in design reference
(`docs/design/features-reference/data/`) through the dev server's `?raw` loader
and maps it at the boundary into the product's `FeatureBoard` shape — the file
is snake_case where the binding is camelCase, and the mapper is tested against
the real bytes on disk. Nothing of it reaches a production chunk, and nothing is
ever written to the database.

In fixture mode the envelope is folded once in the mapper, with the same S3-S8
rules the Rust side uses, because the fixture has no Rust behind it.

---

## The Cadastre variant

A **Board / Cadastre** switch in the page header (remembered per person; an unknown saved value falls back to Board) selects a second rendering of the same board: the Cadastre, the winner of the 2026-09-22/23 design contest (`.contest/Contest/contests/features-page-r2.md`), ported to the winner's captured style contract at zero deviations. The context map is drawn as districts (groups) of parcels (contexts) coloured by the claim on each one: the open ground is a dashed outline, a platform context carries a thin edge, and a selected deed's parcels are joined by a survey line. The header keeps the claimed share and the three move tags (`w`, `i`, `u`), which filter the register and light parcels; `u` swaps the register for the list of unclaimed contexts by district. The register keeps the Board's whose-move groups and sort at 32 px rows. `Enter` (or a click on a row or a parcel) opens the deed as a full-scale layer over the page with a view transition: the rating as weighted wedges with the bar ring, floor bands, earlier rounds as faint rings and a hatched petal for a score never measured; the state's one action with its key; coverage, the round trend and spend; the scenarios envelope; and the slice over a miniature of the map. `[` `]` step deeds, Esc closes and returns focus to the row. A figure the board does not carry (the council's finding, spend, a context description) reads `not measured`, never a substitute. Code: `sub_features/cadastre/`; the contract and shots live machine-local under `.claude/features-reference/`.

## Where the code lives

| Piece | Path |
| --- | --- |
| The page and its two tabs | `src/features/teams/sub_features/` |
| The shared rules (move, CTA, roles, sort) | `src/features/teams/sub_features/featureRules.ts` |
| The derived board model | `src/features/teams/sub_features/featuresModel.ts` |
| The one read + warm cache | `src/features/teams/sub_features/useFeatureBoard.ts` |
| The dev fixture | `src/features/teams/sub_features/fixture/featuresFixture.ts` |
| IPC wrappers | `src/api/devTools/features.ts` |
| Commands | `src-tauri/src/commands/infrastructure/dev_tools/features.rs` |
| The fold and the roles | `src-tauri/core/src/models/feature_board.rs` |
| Scenario storage | `src-tauri/db/src/repos/dev/scenarios.rs` |

The state glyph vocabulary, the CTA table and the dispatch are shared with the
Context Map's feature chip and the Council page — see
[`council.md`](./council.md).
