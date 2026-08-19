---
layer: technique
subject: chat-transcript
technique: turn-model
status: forged
laws:
  - identity-survives-reuse
  - failure-not-empty-success
shared_with: []
evidence:
  - src/features/agents/components/ChatThread.tsx              # streamingMessageId: the streaming turn is a flagged list member with identity, one element through settlement
  - src/features/plugins/companion/chat/AthenaChatTranscript.tsx  # rows keyed by message id, not index
---

# The turn model

A transcript is a list of turns, and every rendering decision downstream —
keys, scroll anchoring, selection stability, metadata attachment, structured
rows — assumes the turn is a real entity: identified once, mutated through a
lifecycle, never impersonated by a lookalike. This technique is that entity's
contract.

## Identity: minted once, at creation

Every turn carries an identifier assigned when the turn comes into existence,
before any content exists, and unchanged for the turn's whole life — through
streaming, settlement, reload, and re-fetch. Per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse), the
identifier survives exactly the operations transcripts actually undergo:

- **Regeneration** — a new response to the same prompt is a *new* turn with a
  new identity, related to its predecessor, never a reuse of the old id with
  new content.
- **Late arrival and re-fetch** — the same turn arriving twice (optimistic
  local copy, then the authoritative echo) reconciles by id into one row, not
  two.
- **Reordering** — position is a rendering fact, not an identity fact; a turn
  keyed by index changes identity whenever history is windowed or an earlier
  row is inserted, and the renderer sees that as delete-and-recreate.

The optimistic case deserves naming because every chat has it: the user's own
turn is appended locally the instant they submit, before any authority has
acknowledged it. Mint the id locally, submit it *with* the content, and let
the authoritative record adopt it (or map to it, once, at acknowledgment).
The alternative — waiting for the round trip to render the user's own words —
makes the app feel deaf; the other alternative — rendering with a temporary
key and re-keying on acknowledgment — is the delete-and-recreate defect
wearing a network costume.

## Phases: one element, one lifecycle

A machine turn passes through a small closed set of phases:

| Phase | Meaning |
| --- | --- |
| **pending** | the turn exists; no content has arrived |
| **streaming** | content is arriving; the turn renders its live tail |
| **settled** | the turn is complete, with an outcome from a closed set |

The load-bearing rule: **these are states of one rendered element.** The turn
enters the transcript once, at pending, and the same element carries it to
settled. The anti-pattern — a dedicated "live bubble" rendered outside or at
the end of the list, replaced at completion by a "real message" appended to
the list — fails in a bundle: the swap discards text selection mid-read,
drops scroll anchoring at the exact frame the layout shifts, restarts
entrance animation on content the user already saw, and (when the swap races
the settled record's arrival) shows the same turn twice or zero times. Every
one of those is a symptom of two elements pretending to be one turn.

Settlement itself is a *narrowing*, not a replacement: the streamed content
freezes as the settled content (subject to the settled record being the
authority — see the live/settled split in the parent standard), the phase
flips, the metadata strip appears, and the progress narration collapses. The
user perceives continuity because there is continuity.

## Outcome: settled is not a synonym for succeeded

A settled turn carries an outcome — completed, failed, cancelled, interrupted
— and the transcript renders each honestly, per
[failure-not-empty-success](../../_laws.md#failure-not-empty-success):

- **Failed and interrupted turns stay in the transcript**, in place, visibly
  distinct, with whatever partial content arrived and a retry affordance. The
  partial content matters: the user watched it stream, may have read
  something useful in it, and deleting it tells them their memory is wrong.
- **A cancelled turn says the user cancelled it** — a different fact from
  failure, deserving different styling and no apologetic error copy.
- **An empty completed turn is suspicious by default.** A machine turn that
  settles with no content and no structured rows should render as an explicit
  anomaly, not as a blank bubble the eye skips over.

## Edit and regenerate: history semantics made visible

Both operations rewrite the conversation's future, and the transcript must
render what actually happened to history:

- **Regenerate** produces a sibling response: a new turn, linked to the same
  prompt. If prior attempts are kept, the turn renders as one slot with
  version navigation (attempt k of n) — the identity of each attempt intact
  underneath. If prior attempts are discarded by policy, that is a deletion
  and should be rare, deliberate, and honest.
- **Editing a past user turn forks or truncates** — everything downstream of
  the edited turn belonged to the old wording. The transcript must not show a
  new question followed by answers to the old one; either the downstream
  turns visibly leave (truncate/fork) or the edit is rendered as a marked
  revision with the original recoverable.
- **Either way, an edited or regenerated turn is marked.** A transcript that
  silently rewrites itself forfeits its standing as the record of the
  conversation — and that standing is why the surface exists.

## Roles are a closed vocabulary

User, assistant, system-notice, and whatever small set the product defines —
rendered from one authoritative enumeration, with authorship conveyed in
structure and text (not only alignment and color). A role string that arrives
outside the vocabulary is rendered as a visible unknown, not coerced to the
nearest bubble style: an unknown author is information, and coercion is how
counterfeit chrome sneaks into a transcript.
