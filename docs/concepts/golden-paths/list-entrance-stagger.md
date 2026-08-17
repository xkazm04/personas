# Golden path — List entrance stagger

> Situation node: `ui-system/motion-and-accessibility/list-entrance-stagger` · [situation spine](../situation-spine.md)
> Composed 2026-08-15 at `0a5b7fcaf`. Sweep: all **4,829** `src/**` `.ts`/`.tsx` files walked by the
> census engine (six independent passes), plus full reads of `RevealItem.tsx`,
> `useProgressiveReveal.ts`, `useMotion.ts`, `UnifiedTable.tsx`, `DataGrid.tsx`,
> `VirtualizedTableBody.tsx`, `LeaderboardMatrixView.tsx`, `PersonaCoachingTable.tsx`,
> `ScoreDistribution.tsx`, `ReviewInboxPanel.tsx`, `themeStore.ts`, and the four
> `globals.css` regions that own the entrance classes (`1372-1394` keyframes, `1859-1866`
> utilities, `4520-4570` OS reduced-motion, `5139-5180` in-app toggle).
> **Executed, not read:** a 16-probe Vitest suite against the real hooks, and three
> Playwright experiments driving the *real extracted CSS* in Chromium under three motion
> regimes. Convergence census over `personas-web` (597 `.tsx`) and `brainiac/console` (222 `.tsx`).
> Dimensions: **ui · function · performance · code-quality · resilience**.
> **Settles:** when a list is allowed to animate in, when it must not, and what stops the same
> rows animating twice.
>
> Shared counts cited from [`shared-facts.json`](../shared-facts.json); everything else was
> measured during composition. Deviations become `violating` cells.

---

## Two premises in the brief are wrong, and the corrections reshape the document

**1. "Every hand-rolled `animationDelay: i * Nms`" is not one population — it is two, and they
are 79-to-4.** Of the 227 `animationDelay:` occurrences in 126 files, **84 multiply a loop
index**. **79 of those 84 are delayed *ghost placeholders*** — `` `${120 + i * 35}ms` `` over a
fixed-length skeleton array, which is [`page-loading.md`](./page-loading.md) step 8's literal
prescription and therefore *correct content*. Only **5** compute a per-item entrance delay for
real content, and one of those is the primitive itself. A gate on "index-driven
`animationDelay`" would have fired on 79 conforming sites — the exact failure the contract
forbids. The discriminator fell out of the measurement: **the ghost idiom always carries a
≥120ms additive base offset** (it must — the base *is* the anti-flash window), and **the
entrance idiom always starts at zero**. §9 keys on that, and ships the ghost form as its
positive control.

**2. The reveal tracker does NOT have `UnifiedTable`'s keyboard-cursor identity problem — it has
the opposite one.** The cursor is an index; the tracker is keyed by a *stable entity id*, and
`getRowKey: (row: T) => string` (`UnifiedTable.tsx:101`) takes **no index parameter**, so an
index-derived key is unrepresentable — 26 `getRowKey=` call sites, **0** index keys; 63
`revealId=` call sites, **0** index ids. Identity is right. **Membership is wrong:** a row past
the cascade window is never marked entered, so the moment a sort or filter promotes it into the
window it fades in as though newly arrived. Measured and reproduced (§7.A).

A third, smaller correction: the brief carries a prior wave's note that a **`RevealTableRow`
primitive is owed, with `tr`/`li` hand-rolls in at least four places**. That is **stale**.
`RevealItem` has been polymorphic (`as: 'div' | 'tr' | 'li'`, `RevealItem.tsx:34,45`) for long
enough that `page-loading.md:32` documents it and 5 call sites use it. Two genuine `<tr>`
hand-rolls survive (§7.D); the rest of the `<tr class="animate-fade-in">` hits are ghost rows,
which is a different path's territory.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, and every clause carries its **warrant** so an adopting repo can tell
physics from local calibration.

> **P1 — physics.** An entrance cascade is a *statement that something arrived*. It is
> information, and information may only be delivered once. The instant a cascade can play twice
> for the same row it stops meaning "new" and starts meaning "the framework re-rendered", which
> is worse than no animation at all — the user now distrusts the signal.
>
> **P2 — physics, and the whole engineering problem.** Whether a cascade replays is decided
> entirely by **what the entrance is bound to**. Bind it to *element mount* and replay is
> unrepresentable — the platform will not re-run an animation on a node it did not re-create.
> Bind it to a *style/class recomputed on every render* and replay is the default, and you must
> now carry a memory of which items have already entered. Both bindings are legitimate; only one
> of them is free. Choose knowingly, and if you choose the second, the memory is not optional.
>
> **P3 — physics.** That memory must be keyed by the item's **stable identity**, never by its
> position. Position is the one attribute a list changes constantly — sorting, filtering,
> inserting — and a position-keyed memory reports "row 3 has entered" about whatever row is
> third *now*.
>
> **P4 — physics, and the clause most often missed.** A memory keyed correctly can still be
> *populated* incorrectly. If the rule that decides "this item does not animate" is folded into
> the same predicate that answers "has this item animated", then every item excluded for a
> reason other than having animated is silently recorded as *not yet entered* — and will animate
> the first time that other reason stops applying. **Exclusion and completion are two facts;
> storing them in one boolean loses one of them.**
>
> **P5 — physics.** The total time of a cascade must be bounded by a constant, never by the
> number of items. A per-item step multiplied by an unbounded index makes the last item's wait
> proportional to list length; with a fill-mode that holds pre-animation state, the tail of the
> list is *invisible* for that whole time. The bound belongs in the primitive, because a call
> site that forgets it produces a defect that only appears on the user with the most data.
>
> **P6 — physics, and the one nobody tests.** An element that is animating in is, to the
> platform, a fully live element: focusable, hit-testable, clickable. Delayed opacity does not
> delay interactivity. So a delay-based cascade ships an interval in which controls exist,
> answer to the keyboard, and cannot be seen. The defect is not "visible but not yet clickable";
> it is **clickable but not yet visible**, which is strictly worse because nothing warns the
> user.
>
> **P7 — physics.** Under a reduced-motion preference a cascade must not be *slowed, shortened
> or hardened* — it must not exist. Collapsing each item's animation to zero duration while
> keeping its delay converts a smooth ramp into a staircase of things popping into place, which
> is more startling than the animation it replaced, delivered to the user who asked for less.
>
> **P8 — governance.** If the product ships its own reduce-motion control alongside the
> platform preference, every mechanism that decides whether to animate must read *both*. A
> cascade implemented in script reads whatever signal its author knew about; a cascade
> implemented in the stylesheet is reached by whatever the stylesheet is scoped to. Two signals
> and two implementations give four combinations and at most one of them is what the user asked
> for.
>
> **P9 — governance.** When a primitive omits a parameter the doctrine requires, call sites do
> not go without it — they smuggle it into the nearest required parameter that accepts a
> function. The smuggling is invisible to review, cannot be typed, and is spelled differently by
> every author. **A missing prop shows up as a copy-pasted lambda, not as an absence.**

---

## Boundaries with adjacent paths — settled in prose

**`page-loading.md` owns the *ghost*; this path owns the *rows*.** They share one CSS class and
one mechanic and are constantly confused, so the line is drawn on **what is being staggered**:

| | Delayed ghost (page-loading) | Entrance cascade (this path) |
| --- | --- | --- |
| What is staggered | placeholder bars, over a fixed-length array | real rows, over fetched data |
| Purpose of the delay | an **invisibility window** so a fast fetch paints nothing | **choreography** so arrival reads as arrival |
| Delay shape | `` `${120 + i * 35}ms` `` — base offset is load-bearing | `min(order, 8) * 35ms` — starts at 0 |
| Needs an id-guard | no (the array is disposable) | **yes** (rows persist and re-render) |
| Population here | 79 sites | 4 hand-rolled + the two primitives |

The two touch at exactly one seam, and it belongs to page-loading: `resolveRowReveal`
(`UnifiedTable.tsx:253`) makes the cascade **default-on whenever `isLoading` is passed**, so
"showed a ghost" implies "ripples its rows in". That coupling is page-loading's call. *Whether
the ripple is allowed to run* is this path's, and *whether it may move at all* is
`motion-and-reduced-motion.md`'s.

**`motion-and-reduced-motion.md` owns the suppression layers; this path owns what a suppressed
cascade should become.** That path's §7.C reports that the OS reduced-motion block sets
`.animate-fade-in { animation: none !important }` (`globals.css:4539`), deleting the
`fill-mode: both` invisibility window. **Confirmed in a browser (§Executed evidence, regime B)** —
and confirmed *not to reach this path's cascade*, because `RevealItem.tsx:53` and
`useRowRevealEntrance` (`UnifiedTable.tsx:229`) branch in JavaScript and never emit the class
under reduce. The §7.C damage lands on the **ghosts** and on hand-rolls. What *does* land here
is that path's §7.A: the in-app toggle is invisible to `matchMedia`, so the cascade keeps
running for a user who switched it off (§7.B below, measured).

**`tables.md` owns the table's structure and `UnifiedTable`'s adoption; this path owns only its
`rowReveal` behaviour.** Neither `tables.md` nor `page-loading.md` carries a §9 gate (both
pre-date the contract), so the census rule proposed here is the first machine check over any of
this territory.

---

## 1. Trigger

- "The rows should cascade in instead of all appearing at once."
- "I want the tiles to pop in one after another when the data lands."
- "I sorted the table and every row faded in again — why?"
- "I switched tabs and came back and the whole list re-animated."
- "The last rows of a long list stay blank for ages after everything else has painted."
- "If you are about to type `style={{ animationDelay: \`${i * 60}ms\` }}` on something you got
  from `.map()`" — you are in this situation and about to hand-roll a primitive that exists.
- "If you are about to write `hasEntered={(id) => index >= SOMETHING || tracker.hasEntered(id)}`"
  — you are in this situation and about to reproduce the repo's most-copied defect (§7.A).

## 2. The one way

Do not compute a delay. **Give the cascade an identity and let a primitive own the timing.** For
anything rendered by `UnifiedTable` or `DataGrid`, pass `isLoading` and `data` and stop — the
`isLoading` coupling in `resolveRowReveal` turns the cascade on, the row key you already pass as
`getRowKey` becomes the guard identity, and the delay is capped for you. For any other list,
grid or tile wall, take `useRevealTracker(resetKey)` and wrap each item in
`<RevealItem revealId={item.id} order={index} {...tracker}>`; `revealId` must be the same stable
entity id you use as React's `key`, and `resetKey` must encode the **query context** (filter,
persona, scope) — never the collection's own length or contents, or every arrival replays the
whole list. Add the first-viewport bound the primitive does not yet own: rows past ~14 render
plainly. Do not branch on `prefers-reduced-motion` yourself — both primitives already do, and
they remove the class *and* the delay rather than shortening either. Never write an
`animationDelay` on a data row at a call site, never write your own `onAnimationEnd`
bookkeeping, and never make a control's availability depend on the animation finishing — the
row is clickable from frame one whether you like it or not.

## 3. Mandated primitives

- **`display/RevealItem`** (`src/features/shared/components/display/RevealItem.tsx:48`) — the
  one-shot per-item entrance. Props: `revealId` (**required**, stable id), `order` (optional,
  0-based position within the current wave), `hasEntered` / `markEntered` (**required**, from
  the tracker), `as` (`'div' | 'tr' | 'li'` — `tr`/`li` exist because a wrapping `<div>` is
  invalid inside `<tbody>`/`<ul>`). Caps the delay at `MAX_STAGGER = 8` × `STEP_MS = 35`
  (`:26-27`) so no item ever waits more than **280 ms**. Marks entry on `animationend`, not on
  mount, so an interleaved re-render cannot cut the fade short. Under reduced motion it applies
  neither class nor delay and marks entry in an effect (`:52-58`) — the correct shape, because
  the `animationend` path is dead in that mode.
- **`useRevealTracker(resetKey)`** (`src/hooks/utility/interaction/useProgressiveReveal.ts:184`)
  — the ref-backed `Set<string>` of ids that have already entered. Survives virtualized row
  unmount/remount; cleared when `resetKey` changes. **Dies with the component** — see §8.3.
- **`useProgressiveReveal(total, opts)`** (`…/useProgressiveReveal.ts:77`) — a *different*
  mechanism, and the one to reach for on a big list: it spreads the **mounting** of an
  already-fetched list rather than the animation of a rendered one. The chunk size scales with
  `total`, so 100 rows and 1,000 rows both finish inside `targetMs` (default 2,000 ms) —
  **verified by execution**, a 1,000-row list settles in ≤23 ticks / ≤2,070 ms. Returns
  `newSince`, the wave's start index, which is what `order` wants. `revealAll = !enabled ||
  reducedMotion` at `:89`.
- **`display/UnifiedTable`** — `rowReveal?: boolean | { resetKey }` (`:199`) and
  `resolveRowReveal` (`:253`): unset + `isLoading` present ⇒ cascade on; `true` ⇒ forced on;
  `false` ⇒ forced off; `{ resetKey }` ⇒ on with an explicit reset context. The cap that
  `RevealItem` lacks lives here as `REVEAL_CASCADE_ROWS = 14` (`:207`).
- **`useRowRevealEntrance(rowReveal)`** (`UnifiedTable.tsx:226`, exported for `DataGrid`) —
  returns `(id, index) => RowEntrance | null`; `null` means "render plainly". The three
  short-circuits are, in order: feature off / reduced motion, `index >= 14`, already entered.
- **CSS `.animate-fade-in`** (`globals.css:1859`) — `animation: fade-in 150ms ease-out both`
  over `@keyframes fade-in { from { opacity: 0 } }` (`:1372`). The `both` fill-mode is what
  makes an `animation-delay` an invisibility window; it is also what makes a delayed row
  invisible-but-live (P6).
- **`useReducedMotion()`** (`src/hooks/utility/interaction/useMotion.ts:16`) — the only
  sanctioned reader, and the one both primitives use. Reads the OS preference **only**; see
  §7.B.

## 4. Steps

1. **Decide whether the list should cascade at all.** A cascade says "this just arrived". A
   surface the user is *returning* to did not just arrive — if your view unmounts on nav-away
   and repaints from a module cache, the cascade is a lie about freshness (§7.C).
2. **If it is a `UnifiedTable`/`DataGrid` surface: pass `isLoading` + `data` + `getRowKey`, and
   stop.** Everything below is already wired. Reach for `rowReveal={{ resetKey }}` only when
   the *same ids* must re-ripple on a context switch — 5 call sites do, and 4 of them get the
   reset context right (`LlmCallsTable.tsx:318`, `EventLogList.tsx:459`,
   `ProjectManagerPage.tsx:499`, `SharedEventsTab.tsx:163`).
3. **Otherwise create one tracker per list**: `const enter = useRevealTracker(resetKey)`. Build
   `resetKey` from the **query context** — `` `${statusFilter}|${typeFilter}|${personaId}` `` is
   the shape 5 sites use and it is right. Passing no key at all is also right (the id-guard
   alone handles new rows). Deriving it from `items.length` is wrong and is a live trap
   (§7.E).
4. **Wrap each item**: `<RevealItem key={x.id} revealId={x.id} order={index} as={…} {...enter}>`.
   `revealId` is the same expression as `key`; if you find yourself typing anything else, stop.
5. **Add the first-viewport bound the primitive does not own.** Today the only way to express it
   is to overload `hasEntered` — `hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}`.
   **Do it, and understand that it is a workaround with a defect** (§7.A): the excluded rows are
   never recorded as entered, so a later sort that promotes one re-animates it. Until the
   primitive takes the bound as a parameter, this is the least-bad option and the constant is
   `14`.
6. **If the list can be long, add `useProgressiveReveal` too** and pass
   `order={index - reveal.newSince}` so each mount wave gets a fresh 0→8 ramp rather than a
   flat 280 ms. Only 4 of 63 call sites do this; the other 40 pass a raw index, which is
   harmless *only* because they have no progressive reveal to be out of step with.
7. **Stop.** Do not add a reduced-motion branch, a duration, a delay, an `onAnimationEnd`, or an
   `AnimatePresence`. Do not gate any interaction on the animation — see P6 and §8.5.

### Can the primitive's signature make the wrong call impossible? — answered before §9

Per [the contract's "Prefer a type over a gate"](../golden-path-contract.md#prefer-a-type-over-a-gate--checked-three-times).
**Yes for one property, already shipped and already perfect. No for the property that is
actually broken — and the corpus's own two distinctions explain exactly why.**

**What the signature already made impossible.** `getRowKey: (row: T) => string`
(`UnifiedTable.tsx:101`) is required *and its parameter list omits the index*. There is no index
in scope inside that callback, so an index-derived row key — the defect that would have wrecked
the guard — is unrepresentable. **26 call sites, 0 index keys.** This is the strong form: not a
required prop, but a required prop whose **shape withholds the dangerous value**.

**What requiredness alone bought, and what it did not.** `revealId: string` is required but
**open** — any string satisfies it, including `String(index)`. It nevertheless scores **63/63
stable entity ids**. That is a real result and it is *not* evidence that requiredness closes the
hole: it is evidence that the prop sits one line below `key={x.id}` and inherits its habit.
This is the corpus's "a required prop only carries the property it actually encodes" — the type
encodes *"an id exists"*, not *"the id is stable"*, and the 100% is call-site convention, not
enforcement. Compare `order?: number`, which is **optional** and also passed by **63/63**
sites — requiredness explains neither number. **Requiredness is orthogonal to closedness, and
here it is orthogonal to adoption as well.**

**Where the type is actively causing the defect.** `hasEntered: (id: string) => boolean` is
required, so it is wired 100% of the time — and **31 of 49 call-site files use that required
slot to smuggle in a parameter the primitive does not have**: the first-viewport bound. The slot
encodes one fact ("has this id entered"); the codebase stores two in it ("…or is out of the
animation window"). P4 says that loses one, and it does — the excluded rows are recorded as
*entered* for the purpose of not animating, but are never actually added to the set, so the
exclusion evaporates the moment the index changes. And because the smuggled parameter has no
name in the type, it has **14 distinct spellings** in the repo (`CASCADE_ROWS`, `CASCADE_CARDS`,
`DEPLOYMENT_CASCADE_ROWS`, `EXEC_CASCADE_ROWS`, `HISTORY_CASCADE_ROWS`, `ITEM_CASCADE_ROWS`,
`LIST_CASCADE_ROWS`, `RUN_CASCADE_ROWS`, `TREE_CASCADE_ROWS`, `TRIGGER_CASCADE_ROWS`) at four
different values (8, 10, 12, 14, 20). That is P9 in one measurement.

**The type move, therefore:**

> Give `RevealItem` the two parameters it is missing — `index: number` and
> `cascadeRows?: number` (default 14) — and take the tracker as an object
> (`tracker={enter}`) instead of two loose callbacks. Then `hasEntered` stops being an
> override point, the bound has a name and one default, and `RevealItem` can do the one
> thing no call site can: mark an out-of-window row as entered so promoting it later does
> not replay it. **31 files' worth of copy-pasted lambda collapses to one prop, and §7.A
> becomes unrepresentable rather than merely counted.**

The census rule in §9 is explicitly **the ratchet that holds the line until that lands** — it
gates the *other* defect class (hand-rolled delays), which the type move does not reach.

## 5. Anti-patterns

1. **`style={{ animationDelay: \`${i * N}ms\` }}` on a data row.** You have hand-rolled
   `RevealItem` without its cap, without its id-guard and without its reduced-motion branch. All
   four occurrences in this repo are missing at least two of the three (§7.D).
2. **An uncapped index multiplier.** `idx * 60` over 50 rows means the last row starts fading at
   **2,940 ms**. Measured: 29 of 50 rows still at `opacity: 0` one and a half seconds after the
   data landed (§Executed evidence).
3. **A `resetKey` derived from the collection.** `` resetKey={`${items.length}`} `` clears the
   tracker every time an item arrives or is removed — which is precisely when you most need the
   rows already on screen to hold still. If it also feeds `useProgressiveReveal`, the list
   additionally collapses back to `initialCount`.
4. **Keying the guard by index.** `revealId={String(index)}` types fine and destroys the
   mechanism: after any sort, "id 0 has entered" is a statement about a different row. Zero
   occurrences today, only because `getRowKey` withholds the index and `revealId` sits under
   `key={x.id}`.
5. **Folding the cascade bound into `hasEntered`** — the repo's most-copied stagger idiom, 31
   files. Correct on first paint, wrong after every sort. See §7.A; do it anyway until the type
   move lands, but know what it costs.
6. **Branching the cascade yourself on `prefers-reduced-motion`.** Both primitives already do,
   and they do it better than a call site can: they remove the *delay* as well as the class. A
   call site that only drops the class leaves the delay behind and turns the cascade into a
   staircase (P7).
7. **Gating anything on the animation finishing.** `onAnimationEnd`-chained focus, enable, or
   scroll-into-view never fires under reduced motion, because the animation never runs.
   `RevealItem.tsx:56` is the correct shape and exists precisely for this.
8. **Assuming an invisible row is inert.** Measured in Chromium: a row at `opacity: 0` mid-delay
   is returned by `elementFromPoint`, accepts `focus()`, and dispatches `click`. A button inside
   a row whose delay is 2.7 s is a live, focusable, unseeable control for 2.7 s (P6).
9. **Re-implementing `RevealItem` inline on a `<tr>`.** `RevealItem` takes `as="tr"` and
   `as="li"`. `LeaderboardMatrixView.tsx:172-183` reproduces the entire mechanic — reduce
   branch, cap, delay, `onAnimationEnd` guard — in 12 lines that already exist in the primitive.
10. **A cascade on a surface the user is returning to.** If the data came from a module cache
    and painted warm, animating it in says "new" about something that is not.

## 6. Evidence

**The one site to copy: `src/features/overview/sub_activity/components/GlobalExecutionList.tsx:512-522`.**
The reference implementation for the whole loading doctrine, and the cleanest cascade in the
repo: `useRevealTracker` at the top, `<RevealItem revealId={exec.id} order={index}>` per row,
`CASCADE_ROWS = 14` declared once at `:59`, and the bound applied through `hasEntered` at `:516`
with a comment explaining why. It is also the site that makes §7.A's cost concrete, because it
is the shape everything else copied.

| Site | What it demonstrates |
| --- | --- |
| `shared/components/display/RevealItem.tsx:52-73` | The complete primitive in 20 lines: reduce-branch, `min(order, 8) * 35`, class-and-delay applied together, `e.target === e.currentTarget` so a child's animation cannot mark the row entered. |
| `shared/components/display/UnifiedTable.tsx:226-263` | `useRowRevealEntrance` + `resolveRowReveal` — the same semantics without a wrapper element, plus the `isLoading` coupling that gives the whole cold-load choreography from one prop. |
| `hooks/utility/interaction/useProgressiveReveal.ts:69-75` | `nextRevealCount` — the cadence math that makes wall-clock constant in list size, exported pure so it can be tested without timers. This is the correct answer to "row 200 waits 7 seconds": don't stagger the animation, stagger the *mount*. |
| `overview/sub_events/components/EventLogList.tsx:459` | The best `resetKey` in the repo — every filter that changes which rows exist, and nothing else. |
| `plugins/twin/sub_brain/RecallPreviewPanel.tsx:175,213,266` | Three independent lists in one panel, three trackers, three scoped reset keys (`…\|facts`, `…\|contacts`, `…\|comms`). The shape to copy when a page has several lists. |
| `agents/sub_deployment/components/DeploymentTable.tsx:117-121` | `RevealItem as="tr"` on real table rows — the polymorphic form, which removes any reason to hand-roll a `<tr>` entrance. |
| `templates/sub_generated/gallery/cards/TemplateVirtualList.tsx:165` | Cascade inside a virtualizer: the id-guard is what makes scrolling not replay, which is the case a mount-bound entrance cannot serve. |

## 7. Deviations found

### A. The first-viewport bound is smuggled through `hasEntered`, and every excluded row re-animates on the next sort — **31 files, 34 sites**

The doctrine (`page-loading.md` step 9) requires rows past ~14 to render plainly. `RevealItem`
has no parameter for that, so 31 of 49 call-site files write
`hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}`. `UnifiedTable` has the
same structure natively (`:232`: `if (!enabled || index >= REVEAL_CASCADE_ROWS || hasEntered(id)) return null`).

Both suppress the animation for out-of-window rows **and therefore never attach `onAnimationEnd`
to them, so those ids are never added to the entered set.** Reproduced by execution against the
real hook:

```
entrance('row-40', 40) -> null                        // out of window, renders plainly, unmarked
entrance('row-40',  0) -> { className: 'animate-fade-in', style: { animationDelay: '0ms' } }
```

and confirmed in Chromium that re-adding the class **does** restart the animation
(`opacity` returns to `0`), whereas changing only the delay on a settled row does not. So on a
table of 100 rows, **a sort re-fades most of the first viewport**, because the rows that sort to
the top were the ones excluded from the cascade and never recorded. Every sortable
`UnifiedTable` surface with more than 14 rows is affected, plus each of the 31 files.

The bound is also copy-pasted rather than shared: **14 distinct `name=value` pairs** across 34
declarations in 33 files — `CASCADE_ROWS` at 14 (×13), 10 (×6), 12 (×3) and 20 (×1),
`CASCADE_CARDS` at 14 (×2) and 8 (×1), plus 7 single-use bespoke names. `page-loading.md` Gap 5
noticed the duplication; the *correctness* consequence is new here.

**Fix:** the type move in §4. Until then the workaround is still the right call — a bound that
is wrong after a sort beats no bound at all, which is §7.C.

### B. The in-app "Reduce motion" toggle does not stop the cascade — it converts it into a staircase — **all 63 `RevealItem` sites + both table primitives**

`themeStore.ts:200` sets `html[data-motion="reduce"]`. `useReducedMotion()`
(`useMotion.ts:4-17`) reads `matchMedia` and nothing else, so **both primitives still emit
`animate-fade-in` and the staggered `animationDelay`** for that user. The CSS toggle block
(`globals.css:5139-5155`) sets `animation-duration: 0.01ms` but never lists `.animate-fade-in`,
so the delay and the `both` fill-mode both survive.

Measured in Chromium against the real extracted CSS — 14 rows, `min(i,8)*35 ms`, counting rows
still at `opacity: 0`:

| regime | 0 ms | 60 ms | 120 ms | 200 ms | 300 ms |
| --- | --- | --- | --- | --- | --- |
| A. motion allowed (control) | 14 | 12 | 10 | 8 | 0 |
| B. OS `prefers-reduced-motion: reduce` | 0 | 0 | 0 | 0 | 0 |
| **C. in-app `data-motion="reduce"`** | **14** | **11** | **10** | **7** | **0** |

C is A. The user asked for less motion and got the identical 280 ms ramp with each row *snapping*
instead of fading — P7 exactly, and measurably worse than the fade it replaced. Note the
asymmetry that makes this easy to miss: `.animate-fade-slide-in` **is** handled by the toggle
block (`globals.css:5175-5178` forces `opacity: 1`), so the hand-rolled staggers that happen to
use that class behave correctly while the primitive's own class does not.

**Fix is not local to this path** — it is `motion-and-reduced-motion.md`'s type move 2 (one
predicate, `themeStore.reduceMotion || MQ.matches`, feeding `useReducedMotion()`). One edit
there fixes all 63 sites here.

### C. 18 of 49 `RevealItem` files apply no first-viewport bound at all

`CockpitPanel` · `LinkedDecisionsWidget` · `LinkedMemoriesWidget` · `RecentDecisionsWidget` ·
`TemplateSuggestionsWidget` · `HomeReleases` · `SectionCard` · `CertOverview` · `RunDetailView` ·
`KnowledgeGraphDashboard` · `ReviewInboxPanel` · `MessageList` · `UpcomingRoutinesCard` ·
`VaultRecentChangesCard` · `CompetitionCard` · `TraceOverview` · `TemplateVirtualList` ·
`PresetLibraryPage`.

Most are benign — `RunDetailView` wraps 10 fixed sections, `UpcomingRoutinesCard` slices to
`MAX_ROWS`, and `MessageList` / `ReviewInboxPanel` / `KnowledgeGraphDashboard` bound the *mount*
with `useProgressiveReveal` instead, which is a legitimate alternative. The two that are not:
**`TemplateVirtualList.tsx:165`** and **`PresetLibraryPage.tsx:84`** run a cascade inside an
unbounded list with neither bound, so every row fades the first time it is scrolled into view —
a permanent shimmer rather than an arrival.

### D. Four hand-rolled per-item entrance delays — the §9 population

| Site | Delay | Cap | id-guard | Reduced motion | Worst case |
| --- | --- | --- | --- | --- | --- |
| `agents/sub_lab/components/shared/VirtualizedTableBody.tsx:37-39` | `idx * 60` | **none** | **none** | CSS only | **2,940 ms** to the last row's start (50-row non-virtual branch) |
| `agents/sub_lab/components/arena/ArenaResultsView.tsx:179` | `idx * 60` | **none** | **none** | CSS only | bounded by ≤3 model cards |
| `overview/sub_director/components/PersonaCoachingTable.tsx:144` | `Math.min(i,12) * 25` | 300 ms | **none** | branches `reduceMotion` | 300 ms |
| `overview/sub_director/components/ScoreDistribution.tsx:74` | `i * 50` | **none** | **none** | CSS only | ~500 ms over 11 bands |

`VirtualizedTableBody` is the sharp one and it has a second, subtler defect: the cascade exists
**only on the non-virtualized branch** (`items.length <= 50`). At 51 items the component
switches to the virtualizer and the entrance silently disappears. So the animation is present
exactly where it is most annoying and absent where it would be useful.

Two further `<tr>`-level hand-rolls do not carry a call-site `animationDelay` and so fall
outside the §9 signal, but belong here:

- **`overview/sub_leaderboard/components/LeaderboardMatrixView.tsx:172-183`** — a complete,
  *correct* re-implementation of `RevealItem` inline: `!reduce && !enter.hasEntered(id)`,
  `Math.min(idx, MAX_ROW_STAGGER) * ROW_STEP_MS`, `onAnimationEnd` with the
  `target === currentTarget` guard. It is 12 lines that `<RevealItem as="tr">` already provides,
  and it has no first-viewport bound.
- **`plugins/dev-tools/…` / `overview/…` ghost `<tr>`s** (`DeploymentTable.tsx:289`,
  `ScraperControlRoom.tsx:347`, `ToneConsole.tsx:280`) — these are placeholders, not entrances;
  page-loading's territory, listed only so a future sweep does not mistake them for this one.

### E. `ReviewInboxPanel` derives its reset key from the collection's length — latent, one caller away from live

`ReviewInboxPanel.tsx:59,66` — `resetKey: revealKey ?? \`${filteredReviews.length}\``, fed to
**both** `useProgressiveReveal` and `useRevealTracker`. Today the single caller
(`ManualReviewList.tsx:474`) always passes a proper `revealKey`, so the fallback is unreachable.
The moment a second caller omits it, approving one review changes the length, which clears the
entered set **and** resets the progressive reveal to `initialCount: 18` — the entire inbox
collapses and re-cascades on every action. One other site does the same thing more mildly:
`RegistryHeatmap.tsx:47` (`` `${mode}:${columns.length}` ``).

### F. `DataGrid` resolves the cascade differently from `UnifiedTable` — **7 call sites**

`DataGrid.tsx:238` calls `useRowRevealEntrance({})` **unconditionally**. It has an `isLoading`
prop and the same ghost branch (`:339`), but no `rowReveal` prop and no call to
`resolveRowReveal` — so its cascade is always on, cannot be turned off, and cannot take a
`resetKey`. `page-loading.md:30` states the two primitives share the mechanism; they share
`useRowRevealEntrance` but not its resolution. Any `DataGrid` surface whose data arrives without
a load (a store-backed grid) ripples for no reason, and any that wants a filter-scoped reset
cannot ask for one.

### G. `order` is documented one way and used another — **40 of 63 sites**

`RevealItem`'s docstring (`:14`) and `useProgressiveReveal`'s (`:52-54`) both prescribe
`order={index - reveal.newSince}` so each mount wave restarts the ramp. **4** call sites do;
**40** pass a raw `order={index}`. This is currently harmless — no file combines
`useProgressiveReveal` with a raw `order` (verified across all 9 progressive-reveal files) — so
it is documentation drift rather than a defect. It is listed because the doc makes the
*prescribed* form look mandatory when it is only needed in one of the two configurations, and
because the next author who adds `useProgressiveReveal` to one of the 40 will inherit a
flat-280 ms tail without any signal that they have.

### Not a deviation, verified

- **The guard's identity is sound.** 63/63 `revealId=` are entity ids or fixed string literals;
  26/26 `getRowKey=` are id accessors. Zero index-keyed guards anywhere.
- **The delay is bounded in both primitives.** Executed: `order={400}` yields `280ms`;
  `useRowRevealEntrance` yields `['0ms','35ms','175ms','280ms','280ms','280ms']` for indices
  `[0,1,5,8,9,13]`.
- **Both primitives are reduced-motion-correct.** Executed: under `matchMedia` reduce,
  `useRowRevealEntrance` returns `null` and `RevealItem` renders with no class and an empty
  `animationDelay`, and marks entry immediately. `motion-and-reduced-motion.md` §7.C's
  invisibility-window defect therefore does **not** reach this path's cascade — only the ghosts.
- **A refetch does not replay.** Executed: an id marked entered stays entered at any later
  index; and in Chromium, mutating only `animation-delay` on a settled element leaves
  `opacity: 1`. The `rowReveal` docstring's promise ("polling/refetch/scrolling never replay")
  holds for those three verbs. It is silent about *sort*, which is §7.A.

## 8. Gaps in the primitives

1. **`RevealItem` cannot express the first-viewport bound.** The single upstream cause of §7.A,
   §7.C and half of the 14-spelling constant sprawl. `page-loading.md` Gap 5 recorded the
   duplication; the measurement here adds that the workaround is not merely repetitive but
   *incorrect after a sort*.
2. **The bound and the cap are two different limits with one name.** `RevealItem` caps the
   *delay* at 8 steps; `UnifiedTable` bounds *which rows animate* at 14. Both are called "the
   cascade cap" in comments. They are independent: a list of 14 rows has 14 animating rows and 9
   distinct delays.
3. **`useRevealTracker`'s memory dies with the component.** Executed: unmount → remount forgets
   every id. Lazy routes fully unmount on nav-away, so a view that repaints warm from a
   module-scoped cache (the mechanic `page-loading.md` step 10 mandates) **still replays its
   entire cascade** on return — the data is warm and the animation says "new". The tracker would
   need the same module-scoped treatment as the cache, keyed the same way; nothing offers that.
4. **There is no way to say "these rows are not new".** The tracker's only vocabulary is "has
   entered". A list that has just been *restored* rather than *fetched* has no way to seed the
   set, so §8.3 has no call-site remedy either.
5. **Nothing suppresses interaction during the delay, and nothing should have to.** P6's
   invisible-but-live window is inherent to `fill-mode: both`; `pointer-events: none` would fix
   the mouse and break the keyboard (a focusable control that is not clickable is worse). The
   real answer is §8.1 + a bound small enough that the window is ~280 ms rather than 2,940 ms —
   which is why the uncapped hand-rolls in §7.D are an accessibility defect and not just a taste
   one.
6. **`useProgressiveReveal` has an `enabled` option for off-screen tabs that nothing uses.**
   0 of 9 call sites pass it, so every list with a progressive reveal runs its timer chain
   whether or not its tab is visible.
7. **No test asserts any of this.** `useProgressiveReveal.test.ts` covers the cadence math;
   `UnifiedTable` and `RevealItem` have no test files. The 16 probes written for this document
   were run from a scratch config and are not committed — §9's sequencing proposes landing the
   four that matter.

## 9. The missing gate

### The semantic condition, stated stack-free

> **A per-item entrance delay computed at the call site rather than by the shared cascade
> primitive** — which is, in this codebase, reliably also a stagger with no identity memory, no
> bound, and no reduced-motion branch of its own.

An adopting repo must re-derive its own proxy. The regex below keys on this repo's two idioms
(an inline `animationDelay` template literal, and the ≥120 ms base offset that distinguishes a
placeholder from an entrance). A repo whose entrances are framer variants, Web Animations calls,
or a `--stagger` custom property will match nothing and must key on its own spelling. **State the
condition, port the intent, rewrite the signal.**

### Why not an ESLint rule

The condition is genuinely AST-shaped (is this JSX inside a `.map` over fetched data?) and the
strongest form of it — "a delay whose multiplier is the map callback's index parameter" — is
writable. But the population is **4**, all four are one-line fixes, and the value of the gate is
almost entirely in *preventing the fifth*, which a count does exactly as well. A warn-level rule
would additionally enforce nothing at either of this repo's gates (`npm run check` passes
`eslint src/` with no `--max-warnings`; the pre-commit hook passes `--quiet`). Census rule, then.

### Checked first: this condition is not already gated

All **81** rules in `scripts/census/rules.json` were read. None matches `animationDelay`,
`transitionDelay`, `RevealItem`, `hasEntered` or any stagger token. The nearest neighbours are
`looping-framer-animation` (`repeat:\s*Infinity`, 25 files) and `hand-rolled-spinner`
(`animate-spin`, 182 files); the file overlap with this rule's 4 hits is **zero**. No
double-counting.

### The rule

```json
{
  "rules": [
    {
      "id": "hand-rolled-row-stagger",
      "goldenPath": "docs/concepts/golden-paths/list-entrance-stagger.md",
      "title": "Per-item entrance delay computed at the call site",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "animationDelay:\\s*`\\$\\{[^`+]*\\*[^`+]*`",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "An inline animationDelay whose template multiplies a loop index and carries NO additive base offset — the signature of a hand-rolled row/tile entrance cascade. The compliant entrance never writes animationDelay at a call site at all (RevealItem / UnifiedTable rowReveal own it, capped at 8x35ms and id-guarded); the compliant delayed GHOST always carries a >=120ms base offset (`${120 + i * 35}ms`, page-loading.md step 8), which the two `[^`+]` classes exclude. Every current match is a stagger with no id-guard, and three of the four have no cap."
      },
      "exclude": [
        {
          "path": "src/features/shared/components/display/UnifiedTable.tsx",
          "reason": "the cascade primitive itself — useRowRevealEntrance is where the capped animationDelay is SUPPOSED to be computed, and DataGrid imports it rather than recomputing"
        }
      ],
      "baseline": { "files": 4, "matches": 4 },
      "floor": 4000
    },
    {
      "id": "hand-rolled-row-stagger-positive-control",
      "goldenPath": "docs/concepts/golden-paths/list-entrance-stagger.md",
      "title": "POSITIVE CONTROL — the compliant delayed-ghost delay, which must NOT be gated",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "animationDelay:\\s*`\\$\\{[^`]*\\+[^`]*\\*[^`]*`",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "Same anchors as hand-rolled-row-stagger, pointed at the COMPLIANT shape: the >=120ms-based delayed ghost prescribed by page-loading.md step 8. Its large count is the proof that the real rule's `[^`+]` discriminator is doing the work — if that discriminator is ever weakened, the real rule's count moves toward this one's."
      },
      "floor": 4000
    }
  ]
}
```

### Validation — baseline reproduces exactly, faults reported, control fires

Validated standalone against the real engine (`scripts/census/lib/engine.mjs`) through a
composer-unique harness (`stagger-*-lis.mjs`, `rules-lis.json`), then **re-extracted from the
fenced block above and re-run**; both runs identical. `rules.json` was **not** edited — merge
with `scripts/census/merge-published-rules.mjs`.

```
hand-rolled-row-stagger: walked=4829 scanned=4828 files=4 matches=4 commentSkipped=0
  OK — baseline reproduces exactly.
     src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:179
     src/features/agents/sub_lab/components/shared/VirtualizedTableBody.tsx:38
     src/features/overview/sub_director/components/PersonaCoachingTable.tsx:144
     src/features/overview/sub_director/components/ScoreDistribution.tsx:74
hand-rolled-row-stagger-positive-control: walked=4829 scanned=4829 files=70 matches=84
  (positive control — no baseline by design)
```

`walked=4829` independently reproduces `shared-facts.json`'s `frontend.tsFiles: 4829`.
Cross-checked against a **second implementation** — `grep -rnP -f <pattern-file>` (pattern held
in a file, never in argv or a heredoc, per the backspace-collapse failure recorded in the
contract) — which returns the same 5 lines, 4 after the exclusion. **Agreement is exact.**
`commentMatchesSkipped=0` means the engine's multiline comment-consumption hazard cannot apply.

**What the positive control proves.** It carries the *same* anchors (`animationDelay:`, a
template literal, a `*`) and points them at the shape the doctrine mandates — and it matches
**84 sites in 70 files**. Had the real rule not discriminated on the additive base offset, it
would have baselined 84 conforming placeholders as violations and this path would have shipped a
gate that fires on correct content. The control is the receipt that the discriminator, not luck,
is doing the separation; and if a future edit weakens `[^`+]`, the real rule's count jumps
toward 84 and `drift/rose` fires immediately.

Induced faults, with the exit code each produces:

| Fault | `npm run census` | `npm run census:check` | Problem raised |
| --- | --- | --- | --- |
| control | **0** | **0** | — |
| a new hand-rolled stagger lands (baseline 3/3) | 0 | **1** | `drift/rose` on both metrics |
| a count drops silently (baseline 5/5) | 0 | **1** | `drift/dropped` on both metrics |
| roots/extensions stop describing the repo (`floor: 9000`) | **1** | **1** | `structural/floor` — "matcher broken, not codebase clean" |
| the excluded primitive moves or is renamed | **1** | **1** | `structural/stale-exclude` (+ the resulting rise) |
| the pattern stops matching (typo'd regex) | **1** | **1** | `structural/zero-matches` (+ dropped) |
| the rule loses `floor` | **1** | **1** | shape-invalid, refused before scanning |

**How it fails loudly if its own precondition is absent.** Two guards carry it. `floor: 4000`
means a restructured `src/`, a renamed extension or a mis-pointed walk exits 1 saying the matcher
is broken rather than reporting a clean codebase — induced, fired. `zero-matches` means a typo
cannot masquerade as a completed migration — induced, fired. And the exclusion is a **file
path**, so if `UnifiedTable.tsx` is ever split or moved the run fails on `stale-exclude` rather
than quietly ceasing to protect the primitive.

**The honest limit of this gate.** It counts 4 things. The two larger defect classes in this
document — §7.A (31 files, wrong after a sort) and §7.B (63 sites, invisible to the in-app
toggle) — are **not gateable by a count**, because both populations are *conforming code doing
the only thing the current types allow*. Gating them would be gating correct content, which is
the one thing §9 must not do. They are fixed by the §4 type move and by
`motion-and-reduced-motion.md`'s type move 2 respectively, and the honest §9 answer for them is
**refusal with measurement**: 31 and 63 sites, both counted, neither gated, both listed as
sequencing steps below. The census engine cannot express "must be zero" and cannot express "…in
a file that does not also import the primitive"; pretending otherwise would produce exactly the
kind of rule that reports green while the condition is present at scale.

### Sequencing

1. **The type move** (§4): `RevealItem` takes `index` + `cascadeRows` + a tracker object. Removes
   §7.A's 31 files as a class and lets the primitive mark out-of-window rows as entered, which
   is the actual fix for the sort replay. No count needed.
2. **Merge this census rule.** Freezes the hand-rolled population at 4/4 while those four are
   fixed (`VirtualizedTableBody` first — it is the only one with a measured multi-second window),
   then `--update` to lock the win in. If it reaches zero, **delete the rule** rather than
   baselining it at 0.
3. **`motion-and-reduced-motion.md` type move 2** — one reduced-motion predicate. Fixes §7.B for
   all 63 sites; nothing in this path can fix it alone.
4. **Give `DataGrid` a `rowReveal` prop routed through `resolveRowReveal`** (§7.F, 7 call sites).
5. **Land the four probes** from this composition as `RevealItem.test.tsx` /
   `UnifiedTable.reveal.test.tsx`: the delay cap, the reduced-motion short-circuit, the
   entered-id short-circuit, and the sort-promotion regression (which fails today and is the
   point).
6. §8.3 (a tracker that survives remount) needs `page-loading.md` at the table — it is the same
   module-scoped-cache mechanic, applied to the entered set instead of the data.

---

## Executed evidence — what was run, not read

Two independent executions, both against the real code and the real CSS.

**1. Vitest, 16 probes, all passing**, against `RevealItem`, `useRowRevealEntrance`,
`resolveRowReveal`, `useRevealTracker`, `useProgressiveReveal` and `nextRevealCount`, with
`matchMedia` installed via `vi.hoisted` — necessary because `useMotion.ts:4` captures **one**
`MediaQueryList` at module load, so a mock installed in `beforeEach` arrives too late. (That is
a test-harness fact, not a product defect: in a browser the captured MQL is live and
`subscribe()` listens to it.) Findings already folded in above: the sort-promotion replay, the
280 ms cap at any index, the reduced-motion short-circuit in both primitives, the
`resolveRowReveal` truth table, the per-instance tracker lifetime, and the ≤2,070 ms
progressive-reveal settle at 1,000 rows.

**2. Playwright/Chromium, three experiments**, each slicing the *real* rules out of
`src/styles/globals.css` by line range rather than re-typing them (a first attempt that clipped
an unclosed `@keyframes` block reported every row at `opacity: 1` — a reminder that a
CSS-extraction harness needs its own sanity check, since "nothing is animating" and "the
stylesheet failed to parse" look identical):

- **Regimes A/B/C** (§7.B table) — the in-app toggle traces the control curve.
- **Worst case**, reproducing `VirtualizedTableBody.tsx:37-39` at its 50-row limit: **50 rows
  invisible at t=0, 29 still invisible at t=1.2 s, 0 at t=3.2 s.** Last row starts fading at
  2,940 ms.
- **Replay triggers**, on a settled row: mutating `animation-delay` alone → **no replay**
  (`opacity` stays 1); removing and re-adding the class → **replay** (`opacity` 0); replacing
  the node → **replay**. This is what makes §7.A's class re-add the real mechanism and clears
  "a re-sort's delay change" as a suspect.
- **Interactivity**, on row 45 of the 50-row hand-roll (delay 2,700 ms):
  `{"rowOpacity":"0","focusedId":"btn45","hitId":"btn45","clickFired":true}` — invisible,
  focused, hit-tested and clicked.

## Convergence — and it contradicts the central mechanic

`personas-web` (597 `.tsx`, no shared code) and `brainiac/console` (222 `.tsx`, different stack,
different author-time).

| Mechanic | `personas-web` | `brainiac/console` | Verdict |
| --- | --- | --- | --- |
| A hook that spreads list **mounting** over a window, gated by reduced motion | **REINVENTED** — `lib/useStaggeredReveal.ts`, `initial`/`batch`/`intervalMs`, returns `total` immediately under reduce | absent | **Physics.** Independently rediscovered down to the option names and the reduce short-circuit. `useProgressiveReveal` is not local taste. |
| A **per-id "already entered" memory** | **ABSENT** — 0 hits for any such concept | **ABSENT** | **Not convergent.** See below. |
| A **first-viewport bound** on the cascade | **ABSENT** | **ABSENT** | **Not convergent.** |
| A **cap on the per-item delay** | **ABSENT** — `i * 120`, `i * 150`, `i * 100` all uncapped | n/a (no `animationDelay` at all) | **Not convergent.** |
| Index-multiplied `animationDelay` at call sites | **8 hits / 4 files**, 3 of the 4 skeletons or decorative bars | **0 hits** | Ours is 84/74; scale differs by two orders of magnitude. |
| `staggerChildren` framer variants | 5 sites | **6 sites** — the *only* stagger idiom present | Both siblings' dominant idiom; ours is barely used. |

**Where convergence contradicts me, stated plainly.** The id-guard is the mechanic this entire
document is built on, and **neither sibling has anything like it.** Under the corpus's own rule
— "a clause another codebase reinvented is physics; a clause with no trace anywhere else should
be suspected of being local calibration" — the id-guard should be marked as house convention.

I do not think it is, and the reason is the finding rather than the counts. Both siblings
express entrance staggers as **framer variants with `initial="hidden" animate="visible"` and
`staggerChildren`** — an idiom in which the entrance is bound to *element mount*. A framer child
animates when it mounts and does not re-animate because its parent re-rendered, so **replay is
unrepresentable and no memory is needed.** This repo binds the entrance to a *className plus an
inline style recomputed on every render*, which is why it needs 200 lines of tracker to get back
to where framer starts.

That reframes the head. P2 is stated as a choice between bindings precisely because the
convergence evidence forced it: the correct universal clause is not "keep a set of entered ids",
it is **"know what your entrance is bound to, and carry a memory if and only if it is bound to
something that recurs."** The id-guard is the correct answer *for this repo's chosen binding* —
and this repo's binding is the better one for its actual constraint, which the siblings do not
have: a `staggerChildren` variant cannot serve a virtualized list (children mount and unmount as
you scroll, so every scroll is an entrance), and `TemplateVirtualList` / `MessageList` /
`UnifiedTable`'s virtual branch are exactly that case.

So: **the id-guard is local calibration for a real local constraint, not physics** — and I have
marked it as such rather than claiming a convergence it does not have. What *is* physics, on
this evidence, is P1 (an entrance means "new"), P2 (the binding decides), and the mount-batching
hook. The bound and the cap are convergent only in their **absence**: three codebases, and the
only place a delay is bounded is inside this repo's two primitives — which is a point in favour
of P5 being under-appreciated everywhere rather than evidence against it. `personas-web`'s
`AgentDetail.tsx:77-93` runs `i * 120` over four elements, which is fine; the same expression
over 40 would be a 4.8-second blank.

One method note, since the corpus asked for it: I nearly wrote "adopt the siblings'
`staggerChildren` idiom" as the prescription. Reading `useMotion.ts` and
`motion-and-reduced-motion.md` §5.2 stopped it — framer's `<MotionConfig reducedMotion="user">`
exempts non-positional keys, so a `staggerChildren` opacity ramp **keeps its full delay chain
under reduced motion**. The idiom that makes replay unrepresentable makes P7 unenforceable. A
sibling's habit can be obsolete, and it can also be locally correct for a reason that does not
travel.

---

**Sweep receipts.** 4,829 files walked · `animationDelay:` **227 occurrences / 126 files**
(0 in comment-only lines) — **84 index-driven** (79 delayed ghosts, 4 hand-rolled entrances, 1
primitive) and 143 constant · `transitionDelay:` 2 / 1 file, both capped · `<RevealItem>` **63
uses / 49 call-site files** · `revealId=` 63/63 stable ids, **0** index ids · `order=` 63/63
passed though optional, 4 wave-relative, 40 raw · `as="tr"|"li"` 5 sites · first-viewport bound
present in **31/49** files, absent in 18 · **14 distinct cascade-constant name=value pairs**
across 34 declarations in 33 files (values 8/10/12/14/20) · `useRevealTracker` 52 files,
`useProgressiveReveal` 9 files (0 pass `enabled`) · `<UnifiedTable>` 17 uses / 16 files,
`getRowKey=` 26 sites with **0** index keys, explicit `rowReveal` 5 sites · `<DataGrid>` 7 files,
cascade unconditional · framer `delay: <index> * n` 21 sites / 20 files, `staggerChildren` 17 /
12 · 81 census rules read, **0** already covering this condition · convergence: `personas-web`
8 index delays / 4 files + 1 reinvented mount-batching hook, `brainiac/console` **0** delays / 6
`staggerChildren` · 16 Vitest probes green · 3 Chromium experiments.
