# Persona Editor & CRUD — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 4, Low: 0)

## 1. Delete failure is success theater — confirm dialog closes and the retry path is dead code
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/agents/personaSlice.ts:458-460 (+ src/features/agents/sub_editor/components/EditorBody.tsx:119-133)
- **Scenario**: User clicks Delete in the persona editor's confirm dialog while the backend delete fails (e.g. a running execution can't be cancelled and `repo::delete` errors, DB lock, or `AppError::Forbidden` for a system persona surfaced through this path).
- **Root cause**: `deletePersona` in the slice catches the error via `reportError(err, ...)` and does **not** rethrow — unlike its siblings `createPersona`/`updatePersona`/`duplicatePersona`, which all `throw err` after reporting. `EditorBody.handleDelete` was written assuming a rejected promise: its `catch` shows a "delete failed" toast and deliberately keeps the confirmation dialog open ("so the user can retry"). That catch can never fire.
- **Impact**: On any backend delete failure the dialog closes as if deletion succeeded, the failure toast in `handleDelete` never appears, and `resetBuildSession()` is run for a persona that still exists (wiping the user's in-flight draft-build session for a persona that was not deleted). The persona silently reappears/remains in the roster.
- **Fix sketch**: Re-`throw err` at the end of the slice's `deletePersona` catch (matching create/update/duplicate), or return a boolean and have `handleDelete` only close the dialog / reset the build session on success.

## 2. Deselecting or deleting while a detail fetch is in flight leaves the global `isLoading` stuck true forever
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/agents/personaSlice.ts:209-253 (fetchDetail) with :488 (selectPersona) and :409 (deletePersona)
- **Scenario**: User clicks a persona (slow `getPersonaDetail` IPC in flight, `isLoading: true` already set), then immediately deselects (`selectPersona(null)`) or deletes the persona. Both paths do `++fetchDetailSeq` **without starting a new fetch**. When the in-flight fetch settles, both the success and the error handler hit `if (seq !== fetchDetailSeq) return;` before ever writing `isLoading: false`.
- **Root cause**: The seq-guard invalidation assumes a *newer fetch* will always supersede the stale one and clear `isLoading`. The two "invalidate with no successor" call sites (deselect, delete) break that assumption.
- **Impact**: The store-wide `isLoading` flag latches `true` until some unrelated `fetchPersonas`/`fetchDetail` runs. Every consumer of `useAgentStore((s) => s.isLoading)` (e.g. `WelcomeGetStarted`, roster loading affordances) shows a permanent spinner/disabled state after a perfectly normal click-then-back interaction.
- **Fix sketch**: In `fetchDetail`, when `seq !== fetchDetailSeq`, still clear the flag if this call was the one that set it (`set({ isLoading: false })` guarded by a check that no newer fetch is active), or make the deselect/delete invalidation also `set({ isLoading: false })`.

## 3. `update_persona` accepts `parameters` with zero validation, and `sync_capability_parameters` then silently destroys them
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/core/personas.rs:129-156 (validate_update_persona) and :412-417 (sync_capability_parameters)
- **Scenario**: The frontend writes parameters through the generic path — `applyPersonaOp({ kind: 'UpdateParameters', parameters })` → `update_persona` (`operationToPartial`/`buildUpdateInput` forward `parameters`, src/api/agents/personas.ts:352,388). Unlike `update_persona_parameters`, `validate_update_persona` never checks `input.parameters`: no 64 KB cap, no valid-JSON check. Later the user adopts a catalog capability, which calls `sync_capability_parameters`.
- **Root cause**: Two commands write the same column with different trust boundaries; the reconciler then treats unparseable stored JSON as "no existing params" (`serde_json::from_str(...).ok().unwrap_or_default()`) and **overwrites** the column with only the derived set.
- **Impact**: Malformed or oversized parameters can be persisted (bypassing the guard the dedicated command was built for), and any pre-existing user-tuned parameters that fail to parse are silently erased on the next capability adopt/remove — invisible data loss with no error surfaced.
- **Fix sketch**: In `validate_update_persona`, apply the same size + `serde_json` validation to `input.parameters` (and `structured_prompt` size). In `sync_capability_parameters`, fail loudly (AppError::Validation) instead of defaulting to `Vec::new()` when stored parameters exist but don't parse.

## 4. Icon-generation poll retries permanent auth errors for 2 minutes, then reports a misleading "timed out"
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/core/persona_icon_gen.rs:241-282 (poll_for_image)
- **Scenario**: User generates an AI icon with a revoked/expired Leonardo or Higgsfield key that still passes the initial POST (or the key is invalidated mid-job / the status endpoint returns 401/403/404). Every poll gets a non-2xx response; the loop does `if !resp.status().is_success() { continue; }`.
- **Root cause**: The "a transient non-2xx shouldn't abort" heuristic doesn't distinguish transient (429/5xx) from permanent (401/403/404) statuses, and the loop discards the provider's error body.
- **Impact**: The user stares at a spinner for the full 40 × 3 s = 120 s budget, hammering the provider with 40 doomed requests (retry storm against an auth-failing endpoint), then gets "generation timed out after 120s" — masking the actual cause (bad key), which `ok_json` would have surfaced with the provider's own message.
- **Fix sketch**: Treat 4xx (except 408/429) as fatal inside the poll loop and surface the body snippet via the same formatting as `ok_json`; keep `continue` only for 5xx/429/parse failures.

## 5. Design tab's red "missing connectors" count badge is indistinguishable from the save-failure badge and hides the dirty indicator
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/agents/sub_editor/components/EditorTabBar.tsx:112-118 (+ TabBadge :32-49)
- **Scenario**: User edits the Design tab of a persona that has 2 unlinked connectors. The tab shows a red numbered badge (`variant="error"`, count=2). Now an autosave of another tab fails — that tab shows the *same* red badge shape (with a count or "!"). Meanwhile the Design tab's unsaved-changes amber dot never renders because the ternary chain gives `connectorsMissing` precedence over `tabDirty`.
- **Root cause**: One visual vocabulary (red pill badge) is reused for two semantically different states — "your last save FAILED (data at risk)" vs. "setup incomplete (connectors missing)" — and the badge slots are mutually exclusive per tab.
- **Impact**: Users can't tell a failed save from a benign readiness hint at a glance, and a dirty Design tab shows no unsaved indicator whenever any connector is missing — exactly the tab where most editing happens. This undermines the dirty-tracking affordance the rest of the editor (banners, guard modal) is built around.
- **Fix sketch**: Give the connectors hint its own variant (e.g. the existing violet `attention` style with a count, matching the readiness popover's tone) and allow the dirty dot to coexist (render error/attention badge + dirty dot, or stack error > dirty > attention with distinct colors).
