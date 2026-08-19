---
layer: technique
subject: pipeline-dag
technique: external-adapter-nodes
status: forged
laws:
  - one-validation-door
  - failure-not-empty-success
  - gate-sees-target
shared_with: []
---

# External adapter nodes

The most consequential nodes in any pipeline are the ones whose effects
leave the system: deploy this workflow to an external automation platform,
dispatch that job, publish, notify, call the endpoint the user pasted in.
They combine every hazard the other node classes have singly — non-idempotent
effects, untrusted user-supplied configuration, remote state the engine
cannot read back — and they are where a pipeline engine's mistakes stop
being bugs and start being incidents. The stance: an external adapter node
is a **guarded boundary crossing** — validated on the way out, recorded on
both sides of the wire, and registered as done only on confirmed success.

## User-supplied endpoints are attack surface

The endpoint an adapter calls is very often user data — a pasted target
address, an imported configuration, a value assembled from upstream node
output. Treating it as a plain string to fetch is the classic
server-side-request-forgery shape: the engine, running with the network
position and credentials of the host, is aimed at whatever the string says —
including loopback addresses, private-range and link-local addresses (cloud
metadata services live there), internal hostnames, and non-HTTP schemes.
The defenses, applied at **one validation door** through which every
outbound endpoint passes before any adapter touches the network
([one-validation-door](../../_laws.md#one-validation-door)):

- **Scheme allowlist** — secure transport only, no file/gopher/arbitrary
  scheme dispatch.
- **Address screening after resolution** — reject loopback, private,
  link-local, and otherwise reserved ranges *post-DNS*, because the hostile
  hostname resolves to the internal address; screening the hostname string
  screens nothing. Re-screen on redirects, or refuse to follow them —
  a redirect is a second request with a new target.
- **Structural validation** — parse, don't pattern-match; embedded
  credentials in the authority, userinfo tricks, and confusable encodings
  are parser problems, and a real parser is the only component that wins.
- **Per-adapter target policy** — an adapter for a known platform pins its
  base endpoint from configuration and accepts only the path/identity
  parts from the user, shrinking the validated surface to near zero.

The same door is where secrets are handled: adapters reference credentials
by identity and the engine injects them at call time from the credential
subsystem — the graph document itself never stores a secret, because graphs
are exported, shared, and versioned, and every one of those copies would
carry it.

## The run record brackets the wire

Every outbound attempt writes **before** the call (target, adapter, sanitized
payload summary, attempt identity) and **after** it (status, remote-assigned
identity if any, response summary, duration). The before-write is the crucial
half: it is what distinguishes "we never called" from "we called and the
answer was lost" after a crash — precisely the unknown-fate adjudication that
[deterministic-vs-model-nodes](deterministic-vs-model-nodes.md) requires for
non-idempotent effects. An adapter that logs only on response has decided
that its most dangerous failure mode will also be its least documented
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Where the remote platform offers idempotency keys or deduplication tokens,
the attempt identity is the key — turning "retry after unknown fate" from a
gamble into a safe operation, which is the single highest-leverage feature
to demand of any platform being adapted.

This record doubles as the audit trail: external effects are exactly the
category where "who caused what, when, aimed where" must survive
indefinitely, and the run record feeding the system's audit log gives
operators one story instead of two.

## Save on success only

Adapters that *register* something — deploy a definition, create a remote
resource, mint a local record pointing at a remote one — commit their local
bookkeeping **only after the remote confirms**. The inverted order (save
locally, then call) manufactures phantoms: a local record claiming a
deployment exists when the call failed, which every later reconciliation,
list view, and dependent node now believes. The local commit is the *last*
step, gated on reading the remote's actual success response — not on the
absence of a transport error, which is merely the absence of one failure
class ([gate-sees-target](../../_laws.md#gate-sees-target): the thing being
gated is "the remote accepted it", so the gate must read the remote's
answer, not a proxy for it). The residual crash window — remote succeeded,
local save lost — is then the benign orphan: a remote resource with no local
record, discoverable by reconciliation against the before-write, rather than
a local lie.

## Response validation is input validation

The remote's response is external input and gets the same skepticism as the
endpoint did: parse against the expected shape, bound the size, extract the
identities and statuses the run record needs, and refuse to interpret an
error page as data. Classification of failures — retryable transport noise
versus permanent rejection versus rate limiting — feeds the retry contract
(the taxonomy lives in
[retry-backoff](../../retry-backoff/techniques/error-classification-for-retry.md));
the adapter's added duty is mapping the platform's idioms honestly into that
taxonomy, because a platform that spells "slow down" in a nonstandard way
will otherwise be classified as permanently broken, or worse, hammered.

## Decision rules

- Every adapter is registered, named, and versioned; "generic call-anything
  node" is an adapter too, and it gets the *strictest* endpoint policy, not
  an exemption.
- Consequence gating composes: an adapter whose action is irreversible or
  externally visible is a natural site for an approval gate node in front
  of it ([hitl-approval](../../hitl-approval/hitl-approval.md) owns when
  that is mandatory); the adapter itself still validates and records, because
  a gate approves an intent, not the safety of the mechanics.
- Dry-run capability per adapter wherever the platform allows: validate,
  render the exact would-be request, execute nothing — the preview surface
  and the test harness both need it.
- Timeouts and response-size ceilings on every call; an adapter with no
  deadline donates its executor slot to the slowest server on the internet.
- No adapter writes remote state during graph validation or preview. The
  authoring path proves the call *would be* legal; only a dispatched run
  attempt may cross the wire.
