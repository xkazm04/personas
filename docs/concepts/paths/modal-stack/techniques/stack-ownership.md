---
layer: technique
subject: modal-stack
technique: stack-ownership
status: forged
laws: [one-validation-door, creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Stack ownership

Open overlays form an ordered stack whether the code admits it or not. This
technique is the admission: one owned data structure, one door for opening and
closing, and every downstream behavior — input routing, dismissal scoping,
focus containment, layering — expressed as a query against it.

## The scattered form, and why it always fails the same way

The default evolution is one `is-open` boolean per surface, each owned by
whoever happened to render it. This is not a smaller version of the stack; it
is the stack with its ordering deleted. The information "A is above B" exists
only in paint order, so every behavior that depends on ordering is computed
wrong:

- Escape handlers all fire at once — three layers close on one press, or the
  bottom one closes first because it subscribed first.
- Outside-click handlers cannot tell "inside my child overlay" from "outside
  everything", so clicking a nested menu kills its parent dialog.
- Two surfaces both believe they own focus; the trap thrashes.
- "Close everything" and "what is open?" have no single answer — each caller
  walks its private list of booleans, and the list added next quarter is
  missed by all of them.

Scattered booleans also scatter the *policies*: each surface re-implements
dismissal, layering, and containment from scratch, and they diverge.

## The owned form

One structure, at application scope, holding an ordered list of typed entries:

```
entry:
  id          — minted at push, unique for this entry's lifetime
  kind        — which overlay this is (a closed vocabulary of surfaces)
  payload     — the parameters that instance needs
  policy      — dismissal flags, modality, layer band (defaulted by kind)

stack: [bottom … top]
push(kind, payload) -> id
pop(id | top)       -> resolution
replace(id, …), clear(reason)
```

Rules that make it a standard rather than a convenience:

- **One door.** Every open and every close goes through push/pop — the
  keyboard handler, the outside-click judge, the navigation guard, the
  programmatic completion, all of them. A surface that toggles its own local
  boolean has left the stack and re-created the scattered form; the door is
  where policy (guards, telemetry, focus bookkeeping) attaches, and a second
  door is where it leaks.
- **Entries carry identity, not position.** `pop(id)` — never "pop index 2".
  Entries close out of order (a background task completes and retires its own
  dialog while a popover sits above it), stacks reorder as guards insert
  themselves, and exit animations hold dead entries briefly while new ones
  arrive. Positional references corrupt under exactly these operations;
  identity survives them.
- **The top owns input.** Exactly one entry — the topmost — receives escape,
  traps focus, and judges outside clicks. Everything beneath is rendered but
  suspended. This single rule replaces the entire class of "which handler
  wins" negotiations.
- **Render is a fold.** The visual output is a map over the stack in order,
  each entry rendered by its kind at its band. Nothing renders an overlay
  outside the fold; if it is not in the stack, it is not on screen — which is
  what makes "what is open" answerable at all.

**The registry variant.** In architectures where overlays are rendered by
scattered owners and cannot be folded from one place, the minimum viable form
of this technique is a central **registry**: every overlay joins on open and
leaves on close, and the registry alone answers ordering — depth, total,
"am I topmost". This preserves the two behaviors that matter most (input
routing and layer ordering) at a real cost: if entries carry only their
position and not their kind, nothing *outside* an overlay can ask "is any
modal open?" or "what is on top?", and every neighboring system (toasts,
tours, command surfaces) ends up negotiating precedence blind. If the
registry form is chosen, give entries enough identity to be queried by
strangers — and it must still be the *only* authority; an overlay that skips
registration is invisible to every rule the registry enforces, which is the
scattered form returning one surface at a time.

## Sub-modals: nesting is pushing

An overlay that opens another overlay — a dialog spawning a picker, a form
spawning a confirmation — does not embed it, own its state, or render it
inline. It **pushes**, and the stack's ordinary rules take over: the child is
now topmost, owns input, and its dismissal pops back to the parent, which has
been suspended-in-place with its state intact.

Two disciplines keep nesting sane:

- **Depth is a smell past two.** Dialog → confirmation is routine; dialog →
  dialog → dialog means a workflow is being smuggled through a modal chain
  and wants to be a page.
- **The parent must not be able to close beneath its child.** Close requests
  addressed to a non-top entry either cascade (pop the children first, each
  honoring its own guards) or are refused; silently deleting the middle of
  the stack strands the layers above it over a surface that no longer exists.

## Results flow to the pusher

A pushed overlay is very often a question — pick one, confirm, enter a value.
The push returns a handle the caller can await; the pop carries the
resolution (completed-with-value, cancelled, dismissed). This keeps the asking
site linear — push, await, act — instead of scattering the continuation into
callbacks stored beside the scattered booleans the stack just replaced. The
distinct resolution kinds are the dismissal technique's contract.

## Lifecycle: the stack names its reaper

Every entry answers "what removes me?" at push time:

- **User dismissal** under the entry's declared policy.
- **Programmatic completion** by the flow that pushed it.
- **Navigation.** Leaving the context that pushed an overlay clears the
  overlay — a route change with a dialog still standing produces the ghost
  modal over the wrong page. The stack subscribes to navigation once,
  centrally; individual surfaces never each guess.
- **Owner death.** If the entity an overlay is about is deleted or unloaded
  out from under it, the overlay retires with an explanation, not a crash and
  not a silent freeze.

Exit animation is part of the lifecycle: an entry leaving the stack may hold a
brief *leaving* state so its exit can play, but a leaving entry no longer owns
input — input authority transfers at pop, not at animation end.

## What this technique refuses

- A second stack. One application, one overlay stack. A feature that brings
  its own private stack re-creates the two-strangers problem one level up.
- Booleans that bypass the door "just for this simple one". The simple one is
  where the divergence starts.
- Position-addressed operations (`close the second dialog`) in any public
  surface of the structure.
