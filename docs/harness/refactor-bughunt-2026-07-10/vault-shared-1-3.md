> Context: vault/shared [1/3]
> Total: 7
> Critical: 0  High: 1  Medium: 3  Low: 3

## 1. Remediation casing mismatch defeats fast-path skip and reason messages
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case / silent-failure
- **File**: src/features/vault/shared/hooks/health/useRemediationEvaluator.ts:80,179-196
- **Scenario**: The canonical `Remediation` binding (src/lib/bindings/Remediation.ts) serializes PascalCase: `"Healthy" | "BackoffRetry" | "PreemptiveRotation" | "RotateThenAlert" | "Disable"`. This hook instead compares against lowercase snake_case. Line 80 skips healthy credentials with `embeddedRemediation === 'healthy'` — a real `anomaly_score.remediation` value is `'Healthy'`, so the skip **never fires**; every credential falls through to a `getRotationStatus(cred.id)` IPC call on every 30-min cycle (and the 15s startup pass), defeating the documented "no API call for healthy creds" optimization. Worse, `buildReason` (179-196) switches on `'backoff_retry' | 'preemptive_rotation' | 'rotate_then_alert' | 'disable'`, none of which match the PascalCase values passed from line 104, so **every dispatched remediation event gets the generic `Remediation level: <x>` fallback** instead of the descriptive human-readable reason.
- **Root cause**: File authored against an assumed snake_case wire format; the actual ts-rs enum is PascalCase. `actionsForRemediation` (remediationBus.ts) correctly uses PascalCase, so only this file is out of sync.
- **Impact**: Perf (N redundant IPC calls per cycle for all-healthy vaults) + UX (remediation notifications carry a useless generic reason). No false remediation because `actionsForRemediation` still returns `[]` for `'Healthy'`.
- **Fix sketch**: Change line 80 to `=== 'Healthy'` and rewrite `buildReason`'s cases to the PascalCase `Remediation` literals (or key off the typed union so the compiler enforces exhaustiveness).

## 2. Headers section in RequestBuilder is mislabeled "Actions"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / UX
- **File**: src/features/vault/shared/playground/RequestBuilder.tsx:114-120
- **Scenario**: The query-params editor is wrapped in `<Section label={vt.query_parameters}>`, but the **headers** `KeyValueEditor` immediately below is wrapped in `<Section label={t.common.actions}>`. So the request-headers editor renders under the heading "Actions", giving users no indication they are editing HTTP headers.
- **Root cause**: Wrong i18n key pasted for the headers section (no dedicated headers label was wired; `vt` has `path_parameters`/`query_parameters`/`body_label` but the headers label was substituted with the generic `common.actions`).
- **Impact**: UX/discoverability — the playground's header editor is unlabeled/misleading.
- **Fix sketch**: Add a `request_headers` (or reuse an existing headers) key under `t.vault.playground_extra` and use it here instead of `t.common.actions`.

## 3. Rename and tag writes fail silently (success theater)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/vault/shared/vector/VectorKbModal.tsx:70-92; src/features/vault/shared/playground/PlaygroundHeader.tsx:31-53,60-76
- **Scenario**: `saveName` (both files) and `persistTags` await `credApi.updateCredential(...)` inside a try whose catch is `silentCatch(...)`. On failure they still call `setIsEditingName(false)` and never surface an error or revert. The header renders `credential.name` (or `kb?.name`), so the user sees the *old* name after "saving" with no error — but many will read the closed editor as success, and if the store row briefly optimistically differs, state and backend diverge. Tag add/remove has the same swallow: a failed `persistTags` leaves the UI unchanged with no signal that the tag wasn't saved.
- **Root cause**: Write-path errors routed to `silentCatch` (appropriate for fire-and-forget reads, not for user-initiated mutations that must confirm).
- **Impact**: Data-integrity perception / UX — user believes a rename/tag persisted when it did not.
- **Fix sketch**: Surface a toast/inline error on catch and keep the editor open (or restore prior value explicitly) so the failure is visible; reserve `silentCatch` for genuinely non-critical paths.

## 4. Ephemeral preview health result resurrected into module cache after unmount
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition / state-corruption
- **File**: src/features/vault/shared/hooks/health/useCredentialHealth.ts:90-103,127-145
- **Scenario**: For `mode:'preview'`, the cleanup effect deletes `resultCache[key]` on unmount. But if a `check()` is still in flight, its `finally`/`try` runs `resultCache.set(key, r)` *after* the delete, re-inserting a `preview:<serviceType>` entry that nothing will subsequently clear (a fresh mount with the same serviceType only deletes `prevKey` when it differs). The next component that mounts the same preview key reads this stale result via `useModuleSubscription` and shows a healthcheck verdict from a prior, closed session.
- **Root cause**: In-flight async write races the unmount cache-delete; no in-flight guard/abort on preview keys.
- **Impact**: UX — stale/incorrect preview healthcheck shown on a subsequent connector-form open.
- **Fix sketch**: Track an "aborted" flag per check and skip `resultCache.set` if the hook unmounted, or re-delete the key in the check's `finally` when `targetMode === 'preview'` and the component is unmounted.

## 5. `RequestResponsePanel` is dead code duplicating the inline ApiExplorerTab panel
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: src/features/vault/shared/playground/tabs/ApiExplorerSubComponents.tsx:88-147
- **Scenario**: `RequestResponsePanel` (and its `RequestResponsePanelProps`) is exported but has zero importers (grep across src returns only its own definition). Meanwhile ApiExplorerTab.tsx:122-146 hand-inlines the exact same request/response grid (RequestBuilder + divider + ResponseViewer + error block). The extracted component was clearly meant to be used there but never wired.
- **Root cause**: Refactor extracted the panel into a shared component but the call site kept its inlined copy.
- **Impact**: Maintainability — two copies of the same markup drift independently; the "shared" one is unreachable.
- **Fix sketch**: Either delete `RequestResponsePanel`/`RequestResponsePanelProps`, or replace ApiExplorerTab's inline block (122-146) with `<RequestResponsePanel .../>` and remove the duplicate.

## 6. Duplicated credential rename-and-persist logic across headers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/shared/vector/VectorKbModal.tsx:66-92; src/features/vault/shared/playground/PlaygroundHeader.tsx:27-53
- **Scenario**: Both components carry a near-identical `isEditingName`/`editName`/`nameInputRef` block plus a `saveName` that trims, no-ops on unchanged, calls `credApi.updateCredential(id, {name,...null fields})`, maps via `toCredentialMetadata`, and patches `useVaultStore`. Same JSX (input + Enter/Escape handlers + Check button) is copied too.
- **Root cause**: Inline rename UX copy-pasted rather than extracted.
- **Impact**: Maintainability — a fix (e.g., the silent-failure in finding #3) must be applied in every copy.
- **Fix sketch**: Extract a `useCredentialRename(credential)` hook (returning `isEditing`, `editName`, `saveName`, handlers) and/or a small `<CredentialNameEditor>` and reuse in both.

## 7. Duplicated `formatSchema` / JSON pretty-print helpers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/shared/playground/EndpointRow.tsx:145-152
- **Scenario**: `formatSchema` (parse-then-stringify-with-fallback) is defined locally in EndpointRow.tsx while an identical `formatSchema` is imported from `./BuilderParams` in RequestBuilder.tsx, and ResponseViewer.tsx's `prettyBody` repeats the same try/JSON.parse/JSON.stringify(2)/catch-return-raw pattern.
- **Root cause**: Same tiny helper reimplemented in three playground files.
- **Impact**: Maintainability (minor) — trivial but repeated.
- **Fix sketch**: Export one `prettyJson(raw: string): string` from a shared playground util and import it in EndpointRow, RequestBuilder/BuilderParams, and ResponseViewer.
