# Google Drive — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: google-drive | Group: First-Party Plugins
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. "Google Drive" context is actually a local sandbox filesystem; bundled OAuth file gates nothing
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: misleading-abstraction / data-durability + security-model confusion
- **File**: src-tauri/src/commands/drive.rs:1-8 (+ src-tauri/src/engine/google_oauth.rs whole file; src/api/drive.ts:1-9)
- **Scenario**: The context name ("Google Drive"), group, and description ("Browse, preview and act on **Google Drive** files from inside the app") tell a user/agent these files live in their Google Drive cloud account, reached through the bundled `google_oauth.rs`. In reality `drive.rs`'s own module doc says "managed **local** filesystem for agent exports" — files live in `app_data_dir/drive` (release) or `./.dev-drive` (debug). `google_oauth.rs` only resolves a client_id/secret from env/.env and is **never called by any `drive_*` command**; there is no Drive API call, no OAuth scope, no token, no remote sync anywhere in `drive.rs` or `drive.ts`.
- **Root cause**: Two unrelated concerns were bundled under one "Google Drive" label. The naming implies cloud/remote semantics that the implementation does not have; the OAuth file's presence implies access is auth-scoped when it is purely path-sandbox-scoped.
- **Impact**: (a) Data-durability hazard — a user who believes exports are backed up to Google cloud loses them when the machine/app-data is wiped (they only ever existed in a local folder). (b) Security-review hazard — a reviewer assumes Drive ops are OAuth-scoped/remote and under-scrutinises the real trust boundary (the `resolve_safe` path sandbox). (c) Agents told they can "act on Google Drive files" silently act on a local sandbox instead.
- **Fix sketch**: Rename the context to "Local Drive (managed sandbox)" and rewrite the description to state it's an on-disk sandbox, not cloud Drive; document the durability/no-sync semantics. Either wire `google_oauth.rs` into a genuine Google Drive backend or remove it from this context bundle so it stops implying auth-scoped remote access.
- **Value**: impact=7 effort=3

## 2. `AsyncColumnEntries` effect re-runs every render → looping `drive_list` IPC for uncached columns
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: render loop / runaway IPC
- **File**: src/features/plugins/drive/components/DriveFileList.tsx:1045-1063 (deps array line 1063)
- **Scenario**: In columns (Miller) view, ancestor panes render via `AsyncColumnEntries`. Its `useEffect` deps are `[props.path, props.cachedEntriesFor, props]` — `props` is a fresh object literal every render, so the effect re-runs on **every** render. For a path that isn't in useDrive's `pathCacheRef`, `cachedEntriesFor(path)` returns null, so the effect calls `driveList(path)`; the resolve fires `setEntries`/`setLoaded`, which re-render → new `props` → effect re-runs → `seed` is still null (this local `driveList` never writes to `pathCacheRef`, only useDrive's own load at useDrive.ts:256 does) → `driveList` fires again → loop.
- **Root cause**: `props` in the dependency array defeats the very stability the surrounding comment claims to protect; and entries fetched here are never cached, so the cache check can never short-circuit the loop.
- **Impact**: Continuous `drive_list` IPC + a full `read_dir` per call against the managed root, plus constant React churn, for as long as an uncached ancestor column is on screen. Likelihood is high because **any** mutation that clears the cache makes every ancestor column uncached at once — e.g. `move()` runs `pathCacheRef.current.clear()` (useDrive.ts:666), so a single drag-move in columns view sets every ancestor pane spinning.
- **Fix sketch**: Change deps to `[props.path, props.cachedEntriesFor]` (drop `props`); optionally write fetched entries into the shared cache (or accept a stable `onLoaded` callback) so a re-fetch short-circuits.
- **Value**: impact=7 effort=2

## 3. `AsyncColumnEntries` has no `.catch` → a failed `drive_list` silently renders an empty column
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: swallowed error surfaced as empty result
- **File**: src/features/plugins/drive/components/DriveFileList.tsx:1053-1059
- **Scenario**: `driveList(props.path).then(list => setEntries(list)).finally(() => setLoaded(true))` has no `.catch`. If the listing rejects (folder deleted out from under the user, a path-validation throw from `validateRelPath`, or any IPC error), `.then` never runs, `entries` stays `[]`, and `.finally` flips `loaded` true — so the pane renders `ColumnEmptyLabel` ("empty folder"). The user sees a healthy-looking empty directory instead of an error, and the rejection is an unhandled promise.
- **Root cause**: Missing error branch; unlike `DriveDetailsPane.FilePreview` (which has both a `cancelled` guard and a `.catch` → error state), this sibling fetch omits both.
- **Impact**: A directory that failed to load is indistinguishable from a genuinely empty one. A user could conclude files are gone (and e.g. re-create or re-export them), or miss that a deletion/permission problem occurred. Combined with finding #2, the failure also re-fires every render.
- **Fix sketch**: Add `.catch((err) => { silentCatch("drive:column")(err); if (!cancelled) setError(true); })` and render an error label when set.
- **Value**: impact=5 effort=2

## 4. `ImagePreviewBlob` lacks a cancelled guard → details pane shows the wrong file's image (+ blob URL leak)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: async race / stale-result shown for wrong selection
- **File**: src/features/plugins/drive/components/DriveDetailsPane.tsx:613-630
- **Scenario**: Select image A, then quickly select image B before A's bytes load. The effect for A has kicked off `driveRead(A)` (pending). Re-render for B runs cleanup for A's effect: `current` is still `null` (A not resolved yet) so nothing is revoked; then B's effect starts. A's read now resolves and unconditionally calls `setUrl(blobA)` — there is no `cancelled` flag. If A resolves after B, the pane ends up displaying A's image while B is the selected file. The `URL.createObjectURL(blobA)` is also never revoked (cleanup already ran while `current` was null), leaking a blob each time.
- **Root cause**: The async resolution writes state and creates the object URL without any per-effect cancellation token, and cleanup can't revoke a URL that didn't exist yet at cleanup time.
- **Impact**: Preview pane shows the wrong file's contents on rapid selection changes (a wrong-file *display*, not a destructive action), plus a steady blob-URL/memory leak while browsing image-heavy folders. Note `FilePreview` (text) in the same file does this correctly — this branch diverged.
- **Fix sketch**: Mirror `FilePreview`: add `let cancelled = false;` guard every `setUrl`, store the created URL in a ref, and revoke it in cleanup (`if (current) URL.revokeObjectURL(current)` plus revoke-on-supersede).
- **Value**: impact=6 effort=3

## 5. `drive_search` silently truncates at `max_results` in nondeterministic order → user concludes a file is absent
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: silent truncation / undocumented result cap
- **File**: src-tauri/src/commands/drive.rs:804-863 (cap at 816, 830, 838)
- **Scenario**: Recursive "search all Drive" walks the tree and stops once `hits.len() >= limit` (default 200, max 1000), in `read_dir` filesystem-iteration order — i.e. arbitrary, depth-first per directory. A user with 250 files matching "report" gets some 200 of them with no indication results were capped; the `RecursiveResultsView` header just shows "200 hits". The specific file they want may be among the dropped 50, and which 50 are dropped is nondeterministic.
- **Root cause**: The hit cap is a hard limit with no "truncated" signal to the UI and no ordering guarantee (no rank by relevance/mtime/path), so dropped matches are invisible and effectively random.
- **Impact**: User searches, doesn't find an existing file in the capped/arbitrarily-ordered list, and concludes it doesn't exist (or re-creates it). Silent data-omission in the one surface meant to find files across the whole drive.
- **Fix sketch**: Return a `truncated: bool` (hits collected == limit while more remain) and surface a "showing first N — refine your search" banner; sort hits deterministically (e.g. by path or mtime) before truncating so results are stable and the most-relevant survive the cap.
- **Value**: impact=5 effort=3
