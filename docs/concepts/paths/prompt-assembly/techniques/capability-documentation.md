---
layer: technique
subject: prompt-assembly
technique: capability-documentation
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Capability documentation

The capability layer is where the model learns what it may do: the
operations it can emit, their arguments, their effects, and when each one
is the right move. It is also the layer with the strangest failure mode in
the subject — a model fluently invoking operations that do not exist —
and that failure has a single cause: the documentation and the dispatcher
learned about capabilities from different places.

## Derived from the registry, never hand-written

Somewhere in the system there is a registry — the structure the dispatcher
consults when the model emits an operation. That registry is the one
authority for the capability vocabulary, per
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary),
and the prompt's capability section is **rendered from it**: the renderer
walks the live registry and emits one documented entry per registered
operation. Nothing is documented that is not registered; nothing is
registered that is not documented — not because anyone remembers to keep
two texts aligned, but because there is only one source.

Hand-written capability prose is the two-copies race in its most expensive
form. The copies drift in both directions, and each direction has its own
signature: an operation added to the registry but not the prose is
invisible — paid for, dispatchable, never invoked. An operation described
in the prose but gone from the registry is worse — the model emits it,
confidently and correctly *per its instructions*, and the dispatcher
rejects a call the prompt explicitly taught. The model is not
hallucinating; it is obeying stale documentation. No amount of model
quality fixes a vocabulary with two authorities.

## Doctrine mentions are part of the same vocabulary

Registry-derived rendering closes the main door but not the side one:
authored prose elsewhere in the prompt — policy text, procedural doctrine,
examples — also names operations ("when the state changes, refresh the
view using…"). Those mentions are consumers of the same vocabulary, and
they drift the same way. The discipline is a **sync check**: extract every
operation name that authored prose mentions, and assert each resolves in
the registry — and, where the doctrine claims to enumerate ("the available
views are…"), assert the enumeration is complete. The check runs where
drift is introduced (tests, or load-time assertion), so a renamed
operation fails a gate instead of shipping as a phantom instruction.

## Each entry documents a contract, at budgeted depth

An entry is not a signature dump. The model chooses operations by purpose,
so each entry carries: what the operation is *for* (the situation that
calls for it, including when a neighboring operation is the better
choice), its arguments with the constraints that matter, what it returns
or effects, and its notable failure shapes. Exemplars earn their tokens
only for operations with tricky argument shapes — one compact, correct
example each; galleries are budget leaks.

Depth is a budget decision coordinated with the context-budgeting ladder:
the roster of operation names and one-line purposes is the floor
(dispatchability requires at least that), extended detail is elastic, and
the overflow move is the standard one — heavy per-operation documentation
goes behind a pointer the model can pull on demand, keeping the standing
cost to the index line.

## Render what is active, not what exists

Sessions differ: feature gates, permissions, connected integrations, and
modes all change which registered operations are *actually invocable
right now*. The renderer takes the registry filtered to the active set —
documenting an operation the dispatcher will refuse in this session is
stale-prose drift reproduced at runtime, teaching the model a move it
will be punished for making. Two corollaries:

- The **active set is part of the prompt's identity**: it belongs in the
  assembly fingerprint, so a session opened before a capability was
  granted or revoked reads as stale and gets rebuilt rather than running
  on a roster that no longer matches its dispatcher.
- Deliberate omission is not filtering's cousin: hiding a *registered,
  active* operation to discourage its use leaves the dispatcher accepting
  what the prompt never taught — the inverse drift signature. Restrict at
  the registry (deactivate), and let the prompt reflect it.

Where capabilities are served to the model through a standardized tool
interface, the roster, schemas, and description discipline are the ground
of [mcp-tools](../../mcp-tools/mcp-tools.md); this technique is the
general rule those interfaces instantiate — however the operations reach
the model, their documentation is derived, synced, budgeted, and filtered
to what is real.
