---
layer: technique
subject: import-normalization
technique: format-detection
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Format detection

Before any parser runs, a detector answers *what is this, and which version?*
— from the bytes themselves, never from labels. The technique exists because
the labels available at the boundary are all unreliable: extensions are
generic (`.json` names a syntax, not a format), MIME types are whatever the
uploading side felt like, and users paste content with no label at all. The
detector is a small classifier over **structural fingerprints**, and its
honesty about the *no-match* case is the whole point.

## Fingerprints, ordered by specificity

A fingerprint is a cheap structural predicate that discriminates one format
from the others the product accepts: a signature key that only one vendor's
export contains, an envelope shape (a top-level node array with `type` +
`position` per element reads as a node-graph export; a step list keyed by
sequential ids reads as a linear pipeline), a version stamp in a known
location, a characteristic pairing of keys that no other candidate shares.

Rules that keep the classifier trustworthy:

- **Order by specificity, most specific first.** The generic shapes ("it's an
  object with a `name`") must sit at the bottom or they shadow everything.
  The ordering is part of the contract: document *why* each rule outranks
  the next, because the next person adds their rule at the top.
- **Prefer conjunctions.** A single key is a weak witness — foreign formats
  copy each other's vocabulary, and user files contain coincidences. Two or
  three co-occurring markers drop the false-positive rate from "monthly
  support ticket" to "never seen".
- **Detect the version, not just the family.** Vendors revise exports; the
  revision that renames a key breaks the adapter silently if the detector
  only says "family X". A version outside the supported range is a distinct
  outcome — "we recognize this, but it is newer than what we support" is
  actionable; a parse explosion three stages later is not.
- **Detection is read-only and bounded.** It runs on a size-capped prefix or
  a single cheap parse that the validation stage's caps already protect; a
  detector that fully deserializes a hostile file has moved the
  denial-of-service from the parser to the sniffer.

## The three-outcome contract

Detection terminates in exactly one of:

1. **Recognized** — a named format with a version, selecting exactly one
   adapter — and a **confidence grade**. A high-confidence match (specific
   markers, conjunction satisfied) proceeds silently; a medium-confidence
   match (envelope shape only, no signature marker) proceeds but tells the
   user what was assumed. Confidence is not decoration: it is the bit that
   decides whether the review gate must additionally confirm the *format*,
   not just the entities.
2. **Ambiguous** — two or more fingerprints matched with comparable
   strength. Surface the candidates and ask; guessing silently here means
   running the wrong adapter over plausible input, which produces the most
   convincing garbage the pipeline can make.
3. **Unknown** — nothing matched. This is a *described* outcome, not an
   error string: tell the user what formats are supported and, where cheap,
   what the input looked like ("valid syntax, but no recognizable
   structure"). Distinguish it from *unreadable* (not even valid syntax) —
   the two send the user down different repair paths.

### The speculative-parse escalation — legitimate, under one condition

There is a disciplined refinement of outcome 3 worth building once the
adapters exist: when fingerprints fail, run **every adapter** over the
input, score each success by how much meaningful structure it extracted,
and keep the best candidate — at **low confidence, with mandatory user
confirmation** of the guessed format before anything proceeds, and with a
refusal that names the supported formats *and each adapter's own error*
when all of them fail. Exactly one adapter succeeding upgrades the guess to
medium; several succeeding is ambiguity wearing a different hat and keeps
it low.

The anti-pattern this refines — and must never collapse back into — is the
**silent permissive fall-through**: "if nothing matched, try the default
adapter anyway". That single branch converts every unsupported format into
a stream of half-formed entities that survive far enough to waste the
user's review time — or worse, get committed. The entire difference between
the two designs is one honest bit: *the guess admits it is a guess.* Per
[failure-not-empty-success](../../_laws.md#failure-not-empty-success),
*could not recognize* must never be spelled as *recognized, found nothing
much*.

## Detection is data too

The fingerprint rules belong beside the adapter capability tables (see
[adapter-capability-tables](adapter-capability-tables.md)): declarative
entries — marker keys, required conjunctions, version extractors — that a
reviewer can audit without tracing code. Adding a format touches the same
kind of artifact as extending one: a table row, not a new branch in a
hand-rolled `if` cascade. And every detection emits its outcome as telemetry
(recognized-as-what, ambiguous-between-what, unknown) — a rising unknown
rate is the earliest external signal that a vendor shipped a new export
shape.
