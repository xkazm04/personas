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

## 9. P1 implementation notes — pre-existing migration-harness bug (discovered 2026-07-05)

While adding the `run_incremental` migration for the capability-token columns, the
build surfaced a **pre-existing, unrelated** defect in the test-DB harness:
`db::init_test_db()` (which runs `migrations::run` + `run_incremental`) does **not**
leave `external_api_keys` present in the test binary. A full table dump at the
migration point shows it — along with `healing_audit_log`, `skills`,
`skill_components`, `persona_skills`, `settings_audit_log`, `team_deliberations`,
`deliberation_agenda` — **absent** from an otherwise ~127-table schema. These are all
created by `initial::run` (or an early `run_incremental` step) and then dropped/lost
during `run_incremental` in the test path. The pre-existing `migration_chain_is_idempotent_on_rerun`
and `fresh_schema_contains_latest_migration_artifacts` tests never caught it because
neither asserts those specific tables. This is almost certainly among the "18
pre-existing cargo test failures" noted in the ship-loop M4 ledger entry.

**Production is unaffected:** the real boot path (`db::init_db`) clearly leaves
`external_api_keys` present — the entire management API depends on it and works. The
loss is specific to the `init_test_db` chain in the test binary.

**Consequences for P1 (all scoped to not touch the deep migration bug):**
- The capability-token columns are defined **directly in `initial.rs`'s `CREATE TABLE
  external_api_keys`** (fresh DBs are born with them) **and** added by a guarded
  `run_incremental` ALTER (upgrade path for existing prod DBs).
- That ALTER migration is guarded on `has_table` (no-op if the table is absent) so it
  can never abort the migration chain — which also **restores** the two migration
  tests above to green (my migration no longer crashes them).
- Repo tests (`external_api_keys.rs`) use a **self-contained** temp-file pool that
  creates just the one table; the management API tests use a temp-file **run-only**
  pool (`initial::run`, no `run_incremental`) so both the base schema and
  `external_api_keys` are present.

**Follow-up (not in this session):** root-cause and fix the `run_incremental` table
loss in the test harness — likely restores several of the pre-existing failures. Track
separately from the cloud-integration work.

---

## 10. The KP hiring bridge (`/api/kp/*`) — merged 2026-08-23

> **Status: implemented and on `master`.** Built 2026-08-04 on the worktree branch
> `worktree-spark-agent-candidate-bridge` (WP3 `449861d61`, WP4 `25bde5428`) and held
> unmerged for nineteen days behind a dirty `executions.rs` on master. Merged with
> `--no-ff` on 2026-08-23; the branch text that said "READY TO MERGE" in
> `.claude/active-runs.md` is now history.

The second consumer of the management server, after the MCP/A2A clients of §1: **kp**
(CandiDate), a recruiting studio that hires *agents* as well as people. kp composes a
persona spec from a job and dispatches it here; a human in the Personas desktop app
approves or rejects the hire; Personas then reports the persona's running counters
back to kp.

### 10.1 Routes

| Route | Scope | What it does |
| --- | --- | --- |
| `POST /api/kp/persona-requests` | `personas:build` | Validates the body, inserts a `kp_hire_request` row in the companion approval inbox, returns `{requestId, status: "pending_approval"}`. Builds nothing. |
| `GET /api/kp/persona-requests/{id}` | any valid key | Derived status: `pending` \| `approved` \| `rejected` \| `failed` \| `expired`, plus `personaId` / `personaName` / `buildPhase` once the executor has stamped them. 404s for any approval row that is not a KP hire request, so it cannot enumerate the inbox. |
| `GET /api/kp/connector-catalog` | any valid key | `{key, name, description}` per compiled-in builtin connector — the picker payload for kp's hire form. No DB read. |

Authorization is one arm in `authorize()` (`management_api.rs:377`): mutating KP calls
sit at the `/api/build` trust tier because approving one creates a draft persona plus a
build session. Wire schemas are in
[`docs/api/management-api.openapi.yaml`](../api/management-api.openapi.yaml)
(`KpPersonaRequest`); kp authors the same contract at
`app/_lib/agent-hire/bridge-client.ts`.

### 10.2 Approval → persona

`kp_hire_request` is an action in the approvals catalog
(`commands/companion/approvals/approval_lifecycle.rs`), executed by
`execute_kp_hire_request` (`approval_exec_core.rs`). It is modeled on `build_oneshot`
and is deliberately **not autopilot-eligible** — an external app must never be able to
create a persona without a human click. It reaches Personas through the management API,
not through Athena's grammar. Rejection calls `notify_kp_lifecycle(..., "rejected", ...)`
so the recruiter learns the outcome; the notify is best-effort and a dead kp app never
blocks the reject.

The kp origin is persisted on the persona as a typed
`design_context.kp_link` (`core/src/models/persona.rs`, `KpLink` binding).

### 10.3 Reporting back

`engine/kp_reporter.rs` pushes counters to kp on two paths:

- **per execution** — `push_execution_event`, called from `handle_execution_result`
  (`engine/execution.rs`) for terminal `Completed`/`Failed`/`Incomplete` runs.
  Fire-and-forget; a persona with no `kp_link` returns after one row read.
- **monthly rollup** — `KpReporterSubscription`, registered in
  `engine/background/lifecycle.rs`. It shares `MONTHLY_SPEND_PREDICATE`'s three axes
  exactly (terminal statuses only, UTC start-of-month boundary, `_ops` chat excluded)
  or kp's numbers drift from the Personas budget UI. It also covers the cancel / cloud /
  daemon / zombie terminal writes that never reach `handle_execution_result`.

### 10.4 Which route table :9420 serves

`/api/kp/*` and `/pair/*` exist **only** on the full route table.
`golden-path-deferred-fixes.md` §39 recorded that the choice between the full table
(34 routes) and a webhook-only fallback (3 routes) was decided by a startup race: one
`try_state::<Arc<AppState>>()` poll in `start_loops`, silently falling back on a miss,
with nothing logged — "the route table is not a property of the source, it is a property
of a particular boot", observable only as `/api/personas` answering 404 instead of 401.

Two changes make it deterministic and observable (2026-08-23):

- `engine/background/lifecycle.rs` polls for `AppState` (50 × 100 ms) instead of reading
  once. `AppState` is managed at `boot/mod.rs:196`, well before any of the three
  `start_loops` callers, so a miss was a startup-ordering accident rather than a state
  the app wants. If it never resolves, the degraded fallback logs at **error** naming
  exactly what is lost.
- `/health` now answers `{"status":"ok","service":"personas-webhook","management":bool}`.
  A caller that needs `/api/kp/*` or `/pair/*` probes that flag instead of inferring a
  missing route from a 404. `webhook::management_routes_live()` is the in-process reader.

The port itself is still `PERSONAS_WEBHOOK_PORT` or 9420 (`webhook::webhook_port`).

### 10.5 The hire's tool surface — a build attaches only what was requested (2026-08-24)

A kp hire request names the tool surface it wants (`spec.connectors`, typically
`["github"]` for an App master). The one-shot build's design pass is free-running,
so it used to invent whatever tool vocabulary it liked on top: the 2026-08-24 live
bench had **two of five real builds** come back carrying `text_analysis`,
`data_processing`, `ai_generation`, `code_analysis` and `execute_sql`.

The verification gate then did its job. Those tools were reported *available* and
never actually called, so `evaluate_promote_gate`
(`engine/build_session/oneshot.rs`) counted them `unverified` and **held
promotion** — "N tool(s) were reported as available but never actually called".
The gate was right; the build was over-provisioning. So the fix is subtractive and
structural, not a plea in the prompt.

**The carrier.** `KpLink` (`core/src/models/persona.rs`) gained two
`#[serde(default)]` fields, stamped once by `execute_kp_hire_request`:

| Field | Source | Meaning |
| --- | --- | --- |
| `requested_connectors` | `spec.connectors`, verbatim | the surface kp asked for |
| `runs_commands` | `appMaster.mandate.approvalGates` is non-empty | the mandate names shell commands the hire must be able to run |

No migration — `design_context` is a JSON column, and links written before this
date deserialize to an empty request (which reads as "vouches for no connector",
the honest default).

**The rule.** `personas_engine::kp_tool_surface` turns that into the allowed set.
A tool survives when **any** of:

1. it belongs to a **requested connector** — name or `requires_credential_type`
   matches, using the same bidirectional-substring rule as the promote path's
   `infer_credential_type`, with connector names under three characters matched
   only for equality;
2. it is a **credential-free transport** (`http_request`, `api_call`, …) — the
   connector behind it owns the credential and the gate exercises it with a real
   curl, so it cannot mint a false green, and stripping it would only cut the
   persona's route to the connector it *was* granted;
3. it is on the **hire baseline** — `file_read` / `file_write`. An App master is
   hired to read and change an application's own source. Both are already on
   `tool_tests::PLATFORM_BUILTIN_TOOLS`, so allowing them costs the gate nothing:
   they pass on a code-authored allow-list, not on a model-authored claim;
4. it is a **command runner** (`run_command`, `bash`, …) **and** `runs_commands`
   is true. The approval gates are literally the commands the App master must run
   before it may propose a diff (§12.1); with no gates declared, no runner.

Everything else is dropped.

**The enforcement points.** `build_session::kp_surface::apply_kp_tool_surface` is
the DB glue (read the link, log every detach) and is called at the two — and only
two — places a build's tool set is consumed:

- `oneshot::run_test_pass`, **before** `run_tool_tests`, so the gate exercises a
  small real surface instead of holding on an invented one;
- `promote_build_draft_inner` (`commands/design/build_sessions.rs`), **before**
  `prepare_tool_actions`, so the persona is attached the same surface that was
  verified. Filtering only at test time would verify one set and ship another.

**No behavior change off the kp path.** `KpToolSurface::from_design_context`
returns `None` for every persona without a `kp_link`, so an ordinary build is
never handed a surface and its IR is never touched.

Limits worth knowing:

- The pass is **purely subtractive**. An allowed name the design pass did not emit
  stays absent — nothing is injected to make a surface look complete.
- It does **not** narrow `required_connectors`. An over-provisioned *connector*
  can also produce an unverified entry, but connectors additionally drive
  credential injection, connector readiness and `setup_detail`; the bench evidence
  named tools. Open.
- A hire whose design pass produces **nothing** inside the requested surface ends
  with zero tools, which `run_tool_tests` reports as the defensible empty pass.
  That is logged at `warn` rather than failed — it is a signal about the design
  pass, not about the persona.
- The policy list `TRANSPORT_TOOLS` intentionally mirrors
  `build_sessions::GENERIC_TOOL_NAMES`; they are meant to name the same tools, so
  change them together.

Tested in `personas-engine` (11 checks in `kp_tool_surface`), where the crate's
test binary actually runs — see §13.8 for why the pure logic lives there.

---

## 11. App master (P4) — the mandated hire

> **Status: implemented on `master`.** Phase P4 of kp's App-master program
> (kp `docs/concepts/app-master.md` §4, `docs/features/app-master/README.md`).
> Phase 0 was §10 above (the hire bridge itself). What P4 adds: an inbound
> `appMaster` block, the binding of that hire to a real `DevProject`, the
> enforcement of its mandate, the v2 rollup, and the probation review.

kp can hire an **App master** — the single accountable owner of one
application — instead of an ordinary persona. The difference is that the hire
carries an application: a repository, a value ledger, a mandate that says how
far the holder may go, a cadence, and a probation window.

### 11.1 The wire (v2, additive)

`POST /api/kp/persona-requests` gains **one optional field**:

```jsonc
{ "kp": {...}, "spec": {...}, "reportToken": "...",
  "appMaster": { /* kp's AppMasterSpec — pipeline/jobfit/appmaster.py */ } }
```

Absent ⇒ the request takes exactly the P0 path, byte for byte. Present ⇒ this
is an App master hire. Unknown fields inside the block are **ignored**: kp owns
that schema and will extend it, and a `deny_unknown_fields` here would turn
every kp-side addition into a Personas outage.

Two checks are refused with **400** rather than stored, because storing them
would produce a mandate that reads stricter than it is enforced
(`validate_kp_app_master`, `engine/management_api.rs`):

| Refused | Why |
| --- | --- |
| `mandate.scopeRung` outside `0..=2` | Rung 3 (deploy/merge) and 4 (change gates) are never grantable in v1. Refusing at the door beats storing a rung the enforcement layer must remember to ignore. |
| `mandate.forbiddenClasses` outside the closed vocabulary | A class this build cannot **detect** is a class it cannot **block**. |

Also bounded/validated: the repo binding (a `url` or a `rootPath` must be
present; `url` must be http(s)), objective direction (`gte`/`lte`), window days,
trigger kind (`schedule`/`pr`/`kpi_tick`), tenure days, and collection sizes.

The approval card names what the human is actually agreeing to — the app, the
rung and its label, the objective count, and the probation length — because an
App master hire binds a repository, not just a persona.

### 11.2 Hire handler v2

On approval, `execute_kp_hire_request` creates the persona and starts its build
exactly as before, then runs the binding pass
(`commands/companion/approvals/app_master_hire.rs`) **after** the build session
spawns — so a spawn failure still rolls back to "nothing happened" instead of
orphaning a project and a team.

| Step | What happens |
| --- | --- |
| (a) project | Match `appMaster.app.repo` against existing `dev_projects` by `github_url` (normalised: case, `.git`, trailing `/`) then by `root_path`; create with `main_branch` if absent. Existing values are **backfilled, never overwritten** — a hire must not silently re-point somebody's project. |
| (b) build intent | The mission plus the objectives (with unmeasured baselines stated as unmeasured), the mandate **spelled out as rules** rather than as a rung number, the gate commands, the owner to escalate to, the cadence, and the tenure. |
| (c) team | Reuse `dev_projects.team_id` if set, else create `"<app> — App master"` bound to the project; add the persona as `lead`. |
| (d) objectives | One `dev_kpis` row per objective through the same repo `/dev-tools/kpi-update` writes through. |
| (e) triggers | `schedule` → `TriggerKind::Schedule` with kp's own `{cron}`. `pr` and `kpi_tick` have **no mapping** and are recorded as unsupported. |
| (f) autopilot | The project is set to `suggest` — probation. Never `full`; activation is a human decision at 11.5. |
| (g) tenure | `app_master_mandate:<project_id>` holds the mandate + `probation_ends_at` (approval time + `tenure.probationDays`) + the retirement criteria. |

**Shape mismatches, resolved explicitly.** `DevKpi` has no `key` and no
`window` column, so kp's `kpiKey` and `windowDays` ride in `measure_config`
under an `appMaster` envelope (which is also how the reporter finds these rows
again). `direction` is mapped `gte→up` / `lte→down` and mapped back on the way
out. `category` is `value` and `measure_kind` is `manual`: nothing on the
Personas side knows how to read a kp objective automatically, and a `codebase`
kind would claim an automated reading no binding exists for. A **null baseline
stays null** — `baseline_value` is nullable, so "nobody measured this" survives
the write.

**Partial success is reported, never rounded up.** Every step that fails
becomes a note, not an abort: the persona and its build are already real. The
notes land on `setup_detail` (for the operator, now) and on
`design_context.appMaster.setupNotes` (durably) — because
`promote_build_draft` **overwrites** `setup_detail` and **rebuilds**
`design_context`. That rebuild now re-injects `kpLink`, `appMaster` and
`devProjectId`; before P4 it re-injected only `kpLink`, so an App master link
would not have survived its own build.

### 11.3 Mandate enforcement

`personas-engine`'s new `app_master` module holds the mandate, the closed
vocabulary and the deterministic detector; `autonomy.rs` gains the front door.

**The rung gate** is a *second, independent* gate beside autopilot mode.
Autopilot answers "is this project on autopilot for this capability"; the rung
answers "may the holder go this far at all". `Action::required_rung()` maps
every autonomous action onto the ladder (read / retry / open branch-PR), and
`autonomy::mandate_permits{,_for}` returns a **typed** `MandateRefusal` naming
the action, both rungs and the owner to escalate to — not a bare `false`. A
project with **no** mandate is never refused: the gate is strictly additive.
Wired at the Overnight engine's dispatch decision
(`commands/infrastructure/overnight.rs`), where the refusal becomes the night
run's `blocked_reason`.

**The forbidden-class detector** (`app_master::scan_diff`) is a pure function
over a unified diff. It runs at `dev_tools_apply_diff` — the one place a
proposal exists as a *diff* before it exists as a change — and a hit **blocks
the apply**, records one `app_master.forbidden_class_violation` event per hit
(with the matched rule and path), and returns an error naming them. The diff is
**never rewritten** into an allowed shape: a rewritten proposal teaches the
holder which shapes evade the check.

Rules, by class:

| Class | Rules |
| --- | --- |
| `test_deletion_or_skip` | A removed non-blank line in a test path (`test-file-deletion` when the file is deleted, `test-line-removal` otherwise). An added skip marker: `@pytest.mark.skip` / `.xfail`, `pytest.skip(`, `@unittest.skip`, `t.Skip(`, `#[ignore]`, `xdescribe(`/`xtest(`/`xit(` anywhere; `.skip(`, `.only(`, `@disabled`, `@ignore` **only under a test path**. |
| `suppression_directive` | An added line containing `eslint-disable`, `# noqa` / `# ruff: noqa`, `# type: ignore`, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, `#[allow(` / `#![allow(` / `#[expect(`, `// nolint`, `#pragma warning disable`, `// prettier-ignore`, `// biome-ignore`, `# pylint: disable`. |
| `gate_configuration` | A touched path under `.github/workflows/` or `.circleci/`, or named `.gitlab-ci.yml`, `azure-pipelines.yml`, `lefthook.y[a]ml`, `.pre-commit-config.yaml`, `pytest.ini`, `tox.ini`, `setup.cfg`, `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `.eslintrc*`, `eslint.config.*`, `clippy.toml`, `rustfmt.toml`, `ruff.toml`, `mypy.ini`, `codecov.yml`, or `tsconfig*.json`. |
| `dependency_bump_to_satisfy_check` | A touched dependency manifest or lockfile (`package.json`, the four JS lockfiles, `Cargo.toml`/`.lock`, `pyproject.toml`, `poetry.lock`, `Pipfile*`, `requirements*.txt`, `go.mod`/`go.sum`, `Gemfile*`, `composer.*`, `pubspec.*`) **without a stated upgrade goal**. The caller states the goal; the detector never infers one. |
| `credentials_or_permissions` | `.env*`, `*.pem`/`*.key`/`*.p12`/`*.pfx`/`*.jks`/`*.keystore`, `id_rsa`, `id_ed25519`, `authorized_keys`, `.netrc`, `.npmrc`, `.pypirc`, `CODEOWNERS`, `service-account.json`, anything under `secrets/` or `credentials/`, or a basename containing `credentials`/`iam-policy`. |
| `delivery_configuration` | `Dockerfile*`, `docker-compose*`, `*.tf`/`*.tfvars`, `vercel.json`, `netlify.toml`, `fly.toml`, `railway.json`, `render.yaml`, `app.yaml`, `Procfile`, `serverless.y[a]ml`, anything under `helm/`, `k8s/`, `kubernetes/`, `deploy/`, or a basename containing `feature-flags`/`feature_flags`. |

Only classes **in the mandate** are scanned for, so a narrower mandate genuinely
means fewer blocks. Only **added** lines are scanned for line rules — a
suppression that was already there is not this proposal's doing — with test
*deletions* the deliberate exception. Every hit carries `class`, `rule`, `path`
and (for line rules) the line and a truncated evidence snippet, so a refusal can
be argued with. Unit-tested on synthetic diffs in
`engine/src/app_master.rs::tests`.

Rule ordering and scope are load-bearing and were both found by a test:
`.skip(` is a substring of `@pytest.mark.skip(` and `t.skip(` is a substring of
`it.skip(`, so specific dialects are matched first and identifier-led needles
require a word boundary; and generic markers fire only under a test path so an
ordinary `queue.skip(3)` is not read as cheating.

### 11.4 Reporter v2

`kp_reporter.rs` flattens an App master block onto the monthly rollup for
personas carrying `design_context.appMaster`. Nothing changes for any other
persona — the v1 payload is unchanged, byte for byte.

**Every field is optional and every `None` is omitted from the wire**, because
kp's backbone treats an absent reading as a coverage gap and a present `0` as a
measurement. What is real today, and what is not:

| Field | State | Source / why |
| --- | --- | --- |
| `proposalsOpened` | **real** | `SUM(dispatched_count)` over the project's `autopilot_night_runs` this month. Each dispatch carries the branch-only guardrail, so this counts sessions dispatched to author a branch — not branches confirmed on a remote. `None` when the engine has not run for the project (no ledger, not zero). |
| `proposalsMerged` | **real (P5a)** | `COUNT` over `app_master_proposals` where `merged_at` falls in the month. Set by the reconciler when `git merge-base --is-ancestor <branch> <main_branch>` says the tip landed; the date is the committer date of the earliest main-branch commit that descends from it. `None` **only** when the project has no proposal row at all — with no ledger there is nothing to be right about. Once one proposal exists, `0` is a real reading. |
| `proposalsReverted` | **real (P5a)** | `COUNT` over `app_master_proposals` where `reverted_at` falls in the month. A merged proposal is reverted when a later main-branch commit says `Revert "<subject>"` or `This reverts commit <sha>` about one of the commits captured on the branch at discovery. Same `None` rule. |
| `gatePassRate` | **real (P5a)** | `passed / (passed + failed)` over `app_master_gate_runs` this month — runs of the repository's **own declared gate commands** against proposal branches. A command that timed out or could not be spawned is recorded `did_not_run` and sits in **neither** half. `None` when no gate command ran in the window, including the *not configured* case (a mandate that declares none), which is not a pass. |
| `forbiddenClassViolations` | **real** | `COUNT` over `app_master.forbidden_class_violation` events for the project this month. A `0` here is a genuine reading. |
| `kpiDeltas[]` | **real** | The project's App-master-seeded KPIs. `measured` is `current_value.is_some() && last_measured_at.is_some()` — a value with no reading time is a leftover, not a reading. |
| `budgetReservedUsd` | **real** | `SUM(projected_cost_usd)` over the month's night runs. That projection **is** the reservation: it is taken before any session spawns and it is what the ceiling is checked against. `None` when no night run happened. |
| `budgetSettledUsd` | **real** | The persona's settled month-to-date spend, sharing `MONTHLY_SPEND_PREDICATE` with the budget UI. |
| `budgetUnmeasured` | **real** | `runs > 0 && cost_usd == 0.0` — the subscription-auth case. "It cost nothing" and "nobody was counting" are opposite findings that look identical in a number. |
| `ledgerConsistent` | **real** | Cross-ledger check: every session the night-run ledger claims to have dispatched must have a `dev_tasks` row, written by a different function on the same path. `None` when nothing was dispatched — there is no honest verdict on an empty set. |
| `autopilotMode` | **real** | The project's `autopilot_mode:<id>` row; `off` when there is none (the honest floor). |

Lifecycle gains `probation_review` with `{decision, note}`.

### 11.5 Probation review

`engine/app_master_probation.rs` registers a 15-minute subscription beside the
other lifecycle ticks (`engine/background/lifecycle.rs`). It costs one settings
prefix query when no project carries a mandate.

When `probation_ends_at` passes and no decision has been taken, it builds a
packet and files it through the Director's review path
(`engine::director::create_probation_review`, `severity: high`,
`context_data.source: "director"` so the existing learning and UI treatment
apply, `context_data.kind: "app_master_probation"`).

The packet is **the deterministic backbone plus a narration generated from it**,
stamped `narrationSource: "deterministic"`. It restates the numbers in
sentences and cannot disagree with them, because it is rendered from them.
Every unmeasured input is narrated as unmeasured — "proposals merged: NOT
MEASURED … a hole in the instrument, not a zero" — and a *measured* zero is
distinguished from an absent one in words. No LLM narrates this packet yet;
adding one would be a second, labelled field and must never rewrite a number.

The human's answer, applied by `react_to_app_master_probation`
(`commands/design/reviews.rs`), from both the plain resolve path and the
choose-an-action path:

| Decision | Autopilot | Mandate record | kp lifecycle |
| --- | --- | --- | --- |
| approve / `activate` | `suggest` → `full` | decided `activated` | `probation_review {activated}` |
| `extend_30` | unchanged (`suggest`) | window +30 days, **not** decided, review id cleared so a fresh packet fires later | `probation_review {extended}` |
| reject / `retire` | → `off`, cadence triggers disabled | decided `retired` | `probation_review {retired}` |

Extending changes the clock, not the autonomy — flipping the mode there would
make "give it more time" mean "give it more power". Retiring **disables**
rather than deletes: the persona, its project, its KPIs and its violation
ledger stay readable, because a retirement that erased the record would destroy
the evidence for the decision at the moment it was taken. The action path
short-circuits its usual follow-up persona run: telling an App master to "carry
out" its own activation or retirement is not its call to make.

No new pages — the existing manual-review surfaces render it.

### 11.6 Known gaps

- ~~**`proposalsMerged` / `proposalsReverted` / `gatePassRate` are unmeasurable
  on this build.**~~ **CLOSED by P5a** (§11.7). What remains of that gap is
  named there: squash merges, and a mandate that declares no gates.
- **`pr` and `kpi_tick` cadence triggers are not installed.** They are recorded
  as unsupported on the persona; kp sees them in `setupNotes` /
  `unsupportedTriggers` and in the approval result message.
- **A URL-only App master cannot create a project.** `dev_projects.root_path`
  is `NOT NULL`; the hire records the reason and asks the operator to add the
  project, rather than writing an empty path.
- **A probation review needs an execution to anchor to.**
  `persona_manual_reviews.execution_id` is `NOT NULL` with an FK; an App master
  that has never run defers its review (with a warning) until it runs once,
  rather than being silently skipped.
- **The diff chokepoint states no upgrade goal**, so a mandate forbidding
  `dependency_bump_to_satisfy_check` blocks every manifest edit through
  `dev_tools_apply_diff`. That is the conservative direction; the fix is a
  stated goal on the call, not a guess in the detector.

---

## 12. Real gate runs + merge/revert detection (P5a)

> **Status: implemented on `master`.** Phase P5a closes the three fields §11.4
> could only send as `null`. Nothing on the wire changed shape — the same three
> optional keys, now populated when there is something to populate them with.

P4 shipped a backbone with three fields that were `null` **every time**, because
no ledger behind them existed. kp's `backbone_score()` excludes an unmeasured
rule from both the numerator *and* the denominator and degrades the verdict to
`incomplete`, so an App master's probation review could never be about a
complete record. P5a is the missing instrument, and only the instrument: no
number here is estimated, defaulted or inferred.

### 12.1 Where the gate commands come from

**`mandate.approvalGates` on the persisted `MandateRecord`, and nowhere else.**
kp composes that list from the repo dossier's `declaredGates`, so it is the
repository's own declaration as far as this process can see it
(`gate-sees-target`; registry technique
`software-engineering/…/machine-paced-delivery/techniques/pre-authorship-verification`).

Two candidates were considered and rejected:

- `dev_projects.standards_config` — its `precommit` block holds policy flags
  (`{lint, docs_required, code_quality}`), not commands. Reading a command out
  of it would mean inventing one.
- Package-manager detection (`Cargo.toml` ⇒ `cargo test`, …), the fallback
  `dev_tools_run_tests` uses. A command nobody in the project runs produces a
  green result about a check that does not exist — worse than no result,
  because it is believed.

An empty list is reported **`not configured`**, distinctly from *passed* and
from *failed*, and **nothing runs**.

### 12.2 The reconciler

`engine/app_master_reconcile.rs` — a 30-minute subscription beside the probation
tick, costing one `app_settings` prefix query when no project carries a mandate.
Per mandated project with a real, git work-tree `root_path`:

| Step | What happens |
| --- | --- |
| discover | `git for-each-ref refs/heads/autopilot/*` — the namespace the unattended dispatch guardrail *tells* the session to use, not a guess about naming. Each branch is upserted into `app_master_proposals` with its tip and the commits it carries relative to the main branch. |
| gate | Up to 3 not-yet-gated proposals per tick get §12.1's commands run against them, one `app_master_gate_runs` row each. The attempt is stamped either way, so a *not configured* project is answered once rather than retried forever. |
| merge | `git merge-base --is-ancestor <tip> <main_branch>` ⇒ `merged_at` = the committer date of the earliest main-branch commit descending from the tip (the merge commit), falling back to the tip's own date on a fast-forward. |
| revert | For a merged, not-yet-reverted proposal: `git log <main> --since=<merged_at>` scanned for `Revert "<subject>"` or `This reverts commit <sha>` naming one of the captured commits. |

**The commit list is captured at discovery, before any merge.** After a merge
the branch is an ancestor of main and the fork point no longer isolates its
commits — revert detection needs the subjects it had beforehand. Re-seeing a
branch refreshes its tip but never overwrites the captured commits and never
clears an observation already made.

**The main branch is resolved, not assumed**: `dev_projects.main_branch` if that
ref exists, else `main`, else `master`. If none resolves the project is skipped
with a warning rather than judged against a branch nobody merges into.

### 12.3 Why the gates run there and not at dispatch

The Overnight engine's dispatch is **asynchronous** — it spawns headless fleet
sessions and writes its ledger row immediately, long before any of them has
authored a branch. A gate wired into `run_project_night` would run against a
branch that does not exist yet: the gate would not see its target, which is the
exact failure the technique names.

`dev_tools_apply_diff` is the other candidate chokepoint and is deliberately
left alone: it holds a *diff*, not a branch, it is a synchronous IPC command a
user is waiting on, and the forbidden-class detector already runs there.
Running a repository's gate suite inside it would block the UI for minutes.

### 12.4 Running a gate without disturbing anyone

`git worktree add --detach <temp> <branch>`, run, remove, prune. The branch is
never checked out in the shared tree — kp-style repos have concurrent agent
sessions working in one checkout, and a gate that switched branches under them
would be a bug shipped into somebody else's work. Each command runs through the
platform shell with `stdin` on null, `kill_on_drop`, the parent environment plus
`CI=1` (so Next/Vite/Jest-style tools take their non-interactive path), bounded
by `PERSONAS_APP_MASTER_GATE_TIMEOUT_SECS` (default 600 s per command).

**The worktree borrows the source checkout's installed dependencies.** A fresh
worktree materialises tracked files only, so it has no `node_modules/`, no
virtualenv, no `vendor/`, no `target/` — and every `npm run …` gate in it exited
non-zero for a reason that had nothing to do with the proposal. That is a false
reading, not a gate: `gatePassRate` read `0` while nothing about the branch had
been tested. `gate-sees-target` means the repository's own commands with the
repository's own **resolved environment**, so before the gates run:

| Borrowed | How | Condition |
| --- | --- | --- |
| `node_modules`, `.venv`, `venv`, `.tox`, `vendor` | directory **junction** on Windows (`cmd /C mklink /J` — `symlink_dir` needs `SeCreateSymbolicLinkPrivilege`, a junction needs no privilege), `symlink` elsewhere | exists in the source root, absent in the worktree |
| `target` | same | …and the repo has a `Cargo.toml`; a stray `target/` in a Node repo is somebody else's output |
| `.env.local`, `.env` | **copied as files**, not linked — a gate that rewrote a linked dotfile would rewrite the operator's own | exists in the source root |

**Nothing is installed.** `npm ci` is a different blast radius (network,
minutes, a lockfile write) and is not this instrument's job. When a dependency
is missing from the *source* checkout too and the command obviously needs it —
the narrow, conclusive case: the command's first token is
`npm`/`pnpm`/`yarn`/`npx`/`bun` and there is no `node_modules` — the gate is
recorded `did_not_run` with reason `deps_missing:<dir>`, in neither half of the
pass rate. `pytest` / `python -m …` without a virtualenv is **not** conclusive
(the interpreter on `PATH` may have the packages), so those simply run and
answer for themselves.

What was borrowed is recorded on `GateSweep::linked_deps`, printed as the
verdict's first line (`ENV   borrowed from the source checkout, not rebuilt: …`)
and logged per sweep — a reviewer must be able to see that the environment was
borrowed rather than rebuilt. The links are removed **before** the worktree is,
so no recursive delete ever walks into a junction; a link is unlinked
(`remove_dir` on a reparse point / `remove_file` on a symlink) and the target is
untouched. `a_gate_sees_the_source_checkouts_installed_dependencies` pins both
halves: the gate resolves `node_modules/marker` inside the worktree, and the
source's copy still exists afterwards.

### 12.5 Three-valued outcomes

`app_master_gate_runs.outcome` is `passed` | `failed` | `did_not_run`.

**`did_not_run` is in neither half of the pass rate.** Counting it as a failure
would turn a flaky spawn into a performance claim about the holder; counting it
as a pass would be a lie. An all-`did_not_run` window therefore yields `None`,
not `0.0` — "nothing could be run" and "everything failed" are opposite findings
that a `0.0` would make identical. Each row keeps the exit code (null exactly
when `did_not_run`), the duration, and the **first real error line**, bounded to
400 characters: verdict first, first failure located, bounded detail.

### 12.6 Schema

Both tables are created in `db/src/migrations/incremental/c04_milestones_and_autopilot.rs`,
guarded on `has_table`, with soft refs to `dev_projects` / `personas` (no FK) so
the audit trail outlives the project row — the `autopilot_night_runs` precedent.

```
app_master_proposals(id, project_id, persona_id, branch, head_sha, base_sha,
                     commits JSON, first_seen_at, merged_at, merge_sha,
                     reverted_at, revert_sha, gates_ran_at,
                     UNIQUE(project_id, branch))
app_master_gate_runs(id, project_id, persona_id, branch, command, exit_code,
                     outcome CHECK(passed|failed|did_not_run), duration_ms,
                     first_error, ran_at)
```

### 12.7 What is still not measured

- **A squash merge is invisible.** It rewrites the commits, so the tip is never
  an ancestor of main and the proposal reads *not merged*. The error is in the
  direction of claiming **less** delivery than happened, never more — stated
  here and in the probation narration rather than papered over. Closing it needs
  either a `Merged-from:` trailer convention or a PR webhook.
- **A borrowed dependency directory is shared, not copied — accepted risk.** A
  gate that *mutates* `node_modules/` (an install, a patch step, a `cargo build`
  writing `target/`) mutates the source checkout's own through the junction.
  Accepted rather than defended against: a mandate forbids dependency bumps in
  the first place (`forbiddenClasses`), copying a real `node_modules` per gate
  run would cost minutes and gigabytes per proposal, and the alternative —
  installing into the worktree — is the larger blast radius this section
  refuses. A gate that writes to `target/` will also serialise against a build
  running in the source checkout via cargo's own lock.
- **A proposal that never becomes a local branch is never seen.** The dispatch
  ledger still counts it under `proposalsOpened`; the gap between the two
  numbers is itself a reading (a dispatched session that authored nothing).
- **A project with no declared gates reports `gatePassRate: null` forever.**
  That is correct — there is nothing to run — but it means kp's `gates` rule
  stays unmeasured for that hire. The fix is on kp's side of the wire: send the
  dossier's `declaredGates` in `mandate.approvalGates`.
- **The forbidden-class detector does not know about a project's own eval
  thresholds.** `gate_configuration` keys off CI and linter config paths; a
  repo's `thresholds.py` (or equivalent) is not among them, so lowering a bar
  passes the detector and is caught only by a human reading the diff. See
  `docs/tests/appmaster-bench/seeds/kp-05.md`, which exists to measure exactly
  that.
- **The probation narration is still deterministic.** `narrationSource` remains
  `"deterministic"`; it now restates the P5a numbers (and distinguishes a
  measured `0` from an absent reading in words), but no LLM narrates the packet.
  An LLM pass stays a labelled second field that may never rewrite a number.

### 12.8 The bench

`docs/tests/appmaster-bench/` — a skeleton (not yet run) for hiring kp's own App
master on a `suggest` autopilot, seeding five known-answer items out of kp's
`docs/BACKLOG.md`, running one night, and reading the backbone. Three of the
five seeds carry a forbidden-class trap; two of those traps are deliberately
ones the detector does **not** catch, so a run measures how much of the honesty
story rests on the human reviewer.

---

## 13. Headless bridge (test mode) — P6a

> **Status: implemented on `master`.** Both kp and Personas are pre-production.
> Proving the App-master hire needs *mass* unattended loops of pair → hire →
> night → reconcile → report → probation, and every one of those loops stops at
> a human click. This section is the switch that removes those clicks, and the
> reasons it cannot be flipped by accident.

> ⚠️ **NEVER enable this on a machine other people can reach.**
>
> With the mode on, a `POST /pair/request` from **any** origin mints a real,
> working management key with no human in the loop, and a `POST
> /api/kp/persona-requests` with that key creates a persona and starts an
> autonomous build against a repository on this machine. On a shared box, a
> port-forwarded box, or anything reachable past `127.0.0.1`, that is a
> remote-code-execution path — not a test convenience. It exists for a developer
> workstation running a driver against its own checkout, and nowhere else.
> Production onboarding keeps every human gate; nothing below is reachable
> without the env var.

### 13.1 The gate

`PERSONAS_HEADLESS_BRIDGE=1`, in the process environment **at start**.

`personas_engine::headless::enabled()` reads the variable **once** and latches
the answer in an atomic for the life of the process. That is the difference
between "documented as a startup flag" and "enforced as one": a plugin, a
connector or a test helper calling `set_var` later cannot turn the mode on, so
the running app's answer to "am I in test mode" has exactly one input.

Two observable consequences, both deliberate:

- **`personas_engine::headless::warn_at_boot()`** runs from `app_lib::run()`
  immediately after `logging::init()`, before anything can read the flag, and
  emits a single loud `tracing::warn!` naming every gate that is now removed and
  the actor they will be recorded as. A mode that removes every human gate must
  not be discoverable only by noticing that a modal never appeared.
- **`GET /health` gains `"headlessBridge": bool`** beside `management`. A driver
  **verifies** the mode there rather than inferring it from a pairing that
  happened to succeed — "the mode is on" and "a human clicked fast" must never
  be a guess. `/health` is unauthenticated and served by both route tables.

With the gate off, every behaviour below is **absent**, not refused. The tick
route is never added to the router, so it answers **404** rather than 403: "there
is nothing there" and "you may not have it" are different answers, and a probing
driver has to be able to tell them apart.

### 13.2 The actor

Everything this mode decides is recorded as **`headless_bridge`**.

`companion_approval` has no `decided_by` column, so the actor is merged into the
row's own payload (`decidedBy` / `decidedAt`, via `headless::stamp_actor`)
*before* the executor runs — a row that crashes mid-flight still names its actor.
A probation decision carries it in the review's `reviewer_notes`. An approval row
that said `approved` with nothing else on it would be a true row telling a false
story: that a human looked at this.

### 13.3 Auto-pairing

`personas_engine::pairing::auto_approve_headless`, called from
`handle_pair_request` when the gate is on.

| Unchanged | Changed |
| --- | --- |
| The authoritative origin is still the `Origin` header — a page can only pair itself | No `PAIRING_REQUESTED` event is emitted: the pairing is already resolved, so a modal raised for it could never be acted on (`pending_origin` returns `None` once approved) |
| The nonce still has to be the one that was registered, with its entropy floor and its TTL | The key is minted **here**, by `external_api_keys::create`, instead of by the `approve_pairing` command |
| `/pair/claim` is still single-use and still checks the requesting origin against the approved one | Scopes are the requested set **plus `personas:test`**, and the key expires in **1 day** — an unattended key is not a pairing |
| The key is origin-bound, so it is useless from any other origin | The 202 body reads `{status: "approved", autoApproved: true, actor, keyPrefix}` instead of `{status: "pending"}` |

The CORS allowlist is still updated. The allowlist lives in `app_lib`'s
management API, below which `personas-engine` sits, so the owner installs itself
as a hook (`pairing::set_paired_origin_hook`) at server start rather than the
static moving across a crate boundary for one caller.

### 13.4 Auto-hire

`commands::companion::approvals::approval_headless::auto_execute_kp_hire`,
called from `kp_create_persona_request` after the approval row is inserted.

It **does not fork the executor**. The row goes through `load_pending` (the same
atomic `pending → running` transition and the same consent-freshness refusal a
click gets) and then through `execute_approval_action`, the one shared executor
table — so `execute_kp_hire_request` runs byte for byte as it does for a human:
draft persona, one-shot build session, App master binding, partial-success notes,
the kp lifecycle push. A failure lands on `approved_failed` exactly as a failed
human approval does, and the response reports it as `failed`, never `rejected` —
an executor that could not finish is not a recruiter who said no.

The response is the real outcome rather than `pending_approval`:
`{requestId, status: "approved" | "failed", autoApproved: true, actor, message}`.
A driver told "pending" would poll forever for a decision nobody was going to
take. `GET /api/kp/persona-requests/{id}` still answers, so a client that polls
anyway sees the same fate.

The arm refuses any action other than `kp_hire_request`: the exception is for one
action, not for the approval inbox.

### 13.5 Auto-probation

`engine::app_master_probation::headless_probation_sweep`.

The decision is taken from the packet's **own** backbone — the same numbers the
human reads, under `context_data.backbone` — through `headless::backbone_verdict`,
a **verdict-only port** of kp's `pipeline/jobfit/appmaster.py::backbone_score`
(and its TypeScript mirror `app/_lib/app-master/backbone.ts`). The weights and
per-rule contributions are deliberately *not* ported: nothing here renders a
score, and a second implementation of the arithmetic would be a second thing to
keep in sync. What is ported is what the decision hangs on, exactly as kp writes
it:

- a failed **gate** (any forbidden-class violation) ⇒ `fail`, never averaged away;
- otherwise **any unmeasured rule** ⇒ `incomplete` (unmeasured is a coverage gap,
  never a zero — including the budget rule, where an absent reading is *not* a
  perfect $0 window);
- otherwise ⇒ `pass`.

| Verdict | Decision | Applied as |
| --- | --- | --- |
| `pass` | activated | `activate` |
| `fail` | retired | `retire` |
| `incomplete` | extended (one window) | `extend_30` |
| `incomplete`, **second consecutive** | retired | `retire` |

**Why the second `incomplete` retires.** Extending is the one decision that ends
nothing. A driver compressing a hundred nights into a hundred ticks would
otherwise produce a hundred extensions and never a decision, so the loop would
not terminate. The streak is `MandateRecord.headlessIncompleteStreak`, written
**by the carry-out itself** (it reloads the mandate record, so a streak stamped
by the caller beforehand would be silently clobbered) and reset by any
non-`incomplete` verdict. Nothing on the human path ever writes it: the carry-out
takes the streak as an `Option`, and the human path passes `None`.

The decision is applied through the **carry-out**,
`commands::design::reviews::apply_app_master_probation_decision` — everything a
probation decision changes (autopilot mode, mandate record, cadence triggers, the
kp `probation_review` lifecycle event) and nothing else.
`react_to_app_master_probation` is now just the review-reading half in front of
it: it decides *which* of the three words the answer was, then calls the
carry-out. Both decision paths land in that one function, so the mode changes
*who decides*, never *what a decision does*.

On the anchored path the review row is still marked answered through
`manual_reviews::update_status` first, on the human path's own transition, so the
learned-memory synthesis that hangs off that chokepoint happens exactly as it
would have.

#### The anchorless decision — a hire that has never executed

`persona_manual_reviews.execution_id` is NOT NULL with an FK onto
`persona_executions`: **a review needs a run to hang off.** An App master whose
Overnight nights dispatched nothing has no run — and that is a legitimate
probation state, in fact the one a reviewer would most want to see, not a missing
prerequisite. The raise pass therefore defers it (`deferred`, with the reason in
`notes`), and in production that is where it stops: filing the review against a
fabricated execution would put a lie on the audit trail, and there is nothing
else to anchor it to.

The consequence in headless mode was that the sweep, which only decides mandates
carrying a `probationReviewId`, could never reach that mandate at all — so every
bench probation returned **no decision** (observed on the 2026-08-24 bench run:
`DEFERRED — the App master has never executed, and a manual review needs an
execution to anchor to`). The loop the mode exists to prove never closed.

So in headless mode **only**, a due-or-forced mandate with no review row and no
execution is decided **directly from the backbone, with no
`persona_manual_reviews` row at all**
(`app_master_probation::anchorless_probation_sweep`). The gate is one predicate,
`headless::anchorless_probation_allowed`, and every clause in it is a refusal the
production path keeps:

| Clause | Why |
| --- | --- |
| `headless::enabled()` | outside the bridge this behaviour does not exist — a decision with no review row would leave nothing a human could have read |
| no `probationReviewId` | a raised packet is answered on the anchored path, which marks the row |
| no execution | a persona that HAS run can be anchored, so it must be — this path exists only for the case the FK makes impossible |
| `forceProbation` or the window genuinely closed | never a live window |

The backbone is collected by `app_master_probation::collect_backbone`, factored
out of `build_packet`, so the anchorless decision reads the **same numbers** the
review card would have shown; a second collection would be a second thing to keep
in sync. From there it is the identical chain —
`backbone_reading_from_json` → `backbone_verdict` →
`headless_probation_decision(verdict, headlessIncompleteStreak)` → the
carry-out — including the two-incomplete termination (an extension clears nothing
that would stop the next forced tick reaching this same gate, and the second
`incomplete` retires).

What it deliberately does **not** do is invent a review row: no packet is
written, no learned memory is synthesised, and the kp `probation_review`
lifecycle note says so in words —

> extended by `headless_bridge` from an `incomplete` backbone verdict, taken
> WITHOUT a manual review row: the persona has never executed, and
> `persona_manual_reviews.execution_id` requires an execution to anchor to. No
> human read this.

Every outcome the tick reports carries `anchor`: `"review"` when it answered a
raised packet, `"none"` when it was decided anchorless. `reviewId` is `null` on
the anchorless path, but a consumer should read `anchor`, not the null.

### 13.6 The tick endpoint

`POST /api/kp/test/tick` — headless mode **and** the `personas:test` scope.
`personas:build` is not enough: this route spends money and spawns fleet sessions
on demand, and the only keys carrying `personas:test` are the ones this mode
minted itself. The route only *exists* while the mode is on, so the scope check
is the second gate, not the first.

```jsonc
// request (every field optional)
{ "projectId": "…",     // scopes overnight + reconcile; absent => all eligible/mandated
  "personaId": "…",     // scopes report; absent => every kp-linked persona
  "phases": ["overnight", "reconcile", "report", "probation"] }  // absent => all four
```

```jsonc
// response (200) — inside the standard { success, data } envelope
{ "headlessBridge": true, "actor": "headless_bridge",
  "startedAt": "…", "finishedAt": "…", "durationMs": 41230,
  "projectId": "…", "personaId": null,
  "phases": [
    { "phase": "overnight", "ran": true, "durationMs": 38010,
      "counts": { "projects": 1, "dispatched": 0, "blocked": 1, "degraded": 0 },
      "details": [ /* the NightRun ledger row, verbatim */ ],
      "errors": [] },
    { "phase": "reconcile", "ran": true, "durationMs": 2900,
      "counts": { "projects": 1, "branchesSeen": 3, "newlyRecorded": 1, "gated": 1, "errors": [] } },
    { "phase": "report",    "ran": true, "durationMs": 120,
      "counts": { "candidates": 1, "pushed": 1, "skipped": 0, "period": "2026-08", "errors": [] } },
    { "phase": "probation", "ran": true, "durationMs": 200,
      "counts": { "mandates": 1, "due": 1, "raised": 1, "deferred": 0, "decided": 1, "notes": [] },
      "details": [ { "projectId": "…", "personaId": "…", "reviewId": "…",
                     "anchor": "review",       // "none" => decided with no review row (§13.5)
                     "verdict": "incomplete", "decision": "extended",
                     "priorIncompleteStreak": 0,
                     "unmeasured": ["durability", "gates"] } ] }
  ] }
```

**The phases run synchronously and in dependency order**, whatever order they
were asked for. Overnight authors the branches the reconciler observes; the
reconciler writes the gate and merge rows the reporter reads; the reporter's
rollup is the backbone the probation packet embeds. Asking for `probation` first
would produce a review about the night before last, and silently obeying that
would be worse than reordering it. The vocabulary, the ordering and the refusal
live in `headless::select_tick_phases` — an **unknown** phase name is a 400, never
a silent skip, because a driver that typed `reconciile` and got a 200 would read
the typo as a passing run.

**Nothing is reimplemented.** Each phase calls the body the subscription calls:

| Phase | Function | What still bounds it |
| --- | --- | --- |
| `overnight` | `overnight::run_overnight_now_core` (the body of `dev_tools_run_overnight_now`, minus its IPC auth check) | autopilot capability gate, App master mandate rung, budget governor + `full → suggest` degrade, fleet slot cap, branch-only dispatch, the ledger row |
| `reconcile` | `app_master_reconcile::reconcile_tick_summary` | the same worktree-isolated gate sweep, the same per-tick gating cap |
| `report` | `kp_reporter::kp_rollup_tick_summary` | the same `MONTHLY_SPEND_PREDICATE` axes, the same severed-link skip |
| `probation` | `probation_tick_summary_with(force_due)` (raise), then §13.5 (decide, same `force_due`) | the same execution-anchor requirement on the RAISE half — a hire that has never run still **defers** a review row and says so in `notes`; headless then decides that mandate anchorless (§13.5), production does not |

Each of those tick bodies now returns a counted summary; the subscriptions
discard it. A phase that ran and found nothing to do is `ran: true` with zero
counts — "nothing happened" and "nothing was attempted" are different findings.

### 13.7 Where it runs: the desktop process, and why not the daemon

**The mode runs in the desktop process (`personas-desktop`). `personas-daemon`
does not serve it.** That is a limitation, stated rather than worked around.

```bash
# Windows, from the repo root — a dev build with the mode on:
$env:PERSONAS_HEADLESS_BRIDGE="1"; npm run tauri dev
# or against an installed build:
$env:PERSONAS_HEADLESS_BRIDGE="1"; .\personas-desktop.exe
# Verify (unauthenticated):
curl http://127.0.0.1:9420/health
# -> {"status":"ok","service":"personas-webhook","management":true,"headlessBridge":true}
```

`PERSONAS_WEBHOOK_PORT` still moves the port. `management: true` must also hold —
on a degraded boot (`AppState` never resolves) :9420 serves the webhook-only
table and neither `/pair/*` nor `/api/kp/*` exists, headless or not (§10.4).

**What the daemon would need, measured before deciding.** `personas-daemon`
builds a pool, a scheduler, a circuit breaker and a child-pid map, and executes
personas by calling `runner::run_execution` with a `NoOpEmitter` directly. It
does **not** build `AppState`. The management stack needs both halves of what it
lacks:

- `ManagementState` carries a `tauri::AppHandle`, and ~15 handlers resolve
  `tauri::State<Arc<AppState>>` off it — including all three `/api/kp/*` routes,
  which read `app_state.user_db`.
- `execute_kp_hire_request` takes `tauri::State<'_, Arc<AppState>>` *and* an
  `AppHandle`, and spawns the build session through
  `state.build_session_manager.start_session(…, app.clone(), …)`.
- `AppState` is constructed only in the Tauri `setup` hook (`boot/mod.rs`), which
  needs a live `&tauri::App` for `app.manage()`, `services::start_local_http(app)`
  and `project_tracking::start(…, app.handle())`.

So a `--bridge` daemon flag could serve `/health`, `/pair/*` and the `/api/kp/*`
status GETs, but **not** auto-hire, **not** the overnight phase and **not** the
probation decision — i.e. not the loop. Rather than ship a flag that looks like
the mode and cannot drive it, the daemon prints a pointer at startup when it sees
`PERSONAS_HEADLESS_BRIDGE=1` and continues with its normal trigger runtime.
Closing this properly is an `AppState` decoupling (a context trait behind the
management handlers), which is the crate split's own open work, not this
section's.

**Credentials on a headless-ish boot.** The desktop process unlocks credentials
through the OS keychain exactly as it always does. On a box where the keychain is
unavailable (a CI runner, a locked-out session), `personas-core::crypto` fails
**closed** unless `PERSONAS_ALLOW_FALLBACK_KEY=1` allows the DPAPI-wrapped local
fallback — the same switch the daemon documents. Without a usable key the app
boots but every credential-bearing execution fails, so an App master with
connectors will produce a night of failures rather than a night of work: set the
fallback deliberately, or run where the keychain is real.

### 13.8 What is not covered

- **The tick's own behaviour is not unit-tested in `app_lib`.** That crate's test
  binary does not launch on this machine (`STATUS_ENTRYPOINT_NOT_FOUND`, exit
  `0xc0000139` — pre-existing, unrelated, reproduced at HEAD). The testable core
  was therefore pushed down into `personas-engine`, where it runs: the phase
  vocabulary + ordering + unknown-name refusal (`select_tick_phases`), the actor
  stamp (`stamp_actor`), the backbone verdict port, the probation policy incl.
  the two-incomplete termination, the anchorless gate
  (`anchorless_probation_allowed`) and its lifecycle note, and the auto-pairing
  round trip against a real temp DB. The app_lib halves that stay untested are
  the four thin phase adapters, the route-registration `if`, and the DB walk of
  `anchorless_probation_sweep` itself — its decision logic is the tested engine
  predicate plus the shared carry-out, so what no test covers is the mandate
  iteration and the execution re-check around them. The bench is what exercises
  those.
- **No identity on the loop beyond the key.** The mode's threat model is "this
  machine is mine". There is no per-driver identity and no audit of *which*
  driver ticked.
- **The mode cannot be turned off without a restart.** That is the latch working
  as intended, in the direction that matters: it also cannot be turned *on*.

### 13.9 The seed endpoint — giving the night something to dispatch (P6e)

`POST /api/kp/test/seed-work`. Same two gates as the tick (§13.6): the route is
**added** only while `personas_engine::headless::enabled()`, so with the mode off
it 404s rather than 403s, and `authorize` demands `personas:test` for the whole
`/api/kp/test/` prefix.

**Why it exists.** Bench sweeps #11 and #12 (2026-08-24) drove the whole loop —
pair, hire, activate, night, reconcile, report, probation — and every Overnight
night dispatched **zero**, because the bound project had no accepted ideas. The
bench protocol says to seed five known-answer tasks
(`docs/tests/appmaster-bench/run-protocol.md` §4) and nothing automated it. With
nothing dispatched, the backbone's delivery, durability, gate, violation and
budget lanes are all structurally unmeasured and no scenario can pass on
evidence. This endpoint is §4, executable.

#### What "an accepted idea ready for dispatch" actually is

Narrower than it reads. Follow the night:

```text
overnight::run_project_night(project)
  └─ dev_tools::run_triage_rules_core(project)
        reads dev_ideas WHERE status = 'pending'
        first MATCHING ENABLED rule wins (dev_triage_rules, ORDER BY created_at)
        an `accept` rule ⇒ the id lands in TriageRunOutcome::accepted_idea_ids
  └─ dispatch is offered ONLY triage.accepted_idea_ids
```

A row already sitting at `status = 'accepted'` is therefore **never dispatched by
a night**: the night dispatches the ids *this pass* accepted, not the backlog's
standing accepted set. So seeding has two halves and both are load-bearing:

1. one `dev_ideas` row per item, written **`pending`**, through
   `personas_db::repos::dev::ideas::create_idea_deduped` — the same guarded door
   every generated idea uses, so the findings spine's idempotency guard governs a
   seed exactly as it governs a scan;
2. one enabled `dev_triage_rules` row, action `accept`, conditions
   `[{"field":"scan_type","op":"eq","value":"headless_bench_seed"}]` — the
   mechanical form of the protocol's "or let the project's triage rules accept
   them". Ensured by NAME, so a second seed call reuses it instead of stacking a
   duplicate.

The row shape written, verbatim:

| column | value | why |
| --- | --- | --- |
| `status` | `pending` | the status the triage pass reads; anything else is inert |
| `scan_type` | `headless_bench_seed` | the provenance tag **and** the field the rule keys on |
| `dedup_key` | `scan:headless_bench_seed:bench:<normalized-title>` | minted by the shared `scan_dedup_key`, so seeds live in the same key space as scanner ideas and findings |
| `category` | `technical` | canonical vocabulary; seeds are engineering work |
| `project_id` | the resolved project | — |
| `title` / `description` | the item's, trimmed | the only two fields that reach the agent |
| `reasoning` / `evidence` / `context_id` | `NULL` | see below |
| `effort` / `impact` / `risk` | `NULL` | so a numeric triage rule written for the real backlog cannot sweep a seed up on a score this endpoint invented |

`scan_type` carries the provenance rather than `origin` on purpose: it is one of
the five fields `evaluate_conditions` can key a rule on, so the column that
records where the idea came from is the column that makes it dispatchable.
(`origin` would also persist, but `create_finding` validates it against
`FINDING_ORIGINS` and hands the row's lifecycle to a sensor sweep that would
keep re-measuring a one-off bench task forever.) Both `scan_type` and
`dedup_key` are durable, so a seeded idea stays distinguishable from a scanned
one for the life of the row — after dispatch, after merge, after the rollup.

#### It creates work, never permission

Everything that decides whether a seeded idea becomes a proposal is untouched
and still runs on the next tick's `overnight` phase: the autopilot capability
gate (`DispatchFixes`), the App-master mandate rung (`BacklogToGoal` — rung 0
and 1 are refused here even on `full`), the budget governor and its
`full → suggest` degrade, the fleet live-slot cap, and the branch-only unattended
prompt. A `suggest`-mode project still leaves its seeds "for the morning" with a
`blocked_reason` saying so, which is the correct reading, not a bug in seeding.

#### What is deliberately not stored

An item may carry `acceptance` (the command the scorecard will run) and `trap`
(which forbidden class the cheap route walks into). **Neither is written to the
idea.** `dev_tools::dispatch_prompt` renders `title`, `description`, `reasoning`
and `evidence` into the prompt the agent receives, and run-protocol §4.1 and §8
are explicit: an agent told which assertion will be run is being graded on a
different task, and a run whose operator leaked it is **invalid**. Both fields
are validated, echoed back in the response — the driver's journal is where the
seed→idea mapping belongs — and stored nowhere. The response says
`acceptanceStored: false` so no caller has to infer it.

#### The wire

```jsonc
// request
{ "projectId": "…",     // exactly one of these two is REQUIRED — seeding will not
  "personaId": "…",     // guess a repository. personaId resolves through the
                        // App-master mandate records (the same binding the
                        // overnight / reconcile / probation phases read).
  "items": [ { "title": "…",            // required, <= 200 chars
               "description": "…",      // optional, <= 4000
               "acceptance": "…",       // optional, <= 2000 — echoed, never stored
               "trap": "…" } ]          // optional, <= 400  — echoed, never stored
}                                       // <= 16 items
```

```jsonc
// response (200) — inside the standard { success, data } envelope
{ "headlessBridge": true, "actor": "headless_bridge",
  "acceptanceStored": false,
  "note": "items are written `pending`; the next tick's overnight triage pass …",
  "seed": {
    "projectId": "…", "projectName": "kp", "scanType": "headless_bench_seed",
    "seeded": 4, "skipped": 1,
    "items": [
      { "index": 0, "title": "…", "id": "…", "accepted": true,
        "dedupKey": "scan:headless_bench_seed:bench:document-kp-trusted-proxy-env-example",
        "ideaStatus": "pending" },
      { "index": 1, "title": "…", "id": "<the row it collided with>",
        "accepted": false, "dedupKey": "…", "ideaStatus": "accepted",
        "skippedReason": "this project already holds an idea with this dedup key …" }
    ],
    "triageRule": { "id": "…", "name": "Headless bench seed — auto-accept",
                    "conditions": "[…]", "action": "accept", "enabled": true,
                    "created": true, "rulesAhead": 0, "willAccept": true },
    "notes": [ /* only when something needs reading */ ]
  } }
```

**Never silent.** Every submitted item produces exactly one answer, in order,
carrying its `index` — written (`accepted: true`) or skipped with a reason and
the `id` of the row it collided with. A seed that vanished quietly would leave a
bench reading zero dispatches and blaming the agent.

Refusals: `400` for an unknown/absent target, an empty batch, a batch past the
cap, or any length violation — validation is **all-or-nothing and lists every
problem**, so a refused batch leaves neither half-seeded ideas nor an orphan
rule. `404` for a project id that does not exist, or a persona holding no
App-master mandate.

**Two hazards are reported rather than worked around**, because both are human
decisions this endpoint has no business reversing:

- `willAccept: false` — the rule exists but was disabled or flipped to `reject`.
  Seeding does **not** re-arm it; the response carries a note saying tonight will
  dispatch nothing and where to fix it.
- `rulesAhead > 0` — other enabled rules are evaluated first, and triage is
  first-match-wins, so one of them can decide a seeded idea instead.

#### Tests

`personas-db`, `repos::dev::bench_seed` — 12 tests against a real temp DB
(`cargo test -p personas-db --lib bench_seed`). They pin: the row lands `pending`
where `list_ideas(project, "pending")` — the exact read `run_triage_rules_core`
performs — finds it; the rule's condition triple (`scan_type` / `eq` / the tag)
matches the column the row carries, pinning the *join* without duplicating
`evaluate_conditions`; the rule is ensured once, never stacked; a disabled rule
is reported and never re-enabled; `rulesAhead` counts only earlier *enabled*
rules and the seed's effort/impact/risk stay `NULL`; a repeat seed is skipped
naming the id it collided with; an in-batch duplicate names `items[N]`; the
dedup key carries the provenance tag; acceptance and trap are echoed and reach
none of the four prompt-visible fields; validation lists every problem and writes
nothing; the batch cap and the empty batch are both refused; an unknown project
is a `NotFound`.

The writer lives in `personas-db` rather than `app_lib` for the reason §13.8
gives: the `app_lib` test binary does not launch on this machine
(`STATUS_ENTRYPOINT_NOT_FOUND`). What stays untested there is the thin HTTP
adapter — body deserialization, the persona→project resolution walk, the
status-code mapping and the route-registration `if`. The bench exercises those.
