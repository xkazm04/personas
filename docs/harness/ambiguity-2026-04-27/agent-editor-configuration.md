# Ambiguity Audit — Agent Editor & Configuration

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~17
> Scope: Persona editor shell, draft/save plumbing, tab bar, design hub, settings (incl. twin binding), model A/B compare, persona slice + persona IPC API.

## 1. `saveAll` early-exit on missing save callback marks tab clean without saving

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_editor/libs/EditorDocument.tsx:150-156
- **Scenario**: When `saveAll` iterates dirty tabs and finds no registered save callback for a dirty tab, it pushes that tab to `savedTabs` and clears its dirty flag (`dirtyMap.set(tab, false)`) — even though no IPC was made. The user's "all saved" toast is then a lie for that tab.
- **Root cause**: The branch was written to be defensive (don't crash if a tab unregistered mid-save), but it conflates "no callback to run" with "save succeeded." Nothing distinguishes "tab unmounted, no longer dirty in reality" from "tab is dirty but its save closure was never registered (race)."
- **Impact**: If a tab marks itself dirty via `useEditorDirty(tab, true, undefined)` (e.g. a refactor that forgets the save arg, or a render race where dirty flips before `registerSave` runs), `saveAll` silently drops the changes and the editor reports success.
- **Fix sketch**:
  - Throw or emit a warning when `dirty=true` and no save callback is registered.
  - Or, treat missing callback as a synthetic failure and bubble it through `TabSaveError`.
  - Document that `useEditorDirty` requires a save callback whenever `isDirty` can ever be true.

## 2. `useEditorDirty` calls `registerSave`/`registerCancel` during render

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_editor/libs/EditorDocument.tsx:289-295
- **Scenario**: Only `setTabDirty` is wrapped in `useEffect`; `registerSave` and `registerCancel` mutate the store map directly during render. The comment says "registerSave / registerCancel do not call notify(), so updating during render is safe" — but every render of the component re-registers the latest closure, and there is no guard against running this during a Concurrent React render that is later thrown away.
- **Root cause**: The "safe during render" assumption holds only because notify isn't called; it does not address React 19 concurrent rendering, where a discarded render could leave the store pointing at a closure that captured aborted state.
- **Impact**: With Suspense / transitions in the editor body, a render that gets discarded can still mutate `saveMap`. The closure captured may reference state that never committed, so a subsequent `saveAll` could persist values the user never saw.
- **Fix sketch**:
  - Move `registerSave`/`registerCancel` into a `useEffect` (or `useInsertionEffect`) so only committed renders register.
  - Or use a ref for the latest save fn and have the store call through it.
  - Add an explicit invariant comment if the choice is intentional.

## 3. `MIN_PERSONA_TIMEOUT_MS` is documented but never enforced in the input

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/sub_settings/PersonaSettingsTab.tsx:121-132 + src/features/agents/sub_editor/libs/PersonaDraft.ts:11-15
- **Scenario**: `MIN_PERSONA_TIMEOUT_MS = 10_000` is defined and the field hint says "10–1800 seconds," but the input's onChange uses `parseInt(e.target.value, 10) || 10` and only clamps the upper bound (`Math.min(raw, 1800)`). Negative numbers, zero, and values below 10 (e.g. `5`) are accepted and stored without floor-clamping; `||10` only kicks in on NaN.
- **Root cause**: The constant exists in `PersonaDraft.ts` but is not imported here, and the field-hint copy was updated without aligning the validator.
- **Impact**: A user typing `1` will see 1 second persisted. Engine-side, the timeout fires before any meaningful work, hung-looking persona. Or if the user types `-30`, the integer is negative and gets multiplied by 1000 — undefined runtime behavior.
- **Fix sketch**:
  - `Math.max(MIN_PERSONA_TIMEOUT_MS / 1000, Math.min(raw, 1800)) * 1000`.
  - Reuse the constants from `PersonaDraft.ts` instead of literal `10` / `1800`.
  - Mirror the same clamp for `maxConcurrent`'s 1–50 range, which the FieldHint claims is "1–10."

## 4. `FieldHint` says max_concurrent range is 1–10, code allows 1–50

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/agents/sub_settings/PersonaSettingsTab.tsx:97-110
- **Scenario**: The hint copy reads `range="1--10"` while the input enforces `Math.min(50, Math.max(1, ...))` and `min={1} max={50}`. Two different "valid range" requirements are simultaneously asserted.
- **Root cause**: The hint string is duplicated, not derived from the validation constants. No single source of truth for "what is the maximum sane parallelism."
- **Impact**: A user reading the hint will think 11 is invalid and self-limit; future devs may "fix" the input to match the hint or vice versa, picking the wrong direction. Engine behavior at high concurrency (e.g. 30) is also undocumented — does the slot pool actually allow it?
- **Fix sketch**:
  - Define `MAX_PERSONA_CONCURRENCY` next to the timeout constants and reference it in both the hint and the clamp.
  - Decide whether 50 or 10 is the supported value; document the real engine-side ceiling.

## 5. `applyPersonaOp` is just a wrapper — discarding the operation kind on the wire

- **Severity**: high
- **Category**: undocumented-decision
- **File**: src/api/agents/personas.ts:204-231 + src/stores/slices/agents/personaSlice.ts:298-300
- **Scenario**: `PersonaOperation` is presented as a "semantic intent layer" with comments like "preserves the semantic action for analytics, undo, and permission checks." But `applyPersonaOp` immediately calls `operationToPartial(op)` and routes to `update_persona` IPC — the kind tag never crosses the boundary. There is no analytics, no permission check, no per-op IPC.
- **Root cause**: The API's stated promise is aspirational. The naming suggests rich behavior the implementation doesn't have, and there's no comment explaining "the kind tag is purely a frontend abstraction."
- **Impact**: A future engineer adding a new op (e.g. `RotateCredentials`) will believe the backend sees the kind and tailors validation; in reality they get the same blanket `update_persona` mutation. Permission boundaries silently degrade because reviewers trust the discriminator.
- **Fix sketch**:
  - Either route each op kind to a dedicated Tauri command, or
  - Document explicitly: "kind is only used for client-side undo/analytics; the backend sees a flat partial update."
  - Add a comment to `applyPersonaOp` clarifying the loss of semantic context.

## 6. Header's optimistic toggle then reads stale `selectedPersona` after applyOp resolves

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/sub_editor/components/PersonaEditorHeader.tsx:77-89
- **Scenario**: `handleHeaderToggle` reads `nextEnabled = !selectedPersona.enabled`, calls `applyPersonaOp`, then patches the draft and baseline. There's no guard for the case where the user switched personas during the await, where the toggle errored after the IPC succeeded, or where the baseline was already updated by an in-flight settings save.
- **Root cause**: The toggle is treated as fire-and-forget; the only error handler is a generic toast. There is no equivalent of the personaId capture pattern used in `ModelABCompare`.
- **Impact**: If the user clicks toggle, then switches personas during the await, `setBaseline` fires for the *new* persona's draft state — the new persona's baseline is mutated to reflect persona A's `enabled` value. A subsequent settings save then writes that incorrect enabled flag onto persona B.
- **Fix sketch**:
  - Capture `selectedPersona.id` at click time and skip `patch`/`setBaseline` if it no longer matches.
  - Use the `applyDesignContextMutation`-style queue or rely on the autosave path instead of a parallel direct write.

## 7. Twin orphan detection only flags after profiles load — silent during fetch failure

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/sub_settings/TwinBindingCard.tsx:78-99
- **Scenario**: The orphan banner is gated on `twinProfiles.length > 0`. The retry comment acknowledges that fetch failures previously silenced orphan detection — but the current code still has the same behavior when the fetch genuinely returns zero profiles (e.g. user deleted them all), because then `inheritsActive` is the only path shown.
- **Root cause**: `twinProfiles.length > 0` is overloaded: it means both "profiles loaded" and "user has at least one twin." A pinned-but-orphaned persona in a workspace where all twins were later deleted shows the harmless "No twins configured" message instead of a binding-broken warning.
- **Impact**: Persona keeps a stale `twinId` indefinitely. If the user later creates a twin with the same id (impossible in practice but possible across imports/exports), the persona silently rebinds.
- **Fix sketch**:
  - Track `twinProfilesLoaded` separately from `twinProfiles.length`.
  - If loaded and pinned and array is empty, render the orphan banner with a different copy ("Pinned twin no longer exists; reset to inherit").

## 8. Magic number: undo stack `MAX_UNDO_DEPTH = 50` with no rationale

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/agents/sub_editor/libs/EditorDocument.tsx:46
- **Scenario**: `MAX_UNDO_DEPTH = 50` is a bare constant with no comment. When exceeded, `undoStack.shift()` silently drops the oldest entry — undoing past the cap is impossible and the user gets no feedback.
- **Root cause**: Likely chosen empirically, but the trade-off (memory vs. time-traveling capability) isn't recorded.
- **Impact**: Low for now, but if a tab is ever added that pushes many small edits (e.g. live prompt editor), the cap silently truncates the user's history mid-session.
- **Fix sketch**:
  - Document the rationale (memory budget for closures vs. UX expectation).
  - Consider per-tab caps rather than a global one.
  - Optionally surface "history truncated" UX hint when shift() runs.

## 9. `aggregateResults` (non-detailed) returns `null` for both empty and missing

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/agents/sub_model_config/compareModels.ts:88-92 + src/features/agents/sub_model_config/ModelABCompare.tsx:98-99
- **Scenario**: `ModelABCompare` uses both `aggregateResults` (returns `ModelMetrics | null`) and `aggregateResultsDetailed` (returns a tagged union). The non-detailed variant collapses "no results yet" and "this model produced no rows" into the same `null`, even though the rest of the file documents that distinction as load-bearing.
- **Root cause**: Two functions with the same logic but different return shapes; the legacy `aggregateResults` was kept for the metric cards but is fed by the same data. The component then has to call the detailed version separately to recover the distinction it lost in the metric card path.
- **Impact**: Future devs will use `aggregateResults` and lose the missing/empty distinction silently — exactly the bug the detailed version was added to prevent. Easy to regress.
- **Fix sketch**:
  - Delete `aggregateResults` and have callers use `aggregateResultsDetailed` consistently.
  - Or, if both are kept, add a comment on the non-detailed version directing callers to the detailed one when status matters.

## 10. Tab-bar redirect for retired `matrix` tab fires every render

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/agents/sub_editor/components/EditorBody.tsx:110-118
- **Scenario**: The effect handles two cases: starter tier on hidden tabs, and legacy persisted `matrix`. The legacy guard is unconditional — it fires whenever `editorTab === 'matrix'`, but `setEditorTab` is itself in the dep array. There is no comment specifying *when* the matrix tab was removed, so the guard's lifespan is unknown.
- **Root cause**: Migration code with no expiry. Without a date or version anchor, future maintainers can't tell whether the guard is still load-bearing or safe to delete.
- **Impact**: Dead-code accumulation; if the `matrix` id is ever reintroduced for a different feature, this guard silently bounces users away.
- **Fix sketch**:
  - Add a comment: "Removed in $VERSION on $DATE; safe to delete after $DATE+30d once persisted UI state has rotated."
  - Consider folding into a one-shot migration on store hydration.

## 11. Model save serializer drops `auth_token` for the `anthropic` branch — no warning if user typed one

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_editor/libs/useEditorSave.ts:123-129
- **Scenario**: For the non-Ollama, non-custom branch, `performModelSave` builds `{ model, provider: 'anthropic', prompt_cache_policy }` — no `auth_token`, `base_url`, or `customModelName` are written. If the user typed an auth token then switched the model dropdown back to a stock anthropic model, the field disappears from the saved profile silently.
- **Root cause**: The branches are exclusive but the draft shape carries cross-branch state. There is no UI feedback when fields the user just edited are about to be discarded.
- **Impact**: User edits a token, switches model, debounce fires, token vanishes from disk. Reload shows empty token field. The user remembers entering it.
- **Fix sketch**:
  - On model dropdown change, clear the draft fields that won't be serialized.
  - Or: surface a "Token will be discarded for this provider" hint when about to save a model that doesn't use it.
  - Add a comment to the anthropic branch noting the deliberate field drop.

## 12. `useEffectivePersona` uses `!==` to detect "draft edited," fails for empty-string normalisation

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/agents/sub_editor/libs/useEffectivePersona.ts:27-34
- **Scenario**: The override condition is `draft.description !== baseline.description`. But `buildDraft` normalises null → `''` (`persona.description || ''`), and the override falls back to `(draft.description || null)`. If the user deletes the description so draft becomes `''` and baseline was `''` (because the persona had `null`), `!==` is false and the header keeps showing the store value `null` (which is also empty) — fine. But if the user edits, then re-deletes back to the original, the store still treats baseline as `''` and the header silently flips to `selectedPersona.description` even though selectedPersona may have already been updated by the autosave path mid-cycle, causing a flicker.
- **Root cause**: The override semantics ("did the user touch this field?") are conflated with the equality check on the normalised draft. There is no `dirty` flag per field; instead, value-equality is used as a proxy.
- **Impact**: Header flickers between "draft" and "store" rendering during the autosave/baseline-sync window. In practice rare, but reproducible by editing description, waiting for autosave, then immediately editing again.
- **Fix sketch**:
  - Track per-field dirty bits explicitly (the `SETTINGS_KEYS` array already gives the structure).
  - Or, accept the flicker and document why it's intentional.
