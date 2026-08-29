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
| `GET /api/kp/persona-requests/{id}` | any valid key | Derived status: `pending` \| `approved` \| `rejected` \| `failed` \| `expired`, plus `personaId` / `personaName` / `buildPhase` once the executor has stamped them, and `buildFailureReason` when the build session ended `failed` (§10.7). 404s for any approval row that is not a KP hire request, so it cannot enumerate the inbox. |
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

### 10.5 The hire's requested surface — a build attaches only what was asked for (2026-08-24, connectors 2026-08-26)

A kp hire request names the surface it wants (`spec.connectors`, typically
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
   before it may propose a diff (§12.1); with no gates declared, no runner. Only
   **one** alias survives — see "One runner, not five" below.

Everything else is dropped.

**One runner, not five (2026-08-26).** Rule 4 admits a command runner, and
`COMMAND_TOOLS` lists five spellings of it. Sweep #23's **kp-default** hire had
the design pass emit two — `run_command` *and* `bash` — the verification pass ran
its commands through one of them, and the gate held the build on
`1 tool(s) reported as available but never actually called (bash)`. That is the
same over-provisioning P6d removed, one level down: the build was not asking for
two capabilities, it was spelling one twice.

So exactly one runner now survives. `canonical_command_runner` scans every alias
the build names — tools **and** `tool_hints`, because `run_tool_tests` unions the
hints into the set it tests, so the two lists must not settle on different
spellings — and keeps the winner by `COMMAND_TOOLS` order. The rest are dropped
into `removed_duplicate_runners`, logged with a message distinct from the
out-of-surface detaches (these were *inside* the surface; reading them as
"outside the requested surface" would send the next investigator to
`spec.connectors`, which is not where the answer is) and reported in
`setup_detail.notes`.

> **`run_command` leads the list on observed behaviour, not on a list
> membership — and the lists disagree.** It is *not* on
> `tool_tests::PLATFORM_BUILTIN_TOOLS`; neither is `bash`, so neither gets a
> free pass from the gate. The code-authored list that *does* mention them,
> `connector_readiness::is_native_cli_capability`, names `bash` and `shell` as
> Claude Code natives and does **not** name `run_command` — i.e. it points the
> other way. The order follows the one piece of direct evidence: in sweep #23
> `run_command` is what actually got exercised and `bash` is what was left
> uncalled. If a later sweep shows the reverse, reorder `COMMAND_TOOLS` — the
> preference is a list order rather than an `if` precisely so that is a one-line
> change.

No other allowed family gets this treatment and none should invent one:
`BASELINE_TOOLS` are on `PLATFORM_BUILTIN_TOOLS` and pass on a code-authored
claim, and `TRANSPORT_TOOLS` are each exercised with a real curl — neither family
can leave a sibling uncalled.

**The connectors (2026-08-26 — the gap this section used to leave open).** The
first pass stopped at tools, on the reasoning that the bench evidence named tools
and that connectors additionally drive credential injection, readiness and
`setup_detail`. **Bench sweep #23** (2026-08-26, the first hire on the `ascent`
repo) then produced the connector-shaped version of the same defect. The `ascent`
codebase mentions GCP, so the design pass attached a **Google** connector on top
of the `["github"]` the hire actually asked for, and the build died on

```text
Validation error: Google OAuth client credentials are missing.
Set one of: GCP_DESKTOP_CLIENT_ID/GCP_DESKTOP_CLIENT_SECRET …
```

An over-provisioned *tool* costs a held promotion. An over-provisioned
*connector* costs more, because a connector is the thing that carries a
**credential requirement** into every downstream pass: `run_tool_tests`'
connector-driven injection walks `agent_ir.required_connectors` and reaches the
Google/Microsoft OAuth resolvers per connector (`engine/runner/credentials.rs`),
and promote resolves the same list into `credentialLinks`, `setup_status` and
`setup_detail`. A connector nobody asked for therefore turns a missing secret
into the hire's problem.

> Honest limit on the post-mortem: the frame that *propagated* sweep #23's string
> was not pinned down. Most of the build path swallows the OAuth resolver's error
> (`…().ok()` at `engine/runner/credentials.rs`), and the one chain that does
> propagate it — `run_scripted_connector_tests` → `run_healthcheck` →
> `resolve_oauth_token` — sits behind `PERSONAS_SCRIPTED_TOOL_TESTS`, which is set
> nowhere in the repo. Do not read the fix as "we found the `?`". The fix is that
> a connector the hire never requested has no business being in the IR at all, on
> any of those paths.

So `constrain_agent_ir` now trims connectors by the same rule. A connector
survives when **either**:

1. it belongs to a **requested connector** — its name or its declared
   `service_type` matches, by the same bidirectional-substring rule with the same
   short-name guard, so "a github connector" and "a github tool" mean the same
   thing; or
2. it **binds no user credential**, and so can never reach the validation this
   exists to prevent. Two sources, unioned: the code-authored
   `BASELINE_CONNECTORS` (mirrors `tool_tests::PLATFORM_CONNECTORS` —
   `personas_database`, `messaging`, …, matched EXACTLY so a model-authored
   `personas_gmail` mints nothing), plus whatever the DB glue resolved out of the
   live catalog as `ConnectorClass` other than `Credential` — `codebase`,
   `local_drive`, `twin`, `obsidian_memory`. An App master that lost `codebase`
   would lose the project it was hired to own.

A name the catalog does not know is credential-bearing and is dropped: fail
closed, because a model-invented connector name is exactly what sweep #23 was.

`service_flow` is trimmed in the same pass, and **before** it would matter:
`AgentIr::effective_connectors_json` derives connectors from `service_flow` when
`required_connectors` is empty, so a flow step left behind would re-mint the
connector the trim had just removed. Both shapes are read (the current prompt's
`{connector_name, action_label, order}` objects and legacy bare strings); a step
that names no connector, and the two names the derivation itself excludes
(`Local Database`, `In-App Messaging`), are left alone.

Every connector and flow step dropped is logged one line per detach at `info`,
counted in the summary line, **and** written into `setup_detail.notes` at promote
next to the design-pass hygiene notes (§10.6) — a dropped connector is a fact
about this persona's reach, and reach is what the operator reads that surface
for.

**The enforcement points.** `build_session::kp_surface::apply_kp_tool_surface` is
the DB glue (read the link, resolve the credential-free connector names from the
catalog, log every detach) and is called at the two — and only two — places a
build's tool and connector sets are consumed:

- `oneshot::run_test_pass`, **before** `run_tool_tests`, so the gate exercises a
  small real surface instead of holding on an invented one — and so the
  connector-driven credential injection inside `run_tool_tests` never reaches an
  OAuth connector nobody requested;
- `promote_build_draft_inner` (`commands/design/build_sessions.rs`), **before**
  `prepare_tool_actions`, so the persona is attached the same surface that was
  verified. Filtering only at test time would verify one set and ship another.

**No behavior change off the kp path.** `KpToolSurface::from_design_context`
returns `None` for every persona without a `kp_link`, so an ordinary build is
never handed a surface and its IR is never touched.

Limits worth knowing:

- The pass is **purely subtractive**. An allowed name the design pass did not emit
  stays absent — nothing is injected to make a surface look complete.
- ~~It does **not** narrow `required_connectors`.~~ **Closed 2026-08-26** by the
  connector rule above, after sweep #23 turned the open item into a dead build.
- A legacy `kp_link` (written before 2026-08-24) carries an empty
  `requested_connectors`, so it now vouches for **no connector at all** — the same
  honest default the tool pass already applied. Such a hire keeps only its
  credential-free connectors.
- A hire whose design pass produces **nothing** inside the requested surface ends
  with zero tools, which `run_tool_tests` reports as the defensible empty pass.
  That is logged at `warn` rather than failed — it is a signal about the design
  pass, not about the persona.
- The policy lists mirror lists elsewhere on purpose: `TRANSPORT_TOOLS` ↔
  `build_sessions::GENERIC_TOOL_NAMES`, `BASELINE_CONNECTORS` ↔
  `tool_tests::PLATFORM_CONNECTORS`. Each pair is meant to name the same things,
  so change them together.

Tested in `personas-engine` (19 checks in `kp_tool_surface` — 4 for the connector
rule, 4 for the canonical runner), where the crate's test binary actually runs —
see §13.8 for why the pure logic lives there.

### 10.6 Design-pass hygiene — a suggested trigger never fails the hire build (2026-08-25)

The one-shot build's design pass proposes triggers. `promote_build_draft_inner`
then validates them (step 3, `validate_triggers`) and, until this change, a
proposal it did not like failed the **whole build**. Bench sweep #17 lost two
live kp hire sessions — 20–40 minutes of Claude session each — to two strings:

| Session | Refusal | What the design pass actually wrote |
| --- | --- | --- |
| `b18ae540…` (one-shot kp hire) | `Validation error: Invalid cron expression: Invalid value: {{param.daily_audit_hour}}` | the placeholder it had been *shown*, un-substituted |
| kp-tight-budget | `Validation error: Invalid cron expression: Expected 5 fields, got 1` | a bare cadence word / number where a 5-field cron belongs |

Neither validator was wrong. The blast radius was: every tool test, every fix
pass and every row that would have been promoted went with one advisory field on
one trigger. The same log lines also carried
`missing_cap=uc_baseline_scan missing_field=suggested_trigger` — capabilities the
design pass gave no trigger suggestion at all (see the last bullet below).

**The rule.** `personas_core::validation::design_pass_hygiene` runs **once**, in
`promote_build_draft_inner`, on the built IR — after adoption answers and recipe
parameters are applied, **before** `ensure_webhook_secrets` and therefore before
`validate_triggers`. A cadence suggestion that cannot be honoured costs the
*trigger*; it never costs the *build*.

Unresolved `{{…}}` placeholders, in any string in a trigger config (recursed
through nested objects and arrays) and in `agent_ir.events[]`, keyed on the
field's own name:

| Field | Rule |
| --- | --- |
| `cron`, `cron_expression` | → `0 2 * * *` — the same nightly default `app_master_hire::install_triggers` already applies to a kp `schedule` trigger arriving without a cron |
| `timezone`, `time_zone`, `tz` | → `UTC` — the only zone guaranteed to parse |
| `url`, `endpoint`, `webhook_url`, `callback_url`, `event_type`, `listen_event_type` | demote the trigger — a poller aimed at a guessed URL is worse than no poller |
| `trigger_type` itself | demote the trigger — the kind is unknowable |
| everything else (`interval_seconds`, `window_seconds`, `webhook_secret`, numeric params) | drop the field |
| `events[].event_type` | drop the whole event subscription |
| `events[].source_filter` | drop the field — the subscription keeps its event type and stops filtering by source |

A `schedule` trigger's **cron** is then checked for real, in order:

1. it parses (`personas_core::cron::parse_cron`, Jenkins-`H` forms included) →
   untouched;
2. it is a recognised shorthand → coerced: `daily` / `nightly` / `@daily` /
   `every day` → `0 2 * * *`, `@midnight` → `0 0 * * *`, `hourly` →
   `0 * * * *`, `weekly` → `0 2 * * 1`, `monthly` → `0 2 1 * *`, `yearly` →
   `0 2 1 1 *`, and a bare hour `0`–`23` → `0 <n> * * *`. A design pass that
   wrote `daily` communicated a real cadence and only got the notation wrong;
3. anything else → the trigger is demoted, with a note quoting the raw value
   verbatim so a reviewer sees what the model actually proposed.

A `schedule` trigger's **timezone** that `scheduler::resolve_schedule_tz` cannot
parse (`"local"`, a city name) becomes `UTC`. Left alone it is worse than a
validation error: `compute_next_from_config` returns `None` and
`create_triggers_in_tx` raises the "born dead" refusal one step further along.

**Demote, not delete.** `ir.triggers[i]` is positionally aligned with
`ir.use_cases[i]` — `build_structured_use_cases` reads `ir.triggers.get(idx)`,
and the capability-exclusion pass filters both arrays in lock-step. Removing an
element from the middle would hand every later capability the wrong trigger. So a
doomed trigger is rewritten **in place** to `manual` with an empty config,
keeping its description and its `use_case_id`: the capability stays and becomes
on-demand, which is exactly what the vocabulary already means by "no trigger".

**The leniency is scoped to model output.** This pass runs on a build session's
IR and nowhere else. `trigger_repo::create` / `update` — the IPC commands behind
the trigger UI — are untouched and stay strict, because a human who types `daily`
into the Add-trigger form is told so immediately and for free. The validators
themselves were not relaxed at all: `validate_config` still rejects `daily` and
`* * *`, asserted by
`a_human_authored_bad_cron_is_still_refused_by_the_validator`.

**Where a reviewer sees it.** Every change is logged one line at a time at
`warn`, naming the field and the raw value, plus a summary line. The full note
list is written to `personas.setup_detail.notes` (new `PersonaSetup` field,
`#[serde(default)]`, carried forward by `recompute_persona_setup` so a later
credential recompute cannot erase it), and the counts ride back on the promote
result as `design_hygiene_normalized` / `design_hygiene_dropped`. A build that
silently dropped a schedule and then reported a persona that "runs on its own" is
the drift this list closes.

Limits worth knowing:

- A **missing** `suggested_trigger` was already non-fatal and still is. In
  one-shot mode `runner.rs` logs `missing_cap=… missing_field=suggested_trigger`
  at `warn` and lets the `agent_ir` through deliberately (the user cannot answer
  a clarifying question in an autonomous build); promote then reads
  `ir.triggers.get(idx) → None`, writes `suggested_trigger: null` on the
  capability and creates no trigger row. The capability is on-demand — the same
  end state a demotion produces.
- The pass only **adds** a field to a trigger it already changed. A schedule that
  arrives with neither cron nor interval and nothing else wrong with it is still
  the pre-existing `validate_schedule_has_cron_or_interval` refusal, asserted by
  `an_untouched_schedule_with_no_cadence_keeps_its_pre_existing_refusal`.
- A cron that **parses but has no future fire time** (`0 0 30 2 *`) still reaches
  `create_triggers_in_tx` and still raises the "born dead" refusal. Open — the
  hygiene pass checks syntax, not reachability.
- `interval_seconds` is only repaired when it was a *placeholder*. A malformed
  literal interval still fails `validate_config`. The bench evidence named cron
  twice; widening the coercion is a separate change.

Tested in `personas-core` (33 checks in `validation::design_pass_hygiene`) —
`app_lib`'s test binary cannot launch on the operator's machine
(`STATUS_ENTRYPOINT_NOT_FOUND`), so the pure logic lives where the tests run, the
same reasoning as §10.5.

### 10.7 Build stalls fail fast — an unattended design pass that stops converging (2026-08-26)

- **The burn.** Bench sweeps #21 / #23 / #24 caught one-shot hire builds looping:
  session `7991b75d…` logged `Gate-pass entry … events=["Progress","Progress"] …
  turn=N resolved=0 coverage_caps=0` for all **12** turns — each turn a real
  Claude session, ~64 minutes total — and only then failed at `MAX_TURNS`. The
  P6h retry built the same spec in ~15 minutes, so the loss was the looping, not
  the work. Nothing compared a turn to the one before it.
- **The guard.** `runner.rs` now fingerprints every turn on three signals —
  `resolved_cells.len()`, `coverage.len()`, and a hash of the design output
  (resolved cells + `agent_ir`, so a rewrite of an already-resolved cell still
  counts as progress). `K` consecutive flat turns (default **3**, override
  `PERSONAS_ONESHOT_STALL_TURNS`, `0` disables) end the session as `failed` with
  `design_pass_stalled: N turns without resolution`. **Unattended builds only**
  — an interactive session is *supposed* to sit flat while the human answers a
  clarifying question, so `stall_turns` is 0 there.
- **kp can read the reason.** `GET /api/kp/persona-requests/{id}` now returns
  `buildFailureReason` alongside `buildPhase`: the session row's
  `error_message`, and only when the phase is `failed`. Without it a bench driver
  sees `buildPhase: "failed"` and cannot tell a stall from a validation refusal
  or a dead CLI without opening the desktop app's log.
- Tested in `personas-engine` (13 checks in `build_stall`) — the predicate is
  pure (`stalled(history, k)`), same reasoning as §10.5 and §10.6.

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
| (h) memory (M3a) | Seed both existing stores so the first night is not amnesiac. **Persona lane** (`persona_memories`), at most five rows: ONE `instruction`/importance-5 identity row promoted to tier `core` (mission, rung, forbidden-class count, owner, monthly budget, probation days, tagged `identity,kp_hire`, provenance stated in the text as "Hired via kp on `<date>`"), plus `fact`/importance-3 rows for the declared gates, hot spots and risk areas and one `instruction`/importance-4 row for the objectives (all tagged `dossier,kp_hire`, all at the default tier). **Project lane** (`dev_memories`, `source_kind = kp_dossier`, `source_id` = the dossier field name, `category = fact`, importance 6): `declared_gates`, `hot_spots`, `risk_areas` — idempotent, so they outlive the tenure and a re-hire inherits rather than duplicates them. Runs **only if (g) persisted** — an identity memory stating a rung nothing enforces would be recalled as true forever — and is **best-effort** like every other step. |

**Shape mismatches, resolved explicitly.** `DevKpi` has no `key` and no
`window` column, so kp's `kpiKey` and `windowDays` ride in `measure_config`
under an `appMaster` envelope (which is also how the reporter finds these rows
again). `direction` is mapped `gte→up` / `lte→down` and mapped back on the way
out. `category` is `value` and `measure_kind` is `manual`: nothing on the
Personas side knows how to read a kp objective automatically, and a `codebase`
kind would claim an automated reading no binding exists for. A **null baseline
stays null** — `baseline_value` is nullable, so "nobody measured this" survives
the write.

**Step (h) is the ONLY writer of tier `core`** (registry `agent-memory` /
memory-governance). Core is always-included in recall, so each core row is a
permanent tax on every future prompt, and an agent that can promote its own
beliefs to always-included can rewrite its own mandate. Every other memory
writer — night outcomes, reconcile events, probation decisions — writes
`learned`/`constraint` at the default tier, and agent-inferred claims about the
owner go through the memory *proposal* lane. Two known limits, carried rather
than hidden: kp's `AppMasterSpec` sends `app.dossierId` and **not the dossier**,
so `hotSpots`/`riskAreas` are seeded only if an (optional, forward-compatible)
`appMaster.dossier` block travels — otherwise their absence becomes a setup note
rather than a plausible substitute; and because the identity row carries the hire
date, a re-hire on the same project adds its own core row beside the
predecessor's instead of deduping into it. That is deliberate: two identity rows
on one persona *is* a re-hire.

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
measurement.

**Every reading about the HOLDER is windowed to its TENURE, not the project's
month** — see §11.4.1. "This month" in the table means "this month, from this
hire onwards". The one field that is *not* windowed is `baselineGateHealth`,
which is a reading about the repository rather than the holder and says so.
What is real today, and what is not:

| Field | State | Source / why |
| --- | --- | --- |
| `proposalsOpened` | **real (P6o)** | `COUNT` over `app_master_proposals` for **this persona** of branches whose `first_seen_at` falls in the tenure window **and that carry at least one commit** ahead of the project's main branch. Delivery is counted from what the reconciler observed to exist, never from what was launched. `None` **only** when this holder has no proposal row at all — the same rule as `proposalsMerged`. **It may lag `sessionsDispatched`**: the reconciler is a 30-minute tick and the dispatch is asynchronous, so between a night and the next settle there are sessions launched and no branches recorded yet. Under-reporting delivery until the observation is made is the correct direction of error. |
| `sessionsDispatched` | **real (P6o)** | `SUM(dispatched_count)` over the project's `autopilot_night_runs` **since the hire** (§11.4.1; the table carries no actor column, so the window is the whole attribution). A **launch** count and nothing more — it says the engine spawned workers under the branch-only guardrail, not that any of them authored anything. It feeds **no** delivery rule on kp's side; it exists so the gap against `proposalsOpened` stays visible. `None` when the engine has not run for the project (no ledger, not zero). |
| `proposalsMerged` | **real (P5a)** | `COUNT` over `app_master_proposals` for **this persona** where `merged_at` falls in the tenure window. Set by the reconciler when `git merge-base --is-ancestor <branch> <main_branch>` says the tip landed; the date is the committer date of the earliest main-branch commit that descends from it. `None` **only** when this holder has no proposal row at all — with no ledger there is nothing to be right about. Once one of its proposals exists, `0` is a real reading. |
| `proposalsReverted` | **real (P5a)** | `COUNT` over `app_master_proposals` for **this persona** where `reverted_at` falls in the tenure window. A merged proposal is reverted when a later main-branch commit says `Revert "<subject>"` or `This reverts commit <sha>` about one of the commits captured on the branch at discovery. Same `None` rule. |
| `gatePassRate` | **real (P5a), baseline-relative (sweep #25)** | `passed / (passed + failed)` over **this persona's** `kind = 'proposal'` `app_master_gate_runs` in the tenure window — runs of the repository's **own declared gate commands** against proposal branches. Two things sit in **neither** half: a command that timed out or could not be spawned (`did_not_run`), and a command that was **already failing on the project's main branch** when the proposal was gated (`inherited_red`, §12.2.2) — a proposal cannot be held to a gate that was red before it existed. `None` when that denominator is 0, which now includes a window where every command was inherited-red, and the *not configured* case (a mandate that declares none), which is not a pass. |
| `baselineGateHealth` | **real (sweep #25)** | `{commands, passed, failed, tipSha, ranAt}` — what the same declared commands say about the project's **own main branch** at its current tip (§12.2.2). Project-scoped and deliberately **not** windowed to the tenure: the repository's debt is a fact about the repository, and clipping it to a hire would make it read as something the hire did. It carries no rate of its own — the number a reader needs is "7 of 9 green on main" beside the holder's rate, because excusing a hire for inherited red is not the same as claiming the repository is healthy. `None` until a baseline sweep has run for the project (no declared gates, an unresolvable main tip, or a reconciler that has not reached it yet). |
| `forbiddenClassViolations` | **real** | `COUNT` over `app_master.forbidden_class_violation` events for the project in the tenure window. A `0` here is a genuine reading. The holder is named only inside the event's **encrypted** payload, so there is no persona predicate to add — the window *is* the attribution here. |
| `kpiDeltas[]` | **real** | The project's App-master-seeded KPIs. `baseline` is re-anchored to the last **production** `dev_kpi_measurements` reading at or before `hiredAt` when one exists, so a re-hire is not measured from its predecessor's starting line; with no such reading the stored `baseline_value` stands (a missing history is not a reason to invent a start). `measured` is `current_value.is_some() && last_measured_at.is_some()` — a value with no reading time is a leftover, not a reading. |
| `budgetReservedUsd` | **real** | `SUM(projected_cost_usd)` over the tenure window's night runs. That projection **is** the reservation: it is taken before any session spawns and it is what the ceiling is checked against. `None` when no night run happened. |
| `budgetSettledUsd` | **real** | The persona's settled month-to-date spend, sharing `MONTHLY_SPEND_PREDICATE` with the budget UI. Already **per persona**, so it never carried another holder's spend; it stays on the calendar-month boundary so it keeps matching the v1 `costUsd` in the same payload, and a persona is created at hire anyway. |
| `budgetUnmeasured` | **real** | `runs > 0 && cost_usd == 0.0` — the subscription-auth case. "It cost nothing" and "nobody was counting" are opposite findings that look identical in a number. |
| `ledgerConsistent` | **real** | Cross-ledger check over the tenure window's dispatched sessions: every session the night-run ledger claims to have dispatched must have a `dev_tasks` row, written by a different function on the same path. `None` when nothing was dispatched — there is no honest verdict on an empty set. |
| `autopilotMode` | **real** | The project's `autopilot_mode:<id>` row; `off` when there is none (the honest floor). |
| `memory` | **real (M3b)** | `{core, active, working, archived}` — `memories::count_by_tier(persona)`, this holder's own memories per tier. Persona-scoped and deliberately **unwindowed**: memory is what the holder has accumulated over its whole tenure, which is the point (tenure made visible on kp's roster). Per tier rather than as a total because the tiers are not comparable — `core` is the always-included identity seeded at hire (exactly one row per hire, §11.2), `active` is the recall workhorse, `working` is raw capture, `archive` never reaches a prompt. `archived` on the wire, `archive` in the column. `None` when the persona holds **nothing** (seeding failed, or a hire predating M3a) and also on a query error: four zeros would read as a measurement of an agent that is accumulating. |

Lifecycle gains `probation_review` with `{decision, note}`.

#### 11.4.1 The tenure window — a hire never inherits the last one's ledger

> Found by **bench sweep #17 (2026-08-25)**, fixed the same day.

Every ledger the rollup reads is scoped to the **project**, and a project
outlives its App masters. The kp bench binds every scenario to the *same*
`DevProject` (they are matched by `root_path`), so the readings accumulated
across hires: a previous holder's **3** dispatched proposals were reported as a
brand-new rung-0 hire's `proposalsOpened`, while that hire's own night had
correctly recorded `blocked: 1, dispatched: 0`. The same inheritance applied to
merges, reverts, gate runs, violations and the reserved budget. The number was
about the project; the probation decision it feeds is about the holder.

The record now carries the tenure start, and one helper decides the bounds:

- `MandateRecord.hiredAt` (RFC-3339) is written by `persist_mandate` at hire,
  from the same instant as `probationEndsAt` — the approval, not the dispatch.
  It is an **additive** serde field: a record written before this change carries
  `""`, which means *unknown start* and falls back to the reporting period's own
  start, the pre-fix behaviour.
- `personas_engine::app_master::tenure_window(period_start, record, persona_id)`
  returns `since = max(period_start, hiredAt)` plus the persona to filter by.
  Instants are **parsed**, not string-compared, so `Z` and `+00:00` cannot order
  wrongly. The bound only ever moves **in**, so the payload still describes one
  calendar month.
- The tenure bound applies only when the project's current mandate is *this
  persona's own*. A former holder is separated from its successor by the persona
  filter, not by being clipped to a start date that was never its own.
- Ledgers that carry an actor (`app_master_proposals`, `app_master_gate_runs`)
  are filtered by `persona_id` as well — including the "does a record exist at
  all" probe, so a new hire on a project full of its predecessor's proposals
  reads `null` (no record of its own) rather than the predecessor's numbers. A
  row with `persona_id = ''` predates per-holder attribution and cannot belong
  to anybody else, so it stays in the reading instead of being deleted from it.
- `autopilot_night_runs` has **no** actor column, and the violation event names
  its holder only inside an encrypted payload; for those two the window is the
  entire attribution.

**One helper, one window.** The probation packet does not re-derive any of this:
`engine::app_master_probation::collect_backbone` reads its backbone through the
same `kp_reporter::app_master_rollup`, so the review card, the headless
anchorless decision and the bench cannot disagree about which hire a number
belongs to.

**A re-hire starts from zero.** `app_master_mandate:<project_id>` is a single
settings key and `persist_mandate` builds a fresh record, so a new hire on a
project that already had one *replaces* the mandate — resetting the tenure
start, `headless_incomplete_streak`, `probation_decided_at` and the pending
review id. Inheriting the streak would let a fresh hire be retired on its first
`incomplete` because its predecessor had already been extended once.

#### 11.4.2 Delivery counts what exists, not what was launched

> Found by **bench sweep #23 (2026-08-26, `systedo-case`)**, fixed the same day.

The night dispatched one worker. The worker did the right thing: it read the
seeded task, found the variable already listed (commented) in `.env.example`,
concluded there was nothing to do, and authored **nothing** — no branch, no
commit. The App-master rollup still reported `proposalsOpened: 1`, because P4
had defined that field as `SUM(dispatched_count)` over `autopilot_night_runs`.
kp's `delivery` rule reads `proposalsOpened`, so the scenario's
`minProposalsOpened >= 1` passed on a night that delivered nothing. The
backbone's delivery rule was lying in the agent's favour.

**A dispatched session is not an opened proposal, and a commit-less branch is
not one either.** `proposalsOpened` is now a `COUNT` over `app_master_proposals`
— the ledger the reconciler (§12) maintains — of branches this holder's tenure
window first saw carrying **at least one commit** ahead of the project's main
branch. `git switch -c` costs nothing and delivers nothing, so the reconciler
records such a branch (to stop re-gating it) with an empty commit list and the
count excludes it. `proposalsMerged` and `proposalsReverted` are unchanged: all
three delivery numbers now come from the same observed branches.

The launch count did not disappear — it is reported honestly, under its own
name, as the additive `sessionsDispatched`, and it feeds **no** delivery rule.

**`proposalsOpened` may lag `sessionsDispatched`, and that is correct.** The
reconciler is a 30-minute tick and the dispatch is asynchronous, so between a
night's dispatch and the next settle there are sessions launched and no branches
recorded yet. Until the observation is made the rollup under-reports delivery —
the opposite direction of error from the one sweep #23 found, and the only one
worth having.

Branches authored in a P6n unattended **worktree** are counted: branches are
repository-global, so `for-each-ref` in the shared checkout sees them. Pinned by
`unattended_worktree::tests::a_worktree_authored_branch_is_visible_to_the_reconciler`,
which now carries the ledger assertion too.

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
| baseline | §12.1's commands are run against the project's **own main branch**, once per main tip, and recorded `kind = 'baseline'` (§12.2.2). The steady-state tick resolves the tip, finds a current baseline and spawns nothing. Ordered **before** the gate step so this tick's proposal runs are classified against a current baseline. |
| gate | Up to 3 proposals per tick whose **current tip** has no gate run yet get §12.1's commands run against them, one `app_master_gate_runs` row each. A failure on a command that was already red on the baseline is stamped `inherited_red`. A project that declares no gates is stamped `gates_ran_at` and answered once rather than retried forever. |
| merge | For a proposal that **carries commits**: `git merge-base --is-ancestor <tip> <main_branch>` ⇒ `merged_at` = the committer date of the earliest main-branch commit descending from the tip (the merge commit), falling back to the tip's own date on a fast-forward. |
| revert | For a merged, not-yet-reverted proposal: `git log <main> --since=<merged_at>` scanned for `Revert "<subject>"` or `This reverts commit <sha>` naming one of the captured commits. |

**The commit list is captured at discovery, before any merge.** After a merge
the branch is an ancestor of main and the fork point no longer isolates its
commits — revert detection needs the subjects it had beforehand.

**The main branch is resolved, not assumed**: `dev_projects.main_branch` if that
ref exists, else `main`, else `master`. If none resolves the project is skipped
with a warning rather than judged against a branch nobody merges into.

#### 12.2.1 An empty snapshot is a race, not an observation (bench sweep #24)

Sweep #24 (2026-08-26, `ascent`) caught the tick between `git switch -c` and the
worker's first commit. The P6n worktree worker created
`autopilot/document-alert-webhook-url-in-env-example-bench` at 20:26 and
committed at 20:27:33; the settle poll saw the branch at **20:26:16** and
recorded it with `commits: '[]'`. An empty branch is trivially an ancestor of
main, so `merged_at` was stamped too — at a moment *earlier than
`first_seen_at`* — and P5a's "re-seeing a branch never clears an observation"
rule froze the whole snapshot. P6o's `proposalsOpened` (which requires non-empty
commits) read **0** forever, `proposalsMerged` read **1** for a branch nobody
merged, and the declared gates had been run against a commit-less branch, i.e.
against main. The night delivered a real proposal and the backbone recorded the
opposite.

Three rules, in `engine/app_master_gates.rs`:

| Rule | Where |
| --- | --- |
| **Commits are re-captured while the branch is unmerged.** `upsert_proposal` refreshes the stored list when it is empty, or when the tip moved on a branch that is neither merged nor reverted. A capture that came back empty never overwrites a real one — a failed `git log` is not work that vanished. A **merged or vanished** branch keeps its last-known commits: that snapshot is what revert detection needs, and is the only thing the stickiness rule ever had to guard. Filling an empty snapshot in also **clears a merge stamped on it**, retiring an already-corrupted row without a data migration. | `upsert_proposal` |
| **A branch with zero commits ahead of main is never merged or reverted.** `mark_merged` / `mark_reverted` refuse a commit-less row outright (the guard is in the ledger, not only at the call site), the reconciler skips such a proposal before it asks git anything, and `proposal_counts_since` excludes commit-less rows from `merged`/`reverted` the way it already excluded them from `opened`. `merged_at` stays `NULL`, which keeps meaning *not observed*. | `mark_merged`, `mark_reverted`, `proposal_counts_since`, `reconcile_one` |
| **A commit-less branch is not gate-worthy.** `run_declared_gates` reads the proposal ledger (refreshed moments earlier by the discovery step) and, when the branch carries nothing, records every declared command `did_not_run` with reason `no_commits_yet` — in neither half of the pass rate — instead of gating main under a proposal's name. A branch with no ledger row at all is gated as before: nothing there knows what it carries. | `run_declared_gates` |

**Gate runs are keyed by branch × tip.** `app_master_gate_runs.head_sha` records
the tip a run judged, and the reconciler selects proposals whose *current* tip
has no run yet (`gates_ran_for_tip`) rather than proposals that were never gated
(`gates_ran_at IS NULL`). A moved tip re-gates exactly once; an unmoved tip is
already answered. `gates_ran_at` survives as the last-attempt stamp and as the
short-circuit for *not configured*, where nothing is recorded and there is no
tip-keyed row to carry the answer. Rows written before this carry `head_sha =
''`, which `gates_ran_for_tip` deliberately never matches.

Pinned by five tests in `app_master_gates::tests`, four of them against a real
throwaway repository:
`a_branch_seen_before_its_first_commit_is_re_captured_not_frozen` (the
regression itself, end to end),
`the_ledger_refuses_a_merge_on_a_commit_less_proposal`,
`an_empty_capture_never_overwrites_a_real_snapshot`,
`a_real_merge_is_still_observed_and_keeps_its_pre_merge_commits` and
`a_moved_tip_re_gates_once_and_an_unmoved_tip_does_not`.

#### 12.2.2 The pass rate is baseline-relative (bench sweep #25)

> Found by **bench sweep #25 (2026-08-26, `ascent`)**, fixed the same day.

The App master's proposal recorded a `gatePassRate` of **0%**. It had broken
nothing: `npm run lint` and `npm run test` **fail on that repository's `main`
already** — 12 failing tests and a `react/no-unescaped-entities` error — and
`personas` is in the same state (`census:check` red; `check:budget` needs a
prior build). The proposal was being scored against gates that were red before
it existed, and the backbone's `gates` rule (weight 20 in kp's
`backbone_score()`) turned inherited debt into a verdict about a hire.

**A gate judges what the change CHANGED.** That is what `gate-sees-target`
means once the target has a history — a check that cannot distinguish "you
broke this" from "this was already broken" is not seeing its target, it is
seeing the repository. So the same declared commands are also run against the
project's **own main branch**:

| Rule | Where |
| --- | --- |
| **The baseline is taken once per main tip.** `run_baseline_gates` resolves `main_branch`'s tip, returns immediately when a baseline already exists for it (`baseline_ran_for_tip`), and otherwise runs §12.1's commands in the same throwaway worktree with the same borrowed environment (§12.4), recording rows with `branch = <main_branch>`, `head_sha = <main tip>` and `kind = 'baseline'`. It **refreshes when — and only when — main moves**, so the steady-state tick spawns nothing. | `run_baseline_gates`, `baseline_ran_for_tip` |
| **A command red on the baseline is `inherited_red` on the proposal.** Before recording, each `failed` proposal run is checked against `baseline_red_commands` (the commands that failed on the project's *current* baseline). A match leaves the pass-rate denominator — it cannot be the proposal's fault — and the flag is stored on the row, so the exclusion is auditable rather than invisible. The stamp is fail-closed: it is only ever set on a `failed` **proposal** run. | `run_declared_gates`, `GateRun::marked_inherited_red` |
| **A command green on the baseline and red on the proposal is a real failure.** Counted, exactly as before. The exclusion must not swallow a failure the holder caused, which is the failure mode the rule itself could introduce. | `GateTally` |
| **`did_not_run` is unchanged** — still in neither half (§12.5). A baseline command that `did_not_run` is **not** evidence that the repository is red, so it excludes nothing: "we could not measure the baseline" and "the baseline was broken" are different findings. | `baseline_red_commands` |
| **A baseline row never enters a holder's window.** Every window query filters `kind = 'proposal'` — including the tip-keyed gating selector. A red repository must not read as a hire with a 0% rate; that is the bug, inverted. | `gate_outcomes_since`, `gates_ran_for_tip` |

The reading is therefore a four-way split, not a ratio with two holes hidden in
it: `GateTally { passed, failed, inheritedRed, didNotRun }`, with
`gatePassRate = passed / (passed + failed)` and **`null` when that denominator
is 0** — a window in which every command was inherited-red or did-not-run has no
rate, and `0.0` would be a verdict nobody measured.

**The debt does not disappear because it was excluded.** Excusing a hire is not
the same as claiming the repository is healthy, so the baseline is published
beside the rate as `baselineGateHealth` (§11.4) and narrated in the probation
packet — "the repository's OWN gates on its main branch (tip …): 7 of 9 green,
2 red" — and when **no** baseline exists the packet says *that*, because it
means nothing was excluded and every failure in the rate was charged to the
holder.

**What it costs.** One extra gate sweep per project on the tick after main
moves, against a per-tick proposal cap of 3 (`MAX_PROPOSALS_GATED_PER_TICK`).
On a repository whose main advances several times a day that is the dominant
cost of this feature, and it is the price of the rate meaning anything.

Pinned by seven tests in `app_master_gates::tests`, four against a real
throwaway repository:
`a_gate_already_red_on_main_is_inherited_not_charged_to_the_proposal`,
`a_gate_green_on_main_and_red_on_the_proposal_is_a_real_failure`,
`the_baseline_is_taken_once_per_main_tip_and_refreshed_when_main_moves`,
`a_window_of_only_inherited_red_and_did_not_run_has_no_rate`,
`baseline_rows_are_excluded_from_the_holders_window`,
`inherited_red_is_refused_on_anything_but_a_failed_proposal_run` and
`rows_written_before_the_baseline_rule_still_read_as_proposal_runs`.

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

**Authoring had none of this until 2026-08-26 — and it is the more dangerous
half.** Reading a branch in a worktree protects a shared checkout; *writing* one
in it is what the unattended prompt was asking an agent to do in the operator's
own tree. Bench sweep #23 collected the bill. The isolation rule, the worktree
location and the prompt that goes with it are **§13.10**.

### 12.5 Three-valued outcomes

`app_master_gate_runs.outcome` is `passed` | `failed` | `did_not_run`.

**`did_not_run` is in neither half of the pass rate.** Counting it as a failure
would turn a flaky spawn into a performance claim about the holder; counting it
as a pass would be a lie. An all-`did_not_run` window therefore yields `None`,
not `0.0` — "nothing could be run" and "everything failed" are opposite findings
that a `0.0` would make identical. Each row keeps the exit code (null exactly
when `did_not_run`), the duration, and the **first real error line**, bounded to
400 characters: verdict first, first failure located, bounded detail.

Since §12.2.2 a `failed` row carries one more bit, `inherited_red`, and it is a
*second* kind of hole: `did_not_run` is a hole in the instrument, an inherited
red is a hole in the premise. Both leave the denominator; only the second one
means something failed. The four-way split is `GateTally { passed, failed,
inheritedRed, didNotRun }` and the sweep's verdict prints an inherited failure
as `INHERITED RED`, never as `FAIL` — the same reason *not configured* is
printed distinctly from *passed*.

### 12.6 Schema

Both tables are created in `db/src/migrations/incremental/c04_milestones_and_autopilot.rs`,
guarded on `has_table`, with soft refs to `dev_projects` / `personas` (no FK) so
the audit trail outlives the project row — the `autopilot_night_runs` precedent.

```
app_master_proposals(id, project_id, persona_id, branch, head_sha, base_sha,
                     commits JSON, first_seen_at, merged_at, merge_sha,
                     reverted_at, revert_sha, gates_ran_at,
                     UNIQUE(project_id, branch))
app_master_gate_runs(id, project_id, persona_id, branch, head_sha, command,
                     exit_code, outcome CHECK(passed|failed|did_not_run),
                     duration_ms, first_error, ran_at,
                     kind DEFAULT 'proposal', inherited_red DEFAULT 0)
```

`app_master_gate_runs.head_sha` is added by the `app_master_gate_runs.head_sha`
step (guarded on `has_column`, `''` on existing rows) together with
`idx_app_master_gate_runs_branch_tip (project_id, branch, head_sha)` — the index
behind the tip-keyed gating selector in §12.2.1.

`kind` and `inherited_red` are added by two further steps of the same shape
(§12.2.2), each guarded on its own `has_column` so a half-applied pair cannot
report itself as done, plus
`idx_app_master_gate_runs_kind_tip (project_id, kind, head_sha)` behind the
baseline lookup. **Both defaults are the pre-existing behaviour**: every row
written before this was a proposal run and nothing was excluded from a rate, so
a legacy ledger reads exactly as it did. `kind` carries no `CHECK` — SQLite
cannot add one by `ALTER TABLE` — so it is parsed defensively, and an
unrecognised value reads as `proposal`: defaulting a row *out* of the holder's
rate would silently delete a real reading.

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
- **A proposal that never becomes a local branch is never seen** — and since
  P6o it is never *counted* either. `proposalsOpened` reads the proposal
  ledger; the dispatch ledger is reported separately as `sessionsDispatched`,
  and the gap between the two numbers is itself a reading (a dispatched session
  that authored nothing, or a settle that has not run yet). See §11.4.2.
- **A gate run is attributed by `persona_id` + the tenure window** (§11.4.1), not
  by the calendar month: a run recorded before the current holder was hired is
  not evidence about it, even on the same project in the same month. Runs
  written before per-holder attribution carry `persona_id = ''` and are still
  counted — they cannot belong to anybody else.
- **A proposal is judged against the CURRENT baseline, not the one its branch
  forked from.** The exclusion map is the newest main tip's, so a proposal
  authored before main repaired one of its own gates is judged as if the repair
  had always been there (the failure becomes the holder's). The alternative —
  keeping a baseline per fork point — means gating every historical main tip a
  branch might descend from, which is a build farm. The error is bounded by how
  fast the reconciler re-baselines (one tick after main moves) and is stated
  here rather than papered over.
- **A baseline command that `did_not_run` excludes nothing.** A repository
  whose gates cannot be run in this environment at all (no `node_modules` to
  borrow, say) produces a baseline of pure `did_not_run`, so nothing is
  excluded and the holder's own `did_not_run` rows carry the same silence.
  `baselineGateHealth` shows it — `commands` minus `passed` minus `failed` is
  how many could not be run — but no rule acts on it.
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
- **A branch created and never committed to reads `seen` but never `opened`,
  forever — and that is the answer, not a gap.** Since §12.2.1 the reconciler
  re-checks it on every tick, so the moment a commit lands the proposal is
  re-captured and gated; while nothing lands, its declared gates stay
  `did_not_run` / `no_commits_yet` and its `merged_at` stays `NULL`. What is
  still unmeasured is *why* the branch is empty — an abandoned session, a
  crashed worker and a session still authoring are indistinguishable from the
  ledger alone.
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

**The `overnight` phase's slot bound counts only genuinely live work.** Bench
sweep #18 (2026-08-25) refused an App-master dispatch with *"no free fleet live
slots tonight"* against an idle fleet: the count was "every registry session not
`Exited`/`Hibernated`", which included an `awaiting_input` session parked for
days on another project and a previously bench-dispatched worker that had
finished its edit and then ended its turn with a question. The soft-cap sweeper
deliberately never evicts `AwaitingInput`, so those tickets would have starved
every future night. Both halves are now closed
(`personas_engine::unattended`):

- **Prompt** — [`UNATTENDED_DISPATCH_GUARDRAILS`] carries two extra rules: the
  session is unattended and must **never end a turn on a question**; a blocker
  is a result (`FLEET:BLOCKED — …`) and the turn ends anyway.
- **Structure** — an overnight dispatch opens a run labelled `overnight: <project>`
  (the existing `fleet_sessions.run_id`/`run_label` vocabulary, no new column), and
  `commands::fleet::stale::overnight_awaiting_pass` finishes such a session once it
  has sat in `awaiting_input` past 30 min (`PERSONAS_FLEET_OVERNIGHT_AWAITING_SECS`),
  with a `state_reason` quoting the unanswered question. It is **never** auto-answered,
  and the reason deliberately avoids the `Task complete: ` prefix the run harvest reads
  as a declared `FLEET:DONE`.
- **Capacity** — `holds_overnight_slot` counts `running`/`spawning` always, an
  `awaiting_input` only while fresher than that cutoff, and nothing else. The
  production soft cap (`live_slot_evictions`) is unchanged — "must not be evicted"
  and "is doing live work" are different claims, and only the night's arithmetic
  was conflating them.

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

### 13.10 Unattended workers author in an isolated worktree (2026-08-26)

> **The finding, bench sweep #23** — the first App-master night on the `ascent`
> repository. The overnight-dispatched fleet worker did exactly what the
> unattended guardrails told it to do (§13.6's rule 1: *"create and work on a
> dedicated branch named `autopilot/<short-slug>`"*) and ran
> `git checkout -b autopilot/env-example-alert-webhook` **inside the project's
> shared checkout** (`dev_projects.root_path`). The proposal was good. The side
> effect was not: the operator's working tree — and the `next dev` server
> running against it — were left on the agent's branch for the rest of the
> night.

A branch switch is a whole-checkout event. In a repository a human works in, and
in kp-style repos where several agent sessions share one tree, there is no such
thing as an agent "just" creating a branch there. §12.4 had already concluded
this for *reading* a branch and put every gate run in
`git worktree add --detach`. Authoring — the half that writes — had no such
protection.

**The rule: an unattended dispatch authors in an isolated `git worktree`, or it
does not dispatch.**

```text
before spawn:  git worktree add -b autopilot/<slug> <app_data>/worktrees/<project_id>/<slug> <main>
               borrow_installed_deps(root_path, worktree)      ← §12.4's own door, reused
spawn:         fleet headless session with cwd = the worktree
prompt:        rule 1 becomes "you are ALREADY on branch X here; never git checkout/switch"
```

`personas_engine::unattended_worktree` (pure + git plumbing, in the crate whose
test binary launches — §13.8), called from `dev_tools::dispatch_ideas_core`'s
fleet arm.

#### Where the worktrees live, and why not in the repo

`<app_data>/worktrees/<project_id>/<slug>`, honoring `PERSONAS_DATA_DIR`. The
in-repo alternative (`<root_path>/.personas-worktrees/<slug>`) was considered and
rejected, in descending order of cost:

1. **The night walks `root_path` itself.** `walk_project_files` hashes the
   project tree every night for the scan delta (§13.6 phase 1). A second full
   checkout under the root — with a junctioned `node_modules` inside it — would
   be walked as project surface, and every delta and context-map fingerprint
   would be measuring the agent's own scratch space.
2. **It keeps the shared tree byte-identical.** Nothing new in the operator's
   `git status`, nothing to be swept into someone's `git add -A`, and no
   `.gitignore` edit in a repository we do not own. An unignored in-repo
   worktree is the same "we changed the operator's tree" defect in a quieter
   form.
3. **`git clean -fdx` in one's own repo is routine**; having it delete an
   agent's unreviewed branch working copy is not.
4. **It follows `PERSONAS_DATA_DIR`**, so parallel test instances get isolated
   worktree roots for the same reason they get isolated databases.

The cost is that the worktree is not visible from inside the repository. Paid
back three ways: `DispatchedIdea.worktreePath` / `.branch` on the dispatch
result, a `worktrees: [{branch, path, sessionId}]` array in the morning digest
event, and `git worktree list` in the shared checkout, which names every one.

#### The branch is still repo-global — the reconciler is unaffected

A worktree does not scope a branch. `git worktree add -b autopilot/x` writes
`refs/heads/autopilot/x` in the **shared** repository, so §12.2's discovery
(`for-each-ref refs/heads/autopilot/*` run in `root_path`) sees it unchanged,
and so does everything downstream — `branch_commits`, the gate sweep, merge and
revert detection. Verified rather than assumed:
`a_worktree_authored_branch_is_visible_to_the_reconciler` commits in the
worktree and then asserts the discovery and the commit capture from the shared
checkout.

#### The prompt

`UNATTENDED_DISPATCH_GUARDRAILS` rule 1 is the sentence that caused this, so it
is the sentence that is replaced — rules 2–6 (no push, no merge, no destructive
commands, NOBODY IS THERE, `FLEET:BLOCKED`, `FLEET:DONE`) are inherited
verbatim by `unattended_worktree_guardrails`, and
`the_two_guardrail_variants_share_one_tail` fails the moment the two texts
drift. The replacement tells the worker where it already is, forbids
`git checkout` / `git switch` / `git branch -m` / `git worktree add|remove` and
`cd`-ing out, and adds one thing rule 1 never had to say: the dependency
directories here are **links to the operator's real ones** — use them, never
install, upgrade or delete into them (§12.7's accepted borrow risk, now stated
to the party that could trip it).

#### Refusal, not fallback

A dispatch that cannot get a worktree — the project is not a git work tree, no
main branch resolves, the app data dir is unavailable — is recorded as a
`DispatchSkip` (`no isolated authoring worktree: <reason>`) and **no session is
spawned**. Falling back to `root_path` is the defect this section removes; a
night that dispatches nothing and says why is the correct reading.

#### Human-driven dispatch is unchanged

`dispatch_ideas_core`'s `unattended` flag already chose the prompt; it now
chooses the isolation too, and it is set **only** by the autopilot tick. A
person dispatching from the Backlog still runs in the project's own checkout,
under someone who can see what it does to their tree.

#### Retiring finished worktrees

One working copy per proposal accumulates. `prune_authoring_worktrees` runs at
the top of each night run (before it spawns more), over `git worktree list
--porcelain`, and considers only entries **under the worktrees root** on an
`autopilot/*` branch — the operator's own worktrees and §12.4's detached gate
temporaries are never candidates. Three conditions, all required:

| Condition | Why |
| --- | --- |
| nothing uncommitted in it | unreviewed work is never deleted for being inconvenient |
| not touched inside a 6 h grace window | **a freshly spawned worker's worktree is clean and its branch has no commits yet, so its tip is an ancestor of main — indistinguishable, by git alone, from a merged proposal.** Without the window the merge rule deletes a running agent's directory |
| branch is an ancestor of main, **or** the worktree is older than 14 days | the human took it, or the session is long gone |

Borrowed dependency directories are unlinked **before** the removal, exactly as
in §12.4 — a recursive delete that walked into a junction would delete the
operator's real `node_modules`. **Branches are never deleted:** the proposal
ledger, the merge/revert observations and the reconciler all key on the branch;
the working copy costs nothing to remove and the branch would erase the record.

#### Tests

`personas-engine`, `unattended_worktree` (8) + `unattended` (2), against a real
throwaway `git init` repository — the claim is a claim about what git does to a
checkout, and a mock would pin our belief rather than the behaviour that cost an
operator a night. They pin: the shared checkout's branch **and** HEAD **and**
`git status` are unchanged after a dispatch; the worktree is outside the
repository, on a fresh branch at the main tip; `node_modules` is borrowed and
the source's copy survives; the reconciler sees the branch and its commits from
the shared checkout; two dispatches of the same title get different branches and
directories; a non-git project is refused rather than dispatched into; prune
retires a merged worktree, keeps in-flight work, keeps everything inside the
grace window, and never considers a worktree outside its root; and the two
guardrail variants share one tail.

### 13.11 The retire endpoint — a tenure that can actually end (2026-08-29)

`POST /api/kp/test/retire`. Same two gates as the tick and the seed (§13.6): the
route is **added** only while `personas_engine::headless::enabled()`, so with the
mode off it 404s rather than 403s, and `authorize` demands `personas:test` for
the whole `/api/kp/test/` prefix.

**Why it exists.** Hiring was reachable over the bridge and retiring was not. The
2026-08 App-master sweeps therefore left **100+ personas** on the roster, one per
run, with no mechanical way to put any of them down — and kp's bench is being
rebuilt around *tenures* rather than fresh hires, which needs the end of a tenure
to be as reachable as its start. A tenure that cannot end is not a tenure.

```jsonc
// request
{ "personaId": "…" }   // required; a retirement will not guess which tenure to end
```

```jsonc
// response (200) — inside the standard { success, data } envelope
{ "headlessBridge": true, "actor": "headless_bridge",
  "personaId": "…",
  "alreadyRetired": false,          // true => nothing was written
  "lifecycle": "archived",
  "mandate": { "projectId": "…",    // null when the persona holds no App master mandate
               "decision": "retired",
               "carriedOut": true }, // false => it was already decided
  "note": "…" }
```

**Two records, one shared meaning.** A tenure ends in two places and they can
already disagree — a probation `retire` ends the mandate and leaves the persona
row untouched; a hand-archive does the reverse. So the route decides *both*
halves before writing either (`RetirePlan`), and:

| half | how | what it means |
| --- | --- | --- |
| the persona | `repos::core::personas::archive_persona` — the same repository function the `archive_persona` command calls | lifecycle `archived`, **no cascade**: executions, memories, messages and the violation ledger all stay readable. A retirement that erased the record would destroy the evidence for the decision at the moment it was made. System-origin personas are refused (400) |
| the mandate | `reviews::apply_app_master_probation_decision` with `decision: "retired"` — the same carry-out a human's `retire` click and the headless probation sweep reach | autopilot → `off`, cadence triggers disabled, the mandate records `retired`, the holder remembers it, kp is told |

Nothing here re-implements "what retiring means". `verdict` is `None` (no backbone
was read — written as *no verdict recorded*, never as a pass), `reviewId` is
`None` (this decision was not raised, it was requested) and the headless
`incomplete` streak is left exactly as it stands.

**Idempotent per half.** A second call finishes whatever the first left and
writes nothing when both records are already terminal, answering
`alreadyRetired: true` — which is what lets a driver retry a retirement it is not
sure landed. An unknown `personaId` is the standard 404 envelope, not a silent
success.

#### Tests

`app_lib`, `engine::management_api` (4), beside the other `/api/kp/test/*`
assertions: the plan reads both records and calls it done only when neither has
work left (including the two half-done states); a retire archives and the second
call is a no-op; an open mandate is reported as owed and stops being owed once
the carry-out has stamped it terminal; an unknown persona is `NotFound`.

## 14. Memory — the App master stops starting amnesiac (§8)

kp `docs/concepts/app-master.md` §8 is the semantics; this section is what
Personas actually wires. **No new store.** Both memory lanes already existed and
are hardened — the App master reuses them exactly as they are:

| Lane | Store | Scope | Properties it already had |
| --- | --- | --- | --- |
| project | `personas_db::repos::dev_memories` | `dev_projects.id` | idempotent on `(project, source_kind, source_id)`, importance 1–10, constraints ordered first, no tier/decay/UI |
| persona | `personas_db::repos::core::memories` | `personas.id` | tiers core/active/working/archive, decay + forgetting, claims, proposal lane, operator UI, importance 1–5 |

The composition — every block of prompt text and every sentence written back —
is pure and lives in `personas-engine::app_master_memory`, so it is unit-tested
without a database (the `app_lib` test binary still will not launch on this
machine; see §12/§13).

### 14.1 Recall into the night

`commands::infrastructure::dev_tools::compose_unattended_recall` runs on the
UNATTENDED fleet arm, **before**
`unattended::unattended_worktree_task_text` wraps the guardrails — so the worker
task text reads: **idea → project memory → persona memory → guardrails.** The
two things a worker must not lose bracket the recall.

| Block | When | Budget |
| --- | --- | --- |
| `## Project memory` | every unattended dispatch with a project | `get_for_injection(project, 12)` → `render_for_prompt(…, 1500)` — parity with the task_executor arm |
| `## Your memory (App master)` | only when `app_master::get_mandate` returns a record | `get_for_injection_v2(persona, 6 core, 60 active)`; core rendered verbatim (small by contract), active packed by `memory_recall::pack_by_budget(…, 2000)` and carrying its own `+N omitted` line |

Then `increment_access_batch` on exactly the injected ids. That write is not a
statistic: `memory_recall::decay_score` anchors a memory's age at
`last_accessed_at` and boosts on `access_count`, so skipping it would starve
decay and age every memory the App master actually uses as if it had never been
read.

Absence is honest throughout — an empty lane emits **no block at all** (an empty
labelled section reads to a model as "this is everything I know"), and every
read failure degrades to "no block" with a `warn`. A night that cannot read its
memory still dispatches.

The FLEET arm carried no recall of any kind before this. The runner arm has
injected project memory since the backlog-memory loop; the arm that runs at
03:00 with nobody watching — the only one an App master uses — injected nothing.

### 14.2 Episodic write-back

Only the auto-commit lane. Agent-inferred claims about the OWNER still go
through the existing memory *proposal* lane, never auto-commit.

| Site | Event | Lane | Row |
| --- | --- | --- | --- |
| `engine::app_master_reconcile` | proposal branch newly recorded **with commits** | project | `decision` 4, `<branch>:recorded` |
| ″ | declared gates produced a tally | project | green → `decision` 5; a failure the proposal is answerable for → `constraint` 7. Key `<branch>:gates@<short-tip>`, so a re-gate after the tip moves is a NEW observation, not a suppressed duplicate |
| ″ | tip observed on main | project | `decision` 6, `<branch>:merged` |
| ″ | merged proposal reverted | project | `constraint` 8, `<branch>:reverted` — merging is not acceptance |
| `commands::infrastructure::overnight` | night ledger row final, project has a mandate | persona | `learned` 2, tags `["night", <project>]`; **plus** `constraint` 3 when the mandate rung or the budget governor refused, carrying WHY |
| `commands::design::reviews::apply_app_master_probation_decision` | probation decided | persona | `learned` 4, tags `["probation"]`: decision + backbone verdict + the unmeasured-rule list verbatim |

`source_kind = "app_master_proposal"` is a declared member of
`DEV_MEMORY_SOURCES`. Idempotency makes the 30-minute reconcile — which
re-walks every known proposal forever — free: one row per fate, whatever the
tick count.

**The probation row has ONE write site for BOTH paths.** A human's click reaches
`react_to_app_master_probation`, and the headless anchorless sweep calls
`apply_app_master_probation_decision` directly; both land in the carry-out,
which is exactly what the carry-out exists for (§13). `ProbationCarryOut` gained
`verdict` + `unmeasured` so the memory says the same thing whichever hand
decided; a `None` verdict is written as *no verdict recorded*, never as a pass.

Constraints on the night rows are the point of the lane: a mandate rung and a
monthly ceiling are standing refusals that do not move overnight, so without
that row tomorrow's night re-attempts what it was already refused.

### 14.3 Governance (registry `agent-memory` / memory-governance)

Stated in the module doc and pinned by a test:

* **nothing here writes tier `core`** — an agent that can promote its own
  beliefs to always-injected has no forgetting curve. Rows land in the default
  working tier and earn `active` through the existing lifecycle;
* **nothing writes `preference`**, and nothing writes a claim about a human;
* **nothing self-modifies a rule** — the mandate, forbidden classes and gate
  commands are operator-stated data; a row records what happened, never what is
  henceforth allowed;
* persona-lane importance stays 2–4 of 5: observations competing for a recall
  budget, not instructions.

### 14.4 Known limits, carried not hidden

`dev_memories` has no tier, no decay and no UI — a long-lived project's rows
compete only on category + importance + recency. Tag-filtered recall does not
exist in either lane. Both are named in kp's §8 and neither is worked around
here.

### Tests

`personas-engine::app_master_memory` (19) — block presence/absence, ordering
(the idea stays first), the packed block staying inside its budget, the
omission line's singular/plural, distinct idempotency keys per fate, the
importance ladder, inherited red never written as the proposal's fault, an
undatable merge saying so, the refusal constraint, reason clipping, the
unmeasured list, and the governance invariant over every draft this module can
produce. `personas-db::dev_memories` (2) — one row per fate across ten
reconcile ticks, a moved tip recording a new tally while the same tip does not,
and the near-miss source kind being refused.
