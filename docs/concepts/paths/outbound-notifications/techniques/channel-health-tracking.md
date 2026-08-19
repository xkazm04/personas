---
layer: technique
subject: outbound-notifications
technique: channel-health-tracking
status: forged
laws: [failure-not-empty-success, count-carries-predicate, derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Channel health tracking

Every configured channel is a promise the system cannot keep alone: the
endpoint can be deleted, the credential revoked, the room archived, the
receiver rate-limiting — all without notice, all invisible until the next
send. Health tracking is the discipline that turns "the channel broke" from
a silence the user discovers weeks later into a state the system knows,
acts on, and shows. It has two customers with different needs: the
**dispatch loop**, which must protect itself from dead sinks, and the
**channel's owner**, who must be told. Serving only the first is the
classic failure — a pipeline that degrades gracefully around a corpse
while the user waits for messages that will never come.

## The delivery ledger: standing, per sink

Every attempt — success and failure alike — writes the subscription's
standing: last attempt time, last outcome, last error text. This is the
minimum owner-facing truth and it must be durable, because the question it
answers ("when did this last work?") is asked precisely after restarts and
across sessions. The stronger form keeps counters with predicates
attached: consecutive failures, total failures over a window, last success
separately from last attempt
([count-carries-predicate](../../_laws.md#count-carries-predicate) — "3
failures" means nothing without "consecutive, since the last success").
Last-outcome-only is a floor: it cannot distinguish a channel that fails
once a week from one that has failed every attempt for a month, and both
render as one red badge.

The two-question test for any proposed ledger schema: from the records
alone, can you distinguish **(a)** a subscription that delivered nothing
because nothing matched from **(b)** one where every attempt failed
([failure-not-empty-success](../../_laws.md#failure-not-empty-success))?
And within (b), can you tell *since when*? If the answer requires logs,
the ledger is decoration.

## The breaker, applied per sink

The generic circuit-breaker mechanics — thresholds, half-open probes,
recovery — belong to
[circuit-breakers](../../retry-backoff/techniques/circuit-breakers.md).
What this technique owns is their application to outbound sinks, where the
breaker protects something specific: **shared dispatch state**. In a
watermark-driven loop, a failing sink's retries hold the cursor back; if
the cursor is shared across subscriptions, one dead sink re-delivers
everyone's events every tick (duplicate spam to healthy channels) and,
once the backlog outgrows the per-tick window, silently starves newer
events (loss). So the breaker's *defining rule* here: **a sink past its
failure threshold stops influencing shared dispatch state**. It is skipped
except for periodic recovery probes, and probe failures — this is the
subtle half — must *also* not pin the cursor, or the probe cadence
re-creates the pinning it exists to prevent.

Threshold below the trip point is retry territory and stays cursor-pinning
on purpose: transient outages (timeouts, 5xx-class, rate limits, a
credential not yet decryptable at boot) deserve redelivery, and the
healthy-sink path must not lose events to a blip. The breaker separates
"bad afternoon" from "dead", and only "dead" forfeits redelivery.

Breaker state placement is a decision to make once, in writing: in-memory
state resets on restart — a defensible default (a restart *should* re-probe
every sink) — but it means standing is partially a derived value whose
recomputation is "replay failures until the threshold trips again"
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
If the owner-facing surface shows "paused as broken", that state must be
durable or honestly labeled as current-session-only; showing in-memory
breaker state as if it were history misleads exactly the user it exists
to inform.

## Broken must be visible where the subscription lives

The owner-facing contract: the management surface shows, per channel —
current standing (healthy / degraded / paused-as-broken), last successful
delivery, last error verbatim, and *what the system is doing about it*
("skipping, probing every N events"). The strongest form pushes, rather
than waits: a subscription crossing the broken threshold is itself an
event — delivered through the *in-app* tiers, not the broken channel — so
the owner learns about the corpse without visiting the settings page. A
system with an outbound layer already has the machinery to notify about
its own delivery failures; not wiring that loop is leaving the fire alarm
unplugged next to the fire.

## The test-delivery ritual

Every channel offers "send a test now": a synthetic event with an honest
test-shaped type, rendered through the subscription's real template and
real adapter, to the real endpoint — exercising exactly the path
production events take, because a test that bypasses any stage certifies
the stages it skipped. Results write the same ledger. Two guards: the
ritual is **rate-limited per subscription** (a stuck retry-clicker is a
self-inflicted spam incident against a real room), and a test delivery is
labeled as such in the message body, because it lands in a space other
humans read.

## Reaping

Health bookkeeping is keyed by subscription identity, and deletion reaps
it all: ledger rows, breaker entries, rate-limit slots, dead-letter
records ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
The leak shape to guard against is the in-memory map keyed by ids whose
rows are gone — it grows forever in a long-lived process and, worse, a
recreated subscription that reuses an id (import, sync, restore) inherits
a stranger's strikes.
