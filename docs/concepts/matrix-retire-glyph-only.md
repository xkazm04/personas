# Matrix retirement — collapse to Glyph-only template preview

**Status:** Proposal — design + impact analysis. No code changes yet.
**Author:** session 2026-05-10 (kazda)
**Scope:** retire the `<PersonaMatrix>` template-preview surface in `TemplateDetailModal` and cascade-delete the matrix rendering library.

## TL;DR

`<PersonaMatrix>` has exactly one production callsite left: the *Matrix / Glyph* toggle inside the "connectors" tab of `TemplateDetailModal`. Build (`UnifiedMatrixEntry`) and adoption (`MatrixAdoptionView`) both stopped rendering it months ago — they render glyph layouts now and only keep "matrix" in their names. Removing the toggle, defaulting to glyph, and deleting the matrix rendering code reclaims **~25 files** in `src/features/agents/components/matrix/` and `src/features/templates/sub_generated/gallery/matrix/` with no behavior change to the build or adoption flows. The only material UX choice is whether the template-preview reader is better served by a consolidated 8-dimension grid (PersonaMatrix) or a one-card-per-use-case grid (GlyphGrid). This doc argues GlyphGrid is the better single survivor.

## Current state — where matrix UI is actually rendered

| Surface | What renders today | Matrix dependency |
| --- | --- | --- |
| `PersonasPage` build slot (empty state, `isCreatingPersona`, active build) | `UnifiedMatrixEntry` → `GlyphFullLayout` / `GlyphPrototypeLayout` | Hooks (`useMatrixBuild`, `useMatrixLifecycle`) + `quickConfigTypes` + `BehaviorCoreEditor` + `SharedResourcesPanel` + `BuildSimulatePanel`. **No `<PersonaMatrix>` JSX.** |
| `AdoptionWizardModal` (template adopt) | `MatrixAdoptionView` → `<UseCasePickerStep>` → `<QuestionnaireForm>` → `<PersonaChronologyGlyph>` (which is a thin wrapper over `<GlyphGrid>` + `<ChronologyCommandHub>`) | Hooks only (`useMatrixBuild`, `useMatrixLifecycle`). **No `<PersonaMatrix>` JSX.** Comment at `MatrixAdoptionView.tsx:1181-1183` flags `handleApplyEdits`/`handleDiscardEdits` as legacy callbacks for the retired matrix variant. |
| `TemplateDetailModal` "connectors" tab — `ConnectorsTabBody` | Toggle: `view === 'matrix'` ? `<PersonaMatrix>` : `<GlyphGrid>` (default `'matrix'`) + always-rendered `<DesignConnectorGrid>` below | **The only place `<PersonaMatrix>` is mounted in the entire app.** |

Naming is misleading on three counts: `UnifiedMatrixEntry` doesn't render a matrix, `MatrixAdoptionView` doesn't render a matrix, and the matrix-vs-glyph toggle in `TemplateDetailModal` is the only user-facing instance of "matrix" left.

## What `<PersonaMatrix>` shows that `<GlyphGrid>` does not

The two surfaces answer different questions:

- **`<PersonaMatrix>`** — a single 3×3 grid (8 cells around `MatrixCommandCenter`) showing the persona's design across all eight dimensions consolidated: tasks, connectors, triggers, human-review, messages, memory, error-handling, events. Each cell renders a list/badge summary of *all* configured items in that dimension across *all* use cases. There is also an inline "command center" that surfaces workflow upload, simulate/build buttons, and a test report drawer (in edit mode — never invoked in production). The "spatial question popover" wires connector-credential gap warnings into the cells.
- **`<GlyphGrid>`** — a list of `GlyphCard`s, one per use case. Each card shows that use case's title + summary + a sigil that visualises which of the eight dimensions are present (`linked`/`shared`/`none`) for that specific capability. There is no consolidated cross-use-case view.

So:
- The matrix gives a **persona-level birds-eye** ("this persona uses Slack and Gmail, has 2 schedules, sends 3 message types").
- The glyph gives a **per-capability breakdown** ("the 'triage incoming PR comments' use case uses GitHub + Slack on a 5-minute schedule").

For a *template browse / preview* surface, the per-capability view is arguably more informative — a reader exploring whether to adopt a template wants to understand *what the template does*, not just *what services it touches* (the always-rendered `DesignConnectorGrid` underneath already gives the flat services list). The matrix view's birds-eye summary is also weakened in this context because the underlying data (`designResult`) is a static template snapshot, not a live persona — the cells show "what the template would seed", which the use-case cards convey more naturally.

The consolidated dimension-overview signal does have one piece the per-card view loses: **glanceable cross-cutting policy** (e.g. "this template has *human review* on for 2 of 3 use cases"). If retaining that signal matters, it can be added cheaply as a one-line summary chip above the GlyphGrid (or via the existing `renderHeaderBadge`/`renderFooterSlot` slots GlyphGrid already exposes), without keeping the entire `PersonaMatrix` rendering library.

## Files reclaimable on retirement

Numbers below are file counts at HEAD on 2026-05-10. All are present today and traceable from the `<PersonaMatrix>` import graph.

### `src/features/agents/components/matrix/` (15 files reclaimable)

| File | Why it dies |
| --- | --- |
| `cellVocabulary.ts` | `CELL_LABELS` only consumed by `PersonaMatrix.tsx` |
| `SpatialQuestionPopover.tsx` | Only consumer is `PersonaMatrix.tsx` |
| `ReferenceAttachmentPicker.tsx` | Only consumer is `SpatialQuestionPopover` |
| `WebhookSourcePicker.tsx` | Only consumer is `SpatialQuestionPopover` |
| `ConnectorsCellContent.tsx` | Only consumer is `PersonaMatrix.tsx` |
| `MatrixCredentialPicker.tsx` | Only consumer is `ConnectorsCellContent` |
| `useMatrixCredentialGap.ts` | Only consumer is `PersonaMatrix.tsx` |
| `DimensionEditPanel.tsx` | Only consumer is `PersonaMatrix.tsx` |
| `dimensionEditHelpers.ts` | Only consumer is `DimensionEditPanel` |
| `DimensionQuickConfig.tsx` | Only consumer is `PersonaMatrix.tsx` |
| `SchedulePanel.tsx` | Only consumer is `DimensionQuickConfig` |
| `EventsPanel.tsx` | Only consumer is `DimensionQuickConfig` |
| `ServicesPanel.tsx` | Only consumer is `DimensionQuickConfig` |
| `TablePickerModal.tsx` | Only consumer is `ServicesPanel` |
| `cellGlowColors.ts` + `cellStateClasses.ts` + `GhostedCellRenderer.tsx` | Consumed by `MatrixCellRenderer.tsx` (templates dir) — falls when that does |
| `WorkflowUploadZone.tsx` + `useMatrixWorkflowImport.ts` | Consumed by `MatrixCommandCenter.tsx` (templates dir) — falls when that does |

(Plus the matching `__tests__/` files: `cellVocabulary.test.ts`, `cellStateClasses.test.ts`, `cellGlowColors.test.ts`, `GhostedCellRenderer.test.tsx`, `SpatialQuestionPopover.test.tsx`, `ReferenceAttachmentPicker.test.tsx`, `WebhookSourcePicker.test.tsx` — 7 test files.)

### `src/features/agents/components/matrix/` (kept — load-bearing for build flow)

These survive Layer B retirement; only `UnifiedMatrixEntry` itself and `MatrixAdoptionView`'s rename would change.

- `UnifiedMatrixEntry.tsx` — root build wizard mounted by `PersonasPage`
- `useMatrixBuild.ts`, `useMatrixLifecycle.ts` — shared by `UnifiedMatrixEntry` and `MatrixAdoptionView`
- `quickConfigTypes.ts`, `useHealthyConnectors.ts` — shared by glyph layouts and command-panel composer
- `BehaviorCoreEditor.tsx`, `SharedResourcesPanel.tsx`, `BuildSimulatePanel.tsx` — consumed by `GlyphFullLayout` / `GlyphEditFace` / `GlyphPrototypeLayout`
- `__tests__/BuildSimulatePanel.test.tsx`, `useMatrixBuild.test.ts`, `useMatrixLifecycle.test.ts`, `CellStateMachine.test.ts`, `cancelBuild.test.ts`, `editCellParity.test.tsx`, `completenessRing.test.ts`, `featureParity.test.ts` — most kept; `editCellParity.test.tsx` falls because it tests `*EditCell` components in templates dir that are deleted

### `src/features/templates/sub_generated/gallery/matrix/` (~11 files reclaimable)

The entire matrix rendering library disappears.

| File | Notes |
| --- | --- |
| `PersonaMatrix.tsx` | Single callsite removed |
| `MatrixCommandCenter.tsx` + `MatrixCommandCenterParts.tsx` | Only consumer is `PersonaMatrix` (and `ChronologyCommandHub` re-exports a few sub-parts — see below) |
| `MatrixCellRenderer.tsx` | Only consumer is `PersonaMatrix` |
| `EditableMatrixCells.tsx` | Re-export shim; falls with the *EditCell files |
| `ConnectorEditCell.tsx`, `TriggerEditCell.tsx`, `PresetEditCells.tsx` | Edit-mode cells — never invoked in production (no caller passes `editCallbacks`) |
| `TestReportModal.tsx` | Extracted from `MatrixCommandCenterParts`; only consumer is `MatrixCommandCenter` |
| `ExpandedRowContent.tsx` | Re-exported from `gallery/index.ts`; check for external consumers — none found in current grep |
| `matrixEditTypes.ts` | `MatrixEditState` / `MatrixEditCallbacks` types — used only by the *EditCell files |

**Caveat:** `ChronologyCommandHub` (`adoption/chronology/ChronologyCommandHub.tsx`) imports a handful of helpers from `gallery/matrix/MatrixCommandCenterParts`. Those helpers need to either be moved to a chronology-local module or kept in a slimmer `commandCenterParts.ts` that survives the matrix retirement. This is the one non-trivial extraction.

### `gallery/index.ts` re-exports to remove

```ts
export { PersonaMatrix, type PersonaMatrixProps, type MatrixTheme, type MatrixLayout } from './matrix/PersonaMatrix';
export type { MatrixEditState, MatrixEditCallbacks } from './matrix/EditableMatrixCells';
export { MatrixCommandCenter } from './matrix/MatrixCommandCenter';
export { ExpandedRowContent } from './matrix/ExpandedRowContent';
```

### Renames worth doing alongside

These are not strictly required but the legacy names actively mislead:

- `UnifiedMatrixEntry.tsx` → `UnifiedBuildEntry.tsx` (and update `LAYOUT_STORAGE_KEY` usage / migrate `localStorage` value of `personas:build-layout` only if the keys change — they don't, so no migration)
- `MatrixAdoptionView.tsx` → `ChronologyAdoptionView.tsx` (already accurate to what it renders)
- `useMatrixBuild`, `useMatrixLifecycle`, `useMatrixCredentialGap`, `useMatrixWorkflowImport` → drop the `Matrix` prefix (they were named after the legacy surface they originally fed)
- `quickConfigTypes` is fine — it describes the data shape, not the render surface

The renames touch ~25 import sites total. Mechanical; safe.

## Risk analysis

### What breaks if we remove the toggle?

- **User-facing:** A template-browse user who currently defaults into the matrix view loses the consolidated 8-dimension grid. They land on the per-use-case glyph grid instead. The flat services list (`DesignConnectorGrid`) below stays.
- **Test automation:** `src/test/automation/bridge.ts:665,708` references `MatrixAdoptionView` mount waits — these are name-based, so the rename would break them. Update the bridge in the same change.
- **Stored layout pref:** None — the matrix toggle in `TemplateDetailModal` uses local `useState`, not persisted preference.
- **Build / adoption flows:** Unaffected. They never rendered `<PersonaMatrix>` post-glyph migration.

### What breaks if we delete `useMatrixEditCallbacks` (already done in Layer C)?

Already verified: zero importers in production, no test imports the hook itself (the parity test imports the *type* from `EditableMatrixCells`, not the hook). Confirmed clean.

### Hidden coupling to investigate before merging

1. **`ChronologyCommandHub`'s import of `MatrixCommandCenterParts`** — the one non-trivial extraction. Need to identify the exact symbols and decide between (a) moving them into `adoption/chronology/`, (b) keeping a slim `commandCenterParts.ts` shared module, or (c) inlining into `ChronologyCommandHub` if the surface is small.
2. **`buildChronology` / `buildFlowLookup`** — already in `adoption/chronology/useUseCaseChronology.ts` and used both by `TemplateDetailModal` and `MatrixAdoptionView`. Stays.
3. **`gallery/index.ts` external consumers** — grep confirmed no production code imports `PersonaMatrix`, `MatrixCommandCenter`, `ExpandedRowContent`, `MatrixEditState`, or `MatrixEditCallbacks` from `gallery/index.ts` outside the matrix dir itself. Safe to drop the re-exports.
4. **i18n keys** — `cellVocabulary.ts` defines `CELL_LABELS` as plain strings (not via `useTranslation`). Removing it does not orphan i18n keys. The matrix-tab toggle in `TemplateDetailModal` uses literal `'Matrix'` and `'Glyph'` button labels (a separate i18n debt; orthogonal to this work). Audit en.json after the change to confirm no `templates.detail.connectors_*` matrix-specific keys were left orphaned — none expected.
5. **n8n import flow** — comments in `N8nWizardFooter.tsx:24` and `N8nImportTab.tsx:54` reference "build the persona through the PersonaMatrix". Code-trace to confirm those are doc-comment references only (no actual `<PersonaMatrix>` mount) before deleting. Initial grep suggests they are stale comments.

## Migration plan

The work is sequenceable into safe atomic commits.

### Commit 1 — kill the toggle, default to glyph

- `TemplateDetailModal.tsx`: delete `ConnectorsTabBody`'s view-state and toggle JSX, render `<GlyphGrid rows={rows} flowsById={flowsById} />` directly + `<DesignConnectorGrid>` below.
- Keep all matrix code physically present. This is the reversible step — if the new default reads worse, revert is one commit.
- Validation: open a few template detail modals, eyeball the connectors tab, confirm `DesignConnectorGrid` still surfaces the flat services list.

### Commit 2 — add policy-summary chip if needed

- Optional. If usability testing reveals the consolidated cross-cutting signals are missed, add a one-line summary chip row above `<GlyphGrid>` ("3 use cases · 5 connectors · 2 schedules · human review on 2/3"). Cheap to add via GlyphGrid's `slotAbove` prop. Skip this commit if the per-card view is judged sufficient.

### Commit 3 — delete `gallery/matrix/`

- After commits 1-2 land and bake for at least one release.
- Move any surviving symbols out of `MatrixCommandCenterParts` that `ChronologyCommandHub` actually imports into a new `adoption/chronology/commandCenterParts.ts` (or wherever fits).
- `git rm -r src/features/templates/sub_generated/gallery/matrix/`
- Update `gallery/index.ts` re-exports.
- Validation: `npx tsc --noEmit` + `npm run test`.

### Commit 4 — delete the `agents/components/matrix/` files reclaimable per the table above

- 15 production files + 7 test files.
- `npx tsc --noEmit` + `npm run test`.

### Commit 5 — renames (optional, batch with commit 4 if appetite)

- `UnifiedMatrixEntry` → `UnifiedBuildEntry`
- `MatrixAdoptionView` → `ChronologyAdoptionView`
- `useMatrix*` → `use*`
- Update `src/test/automation/bridge.ts` mount waits.
- Find/replace mechanical; ~25 sites.

### Commit 6 — i18n cleanup

- Run `node scripts/i18n/check-coverage.mjs --strict` to check for now-orphaned keys.
- Remove any `templates.detail.connectors_matrix_*` keys (none expected — the toggle uses literal strings — but verify).
- Add proper i18n for any literal labels still showing in the simplified connectors tab.

## Decision points for the team

1. **Default-to-glyph or remove-the-toggle entirely?** The doc assumes the latter. If someone makes the case that *some* readers want the consolidated dimension view, keep the toggle and only delete the *EditCell + edit-mode plumbing (still ~10 file reduction).
2. **Add the policy summary chip?** Decide after one release cycle on the new default. Cheap to add later.
3. **Renames in same PR or follow-up?** Renames are mechanical but touch many files; doing them in a separate PR keeps the matrix-deletion PR's diff easier to review.
4. **`ChronologyCommandHub`'s `MatrixCommandCenterParts` import** — pick the extraction strategy before commit 3. Smallest-surface option preferred.

## What this doc does NOT cover

- Renaming `BuildSimulatePanel` (kept; lives on through glyph layouts).
- The `BehaviorCoreEditor` / `SharedResourcesPanel` story — those are glyph-attached, not matrix-attached, and are out of scope.
- Any backend (Rust) changes — none required. The matrix retirement is purely a frontend rendering decision; `engine/build_session/` and `commands/design/` continue to emit the same `AgentIR` payload.
- Marketing site (`personas-web`) guides — `/guide-sync` after the work to flag any stale screenshots/copy.

## Provenance

This doc was written from a code-trace audit on 2026-05-10 of:
- `App.tsx` → `PersonasPage.tsx` mount tree
- `UnifiedMatrixEntry.tsx` actual JSX (not its stale docstring)
- `AdoptionWizardModal.tsx` → `MatrixAdoptionView.tsx` end-to-end render path
- `TemplateDetailModal.tsx`'s `ConnectorsTabBody` toggle
- All importers of `src/features/agents/components/matrix/*` and `src/features/templates/sub_generated/gallery/matrix/*`

Verified via `Grep`: zero `<PersonaMatrix>` JSX outside `TemplateDetailModal.tsx:354`. Zero `editCallbacks=` props passed to `<PersonaMatrix>` anywhere.
