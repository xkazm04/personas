# agents/glyph [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 2 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 28 | Missing: 0

## 1. 310KB archetypeGlyphData.ts is eagerly bundled into the compose-surface chunk but only needed after a modal click
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: bundle-payload
- **File**: src/features/agents/sub_glyph/personaCore/archetypeGlyphData.ts:1
- **Scenario**: `UnifiedBuildEntry` is lazy-loaded (PersonasPage.tsx:38, CreatePersonaEntry.tsx:5), but its chunk statically pulls `GlyphDialogueCinemaLayout` → `PersonaCoreModal` → `PersonaCoreCodex` → `SnapshotColumn` → `MentalityCard` → `archetypeGlyphData` (317,757 bytes of auto-generated SVG path strings, 9 archetypes / 330 paths). Every time the persona build surface opens, ~310KB of string literals is downloaded/parsed even though the glyphs render only inside the PersonaCoreModal, which the user must explicitly open via the persona-core badge.
- **Root cause**: The traced-avatar data was generated as a plain `export const` and imported statically by MentalityCard, so the modal-only asset rides in the hot compose chunk.
- **Impact**: The dominant share of the build-entry chunk is this one data file — measurable parse/heap cost (large string allocation) on every entry into the core persona-creation flow, paid by all users, consumed by few.
- **Fix sketch**: Lazy-load the data at the modal boundary: `const PersonaCoreCodex = lazy(() => import("./PersonaCoreCodex"))` inside PersonaCoreModal (the modal already has a `core.loading` spinner path to reuse as Suspense fallback), or `import("./archetypeGlyphData")` inside MentalityCard/SnapshotColumn with the existing lucide-icon fallback shown until it resolves. Either keeps the fallback `<Icon/>` path intact and moves ~310KB out of the compose chunk.

## 2. GlyphTopBar carries four dead props still threaded by all three callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_glyph/GlyphTopBar.tsx:7
- **Scenario**: `GlyphTopBarProps` declares `agentName`, `onAgentNameChange`, `isBuilding`, `buildPhase` (and imports `BuildPhase` solely for it), but the component destructures only `isPreBuild, face, onFaceChange, editLocked` — its own doc comment (lines 22-27) says the name/phase UI was removed. All three callers (GlyphFullLayout.tsx:220, GlyphDialogueCinemaLayout.tsx:88, GlyphCinemaLayout.tsx:75) still pass the four values.
- **Root cause**: When the top-bar was slimmed to just the face switcher, the prop contract and call sites were not pruned along with the JSX.
- **Impact**: Misleading contract — readers (and refactoring tools) assume the bar consumes the agent name and build phase; the two cinema layouts even manufacture filler values (`face="glyph"`, `onFaceChange={() => {}}`) around genuinely-used props, making the dead ones harder to spot. Four files carry noise.
- **Fix sketch**: Delete the four fields from `GlyphTopBarProps`, drop the now-unused `BuildPhase` import, and remove the corresponding attributes at the three call sites. Consider making `face`/`onFaceChange` optional-with-default for the two cinema layouts that hard-pin them.

## 3. DIM_LABEL duplicated between glyphLayoutHelpers and the canonical persona-sigil copy (and the local copy bypasses i18n)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_glyph/glyphLayoutHelpers.ts:10
- **Scenario**: `glyphLayoutHelpers.ts` defines `DIM_LABEL` with the exact same 8 entries as the canonical `src/features/shared/glyph/persona-sigil/dimLabel.ts:12`. The same file already re-exports `CELL_KEY_TO_DIM`/`DIM_TO_CELL_KEY` from persona-sigil (the "Glyph-convergence P4" pass), but the label map was left behind. Sole consumer is GlyphAnswerCard.tsx:78.
- **Root cause**: Partial convergence — the cell↔dim maps were unified with the shared sigil module, the label map was not.
- **Impact**: Two sources of truth for dimension wording; a rename in one drifts from the other. Worse, GlyphAnswerCard reads the raw English map while the rest of the sigil UI localizes through `useGlyphDimText()` (which GlyphDimensionSummaryCard in this same folder already uses), so the answer card's dimension title stays English in non-English locales.
- **Fix sketch**: Delete the local `DIM_LABEL` from glyphLayoutHelpers.ts and switch GlyphAnswerCard to `useGlyphDimText().label[dim]` (matching GlyphDimensionSummaryCard); if a non-hook fallback is truly needed, re-export the persona-sigil `DIM_LABEL` the same way the cell maps are re-exported.

## 4. GlyphSigilCanvas.tsx is a re-export shim with a single remaining importer
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_glyph/GlyphSigilCanvas.tsx:1
- **Scenario**: The file is a 4-line shim ("Canonical Persona Sigil lives at src/features/shared/glyph/persona-sigil/... New code should import directly") whose only importer in src/ is GlyphSigilFace.tsx:4.
- **Root cause**: Compatibility shim kept after the sigil canvas moved to the shared module; the last local caller was never migrated.
- **Impact**: One extra indirection file that contradicts its own instruction; trivial but pure noise in the folder.
- **Fix sketch**: Point GlyphSigilFace.tsx at `@/features/shared/glyph/persona-sigil` (it already exports GlyphSigilCanvas via its index) and delete the shim. Verify no test/automation code imports the shim path first.
