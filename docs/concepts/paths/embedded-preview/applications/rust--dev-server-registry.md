---
layer: application
subject: embedded-preview
technique: dev-server-registry
stack: rust
---

# `devserver.rs` — one Bun dev server per project, tree-killed on exit

`src-tauri/src/webbuild/devserver.rs` is the registry the technique
describes, in 321 lines, with its own module comment stating the
technique's thesis (`:1-7`): one server per project, tracked so each can
be health-checked, stopped, and *all killed when the app exits*, because
`bun run dev` spawns a `next`/node child that a bare parent-kill orphans.

## The registry

`DevServerRegistry` (`:44-46`) is a `Mutex<HashMap<project_id, DevServer>>`
in `AppState`; `DevServer` (`:21-26`) records `port`, `pid` (the tree
root), the child handle, and `started` — **at spawn time, before
returning** (`:88-99`). Registration-is-the-reaper's-contract holds:
everything `stop` needs is captured at birth.

- **One per project, replace-not-race:** `start()` calls `stop()` first
  (`:62-63`), so a second start for the same project tears the prior
  tree down before spawning — the overlap-two-servers hazard is closed
  by construction. It also clears Next's own `.next/dev/lock` if a
  crash-orphaned server holds it, guarding the kill with a
  `pid_is_node` check so a recycled pid is never taken down (`:239-290`).
- **Startup reconciliation, partial:** the app does not adopt remembered
  servers on boot (the registry is in-memory, so it starts empty), and
  the frontend `attachOrStart` (`studioStore.ts:241-254`) re-attaches to
  a still-healthy server across a *webview* reload without restarting
  it. A *process* restart cannot re-attach — the stale-lock clearing is
  what handles the orphan it would otherwise collide with.

## Teardown on every exit path

- **explicit stop:** `stop()` removes the entry, then `kill_tree(pid)`
  (`:148-159`) — `taskkill /F /T` on Windows (`:218-230`), `kill -9` on
  Unix (`:231-236`); the direct child handle is best-effort killed too.
- **replacement:** covered by `start()`'s leading `stop()`.
- **host shutdown:** `stop_all()` (`:161-171`) runs from the Tauri
  `RunEvent::Exit` handler (`lib.rs:3755-3762`) — the path the technique
  calls out as the one that separates leaking products from clean ones.
- **tab close:** the frontend calls `webbuildDevStop` on close
  (`studioStore.ts:505`).

Process-tree mechanics themselves are subprocess-lifecycle's domain; the
registry's job — invoke them on every path — is done.

## Readiness: a real HTTP probe, not a TCP connect

`http_responds()` (`:187-213`) sends `GET / HTTP/1.0` and requires an
`HTTP` response prefix, with 400 ms connect/write and 1.2 s read
timeouts. Its comment (`:188-192`) states the technique's exact reason:
a bound-but-wedged server (compiling forever, or crashed with the socket
lingering) accepts the connection yet never serves — a TCP check would
call it healthy and render blank. `status()` re-runs the probe on every
call (`:112-125`), and the frontend keeps a 6 s idle-only liveness
heartbeat that cold-restarts after two consecutive misses
(`studioStore.ts:302-338`) — the "readiness is not permanent" rule,
implemented.

## Ports

`alloc_port()` (`:174-185`) binds `127.0.0.1:0`, reads the kernel's
choice, and releases it — with the TOCTOU window acknowledged in the
comment as acceptable for a single-user local flow. The port is recorded
in the entry and every consumer reads it from `DevServerStatus.url`
(`:104`, `:121`, `:141`); nobody guesses. The technique's "one project,
one entry, one port, one origin" invariant holds — and is the value the
origin-validation application says the bridge should be pinning to.

## Deviations (reported, standard kept)

- **The boot poll has no deadline.** `beginPoll` (`studioStore.ts:278-300`)
  polls `webbuild_status` every 1.5 s until `healthy` — forever. A server
  that never becomes ready (port collision behind the TOCTOU window,
  install missing, a bundler crash at boot) leaves the tab in `starting`
  with the "Starting the dev server…" card (`StudioPage.tsx:339-353`)
  indefinitely; nothing kills the tree, nothing surfaces the server's
  output. The technique's eternal-loading-frame defect, and its
  prescribed fix (deadline → declared failure → tree kill → output
  attached) is one bounded counter in the poll plus a `stop`.
- **Server output is discarded** (`stdout`/`stderr` → `Stdio::null()`,
  `:76-78`), so even a future deadline has nothing to attach. Capturing
  the tail of stderr into the entry would make the failure diagnosable.
- **`kill_tree` is fire-and-forget** (`:216-217`, results ignored) and
  `stop_all` runs it serially at exit without confirming the trees are
  gone — acceptable for `/F /T`, but an unreaped survivor is invisible.
- **`http_responds` accepts any `HTTP` status line** — a dev server
  serving a 500 error page on `/` reads as healthy. Correct for the
  "is it serving" question; the surface should not read it as "the app
  renders".
