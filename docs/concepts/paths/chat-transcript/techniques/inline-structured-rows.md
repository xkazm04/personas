---
layer: technique
subject: chat-transcript
technique: inline-structured-rows
status: forged
laws:
  - one-authority-per-vocabulary
  - identity-survives-reuse
shared_with: []
evidence:
  - src/features/plugins/companion/ApprovalCard.tsx            # in-chat approval card; approve failure surfaced on the card (approved_failed), not as silent success
  - src/features/plugins/companion/InlineChatCard.tsx          # kind-dispatched card renderer with an explicit kind set (clamp policy per kind)
---

# Inline structured rows

A machine turn is rarely just prose. It calls tools, requests approval,
produces artifacts, hits errors, hands off to other agents. The transcript
renders these as **rows in the conversation** — typed, positioned where they
happened, interleaved with the prose that surrounds them — because they *are*
the conversation: the answer "I checked the logs and restarted the service"
is meaningless without the checking and the restarting being visible where
they occurred. Pulling them out to toasts, side panels, or modals detaches
cause from effect and turns the transcript into a partial account.

Where the structure *comes from* — how a machine channel is split from
display prose — is owned by structured-output's
[display-vs-machine-channels](../../structured-output/techniques/display-vs-machine-channels.md).
This technique starts where that one ends: a typed event exists; now it must
live in a document humans read.

## A closed taxonomy, one dispatcher, a loud fallback

Row kinds — prose, tool invocation, approval request, artifact, error,
handoff, system notice — form a **closed vocabulary with one authoritative
registry**, per
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary).
One dispatcher maps kind to renderer; every surface that renders transcript
rows goes through it. Two dispatchers (say, one for the live view and one for
history) is the classic drift pair: a kind added to one renders in the live
stream and vanishes on reload.

The fallback branch is part of the taxonomy: an event whose kind the
dispatcher does not recognize renders as a **visible generic row** — kind
label, timestamp, safe summary of payload — never as nothing. Silently
dropping unknown kinds means a version skew between producer and renderer
edits the conversation record, and nobody is told.

## Rows have identity and position

Each row carries its own identity (per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse)) and its
position within the turn's sequence. Both matter:

- Identity, because rows update — a tool invocation row starts as "running"
  and later carries its result; the update must land on the same row, not
  append a second one.
- Position, because interleaving is meaning — prose, then a tool call, then
  prose reacting to its result is a narrative; the same three rows sorted
  "prose first, tools after" is a different (false) narrative.

## Interactive rows: live while pending, a record afterward

Some rows solicit action — approvals above all. Their lifecycle is the
subtlest part of this technique:

- **While pending**, the row is a live control inside the transcript:
  answerable in place, keyboard-reachable, clearly consequence-labeled. What
  approving *means* — scope, expiry, the contract with the paused work — is
  owned by [hitl-approval](../../hitl-approval/hitl-approval.md); the
  transcript hosts the card.
- **Once resolved**, the same row, in the same position, becomes the record
  of the decision: what was asked, what was chosen, by whom, when. It does
  not disappear, and it does not remain a live control. A resolved card that
  still looks pressable invites double-resolution; a card that vanishes
  leaves a hole in the account exactly where an auditor will look.
- **Resolution state is derived from the authority, not from render history.**
  A card rendered from a stale snapshot — after a reload, in a second window,
  after the underlying request expired — must consult the authoritative state
  before accepting input. The failure mode is concrete: the user approves a
  card whose request timed out an hour ago, the surface says "approved", and
  nothing was approved. If the authority says the moment has passed, the card
  renders that fact and refuses the interaction, loudly.

## Density: cards must not bury the conversation

A turn that invoked a dozen tools can drown its own prose in cards. The
transcript's reading flow wins: runs of homogeneous rows collapse into a
grouped row ("n tool calls", expandable), fully detailed on demand — the same
posture as progress narration (see
[progress-narration](progress-narration.md)), applied to structured rows. The
collapse is presentation only; every underlying row keeps its identity and is
recoverable by expansion. Interactive rows are exempt while pending: a
pending approval is never collapsed into a group summary, because a control
the user must notice cannot be behind a disclosure.
