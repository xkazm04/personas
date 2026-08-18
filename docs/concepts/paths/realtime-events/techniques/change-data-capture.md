---
layer: technique
subject: realtime-events
technique: change-data-capture
status: forged
laws: [count-carries-predicate, failure-not-empty-success, one-validation-door]
shared_with: []
---

# Change data capture

The most reliable producer of change events is not the code that makes
changes — it is the storage layer where changes land. Application-emitted
events require every writer to remember to emit; storage-level capture hooks
the one chokepoint all writers already pass through
([one-validation-door](../../_laws.md#one-validation-door) applied to
observation: one door, so the emitters are enumerable — namely, all of
them, automatically). The technique is tapping that door safely: the hook
runs inside the storage engine's hot path, upstream of transaction
visibility, at burst rates the UI never sees — three properties that each
demand a discipline.

## The hook is a hot path: observe, don't act

A storage change hook fires synchronously inside the write path — per row,
inside transactions, during bulk operations. Anything expensive, blocking,
or re-entrant in the hook taxes every write in the system and can deadlock
the engine outright (the classic: the hook handler reads from the storage
it is hooked to). The hook therefore does exactly three things:

- record the minimal fact: operation kind, table/collection, row identity;
- push it onto a **bounded, non-blocking** channel;
- return.

No serialization, no filtering logic beyond a cheap allowlist, no callbacks
into application code, and above all no lock acquisition. Everything smart
happens on the consumer side of the channel, in a context that can afford
to think.

## Emit after the commit, not after the write

The hook sees writes *inside* transactions — including transactions that
roll back. An event published at write time advertises a fact that may
never become true, and consumers refetching on it will read the
pre-transaction state, "confirm" the event was spurious, and then miss the
real commit. The discipline: captured facts are staged per transaction and
released to the bus only on commit; a rollback discards the stage. Where
the engine's hook interface separates row callbacks from commit callbacks,
the pairing is exactly this stage-and-release; where it does not, the
channel consumer must at minimum tolerate advertised-then-absent facts —
which invalidation-style consumers do (see
[push-vs-refetch-reconciliation](push-vs-refetch-reconciliation.md)), and
payload-replication consumers do not. This is half of why the golden path
insists push is never the source of truth.

## Coarsen before the boundary

Row-level capture is the right granularity for the hook (it is what the
engine gives you) and the wrong granularity for the bus. A bulk write of
ten thousand rows is one fact to every consumer that exists — "this
collection changed materially" — and ten thousand channel entries only to
the plumbing between. Coarsening on the consumer side of the channel, per
the keyed-collapse rules of
[coalescing-and-batching](coalescing-and-batching.md):

- collapse per (collection, row) within a beat — repeated writes to a row
  are one fact;
- above a per-collection threshold in one beat, collapse to a
  collection-level fact and drop the row identities — the consumers'
  refetch is scoped to the collection anyway;
- map storage names to registry event names at this stage
  (see [event-registry](event-registry.md)) — the raw storage vocabulary
  (physical table names, operation codes) stays behind the boundary, so
  schema refactors don't ripple into every subscriber.

## The bounded channel and its ledger

Between hook and consumer sits the speed mismatch, and the channel that
absorbs it must be bounded — an unbounded channel here converts a bulk
import into unbounded memory growth inside the process that can least
afford it. Bounded means it can fill; full means it sheds; and **shedding
without accounting is the disqualifying defect**: overload becomes silent
staleness, invisible at every observation point. The rules:

- a full channel drops the *new* fact (the consumers' safety net heals
  staleness; blocking the write path is never an option) and increments a
  drop counter;
- the counter carries its predicate
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)):
  which channel, dropped-since-when, how many — a bare gauge of "some
  drops" cannot distinguish one bad import from continuous overload;
- on drops, the consumer side emits one coarse "capture degraded, refetch
  advised" fact — converting the silent gap into an explicit invalidation,
  the honest move the whole subject is built on;
- the counter is exported to health surfaces. A capture pipeline that has
  never reported a drop has either never been loaded or cannot report
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) —
  verify the instrument, not the silence.

## The consumer that is not born yet

Capture starts when the storage handle opens; the delivery boundary (an
interface layer, a remote bridge) often becomes ready seconds later. Writes
during that gap flow into the bounded channel with no consumer draining it,
and a boot-time burst larger than the channel's capacity sheds exactly the
facts the first-painted interface needed. The remedy has three parts, each
load-bearing:

- **start the drain immediately** — decouple *draining the bounded channel*
  from *delivering across the boundary*; the drain side can absorb into a
  cheap in-process queue long before the boundary can accept emits;
- **take a durable watermark at capture start** (the storage's own position
  counter), and once the boundary is ready, **replay the gap from storage** —
  the durable rows are the authority; the channel was only ever the fast path;
- **rely on consumer dedupe by identity** — replay overlaps whatever the
  channel did deliver, so the consumer must treat a re-seen identity as an
  update, not a duplicate insert. This is the same idempotence the
  at-least-once outbound leg demands, appearing one layer down.

## Capture is infrastructure with a lifecycle

The hook is installed once per storage handle and named alongside its
reaper: whoever closes the handle detaches the hook and drains-or-discards
the channel explicitly. Two audit questions decide whether the installation
is sound: *is every write path in the process actually behind a hooked
handle* (a second, unhooked connection is a hole in the one door — writes
through it are invisible, and the system has no way to notice), and *does
anything besides this process write the storage* (an external writer means
storage-level capture in-process is incomplete by construction, and the
consumers' periodic safety net is promoted from backstop to requirement).
