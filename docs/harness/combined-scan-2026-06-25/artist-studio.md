# Artist Studio — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: artist-studio | Group: First-Party Plugins
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

## 1. Delete only removes the DB row — the file survives and a re-scan resurrects the "permanently deleted" asset
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-integrity / silent failure
- **File**: src-tauri/src/db/repos/resources/artist.rs:82 (and command src-tauri/src/commands/artist/mod.rs:230; UI copy src/features/plugins/artist/sub_gallery/AssetCard.tsx:260)
- **Scenario**: User hovers an asset → trash icon → ConfirmDialog states `"<name>" will be permanently deleted.` They confirm. The card disappears. Later they click "Scan folder" (GalleryPage toolbar) or simply finish any creative session (which auto-scans on completion). The image reappears in the gallery.
- **Root cause**: `delete_asset` runs `DELETE FROM artist_tags` + `DELETE FROM artist_assets` only — it never calls `std::fs::remove_file` on `asset.file_path`. The file stays on disk. `scan_dir_recursive` re-discovers it and `insert_asset` (INSERT OR IGNORE on file_path) re-inserts it with a fresh UUID because the row no longer exists. So "delete" is a hide-until-next-scan, not a delete.
- **Impact**: Deletion does not persist across the app's primary import workflow; the confirm copy is factually false; orphaned image files accumulate on disk indefinitely (a disk-space leak the user can never reclaim from the UI). Tags applied before deletion are lost on re-import, but the bytes are not — a confusing half-state.
- **Fix sketch**: In `artist_delete_asset`, fetch the asset, `std::fs::remove_file(&asset.file_path)` (or move to a trash subfolder) inside the managed root, then delete the DB row; tolerate a missing file. Alternatively soft-delete (a `deleted_at` column the scanner respects) and change the dialog copy to match the real semantics.
- **Value**: impact=7 effort=4

## 2. Grid renders full-resolution base64 as "thumbnails" and caches them by count, not bytes — multi-hundred-MB to multi-GB renderer heap
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: memory / performance
- **File**: src/features/plugins/artist/hooks/useLocalImage.ts:10 (cache) ; src/features/plugins/artist/sub_gallery/AssetCard.tsx:88 + 141-150 (full-res img)
- **Scenario**: User scrolls a gallery of a few hundred AI-generated PNGs (Leonardo/SD output is commonly 1024²+, 1–4 MB each). Each card calls `useLocalImage(asset.filePath)` which fetches the *entire* original file as a base64 data URL (≈1.33× the file bytes) and stores it in a module-scope `Map`. The Map evicts only when it exceeds `MAX_CACHE_ENTRIES = 300`, regardless of byte size, and never clears on gallery unmount.
- **Root cause**: (a) No thumbnail is ever generated — `scan_dir_recursive` always sets `thumbnail_path: None` (mod.rs:811) and the card binds to the full file path, so the grid decodes full-res images at 400×400. (b) The LRU cap is by entry count, not a byte budget; the backend even permits 64 MB per image (mod.rs:344), so 300 cached entries can hold gigabytes.
- **Impact**: Steady heap growth toward ~300×(filesize×1.33) held for the app's lifetime → WebView jank, scroll stutter, and realistic renderer OOM on large galleries of big images. The full-res decode also wastes decode/raster cost on every visible card.
- **Fix sketch**: Generate and persist real thumbnails (downscaled WebP/PNG) at scan time, store in `thumbnail_path`, and have AssetCard load that. Additionally bound the module cache by total bytes (track accumulated `dataUrl.length`, evict oldest until under budget), and evict the lightbox/full-res entry when its card unmounts.
- **Value**: impact=7 effort=4

## 3. "Image generated" / session-complete is reported on CLI exit alone — no asset is verified, so an empty or mis-saved generation silently looks successful
- **Severity**: Medium
- **Lens**: bug-hunter / ambiguity-guardian
- **Category**: silent failure / unclear semantics
- **File**: src-tauri/src/commands/artist/mod.rs:435 (Ok branch) ; src/features/plugins/artist/hooks/useCreativeSession.ts:152 (announce) + 108
- **Scenario**: User asks the creative session to make an image. The CLI runs, the model refuses / chats without calling a tool / saves the file to a path outside the artist folder. The process still exits 0. Backend sets status `completed`, emits `ARTIST_SESSION_COMPLETE`, and fires a desktop notification "Session finished with 0 output lines." Frontend announces "Image generated" and the auto-scan imports nothing. The user is told it succeeded; no asset exists.
- **Root cause**: Completion is bound to process exit (`run_creative_cli` returns `Ok(output_lines)` even when `output_lines == 0`, mod.rs:707) rather than to a produced asset. The save location is only *instructed* in the system prompt ("IMPORTANT: Save ALL generated files into {folder}", mod.rs:535) with nothing enforcing it, and `scanForNewAssets` only appends a line when `imported > 0` (useCreativeSession.ts:108) — a zero-import result is indistinguishable from success. The hardcoded "Image generated" announcement also fires for Blender-only or text-only sessions that never produce an image.
- **Impact**: Misleading success; the user believes an asset was created and may not retry. Combined with the failure path (no auto-scan on `failed`/`cancelled`, so a gen that produced a file *then* errored/timed-out at the tail leaves the file un-surfaced until a manual scan).
- **Fix sketch**: After completion, diff the scan result; if zero new assets were imported, announce/toast "Session finished but no new asset was found" instead of "Image generated." Make the announcement reflect the actual tool set. Optionally run the auto-scan on `failed`/`cancelled` too so partially-produced files surface.
- **Value**: impact=5 effort=2

## 4. In-flight image load re-populates the module cache *after* `invalidateLocalImage`, defeating stale-image eviction on delete/rename
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race condition / cache coherence
- **File**: src/features/plugins/artist/hooks/useLocalImage.ts:60 (putInCache in `.then`) vs :30 (invalidate)
- **Scenario**: An AssetCard for path P is mid-load (the `artistReadImageBase64(P)` IPC is in flight). The user deletes or renames that asset. `deleteAsset`/`renameAsset` call `invalidateLocalImage(P)`, which clears `cache` and `inflight`. The already-running promise then resolves and runs `putInCache(P, oldDataUrl)`, re-inserting the stale image into the cache after the invalidation. If path P is later reused (e.g. the file at P is regenerated/overwritten and re-scanned), `useLocalImage(P)` serves the old cached bytes.
- **Root cause**: `invalidateLocalImage` removes the inflight entry but cannot cancel the resolution; `putInCache` has no "was this path invalidated since the load began?" guard, and the load isn't fenced by a generation token.
- **Impact**: Wrong (old) image shown for a reused path — the exact stale-thumbnail bug the eviction code was written to prevent. Narrow (requires the delete/rename to land during an in-flight load plus later path reuse), so visual-only and low frequency.
- **Fix sketch**: Track an invalidation epoch per path (or a monotonically increasing token); in the `.then`, skip `putInCache` if the path was invalidated after the load started. Simpler: have `invalidateLocalImage` record a "poisoned" generation that `putInCache` checks before writing.
- **Value**: impact=4 effort=2

## 5. Every session completion re-walks the entire artist folder and issues one IPC import per existing asset — O(total assets) work per generation
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance / scalability
- **File**: src/features/plugins/artist/hooks/useCreativeSession.ts:99 (`scanForNewAssets`); same pattern in src/features/plugins/artist/hooks/useArtistAssets.ts:41
- **Scenario**: A user with a large library (thousands of files in ~/Personas/Artist) runs creative sessions. Each completion triggers `scanForNewAssets`, which scans the whole tree and then `await artistImportAsset(asset)` *sequentially for every file found* — even though almost all are already imported (INSERT OR IGNORE returns None). N images ⇒ N serial IPC round-trips per generation, every generation.
- **Root cause**: Import reconciliation is done one row at a time over IPC with no batching and no "only import paths not already in the DB" pre-filter; the full folder is re-scanned each time instead of diffing.
- **Impact**: Each generation incurs a latency spike proportional to total library size; the await chain blocks the post-completion UX (toast/auto-import line) and hammers the DB pool. Scales poorly precisely as the gallery becomes valuable.
- **Fix sketch**: Add a bulk `artist_import_assets(Vec<ArtistAsset>)` command doing a single transactional `INSERT OR IGNORE` batch, or pre-filter scanned paths against `list_assets` before importing. At minimum, parallelize/limit the per-asset calls instead of a serial `for ... await`.
- **Value**: impact=4 effort=4
