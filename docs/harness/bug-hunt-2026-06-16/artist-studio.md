# Bug Hunter — Artist Studio

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: artist-studio | Group: First-Party Plugins

## 1. Concurrent generations clobber the single shared session-tracking slot — second generate orphans the first
- **Severity**: Critical
- **Category**: ⚡ Race condition / 💀 silent failure
- **File**: `src/features/plugins/artist/hooks/useCreativeSession.ts:33` (and `src/stores/slices/system/artistSlice.ts:69,124`)
- **Scenario**: A session is running. The input is `disabled={running}` in the UI, but `running` is a single global boolean and `creativeSessionId` is a single global string. If two `CreativeStudioPanel` instances mount (e.g. blender tab + a remounted panel), or the store's `running` flag is briefly out of sync with the actual backend job, `sendPrompt` runs again: it calls `setSessionId(newId)` with a fresh `crypto.randomUUID()`, overwriting the previous session id in the store.
- **Root cause**: Frontend models "the creative session" as one global id/running pair, but the Rust `CREATIVE_JOBS` manager tracks an unbounded map keyed by per-call UUID. There is no per-session UI state and no backend `ensure_not_running` guard at the command level (`artist_run_creative_session` calls `insert_running` directly, and each call has a unique id so the dup-guard never trips).
- **Impact**: The first job keeps running in the backend (kill_on_drop won't fire — task still owns the child), emitting `ARTIST_SESSION_OUTPUT` for `job_id` A while the store now only knows about B. `cancel()` cancels only B, leaving A as a runaway CLI subprocess for up to 10 minutes. The first generation's output silently vanishes from the panel; its completion's auto-scan still runs, so assets appear "from nowhere".
- **Fix sketch**: Track running sessions as a set/map keyed by id in the store; OR gate `sendPrompt` on the backend by adding `CREATIVE_JOBS.ensure_not_running` on a stable per-panel session id. At minimum, refuse to start a new session while `creativeSessionRunning` is true even if the React `disabled` guard is bypassed.

## 2. `[Error]`/`failed` status event flips `running=false` but never finalizes the session record
- **Severity**: High
- **Category**: 💀 Silent failure / 🔮 latent
- **File**: `src/features/plugins/artist/hooks/useCreativeSession.ts:116-133`
- **Scenario**: Backend marks a job `failed` (CLI not found, timeout, MCP spawn error). The STATUS handler runs: it appends the `[Error]` line and calls `finalizeCreativeSession(job_id, 'failed')`. But the `error` field is only populated on the `failed` path via `set_status(..., Some(msg))`; the `cancelled` status emitted by `artist_cancel_creative_session` carries `error: None`, and the `completed` path is intentionally finalized elsewhere. The branch `if (status === 'failed') finalize` is fine, but when the backend stale-sweeper (`sweep_stale_running`) marks a job failed, it sets status in the map but **emits no event** — `set_status` is never called from the sweep path.
- **Root cause**: `sweep_stale_running` (background_job.rs:164) mutates `job.status = "failed"` directly in the locked map without emitting a Tauri status event. Status events only fire on explicit `set_status` calls. The artist session has no polling fallback (unlike snapshot-based consumers), so a stale-swept job never notifies the UI.
- **Impact**: A creative session that wedges (e.g. CLI hangs producing no lines, child never exits) gets swept to `failed` server-side after ~10.5 min, but the panel shows the streaming spinner forever, input stays disabled, and the session record stays `running`. User must reload the app. Classic "generation never completing" with success-theater removed but no failure surfaced.
- **Fix sketch**: Have `sweep_stale_running` emit a status event for each swept id, or add a snapshot poll in `useCreativeSession` that reconciles the store `running` flag against `get_snapshot` on an interval / on window focus.

## 3. Lightbox index races gallery mutation — wrong asset shown or deleted out from under the viewer
- **Severity**: High
- **Category**: ⚡ Race condition / 🕳️ edge case
- **File**: `src/features/plugins/artist/sub_gallery/Gallery2D.tsx:53-59,86,121`
- **Scenario**: Lightbox is open at `lightboxIndex` = N. Meanwhile a creative session completes and `scanForNewAssets` imports new images, or another delete/refresh re-sorts the `assets` array (default sort is `date desc`, so a new asset shifts every index). `currentAsset = assets[lightboxIndex]` now points at a *different* image than the one the user opened. `goNext`/`goPrev` do `% assets.length` against the new length, so navigation jumps unpredictably. If `assets` shrinks below the open index (bulk delete of later items, or the displayed asset itself deleted), `assets[lightboxIndex]` becomes `undefined` and the overlay unmounts mid-interaction.
- **Root cause**: Lightbox identity is tracked by array index, not by asset id, while the underlying `assets` array is a live, re-sortable, mutable list refreshed by background scans.
- **Impact**: User opens image A, a background scan lands, and they're now zooming/copying-path on image B without noticing — `copyPath` copies the wrong file path. Worst case the overlay silently closes. "Wrong asset displayed" + "gallery refresh racing generation".
- **Fix sketch**: Track the open asset by `id`; derive the index from `assets.findIndex(a => a.id === openId)` for prev/next, and close cleanly (or hold the last-known asset) if the id is no longer present.

## 4. `artist_read_image_base64` rejects every gallery image when the artist folder is a symlink path mismatch / first-segment case
- **Severity**: Medium
- **Category**: 🕳️ Edge case / 💀 silent failure
- **File**: `src-tauri/src/commands/artist/mod.rs:374-384`
- **Scenario**: The confinement check canonicalizes the requested file and requires `canon.starts_with(root_canon)` where `root_canon = ~/Personas`. But `artist_get_default_folder` (line 313) builds the watched folder as `home.join("Personas").join("Artist")` **without canonicalizing**, and assets are stored with their raw (non-canonical) `file_path` from `scan_dir_recursive` (`path.to_string_lossy()`, line 805). On macOS `$HOME` is frequently a symlink (`/Users/me` is fine, but `/var` → `/private/var` style indirection, or a relocated home, or an 8.3/case-differing Windows path) so `canon` (resolved) and `root_canon` can diverge in the *first* segment. The result of `starts_with` is then `false`.
- **Root cause**: The stored asset path (used as the cache key and IPC argument) is never reconciled with the canonical form the security check uses. The check canonicalizes the target but compares against a root that is only `unwrap_or(managed_root)` canonicalized — a mismatch makes legitimate images fail with `Forbidden`.
- **Impact**: Every thumbnail and lightbox image silently fails to load (`useLocalImage` swallows the rejection at `.catch(() => setDataUrl(null))`), leaving permanent spinners (`Loader2`) on cards with no error surfaced. On affected environments the gallery is functionally broken with zero diagnostics.
- **Fix sketch**: Canonicalize the stored asset path at scan time (or canonicalize both sides consistently at read time and compare canonical-to-canonical), and surface a one-time toast when `artistReadImageBase64` rejects rather than swallowing to `null`.

## 5. Module-level data-URL cache retains base64 of deleted/renamed assets
- **Severity**: Low
- **Category**: 🔮 Latent / resource retention
- **File**: `src/features/plugins/artist/hooks/useLocalImage.ts:10-22,49-54`
- **Scenario**: `useLocalImage` caches each image's full base64 data URL in a module-scope `Map` keyed by `filePath`. When an asset is deleted (`deleteAsset`) or renamed (`renameAsset` changes `file_path`), the old key's entry is never invalidated — it lingers until LRU eviction at 300 entries. Each entry holds the entire image inflated ~1.33x as a UTF-16 JS string; at the 64 MB-per-file cap that is a large heap footprint, and renames double-count (old path + new path both cached).
- **Root cause**: Cache lifecycle is decoupled from asset lifecycle; deletes/renames don't call into the cache. There is no `invalidate(filePath)`.
- **Impact**: Memory bloat in heavy editing sessions (generate → rename → delete loops). A deleted-then-recreated file at the same path also serves a *stale* cached image until eviction — "gallery showing stale/deleted assets" for the lightbox/thumbnail bitmap even after the DB row is gone or renamed.
- **Fix sketch**: Export an `invalidateLocalImage(filePath)` and call it from `deleteAsset`/`renameAsset` (invalidating both old and new path); optionally key the cache by asset id + mtime instead of raw path.
