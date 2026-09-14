# Migrating the recipe corpus into the ai-registry

> Started 2026-09-07, in a session forked from the App Master e2e arc so the two do not
> collide. Companion record: `app-master-e2e.md`. This file holds the decisions; the
> operating contract the agents work from is
> `scripts/templates/_migration/FIELD_GUIDE.md`.

## What this is

The Personas application holds 111 Recipe v3 objects in `scripts/templates/_recipe_seeds.json`,
all `status: draft` with no version. That was deliberate: the corpus was declared a **starting
line** on 2026-09-06, transformed into v3 shape but never researched against the outside world.

This migration moves 105 of them into `ai-registry/recipes/`, and the move is not a copy. Each
recipe is **enriched** on the way: researched against current practice, sharpened against what
the live App Master cycles taught, and given the use cases that let somebody find it in a
corpus of two hundred.

## The decisions

**1. Six recipes are descoped.** `codebase-architecture-review`, `codebase-security-scan`,
`codebase-static-analysis-sweep`, `technical-decision-capture`, `accepted-idea-delivery` and
`project-kpi-stewardship` are the App Master's responsibilities and are under live end-to-end
test. Their shape is still moving, and freezing a moving shape into a versioned registry
artifact is how a registry starts lying. They migrate after those cycles settle, and the
cycles are expected to teach the responsibility design something the migration should carry.

**2. Migration is the promotion.** A recipe leaves as `draft` with no version and arrives as
`seed` at `0.1.0`. The starting-line contract already said a recipe leaves draft when it is
promoted, and that promotion is when it receives its first version; enrichment is that
criterion being met. `LESSONS.md` stays empty at every recipe, because a lesson records a run
and no run has happened. An invented lesson would be worse than an empty file.

**3. The schema gains `use_cases`, and the gate enforces it.** Three to six bullets naming the
situations that should reach for the recipe. `need` and `core_action` describe the craft;
these describe who should adopt it, and they are not the same sentence. A corpus of two
hundred recipes is selected FROM, and neither an operator scanning for what fits their week
nor an agent proposing an adoption can tell from a well-written `need` whether a recipe is for
them. Enforced in `ai-registry/scripts/check-recipes.mjs`, documented in
`ai-registry/docs/recipes-lane.md` and mirrored in `scripts/templates/_RECIPE_V3_SPEC.md`.

It is a sibling of `description`, not a fifth field inside it: "description is four fields,
always" is a stated contract with a rationale, and it was cheaper to respect it than to break
it. It is deliberately absent from `recipes/index.json`, which is loaded whole to pick a
recipe by shape; four prose bullets per recipe would multiply that file by an order of
magnitude to duplicate what opening the recipe already gives.

**4. The copies stay dual, and a script keeps them from drifting.**
`scripts/templates/_migration/sync-back.mjs` folds the enriched registry recipes back into the
Personas bundle. It defaults to **content only**, leaving the Personas copies at `draft` with
no version: meeting the promotion criterion and being promoted are different acts, and the
second is the operator's. `--promote` lifts status and version too.

It must not run while a dev app is running from this checkout. The bundle is `include_str!`-ed
into the Rust binary, so writing it triggers a rebuild and restarts the app, which would kill
any App Master fleet worker mid-run.

## How it is being run: ten lanes and a shared brain

Ten Opus agents work in parallel, one lane each, 6 to 13 recipes per lane, split by topic so
each agent's research compounds across neighbouring recipes. `LANES.json` assigns every slug
exactly once, and every agent only ever creates files under its own recipes' directories, so
ten writers share one registry checkout with no locking and cannot collide.

Three shared artifacts make ten agents produce one corpus instead of ten:

- **`FIELD_GUIDE.md`** is the contract: what enrichment means, the pipeline, the field
  mapping, the gate traps, the house voice, and a digest of the App Master lessons that
  generalize past their own six recipes.
- **`rx.mjs`** is the shared tool: `show`, `scaffold`, `render`, `status`. It owns the whole
  camelCase-to-snake_case conversion, so a missed rename is one bug rather than a hundred, and
  it renders `RECIPE.md` from `recipe.json` so the rendered view can never drift from its
  input. It scaffolds `use_cases: []` **on purpose**, so the gate is red until an agent does
  the part that cannot be automated.
- **`notes/`** is the cross-learning surface: one file per lane, each agent appends only to
  its own and reads all ten, before starting and every few recipes. Collision-free by
  construction, and it means the second half of a lane can be better than the first because of
  what another lane found. Entries are tagged `RESEARCH`, `PATTERN`, `TRAP`, `GATE`, `DECISION`.

## A defect found on the way

`scripts/templates/_RECIPE_V3_SPEC.md` documented every field in snake_case while all 111
bundle payloads serialize camelCase, because `RecipeSpec` and its neighbours derive
`#[serde(rename_all = "camelCase")]`. The spec never said which was authoritative. The first
author to notice had already written to the wrong one, and recorded it as an ambiguity rather
than a defect. The spec now carries the table and names the one file where the mapping lives.

## Result

All ten lanes finished. **106 recipes in the lane**: the 105 migrated plus the worked example.
`node scripts/gate.mjs --lane recipes` is green, 2 of 2 steps, index current.

Shape of the corpus, from `recipes/index.json`:

| | |
|---|---|
| domains | software_engineering 37, sales_marketing 17, creative_design 11, general_professional 10, finance_accounting 8, legal_compliance 7, customer_support 6, data_ai 5, product_project 3, operations_logistics 2 |
| status | `seed` at `0.1.0`, all 106 |
| recommended triggers | self_paced 62, event 36, time 8 |
| commonest connector types | messaging 32, knowledge_base 19, email 19, source_control 18, database 17 |

Consistency across ten agents that never spoke directly: **five use cases on every recipe**,
guidance between 77 and 88 words against a 40 to 90 contract, no recipe missing an outcome or a
success criterion, no use case short enough to be an audience rather than a situation, and no
`transformNotes` instruction to the migrator surviving into a shipped artifact.

### What the enrichment actually caught

The drafts were not merely thin. In several places they were confidently wrong, and only
research found it:

- **Incident capture had its central instruction backwards.** It said to join duplicate reports.
  A false merge is the expensive error: the second problem inherits the first's acknowledgement
  and disappears when it closes, while a false fork costs minutes a human notices.
- **Webhook routing classified before verifying the sender**, which hands an unauthenticated
  party control of routing, logging and queue selection. The activity order was the defect.
- **Three conversion recipes treated significance as a line an experiment crosses** while pacing
  themselves to look whenever data arrived, which is peeking by construction.
- **A cannibalization recipe promised a savings figure** that no dashboard can produce, because
  it is a counterfactual. It now reports spend at risk, which is observable, and names the
  holdout that would settle it.
- **A drafting recipe graduated a contact to unattended sending after twenty approvals**, when a
  run of approvals is the symptom of automation bias rather than evidence of safety.
- **A contradiction audit's own clustering discarded its targets**, because a plainly stated
  contradiction is near-identical text.
- **A renewal watch measured from the wrong date.** An evergreen term needing ninety days notice
  had to be decided three months before the end date, so the watch raised its first warning two
  months after the last day anything could be done.
- **A revenue recipe measured precision and recall and called it calibration.** They are accuracy
  under a threshold; calibration asks whether accounts scored at a given risk fail at that rate.

### The defect the parallel design created, and how it was caught

`rx.mjs` took the wrong id. Every seed row carries two: a stable uuid, and the payload's internal
graph key that the consuming application derives `recipe_ref` from. The second repeats across
recipes, so 105 migrated recipes carried a non-uuid id and five ids collided across eleven
recipes, three of them sharing `uc_triage`.

Three lanes found it independently and **all three refused to invent replacements**, which was
correct: an id is identity and a lane cannot see the other nine. One lane walked all 102 files on
disk to produce the full census and escalated it as a director decision. The converter now takes
the row's uuid and `fix-ids.mjs` backfilled 105 recipes; it is idempotent and a second run
rewrites nothing.

`verify.mjs` exists because of this: the registry's gate checks each recipe against the contract,
and nothing checked the corpus against itself.

### What remains

1. Operator review, then one commit per repository. `projects.json` in the registry is another
   session's work and is not part of this change.
2. `sync-back.mjs`, when no dev app is running, with the operator's call on `--promote`.
3. The six App Master recipes, after their cycles settle.
4. Optional second pass on the recipes each lane named as knowledge-only, if the operator wants
   to buy one. Every lane reported its provenance per recipe.
