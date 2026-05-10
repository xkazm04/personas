# Bug Hunt — Settings & Account

> Group: Settings, Sharing & Foundation
> Files scanned: 18
> Total: 2C / 5H / 5M / 2L = 14 findings

---

## 1. `register_claude_desktop_mcp` ungated — any renderer / IPC origin can rewrite Claude Desktop's global config

- **Severity**: critical
- **Category**: auth-bypass
- **File**: `src-tauri/src/commands/infrastructure/system/mcp_integration.rs:76`
- **Scenario**: A malicious webview, plugin iframe, or any context that can `invoke('register_claude_desktop_mcp')` causes the backend to write `mcpServers.personas` (with `command: "node"` and an attacker-influenceable script path resolved from `current_exe().ancestors()`) into `%APPDATA%/Claude/claude_desktop_config.json`. There is no `require_privileged_sync` / `require_auth_sync`. `unregister_claude_desktop_mcp` and `check_claude_desktop_mcp` are likewise ungated.
- **Root cause**: All other "modify host system config" commands in this codebase (e.g. external_api_keys.rs lines 21/35/44/55) gate through `require_privileged_sync`; this module skipped the gate entirely. Combined with `resolve_mcp_server_path` walking *every* ancestor of the exe and accepting the first `scripts/mcp-server/index.mjs` it finds, a planted file in any parent directory turns into Claude Desktop launching attacker code on next start.
- **Impact**: Persistent code-execution foothold in the user's primary AI client, written from a non-privileged surface. The change is silent — `tracing::info!` only.
- **Fix sketch**: Add `require_privileged_sync(&state, "register_claude_desktop_mcp")?` (and threaded `State<Arc<AppState>>`) to both register/unregister; canonicalize the resolved MCP path under the bundle's known resource dir instead of walking ancestors.

## 2. Frontend crash-log surface ungated — admin/secret leakage and tampering vector

- **Severity**: critical
- **Category**: secret-leak
- **File**: `src-tauri/src/commands/infrastructure/system/crash_telemetry.rs:13` (and 25, 40, 56, 75, 83, 88)
- **Scenario**: None of `get_crash_logs`, `clear_crash_logs`, `get_log_directory_stats`, `report_frontend_crash`, `get_frontend_crashes`, `clear_frontend_crashes`, `get_frontend_crash_count` calls `require_auth_sync` or `require_privileged_sync`. React error boundaries pipe `message`/`stack`/`component_stack` strings — which routinely contain caller arguments (BYOM keys passed into proxy fetches, OAuth tokens in headers, passphrases from `handleCredImport`) — into `report_frontend_crash`, which persists them indefinitely. Any other IPC origin can then `get_crash_logs` / `get_frontend_crashes` and harvest them, or `clear_frontend_crashes` to destroy audit evidence after a successful exfiltration.
- **Root cause**: `require_auth_sync` is currently a no-op (ipc_auth.rs:302) so even if it were called it wouldn't help — but nothing protects the *privileged* shape of these commands. They behave like sensitive log-stores but are wired up like public.
- **Impact**: Cross-renderer/cross-plugin exfiltration of any string ever shown to a React error boundary in the last 30 days, plus untraceable wipe of crash evidence.
- **Fix sketch**: Gate all read/clear ops with `require_privileged_sync`; redact `report_frontend_crash` payloads (truncate stack, strip query strings + Bearer tokens) before storing.

## 3. `ByomApiKeyManager` writes BYOM API keys to `app_settings` in plaintext (no encryption boundary)

- **Severity**: high
- **Category**: secret-leak
- **File**: `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:157`
- **Scenario**: `setAppSetting('ollama_api_key', value)` and `setAppSetting('litellm_master_key', value)` route into the same `app_settings` table that `health.rs:373-400` reads with `is_some_and(|k| !k.is_empty())`. Compare to the Personas-internal API key flow which stores SHA-256 (external_api_keys.rs comment lines 13-14): BYOM keys are stored verbatim. Anyone with read access to the SQLite DB file (other apps on Windows, leaked backups, previous-session plaintext tables) reads the keys. `data-portability` workspace export will include them in the bundle (passphrase optional).
- **Root cause**: Reuse of generic `app_settings` for secret values without a `secret_value` column or vault routing. Naming convention (`*_api_key`) conveys sensitivity to humans but not to the storage layer.
- **Impact**: BYOM secrets leak via every backup channel, including the optional-passphrase workspace export below.
- **Fix sketch**: Move BYOM keys into the credentials vault (used by encrypted `export_credentials` / `import_credentials`) instead of `app_settings`; require a non-empty passphrase for any export that would touch them.

## 4. Workspace `export_full` / `export_selective` accept passphrase = null (silent unencrypted export)

- **Severity**: high
- **Category**: export-overshare
- **File**: `src/api/system/dataPortability.ts:17` and `src/features/settings/sub_portability/libs/useDataPortability.ts:62`
- **Scenario**: The "Export workspace" button (`ExportSection.tsx:58`) calls `onOpenExportModal` → `handleExportSelective(..., undefined)` if the user doesn't enter a passphrase in the modal. The TS surface coerces `undefined → null` and the backend is invoked with no encryption. Compare to credential export (`useDataPortability.ts:114`) which enforces `length < 8` reject — the workspace export has no minimum, no warning, no guard.
- **Root cause**: Treating a passphrase as optional because "the user might just want a quick personal copy" — but the bundle already includes `credential_count` (DataPortabilitySettings.tsx:56 displays it). If credentials are part of the bundle they ride out unencrypted.
- **Impact**: A casual click + Save dialog produces a plaintext JSON of every persona, team, tool — and depending on backend bundling, possibly credentials — that the user assumes is "encrypted because there was a passphrase field".
- **Fix sketch**: Require passphrase ≥ 8 chars when `credentialIds.length > 0` (or any credential-bearing artifact is selected); show a banner explaining what unencrypted means.

## 5. `EngineSettings` capability toggle has 500ms write debounce that silently drops on tab unmount

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/hooks/utility/data/useEngineCapabilities.ts:79-86`
- **Scenario**: User clicks a capability matrix toggle. `persist()` schedules `setAppSetting(...)` 500ms later. The user clicks away to a different settings tab. After 30s of idleness the SettingsPage sweeper (SettingsPage.tsx:23) unmounts the engine tab. The closure-captured timeout fires, but if Vite/React StrictMode HMR or hot-reload restarted the module, or if the IPC call rejects, `silentCatch` swallows the error and the local `setCapabilities` state is gone — UI on remount shows the unsaved state until the user toggles something else.
- **Root cause**: `useEffect` cleanup never clears `saveTimeoutRef.current`. Combined with SettingsPage's aggressive 30s tab-unmount, an in-flight debounce can fire after the React tree is gone (no observable error), or be cancelled when the timeout id is no longer reachable from any mount.
- **Impact**: Engine capability changes look saved (UI reflects them) but on next app start revert. Users blame the feature, not the race.
- **Fix sketch**: Add a `useEffect` cleanup that flushes (`setAppSetting` immediately) on unmount; or replace the debounce with optimistic write-on-toggle.

## 6. BYOM ProviderRow `onClick` propagation lets background reveal-toggle leak the secret

- **Severity**: high
- **Category**: secret-leak
- **File**: `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:348-374`
- **Scenario**: The display row has `onClick={onStartEdit}` on the wrapper which sets `editing: true, revealed: true` (line 232). `onStartEdit` flips reveal *unconditionally*. A user demoing or screensharing who clicks the masked field to copy the prefix accidentally reveals the full key in cleartext; `onToggleReveal`'s eye-button correctly stops propagation, but the wrapper click does not require a separate intent.
- **Root cause**: Row-level click handler conflates "begin editing" with "reveal value", and both happen in one state patch (line 232).
- **Impact**: Real-world cleartext leakage during demos / screenshots / over-the-shoulder browsing — the very threat model masking is meant to defend.
- **Fix sketch**: `onStartEdit` should not set `revealed: true`; reveal should only happen via the explicit eye toggle.

## 7. `handleTest` shows "stored" badge even when DB returns the row but the value is empty

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:191-193`
- **Scenario**: `handleTest` sets state to `'stored'` if `getAppSetting(key)` returns any truthy value. After the user deletes a key (`handleDelete`), then quickly clicks "Verify" on a different row whose savedValue is also empty due to a race, or after `setAppSetting('', ...)` was rejected silently — the test passes if any historical value remains in another store layer. The function never compares against `entry.savedValue` to confirm what's stored *matches* what the UI thinks is stored.
- **Root cause**: "Stored" is treated as "non-null" rather than "matches entry.savedValue and is non-empty post-trim".
- **Impact**: Users believe their newly-rotated key is stored when an older value (or a placeholder) is what's actually persisted.
- **Fix sketch**: Compare `stored?.trim() === entry.savedValue.trim() && stored.length > 0` before reporting `'stored'`.

## 8. ThemeStore `injectCustomThemeStyle` runs before theme rehydrates → flash + style ghost

- **Severity**: medium
- **Category**: persistence-overflow
- **File**: `src/stores/themeStore.ts:265-278`
- **Scenario**: `onRehydrateStorage` calls `injectCustomThemeStyle` synchronously when `themeId === 'custom'`. If `state.customTheme` is corrupted (user manually edited localStorage; partial write from previous quit), `deriveCustomThemeVars` may return `undefined`s that get passed to CSS variables. The brightness pass then reads `getComputedStyle` on an inconsistent state and persists `--<token>-raw` values for tokens with empty resolved values — those `*-raw` overrides survive future theme switches because nothing clears them.
- **Root cause**: Brightness exemption logic copies whatever is currently computed, including transient bad values during rehydrate, and never clears the inline `*-raw` overrides on subsequent theme changes.
- **Impact**: After a single bad rehydrate, status colors (success / warning / error) can render in wrong tokens across all themes until the user clears localStorage.
- **Fix sketch**: Validate `state.customTheme` shape in `onRehydrateStorage` (drop on missing required fields); in `applyBrightness`, clear all `--*-raw` properties before re-setting.

## 9. AdminPanel "force start tour" calls `getState().startTour()` skipping the dismissed guard

- **Severity**: medium
- **Category**: gate-bypass
- **File**: `src/features/settings/sub_admin/components/AdminSettings.tsx:38-45`
- **Scenario**: `handleForceStart` calls `resetTour()` then immediately `useSystemStore.getState().startTour()`. Since both are sync `set()`s, the comment claims the guard is satisfied. But if `startTour` reads from a different slice that was *not* cleared by `resetTour` (e.g. if a future field is added to tourSlice and resetTour forgets it), the start succeeds while leaving stale flags. There's no explicit "force" parameter through the API — relies entirely on resetTour's completeness.
- **Root cause**: Implicit coupling: resetTour must clear every gating flag startTour reads. No invariant test.
- **Impact**: Future tourSlice additions silently break "force start"; an admin feature regresses to no-op without errors.
- **Fix sketch**: Add `startTour({ force: true })` that explicitly bypasses guards instead of relying on prior state cleanup.

## 10. `QualityGateSettings` reset confirm has 3s window race with successful first reset

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/settings/sub_quality_gates/components/QualityGateSettings.tsx:107-120`
- **Scenario**: User clicks "Reset defaults" → confirm flag goes true with a 3000ms `setTimeout(setConfirmReset, false)`. User clicks again at t=2.9s; `handleReset` calls `resetQualityGateConfig()` (network/IPC). If the call resolves at t=3.05s and the `setConfirmReset(false)` already fired at t=3.0s, `confirmReset` is now false, and any subsequent click starts a new "first click" (no confirmation) instead of being blocked. There's no in-flight guard.
- **Root cause**: Confirm gate uses only state, not "in flight" tracking; the timer is unaware of pending async ops.
- **Impact**: Double-reset under bad timing; if reset is destructive (clears user-customized rules), one accidental click can undo both the default rules and unsaved overrides.
- **Fix sketch**: Track `resetting` in-flight state; block additional clicks while pending; clear the timer when the IPC call starts.

## 11. ApiKeyRow delete confirmation timer leaks across rapid row remounts

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:262-272`
- **Scenario**: User clicks "Delete" on row A (sets `confirmDelete=true`, schedules `setConfirmDelete(false)` in 3s). User triggers `load()` (e.g. by clicking another row's revoke), which causes `keys` to refresh; React reconciles and may reuse the row component for a different key id. The 3s timer fires and resets confirm to false on a row that may now be a *different* key — but no leak of intent because state resets cleanly. Worse case: the first row's `confirmDelete` is briefly true on the new row id, so the very next click on the recycled row commits a delete on the *new* key. There's no key-keyed reset and no `clearTimeout` on unmount.
- **Root cause**: `confirmDelete` state lives in component, not keyed by `apiKey.id`. Timer is unmanaged.
- **Impact**: Wrong-key deletion under fast retry sequences.
- **Fix sketch**: Reset `confirmDelete` in a useEffect that depends on `apiKey.id`; clear timeout on unmount.

## 12. ExportSelectionModal `personaIds`/`teamIds` empty arrays mean "export all" rather than "export none"

- **Severity**: medium
- **Category**: export-overshare
- **File**: `src/features/settings/sub_portability/components/ExportSection.tsx:24` (interface) — passed through to backend
- **Scenario**: TS signature is `(personaIds: string[], teamIds: string[], credentialIds: string[], passphrase?: string)`. There's no client-side guard preventing `[]` from being submitted; the modal could allow "deselect everything → click Export" producing a `[]/[]/[]` call. If the backend interprets empty arrays as "export everything" (the typical convention because `export_full` is a separate command — but easy to confuse), an empty selection becomes a full unencrypted dump.
- **Root cause**: Frontend never asserts `personaIds.length || teamIds.length || credentialIds.length > 0`; the modal's export button is unconditionally enabled.
- **Impact**: User intends "abort, nothing selected" gets a full workspace export.
- **Fix sketch**: Disable Export button when all three lists are empty; have backend treat `[]/[]/[]` as a hard error rather than a wildcard.

## 13. `resetQualityGateConfig` returns `null`/undefined and silently leaves stale UI

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/features/settings/sub_quality_gates/components/QualityGateSettings.tsx:114-115`
- **Scenario**: `await resetQualityGateConfig()` — if backend ever returns `undefined` (validation error, repo poisoned), the call doesn't throw, `setConfig(undefined)` blanks the panel, the "active rules" subtitle disappears, and there's no error shown. Compared to the load path (line 96-99) which catches and surfaces, the reset path's catch is identical but the success path doesn't validate.
- **Root cause**: No null guard on the resolved value.
- **Impact**: User clicks reset, gate config goes blank, no error message — looks like the panel crashed.
- **Fix sketch**: `if (!cfg) throw new Error(s.error_loading); setConfig(cfg);`.

## 14. `applyThemeToDOM` uses module-level `transitionTimer` — concurrent theme switches racing across tabs/windows

- **Severity**: low
- **Category**: race-condition
- **File**: `src/stores/themeStore.ts:119-127`
- **Scenario**: `transitionTimer` is a module-level singleton. If the app exposes any iframe / secondary BrowserView using the same module instance, or if theme is set programmatically twice within 250ms (e.g. setTheme → clearCustomTheme), the first timer is cleared, but the `theme-transitioning` class is added twice and removed only once → permanent transitioning class until the next setTheme.
- **Root cause**: Mutable module-level state without per-element tracking.
- **Impact**: Slight: stuck transition class can pin a global animation, hurting perceived perf.
- **Fix sketch**: Read existing `theme-transitioning` and skip add if already present, or scope timer per documentElement via WeakMap.
