# Drive

Drive is a managed local filesystem for files produced by users, personas, OCR, signing, and exports. It is intentionally not a general file browser: every path is relative to a sandboxed root controlled by the backend.

## Two renderers: Classic and Finder

The plugin lives under `Plugins -> Drive`. `src/features/plugins/drive/DrivePage.tsx` is a variant dispatcher, not a page: it reads `drive-variant` from safeLocalStorage (`"classic"` | `"finder"`, default **finder**, any other value falls back to the default) and lazy-loads one of two renderers:

| Variant | Entry | What it is |
| --- | --- | --- |
| Classic | `classic/DriveClassicPage.tsx` | The original UI, kept byte-for-byte (its components stay under `components/`, `hooks/`, `ocr/`, `signing/`, `knowledge/`) |
| Finder | `finder/FinderPage.tsx` | The from-scratch three-pane shell (drive-finder spark, 2026-09-17) |

Both page headers render `DriveVariantSwitcher` (a Classic | Finder segmented pill), so the comparison is one click away from either side and the choice persists.

What is shared is everything below the renderer: **one engine** — `useDrive()` (navigation, entries, selection, clipboard, sort/search, storage meter), `useSigning`, `useOcr`, `useDriveKnowledge` — and the **same dialogs** (sign, verify, OCR drawer, knowledge picker/drawer, move-to, delete confirm) driven through `finder/FinderDialogs.tsx`. The Finder owns no data of its own; it composes panes and routes actions.

The two exist for a comparison round. The operator picks a winner live; the loser is deleted in a later consolidation round. Nothing new should be added to the classic renderer meanwhile.

## Classic user surface

| Surface | Behavior | Main files |
| --- | --- | --- |
| Finder shell | Sidebar tree, toolbar, list/icons/columns views, details pane, context menu | `classic/DriveClassicPage.tsx`, `components/DriveSidebar.tsx`, `DriveToolbar.tsx`, `DriveFileList.tsx`, `DriveDetailsPane.tsx` |
| Details quick actions | With a single entry selected, the details-pane hero shows an icon-button row — Open, Reveal, and (for files) Sign, Verify, Extract-text — mirroring the right-click menu so per-file actions don't require a context menu | `DriveDetailsPane.tsx` |
| Preview lightbox | Full-screen viewer for images / video / PDF — zoom·pan·rotate with keyboard (←→ / +−0 / R / Esc) and per-image transform memory, plus a thumbnail filmstrip that lazy-loads image tiles and jumps to any previewable file in the folder. The chrome shows the file's size · pixel dimensions (images) · modified time | `components/DriveImageLightbox.tsx` |
| Navigation | Back/forward/up history over relative paths; each folder's scroll position is remembered for the session, so Back/Up restores where you were (list + icons views) | `hooks/useDrive.ts` |
| Selection | Single, additive, range, select-all | `hooks/useDrive.ts` |
| Clipboard | Copy/cut selected paths, paste into current folder | `hooks/useDrive.ts` |
| Mutations | Create folder/file, rename, delete, move, copy | `hooks/useDrive.ts`, `src/api/drive/fs.ts` |
| OS file ingest | OS-native drag-drop; cap 50 MB per file. Dropping on a folder row (list) or sidebar tree node writes into that folder; anywhere else targets the open folder — the drag banner names the live destination | `classic/DriveClassicPage.tsx`, `DriveFileList.tsx`, `DriveSidebar.tsx` |
| Recursive search | Local folder filter escalates to a backend `drive_search` walk via a "Search all of Drive" CTA when there are no in-folder hits | `hooks/useDrive.ts`, `components/DriveFileList.tsx`, `commands/drive/mod.rs::drive_search` |
| Kind filter | Chips above the list (list/icons views) narrow the current folder to one resolved kind — Images / Docs / Code / … — alongside the name search; resets on navigation | `components/DriveKindFilterBar.tsx`, `hooks/useDrive.ts` |
| Icons-view thumbnails | Image tiles render real thumbnails, lazy-loaded and freed as they scroll in/out of view (`useLazyImageThumb`, shared with the lightbox filmstrip). **Classic only:** this path `drive_read`s the full file and decodes it in the webview; the Finder uses `drive_thumbnail` instead (see Thumbnails) | `components/DriveFileList.tsx`, `hooks/useLazyImageThumb.ts` |
| OCR drawer | Gemini OCR through Vault credentials or Claude CLI OCR through local CLI | `ocr/DriveOcrDrawer.tsx`, `ocr/useOcr.ts` |
| Knowledge base | Send a file, a selection, or a whole folder into a vector knowledge base, then **Ask** across it (semantic search) or **Extract** typed rows from it (infer a schema → review it → run extraction). The picker offers the existing knowledge bases and can create one inline | `knowledge/*`, `src/api/vault/database/vectorKb.ts` |
| Signing | Generate/attach/verify document signatures and sidecars. The signatures-history panel can re-verify any record in place — "Verify now" re-hashes the live file against the record's exported sidecar and shows valid / modified / invalid inline. Signed files carry a badge in the details pane + a marker on list rows (signature records loaded eagerly on Drive open; their stored absolute paths are mapped back to drive-relative for matching) | `signing/*`, `src/api/signing` |

The Finder reaches every row above through the same engine (recursive search, kind filter, OCR, knowledge, signing, clipboard, OS drop) — the sections below describe only what it adds or does differently.

## Finder layout

`finder/shell/SplitPane.tsx` lays out **sidebar · main · inspector**. Widths and open state are `FinderPrefs` (`finder/types.ts`), persisted under `drive.finder.prefs` in safeLocalStorage by `useFinderPrefs.ts`:

| Field | Default | Limits |
| --- | --- | --- |
| `sidebarW` | 232 | 160–480 |
| `inspectorW` | 300 | 240–560 |
| `sidebarOpen` | true | |
| `inspectorOpen` | false | |
| `viewMode` | `"list"` | `list` / `icons` / `columns` / `gallery` |

Hydration is field-by-field coerced (`coerceFinderPrefs`) so a stale or hand-edited store never yields a NaN width. A closed pane collapses to 0 with a width transition. Dividers (`SplitDivider.tsx`) drag with a local preview width and commit once on release — one write per gesture, not per pixel — and take ArrowLeft/ArrowRight in 16 px steps when focused (`splitPaneMath.ts`, unit-tested).

- **Sidebar** (`sidebar/`): Locations (Drive root · Recent — five files inline, `Mod+1..5` · Trash with a badge count), the folder tree (`TreeSection` / `TreeNode`, a drop target for internal moves and OS files), and Tags (one row per vocab tag; click opens the tagged view, dropping an internal drag onto a row applies the tag). Storage meter pinned below.
- **Main** (`FinderMain.tsx`): toolbar (`toolbar/` — breadcrumb with an editable path input, search, kind filter, Move-to, view switch, Import, Export, sidebar/inspector toggles) above the active view. Sidebar tag click → `useTaggedView` fetches `drive_tagged` and shows a Drive-wide list, dismissed by any navigation, exactly like the recursive-search results.
- **Views** (`views/`): `ListView` is always virtualized (`@tanstack/react-virtual`, 36 px rows under a sticky column header; sorting by kind adds sticky group headers via a range-extractor trick). `IconsView` is a CSS auto-fill grid with 96 px thumbnails that switches to a row-virtualized grid above 400 entries (`VIRTUALIZE_ABOVE`). `ColumnsView` renders one pane per ancestor plus a 256 px preview column for the selected file; ↑/↓ step, → enters a folder, ← steps up. `GalleryView` shows a 1024 px hero for the selected image (kind icon plus a Quick Look button otherwise) over a filmstrip. All views render `drive.visibleEntries`, keep per-folder scroll memory, support inline rename / inline create (`InlineNameInput`), internal drag-move and OS drop.
- **Inspector** (`inspector/`), toggled with `Mod+I` or the toolbar button: for one entry — hero, General, Preview (inline image or the first 4000 chars of a `text/*` / JSON file; video / pdf / audio only offer a Quick Look door), Tags, Signature, Actions (Open, Reveal, Sign, Verify, Extract text, Add to knowledge); for a multi-selection — a summary plus the tags common to every selected entry. The tag manager (create / recolour / rename / delete user tags) lives here (`TagManagerPopover`).
- **Quick Look** (`quicklook/`), toggled with `Space`: a `BaseModal` overlay over the previewable entries of the open folder in visual order (`useQuickLook`). Arrows step and keep the list selection in step; `+ − 0 R` fire only on images; wheel zoom anchors at the pointer; per-entry transform memory (`useQuickLookTransform`). Text previews stop at 256 KB (`useEntryMedia.TEXT_MAX_BYTES`), shared with the inspector preview.

`previewKind()` in `finder/types.ts` decides what Quick Look and the Gallery can render: `image/*`, `video/*`, `audio/*`, `application/pdf`, and text as `text/*` or `application/json` only.

## Keyboard

One document-level `keydown` listener (`finder/FinderKeymap.ts`, attached once; handlers routed through a ref). Events whose target is an input, textarea or contenteditable are left alone; a handler returning `false` means "nothing to act on" and leaves the event unprevented. `Mod` is ⌘ on Mac and Ctrl elsewhere — the resolver accepts both. Any Alt-modified key is ignored (Alt is reserved for the drag-out gesture). Bindings (`useFinderKeyBindings.ts`):

| Keys | Action |
| --- | --- |
| `Mod+A` | Select all |
| `Mod+F` | Focus + select the search field |
| `Mod+L` | Edit the path (breadcrumb becomes an input) |
| `Mod+1` … `Mod+5` | Jump to the n-th Recent file (navigate to its folder, select it) |
| `Mod+C` / `Mod+X` / `Mod+V` | Copy / cut selection, paste here |
| `Mod+I` | Toggle the inspector |
| `Mod+D` | Duplicate selection |
| `Mod+Shift+N` | New folder (inline) |
| `Mod+Shift+E` | Export… |
| `Mod+Shift+I` | Import… |
| `Delete` / `Backspace` | Delete selection (confirm dialog) |
| `F2` | Rename (inline) |
| `Enter` | Open first selected (folder → navigate, file → OS) |
| `↑` / `↓` | Move selection |
| `←` | Go up |
| `Space` | Toggle Quick Look |
| `Esc` | Close Quick Look, else clear selection (never prevented) |

Quick Look adds its own `← → + − 0 R` while open; the split dividers take `← →` when focused. Shift with any bare key other than Enter resolves to nothing.

## Tags

Finder-style colour labels plus named tags. Seven builtin labels — red, orange, yellow, green, blue, purple, gray — with ids `label:<color>`; user tags are `tag:<uuid>` (`newTagId()` in `useDriveMeta.ts`) and carry a name and one of the seven colours. Builtins cannot be renamed or deleted.

Contract (`src-tauri/src/commands/drive/meta.rs`, mirrored by `src/api/drive/meta.ts`):

- The index is one file **inside** the sandbox, `<root>/.drive-meta.json`, owned by Rust. It is a declared bookkeeping exclusion: `is_bookkeeping()` in `mod.rs` hides it (and its `.corrupt-<ts>` backups) from list, tree, search, recent, snapshot and the storage walk, so it can never appear as an entry.
- `DriveMeta { version, vocab: DriveTag[], labels: { <rel_path>: tagId[] }, warning }`. `labels` keys are forward-slash relative paths and are rekeyed when an entry is renamed or moved; an unreadable index is moved aside and reported once through `warning` (the UI toasts it once per distinct message).
- Commands: `drive_meta_get`, `drive_tags_set(rel_path, tag_ids)`, `drive_tag_upsert(tag)`, `drive_tag_delete(tag_id)` — each returns the whole index — and `drive_tagged(tag_id) -> DriveEntry[]` for the Drive-wide tagged view.

Client side, `useDriveMeta` writes optimistically and rolls back to a snapshot on rejection. While the backend rejects every call (the command family was built in parallel; it may still be a stub) the hook falls back to a local index holding only the seven builtins, so the swatch row is never empty and writes become no-ops instead of a toast storm. Tags are applied from the context menu (a toggle row per vocab tag, checked when every target carries it), the inspector Tags section, or by dropping a drag onto a sidebar tag row; `TagDots` shows them on list rows and tiles. Duplicating an entry copies its tags to the new key.

## Thumbnails

The Finder never decodes images in the webview. `drive_thumbnail(rel_path, edge)` (`thumbs.rs`, implemented) returns JPEG bytes (quality 82, raw-byte IPC → `ArrayBuffer`) downsized so the long side is at most `edge`, clamped to one of **96 / 256 / 1024** (icons tile / column preview / gallery hero). A small source is re-encoded, never upscaled. Only png / jpg / jpeg / webp / gif are thumbable; anything else is a `Validation` error.

- Cache lives **outside** the sandbox at `app_cache_dir()/drive-thumbs/`, keyed `<sha256(rel_path)[:16] hex>-<mtime_secs>-<size>-<edge>.jpg` (rel_path normalised to forward slashes first), so a rename or edit is a new key and stale entries simply age out. Writes are temp-file + rename; a hit gets its mtime touched.
- A decode failure writes a `<key>.fail` marker holding the reason; the marker answers for **24 h** before the decode is retried.
- Budget **256 MB**; exceeding it after a write evicts oldest-mtime files down to **224 MB** (hysteresis so one write past the line does not evict on every call).
- Decode guardrails: 16 384 px per axis, 256 MB allocation cap; the decode runs on a blocking thread.

`views/thumbCache.ts` is the client LRU of object URLs (300 entries, revoked past that): one request per key per session, failures memoised, concurrent callers share one in-flight promise. `useThumbnail` asks only once the tile is within 300 px of the viewport.

## Import, Export, Duplicate and drag-out

`finder/useFinderTransfers.ts` over `src/api/drive/transfer.ts`, backed by `transfer.rs`. Bytes never cross IPC — every copy happens on the Rust side from or to absolute OS paths the dialog plugin returned. None of these commands destroys data, so **none is privileged**; `drive_delete` stays the only privileged drive command.

| Action | Entry points | Behaviour |
| --- | --- | --- |
| Import… | Toolbar, `Mod+Shift+I` | OS multi-file picker → `drive_import_paths(paths, dest_rel)` copies files or folders into the open folder; per-file 50 MB cap (`too_large`) |
| Export to… | Toolbar (with a selection), context menu, `Mod+Shift+E` | OS directory picker → `drive_export_to(rel_paths, dest_dir)`; collisions get the `name copy` suffix, never overwrite |
| Duplicate | Context menu, `Mod+D` | `drive_duplicate(rel_path)` per selected entry → `name copy.ext`, then `name copy 2.ext`, …; folders duplicate recursively; tags copy to the new key |
| Drag-out | Alt-drag a selection out of any view | `drive_abs_paths(rel_paths)` → `startNativeDrag()` via `@crabnebula/tauri-plugin-drag` (copy mode, invisible drag image — the OS draws the icons). The plugin import is dynamic; when it is absent the toast `drag_out_unavailable` points at Export as the fallback |

Import and export return `DriveTransferReport { added, tooLarge[], failed[{name, reason}] }`; the UI toasts the three counts, then refreshes the listing, storage meter and Recent.

## Sandbox and validation

There are two validation layers:

- Frontend `src/api/drive/fs.ts` rejects absolute paths, Windows drive letters, NUL bytes, overlong relative paths, and `..` segments before IPC.
- Backend `src-tauri/src/commands/drive/mod.rs` resolves every relative path against the managed root, canonicalizes it, and rejects symlink/path traversal escapes.

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

Thumbnails and the tag index are derived data: `drive_thumbnail` and the `drive_meta_*` / `drive_tag*` commands emit no drive event.

## Backend commands

`src-tauri/src/commands/drive/` is a module: `mod.rs` (the original sandbox commands) plus `thumbs.rs`, `meta.rs`, `transfer.rs`, all registered in `lib.rs`. Frontend bindings are split the same way under `src/api/drive/` (`fs.ts`, `meta.ts`, `transfer.ts`, re-exported from `index.ts`).

| Family | Commands |
| --- | --- |
| Root/storage | `drive_get_root`, `drive_storage_info` |
| Listing/stat | `drive_list`, `drive_list_tree`, `drive_stat`, `drive_search`, `drive_recent` |
| Read/write | `drive_read`, `drive_read_text`, `drive_write`, `drive_write_text` |
| Mutations | `drive_mkdir`, `drive_delete` (privileged), `drive_rename`, `drive_move`, `drive_copy` |
| OS handoff | `drive_open_in_os`, `drive_reveal_in_os` |
| Thumbnails | `drive_thumbnail(rel_path, edge: u32) -> bytes` |
| Tags | `drive_meta_get() -> DriveMeta`, `drive_tags_set(rel_path, tag_ids: String[]) -> DriveMeta`, `drive_tag_upsert(tag: DriveTag) -> DriveMeta`, `drive_tag_delete(tag_id) -> DriveMeta`, `drive_tagged(tag_id) -> DriveEntry[]` |
| Transfers | `drive_duplicate(rel_path) -> DriveEntry`, `drive_import_paths(paths: String[], dest_rel) -> DriveTransferReport`, `drive_export_to(rel_paths: String[], dest_dir) -> DriveTransferReport`, `drive_abs_paths(rel_paths: String[]) -> String[]` |
| OCR | `ocr_drive_file_gemini`, `ocr_drive_file_claude`, `cancel_ocr_operation` |
| Signing | `sign_document`, `verify_document`, `list_document_signatures`, sidecar helpers |

The ten Finder commands (Thumbnails, Tags, Transfers) take relative paths that go through the same `resolve_safe` as the rest. `thumbs.rs` is implemented and unit-tested; `meta.rs` and `transfer.rs` state their wire contract in the module doc comment and may still be stubs returning `Execution("not implemented")` — the frontend is written against the contract and degrades (fallback tag index, toasted transfer errors) until they land.

## Knowledge base bridge

Drive owns no retrieval machinery of its own — the Ask and Extract surfaces are
the **same components** the Vault KB modal renders (`SearchTab` / `ExtractTab`
from `src/features/vault/shared/vector/tabs/`), so the two entry points cannot
drift. Drive contributes only the bridge:

- **Path translation.** Drive is sandbox-relative end to end; `kb_ingest_files`
  and `kb_ingest_directory` want absolute paths. `useDriveKnowledge` resolves
  the managed root once via `drive_get_root` and joins it with the relative
  path.
- **Feature detection.** The entire `vector_kb` command module is
  `#[cfg(feature = "ml")]`, so the default `desktop` build has no KB commands
  registered at all. The hook probes `list_knowledge_bases` on mount and treats
  a rejection as "no KB lane in this build" — every Drive entry point then stays
  hidden rather than failing on click.
- **No new persistence.** Nothing binds a folder to a knowledge base; the picker
  asks each time. Auto-ingest on `drive.document.added` and per-folder
  extraction agents are deliberately out of scope — see
  `src/features/plugins/drive/knowledge/DESIGN.md`.

Ingestion is a backgrounded Rust job, so the confirmation toast says *queued*,
not *added*; progress arrives on the shared `kb:ingest_progress` /
`kb:ingest_complete` events, and the drawer re-reads the document count when a
job completes.

## State model

`useDrive()` is the source of truth for both renderers. It owns navigation history, entry cache, visible entries, selection, sort/search, view mode (classic), clipboard, storage meter, recent list, and recent-write highlighting. The columns view uses `cachedEntriesFor()` to avoid repeated IPC calls for already visited parent paths.

Finder-only state sits beside it, all in hooks under `finder/`: `useDriveMeta` (tag index, optimistic), `useFinderPrefs` (layout), `useTaggedView`, `useQuickLook`, `useFinderEditing` (inline rename / create, drag count), `useExternalDrop`, `useFinderDialogs`, `useFinderTransfers`. Refresh is caller-driven: mutations call `drive.refresh()` (plus `refreshStorage` / `refreshRecent` after transfers).

Persisted keys (safeLocalStorage):

| Key | Owner | Value |
| --- | --- | --- |
| `drive-variant` | `DrivePage.tsx` | `"classic"` \| `"finder"` |
| `drive.finder.prefs` | `useFinderPrefs.ts` | `FinderPrefs` JSON (pane widths, open state, view mode) |

Session-only: per-folder scroll positions (engine), the thumbnail object-URL LRU (`thumbCache.ts`), Quick Look per-entry transforms. On disk, Rust-owned: `<root>/.drive-meta.json` (tags) and `app_cache_dir()/drive-thumbs/` (thumbnails).

## Known gaps

- No live file watcher. A change made outside the app (or by a persona run) shows up on the next caller-driven `refresh()`, not by itself.
- No favorites / pinned locations in the sidebar; Locations is root, Recent and Trash only.
- No undo. Delete is recoverable through the trash; rename, move, tag changes and transfers are not.
- Import / export report per-item failures only as counts in toasts; the `failed[{name, reason}]` list the command returns is not surfaced item by item.
- Selection resets on refresh.
- The Finder's `previewKind` text set is narrower than the classic details pane: `text/*` and `application/json` only, where classic also previews yaml / toml / javascript / typescript / csv MIME types.
- Native drag-out depends on `@crabnebula/tauri-plugin-drag`; without it the gesture only toasts and points at Export.
