# Code-refactor scan — Persona CRUD & Editor

> Total: 10 findings (2 high, 5 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

> Scope note: the task listed paths that do not exist in this codebase
> (`AgentList.tsx`, `AgentCard.tsx`, `AgentEditor.tsx`, `AgentDrawer*`,
> `PersonaGrid`, `src/api/agents/duplicate.ts`,
> `src-tauri/.../duplicate.rs`, `editorSlice.ts`, `drawerSlice.ts`). I
> scanned the actual analogues — `sub_editor/`, `components/persona/*`,
> `commands/core/personas.rs`, `db/repos/core/personas.rs`,
> `personaSlice.ts`, `api/agents/personas.ts`.

## 1. Duplicated cloud auto-sync block in `update_persona` and `update_persona_parameters`
- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/commands/core/personas.rs:118-177` and `:226-281`
- **Scenario**: Both `update_persona` and `update_persona_parameters` spawn an
  identical fire-and-forget cloud-sync task: lock `cloud_client`, list
  deployments, find a matching `persona_id`, load tools, call
  `engine::prompt::assemble_prompt`, build the same `serde_json::json!`
  body (15 identical fields), and `client.upsert_persona(&body).await`.
  The two blocks are ~55 LOC each and differ only in the trailing log
  message ("after update" vs "after parameter update").
- **Root cause**: `update_persona_parameters` was added later as a
  lightweight specialisation but the cloud-sync side-effect was
  copy-pasted instead of routed through a shared helper.
- **Impact**: ~110 duplicated LOC; any future field added to the cloud
  upsert body (e.g. `parameters`, `gateway_exposure`) must be touched in
  two places. Already drifting — neither block forwards `parameters` or
  `gateway_exposure` despite both being persisted server-side, so the
  cloud copy silently becomes stale on any param-only update.
- **Fix sketch**: Extract `fn spawn_cloud_sync(state: &Arc<AppState>, id:
  String, persona: Persona, reason: &'static str)` that performs the
  deployment check, tool load, prompt assembly, body build, and
  `upsert_persona` call. Both update commands then become a single line.

## 2. Five sequential `await deletePersona(id)` loops with identical error logging
- **Severity**: medium
- **Category**: duplication
- **File**:
  `src/features/agents/components/persona/PersonaOverviewActions.tsx:69-77`
  and `:92-101`
- **Scenario**: `handleBatchDelete` and `handleDeleteDrafts` both run
  `for (const id of ids) { try { await deletePersona(id); } catch (err) {
  logger.error('Failed to delete...', { id, error: err }); } }` with
  near-identical bodies. The single-item `handleDelete` (lines 45-56)
  has the same try/catch shape.
- **Root cause**: Each handler grew independently as new bulk-delete
  paths were added (selection, drafts) without a shared helper.
- **Impact**: 3 nearly identical await-loops + try/catch blocks; bug
  fixes (e.g. converting sequential awaits to `Promise.allSettled` for
  parallel deletes, surfacing a toast with the failure count) must be
  applied in three places.
- **Fix sketch**: Extract `async function deleteMany(ids: string[],
  context: 'batch' | 'drafts')` that runs the loop and reports
  aggregated failures via a single toast. Have `handleBatchDelete` and
  `handleDeleteDrafts` call it.

## 3. Two inline red-error banner `<div>`s instead of `BannerPrimitive`
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/sub_editor/components/EditorBody.tsx:162-184`
- **Scenario**: Two consecutive `<div className="animate-fade-slide-in
  mx-6 my-2 rounded-modal px-3 py-2 flex items-center gap-2
  bg-red-500/10 border border-red-500/20">` blocks (one for
  `failedTabs`, one for generic `saveError`) duplicate the exact
  container styling already provided by `EditorBanners.tsx`
  `BannerPrimitive` with `colorScheme: 'red'`. The component sits next
  to `<UnsavedChangesBanner>`, `<CloudNudgeBanner>`, `<PartialLoadBanner>`
  — all of which already use `BannerPrimitive`.
- **Root cause**: When `BannerPrimitive` was extracted, these two inline
  banners weren't migrated. The `red` colour scheme was added to
  `COLOR_SCHEMES` (line 32-35) anticipating this consolidation but never
  used.
- **Impact**: Banner styling is now defined in 3 places (the constants
  map, plus 2 hard-coded class strings). The two inline banners also
  diverge in trivia (one uses `animate-spin` on its icon, the other a
  static `RefreshCw`).
- **Fix sketch**: Add `FailedTabsBanner` and `SaveErrorBanner` exports to
  `EditorBanners.tsx` that wrap `BannerPrimitive` with the red scheme,
  then replace lines 162-184 with two component calls.

## 4. `getPersona`, `exportPersona`, `importPersona` API wrappers used only in tests
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/api/agents/personas.ts:31-32` (`getPersona`), `:73-74`
  (`exportPersona`), `:78-79` (`importPersona`)
- **Scenario**: All three exports are only imported from
  `src/api/__tests__/personas.test.ts`. Production code uses
  `getPersonaDetail` (the batched fetch) and never calls `export_persona`
  / `import_persona` (the actual `ExportSection.tsx` uses
  `export_persona_bundle` instead — a different command).
- **Root cause**: Single-persona import/export was likely superseded by
  the bundle-based portability surface
  (`ExportSection.tsx` → `export_persona_bundle`), but the originals were
  left for backward compat and never removed. `getPersona` was likely
  replaced by `getPersonaDetail` for the same reason.
- **Impact**: ~10 LOC + two unused Tauri command bindings carried
  forward. The Rust-side `export_persona` / `import_persona` and
  `get_persona` commands (in `commands/core/personas.rs:32-36` and
  elsewhere) are kept alive solely by the bindings.
- **Fix sketch**: Verify with grep over `src-tauri/` that the Rust
  commands `export_persona`/`import_persona`/`get_persona` are not
  referenced by Rust integration tests, then delete the TS wrappers, the
  test cases, and the Rust commands (or mark with `#[allow(dead_code)]`
  if tests still need them).

## 5. Symmetric save-with-undo dance duplicated across `performSettingsSave` and `performModelSave`
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/sub_editor/libs/useEditorSave.ts:84-109`
  and `:111-160`
- **Scenario**: Both callbacks follow the same 6-step recipe: capture
  `savePersonaId` and `prevBaseline`, construct the `PersonaOperation`,
  `await applyPersonaOp(savePersonaId, op)`, guard "persona switched
  during await" by checking `useAgentStore.getState().selectedPersona?.id
  !== savePersonaId`, call `setBaseline((prev) => ({ ...prev,
  ...pickKeys(d, KEYS) }))`, then `pushUndo(makeUndoEntry(op,
  prevBaseline, d, KEYS))`. The only material difference is the operation
  payload itself.
- **Root cause**: The undo-aware save protocol grew incrementally; each
  new save group repeated the boilerplate rather than extracting it.
- **Impact**: ~50 LOC of structural duplication. The "persona switched
  during await" guard is a critical correctness invariant — having it
  duplicated raises the risk of a future save group forgetting it.
- **Fix sketch**: Extract `function runUndoableSave<K extends keyof
  PersonaDraft>(op: PersonaOperation, draft: PersonaDraft, keys:
  readonly K[]): Promise<void>` that encapsulates capture → apply →
  guard → setBaseline → pushUndo. Each `performXSave` then becomes "build
  op, call helper".

## 6. `fetchDetail` and `prefetchPersona` repeat the same state-merge logic
- **Severity**: medium
- **Category**: duplication
- **File**: `src/stores/slices/agents/personaSlice.ts:189-241`
  (`fetchDetail`) and `:243-316` (`prefetchPersona`)
- **Scenario**: Both methods destructure the response with `const {
  tools, triggers, subscriptions, automations, warnings, ...baseFields }
  = detail` (lines 198-199 and 266-274), build the same
  `PersonaDetailExtras` literal, then run an almost-identical `set((state)
  => { const nextCache = { ...state.detailCache, [id]: extras }; const
  inList = state.personas.some(...); const nextPersonas = inList ?
  state.personas.map(...) : [...state.personas, baseFields as Persona];
  return { ... } })` block.
- **Root cause**: `prefetchPersona` was added later (with extra
  `Promise.allSettled` orchestration) but the post-fetch state merge was
  copy-pasted from `fetchDetail`.
- **Impact**: ~25 LOC duplicated; the two paths can drift on what they
  consider "fresh" (only `prefetchPersona` updates `selectedPersona`
  conditionally; only `fetchDetail` clears `selectedPersona` on
  superseded sequence). A future state-shape change must touch both.
- **Fix sketch**: Extract `applyPersonaDetail(state, id, detail, opts: {
  updateSelected: boolean })` returning the partial-state update, then
  call it from both methods.

## 7. `pickKeys` helper is structurally redundant with `draftChanged` pattern
- **Severity**: low
- **Category**: duplication
- **File**: `src/features/agents/sub_editor/libs/useEditorSave.ts:16-20`
- **Scenario**: `pickKeys(d, keys)` and `draftChanged(d, baseline, keys)`
  both iterate the same key array against a `PersonaDraft`. The
  `PersonaDraft` key arrays already centralise field membership; having
  two micro-iterators (one in `useEditorSave`, one in `PersonaDraft.ts`)
  using the arrays differently is awkward.
- **Root cause**: `pickKeys` was added without considering the existing
  iteration helpers.
- **Impact**: 5 LOC. Not material on its own, but if a third operation
  (e.g. "compute a per-key diff for the undo entry payload") is ever
  needed, it would be a 3rd hand-rolled iteration.
- **Fix sketch**: Move `pickKeys` next to `draftChanged` in
  `PersonaDraft.ts` and export it from the same module, so both helpers
  live alongside the key arrays they consume.

## 8. Stale TODO/legacy comment block: `last_test_report` carve-out in `buildUpdateInput`
- **Severity**: low
- **Category**: cruft
- **File**: `src/api/agents/personas.ts:264-267`
- **Scenario**: The `buildUpdateInput` helper has a 4-line carve-out
  comment explaining that `last_test_report` is "owned by
  build_sessions.rs (Phase 2 tool_tests surface) — never set from the
  frontend builder, so always pass null here." The field is then hard-set
  to `null` while every other `Option<Option<T>>` field uses
  `partial.X !== undefined ? partial.X : null`. The carve-out exists
  *only* because `PartialPersonaUpdate` doesn't even expose
  `last_test_report` — so the comment defends against a code-shape that
  cannot occur.
- **Root cause**: Defensive comment added during a refactor; the type
  was tightened later (last_test_report excluded from
  `PartialPersonaUpdate`) but the comment + redundant hardcoded `null`
  weren't pruned.
- **Impact**: 4 lines of cruft; the comment is now load-bearing only as
  documentation, not as a guard.
- **Fix sketch**: Either re-add `last_test_report?:` to
  `PartialPersonaUpdate` for symmetry (and let the same conditional
  serializer handle it), or shorten the comment to a one-liner: "/**
  Set by build_sessions only; not exposed via the editor. */".

## 9. Persona model_profile parse fallback uses `console.warn` instead of the `createLogger` channel used elsewhere
- **Severity**: low
- **Category**: cruft
- **File**: `src/features/agents/sub_editor/libs/PersonaDraft.ts:106-110`
- **Scenario**: `buildDraft` falls back to `console.warn` (with an
  `eslint-disable-next-line no-console`) when JSON parse fails, even
  though the rest of the persona stack uses `createLogger('persona')` /
  `createLogger('editor-document')`. The disable comment signals this is
  a known exception to project policy.
- **Root cause**: `buildDraft` is called outside a React component and
  was likely written before the logger pattern was widely adopted; the
  author opted for `console.warn` + eslint-disable instead of importing
  the logger.
- **Impact**: Single lint exception that should be unnecessary; the
  warning bypasses structured-log filtering and the future
  `personaLogChannel` aggregation.
- **Fix sketch**: Replace with `createLogger('persona-draft').warn(...)`
  and remove the `eslint-disable-next-line` comment.

## 10. Empty/unused barrel exports in `sub_editor/index.ts` (`useTabSection` typings, `useEditorHistory`)
- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/agents/sub_editor/index.ts:7,20`
- **Scenario**: Barrel re-exports `useEditorHistory`, `TabSaveError`,
  `type UndoEntry`, and `useTabSection`/`TabSaveMode`/`TabSectionConfig`/
  `TabSectionHandle`. Grep over `src/` shows that outside `sub_editor/`
  itself, only `useEditorDirty` and `type PersonaDraft` are imported via
  the barrel (4 call sites). The remaining 8 re-exported names are
  internal-only — every use is within `sub_editor/` and goes via the
  relative `../libs/...` path.
- **Root cause**: The barrel was written defensively to make every
  symbol available, but consumers landed on relative imports instead.
- **Impact**: Minor module-resolution overhead and a misleading
  signal that `useEditorHistory`/`TabSaveError`/`useTabSection` are part
  of the public surface when they aren't.
- **Fix sketch**: Trim `sub_editor/index.ts` to only the symbols
  consumed cross-feature (`useEditorDirty`, `PersonaDraft`,
  `SETTINGS_KEYS`, `MODEL_KEYS`, `DEFAULT_PERSONA_TIMEOUT_MS`,
  `MIN_PERSONA_TIMEOUT_MS`, `MAX_PERSONA_TIMEOUT_MS`, `buildDraft`,
  `draftChanged`). Move the internal-only re-exports out.
