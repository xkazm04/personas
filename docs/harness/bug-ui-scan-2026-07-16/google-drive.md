# Google Drive — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 4, Low: 0)

Note for triage: despite the context name, this plugin is a managed **local** filesystem sandbox — no Google Drive API, no OAuth. `src-tauri/src/engine/google_oauth.rs` contains zero drive references and is never invoked by any `drive_*` command (confirmed by grep); the context-map grouping is misleading. The oauth refresh-rotation issue was left to the parallel OAuth audit as instructed.

## 1. Engine drive-sync diff includes `.trash/` — soft-deletes during a persona run fire spurious `drive.document.added` events
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/drive.rs:152 (`snapshot_drive` / `walk_snapshot`, lines 158–204; consumed by `diff_and_emit_drive_events` at line 210, called from src-tauri/src/engine/runner/mod.rs:2590)
- **Scenario**: A persona execution (or the user, mid-run) deletes `inbox/report.pdf`. `drive_delete` soft-deletes by renaming it to `.trash/20260716T120000-report.pdf`. The runner's after-snapshot diff now sees the original path gone AND a brand-new file under `.trash/`, so it emits `drive.document.deleted` for `inbox/report.pdf` **and `drive.document.added` for `.trash/20260716T120000-report.pdf`**. Similarly, if the 7-day trash purge runs between the before/after snapshots (it piggybacks on any `drive_storage_info` cache miss), the diff emits phantom `deleted` events for trash entries no one touched.
- **Root cause**: `walk_snapshot` skips OS clutter (`.DS_Store` etc.) but not `TRASH_DIRNAME`, unlike `walk_recent` (drive.rs:905) which explicitly excludes `.trash`. The diff assumes every path in the snapshot is user-meaningful content.
- **Impact**: Personas subscribed to `drive.document.added` (e.g. `source_filter: "*"` watchers) trigger on *deletions* — the exact inverse of intent — and can start a run against a graveyard file whose next `drive_delete` is a permanent hard-delete. Event log fills with `.trash/` noise; a delete→trigger→process→delete loop is possible for aggressive watchers.
- **Fix sketch**: In `walk_snapshot`, skip the entry when `dir == root && name == TRASH_DIRNAME` (same guard as `walk_recent`); optionally also filter `path.starts_with(".trash/")` in `diff_and_emit_drive_events` as belt-and-braces.

## 2. Case-only rename is impossible on Windows/macOS — "already exists" error for the file itself
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/drive.rs:1174 (`drive_rename`; same pattern in `drive_move` at line 1206 and `drive_copy` at line 1250)
- **Scenario**: On Windows (the primary desktop target) the user presses F2 on `readme.md` and types `README.md`. `dst_resolved.exists()` is evaluated on a case-insensitive filesystem, so the *source file itself* satisfies the existence check and the rename is rejected with "A file or folder named 'README.md' already exists".
- **Root cause**: The overwrite guard assumes `dst.exists()` implies a *different* file occupies the destination; on case-insensitive filesystems the source and destination can be the same directory entry.
- **Impact**: Users can never fix filename casing from inside the app — the inline rename commits, errors via toast, and the old name snaps back. Confusing error text ("already exists" naming the file they're renaming).
- **Fix sketch**: Before rejecting, canonicalize both paths and allow the rename when `std::fs::canonicalize(&dst)` resolves to the same file as `abs` (compare canonical paths, or `same-file` crate identity); `std::fs::rename` handles case-only renames natively on NTFS/APFS.

## 3. "Search all of Drive" surfaces soft-deleted `.trash` contents with mangled names
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/drive.rs:830 (`walk_search`; recursion at line 866 never excludes `TRASH_DIRNAME`)
- **Scenario**: User deletes `contract.pdf` (soft-delete to `.trash/20260710T093000-contract.pdf`), later runs the recursive search escalation for "contract". The trashed copy comes back as a hit named `20260710T093000-contract.pdf` — the timestamp prefix is NOT stripped here (only the `.trash` folder listing applies `trashEntryInfo`). Double-clicking opens a file the user believes deleted; the "reveal" arrow navigates into `.trash`, where a delete is a permanent hard-delete (drive.rs:1052–1058).
- **Root cause**: `walk_search` reuses the raw tree walk without the `.trash` exclusion that `walk_recent` (line 905) applies; the RecursiveResultsView renders `entry.name` verbatim with no trash awareness.
- **Impact**: Deleted files "resurrect" in search with cryptic names, inflate the hit count (limit slots consumed by graveyard entries), and one careless action from a search result permanently destroys a file the trash was supposed to protect for 7 days.
- **Fix sketch**: Skip `dir == root && name == TRASH_DIRNAME` in `walk_search` (mirroring `walk_recent`). If trash should stay searchable, badge hits under `.trash/` and strip the stamp via `trashEntryInfo` instead.

## 4. Details-pane image preview: unguarded async race shows the wrong file's image and leaks blob URLs; failures render nothing
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/drive/components/DriveDetailsPane.tsx:613–630 (`ImagePreviewBlob`)
- **Scenario**: User arrow-keys quickly from photo A (large, slow `drive_read` — a 30 MB image crosses IPC as a JSON number array) to photo B (small, fast). Effect A's cleanup runs while its read is still in flight (`current` is still null, so nothing is revoked); read B resolves and shows B; then read A resolves, `setUrl(aUrl)` wins — the pane now shows **A's pixels under B's name/size metadata**, and B's object URL is orphaned (its closure's `current` was replaced, cleanup already consumed). Repeated browsing accumulates unrevoked `blob:` URLs. Separately, if `driveRead` fails (file deleted under us), the error goes to `silentCatch` and the component returns `null` forever — no preview, no error, no loading state (the outer `FilePreview` already reported "ready" for images at line 438).
- **Root cause**: The effect has no `cancelled` flag (unlike `FilePreview`'s text branch, which has one), so stale resolutions commit state; the error path was never given a UI state because images short-circuit `FilePreview` to "ready" before any bytes load.
- **Impact**: Wrong-image/metadata mismatch on fast navigation (worst case: user acts — sign/delete — on what they *see*, which is a different file), plus a slow memory leak of blob URLs and a blank preview slot on read failure.
- **Fix sketch**: Add a `cancelled` flag checked before `setUrl`, revoke the created URL immediately when cancelled, and add `error`/`loading` states mirroring `FilePreview`'s text branch.

## 5. Context menu clamps to a hardcoded 380px height — Delete lands off-screen on short windows, short menus jump away from the cursor
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/drive/components/DriveContextMenu.tsx:91–96
- **Scenario**: (a) On a 768px-tall laptop window, right-click a signed OCR-eligible file in the lower half: the full entry menu is ~12 items + 3 dividers (~470px), but `maxY = innerHeight - 380` under-reserves, so the menu overflows the viewport bottom — the last item, **Delete**, is unreachable (fixed positioning, no internal scroll). (b) Right-click empty background near the bottom edge: that menu is only 3 items (~130px) yet is still shoved 380px up, appearing ~250px above the pointer, breaking the "menu opens at cursor" expectation.
- **Root cause**: The clamp assumes one fixed menu height, but the menu has three very different variants (background ≈3 items, folder ≈8, file ≈9–12 depending on OCR eligibility) and never measures itself.
- **Impact**: The single destructive action can be invisible/unclickable at common window sizes (users fall back to the Del key if they know it), and background menus feel detached/glitchy near screen edges. Also no `role="menu"`/`role="menuitem"` semantics or focus trap — arrow-key navigation announced by the `kbd` hints doesn't exist for screen-reader users.
- **Fix sketch**: Measure the rendered menu (`ref.current.getBoundingClientRect()` in a layout effect) and flip/clamp using the real height, or use fixed positioning with `max-height: calc(100vh - y)` + `overflow-y: auto`. Add menu roles and roving focus while touching it.
