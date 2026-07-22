# teams/teamWorkspace [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 1 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 6 | Missing: 1 (teamStudio/TeamAssignmentBoard.tsx)

## 1. Orphaned sub_canvas subtree (~30 files) kept alive by a context provider nobody reads
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_teamWorkspace/TeamCanvas.tsx:11
- **Scenario**: TeamCanvas.tsx's own doc comment states the React Flow edge-wiring canvas (`sub_canvas/`) is "no longer rendered; those files are now orphaned and slated for removal" — yet the entire `src/features/teams/sub_canvas/` tree (~30 files: nodes, edges, debugger, assistant, optimizer, reducer) still exists. Verified: the ONLY import of `sub_canvas` outside itself is `PersonasPage.tsx:14` pulling `CanvasDragProvider` from the barrel, and `useCanvasDragRef` (the sole reader of that context) has ZERO consumers anywhere in src/ — the provider wraps a context nobody reads.
- **Root cause**: The 2026-05-23 Split Studio replacement removed the canvas render path but left the files and one vestigial provider wrapper in PersonasPage, so the "slated for removal" cleanup never happened.
- **Impact**: ~30 dead files show up in every grep/refactor/audit of the teams feature (this scan included), and the vestigial provider makes the tree look live, blocking the cleanup indefinitely.
- **Fix sketch**: Remove `<CanvasDragProvider>` (and its import) from PersonasPage.tsx — safe since `useCanvasDragRef` has no callers — then delete `src/features/teams/sub_canvas/` wholesale. Before deleting, grep once more for the other barrel exports (`buildTeamGraph`, `TEAM_ROLES`, `PersonaAvatar`, `getConnectionStyle`) in case any are imported via deep paths; run tsc + build as the gate.

## 2. Barrel import drags @xyflow/react and the whole dead canvas into the eager bundle
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: bundle
- **File**: src/features/personas/PersonasPage.tsx:14
- **Scenario**: `import { CanvasDragProvider } from '@/features/teams/sub_canvas'` resolves through `sub_canvas/index.ts`, an eager barrel re-exporting ~20 modules; 8 of them import `@xyflow/react` (PersonaNode, StickyNoteNode, ConnectionEdge, GhostEdge, AlignmentGuides, useCanvasReducer, useDerivedCanvasState, canvasActions). PersonasPage is the app shell, so every startup parses the React Flow library plus all orphaned canvas components for a 15-line context provider.
- **Root cause**: Side-effect-free tree-shaking cannot drop the barrel's transitive `@xyflow/react` graph reliably in a Vite dev/desktop build; the single named import keeps the whole chunk reachable.
- **Impact**: Meaningful dead weight (React Flow is one of the heavier UI deps) in the main window bundle and slower dev-server module graph, paid on every app launch of a Tauri desktop app for code that renders nothing.
- **Fix sketch**: Same removal as finding 1 solves it entirely. If the provider must survive short-term, change PersonasPage to a deep import (`.../sub_canvas/libs/CanvasDragContext`) so the barrel — and the React Flow graph behind it — drops out of the module graph immediately.

## 3. presetScrim() is an unused export
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_teamWorkspace/presetStudio/presetBackground.ts:38
- **Scenario**: `presetScrim()` ("legibility scrim laid over an illustration") is exported but never imported anywhere in src/ — `PresetGalleryShowcase.tsx` uses only `presetBackgroundImage` and `presetGradient`.
- **Root cause**: The scrim was presumably designed alongside the gallery cards but the final card implementation handles legibility differently (or dropped it), leaving the helper stranded.
- **Impact**: Minor: a misleading exported API that suggests illustrations get a scrim when they don't; small dead-code cost.
- **Fix sketch**: Either delete `presetScrim` and its doc comment, or — if gallery text over the PNG backgrounds is actually hard to read — wire it into `PresetGalleryShowcase` as the intended overlay. Decide by eyeballing the gallery with the six existing preset-bg PNGs.

## 4. 14KB auto-generated glyph path data eagerly bundled for an empty-state-only illustration
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: bundle
- **File**: src/features/teams/sub_teamWorkspace/networkGlyphData.ts:4
- **Scenario**: `NETWORK_GLYPH` is a ~14KB array of 40+ SVG path strings imported statically by TeamList.tsx, but it renders only inside `EmptyState` (TeamList.tsx:424) — i.e. only when the user has zero teams, which for any active user is never.
- **Root cause**: The motionize emit tool generates a static module and the natural static import puts it in TeamList's eager graph regardless of render path.
- **Impact**: Bounded: ~14KB of parse/bundle weight on the teams view for a one-time onboarding visual. Cheap, but pure waste for every returning user.
- **Fix sketch**: Lazy-load the glyph: `const NetworkGlyph = lazy(() => import('./networkGlyphData').then(...))` wrapped in a tiny component used only by EmptyState, or move EmptyState (with its static import) into its own `React.lazy` file. Keep the auto-generated file untouched so the emit tool's regenerate path still works.
