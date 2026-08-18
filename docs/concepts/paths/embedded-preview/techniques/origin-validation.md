---
layer: technique
subject: embedded-preview
technique: origin-validation
status: forged
laws: [gate-sees-target, one-validation-door]
shared_with: []
---

# Origin validation

The frame message channel is a public mailbox. Any document in the frame
tree — the guest you loaded, the page it redirected to, a nested frame the
guest embedded, an advertisement in a page the user wandered to — can post
messages, and the host's listener receives all of them. Symmetrically, a
message the host posts is delivered to whatever document currently
occupies the frame, which is not necessarily the document the host thinks
is there. Origin validation is the discipline that makes both directions
addressed mail: **verify where every inbound message came from; declare
where every outbound message may go.**

## Why shape-matching is an injection door

The lazy dispatcher checks the message's shape: "it has our protocol
marker and a kind we recognize — it's ours." But the envelope format is
not a secret; it is visible to anyone who reads the injected agent's code,
which ships to the guest — and the guest is arbitrary, often
model-generated, code. A dispatcher keyed on shape lets any document that
learns the format drive the host's half of the bridge. The host's half is
the privileged half: it navigates the preview, reads project files to
answer requests, forwards selected content into model prompts, triggers
rebuilds. Shape-matching hands those verbs to the least trusted code in
the entire product. The origin check is therefore not hygiene; it is the
authentication layer of the bridge, and there is no other one.

## Inbound: one door, exact match, current truth

- **One dispatch door.** Exactly one listener receives frame messages and
  performs the origin check before any parsing or dispatch; every handler
  lives behind it
  ([one-validation-door](../../_laws.md#one-validation-door)). Scattered
  ad-hoc listeners are scattered opportunities to forget the check — and
  the one that forgets is the one that gets probed.
- **Exact origin equality** against the origin the host is *currently*
  hosting — scheme, host, and port, all three. Suffix matching,
  substring matching, and "any local address" are each a known bypass
  class. Port matters specifically because in this subject the neighbors
  on adjacent ports are *other projects' dev servers*, spawned by the same
  registry — the closest thing this subject has to a hostile sibling.
- **The expected origin is state, not configuration.** It is minted when
  the guest's server is registered, carried alongside the server's
  registry entry, and rebound when the server restarts on a new port or
  the preview switches projects. A hard-coded allowlist passes exactly
  when it has drifted from the running truth — the gate must see its
  target ([gate-sees-target](../../_laws.md#gate-sees-target)).
- **Rejected messages are counted, not just dropped.** A trickle of
  wrong-origin messages is ambient noise; a burst is either a bug (the
  origin rebind lagged a server restart — see below) or a probe. Both are
  worth seeing, and a silent drop shows neither.

## Outbound: never wildcard

Every message the host posts declares the exact target origin it is valid
for; the platform then refuses delivery if the frame has meanwhile
navigated elsewhere. The wildcard target is the symmetric hole: host
messages can carry project content, file paths, selected source spans —
things that must not leak to an arbitrary document that a redirect or a
crash page swapped into the frame. The rule is absolute because the cost
of the exception is silent: a wildcarded send *works* in every test and
leaks only when something already went wrong.

The guest's agent applies the same two rules in miniature: it validates
that inbound commands come from its embedding host's origin, and it
addresses its reports to that origin. The agent's copy of the expected
origin is injected as build-time or boot-time configuration — the guest cannot
be allowed to *ask* the host who the host is over the same channel it is
trying to authenticate; that is a bootstrap circle with a hole in it.

## The rebind moment

The vulnerable window in real systems is not steady state — it is the
moment the expected origin *changes*: a dev server crashed and was
respawned on the next free port; the user switched the preview to another
project; a checkpoint restore pointed the frame at the same project on the
same port but reloaded the document. The discipline for the window:

- rebind the expected origin **before** the frame is pointed at the new
  target, so there is no interval where messages from the new origin are
  rejected (which surfaces as "preview loaded but the bridge is dead");
- drain the protocol layer's pending table at the same moment (its
  lifecycle rule — [cross-frame-protocol](cross-frame-protocol.md)), so
  no request awaited from the old origin can be settled by the new one;
- treat *both* directions atomically: expected-inbound origin and
  outbound target origin are one value, stored once, updated together. Two
  copies of the origin is the vocabulary-drift race in security clothing.

## What origin validation does not buy

A valid origin authenticates the *document*: this message really came from
the guest the host is hosting. It says nothing about the *content*,
because the guest is untrusted by construction — the honest guest runs
model-generated code, and the content of its reports (element text, state
dumps, console lines) can carry adversarial instructions. Content
discipline is the injection posture owned by
[prompt-safety](../../prompt-safety/prompt-safety.md); this technique's
job ends at guaranteeing that at least the untrusted content is arriving
from the untrusted party it is attributed to.
