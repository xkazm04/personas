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

It fuses **four queues** that used to have four separate UIs:

| Source | Where it comes from | Verdict verbs |
|---|---|---|
| Persona manual reviews | `useMonitorData` (local + cloud) | Approve · Reject · Skip |
| Backlog ideas | `dev_tools_triage_ideas` (cross-project keyset) | Accept · Reject · Skip |
| Workspace practices | `listWorkspaceKnowledge`, pending statuses only | Adopt · Reject · Skip |
| Build questions | `matrixBuildSlice` sessions awaiting input | Submit · Skip · Later |

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
   builder. Branches are digit-hotkeyed `1..9`, so a reviewer's fingers learn one
   pattern: arrows decide, numbers branch. This is what lets one surface cover
   four domains without four special cases.

### Cross-queue weight is an editorial judgement, stated once

A review, an idea and a practice share no natural urgency scale, so
`triageAdapters.ts` assigns `weight` explicitly rather than letting an order
emerge accidentally from four sort functions: severity outranks a blocked build
session; a blocked build outranks any idea (a persona is halted, and every minute
it waits is work not happening); practice weight comes from confidence ×
corroboration, because one repo saying something is an opinion and six repos
saying it is a convention.

## Module map

| File | Owns | React-free? |
|---|---|---|
| `triage/triageTypes.ts` | the `TriageItem` contract | ✅ |
| `triage/triageAdapters.ts` | four source shapes → `TriageItem`, incl. weight | ✅ |
| `triage/triageDispatch.ts` | which backend a verdict writes to | ✅ |
| `triage/triageQueue.ts` | queue projection, skip ledger, counters | ✅ |
| `triage/triageReach.ts` | pagination truth (loaded vs. true pending) | ✅ |
| `triage/useUnifiedTriage.ts` | the wiring: sources in, one queue out | hook |
| `triage/useTriageCopy.ts` | the only i18n binding (`t.monitor.triage_*`) | hook |
| `triage/TriageDeckVariant.tsx` | the surface | component |
| `triage/deck/**` | card, physics, panels, action bar, reason strip | components |

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
- **The title-bar indicator splits click intent** — attention (questions +
  reviews) opens this surface; the running pulse opens the full Monitor.
- **The legacy popover components are deliberately retained.** `QuickAnswerBody`,
  `QuickAnswerQuestionGroup` and `QuickAnswerReviewCard` still render inside the
  channel-timeline rail and the reviews rail. `QuickAnswerReviewStepper` is the
  exception: nothing renders it, and the nine `quick-answer-*` tour anchors that
  target it can never anchor.
