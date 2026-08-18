---
layer: technique
subject: p2p-networking
technique: discovery-advertisement
status: forged
laws: [identity-survives-reuse, failure-not-empty-success]
shared_with: []
---

# Discovery advertisement

Local-network discovery is a broadcast medium: a device announces "I am
here, I speak this protocol, reach me at this endpoint", and every
listener on the segment — peer or stranger — receives it. The technique
is the discipline of designing that announcement as what it actually is:
**an unauthenticated publication to an audience you did not choose.**

## The advertisement is a minimized surface

Decide field by field what the announcement carries, and default every
candidate field to *out*. The defensible core:

- **A stable opaque identifier** — the peer's identity, minted once at
  first run, random, meaning nothing to anyone who has not paired with
  it. Never a username, hostname, account identifier, or serial number;
  those turn every packet capture into an inventory of who owns what.
- **A display name** — the human label shown in other devices' peer
  lists. It exists for exactly one consumer (a person choosing what to
  pair with), so it is user-editable, and the user knows it is
  broadcast. The first-run default is derived from the opaque
  identifier, not from the machine's hostname — a hostname default
  leaks the owner's name to the whole network without anyone deciding
  that; an opaque default leaks nothing and renaming becomes the
  deliberate act it should be.
- **A protocol version** — so an incompatible peer can be *shown* as
  incompatible instead of discovered, dialed, and failed mysteriously
  three layers later. Compatibility surfaces at the cheapest possible
  layer: the listing.
- **An endpoint** — address and port for the transport to dial.

Everything else stays out. Capability inventories, content summaries,
counts, application state — all of that is post-pairing conversation,
gated by exposure controls, delivered over an authenticated channel.
Anything in the advertisement is readable by devices you will never
trust; the test for each field is "am I content publishing this to the
most hostile machine on the network?"

## Discoverability is consent, enforced at the responder

Being announced to the network is something done *on the user's behalf*,
so it is a visible setting, not an ambient default buried in a protocol
layer. And the setting must control the mechanism, not the presentation:
"off" stops the responder from answering and the announcer from
announcing — a device that hides discovery results in its own UI while
still answering probes has privatized nothing. The same discipline
applies at shutdown: a clean exit says goodbye (an explicit leave
announcement where the protocol supports one) so peers learn of the
departure in seconds rather than discovering it by timeout.

## Identity is the identifier, never the name or the address

Three things about a peer can change without the peer changing: its
display name (the user renamed it), its address (it moved networks, its
lease rolled), and its port (it restarted). The stable identifier is
therefore the **only** key — the peer record, the pairing state, the
exposure grants all hang off it, and a re-discovery at a new address
updates the existing record rather than minting a phantom second peer
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
The display name is a label on the record; treating it as a key makes
"rename my laptop" indistinguishable from "a new device appeared".

## Presence protocol hygiene

Announcements age. The protocol needs a re-announce cadence and a
time-to-live so listeners can distinguish "still here, said so
recently" from "last heard from twenty minutes ago" — and the listener
side owes its records an expiry sweep that downgrades peers it has
stopped hearing. Two asymmetries to respect:

- **Absence of announcements is weak evidence.** Multicast is the least
  reliable traffic on most networks — dropped by access points,
  filtered by switches, suppressed by power management. A peer going
  quiet means *the channel* went quiet; only failed direct probes make
  the stronger claim (the peer-state vocabulary owns this distinction).
- **Presence of announcements is weak evidence too.** Hearing a peer
  proves multicast passes in one direction, nothing more. Reachability
  is established by the transport, not the listing.

## Everything received is hostile input

The discovery listener is an open network service parsing packets from
anyone on the segment. Every field is attacker-controlled: names carry
control characters and absurd lengths, identifiers collide on purpose,
endpoints point at third parties (making your dialer a port-scanning
proxy), and announcement floods try to balloon the peer table. So:
reject identifiers that fail their structural test (a fixed decoded
length, a fixed alphabet — a malformed identifier is dropped, not
stored), cap and sanitize names, validate every endpoint as a
well-formed address and cap how many you keep per peer, bound the table
with eviction, and treat a claimed identifier as a *claim* — a device
announcing an identifier you have paired with is not thereby the paired
device; only the authenticated handshake (using keys from the pairing
ceremony — device-pairing's subject) proves it. Discovery nominates;
the handshake elects.

Two disciplines the defensive layer itself must honor. **The sanitizer
must survive its own inputs**: a name truncated at a byte offset
crashes on the multibyte character that straddles it, and because
sanitization runs inside the listener loop, that crash kills discovery
for everyone — truncate on character boundaries, and test the sanitizer
against multibyte and adversarial input as seriously as any parser.
And **the validator can silently blind you**: an address your own
serializer renders ambiguously (the classic case is an address family
whose textual form needs bracketing to be parseable) fails the
receiver's validation and is dropped without an error — the symptom is
"peers on that address family never appear", diagnosed months later.
Canonical formatting on the way out is part of the discovery contract,
because the drop on the way in is silent by design.

## Bursts are batched, not applied one by one

A busy segment delivers discovery events in floods — every wake, every
re-announce cadence, every device joining produces a burst, and the
same peer resolves repeatedly within seconds. Applying each event to
the durable peer table individually turns the listener into a write
amplifier. The shape that holds: validate events as they arrive, buffer
the survivors keyed by peer identity (later sightings of the same peer
overwrite earlier ones — only the freshest matters), and flush the
batch to storage on a short cadence in one transaction. The buffer is
also flushed on shutdown and on channel close, so no validated sighting
is lost to the batching that exists only as an economy.

And the listener is a service that can fail. A discovery subsystem that
could not bind its socket, join the multicast group, or start its
responder must surface that state — an empty peer list with a broken
listener behind it is a lie shaped like solitude
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
