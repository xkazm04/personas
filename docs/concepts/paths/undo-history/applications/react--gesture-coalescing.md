---
layer: application
subject: undo-history
technique: gesture-coalescing
stack: react
---

# Tag+window coalescing in the media studio — one drag, one step

The canonical fine-grained undo in this repo is
`src/features/plugins/artist/sub_media_studio/hooks/useMediaStudio.ts`: a
snapshot-model stack (`HistoryState` at `:47-53` — `past` / `present` /
`future` are whole `Composition` values) with coalescing built into the
single mutation door.

## The one door: `commit(tag, recipe)`

Every user mutation goes through `commit` (`:79-100`). The tag vocabulary is
a closed union (`MutationTag`, `:35-42`) — `addItem`, `removeItem`,
`splitItem`, … and crucially `` `updateItem:${string}` ``: the tag carries
the **target's id**, so dragging clip A never merges with dragging clip B.
The merge test (`:84-85`):

```ts
const shouldCoalesce =
  h.lastTag === tag && now - h.lastAt < COALESCE_WINDOW_MS && h.past.length > 0;
```

Same tag + inside a 400ms window (`COALESCE_WINDOW_MS`, `:44`) → the merge
**replaces `present` and pushes nothing** (`:87-89`), exactly the
technique's keep-first-before / replace-latest-after shape: the original
`past` frame from the gesture's first event stays as the undo target, and
the step's memory cost is flat however many pointer-moves merged in. A
coalesced continuation still sets `future: []` — merging is an edit and
truncates redo, per the linear contract.

The gestures feeding it live in `TimelineClip.tsx`: pointer-captured drag
with three modes (`move` / `trim-left` / `trim-right`, `:48`), calling
`onMove`/`onTrimLeft`/`onTrimRight` on every `pointermove` (`:98-115`) →
`updateItem(id, patch)` → `commit(\`updateItem:${id}\`, …)`. Live preview by
continuous mutation, history by coalescing — the render-every-intermediate /
record-endpoints split, achieved with no extra bookkeeping.

## Boundaries the exemplar gets right

- **Undo closes the open step.** `undo` and `redo` reset `lastTag: null,
  lastAt: 0` (`:269-296`), so the gesture after an undo can never merge into
  a pre-undo step.
- **Machine writes mint no steps.** `applyDerived` (`:145-162`) applies
  mechanical patches (beat-anchor resolution) to `present` only — `past`,
  `future`, and the coalescing bookkeeping untouched. The doc comment says
  the quiet part out loud: "Ctrl+Z still reverses the last *user* action
  instead of stepping through machine writes." This is the file the
  undo-scope technique's machine-writes rule was hardened against.
- **Document replacement clears, and names its event.** `replaceComposition`
  (`:113-122`) zeroes the stack "because the prior past/future no longer
  applies to the loaded state" — a legitimate clear with its invalidating
  event stated, per stack policy.
- **Bound + eviction:** `MAX_HISTORY = 80` entries, oldest evicted by
  `past.shift()` (`:90-91`).

## Where it deviates from the technique (deviations, not fixes)

- **No boundary events — the window is the only closer.** `TimelineClip`'s
  `handlePointerUp` ends the drag but tells the history nothing; a step
  closes only by tag change or 400ms of silence. Consequences the technique
  predicts: a mid-drag pause >400ms splits one physical drag into two steps,
  and — because the tag is target-only, not gesture-kind — a *move* followed
  within 400ms by a *trim* of the same clip merges two distinct intentions
  into one step (`updateItem:${id}` is identical for all three drag modes).
  Cheap fix shape if ever wanted: include the drag mode in the tag and close
  the open tag on pointer-up.
- **No step names.** Tags exist but are not surfaced, so undo controls can't
  say "undo trim". The keyboard surface (`useTimelineKeyboard.ts:100-116`,
  Ctrl/Cmd+Z / Shift+Z / Y) and `canUndo`/`canRedo` flags exist; the
  nameable-steps courtesy doesn't yet.
- **Selection is not restored as gesture context.** Selection correctly
  lives outside the history slice (separate `useState`, `:68`), but undo of
  a `removeItem` brings the clip back without reselecting it — the
  selection-as-operand courtesy payload from the undo-scope technique is
  absent.
