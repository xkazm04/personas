---
layer: technique
subject: embedded-preview
technique: injected-instrumentation-with-fallback
status: forged
laws: [failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Injected instrumentation, with fallback

A bare frame gives the host a narrow surface: navigate it, know when it
loaded, screenshot it. Everything richer — "which element did the user
click, and what source produced it?", "what is the guest's state?",
"stream me the guest's errors" — requires an accomplice *inside* the
guest: a small instrumentation agent, injected into the guest's own code,
that speaks the bridge protocol from the far side. The technique is the
agent's three disciplines: how it gets in, how it stays harmless, and how
the preview survives its absence.

## Injection: the agent is part of the guest's source, gated out of production

The robust injection point is the guest's **source tree at generation or
scaffold time**, not runtime script insertion. The agent is written into
the guest as an ordinary component or module, mounted at the guest's
root, and wrapped in the guest's own development-mode gate so that
production builds compile it away entirely. This choice buys three things:

- **it survives the guest's build pipeline** — bundlers, strict modes, and
  content-security policies chew up runtime injection; source-level code
  is just code;
- **it is visible** — the user (and the model editing the guest) can see
  the agent in the tree, which matters because invisible injected code is
  exactly the shape of thing a security review must flag;
- **the production gate is structural** — a dev-only branch enforced by
  the guest's build system, not a runtime flag that can be left on.
  Instrumentation that ships is a liability twice over: it is a
  surveillance surface (it reads and reports the interior of the app) and
  an attack surface (it accepts commands over a message channel).

The cost is that the agent lives in territory the host does not control:
the guest's source is being *edited*, often by a model, and the agent's
mount point can be refactored away. That cost is why the fallback half of
this technique is not optional. Regeneration should be idempotent — the
scaffolder checks for the agent and re-adds it if a mutation dropped it —
but re-adding is repair, not prevention, and the preview must work in the
window between loss and repair.

## The agent's charter is deliberately small

Everything the agent can do, an injected instruction can try to abuse (the
guest runs untrusted code around the agent). So the charter is minimal and
enumerable — locate and describe elements, map a click to a source
reference, report errors and console output, announce readiness and
navigation — and each verb answers with **data, never with capability**:
descriptions, identifiers, source locations; never handles to live
objects, never evaluation of host-supplied code inside the guest as a
general verb. An "evaluate anything" verb is the bridge's root exploit
waiting for its user; the moment a real need looks like it wants one,
model it as a named, reviewable verb instead.

The agent also keeps its residue reaped: highlight overlays it draws,
listeners it installs, patches it applies to the guest's console — each
names its cleanup and restores the guest on teardown
([creation-names-reaper](../../_laws.md#creation-names-reaper)), because
the agent's document dies on every reload, and half-cleaned residue is how
a "reload the preview" turns into "the preview behaves differently the
second time".

## Presence is probed, never assumed

Injection fails routinely and legitimately: a regenerated entry file
dropped the mount; the guest crashed before the agent booted; the build
failed and the frame shows an error page; the agent booted but an older
protocol version answered. The host therefore treats the agent as a
**detected capability, not a dependency**: after every frame load, it
waits for the agent's *ready* announcement or probes with a short-timeout
ping (the handshake rules of
[cross-frame-protocol](cross-frame-protocol.md)); timeout means absent —
which is a declared, visible state, not an error and not a hang
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## The fallback ladder

Each interaction the preview offers is designed twice — a rich rung and a
coarse rung — and the surface binds to whichever rung the probe unlocked:

| capability | with agent | without agent |
|---|---|---|
| navigation | in-app route change, no reload | set the frame's URL, full reload |
| "where am I" | agent announces route changes | frame load events + URL |
| element targeting | click → element description + source ref | click coordinates on a screenshot, or none |
| error visibility | structured error/console stream | frame-level load failure only |
| readiness | agent's rendered signal | load event + settle delay |

Two rules govern the ladder. **Degradation is announced**: the surface
tells the user it is running in coarse mode ("preview connected;
instrumentation unavailable"), because a silently degraded preview reads
as a broken product and generates bug reports against the wrong layer.
And **the coarse rung is a real rung**: it is tested, it is sufficient to
view and navigate the guest, and nothing in the host *requires* the rich
rung to render a preview at all. The agent upgrades the experience; its
absence must never blank the frame.

## Instrumentation output is still guest output

Everything the agent reports — element text, attribute values, console
lines, error messages — is content from inside an untrusted application,
delivered with the agent's authority. The agent's presence does not
launder it: a model-facing consumer treats agent reports as untrusted
spans under the injection posture owned by
[prompt-safety](../../prompt-safety/prompt-safety.md), and size-caps them
at the bridge (a state dump or console flood is also a denial-of-service
on the host's prompt budget). The agent is an honest courier for
dishonest mail.
