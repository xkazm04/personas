# Golden path — Page scaffold

> Situation node: `ui-system/layout-and-navigation/page-scaffold` · [situation spine](../situation-spine.md)
> `sides: client` · `risk: medium` · recurrence **81** · convergence **mixed**.
> Dimensions: **ui · code-quality**. Absorbs the retired topic *Page and section scaffolding*.
>
> Composed 2026-08-14 against `master` from a ground-truth sweep: the **4,829**
> `.ts`/`.tsx` files under `src/` ([`shared-facts.json`](../shared-facts.json)),
> of which the **2,104** `.tsx` files were walked **five times by a TypeScript
> compiler JSX parser** — not grep — counting real element instantiations,
> attribute values, JSX-subtree containment and per-function return shapes. Read
> in full: the three scaffold primitives (`ContentLayout.tsx`), the two tab
> primitives, the three *competing* header primitives, both Suspense-fallback
> skeletons, and **17 content-router files** (the L1 section router plus every
> L2 tab dispatcher). Convergence checked read-only against `../personas-web`
> (Next.js App Router, 37 pages / 10 layouts) and `../brainiac/console`
> (Next.js, 14 console modules).
>
> **Sibling leaves — read the boundary before you read the prescription.**
> [`page-loading.md`](./page-loading.md) owns the *choreography inside* the
> frame: what a body region shows while it fetches. **This path owns the frame
> itself** — the box, the header band, the content region, who owns scroll, and
> what survives an empty or error state. The two meet at exactly one sentence,
> and it is `page-loading.md`'s law 1: *"render the static chrome
> unconditionally."* That law presupposes there **is** static chrome; this path
> is what builds it. Where a surface has no scaffold at all, `page-loading.md`'s
> prescription has nothing to hang on.
> [`lazy-route-chunk.md`](./lazy-route-chunk.md) owns the boundary *above* the
> frame (which module is a chunk, what stands in while it loads).
> [`modals.md`](./modals.md) owns overlays — a modal is **not** a page and must
> never render `ContentBox`.
> [`tier-and-capability-gating.md`](./tier-and-capability-gating.md) owns
> *whether a destination is offered*; this path owns what it looks like once it
> is.
>
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

> ### ⚠ Two corrections to the brief that commissioned this path
>
> 1. **"`CLAUDE.md` names `layout/PanelTabBar` and `layout/SegmentedTabs` as the
>    shared tab primitives — measure adoption against hand-rolled strips." The
>    measurement is real (§7 C) but the framing inverts the finding.** In this
>    app **a top-level page has no tab strip.** Every L2 tab id —
>    `homeTab`, `overviewTab`, `eventBusTab`, `templateTab`, `settingsTab`,
>    `pluginTab`, `devToolsTab`, `twinTab` — is set **exclusively** from
>    `SidebarLevel2.tsx` (`:183,:223,:243,:267,:313`) and
>    `PluginsSidebarNav.tsx` (`:146,:148,:267`). The sidebar rail **is** the tab
>    strip, and it is registry-derived, tier-gated, command-palette-reachable and
>    persisted. So a tab strip drawn inside the content area is not "the
>    hand-rolled version of `PanelTabBar`" — it is **a second navigation axis the
>    rest of the app cannot see**, and that is a much worse defect than a styling
>    inconsistency. `PanelTabBar`'s 2 call sites are not under-adoption; they are
>    the correct residue (§7 C).
> 2. **"Does any page produce a double scrollbar or a header that scrolls away
>    when it shouldn't?" — measured, and the answer to both is essentially no.**
>    Vertical scroll has exactly one owner per page (`ContentBody`'s inner
>    `h-full overflow-y-auto`, `ContentLayout.tsx:271`) and horizontal scroll
>    exactly one (`#main-content`, `PersonasPage.tsx:384`). Only **7 sites in 5
>    files** declare a scroll container inside a `<ContentBody>` subtree, and 3
>    of those are legitimately bounded inner panels. The header cannot scroll
>    away because nothing scrolls under it — `ContentBody` is a *sibling* with
>    its own clipped box, which `ContentLayout.tsx:161-169` states outright.
>    **This is the repo's strongest scaffold result and it should be recorded as
>    a cleared claim, not softened into a finding.** The real defect is one layer
>    up and the brief did not predict it: **three different header primitives**
>    and **six content routers that hand-copy the frame's own class string**.

---

## 1. Trigger

- "I'm adding a new page / tab / plugin sub-page — what does the shell look like?"
- "Where does the page title go? Why is my `<h1>` a different size from every other page's?"
- "This page needs tabs across the top."
- "My content is clipped / there are two scrollbars / the page won't scroll."
- "I need a header with a filter row and a couple of buttons — where do they go?"
- "The page jumps when the data arrives."

If you are about to type `<ContentBox`, `<ContentHeader`, `<ContentBody`, `<h1`,
`overflow-y-auto`, `min-h-0 flex flex-col`, a `border-b` band at the top of a
surface, or a `.map()` that renders a row of mutually-exclusive buttons above
your content — you are in this situation.

### Scope — what is and is not a "page"

| Surface | In scope | Owns the scaffold? |
|---|---|---|
| An L1 section primary (one of the 10 in `SECTION_ROUTES`, `sectionRouter.tsx:59-70`) | **yes** | yes, or its router does |
| An L2 tab (an Overview / Settings / Triggers / plugin sub-page) | **yes** | depends on the router's model — §2 |
| A panel inside a page body (a card, a list, a chart block) | no | never — use `SectionCard` / `SectionHeading` |
| A modal, drawer, popover | no — [`modals.md`](./modals.md) | never |
| A sidebar, footer, titlebar tray | no — app chrome, `src/features/shared/chrome/` | never |

---

## 2. The one way

**A page is exactly three nested elements and nothing else: one `ContentBox` as
the outermost element, one `ContentHeader` as its first child, one `ContentBody`
as its second.** That trio owns the frame, the band, and the vertical scroll,
and no fourth thing may claim any of them. Put the page's real name in
**`subtitle`** — that prop is the `<h1>` (`ContentLayout.tsx:184`) — and put the
short mono-uppercase context label in `title`; **never write your own `<h1>` on a
page surface**, because that is the one element the header primitive exists to
own and 18 surfaces currently take it back (§9). Scroll exactly once: everything
that scrolls vertically on a page scrolls inside `ContentBody`, so never put
`overflow-y-auto` on anything between `ContentBox` and your content, and never
give a page a viewport-relative height — `App.tsx:323` is the only `h-screen` in
the repo and every descendant inherits its bounds through the flex chain.
**Do not add a tab strip to the content area**: level-2 navigation is the
sidebar's job, declared once in `sidebarData.ts` and dispatched by
`SidebarLevel2.tsx`, so a strip you draw inside the page is a second navigation
axis invisible to the sidebar, the command palette, the tier gate and the test
harness; when a surface genuinely needs to switch *lenses over the same data*,
build one `SegmentedTabs` and hand it into the active view's header slot rather
than adding a second chrome bar (`ExecutionsWithSubtabs.tsx:34-43,50` — copy
this). Render the header **outside every conditional**: an empty state, an error
banner and a permission refusal all belong *inside* `ContentBody`, so the frame
never disappears. And then stop — do not write the frame's class string yourself,
do not build a second header band, and do not invent a page-level scroll
container; all three already exist and all three are being re-typed today (§7 A).

### The one genuine fork — which model does your router use?

Both are correct; **mixing them inside one router is not.** Decide once, at the
router, and write it in a comment:

- **Model A — the destination owns the scaffold.** The router renders a bare
  flex wrapper and each tab renders its own `ContentBox`/`Header`/`Body`. Reach
  for this **first**, and use it whenever the destinations have *different*
  headers. Used by `OverviewPage` (15 tabs), `SettingsPage` (13),
  `DevToolsPage` (7), `TwinPage` (7), `HomePage`, and the `teams` / `plugins`
  branches of `PersonasPage`.
- **Model B — the router owns the scaffold.** The router renders one
  `ContentBox` + one parameterised `ContentHeader` + one `ContentBody`, and each
  tab renders a bare body. Use it only when every destination shares one header.
  `TriggersPage.tsx:52-108,121-131` is the reference: a `TAB_HEADERS` record
  keyed by tab id feeds a single `ContentHeader`, so eight tabs get one band and
  it cannot drift. `DesignReviewsPage.tsx:40-74` and `ObsidianBrainPage.tsx:46-71`
  are the same shape.

The failure this fork produces is **model B-partial**: the router owns box +
header but *not* body, so each tab has to remember to supply the scroll region.
`TriggersPage`, `DrivePage` and `ResearchLabPage` are all in this state and only
2 of TriggersPage's 8 tabs actually render a `ContentBody` (§7 B).

---

## 3. Mandated primitives

- **`layout/ContentLayout` → `ContentBox`** (`ContentLayout.tsx:51-79`) — the
  page frame. `flex-1 min-h-0 flex flex-col w-full overflow-hidden` plus a
  responsive `min-w` ladder calibrated against the 328 px sidebar
  (`:70-74`). Provides `ContentLayoutContext`, which is how `ContentBody`'s
  scroll position reaches `ContentHeader`'s elevation shadow. Props:
  `minWidth` (only `minWidth={0}`, 4 sites, all under `teams/` for canvas
  surfaces) and `data-testid` (16 sites). **77 instantiations / 70 files.**
- **`ContentHeader`** (`:121-201`) — the band. `title` is the **small
  mono-uppercase caption**; **`subtitle` is the `<h1>`** (`:184`) — the naming is
  inverted relative to every other header in the repo and every sibling repo, and
  that inversion is load-bearing for §7 D and §8 gap 1. `actions` sits on the
  title row (39/68); **`toolbar`** drops controls to their own divided row below
  the title (`:193-197`) and is the collision-free home for filters and buttons —
  **1 of 68 sites uses it**; `children` renders after the toolbar and is the tab
  slot (5 of 68). `fitWidth` clamps the band to its container instead of the
  default `min-w-[80vw]` floor (2 of 68). **68 instantiations / 64 files.**
- **`ContentBody`** (`:221-294`) — the scroll region, and the **only** sanctioned
  one on a page. `relative flex-1 min-h-0` outer + `h-full overflow-y-auto`
  scroller + a `min-h-full` inner box that reserves full height so the layout
  does not jump between empty and loaded (`:273`). Ships top/bottom scroll-shadow
  gradients driven by `useScrollShadow` and publishes `scrolled` upward so the
  header can elevate. Props: `centered` (29), `flex` (12 — drops the padded inner
  box for empty-state centring), `noPadding` (3). **71 instantiations / 62 files.**
- **`layout/SegmentedTabs`** (`SegmentedTabs.tsx:27-174`) — the **only** tab
  strip you should build. Full WAI-ARIA: `role="tablist"` + `role="tab"` +
  `aria-selected` + `aria-controls` + roving `tabIndex` + Arrow/Home/End
  (`:75-99`), two variants (`pill` / `segment`), per-instance `layoutId` so two
  strips never share a framer-motion indicator. Pair it with
  `segmentedTabPanelProps(prefix, id)` (`:176-182`) on the panel.
  **21 instantiations / 18 files.**
- **`layout/PanelTabBar`** (`PanelTabBar.tsx:32-111`) — the *under-the-header*
  variant: it is designed to be a `ContentHeader` **child**, using negative
  margins (`:73`) to bleed to the band's edges and sit on its bottom border.
  Same roving-tabindex contract. **2 instantiations, both correct**
  (`CloudDeployPanel.tsx:192`, `GitLabPanel.tsx:122`). Read §8 gap 4 before
  adding a third: its bleed is hardcoded to the `md` breakpoint.
- **`layout/RouteChunkSkeleton`** (`RouteChunkSkeleton.tsx:31-45`) — the Suspense
  fallback. Owned by [`lazy-route-chunk.md`](./lazy-route-chunk.md); named here
  only because it renders `ContentHeaderSkeleton`, which is a faithful geometric
  mirror of `ContentHeader` (`ContentHeaderSkeleton.tsx:44-52` reproduces the
  padding ladder, `border-b`, `bg-primary/5`, `min-w-[80vw]` and `pr-20`
  exactly). **25 instantiations / 9 files.**
- **`layout/SectionCard` / `SectionHeading` / `SectionHeader` / `ActionRow`** —
  the *inside-the-body* rhythm. `SectionCard` 55/31, `SectionHeading` 20/12,
  `SectionHeader` 17/13, `ActionRow` 5/5. A block inside a page body gets one of
  these; it never gets a `ContentHeader`.
- **`sidebarData.ts` item arrays + `SidebarLevel2.tsx`** — where an L2 tab is
  *declared*. Adding a page means adding an entry here, not a button in the
  content area. See [`tier-and-capability-gating.md`](./tier-and-capability-gating.md)
  §3 for the gate fields.

**Deliberately not a primitive:** there is no `PageShell` that also owns data
loading, and there should not be. `ContentBox`/`Header`/`Body` are three elements
precisely so a router can own the first two and a tab the third (model B).

---

## 4. Steps

1. **Decide it is a page.** A routed destination that a sidebar entry or a router
   branch points at. If it is a panel inside another page's body, stop — you want
   `SectionCard` + `SectionHeading`, not this.
2. **Declare the destination in the sidebar**, not in the content area:
   an item in the relevant `sidebarData.ts` array (with `minTier` / `devOnly` if
   gated), and a branch in the owning router. `SidebarLevel2.tsx` gives you the
   strip for free.
3. **Read the router you are landing in and match its model** (§2). If it renders
   a bare wrapper, you own the triad. If it renders `ContentBox` + `ContentHeader`,
   you own only the body — and check whether it also renders `ContentBody`,
   because three routers today do not.
4. **Write the frame:** `<ContentBox data-testid="…"><ContentHeader …/><ContentBody>…</ContentBody></ContentBox>`.
   Never type its class string; if you find yourself writing
   `flex-1 min-h-0 flex flex-col w-full overflow-hidden`, you have re-implemented
   `ContentBox` (6 files do — §7 A1).
5. **Fill the header, in this order of preference:** page name → `subtitle`;
   context label → `title`; one or two compact controls → `actions`; **three or
   more controls, a filter row, a search box → `toolbar`** (its own divided row,
   which is what it exists for and what 67 of 68 sites are not using); a lens
   switcher → `children` with `PanelTabBar`.
6. **Never write an `<h1>`.** `subtitle` is the `<h1>`. If your design wants a
   large title and no caption, that is still `subtitle` — leave `title` short.
   Omitting `subtitle` ships a page with **no `<h1>` at all** (6 sites, §7 D2).
7. **Put every state inside the body.** Empty, error, "no project selected",
   "tier-gated" — all render *within* `ContentBody`, below the header. The header
   is never inside a conditional and there is never an early `return` that skips
   it. (Loading is the same rule and belongs to
   [`page-loading.md`](./page-loading.md) — do not re-derive it here.)
8. **Do not add a scroll container.** If content overflows, that is
   `ContentBody`'s job. A bounded inner scroller (`max-h-[400px]` on a side list)
   is legitimate; a second `flex-1 overflow-y-auto` between `ContentBox` and your
   content is not.
9. **And then stop.** No `h-screen`, no `min-h-screen`, no second header band, no
   `useState` tab strip, no re-typed frame class, no `<h1>`.
10. **Verify:** at a 1280 px window the page shows exactly one vertical scrollbar
    and the header band stays put while the body scrolls; the header's elevation
    shadow appears after ~8 px of scroll (proof `ContentBox`/`ContentBody` are
    correctly paired — that shadow only works through `ContentLayoutContext`).

### Can the primitive make the wrong call impossible? — answered before §9

The contract asks this above the gate, and here **the answer is yes for the
highest-value deviation and no for the rest** — which is itself the finding.

- **`ContentHeader.subtitle` should be REQUIRED. Yes — this is the big one and it
  is a one-line type change.** `ContentLayout.tsx:98` declares
  `subtitle?: ReactNode`, and `:183` renders the `<h1>` only when it is present.
  Six page-level surfaces omit it and therefore render **no `<h1>`**
  (`CloudDeployPanel.tsx:192`, `ProjectManagerPage.tsx:393`,
  `ScheduleTimeline.tsx:243`, `FactoryPage.tsx:18`, `GoalsPage.tsx:173`,
  `PresetStudio.tsx:47`). This is exactly the contract's own
  `FacetedDecisionTable.emptyTitle` precedent — a required prop gets 3/3 real
  copy where its optional-prop siblings get 5-of-20 fallbacks. Making it
  `subtitle: ReactNode` turns each of those six into a compile error with an
  obvious fix, **and it removes 6 of the 18 census violations without any gate
  ever firing.** Independent support from the siblings: `brainiac/console` has
  the same defect from the same cause — 2 of 14 console modules
  (`Observatory.tsx`, `DisputeBench.tsx`) have no `<h1>` at all, purely because
  the band is hand-assembled and nothing required one.
- **`ContentBox` should export its width ladder, or accept a `bare` variant. Yes,
  and it is the fix for §7 A1.** The six content routers cannot render
  `ContentBox` (nesting it inside a tab's own `ContentBox` would double the
  min-width ladder and the flex box), so they hand-copy its root class string
  instead. `TwinPage.tsx:9-15` copies the responsive `min-w` ladder verbatim into
  a local `TWIN_PAGE_MIN_WIDTH` const **with a comment saying it is a copy** —
  the two strings are still byte-identical today, which means the comment is the
  only thing holding them together. Exporting `CONTENT_FRAME_CLASS` (or adding
  `<ContentBox bare>` that omits the ladder for nested use) makes the copy
  unnecessary and the drift unrepresentable.
- **A tab strip should not be constructible without ARIA. Already true, and it is
  why the two primitives are worth defending.** Both `SegmentedTabs` and
  `PanelTabBar` bake `role="tablist"`/`role="tab"`/`aria-selected`/roving
  tabindex/Arrow-Home-End into the component, so a caller cannot ship an
  inaccessible strip through them. This is the clause the convergence oracle
  supports most strongly (§Convergence): `personas-web` reimplemented the same
  keyboard handler **five times** and `brainiac` has **three different ARIA
  dialects across seven strips**, because neither has the primitive.
- **A page frame should not be constructible without a scroll owner. No — and
  this one cannot be typed away.** `ContentBox` accepts any children, so
  `<ContentBox>` with no `<ContentBody>` type-checks (10 files). A
  `ContentBox`-with-required-slots API (`header` / `body` props instead of
  children) would close it, but it would also break model B, where the two halves
  are declared in different files. **Recorded as a real limitation, not laziness**
  — this is the one the census has to carry.

---

## 5. Anti-patterns

- **Writing an `<h1>` on a page surface.** 18 sites (§9). It is the one element
  `ContentHeader` exists to own; a hand-written one means the app has no single
  place that decides how a page title looks, and nothing can assert a page has
  exactly one. Twin alone accounts for 8 of the 18.
- **Building a second page-header band.** `DevToolsPageHeader` (6 sites) and
  `TwinHeaderBand` (2 sites) both re-declare `ContentHeader`'s geometry with
  different padding — three bands, three vertical rhythms, and the two forks
  exist largely *because* `ContentHeader`'s `title`/`subtitle` naming is inverted
  (§8 gap 1). The right fix for a missing feature is extending the primitive, not
  forking it.
- **Hand-copying the frame's class string.** `flex-1 min-h-0 flex flex-col w-full
  overflow-hidden` is `ContentBox`'s implementation, not a public API. Six files
  re-type it; the day the frame's overflow or containment policy changes, it
  reaches 77 call sites and none of those six.
- **A tab strip in the content area.** It duplicates the sidebar's job while
  being invisible to it — and to the command palette, the tier gate,
  `registry.test.ts`, the test-automation `navigate` bridge, and persistence.
  `FleetPage.tsx:37` keeps three page-equivalent tabs in `useState`, so Fleet's
  Sessions/Activity/Settings are not deep-linkable and do not survive a reload.
- **A `.map()` of `<button>`s as a selector strip without tab semantics.** 130
  structural selector strips exist; **5 carry `role="tab"`, and 3 of those 5 are
  the primitives themselves.** Each hand-rolled strip re-loses arrow-key
  navigation, roving tabindex and `aria-selected`.
- **Omitting `subtitle`** — ships a page whose only heading is a `<div>` caption.
- **Putting a page's controls in `actions` when there are more than two.**
  `toolbar` exists precisely so a long title and a control cluster do not fight
  for one row (`ContentLayout.tsx:99-107`), and it is used **once**.
- **A second `flex-1 overflow-y-auto` between `ContentBox` and the content.**
  Two nested fill-and-scroll regions means the inner one takes the wheel and the
  outer one's scroll shadows fire on a box that never moves.
- **`h-screen` / `min-h-screen` / `h-[calc(100vh-…)]` on a page.** The app is a
  fixed-size desktop window; `App.tsx:323` sets the viewport bound once and
  everything below is a flex chain. Viewport math inside it is a guess about
  chrome heights that will be wrong the next time the titlebar or footer changes.
  (Personas has exactly **1** `h-screen` today — hold that line. `personas-web`
  has 10 `min-h-screen` and a latent 9-way double-scroll bug behind them.)
- **An early `return` that skips the frame for an empty / error / gated state.**
  The header, the tab context and the toolbar all vanish, so the user loses the
  controls that would let them fix the condition.
- **Rendering `ContentBox` inside a modal.** A modal is not a page; it has no
  sidebar-relative min-width and no page scroll region. Use
  [`modals.md`](./modals.md)'s `DetailModal`.
- **Mixing router models** — a model-B router (owns the band) whose tabs also
  render `ContentHeader` stacks two bands; `FleetPage` does exactly this.

---

## 6. Evidence

**Adoption of the triad is genuinely good and the good half deserves naming:**
77 `ContentBox` / 68 `ContentHeader` / 71 `ContentBody` instantiations, with all
three co-located in **56 files**. Scroll ownership is *clean* (§7 E). The hole is
one layer up: the routers, and the header band.

**The one site to copy — model A:** `src/features/overview/sub_sla/components/SLADashboard.tsx:173-182`.
`ContentBox` → `ContentHeader` (icon, iconColor, title, subtitle, actions) →
`ContentBody`, with `SectionHeader` (`:148,:157`) for the blocks *inside* the
body. Thirty lines, no frame class, no `<h1>`, no scroll container, no tab strip.

**The one site to copy — model B:** `src/features/triggers/TriggersPage.tsx:52-108,121-131`.
A `TAB_HEADERS: Record<EventBusTab, TabHeaderConfig>` feeds one `ContentHeader`
for eight tabs, including a per-tab `renderActions`. Eight destinations, one band,
zero drift — and the shape a model-A router with a shared header should be
converted to.

**The one site to copy — in-page lens switching:**
`src/features/overview/components/dashboard/ExecutionsWithSubtabs.tsx:34-43,50,64`.
One `SegmentedTabs` is constructed once and **handed into whichever view is
active** (`headerActions` for Activity, `headerSwitch` for Calls) so the control
lands inside the existing header row. Its docstring (`:19-21`) states the rule:
*"so the control sits in one header row instead of adding a second chrome bar."*
This is the correct answer to "my page needs tabs".

- `src/features/shared/components/layout/ContentLayout.tsx:161-169` — the best
  comment in the scaffold: why the header carries no `backdrop-blur` (WebView2
  compositor flicker) **and** the statement that nothing scrolls under it because
  `ContentBody` is a separate clipped sibling. That sentence is the whole
  scroll-ownership doctrine.
- `…/ContentLayout.tsx:70-74` — the responsive `min-w` ladder with its derivation
  (`xl 1280→952 available`), i.e. the frame's width contract is *computed against
  the sidebar*, not guessed.
- `…/ContentLayout.tsx:273-281` — `min-h-full` on the inner body box (the
  layout-jump reservation) and the reasoning for asymmetric padding.
- `…/ContentLayout.tsx:99-107` — the `toolbar` doc comment, which names the exact
  failure it prevents and is then used once.
- `src/features/shared/components/layout/SegmentedTabs.tsx:44-99` — the roving
  tabindex + Arrow/Home/End implementation, written once. Both siblings wrote
  their equivalent 5× and 7× respectively.
- `src/features/shared/components/layout/ContentHeaderSkeleton.tsx:44-52` — a
  deliberate geometric mirror of `ContentHeader`, `min-w-[80vw]` and `pr-20`
  included, so the ghost→real swap does not move the band.
- `src/features/personas/sectionRouter.tsx:59-70` + `PersonasPage.tsx:382-384` —
  the outer frame: `#main-content` owns horizontal scroll (`overflow-x-auto
  overflow-y-hidden`), which is why no page ever needs one.
- `src/features/templates/components/DesignReviewsPage.tsx:40-104` — model B done
  fully (box + header + body at the router), with the error banner rendered
  *inside* the frame at `:66-71` rather than replacing it.
- `src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx:46-71` — model B with
  `ContentBody centered`, six tabs, one band.
- `src/features/teams/sub_kpis/KPIsPage.tsx:92` — the **only** `toolbar` user;
  the shape every filter-bearing page should have.

---

## 7. Deviations found

**Five categories, 21 individually-addressable items.** All ship green under
`npm run check` (which includes `tsc --noEmit`, `eslint src/` and `census:check`)
and under the full Vitest suite.

### A. The frame is re-declared instead of used — 7

**A1 — six content routers hand-copy `ContentBox`'s root class string.**
Measured by parsing every `className` attribute in 2,104 `.tsx` files for the
exact token set `flex-1 min-h-0 flex flex-col w-full overflow-hidden`: **9 sites
in 7 files**, of which 2 are `ContentLayout.tsx` itself.

| Path | What it is |
|---|---|
| `overview/components/dashboard/OverviewPage.tsx:68` and `:105` | the tab motion wrapper **and** the outer page div — the frame written twice in one 110-line file |
| `settings/components/SettingsPage.tsx:67` | + `relative`, for the cross-fade of idle-unmounted tabs |
| `plugins/twin/TwinPage.tsx:75` | + `TWIN_PAGE_MIN_WIDTH`, a hand-copied duplicate of `ContentBox`'s own `min-w` ladder (`:9-15`) whose comment admits the copy |
| `home/components/HomePage.tsx:68` | the home tab wrapper |
| `overview/…/ExecutionsWithSubtabs.tsx:47` | the sub-tab wrapper |
| `templates/…/AdoptionWizardModal.tsx:141` | a modal body (the one non-router match) |

None of these *can* render `ContentBox` today without nesting a second min-width
ladder inside their tabs' own — which is §4's type answer, not a scolding. The
cost is concrete: `ContentBox`'s ladder was tuned against the 328 px sidebar, and
the next tuning reaches 77 call sites and **none of these six**.

**A2 — `TWIN_PAGE_MIN_WIDTH` (`TwinPage.tsx:13-15`) is a verbatim copy of
`ContentLayout.tsx:74`'s ladder.** Both read
`min-w-[640px] md:min-w-[800px] xl:min-w-[920px] 2xl:min-w-[1180px] 3xl:min-w-[1560px] 4xl:min-w-[2200px]`.
Identical today — **this is a duplication that has not yet drifted**, and the
comment ("Mirrors ContentBox's responsive ladder") is the only mechanism keeping
it that way.

### B. Split scaffolds — the router owns half and the tabs must remember the rest — 3

| Router | Owns | Destinations that supply a `ContentBody` |
|---|---|---|
| `triggers/TriggersPage.tsx:122-123` | `ContentBox` + `ContentHeader` | **2 of 8** — `LiveStreamTab.tsx:440`, `TestTab.tsx:232`. The other six render into `<div className="animate-fade-slide-in flex-1 flex flex-col min-h-0 overflow-hidden">` (`:145`) and must each provide their own scroll or delegate it to a `UnifiedTable`. |
| `plugins/drive/DrivePage.tsx:576-577` | `ContentBox` + `ContentHeader` | 0 — `DriveFileList.tsx` supplies **6** scroll containers of its own |
| `plugins/research-lab/ResearchLabPage.tsx:31-32` | `ContentBox` + `ContentHeader` | 0 — each of the 8 panels declares exactly one |

**Checked and cleared:** I expected clipped content here (a tab with no scroll
inside an `overflow-hidden` wrapper) and looked for it specifically.
`SharedEventsTab.tsx:109-165` delegates scroll to `UnifiedTable`;
`RateLimitDashboard.tsx:23,77` renders a fixed-height summary bar with nothing to
scroll. **No clipped surface found.** The defect is that the contract is
unwritten, not that it is currently violated.

`plugins/fleet/FleetPage.tsx:44-96` is the worst case of the mix: a hand-rolled
band (`:48-81`) stacked **above** each sub-page's own `ContentHeader`
(`FleetGridPage.tsx:431`, `FleetActivityPage.tsx:63`, `FleetSettingsPage.tsx:79`)
— two header bands, two vertical rhythms, on every Fleet page.

### C. Tab strips that duplicate the sidebar, and strips with no tab semantics — 4

**C1 — `FleetPage.tsx:37,51-80`.** Three page-equivalent tabs
(Sessions / Activity / Settings) in local `useState`, drawn as a hand-rolled
strip with no `role="tablist"`, no roving tabindex, no arrow keys — and
hardcoded English labels (`:20-22`, `<h1>Fleet</h1>` at `:50`, and a native
`title=` tooltip at `:72`, which the `native-title-tooltip` census rule already
counts). Because the state is local, these three destinations are not
deep-linkable, not persisted, not reachable from the command palette and not
visible to the test-automation `navigate` bridge.

**C2 — `plugins/twin/variants/TwinVariantTabs.tsx:57-90`.** A second chrome band
above **all seven** Twin pages, hand-rolled, persisted to `localStorage`, no
`role="tablist"`. Self-documented as *"throwaway scaffolding"* (`:31-32`) — but
it is what makes the same destination render two different header treatments
depending on the variant: `ToneBaseline.tsx:86-88` uses the real triad while
`ToneAtelier.tsx:221` and `ToneConsole.tsx:102` draw their own `<h1>`.

**C3 — ARIA coverage across all selector strips.** A JSX-parse for the
structural shape *"`.map()` over a list producing a `<button>` whose `onClick`
selects the mapped item and whose `className` is conditional on it"* finds
**130 sites across 116 files**. **5 carry `role="tab"`, and 3 of those 5 are
`SegmentedTabs`/`PanelTabBar` themselves.** Independently, `role="tablist"`
appears at **13 sites in 13 files**, 2 of which are the primitives — so **11
hand-rolled tablists** exist, each with its own keyboard story. Not all 130 are
tab strips (many are filter chips and option pickers, which is why this is not
the §9 signal), but the two page-level ones are C1 and C2.

**C4 — `PanelTabBar` is not under-adopted; it is nearly unusable.** Its 2 call
sites are both correct. See §8 gap 4 for why a third would be a bug.

### D. The header band is forked three ways — 4

**D1 — three page-header primitives coexist.**

| Primitive | Sites / files | Geometry | Title element |
|---|---|---|---|
| `layout/ContentHeader` | **68 / 64** | `px-4 md:px-6 xl:px-8 py-4`, `border-b border-primary/10 bg-primary/5`, `min-w-[80vw]` | `subtitle` → `<h1 typo-heading-lg>`; `title` → a `<div typo-caption>` |
| `plugins/dev-tools/DevToolsPageHeader.tsx:19-28` | **6 / 5** | `px-6 pt-5 pb-3 border-b border-primary/10` | `title` → `<h1 typo-heading>` |
| `plugins/twin/shared/TwinHeaderBand.tsx:106-140` | **2 / 2** | `px-4 md:px-6 xl:px-8 py-5`, `min-w-[80vw]`, gradient + halo | `title` → `<h1 typo-heading-lg>`, plus `eyebrow` |

`DevToolsPageHeader`'s docstring (`:1-5`) says outright that it *"Replaces the
per-module mix of ContentHeader icon-badges and ad-hoc toolbar rows"* — i.e. the
fork was deliberate and its stated motive is that `ContentHeader` was awkward for
what it needed (an inline slot after the title). `ContentHeader` **has** that slot
(`children`) and 5 of 68 sites use it. Both forks put the page name in `title`;
`ContentHeader` puts it in `subtitle`. **Two of three primitives disagree with
the one that has 89% of the call sites, and the disagreement is about the field
name.**

**D2 — six pages render no `<h1>` at all.** `ContentHeader` sites that omit
`subtitle`: `CloudDeployPanel.tsx:192` · `ProjectManagerPage.tsx:393` ·
`ScheduleTimeline.tsx:243` · `FactoryPage.tsx:18` · `GoalsPage.tsx:173` ·
`PresetStudio.tsx:47`. Their only heading is a `typo-caption` `<div>`.

**D3 — 18 surfaces write their own `<h1>`** (the §9 baseline). Distribution:
**Twin 8** (`TwinHeaderBand.tsx:126`, `ChannelsAtelier.tsx:162`,
`IdentityAtelier.tsx:115`, `KnowledgeAtelier.tsx:229`, `TwinHero.tsx:22`,
`ToneAtelier.tsx:221`, `ToneConsole.tsx:102`, `TrainingAtelier.tsx:138`) ·
**Dev Tools 2** (`DevToolsPageHeader.tsx:25`, `WorkspacesPage.tsx:20`) ·
**Research Lab 2** (`LiteratureSearchPanelAtelier.tsx:311`,
`ResearchProjectListAtelier.tsx:223`) · `FleetPage.tsx:50` ·
`PresetLibraryPage.tsx:69` · `UnifiedDeploymentDashboard.tsx:222` ·
`DecisionsPanel.tsx:55` · `HeroHeader.tsx:97` ·
`PersonaOverviewWidget.tsx:131` (an `<h1>` on a **dashboard widget**, which is a
heading-order defect regardless of scaffold). **One plugin — Twin — is 44% of the
whole population.**

**D4 — the toolbar row is dead.** `toolbar` (`ContentLayout.tsx:107,193-197`) is
declared, documented with the exact collision it prevents, and used by **1 of 68**
call sites (`KPIsPage.tsx:92`), while `actions` — the row it was built to relieve
— is used by 39.

### E. Scroll ownership — the category that came back almost clean

Measured by JSX-subtree containment, not text: **495 scroll-container
declarations across 413 files**, of which **7 sites in 5 files** sit inside a
`<ContentBody>` subtree in the same file.

| Path | Verdict |
|---|---|
| `overview/sub_memories/…/MemoriesPageDense.tsx:263` (body at `:262`) and `:349` (body at `:268`) | **real** — `flex-1 overflow-y-auto` directly inside `ContentBody`, an unbounded scroller nested in an unbounded scroller |
| `overview/sub_messages/…/MessageList.tsx:346` (body at `:313`) | **real** — same shape |
| `overview/sub_knowledge/…/KnowledgeGraphDashboard.tsx:416,:449` | legitimate — `max-h-[600px]` / `max-h-[400px]` bounded inner panels |
| `plugins/dev-tools/…/ProjectOverviewPage.tsx:378` | legitimate — bounded list |
| `plugins/fleet/sub_grid/FleetGridPage.tsx:559` | **suspect** — `max-h-[calc(100vh-300px)]`, viewport math inside a container that is not viewport-bounded. This is the exact latent shape `personas-web` has 9 of |

**Cleared claims, stated because a cleared claim is worth as much as a confirmed
one:**
- **No double scrollbar exists.** Vertical scroll has one owner per page
  (`ContentLayout.tsx:271`), horizontal one owner app-wide
  (`PersonasPage.tsx:384`).
- **No header scrolls away.** Nothing scrolls under `ContentHeader` — its
  `sticky top-0` is inert by construction and the elevation shadow comes from
  `ContentLayoutContext`, not from stickiness.
- **`h-screen` appears exactly once** in 2,104 `.tsx` files (`App.tsx:323`), and
  `min-h-screen` zero times on a page surface. Both siblings are worse here.
- **The frame does not jump between empty and loaded:** `ContentBody`'s inner box
  is `min-h-full` (`:273`), so the region reserves full height before data
  arrives. (Compare `brainiac/console`, where 11 of 14 modules jump — §Convergence.)
- **Pages do not replace their own frame on an empty/error state.** A per-function
  return-shape parse (does a component return `<ContentBox>` in one branch and
  bare JSX in another?) found **3 sites**, and all three are legitimate view
  swaps rather than degraded states: `EditorBody.tsx:136` → `<EditorEmptyState/>`
  (which renders its own `ContentBox`), `ToneBaseline.tsx:83` → `<TwinEmptyState/>`
  (same), `TeamCanvas.tsx:30,:34` → `<PresetStudio/>` / `<TeamList/>` (both render
  their own frame). **This is the clause the convergence oracle rates as physics,
  and Personas passes it.**

---

## 8. Gaps in the primitive

1. **`ContentHeader`'s `title`/`subtitle` naming is inverted, and it is upstream
   of half this document.** `title` is a small mono-uppercase caption; `subtitle`
   is the dominant `<h1>`. Every other header in this repo, and in both sibling
   repos, puts the page name in a field called `title`. An author reaching for
   "the page title" finds a prop that renders 11 px uppercase tracking-widest
   text, concludes the primitive is wrong for them, and writes their own band.
   **Both forks (D1) put the name in `title`.** A `pageTitle`/`eyebrow` rename
   (with `title`/`subtitle` kept as deprecated aliases) is a mechanical change
   that removes the reason the forks exist.
2. **`subtitle` is optional, so a page can ship with no `<h1>`** (D2). §4's type
   answer; the single cheapest fix in this document.
3. **`ContentBox` cannot be nested, and does not export its frame class.** A
   router that wraps tabs which each render `ContentBox` must not render one
   itself, so its only option is to re-type the class string (A1) — six times,
   plus one hand-copied width ladder (A2). Needs either an exported
   `CONTENT_FRAME_CLASS` or a `<ContentBox bare>` variant that omits the ladder.
4. **`PanelTabBar`'s bleed is hardcoded one breakpoint short of the header it
   attaches to.** Its container is `mt-4 -mb-4 -mx-4 md:-mx-6`
   (`PanelTabBar.tsx:73`); `ContentHeader`'s padding is `px-4 md:px-6 **xl:px-8**`
   (`ContentLayout.tsx:151`). At `xl` and above the bar pulls back 24 px against
   32 px of padding, so its `border-t` stops **8 px short of the band's edges on
   both sides**. Both existing call sites are affected; the fix is one class
   (`xl:-mx-8`). This is why "adoption is 2" is not the problem statement.
5. **`ContentHeader`'s `min-w-[80vw]` floor is defused by a magic constant.**
   The band is 80 vw wide inside a `ContentBox` that is `overflow-hidden` and
   narrower than that below ~1640 px viewport, so right-aligned `actions` would
   be clipped. The primitive compensates with `pr-20` on the title row
   (`:175`) — checked at 1280/1366/1440/1600 px and it **holds at all of them**,
   but only because 80 px happens to exceed `0.8·vw − (vw − 328)` across that
   range. `fitWidth` (2 of 68) is the principled escape hatch and is
   under-documented. Recorded as fragile-but-correct, not as a live defect.
6. **`RouteChunkSkeleton` and `OverviewRouteSkeleton` are not interchangeable and
   the difference is invisible.** `OverviewRouteSkeleton` (`OverviewPage.tsx:48-60`)
   wraps `ContentHeaderSkeleton` in a real `<ContentBox>`; `RouteChunkSkeleton`
   (`:36-44`) wraps it in a bare `flex-1 min-h-0 flex flex-col`. So the shared
   primitive's ghost lacks the frame's `min-w` ladder and the duplicate's has it,
   which changes the horizontal scroll extent across the ghost→content swap at
   narrow widths. [`lazy-route-chunk.md`](./lazy-route-chunk.md) §7 D flags the
   duplication; this is *why* nobody could just delete it.
7. **Nothing links a destination to its scaffold.** `sidebarData.ts` declares
   that a destination exists; the router decides who renders the frame; the
   component decides whether to honour that. Three independent decisions, no
   shared type, no test. A `PageSurface` marker type (or a `data-page` contract
   the test harness asserts) would let `registry.test.ts` enumerate "every
   declared destination renders exactly one header band" — which is §9 item 2.
8. **The scaffold family is undocumented and uncatalogued.** `.claude/Design.md`
   mentions `PanelTabBar`/`SegmentedTabs` in exactly one line (`:305`) and
   `ContentBox` / `ContentHeader` / `ContentBody` **zero times** (measured: 0
   occurrences in the whole file). `ContentLayout.tsx` carries no `@catalog` tag
   and **no row in `shared/components/CATALOG.md`** — the tab primitives do have
   rows (`CATALOG.md:155,:161`, supplied by the `CURATED` map in
   `scripts/docs/gen-shared-catalog.mjs`, not by a tag), and even
   `ContentHeaderSkeleton` has one (`:151`, reading *"(add a `@catalog` tag)"*).
   So the *ghost* of the page header is catalogued and the page header is not.
   **The most-used UI primitive family in the app is absent from every document
   that exists to route people to shared components** — which is a sufficient
   explanation for D1 on its own, and the cheapest fix in §8: three `@catalog`
   tags and a Design.md section.

---

## 9. The missing gate

**Every deviation above shipped under a green `npm run check`.** There is no
ESLint rule, no check script, no test and no `conventions.json` entry that
mentions the page frame, the header band or page-level scroll. `census:check`'s
56 rules include none on layout scaffolding (verified rule-by-rule before
writing this: the nearest neighbours are `typo-token-overpainted` and
`hand-rolled-disabled-state`, which key on Tailwind colour/typography tokens and
share no signal, and `local-empty-state`, which counts hand-rolled empty *content*,
not the frame around it).

### 1. Census rule — `page-title-outside-header-primitive`

**The condition (stack-free):** *a page's top-level heading is declared at the
surface instead of by the one primitive that owns the page header band, so
nothing can enumerate the app's page titles, restyle them in one place, or assert
that a page has exactly one.*

**The proxy in this repo:** a hand-written `<h1>` element. **PRECONDITION, and an
adopting repo must re-derive its own:** this works because exactly one shared
component emits `<h1>` here (`ContentLayout.tsx:184`), reached through
`ContentHeader`'s `subtitle` prop at 62 of 68 sites — so the compliant form
contains no `<h1>` token at all and the deviant form is the only place the token
appears. A repo whose page title arrives from a framework layout, a
`generateMetadata` export, or a CMS field would score near zero on this pattern
while the condition is present at full scale. That is not hypothetical: in
`personas-web` the same condition is *"a `text-2xl font-bold tracking-tight`
heading written inside a `page.tsx`"* — **13 of 13 dashboard pages**, all of which
this `<h1>` pattern would also catch, but where the *compliant* form does not
exist to compare against; and in `brainiac/console` it is 27 `<h1>`s in **two
mutually incompatible class dialects**, where an `<h1>` count reports 27
violations and a *repo with no primitive at all* is exactly the case a ratchet
cannot express.

```json
{
  "rules": [
    {
      "id": "page-title-outside-header-primitive",
      "goldenPath": "docs/concepts/golden-paths/page-scaffold.md",
      "title": "A surface declares its own page-level heading instead of getting it from the one page-header primitive",
      "roots": ["src"],
      "extensions": [".tsx"],
      "signal": {
        "pattern": "<h1[\\s/>]",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a hand-written <h1> element. PROXY FOR the stack-free condition: a page's top-level heading is declared at the surface instead of by the one primitive that owns the page header band, so nothing can enumerate the app's page titles, restyle them in one place, or assert that a page has exactly one. In this repo the compliant form is ContentHeader's `subtitle` prop — src/features/shared/components/layout/ContentLayout.tsx:184 is the ONLY sanctioned <h1>, reached at 62 of 68 ContentHeader sites — so compliant code contains no <h1> token at all. MEASURED distribution of the 18: Twin 8 (TwinHeaderBand, ChannelsAtelier, IdentityAtelier, KnowledgeAtelier, TwinHero, ToneAtelier, ToneConsole, TrainingAtelier), Dev Tools 2 (DevToolsPageHeader, WorkspacesPage), Research Lab 2, plus FleetPage, PresetLibraryPage, UnifiedDeploymentDashboard, DecisionsPanel, HeroHeader, PersonaOverviewWidget. Two of these (DevToolsPageHeader, TwinHeaderBand) are COMPETING HEADER PRIMITIVES, so those 2 matches stand in for 8 downstream call sites. PRECONDITION: this proxy works only because exactly one shared component emits <h1> here. A repo whose page title comes from a framework layout, a generateMetadata export, a CMS field, or a hand-written heading class (personas-web: `text-2xl font-bold tracking-tight`, 13 of 13 dashboard pages) must re-derive its own proxy against its own page-header primitive — and a repo with NO such primitive cannot use a ratchet for this at all.",
        "$falsePositiveNote": "Verified through a second, independently written implementation (a TypeScript-compiler JSX parser counting real h1 JSXOpeningElements). The two disagreed by exactly 1 and the text matcher was wrong: MessageDetailModal.tsx:361 is an <h1> inside a template literal that builds a standalone printable HTML document for print-to-PDF. It is excluded below. After that exclusion the two implementations agree exactly at 18/18."
      },
      "exclude": [
        { "path": "src/features/shared/components/layout/ContentLayout.tsx", "reason": "the primitive itself - ContentHeader's <h1> at :184 is the sanctioned page title this rule routes callers toward" },
        { "path": "src/features/shared/components/editors/MarkdownRenderer.tsx", "reason": "maps authored markdown '# ' to <h1>; the heading is document content, not the app's page-frame title" },
        { "path": "src/features/agents/components/ChatMessageContent.tsx", "reason": "same markdown-content mapping for assistant replies inside a chat bubble, not a page header band" },
        { "path": "src/features/vault/sub_catalog/components/design/setup/setupMarkdownComponents.tsx", "reason": "markdown component map for connector setup docs; heading level comes from the authored document" },
        { "path": "src/main.tsx", "reason": "pre-mount boot-failure screen rendered before the app shell exists, so no scaffold primitive is reachable from it" },
        { "path": "src/features/overview/sub_messages/components/MessageDetailModal.tsx", "reason": "the <h1> at :361 is inside a template literal that builds a standalone printable HTML document for print-to-PDF, not a React surface inside the app scaffold" }
      ],
      "baseline": { "files": 18, "matches": 18 },
      "floor": 2000
    }
  ]
}
```

**Validated standalone** from a scratchpad rule file named uniquely to this
composition (`census-pagescaffold-9c3e7f.json`, patterns in a file, never in bash
argv), then **re-extracted from this finished document and re-run** — same
counts. Full run: **1.9 s** for both rules over 4,208 file-visits; the pattern is
a literal with a bounded character class, no lookbehind, no backtracking.

```
  OK   page-title-outside-header-primitive     18     18       18     18    2104   2000
```

**Fault injection against the real tree** (`--check`):

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK … 18 18 18 18 2104 2000` — surviving counts printed |
| matcher matches nothing (`<hNoSuchTagXYZ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped 18 → 0` |
| floor above walk (`floor: 9000`) | **1** | `walked 2104 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src/lib`) | **1** | `walked 12 … floor is 2000` + `zero matches` + 5 stale-exclude reports + both drops |
| count rises (baseline lowered to 5) | **1** | `[drift] matches rose 5 → 18 (+13)` |
| renamed root (`srcc`) | **1** | `walked 0 files but floor is 2000` + `matched zero files anywhere` |
| count drops (baseline raised to 40) | **1** | `[drift] matches dropped 40 → 18 (-22) without the baseline moving` |
| stale `exclude` | **1** | `exclude "…/Gone.tsx" matched no file. The exemption is stale…` |
| `exclude` with a 9-char `reason` | **1** | schema refusal before any scan |

All nine behave as the contract requires.

**Expected trajectory: down to a small allowlist, not to zero.** Six of the 18
disappear the moment `subtitle` becomes required (§4). Eight more are Twin's, and
collapse when `TwinHeaderBand` is folded back into `ContentHeader` (gap 1). The
correct terminal state is 2-3 (the genuine non-page headings) — **and if it ever
reaches 0 the rule must be deleted rather than baselined at zero**, because the
engine treats a zero-match rule as a broken matcher, which it is right to do.

**Positive control — a shape-discrimination control, not a gate.** The obvious
objection to this rule is that it keys on "a heading element" rather than on "a
*page* heading", which would make it fire on correct content. The control is the
same anchor aimed one level down, at the heading level this app deliberately
leaves hand-written:

```json
{
  "id": "page-scaffold-positive-control",
  "goldenPath": "docs/concepts/golden-paths/page-scaffold.md",
  "title": "POSITIVE CONTROL - not a gate. Do not merge.",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "<h2[\\s/>]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - the shape-discrimination control for page-title-outside-header-primitive. Identical anchor, aimed at the heading level the scaffold does NOT own. Measured 2026-08-14: 135 files / 143 matches, versus the rule's 18 files / 18 matches, with a 5-file overlap and zero match-level overlap. Its purpose is to demonstrate that the rule discriminates the PAGE-LEVEL heading from section headings - a rule keyed on 'a heading element' would count 143 legitimate in-body section titles that SectionHeading/SectionCard are supposed to render and that no page-scaffold doctrine forbids. Deliberately carries no baseline; the registry merge skips ids containing 'positive-control'."
  },
  "floor": 2000
}
```

**Both populations and their overlap, measured:** the rule matches **18 files /
18 matches**; the control matches **135 files / 143 matches**; **5 files appear in
both** (`DecisionsPanel.tsx`, `KnowledgeAtelier.tsx`, `ToneAtelier.tsx`,
`TrainingAtelier.tsx`, `PresetLibraryPage.tsx` — surfaces with a hand-rolled page
title *and* legitimate section headings under it), and **no individual match
appears in both**. The 7.9× ratio is the point: a signal that could not tell
`<h1>` from `<h2>` would report 143 violations against code this path explicitly
sanctions. Validated locally with a temporary baseline of `{files:135,
matches:143}` (the runner's `validateRule` requires one); published without it so
the merger skips it. **Do not merge this block.**

### 2. What the census cannot do — and the Vitest case that can (specified, not built)

The rule above catches the *title*. It cannot catch the two conditions that
produced most of §7, and it is worth stating why rather than pretending:

- **"This routed destination renders no header band at all."** That is a relation
  between a `sidebarData.ts` entry, a router branch and a component — three files
  — and `scanRule` (`scripts/census/lib/engine.mjs:147-239`) reads one file at a
  time. It is also a *negative*, and a census rule counts positives.
- **"This router owns half a scaffold."** The four router shapes have nothing
  textual in common (a nested ternary ladder in `OverviewPage`, a `mountedTabs`
  `.map` in `SettingsPage`, an `&&` chain in `DesignReviewsPage`, a `Record`
  lookup in `TriggersPage`), so a regex tuned to any one scores zero on the rest.

**Specify a Vitest case instead**, beside the one that already enumerates the
navigation registry (`src/lib/navigation/registry.test.ts`), which has the modules
in scope for free: import every L2 item array from `sidebarData.ts`, resolve each
declared destination to its component module, and assert that **every declared
destination is reachable through exactly one header band** — mechanically, that
the rendered tree of each routed surface contains exactly one element carrying a
`data-page-header` attribute that `ContentHeader` (and only `ContentHeader`)
emits. That converts "detect the missing band" into "the band is the only way to
be a page", which is §4's type answer with a test as its ratchet.

**How it fails loudly if its own precondition is absent** — copy the `checked > N`
shape this repo already treats as the model (`ipc_auth.rs:971-976`):
`expect(destinations.length).toBeGreaterThanOrEqual(40)` before asserting anything
about them. A destination list that resolves to an empty array must not read as
"no drift" — that is the failure mode that let four of this repo's CI jobs check
nothing.

### On severity, if any of this ever ships as an ESLint rule

Ship it at `"error"`. **Not because warnings drown in a large baseline** — the
baseline is 1,135 (`shared-facts.json`) and the volume argument is not available
at any count. The count-independent argument is the only one that holds:
`npm run check` runs `eslint src/` with **no `--max-warnings`**, and the
pre-commit hook runs `--quiet --max-warnings 99999`, where `--quiet` discards
warnings before they can be counted. **A warn-level rule enforces nothing at
either gate, by construction.**

---

## Convergence — the oracle contradicts half this path, and the contradiction is the finding

Checked read-only against `../personas-web` (Next.js App Router, 37 `page.tsx`,
10 `layout.tsx`) and `../brainiac/console` (Next.js, 14 console modules, one
route with `?m=` switching).

**The result inverts the naive reading, and I am reporting it against my own
prescription.** The contract says *"a clause another codebase reinvented is
physics; a clause with no trace anywhere else should be suspected of being local
calibration."* Applied literally, **the central clause of §2 — one shared
component owning the page header band — is local calibration.** Neither sibling
has one. `personas-web` has 13 dashboard pages and 13 hand-written headers, with
the exact class string `text-2xl font-bold tracking-tight` appearing 22 times;
two pages *extracted* a header component and each has exactly one call site.
`brainiac/console` has 27 `<h1>`s in two incompatible dialects and 22
hand-written page-root boxes across four different `max-w` values and four
padding scales. Three repos, three independent attempts, **one** primitive.

**And the prescription survives anyway — on cost evidence rather than
rediscovery evidence.** This is the lesson this batch earned the hard way:
*convergence measures discoverability, not whether a requirement is real.* A page
header band is not discoverable — nobody arrives at it by rediscovery, because
each page's header is individually trivial to write. Both repos that lack it are
measurably paying:

- **`brainiac/console` ships a layout jump on 11 of 14 modules, from exactly this
  cause.** It *did* build a shared loading frame — `Skeleton.tsx:62`
  `SkeletonFrame`, 14 call sites, whose docblock (`:9`) claims *"Dimensions
  approximate each page's real layout so content resolves without a jump."* It
  hardcodes `mx-auto max-w-7xl px-6 py-10` for all 14 modules, while only 3
  module roots are `max-w-7xl` and **none** is `py-10`. So the audit skeleton
  paints at `max-w-7xl py-10` and `AuditLedger.tsx:84` lands at `max-w-5xl py-8`
  — the content jumps horizontally *and* vertically on every fetch. **A shared
  skeleton that has to guess a box it does not own cannot help.** This is the
  single strongest external argument for making the box, the band and the scroll
  region one primitive, and it is an argument *from the absence of one*.
- **`personas-web` shows the drift arriving on schedule**: header wrapper margins
  at `mb-8` / `mb-6` / `mb-4` across six pages, subtitle styles at
  `mt-1 text-base` vs `text-sm` with no margin, and two extracted-but-never-
  generalized header components with one call site each. Extraction happened;
  generalization did not — twice.
- **`brainiac` also loses `<h1>` entirely on 2 of 14 modules**
  (`Observatory.tsx`, `DisputeBench.tsx`), which is §7 D2's defect arriving from
  the same optional-by-default cause in a repo with no shared prop at all.

**What IS physics — three independent rediscoveries each:**

| Clause | Warrant | Evidence |
|---|---|---|
| **Page chrome must survive an empty/error state** | **physics** | `personas-web`: 13 of 13 dashboard pages return one tree, header first, all 12 error banners *after* the `<h1>`, shared `EmptyState` ×9. `brainiac`: 8 inline empty states, 0 wholesale replacements. Personas: 3 candidate early returns, all 3 legitimate (§7 E). **All three arrived here independently and all three are correct.** |
| **Exactly one element owns scroll** | **physics** | `brainiac`: document scroll, 6 inner scrollers all widget-level and bounded, **0** nested; `Archive.tsx:395` even carries a comment explaining why a container is *not* `overflow-hidden`. `personas-web`: document scroll, 0 `h-screen`. Personas: one vertical owner, one horizontal owner. |
| **A tab strip wants to be a primitive** | **physics, and the sharpest result in the batch** | `personas-web` reimplemented the ArrowLeft/ArrowRight/Home/End roving-tabindex handler **5 separate times** (`EventsPageTabs:39-54`, `IncidentsGroupByTabs:23-37`, `RankDimensionTabs:25-39`, `knowledge/page.tsx`, `TabBlock.tsx`) — with two of them self-documented as *"mirroring EventsPageTabs"* / *"mirroring the other dashboard segmented controls"*. `brainiac` has 7 strips in 3 ARIA dialects, including a **byte-identical clone pair** (`IngestMonitor.tsx:55-73` ≡ `CortexMap.tsx:55-73`, differing only in a storage key and a `layoutId`). Personas built it once, twice over. **`SegmentedTabs`/`PanelTabBar` are the vindicated primitives in this document.** |
| **A section-level heading component is worth sharing** | **physics** | `personas-web`'s `SectionHeading` (14 sites) + `SectionIntro` (24); `brainiac`'s `SectionRail` (3, docblock: *"so the public long-form pages share one navigation behaviour instead of two drifting copies"*); Personas' `SectionHeading` (20) + `SectionHeader` (17). All three share the *section* header and none shares the *page* header — a striking split. |

**And the asymmetry the brief predicted, confirmed and sharpened.** Both siblings
are Next.js, where a layout is a framework primitive — and **they converge on
precisely the two things the framework hands them and diverge on precisely the
three that require a hand-built component.** `personas-web` gets persistent chrome
across errors *structurally*, because `DashboardErrorBoundary` sits inside
`<main>` in `dashboard/layout.tsx:50`, below the navbar and sidebar — nobody had
to be disciplined. It gets single-owner scroll structurally, because the document
scrolls by default. It gets **nothing** for the header band, the tab strip or the
min-height reservation, and it has 13 hand-written headers, 6 hand-written
tablists and **0 of 13 pages reserving height**. `brainiac` is the control on the
control: it deliberately gave up per-segment `error.tsx`/`loading.tsx` for a
one-route `?m=` console (`app/console/page.tsx:49-58` documents the trade), and
had to hand-rebuild both — and its hand-rebuilt skeleton is the thing that jumps.

**Two consequences for Personas, one comfortable and one not:**

1. **The scroll-ownership clause is local calibration forced by a real
   constraint, and must be labelled as such for any repo adopting this path.**
   Personas builds an inner scroll region because `App.tsx:323` is
   `h-screen w-screen overflow-hidden` — a desktop window with a fixed titlebar
   and footer. Neither sibling made that choice, so neither can produce a double
   scrollbar and neither needed a rule. **A web app adopting this path should
   keep document scroll and delete §4 step 8**; the transferable half is "exactly
   one element owns scroll", not "that element is `ContentBody`".
2. **`personas-web` carries the latent version of the bug Personas is exposed
   to**, which is the best evidence that the constraint is what creates the
   hazard: 9 nested scrollers inside a `<main overflow-auto>` that is *inert*
   because its parent is `min-h-screen` rather than `h-screen`, including
   `MemoriesView.tsx:106`'s `max-h-[calc(100vh-320px)]` — viewport math inside a
   container that is not viewport-bounded. The day anyone "fixes" that layout to
   `h-screen`, all nine become real. **Personas already made that change**, which
   is why `FleetGridPage.tsx:559`'s identically-shaped
   `max-h-[calc(100vh-300px)]` is listed in §7 E as suspect rather than latent.
