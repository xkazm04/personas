# Bug Hunter — Persona Editor & CRUD

> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)
> Context: persona-editor-crud | Group: Persona & Agent Studio

## 1. Icon-pick is draft-only — selecting/generating an icon is silently lost if the editor closes before the 800 ms debounce
- **Severity**: High
- **Category**: Silent failure / unsaved-changes loss
- **File**: `src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:156` (`onChange={(icon) => patch({ icon })}`), feeding `src/features/agents/sub_editor/libs/useEditorSave.ts:191-211`
- **Scenario**: User opens the icon picker, uploads or AI-generates an icon (a real file is written to disk and `custom-icon:{sha}` is returned), the picker closes and writes `patch({ icon })`. The user immediately navigates away / closes the window before the 800 ms settings debounce fires. `icon` lives only in `draft`, persisted via the debounced settings save.
- **Root cause**: Unlike `import_persona_icon`/`generate_persona_icon` (which synchronously commit a file on the Rust side), the *persona's* `icon` column is only updated through the debounced autosave group. There is no flush-on-close for an icon change specifically; if the debounce is cancelled (`cancelAllDebouncedSaves` on discard/switch) the field reverts to baseline.
- **Impact**: The just-chosen/generated icon vanishes on next load even though the user "saw it work," and (for generated icons) a paid generation + an orphan PNG is left on disk. Classic success-theater.
- **Fix sketch**: Treat an icon change as an immediate commit (`applyPersonaOp(id, UpdateSettings)` on pick) rather than relying on the debounce, or flush pending settings saves in the unsaved-guard's `onDiscard` when only the icon is dirty.

## 2. Deleting a persona orphans its custom/AI-generated icon file forever
- **Severity**: Medium
- **Category**: Latent failure / orphaned resource (Tauri file-write boundary)
- **File**: `src-tauri/src/commands/core/personas.rs:469-623` (`delete_persona` / `delete_persona_inner`); icon files written by `src-tauri/src/commands/core/persona_icons.rs:101-134`
- **Scenario**: A persona using `custom-icon:{sha}` (uploaded or AI-generated, paid) is deleted. `delete_persona_inner` cancels executions, deletes events, and `repo::delete` removes the row — but never touches `{app_data_dir}/persona-icons/{sha}.png`.
- **Root cause**: Custom icons are deliberately a "directory IS the library, removal is always explicit" design (`persona_icons.rs` header). But there is no reference counting and no GC, and `delete_persona` does not even attempt cleanup of icons unique to the deleted persona. The dedupe-by-hash design also means cleanup *cannot* be naive (other personas may share the asset — see finding #3).
- **Impact**: Unbounded growth of `persona-icons/` over a fleet's lifetime; uploaded images (potentially containing user content) persist on disk indefinitely after the only referencing persona is gone, with no UI to see them except the picker's "Your icons."
- **Fix sketch**: On delete, if the persona's icon is `custom-icon:` and no other persona references that asset_id, call `delete_persona_icon`. Or add a periodic GC that prunes asset files referenced by zero personas.

## 3. Deleting a shared custom icon in the picker silently breaks every *other* persona using it
- **Severity**: High
- **Category**: Silent failure / data integrity
- **File**: `src/features/shared/components/forms/PersonaIconPickerModal.tsx:122-132` (`handleDeleteCustom`)
- **Scenario**: Custom icons are reusable fleet-wide ("Your icons"). Persona A and B both use `custom-icon:X`. While editing A, the user clicks the trash icon on X. `deletePersonaIcon(X)` removes the file. The handler clears the reference only when `value`/the *current* draft uses X; B is never updated.
- **Root cause**: The file is content-addressed and shared, but deletion is treated as if the file belonged to one persona. There's no check for other referencing personas and no fan-out to clear them. B's `icon` column still says `custom-icon:X`, but the file is gone.
- **Impact**: B (and any others) silently fall back to the generic Bot icon with no warning; the user only discovers it later. The deleting persona's own draft may also still hold `custom-icon:X` in `baseline` if it wasn't the current `value`, leaving a dangling reference that the debounced save can re-persist.
- **Fix sketch**: Before deletion, query how many personas reference the asset (a `list_personas_using_icon`-style command) and either block deletion with a warning ("used by N agents") or cascade-clear all referencing personas' icon columns.

## 4. `fetchPersonas` icon-assignment guard checks the wrong localStorage key (v1 vs v2)
- **Severity**: Medium
- **Category**: Latent failure / dead-or-misfiring guard
- **File**: `src/stores/slices/agents/personaSlice.ts:138` (`!localStorage.getItem('personas-icon-auto-assigned-v1')`) vs `src/lib/icons/autoAssignIcons.ts:15` (`ASSIGNMENT_KEY = 'personas-icon-auto-assigned-v2'`)
- **Scenario**: `fetchPersonas` gates the auto-assign + re-fetch block on the absence of the `-v1` key. `autoAssignPersonaIcons` reads/writes the `-v2` key and never writes `-v1`. So `needsAssignment` is true on *every* `fetchPersonas` call for the life of the install (the `-v1` key is never written by anything).
- **Root cause**: The version key was bumped to v2 inside `autoAssignIcons.ts` (comment says "Bumping the key forces one migration pass") but the caller's guard string was not updated in lockstep.
- **Impact**: On every persona list load, `autoAssignPersonaIcons` runs (its own v2 guard returns early so it's mostly a no-op), but the outer `.then()` still fires an extra `listPersonas()` IPC + full store re-set on every load — a perpetual redundant round trip and re-render. After the v2 migration completes once, the work is wasted but never *stops* being scheduled. Also, the moment `autoAssign` does have work, it always re-fetches even though it may have updated nothing.
- **Fix sketch**: Use a single shared constant for the assignment key in both files; gate the outer block (and the re-fetch) on the same `-v2` key, ideally importing `ASSIGNMENT_KEY` rather than hardcoding the string.

## 5. Optimistic create prepends the persona to the list but never selects it / loads detail — `detailCache` stays empty
- **Severity**: Low
- **Category**: Edge case / partial state
- **File**: `src/stores/slices/agents/personaSlice.ts:319-346` (`createPersona`), interacting with `deriveSelectedPersona` (lines 42-53) and `fetchDetail` (190-242)
- **Scenario**: `createPersona` does `set({ personas: [persona, ...] })` and returns. It does not populate `detailCache[persona.id]`. If a caller (or a race where the user clicks the new row before the caller calls `selectPersona`) sets `selectedPersonaId` to the new id without going through `fetchDetail`, `deriveSelectedPersona` returns `null` because `detailCache[id]` is missing (line 50-51), so `selectedPersona` is null and the editor shows the empty state for a persona that demonstrably exists.
- **Root cause**: `selectedPersona` derivation hard-requires a `detailCache` entry; create populates only the canonical `personas[]`. The window between create and the first `fetchDetail` has a persona with no extras.
- **Impact**: Brief but real "I just created it and the editor is blank" flash, or a stuck empty state if the selecting code path assumes detail is already present. Minor because the normal flow calls `selectPersona` → `fetchDetail`, but it's a fragile invariant (any new caller that sets the id directly breaks).
- **Fix sketch**: In `createPersona`, seed `detailCache[persona.id]` with empty extras (`{ tools: [], triggers: [], subscriptions: [], automations: [] }`) so `deriveSelectedPersona` can render immediately, then let `fetchDetail` refine it; or make `deriveSelectedPersona` tolerate a missing cache entry by returning the base persona with empty sub-resources.
