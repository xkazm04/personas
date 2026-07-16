# Artist Studio — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 4, Low: 0)

## 1. Creative-session 10-minute timeout never kills the CLI child — session hangs in "running" forever
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/artist/mod.rs:706-756
- **Scenario**: If a user starts a creative session and the Claude CLI (or its Blender MCP child) wedges — e.g. blender-mcp waits on a Blender socket that never answers — the stream-read loop's `tokio::time::timeout(600s)` fires, but the very next line is `let _ = child.wait().await;` with no kill and no timeout. The hung child never exits, so `wait()` never returns.
- **Root cause**: The timeout wraps only the stdout-read loop, on the assumption that a timed-out stream implies an exiting process. `kill_on_drop(true)` only helps when the future is dropped (user cancel); on the timeout path the function keeps awaiting the still-live child, so the `"timed out after 10 minutes"` error is never constructed.
- **Impact**: Status is never set to `failed`; the UI keeps `running=true` (pulsing "streaming" indicator, input disabled) indefinitely; the wedged CLI + MCP subprocesses leak until the user manually cancels or quits the app. The advertised timeout is dead code in exactly the case it exists for.
- **Fix sketch**: On `stream_result.is_err()`, call `child.kill().await` (then `wait()`) before returning the timeout error; optionally wrap the final `wait()` in its own short timeout as a belt-and-braces.

## 2. Cancelling a session races to a "failed" status that overwrites "cancelled" and shows a spurious error
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/artist/mod.rs:484-527 (and src/features/plugins/artist/hooks/useCreativeSession.ts:127-144)
- **Scenario**: User clicks the Stop button on a running session. `artist_cancel_creative_session` cancels the token and emits status `cancelled`. The spawned task's `tokio::select!` then resolves the `token.cancelled()` arm to `Err(AppError::Internal("Creative session cancelled by user"))`, which hits the generic error branch and emits status `failed` with that message.
- **Root cause**: The completion task treats cancellation as an ordinary error; two writers emit conflicting terminal statuses for the same job, and the frontend listener processes both in arrival order — `failed` always lands last.
- **Impact**: A user-initiated cancel is recorded in session history as `failed` (overwriting the `cancelled` finalization done by both the backend event and the frontend `cancel()` handler), and an alarming red `[Error] Creative session cancelled by user` line is appended and announced assertively to screen readers. Cancel looks like a crash.
- **Fix sketch**: In the spawn's select, make the cancellation arm a distinct outcome (not `Err`) and skip `set_status(..., "failed")` for it — or check `token.is_cancelled()` in the error branch and emit nothing, since the cancel command already emitted `cancelled`.

## 3. Case-only rename is impossible on Windows/macOS — collision check trips on the file itself
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/artist/mod.rs:342-362
- **Scenario**: On Windows (the primary platform) the user double-clicks an asset named `Logo.PNG` and retypes it as `logo.png` (or fixes any casing). `new_path != old_path` is a byte-wise `PathBuf` comparison, so it's "different"; but `new_path.exists()` resolves case-insensitively on NTFS/APFS and finds the file itself, so the command returns `Rename: 'logo.png' already exists in this folder`.
- **Root cause**: The collision guard assumes `exists() && new_path != old_path` implies a *sibling* collision — false on case-insensitive filesystems where the "colliding" entry can be the very file being renamed. (Extension comparison two lines up is correctly lowercased, so the code is already aware of case-insensitivity — just not here.)
- **Impact**: Every case-only rename fails with a misleading "already exists" error; the inline rename UI silently reverts (the toastCatch in `useArtistAssets.renameAsset` shows the backend message, blaming a phantom duplicate).
- **Fix sketch**: Before rejecting, check whether the existing entry is the same file (compare `fs::canonicalize(new_path)` with the old path's canonical form, or case-insensitive filename equality with the same parent) and allow the rename through `std::fs::rename`, which handles case-only renames natively.

## 4. Lightbox wheel-zoom preventDefault is a no-op (React passive listener) — background gallery scrolls while zooming
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/artist/sub_gallery/Gallery2D.tsx:266-275 (handler attached at :314)
- **Scenario**: User opens the lightbox and scrolls the mouse wheel to zoom. React 17+ registers root-level `wheel` listeners as `passive: true`, so the `e.preventDefault()` in `handleWheel` does nothing and logs "Unable to preventDefault inside passive event listener" to the console on every notch.
- **Root cause**: The overlay is `position: fixed` but DOM-nested inside the gallery tree, and it isn't itself scrollable (`overflow-hidden`) — so the browser's default scroll action chains up to the gallery's scrollable ContentBody. The code assumes `onWheel` + `preventDefault` blocks that; with React's passive registration it cannot.
- **Impact**: Zooming in the lightbox simultaneously scrolls the gallery underneath — when the user closes the lightbox their scroll position has jumped arbitrarily far; the console fills with intervention warnings during any zoom.
- **Fix sketch**: Attach the wheel handler natively in a `useEffect` via `containerRef.current.addEventListener('wheel', fn, { passive: false })`, or suppress scroll chaining with `overscroll-behavior: contain` plus making the overlay the scroll target.

## 5. Enter during IME composition sends the creative prompt mid-typing
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:389
- **Scenario**: A user typing Japanese/Chinese/Korean (the app ships 13 locales) composes text in the prompt input and presses Enter to *commit the IME candidate*. The handler `onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}` has no `e.nativeEvent.isComposing` guard, so the half-composed prompt is immediately sent to a token-burning CLI session.
- **Root cause**: The Enter shortcut assumes Enter always means "submit"; during IME composition the same key means "confirm conversion" and browsers still deliver a keydown (keyCode 229 / `isComposing: true`).
- **Impact**: CJK users cannot type a multi-clause prompt without accidentally firing generations on partial text — each misfire starts a real Claude CLI session (cost + the single-global-session lock in `useCreativeSession` then blocks retry until it finishes or is cancelled).
- **Fix sketch**: Early-return when `e.nativeEvent.isComposing` (or `e.keyCode === 229`) before checking for Enter — same guard other chat inputs in the app should share via a small helper.
