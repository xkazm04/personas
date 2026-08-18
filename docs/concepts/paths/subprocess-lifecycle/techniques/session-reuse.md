---
layer: technique
subject: subprocess-lifecycle
technique: session-reuse
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation, failure-not-empty-success]
shared_with: []
---

# Session reuse

Some children are expensive to be born: runtime startup, model or index
loading, workspace scanning, authentication handshakes — seconds of cost
before the first useful byte, paid identically on every cold spawn. When
the same logical consumer will come back repeatedly, the host amortizes
that cost with a **session**: a warm child (or its resumable state — a
continuation token the tool itself understands) kept across requests, so
request N+1 pays marginal cost.

Reuse is pure economics on the benefit side and pure correctness on the
cost side. Every defect in this technique is a variant of one sentence: *a
warm session embodies the world as it was at creation, and the world
moved.*

## What a session actually is

Two shapes, one discipline:

- **A live warm process** — the child stays up between requests, holding
  its loaded state. The host owns a real process the whole time: it holds
  a slot (or a dedicated warm-pool budget), it appears in liveness
  tracking, and it still names its reaper — idle warmth is not exemption
  from the lifecycle.
- **A resumable identity** — the child exits between requests, but the
  tool supports resuming a named session, reloading its accumulated state
  cheaper than a cold start. Here the host keeps only the token — but the
  token *is* identity, and it must be minted once and carried, not
  reconstructed from circumstances
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)):
  a session "found" by matching directory names or timestamps will
  eventually resume somebody else's state.

## The configuration fingerprint

A session is keyed by a **fingerprint of everything that shaped it**:
executable identity and version, the argument-relevant configuration, the
environment entries that alter behavior, the workspace or data-set
identity, the tool-side session token's own version. The pool's contract
is exact-match: a request whose fingerprint differs from a pooled
session's — in *any* component — gets a cold spawn, and the stale session
is retired.

Fingerprint discipline:

- **Compute it in one place**, from the same inputs the spawn door uses —
  not a parallel hand-maintained summary that drifts from the real spawn.
  The failure mode of two independently-computed fingerprints is uniquely
  quiet: if the store side and the lookup side hash different input sets,
  the lookup *never* matches, every request cold-starts, and nothing errors
  — the pool silently becomes a no-op while the system behaves correctly
  in every observable way except cost. The only detector is an
  instrumented hit rate with an expectation attached; a pool nobody
  measures can be dead for a year.
  The cached warm session is a derived value, and the fingerprint is the
  statement of how to recompute what it derives from
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation));
  the cold spawn path is the recomputation, and it must remain permanently
  available and correct, because the pool is an optimization over it, never
  a replacement for it.
- **Prefer over-inclusion.** A component wrongly left out of the
  fingerprint produces silent wrong-world reuse; a component wrongly
  included produces a harmless extra cold start. The asymmetry decides
  every borderline call.
- **Version the fingerprint scheme itself**, so a host upgrade that
  changes what "equivalent configuration" means invalidates the whole pool
  by construction instead of by luck.

## Invalidation triggers

A pooled session is discarded — never repaired, never "probably fine" — on
any of:

1. **Fingerprint mismatch** at lookup (the request wants a different
   world).
2. **Any failure of the session's last use.** A session that just
   misbehaved — error, timeout, garbled protocol, killed by ladder — has
   forfeited the presumption of reusability, *even if* the failure looks
   environmental. Reusing a possibly-corrupted session converts one
   visible failure into a lineage of subtle ones; the cold spawn is the
   cheap insurance. Note the asymmetry with retries: the *request* may be
   retried, but on a *fresh* session.
3. **Idle expiry.** Warmth decays: the workspace changes underneath, the
   tool's internal caches go stale, credentials expire. An idle deadline
   bounds how old a world the pool can serve.
4. **Use-count ceiling**, where the tool accumulates state per use
   (context growth, memory creep) — the ceiling converts a slow
   degradation into a scheduled refresh.
5. **Pool-wide flush** on host upgrade, tool upgrade, or explicit operator
   request — the blunt instrument, cheap because the recomputation path
   is always there.

Retirement of a live warm process is a normal termination-ladder run
([termination-and-reaping](termination-and-reaping.md)) — a session's end
is not a special, gentler death.

## Reuse must be honest in the record

Every run's record states whether it ran on a warm session or a cold
spawn, and which session identity served it. Two reasons. Operationally,
"this class of failure only happens on reuse" is the single most common
diagnostic cut in this technique, and it is only available if the record
carries the bit. And truthfully, a session-resume that silently fell back
to a cold spawn (token expired, pool empty) must not report as a resume —
success at doing *something else* is
[failure spelled as success](../../_laws.md#failure-not-empty-success) for
whoever depends on the accumulated state actually being there; the
consumer may see an assistant that "forgot" everything, and the record
must explain why.

## Sizing the pool

The warm pool is a bet placed with slot capacity: every idle warm child
holds resources that active work could use. Size it from measured facts —
cold-start cost, request inter-arrival per fingerprint, hit rate — and let
it shrink to zero gracefully under pressure: under
[host-resource-protection](host-resource-protection.md)'s admission rules,
idle warmth is the *first* thing shed, because its loss costs latency, not
correctness.
