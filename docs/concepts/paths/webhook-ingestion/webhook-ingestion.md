---
layer: golden-path
subject: webhook-ingestion
status: forged
techniques:
  - sender-authentication
  - payload-bounds
  - ingress-topology
  - delivery-logging-and-replay
  - duplicate-and-replay-dedup
  - listener-lifecycle
evidence:
  - src-tauri/src/engine/webhook.rs                              # direct listener: mandatory HMAC fail-closed on missing secret (:373-428), constant-time verify with dummy-decode equal-path (:537-559), 1MB body cap (:69,:75), per-trigger tier-aware rate limit (:331-360), graceful shutdown via watch channel (:84-89), log-every-delivery regardless of verdict (:260-273), 422+Retry-After for the retryable refusal class (:430-466)
  - src-tauri/src/engine/smee_relay.rs                           # relay/SSE mouth: bounded SSE buffer (1MB), reconnect backoff with stability reset, dedup ladder (SSE id > sender delivery id > content hash, bounded FIFO 512), Last-Event-ID resume, fail-closed on malformed filter config
  - src-tauri/src/engine/cloud_webhook_relay.rs                  # polling mouth: bounded fetch page with hit-cap warning, per-call timeout + semaphore fan-out cap
  - src-tauri/db/src/repos/resources/webhook_log.rs              # delivery record: 100-per-trigger retention cap enforced by the writer (every 10th insert)
  - src-tauri/src/commands/tools/triggers.rs                     # replay_webhook_request (:1775): re-signs the recorded body with the current secret and re-enters through the live endpoint — replay through the same admission door; webhook_request_to_curl (:1836): export for reproduction
  - src-tauri/db/src/repos/resources/cloud_webhook_watermarks.rs # BOUNDARY: durable restart-safe delivery watermarks — delivery-guarantees' ground; cited as the hand-off artifact, not owned here
counter_evidence:
  - src-tauri/src/engine/smee_relay.rs                           # ALSO the key counter-example: relay authenticity is OPT-IN and fail-OPEN by default (env-var secret unset ⇒ accept unauthenticated), and verification hashes a re-serialized body, not the sender's raw bytes — both documented in-file as deliberate deferrals
deviations:
  - w9-webhook-ingestion   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Webhook ingestion

Webhook ingestion is the surface where **another organization's software calls
yours**: an external system delivers a fact — a payment settled, a build
finished, an issue changed — by pushing a request at an endpoint you exposed
for exactly that purpose. The unit of work is the **delivery**: one inbound
request, from one claimed sender, carrying one or more claimed facts, arriving
as untrusted bytes on the open network. The job of this subject is to turn a
delivery into an **internal event with identity** — or to reject it — and
nothing else.

That "nothing else" is the boundary, and it is worth drawing precisely,
because everything downstream of the mint point belongs to other subjects:

- Once a delivery is admitted and minted as an internal event, **routing it to
  consumers** is the event bus's job —
  [realtime-events](../realtime-events/realtime-events.md), whose
  [event-registry](../realtime-events/techniques/event-registry.md) owns the
  vocabulary the minted event must speak. The ingress does not invent event
  names; it translates a sender's vocabulary into the registry's.
- **What happens if processing fails after admission** — retry, requeue,
  poison handling, exactly-how-many-times semantics — belongs to
  delivery-guarantees. The ingress hands over an admitted event and a durable
  record; it does not own the afterlife.
- **Deciding which automations an admitted event should fire** is trigger
  matching, owned by [scheduling](../scheduling/techniques/trigger-matching.md).
- **The general model of who may do what inside the system** is
  [authorization](../authorization/authorization.md). The ingress owns one
  sliver of it — proving the *sender* is who it claims — precisely because
  none of the usual authorization machinery exists out here: no session, no
  logged-in principal, no interactive credential exchange. Just bytes and a
  shared secret.

The through-line of the whole subject: **an inbound webhook endpoint is a
hostile-input boundary that you volunteered to expose.** Every other network
surface in a local-first or backend application faces callers you configured;
this one faces the entire internet, or at minimum a third party whose bugs,
retries, and compromises are outside your control. Every stance below follows
from taking that seriously.

## Authenticate the sender before believing the body

The first question asked of a delivery is not "what does it say?" but "who
sent it, and can they prove it?" The proof is cryptographic — typically a
keyed digest of the exact bytes received, computed with a secret shared at
subscription time — and it is checked **before the body is parsed, before any
field is read, before any state is touched**. A body you have not
authenticated is attacker input; parsing it first means your parser, your
decoder, and every bug in both are exposed to anyone who can find the URL.

Two consequences are non-negotiable:

- **Fail closed when verification is impossible.** A missing secret, a
  misconfigured subscription, an unrecognized signature scheme — each of
  these means the delivery *cannot be verified*, and an unverifiable webhook
  is a rejected webhook. The tempting fallback — "no secret configured, so
  accept everything" — silently converts a security control into decoration
  the day someone forgets a configuration step, and nothing in the system's
  observable behavior changes when it happens
  ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
- **Verify the bytes you will parse.** The digest is computed over the raw
  received body — not a re-serialization, not a normalized form, not the
  parsed-then-reprinted object. Any transformation between verification and
  parsing is a gap where verified bytes and consumed bytes can differ
  ([gate-sees-target](../_laws.md#gate-sees-target)).

The [sender-authentication](techniques/sender-authentication.md) technique
owns the digest discipline, constant-time comparison, timestamp windows, and
secret rotation.

## Bounds before parsing — the endpoint is a standing invitation

An open endpoint that reads unbounded bodies, parses arbitrary content types,
and waits indefinitely for slow clients is a denial-of-service invitation
that requires no vulnerability at all — just traffic. The ingress therefore
enforces its cheap refusals in strict order: transport-level limits first
(connection and read timeouts), then size caps *enforced while reading* (not
after buffering), then content-type discipline, then authentication, and only
then — for a delivery that has survived everything — parsing. Each stage
spends more per request than the last, so each stage's job is to keep garbage
away from the stage after it. The
[payload-bounds](techniques/payload-bounds.md) technique owns the ordering
and the limits.

## The delivery record is the debugging lifeline

Webhook bugs have a uniquely miserable failure mode: the triggering input
came from another organization's system, at a time you didn't choose, in a
shape you can't conjure again by clicking around. Without a record of the
delivery, "the webhook didn't work" is unreproducible by construction.

So the ingress records **every delivery, verbatim, verdict attached** —
accepted or rejected, and *why* rejected — with secrets and credentials
redacted at write time, never at display time. From that record, two
affordances fall out that separate a debuggable ingress from a black box:

- **Replay**: re-inject a recorded delivery through the same admission path
  it originally took, so a bug fixed can be verified against the exact bytes
  that exposed it. Replay is a designed feature with a consent story, not a
  hack someone performs with copied logs.
- **Export**: hand a developer a self-contained reproduction of the request
  they can fire from any machine.

The [delivery-logging-and-replay](techniques/delivery-logging-and-replay.md)
technique owns the record's shape, redaction, retention, and the replay door.

## Duplicates are the sender's contract, not a malfunction

Every serious webhook producer promises *at-least-once* delivery, which is a
polite way of saying: **you will receive duplicates, on purpose, and it is
your job to cope.** A timeout on the sender's side — even one where your
processing succeeded — produces a retry; an outage produces a batch of them.
Deduplication therefore happens at the mint point, keyed on **delivery
identity** (the sender's delivery identifier when one is provided; a content
digest within a bounded window when not), so that one external fact becomes
one internal event no matter how many times it arrives
([identity-survives-reuse](../_laws.md#identity-survives-reuse)).

The same technique draws a line that security reviews care about: a
*sender retry* (benign, expected, deduplicated quietly) and a *replay attack*
(an adversary re-transmitting a captured legitimate delivery) are different
phenomena with different owners — the former is identity bookkeeping, the
latter is defeated by the timestamp window inside sender authentication. The
[duplicate-and-replay-dedup](techniques/duplicate-and-replay-dedup.md)
technique owns the distinction and the bounded memory that dedup requires.

## Topology is a menu, and every option moves the trust boundary

"Expose an endpoint" hides a hard operational question: *reachable how?* A
process on a developer workstation or inside a private network cannot receive
a connection from the open internet, and the ways around that are a genuine
menu, not a default:

- a **direct local listener** — lowest latency, no third party, but reachable
  only by senders who can route to it;
- a **relay** — a reachable intermediary that accepts deliveries publicly and
  forwards them over a connection the private side dialed *outbound*; solves
  reachability, but the intermediary sees every payload, so end-to-end sender
  verification must still happen at the final hop, never delegated to the
  middle;
- a **polling or streaming subscription** — the private side dials out and
  holds a subscription channel open, receiving deliveries as a consumer of
  someone else's stream; trades latency and an external dependency for
  working behind any network boundary.

Each option relocates trust, latency, and failure differently, and a system
that supports more than one must decide what happens when both carry the same
delivery (that is the dedup technique's problem) and which one is
authoritative for liveness. The
[ingress-topology](techniques/ingress-topology.md) technique owns the menu
and the failover discipline.

## One admission door, no matter how many mouths

However many topologies feed the ingress — a local listener, a relay bridge,
a replayed record — **all of them converge on a single admission path**:
one place where bounds, authentication, dedup, and minting happen, in that
order, once. The alternative — each ingress mouth carrying its own copy of
the checks — is the classic scattered-validation failure: the copies drift,
and the attacker (or the flaky sender) finds the mouth that forgot a step
([one-validation-door](../_laws.md#one-validation-door)). Replay, in
particular, must go through the same door as live traffic, or replayed
deliveries test a path production never runs.

## The listener is a resource with a lifecycle

The ingress itself — the bound port, the accept loop, the outbound relay
subscription — is created, must be observable, and must name its reaper
([creation-names-reaper](../_laws.md#creation-names-reaper)). Port binding
fails loudly, not into a silent no-traffic state indistinguishable from "no
sender has anything to say"; shutdown stops accepting, drains in-flight
deliveries, and releases the port; and the ingress can answer "are you up?"
independently of whether any sender has called lately. The
[listener-lifecycle](techniques/listener-lifecycle.md) technique owns it,
alongside the standing liveness doctrine in
[health-checks](../health-checks/health-checks.md).

## What the surface owes the operator

- **Rejection counters with reasons attached**: how many deliveries were
  refused, per cause — bad signature, missing secret, oversize, unknown
  source — because a spike in one reason is a diagnosis and a bare total is
  not ([count-carries-predicate](../_laws.md#count-carries-predicate)).
- **Per-source last-delivery timestamps**: "when did we last hear from X?"
  is the first question of every integration incident, and silence must be
  distinguishable from rejection.
- **The delivery record itself**, queryable by source, verdict, and time —
  the difference between debugging an integration and re-deriving it from
  the sender's dashboard.

## The techniques

- [sender-authentication](techniques/sender-authentication.md) — keyed-digest
  verification over raw bytes, constant-time comparison, fail-closed posture,
  timestamp windows, secret rotation.
- [payload-bounds](techniques/payload-bounds.md) — reject-before-parse
  ordering, streaming size caps, timeouts, content-type discipline, response
  minimalism toward unauthenticated callers.
- [ingress-topology](techniques/ingress-topology.md) — direct listener vs
  relay vs outbound subscription; what each trusts; failover and
  authoritativeness between them.
- [delivery-logging-and-replay](techniques/delivery-logging-and-replay.md) —
  the verbatim redacted record, verdict taxonomy, replay through the
  admission door, export, retention.
- [duplicate-and-replay-dedup](techniques/duplicate-and-replay-dedup.md) —
  delivery identity, dedup at the mint point, sender-retry vs replay-attack,
  bounded dedup memory.
- [listener-lifecycle](techniques/listener-lifecycle.md) — binding, loud
  startup failure, graceful drain, health of the ingress itself.
