---
layer: application
subject: chat-transcript
technique: transcript-scroll
stack: react
---

# Athena's chat — the ready gate, the pin, and the bug that proved both

The companion panel's transcript is the repo's fullest realization of the
transcript-scroll technique, and it carries the scar tissue that motivates the
technique's hardest rule.

## The pin: `useChatScroll`

`src/features/plugins/companion/useChatScroll.ts` is the single scroll
authority for the transcript:

- **Forgiving pin band** — `NEAR_BOTTOM_PX = 80` (`:4`): "at the tail" is a
  band, not pixel-exact.
- **Disengage on user scroll** — `recompute` (`:35-42`) recalculates
  `atBottom` from real geometry on every scroll event; `maybeAutoScroll`
  (`:61-64`) pins only while `atBottomRef.current` is true, so content
  arriving while the user reads history stays below the viewport. The header
  comment (`:6-19`) names the ancestor defect: the panel used to force
  `scrollTop = scrollHeight` on every message — the yank the technique
  forbids.
- **The way back** — `AthenaChatJumpToLatest.tsx` renders the pill off
  `!atBottom`, fading rather than popping "so a brief scroll wobble near the
  bottom doesn't flash it". (No unseen-count on the pill — a deviation noted
  in the parent standard's report.)

## The ready gate: `athenaChatSession.ts` and commit `d17b43d00`

The panel stages its body behind a mount gate (`useChatMount`) — a skeleton
renders for ~300ms before the scroll container exists. The original
open-at-latest effect fired ~2 frames into that window, hit a null ref,
no-op'd, **and stamped itself done** — so the chat opened at the top,
permanently. The same timing froze the scroll listener's initial
`atBottom=true`, which meant every new message yanked the view down and the
jump pill could never appear: both halves of the contract broken by one
unwatched gate.

The fix (commit `d17b43d00`, 2026-08-10) threads the mount gate into both
hooks as `containerReady`:

- `useChatScroll(containerReady)` re-runs its listener-attach effect when the
  gate flips (`useChatScroll.ts:44-50`), so `atBottom` tracks a real element.
- `useAthenaChatView(engine, ready)` gates the initial jump on
  `ready && initialized`, keys it per `activeConversationId` (a conversation
  switch re-lands at the tail), waits **two `requestAnimationFrame`s** for
  the restored transcript to paint before measuring `scrollHeight`, and jumps
  with `'auto'` — instant, never animated
  (`chat/athenaChatSession.ts:63-76`; the rationale comments at `:52-62` are
  a compressed statement of the technique).

This is [gate-sees-target](../../_laws.md#gate-sees-target) in miniature: the
gate that existed ("effect ran once on mount") observed a proxy; the repaired
gate observes the mounted container and only then writes its done-stamp. The
regression test lives at
`src/features/plugins/companion/__tests__/athenaChatSession.test.tsx`.

## History upward, ground held still

Two mechanisms load older content, both gated on the same `ready` flag
(`athenaChatSession.ts:79-91`): `useShowEarlierOnScroll` expands the local
window with anchored compensation (`showEarlierAnchored`), and
`useTranscriptPages` takes over backend paging only "once every loaded
message is on screen — otherwise scrolling up would fetch history the panel
is already hiding".

## Where the repo deviates

- **No per-thread reading-position restoration**: `initialScrolledFor` keys
  per conversation, so every switch re-lands at the tail rather than
  restoring where the user left off. Cheap and predictable; the technique's
  restoration clause is the standard this surface has not adopted.
- **No unseen count** on the jump pill — attention is requested, but without
  the "how much" the technique asks for.
