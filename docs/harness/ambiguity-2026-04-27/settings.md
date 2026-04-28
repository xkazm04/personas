# Ambiguity Audit — Settings

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~15
> Scope: Client-side Settings feature — tab harness, BYOM policy, engine capabilities, notifications, ambient context, portability, appearance, admin tools

## 1. Idle-tab unmount races with in-flight Suspense load

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/settings/components/SettingsPage.tsx:32-61
- **Scenario**: `mountedTabs` keeps a tab mounted as long as it is the active one OR was active within the last 30s. If a user opens a tab whose lazy chunk takes longer than `IDLE_UNMOUNT_MS` (30s) to download (slow network, cold cache, throttled bundle splitter), then switches away before the chunk resolves, the sweep will unmount the tab. When the user returns, the prior `<Suspense>` boundary may have already started a state update that lands after the new boundary mounts — React 19 surfaces this as warnings, but the silent failure mode is that `lastActive.current` for the original tab is deleted while a still-pending lazy promise resolves.
- **Root cause**: Idle eviction is keyed on time, not on whether the chunk has finished loading or whether the tab has rendered any user-edited state.
- **Impact**: On slow networks BYOM/Engine tabs may re-fetch and reset their unsaved state when re-mounted, silently throwing away dirty edits the user thought were preserved by the "tab kept mounted" model.
- **Fix sketch**:
  - Document the contract: "tabs keep state for 30s after blur, then are unmounted; unsaved changes will be lost".
  - Or skip eviction for tabs whose hook reports `isDirty` (BYOM hook already exposes this; Notifications doesn't).
  - Consider gating eviction on a "ready/loaded" flag rather than wall-clock time.

## 2. `IDLE_UNMOUNT_MS` and `SWEEP_INTERVAL_MS` are tuned by feel, not measurement

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/settings/components/SettingsPage.tsx:22-24
- **Scenario**: Two constants drive the entire tab eviction policy. The JSDoc says "this many ms of idleness" but does not record why 30s/5s were chosen versus 60s/10s or 5min/30s, nor what scenarios (memory pressure? perceived snappiness?) the values optimise for.
- **Root cause**: Choice of values has no recorded rationale or measurement.
- **Impact**: Any future developer tweaking these will not know which UX or memory budget to preserve, and there's no test to catch regressions.
- **Fix sketch**:
  - Add a comment with the rationale (e.g., "30s is long enough that a quick cross-tab check doesn't reset unsaved state, short enough that abandoned heavy panels release their listeners").
  - Or extract to a single named constant module shared with other lazy-tab harnesses.

## 3. `useByomSettings` falls back to open-access default on transient backend errors

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/settings/sub_byom/libs/useByomSettings.ts:86-103
- **Scenario**: On mount, `getByomPolicy()` is called. The catch-block treats every error as "stored JSON corrupt" and surfaces a banner — but `policy` state remains `defaultPolicy()` (which has `enabled: false`). If the IPC simply timed out or the worker is reloading, the UI shows "BYOM disabled, no allowed providers" while the user's actual saved policy on disk may be enforcing strict provider limits. If the user then clicks "Save" before the corrupt-error banner is read, the stored policy gets overwritten with the empty default.
- **Root cause**: No distinction between "policy load failed transiently" and "policy corrupt"; UI allows saving even while `corruptPolicyError` is set.
- **Impact**: Silent data loss — user's compliance/routing rules can be overwritten by the empty default policy after a transient IPC failure. This is a security boundary because BYOM enforces which providers see secrets.
- **Fix sketch**:
  - Distinguish IPC errors (retry with backoff, keep Save disabled) from explicit corrupt-payload errors (offered Reset path).
  - While `corruptPolicyError` is set, disable `handleSave` entirely or require an explicit "Overwrite corrupt policy" confirmation.
  - Don't initialise `policy` to `defaultPolicy()` while load is pending; use `null` and gate the editor on `policy !== null`.

## 4. `mergeCapabilities` silently drops user overrides for removed operations

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/settings/sub_engine/libs/engineCapabilities.ts:132-141
- **Scenario**: `mergeCapabilities` iterates `CLI_OPERATIONS` (the current source-of-truth list) and copies saved overrides from `saved` into the result. If a future code change removes an operation from `CLI_OPERATIONS`, the merge silently discards saved data for that operation. If a future operation is renamed (e.g. `query_debug` → `sql_repair`), the saved override is silently dropped on first load — the new operation reverts to default behaviour without warning.
- **Root cause**: No migration path or warning when saved keys don't match current keys.
- **Impact**: Users who explicitly disabled an operation for cost/safety reasons could see it silently re-enabled after an upgrade.
- **Fix sketch**:
  - Log/Sentry-warn when `saved` contains keys not in `CLI_OPERATIONS`.
  - Define a migration table for operation renames with explicit fallthrough.
  - Document this lossy-merge behaviour in the JSDoc.

## 5. Notification prefs auto-save debounce silently swallows JSON parse errors

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/settings/sub_notifications/components/NotificationSettings.tsx:85-110
- **Scenario**: `useAppSetting` validates with a `(v) => { try { JSON.parse(v); return ... } catch { return false; } }` predicate, then `prefs` is computed via another `try/JSON.parse/catch → DEFAULT_PREFS`. If the stored JSON is corrupt, the user sees default toggle states (critical:on, high:on, medium:off, low:off) regardless of what they previously saved. There is no banner, log, or recovery prompt — the user simply finds their settings reset and toggles re-default.
- **Root cause**: Comments explicitly say "intentional: non-critical -- JSON parse fallback" but never surface the failure to the user. The "non-critical" framing is the implicit assumption being audited — who decided notification prefs are non-critical?
- **Impact**: Silent loss of user notification preferences. For users on high-volume teams who explicitly disabled `healing_critical` to mute alerts, the silent revert to `true` could spam them.
- **Fix sketch**:
  - On parse failure, surface a one-time toast or inline warning ("Saved preferences could not be read; defaults restored").
  - Log to Sentry with the corrupt-key name (not the value, in case it leaked PII).

## 6. `health_digest_enabled` setting validator is permissive but value comparison is not

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/settings/sub_notifications/components/NotificationSettings.tsx:37-45
- **Scenario**: The `useAppSetting` validator accepts only the strings `"true"` and `"false"`. The toggle reads `digestSetting.value === 'true'`. If the underlying setting is somehow set to anything else (raw `"1"`, `"yes"`, an empty string after a bad migration, or the literal boolean `true` serialised by another code path), the validator should reject and reset — but the comparison `=== 'true'` will silently treat every non-matching value as `false`, hiding the broken state.
- **Root cause**: There's no canonical type for boolean settings; everywhere uses bespoke string comparisons.
- **Impact**: A digest setting written by a different code path with a different convention will be invisibly off, with no warning.
- **Fix sketch**:
  - Build a typed `useBooleanAppSetting` helper that owns serialisation and rejects unknown values with a logged warning.
  - Or add a defensive `else if (value !== 'false') { warn(...) }` branch.

## 7. Tour `setTimeout(50)` after `resetTour` is undocumented timing assumption

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/settings/sub_admin/components/AdminSettings.tsx:28-36
- **Scenario**: `handleForceStart` calls `resetTour()` then a `setTimeout(..., 50)` before `startTour()`. The comment says "after reset, startTour guard checks tourCompleted/tourDismissed" — i.e. the 50ms delay is meant to wait for Zustand state to flush so that the guard sees the reset state. 50ms is empirical; on a slow machine or under load, the timeout might fire before React/Zustand commit.
- **Root cause**: Coupling between two store actions via wall-clock timing rather than a deterministic state observation.
- **Impact**: On slow systems the "Force Start" button can flash and silently no-op (guard sees stale `tourCompleted: true`), confusing developers who think they reset state.
- **Fix sketch**:
  - Have `resetTour` return a promise that resolves once the state commit is observed, or expose a synchronous `forceRestart` action that bundles reset+start in one Zustand `set()` call.
  - At minimum, document the 50ms as a soft assumption with measured maximum delay.

## 8. Custom theme `'#8b5cf6'` is duplicated across files with no central source

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/settings/sub_appearance/components/CustomThemeCreator.tsx:22, 70, 87
- **Scenario**: The default custom-theme primary colour `#8b5cf6` (violet) is hard-coded in three places: the initial `useState`, the `handleReset` reset, and the `colorRows.derivedValue` for "Primary". If the design team changes the brand violet, all three must be updated together; missing one creates inconsistent reset behaviour.
- **Root cause**: No `DEFAULT_CUSTOM_PRIMARY` constant.
- **Impact**: Drift bugs when the theme brand colour evolves; resets can land on a stale colour.
- **Fix sketch**:
  - Extract `const DEFAULT_CUSTOM_PRIMARY = '#8b5cf6';` and reference it in all three places.
  - Or import from `@/stores/themeStore` if it's already canonical there.

## 9. Credential import passphrase 8-char minimum is undocumented client-only check

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/settings/sub_portability/libs/useDataPortability.ts:107-141
- **Scenario**: Both `handleCredExport` and `handleCredImport` enforce `passphrase.length < 8`. There is no comment explaining why 8 (NIST SP 800-63B recommends 8 minimum, but only as part of a much broader rubric — entropy, dictionary checks, etc.). It is also unclear whether the backend enforces the same minimum: if the backend allows shorter passphrases on import, a credential bundle exported on a system without this client guard could be imported here just fine, while an export attempted from this UI would silently refuse a 7-char passphrase the user typed correctly.
- **Root cause**: The constraint exists only on the client; backend behaviour is not documented at the call site.
- **Impact**: Frontend rejects passphrases the backend would accept (UX confusion); or the client allows weak passphrases the backend would reject (failed import after long upload).
- **Fix sketch**:
  - Add a comment citing the source of the 8-char rule and confirming backend parity.
  - Or surface a `getCredentialPassphraseRequirements()` IPC and render the rules dynamically.

## 10. `cr_${Date.now()}_${Math.random()}` rule IDs assume no collisions ever

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/settings/components/AmbientContextPanel.tsx:130
- **Scenario**: Context rules are assigned a client-generated ID of the form `cr_<ms>_<6-base36>`. With `Date.now()` resolution at 1ms and 6 base36 chars (~36^6 = 2.1B), two rapid additions in the same ms have ~10^-9 collision odds — but the code does no collision check before sending to the backend. If an automated tool ever spawns rules in a loop or if the same persona's rules are imported from elsewhere with overlapping IDs, the duplicate would silently overwrite or violate a UNIQUE constraint, depending on how the backend handles it.
- **Root cause**: Client generates IDs the backend should own; no documented contract for ID space.
- **Impact**: Rare but annoying duplicate-key errors that are hard to reproduce.
- **Fix sketch**:
  - Have the backend assign IDs and return them, the way most other persona resources work.
  - Or use `crypto.randomUUID()` which is already a Tauri-supported API.

## 11. `BulkSetting` cancel-flag race in `ByomApiKeyManager`

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/settings/sub_byom/components/ByomApiKeyManager.tsx:88-110
- **Scenario**: The mount effect uses `let cancelled = false` to guard against unmount-during-load. But `setEntries` is also called from save/delete/test handlers without any cancel awareness. If the panel unmounts during a `handleTest` IPC call (e.g., user navigates away), the `setTimeout(..., 4000)` at line 162-164 will fire 4 seconds after unmount, triggering `setEntries` on a dead component — React 19 logs a warning but the timer keeps a reference to the stale closure preventing GC.
- **Root cause**: The cancel guard only protects mount-time loads; subsequent async actions don't share the same lifecycle.
- **Impact**: Memory leak on rapid panel switching; React 19 deprecation warnings noisy in dev.
- **Fix sketch**:
  - Track the timer in a ref and clear it on unmount.
  - Or hoist the cancellation flag to a ref accessible from all handlers.

## 12. ConfigResolutionPanel `Promise.allSettled` swallows partial-failure detail

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/settings/sub_config/components/ConfigResolutionPanel.tsx:75-92
- **Scenario**: Resolves effective config for every persona via `Promise.allSettled`. Failed resolutions become `config: null` and render as a row of skeleton-pulse boxes that look identical to "still loading" — the loading flag is set to `false` but cells render "h-3 w-16 animate-pulse" (line 164). A user looking at this panel cannot distinguish "agent's config could not be resolved" from "still loading"; the perpetual pulsing animation suggests progress that will never come. Worse, since this panel exposes which model+budget+turns each persona will use, a silent failure here could mislead the user into thinking everything is configured when in fact some agents will fall back to defaults.
- **Root cause**: No per-row error state — the row falls through the loading branch when `config` is null, regardless of whether loading is still in flight.
- **Impact**: Users believe their agent configuration is set up correctly when in fact some resolutions failed, leading to budget overruns or unexpected model usage when those agents run.
- **Fix sketch**:
  - Add a `failed: boolean` flag to `PersonaRow` and render an error/retry pill when both `loading: false` and `config: null`.
  - Surface the rejection reason from `r.reason` in a tooltip.
  - Don't reuse the loading-skeleton style for the failure state.
