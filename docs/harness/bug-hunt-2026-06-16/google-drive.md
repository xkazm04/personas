# Bug Hunter — Google Drive

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: google-drive | Group: First-Party Plugins

> NOTE: The manifest frames this context as "OAUTH + EXTERNAL API … Google Drive". The
> code that actually exists is a *local managed-filesystem sandbox* ("Drive" plugin) plus
> generic Google OAuth credential resolution (`google_oauth.rs`) used by unrelated connectors.
> There is no Google Drive REST client, pagination cursor, or token-refresh-during-request
> path in these files — so the manifest's "pagination losing files / token refresh race /
> retry storm" hunts have no corresponding code. Findings below are the real failure modes
> in the code that ships under this name (token/OAuth boundary covered in #5).

## 1. `drive_copy` silently overwrites an existing destination file — paste/copy data loss
- **Severity**: Critical
- **Category**: 💀 Silent failure / data loss
- **File**: `src-tauri/src/commands/drive.rs:1228` (the file branch at `:1251`, `std::fs::copy`)
- **Scenario**: User selects `report.pdf`, Ctrl+C, navigates to a folder that already contains a different `report.pdf`, Ctrl+V. `pasteHere` builds `dst = currentPath + "/report.pdf"` and calls `driveCopy(src, dst)`. The backend does **not** check `dst.exists()` before `std::fs::copy(&src, &dst)`, so the existing file is overwritten in place. The same applies to a persona-exported file colliding with a user file, and to folder copies (`copy_dir_recursive` does `create_dir_all` + per-file `std::fs::copy`, merging/overwriting silently).
- **Root cause**: `drive_move` guards with `if dst.exists() { return Err(...) }` (`:1199`), but `drive_copy` has no equivalent guard — it only `create_dir_all`s the parent then copies. The asymmetry means "copy" is the destructive one.
- **Impact**: Irrecoverable overwrite of a same-named file (the victim isn't even soft-deleted to `.trash`). A success toast + green flash fire, so the user believes the paste was additive. Classic "success theater" over data loss.
- **Fix sketch**: Mirror `drive_move`: reject when `dst.exists()` for files, or auto-disambiguate the basename (`report (2).pdf`) the way `move_to_trash` bumps a counter. For folder copies, refuse merge into an existing dir or disambiguate the top-level dir name.

## 2. `pathCacheRef` is never invalidated on mutation — columns view & cached panes act on stale/deleted files
- **Severity**: High
- **Category**: 🔮 Latent failure / stale file list
- **File**: `src/features/plugins/drive/hooks/useDrive.ts:238` (cache) + `:256` (only writer) and `DriveFileList.tsx:1042` (`AsyncColumnEntries` seeds from it)
- **Scenario**: In Columns view the user navigates `a → b → c`, caching entries for `a` and `b`. They then delete or move a file out of `a` (via context menu, which acts on `currentPath = c`'s siblings, or via a drag). `remove`/`move`/`pasteHere` call `refresh()` which only re-writes the cache entry for `currentPath`. The parent column `a` keeps rendering the deleted file from `cachedEntriesFor("a")`. Double-clicking it calls `onOpen`/`driveOpenInOs` on a path that no longer exists.
- **Root cause**: The comment at `:236` claims "Mutations invalidate touched paths," but no code path ever deletes from `pathCacheRef`. Only `refresh()` writes, and only for the single current path. Parent/sibling cache entries are immortal for the session.
- **Impact**: Stale rows in Columns view that error (NotFound) or, worse, act on the wrong file if a new file later takes the freed name. Persona-driven drive writes (the whole point of `drive.document.*` events) never invalidate the cache at all.
- **Fix sketch**: On any mutation, delete the affected path and its parent from `pathCacheRef` (or clear the whole map — it's a perf cache, not correctness state). At minimum invalidate `driveParentPath(src)`, `driveParentPath(dst)`, and `currentPath`.

## 3. Recursive-search results are a frozen snapshot with no in-flight cancellation — acts on deleted/renamed files & can resurrect cleared results
- **Severity**: High
- **Category**: ⚡ Race condition / 🕳️ file deleted between list and action
- **File**: `src/features/plugins/drive/hooks/useDrive.ts:327` (`runRecursiveSearch`) + `DriveFileList.tsx:1148` (`RecursiveResultRow` actions)
- **Scenario**: User runs an all-drive search; `driveSearch` walks the tree (can be slow on a large drive, capped at 1000 hits). While it's in flight the user navigates away or clears the query — the effects at `:350`/`:355` set `recursiveResults = null`. When the slow `await driveSearch(q)` finally resolves, `setRecursiveResults(results)` (`:333`) overwrites the cleared state, snapping the user back into a stale results view they dismissed. Separately, results never refresh after a mutation, so the "Reveal"/open buttons in `RecursiveResultRow` act on paths that may have been renamed/deleted since the walk.
- **Root cause**: `runRecursiveSearch` has no cancellation token / generation guard (unlike `AsyncColumnEntries` and `FilePreview`, which use a `cancelled` flag). The success setter runs unconditionally in `try`.
- **Impact**: UI flicker/zombie search view; actions fire on stale file ids → NotFound errors or wrong-file actions. On a 1000-hit drive this is a real window.
- **Fix sketch**: Add a monotonically increasing `searchGenRef`; capture it before `await`, and only apply results if it still matches on resolve. Drop results on navigation/clear by bumping the generation.

## 4. Open / OS-action failures on a row deleted out-from-under the user are swallowed or shown as a generic toast — no list reconciliation
- **Severity**: Medium
- **Category**: 💀 Silent failure / edge case (file deleted between list and action)
- **File**: `src/features/plugins/drive/DrivePage.tsx` (open/reveal handlers via `driveOpenInOs`/`driveRevealInOs`) + `DriveDetailsPane.tsx:474` (`driveReadText`) / `:603` (`driveRead`)
- **Scenario**: A persona execution's post-run drive sync (`diff_and_emit_drive_events`) or `purge_old_trash` deletes/renames a file the user currently has selected. The backend `drive_read`/`drive_open_in_os` returns `NotFound`. In the Details pane preview, the failure is routed to `silentCatch("drive:preview")` / `silentCatch("drive:image-preview")` — the pane just stays on the spinner or shows nothing, with no "file no longer exists" state and no list refresh. The row remains visible and selected.
- **Root cause**: Reads use `silentCatch` (swallow), and no handler reconciles the entry list when an action 404s. The list only refreshes on explicit user mutations, not on action failure.
- **Impact**: Ghost rows that look actionable but silently no-op; the preview pane appears hung. User has no signal the file vanished, especially likely here because agents write/delete into the same sandbox concurrently with the user.
- **Fix sketch**: On a NotFound from any per-entry action, surface a toast and trigger `drive.refresh()` so the stale row disappears. Give `FilePreview` an explicit "gone"/error state instead of a silent catch.

## 5. OAuth client secret is read from `.env` files walked up the cwd tree (and from cwd in dev-drive resolution) — secret-exposure / wrong-root surface
- **Severity**: Low
- **Category**: Trust boundary / 🕳️ environment edge case
- **File**: `src-tauri/src/engine/google_oauth.rs:20` (`dotenv_var_first_nonempty`) + `drive.rs:337` (dev-drive uses `current_dir()`)
- **Scenario**: `resolve_google_oauth_env_credentials` falls back to scanning `.env`, `../.env`, `../../.env` relative to the *process working directory*. If the app is launched from an unexpected cwd (or a packaged build inherits an attacker-influenced cwd containing a planted `.env`), client_id/secret are silently sourced from that file. The parser also does naive `split_once('=')` and strips only one layer of quotes, so values with `=` or mismatched quotes resolve to a malformed secret that later fails OAuth with an opaque error. The dev-drive root in `drive.rs` similarly trusts `current_dir()` for the sandbox base.
- **Root cause**: cwd-relative credential/sandbox resolution with no anchoring to a known app directory, and a hand-rolled `.env` parser with no validation.
- **Impact**: Low in the normal desktop flow (cwd is the repo/install dir), but it's an unaudited input path for a long-lived OAuth secret and a confusing failure mode (`redirect_uri_mismatch`/auth fails) when a stray `.env` shadows the intended credentials.
- **Fix sketch**: Anchor `.env` search to the app's install/resource dir rather than cwd; prefer compile-time/runtime env over file scan (already first in `resolve_env_value` — consider dropping the file fallback for release builds). Validate parsed secrets are non-empty and free of stray quoting before use.
