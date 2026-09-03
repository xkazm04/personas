---
slug: voicebox-peer-comparison
type: perfect/direction
context: "[[voicebox-peer-study]]"
lens: robustness
status: proposed
size: L
proposed: 2026-09-03
source: voicebox (jamiepine/voicebox)
source_commit: 51f49dea198384b4eb6087b72c17057c6eb1c1cd
run: intake-voicebox-0903
kind: peer-comparison
---

# Voicebox as a structural peer

Two local-first Tauri desktop apps that each supervise a heavyweight local sidecar,
each expose a machine-facing local surface for agents, each ship many locales, each
package native installers. Voicebox is ~4.5k lines of Rust shell + a frozen Python
FastAPI sidecar in three hardware variants + a React frontend shared with a web build.
Personas is a much larger Rust workspace (5 crates, ~90 local modules + ~150 in
`personas-engine`) with no Python at all.

Paths: source anchors are relative to the voicebox checkout root; peer anchors are
relative to `C:/Users/mkdol/dolla/personas`.

**49 points. Verdicts: keep ours 24 · adopt 11 · adapt 9 · different forces 5.**

Nothing below was written from the seed list alone; every point was opened on both
sides. Seven seeded claims were wrong about one tree or the other and are corrected
in place, marked **[CORRECTION]**.

---

## A. OS permissions and readiness

### A1. Two OS permissions modelled as two gates with asymmetric blast radius
Voicebox splits macOS TCC into two independent booleans and deliberately excludes one
from the "can I start" predicate, because Accessibility's absence only kills synthetic
paste — recording still works and the transcript still lands in Captures.

- source: `app/src/lib/hooks/useDictationReadiness.ts:10` (the four-gate union),
  `:85-90` (the `missing` list), `:90` (`canRecord = sttReady && llmReady && inputMonitoring`),
  `:29-45` (the docblock stating why Accessibility is excluded).
  Backed by `tauri/src-tauri/src/input_monitoring.rs:62-64` / `:70-72` and
  `tauri/src-tauri/src/accessibility.rs:30-32`.
- peer: `src/features/plugins/companion/useLocalDictation.ts:113-118` — one `supported`
  boolean that is a *capability* check (`getUserMedia` exists, `AudioContext` exists),
  not a permission check. Its own docblock at `:17-20` admits the collapse: "Engine
  readiness (binary installed, model downloaded) is NOT reflected in `supported`."
  Microphone permission, whisper-binary presence and model-download state all resolve
  to a single generic `error` string after the first failed attempt (`:218`, `:221`).

**adopt.** This is the strongest transferable idea in the source. Personas has exactly
the same shape — three independent preconditions for one user action — and currently
tells the user nothing about which one is missing. The source's contribution is not
"check permissions"; it is *splitting the predicate by blast radius* so a partial grant
still yields a partially working feature instead of a hard block. `useLocalDictation`
has three separable gates and one boolean.

### A2. Permission state reconciled on window focus
The grant can change outside the app; the only reliable signal is the user coming back.

- source: `app/src/components/AccessibilityGate/AccessibilityGate.tsx:43-51` and
  `app/src/components/InputMonitoringGate/InputMonitoringGate.tsx:40-46` — both mount a
  `window.addEventListener('focus', recheck)`.
- peer: **no permission or OS-readiness state is re-checked on focus.** The focus
  listeners that exist all refetch application *data*:
  `src/features/vault/sub_credentials/manager/VaultTrustBadge.tsx:40`,
  `src/features/home/sub_cockpit/CockpitPanel.tsx:121`,
  `src/features/teams/sub_factory/l2/ship/useShipLive.ts:44`,
  `src/stores/devToolsLiveStore.ts:39`. `WindowEvent::Focused` is handled nowhere in
  Rust — the only two `on_window_event` handlers are
  `src-tauri/src/commands/infrastructure/auth.rs:503-504` and `:625-626`, both
  `CloseRequested` on the OAuth popup.

**adopt.** The mechanism is already built and battle-tested here — `useShipLive.ts:41-43`
carries the exact comment about wiring both `visibilitychange` and `focus` because
desktop app-switch often produces only the latter. Nothing prevents the notification
permission from riding the same subscription; today
`src/features/plugins/gitlab/hooks/usePipelineNotifications.ts:86-99` caches the grant
in a ref for the component's whole lifetime and never re-asks.

### A3. Deep link to the exact OS settings pane
- source: `tauri/src-tauri/src/main.rs:1149-1163` (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`)
  and `:1169-1183` (`?Privacy_ListenEvent`), both via `app.shell().open`.
- peer: **none found, and the scheme class is actively blocked.**
  `src/lib/utils/sanitizers/sanitizeUrl.ts:84` sets
  `SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:'])`, enforced at `:110`, with a
  regression test asserting `sanitizeExternalUrl('ms-settings:privacy') === null` at
  `src/lib/utils/sanitizers/__tests__/sanitizeUrl.test.ts:46`. The Rust side agrees:
  `src-tauri/src/commands/infrastructure/system/mod.rs:18-24` rejects anything not
  `http(s)://`, and `:39-42` records that `tauri-plugin-shell` is deliberately not
  shipped at all. Searched: `systempreferences`, `ms-settings`, `shell.open`, `opener`,
  `open -a`.

**different forces.** The source needs this because it has a permission to repair;
Personas has no permission-repair flow to send a user to, and its URL allowlist is a
deliberate, tested security boundary that this would have to be punched through. If A1
lands, revisit — but the correct shape here would be a narrow Rust command with a
hardcoded pane URI, never a widening of `sanitizeExternalUrl`.

### A4. Entitlements and usage descriptions declared in the bundle
- source: `tauri/src-tauri/Entitlements.plist:11` declares
  `com.apple.security.device.audio-input`, alongside JIT/unsigned-memory/library-validation
  relaxations for the frozen Python payload (`:5-9`); wired at
  `tauri/src-tauri/tauri.conf.json:27-28`.
- peer: `src-tauri/tauri.conf.json` `bundle.macOS` has `"entitlements": null`,
  `"signingIdentity": null`, `"frameworks": []`. No entitlements file exists in the tree,
  so no `NSMicrophoneUsageDescription` is injected — yet
  `src/features/plugins/companion/useLocalDictation.ts:191-192` calls `getUserMedia`.

**adapt.** The source's specific entitlements are for its Python sidecar and don't
apply. But the *audio-input* declaration does: `docs/development/release.md:53-59`
already lists "no OS code signing" as a known gap, and a mic-using unsigned app on
macOS is a shipping hazard independent of signing. Adapt = add the entitlements file
and the usage description when the signing gap is closed, not before.

### A5. A permission failure that names the permission
- source: `app/src/components/InputMonitoringGate/InputMonitoringGate.tsx:96` renders a
  distinct "recheck" affordance and a settings link off the failed gate; the readiness
  hook hands the UI `missing: ReadinessGate[]`
  (`app/src/lib/hooks/useDictationReadiness.ts:17`, `:85-89`).
- peer: `src/features/plugins/companion/useLocalDictation.ts:218` routes the real error
  to `silentCatch` and `:221` collapses everything to `err.message` or `'mic_denied'`.
  The only user-facing string in the area is
  `src/i18n/section-locales/en/plugins.json:2158` — "Microphone capture is unavailable,
  so the local engine cannot run here."

**adopt.** Same mechanism as A1, stated at the copy layer. A user who denied the mic
prompt and a user who never downloaded the whisper model currently read the identical
sentence.

---

## B. Overlay window and long-lived streams

### B1. Overlay hidden by park-off-screen + click-through, not `hide()`
- source: `tauri/src-tauri/src/main.rs:1417-1435` — the `dictate:hide` listener does
  `set_ignore_cursor_events(true)`, then `set_position(-10_000, -10_000)`, then `hide()`,
  with `:1417-1424` recording why: on macOS a transparent always-on-top NSWindow lingers
  as an invisible click target after `hide()` and steals focus to Voicebox when the user
  clicks where it used to be.
- peer: **no OS-level always-on-top, click-through, or secondary overlay window exists.**
  `src-tauri/tauri.conf.json` `app.windows` has exactly one entry (`main`). Grepped
  `always_on_top`, `set_always_on_top`, `skip_taskbar`, `set_ignore_cursor_events` across
  `src-tauri/**/*.rs` and `setAlwaysOnTop`/`setIgnoreCursorEvents` across `src/` — zero
  hits. The orb is a CSS layer:
  `src/features/plugins/companion/orb/AthenaOrbLayer.tsx:196`
  (`pointer-events-none fixed inset-0 z-[210]`), hidden by conditional render at `:32-37`.
  The only genuine move-off-screen is a DOM iframe, not a window
  (`src-tauri/src/radio/mod.rs:1-8`).

**keep ours.** The source's constraint is an NSWindow lifecycle bug that only exists once
you own a transparent always-on-top window. Personas' orb deliberately lives inside the
one webview, which is why it needs no hide dance and cannot steal focus. The two
`WebviewWindowBuilder` sites here (`src-tauri/src/commands/infrastructure/auth.rs:444-487`,
`:573-600`) are short-lived modal OAuth popups where focus-stealing is correct. If an
always-on-top companion window is ever built, this point becomes `adopt` verbatim.

### B2. The show path deliberately omits `set_focus()`
- source: `tauri/src-tauri/src/hotkey_monitor.rs:271-273` — "Deliberately no `set_focus()`
  — taking key focus would yank it out of whatever app the user was typing in, which is
  the opposite of what a dictation overlay should do." Mirrored in
  `tauri/src-tauri/src/main.rs:118-120` (`show_dictate_window`).
- peer: every show path calls `set_focus()`, and correctly so:
  `src-tauri/src/tray.rs:27-31` (tray click), `:138-146` (show/hide menu item),
  `src-tauri/src/commands/companion/voice_hotkey.rs:96-100` (hotkey fire, documented at
  `:23-27` as copied from the tray), `src-tauri/src/test_automation.rs:144-148`
  (`force_foreground`, needed at `:141-143` because an occluded webview drops `eval`'d JS).

**different forces.** The source's overlay must never take focus because its whole job is
to paste into the app the user was already typing in. Personas' hotkey path exists to
*bring the user to Athena* — focus-stealing is the feature. The transferable half is the
distinction itself: a future ambient/pill surface must not reuse the `voice_hotkey.rs:96-100`
three-call sequence.

### B3. A long-lived stream owned by Rust, not by a hidden webview **[CORRECTION]**
- source: `tauri/src-tauri/src/speak_monitor.rs:1-28` — Rust subscribes to the backend's
  `/events/speak` SSE stream and fans out over Tauri's event bus, because "hidden WebKit
  windows on macOS throttle long-lived network connections, so speak events never reached
  the pill." Idle budget 45 s (`:38-42`) against a backend `:ping` every 15 s
  (`backend/routes/events.py:36-39`); escalating backoff to a 30 s cap (`:36-37`, `:82-85`);
  a productive round resets backoff (`:65-69`).
- peer: **the seed was wrong that `radio/` and `notifications.rs` are stream owners.**
  `src-tauri/src/radio/service.rs:34-39` owns a *station catalog and playback state*, not
  a connection — grepping `reqwest`, `EventSource`, `text/event-stream`, `WebSocket`,
  `tokio_tungstenite` across `radio/`, `notifications.rs` and `stream_harness.rs` returns
  zero hits. Audio playback is a YouTube iframe in the webview
  (`src/features/plugins/radio/hooks/useYouTubePlayer.ts:106-113`).
  `src-tauri/src/stream_harness.rs:1-31` is a `#[cfg(debug_assertions)]` diagnostic for
  whether Tauri's custom-protocol path streams or buffers — the opposite direction.
  The peer's real long-lived Rust-side connection is the browser-bridge WebSocket
  (`src-tauri/src/browser_bridge/relay.rs:77-94`), which is inbound.

**keep ours.** Personas has no hidden webview, so the throttling constraint that forces
the source's design does not exist. But two sub-mechanisms are worth lifting on their own
merits — see B4.

### B4. Idle-timeout as the liveness signal for an infinite stream
- source: `tauri/src-tauri/src/speak_monitor.rs:23-28` names the exact failure it guards:
  "a backend that accepts the TCP connection but stops producing frames (deadlocked SSE
  endpoint, zombie process). Without a timeout the `chunk().await` blocks forever and the
  task never notices." Implemented at `:109-120` as a `tokio::time::timeout` around each
  `resp.chunk()`, not around the request.
- peer: `src-tauri/src/browser_bridge/relay.rs:36` bounds the relay queue at 256 frames,
  but there is no per-read idle timeout on the socket; a peer that connects and goes silent
  holds the single-slot session until its 30-minute TTL
  (`src-tauri/src/browser_bridge/mod.rs:48`, `:135-141`). The nearest equivalent elsewhere
  is `src-tauri/engine/src/cli_process.rs:221`, a per-`fill_buf` watchdog on the CLI reader.

**adapt.** `cli_process.rs:221` proves the pattern is already understood here; the gap is
that the browser-bridge socket did not get it. Adapt = a per-frame read deadline on the
relay, sized against whatever the extension's heartbeat actually is. The source's 3× ratio
(45 s budget / 15 s heartbeat) is a reasonable starting constant.

### B5. Holding the OS audio session open with a silent loop
- source: `app/src/components/AudioPlayer/AudioKeepAlive.tsx:4-11` — WKWebView tears down
  the app's CoreAudio output when idle and a JS reload does not restore it, so a silent
  looping `<audio>` runs forever. `:9-11` records that *real* silence at full volume is
  used rather than a muted element, because WebKit optimizes muted media away and that
  defeats the purpose. Mounted app-wide at
  `app/src/components/AppFrame/AppFrame.tsx:30`.
- peer: no equivalent. Audio output is the radio's YouTube iframe
  (`src/features/plugins/radio/hooks/useYouTubePlayer.ts:106-113`) and the TTS sidecar
  (`src-tauri/src/companion/tts/pocket.rs:350-357`), which writes files rather than holding
  a session. Searched `keepalive`, `keep-alive`, `AudioContext`, `silent`, `<audio` under
  `src/features/plugins/radio` and `src/features/plugins/companion`.

**keep ours.** The bug is WKWebView-specific and Personas ships on Windows first; the
radio's iframe holds its own session while playing. Recorded because if a macOS build ever
reports "audio stops working until relaunch", this is the known cause and the fix is four
lines.

---

## C. Sidecar supervision — the richest area, and the seed had it backwards

### C1. Health probe that asserts a schema, not a status code **[CORRECTION]**
- source: `tauri/src-tauri/src/main.rs:167-200` — `check_health` requires
  `status == "healthy"` **and** `model_loaded` present as a boolean **and**
  `gpu_available` present as a boolean, with `:170-173` stating the reason: "This prevents
  misidentifying an unrelated service that happens to expose a `/health` endpoint."
- peer: the peer *publishes* a discriminating schema and then throws it away.
  `src-tauri/src/engine/webhook.rs:189-208` returns
  `{status, service, management, headlessBridge}`, and `:186-188` explains that
  `management` exists precisely so a caller learns which route table bound rather than
  inferring it from a 404. But the only consumer,
  `src-tauri/src/commands/credentials/mcp_tools.rs:32-56`, sets `live = status.is_success()`
  at `:50` and reads no field. Net effect: the Settings chip reads "Running" for a
  degraded webhook-only boot where every `/api/*` route 404s.

**adopt.** This is a two-line change against a schema the peer already designed, and it
closes a wrong-answer bug that is live today. The source earned this the hard way; the
peer built the mechanism and forgot to read it.

### C2. Adopt-or-spawn: what identity actually means **[CORRECTION]**
The seed credited the source with schema-asserted adoption. That is only the *fallback*.

- source: the primary adopt path is **process-name matching, with no health check at all.**
  `tauri/src-tauri/src/main.rs:301-307` (unix): if `lsof`'s command column contains
  "voicebox", adopt immediately. `:336-340` (Windows): if `tasklist` reports "voicebox" for
  the PID owning the port (`find_voicebox_pid_on_port`, `:133-165`), adopt immediately.
  `check_health` is consulted only when the name does *not* match (`:311-316`, `:343-347`).
  So the schema assertion guards the stranger case and not the common one — a stale
  voicebox-named binary from a prior version is adopted on its name.
- peer: **there is no adopt path anywhere.** `src-tauri/src/engine/background/lifecycle.rs:515-548`
  probes `:9420` by attempting a throwaway `TcpListener::bind` up to 72 times at 5 s
  intervals; it is a *wait-for-free*, and if something else holds the port it logs and lets
  the bind fail (`:541-543`) without ever probing `/health` on the incumbent. `local_http`
  scans for a free port instead (`src-tauri/src/local_http/mod.rs:241-254`).
  The daemon's exclusion is a heartbeat lock file, not a port
  (`src-tauri/src/daemon/lock.rs:57`, `:184-216`).

**keep ours.** Wait-for-free is the safer default and it is the right one for a port whose
route table is decided by this process's own state
(`lifecycle.rs:493-514`). Adopting an incumbent would mean inheriting a route table you did
not build. The source needs adoption because its "keep server running after close" feature
makes a live orphan the *expected* state; Personas has no such feature.

### C3. Child-side parent-PID watchdog
- source: the sidecar watches its parent rather than being killed by it.
  `tauri/src-tauri/src/main.rs:548` passes `--parent-pid`, consumed at
  `backend/server.py:114-235`. The docblock at `:115-124` gives the reason: "instead of the
  Tauri app trying to forcefully kill the server (which spawns console windows on Windows),
  the server monitors its parent and shuts itself down gracefully." `:224-230` even picks
  `os._exit(0)` over `SIGTERM` on Windows so uvicorn's shutdown handlers run.
- peer: **no child-side watchdog exists.** Grepping `PERSONAS_PARENT_PID`, `parent-pid`,
  `parentPid`, `getppid`, `process.ppid` across the **whole repository** (all file types,
  excluding `node_modules/` and `target/`) returns zero matching files — the claim was
  first made at `src-tauri` scope and has since been re-run repo-wide, because an absence
  established from a narrower scope is not an absence. No spawned process is told its
  parent's PID: not the Fleet PTY children, not the sherpa/whisper/Kokoro/Pocket sidecars,
  not the dev server, not the MCP binary. Orphan prevention is entirely parent-side and
  best-effort: tree kills (`src-tauri/src/engine/execution.rs:1533-1537`,
  `src-tauri/src/webbuild/devserver.rs:218-237`), two `kill_on_drop(true)` sites
  (`src-tauri/src/companion/tts/pocket.rs:416`, `src-tauri/src/commands/artist/mod.rs:656`),
  and the `RunEvent::Exit` hook, which covers dev servers only
  (`src-tauri/src/lib.rs:2161-2164`). If the desktop is force-killed that hook never runs,
  and every recovery is next-launch and lane-scoped: the stale dev lock
  (`devserver.rs:244-254`), the user-driven `fleet_detect_processes` / `fleet_resume_orphan`
  pair (`process_scan.rs:58`, `:153`), and a 90 s heartbeat staleness on `daemon.lock`
  (`daemon/lock.rs:57`). **Nothing sweeps CLI children tracked only in
  `ActiveProcessRegistry`** — that gap stands unqualified at repo scope.
  Children are OS-orphaned on exit; the mitigation is handle hygiene, not lifecycle —
  `src-tauri/src/engine/webhook.rs:740-758` clears `HANDLE_FLAG_INHERIT` on the listener
  socket because a child outliving a killed desktop kept the `:9420` LISTEN handle alive,
  "a ghost owned by a dead PID that no restart can bind past" (`:733-739`).

**adapt.** The `webhook.rs:733-739` incident is exactly the class of bug a parent-PID
watchdog prevents, and it happened twice. But a blanket adoption is wrong here: Fleet PTY
sessions are *meant* to survive in some states (`src-tauri/src/commands/fleet/pty.rs:968-981`
keeps dozing/hibernating sessions), and the user can legitimately want a CLI run to outlive
the window. Adapt = pass a parent PID to spawned children that have no independent reason to
live (design/review/negotiation runs tracked in `ActiveProcessRegistry`), not to Fleet
sessions.

### C4. A sentinel file because the HTTP shutdown races process exit
- source: `tauri/src-tauri/src/main.rs:1592-1622` writes `.keep-running` to the data dir
  *before* firing `POST /watchdog/disable`, with `:1597-1600` naming the race: "On Windows
  the HTTP request below can race with process exit, leaving the watchdog unaware it should
  stay alive." The child then resolves the race in three layers —
  `backend/server.py:198-200` (flag already set), `:206-210` (1 s grace period re-check),
  `:215-222` (sentinel on disk) — and `:184-196` wipes a stale sentinel at startup so a
  future session cannot inherit the signal.
- peer: no analogous sentinel. The nearest shape is
  `src-tauri/src/webbuild/devserver.rs:244-254`, which reads `.next/dev/lock` to recover an
  orphaned Bun/Next server — a PID file for *recovery*, not a signal for *intent*.

**adapt.** The three-layer resolution is over-engineered for anything Personas ships today,
because Personas has no "keep running after close" mode to signal. The genuinely portable
half is `server.py:184-196`: **a sentinel must be invalidated at startup or it becomes a
stale command.** `daemon/lock.rs:184-199` already applies that discipline to the daemon
lock; the local-http handshake file does not — `local_http/auth.rs:113-136` reads a token
back from `~/.personas/local-http.json` with no freshness check, and the port drift it
causes is patched downstream at `src-tauri/src/boot/services.rs:107-131` rather than at the
source.

### C5. Rejecting a dead-but-bound listener
- source: `check_health` (`tauri/src-tauri/src/main.rs:175-200`) is a real HTTP round-trip;
  port occupancy alone is explicitly not identity (`:167-173`).
- peer: `src-tauri/src/webbuild/devserver.rs:193-213` — `http_responds` writes a real
  `GET / HTTP/1.0` and requires the response to begin with `HTTP`, with `:187-192` stating
  "a dead-but-bound server is never adopted". Surfaced as `DevServerStatus.healthy` (`:37`)
  through `status` (`:122`) and `list` (`:143`).

**keep ours.** Both trees reached the same conclusion independently and the peer's version
is stricter — it validates the wire protocol, not just a JSON body. Listed so C1's fix is
understood as bringing `mcp_tools.rs` up to the standard `devserver.rs` already sets, not as
importing something new.

### C6. PID-recycling guard before killing a PID from a file
- source: no equivalent. `tauri/src-tauri/src/main.rs:1631-1643` kills the stored
  `server_pid` (and its process group) on exit without re-verifying that the PID is still
  the process it was; `find_voicebox_pid_on_port:151-158` verifies by name, but only at
  discovery time, not at kill time.
- peer: `src-tauri/src/webbuild/devserver.rs:248` kills the PID from `.next/dev/lock`
  **only if** `pid_is_node(pid)` still holds (`:267-281` via `tasklist`, `:284-290` POSIX).

**keep ours.** Peer is ahead. A PID read from a file is a PID from an unknown point in the
past; the peer treats it that way and the source does not.

### C7. Graceful shutdown ordering on app exit
- source: `tauri/src-tauri/src/main.rs:1586-1645` — one `RunEvent::Exit` arm that branches
  on `keep_running`, writes the sentinel, disables the watchdog over HTTP, and on Unix
  escalates SIGTERM → SIGKILL to the process group (`:1633-1642`).
- peer: `src-tauri/src/lib.rs:2159-2166` — `RunEvent::Exit` calls
  `state.webbuild_servers.stop_all()` **and nothing else.** There is no `ExitRequested`
  handler and no `CloseRequested` handler on the main window. Fleet PTY children, the
  webhook server's shutdown channel, and every CLI child in `ActiveProcessRegistry` are left
  to OS teardown.

**adopt.** Not the source's specific sequence — the *existence* of an ordered teardown. The
peer already pays for this gap: `webhook.rs:733-739` documents ghost listeners surviving a
killed desktop, and `src-tauri/src/commands/fleet/process_scan.rs:34-37` exists because the
registry is empty after a restart so every child reads as an orphan. One `RunEvent::Exit`
arm that drains `ActiveProcessRegistry` and signals the webhook server would remove both.

### C8. Startup orphan sweep for rows a dead process left running
- source: one sweep, in SQL, at boot: `backend/app.py:297-321` —
  `UPDATE generations SET status='failed', error='Server was shut down during generation'
  WHERE status IN ('generating','loading_model')`. Note this is in `app.py`, not in
  `task_queue.py` as the seed placed it.
- peer: four sweeps, all more careful.
  `src-tauri/src/engine/persona_jobs.rs:192-210` (`recover_orphans`, stamps
  `[orphaned by process restart]` into the existing error text rather than overwriting),
  called at `src-tauri/src/boot/workers.rs:220`;
  `src-tauri/src/companion/jobs/mod.rs:170-193`, called at
  `src-tauri/src/commands/companion/mod.rs:201`;
  `src-tauri/src/companion/remote_jobs.rs:417-429`, which returns the transitioned jobs
  rather than a count so the closing memory note is exactly-once (`:406-416`);
  `src-tauri/src/engine/execution.rs:500-529`, which deliberately leaves `queued` rows alone
  because they are durable work (`:490-499`).

**keep ours.** Peer is ahead on every axis, and one peer mechanism has no source counterpart
at all: `src-tauri/src/boot/recovery.rs:39-46` defers the entire recovery phase when another
instance holds leadership, because a follower's state-keyed sweep would mark the *leader's
live work* failed (`:10-32`). Voicebox is single-instance-by-assumption and never had to
solve that.

---

## D. Job queue and the terminal-status invariant

### D1. Forcing a terminal status when the worker bails **[CORRECTION]**
The seed described "the worker force-fails a row whose coroutine exited without writing a
terminal status." It force-fails a row whose coroutine **raised**. A coroutine that returns
cleanly without writing a status is not covered.

- source: `backend/services/task_queue.py:57-62` — `_force_fail_if_active` is called from
  the `except Exception` arm only. The `finally` block (`:63-66`) does bookkeeping and no
  status write. `_force_fail_if_active` itself (`:69-93`) is correctly conditional: it
  re-reads the row and returns early unless the status is still `loading_model`/`generating`
  (`:82-83`), so it cannot clobber a real terminal status.
- peer: `src-tauri/engine/src/execution_engine/persist.rs:138-200` —
  `persist_status_if_not_final` retries with doubling backoff (`:145-175`) and, after
  exhausting retries, **dead-letters through the same conditional writer** rather than
  forcing `Failed`, with `:187-193` stating that an unconditional force "would clobber a
  concurrent real Completed/Cancelled and defeat the 'if not final' guarantee this function
  exists to provide." The panic boundary at `src-tauri/src/engine/execution.rs:911`,
  `:976-996` routes through it, and `:900-905` names the bug it prevents: a panic would
  permanently leak a `ConcurrencyTracker` slot and block every future execution for that
  persona until restart.

**keep ours.** The peer's version is strictly stronger and it reasons about the same
clobbering hazard the source's `:82-83` guard addresses, one layer deeper. Worth recording
that both trees converged on "conditional write, never force" independently.

### D2. The clean-return gap, on both sides
- source: `backend/services/task_queue.py:63-66` — a coroutine that returns without a
  terminal write leaves the row at `generating` until the next boot sweep
  (`backend/app.py:306`).
- peer: `src-tauri/src/background_job.rs:618-633` — `spawn_job`'s panic arm writes `failed`,
  but the completion path is unwrapped; a task that returns without `set_status` sits at
  `running`. The only backstop is `sweep_stale_running` (`:242-269`, 600 s + 30 s grace),
  and it is **poll-driven only** — its four call sites (`:533`, `:552`, `:576`, `:591`) are
  all read paths, with no background ticker. A job nobody polls is never swept.
  Separately `src-tauri/src/engine/persona_jobs.rs` has no runtime stale sweep at all;
  a job that hangs mid-dispatch sits at `running` until the next process restart.

**different forces — and the same bug.** Neither tree closes it, and neither can close it
the same way: the source's boot sweep works because its rows are in SQLite, while
`background_job.rs`'s store is an in-memory `OnceLock<Mutex<HashMap>>` (`:157`) that cannot
survive to be reconciled. Recorded as a paired finding, not a transfer. The peer-side fix is
a background ticker for `sweep_stale_running`, which the source cannot suggest.

### D3. Cancel path that is actually reachable
- source: `backend/services/task_queue.py:105-117` — `cancel_generation` cancels a running
  `asyncio.Task` or removes a queued id, returning `"running"`/`"queued"`/`None`; the worker
  honours the cancelled set at `:44-47`. Covered by a test
  (`backend/tests/test_task_queue_cancellation.py`).
- peer: `src-tauri/src/engine/persona_jobs.rs:234` reads `cancel_requested` and `:274-284`
  implements `mark_canceled` — **but nothing ever writes `cancel_requested`.** Grepping the
  whole tree, the only hits are the column definition
  (`src-tauri/db/src/migrations/incremental/e05_twin_and_memory_review.rs:207`) and the reads
  at `persona_jobs.rs:72,91,99,234,264,267`. `src-tauri/src/commands/core/persona_jobs.rs`
  (116 lines) exposes enqueue and schedule commands and no cancel. The `canceled` state is
  unreachable.

**adopt.** Not the source's implementation — the source's *property*, that a declared
terminal state has a writer and a test. The peer's execution-engine cancel path is excellent
by contrast (`src-tauri/src/engine/execution.rs:1038-1126`, six ordered steps with a 5 s
grace and a second child-PID reap at `:1092-1117`); `persona_jobs` simply never got one.

### D4. A panic boundary on the worker loop
- source: `backend/services/task_queue.py:57-62` — the worker's `except Exception` arm keeps
  the `while True` loop alive; a failing job cannot stop the queue.
- peer: asymmetric. `src-tauri/src/commands/companion/mod.rs:133-165` wraps the tick in
  `AssertUnwindSafe(..).catch_unwind()` with an explicit continue arm at `:155-159`. But
  `src-tauri/src/boot/workers.rs:226-242` is a bare `spawn` around
  `loop { worker_tick(..) }` with only an `Err` match arm (`:236-238`) — a panic inside
  `worker_tick` kills the task permanently, stranding the current row at `running` **and
  stopping the persona-job queue for the rest of the process lifetime.**

**adopt.** The fix already exists twelve files away at `commands/companion/mod.rs:146-159`;
this is a copy, not a design.

### D5. Serializing the expensive accelerator
- source: `backend/services/task_queue.py:1-3` and `:39-66` — one global serial queue,
  concurrency 1, "to avoid GPU contention". Coarse but unambiguous.
- peer: layered and per-resource. Two single-permit semaphores, deliberately separate so one
  piper and one whisper may overlap — `src-tauri/src/boot/mod.rs:181-182` with the rationale
  at `:177-180`; consumed via `acquire_owned` at
  `src-tauri/src/commands/artist/voiceover.rs:83-89` ("one Kokoro subprocess reloads the
  ~310MB model, so unbounded concurrency would thrash", `:80-81`) and
  `src-tauri/src/commands/companion/stt.rs:54-59`. Admission control for executions is a
  hand-rolled tracker rather than a semaphore —
  `src-tauri/engine/src/queue.rs:10` (`GLOBAL_MAX_CONCURRENT = 4`), TOCTOU-safe
  `try_add_running` at `:243`, with a load-based governor on top
  (`src-tauri/src/engine/resource_governor.rs:27-34`, asymmetric hysteresis 70/55 CPU,
  85/70 memory).

**keep ours.** The source's constraint is one GPU and one model in one process. Personas'
expensive resources are heterogeneous (subprocess model loads, API rate limits, host CPU)
and a single global queue would serialize things that have no reason to contend. The
per-resource split plus `AdmitOutcome::Queued.displaced` (`queue.rs:61-67`, "an evicted
waiter that finds out by silence is a data-loss bug") is a strictly richer model.

---

## E. Per-engine and per-provider variance

### E1. Engine variance as declarative data read by one shared pipeline
- source: `backend/backends/__init__.py:48-61` — `ModelConfig` carries boolean quirk flags
  (`needs_trim`, `retries_runaway`, `supports_instruct`) alongside identity fields.
  Accessors at `:506-511` and `:514-519` resolve a flag by engine name, and one shared
  pipeline consumes them: `backend/services/generation.py:301-302` turns each flag into an
  optional function (`trim_fn`, `runaway_detector`) passed into `gen_kwargs` at `:304-310`.
  Ten engine modules, one code path.
- peer: **no capability or quirk table exists.** Grepped `quirk` (zero hits), `ModelConfig`
  (zero), `supports_` (one hit, the trait method `supports_session_resume` at
  `src-tauri/engine/src/provider/mod.rs:55`), `max_tokens`/`reasoning` (no request-builder
  hits; `src-tauri/src/engine/http_engine/openai.rs:20-27` `ChatRequest` carries neither).
  Variance is carried by (a) a trait with exactly one impl
  (`provider/mod.rs:45-100`, `resolve_provider` a one-arm match at `:107-111`), (b) `match`
  on lowercased provider strings (`src-tauri/src/engine/http_engine/config.rs:24-29`,
  `src-tauri/engine/src/prompt/cli_args.rs:19-28` which has only a `_` arm), (c) const string
  tables (`src-tauri/core/src/model_ids.rs`, `CLAUDE_MODEL_CHAIN` at
  `src-tauri/src/engine/failover.rs:639-643`), (d) a runtime probe
  (`src-tauri/engine/src/cli_capabilities.rs:31-48`), and (e) a 10×1 boolean table in
  TypeScript (`src/features/settings/sub_engine/libs/engineCapabilities.ts:114-125`).

**adapt.** The source's shape does not transfer wholesale — `EngineKind` has one variant
(`src-tauri/core/src/engine_kind.rs:19-21`) and `failover.rs:650-671` is candid that the
system "often behaves as a breaker-gated single-candidate probe." A quirk table for one
provider is ceremony. What *does* transfer is the discipline the source's shape enforces:
today the peer's five definition points must be edited in lockstep, and the only thing
holding them together is a prose checklist at `engineCapabilities.ts:17-26`. Adapt = when a
second `EngineKind` variant lands, unify (a)–(e) behind one table before adding branches.

### E2. A quirk computed from the runtime backend, not the engine identity
- source: `backend/backends/__init__.py:226-238` — `retries_runaway` is derived from
  `get_backend_type() == "mlx"`, with `:236-237` explaining that mlx-audio can continue past
  an EOS miss with silence and codec noise. The same *engine* (`qwen`) gets different
  behaviour on different hardware. Pinned by test:
  `backend/tests/test_qwen_runaway_retry.py:17-18` asserts
  `engine_retries_runaway("qwen") is True` under mlx and `:23-24` `is False` otherwise.
- peer: the peer *has* this idea and implements it better for its own case.
  `src-tauri/engine/src/cli_capabilities.rs:66-110` — `Workflow` is Max/Team tier-gated, so
  capability is *observed* by spawning `claude -p`, reading the `system/init` event and
  killing the child, cached in a `LazyLock` (`:51-63`) with a 30 s probe timeout (`:26`).
  Rationale at `:1-12`.

**keep ours.** A runtime probe is strictly more honest than a static table keyed on backend
type, and the peer already pays the cost. Recorded because the source's `:238` is the same
insight — *variance belongs to the runtime, not the nameplate* — reached from the opposite
direction, and the peer's `engineCapabilities.ts:114-125` static table is still the layer
that has not absorbed it.

### E3. A retired-identifier list with a lint that enforces the front door
- source: no equivalent. Model ids are string literals in per-backend `MODEL_CONFIGS`
  (`backend/backends/__init__.py:240-250` and siblings); a retired HF repo id would be found
  at download time.
- peer: `src-tauri/core/src/model_ids.rs:51-60` — an append-only `RETIRED: &[&str]` plus
  `is_retired()`, with the module doc at `:1-21` recording the incident: 54 files spelled the
  literals, Anthropic retired two ids, `failover.rs` kept handing them out and every laddered
  run 404'd. Enforced by a census rule `bare-model-id-literal`
  (`scripts/census/rules.json:19-21`). Compile-time exhaustiveness on the enum itself at
  `src-tauri/core/src/engine_kind.rs:37-48`.

**keep ours.** Peer is ahead. Listed as an inverse entry.

---

## F. The machine-facing local surface

### F1. No authentication on the agent-facing surface
- source: **stated as a non-guarantee, in user-facing docs.**
  `docs/content/docs/overview/mcp-server.mdx:255-260`: "Localhost only… **No auth today.**
  Any process that can connect to your loopback can call MCP." Mirrored at
  `docs/content/docs/developer/architecture.mdx:249-251`. The only per-caller identity is a
  self-asserted header used purely for attribution —
  `backend/mcp_server/context.py:75-95` copies `X-Voicebox-Client-Id` into a ContextVar and
  stamps `last_seen_at`; it authorizes nothing.
- peer: three independent gates.
  `src-tauri/src/ipc_auth.rs:54-59` mints 32 CSPRNG bytes at startup;
  `wrap_invoke_handler` (`:602-652`) rejects before dispatch and **fails closed** on every
  error path (`:611-627`); comparison is constant-time (`:655-664`). Command tiering at
  `:812-830`. On the HTTP side, `src-tauri/src/local_http/auth.rs:240-285` applies a shared
  secret with a constant-time compare (`:154-165`) plus a Host allowlist (F2).

**keep ours — inverse list entry.** The peer is decisively ahead, and the gap is not
accidental: `src-tauri/src/local_http/mod.rs:86` applies the guard over the *composed* router
so new routers inherit it (rationale `:84-86`), and `mod.rs:399-419` drives a real socket in
a regression test. What the source has that the peer does not is the *written* non-guarantee.
See F5.

### F2. Host-header validation as DNS-rebinding defence
- source: none. `backend/app.py:178-193` configures CORS with an explicit local origin list
  (`:180-186`), which is not a Host check; a rebinding attack supplies its own Origin or
  none. No middleware validates `Host`.
- peer: `src-tauri/src/local_http/auth.rs:241-262` — allowlist `["127.0.0.1","localhost","::1"]`
  (`:173`), IPv6-bracket-aware split (`:176-188`), port compared against the bound port when
  present (`:205-208`), missing `Host` with no HTTP/2 authority → 403 (`:251-254`). Applied
  even to the token-exempt prefix, and regression-tested:
  `src-tauri/src/local_http/mod.rs:399-419` (`rebound_host_is_rejected_even_with_a_valid_token`)
  and `:421-432` for the exempt prefix.

**keep ours — inverse list entry.** Peer is ahead, and the exempt-prefix test is the detail
that makes it real rather than nominal.

### F3. Self-asserted client identity for attribution
- source: `backend/mcp_server/context.py:75-95`, with `:60-72` documenting the deliberate
  narrowing: only `/mcp` and `/speak` stamp `last_seen_at`, so the Settings "last heard from"
  column reflects calls that actually acted on the caller's bindings rather than any REST
  traffic that happened to carry the header. Per-client voice bindings hang off the same id
  (`backend/routes/mcp_bindings.py:23-45`).
- peer: identity on the MCP surface is a capability token resolved against a table, not a
  self-assertion — `src-tauri/src/mcp_server/auth.rs:61-114` requires scope
  `personas:execute` and audits per key (`:84-112`). Attribution and authorization are the
  same object.

**adapt.** Coupling them is right for authorization. But the source's *narrowing* is a
usability idea the peer lacks: it decides which paths count as "this client did something"
so the UI column means one thing. The peer audits at `auth.rs:84-112` and rate-limits per
key at `src-tauri/engine/src/management_api.rs:552-564`, but nothing distinguishes a
`tools/list` from a `personas_execute` in the last-seen sense.

### F4. What the webview is permitted to do
- source: `tauri/src-tauri/capabilities/default.json:16-26` grants `shell:allow-open`,
  `shell:allow-execute`, `shell:allow-spawn`, `fs:read-all`, `fs:write-all` — and `:7-9`
  extends the capability to `remote: { urls: ["http://localhost:*"] }`. Combined with
  `tauri/src-tauri/tauri.conf.json:39` (`"csp": null`) and `:59-61`
  (`shell.open: ".*"`), any page reachable at any localhost port can invoke commands backed
  by unrestricted filesystem write and process spawn.
- peer: `src-tauri/capabilities/default.json:11-25` grants `core:default`, `core:app`,
  `core:event`, the notification triple, `deep-link`, `dialog`, `updater`, `global-shortcut`
  and four window verbs. **No `shell:` permission at all**, no `fs:` permission, no `remote`
  block. `src-tauri/src/commands/infrastructure/system/mod.rs:39-42` records that
  `tauri-plugin-shell` is deliberately absent, and notes the consequence that residual
  plugin `open()` imports (e.g.
  `src/features/plugins/artist/sub_gallery/GalleryPage.tsx:3`) silently no-op.

**keep ours — inverse list entry.** Peer is far ahead. The one carried lesson is the
source's `remote.urls` line: a capability scoped to a URL pattern is a capability granted to
anything that can occupy that pattern.

### F5. A stated threat model the user can read
- source: `docs/content/docs/overview/mcp-server.mdx:253-266` and
  `docs/content/docs/developer/architecture.mdx:245-258` — short, honest, in the shipped
  docs: what is guaranteed, what is not, what is on the roadmap. `:261-263` even calls out
  that `audio_path` reads are unrestricted against the same boundary.
- peer: the analysis exists but is scattered and internal, and the peer's own docs say so.
  `docs/concepts/golden-path-deferred-fixes.md:1544-1607` inventories "Three loopback ports,
  116 routes, 82 needing no credential"; `docs/concepts/golden-paths/column-encryption-at-rest.md:382`
  and `:788` state outright that "**no file in the tree states the threat model**", and `:456`
  names "treating 'encrypted at rest' as a threat model" as the error. There is **no
  `SECURITY.md`** in the repo.

**adopt.** The peer has done more security work than the source and documented less of it
where a user would look. This is the cheapest point in the study: one `SECURITY.md` naming
the loopback boundary, the `0.0.0.0:17500` companion listener
(`src-tauri/src/commands/fleet/companion_api.rs:100`), and the test-automation bridge's
release gating (`src-tauri/src/boot/test_bridge.rs:27-60`). The source's `SECURITY.md` is
itself stale (`:9` claims 0.3.x support at version 0.5.0) — copy the docs page, not the file.

### F6. Body-size and rate limits on the local surface
- source: none. `backend/routes/speak.py:27-30` and the rest of the REST surface take
  Pydantic models with no size ceiling; `backend/app.py` adds `ClientIdMiddleware` (`:168`)
  and CORS (`:191-193`) and nothing else.
- peer: partial and uneven. 1 MB `DefaultBodyLimit` on the webhook router
  (`src-tauri/engine/src/webhook.rs:86-93`, `:153-160`) and a 120 req/60 s per-API-key
  sliding window (`src-tauri/engine/src/management_api.rs:552-564`) — but **`local_http`
  has neither**: `src-tauri/src/local_http/mod.rs:86` is the only layer on the tree.

**different forces.** The source is a single-user tool whose largest input is an audio blob
it wants to accept; a body limit would fight the product. The peer's `local_http` routes
reach `--dangerously-skip-permissions` CLI spawns
(`src-tauri/src/engine/project_tracking/push.rs:16-21`) and headless Claude launches
(`src-tauri/src/commands/infrastructure/dev_tools_http.rs:6-21`), where the calculus is
inverted. The peer's own docs already flag this
(`docs/concepts/golden-path-deferred-fixes.md:236`, "An unauthenticated loopback route spawns
a billed subprocess") — the source has nothing to add, but it does confirm the asymmetry is
not industry-normal indifference.

---

## G. Localization

### G1. Locale key parity **[CORRECTION to the source measurement]**
- source: **unenforced.** `app/package.json:6-15` has no i18n script — and no test script
  either. Measured against the live catalogs (all nine flattened):
  en/es/it/ko carry 850/850 keys; **fr, ja, pt-BR, zh-CN and zh-TW are each missing the same
  18 keys**, and those 18 are entirely `settings.gpu.*` ROCm strings
  (`settings.gpu.downloadRocm.*`, `settings.gpu.removeRocm.*`, `settings.gpu.switchToRocm.*`,
  `settings.gpu.rocm.*`, `settings.gpu.cuda.activeTitle`,
  `settings.gpu.activeBackend.description`, `settings.gpu.errors.deleteRocm`) — one
  untranslated feature wave, precisely nameable. Locales are eagerly imported into the main
  bundle at `app/src/i18n/index.ts:4-12`.
- peer: `scripts/i18n/check-coverage.mjs:93` computes exactly this diff, and I measured the
  live result: **20,212 leaf keys in en, 20,212 in each of the 13 non-English locales,
  0 missing, 0 extra.**

**keep ours — inverse list entry, with a caveat that sharpens it.** The gate catches (a),
but only under `--strict`, which runs solely on pre-commit and only when
`src/i18n/locales/*.json` is staged (`lefthook.yml:61-63`). Pre-push (`:101-102`) and CI
(`package.json:38` → `.github/workflows/ci.yml:126`) run the **non-strict** mode, where
missing keys print `WARN` and exit 0 (`check-coverage.mjs:149-151`). The peer's own docs
reach the same conclusion — `docs/concepts/golden-paths/i18n-string-authoring.md:354-358`:
"the answer to 'which mode does CI actually run' is: **non-strict**… a `--no-verify` commit,
or a merge that combines two branches' locale edits, reaches CI with nothing checking for
missing keys." Voicebox's 18-key gap is precisely the shape that would slip through. The
parity is green today because of discipline, and the gate would only catch a repeat if the
committer did not bypass the hook.

### G2. Untranslated strings (value byte-identical to English)
- source: no check. Measured leakage against en: es 21, it 25, pt-BR 25, fr 29, ja 15,
  ko 12, zh-CN 12, zh-TW 12 keys carry the English string verbatim.
- peer: `scripts/i18n/lib/untranslated.mjs:138` (`String(loc[k]) === String(en[k])`) inside
  `untranslatedKeys()` (`:133-141`), gated by a DNT token list (`:41-57`) and a 147 KB
  allowlist (`:121-125`); driven by `scripts/i18n/check-untranslated.mjs:64` with a strict
  exit at `:100`. Wired at `lefthook.yml:73-75`. Its own history is instructive —
  `lefthook.yml:65-72` records that this blind spot hid ~57k raw-English strings (~24% of the
  app) until 2026-07-12.

**keep ours — inverse list entry.** Peer is ahead. Two live caveats worth carrying: the gate
is **not in CI** (pre-commit only, and `lefthook.yml:4` documents `LEFTHOOK=0`), and
`uat/runs/2026-07-20-marketing-twin-pumper/SUMMARY.md:80` records that the dead-key scanner
misses `DebtText` call sites so 539 `debt.*` keys are misclassified dead and silently
excluded from it.

### G3. Degenerate plural pairs in languages with no plural category **[CORRECTION — the peer is worse]**
The seed asked which of the peer's seven scripts would have caught this. The answer is
**none**, and the peer has the same defect at thirty times the scale.

- source: measured 6 `_one`/`_other` sibling pairs in en. In **ko, ja, zh-CN and zh-TW** —
  not just ja and zh-CN as seeded — all 6 pairs carry byte-identical strings
  (`captures.toast.shortcutNotArmedDescription`, `effects.effectCount`,
  `stories.row.itemCount`, `storyContent.generatingCount`, `history.clearFailedDialog.body`,
  and one more), i.e. a mechanically mirrored plural form in four languages that have no
  plural category.
- peer: measured byte-identical `_one`/`_other` pairs per locale —
  **zh 179, ja 178, ko 178, bn 178, id 177, vi 176, hi 103**, plus ar 38, de 28, cs 26,
  ru 22, fr 13, es 7. Nothing sees them. `check-coverage.mjs:93-94` asks only whether both
  keys *exist* — they do, so green. `lib/untranslated.mjs:138` compares each locale value
  against **English**, never `_one` against its `_other` sibling, so two identical Japanese
  strings are two successful translations by its definition.
  `brokenPlaceholderKeys` (`lib/untranslated.mjs:112-118`) is explicitly asymmetric and
  *permits* a dropped `{count}` in `_one` (`:107-111`) — the exact shape a degenerate pair
  takes. `Intl.PluralRules` appears nowhere in `src/` or `scripts/`, so no plural-category
  table exists to derive the check from. Selection is a ternary at each call site
  (e.g. `src/features/agents/quick-answer/triage/deck/DeckStates.tsx:53`,
  `src/features/agents/sub_executions/components/ActiveChainsBadge.tsx:72`), which directly
  contradicts `src/i18n/CONTRACT.md:70` ("Use ICU-style interpolation keys … rather than
  branching in TSX").

**adopt** — a check neither tree has. Not "different forces": this is the same force, and
both trees are wrong about it. The highest-value finding in the study, precisely because the
seed expected an inverse entry and the measurement produced the opposite. A ~40-line script — derive plural
categories per locale from `Intl.PluralRules`, flag any `_one`/`_other` pair whose values are
byte-identical in a locale whose category set is `{other}` — would retire ~1,000 dead keys
here and would have caught the source's 24. It has a natural home next to
`check-untranslated.mjs` and a natural place in the `--strict` pre-commit pair.

### G4. Eager vs lazy locale loading
- source: `app/src/i18n/index.ts:4-12` — all nine locales are static imports into the main
  bundle; `:32-42` registers them all as resources. 850 keys × 9 is small enough that this
  never mattered.
- peer: `scripts/i18n/split-locales.mjs` generates `src/i18n/section-locales/<lang>/<section>.json`
  — 14 dirs × 62 section files — and those are the chunks the runtime fetches. Even so the
  `en` locale chunk is 488.1 KB, the third-largest in
  `scripts/bundle-baseline.json:7`, behind only `vendor-three` and `fleetTerminalManager`.

**keep ours.** At 20,212 keys × 14 locales the source's approach is not available. Noted
because the peer's split is doing real work that the source never needed, and the 488 KB
`en` chunk is the visible cost of the catalog's size — a number the G3 purge would move.

---

## H. Generated code and contracts

### H1. A generated client layer that nothing imports **[CORRECTION]**
The seed asked whether the peer's generated layer is load-bearing. It is — overwhelmingly —
but the peer has the *same* dead-artifact bug one level up.

- source: `app/src/lib/api/` is generated by `openapi-typescript-codegen`
  (`app/src/lib/api/index.ts:1`, "do not edit"; regenerable via `justfile:361-368`), and
  **no file under `app/src` outside that directory imports any of it** — grepping
  `lib/api/index`, `from '@/lib/api'`, `lib/api/services`, `DefaultService`, `OpenAPI`
  returns zero hits. The live binding is a hand-written 960-line
  `app/src/lib/api/client.ts` typed by a hand-written 562-line
  `app/src/lib/api/types.ts` — sitting in the same directory as the generated tree it
  replaced, which is why nobody noticed.
- peer: the bindings are load-bearing. `src/lib/bindings/` holds 1,070 `.ts` files generated
  by ts-rs (`src-tauri/build.rs:20`), and **938 files under `src/` deep-import from them —
  23.4% of the 4,015-file frontend tree**, touching 639 distinct binding modules. The
  hand-written client at `src/api/` (149 files) *consumes* them: 109 of those 149 import
  bindings. **But `src/lib/bindings/index.ts` — the 1,074-line barrel — has zero consumers
  anywhere** in `src/`, `src-tauri/`, `e2e/` or `scripts/`, while a generator
  (`scripts/generate-bindings-index.mjs`) and a byte-comparison `--check` gate
  (`:118`, `:131`, wired at `package.json:112` and `.github/workflows/ci.yml:118`) maintain it
  on every build.

**keep ours, with a scoped finding.** The seed's expected inverse entry holds: the peer's
generated layer is genuinely load-bearing where the source's is not. But the source's failure
mode reappears here in miniature — a generated artifact plus a gate defending it, and no
consumer. The source has no gate and lost the whole layer; the peer has a gate that verifies
the artifact is *correct* without ever asking whether it is *used*. Worth one measurement
(H-test below) before deleting anything: 431 of 1,069 binding modules are never
deep-imported and are kept alive only by `check-unused-bindings.sh`'s bare-word `grep -rw`.

### H2. Contract gates between the Rust and TS halves
- source: none. The Tauri command surface and the frontend's `invoke` call sites are
  unchecked; `.github/workflows/ci.yml:22-26` runs a typecheck and a web build and nothing
  else.
- peer: three, all with anti-vacuous floors and positive controls.
  `scripts/check-command-contract.mjs` — four rules including payload parity
  (`:16-29`, `:290-311`), baseline 1,226 compliant call sites / 3 violating, all hand-verified.
  `scripts/check-command-registration.mjs` — the mirror direction, floor
  `MIN_DEFINITIONS = 1400` (`:59`).
  `scripts/check-event-registry.mjs` — name parity, call-site scan, and a pairing pass that
  catches `let _ = app.emit(..)` into the void (`:190`, exit `:394`), with a **positive-control
  canary** at `:341-349` that fails the scanner itself if a known-good pair stops pairing.

**keep ours — inverse list entry.** Peer is far ahead. One structural note carried from the
source: all three are CI-only (`package.json:42`, `:111` → `.github/workflows/ci.yml:118`);
`lefthook.yml` pre-push runs none of them. That is the same "gate exists but does not run at
the moment it would help" shape as G1 and G2.

### H3. One version, N files, and a hard abort on drift
- source: `.bumpversion.cfg:9-39` — one `current_version` propagated to eight files
  (tauri.conf.json, Cargo.toml, four package.json files, backend/__init__.py), with
  `commit = True` / `tag = True` (`:3-4`). A search pattern that stops matching fails the bump.
- peer: `scripts/bump-version.mjs` rewrites four (`package.json`, `tauri.conf.json`,
  `Cargo.toml`, `Cargo.lock`) and **hard-aborts with exit 1 if the `personas-desktop`
  lockfile entry is not found**, explicitly so the lockfile cannot silently drift.

**adapt.** Same discipline, and the peer's lockfile guard is the sharper half. What the
source has that the peer lacks is *coverage*: the peer's tauri variant configs
(`tauri.lite.conf.json`, `tauri.stable.conf.json`, `tauri.android.conf.json`) carry no
version and `src-tauri/tauri.android.conf.json:3` carries its own identifier, so the mobile
bundle's version provenance is unstated. Adapt = extend the abort-on-missing-pattern
discipline to any file that should carry the version, or assert that none of the overlays does.

---

## I. Payload, packaging, distribution

### I1. Payload split by change rate, with independent staleness predicates
- source: `backend/services/cuda.py` ships the GPU runtime as two archives on two version
  axes — a server core pinned to the app version and an accelerator-libs archive with its own
  constant `CUDA_LIBS_VERSION = "cu128-v1"` (`:36-38`, with the comment saying to bump it when
  the toolkit or torch's CUDA dep changes). Two independent predicates:
  `_needs_server_download` compares the installed binary version against `__version__`
  (`:141-151`) and `_needs_cuda_libs_download` compares against the libs constant
  (`:154-159`). Same structure mirrored in `backend/services/rocm.py`. An app-version bump
  therefore does not re-pull multi-gigabyte CUDA libs.
- peer: **split, but only half of it has a predicate.** ONNX Runtime is a build-time concern
  with an excellent three-layer staleness check (`scripts/ensure-ort-cache.mjs`:
  own version axis `ORT_SYS_VERSION`/`ORT_ONNXRUNTIME_VERSION` at `:59-60`, a versioned
  sentinel at `:90-91`/`:288-301` with an O(1) fast path at `:330-364`, and a cross-layer
  rlib-mtime comparison at `:336-355`), plus pinned SHA256s that **fatal** on mismatch
  (`:85-88`, `:398-406`). But the *runtime-downloaded* payloads — Whisper STT models
  (`src-tauri/src/companion/stt/downloader.rs:27`, catalog `stt/catalog.rs:39-84`, up to
  466 MB) and Kokoro/Pocket TTS models (`src-tauri/src/companion/tts/kokoro.rs:59`,
  `tts/pocket.rs:83`) — have **file existence as their entire staleness predicate**:
  `downloader.rs:76-78` is `p.is_file()`, `kokoro.rs:135-140` is four `is_file()`/`is_dir()`
  checks, and `downloader.rs:106` early-returns on that.

**adopt.** Not the two-axis split — the peer already has one. The transferable piece is that
the source applies a *version* predicate to a downloaded payload rather than an *existence*
predicate. Today a superseded Whisper model, or a model version bumped in the URL string
(`pocket.rs:83` encodes `2026-01-26` in the filename), cannot be detected: the file is there,
so it is fresh forever. The asymmetry is sharpest against `ensure-ort-cache.mjs`, which pins
and verifies digests for the same class of asset in the same repo.

### I2. Checksum verification before extraction
- source: `backend/services/cuda.py:190-199` fetches a `.sha256` sibling and **fails fast**
  before extracting ("never extract an unverified archive"), verifying at `:227-234`;
  wired per-archive at `:344` and `:362`.
- peer: verified for the build-time ORT zip (`scripts/ensure-ort-cache.mjs:85-88`, `:398-406`)
  and for updater artifacts via minisign (`src-tauri/tauri.conf.json:62`). **Not verified for
  runtime model downloads** — the only integrity check in
  `src-tauri/src/companion/stt/downloader.rs:219-226` is a truncation guard comparing bytes
  received against `Content-Length`. A corrupted-but-complete download is indistinguishable
  from a good one.

**adopt.** Same seam as I1 and the same fix lands both. `ensure-ort-cache.mjs:398-406` is the
in-repo precedent for the exact discipline, including the argument for why it is fatal rather
than a warning.

### I3. Constraining the variant-overlay surface
- source: variants are a build-flag axis inside one script —
  `backend/build_binary.py:25-52` selects a binary name and, notably, `--onedir` for
  GPU builds vs `--onefile` for CPU (`:52`). The three release variants are matrix rows:
  `.github/workflows/release.yml:16-28` (macOS arm64/mlx, macOS intel/pytorch,
  Windows/pytorch). Nothing validates that the variants stay in sync.
- peer: `scripts/check-tauri-configs.mjs` enforces that overlays touch **only**
  `build.features` and `bundle.targets` (`ALLOWED_OVERLAY_KEYS` at `:21-24`, prefix-matched
  at `:82`), that every feature name exists in `Cargo.toml [features]` (`:90-99`), and that
  the CSP parses as *directives* and bans `'unsafe-inline'`/`'unsafe-eval'` (`:103-193`),
  failing rather than skipping when `csp` is missing (`:141-150`) or `null` (`:151-154`).
  The header at `:104-118` gives the reason: `withGlobalTauri: true` makes script execution
  equal local command execution.

**keep ours — inverse list entry, with one live gap.** `OVERLAYS` at `:18` lists only
`tauri.lite.conf.json` and `tauri.stable.conf.json`. **`tauri.android.conf.json` is not
validated**, and it carries `script-src 'self' 'unsafe-eval'` at `:11` — exactly the token
`BANNED_CSP_TOKENS` exists to catch. It is also not an overlay (own identifier at `:3`, own
`beforeBuildCommand` at `:7`), so the two-key rule cannot be applied to it unchanged. The
source's `"csp": null` (`tauri/src-tauri/tauri.conf.json:39`) is what this gate exists to
prevent, which is a useful reminder of what the gate is worth — and of what the unguarded
android config currently is.

### I4. Bundle-size and binary-size budgets
- source: none. No size measurement exists in the repo; `.github/workflows/ci.yml` runs
  typecheck and a web build.
- peer: two ratchets. `scripts/check-bundle-budget.mjs` normalizes Vite content-hashes and
  fails only on *growth* beyond `max(1% of baseline, 10 KB)`
  (`scripts/lib/bundle-budget.mjs:36-37`, `:40`), against a 1,515-chunk / 34,021 KB baseline
  (`scripts/bundle-baseline.json:2-3`); `scripts/binary-size-report.mjs` measures the exe and
  every installer flavour with a `--budget 100` MB gate at
  `.github/workflows/release.yml:335`. The bundle gate is deliberately **not** `if: always()`
  (`.github/workflows/ci.yml:174-181`) because a stale ratchet with 57 phantom chunks had gone
  unnoticed hiding among neighbours.

**keep ours — inverse list entry.** Peer is far ahead, and the `if: always()` post-mortem is
the kind of second-order lesson the source has had no occasion to learn.

### I5. Building hardware variants in the release matrix
- source: `.github/workflows/release.yml:16-28` — three rows, each pinning a `backend`
  (`mlx`, `pytorch`) alongside the platform, so the Apple Silicon build ships a different
  inference stack from the Intel one. The sidecar is built per-row
  (`:105-112`) before the Tauri bundle (`:131-144`).
- peer: `.github/workflows/release.yml` builds per-platform bundles and a
  `updater-manifest` job at `:380-550` that **hard-fails when any platform's bundle or
  signature is missing** (`:480-496`), because a `latest.json` with an empty url does not
  degrade gracefully — the updater errors on every check for that platform (`:481-483`).

**adapt.** The peer does not have a hardware-variant axis and does not need one today. The
half worth noting is directional: the source's matrix produces artifacts that *differ in
capability*, and nothing downstream asserts that all three landed — whereas the peer's
`:480-496` is exactly that assertion for its own axis. If a lite/stable/android release ever
ships from one workflow run, `:480-496` is the pattern to extend, not the matrix.

---

## J. Maintenance procedure

### J1. Maintenance shipped as in-repo agent skills
- source: four, in `.agents/skills/` — `add-tts-engine` (which delegates the real content to
  `docs/content/docs/developer/tts-engines.mdx` and gates between phases),
  `triage-prs` (pre-release PR speedrun producing a resumable `<VERSION>_PR_TRIAGE.md`),
  `draft-release-notes` (non-destructive, re-runnable, writes the `[Unreleased]` section),
  `release-bump` (stamps, bumps, tags). They compose in a stated order —
  `.agents/skills/triage-prs/SKILL.md:12` names the chain triage → draft → bump.
- peer: 37 skills in `.claude/skills/` — 19 registry symlinks matching
  `.ai/manifest.yaml:64-83` and 18 project-owned real directories
  (`add-credential`, `athena`, `code-review`, `passport-onboard`, `sentry`, `ship-milestone`,
  `triage-backlog`, …), governed by `.claude/CLAUDE.md:553` ("Shared skills are links, not
  copies… a real directory under `.claude/skills/` is a project-owned skill"). Plus 4
  subagents in `.claude/agents/`, `.claude/rules/`, `.ai/`, `.perfect/`.

**keep ours.** The peer's surface is an order of magnitude larger and the link-vs-copy rule
is a governance idea the source has no need for at four skills. The one asymmetry worth
recording: the source has an explicit **release** chain and the peer has none — there is no
release skill, no npm release script (`grep "release\|bump\|changelog" package.json` is
empty), and the procedure lives as prose in `docs/development/release.md` invoked through a
`workflow_dispatch`. That is a deliberate CI-only choice, not a gap; noting it so the absence
is not later mistaken for one.

### J2. Changelog ownership **[CORRECTION — both sides]**
The seed said the source declares its changelog agent-owned and not hand-editable. It does not.

- source: `CONTRIBUTING.md:315` instructs human contributors to "**Update CHANGELOG.md** with
  your changes" and `:324` makes it a PR checklist item. The `draft-release-notes` skill
  writes the same `[Unreleased]` section from git history, non-destructively and
  re-runnably — so the file has two writers, human and agent, with no declared owner and
  nothing arbitrating.
- peer: also hand/agent-authored, but with a cleaner split.
  `.claude/CLAUDE.md:81` makes maintaining `[Unreleased]` an explicit agent duty in the
  pre-push self-review, and `docs/development/release.md:29-32` states the division:
  `CHANGELOG.md` is hand-maintained, while **GitHub release notes** are generated from
  commits by `scripts/generate-changelog.mjs` — which prints to stdout (`:85`) and never
  touches `CHANGELOG.md`, consumed at `.github/workflows/release.yml:139`.

**keep ours.** The peer's two-artifact split is the better model and is already documented.
Neither side has a gate; both rely on judgment. Recorded chiefly to retire the seeded claim.

### J3. CI as a hard backstop vs CI as a smoke test
- source: `.github/workflows/ci.yml:22-26` is the entire quality gate — `bun run typecheck`
  and `bun run build:web`. No lint, no tests, no i18n check, despite 31 Python test files in
  `backend/tests/` and a `just test` target (`justfile:325`). Nothing in CI runs them.
- peer: `npm run check` chains thirteen gates (`package.json:54`, count asserted in
  `.claude/CLAUDE.md:70` with "if you add a gate, add it here in the same commit"), run at
  `.github/workflows/ci.yml:118`; plus six pre-push jobs (`lefthook.yml:79-114`) and seven
  workflows (`ai-conformance`, `audit`, `ci`, `codeql`, `e2e-smoke`, `installer-test`,
  `release`).

**keep ours — inverse list entry.** Peer is far ahead. The transferable observation is the
inverse of the peer's own recurring problem: the source has tests nothing runs; the peer has
gates that run in the wrong place (G1's strict mode, G2's absence from CI, H2's CI-only
contracts). Both are the same failure — the gate and the moment of risk are not aligned.

### J4. Where a proposal like this one belongs
- source: `.agents/skills/` holds procedure; there is no directions/proposals lane. Working
  documents are per-release files named by the skill that writes them
  (`<VERSION>_PR_TRIAGE.md`).
- peer: `.perfect/directions/` — 14 tracked files with a defined frontmatter schema
  (`slug`/`type`/`context`/`lens`/`status`/`size`/`proposed`/`accepted`/`shipped`/`commit`;
  see `.perfect/directions/honest-endings.md:1-11`), defined by the registry `perfect` skill
  at `ai-registry/skills/perfect/SKILL.md:92` with the vault root resolved at `:66`.
  `.ai/directions/` did not exist before this file.

**adapt — flagged for the operator.** This study was written to `.ai/directions/` as
instructed, but that path is undeclared: `.ai/manifest.yaml:29-33` sanctions only
`contextIndex`, `memory`, `evals` and `guardrails` under `paths:`, and `.ai/doctor.mjs:54-58`
resolves only those, so nothing in the `.ai/` toolchain will ever see this file. If it should
be tracked as a direction, it belongs in `.perfect/directions/` with that frontmatter. Two
adjacent findings surfaced while establishing this: `.ai/manifest.yaml:33` declares
`guardrails: .ai/guardrails.yaml` and **that file does not exist** (a dangling pointer the
doctor happens not to check), and two `perfect` overlays coexist —
`.perfect/config.md` (2026-08-07) and `.claude/perfect/config.md` (2026-09-03), the latter
named canonical by `.claude/CLAUDE.md:556`.

### J5. The CONTEXT.md convention
- source: no module-context convention. Per-subsystem READMEs exist ad hoc
  (`backend/mcp_server/README.md`, `backend/tests/README.md`, `backend/STYLE_GUIDE.md`).
- peer: declared at `.ai/manifest.yaml:34-35` — "every module directory over 12 files has a
  CONTEXT.md" — and **no script implements the 12-file threshold**; grepping the phrase
  returns only that line. The nearest enforcement, `.ai/maintain.mjs:23-40` wired at
  `lefthook.yml:113-114`, iterates `.ai/context-index.json`'s `modules` array, which contains
  **exactly one entry (`root`)**, and only warns (`:39` exits 1 under `--strict`, which
  lefthook does not pass). `git ls-files '*CONTEXT.md'` returns one file.

**different forces.** The source has ~40 backend modules and one maintainer; a context
convention would be overhead. The peer has 208 contexts and needs one. But the peer's rule is
currently aspirational, and its real granularity work lives in a different artifact entirely
(`context-map.json`, audited by `scripts/context/check-granularity.mjs:21-22`). The source
offers no fix; it is listed because it is the one place where the *smaller* tree's honesty —
no rule at all — beats a declared-but-inert one.

---

# Tests to initiate

Each is a paired measurement with a named instrument and a predicted direction. None is
"add tests".

### T1. Degenerate-plural census (pairs with G3)
**Instrument:** a new `scripts/i18n/check-plural-degeneracy.mjs`, modelled on
`scripts/i18n/check-untranslated.mjs`, deriving each locale's plural category set from
`Intl.PluralRules(locale).resolvedOptions().pluralCategories` and flagging any `_one`/`_other`
sibling pair whose values are byte-identical in a locale whose set is exactly `{other}`.
**Number that moves:** degenerate pairs in category-`{other}` locales, currently
**zh 179, ja 178, ko 178, vi 176, id 177 — 888 dead keys across five locales**. Predicted
direction: to 0 after a `purge` pass, and the `en` locale bundle chunk in
`scripts/bundle-baseline.json:7` (488.1 KB) drops measurably as the mirrored halves leave the
generated `section-locales` and `enSectionStrings.ts`.
**Control:** run the same script against the voicebox catalogs, where it must report 6 pairs
in each of ko/ja/zh-CN/zh-TW and 0 in en/es/fr/it/pt-BR. A script that reports 0 everywhere is
broken, not clean — this is the `check-event-registry.mjs:341-349` canary discipline applied
to a new gate.

### T2. Health-schema assertion (pairs with C1)
**Instrument:** extend `src-tauri/src/commands/credentials/mcp_tools.rs:50` to parse the
`/health` body and require `management == true`, then boot the app with `AppState` resolution
forced to fail (the degraded path at
`src-tauri/src/engine/background/lifecycle.rs:511-514`).
**Number that moves:** the Settings MCP chip's reported state under a webhook-only boot,
currently **"Running" (wrong) in 1 of 1 degraded-boot trials**. Predicted direction: to
"Degraded"/false. Second number: the count of `/api/*` 404s a user hits before the UI tells
them anything, currently unbounded, predicted to 0.

### T3. Runtime-model staleness (pairs with I1/I2)
**Instrument:** a `models.json` manifest carrying `{id, url, sha256, version}` for the six
Whisper entries in `src-tauri/src/companion/stt/catalog.rs:39-84` and the two TTS archives at
`tts/kokoro.rs:59` / `tts/pocket.rs:83`; then replace `downloader.rs:76-78`'s `p.is_file()`
with a digest-or-version comparison and add the fail-fast verify from
`scripts/ensure-ort-cache.mjs:398-406`.
**Number that moves:** **detectable corrupt-or-superseded model states, currently 0 of 8
payloads** (existence is the only predicate; the `Content-Length` guard at
`downloader.rs:219-226` catches truncation only). Predicted direction: 8 of 8. Adversarial
control: truncate-then-pad a downloaded `ggml-base.bin` to its exact original byte length —
today it loads and produces garbage transcripts; after the change it must be rejected before
first use.

### T4. Gate-placement audit (pairs with G1, G2, H2)
**Instrument:** a script that, for every `scripts/**/check-*.mjs`, resolves whether it has a
caller in `package.json`, `lefthook.yml`, and `.github/workflows/*.yml`, and — for
`check-coverage.mjs` specifically — which *mode* each caller passes. This is the meta-gate
`docs/concepts/golden-paths/adding-a-ci-gate.md` describes in prose but nothing executes.
**Number that moves:** **checks whose strictest mode never runs in CI**, currently at least
three — `check-coverage.mjs --strict` (pre-commit only, glob-scoped,
`lefthook.yml:61-63` vs `ci.yml:126` non-strict), `check-untranslated.mjs --strict`
(pre-commit only, absent from CI), and the three contract gates (CI-only, absent from
pre-push). Predicted direction: to 0, or to an explicit annotated allowlist. Control: the
script must flag `check-route-sections.mjs`, which has no npm script at all and reaches CI
only indirectly via `src/i18n/__tests__/routeSectionCoverage.test.ts:24`.

### T5. Binding-barrel reachability (pairs with H1)
**Instrument:** extend `scripts/check-binding-orphans.mjs` with a third axis — for each of
the 1,069 binding modules, whether any file under `src/` outside `src/lib/bindings/`
deep-imports it — using the same import scan that produced the 938/639 figures, rather than
`check-unused-bindings.sh`'s bare-word `grep -rw`.
**Number that moves:** **binding modules with zero real importers, currently 431 of 1,069
(40%)**, and separately **consumers of `src/lib/bindings/index.ts`, currently 0** against a
generator plus a byte-comparison gate that run on every build. Predicted direction: the 431
resolves into two populations — types reachable only as nested fields of an imported type
(legitimate, must stay) and true orphans (deletable). The prediction worth testing is that
the split is roughly even; if nearly all 431 are nested, `check-unused-bindings.sh` is
measuring the right thing badly and the barrel is the only real deletion.

### T6. Exit-teardown ghost count (pairs with C7)
**Instrument:** a loop that starts the app, spawns one design-analysis CLI run and one Fleet
PTY session, kills the desktop process, and then counts surviving matching PIDs via the
existing `fleet_detect_processes` scan
(`src-tauri/src/commands/fleet/process_scan.rs:58-104`) plus a `netstat` check on `:9420`.
**Number that moves:** **orphaned children per forced exit, predicted ≥1 today** (only
`webbuild_servers.stop_all()` runs at `src-tauri/src/lib.rs:2163`), predicted to 0 for the
`ActiveProcessRegistry` population after an ordered `RunEvent::Exit` arm — and deliberately
**unchanged for dozing/hibernating Fleet sessions**, which must survive
(`src-tauri/src/commands/fleet/pty.rs:968-981`). A run that zeroes both has over-corrected.

---

# Features ranked

Ranked by value against **what this project's scope admits**. Scope evidence:
`.ai/manifest.yaml:11` (`purpose: "Local-first desktop app for orchestrating AI agent
personas"`), `package.json:11-13` (the longer description: "encrypted credentials, visual
pipelines, real-time observability"), and `app-passport.json:5-21`, whose dimension verdicts
are the sharpest scope statement in the tree. A feature the scope does not admit is not a
candidate however good it is — see the two rejections at the end.

### 1. Split the local-dictation readiness predicate by blast radius (A1 + A2 + A5)
**Admitted by:** `app-passport.json:13` — `"auth": {"level": "not_applicable", … "local
single-user app; auth = key management"}`. The passport says this app's user-facing
correctness burden is not authorization but *local device state*, which is precisely what a
permission/model/binary readiness predicate is. Reinforced by
`.ai/manifest.yaml:11`: dictation is an input path to persona orchestration, so a silent
failure there blocks the declared purpose rather than decorating it.
**Why first:** it is the only source mechanism that closes a live user-visible defect
(`useLocalDictation.ts:218-221` collapses three distinct failures into one string), it reuses
a subscription pattern already built here (`useShipLive.ts:41-44`), and it needs no new
dependency, no new permission, and no security-boundary change. Cost is one hook and one
copy string; the settings-pane deep link (A3) is explicitly *not* part of it.

### 2. Assert the health schema the app already publishes (C1)
**Admitted by:** `app-passport.json:17` — `"observability": {"level": "connected", …}`. The
passport claims observability as a *reached* level, and a status chip that reports "Running"
during a degraded boot is a direct falsification of that claim rather than a missing feature.
Also `package.json:13` names "real-time observability" as a product pillar.
**Why second:** the schema exists (`src-tauri/engine/src/webhook.rs:189-208`), the reason it
exists is documented (`:186-188`), and the consumer is one line
(`src-tauri/src/commands/credentials/mcp_tools.rs:50`). Highest ratio of correctness-restored
to lines-changed in the study. T2 measures it.

### 3. Version-and-digest the runtime model downloads (I1 + I2, measured by T3)
**Admitted by:** `app-passport.json:12` — `"database": {"level": "versioned", "tool": "SQLite
+ guarded incremental migrations"}` establishes that versioned local state with a guarded
upgrade path is an accepted obligation here, and downloaded models are local state of exactly
that kind. Also `app-passport.json:19` — `"security": {"level": "gated", …}` — makes an
unverified multi-hundred-megabyte download from a third-party host a scope-relevant gap, not
a nicety.
**Why third:** it is the largest *unmeasured* risk surface the comparison found (8 payloads,
existence-only freshness, no digest), and the peer already contains its own solution in
`scripts/ensure-ort-cache.mjs:85-88`/`:398-406` — the work is applying an in-repo pattern to
a second asset class, not inventing one.

**Cap reached at three.** The remaining `adopt` verdicts are recorded above and deliberately
not promoted: D3/D4 (persona-jobs cancel writer, worker panic boundary) are bug fixes rather
than features and should ride a normal fix pass; F5 (`SECURITY.md`) is a documentation task;
C7 (exit teardown) is scoped by T6 before it is worth proposing; G3's plural gate is proposed
as a *test* (T1) rather than a feature because its value is the measurement.

**Rejected for scope, not for quality:**
- **A settings-pane deep link (A3).** Would require punching through
  `src/lib/utils/sanitizers/sanitizeUrl.ts:84`, a boundary with a regression test at
  `__tests__/sanitizeUrl.test.ts:46` and a deliberate no-shell-plugin stance
  (`src-tauri/src/commands/infrastructure/system/mod.rs:39-42`). `app-passport.json:19`
  claims security as `"gated"`; widening a tested allowlist to improve a permission-repair
  flow the app does not have inverts that.
- **A Rust-owned SSE/stream subscriber (B3).** The constraint that forces it — hidden-webview
  network throttling — does not exist here, and `app-passport.json:6`'s
  `"context_coverage": {"level": "full"}` posture argues against adding a subsystem with no
  failing case to point at. B4's read deadline on the existing browser-bridge socket is the
  admitted subset.

---

# What this project does BETTER

The half that keeps the study honest. Fourteen entries; the two the operator already knew are
first.

1. **Authenticated machine-facing surfaces.** Voicebox documents "no auth today" as a shipped
   non-guarantee (`docs/content/docs/overview/mcp-server.mdx:258-260`) and its only per-caller
   identity is a self-asserted header used for attribution
   (`backend/mcp_server/context.py:75-95`). Personas gates Tauri IPC with a CSPRNG session
   token, fails closed on every error path, and compares constant-time
   (`src-tauri/src/ipc_auth.rs:54-59`, `:602-652`, `:611-627`, `:655-664`), with a three-tier
   command model (`:812-830`) and drift-guard tests that keep the tier lists honest
   (`:1021-1041`, `:1158-1216`). The HTTP surface adds a shared secret with its own
   constant-time compare (`src-tauri/src/local_http/auth.rs:154-165`), applied over the
   composed router so new routers inherit it (`local_http/mod.rs:86`, rationale `:84-86`).

2. **A generated layer that is actually load-bearing.** Voicebox's generated OpenAPI client
   (`app/src/lib/api/`) has **zero importers** in `app/src` and was replaced in place by a
   hand-written 960-line `client.ts` sitting in the same directory. Personas' ts-rs bindings
   are imported by **938 of 4,015 frontend files (23.4%)**, spanning 639 distinct modules,
   and the hand-written `src/api/` layer consumes them (109 of 149 files) rather than
   replacing them — plus a two-sided orphan gate with anti-vacuous floors
   (`scripts/check-binding-orphans.mjs:66-67`, `:139-161`, `:172-177`). The one blemish is
   the barrel: `src/lib/bindings/index.ts` has no consumers and a build gate defending it.

3. **DNS-rebinding defence on the loopback surface**, with the exempt-prefix case tested.
   `src-tauri/src/local_http/auth.rs:241-262`, allowlist at `:173`, IPv6-aware split at
   `:176-188`; regression tests drive a real socket at
   `src-tauri/src/local_http/mod.rs:399-419` and `:421-432`. Voicebox has CORS origins
   (`backend/app.py:180-193`) and no Host check.

4. **A minimal webview capability grant.** `src-tauri/capabilities/default.json:11-25` grants
   no `shell:` and no `fs:` permission at all, and the absence is deliberate and documented
   (`src-tauri/src/commands/infrastructure/system/mod.rs:39-42`). Voicebox grants
   `fs:read-all`, `fs:write-all`, `shell:allow-execute`, `shell:allow-spawn`
   (`tauri/src-tauri/capabilities/default.json:16-26`) **and extends the capability to any
   `http://localhost:*` origin** (`:7-9`), with `"csp": null`
   (`tauri/src-tauri/tauri.conf.json:39`).

5. **A CSP gate that parses directives.** `scripts/check-tauri-configs.mjs:103-193` fails
   rather than skips when `csp` is missing or `null` (`:141-154`) — the exact state Voicebox
   ships in. (Caveat: `tauri.android.conf.json` is outside `OVERLAYS` at `:18` and carries
   `'unsafe-eval'` at `:11`.)

6. **A conditional terminal-status writer that refuses to clobber.**
   `src-tauri/engine/src/execution_engine/persist.rs:138-200` dead-letters through the same
   conditional path rather than forcing `Failed`, reasoning explicitly about the concurrent
   real-`Completed` race (`:187-193`), with a panic boundary that also releases the
   concurrency slot (`src-tauri/src/engine/execution.rs:900-905`, `:976-996`). Voicebox's
   `_force_fail_if_active` (`backend/services/task_queue.py:69-93`) reaches only the raise
   path.

7. **Leader-aware recovery.** `src-tauri/src/boot/recovery.rs:39-46` defers the whole
   recovery phase when another instance leads, because a follower's state-keyed sweep would
   fail the leader's live work (`:10-32`) — and the residual window is named honestly.
   Voicebox's boot sweep (`backend/app.py:302-308`) is an unconditional `UPDATE`.

8. **A dead-but-bound listener is never adopted.**
   `src-tauri/src/webbuild/devserver.rs:193-213` writes a real request and validates the
   response prefix (`:187-192`), and `:248` re-verifies a PID from a lock file is still the
   right kind of process before killing it (`:267-281`) — a guard Voicebox's kill path
   (`tauri/src-tauri/src/main.rs:1631-1643`) does not have.

9. **A retired-identifier list with a lint enforcing the front door.**
   `src-tauri/core/src/model_ids.rs:51-60` plus the census rule at
   `scripts/census/rules.json:19-21`, born from a named incident (`model_ids.rs:1-21`), and
   compile-time enum exhaustiveness at `src-tauri/core/src/engine_kind.rs:37-48`.

10. **Contract gates with positive controls.** `scripts/check-event-registry.mjs:341-349`
    fails the *scanner* if a known-good emit/listen pair stops pairing;
    `scripts/check-binding-orphans.mjs:66-67` and
    `scripts/generate-bindings-index.mjs:61` carry anti-vacuous floors;
    `scripts/docs/check-doc-map-paths.mjs:45-48` and `:88-91` self-test the walker and the
    parser. Voicebox's CI is `bun run typecheck` and a web build
    (`.github/workflows/ci.yml:22-26`) — and its 31 Python test files never run there.

11. **Ratcheted size budgets with a post-mortem baked in.**
    `scripts/lib/bundle-budget.mjs:36-40` (1% / 10 KB tolerance over a 1,515-chunk baseline),
    `scripts/binary-size-report.mjs` with a 100 MB gate at
    `.github/workflows/release.yml:335`, and `.github/workflows/ci.yml:174-181` explaining why
    the step is deliberately not `if: always()`. Voicebox measures nothing.

12. **Runtime-probed capability instead of a static assumption.**
    `src-tauri/engine/src/cli_capabilities.rs:66-110` spawns the CLI, reads the `system/init`
    event and kills the child, because tier-gating means capability must be observed
    (`:1-12`). Voicebox derives its nearest equivalent from a static backend-type string
    (`backend/backends/__init__.py:238`).

13. **A build script that reruns when a secret rotates.** `src-tauri/build.rs:52` emits
    `rerun-if-env-changed` per key, with `:48-51` recording that without it a cached `target/`
    ships the previous `SENTRY_DSN`. Voicebox has no equivalent hazard and no equivalent
    guard.

14. **An updater manifest that refuses to ship half-built.**
    `.github/workflows/release.yml:480-496` hard-fails when any platform's bundle or signature
    is missing, because a `latest.json` with an empty url errors on every check for that
    platform (`:481-483`).

---

## Seeded claims corrected

| # | Seed said | Actually |
|---|---|---|
| 4 | Peer's `radio/` and `notifications.rs` own streams | `radio/service.rs:34-39` owns catalog + playback *state*; zero `reqwest`/SSE/WebSocket hits across `radio/`, `notifications.rs`, `stream_harness.rs`. `stream_harness.rs:1-31` is a debug-only protocol probe. |
| 5a | Source adopts only on a schema-asserted `/health` | Primary adopt path is **process-name matching with no health check** (`main.rs:301-307` unix, `:336-340` Windows); `check_health` is the fallback for non-matching names (`:311-316`, `:343-347`). |
| 5b | Peer's `process_registry`/`daemon`/`freeze_monitor` are a comparable supervision stack | No adopt path exists at all (`lifecycle.rs:515-548` is wait-for-free); no parent-pid watchdog anywhere (grepped `parent-pid`, `getppid`); `freeze_monitor.rs:94-100` is log-only on RSS growth; `RunEvent::Exit` tears down only Bun servers (`lib.rs:2159-2166`). |
| 7a | Source: `ja` and `zh-CN` carry mirrored plural pairs | **Four** locales do — ko, ja, zh-CN, zh-TW — 6 pairs each, all byte-identical. |
| 7b | Peer's seven i18n scripts would each have caught one of the three failures | They catch (a) and (b→value-parity) but **nothing catches degenerate plurals**, and the peer has 176–179 such pairs per category-`{other}` locale vs the source's 6. (a) is caught only under `--strict`, which CI does not run (`ci.yml:126` uses the non-strict mode; `check-coverage.mjs:149-151`). |
| 9 | Source force-fails a row whose coroutine exited without a terminal status | Only whose coroutine **raised** — `task_queue.py:57-62`; the `finally` at `:63-66` writes no status. The startup sweep is at `app.py:297-321`, not in `task_queue.py`. |
| 10 | Peer's `src/lib/bindings/` may not be load-bearing | Decisively load-bearing — **938 importers, 639 distinct modules, 23.4% of the frontend tree**. But the barrel `index.ts` has **zero** consumers behind a generator and a `--check` gate. |
| 11 | Source declares its changelog agent-owned and not hand-editable | `CONTRIBUTING.md:315` and `:324` instruct humans to edit it; the `draft-release-notes` skill writes the same section. Two writers, no declared owner. |
