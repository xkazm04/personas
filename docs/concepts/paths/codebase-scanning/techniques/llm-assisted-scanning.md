---
layer: technique
subject: codebase-scanning
technique: llm-assisted-scanning
status: forged
laws:
  - one-authority-per-vocabulary
  - failure-not-empty-success
  - gate-sees-target
shared_with: []
---

# LLM-assisted scanning

A language model extends a scanner's reach past what mechanical matching can
express: it can notice that a name promises what the body does not deliver,
that a comment describes a previous version of the code, that an
abstraction is duplicated under two vocabularies, that error handling is
present but performative. That reach comes with a specific hazard profile —
the model is a **sensor with an unreliable narrator**: fluent, confident,
sometimes right about code that does not exist. The technique is the
containment structure that buys the reach without inheriting the
unreliability.

## The ruleset is declared once; the model receives an adaptation

The standards the model scans against live in one authoritative, versioned
ruleset — the same registry the mechanical rules live in — and each scan
*adapts* that ruleset into the model's instructions: selecting the rules
relevant to the target, translating them into checkable prose, attaching
each rule's identity so findings can cite it. What the model must never do
is improvise the rulebook per run. An unanchored model grades each sweep
against whatever standards it dreams up that day, which destroys the two
properties a scanner's output needs most: comparability across runs and
attribution of every finding to a rule whose precision is tracked
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).

## Output over a strict protocol, parsed tolerantly, counted honestly

Model output enters the pipeline through a machine-parseable protocol — one
finding per line, fixed fields, streamed as produced so a long scan shows
liveness and a truncated one salvages partial results. The parser is
tolerant of the model's inevitable drift — prose preamble, malformed lines,
duplicate emissions — but **tolerance is not silence**: every line that
failed to parse is counted and reported. A scan that emitted forty lines of
which twelve parsed is a degraded scan, and a report that shows the twelve
findings without the twenty-eight failures presents a broken instrument as
a quiet one
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The same honesty applies upstream: a model call that errored or timed out
is a skipped sensor, reported as such, never an empty result — and a run
that consumed its whole time budget while parsing *zero* findings is an
error, not a clean bill.

Two field-normalization rules complete the protocol. Closed-vocabulary
fields (category, status, severity) are **clamped to their allowed sets**
on ingestion, with out-of-set values mapped to a declared conservative
default — the model will invent enum members, and letting invented members
into the store forks every downstream consumer. And the finding's rule
reference must resolve against the shipped ruleset; a finding citing a rule
that does not exist is a malformed line, whatever its syntax.

## Candidates, never verdicts

Every model finding is a candidate carrying quoted evidence — the exact
content it claims to have seen, with its claimed location — and the
verification pass checks the quote **against the actual target**: does that
content exist at that location in the current tree
([gate-sees-target](../../_laws.md#gate-sees-target))? This single check
eliminates the model's signature failure class — plausible findings about
hallucinated code — at near-zero cost, because a fabricated quote does not
survive a string comparison. Findings whose evidence verifies then proceed
through the same lifecycle as mechanical findings: the same dedup identity,
the same actionable predicate, the same rejection tracking per rule. The
model gets no privileged lane; if anything its per-rule rejection rates
deserve closer watching, because its precision drifts with model version,
prompt revision, and target domain — three variables mechanical rules do
not have. Re-measure at every change to any of them. And weight the model's
expressed confidence at approximately zero: models assert broken findings
at full confidence, and calibration signals belong to the verification
pass, not the narrator.

## Spend the model where mechanics cannot go

Model scans cost real money and real latency per unit of code; mechanical
rules cost approximately nothing per run. The division of labor follows:
anything expressible as a pattern belongs to the mechanical ruleset —
promoting a rule out of the model tier once its shape is understood is a
cost optimization *and* a precision upgrade, because deterministic matchers
do not drift. The model tier is reserved for the semantic residue: intent,
naming, coherence between artifact and description. Scope model passes to
changed or high-value regions rather than the whole population, and let the
cheap mechanical tier own full-population coverage. A scanning budget spent
running a model over code a pattern could have checked is a budget not
spent verifying the findings only a model could raise.

## The failure worth naming: eloquent agreement

The most dangerous model output in a scanning context is not the false
positive — verification catches those. It is the confident **clean bill of
health**: the model that reviews a target and produces articulate praise,
scoring it highly while the target is visibly broken to any human who
opens it. Measured instances of this exact failure — evaluator models
scoring defective work at full marks while logging unsubstantiated claims
against sound work — mean a model's "no findings" must be treated exactly
as this subject treats every other silence: as an *absence of evidence of
inspection*, not as evidence of health. If a model pass is load-bearing for
a health claim, pair it with a positive control — a planted defect the pass
must find — before believing its silences.
