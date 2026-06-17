# Test Mastery — Onboarding Tour
> Total: 8 findings (0 critical, 4 high, 3 medium, 1 low)

Scope note: the six manifest files are nearly all presentation (JSX + `t.*` strings). The real, regressable onboarding/tour logic lives in three sibling files these components delegate to — `useOnboardingState.ts`, `tourConstants.ts`, `templateRecommendation.ts` — plus two store slices (`onboardingSlice.ts`, `tourSlice.ts`). There is a genuinely good existing test culture here: `tourSlice.test.ts` (tier-switch migration + storage probe) and `__tests__/useTourNarration.test.ts` are honest, behavior-level suites with a clean Zustand harness pattern. The gaps below are the untested business logic *those* tests don't reach. Onboarding is not auth/billing, so nothing rates critical — but first-run completion drives activation, which is a business KPI.

## 1. `advanceTour` honest-completion guard is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/system/tourSlice.ts:1382-1407 (also finishTour 1446-1459)
- **Current test state**: none (tourSlice.test.ts covers only startTour migration + storage probe)
- **Scenario**: `advanceTour` deliberately splits two end-of-list cases: when every step is complete it calls `finishTour()` (which sets `tourCompletionMap[id]=true` and force-marks all steps done); when the user "Skips" the last *incomplete* step it must just close the tour WITHOUT recording 100% completion. A refactor that collapses these (or flips the `allDone` check) would silently mark tours complete that the user skipped — corrupting `tourCompletionMap`, the Learning-center badges, and `getNextTourId`'s "skip finished work" logic.
- **Root cause**: the most behavior-rich slice action has zero direct coverage; only its `persistState` side effects are exercised indirectly via the probe tests.
- **Impact**: success-theater in onboarding analytics ("flow_completed" fires for skipped tours) and a broken next-tour nudge that points at work the user actually skipped — erodes the activation funnel.
- **Fix sketch**: using the existing `makeHarness()` pattern: (a) start `getting-started`, complete every step, `advanceTour()` past the end → assert `tourCompleted===true`, `tourCompletionMap['getting-started']===true`, `tourActive===false`; (b) start, complete all-but-last, `advanceTour()` → assert `tourActive===false` AND `tourCompletionMap['getting-started']===false` and the last step is NOT marked complete. Invariant: completion is recorded only when all steps are genuinely done.

## 2. `getNextTourId` sequence/skip logic has no test
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/onboarding/components/tourConstants.ts:118-125 (also getTourSequence 113-115, getStepColors 89-91)
- **Current test state**: none
- **Scenario**: `getNextTourId(currentId, completed)` is a pure function that walks `TOUR_SEQUENCE` from after `currentId`, skipping already-completed tours, and special-cases `getting-started-simple` (starts at index 0). It drives the completion screen's "Up next" card and the auto-roll-into-next-tour CTA in `GuidedTour.tsx`. An off-by-one (e.g. `startIdx` vs `startIdx+1`), a wrong `getting-started-simple` mapping, or forgetting the skip would either re-suggest a finished tour or skip a fresh one.
- **Root cause**: pure ranking/sequence function with branchy logic and a documented special case — exactly the kind that rots silently.
- **Impact**: the cross-sell that walks new users through the product chain breaks — users either get bounced back to finished tours (annoyance/churn) or never discover later tours.
- **Fix sketch**: LLM-generatable table-driven batch. Invariants to assert: (1) returns the next *uncompleted* tour after `currentId`; (2) skips tours marked `true` in `completed`; (3) `getting-started-simple` resolves to index 0's successor; (4) returns `null` when all subsequent tours are complete / `currentId` is last. Don't snapshot — assert the contract.

## 3. `templateRecommendation` scorer/ranker is pure, business-relevant, and untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/onboarding/components/templateRecommendation.ts:64-113
- **Current test state**: none
- **Scenario**: `scoreTemplateMatch` / `rankTemplatesByApprovedApps` decide WHICH starter templates a first-run user sees first, based on the desktop apps they just approved (Docker/Obsidian/Browser). The match is bidirectional substring over tokens pulled from three differently-shaped JSON blobs (`connectors_used`, `design_result.suggested_connectors`, `persona.connectors`), with a `desktop_` prefix strip and `score = matched/approvedSize`. A regression in tokenization, the prefix strip, or the stable-sort tiebreak would quietly reshuffle recommendations and degrade activation, with zero test to catch it.
- **Root cause**: pure functions handling untrusted/variably-shaped JSON (`parseJsonOrDefault`) with no fixtures.
- **Impact**: the "recommended for you" template ordering — a direct lever on first-run conversion — can break invisibly; malformed `design_result` JSON could also mis-score.
- **Fix sketch**: LLM-generatable. Build minimal `PersonaDesignReview` fixtures. Invariants: (1) `approvedApps` empty → score 0, original order preserved; (2) `desktop_obsidian` matches a template whose token is `Obsidian Vault` and one whose token is `obsidian-memory` (both directions); (3) score = matched/total exactly; (4) higher score sorts first, ties keep original index order (stable); (5) malformed `design_result`/`connectors_used` JSON yields score 0, not a throw. `approvedAppDisplayLabel` empty-stripped fallback is a cheap extra case.

## 4. `ExecutionStep` completion is gated on a per-execution id — the safety logic has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/onboarding/components/ExecutionStep.tsx:48-99
- **Current test state**: none
- **Scenario**: The step listens to the global `execution-complete` Tauri event but must only complete onboarding for the execution IT started (`startedExecId`), explicitly NOT the global `activeExecutionId` — otherwise an unrelated background run that finishes mid-step would auto-finish onboarding. It also handles a non-`completed` terminal status (sets `executionError`, does not call `onComplete`), and a failed `executePersona` (no execId → error, reset `started`). None of this is verified.
- **Root cause**: the component carries real correctness logic (id-correlation + error branches) that reads as a "smoke" UI step but is the gate on the final onboarding milestone.
- **Impact**: a regression that keys completion off the global id would mark new users "onboarded" without ever running their agent (false activation); a regression in the error branch would hang the step with a spinner on a failed run.
- **Fix sketch**: render with mocked `useAgentStore` + mocked `@tauri-apps/api/event` `listen`. Assert: (1) emitting `execution-complete` for a DIFFERENT execution_id does NOT call `onComplete`; (2) same id + status `completed` → `onComplete` called once; (3) same id + status `failed` → error shown, `onComplete` NOT called; (4) `executePersona` resolving null → `execution_failed` message + run button returns. (The cancelled-flag listener-leak guard is a bonus assertion.)

## 5. `useOnboardingState` template-load + adoption-dedupe branches are untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/onboarding/components/useOnboardingState.ts:169-258 (template load 169-219; adopt dedupe 244-258)
- **Current test state**: none
- **Scenario**: Two pieces of real logic. (a) The template loader has a trending→fallback chain with four observable phases (`loading|loaded|empty|error`): `error` only when BOTH calls reject, `empty` when both succeed but return nothing. (b) `handleNextFromPick` dedupes rapid double-clicks (same reviewId within 1s, or while `isAdopting`/`showAdoptionWizard`) so a double-click can't open two adoption wizards or adopt twice. A regression in the dedupe could create duplicate personas; a regression in the phase logic shows a dead disabled button with no Retry.
- **Root cause**: a hook with async fan-out and a time-based dedupe ref — moderate to set up, so it was skipped.
- **Impact**: duplicate-persona creation on impatient clicks; first-run users on flaky networks stuck with no recoverable error state.
- **Fix sketch**: `renderHook` with mocked `getTrendingTemplates`/`listDesignReviews`. Assert phase transitions for: both-empty→`empty`, both-reject→`error`, trending-empty+fallback-ok→`loaded` source `fallback`. For dedupe: fire `handleNextFromPick` twice within 1s for the same review → `setShowAdoptionWizard`/`completeOnboardingStep` invoked once. Invariant: at most one adoption per selection per second.

## 6. `onboardingSlice` persistence + completion-guard actions untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/stores/slices/system/onboardingSlice.ts:143-219 (startOnboarding guard 143-155; finish/dismiss/resume persistence)
- **Current test state**: none
- **Scenario**: `startOnboarding` must NOT start if `onboardingCompleted` OR the user already has personas (storeBus); `finishOnboarding`/`dismissOnboarding`/`reopenOnboarding` write `onboarding-state-v1` to localStorage so a Tauri webview reload doesn't re-prompt a completed user or lose a dismissed user's resume point; `resumeOnboarding` is a no-op when completed or never-dismissed. `isOnboardingStep` validates persisted state on hydrate. None tested.
- **Root cause**: slice shipped without the unit coverage its sibling `tourSlice` has.
- **Impact**: a regression re-prompts already-onboarded users on every restart (annoyance, support load) or strands a dismissed user with no way to resume — a first-run experience defect.
- **Fix sketch**: harness like `tourSlice.test.ts`. Assert: `startOnboarding` short-circuits when completed/has-personas; `finishOnboarding` writes `{completed:true}` to `onboarding-state-v1`; `dismissOnboarding` records `dismissedAtStep`; `resumeOnboarding` no-ops without a dismissed step; `isOnboardingStep` accepts valid ids and rejects junk (validates the hydrate trust boundary).

## 7. `setHighlightTestId` selector-injection guard verified only indirectly
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src/stores/slices/system/tourSlice.ts:1521-1536 (+ isSafeTourTestId 174-176, TOUR_TEST_ID_PATTERN 171)
- **Current test state**: none for this path
- **Scenario**: `setHighlightTestId` is a trust boundary: it rejects any testid not matching `/^[a-zA-Z0-9_-]+$/` before it gets interpolated into `document.querySelector(\`[data-testid="${id}"]\`)` in `TourSpotlight`. A templated id containing a quote/bracket (e.g. a persona named `Joe "rocket" Smith`) would otherwise throw `SyntaxError` and kill the spotlight for the rest of the session. The pattern + guard are written defensively but nothing asserts they actually reject bad input.
- **Root cause**: validator added for a real crash scenario but never pinned by a test; a future "loosen the regex" change would re-open it silently.
- **Impact**: low-frequency but session-breaking spotlight crash; the guard is the single line standing between a templated id and a `querySelector` SyntaxError.
- **Fix sketch**: pure-function batch on `isSafeTourTestId` (accepts `agent-intent-input`, rejects `a"]`, `a b`, `''`, `null`) plus one slice test: `setHighlightTestId('bad"id')` → state stays `null`; valid id → state set. Invariant: only `[A-Za-z0-9_-]+` ever reaches state.

## 8. `recordCredentialInteraction` threshold + idempotency untested
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/stores/slices/system/tourSlice.ts:1542-1566
- **Current test state**: none
- **Scenario**: This emits `tour:credentials-explored` once the user has browsed ≥2 distinct categories AND viewed ≥1 connector, and dedupes categories (same category twice shouldn't double-count). It also drives sub-step auto-advance for the `credentials-intro` step. A regression in the threshold or the `includes` dedupe would either complete the credentials step too early (theater) or never (user stuck).
- **Root cause**: minor counting/threshold logic, low blast radius but easy to get wrong.
- **Impact**: the credentials tour step completes dishonestly or hangs — a single-step UX annoyance, not a data/revenue risk.
- **Fix sketch**: LLM-generatable on the harness. Assert: recording the same category twice keeps `categoriesBrowsed.length===1`; reaching 2 categories + 1 connector emits `tour:credentials-explored` exactly once (and only while that step is current). Invariant: event fires once, only when both thresholds are met.
