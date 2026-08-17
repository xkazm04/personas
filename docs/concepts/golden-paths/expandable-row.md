# Golden path — Expandable row

> Situation node: `product-surfaces/lists-and-tables/expandable-row` (recurrence 58) ·
> [situation spine](../situation-spine.md)
> Composed 2026-08-15 at `94efa9c0d`. Sweep: all **4,829 `.ts`/`.tsx`** files walked
> by four purpose-built scanners (state-shape, cross-file per-item render, fetch-on-toggle,
> and a brace-aware JSX opening-tag parser) — not grepped; plus full reads of
> `UnifiedTable`, `DataGrid`, `FacetedDecisionTable`, `Collapse`, both `useToggleSet`
> implementations, `ExecutionList`, `ApiExplorerTab` + `useApiExplorerState`,
> `CompetitionSlotRow`, `ToneConsole`, `ScraperControlRoom`, `PersonaConfigPanel`,
> `IncidentsInbox`, `TemplateVirtualList`, `DriveSidebar`, the census engine and all
> **75** census rules; and a convergence census of **two** sibling repos
> (`personas-web`, `brainiac/console`).
> Dimensions: **ui · function · performance · code-quality**.
> **Settles:** how a row in a collection reveals its own detail — who owns the open
> state and what it is keyed by, how many rows may be open, what survives a filter or
> a sort, and what the control tells a screen reader.
>
> Corpus totals (`.tsx` file counts, lint baseline) are cited from
> [`shared-facts.json`](../shared-facts.json); everything else was measured during
> composition. Deviations become `violating` cells.

---

## Correction to the brief, stated first

The brief asked me to check "the analogous bug" to `filtering-and-search.md`'s
**6 of 6 `DataGrid` callers never reset the page** — *does expansion state survive a
filter, a sort, or a page change, and does it follow the row or the index?* — and
predicted that "state keyed by index rather than by id is the defect shape."

**Measured, the prediction is wrong about the corpus and right about the primitive,
and the second half is the more valuable result.**

- Across **43** files holding per-row expansion state, **42 key it by a data id** and
  **one keys it by array position**: `ApiExplorerTab.tsx:111-112`. Broadened to the whole
  4,829-file tree — `=== i` / `=== idx` / `.has(i)` / `[index]` against any
  expand/collapse identifier — the count is still **1 file, 1 site**. Of the **11**
  components that own their own expansion state and are rendered per item, **all 11**
  render sites use a data-derived React `key`. So the defect the brief expected to find
  endemic exists **once**, and both sibling repos independently key by id too. That is a
  **cleared claim**, and it is reported here rather than softened into a finding.
- **But the defect shape is in the shared table primitive.** `UnifiedTable.tsx:544` and
  `:752` hold `focusedIndex` — the keyboard row cursor — as a **position into
  `sortedData`**, and nothing resets it when the sort key, the column filter, the search
  or the data changes (the file's only `useEffect`, `:479-486`, persists sort). Change
  the sort and the focus ring stays on row *N*, which is now a different record; press
  Enter and `onRowClick(sortedData[focusedIndex])` (`:558-561`) activates a row the user
  never focused. Silent, index-keyed, per-row, in the primitive every list is told to
  use. It is not an expansion state today — but it is exactly the machinery an expansion
  slot would be built on, which is why it belongs in this path's Gaps rather than only
  in `tables.md`'s.

Two further brief expectations did not survive measurement and are reported where they
belong:

- **"Whether expanding fetches data, and if so whether it refetches on every toggle."**
  Expanding fetches at exactly **two** sites in the repo. One caches by id and is
  exemplary (`ExecutionList.tsx:202-207`); one refetches a git diff on every re-expand
  (`CompetitionSlotRow.tsx:81-93`). A 2-site population cannot carry a doctrine clause on
  its own — see [§7-E](#e-expanding-fetches-at-two-sites-one-caches-one-does-not).
- **"Height/animation: does expanding cause a layout jump or a scroll jump?"** No scroll
  jump exists: **0 of 39** parent-owned surfaces scroll the expanded row into view, and
  none fights the scroll container. The scroll-ownership clearance the brief mentions
  holds. What is there instead is quieter and worth naming — **26 of 39** panels are
  unbounded (no `max-h` anywhere in the file) and **21 of 39** animate nothing at all, so
  a row near the fold expands its detail silently below the viewport with no motion cue
  that anything happened. [§7-F](#f-the-reveal-itself--21-of-39-surfaces-animate-nothing).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file
path, primitive name or count, and every clause carries its **warrant** so an adopting
repo can tell physics from local calibration.

> **P1 — physics.** The open state belongs to the *row*, not to its position. Key it by
> the row's identity. A collection that can be filtered, sorted, paged or reordered will
> re-index, and position-keyed state then describes a different row than the one the user
> opened — silently, because the row still looks open and the detail still looks like
> detail.
>
> **P2 — physics.** Who owns the state decides how many rows can be open, so decide that
> first and let the type say it. One-at-a-time is a nullable identity; many-at-a-time is
> a set of identities. Putting the flag inside the row component is not a third option —
> it is many-at-a-time plus a promise that the state dies whenever the row unmounts, which
> in a virtualized or remounting list is whenever the user scrolls.
>
> **P3 — physics.** The disclosure control is a control. It is reachable by keyboard, it
> is activated by Enter and Space, and it is the thing the user presses — not a click
> handler on the row's container that a pointer happens to find.
>
> **P4 — physics.** The control declares its state. A rotating chevron is a picture of
> the state, not a statement of it; a label that swaps between "Expand" and "Collapse"
> renames the control instead of describing it. The state is an attribute on the control,
> because that is the only channel a screen reader reads when the control takes focus.
>
> **P5 — ergonomics.** The control names the region it opens, and the region has a name
> to be named by. Without the link, a user who hears "expanded" has been told that
> something opened and not what or where.
>
> **P6 — physics.** Expansion is not a fetch trigger; it is a fetch *opportunity*. If the
> detail must be loaded, load it once per row and keep it. Collapsing is not a reason to
> discard, because collapsing is the cheapest thing a user does and re-expanding is the
> second cheapest.
>
> **P7 — ergonomics.** A row that grows must grow visibly. The reveal is animated or the
> content is bounded, and preferably both — otherwise the detail of a row near the fold
> arrives entirely off-screen and the press appears to have done nothing.
>
> **P8 — physics.** A list that measures its own row heights must be told they changed.
> Any surface that virtualizes, and every surface that positions rows absolutely, has to
> re-measure the row that just expanded or it will overlap its neighbour.
>
> **P9 — house convention, with evidence of need.** One-at-a-time is the better default.
> It keeps the list scannable, makes the state a single nullable identity, and makes
> "collapse the previous one" free rather than a second interaction. Reach for
> many-at-a-time only when the rows are being *compared* rather than *inspected*. *Both
> siblings chose one-at-a-time unaided*, which is why this is stated as a default rather
> than a rule.
>
> **Scale condition.** P1–P5 pay from the first expandable row. P6 pays from the first
> one whose detail is fetched. P7 and P8 pay from the first list long enough to scroll.
> P9 pays from the second.

**Warrant evidence.** P1, P2 and P4 were each independently re-derived in sibling repos
with no shared code and no sight of this document. `personas-web`'s
`DataTable.tsx` takes a `keyExtractor` (`:16`), holds `expandedId: string | null`
(`:37`), and compares `expandedId === keyExtractor(row)` (`:85`) — P1 and P2 arrived at
together, in a marketing site's shared table. `brainiac/console`'s
`SkillsCatalog.tsx:236` holds `openId` seeded from `ranked[0]?.id` and compares
`openId === s.id` (`:270`) — same two clauses, third codebase, different stack.
`aria-expanded` appears on the disclosure control in both
(`DataTable.tsx:97`, `SkillsCatalog.tsx:124`, plus `personas-web`'s
`SLABreachRow.tsx:57`, `IncidentList.tsx:79`, `ComplianceRow.tsx:37`,
`SecurityFAQItem.tsx:24`). Three teams, two stacks, no shared document.

**P5 is warranted by one sibling and refused by the other two, and that is the honest
calibration.** `personas-web` pairs `aria-expanded` with `aria-controls` and a matching
panel `id` at exactly two sites — `ComplianceRow.tsx:34-38` + `:64-65` and
`SecurityFAQItem.tsx:21-25` + `:40-41` — both on *static marketing* rows. Its own
`DataTable` does not do it. `brainiac/console` does not do it. **This repo does it zero
times in 4,829 files** (`aria-controls` appears 7 times total, 5 on tab strips and 2 on
comboboxes, and **0 of 39** row-disclosure files put an `id` on any element at all).
So P5 is not physics: it is the clause that gets discovered only when someone is
auditing accessibility on purpose. Convergence measured **discoverability** again, not
whether the requirement is real — the requirement is in the ARIA disclosure pattern
regardless of who found it.

**P3 is warranted by a sibling doing it the hard way.** `personas-web`'s `DataTable`
makes the whole row the control and pays the full price for it —
`role={isInteractive ? "button" : undefined}` + `tabIndex={0}` + an explicit
Enter/Space `onKeyDown` (`:96-107`) — rather than putting a bare `onClick` on a `div`.
It is more code than this repo's row-click sites and it is the reason its rows are
operable. This repo mostly gets P3 right by a different and better route (a real
`<button>`, **17 of 18** DOM toggles), so the clause is confirmed from both directions.

---

## Seams with the neighbouring paths

[`tables.md`](./tables.md) owns `UnifiedTable` / `DataGrid` / `FacetedDecisionTable` and
already records this leaf as its **Gap #2** — *"No expand-row / detail-row slot… a
`renderExpandedRow?: (row: T) => ReactNode` + `expandedKeys` unblocks both."* That gap is
re-verified here at the working tree: grepping `UnifiedTable.tsx` and `DataGrid.tsx` for
`expand|Expand|detailRow|renderDetail|subRow` returns **nothing**. `FacetedDecisionTable`
does hold an `expanded: Set<string>` (`:118`) but it is the **group rail's tree**, not
its rows. **This path owns the answer; `tables.md` owns the slot.**

| Question | Owner |
| --- | --- |
| Which table primitive, and how do I feed it columns? | [`tables.md`](./tables.md) |
| Does a filter change reset the page? | [`filtering-and-search.md`](./filtering-and-search.md) |
| **Who owns the open state and what is it keyed by?** | **here** |
| **How many rows may be open, and what survives a filter/sort/page?** | **here** |
| **What does the disclosure control tell a screen reader?** | **here** |
| **Inline, drawer, or modal — and how do I choose?** | **here** |
| Is the detail a centred blocking surface with a backdrop? | [`modals.md`](./modals.md) |
| Is the detail anchored to the row and floating over it? | [`anchored-popover.md`](./anchored-popover.md) |
| Can this click target be reached by keyboard at all? | [`focus-management.md`](./focus-management.md) |
| Something changed on its own — is it spoken? | [`screen-reader-announcements.md`](./screen-reader-announcements.md) |

**The seam with `anchored-popover.md`, restated from this side.** That path's seam
question is *"can the user act inside the surface?"* — which does **not** separate it
from this leaf, because an expanded row's detail is full of controls too. The separating
question is one step earlier:

> **Does the surface displace the rows below it, or float over them?**
> **Displaces → expandable row (here). Floats → anchored popover (there).**

Measured, the two corpora are disjoint by construction and in fact: none of the 39
row-disclosure surfaces portals, positions against the viewport, or registers an
outside-press listener, and none of `anchored-popover.md`'s 63 surfaces is keyed by a
row identity.

**The seam with `modals.md`.** `modals.md` contains **zero** occurrences of
"expand"/"expanded", so this seam was undrawn. Drawn here: an expandable row keeps the
list on screen and lets the user compare the detail against its neighbours; a modal takes
the screen and the focus. **If the user's next act is to look at the row above, it is an
expandable row. If the user's next act is a decision about this row alone, it is a
modal.** The three-way decision is §4 step 1.

**The seam with `screen-reader-announcements.md`.** That path owns *"something changed
and nobody moved — is it spoken?"*, which is live regions; its census rule keys on
`aria-live` / `role="status"`. `aria-expanded` is neither: it is state on a control,
read when the control is focused or activated, and it must **not** be announced through a
live region. **Zero overlap** — its inherited finding (26 of 82 live regions born holding
their own message) has no instance in this corpus because this corpus contains no live
regions at all. This leaf's version of that finding is different and is [§7-C](#c-the-control-does-not-declare-its-state--and-nothing-names-the-panel):
a row that expands without `aria-expanded` does not announce nothing — it announces the
*wrong* thing, a plain button whose press has no reported effect.

---

## 1. Trigger

- "Clicking a row should show its details underneath."
- "Add a chevron to expand this row / this group."
- "Show the error/diff/payload inline instead of opening a modal."
- "Let them expand several at once." / "Only one open at a time."
- "The wrong row's detail is showing after I search."
- "Collapse all / expand all."
- **If you are about to write** `useState<string | null>(null)` named `expanded*`,
  `useState<Set<string>>(new Set())`, `expandedId === row.id`, `expanded.has(row.id)`,
  `{isExpanded && (`, a `<tr><td colSpan={N}>` under another `<tr>`, or
  `className={\`transition-transform ${isExpanded ? 'rotate-90' : ''}\`}` — you are in
  this situation.

---

## 2. The one way

Hold the open state in the **list**, never in the row, and key it by the row's own
identity — the same value you pass to `getRowKey` / `key`, never the map index. Default
to **one open at a time**: `useState<string | null>(null)`, toggled with
`setOpen(prev => prev === row.id ? null : row.id)`; reach for many-at-a-time only to
compare rows, and when you do, use the shared `useToggleSet` rather than retyping the
`new Set(prev)` dance a fifty-sixth time. Make the disclosure a real `<button>` that
wraps the row's summary content, and put **`aria-expanded={isOpen}`** on that button plus
an `id` on the panel it opens and `aria-controls` pointing at it — the chevron's rotation
is a picture of the state, not a statement of it, and a swapped `aria-label` renames the
control instead of describing it. Render the panel through
**`display/Collapse`** with `open={isOpen}`, which animates height with the CSS
`grid-template-rows: 0fr → 1fr` trick, reads `prefers-reduced-motion` itself, and never
touches `height` per frame; bound the panel's own scroll with a `max-h-*` so a long detail
cannot push the row it belongs to off the screen. If the detail must be fetched, fetch it
**once per row id into a dictionary** and read from that dictionary on every subsequent
expand — collapsing must not discard it. If the list virtualizes, hand the row element to
the virtualizer's `measureElement` so the expanded height is measured rather than
estimated. And do not put any of this inside `UnifiedTable` or `DataGrid` yet: neither has
an expansion slot (§8 Gap 1), so an expandable list is today the one legitimate reason to
compose the row yourself — which is a gap to close, not a licence to hand-roll the rest of
the table.

---

## 3. Mandated primitives

- **`src/features/shared/components/display/Collapse.tsx` — `<Collapse open={…}>`** —
  the reveal mechanic, and the one primitive in this situation that already exists and
  already works. `grid-template-rows: 0fr → 1fr` (`:86`) so no layout-thrashing `height`
  animation and no DOM measurement; reads `prefers-reduced-motion` directly and collapses
  the duration to zero (`:48-49`) *because* `<MotionConfig reducedMotion="user">` only
  gates framer-motion and not CSS transitions — the reasoning is in its own JSDoc
  (`:35-38`). `open` is **required**, so there is no optional `animate` flag to forget.
  `unmountWhenClosed` (`:19`) exists for migrating an `<AnimatePresence>{open && …}` and
  its doc comment names the exact hazard of not having it (effects, subscriptions and
  polling left alive inside every closed section). `revealOverflowWhenOpen` (`:26`) for a
  panel containing a dropdown. **24 adopters — and 1 of the 39 row surfaces.**
- **`src/hooks/utility/interaction/useToggleSet.ts` — `useToggleSet<T>()`** — the
  many-at-a-time state. Returns `[set, toggle, setSet]`; `toggle` is the exact
  `new Set(prev)` / `has` / `delete` / `add` body that **55 files** in this repo have
  retyped **60 times**. Exported from `@/hooks` (`hooks/index.ts:67`). **One adopter
  file, and it uses it for selection, not expansion.** (Read §8 Gap 3 before importing:
  there are two of these.)
- **`display/UnifiedTable.tsx` / `display/DataGrid.tsx`** — still the mandated table
  primitives for everything *except* the expansion, per [`tables.md`](./tables.md). They
  own the columns, the cold-load contract, sorting, filtering, virtualization and the row
  cascade. They do **not** own expansion (§8 Gap 1), so a table that needs an expandable
  row composes the rows itself **and inherits none of the licence to hand-roll the header,
  the ghost rows, the empty state or the sort** — those deviations are `tables.md`'s and
  are not excused here.
- **`display/RevealItem` + `useRevealTracker`** — the per-row entrance cascade for a
  non-tabular list. It is keyed by `revealId`, which must be the same identity your
  expansion is keyed by; `ScraperControlRoom.tsx:158-163` is the correct composition (the
  detail `<tr>` is a **sibling** of the `RevealItem`, so expanding does not replay the
  row's entrance).
- **`@tanstack/react-virtual`'s `virtualizer.measureElement`** — the answer to P8, used
  correctly at `ExecutionList.tsx:505` and `TemplateVirtualList.tsx:162`. Pass it as the
  row wrapper's `ref` and an expanded row re-measures itself; omit it and
  `estimateSize` (`TemplateVirtualList.tsx:97`) will place the next row on top of the
  detail you just revealed.
- **`src/i18n/useTranslation.ts` — `t` / `tx`** — the control's accessible name and any
  "Show more / Hide" label are user-facing copy.

**Deliberately not mandated: `<details>` / `<summary>`.** The platform element gives
`aria-expanded` semantics, keyboard operation and open state for free, and this repo uses
it **22 times across 18 files — none of them per-item**. It was checked and it does not
fit: `<details>` cannot be driven from parent-owned state without fighting its own `open`
attribute, so it cannot express one-at-a-time, and it cannot live between two `<tr>`s.
Recorded so the next composer does not re-derive it.

---

## 4. Steps

1. **Choose the destination before anything else.** Will the user compare this detail
   with the neighbouring rows? → expand it inline, continue here. Is the next act a
   decision about this row alone, needing the screen? → [`modals.md`](./modals.md). Is it
   a small floating panel anchored to a control in the row that should not move the rows
   below? → [`anchored-popover.md`](./anchored-popover.md).
2. **Put the state in the list component and key it by identity.** One-at-a-time:
   `const [openId, setOpenId] = useState<string | null>(null)`. Many-at-a-time:
   `const [open, toggleOpen] = useToggleSet<string>()`. **Never the map index** — and
   note that if you are writing `key={row.id}` on the row one line above, you already have
   the identity you need (`ApiExplorerTab.tsx:109` has it and `:111` ignores it).
3. **Never put the flag inside the row component.** It reads simpler and it silently
   means "many open, and each one forgets the moment its row unmounts". In a virtualized
   list that is on every scroll. 11 components in this repo do this; it is defensible only
   when the row genuinely cannot unmount and multi-open is genuinely wanted, and it should
   be stated in a comment when it is.
4. **Make the disclosure a `<button>`, and let it wrap the row's summary.** `type="button"`,
   `onClick` toggling the state, full row width, `text-left`. Do not put `onClick` on the
   `<tr>` or the row `<div>`; that is [`focus-management.md`](./focus-management.md)'s
   `unfocusable-click-target` and it is already counted there.
5. **Declare the state on that button.** `aria-expanded={isOpen}`. This is one attribute,
   it has no configuration to get wrong, and it is the whole of §9. Add
   `id={panelId}` on the revealed panel and `aria-controls={panelId}` on the button;
   `personas-web`'s `ComplianceRow.tsx:34-38` + `:64-65` is the shape to copy verbatim.
   **Do not swap the `aria-label` between "Expand" and "Collapse" instead** — a renamed
   control is not a described state, and the shared `FacetedDecisionTable.tsx:311` is the
   in-repo example of getting this half-right.
6. **Render the panel through `<Collapse open={isOpen}>`,** and give its inner content a
   `max-h-*` + `overflow-y-auto` when the detail can be long (a log, a diff, a payload).
   Pass `unmountWhenClosed` if the panel starts effects, subscriptions or polling.
7. **In a `<table>`, the panel is a second `<tr>` with one `<td colSpan={N}>`,** wrapped
   with the summary row in a `<Fragment key={row.id}>` — `ToneConsole.tsx:158-241` and
   `ScraperControlRoom.tsx:157-241` are both structurally right, and `N` must equal the
   header's column count. If the detail is *more rows of the same shape* rather than a
   panel, emit sibling `<tr>`s instead (`PersonaConfigPanel.tsx:556`).
8. **If the detail must be fetched, cache it by id.** Copy `ExecutionList.tsx:202-207`:
   a `Record<id, Detail>` in state, an early return when the id is already present, one
   `await` on the miss. Collapsing must never clear the cache.
9. **If the list virtualizes, pass `ref={virtualizer.measureElement}` on the row wrapper.**
   Without it the virtualizer keeps the estimate and the expanded row overlaps its
   neighbour.
10. **Decide whether the state should survive.** Expansion keyed by id survives a filter
    and a sort for free — that is the point of P1. Decide separately whether it should
    survive an *entity* change (a different team, a different execution): if not, reset it
    in the effect that changes the entity and say why in a comment
    (`ProjectTeamPreviewModal.tsx:63-67` is the model). Persist it across sessions only
    when the grouping is long-lived (`IncidentsInbox.tsx:115-121` + `:207`, the one site
    that does — and see [`client-state-persistence.md`](./client-state-persistence.md)).
11. **Ask the type question before reaching for a gate.** *Can the signature make the
    wrong call impossible?* For this situation it can, once, decisively — see
    [Type over gate](#type-over-gate--the-answer).
12. **And then stop.** A correct expandable row is one state hook, one `<button>` with
    `aria-expanded`, and one `<Collapse>`. Everything else in the table is
    [`tables.md`](./tables.md)'s and you are not exempt from it.

---

## 5. Anti-patterns

- **Keying the open state by the map index.** `ApiExplorerTab.tsx:111-112` —
  `isExpanded={state.expandedIdx === i}` over `state.filtered`, one line under
  `key={\`${ep.method}:${ep.path}\`}`. Type in the search box and the filtered array
  re-indexes; position 3 is now a different endpoint and its detail is what you see. The
  row does not remount (the React key is correct), so nothing flickers — the panel simply
  becomes a lie.
- **Putting the flag inside the row component.** It is not simpler, it is a different
  feature: many-open, plus amnesia on unmount. In `TemplateVirtualList` or `ExecutionList`
  that would mean every scroll collapses whatever left the viewport.
- **A `<tr onClick>` as the disclosure.** `ToneConsole.tsx:159-167` — the whole summary
  row is `cursor-pointer` with no button, no `tabIndex`, no key handler, no
  `aria-expanded`. The chevron at `:167` rotates, which is the only place the state is
  expressed at all.
- **A rotating chevron as the state.** 53 files pick a `rotate-*` class from an
  expand/collapse ternary; **29 of them contain no `aria-expanded` anywhere in the file.**
  The rotation is CSS. A screen reader reads none of it.
- **Swapping the label instead of declaring the state.** `FacetedDecisionTable.tsx:311`
  does `aria-label={expanded ? collapseLabel : expandLabel}` on the disclosure button and
  omits `aria-expanded`. The labels are properly translated, which makes it worse than an
  oversight: someone thought about this control's accessible name and reached for the
  attribute that renames it. `MarkdownRenderer.tsx:84` reaches for `aria-pressed` instead,
  which says "toggle button", not "this reveals a region".
- **Mounting the panel with a bare `{isOpen && <div>}`.** It appears and vanishes in one
  frame with nothing to follow. **21 of 39** surfaces do exactly this. `<Collapse>` has
  existed the whole time and 24 other files use it.
- **An unbounded detail panel.** **26 of 39** have no `max-h` anywhere. Expand a row near
  the bottom of a long list and its detail renders entirely below the fold; nothing
  scrolls it into view (0 of 39 do), so the press looks inert.
- **Refetching on every toggle.** `CompetitionSlotRow.tsx:82-93` sets `expandedDiff` back
  to `null` on collapse and re-issues `getCompetitionSlotDiff(slot.id)` on the next
  expand. The payload is a git diff. Collapsing is the cheapest thing a user does.
- **Retyping the `new Set(prev)` toggle.** 55 files, 60 occurrences, byte-identical to
  `useToggleSet.ts:6-14`. It is not a hard function to write; that is why it is written
  everywhere and why nobody notices the two that get it subtly wrong.
- **Expanding a virtualized row without `measureElement`.** The virtualizer keeps
  `estimateSize` and the next row lands on top of the detail. Both virtualized surfaces
  here get it right — it is listed because it is the failure mode a third one will hit.
- **`role="table"` with no `role="row"`.** `UnifiedTable.tsx:570` sets `role="table"`
  whenever `ariaLabel` is passed and never marks a row or a cell, so an expansion slot
  added to it would have no element that legitimately carries `aria-expanded`. Fixing the
  roles is a precondition of Gap 1, not a nicety.
- **A hardcoded English disclosure label.** `ImproveClassicPanel.tsx:78`
  (`'Hide prompt'` / `'View prompt'`), `TerminalStrip.tsx:89` + `:92`
  (`'Collapse log'` / `'Expand log'`), `AiHealingStreamOverlay.tsx:138`
  (`'Expand'` / `'Collapse'`), `StudioChatInput.tsx:139` (`aria-label="Collapse"`).
- **Reaching for `<details>` for a row.** It cannot be driven from parent-owned state
  without fighting its own `open` attribute, and it cannot sit between two `<tr>`s. All
  18 files that use it use it correctly, for one-off disclosures.

---

## 6. Evidence

**The one site to copy:** `agents/sub_executions/components/list/ExecutionList.tsx`.
It is the only surface in the repo that gets identity, virtualization and fetch-caching
right at once, and it is the hardest instance of the situation (a virtualized,
paginated, filterable list whose detail is fetched).

- `…/ExecutionList.tsx:66` — `useState<string | null>(null)`: parent-owned,
  one-at-a-time, nullable identity. P1 and P2 in one line.
- `…/ExecutionList.tsx:236-238` — the toggle:
  `const nextExpandedId = expandedId === executionId ? null : executionId`, computed once
  and used for both the state and the fetch decision.
- **`…/ExecutionList.tsx:202-207`** — `hydrateExecution`: `if (executionDetails[id]) return
  executionDetails[id]` then one `await` then a merge into the dict. **This is P6, in five
  lines.** Collapse discards nothing.
- `…/ExecutionList.tsx:144` + `:505` — `useVirtualList(executions, 64)` with
  `ref={virtualizer.measureElement}` on the row, and the comment at `:141-143` stating
  why: *"estimateSize is an initial guess… the real (and expandable) height is measured
  dynamically."* That comment is P8 written down by whoever hit it.
- `…/ExecutionList.tsx:518` — `isExpanded={expandedId === execution.id && !compareMode &&
  !bulkMode}`: expansion explicitly yields to the two other row-click modes rather than
  racing them.
- `…/ExecutionList.tsx:260-270` — the deep-link case done right: expand the parent row,
  hydrate it, and drive the scroll **through the virtualizer by index** because an
  off-screen row is not in the DOM. Its comment says exactly that.
- **`shared/components/display/Collapse.tsx:29-38, :48-49, :86`** — the mandated reveal.
  Its JSDoc is the clearest statement in the repo of why a CSS-grid collapse beats an
  animated `height`, and of why the component reads `prefers-reduced-motion` itself.
- `hooks/utility/interaction/useToggleSet.ts:6-14` — the many-at-a-time toggle, once.
- `plugins/dev-tools/sub_projects/ProjectTeamPreviewModal.tsx:60-67` — the **only** site
  in the repo that resets expansion on an entity change *and says why*: *"Reset on team
  change so a previously-expanded row from another team doesn't ghost in."* Step 10,
  discovered locally.
- `agents/components/allPersonas/PersonaConfigPanel.tsx:483-495` + `:556` — the correct
  `<table>` shape for the *sub-rows* variant: `<Fragment key={row.persona.id}>`, a real
  `<button aria-expanded={isExpanded}>` in the first cell, and expansion emitting sibling
  `<tr>`s that mirror the parent's columns. (Its table is otherwise `tables.md`'s
  top-priority migration.)
- `plugins/twin/sub_tone/ToneConsole.tsx:158-241` and `scraper/ScraperControlRoom.tsx:157-241`
  — the correct `<table>` shape for the *detail-panel* variant: `<Fragment key>`, then a
  second `<tr>` with a single `<td colSpan={N}>` where `N` matches the header count
  (verified: 6 `<th>`/`colSpan={6}` and 7/`colSpan={7}`). These are the two migrations
  `tables.md` lists as **blocked** on Gap 1 — their DOM is right; only their state and
  their control are this path's business.
- `overview/sub_incidents/components/IncidentsInbox.tsx:115-121` + `:207` — the one
  persisted expansion, with a `try/catch` around `localStorage` on both sides, plus an
  expand-all/collapse-all derived from the set rather than tracked separately (`:254-256`).
- `templates/sub_presets/PresetQuestionnaireForm.tsx:136-191` — the only row surface that
  uses **both** `<Collapse>` and `aria-expanded`, and it also derives `allExpanded` from
  the set (`:395`) instead of a second flag.

---

## 7. Deviations found

Everything below shipped under a green `npm run check`. The lint baseline is **1,135
warnings / 0 errors** ([`shared-facts.json`](../shared-facts.json)); **no ESLint rule and
none of the 75 census rules touches this situation.**

### The corpus, defined so it can be audited

A surface is in the corpus if a **repeated** item carries a control that reveals detail
for that item. Two disjoint populations, measured separately:

| population | how it was found | count |
| --- | --- | ---: |
| **parent-owned** — expansion state in the list, compared against a per-row value (`=== row.id`, `.has(row.id)`, `.includes(kind)`) | state-shape scan over all 4,829 files | **43 files**, of which 39 are `.tsx` surfaces (4 are trace helpers + one test + one store slice) |
| **row-owned** — the component owns a local expand boolean **and** is rendered inside a `.map(` by some parent | cross-file render-site scan, then read | **11** (lower bound — the scan only sees components rendered inside a literal `.map(` span) |

**Corpus: 50 expandable-row surfaces.** The `<details>` population was checked and is
**0** per-item (22 occurrences, 18 files, all one-off).

### A. Identity — **42 of 43 by id, 1 by index.** The cleared claim

Reported first because it is the one the brief expected to go the other way.

| keying | files |
| --- | ---: |
| a data id (`row.id`, `exec.id`, `node.path`, `member.role`, `trace.traceId`, …) | **42** |
| the map index | **1** — `vault/shared/playground/tabs/ApiExplorerTab.tsx:111-112` |

The single defect is live and precise. `useApiExplorerState.ts:20` holds
`expandedIdx: number | null`; `:120-129` derives `filtered` from `endpoints` by a search
predicate; `ApiExplorerTab.tsx:107` maps `state.filtered` and compares `expandedIdx === i`.
Typing in the search box removes earlier entries, every surviving endpoint shifts down,
and the open panel now belongs to a different endpoint. The correct identity is on the
line above (`key={\`${ep.method}:${ep.path}\`}`). *Fix:* hold
`expandedKey: string | null` and compare against the same template.

**Both siblings key by id too** (`personas-web` `DataTable.tsx:85`, `brainiac`
`SkillsCatalog.tsx:270`), so this is P1 confirmed three times and violated once.

**But the shape lives in the shared table primitive.** `UnifiedTable.tsx:544` and `:752`:
`const [focusedIndex, setFocusedIndex] = useState(-1)` — the keyboard row cursor, a
**position into `sortedData`**, never reset. The file's only `useEffect` (`:479-486`)
persists the sort. So sorting or filtering moves the ring to a different record, and
`:558-561` will activate `sortedData[focusedIndex]`. Same defect class, in the primitive,
affecting every `UnifiedTable` with an `onRowClick`. **This is the finding the brief was
looking for, one layer up.**

### B. Multiplicity is never declared — four shapes, no stated intent

| shape | meaning | count |
| --- | --- | ---: |
| `useState<T \| null>` | one open at a time | **22** |
| `useState<Set<T>>` | many open | **21** |
| `useState<Record<string, boolean>>` | many open | **1** — `LiveOpsStrip.tsx:41` |
| local boolean inside the row | many open **and** amnesia on unmount | **11** |

Nothing anywhere states which behaviour was wanted; the type is the only record, and the
fourth shape does not read as a choice at all. Two files hold **two** shapes at once —
`LiveOpsStrip.tsx` has a store-backed `expanded` boolean (`:34`) *and* a per-op record
(`:41`); `ExecutionList.tsx` has a scalar for expansion and a `Set` for bulk selection,
which is correct and is the only place the distinction is legible.

**21 of 21** `Set`-based surfaces retype the toggle body. Repo-wide the
`new Set(prev)` / `has` / `delete` / `add` sequence appears **60 times in 55 files** —
byte-identical to `hooks/utility/interaction/useToggleSet.ts:6-14`, which has **one**
adopter file (`designStateHelpers.ts:50-53`, four uses, all selection).

### C. The control does not declare its state — and nothing names the panel

| | count |
| --- | ---: |
| row-disclosure files (43) containing `aria-expanded` anywhere | **6** |
| row-disclosure files containing `aria-controls` | **0** |
| row-disclosure files (39 `.tsx`) putting an `id` on **any** element | **0** |
| `aria-controls` in the whole repo (4,829 files) | **7** — 5 tab strips, 2 comboboxes, **0 disclosures** |

Measured at the *control* rather than the file (brace-aware tag parse of all 2,104
`.tsx`): **145 `<button>` tags carry both an `onClick` and an expand/collapse token;
72 declare `aria-expanded` and 73 do not.** The corpus is the bad half of that split.

Two files carry **both** halves, which is the sharpest evidence that this is an
oversight rather than a policy:

- `overview/sub_director/components/PersonaDetailModal.tsx` — the **row** disclosure at
  `:271-273` has no `aria-expanded`; the brain-history section toggle at `:324-327` has
  it. Same file, same author.
- `plugins/companion/orchestration/LiveOpsStrip.tsx` — **two buttons toggling the same
  `expanded` state**: `:55-57` without, `:114-118` with.

The state is instead encoded in a CSS transform. **53 files** choose a `rotate-*` class
from an expand/collapse ternary; **29** contain no `aria-expanded` at all.

### D. The disclosure control itself — **17 of 18 are real buttons.** Cleared

The brief's inherited finding from `anchored-popover.md` (focus is 0 of 63) does **not**
transfer. Walking back from every expansion toggle to the element that owns it:
**17 `<button>`, 1 `<tr onClick>`** (`ToneConsole.tsx:159`, and it is already counted by
`unfocusable-click-target`), plus 5 toggles handed to a child row component as a prop.
So the control is nearly always focusable, Enter/Space work by construction, and there is
no focus-restoration question because an expandable row never moves focus — the panel
opens *after* the control in DOM order, so Tab reaches it naturally. **Checked
specifically because the brief expected the popover result to repeat; it does not.**

What is missing is not focusability. It is that the focusable control says nothing (§7-C).

### E. Expanding fetches at two sites; one caches, one does not

Found by scanning every function body in the tree for a `setExpand*`/`setCollaps*` call
alongside an `await`/`invoke`, filtered to handler-sized bodies. The first
implementation of that scan **missed the real one** (`CompetitionSlotRow`) because its
head pattern did not allow a `useCallback` wrapper — recorded here because it is the
reason two implementations are mandated.

| site | behaviour |
| --- | --- |
| `agents/…/ExecutionList.tsx:202-207` | caches into `executionDetails[id]`, early-returns on hit. **Exemplary.** |
| `plugins/dev-tools/sub_lifecycle/competitions/CompetitionSlotRow.tsx:81-93` | `setExpandedDiff(null)` on collapse; re-runs `getCompetitionSlotDiff(slot.id)` on every re-expand. No cache, no cancellation, no [`stale-response-guard`](./stale-response-guard.md) — a fast collapse/expand pair can land two responses. |

`CloudSchedulesPanel.tsx:175-177` is a third, milder shape: `firings` is fetched by the
parent and passed as `expandedId === trigger.id ? firings : []`, so the *data* is
single-slot and re-expanding a different row re-fetches by design. It works; it is listed
because it does not scale past one open row and nothing says so.

### F. The reveal itself — 21 of 39 surfaces animate nothing

| how the panel appears | files |
| --- | ---: |
| nothing — a bare `{open && …}` mount | **21** |
| a CSS fade/slide (`animate-fade-slide-in` / `animate-fade-in`) | **16** |
| a real height animation (`AnimatePresence` height 0→auto) | **2** — `ucCard.tsx:65-73`, `DeadLetterTab.tsx:626-716` |
| through the shared `<Collapse>` | **1** — `PresetQuestionnaireForm.tsx` |

`<Collapse>` has **24 adopters repo-wide** and **1** in this corpus. The mechanic is not
missing; the routing is.

**A controlled comparison inside this repo, and its honest limit.** Files that use
`<Collapse>` carry `aria-expanded` at **8/24 (33%)**; files that hand-roll a
`{open && <…>}` reveal carry it at **9/71 (13%)**. The direction is what you would hope
for and the effect is too weak (and too confounded — the same care produces both) to
carry any weight. What it *does* illustrate is the mechanism: `<Collapse>` owns only the
panel, so it **cannot** make the announcement correct however many people adopt it. A
primitive that owns half the situation moves the other half by suggestion at best. That
is Gap 1 stated as a measurement.

Bounding and motion together: **26 of 39** have no `max-h` anywhere in the file, **0 of
39** scroll the expanded row into view, and 21 have no motion — so on the worst
combination (unbounded, unanimated, near the fold) the press produces no visible change
at all.

### G. Persistence and reset — 5 reset, 1 persists, 33 neither

**Reset on an entity change (correct, and rarely done):** `PipelineWaterfall.tsx:31-33`
(on `execution.id`), `UseCaseHistory.tsx:39-45` (on refetch), `PersonaDetailModal.tsx:65-70`
(on `entry`), `ProjectTeamPreviewModal.tsx:63-67` (on `team.id`, **with the reasoning in a
comment**), `GitLabPipelineViewer.tsx:76-79` (on pipeline select).

**Persisted:** `IncidentsInbox.tsx:115-121` + `:207` — collapsed group keys to
`localStorage`, both sides `try/catch`ed. The only one.

**Neither:** the other 33. Mostly correct — id-keyed state genuinely should survive a
filter — but nobody chose it, and the two who did (the reset five) are the only ones with
a record of having thought about it.

Note the collision with [`filtering-and-search.md`](./filtering-and-search.md):5-139,
which prescribes `<DataGrid key={filterKey} … />` to reset pagination on a filter change.
That remount destroys **all** row-owned expansion state in the table and any expansion
state held below the remount boundary. The two prescriptions are compatible only while
expansion is parent-owned and lifted above the key — which is another reason for step 2,
and a constraint Gap 1's slot must respect.

### H. i18n

Hardcoded English disclosure copy: `ImproveClassicPanel.tsx:78`, `TerminalStrip.tsx:89`
+ `:92`, `AiHealingStreamOverlay.tsx:138`, `StudioChatInput.tsx:139`. Small, but the
disclosure label is often the only text on the control.

### I. Nothing tests any of this

`Collapse.test.tsx` exists and is the only test touching the situation; it covers the
container's own open/close and unmount behaviour. **Zero tests in the repo assert that an
expansion follows its row across a filter or a sort, that a control declares
`aria-expanded`, that a cached detail is not refetched, or that a virtualized row
re-measures when it expands.** Every finding above could be fixed and silently regress.

---

## 8. Gaps in the primitives

> **Second pass — what is upstream of all of this.** §7-B, §7-C and §7-F are not three
> problems. They are **one absence**: the repo owns the *panel* (`Collapse`, 24 adopters)
> and the *set* (`useToggleSet`, 1 adopter), and owns nothing that ties a row's identity
> to a control that announces it. So a call site can adopt both shared pieces and still
> ship a row whose state no screen reader can read — and `PresetQuestionnaireForm`, the
> one site that adopted both, got the announcement right by hand, not by construction.
> Four decisions (identity, multiplicity, announcement, reveal), two of them primitived,
> two of them per-site, and a call site that gets three right looks exactly like one that
> got four right.
>
> **The convergence oracle contradicted my expectation, and it should be said plainly.**
> I expected the siblings to be behind on this — a marketing site and a small console
> against a 4,829-file desktop app. On the clause this leaf exists to settle they are
> ahead. `personas-web` has the slot this repo's three table primitives all lack, keyed
> by `keyExtractor`, with `aria-expanded` on the row and a height animation, in **one
> 160-line component**. It also has the `aria-controls`+`id` pairing that appears zero
> times in 4,829 files here. Read it the same way `anchored-popover.md` read its own
> inversion: **this codebase built the deep machinery (virtualization, cold-load,
> cascades, sort persistence) and skipped the shallow contract.**

1. **No expansion slot on any table primitive.** `UnifiedTable` and `DataGrid` return
   *nothing* for `expand|Expand|detailRow|renderDetail|subRow`. This is
   [`tables.md`](./tables.md) Gap #2, still open, and it is what blocks
   `ScraperControlRoom.tsx` and `ToneConsole.tsx` from migrating. **The design already
   exists, in a sibling repo:** `personas-web/src/components/dashboard/DataTable.tsx` —
   `expandable?: (row: T) => React.ReactNode` (`:17`), internal
   `expandedId` keyed by `keyExtractor` (`:37`, `:85`), `onExpandedChange` for callers
   that need to observe it (`:18`), `aria-expanded` on the row (`:97`), Enter/Space
   (`:98-107`), and an `AnimatePresence` height 0→auto (`:136-147`). Port that surface
   onto `UnifiedTable` with `<Collapse>` in place of framer-motion, and §7-B and §7-C
   collapse at every site it absorbs. **Two preconditions:** the primitive must mark
   `role="row"` on rows (today only the container gets `role="table"`, `:570`), and the
   expansion state must sit *above* any `key={filterKey}` remount (§7-G).
2. **`focusedIndex` is position-keyed inside `UnifiedTable`.** `:544` and `:752`, never
   reset on sort / filter / data change. Two lines fix it — carry the focused **row key**
   and derive the index — and it must be fixed *before* Gap 1, because an expansion slot
   built on the existing cursor would inherit the defect and multiply it.
3. **Two `useToggleSet` implementations, one adopter between them.**
   `hooks/utility/interaction/useToggleSet.ts` returns a tuple and is exported from
   `@/hooks`; `hooks/lab/useToggleSet.ts` returns a richer object with `has` / `clear` /
   `addAll` / `set` — and has **zero** adopters. The richer one is the better API for this
   situation (`clear()` is collapse-all, `addAll()` is expand-all, both of which §7-B's
   surfaces derive by hand). **Merge them, keep the object shape, delete the tuple**, and
   the 60 hand-rolled toggles have one destination instead of an ambiguous two.
4. **`Collapse` cannot own the announcement.** It takes `open` and children; it does not
   render the trigger, so it cannot require `aria-expanded` and cannot supply the panel
   `id` that `aria-controls` needs. That is a correct scope for what it is — and it is
   why routing everyone to `Collapse` would be the contract's *fifth failure mode*, a
   gate on reaching a destination that does not make the thing correct. The fix is a
   thin `useDisclosure(id)` that returns
   `{ open, toggle, triggerProps: { 'aria-expanded', 'aria-controls', onClick }, panelProps: { id } }`
   — the trigger props are the whole of §7-C and the panel id is the whole of P5.
5. **No primitive expresses multiplicity.** One-at-a-time and many-at-a-time are two
   different situations that today differ only by which `useState` you typed. Gap 1's slot
   should take `expansion: { mode: 'single' } | { mode: 'multi' }` rather than an
   `expandedKeys` set the caller manages, so §7-B's fourth shape (a boolean inside the
   row) stops being reachable from inside the primitive.
6. **Nothing bounds the panel.** Gap 1's slot should apply a default `max-height` with
   its own scroll, overridable — the 26 unbounded panels are all callers who never had a
   reason to think about it.
7. **`<details>` is unavailable and undocumented as such.** The one element that gives
   P2/P3/P4 for free cannot serve a row (parent-owned `open`, `<tr>` placement), and
   nothing records that, so the next author will spend the same measurement.
8. **Nothing tests it.** §7-I.

**Not a gap:** `Collapse`'s `unmountWhenClosed` default of `false`
(`Collapse.tsx:13-18` states the migration reason), `IncidentsInbox`'s persistence
(deliberate, guarded, and the grouping is long-lived), `ProjectTeamPreviewModal`'s reset
(deliberate and commented), and `ExecutionList`'s expansion yielding to bulk/compare mode.
All four are documented with their reasoning at the call site.

---

## Type over gate — the answer

**Yes for three of the four decisions, and the fourth is the one §9 gates. The split is
sharper here than in most leaves, so it is worth stating decision by decision.**

**1. Identity — yes, and it is nearly free.** The wrong call is
`expandedIdx === i`. A slot whose signature is
`expandable?: (row: T) => ReactNode` alongside the `getRowKey: (row: T) => string` the
primitive **already requires** never hands the caller an index to key against. There is no
argument to forget, because the caller never touches the state. `personas-web`'s
`DataTable` proves this by construction — `keyExtractor` is required (`:16`) and the
expansion is keyed off it internally, so the defect is unrepresentable at all 4 of its
call sites. **A ratchet on `=== i` would be a gate over a population of one that deletes
itself the moment it fires** — measured explicitly: the broadened positional-keying
pattern matches **1 file, 1 site in 4,829 files**, so baselining it at 1 means the fix
drops it to 0 and trips the runner's own `zero-matches` structural failure. Refused for
that reason; see §9's refusals.

**2. Multiplicity — yes, by making the mode a required discriminated union.** The contract
records this move three times already (`brainiac`'s typed transaction handle,
`FacetedDecisionTable`'s required `emptyTitle` at 3/3 real copy against 5-of-20
fall-through, `personas-web`'s `createLazySection` at 22/22 against 2/31). Here the
counter-example is in the corpus: `expansion` is currently *not* a prop at all, so
**11 surfaces got many-open-with-amnesia without deciding anything.** A required
`{ mode: 'single' | 'multi' }` makes the decision impossible to skip and impossible to
express as a boolean in a row.

**3. Announcement — yes, and this is the strongest available move, but it needs a
primitive that does not exist yet.** `aria-expanded` cannot be made required by
`Collapse`, which never sees the trigger (Gap 4). It *can* be made required by Gap 1's
slot (the primitive renders the row, so it renders the attribute — 0 call sites touched,
73 controls fixed) and by Gap 4's `useDisclosure`, whose `triggerProps` a caller spreads
or does not get an `onClick` at all. **The counter-example is already here:**
`FacetedDecisionTable.tsx:311` takes `expandLabel`/`collapseLabel` as required props,
correctly translated — and still ships no `aria-expanded`, because the prop that was
required was the wrong one. *Requiring a prop only helps if it is the prop that carries
the contract.*

**4. The disclosure control's obligation to declare its state, at the ~56 sites that
will never route through a primitive — no. This is where a gate is the right
instrument.** Section headers, log strips, sidebar rails, cards: no signature can stop
someone writing `<button onClick={() => setExpanded(v => !v)}>` with a chevron inside. It
needs no import, it is three lines, and — the part that matters — **each instance is
individually correct as code.** There is no bug to find in `HealingTimeline.tsx:47`; the
defect is distributional, which is precisely what a ratcheting census counts. And the
destination clears the contract's fifth failure mode by construction: the destination is
**an attribute**, `aria-expanded={isOpen}`, which has no default to get wrong, no optional
argument to omit, and nowhere for a concern to relocate to.

**Where a type cannot reach at all: the fetch cache.** No signature can require that
`await` result be kept. The structural equivalent is not a type but Gap 1 owning the
expansion lifecycle so a caller can hang a `useQuery`-shaped cache off the row key — and
with a live population of two, this is a doctrine clause, not an enforcement target.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md),
what follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The
condition is stated first so an adopting repo can re-derive its own proxy rather than
inherit this one — the portability test measured four ported signals at **zero** true
positives each.

### The semantic condition, stack-free

> **C1 — a control that reveals or hides content does not declare that it does.** The
> state ends up expressed only in a picture (a rotated chevron, a swapped icon) or in the
> control's *name* (a label that flips between "Expand" and "Collapse"), both of which are
> invisible to anything that is not looking at the screen. The defect is silent in review
> because the control works perfectly for the person testing it.
>
> *Proxy here:* a `<button>` whose opening tag pairs an `onClick` with an
> expand/collapse-named toggle and contains no `aria-expanded`.
> *Precondition:* the repo builds disclosures from a real `<button>` element rather than
> a component library's `<Disclosure>`/`<Accordion>`, and does not have a headless UI
> dependency that supplies the attribute. A repo using Radix, Headless UI or Ark would
> find this rule matches zero and must key on its own idiom instead —
> `personas-web` and `brainiac/console` are both hand-rolled like this one and the proxy
> would transfer to both unchanged; a Radix repo would need to key on the `<Disclosure>`
> component's props instead.

### Checked first against the existing registry — no duplication

All **75** rules in `scripts/census/rules.json` were read. Three are adjacent and none
overlaps:

- **`unfocusable-click-target`** ([`focus-management.md`](./focus-management.md)) keys on
  `<div|span|li|tr|…>` with `onClick` + `cursor-pointer`. **Disjoint by element**: this
  rule matches only `<button>`. It already counts this leaf's one non-button disclosure
  (`ToneConsole.tsx:159`), which is why §7-D hands that site over rather than re-gating it.
- **`live-region-born-with-its-message`** ([`screen-reader-announcements.md`](./screen-reader-announcements.md))
  keys on `aria-live=` / `role="status"`. Disjoint by attribute; the two corpora share no
  file.
- **`hand-rolled-outside-click`** ([`anchored-popover.md`](./anchored-popover.md)) keys on
  `document/window.addEventListener('mousedown'|'pointerdown')`. Disjoint by construction
  — no expandable row registers a document listener.

### Conditions deliberately NOT given a rule — refusals, with measurement

- **C2 — expansion keyed by array position** (§7-A). **Refused, and the refusal is
  measured.** The pattern
  `[A-Za-z]*(?:xpand|ollaps|OpenRow|OpenItem)[A-Za-z]*\s*(?:===|!==|\.has\(|\.includes\(|\[)\s*\(?\s*(?:i|j|n|idx|index|rowIndex|itemIndex|position|pos)\b`
  matches **1 file, 1 site across all 4,829 files**. Baselined at 1, the gate fails
  structurally the moment the defect is fixed (`engine.mjs:264-273`: *"a rule pinned at 0
  is a gate that can never fail"*), so its entire lifetime is one commit long. The right
  instrument is the type (Type-over-gate §1) plus the one-line fix; a gate here would be
  ceremony. **Recorded rather than shipped so the next composer does not re-derive it.**
- **C3 — `focusedIndex` in `UnifiedTable`** (§7-A). One occurrence in one file, in a
  primitive. A census rule over a single known line is a worse instrument than fixing it;
  it is Gap 2 and it is sequenced first.
- **C4 — a panel mounted by a bare `{open && <…>}` instead of `<Collapse>`** (§7-F, 21
  surfaces). **Refused as a gate on a destination that is not sufficient.**
  `<Collapse>` is correct at what it owns, but routing callers to it would satisfy the
  gate while leaving the announcement (C1) untouched — the contract's fifth failure mode
  exactly. A proxy was also *measured and rejected*: `{X && <` is among the most common
  constructs in a React codebase, and restricting it to an expansion identity
  (`{expandedX === row.id && <`) matches **1 file** because 38 of 39 sites hoist the
  comparison into a local `const` one line earlier. Ship Gap 1 and Gap 4, then revisit.
- **C5 — the unbounded panel and the missing `measureElement`** (§7-F, §5). Both are
  absences near a positioned element; whole-file regex cannot express either without
  file-granularity false positives, and both are erased by Gap 1 and Gap 6 owning the
  panel. Not gateable honestly.
- **C6 — the rotating chevron as the only state.** Tempting (53 files, 29 without
  `aria-expanded`) and **rejected on precision**: the population is dominated by
  *dropdowns and selects* (`ThemedSelect`, `SortDropdown`, `ProjectFilter`,
  `ConnectorFilterDropdown`, `GitHubRepoSelector`, …) which belong to
  [`dropdown-and-select.md`](./dropdown-and-select.md), not here. A signal keyed on the
  markup a deviation happens to wear, firing across another path's corpus, is the exact
  failure the contract's §9 correction warns about.

### The rule — validated

Verified at the working tree with
`node scripts/census/run-census.mjs --rules <scratch> --check` → **exit 0**, reproducing
the baseline exactly, in **384 ms** for the whole 2,104-file `.tsx` walk.

```json
{
  "rules": [
    {
      "id": "stateless-disclosure-control",
      "goldenPath": "docs/concepts/golden-paths/expandable-row.md",
      "title": "A disclosure control that toggles hidden content without declaring aria-expanded",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "<button(?:(?!aria-expanded)(?:=>|[^<>])){0,1200}?(?:onClick(?:(?!aria-expanded)(?:=>|[^<>])){0,500}?(?:\\bset[A-Za-z0-9_$]*(?:Expand|Collaps)[A-Za-z0-9_$]*\\s*\\(\\s*(?!(?:true|false)\\s*\\))|\\bon[A-Za-z0-9_$]*(?:Expand|Collaps)[A-Za-z0-9_$]*\\b|\\btoggle[A-Za-z0-9_$]*(?:Expand|Collaps)[A-Za-z0-9_$]*\\b|\\b(?:is)?(?:Expanded|Collapsed|expanded|collapsed)\\s*[?&|])|(?:\\bset[A-Za-z0-9_$]*(?:Expand|Collaps)[A-Za-z0-9_$]*\\s*\\(\\s*(?!(?:true|false)\\s*\\))|\\bon[A-Za-z0-9_$]*(?:Expand|Collaps)[A-Za-z0-9_$]*\\b|\\btoggle[A-Za-z0-9_$]*(?:Expand|Collaps)[A-Za-z0-9_$]*\\b|\\b(?:is)?(?:Expanded|Collapsed|expanded|collapsed)\\s*[?&|])(?:(?!aria-expanded)(?:=>|[^<>])){0,500}?onClick)(?:(?!aria-expanded)(?:=>|[^<>])){0,1200}?[^=<>\\s]\\s*>",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a <button> opening tag that pairs an onClick with an expand/collapse-named toggle and carries no aria-expanded. PROXY FOR the stack-free condition: a control that reveals or hides content does not declare that it does, so the state survives only as a rotated chevron or a swapped label - a picture and a rename, neither of which is readable by anything not looking at the screen, and neither of which fails review because the control works perfectly for whoever tested it. PRECONDITION (must be re-derived per repo): this repo hand-rolls every disclosure from a real <button> and has no headless-UI dependency (Radix/Headless UI/Ark) that would supply the attribute; a repo using one would match zero here and must key on that library's component instead. TAG BOUNDARY: the tempered unit (?:=>|[^<>]) keeps matching inside one opening tag, and the terminator is [^=<>\\s]\\s*> rather than a bare > because a bare > is satisfied by the > of an arrow function - measured, that bug produced 5 false positives on <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>, where the match ended at the inner arrow and never reached the attribute that makes the site compliant. The setter arm excludes a literal true/false argument on purpose: one-way Show-more / Collapse pairs (ApiPlayground, BeatSidebar, TerminalSearchBar, MarkdownRenderer) carry the state in their label and the ARIA obligation is genuinely weaker, so they are dropped rather than counted. Bare onToggle is likewise excluded: it means toggle-anything in this repo and matched a sort header, a mic button and two multi-selects, all of which correctly use aria-pressed. Precision 57/59 at composition, verified against a second implementation (a brace-aware JSX tag parser); the 2 soft matches were DebuggerControls.tsx:106 and DebuggerVariables.tsx:38, the one-way halves of a two-button expand/collapse pair. BASELINE MOVED 2026-08-17: both soft matches were deleted with the unreachable sub_canvas tree (78e9bff68), taking the population 59->57 matches and 56->54 files, so precision reads 57/57 today - improved by DELETION, not by fix, and a later reader must not mistake the one for the other. 14 of the 54 files are expandable ROWS - this leaf's own corpus; the other 40 are section, panel and sidebar disclosures with the identical condition. Disjoint from unfocusable-click-target (focus-management.md), which owns non-button click targets and already counts this leaf's one <tr onClick> disclosure.",
        "$comment": "Recall is deliberately partial: it cannot see a toggle whose button lives in a child component while the state lives in the parent, nor a non-button disclosure. Both are stated in the golden path rather than papered over."
      },
      "baseline": { "files": 56, "matches": 59 },
      "floor": 2000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   stateless-disclosure-control     56     56       59     59    2104   2000
  census OK — 1 rule(s), 2104 file-visits, 59 surviving violation(s) across 56 file(s).
```

**No `exclude` entries.** There is no primitive file to exempt, because the destination is
an attribute rather than an import — and the one file that might have claimed an
exemption, the shared `FacetedDecisionTable.tsx:309`, is a **violation** and must stay
counted. An `exclude` invented to satisfy a convention is an allowlist entry with nothing
to allow, and the runner would be right to rot it.

### Precision and recall, measured against a second implementation

Per the contract's *"verify your §9 counts through a second implementation before
baselining them"*, the whole tree was scanned again by a structurally different tool: a
brace-aware parser that extracts each `<button …>` opening tag by balancing `{}` and
skipping `=>`, then tests the tag for `aria-expanded` directly.

| | |
| --- | ---: |
| impl A (regex) | **59 matches / 56 files** |
| impl B (tag parser), tags with onClick + an expansion token and no `aria-expanded` | 73 matches / 64 files |
| **A ⊆ B** — regex matches the parser rejects | **0** |
| parser matches the regex deliberately drops | 14 |

**The disagreements were the findings, twice.**

1. **A regex bug the parser caught.** An earlier pattern reported **74 matches / 64
   files**, and the parser flagged 5 of them as sites that *do* carry `aria-expanded`
   (`ExecutionSummaryCard.tsx:32`, `:69`, `AthenaChatSystemNote.tsx:110`,
   `DevOpLedger.tsx:117`, `PrBridge.tsx:341`). Cause: the pattern's terminating `>` was
   being satisfied by the `>` of an inner arrow function —
   `onClick={() => setExpanded((v) =>` is a complete match, 71 characters long, that never
   reaches the `aria-expanded` two lines below. Allowing `=>` as a tempered *unit* does not
   stop a bare `>` from matching one; the terminator had to become `[^=<>\s]\s*>`. **Five
   compliant, exemplary call sites would have been baselined as violations.**
2. **Parser false positives the regex rejected.** The 3 sites the parser found and the
   regex does not (`CompanionFooterIcon.tsx:204`, `AthenaOrbCornerActions.tsx:49`,
   `SidebarLevel1.tsx:220`) are all the parser's own error: it accepts the bare word
   `collapsed` anywhere in the tag, and those three match it inside a **code comment**, a
   **string literal** (`setState('collapsed')`) and an unrelated attribute. Here the
   regex is the more precise instrument. The other 11 drops are the deliberate one-way and
   bare-`onToggle` exclusions described in the signal.

**Hand verification of all 59.** Each match was read. **57 are unambiguous two-way
disclosure controls with no state declared.** The 2 soft matches are
`DebuggerControls.tsx:106` (`onExpandInspector`) and `DebuggerVariables.tsx:38`
(`onCollapse`) — the two halves of a one-way expand/collapse pair, where the ARIA
obligation is real but weaker. **Precision 96.6%.** Following
`unfocusable-click-target`'s and `hand-rolled-outside-click`'s precedent, they are
documented in the signal rather than excluded: an exclude is a permanent exemption that
can rot; a documented soft match costs one line of baseline and stays visible.

> **Post-publication — 2026-08-17. Precision is 57/57 now, and that is not good news.**
> Both soft matches lived in `teams/sub_canvas/` — `DebuggerControls.tsx` and
> `DebuggerVariables.tsx`, the dry-run debugger of the orphaned React Flow canvas — and the
> whole 29-file tree was deleted in `78e9bff68` as unreachable. The baseline moved
> **59 -> 57 matches, 56 -> 54 files**, which is exactly the two of them and is an
> independent confirmation that the hand verification above identified the right two sites.
> **But nothing was fixed.** The population shrank because the code was removed, and a
> ratchet that only reports the number cannot tell those apart. Read a precision that
> improves without a commit touching the pattern as a question, not as progress.

Two earlier drafts of this pattern were rejected on precision and are recorded so the
next author does not re-add them. A bare `\bon[Tt]oggle\b` arm matched a sort header
(`SortableColumnHeader.tsx:40`), a microphone button (`ChatInputBar.tsx:151`), a filter
pill (`FleetSummaryPills.tsx:39`) and a multi-select row
(`ExecutePersonaPicker.tsx:85`) — all four **correctly** using `aria-pressed`, which is a
gate firing on correct content. A `toggle*(Group|Row|Node)` arm matched an
expand-all/collapse-all button (`IncidentsInbox.tsx:574`, where `aria-expanded` would be
wrong — it controls no single region) and a row *selection* toggle
(`KnowledgeTree.tsx:249`, correctly `aria-pressed`).

**Recall is partial and the shortfall is named.** The rule cannot see (a) a toggle whose
`<button>` lives in a child row component while the state lives in the parent — 5 of this
leaf's surfaces pass `isExpanded` + `onToggle` down as props, and the child's button is
matched only if its own tag names the state; (b) the one non-button disclosure
(`ToneConsole.tsx:159`, owned by `unfocusable-click-target`); (c) one-way pairs, dropped
on purpose. Stated rather than papered over.

**Two tooling notes, both honoured deliberately.** The pattern lives in a **file** and was
never assembled inside a shell heredoc — the `\\s`/`\\S` mangling that silently produced
0 matches for a sibling path is a validator that checks nothing. And it uses **no
lookbehind** of any width: the arrow-terminator problem above is exactly what a `(?<!=)`
would have solved, and it was solved with a forward character class instead, which is why
the full run costs 384 ms.

### Positive control — the inverted, compliant form

A violation count proves nothing unless the matcher can be shown to *discriminate*. The
inverted form — the construct this path prescribes — was run as a rule through the same
runner, on the same `<button>`-tag anchor:

```json
{
  "id": "expandable-row-positive-control",
  "goldenPath": "docs/concepts/golden-paths/expandable-row.md",
  "title": "POSITIVE CONTROL (validation instrument, not for rules.json)",
  "roots": ["src"], "extensions": [".tsx"], "floor": 2000,
  "signal": {
    "pattern": "<button(?:=>|[^<>]){0,2000}?aria-expanded(?:=>|[^<>]){0,2000}?[^=<>\\s]\\s*>",
    "flags": "g", "ignoreCommentLines": true,
    "description": "the compliant form - a button opening tag that declares aria-expanded. Same tag-boundary machinery as the violation signal, pointed at the construct the path prescribes."
  }
}
```

```
  OK   expandable-row-positive-control     63      —       70      —    2104   2000
```

*(Published without `baseline` so the merger skips it, per `engine.mjs:363-387`.)*

| | files | matches |
| --- | ---: | ---: |
| violating (`stateless-disclosure-control`) | **56** | 59 |
| compliant (`<button … aria-expanded …>`) | **63** | 70 |
| **files carrying BOTH** | **2** | — |

The two populations are **98.3% disjoint by file** — union 117, overlap 2. Had the
violation signal been matching buttons in general rather than discriminating on the
absence, the compliant population would have been a superset rather than a near-disjoint
set. **And the two overlaps are themselves the finding**, which is the strongest evidence
in this document that §7-C is an oversight and not a policy:

- `PersonaDetailModal.tsx` — the **row** disclosure at `:271` lacks it; the section
  toggle at `:324` has it. One file, one author, one attribute, applied once.
- `LiveOpsStrip.tsx` — **two buttons toggling the same `expanded` variable**, `:55`
  without and `:114` with.

The control also *fails loudly on a wrong baseline* exactly like the shipped rule:
baselined at the violating rule's numbers it reports
`files rose 56 -> 63 (+7)` and `matches rose 59 -> 70 (+11)`.

**The positive control is deliberately NOT proposed for `rules.json`.** A census baseline
is monotone-downward by design — the runner treats a *rise* as a violation — so a rule
counting the compliant form would fail the build every time someone did the right thing.

### How it fails loudly if its own precondition is absent

Each failure mode was **induced and observed**, not assumed:

| induced fault | exit | reported |
| --- | :---: | --- |
| *(control — no fault)* | **0** | baseline reproduces exactly, 2104 walked |
| pattern → a token present nowhere | **1** | `files dropped 56 -> 0 (-56) … A silent drop is a broken matcher more often than fixed code` |
| `floor` raised to 9,000 | **1** | `[structural] walked 2104 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots` → `["srcc"]` | **1** | `0 file-visits` + the same drop-to-zero drift |
| baseline `files` 56 → 55 (a count rises) | **1** | `[drift] files rose 55 -> 56 (+1). New violations of docs/concepts/golden-paths/expandable-row.md` |
| baseline `matches` 59 → 72 (a silent drop) | **1** | `[drift] matches dropped 72 -> 59 (-13) without the baseline moving` |
| an `exclude` pointing at a missing file | **1** | `[structural] exclude "…" matched no file. The exemption is stale` |

`floor` is set at 2,000 against an observed walk of **2,104 `.tsx` files**
([`shared-facts.json`](../shared-facts.json) `frontend.tsxFiles`), consistent with
`unfocusable-click-target` and `live-region-born-with-its-message`, which use the same
roots and extension.

**On severity.** This is a census rule, not an ESLint rule, so the warn/error question
does not arise: `npm run census:check` fails the build on drift regardless. That is
deliberate and is the reason to put it here rather than in `eslint.config.js` — as
[`CLAUDE.md`](../../../.claude/CLAUDE.md) records, `npm run check` runs `eslint src/` with
no `--max-warnings` and the pre-commit hook passes `--quiet`, so **a warn-level rule
enforces nothing at either gate at any count.** The argument is structural, not
volumetric.

### Sequencing

1. **`ApiExplorerTab.tsx:111-112`** — key on `\`${ep.method}:${ep.path}\`` instead of `i`.
   One line, one live user-visible defect, no dependencies.
2. **`UnifiedTable.tsx:544` / `:752`** — carry the focused **row key**, derive the index.
   Must land *before* Gap 1 so the expansion slot is not built on a position cursor.
3. **Gap 3** — merge the two `useToggleSet`s onto the object API, delete the tuple. It is
   the destination for 60 hand-rolled toggles and today it is ambiguous which of two it is.
4. **The census rule**, which then ratchets §7-C shut while the backlog is worked. Start
   with `FacetedDecisionTable.tsx:311` (a shared primitive, and the label-swap
   anti-pattern's canonical instance) and the two split-brain files
   (`PersonaDetailModal`, `LiveOpsStrip`) where the correct form is already in the file.
5. **Gap 4** — `useDisclosure(id)` returning `triggerProps` + `panelProps`. This is what
   turns §7-C and P5 from a checklist into a spread, and it is small.
6. **Gap 1** — port `personas-web`'s `DataTable.expandable` surface onto `UnifiedTable`
   with `<Collapse>` as the reveal and `getRowKey` as the identity, plus Gap 5's required
   mode union and Gap 6's default bound. `role="row"` on rows is a precondition. This
   unblocks `tables.md`'s two blocked migrations (`ScraperControlRoom`, `ToneConsole`) and
   makes §7-A, §7-B and §7-C unrepresentable at every site it absorbs.
7. **`CompetitionSlotRow.tsx:81-93`** — cache the diff by slot id, on `ExecutionList`'s
   model. Independent of everything above.
8. **§7-I** — a test that expands a row, changes the sort, and asserts the same row is
   still open. There is currently nothing that would catch any of this coming back.
