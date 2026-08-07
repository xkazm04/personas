---
name: agents-quick-answer
type: perfect/context
group: Agent Platform
category: ui
opportunity: 9
last_proposed: 2026-08-05
cooldown_until: —
directions: ["[[honest-endings]]", "[[drag-decides-its-own-card]]", "[[queue-rebuild-cost]]", "[[nothing-colour-only]]", "[[untrusted-card-content]]"]
---

# agents-quick-answer

The one surface where a human decides everything waiting on them. 33 files. Absorbed
`quick-answer-legacy-rails`, `quick-answer-shell`, `triage-core`, `triage-tests`,
`triage-unified-hook`, `quick-config-shared` on 2026-08-04.

**Registry mismatch:** `.personas/contexts.txt` still lists the pre-consolidation names and
does NOT contain `agents-quick-answer`. Coverage entries must use `quick-answer-shell` /
`triage-deck-ui` / `triage-core` or they land unanchored.

## Current state (scout brief, 2026-08-05)

### Architecture

Seven queues fused through one `accept/reject/skip` spine (`triageTypes.ts`): persona
reviews, backlog ideas, workspace practices, build questions, policy proposals, evolution
promotions, **goal acceptance** (added this session). Model layer is React-free and
store-free; adapters receive loaded rows + pre-translated copy. `routeDecision` is the
single write door. Genuinely good bones — the problems below are all at the edges.

### Liveness — the legacy rails ARE live, but 4 gestures deep

`QuickAnswerPopover` renders **only** `TriageDeckVariant` (`:102-111`). The four legacy
components reach the user through a different chain entirely:

`useTitleBarTray:152` → `PersonaMonitor:279` → `MonitorChannelGrid:181` (layout must be
switched *off* its `stream` default, `:108`) → `ConversationBriefing:248` rail tab.

- `QuickAnswerBody` · LIVE · 4 gestures
- `QuickAnswerQuestionGroup` · LIVE · child of Body
- `QuickAnswerReviewStepper` · LIVE · child of Body
- `QuickAnswerReviewCard` · LIVE · 3 gestures (`reviews` is the default rail tab)
- `QuickAnswerBodyView` · **DEAD export** (`QuickAnswerBody.tsx:41`), stale doc comment
- **Zero test coverage** for all four.

Two docs assert the opposite of the code: `DESIGN.md:169-173` claims nothing renders the
stepper (false); `QuickAnswerBody.tsx:35-40` claims the popover renders `QuickAnswerBodyView`
(false). The popover's own "channel-timeline rail" phrasing is stale — the rail lives in
`ConversationBriefing` (**Conversations**), while the layout *labelled* Timeline is `Stream`,
which does not import it.

### Honesty gaps (→ [[honest-endings]])

- No `error` field on `UnifiedTriageQueue`; all seven sources `.catch(toastCatch)`.
  Total failure → *"Deck cleared — nothing is waiting on you."*
- `deferredCount` computed (`triageQueue.ts:135`), exposed (`useUnifiedTriage.ts:964`),
  **zero consumers**.
- `remaining` covers ideas only; other sources use fixed limits with no `hasMore`.
- `filtered` under-detects (counts `live`, i.e. post-skip-filter).
- `filtered` outranks `batched` and takes the button with it (`DeckStates.tsx:86,150`).
- `QuickAnswerBody` never destructures `loading` → "all caught up" on first paint AND on
  fetch failure. `ReviewsRail:66` same shape via `silentCatch`.
- `QuickAnswerQuestionGroup:35-47` — `try/finally`, no `catch`: silent unhandled rejection.
- `QuickAnswerReviewStepper:90-100` — success toast fires *before* the await.

### Correctness (→ [[drag-decides-its-own-card]])

`onCommit(dir)` carries no item identity (`TriageCard.tsx:131,177-180`); `commit` resolves
against `topRef.current` (`useDeckControls.tsx:227`). Polls at 30s/15s replace `queue.items`.
Keyboard path is safe (carries its own `item`); drag is not.
`submitAnswers` checks `pendingRef` but not `captureRef` (`:356`).

Guarded already: capture cleared when its card leaves (`:310-315`), 1200ms flight watchdog
(`:66,258-264`), thrown-state reset keyed on `cycle` (`TriageCard.tsx:150-159`).

### Cost (→ [[queue-rebuild-cost]])

- Projection re-runs on every poll; comparator does 2 `Map.get` + `localeCompare` on ISO
  strings per comparison; focus pin re-tested per pair (`triageQueue.ts:119-129`).
- `adoptReach` re-parses applicability once per member project (`triageReach.ts:90`).
- Three `saveTriageSession` effects, all firing on mount, each stringifying the whole record
  incl. up to ~400KB of drafts (`useUnifiedTriage.ts:341-349`).
- `listManualReviews(undefined, 'pending')` — no limit (`useMonitorData.ts:222`).
- `TriageCard` is the **only** memoized component in `deck/`. Rail, top bar, action bar and
  both flanks re-render on every keystroke; `triageRenderCost.test.tsx` covers only the card.
- Over-subscription to `activeProcesses` for data no consumer reads (`useMonitorData.ts:186`).

### Accessibility (→ [[nothing-colour-only]])

- Fact `tone` is colour-only (`TriageFactRow.tsx:55-58`).
- Meter direction (the purpose of `invert`) is colour-only; meter `aria-hidden`
  (`MetricBadgeRow.tsx:19-34`).
- Rail's deferred marker is glyph-only and `aria-hidden` (`DeckQueueRail.tsx:117-119`).
- Hand-rolled polite region (`TriageDeckVariant.tsx:125`) instead of `AriaLiveProvider`,
  which exists to force re-utterance of identical consecutive messages.
- The "ONE live region" claim is false: `AlertBanner` (`role="status"`, up to 3 mounted) and
  `LoadingSpinner` add more.
- `TriageCardBody` sets `tabIndex={0}` unconditionally → 3 prose-scroller tab stops.
- Good: focus trap, restore-to-trigger, `dl/dt/dd` ledger, real `disabled`, reason strip
  focuses the escape hatch first, progress clamped defensively.

### Content trust (→ [[untrusted-card-content]], REJECTED)

Links sanitized; images raw (`MarkdownRenderer.tsx:320-322`). No `rehype-raw`, no
`rehype-sanitize`. `sanitizeIconUrl` exists for this and isn't wired.

### Duplication

`isComplexQuestion` ≡ `isDeferredQuestion` (byte-identical bodies, two call sites) ·
`shapeReview` hand-copied in `ReviewsRail:43-63`, **dropping `assignment_id`/`step_id`/
`use_case_id`** · two polling mechanisms on one query · `openBuilder` written twice ·
5 UIs for "resolve one manual review" · focusable-selector literal ×6 · 3 hand-rolled
tone-buttons · branch buttons rendered twice for question cards · depth constants copied
and already drifted (`DeckStates.tsx:35-37` vs `TriageCard.tsx:161-170`).

## Direction history

| Direction | Outcome |
|---|---|
| [[honest-endings]] | **accepted** 2026-08-05 |
| [[drag-decides-its-own-card]] | **accepted** 2026-08-05 |
| [[queue-rebuild-cost]] | **accepted** 2026-08-05 |
| [[nothing-colour-only]] | **accepted** 2026-08-05 |
| [[untrusted-card-content]] | **REJECTED** 2026-08-05 — the only one of five declined. Implied reason: the fix lands in the shared `MarkdownRenderer`, outside this context, and the gate flagged that caveat explicitly. Do not re-propose as a quick-answer direction; re-raise against whichever context owns `shared/components/editors`. The finding itself stands and is real. |

## Shipped

_(pending — wave 1 in flight)_
