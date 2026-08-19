---
layer: application
subject: chat-transcript
technique: turn-model
stack: react
---

# Two transcripts, two turn models — the flagged member vs the swapped element

The repo renders chat transcripts in two major places, and they realize the
turn-model technique differently — one on-standard, one a deliberate
deviation. Reading them side by side is the fastest way to internalize the
technique.

## On-standard: the agent chat (`ChatThread.tsx`)

`src/features/agents/components/ChatThread.tsx` takes `messages` plus a
`streamingMessageId?: string | null`. The streaming turn **is a member of the
list** — it has its identity from birth, and streaming is a per-row flag
(`streamingMessageId === message.id`), not a separate element appended after
the list. When the stream settles, the same row keeps its key and its DOM
position; only the flag flips. Failed turns follow the technique too: the
error card carries an `onRetry` handler "so the user can recover without
re-typing" — failure rendered in place with a path forward.

## Deviating on purpose: the companion chat

The companion transcript keys settled rows by message id
(`chat/AthenaChatTranscript.tsx:121`, `key={m.id}`) and memoizes each row
(`AthenaChatMessageRow.tsx` — "an unchanged row skips its whole subtree",
which is the settled-prefix-is-inert rule from the parent standard). But the
live turn is a **separate element**: `AthenaChatStreamingTurn.tsx` renders at
the end of the transcript while a turn runs, and when the backend persists
the episode, the settled `AthenaChatMessageRow` replaces it — the
two-elements-that-swap shape the technique warns about.

Why it mostly doesn't bite here: the companion **stopped streaming tokens
into the bubble** ("the bubble no longer renders live tokens" —
`athenaChatSession.ts:48-49`; `AthenaChatStreamingTurn`'s header documents
consolidating four competing progress surfaces into one). The live element
shows narration, typing dots, a Stop control, and the plan — not a growing
prefix of the reply text — so the swap replaces a *status card* with the
*answer*, and there is no mid-read selection or scroll anchor inside the
swapped element to destroy. The technique's failure bundle (lost selection,
anchor jump, restarted entrance animation) is dodged by removing the readable
content from the swapped element, not by keeping one element.

The residual costs are real and observable:

- The swap point still races the persisted echo — the transcript refetches
  (`companionListRecentMessages`) to converge, which is reconciliation by
  refresh rather than by identity adoption.
- Row *kinds* inside the transcript are partly sentinel-typed: `PROGRESS:`
  prefixes, `[autonomous continuation…]`, `[proactive: …]` markers are
  string-sniffed by `Bubble.tsx` (`:62-107`) and `systemMarkers.ts` rather
  than typed rows through one registry — content-as-type, the drift risk the
  inline-structured-rows technique's closed-taxonomy rule exists for.

## The identity discipline both share

Both surfaces key rows by minted message id, never index; the companion's
`index` prop exists only for test/a11y attributes and is documented as
"absolute index in the full transcript — stable across window expansion"
(`AthenaChatMessageRow.tsx:37-38`) — position carried as metadata, identity
carried as key, which is
[identity-survives-reuse](../../_laws.md#identity-survives-reuse) applied to
a windowed list.
