# Golden path — View-state persistence

> Situation node: `client-runtime/state-management/view-state-persistence` · [situation spine](../situation-spine.md)
> recurrence **16** · risk **medium** · sides **client** (spine also carries `twoSided: true`) ·
> convergence **diverged** (label tested — §12.5, it holds on one half and fails on the other)
> dimensions: **ui · function · code-quality**
> `mergedFrom`: *View-state memory* + *View state persistence*
> Leaf definition: *"Remembering filters, sort, collapse and widths across navigation and restart."*
> Composed 2026-08-17 against `master` @ `df634c53c`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (**2,104** `.tsx`; **4,425** production), walked by four
> independent matchers. Every `persist()` config in the tree (**7**, plus the JSDoc example inside the
> storage adapter) opened and read in full, and all **69** of their `partialize` entries enumerated
> twice — once by regex, once by brace-matching the config block. All **79** production web-storage
> reads classified. All **76** distinct storage-key strings enumerated. All **520** scroll-container
> class occurrences and all **3** explicit scroll resets. All **130** `<textarea>` sites in **119**
> files. Every `<UnifiedTable>` / `<DataGrid>` / `<GroupedVirtualList>` / `<SectionCard collapsible>`
> render site parsed with a **TSX-generic-aware** attribute reader (§12.1 — a naive one was wrong).
> Every revision of `src/lib/types/types.ts` (**156** of them) replayed to diff the **18** view-state
> vocabularies member-by-member. Read in full: `stores/systemStore.ts`, `stores/slices/system/uiSlice.ts`,
> `stores/agentStore.ts`, `stores/themeStore.ts`, `stores/util/dedupedStorage.ts`,
> `hooks/utility/interaction/useScrollRestoration.ts`, `hooks/utility/data/usePersistedContext.ts`,
> `hooks/utility/data/useDensity.ts`, `shared/components/display/{UnifiedTable,ColumnResize,DataGrid}.tsx`,
> `shared/components/layout/SectionCard.tsx`, `overview/sub_incidents/components/IncidentsInbox.tsx`,
> `overview/sub_incidents/libs/incidentFilterDefaults.ts`, `settings/components/SettingsPage.tsx`,
> `triggers/TriggersPage.tsx`, `plugins/research-lab/ResearchLabPage.tsx`,
> `plugins/dev-tools/sub_workspaces/{workspaceStore,useWorkspaceSwitch}.ts`,
> `studio/{studioHistory,studioStore}.ts`, `plugins/drive/hooks/useDrive.ts`,
> `fleet/monitor/channels/ConversationComposer.tsx`, `teams/sub_collab/useTeamChannel.ts`,
> `teams/sub_teamMemory/components/panel/TeamMemoryPanel.tsx`,
> `stores/slices/system/devToolsProjectSlice.ts`, `personas/PersonasPage.tsx`,
> `src-tauri/src/commands/infrastructure/dev_tools.rs:265-294` (static read only).
>
> **Measured by EXECUTING, not by reading.** Seven experiments in **jsdom 29.1.1 + React 19.2.6 +
> zustand 5.0.14**, all three loaded from the repo's own `node_modules`. `useScrollRestoration`,
> `dedupedStorage`, `UnifiedTable`'s persisted-sort block, `IncidentsInbox`'s filter restore,
> `SettingsPage`'s tab dispatch, `TriggersPage`'s fallback dispatch and `systemStore`'s entire
> `partialize` + `onRehydrateStorage` were transcribed **statement for statement** and driven across
> the three boundaries this leaf is about — **remount, navigate, restart**. Substitutions recorded in
> §0. That replay produced the headline, §7 D1–D6 and the two rows of §0's boundary matrix that
> reading had backwards.
>
> **No database was copied.** Nothing in this leaf lives in SQLite. **The live app was not touched.
> `cargo` was NOT run** — the one Rust file cited is a static read, and it turns out to matter (§12.6).
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent`** —
> all five present, all five opened. `personas-cloud` is **NOT-APPLICABLE** (0 `.tsx`, no React, no
> `localStorage`, no `useState` anywhere outside `node_modules`). Lineage checked **for this subject
> specifically** rather than inherited: `personas-web` is a port of this repo's *theme* layer and is
> **not** a port of its view-state layer (disjoint keys, disjoint filter shapes, a different
> persistence mechanism), so no port discount applies here. **Effective independent cohort: 4.**
>
> ### Sibling boundaries, settled in prose
>
> [**client-state-persistence**](./client-state-persistence.md) owns **where a value lives** — the
> `app_settings` registry, the vault, the backend-authority and mirror patterns, the 32 hand-rolled
> storage wrappers — and ships `raw-web-storage` (72/186). Its §2 explicitly hands this leaf the
> per-surface case (*"If it is per-surface view state (sort, widths, collapse, filters), it belongs in
> localStorage — go to view-state-persistence"*), and its §4 step 1 routes to this file. **This path
> does not re-derive any of that.** It owns the question that comes *after* the home is chosen: **how
> long the value lives, and what it means when it comes back.** §9 shows that the two do not even
> overlap mechanically — 0 of 20 neighbouring rules touch a single one of this rule's sites, and
> `raw-web-storage` **structurally cannot see** the largest durable view-state surface in the app.
>
> [**tab-strip**](./tab-strip.md) executed one tab round trip and found a half-typed draft destroyed
> while `scrollTop = 640` survived. **This path found that inversion's population** and its mechanism
> (§0). tab-strip owns the strip; this owns the lifetime of what the strip swaps.
>
> [**filtering-and-search**](./filtering-and-search.md) owns the filter bar, the facet counts and
> `isNarrowedFilters`. Its Gap 7 — *"No shared filter-persistence hook. 8 of 116 persist, each
> hand-rolling read/parse/validate/write… it has no primitive"* — is this leaf's subject, generalised
> here from filters to all nine view-state concerns.
>
> [**shared-fetch-cache**](./shared-fetch-cache.md) owns the module-scoped cache
> (`hand-rolled-module-cache`, 48/71). §0 reports the measured split: **80 of 81 module caches hold
> fetched DATA and 0 hold user VIEW state.**
>
> [**expandable-row**](./expandable-row.md) owns whether a disclosure control *declares* itself
> (`stateless-disclosure-control`, 56/59); this owns whether its open/closed set outlives the row.
> [**hmr-safe-singletons**](./hmr-safe-singletons.md) owns `globalThis` lifetime generally; §0 reports
> that **exactly one of the tree's `globalThis` keys is view state**.
> [**error-boundary**](./error-boundary.md) owns what a latched boundary does; §0 executes the crash
> that a persisted token *causes*, and hands the latch half back.
>
> The **Deviations** section is a note backlog, **NOT APPLIED** — the operator uses this app daily and
> every entry changes what the app remembers.

---

## 0. The headline, before anything else

**A view-state value's lifetime is a property of where it was convenient to declare it, and nothing
anywhere records which lifetime was intended. Executed, one round trip through one surface:**

```
the user types into a panel, scrolls the page, then switches view and comes back

  the half-typed text            -> GONE          (useState dies with the component)
  the fetch that was in flight   -> RE-ISSUED     (mounts 1->2, fetches 1->2)
  the scroll offset              -> 640, INTACT   (it lives on a DOM node ABOVE the swap)
```

**The thing the user made is the thing that dies; the thing nobody chose is the thing that lasts. That
is not a bug in one component — it is what happens by default, because the scroll offset's home is a
DOM node whose lifetime is decided by CSS layout and the draft's home is a component instance whose
lifetime is decided by a conditional. Neither was a decision. The population is 520 scroll containers
against 3 explicit resets, and 119 files holding user-typed text against 1 that keeps it.**

The repo owns the correct answer to the scroll half — `useScrollRestoration`, which keys the offset by
*view* rather than by *place* and jumps to the top for a key it has never seen. **It has 4 call sites
in 4,829 files, and it is the only implementation of scroll restoration in six repositories.**

### And the second headline, which is worse and which the census gates

**Anything that survives a restart was written by a previous version of the program — and this program
changes its view vocabularies constantly. 51 members have been removed from the 18 view-state unions in
`src/lib/types/types.ts`; 27 of those removals were from the 10 unions that are persisted across
restart. Five hand-written repair arms exist. Executed, the consequence is not a cosmetic reset:**

```
E6  SettingsPage.tsx:74  const Component = tabComponents[tab];  <Component/>
    settingsTab = "appearance"     -> renders Appearance
    settingsTab = "integrations"   -> CRASH: "Element type is invalid: … but got: undefined"

E7  nothing on the render path rewrites the value, so:
    boot 1: settingsTab = "integrations"   boot 2: "integrations"   boot 3: "integrations"
```

`SettingsTab` has lost two members for real — `quality-gates` (`dc07f1a46`, 2026-05-17) and `config`
(`8b75e71dc`, 2026-06-18) — and `settingsTab` is in `systemStore.ts`'s `partialize` whitelist
(`:82`). The identical construct one directory over is correct because it has four characters more:

```tsx
// TriggersPage.tsx:118   TAB_HEADERS[eventBusTab] ?? TAB_HEADERS['live-stream']
//   eventBusTab = "retired-tab"  ->  renders "Live stream"     ✔ executed
```

And the repo has already written the remedy down — **for exactly one field out of twenty-three**:

```ts
// systemStore.ts:144-161
// Guard against onboarding schema drift: if a persisted step id no longer exists
// in the current enum (app update renamed/removed a step), discard the stale value
// so the overlay doesn't render blank on resume. Log the mismatch …
Sentry.addBreadcrumb({ … message: 'Discarding unknown onboardingDismissedAtStep on hydrate' … });
state.onboardingDismissedAtStep = null;
```

### The boundary matrix — executed, not reasoned

Six homes, three boundaries, one host. `✔` survived, `✘` did not.

| home | example in this repo | **remount** | **navigate** | **restart** |
|---|---|:--:|:--:|:--:|
| `useState` | a filter, a sort, an expanded set, a draft | ✘ | ✘ | ✘ |
| store, **not** in `partialize` | `agentTab`, `devToolsTab`, `researchLabTab` | ✔ | ✔ | ✘ |
| store, **in** `partialize` | `settingsTab`, `monitorCollapsedGroups` | ✔ | ✔ | ✔ |
| `localStorage` | `table-sort:<id>`, `incidents:filters` | ✔ | ✔ | ✔ |
| `globalThis` | `__personasScrollPositions__` (**the only view-state key there**) | ✔ | ✔ | ✘ |
| module scope | 81 caches — **80 hold data, 0 hold view state** | ✔ | ✔ | ✘ |
| **the DOM node itself** | every `scrollTop` in 520 scroll containers | **✔ if the scroller is above the swap** | ✘ | ✘ |

```
E1  measured values across the three boundaries (one host, real zustand persist)
                                 acted    remount   navigate   restart
    useState filter              failed     all       all        all
    useState draft        half-typed…      (empty)   (empty)    (empty)
    store persisted (settingsTab) models   models    models     models
    store NOT persisted (agentTab)   lab      lab       lab     overview
    persisted collapse set  ["group-7"] ["group-7"] ["group-7"] ["group-7"]
    localStorage sort       created_at  created_at created_at created_at
    DOM scrollTop                  640      640         0          0
    mounts / fetches of the panel  1/1      2/2        3/3        4/4
```

The last row is the cost nobody sees: **each of the three boundaries is another full mount and another
fetch**, and only the one home that nobody wired (the module cache) would have absorbed it.

### The inversion, and the primitive that fixes it — both executed

```
E2 (a)  the app's dominant shape: scroll container ABOVE the swap, no key
        switch away and back  ->  draft = ""      scrollTop = 640     mounts 2 / fetches 2

E2 (b)  the SAME swap with useScrollRestoration keyed on the view
        move to a new filter context   -> scrollTop = 0      (a key never seen -> top)
        return to the old one          -> scrollTop = 640    (a key seen before -> restore)
        globalThis.__personasScrollPositions__ =
           [["sec=a|filter=all", 640], ["sec=a|filter=failed", 0]]
```

The hook's own docstring states the contract that makes (b) work — *"encode route + persona + tab +
**the filters that define 'where you are'**"* (`useScrollRestoration.ts:3-14`) — and **both** of its
real adopters honour it:

```
GlobalExecutionList.tsx:269  `overview/activity|status=${filter}|model=${modelFilter}|persona=${…}`
EventLogList.tsx:458         `overview/events|status=${statusFilter}|type=${typeFilter}|persona=${…}|trigger=${…}`
```

### Adoption of the view-state memories the repo already built

| memory | primitive | how it is turned on | adopted |
|---|---|---|---:|
| scroll offset | `useScrollRestoration` | `scrollRestoreKey` prop / hook arg | **4 of 4,829 files** |
| ↳ inside `<UnifiedTable>` | (already wired internally) | `scrollRestoreKey=` | **1 of 17 sites** |
| sort order + column widths | `readPersistedSort` + `useColumnWidths` | `tableId=` | **4 of 17 sites** |
| ↳ `<DataGrid>` | — | **the props do not exist** (`DataGrid.tsx:9-11` says so) | **0 of 6** |
| collapse of a section | `SectionCard` | `storageKey=` | **9 of 9 sites** |
| per-view density | `useDensity` | `viewKey` arg | **1 site** |
| stale-safe restore of anything | `usePersistedContext` | required `validate` + required `maxAge` | **2 sites** |
| the data behind the view | module-scope warm cache | hand-rolled per file | **80 sites** |

The two rows that matter are **9 of 9** and **4 of 17 / 1 of 17**. Same repo, same authors, same
month. §4 says what separates them and it is not the type.

### Substitutions in the replay, recorded

1. jsdom does not lay out, so `scrollHeight`/`clientHeight` are 0; the harness defines them on the
   scroll node with `Object.defineProperty`. `scrollTop` is a real jsdom property, read and written
   verbatim.
2. framer-motion, i18n, the icon set and Tauri IPC are not imported — none of them touches view state.
   Fetches are counted with a local counter instead of `invokeWithTimeout`.
3. In E6 the thirteen settings panels are stubs; **the dispatch is verbatim** — that is the whole
   experiment.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head is physically separated and each
clause carries its warrant. No file path, primitive name or count appears below this line until the
head ends.

> **P1 — physics, and the subject.** *View state always has a home, whether or not anyone chose one.*
> Text the user typed lives in the widget that holds it; a scroll offset lives on the element that
> scrolls; a selection lives in the nearest variable. Choosing not to decide is not neutral — it
> assigns the default home, and the default home has a lifetime.
>
> **P2 — physics, and the inversion this leaf exists for.** *The lifetime a value gets is decided by
> the layout, not by the value's worth.* Whatever lives on a container that sits above the thing being
> replaced survives the replacement; whatever lives below it dies. The scroll offset is usually above
> and the user's unsent text is usually below. So the least valuable state gets the longest life and
> the most valuable gets the shortest, reliably, and neither outcome was anyone's intent.
>
> **P3 — function.** *There are exactly three lifetimes and no default is right twice.* Until the next
> time this component is rebuilt; until the next time the app is closed; forever. Every piece of view
> state gets one of the three, so the only question is whether it was chosen. Write the choice down
> beside the value, because the code that reads it later cannot tell a decision from an accident.
>
> **P4 — physics, and the one to bet on.** *Anything that survives a restart was written by a previous
> version of the program.* Its vocabulary is whatever the program meant when it wrote it, and no type
> in the running build constrains a value the running build did not produce. A restored value is
> untrusted input from a stranger who used to be you.
>
> **P5 — physics, and the sharpest single rule here.** *Check a restored value against what exists
> now, not against what it looks like.* Shape checks — is it a string, is it an array, does it have
> this field — pass for every stale value, which is precisely the class they need to catch. The check
> that works is membership in a set the current build owns: an enum, a fetched list, a bounded range,
> an age.
>
> **P6 — code-quality.** *The place that declares a value durable is not the place that decides
> whether an unknown value is survivable.* One file says "remember this forever"; a different file,
> written by a different person, either falls back or crashes on it. Nothing links the two, so the
> blast radius of a durable declaration is invisible from the declaration.
>
> **P7 — ui, and the adoption law.** *A memory offered through an optional identity argument is a
> memory almost nobody gets.* Callers supply an argument whose name says what it *does* and skip one
> whose name says what it *is*, because only the first tells them what they are giving up. Name the
> parameter for its effect.
>
> **P8 — function.** *A restore key must name the view, not just the place.* Keyed only by location, a
> restored position is re-applied to a different result set the moment a filter changes — which is
> worse than starting at the top, because it looks deliberate.
>
> **P9 — code-quality.** *A migration written without a version is not a repair, it is a permanent
> rewrite rule.* It runs on every launch forever, it can never learn that its cause is gone, and the
> next person cannot tell which of its arms are still load-bearing.
>
> **P10 — ui.** *State the user authored and state the app inferred are different goods and must not
> share a policy.* Losing a sort order is a shrug; losing a paragraph is the reason someone stops
> trusting the application. Rank them before you decide what survives what.
>
> **P11 — ui, and the one that hides data.** *A restored narrowing must announce itself.* View state
> that removes rows and comes back silently is indistinguishable from an empty dataset, and the user
> has no memory of setting it. Restoring "what you were looking at" and restoring "what you were
> hiding" are different promises.
>
> **Scale condition.** P1, P3, P5 and P9 are correctness on the first surface. P2, P8 and P11 arrive on
> the **second** visit and are reported as bugs nobody can reproduce, because reproducing them requires
> leaving and coming back. P4 and P6 arrive on the **first release after** the one that shipped the
> value — the longest feedback loop in the whole corpus, and the reason this leaf's defects survive
> code review. P7 arrives on the second call site. P10 arrives the first time a user loses work.

### Warrant evidence — four independent siblings, censused

`personas-web` (Next 16, 597 `.tsx`), `brainiac` (Rust workspace + a Next 16 console, 140 `.tsx`),
`vibeman` (Next 16 + Tauri, 585 `.tsx`), `ascent` (Next 16 App Router, 336 `.tsx`).
**`personas-cloud` is NOT-APPLICABLE** — 0 `.tsx`, no React dependency, and a sweep for
`react|useState|zustand|localStorage` over its `src/**/*.ts` returns 0 matches in 0 files. **The
denominator for every clause below is 4.** Lineage was checked per-clause, not assumed: a negative
control over every distinctive identifier in this repo's view-state code
(`persona-ui-system`, `table-col-widths`, `__personasScrollPositions__`, `createDedupedJSONStorage`,
`isNarrowedFilters`, `OPEN_ONLY_FILTERS`, `useScrollRestoration`, `sidebar-collapsed`) returns **no
matches in any sibling**. `personas-web` **is** a port of this repo's theme layer (identical 11-member
`ThemeId` union in identical order, identical `theme-transitioning` class) and is **not** a port of its
view-state layer — disjoint keys (`incidents-filter-state` vs `incidents:filters`), disjoint filter
shapes (singular `status` off mock data vs the Rust-generated plural `statuses`), and a hand-rolled
`hydrate()`/`persist()` pair instead of zustand middleware. No discount applies for this subject.

- **P4 + P5 are PHYSICS, 4 of 4, unanimous.** Every applicable sibling independently discards or remaps
  a persisted value whose vocabulary has moved, and three of the four wrote down *why*:
  - `personas-web/…/useIncidentsFilterStore.ts:49-50` — *"Type-guard each field on load so a corrupt or
    stale payload can never land the store in an out-of-range filter."*
  - `personas-web/src/stores/dashboardFilterStore.ts:45-50` — a persisted `"custom"` range with no
    persisted bounds is coerced back to `"7d"` because it *"would silently widen the user's filter to
    all-time"*. That is the sharpest single sentence found in six repos on this subject and it is P11.
  - `brainiac console/…/CortexMap.tsx:51` — `if (initial && VIEWS.some(v => v.id === initial))`.
  - `ascent/src/lib/window.ts:39-44` — `parsePeriodCookie` returns null on an unknown range key.
  - Personas' own arm (`systemStore.ts:144-161`) is the **most complete in the cohort** — it discards,
    trims the neighbouring record of stale keys, *and* instruments the discard with a Sentry
    breadcrumb. It is also applied to **1 field of 23** (§9).
- **P9 is a SILENCE where Personas is BEHIND, and the fleet's answer exists.** Formal `version` +
  `migrate`: **1 of 4** (`vibeman`). And it is not a token effort — `vibeman/src/stores/utils/persistence.ts:99-155`
  is a house factory, `createPersistConfig(name, { category, partialize, ttl, version, migrate })`, with
  a four-value `PersistenceCategory` taxonomy (`user_preference | session_work | cache | volatile`), a
  written `PERSISTENCE_STRATEGY.md`, and **15 persisted stores** going through it — including
  `cliSessionStore.ts:418-489` at `version: 9` with a nine-step chained migration ladder.
  **Personas has the most persisted view state in the cohort and the only one of the two mechanisms
  that cannot say which schema generation a blob came from.** It pattern-matches legacy values forever
  instead, which is P9 stated as an invoice (§7 D7).
- **P2 / scroll restoration is a TOTAL SILENCE, 0 of 4, and Personas owns the fleet's only
  implementation.** `useScrollRestoration.ts` is the only save-and-restore of a scroll offset in six
  repositories. `history.scrollRestoration` appears in **0 of 5**. Every other `scrollTop` in the cohort
  is one of two other things: stick-to-bottom for a terminal or chat pane
  (`personas-web/…/TerminalSim.tsx:67`, `vibeman/…/CompactTerminal.tsx:238`), or a deliberate
  *reset* on content change (`vibeman/…/IdeaCard.tsx:47-53`, `// Reset scroll position when navigating
  to a new card`, keyed on `[idea.id]`). **Personas is ahead here and does not use its own answer.**
- **P10 / draft persistence is a TOTAL SILENCE, 0 of 4.** A cohort-wide sweep for
  `draft.{0,40}(localStorage|sessionStorage|autosave)` returns **7 hits, all in Personas**. IndexedDB or
  server autosave of an unsent draft: **0 of 5**. Personas is again ahead of the fleet and behind
  itself: **1 of its own 119 `<textarea>` files** keeps what was typed.
- **P7 / persisted panel width is a SILENCE, 1 of 4** (Personas). `react-resizable-panels` and its
  `autoSaveId` appear in **0 of 5** `package.json` files. `vibeman`'s `panelWidth` is *computed*
  (`Math.max(320, contentWidth + 48)`), not remembered.
- **P11 is PHYSICS on the affordance, 4 of 4 — every applicable repo can clear its filters — and
  Personas has the cohort's best form of it**: `incidentFilterDefaults.ts:18-34`'s `isNarrowedFilters`
  is a *shared predicate with a written rationale* (*"the default … is NOT narrowed, so reaching zero
  results there reads as a healthy 'all clear' rather than a no-match result"*), whereas the siblings
  each carry a local boolean or count. The runner-up is worth copying anyway:
  `brainiac/…/DisputeBench.tsx:180` suppresses the badge when `total === rows.length` — filters set but
  nothing actually filtered out. **Personas' predicate has exactly 1 consumer** (`IncidentsInbox.tsx:429`).
- **P3 / where view state lives is genuinely DIVERGENT, 4 answers in 4 repos, no shared instinct.**
  `ascent` puts it in the **URL** and says so (`TimeRangeSelector.tsx:3-6`: *"URL-as-state keeps the
  window shareable and survives a refresh"*), with **no state library at all**. `brainiac` is URL-first
  too (`?view=` + `history.replaceState`). `vibeman` is store-first, 15 persisted stores behind one
  factory. `personas-web` splits, 2 zustand `persist` plus 2 hand-rolled. **Personas has no router**, so
  the URL option does not exist for it at all — a fact [tab-strip](./tab-strip.md) §12.5 established
  independently and this sweep confirms. This is the clause the spine's `diverged` label is right
  about, and it is the *only* one (§12.5).
- **P6 has no external witness** — no sibling separates the durability declaration from the tolerance
  decision far enough to observe it, because no sibling has a 69-field whitelist. **House convention**,
  earned locally (§7 D2, D3).

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "remember the filter" · "it should come back where I left it" · "why did my sort reset?"
- "this table forgets my column widths" · "the sidebar re-opens collapsed every time"
- "keep the expanded rows open when I come back" · "don't scroll me to the top on every refresh"
- "I typed a paragraph, clicked another tab, and it was gone"
- "it opens filtered and I never set a filter" · "the list is empty but there is definitely data"
- "after the update it lands on a blank page every launch"
- **The "about to write X" test:** you are about to type `useState(() => localStorage.getItem(…))`,
  `JSON.parse(raw) as SomeViewState`, a new field in a `partialize` whitelist, `const STORAGE_KEY =
  '…'` next to a filter or a sort, `scrollTop`, or an `onRehydrateStorage` arm that rewrites one
  legacy value.

You are **not** in this situation when the value is a user *setting* rather than a view — a theme, a
language, an autonomy toggle, an API key. That is [client-state-persistence](./client-state-persistence.md),
the backend `app_settings` table is the authority, and a secret goes to the vault. **The discriminator
is whether losing it would be described as "it forgot where I was" (here) or "it forgot what I chose"
(there).** Nor when the value is a *draft of a saved entity* with a backend row behind it — that is
[entity-draft-editing](./entity-draft-editing.md) and [debounced-autosave](./debounced-autosave.md).
Nor when the question is which tab is selected *as a control problem*; that is
[tab-strip](./tab-strip.md), and this path owns only how long its answer lives.

---

## 2. The one way

**Decide the lifetime out loud before you decide the home, then pick the home that already has that
lifetime, and — if the value survives a restart — write the check that says what makes it still true.**
Concretely: ask *"if the user leaves and comes back, then closes the app and comes back, what should
still be here?"* and answer it in three tiers. Anything the user **authored** — an unsent message, a
half-written prompt, a filled-in form — gets the longest life you can give it and gets it keyed by the
entity it belongs to; copy `ConversationComposer.tsx:47-62`, which is the only surface in this repo
that does it and which removes its own key when the draft goes empty. Anything **positional** — a
scroll offset, a page — goes to `useScrollRestoration` with a key that interpolates the filters, not
just the route; copy `GlobalExecutionList.tsx:269`. Anything the app **inferred or the user merely
poked at** — sort, width, density, collapse, the selected tab — goes to the home whose lifetime you
want: `useState` if it should die with the panel, a `uiSlice` field if another surface must be able to
point at it (this app has no router, so the store is the entire address space), and `partialize` only
if it should outlive the process. **The moment you put a value in `partialize` or in `localStorage`
you have declared that a future build of this program will read something an older build wrote, so pair
the declaration with an arm that decides what an unrecognised value means** — a membership test against
the live enum (`isDensity`, `isGroupMode`), an existence test against the fetched list
(`workspaceStore.ts:57-61`), a range clamp (`TeamMemoryPanel.tsx:50-56`), or the whole contract at once
via `usePersistedContext`, whose `validate` and `maxAge` are both **required**. Prefer that hook: it is
the only signature in the repo you cannot use without deciding. Do not persist a dimension that is
guaranteed to go stale — `IncidentsInbox.tsx:47-52` drops an absolute `since` timestamp and a transient
`persona_id` on purpose and writes down why. And if what you restore **hides rows**, say so on screen:
reach for `isNarrowedFilters` so a filtered-to-zero view never masquerades as an empty database.

If you can only get one right: **the arm that handles an unrecognised value.** A forgotten sort order
costs a click. A remembered token that the current build has never heard of crashed a page in this
repo's own dispatch table on every launch until localStorage was cleared, and the union it came from
has lost two members for real.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`hooks/utility/interaction/useScrollRestoration.ts` — `useScrollRestoration(key, forwardRef?, {enabled?})`** | **The best view-state primitive in the repo and the only one of its kind in six repositories.** A `Map` on `globalThis` (`:36-42`) so offsets survive remount *and* HMR; the whole policy in one rule — *"genuinely new context (key never seen) → jump to the top; back / return (key seen before) → restore"* (`:3-14`); virtualization-aware, re-applying across a 40-frame budget while a virtual list grows (`:24-26,:98-119`); a `restoringRef` latch so synthetic scrolls are not recorded back (`:60-68`); a `useLayoutEffect` arm for a key change while the node stays mounted (`:141-148`); **a `clearScrollRestoration()` test hatch (`:176`)** — one of only two `globalThis` owners in the tree that has one; and 17 assertions in `__tests__/useScrollRestoration.test.ts`. **4 call sites — and only 3 of them ever receive a key**: two are inside shared components (`UnifiedTable.tsx:532`, `:738`, `GroupedVirtualList.tsx:148`) and go inert unless a caller opts in, which happens at `EventLogList.tsx:458` and `GlobalExecutionList.tsx:432`; the third is hard-coded at `TemplateVirtualList.tsx:88`. |
| **`hooks/utility/data/usePersistedContext.ts` — `usePersistedContext<T>({ key, maxAge, validate, getSavedAt, onRestore, enabled? })`** | **The type answer, already built.** `validate` and `maxAge` are **required, not optional**; a `validate` returning null `removeItem`s the key (`:59-62`), and an entry older than `maxAge` is removed too (`:65-69`). You cannot restore through this hook without having decided what makes the value still valid. **2 consumers** (`useCreateTemplateActions.ts:27`, `useN8nTransform.ts:108`). §4 argues this is the shape every restore in the repo should have. |
| **`hooks/utility/data/useDensity.ts` — `useDensity(viewKey)`** | The cleanest compliant restore in the tree, in three lines: `if (isDensity(raw)) return raw;` … `return DEFAULT_DENSITY` (`:12-17`). Plus a module-scope mirror keyed by view and a `useSyncExternalStore` subscription so two components sharing a `viewKey` stay in sync (`:60-65`). **1 consumer.** |
| **`shared/components/display/UnifiedTable.tsx` — `tableId` + `scrollRestoreKey`** | Persisted sort (`:44-61`, `:472-486`) and user-resizable, persisted column widths (`:487-488`) from one `tableId`; scroll restoration from `scrollRestoreKey` (`:532`, `:738`), documented with the key contract at `:146-153`. **4 of 17 sites pass `tableId`; 1 of 17 passes `scrollRestoreKey`.** |
| **`shared/components/display/ColumnResize.tsx` — `useColumnWidths(tableId)`** | Per-table px overrides under `table-col-widths:<tableId>`. Two details worth copying: it persists **only if a real drag occurred** (`:72` ignores sub-3px jitter, so a plain click never freezes a column), and `clearColumn` (`:90-98`) gives the user a way to *undo* the memory — the only view-state memory in the repo with a documented reset affordance. |
| **`shared/components/layout/SectionCard.tsx` — `<SectionCard collapsible storageKey=…>`** | Collapsed state persisted under a caller-named key, with a discriminated union that makes `storageKey` **unspellable** on the non-collapsible variant (`storageKey?: never`, `:52`). **9 of 9 collapsible sites pass it** — the best adoption of any opt-in memory here, and §4 says why. |
| **`overview/sub_incidents/libs/incidentFilterDefaults.ts` — `OPEN_ONLY_FILTERS` + `isNarrowedFilters()`** | The resting filter set and the narrowed predicate as **one shared thing**, so the inbox, the filter bar and the KPI header "can never silently diverge" (`:3-8`). This is P11's mechanism and the fleet's best form of it. Its docstring names three views it is shared by; **it has 1 consumer** (`IncidentsInbox.tsx:429`) — the filter bar and the KPI header each re-derive their own answer. |
| **`stores/systemStore.ts` `partialize` + `onRehydrateStorage`** | The durable home for a view choice that must outlive the process — 69 fields across 4 stores — and the one place a rehydrate repair can live. `:144-161` is the template: discard, trim the neighbouring record, breadcrumb the discard. |
| **`stores/util/dedupedStorage.ts` — `createDedupedJSONStorage()`** | Mandatory `storage:` for any `persist()`. Zustand re-runs `partialize` + `setItem` on **every** `set()`; without this a hot store issues ~1000 identical synchronous writes/sec. |

**The two sites to copy:**

| | |
| --- | --- |
| **`plugins/dev-tools/sub_workspaces/workspaceStore.ts:55-64`** | **The shortest correct restore of a remembered selection in the repo.** `workspaces.some(w => w.id === activeId) ? activeId : null` — with the failure mode named in the comment (*"A stale active id (workspace deleted elsewhere) must not strand the UI on a workspace that no longer exists"*), a fall-back to the **widest safe view** rather than to nothing, and a `removeItem` of the dead key on commit (`:69-70`). |
| **`studio/studioStore.ts:470-492`** | **The most complete one.** Restoring a set of open tabs: fetch the live list, index it, `if (!proj \|\| get().runtimes[id]) continue; // project deleted, or already open`, restore the active tab **only if it actually came back**, and on failure *"leave Studio blank rather than crash"*. Every clause of P4/P5 in twenty lines. |

**Do not exist — this path names them:**

- **Any shared filter/sort/collapse persistence hook.** [filtering-and-search](./filtering-and-search.md)
  Gap 7 measured 8 of 116 filter-holding files persisting anything, each hand-rolling
  read → parse → validate → write. Nothing has changed. `useScrollRestoration` is the model this hook
  should copy — including its "new key → top" rule, which is the filter case too.
- **Any way to say, at the declaration, what an unknown value means.** `partialize` takes a value; it
  cannot take a guard. The guard has to be written 60 lines away in a different callback, by hand, per
  field, and nothing checks that it was.
- **Any versioned persisted view state.** 1 of 7 stores has `version:`; **0 have `migrate:`**.
- **Any module-scoped cache of a *view*.** 81 module caches exist and **80 of them hold fetched data**;
  the loading doctrine's "keep the data warm across an unmount" was generalised to 14 named sites and
  "keep the *view* warm across an unmount" was generalised to zero.
- **Any reset affordance for a persisted memory**, except `ColumnResize.clearColumn`. There is no
  "forget what you remember about this view" anywhere.

---

## 4. Steps

1. **Name the lifetime before the home.** Say out loud which of the three it is: dies with the panel,
   dies with the process, survives forever. If you cannot say, the answer is "dies with the panel" —
   choose it deliberately rather than by omission.
2. **Rank it: authored or inferred (P10).** If the user typed it, it is authored, and it gets the
   longest lifetime you can give it plus a key that names the entity it belongs to
   (`ConversationComposer.tsx:47-62`). Everything else is negotiable.
3. **Pick the home whose lifetime already matches** — the matrix in §0 is the whole table. Do not build
   a lifetime out of a home that does not have it (a `useEffect` that copies `useState` into
   `localStorage` on every keystroke is a home with the wrong lifetime wearing a costume; the repo has
   one and it writes once per character).
4. **If the lifetime is "dies with the process", stop here.** A store field outside `partialize` is
   finished. Nothing below applies.
5. **If it survives a restart, write the arm now, in the same change.** Decide what an unrecognised
   value means, and prefer the strongest form available: `usePersistedContext` (validate + maxAge are
   required), then a membership test against the live enum (`isDensity`, `isGroupMode`), then an
   existence test against the fetched list (`workspaceStore.ts:57-61`), then a range clamp
   (`TeamMemoryPanel.tsx:50-56`). **A `typeof x === 'string'` or an `as SomeType` is not this step** —
   both pass for every stale value, which is the only class that matters (executed: E4).
6. **Do not persist a dimension that is certain to rot.** An absolute timestamp, a transient drill-in,
   a cursor. `IncidentsInbox.tsx:47-52` drops two of its five filter dimensions on purpose and states
   the reason above the function; do that.
7. **Compose the restore key out of the view, not the place (P8).** If it is positional, the key must
   carry the filters — `overview/activity|status=…|model=…|persona=…`. A key that names only the route
   restores yesterday's offset into today's result set.
8. **If the restored value can hide rows, surface it (P11).** `isNarrowedFilters` exists; use it, so a
   view filtered to zero never reads as an empty database.
9. **Give the memory a reset.** `clearColumn` is the only one in the repo. A memory the user cannot
   clear is a setting they never made.
10. **Ask the type question now, before §9** — see below.
11. **And then stop.** Whether the value belongs in `localStorage` at all versus the backend
    `app_settings` table is [client-state-persistence](./client-state-persistence.md); the ghost under
    the chrome while the restored view refetches is [`docs/design/overview-loading.md`](../../design/overview-loading.md);
    the strip that selects the view is [tab-strip](./tab-strip.md); the crash card the bad value
    produces is [error-boundary](./error-boundary.md).

### Can the type make the wrong call impossible? — asked before §9

**Partly, and the honest answer is the most interesting result in this document: for the restore path
YES and the repo has already built it; for the durable *declaration* NO, and the reason is a boundary
no type crosses.**

**The half a type reaches.** `usePersistedContext` is the correct signature and it exists:

```ts
// src/hooks/utility/data/usePersistedContext.ts:3-22 — both REQUIRED, neither optional
validate:   (parsed: T) => string | null;   // return null to discard (and it removeItem()s, :59-62)
getSavedAt: (parsed: T) => number | undefined;
maxAge:     number;                          // stale => removed, :65-69
```

You cannot obtain a restored value from it without having decided what makes the value still valid.
Compare its four sibling restores, all of which hand back whatever was on disk:
`readPersistedSort` (`UnifiedTable.tsx:44-61`, shape-checks only — executed defect E4),
`readPersistedViewState` (`useDrive.ts:36-44`, `return parsed as PersistedViewState`),
`loadPersistedFilters` (`IncidentsInbox.tsx:53-71`, guards two of five dimensions),
`readStorage` (`SectionCard.tsx:75-83`, a boolean, correct by coercion).
**Withholding scored 2/2; handing back scored 0/4** — the corpus's Q5 with a small but clean n.

Held against the seven qualifications:

- **Q1 — a required prop carries only what it encodes.** ⚠ and this is the limit.
  `validate: (p) => string | null` encodes *"the caller supplied a predicate"*, not *"the predicate
  consults the live vocabulary"*. A caller may write `validate: (p) => p.id ?? null`, which is a shape
  check wearing the right signature. The type forces the question and cannot force the answer.
- **Q2 — requiredness ≠ closedness.** ✔ and here requiredness is the whole win. There is no closed type
  for "a still-legal token" — the legal set is data, not a type.
- **Q3 — a type nobody constructs constrains nothing.** ⚠ **2 construction sites today** against ~25
  restore sites. This is the weakest qualification for this proposal, and it is also the finding:
  the good signature exists, is exported, is documented, and is used twice. Documentation asked and
  nobody came — the same fate as `segmentedTabPanelProps` one leaf over ([tab-strip](./tab-strip.md) §0).
- **Q4 — a type anyone can construct authenticates nothing.** ✔ See Q1. The escape hatch is a
  one-line lambda.
- **Q5 — withholding beats requiring.** ✔ and the in-repo controlled experiment is 2/2 vs 0/4 above.
- **Q6 — withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom is *reading the raw
  parsed blob*; `usePersistedContext` never hands it over un-validated, but does hand over the value
  through `onRestore` once it passes. Withholding the value entirely would break the feature.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.** ✔
  Nothing forces `UnifiedTable` to trust `{key: 'legacy_column'}`; the API simply never mentioned that
  it might be stale. **The construction to withhold is the un-validated read.**

**The half no type reaches — and it is a NEW entry for the doctrine's list.** The durable declaration
itself, `settingsTab: state.settingsTab`, cannot be typed into safety, and the reason is not any of the
four spatial cases:

> **The writer and the reader are different builds of the same program.** `SettingsTab` is a perfectly
> closed union in the build that reads the value, and it says nothing whatever about what the build
> that *wrote* it three releases ago considered legal. This is the doctrine's fifth case — the
> **temporal** boundary established by
> [`compile-time-env-embedding`](./compile-time-env-embedding.md) — arriving from the opposite
> direction: there, the other side of the boundary is gone *before* the question is asked; here, the
> other side of the boundary is a **past version of this same file**, and it is gone *after*. The
> discriminator the doctrine offers still applies and still explains the outcome: **the mechanism is
> allowed to fail silently.** `JSON.parse` of a stale blob is a legal value, so nothing errors. And the
> serialization case (#4) compounds it — the value crosses `JSON.stringify`/`JSON.parse` and re-enters
> as `unknown`, so even a same-build type never survives the trip.
>
> Measured: **51 members removed from 18 view-state unions across 156 revisions of one file; 27 of
> those removals in the 10 unions that are persisted.** `npx tsc --noEmit` was clean at every one of
> those commits.

**The one-edit version, if only one thing lands:** give `partialize` a sibling that takes the guard.
The declaration becomes the place the decision is recorded, which is P6's fix and would make §9's rule
unnecessary rather than merely satisfied:

```ts
// proposed, src/stores/util/durable.ts
/** Declare a field durable. The guard runs on rehydrate; returning undefined resets to the initial value. */
export function durable<T>(value: T, guard: (raw: unknown) => T | undefined): Durable<T>;

// systemStore.ts
partialize: (s) => ({
  settingsTab: durable(s.settingsTab, (v) => (isSettingsTab(v) ? v : undefined)),
  activeProjectId: durable(s.activeProjectId, (v) => (typeof v === 'string' ? v : undefined)),
  //                                              ^ still weak — see Q1. The list check belongs in
  //                                                fetchProjects, which is why §7 D3 is separate.
}),
```

Two honest deflations, recorded so it is not oversold: this is **necessary and not sufficient** (Q1 —
a guard that only shape-checks compiles fine), and the *entity-id* half of the problem (§7 D3) is not
solvable at the declaration at all, because the live list does not exist at rehydrate time. That is
why §9 gates the declaration and §7 D3 stays a separate note.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Putting a value in `partialize` or `localStorage` without an unrecognised-value arm** | You have promised a future build that whatever this build writes will still make sense. **Executed: an unrecognised `settingsTab` crashes `SettingsPage.tsx:74` with "Element type is invalid", on every launch, because nothing rewrites the value.** 19 of 23 durable name-shaped fields have no arm; 51 members have been removed from these vocabularies. |
| **`JSON.parse(raw) as SomeViewState`** | A cast is an assertion about a value written by a program you are no longer running. `useDrive.ts:41` and `UnifiedTable.tsx:44-61` both do it; **executed (E4): a persisted sort key naming a deleted column leaves the table unsorted, shows a sort indicator on a column that is not there, and is re-written to disk on every mount so it never self-heals.** |
| **A shape check standing in for a currency check** | `typeof p.key === 'string'` passes for every stale value ever written, which is the only class the check needed to catch. The check that works is `isDensity(raw)` / `workspaces.some(w => w.id === activeId)` / `n >= MIN && n <= MAX`. |
| **A scroll container above the thing being swapped, with no key** | **Executed: `scrollTop = 640` survived a switch that emptied the panel.** The user lands part-way down content they have never seen. **520 scroll containers; 3 explicit resets, one of which is inside the primitive.** |
| **Restoring a position with a key that names only the route** | The offset is re-applied to a different result set the moment a filter changes. The primitive's own docstring asks for the filters in the key; both real adopters comply, and there are two of them. |
| **User-typed text in bare `useState`** | It dies at the first boundary and the user finds out by losing a paragraph. **119 files hold text in a `<textarea>`; 58 of them have no other home for it at all — no backend door and no storage write.** |
| **A `useEffect` that writes the draft on every keystroke** | The right home with the wrong write policy — one synchronous `setItem` per character. `ConversationComposer.tsx:53-62`. Owned in detail by [client-state-persistence](./client-state-persistence.md); listed here because it is what "persist the draft" turns into when the lifetime is decided and the write policy is not. |
| **A persisted selection nobody reconciles with the live list** | **Executed (E3): `activeProjectId: 'proj-gone'` survives a restart, `fetchProjects` sets `projects` and nothing else, and every consumer then fetches goals, ideas, KPIs and contexts for an id that is not in the list.** The same slice's in-session `deleteProject` **does** clear it — the careful path and the careless one are eleven lines apart. |
| **A migration arm with no `version` to retire it against** | It is a permanent rewrite rule. `systemStore.ts:133-192` holds five, none versioned, and the file cannot tell you which are still load-bearing. One of the five now fires on a token the union has re-adopted (§7 D7). |
| **A collapse set persisted as ids, never pruned** | The set only grows, and a group that disappears and returns comes back **collapsed** — the user is hiding data they last chose to hide months ago. `monitorCollapsedGroups` (persisted), `incidents:collapsed-groups`, `collapsedSourceKinds`, `homeHiddenSections`. None prunes. |
| **A restored filter with no narrowing indicator** | Indistinguishable from an empty dataset, and the user has no memory of setting it. `isNarrowedFilters` exists and has 1 consumer. |
| **Turning a memory on with an optional identity argument** | Nobody passes it, because the name does not say what it buys. **`tableId` 4 of 17, `scrollRestoreKey` 1 of 17, `storageKey` 9 of 9.** |
| **Documenting a lifetime the code does not implement** | `uiSlice.ts:100-105` states `homeReleaseVersion` is *"Persisted to `sessionStorage` (`home-releases-selected-version`) for in-session continuity"*. **That key does not exist anywhere in 4,829 files, the field is not in `partialize`, and `sessionStorage` has 3 production call sites in the entire tree — all of them a quota fallback inside `crashPersistence.ts`.** The documented lifetime is wrong in both directions. |

---

## 6. Evidence

### 6.1 The controlled experiment on P7 — three opt-in memories, one repo, one month

```tsx
// SectionCard.tsx:42          storageKey?: string;
//   /** localStorage key to persist collapsed state. When omitted, state is ephemeral. */
//                                                                    9 of 9 sites pass it

// UnifiedTable.tsx:117-121    tableId?: string;
//   /** When set, columns become user-resizable and the layout is persisted to
//     * localStorage under this id. Omit for a fixed-width table. */
//                                                                    4 of 17 sites pass it

// UnifiedTable.tsx:146-153    scrollRestoreKey?: string;
//   /** …the vertical scroll offset is remembered across remounts / route / tab
//     * switches under this key… */
//                                                                    1 of 17 sites pass it
```

All three are optional strings on a shared component. All three turn on a persisted memory. The
adoption spread is **9/9 versus 4/17 versus 1/17**, and the difference is not the type — it is what the
parameter is *called*. `storageKey` names the effect and the doc sentence leads with the consequence
of omitting it (*"When omitted, state is ephemeral"*). `tableId` names an identity; a caller reading it
has to get to the second clause of the second line to learn that a table without one forgets its sort.
**Name the parameter for what the caller gives up.**

*(Deflation, per the doctrine's lineage rule applied intra-repo: 6 of the 9 `SectionCard` sites are in
one feature directory — `plugins/obsidian-brain/sub_{graph,setup,sync}` — so the compliant side is
closer to **3 independent authorings** than 9. The violating side is 13 independent files and carries
the weight.)*

### 6.2 The two sites to copy, side by side with what they are not

```ts
// workspaceStore.ts:55-64  — a remembered selection, reconciled
const activeId = localStorage.getItem(ACTIVE_KEY);
// A stale active id (workspace deleted elsewhere) must not strand the UI
// on a workspace that no longer exists.
return workspaces.some((w) => w.id === activeId) ? activeId : null;   // -> the WIDEST safe view

// devToolsProjectSlice.ts:98-105 — the same problem, in the same store, unreconciled
fetchProjects: async (status) => {
  const projects = await devApi.listProjects(status);
  set({ projects, projectsLoading: false, error: null });             // activeProjectId untouched
},
```

And the repo already knows, in writing, that the second one is a gap — in a comment above the
work-around that covers only one of its two triggers:

```ts
// useWorkspaceSwitch.ts:3-8
// The load-bearing part is the RE-VALIDATION: `activeProjectId` is persisted
// (systemStore partialize) and is never checked against the workspace, so
// switching workspaces while a foreign project stays active would leave every
// dev-tools surface acting on a project the user can no longer see.
```

That guard fires on a **workspace switch**. It does not fire on a **cold boot**, which is the trigger
E3 executed.

### 6.3 The discriminator for *which* durable fields got an arm, with the rival raced

Three hypotheses for why 4 of 23 durable name-shaped fields have a rehydrate arm and 19 do not.

| hypothesis | prediction | measured |
|---|---|---|
| **H1 — the field's vocabulary actually lost a member, and someone noticed** | armed ⟺ a removal shipped | **REFUTED, and this is the finding.** `SettingsTab` lost 2 members, `PluginTab` lost 4, `TwinTab` lost 1 — **7 removals across 3 fields with no arm.** `SidebarSection` lost 10 and got an arm for 1. Removals predict arms at **6 of 27**. |
| **H2 — importance: the field gates something structural** | armed ⟺ top-level nav | **REFUTED by its own best case.** `sidebarSection` (armed) and `settingsTab` (unarmed) are both top-level navigation, and it is the *unarmed* one whose consumer crashes on an unknown value; the armed one's consumer is a fall-through chain that degrades. |
| **H3 — the value moved rather than vanished, so someone had to write a redirect anyway** | armed ⟺ the surface was relocated | **SURVIVES, 5 of 5.** Every arm is a **remap**, never a discard, except the one that is a discard *and* is the only one carrying a Sentry breadcrumb. `goals → teams` (Goals consolidated under Teams), `prompt/connectors/health → design + designSubTab` (three tabs absorbed into the Design hub), `designSubTab: design → prompt`. In each case the author was already editing the migration because the feature had **moved and still existed**; nobody wrote an arm for a feature that simply **stopped existing**. |

H3 survives, and its consequence is the whole gate: **arms get written when the author has somewhere to
send the user, and skipped when the honest answer is "that is gone".** Deleting a tab is the cheaper
commit and it is the one that leaves a persisted token pointing at nothing. That is why the gate keys on
the declaration and not on the deletion — the deletion is where nobody is looking.

### 6.4 The two dispatch shapes, one line apart in consequence

```tsx
// SettingsPage.tsx:74,86-88          const Component = tabComponents[tab];  …  <Component/>
//   settingsTab = "integrations"  ->  CRASH, on every launch                        ✘ executed
// TriggersPage.tsx:118               TAB_HEADERS[eventBusTab] ?? TAB_HEADERS['live-stream']
//   eventBusTab = "retired-tab"   ->  renders "Live stream"                          ✔ executed
// PersonasPage.tsx:329-353           if (pluginTab === 'dev-tools') {…} … return renderSectionRoute('plugins')
//   pluginTab = "langfuse"        ->  falls through to the Browse grid               ✔ (static read)
```

Three dispatch shapes over three view tokens. The **persisted** one is the crashing one, and the
tolerance decision is 400 lines and one directory away from the durability decision. That is P6.

### 6.5 The server half nobody wired

```rust
// src-tauri/src/commands/infrastructure/dev_tools.rs:265-283  (static read; cargo was not run)
// ============ Active Project (in-memory session state) ============
static ACTIVE_PROJECT_ID: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn dev_tools_get_active_project(state) -> Result<Option<DevProject>, AppError> {
    match guard.as_deref() {
        Some(id) => match repo::get_project_by_id(&state.db, id) {
            Ok(p) => Ok(Some(p)),
            Err(_) => Ok(None),          // <- the existence check the frontend never performs
        },
        None => Ok(None),
    }
}
```

`dev_tools_get_active_project` **is** the reconciliation E3 found missing: it resolves the remembered id
against the live table and returns `None` when the row is gone. Its frontend door exists
(`src/api/devTools/devTools.ts:148-149`, `getActiveProject`) and has **zero call sites**. Meanwhile the
two halves disagree by construction: the Rust side is an in-memory `static` that resets to `None` on
every launch; the frontend side is in `partialize` and survives. **On every restart the backend has
forgotten and the frontend has not, and the frontend's value is the one all 46 production files outside the store read.**

---

## 7. Deviations

**Not applied.** Every entry changes what the app remembers in a build the operator uses daily.

**D1 — the inversion, and its population. Executed.** A view swap under a shared scroll container
destroys the panel's `useState` (a half-typed draft came back empty) and re-issues its fetch, while
`scrollTop = 640` survives untouched. **520 scroll-container class occurrences; 3 explicit scroll
resets in the whole tree (`OrbQuickInputBar.tsx:55`, `useDeckDialog.tsx:112`, and one inside
`useScrollRestoration.ts:95` itself); 4 uses of the restoration primitive.** *Fix (note only):* pass
`scrollRestoreKey` on the virtualized tables that already accept it, and elsewhere either move
`overflow-y-auto` inside the region that gets replaced, so the offset dies with the content, or reset it
in the handler that changes the view.

**D2 — 19 of 23 durable name-shaped view tokens have no unrecognised-value arm.** The §9 rule's exact
population. `activeProjectId`, `fleetActiveSessionId`, `homeTab`, `cloudTab`, `settingsTab`,
`pluginTab`, `artistTab`, `obsidianBrainTab`, `twinTab`, `companionPluginTab`, `companionSttModelId`,
`companionKokoroVoiceId`, `companionPocketVoiceId`, `disabledStationIds`, `collapsedSourceKinds`,
`monitorCollapsedGroups`, `homeHiddenSections` (`systemStore.ts`), `selectedPersonaId`,
`activeChatSessionId` (`agentStore.ts:42-43`). The four that do: `sidebarSection` (`:59`), `editorTab`
(`:79`), `designSubTab` (`:80`), `onboardingDismissedAtStep` (`:84`). **`settingsTab` is the one whose
consumer crashes (E6) and its union has really lost two members** (`quality-gates` `dc07f1a46`;
`config` `8b75e71dc`). *Fix:* §4's `durable(value, guard)`, or one arm per field copying `:148-161`.

**D3 — a persisted selection is never reconciled at cold boot, and the backend door that would do it has
zero callers. Executed.** `activeProjectId` restores from localStorage; `fetchProjects`
(`devToolsProjectSlice.ts:98-105`) sets `projects` and nothing else; **46 production files outside `src/stores/` read `activeProjectId`** and then act on a ghost id
— `ContextMapPage.tsx:180-185` alone fires `fetchGoals` / `fetchIdeas` / `fetchKpis` against it. The
same slice's `deleteProject` (`:162-172`) *does* null it, so the in-session path is careful and the
cross-session path is not. `useWorkspaceSwitch.ts:3-8` documents the gap and covers only the
workspace-switch trigger. `getActiveProject` (`api/devTools/devTools.ts:148`) wraps a Rust command that
performs exactly this check (§6.5) and is imported by nothing. *Fix:* reconcile inside `fetchProjects`,
the way `workspaceStore.ts:57-61` does; or call the existing door.

**D4 — a persisted sort key that names a deleted column disables sorting silently and never
self-heals. Executed.** `readPersistedSort` (`UnifiedTable.tsx:44-61`) shape-checks and returns;
`sortedData` (`:497-513`) does `columns.find(c => c.key === sortKey)` and `if (!col) return data`. The
header renders a sort on a column that is not there, the rows are in data order, and the effect at
`:478-486` **re-writes the stale key to localStorage on every mount**. Affects the 4 tables that pass
`tableId`. *Fix:* validate `persistedSort.key` against `columns` in the `useMemo` at `:474` and drop it
if absent.

**D5 — 58 of 119 `<textarea>` files have no home for the text at all.** 130 `<textarea>` sites in 119
files; 59 files reach a backend door with the content; **2 write it to web storage** and only one of
those is a draft key (`ConversationComposer.tsx:57`). The remaining 58 hold user-typed prose in
`useState` and lose it at the first boundary. 89 `useState` bindings named for authored prose
(`draft`, `message`, `note`, `prompt`, `description`, …) sit in 86 files. **This is the fleet's best
score and it is 1 of 119** — 0 of 4 sibling repos persists a draft at all. *Fix (per surface, not a
sweep):* the composers whose text is expensive to retype get the `ConversationComposer` treatment,
keyed by entity, with the empty-value `removeItem`; the rest should at least be listed.

**D6 — the two declarations of the channel-draft key have drifted apart in ownership.**
`useTeamChannel.ts:26` **exports** `CHANNEL_DRAFT_PREFIX` and reads the keyspace to answer
`hasUnsentDraft(teamId)` (`:29-36`); `ConversationComposer.tsx:29` declares its own private
`DRAFT_PREFIX` with the same literal instead of importing it. The repo's only cross-surface view-state
contract — "does this team have unsent text?" — is held together by two string literals matching.
Catalogued as a *key* problem by [client-state-persistence](./client-state-persistence.md); listed here
because of what it *is*: the one place a view-state memory is read by a surface other than the one that
wrote it, and it has no shared declaration. *Fix:* import the exported constant.

**D7 — five unversioned migration arms, one of which has outlived its cause.**
`systemStore.ts:133-192` carries five rewrite rules and the config has **no `version:` and no
`migrate:`** — so no arm can ever be retired and nothing records which are still needed. Four are
currently correct (`goals`, `prompt`, `connectors`, `health` are all absent from today's unions). The
fifth, `:183-186`, rewrites `editorTab === 'use-cases'` → `{editorTab:'design', designSubTab:'use-cases'}`
— and **`'use-cases'` is a legal member of `EditorTab` today** (`types.ts:416`). It is unreachable in
practice only because `setEditorTab` (`uiSlice.ts:510`) performs the *same* rewrite before the value can
be stored, so two independent guards now rewrite a value the type still declares legal and nothing says
which is authoritative. **1 of 7 stores has `version:`; 0 have `migrate:`.** The fleet's answer exists
next door: `vibeman/src/stores/utils/persistence.ts:99-155`. *Fix:* add `version` + `migrate` to
`systemStore`, move the five arms into the migration, and drop `'use-cases'` from `EditorTab` or delete
the arm.

**D8 — two stores persist their entire state because they have no `partialize`.**
`themeStore.ts:355-385` (every appearance field, plus whatever is added next) and
`studioHistory.ts:43-63` (`byProject` — a per-project message history — plus `openTabIds` and
`activeTabId`). `studioHistory` is the only store whose *view* state is a set of entity ids **and**
whose consumer reconciles them properly (`studioStore.ts:470-492` — the §3 exemplar); `byProject`
itself is keyed by project id and **nothing ever prunes an entry for a deleted project**. *Fix:* add
`partialize` to both; prune `byProject` in the same pass that reconciles `openTabIds`.

**D9 — four persisted collapse/hide sets grow without bound and none prunes.**
`monitorCollapsedGroups` and `homeHiddenSections` and `collapsedSourceKinds` (all in `partialize`) and
`incidents:collapsed-groups` (`IncidentsInbox.tsx:31`, written at `:207`). Each is a set of ids that is
only ever added to. Two consequences: the array grows forever, and — the one that matters — **a group
that disappears and later returns comes back collapsed**, hiding rows the user last chose to hide
months ago with no indication that a choice is in force. *Fix:* intersect the persisted set with the
ids actually present on each render, and write the intersection back.

**D10 — `useDrive.ts:36-44` casts its restored view state.** `return parsed as PersistedViewState`
over `{viewMode?, sortKey?, sortDir?}`, under the key literally named `drive.viewState`. The comment
above it states the right intent — *"Single JSON blob so writes are atomic and the shape can grow
without breaking older clients"* (`:26-28`) — and the cast is what stops it being true in the other
direction: an older client's `viewMode` value that this build has retired flows straight into state.
*Fix:* three membership checks, the shape of `useDensity.ts:12-17`.

**D11 — a documented lifetime that does not exist.** `uiSlice.ts:100-105` says `homeReleaseVersion` is
*"Persisted to `sessionStorage` (`home-releases-selected-version`) for in-session continuity"*. That
key appears **nowhere** in 4,829 files; the field is **not** in `partialize`; and `sessionStorage` has
**3 production call sites in the entire tree**, all inside `crashPersistence.ts` as a quota fallback.
*Fix:* delete the sentence or implement it — but note that the field's real behaviour (store-held,
not persisted) is a legitimate third answer and is probably the one that was wanted.

**D12 — `useScrollRestoration.ts:36-37` cites two singletons that do not exist.** *"on globalThis so
they also survive Vite HMR (mirrors the executionBuffers / eventBus singletons)"*. `executionBuffers`
exists nowhere in the tree except this comment and three siblings; `eventBus` is really
`globalThis.__personasEventBridge` (`lib/eventBridge.ts:142`). Already catalogued in `.claude/CLAUDE.md`
and owned by [hmr-safe-singletons](./hmr-safe-singletons.md); listed here only because the file is this
leaf's best primitive and a reader arriving at it is sent to two dead ends. *Fix:* comment only.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`partialize` cannot carry a guard, and that is upstream of D2, D4, D8 and D10.** Zustand's
   whitelist takes values, so the durability decision and the still-valid decision are structurally
   forced into different callbacks. Every one of this leaf's largest findings is downstream of that one
   API shape. §4's `durable(value, guard)` is the closing move and it does not exist.
2. **No type can constrain a value a previous build wrote** (§4). This is not a repo limitation; it is
   the boundary. The only instruments are a runtime guard and a version.
3. **There is no shared restore-with-validation helper for the non-hook case.** `usePersistedContext`
   is a React hook, so the ~10 module-scope loaders (`loadPersistedFilters`, `readPersistedSort`,
   `readPersistedViewState`, `readActiveId`, `loadFromStorage`, …) cannot use it and each re-derives
   read → parse → validate → default by hand. `filtering-and-search` Gap 7 measured the filter slice of
   this at 8 of 116; this path measures the whole of it.
4. **`useScrollRestoration` has no way to require a well-formed key.** `key: string | undefined` accepts
   `'my-list'` as readily as the filter-interpolated form its own docstring mandates. Both real adopters
   happen to be correct; nothing would notice if the third were not. It also cannot know when a *result
   set* has changed under a stable key — the caller must encode that, which is P8 as a manual duty.
5. **No view-state memory except `ColumnResize.clearColumn` can be reset by the user**, and there is no
   global "forget what you remember about this view". A memory that cannot be cleared is a setting the
   user never made — which is exactly how a stale filter becomes indistinguishable from missing data.
6. **`DataGrid` has none of these capabilities and says so** (`DataGrid.tsx:9-11`: *"lacks:
   virtualization, `groupBy`, column resize, sort persistence, keyboard row nav, scroll restoration and
   infinite scroll"*). Its 6 call sites cannot opt in to a memory at all; the fix for those is a
   migration to `UnifiedTable`, which is a different and larger job.
7. **The census cannot see D1, D3, D5, D9 or D11.** They are runtime interactions between files, or
   absences — a reconciliation that does not exist, a prune that was never written, a key that is
   documented and unimplemented. §9 says what to build for each instead.

---

## 9. The missing gate

**The condition, stated stack-free:** *a value is declared to outlive the process, and nothing anywhere
decides what it means when a future build of the program reads a value that build has never heard of.*

### Existing rules checked first, by reading each definition rather than its title

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| **`raw-web-storage`** (72/186, `client-state-persistence`) | every `localStorage` / `sessionStorage` identifier in `src/**` | **The nearest neighbour by subject and it is structurally blind to this condition.** Its anchor is the identifier; **5 of this repo's 7 `persist()` stores contain the token zero times** (`systemStore.ts` 0, `themeStore.ts` 0, `agentStore.ts` 0, `companionStore.ts` 0, `powerMovesStore.ts` 0), because they reach storage through `createDedupedJSONStorage()`. So the **largest durable view-state surface in the application — a 64-field whitelist — is invisible to the corpus's persistence rule.** Site overlap with mine: **0**. |
| `unreconciled-selection-set` (9/15, `bulk-selection-actions`) | a component-scoped multi-item `Set` handed to an action un-reconciled | Nearest in *spirit* — a selection that no longer matches reality. But its anchor is `useState<Set<…>>` inside a component and its lifetime is one render pass; mine is a store field that outlives the process. **Overlap 0.** |
| `module-scope-install-latch` (13/13, `hmr-safe-singletons`) | a module-scope `let x = false` one-way latch | Owns `globalThis`/module lifetime generally. Exactly one `globalThis` key in the tree is view state and it is not a latch. **Overlap 0.** |
| `hand-rolled-module-cache` (48/71, `shared-fetch-cache`) | a hand-rolled cache container | Owns the 80 caches that hold *data*. Cannot see that 0 hold *view*. **Overlap 0.** |
| `stateless-disclosure-control` (56/59, `expandable-row`) | a toggle with no `aria-expanded` | Whether a disclosure declares itself, not whether its open set outlives the row. **Overlap 0.** |
| `call-site-text-match` (56/121, `filtering-and-search`) | `.toLowerCase().includes(` | The filter's matching policy, not its lifetime. **Overlap 0.** |
| `unnamed-cast-at-navigation-door` (9/20, `cross-surface-deep-link`) | `set*Tab(x as never / as unknown)` | The closest by *vocabulary* — it also fires on `set*Tab`. But it gates a cast at a **navigation call site**; mine gates a **durability declaration**, and the two never co-occur. **Overlap 0 sites, 0 files.** |
| `unflushable-debounced-write` (7/9, `debounced-autosave`) | a `setTimeout` reaching a durable write | The write's *timing*; mine is the value's *validity*. **Overlap 0.** |
| `shallow-wrapped-property-selector` (10/14) · `hand-rolled-stale-token` (36/42) · `unresettable-error-boundary` (16/25) · `tabstrip-with-no-declared-panel` (27/30) · `hand-rolled-spinner` (182/248) · `frozen-ui-copy-constant` (62/818) · `unverified-effect-dispatch` (60/162) · `optional-store-handle` (5/17) · `empty-sample-as-confident-zero` (16/34) · `bindingless-catch-on-io` (84/122) · `typo-token-overpainted` (824/2005) · `untyped-command-payload` (40/104) | store selectors · latest-wins tokens · boundary resets · tab strips · spinners · frozen copy · effect dispatch · store handles · empty samples · catch bindings · tokens · IPC payloads | **Overlap 0 sites and 0 files each**, measured by running all twenty side by side against my final pattern in one composer-private registry, using the census's own `scanRule`. |

**None of the 157 existing rules keys on a durable declaration. Proposing one.**

### Measurement

**Precision 19/19 violating and 4/4 compliant, hand-read, and the two partition the population
exactly.** The population is every `partialize` entry in the tree whose field name ends in one of the
eight suffixes derived below: **23**. The gate matches **19**, the control matches **4**, and
**19 + 4 = 23** with no residue, so every anchor is classified and there is no unexamined third set.

**The suffix vocabulary was derived from the tree, not imagined** — per the doctrine's warning that a
guessed word list distorts both ends of a measurement at once. It is exactly the shape of the fields
this repo has *already been forced to repair* (`sidebarSection`, `editorTab`, `designSubTab`,
`onboardingDismissedAtStep`) plus the shape of the two defects this document executed
(`activeProjectId`, `settingsTab`): **`Id`, `Ids`, `Tab`, `Section`, `Sections`, `Step`, `Groups`,
`Kinds`** — names for a token whose legal set is defined somewhere else. Deliberately **excluded**:
`Mode`, because in this tree it names booleans (`companionDevMode`, `companionAutonomousMode`) as often
as tokens, and a rule that fired on those would be a gate firing on correct content. That exclusion
costs one true positive (`agentStore`'s `chatMode`, which is in fact *armed*, via `merge:` at `:47-52`).

**Two independent implementations, and they agree exactly.** The census regex, and a second scanner
that shares no pattern with it: it brace-matches each `persist(` config, reads the `partialize` block
structurally, and asks whether each field is assigned anywhere on the config's repair path. Both return
**19 violating / 4 compliant** with the **identical `file:line` list**, and the second additionally
reconciles the denominators independently: **7 `persist()` stores, 69 `partialize` fields, 23 matching
the vocabulary.**

The 19 were all opened and read. They fall into three classes and the rule accepts a fix for all three:

- **the value drives a dispatch table with no fallback** — `settingsTab` (`systemStore.ts:82`).
  **Executed: an unrecognised value crashes `SettingsPage.tsx:74` on every launch.** The union has lost
  two members for real.
- **the value is an entity id nothing reconciles** — `activeProjectId` (`:63`),
  `fleetActiveSessionId` (`:71`), `selectedPersonaId` / `activeChatSessionId`
  (`agentStore.ts:42-43`). **Executed (E3):** restores as a ghost, and `activeProjectId` is read by **46 production files outside `src/stores/`**. The
  declaration-side fix is necessary and not sufficient here — §7 D3 is the other half.
- **the value is a set of ids that only grows** — `monitorCollapsedGroups` (`:129`),
  `homeHiddenSections` (`:131`), `collapsedSourceKinds` (`:127`), `disabledStationIds` (`:125`).
  A returning group comes back collapsed (§7 D9).

**The four compliant sites are this document's argument stated as a count**, and they are not merely
compliant — they are the repo's own history of this failure: `sidebarSection` (`:59`, `goals → teams`),
`editorTab` (`:79`) and `designSubTab` (`:80`) (four tabs absorbed into the Design hub), and
`onboardingDismissedAtStep` (`:84`, the only *discard* and the only one with a Sentry breadcrumb).
**Every arm that exists was written after a surface moved; not one was written after a surface was
deleted** (§6.3, H3 survives 5/5) — which is why the deletion case is the one that ships broken.

**Backtracking:** one negative lookahead containing `[\s\S]*`, evaluated once per anchor, never nested;
anchors are rare (23 in 4,829 files). Full run of both rules over the tree: **1.4 s** including node
startup.

**Fault-injected six ways, all six fire** (`census FAILED`, exit 1): floor raised to 99999 →
*"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; pattern replaced with a non-matching literal →
structural zero-file failure; baseline lowered to 1/2 → rise; baseline raised to 9/90 → silent drop; a
`baseline` added to the control → *"a positive control must NOT carry a baseline"*, rejected before any
file is walked; a stale `exclude` path → *"the exemption is stale"*. The honest baseline (2/19) passes
`--check` cleanly.

**Validated standalone** in a composer-private registry
(`registry-view-state-persistence-composer.json` — a filename unique to this composer, because sibling
composers share the scratchpad directory and have overwritten each other's files), then **re-extracted
from this finished document and re-run: `files 2 / matches 19` and `files 1 / matches 4`, identical
both times. The full registry was NOT run**, per the doctrine.

**Where it runs.** `npm run census` / `npm run census:check` — inside `npm run check` and, more
importantly, in the **`golden-path-census` pre-push job** (`lefthook.yml`). Deliberately **not**
`ci.yml`, which is currently red on 10 pre-existing failures; a gate that only runs in CI runs nowhere.
This condition also **cannot** be an ESLint rule at warn level and mean anything: `npm run check`
passes no `--max-warnings` and the pre-commit hook passes `--quiet`, so a warn-level rule enforces
nothing at either gate by construction.

### The rule

```json
{
  "rules": [
    {
      "id": "durable-view-token-with-no-rehydrate-arm",
      "goldenPath": "docs/concepts/golden-paths/view-state-persistence.md",
      "title": "A view-state token is declared durable and nothing decides what happens when its vocabulary moves on",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "^[ \\t]{4,}([A-Za-z0-9_$]*(?:Id|Ids|Tab|Section|Sections|Step|Groups|Kinds))\\s*:\\s*state\\s*\\.\\s*\\1\\s*,(?![\\s\\S]*\\b\\1\\s*=[^=>])",
        "flags": "gm",
        "ignoreCommentLines": true,
        "description": "An own-line entry in a zustand persist() partialize whitelist — `<field>: state.<field>,` — whose field name ends in Id/Ids/Tab/Section/Sections/Step/Groups/Kinds (a token whose legal set is defined somewhere else), where nothing later in the same file ever ASSIGNS that field (`<field> =`). The assignment is this repo's only repair idiom: onRehydrateStorage arms write `state.<field> = <replacement>` and agentStore's merge writes `const <field> = …`. PROXY FOR the stack-free condition: a value is declared to outlive the process, and nothing anywhere decides what it means when a FUTURE BUILD of the program reads a value that build has never heard of. WHY THIS IS NOT HYPOTHETICAL, MEASURED BY REPLAYING ALL 156 REVISIONS OF src/lib/types/types.ts: 51 members have been REMOVED from the 18 view-state unions in that file, and 27 of those removals were from the 10 unions that are persisted across restart — SettingsTab lost 'quality-gates' (dc07f1a46, 2026-05-17) and 'config' (8b75e71dc, 2026-06-18); PluginTab lost 'doc-signing', 'ocr', 'fleet' and 'langfuse'; TwinTab lost 'voice'; SidebarSection lost 10; EditorTab lost 9. npx tsc --noEmit was clean at every one of those commits, because no type in the reading build constrains a value the WRITING build produced — the writer and the reader are different builds of the same program, which is the doctrine's TEMPORAL boundary (compile-time-env-embedding) arriving from the opposite direction, compounded by the serialization boundary (the value re-enters through JSON.parse as unknown). WHAT THE MATCH COSTS, EXECUTED rather than reasoned: SettingsPage.tsx's dispatch (`const Component = tabComponents[tab]` at :74, rendered at :86-88) was transcribed verbatim into jsdom 29.1.1 + React 19.2.6 with the 13 panels stubbed. settingsTab='appearance' renders; settingsTab='integrations' throws 'Element type is invalid: expected a string … but got: undefined' into the error boundary — and NOTHING on the render path rewrites the value, so localStorage still holds it on boot 2 and boot 3. The identical construct one directory over is correct because it has four characters more: TriggersPage.tsx:118 does `TAB_HEADERS[eventBusTab] ?? TAB_HEADERS['live-stream']` and renders 'Live stream' for a retired token (also executed). Separately, systemStore's real partialize + onRehydrateStorage were transcribed with real zustand 5.0.14 persist: activeProjectId='proj-gone' survives a restart, devToolsProjectSlice.fetchProjects (:98-105) sets `projects` and nothing else, and the 46 production files outside src/stores/ that read activeProjectId then act on an id that is not in the list — while the SAME slice's in-session deleteProject (:168) nulls it correctly, eleven lines away. MEASURED 2026-08-17 at df634c53c: 19 matches across 2 of 4829 .ts/.tsx files, ALL NINETEEN OPENED AND READ (precision 19/19). POPULATION AND PARTITION: 7 persist() stores hold 69 partialize entries; 23 of those names end in the eight suffixes; the gate matches 19 and the control matches 4, and 19 + 4 = 23 exactly, so every anchor is classified and there is no unexamined third population. THE VOCABULARY WAS DERIVED FROM THE TREE, NOT IMAGINED, per the doctrine's warning that a guessed word list distorts both ends of a measurement: the eight suffixes are exactly the shape of the four fields this repo was already forced to repair (sidebarSection, editorTab, designSubTab, onboardingDismissedAtStep) plus the two whose failure this document executed (activeProjectId, settingsTab). 'Mode' is DELIBERATELY EXCLUDED because in this tree it names booleans (companionDevMode, companionAutonomousMode) as often as tokens and would make the gate fire on correct content; that exclusion costs one true positive, agentStore's chatMode, which is in fact armed via merge: at :47-52. THE VIOLATING 19 FALL INTO THREE CLASSES, ALL of which the rule accepts a fix for: (1) the value drives a dispatch table with no fallback — settingsTab (systemStore.ts:82), the executed crash above; (2) the value is an entity id nothing reconciles at cold boot — activeProjectId (:63), fleetActiveSessionId (:71), selectedPersonaId and activeChatSessionId (agentStore.ts:42-43); note the declaration-side fix is NECESSARY AND NOT SUFFICIENT here, because the live list does not exist at rehydrate time, which is why the golden path carries that half as a separate deviation; (3) the value is a set of ids that only ever grows — monitorCollapsedGroups (:129), homeHiddenSections (:131), collapsedSourceKinds (:127), disabledStationIds (:125), where a group that disappears and returns comes back COLLAPSED, hiding rows the user last chose to hide months ago. THE FOUR COMPLIANT SITES ARE THE REPO'S OWN HISTORY OF THIS FAILURE AND THAT COMPOSITION IS ITSELF THE FINDING: sidebarSection (:59, 'goals' -> 'teams'), editorTab (:79) and designSubTab (:80) (four tabs absorbed into the Design hub), and onboardingDismissedAtStep (:84) — the ONLY discard rather than remap, and the only one instrumented, with a Sentry breadcrumb reading 'Discarding unknown onboardingDismissedAtStep on hydrate' and a comment naming the failure ('if a persisted step id no longer exists in the current enum … discard the stale value so the overlay doesn't render blank on resume'). THE DISCRIMINATOR WAS RACED AGAINST ITS RIVALS: 'armed because the vocabulary lost a member' is REFUTED (removals predict arms at 6 of 27; SettingsTab lost 2, PluginTab 4, TwinTab 1, none armed); 'armed because the field is structurally important' is REFUTED by its own best case (sidebarSection armed and settingsTab not, both top-level navigation, and it is the unarmed one whose consumer crashes); 'armed because the surface MOVED rather than vanished' SURVIVES 5 of 5 — every arm is a redirect written while the author was already relocating a feature, and nobody has ever written one for a feature that simply stopped existing. That is why the gate keys on the declaration and not on the deletion: the deletion is where nobody is looking. DOES NOT OVERLAP its twenty nearest neighbours — measured, not assumed, by running all twenty against this final pattern with the census's own scanRule in one composer-private registry: ZERO shared sites and ZERO shared files for raw-web-storage, unreconciled-selection-set, module-scope-install-latch, hand-rolled-module-cache, stateless-disclosure-control, call-site-text-match, shallow-wrapped-property-selector, unnamed-cast-at-navigation-door, tabstrip-with-no-declared-panel, hand-rolled-stale-token, unflushable-debounced-write, unresettable-error-boundary, hand-rolled-spinner, frozen-ui-copy-constant, unverified-effect-dispatch, optional-store-handle, empty-sample-as-confident-zero, bindingless-catch-on-io, typo-token-overpainted and untyped-command-payload. THE RAW-WEB-STORAGE RESULT IS THE IMPORTANT ONE AND IT IS STRUCTURAL, NOT LUCKY: that rule anchors on the localStorage/sessionStorage identifier, and 5 of this repo's 7 persist() stores contain the token ZERO times because they reach storage through createDedupedJSONStorage() — so the single largest durable view-state surface in the application, a 64-field whitelist, is invisible to the corpus's existing persistence rule. KNOWN RECALL LIMITS, STATED BECAUSE THEY ARE REAL: (a) the suffix list misses ~10 further name-shaped persisted fields — artistFolder, obsidianVaultPath, fleetTerminalTheme, companionSttEngine, companionVoiceEngine, companionSidePanelSlot, setupRole, setupTool, setupGoal, whatsNewSeenVersion, monitorGroupBy — each excluded to keep precision defensible; (b) the lookahead is DIRECTIONAL, so a repair written ABOVE the partialize block would be missed — all five repairs in this tree are written below it, and the alternative (a whole-content lookahead anchored at index 0) reports every match at line 1, throwing away the file:line a reader acts on, so a bounded false negative was preferred; (c) two stores have NO partialize at all (themeStore.ts, studioHistory.ts) and persist their entire state, so their durable fields have no anchor here and are carried as a deviation instead; (d) the own-line anchor `^[ \\t]{4,}` is a PRECONDITION OF THIS REPO'S PRETTIER CONFIG, which gives each object entry its own line — it is what removes the one-line reducer false positive (pairingMachine.ts:63's `{ busyPeerId: state.busyPeerId, busyAction: state.busyAction }`), and it must be re-derived by any repo adopting this. LEGAL FIX, one line per site: add an arm to onRehydrateStorage that discards or remaps the field, copying systemStore.ts:148-161 — or, structurally, give partialize a sibling that takes the guard, which is what the golden path's section 4 proposes and what would make this rule unnecessary rather than merely satisfied. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero matches, BY DESIGN: DELETE the rule then, do not baseline it at 0. PRECONDITION (must be re-derived per repo, do NOT port): this repo declares durable client state with zustand's persist() + an explicit partialize whitelist, and repairs it with onRehydrateStorage / merge. The convergence sweep found the underlying discipline is PHYSICS — 4 of 4 applicable sibling repos independently discard or remap a persisted value whose vocabulary has moved (personas-web useIncidentsFilterStore.ts:49-50 'Type-guard each field on load so a corrupt or stale payload can never land the store in an out-of-range filter'; personas-web dashboardFilterStore.ts:45-50 coercing a bounds-less 'custom' range back to '7d' because it 'would silently widen the user's filter to all-time'; brainiac CortexMap.tsx:51 VIEWS.some(v => v.id === initial); ascent lib/window.ts:39-44 returning null for an unknown range key) — but the MECHANISM differs in every one of them, and one sibling (vibeman) uses zustand's version+migrate instead, with a house factory at src/stores/utils/persistence.ts:99-155 and a nine-step migration ladder at cliSessionStore.ts:418-489. An adopting repo on a different stack must re-key on its own durability idiom: redux-persist's migrate map, a cookie parser, a URL search-param schema.",
        "$measured": "2026-08-17 @ df634c53c — 4829 .ts/.tsx walked, floor 4000, both rules run in 1.4s. Two independent implementations of the population (a census regex, and a brace-matching scanner that reads each persist() config structurally and shares no pattern with it) return the identical 19/4 split with the identical file:line list, and independently reconcile the denominators at 7 persist() stores / 69 partialize fields / 23 vocabulary matches. All 19 violating and all 4 control matches hand-read. Site-level overlap against 20 neighbouring rules computed with the census's own scanRule: zero shared sites, zero shared files, all twenty. Fault-injected six ways, all six fire. Re-extracted from the finished golden path and re-run: identical. The full registry was NOT run. Behavioural claims come from seven jsdom 29.1.1 + React 19.2.6 + zustand 5.0.14 experiments over statement-for-statement transcriptions of useScrollRestoration, dedupedStorage, systemStore's partialize + onRehydrateStorage, UnifiedTable's persisted-sort block, IncidentsInbox's filter restore, SettingsPage's tab dispatch and TriggersPage's fallback dispatch. Vocabulary churn comes from replaying all 156 revisions of src/lib/types/types.ts. No database was copied, the live app was never touched, and cargo was not run."
      },
      "baseline": { "files": 2, "matches": 19 },
      "floor": 4000
    }
  ]
}
```

### Positive control (evidence, NOT merged as a gate — carries no baseline)

```json
{
  "id": "durable-view-token-with-no-rehydrate-arm-positive-control",
  "goldenPath": "docs/concepts/golden-paths/view-state-persistence.md",
  "title": "POSITIVE CONTROL — the same durable view tokens, in a config that DOES repair them on rehydrate",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "^[ \\t]{4,}([A-Za-z0-9_$]*(?:Id|Ids|Tab|Section|Sections|Step|Groups|Kinds))\\s*:\\s*state\\s*\\.\\s*\\1\\s*,(?=[\\s\\S]*\\b\\1\\s*=[^=>])",
    "flags": "gm",
    "ignoreCommentLines": true,
    "$measured": "2026-08-17 @ df634c53c — validated standalone in a composer-private scratch registry, then re-extracted from this document and re-run; 1 file / 4 matches both times.",
    "description": "CONTROL, not a gate. The IDENTICAL durable-declaration anchor over the IDENTICAL roots and extensions as durable-view-token-with-no-rehydrate-arm, differing in exactly one character: the lookahead is positive rather than negative. The two are mutually exclusive BY CONSTRUCTION rather than empirically — a given partialize entry either is or is not followed by an assignment to the same field — and together they see all 23 vocabulary-matching partialize entries in the tree, partitioning them 19 + 4 = 23 with no residue, so the counts must move in OPPOSITE directions as the codebase improves. MEASURED 2026-08-17 at df634c53c: 4 matches in 1 file versus the gate's 19 across 2. WHAT THE FOUR DEMONSTRATE IS THE WHOLE ARGUMENT OF THE GOLDEN PATH, because they are not merely compliant code — they are this repository's own history of the failure the gate exists to prevent. systemStore.ts:59 sidebarSection is repaired at :139-142 ('the goals 1st-level section was rebranded to teams'); :79 editorTab and :80 designSubTab are repaired at :173-191 (four tabs absorbed into the Design hub, plus a designSubTab value rename); :84 onboardingDismissedAtStep is repaired at :148-161 and is the ONLY DISCARD rather than remap, the only one that trims a neighbouring record of stale keys, and the only one instrumented — a Sentry breadcrumb reading 'Discarding unknown onboardingDismissedAtStep on hydrate' with the persisted value attached, above a comment that names the exact failure mode: 'if a persisted step id no longer exists in the current enum (app update renamed/removed a step), discard the stale value so the overlay doesn't render blank on resume.' EVERY ONE OF THE FOUR WAS WRITTEN BECAUSE A SURFACE MOVED AND STILL EXISTED; not one was written because a surface was deleted, which is exactly the case the 19 are exposed to (SettingsTab lost 'quality-gates' and 'config'; PluginTab lost four members; TwinTab lost 'voice'). THE HONEST DEFLATION, RECORDED SO THE NUMBER IS NOT OVERSOLD: all four compliant sites are in ONE FILE and were written by the same hand at four different times, so per the doctrine's lineage rule applied within a repo this is closer to n=1 authoring wearing four coats than to four independent successes — the compliant side carries almost no statistical weight and the VIOLATING side carries all of it: 19 declarations, two of which were replayed into an executed crash and an executed ghost-id fetch. A SECOND DEFLATION: this control passes for any assignment to the field name anywhere below the whitelist, so it certifies that SOMEONE THOUGHT ABOUT the field on the rehydrate path — it does NOT certify that the arm is still correct. It is not: one of the four arms (editorTab === 'use-cases', systemStore.ts:183-186) now rewrites a token that EditorTab has re-adopted as legal (types.ts:416), and the control cannot see that, because the config has no `version` and therefore no way for anything to notice that a migration outlived its cause. If this control's count ever collapses toward the gate's, the shared anchor has broken and BOTH numbers are meaningless — that is the failure this control exists to make visible. If the section-4 `durable(value, guard)` type lands and the 19 gain guards, this control rises sharply while the gate falls by the same amount; that is the correct signal and must not be read as drift. Deliberately carries NO baseline: a ratchet is monotone-downward, so a rule counting COMPLIANT code would fail the build every time adoption improved; the census engine rejects a `-positive-control` id that carries one (verified by injection) and the registry merge skips it by construction."
  },
  "floor": 4000
}
```

### Gates I rejected, with numbers

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **any restore from web storage that does not check the value against a live vocabulary** — the obvious rule, and the one that covers the most defects (D4, D10) | ~21 of 79 reads | ~34 | **Refused on 100% file overlap with `raw-web-storage`.** Every one of the 79 production `localStorage.getItem` sites is by definition inside a file that rule already counts (72 files / 186 matches), so the anchor is not available to me at all. Worse, my own first classifier scored `UnifiedTable.tsx:48` as *compliant* because it does `typeof p.key === 'string'` — and E4 proved that exact site is the defect. **A shape check and a currency check are not separable by any matcher I could write**, which is the honest reason this is prose in §5 and not a gate. |
| **an opt-in view-state memory left off** — `<UnifiedTable>` with no `tableId`, `<DataGrid>` with none | 13 + 6 | 4 | **A gate that fires on correct content is worse than no gate.** A table inside a transient modal *should* forget its sort; `DataGrid` cannot accept the prop at all (`DataGrid.tsx:9-11` documents the omission as deliberate), so its 6 sites are a primitive-choice question, not a violation. **Carried as §0's adoption table and §6.1**, where the 9/9-vs-4/17-vs-1/17 spread is worth more as evidence about naming than it would be as a ratchet. |
| **a scroll container above a view swap with no reset and no restoration key** — D1, the headline | 520 candidates | 4 | **The denominator is unstateable.** Whether a scroller sits above or below a swap is a render-tree fact, not a text fact, and 520 class occurrences include every modal body, dropdown list and code block in the app. I cannot state a precision, so I cannot ship it. **Carried as D1 with the executed replay**, which is more actionable than a count. The right instrument here is the harness, not a matcher — see below. |
| **a `<textarea>` whose value has no durable home** — D5, the loss-of-work finding | 58 files | 2 | **Refused: 59 of the 119 reach a backend door, and telling "this text is saved server-side" from "this text is lost" needs the data flow, not the file.** My file-level proxy would fire on every modal whose textarea is submitted through a prop callback into a parent that saves. Precision unmeasurable above ~50%. **Carried as D5**, and the convergence result (0 of 4 siblings persist a draft) says this is a fleet-wide absence rather than a local lapse. |
| **`persist()` without `version` + `migrate`** — D7 | 6 of 7 stores | 1 | **Refused as a neighbour's territory, not on numbers.** [client-state-persistence](./client-state-persistence.md) already lists this exact construct in its anti-patterns; gating it here would be re-deriving its leaf. The interesting half that *is* mine — a migration arm that has outlived its cause — is a semantic judgement no matcher can make (§7 D7). |
| **a persisted collapse/hide set with no prune** — D9 | 4 | 0 | **Zero compliant sites means no control**, and a 4-match rule cannot distinguish "fixed" from "matcher broken". The condition is also an *absence* (a prune that was never written), which the census cannot assert by construction. **Carried as D9.** |

### What the census fundamentally cannot gate here, and what to build instead

- **"what the user is entitled to get back survived the boundary"** (P2, P10, D1, D5) — **a test, and
  this composer built one.** The jsdom harness that produced §0 mounts a host, types into it, scrolls
  the container, then crosses remount / navigate / restart and asserts on the draft, the scroll offset,
  the mount count and the fetch count. That is the right shape for a `__tests__` case beside any
  surface that claims to remember something, and it is not expressible as a matcher because the answer
  depends on the render tree, not the text.
- **"this restored value is still true"** (P5, D3, D4, D10) — needs the *live* data, which exists only
  at runtime. The instrument is `usePersistedContext`'s required `validate`, not a rule; §4 argues for
  generalising it.
- **"this migration is still needed"** (P9, D7) — needs a `version`, which is the fix rather than the
  gate. Until one exists, nothing — not a matcher, not a test, not a reviewer — can tell a load-bearing
  arm from a fossil.
- **"a documented lifetime matches the implemented one"** (D11) — this is the `check-csp-hosts.mjs`
  shape: an assertion that a set of documented storage keys is a subset of the keys the code actually
  touches. It would have caught `home-releases-selected-version` (documented, nonexistent) and is a
  ~30-line script, not a census rule, because it asserts an **absence**.

---

## 12. Corrections to the brief

The brief was right about the shape and about five of its six primed leads. Recorded per the doctrine,
since the corrections are the deliverable.

1. **My own matcher was wrong twice, in the same way, and the second time proved the first was not a
   fluke.** Measuring adoption of `tableId` and `scrollRestoreKey`, a brace-and-quote-aware attribute
   reader returned **2 of 17** and **0 of 17**. The real answers are **4 of 17** and **1 of 17**. Cause:
   `<UnifiedTable<PersonaEvent>` — the TSX **generic argument list**'s `>` closed the element for my
   reader, so it read `<PersonaEvent` as the entire attribute string and every attribute on the four
   generic-parameterised call sites was invisible. The identical bug then hit a *hook*: a scan for
   `usePersistedContext(` returned **0 call sites** because both real consumers write
   `usePersistedContext<T>({…})`. **A matcher that is correct about JSX and wrong about TypeScript will
   silently under-report exactly the call sites that are typed carefully** — which, on a codebase where
   care correlates with correctness, biases every adoption number downward. Both were caught only
   because a hand-read of `EventLogList.tsx:441` disagreed with the machine.

2. **"tab-strip found a draft DESTROYED while `scrollTop = 640` SURVIVED. That inversion is this leaf's
   central question — find its population."** — **Found, reproduced independently, and the mechanism is
   simpler and worse than "tabs".** It is not a property of tab strips at all: it is that a scroll
   offset lives on a DOM node whose lifetime is set by CSS layout, while everything else lives in a
   component whose lifetime is set by a conditional — so the offset survives *any* swap under a shared
   scroller and the content survives *none*. **The population is 520 scroll-container class occurrences
   against 3 explicit resets** (one of them inside the primitive itself) **and 4 uses of the only
   restoration hook.** The brief framed this as one leaf's oddity; it is the default behaviour of the
   entire application, and E2 shows the repo's own primitive fixes it in both directions
   (new context → top, return → 640) at 4 call sites.

3. **"8 of 18 stores hold a tab field unpersisted with no stated reason; 32 of 34 tab selections are
   local `useState`."** — **Both confirmed and both slightly mis-scoped, and the interesting number is
   a third one.** Those are *store* counts (18 `*Tab` fields, 10 persisted) and *strip* counts; the
   leaf's real denominator is **104 `useState` bindings named for a tab or view in 98 files** — plus
   163 filter bindings in 114 files, 288 expand/collapse in 244, 214 selection in 166, 34 sort in 24,
   10 width in 10, 89 authored-prose in 86. **~900 view-state bindings, of which the durable ones number
   69.** More importantly the brief's framing — persisted vs not — turned out to be the *less*
   dangerous axis. The dangerous axis is what happens to a persisted value whose vocabulary moved, and
   on that axis the eight *un*persisted tab fields are the safe ones.

4. **"This app has no router, so URL is not available as a home — but there are 63 store deep-link
   doors. Deep-linking is solved at one altitude and structurally impossible at another."** —
   **Confirmed, and the convergence oracle turned it from a local quirk into the leaf's one genuinely
   divergent clause.** Four applicable sibling repos give four different answers: `ascent` puts view
   state in the URL and has **no state library at all**; `brainiac` is URL-first with `history.replaceState`;
   `vibeman` is store-first with 15 persisted stores behind one factory; `personas-web` splits.
   **There is no fleet consensus to adopt**, so the absence of a router is not a deficiency to correct
   — it is one of four legitimate positions, and it is the reason the store is this app's entire
   address space.

5. **"`TwinVariantTabs`, a self-labelled throwaway A/B switcher, has since grown `localStorage`
   persistence. Ask what else persists that should not."** — **Asked, and the answer is a different and
   larger class than the brief anticipated.** Nothing else in the tree is a throwaway that grew a
   memory. What persists and should not is subtler: **four collapse/hide sets that only ever grow and
   never prune** (§7 D9), so a group that vanishes and returns comes back collapsed — the app hiding
   data on the strength of a choice the user made months ago and cannot see; **a sort key naming a
   deleted column, re-written to disk on every mount so it can never self-heal** (D4, executed); and
   **an entity id pointing at a row that no longer exists** (D3, executed). The brief's instinct was
   right and its example was the mildest case in the class.

6. **The spine's `sides: "client"` is right about the mass and wrong about the fix — and
   `convergence: "diverged"` splits by clause, exactly as `tab-strip` found for `"mixed"`.**
   `sides: client` is defensible here in a way it was not on the six leaves the doctrine records:
   4,829 files of view state are client-side, no view state crosses IPC in bulk, and `cargo` was
   correctly never run. **But the sharpest defect's correct answer lives on the server and is unwired**
   — `dev_tools_get_active_project` (`dev_tools.rs:271-283`) resolves the remembered project id against
   the live table and returns `None` when the row is gone, which is precisely the reconciliation E3
   found missing on the client; its frontend door has **zero call sites**; and the two halves disagree
   by construction on every launch, because the Rust side is an in-memory `static` that resets and the
   client side is in `partialize` and does not. So the label did not narrow me away from the answer,
   but it would have if I had trusted it. **`convergence: diverged` holds for exactly one clause** —
   where view state lives, 4 answers in 4 repos — **and is refuted for the two that matter most**:
   discarding a persisted value whose vocabulary moved is **unanimous physics at 4 of 4**, and being
   able to clear a filter is **unanimous at 4 of 4**. Two further clauses are **total silences where
   this repo is ahead of the entire fleet** (scroll restoration 1 of 4; draft persistence 1 of 4), and
   one is a silence where it is **behind** (versioned migration 1 of 4, and the sibling that has it has
   a nine-step ladder and a written strategy document). **A single enum cannot carry a verdict that
   is physics, divergence, ahead-silence and behind-silence at the same time** — which is now the
   second independent leaf to report that in this batch.

7. **A lead the brief supplied that measured out the opposite way, and it is worth stating plainly.**
   *"The loading doctrine names a module-scoped cache keyed by entity as the answer for a view that
   fully unmounts on nav-away. Measure adoption."* — **Adoption is high and it is adoption of the wrong
   half. 81 module-scope caches exist; 80 hold fetched DATA and 0 hold user VIEW state** (the single
   name-shaped hit is a table-schema introspection cache). Fourteen of them cite
   `docs/design/overview-loading.md` law 1 by name. **The repo generalised "keep the data warm across
   an unmount" thoroughly and never once generalised "keep the view".** So on every one of those 14
   surfaces the rows now paint instantly on return — into a panel scrolled wrong, filtered by whatever
   `useState` defaulted to, with every row re-collapsed. The cache made the *data* boundary invisible
   and left the *view* boundary exactly as loud as it was.
