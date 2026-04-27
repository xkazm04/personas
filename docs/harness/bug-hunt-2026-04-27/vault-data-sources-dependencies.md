# Bug Hunt — Vault Data Sources & Dependencies

> Total: 11 | Critical: 1 | High: 4 | Medium: 5 | Low: 1

## 1. ChatTab poll interval leaks across consecutive submissions

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/vault/sub_databases/tabs/ChatTab.tsx:74`
- **Scenario**: User submits a question, then before the first one finishes (or while `generating` flips false on submit-error path on line 105), submits a new question. Both `handleSubmit` calls assign `pollRef.current = setInterval(...)`, overwriting the first interval id without clearing it. Also, if `startNlQuery` throws (line 104) `pollRef.current` is never assigned but a previous still-running interval from an earlier successful submit may continue overwriting messages by id.
- **Root cause**: `pollRef.current` is treated as if there can only be one active interval, but `handleSubmit` does not first `clearInterval(pollRef.current)` before assigning, and the cleanup-on-error path does not clear it either.
- **Impact**: Orphaned intervals keep polling `getNlQuerySnapshot` forever (until tab unmount), wasting IPC bandwidth, possibly racing with newer polls and applying a stale snapshot's `completed`/`failed` to the wrong assistant message id (which is captured in closure — so it still matches), causing UI to flip back to "ready" after the user already submitted a follow-up.
- **Fix sketch**: At the top of `handleSubmit`, `if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined; }`; in the `catch` block also clear; gate poll callback by an incrementing generation counter.

## 2. ChatTab "Cancel" wipes ALL in-flight assistant messages, not the active one

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/vault/sub_databases/tabs/ChatTab.tsx:117-127`
- **Scenario**: Combined with bug #1, multiple `generating` messages can exist. When the user clicks Cancel, `handleCancel` flips ALL messages whose `status === 'generating'` to `'failed'` with content "Cancelled.", even ones still actively producing a result.
- **Root cause**: Cancel logic uses `m.status === 'generating'` as the predicate instead of matching by `activeQueryId` / message id.
- **Impact**: Active generations show as cancelled in the chat history even though the backend keeps running and may still complete; user sees inconsistent state.
- **Fix sketch**: Track the assistant message id alongside `activeQueryId`, then mark only that specific message as cancelled.

## 3. Stale `buildConversationHistory` closure produces inconsistent NL prompt

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/vault/sub_databases/tabs/ChatTab.tsx:43-54,71-72`
- **Scenario**: `buildConversationHistory` depends on `messages`. `handleSubmit` calls `setMessages((prev) => [...prev, userMsg, assistantMsg])` synchronously, then calls `buildConversationHistory()` which still returns the OLD messages array (closure was created before setState applied). The new user message is dropped from the conversation history sent to the LLM.
- **Root cause**: React state updates aren't observable in the same render's closure; `buildConversationHistory` reads stale `messages`.
- **Impact**: First message after each submission is missing from the LLM context; multi-turn chat loses coherence in subtle ways (the model rarely sees the full chain).
- **Fix sketch**: Compute the next history inline from `messages.concat([userMsg])` before `setMessages`, or pass the freshly assembled history explicitly.

## 4. SchemaManagerModal name-edit `saveName` runs twice on Enter (blur + keydown)

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/vault/sub_databases/SchemaManagerModal.tsx:119-123`
- **Scenario**: User edits the credential name and presses Enter. `onKeyDown` fires `saveName()` (which sets `isEditingName=false` async); the input then loses focus, firing `onBlur` which calls `saveName()` again. Two `updateCredential` calls race; if the first succeeds and updates the store, the second sees the same `editName` (still trimmed equal to credential.name post-merge by closure timing) and may either no-op or send a redundant request. Worse: if the first call is slow and the second wins back into the store, the result merge in `useVaultStore.setState` overwrites with the older response's data.
- **Root cause**: No guard against concurrent invocations; both `onKeyDown=Enter` and `onBlur` trigger save without an in-flight latch.
- **Impact**: Double IPC call per rename; potential lost-update if backend write order doesn't match response order; toast may flash twice on failure.
- **Fix sketch**: Add `savingRef` and early-return; or call `e.currentTarget.blur()` from Enter handler instead of calling `saveName` directly.

## 5. CredentialRelationshipGraph re-runs N parallel `getCredentialDependents` on every credential mutation

- **Severity**: high
- **Category**: timing-bug
- **File**: `src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:38-58`
- **Scenario**: User has 50 credentials. Effect depends on the entire `credentials` array reference. Every time the vault store updates anything that returns a new credentials array (rename, healthcheck refresh, add/delete) — even if it's a single field change — the effect re-fires, blowing away the prior `dependentsMap` (`setLoading(true)` triggers a full-screen spinner) and parallel-firing 50 IPC calls. While in flight a second mutation arrives → first effect's `cancelled=true` cleanup fires, the new effect spawns another 50 calls. The graph view "blinks" to spinner repeatedly during normal usage.
- **Root cause**: Effect treats credentials array as the trigger key but uses the entire reference identity. There's no diff (added/removed credentials only), no debounce, and `setLoading(true)` runs even when prior data is fresh.
- **Impact**: Flickering UI, IPC storm (50–N parallel Tauri calls), wasted backend cycles, race between concurrent loads. With slow connectors and an in-progress healthcheck loop hitting the store every few seconds, the panel becomes effectively unusable.
- **Fix sketch**: Depend on `credentials.map(c => c.id).join(',')` (or a memoized id-set), only set loading when the id-set actually changed, and merge new dependents into existing map instead of replacing.

## 6. SQL identifier sanitisation strips quotes — silently queries the wrong table

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/vault/sub_databases/introspectionQueries.ts:46`
- **Scenario**: User has a Postgres table named `"My Table"` (case-preserved with quoted identifier) or `users-prod` (hyphenated). `getListColumnsQuery` does `tableName.replace(/[^a-zA-Z0-9_]/g, '')`, transforming `"My Table"` → `MyTable` and `users-prod` → `usersprod`. The resulting SQL queries a non-existent table and the introspection silently returns zero columns.
- **Root cause**: Strip-and-interpolate is used in lieu of proper quoting; the assumption that table names are `[a-zA-Z0-9_]` is invalid for Postgres/MySQL where quoted identifiers can contain anything.
- **Impact**: User clicks any table whose name has special characters — sees "Loading columns..." → empty list with no error. They have no way to introspect those tables; combined with the pin-table flow (TablesTab.tsx:62 reads cached columns), pinning records null hints, breaking AI query generation for those tables permanently.
- **Fix sketch**: Use parameterised queries via the IPC layer, or properly quote-escape the identifier (`"` doubled for Postgres, backtick doubled for MySQL).

## 7. SQL identifier sanitisation also breaks `getSelectAllQuery` for table names with special chars

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/vault/sub_databases/introspectionQueries.ts:65-81`
- **Scenario**: User right-clicks a table named `"order-items"` and chooses "Copy SELECT query". Because `getSelectAllQuery` does NOT sanitise but DOES wrap in double quotes for Postgres, the output is `SELECT * FROM "order-items" LIMIT 100;` — that part works. But for MySQL it wraps in backticks (good); for the `default` branch (line 79) it produces `SELECT * FROM order-items LIMIT 100;` which Postgres-with-unknown-service-type would parse as `order MINUS items` and fail confusingly.
- **Root cause**: Default branch assumes unquoted-safe identifier with no escape strategy; mismatch with the introspection-side stripping creates conflicting "what is a valid table name" assumptions across the file.
- **Impact**: Copy-to-clipboard produces broken SQL for unfamiliar connectors; user pastes and runs, sees baffling syntax error.
- **Fix sketch**: Quote-wrap (with proper doubled-quote escape) in the default branch too; add a unit test covering identifiers with `-`, space, `"`.

## 8. `safeModeUtils.isMutationQuery` misclassifies WITH-CTE writes as read-only

- **Severity**: critical
- **Category**: validation-gap
- **File**: `src/features/vault/sub_databases/safeModeUtils.ts:9-42`
- **Scenario**: User in safe mode runs `WITH deleted AS (DELETE FROM users WHERE id=1 RETURNING *) SELECT * FROM deleted;`. The first keyword token is `WITH`, which is in `READ_ONLY_KEYWORDS`. `isMutationQuery` returns `false`, and the query bypasses the safe-mode confirmation dialog, going straight through `runQuery(text, !safeMode)` with `allowMutation=false`. Comment says "The backend still enforces the guard" — but if the backend's `is_mutation` mirrors this same first-keyword logic (file comment says they mirror), the DELETE silently executes without confirmation.
- **Root cause**: Postgres/SQLite `WITH ... AS (DELETE/INSERT/UPDATE ...)` is a mutation but starts with `WITH`. Single-keyword classification cannot capture this. Same hole with `WITH ... AS (UPDATE ...)`.
- **Impact**: Safe-mode bypass — the very feature designed to prevent accidental destructive writes silently allows them. Even if the backend rejects, the UX promise is broken; if the backend mirrors, it's data loss.
- **Fix sketch**: After parsing CTE-style `WITH`, scan the body for `DELETE|UPDATE|INSERT|MERGE` keywords; treat presence as mutation. Better: ship a real SQL parser or default-to-mutation for any `WITH` query.

## 9. `pendingMutation` survives credential switch — confirms wrong query against wrong DB

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/vault/sub_databases/hooks/useQuerySafeMode.ts:13-47` + `src/features/vault/sub_databases/tabs/ConsoleTab.tsx:31-64`
- **Scenario**: User opens DB A's console, types `DROP TABLE foo`, hits Run. Confirmation dialog appears with `pendingMutation = "DROP TABLE foo"`. User closes the modal (without clicking Cancel) and opens DB B. ConsoleTab unmounts/remounts? Actually `SchemaManagerModal` only mounts ConsoleTab when `visited.has('console')` — and the modal is per-credential (re-mounted on credential change). State is reset. **However**, within the same credential, switching tabs does NOT reset; user clicks "Tables" tab, deletes something via SQL editor in QueriesTab, comes back to Console, the stale `pendingMutation` is still there pointing at an outdated context (if `selectedId` changed in QueryEditorPane). Furthermore, `runQuery` callback in ConsoleTab/QueryEditorPane closes over `credentialId` — which is fine — but `confirmMutation` in `useQuerySafeMode` calls `runQuery(text, true)` referencing whichever closure is current; if the dialog is open and user navigates to a different saved query whose editor share state, the wrong context can be applied.
- **Root cause**: `pendingMutation` is held in the shared `useQuerySafeMode` hook with no association to the query editor instance or credential; relies on component lifecycle rather than explicit invalidation.
- **Impact**: User confirms a mutation believing it applies to the currently visible editor/credential, but it executes the previously stashed text — potentially destructive on the wrong target.
- **Fix sketch**: Snapshot `(credentialId, selectedId)` into the pending state and refuse to confirm if either has drifted; clear pending on any meaningful navigation.

## 10. SqlEditor `requestAnimationFrame` cursor restore loses caret on rapid Tab presses

- **Severity**: low
- **Category**: timing-bug
- **File**: `src/features/vault/sub_databases/SqlEditor.tsx:19-38`
- **Scenario**: User holds Tab to indent multiple times rapidly. Each Tab call captures `start = ta.selectionStart` synchronously, calls `onChange(newVal)`, and queues `requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; })`. Before the rAF fires, React may have re-rendered with the new `value`; a second Tab fires, captures the (now reset) selection (browser sets it to end of textarea after value swap), inserts spaces at the wrong position. Cursor jumps; spaces inserted in unexpected places.
- **Root cause**: Cursor restoration races with React's controlled-input cycle; `start + 2` arithmetic isn't valid once the textarea's value has been swapped back to the controlled value.
- **Impact**: Frustrating editor UX during indentation; cursor lands at end of text after multi-Tab.
- **Fix sketch**: Use `useLayoutEffect` keyed on a generation counter to restore cursor after the controlled value has applied; or use `document.execCommand('insertText', false, '  ')` (deprecated but works) which preserves cursor naturally.

## 11. Race between `cancelNlQuery` and a poll that already received `completed` snapshot

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/vault/sub_databases/tabs/ChatTab.tsx:74-103,117-127`
- **Scenario**: Backend completes the NL query at T=799ms. At T=800ms the poll fires `getNlQuerySnapshot` and gets `status: 'completed'`. Simultaneously the user clicks Cancel at T=800ms. `handleCancel` clears the interval and marks generating messages as failed. The in-flight `getNlQuerySnapshot` promise resolves AFTER `handleCancel` ran — its `.then` handler still calls `setMessages` to mark the assistant message as `'ready'`, racing with the cancel write that just marked it `'failed'`. Order non-deterministic.
- **Root cause**: Poll callback doesn't check whether it was cancelled before applying snapshot; `clearInterval` doesn't abort an already-dispatched callback's awaited promise.
- **Impact**: Cancelled message sometimes shows the actual SQL response (confusing — user thinks cancel didn't work); other times shows "Cancelled." correctly. Inconsistent UX.
- **Fix sketch**: Use a generation counter (`pollGenRef`) captured at interval-creation time; in the async callback, return early if `pollGenRef.current !== capturedGen`. Same pattern used cleanly in ConsoleTab.tsx.
