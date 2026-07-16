# Build Sessions & PersonaMatrix — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Test-lifecycle store actions write to the *active* session, corrupting a different draft in multi-draft mode
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:999-1073 (and caller src/features/agents/components/matrix/useLifecycle.ts:112-158)
- **Scenario**: User starts a tool test on draft A (`handleStartTest` → long-running `testBuildDraft`, real API calls plus the backend's up-to-3s agent_ir retry), then switches to draft B via `setActiveBuildSession` (multi-draft is an explicit feature — mod.rs even documents "multiple concurrent active sessions", and the Quick Answer popover answers backgrounded sessions). When the test resolves, `setToolTestResults`, `setTestSummary`, `setTestConnectors`, and `handleTestComplete`/`handleTestFailed` all call `updateSessionInState(state, null, …)` — i.e. whatever session is active *now*.
- **Root cause**: Backend build events carry `session_id` and are routed correctly, but the entire test-lifecycle action family is hardwired to the active session (`sessionId: null` fallback in `updateSessionInState`), assuming the user never changes drafts during an async test. The slice already has the correct pattern (`applyPendingAnswers` takes an explicit `sessionId`) — the test actions just don't use it.
- **Impact**: Draft B's phase flips to `test_complete` with `testPassed: true` and another draft's tool results attached — the UI now offers to promote a draft that was never tested. Meanwhile draft A is stranded in `testing` in the store (backend DB says `test_complete`), so its UI never unblocks until a rehydrate.
- **Fix sketch**: Capture `sessionId` in `useLifecycle.handleStartTest` (it already reads it for the invoke) and thread it through session-targeted variants of the test actions (`updateSessionInState(state, sessionId, …)`), mirroring `applyPendingAnswers`.

## 2. `promote_build_draft` has no atomic phase claim — concurrent promotes double-insert triggers, tools, and subscriptions
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/design/build_sessions.rs:2550-2847
- **Scenario**: Two `promote_build_draft` calls race for the same session — e.g. a double-click on Promote, or the one-shot auto-promote / BuildWatcher / headless build-mcp surface firing while the user promotes from the UI. Both read the session, both pass `validate_transition(BuildPhase::Promoted)` against the still-`test_complete` row, and both run the full promote transaction.
- **Root cause**: Phase is the mutual-exclusion token but it is read-checked and then written unconditionally (`UPDATE build_sessions SET phase = 'promoted' WHERE id = ?` at line 2838 has no `AND phase IN (…)` guard). This is *exactly* the race that `test_build_draft` fixed with a compare-and-set claim (lines 754-771, with a comment explaining why) — the promote path never got the same treatment, and it is far more destructive because its transaction inserts rows.
- **Impact**: Duplicate `persona_triggers` (two live schedules → double executions/cost), duplicate event subscriptions (every event handled twice), duplicate tool definitions/version snapshots, and two verification runs. The transaction makes each promote internally atomic but does nothing about two promotes.
- **Fix sketch**: Claim the session first with a conditional `UPDATE build_sessions SET phase='promoting' WHERE id=? AND phase IN ('test_complete','draft_ready')` and bail with a validation error when 0 rows are affected (same pattern as test_build_draft's CAS); revert on failure.

## 3. `resetBuildSession` promotes another persona's draft to active — the cross-persona swap `removeBuildSession` was explicitly fixed to prevent
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:1280-1298 (vs. the fixed path at 622-640 and the warning at 468-475)
- **Scenario**: User has a background draft session for persona B and an active draft for persona A. They hit the reset/"start over" action on persona A's build. `resetBuildSession` removes the active session and calls `pickNextActiveSessionId(rest)` **without** `preferPersonaId`, so persona B's newest session becomes active and its state is mirrored into every scalar the editor reads.
- **Root cause**: `pickNextActiveSessionId`'s doc comment spells out the hazard ("removing one persona's failed session could flip the active editor to a different persona's draft… the user would silently see another persona's UI swap in") and `removeBuildSession` passes `removed?.personaId` accordingly — but the sibling `resetBuildSession` path was left unscoped.
- **Impact**: After a reset, the build surface silently displays a different persona's draft (cells, questions, draft IR, test state). Any subsequent active-session action — answering a question, `patchActiveSession`, starting a test — mutates the wrong persona's build.
- **Fix sketch**: Capture the removed session's `personaId` and call `pickNextActiveSessionId(rest, removedPersonaId)`; clear active state (null) when no same-persona session remains, exactly as `removeBuildSession` does.

## 4. Pre-session workflow import is wiped by `createBuildSession`, so a retry after a failed launch silently builds without the imported workflow
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:584-601 (with 1140-1160; consumer src/features/agents/components/matrix/UnifiedBuildEntry.tsx:513-522, 655)
- **Scenario**: User imports an n8n workflow before any session exists — `setWorkflowImport` stores it in the top-level scalars only (no active session). They click Launch: `handleLaunch` reads `buildWorkflowJson` from the scalars and passes it to the backend, then `createBuildSession(personaId, sessionId)` creates an **empty** session and mirrors it over the scalars — `buildWorkflowJson/Name/Platform` all become `null` and the pending import is transferred nowhere. If the build then fails (CLI unavailable, cancel, error phase) and the user relaunches from the same screen, `handleLaunch` now reads `null` and starts a plain intent build — the imported workflow is silently dropped, and the intent may even degrade to empty since the `Import and transform: <name>` fallback also relied on `buildWorkflowName`.
- **Root cause**: The scalar mirror is treated as pure projection, but `setWorkflowImport` uses it as a real pre-session staging area. `hydrateBuildSession` carries the staged import into the session (lines 1428-1432) — `createBuildSession`, the actual launch path (useBuildSession.ts:387), does not.
- **Impact**: `hasWorkflowImport` UI indicator vanishes the instant a build starts, and retry-after-failure loses the user's uploaded workflow with no feedback.
- **Fix sketch**: In `createBuildSession`, seed the new session's `workflowJson/parserResultJson/workflowName/workflowPlatform` from the top-level scalars when they are non-null (same carry-over `hydrateBuildSession` already performs).

## 5. Build progress bar is non-monotonic: `session_status` events reset percent-driven progress to 0
- **Severity**: Low
- **Category**: ui
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:763-783 (interaction with 740-752)
- **Scenario**: During a build, `handleBuildProgress` advances `progress` from the runner's `percent` payloads (e.g. 40%). Then any `session_status` event arrives — a phase flip to `awaiting_input`, or an early status where `total_count` is 0 — and `handleBuildSessionStatus` unconditionally recomputes `progress = total_count > 0 ? resolved/total*100 : 0`, snapping the bar back to 0 (or to a lower resolved-cell ratio than the percent stream had reached).
- **Root cause**: Two independent progress sources (streamed percent vs. resolved-cell ratio) write the same field with last-writer-wins semantics and no monotonicity guard; the `total_count == 0` branch actively zeroes instead of preserving.
- **Impact**: The progress bar visibly jumps backwards / resets mid-build — a classic trust-eroding polish defect, especially at the awaiting-input transition where users are already being asked to intervene.
- **Fix sketch**: In `handleBuildSessionStatus`, skip the progress write when `total_count === 0`, and otherwise apply `Math.max(sess.progress, computed)` (allowing an explicit reset only on session create/reset).
