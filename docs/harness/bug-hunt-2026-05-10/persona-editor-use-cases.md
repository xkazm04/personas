# Bug Hunt — Persona Editor & Use Cases

> Group: Personas Workspace
> Files scanned: 12
> Total: 2C / 5H / 4M / 1L = 12 findings

---

## 1. `buildUpdateInput` cannot clear nullable fields — `description: null` is silently skipped, not cleared

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/api/agents/personas.ts:240`
- **Scenario**: User opens persona editor, deletes the description text, autosave fires. `performSettingsSave` calls `applyPersonaOp({kind:'UpdateSettings', description: d.description || null})`. `buildUpdateInput` forwards `description: null`. The Rust `UpdatePersonaInput { description: Option<Option<String>> }` has NO `deserialize_with = "double_option"` (verified in `src-tauri/src/db/models/persona.rs:683`), so Serde's default deserializes JSON `null` to `None` (skip), not `Some(None)` (clear). The DB column keeps the old description. The UI shows it cleared, but on next reload it reappears.
- **Root cause**: The `buildUpdateInput` doc comment says "Option<Option<T>>: key absent = skip, null = clear, value = set" — but Serde's default JSON deserialization makes `null` and "absent" indistinguishable for `Option<Option<T>>`. Without a `with = "double_option"` helper, "clear" is unreachable.
- **Impact**: ANY user who tries to clear description, icon, color, structured_prompt, last_design_result, model_profile, max_budget_usd, max_turns, design_context, group_id, or parameters via the editor sees a fake success and the field keeps its old value after reload. Particularly damaging for `group_id` (cannot move persona out of a group) and `model_profile` (cannot revert to default).
- **Fix sketch**: Add `#[serde(default, deserialize_with = "deserialize_double_option")]` on every `Option<Option<T>>` field of `UpdatePersonaInput`, where the helper distinguishes "missing key" from "explicit null". On the TS side, change `buildUpdateInput` to omit fields entirely when they're undefined and emit `null` only when the user explicitly clears.

## 2. `selectPersona` dirty-guard ignores `pendingSelectPersonaId` while pending — second click is silently swallowed

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/agents/personaSlice.ts:448-487`
- **Scenario**: User has unsaved edits on persona A. They click persona B in the sidebar → `selectPersona(B)` sets `pendingSelectPersonaId = B`, returns early without changing `selectedPersonaId`. Banner appears. User now clicks persona C in the sidebar before resolving the banner → `selectPersona(C)` runs the dirty check: `id (C) !== prev (A)`, `prev != null`, `isEditorDirty` still true → it OVERWRITES `pendingSelectPersonaId` with C. The user resolves the banner expecting to reach B, but lands on C.
- **Root cause**: When already in pending state, the second `selectPersona` overwrites the pending target. There is no rule like "if pending exists and the new target differs, reject or surface a conflict".
- **Impact**: User trains the muscle memory of "click target → save & switch" and silently navigates to the wrong persona. They may save A's edits and then reload to find unexpected state because B was replaced by C without any UI feedback.
- **Fix sketch**: When `pendingSelectPersonaId` is non-null, either keep the original target (no-op the second click + toast "Resolve unsaved changes first") or surface a "Switch target changed to X" toast and update. Document the chosen behavior in the slice comment.

## 3. `pushUndo` after `applyPersonaOp` IPC may reapply with stale baseline — undo entry references the WRONG `prevBaseline`

- **Severity**: high
- **Category**: stale-closure
- **File**: `src/features/agents/sub_editor/libs/useEditorSave.ts:84-108`
- **Scenario**: Two rapid debounced settings saves S1, S2 both await IPC concurrently is prevented by `useDebouncedSaveGroup`'s in-flight lock — but S1 captures `prevBaseline = {...baselineRef.current}` BEFORE its `await applyPersonaOp` (line 87). After S1's `setBaseline` runs, S2 fires; S2 captures its own `prevBaseline` from the now-updated baselineRef. So far OK. BUT: `pushUndo` is called AFTER `setBaseline` (line 107) which is itself queued. If the user undoes immediately (Ctrl+Z), the undo entry's `prev` may not yet match what's currently on disk because S2's `setBaseline` hasn't committed.
- **Root cause**: `setBaseline` is async (queued via React) but `pushUndo` reads only the captured `prevBaseline` snapshot. If the persona switch happens between save completion and the subsequent setBaseline, the persona-token guard at line 105 returns early and SKIPS pushUndo — but the IPC write already happened. So the user has no undo for an edit that DID persist.
- **Impact**: User saves edits, then quickly switches persona before React commits the setBaseline. The save is durable on disk but is not in the undo stack — silent loss of undo history.
- **Fix sketch**: Move `pushUndo` BEFORE the persona-switch guard, or always push undo regardless of the current selection (the entry already captures personaId via `capturePersonaToken`).

## 4. RUN_LOCK_MS=60s timer continues across persona switch — "running" tile stays grey on a different persona

- **Severity**: medium
- **Category**: stale-closure
- **File**: `src/features/agents/sub_use_cases/components/recipes-prototype/RecipesVariantSigilGrid.tsx:299-319`
- **Scenario**: User clicks Run on Use Case X of persona A. `setRunStartedAt(Date.now())` → 60s timer scheduled. User immediately switches to persona B which has a use case with the same `id` (e.g., adopted from same recipe template). The component remounts with the new persona's use cases; React reuses the SigilTile via `key={uc.id}` if both personas happen to share an ID. The `runStartedAt` state is preserved, the run halo continues animating, the run button is disabled — but no execution is actually running for B.
- **Root cause**: SigilTile derives "running" purely from local `runStartedAt` state; there is no cross-check that the local timer corresponds to the currently-selected persona. The 60s lock is an ambient timer rather than an execution-status subscription.
- **Impact**: User on persona B sees a use case as "running" for up to 60s with no way to dismiss; clicking Run does nothing during the lock. They may panic-click or assume the system is broken.
- **Fix sketch**: Reset `runStartedAt` in an effect keyed on `personaId` change, OR derive running state from the `useAgentStore.isExecuting + executionPersonaId + executionUseCaseId` triple instead of a local timer.

## 5. `fetchDetail` failure clears `selectedPersonaId` mid-edit — user loses unsaved draft

- **Severity**: high
- **Category**: edge-case
- **File**: `src/stores/slices/agents/personaSlice.ts:219-240`
- **Scenario**: User is editing persona A with `isEditorDirty=true`. Some other code path triggers `fetchDetail(A)` (e.g., a refresh effect, `getPersonaDetail` after credential add at GlyphFullLayout.tsx:387, or auto-refresh). The IPC call fails (timeout, lock contention). The catch block sets `selectedPersonaId: null, selectedPersona: null` (lines 230-233) — wiping the user's editor. `useEditorDraft` then runs its "selectedPersona is null" effect (line 79 of useEditorDraft.ts), calling `cancelPendingSwitch()` and resetting the draft to `emptyDraft()`. All in-progress edits are lost.
- **Root cause**: A transient IPC failure on a refresh of an already-loaded persona is treated as catastrophic and clears state. There is no distinction between "first load" and "refresh of existing persona".
- **Impact**: User loses uncommitted edits to a transient error (especially on slow Windows WebView2 starts). The `degradationError` banner appears explaining "fetch failed" but the editor body is empty.
- **Fix sketch**: On refresh failure (where the persona already exists in `state.personas`), keep the selection and existing detailCache; only clear when this is the first load. Use `state.detailCache[id]` presence as the discriminator.

## 6. Capability toggle `applyToggle` swallows IPC failures, then refreshes anyway — UI shows wrong state without explanation

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/sub_use_cases/libs/useCapabilityToggle.ts:80-106`
- **Scenario**: User clicks pause on a use case. `setUseCaseEnabled` IPC throws (e.g., DB locked). The `catch` block calls `toastCatch` (which shows a toast) AND logs an error. The `finally` block clears `pendingUseCaseId` so the spinner disappears. But the function ALSO does NOT call `fetchDetail` on failure, leaving the optimistic UI nowhere — the tile may already have animated to "paused" via its own state, while the DB still has it enabled. Worse, on the NEXT successful toggle, `fetchDetail` runs and the user sees the toggle "jump back" without explanation.
- **Root cause**: The catch path does not refresh state to reconcile UI ↔ DB; the success path calls `fetchDetail`, but the failure path doesn't, so divergence is permanent until next refresh.
- **Impact**: After an IPC failure, the persona's capabilities tab can show wrong enabled states for triggers/subscriptions/automations until the user manually navigates away and back.
- **Fix sketch**: Always `fetchDetail(personaId)` in `finally`, whether the toggle succeeded or failed. The cost is one extra IPC; the benefit is guaranteed UI ↔ DB consistency.

## 7. `cascade_use_case_toggle` SQL `enabled = ?1` binds a bool as i64 — DB schema mismatch on triggers/subs

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/core/use_cases.rs:101,108`
- **Scenario**: `rusqlite::params![enabled as i64, ...]` casts the bool to i64 (0 or 1). For `persona_triggers.enabled` and `persona_event_subscriptions.enabled`, the schema may have CHECK constraints or rely on storing-as-INTEGER semantics. If a future migration changes one to BOOLEAN-affinity (rusqlite would store TRUE/FALSE), the comparison `enabled = 0` in `get_summaries` queries breaks silently. The mixed `enabled as i64` style here while other places use `if v { 1 } else { 0 }` creates inconsistent storage.
- **Root cause**: SQLite's lax type affinity means the "0/1 vs true/false" mismatch surfaces as no rows returned in COUNT/WHERE clauses — silent zero. The codebase's lack of a single boolean serialization helper invites drift.
- **Impact**: After a future schema migration, sidebar trigger counts can quietly return 0 even though triggers exist, masking real failures. Hard to debug because it looks like "no triggers" rather than "boolean cast mismatch".
- **Fix sketch**: Centralize bool-to-SQL conversion in a single helper and use it everywhere. Add an integration test that round-trips an enabled column through both writers and a SELECT to catch drift.

## 8. `set_use_case_enabled` allows arbitrary `persona_id`/`use_case_id` strings; cascade silently no-ops on typos

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src-tauri/src/commands/core/use_cases.rs:302-332`
- **Scenario**: A frontend bug or misrouted IPC sends `persona_id = ""` or a typo'd ID. The first SELECT inside `cascade_use_case_toggle` returns `QueryReturnedNoRows` and produces a `Validation` error — fine. BUT if the persona exists but `use_case_id` is wrong, the function returns a "use_case_id not found" error AFTER serializing the design_context. Meanwhile, in `count_event_listeners` (line 403) and `rename_event_listeners` (line 467), an empty `event_type` string is rejected — but a whitespace-only `"  "` passes the validation `from_event.trim().is_empty()` is checked but the actual UPDATE uses raw `from_event` not the trimmed version, leading to LIKE patterns with leading/trailing spaces that don't match real event types.
- **Root cause**: `count_event_listeners` doesn't validate empty/whitespace event_type at all. `rename_event_listeners` checks trimmed but uses raw — events get renamed to `"  newname  "` if user has a whitespace bug.
- **Impact**: An accidental space in an event name renames consumers to a name with a space, then `count_event_listeners` returns 0 because LIKE '%"event_type":"newname"%' doesn't match `"event_type":"  newname  "`. Consumer wiring silently breaks; user thinks the rename worked.
- **Fix sketch**: Trim `from_event`, `to_event`, and `event_type` strings to canonical form at the IPC boundary. Validate against a regex matching valid event names. Do the same in `count_event_listeners`.

## 9. `delete_persona` race: `force_cancel_all_for_persona` runs AFTER the timeout check but BEFORE `repo::delete` — orphaned execution rows can be created in this window

- **Severity**: critical
- **Category**: race-condition
- **File**: `src-tauri/src/commands/core/personas.rs:563-576`
- **Scenario**: A persona has a long-running execution that ignores cancellation. After the 15s timeout (line 543-557), `force_cancel_all_for_persona` runs (line 564). But between when `force_cancel_all_for_persona` returns and `repo::delete` runs (line 576), the engine task can still observe its `cancelled` flag, decide to write a final status update OR an `executions` audit row before observing the deletion. Because `delete_persona` doesn't take any DB transaction across the cancel + delete, a row written to `persona_executions` after the force-cancel but before `repo::delete` will fail with a CASCADE FK violation OR (worse) succeed and orphan in another related table.
- **Root cause**: There is no fence between "engine slots cleared" and "DB delete". `mark_deleting`/`unmark_deleting` only stops NEW executions; in-flight async tasks can still complete writes.
- **Impact**: After deleting a persona during a stuck execution, the database can either fail the delete (FK violation surfaces as `Failed to delete persona` toast despite the user having waited 15s) or succeed but leave orphaned rows in metrics/messages tables, breaking referential integrity in queries that JOIN on persona_id.
- **Fix sketch**: Hold the deleting marker until AFTER `repo::delete` succeeds, AND wrap the repo::delete in a transaction that re-checks `engine.all_slots_cleared(id)` inside the transaction. If the check fails, abort the delete and return a clearer error.

## 10. `requestIdleCallback` used without availability check on Windows WebView2 — `cancelIdleCallback` undefined throws

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/personas/PersonasPage.tsx:122,129,135-136`
- **Scenario**: `PersonasPage` calls `requestIdleCallback(...)` in two effects without checking whether it exists. While modern WebView2 has it, Tauri's WebView on older Windows builds may not. The cleanup function calls `cancelIdleCallback(id)` — if the symbol is undefined globally, the cleanup throws, escaping React's effect cleanup and breaking subsequent effects on that component. Also `personaSlice.ts:131-135` correctly guards (`typeof requestIdleCallback === 'function'`), so the codebase is aware of the risk — but the page itself doesn't.
- **Root cause**: Inconsistent feature detection. Some call sites guard, others don't.
- **Impact**: On Windows builds without `requestIdleCallback`, opening the personas page throws `requestIdleCallback is not defined`, killing the prefetch effects and possibly leaving the page in a half-rendered state.
- **Fix sketch**: Use the same `typeof requestIdleCallback === 'function'` guard as personaSlice.ts; fall back to `setTimeout(fn, 200)` and `clearTimeout`. Or centralize via a shared util `idleCallback.ts`.

## 11. GlyphFullLayout's reset-on-`buildSessionId`-change effect resets even when sessionId becomes null — destroys local UI state when user cancels build

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/agents/components/glyph/GlyphFullLayout.tsx:130-140`
- **Scenario**: User is mid-build, glyph face is showing answer cards. They cancel the build → `buildSessionId` transitions to null. The reset effect runs, clearing `activeDim`, `activeRow`, `face`, `refining`, `refinePrefill`, `showSimulate`, `showReport`. If `showReport` was open, the modal is force-closed; if the user was reviewing a test report when the build was cancelled (e.g., from a sibling component clicking "discard build"), they lose their position with no warning.
- **Root cause**: The effect treats "session changed" and "session ended" identically. It should only reset on session **change** (id → newId), not on session end (id → null).
- **Impact**: User reviewing a test report has it abruptly closed when they cancel a build elsewhere; minor UX papercut.
- **Fix sketch**: Track `prevBuildSessionId` in a ref; only reset when both old and new are non-null and differ.

## 12. `simulate_use_case` reads design_context twice — capability toggle between the reads creates inconsistent simulation

- **Severity**: critical
- **Category**: race-condition
- **File**: `src-tauri/src/commands/core/use_cases.rs:566-603`
- **Scenario**: `simulate_use_case` (1) reads persona's design_context to find the use case (lines 566-582), (2) calls `execute_persona_inner` which (per the comment at line 588) reads design_context AGAIN to populate `_use_case` and `_time_filter` blocks. Between these two reads, if `set_use_case_enabled` runs concurrently with `enabled=false` on the same use_case_id, the simulator builds `input_data` from the OLD enabled use case (line 586), but `execute_persona_inner` reads the disabled use case for prompt assembly. The prompt sees a disabled capability while the input was constructed assuming enabled — leading to inconsistent simulation results that don't match either before-toggle or after-toggle behavior.
- **Root cause**: No transaction or version stamp shared between the two reads. The function explicitly opts out of the enabled gate (line 552 docs), so the cascade flag is moot, but the design_context shape can still differ between reads if a parallel `cascade_use_case_toggle` commits in between.
- **Impact**: User runs a simulation right after toggling a capability; the simulation result silently disagrees with both states. Hard to reproduce, nearly impossible to debug — the user just sees "weird" behavior. Affects testing workflows where rapid toggle+simulate is common.
- **Fix sketch**: Either (a) read the persona ONCE and pass the resolved use_case JSON into `execute_persona_inner` instead of letting it re-read, or (b) take a SQLite read-snapshot at the start of the command and reuse it for both reads. Option (a) is cleaner and avoids double-querying.
