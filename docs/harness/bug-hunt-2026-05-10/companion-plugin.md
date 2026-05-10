# Bug Hunt — Companion Plugin

> Group: Plugins
> Files scanned: 12
> Total: 1C / 4H / 5M / 2L = 12 findings

---

## 1. Overlapping TTS playbacks stack — concurrent audio elements never paused

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:657`
- **Scenario**: User sends turn N with voice on. Before playback finishes (Piper `high` voice can be 5-10s), user picks a quick-reply (turn N+1). `send()` again fires `synthesizeTts → playAudio(url)` and creates a fresh `new Audio(url)` element. Turn N's `<audio>` is still playing — `playAudio()` never returns/exposes the element to the caller (return value is discarded), so there is no handle to `.pause()` it. Both clips play simultaneously, garbling Athena's reply.
- **Root cause**: `play()` returns `{ audio, done }` (`voicePlayback.ts:44`) but the call site at line 666 destructures only `done`. There is no `currentAudioRef` that pauses the previous element before starting the next.
- **Impact**: Any chain of voice-enabled turns within ~10s of each other produces overlapping TTS. Worse with Piper (longer clips) or low-bandwidth ElevenLabs syntheses queued during streaming.
- **Fix sketch**: Hold a `useRef<HTMLAudioElement | null>` at panel scope; before assigning a new audio, call `prev?.pause(); prev?.removeAttribute('src'); prev?.load()`. Store the new element in the ref.

## 2. `URL.createObjectURL` blob URLs leak — never revoked

- **Severity**: medium
- **Category**: memory-leak
- **File**: `src/features/plugins/companion/voicePlayback.ts:34`
- **Scenario**: Each TTS turn allocates a Blob (~50KB ElevenLabs MP3, 150-300KB Piper WAV) wrapped in an object URL. That URL is set in `pendingPlayback.audioUrl` and replaced on the next turn. The replaced URL is never `URL.revokeObjectURL`-ed.
- **Root cause**: Comment at line 18-19 explicitly defers cleanup to page unload. In a long-lived Tauri window with hundreds of voice turns per day, the bloblist grows monotonically.
- **Impact**: Renderer memory grows ~150-300KB per voice turn forever; Tauri webview eventually triggers OS pressure and the dictation/audio subsystems get evicted unpredictably. Affects power users who leave the app open for days.
- **Fix sketch**: Revoke the previous URL inside `setPendingPlayback` (or its companion-store reducer), and inside `setPlaybackAudioUrl` when overwriting.

## 3. Failed Piper download leaves orphan `.onnx` if the streaming partial rename succeeded but the JSON download fails

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src-tauri/src/companion/tts/downloader.rs:189-196`
- **Scenario**: Network drops between the .onnx finishing (rename to final completes) and the .onnx.json fetch starting. Code path at line 194 calls `std::fs::remove_file(&onnx_path)` after `cleanup_partials` — but if the user cancels the app process *between* those two ops (e.g. force-kill, OS sleep, panic in the upstream client), only the .onnx file persists. `is_voice_downloaded` will then return false (good), but next `download_voice` call goes through the full re-download — fine. **BUT** `cleanup_partials` only sweeps `*.partial`, not stranded `<voice>.onnx`. Repeated failed runs accumulate stale .onnx files only deleted by full retry success, wasting ~60-110 MB of disk on a flaky connection.
- **Root cause**: The "either fully present or fully absent" invariant in the comment at line 192-194 is enforced only when control reaches the second cleanup, not on process-kill between renames.
- **Impact**: Disk-bloat on networks with intermittent failures; user sees the "Download" button (since `is_voice_downloaded` requires both files) but storage keeps growing. Hard to diagnose.
- **Fix sketch**: Stream both files to `.partial`, then rename both at the end (atomic-pair commit). Or extend `cleanup_partials` to also delete an orphan `.onnx` when its `.onnx.json` is absent.

## 4. Tauri progress events for downloads can outlive `cancelled` flag in PiperVoicePanel — stale state writes after unmount

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/plugins/companion/sub_voice/PiperVoicePanel.tsx:93-117`
- **Scenario**: User opens Voice → Piper, starts downloading, switches engine to ElevenLabs (PiperVoicePanel unmounts). The cleanup function sets `cancelled = true` and calls `unlistenRef.current()` — but the `listen()` promise might still be pending (the Promise resolves only after the IPC handshake registers the listener). If `cancelled=true` is set *after* the listener fires inside a still-mounted closure, that's fine — but there's a window between `listen(...)` resolving and the `if (cancelled) unlisten()` branch where the inner handler `(evt) => setProgress(...)` can fire on the now-unmounted component. The `cancelled` check at line 96 is the only guard, and it's checked once at handler entry — but it does correctly guard the `setProgress` call. **The real bug**: the `void refreshVoices()` triggered when `evt.payload.state === 'completed'` (line 100) runs unconditionally without checking `cancelled`, racing the unmount.
- **Root cause**: The cancellation flag is checked at handler entry but not on the side-effect `refreshVoices()` call.
- **Impact**: Console warning "Can't perform a React state update on an unmounted component" + occasional spurious re-renders if React StrictMode is on.
- **Fix sketch**: Wrap the `refreshVoices()` call in `if (!cancelled) void refreshVoices();`.

## 5. ElevenLabs API key leaks into reqwest error chain when DNS/TLS fails

- **Severity**: medium
- **Category**: cred-leak
- **File**: `src-tauri/src/companion/tts/elevenlabs.rs:103-111`
- **Scenario**: API key is set as `xi-api-key` header (line 105). On certain low-level reqwest failures (rare, but TLS handshake errors in some configurations), the resulting `reqwest::Error` may include the request URL but not headers — *however*, the `e` is forwarded into `AppError::Internal(format!("tts request: {e}"))` and then bubbled to the renderer. While reqwest normally redacts auth headers in `Display`, it does not redact request body fields. **More concretely**: the request body at line 97-101 contains `request.text` (the spoken summary) which can include user PII (names, schedule details) extracted from Athena's brain. That leaks via the `Display` impl on `Error::Reqwest` paths that show response/request snippets.
- **Root cause**: `format!("tts request: {e}")` propagates whatever reqwest stuffs into the error, with no field allowlist.
- **Impact**: PII from Athena's spoken summaries can surface in app error toasts, telemetry sinks, and sentry breadcrumbs.
- **Fix sketch**: Catch the error variant; if it's a body/URL-bearing error, log only `e.status()` and a fixed message "ElevenLabs request failed"; preserve detail in tracing only (server-side).

## 6. Piper subprocess stdin write hangs forever if the engine binary stalls before reading stdin

- **Severity**: high
- **Category**: child-leak
- **File**: `src-tauri/src/companion/tts/piper.rs:217-219`
- **Scenario**: `stdin.write_all(text.as_bytes()).await` has no timeout. Piper child gets SIGSTOP, AV-quarantines, or hits a slow ONNX runtime DLL load — stdin buffer fills (~64KB pipe), the write blocks, and the outer `tokio::time::timeout(PIPER_TIMEOUT, child.wait_with_output())` timer at line 224 never even starts because we're still in the inner block at line 211-222. The `await` on the write never completes, so the whole IPC call hangs until the Tauri invoke timeout (default 90s).
- **Root cause**: Two-stage timing: the 60s timeout is on `wait_with_output`, not on the entire pipeline. stdin write is unbounded.
- **Impact**: A flaky Piper install (AV interference is common on Windows) leaves the renderer awaiting forever; user sees Athena "speaking..." indicator stuck. The orphan child process keeps holding `model.onnx` open, blocking voice deletion.
- **Fix sketch**: Wrap the entire spawn-write-wait sequence in one `tokio::time::timeout(PIPER_TIMEOUT, async { ... })`. On timeout, also call `child.kill().await.ok()` to reap the process.

## 7. Piper subprocess never killed on outer timeout — orphan child + temp file linger

- **Severity**: high
- **Category**: child-leak
- **File**: `src-tauri/src/companion/tts/piper.rs:224-227`
- **Scenario**: Piper hits the 60s timeout. The error path at line 226 returns `Err(...)`, but `child` (a `tokio::process::Child`) is dropped without `kill()`. By default tokio's `Child` does NOT kill on drop unless `kill_on_drop(true)` was called on the Command — it isn't here. Process keeps running until self-exit; meanwhile the `tempdir` from line 157 is dropped (deletes `out.wav`'s parent), but Piper still holds the file handle on Windows → next attempt may collide on the same hashed temp prefix.
- **Root cause**: Missing `cmd.kill_on_drop(true)` and missing explicit kill on timeout branch.
- **Impact**: On a system where Piper hangs (rare but observed with corrupt voice models), repeated synthesis attempts spawn one runaway process per attempt; CPU pegs at 100% until the user finds and kills them. On Windows the temp dir cleanup also fails silently.
- **Fix sketch**: Add `cmd.kill_on_drop(true)` before spawn; on timeout, explicitly `let _ = child.start_kill(); let _ = child.wait().await;` before returning.

## 8. SetupWizard / SetupPanel — no idempotency guard on `companionInit`-dependent surfaces; lose first-run footer-disabled users

- **Severity**: medium
- **Category**: wizard-skip
- **File**: `src/features/plugins/companion/sub_setup/SetupPanel.tsx:33-58`
- **Scenario**: User disables `companionFooterEnabled` (line 35) before ever opening the chat panel. `companionInit` is fired only from the chat panel mount path (`companionInit` in `companion.ts:28`). Setup tab renders without ever triggering brain init — but also calls `projectTrackingIsMasterEnabled`, `companionBetaFlags`, `companionGetSensoryState`. If brain dirs don't exist yet, the sensory state read silently returns defaults (all false), and toggling them invokes `companion_set_sensory_source_enabled` against a non-initialized backend that may noop.
- **Root cause**: Setup surfaces assume brain init happened elsewhere. There's no init-on-mount in SetupPanel.
- **Impact**: User who turns off the footer icon before chatting sees Setup toggles that look functional but write into a non-existent state — toggles re-read as off after refresh, producing user confusion ("I turned this on, why is it off?").
- **Fix sketch**: SetupPanel mount should call `companionInit()` (which is idempotent and globalThis-cached) before reading sensory state.

## 9. `companion_send_message` — no concurrency guard; double-Enter sends two turns into Claude CLI

- **Severity**: critical
- **Category**: race-condition
- **File**: `src-tauri/src/commands/companion/chat.rs:50-80`
- **Scenario**: User hits Enter twice in <50ms (laptop trackpad bounce, fast keystroke). The Composer's `disabled={... || streaming}` gate (CompanionPanel.tsx:1048) only flips `streaming=true` *after* `setStreaming(true)` runs in the next React frame. Two `companion_send_message` IPC calls reach the backend before the first sets `streaming`. There's no mutex on the Rust side — both calls run concurrently against the same Claude CLI session id, both attempt to mutate the same `companion_node` rows, and Claude CLI receives interleaved stdin (since the session is single-threaded). Result: garbled prompt, possibly two assistant episodes for one user turn, possibly a poisoned session id.
- **Root cause**: Backend has no per-session mutex; frontend's `streaming` flag is async w.r.t. React render.
- **Impact**: Easily reproducible by holding Enter in the textarea. Corrupts conversation state; after recovery the user has duplicate user bubbles or missing assistant turns. Worst case: poisoned Claude CLI session id requires manual reset.
- **Fix sketch**: In `session::send_turn`, wrap the body in a per-session `tokio::sync::Mutex` (lazy_static or held in `AppState`). Concurrent calls await; second call sees the now-updated state and is a no-op or a real second turn.

## 10. DashboardPanel re-fetches on every window focus — wastes IPC + re-runs JSON.parse on a possibly large spec

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/plugins/companion/sub_dashboard/DashboardPanel.tsx:43-50`
- **Scenario**: `window.addEventListener('focus', handler)` calls `load()` on every alt-tab back to the app. With 50 alt-tabs across a workday and a 200-widget spec (Athena went wild composing), that's 50 IPC round-trips and 50 JSON.parse calls of multi-KB strings. Spec rarely changes between focuses.
- **Root cause**: No "dashboard changed" signal — focus is used as a proxy. No `updatedAt` comparison.
- **Impact**: Minor UI jank on focus + wasted Tauri IPC. Charts may briefly re-mount and re-fetch their own data.
- **Fix sketch**: Subscribe to `COMPANION_COMPOSE_DASHBOARD_EVENT` (already exists, line 559 in api/companion.ts) and refetch only on that signal; drop the focus listener.

## 11. `companion_set_active_connectors` (replace_all) deletes connectors with NO bounds check on names list size

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/companion/connectors.rs:183-215`
- **Scenario**: Frontend sends `companionSetActiveConnectors([5000 connector names])` (corrupt payload, deserialization-recovered, or malicious). The DELETE at line 197-198 builds a SQL string with 5000 `?` placeholders. SQLite default `SQLITE_MAX_VARIABLE_NUMBER` is 32766 (recent versions) but historically 999. With names.len() = 5000, this exceeds 999 on older SQLite builds bundled with rusqlite; query fails with "too many SQL variables" — no rollback message in `replace_all` because the error bubbles through `tx.execute(...)?;` without explicit rollback context.
- **Root cause**: No length validation on the input vector.
- **Impact**: On older bundled SQLite, replace_all silently fails for large lists; on newer ones it just runs slowly. No clear user-facing error.
- **Fix sketch**: Reject `names.len() > 256` (sanity bound) at the top of `replace_all` with `AppError::Validation("too many connectors pinned")`.

## 12. Episode delete races doctrine ingest — `companion_node` row gone but FTS/embedding rows leak on partial failure

- **Severity**: low
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/companion/brain.rs:269-292`
- **Scenario**: `delete_episode` issues three separate `conn.execute` calls (FTS, embedding, node) outside a transaction (lines 280-285). If the second call (embedding) fails (e.g. table locked by ingest), FTS row is already gone but node row remains. The function returns `Ok(())` because the FTS/embedding deletes use `let _ =` (line 280, 281). The `companion_node` delete at line 285 uses `?` so does propagate, but: row order means FTS row may be deleted while embedding row leaks, OR if the third call fails the user sees an error but the FTS row is gone (search inconsistency).
- **Root cause**: Three independent statements with different error-handling discipline — no transaction.
- **Impact**: Brain inspector can show "no results for query X" for an episode that's still in `companion_node` (if FTS succeeded but node delete failed), or vice versa. Hard to reproduce but corrupts the search index over time.
- **Fix sketch**: Wrap the three deletes in `conn.unchecked_transaction()` and propagate errors uniformly.
