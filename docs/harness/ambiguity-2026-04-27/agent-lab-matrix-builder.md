# Ambiguity Audit — Agent Lab & Matrix Builder

> Total: 12 findings (2 critical, 5 high, 4 medium, 1 low)
> Files read: ~12
> Scope: Multi-draft matrix build orchestration (Zustand slice + hook), v3 capability editors, lab aggregation/report generation, composition DAG utils.

## 1. `setDraftPersonaId` is documented as a setter but is silently a no-op for non-null ids

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:96-109
- **Scenario**: The callback is named `setDraftPersonaId` and takes a `string | null`, but the body only acts when `id === null` (calling `resetBuildSession`). For a non-null id it does nothing — relying on `createBuildSession` happening elsewhere. The function is later called with a non-null id at line 307 (`setDraftPersonaId(personaId)`), where it has zero effect.
- **Root cause**: A vestigial setter from before the multi-draft refactor was kept for API symmetry but its non-null branch was deleted with only an inline comment as documentation. The name implies bidirectional behavior the function does not provide.
- **Impact**: A future contributor reading `setDraftPersonaId(personaId)` at line 307 will reasonably assume the id is now reflected in the store. It is not — `buildPersonaId` only updates after `createBuildSession` resolves. Code added between the setter call and session creation that depends on `buildPersonaId` will read stale state.
- **Fix sketch**:
  - Rename to `clearDraftPersona` and remove the `id` parameter, OR
  - Make the non-null branch actually call `createBuildSession`/`setActiveBuildSession`
  - Remove the call at line 307 if it is genuinely a no-op

## 2. Cell status drift between `'updated'` and `'resolved'` relies on JSON.stringify equality of `items` only

- **Severity**: high
- **Category**: edge-case
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:592-602
- **Scenario**: When a `cell_update` arrives with the same status (`resolved`) as the previous, the slice diffs `items` via `JSON.stringify` to choose between `'resolved'` and `'updated'`. Only `items` is compared — `summary` and the entire `raw` payload are ignored. Two updates that change `summary` or any raw field but keep the same `items` array (e.g. trigger config update, connector metadata refresh) will silently retain `'resolved'` and never animate the "updated" highlight.
- **Root cause**: The diff was written for the legacy 8-dimension matrix where `items` was the only user-visible payload. v3 events carry richer data via `raw`; the comparison was never widened.
- **Impact**: Users miss visual feedback that a dimension has changed. With the auto-test path (UnifiedMatrixEntry.tsx:185-194), an "updated" payload that doesn't change `items` may not even reset autoTestedRef cleanly, masking that a re-test is warranted.
- **Fix sketch**:
  - Compare `summary` and a stable hash of `raw` in addition to `items`
  - Document explicitly which fields participate in the "did it change?" decision
  - Add a unit test for the `summary`-only update case

## 3. `hydrateBuildSession` discards `pendingAnswers`, `testId`, `toolTestResults`, and `clarifyingQuestionV3`

- **Severity**: critical
- **Category**: edge-case
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:1273-1301
- **Scenario**: Hydration starts from `emptySessionState(...)` and overwrites a curated subset of fields. Test lifecycle state (`testId`, `testPassed`, `toolTestResults`, `testSummary`, `testConnectors`), `pendingAnswers`, `clarifyingQuestionV3`, and `editState` flags are silently reset to defaults regardless of what's in the persisted session.
- **Root cause**: `PersistedBuildSession` (buildTypes.ts:249-259) doesn't carry these fields, but `hydrateBuildSession` does not document this is by design — and the v3 refactor added new transient state without revisiting hydration.
- **Impact**: Reload mid-test (page refresh, HMR) silently loses test progress and answered-but-unsubmitted questions. Worst case: a user answers 5 questions, refreshes, sees the questions vanish but no answers actually queued — the CLI is still waiting on input the store no longer has.
- **Fix sketch**:
  - Either persist these fields and rehydrate them, or
  - Document in the slice header that hydration is for "cold restart only — active question/test state is unrecoverable"
  - Add a UI banner if the persisted phase was `awaiting_input`/`testing` so users understand state was lost

## 4. `pickNextActiveSessionId` policy ignores `personaId` — a removed session can promote a draft for a different persona

- **Severity**: critical
- **Category**: requirements-unclear
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:407-420, 524-536
- **Scenario**: When the active session is removed (e.g. failed launch cleanup at UnifiedMatrixEntry.tsx:351-357), `pickNextActiveSessionId` picks the newest remaining session by `createdAt`, with no scoping by `personaId`. If the user has draft sessions for multiple personas open, removing one persona's failed session can flip the active session — and therefore the entire UI mirror — to a draft belonging to a completely different persona.
- **Root cause**: The header (lines 18-25) documents the newest-first rule but is silent on whether it should be scoped to the current persona. The cleanup code at UnifiedMatrixEntry.tsx:346-357 correctly avoids `setDraftPersonaId(null)` for this reason, but it still calls `removeBuildSession`, which can trigger this same swap if the failed session was active.
- **Impact**: A failed build for persona A can silently switch the open editor to persona B's in-progress draft, with no UI breadcrumb. Edits are then made to B while the user thinks they're still working with A.
- **Fix sketch**:
  - Make `pickNextActiveSessionId` accept a `preferPersonaId` and only fall through to other personas when none remain for the preferred one
  - Or: clear `activeBuildSessionId` to null instead of auto-promoting cross-persona, leaving the UI in an empty state until the user explicitly picks
  - Add a test covering "remove A's session while B's draft also exists"

## 5. `MAX_OUTPUT_LINES = 500` and `MAX_TEST_OUTPUT_LINES = 200` — undocumented why they differ

- **Severity**: low
- **Category**: magic-number
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:251-252
- **Scenario**: Two ring-buffer limits with no rationale. The general output cap is 500 lines; the test output cap is 200. No comment explains the asymmetry or why these specific values were chosen.
- **Root cause**: Constants tuned during development without recording the reasoning — likely "felt right at 500/200 in dev."
- **Impact**: Minor. Future tuning will require re-deriving the trade-off from scratch (memory vs. transcript completeness vs. perf).
- **Fix sketch**:
  - Add a one-line comment: e.g. "500 lines × ~120 chars ≈ 60KB ceiling — fits in store without hurting Zustand subscriber comparison cost."
  - Note that test output is capped lower because tests are short-lived and the user only needs the tail

## 6. `MAX_OUTPUT_LINES` ring-buffer trim is per-batch, not strictly capped

- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:634-647
- **Scenario**: `handleBuildProgress` appends one line and trims if over the limit. If the CLI emits 5000 lines in a single RAF window (batched by `useBuildSession`) and `handleBuildProgress` is called once per event, trimming happens at every step — fine. But the design intent is unclear: is the buffer "last 500 lines" or "last 500 events"? The comment doesn't say.
- **Root cause**: Ambiguous header comment "Max output buffer size" — no spec for behavior under high-volume bursts or whether multi-line `event.message` payloads count as one line.
- **Impact**: A `progress` event whose `message` field contains embedded `\n`s will count as one ring-buffer slot but render as many lines, breaking the implicit "screen budget" the limit was supposed to enforce.
- **Fix sketch**:
  - Define explicitly: "buffer holds last N events; multi-line messages are not split"
  - Or split on `\n` before pushing so the cap matches user-visible lines
  - Add a unit test with a 1000-event burst to verify behavior

## 7. `useBuildSession` `__BUILD_CHANNEL_ACTIVE__` global flag has no ownership story

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/hooks/build/useBuildSession.ts:80-93
- **Scenario**: Three globals on `window`: `__BUILD_CHANNEL_ACTIVE_SESSIONS__` (Set) and `__BUILD_CHANNEL_ACTIVE__` (boolean, "kept true while ANY session is active, for any external code that still checks it"). The "external code" referenced is never named. There's no list of consumers, no plan for removing the legacy flag.
- **Root cause**: Compatibility shim added during a refactor ("per-session Set replaces the previous global boolean flag" — line 64), but the legacy flag was kept "just in case" without documenting which file(s) actually read it.
- **Impact**: Future refactors can't safely delete the legacy flag (might break unknown external consumers) and can't safely keep it (no clear consumer means tests don't cover it). Classic ratchet of irreducible complexity.
- **Fix sketch**:
  - Grep for all readers of `__BUILD_CHANNEL_ACTIVE__` and inline the comment with their file paths
  - If none exist outside this file, delete the legacy flag in the next pass
  - If any do exist, migrate them to read the Set's size

## 8. `escapeAnswer` escapes `[` but not `]` — single side of a token boundary

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/hooks/build/useBuildSession.ts:372-376
- **Scenario**: User answers are escaped before being concatenated as `[cellKey]: answer` lines. Only `\`, newlines, and `[` are escaped. The CLI parses each line by finding `[...]:` — escaping just `[` blocks the obvious injection (`[other_dim]: forged`), but if the parser ever uses `]:` as the terminator, an answer containing `]: ...` could still poison parsing.
- **Root cause**: The comment documents intent ("forge an extra `[dimension]:` line") but assumes the backend's parsing rule. If the backend accepts a stray `]: ` mid-answer as a separator under any condition, escaping is half-applied.
- **Impact**: Potential answer injection if the CLI parser is lenient. Even without a security angle, a user pasting log content like `]: completed` mid-answer can cause silent answer truncation.
- **Fix sketch**:
  - Either escape `]` symmetrically, or document that the CLI parser uses ONLY `^[\w-]+]: ` as the line-start anchor (and `]:` mid-line is harmless)
  - Add a property test: any roundtrip through escape/parse must yield the original answer

## 9. Glyph Full layout migration silently rewrites stored localStorage values

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:35-46
- **Scenario**: `readLayoutPreference` migrates retired values `"v3-capabilities"` and `"glyph"` to `"glyph-full"` on read, but `writeLayoutPreference` is only called when the user toggles. So a user who never toggles will have stale localStorage forever; on every read, the migration runs again. There's no backfill on mount.
- **Root cause**: Migration is read-only by intent ("we don't want to write on read"), but that decision and its trade-off (stale localStorage indefinitely) is undocumented.
- **Impact**: Minor today. If a future "v3-capabilities" semantic ever returns and the value is reused, users with the legacy string will get the new behavior unintentionally — namespace collision risk.
- **Fix sketch**:
  - On migration, also write through to localStorage so legacy values are normalized once
  - Or: namespace the value (`"glyph-full-v2"`) so retired strings can never be reused
  - Document the read-only migration policy in the comment

## 10. `classifyMission` task/purpose verb classifier is hard-coded English-only — used in a 14-language app

- **Severity**: high
- **Category**: trade-off-hidden
- **File**: src/features/agents/components/matrix/BehaviorCoreEditor.tsx:21-37
- **Scenario**: The mission coach inspects the first word against hard-coded English `TASK_VERBS` and `PURPOSE_VERBS` lists. The component itself is i18n-aware (uses `useTranslation`) but the classification logic is monolingual. A non-English mission gets classified as `"neutral"` no matter what verb starts it — silently disabling the red/green coaching feature.
- **Root cause**: The classifier was added as a quick UX hint without a spec for the multi-language case. The MEMORY note about edit-state IR contracts (matrixBuildSlice.ts:1088-1093) calls out exactly this issue for use cases — but BehaviorCoreEditor was not updated to match.
- **Impact**: Users in 13 of 14 languages get strictly worse onboarding feedback. They never see "this is a task, not a mission" coaching, defeating the whole feature for non-English speakers.
- **Fix sketch**:
  - Move classification to LLM-side (CLI emits a `mission_class` hint)
  - Or: use translation keys for the verb lists (e.g. `t.matrix_v3.task_verbs` returns a localized array)
  - At minimum, document the English-only constraint and add an i18n TODO

## 11. `BuildReviewPanel.allResolved` thresholds 8 hard-coded — drift risk vs. cell registry

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/agents/components/matrix/BuildReviewPanel.tsx:47-48
- **Scenario**: `const allResolved = resolvedCount >= 8;` — the "8" hard-codes the 8-dimension matrix layout. But UnifiedMatrixEntry now defaults to "glyph-full" with a different cell set, and v3 capability framework adds its own dimensions. The check is also `>= 8`, not `=== 8`, masking when the count is wrong.
- **Root cause**: Number was never extracted to a constant. The scoring is implicitly "we need at least 8 resolved cells" but the UI uses BuildReviewPanel for both legacy and glyph-full layouts.
- **Impact**: In glyph-full layout, this can silently report "all dimensions resolved" prematurely, OR refuse to ever flip to ready if the new layout emits fewer than 8 cells. The promote button is gated on `allReady` which gates on this — wrong "ok" tick can let a user promote a half-built draft.
- **Fix sketch**:
  - Replace `8` with a layout-aware required-cell list imported from the cell registry
  - Or: derive expected count from `cellStates` keys defined by the active layout
  - Add a test for both layouts

## 12. `dagUtils.topologicalSort` mutates input in-place via internal `inDegree` but never resets it

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/composition/libs/dagUtils.ts:21-67
- **Scenario**: The function is pure with respect to its `nodes`/`edges` arguments (it builds its own maps). However, the returned `cycleNodes` is computed from `inDegree` AFTER the algorithm consumed it — line 63 reads "still carrying residual in-degree". This is a one-shot data structure: callers cannot re-run the algorithm on the same map. Today that's fine because everything is local, but if a future caller refactors to share the map, the second call returns garbage.
- **Root cause**: The comment "Cycle detected: nodes still carrying residual in-degree are part of, or downstream of, the cycle" — a useful heuristic — is tied to internal map state that isn't returned or scoped via a closure.
- **Impact**: Future-developer tripwire. Also, "nodes that are part of OR downstream of" the cycle is over-broad: the editor is told to highlight innocent downstream nodes as "in a cycle" when they aren't. UI quality suffers if `cycleNodes` is used to render an error decoration.
- **Fix sketch**:
  - Explicitly document that `cycleNodes` is a superset (cycle members + downstream)
  - Provide a separate `findCycle(nodes, edges): string[]` that returns only the strongly-connected component members (Tarjan)
  - Mark the algorithm's internal state as off-limits in a JSDoc note
