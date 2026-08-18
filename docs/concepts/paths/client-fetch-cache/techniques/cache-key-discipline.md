---
layer: technique
subject: client-fetch-cache
technique: cache-key-discipline
status: forged
laws: [identity-survives-reuse, one-authority-per-vocabulary]
shared_with: []
---

# Cache key discipline

The key is the cache's contract: two reads with the same key are asserted
to be the same question, and will receive the same answer. Every cache
defect that is not a lifetime defect is a key defect, and the two failure
directions are not symmetric:

- **Collision** (key too coarse — an axis that changes the answer is
  missing from it): one question's answer is served to a different
  question. Silent, deterministic, and wrong-looking only to the user —
  the worst class.
- **Fragmentation** (key too fine, or unstable — equal questions produce
  unequal keys): the cache misses when it should hit. Wasteful, visible
  only as coldness, and by far the cheaper failure.

When in doubt, err toward fragmentation. A duplicate fetch costs
milliseconds; a collision costs correctness.

## Keys are derived, never hand-written

The key is a **pure function of every argument that changes the answer** —
computed by one builder per cache, not assembled ad hoc at call sites. Two
call sites hand-concatenating their own keys are two authorities over one
vocabulary, and they drift the day someone adds a parameter to one of them
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The builder is where the discipline lives:

- **Enumerate the axes.** Resource, identifiers, filters, sort, page,
  scope — the explicit arguments are the easy part. The collisions hide in
  the *implicit* axes: the identity on whose behalf the request runs, the
  active workspace or tenant, the locale when the server localizes, the
  environment or endpoint when the client can point at more than one. If
  changing it changes the response, it is part of the key, even though no
  caller passes it explicitly.
- **Canonical serialization.** Compound arguments must serialize stably:
  fields in a fixed order, absent-versus-default normalized, collections
  ordered when order does not change the answer. Naive serialization of an
  object whose field order varies by construction site fragments the cache
  into one entry per spelling of the same question.
- **Delimit unambiguously.** Keys built by joining parts with a separator
  inherit injection: parts containing the separator make two different
  questions spell one key — a collision by string accident. Escape, use a
  structured encoding, or choose a separator the parts cannot contain, and
  say which at the builder.

The identity law applies to the key itself
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): a key
must name the *question*, not the circumstances of asking. Timestamps,
sequence numbers, or per-mount tokens in a key mean no two asks ever match
— a cache with a hit rate of zero, which is a dedup registry's failure
too, since dedup shares the same keys ([in-flight-dedup](in-flight-dedup.md)).

## Version the key when the value's shape changes

A cache entry is a value with an assumed shape, and the code that reads it
compiles that assumption in. When the shape changes — a field renamed,
semantics shifted, a parse format extended — entries written by yesterday's
code are landmines for today's readers. For client caches the cheap,
sufficient answer is not migration (these are caches; the authority is a
refetch away) but **namespace versioning**: a version component in the key,
bumped when the shape changes, so old entries simply stop being found and
age out under the eviction policy. This matters most for caches that
persist beyond the process, where "just restart" no longer clears the old
shapes; the heavier alternatives — validation and migration on rehydrate —
belong to the persistence contract in the client-state subject, and a cache
should rarely earn them.

## The collision audit

Because collisions are silent, they are found by audit, not by symptom.
The audit is short and worth running whenever a cache changes:

1. List every axis that can change the response for this request family —
   explicit arguments, then the implicit set: identity, tenant/workspace,
   locale, environment, protocol version.
2. For each axis, point to where the key builder incorporates it, or
   record why it cannot vary within one cache's lifetime (and what
   enforces that — "we clear all caches on identity change" is a valid
   answer only if something actually does).
3. Grep for key construction outside the builder; every hit is either
   migrated into the builder or is a second authority waiting to drift.

The classic escapes: a cache shared across a login boundary serving one
user's data to the next; a locale switch painting yesterday's language
from cache; a staging/production toggle serving one environment's rows to
the other. All three are axis-missing-from-key, and all three pass every
test that does not vary the axis.

## Decision rules

- One key builder per cache; call sites pass arguments, never strings.
- Include every answer-changing axis, implicit ones first — identity,
  tenant, locale, environment.
- Serialize compound arguments canonically; unordered parts get ordered,
  defaults get normalized.
- Prefer fragmentation over collision whenever the axis list is uncertain.
- Bump a key-namespace version on value-shape change; let eviction retire
  the orphans.
- Re-run the collision audit when adding an argument, a tenant concept, a
  locale, or a second endpoint.
