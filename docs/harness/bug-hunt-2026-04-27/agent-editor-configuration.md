# Bug Hunt — Agent Editor & Configuration

> Total: 14 | Critical: 3 | High: 6 | Medium: 4 | Low: 1

## 1. "Save & Switch" silently discards latest edits when an autosave is already in flight
- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/agents/sub_editor/hooks/usePersonaSwitchGuard.ts:23-46` (interaction with `src/features/agents/sub_editor/libs/useDebouncedSaveGroup.ts:30-48`)
- **Scenario**: User edits `name` in Settings → debounce timer fires → `applyPersonaOp` is in flight → user clicks "Save & Switch" within that window. `handleSaveAndSwitch` calls `cancelAllDebouncedSaves()` (cancels only the *timer*, not the in-flight promise) and then `saveAllTabs()`. The settings tab's save callback enters `useDebouncedSaveGroup.save`, hits `while (inFlightRef.current) await inFlightRef.current; if (!draftChanged(draftRef.current, baselineRef.current, keys)) return;` — once the in-flight save resolves it advances `baselineRef` to *the snapshot it captured*, which already matches the draft, so the loop returns without saving the latest keystrokes the user typed during the in-flight window. `clearAllDirty()` then runs, `commitPendingSwitch()` fires, the new persona loads, and the dropped keystrokes are gone forever.
- **Root cause**: `useDebouncedSaveGroup` treats "no further dirty between snapshots" as a no-op, but the snapshot captured by the in-flight save was *older* than the user's most recent edits. The "wait + recheck" pattern only protects against duplicate saves, not against new edits that arrived during the await window.
- **Impact**: Last 1–2 keystrokes (or any field changed during the in-flight save window) are silently lost on every "Save & Switch" that races an autosave. The user sees a green checkmark and the new persona; the old persona's edits never reached disk.
- **Fix sketch**: After awaiting `inFlightRef.current`, re-snapshot `draftRef.current` and compare against the *just-completed* save's snapshot (not against the post-save baseline). Or always perform an extra save when `draftChanged(draft, snapshotAtFlightStart, keys)` — i.e., diff against the inflight snapshot, not the baseline.

## 2. Cross-persona contamination of A/B comparison run when persona switches mid-startArena
- **Severity**: critical
- **Category**: race-condition
- **File**: `src/features/agents/sub_model_config/ModelABCompare.tsx:52-58, 76-85`
- **Scenario**: User on persona A clicks "Run comparison" → `startArena(personaA.id, models)` is awaiting → user switches sidebar selection to persona B before the IPC returns. The persona-change effect at line 76 runs with `personaId=B`, sees `prevId=null` (activeRunId hasn't been set yet), best-effort-cancels nothing, sets `activeRunId(null)`, `setLastResults(null)`. Then `startArena` resolves with `runId="run-X"` and `handleStart` runs `if (runId) setActiveRunId(runId)`. Persona B now owns a comparison run for persona A. The fetch effect (line 32-39) will pull persona A's results into persona B's UI, the `cancelArena` button cancels A's run from B's editor, and persona A's prompts/outputs are rendered inside persona B's tab.
- **Root cause**: `setActiveRunId(runId)` from `handleStart` is unconditional — it has no guard that the persona hasn't changed since the call started. The effect at L76 captures `cancelArena` but cannot cancel a run whose id hasn't been registered yet.
- **Impact**: (a) Cross-workspace prompt/output leakage — sensitive prompts from persona A render under persona B. (b) Cancel button in B sends cancel for a run B never started. (c) Cost accounting and analytics attribute the run to the wrong persona context.
- **Fix sketch**: Capture `selectedPersona?.id` into a local `startedFor` before awaiting; after `startArena` resolves, only set `activeRunId` if `startedFor === selectedPersona?.id`, otherwise immediately `cancelArena(runId)`.

## 3. Stale Ollama auth token: typed credentials silently dropped for cloud presets
- **Severity**: critical
- **Category**: silent-failure
- **File**: `src/features/agents/sub_editor/libs/useEditorSave.ts:84-92`
- **Scenario**: User picks an Ollama Cloud preset (e.g. `ollama-cloud:llama3-70b`) in the model dropdown and pastes their API key into the Ollama auth field. `getOllamaPreset(d.selectedModel)` returns truthy → the model save branch builds a profile of `{model, provider:'ollama', base_url, prompt_cache_policy}` — `auth_token` is not included. The token is written to draft state (and shows in the field), but never serialised into `model_profile`. The save succeeds; the user reloads or switches and the field is empty, the model fails authentication on first execution with a generic 401.
- **Root cause**: The Ollama-preset branch was authored under the assumption that auth comes from a separate vault credential, but the field still accepts input and there's no UI signal that the value won't persist. The `else if (selectedModel === 'custom')` branch *does* serialise `auth_token`, so the field is wired up — just not for presets.
- **Impact**: Silent credential loss. Users believe they configured the cloud model; first execution fails with auth error and no obvious cause (the field appears empty after reload, but the user remembers entering it).
- **Fix sketch**: Either include `auth_token: d.authToken || undefined` in the Ollama preset branch, or hide/disable the auth field when an Ollama preset is selected with a tooltip pointing to the vault.

## 4. Stale undo entries operate on the wrong persona's draft after a persona switch with pending changes
- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/agents/sub_editor/libs/useEditorSave.ts:40-57` + `src/features/agents/sub_editor/hooks/useEditorDraft.ts:47-56`
- **Scenario**: User edits persona A → autosave fires → `pushUndo(...)` captures `setDraft`/`setBaseline` (these setter refs are stable across renders) and snapshots prev/next of A's draft. User clicks persona B; because A is dirty, `pendingPersonaId` is set — the reset effect's guard `if (selectedPersona && !pendingPersonaId)` blocks `clearHistory()`. User clicks "Discard & Switch" → `clearAllDirty()` + `commitPendingSwitch()`. Reset effect now fires with B's persona — `clearHistory()` is called *inside* the reset effect, but the `useEffect` order is non-deterministic relative to the user pressing Ctrl+Z. If the user presses Ctrl+Z immediately after clicking "Discard & Switch" and before the reset effect commits, the undo entry's `restore()` runs and writes A's old field values into B's draft+baseline.
- **Root cause**: Undo entries close over the editor's setters, which are persona-agnostic (always point at the *current* draft). The undo stack is meant to be cleared on persona switch but the cleanup is timing-fragile and skipped during the pending-switch window.
- **Impact**: B's name/color/description silently mutate to A's values; baseline is set to those same values so the editor reads "All saved" while disk holds the original B. Subsequent edits would diff against A's overwritten baseline. Recovery requires the user to notice and undo again — but that re-applies the corruption.
- **Fix sketch**: Tag each `UndoEntry` with the `personaId` it was captured for and short-circuit `restore`/`reapply` if `useAgentStore.getState().selectedPersonaId !== entry.personaId`; also clear the stack synchronously inside `commitPendingSwitch`/`cancelPendingSwitch` rather than via effect.

## 5. Persona-deselect race resurrects deleted persona's baseline
- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_editor/hooks/useEditorDraft.ts:59-68` + `src/features/agents/sub_editor/libs/useEditorSave.ts:74,115`
- **Scenario**: A debounced settings save is in flight (`applyPersonaOp` awaiting). User (or another tab/event) deletes the persona → `selectedPersona` becomes null → the deselect effect runs `setBaseline(emptyDraft())`. Then the in-flight save resolves and runs `setBaseline((prev) => ({ ...prev, name, description, ... }))`, which merges the *deleted* persona's field values back into the now-empty baseline. The editor remounts to "Select an agent" — but if the user immediately selects another persona, the per-persona reset effect rebuilds draft from the new persona, so impact is mostly cosmetic. However, between deselect and reselect the editor briefly holds a phantom baseline tied to no persona, and any debounce that hasn't been cleaned up could attempt to fire `applyPersonaOp` against the deleted id (the early-return inside `performSettingsSave` saves it).
- **Root cause**: `setBaseline` updaters inside `performSettingsSave`/`performModelSave` don't check whether the persona that owned the save is still the selected one. They unconditionally merge stale fields into whatever baseline currently exists.
- **Impact**: Brief UI inconsistency; in pathological repro a save against a deleted persona id throws a hard error instead of being a no-op. Worst case: the error toast says "Failed to save" when there's nothing left to save.
- **Fix sketch**: Inside `performSettingsSave`/`performModelSave`, capture `selectedPersona.id` at entry and only call `setBaseline` if `useAgentStore.getState().selectedPersonaId === capturedId`.

## 6. Twin orphan detection latches "no twins" forever if the initial fetch fails
- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/agents/sub_settings/TwinBindingCard.tsx:47-67`
- **Scenario**: User opens the Settings tab while offline / Tauri command fails. `loadedRef.current = true` is set *before* the await, so `fetchTwinProfiles()` rejects silently and `twinProfiles.length === 0` stays true forever for this mount. The orphan banner is gated on `twinProfiles.length > 0` so a persona pinned to a deleted twin shows the harmless "No twins configured" message instead of "pinned to a deleted twin." User has no idea their persona will fall back to whatever twin happens to be active at runtime — including potentially the wrong identity.
- **Root cause**: `loadedRef` flips synchronously, decoupled from fetch success. There is no retry, no error surface, and no observation of `twinProfiles` changing externally.
- **Impact**: Silent identity-binding drift. The persona behaves differently than the configuration screen suggests; user has no recovery path without unmounting and remounting the card.
- **Fix sketch**: Set `loadedRef.current = true` inside `.then()`/`.catch()` after the fetch settles, or surface fetch errors via a banner with a Retry button. Also trigger a re-fetch when `selectedPersona` changes.

## 7. Concurrent design_context writers clobber each other (last-write-wins)
- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/agents/sub_settings/TwinBindingCard.tsx:69-80` + `src/features/agents/sub_design/libs/useDesignTabState.ts:75,113`
- **Scenario**: User adds a design file in the Design tab — `mutateDesignFiles(personaId, () => designContext)` is in flight. While it's in flight the user opens Settings and changes the Twin dropdown. `TwinBindingCard.handleChange` reads `parseDesignContext(selectedPersona.design_context)` from store *before* the design-files write has propagated, mutates `twinId`, and calls `applyPersonaOp(...UpdateDesignContext, serializeDesignContext(next))`. This whole-document write overwrites the in-flight design files mutation.
- **Root cause**: `UpdateDesignContext` is a "replace whole envelope" op. Multiple call sites (`TwinBindingCard`, `DesignTab` file editor, drift handlers) read-modify-write the same field with no version/etag check.
- **Impact**: Design files added moments before the Twin change disappear. Worse — they appear in the UI until the next reload, then vanish, looking like data corruption.
- **Fix sketch**: Add a sequence/version field on `design_context` and reject stale writes server-side, OR refactor to per-field operations (`SetDesignContextTwin`, `SetDesignContextFiles`) that merge atomically in the backend.

## 8. Timeout input bypasses MIN clamp when typed (vs spinner)
- **Severity**: high
- **Category**: validation-gap
- **File**: `src/features/agents/sub_settings/PersonaSettingsTab.tsx:121-132` (also `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:143-154`)
- **Scenario**: User clears the timeout field and types `5`. `parseInt('5',10) || 10` → 5; `Math.min(5, 1800) * 1000` → 5000 ms. Patched to draft → autosaved as `timeout_ms: 5000`. The HTML `min={10}` only constrains spinner/keyboard arrows, not direct typing or paste. `MIN_PERSONA_TIMEOUT_MS = 10_000` (declared in `PersonaDraft.ts:13`) is never enforced on the way in.
- **Root cause**: Validation only clamps the upper bound; the `parseInt(...) || 10` fallback handles `NaN`/empty but not values *between* 1 and 9. The `MIN_PERSONA_TIMEOUT_MS` constant exists but is never imported by the input handler.
- **Impact**: Persona executions die ~5 s after starting; the user sees "timeout" on every run with no obvious cause (the displayed value rounds to 5 s but the field looks valid). Backend may also reject the save with a validation error after the autosave debounce fires, leaving the editor in a permanently-failing-save loop.
- **Fix sketch**: Replace `Math.min(raw, 1800) * 1000` with `Math.min(Math.max(raw, 10), 1800) * 1000` and import `MIN_PERSONA_TIMEOUT_MS`/`MAX_PERSONA_TIMEOUT_MS` from `PersonaDraft.ts` to keep the floor/ceiling in one place.

## 9. Auto-start design analysis fires for the wrong persona after rapid switch
- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/agents/sub_design/libs/useDesignTabState.ts:66-84`
- **Scenario**: System sets `autoStartDesignInstruction = "design X"`. The effect runs against persona A, awaits `mutateDesignFiles(...)`, awaits `startConversation(...)`. After `setConversationId(convId)` it calls `compile(selectedPersona.id, instructionText, convId)` — but the cleanup `cancelled` flag is checked *before* `setConversationId`, not before `compile`. If the user switches to persona B between `startConversation` resolving and `compile` firing, `compile` executes for persona A using a captured stale reference (`selectedPersona.id`).
- **Root cause**: The `cancelled` check is in the wrong place — it guards the conversation registration but not the actual compile dispatch.
- **Impact**: A multi-minute LLM compilation run kicks off for a persona the user has already navigated away from, burning budget and confusing the conversation history (the result lands in persona A's last_design_result while the user is editing B and won't see it).
- **Fix sketch**: Add `if (cancelled) return;` immediately before the `compile(...)` call. Better: capture `selectedPersona.id` once at the top and re-validate it before each await boundary.

## 10. `useDesignContextSync` ignores external design_context updates for the same persona
- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/agents/sub_design/libs/designStateHelpers.ts:36-44`
- **Scenario**: User is on persona A, Design tab. A drift event handler / external mutation / sync round-trip updates `selectedPersona.design_context` (same `id`, new `design_context` content). Effect dep is only `[selectedPersona?.id]`, so the local `designContext` state is **not** refreshed. User then edits files based on stale local state and clicks save — the save call reads from this stale local state and overwrites the newer disk version.
- **Root cause**: Dep array is too narrow — keyed on persona identity instead of the actual data being synced.
- **Impact**: Stale-data edits clobber out-of-band updates. In multi-tab or drift-event scenarios, design files and references can silently revert.
- **Fix sketch**: Change dep to `[selectedPersona?.id, selectedPersona?.design_context]`. If the local `designContext` is unsaved/dirty, prompt before overwriting (or merge).

## 11. `maxConcurrent` field hint contradicts validation, allows 11–50 silently
- **Severity**: medium
- **Category**: validation-gap
- **File**: `src/features/agents/sub_settings/PersonaSettingsTab.tsx:97-110` (and `.../components/PersonaSettingsTab.tsx:118-132`)
- **Scenario**: FieldHint says `range="1--10"` but the input clamps to `Math.min(50, Math.max(1, ...))` and HTML `max={50}`. User following the hint won't trip it, but anyone exploring/typing 25 will succeed silently. If the engine's actual concurrency cap differs from 50, the persona will silently fail to honour its declared concurrency, producing puzzling throughput drops.
- **Root cause**: Two sources of truth for the limit (UI hint vs validation constant) are out of sync.
- **Impact**: User trust erosion (UI says 1–10 but accepts 50); potential rate-limit explosions if engine respects 50.
- **Fix sketch**: Pick one limit (10 if engine-enforced, 50 if not), update both `FieldHint range` and the `Math.min/max` clamp + HTML `max=`. Add an integration test asserting the constant matches the hint.

## 12. Tier-redirect effect can fight the user during persona load
- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/agents/sub_editor/components/EditorBody.tsx:110-118`
- **Scenario**: User on Team tier deep-links / restores into `editorTab='lab'`. They downgrade to Starter (or `useTier()` flips while loading). The effect runs `setEditorTab('use-cases')`. If the user *clicks* `lab` again (still rendered while a tier-state update is in flight), the next render re-runs the effect and bounces them back to `use-cases`, creating a tab-bouncing loop. Also, the second `if (editorTab === 'matrix')` runs unconditionally — for any user (paid or not) the deprecated `matrix` always redirects, but it's nested inside the `isStarter` branch above it doing the same redirect, so on Starter both branches fire and `setEditorTab` is called twice.
- **Root cause**: The redirect logic doesn't disable the tab button while the redirect is in flight, and the duplicate matrix-redirect path is wasteful.
- **Impact**: Janky tab UX during tier transitions; double `setEditorTab` calls cause two store notifications per render.
- **Fix sketch**: Filter `tabDefs` in `EditorTabBar` to hide tier-locked tabs entirely (already done), but also clear the persisted `editorTab` to a safe default in the redirect rather than re-redirecting on each render. Combine the two `if` branches.

## 13. `handleHeaderToggle` swallows real failure reason behind a generic toast
- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/agents/sub_editor/components/PersonaEditorHeader.tsx:84-89`
- **Scenario**: User flips the Active toggle on a persona that the backend rejects (e.g. budget exceeded, capability validation failure). `applyPersonaOp` throws — the `catch {}` block ignores the error object entirely and shows `t.agents.header.toggle_failed`. Meanwhile `personaSlice.updatePersona` already called `reportError` which set `state.error` (a different surface). User sees a generic "toggle failed" toast and a separate banner from `state.error`, with no way to know they're the same event or what the actual reason was.
- **Root cause**: `catch {}` discards the error; double-reporting between toast and store error state.
- **Impact**: Debuggability degraded; user can't self-correct (e.g. "your daily budget cap blocks enabling this"). Worse, on a partial backend failure the local `patch({enabled})` was never called, but the user may have seen it briefly toggle if the backend updated the store via subscription before throwing.
- **Fix sketch**: `catch (err) { useToastStore.getState().addToast(\`${t.agents.header.toggle_failed}: ${err instanceof Error ? err.message : String(err)}\`, 'error'); }` and suppress the duplicate `reportError` call inside this op path (or have one error sink).

## 14. `setEditorDirty(isDirty)` window allows persona-switch dirty guard to be bypassed
- **Severity**: low
- **Category**: race-condition
- **File**: `src/features/agents/sub_editor/components/EditorBody.tsx:101-103` + `src/stores/slices/agents/personaSlice.ts:354-357`
- **Scenario**: Editor's `isDirty` is mirrored into the store via a `useEffect`. Between an edit (`patch`) and React committing the effect, `useAgentStore.getState().isEditorDirty` may still read `false`. If the user double-clicks a sidebar persona at exactly that moment, `selectPersona` evaluates `get().isEditorDirty === false` and proceeds with the switch, bypassing the unsaved-changes banner. The autosave debounce on the new persona then writes the OLD persona's draft fields against the OLD persona id (since the save callback closure captured `selectedPersona`).
- **Root cause**: Source-of-truth split: dirty state lives in `EditorDocument` context but is mirrored asynchronously into the agentStore for the switch guard. Mirror lag is one render frame.
- **Impact**: Edge-case data loss when users switch personas with very fast keyboard/mouse cadence; not reproducible reliably but possible in "I lost my changes" reports.
- **Fix sketch**: Either lift the dirty source-of-truth into the store (so `setEditorDirty` is called synchronously inside `patch`), or have `selectPersona` consult the EditorDocument directly via a registered query function rather than reading a mirrored boolean.
