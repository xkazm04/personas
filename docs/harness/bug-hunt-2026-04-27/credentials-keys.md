# Bug Hunt — Credentials & Keys

> Total: 13 | Critical: 2 | High: 5 | Medium: 5 | Low: 1

## 1. FieldActionButtons is called as a function — Rules of Hooks violation; eye/copy state can flip silently

- **Severity**: critical
- **Category**: latent-failure
- **File**: `src/features/vault/sub_credentials/components/forms/FieldCaptureRow.tsx:62-71`
- **Scenario**: `FieldCaptureRow` calls `FieldActionButtons({...})` like a regular function instead of rendering it as `<FieldActionButtons ... />`. `FieldActionButtons` calls `useState` (twice) and `useEffect` and `useTranslation` internally. Because it is invoked as a plain function inside another component's render, those hooks register against the *parent* `FieldCaptureRow` component. As soon as the number of fields rendered (and therefore the number of these inline calls) changes — for example, when a connector with a different field count is loaded into the `EditFormFields` map — the order/count of hooks for the parent diverges, triggering the classic "Rendered more/less hooks than during the previous render" runtime crash.
- **Root cause**: Treating a hook-using component as a plain helper. Hooks attach to the *caller's* component slot, not the helper's.
- **Impact**: (1) Random React crashes in the credential edit form when fields change shape (e.g., switching connectors, adding optional fields after fetch). (2) Worse: the `isVisible` toggle returned in the closure object is consumed by *the parent* render, but the click handler `setIsVisible((v) => !v)` belongs to a hook slot that is now "owned" by whichever sibling field rendered first — clicking eye on row B can flip visibility on row A, briefly revealing one secret while looking at another. (3) `copied` state similarly bleeds across rows.
- **Fix sketch**: Convert `FieldActionButtons` to a real component (`<FieldActionButtons ... />`) and have it own its own state per-row. Or move the `useState`/`useEffect` calls into `FieldCaptureRow` directly.

## 2. Clipboard never auto-clears after copying a secret

- **Severity**: high
- **Category**: secret-leak
- **File**: `src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:76-86`
- **Scenario**: User clicks "copy" on a password/api-key field. `navigator.clipboard.writeText(value)` writes the plaintext secret to the OS clipboard and never removes it. After 1.5s the UI swaps the green checkmark back to a Copy icon, signalling "done" — but the secret remains on the system clipboard for the OS lifetime / until the next copy. The "copied" toast even reads "copied to clipboard" with no expiry.
- **Root cause**: Copy is treated as a UI-state event (1500ms tooltip) rather than a sensitive-data event with TTL. The `setCopied` timer at `:82` should also schedule a clipboard wipe.
- **Impact**: Secret persists in OS clipboard indefinitely, trivially accessible to any process / clipboard history utility (Win+V on Windows captures it). Cross-app paste (Discord, browser) is one keystroke away. This is the highest-value attack surface in the entire credential UI.
- **Fix sketch**: After ~30s, write a sentinel (e.g., empty string or a notice) back to the clipboard if the original value still matches; show a "clipboard cleared" hint. Even better, prefer a one-shot scheme that replaces the clipboard payload after first paste.

## 3. Pending OAuth `client_secret` retained in memory across hook lifetime; not cleared on unmount or modal close

- **Severity**: high
- **Category**: secret-leak / cleanup-gap
- **File**: `src/features/vault/shared/hooks/useCredentialOAuth.ts:26-76`
- **Scenario**: `pendingValuesRef.current = values` stores the raw user-entered values (including `client_secret`) on consent start. The ref is cleared in `onSuccess`, `onError`, and `reset` — but if the user closes the credential edit modal mid-OAuth (e.g., clicks Cancel, navigates the FSM to GO_LIST, kills the modal in the catalog), the parent's `useEffect` cleanup *doesn't necessarily call* `oauth.reset()` in every code path (e.g., catalog form `onBack`/`onCancel` does call reset, but `onMcpComplete` does not, and Universal OAuth flows on a route change can drop without resetting).
- **Root cause**: Lifetime of `pendingValuesRef` is tied to hook instance, not to OAuth flow completion. No effect-cleanup that nulls the ref on unmount.
- **Impact**: A long-lived `useCredentialOAuth` instance can hold a `client_secret` in memory after the user "moved on", visible to any code that captures the React fiber tree (Sentry breadcrumbs, error boundaries serializing props).
- **Fix sketch**: Add `useEffect(() => () => { pendingValuesRef.current = null; }, [])` to the hook so unmount always wipes. Same for `useGoogleOAuth.getValues()` cache.

## 4. Resource picker `state` cache stale-closure bug — concurrent dependency selections drop fetches

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx:109-117, 63-106`
- **Scenario**: User picks a value for a parent resource, the effect at line 109 spins up `fetchSpec(child)`, but before the child fetch resolves, the user picks a *different* parent value. `toggleItem` (line 119) clears the downstream pick from `selections`, which causes the effect to skip refetching (the `if (state[spec.id]) continue;` early-return at line 111 sees the in-flight state still set by the first call). The outdated `selections[dep]?.[0]` was captured in the original `fetchSpec` closure, so the response ultimately written to `state[spec.id]` corresponds to the *old* parent choice.
- **Root cause**: No request invalidation when dependencies change; `fetchSpec` is `useCallback` over `selections` but in-flight calls capture old `selections` and unconditionally write their result into state on completion.
- **Impact**: User sees stale resource options for the wrong parent (e.g., picks "Project Alpha", switches to "Project Beta", but the child list shows Alpha's branches). Risk of scoping a credential to wrong-parent resources — security-relevant for least-privilege scoping.
- **Fix sketch**: Track an AbortController or generation counter per spec; bump on toggle; ignore stale results.

## 5. Resource picker save races against concurrent toggles — saves a snapshot taken before user's last click

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/vault/sub_credentials/components/picker/ResourcePicker.tsx:158-159, 119-140`
- **Scenario**: User clicks Save. `handleSave` reads `selections` at the moment of click via React closure, but if the user rapid-clicks an item *and then* Save (or if React batches the toggle+save in 18's automatic batching), the save can capture pre-toggle selections. Worse, `setSelections((prev) => ...)` inside `toggleItem` is async, so calling save right after a toggle persists the previous state.
- **Root cause**: `handleSave` uses the closed-over `selections` rather than reading the latest committed state.
- **Impact**: User commits scope thinking it includes their newly added pick; backend stores fewer items than displayed; resource enforcement (`mode: block`) then blocks legitimate calls or vice versa.
- **Fix sketch**: Use a ref mirroring `selections`, or have `handleSave` `flushSync` before reading.

## 6. `usePostSaveResourcePicker` deadlocks when two callers race on `prompt`

- **Severity**: medium
- **Category**: race-condition / state-corruption
- **File**: `src/features/vault/sub_credentials/components/picker/resourcePickerStore.ts:38-48`
- **Scenario**: `WorkspaceConnectPanel` provisions multiple credentials in a `for` loop and calls `await promptIfScoped(...)` after each `createCredential`. If the user clicks back/away quickly, two credentials in the same provisioning batch can call `prompt({})` nearly simultaneously. The store's "defensive" prev-resolve at line 43 fires on the *new* call, resolving the previous promise *without ever showing the picker for it*. The first credential silently has its `await` resolved (no scope dialog ever appeared), so its scope stays as `null` (broad) — but the user never made that choice consciously.
- **Root cause**: "Resolve previous on new prompt" is a deadlock prevention, but it lies to the caller about user intent. There's no queue.
- **Impact**: First credential in a workspace provision silently gets broad scope when there were two pending pickers. User believes they declined deliberately for both, only one was actually shown.
- **Fix sketch**: Queue prompts (`active` becomes a stack); only resolve the previous when it has actually been displayed and user dismissed.

## 7. `validate()` mutates state then reads it — `onSave(values)` may run with stale validation

- **Severity**: medium
- **Category**: edge-case / silent-failure
- **File**: `src/features/vault/sub_credentials/components/forms/CredentialEditForm.tsx:105-112`
- **Scenario**: `validate()` calls `setTouched(...)` and `setErrors(...)` and immediately returns based on `Object.keys(newErrors).length`. The set calls are async; React doesn't reflect them in the next render until commit. If a user pastes a malformed URL into a field then *immediately* clicks Save before blur fires, `validate()` does correctly return false — but if `onSave(values)` is called via a Promise `.then` that mounts a new field after this render, the form can submit with values that *should* have triggered later validation (e.g., field added by initialValues effect at line 71).
- **Root cause**: `validate()` mixes side effects with synchronous return, and the `useEffect` at line 71 can mutate `values` after the user has clicked save.
- **Impact**: Edge-case: form can submit a credential with values whose synchronous validity passed but whose post-effect-merged values are different. Mostly cosmetic; in worst case, an empty required field slips through.
- **Fix sketch**: Pure validator that takes values and returns errors; compute, then setState; submit only after the next render commits validation feedback.

## 8. `useUndoDelete` confirmation closure goes stale — clicking confirm after a list refresh deletes wrong credential

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/vault/shared/hooks/useUndoDelete.ts:32-39`
- **Scenario**: User clicks delete on credential A. `requestDelete` snapshots A into `deleteConfirm`. Meanwhile, a bulk healthcheck or fetchCredentials fires (line 102 of `useCredentialManagerState`) and replaces objects in the store. The dialog still shows A's name (snapshot is fine), but the snapshot's `credential.id` was correct at snapshot time. If the user takes a long time and the credential was deleted from another window/process, the confirm path silently swallows the deletion error in `onDelete().catch` (`onError` toast is shown), but `pendingDeleteCredentialIds` is left populated for that ID forever — the row is greyed-out but never gets cleaned up because it's already gone from the store list.
- **Root cause**: The pending-delete set in `credentialSlice.deleteCredential` removes IDs only on success/error; if the credential is already gone from `state.credentials`, the cleanup path runs but the UI no longer has a row to display, so the symptom is invisible — until the same ID is created again (new credential reuses the same id is rare, but the pendingDeleteCredentialIds set is unbounded across the session).
- **Impact**: Memory leak in pendingDeleteCredentialIds set; rare. More importantly, success theater: the user thinks delete succeeded but might see a misleading error toast.
- **Fix sketch**: Always clear the pending-delete entry in a `finally`; cap the set / clear on `fetchCredentials` if the id is no longer present.

## 9. Bulk healthcheck swallows store-patch failure — UI permanently shows stale healthcheck status

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/vault/shared/hooks/health/useBulkHealthcheck.ts:145-153`
- **Scenario**: `patchCredentialMetadata(cred.id, patch)` failure is caught and ignored as "best-effort". But the in-memory `setHealthResultStatic(cred.id, ...)` was already updated, so for *this session* the credential card shows green/red. As soon as the user navigates away and comes back (re-fetches credentials), the card reverts to the previously-stored (old) value because the patch never persisted.
- **Root cause**: Two sources of truth: ephemeral cache vs persisted column. Silent failure leaves them divergent.
- **Impact**: User sees a credential as healthy in the dashboard, comes back tomorrow, sees it as failing/untested with no explanation. Trust erosion. Worse, a *failing* credential might persist as in-memory healthy through a session even though the persistence to the DB failed — an agent run later has no warning.
- **Fix sketch**: Surface the persistence error as a non-blocking warning; fall back to fetch-on-load to re-derive truth.

## 10. `parseEnvFile` puts secret values in error strings — first 40 chars of any malformed line leak to the UI

- **Severity**: medium
- **Category**: secret-leak
- **File**: `src/features/vault/sub_credentials/components/import/importTypes.ts:171-175`
- **Scenario**: User pastes `.env` content. A line containing `=` but oddly formatted (e.g., a multi-line value pasted carelessly: `MY_KEY` on one line, `=sk-abc...` on the next) hits `eqIndex === -1` only for the first half. But if a user pastes a key alone without `=`, *and* that key happens to be a token (some users dump `op item get --reveal` that pastes raw secret strings without `=`), the error message becomes `Invalid line (no = sign): <first 40 chars of secret>`. The error is then rendered in `ImportPreview.tsx:74-83` as a yellow warning visible to anyone shoulder-surfing.
- **Root cause**: Error strings include user input verbatim without redacting secret-shaped tokens.
- **Impact**: Inadvertent display of partial secrets in the import preview; could be captured in screenshots, screen-share recordings, or accidentally pasted into a bug report.
- **Fix sketch**: Show line *number* without contents, or mask everything except the first 4 chars (consistent with the preview row's `secret.value.slice(0, 4) + '...'` at line 128).

## 11. `requestDelete` allows multiple delete dialogs to stomp each other; second click wins, first credential's confirmation is lost

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/vault/shared/hooks/useUndoDelete.ts:22-30`
- **Scenario**: User clicks delete on row A, dialog opens. While the dialog's `useBlastRadius` is still loading, user clicks delete on row B (e.g., via keyboard, before realising the dialog is already up). `requestDelete` is async and unconditionally calls `setDeleteConfirm` after fetching events for B, overwriting the dialog with B. User sees "delete A?" dialog change to "delete B?" mid-confirmation; if they were about to click Confirm, they delete the wrong credential.
- **Root cause**: No guard on `requestDelete` against an existing open confirm.
- **Impact**: User-error footgun deleting wrong credential. Recoverable (re-create), but trust-damaging.
- **Fix sketch**: Bail out early in `requestDelete` if `deleteConfirm` is already non-null, or queue.

## 12. `formatJson(testResult.body)` rendered into a plaintext `<pre>` — response body bytes (with secrets) survive in DOM after copy

- **Severity**: medium
- **Category**: secret-leak / cleanup-gap
- **File**: `src/features/vault/sub_credentials/components/autopilot/PlaygroundOutput.tsx:36-62` and `src/features/vault/shared/playground/ResponseViewer.tsx:51-55, 142-145`
- **Scenario**: User runs an API request through the playground; response body often contains tokens (e.g., refresh tokens for OAuth refresh endpoints, account session cookies, customer PII). The body is rendered in a `<pre>` block, *and* the copy button writes it to clipboard. There's no auto-clear, and the body persists in DOM for the full lifetime of the modal — which can be hours of an idle desktop app. Crash/error reporting (e.g., a screenshot tool) captures it.
- **Root cause**: Response payloads are treated as opaque text, not as potentially-sensitive data. No redaction, no clipboard expiry, no DOM eviction on tab change.
- **Impact**: API tokens returned in playground responses are exposed beyond the immediate need-to-know; clipboard + DOM persistence multiply the leak surface.
- **Fix sketch**: Auto-clear `testResult` after N minutes of inactivity; clipboard write-back as in finding #2; obvious "contains potential secrets" warning when response bodies match common token patterns.

## 13. Daily-run bulk healthcheck triggers on `healthcheckCredentials.length` only — silent skip when credentials change content but not count

- **Severity**: medium
- **Category**: timing-bug / silent-failure
- **File**: `src/features/vault/sub_credentials/manager/useCredentialManagerState.ts:115-129`
- **Scenario**: User adds a new credential and removes another within a few seconds. Length unchanged. The dependency array `[loading, healthcheckCredentials.length]` doesn't refire the daily-run effect; the new credential is not bulk-tested today. Comment says "run if not run today" but the trigger is gated on length only.
- **Root cause**: `useEffect` deps incorrectly use `.length` as a stable identity; replacement-style mutations don't re-trigger.
- **Impact**: Newly added credentials silently skip the daily auto-test until the next session boot. User sees an "Untested" badge that they expected to be cleared by the daily sweep.
- **Fix sketch**: Depend on a stable id-list hash, or trigger re-run on credential CRUD events directly.
