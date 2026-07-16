# plugins/drive — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 2 medium / 2 low)
> Context group: Plugins & Companion | Files read: 22 | Missing: 0

## 1. Drag-move payload handling copied 4×, and one copy already lost the ancestor-guard
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/drive/components/DriveFileList.tsx:363
- **Scenario**: The "parse `application/x-drive-move` JSON → loop paths → skip self → refuse ancestor-into-descendant → build `dst` → `await drive.move`" block exists in four places: `DriveFileList.handleDropOn` (:363), `DriveSidebar.TreeNode.handleDrop` (DriveSidebar.tsx:398), `DriveToolbar.handleSegmentDrop` (DriveToolbar.tsx:109), and `DrivePage.handleMoveSelection` (DrivePage.tsx:480). The copies have already diverged: `handleDropOn` in DriveFileList is the only one WITHOUT the `dst.startsWith(\`${p}/\`)` ancestor→descendant guard, so dropping a folder onto its own child folder row in the list view reaches the backend instead of being filtered client-side like the other three surfaces.
- **Root cause**: Each drop surface (list row, tree node, breadcrumb pill, Move-to popover) grew its own inline copy of the same move loop instead of calling a shared helper.
- **Impact**: Four maintenance points for one behavior; the missing guard proves drift already happened. Any future rule (e.g. collision rename, trash exclusion) must be applied in 4 places or the surfaces silently disagree.
- **Fix sketch**: Add `moveManyInto(paths: string[], dst: string)` to `useDrive` (it already owns `move` and all the invariants) with the self/ancestor guards inside, plus a tiny `parseDriveMovePayload(e: DragEvent): string[] | null` util next to it. Replace all four inline loops with a parse + one call. This also fixes the list-view guard gap for free.

## 2. Multi-item move triggers a full refresh cascade per item (3N refetch IPC calls)
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/plugins/drive/hooks/useDrive.ts:657
- **Scenario**: `useDrive.move` ends with `pathCacheRef.clear(); refresh(); refreshTree(); refreshRecent()`. Every multi-item move path (DrivePage `handleMoveSelection`/`handleRestoreSelection`, list-row drop, sidebar-node drop, breadcrumb drop) calls `await drive.move(p, dst)` sequentially in a `for` loop. Moving 20 selected files therefore issues 20 sequential `drive_move` IPC calls interleaved with 20× `drive_list` + 20× `drive_list_tree("",4)` (a full 4-level tree walk) + 20× `drive_recent` — ~80 IPC round-trips, plus 20 setState-driven re-renders of the whole Finder mid-drag.
- **Root cause**: `move` was written for the single-item case (rename, single drop) and bundles its own refresh; the bulk callers reuse it in a loop, unlike `pasteHere`/`remove` which use `runBulk` with one refresh at the end.
- **Impact**: Large drops feel sluggish (linear IPC latency compounding, the file hook's own comment notes ~5–10ms/invoke floor) and the tree walk is repeated N−1 times for nothing; the UI also flickers through N intermediate listings.
- **Fix sketch**: Give `useDrive` a `moveMany(pairs: Array<{src,dst}>)` that runs the raw `driveMove` calls through the existing `runBulk` (concurrency 8), flashes each result, then clears the cache and refreshes once. Route the four bulk call-sites (see finding 1 — same helper) through it; keep `move` for genuine single-item ops.

## 3. Kind-bucket count/sort logic triplicated across DrivePage, DriveDetailsPane, DriveKindFilterBar
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/drive/DrivePage.tsx:788
- **Scenario**: The idiom "count entries into a `Map` keyed by `visualForEntry(e).labelKey`, then sort entries by `kindBucketWeight`, with `key as Parameters<typeof kindBucketWeight>[0]` casts" appears three times: `DeleteBreakdown` (DrivePage.tsx:788–800), `MultiSelectSummary` (DriveDetailsPane.tsx:307–321), and `DriveKindFilterBar` (:22–33). A fourth partial copy (per-row bucket + `bucketCounts` reduce) lives in `ListView` (DriveFileList.tsx:414–420).
- **Root cause**: `designTokens.ts` exposes the primitives (`visualForEntry`, `kindBucketWeight`) but not the aggregate ("bucket counts for a list of entries"), so each consumer re-derived it — including the ugly `Parameters<typeof …>[0]` casts to recover the `DriveKindLabelKey` type that isn't exported.
- **Impact**: Three near-identical blocks to keep in step whenever the bucket taxonomy changes, and the unexported key type forces type-cast noise at every call site.
- **Fix sketch**: In `designTokens.ts`, export `DriveKindLabelKey` and add `kindBucketCounts(entries: DriveEntry[]): Array<[DriveKindLabelKey, number]>` returning weight-sorted pairs. Replace the three aggregation blocks and delete the casts.

## 4. Icon-grid and filmstrip thumbnails ship the full file bytes over IPC for a 64px tile
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/plugins/drive/hooks/useLazyImageThumb.ts:39
- **Scenario**: `useLazyImageThumb` calls `driveRead(path)` — the full file — for every image tile that scrolls near the viewport in icons view (`IconTileVisual`, DriveFileList.tsx:646) and in the lightbox filmstrip (DriveImageLightbox.tsx:530). A folder of phone photos (5–10 MB each) transfers and decodes tens of MB across the Tauri IPC boundary just to paint 64×64/56×56 `object-cover` tiles; scrolling back and forth re-fetches because off-screen tiles free their blob and there is no byte cache.
- **Root cause**: No thumbnail endpoint or size hint exists on the Rust side, so the lazy hook's only option is the full `drive_read`; the eviction strategy (good for memory) then guarantees repeat full reads on scroll.
- **Impact**: Measurable waste on a hot path — icons view over a media folder does full-resolution reads per visible tile and repeats them on every scroll pass; IPC serialization of large byte arrays also stalls the main process.
- **Fix sketch**: Add a `drive_thumbnail(path, max_edge)` Tauri command that decodes + downscales (e.g. `image` crate, 128px, JPEG/WebP out) with an on-disk cache keyed by path+mtime; point `useLazyImageThumb` at it. Cheaper interim: keep a small LRU of blob URLs in the hook module so scroll round-trips don't re-read unchanged files.

## 5. Kind-sort comparator recomputes visualForEntry twice per comparison
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: cpu
- **File**: src/features/plugins/drive/hooks/useDrive.ts:516
- **Scenario**: With sortKey="kind", the `visibleEntries` comparator calls `visualForEntry(a)`/`visualForEntry(b)` (mime/extension string matching) on every comparison — ~2·n·log n evaluations per keystroke of the search box or per refresh in a large folder, versus n if precomputed.
- **Root cause**: The weight lookup lives inside the sort comparator instead of being resolved once per entry before sorting.
- **Impact**: Bounded (folders are typically hundreds of entries, `visualForEntry` is cheap), but it's the hottest derived computation in the hook and the fix is trivial.
- **Fix sketch**: When `sortKey === "kind"`, build the weight per entry first (`const w = new Map(filtered.map(e => [e.path, kindBucketWeight(visualForEntry(e).labelKey)]))`) and compare via map lookups; or decorate-sort-undecorate.

## 6. Leftover scaffolding: debtText placeholder and dead onRenameRequest prop threading
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/drive/signing/DriveSignDialog.tsx:143
- **Scenario**: `DriveSignDialog` renders its notes placeholder through `debtText("auto_optional_context_stored_alongside_the_sign_ab2cb9d2")` — an i18n-debt shim in an otherwise fully translated feature (DriveVerifyDialog:118–119 also has two hardcoded English sidecar-status strings). Separately, `DriveFileList`'s `ListView` renames its `onRenameRequest` prop to `_onRenameRequest` (DriveFileList.tsx:273) — unused since renames went inline — yet the prop stays required in `Props` and is still threaded from `DrivePage` into `ListView` and `IconsView`, which never read it.
- **Root cause**: Inline-rename migration (cycles 9/10/24/27 per the DrivePage comment) removed the consumers but not the plumbing; the debtText key was never promoted to a real translation.
- **Impact**: Cosmetic/maintenance only, but the `_`-prefixed prop and the debt key both signal unfinished migrations to the next reader.
- **Fix sketch**: Add a real `t.plugins.drive` key for the sign-notes placeholder (and the two verify sidecar-status strings) and drop the `debtText` import. Remove `onRenameRequest` from `ListView`/`IconsView` usage (keep it only where the context menu needs it via DrivePage's `requestRename`), making it optional in `Props` or deleting the threading entirely.
