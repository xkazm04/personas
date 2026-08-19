---
layer: golden-path
subject: drag-drop
status: forged
techniques:
  - drag-lifecycle
  - payload-and-identity
  - drop-affordances
  - ownership-boundaries
  - keyboard-alternatives
  - cross-surface-handoff
evidence:
  - src/features/shared/components/kanban/KanbanBoard.tsx            # ownership-boundary exemplar: display-only lanes when status is backend-owned; id+status drop signature; typed drag payload gating
  - src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx  # the reference complete reorder: id in payload, refuse-before-accept, persist once, persisted order treated as untrusted
  - src/features/teams/sub_mastermind/lib/useIslandDrag.ts           # lifecycle contract: pointer capture, 4px click-vs-drag threshold, one commit on release, cancel on gesture loss
  - src/features/shared/components/display/DropIndicator.tsx         # position preview: one gliding indicator per list, reduced-motion aware
  - src/features/plugins/artist/sub_blender/ReferenceBoard.tsx       # cross-surface receiver: private typed payload, copy semantics, inspect-before-accept
counter_evidence:
  - src/features/plugins/artist/sub_blender/ReferenceBoard.tsx       # same file, reorder half: index-shaped onReorder(toIndex) discards the dragged identity — every reorder drag is a silent no-op
deviations:
  - w7-drag-drop   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Drag & drop

Drag & drop is the interaction you reach for when the user's job is **spatial
placement**: expressing *where something goes* — a position in an order, a lane
on a board, a slot on a timeline, a container in a hierarchy — by carrying it
there. It compresses a three-step verbal operation (select the thing, choose
the operation, choose the destination) into one continuous gesture, and that
compression is the entire value. When the destination is not naturally spatial,
the compression buys nothing and the gesture is theater.

That definition decides when *not* to use it:

- **A "move to…" or "send to…" command** when there is one item and a small,
  nameable set of destinations. Picking a name from a menu is faster, more
  precise, and works everywhere a pointer does not. Drag earns its keep when
  the destination is a *position among peers*, not a label.
- **Explicit ordering controls** (move up/down, "set position") when the list
  is long and the precision requirement is high. Dragging across three screens
  of scrolling content is one of the most hostile gestures in interface work;
  if users routinely need to move item 4 to slot 180, the drag is the wrong
  primary instrument.
- **Nothing at all as the sole path.** Drag & drop is an *accelerator*, never
  the only route to an operation. It is invisible (nothing on screen says "you
  can drag this" until affordances say it), it is pointer-biased, and it is
  hard for anyone with limited motor precision. Every drop must have a
  non-drag equivalent — see [keyboard-alternatives](techniques/keyboard-alternatives.md),
  which is part of the feature, not a compliance appendix.
- **Beware of it on touch-primary surfaces**, where a sustained drag fights
  the scroll gesture for the same finger. If the surface is mostly consumed on
  touch, the activation design (long-press, explicit handles) is a first-class
  requirement, not a port-time patch.

## Drag & drop is a mode

The single most important structural fact: a drag is a **mode** — a sustained
state the interface enters, holds, and must exit through exactly one of two
doors, *commit* or *cancel*. The lifecycle is explicit:

> armed → dragging → over-target → **dropped** | **cancelled**

Half the defects in shipped drag implementations are missing exits and
un-swept residue: the escape key that does nothing mid-drag, the drop outside
any target that leaves an item visually detached, the highlight that stays lit
on a lane after the pointer left, the auto-scroll that keeps scrolling after
the drop. Modes are where interfaces rot, because every entry path must be
matched by exit paths *for every way the mode can end* — including the ways
the developer did not intend (focus loss, an interrupting dialog, the dragged
item being deleted by someone else mid-flight). The full state machine, the
activation thresholds that keep clicks from becoming accidental drags, and
cleanup as a named, single-owner concern are the
[drag-lifecycle](techniques/drag-lifecycle.md) technique.

## Identity travels, position does not

What moves through a drag is a **payload**, and the payload carries the
entity's *identity* — never its index, never its coordinates, never its
display label. Everything a drop ultimately means ("put record X after record
Y", "assign item X to lane L") is a statement about identities; positions are
merely how those identities were arranged at the moment the drag began, and
that arrangement is already stale by drop time. Lists get appended to by other
actors, filters change what is visible, sorts reorder — a drop expressed as
"move index 3 to index 7" lands on the wrong records the moment anything moved
underneath it. Reordering is precisely the operation positional identity does
not survive.

Typed payloads, id-anchored drop semantics, and optimistic reordering that
reconciles against the authority's answer are the
[payload-and-identity](techniques/payload-and-identity.md) technique. The same
identity discipline that keeps a [table](../table/table.md)'s selection stable
under resort is what keeps a drop meaning what the user saw.

## Affordances carry the interaction

Drag & drop has no persistent chrome — the interaction *is* its feedback, and
each lifecycle stage owes the user an answer to a question:

- **Before the drag:** *what here is draggable?* Draggable things look
  grabbable — a handle, a cursor change, a lift response on press. An
  undiscoverable drag feature does not exist.
- **During the drag:** *what would happen right now?* Valid targets announce
  themselves the moment the drag starts; the target under the pointer
  distinguishes itself from the merely-valid; the exact outcome — the
  insertion position, the receiving container — is previewed continuously.
- **On invalid ground:** *why not?* Invalid targets communicate refusal
  visibly rather than sitting inert and letting the drop fail silently.
- **After the drop:** *did it take?* The item settles into its destination
  visibly; a rejected or failed drop returns home in a way that reads as
  "returned", not "glitched".

The vocabulary of indicators, highlights, previews, ghosts, and edge
auto-scroll is the [drop-affordances](techniques/drop-affordances.md)
technique.

## A drop is a statement — but who gets to make it true?

Every drop asserts a new arrangement of the world. The design question a
principal engineer asks before any of the visuals: **which tier owns the
arrangement being changed?**

- When the *interface* owns the order (a personal layout, a local
  arrangement), the drop is a **commit**: apply it immediately, persist it
  behind the gesture.
- When a *backend authority* owns the placement — a status that drives
  automation, an assignment with side effects, an order other users share —
  the drop is a **request**. The interface previews, submits, and reconciles;
  it does not pretend the world changed because a pointer was released. In the
  strictest form the surface is **display-only**: it renders the
  authority-owned arrangement and offers no drag at all, because a gesture
  that silently lies about its effect is worse than no gesture.

Getting this wrong in either direction is expensive: treating a request as a
commit produces phantom state that snaps back seconds later and teaches users
the board lies; treating a commit as a request adds latency and failure modes
to an operation that had neither. The decision procedure, the request/commit
drop protocols, and rejection handling live in
[ownership-boundaries](techniques/ownership-boundaries.md).

## The same operation, without the pointer

Everything a drag can do — pick up, move through candidate positions, drop,
cancel — must be operable from the keyboard and legible to assistive
technology, with state changes *announced*, not just drawn: "grabbed",
"moved to position 4 of 9", "dropped", "cancelled". This is not a parallel
feature bolted on afterward; it is the proof that the drag was designed as an
*operation with a gesture on top* rather than a gesture with no operation
underneath. Designs that fail the keyboard test usually turn out to have no
articulable operation at all — which is the deeper defect. The grab/move/drop
model and the announcement contract are the
[keyboard-alternatives](techniques/keyboard-alternatives.md) technique.

## Crossing surfaces

The hardest drags are the ones that leave home: from a browsing panel onto a
composition surface, from one tool region into another with different
coordinate systems, different owners, and different ideas of what a payload
is. Cross-surface drops need a negotiated payload contract (the source
declares what it is carrying; the target declares what it accepts), explicit
copy-versus-move semantics, and dwell behaviors (hover-to-open a folder or
tab) whose timers are created and destroyed with the discipline of any other
mode resource. That is the
[cross-surface-handoff](techniques/cross-surface-handoff.md) technique.

## The techniques

- [drag-lifecycle](techniques/drag-lifecycle.md) — the state machine:
  activation thresholds, every cancel path, cleanup as a named reaper.
- [payload-and-identity](techniques/payload-and-identity.md) — typed payloads,
  id-anchored drops, optimistic reorder with reconciliation.
- [drop-affordances](techniques/drop-affordances.md) — grabbability, target
  announcement, position preview, refusal, settle.
- [ownership-boundaries](techniques/ownership-boundaries.md) — commit vs
  request drops; display-only surfaces when the authority is elsewhere.
- [keyboard-alternatives](techniques/keyboard-alternatives.md) — grab/move/drop
  without a pointer; the announcement contract.
- [cross-surface-handoff](techniques/cross-surface-handoff.md) — payload
  negotiation across panels, copy-vs-move, dwell-to-open.
