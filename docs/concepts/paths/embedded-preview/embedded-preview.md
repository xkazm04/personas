---
layer: golden-path
subject: embedded-preview
status: forged
techniques:
  - cross-frame-protocol
  - origin-validation
  - injected-instrumentation-with-fallback
  - dev-server-registry
  - convention-discovery
  - preview-checkpoints
evidence:
  - src-tauri/src/webbuild/devserver.rs               # canonical registry: one server per project, pid+port recorded at spawn, real HTTP readiness probe (not TCP), taskkill /T tree teardown, stop_all wired to RunEvent::Exit, stale next-lock recovery guarded by pid_is_node
  - src-tauri/src/webbuild/preview_agent.rs           # dev-gated agent injected at source level into the generated project (NODE_ENV gate on mount AND in effect), idempotent+refresh-on-stale write, two data-only verbs, total cleanup; layout patch is best-effort by contract
  - src-tauri/src/webbuild/routes.rs                  # convention discovery: scans app/ | src/app/ for page.* files, strips (groups), skips _private, keeps [dynamic] for the surface to decide
  - src-tauri/src/webbuild/versions.rs                # per-turn git snapshot minted from the turn's reply, forward non-destructive restore (mechanics owned by undo-history; cited here for turn alignment)
  - src/features/studio/StudioPage.tsx                # host half of the bridge: single message listener, e.source-matched attribution of route events across warm frames, coarse region-pointer fallback designed in beside the precise ring
counter_evidence:
  - src/features/studio/StudioPage.tsx                # the same file, on origin: never reads e.origin, every postMessage targets '*'; reqId carries the project id not a request id and is never read on reply; presence is 8x700ms retry not a probe, so silence and not-found converge on the same null
deviations:
  - w12-embedded-preview   # anchor in docs/concepts/golden-path-deferred-fixes.md                                        # reported in the composer report, not yet registered — see FINAL REPORT (no deferred-fixes edits by brief)
---

# Embedded preview & cross-frame bridge

Embedded preview is the subject you enter when the product must host a
**second, live application inside itself** — separately served, separately
built, often generated or modified moments ago — and *talk to it*. Not
rendering content: running a program inside a program. The guest application
has its own server, its own build loop, its own routes, its own failure
modes, and its own origin. The host product must display it, drive it,
observe it, and survive it, all without owning its internals.

The defining property of the subject is that the boundary between host and
guest is **three boundaries stacked in the same place**: a *process*
boundary (the guest is served by a process the host started and must
eventually kill), a *communication* boundary (the only channel across the
frame is asynchronous message passing — no shared memory, no synchronous
call, no return value unless the protocol builds one), and a *trust*
boundary (the guest is arbitrary code — frequently code a model just wrote —
and every byte it sends back is untrusted input). Every ancestral mistake in
this subject comes from collapsing one of the three: treating messages like
function calls, treating the guest like part of the host's security domain,
or treating the guest's server like a fire-and-forget child process.

The golden path keeps all three boundaries explicit. The frame speaks a
**protocol** — request/response with correlation identity, timeouts, and a
handshake — never bare fire-and-forget messages. Message **origins are
validated in both directions**, because a bridge that accepts any sender is
an injection door installed by the host itself. Rich interaction comes from
an **instrumentation agent injected into the guest**, but the preview must
work when injection fails, because it will. The guest's server lives in a
**registry that owns its lifecycle** — health-checked at birth, torn down as
a process tree at death. The guest's structure (its routes, its pages) is
**discovered from its own conventions**, never hand-listed. And because the
guest is being *mutated* between views, its state is **checkpointed per
mutation boundary** so any turn can be revisited.

## When the subject does not apply

Most "preview" features are not this subject, and importing its machinery
into them is pure cost:

- **Static preview** — rendering sanitized markup, a document, or a
  generated snippet inline in the host's own tree. No second server, no
  frame, no bridge; sanitize and render.
- **Same-origin, first-party embeds** — a surface of the host embedded in
  another surface of the host. There is no trust boundary and usually no
  process boundary; component composition solves it.
- **Foreign media players** — an embedded third-party *player* (video,
  audio) controlled through its provider's bridge. That is an engine, and it
  belongs to [media-playback](../media-playback/media-playback.md)'s
  [engine-adapters](../media-playback/techniques/engine-adapters.md): the
  provider owns the protocol and the roadmap, and the adapter's job is to
  box a dialect you do not control. This subject is the *general* case —
  the guest is an application, you own both sides of the bridge, and the
  protocol is yours to design.

The subject earns its structure when the embedded thing is a **whole
application behind its own server**, and the host needs more than a picture
of it: navigation, element-level interaction, state readout, or a feedback
loop where the host (or a model driving the host) edits the guest and
watches the result.

## The frame boundary is a protocol boundary

The frame's message channel delivers events one way, with no reply, no
ordering guarantee against other channels, no delivery confirmation, and no
type safety. The ancestral mistake is to use it as it comes: host fires a
message, guest fires one back when it feels like it, and the correlation
between ask and answer lives in the developer's head. Fire-and-forget
bridges are debugging nightmares of a specific, recognizable shape — replies
attributed to the wrong request, stale answers applied after the question
changed, and a hang with no owner when the guest silently drops a message.

The golden path builds a real protocol on top: **every request carries a
correlation id minted at send time; every reply echoes it; every pending
request has a timeout that converts silence into a declared failure.** The
sender keeps a table of in-flight requests keyed by id; a reply either
settles exactly one entry or is discarded as stale — identity, not arrival
order, decides what an answer answers
([identity-survives-reuse](../_laws.md#identity-survives-reuse)). A timeout
is not an error swallowed; it is a distinct outcome the caller sees, because
a guest that never replies must cost the host milliseconds and a fallback,
not a frozen surface
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). The
envelope, the handshake that establishes both ends speak the same protocol
version, and the pending-table discipline live in
[cross-frame-protocol](techniques/cross-frame-protocol.md).

## Origin discipline is non-negotiable

The message channel is a public mailbox: anything running in the frame tree
can post to it, and the host's listener receives whatever arrives. A bridge
that dispatches on message *shape* alone — "it has our field names, it must
be ours" — is an injection door: any document that learns the envelope
format can drive the host's side of the bridge, and the host's side does
privileged things (navigation, file reads, model calls) on behalf of the
guest. The same door swings the other way: a host that broadcasts to a
wildcard target leaks its messages — which may embed project content or
instructions — to whatever is actually loaded in the frame, including the
wrong thing after a redirect.

The golden path is symmetric strictness: **the host verifies every inbound
message's origin against the exact origin it is currently hosting, and
addresses every outbound message to that origin, never to a wildcard.** The
expected origin is not a constant — it is minted when the guest's server is
registered and rebound when the server or port changes — so validation
compares against the *current* truth, not a stale allowlist
([gate-sees-target](../_laws.md#gate-sees-target)). Origin checks, the
single dispatch door for inbound messages, and the handling of the moments
when the origin legitimately changes are
[origin-validation](techniques/origin-validation.md)'s charter. What origin
validation does **not** buy — trusting the *content* of a valid-origin
message — is covered below, under the trust boundary.

## Instrumentation is injected, gated, and optional

A frame with no help inside it offers the host a coarse surface: load a
URL, know when it loaded, take its picture. Rich interaction — locate the
element the user clicked, read a component's state, report the guest's
console and errors — requires an agent *inside* the guest: a small
instrumentation component injected into the guest's code at generation or
build time, speaking the bridge protocol from the guest's side.

The golden path holds two properties in tension and refuses to drop either.
**The agent is gated** — it exists only in development builds of the guest,
compiled out of anything that ships, because instrumentation in production
is a surveillance liability and an attack surface. **And the agent is
optional** — the preview must work without it. Injection fails routinely:
the guest's build rejects the injected code, a model regenerated the entry
file and dropped the import, the guest crashed before the agent booted. An
instrumentation layer that is load-bearing turns every injection failure
into a dead preview; the correct posture is *enhancement*: the host probes
for the agent with a handshake, uses the rich surface when it answers, and
falls back to the coarse surface — URL navigation, load events, screenshots
— when it does not, telling the user which mode they are in rather than
silently degrading
([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
Injection mechanics, the capability handshake, and the fallback ladder are
[injected-instrumentation-with-fallback](techniques/injected-instrumentation-with-fallback.md).

## The server registry owns lifecycles

Every previewed project needs a dev server, and a dev server is the most
leak-prone kind of child process: long-lived, port-holding,
memory-hungry, and spawned through a package-manager wrapper that forks its
own children — so killing the process you spawned routinely leaves the
actual server running. An orphaned dev server is a port leak with a memory
footprint measured in hundreds of megabytes, and it *keeps serving*, so a
frame pointed at its port shows a stale guest and nobody can tell why.

The golden path centralizes ownership: a **registry, keyed by project, that
is the only spawner and the only killer.** One server per project — a
second preview of the same project reuses the entry, never races a second
spawn. Registration records everything teardown needs (process identity,
port, project) at spawn time, because
[creation-names-reaper](../_laws.md#creation-names-reaper) is the law this
subject violates most expensively. Readiness is probed, not assumed — a
port accepting connections is not an application ready to render, and the
frame points at the server only after a real health check passes. Teardown
kills the **process tree**, not the process, and runs on every exit path
including host shutdown. The registry pattern is
[dev-server-registry](techniques/dev-server-registry.md); the general
science of killing process trees and reaping children belongs to
[subprocess-lifecycle](../subprocess-lifecycle/subprocess-lifecycle.md) and
is linked from there rather than restated —
[termination-and-reaping](../subprocess-lifecycle/techniques/termination-and-reaping.md)
is the canonical treatment.

## Discovery follows convention

The host wants to offer navigation: which pages does the guest have? The
ancestral mistake is a hand-maintained list — built once at generation
time, wrong after the first edit, and wrong in the way that erodes trust
(the menu offers a deleted page; the new page never appears). A guest
application's structure is already written down *in the guest*: every
framework this subject meets encodes routes in file-system conventions.

The golden path reads the guest's own conventions: **scan the project's
file tree under the convention the guest's framework defines, derive the
route list, and re-derive it after every mutation.** The discovered list is
a derivation, and it names its recomputation — the scan — so staleness has
an arbiter
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)).
Convention scanning, dynamic route segments, and the choice of when to
rescan are [convention-discovery](techniques/convention-discovery.md).

## Preview state is checkpointed

The reason the guest exists is usually that something — a user, a model —
is *mutating* it, turn by turn. Each turn's result deserves to be
revisitable: "go back to how it looked two turns ago" is a core preview
affordance, not an extra. The golden path captures a **snapshot of the
guest project at every mutation boundary** and offers restore as a forward,
non-destructive move.

The mechanics of checkpointing — capture at boundaries of meaning,
append-only timelines, restore-as-forward-move, retention — are owned by
[undo-history](../undo-history/undo-history.md), and its
[checkpoint-restore](../undo-history/techniques/checkpoint-restore.md)
technique is the authority this subject defers to. What is preview-specific
— aligning capture with conversation turns, what restore must do to the
*running* preview (the server keeps serving; the frame must be told), and
the interaction with the guest's own hot-reload loop — lives in
[preview-checkpoints](techniques/preview-checkpoints.md).

## The trust boundary outlives every other check

Origin validation authenticates the *envelope*; nothing authenticates the
*content*. The guest is arbitrary code, and in the modal case of this
subject it is code a model generated from a user's prompt — which means
everything the guest reports (element text, attributes, console output,
state dumps, error messages) can contain adversarial instructions aimed at
whatever reads it. The moment bridge traffic flows toward a model — and in
a preview-driven build loop it always does, because "here is the selected
element, fix it" is the loop — the guest's output must be handled as
untrusted spans under the product's injection posture. That posture is
owned by [prompt-safety](../prompt-safety/prompt-safety.md): fence the
spans, cap their size, never let guest-reported content escalate into
instructions. This subject's duty is to *route* every guest-originated
byte through that door and to keep the bridge's own surface small enough to
audit — a bridge verb the host does not strictly need is a bridge verb an
injected instruction can abuse.

## The techniques

- [cross-frame-protocol](techniques/cross-frame-protocol.md) — the message
  envelope: correlation ids, pending-request tables, timeouts, version
  handshake, and why fire-and-forget is banned.
- [origin-validation](techniques/origin-validation.md) — symmetric origin
  checks, the single inbound dispatch door, rebinding the expected origin
  when the server moves.
- [injected-instrumentation-with-fallback](techniques/injected-instrumentation-with-fallback.md)
  — the dev-gated agent inside the guest, the capability handshake, and
  the coarse fallback that keeps the preview alive when injection fails.
- [dev-server-registry](techniques/dev-server-registry.md) — one registry,
  one server per project, readiness probing, process-tree teardown on
  every exit path.
- [convention-discovery](techniques/convention-discovery.md) — deriving
  the guest's routes from its own file conventions, rescanning as the
  arbiter of staleness.
- [preview-checkpoints](techniques/preview-checkpoints.md) — per-turn
  snapshots and restore, specialized to a guest that is live behind a
  server while its files change.
