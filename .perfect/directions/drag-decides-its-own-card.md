---
slug: drag-decides-its-own-card
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: robustness
status: shipped
size: S
proposed: 2026-08-05
accepted: 2026-08-05
shipped: 2026-08-05
commit: 4b0f7c5cf
---
## What & why

A drag verdict can land on a card the reviewer never looked at. This is the only path in the
deck that writes without carrying the identity of what it is writing about.

## Evidence

- `TriageCard` calls `onCommit(dir)` with only a direction — `TriageCard.tsx:131` (`launch`)
  and `:177-180` (`onDragEnd`).
- `commit` resolves it against the CURRENT top: `const item = topRef.current;`
  (`useDeckControls.tsx:227`), reassigned every render (`:145-146`).
- `queue.items` is replaced by polls: reviews 30s, cloud reviews 15s
  (`usePolling.ts:10,12`; `useMonitorData.ts:262-266,277-282`).
- The `pendingRef` branch is safe — that decision object carries its own `item` (`:295-301`).
  The drag branch has no captured identity.
- The same staleness reaches the post-throw reason capture (`useDeckControls.tsx:234-240`).
- Separately: `submitAnswers` checks `pendingRef` but NOT `captureRef` (`:356`), while
  `decideTop`/`fireBranch`/`undoLast` check both (`:319,369,403`). The reason strip replaces
  the action bar, not the card, so `QuestionPanel`'s buttons stay live
  (`QuestionPanel.tsx:107-110`).

## Acceptance criteria

- [ ] The dragged item's id travels with the commit and is verified before the write.
- [ ] A commit whose item is no longer top is DROPPED, not redirected to the new top.
- [ ] The post-throw reason capture binds the same verified item.
- [ ] `submitAnswers` refuses while a reason capture is open.
- [ ] A test replaces `queue.items` between grab and release and asserts no write lands on
      the wrong card.

## Risks / non-goals

Do not break the `cycle`-keyed thrown-state reset (`TriageCard.tsx:150-159`) — a re-presented
card must still be throwable. Keep the 1200ms flight watchdog (`useDeckControls.tsx:66`).

## Build record

**Shipped** `4b0f7c5cf` (+ doc invariant `215434840`). Director verdict: **merge**, no notes.

`onCommit(dir, itemId)` — the id is read at **launch**, not at report, so a re-render
mid-flight cannot change whose verdict it is. `commit` verifies before any write; a mismatch
is dropped, never redirected.

**The non-obvious part the builder found:** the drop path must NOT `disarm()` when a queued
decision exists. Disarming first would strand the pending decision and wedge the surface —
precisely the failure the 1200ms watchdog exists to catch. The watchdog still lands a queued
decision on its own item.

Also fixed: the post-throw reason capture binds the verified item, and `submitAnswers` now
checks `captureRef` alongside `pendingRef` (the reason strip replaces the action bar, not the
card, so `QuestionPanel`'s buttons stayed clickable underneath).

Both fixes negative-checked — reverted, test fails, restored. New `deckDragIdentity.test.tsx`
churns `queue.items` between grab and release.

Gates: 260 tests / 16 files (from 241/14) · tsc 0 · eslint 0 errors, warning set unchanged.
