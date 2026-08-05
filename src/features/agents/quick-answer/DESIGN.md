# Quick Answer — the unified triage deck

> Co-located design doc. **Rewritten 2026-07-31** (`/perfect` round 2): the
> previous revision described a 576px anchored popover over two queues, a
> `PendingInteraction` union and a click-outside dismiss — none of which have
> existed since the deck shipped. The history that still explains *why* the code
> looks like this is preserved at the bottom.

## What this is

The one surface where a human decides everything waiting on them. Opened from
the title-bar dock (`headerOverlay === 'quick-answer'`), it covers the app below
the title bar and deals pending decisions as a keyboard-first swipe deck.

It fuses **seven queues** that were each decided somewhere else:

| Source | Where it comes from | Verdict verbs |
|---|---|---|
| Persona manual reviews | `useMonitorData` (local + cloud) | Approve · Reject · Skip |
| Backlog ideas | `dev_tools_triage_ideas` (cross-project keyset) | Accept · Reject · Skip |
| Workspace practices | `listWorkspaceKnowledge`, pending statuses only | Adopt · Reject · Skip |
| Build questions | `matrixBuildSlice` sessions awaiting input | Submit · Skip · Later |
| Policy proposals | `policyTuningList` — the Self-Tuning Fabric's pending routing/budget diffs | Apply · Decline · Skip |
| Evolution promotions | `listPromotionProposals` — Darwin Mode's winning challengers | Promote · Reject · Skip |
| Goal acceptance | `dev_tools_list_pending_acceptance` — goals a team parked awaiting sign-off | Accept · Send back · Skip |

The verbs differ per row on purpose. A practice is *adopted*, not accepted; a
goal that fails is *sent back* to the team that finished it, not rejected. One
spine, seven vocabularies — the deck's whole claim is that a reviewer learns the
motion once, not that every domain pretends to be the same domain.

The seven are also the number the title-bar badge must count. It counted two of
them for a long time, so a reviewer with a full backlog and nothing else was
shown `0` — see `useTitleBarTray`, which now reads the backend's cross-queue
total plus the one queue that has no rows to count (build questions live in
frontend session state).

## The model — one item shape, three rules

`triage/triageTypes.ts` defines `TriageItem`, the shape every surface speaks.
Three rules keep it honest:

1. **Nothing in the model layer imports app state, API or React.** Adapters
   receive already-loaded rows and already-translated copy (`useTriageCopy` is
   the only binding to the translation tree), so the same item can be rendered
   by surfaces that resolve strings differently.
2. **One verdict spine: accept / reject / skip.** Every item supports all three
   whatever it is. `skip` is part of the spine rather than a branch because "I
   can't judge this right now" is the most common honest answer in a long queue,
   and a surface that forces a verdict trains people to accept by reflex.
3. **Anything beyond the spine is a `branch`** — carry out a review's suggested
   action, build an idea now, deprecate a practice, open a question in the
   builder, sign off every goal on one KPI at once. Branches are digit-hotkeyed
   `1..9`, so a reviewer's fingers learn one pattern: arrows decide, numbers
   branch. This is what lets one surface cover seven domains without seven
   special cases — the bulk affordance each old UI was built around survives as
   a branch rather than as a second selection model.

### Cross-queue weight is an editorial judgement, stated once

A review, an idea, a practice, a tuning proposal and a finished goal share no
natural urgency scale, so `triageAdapters.ts` assigns `weight` explicitly rather
than letting an order emerge accidentally from seven sort functions. The bands,
and the claim each one makes:

| Kind | Weight | The claim |
|---|---|---|
| Persona reviews | `35–120` by severity, `+40` blocking | An incident outranks everything; a held team step outranks its own severity |
| Build questions | `90` | A persona is halted, and every minute it waits is work not happening |
| Evolution promotions | `78 + margin` (max `+25`) | The only card that EXPIRES — a persona edit fails the approval closed forever |
| Goal acceptance | `45`, or `60` when the KPI is off-track | Real work waiting on a human, with nothing stopped behind it |
| Policy proposals | `40` routing / `52` budget | A budget ceiling binds sooner than a routing preference |
| Backlog ideas | `~30–70` | Value and the Strategist's explicit rank |
| Workspace practices | `~25–60` | Confidence × corroboration — one repo is an opinion, six are a convention |

Goals are the band worth explaining, because both halves of `45` are load-bearing.
A goal reaching this queue is *done*: the work happened and a person is the last
thing between it and closed, which puts it ahead of a routing proposal and
through the middle of the idea and practice bands. But nothing is blocked while
it waits, so it must never outrank a halted build, a promotion that can expire,
or any review above `low`.

The `+15` says which goal to read first. A goal whose KPI never reached its
target is the one worth a conversation — either the work did not move the number
or the number was the wrong one to pick — while a goal that hit its target is a
formality. `60` lifts it past a budget-ceiling proposal and level with a `medium`
review, and deliberately no further: finished work that under-delivered is still
not an incident.

## The queue rail — a ledger, not a worklist

The deck's founding bet was that showing everything you have left is how a triage
surface never gets finished, so it showed nothing but the card. That held while
the deck filled the screen; at desk width it left half the surface empty and the
reviewer still could not answer the two questions a queue raises: what is coming,
and can I get to *that* one first. `deck/DeckQueueRail.tsx` answers both without
becoming a second way to triage — order, kind and title, nothing decidable, and a
click *pins* a row to the front rather than opening it, so the keyboard's contract
with the top card is untouched.

**Rows are one line.** Position · icon · title, with the deferred marker at the
right edge. The second line used to restate a kind the icon already carried; the
title now gets the whole row width. The icon is `aria-hidden`, so the kind lives
in an `sr-only` span and in the tooltip — deleting the visible text without that
would have silently dropped the type for screen readers, the one way this could
have regressed. `ROW_HEIGHT` is exported because it is `estimateSize` for the
virtualizer above 40 rows: if the constant and the rendered row drift, every row
past the fortieth is misplaced and nothing says so.

**The rail widens without moving the card.** It is `shrink-0` in a flex row and
the card centres in the *leftover* space, so historically every pixel of rail
width pushed the card right by half of it — which is why the rail could never be
widened. The card wants a 960px centre column (`max-w-[46rem]` plus flanks, gaps
and padding), so the ladder in `RAIL_WIDTH` grows `240 → 480` only where the
viewport can still pay for that, and `TriageDeckVariant` mirrors the rail with an
empty column from `2xl` up to restore true centring. Below `2xl` there is no
mirror: correcting a 144px offset at 1280px would cost the card 256px, a worse
trade than the offset. The mirror reads the same exported constant, because two
hand-copied class lists that drift is exactly how the card slides off-centre
again. **The card's width is unchanged at every breakpoint** — only its centre
moves, and only towards the middle.

## Module map

| File | Owns | React-free? |
|---|---|---|
| `triage/triageTypes.ts` | the `TriageItem` contract | ✅ |
| `triage/triageAdapters.ts` | seven source shapes → `TriageItem`, incl. weight | ✅ |
| `triage/triageDispatch.ts` | which backend a verdict writes to | ✅ |
| `triage/triageQueue.ts` | queue projection, skip ledger, counters | ✅ |
| `triage/triageReach.ts` | pagination truth (loaded vs. true pending) | ✅ |
| `triage/useUnifiedTriage.ts` | the wiring: sources in, one queue out | hook |
| `triage/useTriageCopy.ts` | the only i18n binding (`t.monitor.triage_*`) | hook |
| `triage/TriageDeckVariant.tsx` | the surface | component |
| `triage/deck/**` | card, physics, panels, action bar, reason strip, queue rail | components |

The pure modules are pure on purpose: they are the parts worth testing, and
splitting them turned an untestable hook into unit-testable units.

## Invariants worth not breaking

- **Every decision either DEFERS, or WRITES, or THROWS. Never nothing.**
  (`triageDispatch.ts`.) The queue removes an item optimistically the moment it
  decides, so a route that silently matches no branch loses the row: it vanishes
  for the reviewer while the backend still says pending.
- **Resolved items leave the array; they do not advance an index.** Index cursors
  desynchronise the moment anything else mutates the list (a poll lands, another
  surface decides the same row).
- **Skip defers, it does not hide** — skipped items sort behind everything
  undecided, for a bounded number of passes. A queue that silently shrinks every
  time someone says "not now" is how items rot; one that re-presents forever can
  never be cleared.
- **A question card is not draggable.** Flinging away a half-typed answer is the
  one unforgivable bug on this surface.
- **One card per build *session*, not per question.** Each `answer_build_question`
  call resumes the halted CLI, so N cards would mean N resumes.

## Still-true history

- **Complex questions are deferred, not inlined.** A question carrying a
  connector picker, file attach or webhook source can't be answered from a card;
  it routes to the builder via a branch. The original rationale holds: an
  immediate-submit picker conflicts with the batch-collect model. Encoded in
  `isDeferredQuestion()`.
- **The title-bar indicator splits click intent** — attention opens this surface;
  the running pulse opens the full Monitor. What "attention" counts has since been
  corrected to all seven queues (it was questions + reviews, which is why the
  badge could read `0` over a full deck), but the split itself is unchanged.
- **The legacy popover components are deliberately retained.** `QuickAnswerBody`,
  `QuickAnswerQuestionGroup` and `QuickAnswerReviewCard` still render inside the
  channel-timeline rail and the reviews rail. `QuickAnswerReviewStepper` is the
  exception: nothing renders it, and the nine `quick-answer-*` tour anchors that
  target it can never anchor.
