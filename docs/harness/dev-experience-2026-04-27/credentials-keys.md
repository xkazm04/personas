# Credentials & Keys — Dev Experience Scan

> Total: 12 · Critical: 1 · High: 4 · Medium: 5 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Zero UI tests for the most security-sensitive flow (clipboard/show-secret)

- **Severity**: Critical
- **Category**: testing
- **File**: `src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:52-171`
- **Scenario**: `FieldActionButtons` is the only place that handles plaintext secrets in the clipboard, the eye-toggle (show/hide), and the auto-wipe TTL (`SECRET_CLIPBOARD_TTL_MS = 30_000`). Despite being the highest-blast-radius component in the entire client (a regression here leaks secrets to the OS clipboard or shoulder-surfers), there is no co-located test file. Glob across the repo finds zero `FieldCapture*.test.*`, zero tests under `vault/**/*.test.*` for credentials, and only one API-mock test (`src/api/__tests__/credentials.test.ts`).
- **Root cause**: Tests for the credential domain were never added; only the database sub-feature has component tests (`sub_databases/__tests__`). The "auto-wipe if clipboard still equals copied value" branch is non-trivial logic that nobody is exercising.
- **Impact**: Any refactor of the clipboard/eye-toggle silently risks: (a) wiping a value the user copied afterwards, (b) failing to wipe at all, (c) the eye toggle persisting `isVisible=true` after blur. A CI run gives zero confidence on the most security-relevant module. Manual verification before each release is the only safety net.
- **Fix sketch**: Add `FieldCaptureHelpers.test.tsx` with three scenarios using fake timers + a mocked `navigator.clipboard`: (1) copy then advance 30s — clipboard equals copied → write `''`; (2) copy, then user copies different value → clipboard wipe is skipped; (3) eye toggle flips input `type` between `password`/`text`. Assert never against the actual secret value (use a placeholder like `"SECRET-1"`), only against state transitions.

---

## 2. Two parallel implementations of the OAuth-completion-with-pending-values pattern

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/vault/shared/hooks/useCredentialOAuth.ts:23-84`, `src/features/vault/sub_credentials/components/workspace/useWorkspaceConnect.ts:54-167`
- **Scenario**: Both hooks (a) call `useGoogleOAuth`, (b) stash pending form values in a ref to keep them out of DevTools/Sentry, (c) on success merge `refresh_token`/`scope`/`completed_at`/`client_mode='app_managed'` into a credential payload, and (d) call `promptIfScoped` after save. Workspace adds multi-service iteration; otherwise the merge logic is duplicated character-for-character (note the identical use of `OAUTH_FIELD.SCOPE`, `OAUTH_FIELD.COMPLETED_AT`, `OAUTH_FIELD.CLIENT_MODE`).
- **Root cause**: The workspace flow was added later without extracting the shared post-OAuth credential-build helper.
- **Impact**: Drift risk on a sensitive code path. If one hook learns about a new OAuth field (e.g. `id_token`, audience claim) and the other doesn't, single-service vs workspace credentials silently diverge in shape. Reviewers must check two sites for every change.
- **Fix sketch**: Extract `buildOAuthCredentialPayload({ refreshToken, scope, fallbackScopes, extraFields })` into `shared/hooks/oauthPayload.ts`. Both hooks call it. As a bonus, this is also where the `client_id`/`client_secret` strip-from-pending logic should live (currently inline in `useCredentialOAuth.ts:42`).

---

## 3. Three near-identical "fetch on credentialId" effects with try/finally + cancelled flag

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx:43-64`, `src/features/vault/sub_credentials/components/features/CredentialAuditTimeline.tsx:33-50`, `src/features/vault/sub_credentials/components/features/OAuthTokenMetricsPanel.tsx:16-32`
- **Scenario**: Same 18-line pattern in three files: `let cancelled = false; setLoading(true); Promise.all([api1(id), api2(id)]).then(([a,b]) => { if(cancelled) return; setA(a); setB(b); }).catch(...).finally(...); return () => { cancelled = true; }`. Each one re-implements: cancellation via boolean, error-swallowing (one logs, one logs, one is silent — drift!), separate `loading` state, and parallel fetch-gather.
- **Root cause**: No shared "load-by-id with cancellation" hook. `CredentialIntelligence` even fetches the same audit log that `CredentialAuditTimeline` fetches — a second time — when both render (intelligence tab loads then audit tab loads).
- **Impact**: 3× the surface area for cancellation bugs (e.g. the silent `catch(() => {})` in `OAuthTokenMetricsPanel.tsx:29` swallows real errors users would want to know about). Every new "details panel" copies this pattern. Audit log gets fetched twice when both panels are visible.
- **Fix sketch**: Extract `useCredentialDetailsLoader<T>(credentialId, fetchers)` returning `{ data, loading, error }` with built-in cancellation. Wire all three panels through it, and de-dupe the audit-log fetch via a shared module cache (the pattern already exists for health: see `useCredentialHealth.ts` `resultCache`).

---

## 4. Inconsistent error-handling idioms across vault store slices

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/stores/slices/vault/credentialSlice.ts:67,69,93,95`, `src/stores/slices/vault/automationSlice.ts:42-45`, `src/stores/slices/vault/rotationSlice.ts:53-55`, `src/stores/slices/vault/databaseSlice.ts:60-61`
- **Scenario**: Four different reactions to errors in the same module:
  - `credentialSlice.fetchCredentials` calls `reportError(...)` then `throw err`
  - `credentialSlice.updateCredential` calls `reportError(...)` and silently returns (no throw)
  - `automationSlice.deleteAutomation` mutates state optimistically, then on error re-fetches the entire list
  - `credentialSlice.deleteCredential` uses a `pendingDeleteCredentialIds` set
  - `rotationSlice.fetchRotationStatus` returns `null` on error
- **Root cause**: No store-slice error-handling contract. Each slice author chose their own; reviewers and consumers cannot predict which actions throw.
- **Impact**: Callers must defensively wrap arbitrary slice calls because they cannot tell from the type signature whether an error becomes a toast, a thrown promise, or a silent no-op. `useCredentialManagerState.ts:104` calls `Promise.all([fetchCredentials(), fetchConnectorDefinitions()])` — only one of these throws, so a connector-fetch failure silently leaves the manager in a degraded state.
- **Fix sketch**: Decide one rule (e.g. "all slice actions return `{ ok: true } | { ok: false, error }` and never throw" OR "all slice actions throw and consumers `.catch`"). Document in `docs/DEVELOPMENT.md`. Add an ESLint rule `no-restricted-syntax` to flag bare `set({ error: ... })` outside `reportError`.

---

## 5. `pendingDeleteCredentialIds` set + optimistic-revert pattern duplicated for events

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/stores/slices/vault/credentialSlice.ts:125-151,301-325`
- **Scenario**: `deleteCredential` and `deleteCredentialEvent` implement identical 25-line optimistic-delete-with-revert: build new Set, call API, on success filter array + remove from pending, on failure remove from pending + reportError. Same skeleton.
- **Root cause**: Pattern wasn't extracted when the events delete was added.
- **Impact**: The next "soft delete" (e.g. delete rotation policy, delete connector) is likely to copy this again. Hard to keep them in sync if the UI contract changes (e.g. add a 5-second toast undo window).
- **Fix sketch**: Extract `optimisticDelete<T>({ id, pendingSetKey, listKey, apiCall })` slice helper, or a higher-order action factory. Reduces to 1-line call sites and keeps the "what does pending-delete UX look like" decision in one place.

---

## 6. Two parallel optimistic-update patterns: `automationSlice` re-fetches, `credentialSlice` patches in place

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/stores/slices/vault/credentialSlice.ts:115-118` vs `src/stores/slices/vault/automationSlice.ts:78-83`
- **Scenario**: `credentialSlice.updateCredential` patches the array in place after API success. `automationSlice.deleteAutomation` mutates optimistically then re-fetches the entire list on error. `credentialSlice.deleteCredential` uses pending-IDs. Three different optimistic strategies in the same store.
- **Root cause**: No shared decision on optimistic-vs-pessimistic.
- **Impact**: When investigating a "stale UI after edit" bug, devs can't predict which update style each slice uses. Cognitive overhead grows linearly with slice count.
- **Fix sketch**: Pick one (recommend in-place patch with optional pending-set for destructive actions) and document in slice comment header.

---

## 7. `isCredentialRotatable` baked into `useRotateAll`, can't be reused

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/vault/sub_credentials/manager/useRotateAll.ts:20-30`
- **Scenario**: The "is this credential rotatable" predicate (does its connector declare an OAuth method?) is defined inside `useRotateAll`. The same logic is needed by `RotationPolicyControls`, `BadgeRow`, the rotation-section gating, and probably the bulk healthcheck filter — all of which currently re-check by inspecting `credential.oauth_token_expires_at`/`oauth_refresh_count` instead.
- **Root cause**: Predicate hidden inside a hook. There's no `lib/utils/credentialCapabilities.ts` to centralize "what can this credential do."
- **Impact**: The two definitions ("has oauth field" vs "connector declares oauth auth method") are subtly different and can disagree. UI shows the rotation tab based on one definition, but the rotate-all skips/includes based on the other. Subtle UX mismatches at scale.
- **Fix sketch**: Extract `isOAuthCredential(cred, connector)` and `isRotatable(cred, connector)` into `src/features/vault/shared/utils/credentialCapabilities.ts`. Use everywhere. Add unit tests for the truth table.

---

## 8. `setTimeout(..., 6000)` to clear rotate-all toast — fragile pattern repeated

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/vault/sub_credentials/manager/useRotateAll.ts:50`, similar in `FieldCaptureHelpers.tsx:92` (1500ms `copied` flag)
- **Scenario**: Both use raw `setTimeout` to auto-clear UI flags. `useRotateAll` has no cleanup — if the component unmounts during the 6-second window, the timer still calls `setRotateAllResult(null)` on an unmounted component and triggers a React warning.
- **Root cause**: Manual timer management instead of a `useAutoClearFlag` hook.
- **Impact**: Memory leaks, "can't update unmounted component" warnings spam dev console, hides real warnings.
- **Fix sketch**: Add `useAutoClearAfter(value, ms, setter)` hook in `lib/utils/hooks/`. Or just store cleanup ref like `FieldCaptureHelpers` already does and clear on unmount.

---

## 9. `IMPORT_SOURCES` × `parseXxxOutput` × `SERVICE_PATTERNS` lookup tables grow without index

- **Severity**: Medium
- **Category**: documentation
- **File**: `src/features/vault/sub_credentials/components/import/importTypes.ts:113-146,300-308`
- **Scenario**: Three parallel arrays/switches that must stay in sync: `IMPORT_SOURCES` (5 entries), `parseImportInput` switch (5 cases), `SERVICE_PATTERNS` (32 connector mappings). Adding a 6th source means editing 3 places; adding a 33rd connector means editing both this file and probably the corresponding connector definition. There's no test asserting the switch covers every `ImportSourceId`, no doc telling new contributors how to add a source.
- **Root cause**: Organic growth without a "how to add an importer" runbook.
- **Impact**: Contributor friction. The TypeScript exhaustive-check on `parseImportInput` catches the switch case but won't catch a missing `IMPORT_SOURCES` entry or a mismatched `connectorName`.
- **Fix sketch**: Either (a) collapse into a single registry: `const IMPORT_REGISTRY: Record<ImportSourceId, { meta, parse }>` so adding a source is one struct, or (b) add a docstring at the top of the file with a 4-step "how to add an importer" recipe.

---

## 10. Field validation rules duplicated in `EditFormFields` and `FieldCaptureHelpers`

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/vault/sub_credentials/components/forms/EditFormFields.tsx:54-83`, `src/features/vault/sub_credentials/components/forms/FieldCaptureHelpers.tsx:16-31`
- **Scenario**: `useFieldValidation` (in EditFormFields) checks: required, URL protocol. `computeValidationGlow` (in FieldCaptureHelpers) checks: empty, URL parse, password ≥ 8 chars, password no spaces. The two systems (validation errors vs glow color) use overlapping but disjoint logic. A user typing a 5-char password sees an amber glow but no error message; a user with a non-https URL sees a red error AND the glow stays valid (URL parse succeeds for ftp).
- **Root cause**: Glow and validation evolved separately. No shared "field rules" object.
- **Impact**: User-facing inconsistency — glow says "ok" but submit fails, or vice versa. Adding a new rule (e.g. minimum 16-char API key) means editing both.
- **Fix sketch**: One `validateField(field, value): { error?, glow }` returning both signals. Then `EditFormFields` reads `error`, `FieldCaptureRow` reads `glow`. Single source of truth.

---

## 11. No type-safety bridge between API layer and store slice — `as unknown` hacks in tests

- **Severity**: Low
- **Category**: testing
- **File**: `src/api/__tests__/credentials.test.ts:41-48`
- **Scenario**: `await createCredential({ name: "test" } as unknown)` and `as unknown` again for `updateCredential`. The actual `CreateCredentialInput` shape (encrypted_data, iv, metadata, session_encrypted_data, healthcheck_passed) isn't validated by the test, so a backend type rename can break runtime without breaking the test.
- **Root cause**: Test was written to verify the IPC plumbing, not contract validity. Casting around the type makes it a smoke test only.
- **Impact**: Renaming a field in the Tauri binding wouldn't break tests but would break runtime. The test gives false confidence.
- **Fix sketch**: Either remove the `as unknown` and pass a real `CreateCredentialInput`, or add a separate contract test that imports the real binding type and asserts the shape via `expectTypeOf`.

---

## 12. `credentialDesign.ts` is a 4-line re-export shim — confusing for grep

- **Severity**: Low
- **Category**: code-organization
- **File**: `src/api/vault/credentialDesign.ts:1-5`
- **Scenario**: The whole file is `export * from "./credentialDesignApi"; export * from "./oauthGatewayApi"; export * from "../overview/healthcheckApi";`. Comment says "Re-export from focused modules for backward compatibility." Devs grepping for `startCredentialDesign` find both the implementation in `credentialDesignApi.ts` and a re-export here, plus they have to chase `oauthGatewayApi` through this file even though the names look design-related.
- **Root cause**: A refactor split the original file but kept the entry point for back-compat. Nothing tracks whether back-compat is still needed.
- **Impact**: Light papercut. Grep noise; new contributors confused about which is the canonical location.
- **Fix sketch**: Audit imports of `@/api/vault/credentialDesign`. If most/all import from the focused modules already, delete the shim. If still in use, leave a `@deprecated` JSDoc.
