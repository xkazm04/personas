---
layer: application
subject: triage-queues
technique: focus-mode
stack: react
---

# Focus mode — the triage deck in this repo

The Quick Answer triage deck
(`src/features/agents/quick-answer/triage/`) is a full implementation of
the technique: a one-at-a-time card deck over the unified queue, with
keyboard and drag-gesture verdicts. The logic is split exactly along the
technique's seams — `triageQueue.ts` (pure projection: what is dealt, in
what order), `useUnifiedTriage.ts` (sources and writes),
`deck/useDeckControls.tsx` (between "the reviewer expressed an intent" and
"the queue recorded a verdict").

## Cursor by identity, order never mutated

`triageQueue.ts` `projectQueue` resolves the read head with
`items.findIndex((i) => i.id === cursorId)` — an id, never a stored index,
because *"reviews poll every 30s and cloud reviews every 15s, both
replacing the queue wholesale, so a remembered NUMBER would quietly come to
mean a different card."* A missing id falls back to the front, one rule
covering "decided", "filtered away", and "walked off the end". The
`cursorId` doc comment records the earlier defect the design replaced:
jumping to an item used to hoist it to the front, so *"the queue the
reviewer was reading silently renumbered itself around their click."*
Order and position are separate concerns in code, not just in prose.

## In-flight lock with a watchdog

`useDeckControls.tsx` uses `pendingRef` as both the decision queue and the
in-flight lock (rule 2 of its header): a decision is queued before the card
is thrown and lands only when the card reports its flight over, so *"a
keystroke arriving during those 200ms can't decide the outgoing card twice
or the incoming one early."* Rule 4 names the exact failure the technique's
watchdog clause exists for: *"if a card is thrown and never reports back,
the lock never opens and the WHOLE surface goes dead — keyboard, flanks and
action bar. So every throw also arms a watchdog"* (`FLIGHT_TIMEOUT_MS =
1200` — deliberately a stuck-detector, not a second animation clock).

## Bounded skip that stands down but stays counted

`triageQueue.ts` `MAX_SKIP_PASSES = 2`: skipped items sort behind
everything undecided (`rows.sort` keys on skip count first), and an item
skipped twice stands down for the session — *"skip the last card and it is
instantly the last card again, forever"* is the termination argument in the
file header. Exhausted skips leave the deck but stay in the denominator
(`sessionTotal = resolved.size + pending.length`, `deferredCount`) — the
header's honesty property 2 is the technique's rule that progress can never
exceed its total.

## Verdict rhythm details

- **Reason capture follows the input channel** (`useDeckControls.tsx`
  `ReasonCapture.thrown`): keyboard/button rejections ask *before* the card
  flies; a drag rejection has already happened, so the prompt appears after
  the throw and resolving it must not re-throw a card that has already
  gone.
- **Single bounded undo** (`useUnifiedTriage.ts` `UNDO_WINDOW_MS = 30_000`):
  exactly one act is takeable-back, because *"a deck that lets you walk
  backwards through a session is a deck you can spend a session walking
  backwards through"*; a lost undo swap is reported with the same conflict
  copy as any lost verdict swap.
- **Draft answers are keyed by source id, not card id, and persisted**
  (`useDeckControls.tsx` `drafts`): polls replace card identities, and the
  session store is what keeps a half-typed answer alive across the deck
  unmounting.
- **Keyboard priority is placed on the app's ladder**
  (`DECK_KEYBOARD_PRIORITY = 70`): above route-level surfaces so nothing
  moves the app out from under a decision in flight, deliberately below the
  modal layer and command palette.

## Completion honesty

The deck's endings distinguish cleared / filtered / failed: the failed
ending lists the sources that did not answer (`failures`), the filtered
ending carries `showAllKinds` (it used to render a dead end describing a
queue the reviewer could not get back to), and the cleared ending consults
`backlog.more` before claiming nothing is waiting.
