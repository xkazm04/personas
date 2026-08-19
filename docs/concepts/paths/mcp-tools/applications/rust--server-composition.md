---
layer: application
subject: mcp-tools
technique: server-composition
stack: rust
---

# Server composition in the Rust backend

The repo runs **two** MCP servers, and together they bracket the technique:
the in-app companion endpoint (`src-tauri/src/companion/orchestration/mcp/`)
is the clean spine, and the standalone stdio binary
(`src-tauri/src/mcp_server/`) shows what drifts when the registry is not
singular.

## The single-endpoint dispatcher

The companion endpoint is one POST route speaking JSON-RPC 2.0
(`mcp/mod.rs:116-121`, mounted as `/mcp/rpc`), with one `dispatch` function
(`mod.rs:230-269`) as the door: `initialize` and `server/discover` answered
openly, `tools/list` projected from `handlers::tool_descriptors()`,
`tools/call` gated by `require_session` before any handler runs
(`mod.rs:257-260`), and everything else refused with a proper
method-not-found protocol error (`mod.rs:264-268`). Standard JSON-RPC codes
live in one module (`mod.rs:168-176`); results are shaped by one
`text_result` envelope helper (`mod.rs:330-337`). The module doc states the
transport subset honestly: POST-only streamable HTTP, no SSE, "we don't
currently push server→client notifications, so the simpler request/response
transport is enough" (`mod.rs:14-19`) — and the advertised capabilities
match (`"tools": {}`, no `listChanged` claim).

## Dual-era discovery with cache terms

Both servers were reconciled to the 2026-07-28 architecture the same way:
the legacy `initialize` handshake still answers (protocol version
`2024-11-05`), and `server/discover` sits beside it returning
`resultType: "complete"`, `supportedVersions: ["2026-07-28", …]`, server
identity under the `_meta` namespaced key, and explicit cache terms
(`mod.rs:287-304`; stdio twin at `mcp_server/mod.rs:66-84`). The migration
was cheap for exactly the reason the technique's transport sibling predicts:
neither dispatcher ever gated requests on a completed handshake
(`mcp_server/mod.rs:9-12` says so in the module doc), so serving both eras
is just answering both entry points. The cache terms differ deliberately —
the stdio server's tool list depends on database state, so it advertises a
60-second window (`mcp_server/mod.rs:87-93`) while the companion's
build-static descriptors advertise an hour (`mod.rs:250-255`): the server
setting freshness terms per listing volatility, exactly as the technique
prescribes.

## Pending-request correlation, all invariants present

The blocking tools (`request_guidance`, `request_approval`) pause a spawned
CLI session on an HTTP response until a human answers in the app — a
cross-runtime completion problem solved by the pending hub
(`mcp/pending.rs`):

- **Minted ids, never reused**: `mcpreq_<uuid>` per submission
  (`pending.rs:88`).
- **Registry-side expiry**: `sweep_expired` fails overdue entries with an
  explicit `"request expired"` error (`pending.rs:157-170`), run on each
  submit.
- **Waiter-side clock**: the handler awaits the oneshot under its own
  `tokio::time::timeout(REQUEST_TTL, rx)` (`handlers.rs:272`, `:345`), with
  the comment at `handlers.rs:268-271` naming why — the sweep only runs on
  the *next* submission, so without the waiter-side timeout a blocked call
  could outwait its own TTL. This is the technique's "registry-side sweeping
  and waiter-side clocks are both required" measured in the wild.
- **Teardown fails all pending**: session exit calls `cancel_for_session`,
  which resolves every entry for that session with `"session exited before
  request resolved"` (`pending.rs:132-145`), wired into the same reaper task
  that releases the session's tokens and deletes its config file
  (`commands/fleet/pty.rs:514-529`) — one exit path, three cleanups, coupled
  on purpose (the comment at `pty.rs:517-521` says "these all need to happen
  exactly once per session").

A declined approval comes back as an in-band result with
`"isError": !approved` (`handlers.rs:364`) — a domain outcome the model can
read and adapt to, not a dead connection.

## The measured counter-example: two authorities in the stdio catalog

The stdio server has no registry. Its catalog is a hand-built array of ~34
descriptor literals in `list_tools` (`mcp_server/tools.rs:722` onward) and a
separate hand-maintained `match` over tool names in `call_tool`
(`tools.rs:1133-1170`) — the exact "listing array in one place, switch
statement in another" degenerate the technique names. Nothing but review
discipline keeps the two aligned, and the seams show:

- an unknown tool falls through the match to
  `Err(format!("Unknown tool: {name}"))` (`tools.rs:1169`) and is returned as
  an **in-band `isError: true` result** (`tools.rs:1172-1181`) rather than a
  protocol error — "you called a tool that does not exist" is delivered on
  the channel reserved for domain outcomes, indistinguishable in kind from
  "the search found nothing usable";
- no door-level schema validation exists: each handler re-parses its own
  arguments by hand (`ok_or("name is required")`, e.g.
  `tools.rs:1186-1196`), so the published `inputSchema` and the enforced
  parsing are two artifacts maintained in different places — the drift the
  one-registry shape exists to make impossible.

The companion endpoint, at four tools, keeps descriptors and dispatch in one
module (`handlers.rs:18-101` beside `call_tool` at `:105`) with a test
pinning that every descriptor carries name/description/object-schema
(`handlers.rs:407-414`) — small enough that the dual-authority tax is low,
but the stdio server at 34 tools is past the size where the technique says
the registry must be the single source both surfaces project from.
