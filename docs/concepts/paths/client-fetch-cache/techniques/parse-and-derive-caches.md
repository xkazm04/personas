---
layer: technique
subject: client-fetch-cache
technique: parse-and-derive-caches
status: forged
laws: [derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Parse and derive caches

Not every expensive answer crosses the network. Parsing a large structured
payload, extracting sections from a long document, computing a heavy
layout or diff or aggregation over content the client already holds — the
input is local, but recomputing on every render burns the frame budget
just as surely as refetching would burn the transport. The same cache
economics apply one layer down, with one deep simplification and one
law-shaped obligation.

## Key by content identity

The defining decision: the key is the **identity of the input content**,
not the identity of the entity it belongs to. Same entity, edited content
— different key, because the derivation's answer changed. Same content
reached through two entities — same key, and the cache legitimately shares
the work.

Content identity has three practical spellings, in ascending cost:

- **Reference identity** — "same object in memory." Nearly free, and
  correct *only* under an immutability discipline where changed content is
  always a new object. Where anything mutates in place, reference equality
  answers "same allocation," not "same content," and the cache serves
  derivations of data that no longer exists. Use it only where the
  producer guarantees fresh objects for fresh content — and write that
  assumption down at the cache.
- **Cheap fingerprint** — length plus a stable prefix/suffix sample, a
  version counter the producer bumps on change. Fast, with a stated
  collision story.
- **Content hash** — the honest general answer when the producer's
  mutation discipline is unknown. Hashing costs a pass over the input;
  for a derivation that costs hundreds of passes, the ratio is still
  excellent.

The choice is a correctness/cost trade and it must be *declared* — the
single most common defect in this cache class is a reference-keyed cache
over a producer that mutates, and it is invisible until it isn't.

## Immutable entries, one live policy

Keyed by content identity, an entry can never be wrong — the input that
produced it is named by the key, and that input never changes (a changed
input is a different key). Lifetime collapses to "forever"; there is no
TTL, no revalidation, no invalidation event to subscribe to. The entire
[swr-design](swr-design.md) apparatus evaporates, which is why these
caches should not be built on the fetch cache's machinery — they are
simpler, and inheriting freshness machinery they cannot use only obscures
that.

What does **not** evaporate is eviction
([creation-names-reaper](../../_laws.md#creation-names-reaper)). The key
population grows with every distinct content version ever seen — an
actively edited document mints a new key per keystroke burst — and each
entry pins a derivation in memory. A small recently-used cap is almost
always right: the working set is "the content currently on screen plus a
few recent versions," not history. An unbounded derive cache is the leak
that profiles as "memory grows while the user edits."

Reference-keyed caches have a uniquely elegant answer available: hold the
entries through **weak references**, and the collector becomes the reaper.
An entry lives exactly as long as something else holds its input object;
when the last holder lets go — a list refresh replacing its rows — the
derivations evaporate with the inputs, unprompted. Where the platform
offers a weak keyed map, a reference-keyed derive cache should almost
always use it: the eviction policy is "input lifetime," declared in the
data structure itself rather than in code that must remember to run.

One more boundary keeps entries honest: the derivation must be **pure** —
a function of the keyed content and nothing else. A derivation that also
reads ambient state (settings, locale, viewport) has hidden axes; either
those axes join the key ([cache-key-discipline](cache-key-discipline.md))
or the cache serves answers from a world that has moved. The audit is the
same collision audit as for fetch keys, applied to a function's free
variables instead of a request's arguments.

## The cache is acceleration, never authority

A derive cache stores computed values whose source of truth is the
computation itself. The law is explicit
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
the stored value names how it is recomputed. Concretely — the derivation
function stays the one public door, with the cache as an internal detail
inside it; callers invoke "derive this," never "read the derive cache."
That structure gives three guarantees at zero cost: a cache miss is
always recoverable (recompute), a suspected-poison entry is always
arbitrable (recompute and compare), and clearing the cache is always safe
(the reaper can be blunt because the recomputation path is total). A
derive cache that some code *reads directly*, without the fallback,
has silently become a second authority — the exact discrepancy the law
exists to prevent.

Two corollaries close the loop:

- **Version the cache with the derivation.** The recomputation path is
  part of the identity: when the derivation logic changes, yesterday's
  entries are answers to a different question. Fold a derivation version
  into the key namespace (the versioning move from
  [cache-key-discipline](cache-key-discipline.md)) so a logic change
  orphans old entries instead of serving them.
- **Failures are not cached by default.** A derivation that throws on
  malformed content will re-throw on retry — caching the failure is
  legitimate *only* if failure is deterministic per content. If the
  derivation can fail transiently (resource pressure, cancellation), a
  cached failure converts a hiccup into a permanent wrong answer for that
  content version.

## Decision rules

- Key by content identity; declare which spelling (reference, fingerprint,
  hash) and the mutation assumption it rests on.
- Keep the derivation pure, or promote its ambient inputs into the key.
- Entries are immutable; skip freshness machinery entirely — eviction by
  a small recently-used cap is the whole lifetime policy.
- Keep the derivation function as the single door; the cache is an
  internal detail, and recomputation is always available.
- Include a derivation version in the key namespace; bump it when the
  logic changes.
- Cache deterministic failures only; never memoize a transient one.
