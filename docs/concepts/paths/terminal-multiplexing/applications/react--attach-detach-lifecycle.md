---
layer: application
subject: terminal-multiplexing
technique: attach-detach-lifecycle
stack: react
---

# React — attach/detach lifecycle in the Fleet terminal manager

**Canonical manifestation:** `src/features/plugins/fleet/fleetTerminalManager.ts`
(the manager) + `src/features/plugins/fleet/FleetTerminalPane.tsx` (the thin
mount point). Backend half: `OutputRing` in
`src-tauri/src/commands/fleet/registry.rs` and the reader loop in
`src-tauri/src/commands/fleet/pty.rs`.

## The ladder, as shipped

The manager owns a `Map<string, ManagedTerminal>` keyed by fleet session id
(`registry`, `fleetTerminalManager.ts:169-172`), holding an xterm `Terminal`,
its fit addon, a detached holder `<div>`, and hydration state per session.
The module header names the anti-pattern it replaced verbatim: the previous
`FleetTerminalPane` keyed its whole lifecycle on `sessionId` and *disposed*
the terminal on every session switch — scrollback lost, unwatched sessions
had "no terminal to receive" their output. The rewrite makes the React
component a mount point: `attachTerminal(sessionId, container)` on mount,
`detachTerminal(sessionId)` — explicitly "NOT disposes" — on unmount.

Rungs map to the technique's ladder as:

- **attached** — `attachTerminal` (`:408-423`): re-parent the holder into
  the container, `term.open` once, `loadWebgl` (attach-scoped GPU renderer),
  `scheduleFit`, then `hydrate`.
- **parked** — `detachTerminal` (`:464-495`): cancel pending fit, bump
  `hydrationGen` to cancel in-flight hydration, unsubscribe backend
  streaming, `disposeWebgl`, remove the holder from the DOM — but keep the
  `Terminal` and its 5000-line scrollback in the registry.
- **detached (budget eviction)** — the `parked` array is an LRU by detach
  order; beyond `MAX_PARKED = 6`, `disposeTerminal` frees the oldest parked
  instance entirely. The comment calls it "lossless in practice" because a
  re-attach replays the backend ring snapshot anyway — the ring is what
  makes eviction safe, exactly as the technique argues.
- **dead** — `gcTerminals(keepIds)` (`:529-533`) disposes every managed
  terminal whose session left the roster, called from the grid.

## Ordered teardown and the hold gate

Teardown order in `detachTerminal` is subscription-first (hydration
cancelled, `unsubscribeTerminal` issued) before renderer (`disposeWebgl`)
before DOM removal — the technique's data-flow-reverse order. On the attach
side, `hydrate` (`:434-459`) is the atomic-snapshot-on-subscribe splice from
bounded-replay-buffers: `subscribeTerminal` returns the ring snapshot; while
it is in flight, `hydrating` holds live chunks in `pendingLive`; the terminal
is `reset()`, the snapshot written, the queue flushed; `hydrationGen` cancels
a stale resolution when the user flips panes faster than the round trip.

## Budget economics confirmed

The attention/existence split is measured in the file's own comments: one
shared `fleet-session-output` listener dispatches into the map — "O(1) per
chunk regardless of how many terminals exist" (`:193-201`) — replacing the
per-terminal filtered listeners that ran N callbacks per chunk. The backend
only streams subscribed sessions; unwatched ones drain into the 512 KiB ring
(`registry.rs:28-33`: "the win that lets us scale to 16 CLIs"). The WebGL
addon is loaded on attach and dropped on detach and on context loss
(`:265-297`), with the DOM renderer as the documented fallback — the
technique's fallback ladder, including the context-loss-is-an-event rule.

## Reload survival

Registry, parked list, and the shared listener's unlisten handle all hang
off `globalThis` (`REGISTRY_KEY`, `PARKED_KEY`, `OUTPUT_LISTENER_KEY`) so hot
reloads keep live terminals and cannot stack a second output listener — the
multiplexer-state survival rung, with the eager-set guard at `:206` closing
the re-entrant double-listen race.

## Deviations visible from this file (standard kept)

- **Keystroke failures are silent.** `term.onData → writeInput(...)` lands in
  `silentCatch` (`:355-359`), as do paste and resize; sibling surfaces wrap
  the same IPC call in `toastCatch`. A keystroke is user-facing input, not a
  background error.
- **The pane attaches unconditionally.** `FleetTerminalPane` has no liveness
  input, so a terminal stays interactive (cursor blinking, `cursorBlink:
  true`) over a process the doze ticker killed — the ladder's `dead` rung is
  not rendered as dead.
- **`pushResize` is unconditional** even when `fit()` computed the same
  cols×rows, and the observer coalesces to one animation frame rather than a
  settled size — the no-op-skip rule in renderer-economics is not applied.
