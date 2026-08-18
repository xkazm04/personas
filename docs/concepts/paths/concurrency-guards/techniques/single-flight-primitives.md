---
layer: technique
subject: concurrency-guards
technique: single-flight-primitives
status: forged
laws:
  - one-validation-door
  - failure-not-empty-success
shared_with: []
---

# Single-flight primitives

Once the key is designed (see guard-key-design), the mechanism that holds the
in-flight set should be built once and reused everywhere. The alternative — a
bespoke boolean here, an ad-hoc mutex there, a module-level flag in a third
place — is not merely untidy: each bespoke guard re-answers the acquire,
release, and second-caller questions independently, and the answers drift.
One forgets the early-return release; one refuses silently; one is a scalar
flag that a second concurrent key silently tramples. A shared primitive is the
one-door principle applied to exclusion (law: one-validation-door): all
acquisitions pass through one place, so the semantics are uniform and the
acquirers are enumerable.

## The shape of the primitive

The minimal reusable form is a keyed try-begin/end registry:

- **try-begin(key)** — atomically tests membership and inserts. Returns either
  an acquisition (a token obligating a matching end) or a refusal carrying
  *what* is already in flight — at minimum the key, ideally when it began and
  who started it. The test-and-insert must be one atomic step under whatever
  concurrency model applies; a separate "check then add" is a race exactly as
  wide as the gap between them.
- **end(token)** — removes the entry. Taking the *token* rather than the raw
  key is deliberate: it makes "end without begin" and "end twice" structurally
  awkward, and it lets the registry verify that the releaser is the acquirer
  rather than a confused second caller cleaning up someone else's entry.
- **list()** — the current in-flight set, for diagnostics and for the leaked-
  entry audit (see release-guarantees).

Everything else — per-operation policy, timeout reclamation, join semantics —
composes on top of this core. What must *not* be reinvented per call site is
the atomic test-and-insert and the token discipline.

## What the second caller gets

The primitive answers "you may not start"; the *policy* for what happens next
is per-operation, and there are four honest options:

- **Refuse** — return a distinguishable already-in-flight outcome. Right for
  user-triggered actions where the honest answer is "that is already
  happening." The refusal must be spelled differently from a failure of the
  operation (law: failure-not-empty-success): a caller that cannot tell
  "refused because a twin is running" from "tried and failed" will retry, and
  a retried refusal is a busy-loop against one's own guard.
- **Join** — subscribe to the in-flight attempt's result and return it to both
  callers. Right for reads and fetches, where both callers want the same
  answer and neither cares who triggered the work. This is the classic
  single-flight: N callers, one execution, N results delivered.
- **Queue** — wait for release, then acquire. Right when both operations must
  eventually run (two different writes to one entity). Queueing needs a depth
  bound and a wait bound, or a stuck head-of-line converts one wedged key into
  an unbounded pile of waiters.
- **Coalesce** — mark "run once more after this finishes," collapsing N
  arrivals during flight into one follow-up run. Right for sync/refresh
  shapes where the latest state is what matters and intermediate runs are
  waste.

Refuse is the correct *default* — it is the only option with no new machinery
and no new failure modes — but the choice should be recorded per operation,
not left to whatever the first implementer found convenient.

## Scalar flags do not scale past one key

A recurring degeneration: the guard starts life as a boolean ("is a save in
flight?") and the operation later becomes keyed (saves per document). The
boolean now serializes all documents (too broad — see guard-key-design's
failure directions) or, worse, gets overwritten by the second key's lifecycle
and releases the first's guard early. The primitive should be keyed from day
one even when the initial key population is one; a set with one member costs
nothing extra, and the migration from flag to set never happens under calm
conditions.

## Decision rules

- Build the try-begin/end registry once; every new guarded operation adopts
  it. A code review that sees a fresh bespoke mutex for a keyed operation
  should ask why the shared primitive was not used.
- Make test-and-insert atomic under the applicable concurrency model; a
  check/insert pair with a gap is the race it was meant to close.
- Return refusals that name the in-flight twin; "false" is not a refusal, it
  is a shrug the caller cannot act on.
- Pick the second-caller policy (refuse / join / queue / coalesce) explicitly
  per operation and record it; default to refuse.
- Keep the primitive keyed even when today's population is a single key.
- Expose list(); an in-flight set that cannot be inspected turns every stuck
  guard into a source-reading exercise.
