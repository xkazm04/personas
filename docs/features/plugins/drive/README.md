# Drive

Drive is a managed local filesystem for files produced by users, personas, OCR, signing, and exports. It is intentionally not a general file browser: every path is relative to a sandboxed root controlled by the backend.

## User surface

The plugin lives under `Plugins -> Drive` and is implemented by `src/features/plugins/drive/DrivePage.tsx`.

| Surface | Behavior | Main files |
| --- | --- | --- |
| Finder shell | Sidebar tree, toolbar, list/icons/columns views, details pane, context menu | `DrivePage.tsx`, `DriveSidebar.tsx`, `DriveToolbar.tsx`, `DriveFileList.tsx`, `DriveDetailsPane.tsx` |
| Details quick actions | With a single entry selected, the details-pane hero shows an icon-button row — Open, Reveal, and (for files) Sign, Verify, Extract-text — mirroring the right-click menu so per-file actions don't require a context menu | `DriveDetailsPane.tsx` |
| Preview lightbox | Full-screen viewer for images / video / PDF — zoom·pan·rotate with keyboard (←→ / +−0 / R / Esc) and per-image transform memory, plus a thumbnail filmstrip that lazy-loads image tiles and jumps to any previewable file in the folder. The chrome shows the file's size · pixel dimensions (images) · modified time | `components/DriveImageLightbox.tsx` |
| Navigation | Back/forward/up history over relative paths; each folder's scroll position is remembered for the session, so Back/Up restores where you were (list + icons views) | `hooks/useDrive.ts` |
| Selection | Single, additive, range, select-all | `hooks/useDrive.ts` |
| Clipboard | Copy/cut selected paths, paste into current folder | `hooks/useDrive.ts` |
| Mutations | Create folder/file, rename, delete, move, copy | `hooks/useDrive.ts`, `src/api/drive.ts` |
| OS file ingest | OS-native drag-drop; cap 50 MB per file. Dropping on a folder row (list) or sidebar tree node writes into that folder; anywhere else targets the open folder — the drag banner names the live destination | `DrivePage.tsx`, `DriveFileList.tsx`, `DriveSidebar.tsx` |
| Recursive search | Local folder filter escalates to a backend `drive_search` walk via a "Search all of Drive" CTA when there are no in-folder hits | `hooks/useDrive.ts`, `components/DriveFileList.tsx`, `commands/drive.rs::drive_search` |
| Kind filter | Chips above the list (list/icons views) narrow the current folder to one resolved kind — Images / Docs / Code / … — alongside the name search; resets on navigation | `components/DriveKindFilterBar.tsx`, `hooks/useDrive.ts` |
| Icons-view thumbnails | Image tiles in the icons view render real thumbnails, lazy-loaded and freed as they scroll in/out of view (`useLazyImageThumb`, shared with the lightbox filmstrip); other kinds keep their kind icon | `components/DriveFileList.tsx`, `hooks/useLazyImageThumb.ts` |
| OCR drawer | Gemini OCR through Vault credentials or Claude CLI OCR through local CLI | `ocr/DriveOcrDrawer.tsx`, `ocr/useOcr.ts`, `src/api/drive.ts` |
| Signing | Generate/attach/verify document signatures and sidecars. The signatures-history panel can re-verify any record in place — "Verify now" re-hashes the live file against the record's exported sidecar and shows valid / modified / invalid inline. Signed files carry a badge in the details pane + a marker on list rows (signature records loaded eagerly on Drive open; their stored absolute paths are mapped back to drive-relative for matching) | `signing/*`, `src/api/signing` |

## Sandbox and validation

There are two validation layers:

- Frontend `src/api/drive.ts` rejects absolute paths, Windows drive letters, NUL bytes, overlong relative paths, and `..` segments before IPC.
- Backend `src-tauri/src/commands/drive.rs` resolves every relative path against the managed root, canonicalizes it, and rejects symlink/path traversal escapes.

The backend root is `app_data_dir/drive` in release and `./.dev-drive` in debug. `drive_get_root` exposes it for diagnostics; normal UI calls pass only relative paths.

`drive_read` and `drive_write` are capped at 50 MB to protect the webview and IPC boundary. Large copy/move operations stay backend-side.

## Trash / soft-delete

`drive_delete` is a **soft delete**: items move into `<root>/.trash/<UTC-stamp>-<basename>/` rather than being removed. The original `drive.document.deleted` event still fires, so triggers behave the same. The sidebar has a dedicated Trash node (with item count) that opens the trash; `.trash` is hidden from the regular folder tree and from the Move-to destination picker. Items in the trash:

- Surface in `drive_list` of the `.trash/` folder, so users can browse and manually move them out (effectively restoring them). Browsing the trash root shows a banner with the retention policy plus **Restore** (moves the selection back to the drive root under its original name, timestamp prefix stripped) and **Empty trash** (confirm dialog → hard-deletes everything via the second-delete path).
- Are hard-deleted by `purge_old_trash` once their timestamp is older than 7 days. The purge piggybacks on the `drive_storage_info` cache-miss path so it has no extra IPC cost. Trash rows in the list view display the original (pre-delete) name with a "Purges in Nd" countdown chip derived from the timestamp prefix (amber inside the final day).
- Hard-delete immediately on a second `drive_delete` call when the path is already inside `.trash/` — that's the "Empty Trash" affordance without a dedicated command.

## Events

Drive publishes document events into the app event bus:

- `drive.document.added`
- `drive.document.edited`
- `drive.document.renamed`
- `drive.document.deleted`

`renamed` fires from `drive_rename` and `drive_move` and carries `from_path` in
its payload so subscribers can correlate the old and new locations. The
execution-engine snapshot path (`diff_and_emit_drive_events`) does *not*
attempt rename detection — a rename observed across a snapshot boundary
surfaces as `deleted` + `added`.

UI operations emit events through the Drive command path. The execution engine can also snapshot the managed drive before/after a persona run and emit the same event types from `publish_drive_event_from_engine`, so files produced by an execution become triggerable events.

## Backend commands

| Family | Commands |
| --- | --- |
| Root/storage | `drive_get_root`, `drive_storage_info` |
| Listing/stat | `drive_list`, `drive_list_tree`, `drive_stat`, `drive_search` |
| Read/write | `drive_read`, `drive_read_text`, `drive_write`, `drive_write_text` |
| Mutations | `drive_mkdir`, `drive_delete`, `drive_rename`, `drive_move`, `drive_copy` |
| OS handoff | `drive_open_in_os`, `drive_reveal_in_os` |
| OCR | `ocr_drive_file_gemini`, `ocr_drive_file_claude`, `cancel_ocr_operation` |
| Signing | `sign_document`, `verify_document`, `list_document_signatures`, sidecar helpers |

## State model

`useDrive()` is the Finder's source of truth. It owns navigation history, entry cache, visible entries, selection, sort/search, view mode, clipboard, storage meter, and recent-write highlighting. The columns view uses `cachedEntriesFor()` to avoid repeated IPC calls for already visited parent paths.
