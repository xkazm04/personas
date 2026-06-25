# Persona Editor & CRUD — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: persona-editor-and-crud | Group: Persona & Agent Studio
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. Auto-icon-assign gate checks `v1` but the migration writes `v2` — redundant `listPersonas()` + full store replacement on every load
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state corruption / silent stale-overwrite
- **File**: src/stores/slices/agents/personaSlice.ts:138 (block 137–148); src/lib/icons/autoAssignIcons.ts:15
- **Scenario**: `fetchPersonas` runs `const needsAssignment = !localStorage.getItem('personas-icon-auto-assigned-v1')`. But `autoAssignPersonaIcons` reads and writes `ASSIGNMENT_KEY = 'personas-icon-auto-assigned-v2'`. The `-v1` key is never written anywhere in the codebase, so `needsAssignment` is **permanently true**. On every `fetchPersonas` call the block fires; `autoAssignPersonaIcons` early-returns (v2 already set), but the `.then()` still runs unconditionally: `const updated = await listPersonas(); set({ personas: updated, selectedPersona: deriveSelectedPersona(updated, …) })`.
- **Root cause**: Version key mismatch between the gate in the slice (`v1`) and the constant in the migration helper (`v2`). The "run once, idempotent" contract is defeated because the gate the slice checks is decoupled from the flag the helper sets.
- **Impact**: (a) A wasted `listPersonas()` IPC + full persona-list `set()` on every load/refresh, forever. (b) `listPersonas` returns **redacted** rows (`row_to_persona_redacted` strips `auth_token`); this `set` replaces `personas[]` and re-derives `selectedPersona`. If it lands after a `fetchDetail` had merged a **decrypted** `model_profile` into `personas[id]` (or after an optimistic update), the redundant re-fetch reverts that entry to the redacted/stale list row — silently dropping the in-store BYOM auth token and any not-yet-refetched optimistic edits.
- **Fix sketch**: Import and reuse the single `ASSIGNMENT_KEY` constant from `autoAssignIcons.ts` for the gate (change `'…-v1'` → the exported `'…-v2'`), or move the gate decision entirely inside `autoAssignPersonaIcons` and only run the re-fetch when it actually assigned icons (return a boolean).
- **Value**: impact=6 effort=1

## 2. Unmount "flush" of a pending debounced save is fire-and-forget — a failed final edit is silently lost
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent failure / success theater
- **File**: src/hooks/utility/timing/useDebouncedSave.ts:77-87
- **Scenario**: In the Design tab, edit the prompt (or any debounced sub-tab field), then within the 800 ms debounce window click another **editor tab** (e.g. Settings). The `DesignHub` lazy subtree unmounts; `useTabSection`'s unmount effect calls `unregister()` (removing the tab from the dirty map) and `useDebouncedSave`'s mount-once cleanup fires `void saveFnRef.current()`. That call has no `try/catch` and its rejection is discarded. If the save fails (validation error, IPC timeout, transient DB error), the edit is lost with no toast and no dirty flag (the tab is already unregistered, so `isDirty` is false and no guard fires).
- **Root cause**: The unmount flush deliberately drops `isSaving`/`lastError` tracking ("the component is gone"), but it also drops error *surfacing*. The timer-path save shows a retry toast; the unmount-path save shows nothing. Editor-tab switches are not covered by `useUnsavedGuard` (which only guards sidebar-section and settingsTab navigation), so this is the unguarded unmount the flush was meant to catch — yet its failure mode is invisible.
- **Impact**: Last-second edit silently discarded; the user believes the autosave persisted it. Data loss on the recovery path that exists specifically to prevent data loss.
- **Fix sketch**: Wrap the unmount flush in `.catch()` that emits a persistent toast via `useToastStore.getState().addToast(...)` (store access survives unmount), e.g. "Couldn't save your last change — reopen the editor to retry." Optionally surface it through `storeBus` so a banner can re-arm the dirty state.
- **Value**: impact=5 effort=2

## 3. Concurrent settings + model autosaves → cloud auto-sync is last-writer-wins and drops a field on the cloud mirror
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / silent divergence
- **File**: src-tauri/src/commands/core/personas.rs:135-191 (settings/model both route here via `update_persona`)
- **Scenario**: The settings group and the model group are independent debounced timers (`useEditorSave`), serialized only *within* a group. Edit a name field and a model field within the same ~800 ms window → both `update_persona` calls run near-simultaneously. SQLite serializes the two UPDATEs (say settings commits first), so each `result = RETURNING *` snapshot differs: the settings task's snapshot holds the **old** `model_profile`; the model task's holds the new one. Each spawns its own fire-and-forget cloud-sync task using *its own* snapshot. If the settings task's `upsert_persona` lands after the model task's, the cloud row ends up with the new name but the **old** `model_profile` — the model change is silently lost on the cloud copy.
- **Root cause**: The sync task intentionally uses its captured `sync_persona = result.clone()` ("avoid re-reading stale data") rather than re-reading the latest row, and the two tasks have no ordering/serialization. With two in-flight updates, "its own snapshot" is exactly what diverges.
- **Impact**: Local DB stays correct (disjoint dynamic SET clauses), but a cloud-deployed persona silently diverges from local until the next edit re-syncs. Affects only personas with an active deployment.
- **Fix sketch**: Serialize per-persona cloud syncs (e.g. a per-id mutex/last-write-wins guard keyed by a monotonically increasing version), or have the sync task re-read the current row under the lock right before `upsert_persona` instead of trusting its stale snapshot.
- **Value**: impact=4 effort=4

## 4. `delete_persona_icon` scrubs DB rows directly (`icon = ''`) with no store sync, no `updated_at`, no cloud sync — shared-icon personas silently break
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state corruption / icon half-applied
- **File**: src-tauri/src/commands/core/persona_icons.rs:217-224; src/features/agents/components/PersonaIconPickerModal.tsx:122-132
- **Scenario**: A custom uploaded icon is shared by personas A and B (the module explicitly supports fleet-wide reuse). While editing A, the user deletes that icon from "Your icons". The backend runs `UPDATE personas SET icon = '' WHERE icon = ?1`, clearing the reference on **every** persona including B. But `handleDeleteCustom` only patches the store for the currently-edited persona (`if isCustomIcon(value) && parseCustomIconId(value) === assetId`). B's entry in `personas[]` keeps the now-dangling `custom-icon:<hash>` value, rendering the fallback Bot while the store believes B still has the custom icon — until a full refetch.
- **Root cause**: The DB scrub is a raw SQL mutation that bypasses the normal update path: it does not bump `updated_at`, does not invalidate the session pool, does not trigger cloud sync, and the frontend never reconciles the other affected personas in the store.
- **Impact**: Other personas sharing the icon show broken/fallback icons with no store-level signal; cloud-deployed copies keep the dead `custom-icon:` reference (no sync); `updated_at` no longer reflects the change. Inconsistency persists until the next `fetchPersonas`.
- **Fix sketch**: Have the command return the list of affected persona IDs (or set `updated_at`), and on the frontend refetch/patch those personas in the store. Better: route the scrub through the normal `update_persona` path per affected id so session invalidation + cloud sync run.
- **Value**: impact=4 effort=3

## 5. Icon-generation poll returns the first image URL found without confirming a terminal "complete" status (undocumented, fragile contract)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented assumption / wrong-result-persisted
- **File**: src-tauri/src/commands/core/persona_icon_gen.rs:244-279 (`poll_for_image`) + 366-393 (`find_image_url`)
- **Scenario**: `poll_for_image` only checks for failure statuses (`fail`/`error`/`nsfw`); otherwise it returns as soon as `find_image_url` finds **any** HTTPS string under a url-ish key (or any HTTPS string containing `.png/.jpg/.webp`) **anywhere** in the response. It never requires `status == "complete"`. If a provider's in-progress poll payload embeds any image URL — a preview/thumbnail, an init/reference image echoed back, or a cached prior result — that URL is downloaded and stored as the final icon.
- **Root cause**: The "first plausible URL wins" heuristic is decoupled from the job's terminal state. It happens to work for the two current providers (Leonardo/Higgsfield keep `generated_images` empty until done, per the unit tests), but that invariant is undocumented and provider-specific — a minor API-shape change silently yields the wrong image.
- **Impact**: A wrong or partial image is content-addressed, stored, and assigned as the persona icon with no error — the user sees a plausible-but-incorrect icon. Low blast radius today, but a latent landmine tied entirely to provider response shape.
- **Fix sketch**: Gate URL extraction on an explicit terminal status (e.g. require `status` to contain `complete`/`success`/`done`, or extract only from the provider-specific completed-result node) before accepting `find_image_url`'s result; document the assumed completion contract per provider.
- **Value**: impact=3 effort=3
