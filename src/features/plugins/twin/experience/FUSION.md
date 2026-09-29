# The Twin experience — what it is made of

This surface is the settled form of a four-way contest run on 2026-09-21 and
2026-09-24. Four takes on "create a twin, then train it" lived side by side
behind an in-memory switch; the owner picked the best part of three of them and
the losers were deleted. This file records what came from where, so a later
reader does not re-litigate a decision that was already made.

The three losing folders (`opus/`, `grok/`, `mirror/`), the switch
(`twinExperienceVariant.tsx`) and the pre-contest surface (`setup/SetupPage`,
`SetupShell`, `SetupDesk`, its three desk components, and
`sub_profiles/CreateTwinDialog`) are gone. Their i18n namespaces
(`twin.experience_{opus,grok,mirror}`) were fused into one `twin.experience`
tree by MOVING the already-translated values, so the surface ships with all 14
locales and needed no translation round.

---

## What came from where

| From | What | Where it lives now |
|---|---|---|
| **Deck** (the playing-card entry) | the framed overlay — a capped `BaseModal` at `min(96vw, 110rem)`, not a bleed | `TwinExperienceHost` |
| **Deck** | the question card: double border, suit pip box, slot name and hint, rank letter in the corner | `table/DealerCard` |
| **Deck** | the fan of three answers, rank in both corners, hover lift, picked card riding higher | `table/DecisionFan`, `table/DecisionCard` |
| **Deck** | the layout: chrome, readiness strip, one scrolling band, pinned composer | `ExperienceBody`, `table/CardTable` |
| **Deck** | the forge, with the ten curated voices one layer down | `forge/*` |
| **Table** (the card-table entry) | the felt the cards are played on, **at half its original visibility** | `.tx-felt` in `experience.css` |
| **Mirror** (the one-lane entry) | the side drawer, and the rule that only one is ever open | `layers/LayerFrame`, the single `door` value in `ExperienceBody` |
| **Mirror** | what to train on next, with coverage tiers | `layers/DeckLayer` |
| **Mirror** | the status overview — everything the twin knows | `layers/SheetLayer` |
| **Mirror** | the voice studio and every field, as layers rather than modes | `layers/VoiceLayer`, `layers/FieldsLayer` |
| **Mirror** | the turn rules, and the module launcher that survives the roster re-rendering under it | `table/useTurn`, `launcher.ts` |

---

## The adjustments asked for, and how they are implemented

**The felt at 50%.** Every alpha in `.tx-felt` is half what the card-table
variant used: the primary wash 13% → 6.5%, the floor 4% → 2%, the diamond weave
2.5% → 1.25%. It is a texture the cards sit on, not a thing to look at.

**The answer +100, its note −100.** `experience.css` sets `font-weight: 500` on
`.tx-answer` and `300` on `.tx-answer-note`, so the difference between the
answer and *why it is offered* is legible before either is read.

Two things about that rule are deliberate and worth not "fixing":

- It is a **documented deviation** from Design.md §8 ("no utility patch over a
  `typo-*` token"). The tokens still own the size and the line-height; only the
  weight moves, and it moves because a weight delta was the point.
- It is written as a **two-class selector** (`.tx-card .tx-answer`). `typo-body-lg`
  and `typo-caption` are *unlayered* rules, so a layered Tailwind `font-*`
  utility loses to them silently, and a one-class rule here would depend on
  which stylesheet the bundler emits first. `(0,2,0)` beats `(0,1,0)` either way.

---

## What changed in the fusing, beyond picking parts

Three things are neither Deck's nor Mirror's, because fusing them made a choice
necessary:

1. **The fields editor is a door, not a mode.** Deck carried a second
   `SegmentedTabs` in the header to swap the table for the fields page. With
   Mirror's layers present that strip made the chrome read as a toolbar, so the
   editor became the fourth door. The header now holds one strip, not two.
2. **The training momentum band is gone from the header.** Deck showed it above
   the table in the training stage; Mirror's deck layer already carries the
   round count and the per-topic coverage, and saying it twice is what "one
   sight" costs.
3. **Deck did not handle a `write` turn.** The backend deals reply drills whose
   answer is kept verbatim as a writing sample, and by contract those turns
   carry no cards. Deck would have shown an empty fan with no explanation, so
   `DealerCard` gained the incoming-message block and `TableComposer` says it is
   the only way to answer. Mirror and Table both had this; losing it would have
   been a regression.

The forge also gained the **languages** field, which only Table and Mirror
asked for. Every generator behind the twin reads them and the dialog this
replaces never asked.

---

## What is owed

- **Nobody has seen this run.** No live smoke, on any theme, at any width. The
  fusion is verified by types, lint, census and 129 twin tests — none of which
  can tell you whether the felt reads well behind the cards, or whether
  weight 300 is too thin for the note at the smallest text scale.
- `twin.setup.*` still carries the strings the deleted pre-contest surface
  owned (the desk buffer, its trail labels, its mode strip). The repo's own
  dead-key scan reports none of them as unused — it cannot see through the
  aliasing those files used — so they were left rather than removed on a guess.
