---
layer: technique
subject: sidecar-provisioning
technique: process-isolation
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Process isolation

Some capabilities arrive as native code: an inference runtime, a media
engine, a numerical library with its own allocator and thread pool. Loading
such code into the host process is the default path and often the wrong
one. This technique owns the decision rule for **when a capability must run
out of process as a sidecar**, and the seam that makes the sidecar a
dependable component instead of a mystery neighbor.

## The collision problem

Native libraries do not compose the way in-language modules do. Two
runtimes loaded into one process can collide on:

- **Symbols** — two versions of one underlying library, loaded under one
  namespace; whichever loads second silently resolves against whichever
  loaded first.
- **Allocators and threading** — each runtime assumes it owns thread-local
  storage, signal handlers, or a global thread pool sized to the machine;
  two owners means oversubscription at best and corruption at worst.
- **Hardware access** — two engines both claiming the accelerator, each
  assuming exclusive initialization.

The resulting failures are the worst class in software: they depend on load
order, appear only when both features are active, reproduce on no
developer machine, and crash the *host* — taking every unrelated feature
down with the one that collided. In-process loading means every native
dependency implicitly certifies compatibility with every other, present
and future; that certification is unpayable.

## The decision rule

Run a native capability **in process** only when all of these hold: it is
the sole occupant of its native family (no second runtime, no second
version, now or plausibly later); its failure taking down the host is
acceptable; and its resource appetite is modest and bounded. Fail any one,
and the capability becomes a **sidecar**: a separate executable — exactly
the kind of artifact this subject provisions — spawned by the host and
spoken to over an explicit interface. The process boundary buys:

- **Collision immunity** — each engine owns its own address space,
  allocator, and thread pool; two sidecars cannot collide.
- **Crash containment** — a native crash kills the sidecar; the host
  observes an exited process (an ordinary, recoverable event) instead of
  dying mid-frame.
- **Independent lifecycle** — the engine can be provisioned, upgraded, and
  evicted without touching the host binary; a memory-hungry engine can be
  stopped when idle instead of squatting in the host forever.

The price is real: an interface to design, serialization at the boundary,
process supervision, startup latency. That is why this is a decision rule
and not a blanket policy — but for the specific trigger of *two native
runtimes in one process*, isolation is not an option among several; it is
the only correct answer.

## The seam: an explicit interface with a version handshake

A sidecar's usefulness is exactly as good as its interface. The seam is
designed like any inter-service boundary, in miniature:

- **An explicit protocol** over a local transport — request/response with
  typed messages, however humble. "Write to its input, parse whatever comes
  out" is not a protocol; it is a bet on the sidecar never changing its
  logging.
- **A version handshake first.** The host's first exchange asks the sidecar
  what it is and what it speaks; the host proceeds only when the answer is
  in its supported range. Host and sidecar are provisioned on different
  schedules — the handshake is what turns "mysterious garbled responses
  after an upgrade" into "version mismatch: host supports 2–3, sidecar
  speaks 4", a message that names its own fix. The supported-version set
  lives in one place on each side
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
- **Readiness distinct from existence.** A sidecar loading a large model
  takes seconds to become useful. The protocol exposes *ready* explicitly;
  the host's states — spawned, handshaking, ready, busy, failed — never
  collapse into a boolean
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  What "ready" probing looks like mechanically is
  [probe-design](../../health-checks/techniques/probe-design.md)'s ground.

## Division of labor with the neighbors

This technique decides *that* a capability runs out of process, provisions
the executable, and owns the protocol seam. Everything about the running
process belongs to
[subprocess-lifecycle](../../subprocess-lifecycle/subprocess-lifecycle.md):
the spawn passes through the one spawn door with a minimal environment
([spawn-contract](../../subprocess-lifecycle/techniques/spawn-contract.md)),
the sidecar is terminated down its ladder and its process tree reaped on
host exit
([termination-and-reaping](../../subprocess-lifecycle/techniques/termination-and-reaping.md)),
and a sidecar that holds a port or a lock names its reaper like every
other child. A provisioned sidecar that outlives the host because nobody
wired the termination path is this subject's artifact but that subject's
defect — the seam between them is the resolved executable path and the
protocol contract, nothing more.
