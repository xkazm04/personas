# Bug Hunter — fleet-terminal-orchestration
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Kill / close / hibernate never terminates the child — interactive `claude` becomes a zombie shell
- **Severity**: critical
- **Category**: resource-leak
- **File**: src-tauri/src/commands/fleet/commands.rs:118-128 (also registry.rs:486-492 `close_pty_handles`, registry.rs:513-538 `hibernate`)
- **Scenario**: User spawns a Fleet session (interactive `claude`, no `-p`), then clicks Kill / closes the tile / it auto-hibernates. `fleet_kill_session` only does `*w = None; *m = None` — it drops the PTY writer and master. It never calls `child.kill()`. The `child` handle is owned exclusively by the reaper task (`pty.rs:280`, moved into `spawn_blocking`), and there is no kill path anywhere: a grep of the whole fleet module finds **zero** `child.kill()` calls (the only `.kill()` is sysinfo's, in `process_scan.rs:106`, for orphan PIDs). The code's own comment admits it (commands.rs:116-117): "in interactive mode it lingers but stops accepting input."
- **Root cause**: The design assumes closing the PTY master/writer makes `claude` exit on stdin EOF. That holds for `claude -p` but NOT for an interactive ConPTY session — Windows ConPTY keeps the child alive after the master closes, and interactive `claude` doesn't treat stdin EOF as quit. So Kill marks the row updated, the reaper's `child.wait()` blocks forever, and the real process keeps running (and keeps burning tokens / holding the OAuth session). Across a work session of spawn/kill cycles the machine accumulates orphaned `claude` processes reachable only via Task Manager — exactly the "orphan" condition `process_scan.rs` was built to clean up, manufactured by Fleet's own kill button.
- **Impact**: resource leak / data loss (token spend) — many concurrent zombie shells; eventually hits the STATUS_DLL_INIT_FAILED console-exhaustion ceiling Fleet itself documents (registry.rs:583).
- **Fix sketch**: Capture a kill handle at spawn (portable-pty exposes `Child::clone_killer()` / `ChildKiller`) and store it in `FleetSessionInner`. `fleet_kill_session` / `close_pty_handles` / `hibernate` must call `killer.kill()` (then drop the PTY handles) so termination is guaranteed regardless of how the child treats stdin EOF. Make "session closed ⇒ process dead" a class invariant rather than an EOF side-effect.

## 2. Hibernate clears `child_pid` before the process is confirmed dead — orphan becomes invisible to the scanner
- **Severity**: critical
- **Category**: state-corruption
- **File**: src-tauri/src/commands/fleet/registry.rs:530-536
- **Scenario**: Auto-hibernate (or manual) fires `hibernate()`. It immediately sets `session.child_pid = None` and drops writer+master, then returns. Because nothing actually kills the child (finding #1), the real `claude` PID keeps running — but Fleet has just erased the only record of which PID it was. `process_scan.rs:64-68` builds `tracked_pids` from `child_pid`, so the live orphan now reads as **untracked** the instant it's detected, and `fleet_detect_processes` flags it as a kill-me orphan even though Fleet "owns" it as a hibernated session.
- **Root cause**: `child_pid` is cleared on the *intent* to hibernate, not on *confirmed exit*. The reaper (the only place that knows the child really died) doesn't re-touch `child_pid`, so the window between hibernate-call and (never-arriving) child exit is unbounded.
- **Impact**: state corruption — the hibernated conversation's live process is mislabeled an orphan; a user "cleaning up orphans" kills a session Fleet thinks is safely asleep, and waking it (`fleet_wake_session` → `claude --resume`) then runs a *second* process against the same conversation.
- **Fix sketch**: Keep `child_pid` until the reaper confirms exit; clear it in `mark_exited`/the hibernation branch of `reaper_loop`, not in `hibernate()`. Combined with #1 (actually killing the child), the reaper will fire promptly and the PID record stays accurate for its whole lifetime.

## 3. Output ring lock is poisoned-and-recovered on every read — a panic in one consumer silently corrupts buffered scrollback
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/commands/fleet/pty.rs:439 (and registry.rs:411, 425, 441 — every `.lock().unwrap_or_else(|e| e.into_inner())`)
- **Scenario**: The hot reader path locks the ring with `.lock().unwrap_or_else(|e| e.into_inner())`. If any holder of that mutex ever panics while holding it (e.g. an allocation failure inside `VecDeque::drain`/`extend` during a 1M-token burst, or a panic in `snapshot()`/`preview_lines()` under memory pressure), the mutex is poisoned. `into_inner()` then *deliberately ignores the poison* and hands back the inner data — which may be mid-mutation (a partially-drained `VecDeque`). Every subsequent read keeps swallowing the poison, so a one-time corruption becomes permanent for the session's lifetime with no log, no error, no recovery signal.
- **Root cause**: Blanket `unwrap_or_else(|e| e.into_inner())` is applied uniformly as a "never panic" shortcut, conflating "don't crash the process" with "the data is fine." Poison is a real signal (a prior holder left invariants broken) that's being discarded everywhere.
- **Impact**: corruption / UX degradation — a focused terminal replays a garbled snapshot (truncated escape sequences mid-byte), previews render junk, and there's no breadcrumb pointing at the originating panic.
- **Fix sketch**: At minimum, `tracing::warn!` once when poison is observed so the corruption is diagnosable. Better: keep the `OutputRing` invariants panic-free by construction (the push/drain are simple), and reserve `into_inner()` recovery for the genuinely-poison-tolerant maps — don't apply it reflexively to buffers whose internal consistency matters.

## 4. Multiple panes attaching the same session share one terminal + one subscription refcount — detaching one blinds the other
- **Severity**: high
- **Category**: race-condition
- **File**: src/features/plugins/fleet/fleetTerminalManager.ts:374-387 (attach), 428-443 (detach); FleetTerminalPane.tsx:32-38
- **Scenario**: The manager keys exactly one `ManagedTerminal` (one xterm, one `holder`, one `fleet-session-output` listener, one subscribe/unsubscribe) per `sessionId`. `attachTerminal` moves the single `holder` DOM node into whatever container calls it. If two `FleetTerminalPane`s mount the same `sessionId` (e.g. the single-pane view not fully unmounted before the grid overlay tile mounts during a transition, or a future split view), the second `attach` `appendChild`s the holder out of the first container (the first pane goes blank), and when *either* pane unmounts, its cleanup calls `detachTerminal` → `unsubscribeTerminal`, killing the live IPC stream for the still-mounted pane. The backend subscription is a boolean, not a refcount (registry.rs:412 `set_subscribed(true)` / 426 `set_subscribed(false)`), so the last detach wins unconditionally.
- **Root cause**: One-holder-per-session and a boolean `subscribed` flag assume strictly one mount point per session at a time. The overlay relies on the parent unmounting the single pane first (FleetTerminalOverlay.tsx:47-48 comment), but that ordering is an implicit timing contract React does not guarantee across a portal mount during the same commit.
- **Impact**: UX degradation — a terminal silently stops receiving live output (looks hung) until the surviving pane is manually re-attached; transient blanking during overlay open/close.
- **Fix sketch**: Refcount attachments per `sessionId` in the manager; only `unsubscribeTerminal` when the count hits zero, and guard `attach` against stealing a holder that's already attached elsewhere (or clone the holder per mount). Make subscribe/unsubscribe a balanced counter on the Rust side too so it can't be flipped off while another viewer is live.

## 5. Transcript bind/orphan-resume matches by recorded `cwd` — can adopt or `--resume` the wrong conversation in a shared repo
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/commands/fleet/transcript_read.rs:457-468 (`latest_session_for_cwd`), process_scan.rs:117-138 (`fleet_resume_orphan`); transcript.rs:163-211 (`bind_unbound_by_cwd`)
- **Scenario**: A user runs two `claude` sessions in the same project — one Fleet-spawned, one launched manually from their own terminal. The manual one is the most-recently-active transcript for that cwd. User clicks "resume orphan" on the Fleet-detected manual PID: `fleet_resume_orphan` calls `latest_session_for_cwd(cwd)`, which returns the *newest mtime* transcript for that cwd — which may be a **third, unrelated** conversation that happened to write last, not the orphan they clicked. It then kills the clicked PID and spawns `claude --resume <some-other-session>`. The PID killed and the conversation resumed are decoupled — there is no link from the orphan PID to its actual transcript.
- **Root cause**: Re-adoption derives the conversation from cwd-newest-mtime instead of from the orphan process itself. cwd is not a unique key (Fleet explicitly allows N sessions per cwd, pty.rs:81-85), so "latest transcript for this cwd" is ambiguous exactly when multiple sessions share a repo.
- **Impact**: data loss / corruption — resumes/forks the wrong conversation, and concurrently two `claude` processes can end up appending to one transcript; the user's clicked orphan is killed regardless.
- **Fix sketch**: Resolve the orphan's own session id from its process (command-line `--session-id`/`--resume` arg, or its open transcript fd) rather than cwd-mtime. Where only cwd is available, refuse (or prompt) when >1 candidate transcript exists for the cwd instead of silently picking newest.

## 6. `is_claude_process` heuristic can match unrelated `node` processes → wrong-PID kill
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/fleet/process_scan.rs:46-54
- **Scenario**: Detection matches if the joined command line `contains("@anthropic-ai/claude")` or `"claude-code"`. Any unrelated process whose argv mentions that substring — a build watcher, a test runner, an editor language server, or a shell running `npm view @anthropic-ai/claude-code` — is surfaced as a "Claude CLI process." After an app restart the registry is empty so it reads as untracked/orphan and sorts to the top of the kill list; a user doing "clean up orphans" can `fleet_kill_pid` it. The kill in `fleet_kill_pid` (process_scan.rs:101-110) also re-resolves the PID via a fresh `System` scan with no identity re-check, so if the original PID was recycled between scan and kill, an unrelated process at that PID is killed.
- **Root cause**: Identification is pure string heuristic with no ownership proof, and the kill path trusts a raw PID across a time gap (TOCTOU) without re-confirming it's still the same process.
- **Impact**: UX degradation / data loss — killing the user's build/test/editor process; rare wrong-PID kill on PID reuse.
- **Fix sketch**: Tighten the heuristic (require the process *executable* to be node/claude AND the claude-code module path, not just a substring anywhere in argv) and exclude the app's own companion `-p` spawns by a known marker env var. In `fleet_kill_pid`, re-verify the process identity (name/start-time/cmdline) against what the scan reported before sending the kill.
