# plugins/artist [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Plugins & Companion | Files read: 21 | Missing: 0

## 1. useMediaFilePicker: three copy-pasted pickers plus a dead ternary
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/artist/sub_media_studio/hooks/useMediaFilePicker.ts:11
- **Scenario**: `pickVideo`, `pickAudio`, and `pickImage` are byte-identical except for the dialog filter name and the extensions constant. Any change to picker behavior (e.g. multi-select, error handling around `artistProbeMedia`) must be made three times. Each copy also contains `const filePath = typeof result === 'string' ? result : result;` — a ternary whose branches are identical, followed by an `as string` cast that papers over the unused non-string branch.
- **Root cause**: The three pickers were written by copy-paste instead of parameterizing the one varying input (filter spec); the ternary is leftover from an earlier Tauri dialog API that could return `string[]`.
- **Impact**: 3x maintenance surface for a trivially parameterizable function; the dead ternary + cast hides that the `string[]` case is unhandled (with `multiple: false` it can't occur, but the cast silences the compiler rather than encoding that).
- **Fix sketch**: Extract `const pick = useCallback(async (name: string, extensions: string[]) => { const result = await open({ multiple: false, filters: [{ name, extensions }] }); return typeof result === 'string' ? artistProbeMedia(result) : null; }, [])` and return `{ pickVideo: () => pick('Video files', VIDEO_EXTENSIONS), ... }` (memoized). This deletes the dead ternary and the cast in one move.

## 2. useTranscriptCache effect churns on every composition edit and self-retriggers via `cache` dep
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/artist/sub_media_studio/hooks/useTranscriptCache.ts:57
- **Scenario**: `paths` is memoized on `composition.items`, whose identity changes on every timeline edit — including every frame of a clip drag. Each change produces a new `paths` array (even when the transcript-path set is unchanged), re-running the effect: it spawns an async IIFE, clones the cache object, and does an O(paths × cachedKeys) `paths.includes` reconciliation per drag frame. Additionally, `cache` is in the dep array, so every `setCache` re-runs the effect one extra time with the just-set value.
- **Root cause**: The memo key is the array identity of `composition.items` rather than the derived path set's content, and the effect reads `cache` directly instead of using a functional update.
- **Impact**: Dozens of no-op effect executions + async closures per second during timeline drags on a hot editing path; wasted work is bounded but entirely avoidable, and the `cache` dep doubles every real load cycle.
- **Fix sketch**: Derive a stable key — `const pathsKey = paths.join('\n')` — and depend the effect on `pathsKey` only. Inside, use `setCache((prev) => ...)` with a functional update (and a `Set` for membership) so `cache` leaves the dep array; the comment on lines 8-10 ("does NOT re-run when the composition mutates in unrelated ways") then actually becomes true.

## 3. TimelineRuler renders a DOM node per tick for the full duration, plus a dead `majorInterval` memo
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/artist/sub_media_studio/TimelineRuler.tsx:23
- **Scenario**: At `zoom >= 100` the tick interval is 0.5s, so a 10-minute composition materializes ~1200 absolutely-positioned `<div>`s (each with a nested tick div and possibly a label span). The whole array is recomputed and the whole list re-rendered on every zoom change (zoom is continuous via slider/wheel) and every duration change (which moves while dragging/trimming clips).
- **Root cause**: Ticks are generated for the entire composition duration rather than the visible scroll window, and tick count scales as O(duration × zoom).
- **Impact**: Thousands of DOM mutations per zoom gesture on long compositions — layout/paint cost on the hottest interaction in the editor. Also, the `majorInterval` memo at line 18 is `if (tickInterval >= 5) return 5; return 5;` — both branches return 5, so it's a dead conditional that misleads readers into thinking major spacing adapts to zoom.
- **Fix sketch**: Have the parent pass the visible window (`scrollLeft`, `clientWidth`) and generate only ticks for `[scrollLeft/zoom - pad, (scrollLeft+width)/zoom + pad]`; alternatively draw the ruler on a `<canvas>` sized to the viewport. Independently, replace the `majorInterval` memo with `const majorInterval = 5;` (or make it genuinely zoom-dependent).

## 4. GalleryMode type defined twice (feature types.ts vs artistSlice)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/artist/types.ts:1
- **Scenario**: `export type GalleryMode = "2d" | "3d"` exists both here and verbatim in `src/stores/slices/system/artistSlice.ts:6`. `GalleryPage.tsx` imports the feature copy while the store (state + `setGalleryMode`) uses its own copy — they only stay compatible by structural luck.
- **Root cause**: The type was duplicated instead of imported when the store slice was written (or vice versa); `types.ts` now contains nothing but this one line.
- **Impact**: Adding a mode (e.g. "video") to one definition and not the other produces confusing assignability errors far from the edit site; the single-line `types.ts` file also suggests the feature has local types it doesn't actually have.
- **Fix sketch**: Keep one definition — the store slice is the natural owner since it holds the state — re-export or import it in `GalleryPage.tsx`, and delete `src/features/plugins/artist/types.ts` (verify no other importers; grep shows only GalleryPage imports the feature copy).

## 5. formatFileSize duplicated across artist and n8n-templates features
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/artist/utils/format.ts:1
- **Scenario**: An independent `formatFileSize` implementation lives in `src/features/templates/sub_n8n/steps/upload/n8nUploadTypes.ts:16` and is used by four files there, while this copy serves the artist gallery. Two byte-size formatters can drift in rounding/unit thresholds, giving inconsistent size strings across the app.
- **Root cause**: Each feature grew its own formatter because no shared `lib/format` home exists for it.
- **Impact**: Bounded — the logic is small — but it is exactly the kind of util that belongs in one place, and the artist copy is already unit-tested (`utils/__tests__/format.test.ts`) while the n8n copy is not.
- **Fix sketch**: Move `formatFileSize` to a shared location (e.g. `src/lib/format.ts` or `src/features/shared/utils/`), point both features at it, and carry the existing tests along. Verify the two implementations agree on edge cases (KB threshold, decimals) before unifying; keep whichever behavior the tests pin.
