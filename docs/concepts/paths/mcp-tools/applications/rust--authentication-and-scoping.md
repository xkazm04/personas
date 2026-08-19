---
layer: application
subject: mcp-tools
technique: authentication-and-scoping
stack: rust
---

# Authentication and scoping in the Rust backend

Two MCP surfaces, two token models — and between them most of the
technique's claims get a live witness.

## Scope reuse from the existing key registry

The stdio server (`src-tauri/src/mcp_server/auth.rs`) closes what its own
module doc calls a privilege-escalation gap "identical in blast radius to
the HTTP management API" (`auth.rs:5-13`) by validating a `pk_<hex>`
capability token against **the same `external_api_keys` registry the HTTP
surface uses** — explicitly "no parallel auth system, same hashing / expiry /
revocation semantics, same per-key audit trail" (`auth.rs:10-13`). The
required scope is deliberately the management API's own execute grant, not a
new vocabulary: `MCP_REQUIRED_SCOPE = "personas:execute"` with the rationale
in the comment — "an MCP token is a persona-execute credential, so it reuses
that grant rather than inventing a new one" (`auth.rs:31-34`). Every
`tools/call` resolves the token afresh via `find_by_token` (`auth.rs:76`),
so registry-side revocation or expiry takes effect on the next call — the
check reads the registry's current record, not a copy cached at connect
time.

Audit rides the same registry: a scope denial writes a 403 row and a success
writes a 200 row against the key id, under a synthetic `MCP` method and a
`/mcp/tools/call/<tool>` path so operators can split stdio activity from
HTTP activity in one trail (`auth.rs:91-120`). Denials name the fix — every
rejection ends with the reinstall hint (`auth.rs:51-54`).

## Handshake-open, call-authenticated — on both servers

Both dispatchers implement the exact policy split: discovery is open,
invocation is gated.

- stdio: `initialize` and `tools/list` answer without a token "so a client
  can complete the MCP handshake and render a readable auth error in its
  tool UI" (`auth.rs:17-19`); `tools/call` runs through
  `authorize_tool_call` and a denial becomes a `-32001` protocol error
  (`mcp_server/mod.rs:95-109`) — the unauthorized caller is refused on the
  machinery channel, before arguments are even read.
- companion endpoint: `initialize`, `server/discover`, and `tools/list` are
  deliberately un-gated (the comment at
  `companion/orchestration/mcp/mod.rs:244-247` says discovery "only reveals
  identity + capabilities so a modern client can negotiate before
  authenticating individual tool calls"); `tools/call` requires the
  per-session header via `require_session` (`mod.rs:257-260, 306-319`),
  with missing-header and unknown-token both refused as `-32001`.

## Per-consumer tokens with a real reaper

The companion endpoint's tokens are the technique's per-consumer issuance in
miniature: one token per spawned CLI session, minted at spawn
(`mint_session_token`, `mod.rs:92-97`), injected through the generated
client config as an HTTP header the client repeats on every call
(`commands/fleet/pty.rs:568-578` writes the per-session `mcp.json` with the
`X-Athena-Session` header; the config lives in a per-session temp subdir).
Custody is complete: every early-failure path in `build_mcp_spawn` releases
the token it just minted (`pty.rs:558`, `:583`, `:589`), and the session's
reaper task releases tokens, cancels pending blocking requests, and deletes
the config directory in one exactly-once exit path (`pty.rs:514-529`).
Revocation is surgical by construction — `release_session_tokens` drops only
that session's tokens (`mod.rs:100-103`, pinned by test at `:358-366`).

## The measured counter-examples

Two, both on the stdio side:

- **The install-time token has no reaper.** `install_mcp_config`
  (`mcp_server/install.rs:61-74`) provisions the key with no expiry argument
  and writes the plaintext into the shared client config's `env` block
  (`install.rs:76-81`), at whatever default permissions the config directory
  carries. Each re-install mints a *new* key without revoking the previous
  one, so repeated installs accumulate live never-expiring credentials in
  the registry with only the newest present in any config. This is the
  golden path's counter-evidence entry: vault-grade custody inside the
  registry, absent one step outside it. (The plaintext handling itself is
  right — returned once by `create`, "never logged, never persisted
  elsewhere", `install.rs:5-7`.)
- **One omnibus scope gates thirty-four tools.** Every tool behind the stdio
  server — persona CRUD and execution, but also mail reading, file listing,
  calendar reads, vault-connector reads through the credential bridge
  (`tools.rs:1133-1170`) — is authorized by the single `personas:execute`
  scope. The aggregation flattened authorization: a token minted so an
  editor can execute personas also reads the operator's mailbox, and the
  audit trail cannot distinguish intent tiers because there is only one
  tier. The technique's aggregator caution (per-family scope requirements)
  and its scope-minimization floor both point at the same fix; the scope
  *reuse* was right, the scope *granularity* stopped one step short.
