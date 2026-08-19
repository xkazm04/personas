---
layer: application
subject: credential-vault
technique: brokered-egress
stack: rust
---

# Brokered egress in the Rust backend

The repo's one outbound door is `execute_api_request` at
`src-tauri/src/engine/api_proxy.rs:638-996`, fronted by the authorization
kernel in `src-tauri/src/engine/credential_broker.rs`. External consumers hold
revocable `external_api_keys` handles and route every credentialed call
through the audited proxy route; the credential's plaintext exists only inside
the door (the module doc at `credential_broker.rs:1-23` states the contract,
including the honest v1 exclusion: request-signing SDKs and raw websockets
cannot be proxied and the UI says so).

## The intent contract and scope intersection

`authorize_credential_use` (`credential_broker.rs:93-116`) is the pure,
default-deny kernel: a caller key may use a credential only through an
explicit grant — broad `proxy`, exact `proxy:credential:<id>`, or
per-connector `cred:<connector>:use`. Standard-relevant details:

- **Exact match only** (`:91-92` doc): no substring, no case folding — the
  tests at `:229-243` pin that `cred-1` does not authorize `cred-10` and
  `GitHub` does not match `github`.
- **Fail-closed on corruption**: an empty scope list — including the empty
  vec that scope parsing returns for a corrupt column — authorizes nothing.
- **Which grant authorized the use is recorded** (`BrokerGrant`, `:50-68`),
  so the ledger reconstructs "who could do what, and why".

A second, finer intersection runs inside the door:
`scope_enforcement::evaluate` (`src-tauri/engine/src/scope_enforcement.rs:94-179`)
checks the request path's captured resource id against the credential's
`scoped_resources` picks — effective permission is caller-key grants ∩
credential resource pins, exactly the standard's grant∩request shape. Both
parsers fail closed: a *non-empty but unparseable* picks blob errors rather
than silently widening to broad scope (`:104-114`), and corrupt enforcement
metadata resolves to the most restrictive mode, `Block`, distinct from the
absent-metadata default `Warn` (`:49-68`, regression-pinned at `:331-339`).
Block-mode violations fail loudly *at the door* with a self-naming error
(`api_proxy.rs:757-773`).

## Destination binding by construction

The caller never names a host. It supplies a credential id, method, and
*path*; the base URL is resolved inside the door from the credential's own
fields or the connector's well-known default (`api_proxy.rs:661-693`,
`well_known_base_url` at `:479`). A confused-deputy "send this header to
attacker-host" is unrepresentable in the call shape. Around that binding:

- SSRF guards on the resolved URL and field values (`:716-725`), plus a
  DNS-rebinding-safe client that validates resolved IPs at connect time
  (`:829-838`); private-network access is a per-connector, opt-in exception
  (`connector_allows_private_network`, `:265`).
- Callers cannot smuggle their own auth: `BLOCKED_HEADERS` strips
  `authorization`/`cookie`/`host`/`proxy-authorization` from custom headers
  (`:580`, enforced at `:859-865`), and header names are validated against
  token syntax to kill smuggling/splitting (`:594-616`). Auth is applied
  exclusively by the connector strategy at the last moment (`:867`).

## Derived handles

`mint_derived_handle` (`credential_broker.rs:130-183`) issues a consumer key
scoped to exactly one credential and its connector — narrowed, linked, and
short-lived. The TTL is **clamped, never trusted** (`clamp_handle_ttl`,
`:119-123`): default 60 minutes, floor 5, hard cap 24 hours, with the comment
carrying the doctrine — "'Short-lived' is a security property, not a
suggestion; the mint path clamps, never trusts" (`:42-44`). Every handle
names its consumer (empty consumer names are refused, `:136-141`), the
handle plaintext is returned once, and every mint writes an audit row against
the parent credential (`:165-174`) so the ledger enumerates which consumer
identities exist.

## Audit at the door, availability preserved

Every proxied use writes `audit_log::log_decrypt` (`api_proxy.rs:649-658`) —
and a failed audit write does **not** block the call; it is *counted* instead:
`CREDENTIAL_AUDIT_WRITE_FAILURES` (`src-tauri/core/src/crypto.rs:183-202`)
is surfaced on `vault_status` and rendered by the vault trust badge, making
the trail's gap a visible number rather than a silent hole. The door is also
the seat of consumption governance: per-credential token-bucket rate limiting
(`check_rate_limit`, `api_proxy.rs:777`) and per-credential latency/error
metrics (`:344-435`).

## Response hygiene

Outbound errors are scrubbed of secret-bearing URLs — `reqwest` errors would
otherwise print the full URL, and dynamic bases can embed a token in the path;
both send sites map through `.without_url()` with a comment naming the leak
(`api_proxy.rs:885-889`, `:919-922`). Response bodies are capped at 2MB and
read in bounded chunks (`:954-955`).

## The measured counter-example

`docs/concepts/golden-paths/credential-injection-into-child.md` audited the
same system's *child-process* boundary and found the standard's two default
leaks live: the management-server key sat in the parent's process environment
and 127 of 129 spawn sites handed it to children, and broker-token files in
the temp directory inherited ACLs granting other local accounts access while
`master.key` and the vault store were owner-only — plus a lane-cleanup task
that had created 6 credential-bearing directories and removed 0. The door
itself is sound; the spills happened where plaintext escaped the door's
custody, which is exactly the boundary the technique's "escape routes" section
exists for.
