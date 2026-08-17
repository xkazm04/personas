# Golden path — the inbound endpoint surface (the route table)

> Situation node: `backend-runtime/eventing/inbound-endpoint-surface` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **HIGH** · sides **client**
> (refuted — §12.1) · convergence **diverged** · dimensions: **security · function · resilience ·
> code-quality**
> Composed 2026-08-17 against `master` @ `5d55d6a4a`.
>
> **Sweep.** All **963** non-generated `.rs` files under `src-tauri/` (the census engine's own walk)
> and all **4,829** `.ts`/`.tsx` files under `src/`. Every `.route(` registration extracted
> structurally with its method and handler; every `Router::new()`, `axum::serve`, `TcpListener::bind`,
> `.layer(`, `.merge(`, `.nest(`, `DefaultBodyLimit` and `Query<…>` enumerated and classified.
> `local_http/mod.rs`, `webhook.rs`, `management_api.rs`, `dev_tools_http.rs`, `push.rs`, `hooks.rs`,
> `pairing.rs`, `browser_bridge/{mod,relay,mcp}.rs`, `companion/orchestration/mcp/mod.rs`,
> `companion_api.rs`, `test_automation.rs`, `commands/credentials/oauth.rs`, `webbuild/devserver.rs`
> and `commands/credentials/mcp_tools.rs` read in full or near-full.
>
> **Measured by executing, not reading.**
> 1. **The operator's app was running throughout** (`personas-desktop`, pid 27816, debug build).
>    Its listeners were enumerated from the OS with `Get-NetTCPConnection` / `Get-NetUDPEndpoint`,
>    **read-only**. **No request was sent to any of them** — the brief forbade it and nothing below
>    depends on having sent one. Every behavioural claim is derived from source and named as such.
> 2. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 244 tables,
>    `personas_data.db` 71 tables, copied 2026-08-17) queried for what these routes have carried:
>    **1,029 `external_api_keys` rows, 1 `api_key_audit` row, 0 `webhook_request_log` rows,
>    0 webhook triggers, 14 `dev_projects`, 408 `dev_contexts`, 1,306 `workspace_knowledge` rows.**
>    Copies deleted.
> 3. The §9 rule was built, run through the real runner in a private scratch registry
>    (`rules-ies-inbound-endpoint-surface-probe.json`), **fault-injected nine ways including one
>    real violation appended to a production file and reverted clean**, then re-extracted from this
>    finished document and re-run: identical.
>
> **NEVER PRINT A SECRET.** No token, key, header value or origin secret appears below.
>
> **Seams.** [`second-transport-exposure`](./second-transport-exposure.md) owns *whether a second
> door should exist and who may address it*. [`external-source-ingestion`](./external-source-ingestion.md)
> owns *what the bytes do once admitted*. [`sql-console`](./sql-console.md) owns *what a door does
> with a caller-authored program*. [`least-privilege-scope-grant`](./least-privilege-scope-grant.md)
> owns *the scope vocabulary*. [`telemetry-scrubbing`](./telemetry-scrubbing.md) owns *whether a
> response is redacted*. **This path owns the artifact none of them has: the table itself — every
> route, its listener, its bind, its layer stack, and the address a caller must know to reach it.**
> Where a finding is theirs I confirm it and cite it; I do not re-derive it.
>
> The **Deviations** section is a fix backlog. Nothing in this path was applied.

---

## 0. The route table, before anything else

**Right now, on this machine, one process (pid 27816) is answering on three loopback TCP ports with
116 HTTP routes. Eighty-two of them require no credential of any kind. One body-size limit exists in
the whole application and it covers three of the 116. One audit table exists and it holds one row,
written thirteen months ago to a route that no longer exists.**

Enumerated from the OS, read-only, during composition:

```
127.0.0.1:9420   pid 27816   webhook + management + pairing        34 routes
127.0.0.1:17400  pid 27816   local_http (5 nested routers)          36 routes
127.0.0.1:17320  pid 27816   test-automation bridge                 46 routes
                             ------------------------------------  ----------
                                                                   116 routes
::1:1420         pid 21564   node — the Vite dev server (not ours)
0.0.0.0:5353     pid  2996   mDNS — another process, not ours
```

Not listening: `0.0.0.0:17500` (companion LAN — no device paired), `[::]:4242` (P2P QUIC — this
build has no `p2p`), and the two ephemeral OAuth callback servers, which exist only inside a flow.

### 0.1 — Every route this app serves, by listener

**`127.0.0.1:9420` — one socket, three live route families (four in a `p2p` build), each with a
different layer stack.**
`webhook.rs:98` builds it: three webhook routes, then `.merge(management_router)` (`:133`),
`.merge(pairing_router)` (`:136`), and `.merge(share_link_router)` under `#[cfg(feature = "p2p")]`
(`:138`).

**And which of the two possible tables this port serves is decided by a startup race.**
`background.rs:869-888` calls `start_webhook_server_with_management` when
`app.try_state::<Arc<AppState>>()` resolves and falls back to `start_webhook_server` — **3 routes
instead of 34** — when it does not. Nothing logs which one you got; the only observable difference is
that `/api/personas` answers **404 instead of 401**. [second-transport-exposure](./second-transport-exposure.md)
§6 found this and I confirm it unchanged. Its consequence for *this* leaf is the sharper one:
**the route table is not a property of the source, it is a property of a particular boot.** No static
artifact can be correct about this port; only a table emitted at startup can (§9, instrument 3).

| Routes | Path(s) | Auth | Body cap | Rate limit | Audit | Reaches |
|---:|---|---|---|---|---|---|
| 1 | `POST /webhook/{trigger_id}` | **HMAC-SHA256, mandatory, constant-time** (`webhook.rs:375-428`, `:537`) | **1 MB** (`:131`) | per-trigger, tier-aware (`:331-360`) | `webhook_request_log` (**0 rows**) | publishes a `persona_event`, fires a trigger |
| 1 | `GET /webhook/{trigger_id}` | **none** | 1 MB | none | none | reads the trigger row; discloses existence + active-window schedule |
| 1 | `GET /health` | **none, by design** | 1 MB | none | none | `{"status":"ok","service":"personas-webhook"}` — §7.E |
| 29 | `/api/*`, `/a2a/{id}`, `/agent-card/{id}` | **bearer + per-route scope** (`management_api.rs:136`, `:335`) | **none stated** → axum's 2 MB | 120/min per key (`:276`) | `api_key_audit` (**1 row ever**) | execute personas, proxy credentials, mint broker handles, drive builds |
| 1 | `POST /pair/request` | **none** — the ceremony is the gate | none stated | none | none | registers a pending pairing; **`allow_origin(Any)`** (`pairing.rs:344`) |
| 1 | `GET /pair/claim?nonce=` | nonce + origin match, single-use | none stated | none | none | returns a minted token once |
| *(1)* | `GET /share/{token}` | short-lived URL token | — | — | — | **not mounted — `p2p` is off in this build** |

**`127.0.0.1:17400` — `local_http`, five routers nested under five prefixes declared in `lib.rs`.**
`local_http/mod.rs:84` binds `Ipv4Addr::LOCALHOST` on the first free port at or above **17400**,
scanning **16** ports (`:22-23`). **Zero `.layer(` calls exist on this listener or on any router
mounted into it** — no auth, no CORS, no body limit, no timeout, no audit.

| Routes | Prefix (declared at) | Path(s) | Auth | Reaches |
|---:|---|---|---|---|
| 31 | `dev-tools` (`lib.rs:987`) | `/dev-tools/*` (`dev_tools_http.rs:70-100`) | **none** | **13 GET-serving paths, 19 POST-serving, 32 method handlers on 31 registrations** (`/projects` at `:70` is both). Reads: the operator's whole project inventory. Writes: **three headless-Claude spawns**, a rewrite of `context-map.json` + `CLAUDE.md` on disk, six destructive context mutations |
| 1 | `fleet` (`lib.rs:968`) | `POST /fleet/hooks/{event}` (`hooks.rs:37`) | **none** | mutates fleet session state. **The path segment is the verb selector and accepts any string**; the handler recognizes **7** kinds (`sessionstart`, `notification`, `stop`, `pretooluse`, `posttooluse`, `userpromptsubmit`, `sessionend` — `:87`, `:243-291`) while **the module docstring lists 5** (`:29-34`). One route, seven verbs, five documented. |
| 1 | `project-tracking` (`lib.rs:963`) | `POST /project-tracking/cli-event` (`push.rs:54`) | **none** | inserts a tracking event, then debounce-triggers an LLM consolidator run |
| 1 | `mcp` (`lib.rs:976`) | `POST /mcp/rpc` (`orchestration/mcp/mod.rs:119`) | `X-Athena-Session` on `tools/call` only (`:258`) | 4 `athena.*` tools; `initialize`, `server/discover`, `tools/list` answer **unauthenticated** by design (`:244-255`) |
| 2 | `browser-bridge` (`lib.rs:983`) | `GET /browser-bridge/ws`, `POST /browser-bridge/mcp` | pairing token pre-upgrade (`relay.rs:78-82`); session header | drives the user's real Chrome — **9 browser tools behind one POST** |

**`127.0.0.1:17320` — the test-automation bridge.** 46 routes (`test_automation.rs:1353-1409`),
**no auth, no layer, no audit**, including `POST /eval`. Correctly compiled out of release
(`lib.rs:1574-1582`) and correctly listening here because this is a debug build with the feature on.
That control and its reasoning are [`second-transport-exposure`](./second-transport-exposure.md)'s
P9 and §6; I confirm the build gate and do not re-derive it.

**Not listening, but in the table because a route table that omits them is wrong the moment they
start:** `companion_api` — 10 routes on `0.0.0.0:17500`, started only after a human pairs a device
(`companion_api.rs:73`); `share_link` — 1 route, `p2p` only; the P2P QUIC endpoint on `[::]:4242`.

### 0.2 — The two listeners no route-table instrument can see

**`commands/credentials/oauth.rs:560` and `:1749` each `TcpListener::bind("127.0.0.1:0")` and run a
hand-written HTTP server** — accept, read until `\r\n\r\n`, parse the request line, answer with a
literal `HTTP/1.1 200 OK` and an HTML page (`:230-390`). **Zero `.route(` registrations. Zero axum.**
They are invisible to `unauthenticated-transport-route`, to this path's §9 rule, and to every
enumeration in the corpus, including the sibling path's transport census — which lists five
listeners and does not contain them.

They are also **the best-defended inbound endpoint in the application**, and nothing else in the
tree has copied any of it:

| Control | Where | The others |
|---|---|---|
| absolute session deadline, each `accept()` bounded by the time *remaining* | `:209`, `:226-230` | no other listener has a request or session deadline |
| **an invalid-attempt budget** — 32 bad hits and the flow aborts | `MAX_OAUTH_CALLBACK_ATTEMPTS = 32` (`:66`), enforced `:216-224` | the only rate limit outside `management_api` and `webhook` |
| **a body cap, hand-rolled** — a fixed 32,768-byte buffer, oversize ⇒ reject and keep waiting | `read_callback_request` (`:342-368`) | the only byte bound on any listener other than `webhook.rs`'s 1 MB |
| **replay defence** — HMAC-signed `state` carrying a timestamp, verified against a freshness window, *plus* a literal string match against this session's value, *plus* first-valid-wins | `:281-296`, `verify_oauth_state` (`:1285`), `OAUTH_STATE_MAX_AGE_SECS` (`:1232`) | **`POST /webhook/{id}` has none of it** — §7.B |
| stray/forged hits do not consume the flow; they get the failure page and the loop continues | `:288-299` | — |

**The replay defence the webhook receiver is missing is implemented, correctly, 900 lines away in
the same crate.** That is this leaf's subject in one sentence: the controls exist; there is no table
in which anyone could have noticed they were unevenly applied.

### 0.3 — What the unauthenticated 82 actually reach, from the live database

Not "an unauthenticated read" in the abstract. `GET /dev-tools/projects` returns
`repo::list_projects` verbatim (`dev_tools_http.rs:453-456`), and the live rows are:

- **14 `dev_projects`, each with an absolute `root_path`** — the operator's `C:\Users\mkdol\dolla\*`
  and `C:\Users\mkdol\xprice\*` checkouts, by name and full path. That is a map of the machine.
- **408 `dev_contexts`** (with `file_paths`), **121 context groups**, **65 KPIs**, **26 use cases**.
- **1,306 `workspace_knowledge` rows and 38 playbooks**, returned by `GET /dev-tools/patterns/index`
  and `/patterns/consult`.

And the write side reaches `spawn_headless_claude` at a caller-chosen path — the P0 that
[`second-transport-exposure`](./second-transport-exposure.md) §7.A established and that I confirm
unchanged at `5d55d6a4a` (`dev_tools_http.rs:467-509` → `launch_context_scan`).

### 0.4 — Five expressions of one address, on three different clocks

The single most reproducible defect in this leaf, and the one nothing else in the corpus has
counted. "Where is the management/webhook server?" has five answers in this repo:

| # | Expression | Clock | Consumers |
|---|---|---|---|
| 1 | `webhook::webhook_port()` — env `PERSONAS_WEBHOOK_PORT`, else 9420 (`webhook.rs:45-51`) | **runtime** | 2 binds + **exactly one** other caller (`mcp_tools.rs:38`) |
| 2 | **8 hardcoded `http://…:9420` literals in Rust** | compile-time | `cli_mcp_config.rs:186` (written into the persona MCP config on **every execution**), `lib.rs:1745` (process-wide env var), `mcp_server/tools.rs:674`, `:1466`, `triggers.rs:1304`, `:1791`, `:1844`, `platforms/deploy.rs:319` (the URL written into a **deployed GitHub webhook**) |
| 3 | `MCP_BASE_URL = 'http://127.0.0.1:9420'` (`src/features/settings/sub_api_keys/libs/mcpServer.ts:8`) | compile-time | the Settings panel the user copies from |
| 4 | `WEBHOOK_BASE_URL` — `import.meta.env.VITE_WEBHOOK_BASE_URL` else `http://localhost:9420` (`src/lib/utils/platform/triggerConstants.ts:211-212`) | **build-time** | `getWebhookUrl()` — the URL shown for every webhook trigger |
| 5 | `host_origin_from_request` — **the caller's `Host` header**, falling back to `"127.0.0.1:9420"` (`management_api.rs:1628-1635`) | **the requester chooses** | `GET /agent-card/{id}` publishes it as `AgentCard.url` |

`webhook_port()` exists precisely so a second instance can bind elsewhere — the comment says so
(`:42-44`, citing ADR 2026-05-26 and parallel-CLI testing). **Set it, and expressions 2–4 still point
at 9420.** Expression 3's own docstring reads *"Single source of truth so the port only needs to
change in one place if it ever moves"* — in the file that is the third copy. Expression 4's override
is a Vite build-time variable and expression 1's is a runtime one, so the two halves of the same
knob are on different clocks and neither is aware of the other; per
[`compile-time-env-embedding`](./compile-time-env-embedding.md) an `import.meta.env` read cannot
reach across that boundary at all, because absence is a legal value.

**Measured, both sides:** 8 hardcoded own-listener address literals in **963** Rust files (0.83% of
files) against **2** in **4,829** TypeScript files (0.04%) — a **20× density difference toward the
server**, on a leaf the spine labels `sides: client` (§12.1).

### 0.5 — The only route table rendered to a human is a hand-written array, and it shows 6 of 34

`src/features/settings/sub_api_keys/components/McpServerInfoPanel.tsx:22-40` is a literal
`ENDPOINTS` array — the closest thing this application has to a published route table. It lists
**six** routes: `GET /health` and five `/api/build/*`. The listener it describes serves **34**.

The 28 it omits include `POST /api/proxy/{credential_id}` and `POST /api/broker/mint/{credential_id}`
— the two credential-bearing routes — plus `POST /api/execute/{persona_id}`, `POST /a2a/{persona_id}`,
and every lab and version-rollback route. The user is shown 18% of the surface and the hidden 82% is
where the money and the secrets are. Nothing joins the array to the router; it is a fourth-generation
copy of a table that exists nowhere.

### 0.6 — A liveness probe pointed at a different service, and the field that would have said so

`probe_mcp_server` (`mcp_tools.rs:33-52`) is the one compliant consumer of `webhook_port()` and the
one reader of any `/health` in this app. It renders the **"MCP server: Running"** chip in Settings.

It probes `GET /health` on `:9420`. That route belongs to the **webhook** server (`webhook.rs:156-158`)
and answers `{"status":"ok","service":"personas-webhook"}`. The probe evaluates
`resp.status().is_success()` and **discards the body** (`:44-47`). The `personas-mcp` MCP server is a
**stdio** binary; it has no HTTP port to be up or down on. So a green chip means *the webhook
listener accepted a TCP connection*, and the single field in the response that would have revealed
the mismatch is the one field the only consumer throws away.

### 0.7 — The layer that stops at the merge

`webhook.rs:127-138`:

```rust
let app = Router::new()
    .route("/webhook/{trigger_id}", post(handle_webhook))   // :128
    .route("/webhook/{trigger_id}", get(webhook_info))      // :129
    .route("/health", get(health))                          // :130
    .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))           // :131  <- 1 MB
    .with_state(Arc::new(webhook_state))
    .merge(super::management_api::management_router(mgmt_state))  // :133  29 routes
    .merge(super::pairing::pairing_router(app_handle));           // :136   2 routes
```

`Router::layer` applies to the routes registered **before** it; routes added afterwards do not
inherit it. This is not an inference — it is axum's own documentation, read from the vendored crate
(`axum-0.8.8/src/docs/routing/layer.md:6-8`):

> *"Note that the middleware is only applied to existing routes. So you have to first add your routes
> (and / or fallback) and then call `layer` afterwards. **Additional routes added after `layer` is
> called will not have the middleware added.**"*

The same file's next example presents `Router::merge` as **the sanctioned way to give middleware to
only some routes** (`layer.md:31-40`) — which is exactly what `webhook.rs:131` vs `:133` does by
accident. It is also why `management_router` is *correct*: it layers its auth (`management_api.rs:136`)
and CORS (`:137`) onto its own router **before** that router is merged, so its 29 routes keep their
middleware through the same operation that dropped the body cap.

The consequence: the application's **only explicit body-size decision covers 3 of the 34 routes on
that port**, and the 31 that do not inherit it include every route that executes a persona or
decrypts a credential. They fall back to axum's default of **2 MB**
(`axum-core-0.5.6/src/extract/default_body_limit.rs:7`, *"For security reasons, `Bytes` will, by
default, not accept bodies larger than 2MB"*) — a number nobody in this repo has decided.

**I did not send a request to verify this**; the standing rule forbade touching the running app. The
claim rests on the crate's own documented contract plus the source order at `webhook.rs:127-138`,
and §9's complementary instrument 1 is the test that would settle it empirically.

[`external-source-ingestion`](./external-source-ingestion.md) §3 credits `webhook.rs:56`/`:98` as
*"the intake bound stated rather than inherited … the only explicit body limit on any of this app's
five listeners."* That is correct and I confirm it. **It is also a statement about the listener, and
the number is a property of the route.** On the one listener that has a cap, 91% of the routes do not
have it. This is the composition error the whole leaf is about: two true statements about different
units, and no table in which they could be laid side by side.

### 0.8 — The whole surface, in numbers

| | Count | Note |
|---|---:|---|
| `.route("…", …)` registrations in 963 `.rs` files | **130** | 11 files; matches the sibling path exactly |
| …expressed as **method handlers** | **133** | exactly 3 registrations carry two methods: `dev_tools_http.rs:70` (`get(list_projects).post(create_project)`), `management_api.rs:99` and `:103`. **A registration count and a handler count are different numbers and P3 is about exactly this.** |
| …**live in this process** | **116** | −3 the unused `start_webhook_server` variant, −1 `share_link` (`p2p` off), −10 `companion_api` (unpaired) |
| …requiring **a credential** | **34** | management 29 · browser-bridge 2 · `/mcp/rpc` 1 · webhook POST 1 (HMAC) · `/pair/claim` 1 (nonce) |
| …requiring **nothing** | **82** | test-automation 46 · dev-tools 31 · hooks 1 · cli-event 1 · `/health` 1 · `GET /webhook/{id}` 1 · `POST /pair/request` 1 *(deliberate ceremony)* |
| Named verbs hidden **behind** those routes | **+23** | `/browser-bridge/mcp` 9 (`browser_bridge/mcp.rs:139-209`) · `/fleet/hooks/{event}` 7 (`hooks.rs:87`, `:243-291`) · `/mcp/rpc` 4 (`orchestration/mcp/handlers.rs:114-117`) · `/a2a/{id}` 3 (`management_api.rs:1678-1681`) — plus a WebSocket protocol on `/browser-bridge/ws`. **4 routes carry 23 capabilities; every route-counting instrument reports 4.** |
| Inbound HTTP listeners with **zero routes** | **2** | the OAuth callback servers (§0.2) |
| Listeners stating a **body cap** | **1 of 5** | and it reaches 3 of that listener's 34 routes (§0.7) |
| Routes with a **rate limit** | **30 of 116** | management 29 (per key, `management_api.rs:459-471`) + `POST /webhook/{id}` 1 (per trigger, `webhook.rs:331-360`). The OAuth callback's 32-attempt budget is a third limiter and is not a route. |
| Routes that write an **audit row** | **29 of 116** | `management_api` only; `webhook_request_log` covers 1 more and has 0 rows |
| **`.layer(` calls on `local_http` and its five routers** | **0** | measured across `local_http/mod.rs`, `dev_tools_http.rs`, `hooks.rs`, `push.rs`, `browser_bridge/mod.rs`, `orchestration/mcp/mod.rs` |
| Inbound handlers reading a **query string** | **7** | `dev_tools_http` **4** · `management_api` 1 · `pairing` 1 · `browser_bridge/relay` 1 — **plus** the hand-rolled `url.query_pairs()` in the OAuth callback, which is where the only security-critical query value in the app lives (§12.2) |
| Artifacts anywhere that enumerate the served surface | **1** | a 6-entry hand-written TS array covering 6 of 34 routes on one of three ports (§0.5) |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and it is the whole subject.** *A route's identity is composed at mount time from
> parts that live in different files, so no file contains a route's address and no grep finds one.*
> The handler declares a path fragment; something else declares the prefix; something else again
> declares the host and port. Every property a reviewer wants to know — who can reach this, what does
> it cost, is it capped — is a property of the composition, and the composition exists only at
> runtime. **Build the table; the table is the artifact, not a nicety.** And build it *at startup*,
> because composition can be conditional: a service whose mount depends on a feature flag, a paired
> device or a state lookup that may or may not have resolved does not have one route table, it has
> one per boot, and a static document is wrong about it by construction.
>
> **P2 — physics, and the most expensive clause.** *A middleware applies to the routes that were
> present when it was applied.* Frameworks differ in syntax and agree in semantics: a layer, a
> `use`, a matcher, a decorator, a filter chain all bind to a set, and the set is whatever had been
> registered at that moment. Adding routes afterwards is the normal way to grow a service and it is
> also the way every cross-cutting guarantee quietly stops being cross-cutting. **State every
> cross-cutting property as a fact about the route, then assert the composition — never trust the
> order of a builder chain to still mean what it meant.**
>
> **P3 — physics.** *Two true statements about different units compose into a false statement about
> the system.* "This listener has a body cap" and "this route has no body cap" are both true here.
> The unit mismatch is invisible to each speaker and fatal to the reader. **Fix the unit before you
> fix the finding:** decide whether the property belongs to the listener, the router or the route,
> write it at that grain, and refuse to report it at any other.
>
> **P4 — physics, and the clause with the most sites.** *An address is a value the system already
> knows; every place that restates it is a cache with no invalidation.* The moment a service can bind
> somewhere other than its default — a port override, an ephemeral port, a container mapping — every
> hardcoded copy of its address becomes a pointer to somewhere else. **Expose one accessor and
> withhold the parts**, because a client given a port will concatenate a prefix, and the prefix is
> the half that has no accessor.
>
> **P5 — physics, and the one people get backwards.** *An override mechanism is only as good as the
> clock it runs on, and one address with two override mechanisms on two clocks is worse than one
> with none.* A build-time variable and a runtime variable naming the same thing cannot agree except
> by accident, and the disagreement surfaces as a UI that confidently displays the wrong address.
> **Pick one clock. If half the system cannot read that clock, that half must ask the other half at
> runtime rather than keep a second knob.**
>
> **P6 — physics.** *A route is a location, not a capability.* Any handler that dispatches on a body
> field, a path segment or a JSON-RPC method name stands for N capabilities, and every instrument
> that counts routes will report 1. **Count verbs, not paths** — and when you publish a route table,
> publish what each entry can do, because a reader who sees one row for nine browser-automation tools
> has been misinformed by an accurate document.
>
> **P7 — physics, and the reason a route inventory can never be a route census.** *The listeners that
> most need to be in the table are the ones the framework does not know about.* A hand-rolled accept
> loop, an OAuth callback, a one-shot socket for a device handshake — these serve HTTP, accept
> untrusted bytes, and register no route. **Enumerate by asking what binds a socket, not by asking
> what the router contains.**
>
> **P8 — ergonomics, security-load-bearing.** *A health endpoint that cannot say which build it is
> answering for is a liveness check being read as an identity check.* Somebody will point a probe at
> it to decide whether a *different* component is running. Make it answer with the build's own
> identity — from the build system, so absence is a failure rather than a stale literal — and make it
> name the service, and then make the probe read the name.
>
> **P9 — ergonomics.** *A hand-maintained list of endpoints is a second route table, and it will be
> shorter than the first in the direction that matters.* People enumerate what they were thinking
> about. The routes that get omitted are not random: they are the ones nobody was documenting because
> nobody was inviting callers to them — which is exactly the set an auditor needs. **Generate the
> published table from the mount, or do not publish one.**
>
> **P10 — security.** *A loopback bind is a statement about the network, not about the population.*
> The population of a loopback socket is every process on the machine — including the ones this
> application starts itself, which on an agent runtime means model-driven subprocesses and build
> tooling from repositories the user is merely working on. And it includes the browser, whose
> same-origin protection over loopback is defeated by a rebound name unless something validates the
> requested host. **Write the population down as the set of processes, not as the set of hosts.**
>
> **Scale condition.** P1, P2 and P3 are correctness the day a second router is mounted. P4 and P5
> bite the first time the service binds somewhere other than its default — which for a desktop app is
> the first time two instances run. P6 bites when the first dispatcher route ships. P7 bites when the
> first OAuth flow ships. P8 bites the first time someone debugs "is it running". P9 bites the first
> time an outsider is invited in. P10 was true from the first bind and will be discovered later.

### Warrant evidence — the sibling sweep

*(See §6 "The oracle" for the clause-by-clause table, the measured independent cohort, and the
silences.)*

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "just add a route for it" · "mount this router under `/x`" · "what's the URL for that endpoint
  again?"
- "point the CLI at the app" · "the hook posts to localhost" · "write the callback URL into the
  config"
- "add a `/health` so we can tell if it's up" · "the status chip says Down"
- "we need a second instance on this machine, override the port"
- "document the API for MCP clients" · "list the endpoints in the settings panel"
- **If you are about to write `Router::new()`, `local_http::register_router(`, `.nest(`, `.merge(`,
  `.layer(`, `TcpListener::bind(`, or a `format!("http://127.0.0.1:{port}/…")` — you are in this
  situation.**
- **If you are about to type a port number inside a string literal, you are in this situation and
  §0.4 is about you.**
- If you are about to add an entry to a hand-written list of endpoints, you are in this situation and
  P9 is about you.

**Not this path:** whether the transport should exist and who may address it is
[second-transport-exposure](./second-transport-exposure.md). Bounding the bytes once admitted is
[external-source-ingestion](./external-source-ingestion.md). What a handler does with a
caller-authored program is [sql-console](./sql-console.md). The scope vocabulary a route demands is
[least-privilege-scope-grant](./least-privilege-scope-grant.md). Whether a response is redacted is
[telemetry-scrubbing](./telemetry-scrubbing.md). Compiling a surface in or out is
[feature-flagged-compilation](./feature-flagged-compilation.md). Validating a path or id at the
boundary is [command-input-validation](./command-input-validation.md).

---

## 2. The one way

**Make the mount return a handle, and make that handle the only way to learn a route's address —
then every cross-cutting property becomes a property you can assert, because there is finally
something to assert it about.** Concretely: a router registration must hand back a value naming
where it landed (`register_router("dev-tools", router) -> MountedAt`), whose only accessor builds a
full URL (`mount.url("/scan-codebase")`), so no caller can concatenate a prefix it copied and no
port literal has anywhere to live; the app already computes both halves and gives out neither.
**Apply every cross-cutting layer as the last thing you do to the outermost router, never in the
middle of a builder chain** — a body limit, a CORS policy, a timeout or an auth middleware applied
before a `.merge()` silently covers a subset, and the subset it covers will be the routes that
existed when someone was thinking about the property rather than the routes that need it.
**State the byte ceiling, the timeout and the rate limit at the grain you mean them** — if it is a
listener property say so at the bind, if it is a route property say so per route, and never let a
listener-grained sentence in a comment stand in for a route-grained fact. **Count verbs, not paths:**
a handler that switches on a body field is N endpoints, and the table must say N.
**Enumerate listeners by what binds a socket, not by what the router holds**, because the
hand-rolled accept loop that receives an OAuth code is an inbound HTTP endpoint that no route
inventory will ever contain — and in this repo it is also the only one with a replay defence, a
request-attempt budget and a hand-written body cap, none of which the routed listeners copied.
**Make `/health` report the build's own identity from the build system** — a version read from the
package metadata rather than typed into a string, plus the service name — and **make the probe read
the name**, because a probe that only reads the status code will happily report a different service
as healthy. **Never publish a hand-written endpoint list**; if a human needs the table, generate it
from the mount, because the entries a person omits are systematically the credential-bearing ones.
And **write the population down as processes**: a loopback bind admits every process on this machine
including the ones you spawn, so if a route can spend money or write the filesystem, "it's loopback"
is a description of the network and not an argument.

If you must get one thing right first: **the mount must return something.** Every other clause here
is unenforceable while the composition that defines a route exists only at runtime.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`src/local_http/mod.rs:36` `register_router(prefix, router)` · `:53` `start()` · `:101` `port()`** | The shared loopback host for five routers, and the right shape for a shared host: one listener, one port, `Ipv4Addr::LOCALHOST` written explicitly (`:84`), a documented free-port scan (`:105-118`), and late registrations refused **with a warning** rather than silently dropped (`:41-47`). **`port()` is the half that works** — 7 callers ask it rather than assuming. §8.1 and §8.2 are about the half that does not: `register_router` returns `()`, so the prefix has no accessor and all 7 of those callers concatenate one they copied. |
| **`src/engine/webhook.rs:45` `webhook_port()`** | The one runtime-overridable address accessor in the app, with the reason written down (`:41-44`). **Copy the shape; then notice it has exactly one non-bind caller** (§0.4). |
| **`src/engine/management_api.rs:414` `require_api_key`, installed at `:136`** | The only router-level authorization layer in 963 Rust files, and the only route family in the app that is authenticated, scoped, rate-limited and audited by construction rather than by habit. Named as the one site to copy by [second-transport-exposure](./second-transport-exposure.md) §6 — I confirm it unchanged and add the composition fact: it is applied to `management_router`'s own 29 routes **before** that router is merged, which is exactly right and is why it survived a merge that the body limit did not (§0.7). |
| **`src/engine/webhook.rs:69`/`:125` `MAX_BODY_BYTES` + `DefaultBodyLimit::max` (`:75`, `:131`)** | The only stated intake ceiling in the app, with the reason in the comment (*"to prevent OOM DoS via oversized payloads"*). The number is right and the placement is wrong (§0.7) — copy the sentence, then apply it to the outermost router. |
| **`src/commands/credentials/oauth.rs:190-390` — the OAuth callback loop** | **The reference implementation for an inbound endpoint in this repo, and it is not a route.** Absolute deadline (`:209`), per-accept remaining-time bound (`:226-230`), a 32-attempt invalid-hit budget (`:66`, `:216`), a fixed 32 KB read buffer that rejects rather than truncates (`:342-368`), HMAC-signed anti-replay state with a freshness window (`:281-296`, `:1285`, `:1232`), first-valid-wins so a later hit cannot race the accepted one (`:302`), and stray hits that get an error page without consuming the flow. **If you must open an inbound endpoint, read this file first.** |
| **`src/commands/fleet/companion_api.rs:73` `start_if_paired` · `:223` `authorize`** | The socket that does not exist until a human authorized it, and the cheapest-guard-first ordering. Established by [second-transport-exposure](./second-transport-exposure.md) §3; cited here because it is the only listener in the table whose *presence* is a decision. |
| **`src/commands/credentials/mcp_tools.rs:33` `probe_mcp_server`** | The only reader of any `/health` in the app, and the only consumer that asks `webhook_port()` instead of assuming. Correct in shape — and §7.E is about the two things it gets wrong with that correct shape. |
| **`src/browser_bridge/mcp.rs:23` · `src/companion/orchestration/mcp/mod.rs:71` — `env!("CARGO_PKG_VERSION")`** | **The build-identity answer, already in this tree, on two endpoints.** `env!` is the mechanism [`compile-time-env-embedding`](./compile-time-env-embedding.md) establishes *does* reach across a build boundary, because an absent variable is a compile error. Both MCP `initialize` responses use it. The three `/health` registrations do not (§7.E). |

**Do not exist — this path names them:**

- **A mount handle.** `register_router` returns `()`. There is no `MountedAt`, no `mount.url(path)`,
  no way to ask "what is the full address of this route". §8.1.
- **A route table.** Nothing in 963 `.rs` files and 4,829 `.ts` files enumerates the served surface.
  The closest artifact is a 6-entry hand-written TypeScript array covering 6 of 34 routes on 1 of 3
  ports (§0.5).
- **A listener inventory.** Five `axum::serve` sites, two hand-rolled accept loops, one QUIC bind,
  thirteen `Router::new()`s, and no place a reviewer can read the list. Named as missing by
  [second-transport-exposure](./second-transport-exposure.md) §8.4; §0.2 shows the gap is worse than
  that path could see, because two of the listeners have no routes to count.
- **Any layer on `local_http`.** Zero `.layer(` calls across the host module and all five mounted
  routers: no auth, no CORS, no body limit, no timeout, no request logging.
- **A `Host`-header check anywhere.** `header::HOST` is read in exactly one place in the whole tree
  (`management_api.rs:1630`) and that place *reflects* it rather than validating it (§7.D). Nothing
  defends any loopback listener against a rebound name.
- **A build-identity response on any `/health`.**

---

## 4. Steps

1. **Write the population down at the bind, as a set of processes.** "Loopback" is not a population;
   "every process on this machine, including the headless model sessions we spawn and the
   `bun`/`next` dev servers we start for the user's own repositories" is. Put it in the module
   docstring the way `local_http/mod.rs:1-12` and `companion_api.rs:9-27` do — and if the answer
   includes a process this app launches, say that explicitly.
2. **Make the mount hand back a handle, and take the prefix away from every caller.** This is §4's
   type answer and it is below. Do it before you write the first client, because the second client
   copies the first.
3. **Register every route, then apply every cross-cutting layer, then serve.** Never `.layer(...)`
   in the middle of a chain that later `.merge(...)`es. If a family genuinely needs its own policy,
   give that family its own router and layer it *there* — `management_router` is the correct shape —
   and then re-read the outer chain asking which routes the outer layers reach.
4. **Decide the grain of every cross-cutting number and write it at that grain.** Body cap, timeout,
   rate limit, audit. A number stated in a comment about a listener does not constrain a route.
5. **Count verbs.** If a handler dispatches on a body field or a path segment, the table gets N rows
   or one row that says N. Six Claude Code lifecycle events behind `POST /fleet/hooks/{event}` is six
   entry points.
6. **Enumerate listeners by socket, not by router.** Grep what binds, not what routes. The two
   endpoints in §0.2 are the ones this step exists for.
7. **Give `/health` the build's identity, from the build system, and the service's name — then make
   the probe read the name.** `env!("CARGO_PKG_VERSION")` is already used twice in this tree; a git
   SHA forwarded through `build.rs` with `env!` rather than `option_env!` is the stronger form, for
   the reason [`compile-time-env-embedding`](./compile-time-env-embedding.md) establishes.
8. **Do not hand-write a published endpoint list.** Generate it from the mount handle, or link to the
   generated table.
9. **And then stop.** Whether this door should exist at all is
   [second-transport-exposure](./second-transport-exposure.md); how many bytes it may accept is
   [external-source-ingestion](./external-source-ingestion.md); what scope it demands is
   [least-privilege-scope-grant](./least-privilege-scope-grant.md); whether the response is redacted
   is [telemetry-scrubbing](./telemetry-scrubbing.md). Re-deriving any of them at the router is how
   this repo got seven authorization schemes and five addresses.

### Can the type make the wrong call impossible? — asked before §9

**Yes for the address, no for the layer stack, and the split is the honest answer.**

The thing to make unrepresentable is **a route address assembled by hand**. Today:

```rust
pub fn register_router(prefix: &str, router: Router)          // local_http/mod.rs:36  -> ()
pub fn port() -> Option<u16>                                  // :101
```

A caller gets a port and nothing else, so it concatenates: `format!("http://127.0.0.1:{port}/mcp/rpc")`
(`pty.rs:572`), `format!("http://127.0.0.1:{port}/browser-bridge/mcp")` (`browser_bridge/mod.rs:194`),
`http://127.0.0.1:{port}/fleet/hooks/{event_lower}` (`hook_install.rs:96-99`). Change the prefix in
`lib.rs` and all three still compile. Replace with:

```rust
pub struct MountedAt(String);                 // private field: the resolved "/prefix"
impl MountedAt {
    pub fn url(&self, path: &str) -> Option<String>;   // None until start() has bound
}
pub fn register_router(prefix: &str, router: Router) -> MountedAt;
```

- **Q3 (a type nobody constructs constrains nothing):** **5** construction sites, all in one
  `lib.rs` block (`:963-990`), and **7** consumers of `port()`. Small, enumerable, reachable in one
  edit. Passes.
- **Q4 (a type anyone can construct authenticates nothing):** the field is private and the only
  constructor is `register_router`, so a caller cannot mint a `MountedAt` for a prefix nobody
  mounted. Passes.
- **Q5 (withholding beats requiring):** the strong form is that `port()` becomes private. Then a
  client physically cannot assemble an address — the dangerous freedom (concatenating a prefix
  literal) is withheld while the answer (the URL) is handed over. This is the
  `build_ssrf_safe_client` shape from [outbound-http-call](./outbound-http-call.md) §3.
- **Q6 (withhold the dangerous freedom, not the answer):** withhold the *prefix string*, not the
  *ability to address the route* — a client still gets a working URL, so nothing breaks.
- **Where the type cannot reach — and it is most of the surface.** `webhook.rs` and
  `test_automation.rs` call `axum::serve` directly and never touch `register_router`; the OAuth
  callbacks are not routers at all. **The type reaches 3 of 5 axum listeners and 36 of 116 live
  routes.** It reaches **none** of the 8 hardcoded `:9420` literals, because `:9420` has no mount
  handle to hand out — it would need `webhook_port()` to grow the same treatment.
- **And it cannot reach the layer stack at all.** No Rust signature expresses "this layer covers
  every route in this router" — that is a fact about the order of a builder chain, and both
  `.layer()` and `.merge()` return the same `Router` type by design. §0.7's defect is invisible to
  every type the language can express, which is why §9 exists and why §8.3 specifies a test rather
  than a signature.

**Ship both**: the handle as the fix, the rule as the ratchet on the literals it cannot reach.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`.layer(cross_cutting)` before `.merge(more_routes)`** | The guarantee silently covers a subset. Measured: the app's only body cap covers **3 of the 34 routes** on its own port, and the 31 it misses are the ones that execute personas and decrypt credentials (`webhook.rs:131` vs `:133`, `:136`). |
| **A port number inside a string literal** | It is a cache of a value the system computes, with no invalidation. **8 in Rust, 2 in TypeScript**, none of which honour `PERSONAS_WEBHOOK_PORT` — the override that exists specifically so a second instance can bind elsewhere (`webhook.rs:42-44`). |
| **"Single source of truth" written above the third copy** | `mcpServer.ts:5-8`. The comment is the reason nobody looked for the other four. Same family as the corpus's recurring finding that *a check asserted in prose is where an import belongs*. |
| **Two override mechanisms for one address, on two clocks** | `PERSONAS_WEBHOOK_PORT` is runtime; `VITE_WEBHOOK_BASE_URL` is build-time (`triggerConstants.ts:211`). They cannot agree except by accident, and the UI is the half that displays the answer. |
| **A hand-written list of endpoints in the UI** | People enumerate what they were thinking about. `McpServerInfoPanel.tsx:22-40` lists 6 of 34 and omits **both credential-bearing routes**. |
| **Treating a route as a capability** | `POST /browser-bridge/mcp` is 9 browser-automation tools; `POST /fleet/hooks/{event}` is 7 lifecycle events; `POST /mcp/rpc` is 4 `athena.*` tools; `POST /a2a/{id}` is 3 JSON-RPC methods. **Four routes, 23 capabilities**, and every instrument in the corpus reports four. |
| **A liveness probe that reads only the status code** | `probe_mcp_server` reports the **webhook** listener's TCP health as the **MCP server's** state, and the response body says `"service":"personas-webhook"` (`mcp_tools.rs:44-47`, `webhook.rs:157`). |
| **A version literal in a health response** | `test_automation.rs:939` answers `"version":"0.2.0"`; the app is **1.1.0**. A stale literal is worse than no version, because a caller will believe it. |
| **Documenting a route's mounted path in the router's own docstring** | The prefix belongs to `lib.rs` and the module cannot see it, so the comment is a copy that nothing updates. `push.rs:51-52`, `hooks.rs:29-34`, `orchestration/mcp/mod.rs:115-116`, `relay.rs:63`. |
| **"Loopback-only, so no nonce gate"** | A description of the network read as a description of the population — and this application *starts* processes that reach the socket. `push.rs:10-12`; evaluated in §7.C rather than restated. |
| **`err(e) => (INTERNAL_SERVER_ERROR, e.to_string())` as the only error arm** | Every failure on 31 unauthenticated routes returns 500 with the raw internal message, so a not-found, a validation refusal and a DB error are indistinguishable to a client and the message is disclosed to a caller that presented no credential. `dev_tools_http.rs:118-120`. |
| **Reflecting the `Host` header into a published URL** | The app tells a client where to reach it, and the caller chose the answer. `management_api.rs:1628-1635` → `AgentCard.url`; the unit test at `:2674` asserts the reflection. |
| **Counting the routers to enumerate the listeners** | Two inbound HTTP servers in this app have no router (`oauth.rs:560`, `:1749`) and are the best-defended endpoints it has. |

---

## 6. Evidence

### The one site to copy: `src-tauri/src/commands/credentials/oauth.rs:190-390`

It is the only inbound endpoint in the application that bounds every axis, and it does so without a
framework:

- **Bounded in time, twice.** An absolute deadline for the whole flow (`:209`) and a per-`accept()`
  budget derived from the time *remaining* (`:226-230`), with the reason written down: *"so junk hits
  cannot extend the total wait past `timeout_secs`."*
- **Bounded in attempts.** `MAX_OAUTH_CALLBACK_ATTEMPTS = 32` (`:66`); an exhausted budget aborts the
  flow with a message that tells the user to retry (`:216-224`).
- **Bounded in bytes, by hand.** A fixed 32,768-byte buffer; oversize returns `None` and the caller
  answers the failure page and keeps waiting (`:342-368`). The comment names why 32 KB
  (*"long legitimate callbacks (enterprise Azure AD)"*).
- **Authentic and fresh.** The echoed `state` is checked against this session's value *and* against
  an instance HMAC with an embedded timestamp (`:281-296`); an authentic-but-stale state is a
  distinct, terminal outcome (`:305-317`) rather than a silent accept.
- **Not replayable.** First valid state wins and the loop breaks (`:302`) — *"so a later valid hit
  cannot race this one"* — and the exchange closure is `FnOnce`.
- **A hostile hit costs nothing.** Bad state ⇒ failure page, increment, continue; the flow is not
  consumed.

**Also exemplary:**

- **`src/engine/management_api.rs:70-165`** — the correct composition. State, then the auth layer,
  then CORS, *on its own router*, before that router is merged into a host it does not control. It is
  why 29 routes kept their middleware through a merge that the body limit did not survive. The CORS
  predicate's reasoning (`:139-150`) is worth reading for why `allow_origin(Any)` on a
  credential-bearing loopback router would be a real vulnerability rather than a nuisance.
- **`engine/src/pairing.rs:336-352`** — the counter-shape, done deliberately and documented:
  `allow_origin(Any)` **is** correct here and the comment says exactly why (*"the cloud origin is not
  paired yet — the nonce + user approval + origin-checked single-use claim are the security, not
  CORS"*). Two route families with opposite CORS policies on one socket, each right, each explained.
  This is what P3's "decide the grain" looks like when someone does it.
- **`src/local_http/mod.rs:41-47`** — a late `register_router` call is refused **with a warning**
  rather than silently ignored. Small, and it is the only place in the app where a mount-time mistake
  is observable.
- **`src/browser_bridge/relay.rs:63-83`** — the token is checked **before** the WebSocket upgrade,
  with the population written in the docstring: *"an arbitrary web page can reach this port, so the
  handshake is the gate."* The only handler in the app whose comment states its population correctly.

### What these routes have carried — from the live databases

Read-only copies, 2026-08-17, both deleted afterwards:

- **`external_api_keys`: 1,029 rows, every one named `system`**, every one with `bound_origin` NULL
  and `expires_at` NULL; 730 hold `["personas:read","personas:execute"]` and 299 add `proxy`;
  **exactly 1 live**. Confirms [least-privilege-scope-grant](./least-privilege-scope-grant.md) §7 D6
  exactly, including the 1,029 figure.
- **`api_key_audit`: 1 row, ever** — `POST /api/scrape/readable`, 200, 2026-07-08, origin
  `http://localhost:1420`. **That route is not in the router**; the current scraper route is
  `POST /api/scrape/query` (`management_api.rs:118`). The management API's entire recorded history is
  one request to a path it no longer serves.
- **`webhook_request_log`: 0 rows. `persona_triggers` with `trigger_type='webhook'`: 0.** So
  `POST /webhook/{id}` returns **404 at step 1** (`webhook.rs:291-303`) for every possible id, and
  the strongest integrity check in six codebases has never verified a signature. The trigger
  population that does exist is 189 `event_listener`, 68 `manual`, 55 `chain`, 32 `schedule`,
  7 `polling`.
- **`~/.claude/settings.json` contains zero `_fleet` markers**, so `POST /fleet/hooks/{event}` — a
  route whose installer writes its own URL into that file (`hook_install.rs:96-99`) — currently has
  no configured client either.
- **The unauthenticated read surface, by contrast, is fully populated**: 14 `dev_projects` with
  absolute root paths, 408 `dev_contexts`, 121 groups, 65 KPIs, 26 use cases, 1,306
  `workspace_knowledge` rows, 38 playbooks (§0.3).

**The distribution is the finding.** Every gated, audited, capped route on this install has carried
essentially nothing. Every route that has real data behind it is on the listener with no layer at all.

### Two independent implementations, and what they disagreed about

Route registrations were counted twice. A line-oriented `grep -c '\.route(\s*"'` returned **126**;
a whole-file structural extraction returned **130**. Hand-verification found the difference is four
lines carrying two registrations each (`dev_tools_http.rs:70` `get(...).post(...)`,
`management_api.rs:99` and `:103` likewise, plus one more) — the line count was wrong, exactly the
failure the contract warns about for per-line matching. **130 is correct and matches
[second-transport-exposure](./second-transport-exposure.md) at a different commit.**

A third check closed the opposite risk: a first structural pass returned **114**, because its
regex required a lookahead terminator and silently merged adjacent chained `.route()` calls —
`/health` absorbed `/navigate`, and `share_link.rs` disappeared entirely. **The version that
disagreed with the naive count in the "found fewer" direction was the wrong one**, and the tell was a
file vanishing rather than a number moving. Rewritten to segment on the next `.route(` start, the
structural pass agrees with the naive count at 130 and adds the per-route methods and handlers the
table needs.

### The oracle — five siblings

*(Filled from the sweep; see §12 for label corrections.)*

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every entry below reduces to one absence:
> **the mount returns nothing.** `register_router(prefix, router) -> ()` (`local_http/mod.rs:36`) is
> the moment a route's address comes into existence and the moment it is thrown away. Because it is
> thrown away, a client must re-type it (§0.4, 7.A), a document must re-type it (§0.5, 7.F), a
> comment must re-type it (§5), and no artifact can exist that would have let anyone notice a layer
> covers 3 routes of 34 (§0.7, 7.G). Give the mount a return value and 7.A, 7.F and most of §5
> become a call rather than a discipline.

### 7.A — P1: five expressions of one address, and the runtime override reaches one of them

Established in §0.4. The concrete consequences, each a live defect:

| Site | What breaks when the port moves |
|---|---|
| `engine/src/cli_mcp_config.rs:186` | `PERSONAS_API_KEY`'s bridge URL is written into `exec_dir/.claude/personas-mcp-config.json` on **every persona execution**. A second instance's personas call the first instance's credential proxy — or nothing. |
| `src/lib.rs:1745` | `PERSONAS_BRIDGE_URL` is exported process-wide and inherited by every child process the app spawns. |
| `src/mcp_server/tools.rs:674`, `:1466` | The `personas-mcp` sidecar's fallback when the env var is absent — so both halves of the bridge default to the same literal. |
| `src/engine/platforms/deploy.rs:319` | The webhook URL **written into a deployed GitHub integration**. Wrong here means an external system is configured to call a port this app is not on. |
| `src/commands/tools/triggers.rs:1791`, `:1844` | The URL used to re-fire a logged webhook delivery, and `:511` the "Active on …" string shown to the user. |
| `src/features/settings/sub_api_keys/libs/mcpServer.ts:8` | The base URL the user copies into their MCP client, under a docstring claiming single-sourcing. |
| `src/lib/utils/platform/triggerConstants.ts:211-212` | `getWebhookUrl()` — the address shown for every webhook trigger. Overridable only at **build** time. |

**Recall note, stated because it bounds §9:** an eighth Rust site,
`management_api.rs:1633`, writes the bare authority `"127.0.0.1:9420"` **with no `http://` prefix**,
so the §9 pattern does not see it. A vocabulary-based signal's recall is bounded by its author's word
list, and this is the miss.

**Fix (note, not applied):** give `register_router` a `MountedAt` return and `webhook_port()` a
sibling `webhook_base_url()`; make the two TypeScript constants read a value the backend supplies at
startup rather than declaring one.

### 7.B — P0: the webhook receiver's HMAC has no replay defence, and the replay defence exists 900 lines away

`POST /webhook/{trigger_id}` verifies HMAC-SHA256 constant-time, equalises the invalid-hex path
against timing analysis, refuses an unsigned request and refuses a trigger with no secret
(`webhook.rs:373-428`, `:537-559`). [`external-source-ingestion`](./external-source-ingestion.md)
§12.6 measured it as the strongest integrity check in six codebases and its §7.D owns the missing
freshness — **I confirm both and do not re-derive them.**

What this path adds is where the answer is: **`commands/credentials/oauth.rs` implements exactly the
missing control** — an HMAC-signed token carrying a timestamp, verified against
`OAUTH_STATE_MAX_AGE_SECS` (`:1232`, `:1325`), with a distinct `Expired` outcome so a stale-but-
authentic value is not silently accepted, plus first-valid-wins. Same crate. Same threat. Same
primitive family (`Hmac<Sha256>`). Neither file references the other, and there is no artifact in
which the two endpoints appear on adjacent rows.

**Live severity: latent.** 0 webhook triggers exist, so the route 404s before reaching the verifier.
Provable from source; never exercised.

### 7.C — P1: evaluating `push.rs`'s own argument

`push.rs:10-12` states its reasoning and the brief asked me to test it rather than repeat it:

> *"Loopback-only by virtue of `local_http` binding to 127.0.0.1; no nonce gate in v1 because no
> remote actor can reach the endpoint. A future hardening pass can layer per-app tokens on top."*

**The premise is true and three of its four load-bearing implications are false.**

1. **"No remote actor can reach the endpoint" is true and is not the question.** The population of
   `127.0.0.1:17400` is every process on this machine. That set is not incidental to this
   application: it *starts* headless Claude sessions (`context_generation.rs`), MCP sidecars, and —
   via `webbuild/devserver.rs:178` + a spawned `bun`/`next dev` — **web dev servers running code from
   whatever repository the operator is building**. The endpoint's reachable set therefore includes
   model-authored and third-party-authored code that this app launched. "Remote" was never the axis.
2. **The browser is a local actor, and nothing here defends against a rebound name.** A cross-origin
   `fetch` to this route is currently blocked — but not by anything anyone chose. `cli_event_handler`
   takes `Json<CliEventBody>` (`push.rs:99`); axum's `Json` extractor rejects with
   `MissingJsonContentType` unless the header parses as `application/json`
   (`axum-0.8.8/src/json.rs:107-108`, `json_content_type` at `:138-154`); `application/json` is not a
   CORS *simple* content type, so a cross-origin POST is preflighted; and `local_http` carries no CORS
   layer, so the preflight fails. **The guard is an extractor's content-type check standing in for a
   security control**, which means changing this handler to `Bytes` — a one-line refactor with no
   security-shaped review trigger — opens the route to any web page. And **a DNS-rebinding attack
   removes the cross-origin condition entirely**, against which there is no defence at all: `header::HOST`
   is read in exactly one place in 963 files (`management_api.rs:1630`) and that site *reflects* the
   value rather than validating it (§7.D).
3. **"A future hardening pass can layer per-app tokens on top" has nowhere to land.**
   `register_router(prefix, router)` accepts a bare `Router` and returns nothing, so the hardening
   pass would have to touch all five routers individually and would have no place to record that it
   had. **The sentence describes work the mount point cannot accept.**
4. **The debounce is not the bound the docstring implies.** *"Per-project debounce caps
   out-of-cadence runs at one per 5 minutes so a hot session can't starve the LLM budget"* (`:6-8`,
   `DEBOUNCE_INTERVAL` `:36`). Reading the handler: `do_push(...)` runs **first** (`:111-118`) and
   inserts the event row; `check_and_record_debounce` (`:120`) gates only
   `spawn_out_of_cadence_consolidator` (`:122`). The **LLM spend** is debounced; the **write** is
   not, and the write is unauthenticated and unbounded in rate. Correct claim, narrower than it reads.

**What survives:** the decision to ship without a nonce in v1 was defensible for the threat the
author was considering. The defect is that the argument was recorded in a comment in the router's own
file, where no future reader of `lib.rs`, `local_http/mod.rs` or any other mounted router will
encounter it.

### 7.D — P2: `GET /agent-card/{id}` publishes an address the caller chose

`host_origin_from_request` (`management_api.rs:1628-1635`) reads the request's `Host` header and
returns `format!("http://{host}")` with **no allowlist**; `get_agent_card` (`:1641-1654`) passes it
to `build_agent_card`, which writes it into `AgentCard.url` — the address an A2A client is told to
POST its JSON-RPC to. The unit test at `:2673-2678` asserts that `personas.local:8080` is echoed
verbatim, so the reflection is codified rather than accidental.

Mitigating: the route is behind `require_api_key`, so the caller holds a valid key; and `authorize()`
exempts `/agent-card/` from scope checks (`:338-340` — [least-privilege-scope-grant](./least-privilege-scope-grant.md)'s
territory, confirmed not re-derived), so **any** valid key reaches it. Aggravating: the fallback when
the header is absent is a **sixth** hardcoded `9420` that ignores `webhook_port()`.

**This is the only route in the application whose response content is chosen by the requester**, and
it is the route whose entire job is to state the app's own address. The comment at `:1633-1634`
anticipates a proxy and defers (*"Keep simple for now"*).

### 7.E — P2: three `/health` registrations, two live endpoints, one wrong version, and the identity answer already in the tree

| Registration | Live? | Body | Build identity |
|---|---|---|---|
| `webhook.rs:74` (in `start_webhook_server`) | **no** — the fallback start function; `background.rs` picks the other | `{"status":"ok","service":"personas-webhook"}` | none |
| `webhook.rs:130` (in `start_webhook_server_with_management`) | **yes** | same | none |
| `test_automation.rs:939` | **yes** | `{"status":"ok","server":"personas-test-automation","version":"0.2.0"}` | **a hardcoded literal — and the app is `1.1.0`** (`tauri.conf.json:4`, `package.json:3`, `Cargo.toml:18`) |

So the brief's "three `/health` endpoints and none reports build identity" is right in spirit and
wrong in three particulars, and the corrected version is sharper (§12.3): there are **two reachable
endpoints, not three**; one of them **does** report a version and **the version is wrong by a major
release**; and **the correct mechanism is already used twice in this repo** — `env!("CARGO_PKG_VERSION")`
at `browser_bridge/mcp.rs:23` and `companion/orchestration/mcp/mod.rs:71`, both feeding an MCP
`initialize` response. `env!` is the form [`compile-time-env-embedding`](./compile-time-env-embedding.md)
establishes *does* cross a build boundary, because an absent variable is a compile error.

**Two endpoints whose whole purpose is identity type it in by hand; two whose purpose is protocol
negotiation read it from the build.** Neither reports a commit SHA or a build timestamp — which
[`compile-time-env-embedding`](./compile-time-env-embedding.md) measured as a 6-of-6 fleet-wide
silence, so that half is not a Personas defect.

And the consumer defect (§0.6): `probe_mcp_server` reports the **webhook** listener's health as the
**MCP server's** status, and the response field that names the service is the field it discards
(`mcp_tools.rs:44-47`). The `personas-mcp` server is a stdio binary with no port.

### 7.F — P2: the published endpoint list omits both credential-bearing routes

`McpServerInfoPanel.tsx:22-40`. Six entries; the listener serves 34. Absent: `/api/proxy/{id}`,
`/api/broker/mint/{id}`, `/api/execute/{id}`, `/a2a/{id}`, `/agent-card/{id}`, all lab routes, all
version routes, both automation-settings routes, both webhook routes, both pairing routes.

The omission is not random and P9 says why: the list documents what the author was inviting MCP
clients to do (build sessions), and everything else on the port is invisible to the one artifact a
user reads before pointing a client at it. `:66` also hardcodes `port: 9420` in the failure branch, so
a down probe reports the default port rather than the one it probed.

### 7.G — P1: the body cap covers 3 of 34 routes on its own listener

Established at §0.7. Restated here as a backlog item because it is the cheapest real fix in this
document: move `.layer(DefaultBodyLimit::max(MAX_BODY_BYTES))` from `webhook.rs:131` to after the
two `.merge()` calls at `:133`/`:136`. That single move takes the app's stated intake ceiling from
3 routes to 34.

**Not applied.** It changes what a live listener accepts — 29 routes would go from axum's 2 MB
default to 1 MB — and per the campaign's standing rule that is a behaviour change on a surface the
operator uses daily. It also interacts with
[`external-source-ingestion`](./external-source-ingestion.md) §7.A's two-ceilings finding: the door's
1 MB already sits 16× above the repository's 64 KiB payload ceiling, and widening the door's
*coverage* without pushing the number down into the store adds a fifth place that holds the same
constant. **The right fix is the one that path names — one ceiling in the store — and the placement
move is the interim.**

### 7.H — P2: `local_http` has no layer of any kind, and the ordering defect is why that is not obviously worse

`grep -c '\.layer('` over `local_http/mod.rs`, `dev_tools_http.rs`, `hooks.rs`, `push.rs`,
`browser_bridge/mod.rs` and `orchestration/mcp/mod.rs` returns **0, 0, 0, 0, 0, 0**. Thirty-six live
routes, no auth, no CORS, no body limit, no timeout, no request log.

The connection to 7.G is worth stating: `local_http::start` composes the five routers with `.nest()`
(`:77`) into a fresh `Router::new()` (`:69`) and serves it (`:87`) — **and because nothing is layered
there, a future `.layer()` added at `:86` would actually cover everything**, since all the nesting
already happened. `local_http` is the one listener in this app where the correct composition is one
line away, and the one where nobody has written it.

### 7.I — P3: every unauthenticated error is a 500 carrying the internal message

`dev_tools_http.rs:118-120`:

```rust
fn err(e: AppError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
```

It is the error arm for essentially all 31 routes (the one exception, `require_project` at `:608-616`,
returns a correct 404 with a designed message and its docstring explains why — *"An empty collection
must mean empty, not absent"*). So a validation refusal, a missing row and a database failure are
indistinguishable to a client, and the raw internal message — which for a repo-layer error can carry
a SQL fragment or a path — is returned to a caller that presented no credential.

`push.rs` is the counter-example on the same listener: 503 with a typed body when the handle is
uninitialised (`:100-109`), 200 with a typed body otherwise.

### 7.J — P3: what this path cleared

- **The five nested routers on `local_http` are correctly refused if they register late**
  (`local_http/mod.rs:41-47`), with a warning naming the prefix. A mount-time mistake is observable
  here and nowhere else.
- **`management_router`'s composition is right and survived.** Its auth and CORS layers are applied
  to its own router before the merge, which is why 29 routes kept their middleware through the exact
  operation that dropped the body cap.
- **The pairing router's permissive CORS is deliberate, documented, and correct for its threat
  model** (`pairing.rs:341-345`). Two opposite CORS policies on one socket, each explained.
- **`browser_bridge/relay.rs:63-83` checks the token before the WebSocket upgrade** and states its
  population in the docstring. It is the only handler in the app that gets both right.
- **The four `dev_tools_http` query parameters are all parameterized at the repository layer**
  (`repos/dev_tools.rs:6719-6737` binds `?1`/`?2`). [sql-console](./sql-console.md)'s conclusion that
  the unauthenticated transport does not reach a query executor **holds** — only its premise was
  wrong (§12.2).
- **No inbound listener is bound to a non-loopback address in this build.** `companion_api`'s
  `0.0.0.0` and P2P's `[::]` are real and are [second-transport-exposure](./second-transport-exposure.md)
  §7.H's; neither is running here, confirmed against the OS.

---

## 8. Gaps in the primitive

1. **`register_router` returns `()`.** The single upstream cause. It is the only moment in the
   process where prefix, router and (eventually) port are all in scope, and it discards the
   composition. Everything in §0.4, §0.5 and §5's comment row is downstream.
2. **`local_http::port()` answers half the question.** It is the good half — 7 callers ask it — and
   because it answers only the port, all 7 concatenate a prefix literal. **An accessor that returns
   part of an address teaches callers to assemble the rest.** This is the sharpest local instance of
   the doctrine's Q6: the API withheld the wrong half.
3. **No type expresses layer coverage.** `.layer()` and `.merge()` both return `Router`, by design,
   so "this middleware covers every route in this router" is unrepresentable in any signature. §0.7's
   defect can only be caught by a test that composes the router and asserts a property per route —
   which is possible in axum (build the router, drive it with `tower::ServiceExt::oneshot`) and does
   not exist here.
4. **`webhook_port()` has no URL sibling.** It answers "which port" and 8 sites needed "which URL".
   The missing primitive is `webhook_base_url() -> String`, after which 7.A is a mechanical
   substitution.
5. **The frontend cannot ask.** `MCP_BASE_URL` and `WEBHOOK_BASE_URL` are compile-time and build-time
   constants because there is no IPC command that returns the app's own listener addresses. One
   command returning `{ management: String, local_http: String }` would delete both constants and
   both clocks. Nothing prevents it; nobody needed it badly enough while the default held.
6. **A route inventory cannot be a route census.** Two of this app's inbound HTTP listeners register
   no route (§0.2). Any instrument that walks `.route(` is structurally blind to them, including this
   path's §9 rule. The complementary instrument is a socket-level enumeration, which is a test or a
   check script, not a count.
7. **Nothing machine-checkable decides whether a route table is *complete*.** "Every served route
   appears in the table" is an absence over a set, and the census cannot assert an absence — the same
   wall [`telemetry-scrubbing`](./telemetry-scrubbing.md) §8 Gap 5 and [`sql-console`](./sql-console.md)
   §8.4 hit from their own directions. §9 counts a different, countable thing and says so.

---

## 9. The missing gate

Every deviation above ships green under `npm run check`, under
`cargo test --manifest-path src-tauri/Cargo.toml --features desktop`, and under the existing census.

**Existing rules checked for overlap** — every rule in `scripts/census/rules.json` was read (**152**
at first pass, **153** on re-check twenty minutes later, because sibling composers are merging into
the same registry concurrently — read the current count, do not trust either), and every rule whose
signature could plausibly touch routing, listeners or addresses was examined by name. Only **two**
rule ids in the whole registry name this territory (`pinned-harness-endpoint`,
`unauthenticated-transport-route`) and only **five** patterns match `http://|127.0.0.1|localhost|.route(|Router|axum|bind`
at all:

| Rule | Roots | Why it does not collide |
|---|---|---|
| `unauthenticated-transport-route` (second-transport-exposure) | `src-tauri` | Anchors on `\.route\(\s*"`. **Site overlap with this rule: 0** — a route registration and a URL string literal cannot be the same match. Different condition, different unit. |
| `pinned-harness-endpoint` | `tools,tests,scripts,uat` | The nearest condition in the registry — hardcoded `:1732x` URLs — but on the **client** side of the harness, in four roots this rule does not walk. **Root overlap: 0.** Its existence is evidence the condition is real; this rule is its server-side complement. |
| `unbounded-foreign-decode` (external-source-ingestion) | `src-tauri` | Anchors on `serde_json::from_str/slice` over wire buffers. Claims `webhook.rs`, `companion_api.rs`. **Site overlap: 0**; and this rule adds no `exclude` on those files, so the deliberate no-exclude decision recorded there is untouched. |
| `build-gated-ipc-entrypoint`, `untyped-command-payload`, `persistence-handle-in-command-tree` | `src-tauri/src` | The primary transport's registration list and payload types. Disjoint conditions. |
| `env-default-conflates-unset-with-empty` | `src,scripts` | Touches `import.meta.env`, which §0.4 expression 4 also touches — but it keys on the *default* expression, not on an address literal, and does not walk `src-tauri`. |

**The condition the signal is a proxy for** (stated so an adopting repo can re-derive its own):
*a client of this application's own inbound endpoint restates that endpoint's address instead of
asking the module that bound it.* In this stack it manifests as a `http://127.0.0.1:PORT` string
literal naming one of the app's own service ports. In a Node service it would be a
`` `http://localhost:${3000}` `` or a `PORT` fallback duplicated outside the server module; in a
Python service, a `BASE_URL` constant beside `uvicorn.run(port=…)`. **Do not port the regex.**

**Why a count and not a type:** §4 answers the type question *yes* for the mount handle and measures
its reach honestly at **3 of 5 axum listeners and 36 of 116 live routes** — and it reaches **none**
of the 8 literals, because the listener they name has no mount handle to hand out. Ship both: the
handle as the fix, the rule as the ratchet on what the handle cannot reach.

**Signal.** A `http://` string literal whose host is loopback and whose port is one of this
application's own listener ports (`9420`, `1732x`, `174xx`, `1750x`).

**Mechanism.** A census rule. It runs under `npm run census` / `npm run census:check` — chained
inside `npm run check` and the `golden-path-census` pre-push lefthook job. Per the §9 calibration:
`ci.yml` is red on 10 pre-existing failures, so a CI-only gate runs nowhere; this runner executes.

```json
{
  "id": "hardcoded-own-listener-address",
  "goldenPath": "docs/concepts/golden-paths/inbound-endpoint-surface.md",
  "title": "A URL literal addressing one of this app's OWN inbound listeners by a hardcoded port, re-derived at the call site instead of asked of the module that bound it",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\"http://(?:127\\.0\\.0\\.1|localhost):(?:9420|1732\\d|174\\d\\d|1750\\d)[^\"]*\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A string literal naming one of THIS application's own inbound listeners by a hardcoded port. The port alternation is derived from the four bind sites, not imagined: 9420 = webhook_port()'s default (webhook.rs:50); 1732d covers test_automation's DEFAULT_PORT 17320 + FALLBACK_PORT_ATTEMPTS 5 (:1333, :1338); 174dd covers local_http's PREFERRED_PORT 17400 + PORT_SCAN_LIMIT 16 (local_http/mod.rs:22-23); 1750d covers companion_api's PREFERRED_PORT 17500 (:53). TWO KNOWN RECALL LIMITS, both currently empty: companion_api's scan window runs to 17515 and 1750d stops at 17509, and webhook_port() honours PERSONAS_WEBHOOK_PORT so a literal naming a NON-default management port is invisible - no such literal exists in the tree today. PROXY FOR the stack-free condition: a client of this app's own endpoint restates that endpoint's address instead of asking the module that bound it. THE COMPLIANT DOOR: engine/webhook.rs:45 webhook_port() (runtime-overridable via PERSONAS_WEBHOOK_PORT, added specifically so a second instance can bind elsewhere - see its comment at :42-44) and local_http/mod.rs:101 port() (the resolved port after a 16-port scan from 17400). MEASURED 2026-08-17 at 5d55d6a4a: 8 matches / 5 files violating against 11 matches / 6 files for the compliant form (the port interpolated at the call site), out of an anchor population of 51 loopback URL literals in 963 .rs files - the remaining 24 name FOREIGN services (ollama 11434, pocket-tts 8080, a browser test target 8765) and 2 are the CORS origin-prefix matchers at management_api.rs:180-181 that carry no port at all. 8+11+24+2 = 51, exact. PRECISION 8/8 hand-read, every one a live client: cli_mcp_config.rs:186 (written into the persona MCP config on EVERY execution), lib.rs:1745 (PERSONAS_BRIDGE_URL exported process-wide and inherited by every child), mcp_server/tools.rs:674 and :1466 (the sidecar's fallback), platforms/deploy.rs:319 (the URL written into a DEPLOYED GitHub webhook), triggers.rs:1304, :1791, :1844. NONE of the eight honours PERSONAS_WEBHOOK_PORT; webhook_port() has exactly one non-bind caller in the tree (mcp_tools.rs:38). RECALL IS DELIBERATELY PARTIAL AND MEASURED: the pattern requires the http:// scheme, so management_api.rs:1633's bare authority \"127.0.0.1:9420\" (the Host-header fallback, section 7.D) is missed - one real site. Dropping the scheme requirement pulls in every host:port pair in the tree. The narrow form was chosen; extend it deliberately and re-measure both halves. DO NOT 'fix' a match by moving the literal into a const - that preserves the defect exactly and is how mcpServer.ts:8 came to carry a 'single source of truth' docstring above the third copy of the value. LEGAL FIX: ask webhook_port() / local_http::port(); better, give register_router a MountedAt return value whose url(path) accessor is the only way to learn an address (section 4). END OF LIFE: designed to reach zero; the runner fails structurally on zero matches BY DESIGN - DELETE this rule then, do not baseline it at 0. PRECONDITION (re-derive per repo, do NOT port): in Node this condition wears `http://localhost:${PORT}` assembled outside the server module, or a BASE_URL const beside app.listen(); in Python a BASE_URL beside uvicorn.run(port=). This regex scores ZERO on both."
  },
  "exclude": [
    { "path": "src-tauri/src/engine/management_api.rs", "reason": "the router's own module: its three matches (:2607, :2609, :2668) are #[cfg(test)] fixtures for the CORS-origin predicate and build_agent_card, asserting behaviour ABOUT the address rather than addressing the server" },
    { "path": "src-tauri/engine/src/a2a/types.rs", "reason": "two #[cfg(test)] AgentCard serialization fixtures (:470, :491); the literal is asserted output, not a request target" },
    { "path": "src-tauri/core/src/url_safety.rs", "reason": "one #[cfg(test)] SSRF fixture (:293) asserting that this very address is REFUSED by validate_url_safety — the inverse of a client, and the only place in the tree where hardcoding it is the point" }
  ],
  "baseline": { "files": 5, "matches": 8 },
  "floor": 900
}
```

**The positive control** — same anchor, pointed at the compliant form, no baseline:

```json
{
  "id": "hardcoded-own-listener-address-positive-control",
  "goldenPath": "docs/concepts/golden-paths/inbound-endpoint-surface.md",
  "title": "POSITIVE CONTROL — not a gate. The same loopback-URL-literal anchor with the port resolved at runtime: the compliant form the rule must never report.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\"http://(?:127\\.0\\.0\\.1|localhost):\\{[^\"]*\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "CONTROL: the same loopback URL literal with the port INTERPOLATED rather than typed — the shape that asks instead of assuming. THE TWO POPULATIONS ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION: a port cannot be both a digit run and a '{'. Measured 2026-08-17 at 5d55d6a4a: 11 matches / 6 files. Six target THIS app's own listeners and ask for the port (browser_bridge/mod.rs:194 local_http::port(); commands/credentials/mcp_tools.rs:39 webhook_port(); commands/fleet/pty.rs:572 local_http::port(); oauth.rs:203, :591, :1756 the ephemeral OAuth callback's kernel-assigned port). Five target a dev server this app SPAWNS on an allocated port (webbuild/devserver.rs:104, :121, :141; dev_tools/competitions.rs:1058, :1149) and are the same compliant shape for the same reason — the port is asked for, not assumed. IF THIS EVER RETURNS ~0 the anchor has stopped discriminating and the rule's 8 are not what it thinks they are. It has NO baseline by design: it is expected to RISE as call sites migrate, which is exactly why it must never ratchet.",
    "$measured": "2026-08-17 @ 5d55d6a4a via scripts/census/run-census.mjs in a private scratch registry (rules-ies-inbound-endpoint-surface-probe.json), fault-injected nine ways, then re-extracted from this finished document and re-run: identical."
  },
  "floor": 900
}
```

**Measured, in a private scratch registry, then re-extracted from this document and re-run —
identical both times:**

```
hardcoded-own-listener-address                    5 files    8 matches   (base 5 / 8)    walked 963   floor 900
hardcoded-own-listener-address-positive-control   6 files   11 matches   (no baseline)   walked 963   floor 900
census OK — 2 rule(s), 1926 file-visits, 19 surviving violation(s) across 11 file(s).
```

**The anchor accounts exactly.** The full population of loopback URL literals in 963 `.rs` files is
**51**: 8 violating + 11 compliant + 24 naming a foreign service (ollama, pocket-tts, a browser test
target, healthcheck fixtures) + 2 CORS origin-prefix matchers carrying no port
(`management_api.rs:180-181`). No residue.

**Precision, hand-audited, all 8: 8/8.** Every match is a live client that will address the wrong
server the moment `PERSONAS_WEBHOOK_PORT` is set — which is the documented, supported path for
running two instances on one machine.

**Allowlist.** The three `exclude` entries, each naming *why* that file's literals are not clients.
All three are `#[cfg(test)]` populations the engine cannot strip; `url_safety.rs` is the load-bearing
one a reviewer should re-check on any change, because it is the single place in the tree where
hardcoding this address is correct by design.

**How it fails loudly if its own precondition is absent — nine faults injected, every one fired**
(each run's exit code captured directly, never through a pipe):

| Induced fault | exit | what it printed |
|---|---:|---|
| **(unmodified)** | **0** | `OK hardcoded-own-listener-address 5 5 8 8 963 900` · `OK …-positive-control 6 — 11 — 963 900` |
| pattern rewritten to match nothing | 1 | `[structural] matched zero files anywhere … DELETE the rule … rather than baselining it at zero` |
| `floor: 99999` | 1 | `walked 963 files but floor is 99999. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots: ["src-tauri/does_not_exist"]` | 1 | `walked 0 files but floor is 900` **and** all three stale-exclude errors |
| an `exclude` path that no longer exists | 1 | `exclude "…management_api_DELETED.rs" matched no file. The exemption is stale` |
| an `exclude` with its `reason` removed | 1 | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| baseline 1 low (simulating a rise) | 1 | `FAIL … matches 8 (base 7)` |
| baseline 40 (simulating a silent drop) | 1 | `matches dropped 40 -> 8 (-32) without the baseline moving. A silent drop is a broken matcher more often than fixed code` |
| a baseline added to the positive control | 1 | `a positive control must NOT carry a baseline — it exists to fail` |
| **a REAL violation appended to `src-tauri/src/local_http/mod.rs`** (`const _CENSUS_PROBE: &str = "http://127.0.0.1:9420/probe";`) | **1** | `FAIL … files 6 (base 5) matches 9 (base 8)` · `files rose 5 -> 6 (+1). New violations of docs/concepts/golden-paths/inbound-endpoint-surface.md` — **reverted with `git checkout --`; `git status --porcelain` on that path empty; re-run returned to 5/8, exit 0** |

**What no gate can do.** Nothing machine-checkable decides whether a route table is *complete*, and
that is the condition this leaf most wants gated. Three of this document's findings are absences and
none is countable: that no artifact enumerates the served surface, that `local_http` carries no
layer, and that two inbound listeners have no routes. The complementary instruments, specified rather
than built:

1. **A composition test.** Build the real router the way `webhook.rs:127-138` does, then drive every
   registered path with `tower::ServiceExt::oneshot` and a 2 MB body, asserting the response is 413.
   That single test fails today on 31 of 34 routes and is the only instrument that can see §0.7 —
   a layer's coverage is not expressible in any type and not visible to any regex.
   **Cost, measured:** `tower 0.5.3` is already in `Cargo.lock` (transitively, via axum/tower-http)
   but is **not** a direct dependency, so this needs `tower = { version = "0.5", features = ["util"] }`
   and `http-body-util` added to `src-tauri`'s `[dev-dependencies]` (`Cargo.toml:299`). Two lines of
   manifest for the only instrument in this document that can observe the P0.
2. **A listener assertion.** `assert!(register_router_call_sites == axum_serve_call_sites - 2)` with
   the two hand-rolled OAuth servers named, in `local_http`'s own test module. It fails the day
   somebody adds a sixth listener without deciding which host it belongs on.
3. **A generated route table**, emitted at startup into `tracing::info!` or a debug command, listing
   every mounted path with its listener and layer stack — the `check-csp-hosts.mjs`-shaped instrument
   [`telemetry-scrubbing`](./telemetry-scrubbing.md) §9 specifies for egress channels, applied to
   ingress. It is the one artifact that would make §0.5, §0.7 and §7.F visible at once, and P9 says
   it must be generated rather than written.

---

## 12. Corrections to the brief

The brief primed six leads. **Four survive unchanged, one is materially wrong, and one is right in
spirit and wrong in every particular — in a direction that makes it sharper.** Both spine labels
fail.

**1. `sides: "client"` is wrong, and this is the fifth consecutive inversion — but it is the first
one with a real client half.** The headline defects are all server-side: the layer/merge ordering
(`webhook.rs:131`), the five address expressions (8 of 10 in Rust), every unauthenticated route,
the `Host` reflection, the `/health` version, the error arm. Measured density: **8 own-address
literals in 963 `.rs` files (0.83%) against 2 in 4,829 `.ts`/`.tsx` files (0.04%) — 20× toward the
server**, and the §9 rule roots at `src-tauri`. *However*: the only artifact in the entire repository
that resembles a route table is a **TypeScript array in a settings panel** (§0.5, §7.F), and one of
the two clocks in §0.4 is a **Vite build-time variable**. The honest label is **both**; if forced to
one it is **server**. Four of four prior leaves reported this field contradicted with the answer
wholly on the server; this is the first where narrowing to `client` would have missed the headline
*and* narrowing to `server` would have missed a genuine deviation.

**2. "`dev_tools_http` (31 routes, none takes a query string — verified)" is FALSE, and the error is
inherited from a published path.** Four handlers in that file take `Query<…>`:
`patterns_index` (`:202`), `patterns_consult` (`:232`), `list_kpis` (`:620`) and `list_use_cases`
(`:1118`). **The module's own header documents one of them** — `//! GET /kpis/{project_id}?status=proposed`
at `dev_tools_http.rs:21`. The claim traces to [`sql-console`](./sql-console.md) §12.3
(*"All 31 `.route(` registrations in `dev_tools_http.rs` were enumerated. Zero take a query string"*),
which the brief carried forward.

**That path's conclusion nevertheless holds**, and this is the instructive part. It concluded *"the
unauthenticated transport does not reach this leaf"* — i.e. no caller-authored SQL — and that is
correct: all four parameters land in `repos/dev_tools.rs` calls that bind `?1`/`?2`
(`:6719-6737`), and `resolve_scope` reads them as workspace/project ids. **A false premise whose
conclusion survives is the hardest kind to notice, because nothing downstream ever contradicts it.**
The correction is owed in `sql-console.md` §12.3, and the query-string surface is: **7 axum `Query<…>`
extractors** app-wide (`dev_tools_http` ×4, `management_api.rs:960`, `pairing.rs:308`,
`browser_bridge/relay.rs:68`) **plus one hand-rolled `url.query_pairs()` parser** in the OAuth
callback (`oauth.rs:261-278`) — and the hand-rolled one is the only query surface in the app carrying
an authentication value.

**3. "Three `/health` endpoints exist and none reports build identity" — right in spirit, wrong in
three particulars, and the corrected version is a better finding.** There are **three registrations
but two reachable endpoints**: `webhook.rs:74` and `:130` are the same route in two mutually
exclusive start functions, and `background.rs` picks one. One of the two live endpoints **does**
report a version — `test_automation.rs:939` answers `"version":"0.2.0"` while the app is **1.1.0**
(`tauri.conf.json:4`, `package.json:3`, `Cargo.toml:18`), so it is not silent, it is **wrong by a
major release**. And the correct mechanism is **already used twice in this tree**:
`env!("CARGO_PKG_VERSION")` at `browser_bridge/mcp.rs:23` and `orchestration/mcp/mod.rs:71`, both
feeding an MCP `initialize`. **The identity answer exists on two routes; the three routes whose whole
job is identity type it in by hand.** (No endpoint reports a commit SHA — but
[`compile-time-env-embedding`](./compile-time-env-embedding.md) measured that as a 6-of-6 fleet
silence, so it is not a Personas defect.)

**4. "`dev_tools_http.rs:468-510` is unauthenticated on loopback and spawns a billed subprocess" —
confirmed unchanged** at `5d55d6a4a` (`create_project` `:467-483`, `scan_codebase` `:500-509` →
`launch_context_scan`). Owned by [second-transport-exposure](./second-transport-exposure.md) §7.A;
not re-derived. What this path adds is the denominator: it is **31 of the 36 routes on that
listener**, and the listener carries **zero `.layer(` calls**, so there is no place a fix could be
applied once.

**One number in that path's table is off by two, in the direction that understates the write side.**
It records the `dev-tools` router as *"(15 reads)"*. Extracted structurally with methods, the split is
**13 GET-serving paths and 19 POST-serving, 32 method handlers on 31 registrations** — `/projects`
(`:70`) is `get(list_projects).post(create_project)` and serves both. The unauthenticated **write**
surface on that listener is 19 doors, not 16. Minor, and worth recording because it is the same unit
error as P3: *registrations* and *method handlers* are different counts and the table needs the
second one.

**5. "`management_api.rs:386-392` returns `Ok(())` for any `GET|HEAD|OPTIONS` under `/api/`, so the
`personas:read` scope on all 1,029 keys is structurally meaningless" — confirmed exactly, including
the 1,029.** My independent count of `external_api_keys` returns **1,029 rows, all named `system`,
all carrying `personas:read`**, split 730/299 on the two scope sets, all with NULL `bound_origin` and
NULL `expires_at`, exactly 1 live. This is [least-privilege-scope-grant](./least-privilege-scope-grant.md)
§7 D6 and **its fix is deliberately withheld there** as *"a security control whose current setting may
be deliberate."* **I inherit that withholding.** One observation to add from this leaf's angle: the
scope is not merely unused in `authorize()` — it is **offered to the user as a toggle** in
`CreateApiKeyDialog.tsx:26`, so the UI presents a restriction the router does not impose. That is P9's
shape (a hand-written surface description diverging from the mount) applied to a scope list rather
than a route list.

**6. "`project_tracking/push.rs` mounts `POST /cli-event` with 'no nonce gate in v1 because no remote
actor can reach the endpoint' — evaluate the argument" — evaluated in §7.C. The premise is true; the
conclusion fails on four counts**, the sharpest being that this application *starts the processes
that can reach the socket* (headless model sessions, MCP sidecars, and `bun`/`next` dev servers
running code from the operator's own repositories via `webbuild/devserver.rs:178`), and that the
promised "future hardening pass" has **nowhere to land** because `register_router` accepts a bare
`Router` and returns nothing. Also corrected: the docstring's debounce claim is narrower than it
reads — `do_push` inserts the event **before** the debounce check (`push.rs:111-120`), so the LLM
spend is capped and the unauthenticated write is not.

**7. "The webhook receiver's HMAC is the strongest integrity check in six codebases and has no replay
defence" — confirmed, owned by [external-source-ingestion](./external-source-ingestion.md) §7.D, not
re-derived. What is new is that the missing control is implemented in the same crate.**
`oauth.rs`'s HMAC-signed, timestamped, freshness-checked, first-valid-wins `state` (`:281-317`,
`:1232`, `:1285-1330`) is precisely the defence `webhook.rs` lacks. Two endpoints, one crate, one
threat, one primitive family, no artifact in which they appear together. And confirmed from data:
**0 `webhook_request_log` rows and 0 webhook triggers**, so the route 404s at
`webhook.rs:291-303` before reaching the verifier.

**8. "The MCP server is 3,243 lines, 33 handlers, zero redaction; `personas_result` returns
`tool_steps`" — cited, not re-derived**, per instruction. It is
[telemetry-scrubbing](./telemetry-scrubbing.md) §7 P1 (`mcp_server/tools.rs:1812`), whose fix is
explicitly deferred as *"this changes what a live surface returns."* This path adds only the routing
fact that path did not need: **that server is stdio, but two of its shape are HTTP** —
`POST /mcp/rpc` (4 `athena.*` tools) and `POST /browser-bridge/mcp` (9 browser tools) are JSON-RPC
endpoints on `local_http`, and their `tools/list` and `initialize` answer **unauthenticated by
design** (`orchestration/mcp/mod.rs:244-255`), disclosing the full tool inventory and schemas to any
process on the machine.

**9. A correction to my own instrument, recorded because it nearly shipped.** My first structural
route extractor returned **114** routes against the naive line count's 126 and the sibling path's 130.
I could have reported "the tree changed since `d74fae3c9`." It had not: the extractor's terminator
lookahead let adjacent chained `.route()` calls merge, so `/health` swallowed `/navigate` and
`share_link.rs` **disappeared from the output entirely**. The tell was not the number — a number can
legitimately move — it was **a file vanishing**. Rewritten to segment on the next `.route(` start, it
agrees with the naive count at 130. *A measurement that disagrees with a published one in the
"found fewer" direction should be suspected before the tree is.*

**10. A prediction of my own, disproved.** I expected the worst inbound endpoint in this app to be
one of the 82 unauthenticated routes. The unauthenticated routes are a real P0 and they are somebody
else's leaf. **The endpoint that surprised me is the one with no route at all** — the OAuth callback,
which is simultaneously invisible to every instrument in the corpus *and* the only inbound endpoint
in the application that bounds time, attempts, bytes and replay. The route table's most important
property is not what it says about the routes; it is that two of the listeners were never in it.

**11. The spine's `convergence: diverged` label and the sibling sweep are reported in §6.** Any clause
without external warrant is labelled a house convention there rather than promoted by silence.
