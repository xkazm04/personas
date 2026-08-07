---
slug: honest-endings
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: robustness
status: accepted
size: M
proposed: 2026-08-05
accepted: 2026-08-05
shipped: 2026-08-05
commit: 739d0ca3c
---
## What & why

The deck tells a reviewer "nothing is waiting on you" in at least four situations where
something is. A decision surface that under-reports work is worse than one that is merely
ugly: the reviewer stops looking.

## Evidence

- No `error` field on `UnifiedTriageQueue` (`useUnifiedTriage.ts:191-245`); all seven
  sources end in `.catch(toastCatch(...))` (`:403,422,438,459`). Total failure renders
  `DeckCleared` → "Deck cleared — nothing is waiting on you".
- `deferredCount` computed `triageQueue.ts:135`, exposed `useUnifiedTriage.ts:964`,
  **zero consumers repo-wide**. Twice-skipped cards leave the deck silently.
- `remaining` populated only from the ideas keyset page (`useUnifiedTriage.ts:391-400`);
  every other source uses a fixed limit with no `hasMore`.
- `filtered` computed over `allCounts` = `countByKind(live)` (`triageQueue.ts:133`), i.e.
  post-skip-filter → under-detects.
- `batched = !filtered && remaining > 0` (`DeckStates.tsx:86`) → filter + capped backlog
  yields no button at all (`:150`).
- `QuickAnswerBody.tsx:46-49` never destructures `loading`; `useMonitorData.ts:220-229`
  catches a failed review fetch with `logger.error` only.
- `ReviewsRail.tsx:66` `silentCatch` → renders "nothing waiting".
- `QuickAnswerQuestionGroup.tsx:35-47` `try/finally`, no `catch` → unhandled rejection.
- `QuickAnswerReviewStepper.tsx:90-100` success toast fires before the await.

## Acceptance criteria

- [ ] `UnifiedTriageQueue` exposes per-source load failure; a partial failure is visible.
- [ ] A failed load renders a distinct, retryable ending — never the cleared ending.
- [ ] `deferredCount > 0` is stated in the ending copy.
- [ ] `remaining` accounts for every capped source, not just ideas.
- [ ] Filtered and batched endings each offer their own action.
- [ ] `QuickAnswerBody` and `ReviewsRail` distinguish loading / error / empty.
- [ ] Question submission failure surfaces to the user; the stepper toasts after the write.

## Risks / non-goals

Not a redesign of `DeckStates`. New copy needs i18n across 14 locales — budget for it.
Do not weaken the "skip sorts to the back" model; the point is to REPORT deferrals.

## Build record

All seven items shipped in one commit.

- `UnifiedTriageQueue.failures` (`TriageSourceFailure[]`) fed by all six fetched
  sources; new `useMonitorData#reviewsError` and `useWorkspaceCenter#knowledgeError`
  carry the two that previously ended at a log line.
- New `DeckFailed` ending; unreachable at the same time as `DeckCleared`. Partial
  failure shows a top-bar `FailureChip`.
- `deferredCount` stated under every ending (`DeferredNote`).
- `TriageBacklog` gained `remaining` (exact) + `capped`/`more` (fixed-limit ledgers).
- Filtered and batched both render and both keep an action; "Check for more" is now
  always offered; "Deal the next batch" is gated on a next page existing.
- `QuickAnswerBodyView` + `ReviewsRail` distinguish loading / error / empty and admit
  a partial read over what did load.
- `QuickAnswerQuestionGroup` catches and toasts (and keeps the typed answer);
  `QuickAnswerReviewStepper` toasts after the await.

**Premise correction.** "`filtered` under-detects" does not hold. `allCounts` is
`countByKind(live)`, so a switched-off kind whose items are all skip-exhausted counts
0 — but turning that filter on would deal nothing, so calling it "filtered" would be a
new lie. That case is a DEFERRAL and item 2 covers it. `triageQueue.test.ts` unedited.

21 new tests (`deckHonestEndings.test.tsx`, `quickAnswerHonesty.test.tsx`,
`useUnifiedTriage.test.ts`). 16 new `monitor.*` keys × 14 locales.
