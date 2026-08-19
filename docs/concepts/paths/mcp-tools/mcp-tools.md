---
layer: golden-path
subject: mcp-tools
status: forged
techniques:
  - transport-selection
  - authentication-and-scoping
  - tool-schema-design
  - server-composition
  - client-integration
  - untrusted-result-handling
evidence:
  - src-tauri/src/companion/orchestration/mcp/mod.rs   # single-endpoint JSON-RPC server, dual-era discovery, per-session token auth
  - src-tauri/src/companion/orchestration/mcp/pending.rs # pending-request correlation: TTL, session-exit cancellation, waiter-side timeout
  - src-tauri/src/mcp_server/auth.rs                   # per-call token authentication, scopes reused from the key registry
  - src-tauri/src/mcp_server/tools.rs                  # tool catalog: schema declarations + dispatch
  - src-tauri/src/commands/fleet/pty.rs                # build_mcp_spawn: capability token injected via generated client config, reaper coupled to session exit
counter_evidence:
  - src-tauri/src/mcp_server/install.rs                # capability token written into client config with no expiry and no named reaper
deviations:
  - w2-mcp-tools   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Tool protocols (MCP)

A tool protocol is the wire contract through which a reasoning system acquires
hands. The Model Context Protocol standardizes that contract: a **host** (the
AI application) creates one **client** per connection to each **server** (a
program exposing capabilities), and across that connection flow the three
server primitives — **tools** the model may invoke, **resources** the
application may read, **prompts** the user may select. The subject of this
path is the discipline on both sides of that wire: exposing capabilities
without exposing the process behind them, and consuming capabilities without
trusting the process behind them.

What decides everything here is one framing: **the tool boundary is a trust
boundary, in both directions.** A schema published by a server is a contract
the server must actually enforce — not documentation of what well-behaved
callers send. A result returned by a server is untrusted input twice over: the
consuming application must not act on it blindly, and the model reading it
must be defended against instructions smuggled inside it. Every technique in
this path is a consequence of taking that framing seriously; most tool-protocol
incidents are a consequence of not.

What is *not* this subject: the model's own function-calling format (a private
contract between one application and one model vendor), plugin systems that
load code into the host's address space (no process boundary, so no protocol —
a different and weaker isolation story), and generic RPC between services that
no model ever reads (ordinary distributed-systems discipline applies, without
the injection surface).

## The current architecture: stateless, self-describing, discovered

The protocol's 2026-07-28 revision replaced connection lifecycle with
statelessness, and designs still shaped around the old lifecycle are carrying
dead weight. The load-bearing facts:

- **Every request is self-describing.** Protocol version, client capabilities,
  and client identity travel in each request's metadata. A server infers
  nothing from previous requests; there is no negotiated connection state to
  desynchronize, and any request can be the first request.
- **Discovery is a cacheable request, not a handshake.** A client *may* ask
  the server to describe itself — supported versions, capabilities, identity —
  in a single mandatory-to-implement request whose response carries explicit
  freshness and sharing hints. It may equally skip discovery, send any request
  directly, and handle a version error. The old world's mandatory
  initialize-then-operate ceremony is gone.
- **There are no protocol-level sessions.** State that must span calls — a
  cart, a workflow, a cursor — is an explicit **handle** minted by the server
  and passed back as an ordinary argument. The corollary is a law of this
  subject: *possession of a handle is not authentication.* A server binds
  every handle to the principal it verified, or the handle is a bearer token
  it never meant to issue.
- **Change notifications are opt-in subscriptions, delivered best-effort.** A
  client that cares about a changing tool list opens a long-lived listen
  stream naming the notification types it wants, and still polls, because
  delivery across reconnects is not guaranteed. Correctness never rests on a
  notification arriving.
- **Two client-side primitives were retired.** Sampling — servers borrowing
  the client's model — is deprecated; a server that needs a model integrates
  with one directly. Protocol-level logging is deprecated in favor of the
  transport's native error stream and standard telemetry. What remains on the
  client side is **elicitation**: a server asking the user a structured
  question mid-operation, through the client, over a multi-round-trip pattern.
- **Long-running work gets a durable handle, not a held connection.** The
  tasks extension lets a server return a pollable handle for an operation that
  outlives any reasonable request timeout — the request/response shape stays
  clean and reconnects stop being failures.

## Who controls what

The three server primitives differ in *who decides to use them*, and the
distinction is a safety architecture, not taxonomy. **Tools are
model-controlled**: the model chooses to invoke them, which is exactly why
tool execution is where consent gates, approval dialogs, and audit trails
concentrate. **Resources are application-controlled**: the host decides what
context to read and feed to the model; no side effects, so the risk is
disclosure, not action. **Prompts are user-controlled**: explicitly invoked
templates, never auto-triggered. Collapsing these into "the server has
functions" discards the load-bearing question every reviewer should ask of a
capability: *who pulls this trigger, and what stands between the trigger and
the effect?*

## Schemas are contracts; enforcement is the server's

A tool's declared input schema is the model's only map of the tool. It is also
the boundary's contract — and the party that must enforce it is the server,
at dispatch, against the actual arguments
([gate-sees-target](../_laws.md#gate-sees-target)): client-side validation is
a courtesy to the model, not a defense of the server. One dispatch door that
validates, authorizes, executes, and audits every call
([one-validation-door](../_laws.md#one-validation-door)) is what makes those
properties structural instead of per-handler conventions; the shape of that
door is the [server-composition](techniques/server-composition.md) technique,
and what a good contract looks like — naming, argument design, result shapes,
and the two distinct error channels — is
[tool-schema-design](techniques/tool-schema-design.md).

The error-channel distinction deserves its headline early because it is this
subject's instance of
[failure-not-empty-success](../_laws.md#failure-not-empty-success): a
**protocol error** (unknown tool, malformed arguments, unauthorized caller)
says the *call* never validly happened and is addressed to the machinery; an
**in-band tool error** (the flight search failed, the file does not exist) is
a *result* addressed to the model, which can read it and try something else.
Conflating them either hides infrastructure failures inside model-visible
prose or converts recoverable domain failures into dead connections.

## Transport is a security decision

The protocol runs over two transports, and the choice is not a performance
knob. A **standard-stream** server is a child process: its identity is
established by who spawned it, its reach is one client, and its failure mode
is the spawn itself — client configuration that executes a command line is
code execution by design, so install flows carry consent obligations. A
**streamable HTTP** server is a network service: many clients, real
authentication (the protocol's authorization story is OAuth-shaped), and the
entire catalog of web-facing obligations — origin validation, audience-bound
tokens, no passthrough of tokens minted for someone else. A server that binds
to a local port "for convenience" has silently crossed from the first world
into the second, where the browser of every visited website is a potential
caller. The full decision table is
[transport-selection](techniques/transport-selection.md); the credential
half — who may call, and with which of the caller's powers — is
[authentication-and-scoping](techniques/authentication-and-scoping.md).

## Results are input

Everything a server returns — tool results, resource contents, even tool
*descriptions* read at listing time — enters the context of a model with the
authority to invoke further tools. That makes tool output the canonical
injection surface: an attacker who controls any upstream text a tool returns
(a web page, an issue title, an email body) is speaking directly to the
model, in the model's own working memory, with the model's tool belt within
reach. The consuming side therefore treats results as data with provenance —
fenced, attributed, never promoted to instruction — and the application
around the model enforces what the model cannot be trusted to: which tool
transitions require fresh human consent, which results may flow into which
subsequent calls. This is
[untrusted-result-handling](techniques/untrusted-result-handling.md), and it
is the technique least optional in the set.

## Sprawl is a quality defect, not a cosmetic one

Every tool listed is prompt space spent and a choice the model can get wrong.
Selection quality degrades as the catalog grows — similar names blur, vague
descriptions overlap, and the model starts calling the almost-right tool with
almost-right arguments. A tool catalog is therefore a curated product surface
with a budget: few tools, sharply named, at the altitude of user intent
(one *search-and-book* tool, not nine API endpoints re-exposed), with the
catalog itself as the single authority on what exists
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).
Hosts federating many servers compound the problem and answer it with
progressive discovery — load what the task plausibly needs, not everything
that exists. Curation pressure belongs on both sides of the wire:
[server-composition](techniques/server-composition.md) for the publisher,
[client-integration](techniques/client-integration.md) for the host.

## Custody of the connection

A host owns the lifecycle of every connection it creates, and each end owns
what it mints ([creation-names-reaper](../_laws.md#creation-names-reaper)):
the host reaps the child processes it spawns; the server expires the handles
and capability tokens it issues. The classic violation in the wild is the
install flow that writes a never-expiring credential into a client
configuration file — custody discipline present inside the vault, absent one
step outside it, where the config file is now a bearer credential with no
reaper. Install and configuration are part of the protocol surface, with the
same obligations as the wire itself:
[client-integration](techniques/client-integration.md).

## The techniques

- [transport-selection](techniques/transport-selection.md) — child process vs
  network service: identity, reach, session semantics under statelessness,
  and the local-port trap between them.
- [authentication-and-scoping](techniques/authentication-and-scoping.md) —
  who may call and with what: per-consumer capability tokens, scope reuse
  from an existing key registry, audience validation, the no-passthrough
  rule, and open-listing/authenticated-call policies.
- [tool-schema-design](techniques/tool-schema-design.md) — the contract
  itself: naming for selection, argument design for a caller that guesses,
  result shapes for a reader that reasons, and the two error channels.
- [server-composition](techniques/server-composition.md) — the publisher's
  spine: one registry as the single authority, one dispatch door, pagination,
  change notifications, and discovery caching.
- [client-integration](techniques/client-integration.md) — the consumer's
  spine: config writing as code execution, consent at install and at call,
  federated catalogs, elicitation, and connection custody.
- [untrusted-result-handling](techniques/untrusted-result-handling.md) —
  the inbound defense: results as attacker-controlled input, injection
  fencing, provenance, and the application-level gates the model cannot
  provide for itself.
