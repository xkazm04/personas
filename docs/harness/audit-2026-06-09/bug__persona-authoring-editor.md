# Bug Hunter — persona-authoring-editor
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Undo reverts editor UI to a prior state but never re-persists it — disk silently diverges while UI claims "All saved"
- **Severity**: critical
- **Category**: state-corruption
- **File**: src/features/agents/sub_editor/libs/useEditorSave.ts:60-82 (restore at 65-71); src/features/agents/sub_editor/libs/EditorDocument.tsx:228-242
- **Scenario**: User edits the persona name from "Alpha" to "Beta". The debounced autosave persists "Beta" to the DB and `pushUndo` records an entry (this only runs *after* a successful save — useEditorSave.ts:109,160). The user presses Ctrl+Z. `restore()` runs and sets both `draft` and `baseline` back to "Alpha". Because `draft === baseline` again, `settingsDirty` is false, the tab bar shows clean, and the header reads "All saved". But the DB still holds "Beta".
- **Root cause**: `makeUndoEntry`'s `restore`/`reapply` callbacks (useEditorSave.ts:65-78) mutate only the in-memory `draft`/`baseline` via `setDraft`/`setBaseline`. They never call `applyPersonaOp`/`performSettingsSave`, so undo/redo are pure UI operations layered on top of an already-committed write. Setting `baseline` to the restored value is what makes the divergence silent: it suppresses the autosave that would otherwise reconcile disk with the undone state. On next persona reload (`buildDraft` from store), the user's undo is silently discarded and "Beta" reappears.
- **Impact**: data loss / corruption — the user's most recent action (undo) is a no-op against persistence and is silently reverted on reload; success theater ("All saved" is a lie).
- **Fix sketch**: Undo must be a real round trip. Have `restore`/`reapply` invoke the same `performSettingsSave`/`performModelSave` path (or a dedicated persist-then-set-baseline op) so the DB is written before `baseline` is moved. Only set `baseline = prev` after the write resolves; on failure, keep the tab dirty and surface the error. Make "undo without persistence" structurally impossible by routing all baseline mutations through the save layer.

## 2. Delete confirmation state survives a persona switch — confirming deletes the wrong persona
- **Severity**: critical
- **Category**: state-corruption
- **File**: src/features/agents/sub_editor/hooks/useEditorDraft.ts:67-88; src/features/agents/sub_editor/components/EditorBody.tsx:113-127
- **Scenario**: User opens the delete-confirm dialog for clean persona A (`setShowDeleteConfirm(true)`). Without dismissing it, they click persona B in the sidebar. Because A is not dirty, `selectPersona` switches immediately and `selectedPersona` becomes B. The persona-change reset effect (useEditorDraft.ts:67-76) rebuilds `draft`/`baseline` and clears history but does **not** reset `showDeleteConfirm`. The confirm dialog is still open, now rendered over B. The user clicks "Confirm" and `handleDelete` reads the *current* `selectedPersona` (B) and deletes B.
- **Root cause**: `showDeleteConfirm` is reset only in the deselect effect (`!selectedPersona`, lines 79-88), never in the persona-*switch* effect (lines 67-76). The confirm flag is persona-agnostic UI state that outlives the persona it was opened for, while the delete action resolves the target lazily from the live store.
- **Impact**: data loss — irreversible deletion of an unintended persona (and force-cancellation of its running executions).
- **Fix sketch**: Reset `showDeleteConfirm` (and any other per-persona transient UI flags) inside the same effect that fires on `selectedPersona?.id` change, not just on deselect. Better: capture the target persona id when the dialog opens and pass it through to `handleDelete`, refusing to delete if it no longer matches `selectedPersona.id`.

## 3. Persona deletion CASCADE-deletes even when executions could neither be cancelled nor force-marked
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/core/personas.rs:539-560, 571-577, 613-614
- **Scenario**: A running execution for the persona cannot be cancelled by the engine (line 530 returns false) AND the DB force-mark also fails (line 539 returns Err), so its id lands in `cancel_failures` (line 554). The drain loop (582-595) may still observe `all_slots_cleared` as false but, on the *non-timeout* path, the code falls straight through to `repo::delete` (line 614). The persona row is CASCADE-deleted while a live execution is still running and will continue writing to rows that reference the now-deleted persona.
- **Root cause**: `cancel_failures` is collected and logged (571-577) but never gates the final delete. The Phase 2c comment (597-600) only protects the *timeout* branch; a clean drain with outstanding `cancel_failures` is treated as success. The design assumes "drained == safe", but a slot can clear in the tracker while the underlying task is still mid-write, and an un-force-marked execution is the exact case that corrupts FK integrity.
- **Impact**: corruption — orphaned executions, foreign-key violations, or silently dropped writes from tasks that outlive their persona.
- **Fix sketch**: Treat a non-empty `cancel_failures` as a hard stop: return an error (or a `deleted: false` result) instead of deleting, OR run the `force_cancel_all_for_persona` sweep unconditionally (not only on timeout) and re-verify slots are clear before `repo::delete`. Make "delete a persona with un-terminated executions" unreachable.

## 4. `model_profile` JSON is never validated server-side on create or update — corrupt config persists silently
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/commands/core/personas.rs:62-114 (validators); contrast 209-222 (parameters IS validated)
- **Scenario**: Any caller of `create_persona`/`update_persona` (including a future code path, a cloud sync, or a migration) writes a `model_profile` string that isn't valid JSON. `validate_create_persona`/`validate_update_persona` check name, prompt, concurrency, timeout, budget, turns, and notification channels — but never `model_profile`. The malformed blob is stored verbatim. On next load, `buildDraft` (PersonaDraft.ts:94-116) fails to parse it, resets all model fields to the anthropic default, and pauses autosave — the persona is now non-functional until manually repaired.
- **Root cause**: Asymmetric validation. The very next command, `update_persona_parameters`, validates size and JSON-parses its payload (personas.rs:209-222), proving the team knows persisted JSON must be guarded — but the primary `model_profile` write path has no equivalent check. The invariant "stored model_profile is parseable JSON" is enforced only by client-side serialization, which is not a trust boundary.
- **Impact**: UX degradation / latent corruption — a persona silently loses its model config and cannot execute until the user notices the partial-load banner and re-selects a model.
- **Fix sketch**: Add a `validate_model_profile` rule that, when `Some`, rejects non-JSON and oversized blobs (mirroring `MAX_PARAMETERS_JSON_SIZE`), and call it from both `validate_create_persona` and `validate_update_persona`. Enforce the invariant at the DB boundary so no path can write unparseable config.

## 5. Fire-and-forget cloud sync tasks race each other and swallow all failures — cloud can settle on stale state
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/commands/core/personas.rs:135-191 (and the duplicate block 242-295)
- **Scenario**: User makes two rapid edits. `update_persona` returns after the first DB write and spawns sync task T1 carrying snapshot v1; the second edit returns and spawns T2 carrying v2. Each task independently calls `list_deployments().await` and `upsert_persona().await`. There is no ordering or cancellation between them, so if T1's network round trip finishes after T2's, the cloud ends up with v1 — older than local. Every error path (`Err(_) => return` at 146-148, 156-158, and the `if let Err` at 186) is silent or warn-only, so the user is never told the cloud copy is stale or that the sync failed.
- **Root cause**: Background sync is a detached `spawn` with last-writer-by-completion-time semantics and no per-persona serialization or generation token. The snapshot-capture comment (133-138) correctly avoids re-reading stale DB data, but solving the read race does nothing for the *write*-ordering race between concurrent tasks.
- **Impact**: corruption of the remote copy (local↔cloud divergence) plus silent sync failure; "auto-synced" log line is success theater when an out-of-order task wins.
- **Fix sketch**: Serialize cloud sync per persona (e.g. a per-id mutex or a coalescing channel that always pushes the latest snapshot and supersedes in-flight ones), or stamp each upsert with the persona's `updated_at`/version and have the server reject older generations. Surface persistent sync failures to the UI rather than only `tracing::warn!`.

## 6. Header Active-toggle has no in-flight guard and races the debounced settings autosave on the same `enabled` field
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/agents/sub_editor/components/PersonaEditorHeader.tsx:78-92
- **Scenario**: User double-clicks the Active toggle (or clicks it while a settings autosave that also carries `enabled` is in flight). `handleHeaderToggle` reads `nextEnabled = !selectedPersona.enabled` and has no re-entrancy lock, so two near-simultaneous clicks both compute against the same stale `selectedPersona.enabled` and fire two `applyPersonaOp(ToggleEnabled)` calls; the optimistic `patch`/`setBaseline` (lines 87-88) then apply in arrival order. Meanwhile `enabled` is in `SETTINGS_KEYS`, so the debounced `UpdateSettings` save (useEditorSave.ts:84-110) can write a conflicting `enabled` derived from `draft` at a different instant. Final enabled state is non-deterministic and may disagree with the toggle's visual position.
- **Root cause**: Two independent writers (the header toggle and the settings-tab autosave) own the same field with no shared lock, and the toggle derives `next` from the store rather than from an atomic compare-and-set. Unlike `useDebouncedSaveGroup` (which has an `inFlightRef` lock) and `usePersonaSwitchGuard` (which has `isSwitchingRef`), this handler has neither guard nor token check.
- **Impact**: UX degradation / state-corruption — toggle visually flips but the persisted `enabled` ends up opposite, or an extra round trip overwrites a just-saved value.
- **Fix sketch**: Add an `isTogglingRef` re-entrancy guard and a `capturePersonaToken` check around the await (matching the pattern already used in useEditorSave). Route `enabled` changes through a single owner — either the header or the settings autosave — so two writers can never contend for the same field.
