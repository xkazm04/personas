# Parallel CLI workflow — running your own app and tests

This repo regularly has 5–10 CLI sessions in flight at once, each in its own git worktree, often editing overlapping feature areas. This doc explains how each CLI can run **its own tests** without stepping on other sessions, and the partial story for running **its own app instance** for full-app E2E coverage.

If you're authoring a `/friend` skill or a similar long-running CLI loop, ground the test sections of your workflow on this doc.

---

## TL;DR

| Test tier | Parallel-safe across CLI sessions? | How to run from your worktree |
| --- | --- | --- |
| Vitest unit / hook / component | **Yes** | `npm test` or `npx vitest run <path>` |
| Playwright vs full Tauri | **Serial today** — one app instance per machine | Coordinate with other CLIs; start the app once; run all specs; stop the app |

Worktree isolation is enough for Vitest. For Playwright you take turns on the machine's single running app, or you go through the production-install path described below.

---

## Layer 1 — Vitest (fully parallel-safe today)

Each `git worktree` has its own `src/` directory, its own `node_modules`, and its own commit history. Vitest runs in a Node process scoped to whatever working tree you launch it from, with jsdom holding a fresh DOM per test file. There is **no shared state** between worktrees during Vitest runs — they don't talk to each other, they don't share a port, they don't share a database.

### Procedure

In your worktree:

```bash
# Run everything once
npm test

# Watch mode while authoring tests
npm run test:watch

# Only your feature
npx vitest run src/features/plugins/<feature>

# Only one file
npx vitest run src/features/plugins/<feature>/sub_X/__tests__/foo.test.ts
```

That's it. Two worktrees can run `npm test` at the same time on the same machine and neither will affect the other.

### Common gotchas

1. **The 2-second IPC token wait.** `_invokeCore` in `src/lib/tauriInvoke.ts` waits up to 2s for `globalThis.__IPC_TOKEN` before firing each invoke. In tests that token is never set, so the default `waitFor` (1s) times out before the mock fires. Plant this at file scope in every test file that calls IPC:

   ```ts
   (globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';
   ```

   Existing reference: `src/features/schedules/libs/__tests__/useCronPreview.test.ts:9`.

2. **`enSectionStrings.ts` going stale.** If you added i18n keys to `en.json` but only ran `gen-types.mjs`, the committed `src/i18n/generated/enSectionStrings.ts` won't include them. Component tests that read `t.section.new_key` will see `undefined` and crash in the interpolation helper. Run `node scripts/i18n/split-locales.mjs` (or `npm run codegen`) after any `en.json` edit you intend to test against.

3. **The dedup cache poisoning tests.** `invokeWithTimeout` auto-dedups read-only commands (`list_*` / `get_*` / `fetch_*`) for 250ms after settle. `resetInvokeMocks()` clears this for you between tests; always call it in `beforeEach`. Tests that don't reset will see a cached `undefined` from the prior test's mock.

4. **Zustand store mocking.** Stores have global state; tests in the same Vitest process can interfere with each other. Mock the store module surface explicitly in each test file that needs deterministic store state:

   ```ts
   vi.mock('@/stores/systemStore', () => ({
     useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
       selector({ /* deterministic test state */ }),
   }));
   ```

---

## Layer 3 — Playwright vs full Tauri (serial today, partial multi-instance scaffold)

Playwright drives the real Tauri app via an HTTP test-automation server. The bridge architecture is documented in [`docs/development/test-automation.md`](../development/test-automation.md); the parallel-safety story is below.

### Why it's serial

A single running `tauri:dev:test` is a process singleton on several fronts:

| Singleton | Why it conflicts |
| --- | --- |
| Vite dev server :1420 | A second `npm run tauri:dev:test` fails immediately with "Port 1420 is already in use". |
| Test-automation HTTP server :17320 | Same — second instance can't bind. **(Mitigated: `PERSONAS_TEST_PORT` overrides for production builds.)** |
| App data directory | Both instances would write to the same SQLite database, autosave files, encrypted credential store. Concurrent writes corrupt state. |
| Keyring service `"personas-desktop"` | OS keyring entries shared by service name. Two instances would interleave reads/writes to the same encrypted credential rows. |
| Tauri identifier `com.personas.desktop` | Some Tauri features (deep-link routing, single-instance plugin) assume a unique identifier per app. |

### Procedure when only one CLI runs E2E at a time

This is the realistic shape today.

1. **Coordinate via the active-runs ledger.** Before you start the app, check `.claude/active-runs.md` for any session already running Playwright (look for `tauri:dev:test` in a Note line). Add your own intent entry.
2. **Start the app from the main checkout, not the worktree.** Tauri compiles into `src-tauri/target/` and dev-server-hosts from `src/`. Running from the main checkout keeps the build cache shared with future runs. Worktrees would duplicate the Rust compile into a per-worktree target dir — slow and wasteful.

   ```bash
   # In the main checkout
   npm run tauri:dev:test
   ```

   First start is slow (~3–5 min cold compile). Subsequent starts are seconds.
3. **Verify the bridge is up:**

   ```bash
   curl http://127.0.0.1:17320/health
   # → {"status":"ok","server":"personas-test-automation","version":"0.2.0"}
   ```
4. **Run your specs from any worktree.** Playwright connects to the bridge via HTTP; it doesn't care which checkout you launch the test runner from.

   ```bash
   # From your worktree (the spec files may live in your branch)
   npm run test:playwright:<feature>
   ```
5. **Stop the app when you're done** so the next CLI can take its turn. Mark the ledger entry completed.

### Partial multi-instance — production builds with `PERSONAS_TEST_PORT`

The Rust side supports a second mode for the test-automation server:

```rust
// src-tauri/src/test_automation.rs:5-6
// 1. Dev mode (compile-time): --features test-automation → port 17320
// 2. Production mode (env var): PERSONAS_TEST_PORT=17321 → custom port
```

This means a **production install** can be launched with a custom test-automation port, and the Playwright spec runner can be pointed at it via `COMPANION_TEST_PORT`:

```powershell
# Terminal A — instance 1
$env:PERSONAS_TEST_PORT = "17321"
& "C:\Users\<you>\AppData\Local\Personas\personas-desktop.exe"

# Terminal B — instance 2
$env:PERSONAS_TEST_PORT = "17322"
& "C:\Users\<you>\AppData\Local\Personas\personas-desktop.exe"

# Each test run targets one instance via COMPANION_TEST_PORT.
$env:COMPANION_TEST_PORT = "17321"
npm run test:playwright:<feature>
```

**What this solves**: test-automation port collision. Two production instances of the same install can run with non-conflicting test-automation servers, and each can be driven by a separate Playwright run.

**What this does not yet solve**:
- **App data directory.** Both instances still write to the same SQLite + autosave files. Two concurrent E2E suites would race on shared rows. For now this is "fine for read-only smoke" but "broken for any test that mutates state."
- **Keyring service.** Same `"personas-desktop"` service entries; concurrent credential ops interleave.
- **Single-instance plugin.** If the production build has Tauri's `single-instance` plugin enabled, the second instance bounces back to the first window. Check `tauri.conf.json`.

True multi-instance Tauri dev (multiple `tauri:dev:test` side-by-side, each writing to its own data dir + keyring namespace + Vite port + identifier) is an **architect-scoped infrastructure project**. It would unlock fully parallel E2E suites but is YAGNI today — Vitest covers ~80% of the regression surface and Playwright's "one at a time per machine" is workable for the 20% it doesn't cover.

If you're hitting bottleneck on Playwright serialization, that's the signal to invest. Until then, take turns.

### Procedure for one CLI taking E2E + multiple CLIs running Vitest

This is the common shape during a busy session:

1. CLI A starts `tauri:dev:test` from the main checkout.
2. CLIs B/C/D/E continue authoring code + running `npm test` in their own worktrees — **completely undisturbed**, because Vitest doesn't touch the app.
3. CLI A finishes its Playwright run, stops the app.
4. CLI B can now take its turn if it has E2E to run.

The HMR concern doesn't bite because each worktree has its own `src/` directory, so worktree edits don't reach the `tauri:dev:test` running off the main checkout. CLI A's app sees the main checkout's source state; CLIs B–E's edits stay confined to their worktrees.

### Authoring a Playwright spec against a running app — operational gotchas

Run-and-fix iteration with the app already up has a few non-obvious traps. These are the ones the artist test-coverage push hit end-to-end; flagging them here so the next author does not re-learn them at the cost of a 30-second restart per try.

1. **`src/test/automation/bridge.ts` is NOT hot-reloadable.** The test bridge is loaded once when the WebView initializes and exposed on `window.__TEST__`. Vite *does* detect file changes and emit an HMR update, but the existing bridge instance keeps its old methods — adding `setArtistTab` to source does not make it callable on the running app. You must **fully restart `tauri:dev:test`** for bridge.ts edits to take effect. (Vite + Rust target stay warm, so a restart is ~30 s, not the ~3–5 min cold compile.)

   Practical implication: design the bridge method set up front, ship all the methods a feature needs in one commit, and avoid iterating on bridge.ts in tight loops. Iterate on the spec / bridge wrapper / testids — they all hot-reload cleanly.

2. **The dual-checkout trap.** If the app is running from the main checkout (`personas/`) but you're editing files in a worktree (`.claude/worktrees/<slug>/`), your edits never reach the running app — different working directories, different sources, different Vite watchers. You will see your spec fail because the testid is "missing" when it's actually present in your worktree branch but not in master.

   Resolutions, in order of preference:
   - Edit the testid-adjacent source files in the main checkout directly while the app is running — HMR picks them up immediately. Apply the same edits to your worktree branch afterwards (or merge in the other direction).
   - Merge your worktree branch into master to push your changes into the running app's source. Vite HMR picks them up.
   - Start a second app from the worktree itself (cold build, ~3–5 min the first time) and target it via `COMPANION_TEST_PORT`. Only worth it for repeated runs.

3. **Cold cargo builds occasionally hang at 676/678.** The `tauri:dev:test` startup compiles a long Rust crate chain. A small fraction of cold starts get stuck on the last 2 crates (the `personas-desktop` binary) and never finish; symptoms are no `[vite]` startup line, no `127.0.0.1:17320` listener, build progress bar pinned. Kill the cargo + node processes and try again. Subsequent starts are seconds because the target cache is warm.

4. **`location.reload()` does not refresh the bridge.** The HTTP `/eval` with `window.location.reload()` reloads the React tree but re-uses the same bridge module instance — it does not re-run the bridge's init script that exposes `window.__TEST__`. Same conclusion as #1: a full process restart is the only way.

5. **Stale Playwright runs leak test-results.** Failed spec runs leave a `test-results/.last-run.json` + per-test directories in the repo root. These are not tracked but show up in `git status`; do not stage them. The user's `.gitignore` should cover this if it's missing.

---

## A note on the active-runs ledger

`.claude/active-runs.md` is the coordination surface for any session that materially edits the working tree, but **it's also useful for tracking test-shell occupancy**. If you take the test shell for an extended Playwright run, add a Note line to your active-runs entry: `Holding tauri:dev:test on :17320 until ~HH:MM`. Other sessions will see it and avoid stomping.

---

## When in doubt

- **Vitest only?** Yes, almost always. Worktree isolation + Vitest's per-process model covers more ground than people expect.
- **Need Playwright today?** Coordinate via the ledger; take your turn; the per-CLI Vitest work continues uninterrupted.
- **Need actually-parallel Playwright?** Open an architect-scoped item — don't try to bolt on multi-instance support inside a `/friend` or feature cycle.
