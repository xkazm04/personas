# Bug Hunter — Fleet Control

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: fleet-control | Group: Teams & Fleet Orchestration

## 1. Broadcast result is success-theater: full success is silent, full failure looks like a "delivery"
- **Severity**: Critical
- **Category**: Silent failure / success theater
- **File**: `src/features/plugins/fleet/FleetBroadcastModal.tsx:75`
- **Scenario**: Operator selects 4 sessions, types a prompt, hits Send. Two cases break: (a) every `writeInput` succeeds → `failed === 0`, so the `if (failed > 0)` block is skipped, the modal closes, and there is **no toast at all** — the user gets zero confirmation the broadcast actually went anywhere. (b) every `writeInput` *fails* (e.g. all writers dropped after the sessions died) → `failed === selected.size`, the code still runs `toastCatch(..., 'Broadcast delivered to 0 of 4 sessions')`. The word "delivered" plus a 0 reads like a partial success, not the total loss it is.
- **Root cause**: The handler only branches on `failed > 0` and reuses a single hard-coded "delivered to X of Y" string for every non-clean outcome. It also routes that string through `toastCatch`, which always renders an **error**-styled toast (`addToast(msg, 'error')`) — so even genuine partial success is painted red, and there is no `'success'` toast path for the clean case.
- **Impact**: The single most important feedback in the feature (did my fleet-wide command land?) is either absent or misleading. An operator who broadcasts `/compact` or a follow-up prompt to 8 agents and silently hits 8 dead writers walks away believing the fleet is working when nothing was sent. This is the classic "lost broadcast" failure with no surface signal.
- **Fix sketch**: Compute `sent = selected.size - failed`. Emit three explicit outcomes via `addToast`: `sent === total` → green "Sent to N sessions"; `0 < sent < total` → amber "Sent to X of Y (Z failed)"; `sent === 0` → red "Broadcast failed — 0 of N delivered". Stop using `toastCatch` for the partial/none cases; reserve it for the unexpected-throw path.

## 2. Broadcast targets a stale, store-cached session list that lags live Rust state — writes into dead PTYs
- **Severity**: High
- **Category**: Race condition / silent failure
- **File**: `src/features/plugins/fleet/FleetBroadcastModal.tsx:54`
- **Scenario**: `targetable` is derived from `useSystemStore(s => s.fleetSessions)`, a client-side cache populated by lagging events (`FLEET_SESSION_EXITED`/`FLEET_REGISTRY_CHANGED`) and pull snapshots. A session that just exited (process crashed, hit `STATUS_DLL_INIT_FAILED`, or was hibernated by the always-on auto-hibernate ticker) is still listed as `state !== 'exited'` until its event reaches the store. The operator selects it, sends, and the Rust `write_input` finds either no session or a `writer == None` and returns `session writer dropped`. Combined with finding #1, that loss is invisible.
- **Root cause**: The broadcast trusts a read-model cache as if it were the source of truth, and there is no per-target liveness re-check at send time. The Rust `fleet_write_input` is the only authority on whether a writer still exists, but its error is funneled into a swallowed `failed` counter.
- **Impact**: Broadcasts intermittently land partially or not at all whenever the fleet is churning (sessions exiting/auto-hibernating mid-compose), with no per-session indication of which ones missed. The bug is timing-dependent so it survives manual testing and bites under real multi-agent load.
- **Fix sketch**: Surface per-session results from `handleSend` (collect the failed ids) and either keep the modal open listing which targets failed, or re-validate state immediately before the loop and skip non-live ids. Longer term, return a structured `{ sent, failed[] }` from a batched Rust `fleet_broadcast` command so liveness is checked atomically under the registry lock.

## 3. Selection Set retains ids of removed sessions; broadcast iterates dead ids and the target counter desyncs
- **Severity**: Medium
- **Category**: Edge case / stale state (session id retention)
- **File**: `src/features/plugins/fleet/FleetBroadcastModal.tsx:36`
- **Scenario**: In plain broadcast mode (`initialText === undefined`) the `selected` Set deliberately persists across open/close (only seeded mode resets it at line 47-52). Operator opens broadcast, checks 3 sessions, closes without sending. One of those sessions exits and is dropped from `fleetSessions` via `fleetRemoveSessionLocal`. Reopen broadcast: the removed id is still in `selected`, but it no longer appears in `targetable`. The header shows e.g. `Targets (3/2)` (selected.size > targetable.length), and Send loops over the orphaned id, hitting a "session not found" write that is silently counted as a failure.
- **Root cause**: `selected` is never reconciled against the current `targetable` list. There is no effect pruning ids that left the session list, and `selectAll`/`clearSel` only help if the user notices.
- **Impact**: Confusing counter (`N/M` with N>M), a guaranteed silent failure baked into the send, and "Send to 3" when only 2 live targets exist. Minor on its own but compounds findings #1/#2 to make the broadcast count untrustworthy.
- **Fix sketch**: Add a `useEffect`/`useMemo` that intersects `selected` with `new Set(targetable.map(s => s.id))` whenever `targetable` changes, dropping departed ids. Display `selected ∩ targetable` size in the counter and as the Send label.

## 4. Killed/crashed tile can show stale "running" forever — exit emit is fire-and-forget with no client-side reconciliation
- **Severity**: High
- **Category**: Latent failure (tile leak / stale status)
- **File**: `src-tauri/src/commands/fleet/commands.rs:122`
- **Scenario**: `fleet_kill_session` kills the child via `close_pty_handles` and returns `Ok`, but the row's state flip to `Exited` and the `fleet-session-exited` event are produced **only later, by the reaper task** when it observes the child exit. If the reaper never fires the exit for that session (child already reaped out-of-band, PTY EOF without a tracked exit, or the event is dropped/missed because the listener attaches after emit), the registry row stays `Running`/`Idle` and the grid tile keeps rendering a green/working dot for a process that is gone. The frontend has no timeout or poll-based reconciliation — `fleetRefresh` only re-pulls on explicit Refresh or a `FLEET_REGISTRY_CHANGED` "added/updated".
- **Root cause**: Exit state transitions depend entirely on a single asynchronous reaper + a single event delivery, with no idempotent fallback. The registry is in-memory only (`OnceLock`), so there's also no reconciliation against the real OS process table on the live path (only the separate orphan scanner sees that, and it can't re-bind a writer to an orphan).
- **Impact**: Zombie tiles that look alive but accept no input; operator broadcasts/asks-Athena into them (see #2); the tile "leaks" in the grid until a manual Refresh. In the worst case a killed session lingers showing `awaiting_input`, drawing attention and OS notifications for work that's dead.
- **Fix sketch**: Have `fleet_kill_session` optimistically mark the row `Exited` (or `Exiting`) under the lock before returning, rather than waiting on the reaper, and emit the state change synchronously. Add a client safety net: when a kill/hibernate is requested, set a short timer that re-pulls the snapshot if no terminal event arrives.

## 5. `fleet_write_input` is an unvalidated, unauthenticated trust boundary — oversized / control-sequence broadcast injected verbatim into every PTY
- **Severity**: Low
- **Category**: Trust boundary / input validation
- **File**: `src-tauri/src/commands/fleet/commands.rs:45`
- **Scenario**: The broadcast textarea has no `maxLength`, and `fleet_write_input` does `writer.write_all(text.as_bytes())` with zero length cap or sanitization. An operator pasting a multi-megabyte blob (or a malformed transcript) broadcasts it to N PTYs, each a blocking `write_all` + `flush` on the command thread. Worse, the raw bytes — including ANSI/CSI escape sequences and an appended `\r` — are written straight into each interactive `claude` stdin, which auto-submits. Unlike the companion bridge command (`companion_record_fleet_event` calls `require_auth`), the fleet commands have **no** `ipc_auth::require_auth` gate at all.
- **Root cause**: No size/character validation at the IPC boundary and no auth check on the fleet command surface; the writer is treated as a trusted pipe.
- **Impact**: An oversized broadcast can stall the fleet and flood every agent's prompt; embedded escape/control sequences can corrupt the receiving terminals' rendering or inject unintended input. Low severity because it's a DEV-only local tool driven by the operator themselves, but it's an unguarded boundary that any future IPC exposure or scripted misuse would walk straight through.
- **Fix sketch**: Clamp broadcast/`write_input` text to a sane max (e.g. 64 KiB) and add a `maxLength` on the textarea; optionally strip or warn on raw control bytes the user didn't intend. Bring the fleet command surface under the same `require_auth` gate the companion commands use.
