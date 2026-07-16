# External integrations (inbound 3rd-party connectivity)

> How **external apps drive Personas** — over HTTP, MCP, or A2A — to generate agents
> and run tasks. This is the *inbound* surface (someone else calling Personas). For
> *outbound* credentials Personas uses to call third-party providers, see
> [`connections/`](../connections/README.md) (vault) and Settings → Custom Models (BYOM).
>
> **Status (2026-07-05):** Directions 5 (capability tokens) and 1 (pairing bridge)
> are shipped. Directions 2/3/4 are backlog (see [§8](#8-road--backlog)). Full design:
> [`docs/architecture/cloud-integration-bridge.md`](../../architecture/cloud-integration-bridge.md).
> HTTP contract: [`docs/api/management-api.openapi.yaml`](../../api/management-api.openapi.yaml).

## 1. The three surfaces

| Surface | Transport | Who uses it | Reach |
| --- | --- | --- | --- |
| **Management HTTP API** | HTTP on `127.0.0.1:9420` | CLI/scripts, MCP sidecar, A2A clients, **paired cloud web apps** | loopback (+ paired browser origins) |
| **MCP server** (`personas-mcp`) | stdio (JSON-RPC 2.0) | Claude Desktop, Cursor, Claude Code | same-machine only |
| **A2A gateway** | HTTP JSON-RPC on `:9420` | agent-to-agent meshes | loopback (+ paired) |

All three ride the same axum server on `:9420` (started in `engine/webhook.rs`,
routes in `engine/management_api.rs` + `engine/pairing.rs`). It is **plain HTTP,
loopback-only, always-on** (no TLS — loopback is a browser secure context).

## 2. Management HTTP API

Extends the webhook server with `/api/*` routes. The integration-relevant surface
(full list in the OpenAPI spec):

- `GET /health` — liveness (unauthenticated).
- `GET /api/personas`, `/api/personas/{id}` — list / read.
- `POST /api/execute/{id}` — **execute a persona** (non-blocking → `execution_id`).
- `GET /api/executions`, `/api/executions/{id}` — poll status + output.
- `POST /api/build` (+ `/answer` `/test` `/promote`) — **LLM-driven persona creation**.
- `POST /api/proxy/{credential_id}` — credential proxy (injects secrets server-side).
- `GET /agent-card/{id}`, `POST /a2a/{id}` — A2A discovery + JSON-RPC.
- Lab / versions / automation-settings routes (see spec).

Every `/api/*`, `/a2a/*`, `/agent-card/*` request needs
`Authorization: Bearer pk_<32hex>`. The desktop frontend authenticates to its own
server with a process-rotated **"system" key**.

## 3. Capability tokens (Direction 5 — shipped)

External keys are least-privilege, time-boxed, origin-aware, and auditable.
Managed in **Settings → API Keys** (`src/features/settings/sub_api_keys/`).

- **Scope grammar** (resource-aware — `engine/management_api.rs::authorize`):
  - `personas:read` — list/read (implicit for GETs).
  - `personas:execute` / `personas:execute:persona:<id>` — execute any / one persona.
    The key-creation UI **only mints per-persona grants** (no blanket execute; the
    broad scope stays a backend/system-key primitive).
  - `personas:build` — the build flow.
  - `proxy` / `proxy:credential:<id>` — the credential proxy is gated on its **own**
    scope, **not** `personas:execute` (closes the "execute ⇒ secret-bearing outbound
    request" hole). Only the system key holds broad `proxy`.
- **Expiry** — `expires_at` (7/30/90 d or never), enforced fail-closed in
  `find_by_token`. Rows show an "expires in Nd" / "Expired" chip.
- **Origin-binding** — `bound_origin`; a browser key only works from its origin
  (CORS + server-side check). Set by pairing.
- **Per-key audit** — `api_key_audit` (method/path/status/persona/origin, capped
  500/key) surfaced in the row's **Activity** drawer. Per-key rate limit
  120 req/60 s → 429 + `Retry-After`.

Backend: `db/repos/resources/{external_api_keys,api_key_audit}.rs`,
`commands/credentials/external_api_keys.rs`. Data model in
`db/migrations/initial.rs` (`external_api_keys`, `api_key_audit`).

## 4. Pairing bridge (Direction 1 — shipped)

Lets a **cloud web app in the user's browser** drive the local API from its own
origin, after a one-time user-approved pairing. Flow (`engine/pairing.rs`):

1. The cloud app opens `personas://pair?origin=…&scopes=…&nonce=…&name=…` (deep
   link, handled in `lib.rs`) **or** `POST`s `http://127.0.0.1:9420/pair/request`
   (authoritative origin = the request `Origin` header). Both register a pending
   pairing keyed by the cloud-app nonce and raise **PairApprovalModal** (mounted at
   the app root; `src/features/settings/sub_api_keys/PairApprovalModal.tsx`).
2. The user reviews the origin (non-HTTPS is flagged), narrows scopes, picks an
   expiry, and approves → `approve_pairing` mints an **origin-bound** key and calls
   `add_paired_origin` (live CORS allowlist).
3. The cloud app claims its token **exactly once** at `GET /pair/claim?nonce=…` —
   only from the approved origin. The token is never in the deep-link query string.

Transport: the management CORS layer allows trusted loopback origins **plus** paired
origins and emits `Access-Control-Allow-Private-Network: true` (Chrome PNA). `/pair/*`
uses permissive CORS (nonce + user approval are the gate). Paired origins persist as
`bound_origin`, re-warmed at server start.

**Connected apps** (Settings → API Keys) lists paired keys with **Disconnect**
(`revoke_pairing`). Commands: `list_pending_pairings` / `approve_pairing` /
`reject_pairing` / `revoke_pairing`.

## 5. MCP server (`personas-mcp`)

A Rust binary (`src-tauri/src/mcp_bin.rs`, server in `src-tauri/src/mcp_server/`,
compiled from the single `app_lib::mcp_server` copy) exposing ~30 tools (personas
CRUD/execute, knowledge, lab, drive sandbox, codebase context, vault-backed
Gmail/Drive/Calendar/Obsidian) over **stdio** to Claude Desktop / Cursor / Claude
Code. It attaches to `personas.db` through the app's own repository layer
(`personas::create`, `executions::create`, `events::publish`), so **persona
create + execute are direct DB writes** — a persona execute queues an execution
row and publishes an `mcp_execute` event that the app's background loop picks up;
this works app-closed and does **not** proxy to `:9420`. Only the **secret-bearing
connector tools** (Gmail/Drive/Calendar/Obsidian bridge reads) proxy to `:9420`,
where the credential proxy injects stored secrets server-side.

**Auth:** tool calls require a `pk_` capability token (env `PERSONAS_MCP_TOKEN`
or `--token`), validated against the same `external_api_keys` registry as the
HTTP surface (scope `personas:execute`, audited per key). `personas-mcp install`
provisions one and writes it into the generated `mcp.json` env block. `initialize`
/ `tools/list` stay open so the client can render an auth error.

**No network transport** — same-machine only.
See [`../../architecture/mcp-desktop-integration.md`].

Personas is also an MCP *client* (consumes external MCP servers as "MCP gateway"
credentials — that's an outbound/vault concern).

## 6. A2A gateway

`GET /agent-card/{id}` (capability discovery) + `POST /a2a/{id}` (JSON-RPC:
`message/send` sync, `tasks/get`, `tasks/cancel`), gated per-persona by
`gateway_exposure`. `message/send` is **synchronous**; streaming is a backlog item.

## 7. Developer contract

- **OpenAPI 3.1** — [`docs/api/management-api.openapi.yaml`](../../api/management-api.openapi.yaml).
- **Reference SDK** — [`sdk/personas-sdk.ts`](../../../sdk/personas-sdk.ts): a
  zero-dependency `PersonasClient` (`execute`/`waitForExecution`/`run`) + a `pair()`
  helper. Single-file; a published `@personas/sdk` is a backlog item.

## 8. Roadmap / backlog

Deliberately deferred until the app is more established/adopted. Revisit and reprioritize here.

| Item | What | Why deferred |
| --- | --- | --- |
| **Direction 2 — Cloud relay / reverse tunnel** | Desktop opens an outbound WS/QUIC to a first-party relay (generalize the Smee webhook pattern; could ride the existing Supabase mirror) so cloud/mobile can reach the app through NAT/firewalls without inbound ports. E2E-encrypted envelope; device-bound key. | Only needed for mobile / cross-device / server-side callers; loopback pairing covers the browser case first. Introduces a hosted component + its own threat surface. |
| **Direction 3 — Remote Streamable-HTTP MCP + OAuth 2.1** | Add an HTTP/SSE MCP transport (spec's Streamable HTTP) with OAuth authorization-code flow, so remote MCP hosts (ChatGPT, hosted agents, other Personas) can consume the ~30 tools with least-privilege consent instead of copy-pasted bearer tokens. Reuses the existing tool impls; work is transport + auth. | The stdio MCP covers local hosts today; verify the current MCP transport/OAuth spec before building. |
| **Direction 4 — A2A streaming + push + discovery** | Implement `message/stream` (SSE — bridge the internal `execution-<id>` events), task push-notification webhooks (call back on completion), and `/.well-known/agent.json`. | A2A `message/send` (sync) works; streaming needs the engine to expose a synchronous-text streaming surface (there's a `TODO(a2a-streaming)`). |
| **TLS on loopback** | Optional locally-trusted cert for HTTPS on `:9420`. | Loopback HTTP is a browser secure context; not required for v1. Revisit only if binding beyond loopback (Direction 2). |
| **Published SDK package** | Promote `sdk/personas-sdk.ts` to `@personas/sdk` (build + types + tests + versioning). | Single-file reference is enough until there's external adoption. |
| **Broader resource scopes** | Extend per-resource scoping to lab/version/settings routes (currently broad `personas:execute`). | The high-value execute + proxy paths are scoped; the rest can wait for demand. |
| **Live E2E verification** | Drive the full browser → `pair()` → approve → claim → execute loop against a real cloud origin (deep-link registration only activates in an installed build). | Backend is unit-tested (~28 tests); the browser loop needs a real origin + build. |
| **Per-key audit retention/UI polish** | Configurable retention, filters, CSV export for `api_key_audit`. | Basic capped audit + drawer shipped; polish on demand. |

### Known issue (test-only, tracked separately)

`db::init_test_db` drops `external_api_keys` (+ `skills`, `healing_audit_log`,
`settings_audit_log`, `team_deliberations`) in the **test binary** — a pre-existing
migration-harness bug (production unaffected). New `run_incremental` ALTERs on those
tables must guard on `has_table`; repo tests use self-contained pools. Root-cause fix
is separate. See the ADR §9.

## 9. Where things live

| Concern | Files |
| --- | --- |
| HTTP server + routes | `src-tauri/src/engine/{webhook,management_api}.rs` |
| Pairing ceremony | `src-tauri/src/engine/pairing.rs`, `lib.rs` (deep-link) |
| Key auth / scopes / rate limit / audit | `engine/management_api.rs` (`authorize`, `require_api_key`, `PAIRED_ORIGINS`) |
| Key + audit persistence | `db/repos/resources/{external_api_keys,api_key_audit}.rs`, `db/migrations/initial.rs` |
| Commands | `commands/credentials/external_api_keys.rs` |
| Settings UI | `src/features/settings/sub_api_keys/`, `src/api/auth/{externalApiKeys,pairing}.ts` |
| MCP server | `src-tauri/src/{mcp_bin.rs,mcp_server/}` |
| Contract | `docs/api/management-api.openapi.yaml`, `sdk/personas-sdk.ts` |
| Design | `docs/architecture/cloud-integration-bridge.md` |
