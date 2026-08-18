---
layer: technique
subject: device-pairing
technique: revocation-and-expiry
status: forged
laws: [creation-names-reaper, gate-sees-target, deletion-is-not-repair]
shared_with: []
---

# Revocation & expiry

Trust established by a ceremony decays unless deliberately renewed, and can
be withdrawn faster than any expiry. This technique makes both real: every
grant names its end at creation, and revocation reaches not just the door
but the work already running behind it. The test of the whole subject is
executed here — a pairing system is judged not by how well it admits but by
what happens in the minute after the operator says *out*.

## Expiry at every layer

Each artifact the subject creates carries its reaper from birth
([creation-names-reaper](../../_laws.md#creation-names-reaper)):

- **pending requests** expire in minutes, pruned on every store access —
  an unanswered question does not wait overnight;
- **minted credentials** carry an absolute expiry chosen at approval,
  stamped by the granting side's clock, with a bounded default and no
  "forever" as the path of least resistance; the expiry check runs on
  every presentation, on the granting side;
- **claim stashes** — the plaintext waiting for its single retrieval —
  die with their pending record's TTL if never claimed;
- **liveness metadata** (last-seen timestamps, throttled to avoid a write
  per poll) exists so the operator's device list can surface the grants
  that *should* be reaped: a device unseen for months is a standing
  credential with no user, and the list is where a human notices.

An expiry ladder beats one long lifetime: short-lived pending,
medium-lived claim window, long-but-finite credential. Each rung bounds a
different theft window, and the sum is that no stolen artifact is useful
indefinitely.

## Revocation reaches the door…

The floor: a revoked credential fails its **next** presentation. This is
only real under one architectural condition — **the verifier consults the
trust registry per request**, or through a cache whose invalidation is
wired to the revocation path
([gate-sees-target](../../_laws.md#gate-sees-target): the admission gate
must see the registry the revocation actually wrote, not a snapshot from
before the operator acted). Two honest costs follow:

- per-request re-reads price the registry read into the hot path — for a
  pairing registry (tens of rows, polled surfaces) that price is trivial
  and correct to pay;
- any trust cache with a time-to-live is, precisely, a revocation delay
  of that length; if one exists, the revocation path must invalidate it
  explicitly, and a cache whose invalidation hook has no caller on the
  revoke path is a measured defect, not a style issue.

Revocation is a **flag, not a row deletion**. Marking revoked preserves
the grant's history for the ledger (who was trusted, when, by whom,
revoked when and why), keeps the device visible in the operator's list as
revoked rather than vanished, and prevents identifier reuse from
resurrecting stale references. Deleting the row is the tempting shortcut
that destroys the evidence and repairs nothing
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).

## …and then reaches the work

Failing the next request does not touch what the revoked peer already
started: an open connection stays open, a running task runs to its own
timeout, a queued command still executes. Each of those is a live channel
held by a principal the operator just declared hostile — and the moment an
operator reaches for revocation is precisely the moment something is
already running.

Enumerate, at design time, every asset a paired peer can hold *across*
requests, and give the revocation path a closer for each:

- **connections** — revocation closes the peer's open sessions, not just
  refuses new ones; the disconnect function existing one module away but
  uncalled from the revoke path is the canonical miss;
- **in-flight tasks** — long-running work started remotely is cancelled
  or, at minimum, its completion-side effects are re-gated on a live
  trust check;
- **queues** — commands accepted before revocation are purged or
  re-validated at execution time, not executed because they were already
  inside;
- **the remote client's own copy** — a well-built remote client
  self-heals by discarding its stored credential on the first
  authentication failure, so a revoked device does not sit retrying
  forever; design the refusal so the client can distinguish "revoked,
  stop" from "transient, retry".

Where full reach is not implemented, say so in the operator-facing copy.
"Revocation takes effect on the device's next request" is an honest
contract an operator can act on (also unplug the network); a revoke
button that silently leaves a 30-minute task running is a promise the
system does not keep.

## Caps keep the surface enumerable

A hard cap on simultaneously paired principals — single digits, refused
loudly at the ceremony, freed only by revocation — is not rate limiting;
it keeps the trust surface small enough for a human to *audit at a
glance*. Every grant fits on one screen, every unfamiliar row is
noticeable, and "who can reach this machine" has an answer shorter than a
page. A cap also forces the healthy habit: pairing device nine begins with
revoking a stale grant, which is exactly the review moment the list
exists for.

## Re-pairing, not rescue

There is no credential recovery. A lost device, a forgotten token, an
expired grant — every path back runs the **full ceremony again**: new
nonce, new human approval, new credential, and revocation of the old
grant as part of the flow. Any "refresh" or "extend" affordance that
inherits old trust into a new lifetime without a human in the loop is a
mint gate without the human — the exact door the whole subject exists to
close. The one acceptable shortcut is ergonomic, not cryptographic:
pre-filling the *name* and *scope suggestions* from the revoked grant, so
the human approves quickly — but approves.
