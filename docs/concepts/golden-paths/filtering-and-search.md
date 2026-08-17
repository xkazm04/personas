# Golden path — Filtering and search

> Situation node: `product-surfaces/lists-and-tables/filtering-and-search` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 against `master` @ `2a874e692`. Ground-truth sweep: every
> `useState` binding under `src/**` whose name carries a filter/search sense
> (**158 bindings in 116 files**, enumerated by a TypeScript-AST pass that
> classifies each one by *where its value is consumed* rather than by grepping
> lines), all **54** search-input JSX sites, all **13** `filterOptions:` and **8**
> `filterComponent:` column declarations, all **6** `DataGrid` callers, both
> hand-rolled paginators, all **4** `useFilteredCollection` call sites, the two
> shared filter primitives and all **9** of their adopters, `UnifiedTable` /
> `DataGrid` / `FacetedDecisionTable` in full, `db/src/query_builder.rs`, and
> **20 surfaces traced from their filter predicate back to the `limit` on their
> own fetch** — plus a convergence pass over `personas-web` and
> `brainiac/console`. Repo-level denominators are cited from
> [`shared-facts.json`](../shared-facts.json) (**4,829** `src/**/*.{ts,tsx}`),
> not re-derived. `.claude/worktrees/**` excluded from every count.
> Dimensions: **function · ui · performance · code-quality · resilience**.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

## 1. Trigger

- "Add a search box to this list" / "let me filter these by status"
- "Add a persona / category / date-range filter to X"
- "Typing in the search box is laggy" / "it fires a query per keystroke"
- "I filtered and it says there's nothing, but I know there are twenty"
- "Page 2 of the filtered list is empty" / "I filtered and it kept me on page 3"
- "The count above the list doesn't match the rows in it"
- "It says 'no matches for your filters' and I haven't set any filters"

If you are about to type `const [search, setSearch] = useState('')`,
`.toLowerCase().includes(`, `rows.filter((r) => …)` next to a text input,
`filterOptions:` on a column, `<FilterBar>`, or a `<Search>` icon absolutely
positioned inside an input wrapper — you are in this situation.

### Scope decision — the seam with `dynamic-filter-query`

`data-persistence/dynamic-filter-query` is the sibling leaf and owns the SQL
half. The brief for this document proposed the seam be **where the filter is
evaluated** — client-side over fetched rows, or in SQL. **That is the right
axis and the wrong unit,** and the measurement says so:

- It is not a property of a *surface*. `MemoriesPageDense.tsx` sends `search` to
  SQL (`:103`) and evaluates `category` in memory (`:129-132`) — one component,
  one filter bar, both halves. **9 of 116 filter-holding files are like this**
  (`MIXED` in the census below), and the shape recurs in the four largest list
  surfaces in the product.
- It is not visible from the component. `UnifiedTable`'s `onFilterChange` is a
  bare `(value: string) => void`; whether the handler re-issues a query or
  narrows an array is invisible at the call site. Of the 13 `filterOptions:`
  declarations in the repo, **2 re-issue a query** (`EventLogList.tsx:224,:240`)
  and **11 narrow an array** — identical prop shape, opposite semantics, and no
  way to tell them apart without opening the handler.

So the seam is drawn one level down, per **filter dimension**, and the checkable
question is:

> **Does this dimension's value cross the IPC boundary?**

**Yes** — the value appears in an `invokeWithTimeout` argument, in a
`useLayeredList` `filterKey`, or in a `useEffect` dep that re-fetches. It is a
*query input*. `dynamic-filter-query` owns it: predicate composition through
`QueryBuilder`, `escape_like` on every `LIKE`, the supporting index, and keeping
the counts query and the rows query on one filter builder. This path owns only
the control that produces the value and the timing of when it is sent.

**No** — the value is consumed only by a `.filter()` / `.includes()` over an
array already in memory. It is a *derivation*. **This path owns it end to end**,
and owns one obligation the SQL half does not have: the array must be the
complete candidate set. A client-evaluated filter over a truncated or paged array
does not return a slow answer, it returns a **wrong** one.

That obligation is why the seam is drawn here rather than at the surface: the
highest-severity defect in this leaf *is* the seam crossed without checking.
**13 of the ~20 in-memory filter surfaces evaluate a filter over an array their
own fetch had already capped** (Deviations A), and 7 are legitimately complete.
Nothing in the type system distinguishes them.

## 2. The one way

Decide, **per filter dimension**, whether its value crosses the IPC boundary —
and write the answer down before you write the control. A dimension whose
candidate set is bounded by construction (a persona roster, one credential's
tags, a seeded connector catalog) is filtered in memory: put the state and the
predicate in a `use<Entity>Filters()` hook beside the list, keep the predicate a
pure function in a sibling `*Types.ts` module so it is testable without React,
memoize it with the individual filter values in the dep array (**never** an
object literal — that is why all 4 `useFilteredCollection` call sites memoize
nothing), and export `hasFilters` + `clearFilters` alongside the rows so the
empty state can tell *filtered-to-zero* from *nothing here yet*. Every other
dimension goes to the server: fold it into a single `filterKey`, hand that to
`useLayeredList`, debounce free text at 300 ms before it reaches the key,
never debounce a dropdown, and read the total from the L0 counts query — which
must be built from the **same** WHERE-clause builder as the page, or the number
above the list describes a different set than the list. If you cannot page the
dimension server-side yet, you may filter the loaded window **only if you say so
on screen**: render the loaded-window count beside the corpus count and a
translated note that the facets describe the page, the way
`fleet/monitor/channels/Stream.tsx:200-203,:283-289` does. And never let a filter
change leave the pagination where it was: a filter narrows the *set*, so the page
index that pointed into the old set is meaningless — `DataGrid` clamps but does
not reset (`:202-208`), and none of its 6 callers compensates.

## 3. Mandated primitives

**State + evaluation (in-memory half)**

- **`src/features/vault/sub_credentials/components/list/useCredentialListFilters.ts`** — not a module you import, **the shape you copy**. All filter state in one hook, evaluation delegated to a pure `filterAndSortCredentials(credentials, spec, resolver)` in a sibling `credentialListTypes.ts:96-108`, a real `useMemo` with every filter value in the dep array (`:80-87`), and `hasFilters` / `clearFilters` / `allTags` returned for the chrome and the empty state to share.
- **`src/hooks/utility/data/useFilteredCollection.ts`** — `useFilteredCollection<T>(items, spec)` → `{ filtered, total, isEmpty }`. The declarative `exact` / `custom` matcher list. **Read Gap 2 before you use it:** its memo key is the `spec` object (`:57`), so an inline literal defeats it, and 4 of 4 call sites pass an inline literal.
- **`src/features/shared/components/display/facetedTableModel.ts`** — `searchItems(items, query, haystack)` (`:97-105`), `buildGroupTree`, `itemsUnderGroup`. React-free and unit-tested. The repo's only shared text matcher. **Read Gap 1 before you route anything to it** — its matching policy is `toLowerCase().includes()` with no normalization, i.e. the same defect as the 121 hand-rolls it would replace.

**State + evaluation (server half — hand off to `dynamic-filter-query` at the boundary)**

- **`src/hooks/utility/data/useLayeredList.ts`** — `useLayeredList({ filterKey, fetchPage, fetchCounts })`. **Every server-resolved dimension folds into `filterKey`**; its `epochRef` (`:105`) then drops superseded responses per arm (`:113-127`), which is the [stale-response guard](./stale-response-guard.md) already solved for you. 2 adopters, both clean.
- **`src/features/overview/sub_incidents/libs/useIncidentsData.ts:42-63`** — the adapter shape: `filterKey = JSON.stringify(filters)`, one typed `IncidentFilters` binding sent whole, and a `truncated` flag derived at `DEFAULT_LIMIT` (`:19-20`, `:55`).
- **`src/features/overview/sub_incidents/libs/incidentFilterDefaults.ts`** — `OPEN_ONLY_FILTERS` + **`isNarrowedFilters(filters)`**. The "has the user actually filtered?" predicate, hoisted into a shared module so the inbox, the filter bar and the KPI header cannot disagree about it. This is the discriminator [`empty-and-demo-states.md`](./empty-and-demo-states.md) step 4 needs; it exists in exactly one feature.
- **`src/hooks/utility/timing/useDebounce.ts`** — `useDebounce(value, delay = 150)`. Use **300** for a server text search; the two hand-rolled debounces in the repo both chose 300 and so did every debounced site in both sibling repos.

**Chrome**

- **`src/features/shared/components/overlays/FilterBar.tsx`** — the segmented status-pill row with badge counts, a `summary` slot and a `trailing` slot. **2 adopters** (`GlobalExecutionList.tsx:387`, `ManualReviewList.tsx:396`). It is *not* a toolbar: no search input, no dropdowns.
- **`src/features/shared/components/forms/ColumnDropdownFilter.tsx`** — the anchored per-column dropdown, for `TableColumn.filterComponent`. 6 adopters.
- **`TableColumn.filterOptions` / `filterValue` / `onFilterChange` / `filterComponent`** (`UnifiedTable.tsx:78-85`, mirrored on `DataGrid.tsx:38-43`) — the column-header filter chrome. **These render the control and nothing else; neither primitive filters `data`.** See Gap 3.
- **`feedback/ScenarioEmptyState`'s `NoResults({ onReset })`** (`ScenarioEmptyState.tsx:205`) — the filtered-to-zero state. Wire `onReset` to the same `clearFilters` your bar uses. Owned by [`empty-and-demo-states.md`](./empty-and-demo-states.md); do not re-derive it here.

**Explicitly not primitives for this:** `UnifiedTable`'s `searchable` /
`searchValue` / `onSearchChange` column props (**0 call sites** — dead
configuration, Gap 4), and `overlays/FilterBar` for anything with a text input.

## 4. Steps

1. **Enumerate the dimensions and answer the boundary question for each, in writing.** `status`, `persona`, `category`, free text, a date range — each gets a yes/no. This is the step people skip, and skipping it is how one component ends up with `search` in SQL and `category` in memory over a 100-row window.
2. **For every "no" dimension, prove completeness.** Open the fetch. If it passes a `limit`, an `offset`, a cursor, or accumulates pages, the array is **not** the candidate set and an in-memory filter over it is a wrong answer, not a slow one. Either move the dimension to the server (step 5) or adopt the disclosure of step 9. Guessing "there won't be many" is how all 13 surfaces in Deviations A were written.
3. **Put the state in a `use<Entity>Filters()` hook, not the component.** One hook owns every dimension, `hasFilters`, `clearFilters` and the derived rows. `useCredentialListFilters.ts` is the template. This is also what makes the filter survivable — see step 10.
4. **Put the predicate in a pure function in a sibling `*Types.ts`.** `filterAndSortCredentials` (`credentialListTypes.ts:96`) takes rows + a spec + a resolver and returns rows. No React, no hooks, testable. Call it from one `useMemo` whose deps are the **individual filter values** — never an object literal.
5. **For every "yes" dimension, fold it into one `filterKey` and hand it to `useLayeredList`.** Do not add a second fetch path per dimension; do not call the page endpoint as a counts probe. The counts fn and the page fn must share one WHERE-clause builder on the Rust side — that half is [`paginated-list-query.md`](./paginated-list-query.md) step 4 and `dynamic-filter-query`.
6. **Debounce free text, and only free text.** `const debouncedSearch = useDebounce(search, 300)` and put the *debounced* value in `filterKey`. A dropdown must apply instantly; `useEventLog.ts:191-193` gets this exactly right in one expression — `setTimeout(…, searchText.trim() ? 300 : 0)`. Never debounce an in-memory filter: there is no cost to save and you have added a frame of lag to a keystroke.
7. **Reset the page — do not clamp it.** A filter change invalidates the page index. `DataGrid` owns `page` internally and only clamps on `data.length` (`:202-208`), so remount it on filter change: `<DataGrid key={filterKey} … />`. For a server page, reset the cursor; `useLayeredList` does this for you the moment `filterKey` changes.
8. **Reach for the shared empty-state discriminator, do not invent one.** `filtered.length === 0 && raw.length > 0` → `<NoResults onReset={clearFilters} />`; `raw.length === 0` → the first-use state. Full taxonomy in [`empty-and-demo-states.md`](./empty-and-demo-states.md) §4. If the surface has a shared filter-defaults module, put an `isNarrowedFilters()` beside it so three views cannot disagree.
9. **If you must filter a loaded window, say so on screen.** Render `visible.length / rows.length` and a translated scope note distinguishing corpus totals from window counts. `Stream.tsx:200-203` and `:283-289` are the only implementation in the repo; `brainiac/console` invented the same thing independently (`review-surface.ts:141-143`), which is the strongest evidence available that it is the right answer.
10. **Decide whether the filter survives navigation.** Lazy routes unmount, so a `useState` filter is gone on return. **There is no URL in this app** (zero `react-router`, zero `useNavigate`) so the sibling repos' answer is unavailable — the local equivalents are a store slice or a `localStorage` key, and `IncidentsInbox.tsx:220-232` is the one worked example. 8 of 116 filter-holding files persist anything.
11. **Stop.** No new `*Filters.tsx` chrome component if `FilterBar` fits, no local `useDebounce`, no `toLowerCase().includes()` chain copied from the file next door, no second counts fetch, no `page` state beside a `DataGrid`.

## 5. Anti-patterns

- **Filtering an array your own fetch capped.** The defect this leaf exists to prevent. `MemoriesPageDense.tsx:129-132` filters by category over `memorySlice.ts:107-121`'s `limit: 100, offset: 0` — so a category with 400 members and none in the newest 100 renders "no memories match", under a header printing the **full table count** (`:194`). The server parameter that would fix it already exists and is passed by nobody (`memories.ts:116` `category?: string`). 13 surfaces do this; the reason none was caught is that the code is *locally* correct at every line.
- **Deriving the filter's own options from the loaded rows.** `LlmCallsTable.tsx:139-150` and `EventLogList.tsx:110-117` build their dropdown option lists from the rows in memory. The control cannot offer a value whose rows have not loaded, so the filter looks complete while being structurally incapable of finding anything outside the window — and it silently changes shape as the user scrolls.
- **A total that describes one set over rows that are another.** `GlobalExecutionList.tsx:395` pairs `filteredExecutions.length` (client-filtered, 50 loaded) with `globalExecutionCounts.total` (server, unfiltered). `MessageList.tsx:269` and `:159` do the same, and `:159` makes the *"Load more (N)"* label describe the unfiltered remainder.
- **Passing an object literal as a memo key.** `useFilteredCollection(items, { exact: [...] })` — `spec` is a new object every render, so `useMemo(…, [items, spec])` (`useFilteredCollection.ts:57`) never hits and the hook re-filters the whole collection on every unrelated re-render. **4 of 4 call sites.** The hook's entire reason to exist is defeated at 100% of its adoption.
- **A filter change that leaves the page index alone.** `DataGrid.tsx:202-208` clamps on `data.length` and comments that resetting was deliberately removed. That was right for row add/remove and wrong for filtering, and there is no way for a caller to signal which happened. Worse: the effect does not run at all when the filtered set has the *same* length, so filtering status A (25 rows) → status B (25 rows) leaves you on page 3 of a different set with no clamp.
- **A search box that owns the page but not the pager.** `FacetedDecisionTable` renders its own search input (`:210-214`) and group rail (`:124-127`), computes `rows` (`:122-128`), and hands them to a `DataGrid` (`:190`) whose `page` it cannot reach. Type on page 3 and you land on page 3 of the results.
- **`toLowerCase().includes()` written out at the call site.** 121 matches in 56 files. The whole matching policy — case folding, diacritics, whitespace, whether multiple words must all match — is re-decided each time, and **the repo has zero `toLocaleLowerCase` and zero Unicode normalization**, so in a 14-locale product every one of these fails on accented input. The same codebase calls `localeCompare` at **180 sites in 115 files** to *order* strings: it already knows collation is locale-dependent and forgets it the moment it *matches*.
- **Debouncing the wrong thing.** Debouncing an in-memory filter buys nothing and costs a frame of input lag; not debouncing a server search costs a query per keystroke against a table with no index on the searched column. `useEventLog.ts:191-193` is the one site that branches correctly.
- **Rendering filter chrome wired to nothing.** `TableColumn` exposes six independent optional filter props and the table filters nothing, so a column can carry `filterOptions` with no `onFilterChange` and render a dropdown that does not exist — the same class as `LiveStreamTab.tsx:455`'s `onSort={() => {}}` beside a live `sortKey`.
- **Answering "did the user filter?" a second time.** 30 references to a `hasFilters`-shaped identifier across the repo, each re-deriving it. When a default filter is itself non-empty — the incidents inbox opens on `statuses: ['open']` — a naive `Object.keys(filters).length > 0` reports "filtered" on first paint and the surface shows *"no matches, try adjusting"* to a user who has adjusted nothing. `isNarrowedFilters()` exists precisely for that and lives in one feature.
- **Writing a new `<Feature>Filters.tsx`.** 42 feature-local `*Filter*` / `*Toolbar*` / `*Search*` components against 3 shared ones. Each looked like a small local decision; the cost is that no debounce policy, match policy, reset policy or a11y treatment can ever be fixed centrally.

## 6. Evidence

**Adoption.** 116 files hold a filter/search value (158 bindings). By where the
value is consumed: **CLIENT 79 bindings / 66 files · SERVER 20 / 16 · MIXED 9 / 9
· handed to a child 33 / 29 · unread 17 / 15.** Shared-primitive adoption against
that: `useLayeredList` **2**, `useFilteredCollection` **3 files / 4 sites** (all
4 with a defeated memo), `overlays/FilterBar` **2**, `ColumnDropdownFilter`
**6**, `searchItems` **1**. Debounce mechanisms: `useDebounce` **5 files**,
`useDeferredValue` **3**, hand-rolled `setTimeout` **9**. Column-filter
declarations: **13** `filterOptions:` in 11 files, **8** `filterComponent:` in 5,
`searchable: true` **0**.

- **`vault/sub_credentials/components/list/useCredentialListFilters.ts:80-87` + `credentialListTypes.ts:96-108` — copy this one for an in-memory filter.** The complete set is guaranteed by construction (`listCredentials()` takes no limit, `src/api/vault/credentials.ts:20-21`), the predicate is a pure function outside React, the memo deps are the individual values, and `hasFilters` / `clearFilters` are returned for the chrome and the empty state to share. It is the only surface in the repo that gets all four right.
- **`overview/sub_incidents/` — copy this one for a filter that crosses the boundary.** `IncidentFilters` is a single ts-rs-bound struct (`src/lib/bindings/IncidentFilters.ts`); **every** dimension goes to `list_audit_incidents` (`src/api/overview/incidents.ts:17-26`); `filterKey = JSON.stringify(filters)` drives the refetch (`useIncidentsData.ts:42-63`); a `truncated` flag is derived at `DEFAULT_LIMIT = 100` (`:19-20`, `:55`) and rendered as translated copy (`IncidentsInbox.tsx:533`); and `incidentFilterDefaults.ts` holds the resting state and `isNarrowedFilters()` so three views share one answer to "is this filtered?".
- **`fleet/monitor/channels/Stream.tsx:137,:200-203,:283-289` — copy this one when you cannot avoid filtering a window.** `visible.length / rows.length` in the header, and a rail note whose in-source comment states the doctrine: *"Kind counts are CORPUS totals (SQL). Family + callsign counts describe only the loaded window… Different numbers meaning different things is exactly the kind of quiet lie this rail exists to avoid, so it says which is which."*
- `overview/sub_events/libs/useEventLog.ts:191-193` — `setTimeout(…, searchText.trim() ? 300 : 0)`. Debounce policy differentiated by control type in one expression.
- `overview/sub_manual-review/hooks/useManualReviewQueue.ts:38-55` — every server dimension folded into `filterKey`, `PAGE_SIZE = 40` matching the server clamp, badges read from L0 counts (`ManualReviewList.tsx:141-154`) rather than from `rows.length`.
- `plugins/dev-tools/sub_runner/useTaskQueue.ts:87-116` — the second clean `useLayeredList` adapter; `RunDeskPage.tsx` adds no client filter on top, which is the discipline the hook needs to stay correct.
- `overview/sub_manual-review/components/backlog/useBacklogQueue.ts:20-22` — honest in a comment that *"the facet rail is only truthful about loaded rows"*. Disclosure in a comment is not disclosure to the user (Deviations A), but it is the only surface that noticed.
- `shared/components/display/facetedTableModel.ts:86-104` — `itemsUnderGroup` + `searchItems`: React-free, generic over the row type via injected accessors, unit-tested. The right *structure* for a matcher; see Gap 1 for its policy.
- `overview/sub_events/components/EventLogList.tsx:276` — `const showRichEmpty = !isFetching && displayedEvents.length === 0 && !hasActiveFilters;` — the cleanest single-expression statement of "settled **and** empty **and** unfiltered".

## 7. Deviations found

### A. Client-side filter over an array the fetch already capped — 13 surfaces (the wrong-answer class)

Every row was verified by tracing the predicate back to the `limit` on its own
fetch. **This is the highest-severity section in this document:** none of these
fails, errors, or looks slow — they return "no results" for data that exists.

| Surface | Cap | Dimensions filtered in memory |
|---|---|---|
| `overview/sub_messages/components/MessageList.tsx:130-137` | `messageSlice.ts:41-68`, `PAGE_SIZE = 50`, **no filter args at all** | `persona_id`, `priority`, `is_read` — and `readFilter` **defaults to `'unread'`** (`:86`), so the first paint is already a client filter over 50 rows. `messagesTotal` in the subtitle (`:269`) and `remaining = messagesTotal - messages.length` (`:159`) both describe the unfiltered set. **Worst instance.** |
| `templates` gallery — `sub_generated/gallery/cards/useGalleryActions.ts:127-172` | offset pages at `perPage = 50` | `coverage`, `component`, `difficulty`, `setup` — while `search`/`connector`/`category`/`sort` are correctly server-side (`useGalleryQuery.ts:170-178`). **`coverageFilter` defaults to `'full'`** (`:103`), so the gallery *opens* on a client filter over the first page. `coverageCounts` (`:86-101`) explicitly discards the server totals (`void total; void unfilteredTotal;`). Compounding: `TemplateVirtualList.tsx:109-110` only calls `fetchMore()` when the virtualizer nears the end of `displayItems`, so a client filter that empties the page means **no further page is ever requested** — a permanent false "no results". |
| `overview/sub_memories/components/MemoriesPageDense.tsx:129-132` | `memorySlice.ts:107-121`, `limit: 100` (500 with search), `offset: 0`, no continuation | `category` — **while the server parameter exists and is unused** (`memories.ts:116`). Header prints the full table count (`:194`). |
| `triggers/sub_dead_letter/DeadLetterTab.tsx:186-217` | `listDeadLetterEvents(100)` (`:158`) | `event_type`, `source_type`, `error_message` substrings + an age bucket. No filter ever crosses IPC; no refetch on change. |
| `overview/sub_activity/components/GlobalExecutionList.tsx:120-122,:138-145` | `overviewSlice.ts:357-407`, `GLOBAL_PAGE_SIZE = 50`, ceiling 500 | `persona` and `model`. The slice **accepts** a `personaId` third argument; the five call sites (`:181`,`:217`,`:227`,`:239`,`:247`) all pass two. Only `fetchGlobalExecutionCounts(selectedPersonaId)` gets it — so the badges are server-accurate for that persona while the rows are filtered over 50, a guaranteed mismatch. |
| `overview/sub_activity/components/LlmCallsTable.tsx:152-160` | same 50/500 store | `model`, `timeWindow`; `modelOptions` (`:139-150`) derived from loaded rows. Wires `onEndReached` (`:319`) on top of it. |
| `overview/sub_knowledge/components/KnowledgeGraphDashboard.tsx:114-138` | `listExecutionKnowledge(personaId, type, 100)` (`:76`) | `search`, `scope`, `pendingOnly`, a date drilldown. With no persona selected, `rawEntries` falls back to `summary.top_patterns` (`:99`) — a server-side **top-N aggregate** — and the search box runs over that. |
| `overview/sub_events/components/EventLogList.tsx:104-107` | server-filtered on four dimensions at `limit: 200n` | `triggerFilter` alone is client-side — **and `EventFilterInput` has a `sourceType` field that is set to `null` and never populated** (`useEventLog.ts:135`). The one dimension that could trivially be server-side isn't. |
| `overview/sub_manual-review/.../backlog/BacklogPanel.tsx:97` + `FacetedDecisionTable.tsx:123-128` | keyset page, `limit: 100` (`useBacklogQueue.ts:79`) | effort/risk ranges, the free-text box and the whole group rail. |
| `vault/sub_credentials/components/features/AuditLogTable.tsx:30-33` | `getCredentialAuditLog(credentialId, 500)` (`CredentialIntelligence.tsx:48`) | `operation`. The tab badge (`CredentialIntelligence.tsx:94`) reads 500 forever past the cap. |
| `plugins/fleet/sub_activity/FleetActivityPage.tsx:52-58` | `recentTranscripts()` — API default `limit 50`, `withinDays 7` (`src/api/fleet/fleet.ts:230-241`) | free-text search over project, files, tools, models. |
| `triggers/sub_live_stream/LiveStreamTab.tsx:222-224` | `listEvents(100)` (`:118`), buffer capped `slice(0, 200)` (`:98`,`:194`) | `status`, `type`. Defensible as a live tail — but the two dropdowns are shaped identically to `EventLogList`'s server-backed ones and give a different answer. |
| `fleet/monitor/channels/Stream.tsx:137` | `useLensFeed` + `onEndReached` (`:370`) | lens facets — **disclosed on screen** (`:200-203`,`:283-289`). Listed for completeness; this is the pattern the twelve above should copy, not a defect. |

**Cleared — do not "fix" these.** The array is genuinely the complete set:
`useCredentialListFilters.ts:80-87` (`listCredentials()` takes no limit) ·
`plugins/drive/hooks/useDrive.ts:553-605` (one directory, `drive.rs:685-711`
returns every child) · `PersonaOverviewFilters.tsx:127-163` (`listPersonas()`, no
limit) · `ClusterPatternsModal.tsx:240-258` (workspace knowledge, no row cap) ·
`DatabaseListView.tsx:50-73` · `SharedEventsTab.tsx:41-43` ·
`PersonaMonitor.tsx:87-92`. Also cleared: `ExecutionList.tsx:136-139`
(`showSimulations` is a display toggle, and `:92-94` documents that paging is
deliberately done over the unfiltered ordering so the toggle cannot desync
offsets) and the whole of `sub_incidents` (**every** dimension crosses the
boundary — the brief's suspicion was wrong).

### B. Filter change does not reset pagination — 6 of 6 `DataGrid` callers + 1 hand-roll

`DataGrid.tsx:185` owns `page` internally; `:202-208` clamps on `data.length` and
never resets, and does not run at all when the filtered set has the same length.
**No caller passes a `key` that would remount it.**

| Caller | Page size | Controls that leave the page alone |
|---|---|---|
| `agents/components/allPersonas/PersonaOverviewPage.tsx:291-307` | 25 | search / status / health / connector / favorite |
| `vault/sub_credentials/components/list/CredentialList.tsx:145-153` | 25 | search / tags / health / category |
| `triggers/sub_live_stream/LiveStreamTab.tsx:441-456` | 20 | status / type |
| `vault/sub_databases/DatabaseListView.tsx:116` | **none — this cell read “25 (default)” until 2026-08-17.** It passes no `pageSize`, and `DataGrid`'s default is **0**, which means *render everything* ([long-list-rendering](./long-list-rendering.md)) | `typeFilter` (`:73`) |
| `shared/components/display/FacetedDecisionTable.tsx:190-199` | 25 (default) | **its own** search box (`:210-214`) and group rail (`:124-127`) — the sharpest case, since the primitive owns both the control and the `data`, and still cannot reach the page |
| ↳ `BacklogTable.tsx` · `DispatchTable.tsx` · `KnowledgeTree.tsx` | | inherited from the above |

Hand-rolled paginators (only two exist):
`AuditLogTable.tsx:45-48` **resets correctly** — cleared ·
`overview/sub_patterns/graph/ClusterPatternsModal.tsx:239-261` — `useState(0)`
with no reset on `query`/`sort`; `pageClamped` (`:260`) clamps at render and
leaves `page` stale.

The one surface that gets the server axis right: `useGalleryQuery.ts:197-204`
resets `currentPageRef.current = 0` and refetches page 0 on any server-filter
change. Its *client* filters have no page state to reset — which is exactly why
they break `fetchMore` instead (Deviations A).

### C. Text matching re-derived at 121 sites, with no locale handling anywhere

**56 files / 121 matches** of `.toLowerCase().includes(<variable>)` (census below;
`src/test/**` and the shared matcher excluded). Against that: **0**
`toLocaleLowerCase`, **0** `String.prototype.normalize('NF…')`, **0**
`Intl.Collator` in `src/**` — while **180** `localeCompare` sites in 115 files do
locale-aware *ordering*. Highest-traffic hand-rolls, each repeating the identical
3–4-field haystack chain: `ExportSelectionModal.tsx:64-90` (11 matches in one
component) · `useApiExplorerState.ts:124-127` · `useRecipeViewFSM.ts:49-52` ·
`useCredentialViewFSM.ts:381-383` · `credentialListTypes.ts:118-120` ·
`ResourcePicker.tsx:218-220` · `SharedEventsTab.tsx:41-43` ·
`ComposerConnectorsPickerModal.tsx:75-77` · `StudioRails.tsx:62-180` (4 chains) ·
`FleetActivityPage.tsx:54-57`. Trim discipline is inconsistent across them, and
`useSkillData.ts:207-208` re-lowercases the *needle* inside the loop, once per
row per field.

### D. Shared filter chrome that nobody reaches, and 42 local replacements

- **`overlays/FilterBar` has 2 adopters** against 116 filter-holding files. `docs/refactor/shared-component-reuse.md:155` lists `FilterToolbar` as an extraction candidate ("~15 `*Filters.tsx`/`*Toolbar.tsx`; FilterBar exists, underused"). **That row is still true and understated by ~3×: the real population is 42** feature-local `*Filter*` / `*Toolbar*` / `*Search*` components under `src/features/**` against 3 shared ones.
- **`useFilteredCollection` has 3 adopters, and all 4 of their call sites defeat its memo** by passing an inline `spec` literal (`GlobalExecutionList.tsx:120`,`:140`; `KnowledgeGraphDashboard.tsx:114`; `ManualReviewList.tsx:158`). The hook's only contribution is memoization.
- **`UnifiedTable`'s per-column search is dead**: `searchable` / `searchValue` / `onSearchChange` (`:86-91`) plus ~30 lines of chrome (`:398-428`) have **zero** call sites. Same class as the five unused `ScenarioEmptyState` variants in [`empty-and-demo-states.md`](./empty-and-demo-states.md) Deviations I.
- **30 re-derivations of `hasFilters`** and one shared `isNarrowedFilters()`, in one feature.

### E. Filter state does not survive navigation — 108 of 116 files

Lazy routes unmount, so a `useState` filter is gone on return. Only 8 files touch
web storage for filter state at all (`IncidentsInbox.tsx` · `useDrive.ts` ·
`useSkillData.ts` · `TwinPicker.tsx` · `CreateTwinWizard.tsx` ·
`GoalsProgress.tsx` · `TeamMemoryPanel.tsx` · `GeneratedReviewsTab.tsx`), and no
shared helper exists for it — `usePersistedContext.ts` is for background-job
contexts, not filters. `IncidentsInbox.tsx:220-232` is the one worked example,
and it hand-rolls its own read/write/`silentCatch` cycle.

### F. Downstream empty-state defects — owned by `empty-and-demo-states.md`, listed for traceability

`ToolPerformancePanel.tsx:214` · `IpcPerformancePanel.tsx:224,:240` ·
`DatabaseListView.tsx:126-127` · `CredentialList.tsx:155-156` all render
filter-specific copy (*"no match, try adjusting your filters"*) with **no filter
guard**, so a first-run user with an empty vault is told to adjust a filter they
never set. That path owns the fix; this path owns the reason it keeps happening —
there is no shared `hasFilters` to guard on.

## 8. Gaps in the primitive

1. **There is no shared text matcher, and the closest thing to one is already wrong by default.** `searchItems` (`facetedTableModel.ts:102-104`) is `query.trim().toLowerCase()` against `f.toLowerCase().includes(q)` — no `toLocaleLowerCase`, no NFD diacritic folding, no multi-term handling, no field weighting. Routing the 121 call sites to it today would change nothing about the defect. **This is the [contract](../golden-path-contract.md#why-a-gate-is-required-at-all)'s fifth failure mode reproduced exactly** — the `Numeric`-locale shape, found here by an independent route: a gate that verifies you *arrived* at a primitive is worth only as much as that primitive's defaults. The fix is `matchesQuery(haystack: string[], query: string)` with correct-by-construction normalization, and it must land **before** any ratchet on category C means anything.
2. **`useFilteredCollection`'s signature makes the wrong call the default.** Its memo key is the `spec` object (`:57`), and the ergonomic call — an inline literal — silently disables the only thing it does. 4 of 4 call sites. A signature taking the matchers as positional arguments, or accepting an explicit `deps` array, makes the mistake unrepresentable. One edit at the primitive corrects 100% of its adoption; no gate would move a single site.
3. **No table primitive filters its own data, and none says so.** `UnifiedTable` sorts (`:498-512`) and never filters; `DataGrid` pages (`:227-231`) and never filters. Both expose six independent optional filter props on `TableColumn`, so *rendering a filter* and *applying a filter* are separate acts a caller can get out of step — which is how `filterOptions` without `onFilterChange` renders a dropdown that does nothing, and how `FacetedDecisionTable` ends up owning a search box whose page it cannot reset. The props should be one required discriminated union: `filter?: { kind: 'client', predicate } | { kind: 'server', value, onChange }` — which would also make the boundary decision of §1 a **compiler-checked** property of every filtered column.
4. **Dead configuration.** `UnifiedTable`'s `searchable` column search: 0 call sites, ~30 lines of chrome. Either give it a consumer or delete it; today it is a third search idiom a developer can discover and adopt into an already-fragmented surface.
5. **`useLayeredList` has no `total`, so "N of M" cannot be rendered** ([`paginated-list-query.md`](./paginated-list-query.md) Gap 5) — which is the mechanical reason so many surfaces reach for `rows.length` beside a server count and end up describing two different sets.
6. **No shared truncation/scope-disclosure component.** `Stream.tsx` and `IncidentsInbox.tsx:533` each invented one; there is no `<ScopeNote loaded={n} corpus={m} />`, so the twelve surfaces in Deviations A had nothing to reach for even after noticing (`useBacklogQueue.ts:20-22` noticed, in a comment).
7. **No shared filter-persistence hook.** 8 of 116 persist, each hand-rolling read/parse/validate/write. With no URL in this shell, this is the *only* mechanism available, and it has no primitive.
8. **`useDebounce`'s default is 150 ms and every real user of it picks 300.** `useSharedEvents.ts:23`, `SLADashboard.tsx:29`, `useGalleryQuery.ts:96`, plus both hand-rolled debounces (`useEventLog.ts:193`, `MemoriesPageDense.tsx:104`). Both sibling repos independently chose 150–250 for *client* filtering and 220–300 for anything crossing a network. The default is calibrated for the case that needs no debounce at all.
9. **Nothing connects the filter to the row-reveal reset.** `UnifiedTable` documents `rowReveal={{ resetKey }}` as "set `resetKey` to the filter/scope context" (`:195`) — a filter-aware hook on the primitive that requires the caller to remember what the filter *is*. The same fact (`filterKey`) is needed by `useLayeredList`, by the `DataGrid` remount key, and by the reveal reset, and there is no one place it lives.
10. **Zero enforcement.** 59 census rules and 21 custom ESLint rules; none touches filtering, search, matching or the filter/pagination interaction. `.claude/conventions.json` says nothing. **Every deviation above shipped under a green `npm run check`.**

## 9. Prefer a type over a gate — the answer for this leaf

**Answered explicitly, as the [contract](../golden-path-contract.md#prefer-a-type-over-a-gate--checked-three-times) requires. Yes for three of the four defect classes, and no for the most severe one — and saying so is the finding.**

1. **`useFilteredCollection`'s memo key — yes, and it is a one-line signature change.** Take the matchers positionally (or accept `deps`) and the inline-literal mistake becomes unrepresentable. This is the `FacetedDecisionTable`-required-`emptyTitle` precedent applied to a hook: 4 of 4 call sites corrected by one edit at the primitive, and no ratchet would have moved one of them.
2. **The filter/pagination reset — yes.** Make `TableColumn`'s filter surface a required discriminated union (Gap 3) and give `DataGrid` a `resetPageKey`. A `{ kind: 'server' }` column then *cannot* be declared without the value that both drives the fetch and remounts the pager, so "filtered but still on page 3" stops being expressible. Today it is six optional props and six broken callers.
3. **Match policy — yes, at the default, not at the call site.** `matchesQuery()` with correct normalization baked in (Gap 1). Per the contract: *prefer fixing the default over counting the callers.*
4. **The completeness precondition — no, and this is the honest answer.** Whether an array in memory is the complete candidate set is a fact about a *fetch in another file* — a `limit` in a store slice, a default parameter in an API wrapper, a cursor in a hook. No component-local type can carry it. A `CompleteSet<T>` newtype minted only by an unbounded fetch was designed and rejected: it would have to thread through every store slice, every selector and every `useMemo` in the repo to reach the one `.filter()` that needs it, and the first `as CompleteSet<T>` cast — which reviewers would write on day one for the 225 already-unbounded commands — silently reintroduces the whole class. **The realistic structural fix is one layer down and already specified elsewhere:** `paginated-list-query.md` Deviations P0 makes `QueryBuilder` bound by default so callers opt *down*; when a list command's bound is explicit, the client can be given a `hasMore` it must handle. Until then this class is doctrine (§4 step 2) plus a review obligation, not a type and not a gate.

**Convergence supports 1–3 and does not rescue 4.** `brainiac/console`'s
`review-surface.ts:141-143` — the only place in three repos where a client filter
over a server page is *correct* — does not solve it with a type either. It solves
it by **disclosure**: `scopeNote()` returns a sentence, rendered at
`ReviewWorklist.tsx:355` and unit-tested at `review-surface.test.ts:118-156`. A
second, independent codebase concluded that this precondition cannot be made
unrepresentable and must instead be *stated to the user*. That is why §4 step 9
prescribes disclosure rather than prevention, and why `Stream.tsx` — which
invented the identical answer with no shared document — is the site to copy.

## 10. Convergence — measured against `personas-web` and `brainiac/console`

A read-only census of both siblings was run specifically to sort physics from
local calibration. Two prescriptions were reinvented; one was **inverted**; and
the most valuable finding is a sibling achieving structurally what this repo does
by discipline — in a place this repo cannot follow.

| Clause | `personas` | `personas-web` (Next 16 / SWR) | `brainiac/console` (Next 15.5, **no state library at all**) | Verdict |
|---|---|---|---|---|
| **Filter → page reset** | **0 of 7** paginating surfaces reset | **3 of 3** reset (`EventsListPanel.tsx:89-91`, `executions/page.tsx:64-67`, `messages/page.tsx:163`) | **5 of 5** reset — via `resetPage = true` as a **default parameter** on the shared `setParams` closure (`Archive.tsx:199`, `DisputeBench.tsx:110`, `DocWiki.tsx:112`), pagers opting out explicitly | **Physics, and we are the outlier.** Two repos with no shared document both reset; both also get `.filter().slice()` ordering right. We are 0/7. |
| **Disclose a window-scoped filter** | 1 site (`Stream.tsx:200-203`) | absent | `review-surface.ts:141-143` — *"Filters, counts and select-all below cover rows {from}–{to} of {total} — this page, not the whole backlog"*, unit-tested | **Physics.** Independently invented, same sentence, same reason. |
| **filtered-zero ≠ no-data** | 5 known failures (§7 F) | 3 of 17 | **4 of 8, several 3–5-way**; `StandardsVariantBoard.tsx:20-21` states the doctrine in prose | **Physics** (already established in [`empty-and-demo-states.md`](./empty-and-demo-states.md)). |
| **A shared text matcher** | `searchItems`, 1 consumer; 121 hand-rolls | **none**; 8 hand-rolls, `.trim()` at 5 of 8 | one named+tested `matchesQuery` (`archive-data.ts:331-338`) — **module-private**, plus 4 re-derivations | **Physics — the absence is.** Three repos, three failures to consolidate. |
| **Accent / locale normalization in search** | **0** | **0** | **0** | **Physics, and universally unsolved.** Not one of three codebases normalizes. Prescribe it, but do not expect precedent. |
| **A shared debounce hook** | `useDebounce`, 5 users; 9 hand-rolls | **none** — 28 hooks, no debounce; **6 of 8 search inputs fire per keystroke** | **none** — 2 manual debounces at 220 and 250 ms, disagreeing on the constant | **Physics — the gap is.** We are ahead here; the hook exists. Adopt it. |
| **Filter state in the URL** | **structurally unavailable** — 0 `react-router`, 0 `useNavigate` | **1 of 17** (`connections/page.tsx:24-38`); the one hook, `useSearchParamState.ts`, has one call site | **5 of 8 — the URL is the sole source of truth, and the client store library is not installed** | **INVERTS the brief.** See below. |
| **A shared filter toolbar** | `FilterBar`, 2 adopters, 42 local | **`FilterBar`, 10 render sites across 9 files** — chip filters consolidated, text search 8 hand-rolls | 4 independent facet rails | **Local calibration, and we are the worst.** The sibling with 1/6 our surface count has 5× our adoption of the *same-named* component. |

### The claim that inverted, and what actually transfers

**The brief's premise — that `brainiac/console` "deleted its store problem
entirely by putting state in the URL" — is substantially true and does not
transfer.** It has no zustand, no redux, no jotai, no nuqs; its four server-backed
list surfaces drive filter, search, sort and page entirely through
`router.push("/console?…")` against `export const dynamic = "force-dynamic"`, and
a filter change *is* a refetch. `Archive.tsx:8-20` records that this replaced a
5,000-row client-side loop. It is the cleanest answer to five of this document's
sections at once — page reset, persistence, shareability, staleness, and the
completeness precondition — and **this repo cannot adopt it.** There is no
router, no URL, and no navigation event; Personas is a Tauri shell with
Zustand-driven sidebar routing. The transferable residue is only the *shape*:
one immutable filter object, resolved once, passed down, with page reset as a
property of the writer rather than a thing each caller remembers.

**But the sharper finding is how the sibling achieves it — and it is not
structurally.** The mechanism is an **8-line closure hand-copied verbatim into
three files** (`Archive.tsx:194-203`, `DisputeBench.tsx:105-114`,
`DocWiki.tsx:107-116`), with two further dialects in audit and reviews. The
primitive that *would* make it structural is already written and already tested:
`src/design/routes.ts:206-320` declares a `ConsoleAddress` type, a per-module
`ADDRESS_SPECS` allow-list, and `encodeAddress`/`decodeAddress` that drop
undeclared keys. **Production importers: zero** — only its own test file. And it
has already drifted out of sync with the modules it claims to govern:
`routes.ts:236` declares `docs: ["q","topic","status","page"]` while
`wiki-data.ts:75-82` actually reads `tab, space, q, page`, so two live keys are
undeclared and two declared keys are read by nobody. Its docblock (`:224-226`)
asserts *"the test suite compares this table against the modules' actual
readers"*; **no such test exists.**

That is the batch's most valuable transfer, and it cuts against the easy reading:
**a sibling can look structurally solved and be five hand-written copies of a
convention, with the real type sitting unused two files away.** The same shape
appears in `personas-web` from the other direction — it built
`useSearchParamState` and used it once, on a marketing page, while shipping
`DashboardScopeBar` (persona picker + date range + compare toggle, persisted to
`localStorage`, mounted on 8 dashboard routes) whose values **nothing reads**: a
filter bar that filters nothing. Convergence measures discoverability, not
correctness. Both siblings converged on a good idea and neither made it
unrepresentable, which is precisely why §9 proposes the type changes at *our*
primitives rather than importing theirs.

One clause has **no trace anywhere and is therefore flagged as house
convention**, not doctrine: filtering per-*dimension* rather than per-surface
(§1). Both siblings are uniform per surface — `personas-web` is 17/17 client,
`brainiac` is 4.5/8 server — and neither has a mixed component. Our 9 MIXED files
may be a symptom rather than a design, and the prescription in §2 is the
disciplined version of an accident.

## 11. The missing gate

### What the census can and cannot see, stated first

The highest-value condition in this document — *a filter is evaluated over an
array that is not the complete candidate set* — is **not enforceable**, and
recording that is a finding rather than a shortfall. It is a relation between a
`.filter()` in one file and a `limit` in another, reached through a store action,
a selector and an API wrapper; no regex and no single-file AST rule can decide
it. A rule keyed on "a `.filter()` in a component" matches all 79 CLIENT
bindings, of which 66 are correct — 84% false positives, which is exactly the
"keys on the markup, not the condition" failure the
[contract](../golden-path-contract.md#section-9-is-manifestation-layer-not-principle-layer)
warns against. Three things carry that half instead: the type fix one layer down
(§9 item 4), the disclosure pattern (§4 step 9), and the review obligation that
**a new `.filter()` over data fetched with a `limit` gets a human read** — the
same treatment `CLAUDE.md` gives crypto and IPC changes.

The class that *is* countable is text-match re-derivation, and it is the one
whose fix is a single primitive with correct defaults.

### Signal, and the condition it proxies

**Condition:** *a surface decides its own text-matching policy — case folding,
diacritics, whitespace, multi-term — instead of taking it from a shared matcher,
so the policy is set once per call site and can never be corrected centrally.*

**Proxy in this stack:** `.toLowerCase().includes(<identifier>)`. Requiring the
argument to start with an identifier character is what separates *matching a
user-supplied value* from *testing for a hardcoded literal* — without it the
signal also catches `label.toLowerCase().includes('(optional)')`,
`navigator.platform.toLowerCase().includes('mac')` and six more like them (65
files → 56 with the refinement).

**This proxy is manifestation-layer and must not travel.** In
`brainiac/console` the same condition wears a different shape entirely — the
server owns matching for the live path, so the idiom survives only in demo
fixtures (4 sites), and the module-private `matchesQuery` there would *itself*
match this rule while being the closest thing that repo has to the right answer.
An adopting repo re-derives its own proxy; what travels is the intent: count the
places that re-decide matching policy, and ratchet them toward one matcher whose
defaults are correct.

### Mechanism — one census rule, plus a positive control

Countable, ratcheting, and it inherits the fail-loud contract (`floor` breach,
zero-match, stale exclude, silent drop) from
[`scripts/census/`](../../../scripts/census/) rather than re-deriving it. **Do
not hand-merge this into `rules.json`** — three wave-2 composers concurrently
overwrote that file and lost a validated rule; hand this block to the
orchestrator.

```json
{
  "id": "call-site-text-match",
  "goldenPath": "docs/concepts/golden-paths/filtering-and-search.md",
  "title": "Text-match policy re-derived at the call site instead of taken from a shared matcher",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.toLowerCase\\(\\)\\s*\\.\\s*includes\\(\\s*[A-Za-z_$]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a case-folded substring match against a variable — the whole matching policy (case folding, diacritics, whitespace, multi-term) decided inline at the call site. This product ships 14 locales and contains zero toLocaleLowerCase and zero String.normalize('NF*') anywhere in src/**, while calling localeCompare at 180 sites to ORDER strings — so every one of these silently fails to match accented input. The destination is one shared matchesQuery() whose normalization is correct by default; see Gap 1 before ratcheting, because facetedTableModel.searchItems has the same defect today."
  },
  "exclude": [
    {
      "path": "src/test/**",
      "reason": "the MCP test-automation bridge resolves personas by fuzzy name in order to drive the app; it is a harness affordance, not a user-facing search surface"
    },
    {
      "path": "src/features/shared/components/display/facetedTableModel.ts",
      "reason": "searchItems() is the shared matcher this rule routes callers toward; counting the destination as a violation is how a ratchet stops measuring anything"
    }
  ],
  "baseline": { "files": 56, "matches": 121 },
  "floor": 4000
}
```

**The positive control.** Published with a `-positive-control` id suffix and **no
`baseline`**, so it asserts liveness rather than drift. It is a deliberate
superset of the gate over the identical roots, extensions and comment filter: if
the gate ever reports 0 while the control still reports its population, the
gate's regex is broken and the codebase is not clean. Note for the orchestrator:
`validateRule` (`engine.mjs:347-348`) currently **requires** integer
`baseline.files` / `baseline.matches`, so a baseline-free rule needs either a
schema relaxation or a `null` baseline branch in the runner — flagged rather than
worked around, because silently giving it a baseline would turn a liveness probe
into a second ratchet.

```json
{
  "id": "call-site-text-match-positive-control",
  "goldenPath": "docs/concepts/golden-paths/filtering-and-search.md",
  "title": "POSITIVE CONTROL for call-site-text-match — a deliberate superset that must never report zero",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.toLowerCase\\(\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "every case-folding call in the tree. Not a violation and never to be ratcheted — it exists so that a zero from call-site-text-match is provably a broken matcher rather than a finished migration. The gate is a strict subset of this population, verified 2026-08-14."
  },
  "floor": 4000
}
```

**Both populations, and their overlap** (measured 2026-08-14 against `master` @
`2a874e692`, via the real runner):

| | files | matches | walked |
|---|---|---|---|
| `call-site-text-match` (gate) | **56** | **121** | 4,829 |
| `call-site-text-match-positive-control` | **250** | **511** | 4,829 |
| overlap | **56** | — | — |

The gate is a **strict subset** of the control (0 files in gate ∖ control),
verified programmatically. Excludes are non-stale: `src/test/**` matches 14 files,
`facetedTableModel.ts` matches 1.

**Precision, measured by reading every hit.** Of the 56 files, **49 are
user-facing search or filter surfaces**; 7 match a value derived from data rather
than from a user (`ChannelsAtelier.tsx:81`, `CreateTwinWizard.tsx:130`,
`connectorMatching.ts:46,85`, `credentialGapAnalysis.ts:58`,
`protocolParser.ts:108`, `EmptyStateView.tsx:42`, `TestReportModal.tsx:505`) —
**87.5%** against the narrow reading. They are deliberately *not* excluded:
matching a connector named "Café" against `cafe` fails for exactly the same
reason and wants exactly the same primitive, so under the condition this rule
names they are true positives. Both numbers are stated so the next reader can
challenge the choice rather than inherit it.

**Verified by two independent implementations, as the contract requires.** A
TypeScript-AST pass (walking `CallExpression` nodes and testing whether the
receiver of `.includes()` contains `toLowerCase()`) and the census engine's
whole-file regex agree exactly at **65 files / 133 matches** on the unrefined
signal — the number this rule then narrows to 56/121 by requiring an identifier
argument and excluding the harness and the destination. Agreement between a
node-shaped and a text-shaped matcher is what makes the count trustworthy; a
single implementation would have baselined the literal-matching false positives
without noticing them.

**Fail-loud, verified by deliberate break rather than assumed:**

| Break | Result |
|---|---|
| raise `floor` 4000 → 6000 | `[structural] walked 4829 files but floor is 6000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| lower `baseline` by 1 | `files rose 55 -> 56 (+1)` · `matches rose 120 -> 121 (+1)` — both branches fire |
| repoint an `exclude` at a path that no longer exists | `[structural] exclude "…" matched no file. The exemption is stale` |
| a silent drop without a baseline update | `dropped … without the baseline moving. A silent drop is a broken matcher more often than fixed code` |

**Severity: `warn`-equivalent is not on the table and neither is arguing from
volume.** This is a census rule, so it is binary — `npm run census:check` exits
non-zero on drift regardless of count, and the count is the ratchet, not the
threshold. The [lint baseline note](../../../.claude/CLAUDE.md) is the reason:
`npm run check` runs `eslint src/` with no `--max-warnings` and the pre-commit
hook runs `--quiet`, so a warn-level rule enforces nothing at either gate at any
count. The census exists precisely to sidestep that.

**Ratchet policy.** Do **not** ratchet this baseline down before Gap 1 lands. A
migration from 121 hand-rolls to a `matchesQuery()` that is itself
`toLowerCase().includes()` moves the number and fixes no user-visible defect —
the exact failure the contract's fifth mode describes. Land the primitive with
correct normalization first, verify it against an accented fixture, *then* ratchet
with `npm run census -- --update` behind each migration commit.

### The complementary ESLint rule, and why the census cannot do its job

One further half of the doctrine is genuinely AST-shaped and must not be
attempted with a regex: **a `DataGrid` whose `data` prop is a filtered
collection must carry a reset key.** Specify `custom/require-filter-page-reset`:
on a `JSXElement` named `DataGrid` or `FacetedDecisionTable` whose `pageSize` is
set (or defaulted) and whose `data` expression resolves to an identifier bound by
a `useMemo` whose dep array contains an identifier matching
`/^(search|query|\w*[Ff]ilter\w*)$/`, report when no `key` prop is present.
`RuleTester` fixtures come free: `useGalleryQuery.ts:197-204` is the positive
case (a real reset), `CredentialList.tsx:145` and `FacetedDecisionTable.tsx:190`
the negatives. This is unreachable from a whole-file regex — the `useMemo`, the
dep array and the JSX are routinely two hundred lines apart, and co-occurrence of
the tokens says nothing about whether they are the *same* collection. The two
compose as the contract intends: **the rule reports the semantics, the census
ratchets the population.**

## See also

- `data-persistence/dynamic-filter-query` — the other side of the seam in §1. Owns `QueryBuilder` predicate composition, `escape_like` (and the `where_like_any` / `where_like_escape_any` split, where one of the pair omits `ESCAPE`), the supporting index, and keeping the counts query on the page query's filter builder.
- [Paginated list query](./paginated-list-query.md) — bounds the fetch this path filters. Its Deviations P0 (`QueryBuilder` treats bounding as opt-in) is the structural cause of Deviations A here. Note its corrected Gap 3: **keyset indexes prevent the SCAN but not the SORT** — the composite OR-cursor forces a temp B-tree on the real 347 MB database, so do not add an index expecting a filtered page to get its ordering for free.
- [Tables & list surfaces](./tables.md) — renders the rows this path narrows, and owns `rowReveal={{ resetKey }}`, which wants the same `filterKey` (Gap 9).
- [Empty and demo states](./empty-and-demo-states.md) — owns the frame after the filter settles to zero. This path's §4 step 8 is its step 4; do not re-derive the taxonomy.
- [Stale response guard](./stale-response-guard.md) — a server-side filter is an entity-keyed fetch. `useLayeredList`'s `epochRef` (`:105`) is that guard already applied; a hand-rolled filter fetch needs `createLatestWins()`.
