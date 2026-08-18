---
layer: technique
subject: codebase-scanning
technique: dead-code-detection
status: forged
laws:
  - gate-sees-target
  - count-carries-predicate
shared_with: []
---

# Dead-code detection

Most scanning looks for a *presence* — a pattern that should not exist,
found. Dead-code detection inverts the evidence: the claim is an *absence*
— nothing references this — and absences are precisely what the usual
instruments cannot see. A diff shows what changed, never what stopped being
needed; a local search shows references, never whether the referencers are
themselves alive. The technique is the set of analyses that make absence
measurable, the defeats that make naive versions of those analyses wrong,
and the protocol for acting on a claim whose falsification (something
does use this, dynamically) arrives only at runtime.

## The taxonomy: four kinds of dead

- **Unused exports** — declared for consumption, imported nowhere. The
  shallowest class and the safest to detect mechanically.
- **Orphan modules** — files no import path reaches from any entry point.
  Detectable only by whole-graph reachability, never by grepping for the
  filename (which finds the file's own declarations and calls it alive).
- **Unreferenced registrations** — the cross-boundary class: a command,
  endpoint, or handler registered on one side of a serialization boundary
  whose other side never invokes it. Reference analysis on either side
  alone shows life; only joining the two inventories shows the corpse.
- **Orphaned generated artifacts** — outputs whose generator source is
  gone. The class with a structural blind spot all its own, below.

## Reachability from entry points, not refcounts

The load-bearing analysis is **transitive reachability from declared entry
points** — the application roots, the public surface, the registered
handlers — not local reference counting. The difference is the
**shadow-declaration defeat**: dead code references other dead code, so a
dead module's exports are "used" (by another dead module), its types are
"referenced" (by a dead helper), and refcount-based analysis certifies an
entire dead island as alive because its residents cite each other. Whole
clusters survive this way for years, each file the reason the next one
stays. Reachability dissolves the defeat by asking the only question that
matters — can execution starting from a real root arrive here — and it
requires an explicit, maintained roster of entry points, which is itself a
vocabulary with one authority: an entry point missing from the roster makes
live code look dead (dangerous), and a stale entry that no longer exists
makes dead code look live (wasteful).

## The generator-never-deletes blind spot

Code generators overwhelmingly *add and update*; almost none delete. When a
source declaration is removed, its generated artifact simply stops being
regenerated — it does not change, so it produces **no diff**, and it is
already tracked, so it produces **no new file**. Every diff-shaped gate is
blind to it *by construction*: the gate watches for changes, and an orphan
is defined by its refusal to change
([gate-sees-target](../../_laws.md#gate-sees-target)). Worse, live code may
keep importing the orphan — the types still exist, so nothing fails — at
which point the codebase contains consumers of a contract whose producer is
gone, a defect no compiler reports. The only detector that works is an
**inventory reconciliation**: enumerate what the current sources *should*
generate, enumerate what exists, and diff the two sets. Presence-without-
source is an orphan; source-without-presence is a missed generation. Both
lists ship with their predicates — "orphaned" means *no current source
regenerates this, measured by that reconciliation* — because a bare count
of "dead files" will otherwise be reused for claims it cannot support
([count-carries-predicate](../../_laws.md#count-carries-predicate)).

## Dynamic references: the honest uncertainty

Static reachability sees static references. Anything summoned by
constructed name — string-keyed dispatch, reflection, configuration-driven
loading, serialized identifiers arriving over a wire — is invisible to it,
and this is where dead-code findings earn their "candidate, not verdict"
status most literally. The mitigations are layered, not optional: maintain
a declared list of dynamic-dispatch surfaces and treat names reachable
through them as roots; search for each candidate's name as a *string
literal*, not only as a symbol, before believing its death; and weight
candidates by their distance from any dynamic surface. A deletion protocol
that skips this layer converts a scanner into an outage generator.

## Deletion is a verified finding plus a reversible act

Dead code is the one finding class whose remediation *is* deletion, and the
protocol treats it with the same rigor as any other claim:

1. **Verify before acting** — re-run the reachability analysis at the
   moment of deletion, not from a week-old report; the graph moves.
2. **Delete in one reviewable unit per island** — a dead cluster goes
   together, so the review sees a self-consistent removal rather than
   twenty puzzling fragments; and nothing else rides in the change.
3. **Keep the detector running after** — resurrection (the deleted name
   re-appearing, or a survivor newly orphaned by the deletion) is a
   regression signal the very next sweep should catch.
4. **Rely on version control as the undo**, and say so in the change
   record: deletion of dead code is cheap to reverse, which is exactly why
   the protocol can afford to be decisive once verification passes.

One boundary note: deleting *dead code* removes an unowned liability;
deleting a *failing check or noisy finding* to quiet a report is the
opposite move and belongs to no protocol here. The first removes the
defect; the second removes the visibility.
