# Quick Answer — global header surface for pending Q&A

> Co-located design doc (Option B-Design, `/research` run 2026-06-05, source
> YouTube `c0kaKxM2pHg` "grill me" → reframed by the user into a Q&A-UX feature).
> Status: **shipped (v1, A / C-ready)**, commits 635fc9037 · 91da41a08 ·
> 303b3fbbc. This doc is the implementation contract.
>
> **Amendment (shipped):** connector-category questions are treated as
> *complex* in v1 and deferred to "Open in builder" alongside reference/webhook
> questions (the doc originally floated inlining `VaultConnectorPicker`). The
> immediate-submit picker conflicted with the popover's batch-collect model, so
> v1 inlines only options + free-text and deep-links everything that needs a
> richer control. `isComplexQuestion()` encodes this.

## Problem

Building a persona (build-from-intent or template adoption) and reviewing agent
output both produce **questions that block on the user**. Today the user must
either be *on the persona's matrix/glyph tab* to answer build questions, or open
the **full-screen** Persona Monitor to action human reviews. There is no
lightweight "a question is waiting — answer it and keep working" surface. The
Q&A cycle stalls because answering means navigating back to a draft.

## Goal

A lightweight **Quick Answer popover** that drops from the app header,
aggregates everything that needs the user right now — **build/adoption pending
questions + human reviews** — lets them answer **inline**, and lets them
**continue elsewhere** without a context switch. The full Monitor stays as the
fleet-wide view.

Decisions (locked via AskUserQuestion, 2026-06-05):
- **Approach A now, C-ready.** Ship the inline popover; structure it so the
  "open in context" deep-link for complex questions (Approach C) layers on.
- **Split the existing indicator.** `ProcessActivityIndicator`'s *attention*
  (questions + reviews) opens Quick Answer; the *running pulse* still opens the
  full Monitor. One icon, two intents.
- **v1 scope: questions + reviews.** (Unread messages deferred.)

## What already exists (reuse, don't rebuild)

| Piece | Location | Reuse |
|---|---|---|
| Header attention model + badge | `ProcessActivityIndicator.tsx:33-42` | extend: split click, add build-question count |
| Mutually-exclusive overlay controller | `uiSlice` `HeaderOverlay` (`:49`) | add `'quick-answer'` value |
| Per-session pending questions (global) | `matrixBuildSlice.buildSessions[id].pendingQuestions` | read directly |
| Global build-event delivery while unmounted | `eventBridge.ts:385-392` (routes into slice for any session in `buildSessions`) | linchpin — popover sees new questions live |
| Question renderer (options/free-text/connector) | `GlyphQuestionCard` in `glyph/GlyphQuestionPanel.tsx` | extract slim shared `QuestionAnswerCard` |
| Build answer IPC (route-independent) | `answerBuildQuestion(sessionId,…)` `api/agents/buildSession.ts:70` | call with explicit sessionId |
| Batch-escape logic (security-sensitive) | `useBuildSession.submitAllAnswers:455-486` | **extract to shared helper** |
| Review list + inline action | `useMonitorData` reviews + `handleReviewAction` | mount only when popover open |
| Session-targeted state update | `matrixBuildSlice.updateSessionInState(state, id, fn)` | base for new action |

## Architecture

```
TitleBar
 └─ ProcessActivityIndicator   (split: attention → 'quick-answer', running → 'monitor';
     │                          badge = reviews + msgs + processActivity + NEW build-question count)
     ├─ <PersonaMonitor>        (headerOverlay==='monitor', unchanged)
     └─ <QuickAnswerPopover>    (headerOverlay==='quick-answer', NEW — compact panel)
          └─ usePendingInteractions()   (NEW hook)
               ├─ build/adoption questions  ← matrixBuildSlice.buildSessions (zustand, cheap)
               └─ reviews                   ← useMonitorData (reviews + handleReviewAction)
```

### Data model — `PendingInteraction` (discriminated union)

```ts
type PendingInteraction =
  | { kind: 'question'; id: string;            // `${sessionId}:${cellKey}`
      sessionId: string; personaId: string; personaName: string;
      personaIcon: string | null; personaColor: string | null;
      question: BuildQuestion;                  // cellKey, question, options, connectorCategory, acceptsReference, acceptsWebhookSource
      complex: boolean }                        // connectorCategory || acceptsReference || acceptsWebhookSource → defer to "open in context"
  | { kind: 'review'; id: string; review: ManualReviewItem;
      personaName: string; personaIcon: string | null; personaColor: string | null };
```

`usePendingInteractions()`:
- questions: flatten `Object.values(buildSessions)` → for each session in
  `phase === 'awaiting_input'`, map `pendingQuestions` → question interactions,
  enriching persona display from `agentStore.personas`.
- reviews: from `useMonitorData().reviews` (already pending-filtered + fused
  local/cloud), enrich persona display.
- Returns `{ interactions, questionCount, reviewCount, total, handleReviewAction, submitQuestionAnswers, isProcessing }`.

### Answering — questions

- **Simple** (options / free-text / connector-category): collect in **local
  component state** keyed by `${sessionId}:${cellKey}`. Connector-category
  reuses `VaultConnectorPicker` (selection = the answer string), exactly like
  `GlyphQuestionCard`.
- On **Send for this persona**: build the batched payload via the shared helper
  and submit once per session:
  ```ts
  await answerBuildQuestion(sessionId, '_batch', buildBatchedAnswerPayload(answers));
  matrixBuildSlice.applyPendingAnswers(sessionId, answers); // optimistic: clear answered Qs for that session
  ```
- **Complex** (`acceptsReference` / `acceptsWebhookSource`): NOT answerable
  inline (need file/URL attach UI). Render a compact card with an **"Open in
  builder"** button → `navigateTo` the persona's matrix tab (the C-ready seam;
  reuses the existing `ProcessNavigateTo` shape). v1 does not inline these.

### Answering — reviews

Reuse `useMonitorData().handleReviewAction(id, 'approved'|'rejected', notes?)`
verbatim (handles local + cloud). Compact card: title + severity dot +
Approve / Reject. Optional notes via a small expander (defer rich notes to the
Monitor — keep the popover fast).

### Shared batch-answer helper (NEW, security-sensitive)

`src/lib/build/answerPayload.ts`:
```ts
/** Escape + join answers into the backend's line-per-dimension `_batch` payload.
 *  Escaping prevents a pasted log/answer from forging an extra `[dim]:` line. */
export function buildBatchedAnswerPayload(answers: Record<string, string>): string;
```
- Move the exact escape (`\\` → `\\\\`, newlines → `\n`, `[` → `\[`) + join from
  `useBuildSession.submitAllAnswers`. Refactor `submitAllAnswers` to call it.
- Unit test: escaping + join + empty → `''`.

### Slice action (NEW, additive)

`matrixBuildSlice.applyPendingAnswers(sessionId, answers)`:
- `updateSessionInState(state, sessionId, sess => ({ ...sess,
   pendingAnswers: { ...sess.pendingAnswers, ...answers },
   cellStates: { ...mark answered keys 'filling' },
   pendingQuestions: sess.pendingQuestions.filter(q => !(q.cellKey in answers)) }))`.
- Session-targeted (NOT active-only like `collectAnswer`) so the popover can
  answer a backgrounded session. Unit test: targets the right session, leaves
  others untouched, only mutates scalars when target is active.

### Header wiring

- `HeaderOverlay`: `'none' | 'monitor' | 'notifications' | 'quick-answer'`
  (uiSlice). Back/route-nav already close any non-'none' overlay centrally — no
  extra teardown needed.
- `ProcessActivityIndicator`:
  - attention count now also includes pending build questions read from
    `matrixBuildSlice` (build-from-intent isn't in process activity).
  - click: if attention > 0 → toggle `'quick-answer'`; else (running/idle) →
    toggle `'monitor'`. Tiny secondary affordance (or shift-click / a caret)
    to reach the Monitor even when attention > 0 — keep both reachable.
  - render `<QuickAnswerPopover>` under `AnimatePresence` when
    `headerOverlay === 'quick-answer'`.

### Popover shell

- Anchored panel under the titlebar (mirror Notifications-center placement, NOT
  full-screen): `fixed top-[titlebar] right-… w-[400px] max-h-[70vh]
  overflow-y-auto`, `shadow-elevation-4`, `rounded-modal`. Click-outside + Esc
  close (Esc already handled by the header overlay Back path; add click-outside).
- Sections: **Questions** (grouped by persona) then **Reviews**. Empty state
  when `total === 0` ("You're all caught up").

## Constraints / conventions

- **i18n:** all new strings → `src/i18n/locales/en.json` only (non-English fall
  back automatically; do NOT edit other locales). Replace the existing
  `debtText("auto_answer_in_your_own_words_…")` in the extracted card with a
  real key.
- **Design tokens / contrast:** `typo-*`, `rounded-{modal,card}`,
  `shadow-elevation-*`; body text full-contrast `text-foreground` (no
  low-contrast opacity); reuse `PersonaIcon`, `Button` where they fit.
- **Shared component:** if `QuestionAnswerCard` is extracted to
  `shared/components/`, add a `@catalog` tag + run `npm run gen:catalog`.
- **No new IPC, no Rust changes** — frontend-only; all submission paths exist.

## Known limitations (v1)

- Sessions that exist in SQLite but were never hydrated into `buildSessions`
  this app-run (e.g. started, then full app restart, matrix never visited) won't
  appear until the matrix surface hydrates them. Enhancement: a startup
  `getActiveBuildSessions()` hydrate. Out of scope for v1; note in summary.
- Complex (reference/webhook) questions deep-link rather than inline (C seam).

## Rollout (atomic commits)

1. **Shared helper + slice action** — `lib/build/answerPayload.ts` + refactor
   `submitAllAnswers` + `applyPendingAnswers` action + unit tests. (pure/low-risk)
2. **Hook + popover + cards + i18n** — `usePendingInteractions`,
   `QuickAnswerPopover`, extracted `QuestionAnswerCard`, en.json keys.
3. **Header wiring** — uiSlice `'quick-answer'`, split `ProcessActivityIndicator`,
   render popover, badge includes build questions.
4. **Docs** — this DESIGN.md, feature-doc sync (overview/templates), CATALOG if
   a shared component was added.

Validation per commit: `npx tsc --noEmit`, `npm run lint` (eslint on touched
files), `npm run test` for the pure helper + slice action. No cargo (FE-only).
