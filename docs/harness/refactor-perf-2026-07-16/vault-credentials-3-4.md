# vault/credentials [3/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 1 medium / 3 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Infinite blast-radius refetch loop while the delete dialog is open
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: fetch-loop
- **File**: src/features/vault/sub_credentials/components/card/CredentialDeleteDialog.tsx:28
- **Scenario**: User opens the credential delete confirmation. `useBlastRadius` is called with the inline arrow `() => getCredentialBlastRadius(credentialId)`. The hook's effect (BlastRadiusPanel.tsx:91) lists `fetcher` in its dependency array; the inline arrow gets a new identity on every render, so the effect refires, `setItems`/`setLoading` produce a re-render (new array identity each time), which creates yet another fetcher — a self-sustaining fetch loop for as long as the dialog stays open.
- **Root cause**: Unstable function identity passed into an effect-driven data hook whose deps include the function; the caller never memoizes the fetcher.
- **Impact**: Continuous back-to-back Tauri IPC / DB blast-radius queries while a destructive-confirmation modal is up, plus a `loading` flicker in `BlastRadiusPanel`. Bounded only by how long the user leaves the dialog open.
- **Fix sketch**: In `CredentialDeleteDialog`, wrap the fetcher: `const fetcher = useCallback(() => getCredentialBlastRadius(credentialId), [credentialId])` and pass that to `useBlastRadius`. Alternatively (defense in depth), change `useBlastRadius` to accept an id/key dep instead of a raw function, or keep the fetcher in a ref and depend only on `enabled`. Audit the other `useBlastRadius` call sites for the same inline-arrow pattern.

## 2. ConnectionTestSection hand-rolls a hover tooltip instead of using the shared Tooltip
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_credentials/components/forms/ConnectionTestSection.tsx:50-68
- **Scenario**: The `testHint` info button reimplements a tooltip with local `useState` + `onMouseEnter/onMouseLeave` + a hand-positioned absolute div, while sibling files in the same folder (`OAuthSection.tsx`, `FormActions.tsx`) use the shared `@/features/shared/components/display/Tooltip` for the exact same "hint on hover" job.
- **Root cause**: Local one-off implementation predating (or ignoring) the shared Tooltip component.
- **Impact**: Duplicated behavior with drift: this variant has no delay, no keyboard/focus trigger (mouse-only, an a11y regression vs the shared one), a hardcoded z-20/placement, and every hover toggles component state causing a re-render of the whole section.
- **Fix sketch**: Replace the `showTestHint` state and the manual popover div with `<Tooltip content={testHint} placement="right" delay={200}>` wrapping the info button, matching the pattern already used in `OAuthSection.tsx:64` and `FormActions.tsx:62`. Deletes ~18 lines and the state hook.

## 3. FormActions declares and receives a `fields` prop it never uses
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_credentials/components/forms/FormActions.tsx:11
- **Scenario**: `FormActionsProps` requires `fields: CredentialTemplateField[]` and the only caller (`CredentialEditForm.tsx:163`) dutifully passes it, but the component body destructures every prop except `fields` and never references it. The `CredentialTemplateField` import exists solely to type the dead prop.
- **Root cause**: Leftover from an earlier version (the comment at line 33 suggests the trust badge once keyed off password fields; that logic was removed but the prop stayed).
- **Impact**: Misleading API — readers and future callers assume the fields influence rendering; the required prop also forces callers to thread data they don't need.
- **Fix sketch**: Remove `fields` from `FormActionsProps`, drop the `CredentialTemplateField` import, and delete `fields={fields}` at the CredentialEditForm call site. Single-caller verified via grep; no other usages in src/.

## 4. usePostSaveResourcePicker: promptIfScoped and editScope are near-duplicates
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker.tsx:33-69
- **Scenario**: Both callbacks do the identical connector lookup, `resources` extraction, empty-guard, and `prompt(...)` call; the only difference is `editScope` forwarding an optional `initial`. Any change to the lookup logic (e.g. matching on something other than `c.name`) must be made twice.
- **Root cause**: `editScope` was added later by copy-pasting `promptIfScoped` and adding one field.
- **Impact**: ~25 lines of duplicated logic with a real drift hazard in a security-relevant flow (resource scoping).
- **Fix sketch**: Implement one internal `openPicker({ credentialId, serviceType, initial }: EditArgs)` and expose `promptIfScoped = (args) => openPicker(args)` and `editScope = openPicker` (or just export the single function with optional `initial`). Keep both exported names to avoid touching callers.

## 5. useRotateAll: serial rotation loop and an unmanaged 6s result timeout
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/vault/sub_credentials/manager/useRotateAll.ts:39-50
- **Scenario**: "Rotate all" awaits `rotateCredentialNow` one credential at a time, so N OAuth credentials take N sequential round-trips; afterwards a bare `setTimeout(() => setRotateAllResult(null), 6000)` is never stored or cleared — if the user triggers rotate-all again within 6s, the stale timer wipes the fresh result banner early, and on unmount the timer fires against an unmounted component.
- **Root cause**: Fire-and-forget timeout with no cleanup, and no concurrency in the rotation loop.
- **Impact**: Bounded: occasional premature disappearance of the result summary and wasted wall-clock time on multi-credential vaults (rotation is a deliberate, infrequent action). No unbounded growth.
- **Fix sketch**: Keep the timer id in a ref, `clearTimeout` at the start of `handleRotateAll` and in a `useEffect` cleanup. If provider rate limits allow, rotate with `Promise.allSettled` (or a small concurrency cap of 2-3) and tally results from the settled array. Serial-by-design is acceptable — the timer hygiene is the actual fix.
