---
layer: technique
subject: client-state
technique: store-slicing
status: forged
laws: [one-validation-door]
shared_with: []
---

# Store slicing

One store gives the application a single place to look; slicing gives that
store internal ownership. A **slice** is a self-contained unit — one
domain's state, plus every operation that mutates it — composed with its
siblings into the store at creation time. The store is the address; the
slice is the owner.

## What makes a good slice boundary

Slice by **domain of change**, not by data type or by page. The test: the
people (or agents) who change this state for one reason should find all of
it in one slice, and a requirement that changes one domain should touch one
slice. Warning signs of a bad boundary:

- two slices that must always be updated together (one domain split in
  half — merge them, or extract the shared part into its own slice both
  depend on);
- a slice whose operations mostly read *other* slices' state (it is a
  coordinator wearing a slice's clothes — see cross-slice signals below);
- a slice named after a screen (screens compose domains; a screen-shaped
  slice duplicates domain state the moment a second screen needs it).

Ephemeral per-view state — an open/closed flag, a hover index, a local tab —
does not earn a slice at all. Local state owned by the view is cheaper,
self-cleaning, and invisible to the rest of the app; promote state into the
store only when a second, unrelated consumer genuinely needs it, or when it
must outlive the view.

## The slice owns its writes

Every mutation of a slice's state is an operation the slice defines.
External code calls the operation; it never writes fields directly. This is
the [one-validation-door](../../_laws.md#one-validation-door) law applied to
client state: invariants ("selection must reference a loaded entity",
"status transitions follow the machine") are enforceable only if the writers
are enumerable, and they are enumerable only if the slice is the sole door.

The operation set is also where the slice's *vocabulary* lives. An operation
named `runCompleted(id, outcome)` documents the domain event it represents;
a raw setter named `setFlags(partial)` documents nothing and invites every
caller to encode its own private semantics into the same field.

## Selective subscription

The composed store makes every consumer *potentially* dependent on
everything, and subscription discipline is what keeps "potentially" from
becoming "actually":

- **Subscribe to the narrowest projection you read.** A consumer that reads
  one entity's status subscribes to that status — not to the slice, not to
  the collection, not to the store. Several narrow single-field
  subscriptions beat one bundled projection: a plain field read costs a
  cheap identity comparison and allocates nothing, while a bundle constructs
  a fresh container on every store notification and then needs a
  member-wise comparison to undo the damage the construction did. Reserve
  constructed projections (with shallow comparison) for values that
  genuinely must be built; hoist fallback literals ("or an empty list") to
  module constants, because an inline empty-container default is a fresh
  reference on every evaluation and quietly re-notifies on every write.
- **Reference stability is the writer's job, not the reader's.** When a
  refresh replaces a whole collection, every element is a freshly
  deserialized object even if nothing changed — and no reader-side equality
  trick can save the subscribers, because there is nothing equal left to
  compare. The slice operation that commits the data preserves identity:
  patch matched elements, keep unmatched element references, keep the
  collection reference itself when contents are unchanged. A reader-side
  shallow comparison over writer-churned references is pure cost — an
  extra walk per notification that never prevents anything.
- **Derive in the selector, not in the store.** Filtered views, counts, and
  conjoined flags are computed at subscription time (memoized into a stable
  reference when the computation constructs, and shared in one place when
  read from more than one consumer). Storing them creates the
  second-authority drift the golden path forbids. Two earned exceptions:
  a value the *authority* computed and the client cannot (a server-side
  total across pages), and a derivation materialized for
  subscription-stability reasons — kept in sync by the same slice
  operations that write its inputs, with the reason written down.

The symptom of failed subscription discipline is diffuse: the app gets
slower with every added feature, no profile points at a single culprit, and
the flame graph shows everything re-rendering a little. It is cheaper to
hold the line than to win it back.

## Cross-slice signals without cycles

Slices need each other: completing a run must update activity; deleting a
project must clear a selection pointing at it. Three patterns, in order of
preference:

1. **Read at need.** An operation that needs another slice's state reads it
   at execution time through the store it is composed into. Reading is
   cheap coupling; it creates no subscription and no cycle.
2. **Call the other slice's operation.** When slice A's event must mutate
   slice B, A calls B's public operation — the same door everyone else uses.
   The dependency is explicit and one-directional; if B also needs to call
   A, that pair of domains is telling you it wants restructuring (merge, or
   extract the shared concern).
3. **Emit a domain event.** When the dependency graph would tangle — many
   slices react to one fact, or lower layers must notify upper ones without
   knowing them — publish the fact on an event channel and let interested
   slices subscribe. This buys decoupling at the price of traceability
   (nothing at the emit site names the consequences), so reserve it for
   genuine fan-out, and keep the event vocabulary as owned and enumerated as
   the state itself.

The anti-pattern all three exist to prevent: slice modules importing each
other's *modules* (not just calling composed operations), which produces
initialization-order cycles that surface as inexplicable undefined values at
startup — often only in production bundling, where module evaluation order
differs from development.

## The store is not the universe

Slicing organizes what belongs in the store; equally important is what does
not. High-frequency transient data (streaming buffers, per-frame telemetry)
overwhelms subscription machinery designed for human-scale updates — it
lives in module-scoped structures with their own lifecycle
([singleton-lifecycle](singleton-lifecycle.md)) and enters the store only as
low-frequency summaries. Server-state caching with rich freshness semantics
may live in a dedicated cache layer rather than hand-built slices; the
slicing discipline still applies to everything that layer does not own.
