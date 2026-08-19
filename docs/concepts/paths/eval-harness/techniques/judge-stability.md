---
layer: technique
subject: eval-harness
technique: judge-stability
status: forged
laws: [gate-sees-target, count-carries-predicate, one-authority-per-vocabulary]
shared_with: []
---

# Judge stability

The moment a model scores another model's output, the judge becomes part of
the measuring instrument — and an instrument that changes calibration
between measurements produces trend lines that chart the instrument, not the
subject. Judge stability is the set of disciplines that keep scores
comparable across time: pin the judge, freeze its packet, measure its drift,
and treat its known biases as systematics to be designed around rather than
noise to be hoped away.

## Pin the judge — the whole judge

"The judge" is not a model name. It is the complete configuration that
determines a verdict:

- the model, at a specific version — never an alias that silently upgrades;
- generation parameters (temperature at or near zero, bounded output);
- the rubric, at a specific version;
- the exemplars and instructions surrounding the rubric;
- the packing of the evidence the judge sees.

Change any element and you have a new instrument; scores from before and
after are different series and must not be spliced. The practical form is a
**judge packet**: one frozen, versioned bundle — instructions, rubric,
criteria vocabulary, exemplar anchors, output format — that every scoring
call loads by reference. The packet is the single authority for the
judgment vocabulary
([_laws: one-authority-per-vocabulary_](../../_laws.md#one-authority-per-vocabulary));
inline per-call-site copies of the rubric are how two halves of a suite end
up scoring against divergent standards while reporting into one column.
Every emitted score carries its packet version — a score without its
instrument identity attached will inevitably be compared against a score
from a different instrument
([_laws: count-carries-predicate_](../../_laws.md#count-carries-predicate)).

## Measure drift; never assume it away

Pinning shrinks drift; it does not eliminate it — hosted model versions
retire, packets get revised, and even a pinned judge has run-to-run
variance. Drift is therefore *measured*, with the same move a lab uses to
recalibrate a scale:

**The anchor set.** A small, frozen set of outputs with settled scores —
chosen to span the scale, including deliberate failures and borderline
cases. On a schedule, and mandatorily before any judge migration, the judge
re-scores the anchors. The anchors did not change; any movement in their
scores is instrument drift, by construction. Two statistics matter: mean
shift (the judge got stricter or laxer — a step in every trend line that has
nothing to do with the product) and rank disorder (the judge now *orders*
quality differently — the deeper problem, since most eval conclusions are
ordinal).

**Migration by bridge, not by splice.** When the judge must change, run old
and new judges over the anchor set plus a sample of recent real outputs,
record the mapping and its scatter, and either re-baseline downstream
consumers or annotate the discontinuity in every series that crosses it.
The unacceptable move is the silent one: swap judges, keep the chart.

**Repeatability floor.** Score a subset twice under the identical packet
and report the agreement. This number is the ceiling on what any score
difference can mean — a 0.3 delta between candidates is noise if the judge
disagrees with itself by 0.4.

## The biases are measured facts — design around them

Three systematics recur wherever judges are examined, and a harness that
ignores them is measuring them:

**Own-family preference.** Judges systematically favor outputs from their
own model family. Measured directly in cross-model benchmarking: two judges
from different families, scoring the same outputs, each ranked its own
family first — and their overall agreement was modest (rank correlation on
the order of one-half, far below the near-unity their confident prose
implied). Consequences: a single judge from the candidate's own family is a
conflict of interest; any cross-family comparison needs either a
disinterested judge (a family not in the race) or a panel spanning
families, with per-judge scores reported before any averaging — a panel
average that hides its disagreement launders exactly the uncertainty it
was convened to surface.

**Confidence is not calibration.** A judge renders every verdict in the
same assured register, and will score work highly while its own reasoning
contains claims the output does not support. Requiring cited evidence per
criterion (see [assertion-vs-judgment](assertion-vs-judgment.md)) converts
some confabulation into a mechanically catchable failure; the rest is
caught only by the golden path's ritual of reading actual outputs. A judge
scoring an artifact is still a proxy for the artifact
([_laws: gate-sees-target_](../../_laws.md#gate-sees-target)) — spot-check
the target, not the proxy, on a schedule.

**Presentation sensitivity.** Verdicts move with evaluation-irrelevant
features: output order in pairwise comparisons, verbosity, formatting
polish. Randomize or mirror positions, and where verbosity is not itself a
quality criterion, consider blinding length. The general rule: any feature
you would not accept as a *reason* for a score must be neutralized as an
*input* to it.

## Judge health is a lane

All of the above compiles to a small standing checklist — anchor re-scores
on schedule, repeatability sampling, per-packet score provenance, bias
probes around migrations. Run it like any certification lane: its artifacts
are trend lines about the *instrument*, and a harness that cannot show you
its judge's drift chart is asking you to take its product charts on faith.
