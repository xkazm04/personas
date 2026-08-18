---
layer: technique
subject: p2p-networking
technique: manifest-negotiation
status: forged
laws: [one-authority-per-vocabulary, count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Manifest negotiation

Two authenticated peers with a live session still know nothing about
each other's contents, versions, or abilities. Sending data before
establishing those is guesswork wearing a protocol. The technique:
**each side offers a manifest — what it can do and what it is willing
to show — the sides diff, and only the agreed delta moves.**

## Two manifests, two questions

- **The capability manifest** answers *how can we talk*: protocol
  version, supported features, supported content encodings. It is
  exchanged first, immediately after the handshake, because every
  subsequent message's interpretation depends on it.
- **The content manifest** answers *what could we exchange*: the
  categories the peer exposes, each with a compact summary — a version
  mark, a content digest, a count. It is assembled **after the exposure
  allowlist is applied**, never before: the manifest is itself a
  disclosure, and listing a category to a peer not granted it leaks
  the category's existence and invites requests the door will have to
  refuse. Order of operations is the security property here — filter,
  then summarize, then send.

## Capabilities negotiate down, never assume up

The two sides may run different releases for months — peer software on
personal devices upgrades when each machine happens to update, and the
protocol must serve the laggard. The discipline is a three-part
contract:

- **One authority for the capability vocabulary.** Feature names and
  version semantics are defined in exactly one place both codebases
  build from — not one list in the dialer and a near-copy in the
  listener, which drift the release someone adds a feature to one
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
- **Intersection, not assertion.** The operative feature set is what
  *both* manifests contain; either side using a feature outside the
  intersection is a protocol bug, however new its own release is.
- **Unknown means ignore, not abort.** A capability name the receiver
  does not recognize is a future feature, skipped without ceremony.
  Aborting on the unknown makes every upgrade a network-wide
  flag-day; version negotiation exists precisely so releases can
  interleave.

Incompatibility — no common protocol version at all — is a first-class,
early, user-visible outcome ("this device runs an older version"), not
a handshake that hangs or a stream of parse errors.

## The diff is the transfer plan

With manifests exchanged, each side computes what it lacks: categories
whose digest or version mark differs, entries the other side has that
it does not. That diff — not the request stream, not a full dump — is
the plan, and it buys the property that makes peer exchange affordable:
**cost proportional to divergence, not to corpus size.** Two devices
that agree entirely exchange manifests and stop. The actual movement of
records the plan calls for — cursors, tombstones, conflict policy — is
the [sync & replication](../../sync-replication/sync-replication.md)
subject's machinery; this technique ends where the plan is handed to
it. The boundary matters in both directions: negotiation without sync's
durability re-derives everything each session, and sync without
negotiation moves data the far side never agreed to receive.

## A manifest is a claim by a machine you do not control

Verify it where it can be verified, bound it where it cannot:

- **Verify received content against the manifest that advertised it.**
  Digests and counts in a manifest are promises; data that arrives not
  matching them is a protocol failure — surfaced, logged, and
  terminated per policy — never silently accepted. A count in a
  manifest is only usable because it names what it counts and how the
  receiver can check it
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)).
- **Bound what you accept.** Manifest size, category count, entry
  counts per category — all capped at parse time. An unbounded
  manifest is a memory faucet handed to the network; the cap is a
  protocol constant both sides know, and exceeding it is a rejection,
  not a best effort. And bound *time* the same way: one timeout wraps
  the whole request–response exchange, not just the connection — a
  stalled peer that accepts the stream and never answers is otherwise
  an exchange that hangs forever while reporting nothing.
- **Paginate the large.** A summary that would itself be huge (many
  categories, deep listings) pages like any other listing; a manifest
  designed only for the small library breaks at the first power user.

## Renegotiate on change, not on schedule

Manifests age the moment content changes. The honest cadence is
event-driven: local changes mark the manifest dirty and the next
exchange re-offers it; a peer's re-offer supersedes its predecessor
entirely (manifests replace, they do not patch — partial manifest
updates recreate the diff problem one level down with none of the
tooling), and the replacement is applied **transactionally** — a crash
between clearing the old manifest and landing the new one must not
leave a peer's catalog half-empty and plausible. A content digest over
the received manifest makes the supersede cheap: an unchanged re-offer
matches the stored digest and skips the write entirely, so a frequent
cadence costs almost nothing when nothing changed. Two hygiene rules
around that cache: it is keyed per peer, and it is reaped when the
peer departs — a digest cache that only ever grows is a leak indexed
by every transient peer the process ever met
([creation-names-reaper](../../_laws.md#creation-names-reaper)).
Between exchanges, both sides treat the last manifest as a snapshot
with a timestamp, not a live view — the same honesty the peer list
owes its states.
