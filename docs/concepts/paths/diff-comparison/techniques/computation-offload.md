---
layer: technique
subject: diff-comparison
technique: computation-offload
status: forged
laws: [failure-not-empty-success, creation-names-reaper, derivation-names-recomputation]
shared_with: []
---

# Computation offload

Diff algorithms are superlinear in their worst case, real inputs are
unbounded in the tail (the transcript that grew to megabytes, the record
with ten thousand list elements), and the surface that displays the diff
is the very surface the reader is trying to operate. Those three facts
compose into the subject's defining constraint: **a diff that freezes the
surface it explains has failed its purpose** — the reader asked "what
changed?" and the product answered by taking away their cursor. Comparison
is therefore computed off the interactive thread, as a request/response
exchange with an identity, a budget, and a declared failure shape.

## The request has an identity, and stale results are dropped

The reader changes the pair faster than large diffs compute. Every
comparison request carries an identity minted at issue time; when the
response arrives, it is applied only if it answers the *current* request —
otherwise discarded. Without this guard the surface exhibits the classic
race: the reader selects pair B, the slow answer for pair A lands second,
and the surface confidently displays A's differences under B's header — a
correctly-computed diff attached to the wrong question, unnoticeable by
construction. Supersession also propagates backwards: issuing a new
request cancels the old computation where the mechanism allows, because
work whose answer is pre-discarded is pure heat.

The computation resource itself has a named reaper ([_laws:
creation-names-reaper_](../../_laws.md#creation-names-reaper)): whatever
spawns the background computation states what terminates it — pair
change, surface dismissal, timeout — and surface teardown reliably reaps
in-flight work. A comparison surface that leaks one background computation
per visit is a slow-motion resource exhaustion that profiles as "the app
gets worse over the day".

## Budgets, and disclosed degradation

Unbounded inputs meet fixed patience. Declare budgets on the way in — an
input-size cap, a time budget, an output cap (differences beyond N) — and
decide *at design time* what each overrun degrades to, because the
fallback chosen during an incident is always "silently truncate". The
honest degradation ladder, top to bottom:

1. **Full diff** at the chosen semantic level.
2. **Coarser level** — field-level presence/changed flags without
   per-field detail; "these 3 sections differ" without intra-section
   alignment. Cheaper by orders of magnitude, still true.
3. **Summary counts only** — enough for triage, labeled as the ceiling
   the budget allowed.
4. **"Too large to compare"** — itself a legitimate, honest answer.

Every step down is *disclosed at the point of degradation* — the wording
belongs to diff-honesty; this technique owns that the ladder exists and
that the budget, not a crash, chooses the rung. An undisclosed partial
diff is worse than rung 4, because its unmarked tail reads as "unchanged".

Two cheap kernel disciplines make the budget rarely bind, and both were
learned in production once and then not carried to sibling kernels:
**strip the shared prefix and suffix before the expensive alignment** — a
one-word edit in a thousand-word document then costs a few dozen
comparisons instead of a million-cell table — and **put the ceiling in the
algorithm, not in a comment**. "Typically fewer than a hundred lines" next
to an unbounded quadratic allocation is not a budget; it is a prediction
about the input, and the input does not read comments. A ceiling checked
*after* stripping is the right order: check the raw sizes, strip, re-check
the middle, and only then choose the rung.

## The render is inside the budget

Offloading the kernel buys nothing if the render freezes the surface. A
diff produces one visual unit per element by construction — one node per
line, per token, per field — and a large diff rendered whole is a
large-list problem wearing a diff costume: thousands of nodes on the
interactive thread, rebuilt on every unrelated re-render if the diff is
computed inline in the render path rather than memoized against its
inputs. Two obligations follow. The kernel result is memoized on the pair
and parameters, so a tooltip or a lazily arriving label does not re-run
the alignment; and the render is either virtualized or capped at a
declared unit count with disclosed truncation. Streaming partial results
into the surface has its own quadratic trap: appending each chunk by
copying the accumulated array is O(n²/chunk) — accumulate by mutation
inside the boundary that owns the buffer, and let the surface read a
stable reference.

## Failure is spelled as failure

A computation that dies — crash, timeout, resource ceiling — must render
as "comparison unavailable", visually and semantically distinct from a
diff with zero differences ([_laws:
failure-not-empty-success_](../../_laws.md#failure-not-empty-success)).
The empty diff is this subject's most expensive lie: "no differences" is a
*finding* readers act on (approve the promotion, skip the review, close
the incident), and a dead background computation that surfaces as an empty
result manufactures that finding from nothing. The response channel
therefore distinguishes *completed-with-empty-result* from *did-not-
complete* as different message shapes, not as the presence or absence of
data — absence is exactly what cannot be distinguished from loss.

## The fast path and the cache

Offload has a latency floor — marshalling, scheduling, the round trip —
that dwarfs the diff itself for small inputs. Below a measured size
threshold, compute synchronously; the threshold is a number someone
measured on realistic inputs, not a guess, and it is revisited when input
shapes change. The reader should never wait on infrastructure to learn
that two twenty-line records differ in one field.

Computed diffs are cacheable derivations: keyed by the pair's identities
*and content fingerprints* plus the comparison parameters (level,
normalization ledger version), because a pair identity alone goes stale
the moment either side is edited. A cached diff names its recomputation —
the key states exactly what inputs regenerate it ([_laws:
derivation-names-recomputation_](../../_laws.md#derivation-names-recomputation))
— and cache entries carry the same reaper discipline as computations:
bounded, evicted, never "the map that only grows". A hash-equality
pre-check sits in front of everything: identical fingerprints
short-circuit to "no differences at byte level" for free, which is both
the cheapest computation and — because the level is stated — an honest
one.
