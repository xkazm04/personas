---
layer: technique
subject: outbound-notifications
technique: channel-adapter-traits
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, failure-not-empty-success]
shared_with: []
---

# Channel adapter traits

The delivery pipeline — match the event, render the payload, attempt the
send, record the outcome, feed the health ledger — is the same for every
channel class. What differs per class is small and enumerable: the body
shape the target accepts, the authentication ritual, the endpoint
resolution, maybe a size cap. The technique is to make that difference a
**pluggable implementation behind one extension trait**, so the pipeline is
written once and channel classes are added at exactly one seam.

## The trait: one delivery, one structured outcome

The contract is narrow on purpose: given the subscription, the event, and
the pre-built rendering context, *process this one delivery and return a
structured outcome* — success or failure, transport status if any, an error
string if any, a response excerpt bounded to a sane length. Two properties
are non-negotiable:

- **The outcome is data, not an exception.** A failed delivery is a normal
  return value the caller feeds into watermark decisions and health
  accounting. An adapter that throws turns one sink's bad day into control
  flow for the whole tick.
- **Bookkeeping is part of the contract.** Every implementation records its
  delivery result — success *and* failure — into the subscription's
  standing ledger. If recording is left to the caller, the first adapter
  added by someone who didn't read the caller forgets it, and that channel
  becomes invisible to health tracking exactly when it starts failing
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success):
  an unrecorded failure reads as a quiet success).

The dispatcher's side of the seam is a single selection function:
subscription in, boxed implementation out. Today it may have one arm;
its existence is still load-bearing, because it is the *named place* where
the next processor kind — an audit sink, a digest builder, a push relay —
gets added without the loop learning anything new.

## The channel vocabulary is closed, and defined once

Channel classes form a closed vocabulary — a handful of names, stored as
strings in the subscription record, parsed to a typed form for dispatch.
The trap is that this vocabulary wants to exist in several places at once:
the validation door that admits new subscriptions, the parser that types
stored rows, the adapter selection, the UI's channel picker. **One
authoritative definition, everything else derived**
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Two hand-maintained copies — an enum here, a match of string literals in
the validator there — will drift on the day someone adds a channel class,
and the drift is cruel: the new class passes validation but dispatches as
something else, or dispatches correctly but cannot be created.

Parsing the stored form deserves an explicit forward-compatibility
decision, made once and written down. The durable answer for *dispatch* is
**unknown string → the most generic class**, infallibly: rows written by a
newer version, or corrupted, still deliver *something* rather than wedging
the loop. The durable answer for *admission* is the opposite — the
validation door rejects unknown classes loudly, because a user creating a
subscription deserves an error, not a silent downgrade. Same vocabulary,
two postures, both derived from the one definition
([one-validation-door](../../_laws.md#one-validation-door): lenient read,
strict write).

## Endpoint resolution is layered, and the layers are ordered

An adapter needs a destination. The robust shape is an explicit precedence
written into one resolver: an inline endpoint on the subscription wins; a
reference into the credential vault is the fallback; known field-name
aliases inside the credential are tolerated in a declared order; and
exhaustion is a *validation error naming what was missing*, not a silent
skip. Endpoint URLs are secrets in most chat systems — the URL **is** the
authorization — so the credential-vault path is the norm and the inline
path is the convenience, and the resolver is also where secret-handling
discipline concentrates: one place to audit, one place to redact from logs.

## One transport door

All adapters share one outbound HTTP door: one client, configured once,
with a per-delivery timeout measured in single-digit seconds, an explicit
user-agent identifying the sender, and egress protections (private-address
and redirect discipline) applied at the client, not per adapter. A hung
endpoint must cost its own delivery slot, never the tick. Adapters that
construct their own clients scatter the timeout policy and — worse — the
egress policy, which is a security control and therefore must have
enumerable bypass sites: ideally zero.

## What does not go in an adapter

The adapter renders *its class's* body shape from an already-rendered
message; it does not decide message content, evaluate subscriptions, or
make attention decisions. The test: an adapter should be writable by
someone who has read only the trait and the target's API docs. Every piece
of pipeline knowledge an adapter needs is a leak from the dispatcher that
the next adapter will need too — move it up.

## The failure mode this technique kills

Without the seam, channel dispatch grows as a switch statement somewhere,
then a second switch in the test-delivery path, then a third in a relay
that predates the other two. Each new channel class must now be added to
every copy; each copy has its own timeout, its own error posture, its own
bookkeeping gaps. The measured end state in one real system: two parallel
outbound stacks serving the same five channel classes, with two body-shape
implementations per class and health ledgers that see only one stack. The
seam is cheap on day one and unbuildable on day five hundred — the copies
have diverged too far to merge without behavior change.
