---
layer: golden-path
subject: p2p-networking
status: forged
techniques:
  - discovery-advertisement
  - peer-state-honesty
  - connection-lifecycle
  - exposure-controls
  - manifest-negotiation
  - resilience-and-reconnection
evidence:
  - src-tauri/engine/src/p2p/mdns.rs                       # minimized advertisement (id + name + version only); every TXT field validated as hostile input (32-byte id check, char-boundary name truncation, address parse + cap); batched transactional flush; stale-peer prune
  - src-tauri/engine/src/p2p/connection.rs                 # per-phase handshake timeouts, cancellation-safe dial dedupe (RAII guard), lexicographic simultaneous-connect tie-break atomic with the capacity check, typed DisconnectReason, ping/pong supervision, per-peer inbound rate limit
  - src-tauri/engine/src/p2p/mod.rs                        # one cancellation token threaded through every background loop (fresh token per restart); startup reset of stale is_connected claims; push snapshot emitter; ordered stop()
  - src-tauri/engine/src/p2p/manifest_sync.rs              # bounded manifests (entry cap), content-hash delta skip, transactional replace-not-patch, fail-closed exclusion of auth-gated resources, per-peer hash cache with a reaper
  - src-tauri/engine/src/p2p/types.rs                      # the state vocabulary (ConnectionState, trust_status doc, identity_degraded honesty flag), NetworkConfig
  - src-tauri/engine/src/p2p/transport.rs                  # dual-stack bind so neither address family is silently unreachable
  - src-tauri/core/src/models/exposure.rs                  # allowlist by construction: explicit exposure records with enumerated fields_exposed, typed access levels, requires_auth, expires_at
  - src-tauri/src/commands/network/exposure.rs             # exposure CRUD behind auth with audit-shaped logging (exposure_created/updated/deleted)
  - src-tauri/src/commands/network/discovery.rs            # IPC surface; uniform "not initialized" door; identity never masked by an empty default
  - src/features/settings/sub_network/components/NetworkDashboard.tsx  # live peer/status surface: staleness banner, identity-degraded warning, typed disconnect breakdown, push events + slow poll fallback
  - src-tauri/Cargo.toml                                   # the whole subsystem compiles behind the p2p feature tier
counter_evidence:
  - src-tauri/engine/src/p2p/connection.rs                 # ALSO the key counter-example: the header comment promises auto-reconnect, but the retry ceiling is a dead field, retry_count is never incremented, and nothing redials — absence downgrades a peer and nothing ever brings it back but a human
  - src-tauri/src/lib.rs                                   # network service auto-starts in every p2p build after a fixed delay — no discoverability consent gate; the advertisement goes out because the binary supports it, not because the user chose it
deviations:
  - w11-p2p-networking   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w11-p2p-networking   # proposed anchor for docs/concepts/golden-path-deferred-fixes.md (registered by report, not by this document)
---

# P2P device networking

P2P device networking is the machinery you build when two installations of
the same application must find each other and exchange data **directly** —
across a home or office network, with no server brokering the exchange and
no account system vouching for anyone. The unit of currency is the
**peer**: another installation, on hardware you do not control, reached
over a network you do not control, claiming an identity you have not yet
verified. Everything in this subject follows from taking those three
"do not control" clauses seriously.

That definition decides when *not* to build it:

- **When a server is affordable.** A hub gives you ordering, presence,
  NAT traversal, and one trust root for the price of hosting. Peer-to-peer
  buys independence from that hub at the cost of solving discovery,
  reachability, identity, and partial connectivity yourself — pay it only
  when serverlessness is the product promise (privacy, offline-first,
  zero-infrastructure), not an aesthetic.
- **When the data flows one way to a service.** That is a client, and
  client problems (auth against an authority, retries against a stable
  endpoint) are already solved subjects. Peer problems begin where both
  ends are equals and neither is reliably present.
- **When "nearby" is not actually a requirement.** Local-network
  discovery only works on the local network. If peers must meet across
  the internet, you are building relays and hole-punching — a different
  cost class; be sure the local case alone justifies the subsystem.

The subject also has a hard boundary it must respect: **trust is
established by a ceremony, not by this layer.** Discovery tells you a
device exists; transport gets bytes to it; but the decision that this
device is *yours to talk to* — key exchange, verification codes, the
human saying yes on both screens — is the pairing ceremony, which is its
own subject (device-pairing). This subject consumes the trust that
ceremony produces and must never manufacture trust from mere
connectivity.

One economic note before the physics: a peer subsystem drags in
discovery responders, transport stacks, and crypto — heavy dependencies
that most builds of the application may not want. The whole subsystem
should compile behind a capability flag
([capability-feature-gating](../build-economics/techniques/capability-feature-gating.md)),
with the boundary drawn so the rest of the application compiles and runs
identically without it.

## What you broadcast is a privacy decision

Discovery works by announcing yourself to everyone within earshot — that
is the mechanism, and it cannot be softened. A discovery advertisement is
therefore a **publication**: every device on the network, including ones
you will never pair with and ones you would not want reading it, receives
the device's name and whatever else the advertisement carries. So the
advertisement's contents are a designed, minimized surface — a stable
opaque identifier, a display name the user consented to broadcast, a
protocol version, an endpoint — and nothing else. No account identifiers,
no capability inventories, no hints about the data held. And
discoverability itself is consent: a visible setting, and turning it off
silences the responder in fact, not just in the UI. The
[discovery-advertisement](techniques/discovery-advertisement.md)
technique owns the surface.

## Discovery and reachability are different truths

Hearing a peer's advertisement proves one thing: a multicast packet
crossed the network once. It does not prove you can open a connection —
firewalls pass multicast and block unicast, access points isolate
clients, subnets route asymmetrically. The inverse holds too: a peer you
cannot *hear* may be perfectly reachable at its last known address. A
peer list that renders "I heard it" as "it is available" writes checks
the transport cannot cash, and users learn the list lies. The honest
model is a small vocabulary of states — discovered, reachable,
connected, stale — each earned by different evidence with different
freshness, each shown for what it is. The
[peer-state-honesty](techniques/peer-state-honesty.md) technique owns
the vocabulary.

## Connections have owned lifecycles

A peer connection is a resource with a birth, a life, and a death, and
all three must have owners. Establishment is bounded — dial timeout,
handshake timeout, and a cancellation signal threaded from the
originating intent down through every step, so a user's "never mind", an
application shutdown, or a peer's removal kills the in-flight attempt
promptly instead of leaking it. Life is supervised — keepalives with a
bounded grace period, because the network will silently drop the other
end and nothing at the socket layer will tell you. Death is deliberate —
every path out of the state machine releases the session, and no state
exists that is terminal in name but still holding buffers, tasks, or
sockets ([creation-names-reaper](../_laws.md#creation-names-reaper)).
Two peers dialing each other simultaneously is not an edge case, it is
what "both ends are equals" means — the design needs a deterministic
tie-break, not a shrug that leaves two half-used sessions. The
[connection-lifecycle](techniques/connection-lifecycle.md) technique
owns the state machine.

## Exposure is a per-peer allowlist, never an implication

Connectivity is not authorization. Pairing is not authorization either —
it authenticates *who the peer is*, not *what it may see*. The
authorization artifact is an explicit, per-peer declaration: which
categories of data this peer may access, at what level, enumerated as an
allowlist so anything new added next quarter defaults to *not exposed*.
And the declaration must be enforced at the one door where responses are
actually built — not in the UI that renders sharing toggles, not in the
peer's own request for what it wants
([gate-sees-target](../_laws.md#gate-sees-target),
[one-validation-door](../_laws.md#one-validation-door)). Grants can
carry an expiry, and expired grants are swept by a running reaper, not
merely skipped when someone happens to look. And where a grant's
precondition does not exist yet — an access tier that requires a
verification the system cannot yet perform — the honest posture is fail
closed: the resource is simply absent from what any peer sees, rather
than served on the strength of a promise. Revocation is part of the
same contract: cutting a peer's access takes effect at the next
request, and unpairing tears down live sessions rather than letting an
open connection outlive the trust that opened it. Secrets are not a
level on this ladder — credentials never cross to a peer at all; they
live behind their own custody boundary
([credential vault](../credential-vault/credential-vault.md)). The
[exposure-controls](techniques/exposure-controls.md) technique owns the
door.

## Manifests negotiate before data moves

Two peers that can talk must next agree on *what to talk about* — and the
answer is negotiated, not assumed. Each side offers a **manifest**: the
protocol capabilities it supports, and a summary of the content it is
willing to expose (already filtered through the exposure allowlist —
the manifest is itself a disclosure). The sides diff manifests to
compute a plan — what one has that the other lacks, at what versions —
and only the delta moves. This is the handshake layer; the durable
reconciliation it scopes — cursors, tombstones, conflict policy — is the
[sync & replication](../sync-replication/sync-replication.md) subject's
machinery, consumed here rather than reinvented. A manifest is also a
*claim*, offered by hardware you do not control: received data is
verified against it, and a mismatch is a protocol failure, not a shrug.
The [manifest-negotiation](techniques/manifest-negotiation.md) technique
owns the exchange.

## Offline is the normal case

A server-based system may treat disconnection as an incident; a peer
system that does so is broken by design. Laptops sleep, phones roam,
interfaces switch, and at any given moment most of a device's known
peers are absent — that is the steady state, not the failure state.
Absence therefore downgrades a peer's status, never erases the peer;
reconnection is a policy (backoff with jitter, accelerated by
re-sighting the peer in discovery) rather than a hot loop
([retry & backoff](../retry-backoff/retry-backoff.md)); identity
survives address changes so "same peer, new address" reconnects instead
of duplicating ([identity-survives-reuse](../_laws.md#identity-survives-reuse));
and work destined for an absent peer waits durably instead of queueing
unboundedly in memory — with the moment a link comes back up treated as
the recovery trigger: each side asks the other to replay what it
missed, rather than waiting for a timer to notice. Asymmetric
visibility — A hears B, B cannot hear A — is ordinary, so either side
must be able to initiate. The
[resilience-and-reconnection](techniques/resilience-and-reconnection.md)
technique owns the policy.

## The techniques

- [discovery-advertisement](techniques/discovery-advertisement.md) —
  minimized broadcast contents, discoverability as consent, stable
  opaque identity, presence protocol hygiene, hostile-input parsing.
- [peer-state-honesty](techniques/peer-state-honesty.md) — the
  discovered / reachable / connected / stale vocabulary, evidence and
  freshness per state, "no peers" vs "discovery broken".
- [connection-lifecycle](techniques/connection-lifecycle.md) — bounded
  establishment, cancellation threading, simultaneous-dial tie-breaks,
  keepalive supervision, teardown with no half-open residue.
- [exposure-controls](techniques/exposure-controls.md) — per-peer
  allowlists with access levels, one enforcement door at the serving
  edge, revocation semantics, the no-secrets rule.
- [manifest-negotiation](techniques/manifest-negotiation.md) —
  capability and content manifests, version negotiation, diff-driven
  transfer plans, manifests as claims to verify.
- [resilience-and-reconnection](techniques/resilience-and-reconnection.md)
  — absence as steady state, reconnection policy, address volatility,
  interface transitions, asymmetric reachability, honest degradation.
