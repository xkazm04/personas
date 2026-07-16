# Obsidian Brain — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 1, High: 2, Medium: 1, Low: 1)

## 1. `obsidian_brain_resolve_conflict` bypasses the vault path-containment guard — arbitrary file overwrite outside the vault
- **Severity**: Critical
- **Category**: bug
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1266 (also 1253–1289)
- **Scenario**: The `use_app` arm does `vault_base.join(&conflict.file_path)` and `atomic_write`s the frontend-supplied `conflict.app_content` there. `conflict` is an entirely caller-supplied struct over IPC. A `file_path` containing `..` segments — or, on Windows, an absolute path like `C:\Users\me\.ssh\config` (`Path::join` with an absolute component *replaces* the base) — writes anywhere on disk. Even benignly: a `SyncConflict` held in UI state from an old pull against a since-moved vault writes to a stale location.
- **Root cause**: `resolve_vault_subpath` (mod.rs:1395) exists precisely so "every command that joins a caller-supplied path to the vault MUST go through this" (its own doc comment), and `list_vault_files`/`read_vault_note` were already retrofitted after bug-hunt 2026-06-07 creative #2 — but the conflict-resolution write path was missed. Compounding: the write never re-checks that the on-disk file still matches `conflict.vault_hash`, so vault edits made while the conflict dialog was open are clobbered (TOCTOU).
- **Impact**: Arbitrary file overwrite primitive from the webview (defeats the whole vault-confinement effort); silent destruction of newer vault edits even in the honest case.
- **Fix sketch**: Route `conflict.file_path` through `resolve_vault_subpath(vault_base, Some(&conflict.file_path))` before writing (the target exists in a conflict, so canonicalize succeeds). Before the `use_app` overwrite, re-hash the current file and return a fresh-conflict error if it no longer equals `conflict.vault_hash`.

## 2. Goal push regresses every hardening the other push paths received: title-keyed filenames clobber, absolute paths poison sync state, vault edits blind-overwritten
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1640–1666
- **Scenario**: User has two goals whose titles sanitize identically (e.g. "Setup: API" and "Setup / API" → `Setup--API.md`) and runs "Push goals": both entities write the same file, last writer wins, and *both* sync-state rows record success — silent data loss with success theater. Separately, the user edits a goal note in Obsidian, then pushes again: the edit is overwritten without the `classify_push` divergence check every other entity type has. Renaming a goal orphans the old note (new filename, old file never cleaned or reused).
- **Root cause**: `obsidian_brain_push_goals` was written before (or apart from) the memory-path fixes and never adopted them: it uses `sanitize_filename(&goal.title)` alone instead of `vault_note_filename(title, id)` (mod.rs:507, added specifically for this clobber bug), skips `classify_push`, and — unlike every other entity — stores the **absolute** path in `vault_file_path` (line 1662 `file_path.to_string_lossy()`), breaking the vault-relative invariant the rest of the module (pull sync, conflict resolution) relies on and going stale if the vault moves.
- **Impact**: Silent loss of goal notes on title collision; user's in-vault goal edits destroyed on every push; sync-state rows unusable by any relative-path consumer.
- **Fix sketch**: Reuse the existing path when a sync state exists, else `vault_note_filename(&goal.title, &goal.id)`; store `strip_prefix(vault_base)` relative paths; run `classify_push` before overwriting, mirroring the memory branch.

## 3. GraphPanel vault-watcher lifecycle races: leaked event listener + stop/start reordering silently kills live refresh
- **Severity**: High
- **Category**: bug
- **File**: src/features/plugins/obsidian-brain/sub_graph/GraphPanel.tsx:84–107
- **Scenario**: (a) User opens the Graph tab and switches away before the `listen()` promise resolves — cleanup runs with `unlisten === null`, so the listener is never removed; each revisit leaks another listener, and every vault change then triggers N debounced `loadStats` full-vault walks plus setState on an unmounted component. (b) User switches vaults (`activeVaultPath` change re-runs the effect): the old cleanup fires `stopWatcher()` and the new mount fires `startWatcher()` as two independent, unordered IPCs — if the stop lands after the start (or the backend watcher is a vault-scoped singleton), the freshly started watcher is stopped, and the panel silently never refreshes on vault edits again (stats look live but are frozen).
- **Root cause**: Assumes cleanup ordering follows synchronous effect semantics, but both registration (`listen().then`) and start/stop are fire-and-forget async with no sequencing or cancellation handshake.
- **Impact**: Listener/IPC leak growing per tab visit; retry-storm of vault re-walks on large vaults; dead live-refresh after a vault switch with no error surfaced.
- **Fix sketch**: Track a `cancelled` flag: in `.then((u) => cancelled ? u() : (unlisten = u))`. Serialize watcher lifecycle — await the previous stop before starting (e.g. chain both through a module-level promise), or make the backend `start_watcher` idempotently restart for the current vault so a late `stop` for an old vault is a no-op.

## 4. BrowsePanel note preview: out-of-order reads show the wrong note's content, and errors are rendered as markdown "content"
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:120–131 (render 253–257)
- **Scenario**: User clicks large note A (slow disk/IPC read), then immediately clicks small note B. B's read resolves first; A's resolves later and overwrites `noteContent` — the pane now shows note A's body under note B's title/path/word-count, and "Open in Obsidian" opens B. Also, on read failure `noteContent` is set to `` `Error: ${e}` `` and fed through `parseNote` + ReactMarkdown as if it were note content — no error styling, no retry, and a bogus word count.
- **Root cause**: `selectNote` has no stale-response guard (no check that `path` is still the selected path when the await returns), and the error channel is smuggled through the success-state variable.
- **Impact**: Silently mismatched content/metadata — worst case the user copies or acts on the wrong note; failures masquerade as notes.
- **Fix sketch**: After `await`, bail unless the requested `path` still equals the current selection (ref or functional check). Add a separate `noteError` state rendered with the shared error/EmptyState treatment and a retry action.

## 5. Graph search shows "No matches" for a query that was never run
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/obsidian-brain/sub_graph/GraphPanel.tsx:278–280
- **Scenario**: User types "kubernetes" into the vault search box but hasn't pressed Enter or clicked Search yet. The condition `!searching && query.trim() && searchHits.length === 0` is already true, so "No matches" renders immediately — asserting a search result that never happened. Likewise, after a successful search, editing the query keeps showing the previous query's hits (or the false "No matches") with no indication they're stale.
- **Root cause**: The empty-state keys off the *input text* instead of a completed-search marker; there is no "last executed query" state distinguishing untouched / searched / stale.
- **Impact**: Users are told their vault lacks content it may well contain — an honesty bug in miniature; stale hit lists mislead after query edits.
- **Fix sketch**: Track `lastRanQuery: string | null`; show "No matches" only when `lastRanQuery !== null && hits.length === 0`, and dim or clear hits when `query !== lastRanQuery`.
