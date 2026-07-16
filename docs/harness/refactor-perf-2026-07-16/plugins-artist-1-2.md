# plugins/artist [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 4 medium / 0 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. Drag-and-drop media import is a dead code path — `File.path` never exists in the webview
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx:211
- **Scenario**: User drags a video/audio/image file from Explorer onto the Media Studio. The rose "Import media" overlay appears (drag-over styling works), but on drop nothing is ever added to the timeline — no error, no toast.
- **Root cause**: `handleDrop` reads `(file as unknown as { path?: string }).path` from the HTML5 `DataTransfer` `File` object. Browser `File` objects have no `.path` property (that is an Electron extension), so `filePath` is always `undefined` and every file hits `continue`. On top of that, Tauri v2's default `dragDropEnabled: true` (no override anywhere in `src-tauri`) intercepts native file drops on Windows/WebView2, so the HTML5 drop event typically doesn't even carry files. The Drive plugin already solved this correctly by reading file *content* from `dataTransfer`, and Tauri exposes real paths via `getCurrentWebview().onDragDropEvent`.
- **Impact**: An advertised interaction (the empty state literally says "drag & drop") silently no-ops for every user; ~60 lines of `handleDrop` + the `VIDEO/AUDIO/IMAGE_EXTENSIONS` matching in it are unreachable-in-effect code that reads as working.
- **Fix sketch**: Replace the HTML5 `onDrop` path with `getCurrentWebview().onDragDropEvent()` (Tauri v2), which delivers absolute paths on `drop` — feed those into the existing `artistProbeMedia` + `addItem` branches (which are fine as-is). Keep `dragOver` state driven by the same event's `over`/`leave` phases. Delete the `File.path` cast.

## 2. Gallery bulk-selection logic duplicated verbatim between Gallery2D and Gallery3D
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/artist/sub_gallery/Gallery2D.tsx:76
- **Scenario**: Any change to bulk-delete semantics (e.g. adding the cache invalidation that deletes already do per-asset, or a confirm step) must be made twice; the two copies have already been observed to drift only by luck.
- **Root cause**: `handleToggle`, `handleBulkDelete`, `handleBulkAddTag`, the `useGallerySelection` wiring, the `GallerySelectionBar` mount, and the modal keyboard navigation (`ArrowLeft/ArrowRight/Escape` listener) are copy-pasted between `Gallery2D.tsx` (lines 47–99, 227–264 keyboard in lightbox) and `Gallery3D.tsx` (lines 26–92) with identical bodies.
- **Impact**: ~70 duplicated lines across two files in the same folder; classic drift hazard for destructive operations (bulk delete).
- **Fix sketch**: Extract a `useGalleryBulkActions(assets, { onDelete, onUpdateTags })` hook returning `{ selectedIds, isSelected, inSelectMode, handleToggle, handleBulkDelete, handleBulkAddTag, clear, count }`, and a small `useViewerKeyboardNav({ active, onNext, onPrev, onClose })` hook for the shared arrow/Escape handling. Both galleries shrink to their layout-specific parts.

## 3. Three near-identical module-cache hooks (useLocalImage / useVideoThumbnails / useAudioWaveform)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/artist/sub_media_studio/hooks/useVideoThumbnails.ts:117
- **Scenario**: The next cached-media hook (e.g. real backend-generated thumbnails, transcript sidecars) will copy the same ~40-line skeleton a fourth time; a fix to the shared pattern (e.g. the inflight-abort ref-counting noted as TODO in useVideoThumbnails) has to be replicated per file.
- **Root cause**: `useLocalImage`, `useVideoThumbnails`, and `useAudioWaveform` each hand-roll the identical pattern: module-level `cache` Map + `inflight` Map + `putInCache` LRU eviction + a hook with cached-initial-state, cache-hit effect, inflight-promise dedup, and `cancelled` cleanup. Only the loader function and eviction policy differ (byte-budget vs entry-count).
- **Impact**: ~120 lines of triplicated plumbing; behavioral inconsistencies already exist (useLocalImage does LRU `touch` on hit and ref-counted release; the other two do neither) that are invisible without reading all three.
- **Fix sketch**: Extract `createCachedResource<T>(load: (key: string) => Promise<T>, opts: { maxEntries?; maxBytes?; sizeOf? })` returning `{ useResource(key), invalidate(key) }` in a shared `lib/cachedResource.ts`. Reimplement the three hooks as one-liners over it; keep `invalidateLocalImage` as a re-export. Pure refactor, no behavior change required for the first pass.

## 4. Beat-anchor resolution effect floods the undo history and doubles renders on every anchored edit
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/artist/sub_media_studio/MediaStudioPage.tsx:109
- **Scenario**: A composition has several word-anchored beats. The user drags a video clip (or trims it) — every pointer-move commit shifts the clip, the effect re-resolves each anchor and calls `updateItem` per beat, each of which is a *separate history frame* (tags are `updateItem:<beatId>`, unique per beat, so `commit` never coalesces across beats). Ctrl+Z afterwards steps through dozens of mechanical beat-nudge frames instead of undoing the drag, and the 80-entry `MAX_HISTORY` gets flushed by machine writes.
- **Root cause**: The effect runs on every `composition.items` identity change and writes back through the same history-tracked `updateItem` mutator that user edits use, once per anchored beat. Each write also produces a fresh `composition.items`, re-running the effect and re-triggering `JSON.stringify` + the (debounced) IPC recompile in `useRenderPlan`.
- **Impact**: During a drag with N anchored beats: N extra history frames + N extra render passes per gesture; user-visible undo corruption (undo no longer reverses the last user action) plus wasted stringify/compile churn at pointer-move frequency.
- **Fix sketch**: Add a non-history mutator to `useMediaStudio` (e.g. `applyDerived(patches: Array<{id, patch}>)` that calls `setHistory(h => ({...h, present: next}))` without touching `past`), and batch all resolved-anchor writes into one call. Derived/mechanical state should never create undo frames. Alternatively, resolve anchor times at read-time (in the compile input) instead of writing them back into items.

## 5. AssetCard grid re-renders every card on any selection or lightbox interaction
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/artist/sub_gallery/AssetCard.tsx:30
- **Scenario**: A gallery with a few hundred imported AI images: the user shift-clicks to build a selection, or steps through the lightbox with arrow keys. Every state change in Gallery2D re-renders all N `AssetCard`s (each running its `useLocalImage` + `useEffect` bookkeeping), producing visible jank on large galleries.
- **Root cause**: `AssetCard` is not memoized, and Gallery2D/3D pass freshly-created closures per render (`onClick={() => openLightbox(asset.id)}`, `onToggleSelect={handleToggle(asset.id, i)}` — a factory invoked in JSX that returns a new function each render), so `memo` would be defeated anyway.
- **Impact**: O(N) card renders per keystroke/click in selection and lightbox flows; each card render includes cache-map lookups and two effects. Scales linearly with gallery size, which is unbounded.
- **Fix sketch**: Wrap `AssetCard` in `React.memo`. Change its contract to take stable callbacks + data: `onOpen(id)`, `onToggleSelect(id, index, shiftKey)` and let the card build the event args, so the parent can pass `useCallback`-stable functions. `selected`/`inSelectMode` remain the only props that change for affected cards.

## 6. Creative session stream re-renders the whole output log per streamed line
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:377
- **Scenario**: A long Blender/Leonardo session streams hundreds of output lines; each `ARTIST_SESSION_OUTPUT` event appends to the store array and CreativeSessionChat re-renders, remapping and re-rendering all previous `OutputLine`s — O(n²) total render work over the stream, on top of the per-line auto-scroll layout.
- **Root cause**: `output.map((line, i) => <OutputLine key={i} .../>)` with an unmemoized `OutputLine`; every append changes the array identity, and index keys plus a non-memo child mean React re-renders each row even though prior lines are immutable.
- **Impact**: Bounded per-line cost is small, but sessions stream fast and the panel is interactive during streaming; long sessions degrade input latency. Cheap to fix.
- **Fix sketch**: `const OutputLine = memo(function OutputLine(...))` — lines are immutable strings, so with stable keys React skips all prior rows. Since lines are append-only, `key={i}` is stable enough; memoization alone eliminates the O(n²) behavior. Optionally cap the live output array (history records already archive the full transcript).
