---
layer: technique
subject: p2p-networking
technique: exposure-controls
status: forged
laws: [one-validation-door, gate-sees-target]
shared_with: []
---

# Exposure controls

Pairing answers *who is this device*; it deliberately does not answer
*what may it see*. The technique is keeping those questions separate in
code the way they are separate in fact: **a per-peer, allowlisted
declaration of what crosses, enforced at the single door where
responses are built.**

## Authorization is declared, never implied

Three implications all fail, and each is a real design that ships:

- **"It is connected, so serve it."** Connectivity proves a network
  path. A session that authenticated as *some* paired peer is still a
  specific peer with specific grants — or should be.
- **"It is paired, so it is trusted."** Pairing authenticates identity.
  A household contains devices with very different claims on the data —
  the owner's second machine and a family member's are both "paired".
- **"It asked, so it needs it."** The request is authored by the other
  machine; what it wants is input, not policy.

The declaration that replaces all three is a grant record per peer:
which categories of data this peer may access, at what level (none /
read / read-write, or whatever ladder the product needs), stored with
the peer's stable identity, editable by the user, and consulted at
request time. Two refinements earn their keep early. **Grants can
expire**: an exposure with a time bound is swept by a running reaper
when it lapses — an expiry honored only at read time leaves the grant
looking alive in every management surface that lists it. And **a grant
whose precondition does not exist fails closed**: if a level on the
ladder requires a verification the system cannot yet perform, resources
at that level are absent from every response until it can — served on
the strength of an unimplemented check is the leak the ladder existed
to prevent.

## Allowlist by construction

Enumerate what is shared, never what is withheld. The difference is
what happens to the category added next quarter: under an allowlist it
defaults to *not exposed* and someone must decide to share it; under a
denylist it defaults to *exposed* and someone must remember to hide it
— and the person adding a category is thinking about the feature, not
about the peer subsystem two modules away. The enumeration goes all
the way down: an exposure record names not just the resource but the
*fields* of it that cross, so a column added to the underlying entity
next quarter is not thereby published to the network. The strongest form is
structural: the type that serializes to a peer simply has no field for
what does not cross, so a leak is a compile-time impossibility rather
than a filter's good day. This is the same posture the sync boundary
takes with its outbound rows
([projection-security](../../sync-replication/techniques/projection-security.md));
a peer edge deserves it at least as much, because the far side is
another user's machine, not your own relay.

Secrets are not a rung on the access ladder. Credentials, tokens, and
key material never serialize toward a peer at any level — they live
behind their own custody boundary
([credential vault](../../credential-vault/credential-vault.md)), and
what crosses is at most a reference meaningless off the source device.

## One door, and the gate sees the bytes

Every response to a peer passes through one chokepoint that takes
(peer identity, requested category) and applies the grant — one
function to audit, one place a new endpoint cannot forget
([one-validation-door](../../_laws.md#one-validation-door)). The door
sits at the serving edge, where the response is materialized: filtering
in the UI that renders sharing toggles, or trusting the requesting
peer to ask only for what it may have, gates a proxy while the actual
bytes travel unexamined
([gate-sees-target](../../_laws.md#gate-sees-target)). The rule of
thumb that catches most violations: if you can point at a code path
where data reaches serialization without the grant being read on that
path, the door is decorative.

## Revocation is immediate and cascading

Grants are read at time of use — per request, not cached per session —
so tightening a grant takes effect on the very next request rather
than whenever the session happens to recycle. Full revocation
(unpairing) cascades: live sessions to that peer close, queued outbound
work for it is dropped or parked, and the grant record is gone, not
zeroed — an unpaired peer that re-pairs is a *new* trust decision and
starts from default-deny. The asymmetry to preserve: granting can
afford ceremony (a settings screen, a confirmation), revoking must not
— the user pulling access is often doing so under time pressure, and
the path must be short and total.

## Served data is an auditable event

What was served, to which peer, when, under which grant — recorded, at
least in aggregate. Not because peers are presumed hostile, but because
exposure questions arrive in the past tense ("did my roommate's device
ever see this?") and a system with no ledger can only answer with a
shrug. The record also closes the loop on the door itself: an audit
trail written *by the chokepoint* is evidence the chokepoint was on the
path, which is the property everything above depends on.
