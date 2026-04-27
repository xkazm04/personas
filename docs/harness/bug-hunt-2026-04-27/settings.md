# Bug Hunt — Settings

> Total: 13 | Critical: 1 | High: 6 | Medium: 5 | Low: 1

## 1. Stale closure in BYOM `handleSave` overwrites concurrent edits with old policy

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/settings/sub_byom/libs/useByomSettings.ts:118-144`
- **Scenario**: User edits a routing rule, clicks Save, then quickly toggles another rule before the IPC `setByomPolicy` resolves. While the request is in-flight, the user's toggle updates `policy` state, but `handleSave` snapshots `policy` only at the moment the callback was created. After `await` resolves, `savedSnapshotRef.current = snapshot` is set to the OLD snapshot. The new toggle is now considered "dirty" — fine — but if the user closes the tab the unsaved-changes guard fires unexpectedly. Worse, if the user double-clicks Save and the second click was deduped by `saveInFlightRef`, their newest edit is silently dropped from persistence (the old snapshot was sent and they assume it succeeded because of the toast).
- **Root cause**: `handleSave` clones `policy` at start (good) but the user's success toast lies — it says "Policy saved" while the latest in-memory state was never sent. The dedupe via `saveInFlightRef` swallows the second click that would have saved the latest edits.
- **Impact**: Silent data loss of last-second policy changes; misleading "saved" toast.
- **Fix sketch**: After save resolves, compare `policy` (current) vs the snapshot — if drift exists, queue another save or show "newer changes pending"; never dedupe the second click silently.

## 2. BYOM API key error messages can leak the secret value into Sentry / logs

- **Severity**: critical
- **Category**: secret-leak
- **File**: `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:98-108`
- **Scenario**: User pastes a malformed key (e.g. with stray newline / unicode). `setAppSetting(entry.def.settingsKey, value)` rejects with an error that may include the offending value in the message (Tauri IPC errors commonly include the rejected payload). `handleSave` does not wrap the call — the rejection propagates uncaught to React, which Sentry's `react-error-boundary` captures, including the raw API key in the stack/breadcrumb. Same risk in `handleDelete` and `handleTest`.
- **Root cause**: No try/catch around `setAppSetting` / `deleteAppSetting` / `getAppSetting`. Error surface is whatever the backend returns, with no scrubbing.
- **Impact**: Secret API keys (Ollama cloud, LiteLLM master) potentially exfiltrated to Sentry, telemetry, or browser console.
- **Fix sketch**: Wrap every settings IPC in try/catch; on error, log only `entry.def.settingsKey` + a generic "save failed" — never include `entry.value`. Also strip `value` from any Sentry breadcrumb attached at this boundary.

## 3. `connectionState='connected'` is success theater — verifies storage, not the API

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:123-140`
- **Scenario**: User enters an invalid Ollama key or a wrong LiteLLM URL, clicks "Verify". The handler simply re-reads the key from local storage. As long as a value was stored, the badge turns green ("Stored") with the misleading translation key `s.stored`. User believes the credential is valid; first real API call later fails confusingly.
- **Root cause**: Comment says "Simple connectivity test: verify the key is stored and retrievable" — the function name `handleTest` and the green check imply network validation. There is no actual reachability/auth check.
- **Impact**: Users ship broken BYOM configurations into production runs; debugging is opaque because the UI claimed success.
- **Fix sketch**: Either rename the badge to "Stored" (no green check, no `connected` semantic) or actually issue a `models.list` / health-check request to the configured endpoint.

## 4. URL field has zero validation — typo (`htttp://...`) silently accepted as base URL

- **Severity**: high
- **Category**: validation-gap
- **File**: `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:247-262`
- **Scenario**: User enters `htttp://localhost:4000` (typo) or `localhost:4000` (no scheme) or `http://localhost:4000/v1/` (trailing slash with path) for `litellm_base_url`. `<input type="url">` only validates inside a `<form>` with submit; here, Enter triggers `onSave` directly which calls `setAppSetting` with the unvalidated string. All later LiteLLM requests fail with cryptic fetch errors.
- **Root cause**: No client-side `new URL(value)` check; no rejection of file://, javascript:, or non-http schemes; no normalization.
- **Impact**: Confusing failures downstream; potential SSRF if the backend forwards to `file://` schemes; broken default routing for hours before the user notices.
- **Fix sketch**: Before save, `try { const u = new URL(value); if (!['http:','https:'].includes(u.protocol)) throw … } catch { reject }`. Show inline error.

## 5. Notifications debounce racing the unmount cleanup loses the last toggle

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/settings/sub_notifications/components/NotificationSettings.tsx:93-101`
- **Scenario**: User toggles a severity, then within 300ms switches to another settings tab. `SettingsPage`'s idle-sweep doesn't unmount immediately, but if the user switches tabs quickly enough (or the component re-renders due to `setting` reference changing), the `useEffect` cleanup runs `clearTimeout` BEFORE the 300ms `setTimeout` fires. The pending save is dropped. Toggle is lost. No error, no toast — the change is silently reverted on next mount.
- **Root cause**: Debounce-on-cleanup pattern. The dependency array `[setting.value]` is correct for re-debouncing on every change, but does not account for unmount. There is no flush-on-unmount.
- **Impact**: Users lose notification preference toggles when navigating fast. Also affects `WeeklyDigestToggle` (line 49-57, same pattern).
- **Fix sketch**: On cleanup, call `setting.save()` synchronously if the timer hadn't fired yet, OR persist immediately (no debounce) for cheap toggles — debounce is overkill for boolean writes.

## 6. Custom theme dirty-detection uses `JSON.stringify` with non-deterministic key order

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/settings/sub_appearance/components/CustomThemeCreator.tsx:60-61`
- **Scenario**: `existingConfig` was loaded from persisted store (e.g. zustand-persist serialized JSON). After deserialization, key order can differ from the order in the literal `draftConfig` object. `JSON.stringify(a) !== JSON.stringify(b)` will report dirty even though semantically equal. User sees a perpetual "Save & Apply" button that never settles to "Applied". Worse: when the gradient is toggled off, `backgroundEndColor` is set to null but `backgroundAngle` is `undefined` (line 46) — undefined is dropped by JSON.stringify on one side but not the other if the source had it explicitly.
- **Root cause**: Object equality via stringify is order-dependent and undefined-vs-missing-sensitive.
- **Impact**: Confusing "always dirty" state on the custom theme creator; users repeatedly hit Save thinking nothing was saved.
- **Fix sketch**: Use a stable shallow-key comparator like the `policyEqual` pattern from BYOM, or sort keys before stringifying.

## 7. Tour reset relies on 50ms `setTimeout` race to bypass startTour guard

- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/settings/sub_admin/components/AdminSettings.tsx:28-36`
- **Scenario**: `handleForceStart` calls `resetTour()` then `setTimeout(... startTour, 50)`. If React batches the reset state update past 50ms (slow render, devtools open, low-end machine), `startTour` will see the OLD `tourCompleted=true` / `tourDismissed=true` flags and silently no-op. The user clicks "Force Start", nothing happens, no error.
- **Root cause**: Comment admits `startTour guard checks tourCompleted/tourDismissed` and assumes the reset has propagated. State propagation is not guaranteed within 50ms.
- **Impact**: Force-start unreliably starts the tour; no fallback or error reporting.
- **Fix sketch**: Use `useSystemStore.getState()` to read state synchronously after reset, OR add a `forceStartTour()` action that bypasses guards atomically.

## 8. Telemetry toggle has no rollback on failure and dual sources of truth

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/settings/sub_account/components/AccountSettings.tsx:19,57-63`
- **Scenario**: `useState(isTelemetryEnabled)` reads the value ONCE on mount (calling the function as initializer). If telemetry is later toggled elsewhere (e.g. consent modal, CLI flag, another window in multi-window scenario), this component shows stale state. Also, `setTelemetryEnabled` could throw (localStorage quota, sandbox restrictions); the `try` around it is missing — `setTelemetryOn(next)` runs anyway showing the new state even if persistence failed.
- **Root cause**: Optimistic local state with no error path and no subscription to the underlying source.
- **Impact**: User toggles telemetry off, app continues sending telemetry; restart "fix" doesn't fix anything because the new value never persisted.
- **Fix sketch**: Subscribe via a custom hook or store. Wrap setter in try/catch; revert local state on throw and surface error.

## 9. Audit log "auto-fetched once per session" never refreshes

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/settings/sub_byom/libs/useByomSettings.ts:82-116`
- **Scenario**: `fetchedTabs.current.add('audit')` makes the audit fetch fire exactly once per hook lifetime. With `SettingsPage` keeping tabs mounted for 30s after switching away, the audit log can be hours stale. There is no manual refresh button on `ByomAuditLog.tsx`. User sees an empty / stale list and concludes the system isn't working.
- **Root cause**: Cache-on-first-visit with no invalidation, no refresh, no time-based expiry.
- **Impact**: Stale audit data confuses debugging and compliance verification.
- **Fix sketch**: Add a refresh button to ByomAuditLog header that calls a `refetchAuditLog` exposed by the hook; OR re-fetch when the tab becomes active after >N seconds.

## 10. Credential import: blocked while `credImportFilePath` is set has no escape hatch

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/settings/sub_portability/libs/useDataPortability.ts:129-134`
- **Scenario**: User starts credential import, sees conflicts, then closes the modal / abandons the resolution UI. `credImportFilePath` is still set. Now the user reopens "Import Credentials" with a different export bundle and a different passphrase. `handleCredImport` returns early at line 133 (`if (credImportFilePath) return`) silently. No error, no toast — the Import button appears to do nothing forever until the user reloads the app.
- **Root cause**: Pending-resolution state is not user-visible and has no cancel button. The guard is correct in intent (preventing double-import) but lacks UX recovery.
- **Impact**: Users get stuck unable to import; only fix is app reload.
- **Fix sketch**: Show a banner "Pending conflict resolution from previous import" with a Cancel button that clears `credImportFilePath`, `credImportResult`, `credImportPassphrase`.

## 11. Custom theme reset overwrites store but discards in-flight color picker open state

- **Severity**: low
- **Category**: cleanup-gap
- **File**: `src/features/settings/sub_appearance/components/ColorRow.tsx:24-27`, `CustomThemeCreator.tsx:67-82`
- **Scenario**: User has a color picker popover open on a `ColorRow`. They click Reset on the parent. State changes propagate, but the popover (`open` is local to ColorRow) stays open and now shows the stale color picker for a now-reset value. Click-outside isn't triggered because the click was inside the parent. Visually inconsistent until manual dismiss.
- **Root cause**: Local UI state in child components isn't reset when the parent's data changes drastically.
- **Impact**: Cosmetic — picker shows wrong color briefly, may apply wrong color if user clicks a swatch.
- **Fix sketch**: Pass a `key` from parent that changes on reset, forcing remount; OR pass `closeAllPickers` callback ref.

## 12. Translation export iterates 14 locales serially, blocking on every failed import

- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/settings/sub_appearance/components/TranslationContributor.tsx:83-99`
- **Scenario**: On mount, the effect serially `await loadBundle(lang.code)` for each of 14 languages. If a locale JSON 404s or chokes, the whole sequence stalls (the for-loop awaits, error is caught, but each network roundtrip is sequential). On a slow network, coverage data takes 14× the slowest fetch. During this time, users see "0%" coverage for every uncomputed locale. The "current language" panel may say `0/N (0%)` even for English (which is the active language) because the bundle hasn't loaded yet.
- **Root cause**: `for...of` with `await` instead of `Promise.allSettled`.
- **Impact**: Long perceived loading; misleading 0% coverage badges.
- **Fix sketch**: `await Promise.allSettled(ALL_LANGUAGES.map((l) => loadBundle(l.code).then(...)))`.

## 13. Ambient context auto-refresh leaks across persona switches

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/settings/components/AmbientContextPanel.tsx:74-81`
- **Scenario**: User has persona A selected; the 5-second `setInterval` fires `fetchAmbientSnapshot(selectedPersonaId)`. User switches to persona B mid-tick. The interval is cleaned up via `clearInterval` in the next effect run, but a stale fetch already in-flight for persona A may resolve AFTER the new effect set up persona B's interval. The store gets persona A's snapshot written while persona B is selected — UI shows persona A's data labeled as persona B. Same vulnerability in `handlePolicyChange` (line 87-95): `updateSensoryPolicy(selectedPersonaId, ...)` captures `selectedPersonaId` from closure that may already be stale by the time the IPC fires.
- **Root cause**: Async functions don't carry a "this fetch is for persona X, ignore if X is no longer current" guard; closure captures the persona id but the resolve order isn't enforced.
- **Impact**: Cross-persona data bleed in the ambient panel; incorrect policy writes when switching personas during an in-flight save.
- **Fix sketch**: Track an `epoch` counter that increments on persona change; in the .then() handler, ignore the result if the epoch has changed. For writes, capture the persona id locally and verify on resolve before storing.
