---
layer: technique
subject: diff-comparison
technique: drift-against-declared
status: forged
laws: [gate-sees-target, identity-survives-reuse]
shared_with: []
---

# Drift against declared

Most diffs compare two states that both *happened*. Drift detection
compares what **is** against what was **declared** — a design contract, an
intended configuration, a manifest of what should exist. The left side is
a promise, not a past; the diff answers not "what changed" but "where has
reality departed from intention". This is a distinct species with its own
mechanics, and it is disproportionately valuable, because drift is how a
system quietly becomes something nobody decided it should be — one
tolerated deviation at a time, each too small to be an incident, none of
them chosen.

## The promise has an author and a version

A past state simply *is*; a declaration is authored, versioned, and can
itself be wrong. Every drift finding therefore cites **which version of
which declaration** it measured against — a finding pinned to "the
expectation" floats to whatever the expectation says today, which
retroactively rewrites history every time the promise is edited. And the
declaration consumed must be the authoritative one, not a convenient
copy: a drift detector reading a cached or duplicated expectation is a
gate watching a proxy, and it goes blind at the precise moment the real
declaration moves ([_laws:
gate-sees-target_](../../_laws.md#gate-sees-target)). The same law binds
the right side: the "actual" must be observed from the live system, not
from a report the system wrote about itself earlier.

## Drift is directional

"Actual exceeds declared" and "actual falls short of declared" are
different findings, not symmetric noise. A capability present but never
declared is scope creep, an attack surface, or an undocumented dependency;
a declared capability absent in reality is a broken promise someone may be
relying on. Presenting both as an undifferentiated "mismatch" flattens
exactly the information the responder needs to pick a verb. The
change-kind vocabulary of ordinary diffs (added/removed/changed) maps onto
drift as **undeclared** (present, not promised), **unfulfilled**
(promised, not present), and **deviating** (present but out of
tolerance) — same skeleton, different words, because the reader's next
action differs for each.

## Tolerance is part of the declaration

An expectation without a tolerance is a tripwire: "response under 200ms"
observed at 201 fires the same alarm as at 2000. Each declared clause
carries its comparison discipline — exact for identities, range or
threshold for measurements, present-regardless-of-value for existence
clauses, explicitly-unchecked for fields the declaration deliberately
leaves free. The unchecked class matters most: without it, every field
the declaration is silent about becomes either phantom drift (checked
against nothing and flagged) or silent freedom (unchecked and invisible),
depending on the detector's temperament — and neither was *decided*. A
drift detector that over-fires does not get fixed; it gets ignored, then
deleted, and the system loses drift detection at the moment it has
trained everyone that drift alarms mean nothing.

## The fork: fix reality, or amend the promise

Every drift finding forks into exactly two honest responses: change
reality to match the declaration, or change the declaration to match
reality. **The surface must offer both verbs.** A drift report with only
"fix reality" treats the declaration as infallible; since declarations
age, some findings are the promise's fault, and a reader who cannot amend
the promise from the finding will instead learn to dismiss findings — the
alarm-fatigue death again, by a different road.

The second verb is the dangerous one, and it is governed: **accepting
current reality as the new declaration is a promotion of fact into
intention** — attributed to a person, logged with the before/after of the
promise, and never automatic. Auto-amending the baseline to whatever
reality does is not drift management; it is drift *laundering*, a
detector that formally exists and structurally cannot fire.

## Findings have identity; drift is a state, not an event

A drift check runs repeatedly, and the same deviation is present on every
run until someone acts. Findings therefore carry identity — the pair of
(declaration clause, subject entity), stable across runs ([_laws:
identity-survives-reuse_](../../_laws.md#identity-survives-reuse)) — so
that run N+1 *updates* the standing finding instead of minting a
duplicate. Without finding identity, a nightly check turns one deviation
into thirty alarms a month, and the count of open findings measures
elapsed time instead of system health. The most common way to get this
wrong is the most natural-looking one: minting the finding's id from a
timestamp plus randomness at detection time. That id is unique per
*observation*, so a persistent deviation observed on every run yields an
unbounded stream of distinct findings with a per-finding "dismissed" flag
— dismissing one does nothing to the next — and the store then needs an
arbitrary retention cap (keep the last N) that silently evicts the oldest
open findings to make room for repeats of themselves. The standing finding tracks its
own lifecycle: first observed, still present, resolved (and by which
verb — reality fixed, or promise amended). Resolution by observation —
the deviation is simply gone on run N+1 — closes the finding with "no
longer observed", which is honest about the fact that nobody claimed the
fix.

## The empty drift report is a claim about the instrument

"No drift" is only as strong as the clause coverage: a detector checking
four clauses of a forty-clause declaration reports "no drift found", and
the reader hears "no drift exists". The report therefore states its
coverage — clauses checked over clauses declared — and a detector that
could not evaluate a clause (unreachable system, unparseable value)
reports that clause as *unevaluated*, never as *passing*. This is the
diff-honesty floor applied to the species where it costs most, because
drift reports feed governance decisions, and governance acts on the
absence of findings.
