# Bug Hunt — Connector Catalog

> Total: 11 | Critical: 1 | High: 5 | Medium: 4 | Low: 1

## 1. Pending category filter is read once but never re-read after first mount

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:19-25`
- **Scenario**: User navigates from a template adoption modal to the catalog with `pendingCatalogCategoryFilter` set. The hook's `useState` initializer captures the value at mount. The `useEffect([])` immediately clears the store. If the catalog component is already mounted (e.g. behind a portal or kept-alive), or if the user navigates away and the same instance re-renders later, the pending filter is consumed without ever being applied. Worse: `useState(pendingCategory)` only reads the snapshot the first time React commits — if Strict Mode double-invokes the initializer, the second invocation sees `null` because the cleanup ran in between.
- **Root cause**: Mixing one-shot store consumption with `useState` lazy init makes the consumption non-idempotent. The empty-deps effect runs after commit, so by the time another component reads the store the value may or may not still be there depending on render order.
- **Impact**: Silent loss of the user's intent — they get redirected to the catalog expecting the right category pre-filtered, and instead see "All". On Strict Mode (dev) the bug is reproducible 100%; in production it is a race against any concurrent reader.
- **Fix sketch**: Read & clear inside a single `useEffect(() => { const v = store.get(); if (v) { setActiveCategory(v); store.set(null); } }, [])` and start state at `null`.

## 2. `searchTerm` effect resets filters whenever search changes — wipes user's category selection

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:160-168`
- **Scenario**: User opens the picker, selects category "Database", then starts typing in the search box. Every keystroke that produces a non-empty `searchTerm` runs the effect and clobbers `activeCategory`, `activePurpose`, `activeLicense`, `connectedFilter`, and `activeRole` to defaults. They cannot combine search with any filter.
- **Root cause**: The effect treats every change to `searchTerm` as "user just started searching" and resets, but it has no guard for "already searching" or "user explicitly chose a filter". It assumes search is mutually exclusive with filters, which is never enforced in the UI.
- **Impact**: Users lose their filter context the instant they type a single character. Likely confusion, perceived as bug ("my filter disappeared"). Also note: `filteredConnectors` doesn't actually use `searchTerm` to filter, so the reset has no compensating benefit.
- **Fix sketch**: Track `prevSearchEmpty` in a ref and only reset on the empty→non-empty transition; better, drive search filtering through the same memo and let the user decide.

## 3. Auto-setup completion races against `autoSetupResult` capture if user closes modal mid-analysis

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/vault/sub_catalog/components/design/useCredentialDesignModal.ts:112-126`
- **Scenario**: User clicks "Auto-Setup", `autoSetupPending=true`, `orch.start()` runs analysis. Before the `preview` phase commits, user clicks the X button. `handleClose` runs `orch.cancel()` only when `phase === 'analyzing'` and clears `autoSetupPending`/`autoSetupResult`. But `onClose()` is invoked synchronously, and the parent unmounts the modal — except the orchestrator hook may still resolve a pending promise that fires `setState`s on unmounted nodes (no AbortController on `useCredentialDesign.start`). If the modal re-opens immediately for another connector, the lingering analysis can populate `autoSetupResult` for the wrong connector.
- **Root cause**: `autoSetupPending` is consumed by the effect comparing `orch.phase === 'preview'` and `orch.contextValue?.result`, but there's no correlation token tying the pending request to the result. The orchestrator state is reset in the open-effect but the in-flight promise is not cancelled (`orch.cancel` only handles the explicit analyzing phase).
- **Impact**: Wrong connector's auto-cred panel pops up, or React warnings about state updates on unmounted components, or stale `designResult` flowing into `AutoCredPanel`.
- **Fix sketch**: Generate a request token on `handleAutoSetup`, store it in a ref, and discard the result in the capture effect if tokens don't match. Always call `orch.cancel()` in `handleClose` regardless of phase.

## 4. `CodebaseProjectPicker` shows "no projects" forever if `listProjects` throws

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx:37-48`
- **Scenario**: Tauri command `listProjects('active')` rejects (DB locked, schema mismatch, IPC error). The catch logs to a logger and sets `loading=false`. Because `projects` stays `[]`, the user is shown the "no projects, go to dev tools" empty state — indistinguishable from genuinely having no projects. They click "Go to Dev Tools", see their projects exist, come back, and hit the same empty state. There is no error UI and no retry.
- **Root cause**: Empty array conflated with "load failed". No `error` state captured.
- **Impact**: User believes they need to (re)create projects that already exist; may end up duplicating projects or filing a support ticket. The "go to dev tools" button uses `setSidebarSection('plugins' as never)` — a `never` cast suggests the section name is wrong/stale, which would also silently fail.
- **Fix sketch**: Track `error` state separately, render an error block with a Retry button; verify the sidebar section name (`'plugins'` vs `'dev-tools'`).

## 5. CLI capture progress events can leak across sessions when adapter abort runs concurrently with completion

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/vault/sub_catalog/components/autoCred/helpers/TauriPlaywrightAdapter.ts:93-99,167-172`
- **Scenario**: User starts an Auto-Setup, the backend emits `auto-cred-browser-progress` events keyed by `sessionId`. User clicks Cancel; `abortHandler` fires `cancelAutoCredBrowser()`, calls `unlisten()`, `unlistenUrl()`. The `finally` block of `run` then ALSO calls `unlisten()` and `unlistenUrl()` again — calling unlisten twice on Tauri listeners is at best a no-op, at worst an error. More critically, the abort handler doesn't check `signal.aborted` before unlistening, so if `cancelAutoCredBrowser` rejects or `startAutoCredBrowser` resolves between abort dispatch and the actual unlisten, you have a window where new events arrive on already-removed listeners or, conversely, the next session's events arrive on listeners not yet bound.
- **Root cause**: Listener lifecycle is not idempotent and not tied to the session lifecycle — only one global `'auto-cred-browser-progress'` topic exists, dispatched by `sessionId`. If two `run()` invocations overlap (e.g. a quick retry without awaiting cancel completion), both will receive each other's events because both filter by their own sessionId but the cancel from the first may also kill the second's backend session.
- **Impact**: Logs from the previous session bleed into the next; cancelled session keeps streaming events until the page is reloaded; potential "ghost" extracted_values from the wrong service. In the saving handler this could mean saving the wrong credential data.
- **Fix sketch**: Wrap unlisten functions in `let unlistened = false; const safeUnlisten = () => { if (!unlistened) { unlistened = true; unlisten(); unlistenUrl(); } }`. Guard `abortHandler` with `if (signal.aborted) return` after async hops.

## 6. Universal connector save can collide with an existing connector that has different fields

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/vault/sub_catalog/components/autoCred/steps/UniversalAutoCredPanel.tsx:104-133`
- **Scenario**: Universal AutoCred discovers a connector named (e.g.) `stripe`. The panel checks `connectorDefinitions.find((c) => c.name.toLowerCase() === connectorName.toLowerCase())` — if a connector with that name already exists, it skips creation and just creates a credential with `serviceType = existing.name`. But the discovered fields (e.g. `api_key`, `webhook_secret`) may not match the existing connector's schema. The credential is saved with field keys that don't exist on the registered connector, so healthchecks, prompt-assembly, and rotation all break silently.
- **Root cause**: Name-collision detection treats names as the unique identity, but doesn't validate that the discovered field set is compatible with the existing connector's schema. The discovered field definitions are silently discarded.
- **Impact**: Silently broken credentials whose data doesn't conform to their connector schema. The user sees a "saved" toast but everything downstream that introspects fields explodes or returns empty. Only manifests later when an agent tries to use the credential.
- **Fix sketch**: When a name collision is found, either (a) reuse fields from existing connector and reject discovered values that don't match, (b) suffix the name with timestamp/hash, or (c) prompt the user.

## 7. `parseSteps` can produce a step starting with a long unrelated paragraph if the markdown has only one numbered item

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/vault/sub_catalog/components/design/setup/setupInstructionHelpers.tsx:11-37`
- **Scenario**: Markdown like `Some preamble.\n\n1. Do thing\n\nMore notes that aren't numbered.` results in steps containing the trailing notes appended to the single step (because `inSteps=true` after the first item and every subsequent line is greedily appended). Worse: empty preamble lines after step 1 are skipped only if `currentStep.trim()===''`, but `currentStep` always has the numbered line so the guard never triggers — blank lines accumulate in the step.
- **Root cause**: No terminator for a step block; all lines after the first numbered item belong to the last step until EOF.
- **Impact**: Noisy step cards with embedded paragraphs that are not actually steps. `localStorage` key derived from `simpleHash(markdown)` may be unstable across small edits, losing user progress; `simpleHash` also collides easily for short strings (32-bit hash, no salt).
- **Fix sketch**: Treat a blank-line-then-non-numbered-line as end-of-steps OR use a real markdown AST; switch to a stronger hash for storage keys.

## 8. `useElapsed` interval continues forever; never resets when `startTs` changes from a value to `null`

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts:77-91`
- **Scenario**: First call with `startTs=12345` starts a 1-second interval. When the parent later passes `startTs=null` (session reset), the cleanup runs and the interval is cleared — good. But the function then returns `null` while `now` state still holds the last-tick value. If `startTs` flips back to a fresh non-null value, `now` is initially stale (could be many seconds old), so the first render shows a wrong elapsed time before the interval fires the first tick. For very short sessions (<1 s) the entire elapsed display can be wrong.
- **Root cause**: `now` is not reset when `startTs` changes; initial render of new session uses the previous session's last `now`.
- **Impact**: Misleading timer display; minor but breaks the trust signal that "the session is running".
- **Fix sketch**: `useEffect(() => { if (startTs) setNow(Date.now()); ... }, [startTs])`.

## 9. `SetupGuideModal` CLI capture button stays clickable even when connector unmounts mid-call

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/vault/sub_catalog/components/picker/SetupGuideModal.tsx:28-62`
- **Scenario**: Modal opens for connector A, user clicks CLI capture (`runCliCapture` sets `cliBusy=true`, awaits `cliCaptureRun`). User clicks the X to close while the capture is in flight. The modal is unmounted (`connector` becomes null), but the in-flight `cliCaptureRun` continues. When it resolves, `setCliBusy(false)` runs on an unmounted component (React warning). If it rejects, `setCliError(...)` does the same. `onCliCaptured` callback fires with the previous connector — parent may show a stale toast or refresh credentials assuming it succeeded for the new modal context.
- **Root cause**: No abort signal, no `cancelled` ref, no check after await.
- **Impact**: React state-on-unmounted warnings, possible incorrect downstream UI (toast saying "GitHub captured" when the user closed the modal).
- **Fix sketch**: Add a cancelled ref consulted before each setState; do not invoke `onCliCaptured` if the modal was closed.

## 10. `MAX 500` log retention in `startBrowser` is computed inside a `setLogs` callback that mutates an arg variable

- **Severity**: medium
- **Category**: latent-failure
- **File**: `src/features/vault/sub_catalog/components/autoCred/helpers/useAutoCredSession.ts:117-137`
- **Scenario**: For every progress event, the deduplication block compares `lastMsg`/`newMsg` and may replace the last entry with a "longer" version up to 5 chars different. With high-frequency event bursts (many small progressing characters), this collapses many events into one growing string but does NOT trim down. Then a non-action event flushes and adds a new entry — eventually exceeding 500. The `next.length > 500 ? next.slice(-500) : next` truncation works, but the dedup branch returns earlier without applying any cap (`return [...prev.slice(0, -1), { ...entry, message: longer }]`) so an action burst of 10000 events that all dedupe to one growing string is fine, but if even one real new event lands the `next` array suddenly grows, until the next iteration trims. There's no upper bound on individual `message` length — a runaway action that keeps appending 1–5 chars per event will produce a multi-megabyte string in one log entry, slowing renders to a crawl.
- **Root cause**: Length cap is on count of entries, not on size of any one entry.
- **Impact**: With a misbehaving backend or a very chatty Playwright session, the panel can hang or OOM the renderer.
- **Fix sketch**: Cap individual message length (e.g. 4 KB) and/or stop merging once `lastMsg.length > 1024`.

## 11. `connectedFilter` "All" label shows count of statuses (0, 1, or 2) instead of total connectors

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/vault/sub_catalog/components/picker/usePickerFilters.ts:115-129`
- **Scenario**: `connectedOptions` builds the "All" label as `All (${statusCount})` where `statusCount = (connected>0?1:0) + (fresh>0?1:0)`. So when connectors exist the label always reads "All (1)" or "All (2)" — never the actual count.
- **Root cause**: Misuse of `statusCount` (intended to drive whether to show the connected/new sub-options) as the "All" total.
- **Impact**: Mildly confusing label, but functionally harmless. Users likely interpret it as "1 of 2 sub-options" rather than connector count.
- **Fix sketch**: Use `connectedBase.length` for the "All" count.
