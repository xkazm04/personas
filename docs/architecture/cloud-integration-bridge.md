# Cloud → local integration: pairing bridge + capability tokens

> **Status:** Proposed (2026-07-05). Design doc for **Direction 1** (browser-reachable
> local bridge with a pairing ceremony) and **Direction 5** (capability tokens +
> hardened developer surface) from the external-integration analysis.
>
> **Scope:** how a cloud web app running in the user's browser (e.g.
> `https://app.personas.example`) can securely drive the user's *local* Personas
> desktop app — create/build personas and submit tasks for execution — with
> least-privilege, user-consented, auditable access.
>
> Security-sensitive (auth / IPC / credential surface). Flagged for human review.

---

## 1. Context

Personas already exposes a local HTTP surface — the **management API** on
`127.0.0.1:9420` (`src-tauri/src/engine/management_api.rs`, mounted on the webhook
axum server). It authenticates callers with **external API keys** (`pk_<32hex>`,
SHA-256-hashed in `external_api_keys`, scopes enforced at request time) and already
carries execution (`POST /api/execute/{id}`), LLM-driven persona building
(`POST /api/build*`, `personas:build`), a credential proxy (`POST /api/proxy/{id}`),
and an A2A gateway (`/agent-card`, `/a2a`).

Two things block the "cloud web app in a browser talks to the local app" story, and
two things make exposing it unsafe today:

**Transport blockers**
- **CORS** rejects any non-loopback origin. `is_trusted_management_origin`
  (`management_api.rs:148`) allows only `tauri://localhost`, `http(s)://tauri.localhost`,
  and `http://localhost[:port]` / `http://127.0.0.1[:port]`. A cloud origin is
  refused at the CORS layer — the deliberate hard block.
- **Private Network Access (PNA):** Chrome now gates `public → private` (loopback)
  requests behind a preflight carrying `Access-Control-Request-Private-Network: true`,
  expecting `Access-Control-Allow-Private-Network: true` in response. The server
  emits neither. (Mixed content is *not* a blocker — browsers treat `127.0.0.1` as a
  secure context, so an `https://` page may fetch it once CORS/PNA allow it.)
- **No discovery / no consent:** the cloud app cannot find the right port or prove
  the user agreed to be driven.

**Control gaps (why exposing it as-is would be unsafe)**
- **Coarse scopes.** `personas:read` / `personas:execute` / `personas:build` are
  global. A single `personas:execute` key can execute **every** persona *and* drive
  the credential proxy. There is no per-persona / per-resource restriction.
- **No key expiry / rotation.** Keys live until manually revoked.
- **No API-route rate limiting.** Only the webhook trigger path is throttled.
- **No per-key action audit.** Only `last_used_at` is tracked — not *what* a key did.
- **Credential proxy is a sharp edge.** `/api/proxy/{credential_id}` lets any
  `personas:execute` key make outbound HTTP with the user's stored secrets injected
  server-side — an exfiltration vector gated only by a coarse scope.

The existing per-persona `gateway_exposure` column (default `local_only`, added for
A2A) is the precedent we generalize: **exposure and authority should be per-resource,
opt-in, and consented.**

## 2. Goals & non-goals

**Goals**
- A cloud web app can, after an explicit **one-time pairing** the user approves in
  the desktop app, call the local management API from its own HTTPS origin.
- Paired access is **least-privilege**: scoped to specific personas and specific
  capabilities, **time-boxed**, **origin-bound**, **revocable**, and **audited**.
- The token model is strong enough that exposing execution/build to a remote origin
  is safe by construction, not by obscurity.
- Ship a documented, versioned developer contract (OpenAPI + typed SDK) so external
  integrations build against a stable surface.

**Non-goals (this doc)**
- Remote relay / reverse tunnel for when localhost is unreachable (Direction 2).
- Remote Streamable-HTTP MCP + OAuth (Direction 3).
- A2A streaming / push (Direction 4).
- Changing the stdio `personas-mcp` binary.

Directions 1 & 5 are co-dependent: **Direction 5's token model is the substrate
Direction 1's pairing ceremony mints into.** So Direction 5 lands first.

---

## 3. Direction 5 — capability tokens & hardened surface

### 3.1 Data model

Extend `external_api_keys` (additive columns, incremental migration — the table is
created in `db/migrations/initial.rs:310`; new columns go through
`db/migrations/incremental.rs`'s `run_incremental` with `has_column` guards):

| Column | Type | Meaning |
|---|---|---|
| `expires_at` | `TEXT` (ISO 8601, nullable) | Hard expiry. `NULL` = non-expiring (legacy/system keys). Enforced in `find_by_token`. |
| `bound_origin` | `TEXT` (nullable) | If set, the key is only accepted when the request's `Origin` header equals this value. Set by the pairing ceremony (Direction 1). `NULL` = no origin binding (CLI/MCP keys that send no Origin). |
| `label` | `TEXT` (nullable) | Human note surfaced in the UI (e.g. "Paired: app.personas.example"). |

The `scopes` column is unchanged in shape (JSON string array) but gains a
**resource-scoped grammar** (§3.2). New `api_key_audit` table for per-key action
history:

```sql
CREATE TABLE IF NOT EXISTS api_key_audit (
    id          TEXT PRIMARY KEY,
    key_id      TEXT NOT NULL REFERENCES external_api_keys(id) ON DELETE CASCADE,
    at          TEXT NOT NULL DEFAULT (datetime('now')),
    method      TEXT NOT NULL,
    path        TEXT NOT NULL,
    status      INTEGER NOT NULL,       -- HTTP status returned
    persona_id  TEXT,                   -- resolved target if the route names one
    origin      TEXT                    -- request Origin, if any
);
CREATE INDEX IF NOT EXISTS idx_api_key_audit_key ON api_key_audit(key_id, at);
```

Audit rows are written best-effort in the `require_api_key` middleware **after** the
route resolves (so we know the status), bounded by a rolling retention (e.g. keep
last N per key / prune > 30 days) to avoid unbounded growth. Never logs bodies or
tokens — only the request line + outcome.

### 3.2 Resource-scoped grammar

Scopes become `<action>[:<resource-type>:<resource-id>]`:

| Scope | Grants |
|---|---|
| `personas:read` | list/read all personas + executions (unchanged) |
| `personas:execute` | execute **any** persona (legacy/system only — the key-creation UI no longer mints it; see posture note) |
| `personas:execute:persona:<id>` | execute **only** persona `<id>` |
| `personas:build` | drive any build session |
| `proxy:credential:<id>` | use the credential proxy **only** for credential `<id>` |
| `proxy` | credential proxy for any credential (broad; discouraged) |

Enforcement (`required_scope_for_request` → a richer `authorize`) becomes
**resource-aware**: for `POST /api/execute/{persona_id}`, a key satisfies the route
if it holds `personas:execute` **or** `personas:execute:persona:{persona_id}`. Same
pattern for the proxy. Back-compat: existing broad scopes keep working; resource
scopes are strictly additive narrowing. `parsed_scopes()` already fails closed on a
corrupt column.

> **Posture decision (2026-07-05): force explicit per-persona grants — no
> wildcard.** The broad `personas:execute` stays a *backend* primitive (the system
> key holds it; legacy keys keep working) but the **key-creation UI no longer offers
> a blanket "execute all personas" grant**. To make a key that can execute, the user
> selects specific personas, minting one `personas:execute:persona:<id>` per pick.
> There is no `execute:persona:*` wildcard. This is the strict least-privilege
> posture; it applies to every user-minted key (not just paired cloud keys).

> **Credential-proxy lockdown.** `/api/proxy/{credential_id}` moves from requiring
> `personas:execute` to requiring `proxy` **or** `proxy:credential:{credential_id}`.
> The internal "system" key (used by the MCP sidecar bridge) is granted the broad
> `proxy` scope so the connector bridge keeps working; **paired cloud keys never get
> `proxy` unless the user explicitly grants a specific credential.** This closes the
> "execute scope ⇒ arbitrary secret-bearing outbound request" hole.

### 3.3 Expiry & origin enforcement

`find_by_token` (`db/repos/resources/external_api_keys.rs:102`) already filters
`enabled = 1 AND revoked_at IS NULL`. Add:
- `AND (expires_at IS NULL OR expires_at > :now)` — expired keys resolve to `None`
  (401), same as revoked.
- Return `bound_origin` on the record; the middleware compares it to the request
  `Origin` and rejects (403) on mismatch. A key with `bound_origin` set that arrives
  with **no** Origin (non-browser) is also rejected — origin-bound keys are for
  browsers only.

### 3.4 Rate limiting

Add a lightweight per-key sliding-window limiter in the middleware (reuse the
existing `engine/rate_limiter.rs` primitive already used for MCP tool calls and
webhooks). Default budget generous for interactive use (e.g. 120 req/min/key),
configurable. Exceeding → 429 with `Retry-After`. Keyed by `key.id`, not IP
(loopback IP is always the same).

### 3.5 Frontend (`sub_api_keys`)

`CreateApiKeyDialog` gains: an **expiry** picker (never / 7d / 30d / 90d), and a
**persona picker** that emits `personas:execute:persona:<id>` scopes instead of the
broad `personas:execute` when the user narrows. `ApiKeysSettings` rows show expiry
(with a "expires in N days" / "expired" chip reusing the existing stale-key styling)
and a **per-key audit drawer** (recent requests from `api_key_audit`). All strings
through `t.settings.api_keys.*`, translated across 14 locales.

### 3.6 Developer contract

- **OpenAPI 3.1 spec** at `docs/api/management-api.openapi.yaml` describing every
  `/api/*`, `/a2a/*`, `/agent-card/*` route, auth scheme, and scopes. Hand-authored,
  kept in sync via the doc-sync hook (settings feature-doc map already covers
  `management_api.rs`).
- **Typed TS SDK** (`packages/personas-sdk/` or a `tools/` package): thin `fetch`
  wrapper generated/derived from the OpenAPI spec, with pairing helper (§4.3),
  scoped-token types, and execute/poll/build ergonomics. Python client is a
  fast-follow, not this session.

---

## 4. Direction 1 — the pairing bridge

### 4.1 Transport changes (`management_api.rs`)

1. **PNA preflight.** On `OPTIONS` responses (and actual responses), when the
   request carries `Access-Control-Request-Private-Network: true`, emit
   `Access-Control-Allow-Private-Network: true`. Implement as a small tower layer /
   middleware wrapping the existing `CorsLayer` (tower-http's `CorsLayer` does not
   set the PNA header itself).
2. **Dynamic origin allowlist.** `is_trusted_management_origin` stays as the static
   loopback allowlist; add a check against **persisted paired origins** (a new
   `paired_origins` table, or derived from `external_api_keys.bound_origin DISTINCT`).
   The CORS predicate becomes `is_trusted_management_origin(o) || is_paired_origin(o)`.
   Paired origins are only ever added through the consented pairing ceremony (§4.2),
   never by config file or env.
3. **TLS (decision required, see §7).** Loopback HTTP is a secure context, so TLS is
   not strictly required for browser reachability. Options: (a) ship HTTP on loopback
   (simplest, matches today); (b) serve HTTPS with a locally-generated cert the app
   adds to the OS trust store on first run. Recommendation: **(a) for v1**, revisit
   if we ever bind beyond loopback.

### 4.2 Pairing ceremony

Goal: the cloud app obtains an **origin-bound, scoped, expiring** `pk_` key, and its
origin is added to the CORS allowlist — only with an explicit in-app user approval.

```
Cloud app (browser)                 Desktop app (Tauri)
──────────────────                  ────────────────────
1. User clicks "Connect my
   local Personas"
2. Open personas://pair?
     origin=https://app.personas.example
     &scopes=personas:read,personas:execute:persona:*
     &nonce=<random>&name=<app label>
        ───────────(OS deep link)────────►
                                    3. Deep-link handler surfaces a
                                       PairApprovalModal: shows requesting
                                       origin, requested scopes (per-persona
                                       pickable), expiry. User approves/edits.
                                    4. On approve: mint pk_ key with
                                       bound_origin=<origin>, expires_at,
                                       narrowed scopes; add origin to allowlist;
                                       record audit "paired".
5. Cloud app polls a short-lived    5. Desktop posts the plaintext token back
   local rendezvous, OR the desktop     via a one-time localhost rendezvous
   deep-links back to a return URL      keyed by nonce (never via the deep link
   with a one-time code.                 query string — deep links leak to logs).
6. Cloud app stores the token,
   calls /api/* with it +
   Origin: https://app.personas.example
```

- **Reuse existing `personas://` deep-link handling** (already used for share
  bundles — see `ShareLinkResult.deep_link`). New action verb: `pair`.
- **Token delivery must not go through the deep-link query string** (deep links are
  logged by the OS). Use a one-time, nonce-keyed rendezvous: the desktop stands up a
  transient `GET /pair/claim?nonce=<n>` on 9420 that returns the token exactly once
  to the correct origin, then invalidates. The nonce originates from the cloud app so
  a hostile local process can't claim it blindly.
- **New Tauri commands:** `list_paired_origins`, `revoke_pairing(origin|key_id)` for
  a "Connected apps" management surface in Settings.
- **Approval UI:** `PairApprovalModal` (reuse `modals/BaseModal`) — requesting origin
  (prominent, with a warning if not HTTPS), editable scope/persona selection, expiry.
  Never auto-approves.

### 4.3 SDK pairing helper

The TS SDK ships `pair({ origin, scopes, name })` that opens the deep link and
resolves once the token is claimed, plus a `PersonasClient` that attaches the token +
`Origin`. This is what makes it "seamless" for the cloud developer.

---

## 5. Security model (summary)

- **Consent:** every cloud origin is user-approved once, in-app, with visible scopes.
- **Least privilege:** paired keys are persona-scoped and never get broad `proxy`.
- **Time-boxed:** paired keys expire; expiry enforced at lookup.
- **Origin-bound:** paired keys only work from the approved origin (CORS + server-side
  `bound_origin` check — defense in depth, since CORS alone protects only browsers).
- **Auditable:** every request a key makes is recorded (method/path/status/persona).
- **Revocable:** revoke the key or the whole pairing; origin drops from the allowlist.
- **Rate-limited:** per-key sliding window.
- **Loopback-only:** transport unchanged — we do not bind beyond `127.0.0.1`.
- **Token never in deep-link query:** delivered via one-time nonce rendezvous.

Residual risks to note in review: a malicious *local* process can already reach 9420
if it steals a token (unchanged from today; loopback trust); the credential proxy
remains powerful even scoped (mitigated by per-credential grants + audit).

---

## 6. Phasing (atomic commits, each independently shippable)

**Direction 5 substrate (land first):**
- **P1 — schema + expiry + origin binding.** Incremental migration (`expires_at`,
  `bound_origin`, `label`), `find_by_token` expiry+origin enforcement, model +
  bindings regen, repo tests. No behavior change for existing keys.
- **P2 — resource-scoped authorization.** `authorize()` rewrite (resource-aware),
  credential-proxy lockdown (`proxy` / `proxy:credential:<id>`), system key granted
  `proxy`. Middleware unit tests for allow/deny matrices.
- **P3 — audit + rate limiting.** `api_key_audit` table + middleware write + retention;
  per-key rate limiter. Repo + middleware tests.
- **P4 — frontend key management.** Expiry picker, persona-scoped picker, audit drawer,
  expiry chips in `ApiKeysSettings`. i18n ×14. Settings feature-doc update.

**Direction 1 bridge:**
- **P5 — transport.** PNA header layer + dynamic paired-origin allowlist. Tests for
  CORS predicate + PNA preflight.
- **P6 — pairing ceremony.** `personas://pair` deep-link handler, nonce rendezvous
  (`/pair/claim`), mint-on-approve, `PairApprovalModal`, `list_paired_origins` /
  `revoke_pairing` commands + "Connected apps" settings surface. i18n ×14.
- **P7 — developer contract.** OpenAPI spec + typed TS SDK with `pair()` +
  `PersonasClient`. Feature doc + marketing breadcrumb.

Each phase: `npm run check` + `npm run test -- --run`; Rust phases add
`cargo check`/`cargo test --lib` (running-exe lock ⇒ `--lib`, per repo memory) and
`cargo test export_bindings` when a `#[ts(export)]` struct changes. Atomic commit per
phase; worktree isolation for the whole effort.

## 7. Open decisions

1. **TLS on loopback** — ship plain HTTP v1 (recommended) vs. locally-trusted cert now.
   *(Deferred to P5; not blocking P1–P4.)*
2. **Paired-origins storage** — dedicated `paired_origins` table vs. derive from
   `external_api_keys.bound_origin` (leaning: derive, one less table). *(Deferred to P5.)*
3. **SDK home** — in-repo `packages/personas-sdk/` vs. the sibling `personas-web` repo
   (which is the natural cloud consumer). *(Deferred to P7.)*
4. **`execute:persona:*` wildcard** — **RESOLVED 2026-07-05: no wildcard.** Force
   explicit per-persona grants for every user-minted key (see §3.2 posture note).

**Session plan (2026-07-05):** execute **P1–P4** (Direction 5 substrate + key-management
UI). Pairing (P5–P7) is a follow-up session.

## 8. Test & review checklist

- Middleware authorization matrix: (broad vs resource scope) × (execute/build/proxy) ×
  (match/mismatch) → allow/deny.
- Expiry: key past `expires_at` → 401. Origin mismatch → 403. No-origin + bound → 403.
- Rate limit: N+1 request in window → 429.
- Pairing: nonce single-use; token never in deep-link; approval required; revoke drops
  origin from allowlist.
- Human security review of: proxy lockdown, pairing token delivery, CORS predicate.
