---
layer: technique
subject: device-pairing
technique: pairing-ceremony
status: forged
laws: [one-validation-door, identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# The pairing ceremony

The ceremony is the protocol between "a stranger asked" and "a credential
exists". Its output is the single fact every later trust decision will
re-derive, so its structure is the security architecture — everything
downstream merely reads what it wrote.

## The pending record: a question, not a grant

A pairing request creates a **pending record** and nothing else. The record
is keyed by a **requester-supplied nonce** with an enforced entropy floor
(a short nonce is refused at registration — the nonce is the claim ticket,
and a guessable ticket lets a bystander poll for someone else's credential).
It carries the requester's claimed display identity, its *asserted* origin
or address, the capabilities it requests, and a creation timestamp. Every
field is untrusted; the record's only power is to appear on the approval
surface.

Three disciplines keep the pending store safe, since it is writable by
strangers:

- **Bounded**: a hard cap on concurrent pending records, so the
  unauthenticated entry point cannot balloon memory or bury the approval
  surface in spam. The cap refuses *new* nonces, never evicts live ones.
- **Expiring**: each record carries a short time-to-live — minutes, not
  hours — pruned on every store access. A pairing request is a conversation
  between a person and two screens; if the person walked away, the question
  expires ([creation-names-reaper](../../_laws.md#creation-names-reaper):
  the pending record names its reaper at creation).
- **Resolution-stable**: once a record resolves (approved or rejected), a
  duplicate registration under the same nonce must **not** reset it to
  pending. Benign double-submits are common — a re-sent deep link, a
  retried request — and a reset would discard an already-minted, unclaimed
  credential and hang the requester's claim poll forever. The nonce is the
  record's identity across retries
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)):
  re-registration of a resolved nonce returns the existing view, mutating
  nothing.

Multiple entry doors — a deep link the operating system routes to the
application, an unauthenticated local endpoint the requester posts to, a
scanned code — may all *register* the question, and should all converge on
**one pending store** with one registration function
([one-validation-door](../../_laws.md#one-validation-door)): the nonce
floor, the cap, the TTL, and the resolution-stability rule are enforced
once, not once per door. A door that bypasses the shared registrar is a
second writer with weaker validation — the exact defect the whole subject
warns about.

**The asserted identity must come from the channel, not the payload.** When
the request arrives over a transport that stamps the sender's origin (a
browser's origin header, a socket's peer address), the pending record binds
to the *stamped* value, never a value in the request body — so a page can
only ever pair itself, and a device can only ever pair its own address
class. A body-supplied origin is an invitation to pair someone else's
identity and intercept their credential.

## The mint gate: a person, in the application's own chrome

Nothing becomes a credential until a human approves the pending record on a
surface the application itself draws. The requester cannot render, pre-fill,
focus, or click that surface. Structurally this is the consent-gate pattern
(the general machinery lives with the hitl-approval subject); what pairing
adds is the content the human must actually see:

- **who** is asking — the claimed display name *and* the channel-stamped
  identity, both rendered fully, because a truncated origin is how
  look-alike origins pass review;
- **transport honesty** — a visible warning when the requesting identity
  arrived over an insecure transport; the human can still approve, but the
  downgrade is never silent;
- **what** is being asked — every requested capability, individually
  presented;
- **for how long** — a lifetime choice with a bounded default, never
  "forever" as the path of least resistance.

The surface must support **narrowing**: capabilities are individually
deselectable and the granted set may be a strict subset of the requested
set. A yes/no-only gate teaches requesters to ask for everything and
teaches approvers to stop reading. The grant that gets minted records what
the *human* left checked, not what the requester asked.

And the approval must also survive a **missed signal**: the gate's host
queries the pending store on mount rather than relying only on a
notification event, so a request that arrived before the surface existed
still gets asked. An approval gate that can silently never appear is a
refusal spelled as nothing — the requester polls forever and the human
never knew.

## Friction is asymmetric, by design

The trust-granting control is the most dangerous affordance in the
application, and its friction must exceed the declining control's:

- an **arm delay** — the approve control refuses input for a beat after the
  surface appears, so a double-tap or a click racing the surface's
  appearance cannot grant;
- the decline path is always instant and always available;
- where the ceremony includes a **human-comparable code** (two screens
  showing digits that must match), the comparison is a control only if the
  protocol cannot complete without it having happened. A code rendered next
  to a bare, immediately-clickable confirm button is decoration: the human
  reaches the button before reading the number. Force the interaction —
  type the code, or arm the confirm behind a dwell — or account the code as
  UX, not security.

Audit the asymmetry explicitly: if unpairing a trusted device sits behind a
two-step confirmation while admitting a new one is a single bare click, the
priorities are inverted — an accidental revocation costs a re-pairing; an
accidental approval costs the machine.

## Disclosure ordering: nothing protected leaves before the yes

The opening frames of a pairing exchange travel to a party no one has
approved yet. Anything of value placed in them has already leaked when the
human declines — declining does not take it back. So: identifiers, key
material, shared-group anchors, capability descriptions of the local system
— everything the ceremony exists to protect — flows only *after* the
approval resolves, and ideally only through the claim channel the next
technique defines. Design the message order so that the pre-approval
direction carries questions and the post-approval direction carries
secrets, never the reverse. The cheapest audit of a ceremony is to read its
first message and ask "what did a rejected stranger just learn?" — the
correct answer is: a nonce they minted themselves, and nothing else.

## Resolution states are explicit and terminal

A pending record resolves to exactly one of: approved (credential minted
and stashed for claim), rejected (the requester's poll receives a definite
refusal), or expired (pruned; the requester's poll receives
unknown-or-expired). Each is distinguishable to the *requester* at the
coarseness the requester deserves — pending / approved / no — while the
full story (who approved, what was narrowed, when it expired) lands in the
decision ledger on the granting side. Rejected and expired never
transition back to pending; a requester that wants another chance starts a
new ceremony with a new nonce.
