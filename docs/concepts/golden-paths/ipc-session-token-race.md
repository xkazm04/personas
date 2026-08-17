# Golden path — the IPC session token and its validity window

> Situation node: `backend-runtime/command-authorization/ipc-session-token-race` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **HIGH** · sides **server**
> (**corrected: two-sided — see §10.1**) · convergence **mixed** ·
> dimensions: **security · resilience · function · code-quality**
> Composed 2026-08-16 against `master` @ `629a914af`.
>
> **Sweep.** `src-tauri/src/ipc_auth.rs` (1,214 lines) read in full, as were the `requires`
> proc-macro (`src-tauri/macros/src/lib.rs`), the whole startup path in `src-tauri/src/lib.rs`
> (`:555`–`:1260`, `:1823`), `src/lib/tauriInvoke.ts` (the client half), and the **vendored
> dependency sources that decide the outcome**: `tauri-2.11.2` (`src/manager/webview.rs`,
> `src/app.rs`, `src/webview/mod.rs`, `src/ipc/protocol.rs`, `src/ipc/mod.rs`,
> `scripts/{init,core,ipc,ipc-protocol,process-ipc-message-fn}.js`), `tauri-macros-2.6.2`
> (`src/command/wrapper.rs`), `tauri-runtime-wry-2.11.2`. **950** `.rs` files walked for the
> command census (`src-tauri/{src,engine/src,db/src,core/src}`); **564** for the §9 rule
> (`src-tauri/src`, the census engine's own `walked` count).
>
> **Measured by executing, not reading.**
> 1. **The init script was replayed in Node against the exact property descriptor that
>    `tauri-2.11.2/scripts/core.js:81` installs.** The monkey-patch — enforcement layer 4 of the 4
>    the module docstring names — **cannot install**, and the failure path it takes also prevents
>    its own retry loop from ever being scheduled. §0, finding 1.
> 2. **`JSON.stringify(new Headers({'x-ipc-token': …}))` was executed. It is `'{}'`.** One of
>    Tauri's two IPC transports serialises the options bag with `JSON.stringify`, so on that
>    transport the credential is not "raced" — it is **structurally absent**. §0, finding 2.
> 3. **The operator's app was running throughout** (pid 24636; 9420/17320/17400 listening) and
>    **six days of its own `tracing` file log** (`%APPDATA%/com.personas.desktop/logs/personas.2026-08-1{1..6}.log`,
>    21,629 lines, 34 boots) were read **read-only**. **14 IPC calls were rejected for a missing
>    or invalid session token**, 12 of them the same command. §0, finding 3. No command was
>    invoked, no state mutated, no auth bypass exercised, and `/eval` was not used.
> 4. Two independent implementations of every count (a line-oriented Rust walker and a
>    whole-file-content regex pass with no shared code), then a third — the census engine —
>    over the published pattern. All three agree; the disagreements they *did* surface are in
>    §10.
>
> **NEVER PRINT A SECRET.** No token value appears below. The token's *shape* (32 CSPRNG bytes →
> 64 lowercase hex chars, asserted by the repo's own test at `ipc_auth.rs:931-936`), its store,
> its lifetime and the count of calls that arrived without it are reported. No token was read
> from memory, from the running process, or from any log.
>
> **Adjacent paths, and what this one does NOT own.**
> [ipc-command-authorization] owns *which tier a command should carry*.
> [second-transport-exposure](./second-transport-exposure.md) owns *whether a second door should
> exist at all*. [ownership-verification](./ownership-verification.md) owns *whose row this is*.
> **This path owns the credential those three all assume: when it exists, how long its proof
> lasts, what happens to a call that arrives outside that window, and what a codebase does to
> itself when the answer is "intermittently, nothing".**
>
> The **Deviations** section is a fix backlog and contains **one P0 that is live on the operator's
> machine right now** (D1), **one always-fails-closed command** (D6), and nine repairs.

---

## 0. The headline, before anything else

**The brief asked what happens to a call that arrives before the token exists or after it rotates.
Measured: neither window exists. The token is minted at `lib.rs:582-583`, on the line before the
Tauri builder is finished and long before `tauri::app::setup()` creates the first webview
(`tauri-2.11.2/src/app.rs:2515-2517`, which runs *before* the app's own `.setup()` closure at
`:2523`). It is a `OnceLock` (`ipc_auth.rs:41`) whose `set` has exactly one call site and whose
double-init path `panic!`s. There is no rotation, no expiry, and no invalidation. So all three
"token not initialised — failing closed" branches in the tree are unreachable code:
`ipc_auth.rs:449-455`, `:549-557`, `:634-641`. Six days of the app's own log contain zero of
them.**

**The real window is not around the token. It is around the *proof that the token was checked*,
and that proof is torn down before most of the work it authorises begins.**

```rust
// ipc_auth.rs:656-660 — the entire lifetime of the validation evidence
set_ipc_validated(true);          // a THREAD-LOCAL (:80-85), on the invoke thread
let result = inner(invoke);       // for an ASYNC command this returns immediately —
set_ipc_validated(false);         // …so the flag is cleared BEFORE the body starts,
result                            //    and the body runs on a tokio worker anyway
```

`tauri-macros-2.6.2/src/command/wrapper.rs:378` wraps every `async fn` command in
`resolver.respond_async_serialized(async move { … })`, and `tauri-2.11.2/src/ipc/mod.rs:329`
implements that as `crate::async_runtime::spawn` on a **multi-thread** tokio runtime
(`async_runtime.rs:222-223`). A thread-local set on the invoke thread is invisible there, by
construction. That is why `require_privileged` (async) was written to check something else — and
the something else is the `OnceLock` above, which cannot be empty. **It is not "a debug log". It
is a guard whose failure condition is unreachable, and it is the only in-body authorization
statement on 86 commands.**

### The measured shape of the surface

| | n | note |
|---|---:|---|
| `#[tauri::command]` definitions (950 `.rs` files) | **1,657** (1,654 distinct names) | |
| registered in `generate_handler!` (`lib.rs:1823-3748`) | **1,585** | |
| gated by `is_privileged_command` — `PRIVILEGED_COMMANDS` 184 + `CLOUD_COMMANDS` 50 | **234** | 229 registered, **5 not** |
| registered and **not** gated | **1,356** | 85.6% — [second-transport-exposure](./second-transport-exposure.md) §0 |
| gated commands that are **sync** (thread-local flag is load-bearing) | **92** | |
| gated commands that are **async** (flag already cleared) | **142** | **61% of the gate** |
| `#[requires(…)]` annotations above a `pub fn` | **243** | 168 privileged · 56 cloud · 19 auth |
| ↳ whose guard **cannot return `Err`** (`auth` either way; `privileged` + async) | **105** (34 files) | **43%** — §9's rule |
| ↳ whose guard **can** (`privileged` + sync; `cloud` + async) | **138** (27 files) | §9's positive control |
| annotated `#[requires(privileged)]`, **async**, and on **neither list** | **17** | zero enforcement at either layer |
| entries **commented out** of `PRIVILEGED_COMMANDS` citing the WebView2 token race | **8** | §0 finding 4 |
| `require_auth` / `require_auth_sync` call sites | **1,253** | both `Ok(())` |
| production frontend files importing raw `invoke` (bypassing the token attacher) | **0** | 14 files total: 12 tests + the wrapper + the test bridge |

**105 + 138 = 243** — the two rules in §9 partition the annotation population exactly, with no
residue.

### Finding 1 — enforcement layer 4 of 4 cannot install, and the repo already knows

`ipc_auth.rs:25-27` names, as the fourth defence-in-depth layer, a script that
"monkey-patches `__TAURI_INTERNALS__.invoke` to attach the token as an `x-ipc-token` header on
every IPC call" (`generate_ipc_auth_script`, `:691-750`). **Replayed in Node against the exact
descriptor `tauri-2.11.2/scripts/core.js:81` installs:**

```
descriptor of __TAURI_INTERNALS__.invoke = {"writable":false,"configurable":false,"enumerable":false}
patchInvoke() returned      = true   (true => the retry interval is NEVER scheduled)
__ipc_patched               = undefined  (=> the patch did NOT install)
window.__IPC_TOKEN set      = <the dummy string the replay was handed; no real token was used>
raw invoke -> options seen  = undefined  (=> NO x-ipc-token header)
```

The script runs under `'use strict'` (`:701`), so the assignment at `:712` throws `TypeError`
(non-writable); the `Object.defineProperty` fallback at `:720` throws too (non-configurable); the
outer `catch` at `:734` returns `true` — which the caller at `:738` reads as *success*, so the
"200 tries × 10 ms" retry loop the comment describes (`:740-745`) is never even started.
`window.__TAURI_INTERNALS__.__ipc_patched` is never set. **The script's only surviving effect is
its first statement, `window.__IPC_TOKEN = _t` (`:703`).**

**The repo established this same fact 91 days ago, in another file, and did not carry it back.**
`src/test/automation/perfInstrument.ts:12-14`:

> *"(Tauri 2 makes `window.__TAURI_INTERNALS__.invoke` **non-configurable**, so monkey-patching at
> that layer fails — see commit history for the rejected attempt.)"*

That comment landed in `36acf8b17` on **2026-05-17**. On **the same day**, `d65592034` touched
`ipc_auth.rs`'s WebView2-race comment block. One module concluded the patch is impossible; the
other kept citing the patch's *timing* as the reason to remove commands from the gate. Both are
still on `master`.

### Finding 2 — the credential rides in a `Headers` object, and one of the two transports cannot carry one

`tauri-2.11.2/scripts/ipc-protocol.js` has two paths:

| path | how options travel | does `x-ipc-token` survive? |
|---|---|---|
| custom protocol (`:31`, the normal Windows path) | `new Headers((options && options.headers) \|\| {})` then `fetch(…, {headers})` | **yes** — `new Headers(h)` copies |
| `postMessage` fallback (`:70-84`) | `processIpcMessage({… options …})` → **`JSON.stringify`** (`process-ipc-message-fn.js:18`) | **no** |

Executed:

```
JSON.stringify(new Headers({'x-ipc-token':'AAA'})) === '{}'
Object.keys(new Headers({'x-ipc-token':'AAA'}))    === []
{...new Headers({'x-ipc-token':'AAA'})}            === {}
new Headers(new Headers({'x-ipc-token':'AAA'})).get('x-ipc-token') === 'AAA'
```

Both of this repo's attachers hand Tauri a **`Headers` instance** — the dead monkey-patch
(`ipc_auth.rs:714-717`, `:722-726`) and the live one (`tauriInvoke.ts:464-466`). On the fallback
transport both serialise to `{}` and the backend's `invoke.message.headers().get("x-ipc-token")`
(`ipc_auth.rs:627`) is `None` → `reject`.

Three properties make this worse than a race:

- **`customProtocolIpcFailed` is a one-way latch** (`ipc-protocol.js:17`, set at `:66`, never
  reset) — a single `fetch` failure downgrades the transport for the **rest of the page's life**.
- **The first casualty is the message being retried.** On failure the handler calls
  `sendIpcMessage(message)` again (`:67`) with the same `options` — now down the path that drops
  it. The very act of falling back un-authenticates the call.
- **The client's own recovery cannot help.** `tauriInvoke.ts:524-532` re-reads
  `window.__IPC_TOKEN` (which was never missing), waits 50 ms, and re-sends **down the same
  channel**.

And the app's CSP does not name the IPC origin. `tauri.conf.json` `connect-src` lists
`'self' asset: http://asset.localhost https://asset.localhost …` — the sibling custom scheme is
enumerated, `ipc:` / `http://ipc.localhost` is not, in **both** `csp` and `devCsp`. Tauri does not
inject it (its own doc example, `tauri-utils-2.9.2/src/config.rs:2741`, writes it by hand:
`connect-src ipc: http://ipc.localhost`). See §7 D4 for why this is a *release-build* hazard that
dev cannot reproduce, and for the honest bound on that claim.

### Finding 3 — what actually happens, from six days of the operator's own log

34 boots, 21,629 lines, **2026-08-11 → 2026-08-16**:

| log phrase | source | count |
|---|---|---:|
| `Rejected IPC call: invalid or missing session token` | `ipc_auth.rs:645` (wrapper) | **14** |
| `IPC session token not initialised` | `:451`, `:552`, `:636` | **0** |
| `Privileged sync command called without IPC validation flag` | `:459-462` | **0** |
| `IPC session token initialised` | `lib.rs:585` | **0** — see D10 |
| `IPC custom protocol failed…` (Tauri's own console warning) | `ipc-protocol.js:61` | **0** |

**The 14, by command:** `get_rotation_status` ×12, `get_all_rotation_statuses` ×1,
`list_pending_pairings` ×1. All three are `get_`/`list_`-prefixed **privileged reads** on the
vault surface, all reached through `invokeWithTimeout` (`src/api/vault/rotation.ts:42-47`,
`src/api/auth/pairing.ts:8`) — so a `Headers` object was constructed for every one of them.

**None of the 14 is at process start.** Distance from the preceding boot: minimum **2,676 s**,
median ≈ 18,000 s, maximum **57,477 s**. But they *are* at **page** start — this is a dev build
where Vite reloads the page many times per process:

```
2026-08-14 11:27:04.547  WARN Rejected IPC call … command=get_all_rotation_statuses
2026-08-14 11:27:04.549  INFO Cloud IPC command accessed command="gitlab_get_config"   ← 2 ms later, SAME gate, PASSED
2026-08-14 11:27:12.85   INFO Frontend time-to-interactive reported tti_ms=8183.9      ← the page had just started
```

Two facts fall out of that trace and they constrain the mechanism:

1. **The very next gated call succeeded 2 ms later**, so the transport latch was *not* set. The
   loss is **per-call inside a page-init burst**, not per-page.
2. `ipc_auth.rs:244-250` predicted exactly this shape — *"the renderer batches several privileged
   invokes during page initialisation"* — and then attributed it to a monkey-patch that finding 1
   proves never ran.

The other sample is sharper still: the 2026-08-16 01:15:16 rejection is followed immediately by
`[WATCHDOG] FREEZE DETECTED — main thread unresponsive for 7125930ms`. **The condition correlates
with the renderer being under duress, not with the token being young.**

**What the log cannot tell us, stated as a limit rather than glossed:** the wrapper logs *that*
the header was absent, never *which transport the call arrived on* — even though Tauri deserialises
exactly that bit (`custom_protocol_ipc_blocked`, `ipc/protocol.rs:229-230`, set by
`ipc-protocol.js:78`) and then **drops it before `InvokeRequest` is built**. One `debug!` of
`invoke.message.headers().len()` at `ipc_auth.rs:644` would have closed this in an afternoon
(§7 D11).

### Finding 4 — the race's real cost is 8 commands that were traded out of the gate to make it stop

`PRIVILEGED_COMMANDS` carries **8 commented-out entries**, each with a prose citation of the
WebView2 token race:

| commented-out | what it does | its `#[requires(privileged)]` |
|---|---|---|
| `export_credentials` (`data_portability.rs:9555`) | *"Export **all** credential secrets to a password-protected encrypted file"* | async → inert |
| `import_credentials` (`:9669`) | writes the vault from a file | async → inert |
| `export_full` (`:1799`) / `import_portability_bundle` (`:1949`) | whole-database portability | async → inert |
| `execute_api_request` (`api_proxy.rs:36`) | outbound HTTP with a **decrypted vault credential**, caller-chosen method/path/headers/body | async → inert |
| `get_api_proxy_metrics` (`:61`) · `save_api_definition` (`:89`) | proxy surface | async → inert |
| `discover_connector_resources` (`discovery.rs:17`) | — | **listed at `:145` anyway; the comment at `:263-269` is stale** (§7 D5) |

Plus `import_portability_bundle_from_path` (`data_portability.rs:2193`), which is not even
commented out — it is simply absent, and carries the same inert annotation.

**So the vault's bulk export/import and the credential-bearing HTTP proxy have exactly one
authorization statement each, and it is a function that cannot return `Err`.** The wrapper was
removed deliberately, with a written reason; the body guard was *believed* to be the compensating
control (`ipc_auth.rs:247-250`: *"Their command bodies call `require_privileged` (async) which
still verifies the IPC security system is initialised and emits an audit trace, so this is
defense-in-depth at the inner layer instead of the wrapper"*). It verifies a `OnceLock` that was
filled before the window existed. It is defence-in-depth against nothing.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, so an adopting repo can tell physics from local calibration.

> **P1 — physics.** *A credential's existence and the proof that it was checked are two different
> lifetimes, and the second is the one that gets short.* Teams reason hard about minting the
> credential early enough and almost never about how long the **verdict** survives. Write both
> lifetimes down at the gate.
>
> **P2 — physics, and the clause that costs the most.** **Never store an authorization verdict in
> ambient context — a thread-local, a request-scoped global, a continuation-local — when the work
> it authorises can outlive that context.** Concurrency runtimes migrate work off the thread that
> received it; the ambient value is then absent, the guard reading it either fails-closed on
> everything or is rewritten to check something weaker, and the second outcome is the one that
> ships because the first is loud. **Put the verdict in the value the handler receives.**
>
> **P3 — physics.** *A guard whose failure condition is established before the process serves its
> first request is not a guard.* If the only thing a check asserts is an invariant of startup, it
> can never return an error, and every caller that reads it as authorization is wrong. Prefer a
> guard whose evidence is *per-request* or at minimum *mutable state the request can disagree
> with*.
>
> **P4 — physics.** **Order beats polling.** Establish the credential before the client context
> can exist, so "not minted yet" is unrepresentable. A client that polls for a credential is
> compensating for an ordering nobody guaranteed — and the poll's give-up branch is usually
> "proceed without it".
>
> **P5 — physics, and the one this leaf was written to catch.** **A credential must ride in a
> field whose serialisation is guaranteed across every transport the call can take.** Structured
> objects with no enumerable own properties — header bags, maps, sets, class instances — vanish
> under generic serialisation, and the failure is *silent, total, and looks exactly like a race*.
> Round-trip the credential through every transport in a test, not in your head.
>
> **P6 — physics.** **A transport that degrades must degrade to refusal, never to the same request
> minus its credential.** A fallback that re-sends is the moment the credential is lost, so the
> failure is attributed to the *original* call and the fallback looks innocent. And a client retry
> keyed on the auth failure must not re-send down the channel that dropped it.
>
> **P7 — ergonomics, and the most expensive one in practice.** **When a transport defect makes a
> gate flaky, fix the transport — never take the operation out of the gate.** The flake is
> transient and loud; the exemption is permanent and silent, and it will be justified by a comment
> naming a mechanism nobody re-measures. Exemptions granted for reliability outlive the bug by
> years.
>
> **P8 — ergonomics.** **A tier annotation must be capable of failing.** An annotation whose guard
> is a no-op is worse than no annotation, because reviewers, tests and dashboards all read it as
> enforcement. Delete it, or give it teeth.
>
> **P9 — security.** *A process-lifetime credential injected into a client context goes into every
> client context that process will ever create* — including ones pointed at somebody else's
> origin. The injection site is where the blast radius is decided and it is usually a single line
> with no mention of scope.
>
> **P10 — ergonomics.** **Instrument the credential's lifecycle where the instrument can see it.**
> A mint that logs before logging is installed, and a rejection that records the outcome but not
> the transport, together produce a defect that survives five months of daily use.
>
> **Scale condition.** P2, P3, P5 and P6 are correctness on day one. P4 and P8 bite the first time
> somebody adds a second tier. P7 bites the first time the gate is flaky — which is the first
> week. P9 bites the first time you open a second window. P10 bites when you finally try to
> measure any of it.

### Convergence — five sibling repos, censused independently

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** Six questions were put to each: does the
process mint a credential for itself at startup; does the client get it by ordering or by polling;
is there a guard that cannot fail; is the protected set a hand-maintained list or derived; is the
credential on a client-readable global; and does the client retry on auth failure.

| | personas-web | brainiac | personas-cloud | vibeman | ascent |
|---|---|---|---|---|---|
| startup self-mint | no | no | **yes** | no | no |
| ordering / polling | ordering (**throws**) | ordering | ordering | n/a | ordering |
| guard that can't fail | no | **yes** | no | **yes** | no |
| list vs derived | n/a | **3 lists** | derived | opt-in, 0 adopters | per-handler, drifted |
| client-readable global | **yes** | no | no | **yes** | no |
| retry on auth failure | unkeyable | no | **unbounded** | **no — terminal** | bounded, miskeyed |

- **P4 (order beats polling) — PHYSICS, and the vote is unanimous the other way: 0 of 5 poll for a
  credential.** Every sibling that ships one establishes it by ordering. The sharpest is
  `personas-cloud` `worker/src/connection.ts:151-167`: the token goes in the **first frame after
  `open`** (deliberately in `hello`, not the URL), and the *server* bounds the window rather than
  the client — 10 s hello timeout → `ws.close(1008, 'Hello timeout')` (`workerPool.ts:124-129`).
  The one to copy for this leaf is `personas-web` `src/lib/api.ts:66-74`, which **throws** if the
  auth store is not initialised instead of awaiting it: *assert the ordering, do not wait for it.*
  **Personas is the only repo of six that both closed the window and then polled for it anyway**
  (`tauriInvoke.ts:103-111`), and its poll's give-up branch proceeds **without** the credential.
- **P3 (a guard that cannot fail) — CONVERGENT AS A DEFECT, 3 of 6 including this repo, and the
  sharpest instance is not Personas'.** `vibeman` `accessControl.ts:74-86` hardcodes
  `role: AccessRole = 'admin'`, overridable only *downward* and only in dev, so `hasMinimumRole`
  is always true and the 403 branches at `:207-217` and `:267-272` are unreachable in production —
  and its neighbour `verifyProjectExists` (`:96-107`) fails **open** from its `catch`, commented
  *"If project DB isn't available yet (during startup), allow through"*. `brainiac`
  `auth.rs:131-136` is the closest analogue to Personas': `AuthContext::allows` returns `true`
  unconditionally when `scopes == None`, and `None` is exactly the env-bootstrap branch
  (`auth.rs:166`) — reached from **54** `auth_of(…)` sites plus **21** `principal_of(…)`.
  **All three variants are an `if` (or a `match`) over a value that can only take one branch.**
  A term missing from a check is visible in a diff; a check that is always `Ok` is not. (This is
  [ownership-verification](./ownership-verification.md)'s "most transferable finding" arrived at
  from the other side, and it replicates.)
- **P2 (verdict in ambient context) — PARTIALLY TESTED, and I will not claim silence.** Three
  siblings visibly return the verdict **as a value into the handler** — `brainiac`'s
  `auth_of(&headers)` (`http.rs:186`), `personas-cloud`'s route table (below), `personas-web`'s
  inline per-request check — which is the compliant shape. But no repo was searched for a
  thread-local / `AsyncLocalStorage` / continuation-local equivalent, so **"nobody does the wrong
  thing" is not established.** What *is* established is that Personas is the only one of the six
  that had no request-scoped slot available to it (§8.1), and that the shape it fell back to is
  the shape that broke.
- **P8's cousin — the list's DEFAULT — is convergent as a SOLVED problem, and the fix is written
  in a sibling.** `brainiac` `mcp.rs:232-250` has exactly the hand-maintained name→scope table this
  leaf is about (16 tools, which must stay in sync with a separate dispatch `match` at `:725`) —
  and its default arm is **`_ => "admin"`** (`:248`), with the comment *"so a future tool cannot
  slip in ungated by accident."* **Personas' unlisted default is `AuthTier::Public`**
  (`ipc_auth.rs:835-843`, the `else` arm), so its 1,356 unlisted commands fail *open* by the same design decision
  taken the other way. `brainiac` also narrates the exact drift this leaf produces, at
  `auth.rs:86-96`: a scope vocabulary that fell behind the endpoints enforcing it, so scoped keys
  got 403 everywhere and only `admin` worked. The counter-model for "derived, not listed" is
  `personas-cloud` `httpApi.ts:392-469` — an `AuthRoute[]` table where auth is a **property of the
  entry**, resolved by `findRoute`, so everything in it is authenticated by construction.
- **P8 itself (an annotation that cannot fail) — NO TRACE. Personas is the only repo of six with a
  tier-annotation vocabulary at all**, which is why it is also the only one that can have inert
  ones. Mark as a **house convention with a strong argument**, not doctrine.
- **P6 (degrade to refusal, never to the same request minus its credential) — CONVERGENT AS A
  DEFECT, and `vibeman` supplies a worked example better than this repo's.**
  `vibeman/src/lib/tauri/bridge.ts:39-60` `hybridFetch` wraps the Tauri invoke in `try/catch` and,
  on **any** error, falls through to a plain `fetch(apiPath)` against the Next.js route. **A Rust
  authorization refusal is therefore indistinguishable from "Tauri is missing" and is silently
  downgraded to an unauthenticated HTTP request** — landing on the handler where, per P3 above,
  `resolveAccessContext` grants it `admin`. That is precisely the shape of
  `ipc-protocol.js:66-67`'s re-send, one layer up and with a worse destination. (For the record:
  `bridge.ts` attaches **no** credential to any invoke, and the single repo-wide occurrence of
  `__TAURI_INTERNALS__` is a read-only presence probe at `:11` — nobody else is patching it either.)
- **P5 (credential in a non-serialising field) — NO TRACE anywhere. House-specific, and it is a
  *dependency-shape* hazard rather than a taste.** No sibling passes a credential through an
  options bag that two different transports serialise differently, because no sibling has two IPC
  transports. Retained in §2 on mechanism, not on vote: an adopting repo should read P5 as "check
  what your framework does to your credential container", and the mechanism —
  `JSON.stringify(new Headers(...)) === '{}'` — is a Web platform fact, not a Personas fact.
- **The retry clause (D7) — CONVERGENT, 3 of 5, and two of the three key on a STRING.**
  `vibeman` `retryStrategy.ts:85-93` is the fleet's best answer — auth errors are classified
  `{ retryable: false }` and never retried — **and it keys on `message.includes('401')`**, exactly
  like Personas' `isIpcAuthFailure` substring test, with a default arm at `:106` that retries any
  unrecognised error under 200 characters. `ascent` keys on a bare status code and puts **403** in
  `TRANSIENT_STATUS` (`auth.ts:519`) while the file next door excludes it from `RETRYABLE_STATUS`
  (`github/checks.ts:19`) — two sets in one repo that disagree about whether a 403 is transient.
  `personas-cloud` `connection.ts:188-203` special-cases exactly one close code and reconnects on
  everything else, so **an invalid `WORKER_TOKEN` reconnects forever** at one auth-failed `hello`
  per 30 s. **Nobody in six codebases keys an auth-retry decision on a machine token**, which is
  D7's fix and it has no precedent to point at.
- **P9 (a process-lifetime credential in every client context) — CONVERGENT, 2 of 5, and the
  counter-example is the one to copy.** `personas-web` `src/lib/api.ts:89-92` sends
  `NEXT_PUBLIC_TEAM_API_KEY` from the browser (its own `README.md:46` lists it as `public`);
  `vibeman` keeps provider API keys in `localStorage['llm_api_keys']` (`llm-storage.ts:39`).
  **`brainiac` is the counter-example and it argued the case in writing**: the privileged token is
  server-only (no `NEXT_PUBLIC_` prefix, `console/src/lib/api.ts:78`), the cookie is httpOnly and
  carries a *digest* rather than the passcode (`console/src/lib/auth.ts:26-27`), and
  `auth.ts:30-47` records **refusing** a request to put the passcode in `localStorage` on exactly
  these grounds.
- **Expiry — 4 of 5 have none on their long-lived credential, and the single hard bound in five
  repos is `ascent`'s `MAX_TTL_MS = 30 days`** (`src/lib/live-share.ts:39`). `brainiac`'s console
  session is 400 days (`auth.ts:56`) with a rotation *lever* (`CONSOLE_SESSION_SECRET`);
  `personas-cloud` runs a static `WORKER_TOKEN`; `personas-web` a build-time env var. Personas'
  `OnceLock` with no rotation is the family norm, not an outlier — which is why §2(e) says *treat
  it as process-lifetime and keep it out of contexts you do not own* rather than *add rotation*.
- **P1 — the strongest negative in the sweep, and it is a mirror.** `personas-cloud`
  `workerPool.ts:350` mints a per-registration `sessionToken` (`randomBytes(32).toString('hex')` —
  byte-for-byte Personas' shape) and ships it in the `ack`. It is **never stored, never read,
  never verified**: those two lines are the only occurrences of `sessionToken` in the entire
  `packages/` tree, and the credential that actually authenticates is the static env
  `WORKER_TOKEN`. **A minted, well-shaped, transported credential that authorises nothing — the
  same outcome as this leaf's guard, reached from the opposite direction.**
- **P10 (lifecycle invisible to its own instrument) — NOT TESTED, and must be reported as such.**
  The oracle measured credentials, guards and retries; no sibling's logging-initialisation order
  was examined. The clause rests entirely on this repo's evidence — 0 of 34 boots recording the
  mint — plus two prior instances of the same shape inside this repo (`CLAUDE.md`'s note on file
  logging installed after the migrations it was meant to record). **Do not cite it as convergent.**

> **The transferable sentence, and it is not a count.** Across six codebases the recurring failure
> is a **guard that reads as enforcement and evaluates to a constant** — `role = 'admin'`,
> `return true`, `Ok(())`, or (the hardest to see, and Personas' contribution) *an `if` over a
> value that cannot take the other branch*. The second sentence is the one this leaf adds: **the
> constant is almost never the author's intent — it is what a guard degenerates into when the
> evidence it was written to inspect stops being reachable from where it runs.** `brainiac`'s
> `scopes == None`, `vibeman`'s dev-only role override, and Personas'
> `IPC_SESSION_TOKEN.get().is_none()` are all a second draft, written after the first one could not
> see what it needed.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "the frontend needs to send the session token" · "attach the auth header on every call"
- "why does this command work sometimes and reject other times" · "it's a race on cold start"
- "wait until the token is ready before calling" · "retry once and it'll go through"
- "just take it off the privileged list, it's flaky" · "the wrapper check is unreliable here"
- "add `#[requires(privileged)]` and we're done"
- **If you are about to write `thread_local!`, `set_*_validated(`, `OnceLock<String>` for a
  credential, `js_init_script(`, `new Headers(` around a credential, or a `setInterval` that waits
  for a credential to appear — you are in this situation.**
- **If you are about to add a name to `PRIVILEGED_COMMANDS` — or, much more importantly, to
  *comment one out* — you are in this situation and §0 finding 4 is about you.**

**Not this path:** *which tier a command deserves* is [ipc-command-authorization]; *whether a
second transport should carry the behaviour* is
[second-transport-exposure](./second-transport-exposure.md); *whether the caller owns the row* is
[ownership-verification](./ownership-verification.md); *where the credential lives at rest* is
[secret-display-and-transfer](./secret-display-and-transfer.md); *compiling a surface in or out* is
[feature-flagged-compilation](./feature-flagged-compilation.md).

---

## 2. The one way

**Mint the credential before the client context can exist — not before the first call — so
"not yet minted" is unrepresentable rather than polled for; then make the *verdict* travel in the
value the handler receives, never in ambient context, because the runtime will move the work off
the thread that took the decision and the verdict will be gone before the work starts.** Concretely
and in order: **(a)** put the mint above the builder, on the same straight line of code, and say in
a comment that it precedes window creation, so nobody adds a retry loop for a window that is
already closed; **(b)** if the framework gives you no per-request slot for the verdict, do not fall
back to a thread-local — fall back to **shared state the request can disagree with**, the way
`require_cloud_auth` (`ipc_auth.rs:566`) reads `state.auth` and can therefore genuinely refuse,
and if you cannot do even that, **delete the inner guard and say the wrapper is the only gate**
rather than leaving a function that returns `Ok(())` where reviewers read enforcement; **(c)** put
the credential in a **plain, JSON-serialisable field** — a `Record<string,string>`, never a
`Headers`/`Map`/class instance — and assert it round-trips on *every* transport your framework may
choose, because a container with no enumerable own properties serialises to `{}` and the loss is
silent; **(d)** make transport degradation degrade to **refusal**: if the credential could not be
attached, fail the call locally rather than sending it credential-free, and never let a client
retry re-send down the channel that dropped it; **(e)** treat the token as **process-lifetime and
un-rotatable** unless you build invalidation — and if it is, keep it out of every client context
you do not own, which means auditing your init-script injection against every window your app can
open, not just the main one; **(f)** **never remove an operation from the gate to fix a transport
bug** — the exemption is permanent and the bug is not, and the comment you write to justify it will
outlive the mechanism it names by years; **(g)** log the mint where the file sink can already see
it, and log on rejection **which transport the call arrived on**, because "the header was absent"
and "the header could not have been present" are different bugs with the same log line. If you
must get one right first: **(b)**. (c), (d) and (f) all leave a trace someone can find; (b) leaves
a guard that looks like it is working, on 105 call sites, for five months.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`src-tauri/src/ipc_auth.rs:566` — `require_cloud_auth(state, command)`** | **The one guard to copy, and the only one in this file that can refuse.** Its evidence is `state.auth` — shared state, reachable from any thread, disagreeable by the request — so it survives `async_runtime::spawn` intact and returns a real `Err` for the offline case *and* the never-signed-in case, with different messages (`:572-587`). Its sync twin (`:484`) additionally fails closed on a poisoned lock (`:520-528`). **Every clause §2(b) asks for is already implemented here, 20 lines below the guard that isn't.** |
| **`src-tauri/src/ipc_auth.rs:617` — `wrap_invoke_handler`** | The only enforcement that actually runs. Extracts `x-ipc-token`, compares constant-time, sets the flag, dispatches, clears. Read `:661-662` before reasoning about tiers: **an unlisted command is dispatched with no validation at all.** |
| **`src-tauri/src/ipc_auth.rs:668` — `constant_time_eq`** | Length-check then XOR-fold. Correct, unit-tested (`:922-929`), and the only one of the repo's three token comparisons that is both constant-time and covered — `companion/orchestration/mcp/mod.rs:106` uses `HashMap::get`. |
| **`src-tauri/src/ipc_auth.rs:54` — `generate_ipc_session_token`** + **`src/lib.rs:582-584`** | 32 CSPRNG bytes → 64 hex, asserted at `:931-936`. The **ordering** is the primitive: mint → `init_session_token` → build the init script, all before `final_builder.setup(…)`, and therefore before `tauri-2.11.2/src/app.rs:2517` creates the first window. Copy this shape; do not copy the client-side poll it made redundant. |
| **`src/lib/tauriInvoke.ts:463-466` + `eslint.config.js:74-81`** | The credential attacher and the chokepoint that makes it the *only* one. `no-restricted-imports` at **`"error"`** on `invoke` from `@tauri-apps/api/core`. **Measured: 0 production files bypass it** (14 importers total — 12 tests, the wrapper itself, and the test-automation bridge). This rule is why finding 1 is survivable, and it is the strongest control in this document. |
| **`src-tauri/src/ipc_auth.rs:1033` — `all_sync_requires_privileged_commands_are_registered`** | The registry-drift test for sync commands, and a model instrument: it asserts `checked > 50` **before** it asserts the result (`:1039-1044`), so a broken source walk fails loudly instead of reporting perfect compliance. Measured today: 0 violations, and the condition it guards is real (a sync `#[requires(privileged)]` missing from the list fails closed on every call). |
| **`src-tauri/src/ipc_auth.rs:1155` — `every_requires_annotation_is_listed_or_baselined`** | The async half, with a shrink-only `DRIFT_BASELINE` (`:1076-1111`) whose entries carry prose reasons. Also asserts its instrument (`found.len() > 150`, `:1164-1169`). **This is the right design and it is doing real work** — it is simply blind to the question this path asks, because being *listed* and being *enforceable* are different (§8.3). |
| **`src-tauri/macros/src/lib.rs:57` — `#[requires(tier)]`** | Auto-derives the command name from the fn (`:63-64`) so the guard's string can never drift from the handler, and **refuses `#[requires(cloud)]` on a sync fn with a compile error** (`:83-90`). The sync/async dispatch table at `:67-82` is the single place that decides which guard each annotation becomes — and therefore the single place a fix for §7 D2 belongs. |
| **`personas_core::ipc_gauge`** (re-exported `ipc_auth.rs:44`, guarded `:61-74`) | RAII in-flight counter around every invoke, used by `db` to find a quiet maintenance window. Correct use of the wrapper as a chokepoint for a cross-cutting concern; the model for D11's transport counter. |

**Do NOT exist — this path names them:**

- **A per-request slot for the verdict.** Tauri's `Invoke` carries `message`, `resolver` and `acl`;
  nothing the app can write to reaches the command body. This is the root of §7 D2 and the whole
  reason `require_privileged` degenerated. §8.1.
- **Any rotation, expiry or invalidation.** `OnceLock` + `panic!` on double-init (`:47-51`). If the
  token is ever disclosed, the only remedy is restarting the app.
- **Any per-webview scoping of the init script.** `js_init_script` is global to the process
  (`tauri-2.11.2/src/manager/webview.rs:202` extends every webview's script list unconditionally).
- **Any telemetry on rejection.** A `tracing::warn!` and nothing else — no Sentry event, no
  `ipcMetrics` category, no audit row. Six days of the condition produced 14 log lines and zero
  signals anywhere a human looks.
- **Any assertion that the credential survives the transport.** No test constructs the options bag
  and round-trips it.

---

## 4. Steps

1. **Mint before the surface exists, and write the ordering down.** One straight line, above the
   builder, with a comment naming the window-creation call it precedes. Then **do not add a
   client-side wait** — if you find yourself writing one, the ordering is wrong and the wait is
   hiding it.
2. **Decide where the verdict lives, before you write the guard.** In order of preference:
   the value the handler receives → shared state the request can disagree with (`state.auth`) →
   nothing at all, stated as such. **Ambient context is not on the list.** If your runtime can
   move the work, ambient context is already gone.
3. **Write the guard so that it can fail, and prove it can.** A guard whose only failure condition
   is a startup invariant is a comment. If the honest answer is that no in-body check is possible,
   **delete the annotation** rather than shipping one that reviewers will read as enforcement.
4. **Put the credential in a plain serialisable field and round-trip it.** For each transport your
   framework may choose, assert the credential arrives. `JSON.stringify(new Headers(…)) === '{}'`
   is one line of test and it would have ended this.
5. **Make degradation refuse.** If the credential cannot be attached, fail locally. If your
   framework's fallback re-sends the original message, that re-send is where the credential dies —
   check it explicitly.
6. **Ask the type question now, before §9.** The answer for this leaf is below and it is a
   qualified *yes* on one half and a measured *no* on the other.
7. **Instrument both ends.** Log the mint after the file sink is installed; on rejection log the
   transport, not only the outcome. Then **read the log** — this document's finding 3 is six days
   of `grep`.
8. **If the gate is flaky, fix the transport.** Adding an exemption is a decision to ungate an
   operation permanently; make it a reviewed change with a named owner and an expiry, not a
   comment in a list.
9. **And then stop.** Which tier the command deserves belongs to [ipc-command-authorization];
   whether the operation should be on a second transport belongs to
   [second-transport-exposure](./second-transport-exposure.md); whether the caller owns the row
   belongs to [ownership-verification](./ownership-verification.md).

### Can the type make the wrong call impossible? — asked before §9

**Half of it, yes, and the measured reach is unusually good; the other half, no, and the honest
reason is that the type would have to live in a dependency.**

**The half a type reaches — the guard's return type.** The defect is that
`require_privileged(&state, cmd) -> Result<(), AppError>` is a signature that *promises* it can
refuse and a body that cannot. Make the macro's dispatch table (`macros/src/lib.rs:67-82`) emit,
for `("privileged", true)`, either a guard that takes evidence it can actually inspect or **no
statement at all**. Concretely:

```rust
// ipc_auth.rs — withhold the un-refusable door instead of documenting it
pub struct Validated(());                     // constructible ONLY by wrap_invoke_handler
pub fn require_privileged_sync(state: &Arc<AppState>, cmd: &str) -> Result<Validated, AppError>;
// and DELETE `require_privileged` (async) — there is nothing for it to check.
```

Held against the doctrine's seven qualifications:

- **Q3 (a type nobody constructs constrains nothing):** the construction sites are enumerable —
  **82** sync-privileged annotations, all already listed and all already working. Passes.
- **Q4 (a type anyone can construct authenticates nothing):** `Validated(())` with a private field
  in `ipc_auth` cannot be built by a command module. Passes — and this is exactly the shape
  `ownership-verification` §4 could *not* reach, because its comparand comes off the wire whereas
  this one comes from a check the process itself performed.
- **Q5 (withholding beats requiring):** the win is **deleting `require_privileged`**, not adding
  anything. 86 call sites lose a statement that authorises nothing, and the 17 commands that today
  *look* gated by it become visibly ungated in the diff — which is the entire point.
- **Q1 (a required prop carries only what it encodes):** `Validated` encodes *the wrapper ran and
  the header matched*. It does **not** encode which command, which caller, or which webview. So it
  fixes the async lie and does nothing for §7 D8. Stated, not hidden.

**The half no type reaches — the transport.** Nothing expressible in this repo prevents
`options.headers` from being a container that `JSON.stringify` empties, because the serialisation
happens in `tauri-2.11.2/scripts/process-ipc-message-fn.js`, in a string of JavaScript compiled
into a dependency and executed in a webview. **This is the doctrine's third "where types cannot
reach" — a value that never crosses a parameter you own.** The only instruments that reach it are
a round-trip test (§9's second mechanism) and a runtime assertion on the backend.

**So: ship the type as the fix for the guard, and the count as the ratchet on the annotations that
still claim a tier the guard cannot deliver.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **An authorization verdict in a thread-local** | The runtime moves the work. `set_ipc_validated(true) … inner(invoke) … set_ipc_validated(false)` (`ipc_auth.rs:657-659`) has already cleared the flag before an async body starts, and the body runs on a tokio worker anyway (`ipc/mod.rs:329`). **142 of the 234 gated commands are async.** |
| **A guard that checks a startup invariant** | `require_privileged` (`:547-562`) fails only if `IPC_SESSION_TOKEN` is empty — impossible after `lib.rs:583`. Provable, and proven: **0 occurrences in 6 days of log.** It is the sole in-body authorization on **86** commands and the *only* authorization on **17**. |
| **A tier annotation whose guard is a no-op** | `#[requires(auth)]` → `Ok(())` (`:477-479`, `:537-539`). 19 sites, including the entire persona CRUD surface (`commands/core/personas.rs`, 19 annotations: `create_persona`, `update_persona`, `bulk_delete_personas`, `archive_persona`…). The annotation is what makes it *look* considered. |
| **A credential in a container with no enumerable own properties** | `new Headers(...)` → `JSON.stringify` → `{}`. Executed. Both attachers in this repo do it (`ipc_auth.rs:714`, `tauriInvoke.ts:464`). |
| **A fallback transport that re-sends the original message** | `ipc-protocol.js:66-67` sets the latch and immediately re-sends — the re-send is where the credential is lost, so the *first* call takes the blame and the fallback looks innocent. |
| **A client retry that re-reads a value that was never missing** | `tauriInvoke.ts:524-532` re-reads `window.__IPC_TOKEN` (present since document-start), waits 50 ms, and re-sends. It works, but by accident — it survives only because the loss is per-call. |
| **A retry predicate that string-matches another crate's message** | `isIpcAuthFailure` (`:544-555`) tests for `"IPC authentication failed"`. The wrapper says exactly that (`:650`); `require_privileged_sync` says *"IPC authentication required for this operation."* (`:464`) and the init guards say *"IPC security system not initialised."* (`:454`, `:555`). **Two of the three producers are unreachable by the recovery**, and nothing links the literal to its source. |
| **Polling for a credential that ordering already guaranteed** | `waitForIpcToken` (`:89-113`): 100 × 20 ms. The token is set by an init script that runs before page JS, so the poll can never wait — while the condition that *does* occur is invisible to it. Its give-up branch proceeds **without** the credential (`:454`, `:465`). |
| **Removing a command from the gate to fix a transport flake** | 8 commented-out entries + 1 never-added, including whole-vault export/import and the credential-bearing HTTP proxy. Permanent, silent, and justified by a mechanism that finding 1 shows never ran. |
| **Documenting an enforcement layer without asserting it installed** | `ipc_auth.rs:14-27` lists 4 layers; layer 4 cannot install and layer 2 cannot fail for async. **Half the documented defence-in-depth is inert, and the docstring is the only place a reader would learn otherwise.** |
| **Injecting the credential with a process-global init script** | `js_init_script` reaches **every** webview (`manager/webview.rs:202`, `tauri-runtime-wry/src/lib.rs:5172`), including `WebviewUrl::External` popups (`commands/infrastructure/auth.rs:447`, `:574`). |
| **Logging the credential's lifecycle before the log exists** | `tracing::info!("IPC session token initialised…")` at `lib.rs:585`; `logging::add_file_layer` at `lib.rs:664`. **0 of 34 boots recorded it.** |

---

## 6. Evidence

### The one site to copy: `src-tauri/src/ipc_auth.rs:566-601` — `require_cloud_auth`

It sits twenty lines below `require_privileged` in the same file, was written by the same authors
for the same threat model, and gets the one thing this leaf is about right:

- **Its evidence is shared state, not ambient context.** `state.auth.read().await` — reachable from
  any tokio worker, so the guard means the same thing on the invoke thread and off it. This is why
  it is the only `#[requires(...)]` tier whose async form can refuse, and it is the reason §9's
  positive control contains all 56 of its sites.
- **It can return `Err` on two genuinely different conditions**, and says which:
  offline-with-a-cached-profile (`:573-582`) vs never-signed-in (`:583-586`). Compare
  `require_privileged`'s single unreachable branch.
- **Its sync twin fails closed on lock poisoning** (`:520-528`) rather than assuming success — the
  one place in this file where an infrastructure failure is treated as a denial.
- **It logs the identity it authorised** (`:589-598`, `user_id`), which is why
  `Cloud IPC command accessed` lines are what let finding 3 prove the gate was healthy 2 ms after a
  rejection. `require_privileged`'s equivalent is `debug!` and therefore absent from the log.

**Also exemplary:**

- **`src/lib.rs:582-584`** — the mint, three statements, above the builder. The ordering claim is
  checkable in one hop (`tauri-2.11.2/src/app.rs:2513-2525`: config windows at `:2517`, the app's
  own setup closure at `:2523`) and it holds. **This is P4 implemented correctly**, and it is the
  reason the brief's primed hypothesis — a call arriving before the token exists — is
  unrepresentable.
- **`eslint.config.js:74-81`** — `no-restricted-imports` at `"error"` on `invoke`. A single
  chokepoint rule, measurably at 100% adoption in production code, which is the *only* reason a
  dead monkey-patch did not become a total outage. When the primitive's own defence fails, the
  thing that saves you is that there is exactly one door.
- **`src-tauri/src/ipc_auth.rs:1033-1053` and `:1155-1212`** — two drift tests that both **assert
  their instrument before their result** (`checked > 50`; `found.len() > 150`), with the
  fail-loud message written for the person who broke the walk rather than the person who broke the
  code. This is the §9 fail-loud requirement satisfied in a Rust test, and the corpus should cite
  it as the reference.
- **`src-tauri/macros/src/lib.rs:83-90`** — `#[requires(cloud)]` on a sync `fn` is a **compile
  error** with a remediation sentence. The macro already knows that a tier and an asyncness can be
  incompatible; §7 D2 is the second instance of that same insight, unapplied.

### What the running app told us

Read-only, 2026-08-16, no command invoked and no state mutated:

- **6 days · 34 boots · 21,629 log lines · 14 rejections**, all on privileged vault *reads*
  (`get_rotation_status` ×12, `get_all_rotation_statuses`, `list_pending_pairings`).
- **0** "token not initialised" of any of the three flavours — the fail-closed branches are
  unreachable, as predicted statically.
- **0** `Privileged sync command called without IPC validation flag` — the 92 sync gated commands
  and their thread-local are healthy.
- **0** `IPC session token initialised` — D10.
- A rejection at `11:27:04.547` followed by a **passing** gated call at `11:27:04.549` and a
  `tti_ms=8183.9` report at `11:27:12` — page-init burst, not process start, and the gate was fine
  either side of it.

### The measurement that disagreed

Two independent implementations agreed exactly on every headline here (184/50/234, 92 sync /
142 async, 243 annotations = 105 + 138, 17 async-unlisted, 0 sync-unlisted), and the census engine
then reproduced 105/34 and 138/27 from the published pattern. **The disagreement is with a sibling
golden path, not within this one:** [ownership-verification](./ownership-verification.md) reports
"`#[requires(privileged)]`, ASYNC, and absent from both lists = **10**" and
"commands in `PRIVILEGED_COMMANDS` = **191**". Both are wrong at `629a914af`: the values are **17**
and **184**, the latter agreeing with
[second-transport-exposure](./second-transport-exposure.md)'s independent 184 + 50 = 234 and with
the brief. All 17 were opened and read; four are quoted in §7 D3. See §10.3.

**A near-miss worth recording**, because it is the same failure the doctrine warns about: the first
version of the command census brace-matched the `generate_handler!` block and **hung** — the block
contains an unbalanced bracket inside a comment, so the matcher walked off the end of the file and
never terminated. It produced no output at all, which is the *good* failure. A version that had
silently returned a short list would have looked exactly like a correct answer.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every defect below descends from one absence:
> **Tauri's `Invoke` gives the app no per-request slot to put an answer in.** The wrapper computes
> the right verdict at `ipc_auth.rs:644` and then has nowhere to put it except a thread-local that
> the async runtime will not honour. From that single gap follow: a guard rewritten until it could
> not fail (D2), 17 commands that look gated and are not (D3), an inner layer believed to
> compensate for a removed outer layer (D1), and a docstring describing four defences of which two
> are inert (D9). **Give the verdict somewhere to live and most of §7 becomes a type.**

### D1 — P0: whole-vault export/import and the credential-bearing HTTP proxy have no reachable authorization at all

`ipc_auth.rs:425-433` and `:243-253` comment eight names out of `PRIVILEGED_COMMANDS`, each citing
the WebView2 token race, and each explicitly relying on the command body's
`require_privileged` as the compensating control. That control cannot return `Err`.

| command | file:line | what it reaches |
|---|---|---|
| `export_credentials` | `commands/core/data_portability.rs:9555` | *"Export all credential secrets to a password-protected encrypted file"* — iterates `cred_repo::get_all` |
| `import_credentials` | `:9669` | writes credentials from a caller-supplied file |
| `export_full` / `import_portability_bundle` | `:1799` / `:1949` | whole-database export / import |
| `import_portability_bundle_from_path` | `:2193` | bulk import — **never listed, never commented out; simply absent** |
| `execute_api_request` | `commands/credentials/api_proxy.rs:36` | outbound HTTP with a decrypted vault credential; caller supplies `credential_id`, `method`, `path`, `headers`, `body` |
| `get_api_proxy_metrics` · `save_api_definition` | `:61` · `:89` | proxy metrics / definitions |

*Fix, in order:* (1) delete `require_privileged` and let these fail to compile, which surfaces the
gap in a diff; (2) restore the list entries and fix the transport (D4/D7) rather than the list;
(3) if any genuinely cannot be gated, move the check into the *engine* function
(`engine::api_proxy::execute_api_request`, `data_portability`'s writers) where a real precondition
can be asserted.

### D2 — `require_privileged` (async) cannot return `Err`, and it is the only in-body guard on 86 commands

`ipc_auth.rs:547-562`. Its single failure branch tests `IPC_SESSION_TOKEN.get().is_none()`.
`init_session_token` has one call site (`lib.rs:583`), unconditional, above the builder; the app
has one `tauri::Builder` and one `generate_handler!`; no other binary in `Cargo.toml`
(`personas-mcp`, `athena-bench-validate`, `personas-daemon`) references `ipc_auth`. **The branch is
dead.** The comment above it (`:543-546`) is honest about *why* — *"For async commands the
thread-local flag may not be reliable (tokio task migration), so we verify the security system is
initialised and log"* — and then stops one sentence short of the conclusion: verifying an
unfalsifiable invariant is not verifying.
*Fix:* the type in §4 — delete it, and change `macros/src/lib.rs:77-79` to emit nothing for
`("privileged", true)`, so the wrapper is visibly the only gate.

### D3 — 17 commands carry `#[requires(privileged)]`, are async, and are on neither list

Two independent implementations agree, and all 17 were opened:

`execute_api_request` · `get_api_proxy_metrics` · `save_api_definition`
(`credentials/api_proxy.rs:36,:61,:89`) · `export_credentials` · `import_credentials` ·
`export_full` · `import_portability_bundle` · `import_portability_bundle_from_path`
(`core/data_portability.rs:9555,:9669,:1799,:1949,:2193`) · `get_use_case_cascade` ·
`count_event_listeners` (`core/use_cases.rs:278,:427`) · `list_mcp_gateway_members`
(`credentials/mcp_gateways.rs:65`) · `get_simulation_artefacts` (`design/build_simulate.rs:519`) ·
`cloud_sync_status` (`infrastructure/cloud_sync.rs:25`) · `github_list_repos` ·
`github_check_permissions` (`tools/github_platform.rs:11,:22`) · `n8n_list_workflows`
(`tools/n8n_platform.rs:11`) · `remote_command_list_pending` (`cloud/remote_commands.rs:201`).

All 17 are in `DRIFT_BASELINE` (`ipc_auth.rs:1076-1111`), so the drift test passes — correctly, by
its own contract, which is "annotated but unlisted, with a reason". **The reason for 8 of them is a
transport race that finding 1 disproves, and for the rest is "read-only", which
`github_list_repos`/`github_check_permissions` (both spend a vault credential against a third-party
API) do not satisfy.**
*Fix:* re-triage the baseline against the measured cause. The read-only ones should lose the
annotation (D2's type makes that mechanical); the credential-spending ones should be listed.

### D4 — `connect-src` names `asset:` and omits `ipc:`, so the fallback transport is one CSP violation away in release

`src-tauri/tauri.conf.json` → `app.security.csp` and `app.security.devCsp`. Both enumerate
`asset: http://asset.localhost https://asset.localhost` and neither contains `ipc:` or
`http://ipc.localhost`. On Windows the IPC fetch targets `http://ipc.localhost/<cmd>`
(`tauri-2.11.2/scripts/core.js:13-19`), a different origin from the document's, so `connect-src
'self'` does not cover it. Tauri does **not** inject it — its own documented example writes it by
hand (`tauri-utils-2.9.2/src/config.rs:2741`: `connect-src ipc: http://ipc.localhost`).

**The bound on this claim, stated rather than glossed:** the CSP is applied only to HTML the Tauri
asset protocol serves (`tauri-2.11.2/src/manager/mod.rs:435-453`). In dev the frontend comes from
Vite on `localhost:1420`, so **no CSP is applied and the defect cannot reproduce** — which is
exactly why six days of dev logs show `0` occurrences of Tauri's `IPC custom protocol failed`
warning. **The prediction is that a release build blocks the first IPC fetch, latches
`customProtocolIpcFailed`, and thereafter drops `x-ipc-token` on every call for the life of the
page.** It was not verified, because verifying it requires a release build and `cargo` was not run.
*Fix:* add `ipc: http://ipc.localhost https://ipc.localhost` to `connect-src` in both `csp` and
`devCsp`, and add the check to `scripts/check-csp-hosts.mjs` (§9's second mechanism).
*Verification, one command:* run `npm run tauri:build:lite`, open the app, and check for
`IPC custom protocol failed` in the console / `personas.<date>.log`.

### D5 — `ipc_auth.rs` contradicts itself about `discover_connector_resources`

`:145` lists it (in the 2026-08-13 promotion block). `:263-269` says *"Credentials -- Dynamic
discovery (adoption questionnaire). NOT listed here because the wrapper-level header check fails
intermittently on Windows WebView2"* and shows it commented out. **Both are in the file today.**
The promotion silently overrode a documented WebView2 exclusion without deleting its justification,
so the file now teaches the opposite of what it does.
*Fix:* delete `:263-269`. One line of prose, and it is the kind of contradiction that makes every
neighbouring comment less trustworthy.

### D6 — `import_from_share_link` is async, guards with the *sync* checker, and therefore fails on every call

`commands/network/bundle.rs:391-396` is `pub async fn` whose first statement is
`require_privileged_sync(&state, "import_from_share_link")?`. `ipc_auth.rs:411-414` justifies it:
*"that one calls `require_privileged_sync` directly in its body, **before any `.await`**, so the
thread-local flag is still reliable."* **The reasoning is wrong at the first clause.** The whole
body — including its first statement — runs inside the future that
`tauri-macros-2.6.2/src/command/wrapper.rs:378` hands to `respond_async_serialized`, which
`tauri-2.11.2/src/ipc/mod.rs:329` `spawn`s onto a multi-threaded tokio runtime. "Before any
`.await`" is irrelevant: the thread changed before the first statement, not at the first `.await`.
`IPC_VALIDATED` is `false` there, so the guard returns `Forbidden` unconditionally.

**Unobserved, and I say so:** the command was not invoked in the 6-day window (0
`without IPC validation flag` lines), so this is a proven mechanism with no field sighting. The
command *is* registered and reachable from `src/api/network/bundle.ts`.
*Fix:* one line — make the guard the async one, or (better, per D2) drop it and rely on the list
entry, which is already present at `ipc_auth.rs:423`.

### D7 — the client's auth recovery matches a string literal that two of three producers do not emit

`tauriInvoke.ts:544-555` `isIpcAuthFailure` tests for the substring `"IPC authentication failed"`.

| producer | message | matched? |
|---|---|---|
| `wrap_invoke_handler` (`ipc_auth.rs:650`) | `"IPC authentication failed: invalid session token"` | ✅ |
| `require_privileged_sync` (`:464`) | `"IPC authentication required for this operation."` | ❌ |
| `require_privileged` / `_sync` init guard (`:454`, `:555`) | `"IPC security system not initialised. Restart the app."` | ❌ |

Two of the three are currently unreachable (D2) or fail-permanently (D6), so the mismatch is latent
— but the *coupling* is live: a Rust string edit silently disarms a TypeScript recovery path 1,400
lines and one language away, with no shared constant and no test.
*Fix:* emit a stable machine token (`kind: "IpcAuthFailed"`, which the wrapper's payload already
has a slot for at `:651`) and match on that.

### D8 — the session token is injected into every webview the app opens, including the external-origin OAuth popup

`lib.rs:590-594` registers the token script as a plugin `js_init_script`.
`tauri-2.11.2/src/manager/webview.rs:202` extends **every** pending webview's initialization-script
list with the plugin scripts, unconditionally — no URL check, no local/remote distinction — and
`tauri-runtime-wry-2.11.2/src/lib.rs:5172-5174` installs them all. The app creates two external
webviews: `login_with_google` (`commands/infrastructure/auth.rs:444-451`) and
`login_with_google_drive` (`:571-578`), both `WebviewUrl::External(<supabase authorize url>)`,
which 302s to `accounts.google.com`. **`window.__IPC_TOKEN` is therefore set in a page this app
does not control and whose CSP it does not write.**

**What currently prevents exploitation is a dependency's control, not the app's.**
`tauri-2.11.2/src/webview/mod.rs:1820-1849` rejects **custom (non-plugin) commands from a non-local
origin** unless an explicit `remote` capability exists; `src-tauri/capabilities/{default,mobile}.json`
declare none. So the OAuth page holds a credential it cannot currently spend. That is one
`capabilities` edit and one dependency upgrade away from being false, and nothing in this repo
records the dependency.
*Fix:* pass the token through a webview-scoped script instead of a plugin-global one (register it
on the main window's builder), or gate the assignment on
`window.location.origin === <app origin>` inside the script itself — one `if`, and it makes the
scope decision visible at the injection site.

### D9 — the module docstring documents four enforcement layers; two are inert

`ipc_auth.rs:12-27`. Layer 1 (the wrapper) is real, and gates 234 names. Layer 2
(`require_privileged_sync` / `require_privileged`) is real for the **92** sync gated commands and
unfalsifiable for the **142** async ones. Layer 3 (`require_cloud_auth`) is real. **Layer 4 (the
init-script monkey-patch) cannot install** (finding 1). A reader budgets defence-in-depth from this
list; the budget is roughly half of what it says.
*Fix:* rewrite the docstring to say that the wrapper is the only gate, that the init script's job
is to publish `window.__IPC_TOKEN` (its `patchInvoke` half being dead since Tauri 2's
`Object.defineProperty`), and that the client attacher plus the ESLint chokepoint are what make the
header arrive.

### D10 — the token's own lifecycle is invisible to the log that would record it

`lib.rs:585` emits `tracing::info!("IPC session token initialised (privileged commands
protected)")`; `lib.rs:664` installs the file layer (`logging::add_file_layer`). **0 of 34 boots
recorded the line.** The consequence is not cosmetic: the log cannot answer "when did this session
start", so the 14 rejections had to be correlated against `File logging enabled` (`logging.rs:135`)
as a proxy, and the page-level boundary that actually matters had to be inferred from a
`tti_ms` report and a watchdog line.
*Fix:* move the mint's `info!` below `add_file_layer`, or emit it as a deferred record. Same class
as `CLAUDE.md`'s note that file logging was installed after the migrations it was meant to record —
**third instance of this shape in this repo, which makes it a pattern, not an accident.**

### D11 — the transport-degradation bit exists on the wire and nobody reads it

`ipc-protocol.js:78` sends `options.customProtocolIpcBlocked` on the fallback path;
`tauri-2.11.2/src/ipc/protocol.rs:229-230` deserialises it into `RequestOptions` and uses it at
`:339` — and it is **not** carried onto `InvokeRequest`, so `wrap_invoke_handler` cannot see it.
The app therefore cannot distinguish "the header was absent" from "the header could not have been
present", which is the difference between a client bug and a transport bug.
*Fix (no dependency change needed):* at `ipc_auth.rs:644`, before rejecting, log
`headers_len = invoke.message.headers().len()`. A zero-length header map on a call that
`tauriInvoke.ts` constructed a `Headers` for is a positive identification of the postMessage path.
Two lines, and finding 3 becomes a one-day diagnosis instead of a five-month mystery.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **Tauri gives the app no per-request slot for its own verdict.** `Invoke { message, resolver,
   acl }` is what the invoke handler receives; the `acl` field is Tauri's, not the app's, and
   nothing the wrapper computes can be attached to the request. There is no `Extensions` map as in
   `axum` — which the repo's *other* transport uses correctly
   (`management_api.rs:476-480` puts `AuthedApiKey` in request extensions). **Personas' HTTP
   surface has the primitive its IPC surface needs.** Until Tauri grows one, the only
   thread-independent carrier is `AppState`, which is why `require_cloud_auth` works and
   `require_privileged` does not.
2. **No test in this repo can observe the IPC transport.** Vitest runs against a mock
   (`src/test/tauriMock.ts`); the Rust tests never construct an `Invoke`. The one property that
   would have caught the whole of finding 2 — *does a credential placed in `options.headers`
   arrive?* — is unreachable from both suites. The nearest reachable proxy is a pure round-trip
   assertion (§9, mechanism 2).
3. **The drift tests cannot distinguish "listed" from "enforceable".**
   `every_requires_annotation_is_listed_or_baselined` (`ipc_auth.rs:1155`) is a good instrument for
   the question it asks. But "is this name in the list" and "can this command's guard refuse" are
   different predicates, and D3's 17 commands satisfy the first via `DRIFT_BASELINE` while failing
   the second. Closing this needs the tier→guard table (`macros/src/lib.rs:67-82`) to be data the
   test can read, not `quote!` blocks.
4. **The census cannot assert an absence.** "No code path can reach a state where the token is
   unset", "the header survives every transport", "no webview outside the main window receives the
   init script" are all absences. §9 ratchets a *presence* (annotations whose guard cannot fail)
   and names the two non-census instruments the absences need.
5. **Rotation is not merely unimplemented; it is unrepresentable.** `OnceLock` + `panic!` on
   re-init means adding rotation is a type change, not a feature. The honest position today is
   "process-lifetime credential", and D8 is the deviation that makes that position expensive.
6. **No instrument sees a rejection except a log file.** No Sentry event, no `ipcMetrics` category,
   no audit row, no UI. The user-visible symptom is whatever the calling feature does with a
   `Forbidden` — historically *"valid credentials shown as degraded"*
   (`src/features/vault/sub_credentials/manager/useCredentialManagerState.ts:40`).

---

## 9. The missing gate

**The condition, stated stack-free:** *an authorization annotation expands to a guard whose failure
condition cannot occur, so the annotation reports a tier the code cannot enforce.*

An adopting repo **must re-derive its own proxy.** This one keys on a Rust attribute macro
adjacent to a `pub [async] fn`. A Python service spells the identical condition as
`@requires_auth` over a dependency that returns unconditionally; a Node service as a middleware
that always calls `next()`. Both score a **structural zero** against this pattern while the
condition is present at scale — `vibeman`'s `hasMinimumRole('admin', …)` is the same defect with no
annotation anywhere. **Do not port the regex; port the question: for each authorization decorator,
can the thing it calls ever refuse?**

**Where it runs:** `npm run census` / `npm run census:check` — local, and invoked by the pre-push
hook. Explicitly **not** a CI-only gate: `ci.yml` runs its Rust tests but is red on pre-existing
failures, so a gate that only lives there runs nowhere.

### Existing rules checked first, by reading each definition rather than its title

110 rules in `scripts/census/rules.json` at the start of composition; **112 at the end** —
`asserted-definition-blob` (15/16) and `read-failure-as-empty-value` (32/68) were added by a
parallel session mid-composition and were re-checked before publishing: both are
`roots: ["src"]`, `.ts`/`.tsx`, so they share neither a file nor a match position with a
Rust-attribute rule. **None of the 112 keys on `#[requires(`.**

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `build-gated-ipc-entrypoint` (1/127) | `#[cfg(...)]` immediately above a `commands::path,` entry **inside `generate_handler!`** | Nearest neighbour by subject and **disjoint by file**: its 1 file is `src/lib.rs`; this rule's 34 files are all under `src/commands/**` + `src/cloud/`, and `lib.rs` is in neither this rule's nor its control's file set (verified). It asks whether an entry point *exists* in this build; this asks whether the guard behind it can refuse. |
| `unauthenticated-transport-route` (4/79) | every `.route("` in `src-tauri` | The authn question on a *different transport*. Matches `.route("` string literals in router builders; this matches `#[requires(` attributes above fn signatures. Zero position overlap, zero file overlap. |
| `caller-asserted-owner` (11/16) | `if <row>.<owner>_id != <bare ident>` with an error consequent | The authz-of-a-row question. Matches Rust `if` conditions in command bodies; this matches attributes above signatures. Zero position overlap. |
| `undiscriminated-credential-rejection` (6/17) | an **outbound** request carrying a credential whose failure is not discriminated by status | Opposite direction (this app as client) and matches `.bearer_auth(` / header builders. No shared position. |
| `process-global-caches-a-failure` (3/4) | `static X: OnceLock<Result<…>>` | Closest in *spirit* to the `OnceLock` half of this leaf, and disjoint: `IPC_SESSION_TOKEN` is `OnceLock<String>`, not `OnceLock<Result<…>>`, and is deliberately not a cached failure. Verified: `ipc_auth.rs` is not in its 3 files. |
| `detached-readiness-verdict` (2/3) | an `UPDATE personas SET setup_status` with no `setup_detail` | Title is close, subject is not — a SQL-literal rule about persona setup state. |
| `autonomy-verdict-outside-the-front-door` (4/5) | "may this run unattended" answered from raw config | The closest *philosophical* neighbour — a policy decision taken away from its door — and it keys on `settings::get` calls naming autonomy keys. No shared match. |
| `discarded-guard-verdict` (7/11) · `unfenced-work-outcome-write` (6/11) · `blind-identity-write` (35/82) | SQL-literal rules about a write's precondition or its discarded count | All three match inside SQL strings. Disjoint. |
| `undeclared-tier-branch` (13/13) | `useTier()` destructuring | TypeScript, `src/`, product tiers not auth tiers. |
| `module-scope-install-latch` (13/13) | a module-scope `let x = false` set to `true` and never reset | **The one-way latch this leaf's transport bug depends on** — and the instance is `customProtocolIpcFailed` in `tauri-2.11.2/scripts/ipc-protocol.js:17`, inside a dependency, outside every root the census walks. Named here because it is the closest existing rule to §0 finding 2 **and it cannot reach it.** |

### Measurement

**Precision: 105/105 by construction, and the construction is the argument.** Every match is
either `#[requires(auth)]` — whose guards are `pub fn require_auth_sync(_state) -> { Ok(()) }`
(`ipc_auth.rs:477-479`) and `pub async fn require_auth(_state) -> { Ok(()) }` (`:537-539`),
unconditional in the literal sense — or `#[requires(privileged)]` on an `async fn`, whose guard's
only `Err` branch tests `IPC_SESSION_TOKEN.get().is_none()` (`:549-557`), which D2 proves
unreachable. **There is no judgement in the classification: the macro's dispatch table
(`macros/src/lib.rs:67-82`) is a total function from (tier, asyncness) to a guard, and three of its
five arms return a value that is always `Ok`.**

**The partition is the control, which is stronger than a ratio.** An anchor accepting *any* tier
and *any* asyncness returns **243**:

| | matches | files |
| --- | ---: | --- |
| **anchor** — every `#[requires(auth\|privileged\|cloud)]` above a `pub [async] fn` | **243** | 48 |
| ↳ **violating** — the guard cannot return `Err` (`auth` ×2 arms, `privileged`+async) | **105** | 34 |
| ↳ **compliant** — the guard can (`privileged`+sync, `cloud`+async) | **138** | 27 |

**105 + 138 = 243 exactly**, so every annotation in 564 `.rs` files is classified and there is no
unexamined third population. Per-tier: `auth+sync` 18, `auth+async` 1, `privileged+async` 86 |
`privileged+sync` 82, `cloud+async` 56, `cloud+sync` **0** (a compile error, `macros/src/lib.rs:83-90`).

**Three independent implementations agree.** (i) A line-oriented Rust walker that finds
`#[tauri::command]` and reads forward to the signature; (ii) a whole-file-content regex pass over
each file with no shared code; (iii) the census engine, from the published pattern. All three
return 243 / 105 / 138 with identical membership. Agreement is not soundness, so a sample was read
by hand: `personas.rs:32` (`list_personas`, `auth`+sync), `personas.rs:67`
(`bulk_delete_personas`, `auth`+sync — persona deletion, annotated, ungated),
`api_proxy.rs:36` (`execute_api_request`), `data_portability.rs:9555` (`export_credentials`),
`use_cases.rs:278`, `github_platform.rs:11`, `remote_commands.rs:201`, `ffmpeg.rs:411`,
`crash_telemetry.rs:66` — and, on the control side, `cloud.rs`, `gitlab.rs`, `crud.rs`,
`external_api_keys.rs`.

**Zero matches inside `#[cfg(test)]`**, verified by **brace-matched range** — never a line
threshold — against all 243 anchor matches, in a tree where **265** of the 564 files contain a
`#[cfg(test)]` module. The instrument had plenty to find and found none.

**Backtracking:** the pattern contains no nested quantifier and no unbounded fill. Its only
repetitions are `[^\S\r\n]*` / `[^\S\r\n]+` (horizontal whitespace, complete alphabet partition,
cannot cross the newline the pattern anchors on) and one `\s*` inside `requires(…)`. Full run over
564 files: **< 0.3 s**; `commentMatchesSkipped: 0` on both rules. The macro's own doc-comment
examples (`macros/src/lib.rs:34-50`) do **not** match — each `pub fn` line is prefixed `/// `, and
`[^\S\r\n]*` cannot consume `///` — and the root `src-tauri/src` excludes `src-tauri/macros`
anyway.

**Validated standalone** in a composer-private registry
(`registry-ipc-session-token-race-composer.json` — a filename unique to this composer, because
sibling composers share the scratchpad), then **re-extracted from this finished document and
re-run: `files 34 / matches 105` and `files 27 / matches 138`, identical both times.**

### The rule

```json
{
  "rules": [
    {
      "id": "unfalsifiable-tier-guard",
      "goldenPath": "docs/concepts/golden-paths/ipc-session-token-race.md",
      "title": "A #[requires(...)] tier annotation expands to a guard that CANNOT return Err — because the evidence the real gate produced does not exist where the guard runs",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "#\\[requires\\(\\s*(?:auth\\s*\\)\\][^\\S\\r\\n]*\\r?\\n[^\\S\\r\\n]*pub[^\\S\\r\\n]+(?:async[^\\S\\r\\n]+)?fn|privileged\\s*\\)\\][^\\S\\r\\n]*\\r?\\n[^\\S\\r\\n]*pub[^\\S\\r\\n]+async[^\\S\\r\\n]+fn)[^\\S\\r\\n]+[a-z_0-9]+",
        "flags": "g",
        "ignoreCommentLines": true,
        "$measured": "2026-08-16 @ 629a914af — 564 .rs files walked under src-tauri/src, floor 500, run <0.3s, commentMatchesSkipped 0; THREE independent implementations (a line-oriented Rust walker, a whole-file-content regex pass with no shared code, and the census engine from this pattern) agree at 105/34 and 138/27 with identical membership; anchor = 243 = 105 + 138 exactly; 0 matches inside brace-matched #[cfg(test)] ranges in a tree where 265 of 564 files have one; live counts from a read-only read of six days of the operator's own tracing log (34 boots, 21,629 lines, 14 rejections, 0 'token not initialised').",
        "description": "A `#[requires(auth)]` or `#[requires(privileged)]` attribute sitting immediately above a `pub fn` / `pub async fn`, in the two (tier, asyncness) combinations whose expanded guard CANNOT RETURN Err. PROXY FOR the stack-free condition: an authorization annotation expands to a guard whose failure condition cannot occur, so the annotation reports a tier the code cannot enforce. THE CLASSIFICATION CONTAINS NO JUDGEMENT: src-tauri/macros/src/lib.rs:67-82 is a TOTAL FUNCTION from (tier, asyncness) to a guard call, and three of its five arms name a function that is unconditionally Ok. `auth` (both arms) expands to require_auth_sync / require_auth, whose whole bodies are `Ok(())` (ipc_auth.rs:477-479, :537-539). `privileged` + ASYNC expands to require_privileged (ipc_auth.rs:547-562), whose ONLY Err branch tests IPC_SESSION_TOKEN.get().is_none() — unreachable, because init_session_token has exactly ONE call site (lib.rs:583), it is unconditional, it runs ABOVE the Tauri builder, and tauri-2.11.2/src/app.rs:2515-2517 creates every configured window INSIDE tauri::app::setup() at :2523, i.e. AFTER the mint; the app has one tauri::Builder and one generate_handler!, and no other binary in Cargo.toml references ipc_auth. MEASURED, not argued: six days of the operator's own tracing log (2026-08-11..16, 34 boots, 21,629 lines, read READ-ONLY) contain ZERO 'IPC session token not initialised' lines and ZERO 'without IPC validation flag' lines, and 14 'Rejected IPC call: invalid or missing session token' — all 14 from the WRAPPER, none from any in-body guard. WHY THE ASYNC ARM DEGENERATED, which is the leaf's whole subject: wrap_invoke_handler sets a THREAD-LOCAL (ipc_auth.rs:80-85, :657) and clears it when inner(invoke) returns (:659) — but tauri-macros-2.6.2/src/command/wrapper.rs:378 hands every async command to respond_async_serialized, which tauri-2.11.2/src/ipc/mod.rs:329 implements as async_runtime::spawn on a MULTI-THREAD tokio runtime (async_runtime.rs:222). The verdict is therefore gone, on a different thread, before the body's first statement — so the guard was rewritten to check something it could still see, and what it could still see cannot be false. 142 of the 234 gated commands are async. THE COST IS NOT THEORETICAL: 17 commands carry #[requires(privileged)], are async, and are on NEITHER PRIVILEGED_COMMANDS nor CLOUD_COMMANDS, so this inert guard is their ONLY authorization — including export_credentials (commands/core/data_portability.rs:9555, 'Export all credential secrets to a password-protected encrypted file'), import_credentials (:9669), export_full (:1799), import_portability_bundle (:1949), import_portability_bundle_from_path (:2193) and execute_api_request (commands/credentials/api_proxy.rs:36, outbound HTTP with a DECRYPTED vault credential at a caller-chosen method/path/headers/body). Eight of those names are COMMENTED OUT of PRIVILEGED_COMMANDS (ipc_auth.rs:243-253, :425-433) with a written justification that the wrapper's header check races a monkey-patch on Windows WebView2 — and that monkey-patch CANNOT INSTALL: replayed in Node against the exact descriptor tauri-2.11.2/scripts/core.js:81 creates ({writable:false, configurable:false}), the strict-mode assignment at ipc_auth.rs:712 throws, the defineProperty fallback at :720 throws, the outer catch at :734 returns TRUE, so :738 reads success and the 200x10ms retry loop is never scheduled and __ipc_patched is never set. THE REPO ALREADY KNOWS: src/test/automation/perfInstrument.ts:12-14 says 'Tauri 2 makes window.__TAURI_INTERNALS__.invoke non-configurable, so monkey-patching at that layer fails - see commit history for the rejected attempt', landed 2026-05-17 in 36acf8b17, the SAME DAY a WebView2-race comment was touched in ipc_auth.rs. PARTITION, NOT A RATIO: an anchor accepting any tier and any asyncness matches 243; this rule takes 105 and its positive control takes 138; 105 + 138 = 243 exactly, so there is no unexamined third population. Per-tier: auth+sync 18, auth+async 1, privileged+async 86 | privileged+sync 82, cloud+async 56, cloud+sync 0 (a compile error, macros/src/lib.rs:83-90). ZERO MATCHES INSIDE #[cfg(test)], verified by BRACE-MATCHED RANGE — never a line threshold — across all 243 anchor matches, in a tree where 265 of 564 files contain a #[cfg(test)] module. DOES NOT OVERLAP build-gated-ipc-entrypoint, its nearest neighbour by subject: that rule's single file is src/lib.rs and this rule's 34 files are all under src/commands/** and src/cloud/, with lib.rs in neither this rule's nor its control's file set. Nor unauthenticated-transport-route (.route( string literals, a different transport), nor caller-asserted-owner (Rust `if` conditions about a row's owner), nor undiscriminated-credential-rejection (OUTBOUND credentials), nor process-global-caches-a-failure (OnceLock<Result<..>>, whereas IPC_SESSION_TOKEN is OnceLock<String> and is deliberately not a cached failure). LEGAL FIX, in order: (1) delete require_privileged and change macros/src/lib.rs:77-79 to emit NOTHING for ('privileged', true), so the wrapper is visibly the only gate and the 17 unlisted commands become visibly ungated in the diff; (2) restore the eight commented-out list entries and fix the TRANSPORT instead — see the golden path's D4 (connect-src names asset: and omits ipc:) and D7; (3) for auth, delete the annotation, because require_auth/require_auth_sync are Ok(()) at 1,253 call sites and the annotation's only effect is to make a reader believe otherwise. DO NOT silence a match by renaming the tier, by moving the guard call into the body by hand, or by adding the command to DRIFT_BASELINE — all three preserve the defect, and the third is where 17 of them already are. END OF LIFE: this rule is a proxy for 'the guard behind this attribute cannot return Err'. If require_privileged is ever given evidence it can genuinely inspect (a Validated value threaded through the request, or shared state the request can disagree with, the way require_cloud_auth reads state.auth), THE PROXY IS VOID: move the privileged+async arm into the positive control and re-measure, do not baseline it. When the count reaches 0 the runner fails structurally on zero-matches, BY DESIGN — DELETE the rule then."
      },
      "baseline": { "files": 34, "matches": 105 },
      "floor": 500
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "unfalsifiable-tier-guard-positive-control",
  "goldenPath": "docs/concepts/golden-paths/ipc-session-token-race.md",
  "title": "POSITIVE CONTROL — the same annotation in the two (tier, asyncness) combinations whose guard CAN return Err",
  "roots": ["src-tauri/src"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "#\\[requires\\(\\s*(?:cloud\\s*\\)\\][^\\S\\r\\n]*\\r?\\n[^\\S\\r\\n]*pub[^\\S\\r\\n]+async[^\\S\\r\\n]+fn|privileged\\s*\\)\\][^\\S\\r\\n]*\\r?\\n[^\\S\\r\\n]*pub[^\\S\\r\\n]+fn)[^\\S\\r\\n]+[a-z_0-9]+",
    "flags": "g",
    "ignoreCommentLines": true,
    "$measured": "2026-08-16 @ 629a914af — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 27 files / 138 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL anchor as unfalsifiable-tier-guard — the same attribute, the same adjacency to a `pub [async] fn`, the same root and extensions — differing in exactly one thing: the (tier, asyncness) combination, chosen so the expanded guard CAN return Err. `cloud` + async expands to require_cloud_auth (ipc_auth.rs:566-601), which reads state.auth — SHARED STATE, reachable from any tokio worker — and refuses on two distinguishable conditions with different messages (offline-with-cached-profile at :573-582, never-signed-in at :583-586); `privileged` + sync expands to require_privileged_sync (:447-474), which reads the thread-local the wrapper set and IS still on that thread, so it genuinely fails closed (the repo has a live incident record for exactly that at :341-350: 78 'without IPC validation flag' log entries on 2026-07-14 when two sync commands were annotated but unlisted). MEASURED 2026-08-16: 138 matches across 27 files versus the gate's 105 across 34. PARTITION, NOT A RATIO: the anchor over all three tiers and both asyncnesses matches 243, and 105 + 138 = 243 exactly, so every #[requires(...)] annotation in 564 .rs files is classified and there is no unexamined third population. The two rules are mutually exclusive BY CONSTRUCTION: cloud+sync is a compile error (macros/src/lib.rs:83-90, measured 0), and no annotation can be both `auth` and `cloud`, or both async and sync. WHAT THE 138 DEMONSTRATE IS THE DOCTRINE, NOT MERELY COMPLIANCE: require_cloud_auth sits TWENTY LINES BELOW require_privileged, in the same file, written by the same authors for the same threat model, and the ONLY structural difference is where it keeps its evidence — shared state instead of ambient thread-local context. That is the golden path's section 2(b) with a working example and a broken one in one screen. IF THIS COUNT EVER COLLAPSES TOWARD THE GATE'S, the shared anchor has broken and BOTH numbers are meaningless. IF IT RISES WHILE THE GATE'S FALLS BY THE SAME AMOUNT, that is the intended fix landing (an arm moving from unfalsifiable to enforceable) and the gate's baseline must be ratcheted with `npm run census -- --update`, not silenced. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine exempts a `-positive-control` id from the baseline requirement and the registry merge skips it by construction."
  },
  "floor": 500
}
```

**Measured, in a private scratch registry, then re-extracted from this document and re-run — identical both times:**

```
unfalsifiable-tier-guard                    34 files   105 matches   (base 34 / 105)   walked 564
unfalsifiable-tier-guard-positive-control   27 files   138 matches   (no baseline)     walked 564
```

### Two instruments the census cannot host, specified here

The census ratchets a presence. Two of this leaf's largest findings are absences, and both need
their own instrument:

1. **A credential round-trip test (Vitest, ~15 lines, no Tauri needed).** Assert that the object
   `tauriInvoke.ts:463-466` builds still carries `x-ipc-token` after the serialisation each
   transport applies:
   ```ts
   const opts = buildInvokeOptions('tok');                    // export the 3 lines from _invokeCore
   expect(new Headers(opts.headers).get('x-ipc-token')).toBe('tok');          // custom-protocol path
   expect(JSON.parse(JSON.stringify(opts)).headers['x-ipc-token']).toBe('tok'); // postMessage path — FAILS TODAY
   ```
   **It fails loudly if its own precondition is absent**: assert the first expectation too, so a
   refactor that stops attaching the header at all cannot make the second one vacuously pass.
2. **A CSP host check for the IPC origin.** `scripts/check-csp-hosts.mjs` already exists and
   already carries the exit-2 discipline the doctrine cites. Extend it to assert that both `csp`
   and `devCsp` `connect-src` contain the IPC origin for every platform the app ships on, and to
   **exit 2 if it cannot find a `connect-src` directive at all** — the same guard that saved that
   script twice before.

**What no gate can do.** Nothing machine-checkable decides whether a transport-flake justifies
ungating an operation. That is P7 and it stays human. A checker can guarantee only that an
annotation which cannot enforce is a visible, counted, deliberate thing — and that the 105 that
exist today cannot become 106 without somebody noticing.

---

## 10. Corrections to the brief, and to two sibling paths

1. **The leaf is two-sided, not `sides: server`.** The credential is minted server-side and
   attached client-side, and **three of the eleven deviations live in `src/lib/tauriInvoke.ts`**
   (D7, and the anti-patterns for the poll and the retry). The spine label should be `twoSided`;
   this document carries both halves and the contract between them.

2. **"A call that arrives before the token exists" cannot happen; "after it rotates" cannot
   happen either.** The mint is above the builder (`lib.rs:582`) and window creation is inside
   `tauri::app::setup()` (`app.rs:2517`, before the app's own closure at `:2523`); the store is a
   `OnceLock` with one `set` and a `panic!` on re-init. **The brief's two hypothesised windows are
   both closed by construction. The window that is open is around the *verdict*, not the token**,
   and it is not a race at all — it is deterministic, and it applies to 142 of 234 gated commands.

3. **"`require_privileged` for async attributed commands is reportedly a debug log — 10 commands
   with zero enforcement." The count is 17, not 10, and the mechanism is stronger than
   "a debug log".** Three independent implementations agree on 17 (all opened and read). The 10
   comes from [ownership-verification](./ownership-verification.md) §5, which also reports
   `PRIVILEGED_COMMANDS` at **191**; the measured value is **184**, agreeing with
   [second-transport-exposure](./second-transport-exposure.md)'s independent 184 + 50 = 234 and
   with the brief's own figure. Two of three sources agree at 184. And the guard is not merely
   "a debug log": it contains a real `if` over a real global, which is *why* it survived review.

4. **The primed startup hypothesis — "look for a window where the app serves before it is ready" —
   is correct in general and wrong for this leaf.** `tauri::app::setup()` really does create the
   configured window at `app.rs:2517` **before** running the app's `.setup()` closure, so the
   webview is loading while `AppState` is still unmanaged (`lib.rs:1199`, ~585 lines in) and while
   `recover_stale_executions` runs at `:815` and leadership is acquired at `:1250`. But the
   event loop is inside `setup` for that whole span, so IPC messages queue rather than dispatch:
   **it is a stall, not a hole, and it is not a token problem.** The startup ordering that matters
   for *this* leaf is the one the repo got right.

5. **The frontend's retry-on-auth-failure cannot loop.** `_retryDepth < 1` for the auth retry
   (`tauriInvoke.ts:524`) and `< 2` for the token wait (`:454`), both strictly increasing. Maximum
   one auth retry, at 50 ms. The defect there is not a loop; it is that the retry re-reads a value
   that was never missing and re-sends down a channel that may be structurally incapable of
   carrying it (D7, §0 finding 2).

6. **The brief's four primed facts all verified**, and are used above rather than re-derived:
   `require_auth`/`require_auth_sync` at 1,253 call sites both `Ok(())`; 184 + 50 names with 5
   unregistered; 1,356 of 1,585 registered commands dispatched unchecked; and the self-minted
   vault-wide system key (1,021 rows, 1,014 unused) — which is
   [second-transport-exposure](./second-transport-exposure.md) §0's finding, not this leaf's, and
   is cited there.

7. **A new fact the brief could not have had: the repo already contains the disproof of its own
   security comment, in a test module, dated 2026-05-17.**
   `src/test/automation/perfInstrument.ts:12-14`. Ninety-one days later `ipc_auth.rs` still lists
   the impossible patch as enforcement layer 4 and still cites its "race" as the reason eight
   commands — including the whole-vault export — are outside the gate.

[ipc-command-authorization]: ./ipc-command-authorization.md
