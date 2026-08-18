---
layer: application
subject: drag-drop
technique: drop-affordances
stack: react
---

# Drop affordances in React — the shared affordance kit

This repo ships the affordance vocabulary as three catalogued primitives
plus global drag chrome. Import them; the #1 drift source in this area is
re-painting one of these by hand.

## Grabbability: `DragHandle`

`src/features/shared/components/display/DragHandle.tsx` — the grip icon
(`GripVertical`), hover-revealed inside a `group` row (`reveal='hover'`) or
always visible, `cursor-grab`/`active:cursor-grabbing`, localized
`aria-label`, reduced-motion safe. Spread `draggable` + `onDragStart` onto
it for HTML5 drag. **Known deviation** (measured in Chromium,
`docs/concepts/golden-paths/drag-reorder.md` §7-C): it renders
`role="button"` with **no `tabIndex`**, so assistive technology announces a
control that cannot be reached — the false affordance the
keyboard-alternatives technique bans. Until fixed at the primitive, callers
must pass `tabIndex={0}` and a key handler themselves.

## Position preview: `DropIndicator`

`src/features/shared/components/display/DropIndicator.tsx` — the 2px
primary bar that glides between gaps via a framer-motion shared `layoutId`,
snapping instead of sliding under `prefers-reduced-motion`. The contract is
in its docstring and it is exactly the technique's "one indicator, at the
true gap": **render exactly one per list, every gap using the SAME
`layoutId`**, so the layout engine tweens a single line between positions.

The cautionary consumer: `SchemaFieldBuilder.tsx:82-84` renders one
indicator *per row* with a *unique* `layoutId` each
(`layoutId={\`schema-field-drop-${index}\`}`) — producing N static lines
and never the glide. The same file keys its drag lift by array index
(`draggingIndex`), which decorates the wrong row once the reorder fires
mid-gesture. Both are the positional-identity bug arriving in the
affordance layer.

## Target announcement: `DropZoneGlow` and lane highlighting

`src/features/shared/components/feedback/DropZoneGlow.tsx` — the layered
"this region accepts your drop" overlay: scaled outer ring + glow, dashed
marching border (march disabled under reduced motion via `globals.css`),
centered label chip. Render it inside a `position: relative` drop region,
driven by an `active` flag the drag-over handlers own.

For lane-grade highlighting, `KanbanBoard.tsx:173` shows the lighter
treatment: the drop-target column gets `ring-2` + a 1.005 scale, cleared on
`dragLeave` with a `relatedTarget` containment check (`:103-106`) so
child-element churn doesn't flicker the highlight — and cleared again in
`onDrop` *and* `onDragEnd`, because a successful cross-column drop unmounts
the source card before its native `dragend` fires (`:111-114`, the comment
is the bug report). Container-level "a drag is in flight" chrome exists as
`.drop-zone-illuminated` + `body[data-drag-active]` (`globals.css:1495-1512`)
— do not invent a parallel body class.

## The origin trace and the in-hand treatment

`KanbanBoard.tsx:156` applies `opacity-40 cursor-grabbing` to the dragged
card — the dimmed-origin trace the technique asks for — keyed by *id*
(`draggingId === id`), not index, so the treatment survives list churn
mid-drag.

## What does not exist yet

No shared edge auto-scroll helper and no shared refusal treatment for
"target that refuses this payload" (invalid targets today are simply
unlit — *not a target* and *refuses this payload* render identically,
which the technique calls out as hiding the rule from the user). Building
either belongs in `shared/components/`, tagged `@catalog`, not in a
feature folder.
