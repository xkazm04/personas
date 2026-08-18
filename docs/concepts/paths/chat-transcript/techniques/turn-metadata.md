---
layer: technique
subject: chat-transcript
technique: turn-metadata
status: forged
laws:
  - count-carries-predicate
  - derivation-names-recomputation
shared_with: []
evidence:
  - src/features/plugins/companion/RecallStrip.tsx             # collapsed recall count line above the turn, expandable grouped chips, click-through to source
  - src/features/plugins/companion/TurnSummaryChip.tsx         # side-effect rollup below the turn; zero-total turns render nothing
---

# Turn metadata

A machine turn knows things about itself: what it cost, how long it took,
which model and settings produced it, what context was recalled to ground it,
what it touched. The transcript discloses those facts **on the turn** — where
they are true — without letting them compete with the conversation for
attention. This technique is the discipline of that disclosure.

## The strip: quiet, attached, settled

The canonical form is a **metadata strip**: one visually quiet line attached
to the settled turn — outside the prose, inside the turn's boundary — showing
the few facts that earn ambient visibility (typically cost or duration,
provenance, a recall indicator). Rules that keep it a strip and not a second
message:

- **It appears at settlement.** A streaming turn shows narration, not
  accounting; cost and duration are facts about a finished thing, and a
  ticking cost meter turns attention into anxiety.
- **It is typographically subordinate** — smaller, dimmer, unmistakably not
  part of the answer. A reader skimming the conversation should be able to
  not see it.
- **It never interleaves.** Metadata renders above or below the turn's
  content as one unit; badges inline with prose sentences make the model's
  words and the system's bookkeeping one text, which is false.
- **User turns mostly have none.** Delivery state and edit marks (owned by
  the [turn model](turn-model.md)) are the exceptions; symmetry for its own
  sake fills the transcript with empty chrome.

## Expansion: detail one interaction away

The strip is a summary with a door. Expanding it reveals the turn's full
account — token and cost breakdown, timing phases, the recalled items with
their sources, tool usage, model and parameter provenance — in place, without
navigating away from the conversation. The split is the same one the whole
subject makes: reading flow first, full record reachable. Two rules govern
the detail view:

- **Recall is inspectable, not just indicated.** If the strip says memory or
  documents grounded this turn, expansion names the items and links each to
  its source. An unexplorable "used 3 memories" badge asks for trust while
  withholding the evidence — and grounding disclosure exists precisely for
  the moments trust is in question.
- **Expansion does not reflow the conversation destructively.** Opening the
  detail may push content, but it must not disturb the scroll contract —
  expanding a mid-history turn keeps that turn under the user's eyes, and
  collapsing restores the prior layout.

## Honest numbers

Metadata is where the transcript prints numbers, so the numbers laws bind
here concretely:

- **Every figure carries its predicate**, per
  [count-carries-predicate](../../_laws.md#count-carries-predicate). "Cost"
  is which meter — this turn only, or the turn plus its tool sub-calls?
  "Duration" is wall-clock from what to what — submission to settlement, or
  first token to last? The strip may abbreviate, but the expansion states the
  predicate, and two surfaces showing "the same" number use the same one.
- **Displayed derivations name their recomputation**, per
  [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation).
  A cost shown on the turn is derived from a usage record; the record is the
  authority and the displayed figure must be re-derivable from it. When the
  pricing table changes, recomputation from the record is what makes the
  historical strip honest (priced as of when) instead of silently wrong.
- **Absence is rendered as absence.** A turn whose usage record is missing
  shows "not recorded" — not a zero. Zero is a measurement; missing is a
  fact about the measuring.

## Tags and classification

Products often let turns carry classification — pinned, flagged, rated,
topic-tagged — and the strip is where those live too. The closed-vocabulary
rule applies (the tag set has one authority), and one interaction rule joins
it: classification controls on hover-reveal must also be reachable without
hover, or the transcript's most durable curation feature is invisible to
keyboard and touch users.
