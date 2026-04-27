# Bug Hunt — Persona Templates Catalog

> Total: 14 | Critical: 2 | High: 6 | Medium: 5 | Low: 1

## 1. Adoption "draft persona" leaks if `create_adoption_session` invoke fails

- **Severity**: critical
- **Category**: latent-failure
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:793-863`
- **Scenario**: `seedDone.current` is set to `true` on line 759 BEFORE the async IIFE runs `createPersona()` and then `invokeWithTimeout("create_adoption_session", ...)`. If `createPersona` succeeds but `create_adoption_session` (or `hydrateBuildSession`) throws (network blip, Tauri timeout, JSON-too-large error), the catch on 860 only logs. The user is now staring at the stale "Loading template…" placeholder with `seeded === false` and `seedDone === true`, so the effect won't retry. A draft persona row exists in the DB with no associated build session and no UI affordance to delete it.
- **Root cause**: the seed-once guard is set before the async path completes, with no rollback in the catch.
- **Impact**: orphaned draft persona in user's DB on every transient backend failure; UI is permanently stuck at "Loading template…" until the modal is reopened.
- **Fix sketch**: move `seedDone.current = true` into the success branch (or guard with a separate `seedInFlight` ref); on catch, delete the just-created persona and surface an error to the user.

## 2. Background generation race: `genId` keyed by `Date.now()` collides on rapid retries

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/templates/sub_generated/generation/useCreateTemplateActions.ts:45,131`
- **Scenario**: `handleStartGenerate` and `handleApplyAdjustment` both build the genId with ``` `tpl-gen-${Date.now()}` ```. If the user clicks "Retry" or "Apply Adjustment" within the same millisecond as the previous generation (debouncing-prone "double-click", or programmatic retry via `handleRetry` which schedules a `setTimeout(...,100)` but doesn't re-key time), the new genId can equal the old one. The previous snapshot has not been cleared (`clearTemplateGenerateSnapshot` only fires after save), so the polling hook hits a stale "completed" snapshot for what the user thinks is a brand-new run.
- **Root cause**: no monotonic / random suffix on the genId; `Date.now()` resolution is not unique.
- **Impact**: stale draft is shown as the "result" of a generation the user thinks is in flight; a backend that's still running burns tokens for output the UI ignores; "completed-then-stuck" UX.
- **Fix sketch**: use ``` `tpl-gen-${Date.now()}-${crypto.randomUUID()}` ``` (or a counter) and clear the previous snapshot before issuing the new request.

## 3. `useAdoptionCompletionNotifier` reads stale `localStorage` adoptId across users/sessions

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/templates/sub_generated/gallery/cards/useAdoptionCompletionNotifier.ts:9,28-50`
- **Scenario**: `ADOPT_CONTEXT_KEY = 'template-adopt-context-v1'` is a single global localStorage entry. If a user starts adoption A, closes the modal, switches profile/account or simply opens a different template, the legacy entry is still there. The notifier polls the OLD adoptId every 5s. When that backend snapshot eventually returns `completed`/`failed`, the user sees a notification claiming THIS template is ready, but the actual session is for a different one. `notifiedRef` is in-memory so it doesn't persist across reload — every reload re-fires a stale notification.
- **Root cause**: notifier never clears its own localStorage entry, and it doesn't validate the adoptId is still active server-side before notifying.
- **Impact**: misleading OS notifications referencing the wrong template; "Persona Ready" toast for a persona that was never created (or was deleted); cross-context confusion.
- **Fix sketch**: validate the snapshot's templateName/personaId matches what the notifier expected; clear the localStorage entry once notified; tie the entry to a session/account id.

## 4. Adoption snapshot polling can NOT distinguish stale from missing — silent "no result"

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/templates/sub_generated/gallery/cards/useAdoptionCompletionNotifier.ts:36-50`
- **Scenario**: `getTemplateAdoptSnapshot(adoptId)` is called with a possibly-stale id from localStorage. If the backend has GC'd the snapshot (Tauri restart, in-memory cache eviction, missing globalThis singleton across HMR), the call may resolve with `status: 'idle'` (default) or throw. The catch on line 51 silently swallows the error — no telemetry, no user feedback, polling continues forever.
- **Root cause**: empty catch block means any deserialization failure or backend "session lost" condition is invisible.
- **Impact**: polling burns CPU on a dead session indefinitely; the user never learns adoption silently succeeded server-side because the notifier failed to read the snapshot.
- **Fix sketch**: distinguish 'not-found' from network errors; after N consecutive failures, clear the localStorage entry and stop polling.

## 5. `extractDimensionData` swallows malformed `structured_prompt.errorHandling` line indexing

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:165-191`
- **Scenario**: The parser at line 170-187 mutates `i` inside the loop to consume continuation lines (line 178-181), then the outer `for (let i = 0; ...; i++)` re-increments it. If the template author writes `errorHandling` as a single line of `**Header**: long sentence.` with no follow-on, the inner while is skipped (good), but for `**A**\nA description\n**B**` the inner while consumes `A description`, but then i++ skips `**B**`. Some headers will be quietly lost.
- **Root cause**: dual-incrementing `i` without invariant checks; brittle hand-rolled state machine.
- **Impact**: error-handling matrix cell shows incomplete data; user adopts thinking they have full coverage when sections are silently dropped. Doesn't crash.
- **Fix sketch**: switch to an explicit cursor + `while (cursor < lines.length)`; never share the iterator with a child loop.

## 6. `applyTriggerSelections` silently drops triggers when a use-case has no `id`

- **Severity**: high
- **Category**: validation-gap
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:330-358`
- **Scenario**: `String(uc.id ?? "")` produces `""` when the template author omitted `id` on a use_case object. `perUseCase[""]` is then looked up — if any other use_case also has a missing id, they share the same key. The second call to `triggerSelectionToTriggers(sel)` will re-emit the SAME selection for both, and the rebuild on lines 346-358 produces duplicated `{...trig, use_case_id: ""}` entries that the runtime scheduler will register twice.
- **Root cause**: empty-string id treated as a valid map key; no validation that template authors set ids.
- **Impact**: duplicate triggers fire on adopted personas built from older templates; downstream scheduler may register the cron multiple times; events fire 2× per tick.
- **Fix sketch**: skip use_cases whose id is empty when building the suggestedTriggers list, and warn-log; require id validation upstream.

## 7. `inferSelectionFromCron` mishandles dow=0 due to falsy check

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:209-225`
- **Scenario**: For a cron `0 9 * * 0` (weekly Sunday 9am), `parts[4]` is `"0"`. Line 220 uses `parseInt(dow ?? "", 10)` → `0`, then checks `!Number.isNaN(dowNum)` (true) and returns `{ time: { preset: "weekly", hourOfDay: 9, weekday: 0 } }`. That's actually correct — but cron `0 9 * * *` (line 218) will bypass the dow numeric check and return daily, which is right. The issue: cron expressions with an hour of `*` and dom `*` are NOT classified as anything (line 213 only matches `0 * * * *`); a perfectly valid cron like `15 * * * *` (every hour at :15) collapses to `customCron`, then never round-trips into the user's hourly preset. Templates authored with offsets get hidden behind "custom cron" which the UI never exposes (per useCasePickerShared.ts line 19 "intentionally NOT exposed in the UI").
- **Root cause**: parser only recognizes 3 exact shapes; anything else becomes hidden customCron.
- **Impact**: user sees "Manual" as the selection on the picker (since customCron→Manual radio), unaware the template ships a real schedule. After adoption it fires on the cron they never confirmed.
- **Fix sketch**: surface customCron as a visible "Custom: <cron>" radio so the user can keep, edit, or replace it.

## 8. `clearPersistedContext` nukes context even on save failure when `state.saved` is false

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/templates/sub_generated/generation/useCreateTemplateActions.ts:153-162`
- **Scenario**: `handleClose` returns and clears localStorage when `!state.saved`. After a generation completes but the user has unsaved edits in the review step, closing the modal wipes the persisted context. If the user reopens later expecting to resume, the genId is gone — the background snapshot link is severed and the draft is lost. Even worse, the actual backend snapshot is NOT cancelled, so a "completed" run lingers in memory.
- **Root cause**: `saved` is the only signal; doesn't distinguish "user has typed adjustments but hasn't saved" vs "user gave up".
- **Impact**: silent loss of generation work; orphaned background snapshots in Tauri memory.
- **Fix sketch**: confirm-on-close when `state.draft && !state.saved`; or persist the draft itself, not just the genId.

## 9. `handleRetry` uses `setTimeout(100)` to sequence reset → start, no abort if user closes mid-delay

- **Severity**: low
- **Category**: race-condition
- **File**: `src/features/templates/sub_generated/generation/useCreateTemplateActions.ts:74-80`
- **Scenario**: `handleRetry` calls `generateCancelled()`, `clearPersistedContext()`, then `setTimeout(() => handleStartGenerate(), 100)`. If the user closes the modal during the 100ms gap, `handleStartGenerate` still fires — issuing a new background invoke that no one is listening to. Snapshot eventually completes and lingers.
- **Root cause**: untracked timer; no cleanup ref.
- **Impact**: ghost backend job; memory leak in Tauri snapshot map.
- **Fix sketch**: store the timer in a ref, clear it on close; or sequence with await rather than setTimeout.

## 10. Adoption answers persist for the WRONG review when reviewId matches but content drifted

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:626-631`
- **Scenario**: `adoptionDraft.reviewId === review.id` is the gate to restore previous answers. If the template was rebuilt or its `adoption_questions` shape changed (new question id, removed option, vault_category renamed), restored answers from the old draft are merged into `adoptionAnswers` but reference question ids that no longer exist. The questionnaire renders with phantom answers that match nothing; in the credentialBindings derivation (line 715-726) `q.options.indexOf(answerMap[q.id]!)` returns -1 silently, but the `if (selectedIdx >= 0 ...)` skips it — so a draft-restored value for a removed option is dropped without telling the user.
- **Root cause**: no schema/version check on the draft; reviewId is treated as a stable content identifier when it's just a row id.
- **Impact**: half-restored questionnaire state; user adopts thinking they answered everything when invisible answers were silently filtered out.
- **Fix sketch**: stamp the draft with a content hash of the questions array; when it differs, prompt the user "Template was updated — restart questionnaire?" instead of silent merge.

## 11. `setAdoptionAnswers((prev) => ({ ...prev, [id]: answer }))` uses a stale-closure id when modal swaps mid-keystroke

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:948-956`
- **Scenario**: `handleCredentialAdded` references `quickAddContext.targetQuestionId`. The capture: it sets `setQuickAddContext(null)` first, then reads `ctx?.targetQuestionId` from a stale local — that part is fine. But `useDynamicQuestionOptions` re-fingerprints on credential additions; between the user clicking save inside the QuickAdd modal and the answer being applied, the questionnaire can re-render with a different `filteredAdoptionQuestions` (from vault re-resolution) that no longer includes the target question. The answer gets stored under an id that's not in the active question set; on submit, the credentialBindings loop on line 715 doesn't see it; the binding never reaches the backend.
- **Root cause**: assumption that the questionnaire shape is stable while the QuickAdd modal is open.
- **Impact**: user sees the credential added and the question auto-filled, then submits and discovers the persona was built without the binding (silent integration failure post-adopt).
- **Fix sketch**: re-validate that targetQuestionId still resolves; if not, surface the new bound option to the user.

## 12. `seedDone` ref doesn't reset when `review` prop changes — re-using the modal sticks to the first template

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx:372,755-864`
- **Scenario**: `seedDone = useRef(false)` is initialized once. If the parent (TemplateModals) keeps `MatrixAdoptionView` mounted and swaps the `review` prop (e.g., user clicks "back to gallery", then clicks adopt on a DIFFERENT template, and AdoptionWizardModal re-uses the component instance because of React reconciliation), the seed effect on line 755 sees `seedDone.current === true` and skips. The matrix renders with stale data from the first review. There IS a `useEffect` resetting `useAgentStore.resetBuildSession()` on `isOpen` change in AdoptionWizardModal, but that doesn't reset MatrixAdoptionView's local refs (`seedDone`, `defaultsLoaded`, `useCasesInitialized`, `scopeAutoFilledRef`).
- **Root cause**: refs are not keyed by `review.id`; modal relies on unmount to reset.
- **Impact**: silent cross-contamination between adoptions; impossible to surface unless the user notices wrong cells.
- **Fix sketch**: reset all refs in a `useEffect([review.id])`, or pass `key={review.id}` from the parent.

## 13. Fingerprint key collision in `useDynamicQuestionOptions` when items.length is 0

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts:137-139,198-200`
- **Scenario**: For source=vault, `fingerprint = vault|${category}|${requiresResource ?? '*'}|${items.map(...).join(',')}`. When the user has zero matching credentials, items is `[]` and fingerprint ends with empty string. After they add a credential, the matcher recomputes; if the new credential is filtered out (e.g., scope-required but no scope picked), items is still `[]` — same fingerprint. The effect short-circuits on line 199 (`continue`) and the error message stays "No healthy X credential connected" instead of updating to the more useful "Connect a X credential and pick at least one Y" (which would surface only after re-evaluation).
- **Root cause**: fingerprint uses items output, not credential input snapshot, so equivalent-empty results suppress error-message updates.
- **Impact**: user adds a credential, sees no UI change, can't tell what to do next.
- **Fix sketch**: include `credentials.length` and a hash of the relevant credential ids in the fingerprint so input changes always trigger re-eval.

## 14. `parseListMdFormat` skips trailing template if no metadata line follows

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/templates/sub_generated/generation/runner/designRunnerConstants.ts:33-79`
- **Scenario**: Walking with `for (let i = 0; ...)` and incrementing inside the body (`i++` after consuming description, `i++` after consuming meta) is fragile. If the file ends with `**3. Final Template**\nDescription only.` (no Tools/Trigger/Category line), the parser correctly captures it. But if the description line itself starts with `**` (e.g., a markdown bold within), line 48 (`!nextLine.startsWith('**')`) skips it, leaving description empty — the template lands in `parsed` with `instruction: ''`. That `instruction` is what later flows into `instruction.trim().length >= MIN_INSTRUCTION_LENGTH` (50) gate; the user sees the template show up in the batch list but it silently fails the threshold check on submit (line 122 of useDesignRunnerState.ts) — except it's not validated for batch mode, only for "custom" mode (line 134). Empty-instruction templates run through generation and produce garbage.
- **Root cause**: ambiguous line-skip heuristic + missing instruction-length validation in batch mode.
- **Impact**: silently broken batch generations from imported md files; tokens burned on empty instructions.
- **Fix sketch**: validate `instruction.length >= MIN_INSTRUCTION_LENGTH` in `handleStart` for batch mode; show parse warnings inline when description is empty.
