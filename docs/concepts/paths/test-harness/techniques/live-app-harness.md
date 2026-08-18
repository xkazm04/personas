---
layer: technique
subject: test-harness
technique: live-app-harness
status: forged
laws: [gate-sees-target, failure-not-empty-success, identity-survives-reuse]
shared_with: []
---

# Live-app harness

Some truths are only visible in the assembled, running product: that the
packaged process starts at all, that the startup sequence initializes its
singletons in a working order, that the boundary between interface and engine
actually carries the messages the code claims it does, that a user-shaped
sequence of actions lands in a user-visible result. Below this rung every
suite exercises code *as the test imports it*; this lane exercises the product
*as it ships* ([_laws: gate-sees-target_](../../_laws.md#gate-sees-target)).
That fidelity is the entire budget justification — the lane is slow, serial,
and worth it, provided it only carries claims nothing cheaper can witness.

## The control surface

Driving the real product needs a door, and the door is designed, not
improvised:

- **A test-only control endpoint**, compiled or enabled exclusively in test
  builds, listening on a local port. It exposes a small command vocabulary —
  navigate here, invoke this action, read this state, evaluate this probe —
  and the production build provably does not contain it. The gate between
  "test build" and "shipped build" is a build-time feature switch, never a
  runtime flag a customer could discover.
- **Typed on both sides.** The harness speaks to the endpoint through a typed
  client whose request and response shapes are shared with the product's
  implementation. An untyped control channel decays into stringly folklore
  within a quarter.
- **Commands are product-level, not pixel-level.** "Open the settings surface"
  beats "click at coordinates" — the former survives redesign, the latter
  certifies a screenshot.

## The serial law

When the product is structurally a singleton — one instance per machine
because of an exclusive port, a single data directory, an exclusive handle on
a system secret store — the live lane is **serial by law of the product**.
Write that into the lane's configuration as a stated property with the reason
attached, so nobody "optimizes" it into parallel flake. The corollary: test
independence must come from *state reset between tests* (see
[isolation-lanes](isolation-lanes.md)), not from parallel isolation, because
there is no parallel. Serial also means the lane's total runtime grows
linearly with its test count — which is the standing argument for keeping the
lane's population small and its claims exclusive to this rung.

## Readback for fire-and-forget

Control surfaces often include operations that dispatch and return
immediately — an evaluation queued into the interface's own event loop, an
action whose effect lands asynchronously. The naive harness reads the
immediate response and learns nothing; the broken harness treats "no error"
as success, which is exactly the empty-success lie
([_laws: failure-not-empty-success_](../../_laws.md#failure-not-empty-success)).

The pattern is **stash and read back**: the dispatched operation writes its
result into a location the control surface can later query — a designated
node in the running interface's own tree, a well-known key in application
state — and the harness polls that location with a deadline. Three
distinguishable outcomes, all spelled differently: the stash appears with a
result (pass or fail on the content), the stash appears empty (the operation
ran and produced nothing — a finding), the deadline expires with no stash
(the operation never ran — a harness failure, reported as such and never as a
mere test failure).

## The test-identifier contract

The harness locates interface elements through **stable identifiers
maintained in the product code** — attributes whose only purpose is to be
found. Treat this set as a published API of the product toward its harness:

- Identifiers name the element's *role in the product* — "the save action on
  the editor" — not its appearance or position, so they survive restyling and
  reordering ([_laws: identity-survives-reuse_](../../_laws.md#identity-survives-reuse)).
- For repeated elements (rows, cards, list entries), the identifier composes
  the role with the entity's own stable id, never with its index.
- Renaming or removing one is a breaking change to the harness and is made
  *with* the harness — the change and the tests move in one unit. An
  identifier that "nothing seems to use" is checked against the harness
  before deletion, because the harness is precisely the consumer that does
  not appear in the product's own reference search.

## What this lane refuses to carry

Discipline about the population keeps the lane alive. It does not re-verify
logic a unit test can see, does not enumerate input matrices (one
representative journey per flow), and does not judge non-deterministic model
output — that is the eval-harness subject, with its own judging machinery.
The live lane's question is always the same: *does the assembled product,
driven the way a user drives it, do the thing?* Every test that cannot phrase
its claim in that sentence belongs on a cheaper rung.
