> Context: agents/components [1/2]
> Total: 10
> Critical: 0  High: 1  Medium: 4  Low: 5

## 1. Test marked "passed" when every tool was skipped (success theater)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/features/agents/components/matrix/useLifecycle.ts:143-152
- **Scenario**: In `handleStartTest`, `allPassed = report.tools_failed === 0 && totalTools > 0`. When a draft's tools all require credentials that aren't in the vault, the backend returns them as `skipped` (`tools_passed = 0`, `tools_failed = 0`, `tools_skipped = N`). `totalTools = N > 0`, so `allPassed` becomes `true`. The store gets `handleTestComplete(true, ...)` → `buildTestPassed = true`, and the notification fires "Agent Test Passed / All 0 tools passed. Ready to promote."
- **Root cause**: `allPassed` conflates "nothing failed" with "something was actually verified." Skipped ≠ passed.
- **Impact**: UX / trust — a persona whose tools were never exercised is presented as fully tested, and `handlePromote` (useLifecycle.ts:210) then allows promotion without `force`, so an unverified agent reaches production silently.
- **Fix sketch**: Require real coverage: `allPassed = report.tools_failed === 0 && report.tools_passed > 0`. When only skips occurred, drive a distinct "untested — N skipped" verdict that still requires the "Approve Anyway" (force) path.

## 2. Constellation drag leaves `justDraggedRef` latched, swallowing the next node click
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/agents/components/allPersonas/PersonaOverviewVariantConstellation.tsx:310-337, 480-488
- **Scenario**: On a committed drag, `handleNodePointerUp` sets `justDraggedRef.current = true`. It's only reset inside a node's `onClick`. But the pointer was captured on the node and released over a rail chip, so the trailing `click` hit-tests to the chip (or nothing), not the origin `<motion.g>`. The node's `onClick` never runs, so `justDraggedRef` stays `true`. The *next* legitimate click on any node is then suppressed (`if (justDraggedRef.current) { reset; return; }`), opening nothing.
- **Root cause**: The "suppress the click after a drag" latch assumes the trailing synthetic click always lands back on the dragged node; it doesn't when the drop target is a different element.
- **Impact**: UX — after moving a persona to a team via the constellation, the user's next node click is silently eaten and they must click twice.
- **Fix sketch**: Reset `justDraggedRef` unconditionally on the next `pointerdown` (or via a short `setTimeout(0)` after pointerup) rather than relying on the node's own `onClick` to clear it.

## 3. PersonaConfigPanel `load()` has no unmount/concurrency guard
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/agents/components/allPersonas/PersonaConfigPanel.tsx:299-363
- **Scenario**: `load()` awaits `listPersonas()` then `resolveEffectiveConfigBulk(...)` and calls `setRows`/`setGlobalLoading` afterward, with no `cancelled` flag (unlike PersonaOverviewPage which guards its effect). If the panel unmounts mid-await (user switches the `pageTab` back to 'personas'), the trailing `setRows` runs after unmount. Worse, a Refresh click while an initial `load()` is in flight starts a second overlapping `load()`; the two `setRows` calls race and the slower one wins, potentially showing stale config over fresh.
- **Root cause**: Async state writes aren't tied to an alive/latest-request token.
- **Impact**: UX / stale data — React unmounted-update warning; a rapid refresh can display superseded config values.
- **Fix sketch**: Add a `let cancelled = false` / request-id captured per `load()` call, bail before each `setState` when superseded, and clear it on unmount.

## 4. Auto-submit debounce is keyed on the unstable `build` object, so the timer never settles under streaming
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/agents/components/matrix/UnifiedBuildEntry.tsx:440-461
- **Scenario**: The auto-submit effect's dep array is `[build, draftPersonaId]`. `useBuild` returns a fresh object literal every render (useBuild.ts:136), so `build` has a new identity on every render. While the CLI streams (`outputLines`/`buildActivity` update frequently during `analyzing`/`resolving`), the component re-renders repeatedly; each render tears down and re-arms the 250 ms timer via the cleanup, so the submit keeps getting cancelled and only fires if a full 250 ms quiet window happens to open.
- **Root cause**: Debouncing on an object identity that changes every render instead of on the primitive values the logic actually reads (`buildPhase`, `pendingQuestions.length`, `pendingAnswerCount`).
- **Impact**: UX / correctness — buffered answers can be delayed or, under continuous streaming, effectively stall until activity pauses; the LLM re-emits the same questions (the exact failure the comment says this effect fixes).
- **Fix sketch**: Depend on the specific primitives (`build.buildPhase`, `build.pendingQuestions?.length ?? 0`, `build.pendingAnswerCount`, `draftPersonaId`) and call `build.handleSubmitAnswers` via a ref, so identity churn doesn't reset the debounce.

## 5. `makeStreamSafe` discards a partial code block when it's the first content
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/agents/components/ChatMessageContent.tsx:28-35
- **Scenario**: For a streamed message that *begins* with an unterminated fence (e.g. `"```python\nprint(1"`), `fenceCount` is odd, `lastIndexOf('\n```')` is `-1` (no newline precedes the fence), so `start = indexOf('```') = 0`. The function returns `content.slice(0, 0) + '```\n```'` = an empty code block — the partial code being streamed is dropped from the render.
- **Root cause**: The `lastFence === -1` fallback to `indexOf` yields `start = 0`, and `slice(0, 0)` throws away the body it meant to preserve as a placeholder.
- **Impact**: UX — a code-first streaming reply flashes an empty box instead of the incremental code until the closing fence arrives.
- **Fix sketch**: When the open fence is at index 0, keep the streamed body and only append the closing fence (`return content + '\n```'`) rather than slicing everything before it away.

## 6. `ViewPresetBar` component is dead code (and hides an `isDefault` bug)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/agents/components/allPersonas/ViewPresetBar.tsx:30-295
- **Scenario**: Grepping `<ViewPresetBar` across src returns zero JSX usages; every import from this file is `type AgentListViewConfig` or `DEFAULT_VIEW_CONFIG` (PersonaOverviewPage/Toolbar/Filters/Columns). The `ViewPresetBar` function, `SMART_PRESETS`, `SmartPreset`, and all the saved-view CRUD (`listSavedViewsByType`/`createSavedView`/`deleteSavedView`) are never rendered — the live toolbar is `PersonaOverviewToolbar`. The dead code also carries a latent bug: `isDefault` (lines 156-161) checks `sortKey === 'name' && sortDirection === 'asc'`, but `DEFAULT_VIEW_CONFIG` is `sortKey: 'lastRun', sortDirection: 'desc'`, so the "default" state would never register as default.
- **Root cause**: The preset bar was superseded by the toolbar/filter-header UI but left behind because it still exports the shared type + const.
- **Impact**: maintainability — ~250 LOC of unreachable UI plus dead API calls; the buried `isDefault` mismatch is a trap for anyone reviving it.
- **Fix sketch**: Move `AgentListViewConfig` + `DEFAULT_VIEW_CONFIG` into a tiny `viewPresetTypes.ts`, repoint the four importers, and delete the `ViewPresetBar` component + `SMART_PRESETS`.

## 7. Duplicated "is building" predicate
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/agents/components/allPersonas/PersonaOverviewCardList.tsx:129
- **Scenario**: The exact expression `id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted'` is defined once as the `isBuilding` callback in PersonaOverviewPage.tsx:123-126 (and threaded to the grid/constellation), then re-implemented inline in the card item here rather than reusing it.
- **Root cause**: The card item reads `buildPersonaId`/`buildPhase` from its own store selector instead of taking the already-computed predicate as a prop.
- **Impact**: maintainability — a change to the "building" definition must be made in two places or the layouts drift.
- **Fix sketch**: Export a `isPersonaBuilding(id, buildPersonaId, buildPhase)` helper (or pass the page's `isBuilding` down) and use it in both.

## 8. Duplicated sort+search logic across the two persona selectors
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/agents/components/PersonaSelector.tsx:37-47
- **Scenario**: PersonaSelector and PersonaSelectorModal (PersonaSelectorModal.tsx:37-46) contain byte-identical `sorted` (name `localeCompare`) and `filtered` (`name.toLowerCase().includes`) `useMemo` blocks plus the same `selected` lookup.
- **Root cause**: The modal was cloned from the inline selector without factoring the list logic out.
- **Impact**: maintainability — search/sort behavior (e.g. adding description matching) has to be kept in sync manually.
- **Fix sketch**: Extract a `usePersonaPicklist(personas, search)` hook returning `{ sorted, filtered }` and consume it in both.

## 9. Dead `handleGenerate` option on `UseLifecycleOptions`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/components/matrix/useLifecycle.ts:32-36
- **Scenario**: `UseLifecycleOptions` declares an optional `handleGenerate?: (...) => Promise<void>` with a doc comment, but the hook body only destructures `personaId` (line 62-64) and never references `handleGenerate`; the sole caller (UnifiedBuildEntry.tsx:330) passes only `personaId`.
- **Root cause**: Leftover from an earlier design where lifecycle could restart a build session.
- **Impact**: maintainability — a documented-but-inert option implies a capability that doesn't exist.
- **Fix sketch**: Delete the `handleGenerate` field from `UseLifecycleOptions`.

## 10. Repeated persona icon-frame markup
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/agents/components/allPersonas/PersonaOverviewCells.tsx:95-100
- **Scenario**: The identical framed-icon wrapper — `div.icon-frame icon-frame-pop bg-primary/10 border border-primary/15` with the `p.color ? { borderColor: `${color}30`, backgroundColor: `${color}15` }` inline style around `<PersonaIcon ... framed />` — is copy-pasted in NameCell here, in PersonaOverviewCardList.tsx:167-171, and in the constellation dossier (PersonaOverviewVariantConstellation.tsx:622-627).
- **Root cause**: No shared "framed persona icon chip" component despite three consumers wanting the same tinted frame.
- **Impact**: maintainability — frame styling / color-tint tweaks must be repeated in three files.
- **Fix sketch**: Add a small `PersonaIconFrame({ persona, size, frameSize })` wrapper encapsulating the frame div + color style and reuse it.
