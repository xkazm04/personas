---
layer: technique
subject: webhook-ingestion
technique: payload-bounds
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# Payload bounds

An exposed endpoint is a standing offer to do work for strangers. Without
bounds, the offer is unlimited: a caller can hold a connection open forever,
stream a body until memory runs out, or hand the parser a document crafted to
cost quadratic time. None of this requires a vulnerability — only traffic —
so the defense is not a patch but an ordering: **spend as little as possible
on a request until it has proven it deserves more.**

## The gauntlet, cheapest first

Each stage below costs more per request than the one before it. The
ordering is the design; a stage moved out of order is a stage that lets
unproven input reach expensive machinery.

1. **Connection discipline.** Accept timeouts, read timeouts, and an
   idle-connection cap, all bounded. A caller who sends headers and then
   trickles one byte a minute is consuming a connection slot; the slowest
   acceptable client defines the timeout, and everything slower is refused.
   Cap concurrent in-flight requests — the ingress serves a bounded number
   of simultaneous deliveries and queues or refuses the rest, because an
   unbounded accept loop transmits the sender's burst directly into your
   memory.
2. **Method and path.** A webhook endpoint accepts one method on known
   paths. Everything else is refused before a byte of body is read.
3. **Declared size, then actual size.** Refuse a declared content length
   over the cap before reading; then **enforce the cap while reading**,
   because the declaration is caller-controlled and streaming bodies may not
   declare at all. The buffer-then-check spelling — read everything, then
   measure — is the bug: the damage (memory, time) is done before the check
   runs, so the gate observed a corpse, not the target
   ([gate-sees-target](../../_laws.md#gate-sees-target)). The right cap is
   generous for the domain (senders' payloads have a known scale) and still
   orders of magnitude below "harmful".
4. **Content-type discipline.** An allowlist of the types the ingress
   actually consumes. Everything outside it is refused *without parsing* —
   content sniffing ("it says text but looks like structured data, let's
   try") re-opens the door the allowlist closed.
5. **Authentication** (the sender-authentication technique) — over the raw
   bytes the size stage admitted.
6. **Parsing, bounded.** Only now, and still defensively: depth limits and
   a parse that cannot be steered into pathological time by its input. A
   delivery that fails to parse *after* passing authentication is a fact
   worth alarming on — the sender you trust is sending garbage, which means
   their schema changed or your assumption did.

## Refusals are answers, not conversations

Responses to refused requests are minimal: a status code, no body worth
reading, no reflection of the input, no distinguishing detail between "bad
signature" and "unknown source" for unauthenticated callers. Two reasons:
detail is oracle service for attackers, and reflected input is a stored-
injection vector when responses end up in logs and dashboards. The full
diagnostic story belongs in the delivery record, which authenticated
operators read.

The one deliberate exception: senders' retry machinery reads the status
code. Refusals that the sender should *not* retry (oversize, malformed,
unauthenticated) use codes their conventions treat as permanent; transient
inability (shutting down, over capacity) uses codes they treat as
retryable. Blurring the two either trains the sender to hammer a permanent
failure or to abandon a delivery you wanted retried — the status code is the
only vocabulary you share with a machine you don't control.

## Counters with predicates

Every refusal stage counts what it refuses, per reason and per source:
oversize from X, unparseable from Y, unknown content type from Z
([count-carries-predicate](../../_laws.md#count-carries-predicate)). The
counters are the difference between "the integration is down" and "the
sender doubled their payload size last Tuesday" — and a refusal stage that
does not count is invisible precisely when it starts doing its job.

## Bounds are per-source when sources differ

A single global size cap is where this technique starts, not where it ends.
Sources have characteristic payload scales, and the cap that admits the
largest legitimate sender is far too generous for the smallest. When the
ingress serves multiple subscriptions, bounds attach to the subscription —
which also means an oversize refusal names *whose* traffic tripped it, and a
misbehaving source can be throttled or disabled without lowering the gates
for everyone else.
