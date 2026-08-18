---
layer: technique
subject: scoring-rubrics
technique: score-explanation
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Score explanation

An unexplainable score breeds its two failure modes simultaneously:
**distrust** from readers who cannot audit the number, and **gaming** from
actors who — unable to see what the number rewards — optimize the number
itself. Explanation is not a courtesy layer on top of the composite; it is
the structural defense that keeps the instrument an instrument. The rule is
absolute: **the breakdown ships with the composite.** Not on request, not
in an admin view — wherever the number renders, its decomposition is at
most one interaction away.

## The explanation object is part of the rubric's output contract

The rubric's compute step returns a **composite plus its explanation** as
one value — never the scalar alone, with breakdowns re-derived by whichever
surface wants them (re-derivation is a twin implementation; see
rubric-stability). The explanation object carries, per dimension: the raw
measured value in its native unit; the normalized value; the weight; the
contribution (normalized × weight — the only column whose sum *is* the
composite); the target, where the rubric has one; and the measured/missing
status. Plus, at the top level: coverage, the rubric version, and the
ranked gaps. Everything a reader needs to recompute the number by hand sits
in one object — a composite that travels carries the predicate that made
it ([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## Rendering: contributions, not raw values, answer "why this number"

The breakdown view's first job is additive accounting: the reader sees
which dimensions the score came from, and the parts visibly sum to the
whole. Render **contributions** for that question — raw values answer "how
is this dimension doing", a different question shown alongside, in native
units, labeled. The recurring rendering defects:

- showing normalized values without units or frame, so the reader cannot
  connect the row to anything they can act on;
- omitting weights, so a reader cannot tell a low-scoring light dimension
  from a low-scoring heavy one — the difference between "ignore" and "drop
  everything";
- rendering missing dimensions as zero-height bars (see
  unmeasured-honesty: absent rows render *as absent*, and coverage is
  stated beside the composite);
- hiding the arithmetic behind a visualization so stylized that the parts
  no longer visibly sum — at which point the breakdown is decoration and
  the distrust returns.

Banding (labels like strong / adequate / at-risk) may lead the rendering —
words carry the verdict faster than digits — but the number, its coverage,
and the breakdown remain reachable behind the band. A band with no number
is unfalsifiable; a number with no band is unread. And banding has its own
drift physics, with three rules:

- **Boundaries are declared once, beside the formula, and imported by every
  renderer.** A band boundary is a decision about the world, and it is the
  one part of a scoring system a designer will nudge; copies at render
  sites do not stay copies, and two surfaces grading the same number
  differently is the fastest way a score loses its readers.
- **Render the verdict the system computed; never re-derive one from the
  number beside it.** When the explanation object carries both the score
  and its band, a surface that re-bands the score guarantees a view where
  the headline and the detail disagree about the same entity.
- **A dimension is not a composite; never band it with the composite's
  thresholds.** The boundaries calibrated on the weighted average produce,
  applied per dimension, a breakdown panel that contradicts the total it
  decomposes.

## The next action is derived, not implied

The explanation's last mile is the **top gap, named as an action**: which
dimension, what movement it buys, roughly what it costs (the ordering
discipline is gap-ranking's). A score that says "61 — weakest: reliability,
worth +9" converts the reader's question from "is 61 bad?" to "do we fund
that this week?" — which is the decision the rubric was built to drive.
This derivation belongs to the rubric, not the rendering surface: the
rubric owns the targets, weights, and distances, so it can name the action
once, identically, on every surface that shows the score.

## Explanation is the anti-gaming posture — with one honest caveat

Opacity does not prevent gaming; it only prevents *aligned* gaming. With a
published breakdown, "gaming the score" collapses into "improving the
measured dimensions" — which is the rubric working — and the residual risk
moves where it belongs: dimensions whose *measurements* are gameable proxies
for the thing they claim. That risk is addressed by fixing the measurement
or re-weighting (a weight-design decision, made in the open, recorded in
the version history), never by hiding the rubric. An instrument that
depends on secrecy for its validity is measuring compliance, not quality —
and it stops working the day its secret leaks, which is the day someone
finally asks why their number went down.
