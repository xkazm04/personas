---
layer: technique
subject: retrieval
technique: embedding-lifecycle
status: forged
laws: [derivation-names-recomputation, gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Embedding lifecycle

A stored vector is a derivation of four inputs: the content, the model that
embedded it, that model's version, and the preprocessing applied on the way
in. Change any input and the vector is stale — but unlike most stale
derivations, a stale vector **keeps working numerically**. Distance functions
accept any two vectors of matching dimension; nothing type-checks the
geometry. This is the defining hazard of the technique: every failure mode
below produces ordered results and no errors.

## Mixed-model corpora are silently broken

Two vectors are comparable only if the same model produced them. Different
models — even successive versions of one model — place the same content at
unrelated coordinates; a distance computed across them is a number-shaped
lie. A corpus that accumulates vectors from two models (an upgrade that
didn't backfill, two ingest paths configured differently, a fallback embedder
that quietly took over during an outage) still answers every query with k
results, ranked by noise, indefinitely. No metric at query time can detect
this; only bookkeeping can.

The bookkeeping is **stamping**: every stored vector carries the identity of
the model that produced it — name, version, and dimension — written at the
single door all vector writes pass through. The stamp is not documentation;
it is the load-bearing fact that makes every other guarantee in this
technique checkable.

## Guard on read, not on hope

The stamp only protects if something reads it. Every query-time path asserts
that candidate vectors match the *active* embedder's stamp before computing a
distance — mismatched vectors are excluded from the lane, not averaged into
it. This is [gate-sees-target](../../_laws.md#gate-sees-target) in miniature:
the gate reads the stored stamp on the actual rows in play, not a config flag
claiming the corpus was migrated. A guard that trusts the migration flag
passes exactly when the migration was incomplete — the case it exists for.

The guard's output is also a **health signal**: the count of excluded
vectors, with its predicate ("N vectors stamped with a model that is not
active"), is the drift meter that tells the operator a backfill is owed. Zero
is the only acceptable steady state.

One nuance earns its complexity when stamping arrives *after* the corpus
exists: unstamped legacy vectors. When the system's history provably contains
exactly one embedder, an absent stamp *is* a current-model stamp, and the
guard may grandfather unstamped rows as compatible — that is what makes
introducing the guard a zero-behavior-change deploy instead of a mass
exclusion of a healthy corpus. The grandfathering is a dated claim about
history, not a policy: it must be written down with its justification, and it
dies the day a second model ships. The backfill respects the same logic —
re-embedding a grandfathered row under the model that already produced it is
churn, not repair.

## Model change is a reindex event

Swapping the embedder invalidates every stored vector at once, so the swap is
an *event* with a named procedure, per
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
— never a config edit that leaves the corpus to sort itself out. Two honest
shapes:

- **Bulk backfill** — re-embed everything under the new model before the new
  model serves queries. Correct and simple; costs one full pass over the
  corpus and a window where ingest must be paused or double-written.
- **Guarded lazy migration** — the new model serves queries immediately, the
  read guard excludes old-stamp vectors (so the semantic lane is *knowingly
  partial*, and says so), and a background job re-embeds in priority order
  until the excluded count reaches zero.

What is never acceptable is the third shape most systems ship by accident:
new model, no guard, no backfill — the mixed corpus. The choice between the
two honest shapes is a availability-versus-completeness trade the operator
should make knowingly; the discipline is that *both* end with the excluded
count at zero and the old vectors reaped.

**Dimension changes** are the hard subcase: a new model with a different
vector width cannot share storage or index structures with the old one.
Coercion — truncating or padding vectors to fit — produces geometry that is
wrong in a way no guard detects, because the stamp check passes. A dimension
change means new storage, guarded cutover, and reaping the old index; there
is no lazy path through shared storage.

## Absence is a mode, not an error

The embedder is the retrieval component most likely to be missing: an
optional heavyweight dependency, a remote service, a model file not yet
downloaded. Its absence must be a **declared degraded mode**, not an
exception on the query path: the semantic lane withdraws, the lexical and
recency lanes carry the query (the fallback shape
[relevance-floors](relevance-floors.md) owns), and the result is labeled as
lexical-only rather than passed off as the full hybrid. Per
[failure-not-empty-success](../../_laws.md#failure-not-empty-success), "the
semantic lane found nothing" and "the semantic lane did not run" are
different claims — collapsing them teaches consumers to distrust every empty.

On the ingest side, absence must **never** be papered over with a substitute
embedder, however tempting the fallback: vectors from the substitute are
mixed-corpus poison the moment the primary returns. Ingest under an absent
embedder either queues content for embedding-later (preserving the single
model identity) or stores chunks lexical-only with the vector owed — both
recoverable, both honest.
