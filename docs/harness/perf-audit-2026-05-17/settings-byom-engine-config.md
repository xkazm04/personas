# Perf-Optimizer Scan — Settings, BYOM & Engine Config

> Project: Personas (frontend-only)
> Scope: 12 paths in src/features/settings
> Total: 9 findings (1C / 4H / 3M / 1L)

## Scope notes

All 12 declared paths exist. SettingsPage uses `lazy()` + idle-unmount sweep (good — 30s idle unmount, 5s sweep). `AmbientContextPanel` lives under `features/settings/components/` but is mounted inside `EngineSettings` (sub_engine) — so its perf cost is borne by the Engine tab. `ConfigResolutionPanel` is the `config` tab; it issues N+1 IPCs (handled in Promise.allSettled but still N round trips). No scope drift.

Key cross-cutting note: every tab unmount/remount triggers full re-fetch of its slice because data lives in local state (no store/SWR cache). After 30s idle, switching back to e.g. `byom` re-runs `getByomPolicy() + getProviderUsageStats() + getProviderUsageTimeseries(30)`, and `EngineSettings` re-runs `getAppSettingCoalesced(CAPABILITY_SETTING_KEY)` + `healthCheckLocal()`. This is by design (`SettingsPage.tsx:21-22`), but creates a clear "switch jank on return" cost for every tab below.

---

## 1. AmbientContextPanel polls every 5s while EngineSettings is mounted, and re-fires when Engine tab is reopened
- **Severity**: critical
- **Category**: async-coordination
- **File**: `src/features/settings/components/AmbientContextPanel.tsx:71-79`
- **Scenario**: User opens Settings → Engine tab once. `AmbientContextPanel` mounts inside the engine page (`EngineSettings.tsx:137-139`) and immediately starts a 5s `setInterval` calling `fetchAmbientSnapshot(selectedPersonaId)` + `fetchContextStreamStats()` on every tick. The interval only stops when the Engine tab is idle-unmounted (30s after switching away). While settings is the active page, every 5s the panel fires **two Tauri invokes** that hit the backend's clipboard / file-watch / focus snapshot capture — work that the user is no longer looking at.
- **Root cause**: Polling is gated on `ambientEnabled && selectedPersonaId` but **not** on tab visibility. The interval also schedules even when SettingsPage's other tabs are active; only after `IDLE_UNMOUNT_MS=30_000` does it actually stop.
- **Impact**: Continuous IPC + Zustand `set()` traffic that triggers re-renders of any subscriber to `ambientSnapshot` / `contextStreamStats` across the entire app, not just the Engine tab. Causes ambient sensor work to run even when the Settings page is in the background. The 5s cadence is also fast enough to keep the JS main thread warm and prevent the GPU from going idle.
- **Fix sketch**: Gate the interval on `isActive` (read SettingsPage's `settingsTab === 'engine'` from `useSystemStore`), OR move polling to an SSE/event-driven channel from Rust. Cheapest fix: pass an `isActive` prop down from EngineSettings (skipped frame on `useSystemStore((s) => s.settingsTab === 'engine')`) and bail out of the interval when false. Also consider `IntersectionObserver` or `document.visibilityState === 'visible'` as a secondary gate so the poll stops when the window is minimized.

## 2. Tab switching re-fetches entire config slice with no cache — 4 IPCs per BYOM revisit
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/features/settings/sub_byom/libs/useByomSettings.ts:100-130`
- **Scenario**: User opens BYOM tab → switches to another settings tab for 30s → switches back. Because SettingsPage unmounts idle tabs (`SettingsPage.tsx:22,43-61`), `useByomSettings` re-mounts and re-runs the full mount-time fetch. On the `policy` section that's `getByomPolicy() + getProviderUsageStats() + getProviderUsageTimeseries(30)` = 3 IPCs. The first time the user visits `audit`, +1 more for `listProviderAuditLog(50)`. None of these results are persisted to a store, so the cost is paid every single revisit. Same pattern in `ByomApiKeyManager.tsx:109-131` (`getAppSettingsBulk`), `useEngineCapabilities.ts:43-73`, `useDataPortability.ts:44-55` (`getExportStats`), `ApiKeysSettings.tsx:53-68` (`listExternalApiKeys`), `ConfigResolutionPanel.tsx:78-114` (`listPersonas` + N × `resolveEffectiveConfig`), `WebhookSubscriptionsPanel.tsx:69-82` (`listNotificationSubscriptions`).
- **Root cause**: Each settings sub-page owns its data in `useState` with no `react-query`/SWR/Zustand store backing. Idle-unmount discards both component state AND fetched data.
- **Impact**: For a user who toggles between Engine/BYOM/Notifications during configuration (a normal flow), every round trip costs 30-200ms latency × N IPCs. On BYOM specifically there's a perceived loading-state flash (`!bm.loaded`, lines 37-48) on every revisit.
- **Fix sketch**: Move slow/stable reads (`getByomPolicy`, `getProviderUsageStats`, `getProviderUsageTimeseries`, `getExportStats`, `listExternalApiKeys`, `listNotificationSubscriptions`, `useEngineCapabilities`) into a small TanStack Query layer or Zustand slice with a 60s staleTime. Component remains the same; the hook reads from cache. Idle-unmount then only discards UI state, not data.

## 3. BYOM `useByomSettings` runs `validateByomPolicy` on every keystroke in routing/compliance/provider edits
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/settings/sub_byom/libs/useByomSettings.ts:257-262`
- **Scenario**: User is in BYOM → routing rules, types in a rule name. Each keystroke calls `updateRoutingRule` (line 219-224) → new `policy` object → `useMemo` deps fire → `validateByomPolicy(policy)` walks the whole policy synchronously (loops over `blocked_providers`, `allowed_providers`, every routing rule, every compliance rule, every provider in each rule). The four downstream memos (`hasBlockingErrors`, `routingWarnings`, `complianceWarnings`, `topLevelWarnings`) all rebuild. Then `ByomSettings` and all three rule-list children re-render. Two-input rule edits (name + complexity + provider + model) compound: each character produces full policy revalidation.
- **Root cause**: Validation is tied to the whole policy object identity. Even unrelated fields (e.g. typing in a rule name) re-validate provider lists, complexity rules, and compliance rules.
- **Impact**: For policies with 10+ rules, every keystroke in `<input>` (e.g. `ByomRoutingRules.tsx:68-73`, `ByomComplianceRules.tsx:82-87,110-122`) triggers a synchronous validation pass. Becomes noticeable lag at ~30+ rules; visible jank at ~100+. Also defeats `memo()` on rule rows because `warnings` Map identity changes every render.
- **Fix sketch**: Debounce `policyWarnings` (e.g. `useDeferredValue(policy)` + memo on deferred), so typing in a name doesn't synchronously re-validate. Or split validation into independent slices keyed by section (`top_level`, `routing[i]`, `compliance[i]`) and only recompute the slice whose source changed. Also memoize the `groupByRuleIndex` Maps so children get stable references.

## 4. CustomThemeCreator recomputes `deriveCustomThemeVars` twice on every keystroke in 14 color fields
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/settings/sub_appearance/components/CustomThemeCreator.tsx:89-109`
- **Scenario**: User opens Custom Theme creator and types in the "Theme name" field, or drags any of 8 color pickers, or moves the gradient angle slider (`type="range"`, line 224). Every change goes through one of 12 `useState` setters → `draftConfig` `useMemo` rebuilds → `deriveCustomThemeVars(draftConfig)` runs (line 104) → AND `baseVars = deriveCustomThemeVars({baseMode, primaryColor, accentColor, label})` runs **again** (line 107) — same function, two calls per render. `ColorRow` (`x8`) and `ThemePreview` (which crossfades via `AnimatePresence` keyed on a hash of 14 CSS variables, `ThemePreview.tsx:42-46,53-59`) all re-render. The `ContrastReadout` (line 233) also re-computes 6 contrast ratios per render via `getContrastRatio` (uses `pow()` + luminance math).
- **Root cause**: (a) `baseVars` is recomputed for derived-value display in the color rows on every change instead of only when base inputs change. (b) `draftConfig` includes `label` (theme name text input) which causes the entire derivation to rerun for a string change that doesn't affect colors. (c) `ThemePreview` triggers a framer-motion crossfade on every variable change, layering a 200ms animation on every keystroke.
- **Impact**: Color picker drags become laggy because each tick of the picker rebuilds the entire derived palette, recomputes 6 contrast ratios, and starts a new framer crossfade. Theme name typing produces the same expensive cascade for zero color change.
- **Fix sketch**: (1) Split state — keep `label` out of `draftConfig` (it doesn't drive `derivedVars`). (2) `baseVars` should not include `label` in deps (line 109). (3) Debounce/throttle `derivedVars` updates via `useDeferredValue` so the crossfade in `ThemePreview` fires at most every 50-100ms during drags. (4) Memoize `ContrastReadout` pairs.

## 5. AppearanceSettings reads 11 Zustand selectors individually — re-renders on any theme store change
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/settings/sub_appearance/components/AppearanceSettings.tsx:289-308`
- **Scenario**: AppearanceSettings calls `useThemeStore` 12 times for separate keys (`themeId`, `setTheme`, `textScale`, `setTextScale`, `timezone`, `setTimezone`, `brightness`, `setBrightness`, `dim`, `setDim`, `cvdSafe`, `setCvdSafe`, `highContrast`, `setHighContrast`, `reduceMotion`, `setReduceMotion`, `customTheme`) plus `useIsDarkTheme()`. Each picks a single primitive. When the user toggles e.g. `dim`, all 12 subscribers fire `getSnapshot`. The component re-renders, which is fine — but ALSO downstream `ThemingSection`, `THEMES.filter()` (in `useMemo` on line 313-320) re-runs and produces fresh `darkWithCustom`/`lightWithCustom` arrays whenever `customDef` changes, busting `memo()` on every `ThemeSwatch`. With 10+ themes this is 10+ avoidable re-renders per toggle.
- **Root cause**: No `useShallow` / shape-selector usage, and the `darkWithCustom` array gets a new identity when `customDef` changes even if it didn't (e.g. on a `themeId` change `THEMES.filter()` runs again, returning a fresh array).
- **Impact**: Toggling brightness/dim/cvd/contrast/reduceMotion causes 10+ ThemeSwatch components to re-render unnecessarily. Each ThemeSwatch also computes 2 contrast ratios on render (lines 116-123) — wasted work. With reduce-motion off, the active swatch's framer ring animation gets cut off mid-flight.
- **Fix sketch**: Combine selectors with `useShallow` from `zustand/react/shallow`: `const { themeId, textScale, ... } = useThemeStore(useShallow(s => ({ ... })))`. Memoize `THEMES.filter(t => !t.isLight)` at module level (constant arrays) instead of inside `useMemo`. Wrap `ThemeSwatch`'s contrast computations in a module-level cache keyed by theme.id since they're pure.

## 6. ConfigResolutionPanel fires N parallel `resolveEffectiveConfig` IPCs on every refresh — no cache, no batch
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/settings/sub_config/components/ConfigResolutionPanel.tsx:78-114`
- **Scenario**: User opens Settings → Config. `load()` calls `listPersonas()` then fires N `resolveEffectiveConfig(p.id)` via `Promise.allSettled`. With 50 personas this is 51 IPC round trips. The Refresh button reruns the whole thing. Each persona triggers a backend SQL resolve cascade (agent → workspace → global → default). No caching; no batch endpoint.
- **Root cause**: No `resolveEffectiveConfigBulk(personaIds[])` IPC; per-persona resolution is fan-out from the frontend.
- **Impact**: Initial load latency scales linearly with persona count. On the IPC bridge, 50+ concurrent invokes serialize through the Tauri message queue and can saturate the runtime briefly. The UI shows skeleton pulses on every cell until each row's promise settles, so the table "flickers in" rather than appearing whole.
- **Fix sketch**: Add a `resolveEffectiveConfigBulk(personaIds[])` Rust command that loops in the backend (one DB transaction) and returns `Record<personaId, EffectiveModelConfig>`. Cache in TanStack Query keyed on `['effectiveConfig', personaIds.join(',')]` so revisiting the tab is instant.

## 7. NotificationSettings: every toggle JSON-parses the prefs and JSON-stringifies them again
- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/settings/sub_notifications/components/NotificationSettings.tsx:86-126`
- **Scenario**: Severity prefs are stored in `useAppSetting` as a JSON string. On every toggle, `toggle()` reads `prefsRef.current` (an object derived via `useMemo`+`JSON.parse` on `setting.value`), builds the next object, and immediately calls `setting.setValue(JSON.stringify(next))`. Then `setting.value` changes → `useMemo` reparses → `prefsRef.current = prefs` runs in render. After 300ms debounce, `setting.save()` fires an IPC. Four toggles = 4× parse + 4× stringify + 4× state churn, and the debounce timer reschedules each time so saves are serialized but state churn is not.
- **Root cause**: Store-as-JSON-string with `JSON.parse` in a render `useMemo` means every keystroke-equivalent (each toggle) goes through string ↔ object conversion plus React re-render of the whole panel.
- **Impact**: Minor at 4 toggles but the pattern is multiplied by `WeeklyDigestToggle` (another `useAppSetting`) and `WebhookSubscriptionsPanel` (which reloads the whole subscriptions list after every toggle, line 137-155 — a full IPC round trip per checkbox flip on the enable/disable toggle).
- **Fix sketch**: Hold prefs in `useState<NotificationPrefs>` (object), serialize only at save time. For webhook toggles, optimistically update local subscription state and call `updateNotificationSubscription` in the background instead of `reload()` after every toggle — the panel currently re-fetches the full list on every checkbox.

## 8. ExportSelectionModal: `stateMap` and `categories` rebuilt on every render; `toggleAll`/`toggleItem` deps stale
- **Severity**: medium
- **Category**: re-render
- **File**: `src/features/settings/sub_portability/components/ExportSelectionModal.tsx:245-314`
- **Scenario**: `categories` is `useMemo`'d on `[personas, credentials]`, but inside it builds `iconNode` JSX (`<PersonaIcon …>`) for every persona — these node references change identity every memo recompute, so `CategorySection` can never `memo`-stable. `stateMap` (line 284-287) is built fresh every render (no memo). `toggleAll`/`toggleItem` `useCallback` declare `[selectedPersonaIds, selectedCredentialIds]` as deps but the function body reads `stateMap` directly — a closure over the freshly-constructed object that React doesn't track. With 100 personas + 50 credentials, every checkbox click rebuilds 150 ExportableItem objects and 150 JSX nodes for the unchanged category.
- **Root cause**: `categories` memo includes JSX (always fresh), and dispatcher map is built in render scope.
- **Impact**: At 100+ personas the modal feels sluggish after the first toggle — each toggle rebuilds 100 PersonaIcon JSX trees that are equivalent to what was there.
- **Fix sketch**: Hoist PersonaIcon creation out of the `categories` memo and memoize per persona by id (`useMemo(() => new Map(personas.map(p => [p.id, <PersonaIcon ... />])))`). Memoize `stateMap` once. Pass `setSelectedPersonaIds`/`setSelectedCredentialIds` directly into `toggleAll`/`toggleItem` and key them on the category string at call time rather than building a closure map.

## 9. ProviderSparkline regenerates `gradientId` via `Math.random()` every render — defeats SVG `<defs>` reuse
- **Severity**: low
- **Category**: re-render
- **File**: `src/features/settings/sub_byom/components/ProviderSparkline.tsx:46-49`
- **Scenario**: `gradientId` is `useMemo`'d with deps `[color]`, but uses `Math.random()` in the factory. Each new mount produces a fresh ID (fine), but if `color` ever changed (it doesn't, since `SPARKLINE_COLORS` is constant), the gradient `<defs>` would be re-keyed and the SVG renderer would drop and recreate the gradient. More importantly, `ProviderUsageCard` (`ByomProviderList.tsx:70-129`) renders 3 sparklines per usage row; the area path memo (lines 41-44) takes `path` + `width` + `height` deps so it correctly skips, but `path` itself takes `[data, width, height]` and `data` is a new array on every parent render (returned from `trendsByEngine.get(stat.engine_kind)` which is a fresh Map on every render of `ByomProviderList`).
- **Root cause**: `useTimeseriesByEngine` returns a Map by ref-identity tied to `timeseries` input, which is OK, but each `bucket` object is rebuilt and the inner arrays are fresh. So the `path` memo for each sparkline rebuilds the path string on every parent re-render.
- **Impact**: Small CPU cost on every BYOM "policy" tab parent render (~3 sparklines × 8 providers = 24 path rebuilds per render). Trivial absolute cost; flagged for completeness.
- **Fix sketch**: Make the `gradientId` deterministic from `color` (e.g. hash) so React/SVG can dedupe. Memoize the `trends` object identity by engine_kind in `useTimeseriesByEngine` so each `ProviderUsageCard`'s `trends` prop is stable across parent re-renders.
