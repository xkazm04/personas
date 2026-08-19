---
layer: technique
subject: error-handling
technique: user-facing-mapping
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# User-facing mapping

When the routing decision (see [error-doors](error-doors.md)) says the user
must be told, *what they are told* is a product surface with its own
standard. Raw errors are the system talking to itself; the user-facing door
translates them into claims a person can act on. The translation lives in
**one registry**, not at call sites — the same failure must read the same
way everywhere it surfaces, and a wording fix must be one edit
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to failure copy).

## The unit of mapping: message plus suggestion

Each registry entry produces a **pair**:

- **The message** states what happened, at the user's altitude: which
  *intent* failed ("couldn't save the connection"), and what is known about
  why, phrased as the system's situation, not the implementation's
  ("the service didn't respond" — not a status code, not an internal
  identifier, not a stack fragment).
- **The suggestion** states the most likely next action, derived from the
  taxonomy's fault-line axis: transient → "try again in a moment";
  user-fixable → name what to change; authorization → "sign in again" or
  "check access". A message without a suggestion leaves the user at a dead
  end; a suggestion that ignores the category ("try again" on a permanent
  failure) is worse than none.

Copy rules, briefly: never blame the user for a system failure; never
reassure beyond what is known ("your data is safe" is writable only when
that is *verified*, not hoped); never expose internals — internal
identifiers and raw diagnostics belong in telemetry, correlated by an
incident reference if support workflows need to join the two.

## Match on structure first, prose last

Registry lookup mirrors the classification rule of the whole subject:

1. **Category match** — the classified taxonomy category selects the entry.
   This is the primary tier; it is stable by construction.
2. **Specific-condition match** — structured fields (error codes, typed
   variants) select more specific copy where a category is too coarse
   ("that name is already taken" beats "invalid input").
3. **Prose-pattern match, quarantined** — for raw strings from sources that
   offer no structure, pattern rules may map text to an entry. This tier is
   a maintained liability: every pattern is a bet that upstream wording
   never changes, so patterns live only in the registry (one place to fix),
   are ordered specific-before-general, and each one records what source it
   was written against.

## The fallback chain ends in honesty, not silence

Lookup must be **total**: every input produces renderable copy.

- Unmatched failures fall through to the category's default entry; an
  unclassifiable failure falls through to the generic entry.
- **The generic entry is honest, not vague-reassuring.** "Something went
  wrong — the details have been recorded; try again, and contact support if
  it persists" is a truthful floor. It is also a *metric*: every render of
  the generic entry is a mapping gap, so the generic tier reports itself to
  telemetry with the raw failure attached. A registry that never measures
  its own misses stops growing exactly when the product's failure surface
  is growing fastest.
- The chain never throws and never renders an empty string — a blank error
  message is the user-facing equivalent of a swallowed catch.

## Translation rides the product's language system

User-facing failure copy is product copy: it enters the same localization
catalog, plural rules, and completeness gates as every other string. Two
specifics matter here:

- **The registry stores keys, not sentences.** Entries resolve to
  localization keys; the rendering layer resolves keys per the user's
  language. Hardcoded sentences in the registry silently exempt failure
  copy from every localization gate the product has.
- **Suggestions localize as units, not fragments.** Concatenating a
  translated message with a separately translated suggestion fragment
  breaks in languages where the sentence structure differs; each entry's
  message and suggestion are each complete, independently renderable
  strings.

## What never goes through the mapping

The registry serves the user-facing door only. Logs and telemetry carry the
*raw, structured* failure — mapping them through friendly copy would destroy
the diagnostic content and make events aggregate by wording instead of by
cause. One failure, two representations, both authoritative for their
audience: friendly and total toward the user, raw and structured toward the
operator.
