# State Management (Zustand) — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Note: the context's file list is stale — there is no `src/stores/personaStore.ts` or `slices/*/index.ts`. The store is assembled as five domain stores (`agentStore.ts`, `overviewStore.ts`, `pipelineStore.ts`, `vaultStore.ts`, `systemStore.ts`) over `storeTypes.ts`, with cross-store wiring in `src/lib/storeBusWiring.ts`. Findings below target the real files.

## 1. Any `fetchDetail` failure force-deselects the open persona — background refresh evicts the editor
- **Severity**: High
- **Category**: bug
- **File**: src/stores/slices/agents/personaSlice.ts:236-252
- **Scenario**: User is editing persona P (possibly with `isEditorDirty = true`). Any `trigger:changed` event fires a background `fetchDetail(P)` (wired in `src/lib/storeBusWiring.ts:94-96`). If that IPC call transiently fails (backend busy, restart, timeout), the catch block sets `selectedPersonaId: null, selectedPersona: null` and deletes the detail cache entry.
- **Root cause**: The error path was written for the "first open failed, don't render a broken editor" case, but `fetchDetail` is also the background-refresh path. It cannot distinguish "initial load failed" from "refresh of an already-hydrated persona failed", and it clears selection unconditionally — bypassing the dirty-editor guard that `selectPersona` carefully enforces (lines 470-473).
- **Impact**: The open editor unmounts mid-session on a transient error; unsaved edits are stranded with no confirm dialog (the pendingSelect dirty guard never runs because selection is cleared by `set`, not by `selectPersona`). User loses their place and potentially their work.
- **Fix sketch**: In the catch, only clear selection when there is no existing `detailCache[id]` (i.e. nothing usable to render); when the persona is already hydrated, keep the selection and report the error via `reportError` with a scoped action instead.

## 2. Plugin enable/disable toggles are silently lost on every restart
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/system/uiSlice.ts:494-507 (state), src/stores/systemStore.ts:55-127 (partialize)
- **Scenario**: User opens Plugins → Browse and disables a plugin (e.g. Companion) via `togglePlugin` in `PluginBrowsePage.tsx:73`. The toggle takes effect immediately (sidebar entry disappears, `MessageDetailModal` hides companion actions). User restarts the app: the plugin is enabled again.
- **Root cause**: `enabledPlugins` is not in the systemStore persist `partialize` whitelist, while its sibling `pluginTab` is. Additionally it is a `Set<PluginTab>`, which — as the slice's own comment on `monitorCollapsedGroups` (uiSlice.ts:164-166) warns — JSON-serializes to `{}`, so it could not simply be added to the whitelist as-is.
- **Impact**: Success theater: the UI confirms the disable, other surfaces react, but the choice evaporates on relaunch. Users who disabled a plugin for good reason (e.g. the always-on Companion orb) get it back every session.
- **Fix sketch**: Store as `string[]` (matching the `monitorCollapsedGroups` pattern) or add explicit serialize/deserialize in `partialize`/`merge`, then add it to the whitelist.

## 3. Store-bus subscriptions `void` promises from actions that rethrow — unhandled rejections by design
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/storeBusWiring.ts:88-91 and 99-101
- **Scenario**: A bundle/share-link import emits `network:personas-changed` while the backend hiccups. The handler runs `void useAgentStore.getState().fetchPersonas()`; `fetchPersonas` calls `reportError` and then `throw err` (personaSlice.ts:178-181). Same shape for `persona:set-home-team` → `applyPersonaOp` → `updatePersona`, which also rethrows (personaSlice.ts:390-393).
- **Root cause**: These slice actions follow a "report AND rethrow so imperative callers can react" contract, but the bus wiring treats them as fire-and-forget with `void`, which does not swallow rejections.
- **Impact**: Every failure on these paths produces an unhandled promise rejection — double Sentry noise (reportError capture + unhandled-rejection capture), dev overlay interruptions, and in a Tauri webview a global error event with no user-facing consequence beyond the toast that already fired.
- **Fix sketch**: Append `.catch(() => {})` in the wiring (the error is already reported inside the action), or split the slice API into throwing/non-throwing variants for event-driven callers.

## 4. `AGENTS_SELECTED_PERSONA_ID` accessor reads `selectedPersona?.id`, not `selectedPersonaId` — nav history records phantom nulls
- **Severity**: Medium
- **Category**: bug
- **File**: src/lib/storeBusWiring.ts:38-40 (consumed via src/stores/slices/system/uiSlice.ts:329-336, 436, 558, 586)
- **Scenario**: User clicks persona P (selection set, `fetchDetail` in flight — `selectedPersona` stays null until `detailCache[P]` lands, per `deriveSelectedPersona` in personaSlice.ts:40-51), then immediately switches sidebar section. `setSidebarSection` captures the outgoing `NavEntry` via `currentSelectedPersonaId()`, which resolves the accessor to `undefined → null`.
- **Root cause**: Two sources of truth for "which persona is selected": the scalar `selectedPersonaId` (set synchronously) and the derived `selectedPersona` (set only after detail hydration, and nulled on detail-fetch failure). The accessor picks the derived, laggy one.
- **Impact**: Back/Forward restores the personas section with no persona selected (blank roster view instead of the agent the user was on) whenever navigation raced detail hydration or the detail fetch had failed — an intermittent, hard-to-reproduce nav glitch.
- **Fix sketch**: Point the accessor at `useAgentStore.getState().selectedPersonaId`; it exists precisely to be the synchronous truth.

## 5. "Execution still running" warning is emitted as a green success toast
- **Severity**: Low
- **Category**: ui
- **File**: src/stores/slices/agents/personaSlice.ts:476-486
- **Scenario**: User switches away from a persona that still has a running or queued execution. `selectPersona` emits `storeBus.emit('toast', { message: "Execution still running for the previous agent…", type: "success" })`.
- **Root cause**: The toast bus supports `'success' | 'error' | 'warning'` (storeBus.ts:23), but this cautionary message was tagged `success` — likely a copy-paste from a neighboring emit.
- **Impact**: A caution ("you're navigating away from something in flight") renders with success styling (green/check), inverting the semantic signal; users trained to skim toast color will read it as confirmation, not warning. Inconsistent with the severity conventions used elsewhere (e.g. deletePersona picks `error` vs `success` deliberately, personaSlice.ts:451-456).
- **Fix sketch**: Change `type` to `"warning"`.
