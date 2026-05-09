# Drive

Drive is a managed local filesystem for files produced by users, personas, OCR, signing, and exports. It is intentionally not a general file browser: every path is relative to a sandboxed root controlled by the backend.

## User surface

The plugin lives under `Plugins -> Drive` and is implemented by `src/features/plugins/drive/DrivePage.tsx`.

| Surface | Behavior | Main files |
| --- | --- | --- |
| Finder shell | Sidebar tree, toolbar, list/icons/columns views, details pane, context menu | `DrivePage.tsx`, `DriveSidebar.tsx`, `DriveToolbar.tsx`, `DriveFileList.tsx`, `DriveDetailsPane.tsx` |
| Navigation | Back/forward/up history over relative paths | `hooks/useDrive.ts` |
| Selection | Single, additive, range, select-all | `hooks/useDrive.ts` |
| Clipboard | Copy/cut selected paths, paste into current folder | `hooks/useDrive.ts` |
| Mutations | Create folder/file, rename, delete, move, copy | `hooks/useDrive.ts`, `src/api/drive.ts` |
| OS file ingest | OS-native drag-drop into the current folder; cap 50 MB per file | `DrivePage.tsx` |
| OCR drawer | Gemini OCR through Vault credentials or Claude CLI OCR through local CLI | `ocr/DriveOcrDrawer.tsx`, `ocr/useOcr.ts`, `src/api/drive.ts` |
| Signing | Generate/attach/verify document signatures and sidecars | `signing/*`, `src/api/signing` |

## Sandbox and validation

There are two validation layers:

- Frontend `src/api/drive.ts` rejects absolute paths, Windows drive letters, NUL bytes, overlong relative paths, and `..` segments before IPC.
- Backend `src-tauri/src/commands/drive.rs` resolves every relative path against the managed root, canonicalizes it, and rejects symlink/path traversal escapes.

The backend root is `app_data_dir/drive` in release and `./.dev-drive` in debug. `drive_get_root` exposes it for diagnostics; normal UI calls pass only relative paths.

`drive_read` and `drive_write` are capped at 50 MB to protect the webview and IPC boundary. Large copy/move operations stay backend-side.

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
| Listing/stat | `drive_list`, `drive_list_tree`, `drive_stat` |
| Read/write | `drive_read`, `drive_read_text`, `drive_write`, `drive_write_text` |
| Mutations | `drive_mkdir`, `drive_delete`, `drive_rename`, `drive_move`, `drive_copy` |
| OS handoff | `drive_open_in_os`, `drive_reveal_in_os` |
| OCR | `ocr_drive_file_gemini`, `ocr_drive_file_claude`, `cancel_ocr_operation` |
| Signing | `sign_document`, `verify_document`, `list_document_signatures`, sidecar helpers |

## State model

`useDrive()` is the Finder's source of truth. It owns navigation history, entry cache, visible entries, selection, sort/search, view mode, clipboard, storage meter, and recent-write highlighting. The columns view uses `cachedEntriesFor()` to avoid repeated IPC calls for already visited parent paths.
