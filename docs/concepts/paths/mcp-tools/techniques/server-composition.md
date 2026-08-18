---
layer: technique
subject: mcp-tools
technique: server-composition
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, failure-not-empty-success]
shared_with: []
---

# Server composition

A tool server's internals converge, in every healthy implementation, on the
same spine: **one registry** declaring what exists, **one dispatch door**
every call passes through, and a thin protocol shell that speaks JSON-RPC and
nothing else. Deviations from the spine are where tool servers rot.

## One registry, one authority

The registry is the single authoritative list of the server's tools: name,
description, input schema, handler, behavior annotations, required scopes —
one entry per tool, in one place
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Everything else derives from it:

- the listing response is a *projection* of the registry, never a
  hand-maintained parallel list;
- dispatch resolves the handler *through* the registry, so a tool that is
  listed is callable and a tool that is not listed is not — the two cannot
  drift because they are one lookup;
- the schema the validator enforces is the schema the listing published,
  because both read the same entry.

The degenerate alternative announces itself in review: a switch statement
over tool names in one file, a listing array in another, and a docs page in a
third. Three authorities, and the bug report is always the same — "the tool
works but isn't listed" or its mirror.

## One dispatch door

Every invocation flows through a single door that performs, in order:
resolve the tool in the registry (unknown → protocol error), authenticate and
authorize the caller (see
[authentication-and-scoping](authentication-and-scoping.md)), validate
arguments against the declared schema, execute the handler with a bounded
budget, shape the outcome into the result contract, and write the audit line.
Because the door is singular
([one-validation-door](../../_laws.md#one-validation-door)), these are
structural properties — no handler can be reached unvalidated, no call can
escape the audit — instead of six conventions each handler re-implements at
its author's discretion.

Two door-level obligations that handlers must not own individually:

- **Handler faults become in-band errors, not dead connections.** A panic or
  unhandled exception in one tool must be caught at the door and returned as
  a flagged result; one misbehaving handler taking down the transport for
  every other tool is a composition failure, not a handler bug. The
  distinction between "this call failed" and "the server failed" is this
  layer's instance of
  [failure-not-empty-success](../../_laws.md#failure-not-empty-success).
- **Timeouts and result-size caps are door policy.** A handler that hangs
  or returns forty megabytes should hit a limit the *door* enforces uniformly
  — per-handler discipline on this is exactly as reliable as the least
  disciplined handler.

## Request correlation under concurrency

JSON-RPC multiplexes: multiple requests may be in flight on one channel, and
responses match requests by id, not by order. A server (or a bidirectional
peer that also *sends* requests — elicitation makes servers requesters too)
therefore keeps a pending-request map: id → completion slot, with three
invariants. Ids are never reused while pending; every pending entry has a
timeout that fails it (the map is not a place requests go to be forgotten);
and channel teardown fails *all* pending entries immediately — the callers
are told, not left awaiting a response that can no longer arrive. A pending
map without a reaper is the tool-server version of the leaked handle: each
entry holds a caller hostage. And the timeout belongs on the *waiter*, not
only on the registry: a sweep that runs opportunistically (on the next
insert, on a periodic tick) bounds the map's size but not the caller's wait —
a blocked caller whose expiry fires only when someone *else* submits a
request has a timeout in name only. Registry-side sweeping and waiter-side
clocks are both required; they answer different questions.

## Listing at scale: pagination and change

The listing surface has its own contract:

- **Paginate with opaque cursors.** Clients treat the cursor as a token, not
  a decodable structure; servers version it so a stale cursor fails cleanly
  ("start over") rather than silently skipping entries.
- **Change is announced, not assumed.** When the tool set is dynamic —
  capabilities appearing with configuration, vanishing with permissions — the
  server declares list-changed support, and clients that opted in via a
  subscription stream receive a change notification whose entire content is
  "re-list." The notification deliberately carries no payload: the listing
  remains the single authority, and the notification is only an invalidation
  hint. Delivery is best-effort — a correct client also refreshes on its own
  schedule, and a correct server never treats "I notified them" as "they
  know."
- **Discovery is cacheable, and the server sets the terms.** Under the
  stateless architecture, the server's self-description (identity,
  capabilities, supported versions) carries explicit freshness and sharing
  hints. Cache lifetimes here are a contract: advertise long freshness on a
  listing that mutates hourly and every consumer holds a stale map exactly
  when it matters.

## Composition patterns above one server

Three recurring shapes, each with one governing caution:

- **The facade** wraps one upstream API surface at the altitude of user
  intent — fewer, higher-level tools than the API's endpoint list. The
  caution: resist re-exposing the upstream's shape wholesale; an
  endpoint-per-tool server exports its dependency's ergonomics instead of
  designing its own, and inflates the catalog the model must choose from.
- **The aggregator** mounts several capability families behind one server,
  namespacing tool names per family. The caution: families with different
  privilege levels need per-family scope requirements in the registry —
  aggregation must not flatten authorization.
- **The proxy** fronts other tool servers. The caution: a proxy is a
  full trust-boundary participant, not a pipe — it authenticates its own
  callers, holds its own downstream credentials (never forwarding inbound
  tokens), and owns consent for the delegation it performs. Proxies that
  behave like pipes are how confused deputies are built.
