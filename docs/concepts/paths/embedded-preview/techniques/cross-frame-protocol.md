---
layer: technique
subject: embedded-preview
technique: cross-frame-protocol
status: forged
laws: [identity-survives-reuse, failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Cross-frame protocol

The message channel between a host and an embedded frame is a datagram
service wearing a friendly API: one-way delivery, no replies, no
acknowledgment, no ordering relative to anything else, and a payload that
arrives as whatever the other side chose to send. Everything a function
call gives you — pairing of ask and answer, a return value, an exception
path, a completion time — is absent, and must be built. The technique is
that construction: a small, boring, request/response protocol, built once,
used for every exchange.

## Fire-and-forget is banned, and the ban is the technique

The tempting shape — host posts `select-element`, guest eventually posts
`element-selected`, host listens for the latter — works in the demo and
decays in production along three predictable seams:

- **misattribution**: two requests of the same kind in flight, one reply;
  which question did it answer? Under fire-and-forget, whichever handler
  runs first claims it.
- **staleness**: the user clicked elsewhere, the question changed, and the
  old answer arrives late and is *applied* — the surface jumps back to a
  selection nobody holds.
- **silent hangs**: the guest dropped the message (reloading, crashed,
  agent absent) and nothing anywhere knows a reply is owed. The awaiting
  surface waits forever, and the bug report says "it sometimes stops
  working".

All three are identity failures, and the fix is identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): mint a
correlation id per request at send time, carry it in the envelope, echo it
in the reply, and let the id — never message kind, never arrival order —
decide which pending request an answer settles.

## The envelope

Every message crossing the frame, both directions, wears the same envelope:

- **a protocol marker** — a namespaced field identifying "this is ours,
  version N". The marker is a *routing* aid, not an authentication
  mechanism; authentication is origin checking and belongs to
  [origin-validation](origin-validation.md).
- **a kind** — the verb or event name, drawn from one enumerated
  vocabulary that both sides compile against or import from one place
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary));
  a string that only one side knows is a message that will be silently
  ignored, and silently ignored is the failure mode this technique exists
  to eliminate.
- **a correlation id** on every request and every reply. Unsolicited
  events (the guest announcing an error, a navigation, a console line) may
  omit it — they answer no question — but anything that *is* an answer
  carries the question's id.
- **a payload** that is data, never code, and that the receiving side
  validates structurally before use. The guest's payloads are additionally
  untrusted content (see the golden path's trust-boundary section).

## The pending table

The requesting side keeps one table of in-flight requests: id → resolver,
deadline, and enough context to describe the request in a failure message.
The discipline around the table is the protocol's real substance:

- **one settlement per id.** A reply settles its entry and removes it;
  a second reply with the same id, or a reply with no entry, is discarded
  and counted — it is either a duplicate, a stale answer to a question
  already timed out, or someone probing the bridge.
- **every entry has a deadline.** A request whose reply has not arrived by
  its timeout settles as a *timeout failure* — a distinct outcome the
  caller receives and can act on, not an exception swallowed in the
  bridge. Silence must be spelled differently from success
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)),
  because the dominant guest failure mode is not an error reply — it is no
  reply: the frame is reloading, the agent never booted, the guest crashed.
- **the table drains on frame lifecycle events.** When the frame reloads
  or navigates, every pending request is settled as failed immediately —
  the old document that owed the answers is gone; waiting out the timeout
  just converts a known failure into a slow one.
- **timeouts are per-verb, not global.** "Locate this element" is
  milliseconds; "wait for the guest to finish rendering" is seconds. One
  global timeout is always wrong at one end.

## The handshake

Neither side may assume the other is present or compatible. The guest's
agent announces itself when it boots (an unsolicited *ready* event carrying
its protocol version and capabilities); the host, when it needs the agent
before hearing that announcement, probes with a *ping* request that follows
the same rules as everything else — correlation id, short timeout, timeout
means absent. Version mismatch is declared, not muddled through: a host
that speaks v2 to a v1 agent gets one honest "incompatible" outcome, and
the surface can say so, instead of a mixture of working and unanswered
verbs that reads as flakiness.

Readiness is *per document*, not per frame: every navigation or reload in
the frame boots a new guest, and the handshake state machine resets with
it. A bridge that remembers "the agent is present" across a reload holds a
gate open onto a target that no longer exists
([gate-sees-target](../../_laws.md#gate-sees-target) in miniature).

## Events are a channel, not an exception to the rules

Unsolicited guest→host events (errors, console output, navigation
announcements, ready) share the envelope and the vocabulary but skip the
pending table. Two rules keep them from becoming the back door that
fire-and-forget re-enters through: they carry no reply expectation — a
host that must *answer* an event has discovered a request flowing the
wrong way and should model it as one, with the guest keeping its own
pending table — and they are rate-shaped at the source. A guest in a
render loop can emit thousands of error events per second; the agent
batches or throttles at the guest side, because the frame channel and the
host's dispatcher are shared infrastructure, and one sick guest must not
be able to freeze the surface that exists to debug it.
