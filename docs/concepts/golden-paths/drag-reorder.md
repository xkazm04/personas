# Golden path — Drag reorder

> Situation node: `ui-system/chrome-and-feedback/drag-reorder` · recurrence 42 ·
> `twoSided: true`, `fusedAcrossSides: true` · dimensions: **ui · function ·
> resilience · code-quality** · [situation spine](../situation-spine.md)
>
> Composed 2026-08-15 against `master` @ `5108ff978`. Sweep: **4,829 `.ts`/`.tsx`**
> and **963 `.rs`** files (corpus totals cited from
> [`shared-facts.json`](../shared-facts.json), not re-derived), classified by
> **two independent implementations** that were reconciled against each other and
> whose disagreement is reported below; **four executed experiments** — a
> five-arm SQLite reproduction of this repo's own reorder loop, a tie-break
> disproof run, a real-Chromium accessibility probe, and a verbatim replay of the
> mood-board reorder path; a **convergence census of two sibling repos**
> (`personas-web`, `brainiac/console`); and full reads of `KanbanBoard`,
> `DragHandle`, `DropIndicator`, `DataGrid`, `SchemaFieldBuilder`,
> `ReferenceBoard`, `GoalKanban`, `ProjectOverviewPage`, `NoteLayer`,
> `GroupLayer`, `useIslandDrag`, `artistSlice`, `devTools.rs`, the census engine
> and all 84 census rules.
>
> **Settles:** how the user picks an item up, where it may be dropped, what is
> written when it lands, what happens when that write fails, and how anyone who
> is not holding a mouse performs the same operation.
>
> **Sibling leaves, read them for their halves.** The seam is settled in prose at
> [§0](#0-boundaries). [`tables.md`](./tables.md) owns the row surface a drag
> happens *inside*. [`post-write-side-effects.md`](./post-write-side-effects.md)
> owns what must happen after the order commits.
> [`transaction-boundary.md`](./transaction-boundary.md) owns the handle the
> rewrite runs on. [`filtering-and-search.md`](./filtering-and-search.md) owns the
> narrowed array a drag lands in. [`focus-management.md`](./focus-management.md)
> owns where focus goes; this path owns whether the operation is reachable at all.
>
> **§7 Deviations is a fix backlog.** Every entry carries a path and a defect.

---

## 0. Boundaries

This path owns **the change of an item's position in an ordered collection, and
the persistence of that change** — the affordance, the drop target, the write,
and the failure. It owns both sides: the gesture and the `ORDER BY`.

It does **not** own:

- **File drop zones.** Dragging an OS file *into* the app changes no order.
  `IngestDropZone`, `N8nUploadStep`, `DesignInput`, `DriveToolbar`, `DrivePage`
  are that; they belong to whatever ingests the file. The one thing this path
  says about them is in [§5](#5-anti-patterns): a drop zone that accepts anything
  will also accept your reorder payload.
- **Card-swipe gestures.** `TriageCard` and `SwipeCard` use framer `drag="x"` to
  *dismiss*, not to *reorder*. No position is written.
- **Resize and scrub handles.** `ColumnResize`, the timeline playhead, the trim
  edges of `TimelineClip` move a boundary, not an item's rank.
- **Window drag.** `TitleBar`'s `data-tauri-drag-region` is OS chrome.
- **The row surface itself.** If you are choosing between `UnifiedTable` and
  `DataGrid`, that is `tables.md`. Come back here once you have the row.

Free canvas positioning (`x`/`y` on a plane, no rank) sits at the edge. It is
included, because every correctness question is the same one — identity vs index,
commit-once-on-release, what a cancelled drag persists — and because the repo's
single best implementation of those lives there.

---

## 1. Trigger

- "Let the user drag these into their own order" / "make this list sortable by hand"
- "Add a kanban board" / "drag the card to another column"
- "The user should be able to prioritise the checklist"
- "Persist the order they arranged" / "why did my order come back different?"
- "Drag the tile / node / clip / note to move it"

If you are about to type `draggable`, `onDragStart`, `dataTransfer.setData`,
`setPointerCapture`, `<Reorder.Group>`, `order_index`, `sort_order`,
`SET position =`, or `splice(from, 1)` followed by `splice(to, 0, …)` — you are
in this situation.

---

## 2. The one way

**Move by identity, write once, and ship a keyboard path in the same change.**
Concretely: give the collection a stable id per item; carry **that id** in the
drag payload under a private MIME type (`application/x-personas-<thing>`) and
gate every `onDragOver`/`onDrop` on `dataTransfer.types.includes(MIME)` so a
foreign drag, an OS file, or a stale local flag can never move anything; compute
the new order as a **whole array** by id and hand the *whole array* — never a
bare index — to the thing that persists it. Persist exactly once, on drop, not
per frame. If the destination is local (component state, `localStorage`, a JSON
blob on a form the user has not saved yet), a synchronous write is the end of the
story and there is nothing to roll back. If the destination is SQLite, send the
full id sequence to **one** command that rewrites it **inside one transaction**,
and re-fetch — do **not** patch the list optimistically, because a reorder that
half-commits leaves a sequence that is neither the old one nor the new one and
your rollback snapshot is a lie. Then, before you call it done: add the non-drag
path. A `role="button"` grip with no `tabIndex` is not a keyboard path; an
`aria-label` is not a keyboard path. **Native HTML5 drag has no keyboard entry
point at all** — measured, [§8](#8-gaps) — so the keyboard path is a *second
control*: an explicit move-up/move-down pair or arrow keys on a focused row, both
calling the same reorder function, with an `aria-live` region announcing the
result. Prefer HTML5 drag for lists and boards; prefer pointer capture
(`useIslandDrag`'s shape) for a free canvas; use framer `Reorder` only when you
want its animation and own the array locally.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `shared/components/kanban/KanbanBoard` | The whole cross-bucket board: drag state, drop-zone highlight, per-column bucketing, MIME gating, self-drop rejection, and the `dragend`-never-fires unmount fix. `onItemMove(itemId, targetStatus)` — **it cannot express an index**, which is why it is safe over a filtered array. |
| `shared/components/display/DragHandle` | The grip affordance (`GripVertical`, hover-reveal, `cursor-grab`/`grabbing`, reduced-motion safe). **Visual only** — see [§7-C](#c-the-affordance-that-announces-a-control-nobody-can-reach); you must add `tabIndex` yourself until it is fixed. |
| `shared/components/display/DropIndicator` | The 2px line that glides between gaps via a shared `layoutId`. **Render exactly ONE per list, with the SAME `layoutId`,** at the gap the item would land in. |
| `shared/components/feedback/DropZoneGlow` | Dashed marching border + label for a drop *target* region. Reduced-motion handled in `globals.css:1512-1516`. |
| `.drop-zone-illuminated` + `body[data-drag-active]` (`globals.css:1495-1512`) | Container-level "a drag is in flight" chrome and the global grabbing cursor. |
| `teams/sub_mastermind/lib/useIslandDrag` | The pointer-drag contract, done right: pointer capture, a 4px travel threshold that separates a click from a drag, an imperative transform during the drag so the world does not re-render, `useLayoutEffect` re-assertion against a mid-drag reconcile, and **one** commit on release. Feature-local today; [§7-F](#f-five-implementations-of-one-pointer-drag-in-one-directory) says extract it. |
| `api/devTools/devTools.ts` `reorderGoals` / `reorderGoalItems` / `reorderContextGroups` → `dev_tools_reorder_*` | The persisted-reorder contract: a **full id sequence**, not a pair of indices. The right shape; see [§7-A](#a-the-entire-persisted-reorder-stack-is-unreachable-and-two-thirds-of-it-could-not-work) for why none of it currently runs. |

**Do not reach for `@dnd-kit`.** It is declared at `package.json:105`
(`@dnd-kit/core ^6.3.1`), installed in `node_modules`, and **imported zero times
in the entire repo**. Adding the first import is a decision to introduce a fourth
drag mechanism, not a convergence on an existing one.

---

## 4. Steps

1. **Give every item a stable id** that survives a re-render, an edit, and a
   refetch. `SchemaFieldBuilder.tsx:10-12` is the note to copy: a client-side
   `id: crypto.randomUUID()` that is *never serialized*, precisely so the React
   key stays stable while the user types into the mutable `key` field.
2. **Decide where the order lives before you write any JSX.** Component state,
   `localStorage`, a JSON blob on an unsaved form, or a SQLite column. This
   decides everything below, and it is the question this repo most often skips —
   all three of its live reorders picked a different answer and none picked SQLite.
3. **Pick the mechanism.** List or board → native HTML5 drag. Free canvas → pointer
   capture. Locally-owned array where you want the animation → framer `Reorder`.
4. **Declare a private MIME** — `const X_MIME = 'application/x-personas-<thing>'`.
   One per draggable *type*, so a card from board A is inert over board B.
5. **On `dragstart`, put the ITEM'S ID in the payload** (`setData(X_MIME, id)`)
   and set `effectAllowed = 'move'`. Set a local `draggingId` for the visual
   treatment only. Never let that local flag be the thing that authorises a drop:
   `ProjectOverviewPage.tsx:171-179` explains why in eight lines of comment, and
   it is right — if `dragend` never fires (the pointer leaves the window, a
   re-render intervenes) a stale flag will authorise a drop from a drag you never
   started.
6. **On `dragover`, refuse first.** `if (!e.dataTransfer.types.includes(X_MIME)) return;`
   *then* `e.preventDefault()`. `preventDefault()` is the word "yes" — say it after
   the check, not before.
7. **On `drop`, read the id back out of the payload**, resolve both endpoints by
   id, and bail on a self-drop. Compute the next array with a
   `splice(from,1)`/`splice(to,0,item)` pair over ids.
8. **Persist once.** Local → write synchronously in the same handler
   (`ProjectOverviewPage.tsx:180-190`). Server → send the **whole id sequence** to
   one command and re-fetch; see [§9](#9-the-missing-gate) for what the command
   must do with it.
9. **Add the keyboard path in the same change.** A focused row plus
   `ArrowUp`/`ArrowDown` (or an explicit move-up/move-down pair) calling the same
   reorder function, plus an `aria-live="polite"` region that already exists in the
   DOM before the move (`CanvasShell.tsx:912-914` is the shape) announcing
   "Moved *X* to position *n* of *m*".
10. **Then stop.** Do not write a drop-line, a grabbing cursor, a drop-zone glow,
    or a "a drag is happening" body class — 3, 4, 5 and 5 already exist.

**Before writing any of this, ask §4's real question: can the signature make the
wrong call impossible?** See [§10](#10-prefer-a-type-over-a-gate).

---

## 5. Anti-patterns

- **Passing an index across the boundary.** `onReorder(toIndex: number)` cannot say
  *whose* index it is, and in this repo that ambiguity has already been resolved
  the wrong way ([§7-B](#b-the-mood-boards-drag-to-reorder-has-never-moved-anything)).
  Failure mode: the call site binds the drop *target's* index and id, the dragged
  item's identity is discarded, and every drag is a silent no-op. An index is also
  meaningless the moment the view is filtered or sorted — index 2 of a filtered
  list is not row 2 of the collection.
- **Keying transient drag state by index in a list that reorders under you.**
  `draggingIndex` is stale the instant `onReorder` fires; the highlight, the lift
  and the z-index then decorate the wrong row.
- **Trusting local drag state to authorise a drop.** A stale `draggingId` plus an
  unrelated drop is a reorder the user never asked for.
- **`preventDefault()` before inspecting the payload.** That is a drop zone that
  accepts an OS file, a text selection, and every other draggable in the app.
- **Rewriting N rows as N statements.** A failure at row *k* commits rows `0..k`
  and abandons the rest. Executed: this exact loop, failing at row 3 of 5, left
  `a:0 e:0 b:1 d:1 c:2` — two duplicate `order_index` values and an order that
  matches neither the before nor the after.
- **`MAX(col)+1` outside a transaction** to place a new item at the end. Two
  interleaved creates read the same maximum and both get it.
- **Optimistically reordering the UI and awaiting the write.** Reorder is the one
  write where an un-rolled-back optimistic patch is *maximally* misleading: the
  list looks deliberate, so nothing about it says "unsaved".
  `post-write-side-effects.md` counts **65 of 181** write sites patching state
  with no rollback; do not add the 66th here.
- **Committing on `pointercancel`.** `onPointerCancel` means the OS took the
  gesture away. Persisting the position it was at when that happened is inventing
  an intent. `GroupLayer.tsx:139-140,152-153` does exactly this.
- **Shipping the drag and deferring the keyboard.** There is no later. The repo has
  26 draggable surfaces and 0 keyboard equivalents, and every one of them was
  "later".
- **Rendering one `DropIndicator` per gap with a per-gap `layoutId`.** That is the
  one usage its own docstring rules out; you get N static lines instead of one
  gliding line, which is worse than no indicator.
- **Reaching for `@dnd-kit` because `package.json` lists it.** Nobody imports it.
  A sibling's habit can be obsolete rather than wise; so can your own repo's
  dependency list.

---

## 6. Evidence

**Copy this one:** `src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx`
— the only complete, correct HTML5 reorder in the repo.

| Where | What it shows |
| --- | --- |
| `ProjectOverviewPage.tsx:51` | A private MIME per draggable type, with a comment naming the doctrine it mirrors. |
| `ProjectOverviewPage.tsx:171-190` | The whole handler. `handleTileDrop(sourceId, target)` takes **two ids**; both indices are resolved locally by `indexOf`. State and persistence move together, synchronously. |
| `ProjectOverviewPage.tsx:345-364` | `dragstart` writes the id; `dragover` refuses before `preventDefault()`; `drop` re-reads the id from the payload rather than trusting `draggingTileId`. |
| `ProjectOverviewPage.tsx:57-70` | `readTileOrder` treats persisted order as *untrusted*: filters to known ids, then appends any id missing from it. A tile added in a later release cannot be lost to legacy state. |
| `shared/components/kanban/KanbanBoard.tsx:108-123` | The cross-bucket drop: clears drag state **in `onDrop`, not only `onDragEnd`**, because the source card unmounts before its native `dragend` fires. The comment at `:111-114` is the bug report. |
| `KanbanBoard.tsx:40` | `onItemMove?: (itemId, targetStatus) => void \| Promise<void>` — the signature that makes an index-based corruption unrepresentable. |
| `teams/sub_mastermind/lib/useIslandDrag.ts:44-79` | The pointer-drag contract: capture, 4px threshold, imperative transform, `useLayoutEffect` re-assertion, one commit on release, and `onSelect` when travel stayed under the threshold. |
| `teams/sub_mastermind/lib/NoteLayer.tsx:13-47` | `onNotesChange(next, persist: boolean)` — **the persist decision is a parameter**, `false` on every move frame and `true` once on release. The commit-once rule encoded in a signature rather than a comment. |
| `api/devTools/devTools.ts:189,241,610` | The right persisted-reorder shape: a full id sequence, one call. |
| `db/src/repos/dev_tools.rs:2762,634,949` | `ORDER BY position` / `ORDER BY order_index` on every read — the ordering column is actually honoured, which is what makes writing it correctly matter. |
| `teams/sub_goals/__tests__/GoalKanban.test.tsx:113-176` | The only drag test in the repo: asserts `draggable="true"`, synthesises a `DataTransfer`, and checks the opacity treatment. A model for testing HTML5 drag under jsdom. |

---

## 7. Deviations

### The population

26 surfaces let the user pick something up and move it, out of 4,829 `.ts`/`.tsx`
files. Two independent classifiers agree on the set; they disagreed on 2 (a
`drag={…}` gesture-only regex included `TriageCard` and `SwipeCard`, which
dismiss rather than move). By mechanism:

| Mechanism | Surfaces |
| --- | --- |
| Native HTML5 drag/drop | **10** |
| Hand-rolled `setPointerCapture` | **12** |
| framer-motion `Reorder` | **2** (1 real consumer + the `DragHandle` docstring) |
| framer-motion `drag=` gesture (not a move) | **2** |

**Three of the 26 are reorder proper** — an item's rank in an ordered collection
changes. They persist to three different places and **none of them reaches
SQLite**:

| Surface | Order lives in | Verdict |
| --- | --- | --- |
| `ProjectOverviewPage.tsx` vital tiles | `localStorage`, keyed per project | **Correct.** The reference implementation. |
| `ReferenceBoard.tsx` mood board | in-memory zustand only (`referenceBoard` is not in `systemStore.ts`'s `partialize`) | **Broken and lost on reload** — §7-B |
| `SchemaFieldBuilder.tsx` recipe schema fields | the parent form's array → a JSON blob | **Works.** Two defects, §7-D/E |

Two more are cross-bucket moves: `KanbanBoard` (one consumer, `GoalKanban`) and
`DriveFileList` (file → folder). The remaining 21 are canvas positioning, file
drop zones, drag sources and gestures.

Backend: **15 ordering columns** are declared across 963 `.rs` files; **4** are
ever written; **3** of those 4 are in the unatomic loop of §7-A.

---

### A. The entire persisted-reorder stack is unreachable, and two-thirds of it could not work

**Nothing in `src/features/**` calls a reorder command.** The stack is complete
and dead:

| Layer | Files |
| --- | --- |
| Tauri commands | `commands/infrastructure/dev_tools/goals.rs:99,245`, `contexts.rs:81` |
| Repo functions | `db/src/repos/dev_tools.rs:861,1030,2978` |
| API wrappers | `api/devTools/devTools.ts:189,241,610` |
| Store actions | `devToolsProjectSlice.ts:256`, `devToolsContextSlice.ts:95` |
| **UI call sites** | **0** |

Two of the three could not have worked if they were called. The Rust commands
declare a single parameter `ids: Vec<String>`; the frontend wrappers send
different keys:

```ts
// api/devTools/devTools.ts:189-190
export const reorderGoals = (projectId: string, goalIds: string[]) =>
  invoke<void>("dev_tools_reorder_goals", { projectId, goalIds });   // command wants `ids`
// :610-611
export const reorderContextGroups = (projectId: string, groupIds: string[]) =>
  invoke<void>("dev_tools_reorder_context_groups", { projectId, groupIds });  // command wants `ids`
```

Tauri 2.11.2 resolves command arguments **by name** and neither command carries a
rename attribute, so both invokes are rejected before the handler runs.
`reorderGoalItems` (`:241`, sends `{ ids }`) is the only one wired correctly.
`scripts/check-command-contract.mjs` verifies command *names* against `lib.rs`
and does not look at arguments, so this passes every gate in the repo.

**Fix:** rename the command parameters to match the wrappers (and take the
`project_id` the wrappers already send, so the rewrite can be scoped), then wire
a UI — or delete all four layers. A dead stack that is also broken is worse than
either.

**And the write itself is not atomic.** All three repo functions are the same
shape:

```rust
// db/src/repos/dev_tools.rs:861-871
pub fn reorder_goals(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute("UPDATE dev_goals SET order_index = ?1, updated_at = ?2 WHERE id = ?3", …)?;
    }
    Ok(())
}
```

A pooled connection, no `BEGIN`, N independent commits. **Executed** against
SQLite with the same five-element list and a failure at row 3 of 5:

```
baseline                      a:0 b:1 c:2 d:3 e:4
after the aborted loop        a:0 e:0 b:1 d:1 c:2     ← 2 duplicate order_index
same failure inside a tx      a:0 b:1 c:2 d:3 e:4     ← untouched
```

The command returns `Err`, the store's `catch` fires, the user sees "Failed to
reorder goals" — and the database has kept half the move. The next fetch renders
an order that matches neither the before nor the after.

**And a duplicate is not cosmetic.** I tried to disprove that. Three rows tied at
the same `order_index`, inserted in `z,y,x` order, queried with
`ORDER BY order_index`:

```
table scan          zyx    (SCAN g | USE TEMP B-TREE FOR ORDER BY)
after CREATE INDEX  xyz    (SEARCH g USING INDEX ix)
```

The same rows in the same table came back in a different order purely because an
index existed. `ORDER BY` over a broken sequence is an **unstable** order, not
merely a wrong one — it can change under an index addition, an `ANALYZE`, or a
SQLite upgrade, and it will look like the list reshuffled itself.

The same three functions are already counted by `blind-identity-write`
(`rules.json`, which names `dev_tools.rs:861` explicitly) for a *different*
defect — discarding the affected-row count, so reordering a deleted id reports
success. Both are true; §9 gates the atomicity half, which nothing gates today.

---

### B. The mood board's drag-to-reorder has never moved anything

`ReferenceBoard.tsx` advertises "The dock supports drag-to-reorder" in its
docstring (`:26-27`). It does not.

```tsx
// ReferenceBoard.tsx:186 — closure created inside referenceBoard.map((item, idx) =>
onReorder={(toIndex) => reorderReferences(item.assetId, toIndex)}
// ReferenceBoard.tsx:257-262 — inside the DROP TARGET's own handler
const fromId = e.dataTransfer.getData(REORDER_MIME);
if (fromId && fromId !== item.assetId) onReorder(index);
```

`item` and `index` are the **drop target's**. So the call is
`reorderReferences(targetId, targetIndex)`, and `artistSlice.ts:340-343` resolves
`fromIndex` from that same id and bails:

```rust
const fromIndex = board.findIndex((r) => r.assetId === assetId);
const clamped   = Math.max(0, Math.min(board.length - 1, toIndex));
if (clamped === fromIndex) return s;      // ← always
```

`fromId` — the only value that identifies the dragged card — is read out of
`dataTransfer`, used once for an inequality guard, and discarded. Executed
against the verbatim code path:

```
board            abcde
drag a → idx 3   shipped=abcde   intended=bcdae   NO-OP
drag e → idx 0   shipped=abcde   intended=eabcd   NO-OP
drag b → idx 2   shipped=abcde   intended=acbde   NO-OP
```

Every drag, for every pair. The affordance is complete — grab cursor, drop
highlight, private MIME, self-drop guard — and the operation is inert. This is
what an index-shaped signature buys: the bug is not a typo, it is the one
ambiguity `(toIndex: number)` leaves open.

**Fix:** `onReorder(fromId, toIndex)` at minimum; `reorder(movedId, beforeId)`
properly. Separately, `referenceBoard` is absent from `systemStore.ts`'s
`partialize` list, so even a working reorder would not survive a reload — decide
whether the board is session-scoped and say so, or persist it.

---

### C. The affordance that announces a control nobody can reach

`DragHandle.tsx:42-48` renders a `<span>` with `role="button"`, a localized
`aria-label` (`t.shared.drag_handle_aria` = "Drag to reorder"), and
`focus-visible:opacity-100` in its class list. It has **no `tabIndex`** and no
key handler.

Measured in real Chromium, on the verbatim markup:

```
6 × Tab from body →  pre → post → BODY → pre → post → BODY
DragHandle reachable by Tab?           NO
DragHandle focusable even via .focus()? NO
```

A `<span>` with `role="button"` and no `tabIndex` cannot hold focus at all, so
`focus-visible:opacity-100` is **dead code** and the `role`/`aria-label` pair is
a *false affordance*: assistive technology announces a button that does not
exist as a control. That is worse than an unlabelled grip, which at least does
not promise anything.

This is not covered by `unfocusable-click-target` — that rule requires `onClick`
plus `cursor-pointer` and explicitly stops at any `role=`. The two conditions are
complements: it finds elements that look operable and declare nothing; this one
declares operability and cannot be reached.

**Fix at the primitive, not the call sites:** add `tabIndex={0}` and an
`onKeyDown` that maps `ArrowUp`/`ArrowDown` to a `onMove?: (dir: -1 | 1) => void`
prop. One edit; every future consumer inherits it.

---

### D. Zero of 26 surfaces can be operated without a pointer

Measured twice, independently, and both raw numbers were wrong in the same
direction:

| Implementation | Raw hits | After hand-verification |
| --- | --- | --- |
| #1 — `onKeyDown` … `Arrow*` in a 400-char window | 1 | **0** — the hit was `ArrowUpRight`, a lucide *icon* import in `DriveFileList.tsx:3` |
| #2 — `.key === 'Arrow*'` / `case 'Arrow*':` as statements | 3 | **0** — `Gallery2D.tsx:229-234` is lightbox next/prev; `CanvasShell.tsx:754-757` is `stepFocus`, which moves the **focus cursor** between islands and never moves an island; `DrivePage` is list navigation |

Across all 4,829 files: **0** move-up/move-down controls, **0** `aria-grabbed`,
**0** `aria-dropeffect`. Exactly one drag surface contains a live region
(`CanvasShell.tsx:912-914`), and it announces focus and framing — never a move.

And there is no cheap escape via the drag itself. Measured in Chromium on a
focused `draggable` element, pressing Space, Enter, Arrow, Shift+Arrow and
Ctrl+Arrow produced **zero** `dragstart` events. Native HTML5 drag has no
keyboard entry point by specification; the keyboard path must be a second
control. `screen-reader-announcements.md` found no announcement discipline and
`anchored-popover.md` found focus handled 0 of 63 times; this is the same gap
arriving at the one interaction where a mouse is not optional but *definitional*.

**Fix, cheapest first:** `DragHandle` gets `tabIndex` + arrow keys (§7-C) —
that alone covers any list that adopts it. `KanbanBoard` gets a per-card
"move to <column>" menu. `ProjectOverviewPage` tiles already have `tabIndex={0}`
and `role="button"` for activation (`:597-600`); add Ctrl+Arrow to reorder.

---

### E. The one `DropIndicator` consumer uses it the one way its docstring rules out

`DropIndicator`'s docstring says: "Give every gap's indicator the SAME id within
one list… Render exactly one per list." Its only consumer:

```tsx
// SchemaFieldBuilder.tsx:82-84 — inside fields.map((field, index) =>
{isReordering && index !== draggingIndex && (
  <DropIndicator layoutId={`schema-field-drop-${index}`} … />
)}
```

One per row, each with a unique `layoutId`, all mounted simultaneously. Dragging
in a 5-field list paints **4** static lines instead of one line gliding to the
target gap — the shared-layout tween the primitive exists for never runs.

The same file also keys its drag treatment by index: `draggingIndex` is set from
the map index at `:76`, and `:70-79` compares `index === draggingIndex` for
opacity, scale, shadow and z-index. Once `onReorder` fires, `index` has moved and
`draggingIndex` has not, so the lift decorates the wrong row for the rest of the
gesture. Cosmetic here only because framer owns the actual array.

---

### F. Five implementations of one pointer drag, in one directory

`src/features/teams/sub_mastermind/lib/` contains **five** independent
implementations of the same pointer-drag shape:

| File | 4px threshold | `onPointerCancel` | commit on release |
| --- | --- | --- | --- |
| `useIslandDrag.ts` | yes | yes | yes |
| `NoteLayer.tsx` | yes | yes | yes |
| `useCanvasCamera.ts` | yes | yes | yes |
| `CanvasShell.tsx` | yes | yes | yes |
| `GroupLayer.tsx` | **no** | yes | yes |

This is the strongest convergence evidence in the sweep, and it is *internal*: a
controlled experiment inside one directory, where five authors reached the same
shape without a shared primitive. Four of five agree on all three properties.
`GroupLayer.tsx` is the odd one out and it is the one with the defect — with no
travel threshold, a 1px twitch on a group becomes a persisted move; and
`onPointerCancel` routes to `apply(e, true)` (`:140,:153`), so a gesture the OS
*took away* is committed.

**Fix:** promote `useIslandDrag` to `shared/hooks` as `usePointerDrag`,
parameterised on what it commits, and route all five through it. Five
reinventions in one folder is the definition of a missing primitive.

---

### G. `DataGrid`'s advertised row drag has never been used

`DataGrid.tsx:2` (`@catalog … row drag`) and `tables.md`'s "The one way" both
name HTML5 row drag as a reason to choose `DataGrid` over `UnifiedTable`. Its
drag surface is `draggingRowKey` (`:108`) and the `getRowProps` escape hatch
(`:96-97`). **Both have zero consumers** across 2,104 `.tsx` files.

And it is only half a capability: `DataGrid` supplies the *visual* treatment for
a dragged row and nothing else — no payload, no drop target, no reorder callback.
A caller following `tables.md` to `DataGrid` for row drag arrives to find the
behaviour is entirely theirs to write, with no example to copy.

**Fix:** either give `DataGrid` a real `onRowReorder(fromId, toId)` — the
`KanbanBoard` treatment — or delete `draggingRowKey` and correct the catalog tag
and `tables.md`.

---

### H. Smaller items

- **`KanbanBoard.tsx:122` fires `void onItemMove(...)`.** The promise is
  discarded, so the board can neither show a busy state during the round trip nor
  learn that the move failed; `GoalKanban.handleMove` catches into a toast and the
  card silently stays put. Per
  [`inline-busy-state.md`](./inline-busy-state.md) this is an *action* the user
  just performed and it owes a visible pending state.
- **`create_goal` / `create_goal_item` / `create_context_group`
  (`dev_tools.rs:698-711`, `:969-978`, `:2792-2805`) all do `MAX(col)+1` on a
  pooled connection.** Executed: two appends whose `SELECT MAX` interleaved both
  received `5`. Two Fleet sessions creating goals in the same project is the live
  case.
- **`ReferenceBoard.tsx:240`** declares `REORDER_MIME` inside the component body,
  so it is re-created per render per card. Harmless (the value is constant) but it
  is the one MIME constant in the repo not hoisted to module scope.
- **`IngestDropZone.tsx` and `DriveToolbar.tsx` call `preventDefault()` in
  `onDragOver` without inspecting `dataTransfer.types`.** They are file zones, so
  the practical effect is that they also advertise themselves as drop targets for
  every in-app draggable. Cheap fix: `types.includes('Files')`.

---

## 8. Gaps

1. **Native HTML5 drag cannot be started from the keyboard.** Measured, not
   assumed: no key combination fires `dragstart`. This is a specification-level
   limit, not laziness, and it is upstream of §7-D — every HTML5 surface in the
   repo needs a *parallel* control, not a fix. It is also the strongest argument
   for a shared reorder hook that exposes `move(id, dir)` so both the drag and the
   keys call one function.
2. **An integer position column cannot express a reorder as a single write.**
   Any move is an N-row rewrite, which is why §9 exists. A fractional or
   lexicographic rank (`REAL`, or a base-62 string between neighbours) makes a
   move touch exactly one row and removes the whole class — no transaction
   needed, no MAX+1 race, no partial sequence. This repo has **no** fractional
   rank anywhere; adopting one is a schema decision, not a code fix, so it is a
   gap rather than a deviation.
3. **`ORDER BY <integer col>` has no deterministic tiebreak.** Even a *correct*
   rewrite leaves ties possible after a create race, and §7-A shows ties are
   unstable under a plan change. Every ordering read should be
   `ORDER BY order_index, id` — none of the four in `dev_tools.rs` is.
4. **`DragHandle` cannot be made keyboard-operable by its callers.** It spreads
   `...rest` onto the span, so a caller *could* pass `tabIndex`; but the primitive
   already sets `role="button"`, which is the half that creates the obligation.
   The fix must be at the primitive.
5. **No gate can see a missing keyboard path.** "This drag has no non-pointer
   equivalent" is an absence spanning two files (the row and its container). §9
   does not attempt it and says so.
6. **The census engine cannot express "must be zero".** A rule pinned at 0 fails
   `zero-matches` as a broken matcher. So §9 ratchets the 3 known violations
   downward and cannot assert that the *next* reorder is written correctly. The
   type change in §10 is what covers that; the gate only holds the line.

---

## 9. The missing gate

> **Manifestation layer.** The condition is stack-free: *the new order of a list
> is written as N independent commits, so a failure part-way through persists a
> sequence that is neither the old order nor the new one.* The signal below is a
> proxy keyed on **this** repo's idiom (rusqlite, a pooled handle spelled `conn`,
> a transaction handle spelled `tx`, integer ordering columns). An adopting repo
> re-derives its own proxy for the same condition — and a repo using a fractional
> rank has designed the condition out and needs no rule at all.

**Checked first: not already gated.** `blind-identity-write` counts the same
three functions for discarding the affected-row count. `deferred-read-then-write`
counts deferred transactions that read before writing. `untimed-repo-query`
counts missing instrumentation. **No rule in the 84 asserts that a sequence
rewrite is atomic.**

**What makes the destination correct by default** (contract §9's fifth failure
mode): the gate routes you to `Connection::transaction()`, whose correctness is
structural — `tx` borrows the connection mutably and `commit()` must be called
explicitly, so a rewrite that reaches `tx.execute` and returns early rolls back
by `Drop`. There is no forgettable argument. This is the same type answer
`transaction-boundary.md` documents; the gate is the ratchet until the three
call sites land.

**The discriminator is `conn` vs `tx`, and it was measured on both populations.**
The identical loop anchors pointed at `tx.execute` match **21 spans across 9
files** — real, compliant, per-row write loops in `crypto.rs`, `personas.rs`,
`dev_workspaces.rs`, `team_assignments.rs`, `research_lab.rs`, `credentials.rs`,
`data_portability.rs`, `context_consolidate.rs`, `daily_goals.rs`. The gate fires
on **none** of them. It also correctly ignores `dev_tools.rs:7936`, the repo's
fourth ordering write, because a single-row `UPDATE` inside `update_milestone` is
not a sequence rewrite.

**Mechanism:** a census rule (`npm run census` / `census:check`). **Allowlist:**
none — all three matches are real. **Fails loudly:** the engine already fails on
a floor breach, a zero-match rule, a stale exclude, a rising count and a silent
drop; the positive control additionally fails if the anchors themselves die.

**Validated standalone** against `scripts/census/lib/engine.mjs` (`validateRule`
+ `scanRule` + `assertRule`) using a scratchpad filename unique to this composer,
then re-extracted from this finished document and re-run:
`unatomic-sequence-rewrite` walked 963, matched 3 in 1 file at
`dev_tools.rs:864,1033,2984`, zero problems;
`unatomic-sequence-rewrite-positive-control` walked 963, matched 21 in 9 files,
zero problems.

```json
[
  {
    "id": "unatomic-sequence-rewrite",
    "goldenPath": "docs/concepts/golden-paths/drag-reorder.md",
    "title": "A whole-list ordering rewrite issued one row at a time on a pooled connection, so a failure mid-loop commits a partial order",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bfor\\s*\\([^)]{0,80}\\)\\s*in\\s+[^\\{]{0,120}\\{(?:(?!\\bfn\\b)[\\s\\S]){0,600}?\\bconn\\s*\\.\\s*execute\\s*\\(\\s*\\n?\\s*\"UPDATE\\s+\\w+\\s+SET\\s+(?:sort_order|display_order|order_index|position|step_order|ordinal|sequence|rank)\\s*=",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a `for` loop whose body reaches `conn.execute(\"UPDATE <table> SET <ordering column> = ...\")` — an N-row sequence rewrite issued as N independent statements on a POOLED connection rather than through a transaction handle. PROXY FOR the stack-free condition: the new order of a list is written as N separate atomic writes, so any failure, cancellation or crash after the first one leaves the persisted sequence in a state that is neither the old order nor the new one. EXECUTED, not argued: reproducing dev_tools.rs::reorder_goals' exact shape on SQLite with row 3 of 5 failing leaves a:0 e:0 b:1 d:1 c:2 — two duplicate order_index values, an invariant break the caller cannot detect because the command returned Err and the frontend showed a toast. The same loop wrapped in a transaction leaves the list untouched. And a duplicate is not cosmetic: the same three rows tied at the same order_index came back 'zyx' under a table scan and 'xyz' the moment an index existed, so ORDER BY <col> over a broken sequence is an unstable order, not merely a wrong one. PRECONDITION (re-derive per repo): this repo executes SQL through rusqlite, spells the pooled handle `conn` and the transaction handle `tx`, and stores list order in an integer column. A repo using a fractional/lexicographic rank rewrites ONE row per reorder and has the condition designed out — it needs no rule. A repo whose driver auto-wraps (sqlx `&mut tx`), or which sends the whole sequence as one statement (a CTE, a VALUES join, json_each), also scores zero here while being correct. DISCRIMINATION IS ON `conn` VS `tx`, NOT ON THE LOOP: the same anchors pointed at `tx.execute` inside a loop match 21 spans across 9 files in this repo (crypto.rs, personas.rs, dev_workspaces.rs, team_assignments.rs, research_lab.rs, credentials.rs, data_portability.rs, context_consolidate.rs, daily_goals.rs) — see the -positive-control rule, which exists to prove exactly that. Measured 2026-08-15 at HEAD: 3 matches in 1 file, matched spans 117/122/131 chars against a 600 bound, and the ONLY other ordering write in the tree (dev_tools.rs:7936, a single-row UPDATE inside update_milestone) is correctly not matched because it is not a sequence rewrite. LEGAL FIX: take one transaction and rewrite the whole sequence inside it — `let mut conn = pool.get()?; let tx = conn.transaction()?; for ... { tx.execute(...) } tx.commit()?;` — or better, make the rewrite unnecessary by giving new rows a fractional rank so a move touches one row. Do NOT silence a match by moving the loop into the command layer; that trades this condition for the one persistence-handle-in-command-tree counts."
    },
    "baseline": { "files": 1, "matches": 3 },
    "floor": 900
  },
  {
    "id": "unatomic-sequence-rewrite-positive-control",
    "goldenPath": "docs/concepts/golden-paths/drag-reorder.md",
    "title": "POSITIVE CONTROL — the same anchors pointed at the compliant form (a per-row write loop that DOES hold a transaction handle)",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bfor\\s*\\([^)]{0,80}\\)\\s*in\\s+[^\\{]{0,120}\\{(?:(?!\\bfn\\b)[\\s\\S]){0,600}?\\btx\\s*\\.\\s*execute\\s*\\(",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "CONTROL, NOT A GATE. Identical loop + .execute( anchors as `unatomic-sequence-rewrite`, with `tx` substituted for `conn`. It must keep matching: if it ever goes to zero the engine fails the run, which tells us the anchors themselves died (a rename, a driver swap, a formatting change) rather than that the repo got clean. Without it, `unatomic-sequence-rewrite` dropping to 0 is indistinguishable from the pattern rotting. Carries no baseline by design — the compliant population is supposed to grow."
    },
    "floor": 900
  }
]
```

### Refusing to gate the frontend half, with the measurement

Three frontend gates were designed and **all three were rejected on measurement**,
because a gate that fires on correct content is worse than no gate:

| Candidate | Measured | Verdict |
| --- | --- | --- |
| Interactive ARIA role on a non-interactive tag with no `tabIndex` (the `DragHandle` defect) | 31 matches / 27 files vs **29 matches / 26 files** compliant — and the *same tags* appear in both, because `tabIndex` usually follows `role` in the attribute order | **Rejected.** Precision would be ~50%. Fixing the ordering blindness needs a tag-boundary parse a whole-file regex cannot do, and the condition belongs to `focus-management.md`, not here. |
| `onDragOver` calling `preventDefault()` with no prior `dataTransfer` inspection | **1** violating / **2** compliant across 4,829 files — and 7 of the 9 `onDragOver` bindings point at a *named* handler the inline pattern cannot reach | **Rejected.** Recall is structurally poor and the population is too thin to ratchet. |
| Index-keyed drag state (`const [dragging*Index …]`) | **4** violating / **4** compliant, and 3 of the 4 "violating" are hover-highlight state in charts, not drag | **Rejected.** The signal keys on a naming convention, not the condition. |

The frontend condition this path most cares about — *a drag with no keyboard
equivalent* — is an **absence spanning two files** and is not expressible in this
engine at all. §7-D states the number plainly (0 of 26) and §10 proposes the
structural answer instead.

---

## 10. Prefer a type over a gate

**Answered explicitly, as the contract requires — and the answer is
`withholding`, not `requiring`.**

The repo already ran this experiment on itself, at n=1 each, with opposite
outcomes:

| Signature | Fed a filtered array? | Result |
| --- | --- | --- |
| `KanbanBoard.onItemMove(itemId: string, targetStatus: string)` | **Yes** — `GoalKanban.tsx:127-130` passes `visibleGoals`, a filtered subset | **1 of 1 correct.** The move cannot express a position, so a filtered view cannot corrupt anything. Correctness is structural, not careful. |
| `ReferenceBoard.onReorder(toIndex: number)` | No | **0 of 1 correct.** The signature leaves "whose index?" open and the call site answered it wrong; every drag is a no-op (§7-B). |

That matches the corpus's fifth qualification — a required prop and an optional
prop measured identical 63/63 adoption, while a signature that simply **omitted**
an index parameter was 26/26 correct. Making `onReorder` *required* would change
nothing here; it is already required, and it is the wrong shape. Making the index
*unrepresentable* is the whole fix.

**So the type change, in three places:**

1. **The reorder callback loses the index.** `onReorder(movedId: Id, beforeId: Id | null)`
   — "put *this* item immediately before *that* one, or at the end". Two ids and
   no ordinal. A filtered or sorted view can produce this correctly by
   construction; it cannot produce a wrong absolute position, because it never
   names one. It also survives a concurrent insert, which an index does not.
2. **The Rust reorder takes a transaction, not a pool.** `transaction-boundary.md`
   already documents this as the repo's canonical type answer (`&mut PgConnection`
   vs `&PgPool` in `brainiac` is a compile error to confuse; Personas has 2,133
   pool-taking signatures against 24 transaction-taking). Changing
   `reorder_goals(pool: &DbPool, …)` to take a `&Transaction` makes §9's condition
   unrepresentable rather than counted, and §9 becomes the ratchet that holds the
   line until all three land.
3. **The ordering column becomes a rank, not an ordinal.** A fractional or
   lexicographic rank turns a move into a **single-row** write. No transaction is
   needed because there is nothing to be atomic across; the MAX+1 race disappears
   with the MAX+1; and §9's rule then matches zero and should be *deleted* rather
   than baselined at zero. This is the only change that removes the class instead
   of policing it. It is a schema decision, which is why it is §8's gap 2 and this
   section's third item rather than the first.

A shared `usePointerDrag` extracted from `useIslandDrag` (§7-F) should apply the
same discipline: expose `onCommit(id, …)`, never `onCommit(index, …)`, and take
the 4px threshold as a default rather than a parameter — `GroupLayer` is what an
optional threshold looks like.

---

## 11. Convergence — the oracle is silent, and says so

**Reported honestly: convergence neither confirms nor refutes this path's core
prescription, because neither sibling has drag-to-reorder at all.**

Measured across `personas-web` and `brainiac/console`: **0** `onDragStart`, **0**
`onDrop`, **0** `dataTransfer`, **0** `draggable=`, **0** `useSortable`, **0**
`Reorder.Group`, **0** DnD library dependencies. Four pointer-drag sites exist
between the two repos and not one is a reorder: a sheet-dismiss gesture
(`personas-web/src/components/mobile/MobileSheet.tsx:72-77`), an x-axis-only
marketing playground (`.../flow-composer/`), a decorative wave field
(`brainiac/console/src/home/Home.tsx:290-305`), and a native `<input type="range">`
playhead (`.../memories/Archive.tsx:373-378`). Neither has a move-up/move-down
control either — **0** in both.

Per the contract, a clause with no trace anywhere else should be suspected of
being local calibration. So: **§2's prescription is a house convention until a
second codebase rediscovers it.** Personas is the sole owner of drag-to-reorder
in this family; nothing here is corroborated by reinvention *except* the two
findings below, which are.

**What convergence did confirm — independently, in a different database.**
`personas-web/docs/harness/bug-hunt-2026-05-10/public-roadmap.md:55-69` documents
its `roadmap_items.sort_order` column and concludes, from Supabase/Postgres:
"Multiple null rows shuffle randomly between requests (Supabase doesn't guarantee
secondary sort)." That is the same conclusion as this path's executed A5 result
on SQLite, reached by a different team against a different engine. **An integer
ordering column with tied or absent values yields an unstable order** is physics,
not local taste — and it is the load-bearing half of §8 gap 3.

The internal convergence is stronger than the external. Five independent
implementations of one pointer-drag shape inside a single directory (§7-F), four
of five agreeing on all three properties, is a controlled experiment in one repo
and the strongest form the contract names.

**Two practices worth importing, neither of which is drag code:**

- `personas-web/src/components/flow-composer/use-flow-composer.ts:104-112` throttles
  `pointermove` through `requestAnimationFrame` with an explicit lint carve-out
  and a comment stating *why* reduced-motion gating does not apply to a drag
  throttle. This repo's canvas drags write the transform imperatively instead
  (`useIslandDrag.ts:62`), which is stronger — but any drag that must go through
  React state should take the rAF shape and the comment with it.
- `brainiac/crates/brainiac-store/src/documents.rs:444` persists with a
  compare-and-set — `WHERE id = $1 AND … IS NOT DISTINCT FROM $3`, returning
  `rows_affected() > 0` so a concurrent writer gets a conflict instead of a silent
  clobber. That is precisely the shape a persisted reorder needs against a second
  client reordering the same list, and it is the closest thing either sibling has
  to a pattern this path can cite.

**One stale-doc trap found on the way, worth naming because this path nearly
inherited it:** `personas-web/.claude/skills/npm-updates/SKILL.md:32` lists
`@dnd-kit/*` among personas-web's dependencies. It is not in that repo's
`package.json` — the file was copied from the desktop app and never re-grounded.
Read the installed dependency list, not the document that describes it; that is
how §3's "do not reach for `@dnd-kit`" was established here too.

---

## 12. Corrections to the brief

Three, stated because a cleared claim is worth as much as a confirmed one.

1. **"Persistence is the correctness bug… a failed reorder that leaves the UI
   reordered."** Not in this repo. **Zero** of the three live reorders is
   optimistic-without-rollback, and none of them is in
   `post-write-side-effects.md`'s 65-of-181 class. But not for a good reason: two
   write synchronously to local state and one writes nowhere at all. The entire
   persisted path is dead code (§7-A). The correctness bug is real and is one
   layer down — the write that *would* run is not atomic — and it is invisible
   from the frontend because the frontend never reaches it.
2. **"A reorder applied to a filtered or sorted view and written as an absolute
   position is a data bug."** The shape is present — `GoalKanban` passes a
   filtered array into `KanbanBoard` — and the bug is **absent**, because
   `onItemMove(itemId, targetStatus)` cannot carry a position. That is §10's whole
   argument, and it was found by looking for the brief's bug and not finding it.
3. **"Check whether more than one approach ships."** Three do (HTML5, pointer
   capture, framer `Reorder`) — and a fourth, `@dnd-kit`, ships as an *installed
   dependency with zero imports*. The interesting number was not how many
   approaches are used but that the declared one is not among them.

One thing the brief asked me to check that I could not clear either way: whether
a drag can cross a boundary it shouldn't. **7 of 10** HTML5 surfaces gate on
`dataTransfer.types`, and every reorder surface guards self-drop. The three that
do not gate are file drop zones, where the practical consequence (accepting an
in-app draggable and silently doing nothing) is a defect but not a data bug. No
cross-list corruption is reachable today — because there is only one list that
persists, and nothing calls it.
