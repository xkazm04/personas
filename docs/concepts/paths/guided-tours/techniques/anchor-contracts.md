---
layer: technique
subject: guided-tours
technique: anchor-contracts
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Anchor contracts

A tour step's pointer to an element is the single point where coaching content
and product code meet, and it fails in the worst possible way: silently, and
in production, long after both sides shipped green. This technique makes the
pointer a **contract with enforcement on both sides**, instead of a string
that happens to work today.

## Stable identifiers, maintained where the element lives

The product side of the contract is a stable, machine-facing identifier
declared on every element a tour may reference. The properties that make it a
contract:

- **Semantic, not structural.** The identifier names *what the control is*
  ("create-agent-button"), never where it sits. Styling classes, text
  content, tree position, and visual order are all volatile by design —
  anchoring to them means every refactor, retheme, or translation is a
  potential silent tour break.
- **Owned by the element's owner.** The identifier lives in the element's own
  source, so the person who moves, renames, or deletes the control is the
  person holding its identifier — the one contributor guaranteed to be in the
  right file at the right moment. An identifier maintained in a separate
  registry by the tour's author is a copy, and copies drift on exactly the
  edits that matter.
- **One vocabulary, one authority.** Anchor identifiers form a closed
  vocabulary shared by tours, tests, and any other machine consumer. Two
  parallel identifier schemes — one for tests, one for tours — double the
  maintenance burden and halve the chance either is maintained. Reusing the
  identifiers the test suite already keeps honest is the cheapest reliability
  this subject ever buys.

## The manifest: making the gate see the target

Declaring identifiers is half the contract; the other half is a **generated
manifest** — an inventory, extracted from the product source, of every anchor
identifier that actually exists — plus a gate that checks every tour step's
reference against it. This is the law that a gate must see its target,
applied literally: the gate reads the *product's real identifier set*, not a
hand-maintained list of what identifiers were believed to exist when the tour
was written. Hand-maintained lists pass exactly when they have drifted, which
is the moment the gate existed for.

Properties of a manifest worth having:

- **Generated, never edited.** The manifest is derived from source by a tool;
  a human-edited manifest is a second authority over the anchor vocabulary
  and will lose the race with the first.
- **Verified in the build or test path**, so a tour referencing a vanished
  anchor fails a machine's run, not a user's first session. The failure
  message names the tour, the step, and the missing identifier — a failed
  contract should read like one.
- **One extractor, however many consumers.** If a drift test, a manifest
  generator, and a runtime validator each parse the source for identifiers
  with their own grammar, they are not three checks — they are three
  authorities over one vocabulary, and they will disagree on exactly the
  identifiers declared in unusual positions. The symptom is quiet and nasty:
  an anchor one gate accepts and another forbids, with nothing anywhere
  reporting the disagreement. Extract once; share the inventory.
- **Two-directional by intent.** The gate primarily catches tours referencing
  dead anchors; the same inventory, read the other way, reveals anchors no
  tour or test references — candidates for cleanup, or for coaching that was
  never written.

## Geometry is a derivation, never a snapshot

Resolving the identifier to an element is the contract's static half. The
spotlight's position is its live half: a **derivation** from the anchor's
current geometry, recomputed whenever any input changes — scroll, viewport
resize, layout shifts from late-loading content, ancestor mutations, or the
element being torn down and re-created by the interface's own rendering. A
spotlight computed once at step-start is a screenshot of a moving target; it
looks correct in a demo and drifts pixel by pixel in real use.

The derivation discipline:

- **Subscribe to movement, don't poll blindly.** Watch the channels that
  actually move the anchor — scroll, resize, mutation of the anchor or its
  ancestors — and re-measure on signal. A slow polling loop misses fast
  movement; a fast one taxes the product the tour is decorating.
- **Re-resolve, not just re-measure.** Interfaces re-create elements freely;
  the element resolved at step-start may be gone while its identifier is
  present on a fresh twin. Resolution goes back to the identifier, not to a
  cached element reference.
- **Bring the anchor into view before pointing at it.** If the anchor is
  scrolled out of the viewport, the step scrolls it into view as part of
  activation — a spotlight on an off-screen element is a spotlight on
  nothing.
- **Treat disappearance as a state, not an error.** When re-resolution finds
  no element, the step transitions into the declared degradation policy
  (see missing-anchor-degradation) rather than freezing on the last known
  rectangle.

## What this technique refuses

- Anchoring by text content, styling class, or tree path — every one is a
  silent-break generator.
- Accepting an identifier without validating its syntax at the one door where
  tours submit them. Identifiers conform to a strict declared character set,
  enforced at the setter — a malformed identifier interpolated into a
  resolver query can break resolution for the rest of the session, and the
  trust boundary belongs at the door, not in every caller.
- A tour-side list of "known anchors" maintained by hand alongside the
  generated manifest — one vocabulary, one authority.
- Shipping a tour whose references were never checked against the current
  manifest. Green yesterday is not a property of today's build.
- Caching a resolved element or its rectangle across the life of a step
  without a re-resolution path.
