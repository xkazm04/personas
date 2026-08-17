# Golden path — Tab strip

> Situation node: `ui-system/layout-and-navigation/tab-strip` · [situation spine](../situation-spine.md)
> recurrence **36 — the single most recurrent leaf in the 247-leaf spine** · risk **LOW** · sides **client** · convergence **mixed**
> dimensions: **ui · function · code-quality · performance**
> Leaf definition: *"a row of tabs and the panel below it."*
> Composed 2026-08-17 against `master` @ `64b1aa5c3`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**2,104** `.tsx`, of which 1,989 production). The
> population was extracted **four times** by three different anchors — strip-first, panel-first, and
> ARIA-first — and the four disagreed materially; §12.1 reports the disagreement and its cause rather
> than the reconciled number alone. Read in full:
> `shared/components/layout/{SegmentedTabs,PanelTabBar}.tsx`,
> `templates/draft-editor/DraftEditStep.tsx`,
> `templates/sub_generated/gallery/modals/TemplateDetailModal.tsx`,
> `templates/sub_generated/shared/TabTransition.tsx`,
> `settings/sub_byom/components/ByomSettings.tsx`,
> `agents/sub_executions/detail/{ExecutionDetailTabs,ExecutionDetail}.tsx`,
> `agents/sub_deployment/components/cloud/CloudDeployPanel.tsx`,
> `plugins/gitlab/components/GitLabPanel.tsx`,
> `overview/components/dashboard/OverviewPage.tsx`, `personas/PersonasPage.tsx`,
> `plugins/{artist/ArtistPage,dev-tools/DevToolsPage,twin/TwinPage,fleet/FleetPage,companion/CompanionPluginPage,obsidian-brain/ObsidianBrainPage}.tsx`,
> `triggers/TriggersPage.tsx`, `templates/components/DesignReviewsPage.tsx`,
> `overview/sub_manual-review/components/DecisionModeTabs.tsx`,
> `overview/sub_observability/components/HealingIssuesPanel.tsx`,
> `plugins/drive/knowledge/DriveKnowledgeDrawer.tsx`,
> `plugins/research-lab/shared/PrototypeTabs.tsx`, `plugins/twin/variants/TwinVariantTabs.tsx`,
> `plugins/fleet/FleetTerminalOverlay.tsx`, `stores/slices/{system/uiSlice,overview/overviewSlice}.ts`,
> `stores/systemStore.ts`.
>
> **Measured by executing, not by reading.**
> 1. **Five experiments in jsdom 29.1.1 + React 19.2.6** (the repo's own versions, loaded through the
>    repo's `node_modules`), with `SegmentedTabs` transcribed **statement for statement** and two real
>    hosts — `ByomSettings.tsx:162-220` and `DraftEditStep.tsx:118-172` — transcribed into the same
>    harness. One substitution, recorded: framer-motion's `motion.div` → `div` (it carries no DOM
>    semantics; the element, its class and its tree position are preserved). That replay produced §0's
>    headline and §7 D1, D2, D3 and D6 — none of which reading had.
> 2. The §9 rule was built, run in a **composer-private scratch registry with a filename unique to this
>    composer**, hand-verified, **positive-controlled so the control partitions the population exactly**
>    (30 + 4 = 34, no residue), **fault-injected six ways — all six fire** — then re-extracted from this
>    finished document and re-run. **The full registry was NOT run**, per the doctrine.
> 3. **No database was copied.** Nothing in this leaf lives in SQLite; the scratchpad is clean by
>    construction rather than by cleanup.
> 4. **The live app was not touched. `cargo` was not run.** This leaf is client-only and the measurement
>    confirms it — see §12.6, where the spine's `sides: client` label survives.
>
> ### Sibling boundaries, settled in prose
>
> [**error-boundary**](./error-boundary.md) owns *what a latched boundary does when the surface under it
> changes*, and ships `unresettable-error-boundary` (16/25). **This path does not re-propose it and does
> not re-derive its finding.** It executed the boundary half at `renderSectionRoute`; §0 here executes
> the *other three* things that survive the same unkeyed swap — a scroll offset, an in-flight fetch, and
> a component instance — and shows they are all the same mechanism.
>
> [**lazy-route-chunk**](./lazy-route-chunk.md) and the loading doctrine
> ([`docs/design/overview-loading.md`](../../design/overview-loading.md)) own the ghost under the chrome.
> This path owns the fact that **a tab switch is a mount**, which is what makes the ghost necessary at
> all, and reports the altitude split in §0.
>
> [**keyboard-shortcut-registration**](./keyboard-shortcut-registration.md) and
> [**focus-management**](./focus-management.md) own *global* key handlers and whether a target is
> reachable. This path owns the **element-scoped** `onKeyDown` on a tablist — explicitly out of scope
> there ("*you are not in this situation when the key handler is an `onKeyDown` prop on the element it
> acts on*") and unowned until now.
>
> [**embedded-terminal-session**](./embedded-terminal-session.md) owns the focused-xterm case. §8.6
> hands it one tab strip.
>
> [**shared-fetch-cache**](./shared-fetch-cache.md) ships `hand-rolled-module-cache` (48/71) and owns
> the *cache*. This path owns the fact that **a tab switch is the event that needs one** (§7 D2).
>
> The **Deviations** section is a note backlog, **not applied** — the operator uses this app daily and
> every entry changes what a click does.

---

## 0. The headline, before anything else

**This app has two tab-strip primitives, and the one that is used 10× more often is the one that is
wrong by default. `PanelTabBar` withholds `aria-controls` unless the caller declares a panel — 2 of 2
callers declared one and built it. `SegmentedTabs` emits `aria-controls` unconditionally, at an
auto-generated id the caller cannot guess — and 21 of 21 call sites ship a reference to an element
that does not exist. The helper that would make it resolve, `segmentedTabPanelProps`, has ZERO
consumers. Two sibling primitives, one folder, one repo, same authors, same concept: withholding
scored 2/2, defaulting scored 0/21.**

```
src/features/shared/components/layout/PanelTabBar.tsx:86     aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
src/features/shared/components/layout/SegmentedTabs.tsx:124  aria-controls={panelId}
                                              :41            const prefix = idPrefix ?? `segtabs-${autoId}`   // useId(), unguessable
                                              :176-182       export function segmentedTabPanelProps(...)      // 0 consumers
```

**And the second finding, which the convergence oracle turned from a local observation into physics:
no panel `key` in this codebase — or in any of the four applicable sibling repos — exists to reset
state. Every one of them exists to restart an entrance animation. 12 of 12 here, 8 of 8 across four
independent siblings, zero counterexamples in either.** The clearest statement of it is a shared
component whose entire body is the two lines fused:

```tsx
// src/features/templates/sub_generated/shared/TabTransition.tsx:8-9  (the whole component)
<div className="animate-fade-slide-in"
     key={tabKey}
>
```

State reset is a **side effect nobody asked for** — which is why it disappears the moment the
animation does. `PersonasPage.tsx:403-405` is that experiment already run in this repo:

```tsx
{/* AnimatePresence disabled — testing if framer-motion layout measurement causes freeze */}
<div className="flex-1 flex flex-col w-full min-w-0 overflow-y-hidden">
  {renderContent()}          // 10 rail sections + 20 sub-routes, one position, no key
</div>
```

### The population — recurrence 36 understates it

| | n |
|---|---:|
| `.ts`/`.tsx` walked | **4,829** (2,104 `.tsx`; 1,989 production) |
| **mutually-exclusive mapped selector rows** (the family this leaf sits in) | **204 in 184 files** (a second, tighter implementation: 86 in 81 — §12.1) |
| **tab strips proper** — a strip that declares itself a tablist or uses a primitive | **34 sites / 31 files** |
| ↳ `<SegmentedTabs>` | **21 sites / 18 files** |
| ↳ `<PanelTabBar>` | **2 sites / 2 files** |
| ↳ hand-rolled `role="tablist"` | **11 sites / 11 files** |
| **primitive adoption among declared tab strips** | **23 of 34 = 68%** |
| primitive adoption against the wider 204-row family | **11%** |
| `role="tabpanel"` in the entire tree | **4** |
| `<SegmentedTabs>` sites passing `idPrefix` | **1 of 21** (`DecisionModeTabs.tsx:61`) — and it still has no panel |
| consumers of `segmentedTabPanelProps` | **0** |
| **multi-arm panel switches** (≥2 mutually exclusive JSX arms on one variable) | **98 in 94 files** |
| ↳ carrying a `key` on the panel wrapper | **16 by pattern, 12 hand-verified** (§12.1) |
| ↳ of those 12, sitting on an **entrance-animation wrapper** | **12 of 12** |
| `<SegmentedTabs>` host files that key their panel on the tab state | **0 of 18** |
| hand-rolled strips with roving `tabIndex` **and no arrow-key handler** (keyboard-trapped) | **1** (`DraftEditStep.tsx:129`) |
| A/B prototype switchers still shipping, self-labelled "throwaway scaffolding" | **2 components / 3 render sites, alive 114 days** |
| `*Tab` selection fields in `systemStore` | **18**, of which **10** survive an app restart |
| non-store call sites that deep-link into a tab by calling a `set*Tab` | **63** |

### The altitude split, measured

The loading doctrine landed at the **page** level and stopped at the tab bar.

| | page-level section switches (10) | in-page tab-strip hosts (31) |
|---|---:|---:|
| panel wrapped in `<Suspense>` | **9 / 10** | **3 / 31** |
| any skeleton / ghost | 7 / 10 | 2 / 31 |
| panels lazy-loaded | 9 / 10 | 3 / 31 |
| `key` on the panel wrapper | **10 / 10** | 5 / 31 |
| entrance animation present | **10 / 10** | 5 / 31 |

The two right-hand rows are the same ten files and the same five files. That is the whole discriminator
(§6.3).

### What the executed replay settles

```
E1  SegmentedTabs, ByomSettings shape
    aria-controls="segtabs-_r_0_-panel-policy"   -> document.getElementById() === null
    aria-controls="segtabs-_r_0_-panel-keys"     -> null
    aria-controls="segtabs-_r_0_-panel-routing"  -> null
    role="tabpanel" elements in the tree: 0.   resolved 0 / dangling 3.

E2  the unkeyed `activeSection === 'x' && <Panel/>` chain, one switch away and back
    typed "half-typed provider note" into the Policy tab
    scrolled the SHARED container to scrollTop=640
    -> Policy -> Keys -> Policy
       field value       = ""            (the draft was destroyed)
       mounts            = {policy: 2, keys: 1}
       fetches           = {policy: 2, keys: 1}   (the panel refetched from scratch)
       scrollTop         = 640           (the scroll position SURVIVED)
    THE CONTENT RESETS AND THE SCROLL DOES NOT. Exactly inverted from what a user expects.

E3  ArrowRight on the tab strip
    SegmentedTabs      : policy -> keys,   preventDefault=true   tabIndex = -1,0,-1
    DraftEditStep      : prompt -> prompt, preventDefault=false  tabIndex =  0,-1,-1
    -> the hand-roll took the other two tabs OUT of the Tab order and gave nothing back.
       Two of its three tabs are unreachable by keyboard.

E4  what `key={activeTab}` actually bought at DraftEditStep.tsx:146
    mounts/unmounts/fetches across prompt->settings->prompt: IDENTICAL to the unkeyed case.
    The arms are already different component types at different positions, so the key
    changed nothing observable except restarting `animate-fade-slide-in`.

E5  the same COMPONENT TYPE at both arms of a ternary chain
    tab a, after an edit : data-local="edited-in-a"
    switch to tab b      : data-shared="b"  data-local="edited-in-a"   mounts=1
    -> tab b renders tab a's state. React reconciles the same type at the same position
       by updating props, never by remounting. `OverviewPage.tsx:78` and `:94` are both
       <DashboardWithSubtabs/>; PersonasPage's renderContent() returns <ErrorBoundary>
       at one position for every branch.
```

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and each
clause carries its warrant, so an adopting repo can tell physics from local calibration. No file path,
primitive name or count appears below this line until the head ends.

> **P1 — physics, and the subject.** *A tab strip is two objects, not one: the row that says which
> choice is live, and the region that changes because of it.* Every defect in this leaf comes from
> owning one and forgetting the other. The row is easy, visible, and gets the design attention; the
> region is where the state, the fetch, the scroll offset and the crash live.
>
> **P2 — physics, and the one the oracle promoted.** *Changing the identity of the region is a reset,
> and a reset is a behavioural decision — never a styling one.* If a fresh identity is given so that an
> entrance animation replays, the reset arrived as a side effect and nobody chose it: not its presence,
> not its absence, not what it destroys. The two must be separated in the code, or the next person who
> deletes the animation will silently delete the reset with it.
>
> **P3 — physics.** *The choice a tab strip publishes about the region must be true of something that
> exists.* A control that names the thing it governs is asserting that the thing is there. Where the
> region is rendered conditionally, the assertion is false for every unselected choice — which is most
> of them, most of the time. Either render all regions and hide the inactive ones, or do not make the
> claim.
>
> **P4 — ergonomics, and the trap.** *Taking the inactive choices out of the sequential focus order is
> half of a mechanism; the other half is giving the user a way back to them.* Doing the first half alone
> is strictly worse than doing neither, because plain controls were already reachable. This is the one
> failure mode where a partial adoption of a standard is worse than none.
>
> **P5 — function.** *Switching away must be treated as a departure, not a pause.* If the region is
> torn down, everything living in it is gone: an unsent draft, a paginated position, an expanded row, a
> request in flight whose response will arrive to no one. Decide per surface which of those the user is
> entitled to get back, and hold it somewhere the teardown cannot reach.
>
> **P6 — ui, and the asymmetry that produces the ugliest bug.** *A scroll offset survives a switch when
> the content does not, because the scroll belongs to the container and the content belongs to the
> region.* The user returns to a rebuilt panel scrolled to an offset that meant something in a different
> panel. Reset the offset with the content, or move the offset inside the region.
>
> **P7 — function, cost.** *A tab strip is a mount, so it is also a fetch.* Every switch pays the
> network cost of the panel again unless something outside the region remembers the last answer. On a
> local-first app that cost is small and the *flicker* is not: a settled panel becomes a ghost again on
> every return.
>
> **P8 — code-quality.** *Where the row and the region are written in different files, the contract
> between them is unenforced by anything.* One author will do everything right and the other will not
> know there was a contract. The strip's file is where the discipline is visible and the region's file
> is where the damage is.
>
> **P9 — function.** *The current choice is state, so it has a lifetime, and the lifetime must be
> chosen.* Local means it dies on every remount and cannot be linked to; shared means it survives
> navigation and can be pointed at from anywhere; persisted means it survives a restart. All three are
> right somewhere and only one is right per strip. Not choosing means choosing the first.
>
> **P10 — ui, and the honest limit of a row.** *A row of choices is only a tab strip when the choices
> swap the content; when they narrow it, it is a filter, and filters must not wear tab semantics.* The
> distinction is invisible in the markup and decisive for the assistive-technology contract: a filter
> announced as a tab promises a panel that will never arrive.
>
> **P11 — process.** *A switcher built to compare two candidate designs is a decision instrument, and a
> decision instrument that outlives its decision becomes a permanent feature nobody designed.* It ships,
> users find it, and both branches must now be maintained.
>
> **Scale condition.** P3, P4 and P10 are correctness on the first strip. P1, P2, P5 and P6 arrive at
> the **second** switch a user makes and are discovered as a bug report nobody can reproduce, because
> reproducing it requires switching away and back. P7 and P9 arrive with the second surface that wants
> the same panel. P8 arrives at the first refactor that moves the strip into its own component. P11
> arrives on a calendar.

### Warrant evidence — five siblings, censused independently

`personas-web` (Next 16, 597 `.tsx`), `brainiac` (Rust workspace + Next 15 console, 222 `.tsx`),
`personas-cloud`, `vibeman` (Next 16, 586 `.tsx`), `ascent` (Next 16, 336 `.tsx`). All five present and
opened. **`personas-cloud` is NOT-APPLICABLE** — 0 `.tsx` outside `node_modules` and no React dependency
in any of its three workspace packages. **The denominator for every clause is 4.** No cross-repo port
was found for this leaf; all duplication is intra-repo and self-declared, so the counts below are
deflated to independent authorings rather than call sites (per the doctrine's lineage rule).

- **P2 is PHYSICS, 4 of 4, unanimous, with zero counterexamples — and it is the strongest single result
  in this document.** Every keyed panel switch in every applicable sibling sits on an animated element:
  `personas-web/src/app/legal/LegalContent.tsx:159` (motion + `AnimatePresence`); `brainiac`
  `console/app/demo/DemoConsole.tsx:324`, `CortexMap.tsx:79`, `IngestMonitor.tsx:78`; `vibeman`
  `ExecutiveSummary.tsx:894`, `ArchitectureBottomBar.tsx:169-221`, `DatabaseHealthPanel.tsx:265-280`;
  `ascent` `src/components/report/ReportPanels.tsx:45`. **8 keyed sites, 8 animated, 0 keyed for state
  reset.** Two of them prove intent rather than correlation:
  - `brainiac`'s `DemoConsole.tsx:317-321` renders the **identical** panel content in a bare fragment
    **with no key at all** in the `prefers-reduced-motion` branch. The key is dropped the instant the
    animation is. If it were there to reset state, that branch would be a behaviour bug.
  - `ascent` wrote the reason down: *"the section switch owns its own cross-fade: the wrapper is keyed
    on `tab`, so React remounts it on every change and replays `animate-fade-in`"*
    (`ReportPanels.tsx:5-6`, repeated inline at `:43`). State reset is not mentioned — and its real
    consequence is: every section switch discards `RoadmapSandbox`'s slider state (`:62-67`).
  - Corroborating from a third angle: `vibeman`'s `ExecutiveSummary` puts the key on the inner
    `motion.div` (`:894`) and leaves the semantic `role="tabpanel"` wrapper one line above (`:891`)
    unkeyed. The key follows the animation, not the semantics.
- **P3 is PHYSICS, and it is convergent as a FAILURE — which is stronger evidence than agreement.**
  Only **5 of 19** sibling strips attempt `aria-controls` at all, and **3 of those 5 dangle**, always
  for the same reason: the panel is conditionally rendered. `personas-web/app/dashboard/knowledge/page.tsx:115`
  emits 3 references against 1 panel (`:137`) — 2 dead at all times.
  `personas-web/…/VariantTabs.tsx:58` emits 2 against a panel in a *different file* — 1 dead.
  `vibeman/…/ArchitectureBottomBar.tsx:106` emits 4 against 4 ids that live inside
  `{isExpanded && …}` (`:151`) — 3 dead when open and **all 4 dead in the bar's default collapsed
  state.** The only strip in six repos where the reference cannot dangle is
  `personas-web/src/components/guide/blocks/TabBlock.tsx:81`, **which renders every panel and hides the
  inactive ones.** That is the answer, and it was found by exactly one of nineteen.
- **P4 is a SILENCE that is a warning, not a licence — and Personas is the only repo with the bug.**
  `personas-web` is 6/6 roving-tabindex-with-arrows; `vibeman` is 7/8 paired (`useTabNavigation.ts:7`,
  6 call sites) and its 8th (`TinderLayout.tsx:250`) has *neither* half, so nothing is trapped;
  `brainiac` and `ascent` have **zero** of both and leave plain focusable buttons. **Zero
  keyboard-unreachable sites in four repos.** The two repos that adopted roving tabindex adopted both
  halves, independently — `personas-web` does index math on a `readonly` order array, `vibeman` queries
  the DOM and dispatches a synthetic `.click()`; no shared code. Counting authorings rather than sites,
  that is 2 independent reinventions of the pair and 0 of the half. **This repo has the only
  half-adoption in six** (§7 D3).
- **P1 and P8 are a SILENCE, 0 of 4, and it inverts the usual reading: nobody else has a shared
  tab-strip component at all.** Zero tab libraries in 4/4 `package.json` (`@radix-ui/react-tabs`,
  `@headlessui/react`, `react-tabs`, `@mui/material`, `@base-ui`, `ariakit` — none). Nineteen strips,
  nineteen hand-rolled markups. The two near-misses are **opposite halves of what this repo has**:
  `vibeman` extracted only the *behaviour* (`useTabNavigation`, 6 sites) and left a complete, correct
  props-builder — `src/lib/accessibility/aria.tsx:329-337`, `ariaProps.tab(panelId, isSelected)` /
  `ariaProps.tabPanel(tabId, isHidden)` — with **0 consumers**, which is `segmentedTabPanelProps`'s
  exact fate in a repo that never spoke to this one. `ascent` extracted only the *shell*
  (`SideNav.tsx:67`, 2 sites) and **deliberately stripped the tab roles out of it**, documenting the
  choice of `aria-current="true"` at `:56-59`. **Personas is alone in having a tab-strip primitive, and
  the one thing two siblings independently produced is an unused ARIA helper. P1's prescription is
  house convention; the 0-consumer helper is physics.**
- **P9 is DIVERGENT, 4-way, with no shared instinct — and this repo's answer is a fifth one.**
  URL-first: `brainiac` 3/3 (`DemoConsole.tsx:238` reads `useSearchParams()` **in the `useState`
  initializer**, with a `popstate` listener at `:243-249` so browser back/forward walks the tabs) and
  `ascent` 2/3 (`ReportView.tsx:133-146`, validated against `validTabs`, `?tab=` deleted for the
  default). Local `useState`: `vibeman` **8/8** — not one tab survives a remount, and zustand is a
  dependency it uses elsewhere. `personas-web` 6/7 local with one zustand+localStorage. **Personas has
  no router and therefore no URL at all** (§12.5) — and reached the same capability by a different
  road: 18 tab fields in one store, 10 persisted across restart, and **63 non-store call sites that
  deep-link into a tab**. On the deep-link half this repo is ahead of three of four; on the *panel*
  half it is behind, because 32 of its 34 strips still hold the choice locally.
- **P7 is a TOTAL SILENCE, 0 of 4, and two repos own the tool and did not point it at this.**
  `personas-web` ships SWR in 10 files and `vibeman` ships `@tanstack/react-query` in 20, and **neither
  library is wired to a single tab panel** — in both, fetching sits *above* the strip, so
  cache-correctness on switch is accidental rather than designed. One confirmed refetch-on-switch:
  `vibeman/DatabaseHealthPanel.tsx:109-131`, an uncached `fetch` in a `useEffect` inside a panel that
  unmounts whenever the bar collapses. No module-scope cache anywhere in four repos. **Personas has 48
  files with one (`hand-rolled-module-cache`) and 2 of 31 tab hosts using it — which is the fleet's
  best score and still nearly zero.**
- **P10 and P11 are UNTESTED externally.** No sibling was found mislabelling a filter as a tablist, and
  no sibling ships an A/B design switcher. Both are marked house conventions, earned locally (§7 D8,
  D10).

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "put these on tabs" · "add a tab for X" · "split this panel into sections"
- "switch between the list view and the graph view" · "Overview / Details / JSON"
- "why did my form clear when I came back to this tab?" · "it reloads every time I switch"
- "the tab bar looks right but arrow keys do nothing" · "this tab opens scrolled to the middle"
- "let's A/B two designs behind a switcher for now"
- **The "about to write X" test:** you are about to type
  `const [activeTab, setActiveTab] = useState<'a' | 'b'>('a')`, a `.map` over a `TABS` array producing
  `<button className={active ? … : …}>`, `role="tablist"`, `{tab === 'x' && <PanelX/>}` twice in a row,
  or `key={activeTab}` on a wrapper.

You are **not** in this situation when the row *narrows* what one region shows rather than *replacing*
it — that is a filter, it belongs to [filtering-and-search](./filtering-and-search.md), and giving it
`role="tab"` is a defect in its own right (§7 D8). Nor when the choice navigates to a different route:
that is [navigation-destination](./navigation-destination.md). **The discriminator is that the region
below is a different thing, not the same thing with fewer rows — and that the choices are all visible
at once, which is what separates a tab strip from a dropdown
([dropdown-and-select](./dropdown-and-select.md)).**

---

## 2. The one way

**Render the row with `SegmentedTabs`, and then render the panel yourself — declared, keyed on purpose,
and mounted so a switch cannot destroy something the user is entitled to keep.** Concretely: reach for
`SegmentedTabs` from `@/features/shared/components/layout/SegmentedTabs` for a pill/segment row inside a
panel, or `PanelTabBar` for an underlined bar spanning a page header; both give you `role="tablist"`,
`role="tab"`, `aria-selected`, roving `tabIndex` and full Arrow/Home/End navigation, which is the entire
half of this leaf you should never hand-roll. **Then pass `idPrefix` — always, not optionally — and
spread `segmentedTabPanelProps(prefix, activeTab)` onto the element that holds the panel**, because
`SegmentedTabs` emits `aria-controls` whether or not you do, and skipping this is how 21 of 21 call
sites ended up pointing at nothing (§0). Give the panel wrapper a `key` **only if you have decided that
switching should throw away what is in it**, and when you do, write the reason on the line above;
if you also want the fade, take it from `TabTransition` and know that you are getting a reset with it.
If switching must *not* throw work away — an unsent draft, a long form, a paginated position — do not
key it, and hold that state above the strip or in a module-scoped cache
([shared-fetch-cache](./shared-fetch-cache.md)), because **a tab switch is a full unmount** (executed:
one round trip destroyed a half-typed field and re-issued its fetch). Reset the shared scroll container
in the same handler that changes the tab, or the user arrives at a rebuilt panel scrolled to a position
that meant something else (executed: `scrollTop` survived a switch that destroyed the content). If the
panel fetches, wrap it in `<Suspense>` with a delayed ghost the way the page-level switches already do —
3 of 31 tab hosts do this against 9 of 10 pages. And if the choice should be linkable, put it in a store
slice rather than `useState`: this app has no router, so the store *is* the URL, 63 call sites already
deep-link that way, and a `useState` tab is unreachable from anywhere else in the app forever.

If you can only get one right: **`idPrefix` + the panel props**. A missing arrow key is an annoyance a
mouse user never meets; a dangling `aria-controls` is a promise made to a screen-reader user that the
app cannot keep, and it is the only defect here that is *worse* than having done nothing.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`shared/components/layout/SegmentedTabs.tsx` — `<SegmentedTabs<T> tabs activeTab onTabChange />`** | **The row, and it is genuinely good.** `role="tablist"` + `aria-orientation` (`:107`), `role="tab"` + `aria-selected` + roving `tabIndex={active ? 0 : -1}` (`:120-126`), Arrow/Home/End with disabled-skipping and wrap-around (`:44-99`), a per-instance framer `layoutId` so two bars never share an indicator, `variant: 'pill' \| 'segment'` and `size: 'sm' \| 'md'`. **21 render sites / 18 files — the app's default answer.** Executed: ArrowRight moves the selection and calls `preventDefault`. |
| **…`idPrefix` + `segmentedTabPanelProps(prefix, id)` (`:176-182`)** | **The panel half — and the reason this document exists.** Returns `{ role: 'tabpanel', id, 'aria-labelledby' }`. Without `idPrefix` the tab's `aria-controls` is built from a `useId()` you cannot obtain, so the panel is **unbuildable**. **0 consumers. 1 of 21 sites passes `idPrefix`, and even that one has no panel.** |
| **`shared/components/layout/PanelTabBar.tsx` — `<PanelTabBar tabs activeTab onTabChange underlineClass idPrefix? />`** | The underlined page-header bar. Same ARIA and keyboard contract, plus a documented `underlineClass` that is **required with no default** because each panel picks its own brand accent (`:14-27`). **2 render sites — and both pass `idPrefix` and render a real `role="tabpanel"` with matching `id` and `aria-labelledby`** (`CloudDeployPanel.tsx:212,224-226`; `GitLabPanel.tsx:134,142-144`). It is the only primitive in this leaf whose consumers are all correct — see §6.1 for why, and §12.3 for why the number 2 is smaller than it looks. |
| **`templates/sub_generated/shared/TabTransition.tsx` — `<TabTransition tabKey>`** | The entrance fade. **3 render sites.** Its whole body is `<div className="animate-fade-slide-in" key={tabKey}>` — so it is also, silently, a full remount of everything inside it. Use it when you want both. Do not use it when you only want the fade; there is no version that gives one without the other (§8.2). |
| **`lib/lazyRetry.ts` + `shared/components/layout/RouteChunkSkeleton.tsx`** | The panel's cold-load answer, already proven at page level: `OverviewPage.tsx:15-33,48-60,77` is the reference — `lazyRetry` per arm, `<Suspense>` around the switch, a **header-only ghost behind a 150ms `animation-delay`** so a warm chunk paints nothing. **3 of 31 tab hosts do this.** |
| **`stores/slices/system/uiSlice.ts` (+ `systemStore.ts` `partialize`)** | Where a tab choice goes when it must outlive the component. 18 `*Tab` fields; 10 in `partialize` and therefore restored after a relaunch. This is this app's substitute for a URL, and it works: **63 call sites deep-link into a tab through it.** |

**The exemplar to copy — and it is hand-rolled:**

| | |
| --- | --- |
| **`templates/sub_generated/gallery/modals/TemplateDetailModal.tsx`** | **The only complete tab strip in the repo.** `role="tablist"` (`:203`), `role="tab"` + `aria-selected` + `aria-controls={`tabpanel-${tab.key}`}` + roving `tabIndex` (`:215-219`), Arrow/Home/End (`:86-108`), and a real `role="tabpanel" id={`tabpanel-${effectiveTab}`} aria-labelledby={`tab-${effectiveTab}`}` (`:241-243`) whose ids **match**. It is what `SegmentedTabs` + `segmentedTabPanelProps` would produce if anyone used them. |

**Do not exist — this path names them:**

- **Any primitive that owns the panel.** Both primitives render only the row. The contract between the
  row and the region is prose in a helper nobody imports, and §7 is what that costs.
- **Any way to get the fade without the reset.** `TabTransition` fuses them in two lines; the four
  sibling repos fused them eight times out of eight (head, P2).
- **Any tab-level loading convention.** `RouteChunkSkeleton` exists and is a *route* skeleton; 3 of 31
  tab hosts use it and there is no panel-shaped equivalent.
- **Any tab-selection type.** `SegmentedTabs<T extends string>` is generic over the caller's union, so
  the strip and the panel share a type only when they are in the same file (§4).
- **Any keyup/keypress handling.** Both primitives are `onKeyDown`-only. No site needs otherwise.

---

## 4. Steps

1. **Decide first whether this is a tab strip at all.** If the row narrows one region rather than
   replacing it, it is a filter — build it as one and give it no tab roles
   ([filtering-and-search](./filtering-and-search.md)). `HealingIssuesPanel.tsx:184-186` has the comment
   `{/* Filter Chips */}` directly above `role="tablist"`; that is the mistake, written down.
2. **Render the row with `SegmentedTabs`** (or `PanelTabBar` for a page-header bar). Do not hand-roll:
   the row is the half the primitive gets completely right, and the one hand-roll that took half of it
   made two tabs unreachable (§7 D3).
3. **Pass `idPrefix`.** Not optional. It is the only way the tab's `aria-controls` becomes obtainable.
4. **Spread `segmentedTabPanelProps(prefix, activeTab)` onto the panel wrapper.** One line. It is
   currently the least-used correct thing in this leaf (0 consumers) and the most-shipped defect (21
   dangling references).
5. **Decide the reset, out loud.** Ask: *if the user switches away mid-edit and comes back, what should
   still be there?* If the answer is "nothing", key the wrapper on the tab **and write that sentence
   above the `key`**. If the answer names anything — a draft, a filter, a scroll position, a page
   number — do **not** key it, and hoist that state above the strip.
6. **Then check what the switch does anyway,** because an unkeyed switch is still a mount: different
   component types at different positions unmount regardless of the key (executed, E2/E4). If the panel
   fetches, either hoist the fetch above the strip or give it a module-scope cache
   ([shared-fetch-cache](./shared-fetch-cache.md)).
7. **Reset the scroll container in the same handler that sets the tab.** The container outlives the
   panel; the offset means nothing in the new one (executed: 640px survived).
8. **If the panel is lazy or fetches on mount, wrap it in `<Suspense fallback={<RouteChunkSkeleton/>}>`.**
   Copy `OverviewPage.tsx:77` verbatim, including the delayed ghost.
9. **Choose the selection's lifetime** (P9). `useState` if the strip is inside a modal that is itself
   transient; a `uiSlice` field if anything else in the app should be able to point at this tab; the
   `partialize` list if it should survive a relaunch. There is no URL to fall back on.
10. **If this is an A/B switcher for a design decision, put its deletion in the same commit's plan.**
    Two are 114 days old (§7 D10).
11. **Ask the type question now, before §9** — see below.
12. **And then stop.** Whether a crashed panel can be recovered is
    [error-boundary](./error-boundary.md); the ghost's timing is
    [`docs/design/overview-loading.md`](../../design/overview-loading.md); a *global* key binding is
    [keyboard-shortcut-registration](./keyboard-shortcut-registration.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes, and the repo has already run the experiment on itself. The fix is four characters in one file
and it corrects 21 call sites.**

The dangerous freedom is not "forgetting the panel" — it is that **the primitive emits a claim about
the panel whether or not the caller can honour it**. Two sibling primitives in one folder differ on
exactly this line and score 0/21 versus 2/2:

```tsx
// PanelTabBar.tsx:86 — WITHHOLDS. The attribute does not exist unless the caller declared a panel.
aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}

// SegmentedTabs.tsx:124 — EMITS, always, at an id derived from useId() that the caller cannot obtain.
aria-controls={panelId}
```

The one-line fix is to make `SegmentedTabs` behave like its sibling. The stronger fix closes the door
entirely:

```ts
// src/features/shared/components/layout/SegmentedTabs.tsx  (proposed)
interface SegmentedTabsProps<T extends string> {
  tabs: SegmentedTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  /** REQUIRED. Namespaces the tab ids; the panel is built with `segmentedTabPanelProps(idPrefix, activeTab)`.
   *  Pass `'none'` only for a strip whose panel is in another file — and then no aria-controls is emitted. */
  idPrefix: string | 'none';
  …
}
```

Held against the doctrine's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** ⚠ and this is the honest limit. `idPrefix`
  encodes *"the caller has a namespace for the panel"* and **not** *"the caller rendered one"*.
  `DecisionModeTabs.tsx:61` passes `idPrefix="approvals-mode"` and there is no panel anywhere in the
  tree. Requiring the prop would have converted 20 silent defects into 20 loud ones and left that one
  untouched. **The prop is the right edit and it is not sufficient**, which is exactly why §9 gates the
  residue with a rule that keys on the *panel*, not on the prop.
- **Q2 — requiredness ≠ closedness.** ✔ and here they point at different things. Making `idPrefix`
  **required** is the whole win, because the current default (`useId()`) is not a neutral fallback — it
  is a value that makes the correct completion *impossible*. Closing the type buys nothing extra.
- **Q3 — a type nobody constructs constrains nothing.** ✔ **21 construction sites on the day it lands.**
  Compare `--max-budget-usd`, refused at one site in 963 files
  ([headless-model-call](./headless-model-call.md)).
- **Q4 — a type anyone can construct authenticates nothing.** ✔ `idPrefix` is a `string`; anyone can
  pass `''`. But the failure is now *visible in the caller's own file* rather than in a generated id
  nobody sees, which is the whole difference between these two primitives today.
- **Q5 — withholding beats requiring.** ✔ **and this is the corpus's cleanest in-repo controlled
  experiment for it.** Same folder, same concept, same authors, same week. `PanelTabBar` withholds the
  attribute and its callers built the panel: **2/2**. `SegmentedTabs` hands it over unconditionally:
  **0/21**. Documentation asked, too — `segmentedTabPanelProps` has been exported the entire time and
  has **0 importers**. `vibeman` ran the same experiment without knowing: `aria.tsx:329-337` is a
  complete tab-props builder with **0 consumers** and 8 hand-rolled strips beside it.
- **Q6 — withhold the dangerous freedom, not the answer.** ✔ The `'none'` escape is load-bearing:
  `DecisionModeTabs`, `CapabilityTagBar`, `ExecutionDetailTabs` and `passportInk` are **strip-only
  components whose panel is genuinely in another file** (11 of 34 anchors). Withholding without that
  valve would force those four to lie.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.** ✔
  Nothing forces `ByomSettings.tsx:162` to omit the panel; the API simply never mentioned one. Widening
  any existing signature is inert. **The construction — an `aria-controls` the caller cannot satisfy —
  is what must be withheld.**

**Where the type does not reach**, four places, all measured:

1. **The panel's `key`.** No signature can express "this reset was chosen". The primitive does not
   render the panel and cannot see the wrapper. This is the doctrine's *"types cannot reach across a
   boundary the value never crosses"* in a UI costume, and it is why P2 is prose.
2. **The 11 strips whose panel lives in another file.** `ExecutionDetailTabs.tsx` does everything right
   and its panel is a ternary chain 30 lines into `ExecutionDetail.tsx:104-127` with no `role`, no `id`
   and no `key`. TypeScript sees two correct files.
3. **The filter-wearing-tab-clothes case** (P10). `role="tablist"` on a chip row is type-correct JSX.
4. **The 180-odd hand-rolled selector rows** that never reach a primitive at all. No signature reaches
   a `<button>` in a `.map`. **This is where a census rule genuinely earns its place** — and §9 declines
   to gate *that* population, for reasons with numbers.

**The one-edit version, if only one lands:** make `idPrefix` required on `SegmentedTabs`. One edit at
the primitive, 21 call sites corrected, and — per the contract's *"prefer fixing the default over
counting the callers"* — no ratchet would ever have moved a single one.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`<SegmentedTabs …/>` with no `idPrefix` and no panel props** | Ships an `aria-controls` pointing at an element that does not exist. **Executed: 3 of 3 dangling, 0 `role="tabpanel"` in the tree.** A screen reader is told there is a panel and cannot find it — strictly worse than omitting the attribute. **21 of 21 sites.** |
| **Hand-rolling the row** | You will get `role="tablist"` and `aria-selected` (everyone does) and lose the keyboard. **11 of 34 strips are hand-rolled; 4 have arrow keys.** |
| **Roving `tabIndex={active ? 0 : -1}` with no arrow handler** | **Strictly worse than no ARIA at all.** You removed the inactive tabs from the Tab order and gave nothing back. **Executed: 2 of 3 tabs unreachable by keyboard.** `DraftEditStep.tsx:129`. **Zero sibling repos have this; it is unique to us.** |
| **`key={activeTab}` added "for the animation"** | You also chose to destroy everything in the panel, and you did not know you were choosing. **12 of 12 keys in this repo and 8 of 8 across four sibling repos are on an animated wrapper.** `TabTransition.tsx:8-9` is the two lines fused. |
| **Deleting the animation and leaving the switch unkeyed** | The reset goes with it, silently. `PersonasPage.tsx:403` did exactly this, and [error-boundary](./error-boundary.md) executed the consequence: a healthy section inherits a crashed one's latched card. |
| **`{tab === 'a' && <A/>}{tab === 'b' && <B/>}` with a draft inside** | A switch is a full unmount. **Executed: a half-typed field came back empty and the panel refetched.** |
| **The same component type at both arms of a ternary chain** | The opposite failure: React updates props instead of remounting, so the new tab renders the old tab's state. **Executed: `data-local="edited-in-a"` displayed under tab b, 1 mount.** `OverviewPage.tsx:78` and `:94` are both `<DashboardWithSubtabs/>`. |
| **Leaving the shared scroll container alone** | **Executed: `scrollTop=640` survived a switch that destroyed the content.** The user lands mid-way down a panel they have never seen. |
| **A panel that fetches on mount with no cache** | Every switch is a network round trip and a fresh ghost. **3 of 31 tab hosts wrap the panel in `<Suspense>`; 2 reference any skeleton.** Against 9 of 10 at page level. |
| **`role="tablist"` on a filter chip row** | Promises a panel that will never arrive. `HealingIssuesPanel.tsx:184-186` — the comment `{/* Filter Chips */}` sits directly above the role. |
| **`useState` for a tab another surface will want to open** | Unreachable from anywhere else, forever. This app has no router, so the store is the only address space; **63 call sites already use it and 32 of 34 strips cannot be addressed at all.** |
| **An A/B switcher left in** | It stops being an experiment and becomes a feature with two branches to maintain. **2 components, 3 sites, 114 days, both self-labelled "throwaway scaffolding".** |

---

## 6. Evidence

### 6.1 The controlled experiment inside one folder

```tsx
// PanelTabBar.tsx:86        aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
// CloudDeployPanel.tsx:212  idPrefix="cloud-deploy"
//                    :224   <div role="tabpanel" id={`cloud-deploy-panel-${activeTab}`}
//                    :226        aria-labelledby={`cloud-deploy-tab-${activeTab}`}>          ✔ resolves

// SegmentedTabs.tsx:124     aria-controls={panelId}          // always
//                  :41      const prefix = idPrefix ?? `segtabs-${autoId}`
// ByomSettings.tsx:162      <SegmentedTabs<ByomSection> … />  // no idPrefix
//                 :179-220  {bm.activeSection === 'policy' && <ByomProviderList … />}  …    ✘ 5 arms, 0 panels
```

Two primitives, one folder, one concept. **The only behavioural difference is whether the attribute is
withheld, and it predicts 2/2 versus 0/21.** This is the strongest single piece of evidence in the
document, and §12.3 records honestly why its right-hand column is worth more than its left.

### 6.2 The one site to copy

`TemplateDetailModal.tsx` — hand-rolled, and the only strip in 4,829 files that closes the loop:

```tsx
:203  <div role="tablist" …>
:215    <button role="tab" aria-selected={isActive}
:218           aria-controls={`tabpanel-${tab.key}`}
:219           tabIndex={isActive ? 0 : -1}
:86-108 handleTabKeyDown — ArrowRight/ArrowDown, ArrowLeft/ArrowUp, Home, End
:241  <div role="tabpanel"
:242       id={`tabpanel-${effectiveTab}`}
:243       aria-labelledby={`tab-${effectiveTab}`}>
:246    <TabTransition tabKey={effectiveTab}>          // the fade AND the reset, fused
```

Copy this shape — but reach it through `SegmentedTabs` + `idPrefix` + `segmentedTabPanelProps`, which
produces the same markup and gives you the keyboard for free. And note the residual limitation this
site cannot escape and no site in six repos escaped except one: **only the active panel exists, so
`aria-controls` resolves for 1 of N.** The only complete answer found anywhere is
`personas-web`'s `TabBlock.tsx:81`, which renders every panel and `hidden`s the inactive ones.

### 6.3 The discriminator, with the rival raced

Three hypotheses for *why some panel switches are keyed and most are not*.

| hypothesis | prediction | measured |
|---|---|---|
| **H1 — the wrapper carries an entrance animation** | keyed ⟺ animated | **12 of 12 keyed panels are on an animated wrapper. 0 counterexamples.** Across four sibling repos: **8 of 8**, also 0. |
| **H2 — altitude: page-level switches are keyed, in-page tabs are not** | keyed ⟺ top-level | **10/10 at page level and 26/31 at tab level — and REFUTED by its two most important cases.** `PersonasPage.tsx:405` is the top-most switch in the app and is **unkeyed**; `DraftEditStep.tsx:146` is buried inside a modal step and is **keyed**. H1 explains both: PersonasPage deleted its `AnimatePresence` (`:403`, comment included) and the key went with it; DraftEditStep carries `animate-fade-slide-in` (`:150`). |
| **H3 — adopting the primitive brings the discipline** | `SegmentedTabs` hosts key their panels | **REFUTED, 0 of 18.** The primitive owns the row and has no opinion about the region, so adopting it predicts nothing about the region. |

H1 survives; H2 and H3 do not. The mechanism is not a habit and not an altitude — **it is that
`key` is the only tool React offers for "replay this CSS animation", so every author who wanted a fade
reached for it, and none of them was reasoning about state.** `TabTransition.tsx:8-9` is that sentence
compiled; `brainiac`'s reduced-motion branch dropping the key (`DemoConsole.tsx:317-321`) and `ascent`
documenting it as *"replays `animate-fade-in`"* (`ReportPanels.tsx:5-6`) are the same sentence written
by people who have never seen this repo.

### 6.4 The split-file contract, in one pair

```tsx
// ExecutionDetailTabs.tsx — the strip, and it is careful
:62-72   handleKeyDown: ArrowLeft/ArrowRight, wrap-around, then .focus() the new tab
:77      role="tablist"    :86 role="tab"   :88 aria-selected   :90 tabIndex={active ? 0 : -1}

// ExecutionDetail.tsx — the panel, 30 lines away, in a different file
:104-127 {activeTab === 'director' && … ? ( … ) : activeTab === 'replay' ? ( … ) : …}
         no role="tabpanel", no id, no key, no Suspense
```

The strip author did everything the standard asks. The panel author, one import away, did not know
there was a standard to follow. **11 of 34 anchors are this shape** and it is P8's entire warrant.

---

## 7. Deviations

**Not applied.** Every entry changes what a click does in an app the operator uses daily, so each is a
note with enough detail to act on later.

**D1 — 21 of 21 `SegmentedTabs` sites ship a dangling `aria-controls`. Executed. This is the headline.**
`SegmentedTabs.tsx:124` emits `aria-controls={panelId}` unconditionally, where `panelId` derives from
`useId()` (`:41`) unless `idPrefix` is passed. **1 of 21 sites passes it** (`DecisionModeTabs.tsx:61`)
and even that one renders no panel. `segmentedTabPanelProps` (`:176-182`) has **0 consumers**, and
`role="tabpanel"` appears **4 times in the entire tree**, none of them in a `SegmentedTabs` file.
Replayed in jsdom against the `ByomSettings.tsx:162-220` shape: **resolved 0, dangling 3.** *Fix:*
§4's `idPrefix` requirement plus one line per call site; or, minimally, copy `PanelTabBar.tsx:86`'s
conditional into `SegmentedTabs.tsx:124` so the false claim is never made.

**D2 — a tab switch is a full unmount, and nothing anywhere caches across it. Executed.** Transcribed
`ByomSettings`'s five `activeSection === 'x' && <Panel/>` arms and switched once away and back:
`mounts {policy: 2}`, `fetches {policy: 2}`, and a half-typed field returned **empty**. **3 of 31 tab
hosts wrap the panel in `<Suspense>` and 2 reference any skeleton**, against 9 of 10 and 7 of 10 at page
level, so most panels re-ghost with no delay guard on every return. The repo owns the right mechanic —
`hand-rolled-module-cache` counts 48 files — and points it at almost no tab. *Fix (note only):* hoist
the fetch above the strip, or add the module-scope cache
([shared-fetch-cache](./shared-fetch-cache.md)); and add `<Suspense fallback={<RouteChunkSkeleton/>}>`
copying `OverviewPage.tsx:77`.

**D3 — `DraftEditStep.tsx:129` makes two of its three tabs keyboard-unreachable. Executed.** It sets
`tabIndex={activeTab === tab.id ? 0 : -1}` (roving) and handles **no** keys. Replayed: ArrowRight on the
tablist changed nothing and did not `preventDefault`, while the two inactive tabs sat at `tabIndex=-1`.
**This is the only such site in this repo and there are zero across four sibling repos** — `personas-web`
is 6/6 paired and `vibeman` 7/8 paired; the two repos without roving tabindex omitted both halves and
are therefore fine. *Fix:* one import — render the row with `SegmentedTabs`, which already ships the
handler; or, if the bespoke pill styling must stay, copy `ExecutionDetailTabs.tsx:62-72`.

**D4 — the scroll offset survives a switch that destroys the content. Executed.** The shared scroll
container never unmounts, so `scrollTop=640` was still 640 after a round trip that emptied the panel.
Affects every tab strip whose panels share one scroller — the dominant shape. *Fix:* reset the container
in the `onTabChange` handler, or move `overflow-y-auto` inside the panel wrapper so it dies with it.

**D5 — `PersonasPage.tsx:403-405` renders `{renderContent()}` in an unkeyed `<div>` with
`AnimatePresence` explicitly disabled.** 10 rail sections plus 20 sub-routes share one position. Owned
for the crash-latch consequence by [error-boundary](./error-boundary.md) §7 D1, which executed it.
**Listed here because it is H1's natural experiment**: it is the one surface in the app where the
animation was deliberately removed, and the key vanished with it — nobody connected the two, because
nobody knew they were connected. *Fix:* `key={sidebarSection}` on that div, which is one line and
restores the reset the other nine section switches have.

**D6 — the same component type at both arms of a chain carries state across the switch. Executed.**
`OverviewPage.tsx:78` and `:94` both render `<DashboardWithSubtabs/>`; `PersonasPage`'s `renderContent()`
returns `<ErrorBoundary>` at one position for every branch. Replayed with an instrumented shared
component: **1 mount across the switch, and tab b displayed the edit made in tab a.** The `key` on
`OverviewPage.tsx:69` protects it; `PersonasPage` has none. *Fix:* the key from D5.

**D7 — `HealingIssuesPanel.tsx:184-186` is a filter chip row wearing `role="tablist"`.** The comment
`{/* Filter Chips */}` is on the line above. The three chips (`all` / `open` / `auto-fixed`) narrow one
list; they do not swap a panel, and there is no panel to control. *Fix:* delete `role="tablist"` and
`role="tab"`, keep `aria-pressed`. **This is the legal fix in the "remove the semantics" direction, and
§9's rule accepts it.** `CapabilityTagBar.tsx:29`, `passportInk.tsx:145` and
`CapabilityTagSwitcher.tsx:67` need triage in the same pass.

**D8 — 32 of 34 tab strips hold the selection where nothing else can reach it.** Two read a store
(`PatternsPanel.tsx:118`, `FleetTerminalOverlay.tsx:205`); the rest are `useState` or a prop from a
`useState` parent. This app has **no router** (no `react-router`, no `@tanstack/router`, no `wouter` in
`package.json`), so the store is the entire address space — and it demonstrably works, with **63 call
sites deep-linking into a tab** and 10 of 18 `*Tab` fields surviving a relaunch via
`systemStore.ts`'s `partialize`. Every one of those 63 doors opens a *page*; not one can open a
sub-tab. *Fix (per strip, not a sweep):* promote the strips a notification, command-palette entry or
companion action would want to target.

**D9 — 8 of 18 store-held tab fields are not persisted, and the split looks unconsidered.** `artistTab`,
`cloudTab`, `companionPluginTab`, `designSubTab`, `editorTab`, `homeTab`, `obsidianBrainTab`,
`pluginTab`, `settingsTab`, `twinTab` are in `partialize`; `agentTab`, `devToolsTab`, `eventBusTab`,
`goalsTab`, `kpisTab`, `researchLabTab`, `teamsTab`, `templateTab` are not. `pluginTab`'s entry carries
a written rationale (`systemStore.ts:92-95`); the eight omissions carry none. *Fix:* decide each one and
write the reason, in the file, the way `pluginTab` did.

**D10 — two A/B prototype switchers, both self-labelled throwaway, are 114 days old.**
`plugins/research-lab/shared/PrototypeTabs.tsx` — *"This file is throwaway scaffolding — once a winner
is chosen for each page it gets inlined and this strip removed"* (`:6-7`) — 2 render sites
(`LiteratureSearchPanel.tsx`, `ResearchProjectList.tsx`).
`plugins/twin/variants/TwinVariantTabs.tsx` — *"This is throwaway scaffolding — once a winner is picked
the wrapper is collapsed and only the chosen variant remains"* (`:30-31`) — 1 render site
(`TonePage.tsx`), and it **persists the user's pick to `localStorage`** (`:37,:45`), which is a feature,
not scaffolding. Both born **2026-04-25** (`git log --follow`: `c3cbe48ab`, `8cf3f3d5a`). *Fix:* pick
the winners and delete both files. **The brief expected four; three render sites across two components
is the measured number (§12.4).**

**D11 — `FleetTerminalOverlay.tsx:205` puts a `SegmentedTabs` above a grid of live terminals.** Its
Arrow/Home/End handling is element-scoped and therefore safe, but
[embedded-terminal-session](./embedded-terminal-session.md) established that a focused
`@xterm/xterm` calls `preventDefault()` + `stopPropagation()` on `_keyDown`, so **any future attempt to
drive this strip from a global binding is dead while a terminal has focus.** No defect today; recorded
so the next author does not discover it by experiment. Handed to that path.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **Neither primitive renders the panel, and neither can.** They are row components. Every property
   this document cares about — the reset, the mount, the fetch, the scroll, the crash — lives in the
   region, which the primitive never sees. **This gap is upstream of D1, D2, D4, D5 and D6.** The
   in-fleet answer that would close it is a `<Tabs>` compound component owning both halves; nobody in
   six repos has built one.
2. **There is no way to replay the entrance animation without remounting.** `key` is React's only
   handle for "restart this CSS animation", so `TabTransition.tsx:8-9` fuses the two and every author
   in five codebases did the same. A CSS-variable or `animationName` toggle would separate them; none
   exists here or in any sibling.
3. **`aria-controls` cannot be honest while only the active panel is rendered.** For N tabs, N−1
   references are dead by construction. The only complete escape found in six repos is rendering every
   panel and hiding the inactive ones (`personas-web/…/TabBlock.tsx:81`), which trades correctness for
   N times the mount cost — a real trade, not a free win.
4. **`SegmentedTabs<T extends string>` cannot link the strip's union to the panel's switch.** They share
   a type only when they share a file, so the 11 split-file strips get no compile-time help at all.
5. **There is no panel-shaped loading primitive.** `RouteChunkSkeleton` is a route header ghost; a tab
   panel that is a chart, a table and a form in three arms has no geometry-matched equivalent, which is
   part of why 28 of 31 hosts skipped the ghost entirely.
6. **The census cannot see D2, D4, D5, D6, D9 or D10.** They are runtime interactions between files, or
   absences (a cache that does not exist, a reason that was not written). §9 says what to build instead.

---

## 9. The missing gate

**The condition, stated stack-free:** *a control declares that it selects among mutually exclusive
regions, and no region in the codebase declares that it is one of them — so the relationship the control
advertises exists only in the visual layout.*

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `stateless-disclosure-control` (56/59, `expandable-row`) | a toggle with no `aria-expanded` | Nearest in *spirit* — an interactive control failing to publish its state. Different attribute, different role, different construct. **File overlap measured: 1 of 27** (`HealingIssuesPanel.tsx`, which has both defects and is D7). |
| `unregistered-key-handler` (72/72, `focus-management`) | `addEventListener('key*')` on window/document | Global bindings. A tablist's `onKeyDown` is an element prop and contains no such token. **Overlap 1 of 27.** |
| `unfocusable-click-target` (32/38, `focus-management`) | a `div` with `onClick` and no `tabIndex`/`role` | Whether a mouse target is reachable at all. Mine fires on elements that already have `role="tab"`. **Overlap 0.** |
| `unresettable-error-boundary` (16/25, `error-boundary`) | a boundary with no `key`/`resetKey`/`onReset` | The nearest neighbour by *consequence* — it owns what the unkeyed swap does to a crash. Mine owns what the strip declares. **Overlap 0 of 27.** |
| `hand-rolled-module-cache` (48/71, `shared-fetch-cache`) | a hand-rolled cache | Owns D2's *answer*; cannot see that a tab switch is what needs one. **Overlap 0.** |
| `live-region-born-with-its-message` (17/17) · `page-title-outside-header-primitive` (18/18) | ARIA live regions · page titles | Adjacent a11y/layout territory, different anchors. **Overlap 0 each.** |
| `hand-rolled-spinner` (182/248, `inline-busy-state`) | a hand-rolled spinner | Different concept entirely; **overlap 3 of 27**, all files that happen to contain both. |
| `unnamed-keyboard-priority` (12/13) · `capture-phase-key-preemption` (2/2) · `hand-rolled-outside-click` (46/47) · `hand-rolled-row-stagger` (4/4) · `unnamed-cast-at-navigation-door` (9/20) · `unchecked-destination-id-assertion` (19/54) | keyboard ranks · capture phase · outside-click · row stagger · navigation casts | **Overlap 0 each**, measured by running all fourteen side by side in the same private registry. |

**None of the 130 existing rules keys on a selector control that names a region no element claims to
be. Proposing one.**

### Measurement

**Precision 30/30 violating and 4/4 compliant, and the two partition the population exactly.** The
population is the **34** tab-strip anchors outside the two primitive definitions —
`<SegmentedTabs` (21), `<PanelTabBar` (2), hand-rolled `role="tablist"` (11) — and the two patterns see
all 34 and split them **30 violating / 4 compliant** with no residue: **30 + 4 = 34**, which reconciles
independently with a strip-first pass that counted 21 + 2 + 11 by three separate greps.

The violating set is **18 `SegmentedTabs` files** (every one of them, all 21 sites; three files carry
two strips each) and **9 hand-rolled `role="tablist"` files**. Every match was opened. They fall into
three honest classes, and the rule accepts a fix in either direction for all three:

- **the panel is right there, undeclared** — `DriveKnowledgeDrawer.tsx:95`, whose panel is the very next
  element (`{tab === "ask" ? <SearchTab/> : <ExtractTab/>}`). One line.
- **the panel is in another file** — `DecisionModeTabs.tsx:51`, `ExecutionDetailTabs.tsx:77`,
  `CapabilityTagBar.tsx:29`, `passportInk.tsx:145`. The fix is in the consumer, which is the finding.
- **it should never have been a tablist** — `HealingIssuesPanel.tsx:186` (D7). **Removing the tab roles
  is a legal fix and clears the match**, which is correct: the rule's condition is a broken promise, and
  not making the promise is a valid way to stop breaking it.

The compliant four are the doctrine, not merely compliance: `CloudDeployPanel.tsx:207` and
`GitLabPanel.tsx:129` reach it through `PanelTabBar`'s withheld attribute, and `DraftEditStep.tsx:119`
and `TemplateDetailModal.tsx:203` reach it by hand — **so the compliant set contains zero
`SegmentedTabs` sites, which is the §0 headline stated as a count.**

**Two independent implementations, and they disagreed at 34 vs 33.** A standalone scanner that resolves
each `<SegmentedTabs …/>` element to read its `activeTab` attribute found **33** anchors; the census
found 34. Cause located rather than papered over: the scanner capped its attribute window at 900
characters and `UseSkillDialog.tsx:147`'s second `<SegmentedTabs>` element is longer than that, because
three of its tab labels are multi-line `<Tooltip>` subtrees. **The census's 34 is correct.** A third,
ARIA-only pass (counting `role="tablist"` occurrences per file) independently reproduces the hand-rolled
11 and the primitive-file 20.

**A fourth pass measured the wider family and is reported as a disagreement, not a number** (§12.1): a
strict implementation (a `.map` producing a `<button>` whose class compares the loop variable to the
selection) found **86 rows in 81 files**; a permissive one (any element with an `isActive`/className
comparison inside a mapped clickable) found **204 in 184**, intersecting at 70 files. Both are honest
answers to different questions, and neither is gated — see the rejected-gates table.

**Backtracking:** the only quantifier is a single `[\s\S]*` inside one lookahead, evaluated at most
twice per file (anchors are rare) and never nested. Full 4,829-file run of both rules: **3.3 s**
including node startup.

**Fault-injected six ways, all six fire** (`census FAILED`, exit 1): floor raised to 99999 →
*"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern replaced with a non-matching literal →
matched zero files, structural; baseline lowered to 2 → rise; baseline raised to 90 → silent drop; a
`baseline` added to the control → rejected before any file is walked; a stale `exclude` path →
*"the exemption is stale"*.

**Validated standalone** in a composer-private registry
(`registry-tab-strip-composer.json` — a filename unique to this composer, because sibling composers
share the scratchpad directory and have overwritten each other's files), then **re-extracted from this
finished document and re-run: `files 27 / matches 30` and `files 4 / matches 4`, identical both times.**
The full registry was not run.

**Where it runs.** `npm run census` / `npm run census:check` — inside `npm run check` and, more
importantly, in the **`golden-path-census` pre-push job** (`lefthook.yml:74-75`). Deliberately **not**
`ci.yml`: that workflow is currently red on 10 pre-existing Rust failures, and a gate that only runs in
CI runs nowhere. Note also that this condition **cannot** be an ESLint rule at warn level and mean
anything: `npm run check` passes no `--max-warnings` and the pre-commit hook passes `--quiet`, so a
warn-level rule enforces nothing at either gate by construction.

### The rule

```json
{
  "rules": [
    {
      "id": "tabstrip-with-no-declared-panel",
      "goldenPath": "docs/concepts/golden-paths/tab-strip.md",
      "title": "A tab strip declares a tablist but the region it swaps is never declared as the panel it controls",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?:<SegmentedTabs\\b|<PanelTabBar\\b|role=\"tablist\")(?![\\s\\S]*role=\"tabpanel\")",
        "flags": "g",
        "description": "A tab-strip anchor — a <SegmentedTabs> or <PanelTabBar> render site, or a hand-rolled role=\"tablist\" — in a file that never renders a role=\"tabpanel\". PROXY FOR the stack-free condition: a control declares that it selects among mutually exclusive regions and no region in the codebase declares that it is one of them, so the relationship the control advertises exists only in the visual layout. WHAT THE MATCH COSTS, EXECUTED rather than reasoned: SegmentedTabs.tsx was transcribed statement-for-statement into jsdom 29.1.1 + React 19.2.6 together with the ByomSettings.tsx:162-220 host, and every rendered [role=tab]'s aria-controls was resolved with document.getElementById — resolved 0, DANGLING 3, and role=\"tabpanel\" elements in the tree: 0. This is not cosmetic: SegmentedTabs.tsx:124 emits aria-controls UNCONDITIONALLY at a prefix derived from useId() (:41), so the panel id is not merely unwritten, it is UNOBTAINABLE unless the caller passes idPrefix — and 1 of 21 sites does (DecisionModeTabs.tsx:61), which still renders no panel. The helper that closes the loop, segmentedTabPanelProps (SegmentedTabs.tsx:176-182), has ZERO consumers. MEASURED 2026-08-17 at 64b1aa5c3: 30 matches across 27 of 4829 .ts/.tsx files, ALL THIRTY OPENED AND READ (precision 30/30). POPULATION AND PARTITION: the 34 tab-strip anchors outside the two primitive definition files — <SegmentedTabs 21, <PanelTabBar 2, hand-rolled role=\"tablist\" 11 — split 30 violating / 4 compliant, and 30 + 4 = 34 exactly, so every anchor is classified and there is no unexamined third population. THE VIOLATING 30 ARE 21 SegmentedTabs SITES (every single one; LlmOverviewPage.tsx, UseSkillDialog.tsx and StudioRails.tsx each carry two) PLUS 9 HAND-ROLLED TABLISTS, and they fall into three classes, ALL of which the rule accepts a fix for: (1) the panel is the very next element and simply undeclared — DriveKnowledgeDrawer.tsx:95, whose {tab === 'ask' ? <SearchTab/> : <ExtractTab/>} sits four lines below the tablist; (2) the panel lives in ANOTHER FILE — DecisionModeTabs.tsx:51, ExecutionDetailTabs.tsx:77 (its panel is a ternary chain at ExecutionDetail.tsx:104-127 with no role, no id and no key), CapabilityTagBar.tsx:29, passportInk.tsx:145, CapabilityTagSwitcher.tsx:67; (3) IT SHOULD NEVER HAVE BEEN A TABLIST — HealingIssuesPanel.tsx:186, where the comment on the line above reads {/* Filter Chips */}; deleting role=\"tablist\"/role=\"tab\" is a LEGAL FIX that clears the match, and that is correct, because the condition is a broken promise and declining to make the promise is a valid way to stop breaking it. THE FOUR COMPLIANT SITES ARE THE DOCTRINE, NOT MERELY COMPLIANCE, AND THEIR COMPOSITION IS ITSELF THE FINDING: CloudDeployPanel.tsx:207 and GitLabPanel.tsx:129 both pass idPrefix and render role=\"tabpanel\" with matching id and aria-labelledby (:212/:224-226 and :134/:142-144), and they reach that through PanelTabBar.tsx:86, which WITHHOLDS the attribute — aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined} — so a caller who did not declare a panel never emits a claim about one; DraftEditStep.tsx:119 and TemplateDetailModal.tsx:203 got there by hand. THE COMPLIANT SET THEREFORE CONTAINS ZERO SegmentedTabs SITES: two sibling primitives in one folder, same concept, same authors, differing on exactly that one line, score 2/2 for withholding versus 0/21 for emitting-by-default. TWO INDEPENDENT IMPLEMENTATIONS DISAGREED AT 34 vs 33 AND THE CAUSE WAS FOUND: a standalone scanner that resolves each <SegmentedTabs …/> element to read its activeTab attribute capped its window at 900 characters, and UseSkillDialog.tsx:147's second strip is longer than that because three of its labels are multi-line <Tooltip> subtrees; the census's 34 is correct, and a third ARIA-only pass reproduces the hand-rolled 11 independently. KNOWN RECALL LIMIT, STATED BECAUSE IT IS LARGE: this rule sees only strips that DECLARE themselves. A hand-rolled row of buttons with no tab roles at all is invisible to it, and the wider family of mutually-exclusive mapped selector rows measures 86 in 81 files under a strict implementation and 204 in 184 under a permissive one (intersection 70 files) — that population is NOT gated, deliberately, because most of it is filter chips and pickers which MUST NOT have tab semantics, and a rule that fired on them would be a gate that fires on correct content. SECOND RECALL LIMIT: the lookahead is directional, so a file whose role=\"tabpanel\" appears BEFORE its strip would be missed; all four compliant files render the panel after the strip, and the alternative — a whole-content negative lookahead anchored at index 0 — reports every match at line 1, which throws away the file:line a reader acts on. A bounded false negative was preferred. DOES NOT OVERLAP its fourteen nearest neighbours, MEASURED rather than assumed by running all fifteen side by side in one private registry: stateless-disclosure-control 1 of 27 (HealingIssuesPanel.tsx, which carries both defects and is this path's D7), unregistered-key-handler 1 of 27, hand-rolled-spinner 3 of 27, and ZERO for unfocusable-click-target, unresettable-error-boundary, hand-rolled-module-cache, unnamed-keyboard-priority, live-region-born-with-its-message, hand-rolled-row-stagger, page-title-outside-header-primitive, unnamed-cast-at-navigation-door, unchecked-destination-id-assertion, capture-phase-key-preemption and hand-rolled-outside-click. LEGAL FIX, one line per site: pass idPrefix to the primitive and spread segmentedTabPanelProps(idPrefix, activeTab) onto the panel wrapper — or delete the tab roles if the row is really a filter. END OF LIFE: this rule is designed to reach zero, and section 4 proposes the TYPE that would take 21 of the 30 there in a single edit — make idPrefix REQUIRED on SegmentedTabs, since its current default (useId()) is not a neutral fallback but a value that makes the correct completion impossible. Note that the type is necessary and NOT sufficient: DecisionModeTabs.tsx:61 already passes idPrefix and still renders no panel, which is why the residue is gated on the PANEL and not on the prop. When the count reaches 0 the runner fails structurally on zero matches, BY DESIGN: DELETE the rule then, do not baseline it at 0. PRECONDITION (must be re-derived per repo, do NOT port): this repo declares tab semantics with role=\"tablist\"/role=\"tabpanel\" in JSX. The convergence sweep found the same defect in three of the five sibling strips that attempted aria-controls at all — personas-web app/dashboard/knowledge/page.tsx:115 (2 of 3 references dead), personas-web VariantTabs.tsx:58 (1 of 2 dead, target in a different file), vibeman ArchitectureBottomBar.tsx:106 (3 of 4 dead when open and ALL FOUR dead in the bar's default collapsed state) — always for the same reason, a conditionally rendered panel; the only strip in six repos where the reference cannot dangle is personas-web guide/blocks/TabBlock.tsx:81, which renders every panel and hides the inactive ones. An adopting repo on a different stack (a Next.js App Router repo wearing this leaf as a route segment, or a native toolkit with no ARIA at all) must re-key on its own idiom.",
        "$measured": "2026-08-17 @ 64b1aa5c3 — 4829 .ts/.tsx walked, floor 4000, both rules run in 3.3s; three independent implementations of the tab-strip population (a strip-first attribute resolver, a panel-first arm counter, and an ARIA-only role counter) reconcile at 34 anchors after one 900-character window bug was found and fixed; all 30 matches and all 4 control matches hand-read; SegmentedTabs and two real hosts transcribed statement-for-statement and replayed in jsdom 29.1.1 + React 19.2.6 (3 of 3 aria-controls dangling and 0 tabpanels; one tab switch destroyed a half-typed draft and re-issued its fetch while scrollTop=640 survived; ArrowRight moved the primitive and did nothing on the hand-roll, whose roving tabIndex left 2 of 3 tabs keyboard-unreachable; the same component type at both arms of a ternary carried state across the switch in 1 mount). No database was copied, the live app was never touched, and cargo was not run."
      },
      "exclude": [
        { "path": "src/features/shared/components/layout/SegmentedTabs.tsx", "reason": "the primitive itself — it renders the tablist and cannot render its consumer's panel" },
        { "path": "src/features/shared/components/layout/PanelTabBar.tsx", "reason": "the primitive itself — same reason" }
      ],
      "baseline": { "files": 27, "matches": 30 },
      "floor": 4000
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "tabstrip-with-no-declared-panel-positive-control",
  "goldenPath": "docs/concepts/golden-paths/tab-strip.md",
  "title": "POSITIVE CONTROL — the same tab-strip anchors, in a file that DOES declare the panel",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:<SegmentedTabs\\b|<PanelTabBar\\b|role=\"tablist\")(?=[\\s\\S]*role=\"tabpanel\")",
    "flags": "g",
    "$measured": "2026-08-17 @ 64b1aa5c3 — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 4 files / 4 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL tab-strip anchors over the IDENTICAL roots and extensions as tabstrip-with-no-declared-panel, differing in exactly one character: the lookahead is positive rather than negative. The two are mutually exclusive BY CONSTRUCTION rather than empirically — a given anchor either is or is not followed by a role=\"tabpanel\" — and together they see all 34 tab-strip anchors outside the two primitive definitions, partitioning them 30 + 4 = 34 with no residue, so the counts must move in OPPOSITE directions as the codebase improves. MEASURED 2026-08-17 at 64b1aa5c3: 4 matches across 4 files versus the gate's 30 across 27. WHAT THE FOUR DEMONSTRATE IS THE WHOLE ARGUMENT OF THE GOLDEN PATH. Two of them — CloudDeployPanel.tsx:207 and GitLabPanel.tsx:129 — are the ONLY two consumers of PanelTabBar, and BOTH pass idPrefix and render a real role=\"tabpanel\" with a matching id and aria-labelledby (:212 and :224-226; :134 and :142-144). PanelTabBar.tsx:86 WITHHOLDS aria-controls unless idPrefix is supplied, so a caller who has not declared a panel never emits a claim about one. SegmentedTabs.tsx:124 emits it unconditionally at a useId()-derived prefix the caller cannot obtain, and scores 0 of 21. Same folder, same concept, same authors, one line apart: withholding 2/2, defaulting 0/21. THE HONEST DEFLATION, RECORDED SO THE NUMBER IS NOT OVERSOLD: CloudDeployPanel and GitLabPanel are visibly the same lineage — identical `disabledWhenOffline` field name, byte-identical `TABS.map((tab) => ({ ...tab, disabled: tab.disabledWhenOffline && !isConnected }))` line, identical idPrefix + tabpanel structure — so per the doctrine's port rule they are ONE authoring wearing two coats, and the withholding evidence is n=1 independent on the compliant side. It is the VIOLATING side that carries the weight: 21 independent call sites, zero successes, and a helper (segmentedTabPanelProps, SegmentedTabs.tsx:176-182) with zero consumers after being exported the entire time. The other two compliant matches are hand-rolled — DraftEditStep.tsx:119 and TemplateDetailModal.tsx:203 — and TemplateDetailModal is the single most complete tab strip in 4829 files (tablist :203, tab + aria-selected + aria-controls + roving tabIndex :215-219, Arrow/Home/End :86-108, and role=\"tabpanel\" id={`tabpanel-${effectiveTab}`} aria-labelledby={`tab-${effectiveTab}`} at :241-243 whose ids MATCH), which is precisely the markup SegmentedTabs + idPrefix + segmentedTabPanelProps would emit for free. A CONTROL THAT MERELY COUNTED role=\"tabpanel\" WOULD ALSO PASS FOR A PANEL WHOSE id DOES NOT MATCH ITS TAB'S aria-controls; all four were opened and all four match, but that is hand-verified and not enforced by the pattern — if that ever changes, the pattern will not notice. If this control's count ever collapses toward the gate's, the shared anchor has broken and BOTH numbers are meaningless — that is the failure this control exists to make visible. If the section-4 type change lands and 21 SegmentedTabs sites gain panels, this control rises sharply while the gate falls by the same amount; that is the correct signal and must not be read as drift. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine rejects a `-positive-control` id that carries one (verified by injection) and the registry merge skips it by construction."
  },
  "exclude": [
    { "path": "src/features/shared/components/layout/SegmentedTabs.tsx", "reason": "the primitive itself" },
    { "path": "src/features/shared/components/layout/PanelTabBar.tsx", "reason": "the primitive itself" }
  ],
  "floor": 4000
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **a hand-rolled mutually-exclusive selector row that does not use a primitive** — the adoption gate, and the obvious rule for recurrence 36 | 86 (strict impl) / 204 (permissive impl) | 23 | **A gate that fires on correct content is worse than no gate.** Hand-verification of the permissive set found filter chip rows, model pickers, icon selectors, density toggles and sort dropdowns — all of which are *correctly* not tab strips. The two implementations differ by 2.4× (81 vs 184 files, intersecting at 70), which is itself disqualifying: **I cannot state the denominator to better than a factor of two, so I cannot state a precision.** The distinction that matters — does the selection *replace* the region or *narrow* it — is semantic and invisible to any matcher. **Refused; carried as §0's population table and P10.** |
| **an unkeyed multi-arm panel switch** — the mechanism behind D2, D4, D5 and D6 | 82 | 16 | **Precision is poor and the condition is not always a defect.** Many of the 98 are two-arm status switches (`status === 'loading' ? … : …`) and icon dispatchers where a key would be meaningless or harmful. Worse, the *correct* answer is sometimes "unkeyed" — a panel holding an unsent draft must NOT be keyed (P5), so the rule would demand the wrong fix at exactly the sites that matter most. **Refused; carried as §6.3, D5 and D6, and handed for the crash half to `unresettable-error-boundary`.** |
| **roving `tabIndex` with no arrow-key handler** — D3, the sharpest single a11y defect here | 1 | 4 | **One match is not a ratchet.** A single-match rule cannot distinguish "fixed" from "matcher broken", and the runner fails structurally the moment it is fixed. **Carried as D3 with the executed evidence** (2 of 3 tabs unreachable), which is more actionable than a count of one. |
| **a `<SegmentedTabs>` without `idPrefix`** — the *prop* form of the same condition | 20 | 1 | **Rejected in favour of the panel form, and the reason is a finding.** `DecisionModeTabs.tsx:61` passes `idPrefix` and renders no panel — so the prop rule would clear a site that is still broken, and would miss the 9 hand-rolled tablists entirely. **Gate the thing you actually need to exist, not the argument that enables it.** This is the contract's fifth failure mode avoided by construction. |
| **a tab panel that fetches on mount with no cache** — D2, the cost finding | — | — | **Cross-file and cross-module by nature**: the host renders `<PanelX/>` and the fetch is in `PanelX`'s own `useEffect` in another file. Nothing static composes that. The right instrument already exists one leaf over — `hand-rolled-module-cache` (48/71, `shared-fetch-cache`) — and the useful addition is a **test**, not a matcher: mount a host, switch away and back, assert the fetch count. That harness now exists in this composer's scratch replay and should be adopted as a Vitest case. |
| **an A/B design switcher older than N days** — D10 | 3 sites | — | **Not a code condition — a calendar condition**, and the census ratchets counts, not ages. `git log --follow` is the instrument (both files: 2026-04-25). **Carried as D10 with the dates.** |

### What the census fundamentally cannot gate here, and what to build instead

- **"the fade and the reset were separated deliberately"** (§6.3, P2) — an intent, not a token. The
  structural fix is a `<TabPanel>` primitive that takes `resetOnChange: boolean` explicitly, so the two
  concerns stop sharing one attribute. Until that exists, the only instrument is the sentence this path
  asks you to write above the `key`.
- **"switching away and back preserves what the user is entitled to keep"** (P5, D2, D4) — **a test, and
  this composer built one.** The jsdom harness that produced §0's E2 mounts a real host, types into a
  panel, scrolls the container, switches away and back, and asserts on mounts / fetches / field value /
  `scrollTop`. That is the right shape and it belongs in `__tests__` beside the strip, not in a matcher.
- **"this row is a filter, not a tablist"** (P10, D7) — a semantic judgement. The census can find the
  *symptom* (D7 is one of the 30) but cannot tell which direction the fix goes, which is why the rule's
  description names both legal fixes.

---

## 12. Corrections to the brief

The brief was right about the shape and about four of its five primed leads. Recorded per the doctrine,
since the corrections are the deliverable.

1. **"Measure adoption against hand-rolls"** — done, and **the answer depends entirely on a denominator
   the brief did not specify, by a factor of six.** Among constructs that declare themselves tab strips,
   adoption is **23 of 34 = 68%** — a good number. Against the wider family of mutually-exclusive
   selector rows it is **23 of 204 = 11%** — a bad one. Both are true. And my own two implementations of
   that wider family disagreed **86 vs 204** (81 vs 184 files, intersecting at 70), which is the
   doctrine's *"two implementations are not soundness"* arriving as a 2.4× spread rather than a
   discrepancy. **The disagreement is why §9 declines the adoption gate**: I cannot state that
   denominator to better than a factor of two, so I cannot state a precision for a rule over it. A third
   disagreement, 34 vs 33 on the *narrow* population, was traced to a 900-character attribute window in
   my own scanner (`UseSkillDialog.tsx:147`) and resolved in the census's favour.

2. **"`PersonasPage.tsx:403-406` … Ask what else shares state across a tab switch that shouldn't:
   scroll position, form drafts, in-flight fetches, `isLoading`."** — **All four asked and answered by
   replay, and one of the four is the opposite of what the brief expected.** Form drafts: **destroyed**,
   not shared. In-flight fetches: **re-issued**, not shared (`fetches {policy: 2}`). `isLoading`:
   **re-ghosted**, not shared. **Scroll position: shared — the only one of the four that actually
   survives**, because it belongs to the container and the container never unmounts (`scrollTop=640`
   after a round trip that emptied the panel). The brief's framing — "what shares state that shouldn't" —
   is right for exactly one item and inverted for three: the dominant defect is that a tab switch
   destroys *too much*, silently, and the one thing it preserves is the one thing it shouldn't. That
   asymmetry is P6 and D4, and neither existed before the replay.

3. **"Two catalogued primitives exist (`layout/SegmentedTabs`, `layout/PanelTabBar`)."** — **Confirmed,
   and the interesting fact is that they disagree with each other.** The brief framed them as a pair to
   measure adoption against; they are better read as a **controlled experiment on the withhold-vs-permit
   axis** conducted inside one folder, which is the corpus's Q5 with a 2/2-versus-0/21 result (§6.1,
   §0). I record two deflations against my own headline: the `PanelTabBar` side is **n=1 independent**,
   because `GitLabPanel.tsx` and `CloudDeployPanel.tsx` are visibly one authoring (identical
   `disabledWhenOffline` field, byte-identical `TABS.map` line) — the doctrine's port rule applied
   *within* a repo; and the type it implies (`idPrefix` required) is **necessary but not sufficient**,
   proven by `DecisionModeTabs.tsx:61`, which passes `idPrefix` and still has no panel.

4. **"The corpus has found four A/B switchers lingering for weeks … Check whether any remain."** —
   **Yes, and the count is three render sites across two components, not four.**
   `PrototypeTabs.tsx` (2 sites) and `TwinVariantTabs.tsx` (1 site), both self-labelled *"throwaway
   scaffolding"*, both born **2026-04-25** (`git log --follow`: `c3cbe48ab`, `8cf3f3d5a`) — **114 days,
   not weeks.** `TwinVariantTabs` has meanwhile grown a `localStorage` persistence layer (`:37,:45`), so
   it now remembers the user's pick across restarts, which is a *feature* and the clearest sign the
   experiment has become permanent. Two other files that looked like candidates by name are not:
   `ModeTabBar.tsx` is a product run-mode selector and `StudioTabBar.tsx` is a browser-style project tab
   strip.

5. **"Which tab is selected is state: measure where it lives (URL, store, `useState`), whether it
   survives remount, and whether a deep link can select one."** — **Measured, and the URL option does
   not exist in this app at all.** There is no router in `package.json` (no `react-router`,
   `@tanstack/router` or `wouter`), so the store *is* the address space. **32 of 34 strips hold the
   selection in `useState` or a prop and are unreachable from anywhere else in the app; 2 read a store.**
   Separately, the **page-level** selections do live in a store — 18 `*Tab` fields, **10** of them in
   `systemStore.ts`'s `partialize` and therefore restored after a relaunch — and **63 non-store call
   sites deep-link into a tab through them**. So the honest answer is split by altitude: **deep-linking
   is a solved and heavily used problem for sections, and structurally impossible for sub-tabs.** The
   sibling sweep makes this a genuine divergence rather than a gap — `brainiac` is 3/3 URL-first
   (reading `useSearchParams()` inside the `useState` initializer, with a `popstate` listener), `ascent`
   2/3, `vibeman` **8/8 local with nothing surviving a remount** — four repos, four different answers,
   no shared instinct.

6. **The spine's `sides: "client"` and `risk: "low"` labels survive; `convergence: "mixed"` is right and
   was right for a reason the label could not carry.** Three separate leaves have reported
   `sides: "client"` contradicted by their own measurement; this one is not among them — there is no
   Rust half, the tab state never crosses IPC, and `cargo` was correctly never run. `risk: low` also
   holds in the sense the spine means it: nothing here loses data irrecoverably or spends money. But
   **"mixed" turns out to be exactly right in an unusually strong way**: within one leaf, one clause
   (**P2, the panel key**) is unanimous physics at **4 of 4 independent repos with zero
   counterexamples** — the first `convergence` claim in this batch that a sweep *confirmed* rather than
   inverted — while another (**P1, a shared tab primitive**) is a **total silence at 0 of 4**, with two
   siblings having independently produced the *unused-ARIA-helper* half of our own defect
   (`vibeman/src/lib/accessibility/aria.tsx:329-337`, 0 consumers). Physics and house convention in the
   same document, and the oracle separated them.

7. **"Keyboard: … remember a focused xterm beats every bubble-phase listener, so a terminal inside a tab
   is a special case."** — **Confirmed as a real but currently inert hazard, and recorded as D11 rather
   than as a defect.** `FleetTerminalOverlay.tsx:205` is the one tab strip above live terminals. Its
   keyboard handling is element-scoped (`SegmentedTabs`'s `onKeyDown` prop), so xterm's
   `cancel(e, true)` never reaches it and nothing is broken today. The brief's warning binds the
   *future*: any attempt to drive this strip from a global binding is dead on arrival. **The a11y
   population the brief asked for turned up a different and live problem** — not a terminal conflict but
   `DraftEditStep.tsx:129`, roving `tabIndex` with no arrow handler, which the replay showed makes 2 of
   3 tabs keyboard-unreachable, and which **zero of four sibling repos have**.
