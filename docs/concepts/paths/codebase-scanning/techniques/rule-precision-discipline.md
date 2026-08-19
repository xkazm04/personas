---
layer: technique
subject: codebase-scanning
technique: rule-precision-discipline
status: forged
laws:
  - count-carries-predicate
  - failure-not-empty-success
  - gate-sees-target
shared_with: []
---

# Rule precision discipline

Every detection rule is a measurement instrument, and an uncalibrated
instrument is worse than none — it produces numbers that look like knowledge.
The discipline in this technique exists because the failure mode it prevents
has been measured, repeatedly, at its worst possible value: **rules written
from principle, without reading the code they would match, have come back at
zero percent precision** — every single match a false positive — and they
were written quickly, confidently, and in good faith. Precision failures are
not a tail risk of rule authoring; they are its default outcome without
calibration.

## Population first: read before you write

The non-negotiable order of operations: **enumerate and read the actual
population the rule will match before writing the rule.** Not a sample of
what you imagine the violation looks like — the real sites, in the real
tree. This inverts the intuitive workflow (principle → pattern → ship) into
the empirical one (population → pattern → verify → ship), and the inversion
is the entire technique; everything below is enforcement detail.

Reading the population does three things no amount of principle can. It
reveals the *legitimate* instances of the pattern — the exceptions that will
become false positives if the rule cannot distinguish them. It reveals the
actual textual shape of violations, which is reliably different from the
imagined shape (real code wraps lines, aliases names, and routes through
helpers). And it calibrates whether the rule is worth writing at all: a
violation class with two instances and a clear owner is a conversation, not
a rule.

## Hand-verified samples before shipping

Before a rule ships, pull a sample of its matches and verify each by hand:
is this actually the defect the rule claims? Record the result as a
precision figure — verified-true over sample size — and store it *with the
rule*, so the next maintainer knows whether they are holding a scalpel or a
shotgun. A rule below the shipping threshold does not ship at advisory
strength and is nowhere near graduation to an enforcing gate. The sample
must be drawn from the live population, not from fixtures the author wrote
— fixtures test the matcher's mechanics; only the population tests its
judgment ([gate-sees-target](../../_laws.md#gate-sees-target)).

## Zero matches at birth is a refusal, not a pass

A rule that matches nothing on its first run against a real population is
either aimed at an extinct defect or — far more often — broken in a way that
returns the empty set: a pattern that cannot match its own target, an
anchor that never fires, a scope that excludes every candidate file. Both
readings disqualify it. **Refuse to register zero-match rules** — and
refuse equally to "solve" the refusal by baselining the rule at zero, which
converts an untested rule into a gate that can never fail. Give every rule
a positive control: a known-true instance (planted in a fixture, or a
recorded historical site) that the rule must match for the rule itself to
count as operational. A rule without a positive control can die silently
and keep reporting clean forever
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
One structural corollary: a positive control carries no baseline of its
own — its entire job is to be *able* to fail, and ratcheting its match
count neutralizes it.

## Baselines fail in both directions

When a rule's match count is tracked over time as a ratchet, the alarm must
be two-sided. A **rise** means new violations — the expected alert. A
**silent drop**, especially to zero, is treated with equal suspicion: it
means either genuine cleanup (verifiable in the change history) or, at least
as often, a broken matcher — an input format shift, a moved directory, a
tokenization change — now under-counting while everyone celebrates. A
baseline that only alarms upward converts matcher rot into apparent
progress.

## Counts that travel get a second, independent implementation

Any count that will leave the scanner — into a report, a document, a
decision — is cross-checked by a **second implementation written
independently, preferably with a different mechanism** (structural traversal
versus text matching, a different tool family, a different author). This is
not paranoia; it is the documented catch-rate. Independent reimplementation
has caught matchers wrong by double digits from causes invisible to their
authors: line-ending conventions differing across files, token boundaries
matching inside longer identifiers, display limits silently truncating the
measurement itself, and generated code lacking the literal keywords the
textual matcher keyed on. When the two implementations disagree, the
*disagreement* is the finding — resolve it before publishing either number,
and publish the number with its predicate and its cross-check attached
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## The asymmetry that justifies all of this

Recall failures cost silently: a defect goes uncaught, as it already was
before the rule existed. Precision failures cost loudly and compound: each
false positive spends operator trust, and trust, once spent, discounts every
future true finding from the same instrument. A scanner survives on the
operator continuing to believe it; therefore, when forced to choose, **tune
toward precision and accept recall loss** — and be honest in the rule's
description about what the narrowed pattern no longer catches, so the recall
gap is a recorded decision rather than a surprise.
