---
layer: technique
subject: undo-history
technique: undo-scope
status: forged
laws: [one-validation-door]
shared_with: []
---

# Undo scope

Undo touches a defined slice of state and leaves the rest alone, and the
definition is a design artifact — written down, implemented in one place,
and predictable to the user. The failure mode this technique kills is
*emergent scope*: whatever fields happened to live in the reducer that
grew the undo feature get reverted, whatever lived elsewhere doesn't, and
the boundary is discoverable only by experiment. Emergent scope produces
the two symmetric bugs of the subject — undo that yanks the user's viewport
around (captured too much) and undo that reverts the data while the screen
keeps showing the stale version (captured too little, or restored outside
the render path).

## The dividing line: statements vs stance

The rule that decides most cases: undo reverts what the user **said about
the document**; it does not revert **how the user is looking at it**.

**In scope — document state:** content, structure, arrangement, properties
of the edited artifact; anything that would be different if the document
were saved and reopened.

**Out of scope — view state:** selection, focus, scroll, zoom, panel
layout, expanded/collapsed nodes, active tool, filter and sort views over
the document. Reverting these makes the surface feel haunted — the user
pressed undo to fix the document, and the camera moved.

**Also out — by different reasoning:**

- **Other actors' work.** In any shared or concurrent context, undo means
  *undo my change*, never *undo the latest change*. Reverting a
  collaborator's edit because it happened to land last is not undo; it is
  an edit war with a keyboard shortcut.
- **External effects.** A step that sent a message, wrote a file, or
  triggered a job cannot be reverted by restoring memory. Either the
  effect has a real compensating action the step invokes, or the act is
  honestly irreversible — gated at the act (confirmation, draft/commit
  boundary) rather than falsely covered by undo. An undo that reverts the
  local record of an effect while the effect stands is worse than no undo:
  the document now lies.
- **Ephemeral machinery:** in-flight requests, timers, live handles,
  derived caches. Derived values are recomputed after restore, never
  captured — a captured cache is a stale cache with provenance laundered.

One more boundary runs *through* document state: **machine-originated
writes do not mint steps.** Undo walks user intentions, and a mechanical
patch — derived-value resolution, auto-layout, a reconciliation pass — is
nobody's intention. It mutates the current state without opening a history
entry, so the undo gesture still reverts the last thing the *user* did
instead of stepping through machine bookkeeping; after any restore, the
machinery reruns against the restored state and regenerates its writes.
The implementation consequence: the mutation door distinguishes
user-intent commits (which mint or merge steps) from mechanical applies
(which touch only the present), and every writer declares which it is.

## The exceptions that prove the line

Two view-state cases earn deliberate exceptions:

- **Selection as operand.** When an operation's meaning includes the
  selection (delete *the selected clips*), restoring the document without
  restoring that selection leaves the user unable to re-do their intention
  or even see what came back. The refined rule: **undo restores the
  selection to what it was just before the reverted step**, as a courtesy
  payload carried by the step — not because selection is document state,
  but because it is the context of the reverted intention.
- **Reveal the change.** If the reverted edit is off-screen, undo may
  scroll/navigate *to* it — moving the camera to show the change is
  service; moving it as a side effect of state capture is haunting. The
  distinction is intent: an explicit "reveal restored region" behavior vs
  a viewport that got snapshotted.

Both exceptions are payloads *attached to* steps, not fields *inside* the
captured slice. The slice definition stays clean; the courtesies ride
alongside.

## One slice definition, one restore door

Scope lives in exactly one place: a single definition of the undoable slice
(the capture function in a snapshot model; the reachable-state contract of
the command set in an inverse model). Every step captures through it and
every restore writes through it — one door, enumerable writers
([one-validation-door](../../_laws.md#one-validation-door)). The decay mode
is well known: a new feature adds a field near the undoable state, nobody
classifies it, and it half-joins the scope — captured by the broad snapshot
but also mutated outside the command door, or restored but immediately
overwritten by a subscriber. The discipline is a classification habit:
every field added to the editing state gets an explicit in/out decision at
the door, and the door's definition is the reviewable record of those
decisions.

Restore must also *land* — writing state through a path the rendering
layer observes. A restore that mutates a store the view isn't subscribed
to, or that races a pending async write which then clobbers it, reverts
the data and not the screen (or the screen and not the data). The
sequencing rule: settle or cancel in-flight mutations of the slice before
restoring; restore atomically; let derivation and render flow from the
restored value.

## Multi-surface documents

When several panels edit one document, the document's stack is shared (the
stack-policy technique) — which means undo invoked in panel A may revert a
step made in panel B. That is correct (one intention stream) but must be
legible: the step name says what will be undone ("undo trim"), and the
reveal-the-change courtesy makes the effect visible where it happened. The
alternative — per-panel stacks over one document — creates ordering
paradoxes (two stacks disagree about the document's current state) and is
only defensible when the "panels" are actually editing disjoint slices
with no cross-references; at that point they are separate documents that
happen to share a window, and each owns its scope definition.

Embedded editors (a rich text field inside a larger canvas) follow the
focus-plus-commit seam: while focus is inside, the inner surface's own
fine-grained undo applies to its own slice; on commit/blur, the inner
result becomes one step in the host's stack. The host never reaches into
the embedded micro-history, and escape from the embedded context closes
its open gestures (the gesture-coalescing technique).

## Prohibitions

1. No viewport, scroll, zoom, or layout state restored by undo — reveal
   deliberately, never by capture.
2. No undo of another actor's change in a shared context.
3. No undo of a step with unreversed external effects, unless the step
   carries a real compensating action.
4. No captured derived state — recompute after restore.
5. No second capture/restore path beside the slice definition.
6. No field added to editing state without an explicit in/out-of-scope
   decision.
