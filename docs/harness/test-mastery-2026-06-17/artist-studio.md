# Test Mastery — Artist Studio
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

Honest baseline: the **TypeScript side is genuinely well-tested** — `AssetCard.test.tsx`, `tagOps.test.ts`, `sessionMarkdown.test.ts`, `useGallerySelection.test.ts`, `useArtistAssets.test.ts` and `utils/format.test.ts` all assert real behavior (rename guards, select-mode click routing, tag dedup, markdown folding, optimistic-state rollback). The gaps cluster on the **Rust backend** (zero tests on the data-write repo and the two security-hardened filesystem commands) and on **untested interactive UI** (the lightbox). Findings are ranked by blast radius, not line count.

## 1. `artist_read_image_base64` security guards have no test despite an explicit hardening history
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/artist/mod.rs:337-399
- **Current test state**: none
- **Scenario**: This command is the only one in the plugin with a documented past exploit ("bug-hunt 2026-06-07 creative #5: previously read ANY path … could exfiltrate secrets (`~/.ssh/id_rsa`) … or OOM"). It now enforces four guards: (1) absolute path with no `..` components, (2) image-extension allowlist, (3) canonicalized confinement under `~/Personas` (symlink-resolving), (4) a 64 MB size cap *before* reading. None of these are tested. A refactor that reorders the `canonicalize` vs `starts_with(root)` check, drops the `ParentDir` component scan, or moves the size cap after `fs::read` would silently re-open the exact arbitrary-file-read / OOM hole — and the suite would stay green.
- **Root cause**: The whole `commands/artist/mod.rs` file has exactly one `#[cfg(test)]` module (`scan_tests`) covering classification only; the security-critical command was never added.
- **Impact**: Local-secret exfiltration to the renderer as base64 and backend OOM — a confidentiality + availability regression on a previously-fixed bug, the highest-value thing to lock down.
- **Fix sketch**: Add `#[cfg(test)] mod read_image_tests` using `tempfile::tempdir`. Because the managed root is hard-wired to `dirs::home_dir()`, assert the *path-shape* guards that don't need HOME first (they fire before canonicalize): `..` segment → `Validation`; relative path → `Validation`; `.txt`/`.env`/no-ext → `Validation` ("Unsupported image type"). Then, for the confinement + cap, refactor the body into a pure `fn validate_image_request(path, root, max_bytes) -> Result<PathBuf, AppError>` taking the root as a parameter so a test can point it at a tempdir: assert (a) a `.png` outside root → `Forbidden`, (b) a symlink inside root pointing outside → `Forbidden`, (c) a `65 MB` file → `Validation` ("too large"), (d) a valid in-root `.png` → Ok. Invariant: **no path outside the canonicalized managed root, and no oversized file, ever reaches `fs::read`.**

## 2. The artist repository (all DB writes) has zero tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/artist.rs:6-117
- **Current test state**: none
- **Scenario**: Every persistence path for the plugin lives here and is untested: `insert_asset` relies on `INSERT OR IGNORE` returning `rows == 0` to signal "duplicate file_path → return None" (the contract the API doc and `useArtistAssets` depend on); `delete_asset` issues a manual two-statement cascade (`DELETE FROM artist_tags … ; DELETE FROM artist_assets …`) and reports success via `deleted > 0`; `update_asset_tags` / `update_asset_path` write then re-`get_asset`. A regression — e.g. swapping `INSERT OR IGNORE` for plain `INSERT` (turns dedup into a hard error), forgetting the tags cascade (orphan rows), or an `update` that silently no-ops on a missing id — passes every existing test because they all mock the IPC boundary on the TS side.
- **Root cause**: The repo was added without a `#[cfg(test)] mod tests`, while sibling repos (`credentials.rs`, `memories.rs`, etc.) all have CRUD tests via `crate::db::init_test_db()`.
- **Impact**: Silent data loss (dropped tags / orphan rows), broken import-dedup surfacing as user-facing errors, and "rename updated the file but not the row" drift — none caught before ship.
- **Fix sketch**: Add `#[cfg(test)] mod tests { use crate::db::init_test_db; … }` mirroring `credentials.rs`. Cases asserting business invariants: insert→get round-trips all columns; **second insert of the same `file_path` returns `Ok(None)` and leaves the row count at 1** (dedup contract); `update_asset_tags` then `get_asset` reflects new tags; `delete_asset` returns `true`, removes the row, **and removes its `artist_tags` rows** (cascade); `delete_asset` on an unknown id returns `false`; `list_assets(Some("2d"))` filters by type and orders `created_at DESC`.

## 3. `artist_rename_asset` filesystem mutation + validation is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/artist/mod.rs:251-309
- **Current test state**: none (TS `useArtistAssets.test.ts` mocks the IPC result; the Rust logic is never exercised)
- **Scenario**: This is a destructive on-disk operation gated by hand-rolled validation: rejects empty / path-separator / NUL / `.` / `..` names, preserves the original extension only when the user didn't already supply it (case-insensitive), and **rejects a collision before calling `fs::rename`** so a sibling is never overwritten. Each branch is a real foot-gun: drop the `\\`/`\0` check → path traversal on rename; flip the extension-preservation condition → users lose the file type; remove the pre-collision `new_path.exists()` guard → a rename silently clobbers another asset. All green today.
- **Root cause**: Same as #1 — only `scan_dir_recursive` got a test module.
- **Impact**: Data loss (overwritten sibling asset), corrupted filenames, or a traversal write outside the artist folder.
- **Fix sketch**: Extract the name→`new_file_name` derivation and the validation into a pure helper `fn resolve_rename(old_path: &Path, new_basename: &str) -> Result<PathBuf, AppError>` (no DB/FS), then unit-test: empty/whitespace → `Validation`; `"a/b"`, `"a\\b"`, `"a\0b"`, `"."`, `".."` → `Validation`; `"forest"` on `cat.png` → `forest.png`; `"forest.PNG"` on `cat.png` → kept as `forest.PNG` (case-insensitive ext match, no double extension). For the collision + FS path, an integration test with `tempdir`: renaming onto an existing sibling returns `Validation` ("already exists") **and the original file is still present** (no partial rename). Invariant: **a rename never overwrites an existing file and never escapes the parent directory.**

## 4. Gallery2D lightbox (id-pinning, zoom clamp, keyboard nav) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/plugins/artist/sub_gallery/Gallery2D.tsx:40-149, 170-265
- **Current test state**: none (AssetCard is well tested; its parent grid + lightbox are not)
- **Scenario**: The component carries a deliberately tricky, comment-documented invariant: the lightbox tracks the open asset **by id, not index**, "so a delete/rename/refetch that reorders `assets` keeps the viewer pinned to the asset the user opened, or closes gracefully if it's deleted." It also implements bulk-delete/bulk-tag over a selection snapshot, `goNext`/`goPrev` wraparound by id, zoom clamped to `[1, 5]`, and a keyboard map (←/→/Esc/+/−/0/F/C with the "Esc doesn't close while fullscreen" subtlety). A regression to index-based tracking — the exact bug the comment warns against — would show the wrong image after a delete, and nothing would catch it.
- **Root cause**: Interactive overlay logic was shipped behavior-only; the id-resolution and zoom math were never pulled into a testable unit or covered via RTL.
- **Impact**: User opens image A, deletes image B from a bulk action, and the lightbox jumps to the wrong asset — a silent correctness bug on the plugin's primary view.
- **Fix sketch**: RTL test for `Gallery2D` (mock `useLocalImage` like `AssetCard.test.tsx` already does): open asset at index 1, rerender with a `assets` array where an *earlier* asset is removed, assert the caption still shows the originally-opened `fileName` (id-pinning) and the `index+1 / total` updates; assert opening a then-removed asset closes the overlay. Pull `clampZoom` out as an exported pure fn and unit-test `[1,5]` bounds + pan-reset-at-1. Optionally extract `goNext`/`goPrev` index math into a pure `nextId(assets, currentId)` helper and test wraparound. Invariant: **the lightbox shows the asset the user opened regardless of list reordering, and zoom never leaves [1,5].**

## 5. `scan_dir_recursive` test misses symlink escape and the empty/unknown-extension branch
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/commands/artist/mod.rs:731-819, 821-867
- **Current test state**: exists-but-weak (`scan_classifies_by_immediate_root_child` covers bucket-vs-extension + ambiguous skip, but not all branches)
- **Scenario**: The one existing scan test is good but leaves real branches uncovered: (a) a file with an extension that is in *neither* `IMAGE_EXTENSIONS` nor `MODEL_EXTENSIONS` and outside both buckets must be `continue`d (skipped) — untested, so a mapping change that accidentally imports `.txt`/`.exe` slips through; (b) classification reads `mime_from_ext`, and the mapping (e.g. `gif`→`image/gif`, `glb`→`model/gltf-binary`) is never asserted; (c) the scanner walks dirs but symlink handling is unspecified. `artist_scan_folder`'s `NotFound` on a missing directory is also untested.
- **Root cause**: The test was written to lock the *one* prior bug (ancestor-walk misclassification) rather than the full branch table.
- **Impact**: Non-asset files (scripts, secrets-bearing text) could be imported into the gallery, or MIME types could drift and break rendering — moderate blast radius, file-system facing.
- **Fix sketch**: Extend `scan_tests`: assert a `.txt`/no-extension file outside both buckets is **absent** from the result (unknown-ext skip); add a small table test on `mime_from_ext` for each supported ext + the `application/octet-stream` fallback; add a test that `artist_scan_folder("/does/not/exist")` returns `AppError::NotFound`. Invariant: **only image/model extensions are ever imported, and each maps to its declared MIME.**

## 6. `OutputLine` classifier and the Creative session send-gate are untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:247-280, 424-444
- **Current test state**: none (the markdown serializer `sessionMarkdown.ts` is well tested, but the live renderer + send logic are not)
- **Scenario**: `OutputLine` maps stream prefixes (`[You]`/`[Tool]`/`[Creative]`/`[Complete]`/`[Error]`/`[System]`) to styling — the same prefix taxonomy `sessionMarkdown` already tests for serialization, but the render path is independent and could drift (e.g. an `[Error]` line silently rendered as plain text, hiding failures from the user). Separately, `handleSend` enforces "don't send while running" and "don't send empty," and `availableTools` is derived from `blenderReady` + connected connectors — the gate that decides whether the input is even usable. None tested.
- **Root cause**: Component-internal helpers weren't extracted or covered; only the pure markdown sibling was.
- **Impact**: Error/system lines visually indistinguishable from normal output (user misses failures), or a send fires mid-stream / with empty input.
- **Fix sketch**: Extract the prefix→className decision in `OutputLine` into a pure `classifyOutputLine(line): kind` and unit-test each prefix incl. unknown→plain (cheap, mirrors the existing `sessionMarkdown` cases). RTL test on `CreativeSessionChat`: with `availableTools` empty, the input placeholder is the "connect tools first" copy; Enter on empty input does not call `sendPrompt`; Enter while `running` does not call `sendPrompt`. Invariant: **only a non-empty prompt, while not running, is dispatched; error lines are visually distinct.**

## 7. ArtistPage tab routing has no smoke test for the media-studio branch divergence
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/plugins/artist/ArtistPage.tsx:19-77
- **Current test state**: none
- **Scenario**: `ArtistPage` switches layout on `artistTab` — `media-studio` renders a distinct `ContentBody flex noPadding` branch and `data-testid="artist-page-media-studio"`, while `blender`/`gallery` share the `centered` branch. The subtitle is also tab-derived. A wrong-branch regression (e.g. media-studio falling into the centered layout) is purely structural and low-risk, but trivially lockable given the `data-testid`s already present.
- **Root cause**: Shell component never got a routing smoke test; lazy children make a full render test heavier than it's worth.
- **Impact**: Minor layout regression on tab switch; low blast radius.
- **Fix sketch**: Lightweight RTL test mocking `useSystemStore` to return each `artistTab` value and the lazy children as stubs; assert the correct `data-testid` (`artist-page-media-studio` vs `artist-page-gallery`/`-blender`) and that the subtitle matches the active tab. Keep it a thin smoke test — do not assert child internals. (Lowest priority; only worth doing alongside #4/#6 in the same gallery/panel test sweep.)
