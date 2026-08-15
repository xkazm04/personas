# Golden path — Navigation destination

> Situation node: `ui-system/layout-and-navigation/navigation-destination` · [situation spine](../situation-spine.md)
> `sides: client` (with one Rust allow-list) · `risk: high` · recurrence **63**.
> Dimensions: **function · ui · code-quality · resilience**.
>
> Composed 2026-08-15 against `master` from a ground-truth sweep of the **4,829**
> `.ts`/`.tsx` files under `src/` ([`shared-facts.json`](../shared-facts.json), independently
> re-walked at 4,829 by this composition's own walker) and the **564** `.rs` files under
> `src-tauri/src/`. Everything below was **measured by execution**, not by reading:
> a TypeScript-compiler AST pass over every array / object / switch literal in the repo;
> a **143-revision walk of `git log` on `src/lib/types/types.ts`** to recover every
> destination id that has ever been deleted; a **Vitest run against the real
> `registry.ts` / `sectionRouter.tsx` / `history.ts` modules** feeding them the ids that
> walk produced; and ten fault-injection runs of the census runner. Read in full: the nav
> registry and its test, the back/forward engine, the content router, `PersonasPage`,
> `sidebarData.ts`, both sidebar level components, the command palette + its utils, the
> analytics nav catalog, the breadcrumb hook, the credential nav context, the test-automation
> bridge, the companion route allow-lists on both sides of the IPC boundary, the store
> `partialize` + rehydrate block, and `main.tsx`'s boot read.
> Convergence checked read-only against `../personas-web` (Next.js 16 App Router, 37 pages)
> and `../brainiac/console` (Next.js, 14 modules on one `?m=` route).
>
> **Sibling leaves — settle the boundary before reading the prescription.**
> [`page-scaffold.md`](./page-scaffold.md) owns *what a destination looks like once you are
> there* — the box, the band, the scroll region. **This path owns the name of the place and
> every path that leads to it.** The two meet at exactly one sentence, and it is
> `page-scaffold.md`'s §2: *"the sidebar rail **is** the tab strip."* That is confirmed here
> (§6) and it is the load-bearing fact of this document — because the rail is the tab strip,
> the rail's `onSelect` signature **is** the app's navigation API, and it is typed `string`
> (§4).
> [`tier-and-capability-gating.md`](./tier-and-capability-gating.md) owns *whether a
> destination is offered*. This path owns *whether it exists, resolves, and survives*. Its
> six-catalog finding is confirmed and extended below — six was the count of catalogs for
> the eleven **top-level** sections, and the honest number is twenty.
> [`client-state-persistence.md`](./client-state-persistence.md) owns *how* a value reaches
> `localStorage`. This path owns the one question it does not ask: **is the value that came
> back still a name of a real place?**
> [`lazy-route-chunk.md`](./lazy-route-chunk.md) owns which module is a chunk.
>
> The **Deviations** section is a fix backlog; it migrates to `violating` cells when this
> path is ingested.

> ### ⚠ Three corrections to the brief that commissioned this path
>
> 1. **"Is there one list of destinations, or six?" — Neither, and the framing undercounts
>    the problem by two orders of magnitude.** Six was the count of catalogs for the eleven
>    *top-level sections*. Measured here: **20 catalogs of those eleven ids** (5 derived from
>    the registry, 3 compile-checked against the union, **12 hand-written with no link**, one
>    of them in Rust). And the eleven sections are **11 of 156 destinations** the app actually
>    has, spread over **24 vocabularies**. The registry that everyone points at governs
>    **7.1%** of the destination space. The other 145 destinations have no registry, no
>    completeness test, no gate evaluator, no back/forward entry, and no restoration
>    validation.
> 2. **"`brainiac/console` deleted its store problem by putting state in the URL" —
>    INVERTED by the oracle, and this is the most valuable result in the sweep.** Putting the
>    module id in `?m=` bought brainiac three real properties Personas lacks (shareable link,
>    reload survival, a working Back button). It bought **nothing** in destination-vocabulary
>    integrity: brainiac's URL-driven console has **more** vocabulary defects than its pure
>    `useState` `/demo` tab switcher, which has zero. The variable that predicts drift, in all
>    three repos, is **the type link** — `Record<ModuleId, X>` drifts 0/42 while
>    `Record<string, X>` drifts 5/14 in the same file tree. Personas reproduces the identical
>    experiment (§Convergence). **Do not adopt URL state expecting it to fix the vocabulary.**
> 3. **"Can the palette reach destinations the sidebar hides, or vice versa?" — Yes, by two,
>    and it is deliberate and correct.** `reachablePaletteSections` (`commandPaletteUtils.ts:23`)
>    filters only `reachability !== 'hidden'`, so the palette offers **`design-reviews`**
>    (nested under Connections) and **`schedules`** (an overlay), neither of which is in the
>    rail. Both surfaces derive from `NAV_SECTIONS` and share `passesGates`, so they *cannot*
>    disagree about tier. The `DEV_MODE_SECTIONS` / `isBuilder` contradiction the earlier
>    composer found is **still live and unchanged** (`platform.ts:104`, `NavigationGrid.tsx:93-95`)
>    — but it is the Home *card grid*, not the palette. The real reach finding is different and
>    worse: **the palette can address 24 of 156 destinations (15%)**, and 132 destinations can
>    be reached by exactly one gesture in the entire application — clicking their own sidebar row.

---

## 1. Trigger

- "I'm adding a tab / section / plugin sub-page — where does its id go?"
- "How do I send the user to Overview → Executions from over here?"
- "Athena / the tour / a notification needs to deep-link into this screen."
- "We renamed this tab. Do I need a migration?" / "Why is this page blank after the update?"
- "Can the command palette jump here?" / "Why doesn't Back go back?"
- "Where do I add this to the breadcrumb?"

If you are about to type `setSidebarSection(`, `set<Anything>Tab(`, `id as <Anything>Tab`,
a new member in a `…Tab` union in `types.ts`, a new `SubNavItem` in `sidebarData.ts`, a
`pending<Something>` store field, a `setTimeout` before a tab setter, or a fresh
`const VALID_… = ['home', 'overview', …]` — **you are in this situation.**

### Scope — what is a "destination"

| Thing | In scope | Why |
|---|---|---|
| An L1 section (`SidebarSection`, 11) | **yes** | the registry's subject |
| An L2 tab (`OverviewTab`, `SettingsTab`, `PluginTab`, … 22 more vocabularies, 145 ids) | **yes — and this is the neglected half** | a named place `setXTab` can take you |
| A header overlay (`HeaderOverlay`, 6) | **yes** | mutually-exclusive full-screen surfaces; `schedules` is in *both* this and `SidebarSection` |
| A selected row / entity id (persona id, execution id) | only where it joins the section — `NavDestination.personaId` | it is data, not a place |
| A filter, sort, or lens *within* one tab | no | not a destination; see [`filtering-and-search.md`](./filtering-and-search.md) |
| A modal / drawer | no — [`modals.md`](./modals.md) | an overlay over a destination, not one |

---

## 2. The one way

**A destination is a value, not a sequence of writes — so give it a name in exactly one
place, make that name a type, and reach it through one total resolver that cannot fail.**
Declare the id in its union in `src/lib/types/types.ts`, then declare the *destination*
— its label, icon, gates, reachability, and the surface that mounts it — in one record
keyed by that union (`NAV_SECTIONS`, `registry.ts:74-95`, is the shape to copy), and derive
every consumer from that record rather than re-listing the ids: the rail, the router, the
palette, the footer nav and the analytics catalog all already do this for L1 and it has
produced **zero drift in five consumers**. Never write a second array of ids; if you find
yourself typing `['home', 'overview', …]` you are creating catalog number twenty-one, and
the two that already contradict each other did it the same way. **Never let a destination id
cross a boundary as a bare `string` and then cast it back** — `id as HomeTab` is the exact
line that shipped two blank pages in this repo (§6), so type the nav item's `id` to its
vocabulary and let `tsc` reject the typo. **Any id arriving from outside the compiler's
reach — `localStorage`, an IPC payload, a URL, a test harness — must pass through a total
resolver that returns a valid destination or the default, never an assertion**; `parseModule`
in brainiac is that function, `sectionsForRoute` (`routeSections.ts:96-104`) is Personas'
only correct example, and `navSection()` is what happens without one: it returns `undefined`
against its own docstring and the caller throws (§7 A, proven by execution). When a
destination is removed, the same commit adds its rehydrate migration — 51 ids have been
deleted from these unions and **16 that lived in a persisted key got neither a migration
nor a guard.** Navigate atomically: one call that sets the section *and* its tab in a single
store write, never a section write followed by a timer, a dynamic import, or a `pending*`
field the destination is expected to notice on mount — there are **seven** such mechanisms
today and each one is a race. And then stop: no second allow-list, no `Record<string, …>`
keyed by a destination id, no local `useState` for a place the user can be, and no id that
`setSidebarSection` accepts but no router mounts.

### The one genuine fork — is this a place or a lens?

- **A place** is somewhere Back should return you to, a link should reach, and the palette
  should offer. It gets a union member, a registry-style record entry, and a store key.
- **A lens** (a filter, a sort, a chart mode, a split-pane selection) changes what one place
  shows. It gets component state and belongs to [`filtering-and-search.md`](./filtering-and-search.md).

**The test is not "does it have tabs".** It is: *if the user pressed Back, would they expect
to be here again?* Today Personas answers "yes" for 11 destinations and implements it for
11; the other 145 are places by that test and lenses by their implementation (§7 D).

---

## 3. Mandated primitives

**The declaration**

- **`src/lib/types/types.ts:409-435` — the 20 destination unions.** `SidebarSection` (11) and
  19 `…Tab` unions. Four more live outside it: `CredentialNavKey`
  (`CredentialNavContext.tsx:5`, 6), `HeaderOverlay` (`uiSlice.ts:79-86`, 6), `FactoryL2Tab`
  (`uiSlice.ts:19`, 4), `CompanionPluginTab` (`companionPluginSlice.ts`, 4). **24 vocabularies,
  156 destinations.**
- **`src/lib/navigation/registry.ts:74-95` — `NAV_SECTIONS`.** The one full destination
  *record*: `id`, `label`, `labelKey`, `icon`, `gates`, `reachability`, `parent`. 11 entries.
  **Copy this shape for any new destination axis.**
- **`registry.ts:105-108` — the exhaustiveness assertion.** `[Exclude<SidebarSection,
  RegisteredSection>] extends [never]` collapses to `never` and fails `tsc` if a union member
  has no entry. **This is the whole reason L1 has not drifted.** No L2 vocabulary has one.
- **`registry.ts:43` — `NavReachability`** (`sidebar` | `nested` | `overlay-only` | `hidden`).
  The field that records *how* you get there. It is data, not type — see §8 gap 1.
- **`sectionRouter.tsx:59-70` — `SECTION_ROUTES`,** `as const satisfies Record<RoutableSection,
  SectionRoute>`. The router half, compile-checked in both directions.
  **`sectionRouter.tsx:45` — `RoutableSection = Exclude<SidebarSection, 'schedules'>`** already
  exists and is the type §8 gap 1 asks `setSidebarSection` to take.

**The resolution**

- **`registry.ts:117-119` — `navSection(id)`.** The lookup. **Partial in practice** — see §7 A
  before using it on any value that did not come from a literal.
- **`registry.ts:154-158` — `passesGates(gates, ctx)`.** The one gate evaluator. 5 consumers.
- **`i18n/routeSections.ts:96-104` — `sectionsForRoute(section)`.** **The one total resolver in
  the app.** It is a `Record<SidebarSection, …>` lookup that *expects to miss*, warns in dev,
  and degrades to a safe default. Its comment is the sentence this whole path is about:
  *"The Record is exhaustive at compile time, but a stale/renamed persisted `sidebarSection`
  value can miss the map at runtime."* **Copy this, not `navSection`.**

**The navigation**

- **`uiSlice.ts:473-493` — `setSidebarSection`.** The only navigation that records history,
  clears the header overlay, and de-dupes. 156 call expressions.
- **`src/lib/navigation/history.ts` — the back/forward engine.** Pure, unit-tested, 50-deep
  two-stack model over `NavDestination = { section, personaId }` with gate-skipping
  (`:102-112`). **Excellent, and it models 11 of 156 destinations.**
- **`commandPaletteUtils.ts:23-25` — `reachablePaletteSections(ctx)`.** Registry-derived,
  gate-filtered, pure, unit-testable. **The best consumer in the repo.**
- **`sidebarData.ts:44-50` — `sections`,** derived from `SIDEBAR_SECTIONS`. What every
  hand-written catalog should look like.
- **`useSettingsSearchEntries.tsx:118-131` + `settingEntry()`** — the **only** mechanism by
  which an L2 destination reaches the command palette. It maps `getSettingsItems()` to palette
  rows. **One domain implements it; 22 vocabularies do not.**

**Deliberately not a primitive, and that is a defect:** there is no `resolveDestination()`, no
`isSidebarSection()` type predicate, no `Destination` type pairing a section with its tab, and
no `navigateTo(destination)`. Their absence is why navigation is 48-59 multi-write sequences
(§7 D) instead of 59 calls.

---

## 4. Steps

1. **Decide it is a place, not a lens** (§2 fork). If Back should return here, it is a place.
2. **Add the id to its union in `types.ts`.** One union per axis. If you are inventing a new
   axis, put the union in `types.ts` — not in a context file, not in a store slice; four
   vocabularies live outside it today and none of them is tracked by anything.
3. **Add the destination record.** For L1 that is a `NAV_SECTIONS` entry (`registry.ts:74`) —
   the exhaustiveness assert will fail `tsc` until you do. For L2 there is no record type yet:
   add the `SubNavItem` to the owning `sidebarData.ts` array **and type the array to the
   vocabulary** (`Array<{ id: OverviewTab; … }>`, as `overviewItems` (`:71`) and `homeItems`
   (`:63`) already do — 2 of 13 arrays).
4. **Wire the router branch in the same commit.** For L1, `SECTION_ROUTES`; `satisfies` will
   fail without it. For L2, the tab dispatcher. **A vocabulary member with no branch renders a
   blank page** — that is the `voice` incident (`sidebarData.ts:161-165`) and the `projects`
   incident (`uiSlice.ts:414-416`), both written up in this repo's own comments.
5. **Derive, never re-list.** Every consumer that needs "the set of destinations" imports the
   record and filters it. If your consumer needs a *subset*, express the subset as a predicate
   over a field on the record (`reachability`, `gates`, `devOnly`) — not as a second array.
6. **If the id is persisted, write the resolver and the migration now.** Check
   `systemStore.ts:58-132`: is your store key in `partialize`? If yes, `onRehydrateStorage`
   (`:133-192`) must map every id you ever remove, **and** the destination should resolve
   unknown values rather than trust them. `TwinPage.tsx:66-72` is the recovery pattern;
   `sectionsForRoute` is the resolver pattern. Prefer the resolver — a recovery effect runs
   after a render that may already have thrown.
7. **Deep-link atomically.** A "go to section S, tab T" helper sets both keys in **one** store
   write. Do not `setSidebarSection` then `setTimeout(…, 120)` then `setXTab`
   (`launchPowerMove.ts:26-38`), and do not `setSidebarSection` then
   `void import('@/stores/overviewStore').then(…)` (`CommandPalette.tsx:206-209`,
   `TriggersPage.tsx:63-66`). Both are races the destination cannot see.
8. **Register the destination with the surfaces that enumerate places**: the analytics catalog
   (`navCatalog.ts:104-119` — 9 vocabularies are missing), the breadcrumb (`useBreadcrumbTrail.ts:95`
   — 3 sections are missing), the harness bridge (`bridge.ts:23,137-139,247`), and the
   palette if it is worth jumping to.
9. **And then stop.** No new `const VALID_… = [...]`. No `Record<string, …>` keyed by a
   destination id. No `as <Vocab>`. No `useState` for a place.
10. **Verify:** delete your new id from the union, run `npx tsc --noEmit`, and count the
    errors. **The number of errors is the number of places your destination is type-linked.**
    For a new L1 section today that number is ≥6. For a new Overview tab it is 2. **If it is
    0, you have added a name nothing checks.**

### Can the primitive's signature make the wrong call impossible? — answered before §9

The contract asks this above the gate. **Here the answer is yes four times, three of them are
one-line changes, and the convergence oracle settles all four** — three independent repos ran
the same controlled experiment and got the same answer (§Convergence).

- **`SubNavItem.id` should be the vocabulary, not `string`. YES — this is the big one and it
  is the upstream cause of half this document.** `SidebarSubNav.ts:12` declares `id: string`,
  with a docstring calling it *"the vocabulary `sidebarData.ts` and every nav consumer speak."*
  The vocabulary is `string`. Because the id is untyped, **every one of the 18 sites that set
  an L2 tab does it through an `as` cast** (§7 C) — and per [`page-scaffold.md`](./page-scaffold.md)
  §2, those 18 sites **are** the app's entire L2 navigation surface. Making it generic —
  `interface SubNavItem<T extends string = string> { id: T; … }`, then
  `twinItems: SubNavItem<TwinTab>[]` — turns the `voice` incident into a compile error and
  deletes the cast at the call site. `homeItems` and `overviewItems` already do this inline, so
  the pattern is in the file; 11 arrays have not adopted it.
- **`setSidebarSection` should take `RoutableSection`, not `SidebarSection`. YES, and the type
  already exists.** `sectionRouter.tsx:45` declares `RoutableSection = Exclude<SidebarSection,
  'schedules'>` and `registry.test.ts:57-59` asserts `isRoutableSection('schedules') === false`.
  Yet `setSidebarSection` accepts `SidebarSection`, so `setSidebarSection('schedules')`
  type-checks, falls through `PersonasPage.tsx:362`, and renders the **Agents** page. **Three
  shipped features do exactly this** (§7 B). Narrowing the setter's parameter makes all three
  compile errors and costs one word.
- **Every `Record` keyed by a destination id should be keyed by the union. YES — and this is
  the clause with the strongest external evidence in the batch.** `SIDEBAR_ICONS`
  (`SidebarIcons.tsx:346`) is `Record<string, …>` and carries **three keys no navigation can
  ever produce** (`goals`, `team`, `cloud`); `PLUGIN_ICONS` (`PluginIcons.tsx:117`) is
  `Partial<Record<PluginTab, …>>` and carries **zero**. Same repo, same purpose, same authors,
  one type parameter apart. `brainiac` ran the identical experiment: `Record<ConsoleModuleId, X>`
  drifted **0 of 42** entries, `Record<string, X>` drifted **5 of 14** — and the drifted one is
  dead code its own test claims to cover. `NAV_PREFETCHERS` (`prefetch.ts:30`) is the third
  Personas instance, `Record<string, Prefetcher>` with 7 of 11 sections.
- **An id read from `localStorage`/IPC should be resolved, not asserted. YES, and it is a
  15-line function.** `main.tsx:167` returns `section as SidebarSection` after a `typeof ===
  "string"` check; the zustand `persist` rehydrate does not check at all. A
  `resolveSection(raw: unknown): SidebarSection` that tests membership against `NAV_SECTIONS`
  and falls back to `'home'` — brainiac's `parseModule` (`routes.ts:125-128`), reinvented
  independently with a *total* signature and zero assertions — removes the entire class. The
  same shape generalises: `resolveTab(raw, vocabulary, fallback)`.

**And one that cannot be typed away, recorded as a real limitation.** *"Every destination the
user can be at is in the back stack"* is not expressible in a type. `NavDestination`
(`history.ts:46-49`) is `{ section, personaId }`; widening it to carry all 24 tab keys would
make every history entry a 24-field record whose equality semantics nobody wants. The
tractable version — one `activeDestination` selector composing section + the owning tab, pushed
by a single `navigateTo` — is a refactor, not a type change. **This is the one the census has
to carry, and it cannot: see §9 item 3, refused with measurement.**

---

## 5. Anti-patterns

- **`id as <SomeTab>` at a nav call site.** 54 sites, 19 files (§9). It is the compiler being
  told to stop checking exactly where the value stops being trustworthy. Both blank-page
  incidents in this repo's history were caused by it, and both are documented *in the code
  that still contains it* (`sidebarData.ts:161-165`, `uiSlice.ts:414-416`).
- **A second allow-list of section ids.** `companionRoutes.ts:1-15`'s docstring says it is the
  *"Single source of truth for the two independent consumers that used to carry their own copy
  of this list."* `applyClientAction.ts:21-31` — the module that consolidation was performed
  for — **carries its own copy anyway**, nine identical strings. Consolidation happened, was
  written down, and re-drifted inside the same feature folder.
- **Re-implementing the resolver instead of calling it.** The convergent failure across all
  three repos. `useBreadcrumbTrail.ts:95-197` re-derives section handling in a hand-written
  `switch` and silently loses `teams`, `studio` and `schedules`; `athenaChatNavigation.ts:64-75`
  handles two pseudo-routes that `applyClientAction.ts` does not. In `personas-web` the same
  shape drops the `mode` gate on 4 of 5 guide surfaces and puts a 404 in the sitemap.
- **`setSidebarSection` to an `overlay-only` section.** It type-checks, it is not routable, and
  the content area renders the Agents page. Three features ship it (§7 B).
- **Navigating in two writes separated by time.** `setSidebarSection(s)` then a `setTimeout`,
  a `.then()`, or a `pending*` field. 6 measured deferred composites and 7 distinct deferral
  mechanisms (§7 D). Every one has to hand-roll "did the user navigate away in the gap?" —
  `launchPowerMove.ts:33` does; the others do not.
- **Putting a place in `useState`.** `FleetPage.tsx:37` (3 page-equivalent tabs),
  `FactoryShell` (whose own comment at `uiSlice.ts:155-159` admits *"FactoryShell owns its nav
  state locally, so this is the only way to land it on a specific project from outside"* — the
  `pendingFactoryFocus` field is a workaround for a design decision, not a feature).
- **Deleting a destination id without a migration.** 51 removed, 22 of them in persisted keys,
  5 migrated. The failure is silent for a year and then arrives as a white screen after an
  app update.
- **`Record<string, …>` keyed by a destination id.** Three instances, one already carrying
  stale keys, and the type parameter that fixes it is used correctly 15 cm away in the same
  repo.
- **Believing `navSection()`'s docstring.** *"never undefined — the union is exhaustive"*
  (`registry.ts:116`) is true of the *type* and false of the *value*. Forty lines of another
  file says the opposite and is right.
- **Adding a destination without adding it to the enumerators.** `navCatalog.ts`'s docstring
  promises *"the catalog enumerates the FULL set of sections/tabs"* so *"ignored" is
  computable*. It covers 14 of 23 tab vocabularies; **41 of 156 destinations (26%) are missing
  from the denominator**, so every "never visited" number analytics reports is wrong by
  construction.

---

## 6. Evidence

**The L1 registry is genuinely excellent and the good half must be named first.** One record,
one gate evaluator, one exhaustiveness assert, **five derived consumers, and zero measured
drift among them**: `sidebarData.sections` (`:44`), `navCatalog.SECTIONS` (`:60`),
`reachablePaletteSections` (`commandPaletteUtils.ts:23`), `FooterSectionNav` (`:37-43`) and
`SECTION_ROUTES` (compile-checked). `registry.test.ts` verifies six invariants in both
directions. **The hole is not the registry; it is that the registry stops at level 1.**

**The one site to copy — the destination record:** `src/lib/navigation/registry.ts:74-95`.
Every fact about a destination in one literal, and the compile-time assert at `:105-108` that
makes the set closed. Reproduced independently by `personas-web`'s `GuideTopic` and
`brainiac`'s `PRODUCT_ROUTES`; all three are the lowest-defect subsystem in their repo.

**The one site to copy — the resolver:** `src/i18n/routeSections.ts:96-104`. A
`Record<SidebarSection, …>` lookup that expects to miss, says why in a comment, warns in dev,
and returns a safe default. Independently reinvented as `parseModule` in
`brainiac/console/src/design/routes.ts:125-128`, which goes one better by testing membership
against the registry itself rather than a parallel map.

**The one site to copy — the typed destination record for L2:**
`src/features/home/sub_learning/powerMoves/registry.ts:13-20`. `PowerMoveNav` is the only
first-class destination *value* in the app — a discriminated union of `{ overlay }` or
`{ section, overviewTab?, eventBusTab?, pluginTab? }`, every field typed to its vocabulary.
Copy the shape. (Then read §7 B for the one thing it still admits.)

- `src/lib/navigation/history.ts:1-30` — the best module-level docstring in the navigation
  tree: it states outright that the app has no URL bar, that routing is store-driven, and
  models browser semantics deliberately rather than by accident. `:102-112`'s `firstReachable`
  skips destinations whose gates now fail, so Back never lands on a forbidden surface — a
  correctness property `personas-web` does not have on any of its 7 `useState` tab surfaces.
- `src/features/shared/chrome/commandPaletteUtils.ts:15-25` — the reachability contract kept
  pure (no React, no stores) *specifically so it can be unit-tested*, with a comment recording
  that the palette previously hardcoded 8 sections and silently missed Projects and Studio.
- `src/features/shared/chrome/sidebar/sidebarData.ts:161-165` — the single most valuable
  comment in the corpus for this leaf: a retired `voice` item, never in the `TwinTab` union,
  *"the sidebar's `id as TwinTab` cast hid that from the compiler, so clicking it set an
  unhandled tab and rendered a blank page."* The diagnosis names the cast. The cast is still
  at all 18 sites.
- `src/features/plugins/twin/TwinPage.tsx:61-72` — the recovery pattern that incident produced,
  with the key sentence *"Persisted state can still hold such a value, so recover instead of
  showing a blank."* One of **two** such guards in the app (`HomePage.tsx:38-42` is the other).
- `src/stores/slices/system/uiSlice.ts:414-416` — the same failure on a different axis:
  *"'projects' was retired from DevToolsTab … the cast hid the stale default (no branch matched
  → blank page)."*
- `src/lib/analytics/navCatalog.ts:64-70` — a real repair worth copying: the value sets were
  converted from subset-tolerant `satisfies readonly X[]` to `Record<T, true>` **because the
  loose form had silently missed `mastermind`, `missions` and `parameters`.** Three drifts, one
  type change, zero since. This is §4's argument, already proven inside this repo.
- `src/features/shared/chrome/FooterSectionNav.tsx:25-28` — *"a second permanent one would just
  be two nav systems disagreeing about which is authoritative."* The doctrine, stated.
- `src/test/automation/bridge.ts:310-327` — the only navigation entry point in the app that
  **validates its input and explains the refusal** (`Invalid section: x. Valid: …`).

---

## 7. Deviations found

**Five categories, 24 individually-addressable items.** All ship green under `npm run check`
(`tsc --noEmit`, `eslint src/`, `census:check`, `check:tiers`, `check:contracts`) and under the
full Vitest suite.

### A. A persisted destination id that no longer exists throws — measured by execution — 4

**A1 — 51 destination ids have been deleted from these unions; 22 lived in a persisted store
key; 5 got a migration.** Measured by parsing every union out of all **143 revisions** of
`src/lib/types/types.ts`:

| Vocabulary | now | removed | persisted? | migrated | unhandled |
|---|---|---|---|---|---|
| `SidebarSection` | 11 | **8** (`scraper`, `goals`, `director`, `workflows`, `team`, `cloud`, `dev-tools`, `gitlab`) | **yes** | 1 (`goals`→`teams`) | **7** |
| `EditorTab` | 8 | 6 | **yes** | 3 | **3** |
| `PluginTab` | 9 | 4 (`langfuse`, `fleet`, `ocr`, `doc-signing`) | **yes** | 0 | **4** |
| `SettingsTab` | 13 | 2 (`config`, `quality-gates`) | **yes** | 0 | **2** |
| `TwinTab` | 7 | 1 (`voice`) | **yes** | 0 | 1 → *caught by `TwinPage.tsx:66-72`* |
| `DesignSubTab` | 7 | 1 | **yes** | 1 | 0 |
| `OverviewTab` | 15 | **12** | no | — | — |
| `DevToolsTab` · `GoalsTab` · `EventBusTab` · `AgentTab` · `TemplateTab` · `KpisTab` | — | 16 | no | — | — |

**16 removed ids are unhandled in a persisted key**, of which 1 self-heals. The unpersisted 29
are harmless only because nobody added their key to `partialize` — luck, not design.

**A2 — and the failure is a `TypeError` in the content router's first statement, not a blank
page.** Run against the real modules (Vitest, `registry.ts` + `sectionRouter.tsx` + `history.ts`
imported unmodified), feeding each of the 8 removed section ids:

```
scraper   navSection=undefined  isRoutable=false
          isSectionGated=THROWS(TypeError: Cannot read properties of undefined (reading 'gates'))
          railSection=THROWS(TypeError: … reading 'parent')
          isDestGated=THROWS(TypeError: … reading 'gates')
```

Identical for all 8. `PersonasPage.tsx:247` calls `isSectionGated(sidebarSection, …)` as the
**first** statement of `renderContent`, so a stale persisted value throws before any surface
renders. A stale entry in the back stack throws the same way through
`goBack → isDestinationGated` (`history.ts:196`) — also measured. `navSection`'s own docstring
(`registry.ts:116`) says *"never undefined — the union is exhaustive."*

**A3 — the boot path reads the same value twice and validates it neither time.**
`main.tsx:161-171` reads `persona-ui-system` out of `localStorage` directly (to preload the
right i18n chunks before React mounts) and returns `section as SidebarSection` after checking
only `typeof section === "string"`. Zustand's `persist` then rehydrates the same key with only
the `'goals'` special case (`systemStore.ts:139-142`). Two readers, two chances, zero
membership checks.

**A4 — the repo already contains the correct answer, forty lines away, and disagrees with
itself in prose.** `routeSections.ts:96-102`: *"The Record is exhaustive at compile time, but a
stale/renamed persisted `sidebarSection` value can miss the map at runtime … Warn loudly in
dev"* — and it returns `BASE_SECTIONS` rather than throwing. Two `Record<SidebarSection, …>`
lookups, the same unvalidated input, opposite beliefs about whether the input can be trusted.
**The i18n layer is right; the navigation layer throws.**

### B. `setSidebarSection` accepts a section that mounts nothing — 3 shipped features

`schedules` is `reachability: 'overlay-only'`: it has no `SECTION_ROUTES` entry (asserted by
`registry.test.ts:57-59`), so `isRoutableSection('schedules')` is `false` and
`PersonasPage.tsx:362` falls through to the **Agents** surface. `setSidebarSection` accepts it
anyway.

| Site | What it declares | What happens |
|---|---|---|
| `powerMoves/registry.ts:52-60` — the "Schedule a delay" Power Move | `nav: { section: 'schedules' }`, `spotlightTestId: 'schedules-page'` | `launchPowerMove.ts:25` sets the section → Agents renders; `ScheduleTimeline` (the only component with `data-testid="schedules-page"`, `:242`) mounts **only** under `headerOverlay === 'schedules'` (`useTitleBarTray.tsx:198`), so the spotlight hunts an anchor that never appears |
| `tourSlice.ts:551-579` — `SCHEDULES_MASTERY_STEPS`, **2 steps** (`schedules-page`, `schedules-views`), both `nav: { sidebarSection: "schedules" }`, both `highlightTestId: "schedules-page"` | `GuidedTour.tsx:118` `setSidebarSection(step.nav.sidebarSection as SidebarSection)` | same — the Schedules mastery tour narrates the Schedules dashboard over the Agents table |
| `bridge.navigate('schedules')` (`bridge.ts:310-327`) | passes `VALID_SECTIONS`, passes the tier gate | returns `{success:true, section:'schedules'}` while the app shows Agents — the harness reports a successful navigation to a surface that did not mount |

The Power Move sits next to a correct sibling: `nav: { overlay: 'monitor' }` at `:50`, routed
through `setHeaderOverlay`. **`PowerMoveNav` already has the right shape; `schedules` is simply
on the wrong side of its union**, because `SidebarSection` conflates "a name" with "a place the
section setter can take you" — while `RoutableSection` (§4) already exists to separate them.

### C. The id crosses the app's own navigation boundary as `string` — 54 sites / 19 files

**C1 — `SubNavItem.id: string` (`SidebarSubNav.ts:12`), so every L2 tab set is a cast.** All 18
sites that write an L2 tab id, measured by AST:

| File | Sites | Which |
|---|---|---|
| `sidebar/SidebarLevel2.tsx` | 6 | `:183` home · `:223` overview · `:243` eventBus · `:261` credentialNav · `:267` template · `:313` settings |
| `sidebar/sections/PluginsSidebarNav.tsx` | 6 | `:145-150` artist · devTools · obsidianBrain · twin · companion · researchLab |
| `fleet/monitor/navigateToProcess.ts` | 4 | `:20,:25,:26,:28` |
| `sidebar/sections/AgentsSidebarNav.tsx` | 1 | `:489` cloud |
| `settings/search/useSettingsSearchEntries.tsx` | 1 | `:121` |

Per [`page-scaffold.md`](./page-scaffold.md) §2, `SidebarLevel2.tsx` + `PluginsSidebarNav.tsx`
are where **every** L2 tab id in the app is set. **The rail is the tab strip, and the rail's
`onSelect` is `(id: string) => void`.** Only 2 of the 13 `sidebarData.ts` item arrays type
their ids (`homeItems:63`, `overviewItems:71`); the other 11 are `SubNavItem[]`.

**C2 — 20 more are store defaults** (`uiSlice.ts:379-418`, `overviewSlice.ts:162`,
`artistSlice.ts:197`, `obsidianBrainSlice.ts:57`, `twinSlice.ts:231`), the exact form
`uiSlice.ts:414-416` blames for a blank page: `devToolsTab: "projects" as DevToolsTab` compiled
cleanly after `projects` was retired.

**C3 — the remainder cross a *process* boundary.** `main.tsx:167` (localStorage),
`applyClientAction.ts:37` + `useDecisionQueue.ts:57` + `athenaChatNavigation.ts:77-81` (Rust
IPC), `GuidedTour.tsx:118` (tour data), `bridge.ts:311,326` (HTTP harness),
`CredentialNavContext.tsx:50` (storeBus event). Every value that reaches navigation from
outside TypeScript arrives as `string` and is asserted, not resolved.

### D. Navigation is 1–3 store writes, and seven of them are deferred — 5

**D1 — a destination is not a value.** Two independent implementations:

| | Impl 1 (6-line text window) | Impl 2 (AST, consecutive statements) |
|---|---|---|
| `setSidebarSection("literal")` | 140 in 82 files | 156 call expressions |
| `set<X>Tab("literal")` | 157 | 206 call expressions |
| **composite (section + tab)** | **59 in 41 files** | **48 in 34 files** (37 × 1 tab, 11 × 2 tabs) |

**The 11-site disagreement is the finding.** Impl 2 requires *consecutive expression
statements*; the extra 11 are composites split by an intervening statement, a conditional, or a
timer — i.e. the ones where the two writes are not even syntactically adjacent.

**D2 — 6 composites defer the tab write past a tick**, so the section renders its default tab
first and swaps: `QuickStatsBar.tsx:93`, `useDecisionQueue.ts:302`, `ProactiveCard.tsx:65`,
`CommandPalette.tsx:206`, `useCanvasControlBridge.ts:83`, `TriggersPage.tsx:63`. Four are forced
by a structural cause: **`overviewTab` lives in a different store** (`overviewStore`) that is
lazily imported, so reaching an Overview tab requires a dynamic `import()` and the navigation
is unavoidably asynchronous. Only `launchPowerMove.ts:33` guards the gap (*"the user can
navigate again inside the delay … land it only if the section we routed to is still the one on
screen"*); the other five do not.

**D3 — seven distinct deep-link mechanisms.** (1) 8 `pending*` store fields consumed-and-cleared
on next mount (`uiSlice.ts:143-159, 210-221`); (2) `setTimeout(SUB_TAB_DELAY_MS)`
(`launchPowerMove.ts:9`); (3) `void import(store).then(set…)`; (4) `CredentialNavContext`'s
`pendingKey` + handler-ref (`:22-37`) — a fourth queue, reinvented inside a React context; (5)
`GuidedTour`'s `scheduleStepTimeout` + a **stringly-named** `subTabSetter` dispatched by an
if-ladder (`:120-132`); (6) `storeBus.emit('tour:navigate-credential-view')`; (7) two Tauri
events from Rust. None shares a type; none is testable as a unit.

**D4 — Back/Forward models 11 of 156 destinations.** `recordNavigation` is called from exactly
two places: `setSidebarSection` (`uiSlice.ts:483`) and `pushNavEntry` (persona switch). **No tab
setter records anything.** Overview → Executions → Incidents → Messages leaves an empty back
stack; pressing Back exits the section entirely.

**D5 — destination state lives in five different homes.** `systemStore` (16 keys),
`overviewStore` (`overviewTab`), a React context (`CredentialNavContext`, 6 destinations),
component `useState` (`FleetPage.tsx:37`, `FactoryShell`), and `localStorage` written directly
(`TwinVariantTabs`, per [`page-scaffold.md`](./page-scaffold.md) §7 C2).

### E. Twenty catalogs of eleven ids, and the drift is live — 7

For `SidebarSection` alone. Implementation A (co-occurrence of ≥4 of the 11 ids as quoted
literals over 6,859 files) found **75 files**, 46 of them i18n/generated label maps.
Implementation B (TS-compiler AST: array / object-key / array-of-`id` / switch-case literals
covering ≥50% of the vocabulary) found **13**; the two disagree on the Rust allow-list, which
Impl B's slice parser missed and which I confirmed by reading the file. Classified:

| Kind | Count | Members |
|---|---|---|
| **Derived from `NAV_SECTIONS`** | **5** | `sidebarData.sections:44` · `navCatalog.SECTIONS:60` · `reachablePaletteSections:23` · `FooterSectionNav:37` · (`SECTION_ROUTES` is checked, not derived) |
| **Compile-checked against the union** | **3** | `SECTION_ROUTES` (`satisfies Record<RoutableSection,…>`) · `ROUTE_SECTIONS` (`Record<SidebarSection,…>`) · `EXPECTED_SECTIONS` (`registry.test.ts:26`) |
| **Hand-written, no link** | **12** | `VALID_SECTIONS` (`bridge.ts:23`) · `COMPANION_NAV_ROUTES` (`companionRoutes.ts:16`) · `VALID_ROUTES` (`applyClientAction.ts:21`) · **`ALLOWED_ROUTES` (`dispatcher.rs:525`, Rust)** · `SIMPLE_SECTIONS` / `DEV_MODE_SECTIONS` / `MOBILE_SECTIONS` (`platform.ts:83,92,104`) · `NAV_CARDS` (`HomeWelcome.tsx:11`) · `SIDEBAR_ICONS` (`SidebarIcons.tsx:346`) · `NAV_PREFETCHERS` (`prefetch.ts:30`) · `SidebarLevel2`'s switch (`:167`) · `useBreadcrumbTrail`'s switch (`:95`) |

**E1 — `SIDEBAR_ICONS` carries three keys no navigation can produce.** `goals` (renamed to
`teams` on 2026-06-05 — the rehydrate migration at `systemStore.ts:139` is the proof), `team`,
and `cloud`. `IconTeams` and `IconCloud` are referenced from **nowhere else in `src/`** — dead
components reachable only through a dead key. Cause: `Record<string, …>`. Its sibling
`PLUGIN_ICONS` is `Partial<Record<PluginTab, …>>` and has zero stale keys.

**E2 — the companion route list was consolidated, documented, and re-drifted.**
`companionRoutes.ts:1-15` announces itself as the *"Single source of truth for the two
independent consumers that used to carry their own copy of this list … see
refactor-bughunt-2026-07-10 finding #6."* Today: `useDecisionQueue.ts:57` uses it ✓;
`athenaChatNavigation.ts:77` uses it ✓; **`applyClientAction.ts:21-31` declares its own
identical nine strings ✗** — and there are now two different functions named
`applyClientAction` in the same feature folder handling different subsets of the same
`ClientAction` union.

**E3 — the Rust allow-list is two entries wider than the TypeScript one, and only one of the
two TS consumers knows.** `dispatcher.rs:525-542` approves 9 sections **plus** `monitor` and
`mastermind`, two pseudo-routes with an explanatory comment. `athenaChatNavigation.ts:64-75`
handles both. `applyClientAction.ts:35-40` handles neither and returns silently. The route
crosses IPC as `String`/`string` at both ends (`approvals/mod.rs:75` `Navigate { route: String }`);
nothing types it. **`mastermind` exists only because `teams` is missing from all three TS
lists** — a workaround that invented a new vocabulary member rather than adding the existing
section id.

**E4 — `teams` and `studio` are unreachable by Athena.** Both are absent from
`COMPANION_NAV_ROUTES`, `VALID_ROUTES` and `ALLOWED_ROUTES`.

**E5 — the `DEV_MODE_SECTIONS` contradiction is unchanged.** `platform.ts:104` gates `plugins`
behind `isBuilder` in the Home card grid (`NavigationGrid.tsx:93-95`) while the registry gates
it at `minTier: TEAM` and the rail and palette both show it. Confirmed live; owned by
[`tier-and-capability-gating.md`](./tier-and-capability-gating.md) §7 B1. `studio`, the section
that actually *is* `devOnly`, is in no set.

**E6 — the harness's four L2 allow-lists are each one short.** `bridge.ts:138`
`VALID_PLUGIN_TABS` omits `scraper` (9 → 8); `:247` `VALID_TEMPLATE_TABS` omits `explore`
(5 → 4). Both destinations exist in the sidebar and cannot be driven by the test harness, so
no automated test can ever visit them.

**E7 — the browse grid and the plugin sidebar disagree in DEV builds.**
`PluginBrowsePage.tsx:28-34` hard-lists 5 plugins; `PluginsSidebarNav.tsx:93-102` lists 9 with
`devOnly` on three (`artist`, `research-lab`, `scraper`). In a DEV build the sidebar offers all
8 plugins and Browse shows 5 — and `togglePlugin` has **exactly one call site**
(`PluginBrowsePage.tsx:74`), so three plugins cannot be disabled from the only surface that
exists to enable/disable them. The file's own comment names 2 of the 3 exclusions.

### F. The enumerators cover a fraction of what they claim — 5

| Enumerator | Claims | Covers | Missing |
|---|---|---|---|
| `navCatalog.TAB_DIMENSIONS` (`:104-119`) | *"the catalog enumerates the FULL set of sections/tabs"* so *"ignored" is computable* | 14 of 23 tab vocabularies | **41 of 156 destinations (26%)** — `KpisTab`, `ObsidianBrainTab`, `TwinTab`, `ArtistTab`, `ApprovalsMode`, `CompanionPluginTab`, `FactoryL2Tab`, `CredentialNavKey`, `HeaderOverlay`. Every "never visited" figure is wrong by construction |
| `useBreadcrumbTrail.ts:95-197` | a trail for the current location | 8 of 11 sections | `teams`, `studio`, `schedules` fall to `default:` and render a single dead segment. Also reaches `overviewStore` through a bare `require()` (`:32`) inside an ESM/Vite app, with a silent `catch` returning `'home'` |
| `reachablePaletteSections` + `useSettingsSearchEntries` | the palette's reach | **24 of 156 (15%)** — 11 sections + 13 settings tabs | 132 destinations are reachable by exactly one gesture: clicking their own sidebar row |
| `bridge.navigate` + the 4 tab helpers | the harness's reach | **33 of 156 (21%)** | no Overview, Settings, Events, DevTools, Teams, Editor, Goals, Research-Lab or Companion tab is drivable |
| `registry.test.ts` | completeness | 11 of 156 | no L2 vocabulary has a completeness test |

---

## 8. Gaps in the primitive

1. **`SidebarSection` conflates a name with a reachable place.** `reachability` is a *field*
   on the registry entry, so `RoutableSection` and `OverlaySection` exist as a runtime
   distinction the setter's signature ignores. `sectionRouter.tsx:45` already computes
   `RoutableSection`; nothing consumes it as a parameter type. §7 B's three shipped features
   are the cost. **Cheapest real fix in this document: narrow `setSidebarSection`'s parameter
   and add `setHeaderOverlay` overloads for the overlay-only ids.**
2. **There is no destination *record* below level 1.** `NAV_SECTIONS` gives L1 an id + label +
   icon + gates + reachability + parent in one literal. L2 has an untyped `SubNavItem` in one
   file, a union in another, a router branch in a third, a store key in a fourth and an
   analytics dimension in a fifth — five files, no shared type, no assert. Every §7 C, D and F
   defect is downstream of this one gap.
3. **There is no total resolver and no type predicate.** No `resolveSection(unknown)`, no
   `isSidebarSection(x): x is SidebarSection`, no `resolveTab(raw, vocab, fallback)`. Their
   absence forces 54 assertions and makes `navSection()` a partial function documented as
   total. brainiac wrote the 4-line version; Personas has one instance
   (`sectionsForRoute`) and it lives in the i18n layer.
4. **`persist` has no schema for destination keys.** `partialize` (`systemStore.ts:58-132`)
   whitelists 11 destination keys; `onRehydrateStorage` (`:133-192`) hand-writes migrations for
   2 of them. Zustand offers `version` + `migrate`, which this store does not use. There is no
   place to declare *"this key holds a member of this union; drop anything else"* — so §7 A's
   16 unhandled ids have nowhere to be handled even by an author who wants to.
5. **`NavDestination` cannot express an L2 place**, so Back/Forward — a genuinely good engine —
   is structurally limited to 11 destinations (§4, recorded as a real limitation).
6. **`overviewTab` lives in a second store, so four navigations are asynchronous by
   construction** (§7 D2). This is a
   [`zustand-domain-slices.md`](./zustand-domain-slices.md) boundary decision with a
   navigation consequence nobody chose.
7. **The IPC route is `String` on both sides.** `ClientAction::Navigate { route: String }`
   (`approvals/mod.rs:75`) and `{ type: 'navigate'; route: string }` (`api/companion.ts:1127`).
   ts-rs generates bindings for this crate; a `SidebarSection` newtype in Rust exported through
   ts-rs would make the two allow-lists derivable from one declaration instead of three
   hand-kept copies in two languages.
8. **Nothing links a destination to the enumerators that must know about it.** Adding a tab
   requires remembering `navCatalog`, `useBreadcrumbTrail`, `bridge.ts`, and the palette, and
   **nothing fails if you forget all four** — the measured state is that everyone does (§7 F).

---

## 9. The missing gate

**Every deviation above ships green.** `census:check`'s 71 rules were read rule by rule before
writing this: none touches navigation. The two nearest neighbours were checked specifically —
`undeclared-tier-branch` keys on `{ isStarter } = useTier()` destructuring (a *gate* decision,
not a destination id) and `settings-key-declared-outside-registry` keys on the app-settings
key registry; neither shares a signal, a token or a target with this one.
`scripts/i18n/check-route-sections.mjs` *is* a route-section gate — for **i18n chunk coverage**,
asserting each section's translations load on some route. It is the closest thing that exists,
it is well-built, and it is blind to whether the destination resolves.

### 1. Census rule — `unchecked-destination-id-assertion`

**The condition (stack-free):** *a destination identifier crosses a boundary as an unvalidated
free-form string and is then re-asserted into the destination vocabulary without a membership
check — so the compiler stops checking exactly where the value stops being trustworthy
(persisted state, an IPC payload, a URL, a nav-item list typed `string`).*

**The proxy in this repo:** a TypeScript `as <DestinationVocabulary>` assertion. **PRECONDITION,
and an adopting repo must re-derive its own:** this works because Personas' destination
vocabularies are closed string unions and the *compliant* form — a total resolver returning the
union, or a nav item whose `id` is already typed — **contains no assertion at all**, so the
deviant form is the only place the token appears. A repo whose destinations are filesystem
routes (`personas-web`: 37 `page.tsx` files, **0** destination-vocabulary assertions, and yet 9
real destination defects) or whose ids arrive from `searchParams` would score **zero** here
while the condition is present at full scale. `brainiac` is the instructive case: it has the
condition (`MODULE_BAND: Record<string, BandKey>`, 5 of 14 missing) and **would also score
zero**, because its proxy is *the missing type parameter on a `Record`*, not a cast. Re-derive
against the local vocabulary primitive.

```json
{
  "rules": [
    {
      "id": "unchecked-destination-id-assertion",
      "goldenPath": "docs/concepts/golden-paths/navigation-destination.md",
      "title": "A destination id is asserted into its vocabulary instead of resolved through a total function, so the compiler stops checking exactly where the value stops being trustworthy",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\bas\\s+(?:SidebarSection|HomeTab|GoalsTab|KpisTab|TeamsTab|EditorTab|DesignSubTab|OverviewTab|TemplateTab|CloudTab|SettingsTab|ApprovalsMode|DevToolsTab|AgentTab|PluginTab|ResearchLabTab|ObsidianBrainTab|TwinTab|ArtistTab|EventBusTab|CredentialNavKey|CompanionPluginTab|HeaderOverlay|FactoryL2Tab)(?![A-Za-z0-9_$\\[])",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a TypeScript `as` assertion into one of the app's 24 destination vocabularies. PROXY FOR the stack-free condition: a destination identifier crosses a boundary as an unvalidated free-form string and is then re-asserted into the vocabulary without a membership check, so the compiler stops checking exactly where the value stops being trustworthy. The compliant forms contain NO assertion: (a) a nav item whose `id` is already typed to its vocabulary (sidebarData.ts:63 homeItems, :71 overviewItems - 2 of 13 arrays), or (b) a TOTAL RESOLVER that tests membership and falls back, of which this repo has exactly one - sectionsForRoute (src/i18n/routeSections.ts:96-104), whose own comment states the hazard: 'The Record is exhaustive at compile time, but a stale/renamed persisted sidebarSection value can miss the map at runtime.' MEASURED CLASSIFICATION of the 54: 18 feed a navigation SETTER directly (SidebarLevel2.tsx:183,223,243,261,267,313 + PluginsSidebarNav.tsx:145-150 + navigateToProcess.ts:20,25,26,28 + AgentsSidebarNav.tsx:489 + useSettingsSearchEntries.tsx:121) and these ARE the app's entire L2 navigation surface per page-scaffold.md; 20 are store initial values (uiSlice.ts:379-418 et al) - the exact form uiSlice.ts:414-416 blames for a shipped blank page after 'projects' was retired from DevToolsTab; 8 cross a PROCESS boundary (main.tsx:167 localStorage at boot, applyClientAction.ts:37 + useDecisionQueue.ts:57 + athenaChatNavigation.ts:77-81 Rust IPC, GuidedTour.tsx:118 tour data, bridge.ts:311,326 HTTP harness, CredentialNavContext.tsx:50 storeBus); the rest are internal. PRECEDENT that this is not theoretical: sidebarData.ts:161-165 records that a retired 'voice' item, never in the TwinTab union, was hidden from the compiler by exactly `id as TwinTab` and 'rendered a blank page'. PRECISION: 53 of 54 are production code; 1 (uiSlice.test.ts:30, `state.headerOverlay as HeaderOverlay`) is a redundant re-assertion in a test - deliberately NOT excluded, because a single-line allowlist entry on a test file is how an exemption goes stale. PRECONDITION: this proxy works only because the destinations are closed TypeScript string unions and the compliant form carries no token. A repo whose routes are filesystem paths (personas-web: 37 page.tsx, ZERO such assertions, 9 real destination defects) or whose ids arrive from searchParams scores zero here while the condition is present at full scale; brainiac has the condition wearing a different marker entirely (a missing type parameter: `Record<string, BandKey>` drifted 5 of 14 while `Record<ConsoleModuleId, X>` drifted 0 of 42).",
        "$falsePositiveNote": "Verified through two independently written implementations. A TypeScript-compiler AST pass counting AsExpression nodes whose `type` text is a destination vocabulary returned 52; this text matcher returns 54. BOTH disagreements were run down and the AST pass was wrong twice over: (1) it omitted HeaderOverlay and FactoryL2Tab from its vocabulary list, which is +2; (2) the text matcher additionally sees 2 matches on comment-only lines, which `ignoreCommentLines` correctly drops - and both of those comments (TwinPage.tsx:63, sidebarData.ts:164) are prose ABOUT this exact defect, the precise 35%-prose trap the engine's own docstring records from raw-web-storage. The `(?![A-Za-z0-9_$\\\\[])` tail is load-bearing: without the `\\\\[` it also matches `as SidebarSection[]` at registry.test.ts:49, an Object.keys() widening that is correct by TypeScript's design. After that tail the two implementations agree exactly at 54."
      },
      "baseline": { "files": 19, "matches": 54 },
      "floor": 4000
    }
  ]
}
```

**Validated standalone** from a scratchpad rule file named uniquely to this composition
(`census-navdest-7b4e2d.json`; the pattern lives in a file, never in bash argv, and contains no
lookbehind), then **re-extracted from this finished document and re-run — same counts.** Clean
run:

```
  OK   unchecked-destination-id-assertion     19     19       54     54    4829   4000
    2 match(es) ignored on comment-only lines
```

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check --rules <file>`):

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK … 19 19 54 54 4829 4000` — surviving counts printed |
| matcher matches nothing (`NoSuchDestinationVocabXYZ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped 19 → 0` / `54 → 0` |
| floor above walk (`floor: 9000`) | **1** | `walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src/lib`) | **1** | `walked 1267 … floor is 4000` + `zero matches` + both drops |
| count rises (baseline 20) | **1** | `[drift] matches rose 20 → 54 (+34)` |
| renamed root (`srcc`) | **1** | `walked 0 files but floor is 4000` + `matched zero files anywhere` |
| count drops (baseline 90) | **1** | `[drift] matches dropped 90 → 54 (-36) without the baseline moving` |
| stale `exclude` | **1** | `exclude "…/Gone.tsx" matched no file. The exemption is stale…` |
| `exclude` with a 9-char `reason` | **1** | schema refusal before any scan |
| positive control carrying a baseline | **1** | `a positive control must NOT carry a baseline — it exists to fail` |

All ten behave as the contract requires. The tenth is new information for future composers:
**the runner now refuses a baselined positive control outright**, so a control must be validated
without one (`page-scaffold.md` §9's note that `validateRule` requires a baseline is out of date).

**Expected trajectory: down to a small residue, not to zero.** 18 disappear when `SubNavItem`
becomes generic (§4); 20 more are unnecessary store-default assertions removable mechanically;
the 8 boundary crossings become 0 the moment a `resolveSection`/`resolveTab` exists. The
terminal state is 2-4. **If it ever reaches 0 the rule must be deleted rather than baselined at
zero** — the engine treats a zero-match rule as a broken matcher, which it is right to do.

**Positive control — a containment control, and the containment is the point.**

```json
{
  "id": "navigation-destination-positive-control",
  "goldenPath": "docs/concepts/golden-paths/navigation-destination.md",
  "title": "POSITIVE CONTROL - not a gate. Do not merge.",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bas\\s+[A-Z][A-Za-z0-9_]*(?![A-Za-z0-9_$\\[])",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - the vocabulary-discrimination control for unchecked-destination-id-assertion. IDENTICAL anchor (`as <Type>`), with the destination vocabulary enumeration removed. Measured 2026-08-15: 792 files / 1699 matches, versus the rule's 19 files / 54 matches - a 31.5x ratio, and the rule's population is a STRICT SUBSET by construction (verified: 19 of 19 rule files are also control files). Its purpose is to show that the discriminating power of the rule is the VOCABULARY LIST, not the `as` anchor: a signal keyed on 'a type assertion' would report 1645 additional matches across 773 files that contain no destination id at all and that this path says nothing whatsoever about. Deliberately carries no baseline - the census runner now REFUSES a baselined positive control ('a positive control must NOT carry a baseline - it exists to fail'), so this cannot be validated with a temporary one; it was validated by running the report mode, which prints an em-dash in the baseline columns."
  },
  "floor": 4000
}
```

**Both populations and their overlap, measured with the engine's own `scanRule`:** the rule
matches **19 files / 54 matches**; the control **792 files / 1,699 matches**; **all 19 rule
files are control files** and the control contains **773 files with no destination assertion at
all**. Unlike `page-scaffold.md`'s disjoint `h1`/`h2` control this one is a containment control,
which is the honest shape here — the rule is the control plus a vocabulary filter, so the
**1,645-match remainder is precisely the population a vocabulary-blind rule would falsely
flag.** **Do not merge this block.**

### 2. Extend `registry.test.ts` to cover the twelve hand-written catalogs (≈40 lines)

`src/lib/navigation/registry.test.ts` already enumerates and asserts in both directions; it has
every module in scope for free. Add:

- **Every hand-written catalog of section ids is a subset of `ALL_SIDEBAR_SECTIONS`.** Import
  `VALID_SECTIONS` (`bridge.ts`), `COMPANION_NAV_ROUTES`, `applyClientAction`'s list (export it),
  `SIMPLE_SECTIONS` / `DEV_MODE_SECTIONS` / `MOBILE_SECTIONS`, `NAV_CARDS` (export it),
  `Object.keys(SIDEBAR_ICONS)`, `Object.keys(NAV_PREFETCHERS)`. **`SIDEBAR_ICONS` fails today on
  `goals`/`team`/`cloud`** — a live contradiction caught on the first run.
- **`COMPANION_NAV_ROUTES` and `applyClientAction`'s list are equal**, killing E2 permanently.
- **Every `PowerMoveNav.section` and every `TourStepDef.nav.sidebarSection` is routable**:
  `expect(isRoutableSection(s)).toBe(true)`. **Fails today on 3 sites** (§7 B).
- **Round-trip every removed id**: for a fixed list of retired ids, assert
  `resolveSection(id) === 'home'` rather than a throw — the regression guard for §7 A.

**How it fails loudly if its own precondition is absent** — copy the `checked > N` shape this
repo already treats as the model (`ipc_auth.rs:971-976`):
`expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(10)` and
`expect(POWER_MOVES.length).toBeGreaterThanOrEqual(10)` before asserting anything about them. A
catalog that imports as an empty array must not read as "no drift" — that is the failure mode
that let four of this repo's CI jobs check nothing.

### 3. REFUSED — a census rule on "a destination exists but nothing routes to it"

This is the highest-value condition in the leaf (§7 B: 3 shipped features navigate to a section
that mounts the wrong surface; §7 F: 132 destinations are reachable by one gesture) and the
census runner **provably cannot host it.** Measured, in ascending order of fatality:

1. **It is a relation across three-to-five files and the engine reads one at a time.**
   `scanRule` (`scripts/census/lib/engine.mjs:147-239`) opens one source, applies one regex,
   counts. *"`powerMoves/registry.ts:58` names a section whose `reachability` in
   `registry.ts:93` is `overlay-only` and which is therefore absent from
   `sectionRouter.tsx:59`"* needs all three simultaneously.
2. **The defect is a negative and a census rule counts positives.** "No router branch for this
   id" has no token.
3. **The router shapes have nothing textual in common.** A `Record` lookup (`TriggersPage`), a
   nested ternary (`OverviewPage`), a `mountedTabs.map` (`SettingsPage`), an `&&` chain
   (`DesignReviewsPage`), a `useEffect` (`EditorBody`), a `switch` (`SidebarLevel2`). A regex
   tuned to one scores zero on the other five.
4. **The vocabulary is data, not text.** Resolving "which ids exist" requires evaluating 24
   unions across 5 files — which item 2's *test* does natively and a text matcher cannot do at
   all.

**Specify the Vitest case in item 2 instead.** That converts "detect the unroutable
destination" into "a destination that is not routable cannot be passed to the section setter",
which is §4's type answer with a test as its ratchet until the type change lands.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. **Not because warnings drown in a large baseline** — the baseline is 1,135
([`shared-facts.json`](../shared-facts.json)) and the volume argument is not available at any
count. The count-independent argument is the only one that holds: `npm run check` runs
`eslint src/` with **no `--max-warnings`** (`package.json:51`), and the pre-commit hook runs
`--quiet --max-warnings 99999`, where `--quiet` discards warnings before they can be counted.
**A warn-level rule enforces nothing at either gate, by construction.**

---

## Convergence — the same controlled experiment, run independently in three repos

Checked read-only against `../personas-web` (Next.js 16 App Router, 37 `page.tsx`, 11
`route.ts`, 10 `layout.tsx`) and `../brainiac/console` (Next.js, 14 modules on one `?m=` route).

### The strongest result in the batch: the type link predicts drift; the state location does not

Each repo, independently and without a shared document, ran a *controlled experiment* — two or
three subsystems solving the same destination problem with different bindings, in one codebase,
by the same authors. **All three produce the same ordering.**

| Binding | Repo | Instances | Drifted |
|---|---|---|---|
| `Record<VocabularyUnion, X>` / `satisfies Record<…>` | brainiac | `ADDRESS_SPECS` keys, `MODULES` dispatcher, the union | **0 / 42 entries** |
| | Personas | `SECTION_ROUTES`, `ROUTE_SECTIONS`, `EXPECTED_SECTIONS`, `PLUGIN_ICONS` | **0** |
| | personas-web | `GuideTopic` record + `check-guide-content.mjs` | **0** across 116 topics × 46 deep links × 100 map entries |
| `Record<string, X>` | brainiac | `MODULE_BAND` | **5 / 14 missing** (and dead, and its test hardcodes 2 of 14 instead of iterating) |
| | Personas | `SIDEBAR_ICONS` | **3 stale keys** |
| Declared catalog ↔ hand-written render | personas-web | `LANDING_SECTIONS` ↔ JSX ids | **5** (2 duplicate ids, 3 orphan wrappers); `/features` adds 7 more duplicates |
| | brainiac | `PRODUCT_ROUTES` ↔ chrome groups | **1 / 14** — `projects` has **no door anywhere in the console** |
| Hand array ↔ hand array, no link | personas-web | `SCOPED_ROUTE_PREFIXES` ↔ `navItemDefs` | **1** (10-of-13 subset, no guard) |
| | Personas | 12 hand-written section catalogs | **3 live** (§7 E1, E2/E3, E5) |

**This inverts the brief's second premise, and I am reporting it against my own framing.**
brainiac was cited as having *"deleted its store problem by putting state in the URL."* It did
buy three properties: `parseModule` is total, `?m=` survives reload, a shared link paints the
right module server-side, and Back walks modules. **It bought nothing in vocabulary integrity.**
Its `/demo` route — a pure `useState` tab switcher with **zero tests** — has a *cleaner* id
vocabulary than `/console`, because its 9 ids are consumed by an exhaustive `switch` the
compiler checks. Every one of `/console`'s destination defects (the 5-short `MODULE_BAND`, 7
wrong `ADDRESS_SPECS` entries, the unrendered `projects`) sits precisely where a
`Record<ConsoleModuleId, …>` was *not* used. **The URL is a persistence and addressability
decision. The type is the integrity decision. They are orthogonal, and Personas needs the
second one far more urgently than the first.**

### Physics — three independent rediscoveries each

| Clause | Warrant | Evidence |
|---|---|---|
| **The destination's name, gate and resolver belong in ONE record** | **physics, and it is §2's core** | `NAV_SECTIONS` + `passesGates`; `personas-web`'s `GuideTopic` (`mode`, `devOnly` declared on the topic, resolved by `isTopicVisible`); `brainiac`'s `PRODUCT_ROUTES` with `segment`/`band`/`group` in one literal. In every repo it is the **lowest-defect subsystem measured** |
| **An id from outside the compiler must go through a TOTAL resolver, never an assertion** | **physics** | `brainiac`'s `parseModule` (`routes.ts:125-128`) — membership tested against the registry itself, unknown → `DEFAULT_MODULE`, never 404s, never throws, 3 call sites, 2 tests. Personas' `sectionsForRoute` (`routeSections.ts:96-104`) is the same invention with a dev warning added. `personas-web`'s `[topic]/page.tsx:100-105` — four guards then `notFound()`. **Personas' navigation layer is the one place any of the three repos throws instead** |
| **Validate a persisted view id against the current catalog on read** | **physics, and Personas is the outlier** | `brainiac`: **3 of 3** localStorage view keys validate (`VIEWS.some(v => v.id === initial)`), and **3 of 3** give the URL precedence over the stored value. `personas-web`: 3 persisted view keys. Personas: **4 of 22** removed persisted ids handled |
| **A second consumer must call the resolver, not re-implement it** | **physics — the convergent failure** | `personas-web`: `sitemap.ts:38` re-derives topic URLs and drops the `devOnly` gate → **1 live 404 in the published sitemap**; 4 of 5 guide surfaces re-derive visibility and drop the `mode` filter, so a toggle hides 81 topics on one page and nothing elsewhere. `brainiac`: every module hand-rolls its own `searchParams` reader while a complete `decodeAddress` grammar sits unused with **zero production callers** and 7 wrong entries. Personas: §7 E2 (`applyClientAction`'s duplicate list), §7 F (`useBreadcrumbTrail`'s private switch) |
| **A gate declared away from the destination is applied unevenly** | **physics** | `personas-web`: `isTopicVisibleForMode` has **2 call sites, both in one file**, against 5 surfaces that need it. Personas: `SIMPLE_SECTIONS`/`DEV_MODE_SECTIONS`. Same shape, both repos |

### The asymmetry the brief predicted — confirmed, and sharper than expected

Both siblings are Next.js, where **a route's existence is a filesystem fact**. That buys them
exactly one property, and they get it perfectly: I extracted every internal path literal in
`personas-web` (**197 occurrences, 50 distinct paths**), every `#fragment` href (**34**), and
every `/guide/<cat>/<topic>` deep link (**46**), and resolved each against the real App Router
tree. **Zero broken links.** Personas cannot make that claim about anything below L1 — it has
no structural notion of a destination existing.

**And existence is the only thing the framework gives them.** All 9 of `personas-web`'s
destination defects are about *visibility and reachability*, which are hand-built: a sitemap URL
that 404s, `/playground` with **0 inbound links anywhere**, **5 of 11 public routes with no
production nav entry point** (the footer's whole Resources column is `NODE_ENV`-gated), 9
duplicate runtime DOM ids, 3 orphan anchors, 16 of 116 topics missing a module mapping. And
`check:guide-content` — the one gate that would catch the guide's half of it, which **exists and
passes** — **is not in `ci.yml`**.

Two consequences for Personas, one comfortable and one not:

1. **The transferable half of §2 is "one record, one resolver, derive every consumer" — not
   anything about stores or URLs.** A web app adopting this path gets existence for free and
   should spend the saved effort on the resolver and the gate, which is where all three repos
   bleed.
2. **Personas' store-driven routing is a real constraint, not a mistake, and the fix is not a
   URL.** It is a desktop app with no address bar; `history.ts:1-30` says so and models browser
   semantics deliberately. What it lacks is not `?m=` — it is a **`Destination` type, a total
   resolver, and a `navigateTo` that writes it atomically.** brainiac has all three *without*
   needing the URL for any of them, which is exactly why its `/demo` outperforms its `/console`
   on vocabulary integrity while losing on shareability. **Those are two different wins and
   Personas is currently missing the one that does not require a URL.**
