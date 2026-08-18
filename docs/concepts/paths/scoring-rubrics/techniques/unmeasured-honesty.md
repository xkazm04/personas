---
layer: technique
subject: scoring-rubrics
technique: unmeasured-honesty
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Unmeasured honesty

Zero is a measurement: *we looked, and there was nothing*. Missing is a
different fact: *we did not look*, or *we looked and could not tell*. The
defining composite defect is conflating them, and it wears three disguises:

- **Absence as the floor** — an unmeasured dimension enters as zero and
  drags the average down exactly where the rubric has the least evidence.
  The entity with the worst *coverage* quietly becomes the entity with the
  worst *score* — and, worse, the verdict is *actionable*: things downstream
  demote and route around it on the strength of no evidence.
- **Absence as the ceiling** — the dimension is computed as a penalty
  subtracted from a maximum ("start at full marks, deduct per problem"), so
  a source that delivers no bad news is arithmetically identical to a source
  delivering good news. Penalty-shaped dimensions are the majority shape in
  real rubrics, which makes this the majority defect: the composite reports
  "fine" precisely when its instruments go silent.
- **Absence as the middle** — a "neutral" midpoint or mean imputation,
  which fabricates conformity instead of failure or health, and biases every
  partially measured entity toward indistinguishability.

All three produce a well-formed number, so nothing crashes and nothing
warns. This is
[failure-not-empty-success](../../_laws.md#failure-not-empty-success) in
arithmetic form: the instrument that could not run must not report the same
value as the instrument that ran and found nothing — a score must be able
to say "I don't know", or it will say "fine".

## The absence policy is decided once, by the composite

The disguises multiply because each dimension's author faces the missing
input alone and answers from local intuition — one returns the ceiling, the
neighbor returns zero, a third picks the midpoint, sixteen lines apart in
the same weighted sum. Three answers inside one composite is not three
opinions; it is one broken scale, and no amount of fixing individual
dimensions holds, because a corrected dimension is simply outvoted by its
silent neighbors' weights. So the rule is structural: **the rubric — not
the dimension — owns the absence policy.** Every dimension's compute step
is typed to return *value-or-absent* and returns absent when its source
said nothing; the composite applies one declared rule (exclude and
renormalize, below) to every absent input. A dimension that cannot express
absence in its type cannot comply, which makes the type change the first
move of any retrofit.

## Missing is a first-class value end to end

The discipline starts at the type level: a dimension's measured value is
*present-or-absent*, and absence survives every hop — collection, storage,
transport, aggregation — without ever being coerced to a default. Every
coercion point is a laundering point; the classic leaks are a storage layer
that defaults null to zero, a wire format that drops the field, and a
"defensive" fallback at the read site. One authority decides how absence
propagates (the rubric), and it can only decide if absence still *is*
absence when it arrives.

Distinguish the flavors where they carry different actions: **not yet
measured** (instrument hasn't run), **not measurable** (dimension does not
apply to this entity — a cohort exemption, not a gap), and **measurement
failed** (instrument ran and errored). The first is a pending state, the
second removes the dimension from this entity's denominator permanently,
the third is an incident. Collapsing them loses the next action.

## Renormalize over what was measured — and say so

When a dimension is absent, the honest arithmetic excludes it and
**renormalizes the remaining weights over the measured subset**: the score
becomes "quality over what we can see", not "quality with the invisible
parts presumed failing, fine, or average" — the three disguises above are
all rejected by the same mechanical move.

Renormalization is only honest with its disclosure twin: **coverage travels
with the score**. "82, on 7 of 10 dimensions" and "82, fully measured" are
different claims; rendered identically they teach readers that the number
cannot be trusted — or worse, they don't, and readers trust both equally. A
composite without its coverage is a count without its predicate. The
breakdown lists absent dimensions *as absent* — a visible "not measured"
row, never a zero bar, never a silently omitted row a reader won't miss.

## The coverage floor: below it, refuse to rank

Renormalization has a cliff: at low coverage the score rests on so little
evidence that ranking by it is fabrication with extra steps. An entity
measured on two of ten dimensions can outrank one measured on all ten
purely because its two happened to be strengths — the ordering rewards
ignorance. So the rubric declares a **coverage floor** (a stated fraction of
total weight that must be measured), and below it the composite is not a
small number — it is *no number*: "insufficient coverage to score", ranked
below or apart from all scored entities, with the missing dimensions named
as the next action. The floor is part of the rubric artifact: stated,
rationalized, versioned like a weight.

Incomparable coverage matters even above the floor: when two entities'
scores rest on very different measured subsets, a ranking view worth
trusting either says so inline or offers the comparison restricted to the
shared subset.

## Gates decide about absence explicitly

When the composite feeds a threshold decision — promotion, alerting,
pass/fail — absence needs an explicit ruling, not an inherited default. A
pre-flight gate for critical work usually treats unmeasured-required as
blocking ("cannot verify" ≠ "verified"); an advisory ranking usually scores
what it can see and discloses. Either is defensible. What is not defensible
is a gate whose behavior on missing data is whatever the arithmetic
happened to do — that gate was never designed, only shipped. Coverage
itself can be a scored dimension ("measure yourself" as a graded
obligation), which turns the perverse incentive around: under zero-as-
missing, the rational move is to *avoid* measuring weak areas; under
renormalize-plus-coverage-floor, unmeasured dimensions block rank and
measuring is always the improving move.
