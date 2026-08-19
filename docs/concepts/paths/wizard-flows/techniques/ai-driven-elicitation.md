---
layer: technique
subject: wizard-flows
technique: ai-driven-elicitation
status: forged
laws: [gate-sees-target, count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# AI-driven elicitation

A generative interviewer replaces the fixed question list inside a step: it
reads the answers so far and asks the next most useful question. Done well,
this is the strongest form a step can take — the questions adapt to the
user instead of marching every user through the same form. Done naively, it
dissolves the wizard: an open-ended chat with no owned state, no honest
progress, and no defined end, wearing a stepper as a costume.

The line that keeps it a wizard: **the generator proposes content; the flow
owns structure.** Questions may be generated. Step boundaries, completion
criteria, coverage accounting, and navigation may not be.

## The flow measures coverage; the generator does not declare it

An elicitation step exists to fill a **declared rubric** — the topics or
slots the step must cover, written down before any question is asked. Each
answer is assessed against the rubric and the step's coverage is a score
over it: which slots are filled, to what confidence. Completion is the
flow's comparison of that score against a declared threshold —
"coverage of these six topics, scored by this assessment, crossed this
bar" ([count-carries-predicate](../../_laws.md#count-carries-predicate)).

What completion must never be is the generator's own claim. A model asked
"are we done?" answers from fluency, not from bookkeeping — and a model
that can mark its own step complete is a gated party holding the gate's
key ([gate-sees-target](../../_laws.md#gate-sees-target)). The same rule
generalizes: generator output is *content*. It does not advance the
position, unlock steps, modify the rubric, or touch any other part of the
model directly. Everything it produces enters the flow through assessment,
and text inside a user's answer that reads like an instruction to the flow
is an answer, not an instruction.

## Follow-ups are bounded

Generated curiosity has no natural stopping point, so the flow imposes one:

- **A cap per topic** — after N questions on one slot, the slot is as
  filled as it is getting; move on. Diminishing returns are detectable
  (answers stop raising the coverage score) and detection beats a fixed
  cap, but a fixed cap beats nothing by an enormous margin.
- **A visible exit** — the user may end the interview at any coverage
  level and the flow degrades honestly: slots still open are shown as
  open, and either carry defaults marked as such or park the step as
  incomplete. Elicitation serves the user's patience budget; a flow the
  user cannot leave without abandoning the whole wizard converts fatigue
  into total loss.
- **No re-asking answered questions.** The rubric's bookkeeping exists
  partly so the generator can be told what is already known. An
  interviewer that forgets is fatigue at its purest.

Progress display follows the coverage score, not a step count — the rubric
supplies the honest denominator that an open-ended interview otherwise
lacks (see [progress-communication](progress-communication.md)).

## Answers are promoted, not transcribed

The transcript is raw material, not the product. At explicit points —
per answer, per topic, or at step completion — the flow **promotes**
elicited content into the same typed, durable answer state every other
step writes: distilled claims, attributed to the step, reviewable and
editable like any other answer. Promotion is where the elicitation step
rejoins the wizard's ordinary machinery — snapshots carry promoted state,
the review step displays it, the commit assembles from it. A flow that
carries the raw transcript to the commit boundary has deferred the hard
part (deciding what the user actually said) to the worst possible moment,
and a flow that commits model-paraphrased content the user never saw has
a review step reviewing fiction.

Promoted content is labeled by origin. What the user typed and what the
model distilled from it are different provenance, and the review step
shows the distillate *as* a distillate, open to correction before it is
committed — the same edit-then-approve courtesy any staged content
deserves.

## Generator failure is not completion

The generator will fail — timeouts, refusals, malformed output, empty
responses. Every failure mode must render differently from "the rubric is
satisfied" ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
a step that treats "no follow-up question arrived" as "no follow-up question
was needed" converts every outage into a wave of confidently incomplete
data. The honest renderings: retry the generation, fall back to a static
question set for the open slots (the fixed list the rubric implies is the
natural fallback), or park the step visibly incomplete. Coverage scoring
itself is an assessment call and inherits the same rule — an unscoreable
answer is *unscored*, held distinct from *scored low*, so a scoring outage
neither blocks the user as if they answered badly nor waves them through
as if they answered well.
