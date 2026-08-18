---
layer: technique
subject: model-routing
technique: turn-classification
status: forged
laws:
  - one-authority-per-vocabulary
shared_with: []
---

# Turn classification

The routing decision is only as good as the question it is asked. "Which model
should serve this call?" is unanswerable in general; "which model serves a
background aside?" is a table lookup. Turn classification is the technique that
converts the first question into the second: a **closed vocabulary of call
classes**, asserted by the caller, mapped to a tier and effort setting in exactly
one place.

## The vocabulary is closed, small, and semantic

The class names what the call *is in the product*, never what it wants from the
roster. The recurring axes:

- **Who waits.** A human synchronously watching; a human who will glance later; a
  pipeline that only cares about aggregate throughput.
- **Blast radius of a bad answer.** The product's main output; a decoration that
  can be quietly wrong; a label whose individual errors wash out at volume.
- **Expected output shape.** Long-form open-ended; a sentence; a token or two
  under a hard cap.

Three to five classes cover almost every system: the *interactive main turn*, the
*background aside*, the *headless micro-call*, sometimes a *batch analysis* class
between the last two. Resist growth. A class per feature recreates per-call-site
model choice with extra steps — twelve classes with one consumer each is the
naive design wearing a uniform. A new class is justified only when calls genuinely
need a different tier-and-effort contract *and* more than one call site will
assert it.

The vocabulary has one authoritative definition, and mapping, policy, audit, and
dashboards all consume that definition (law: one-authority-per-vocabulary). The
moment the audit view hand-maintains its own list of classes, the next class
added shows up as an unlabeled bar on a chart — the copies drift precisely when
someone extends the vocabulary and finds only one of them.

## The caller asserts the class

Only the call site knows its role. The router cannot infer "a human is waiting"
from prompt text — inference from content is fragile (the same prompt string can
be a main turn or a regression fixture), unauditable (the record would say "the
router guessed"), and inverts the dependency: the router now needs product
knowledge that belongs to features. So the contract is:

- **The caller states the class** as part of the call, the way it states the
  prompt. It is a required argument, not an optional hint.
- **The router owns the mapping** from class to tier and effort, and nothing
  else about the choice. Callers say what they are; the table says what they get.
- **An unclassified call fails loudly.** Any silent default is wrong in one
  direction or the other: defaulting cheap quietly degrades the call someone
  forgot to label; defaulting expensive converts every future omission into
  invisible spend. The absence of a class is a bug at the call site, and the
  system should say so at the call site.

## The mapping is one table, and it is data

Class → (tier, effort) lives in a single structure, readable in one screen,
answering "what serves our interactive turns today?" without a search. Each
entry carries its provenance: the measurement that set it and when (see
effort-calibration — the table is the *output* of calibration, and an entry
without a cited measurement is an opinion in a table costume). Changing an entry
is a routing-policy change and goes through the same review as any other (see
policy-governance): the table is small, but it is the highest-leverage spend
knob in the system.

## The pair travels whole

The mapping's output is a **tier-and-effort pair, and it moves as one value** —
one structure, taken together or not at all. The two axes have asymmetric
visibility: the tier has a visible consequence in the output, the effort does
not, so when call sites are allowed to take half the pair, it is always the
effort half that gets dropped — and nobody notices, because a dropped effort
does not land on a neutral middle. It lands on the serving side's default,
which sits *above* the calibrated level on exactly the calls the calibration
existed to make cheaper. If a function downstream of the mapping has a slot for
the tier and none for the effort, that missing parameter is the bug; add it
before adding the caller.

## Decision rules

- **Class names survive roster changes; tier assignments do not.** When a new
  model generation lands, the table is re-pointed and re-measured; no call site
  changes. If a roster change forces call-site edits, model knowledge leaked
  into the callers — hunt it down.
- **One call, one class.** A call site that picks between classes at runtime is
  usually two call sites sharing code; split them. Conditional classification is
  where "the caller knows its role" quietly stops being true.
- **The class travels into the record.** Every downstream artifact — the audit
  record, the usage timeseries, the spend rollup that cost-metering prices —
  keys on the class. A decision record without the asserted class cannot answer
  the only interesting retrospective question: was this class of call worth
  what it was routed to?
- **Test and evaluation traffic gets its own class**, not a borrowed one.
  Letting fixtures assert the interactive class poisons both the calibration
  data and the spend attribution for the class that matters most.
