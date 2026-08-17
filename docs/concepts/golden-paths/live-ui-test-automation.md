# Golden path — Live UI test automation

> Situation node: `platform-delivery/testing-and-workflow/live-ui-test-automation` · [situation spine](../situation-spine.md)
> `sides: both` · `twoSided` · `fusedAcrossSides` · recurrence **588** (the highest remaining leaf) ·
> convergence **mixed** · risk **medium** · Dimensions: **code-quality · function · resilience**.
> *"The identifiers a surface exposes and the driver that clicks the real app."*
>
> Composed 2026-08-14 against `master` @ `2a874e692` from a ground-truth sweep of
> `src-tauri/src/test_automation.rs` (1,496 lines, every route counted),
> `src/test/automation/bridge.ts` (2,882 lines, every method counted),
> `tools/test-mcp/` (**98 files**, 84 Python), `tools/build-mcp/`, `tests/playwright/`
> (**93 files**), `scripts/test/`, `uat/driver/`, all **7** GitHub workflows,
> `playwright.config.ts`, `vitest.config.ts`, `lefthook.yml`, `package.json`,
> `src-tauri/Cargo.toml`, both Tauri configs, `docs/development/test-automation.md`
> (17.4 KB), `scripts/docs/feature-doc-map.json`, and **38 GitHub Actions run records**
> read through `gh run list` / `gh run view --log-failed`.
> **The app was never launched. No cargo command was run, no server started** — a
> PreToolUse guard blocks concurrent cargo and sibling agents hold this checkout.
> Every claim needing a running app is marked **unverified** where it appears.
> `node_modules/`, `src-tauri/target/` and `.claude/worktrees/` excluded from all counts.
> §7 **Deviations** is a fix backlog.

> ### ⚠ Corrections to the brief that commissioned this path — and to a sibling path
>
> 1. **"`e2e-smoke.yml` … so it may never have run" — FALSE, and this is the single most
>    important finding in the document.** It has run **38 times**: **34 `failure`, 4
>    `cancelled`, 0 `success`. It has never once gone green.** `gh run list --workflow=e2e-smoke.yml
>    --status success` returns nothing. The mechanism in the brief is exactly right and I
>    have the log: run `29532610138` (2026-07-16, PR #16) dies at the *build* step with
>    `Permission updater:default not found, expected one of core:default, …` and
>    `##[error]Process completed with exit code 101`. This is not a dormant scaffold — it
>    is a **loud red alarm that has been ringing for three months and everyone has learned
>    to walk past it.** That is a materially different (and worse) failure than "never ran".
> 2. **The same claim in [`feature-flagged-compilation.md`](./feature-flagged-compilation.md):406 —
>    *"so it has almost certainly never run"* — should be struck.** Its diagnosis of the
>    cause is correct and I confirm it independently; its conclusion about history is
>    disproven by the run records. Its premise ("triggers on `pull_request` only, in a repo
>    whose `ci.yml` says development lands directly on master") is *also* true — and the
>    resolution is that this repo **does** open PRs occasionally: `gh pr list --state all`
>    shows **13**, three of them (#14 2026-06-07, #15 2026-07-10, #16 2026-07-16) after the
>    workflow was scaffolded. Both facts were true; only the inference was wrong.
> 3. **The workflow was born broken.** `e2e-smoke.yml` landed 2026-05-10 (`762fe7f02`);
>    `updater:default` has been in `capabilities/default.json:19` since the **initial source
>    commit**, 2026-02-19 (`ce97b4e14`). There is no regression window. It could never have
>    passed on the day it was written.
> 4. **"~20 tools" — there is no single tool surface; there are three, and each layer is
>    smaller than the one below it.** `bridge.ts` exposes **104** methods on
>    `window.__TEST__`; `test_automation.rs` routes **46** of them over HTTP; `server.py`
>    exposes **23** as MCP tools. "20" is the number `docs/development/test-automation.md`
>    prints twice (`:12`, File Structure) while its own heading four lines later says
>    *"Available Tools (23)"*. 23 is correct for the MCP layer.
> 5. **"`/eval` is fire-and-forget … forced a DOM-stash workaround" — CONFIRMED, with one
>    correction to the readback.** `handle_eval` (`test_automation.rs:324-343`) calls
>    `webview.eval()` and returns `{"success": true}` unconditionally; it never allocates a
>    `oneshot`, never registers a pending id, and cannot return a value **by construction**.
>    The doc states it (`:68`, *"Execute arbitrary JS (fire-and-forget)"*). The workaround is
>    real and lives in three files. **But it reads back through `/query`, not `/find-text`** —
>    `freeze-probe2.mjs:11`, `freeze-probe.mjs:22`, `leak-probe.mjs`. The HMR/reload wipe is
>    confirmed too, and the repo has already turned it into a *feature*: `.claude/active-runs.md:2058`
>    records *"app-restart detection via `#__probe` div vanishing beats health polling (health
>    answers from the old binary)."* See §4 step 6.
> 6. **"Is there any automated verification that a UI change works?" — the honest answer is
>    split, and both halves matter.** **Component level: yes, and it gates.** 401 Vitest
>    files (115 `.test.tsx`, 286 `.test.ts`), **153** importing `@testing-library/react`
>    under jsdom, run by `ci.yml:183` (`npm run test -- --run`). **Live-app level: no.**
>    Zero of 7 workflows mention `playwright`. The only live-app CI job is the one that has
>    never passed. Every one of the 84 Python drivers and 32 Playwright specs requires a
>    human to start the app by hand first. See §7 C.
> 7. **"ALWAYS test via test-automation before claiming fixes work" (prior standing
>    guidance) is not currently followable as an unattended step, and should be reworded.**
>    It requires a human to run `npm run tauri:dev:test`, wait for a compile, and keep a
>    window open. It cannot be satisfied by CI, by a hook, or by an agent working in a
>    worktree. §2 states what to do instead.
> 8. **A hypothesis of mine that DIED, reported because a null result is a result.** I
>    predicted the driver corpus would be full of *phantom* `data-testid`s — drivers naming
>    identifiers the UI had since renamed. First pass: 82 of 176 (47%). Then I accounted for
>    the app's **352 template-literal testid shapes** and it collapsed to **0**. Then I found
>    my discount was too generous (3 shapes — `` `${x}-input` ``, `` `${x}-toggle` ``,
>    `` `${x}-${y}` `` — are effectively wildcards) *and* that my extractor had missed
>    testids passed as a `testId` **prop** (`CredentialTypePicker.tsx:36`), which
>    manufactured false phantoms of its own. **The driver-side phantom rate cannot be
>    settled statically** and I will not publish a number for it. What I *can* settle is
>    the documented contract, which needs no inference — §7 A.

## 1. Trigger

- "I changed a UI thing — how do I actually see it work?" / "does this work in the real app?"
- "How do I drive the app from a script?" / "what's on port 17320?"
- "`/eval` returned `{"success":true}` but I need the value back"
- "The bridge timed out" / "the app stopped responding to the harness"
- "Which `data-testid` do I click?" / "should I add a testid for this?"
- "Why did the e2e job fail again?" / "is that red check mine?"
- "Can I run two instances so my agent doesn't fight the dev app?"

If you are about to type `data-testid=`, `testId=`, `curl … :17320`, `fetch('http://127.0.0.1:17320`,
`BASE = "http://127.0.0.1:17320"`, `window.__TEST__`, a new `e2e_*.py`, a new `*.spec.ts`
under `tests/playwright/`, a new route in `test_automation.rs`, or a new method on
`bridge.ts` — you are in this situation.

### Scope, and the boundary with two adjacent paths

This leaf is `fusedAcrossSides`: the identifiers a surface exposes **and** the driver that
clicks them are one situation, because neither half is worth anything alone. A testid
nobody drives is dead weight; a driver naming a testid nobody plants is a red test.

| Question | Owned by |
|---|---|
| How a UI change is proven to work **in the running app** | **here** |
| What identifier a surface must expose so it can be driven | **here** |
| How a Rust unit test is written and which lane runs it | [`rust-unit-test-harness.md`](./rust-unit-test-harness.md) |
| What `--features test-automation` does to the compiled tree | [`feature-flagged-compilation.md`](./feature-flagged-compilation.md) |

**Settling the boundary with `rust-unit-test-harness.md` in prose, since both are
"testing" and both were composed today.** That path owns everything that runs *without the
app*: `#[cfg(test)] mod tests`, `init_test_db()`, which cargo lane reaches which of the
4,360 Rust tests, and the `mt.exe` manifest fixup. **This path owns everything that
requires the app to be RUNNING** — the axum bridge, the JS bridge, the testid vocabulary,
the driver corpus, and the CI job that boots the binary. The two touch in exactly one
place: `e2e-smoke.yml` invokes `cargo build`. That invocation's **flags** belong to
`feature-flagged-compilation.md` (which already lists it at :406); its **history and
consequence** belong here, because the thing it fails to produce is a running app. One
workflow, two owners, no shared prescription.

## 2. The one way

**Verifying a UI change here is two motions, and you must do both.** *Frontend half:* the
surface you changed must expose a **stable `data-testid`** — a semantic name for the thing,
not its position or its styling — because that identifier is the entire public contract
between your component and every driver that will ever touch it. *Driver half:* start the
app with **`npm run tauri:dev:test`** (lite + `test-automation`, so you get `desktop` from
`tauri.lite.conf.json:4` and the bridge on :17320), then drive it over HTTP. **Do not
hand-roll the client.** Python gets its client from `tools/test-mcp/lib/client.py`
(`Client()`, which reads `PERSONAS_TEST_PORT` and gives you a `health()` preflight with an
actionable message); TypeScript gets it from `tests/playwright/companion-bridge.ts`. **Never
paste a literal `"http://127.0.0.1:17320"` into a driver** — the server takes a fallback
port on `EADDRINUSE` (`test_automation.rs:1415`), so a pinned literal will happily drive a
*stale* app instance and pass. **To read a value out of the app, call `/bridge-exec` with a
named bridge method — never `/eval`**, which is fire-and-forget and returns `{"success":
true}` whatever happens; the `#__probe` DOM-stash is a legitimate escape hatch for arbitrary
expressions only, and it does not survive a reload. If your test needs a clean database or
must coexist with the developer's own running app, use **`launchIsolated()`**
(`scripts/test/launch-isolated.mjs:142`) — it boots its own instance on shifted ports with a
throwaway data dir, waits for `/health`, and hands you `{ port, stop }`, which makes both
"forgot to start the app" and "pinned the wrong port" unreachable states. Finally, be honest
with yourself about what you have proven: **nothing in this corpus runs in CI.** A driver
you wrote and ran once is a *demonstration*, not a regression test, and it will rot silently
— 44% of this repo's own documented testid vocabulary already has.

## 3. Mandated primitives

- **`src-tauri/src/test_automation.rs:1353` — `build_router()`. The 46-route HTTP surface.**
  `/health` · 14 primitives (`/navigate`, `/click`, `/type`, `/query`, `/find-text`,
  `/state`, `/wait`, `/list-interactive`, `/eval`, `/focus`, `/screenshot`, `/perf/*` ×3) ·
  17 workflow macros · 5 overview/credential helpers · 6 `/build/*` wrappers ·
  `/bridge-exec` · `/test/reset` · `/test/snapshot`. This is the real API. Read it, not the
  doc (§7 B).
- **`src-tauri/src/test_automation.rs:1272` — `POST /bridge-exec`. The one you should
  reach for.** Forwards `{method, params, timeout_secs}` to **any** of the 104 bridge
  methods and **returns its value**. It validates the method name is
  alphanumeric/underscore (`:1281-1290`) so nothing clever reaches the eval'd JS, and
  defaults to a 180 s budget clamped to 300 s. **It is the answer to "`/eval` can't return
  anything", and it means a new scenario helper needs a `bridge.ts` method and nothing
  else — no Rust handler, no MCP tool.**
- **`src-tauri/src/test_automation.rs:151` — `eval_bridge_method_with_timeout()`.** Three
  attempts, and before each retry it calls `force_foreground()` (`:143` — `unminimize` +
  `show` + `set_focus`). The comment names the failure it exists for: *"A backgrounded /
  occluded webview silently drops eval'd JS"* — the harness's **#1 flakiness source**. If a
  live run is flaky, this is why, and `POST /focus` (`:247`) is the manual lever.
- **`tools/test-mcp/lib/client.py:23` — `Client`.** The shared Python HTTP client. Reads
  `PERSONAS_TEST_PORT` (`:33`), 120 s default timeout, returns `{"_raw", "_status"}` instead
  of throwing on non-JSON, and `health()` (`:52`) raises `SystemExit` with *"Launch the app
  with `npm run tauri:dev:test`."* Its own docstring says it *"replaces the per-script
  post/get helpers duplicated across ~34 e2e scripts"*. **10 of 84 drivers use it** (§7 D).
- **`tests/playwright/companion-bridge.ts` — the TS counterpart.** `openChatPanel`,
  `resetConversation`, `sendAndAwait`, `snapshotPanel`, `bootstrapFreshUser`. Port from
  `COMPANION_TEST_PORT` (`:23`).
- **`scripts/test/launch-isolated.mjs:142` — `launchIsolated(opts) → { port, dataDir, stop }`.**
  **The most under-used primitive in this document.** Boots a dev instance with
  `PERSONAS_DATA_DIR` (a `mkdtemp`), `PERSONAS_VITE_PORT`, `PERSONAS_TEST_PORT`,
  `PERSONAS_WEBHOOK_PORT` all shifted, polls `/health` across the fallback range, and cleans
  up. Its header is the best statement in the repo of *why* a shared dev instance makes a
  test prove the wrong thing. **2 consumers** (`run-tours-fresh.mjs:71`,
  `e2e_kpi_portability.mjs:39`) out of ~140 drivers. §4 answers why this is the type-level fix.
- **`src/test/automation/bridge.ts:210-2826` — the `bridge` object, 104 methods.** Loaded
  by `App.tsx:226-229` under `import.meta.env.DEV || window.__PERSONAS_TEST_MODE__`, so it
  is tree-shaken from production. **Only 51 are declared on `interface TestBridge` (`:52`)**
  — the other 53 are reachable through `/bridge-exec` and typed by nothing.
- **`src/test/automation/bridge.ts:2789` — `__exec__(id, method, params)`.** The dispatcher.
  `resolveArgs`/`parseParamNames` (`:150-196`) map a params **object** onto positional args
  by declared name; the comment records the bug that forced it (method shorthand fell
  through to `Object.values`, giving alphabetical arg order). Pass params by name.
- **`tools/test-mcp/smoke_test.py` — the only checked-in suite that asserts, 28 tests.**
  19 `test(...)` registrations, one inside a 10-section loop. Framework validation only —
  navigate/query/click/wait/eval round-trips — deliberately no business logic. 395 lines.
- **`src-tauri/src/test_automation.rs:1415` — `bind_with_fallback()` and `:1343`
  `SERVER_LISTENING_EVENT`.** Tries 17320..17324, emits the bound port as a Tauri event
  *"so test harnesses can discover a fallback port"*. **It has zero consumers** (§8 Gap 1).

**Nothing else is a primitive.** There is no WebDriver, no `tauri-driver`, no browser, no
page-object layer, no fixture/factory module, no shared assertion helpers, no retry policy
outside the Rust bridge, and **no `.mcp.json`** — that file is gitignored (`.gitignore:61`)
and no example exists, so the MCP layer is per-developer and absent from a fresh clone.

## 4. Steps

1. **Plant the identifier (frontend half).** Add `data-testid="semantic-name"` — or pass
   `testId="…"` to a shared primitive that forwards it. Name the *thing*
   (`agent-delete-confirm`), never the position (`third-button`) or the style. If the
   element is one of a set, use the template form the repo already uses 352 times
   (`` data-testid={`exec-row-${id}`} ``) — but know that a template-literal testid is
   invisible to every static check (§8 Gap 3).
2. **Start the app.** `npm run tauri:dev:test`. This runs
   `scripts/dev/tauri-dev-test.mjs`, which merges `tauri.lite.conf.json` (giving
   `--features desktop`) with a `devUrl` derived from `PERSONAS_VITE_PORT`, then appends
   `-- --features test-automation`. **Do not run `cargo build --features test-automation`
   yourself** — that bypasses the Tauri CLI, so the `features` block in the config never
   applies, and the build dies on `updater:default`. That is precisely and only what is
   wrong with `e2e-smoke.yml:60` (§7 C1).
3. **Preflight.** `Client().health()` in Python, `health()` in `beforeAll` for a spec.
   A driver that starts issuing commands without this produces a connection error that
   reads like a product bug.
4. **Drive through the shared client, never a literal URL.**
   ```python
   from lib.client import Client          # reads PERSONAS_TEST_PORT
   c = Client()
   c.health()
   c.post("/navigate", {"section": "personas"})
   c.post("/click-testid", {"test_id": "create-agent-btn"})
   c.post("/wait", {"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 10000})
   ```
5. **To read state back, use `/bridge-exec` — not `/eval`.**
   ```python
   snap = c.post("/bridge-exec", {"method": "getRichSnapshot", "params": {}})
   ```
   If the method you need does not exist, **add it to `bridge.ts` and stop there** —
   `/bridge-exec` reaches it with no Rust and no MCP change. A new `test_automation.rs`
   route is only warranted when the operation must bypass the frontend entirely (the six
   `/build/*` handlers and `/adopt-template` are the legitimate examples; they call Tauri
   commands directly because the frontend may not be mounted).
6. **Only if you need an arbitrary expression, use the `#__probe` stash — and know its two
   rules.** `POST /eval` a snippet that writes `JSON.stringify(expr)` into a hidden
   `<span id="__probe">`, then `POST /query {"selector":"#__probe"}` and parse `text`.
   Reference implementation: `tests/playwright/freeze-probe2.mjs:9-13`. **Rule one: it does
   not survive a reload** — an HMR update or an app restart wipes the node, and a
   concurrent session rebuilding the frontend will wipe it mid-test
   (`.claude/active-runs.md:2051`). **Rule two: that wipe is more useful as a signal than as
   a nuisance** — the disappearance of `#__probe` is the repo's most reliable app-restart
   detector, because `/health` keeps answering from the old binary during a rebuild
   (`.claude/active-runs.md:2058`).
7. **If you need a clean DB, or must not fight the developer's app, use `launchIsolated()`.**
   ```js
   import { launchIsolated } from '../../scripts/test/launch-isolated.mjs';
   const inst = await launchIsolated({ inheritStdio: false });
   process.env.COMPANION_TEST_PORT = String(inst.port);
   try { /* … */ } finally { await inst.stop(); }
   ```
8. **Stop, and say what you actually proved.** A driver you ran by hand once verified the
   app *at that moment on your machine*. It is not a regression test — nothing will ever run
   it again. If the behaviour must stay working, the honest home for that assertion today is
   a **Vitest component test** (401 files, jsdom, gated by `ci.yml:183`), not a new
   `e2e_*.py`. Adding the 85th unrun driver is the anti-pattern this document exists to stop.

### Can the primitive's signature make the wrong call impossible? — answered

The contract asks this before §9. **Yes, twice, and one of the two fixes is already
written and sitting unused.**

- **`launchIsolated()` already makes the two commonest failures unrepresentable, and 138 of
  ~140 drivers decline it.** A driver that takes its base URL from `inst.port` cannot pin a
  stale instance and cannot run against a non-existent app — the value does not exist until
  the app is up and healthy. This is *exactly* the mechanism `personas-web` gets from
  Playwright's 7-line `webServer` block (§Convergence), except Personas' version is more
  capable (isolated data dir, isolated Vite, isolated webhook port) and is used **2 times**.
  **The fix is not to write anything: it is to make `launchIsolated()` the only documented
  way to obtain a client, and to give `lib/client.py` a `Client.from_instance(inst)` twin so
  the Python corpus can reach it too.** Every one of the 60 sites in §9's baseline then
  becomes a value it cannot construct, rather than a string a linter complains about.
- **`data-testid` is a raw string on both sides, and that is why the contract rots.** The
  app exposes 1,069 unique static ids; the doc publishes 122 as the stable vocabulary; **54
  of those 122 no longer exist in `src/`** (§7 A). Nothing connects the two. The type-level
  fix is a generated union: emit `src/test/automation/testIds.generated.ts` as
  `export type TestId = 'sidebar-home' | …` from a codegen pass over `src/`, have
  `click_testid`/`fill_field` and the TS bridges accept only `TestId`, and a renamed testid
  becomes a **compile error in every driver at once** instead of a runtime "element not
  found" three months later. The 352 template shapes are the hard part and are a real
  design question, not an oversight (§8 Gap 3) — but the 1,069 static ids are 75% of the
  surface and are mechanical.
- **A type cannot see "nothing runs this."** Whether a driver is ever executed is a property
  of `package.json` scripts and workflow YAML, not of source text. That half stays a
  refusal, and it is §9's most important item.

## 5. Anti-patterns

- **`BASE = "http://127.0.0.1:17320"` at the top of a driver.** **60 sites in 54 files.**
  The server falls back to 17321–17324 on `EADDRINUSE` (`test_automation.rs:1415-1445`) and
  `lib.rs:1533-1541` documents parallel instances as a *supported* workflow. So the realistic
  failure is not a connection error — it is a **stale dev instance holding 17320 while your
  new build sits on 17321**, your driver dutifully exercising the old binary, and every
  assertion passing. A green run against the wrong app.
- **Using `/eval` to read a value.** It returns `{"success": true}` unconditionally
  (`test_automation.rs:342`). There is no failure mode where it tells you it did not work.
  **30 of 84 Python drivers post to `/eval`.**
- **Reaching for `#__probe` when `/bridge-exec` would do.** The stash is for arbitrary
  expressions. If you want a named thing out of the app, `/bridge-exec` returns it directly
  and survives reloads.
- **Adding a Rust route for a new scenario helper.** `/bridge-exec` was built precisely so
  you would not (`:1253-1261`). Three layers must be edited to add a *tool*; one to add a
  *capability*. That three-layer cost is why the MCP layer is 3 months and 23 routes behind.
- **Copying `post()`/`get()` into a new driver.** **30 drivers define their own**; **72 of
  84 import `httpx`/`requests` directly**; only **10** use `lib/client.py` — whose docstring
  says it exists to replace exactly this. Each copy re-decides the timeout and silently
  drops `health()`.
- **Writing an `e2e_*.py` and calling it a test.** 49 exist. **20 of 84 contain any
  `assert`.** 43 exit non-zero on failure. None is run by any script, hook, or workflow.
- **Trusting a testid you found in the docs.** `docs/development/test-automation.md`
  publishes 122; **54 are absent from all of `src/`**, including every one of the 9
  `home-card-*`, all 5 `lab-mode-*`, all 4 `events-*`, and `create-agent-btn` — which the
  doc's own "Create an agent" walkthrough tells you to click.
- **`cargo build --features test-automation` without `desktop`.** The feature is declared
  standalone (`Cargo.toml:64-69`) and deliberately does *not* imply `desktop`, so the
  updater plugin is absent and `tauri-build` rejects `capabilities/default.json:19`. 38 CI
  runs, 0 green.
- **Assuming the bridge is compiled out of release builds.** `lib.rs:43` declares
  `pub mod test_automation;` **unconditionally** — the `#[cfg(debug_assertions)]` on `:41`
  guards `stream_harness`, not this. All 46 handlers compile into every build. What is
  gated is the *server start* (`lib.rs:1538-1565`, a correct three-way `cfg` that refuses
  the env-var path in release builds without the feature — the 2026-07-02 security fix). The
  security posture is sound; the doc's *"adds zero overhead to production builds"* is not.
- **Leaving the window occluded during a run.** A backgrounded WebView suspends and drops
  eval'd JS. The bridge retries 3× with `force_foreground()`, but a run under an RDP session
  or a minimized window will still be flaky. `POST /focus` first.

## 6. Evidence

- **`src-tauri/src/test_automation.rs:140-172` — read this first.** `force_foreground()`
  plus the 3-attempt retry, with the header comment naming the exact failure
  (*"A backgrounded / occluded webview silently drops eval'd JS — the test bridge's main
  flakiness source"*). This is what a harness primitive should look like: the workaround and
  the reason it exists, together.
- **`src-tauri/src/test_automation.rs:189-201`** — `try_eval_bridge` removes the pending
  entry on *every* path, with a comment explaining that the happy path already removed it and
  this exists so a timeout cannot strand a `oneshot::Sender` in the map *"and avoids
  id-collision risk on long automation sessions."* A leak fixed before it was a bug.
- **`src-tauri/src/test_automation.rs:1447-1495` — `start_server`.** Binds **inline** so the
  caller sees `EADDRINUSE` synchronously *"rather than waiting for the test harness to time
  out polling a server that never started"*, then emits the bound port. The design is right;
  §8 Gap 1 is that nobody listens.
- **`scripts/test/launch-isolated.mjs:1-50`** — 50 lines of header that state the problem
  (specs ran against the developer's dirty shared DB, so they proved *"the tour structurally
  walks"* not *"a brand-new user from an empty DB can complete it"*), the four env overrides
  that fix it, why it is safe to run beside the main instance (single-instance is enforced
  only in release), **and what it deliberately does not isolate** (the WebView2 user-data
  folder, closed at the spec layer by `bootstrapFreshUser()`). Copy this level of honesty.
- **`tools/test-mcp/lib/client.py:52-59`** — `health()` raising `SystemExit` with the literal
  command to run. Two lines that turn the corpus's most common failure into an instruction.
- **`playwright.config.ts:30-47`** — the architecture note explaining that these tests launch
  no browser and Playwright is present only for `expect()`, scheduling and the reporter, plus
  why (*"tauri-driver-via-WebDriver is too brittle on Windows"*). It also states the
  prerequisite it cannot enforce, which is the honest half of §7 C.
- **`playwright.config.ts:52-57`** — `timeout: 360_000` and `workers: 1`, each with the
  measured reason (a real Opus turn is 30–90 s; the companion has one backend session, so
  parallelism would corrupt the transcript). `tests/playwright/README.md:60` goes further and
  names the *right* future fix — per-test session ids, *"not multi-worker hacks."*
- **`tools/test-mcp/smoke_test.py`** — the only file in the corpus shaped like a suite:
  28 tests, PASS/FAIL table, timings, and a scope it states and keeps (framework validation,
  no business assertions).
- **`src/test/automation/bridge.ts:150-196`** — `parseParamNames`, with the five function
  shapes enumerated and the regression recorded (*"method shorthand fell through →
  Object.values fallback → alphabetical arg order bug that was the whole reason we added
  named dispatch"*).

## 7. Deviations found

**Four categories, 17 individually-addressable items.** Everything here ships green under
`npm run check`, `npm run test -- --run`, and both lefthook stages, because **not one of
them is examined by any gate**.

### A. The two-sided contract has rotted, and nothing can see it — 4 (the headline)

**A1 — 54 of the 122 static `data-testid`s published by `docs/development/test-automation.md`
(44.3%) do not exist anywhere in `src/`.** Measured by a single pass concatenating every
`.ts`/`.tsx`/`.json` under `src/` and testing substring membership — no regex inference, no
extractor of mine involved. Whole categories are dead: **all 9** `home-card-*`, **all 5**
`lab-mode-*` (arena/ab/eval/matrix/versions), **all 4** `events-*`, **all 7**
`editor-tab-*`, **all 4** `ctx-*`, **all 9** vault wizard/autopilot ids, plus
`create-agent-btn`, `agent-name-input`, `agent-test-btn`, `run-test-btn`, `exec-try-it`.
The doc's own "Create an agent" walkthrough (`:352-359`) opens by clicking
`create-agent-btn`, which is absent from the entire source tree. **This is the leaf's
central defect: the published contract between the two sides is 44% fiction.**

**A2 — 926 of 1,069 planted static testids (86.6%) are never named by any driver.** The
supply side is not the problem — the app is generously instrumented. The vocabulary is
simply unused, which means the 44% that rotted did so with nothing to notice.

**A3 — the driver-side phantom rate is UNKNOWABLE statically, and that is the real
finding.** 206 distinct testids are named in a driver's testid position. 102 resolve to a
static planted id; the rest resolve — or fail to — through **352 template-literal shapes**,
three of which (`` `${x}-input` ``, `` `${x}-toggle` ``, `` `${x}-${y}` ``) match almost
anything. Depending on how generously you treat those three, the phantom count is anywhere
from **0 to 85**. I could not narrow it without running the app. *Marked unverified;
resolve by driving the app once and collecting `document.querySelectorAll('[data-testid]')`.*

**A4 — the harness has no entry in `scripts/docs/feature-doc-map.json`, and this is upstream
of A1.** Zero of its **37** entries carry a `sourceGlob` matching `src-tauri/src/test_automation.rs`,
`src/test/automation/**`, `tools/test-mcp/**` or `tests/playwright/**`. So the Stop hook
that fires on every session editing feature source **can never fire for this surface**. The
doc has drifted for months by construction, not by neglect. **Adding one map entry is the
cheapest structural fix in this document.**

### B. The canonical document is wrong in six places — 6

All in `docs/development/test-automation.md`, all downstream of A4.

| # | Doc says | Truth |
|---|---|---|
| B1 | `:12`, File Structure: *"Python MCP server, 20 tools"* | **23** — and `:55` in the same file says 23 |
| B2 | `:39`: *"The MCP server is configured in `.mcp.json`"*, listed in File Structure as a repo file | `.mcp.json` is **gitignored** (`.gitignore:61`), absent from `git ls-files`, and **no `.mcp.json.example` exists**. A fresh clone has no MCP wiring and no template for one |
| B3 | `:426-429`: `test-automation = []` | `Cargo.toml:69`: `test-automation = ["dep:xcap", "dep:image"]` |
| B4 | `:422-424`: *"compiled only when the `test-automation` Cargo feature is enabled. It adds zero overhead to production builds."* | `lib.rs:43` declares the module unconditionally; all 46 handlers compile into every build. Only the **server start** is gated (`lib.rs:1538-1565`) |
| B5 | Mode table: Dev port *"17320 (**fixed**)"* | `bind_with_fallback` (`:1415`) tries **17320–17324**. This is the belief that makes §9's 60 pinned literals feel safe |
| B6 | `:26`: `npx tauri dev --features test-automation` as the quick start | Works, but resolves `features` from `tauri.conf.json:11` = **`desktop-full`**, i.e. the full ml+p2p compile. `.claude/CLAUDE.md` recommends lite for exactly this reason; `npm run tauri:dev:test` is the intended command |

### C. Nothing automated ever drives the live app — 3

**C1 — `e2e-smoke.yml` has failed 38 out of 38 runs and cannot succeed.** `:60` runs
`cargo build --features test-automation --manifest-path src-tauri/Cargo.toml`, bypassing the
Tauri CLI and therefore the `features: ["desktop-full"]` block at `tauri.conf.json:11`. With
no `desktop`, `tauri-plugin-updater` is absent and `tauri-build` rejects
`capabilities/default.json:19`. Log (`gh run view 29532610138 --log-failed`):
`Permission updater:default not found, expected one of core:default, …` → `exit code 101`.
The step carries **no** `continue-on-error` — that guard is on `:65`, the step *after*, which
has never been reached. Conclusions in the workflow's own header (*"After 5 consecutive green
runs, flip continue-on-error to false"*) describe a state that has never occurred.
**The fix is one word:** `--features desktop,test-automation`. Whether the job then goes green
is **unverified** — I could not build.

**C2 — no workflow mentions `playwright`.** All 7 checked. So the 32 `.spec.ts` files under
`tests/playwright/` — companion conversation, guided walkthroughs, tours, fleet, discord
twin, template marathon, preset adoption, perf nav-walk — run **only** when a human types
the command. `package.json` names 5 Playwright scripts, and 4 of them target a specific
spec, so **28 of 32 specs are not reachable from any named script at all**. `vitest.config.ts:17`
does include `tests/playwright/**/*.test.ts`, which reaches exactly **one** file
(`__tests__/template-marathon-fixtures.test.ts`) — a pure fixture test that never touches
the app.

**C3 — `lefthook.yml` runs no live-app step**, and its only test line is
`npm run test:evals` (`:63`). So the pre-commit/pre-push gates cannot see this surface either.
**Net: the complete set of machinery that automatically verifies a UI change in this repo is
`ci.yml:183` — `npm run test -- --run`, 401 Vitest files under jsdom.** That is real coverage
and should not be disparaged; it is simply not the live app, which is what this leaf is about.

### D. The driver corpus is a pile of one-offs, not a suite — 4

**D1 — 60 hardcoded harness endpoints across 54 files** (§9's baseline; 100% precision,
verified site-by-site). Worst concentration: `tools/test-mcp` (34 files), `tests/playwright`
(16). Six of them are inline `fetch('http://127.0.0.1:17320/bridge-exec')` calls inside one
spec (`twin-cycle-features.spec.ts:51,70,85,120,136`).

**D2 — two different env-var names mean the same thing, and you must set both.** The Rust
server reads **`PERSONAS_TEST_PORT`** (`test_automation.rs:1347`). The entire TypeScript
harness reads **`COMPANION_TEST_PORT`** (`companion-bridge.ts:23`, `adoption-bridge.ts:18`,
`artist-bridge.ts:22`, `perf-nav-walk.spec.ts:30`, `preset-questionnaire.spec.ts:51`,
`template-marathon-bridge.ts:11`, `discord-twin-*.spec.ts`). A third set of `.mjs` drivers
reads `PERSONAS_BASE`; one reads `PERSONAS_TEST_BASE`; one reads `COMPANION_BRIDGE`; one
reads `BRIDGE`. **Six names for one value.** `tests/playwright/README.md:18-24` documents the
consequence honestly — you must export `PERSONAS_TEST_PORT` *and* `COMPANION_TEST_PORT` to
the same number — which is a workaround presented as a procedure.

**D3 — 10 of 84 Python drivers use the shared client.** 72 import `httpx`/`requests`
directly; 30 define their own `post`/`get` helper; 69 of the 73 that name the port never read
`PERSONAS_TEST_PORT`. `lib/client.py` was written to end this and reached 12% adoption.
Ten `_`-prefixed files (`_poke_submit.py`, `_gallery_force.py`, `_root_cause.py`, …) are
one-shot debugging probes from closed investigations, still checked in.

**D4 — `tools/test-mcp/server.py` is 3 months and 23 routes behind the server it fronts.**
Last touched 2026-05-08; `test_automation.rs` 2026-07-26, `bridge.ts` 2026-08-07. It exposes
**23** of the **46** HTTP routes. Absent from the MCP surface: every `/build/*` endpoint (6),
`/bridge-exec` (the generic dispatcher — so an MCP client cannot reach any of the 104 bridge
methods), `/screenshot`, `/focus`, all three `/perf/*`, `/execute-persona`, `/adopt-template`,
`/promote-build`, `/persona-detail`, `/overview-counts`, `/list-credentials`,
`/list-cli-capturable`, `/cli-capture-run`, `/refresh-personas`, `/open-matrix-adoption`,
`/test/snapshot`. The three-layer add cost (§5) is the mechanism; §4 step 5 is the way out.

## 8. Gaps in the primitive

1. **The server publishes its port and nothing subscribes.** `SERVER_LISTENING_EVENT`
   (`test_automation.rs:1343`) is emitted at `:1486` with the bound port, expressly *"so test
   harnesses can discover a fallback port"*. Repo-wide it appears in **3 places, all inside
   `test_automation.rs` itself** — the const, a doc comment, and the emit. It is a Tauri
   event, so an out-of-process HTTP driver could not consume it anyway without a channel that
   does not exist. **The discovery mechanism is unreachable by the clients it was built for**,
   which is why §9's condition is a gate rather than a fixed bug. The real fix is smaller than
   it looks: have `start_server` write the bound port to a well-known file
   (`$PERSONAS_DATA_DIR/.test-port`) that any driver can read.
2. **The fallback makes a wrong-target run *more* likely, not less.** Binding 17321 when a
   stale app holds 17320 converts a loud `EADDRINUSE` into a silent misdirection for the 60
   pinned drivers. A safer default would be to fail closed unless `PERSONAS_TEST_PORT` is
   explicitly set — which `lib.rs:1533-1541` already calls the *deterministic* path.
3. **A template-literal `data-testid` is invisible to every static tool.** 352 shapes. No
   generated union, no lint, no grep can connect `` `exec-row-${id}` `` to a driver's
   `exec-row-abc123`. This is what caps §4's type-level fix at ~75% of the surface, and it is
   a genuine design question — not laziness.
4. **`/eval` cannot return a value and there is no plan for it to.** The `oneshot` machinery
   exists (`try_eval_bridge`) and `handle_eval` simply does not use it. Routing `/eval`
   through a wrapper bridge method that evaluates and responds would remove the `#__probe`
   pattern entirely; nothing in the design prevents it.
5. **There is no driver-side fixture layer.** No shared setup/teardown, no seeded-state
   helper, no cleanup contract. `bootstrapFreshUser()` in `companion-bridge.ts` is the only
   thing resembling one, and it exists because `launchIsolated` cannot isolate the WebView2
   user-data folder.
6. **Nothing measures the corpus.** A driver deleted, a spec renamed, a testid removed —
   all silent. The suite has no size, because it is not a suite.
7. **The three-layer tool cost is structural.** Adding an MCP-visible capability needs
   `bridge.ts` + `test_automation.rs` + `server.py`. `/bridge-exec` collapses two of the
   three for HTTP clients but is itself not exposed as an MCP tool (D4), so the MCP layer
   still pays full price. Exposing `/bridge-exec` as a single generic MCP tool would make
   all 104 bridge methods reachable from Claude Code at once.
8. **A live-app CI job is expensive in a way a unit suite is not.** The e2e-smoke job is
   capped at 30 minutes and the two runs that got furthest took ~10 min *before* failing at
   the build. `personas-web` reached the same conclusion from the other direction and moved
   its browser suite to a nightly cron (§Convergence). Any "just turn it on" proposal has to
   price this.

## 9. The missing gate

Three items: **one census rule** (validated below), **one refusal** that is the most
important entry in this section, and **one fix that is not a gate at all**.

### 1. Census rule — `pinned-harness-endpoint`

**The condition (stack-free):** *a test driver pins the address of the system under test
instead of obtaining it from the harness's own discovery channel, so it cannot follow the
system when it moves — and silently drives whatever else answers.*

**The proxy in this repo:** a quoted loopback URL naming the test-automation port, either
assigned to a name or passed to `fetch(`. **PRECONDITION, and an adopting repo must
re-derive its own:** this works because Personas' drivers are standalone scripts that name
their target in their own source. A repo where the target is owned by a config object —
`personas-web`'s `playwright.config.ts` `webServer` block owns port 3002 and **no spec names
it** — scores zero here, correctly, because the condition is absent by construction. The
equivalent proxy elsewhere is "a driver that constructs its own transport instead of
receiving one."

```json
{
  "rules": [
    {
      "id": "pinned-harness-endpoint",
      "goldenPath": "docs/concepts/golden-paths/live-ui-test-automation.md",
      "title": "A live-UI driver binds the harness endpoint to a literal host:port instead of discovering it, so when the server takes a fallback port the driver silently drives the WRONG app instance",
      "roots": ["tools", "tests", "scripts", "uat"],
      "extensions": [".py", ".mjs", ".ts", ".tsx", ".js"],
      "signal": {
        "pattern": "(?:=\\s*|fetch\\(\\s*)[\"'`]https?://(?:127\\.0\\.0\\.1|localhost):1732\\d",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a live-UI driver assigns, or fetches from, a string literal naming the test-automation harness host:port. PROXY FOR the stack-free condition: a test driver pins the address of the system under test instead of obtaining it from the harness's own discovery channel, so it cannot follow the system when it moves. Measured 2026-08-14: 60 matches in 54 files, precision 100% verified site-by-site against a second implementation. This matters here because src-tauri/src/test_automation.rs:1415 bind_with_fallback() tries 17320..17324 on EADDRINUSE and :1486 emits the bound port as the SERVER_LISTENING_EVENT Tauri event -- which has ZERO consumers repo-wide. A stale dev instance holding 17320 therefore makes the new app bind 17321 while all 60 of these sites keep driving the stale one, green. The legal destinations are tools/test-mcp/lib/client.py (reads PERSONAS_TEST_PORT, 10 of 84 Python drivers use it), tests/playwright/companion-bridge.ts, and scripts/test/launch-isolated.mjs (which returns the live port and has 2 consumers). The pattern deliberately requires the literal to be ASSIGNED or FETCHED so that os.environ.get(\"PERSONAS_TEST_BASE\", \"http://127.0.0.1:17320\") and process.env.X || 'http://localhost:17320' -- the CORRECT form, 13 sites -- do not match; the bare-number signal 17320 scores only 60% precision because it also hits those plus 95 prose mentions. KNOWN BENIGN MEMBER, left in the baseline on purpose: scripts/.archived/verify-scoping-live.mjs:18 is a retired script; a path exclude there would blind the rule to a live script added to the same directory later, and removing it costs one --update. PRECONDITION: this proxy assumes the harness is reached over a loopback URL that appears verbatim in driver source. A repo whose driver receives its target from a config object (personas-web's playwright.config.ts webServer block owns the port and no spec names it) scores zero here while the condition is absent by construction -- re-derive against wherever the local drivers name their target."
      },
      "exclude": [],
      "baseline": { "files": 54, "matches": 60 },
      "floor": 300
    }
  ]
}
```

**Counts verified through two independent implementations, which agreed exactly on the first
try.** A standalone Node classifier walking the same four roots and bucketing every match as
true-positive / env-defaulted / prose returned **60 matches in 54 files**; the census engine
returned **60 in 54**, walking **342** files. No reconciliation was needed — unusually, since
the sibling `hand-rolled-fixture-ddl` rule needed two.

**Precision was measured, not asserted, and two weaker candidates were rejected on it.**
The bare literal `17320` across the same roots: **237 matches, 142 code / 95 prose → 59.9%**.
A quoted base URL without the assignment/fetch anchor: **74 matches, 60 true / 13
env-defaulted / 1 prose → 81.1%**. The anchored form: **60 matches, 60 true, 0 env-defaulted,
0 prose → 100%**, checked by reading all 60 sites. The anchor is what excludes the *correct*
pattern — `os.environ.get("PERSONAS_TEST_BASE", "http://…")` and `process.env.X || 'http://…'`
— which is precisely the 13 sites a naive rule would have punished for doing the right thing.

Per the engine's caveat, `\s*` lets this pattern span at most one newline; `ignoreCommentLines`
is safe because the engine rewinds to `match.index + 1` rather than past a skipped match's
extent (`engine.mjs:196-206`). Measured `commentMatchesSkipped: 0` today.

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check --rules
<file>`), from a scratchpad file named `census-liveui-4e91a7.json` unique to this composition:

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `census OK — 1 rule(s), 342 file-visits, 60 surviving violation(s) across 54 file(s).` |
| matcher matches nothing (`NoSuchHarnessLiteralXYZ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped … -> 0` |
| floor above walk (`floor: 5000`) | **1** | `[structural] walked 342 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `["tools"]`) | **1** | `walked 114 … floor is 300` + `files 54→37`, `matches 60→37` |
| count rises (baseline lowered to 50/55) | **1** | `[drift] matches rose 55 -> 60 (+5)` |
| renamed root (`toolz`) | **1** | `walked 228 … floor is 300` + both drops |
| stale `exclude` (`tools/test-mcp/deleted_driver.py`, with a real reason) | **1** | `[structural] exclude … matched no file. The exemption is stale…` |
| `exclude` with an empty `reason` | **1** | `census: rules[0] … needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |

All eight behave as the contract requires, including the case a ratchet most needs: a **drop**
is fatal, so "somebody deleted the drivers" and "somebody broke the matcher" both go red.

**Confirmed not a duplicate.** All 34 rules currently in `scripts/census/rules.json` root at
`src`, `src-tauri`, or `src/lib/bindings`. **None walks `tools/`, `tests/`, `scripts/` or
`uat/`** — this is the first rule to gate the driver corpus, and no existing rule's signal
overlaps it. The adjacent `feature-flagged-compilation.md` publishes only
`build-gated-ipc-entrypoint`.

**And it will actually be enforced:** `package.json:51` runs `npm run census:check` inside
`check`, and `ci.yml:111` runs `npm run check`.

### 2. REFUSED — a gate on "does anything actually run this?"

**This is the gate this leaf most needs, and I am refusing to specify a census rule for it,
with the measurement behind the refusal.**

The condition — *a test exists, is never executed by any script/hook/workflow, and therefore
rots* — is real and large here: **84 Python drivers, 28 of 32 Playwright specs unreachable
from any named script, 0 of 7 workflows mentioning `playwright`, and one CI job red 38/38.**
It is also **not content-matchable**. Whether a file is executed is a property of the
*graph* over `package.json` scripts, workflow YAML `run:` strings, and lefthook stages — none
of which is text inside the file being judged. Every proxy I considered fails:

- *"a driver with no `assert`"* — 64 of 84 would match, but 43 exit non-zero via `sys.exit`,
  so precision collapses to ~24% and it punishes a legitimate style.
- *"a file under `tools/test-mcp/`"* — matches 84 of 84. A rule that flags an entire
  directory is a directory listing, not a gate.
- *"a spec not named in `package.json`"* — needs the script graph, which the census engine
  does not build (it reads one file at a time and has no cross-file index).

**The mechanism that CAN see it is not a census rule and not an ESLint rule — it is a ~40-line
checker**, and the right home is the `scripts/check-cargo-invocations.mjs` family already
specified by [`feature-flagged-compilation.md`](./feature-flagged-compilation.md) §9 item 2,
which reads invocations as **structured data**. Extend that same script (do not write a
second one) with one assertion:

> **Every `.spec.ts` under `tests/playwright/` and every `e2e_*.py` under `tools/test-mcp/`
> must be reachable from a `package.json` script or a workflow `run:` line.** Report the
> unreachable count and name the files. Fail-loud precondition: assert the walk found
> **≥ 25 spec files and ≥ 40 driver scripts** before asserting anything, and print the
> audited totals on success — otherwise a renamed directory reports a clean bill of health.

Today that check would print `28 of 32 specs and 84 of 84 drivers are unreachable`, which is
the single most useful sentence anyone could put in this repo's build log.

### 3. NOT A GATE — the one-word fix, and the map entry

Two changes are worth more than either gate above and neither needs new machinery:

- **`e2e-smoke.yml:60` → `cargo build --features desktop,test-automation …`.** One word.
  It is the difference between a CI job that has failed 38 consecutive times at the build
  step and one that at least reaches the app it was written to smoke-test. *(Whether it then
  passes is **unverified**.)* The flag rationale is owned by
  [`feature-flagged-compilation.md`](./feature-flagged-compilation.md); the consequence is
  owned here. **A gate is not needed for this because a gate already exists and is red** —
  the failure was never invisible, only ignored, which is a different disease with a
  different cure (see §Convergence, "shared trap").
- **Add one entry to `scripts/docs/feature-doc-map.json`** mapping
  `src-tauri/src/test_automation.rs`, `src/test/automation/**`, `tools/test-mcp/**` and
  `tests/playwright/**` → `docs/development/test-automation.md`. Zero of the current 37
  entries cover this surface, which is the structural reason §7 B exists at all. This turns
  every one of B1–B6 from "drift nobody could have caught" into a Stop-hook nag in the
  session that causes it.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. Not because warnings drown in a large baseline — the baseline is
**1,135** ([`shared-facts.json`](../shared-facts.json)). The count-independent argument is the
only one that holds: `npm run check` runs `eslint src/` with **no `--max-warnings`**
(`package.json:51`) and the pre-commit hook runs `--quiet --max-warnings 99999`, where
`--quiet` discards warnings before they can be counted. **A warn-level rule enforces nothing
at either gate, at any count.** Note also that ESLint is scoped to `src/` here and would not
see `tools/`, `tests/` or `scripts/` at all — which is why §9 item 1 is a census rule and not
a lint rule.

## Convergence — what travels, what is local, and where the oracle contradicts me

Checked against `../personas-web` (Next.js), `../brainiac` (Rust workspace + Next.js
console) and `../personas-cloud` (Node orchestrator + FastAPI). All three exist and were
measured file-by-file.

**Physics — independently reinvented, so these clauses travel:**

- **"The runner must boot the app; a prerequisite in a human's head is not a mechanism."**
  `personas-web` reinvented this with a 7-line `webServer` block
  (`playwright.config.ts:19-25`: `command: "npm run build && npm run start -- --port 3002"`,
  `reuseExistingServer: !process.env.CI` with the comment *"CI must never test against a
  stale server"*). Personas reinvented it twice — `e2e-smoke.yml:71-86` (xvfb + a 60×5 s
  `/health` poll) and `launchIsolated()`. Two repos, two stacks, three implementations, one
  doctrine. **This is the strongest clause in the document and it is why §4 step 7 is
  mandatory rather than advisory.**
- **"A green run that verified nothing" recurs in every repo.** brainiac's `_pg.rs` tests
  self-skip when `DATABASE_URL` is unset; its `vitest.config.ts` carries the scar comment
  *"a test file under app/ was silently skipped — it did not fail, it simply never ran, and
  the suite stayed green while proving nothing."* personas-cloud's `bus.test.ts` is 406
  lines and 49 cases that **nothing executes** — no `test` script, no `.github/`, zero
  references anywhere. Personas' 84 drivers are the same species at larger scale.
- **Serial-by-necessity once a singleton is involved.** Personas pins `workers: 1` because
  the companion has one backend session; brainiac holds a Postgres advisory lock plus an
  in-binary mutex across all 43 test files. Different mechanisms, same forced discovery,
  both with the reason written into the header.

**The shared trap — and this is the finding that should change behaviour:**

**Everyone writes the live-app suite. Nobody gates on it. Not one repo in the fleet.**

| Repo | Live/e2e suite | Runs in CI? | Blocks a merge? |
|---|---|---|---|
| personas | 32 Playwright specs | **no workflow mentions playwright** | no |
| personas | 28-test Python smoke (`e2e-smoke.yml`) | triggers on PRs — **and has failed 38/38** | no |
| personas-web | 10 specs / 79 real-browser tests | **nightly cron + dispatch only** (`ci.yml:37`) | no |
| brainiac | none (UI logic kept pure, `environment: "node"`) | n/a | n/a |
| personas-cloud | 406-line hand-rolled `bus.test.ts` | **never — zero references** | no |

**Three never-gating suites across the fleet; zero blocking live-UI gates anywhere.** So
"we have an e2e suite" is a **convergent idiom that is a trap, not a licence** — and
`personas-web` supplies the receipt for what it costs. Its `git log -- e2e` reads
*"remove four stale specs targeting deleted routes"*, *"repoint drifted specs to the current
templates hub"*, *"fix stale assertions against rebuilt/renamed UI (**success-theater**)"*,
and its own feature doc admits two `test.skip`s masking a hydration flake, a `test.fixme` on
a navbar link, and *"the Supabase voting flow is never tested."* **An ungated live-app suite
drifts against the UI it was written to protect, and you find out in a batch cleanup commit
months later.** Personas' §7 A is the identical disease at the identifier layer — 54 dead
testids in the published contract — reached by the identical route.

**Where the oracle CONTRADICTS this document — reported honestly:**

- **Personas is NOT purely discipline-bound, and my §7 C framing understates it.** It has
  the *more* capable structural mechanism: `e2e-smoke.yml` genuinely boots the real app under
  xvfb on every PR, which `personas-web`'s nightly-only job does not. Personas' problem is
  not a missing mechanism — it is a **one-word build flag** that has kept the mechanism from
  ever reaching the app. That reframes the whole leaf: the gap is not "build a live-app CI
  job", it is "fix the one that exists." §9 item 3.
- **`personas-web` has the cheaper mechanism and squanders it; Personas has the expensive one
  and never boots it.** Neither ships a blocking live-UI gate, and both chose that for
  defensible reasons (cost, flake). A path that prescribed "gate on live UI" would be
  prescribing something no repo in the fleet has been willing to pay for. §9 does not
  prescribe it.
- **brainiac supplies a genuinely different third answer, and it deserves naming.** It has
  **zero** browser automation of any kind — repo-wide grep for
  `playwright|cypress|puppeteer|selenium|webdriver` hits only vitest's peer declarations in a
  lockfile — and its console's `vitest.config.ts` sets `environment: "node"`, not jsdom. It
  verifies UI *logic* by keeping that logic pure and node-testable (24 test files, gated
  blocking in CI alongside `tsc --noEmit`), and verifies the *system* through
  `uat/driver/mcp_call.sh`, which drives the **production** MCP path with the comment *"NEVER
  approximate this with a REST call… If you fake the payload, you are no longer measuring the
  product."* **Not needing a live-UI harness is a legitimate architecture, not an absence of
  one** — and Personas' own 401 Vitest files are the same bet, made quietly and gated
  properly (§7 C3). A future Personas session should weigh "move this logic out of the
  component" against "write the 85th driver."
- **The no-browser Playwright inversion is LOCAL CALIBRATION, not doctrine.** Zero of three
  siblings do it. `personas-web` launches a genuine chromium and navigates with `page.goto` /
  `getByRole`. Personas imports `@playwright/test` purely for `expect`, `workers` and the
  reporter while a hand-written HTTP client drives, and deliberately sets **no `baseURL`**.
  Its justification is legible and stack-specific ("Tauri 2 + WebDriver on Windows is
  brittle") and should be **re-derived, not inherited**, by any adopting repo.
- **The in-app `--features test-automation` eval backdoor is SINGULAR in the fleet.** No
  sibling compiles a test affordance into the shipped app. brainiac's nearest analogue is the
  *production* `brainiac mcp` subcommand — deliberately not a backdoor, precisely so the
  harness measures the real path. So §3's HTTP server is a **house convention**; the
  transferable clause is *"if your UI cannot be driven from outside, expose a narrow,
  build-gated seam and audit what it exposes"* — which Personas did do, at
  `lib.rs:1538-1565`, after a 2026-07-02 security review found `/eval` and
  `/list-credentials` reachable in release builds via an env var alone.
- **A caveat on my own convergence evidence:** whether `personas-web`'s nightly e2e job has
  ever completed green **could not be established** — no run history is readable from disk,
  and the local `test-results/.last-run.json` is a developer's machine. **Unverified.**
