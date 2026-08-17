# Golden path — Anchored popover

> Situation node: `ui-system/overlays/anchored-popover` (recurrence 74,
> `mergedFrom: ["Anchored popovers", "Click-outside dismissal"]`) ·
> [situation spine](../situation-spine.md)
> Composed 2026-08-14 at `2a874e692`. Sweep: **2,104 `.tsx` files** walked and
> **47,545 JSX opening tags** read through a brace/quote-aware tag scanner (not
> grepped), plus full reads of `QuickEditPopover`, `ListPopover`, `useClickOutside`,
> `useViewportClamp`, `useAnchoredPortalPosition`, `passportInk.anchorTip`,
> `PopoverPositioner`, `Tooltip`, `FieldHint`, `Listbox`, `ThemedSelect`,
> `BaseModal`, `ModalStackContext`, `FleetFooterIcon`/`FleetFooterPopover`,
> `EdgeDeleteTooltip`, `PersonaOverviewFilterHeader`, the whole `passport/improve`
> cluster, `MastermindPage`, the census engine + all 51 census rules, and a
> convergence census of **two** sibling repos (`personas-web`, `brainiac/console`).
> Dimensions: **ui · function · performance · code-quality** (the spine's four).
> **Settles:** how a surface anchored to a trigger is placed, dismissed, layered
> and announced — and who owns each of those four decisions.
>
> Corpus counts (`.tsx` file totals, lint baseline) are cited from
> [`shared-facts.json`](../shared-facts.json); everything else was measured during
> composition. Deviations become `violating` cells.

> **Post-publication note — 2026-08-17.** The `teams/sub_canvas/` tree (29 files, 3,200
> lines) was deleted in `78e9bff68` as unreachable, so `EdgeDeleteTooltip.tsx` — the §7
> deviation "a popover named a tooltip" — **no longer exists**. The deviation is kept
> because the naming defect recurs and [`tooltip.md`](./tooltip.md) carries the same one
> against a live site (`plugins/fleet/FleetFooterPopover.tsx:51`). Treat every
> `sub_canvas` citation below as history, not as code you can open.

---

## Correction to the brief, stated first

The handover said anchor measurement, viewport clamping and placement flip are
implemented **five** independent times. **Measured, it is eleven distinct
placement formulas across twenty-one sites in sixteen files** — see
[§7-A](#a-placement-is-written-eleven-different-ways--21-sites-16-files). The
five named in [`tooltip.md`](./tooltip.md#L150-159) are real and are all in the
list; the handover missed three shared helpers (`useAnchoredPortalPosition`,
`passportInk.anchorTip`, and the second exported function inside
`useViewportClamp`), six inline copies of one formula, and five caller-side
clamps in a single page component. `dropdown-and-select.md:425` had already
spotted one of the misses ("a seventh anchoring implementation") from a different
angle, so the undercount was visible in the corpus before this sweep.

Two further brief expectations did **not** survive measurement, and both are
reported where they belong rather than softened:

- **No listener leak exists in this corpus.** All **52** document/window press
  listeners registered by anchored surfaces are removed in the effect's cleanup;
  the repo-wide `visibilitychange`-with-no-`removeEventListener` is
  `src/lib/documentVisibility.ts`, a module-scoped app-lifetime singleton, not a
  popover. [§7-D](#d-dismissal-is-correct-per-site-and-incoherent-across-sites).
- **The `getBoundingClientRect` WebView2 scar is NOT inherited.** That scar is
  specific to `Tooltip`'s `display:contents` wrapper reporting 0×0
  (`Tooltip.tsx:253-260`); every popover measures a real element or is handed a
  real `DOMRect`. They inherit a *different* Chromium/WebView2 containing-block
  scar instead, and 7 of 63 are exposed to it. [§7-F](#f-the-webview2-inheritance-question-answered).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md)'s recommendations #1
and #2, the head is physically separated and every clause carries its **warrant**,
so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics.** A popover is a surface the user can *act inside*. That single
> property is what separates it from a tip: it must be reachable, focusable and
> operable, and it must be opened by an intentional press rather than by the
> pointer happening to pass over something.
>
> **P2 — physics.** A transient surface has exactly **two** dismissal channels and
> needs **both**: a press outside it, and Escape. Outside-press alone strands the
> keyboard; Escape alone strands the pointer. Shipping one is shipping half a
> dismissal, and which half you shipped is invisible in review because the other
> half is an absence.
>
> **P3 — physics.** The press that opens the surface must not also close it. Any
> implementation that listens for an outside press must answer this, and the
> answer is structural — the listener's scope, phase or attach time — not a
> matter of remembering.
>
> **P4 — physics.** A surface that takes focus must give it back. Focus enters on
> open, stays inside while open, and returns to the trigger on close. This is the
> same clause a modal obeys; being anchored rather than centred does not exempt it,
> because the user's focus went *somewhere* either way.
>
> **P5 — physics.** Placement is a measurement, not a constant. A surface pinned
> to a hardcoded side is correct until the trigger is near that edge, at which
> point it is off-screen. Whether it flips, where it clamps, and by how much are
> properties of the *system*, not of the call site — because two popovers that
> flip on different conditions are a visible inconsistency the user reads as a bug.
>
> **P6 — physics.** An anchor is a measurement taken at a moment. If the page can
> scroll, the container can resize, or the surface's own content can grow after it
> opens, then either the placement is recomputed or the surface is closed. Doing
> neither leaves a panel floating away from the thing it describes.
>
> **P7 — physics.** A surface positioned against the viewport must escape every
> ancestor that could clip or re-parent it. Overflow containers clip; transformed
> ancestors silently redefine what "the viewport" means for a fixed element. Both
> failures are invisible until the surface is opened in the one place that has one.
>
> **P8 — physics.** Layering is a shared vocabulary or it is a race. Every
> transient surface must express its depth in the same terms as every other
> surface it can co-exist with; a number chosen locally is a guess about code the
> author never read.
>
> **P9 — ergonomics.** The surface announces what it is. A container role plus an
> accessible name is the difference between "dialog, *Deploy upgrade for X*" and
> "group". A surface holding operable content must never claim the role reserved
> for supplementary text, because that role's contract is that nothing inside it
> can be reached.
>
> **P10 — ergonomics.** The surface's own name is user-facing copy, on the same
> footing as a label. It is translated, or the product is half-translated.
>
> **P11 — house convention, with evidence of need.** Placement, dismissal,
> layering and focus are **four orthogonal problems** and belong to one primitive
> that owns all four, not to four helpers a call site composes. *This clause was
> reinvented in neither sibling repo* — both hand-roll each popover end to end and
> neither has extracted anything. Adopt it as a proposal, not as received
> doctrine; it pays from roughly the tenth popover.
>
> **Scale condition.** P1–P4 and P9–P10 pay from the first popover. P5–P7 pay from
> the first popover that opens inside a scrolling or transformed container — which
> in a dashboard is the first one. P8 pays from the second overlay family. P11
> pays only at scale, and the two siblings below it are the evidence.

**Warrant evidence.** P1, P2, P3 and P9 were each independently re-derived in a
sibling repo with no shared code, no overlay library in its dependency tree, and
no sight of this document. `brainiac/console`'s `ColumnFilter.tsx:56-73` pairs
Escape with an outside `pointerdown`, registers both **only while open** (`:60`),
removes both in the cleanup (`:69-72`), and writes the reasoning into the comment
above it ("no listener is attached for the 99% of the session when this menu is
shut"). `personas-web`'s
`ModuleBadge.tsx:18-42` and `DashboardScopeBar.tsx:42-50` are the same pair,
independently, twice more — and `ModuleBadge.tsx:73` puts `role="dialog"` on the
panel while `DashboardScopeBar.tsx:105-126` uses `role="listbox"`/`option`, which
is P9 arrived at unaided. Three implementations, two stacks, no shared document.

**P4 is warranted by a sibling that has it and a repo that does not — the reverse
of the usual direction, and the most useful result in this document.**
`personas-web`'s `usePlatformCardDisclosure.ts:9-51` — a click-opened anchored
panel — moves focus to the panel's close button on open (`:15-18`), cycles Tab
inside it (`:29-46`), and returns focus to the card on close (`:9-12`). That is
the complete contract, hand-rolled, in a marketing site. **This repo implements it
zero times across 63 anchored popovers.** A codebase with no overlay primitive at
all got the clause a codebase with a primitive layer missed, which means the
clause is not a luxury of maturity.

**P5 is warranted by nothing in either sibling, and that is the finding.**
`personas-web` has **8** anchored surfaces and every one hardcodes its side
(`top-full`, `bottom-full`, `right-0`); `brainiac` exposes an `align?: "left" |
"right"` prop (`ColumnFilter.tsx:40`) and makes the caller decide. Neither repo
measures anything. By the contract's convergence heuristic, a clause with no
trace anywhere should be suspected of local calibration — and half of that
suspicion is correct. The *need* is real here and absent there: this app opens
popovers inside `overflow-x-auto` matrices, sticky table headers, `backdrop-blur`
chrome and a modal stack, none of which the siblings have. What is local
calibration is not the requirement but **the count**: eleven formulas is this
repo's pathology, not the problem's shape. Convergence measured discoverability
again — the siblings never discovered clamping because their popovers never went
off-screen.

---

## 1. Trigger

- "Clicking this badge should open a little panel with the details and a button."
- "Add a filter menu to this column header." / "Put the row's actions behind a ⋯."
- "Right-click a node should open a context menu."
- "Let them edit this field inline without opening a modal."
- "The dropdown is cut off by the panel / opens off the bottom of the screen."
- "Clicking outside should close it." / "Escape should close it."
- **If you are about to write** `useState(false)` named `open`/`showMenu` next to
  an `absolute top-full`, `document.addEventListener('mousedown'`,
  `e.currentTarget.getBoundingClientRect()` stored in state,
  `createPortal(…, document.body)` for a menu, a `z-[9995]`-shaped literal, or
  `role="dialog"` on something that is not centred — you are in this situation.

### The seam with `tooltip.md`, restated from the other side

[`tooltip.md`](./tooltip.md) drew the seam on one checkable question and handed
this path the two sites that sit on the wrong side of it. The question is:

> **Can the user act inside the surface?**
> **No → tooltip (there). Yes → anchored popover (here).**

It measured the split rather than asserting it; this sweep reproduces the
measurement and extends it. Across the **22** production `*Popover*` files: **0**
are hover-triggered. Across the full **63**-surface corpus defined in §7:
**1** is hover-triggered (`FleetFooterPopover`, and it is a deviation — §7-G),
**62** open on a press, and every one of the 63 contains at least one operable
control. The tooltip corpus's surface is `pointer-events-none` and holds no
controls at any of 194 sites. Two populations, opposite properties.

**Both handed-over sites are fixed here, and both are named in §7-G.**

### The seam with `dropdown-and-select.md` — the one that actually needed settling

[`dropdown-and-select.md:15-24`](./dropdown-and-select.md) states that it
**absorbs** a situation called *"Anchored popovers"* (recurrence 28), and that
*"where a popover is not a pick-one control (context menu, tooltip, hover card,
inline confirm) it belongs to the overlays concern and to `modals.md`"*.
[`modals.md:39`](./modals.md) states the opposite of the second half: *"Anchored
to a trigger → **not a modal**"*, and it lists eight anchored popovers as lint
false positives (`modals.md:111`).

So today **the non-pick-one anchored popover is owned by nobody**: `dropdown-and-select`
forwards it to `modals`, and `modals` forwards it back. That is the gap this leaf
exists to close, and it is why the spine records `mergedFrom: ["Anchored popovers",
"Click-outside dismissal"]` at recurrence 74 rather than 28.

The split, stated so neither path has to guess:

| Question | Owner |
| --- | --- |
| Which control do I use to pick one value from a list? | [`dropdown-and-select.md`](./dropdown-and-select.md) |
| Does this select have an accessible name / options / async states? | `dropdown-and-select.md` |
| **Where does an anchored surface get placed, and does it flip/clamp/reanchor?** | **here** |
| **How is an anchored surface dismissed, and by which channels?** | **here** |
| **What layer does it sit on, and does it escape its ancestors?** | **here** |
| **Does focus enter, stay, and return?** | **here** (contract) / [`focus-management.md`](./focus-management.md) (mechanism) |
| Is it centred and blocking, with a backdrop? | [`modals.md`](./modals.md) |
| Is the surface inert supplementary text? | [`tooltip.md`](./tooltip.md) |

One correction is owed to `dropdown-and-select.md:24`, which says *"there is
exactly one positioning primitive and it lives in `forms/`"*. There are **three**
shared positioners with disjoint adopter sets (`useAnchoredPortalPosition` 3,
`useViewportClamp` 5, `anchorTip` 4) plus eight more per-file formulas — §7-A.
Its D3 census (76 hand-rolled anchored menus) and this path's corpus overlap by
construction; where they name the same file, **this path owns the placement /
dismissal / layer / focus verdict and that path owns the pick-one verdict.**

### The seam with `focus-management.md`

[`focus-management.md`](./focus-management.md) owns *how* focus is moved, trapped
and restored, and its Deviation A audits the 23 hand-rolled overlays for exactly
that. It does **not** cover this corpus: its overlay population is the
`modals.md` list of centred surfaces, and **none of the 63 anchored popovers here
appears in it**. This path states the *contract* (P4) and the count (0 of 63);
the mechanism, the primitives (`BaseModal`'s capture/restore,
`useDeckDialog`'s cleanup-restore) and the ladder belong there. Where this path
proposes a primitive (§8 Gap 1), its focus half should be lifted verbatim from
`useDeckDialog.tsx:83-107`, not re-derived.

---

## 2. The one way

Open it on a press, never on hover, and give it both dismissal channels at once
by calling `useClickOutside(ref, open, onClose)` — one hook, three required
arguments, no optional half to forget — with the ref on a container that wraps
**both** the trigger and the panel, so the opening press is inside the ref and
cannot close what it just opened. Do not write your own `document.addEventListener`
for this; forty-six files already did and the repo now disagrees with itself about
which press event dismisses and when the listener may attach. If the panel must
escape a clipping or transformed ancestor, portal it to `document.body` and
position it with a **measured** anchor rather than a hardcoded side — and until the
shared positioner in §8 Gap 2 lands, take the placement from the nearest existing
helper (`useAnchoredPortalPosition` for a menu under a trigger element,
`anchorTip` for a rect you already captured) instead of writing a twelfth copy of
the arithmetic. Recompute or close on scroll and resize; a rect captured on the
opening click is stale the moment anything moves. Give the panel a container role
and a **translated** accessible name — `role="dialog"` + `aria-label` for a
surface with mixed content, `role="menu"`/`"listbox"` when it is a chooser —
and never `role="tooltip"`, which promises the user cannot reach anything inside.
Move focus into the panel when it opens and return it to the trigger when it
closes, on the `useDeckDialog.tsx:83-107` model, because a surface that takes
focus and drops it on `<body>` has stranded the keyboard user mid-task. Take the
layer from the modal stack's vocabulary, not from a literal you invented. And put
nothing operable in a `<Tooltip>`; the moment the user must click something in
there, you are here.

---

## 3. Mandated primitives

- **`src/hooks/utility/interaction/useClickOutside.ts` — `useClickOutside(ref, isOpen, onClose)`** —
  the sanctioned dismissal. Registers a `mousedown` **and** a `keydown` listener
  only while `isOpen` (`:17-18`), fires `onClose` on an outside press (`:20-24`)
  or Escape (`:26-30`), and removes both in the cleanup (`:34-37`). All three
  parameters are **required**, which is what makes it correct by default: there is
  no optional `enableEscape` to omit, so a call site cannot ship half a dismissal.
  **11 call sites in 11 files** against 46 files that hand-rolled it. Its one
  genuine limitation is portalled panels — see Gap 3.
- **`src/features/shared/components/overlays/QuickEditPopover.tsx` — `QuickEditPopover`** —
  the reference *composed* popover and the only one in the repo that gets the
  non-focus half right: portalled (`:77`, `:123`), `role="dialog"` + `aria-label`
  (`:80-81`), Escape + outside-press + ⌘/Ctrl+Enter (`:56-73`), flip-and-clamp
  placement (`:44-53`), a first-paint `visibility:hidden` so the pre-measurement
  frame never flashes (`:86`), a `@catalog` tag (`:29-34`), and — best of all — a
  **justified** `eslint-disable custom/enforce-base-modal` at `:1-5` that states in
  prose why a backdrop and a focus trap would be wrong here. Use it for any
  anchored edit affordance; copy its shape for anything else.
- **`src/features/shared/components/forms/useAnchoredPortalPosition.ts`** —
  placement for a menu portalled under a **trigger element**: measures the
  trigger, flips up when `flip: true` and there is more room above (`:44-48`),
  and **reanchors on scroll (capture) and resize** (`:57-61`) — the only
  positioner in the repo that satisfies P6. Its header comment records that it was
  extracted after `ThemedSelect` and `Listbox` each re-implemented the same dance.
  3 adopters. It does **not** clamp horizontally — Gap 2.
- **`src/features/teams/sub_factory/passport/passportInk.tsx:123` — `anchorTip(rect, w, h)`** —
  placement from a **`DOMRect` you already captured**: below-left, flipping above
  and clamping horizontally at a 12px margin (`:124-128`), with the P7 rationale
  written into its doc comment at `:119-122` (*"position:fixed resolves against
  transformed ancestors otherwise"*). 4 adopters. Use it rather than writing the
  arithmetic again — but read Gap 2 first, because it disagrees with its own
  neighbours.
- **`src/hooks/utility/interaction/useViewportClamp.ts` — `useViewportClampFixed` / `useViewportClampAbsolute`** —
  pure clamping (no flip) for a surface whose coordinates come from a pointer
  event rather than a trigger box: context menus, canvas overlays. 12px margin
  (`:4`), rAF-deferred measurement (`:31`, `:109`). 5 adopters.
- **`src/features/teams/sub_mastermind/lib/ListPopover.tsx` — `ListPopover` + `usePopoverDismiss`** —
  the one *shell* extraction in the repo, and the model for what §8 Gap 1 should
  become: its header (`:1-11`) records that six popovers had grown the same body
  and the same dismissal effect "duplicated verbatim five times". `usePopoverDismiss`
  (`:18-26`) is the deferred-attach variant of `useClickOutside` for a panel that
  is *not* inside the ref'd container. 6 consumers.
- **`src/lib/ui/BaseModal.tsx:8-10` — `Z_INDEX_BASE` 50 / `Z_INDEX_PORTAL_BASE` 10000 / `Z_INDEX_PER_DEPTH` 10** —
  the app's only layering vocabulary. **They are module-private today** (Gap 5);
  until they are exported, a popover that must clear a portalled modal needs a
  value above `10000 + depth*10`, and `ThemedSelect.tsx:162-166` is the one place
  that says so out loud.
- **`src/i18n/useTranslation.ts` — `t` / `tx`** — a popover's `aria-label` is its
  accessible name, and an accessible name is user-facing copy.

**Deliberately not mandated:** `@floating-ui/react`. It is declared in
`package.json:106` at `^0.27.19` and has **zero imports anywhere in `src/`** —
verified by a full-tree search. It is a dependency the app pays for and does not
use while eleven hand-rolled positioners argue with each other. Either adopt it
(Gap 2's alternative) or delete it; leaving it installed is the worst of both.

---

## 4. Steps

1. **Ask the seam question first: can the user act inside it?** No → stop, you
   want [`tooltip.md`](./tooltip.md), and do not put `role="dialog"` on it. Yes →
   continue. Is it centred, blocking, and about a decision? → stop, you want
   [`modals.md`](./modals.md)'s `BaseModal`.
2. **Open it on a press.** `onClick` on a real `<button>` that toggles state, with
   `aria-expanded` and `aria-haspopup` on the trigger. Never `onMouseEnter` — a
   hover-revealed surface with controls inside it cannot be entered by keyboard
   and is a deviation the moment it ships (§7-G).
3. **Wire dismissal with one call, not two listeners.** Put a ref on a container
   that wraps trigger **and** panel, then `useClickOutside(containerRef, open, close)`.
   That container is what makes P3 structural: the opening press is inside the
   ref, so the handler's own containment test rejects it. **40 of the 63 surfaces
   in this repo already use exactly this shape; they just wrote the listener by
   hand.**
4. **If — and only if — the panel must be portalled**, the container trick stops
   working, because the panel is no longer a descendant of the ref. Use
   `ListPopover.tsx:18-26`'s `usePopoverDismiss` (deferred attach) or guard both
   refs as `Listbox.tsx:93-103` does. Do not invent a third answer; there are
   already three and they are §7-D.
5. **Choose placement by what you have, not by writing arithmetic.** A trigger
   element ref → `useAnchoredPortalPosition(ref, open, { flip: true })`. A
   `DOMRect` captured from the click → `anchorTip(rect, w, h)`. Pointer
   coordinates → `useViewportClampFixed(ref, x, y, open)`. **If none of them fits,
   stop and read Gap 2 before typing `window.innerHeight`** — the repo does not
   need a twelfth formula, it needs the shared one.
6. **Recompute or close when the world moves.** `useAnchoredPortalPosition` does it
   for you. If you positioned from a captured rect, either add scroll/resize
   listeners or close on them — `PersonaOverviewFilterHeader.tsx:64-79` documents
   the close-instead-of-reanchor choice and is a legitimate answer. Doing neither
   is the default, and it is wrong at 11 sites.
7. **Escape the ancestors.** If any ancestor has `overflow` clipping, a transform,
   or `backdrop-blur`, portal to `document.body`. `position: fixed` inside a
   transformed ancestor resolves against **that ancestor**, not the viewport —
   `passportInk.tsx:119-122` records this, and 7 surfaces are exposed to it.
8. **Declare the layer from the shared vocabulary.** Above a portalled modal means
   `> 10000 + depth*10` (`BaseModal.tsx:8-10`). Below everything means the
   Tailwind scale. Do not invent a number; the repo already has thirteen.
9. **Announce it.** `role="dialog"` + a translated `aria-label` for mixed content;
   `role="menu"` + `menuitem`, or `role="listbox"` + `option` + `aria-selected`,
   for a chooser. `aria-expanded` + `aria-haspopup` on the trigger. Never
   `role="tooltip"`.
10. **Own focus.** Move it into the panel on open, return it to the trigger on
    close, on `useDeckDialog.tsx:83-107`'s model (capture on mount, restore in the
    **cleanup**, so it survives unmount). This is the step nobody in this repo has
    ever taken — 0 of 63 — and step 10 is why §8 Gap 1 proposes a primitive rather
    than a checklist.
11. **Ask the type question before reaching for a gate.** *Can the signature make
    the wrong call impossible?* For this situation it can, twice — see
    [Type over gate](#type-over-gate--the-answer).
12. **And then stop.** A correct call site is a trigger, a ref, one hook call and
    a panel.

---

## 5. Anti-patterns

- **A hover-revealed surface with a button inside it.** The pointer can reach the
  button; the keyboard cannot, because the same blur that would let you Tab toward
  it unmounts the surface. `FleetFooterIcon.tsx:100-101` + `:137` is the live
  instance and the mechanism is exact: `onBlur={() => setHovered(false)}` on the
  trigger, `{hovered && <FleetFooterPopover/>}` below it.
- **`role="tooltip"` on a surface holding operable content.** Announces
  "supplementary, nothing here can be reached" about a panel the user must
  operate. `FleetFooterPopover.tsx:53`. Independently shipped in `personas-web`
  too (`CopyButton.tsx:104`, a `role="tooltip"` span containing a focusable
  `<textarea>`), which makes it a trap in the problem rather than a slip in one
  team.
- **`role="dialog"` with no way out.** Three surfaces announce themselves as a
  dialog and implement neither Escape nor outside-press:
  `ShareAgentButton.tsx:62`, `TeamPublishButton.tsx:64`, `FindingBadge.tsx:210`.
  The role sets the expectation that Escape works; it does not.
- **Naming a popover a tooltip.** `EdgeDeleteTooltip.tsx` has a delete button, a
  connection-type switcher and outside-press dismissal. The name is why the next
  person will copy the wrong shape — and the shape it teaches is the one that
  omits Escape, which this file also does.
- **Naming a full-app deck a popover.** `QuickAnswerPopover.tsx:1-13` documents
  that it *used* to be a 576px anchored panel and is now a full-app triage deck.
  The name survived the redesign and now mis-routes readers into this path.
- **Writing your own `document.addEventListener('mousedown', …)`.** 46 files. Each
  one is individually correct and collectively incoherent: three different
  answers to P3, two different press events, and Escape present in some and absent
  in others. The hook that does all of it correctly has existed the whole time.
- **Dismissing on outside press without Escape.** 23 of 63. The pointer user can
  leave; the keyboard user is stuck inside a surface they may not be able to
  Tab out of, because nothing put them in it either.
- **Positioning by hardcoded side.** `absolute top-full` / `bottom-full` is
  correct until the trigger is near that edge. `dropdown-and-select.md:428-431`
  counts 10; the whole class is why P5 exists.
- **Copying a placement formula into a new file.** Six files carry the same
  flip-and-clamp expression (§7-A). They agree *today*; the passport folder next
  door already proves what happens next, where `anchorTip` and the inline copy
  clamp at 12px and 8px and flip on different conditions.
- **Capturing a rect on click and never re-measuring.** The panel drifts away from
  its trigger on the first scroll. 11 sites.
- **A panel that grows after it opens with placement pinned to `[anchor]`.**
  `DeployPopover.tsx:33-40` measures `offsetHeight` once; its body
  (`ImproveClassicPanel`) renders engine-driven content. **There is exactly one
  `ResizeObserver` in the entire 63-file corpus.**
- **`position: fixed` with no portal.** Resolves against the nearest transformed
  ancestor, and this app is full of them. 7 sites.
- **Inventing a z-index.** Thirteen distinct layers across the corpus, none from a
  shared constant, and two shared form primitives that disagree by 210
  (`Listbox.tsx:205` at 9990, `ThemedSelect.tsx:165` at 10200) about the same
  question — whether to clear a portalled modal.
- **Letting the caller guess the panel's size.** `MastermindPage.tsx:704,708,851-853`
  clamps five popovers against five hardcoded width/height pairs the popovers
  themselves never declare. When a panel grows, the clamp silently stops working.
- **A hardcoded English `aria-label` on a popover.** The panel's accessible name is
  the only name it has. 18 instances, including all six of the `role="dialog"`
  passport surfaces.

---

## 6. Evidence

**The one site to copy:**
`src/features/shared/components/overlays/QuickEditPopover.tsx`. It is the only
surface in the repo that satisfies P1, P2, P3, P5, P7, P9 and P10 together, and
its `eslint-disable` comment at `:1-5` is the model for how to justify *not*
using `BaseModal` — it names the four things a backdrop/trap/centred layout would
get wrong for an anchored affordance. It fails P4 (focus) and P6 (reanchor) like
everything else here; those are Gaps, not call-site defects.

- `…/QuickEditPopover.tsx:44-53` — flip-above-when-tight + horizontal clamp,
  measured in a `useLayoutEffect` so no unpositioned frame is ever painted, with
  `:86`'s `visibility: pos ? 'visible' : 'hidden'` as the belt to that braces.
- `…/QuickEditPopover.tsx:56-73` — the complete dismissal effect: Escape,
  outside-press, a save accelerator, the `setTimeout(…, 0)` deferral that answers
  P3 for a portalled panel, and a cleanup that clears the timer **and** removes
  both listeners. If you must hand-roll, hand-roll this.
- **`src/hooks/utility/interaction/useClickOutside.ts:12-38`** — three required
  parameters, both channels, conditional registration, symmetric cleanup. The
  destination §9 routes callers to, and the reason that gate is honest: there is
  no optional argument to forget.
- `src/features/teams/sub_mastermind/lib/ListPopover.tsx:1-26` — the only shell
  extraction, with the duplication it killed written into the header and the
  reason the rows were *not* abstracted written beside it ("flattening that into a
  config object would trade real duplication for a worse abstraction"). This is
  the shape §8 Gap 1 should generalise.
- `src/features/shared/components/forms/useAnchoredPortalPosition.ts:36-64` — the
  only positioner that reanchors on scroll *with capture* (`:57`), so it survives a
  scrollable ancestor rather than only the window.
- `src/features/agents/components/allPersonas/PersonaOverviewFilterHeader.tsx:64-79`
  — the **other** legitimate answer to P6, with its reasoning in the comment: a
  fixed panel anchored once on open is closed rather than reanchored, and the
  option list's own scrolling is explicitly excluded from that. Deliberate, stated,
  correct.
- `src/features/teams/sub_factory/passport/passportInk.tsx:119-129` — `anchorTip`,
  and the two-sentence doc comment that is the repo's clearest statement of P7.
- `src/features/shared/components/forms/ThemedSelect.tsx:162-166` — the one place
  in the repo that reasons about layering out loud, naming `Z_INDEX_PORTAL_BASE`
  and why the dropdown must clear it. It is a comment quoting a private constant,
  which is Gap 5, but the reasoning is right.
- `src/features/shared/components/forms/Listbox.tsx:90-105` — both dismissal paths
  in one component with the reason for the split in the comment: the hook for the
  non-portal path, a two-ref guard for the portal path. It is also the single file
  where this path's violation signal and its positive control both fire (§9).
- `src/features/agents/components/PopupIconSelector.tsx:25-26` — the smallest
  correct composition in the repo: `useClickOutside(containerRef, open, close)` +
  `useViewportClampAbsolute(popupRef, open)`, two lines, no listeners, no
  arithmetic.

---

## 7. Deviations found

Everything below shipped under a green `npm run check`. The lint baseline is
**1,135 warnings / 0 errors** ([`shared-facts.json`](../shared-facts.json)); the
only rule that touches this corpus at all is `custom/enforce-base-modal`, and all
eight of its firings here are **false positives** where migration would be wrong
(`modals.md:111`).

### The corpus, defined so it can be audited

A file is in the corpus if it (a) registers a document/window press listener for
outside-dismissal **or** calls `useClickOutside`, or (b) is named `*Popover*`.
That yields **70** files; **1** is a test and **6** are not anchored popovers and
were removed by reading them:

| removed | why |
| --- | --- |
| `ExecutionMiniPlayer.tsx` · `TeamMemoryPanel.tsx` | `mousemove`+`mouseup` drag/resize, not dismissal |
| `DriveImageLightbox.tsx` | pan-drag inside a centred lightbox — `modals.md`'s |
| `NavHistoryShortcuts.tsx` | reads the mouse's back/forward **buttons** |
| `TestReportModal.tsx` | a modal using `useClickOutside` as backdrop dismissal — `modals.md`'s |
| `QuickAnswerPopover.tsx` | a full-app triage deck; misnamed (anti-pattern above) |

**Corpus: 63 production anchored surfaces.** The definition is deliberately
dismissal-or-name, so it is *complete for surfaces that dismiss* and
**incomplete for surfaces that do not** — that tail is enumerated where it is
known (`dropdown-and-select.md:408-412` lists 10; this sweep adds three
`role="dialog"` ones) and is explicitly not claimed as exhaustive.

### A. Placement is written **eleven** different ways — 21 sites, 16 files

Parsed and read, not grepped. Every site that turns an anchor into coordinates:

| # | formula | sites | flip | clamp | gap | margin |
| --- | --- | ---: | --- | --- | ---: | ---: |
| F1 | `display/Tooltip.tsx:41-106` | 1 | 4-way, with a fits-check on the flipped side | both axes | 8 | 6 |
| F2 | `useViewportClamp.ts:18` + `:74` (**same body twice**, `:38-52` ≡ `:86-100`) | 2 | none | both axes | — | 12 |
| F3 | `forms/useAnchoredPortalPosition.ts:41-55` | 1 | up, only if more room above | **none** | 4 (8 for `ThemedSelect`) | — |
| F4 | `passport/passportInk.tsx:123-129` `anchorTip` | 1 | up, whenever it would overflow | horizontal | 8 | 12 |
| F5 | the inline copy — `QuickEditPopover.tsx:44-53` · `WarningBadge.tsx:76-85` · `DeployPopover.tsx:33-40` · `ImprovePopover.tsx:53-60` · `StandardsScan.tsx:72-78` · `IdeaScanPopover.tsx:69-73` | **6** | up, only if more room above | horizontal | 6 | 8 |
| F6 | `sub_diagrams/PopoverPositioner.tsx:23-49` | 1 | horizontal, canvas-space (`scrollWidth`) | left only | 16 | 8 |
| F7 | `display/FieldHint.tsx:25-29` | 1 | up, on a **guessed 120px** height | none | — | — |
| F8 | `PersonaOverviewFilterHeader.tsx:83-94` | 1 | none | none (closes instead) | 4 | — |
| F9 | `studio/StudioTabBar.tsx:112-118` | 1 | none | horizontal | — | 8 |
| F10 | `lib/dev/devInspectorUi.tsx:58-59` | 1 | up | both, hardcoded extents | — | 4 |
| F11 | `MastermindPage.tsx:704,708,851,852,853` — caller clamps against five hardcoded W/H pairs the panels never declare | **5** | none | both | 10 | 0 |

**Four different viewport margins (4, 6, 8, 12) plus "none". Five different
trigger gaps (4, 6, 8, 10, 16). Five different flip policies.**

**They disagree where it is visible.** `ImproveSurface.tsx:52,55,57` routes one
row's click — with **one** `DOMRect` — to three sibling popovers:
`DataLinksPopover` (F4, `anchorTip`: 8px gap, 12px margin, flips whenever it
overflows), `ImprovePopover` (F5: 6px gap, 8px margin, flips *only* if there is
more room above) and `DeployPopover` (F5). In the band where the panel overflows
the bottom **and** there is even less room above, F4 flips and clamps to the top
edge while F5 does not flip at all. Same trigger, same rect, same folder,
different behaviour — and `WarningBadge.tsx:5` names its own lineage in a comment
("Mirrors QuickEditPopover's positioning"), which is how a copy is documented
instead of prevented.

**Nobody adopted the library that was installed.** `@floating-ui/react ^0.27.19`
sits in `package.json:106` with **zero imports in `src/`**.

### B. No anchored popover owns focus — **0 of 63**

| clause | sites |
| --- | ---: |
| moves focus into the panel on open | **0** |
| traps Tab while open | **0** — no `key === 'Tab'` anywhere in the corpus |
| returns focus to the trigger on close | **0** — no `activeElement` anywhere in the corpus |

Eight files call `.focus()` at all (`PersonaSelector`, `FabricSearch`,
`DriveToolbar`, `TwinPicker`, `Listbox`, `ThemedSelect`, `ComponentFilterDropdown`,
`ConnectorFilterDropdown`) and every one of the eight is focusing a *search input*
inside a chooser, not implementing a focus contract. So a user who opens
`DeployPopover` with the keyboard is left with focus on the trigger behind a panel
they cannot enter; a user who closes any of the 63 lands on `<body>`.

**This is the clause a sibling repo has and this one does not** —
`personas-web/src/components/sections/vision-grid/platform-card-tile/usePlatformCardDisclosure.ts:9-51`,
hand-rolled, complete. See the head's warrant for P4.

### C. Escape is present at **40 of 63**; 23 dismiss on press only

35 implement Escape directly (29 with their own `'Escape'` handler, 11 through
`useClickOutside`, overlapping in `Listbox`); 5 more inherit it from
`ListPopover`'s `usePopoverDismiss` (`CategoryPopover` · `DimListPopover` ·
`KpiListPopover` · `PersonaListPopover` · `RunnerListPopover`).

**The 23 with no Escape:** `PersonaSelector.tsx` · `UseCaseFixtureDropdown.tsx` ·
`HomeCustomizePopover.tsx` · `MetricHelpPopover.tsx` · `ProjectFilter.tsx` ·
`DayRangePicker.tsx` · `CompanionToolbar.tsx` · `VoiceControlPopover.tsx` ·
`MoveToWorkspaceButton.tsx` · `SwitcherBreadcrumb.tsx` · `FleetFooterPopover.tsx` ·
`InlineConfirm.tsx` · `BreadcrumbTrail.tsx` · `DesktopFooter.tsx` ·
`ColumnDropdownFilter.tsx` · **`ThemedSelect.tsx`** · `EdgeDeleteTooltip.tsx` ·
`NodeContextMenu.tsx` · `TeamToolbar.tsx` · `FleetListPopover.tsx` ·
`NodePopover.tsx` · `PopoverPositioner.tsx` · `AdminToolsDropdown.tsx`.

**`ThemedSelect` is the one that matters**, because it is the app's mandated
pick-one primitive: its filterable mode attaches a `mousedown` listener at `:108`
and **no keyboard handling at all**, so every one of its 77 call sites inherits a
dropdown that cannot be closed with Escape. `Listbox`'s Escape is welded to an
optional `itemCount` (`dropdown-and-select.md:601-602`), which that path already
owns; this one is a plain absence.

Three more surfaces carry `role="dialog"` and dismiss on **neither** channel:
`ShareAgentButton.tsx:62` · `TeamPublishButton.tsx:64` · `FindingBadge.tsx:210`.
(`DemoNotice.tsx:20-23` also carries `role="dialog"` with no dismissal but is
`absolute inset-0` centred — `modals.md`'s, not this path's.)

### D. Dismissal is correct per site and incoherent across sites

**52** document/window press registrations across the corpus. **All 52 are
removed in the effect cleanup; 0 leak.** Every one is gated either on an `open`
guard inside the effect or on the component being mount-gated by `{open && …}` —
the four `passport/improve` surfaces whose effects have no internal guard
(`DeployPopover`, `ImprovePopover`, `DataLinksPopover`, `StandardsScan`) are
mounted only from `ImproveCell.tsx:98` / `MastermindPage.tsx:1011`, both `{open &&
…}`. **Checked specifically because the brief expected a leak; there is not one.**

What is incoherent is everything around the registration:

| | count |
| --- | ---: |
| dismissal press event: `mousedown` | 45 |
| dismissal press event: `mousedown`, via `useClickOutside` | 11 |
| dismissal press event: `pointerdown` | 1 (`FabricSearch.tsx:42`) |

| answer to P3 (the opening press must not close it) | count |
| --- | ---: |
| ref wraps trigger **and** panel, so the containment test rejects it | 40 |
| `setTimeout(…, 0)` before attaching the listener | 11 |
| `stopPropagation` on the trigger | 9 |
| guard **both** a trigger ref and a panel ref | 3 |

The `setTimeout` and two-ref answers exist because the first answer stops working
the moment the panel is portalled — which is a real constraint, not carelessness,
and is why Gap 3 proposes widening the hook rather than scolding the 11.

**Only 2 of 63 listen for scroll and only 1 for resize** — `PersonaOverviewFilterHeader`
(closes) and, through `useAnchoredPortalPosition`, `ThemedSelect` / `Listbox` /
`ProjectManagerParts` (reanchor). The other 11 rect-capturing surfaces do neither,
so their panel drifts off its trigger on the first scroll.

**One `ResizeObserver` in 63 files.** A panel whose content arrives asynchronously
is placed against the height it had before the content arrived.

### E. Layering — thirteen values, no vocabulary

Distinct layers used by the corpus: `z-10` · `z-20` · `z-30` · `z-40` · `z-50` ·
`z-[60]` · `z-[100]` · `z-[210]` · `z-[9990]` · `z-[9995]` · `z-[9996]` ·
`z-[9999]` · `z-[10200]`, plus `zIndex: 9999` and `zIndex: 10` set in style
objects. **None is imported from a constant**, because
`BaseModal.tsx:8-10`'s three constants are module-private.

The two places that reasoned about it did so in **comments quoting a number they
could not import** — `ThemedSelect.tsx:162-164` and
`ComposerPickerShell.tsx:77`. And the two shared form primitives reached opposite
conclusions:

| | portal-mode layer | vs `Z_INDEX_PORTAL_BASE` (10000) |
| --- | ---: | --- |
| `ThemedSelect.tsx:165` | `z-[10200]` | clears it — deliberate, documented |
| `Listbox.tsx:205` | `zIndex: 9990` | **below it** |

So a portalled `Listbox` opened inside a portalled `BaseModal` renders *under* the
modal. Latent rather than live today — only 1 of `Listbox`'s 13 call sites passes
`portal` (`dropdown-and-select.md:480`) — but it is one call site away, and the
comment two files over already explains why.

**There is no popover portal host.** All 11 portalled surfaces call
`createPortal(…, document.body)` independently; nothing coordinates them, which is
precisely why the z-values could diverge unnoticed.

### F. The WebView2 inheritance question, answered

**No.** `Tooltip.tsx:253-260`'s scar — a `display:contents` wrapper whose
`getBoundingClientRect()` is 0×0 in Chromium/WebView2, pinning the surface to the
viewport's top-left — is a consequence of `Tooltip`'s wrapper API. **No popover
has a wrapper**: 8 capture `e.currentTarget.getBoundingClientRect()` from a real
`<button>`, the rest are handed a `DOMRect` or pointer coordinates. There is no
`display:contents` anywhere in the corpus. The defect class does not transfer.

They inherit a **different** Chromium/WebView2 scar, and this one is real here:
`position: fixed` resolves against the nearest ancestor with a `transform`,
`filter` or `backdrop-filter` rather than against the viewport. This app is full
of such ancestors (`modals.md:24` mandates `portal` for exactly this reason, and
CLAUDE.md names `backdrop-blur` and framer-motion transforms). `anchorTip`'s doc
comment (`passportInk.tsx:119-122`) is the rediscovery, written by whoever hit it.

**7 of 63 use `fixed` with no portal** and are therefore exposed:
`ClipContextMenu.tsx` · `DriveContextMenu.tsx` · `StationPicker.tsx` ·
`EdgeDeleteTooltip.tsx` · `NodeContextMenu.tsx` · `IdeaScanPopover.tsx` ·
`ListPopover.tsx` (`:61`, in its `anchor="fixed"` mode — so all six of its
consumers inherit it). The canvas ones are the highest risk: a React-Flow canvas
applies a transform to its viewport layer by construction.

A third, milder inheritance: **the two-pass measure**. Six surfaces read
`panelRef.current?.offsetHeight ?? <constant>` in a `useLayoutEffect` and render
`visibility: hidden` for the pre-measurement frame. The fallback constants are
**220, 240, 260, 300, 360 and 200** — six guesses at the height of one shape
family. In practice the ref is already set when the layout effect runs, so the
constants are mostly dead code; they are a smell, not a live defect, and are
listed here so a future reader does not have to re-derive that.

### G. The two sites handed over by `tooltip.md`, and their exact defects

**1. `plugins/fleet/FleetFooterPopover.tsx:53` — `role="tooltip"` on a panel with a
button in it.** The trigger is `FleetFooterIcon.tsx:97-135`, a real `<button>`;
the wrapper at `:92-96` sets `hovered` on `onMouseEnter`/`onMouseLeave` and the
button at `:100-101` also sets it on `onFocus`/`onBlur`. The panel renders at
`:137` under `{hovered && …}` and contains an "open the Fleet page" button
(`FleetFooterPopover.tsx:107-115`).

The consequence is precise and worse than the role: **the button inside is
unreachable by keyboard**. Focus the trigger → `hovered` becomes true → press Tab
→ the trigger blurs → `hovered` becomes false → the panel unmounts before focus
can land in it. The escape hatch the component's own doc comment calls "its own
affordance" (`:31-33`) is mouse-only. *Fix:* open on press, not hover; give it a
container role and a name; `useClickOutside`.

**2. `teams/sub_canvas/components/edges/EdgeDeleteTooltip.tsx` — a popover named a
tooltip.** Delete action (`:123-130`), connection-type switcher (`:79-117`),
outside-press dismissal (`:38-46`), `useViewportClampFixed` (`:36`). Defects
beyond the name: **no Escape**, **no role and no accessible name**, and `fixed
z-50` with no portal (`:51`) inside a transformed canvas — the F-class hazard.
*Fix:* rename to `EdgeActionPopover`, swap the effect for `useClickOutside`,
`role="dialog"` + translated `aria-label`, portal.

### H. Announcement — 37 of 63 declare no role at all

| declared on the panel | files |
| --- | ---: |
| *(no role anywhere in the file)* | **37** |
| `role="dialog"` | 7 (+3 with no dismissal, §7-C) |
| `role="region"` | 6 |
| `role="menu"` (+ `menuitem`) | 5 |
| `role="listbox"` (+ `option`) | 4 |
| `role="tooltip"` | 1 — the deviation above |

`aria-expanded` on the trigger: **14 of 63**. `aria-haspopup`: **6**.

`role="region"` on a popover (6 files, the radio/companion cluster) is a landmark
role — it puts a transient menu into the page's landmark structure permanently.
`MetricHelpPopover.tsx:95` compounds its missing Escape with a `role="button"`
`<span>` trigger, which is [`focus-management.md`](./focus-management.md)'s
Deviation F shape.

### I. The accessible name is hardcoded English — 18 instances, 13 files with no i18n at all

**13 of 63 corpus files import no translation API**, including the entire
`passport/improve` cluster, `ListPopover`, `DimListPopover`, `Listbox`,
`ColumnDropdownFilter`, `SortDropdown`, `IconPopover` and `PopoverPositioner`.

**Every `role="dialog"` surface in the passport cluster names itself in English:**
`DeployPopover.tsx:56` (`Deploy upgrade for ${name}`) · `ImprovePopover.tsx:92`
(`Improve ${name}`) · `DataLinksPopover.tsx:81` (`Data-analysis links for ${name}`) ·
`StandardsScan.tsx:32` (`Standards scan`) + `:112` (`Standards: ${projectName}`) ·
`WarningBadge.tsx:45` (`${n} off-track signals need attention`) + `:108`
(`${projectName} needs attention`) · `passportWidgets.tsx:188` (`${label}: meaning`).
All four also ship an English `aria-label="Close"` (`DeployPopover.tsx:63` ·
`ImprovePopover.tsx:99` · `DataLinksPopover.tsx:88` · `StandardsScan.tsx:120`).
Outside the cluster:
`MetricHelpPopover` (`Help for ${label}`) · `WorkspaceEditMenu` (`Colour ${c}`) ·
`ColorRow` (`${label} color picker`) · `DesktopFooter` (`Theme: …`) ·
`DriveToolbar` (`Breadcrumb`).

This is the `role="dialog"` half of P9 defeating itself: the role is correct and
the name it exposes is untranslated, so a non-English user gets an announced
dialog with an English title.

### J. Checked, and **not** a deviation — the reduced-motion question

25 of the 63 surfaces carry an entrance animation (`animate-fade-slide-in` and
friends) and **0** reference `useReducedMotion` or `motion-reduce:`. A naive scan
reports 25 violations. It is wrong: `globals.css:4520,4532-4552` disables
`.animate-fade-slide-in` (and nine siblings) inside
`@media (prefers-reduced-motion: reduce)` and additionally forces
`opacity: 1; transform: none` so the element does not stay invisible. The
stylesheet is the backstop, so call-site silence is correct.
[`motion-and-reduced-motion.md`](./motion-and-reduced-motion.md) owns this and
nothing is owed to it. *Recorded because disproving it cost a measurement, and the
next composer should not have to spend it again.*

### K. Nothing tests any of this

One test file exists for the whole corpus —
`plugins/twin/shared/__tests__/ReadinessGapPopover.test.tsx` — and its seven
assertions are all about **content** (gap ordering, the "+N more" footer, the
jump callback). **Zero tests in the repo assert dismissal, Escape, placement,
flip, clamp, portal escape, layering or focus for any anchored surface.** So every
gap below could be fixed and silently regress. `brainiac/console` has a
source-parsing a11y contract test with a reasoned allowlist
(`src/design/focus-contract.test.ts`) — the mechanism this corpus needs,
independently built, in a repo with one popover.

---

## 8. Gaps in the primitives

> **Second pass — what is upstream of all of this.** Deviations A, B, C, D, E and
> F are not six problems. They are **one absence**: there is no primitive that
> owns an anchored surface. The repo owns a hook for *dismissal* (11 adopters),
> three helpers for *placement* (12 adopters between them), private constants for
> *layering* (0 adopters), and nothing at all for *focus*. Four orthogonal
> problems, four separate opt-ins, and a call site that composes three of them
> correctly and forgets the fourth looks exactly like one that composed all four —
> which is why `PopupIconSelector.tsx:25-26` (dismissal + clamp, no focus, no role)
> reads as exemplary and is 50% complete.
>
> `dropdown-and-select.md:551` reached the same decomposition from the select side
> ("A floating menu is four orthogonal problems — position, dismissal, keyboard,
> ARIA"). Two paths, two corpora, the same four axes. That is as close to internal
> convergence as this library gets, and it is the strongest argument that the
> primitive is the right object.
>
> **The convergence oracle inverted my expectation here, and it should be said
> plainly.** I expected the siblings to have solved placement, because placement is
> the visible half. They have not — neither measures anything, and `personas-web`
> has 8 anchored surfaces all pinned to a hardcoded side. What one sibling *did*
> solve, unaided, is the half this repo skipped entirely: `usePlatformCardDisclosure.ts`
> moves focus in, traps Tab and returns focus to the trigger. So the sibling with
> no primitive beat the repo with a primitive layer on the clause that has no
> visible symptom, and lost on the clause that does. Read that as a warning about
> what a repo notices: **this codebase fixed everything a user could see go wrong
> and none of what they could only feel.**

1. **No anchored-surface primitive.** `ListPopover.tsx` is the closest thing and it
   is scoped to one page's list popovers. A general `<AnchoredPopover>` would own
   all four axes — `anchor` (a ref or a rect), portal, placement with flip+clamp
   and reanchor, `useClickOutside`-equivalent dismissal, layer from the shared
   vocabulary, and the focus contract from `useDeckDialog.tsx:83-107`. That single
   component erases Deviations B, C, E and F at every call site it absorbs. It is
   the highest-leverage change in this document, and §Type-over-gate explains why
   its `role`/`label` props should be **required**.
2. **Three shared positioners, none of which is sufficient, and a fourth option
   already paid for.** `useAnchoredPortalPosition` reanchors but never clamps
   horizontally; `anchorTip` clamps but never reanchors; `useViewportClamp`
   clamps but never flips. Any surface that needs flip **and** clamp **and**
   reanchor must write F5 — which six files did. The merge is small (take
   `anchorTip`'s clamp, `useAnchoredPortalPosition`'s scroll/resize effect,
   `Tooltip`'s fits-check on the flipped side) and it retires eight of the eleven
   formulas. **Before writing it, evaluate `@floating-ui/react`**, which is already
   a declared dependency at `package.json:106` with zero imports and solves flip,
   shift, size and auto-update as its stated purpose. Adopting it or deleting it
   are both defensible; leaving it installed and unused is not.
3. **`useClickOutside` cannot serve a portalled panel.** It takes one `ref` and
   tests containment against it (`:21`), which fails when the panel is a portal
   sibling rather than a descendant. That single limitation produced the three
   competing answers to P3 in §7-D and the 11-file `setTimeout` lineage. **Fix:
   accept `RefObject | RefObject[]`.** `Listbox.tsx:93-103` already contains the
   two-ref implementation; lifting it into the hook converts 14 hand-rolls
   (11 `setTimeout` + 3 two-ref) into hook calls.
4. **`useClickOutside` binds `mousedown` and cannot be told otherwise.** One
   surface deliberately wanted `pointerdown` (`FabricSearch.tsx:42`) and had to
   hand-roll to get it. A `{ event }` option is two lines; without it the hook
   loses the callers most likely to be doing it right.
5. **The layering vocabulary is private.** `Z_INDEX_BASE`, `Z_INDEX_PORTAL_BASE`
   and `Z_INDEX_PER_DEPTH` are `const` at `BaseModal.tsx:8-10` with no `export`,
   so the only way to reason about depth is to read that file and transcribe the
   number — which two files did, in comments, and thirteen others did not do at
   all. **Export them, add `Z_INDEX_POPOVER_BASE` above the modal portal base, and
   `Listbox.tsx:205`'s 9990 becomes a one-line fix instead of a judgement call.**
6. **No shared portal host.** 11 independent `createPortal(…, document.body)`
   calls with no coordination. A single `<OverlayHost>` (or a `usePortalHost()`)
   would give the popover family one mount point, one layer origin and one place
   to add a future concern — and would make a second host visible instead of
   silent, which the toast-stack duplication earlier in this wave showed is a live
   failure mode here.
7. **Nothing re-measures a panel whose content grows.** One `ResizeObserver` in 63
   files. The positioner from Gap 2 should observe the panel, not just the window
   — otherwise every async-bodied popover (`DeployPopover`, `ImprovePopover`,
   `StandardsScan`) is placed against a height it no longer has.
8. **`ThemedSelect` has no keyboard dismissal at all.** `:108` attaches a
   `mousedown` listener and the file contains no `keydown` handling, so 77 call
   sites inherit a dropdown Escape cannot close. Two lines inside the primitive.
   (Its sibling defect — `Listbox`'s Escape gated on optional `itemCount` — is
   [`dropdown-and-select.md`](./dropdown-and-select.md) Gap 1's and is not
   re-litigated here.)
9. **`ListPopover` delegates placement to its callers and they guess.** `x`/`y`
   are props (`:41-45`) documented as "clamped by the caller", and
   `MastermindPage.tsx:704,708,851-853` duly clamps against five hardcoded
   width/height pairs — numbers that live nowhere near the panels whose size they
   describe. A shell that renders the panel should measure the panel.
10. **`FleetListPopover` opts out of dismissal entirely.** It passes
    `anchor="absolute"` (`:41`), which makes `ListPopover` pass a null ref and a
    no-op to `usePopoverDismiss` (`:56`), on the stated premise that "the canvas
    shell owns dismissal". The canvas shell owns outside-press; it does not
    implement Escape. An `anchor` mode that silently disables a WCAG-adjacent
    behaviour should at minimum keep the key handler.
11. **Nothing tests it.** §7-K.

**Not a gap:** `QuickEditPopover`'s justified `eslint-disable` (`:1-5`),
`PersonaOverviewFilterHeader`'s close-on-scroll (`:64-79`), `ListPopover`'s
refusal to abstract its rows (`:9-11`), and `useClickOutside`'s conditional
registration are all deliberate, all documented with their reasoning, and all
correct. Three of the four are also independently confirmed by a sibling repo.

---

## Type over gate — the answer

**Partly — and the honest split is that the two halves of this situation have
opposite answers, which is why §9 gates one of them and refuses the other.**

The contract asks §4 to pose the question before §9 writes a gate: *can the
primitive's signature make the wrong call impossible?*

**1. Placement: yes, and a gate would be wasted enforcement.** Eleven formulas
exist because there is no signature that *takes* an anchor and *returns*
coordinates for every case. Once `useAnchoredPosition(anchorRefOrRect, open,
opts)` exists (Gap 2), a call site that wants a placement has nowhere else to get
one — the arithmetic is not something they can forget, it is something they can no
longer reach. Eight of the eleven formulas vanish into one call each, and the
remaining three (`Tooltip`, `PopoverPositioner`'s canvas space, `devInspectorUi`)
are genuinely different problems. **This is the contract's own §9 lesson applied
ahead of the gate**: prefer fixing the default over counting the callers. A
ratchet on `window.innerHeight` would count them for exactly as long as it takes
someone to do the extraction, and would then have to be deleted — and it would
count badly, because the same expression is how a component checks a responsive
breakpoint (measured: 22 `.tsx` files use `window.inner*`, of which at least 4 are
breakpoint checks, not placement).

**2. The announcement and the focus contract: yes, by making the props
required.** This is the strongest available move and the contract already records
its shape three times — `brainiac`'s typed transaction handle,
`FacetedDecisionTable`'s required `emptyTitle` (3/3 real copy vs 5-of-20
fall-through), `personas-web`'s `createLazySection` (22/22 vs 2/31). An
`<AnchoredPopover>` whose props are `{ role: 'dialog' | 'menu' | 'listbox';
label: string; … }` — **both required** — makes §7-H's 37 role-less surfaces and
§7-I's unnamed ones unrepresentable, and it makes `role="tooltip"` on operable
content a type error rather than a review catch. The focus contract is not a prop
at all: like `focus-management.md`'s restore-in-cleanup, it is a guarantee the
component holds by being mounted, so 0-of-63 becomes 63-of-63 with no call site
touched. **The counter-example is in this corpus**: `Listbox`'s `itemCount` is
optional and 3 of 13 call sites silently ship with no keyboard at all.

**3. Dismissal: no — and this is the case where a gate is the right instrument.**
No signature can stop someone typing `document.addEventListener('mousedown', …)`.
It needs no import, it is four lines, every developer already knows it, and — the
part that matters — **each instance is individually correct**. There is no bug to
find in `DriveContextMenu.tsx:84` or `TeamToolbar.tsx:36`; the defect is
distributional, and a distributional defect is exactly what a ratcheting census
counts. The destination already exists and is already correct by default
(`useClickOutside`'s three parameters are all required, so a caller cannot obtain
half a dismissal), which is the precondition the contract's fifth failure
mode demands: *a gate on reaching a destination is only as good as the
destination's defaults.* Gap 3 is the one thing that makes the destination
insufficient today, and it is a signature change, not a redesign — so the honest
sequencing is **fix Gap 3, then ship the gate.**

**Where a type cannot reach at all: the layer.** No signature can require a
correct z-index, because the correct value depends on what else is on screen. The
structural equivalent is not a type but **an exported vocabulary** (Gap 5) plus a
stack context — the same move `modals.md` already made for modals. Thirteen
literals is what private constants produce; two comments quoting a number are the
evidence that people wanted to do the right thing and had no import to do it with.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md),
what follows is a *proxy* for a semantic condition, tuned to this repo's idiom.
The condition is stated first so an adopting repo can re-derive its own proxy
rather than inherit this one — the portability test measured four ported signals
at **zero** true positives each.

### The semantic condition, stack-free

> **C1 — a transient anchored surface wires its own dismissal contract instead of
> inheriting one.** When each surface owns the contract, the repo stops agreeing
> with itself: *which* press dismisses, *when* the listener may attach relative to
> the opening press, and *whether Escape comes with it* all become per-site
> decisions — and the third one is an absence, so it is invisible in review.
>
> *Proxy here:* a `mousedown`/`pointerdown` listener attached straight to
> `document`/`window` in a `.ts`/`.tsx` file.
> *Precondition:* this repo owns a shared dismissal hook that pairs outside-press
> with Escape and requires all three of its parameters, and uses no floating-UI
> library. A repo with neither would find this rule fires on 100% of its popovers
> — `personas-web` (3 hand-rolls, 0 shared) and `brainiac/console` (1 hand-roll,
> 0 shared) are both exactly that — and should read the 100% as the finding, not
> baseline it.

### Checked first against the existing registry — no duplication

All 51 rules in `scripts/census/rules.json` were read. Two are adjacent and
neither overlaps:

- **`native-title-tooltip`** ([`tooltip.md`](./tooltip.md)) keys on `title=` on a
  lowercase DOM tag. Disjoint by construction — different attribute, different
  channel, and its corpus is inert text.
- **`unregistered-key-handler`** ([`focus-management.md`](./focus-management.md))
  keys on `addEventListener('key(down|up|press)'`. **This already counts the
  Escape half of every popover in this corpus**, so this path deliberately does
  **not** propose a rule for the missing-Escape condition (§7-C's 23 sites) — it
  would double-count the 29 that *do* implement Escape and could not see the 23
  that do not, since the deviation there is an absence. The two rules are disjoint
  by event name (`key*` vs `mousedown|pointerdown`) and were verified to be so on
  the same corpus.

### Conditions deliberately NOT given a rule — refusals, with measurement

- **C2 — placement arithmetic written per file** (11 formulas, 21 sites, 16
  files). **Do not gate this. Ship Gap 2 instead.** One shared positioner erases
  eight of the eleven; a ratchet counts them meanwhile and must then be deleted.
  A proxy was also *measured and rejected*: `window.inner(Width|Height)` in
  `.tsx` matches **22 files / 54 occurrences**, of which at least 4 files are
  responsive-breakpoint checks (`PersonaHero.tsx`, `DesignInput.tsx`) and 2 are
  drag/tour clamps that are not anchored surfaces — ≥27% noise on the file
  count, against a signal whose whole value would be precision.
- **C3 — an anchored surface with no container role and no accessible name** (37
  and 18 sites). Not gateable honestly: the deviation is the *absence* of a
  `role`/`aria-label` near a positioned panel, and whole-file regex matching
  cannot express absence without file-granularity false positives. This is an
  ESLint shape (`custom/anchored-surface-requires-role`), with
  `role-button-requires-keydown.cjs` as the working AST precedent — and it should
  be written **after** Gap 1, so it has somewhere correct to route people.
  Recorded as the follow-up; not shipped here.
- **C4 — no focus contract** (0 of 63). Not gateable and not worth gating: a rule
  pinned at "63 of 63 fail" is a gate that can only ever be deleted, and the
  condition is erased entirely by one primitive owning focus by construction
  (Type-over-gate §2). Also, correctly, this is
  [`focus-management.md`](./focus-management.md)'s mechanism territory — this path
  contributes the corpus, not a second rule.
- **C5 — the layering vocabulary** (13 literals). Gap 5 turns this into an import;
  a census on `z-\[` would fire on every legitimate use in the app and is exactly
  the "keyed on the markup a deviation happened to wear" failure the contract
  warns about.

### The rule — validated

Verified at the working tree with
`node scripts/census/run-census.mjs --rules <scratch> --check` → **exit 0**,
reproducing the baseline exactly, in **3.2s** for the whole 4,829-file walk.

```json
{
  "rules": [
    {
      "id": "hand-rolled-outside-click",
      "goldenPath": "docs/concepts/golden-paths/anchored-popover.md",
      "title": "Anchored surface wiring its own document-level outside-press dismissal",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?:document|window)\\s*\\.\\s*addEventListener\\s*\\(\\s*['\"](?:mousedown|pointerdown)['\"]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a press listener attached straight to document/window, which in this repo is always the outside-click dismissal of a transient anchored surface. PROXY FOR the stack-free condition: a transient surface owns its own dismissal contract instead of inheriting one, so whether it closes on an outside press, on Escape, on both or on neither becomes a per-site decision - and the repo then disagrees with itself about which press event dismisses, when the listener may attach relative to the opening press, and whether Escape comes with it. PRECONDITION (must be re-derived per repo): this repo owns a shared dismissal hook (hooks/utility/interaction/useClickOutside.ts) that pairs outside-press with Escape and requires all three of its parameters, and no floating-UI library is in use; a repo with no such hook would find this rule fires on 100% of its popovers and should read that as the finding, not baseline it. Measured precision 46/47 matches and 45/46 files on the 2026-08-14 corpus, cross-checked by a second implementation that tests whether each file's handler calls .contains(e.target); the single false positive is src/lib/keyboard/NavHistoryShortcuts.tsx:52, where the mousedown listener reads the mouse's back/forward BUTTONS rather than dismissing anything. mouseup/click/touchstart are deliberately absent from the alternation: mouseup is this repo's drag-release idiom (ExecutionMiniPlayer, TeamMemoryPanel, DriveImageLightbox) and adding it drops precision without adding a single popover. Disjoint from unregistered-key-handler (focus-management.md), which owns the key* half of the same effects."
      },
      "exclude": [
        {
          "path": "src/hooks/utility/interaction/useClickOutside.ts",
          "reason": "the shared dismissal hook itself - the one destination this rule routes every other caller into, and the file whose disappearance must fail the gate rather than silently widen it"
        }
      ],
      "baseline": { "files": 46, "matches": 47 },
      "floor": 4000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   hand-rolled-outside-click     46     46       47     47    4829   4000
  census OK — 1 rule(s), 4829 file-visits, 47 surviving violation(s) across 46 file(s).
```

### Precision and recall, measured against a second implementation

Per the contract's *"verify your §9 counts through a second implementation before
baselining them"*, every match was re-checked by a structurally different test —
does the file's handler call `.contains(e.target)`, the defining shape of an
outside-press test?

| | |
| --- | ---: |
| regex matches | 47 across 46 files |
| confirmed by the containment test | 44 files |
| confirmed by reading (different local variable name — `Listbox.tsx:95-97`) | +1 = **45** |
| **false positives** | **1** (`NavHistoryShortcuts.tsx:52`) |
| **precision** | **97.8% of matches, 97.8% of files** |

The one false positive is **not** excluded by path. `unfocusable-click-target`
sets the precedent: a documented FP in the signal description is better than an
`exclude` entry, because an exclude is a permanent exemption that can rot, whereas
a documented FP costs one line of the baseline and stays visible.

Recall was bounded from the other side: the corpus (§7) was assembled
independently by a JSX-parsing scan over all 2,104 `.tsx` files, and **every
corpus member that hand-rolls dismissal is in the rule's hit list**. The rule
does not — and cannot — see the surfaces that dismiss on *nothing*
(`ShareAgentButton`, `TeamPublishButton`, `FindingBadge`), which is stated here
rather than papered over: those are C3's territory and are §7-C's list.

**Two tooling notes, both honoured deliberately.** The pattern lives in a **file**
and was never built inside a shell heredoc — the `\\s`/`\\S` mangling that
silently produced 0 matches for a sibling path is a validator that checks nothing,
which is precisely the §9 failure mode. And the pattern uses **no lookbehind**: it
chains forward anchors (`document|window` → `.addEventListener(` → a quoted event
name), which is why the full run costs 3.2s rather than the 73s a variable-length
lookbehind cost a sibling path.

### Positive control — the inverted, compliant form

A violation count proves nothing unless the matcher can be shown to
*discriminate*. So the inverted form — the construct this path prescribes — was
run as a rule through the same runner:

```json
{
  "id": "anchored-popover-positive-control",
  "goldenPath": "docs/concepts/golden-paths/anchored-popover.md",
  "title": "POSITIVE CONTROL (validation instrument, not for rules.json)",
  "roots": ["src"], "extensions": [".ts", ".tsx"], "floor": 4000,
  "signal": {
    "pattern": "useClickOutside\\s*\\(",
    "flags": "g", "ignoreCommentLines": true,
    "description": "the compliant form - a call to the shared dismissal hook."
  }
}
```

```
  OK   anchored-popover-positive-control    12     12       12     12    4829   4000
```

*(Published without `baseline` so the merger skips it; it was run locally with
`baseline: { files: 12, matches: 12 }`, which `validateRule` requires.)*

| | files | matches |
| --- | ---: | ---: |
| violating (`hand-rolled-outside-click`) | **46** | 47 |
| compliant (`useClickOutside(`) | **12** | 12 (11 call sites + the hook's own definition) |
| **files carrying BOTH** | **1** | — |

The two populations are **98.3% disjoint by file** — union 57, overlap 1. Had the
violation signal been matching overlay code in general, the compliant population
would have been a subset rather than a near-disjoint set. **The single overlap is
itself the finding**: `forms/Listbox.tsx` calls the hook for its non-portal path
(`:105`) *and* hand-rolls for its portal path (`:93-103`), in one file, with the
reason in the comment — which is Gap 3 stated in code, by the one author who hit
the limitation and worked around it correctly.

The control also *fails loudly on a wrong baseline* exactly like the shipped rule:
baselined at the violating rule's numbers it reports
`files dropped 46 -> 12 (-34)` and `matches dropped 47 -> 12 (-35)`.

**The positive control is deliberately NOT proposed for `rules.json`.** A census
baseline is monotone-downward by design — the runner treats a *rise* as a
violation — so a rule counting the compliant form would fail the build every time
someone adopted the hook. It is a validation instrument and it belongs in this
document, not in the registry.

### How it fails loudly if its own precondition is absent

Each failure mode was **induced and observed**, not assumed. The runner's
structural contract (`run-census.mjs:19-38`) was exercised against this exact rule:

| induced fault | exit | reported |
| --- | :---: | --- |
| *(control — no fault)* | **0** | baseline reproduces exactly |
| pattern → a token present nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` raised to 9,000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots` → `["srcc"]` | **1** | `[structural] walked 0 files but floor is 4000 …` + `matched zero files anywhere` |
| baseline `files` 46 → 45 (a count rises) | **1** | `[drift] files rose 45 -> 46 (+1). New violations of docs/concepts/golden-paths/anchored-popover.md` |
| baseline `matches` 47 → 60 (a silent drop) | **1** | `[drift] matches dropped 60 -> 47 (-13) without the baseline moving. A silent drop is a broken matcher more often than fixed code` |
| `exclude` path → a file that no longer exists | **1** | `[structural] exclude "…" matched no file. The exemption is stale` |

The `exclude` is load-bearing beyond the count: if `useClickOutside.ts` is ever
moved, renamed or deleted, the gate **fails structurally** rather than quietly
widening — which matters more for this rule than for most, because that file *is*
the destination the rule exists to route people to. A gate whose destination has
vanished must not report green.

`floor` is set at 4,000 against an observed walk of **4,829 `.ts` + `.tsx` files**
([`shared-facts.json`](../shared-facts.json) `frontend.tsFiles`), consistent with
`unregistered-key-handler` and `raw-select`, which use the same roots and
extensions.

**On severity.** This is a census rule, not an ESLint rule, so the warn/error
question does not arise: `npm run census:check` fails the build on drift
regardless. That is deliberate and is the whole reason to put it here rather than
in `eslint.config.js` — as [`CLAUDE.md`](../../../.claude/CLAUDE.md) records,
`npm run check` runs `eslint src/` with no `--max-warnings` and the pre-commit
hook passes `--quiet`, so **a warn-level rule enforces nothing at either gate at
any count**. The argument is structural, not volumetric.

### Sequencing

1. **Gap 3 first** — `useClickOutside` accepts an array of refs. It is a signature
   change that converts 14 of the 46 hand-rolls into hook calls and, more
   importantly, makes the gate's destination sufficient before the gate ships.
   Gap 4 (`{ event }`) rides along.
2. **Gap 5** — export the three z-index constants and add a popover base. One
   edit; it turns thirteen literals into a decision people can make correctly, and
   fixes `Listbox.tsx:205` on the way.
3. **The census rule**, which then ratchets the remaining hand-rolls shut while
   the backlog is worked. Start with the seven surfaces that have Escape but no
   role and the three `role="dialog"` surfaces that dismiss on nothing.
4. **Gap 2** — one positioner (or `@floating-ui/react`, or delete it). Eight of
   the eleven formulas collapse; Gap 7's `ResizeObserver` belongs in the same
   change.
5. **Gap 1** — `<AnchoredPopover>` with required `role` and `label` and a focus
   contract lifted from `useDeckDialog.tsx:83-107`. This is what makes §7-B's
   0-of-63 and §7-H's 37-of-63 unrepresentable rather than counted.
6. **The two handed-over sites** (§7-G) as the first two migrations, because they
   are the ones that are wrong in kind rather than in degree.
7. **C3's ESLint rule** last, once Gap 1 exists to route people to.
8. **Gap 8** — two lines of Escape handling inside `ThemedSelect`, at any point;
   it is independent of everything above and pays out across 77 call sites.
