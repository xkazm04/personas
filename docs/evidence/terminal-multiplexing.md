---
subject: terminal-multiplexing
evidence:
  - src/features/plugins/fleet/fleetTerminalManager.ts    # the manager: session-keyed registry on globalThis, LRU parking (MAX_PARKED), detach≠dispose, attach-scoped WebGL, hydrate-then-flush splice
  - src-tauri/src/commands/fleet/registry.rs              # OutputRing: 512 KiB byte-budget ring, always-buffer/forward-only-while-subscribed, snapshot for replay, renderer-free preview + incremental screen model
  - src-tauri/src/commands/fleet/pty.rs                   # the portability seam (portable-pty over ConPTY/posix_openpt), spawn-with-size, reader/reaper split, process-level exit detection
  - src-tauri/src/commands/fleet/keys.rs                  # vim-style key notation, one-chunk-per-key, typed-vs-pasted Enter, loud unknown-key errors, shape-only logging
  - src-tauri/src/commands/fleet/headless.rs              # the second lane: structured-event sessions with no PTY and no emulator, same ring and session semantics
  - src/features/plugins/fleet/FleetTerminalPane.tsx      # the thin mount point: attach on mount, detach (not dispose) on unmount
counter_evidence: []
deviations:
  - w10-terminal-multiplexing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Terminal Multiplexing - evidence

How this codebase measures against the [`terminal-multiplexing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
