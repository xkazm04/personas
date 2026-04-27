# Bug Hunt — External Integrations

> Total: 18 | Critical: 2 | High: 7 | Medium: 7 | Low: 2

## 1. Pipeline auto-refresh keeps polling after error backoff is calculated but interval was already set

- **Severity**: medium
- **Category**: timing-bug
- **Integration**: gitlab
- **File**: `src/hooks/utility/timing/usePolling.ts:65-82`
- **Scenario**: A pipeline is running. The first `runFetch` fails (GitLab 5xx, network blip). `errorCountRef` increments to 1. But `setInterval` was created on mount with `getDelay()` evaluated *once* at schedule-time — the next tick still fires at the original `interval`, not `interval * 2`. Backoff only takes effect when `enabled`/`interval`/`effectiveMaxBackoff` *change* and the effect re-runs.
- **Root cause**: `setInterval` uses a single delay computed at the moment `schedule()` is called; `getDelay()`'s read of `errorCountRef.current` is therefore stale forever after the first scheduling. The "exponential backoff" advertised in the docstring is a no-op while a polling cycle is alive.
- **Impact**: GitLab API gets hammered every 5 s during a sustained outage instead of backing off — risk of getting rate-limited (or banned for self-hosted instances) when the pipeline is broken precisely when refreshes matter least.
- **Fix sketch**: Replace `setInterval` with a recursive `setTimeout(() => { runFetch().finally(schedule) }, getDelay())` so each delay is recomputed against the current `errorCountRef`.

## 2. Token refresh / disconnect race leaves UI showing stale "connected" state

- **Severity**: high
- **Category**: race-condition
- **Integration**: gitlab
- **File**: `src/stores/slices/system/gitlabSlice.ts:222-252`
- **Scenario**: User clicks "Disconnect" while `gitlabInitialize` (auto-connect from vault) is still in-flight. The disconnect promise resolves and clears `gitlabConfig`, then `gitlabInitialize`'s `set({ gitlabConfig: freshConfig, ... })` resolves *after* and resurrects the connected state with a still-valid token. The user thinks they've revoked access; the app continues to call `gitlab_*` IPC commands as that user.
- **Root cause**: Neither `gitlabInitialize` nor any other action carries an "operation generation" token — every action freely overwrites `gitlabConfig` with whatever `gitlabGetConfig()` returns at await-resolution time, regardless of intervening user actions.
- **Impact**: Security/UX: silent reconnect after explicit disconnect; subsequent IPC calls succeed when the user believes they are revoked.
- **Fix sketch**: Capture an `epoch` integer; bump it on disconnect; in `initialize`, compare epoch before `set({ gitlabConfig })`.

## 3. Pipeline notifications fire for every project switch with the same pipeline IDs

- **Severity**: medium
- **Category**: edge-case
- **Integration**: gitlab
- **File**: `src/features/gitlab/hooks/usePipelineNotifications.ts:80-147`
- **Scenario**: User views project A pipelines (IDs 1, 2, 3 — pipeline #2 is `running`). Switches to project B which has a pipeline #2 with status `failed` (GitLab pipeline IDs are project-scoped, so collisions are common across projects). The hook keys `prevStatusesRef` by `pipeline.id` only; it sees "old: running, new: failed" and fires a desktop notification + adds an in-app entry, even though the two pipelines are unrelated.
- **Root cause**: The dedup key ignores `projectId`. When `clearPipelineState` runs on unmount/project change, `prevStatusesRef` survives because the hook is mounted by the parent and the effect cleanup never resets the ref.
- **Impact**: Phantom "pipeline failed" toasts when switching projects, recorded into the notification center as if real.
- **Fix sketch**: Reset `prevStatusesRef.current` whenever `projectId` changes (either via deps cleanup or by namespacing the key as `${projectId}:${pipeline.id}`).

## 4. PipelineStatusBadge stampedes on first render — N agents = N concurrent fetches

- **Severity**: medium
- **Category**: silent-failure
- **Integration**: gitlab
- **File**: `src/features/gitlab/components/GitLabAgentList.tsx:130-141`
- **Scenario**: Each agent row renders its own `<PipelineStatusBadge>`, each of which checks `pipelines.length === 0` and calls `fetchPipelines(projectId)`. With 10 agents and an empty initial store, all 10 fire `fetchPipelines` simultaneously on mount.
- **Root cause**: Per-row "if empty, fetch" pattern with no guard against in-flight calls. The auto-dedup in `tauriInvoke` only catches calls within ~250 ms, and `gitlab_list_pipelines` may not begin with the read-only prefixes registered there. Even with dedup, this is an architecture smell that breaks once an error clears state.
- **Impact**: IPC stampede warnings (the `_inflight > 50` log path), wasted GitLab API quota, and on slow connections the loading UX flickers per badge.
- **Fix sketch**: Hoist the `fetchPipelines` call to the parent `GitLabAgentList`; pass `pipelines` down. Remove the per-row effect.

## 5. `gitlabConnectFromVault` second-stage `gitlabGetConfig` failure leaves spinner stuck

- **Severity**: medium
- **Category**: state-corruption
- **Integration**: gitlab
- **File**: `src/stores/slices/system/gitlabSlice.ts:210-220`
- **Scenario**: `gitlabConnectFromVault` succeeds (token validated, persisted server-side) but the immediately-following `gitlabGetConfig()` throws (e.g. transient IPC timeout). The catch block sets `gitlabIsConnecting: false` but does NOT call disconnect, so the user is now connected on the backend but the frontend `gitlabConfig` is still null. The connection form shows "Connect" again — clicking it spawns a *second* connect attempt against the same credential.
- **Root cause**: No transactional handling — partial failure between the two awaits leaves the system in a mixed state.
- **Impact**: Duplicate connections, possible duplicate audit log entries, and the user has no obvious way to reach the disconnect button.
- **Fix sketch**: On `gitlabGetConfig` failure after a successful connect, optimistically synthesize the config from local hints and surface a non-fatal warning toast, or invoke `gitlabDisconnect` to back out cleanly.

## 6. `safeInvoke` auto-fallback masks a transient research-lab IPC outage as "no projects"

- **Severity**: high
- **Category**: silent-failure
- **Integration**: researchLab
- **File**: `src/api/researchLab/researchLab.ts:198-218`
- **Scenario**: User has 50 research projects. The Rust backend panics or fails to register `research_lab_list_projects` for one render cycle (e.g. handler restart, command map reload). `isCommandNotFound` matches `Command "research_lab_list_projects" not found`, returns `[]`, and the UI silently renders "0 projects" — same UI as a fresh install. User panics that their data is gone.
- **Root cause**: The "command not registered yet" sentinel is treated as terminal data, not as a "try again later" signal. There's no retry, no observability ping, and no UX indication the data was suppressed.
- **Impact**: Real possibility of a user nuking what they believe is a broken project list, then "restoring" by recreating projects on top.
- **Fix sketch**: When `isCommandNotFound` matches, log to telemetry and either retry once after a short delay or surface a "research-lab module unavailable" banner instead of returning empty data.

## 7. Drive path traversal protection is delegated entirely to the backend

- **Severity**: high
- **Category**: validation-gap
- **Integration**: drive
- **File**: `src/api/drive.ts:34-72`
- **Scenario**: A persona-issued tool call passes `relPath = "../../../Users/victim/.ssh/id_rsa"` to `driveRead` / `driveWriteText`. The frontend forwards it directly to the Rust handler.
- **Root cause**: Every drive function blindly forwards `relPath`. There's zero defense-in-depth — no normalization, no absolute-path check, no `..` segment guard at the JS boundary. If a future Rust bug or a misconfigured plugin disables sandboxing, the frontend would happily ferry the malicious path.
- **Impact**: Defense-in-depth gap. If the Tauri sandbox or `drive_get_root` join logic ever regresses, the LLM agent has unmediated FS access via the IPC bridge.
- **Fix sketch**: Add a `validateRelPath` helper rejecting `..`, leading `/`, drive letters, NUL bytes, and excessive length — call it in every wrapper before invoke.

## 8. OCR `cancelOcrOperation` cannot abort the IPC call already in flight

- **Severity**: medium
- **Category**: cleanup-gap
- **Integration**: ocr
- **File**: `src/api/ocr/index.ts:22-39` and `src/api/drive.ts:102-118`
- **Scenario**: User starts a 5-minute Claude OCR. `invokeWithTimeout` will reject after 300 s with `InvokeTimeoutError`. The user clicks "Cancel" at 30 s — `cancelOcrOperation` fires a *separate* IPC call to set the abort token. The original `ocr_drive_file_claude` Promise keeps holding the closure (and a UI loading state) until the backend honors the cancel token, or until the 300 s timeout fires.
- **Root cause**: `invokeWithTimeout`'s `Promise.race` does not propagate to a JS-side AbortController, and there is no `AbortSignal` parameter wired through. The "settled" flag clears the timer for memory but doesn't unblock the awaiting caller.
- **Impact**: UI shows "OCR running…" for minutes after the user cancels; if the user navigates away and back, the loading state may still be active.
- **Fix sketch**: Have the cancel path also resolve/reject the in-flight promise locally (e.g. via a per-operationId AbortController registered at invoke time).

## 9. Drive operation `driveWrite` round-trips the entire payload as a JS array

- **Severity**: high
- **Category**: latent-failure
- **Integration**: drive
- **File**: `src/api/drive.ts:49-50`
- **Scenario**: User invokes `driveWrite("video.mp4", largeUint8Array)`. `Array.from(content)` materializes a JS Array of N numbers (boxed), which then JSON-serializes as `[ 12, 99, 200, ... ]`. A 100 MB binary becomes ~400 MB of UTF-16 string + ~1 GB of intermediate JSON. WebView2 OOMs.
- **Root cause**: Tauri supports raw `Uint8Array` over IPC since v2; the wrapper unnecessarily expands it to a number array.
- **Impact**: Crash / freeze on writes >~10 MB; silent corruption if the Rust side has a numeric-overflow assumption (e.g. expects bytes, gets `i64`s).
- **Fix sketch**: Pass `Uint8Array` (or `Array.from(content)` only if the Rust handler explicitly demands `Vec<u8>` deserialization from a number array — which is a Tauri 1.x leftover).

## 10. Notification center `nextId` resets on hot reload — duplicate IDs after reload

- **Severity**: medium
- **Category**: state-corruption
- **Integration**: gitlab
- **File**: `src/stores/notificationCenterStore.ts:101-145`
- **Scenario**: App boots, persisted notifications (50 items) load from localStorage. `let nextId = 0`. New pipeline finishes — id is `pn-1-<ts>`. Next finishes — `pn-2-<ts>`. After Vite HMR or full reload, `nextId` resets to 0. Two notifications now compete for `pn-1`. `markRead`/`dismiss` apply to the wrong row when a stale notification still exists from before.
- **Root cause**: `nextId` is a module-level counter, but the persisted notifications already used IDs from a previous session. Collisions are inevitable. The Date.now() suffix only protects against same-tick collisions, not against monotonic-counter resets.
- **Impact**: Wrong notification gets marked read / dismissed, particularly after reload-during-pipeline-running scenarios.
- **Fix sketch**: Initialize `nextId` from `max(parsed.map(n => parseInt(n.id.split('-')[1])))+1`, or drop the counter and use `crypto.randomUUID()`.

## 11. Per-render `loadPipelineNotificationPrefs()` re-reads localStorage and re-parses on every pipeline batch

- **Severity**: low
- **Category**: timing-bug
- **Integration**: gitlab
- **File**: `src/features/gitlab/hooks/usePipelineNotifications.ts:106`
- **Scenario**: `usePolling` triggers `fetchPipelines` every 5 s. Each fetch updates `pipelines`, which fires the effect, which calls `loadPipelineNotificationPrefs()` — that reads + JSON-parses localStorage every cycle. On low-end devices with strict storage isolation (Tauri WebView2 sometimes serializes localStorage IO), this is measurable.
- **Root cause**: Prefs are loaded inline rather than memoized.
- **Impact**: Minor perf overhead; primarily a code-quality smell that becomes a bug if a user clears localStorage mid-session and we silently degrade to defaults.
- **Fix sketch**: Hoist prefs into a tiny zustand atom or memoize via `useRef` + `storage` event listener for cross-tab sync.

## 12. `handleRetry` in NotificationCenter triggers a *fresh* pipeline without confirmation

- **Severity**: medium
- **Category**: edge-case
- **Integration**: gitlab
- **File**: `src/features/gitlab/components/NotificationCenter.tsx:180-185`
- **Scenario**: A pipeline failed on `main`. User reads the notification on phone-screen-sized window, accidentally taps "Retry" (icon-only button, no confirm) — `triggerPipeline` fires immediately. If the original failure was due to a destructive deploy job, the re-run might re-attempt the destructive action (drop tables, push to prod) without further input.
- **Root cause**: One-click retry on production CI is dangerous; there's no "are you sure" or environment-aware guard.
- **Impact**: Accidental re-execution of side-effecting CI/CD jobs.
- **Fix sketch**: Require a confirmation step (similar to the rollback flow's two-click pattern) for retries when status is `failed`.

## 13. `gitlabRedeployAgent` falls back to "name-equals-name" matching with case-insensitive comparison

- **Severity**: high
- **Category**: edge-case
- **Integration**: gitlab
- **File**: `src/stores/slices/system/gitlabSlice.ts:330-343`
- **Scenario**: User has two personas: "DataOps" and "dataops" (the latter created accidentally as a copy). The first deploy used the lowercase one and never wrote `gitlabDeploymentMeta` (e.g. localStorage was cleared). On redeploy, the case-insensitive find returns whichever the array iterator hits first — quite possibly the wrong persona, deploying its prompt under the deployed agent's name.
- **Root cause**: Lossy string match used as a primary key. Persona names should not be assumed unique under case-folding (and aren't enforced as such elsewhere in the app).
- **Impact**: Silent persona swap — the deployed agent now answers with the wrong system prompt, possibly leaking confidential prompts/tools cross-persona.
- **Fix sketch**: When meta is missing, surface a "select persona" dialog instead of guessing. At minimum require exact-case match.

## 14. Job log viewer auto-scrolls to bottom on every poll, breaking user inspection

- **Severity**: low
- **Category**: edge-case
- **Integration**: gitlab
- **File**: `src/features/gitlab/components/JobRow.tsx:14-22`
- **Scenario**: User opens a job, scrolls up to read an early error stack trace. Polling refreshes the parent `pipelines` array → re-renders → `useEffect([log])` fires → `scrollTop = scrollHeight` yanks them to the bottom. The error they were reading vanishes off-screen every 5 s.
- **Root cause**: Auto-scroll has no "user-scrolled-up" detection.
- **Impact**: Frustrating UX on long failing logs; users can't inspect the actual failure.
- **Fix sketch**: Track `wasAtBottom = scrollHeight - scrollTop - clientHeight < 50` before update; only auto-scroll if true.

## 15. Obsidian drive sync collapses errors into a string array — actionable info lost

- **Severity**: medium
- **Category**: silent-failure
- **Integration**: obsidian
- **File**: `src/api/obsidianBrain/index.ts:154-204`
- **Scenario**: 50-file push to Drive partially fails — say, 3 files hit OAuth-expired (401), 2 hit storage quota (403), 1 hit rate-limit (429). All are flattened into `errors: string[]`. The UI cannot distinguish "auth expired, please re-login" from "out of storage, please upgrade" — both look like generic strings.
- **Root cause**: Error reduction throws away the type/category metadata that drives recovery actions. There's no per-error code/severity.
- **Impact**: User stuck retrying forever when the real fix requires re-auth or quota top-up.
- **Fix sketch**: Type errors as `{ code, message, file, retryable }` so the UI can route to login flow / quota dialog / silent retry.

## 16. Twin `recordInteraction` accepts `keyFactsJson` as a string with no schema validation

- **Severity**: medium
- **Category**: validation-gap
- **Integration**: twin
- **File**: `src/api/twin/twin.ts:144-163`
- **Scenario**: A persona-tool call passes a malformed JSON string for `keyFactsJson` (e.g. JS-object literal `{foo:1}` instead of `{"foo":1}`). The Rust handler parses, throws — interaction is dropped silently. Or worse, the persona passes an enormous JSON blob (1 MB of "key facts") and the SQLite row overflows.
- **Root cause**: String-typed JSON parameter with no client-side parse-validate-stringify cycle, no length cap.
- **Impact**: Twin pending memories silently lost; potential DB row corruption / size limits.
- **Fix sketch**: Accept `keyFacts: Record<string, unknown>` typed object, validate + JSON.stringify with length cap inside the wrapper.

## 17. Signing/verify accept arbitrary file paths with no peer-id binding check

- **Severity**: critical
- **Category**: validation-gap
- **Integration**: signing
- **File**: `src/api/signing/index.ts:32-56`
- **Scenario**: Attacker prompts the persona to call `signDocument("C:\\Users\\victim\\.ssh\\id_rsa")` — the local signing key signs an arbitrary file the user never opened. The sidecar JSON contains a valid signature claiming the user signed their own private key, which can then be exfiltrated as "signed by user" cryptographic proof.
- **Root cause**: No path allowlist (e.g. drive sandbox), no UI confirmation before signing, no prompt to the user. The frontend wrapper trusts the LLM/caller.
- **Impact**: Signature forgery on files the user never explicitly approved — undermines the entire purpose of the signing feature.
- **Fix sketch**: Require explicit user confirmation (Tauri dialog or in-app modal) BEFORE `signDocument` reaches the IPC layer; restrict path to managed-drive root or user-picked file dialog only.

## 18. `artistRunCreativeSession` cancellation race — cancel can resolve before session registers

- **Severity**: critical
- **Category**: race-condition
- **Integration**: artist
- **File**: `src/api/artist/index.ts:71-85`
- **Scenario**: User starts a creative session and clicks Cancel within ~50 ms. `artistRunCreativeSession` is still mid-IPC, the backend hasn't yet inserted the session into its tracking map. `artistCancelCreativeSession(sessionId)` returns `false` ("not found") and silently no-ops. The session then registers and runs to completion, burning paid Leonardo AI credits and writing assets the user thought they cancelled.
- **Root cause**: Cancellation depends on the session being already-registered server-side; there's no "intent to cancel" pre-registration.
- **Impact**: Real money / API credits wasted; unwanted assets written to disk.
- **Fix sketch**: Backend should accept cancellations for not-yet-known session IDs and persist the intent so registration immediately aborts. Frontend can buffer the cancel until the run promise resolves and re-issue.

