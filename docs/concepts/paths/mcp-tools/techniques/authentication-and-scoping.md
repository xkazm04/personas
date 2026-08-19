---
layer: technique
subject: mcp-tools
technique: authentication-and-scoping
status: forged
laws: [one-validation-door, gate-sees-target, creation-names-reaper]
shared_with: []
---

# Authentication and scoping

Once a tool server is reachable by more than its own parent process, two
questions must have enforced answers on **every call**: *who is calling*, and
*which of this server's capabilities is that caller entitled to*. The
protocol's statelessness sharpens both — there is no authenticated connection
to lean on, so the credential and the decision ride with each request.

## Per-consumer capability tokens

The unit of issuance is a **capability token per consumer**, never a shared
server password. Each client integration that is granted access gets its own
token, so that:

- revocation is surgical — cutting off one integration does not rotate every
  other consumer's config;
- audit is attributable — "which consumer invoked this tool" is a lookup, not
  a guess;
- scope is individual — the read-only dashboard consumer and the
  full-control automation consumer hold different powers even against the
  same server.

Every token names its reaper at mint time
([creation-names-reaper](../../_laws.md#creation-names-reaper)): an expiry, a
rotation owner, or an explicit revocation path. The characteristic failure of
tool-server install flows is the opposite: a token minted once, written into
a client configuration file, and forgotten — a bearer credential with
indefinite validity sitting in plaintext in a directory whose permissions
nobody chose. If the install flow writes a token, the install flow's design
must answer *when does this stop working and who makes it stop*.

## Scope reuse from an existing registry

A tool server bolted onto a system that already has a key-and-scope registry
should **reuse that registry**, not mint a parallel vocabulary. The tool
surface is then just another audience for existing scopes: the token
presented on a tool call is looked up in the same registry, and the scopes it
carries gate which tools resolve. One authority for the scope vocabulary
means one place where "what can this key do" is answered — for the tool
protocol, for the HTTP surface, for anything else — and the tool server's
authorization check reads the registry's *current* record on each call
([gate-sees-target](../../_laws.md#gate-sees-target)), so a key revoked or
narrowed in the registry loses tool access at the same moment, not at the
next restart.

A parallel scope system for the tool surface is a drift generator: two
vocabularies for one concept, extended independently, converging only in
incident reviews.

## Where the check runs: one door, before dispatch

Authentication and authorization run in the **dispatch door** — the single
choke point every tool call passes through
([one-validation-door](../../_laws.md#one-validation-door)) — never inside
individual tool handlers. A handler that checks its own caller is a handler
someone will copy without the check. The door's order is fixed: authenticate
the token, resolve its scopes, *then* validate arguments and dispatch. An
unauthenticated caller learns nothing about argument schemas from error
shapes, and an unauthorized caller cannot distinguish "tool exists but not
for you" from "no such tool" unless the server deliberately chooses to reveal
the difference.

## Handshake-open, call-authenticated

A deliberate policy split worth naming: **discovery may be open while
invocation is authenticated.** Letting an unauthenticated client list tools
and read schemas costs little when the catalog is not itself sensitive, and
it makes integration friction visibly lower — the consumer can see what it
would be granted before going through issuance. The line that must hold is
that *execution* always authenticates. The reverse error — treating a
successful listing as implied permission to call — is a category mistake:
listing is a brochure, invocation is a transaction. Where the catalog itself
leaks strategy or structure, close the brochure too; but decide it as policy,
not by accident of which handler someone remembered to guard.

## Audience and the no-passthrough rule

Two obligations from the protocol's authorization model that generalize
everywhere:

- **Audience validation.** A server accepts only tokens issued *to it*. A
  token minted for some other service, presented here, is rejected even if
  cryptographically valid — otherwise any one compromised consumer becomes a
  skeleton key across services.
- **No token passthrough.** A server that calls downstream services does so
  with credentials *it* holds for that purpose, never by forwarding the
  caller's inbound token. Passthrough collapses the audit chain (downstream
  sees a caller that never called), bypasses the server's own rate and policy
  controls, and sets up the confused deputy: the downstream service trusting
  a token the middle server never validated for that use.

## Scope design: floor first, elevate on demand

Grant the minimal scope that makes the consumer useful, and widen on
demonstrated need — a challenge-driven step-up (the server names the missing
scope when a privileged operation is first attempted) beats a maximal
up-front grant on every axis that matters: blast radius of a stolen token,
legibility of the consent prompt, clarity of the audit trail. Omnibus scopes
(`all`, `admin`, wildcard) are the anti-pattern: they make every token a
master key and every consent dialog a rubber stamp. The effective capability
of any call is the **intersection** of what the token carries and what the
operation requires — and when the intersection is empty, the failure is loud,
local, and names the missing scope, at the door rather than three hops
downstream.
