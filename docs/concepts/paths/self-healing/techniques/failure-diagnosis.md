---
layer: technique
subject: self-healing
technique: failure-diagnosis
status: forged
laws:
  - one-authority-per-vocabulary
  - failure-not-empty-success
shared_with: []
---

# Failure diagnosis

A healer's first output is not a fix — it is a claim about what happened. The
quality of everything downstream (strategy choice, effectiveness attribution,
incident dedup) is capped by the quality of that claim, and the claim has three
parts: a **signature** (which failure mode is this?), a **category** (what kind of
failure is it?), and a **confidence marker** (is this a diagnosis or a guess?).
Systems that skip straight to pattern-match-and-fix conflate all three, and the
conflation surfaces later as fixes applied to the wrong problem and accounting
that cannot say which problem was fixed.

## Signature extraction: identity of the mode, not the instance

Two occurrences of the same defect rarely produce byte-identical failures. The raw
record carries volatile material — identifiers, timestamps, counters, absolute
locations, port numbers, memory addresses, elapsed durations — that differs per
occurrence while the *mode* is one thing. Signature extraction normalizes the raw
failure into a stable key: strip or tokenize the volatile parts, keep the
structural parts, and hash or canonicalize what remains.

The two failure modes of normalization are symmetrical and both expensive:

- **Under-normalization** fragments one defect into thousands of "unique"
  signatures (every occurrence embeds a different identifier). Dedup dies,
  promotion thresholds never trip, and the effectiveness ledger records a thousand
  n=1 experiments no one can learn from.
- **Over-normalization** merges distinct defects into one signature (strip too
  much and "connection refused by A" equals "connection refused by B"). Now one
  signature has two causes, the mapped fix works half the time, and the
  effectiveness rate for a perfectly good strategy erodes toward a coin flip.

Calibrate with a **cardinality watch**: track distinct-signature counts per window.
A cardinality explosion is under-normalization; a handful of mega-signatures
absorbing most volume is over-normalization (or a taxonomy hole — see below). The
normalizer is a single shared function with its own tests; two call sites with two
normalizers produce two identities for one mode, and every join downstream breaks.

## Category assignment: consume the authority, never re-parse

The failure's category — transient, credential, resource, validation, unknown, and
whatever else the system's taxonomy defines — is assigned by the **one
classification authority** the error-handling subject owns
(see [taxonomy-design](../../error-handling/techniques/taxonomy-design.md); law:
one-authority-per-vocabulary). The healer consumes that category; it does not run
its own regex zoo over message text. A healer with a private classifier is a
second taxonomy that drifts from the first, and the drift is invisible until a
failure is retried by one component and "healed" by another simultaneously —
the exact two-actors-on-one-failure race the strategy layer exists to prevent.

What the healer legitimately adds on top of the category is *healing-specific*
refinement: within "credential failure," distinguishing expired-and-refreshable
from revoked-and-terminal, because the two demand different strategies. That
refinement keys off structured fields captured at the boundary, not off prose.

## The unknown lane is the diagnosis layer's conscience

A taxonomy always has a default branch, and the diagnosis layer must treat what
lands there as **unclassified, honestly** — not silently misfiled into the nearest
plausible category (law: failure-not-empty-success — "could not diagnose" must be
spelled differently from "diagnosed as X"). Two duties attach to the unknown lane:

1. **Unknowns get conservative treatment now**: no signature-mapped fix exists by
   definition, so only the cheapest reversible strategies (or the do-nothing
   strategy) are eligible.
2. **Unknowns get counted and ranked for later**: the single most valuable report
   a diagnosis layer produces is *high-frequency unknown signatures*, because each
   one is a taxonomy gap that, once named, converts a whole class of guesses into
   diagnoses. An unknown lane whose volume grows while its distinct-signature
   count stays flat is one unnamed failure mode screaming for a name.

Watch for the degenerate end state: an unknown lane where nearly all volume
collapses onto *one* signature means the normalizer or the upstream capture is
discarding the discriminating information — the diagnosis layer has gone blind
while still emitting records that look like data.

## Capture context at failure time, not healing time

Healing often runs later than failing — on a sweep, after a debounce, from a
queue. The state that explains the failure (what was being attempted, with which
inputs, against which dependency, in which configuration epoch) evaporates or
mutates between those two moments. The diagnosis record is therefore assembled
**when the failure happens**, carried with it, and trusted later; a healer that
re-derives context at healing time diagnoses a different world than the one that
failed.

## Decision rules

- **The signature function is versioned.** Changing normalization re-keys every
  open dedup group and every effectiveness row; either migrate old signatures or
  mark the epoch so cross-epoch joins are known-invalid, but never silently mix.
- **Diagnosis-vs-guess is a stored field, not a vibe.** Downstream consumers
  (strategy tiering, accounting, operator display) branch on it; if it lives only
  in the author's intent, the hypothesis lane silently inherits the diagnosis
  lane's autonomy.
- **A diagnosis names its evidence.** "Matched signature S, seen N times, mapped
  cause C" is auditable; "looked like a session issue" is not. When the fix fails,
  the evidence trail is what distinguishes *wrong diagnosis* from *right diagnosis,
  wrong fix* — two different bugs in two different places.
- **Never diagnose from the retry layer's leavings.** By the time a failure has
  exhausted its retries, the record may have been summarized ("failed after 4
  attempts"). Healing needs the *original* classified failure, not the summary;
  plumb it through.
