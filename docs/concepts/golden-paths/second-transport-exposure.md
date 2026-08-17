# Golden path — exposing behaviour on a second transport

> Situation node: `backend-runtime/command-definition/second-transport-exposure` ·
> [situation spine](../situation-spine.md) · recurrence 12 · risk **HIGH** · sides **server** ·
> convergence **diverged** · dimensions: **security · function · code-quality · resilience**
> Composed 2026-08-16 against `master` @ `d74fae3c9`.
>
> **Sweep.** All **963** non-generated `.rs` files under `src-tauri/` (the census engine's own
> `walked` count, matching `shared-facts.json`). Every `Router` construction, every `.route(`
> registration, every `TcpListener::bind` / `axum::serve` / QUIC `bind` in the tree enumerated and
> classified. `management_api.rs` (2,800 lines), `webhook.rs`, `local_http/mod.rs`,
> `dev_tools_http.rs`, `companion_api.rs`, `hooks.rs`, `push.rs`, `test_automation.rs`,
> `mcp_server/{mod,auth,db,install,vault}.rs`, `companion/orchestration/mcp/*`, `daemon_bin.rs`,
> `cloud/remote_commands.rs`, `cli_mcp_config.rs` and `ipc_auth.rs` read in full or near-full.
>
> **Measured by executing, not reading.**
> 1. **The operator's app was running throughout.** Its listeners were enumerated from the OS
>    (`Get-NetTCPConnection` / `Get-NetUDPEndpoint`, pid 30128) and five **read-only** loopback
>    probes were issued. Results in §0. No state was mutated; no endpoint outside `127.0.0.1` was
>    contacted; no response body was read beyond its status and length.
> 2. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 71 tables, copied 2026-08-16) queried for what each transport has actually
>    carried: **1,021 `external_api_keys` rows, 1 `api_key_audit` row, 0 `webhook_request_log`
>    rows, 0 `remote_jobs` rows, 2,188 `persona_executions`, 773 `mcp__personas__*` tool steps.**
> 3. The §9 rule was built, run in a private scratch registry, hand-verified, cross-checked by a
>    second independent implementation (which **disagreed by 3, and was the wrong one** — §6), and
>    re-extracted from this document and re-run.
>
> **NEVER PRINT A SECRET.** No token, key or header value appears below. Token *shapes*, *stores*
> and *counts* are reported; no value was read, and the one live key's plaintext exists only in
> process memory and a scrubbed temp file, neither of which was opened.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline, before anything else

**This app answers on five sockets. Its 1,673 IPC commands are gated by one function. Not one of
the other transports calls that function, and the largest of them requires no credential at all —
which was measured live, on the running app, during composition:**

```
127.0.0.1:9420  GET /health                 -> 200        (webhook router; no auth by design)
127.0.0.1:9420  GET /api/personas           -> 401        (management router; middleware works)
127.0.0.1:17400 GET /dev-tools/projects     -> 200, 11,672 bytes   ← no credential presented
127.0.0.1:17320 GET /health                 -> 200        (test-automation bridge, dev build)
127.0.0.1:17500 GET /api/state              -> refused    (no device paired)
```

Eleven thousand six hundred and seventy-two bytes of the operator's dev-project inventory, returned
to an unauthenticated GET from a router that is **mounted unconditionally in release builds**
(`lib.rs:987-990`). And a read is the mild half of that router:

**`POST /dev-tools/projects {"name","root_path"}` accepts any path string with no validation
(`dev_tools_http.rs:468-484`), and `POST /dev-tools/scan-codebase {"project_id"}` passes it to
`launch_context_scan` (`context_generation.rs:601`), which reaches
`spawn_headless_claude` at `context_generation.rs:1223` with `exec_dir = PathBuf::from(root_path)`
(`:1222`). Two unauthenticated POSTs from any process on the host spawn a Claude CLI subprocess,
on the operator's billing account, rooted at a directory the caller chose.** The only check between
them is `root_dir.is_dir()` (`:650`).

**The sentence that authorized this is in the file, and it is arithmetically true and categorically
wrong** (`dev_tools_http.rs:6-8`):

> *"Loopback-only (the server binds 127.0.0.1). The underlying scan command is already
> unauthenticated on the IPC surface (`require_auth` is a no-op), so this exposes nothing the
> running app's frontend can't already do."*

Both clauses check out. `dev_tools_scan_codebase` really is absent from `PRIVILEGED_COMMANDS`, and
`require_auth` really is a documented no-op (`ipc_auth.rs:537-539`). The conclusion is still false,
because **the tier was never a statement about who may call — it is a statement about which token a
caller inside the webview must attach.** Tauri IPC has no network transport: its reachable set is
"code running in our own WebView2 renderer", bounded by a CSP with no `unsafe-eval`
(`tauri.conf.json`). `local_http` binds a TCP socket: its reachable set is *every process on the
machine*. The transport change moved the trust boundary and the tier could not have encoded that,
because the tier does not know what a trust boundary is.

**The measured shape of the surface:**

| | Count | Where |
|---|---:|---|
| `.route("…", …)` registrations in 963 Rust files | **130** | 11 files |
| …that require **no credential of any kind** | **79** | 4 files |
| …in routers mounted **unconditionally in release** | **33** | `dev_tools_http` 31 · `fleet/hooks` 1 · `project_tracking/push` 1 |
| `Router::new()` constructions | **13** | |
| `axum::serve(` call sites | **5** | 4 distinct servers + 1 QUIC endpoint — `webhook.rs` has two start functions and `background.rs:868-887` picks between them at runtime |
| **`middleware::from_fn` — router-level auth layers** | **1** | `management_api.rs:136` |
| `.layer(` of any kind on `local_http`, `dev_tools_http`, `hooks`, `push`, `test_automation` | **0** | no auth, no CORS, no body cap, no timeout |
| `#[tauri::command]` definitions | **1,673** | 1,585 registered |
| …gated by `is_privileged_command` (184 + 50 = 234 names, **229 of them registered**) | **229** | **1,356 of 1,585 (85.6%) need no token** |
| Alternate transports calling `ipc_auth::command_tier` or `is_privileged_command` | **0** | those two symbols have no caller outside `ipc_auth.rs` |

**Four more findings, each with its own number.**

**1 — The app mints itself a vault-wide credential and hands a copy to every persona it runs.**
`get_or_create_system_api_key` (`management_api.rs:570`) creates a key with scopes
`["personas:read","personas:execute","proxy"]`, **`None` expiry, `None` origin binding**
(`:591-602`). Broad `proxy` short-circuits `credential_broker::authorize_credential_use` to
`BrokerGrant::Broad` **for every credential id** (`credential_broker.rs:98-99`), and the proxy
handler then decrypts that credential's fields. The runner fetches this key on every execution
(`runner/mod.rs:1161-1162`) and writes it **in plaintext** into
`exec_dir/.claude/personas-mcp-config.json` (`cli_mcp_config.rs:183-192`) — in a *stable, reused
per-persona temp dir* the module's own docstring flags (`:13-17`). Live: **1,021 rows in
`external_api_keys`, every one named `system`, 1,014 never used, exactly 1 live.** The comment
calls it "this short-lived system API key" (`cli_mcp_config.rs:181`); the code sixty lines away in
another crate says "The system key never expires" (`management_api.rs:587`).

**2 — The management API's scope check exempts the route family that executes personas, and a unit
test codifies the exemption.** `authorize()` (`management_api.rs:335`) opens with:

```rust
if path.starts_with("/a2a/") || path.starts_with("/agent-card/") {
    return Ok(());                                   // management_api.rs:338-340
}
```

`POST /a2a/{persona_id}` with `{"method":"message/send"}` reaches `run_persona_synchronous` — the
comment at `:1731-1732` says so: *"route through the same path used by `/api/execute`."*
`/api/execute/{id}` demands `personas:execute` or `execute:persona:<id>` (`:378-385`). `/a2a/{id}`
demands **nothing**, and `authorize_a2a_and_agent_card_need_only_auth` (`:2457-2460`) asserts
`authorize(&Method::POST, "/a2a/persona-1", &[]).is_ok()` — an **empty scope list**. So a broker
handle minted with `proxy:credential:<id>` + `cred:<connector>:use`, whose whole design is that it
"must never be able to mint further handles" (`:349-351`), can execute any exposed persona. Two
doors, one behaviour, two authorization rules, and the weaker one is tested.

**3 — Adding auth to the MCP transport silently disarmed the app's own use of it, and nothing
noticed for a month.** The stdio MCP server had zero auth until `83db8ed53` (2026-07-16) added a
capability-token gate; its own docstring names the gap it closed (`mcp_server/auth.rs:5-8`).
`PERSONAS_MCP_TOKEN` is written in exactly **one** place — `mcp_server/install.rs:79`, the
`personas-mcp install` path for third-party clients. **`install_mcp_sidecar`, the writer the app
uses to spawn its own sidecar on every persona execution, never sets it**
(`cli_mcp_config.rs:171-234` builds the env map; `:240-246` builds the args). So `token = None`
(`mcp_bin.rs:78-84`) and every `tools/call` returns `-32001` (`mcp_server/mod.rs:101-109`).
Corroborated from data: `authorize_tool_call` writes a **200 audit row on every Allow**
(`auth.rs:111-119`), and `api_key_audit` holds **one row in the app's entire history** — a `POST`
to a route that no longer exists. **Zero rows with `method = "MCP"`. The gate has never returned
Allow.** All **773** `mcp__personas__*` tool steps in the execution ledger date from
2026-06-03..2026-06-26 — entirely the pre-gate era.

**4 — Two listeners are not loopback, and one of them starts by itself in production builds.**
`companion_api.rs:99` binds `Ipv4Addr::UNSPECIFIED` (0.0.0.0) — deliberate, well-built, and inert
until a device is paired (`fleet_companion_devices` is absent from the live 32-row `app_settings`;
the probe above confirms nothing is listening). `p2p/transport.rs:41-54` binds **`[::]:4242`
dual-stack UDP**, and `lib.rs:1784-1805` starts it unconditionally under
`#[cfg(feature = "p2p")]` — which `desktop-full` enables (`Cargo.toml:57`) and which
`tauri.conf.json` and `tauri.stable.conf.json` both select. On that endpoint, `remote_instruct`
runs a full-op-set Athena turn whose only gate is an `owned_devices` row
(`p2p/remote_jobs.rs:221,:490-506`; `companion/remote_jobs.rs:20-32`).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and it is the whole subject.** *A capability's authorization belongs to the
> capability, not to the door.* The moment a second door opens onto the same behaviour, either the
> two doors share one answer-giving function or they will diverge — and the divergence will be
> invisible, because each door looks correct when read alone.
>
> **P2 — physics, and the clause that costs the most.** **An authorization tier is a statement
> about a credential, never about a reachable set.** "This operation is ungated on transport A, so
> exposing it on transport B adds nothing" is the single most reinvented false syllogism in this
> subject. It is false because transports differ in *who can address them at all* — an in-process
> call, a same-machine socket, a LAN socket and an internet socket are four different populations,
> and the tier that was true of the first says nothing about the fourth. **Compare populations,
> not tiers.**
>
> **P3 — physics, and the oracle corrected its first form.** *The reachable set of a transport is a
> property of its bind address and its listener, not of its handlers.* Write the population down —
> **and write it down even when you did not write a bind, because your framework chose one for
> you.** The first draft of this clause said "at the bind site"; the two worst exposures found in
> the sibling sweep **have no bind site**, because the default hostname of a web framework and a
> socket constructor called without a host argument both open every interface while leaving nothing
> for a reviewer or a grep to find. The population statement belongs wherever the transport is
> *started*, whether or not an address appears there.
>
> **P4 — physics.** **A system that mints its own service credential will make it broad, because
> narrowing it costs a design.** The one credential that gets scoped carefully is the one a human
> pastes; the one the program creates for itself inherits the union of everything any caller might
> need. If your platform can already mint a narrow, expiring, single-purpose handle, the service
> credential is the first place that machinery should be used and is reliably the last.
>
> **P5 — physics, and the corollary of P4.** *A credential handed to a subprocess is a credential
> handed to whatever that subprocess decides to run.* When the subprocess is a model, the model's
> reachable capability set is the credential's scope — not the tool list you advertised to it.
>
> **P6 — physics.** **An exemption placed before the check is a permission grant, and it will not
> read as one.** `if <route family> { return allow }` at the top of an authorizer is
> indistinguishable in reviews from a routing detail. Put every family through the same predicate
> and let it return "no scope required" as data, so the exemption is a row somebody can enumerate.
>
> **P7 — ergonomics, and the failure this leaf produced twice.** **Adding authentication to a
> transport is not done until every launcher of that transport has been taught the credential.**
> The launcher you will forget is your own — the third-party integration is the one you tested.
> The failure is silent in the worst direction: the door is now closed to the only caller that
> needed it, and closed doors emit nothing.
>
> **P8 — ergonomics.** **Every transport needs a ledger, and the ledger is how you learn the
> transport is dead.** A per-request audit row answers "has this ever carried anything" — a
> question no code reading can answer, and the question that distinguishes a working control from
> an unexercised one. Count the rows before you believe the gate.
>
> **P9 — security.** *A transport that can run arbitrary code inside the primary transport's
> process is not a second door; it is a master key.* Anything that evaluates caller-supplied script
> in the trusted context inherits every credential that context holds, and no per-route
> authorization on that transport can bound it. Such a transport must be absent from the artifact,
> not merely disabled by a flag.
>
> **P10 — ergonomics.** **A transport's authorization decision must be inspectable from outside
> the transport.** If the primary surface's tier vocabulary has no reader — no function a new
> router can call to ask "what does this operation require?" — then every new transport will
> invent its own scheme, and N schemes is the guaranteed outcome, not a failure of diligence.
>
> **Scale condition.** P2, P6 and P9 are correctness on day one. P1, P3 and P10 begin to bite at
> the *second* transport, which is the moment somebody adds a webhook receiver. P4 and P5 bite the
> first time a subprocess needs to call back in. P7 and P8 bite the first time somebody hardens
> something.

### Warrant evidence — the five sibling repos, censused independently

`personas-web` (Next.js · **3** inbound transports · 16 HTTP handlers), `brainiac` (Rust workspace +
a second Next.js console · **6** · ~79 REST + 18 MCP tools + 11 CLI subcommands),
`personas-cloud` (npm workspaces + a **Python FastAPI facade** · **6** · 65 orchestrator routes + 48
facade endpoints + 3 webhooks + a WebSocket), `vibeman` (Next.js + Tauri + MCP in one tree · **5** ·
**410** HTTP handlers + 75 Tauri commands + 31 MCP tools), `ascent` (Next.js + Vercel cron + a
publishable GitHub Action · **6** · 115 handlers). **All five reachable; no silence to report.**

- **P1 is convergent as a FAILURE — 5 of 5, and the mechanism is identical every time: one scheme
  per transport, added when the transport was added.** Distinct inbound auth mechanisms per repo:
  `ascent` **7**, `personas-cloud` **6**, `brainiac` (whole product) **4**, `personas-web` **1**,
  `vibeman` **0** (one, and it is broken). Coverage by the repo's own shared authorizer:
  `brainiac`'s Rust core **74 of ~79 (94%)** — the best in the fleet by a wide margin — then
  `personas-cloud` 58/64 HTTP, `ascent` ~67 RBAC call sites across 115 handlers with **19 of 92
  route files outside the family**, `personas-web` **2 of 16 (12%)**, `vibeman` **1 of 410 (0.2%)**.
  `brainiac` is the counter-example that proves the rule: `auth_of` (`http.rs:172`) is genuinely
  shared — and the moment the product grew a console it grew a passcode cookie, the moment it grew
  a signup it grew a Firebase ID token, and the moment it grew an MCP surface it grew a second
  scope table. **Personas is the sixth instance of the same shape.**
- **P2 is PHYSICS, and its strongest warrant is a sibling that solved it.** `ascent`'s
  `/api/gate/[owner]/[repo]` is unauthenticated by design (CI calls it with curl), and its fix is
  not a check — it is `noAmbientToken: true` on every ingest call, with the reason written at
  `gate/route.ts:48-53`: *"this endpoint is unauthenticated by design … Every ingest below therefore
  passes `noAmbientToken`, so a scan can never run against the … credentials."* That is this path's
  §2 rediscovered independently and stated better: **when a capability gains an unauthenticated
  transport, strip the ambient credential rather than trust the caller.** `scanRepository()` there
  has **13 call sites across 8 routes with 4 different auth postures**, and this is how they made
  that safe. It is the direct answer to §7.C.
- **P4/P5 are convergent as a defect — 4 of 5 mint a broad, long-lived service credential, and
  three hand it to something.** `brainiac`'s env-bootstrap token has `scopes: None`, which
  `auth.rs:129-132` reads as **every scope**, with no expiry, no `api_tokens` row and therefore no
  revocation — and it is the console's credential, imported by **43 modules**. `personas-cloud`
  runs one `TEAM_API_KEY` for an entire deployment plus one `WORKER_TOKEN` shared by **all**
  workers, and its Python facade holds an RLS-bypassing service-role key. `personas-web` puts the
  orchestrator team key in **`NEXT_PUBLIC_TEAM_API_KEY`**, which Next inlines into the client
  bundle. `ascent`'s ingest token is a stateless HMAC with no expiry and no revocation list, whose
  secret falls back through `ENCRYPTION_KEY` to **a hardcoded dev default**. **And the narrow
  counter-example is inside the worst offender:** `brainiac`'s device keys are minted with
  `ONBOARD_SCOPES = ["read","write"]` — *never* `admin` — hashed at rest and delivered once
  (`onboard.rs:68`, `auth.rs:143`). Both shapes, one repo. Nobody compared them either.
- **P6 is convergent — 3 of 5 exempt a route family above the check, and one has a recorded
  breach.** `brainiac`'s console returns `NextResponse.next()` for `isPublicSurface(pathname)`
  before the session check (`console/middleware.ts:35`), and the file records the exact failure this
  predicts: `GET /api/memories/<id>.txt` matched an asset-extension exclusion and *"reached the
  privileged-token proxy with no session check — leaving the route's own hex-id regex as the only
  thing between an anonymous caller and the live org"* (`:57-70`). `ascent` has
  `if (slug === PUBLIC_ORG) return true;` before the role test (`authz.ts:140`) — a whole org
  exempted from RBAC. `personas-cloud` is the subtlest and the closest to this repo's `/a2a/` case:
  its exemption is **by ordering**, six endpoints resolved and returned at `httpApi.ts:1174-1287`
  before the single auth check at `:1368`, so it is invisible to anyone who greps for the auth call.
- **A convergent variant this repo does NOT have, worth naming: the absent-config downgrade.**
  `personas-cloud/httpApi.ts:1253,:1310` — if a persona has no `webhookSecret`, the per-tenant HMAC
  boundary silently falls back to the fleet-wide team key. Same family as
  [autonomy-gating](./autonomy-gating.md)'s P2 (absence of a limit read as licence), applied to a
  transport's identity rather than its budget.
- **P7 is convergent as a failure, and the sibling evidence is sharper than this repo's.** Two
  siblings assert cross-transport agreement **in prose** and have no mechanical link to enforce it.
  `brainiac`'s MCP scope table says so out loud (`mcp.rs:228-231`): *"It MUST agree with the REST
  endpoint the tool shadows, or the same token would be allowed on one surface and refused on the
  other."* `ascent`'s `cron-auth.ts:1-6` claims to single-source three cron routes *"so the three
  handlers can't drift apart"* — **and exactly one of the three imports it**, while the other two
  re-implement it with `timingSafeEqual` and an explicit refusal of the `?key=` query channel that
  the shared helper still accepts (`cron-auth.ts:24-26`). The drift runs the wrong way: the route on
  the weaker gate is the one its own comment describes as *"mints every org's token and spends LLM
  budget."* **The recurring failure across all six codebases is not a missing check — it is a check
  that lives in a comment where an import belongs.**
- **P3 converges as a defect, and the oracle refined the clause.** `vibeman` runs `next dev` /
  `next start` with no `-H`, so **Next's default hostname is `0.0.0.0`** — and *nothing in that repo
  binds anything*, so the exposure is invisible to any grep for a bind address, sitting under 409
  unauthenticated handlers of which ten spawn processes. `personas-cloud` calls
  `new WebSocketServer({ port })` and `httpServer.listen(port)` with **no host argument** (same
  outcome, same invisibility). `ascent` publishes Postgres 5432 in compose and provisions a security
  group with `CidrIp: 0.0.0.0/0` and the comment *"public postgres (tighten later)"*. **So P3 as
  originally written — "write the population down at the bind site" — is insufficient, because the
  two worst cases have no bind site.** The clause is corrected above to require the population be
  written down *even when the framework chose the bind for you*. **Personas is the only repo of six
  that binds `Ipv4Addr::LOCALHOST` explicitly and says so in the module docstring**
  (`local_http/mod.rs:1,:51`) — and it still has two non-loopback listeners it never compared (§7.H).
- **P9 does NOT converge — mark it a house convention with a strong argument.** No sibling compiles
  a code-execution transport out of its artifact. `vibeman` ships the opposite: `/api/claude-code/execute`
  and `/api/claude-terminal/{interactive,query,stream}` drive an agent CLI, unauthenticated, among
  410 handlers, on a default `0.0.0.0` bind. Personas' `lib.rs:1574-1582` is the only instance of
  the prescribed control in six codebases. Retained in §2 because the mechanism is sound and §6
  shows it working, but an adopting repo should treat it as untested doctrine.
- **P8 was not tested and must be reported as untested.** The oracle measured auth mechanisms, not
  audit tables; no sibling's per-transport request ledger was counted. The clause rests entirely on
  this repo's own evidence — a 1-row `api_key_audit` and 0 rows with `method='MCP'` — which is a
  single instance, however sharp. **Do not cite it as convergent.**
- **P10 converges as a failure with one attempt.** `brainiac`'s `tool_scope()` (`mcp.rs:232`) is the
  only thing in six codebases that tries to make a primary transport's authorization vocabulary
  readable from a second one — and it is a hand-maintained `match` table, not a call. Personas'
  `command_tier()` is the same idea that never got a caller at all. **Two repos reached for it, zero
  achieved a mechanical link.**
- **The leaf's whole thesis, in one sibling line.** `personas-web` computes the same expensive
  aggregate-and-cache-write on two routes: `DELETE`/`POST /api/stats` behind
  `isAdminAuthorized` with `timingSafeEqual` (`stats/route.ts:377,:426,:450`), and
  `GET /api/stats?nocache=1` (`:392-397`) with **nothing** — same function, two doors, one gated.
  The gated door is the one somebody thought about.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "expose this over HTTP too" · "add an endpoint for the CLI" · "let the skill drive this from a
  terminal without the UI"
- "add an MCP tool for it" · "the agent should be able to call this"
- "receive the webhook here" · "the hook posts to us"
- "the daemon should do this without the window open"
- "mint a service key so the sidecar can call back in"
- "it's loopback-only, so it doesn't need auth"
- **If you are about to write `Router::new()`, `.route("…", …)`, `local_http::register_router(`,
  `TcpListener::bind(`, or a new arm in an MCP `call_tool` match — you are in this situation.**
- **If you are about to write a sentence of the form "X is already ungated on the IPC surface, so
  this exposes nothing" — you are in this situation and §0 is about you.**
- If you are about to call `get_or_create_system_api_key`, or add a variable to an env map that a
  spawned process will inherit, you are in this situation and §2's fourth clause is about you.

**Not this path:** choosing the tier for a `#[tauri::command]` is
[ipc-command-authorization](./ipc-command-authorization.md) — that path owns *the primary door*,
this one owns *every other door and the contract between them*. Validating a path or an id at the
boundary is [command-input-validation](./command-input-validation.md). The outbound direction —
this app calling someone else — is [outbound-http-call](./outbound-http-call.md). Whether an
unattended loop was allowed to *start* is [autonomy-gating](./autonomy-gating.md). Where the
credential lives at rest is [secret-display-and-transfer](./secret-display-and-transfer.md).
Compiling a surface in or out is [feature-flagged-compilation](./feature-flagged-compilation.md);
this path owns whether the flag is the *right* control (P9 says: for `/eval`, it is not enough).

---

## 2. The one way

**Before you open the second door, write down its population — who can address this socket — and
compare it against the population of the door that already exists; if the new population is larger,
the operation needs a credential on the new transport regardless of what tier it carries on the
old one, because a tier is a fact about a token and a population is a fact about a bind address.**
Then: **put the check in a layer, not in the handlers** — one
`middleware::from_fn_with_state(state, require_…)` on the router, the way `management_api.rs:136`
does, so a route added next year inherits it instead of needing a reviewer to notice; a per-handler
`authorize(…)?` first line (`companion_api.rs:223`) is the acceptable second-best and is what you
must use when different routes need different populations, but then every handler is a place the
line can be missing. **Route the verdict through one function that both transports call** — today
that means `ipc_auth::command_tier()` has to grow a caller, because it currently has none, and a
new router with nothing to ask is why this repo has seven bespoke schemes. **Give the transport a
credential that is scoped to what that transport does and no more**: the app already owns
`credential_broker::mint_derived_handle`, which produces an expiring, per-credential,
per-connector handle, and the fact that the *system* key holds broad `proxy` with no expiry is not
a requirement of the bridge — it is the shape nobody narrowed. **If you hand that credential to a
subprocess, its scope is the subprocess's capability set**, so scope it to the run and expire it
with the run, not with the process. **Put an exemption in the table, never above it** — a
`return Ok(())` before the scope test is a permission grant wearing routing clothes, and the one
in `authorize()` has a unit test asserting an empty scope list passes. **Audit every request on
every transport**, because the audit table is the only instrument that can tell you a transport has
carried nothing since you hardened it — this repo's holds one row. **And when you add
authentication to an existing transport, enumerate its launchers and fix every one in the same
commit**: there were two here, the third-party installer was taught the token and the app's own
sidecar writer was not, and the failure is silent because a closed door emits nothing. Finally,
**a transport that evaluates caller-supplied script inside the trusted process is not
authorizable** — `/eval` can read `window.__IPC_TOKEN` and call all 229 gated commands — so it must
be **absent from the shipped artifact**, which `lib.rs:1574-1582` correctly achieves and which no
per-route auth could have.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`engine/management_api.rs:414` — `require_api_key`, installed at `:136` via `middleware::from_fn_with_state`** | **The only router-level authorization layer in 963 Rust files, and the one site to copy.** Bearer extraction → `find_by_token` (hashed lookup, `enabled`/`revoked_at`/`expires_at` all enforced in the SQL, `external_api_keys.rs:144-177`) → per-route scope check → per-key sliding-window rate limit → identity injected into request extensions → **audit row on every outcome including the 403 and the 429**. Layered *inside* the CORS layer so `OPTIONS` preflight needs no key (`:134-135`). Everything §2 asks for, in one function. |
| **`engine/management_api.rs:335` — `authorize(&Method, path, &scopes)`** | The per-route scope table as a pure function over `(method, path, scopes)`, unit-tested at `:2457+`. Correct in shape; §7.B is about the exemption at its top and the blanket `GET ⇒ allow` at `:386-392`. |
| **`commands/fleet/companion_api.rs:223` — `authorize(app, peer, headers)`** | **The reference for a transport whose population is larger than loopback.** Guard order is the lesson: `is_lan_peer(peer.ip())` runs **first**, so an internet-exposed misconfiguration answers 403 "with zero secret-bearing computation" (`:189-191`); then bearer extraction; then `pairing::verify_token`, which digests and compares **every** stored device in constant time (`pairing.rs:124-131`); then a fixed 350 ms penalty before the 401 (`:58`, `:244`). The module docstring states the five rules in order and the code implements them in that order. |
| **`commands/fleet/companion_api.rs:73` — `start_if_paired`** · **`pairing::any_active_device`** | **The socket does not exist until a human authorized it.** The single best control in this document: a LAN listener whose *existence* is downstream of an explicit pairing ceremony, re-checked at every launch. Verified live — nothing is listening on 17500 because `fleet_companion_devices` has never been written. |
| **`engine/credential_broker.rs:130` — `mint_derived_handle(pool, credential_id, consumer, ttl)`** | The narrow credential this repo already owns and does not use for its own bridge: a fresh `external_api_keys` row scoped to exactly `proxy:credential:<id>` + `cred:<connector>:use`, with a **hard expiry** clamped into a window (`:119-123`), audit-logged against the credential, and structurally unable to mint further handles. **This is the fix for §7.C, already written.** |
| **`engine/credential_broker.rs:93` — `authorize_credential_use(scopes, credential_id, service_type)`** | Default-deny re-check inside the proxy handler, returning a typed `BrokerGrant::{Broad,PerCredential,PerConnector}` so the *reason* a call was allowed is a value, not an inference. Correct — and `Broad` is a hole only because §7.C hands out `Broad`. |
| **`mcp_server/auth.rs:61` — `authorize_tool_call(pool, token, tool_name)`** | The stdio MCP gate. Two properties worth copying: it validates against the **same `external_api_keys` registry** the HTTP surface uses rather than inventing a parallel auth system (`:9-13`), and it writes an `api_key_audit` row for **both** the 403 and the 200 (`:96-119`) — which is how §0's finding #3 became provable. Its `tool_name` argument is used only to build the audit path (`:91`); see §8.2. |
| **`src/local_http/mod.rs:36` — `register_router(prefix, router)`** · **`:53` — `start()`** | The shared loopback host: one listener, one port, `Ipv4Addr::LOCALHOST` (`:84`), late registrations refused with a warning (`:41-47`). Good infrastructure. It has **no auth layer and no CORS layer** by construction (`:69-79`), so it delegates the entire question to each registered router — three of the five decline to answer. §8.1. |
| **`src/ipc_auth.rs:622` — `wrap_invoke_handler`** · **`:107` — `is_privileged_command`** · **`:771` — `command_tier`** | The primary door, for comparison. Read `wrap_invoke_handler`'s `else { inner(invoke) }` (`:661`) before you reason about tiers: **an unlisted command is dispatched with no validation at all**, so "Public" means "no token", not "safe". `command_tier` is the vocabulary a second transport should consult — it has **zero callers outside this file**. |
| **`src-tauri/tauri.conf.json` → `app.security.csp`** + **`lib.rs:1574-1582`** | The two controls that actually bound the two most dangerous surfaces. CSP (no `unsafe-eval`, no `unsafe-inline` in `script-src`) is what makes "code in our webview" a real boundary rather than a hope. `lib.rs:1574-1582` compiles the test-automation bridge out of release *and* logs a warning when `PERSONAS_TEST_PORT` is set in a release build — the correct answer to a P9 transport, with the ship-loop audit date in the comment. |

**Do not exist — this path names them:**

- **A transport registry.** Nothing enumerates the app's listeners. Five `axum::serve` sites, one
  QUIC endpoint, thirteen `Router::new()`s, and no place a reviewer can read the list. §9's rule is
  a proxy for it; `ipc-command-authorization` §9 item 3 specified the typed version and it has not
  been built.
- **A caller for `command_tier`.** The tier vocabulary is unreadable from outside `ipc_auth.rs`, so
  a new router has nothing to ask. Seven independent auth schemes is the arithmetic consequence.
- **A scoped bridge credential.** `get_or_create_system_api_key` is the only door; there is no
  `mint_run_scoped_bridge_key(execution_id, credential_ids)`, so the runner takes the broad one.
- **Any rate limit outside the management API.** `API_KEY_RATE_MAX` (`management_api.rs:274`)
  applies to the HTTP surface; the stdio MCP surface validates **the same key material** with none
  (`auth.rs:61-121`), and `dev_tools_http` / `hooks` / `push` have neither auth nor limit.
- **Any body-size or timeout layer on `local_http`.** `webhook.rs:75` caps bodies at 1 MB;
  `local_http`'s five routers have **zero `.layer(` calls between them**.

---

## 4. Steps

1. **Write the population down, at the bind site, before anything else.** Loopback → "every
   process on this machine, including any subprocess we spawn and anything the user installed".
   `0.0.0.0` / `[::]` → "every host on every network this machine is attached to". A `#[cfg]` flag
   → "…in builds carrying that flag", which is a *smaller* claim than "not in production" and must
   be written as such. Put the sentence in the module docstring the way `companion_api.rs:9-27`
   does.
2. **Compare populations, not tiers.** If the new population is larger than the primary
   transport's, the operation needs a credential here even if it is ungated there. Do not write
   the sentence in §0. If the populations are genuinely identical, say *why* in the same comment.
3. **Put the check in a layer.** `middleware::from_fn_with_state(state, require_…)` on the router,
   applied **inside** any CORS layer so preflight is not gated. Per-handler `authorize(…)?` only
   when routes need different populations — and then it is the first statement of every handler,
   with no exceptions, because "the handler that forgot" is invisible.
4. **Order the guards cheapest-and-least-secret first.** Peer address, then credential presence,
   then constant-time comparison, then a fixed delay on failure. `companion_api.rs:223-248` is the
   shape.
5. **Scope the credential to the transport, and to the run if a subprocess holds it.** Reach for
   `mint_derived_handle`, not `get_or_create_system_api_key`. If it goes in an env map, it goes to
   every descendant process; if it goes in a config file, it goes to whatever reads that directory.
6. **Ask the type question now, before §9.** The answer for this leaf is below and it is a *yes*
   with a named shape — see "Type over gate".
7. **Audit every request, both outcomes.** One row per allow and per deny, with a method token that
   distinguishes this transport from the others (`AUDIT_METHOD = "MCP"`, `auth.rs:38`). Then
   **query the table** and confirm the transport has carried something. This step is what turns
   §0's finding #3 from a code-reading hypothesis into a fact.
8. **Enumerate the transport's launchers and fix all of them in the same commit.** Grep the
   credential's env-var name across the whole tree; every writer must appear. Here that grep
   returns six hits and **five of them are inside the transport's own module** — the sixth is the
   third-party installer, and the app's own sidecar writer is absent.
9. **If the transport can run caller-supplied code in the trusted process, compile it out.** A
   feature flag plus an explicit refusal-and-warn in the release path (`lib.rs:1574-1582`), not a
   runtime toggle, not a setting.
10. **And then stop.** The credential's shape at rest belongs to
    [secret-display-and-transfer](./secret-display-and-transfer.md); the tier of the underlying
    command to [ipc-command-authorization](./ipc-command-authorization.md); whether an unattended
    loop was allowed to start to [autonomy-gating](./autonomy-gating.md); path containment on the
    argument to [filesystem-boundary](./filesystem-boundary.md). Re-deriving any of them at the
    router is how seven schemes became seven schemes.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and unusually cleanly for a security leaf — because the thing to make unrepresentable is not
the authorization decision, it is the *unclassified router*.**

The census rule in §9 counts routes that need no credential. A type would stop them being
registered. `local_http::register_router(prefix: &str, router: Router)` (`local_http/mod.rs:36`)
takes a bare `Router` and therefore accepts anything; the five call sites in `lib.rs:963-990` pass
five routers with five different (or absent) auth stories and the signature records none of it.
Change it to:

```rust
pub enum TransportAuth {
    Layered,                        // the router carries its own middleware
    PerHandler(&'static str),       // named function every handler calls first
    None(&'static str),             // required prose reason
}
pub fn register_router(prefix: &str, auth: TransportAuth, router: Router)
```

**Q1 (a required prop carries only what it encodes):** it encodes *that a decision was made*, not
that the decision is right — a `None("loopback only")` is still registerable. That is the honest
limit, and it is exactly why the gate stays as the ratchet.
**Q3 (a type nobody constructs constrains nothing):** there are **5** construction sites, all in
one `lib.rs` block, plus 13 `Router::new()`s. Small, enumerable, and every one is reachable in a
single edit — this passes.
**Q4 (a type anyone can construct authenticates nothing):** `None` is public by design, so the type
does not *enforce*; it *forces a sentence into the diff*. Combined with the `assert!` in §9 that
every `None` reason is non-empty, that is the same trade the census's `exclude.reason` makes and it
has held.
**Q5 (withholding beats requiring):** the stronger variant withholds the unguarded construction
entirely — `register_router` takes a `AuthedRouter` produced only by
`layered(router, middleware)` or `unauthenticated(router, reason)`. Then the bare `Router` never
reaches the mount, which is the `build_ssrf_safe_client` shape from
[outbound-http-call](./outbound-http-call.md) §3 that measured 8/8.
**Where the type cannot reach:** `test_automation.rs` and `webhook.rs` call `axum::serve` directly
and never touch `register_router` (2 of 5 listeners), and `companion_api.rs` has its own
`ensure_started`. So the type covers **3 of 5 listeners and 34 of 130 routes**. The other two need
the same treatment at their own `serve` sites, and until they get it a count is the only instrument
that sees them. **This is the case the doctrine describes: a real type answer that does not reach
the whole condition, so ship both.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **"It's already ungated on the primary surface, so this adds nothing"** | The tier describes a token, not a population. `dev_tools_http.rs:6-8` is the measured instance: true premises, false conclusion, **31 unauthenticated routes in release** including a spawn of a Claude subprocess at a caller-chosen path. |
| **"It's loopback-only, so it doesn't need auth"** | Loopback is "every process on this machine". `push.rs:11-12` states it and draws the wrong conclusion in the next sentence — *"no nonce gate in v1 because no remote actor can reach the endpoint. A future hardening pass can layer per-app tokens on top."* |
| **An exemption `return Ok(())` above the scope test** | Reads as routing, functions as a grant. `management_api.rs:338-340` exempts `/a2a/`, which executes personas, and `:2457` tests the exemption with an empty scope list. |
| **`GET ⇒ allow` as a scope rule** | `management_api.rs:386-392`: any authenticated key, at any scope, may call **every** `/api/*` GET. A `handle:<consumer>` broker handle scoped to one credential can list personas, list executions, read lab run status and read every execution's output. |
| **A service credential with the union of every caller's needs** | `get_or_create_system_api_key` grants `proxy` — `BrokerGrant::Broad` for every credential in the vault (`credential_broker.rs:98-99`) — with no expiry, to a bridge whose actual need is 5 Google connector tools. |
| **Putting that credential in an env map** | Every descendant process inherits it. `lib.rs:1744-1745` exports it process-wide; `cli_mcp_config.rs:183-192` writes it into a config file in a **reused** temp dir. `scrub_mcp_sidecar` is correct and runs on every exit path — and the docstring's word for the key, "short-lived", is contradicted by `management_api.rs:587`. |
| **Hardening a transport without enumerating its launchers** | `PERSONAS_MCP_TOKEN` has one writer (`install.rs:79`) and two launchers. The app's own launcher was not taught it. Nothing failed loudly; the gate simply never returned Allow — **0 `method='MCP'` audit rows, ever.** |
| **Believing a gate works because the code reads correctly** | The only instrument that distinguishes "gate holds the line" from "gate has never been reached" is the ledger. This app's is one row deep. |
| **A `#[cfg]` flag as the control on a code-execution transport** | Correct here (`lib.rs:1574-1582`) *and* the reason it must be the control: `/eval` runs `webview.eval(&req.js)` (`test_automation.rs:335`) in the trusted context, so it can read `window.__IPC_TOKEN` and call all 229 gated commands. No per-route auth on that server could bound it. It is listening on this machine right now (17320, HTTP 200) because this is a debug build. |
| **A second dispatcher over the same tool set with its own allowlist** | `http_engine/tools.rs:191` calls `mcp_server::tools::call_tool` **directly**, bypassing `authorize_tool_call`, and substitutes `REMOTE_SAFE_MCP_TOOLS` (18 names) + `CONNECTOR_TOOLS` (5, opt-in) at `http_engine/config.rs:46-70`. Both designs are defensible; having both means "may this tool run" has two answers computed from different inputs. |
| **An in-memory token map compared with `HashMap::get`** | `companion/orchestration/mcp/mod.rs:106-109` — not constant-time, unlike `ipc_auth.rs:668` and `pairing.rs:124`. Same repo, three token comparisons, two of them hardened. |
| **Auditing per *connection* instead of per *request*** | The stdio MCP server audits per call (right). Nothing else outside `management_api` audits at all — `dev_tools_http`, `hooks`, `push`, `test_automation`, `companion/orchestration/mcp`: **0 audit writes.** |

---

## 6. Evidence

### The one site to copy: `src-tauri/src/engine/management_api.rs:414` — `require_api_key`

It is the only place in 963 Rust files where a transport's authorization is a **layer** rather than
a habit, and it discharges every clause of §2 except the two in §7.B:

- **Layered, so new routes inherit it.** `middleware::from_fn_with_state(state_arc, require_api_key)`
  at `:136`, applied *inside* the CORS layer with the reason written down at `:134-135` so `OPTIONS`
  preflight is not gated.
- **Authentication and authorization are separate steps.** `find_by_token` establishes identity;
  `authorize(&method, &path, &scopes)` establishes permission; a key that authenticates but lacks
  the route's scope gets **403, not 401**, and the distinction is logged (`:446-456`).
- **Revocation, expiry and disablement live in the SQL, not in a caller.**
  `WHERE key_hash = ?1 AND enabled = 1 AND revoked_at IS NULL` plus an `is_expired_at` filter
  (`external_api_keys.rs:158-165`) — there is no path that forgets one of the three.
- **Per-key rate limit** (`:459-471`) returning a `Retry-After` response rather than an error.
- **Identity is handed forward as a value** — `AuthedApiKey { id, name, scopes }` in request
  extensions (`:476-480`), never token material, so the credential-bearing handlers can
  *exactly* authorize and attribute without re-parsing anything.
- **Audit on every outcome**, including the 403 and the 429 (`:454`, `:469`, `:482-489`).
- **CORS is a real control here, not decoration.** The comment at `:139-150` explains why
  `allow_origin(Any)` would weaponize a leaked bearer token from any browser tab, and the predicate
  restricts to the app's own webview origins plus user-paired ones.

**Also exemplary:**

- **`commands/fleet/companion_api.rs` in full** — the reference for a transport whose population is
  larger than loopback. The docstring numbers its five rules; the code implements them in that
  order; the socket does not exist until a human paired a device (`start_if_paired:73`); the
  projection is deliberately data-poor (*"NO PTY bytes, no transcripts, no cwd paths, no
  credentials"*, `:24-27`); the action surface is an allowlist of exactly five verbs; every act is
  appended to a ledger with the device id. **If you must open a LAN socket, copy this file.**
- **`lib.rs:1560-1583`** — the release-mode refusal for the test-automation bridge, with its reason
  (`"/eval (arbitrary JS in the webview) and /list-credentials"`) and its audit date in the comment,
  and a `tracing::warn!` when the env var is set in a build that ignores it. The right control for
  a P9 transport, and it says so.
- **`mcp_server/auth.rs:1-24`** — the docstring is the best short statement of this leaf's subject
  anywhere in the tree: *"Spawning `personas-mcp --db-path <path>` hands the caller full persona
  CRUD + execute AND vault-connector reads through the credential bridge. That is a
  privilege-escalation surface identical in blast radius to the HTTP management API — but until now
  the stdio transport had **zero** auth."* It then reuses the existing registry rather than
  inventing a parallel one. The only thing missing is step 8.
- **`cloud/remote_commands.rs:219-290`** — the inbound cloud path, and the best-defended door in
  the app. Poll-only (the poller emits a Tauri event and never calls the engine, `:127-163`),
  device-scoped, UUID-validated before the PostgREST filter is built (`:219-223`), status- and
  type-checked, and claimed atomically with `PATCH …&status=eq.pending` returning a row count so a
  double-approve cannot double-bill (`:280-290`). Both `remote_command_approve` and
  `remote_command_reject` are `#[requires(cloud)]` **and** listed in `CLOUD_COMMANDS`, so the
  caller has presented an IPC token *and* a live OAuth token. A human click is mandatory and there
  is no autopilot on this path.

### The transport census, exactly

Every inbound surface in the tree, with its bind, its population and its check:

| Transport | Bind | Routes / tools | Auth | Shipped in release | Audited |
|---|---|---:|---|---|---|
| **Tauri IPC** | in-process | 1,585 registered | `x-ipc-token` for **229**; **1,356 dispatched unchecked** (`ipc_auth.rs:661-662`) | yes | no |
| `management_api` | `127.0.0.1:9420` | 29 | **layer** — bearer + scope + rate limit | yes | **yes** |
| `webhook` | `127.0.0.1:9420` | 6 | per-trigger HMAC/URL secret; `/health` open | yes | `webhook_request_log` (**0 rows**) |
| `pairing` (engine) | `127.0.0.1:9420` | 2 | nonce + human approval — the ceremony *is* the gate | yes | — |
| `share_link` | `127.0.0.1:9420` | 1 | short-lived URL token | `p2p` builds | — |
| **`dev_tools_http`** | `127.0.0.1:17400` | **31** | **none** | **yes** | **no** |
| **`fleet/hooks`** | `127.0.0.1:17400` | **1** (5 events) | **none** | **yes** | no |
| **`project_tracking/push`** | `127.0.0.1:17400` | **1** | **none** | **yes** | no |
| `browser_bridge` | `127.0.0.1:17400` | 2 | pairing token + session token, per handler | yes | no |
| `companion/orchestration/mcp` | `127.0.0.1:17400` | 1 route / 4 tools | `X-Athena-Session`, `HashMap::get` (not constant-time) | yes | no |
| `companion_api` (LAN) | **`0.0.0.0:17500`** | 10 | LAN-peer → bearer → constant-time device match | yes, **but only after pairing** | `fleet_decisions` |
| `test_automation` | `127.0.0.1:17320` | **46**, incl. `/eval` | **none** | **no** — compiled out (`lib.rs:1574-1582`) | no |
| `personas-mcp` (stdio) | stdin/stdout | 33 tools | capability token, **1 check for all 33** | yes (bundled binary) | **yes** (`method='MCP'`) |
| `http_engine` in-process MCP | none | 33 tools | **bypasses the gate**; name allowlist instead | yes | no |
| P2P / QUIC | **`[::]:4242`** | `remote_instruct` + job wire | `owned_devices` row | **yes, auto-starts** (`lib.rs:1784`) | `remote_jobs` (**0 rows**) |
| `personas-daemon` | none | — | **none**; calls `runner::run_execution` directly | **no** — `daemon` feature in no build config or workflow | — |
| cloud relay pollers | outbound poll | 2 | user's OAuth; **no per-firing consent** | yes | — |
| `cloud/remote_commands` | outbound poll | 1 | mandatory human click; Cloud-tier approve/reject | yes | — |

**Zero of these consult `ipc_auth::command_tier` or `is_privileged_command`** — measured: those two
identifiers occur **28 times in exactly 1 file** of 963, and that file is `ipc_auth.rs`. That is
the mechanical reason there are seven schemes rather than one: a new router has nothing to ask.

**And `:9420` serves two different route sets depending on a startup race.**
`background.rs:868-887` calls `start_webhook_server_with_management` when
`app.try_state::<Arc<AppState>>()` resolves and falls back to `start_webhook_server` — **webhook
routes only, no management API** — when it does not. Same port, same client, 29 routes present or
absent, and the only signal is that `/api/personas` answers **404 instead of 401**. Nothing logs
which server you got. The fallback is a reasonable resilience choice; that it silently changes the
transport's surface is the finding.

### What each transport has actually carried — from the live databases

Read-only copies, 2026-08-16:

- **`external_api_keys`: 1,021 rows. Every one named `system`.** 730 with
  `["personas:read","personas:execute"]`, 291 with `proxy` added. **Exactly 1 live** (minted
  2026-08-16 03:00, this process's). **1,014 have never been used**; the 7 that have were used
  between 2026-05-25 and 2026-05-26. **Zero user-minted keys** — the "external tools" audience the
  management API was built for has never existed on this install, while the key the app mints for
  itself is handed to every persona run.
- **`api_key_audit`: 1 row, ever.** `POST /api/scrape/readable` → 200, 2026-07-08, origin
  `http://localhost:1420` (the dev frontend). **That route is no longer in the router.** So the
  management API has authenticated one request in the app's recorded history, and it came from the
  app's own webview.
- **`api_key_audit` rows with `method = 'MCP'`: 0.** `authorize_tool_call` writes one on every
  Allow (`auth.rs:111-119`). The stdio gate has never returned Allow.
- **`persona_executions`: 2,188 rows**, all `created_at ≤ 2026-06-26`. **773 `mcp__personas__*`
  tool steps across 317 of them, spanning 2026-06-03..2026-06-26** — entirely before the auth gate
  landed on 2026-07-16. **0 after.** *(And no execution has run since 2026-06-26, so the post-gate
  behaviour is provable from source but has never been observed. Stated as a latent break, not an
  observed outage — see §12.)*
- **`webhook_request_log`: 0 rows. `remote_jobs`: 0 rows.** Two transports built, shipped, and
  never once exercised.
- **`app_settings`: 32 rows**, including `browser_bridge_pairing_token` and **not** including
  `fleet_companion_devices` — so the LAN listener has never had a reason to start, which the live
  probe confirms.

### The measurement that disagreed — and the implementation that was wrong

Two independent counts of route registrations disagreed by 3. A ripgrep for `route\(` returned
**133** across 11 files; the census pattern `\.route\(\s*"` returned **130**. Hand-verification
found the three extras are all in `dev_tools_http.rs` and are **function definitions**, not
registrations: `kpi_scan_prompt_route(` (`:563`), `consolidate_contexts_route(` (`:713`),
`repair_cross_refs_route(` (`:773`) — three handlers whose names happen to end in `_route`. The
loose pattern was the wrong one.

A third check closed the opposite risk: `.route(` occurs **130** times and `.route("` occurs **130**
times, so no route in this tree is registered with a non-literal path, and the quote in the pattern
costs no recall. `.nest(` = 1 (the `local_http` mount), `.fallback(` = 0, `.route_service(` = 0.

### The oracle — the numbers behind the head

Full clause-by-clause warrants are under the principle head. The ranking table, because it is what
an adopting repo should read first:

| Repo | Distinct inbound auth mechanisms | Entry points behind its own shared authorizer | Same capability on ≥2 transports with different checks |
|---|---:|---|---|
| `brainiac` (Rust core) | **1** | **74 / ~79 = 94%** | **No** — `preflight()` on REST + MCP + CLI, all resolving to `"read"` |
| `brainiac` (whole product) | 4 | Rust 94%; console **0 / 13** in-handler (matcher only) | Yes — the console holds an all-scopes token; `/signup` is on the public path |
| `ascent` | **7** | ~67 RBAC call sites / 115 handlers | Yes — `scanRepository()` at 13 sites / 4 postures (**mitigated**, see P2); cron gate at 2 impls (**open**) |
| `personas-cloud` | 6 | 58 / 64 HTTP; **0 / 3** facade-direct | Yes ×4 — `db.publishEvent` behind three different trust models, one of which stamps **no tenant at all** |
| `personas-web` | 1 (+1 borrowed) | **2 / 16 = 12%** | Yes ×2 — `?nocache=1` vs `DELETE`; two SSE proxies holding the team key with no caller check |
| `vibeman` | **0** (1 broken) | **1 / 410 = 0.2%** | Yes, systemically — **10 self-documented** Tauri↔HTTP duplications plus a 31-tool MCP wrapper, all at zero auth |
| **Personas** | **7** | IPC: `wrap_invoke_handler` reaches **229 / 1,585 = 14.4%** by design; HTTP: **0 / 130 routes** consult it | Yes — §7.A, §7.B, §7.E |

`vibeman` is the instructive extreme and it is instructive because the duplication is *written
down*: ten Tauri command modules carry a `//! Replaces: /api/…` header (`git_server_cmds.rs:3`,
`brain_cmds.rs:3`, `conductor_cmds.rs:3`, `fs_cmds.rs:3`, `lifecycle_cmds.rs:3`, `misc_cmds.rs:3`,
`social_cmds.rs:3`, `triage_cmds.rs:4`, `ideas_cmds.rs:3`, `claude_cmds.rs:281`) and **every named
route family still exists**. The migration was additive; every capability has two or three doors;
the checks "agree" only by being absent on all of them. Its one guard accepts any header value
containing the substring `Bearer` (`admin/circuit-breaker/route.ts:45`).

**The transferable finding, and it is not a count.** Across six codebases the recurring failure is
never an author who forgot to check. It is a **check asserted in prose where an import belongs** —
`tool_scope` "MUST agree" with `auth_of`; `cron-auth.ts` exists "so the three handlers can't drift
apart" and is imported by one of them; `dev_tools_http.rs:6-8` reasons from a tier to a population.
Three repos, three comments, three drifts. That is the argument for §4's type and for §9's ratchet:
both replace a sentence with something a machine reads.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every defect below reduces to one absence:
> **there is no place to ask what an operation requires.** `command_tier()` (`ipc_auth.rs:771`)
> is the vocabulary, and it has no caller outside its own file. A new router therefore has three
> options — invent a scheme, copy a neighbour, or reason from the tier by hand — and the tree
> contains one instance of each. Give `command_tier` a public consumer and most of §7.A/B/E
> becomes a call rather than a judgement.

### 7.A — P0: 33 routes are reachable in a shipped build with no credential, and one of them spawns a subprocess at a caller-chosen path

| Route | What it reaches |
|---|---|
| `POST /dev-tools/projects` (`dev_tools_http.rs:468`) | Registers a dev project with **any `root_path` string**, unvalidated |
| `POST /dev-tools/scan-codebase` (`:501`) | → `launch_context_scan` (`context_generation.rs:601`) → **`spawn_headless_claude` (`:1223`)** with `exec_dir = PathBuf::from(root_path)` (`:1222`). Only check: `root_dir.is_dir()` (`:650`) |
| `POST /dev-tools/scan-kpis`, `/scan-use-cases` | Two more headless CLI spawns |
| `POST /dev-tools/export-context-map` | → `write_context_map_artifacts` — **rewrites `context-map.json` and `CLAUDE.md` on disk** |
| `POST /dev-tools/retire-contexts`, `/dedupe-contexts`, `/dedupe-context-groups`, `/prune-nonsource-contexts`, `/merge-context-groups`, `/consolidate-contexts` | Six destructive context mutations |
| `POST /dev-tools/kpi-decision`, `/kpi-update`, `/kpi-rebind`, `/use-case-decision`, `/patterns/propose`, `/kpi-sim/ingest` | Six write doors into the Factory data model |
| `GET /dev-tools/projects`, `/contexts/…`, `/kpis/…`, `/use-cases/…`, `/patterns/…` (**13 GET-serving paths and 19 POST-serving — 32 method handlers on 31 registrations**; this cell said "15 reads" until 2026-08-17, understating the write side, corrected by [inbound-endpoint-surface](./inbound-endpoint-surface.md)) | **Verified live: 200, 11,672 bytes, no credential** |
| `POST /fleet/hooks/{event}` (`hooks.rs:37`) | Mutates fleet session state from an unauthenticated body; the URL path is the event selector |
| `POST /project-tracking/cli-event` (`push.rs:54`) | Injects an event and forces an out-of-cadence consolidator run (LLM spend), debounced at 5 min/project |

All three routers are registered unconditionally at `lib.rs:963-990` and mounted on `local_http`,
which binds `127.0.0.1` and applies **no layer of any kind** (`local_http/mod.rs:69-79`).
**`grep -c '\.layer('` over these four files returns 0, 0, 0, 0.**

**Fix, cheapest first:** (a) a `middleware::from_fn` on `dev_tools_http`'s router requiring the
same bearer the management API takes — the key registry, the audit table and the rate limiter all
already exist and are already reachable from this process; (b) validate `root_path` through
[filesystem-boundary](./filesystem-boundary.md)'s containment predicate rather than `is_dir()`;
(c) the §9 rule as the ratchet so a fourth unauthenticated router cannot appear silently.

### 7.B — P0: the management API's scope check has two holes, and one is unit-tested

**1. `/a2a/` and `/agent-card/` are exempt from all scope checks** (`management_api.rs:338-340`),
and `POST /a2a/{id}` `message/send` reaches `run_persona_synchronous` — *"the same path used by
`/api/execute`"* (`:1731-1732`). `/api/execute/{id}` requires `personas:execute` or
`execute:persona:<id>` (`:378-385`). The A2A door requires only a valid key. The test at `:2457`
asserts an **empty scope list** passes, so the exemption is not drift — it is codified.

The consequence is concrete because the repo mints exactly the narrow key this exempts:
`mint_derived_handle` produces `["proxy:credential:<id>", "cred:<connector>:use"]`
(`credential_broker.rs:148-151`) with the stated intent that *"a derived handle must never be able
to mint further handles"* (`management_api.rs:349-351`). It cannot mint handles. It **can** execute
any exposed persona.

**2. `GET ⇒ allow` for every remaining `/api/*` route** (`:386-392`). Any authenticated key, at any
scope, may read the persona list, the execution list, any execution's full record, lab run status
and results, and the two automation-settings endpoints. The `gateway_exposure` filter that protects
`/a2a/` reads (`find_by_id_if_exposed`) is **not** applied on the `/api/personas` path.

**Fix:** move both into the table as data — `("/a2a/", ScopeRequirement::None("A2A spec: the agent
card is the discovery surface"))` — so an exemption is a row an auditor can enumerate, and give
`/a2a/message/send` the same `personas:execute` requirement its twin has.

### 7.C — P1: the app mints itself the broadest credential it can and gives it to every persona run

`get_or_create_system_api_key` (`management_api.rs:570-611`) creates one key with
`["personas:read", "personas:execute", "proxy"]`, `None` expiry, `None` origin, `None` label. Broad
`proxy` returns `BrokerGrant::Broad` for **every credential id** (`credential_broker.rs:98-99`),
after which the proxy handler decrypts that credential's fields. So the key is functionally *use
any secret in the vault over loopback*.

It is then: exported into the app's own process environment (`lib.rs:1744-1745`), inherited by
every child process the app spawns; fetched by the runner on **every** execution
(`runner/mod.rs:1161-1162`); and written **in plaintext** into
`exec_dir/.claude/personas-mcp-config.json` (`cli_mcp_config.rs:183-192`), in a stable reused
per-persona temp dir. The scrub machinery is genuinely good — `scrub_mcp_sidecar` on every exit
path plus a pre-write sweep of a stale copy (`:167`, `:287-352`) — which is the right mitigation
for a problem that should not exist.

Two smaller facts make the shape legible. `cli_mcp_config.rs:181` calls it "this short-lived system
API key"; `management_api.rs:587` says "The system key never expires". And the actual need is five
Google connector tools plus one scraper route — a `mint_derived_handle` with the run's credential
ids and a TTL clamped to the run would cover it exactly, using machinery already in the file next
door.

**Live evidence of the accumulation:** 1,021 rows, all named `system`, 1,014 never used. Each app
launch revokes the previous ones (`:581-585`) and mints a new one — correct hygiene producing a
1,021-row audit trail of a credential nobody outside the app has ever presented.

### 7.D — P1: hardening the MCP transport disarmed the app's own use of it

`PERSONAS_MCP_TOKEN` appears in **6** places across the whole tree, and **five are inside
`mcp_bin.rs` / `mcp_server/`**. The sixth is `install.rs:79` — the third-party client installer.
The runner's own sidecar writer builds its env map at `cli_mcp_config.rs:171-234` and its args at
`:240-246`, and sets neither the var nor `--token`. `mcp_bin.rs:78-84` therefore resolves
`token = None`, and `mcp_server/mod.rs:101-109` rejects every `tools/call` with `-32001`.

The data corroborates from the other side: `authorize_tool_call` writes a 200 audit row on every
Allow, and **`api_key_audit` contains zero rows with `method = 'MCP'`** in 1,021 keys and 2,188
executions.

This is the exact mirror of [ipc-command-authorization](./ipc-command-authorization.md) category A.
There, an annotation without a list entry fails **open** and silently. Here, a gate without a
launcher update fails **closed** and silently. Both are invisible at the call site; both were
introduced by someone doing the right thing; and neither has any instrument pointed at it. The
difference is only which direction the silence runs.

**Fix:** pass a run-scoped token in the same map that already carries `PERSONAS_API_KEY`, and add
an assertion to the sidecar test suite that the written config's `env` contains every var
`mcp_bin.rs` reads. **Better fix:** make `install_mcp_sidecar` take a typed `SidecarCredentials`
struct with a field per var the binary reads, so omitting one is a compile error rather than a
silent `-32001`.

### 7.E — P1: the same 33 MCP tools have two authorization models, and one of them is a name list

`http_engine/tools.rs:191` (`mcp_call_text`) calls `mcp_server::tools::call_tool(name, args, pool)`
**directly**, never reaching `authorize_tool_call`. Its substitute is
`REMOTE_SAFE_MCP_TOOLS` — 18 names, including the write tool `post_message` — plus `CONNECTOR_TOOLS`
(5, behind the `qwen_connector_tools` setting), gated by `tool_allowed`
(`http_engine/config.rs:46-70`). The reasoning is written down and it is sound: *"a prompt-injected
remote model must not be able to trigger them."*

The defect is not either design; it is that **"may this tool run" is now computed from two
different inputs** — a capability token's scopes on one path, a compile-time name list on the other
— and adding a tool updates only one of them. The 34th tool will be reachable from the remote
engine if somebody adds its name, and from stdio if somebody holds a token, and nothing reconciles
the two.

### 7.F — P2: the authorization check is a single bit for 33 tools with 8 writes

`authorize_tool_call` takes `tool_name` and uses it **only to build the audit path string**
(`auth.rs:91`); it never branches on it (`:61-121`). One `personas:execute` token grants all 33
tools: `personas_execute` (queues a real execution), `personas_create`, `personas_set_model`
(repoints a persona at a different paid model), `drive_write_text`, `obsidian_vault_write_note`
(writes into the user's Obsidian vault, outside the drive sandbox), `post_message`,
`personas_annotate`, `llm_delegate`, plus five credential-bearing connector calls that route
through the broad-`proxy` bridge. **A token minted for "list my personas" is the token that can
launch executions and spend credentials.**

Also: `tools/list` and `initialize` are answered **without a token** on both MCP surfaces
(`mcp_server/mod.rs:85-94`; `companion/orchestration/mcp/mod.rs:250-255`), which is a deliberate,
documented choice (so a client can render a readable auth error) with the side effect of
disclosing the full inventory and schemas to any unauthenticated caller.

### 7.G — P2: `companion_mcp_resolve_request` is the release valve for approvals, and it is Public

`commands/companion/mcp_bridge.rs:26-34` — the command the frontend calls to resolve a blocking
`athena.request_approval` — calls `crate::ipc_auth::require_auth(&state)`, a documented no-op
(`ipc_auth.rs:537-539`), and is **absent from `PRIVILEGED_COMMANDS`**. So the approval gate's
strength rests entirely on webview integrity, not on the privileged tier. The MCP surface itself is
clean here — its 4 tools contain no resolve verb (`orchestration/mcp/handlers.rs:113-119`), and the
unattended watchdog can only ever resolve an approval with `{"approved": false}`
(`night_shift/unattended.rs:83,:221`), an invariant stated at `handlers.rs:292`. The hole is on
the primary transport, found by asking the second transport's question.

### 7.H — P2: two non-loopback listeners, with opposite postures

| | `companion_api` | P2P transport |
|---|---|---|
| Bind | `0.0.0.0:17500+` (`companion_api.rs:99`) | **`[::]:4242` dual-stack UDP** (`p2p/transport.rs:41-54`) |
| Starts | only when a device is paired (`start_if_paired:73`) | **unconditionally, 3 s after boot** (`lib.rs:1784-1805`) |
| In shipped builds | yes | **yes** — `desktop-full = ["desktop","ml","p2p"]` (`Cargo.toml:57`), selected by `tauri.conf.json` and `tauri.stable.conf.json` |
| Peer check | `is_lan_peer` **first**, before any token work (`:189-203, :228`) | none — reachability is the network's problem |
| Credential | bearer → constant-time device match | an `owned_devices` row (`p2p/remote_jobs.rs:221`) |
| Action surface | **5 verbs**, allowlisted, audited to `fleet_decisions` | `remote_instruct` runs a **full-op-set** Athena turn, explicitly no deny-list (`companion/remote_jobs.rs:20-32`) |
| Live | not listening (no pairing) | not listening (this is a `lite` dev build; a `desktop-full` build would be) |

The asymmetry is the finding: the transport with the careful docstring, the five-verb allowlist,
the ledger and the pairing precondition is the one that is **off**; the transport that auto-starts
in production hands a paired peer the whole operation set. Neither is wrong in isolation. Nobody
compared them.

**And the P2P side's safety argument has already decayed under it, which is P1 in miniature.**
`companion/remote_jobs.rs:22-32` explains why remote instruction needs no deny-list, and the
argument rests on borrowed controls: *"Everything that constrains Athena locally still constrains
her here, unchanged and unduplicated: approval rows for anything gated, **`AUTOAPPROVE_ALLOWLIST`**
+ the boldness matrix under autonomous mode, `validate_fleet_cwd` on every spawn, the role caps."*
**`AUTOAPPROVE_ALLOWLIST` was deleted on 2026-08-10** — deliberately, with the operator's explicit
call and a careful historical note in its place (`approval_autopilot.rs:10-30`), which enumerates
the three bounds that survive. Nothing pointed the second transport at that note. The local change
was reasoned and documented; the remote transport that had cited it as its own justification was
not in the blast radius anyone drew, because **a borrowed control leaves no reference the deleter
can follow.** Six days, one repo, two files.

### 7.I — P3: what this path cleared

Reported because a path that lists only defects mis-sets priors:

- **The cloud inbound path is the best-defended door in the app.** §6 details it. Poll-only,
  device-scoped, UUID-validated, atomically claimed, Cloud-tier on both approve and reject,
  mandatory human click with a 450 ms anti-misclick arm delay
  (`src/features/cloud/RemoteApprovalPrompt.tsx:149-152`), and no autopilot. Its one asymmetry is
  that `remote_command_reject` omits the device filter its sibling documents as essential
  (`remote_commands.rs:344-347` vs `:240-248`) — self-DoS only, same tenant.
  **Cleared 2026-08-17 by [cross-device-pairing](./cross-device-pairing.md): the device filter is
  now present, at `remote_commands.rs:377`.** The asymmetry is closed and the door is now
  symmetric on both approve and reject. Recorded rather than quietly dropped — a register that
  only accumulates is a register nobody trusts.
- **The daemon is not shipped.** `daemon = ["desktop-full"]` (`Cargo.toml:90`) appears in **no**
  `tauri*.conf.json`, no `package.json` script and no workflow. It remains a zero-auth full
  execution runtime on the live DB and keychain if anyone builds it — `daemon/runtime.rs:202` calls
  `runner::run_execution` directly — but it is opt-in source, and it starts **no** listener.
- **The test-automation bridge is correctly compiled out of release**, with the reason and the
  audit date in the comment (`lib.rs:1574-1582`), and a warning when the env override is set in a
  build that ignores it. This is the right answer to a P9 transport.
- **The frontend module that minted a system bearer token for `:9420` is gone.**
  `src/lib/managementApiAuth.ts` does not exist at `d74fae3c9`; it had zero callers when deleted.
  The Rust side is still listening, and §7.B/C are what is on it.
- **`webhook.rs` caps request bodies at 1 MB** (`:69,:75`) — the only body limit on any transport.

---

## 8. Gaps in the primitive

1. **`local_http::register_router` cannot ask for an authorization story.** Its signature is
   `(prefix: &str, router: Router)` (`local_http/mod.rs:36`), so the five call sites in
   `lib.rs:963-990` register five routers with five different (or absent) postures and the mount
   point records none of it. This is upstream of 7.A entirely. The fix is §4's type, and it reaches
   3 of 5 listeners — `test_automation` and `webhook` call `axum::serve` directly.
2. **`authorize_tool_call` has no per-tool vocabulary to express.** It receives `tool_name` and
   cannot do anything with it because there is no tool→requirement map — the same absence as
   `command_tier` having no reader, one layer down. A `ToolRequirement` enum beside the tool list
   would make 7.F a table rather than a bit.
3. **There is no run-scoped bridge credential.** `mint_derived_handle` takes a `credential_id`, so
   a run needing three credentials needs three handles and the runner has nowhere to put them. The
   missing primitive is `mint_run_bridge_key(execution_id, &[credential_id], ttl)` returning one
   key scoped to exactly that set — after which 7.C is a two-line change at
   `runner/mod.rs:1161-1162`.
4. **Nothing enumerates the listeners.** Five `axum::serve`, one QUIC `bind`, thirteen
   `Router::new()`, and no registry. The census rule counts *routes*, which is a proxy: a new
   listener with zero routes (or with routes added by `.nest`) is invisible to it.
5. **The audit table has no transport dimension.** `api_key_audit` distinguishes MCP from HTTP by a
   convention in the `method` column (`auth.rs:38`). The four unauthenticated routers write nothing
   at all, so "has this transport ever carried a request" is unanswerable for exactly the
   transports where it matters most.
6. **`is_privileged_command` is a set membership test, not a policy object.** A second transport
   that wanted to honour the primary tier could only ask "is this name in the list", which tells it
   nothing about *why* — path parameter? credential spend? subprocess? — and therefore nothing
   about whether its own population changes the answer. Q1 of the doctrine, exactly: the type
   encodes membership and the question is about population.
7. **No gate can decide whether a second transport is warranted.** That is a judgement about
   populations and it stays human. §9's rule can only guarantee that opening a door without a
   credential is a visible, deliberate act with a written reason.

---

## 9. The missing gate

Every deviation in §7 ships green under `npm run check`, under
`cargo test --manifest-path src-tauri/Cargo.toml --features desktop`, and under the existing
census. There is no gate on this leaf at all: `ipc_auth.rs`'s drift guard (`:1156`) covers the
*primary* transport's annotation/list closure and is structurally unable to see a router.

**Existing rules checked for overlap** (104 in `scripts/census/rules.json`): the closest three are
`build-gated-ipc-entrypoint` (counts `#[cfg]`-gated entries inside `generate_handler!` — the
primary transport's registration list, disjoint file set), `pinned-harness-endpoint` (counts
hard-coded `:1732x` URLs in `tools`/`tests`/`scripts`/`uat` — the *client* side of the
test-automation bridge, no `src-tauri` overlap), and `untyped-command-payload` (`#[tauri::command]`
return types). **File overlap with the proposed rule: zero.** No rule in the registry matches
`.route(`, `Router::new`, `axum::serve`, or any bind expression.

**The condition the signal is a proxy for** (state it so an adopting repo can re-derive its own):
*an inbound entry point on a non-primary transport that requires no credential.* In this stack that
manifests as an axum route registered in a module with no auth layer and no per-handler check; in
Next.js it would be a route handler with no session read; in a Python service, a FastAPI path
operation with no `Depends(auth)`. **Do not port the regex.**

**Why a count and not a type:** §4 answers the type question `yes` and measures its reach at 3 of 5
listeners / 34 of 130 routes. Ship both — the type as the fix, the rule as the ratchet that holds
the other 96 routes until it lands.

**Signal.** `\.route\(\s*"` — every axum route registration. Verified complete for this tree: a
second implementation confirms `.route(` occurs 130 times and `.route("` occurs 130 times, so no
route is registered with a non-literal path; `.route_service(` and `.fallback(` are both 0. The
partition is carried by `exclude`, and **the exclusion list is the deliverable** — it is the
transport-classification table §8.4 says does not exist, with a prose reason per transport that the
runner refuses to let go stale.

**Mechanism.** A census rule. It runs under `npm run census` / `npm run census:check`, which is a
runner the repo already invokes locally and which fails on drift — not a CI-only job. Per the
calibration note: `ci.yml` currently runs its Rust tests but is red on pre-existing failures, so a
gate that only lives there effectively runs nowhere; the census runner is the one that executes.

```json
{
  "id": "unauthenticated-transport-route",
  "goldenPath": "docs/concepts/golden-paths/second-transport-exposure.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\.route\\(\\s*\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An axum route registered on an in-app HTTP server whose router presents no credential requirement at all. Proxy for: an inbound entry point on a non-primary transport that requires no credential. The exclude list below IS the transport-classification table — every router that DOES authenticate is named here with how."
  },
  "exclude": [
    { "path": "src-tauri/src/engine/management_api.rs", "reason": "the only router-level auth layer in 963 Rust files: middleware::from_fn_with_state(require_api_key) + per-route scope check" },
    { "path": "src-tauri/src/commands/fleet/companion_api.rs", "reason": "per-handler authorize(): LAN-peer check then constant-time device-token match" },
    { "path": "src-tauri/src/engine/webhook.rs", "reason": "per-trigger HMAC/URL secret verified inside handle_webhook" },
    { "path": "src-tauri/src/browser_bridge/mod.rs", "reason": "pairing token + per-test session token checked inside each handler" },
    { "path": "src-tauri/src/engine/share_link.rs", "reason": "short-lived URL token is the credential" },
    { "path": "src-tauri/src/companion/orchestration/mcp/mod.rs", "reason": "X-Athena-Session header resolved to a live fleet session" },
    { "path": "src-tauri/engine/src/pairing.rs", "reason": "the pairing ceremony itself: nonce + explicit human approval is the gate, by design" }
  ],
  "baseline": { "files": 4, "matches": 79 },
  "floor": 900
}
```

**The positive control** — same anchor, pointed at the compliant form, no baseline:

```json
{
  "id": "unauthenticated-transport-route-positive-control",
  "goldenPath": "docs/concepts/golden-paths/second-transport-exposure.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\.route\\(\\s*\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the same anchor pointed at the routers that DO require a credential. Must return ~51; a near-zero result means the anchor is not discriminating on what this rule thinks it is."
  },
  "exclude": [
    { "path": "src-tauri/src/test_automation.rs", "reason": "control: unauthenticated router" },
    { "path": "src-tauri/src/commands/infrastructure/dev_tools_http.rs", "reason": "control: unauthenticated router" },
    { "path": "src-tauri/src/commands/fleet/hooks.rs", "reason": "control: unauthenticated router" },
    { "path": "src-tauri/src/engine/project_tracking/push.rs", "reason": "control: unauthenticated router" }
  ],
  "floor": 900
}
```

**Measured, in a private scratch registry, then re-extracted from this document and re-run — identical both times:**

```
unauthenticated-transport-route                    4 files   79 matches   (base 4 / 79)   walked 963
unauthenticated-transport-route-positive-control   7 files   51 matches   (no baseline)   walked 963
```

**79 + 51 = 130 = the anchor's entire raw population.** The rule and its control **partition** the
anchor exactly, with no residue and no overlap — the strongest form the doctrine names. Per-file:
violating = `test_automation` 46, `dev_tools_http` 31, `hooks` 1, `push` 1; compliant =
`management_api` 29, `companion_api` 10, `webhook` 6, `pairing` 2, `browser_bridge` 2,
`orchestration/mcp` 1, `share_link` 1.

**Precision, hand-audited, all 79:** 33 are unauthenticated **and mounted in release** (the P0);
46 are the test-automation bridge, unauthenticated and correctly compiled out — counted
deliberately, because "there is no credential on this router" is exactly true of it and its
absence from release is a *build-config* fact that the rule should force you to re-assert rather
than assume. **False positives on "this router requires no credential": 0 of 79.**

**Allowlist.** The seven `exclude` entries above, each naming *how* that router authenticates. Two
of the seven are load-bearing judgements a reviewer should re-check on any change:
`engine/src/pairing.rs` (the ceremony is deliberately open — nonce + human approval is the gate)
and `webhook.rs`, whose `/health` route genuinely needs nothing but sits in a file excluded for its
other four. Both are named here rather than hidden.

**How it fails loudly if its own precondition is absent** — the runner implements four of these and
the rule supplies the fifth:

- `floor: 900` against a 963-file walk. If `src-tauri` moves, is renamed, or the extension list
  stops describing the tree, the run **fails with "THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"**
  rather than reporting a clean zero.
- **Zero matches anywhere is fatal**, so a regex that stops matching cannot read as a finished
  migration.
- **A stale `exclude` is fatal.** If `management_api.rs` is split, renamed or deleted, the run fails
  on the exemption before it can report a count — which is precisely the event that would otherwise
  quietly relabel 29 authenticated routes as violations or vice versa.
- **A silent drop is fatal under `--check`.** If the count falls without `--update`, the runner
  treats it as a broken matcher, which is the correct prior: the 3-match disagreement in §6 was
  exactly this failure mode caught before baselining.
- **The positive control is the instrument assertion.** It has no baseline by design, so it never
  ratchets; its job is to be read. **If it ever returns ~0, the anchor has stopped discriminating**
  — the same class of check as `check-csp-hosts.mjs`'s exit-2 guard, and the reason it partitions
  rather than reporting a ratio.

**What no gate can do.** Nothing machine-checkable decides whether a second transport *should*
exist, or whether "loopback is fine here" is true. That is the population judgement in step 1 and
it stays human. A checker can guarantee only that a credential-free door is a visible, deliberate,
reasoned addition — and that the four that exist today cannot become five without somebody typing
a sentence.

**The complementary instrument the census cannot host.** The census ratchets a count of something
present; it cannot assert an **absence**. Three of this document's findings are absences and none
is gateable by counting: that `command_tier` has no caller, that `PERSONAS_MCP_TOKEN` has no writer
on the runner path, and that `api_key_audit` has no `method='MCP'` row. The first two are
`assert!`-shaped and belong in `ipc_auth.rs`'s existing drift-guard test —
`assert!(command_tier_callers >= 1)` would have failed the day the first alternate transport
shipped, and an assertion that the sidecar config's `env` map contains every var `mcp_bin.rs` reads
would have caught 7.D at authoring time. **The third is not assertable at all; it is a query, and
somebody has to run it.** That is P8, and it is the reason this document opens with a probe.

---

## 12. Corrections to the brief

**1. "1,666 `#[tauri::command]` functions" — the number is 1,673**, measured with
`grep -rn --include=*.rs -o '#\[tauri::command' src-tauri | wc -l`, which is the same command
`ipc-command-authorization`'s 2026-08-13 correction pass settled on. 1,585 are registered.

**2. "with an auth macro (`require_auth`/`require_auth_sync`)" — `require_auth` is a documented
no-op** (`ipc_auth.rs:537-539`), so the brief's framing of the primary transport as uniformly
gated is wrong in a way that matters for this leaf's central question. The real primary-transport
guard is `wrap_invoke_handler`'s membership test, and its `else { inner(invoke) }` at `:661` means
**1,356 of 1,585 registered commands (85.6%) are dispatched with no token at all.** The correct
comparison for a second transport is therefore not "does it enforce what IPC enforces" but "is its
population larger than IPC's" — which is why §2 leads with populations rather than tiers, and why
`dev_tools_http.rs:6-8` is wrong for a subtler reason than it first appears.

**3. The list sizes in the adjacent path are stale, and its category-D count has grown.**
`PRIVILEGED_COMMANDS` is **184 active + 8 commented-out** (not 153) and `CLOUD_COMMANDS` is **50**
(not 45). Of the **234** gated names, **229 are registered in `generate_handler!` and 5 are not** —
`github_create_patch_release`, `openapi_parse_from_url`, `openapi_parse_from_content`,
`openapi_generate_connector`, `create_execution`. [ipc-command-authorization](./ipc-command-authorization.md)
§"Mandated primitives" and its category D (recorded as 3) should both be re-derived; its §9 item 1
("every listed name appears in `generate_handler![]`") is still unbuilt and would find all five.

**4. "the Rust side of that API is presumably still listening" — confirmed, and it answered.**
`src/lib/managementApiAuth.ts` is gone; `:9420` is up and returns **401** to an unauthenticated
`GET /api/personas`. The middleware works. What is on the API is §7.B and §7.C, not an open door.

**5. "`auto_optimize:` and `health_watch:` … read by nothing" — confirmed, and the *cause* is this
leaf's, not autonomy's.** Both are pure management-API routes (`management_api.rs:98-105`) with no
IPC command and no UI. They are the shape P10 predicts: a capability that exists only on a
secondary transport, invented there because that transport had no way to ask the primary surface
what an operation should require. Neither key appears in the live 32-row `app_settings`.
[autonomy-gating](./autonomy-gating.md) §7.G owns the "flag with no consumer" defect; this path
owns why it was born on that transport.

**6. "The test-automation server exposes 20 tools" — it exposes 46 routes**
(`test_automation.rs:1353-1409`). The "20 tools" figure is the MCP client's tool count, not the
server's route count. **Is it compiled into shipped builds? No** — `lib.rs:1574-1582` compiles the
env-override path out of release entirely and warns if `PERSONAS_TEST_PORT` is set anyway. **But it
is listening on this machine right now** (17320, HTTP 200), because this is a debug build, and
`/eval` there is a master key rather than a route. That is P9, and it is why the flag is the right
control rather than a lax one.

**7. The brief's framing "do the other transports enforce the same checks, or re-implement them, or
skip them?" admits a fourth answer, and it is the one that occurred: they *inherit a claim about*
the check.** `dev_tools_http.rs:6-8` neither enforces, re-implements, nor skips — it reasons from
the primary transport's tier to a conclusion about its own population. That is the failure mode
worth naming, because "skip" is a decision somebody could review and "inherit" is not.

**8. The Prefer-a-type framing needed inverting for this leaf.** The obvious candidate — a type on
the authorization decision — is not it. Every transport here already computes a defensible decision;
the thing that is unrepresentable-able is the **unclassified mount**, which is a signature change on
`register_router`, not on any auth function. And it reaches only 3 of 5 listeners, because two call
`axum::serve` directly. §4 records the reach honestly rather than claiming the type closes the leaf.

**9. A correction to my own reasoning, recorded because it nearly shipped.** From "the MCP gate
landed 2026-07-16" plus "zero `mcp__personas__*` tool steps after that date" I drafted "the persona
toolbelt has been dead for 31 days." Then I checked the denominator: **`max(created_at)` on
`persona_executions` is 2026-06-26** — no persona execution has run at all since then, so there is
no post-gate data and the outage is unobserved. The defect is real and provable from source (one
writer, two launchers, and the runner is not the one taught); the *consequence* is latent, not
demonstrated. Same family as the doctrine's "measurement truncated by its own display limit": the
absence I found was an absence of the population, not an absence within it.

**10. The sibling path's "11 routers, 4 with no auth" re-measures to 13 `Router::new()` / 11
route-declaring files / **4** unauthenticated routers — the router count moved, the
unauthenticated count held.** Its enumeration remains the best short list in the corpus; this path
adds the bind addresses, the populations, the two non-loopback listeners, and what each transport
has actually carried.

**11. The convergence oracle corrected one of my own clauses and refused to support another.**
P3 originally read *"write the population down at the bind site"*; the sweep's two worst exposures
(`vibeman`'s framework-default `0.0.0.0` and `personas-cloud`'s host-less `listen`/`WebSocketServer`)
**have no bind site at all**, so the clause as written would have reported both repos clean. It is
corrected in the head. Separately, **P8 (every transport needs a ledger) is untested** — the oracle
measured auth mechanisms, not audit tables, so that clause rests on this repo's single instance and
must not be cited as convergent. And P9 (compile a code-execution transport out) has **no external
warrant**: Personas is the only one of six that does it, and `vibeman` ships the exact opposite. It
is retained as a house convention with a strong argument, labelled as such.

**12. The spine's `convergence: diverged` label is correct, and sharper than it looks.** The
divergence is not that the six codebases disagree about how to authorize a transport. It is that
**every one of them agrees per-transport and none of them agrees with itself across transports** —
one scheme per transport, added when the transport was added, 7 / 6 / 4 / 1 / 0 schemes across the
five siblings and **7** here. The label is right; the reason is that the practice being measured
does not exist anywhere to converge on.
