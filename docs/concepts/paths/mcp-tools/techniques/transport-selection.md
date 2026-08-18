---
layer: technique
subject: mcp-tools
technique: transport-selection
status: forged
laws: [gate-sees-target, creation-names-reaper]
shared_with: []
---

# Transport selection

The protocol defines one data layer (JSON-RPC messages) over two transports,
and the choice between them is an identity-and-exposure decision wearing a
performance costume. Pick by answering two questions: **who establishes the
caller's identity**, and **who can reach the endpoint at all**. Everything
else — latency, streaming, reconnects — follows.

## Standard streams: identity by parenthood

A standard-stream server is a child process. The client spawns it, owns its
stdin/stdout pair exclusively, and kills it when done. The properties that
matter:

- **Identity is established by the spawn.** Exactly one client can talk to
  this server — the one holding the pipe. There is no "who is calling"
  question on the wire, because the answer was fixed at process creation.
  Authentication effort spent here is usually misdirected; the real security
  event happened earlier, when a configuration file told the host *what
  command to execute*. That is code execution by configuration, and the
  consent obligations live there (see
  [client-integration](client-integration.md)).
- **Reach is one machine, one parent.** No network listener exists, so the
  web-facing threat catalog — origin spoofing, rebinding, drive-by callers —
  simply does not apply. This is the strongest isolation the protocol offers
  and the right default for anything touching local files, local databases,
  or the user's machine generally.
- **The output channel is sacred.** The protocol owns stdout; diagnostics
  belong on stderr. A stray print statement into the framed channel corrupts
  the conversation — the classic first bug of every hand-rolled server. With
  protocol-level logging deprecated, stderr plus ordinary telemetry *is* the
  logging story, not a fallback.
- **Lifecycle is custody.** The spawner reaps the child
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)): on host
  shutdown, on connection replacement, on config change. Orphaned tool
  servers holding file locks and stale state are the transport's
  characteristic leak.

## Streamable HTTP: identity by credential

A streamable HTTP server is a network service: requests arrive by POST, and
responses may open a server-sent event stream when the server wants to push
progress or notifications. The properties that matter:

- **Many clients, so "who is calling" is now a real question on every
  request.** The transport layer answers it with standard HTTP mechanisms —
  the protocol's authorization story is OAuth-shaped, with bearer tokens
  validated per request. Because the data layer is stateless, the credential
  must ride on *each* call; there is no authenticated-connection state to
  lean on. The full treatment is
  [authentication-and-scoping](authentication-and-scoping.md).
- **Reach is whoever can route to the endpoint** — which for a server bound
  to a local port includes every browser tab the user has open, via scripted
  requests and DNS rebinding. A local HTTP listener is not "local" in the
  trust sense: it must validate origin, require a token, or bind to a
  socket-like mechanism with real access control. The common failure is a
  developer choosing HTTP for a single-machine tool "to make debugging
  easier" and shipping an unauthenticated localhost service that any web page
  can drive.
- **Reconnects are normal, so nothing may depend on connection continuity.**
  Notification streams are best-effort across reconnects; polling remains the
  correctness path. Long operations should not hold a request open past
  realistic timeout budgets — return a durable task handle and let the client
  poll it.

## Session semantics under statelessness

The 2026-07-28 revision removed protocol sessions entirely, and this is where
older designs mislead most. There is no server-assigned session established
at connect time, no connection-scoped negotiated state, no "the server
remembers you." Two consequences:

- **Cross-call state is an explicit handle**, minted by the server, returned
  in a result, and passed back as an ordinary argument. Handles are data, and
  they will travel — into transcripts, logs, retries — so they must be
  unguessable, expiring, and **bound server-side to the verified principal**.
  A server that treats handle possession as authentication has reinvented the
  bearer session cookie, minus every protection cookies accumulated over
  twenty years. The check must run against the authenticated caller on each
  request ([gate-sees-target](../../_laws.md#gate-sees-target)), not against
  the handle's mere validity.
- **Every request must carry its own context** — protocol version,
  capabilities, identity ride in per-request metadata. Version mismatch is
  therefore a per-request error to handle, not a connect-time gate to pass
  once; a robust client treats "unsupported version" as an ordinary retriable
  negotiation, and a robust server rejects with the list of versions it does
  accept rather than a bare refusal.

The migration corollary is worth banking: a server that never gated request
handling on handshake completion crosses protocol revisions almost for free —
it serves both eras from one dispatcher by answering the old handshake *and*
the new discovery request, because no request ever depended on which one
came first. Servers that accumulated per-connection state around their
handshake pay for it exactly here.

## The decision table

| The server… | Transport | Because |
|---|---|---|
| touches the local machine (files, local processes, local data) | standard streams | strongest isolation; identity by parenthood; no listener to attack |
| serves one application on one machine | standard streams | a network hop adds attack surface and buys nothing |
| serves many users or runs where the client does not | streamable HTTP | only transport with a multi-client identity story |
| needs to push progress on long operations | streamable HTTP with event streaming, or a task handle + polling | streams are an optimization; the handle is the guarantee |
| is a local tool that "wants a port for debugging" | standard streams anyway | the local-port trap: reach expands to every browser context on the machine |

The honest summary: standard streams when parenthood can carry identity;
streamable HTTP when it cannot; and never HTTP *without* doing the identity
work, because the transport that can serve many callers will — including the
callers never invited.
