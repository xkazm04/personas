---
layer: application
subject: terminal-multiplexing
technique: pty-management
stack: rust
---

# Rust — PTY management in the Fleet spawn path

**Canonical manifestation:** `src-tauri/src/commands/fleet/pty.rs`, with the
ring in `src-tauri/src/commands/fleet/registry.rs` and the no-PTY lane in
`src-tauri/src/commands/fleet/headless.rs`.

## The portability seam, bought not built

The seam is `portable-pty` (wezterm's crate): "wraps ConPTY on Windows and
`posix_openpt` on Unix behind one API" (`pty.rs:1-4`). Everything above the
crate is platform-blind about the *device*; the one `#[cfg(windows)]` split
that remains (`:301-380`) is about executable resolution and argv quoting —
child-birth-certificate concerns the file explicitly routes through the
app-wide canonical resolver ("ONE source of truth — Fleet must NOT keep a
separate lookup", `:293-300`), i.e. subprocess-lifecycle's spawn-contract,
inherited rather than duplicated, exactly as the technique prescribes.

## Spawn wiring

- **Size is part of the birth**: `openpty(PtySize { rows: rows.max(8),
  cols: cols.max(40), .. })` (`:251-259`) — the terminal is born at the
  caller's geometry, clamped to a floor.
- **The environment tells the truth about what it is**:
  `cmd.env("TERM", "xterm-256color")` with the comment "what xterm.js
  natively understands" (`:382-383`) — the capability-honesty rule.
- **Environment hygiene is subtractive too**: inherited API-key env and
  nesting markers are actively stripped (`:396-415`), each with a
  measured incident behind it.
- **Ownership is split at spawn**: master + writer go to the registry (for
  resize/input), the reader is moved into a blocking task, the child into a
  reaper task — "the two background tasks own their handles directly so
  they never need to look anything up via the registry while blocked on
  I/O" (`:6-12`). A kill handle is cloned *before* the child moves into the
  reaper (`:421-425`), because "interactive `claude` ignores stdin EOF, so
  dropping the PTY alone would leave a zombie shell" — the technique's
  close-order deadlock, pre-answered.

## Exit detection: process wait as verdict, stream EOF as corroboration

`reader_loop` (`:611-685`) treats `Ok(0)` as EOF and merely exits;
`reaper_loop` (`:689-718`) owns the verdict via `child.wait()`. The exit
code path carries a purpose-built honesty fix: abnormal codes are
reinterpreted bit-for-bit rather than saturated (`:699-708`), because the
old saturation "rendered every abnormal exit as the meaningless code
2147483647 — exactly why an exit read as 'vanished without warning'";
`finalize_child_exit` (`:723-806`) then logs *why* every session ended and
distinguishes planned deaths (doze, hibernate) from real ones — failure
spelled differently from empty success, and from deliberate sleep.

## The ring at the device

The reader always pushes into the 512 KiB `OutputRing` (so the pipe never
fills and the child never blocks — the backpressure decision made
explicitly) and forwards over IPC only while subscribed
(`reader_loop:650-667`, `registry.rs:35-44`). Bonus consumers per
bounded-replay-buffers' "reading without rendering": `preview_lines` cooks
the tail into renderer-free previews, and a lazily built, incrementally fed
`vt100::Parser` answers programmatic screen reads at O(screen)
(`registry.rs:50-62`). The reader also runs `OscTitleScanner`
(`pty.rs:97-181`) — a byte-at-a-time state machine, persisted across reads,
that harvests the child's own title escape sequences to label the session.

## The second lane

`headless.rs` is the golden path's "terminal is opt-in" section in code: no
ConPTY, no redraw loop, structured events parsed line-by-line driving the
state machine directly, the ring fed cooked display lines so every ring
reader downstream keeps working (`headless.rs:1-30`). Same session identity,
transcript, hooks, and wake path; a woken headless conversation resumes
*interactively* — a lane crossing at a lifecycle boundary.

## Deviations visible from this path (standard kept)

- **Per-session temp cleanup is coupled to the reaper closure**
  (`pty.rs:514-529`) and measured not to run: 6 MCP temp dirs created, 0
  removed by the app (legacy corpus, embedded-terminal-session §7 P1). The
  creation-names-reaper obligation names a reaper that does not fire; a
  drop-guard shape exists elsewhere in the tree.
- **Geometry is two positional integers** crossing in three different
  orders across `resize` / `render_screen` / `PtySize`, with clamps that
  silently legalize a transposition (legacy §7 P1) — the resize chain lacks
  a typed link.
- **`write_text_line` returns `Ok` before the submit is confirmed**
  (`registry.rs:750-851`): the settle-wait/confirm/retry runs in a detached
  task and its failure reaches no caller — evidence-based pacing exists but
  its outcome is unobservable to the door that promised it.
