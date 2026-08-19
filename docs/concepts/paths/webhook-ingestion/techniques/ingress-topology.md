---
layer: technique
subject: webhook-ingestion
technique: ingress-topology
status: forged
laws: [gate-sees-target, failure-not-empty-success]
shared_with: []
---

# Ingress topology

A webhook sender needs a URL it can reach. For a service deployed on the
public internet that sentence is trivial; for a local-first application, a
process behind a corporate firewall, or a development machine, it is the
hardest problem in the subject — the sender can be anywhere, and *your
process cannot accept a connection from there*. The answers form a menu, and
the menu is the technique: each option buys reachability with a different
currency — trust, latency, or an external dependency — and a mature ingress
knows which it is paying.

## Option one: the direct listener

The process binds a port and receives deliveries itself.

- **Trusts**: nobody new. The bytes travel from sender to receiver with no
  additional party able to read or modify them (transport encryption
  assumed).
- **Latency**: the floor — one network hop, no intermediary queue.
- **Reachability**: the catch. Works when the sender can route to the
  listener: same machine, same private network, or a receiver with a public
  address. Fails silently otherwise — and "silently" is exact: a sender that
  cannot connect produces *nothing* on the receiver's side, indistinguishable
  from a sender with nothing to say
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  The listener's bind scope is also a security decision: loopback-only serves
  same-machine senders and exposes nothing; binding all interfaces invites
  the local network in, and had better mean to.

## Option two: the relay

A reachable intermediary accepts deliveries at a public URL and forwards
them to the private receiver over a connection the receiver dialed
*outbound* — typically a held-open streaming channel. The sender sees a
normal endpoint; the receiver sees a subscription it initiated, which
traverses any firewall that permits outbound traffic.

- **Trusts**: the intermediary, completely, with payload *contents* — it
  terminates the sender's connection and sees every byte. This is the
  option's entire cost, and it is paid whether or not anything goes wrong.
  Two disciplines keep the cost bounded:
  - **verification stays at the final hop.** The relay forwards deliveries
    byte-intact, headers preserved, and the receiver verifies the sender's
    signature itself, against its own secret. A relay that verifies "for
    you" holds your secrets; a relay whose forwarding mangles bytes breaks
    verification at the only hop that matters
    ([gate-sees-target](../../_laws.md#gate-sees-target) — the gate must see
    the sender's bytes, not the relay's rendition).
  - **the relay is untrusted for authenticity even when trusted for
    transport.** Anyone who learns the public relay URL can post to it; the
    signature check is what makes that harmless.
- **Latency**: one added hop plus the relay's queueing; usually modest,
  occasionally the tail.
- **Failure modes it adds**: the held-open channel drops and must reconnect
  with backoff; deliveries during the gap are lost or buffered depending on
  the relay's contract — *know which*, because "at-least-once until the
  channel drops" is at-most-once wearing a costume. The subscription channel
  itself is a long-lived stream and inherits the reconnect-and-resume
  discipline of [streaming-output](../../streaming-output/streaming-output.md).

## Option three: polling the sender

No inbound path at all: the receiver periodically asks the sender's API
"what happened since my cursor?" This is not strictly webhook ingestion —
it is its honest fallback, and every ingress design should know the option
exists, because it beats a fragile relay chain when latency tolerance is
minutes rather than seconds.

- **Trusts**: nobody new; the receiver authenticates *to* the sender with
  ordinary outbound credentials.
- **Latency**: the polling interval, by construction.
- **What it buys**: immunity to every reachability problem, plus pull-side
  control of rate and ordering. What it costs: the sender must offer a
  pollable record with cursors — many do not — and the receiver now owns
  cursor durability.

## Running more than one

Real systems end up with two mouths open — a direct listener for
same-machine and LAN senders, a relay for the internet — and sometimes a
polling fallback besides. Three rules keep plurality from becoming
incoherence:

- **One admission door.** Every mouth feeds the same verification, bounds,
  dedup, and mint path. Topology decides how bytes arrive, never what is
  done with them.
- **Dedup across mouths.** During failover, or when a sender is configured
  toward two mouths at once, the same delivery arrives twice by different
  roads. Delivery identity (the dedup technique) is what makes that
  harmless; without it, redundancy manufactures duplicates.
- **Liveness is per-mouth.** "The relay channel is connected", "the listener
  is bound", "the last poll succeeded" are three different health facts;
  collapsing them into one green light means the surviving mouth's health
  masks the dead one's silence. Each mouth reports separately, and the
  operator sees which road a delivery actually traveled.

## Choosing

The decision procedure compresses well: **can the sender reach you directly?
Use the direct listener. Can it not, and seconds matter? Pay the relay's
trust cost with eyes open — signature verification at your hop,
reconnect-with-backoff, and a plan for channel-gap loss. Can you tolerate
minutes? Poll, and own a cursor instead of a listener.** The wrong answer is
the unexamined one: a relay adopted because an example used it, holding
payloads that were never meant to transit a third party.
