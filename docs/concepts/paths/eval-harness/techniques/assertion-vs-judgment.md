---
layer: technique
subject: eval-harness
technique: assertion-vs-judgment
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Assertion vs judgment

Two instruments can score a non-deterministic output: a deterministic
assertion (code checks a property, same verdict every time) and a judgment
(a model evaluates the output against a rubric). They differ in cost,
stability, and expressiveness, and the technique is knowing the boundary:
**assert everything that can be asserted; judge only the remainder.** Every
property moved from the judgment side to the assertion side gets cheaper,
faster, drift-proof, and self-explanatory on failure — permanently.

## The deterministic band is wider than it looks

Teams reach for a judge the moment outputs stop being exactly predictable,
long before assertions are actually exhausted. Between "exact match" and
"only a judge can tell" sits a wide band:

- **Structural validity** — the output parses, conforms to its declared
  schema, contains the required fields. (Pulling structure out of loosely
  formatted output is the extraction problem, owned by the
  structured-output subject; this technique consumes the result.)
- **Required and forbidden content** — must name the entity from the input;
  must not leak the confidential field; must not claim an action it cannot
  perform.
- **Bounds and invariants** — length within range, count matches the input,
  numeric answers within tolerance, references resolve against the source.
- **Behavioral traces** — the tools invoked, the order of operations, the
  absence of a disallowed action. The transcript of *what the system did* is
  often assertable even when the prose it produced is not.
- **Property relations** — the answer is consistent with itself; a summary
  contains no entity absent from its source.

A useful forcing question when writing a scenario's expected properties:
"could a careful reviewer check this with a checklist and no taste?" If yes,
it is an assertion — write it as one, whatever the first draft said.

## When a judge is genuinely necessary

Judgment earns its cost for properties that resist mechanization: quality
against a standard ("would a senior practitioner accept this?"),
faithfulness in the semantic sense (says nothing the source does not
support, in any phrasing), tone and register, helpfulness relative to
intent, comparative preference between two defensible answers. These share a
shape — the space of acceptable outputs is large and its boundary is
semantic, not syntactic — and no assertion vocabulary reaches them.

Even then, the judge operates inside constraints, because it is itself a
model under measurement (the full treatment is
[judge-stability](judge-stability.md)):

- **Rubric-anchored, never vibes.** The judge scores against explicit
  criteria with level descriptions, ideally anchored by exemplar outputs at
  each level. An unanchored "rate 1–10" invites the judge to invent a scale
  per call. What the criteria are and how they compose into a number is
  scoring-rubrics territory; this technique requires only that they exist
  and are frozen with the suite.
- **Per-criterion verdicts, not one blended score.** A single blended score
  hides *which* property failed; per-criterion output keeps failures
  diagnosable and lets the deterministic layer sanity-check the judgment.
- **A structured verdict channel.** The judge's output is machine-readable —
  score, criterion, cited evidence from the output under evaluation —
  because a verdict that must be re-parsed by a human is not a harness, it
  is a book report. Requiring cited evidence also disciplines the judge:
  a score with no quotable basis is the judge confabulating, and the
  harness can catch that mechanically.

## Layer them: assertions gate, judgment refines

The composition pattern is concentric:

1. **Assertions run first and gate.** An output that fails structure or a
   forbidden-content check is scored failed with no judge call — spending
   judgment on invalid output wastes money to learn nothing, and worse, a
   fluent-but-invalid output can charm a judge into a passing grade the
   assertions already refuted.
2. **Judgment runs inside the gate**, only on outputs that cleared the
   mechanical bar, only for the properties no assertion could reach.
3. **Measurement must not contaminate the system it measures.** The
   harness's own scoring runs — trial candidates, replayed fixtures,
   challenger variants under comparison — score in a dry mode that
   persists nothing to the production evidence stores. A challenger whose
   own eval runs write assertion evidence, counters, or memory into the
   live system is feeding its measurement back into the measured; the
   feedback loop launders trial noise into production state.
4. **Errors are a third verdict, not a zero.** A run that crashed, timed
   out, or produced nothing is not a low-scoring run — averaging error
   cases into quality scores corrupts both signals. The harness records
   pass / fail / error as distinct outcomes
   ([_laws: failure-not-empty-success_](../../_laws.md#failure-not-empty-success)),
   and reports error *rate* beside quality *score*.

The layering is also an economic statement — the cheap instrument screens
for the expensive one (see [eval-economics](eval-economics.md)) — and an
epistemic one: every property asserted mechanically is a property whose
measurement can never drift when the judge does.

## The boundary moves — police it in one direction

Two forces erode the boundary over time. Judgment creeps into the
deterministic band because writing a rubric line is easier than writing a
correct assertion — resist by auditing judge criteria periodically for
lines a checklist could handle, and demoting them to assertions. And
assertions creep toward vacuity — checks green-lighting outputs a human
would reject on sight — because an assertion only sees the property it was
written for
([_laws: gate-sees-target_](../../_laws.md#gate-sees-target): a suite that
asserts structure while the defect lives in meaning is gating a proxy).
The corrective for the second force is not more judging; it is the golden
path's standing ritual — periodically read the actual outputs, and every
time a human catches something both layers passed, encode it: as an
assertion if a checklist could hold it, as a rubric line if not.
