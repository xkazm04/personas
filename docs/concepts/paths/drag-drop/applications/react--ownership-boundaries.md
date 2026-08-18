---
layer: application
subject: drag-drop
technique: ownership-boundaries
stack: react
---

# Ownership boundaries in React — the KanbanBoard postures

How this repo realizes commit / request / display-only on one board
primitive, and where the realization stops short of the standard.

## Display-only lanes, expressed as data

`src/features/shared/components/kanban/KanbanBoard.tsx` encodes the posture
per column, exactly as the technique prescribes ("the posture is data the
surface consumes"):

```ts
export interface KanbanColumn {
  // ...
  /** Status applied when an item is dropped here. Omit to make the column a
   *  display-only (non-drop) lane. */
  targetStatus?: string;
}
```

A column without `targetStatus` — or a board without `onItemMove` — is a
**display-only lane** (`droppable = !!column.targetStatus && !!onItemMove`,
`KanbanBoard.tsx:131`). The docstring names the intended use: "boards whose
status is owned by a backend orchestrator and only *some* transitions are
user-driven." Mixed boards are the norm, and here they cost a prop, not a
fork of the component.

The affordance side holds up too: `onDragOver` returns early for
non-droppable columns (`:96-97`), so a display-only lane never lights as a
target — non-droppability is legible during the drag, not discovered at
release.

## The drop is a statement about identities

The move callback is `onItemMove?: (itemId: string, targetStatus: string)`
(`:40`) — an id and a vocabulary value. **An index cannot be expressed in
this signature**, which is what makes the board safe over filtered and
concurrently-refreshed item arrays. The drop handler (`:108-123`) re-reads
the id from `e.dataTransfer.getData(dragMimeType)` rather than trusting the
local `draggingId` — the payload authorizes the drop — and bails on a
self-drop by checking the item's current bucket.

Payload typing is per-board: `dragMimeType` defaults to
`'application/x-personas-kanban-id'` (`:60`) and `onDragOver` gates on
`e.dataTransfer.types.includes(dragMimeType)` *before* `preventDefault()`
(`:97-98`), so a card from board A is inert over board B and an OS file is
inert over both.

## Where it stops short: the request posture has no pending state

`KanbanBoard.tsx:122` fires the move as `void onItemMove(id, targetStatus)`
— the promise is discarded. Its consumer (`GoalKanban.handleMove`) catches
a failure into a toast, and the card silently stays in its old lane. Under
the technique's taxonomy this wires a *request*-shaped drop (the status
write can fail; an authority answers) as if it were a *commit*: no pending
treatment while the round trip is in flight, no visible return on
rejection — the "silent snap-back" the technique tells you to kill in
review. The fix direction is mechanical: keep the promise, mark the card
provisional (the `renderCard` contract already receives per-card state) and
resolve it on the authority's answer.

## The backend half of the boundary

The persisted-reorder stack under `src-tauri/db/src/repos/dev_tools.rs`
(`reorder_goals` at `:861` and siblings) shows the authority's door built
without atomicity: N per-row `conn.execute` updates, no transaction — a
mid-loop failure persists a sequence that is neither old nor new (executed
proof and the census rule `unatomic-sequence-rewrite` live in
`docs/concepts/golden-paths/drag-reorder.md` §7-A/§9). The one validation
door is only worth having if what is behind it is atomic; a repo adopting
this application should route sequence rewrites through
`Connection::transaction()` or a fractional rank.
