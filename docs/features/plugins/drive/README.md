# Drive

Drive is a managed local filesystem for files produced by users, personas, OCR, signing, and exports. It is intentionally not a general file browser: every path is relative to a sandboxed root controlled by the backend.

## Renderer

The plugin lives under `Plugins -> Drive`. `src/features/plugins/drive/DrivePage.tsx` re-exports `finder/FinderPage.tsx` — the three-pane Finder is the only renderer. A comparison round (drive-finder spark, 2026-09-17) ran the original UI and the Finder side by side behind a switcher; the operator picked the Finder, and the Classic renderer and the switcher were deleted with that decision.

`FinderPage` owns no data of its own: it composes **one engine** — `useDrive()` (`hooks/useDrive.ts`: navigation, entries, selection, clipboard, sort/search, storage meter), `useSigning`, `useOcr`, `useDriveKnowledge` — with the Finder hooks under `finder/`, and routes actions to the dialogs in `finder/FinderDialogs.tsx`. What survives outside `finder/` is what the Finder still imports: `components/DrivePrompt.tsx` (`DriveConfirm`, the delete / empty-trash modal), `hooks/useScrollShadows.ts` (sidebar fades), `designTokens.ts` (kind visuals, bucket order, trash-name parsing), and the `signing/`, `ocr/`, `knowledge/` dialogs.

## User surface

| Surface | Behavior | Main files |
| --- | --- | --- |
| Shell | Sidebar · main · inspector split panes, toolbar, list / icons / columns / gallery views, context menu | `finder/FinderPage.tsx`, `shell/SplitPane.tsx`, `FinderMain.tsx`, `toolbar/FinderToolbar.tsx`, `views/*`, `FinderContextMenu.tsx` + `contextMenuItems.tsx` |
| Header actions | Item-count pill; with a selection, the count plus bulk Copy / Cut / Delete / Clear chips | `finder/FinderHeaderActions.tsx` |
| Navigation | Back/forward/up history over relative paths; each folder's scroll position is remembered for the session, so Back/Up restores where you were | `hooks/useDrive.ts` (`rememberScroll` / `recallScroll`), every view |
| Selection | Single, additive, range, select-all; resets on navigation | `hooks/useDrive.ts`, `views/selection.ts` |
| Clipboard | Copy/cut selected paths, paste into current folder (`Mod+C/X/V`, header chips) | `hooks/useDrive.ts` |
| Mutations | Create folder/file (inline), rename (inline, `F2`), delete (confirm modal with a kind breakdown), move (drag, Move-to popover), copy, duplicate | `useFinderEditing.ts`, `views/InlineNameInput.tsx`, `FinderDeleteBreakdown.tsx`, `toolbar/FinderMoveTo.tsx`, `src/api/drive/fs.ts` |
| OS file ingest | OS-native drag-drop into the main column; files over 50 MB are counted as too large before the read (`EXTERNAL_DROP_MAX_BYTES`, mirroring the backend's `MAX_WRITE_BYTES`). Dropping on a folder row or a sidebar tree node writes into that folder; anywhere else targets the open folder — the overlay pill names the live destination. Toasts added / too-large / failed counts, then refreshes listing, storage and Recent. The Import… button/`Mod+Shift+I` is the picker-driven alternative that copies on the Rust side (see Import, Export) | `finder/useExternalDrop.ts`, `FinderExternalDrop.tsx`, `views/useEntryDnD.ts`, `sidebar/TreeNode.tsx` |
| Recursive search | Local folder filter escalates to a backend `drive_search` walk via a "Search all of Drive" CTA (search field, and the no-hits empty state) when there are no in-folder hits; results render in place of the folder rows with a Reveal action per hit; cleared by navigation or emptying the query | `hooks/useDrive.ts`, `toolbar/FinderSearch.tsx`, `views/RecursiveResults.tsx`, `views/finderScenario.ts`, `commands/drive/mod.rs::drive_search` |
| Kind filter | Pill strip under the toolbar narrows the folder to one resolved kind — Images / Docs / Code / … — alongside the name search; hidden with < 2 kinds, in columns view, during a recursive search and in the tagged view; resets on navigation | `toolbar/FinderKindFilter.tsx`, `hooks/useDrive.ts` |
| Thumbnails | Image rows and tiles render real thumbnails from `drive_thumbnail`, requested only near the viewport and held in a client LRU; nothing is decoded in the webview (see Thumbnails) | `views/useThumbnail.ts`, `views/thumbCache.ts`, `src-tauri/src/commands/drive/thumbs.rs` |
| Previews | Inspector Preview section (inline image / text) and Quick Look (`Space`) over the folder's previewable entries (see Finder layout) | `inspector/PreviewSection.tsx`, `quicklook/*`, `useQuickLook.ts` |
| Trash | Sidebar Trash node with a badge count; trash rows show the original name with a "Purges in Nd" chip; banner with Restore + Empty trash (see Trash) | `sidebar/LocationsSection.tsx`, `views/ListRow.tsx`, `FinderTrashBanner.tsx`, `useFinderDialogs.ts` |
| Signing | Sign / Verify from the inspector Signature section and the context menu; the signatures panel (toolbar) lists history and can re-verify any record in place — "Verify now" re-hashes the live file against the record's exported sidecar and shows valid / modified / invalid inline, plus Reveal in Drive. Signed files carry a badge in the inspector and a marker on list rows and icon tiles: signature records load eagerly on Drive open and their stored absolute paths are mapped back to drive-relative for matching | `inspector/SignatureSection.tsx`, `useFinderDialogs.ts`, `signing/*`, `src/api/signing` |
| OCR | Extract text (inspector Actions, context menu) on OCR-eligible files (image / pdf); the drawer runs Gemini OCR through a Vault credential or Claude CLI OCR through the local CLI, and can write the result back into Drive. The entry points stay visible but disabled without a Gemini credential | `inspector/ActionsSection.tsx`, `ocr/DriveOcrDrawer.tsx`, `ocr/useOcr.ts` |
| Knowledge base | Add a file, a selection, or the open folder to a vector knowledge base, then **Ask** across it (semantic search) or **Extract** typed rows from it. The picker offers the existing knowledge bases and can create one inline; hidden entirely when the build has no KB lane (see Knowledge base bridge) | `finder/useFinderKnowledge.ts`, `knowledge/*`, `src/api/vault/database/vectorKb.ts` |
| Keyboard | One document-level keymap (see Keyboard) | `finder/FinderKeymap.ts`, `useFinderKeyBindings.ts` |

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
- **Main** (`FinderMain.tsx`): toolbar (`toolbar/` — breadcrumb with an editable path input, search, kind filter, Move-to, view switch, Import, Export, signatures panel, sidebar/inspector toggles) above the active view. Sidebar tag click → `useTaggedView` fetches `drive_tagged` and shows a Drive-wide list (`FinderDerivedList`, a `ListView` over the derived entries), dismissed by any navigation.
- **Views** (`views/`): `ListView` is always virtualized (`@tanstack/react-virtual`, 36 px rows under a sticky column header; sorting by kind adds sticky group headers via a range-extractor trick). `IconsView` is a CSS auto-fill grid of 96 px tile boxes that switches to a row-virtualized grid above 400 entries (`VIRTUALIZE_ABOVE`). `ColumnsView` renders one pane per ancestor plus a preview column for the selected file; ↑/↓ step, → enters a folder, ← steps up. `GalleryView` shows a 1024 px hero for the selected image (kind icon plus a Quick Look button otherwise) over a filmstrip. All views render `drive.visibleEntries`, keep per-folder scroll memory, support inline rename / inline create (`InlineNameInput`), internal drag-move and OS drop.
- **Inspector** (`inspector/`), toggled with `Mod+I` or the toolbar button: for one entry — hero, Preview (inline image or the first 4000 chars of a `text/*` / `application/json` file; video / pdf / audio only offer a Quick Look door), General, Tags, Signature, Actions (Open, Reveal, Extract text, Add to knowledge base); for a multi-selection — a summary plus the tags common to every selected entry. The tag manager (create / recolour / rename / delete user tags) lives here (`TagManagerPopover`).
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

Client side, `useDriveMeta` writes optimistically and rolls back to a snapshot on rejection. If `drive_meta_get` rejects on mount the hook falls back to a local index holding only the seven builtins (`fallbackMeta()`), so the swatch row is never empty and writes become local no-ops instead of a toast storm — a degradation path from the parallel build that is kept. Tags are applied from the context menu (a toggle row per vocab tag, checked when every target carries it), the inspector Tags section, or by dropping a drag onto a sidebar tag row; `TagDots` shows them on list rows and tiles. Duplicating an entry copies its tags to the new key.

## Thumbnails

The Finder never decodes images in the webview. `drive_thumbnail(rel_path, edge)` (`thumbs.rs`) returns JPEG bytes (quality 82, raw-byte IPC → `ArrayBuffer`) downsized so the long side is at most `edge`, clamped to one of **96 / 256 / 1024**. The views request 96 for list rows and the gallery filmstrip, 256 for icon tiles and the columns preview, 1024 for the gallery hero. A small source is re-encoded, never upscaled. Only png / jpg / jpeg / webp / gif are thumbable; anything else is a `Validation` error.

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

- Surface in `drive_list` of the `.trash/` folder, so users can browse and manually move them out (effectively restoring them). Browsing the trash root shows a banner (`FinderTrashBanner`) with the retention policy plus **Restore** (moves the selection back to the drive root under its original name, timestamp prefix stripped — one bulk `moveMany`) and **Empty trash** (confirm dialog → hard-deletes everything via the second-delete path).
- Are hard-deleted by `purge_old_trash` once their timestamp is older than 7 days. The purge piggybacks on the `drive_storage_info` cache-miss path so it has no extra IPC cost. Trash rows in the list view display the original (pre-delete) name with a "Purges in Nd" countdown chip derived from the timestamp prefix (`trashEntryInfo` in `designTokens.ts`; warning-tinted inside the final day).
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

The ten Finder commands (Thumbnails, Tags, Transfers) take relative paths that go through the same `resolve_safe` as the rest. All three modules are implemented and unit-tested (`thumbs.rs`, `meta.rs`, `transfer.rs`); each states its wire contract in the module doc comment.

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

`useDrive()` is the source of truth. It owns navigation history, entry cache, visible entries, selection, sort/search, kind filter, clipboard, storage meter, recent list, and recent-write highlighting. The columns view uses `cachedEntriesFor()` to avoid repeated IPC calls for already visited parent paths. A module-scope warm cache (entries per path, tree, storage, recent) survives the route unmount so a revisited folder paints instantly while a background refresh settles.

Finder state sits beside it, all in hooks under `finder/`: `useDriveMeta` (tag index, optimistic), `useFinderPrefs` (layout + view mode), `useTaggedView`, `useQuickLook`, `useFinderEditing` (inline rename / create, drag count, path editing), `useExternalDrop`, `useFinderDialogs`, `useFinderKnowledge`, `useFinderTransfers`. Refresh is caller-driven: mutations call `drive.refresh()` (plus `refreshStorage` / `refreshRecent` after transfers and OS drops).

Persisted keys (localStorage):

| Key | Owner | Value |
| --- | --- | --- |
| `drive.finder.prefs` | `useFinderPrefs.ts` | `FinderPrefs` JSON (pane widths, open state, view mode) |
| `drive.viewState` | `hooks/useDrive.ts` | `{ sortKey, sortDir, viewMode }` JSON; the Finder reads `sortKey` / `sortDir` from it (list-header sort) — its `viewMode` field is engine-only and the Finder's view comes from `drive.finder.prefs` |

Session-only: per-folder scroll positions (engine), the thumbnail object-URL LRU (`thumbCache.ts`), Quick Look per-entry transforms. On disk, Rust-owned: `<root>/.drive-meta.json` (tags) and `app_cache_dir()/drive-thumbs/` (thumbnails).

## Known gaps

- No live file watcher. A change made outside the app (or by a persona run) shows up on the next caller-driven `refresh()`, not by itself.
- No favorites / pinned locations in the sidebar; Locations is root, Recent and Trash only.
- No undo. Delete is recoverable through the trash; rename, move, tag changes and transfers are not.
- Import / export report per-item failures only as counts in toasts; the `failed[{name, reason}]` list the command returns is not surfaced item by item.
- Selection resets on refresh.
- Preview coverage is fixed by `previewKind`: Quick Look and the inspector preview `image/*` inline and text only as `text/*` or `application/json`; `video/*`, `audio/*` and `application/pdf` render in Quick Look only (the inspector offers a door); any other MIME — e.g. `application/javascript`, `application/x-yaml`, `application/toml`, which the kind system files under code / data — gets the kind icon and no text preview.
- Native drag-out depends on `@crabnebula/tauri-plugin-drag`; without it the gesture only toasts and points at Export.
