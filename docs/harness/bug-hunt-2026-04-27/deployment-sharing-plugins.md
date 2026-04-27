# Bug Hunt — Deployment, Sharing & Plugins

> Total: 16 | Critical: 2 | High: 7 | Medium: 6 | Low: 1

## 1. Share-link URL persists in clipboard indefinitely after copy

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/features/sharing/components/BundleExportDialog.tsx:138`
- **Scenario**: User clicks "Share link" — `navigator.clipboard.writeText(result.deep_link)` writes a single-use share token to the OS clipboard. Token is documented as "expires in 24h, single use" but the clipboard is never re-written or cleared. User pastes into Notes/Discord/Slack/an LLM chat hours later — the token (capability bearer) is now sitting in pasteboard history, screenshots, and notification previews.
- **Root cause**: Treats a bearer token like ordinary text. No clipboard auto-clear, no UI warning, no "expires at" included in clipboard content. Toast only mentions expiry verbally — easy to miss.
- **Impact**: Anyone with access to the user's clipboard history (cloud-synced clipboards: Apple Universal Clipboard, Windows cloud clipboard, KDE Connect) gains import capability for the bundle until expiry. Single-use claim is also frontend-only — there's no client guard that the token wasn't already redeemed elsewhere.
- **Fix sketch**: After 60s, attempt to overwrite clipboard with empty string if it still contains the share token; surface an in-app countdown badge with explicit "do not paste publicly" warning.

## 2. ShareLinkHandler ignores second deep-link with same URL within session

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/sharing/components/ShareLinkHandler.tsx:15-25` + `BundleImportDialog.tsx:79-95`
- **Scenario**: OS deep-link fires `personas://share?token=ABC`. User imports successfully, dialog closes. Sender re-sends the same link (same token). Event fires again — handler sets `pendingUrl` then `setOpen(true)`, but `BundleImportDialog`'s open-effect compares `autoStartedRef.current !== (initialShareUrl ?? null)`. If a stale ref still equals `ABC`, the auto-preview is skipped. More likely scenario: user re-clicks the link in their email client expecting to retry after a backend hiccup — nothing happens.
- **Root cause**: `autoStartedRef` is keyed on URL identity, not on open-cycle identity. Reset only happens when dialog actually closes (line 81). If user closed the modal mid-preview the same URL won't auto-fetch.
- **Impact**: Silent failure of share-link retry; no error or toast indicates why the dialog opened blank.
- **Fix sketch**: Reset `autoStartedRef` on every `isOpen=false` transition AND when `initialShareUrl` arrives, regardless of equality.

## 3. useDeploymentTest stale-closure prevents re-test until tests state changes

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/deployment/hooks/useDeploymentTest.ts:28-88`
- **Scenario**: User clicks "Test" on deployment X. While the request is in flight, user clicks Test on deployment Y, then Test on X again before X's first call returns. Because `runTest` depends on `tests` (line 88), a stale closure may see the previous `tests` snapshot. With `tests[deploymentId]?.running` guard from the stale snapshot, a click could be erroneously blocked OR (worse) two parallel `executePersona` calls could fire for the same ID if the closure pre-dates the running-flag write.
- **Root cause**: The double-fire guard reads `tests` from the closure rather than from the latest setState. `setTests` is asynchronous — back-to-back clicks within one render cycle both see `tests[id]?.running === false`.
- **Impact**: Duplicate billing on `executePersona` (cost charged twice), wasted Anthropic/OpenAI tokens, race between two completion handlers writing to the same deployment-id key with auto-dismiss timers also fighting.
- **Fix sketch**: Read running state from a ref or use a functional setTests that bails inside the updater.

## 4. useDeploymentTest leaks setTimeout handles on unmount

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/deployment/hooks/useDeploymentTest.ts:26,59,80`
- **Scenario**: User clicks Test, navigates away from Deployment dashboard before the 15s auto-dismiss fires. Hook unmounts. The setTimeout still fires, calling `setTests` on an unmounted component → React warning + memory retention of test result map.
- **Root cause**: No cleanup `useEffect` that walks `timers.current` and clears all pending dismiss timers.
- **Impact**: Memory leak per dashboard mount, "setState on unmounted component" warnings, potential for leaked timers to fire late and confuse future dashboard mounts that read from the same global store (none here, but the pattern is fragile).
- **Fix sketch**: Add `useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])`.

## 5. Cyclic graph cycleNodes reporting includes downstream-of-cycle nodes — false positives

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/composition/libs/dagUtils.ts:60-66`
- **Scenario**: Workflow A → B → C → B (B↔C cycle), with separate node D that depends on C. After Kahn's algorithm runs, B, C, AND D all retain non-zero in-degree because D's edge was never decremented (its parent C never made it into the queue). The validator marks D as "Node is part of a cycle" — but D is innocent.
- **Root cause**: The implementation correctly notes in the comment ("part of, or downstream of, the cycle") but `validateWorkflow` reports them all with the same message. UI highlights innocent nodes as cyclic.
- **Impact**: Users delete the wrong edges chasing a phantom cycle, or are confused why removing D's edges doesn't fix the error.
- **Fix sketch**: Use Tarjan's SCC algorithm to find true cycle members, or distinguish "in cycle" vs "blocked by cycle" in the error messages.

## 6. ImportDialog: skipConflicts/renamePrefix UI state preserved across enclave + bundle switches

- **Severity**: medium
- **Category**: state-corruption
- **File**: `src/features/sharing/components/BundleImportDialog.tsx:47-48,193-219`
- **Scenario**: User opens import dialog with file `a.persona`, sets renamePrefix="prod-" and toggles skipConflicts off. They cancel-out (no reset until dialog re-opens), then choose `b.persona` from the picker — `handlePickFile` sets a new requestToken and phase but does NOT reset `renamePrefix`/`skipConflicts`. The next bundle gets imported with stale options.
- **Root cause**: `reset()` is only invoked on isOpen flip and explicit close; mid-session file-switch keeps options around silently.
- **Impact**: Wrong prefix applied to wrong bundle's resources; conflict resolution flipped vs user expectation. Especially bad when prior session was for a bundle from a *different* peer.
- **Fix sketch**: Reset import options on any new `setFilePath` / `setShareLinkUrl` / `setClipboardData`.

## 7. useCloudHealthMonitor reconnect loop uses stale generation when reconnect succeeds

- **Severity**: high
- **Category**: race-condition
- **File**: `src/features/deployment/hooks/useCloudHealthMonitor.ts:79-126`
- **Scenario**: Connection drops, reconnect loop is at attempt 3 (60s backoff). User manually clicks Disconnect, then immediately Re-connect (from the connection form). The mount effect (line 128) tears down old generation, increments generation. Inside `attemptReconnect`, the success path at line 88-98 calls `useSystemStore.setState({ cloudConfig: config, ... cloudReconnectState: { isReconnecting: false } })` — but this fires from the OLD generation's promise. `isStale(gen)` was checked at line 86, then again none before setState. The intervening user actions are silently overwritten.
- **Root cause**: Multiple `await` points without `isStale` re-check between them. Between line 84 (`cloudReconnectFromKeyring`) and 88 (read result), state can flip.
- **Impact**: User's deliberate disconnect is undone by a delayed reconnect success; user's manual reconnect (different URL/key) is overwritten by the old keyring credentials.
- **Fix sketch**: Re-check `isStale(gen)` immediately before every setState, including the success path.

## 8. useCloudHealthMonitor wasConnectedRef triggers unwanted reconnect on first mount after disconnect

- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/deployment/hooks/useCloudHealthMonitor.ts:128-148`
- **Scenario**: User disconnects in tab A. Tab B (different React subtree) mounts the dashboard fresh. `wasConnectedRef.current` starts false → no reconnect. But if user toggles connect ON then OFF rapidly, `wasConnectedRef` flips true on the first connect, then on the disconnect the effect path at line 137 starts the reconnect loop AGAINST the user's explicit disconnect intent — there's no way to distinguish "user disconnected" from "external state change".
- **Root cause**: No "user-initiated disconnect" flag in store; the hook can't tell intentional vs accidental disconnect.
- **Impact**: Reconnect storm right after deliberate disconnect, wasted keyring lookups, UI flicker between connected/reconnecting states.
- **Fix sketch**: Add `userInitiatedDisconnect` flag to the cloud slice, set true in `cloudDisconnectAction`, gate the reconnect loop on it.

## 9. useMediaExport leaks listeners if startExport is called twice without await

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src/features/plugins/artist/sub_media_studio/hooks/useMediaExport.ts:33-105`
- **Scenario**: User clicks Export quickly twice (or React StrictMode double-invokes). First call awaits 3 listen() registrations; second call generates a new `jobId` and adds 3 MORE listeners. `unlistenersRef.current` is only assigned to the latest set (line 90), so the first 3 listeners are orphaned forever — they'll fire on every future export's progress events, attempting to setExportState with stale jobIds (filtered by `if (e.payload.job_id !== jobId) return`, so silent — but still consume IPC events and memory).
- **Root cause**: No guard on re-entrant `startExport`. The unmount cleanup only clears the latest `unlistenersRef` set.
- **Impact**: Listener leak grows linearly with export retries, IPC overhead per leaked listener, ExportState may flicker if status === 'idle' between exports allows a stale "complete" handler to fire and overwrite a fresh job's state (no jobId guard for the unmount-then-remount scenario).
- **Fix sketch**: Tear down old `unlistenersRef.current` at the top of `startExport`, or guard with `if (exportState.status === 'exporting') return`.

## 10. useArtistAssets sequential await per asset blocks scan completion forever on partial failure

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/features/plugins/artist/hooks/useArtistAssets.ts:45-48` and `useCreativeSession.ts:87-89`
- **Scenario**: Folder contains 500 scanned assets; #237 hits a Rust-side panic (e.g., file deleted during scan, permission denied, malformed EXIF). `await artistImportAsset(asset)` throws inside the for-loop. The catch on line 57 swallows it as a single toast — but everything after #237 is silently skipped. The user sees "237 imported" with no signal that 263 were missed.
- **Root cause**: Loop has no per-item error handling. First throw aborts the rest of the import.
- **Impact**: Permanent data omission (those assets won't auto-retry next scan if their fingerprints are not re-detected as "new"). UI lies about completion.
- **Fix sketch**: Wrap each `artistImportAsset` in try/catch, accumulate failures, surface a "X imported, Y failed" toast.

## 11. useLocalImage cache: failed loads poison inflight Map but cache.get() race may serve undefined

- **Severity**: low
- **Category**: race-condition
- **File**: `src/features/plugins/artist/hooks/useLocalImage.ts:46-60`
- **Scenario**: Image at path P fails to load (file deleted between scan and render). `inflight.delete(P)` is called via `.catch()` at line 55. If between line 47 (`inflight.get`) and line 49 (`.then`), another component requests the same path, it reuses the broken promise. After failure both render `null` — fine. But the MasonryGrid keys on file path; if the user fixes the file and the same path remounts, `cache.get(P)` returns undefined (never cached on failure), `inflight.get(P)` returns undefined (deleted in catch), so a fresh fetch happens — actually fine. The real bug: `inflight.set(filePath, promise)` + `promise.catch(...)` registers the catch AFTER the .then chain at line 57. If the promise has ALREADY rejected synchronously by the time line 55 runs (impossible for IPC but theoretically), Tauri reports unhandled rejection. Minor, but the catch-handler ordering is fragile.
- **Root cause**: Two consumers of the same promise (`.then` chain at 57, `.catch` at 55) — if any consumer doesn't `.catch`, you get unhandledrejection warnings that pollute logs.
- **Impact**: Console noise, log pollution, no functional break.
- **Fix sketch**: Chain `.catch` immediately after `.then` on the cached promise so all consumers share one rejection handler, or use try/catch in an async IIFE.

## 12. useTimelinePlayback: refs assigned in render body — non-deterministic with concurrent React

- **Severity**: high
- **Category**: latent-failure
- **File**: `src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts:42-44`
- **Scenario**: `totalRef.current = totalDuration; loopingRef.current = looping;` execute in the render body, NOT in a layout effect. Under React 19's concurrent rendering, the render function may be invoked speculatively (then thrown away). If a rAF tick reads `loopingRef.current` between two speculative renders, it sees the wrong value.
- **Root cause**: Mutating refs during render is allowed only for first-render initialization, not for syncing every-render values. React docs explicitly warn against this.
- **Impact**: Loop toggle may briefly behave wrong; total-duration changes can cause clamping at the wrong boundary; in StrictMode / Concurrent mode the rAF tick may briefly use a discarded render's value.
- **Fix sketch**: Use `useLayoutEffect(() => { totalRef.current = totalDuration; loopingRef.current = looping; })`.

## 13. useTimelinePlayback play() doesn't reset lastFrameRef on resume after long pause

- **Severity**: medium
- **Category**: timing-bug
- **File**: `src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts:76-86,50-74`
- **Scenario**: User plays for 5s, pauses (line 88-95), tab goes background for 30 minutes (rAF stops). User comes back, hits play. `play()` sets `lastFrameRef.current = performance.now()` — fine. But if the user pauses without `play` being called (e.g., `seek()` while playing — there's no seek-during-play handling here either), the next tick computes `dt = (now - lastFrameRef) / 1000` from a stale frame timestamp, causing a giant jump forward equal to the elapsed wallclock time.
- **Root cause**: `seek` doesn't reset `lastFrameRef`; if rAF is throttled in background tabs, the next active tick gets a huge dt.
- **Impact**: Timeline jumps past markers, skips clips, may exceed totalDuration in one frame and end playback unexpectedly.
- **Fix sketch**: In `seek`, if `playingRef.current`, set `lastFrameRef.current = performance.now()`; clamp `dt` to a max of (1/30)s per tick.

## 14. useAudioWaveform/useVideoThumbnails: in-flight cache leak when component unmounts mid-decode

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/plugins/artist/sub_media_studio/hooks/useAudioWaveform.ts:104-119` and `useVideoThumbnails.ts:107-122`
- **Scenario**: User opens 50-track audio timeline. Each track triggers `extractPeaks`. Each is a promise pending decodeAudioData (~200ms each). User switches tabs at 100ms — the hook's cleanup sets `cancelled=true` but the underlying decode/fetch CANNOT be cancelled (no AbortSignal threaded). All 50 decode operations run to completion, holding ArrayBuffer memory equal to all source files combined. With 4K video thumbnails (HTMLVideoElement attached to a hidden DOM node, src= file://), the GC cannot collect because the video element is still loading.
- **Root cause**: No AbortSignal in fetch or decode; video element is created but only torn down on success path (line 84), not on cancellation.
- **Impact**: Gigabytes of audio + video buffers held in RAM until decode finishes; on slow disks this can hang Safari WebKit (Tauri uses WebKit on macOS) for 30+ seconds.
- **Fix sketch**: Pass AbortSignal to fetch; explicitly call `video.removeAttribute('src'); video.load()` in the cancellation path.

## 15. useVideoThumbnails: video element leaked when extractFrames throws before cleanup

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/plugins/artist/sub_media_studio/hooks/useVideoThumbnails.ts:51-67`
- **Scenario**: `await new Promise` for `loadedmetadata` rejects (corrupted file, codec unsupported). The function throws BEFORE the cleanup at line 84. The HTMLVideoElement is now a detached, never-cleaned video with src= still set, holding the file open and any decoded buffers.
- **Root cause**: Cleanup is on the success path only; no try/finally.
- **Impact**: One leaked video element per failed thumbnail attempt. With a folder of corrupted files, this leaks rapidly.
- **Fix sketch**: Wrap entire body in try/finally; pause+remove src in finally.

## 16. drive paste filename collision races against rename

- **Severity**: high
- **Category**: state-corruption
- **File**: `src/features/plugins/drive/hooks/useDrive.ts:299-320`
- **Scenario**: User cuts file `report.pdf` from folder A, navigates to folder B which already contains `report.pdf`, hits paste. `dst = currentPath/report.pdf`. `driveMove(src, dst)` is called — the backend almost certainly overwrites or errors. If overwrite, the destination file is silently destroyed. Either way: if it errors, the user's clipboard mode='cut' state remains (line 316 only clears on the whole-loop scope), so the source file is intact but `clipboard` was already cleared inside the loop body if SOME paths succeeded. Inconsistent partial state.
- **Root cause**: No collision detection before move/copy; cleared clipboard regardless of success/failure.
- **Impact**: Data loss (overwritten file); confused state where some files moved and some didn't but clipboard is empty so the user can't retry.
- **Fix sketch**: Pre-check `driveStat(dst)` before each operation, prompt for rename/skip/overwrite; only clear clipboard if ALL operations in cut mode succeeded.
