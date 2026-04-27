# Bug Hunt — Agent Lab & Matrix Builder

> Total: 13 | Critical: 2 | High: 6 | Medium: 4 | Low: 1

## 1. setState during render in `useGenomeBreeding` causes infinite loop / cross-component update warnings

- **Severity**: critical
- **Category**: latent-failure
- **File**: `src/features/agents/sub_lab/components/genome/useGenomeBreeding.ts:78`
- **Scenario**: Any time `GenomeBreedingPanel` mounts. The body of `useGenomeBreeding` contains the bare line `if (!hasLoadedRuns) { loadRuns(); }` — outside any `useEffect`/`useMemo`. `loadRuns` is async but it kicks off a `setRuns(data); setHasLoadedRuns(true);` chain that re-renders the consumer, while React 19 strict mode also re-invokes the function body twice on mount.
- **Root cause**: The author assumed a "fire once" guard in render is safe because `hasLoadedRuns` flips after the first load. But `loadRuns()` is not awaited, and React may render the component again before the async callback runs (e.g. if any other state updates land), re-triggering the call. More importantly, this violates the rules of hooks — Suspense, error boundaries, and StrictMode will all double-invoke render and double-fetch. On a network glitch the panel can stutter into a fetch storm.
- **Impact**: Duplicate API calls to `genomeApi.listBreedingRuns` on every mount in dev mode (StrictMode); risk of state updates between unrelated renders triggering "Cannot update component while rendering" warnings; in low-bandwidth scenarios users see flickering "loading" → "loaded" → "loading" because each render restarts the fetch before the previous one sets state.
- **Fix sketch**: Wrap in `useEffect(() => { if (!hasLoadedRuns) loadRuns(); }, [hasLoadedRuns, loadRuns])`.

## 2. `setDraftPersonaId(null)` always clears the active build session, including when called with a non-null id

- **Severity**: critical
- **Category**: state-corruption
- **File**: `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:96-109`
- **Scenario**: User completes a build, the auto-redirect calls `setDraftPersonaId(null)` to clean up. Then in `handleLaunch` (line 307) we immediately call `setDraftPersonaId(personaId)` for a new build — and the function silently does NOTHING for non-null IDs (the comment admits "For non-null id: no-op"). However, `draftPersonaId` is also derived from `useAgentStore((s) => s.buildPersonaId)`, so the new id only appears AFTER `createBuildSession` fires inside `handleGenerate`. Between line 307 and the session creation, `draftPersonaId` is still `null`, but `personaId` is the new ID, so `personaId` is passed to `handleGenerate` directly. That works. BUT in the failure-rollback path at line 344, `await deletePersona(personaId)` runs and then `setDraftPersonaId(null)` runs — which calls `resetBuildSession()` which removes whatever the active session is. If the user had a SECOND draft running concurrently in another window or if a hydration restored an old session, that gets nuked too because `resetBuildSession` always pops the active session.
- **Root cause**: `setDraftPersonaId` was renamed to be a half-stubbed wrapper around `resetBuildSession`. The semantic mismatch means callers think they're clearing local UI state but they're actually mutating the global store. Naming hides intent.
- **Impact**: A failed `handleLaunch` for persona A while persona B is the active session destroys persona B's in-progress build (cellStates, pendingQuestions, draft, all of it). Not recoverable without hydration round-trip.
- **Fix sketch**: Make `setDraftPersonaId(null)` only clear the session matching the local `personaId` (`removeBuildSession(personaId)` instead of unconditional reset), or require the caller to pass which session to clear.

## 3. Auto-test guard `autoTestedRef` keyed by `draftPersonaId` re-fires across phases

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:179-199`
- **Scenario**: Build reaches `draft_ready`, no pending questions → auto-test fires, ref set to personaId. Lifecycle moves to `testing` → `test_complete`. User clicks "Refine" which triggers a new round. A new pending question shows up briefly → `autoTestedRef.current = null` (line 182). User answers the question → `pendingQuestions` empties → phase returns to `draft_ready` → guard is null → auto-test fires AGAIN. Now the user is mid-edit and a paid test fires unbidden.
- **Root cause**: The "reset on new pending question" rule assumes any pending-question round means the user wants a fresh test cycle, but refinements (which transit through awaiting_input) shouldn't necessarily restart testing. There's no debounce between auto-tests.
- **Impact**: Wasted credits/cost from CLI tool tests, repeated network calls, user confusion about whether the second test reflects their refinement or not.
- **Fix sketch**: Use a monotonic counter that increments only on phase transition `draft_ready → ...` rather than resetting on pending-questions; also gate on `buildEditDirty` so we don't auto-test mid-edit.

## 4. Auto-submit answers race condition swallows fresh user input

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:211-232`
- **Scenario**: User has 3 questions queued. They answer #1 → `pendingQuestions` length drops to 2. They start typing answer to #2 in the input field. Meanwhile the LLM emits a follow-up question that briefly clears, then re-fills `pendingQuestions`. The 250ms debounce timer on auto-submit fires for the brief empty window — `handleSubmitAnswers` runs, sending only answer #1 to the CLI. The user's in-progress typing for #2 is now associated with a stale question that may have been replaced.
- **Root cause**: The condition `pendingQuestions.length === 0 && pendingAnswerCount > 0` is evaluated at submit time, but answers that arrive during the 250ms window are not waited for. There's no "user is typing" signal to defer the submit.
- **Impact**: Partial answer batches sent; CLI may continue with insufficient context; user-typed answers can be silently sent against the wrong question or wiped from `pendingAnswers` after submit.
- **Fix sketch**: Track the `pendingAnswerCount` at the time the timer was scheduled and only submit if the count is unchanged; or extend the debounce to 800ms+ and clear it on any input change.

## 5. `markSessionInactive` on hook unmount can silence the still-active Channel

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/hooks/build/useBuildSession.ts:448-462`
- **Scenario**: Two `UnifiedMatrixEntry` instances mount with the same `personaId` (e.g., a hidden tab + visible tab, or a deep-link race). The second one mounts AFTER the first started a session, hydrates and assigns `sessionIdRef.current = session.id` for the SAME sessionId. Then the second one unmounts. Its cleanup calls `markSessionInactive(sessionIdRef.current)` — which removes the session from the active set — even though the first hook still owns the live Channel. EventBridge then starts double-processing events for the still-active session.
- **Root cause**: The active-set is keyed by sessionId only, not by hook-instance. Multiple hooks can register the same id but unregistering is destructive. The header comment claims this fixes a bug but the multi-instance case (same id, two hooks) re-introduces it.
- **Impact**: Duplicate cell updates / questions in the store after a transient unmount of any sibling matrix surface; user sees question prompts twice; cell state can flap between resolved values.
- **Fix sketch**: Reference-count the registry: `Map<sessionId, number>` incremented on `markSessionActive` and decremented on `markSessionInactive`, only removing when count hits 0.

## 6. Build cancel does not stop the in-flight `startSession` promise; race produces a zombie session

- **Severity**: high
- **Category**: race-condition
- **File**: `src/hooks/build/useBuildSession.ts:289-332` + `390-416`
- **Scenario**: User clicks "Build", `runStart` begins (`await startBuildSession`), takes ~400ms. User clicks "Cancel" before it returns. `cancelSession` sets `sessionIdRef.current = null`, bumps `generationRef`, clears `startPromiseRef.current = null`. Then `runStart` resolves with the new sessionId, calls `markSessionActive(sessionId)`, sets `channelRef.current = channel`, sets `sessionIdRef.current = sessionId`, and calls `createBuildSession`. A backend session was started AND is now reflected as the active session — but the UI thinks it cancelled. The user has no visible cancel button for a session they don't know exists.
- **Root cause**: `cancelSession` doesn't await/reject the in-flight promise or check whether `runStart` has completed when it runs. The "active session id" semantic relies on the ref being assigned strictly before any cancel can land.
- **Impact**: Orphan backend session continues consuming CLI/LLM resources; UI shows no session; user must reload to even see it. A `cancelBuildSession` is sent for a `null` sessionId so the backend never gets the signal.
- **Fix sketch**: Track an `isCancelled` flag captured by `runStart` and check before assigning refs / calling `createBuildSession`; if cancelled, immediately call `cancelBuildSession(sessionId)` for cleanup.

## 7. `escapeAnswer` does not escape the `]:` colon delimiter — payload injection still possible

- **Severity**: high
- **Category**: validation-gap
- **File**: `src/hooks/build/useBuildSession.ts:372-380`
- **Scenario**: User answers `[messages]: yes` to one question. The answer is wrapped as `[messages]: [messages]: yes`. The escape only mangles `\\`, newlines, and `[`. Backend parses each line as `[<key>]: <value>` — if user's answer text begins with `]: ` or includes such patterns post-escape, the parser sees two delimiters on one line and the value or key boundary becomes ambiguous. More concretely: escape `\[` works, but the closing `]` is unescaped — so `[my answer]: yes` arrives as `[messages]: \[my answer]: yes`. Depending on how the Rust parser splits on the FIRST `]:` vs the LAST, the answer could be truncated or merged.
- **Root cause**: Asymmetric escaping — only the opening bracket is escaped. The protocol assumes balanced brackets but doesn't enforce it.
- **Impact**: User-pasted text containing `]:` can corrupt batch answer submission; one user's answer can overwrite/extend another's; in pathological cases the CLI may receive a malformed dimension key.
- **Fix sketch**: Escape `]` as well, OR base64-encode each answer body and have the backend decode.

## 8. `handleViewPromotedAgent` setTimeout fires after unmount → calls `setIntentText`/`setAgentName` on dead component

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:127-152`
- **Scenario**: Build reaches `promoted` phase, the auto-redirect timer (line 159) schedules `handleViewPromotedAgent` after 1500ms. Halfway through that, user navigates away and `UnifiedMatrixEntry` unmounts. 1500ms passes, the outer setTimeout from line 159 still has a stable reference to the captured `handleViewPromotedAgent`, calls it. Inside, `setFadeOut(true)` is fine (no-op in React 19), then a 400ms setTimeout schedules — when it fires, `setIntentText('')`, `setAgentName('')`, `setDraftPersonaId(null)` (which calls `resetBuildSession()`) all run. The store mutations destroy build state for whatever session is now active.
- **Root cause**: The outer `useEffect` at line 156 returns a cleanup that clears the 1500ms timer, but the INNER 400ms timer inside `handleViewPromotedAgent` has no cleanup hook. Plus the closure escape: `resetBuildSession()` is global state.
- **Impact**: Navigating away during the post-promotion fade can wipe a freshly-started session in another tab/screen; intermittent loss of build state with no error surfaced.
- **Fix sketch**: Track the inner timer in a ref and clear it on unmount; gate store mutations on a "still mounted" check.

## 9. `handleSwapConnector` and `handleRecalculate` race: setRecalculating(false) without try/finally

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/components/matrix/ConnectorsCellContent.tsx:63-103`
- **Scenario**: User clicks Swap. `setRecalculating(true)`, `setSwappingConnector(null)` runs synchronously. `await answerBuildQuestion(...)` is called inside try/catch. If a non-Error throws (string, undefined), or if the await Tauri bridge throws unexpectedly outside the catch (e.g. component unmount before resolution), the `setRecalculating(false)` at line 79 still runs (it's after the catch). BUT for `handleRecalculate` (line 95), `setRecalculating(false)` is OUTSIDE both try and catch — if `useAgentStore.getState()` throws or any sync work between try and the final setter throws, the spinner is stuck forever.
- **Root cause**: Inconsistent finally-handling between two near-identical flows. No `try/finally` enforces the loading-state reset.
- **Impact**: Spinner can hang permanently after a failed recalculate — UI claims "rebuilding" with no recovery; user must reload page.
- **Fix sketch**: Use `try/finally` to always clear `recalculating`, and check `mountedRef` before calling setters.

## 10. `parseJsonOrDefault` swallows errors but `JSON.parse` of cell_update.data eats and silently drops user data

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:566-575` and `549-563`
- **Scenario**: Backend emits a `cell_update` event whose `data` field is a string but malformed JSON (e.g. truncated due to a Channel buffer issue, or contains an unescaped quote from a model hallucination). The `try { JSON.parse(...) } catch {}` swallows the error silently. `cellData[event.cell_key]` is NOT updated. The UI displays whatever the previous resolved value was. The cell's `cellStates[event.cell_key]` IS updated, however — so visually the cell flips to "resolved" but with stale data. No log, no toast.
- **Root cause**: The catch is empty (`/* ignore parse errors */`). The status update path (line 581) is independent of the data-parse success.
- **Impact**: User sees a "resolved" cell whose contents secretly belong to a previous round. Decisions made on that cell (promote, edit) operate on phantom data. Hardest possible bug to reproduce because the visible state is plausible.
- **Fix sketch**: Log parse failures with `console.warn`, mark the cell `error` instead of `resolved`, and store the raw text so debug tools can inspect.

## 11. `pickNextActiveSessionId` promotion silently swaps drafts the user did not ask to switch to

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:524-536` and `1150-1168`
- **Scenario**: User has Drafts A (active), B, C. They click "Cancel" on Draft A. `resetBuildSession()` removes A and promotes the newest of {B, C} to active — say C. The UI now shows C's matrix without an explicit user click. C's cellStates, behaviorCore, mission text — all of it appears as if the user just cancelled INTO C. The user thinks Cancel-A means "go back to no draft", not "switch to C".
- **Root cause**: The newest-first auto-promotion policy was added for legacy compatibility (selectors expected scalar mirrors to always reflect a session), but it conflicts with what users expect from a Cancel button. There's no "deselect" path.
- **Impact**: User perceives data loss / mystery state. They may think Cancel destroyed all their work, or worse, edit C thinking it's A. Promotes can land on the wrong persona.
- **Fix sketch**: When the user explicitly cancels via UI, set `activeBuildSessionId = null` (let UI render an empty state). Reserve auto-promotion for non-user-initiated removes only.

## 12. `addCapabilityDraft` / `handleCapabilityResolutionUpdate` race can lose user-added capabilities

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:837-862` + `710-745`
- **Scenario**: User clicks "Add capability" → `addCapabilityDraft({id: 'foo', ...})` adds 'foo' to capabilities map. A few hundred ms later, the LLM emits `capability_enumeration_update` with its own list NOT including 'foo'. The handler walks `payload.capabilities`, only adds new ones (skips existing keys), but for any existing capability id it MERGES title/summary from the LLM payload. 'foo' is preserved. BUT — if the LLM happens to emit an id like 'foo' (collision), the merge clobbers the user's draft title/summary with the LLM's. There's no "user-edited" flag, no provenance.
- **Root cause**: The slice trusts the LLM to never produce ids that collide with manual ones. With auto-generated ids like `cap_${index}` or kebab-cased titles, a clever user is likely to clash.
- **Impact**: User's manual capability work is silently overwritten by the next LLM enumeration round; the user only notices if they re-read the title carefully.
- **Fix sketch**: Mark user-added capabilities with `_userEdited: true` and skip them in the merge step, or namespace user ids (e.g. prefix with `user_`).

## 13. `handleStart` in MatrixPanel resets `instruction` even when `startMatrix` returns no runId (failure)

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/features/agents/sub_lab/components/matrix/MatrixPanel.tsx:36-42`
- **Scenario**: User types a long matrix instruction, clicks "Generate". `startMatrix` returns null/undefined (network failure, validation error, missing prompt). The `if (runId)` branch is false → `setInstruction('')` does NOT run, so the field is preserved. Wait — actually, the code only clears on success, which is correct. BUT in the failure case the user gets NO feedback (no toast, no error inline) and no indication that it failed. They click again, get the same silent failure, type a new instruction, click again.
- **Root cause**: `startMatrix` failure path is a quiet null return rather than a thrown error or a status update visible in `isLabRunning`. The button just sits there.
- **Impact**: User is stuck in a failure loop with no visible error — they may abandon the feature thinking it doesn't work.
- **Fix sketch**: Check the `isLabRunning` slice for an error field, OR have `startMatrix` throw and wrap in try/catch to surface a toast.
