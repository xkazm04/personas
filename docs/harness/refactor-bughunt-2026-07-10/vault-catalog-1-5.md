> Context: vault/catalog [1/5]
> Total: 7
> Critical: 0  High: 0  Medium: 3  Low: 4

## 1. Schema-form Save records `healthcheck_passed: true` for untested edited values
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx:157,208-218 (with CredentialEditForm.tsx:76-78)
- **Scenario**: User runs Test Connection on an MCP/custom/database subtype → `health.result.success === true`. They then edit a field value (e.g. paste a different `api_key`) and click Save. `handleSave` writes `healthcheck_passed: health.result?.success === true`, which is still `true`. The credential is persisted as "healthchecked OK" even though the saved secret was never tested.
- **Root cause**: `<CredentialEditForm>` is rendered here WITHOUT the `onValuesChanged` prop, and health is only invalidated in `handleSubTypeChange`, never on a field edit. The design-modal path (`useCredentialDesignOrchestrator.handleValuesChanged`) *does* invalidate health on every change, so this form is inconsistent with the rest of the vault.
- **Impact**: Success theater — a credential is stored/displayed as healthy when its actual secret is unverified; can mislead status badges and rotation logic. UX: user believes a broken credential is validated.
- **Fix sketch**: Pass `onValuesChanged={() => health.invalidate()}` (or a wrapper) into `<CredentialEditForm>` in CredentialSchemaForm, mirroring the orchestrator. Alternatively, in `handleSave` require `health.result` to correspond to the current `fieldValues` before recording `healthcheck_passed`.

## 2. `__procedure_log` transport field is persisted into credential secret data
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts:146-149; src/features/vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts:190-205
- **Scenario**: After a browser automation run, the adapter injects the full playwright procedure log into the extracted values map: `(values as Record<string,string>).__procedure_log = result.procedure_log`. `useAutoCredSession.save` then calls `createCredential({ data: extractedValues, ... })` with no filtering, so `__procedure_log` (a potentially large, non-secret transcript) is written into the credential's encrypted `data` blob alongside real secret fields. It is only meant as an in-memory handle for the dev-only "save procedure" button (ReviewActions.tsx:75).
- **Root cause**: A UI/transport-only key is smuggled through the same `ExtractedValues` record that becomes persisted credential data; there is no allowlist/strip step before `createCredential`.
- **Impact**: Data pollution of the secret store (bloat, and the log may embed URLs/identifiers); `checkFieldCompleteness` also ignores it so it silently rides along. Maintainability + minor privacy.
- **Fix sketch**: Strip `__`-prefixed keys before `createCredential` in `save` (e.g. `Object.fromEntries(Object.entries(extractedValues).filter(([k]) => !k.startsWith('__')))`), or carry `procedure_log` in a separate session field instead of inside `extractedValues`.

## 3. Abort handler cancels browser sessions globally via singleton adapter
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts:105-111
- **Scenario**: `tauriPlaywrightAdapter`/`tauriGuidedAdapter` are module-level singletons. The abort handler calls `cancelAutoCredBrowser()` with no `session_id`, while progress events are per-session filtered by `sessionId`. If an old panel unmounts and its `AbortSignal` fires just after a new `AutoCredPanel` has started a fresh run through the same singleton, the stale abort cancels the newer session's backend browser.
- **Root cause**: Cancellation is session-scoped everywhere else (events carry `session_id`) but the cancel IPC is global, and the adapter instance is shared.
- **Impact**: Rare mis-cancellation of a concurrent/rapid re-open flow. Narrow because two simultaneous auto-cred runs are uncommon.
- **Fix sketch**: Thread `sessionId` into `cancelAutoCredBrowser(sessionId)` and have the backend ignore cancels for non-active sessions, or instantiate a fresh adapter per session instead of using module singletons.

## 4. Duplicated auth-detection filter+map block (orchestrator vs NegotiatorPanel)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts:53-64; src/features/vault/sub_catalog/components/negotiator/NegotiatorPanel.tsx:33-44
- **Scenario**: Both files call `detectAuthenticatedServices()` then run the identical `detections.filter((d) => d.authenticated).map((d) => ({ serviceType: d.service_type, method: d.method, authenticated: d.authenticated, identity: d.identity, confidence: d.confidence }))` snake→camel remap into `AuthDetectionInfo[]`. Verified by grep: the exact `.filter((d) => d.authenticated)` block exists only in these two files, and the prefetch in the orchestrator exists precisely to warm the negotiator's copy.
- **Root cause**: The snake_case→`AuthDetectionInfo` adapter was inlined at both call sites instead of living next to `detectAuthenticatedServices` / the `AuthDetectionInfo` type.
- **Impact**: Maintainability — a field added to `AuthDetectionInfo` must be edited in two places; risk of drift between prefetch and fallback paths.
- **Fix sketch**: Export a `toAuthDetectionInfo(detections)` helper from `@/api/auth/authDetect` (or `useCredentialNegotiator`) and call it in both spots.

## 5. `extractFirstUrl` re-duplicates the URL regex + stale `URL_PATTERN_SOURCE` doc reference
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts:158,161,169-173
- **Scenario**: `URL_REGEX` is defined once (global), but `extractFirstUrl` hardcodes a second, byte-for-byte copy of the same pattern (`/https?:\/\/[^\s)>\]"'`*_]+/`) to avoid sharing `lastIndex`. The JSDoc also tells callers to "use `URL_PATTERN_SOURCE`" — grep confirms no `URL_PATTERN_SOURCE` identifier exists anywhere in `src`, so the guidance is dead.
- **Root cause**: A planned `URL_PATTERN_SOURCE` constant was documented but never created; the pattern literal was copy-pasted instead of derived from `URL_REGEX.source`.
- **Impact**: Maintainability — the two regex copies can silently diverge; misleading doc comment.
- **Fix sketch**: Add `export const URL_PATTERN_SOURCE = URL_REGEX.source;` and build the one-shot matcher via `new RegExp(URL_PATTERN_SOURCE)` inside `extractFirstUrl`; or drop the stale doc line.

## 6. `deriveSessionState` and `deriveEntryPhase` duplicate the type→SessionState mapping
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts:13-22,128-134
- **Scenario**: Both functions encode the same rule set (`warning`/`input_request` → `action_required`, `url` → `opening_url`, `action`/`info` → `working`). `deriveSessionState` scans from the tail of the log; `deriveEntryPhase` classifies a single group — but the per-type decision table is identical and must be kept in sync by hand.
- **Root cause**: The shared "log entry type → phase" mapping was inlined twice rather than factored into one `entryTypeToState(type)` helper.
- **Impact**: Maintainability — adding a new `BrowserLogEntry` type requires editing both.
- **Fix sketch**: Extract `function entryTypeToState(type: BrowserLogEntry['type']): SessionState` and have both call it.

## 7. `mergedOAuthValues` memo has unstable object deps (recomputes every render)
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator.ts:96-99
- **Scenario**: `useMemo(() => ({ ...oauth.getValues(), ...universalOAuth.getValues(), ...negotiatorValues }), [oauth, universalOAuth, negotiatorValues])`. `oauth` and `universalOAuth` are fresh hook-return objects on every render, so the memo never hits its cache — the spread runs each render and `mergedOAuthValues` is a new reference each time, cascading into `useFieldValidation` and the `buildContextValue` object.
- **Root cause**: Depending on whole hook objects rather than their stable value slices.
- **Impact**: Minor perf/churn; defeats the memo's purpose. Not a correctness bug.
- **Fix sketch**: Depend on `oauth.getValues()`/`universalOAuth.getValues()` results (or the underlying value maps) instead of the hook objects, or memoize the getters upstream.
