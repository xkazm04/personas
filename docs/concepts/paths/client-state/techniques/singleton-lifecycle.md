---
layer: technique
subject: client-state
technique: singleton-lifecycle
status: forged
laws: [creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Singleton lifecycle

Some client state cannot live in the store: a live connection, an event
buffer absorbing high-frequency traffic, a registry of timers, a bridge
between transport and application. These are **stateful services**, and the
pragmatic home for a stateful service is module scope — created when its
module first evaluates, imported by everyone, one instance per process.

The entire difficulty of this technique is that *"one instance per
process"* is enforced by nothing. Module evaluation is "once" only under
assumptions that two common environments break:

- **Live code replacement during development** re-evaluates edited modules
  while the process keeps running. The new evaluation creates a *second*
  instance; the first survives, along with every subscription, timer, and
  closure holding a reference to it.
- **Test runners** evaluate modules once per suite (or worker) and run many
  cases against that single evaluation, so module state silently threads
  one case's world into the next.

The failure mode is **duplication, not absence** — and that shapes
everything below. A missing singleton crashes immediately and gets fixed;
a duplicated one double-applies every event, double-fires every timer, and
produces symptoms (doubled entries, twice-sent messages, phantom updates)
that are timing-dependent, environment-specific, and routinely blamed on
the wrong layer.

## The opening question, and the ladder

Everything starts with one question, asked of the concrete state: **what
would a second live copy of this module actually do?** If the answer is
"recompute a value, re-warm a cache, re-fetch" — module scope is already
correct, the duplicate costs one recompute, and any further machinery is
liability. The problem is real only when a second copy would **install a
second registration on something that outlives the module** (a listener on
a document or window, a patch on a shared object, an entry in a
process-lifetime registry, a timer) or **repeat a write observable outside
the process**. The telltale shape is the *one-way latch*: a module-scope
"already installed" flag that goes true once and never returns — it
guards correctly exactly once, and re-evaluation resets it while the thing
it guarded lives on, making every duplicate silently additive.

When the problem is real, climb this ladder and stop at the first rung
that holds:

1. **Delete the need: refcount the resource.** Acquire on the first
   subscriber, release when the last one leaves. A superseded copy's
   subscribers drain away, its count hits zero, and it releases its own
   resource — self-healing under replacement *and* under ordinary
   teardown, with no global names and no generation bookkeeping. A
   refcounted resource is replacement-safe for free; a latched one never
   is.
2. **If the resource must be long-lived: make stale copies inert** with a
   generation token (below).
3. **Only if the registration can be neither released nor re-created:**
   one process-global slot, built to the standard below.

And before rung 3, check whether a library already in the dependency graph
owns a process-level instance registry for exactly this resource — many
platform integrations do. Delegating idempotence to the registry that
already exists beats building a parallel one.

## Inertness over prevention

The instinct is to prevent the second instance — detect replacement, tear
down the old copy, hook the development runtime's disposal callbacks.
Prevention is the losing strategy: it depends on the replacement machinery
cooperating (it varies by toolchain and mode), on teardown being complete
(every subscription, every timer — miss one and the zombie lives), and on
code paths that run only in development, which means they are the least
tested code in the repository.

The winning strategy accepts the second instance and makes **stale copies
inert**:

- A single **generation token** lives in a scope that survives replacement
  (the process-global scope, under a namespaced key). Each instance
  increments and captures it at creation.
- Every callback the instance registers — event handlers, timer bodies,
  subscription continuations — compares its captured generation against
  the current one and returns without effect on mismatch.

The superseded instance still exists; it has simply lost the right to act.
This is the same shape as the consumer-side generation guard in streaming
([run-attribution](../../streaming-output/techniques/run-attribution.md))
and the latest-wins token over requests
([async-race-guards](async-race-guards.md)): one lineage of pattern —
*capture identity at birth, verify before acting* — applied at module
lifetime ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

What generations do not solve: **externally held resources**. A stale
instance's open connection or platform-level registration is not made
inert by a token check on callbacks. Resources that outlive their holder
transfer rather than duplicate: keep the resource itself under the
process-global key (so the new generation adopts it) or close-and-reopen
as part of adopting the new generation — deliberately, as the replacement
step, not as cleanup that might run.

## What earns the global scope

Placing state in process-global scope is the strongest lifetime claim the
client can make, and most module state making that claim is wrong to. The
discriminator is not "holds a timer" or "is a service"; it is what the
state *means across replacement*:

- **A one-way latch** ("this expensive thing has been initialized", "this
  warning was already shown once") — global scope is right; re-latching
  after replacement is exactly the duplicate work the latch exists to
  prevent.
- **A reference-counted or paired lifecycle** (listeners registered and
  removed, resources acquired and released) — global scope is wrong for
  the *count*: the new generation's balanced acquire/release pairs get
  arithmetic'd against the old generation's, and the count's invariant
  dies. The pairs belong to the instance; only the underlying resource, if
  it must survive, goes global.
- **Buffers and registries** — the contents rarely deserve to survive
  replacement (they describe flights the old generation was managing);
  the generation guard plus fresh state is usually right.

Every global entry is namespaced (one collision-proof prefix for the
application — or better, a key drawn from a process-wide symbol registry,
which makes collision structurally impossible), enumerated in one place
rather than scattered, and — per
[creation-names-reaper](../../_laws.md#creation-names-reaper) — annotated
with what removes it: "process exit" is an acceptable answer, but it must
be *written*, because unowned global entries are where the next
engineer's "is this safe to delete?" investigation goes to die.

Know the boundary of what the global scope buys: it survives **module
re-evaluation within one running process** — nothing more. A full reload
or restart builds a fresh world and every slot with it, and separate
windows are separate worlds that share nothing. State that must outlive
the process is [persistence-and-migration](persistence-and-migration.md)'s
problem; reaching for a process-global to solve a durability problem is a
category error, and the two are confused often enough that the boundary is
worth stating wherever a slot is declared.

## The test-reset hatch

A singleton without an explicit reset function forces every test to
inherit its predecessor's world, and the failures this produces are the
expensive kind: order-dependent, passing in isolation, failing in the full
suite — or worse, *passing* because of leaked state.

Every stateful module-scoped service ships a reset hatch: a function that
returns the module's state to its initial condition — clearing
collections, cancelling timers, releasing resources, bumping the
generation so in-flight callbacks from the previous case go inert. The
hatch is part of the service's contract, written alongside it (the author
is the only one who knows the complete list of what must be reset), and
its existence is not a testing convenience but the falsifiable form of the
claim "I know everything this module owns" — a service whose author cannot
write its reset function has state they have not enumerated.

## Escalation path

Module-scoped mutable state is a budget, not a default. Before minting a
new singleton: state that one view needs belongs to the view; state many
views need belongs in the store, where subscription, inspection, and reset
already exist; a singleton is warranted when the state is too hot for
subscription machinery, bound to an external resource, or must exist
before and independent of any consumer. When one is warranted, it ships
with all three artifacts from day one — generation guard, namespaced
global entry with a named reaper, reset hatch — because each is trivial at
creation and archaeology later.
