# Golden path — Embedded terminal session

> Situation node: `backend-runtime/subprocess-and-io/embedded-terminal-session` ·
> [situation spine](../situation-spine.md) · recurrence **9** · risk **HIGH** ·
> sides: **client** · `twoSided: true` · convergence: **spine says `converged`;
> measured **SILENCE 5/5** — see §12.1** · dimensions:
> **performance · function · resilience · ui**
> merged from *Live PTY terminal viewer*, *Live session terminal*.
> Leaf definition: *"a durable interactive terminal whose scrollback survives
> unmount."* Composed 2026-08-16 against `master` @ `b4a05049e`.
>
> **Sweep.** All **963** `.rs` under `src-tauri/` and all **4,829** `.ts`/`.tsx`
> under `src/` (the census walk's own counts). Read in full:
> `commands/fleet/{pty,registry,commands,persist,stale,wait,bench,companion_api,headless}.rs`,
> `src/features/plugins/fleet/{fleetTerminalManager.ts,FleetTerminalPane.tsx,FleetTerminalOverlay.tsx,FleetOverlayTile.tsx,useFleetOverlayActions.ts,useFleetHotkeys.ts}`,
> `src/features/plugins/fleet/sub_monitor/MonitorView.tsx`,
> `src/lib/keyboard/{AppKeyboardProvider,KeyboardNavMode,WorkspaceShortcuts,NavHistoryShortcuts}.tsx`,
> and the **vendored `@xterm/xterm` 6.0.0 bundle** (`node_modules/@xterm/xterm/lib/xterm.js`),
> which is where the load-bearing correction in §12.3 came from. All **6** host
> surfaces of `FleetTerminalPane` opened. All **74** keyboard-listener
> registrations in the tree enumerated twice.
>
> **Measured by executing, not by reading.**
> 1. **The operator's `%TEMP%` was inspected on disk**, with `icacls` and with
>    `CreationTime`/`LastWriteTime`: **6 `fleet-mcp-*` directories, 0 removed by
>    the app**, 2 still holding a token file, 4 emptied by something that is not
>    this app (§0.3). No token value, prefix or partial appears anywhere here.
> 2. **Read-only copies of both live SQLite files** (`personas.db` 347 MB,
>    `personas_data.db` 17.5 MB, copied 2026-08-16 22:31 with their `-wal`/`-shm`,
>    opened `readOnly: true`). The live files were never opened for write.
>    **`fleet_sessions`: 0 rows. `fleet_decisions`: 46 rows over 26 session ids**,
>    joined by id to the temp directories and to `~/.claude/projects`.
>    **The copies were deleted afterwards.**
> 3. **`~/.claude/projects` was walked**: 3,765 `.jsonl` files / **2.55 GB**, of
>    which **684** are top-level session transcripts. Joined to the fleet ids.
> 4. The §9 rule and its control were built, run through the **real census
>    runner** in a composer-private scratch registry
>    (`ets-rules-final.json`), cross-checked against an independently written
>    Node scanner (both say **74**), **fault-injected 8 ways — all 8 fire** — then
>    **re-extracted from this finished document and re-run: identical.**
>    **The full registry was NOT run**, per the doctrine.
> 5. **`cargo` was not run. No session was spawned and nothing was typed into the
>    running app.** Every Rust claim is static and traces to a file opened during
>    composition.
>
> **Adjacent leaves — cross-reference, do not absorb.**
> [`live-log-stream-view`](./live-log-stream-view.md) owns a **parsed line
> stream** rendered into a scroll container. This path owns a **byte stream with
> a cursor**, where the bytes are a program's screen and the user types back.
> Its prescriptions mostly do not apply here and one of them inverts (§6).
> [`spawning-a-cli-subprocess`](./spawning-a-cli-subprocess.md) owns argv, cwd
> and teardown of the child. This path owns the terminal wrapped around it.
> [`agent-dispatch`](./agent-dispatch.md) owns *keeping an address for the work*;
> it measured `MAX_LIVE_SESSIONS = 0` and the 12 `--dangerously-skip-permissions`
> argv sites, both **confirmed here** (§12.2), and this path adds what that
> address is worth once the process behind it is gone.
> [`credential-injection-into-child`](./credential-injection-into-child.md) owns
> the token in the temp file; **this path re-measured the directory a week later
> and found who is actually cleaning it up** (§0.3).
> [`keyboard-shortcut-registration`](./keyboard-shortcut-registration.md) owns
> rank and registration. This path owns **phase** — and §12.3 overturns the
> brief's claim that `document` beats the terminal.
> [`ipc-command-authorization`](./ipc-command-authorization.md) owns tier choice;
> §7.F contributes one number and defers.
> [`panic-isolation`](./panic-isolation.md) owns the detached task; §7.G supplies
> the two siblings its 2026-08-16 fix asked for.

---

## 0 The headline: the app kills the process 60 seconds after the terminal starts waiting for you, and the terminal does not change

`stale.rs:1182` — `const DOZE_AFTER_SECS: i64 = 60`. The doze pass
(`stale.rs:1244` → `registry.rs:1192`) kills the `claude` child of any session
sitting in **`Stale` or `AwaitingInput`** for 60 seconds. It is **always on** —
the module comment calls it "the resource floor", there is no settings toggle,
and unlike auto-hibernate it deliberately **keeps the displayed state**.

`fleetAttention.ts:102-104` — `needsLiveAttention(s)` is
`s.state === 'awaiting_input'`, and that is the predicate the grid uses to decide
which tiles mount a **live, subscribed, focusable terminal**
(`FleetTerminalOverlay.tsx:260`).

**The two constants meet on the same state.** The grid mounts an interactive
terminal for exactly the state whose process the app destroys a minute later.

What the operator sees at second 61 is what they saw at second 59:

| | at t=59s | at t=61s |
| --- | --- | --- |
| the terminal's contents | claude's last screen, replayed from the ring | **identical** — the ring survives the kill (`registry.rs:1215-1216` clears `writer`/`master`, never `output`) |
| the cursor | blinking (`fleetTerminalManager.ts:307` `cursorBlink: true`) | **blinking** |
| what a keystroke does | reaches the child | `Err("session writer dropped")` (`registry.rs:672`) → **`silentCatch`** (`fleetTerminalManager.ts:357`) |
| the only difference on screen | — | a **12-pixel moon glyph in the tile header** (`FleetOverlayTile.tsx:70-79`, `w-3 h-3`) |

`fleetTerminalManager.ts` contains **17 `silentCatch` call sites and 0
`toastCatch`** — every operation the terminal performs (keystrokes, paste,
resize, fit, subscribe, unsubscribe, copy-on-select, link-open, WebGL, three
disposals) reports its failure to a sink with no UI. The *programmatic* writers
one directory over — `useFleetOverlayActions.ts:155` and the two `writeInput`
calls at `FleetGridPage.tsx:260,:271`, both inside a `toastCatch`
— all use `toastCatch` for the same underlying call. **The app tells you when
*its* message to the session failed and never tells you when *yours* did.**

Recovery is real but it is not free and it is not everywhere:

- **Grid tile:** `FleetOverlayTile.tsx:64` puts `onMouseDown={() => onSelect(s.id)}`
  on the whole tile, so clicking into the terminal *does* start a wake
  (`useFleetOverlayActions.ts:54-78`). The wake is a full
  `claude --resume` **spawn**, and the repo's own estimate of how long that takes
  to become typeable is written down: the limit-retry lane sleeps
  **25 seconds** after `fleet_wake_session` before it types anything
  (`stale.rs:1160-1166`). Every keystroke in that window is swallowed. The wake
  also **replaces the session id**, so the tile you clicked is removed and a new
  one appears.
- **Single pane** (`FleetGridPage.tsx:758`): the terminal container carries **no
  select handler at all**. If the session you are already looking at dozes
  underneath you, clicking into its terminal wakes nothing — you must click a
  *different* card and come back.

### 0.1 — 37 of the 38 Fleet IPC commands are Public tier, and the one that is privileged is the least dangerous

Measured across `commands/fleet/`: **38 `#[tauri::command]` functions. Exactly
one appears in `PRIVILEGED_COMMANDS` — `fleet_remove_session`** (`ipc_auth.rs:393`),
gated with the reasoning *"Removing a live row orphans a running Claude Code
process."*

Not gated: `fleet_write_input` — which writes arbitrary bytes to the stdin of a
`claude` child started with `--dangerously-skip-permissions`
(`pty.rs:324`, `:364`) and, for any payload longer than one character ending in a
newline, appends its own Enter and confirms the submit (`commands.rs:91-94`).
Also not gated: `fleet_spawn_session` (a new such child in any `cwd`),
`fleet_kill_pid`, and `fleet_install_hooks` (which rewrites
`~/.claude/settings.json`).

Tier choice belongs to
[`ipc-command-authorization`](./ipc-command-authorization.md) and this path does
not re-derive it. The number it contributes is the ratio: **1 of 38, and the
gated one is process bookkeeping while the ungated one is arbitrary command
execution in the operator's repository.**

The comparison that makes it concrete is inside this leaf. The **LAN companion
API** — the remote lane — reaches the same PTY through the same registry, and it
is the careful one: LAN-peer check, device-scoped bearer token with constant-time
comparison, a five-verb allowlist, an audit row per act, a 500-character cap, and
`sanitize_reply` (`companion_api.rs:469-475`), which strips every control
character so that *"a remote reply must never be able to smuggle terminal control
sequences"*. **The local door has none of the five.**

### 0.2 — the durable registry holds 0 rows, and 2.55 GB of what the sessions actually left behind is owned by something else

| store | what it holds | rows / bytes measured 2026-08-16 |
| --- | --- | ---: |
| `fleet_sessions` (the app's durable registry) | rehydratable sessions | **0 rows** |
| `fleet_decisions` (Athena's ledger) | 46 acts over **26 distinct session ids**, 2026-08-05 → 08-09 | 46 rows |
| `~/.claude/projects/**.jsonl` (Claude Code's own store) | the conversations | **3,765 files / 2.55 GB**, 684 top-level sessions |
| `%TEMP%/fleet-mcp-*` | per-session MCP config + token | **6 dirs** |
| `OutputRing` (the scrollback) | 512 KiB/session, in memory | **dies with the process** |

`fleet_sessions` being empty is not a broken writer — `agent-dispatch` §7 D10
already cleared that, and an idle fleet looks exactly like this. What is
measurable *here* is the asymmetry: **26 sessions ran in five days and the app's
own durable store retains nothing about any of them**, because
`persist.rs:119-120` writes only rows with a bound `claude_session_id`,
`persist.rs:47` prunes terminal rows at 24 h, and `note_removed` deletes a
dismissed row outright. The conversation survives — in a directory this app does
not own, index, or prune.

And the ids do not line up. Of the 6 leaked `fleet-mcp-<uuid>` directories, **0
have a transcript named by that uuid**, because the directory is keyed by the
*Fleet* id and the transcript by the *Claude* id (two different UUIDs, minted 15
lines apart at `pty.rs:266` and `pty.rs:281`). With `fleet_sessions` empty, **a
`fleet-mcp-*` directory on this machine cannot be resolved to a conversation by
anything the app stores** — the only surviving join is `fleet_decisions`, and one
of the six is not in it.

The same table shows the id spaces colliding: **7 of the 25 non-empty
`session_id` values in `fleet_decisions` are Claude session ids, not Fleet ids**
(they match `<id>.jsonl` on disk), and one uuid appears in **both** the
`session_id` and `claude_session_id` columns. `registry.rs:546`
`resolve_session_id` exists to normalise exactly this and has **5 production call
sites, all in the companion lane; zero in `commands/fleet/commands.rs`.**
**10 of the 46 rows carry an empty `session_id`** — the data-shaped form of
`agent-dispatch`'s "fifteen agent-starting actions return an English sentence".

### 0.3 — the app removed 0 of 6 temp directories; Windows removed 4 of the 6 token files, seven days late

[`credential-injection-into-child`](./credential-injection-into-child.md) §7.B
measured "6 created, 0 removed, 2 still holding a session token 7 days later".
Re-measured on 2026-08-16 with `CreationTime` as well as `LastWriteTime`, the
picture is worse and more specific:

| created | mcp.json | directory last modified |
| --- | --- | --- |
| 08-05 10:52 · 08-05 23:15 | **gone** | 08-13 04:49 |
| 08-06 08:14 · 08-06 08:15 | **gone** | 08-14 04:49 |
| 08-09 17:01 · 08-09 17:44 | **present** | 08-09 (untouched) |

Four token files were deleted **at 04:49 on two consecutive days, 7.2 and 7.9
days after creation** — a daily OS temp-file sweep on a 7-day threshold, not this
app. The app's cleanup lives inside the reaper's `spawn_blocking` closure
(`pty.rs:524-528`, hand-copied at `headless.rs:251-262`) and **removed 0 of 6**.
The OS janitor deletes files and leaves directories, so **6 of 6 directories are
still there** and will be indefinitely.

Two things follow that the earlier measurement could not see. First, the surviving
files are not live bearer tokens: `mint_session_token`
(`companion/orchestration/mcp/mod.rs:83-97`) stores into a
`OnceLock<RwLock<HashMap>>` — **process memory** — so every token in a file that
outlived an app restart resolves to nothing. They are stale artefacts, not
credentials. Second, the ACL is worse than one group: `icacls` on both surviving
files reports **two** non-owner Modify+Delete ACEs inherited from `%TEMP%` —
`dollarstore\CodexSandboxUsers` and an unresolved SID
(`S-1-5-21-…-1568765756`). The interesting consequence for *this* leaf is not
read but **write**: `%TEMP%` grants `(OI)(CI)(M,DC)`, so between
`build_mcp_spawn`'s `fs::write` (`pty.rs:587`) and the child's read, another local
account can rewrite the `url` in that JSON and redirect the session's MCP
transport.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head is
physically separated and each clause carries its warrant, so an adopting repo can
tell physics from local calibration. **No sibling in the fleet has an embedded
terminal at all (§12.1), so every clause below is warranted from this repo's own
measurements and must be treated as untested elsewhere.** No file path,
primitive name or count appears until the head ends.

> **P1 — the whole subject.** *A terminal is a claim that a process is listening.
> Every path that releases the process must also change the claim.* A screen full
> of text and a blinking cursor are an assertion about a live counterparty. If the
> runtime can free that counterparty — for a resource floor, a sleep policy, an
> eviction, a crash — then the surface must stop asserting, in the place the user
> is looking, before the first keystroke is lost. A badge in a header beside the
> terminal is not that place.
>
> **P2.** *Typing is an interaction, and a failed interaction is user-facing by
> definition.* The rule "log background failures quietly, surface foreground ones"
> is not a style preference here: the user pressed a key, nothing appeared, and
> the terminal is the one surface with no local echo to fall back on. Route the
> failure of anything the user just did to the same door you route your own
> programmatic failures to — and if those two doors are different, you have
> already decided that your messages matter more than theirs.
>
> **P3.** *Buffer at the producer, forward only to a watcher, replay on attach.*
> A bounded byte ring that the reader always pushes into keeps the child's pipe
> from filling regardless of who is watching; a subscription flag keeps N idle
> sessions off the IPC boundary; a snapshot served at attach is what makes a
> re-focused terminal continuous. These three are one mechanism and adopting two
> of the three buys almost nothing.
>
> **P4.** *Bound the stream in bytes and the instances in count, and derive both
> from the producer.* A terminal's "lines" are repaints, not messages, so a line
> cap bounds nothing. And the client-side population is its own resource: one
> retained terminal is a scrollback, forty is a memory leak with a UI.
>
> **P5 — the geometry is one value.** *Width and height travel together or they
> get transposed.* Two positional integers of the same type, clamped
> independently at each crossing, is a defect waiting for a refactor; and the
> clamps make a transposition silent rather than loud.
>
> **P6 — resize is not free.** *A geometry change invalidates every model derived
> from the geometry.* If the runtime keeps an incremental screen model — and it
> should — a resize throws it away and re-parses the whole buffer. So a resize
> must be driven by a settled layout, not by every frame of one, and the surfaces
> that change geometry en masse (a density switch, a grid open) must coalesce.
>
> **P7 — arbitration is by phase, not by rank.** *A focused terminal owns the
> keyboard, and the only way an application surface can take a key from it is to
> listen before the focused element does.* A priority ladder decides who among the
> application's own handlers goes first; it says nothing about the child process.
> Whichever way a repo resolves a contested key, it must resolve it **once**, in
> one place, and write down which side wins — because two surfaces hosting the
> same terminal will otherwise resolve it in opposite directions and neither
> author will know.
>
> **P8 — the artefact outlives the session unless a value owns it.** *A
> per-session file, directory, socket or token released by a task's exit path is
> released only on the paths that reach that exit.* Attach it to a value whose
> destruction is the release. Otherwise the operating system becomes your garbage
> collector, on its own schedule, and it will delete the contents and leave the
> container.
>
> **P9 — identity.** *A session has at least two names and you will store the
> wrong one.* The runtime's id and the terminal-owner's id are different values
> with different lifetimes; on-disk artefacts, ledger rows and UI addresses each
> pick one. Normalise at every door that accepts an id from outside, and never let
> one column hold both.
>
> **Scale condition.** P1, P2 and P7 are correctness on the *first* session. P3
> and P4 begin to pay at the second concurrent one. P5, P6 and P8 arrive silently
> and are discovered by an audit. P9 is discovered the first time someone asks
> "which conversation was that?"

---

## 1 Trigger

- "Show the actual terminal for this session, not a log."
- "Let the user type into the agent."
- "The terminal goes blank / stops responding when I come back to it."
- "Keep the scrollback when they switch tabs."
- "It should resize with the pane."
- "Escape doesn't do what I expect in here."
- "Why is there a `<uuid>` folder in my temp directory?"

**If you are about to type** `openpty`, `PtySize`, `new Terminal(` from
`@xterm/xterm`, `FitAddon`, `term.onData`, `attachCustomKeyEventHandler`,
`writer.write_all`, `master.resize`, a `cols`/`rows` pair as two arguments, a
`VecDeque<u8>` with a byte cap, or `addEventListener('keydown', h, true)` on a
page that also renders a child process's output — **you are in this situation.**

You are also in it, and this is the case people miss, if you are about to **free
the process behind a surface the user is still looking at** — a sleep pass, an
eviction, a concurrency cap, a hibernate.

**Not this path:** a parsed line stream in a scroll container is
[live-log-stream-view](./live-log-stream-view.md); the child's argv, cwd and env
are [spawning-a-cli-subprocess](./spawning-a-cli-subprocess.md) and
[credential-injection-into-child](./credential-injection-into-child.md); keeping
a handle on the work you started is
[agent-dispatch](./agent-dispatch.md); what the *row* says when the process dies
is [terminal-state-and-recovery](./terminal-state-and-recovery.md); the
priority ladder among the app's own shortcuts is
[keyboard-shortcut-registration](./keyboard-shortcut-registration.md).

## 2 The one way

**Make the surface a function of whether a process is listening, and make every
other decision at the producer.** Concretely: (a) **give the session one bounded
byte ring that the reader always pushes into and forwards from only while
subscribed, and serve `snapshot()` on attach** — `registry.rs:33-136` plus
`pty.rs:634-684` is the whole mechanism and it should never be re-derived;
(b) **render the terminal from a liveness fact, not from a status token** — the
record already knows whether it holds a process, and a surface that branches on
"is it exited?" will keep painting a live-looking cursor over every state that
frees the process for a reason other than death; (c) **when the runtime releases
a process under a mounted terminal, change the terminal** — disable input, say
so *inside* the viewport, and offer the resume as an explicit act, because a
badge in the chrome is not where the person typing is looking; (d) **route the
failure of a keystroke, a paste and a resize to the same door your own
programmatic writes use** — if yours toasts and the user's is silent, that is the
bug; (e) **arbitrate contested keys once**: a focused terminal wins the bubble
phase by itself, so the only real decision is whether any surface listens in the
**capture** phase, and that decision belongs in one place with a written reason
(§9 ratchets it); (f) **carry width and height as one value** and clamp it in that
value's constructor, never at each crossing (§"Prefer a type over a gate");
(g) **coalesce resizes to a settled layout** — a geometry change invalidates the
incremental screen model, so a per-frame `ResizeObserver` fires a per-frame
full-buffer re-parse; (h) **own the per-session artefact with a value whose `Drop`
removes it**, never with a statement in a reaper's exit path; and (i) **normalise
the session id at every door that takes one from outside**, and never let one
column hold two id spaces.

If you must get one right first: **(c)**. It is the only one whose failure the
user experiences as the app lying to them, it fires by default on every session
after 60 seconds, and everything else in §7 is a consequence of the surface not
knowing.

## 3 Mandated primitives

**Exist today — use them.**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/commands/fleet/registry.rs:41` `OutputRing` (+ `OUTPUT_RING_CAP = 512 KiB`, `:33`) | **the best streaming buffer in the tree.** Byte-accounted drop-oldest ring; a `subscribed` flag so the reader always drains but only forwards when watched; `snapshot()` (`:133`) replayed at attach; a wrapping `rev` change-cursor; a `watch` channel so waiters block instead of poll; and an **incrementally-fed `vt100::Parser`** (`:60`, `:104-115`) that makes a steady-state screen read O(screen) instead of O(512 KiB) |
| `pty.rs:602-685` the reader loop — subscribe-check and push under **one** ring lock (`pty.rs:653-657`) | the reason a 16-session fleet costs what one watched session costs |
| `registry.rs:147` `preview_lines` / `:162` `render_screen` | the two cheap read shapes: a bounded-tail line cook for an unwatched tile, and a real VT reconstruction for a cursor-addressed TUI. Do not hand-roll a third |
| `registry.rs:738` `write_text_line` | the **only** correct way to deliver a *line* to an interactive session: text and Enter as separate chunks (a paste-shaped `\r` does not submit), a settle wait, a submit confirmation, one retry. Read its docstring before writing any programmatic input |
| `src/features/plugins/fleet/fleetTerminalManager.ts` | the client half: one xterm per session id parked in a detached holder, **one** app-wide `fleet-session-output` listener dispatching into a map (`:203-223`), an LRU bound on parked instances (`MAX_PARKED = 6`, `:186`), and the hydrating/`pendingLive` splice (`:434-459`) that closes the attach race |
| `src/features/plugins/fleet/FleetTerminalPane.tsx` | the mount point. Attaches on mount, **detaches (not disposes)** on unmount. Compose it; never construct a `Terminal` yourself |
| `src-tauri/src/commands/fleet/bench.rs` | **performance gates for exactly this leaf** — relative-invariant, machine-independent, with the reasoning for why absolute p99 baselines were rejected. §9 is about why they execute nowhere |
| `companion_api.rs:469-475` `sanitize_reply` | the control-character strip for text arriving from outside the process. The one input door that has it |
| `src-tauri/src/commands/fleet/keys.rs` | the named key byte sequences. Do not inline `"\x1b[C"` |

**Do not exist — this path names them.**

- **A liveness predicate the render path can ask.** `FleetSession` carries
  `dozing` and `childPid`; the four terminal hosts branch on
  `state === 'exited' || state === 'hibernated'` and none reads either
  (`FleetGridPage.tsx:736`, `FleetOverlayTile.tsx:~40`, `MonitorView.tsx:106-107`).
- **A `TerminalSize` value.** The pair crosses **19** boundaries as two
  positional integers against **2** as a named struct, and both of those are
  `portable_pty::PtySize` — the vendored crate's type, not one this app wrote.
- **A resize coalescer.** `scheduleFit` (`fleetTerminalManager.ts:251-263`)
  coalesces to one animation frame; nothing coalesces across frames, and
  `pushResize` fires an IPC even when `fit()` changed nothing.
- **A capture-phase policy.** Two files in 4,829 register a key listener in the
  capture phase; they do it for opposite reasons and neither knows about the
  other. §9.
- **An owner for the scrollback across a restart.** The ring is memory; the
  durable row is `fleet_sessions` and it stores no output; the reload path is
  `claude --resume`, which restores the *conversation* and not the *screen*.
- **A second `TerminalBody`-style shared terminal.** Correct as-is: there is one
  xterm manager and one pane, and the six host surfaces all go through them.

## 4 Steps

1. **Decide what releases the process, before you write the view.** Enumerate
   every lane that can free the child — user kill, sleep, an idle floor, an
   eviction cap, a crash reaper, a restart — and write the list down. In this repo
   it is six: `close_pty_handles` (`registry.rs:1115`), `hibernate` (`:1147`),
   `doze` (`:1192`), `mark_exited` (`:1047`) from the reaper, `free_slot_for_spawn`
   (`stale.rs`), and rehydration (`persist.rs:147`, which produces a row with no
   process by construction).
2. **Put the ring on the producer and make the subscription the forwarding
   switch.** `OutputRing` + the reader loop. Push unconditionally; take the
   subscription check and the push under one short lock.
3. **Serve `snapshot()` on subscribe** and have the client `reset()` then write it
   before any live chunk. Queue live chunks arriving during the round trip and
   flush them after — `fleetTerminalManager.ts:434-459` is the model, including
   the `hydrationGen` cancel for rapid switching.
4. **Render the terminal from a liveness fact.** `session.childPid != null &&
   !session.dozing`, or a single `isAttachable` field the backend computes. Not a
   status token, and not a tombstone predicate.
5. **When it is not live, change the viewport.** Disable input, put the reason
   *inside* the terminal area, and make the resume an explicit control. Then stop
   — do not also try to keep the cursor blinking "so it looks connected".
6. **Route every user-initiated failure to the visible door.** `toastCatch`, not
   `silentCatch`, for keystroke, paste and resize.
7. **Carry the geometry as one value** and clamp in its constructor. Then
   coalesce: debounce the observer to a settled layout, and skip the IPC when the
   computed size equals the last one sent.
8. **Give the per-session artefact a guard.** A struct whose `Drop` calls the
   release, returned from the function that creates the artefact — the repo
   already has this shape at `engine/src/cli_mcp_config.rs:338`.
9. **Then stop.** No second xterm construction. No per-terminal `listen()`. No
   second stickiness/scroll effect — xterm owns the viewport. No capture-phase key
   listener without a written reason.

## 5 Anti-patterns

- **Keeping a terminal interactive after the runtime freed its process.**
  *Failure mode:* the user types into a blinking cursor and nothing happens, with
  no error, no echo and no explanation. **Measured: `DOZE_AFTER_SECS = 60`
  (`stale.rs:1182`), always on, targeting `Stale`/`AwaitingInput`; the grid mounts
  a live terminal for `awaiting_input` (`fleetAttention.ts:103`); the only visual
  delta is a `w-3 h-3` moon glyph in the tile header
  (`FleetOverlayTile.tsx:70-79`).**
- **Sending the user's failures to a silent sink while sending your own to a
  toast.** *Failure mode:* the app is louder about its own messages than about the
  operator's. **Measured: 17 `silentCatch` / 0 `toastCatch` in
  `fleetTerminalManager.ts`, against `toastCatch` at `useFleetOverlayActions.ts:155`,
  `FleetGridPage.tsx:260` and `:271`, both inside a `toastCatch`, for the same
  underlying IPC call.**
- **Deciding a contested key by listener phase instead of by policy.** *Failure
  mode:* two surfaces hosting the same terminal resolve the same key in opposite
  directions and neither author knows. **Measured and verified against the
  vendored bundle: xterm's `_keyDown` calls `cancel(e, true)`, which is
  `preventDefault(); stopPropagation()` (`@xterm/xterm@6.0.0`
  `lib/xterm.js`), so a focused terminal already wins every bubble-phase listener
  in the app. `MonitorView.tsx:94` registers `keydown` with `capture: true` and
  calls `stopPropagation()` — Escape reaches the app and *never* reaches the
  child. `FleetTerminalOverlay.tsx:155` registers the same key in the bubble phase
  — Escape reaches the child and *never* closes the overlay while the terminal is
  focused. Two surfaces, one key, opposite answers, no comment in either file.**
- **Treating a synchronous `Ok` as delivery for an asynchronously confirmed
  write.** *Failure mode:* a success toast for a message still sitting in the
  composer. **Measured: `write_text_line` (`registry.rs:738-851`) writes the text,
  spawns a **detached** task to send Enter and confirm, and returns `Ok(())`
  immediately; `useFleetOverlayActions.ts:148-153` raises a success toast on that
  `Ok`. 9 Rust call sites plus 5 frontend call sites reach it — the latter through
  the shape heuristic at `commands.rs:91`, which routes any multi-character text
  ending in a newline into the confirm-and-retry machinery.**
- **Stripping exactly one trailing newline from a paste.** *Failure mode:*
  `pasteFromClipboard` (`fleetTerminalManager.ts:240`) does
  `textRaw.replace(/\r?\n$/, '')`, so clipboard text ending in a blank line still
  ends in `\n`, satisfies `commands.rs:91`, and is **submitted** — plus a
  Right-arrow and a second Enter if the first submit does not confirm within 4 s
  (`registry.rs:775-785`). Two of the three paste routes on Windows
  (right-click, Ctrl+Shift+V) bypass xterm's bracketed-paste wrapping and take
  this path; only Ctrl+V does not.
- **A `cols`/`rows` pair as two positional integers.** *Failure mode:* a
  transposition is not a type error, and the independent `.max(8)` / `.max(40)`
  clamps (`registry.rs:884-885`, `pty.rs:254-255`) make it silent rather than
  loud. **Measured: 19 crossings as a positional pair, 2 as a named struct — and
  both of those are the vendored `PtySize`.**
- **Driving a resize from an unthrottled layout observer.** *Failure mode:*
  every frame of a window drag issues an IPC, each geometry change invalidates
  `parser_dims` (`registry.rs:171-177`) and the next screen read re-parses the
  whole 512 KiB ring — the exact cost the incremental model exists to avoid, and
  which `bench.rs:204-227` has a test for. **Measured: `ResizeObserver` →
  `scheduleFit` → `fit()` → `pushResize` with a single rAF between them, no
  cross-frame coalescing, and `pushResize` unconditional after `fit()`.**
- **Hard-coding a restore geometry.** `persist.rs:165-166` rehydrates every row at
  `cols: 120, rows: 32` regardless of what the operator's terminal was, and
  `resize` (`registry.rs:888-889`) writes the stored dims **before** it checks
  whether a master exists — so a resize that fails still moves the number the
  screen model will be rebuilt at.
- **Releasing a per-session artefact from a task's exit path.** *Failure mode:*
  the OS becomes your garbage collector. **Measured: 6 directories created, 0
  removed by the app, 4 emptied by a Windows sweep 7–8 days later, 6 of 6
  directories still present.**
- **Letting one column hold two id spaces.** **Measured: 7 of 25 `session_id`
  values in `fleet_decisions` are Claude session ids; one uuid appears in both id
  columns; `resolve_session_id` has 5 call sites and none of them is a Fleet
  command.**

## 6 Evidence

**The ONE site to copy: `src-tauri/src/commands/fleet/registry.rs:41-136`
(`OutputRing`) together with its reader loop at `pty.rs:602-685`.** It is the only
implementation in six codebases that answers all four of this leaf's questions at
once — the reader *always* pushes so the child's pipe never fills; the
subscription check and the push are taken under **one** short ring lock
(`pty.rs:653-657`) so the per-read hot path never touches the registry map;
`snapshot()` is replayed at attach (`registry.rs:1010-1016`) so a re-focused
terminal hydrates from the ring instead of a re-streamed history; the bound is in
**bytes** (512 KiB), which is the honest unit for a stream whose "lines" are
repaints; and the incrementally-fed `vt100::Parser` means a screen read costs
O(screen) at steady state. Copy it whole.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `fleetTerminalManager.ts:203-223` | **one** app-wide listener dispatching into a registry map — O(1) per chunk regardless of terminal count |
| `fleetTerminalManager.ts:434-459` | subscribe → queue live → reset → write snapshot → flush queue, with a `hydrationGen` that cancels a superseded resolution |
| `fleetTerminalManager.ts:180-194,480-494` | an explicit LRU on *client instances*, with the reason written down: a re-attach replays the ring, so disposing a parked terminal is lossless |
| `registry.rs:738-772` docstring | the best defect narrative in the fleet: why a pasted `\r` does not submit, with the live date and the observed consequence |
| `registry.rs:1132-1146` `require_resting` | a TOCTOU race closed by re-checking the state *inside the same lock as the mutation*, with the "ate my work at 2am" failure named |
| `pty.rs:97-181` `OscTitleScanner` | a byte-at-a-time incremental scanner whose state persists across PTY reads, so a title split mid-chunk still assembles — with five unit tests |
| `pty.rs:698-709` | reinterpreting a Windows `u32` exit code as `i32` rather than saturating, because an NTSTATUS saturated to `2147483647` is how "it vanished without warning" got reported |
| `companion_api.rs:469-475` | strip every control character from text that arrived from outside the process, and say why in the comment |
| `bench.rs:1-46` | why **relative** performance invariants beat committed p99 baselines, including the measurement that ruled out synchronized-update frame markers |

### Convergence — five siblings, run 2026-08-16

All five checkouts exist and were opened. **Nothing is reported by omission.**

| | personas-web | brainiac | personas-cloud | vibeman | ascent |
| --- | --- | --- | --- | --- | --- |
| a PTY (`node-pty` / `portable-pty` / `openpty` / ConPTY) | **✗** | **✗** | **✗** | **✗** | **✗** |
| an xterm-class terminal emulator in the UI | **✗** | **✗** | **✗** | **✗** | **✗** |
| keystrokes → child | ✗ | ✗ | ✗ | whole messages on submit | ✗ |
| a resize path to the child | ✗ | ✗ | ✗ | **✗** | ✗ |
| bounded producer buffer | n/a | n/a | n/a | ✔ 500/1000 | ✔ 4 MB / 16 KB byte caps |
| replay on re-attach | n/a | n/a | n/a | ✔ subscribe-then-flush | n/a |
| durable across restart | n/a | n/a | n/a | ✔ SQLite + on-disk logs | n/a |
| client instance cap | n/a | n/a | n/a | **✗** (unbounded in-memory events) | n/a |
| per-session temp artefact cleanup | n/a | n/a | ✔ `rmSync` | DB row delete + reaper | none created |
| `--dangerously-skip-permissions` | n/a | n/a | **✔** | **✔ batch only; interactive deliberately not** | ✗ |

Verified twice: the sibling sweep was run by an inventory pass and then
re-checked directly with a dependency-and-source grep for
`node-pty|portable-pty|@xterm|openpty|CreatePseudoConsole|winpty` across each
checkout — **zero hits in all five.**

**Three results this document rests on.**

**(a) The leaf is a 5/5 silence, so the head is local calibration.** Personas is
the only repo in six with a real pseudo-terminal. Every clause in the Principle
head is warranted from this repo's own measurements and **must be treated as
untested elsewhere** by an adopting repo. That is a finding about the spine's
label, not a gap in the sweep — see §12.1.

**(b) The two clauses that *do* have external warrant are P3 and P4, from one
repo.** `vibeman` independently arrived at a bounded producer ring
(`cli-service.ts:700-706`, cap 500, trimmed at 1000), subscribe-then-flush replay
(`api/claude-terminal/stream/route.ts:219-230`), and durable session rows — three
of this path's mechanics, reinvented without a pty. It also demonstrates the
other half of P4 by omission: its **server** ring is bounded and its **client**
event array is not (`manualSessionStore.ts` appends at five sites; the 100-entry
cap is applied only in the persistence partializer at `:813`). Personas has the
mirror-image shape — a bounded client LRU and a bounded server ring — which is
the only place in this document where Personas is ahead of a sibling that
actually built the thing.

**(c) `vibeman` resolves the contested key the same way one of Personas' two
surfaces does, and for a reason Personas does not have.** Its session modal's
`onKeyDown` handles only Enter; Escape falls through to `BaseModal`'s
document-level handler and closes the modal (`components/ui/BaseModal.tsx:38-44`).
That is `MonitorView`'s answer. It is *correct there* — there is no child
listening for `\x1b` — and it is the same code shape that, over a real PTY,
removes Escape from a running agent. **The shape converges; the justification does
not travel.**

### A collision with a neighbour's prescription

[`live-log-stream-view`](./live-log-stream-view.md) §2(g) prescribes
*"auto-scroll only while the user is already at the bottom — compute
distance-from-bottom in an `onScroll` handler, store it in a ref, gate the pin on
it"*, and its §9 rule `unconsulted-tail-pin` ratchets the absence of that guard.
Applied to a terminal, it is wrong in both halves: a VT emulator owns its own
viewport, alternate-screen mode has no scrollback to be "at the bottom" of, and
an app-level scroll handler on the xterm container will fight the emulator's own
`scrollOnUserInput`. **The two prescriptions do not overlap in code today** —
`unconsulted-tail-pin`'s 13 sites include zero fleet-terminal files — but the
boundary is not written down anywhere, and the obvious reading of that path's
trigger ("It should scroll as new output arrives") points straight at this one.
Recorded here rather than filed against that rule: **the discriminator is whether
the surface owns the viewport or the producer does.**

## 7 Deviations

Every entry is live on `master` @ `b4a05049e`.

> **Second pass — what is upstream of all of this.** Every item below reduces to
> one omission: **the terminal is rendered from a status token and the process is
> managed by a lifecycle.** The two never meet. `dozing` and `childPid` are both
> in the DTO the view already receives; four host surfaces read neither; six lanes
> can free the process; and the one signal that does reach the view is a 12-pixel
> glyph in the chrome. **The fix that closes the most entries is not a new
> mechanism — it is one boolean on the render path, plus routing the user's own
> failures to the door the app already uses for its own.**

### P0 — a terminal stays interactive over a process the app killed 60 seconds ago

| Path | What's wrong |
| --- | --- |
| `src-tauri/src/commands/fleet/stale.rs:1182,1244` | `DOZE_AFTER_SECS = 60`, always on, no toggle; kills the child of any `Stale`/`AwaitingInput` session. |
| `src/features/plugins/fleet/fleetAttention.ts:102-104` + `FleetTerminalOverlay.tsx:260` | the grid mounts a **live** terminal for exactly `awaiting_input`. |
| `src/features/plugins/fleet/FleetGridPage.tsx:735-758` · `FleetOverlayTile.tsx:114-121` · `sub_monitor/MonitorView.tsx:106-107,148-149` · `teams/sub_factory/passport/passportFleet.tsx:118` | the render branch tests `state === 'exited'` / `'hibernated'`; **`dozing` and `childPid` are in the DTO and read by none of the four.** |
| `src/features/plugins/fleet/FleetTerminalPane.tsx:32-38` | attaches unconditionally; subscribes; hydrates. It has no liveness input at all. |
| `src/features/plugins/fleet/fleetTerminalManager.ts:307` | `cursorBlink: true` — the cursor blinks identically over a live and a freed process. |

**Fix:** compute `isAttachable` on the DTO (`registry.rs:440` `to_dto`) as
"holds a writer", pass it into `FleetTerminalPane`, and when false render the
last screen **non-interactive** with the reason in the viewport and a Resume
control. One field, four call sites, and it retires this entire section's
premise. *Behaviour-changing on a surface the operator watches — do not merge in
a wave.*

### P0 — the operator's keystrokes fail silently while the app's own writes toast

| Path | What's wrong |
| --- | --- |
| `src/features/plugins/fleet/fleetTerminalManager.ts:357` | `writeInput(sessionId, data).catch(silentCatch('fleetTerminal:writeInput'))` — the keystroke path. |
| `.../fleetTerminalManager.ts:241,248` | paste and resize, same sink. |
| `.../fleetTerminalManager.ts` (file) | **17 `silentCatch`, 0 `toastCatch`.** |
| `src/features/plugins/fleet/useFleetOverlayActions.ts:148-155` · `sub_grid/FleetGridPage.tsx:260,271` | the same IPC call, wrapped in `toastCatch`. |

The repo's own doctrine (`CLAUDE.md` § Error Handling) is
*"`toastCatch()` for user-facing errors, `silentCatch()` for background errors."*
A keystroke is not a background error. **Fix:** `toastCatch` on the three
user-initiated paths, with a debounce so a held key does not stack toasts.

### P0 — the same key resolves in opposite directions on two surfaces that host the same terminal

| Path | What's wrong |
| --- | --- |
| `src/features/plugins/fleet/sub_monitor/MonitorView.tsx:88-95` | `window.addEventListener('keydown', onKey, true)` + `e.stopPropagation()` on Escape. Capture phase runs **before** the target, so the focused xterm never sees it: **Escape can never reach the child from this surface.** |
| `src/features/plugins/fleet/FleetTerminalOverlay.tsx:152-155` | `window.addEventListener('keydown', onKey)` — bubble phase. xterm's `cancel(e, true)` already called `stopPropagation()`, so **Escape reaches the child and never closes the overlay** while a terminal is focused; it closes the overlay only when focus is elsewhere. |
| both | no comment in either file acknowledges the child, the phase, or the other surface. |

Escape is load-bearing in Claude Code's TUI (cancel the turn, dismiss a menu,
leave a mode). **Fix:** decide it once. The defensible answer is *the child wins
while its terminal is focused* — which is what xterm already does for free, so
`MonitorView` should drop `capture: true` and the overlay should keep its
bubble-phase handler. Write the sentence in both files. §9 ratchets the capture
phase until it lands.

### P1 — the per-session temp directory is released by a task, and the OS is doing it instead

`pty.rs:514-528` (and the hand-copied twin at `headless.rs:251-262`) put
`release_session_tokens` + `cancel_for_session` + `remove_dir_all` inside the
reaper's `spawn_blocking` closure. **Measured: 6 created, 0 removed by the app;
Windows deleted 4 token files 7.2–7.9 days later at 04:49 and left every
directory.** The comment at `pty.rs:517-521` is right that these must happen
exactly once and wrong that coupling them to the reaper makes them happen at all.

**Fix:** return a guard from `build_mcp_spawn` whose `Drop` performs all three —
the shape already exists at `engine/src/cli_mcp_config.rs:338` — which also
deletes the duplicated block in `headless.rs`. Ownership of the *token in* the
file stays with
[`credential-injection-into-child`](./credential-injection-into-child.md) §7.B;
this entry adds the seven-day OS-sweep measurement and the second inherited ACE.

### P1 — `write_text_line` returns `Ok` before the submit is confirmed, and a caller toasts success on it

`registry.rs:750-851`: the text is written synchronously, then a **detached**
`tauri::async_runtime::spawn` performs the settle wait, the Enter, the
confirmation, and one retry that first sends a Right-arrow. The function returns
`Ok(())` at `:850`. `useFleetOverlayActions.ts:148-153` raises
`skill_applied_toast` on that `Ok`. **14 doors reach this** — 9 Rust call sites
plus 5 frontend `writeInput(…, "…\r")` sites routed in by `commands.rs:91`.

The failure *is* recorded, thoroughly, at `registry.rs:822-838` — into the debug
log and `tracing::warn!`. **It reaches no caller and no surface.**
[`panic-isolation`](./panic-isolation.md) owns the detached-task class and
already gates it (`unobservable-detached-task`, 86/169); this entry is the
outcome half: **the value the caller gets is a claim the callee cannot support.**

### P1 — a paste can submit itself, twice

`fleetTerminalManager.ts:240` strips one trailing newline; `commands.rs:91`
treats any remaining trailing newline on multi-character text as "this is a line,
submit it". Clipboard content ending in a blank line therefore submits, and if the
submit is not confirmed within `SUBMIT_CONFIRM_TIMEOUT = 4 s` the retry sends
`keys::RIGHT` and a second `\r` (`registry.rs:767-786`). On Windows, two of the
three paste routes take this path — right-click (`:374-378`) and Ctrl+Shift+V
(`:381-394`) both call `pasteFromClipboard` directly, bypassing xterm's
bracketed-paste wrapping; only Ctrl+V goes through xterm.

**Fix:** strip *all* trailing newlines in `pasteFromClipboard`, and give
`fleet_write_input` an explicit `mode: 'raw' | 'line'` parameter instead of
inferring intent from the last character.

### P1 — the geometry is two integers, and the restore geometry is a constant

| Path | What's wrong |
| --- | --- |
| `registry.rs:879` `resize(&self, session_id, cols, rows)` vs `registry.rs:162` `render_screen(&mut self, rows, cols)` vs `pty.rs:253` `PtySize { rows, cols }` | three orders for one pair in one module. |
| `registry.rs:884-889` | clamps `.max(8)`/`.max(40)` re-applied per crossing, so a transposition is silently corrected into a wrong-but-legal size rather than rejected. |
| `registry.rs:888-889` | the stored dims are written **before** the master-exists check at `:891`, so a resize that returns `Err` still moves the number `render_screen` will rebuild at. |
| `persist.rs:165-166` | every rehydrated row restores at `cols: 120, rows: 32`. |
| `commands.rs:37-38,204-205` | spawn and wake default to 120×32 independently. |

**Measured: 19 positional crossings against 2 named-struct ones, and both of
those are `portable_pty::PtySize`.** All 19 are currently in the right order —
hand-checked — which is why §9 declines to gate this and
"Prefer a type over a gate" proposes the value instead.

### P2 — resize is per-frame and invalidates the incremental screen model

`fleetTerminalManager.ts:397` observes the holder with a `ResizeObserver`;
`scheduleFit` (`:251-263`) coalesces to one animation frame and then calls
`pushResize` **unconditionally**, even when `fit()` computed the same size.
`setFleetFontOverride` (`:554-562`) and `configureFleetTerminals` (`:536-547`)
each call `scheduleFit` for **every attached terminal**, and
`FleetTerminalOverlay.tsx:135-139` invokes the first on every grid open and on
every change of grid density. On the backend a changed size trips
`parser_dims != (rows, cols)` (`registry.rs:171`) and the next screen read
re-parses the whole 512 KiB ring — the cost `bench.rs:158-198` exists to protect.

**Fix:** skip the IPC when the size is unchanged (two lines in `pushResize`), and
debounce the observer to a settled layout rather than one frame.

### P2 — the terminal container is hard-coded to the dark theme

`FleetTerminalPane.tsx:43` — `className={h-full w-full bg-[#0a0a0c] …}`. That hex
is `DARK_THEME.background` (`fleetTerminalManager.ts:82`). The manager ships a
full `LIGHT_THEME` (`:107-129`) and applies it live, so in light mode xterm paints
`#fbfbfd` inside a container painted `#0a0a0c`. **The same literal appears at 9
sites across the fleet surfaces.** Also a raw-hex deviation from
[`design-token-usage`](./design-token-usage.md).

### P2 — two live siblings of the byte-index slice that panicked in a detached task

The 2026-08-16 fix at `wait.rs:191-199` asked for a search for the same shape.
There are two, both on CLI output, both in a failure-reporting path:

| Path | What's wrong |
| --- | --- |
| `src/commands/credentials/auto_cred_browser.rs:901` | `&trimmed_full[trimmed_full.len() - 500..]` where `trimmed_full` is assistant prose from a `StreamLineType::AssistantText` — routinely non-ASCII. |
| `src/commands/credentials/auto_cred_browser.rs:1291` | `&spawn_result.text_output[spawn_result.text_output.len() - 1000..]`, and the comment two lines below calls it *"verbatim CLI stdout"* — precisely the text that broke `wait.rs`. |

Both build a crash report and the user-facing failure guidance, so the panic
fires exactly when something has already gone wrong. Neither is inside a detached
task, so they are louder than the `wait.rs` case — but they are the same defect.
**Fix:** the same forward-walk to a char boundary, or better, one shared
`tail_chars(s, n)` helper (the repo has three independent open-coded fixes for
this class already: `wait.rs:191`, `eval.rs:523`, `runner/mod.rs:2467`).

### P3 — the id spaces, and the ledger that holds both

`fleet_decisions`: **10 of 46 rows have an empty `session_id`; 7 of the 25
non-empty values are Claude session ids** (verified by matching
`~/.claude/projects/**/<id>.jsonl`); one uuid appears in both id columns; 31 of 46
have a NULL `claude_session_id`; 35 of 46 have an empty `screen_hash`.
`registry.rs:546` `resolve_session_id` normalises either form and has **5
production call sites, all in the companion lane and none in
`commands/fleet/commands.rs`**.

### 7.I — what this path CLEARED

Five things that look like defects and are not:

1. **The output ring is genuinely well built.** Byte-bounded, always-drained,
   subscription-gated, snapshot-replaying, incrementally parsed, and with a
   `watch` channel so waiters block. Nothing in six repos is close.
2. **No live `cols`/`rows` transposition exists.** All 19 positional crossings
   were traced by hand and every one is in the correct order. The deviation is the
   hazard, not a bug.
3. **`fleet_sessions` being empty is not a broken writer**, confirming
   `agent-dispatch` D10 from a second angle: 26 sessions ran in five days and none
   was rehydratable by design, because the retention and the bound-id filter both
   applied.
4. **The LAN companion API is the careful door**, not the leaky one — LAN-peer
   check, device token, five-verb allowlist, per-act audit, 500-char cap and a
   control-character strip. It is the local door that has none of that.
5. **The client-side LRU is right and its reasoning is written down.**
   `MAX_PARKED = 6` with the note that a re-attach replays the ring, so disposal
   is lossless — the exact argument P4 wants, already made.

### Structural

- **Every deviation above shipped under a green `npm run check`.** No lint rule,
  script or hook in this repo has any opinion about terminal liveness, keystroke
  failure surfacing, listener phase, or per-session artefact cleanup.
- **`ci.yml` is red on pre-existing failures**, so §9 does not depend on it — and
  §9's first finding is that this leaf's *existing* gates depend on it entirely.

## 8 Gaps — what the primitives genuinely cannot do

1. **A ring cannot replay a screen across a process restart.** The scrollback is
   a property of a live emulator fed by a live producer. `claude --resume`
   restores the *conversation*; nothing restores the *screen*, and
   `persist.rs:190` gives every rehydrated row a brand-new empty ring. The leaf's
   own definition — "scrollback survives unmount" — holds for unmount and cannot
   hold for restart without persisting bytes nobody wants to persist.
2. **A VT screen model cannot be resized without being rebuilt.** Reflow is not
   what `vt100::Parser` does; `registry.rs:171-177` is the honest implementation.
   So resize cost is structural, and the only lever is how often you resize.
3. **Bracketed paste is the child's decision, not the terminal's.** Whether a
   pasted `\r` submits depends on a mode the child sets. Any heuristic on the
   parent side — including `commands.rs:91` — is guessing at the child's state,
   and there is no way to ask.
4. **Nothing can distinguish "the user typed nothing" from "the user typed and it
   was dropped" without an echo.** A PTY has no local echo by design, so a
   swallowed keystroke is indistinguishable from an idle terminal *from inside the
   terminal*. That is why P1/P2's fix has to be a change to the surface, not a
   better error path.
5. **The census can count a statement; it cannot see a phase interaction.** "This
   listener runs before the focused element" is true of a literal (`, true`) and
   that *is* countable — but "and the focused element is a terminal" is a
   relationship between two components, and it was found by reading the vendored
   emulator, not by matching anything.
6. **No type reaches a lifecycle.** `dozing: bool` on the DTO is correct
   TypeScript whether or not any view reads it. Nothing in a type system says
   "this field must be consulted before you render an input affordance."

## Prefer a type over a gate — the answer for this leaf

Held against all seven qualifications. **Two candidates: a `TerminalSize` value
for the geometry, and an attachable-handle type for the liveness. My answer is
that `TerminalSize` is worth shipping and does not touch a single defect in §7,
and the type that reaches the defects is one the client cannot construct at
all — which means the honest answer is a required prop, not a newtype.**

**Q1 — a required type carries only what it encodes.** `TerminalSize(cols, rows)`
encodes *"these two numbers belong together"*. It does not encode whether a
process is listening, which is what P0 is about. Tested against this document: it
prevents §7 P1's transposition hazard and **none** of P0, P1-silent-failure,
P0-Escape, or P1-temp-dir.

**Q2 — requiredness is orthogonal to closedness.** Making `FleetTerminalPane`'s
`sessionId` required changes nothing — it already is. The closedness that would
help is on the *value*: a session id that can only be obtained from a snapshot
row that also carries liveness.

**Q3 — a type nobody constructs constrains nothing.** Counted: `FleetTerminalPane`
has **6** call sites in 4,829 files, and `Terminal` from `@xterm/xterm` is
constructed **once** in the whole tree (`fleetTerminalManager.ts:303`). That is a
small but *complete* population — unlike `live-log-stream-view`'s `TerminalBody`
(5 of 19 scroll sites), here every terminal in the app goes through the one
manager. A type at that door reaches 6 of 6.

**Q4 — a type anyone can construct authenticates nothing.** `TerminalSize` with
public fields is a comment; it must clamp in its constructor
(`TerminalSize::new(cols, rows)` applying the `.max(40)`/`.max(8)` once) or it
just relocates the three duplicate clamps.

**Q5 — withholding beats requiring.** This is where the P0 answer is. The
dangerous capability is **a mounted, focusable xterm for a session with no
writer**. Withhold it: make `attachTerminal(sessionId, container)` take the
*session row* rather than the id — `attachTerminal(session: AttachableSession,
container)` where `AttachableSession` is produced only by a narrowing function
`asAttachable(s: FleetSession): AttachableSession | null` that returns `null`
unless the row holds a process. The caller cannot mount a terminal over a freed
process because it cannot construct the argument, and the `null` branch is where
the "not listening" viewport goes. All four host surfaces are forced to write it.

**Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is
*mounting an input-accepting emulator*. The **answer** the product needs is
*seeing the last screen of a sleeping session*, and taking that away would break
the feature — a dozed tile showing its last screen is the entire point of "keep
the displayed state". So the cut is: the **read-only** replay stays available to
any session with a ring; only the **attach-and-focus** path requires the narrowed
type.

**Q7 — withholding a requirement only helps when the requirement forced the bad
value.** ✔. Nobody is forced to mount a terminal over a dead session; four call
sites do it voluntarily because `sessionId: string` is all the pane asks for. So
relaxing a signature is inert, and it is the **construction of a bare session id
argument** that must be withheld.

**And the honest limit.** No type reaches the silent `catch` (a choice of
function), the listener phase (a boolean third argument to a DOM API), the
temp-directory cleanup (a missing `Drop` impl, which *is* a type but one the
compiler cannot demand), the paste heuristic (a string's last character), or the
id-space collision (two `String`s). **Recommended, in order:** (1) `isAttachable`
on the DTO + the narrowed attach argument per Q5 — one field, six call sites,
retires §7 P0; (2) `toastCatch` on the three user-initiated paths — three lines;
(3) drop `capture: true` at `MonitorView.tsx:94` and write the sentence in both
files; (4) an RAII guard for the MCP temp directory; (5) `TerminalSize` with a
clamping constructor; (6) keep §9's ratchet until (3) lands, then **delete** it.

## 9 The missing gate

### The first finding is that this leaf already has excellent gates and they execute nowhere

`src-tauri/src/commands/fleet/bench.rs` is **the best-designed §9 instrument this
composer has seen in the repo**: four relative-invariant performance gates over
this leaf's scale-critical paths, with a written rejection of committed p99
baselines (machine-specific, would flap) and a measurement ruling out
synchronized-update frame markers. It guards exactly the property §7 P2 puts at
risk.

Its own module doc, `bench.rs:42-46`, says:

> *"`app_lib`'s test binary currently fails to launch on this machine with
> `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139) … **These gates therefore run in CI
> until that is fixed.**"*

Two things are true at once. **The stated blocker has a documented fix in this
repo** — `CLAUDE.md`'s build section describes exactly this loader failure and
says *"Use `npm run test:rust`"*, which embeds the comctl32 manifest post-link;
the script exists (`package.json` → `node scripts/build/run-rust-tests.mjs`).
**And CI is red on 10 pre-existing failures**, while `lefthook.yml`'s pre-push
job runs no Rust test at all and `npm run check` runs no Rust test at all.

So: **four correct, well-argued gates for this leaf run in exactly zero places.**
That is a bigger §9 result than any new rule, and the remedy is two lines of
`lefthook.yml` plus deleting a stale comment. Recorded here as the first
recommendation, ahead of the census rule below.

### The condition, stack-free

> **An application surface takes a keystroke before the element it was typed into
> can see it — so a focused control that owns the keyboard is pre-empted with no
> way to object.**

The give-away is a listener registered to run **ahead of the target** rather than
behind it. Wherever that is true, the focused control cannot decline the key,
cannot consume it, and cannot even observe it; the arbitration is decided by
registration order rather than by focus. There is no runtime signal — a
pre-empting listener and a well-behaved one look identical whenever nothing
focusable is competing for the key, which is most of the time in a demo and never
when a terminal, an editor or an IME is on screen.

**The proxy, for this stack:** a third argument of `true` (or `{ capture: true }`)
on an `addEventListener` for `keydown`/`keyup`/`keypress`. An adopting repo must
re-derive its own proxy — a framework's `@keydown.capture`, a `useCapture` flag,
a global hotkey library's `priority` that bypasses focus, an OS-level hook.

**Why it earns its place on *this* leaf, and why it is not a preference:**
verified in the vendored bundle, xterm's `_keyDown` ends in `cancel(e, true)` =
`preventDefault(); stopPropagation()` (`@xterm/xterm@6.0.0`), so **a focused
terminal already wins every bubble-phase listener in the application, registry or
not.** The capture phase is therefore the *only* mechanism by which an app
surface can take a key away from a running child process — and exactly one of the
two capture registrations in 4,829 files does so, over a live PTY, for Escape.

### Existing rules checked first

I read all **135** rules in `scripts/census/rules.json` before authoring. Seven
were checked by name:

- **`unregistered-key-handler`** (`focus-management.md`, **72/72**, `roots: ["src"]`) —
  **the same anchor, and both of my matches are inside its 72.** Its pattern is
  `addEventListener\(\s*['"]key(?:down|up|press)['"]` with one exclude
  (`AppKeyboardProvider.tsx`, 2 listeners), which reconciles exactly with my
  independent count of **74**. Its condition is *"did this go through the
  registry"*; mine is *"does this run before the focused element"*. **They are not
  the same condition, and its prescribed fix does not resolve mine:**
  `AppKeyboardProvider.tsx:83` registers on `window` in the **bubble** phase and
  the registry exposes no capture option, so migrating a capture listener into it
  silently changes which side of a contested key wins. That is why the overlap is
  100% by file and 0% by condition, and it is stated plainly rather than hidden.
- **`unnamed-keyboard-priority`** (`keyboard-shortcut-registration.md`, 12/13) —
  keys on a `priority:` literal in a `useAppKeyboard` options object. **0 of my 2.**
- **`unconsulted-tail-pin`** (`live-log-stream-view.md`, 13/13) — scroll geometry
  in an effect. **0 of my 2**, and §6 records why it must stay that way.
- **`hand-rolled-outside-click`** (`anchored-popover.md`, 46/47) — `mousedown`/
  `pointerdown`, not keyboard. **0 of my 2.**
- **`unbound-child-lifetime`** (12/13) · **`shell-vehicle-nonliteral-arg`** (5/8) ·
  **`unobservable-detached-task`** (86/169) — all `roots: ["src-tauri"]`, disjoint
  by root.

### The rule

```json
{
  "id": "capture-phase-key-preemption",
  "goldenPath": "docs/concepts/golden-paths/embedded-terminal-session.md",
  "title": "A keyboard listener registered in the CAPTURE phase takes the keystroke before the focused element can see it — so a control that owns the keyboard (a terminal, an editor, an IME) is pre-empted with no way to object.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "addEventListener\\s*\\(\\s*['\"]key(?:down|up|press)['\"]\\s*,[^,()\\n]{0,80},\\s*(?:true|\\{[^}\\n]{0,80}capture\\s*:\\s*true)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A keyboard listener registered with the capture flag, so it runs on the way DOWN to the focused element instead of on the way back up. PROXY FOR the stack-free condition: 'an application surface takes a keystroke before the element it was typed into can see it.' MEASURED 2026-08-16 at b4a05049e: 2 files / 2 matches, BOTH HAND-READ (precision 2/2). Sites: src/features/plugins/fleet/sub_monitor/MonitorView.tsx:94 (window keydown, capture, e.stopPropagation() on Escape — this surface renders a LIVE PTY terminal at :149, so Escape can never reach the running claude child from it); src/features/vault/shared/vector/ingest/IngestDirectoryPicker.tsx:42 (window keydown, capture, whose own comment says 'Stop Escape from propagating to parent VectorKbModal' — capture-on-window is the wrong instrument for that goal, because it also pre-empts the picker's own focused text input). WHY IT IS A DEFECT AND NOT A PREFERENCE: verified against the vendored emulator rather than assumed — @xterm/xterm 6.0.0's _keyDown ends in cancel(e, true), which is preventDefault() PLUS stopPropagation(), so a focused terminal already wins every BUBBLE-phase listener in this app whether or not that listener went through the keyboard registry. The capture phase is therefore the only mechanism by which an application surface can take a key away from a running child process, and one of these two sites does exactly that. LEGAL FIX: drop the capture flag and let the focused element decline the key first; if a surface genuinely must pre-empt focus, keep the flag and write the reason plus the surfaces it pre-empts in a comment on the line above (the census strips comment lines, so a documented exemption still counts — use an `exclude` entry with a prose reason instead). DO NOT silence a match by moving the flag into a variable, by switching to a framework capture modifier, or by re-registering on a nested container — all three preserve the pre-emption. RELATIONSHIP TO unregistered-key-handler (focus-management.md, 72/72): same anchor, 100% file overlap, ZERO condition overlap — that rule counts whether a listener went through the app's keyboard registry, and the registry (AppKeyboardProvider.tsx:83) itself registers in the bubble phase with no capture option, so its prescribed fix cannot express what these two sites want and would silently flip which side of a contested key wins. END OF LIFE: this rule is designed to reach zero. When it does, the runner fails structurally on zero matches BY DESIGN — DELETE the rule then, do not baseline it at 0.",
    "$measured": "2026-08-16 @ b4a05049e — 4,829 files walked; two independent implementations agree that the complete anchor population is 74 (2 capture + 72 bubble), which also reconciles unregistered-key-handler's 72 (74 minus its 2 excluded AppKeyboardProvider listeners). Validated in a composer-private scratch registry (ets-rules-final.json), fault-injected 8 ways (all 8 fire), then re-extracted from this finished document and re-run through the real runner: 2/2 both times; 2.1 s for rule and control together."
  },
  "exclude": [],
  "baseline": { "files": 2, "matches": 2 },
  "floor": 3000
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "capture-phase-key-preemption-positive-control",
  "goldenPath": "docs/concepts/golden-paths/embedded-terminal-session.md",
  "title": "POSITIVE CONTROL — not a gate. The identical registration in the default BUBBLE phase: the compliant form the rule must never report.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "addEventListener\\s*\\(\\s*['\"]key(?:down|up|press)['\"]\\s*,[^,()\\n]{0,80}\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE — the phase-discrimination control for capture-phase-key-preemption, and it carries no baseline by design. SAME ANCHOR, same roots, same extensions, same walk; the only difference is whether a third argument requesting the capture phase is present. THE TWO POPULATIONS ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION (a registration either passes a third argument or it does not) and, measured, PARTITION THE ANCHOR EXACTLY: 2 + 72 = 74, which is every keyboard-listener registration in the tree by two independent implementations. MEASURED 2026-08-16 at b4a05049e: 71 files / 72 matches versus the rule's 2 / 2. A complete partition is what makes the rule's count mean 'how many listeners pre-empt focus' rather than 'how many listeners exist'. Run both together whenever the rule's pattern is edited: if this control collapses, the walk or the anchor broke rather than the codebase being fixed. It is expected to RISE as the 2 violating sites drop their capture flag, which is exactly why it must never be baselined.",
    "$measured": "2026-08-16 @ b4a05049e — 71 files / 72 matches via the real census runner; 0 overlap with the rule; 2 + 72 = 74 = the full anchor population."
  },
  "floor": 3000
}
```

### Verification of this gate's own preconditions

- **`floor: 3000`** against **4,829** files actually walked under `src`, matching
  the `raw-select` / `unconsulted-tail-pin` precedent for this root. A typo'd root
  walks 0 files and trips both `floor` and the zero-match structural failure —
  **injected and confirmed.**
- **Fault-injected eight ways through the real runner, all eight fire:** baseline
  reproduces (exit 0); baseline `1/1` → `[drift] files rose 1 -> 2` (exit 1);
  baseline `3/3` → `[drift] files dropped 3 -> 2 without the baseline moving`
  (exit 1); non-existent root → `[structural] walked 0 files but floor is 3000.
  THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` (exit 1); `extensions: [".kt"]`
  → same structural failure (exit 1); a stale `exclude` entry → `[structural]
  exclude … matched no file` (exit 1); a `baseline` on the control →
  `validateRule` rejects it before any scan (exit 1, 0 rules scanned);
  `floor: 9000` → structural failure (exit 1).
- **No backtracking risk.** The pattern is a rare literal anchor followed by a
  bounded negated character class (`[^,()\n]{0,80}`) — no nested quantifier, no
  lookbehind, no tempered dot. **Real-runner wall time over 4,829 files: 2.1 s for
  rule and control together.**
- **Precision is 2/2 by hand-reading, not by sampling.** Both matches were opened
  and their handler bodies read; both are in §7 P0-Escape and this section.
- **No `exclude` entries.** Both matches are true positives, so there is no
  legitimate exemption and no stale suppression can accumulate. The 72 compliant
  registrations are excluded **by the pattern**, not by a list.
- **The rule must reach zero and then be DELETED**, not baselined at 0. The census
  cannot express "must be zero", and a rule pinned at 0 can never fail.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally.
- **Where it runs:** the **`golden-path-census` pre-push job**
  (`lefthook.yml:74-75`, `npm run census:check`) and inside `npm run check`.
  **Not CI** — `ci.yml` is red on pre-existing failures, so a gate that only ran
  there would run nowhere, which is precisely the condition this leaf's *existing*
  gates are already in.

### Gates I rejected, with numbers

| candidate | violating | compliant control | why rejected |
| --- | ---: | ---: | --- |
| **a global key handler that acts without consulting `e.target`** (the brief's primed lead) | **38 files / 38** | **19 files / 19** | Structurally beautiful — the two halves share **zero files** and partition **57 of 57**. Rejected on precision: hand-reading five of the 38 (`RecipePicker.tsx:31`, `NotificationCenter.tsx:347`, `useClickOutside.ts:26`, `DataGrid.tsx:214`, `Listbox.tsx:136`) found **three are the ordinary, correct modal-Escape idiom**. Worse, the condition is *redundant on this leaf*: xterm already `stopPropagation()`s, so a target check adds nothing in the case the rule was built for. **A gate that fires on correct content is worse than no gate.** |
| **the same, narrowed to focus keys** (Arrow/Tab/Enter/Home/End/Page/Backspace/Delete/Space) | 4 files / 4 | 5 files / 5 | Precision recovers, and the population drops the two sites that motivated the rule (Escape is not in the set). A gate that cannot see its own founding defects is measuring something else. |
| **terminal geometry as a positional pair** (`cols`, `rows` as two args) | **19** | **2** (`portable_pty::PtySize`, both in the vendored crate's type) | The compliant population is effectively **empty** — this app has never once expressed the pair as a value — so the control is not discriminating, which is the same failure `credential-injection-into-child` recorded for its mask-marker candidate. And **all 19 are currently correct**, hand-traced. Carried as §7 P1 and as the `TerminalSize` recommendation instead. |
| **an arithmetic byte index into a String** (the `wait.rs` panic shape) | 2 true positives among **61** raw index-shape hits over 963 files | — | ~3% precision before hand-filtering: the shape is syntactically identical on `Vec`, `&[u8]` and ASCII-guaranteed strings (`obsidian_brain/mod.rs:504` slices a string filtered to `is_ascii_alphanumeric` and is safe by construction). The right instrument is a shared `tail_chars` helper, not a matcher — the repo already has **three** independent open-coded fixes for this class. Carried as §7 P2. |
| **a terminal mounted over a session with no process** | 4 render branches | 0 | The condition is a relationship between a render branch in one file and a lifecycle constant in another; the census matches within a file. This is the leaf's largest finding and it is **not gateable** — it was found by reading two constants and joining them. The instrument that settles it is the **type** in "Prefer a type over a gate", not a ratchet. |
| **a per-session temp artefact with no `Drop` guard** | 2 (`pty.rs:555`, `headless.rs:251`) | 5 (`SidecarScrubGuard`, `NamedTempFile`, `RunGuard`, `IpcInFlightGuard`, `cli_mcp_config.rs:338`) | Population 2 is a one-shot, and `credential-injection-into-child` §9 already designed, ran and rejected the nearest anchor at **60% precision**. Deferred to that path with the seven-day sweep measurement added. |

The general limit worth restating: **the census can ratchet a condition visible in
a statement, and can say nothing about a condition that is a relationship between
two components or between code and a schedule.** The three largest findings in
this document are all the second kind — a render branch against a lifecycle
constant, a listener phase against a vendored emulator's `stopPropagation`, and a
cleanup path against Windows' 7-day temp sweep — and each was found by
**executing or opening something**: the temp directory with `icacls` and
`CreationTime`, two read-only database copies, and the minified xterm bundle.

## 12 Corrections to the brief

### 12.1 The `CONVERGED` label does not hold — there is nothing to converge with

The brief said *"The spine says CONVERGED. Eight CONVERGED labels tested; eight
failed. Treat it as a claim."* It is nine.

**Measured: zero of the five sibling checkouts contains a pseudo-terminal or an
xterm-class emulator.** Verified twice — once by an inventory sweep that opened
the candidate files, and once by a direct dependency-and-source grep for
`node-pty|portable-pty|@xterm|openpty|CreatePseudoConsole|winpty` across all five
trees, which returns **zero hits**. `personas-web`'s "terminals" are framer-motion
animations over static arrays; `brainiac` spawns no child process at all;
`personas-cloud` and `ascent` run `claude` headlessly with no UI attached;
`vibeman` has the closest thing and it is a **stdin pipe**, message-oriented, with
**no resize path and no `cols`/`rows` anywhere**.

This is not "the oracle returned nothing so promote it anyway". It is a **5/5
silence on the leaf itself**, which means the entire Principle head is **local
calibration** and is labelled as such at the top of §"Principle". Two clauses
(P3, P4) do have partial external warrant from `vibeman`'s bounded ring and
replay-on-attach, and those are marked in §6(b). The rest are this repo's own.

**And the label is wrong in an instructive direction.** A `converged` label
implies "others have solved this; copy them". The measured posture is the
opposite: **Personas is the only repo in six that has this problem, and its ring
is better than anything the fleet has to offer.** The prescription that follows is
"repair the apparatus you alone have", not "adopt a sibling's" — the same
inversion `panic-isolation` §12 recorded for its own `diverged` label, arrived at
from the other side.

### 12.2 Four of the six primed leads confirmed; one materially overturned; one is understated

**1. "A byte-index slice panicked 3× on box-drawing glyphs inside a detached task
— check for siblings." — CONFIRMED, and there are exactly two.**
`auto_cred_browser.rs:901` and `:1291`, both `len() - K` byte slices, both on CLI
output, both in the failure-reporting path — §7 P2. Neither is in a detached
task, so they are louder than the original; they are the same defect. **The
correction to the lead is that the class is already fixed three times
independently in this tree** (`wait.rs:191`, `eval.rs:523`,
`runner/mod.rs:2467`), which makes the missing artefact a shared helper, not a
fourth fix.

**2. "`MAX_LIVE_SESSIONS = 0` means off, that is the default, eviction returns
`()`, the spawn proceeds anyway." — CONFIRMED verbatim** (`stale.rs:151`,
`:1390-1406`), already owned by [`agent-dispatch`](./agent-dispatch.md) D4, and
**not re-counted here**. What this leaf adds is the constant beside it that is
*not* off and *does* fire: `DOZE_AFTER_SECS = 60` (`stale.rs:1182`), always on, no
toggle. **The cap that nobody set is the harmless one; the floor nobody can turn
off is the one that ends the session under the terminal.**

**3. "6 `fleet-mcp-*` dirs, 0 removed, 2 still holding a token 7 days later,
`fleet_sessions` 0 rows, files inherit a group containing two other accounts." —
CONFIRMED on every clause, and three details are new.** The app removed 0 of 6;
**the four missing token files were deleted by a Windows sweep at 04:49 on
08-13/08-14, 7.2–7.9 days after creation, which left every directory behind**;
the surviving tokens are **dead**, because the registry that resolves them is a
process-memory `OnceLock` (`companion/orchestration/mcp/mod.rs:83-97`); and the
inherited ACL carries **two** non-owner Modify ACEs, not one. The consequence
worth carrying forward is **write**, not read: `%TEMP%`'s `(OI)(CI)(M,DC)` means
another local account can rewrite the `url` in that config between the write and
the child's read.

**4. "12 spawn sites pass `--dangerously-skip-permissions`; one is inside
`build_cli_args`, referenced at 75 sites." — CONFIRMED and owned by
[`credential-injection-into-child`](./credential-injection-into-child.md) and
[`agent-dispatch`](./agent-dispatch.md) D5. Not re-counted.** This leaf adds the
tier fact instead: **37 of 38 Fleet IPC commands are Public**, and the one
privileged command is `fleet_remove_session` while `fleet_write_input` — the
door that types into a permission-suppressed child — is not.

**5. "The terminal view takes raw keyboard input while 72 of 90 global key
bindings are registered outside the app's own registry, and `document` beats every
rank." — the first two clauses hold; THE THIRD IS WRONG, and it is the load-bearing
one.** Confirmed by two implementations and reconciled against the existing census
rule: **74 keyboard registrations, of which 72 are outside the registry**
(`unregistered-key-handler`'s baseline is 72 because it excludes the registry's
own two). But **`document` does *not* beat the terminal.** `@xterm/xterm@6.0.0`'s
`_keyDown` ends in `cancel(e, true)`, which is `preventDefault()` **and**
`stopPropagation()` — read out of the vendored bundle, not assumed — so a focused
terminal wins against every bubble-phase listener in the app, registry or not.
I had written the opposite conclusion into my own notes before opening the bundle.
**The real population is not 72; it is 2** — the capture-phase registrations —
and that inversion is the whole of §9. The doctrine's rule here earned itself
again: *the vendored dependency's source is the ground truth, and the plausible
inference from the app's own code was backwards.*

**6. "`ci.yml` is red on 10 pre-existing failures. A gate that only runs in CI
runs nowhere." — CONFIRMED, and it lands harder than the brief intended.** This
leaf's *existing* gates are exactly in that condition: `bench.rs`'s four
performance tests were routed to CI by a comment (`:42-46`) citing a local loader
failure whose fix — `npm run test:rust` — is documented in this repo's own
`CLAUDE.md` and shipped as a script. **The calibration note was aimed at my new
gate and it indicted the ones already there.**

### 12.3 Three corrections to my own work

**(a) I concluded that Escape in the Fleet grid overlay reaches both the child and
the overlay-close handler, and published nothing on it only because I opened the
minified emulator afterwards.** The reasoning was sound and the premise was false:
`preventDefault()` does not stop propagation, so a window-level bubble listener
"must" still fire — except xterm calls `cancel(e, true)`, which also calls
`stopPropagation()`. The corrected finding is *sharper* than the wrong one: not
"Escape does two things", but **"the same key resolves in opposite directions on
two surfaces that host the same terminal, decided by listener phase rather than by
policy, with no comment in either file."** *An inference about a third-party
library's behaviour is a hypothesis until its source is open, however well the
surrounding code is understood.*

**(b) My first keyboard scanner reported 5 guarded / 69 unguarded; the real split
is 19 / 38 over a narrower population.** It anchored on `addEventListener` and
looked **forward** for a guard, so every **named** handler — where the guard is
written *above* the registration — was misfiled as unguarded, including
`useFleetHotkeys.ts:82`, whose docstring explicitly says it skips xterm's helper
textarea. Three of the app-shell handlers I initially filed as hazards
(`KeyboardNavMode`, `WorkspaceShortcuts`, `NavHistoryShortcuts`) are correctly
guarded. **This is the doctrine's "a vocabulary-based signal's precision is
bounded by its author's word list" with a second edge: a *window*-based signal's
precision is bounded by the author's guess about which direction the evidence
lies in.**

**(c) I expected the headline to be about the ring — whether the scrollback is
bounded and whether it survives.** It is bounded, it survives an unmount, it
replays on attach, it is byte-accounted and incrementally parsed, and it is the
best implementation in six repos. **The defect is one layer up: the app frees the
process under a terminal it keeps rendering as live, by default, after 60
seconds, on the exact state the grid chooses to mount a live terminal for.** A
composer who had only asked the leaf's stated questions — is it bounded, does it
replay, what does a resize do — would have written "well handled, minor gaps" and
missed the subject.
