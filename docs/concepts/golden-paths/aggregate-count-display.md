# Golden path — Aggregate count display

> **Topic path:** `ui-system` › `chrome-and-feedback` › `aggregate-count-display`
> [situation spine](../situation-spine.md) · recurrence 27 · risk **MEDIUM** · sides: **client**
> (spine also carries `twoSided: true` — see §12.1) · convergence: **mixed** ·
> dimensions: **function · ui · performance**
> `mergedFrom`: *Summary count strip* + *Attention counts and badges* + *Attention badge registry*
> Composed 2026-08-16 against `master` @ `e3c5e0d7f`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` (2,104 `.tsx`) walked by **three**
> independent matchers; all **953** `.rs` across `src-tauri/{src,db,engine,core}` for the count
> doors and their SQL. Every `#[tauri::command]` registration in `lib.rs` (**1,588** lines)
> classified for count-shape. All **19,112** `en.json` leaf keys scanned for `N of M` strings
> (**139** found). `BadgeSlot.tsx`, `FilterBar.tsx`, `lib/attention/registry.ts`,
> `hooks/useAttention.ts`, `hooks/sidebar/useBadgeCounts.ts`, `eventSlice.ts`, `alertSlice.ts`,
> `messageSlice.ts`, `memorySlice.ts`, `overviewSlice.ts`, `MemoriesPageDense.tsx`,
> `GlobalExecutionList.tsx`, `LlmCallsTable.tsx`, `ManualReviewList.tsx`, `EventLogList.tsx`,
> `companion/attention/useAttentionCounts.ts` and the four `count_*` repo functions read in full.
>
> **Measured by execution, not by reading.** Every count below was replayed — the app's own
> fetch limit, its own filter predicate, its own `.length` — against a read-only **copy** of the
> operator's live 347 MB `personas.db` (+ the 17 MB `personas_data.db`), copied 2026-08-16 21:08
> UTC with the app running; the live files were never opened for write and the copies were
> deleted afterwards. 78 personas, 2,188 executions, 6,535 memories, 4,972 events, 194 manual
> reviews. **§0 publishes the number on screen beside the number that is true.**
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. `personas-cloud` has **zero** `.tsx` and is
> reported as structurally absent rather than counted as a choice. The oracle **confirmed this
> repo's own registry docstring by finding its predicted failure in a sibling** (§6 clause 4) and
> found a sibling that had already written this path's headline defect down in a comment (§6
> clause 3).
>
> **Shared facts cited:** [`shared-facts.json`](../shared-facts.json) — 963 Rust files, 4,829
> `.ts`, 2,104 `.tsx`, 1,135 lint warnings / 0 errors.
>
> **Settles:** where the number in the badge comes from, and whether it agrees with the list it
> labels.

---

## 0. The headline

**The Memories page asks you to confirm an irreversible delete with a number that is the page
size. The dialog says it will delete 100 memories. It deletes 6,535.**

`src/features/overview/sub_memories/components/MemoriesPageDense.tsx:388`:

```tsx
body={tx(t.overview.memories.delete_all_confirm_body, { count: memories.length })}
```

`en.json` → `overview.memories.delete_all_confirm_body` = *"This permanently deletes all {count}
memories. This cannot be undone."*

Replayed against the live database:

| | value | source |
|---|---:|---|
| what the confirmation dialog renders | **100** | `memories.length` — and `memorySlice.ts:112` fetches with `limit = 100` |
| what `delete_all_memories` destroys | **6,535** | `DELETE FROM persona_memories WHERE tier != 'core'` (`db/src/repos/core/memories.rs:1055`) |
| **understatement** | **65×** | |
| of which are rows the list deliberately hides | **2,026** | `category='context' AND tier='working'`, excluded by `build_memory_filters` (`memories.rs:99-110`) |
| of which are rows the tier filter excludes | **1,377** | `tier='archive'`, excluded because the fetch passes `tier: "!archive"` |
| `core` rows that survive, despite the word "all" | **0 today** | the copy is wrong in the other direction too, and silently correct only because this install has no `core` memories |

**The number is exactly the fetch limit.** That is the tell: `100` is not a count of anything in
the world, it is `LIMIT 100` rendered as a fact, and nobody ever compared it to what the button
does. And the true total was **already destructured in the same component** —
`memoriesTotal` at `:57`, rendered in the page header at `:194` — so the component displays
**3,132** in its subtitle and **100** in its delete dialog, for the same set, 194 lines apart.
Three numbers for one question: 100 (dialog), 3,132 (header, the filtered total), 6,535 (what the
DELETE removes).

### The same strip disagrees with itself

`MemoriesPageDense.tsx:151-165` builds one KPI row from two populations:

```ts
const stats = useMemo(() => {
  const tierCounts = memories.reduce(...);          // over the 100-row PAGE
  const totalAccess = memories.reduce(...);         // over the 100-row PAGE
  return { total: memoryStats.total, ... };         // a real SQL COUNT
}, [memoryStats, memories]);
```

Rendered side by side at `:273-283`. Executed:

| tile | renders | true | |
|---|---:|---:|---|
| **Total** | 3,132 | 3,132 | ✅ a real `COUNT(*)` |
| **Core** | 0 | 0 | coincidence — this install has none |
| **Active** | **100** | **3,132** | **3.2%** — and it renders *exactly the page size* |
| **Archive** | **0** | **1,377** | the fetch filter is `tier != 'archive'`, so this tile is **structurally incapable of being non-zero** |
| **Total Access** | **170** | **95,644** | **0.18%** |

**And "Total Access" changes by 24× when you click a sort header** — 170 under
`ORDER BY created_at DESC`, **4,088** under `ORDER BY importance DESC`, because sorting changes
*which* 100 rows are in the page. Sorting a table changed a total.

### Then look at the Activity bar, where the badges are right and the sentence is wrong

`GlobalExecutionList.tsx:388-395` renders a `FilterBar` whose badges read the server counts
(`count_executions`, correct) and whose `summary` string pairs a client array with the *unfiltered*
total. Replayed at each tab:

| tab | badge | rows loaded | summary renders |
|---|---:|---:|---|
| All | (2188) | 50 | "Showing 50 of 2188" |
| Running | (0) | 0 | "Showing 0 of **2188**" |
| Completed | (1928) | 50 | "Showing 50 of **2188**" |
| Failed | (238) | 50 | "Showing 50 of **2188**" — the badge two inches left says 238 |

`fetchGlobalExecutionCounts(personaId)` takes no status, so **the denominator never moves with the
tab** while the numerator does. On the Failed tab the sentence is wrong by **9.2×**, next to a badge
that is right.

Its sibling `LlmCallsTable.tsx:278` uses the same i18n key with a numerator additionally filtered by
a **time window** (`7d` by default) against the same all-time denominator. On this install the
newest execution is 2026-06-26, so the LLM Calls tab renders, today, in a real build:

> **"Showing 0 of 2188"**

### And the four filter badges do not sum to the badge above them

`count_all_global` (`db/src/repos/execution/executions.rs:337-388`) accumulates `total` over **every**
status and buckets only `running|queued|pending` / `completed` / `failed`:

```
All 2188   ·   Running 0 + Completed 1928 + Failed 238  =  2166   ·   unaccounted 22
```

**22 rows (`cancelled` 2, `incomplete` 20) are inside "All" and inside no other badge**, so clicking
through every filter never reaches them. And 2,166 is not a coincidence: it is the same number the
SLA card renders as *"1928/2166 executions"*
([`data-provenance-disclosure` §0](./data-provenance-disclosure.md)). **Two surfaces in the same
product say "executions" and mean 2,166 and 2,188.**

### The badge that is meant to be the single source of truth

`src/lib/attention/registry.ts` exists precisely to stop this, and says so:

> *"Sidebar badges, dashboard headers, tab indicators, and any other consumer reads counts via
> `useAttention()` rather than wiring up its own selector — this eliminates the historical drift
> between sidebar and dashboard counts that came from each surface fetching independently."*

Its five domains, classified by where the number actually comes from:

| domain | source | bound by |
|---|---|---|
| `pending_reviews` | `get_pending_review_count` → `SELECT COUNT(*)` | ✅ nothing |
| `unread_messages` | `get_unread_message_count` → `SELECT COUNT(*)` | ✅ nothing |
| `pending_events` | `listEvents(50).filter(status==='pending').length` (`eventSlice.ts:28`) | **the 50-row page** |
| `active_alerts` | `alertHistory.filter(a => !a.dismissed)` over `listFiredAlerts(200)` | **the 200-row page** |
| `memory_actions` | `memoryActions.length` — a `localStorage` array | **whatever the browser kept** |

**Three of the five counts in the registry built to end drift are counted over a truncated client
array.** The registry is not the defect; it is the right artifact, correctly reasoned, holding two
honest numbers and three page sizes.

### And a failed count read renders as a badge that is not there

`overviewSlice.ts:469-477`:

```ts
} catch (err) {
  log.warn('overviewSlice', 'fetchPendingReviewCount failed, defaulting to 0', …);
  set({ pendingReviewCount: 0 });
}
```

`SidebarLevel1.tsx:91`: `active: pendingReviewCount > 0`.

**A failed read sets the count to zero, and zero removes the badge.** The failure mode is worse than
the one [`metric-definition`](./metric-definition.md) found in metrics: a metric that cannot be
measured renders a wrong `0%` and is at least *visible*; a count that cannot be read renders
**nothing at all**, and "you have no work waiting" is indistinguishable from "we could not ask".
The same shape at the shared primitive: `FilterBar.tsx:63` —
`const showBadge = opt.badge != null && opt.badge > 0;` — so a filter tab whose count is unknown and
a filter tab whose count is genuinely zero are the same pixels.

Executed, one hop out: `fetchPersonaSummaries` (`personaSlice.ts:184-206`) fills
`personaTriggerCounts`, its `catch` is a `logger.warn` with no state change, and every consumer
reads `triggerCounts[id] ?? 0`. If that one read fails or has not settled, the Agents overview
renders **"0 triggers" on all 78 persona rows**, while **66 of them have at least one enabled
trigger and 325 enabled triggers exist**. `?? 0` converts *"we don't know"* into *"none"* on **85%**
of the rows, silently.

### The denominator of the whole problem

| | count |
|---|---:|
| `#[tauri::command]` registrations in `lib.rs` | **1,588** |
| …that are a dedicated **count door** (return a count, not rows) | **18** (1.1%) |
| repo reads that apply `limit.unwrap_or(N)` — i.e. hand back a truncated page | **102** |
| …of which default to a page of 50 | **47** |
| call sites of a count door in `src/` (census control) | **22** in **15** files |
| per-entity counts read from a lookup and defaulted to `0` (census rule) | **40** in **30** files |
| `N of M` strings in `en.json` | **139** of 19,112 |
| shared components whose job is "render a number in a pill" | **1** (`FilterBar.badge?: number`), plus a sidebar-local `CountBadge` |
| …whose count prop can express **unknown** | **0** |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics.** **A count is a claim about a set, so name the set before you name the number.**
> Every displayed count answers *"how many X, over what scope, as of when"*. A count rendered
> without its set is not a small fact missing a caption; it is an unfalsifiable one — the reader
> cannot tell whether it disagrees with the list beside it, because they were never told the two
> describe the same thing.
> *Warrant: measured here as three numbers for one question in one component, and confirmed by a
> sibling repo that wrote the identical hazard into a code comment with no shared document.*
>
> **P2 — physics, and the sharpest clause here.** **Ask the source for a count; never count the
> page.** The collection the client is holding is a *page*, a *filter*, a *cache* or a *window* —
> its length is a fact about your fetch, not about the world. The two agree only while the set is
> small, which is exactly the period during which nobody notices the difference.
> *Warrant: executed at 65× on a destructive confirmation, 31× on a KPI tile, and 24× swing on one
> tile from a sort click; and reinvented as a dedicated counts endpoint, with a written rationale,
> in three of five repos surveyed.*
>
> **P3 — physics.** **A numerator and a denominator shown together must be over the same
> population.** "N of M" is a single sentence and the reader parses it as one. If N moves with a
> filter, a window or a page and M does not, the sentence is false in a way no individual number is.
> *Warrant: executed here as "Showing 0 of 2188"; independently identified and fixed in a sibling
> whose comment reads "two honest numbers that read as one dishonest one unless the page says what
> it is".*
>
> **P4 — physics.** **An unknown count is not zero, and zero is not nothing.** The three states a
> count display must distinguish are *unmeasured*, *measured as none*, and *measured as some*. A
> UI that hides the badge at zero collapses the first two into an absence, which is the one
> rendering a reader cannot question.
> *Warrant: the failed-read-to-zero path is present in all four UI repos in the cohort; the two
> that type the value nullable are the two that render an em dash instead.*
>
> **P5 — ergonomics.** **The count and the thing it labels must read from one source.** A badge on
> a tab, a total above a list and a sidebar pill for the same concept are three renderings of one
> number, and any two of them fetched separately will disagree — at different cadences, from
> different windows, under different failure modes.
> *Warrant: the only repo in the cohort with a central attention registry is the one that grew a
> second, rival registry; the only sibling with a partial one has three surfaces of which one
> bypasses it.*
>
> **P6 — ergonomics.** **A truncated count must carry the untruncated one.** `99+` is a layout
> decision; it must not be an information decision. Where the exact value exists, it belongs in the
> hover, the label, or the aria text.
> *Warrant: three truncation sites across the sibling cohort, none carrying the real number; the
> one implementation that does carry it does so because its tooltip was written for a different
> reason.*
>
> **P7 — ergonomics.** **A count that gates a destructive action is part of the consent, not part of
> the chrome.** The number in "delete all {n}" is the only quantity the user is agreeing to. It must
> come from the operation's own scope — not from the list, not from the filter, not from the page.
> *Warrant: three sibling confirmation dialogs in this repo, same shape, same week; the one that
> read the page understates by 65×.*
>
> **Scale condition.** P3, P4 and P7 are correctness on day one, at any size. P1, P2 and P5 are
> invisible until the set outgrows the first page — which is also the first moment anyone cares
> about the number. P6 bites at 100.

---

## 1. Trigger

- "Put a count on that tab." / "show how many are pending" / "add a badge to the sidebar"
- "Show N of M above the list." / "how many are there in total?"
- "Why does the sidebar say 3 and the page say 5?"
- "The badge disappeared but there are still items."
- "Delete all — how many is that?"
- "It says 99+, how many actually?"

**If you are about to write** `.length` (or `.filter(…).length`, or `.size`) **into anything a user
reads as a quantity** — a badge, a pill, a tab suffix, a subtitle, an `N of M`, a confirmation
sentence — **you are in this situation.** Likewise if you are about to write `count ?? 0`,
`counts[id] ?? 0`, `count > 0 &&`, or `badge={n}`.

You are **not** in this situation when the question is how to *bound the fetch*
([`paginated-list-query`](./paginated-list-query.md)), what the number *means*
([`metric-definition`](./metric-definition.md)), or how it is *formatted*
([`number-and-cost-formatting`](./number-and-cost-formatting.md)).

### Boundaries with the adjacent leaves

The seam test: **would changing it change which rows exist, what the number counts, or how many of
them you were told about?**

| Territory | Owner | Do not restate |
|---|---|---|
| Bounding the fetch — `limit`, `.clamp()`, cursors, `hasMore`, `useLayeredList`, writing the counts query | [`paginated-list-query`](./paginated-list-query.md) | It owns **producing** the count endpoint and the page. This path owns **what the pixel does with them.** Its §9 explicitly disclaims this leaf: *"whether the rendered total describes the same set as the rendered rows"* is listed under **what no gate can catch**. Its §11 step is *"read the total from counts, never from `rows.length`"*; this path is the half that measures what happens when you don't. |
| The numerator/denominator predicate of a **rate**, the window, the unit, `Option<f64>` for an empty sample | [`metric-definition`](./metric-definition.md) | A rate is a *derived* number over a sample; a count is a *cardinality*. Its §9 rule is Rust-only and has **0 file overlap** with this one (measured). Its `else { 0.0 }` and this leaf's `?? 0` are the same instinct in two languages against two different quantities. |
| Whether the pixel says how the number was **made** — measured / proxied / simulated, staleness, `(n=…)` | [`data-provenance-disclosure`](./data-provenance-disclosure.md) | Its P3 (*"two numbers on one screen over two populations must say so"*) is the disclosure half of this path's P3. **The difference is the prescription:** it says *disclose the difference*; this path says *do not create it — ask the source*. Where the difference is irreducible (a rollup vs raw), disclosure is the answer and this path defers. |
| What a *failed* source's value becomes, per-source error envelopes | [`partial-failure-read-envelope`](./partial-failure-read-envelope.md) | It owns the **read**; this owns the **badge**. Its rule needs a `.catch(`; §0's `catch { set({ pendingReviewCount: 0 }) }` has none, and **0 of my 30 files overlap its 32** (measured). |
| Separators, locale, `<Numeric>`, `tabular-nums` | [`number-and-cost-formatting`](./number-and-cost-formatting.md) | It owns how `1234` becomes `1,234`. |
| Whether "nothing here" is a real empty state | [`empty-and-demo-states`](./empty-and-demo-states.md) | A zero badge and an empty list are the same claim rendered twice; that path owns the list's rendering, this one owns the badge's truth. |
| Whether a destructive confirm is informed | [`informed-consent-gate`](./informed-consent-gate.md) | It owns the *gate*. **§0's dialog passes that gate and lies inside it** — see §6 "composition defect". |
| Whether a rate's *bar* is honest, or a chart's scale | [`proportional-bar-list`](./proportional-bar-list.md) · [`chart-component`](./chart-component.md) | They own encodings. |

---

## 2. The one way

**Ask the source how many there are; never count what you happen to be holding — and if you must,
say so on the pixel.** Concretely: (a) **for every list surface, ship a counts door beside the page
door** — one `GROUP BY` returning every bucket the UI will badge, built from the *same* filter
clause as the page query so the two cannot drift, and read it into the badge; this repo has 18 such
doors against 102 paginated reads and the ratio is the whole defect surface. (b) **Make the
numerator and the denominator of any `N of M` come from one scope**: if N respects a status tab, a
time window or a persona filter, M must respect it too — pass the filter to the counts call, or do
not render the `of M` at all. (c) **Type an unmeasured count as absent, not zero** — `number | null`
on the prop, `null` while loading and after a failed read, rendered as a neutral affordance rather
than a hidden badge; `?? 0` on a count is the client asserting a fact it does not have. (d) **Never
compute a badge from a collection a sibling component paginates** — if you need the number and the
rows, fetch the count and the page together in one call, the way `messageSlice.ts:45-49` does with
`Promise.all([listMessages(PAGE, offset), getMessageCount(), getUnreadMessageCount()])`. (e) **After
any optimistic mutation, re-ask the source** — the local array is a page and the delta is not the
total; `messageSlice.ts:130` is the model and it says why in a comment. (f) **Register every
"needs your attention" count in one module** so the sidebar, the header and the tab cannot drift;
this repo has that module and the fix is adoption, not invention. (g) **When a count is over a
partial set on purpose, mark it** — `"50+"`, `"on this page"`, a scope pill — the way
`EventLogList.tsx:284` appends `+` when the server says there is more. (h) **A count that gates a
destructive action reads the scope of the operation**, never the list. Then stop: do not add a
second badge for the same concept, do not hide a badge because its value is zero without knowing it
*is* zero, and do not put the exact number only in a `title=`.

If you must get one right first: **(b)**. (a) is the enabler and (c) is the correctness fix, but a
mismatched `N of M` is the only one of the three that is *provably* false from the screen alone,
which is why it is the one users report.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`src/lib/attention/registry.ts`** — `ATTENTION_REGISTRY`, `AttentionDomainId`, `attentionDomainsForScope(scope)` | **The count registry.** Five closed domain ids, each with `scopes` (`sidebar \| dashboard \| overview \| observability`) and a `count: (s: OverviewStore) => number` derivation, `Object.freeze`d. Its header states the rule and the failure it prevents. **Adding a domain is one entry; UI code does not change.** | **1 hook** (`useAttention`) |
| **`src/hooks/useAttention.ts`** — `useAttention(scope?) → { counts, total, domains }` | The accessor. `useShallow` over the store so a badge re-renders only when its own number moves; `domains` is handed back so a surface can render a *list* of badges without hard-coding the vocabulary. | **4** (`useBadgeCounts.ts:33`, `useNavCardStatus.ts:63`, `DashboardHomeMissionControl.tsx:118`, `ObservabilityDashboard.tsx:83`) |
| **`src-tauri/src/commands/execution/executions.rs:83-95` — `count_executions` → `ExecutionCounts`** | **The counts-door exemplar, with the doctrine in its doc comment**: *"Return precise counts for the Activity filter badges (total / running / completed / failed) … Unlike `list_all_executions` this is not paginated, so the frontend can display accurate totals regardless of how many rows have been loaded."* One `GROUP BY status`, same `_ops` exclusion as the list query, four typed fields via ts-rs. | 1 store action → 2 surfaces |
| **`src/stores/slices/overview/overviewSlice.ts:33-52`** — `globalExecutionsHasMore: boolean` + `globalExecutionCounts: ExecutionCounts` | **The type fix, already earned in this repo, with the incident in the comment**: *"Previously this field was a misnamed number `globalExecutionsTotal` set to `merged.length + (rawCount >= limit ? 1 : 0)` — looking like a row count but actually being a +1 sentinel; consumers wiring 'X of Y' UIs silently displayed wrong numbers. Renamed and retyped as a boolean to make misuse a type error."* Followed by: *"This is the authoritative total — read `globalExecutionCounts.total` for any 'N of M' display."* | — |
| **`src/stores/slices/overview/messageSlice.ts:41-56`** — `fetchMessages` | **Page and both counts in one `Promise.all`**: `listMessages(PAGE_SIZE, offset)`, `getMessageCount()`, `getUnreadMessageCount()`. The list, its total and its unread badge can only disagree if the database does. | 1 |
| **`messageSlice.ts:123-134`** — `markAllMessagesAsRead` | **Optimistic-then-reconciled**, with the reason on the line: `await get().fetchUnreadMessageCount();` — *"Fetch authoritative count in case the loaded list is a partial page."* **The only count reconciliation in this repo or any sibling.** | 1 |
| **`src/features/overview/sub_manual-review/components/ManualReviewList.tsx:138-152`** — `statusCounts` | **The filter-tab exemplar**, with the rule stated: *"Filter-tab badges read the L0 counts (one `GROUP BY`) for the local reviews — accurate over the whole table even though only a page is loaded — plus the (small, fully-loaded) cloud set."* It adds a page-derived count *only* for the set it knows is fully loaded, and says which is which. | 1 |
| **`src/features/shared/components/overlays/FilterBar.tsx`** — `FilterOption.badge?: number`, `badgeStyle: 'badge' \| 'paren'`, `summary?: string` | **The shared filter-count slot** — the only shared component in the app (or in any of the five repos) with a prop whose job is a count. Read §8 Gap 1 before adopting: `badge` is `number` so it cannot say *unknown*, and `summary` is a free `string` so nothing couples its two halves. | **7** files |
| **`src/features/shared/chrome/sidebar/BadgeSlot.tsx`** — `BadgeDefinition { count?, variant: 'count'\|'pulse'\|'dot', priority, active, label }` + `CountBadge` | **The sidebar count pill**, priority-ranked so one button never stacks badges, with a `+N` suppressed-badge counter and a `Tooltip` listing every active state. Renders `'99+'` above 99 — **and the tooltip carries the exact number**, because `label` is built as `` `${n} pending review(s)` ``. **No sibling repo's truncated count carries its real value** (§6 clause 6). | 1 (the L1 rail) |
| **`src/features/plugins/companion/attention/useAttentionCounts.ts`** | **The agreement rule, stated**: *"Reads the same stores the level-2 surfaces read, so a chip's count and the cards it reveals can never disagree. The surfaces themselves stay self-gating (each returns null when empty) — this hook only decides what the bar advertises."* This is P5 written down. See §7 D6 — it is also a second, rival registry. | 1 bar, 5 chips |
| **`src/features/overview/sub_events/components/EventLogList.tsx:284`** | **The truncation marker**: `` total: `${recentEvents.length}${serverHasMore ? '+' : ''}` `` → *"17 of 50+ events"*. The only place in the app that admits a denominator is a page. | 1 |
| **`src/api/overview/memories.ts:114-131`** — `listMemoriesWithStats` → `{ memories, total, stats }` | **One round trip returning the page, the filtered `COUNT(*)`, and a per-category/per-agent breakdown**, all built from one `build_memory_filters` so the page and the counts cannot use different predicates (`db/src/repos/core/memories.rs:690-726`). The payload is right; §0 is what the consumer did with it. | 1 |

**Explicitly NOT primitives:**

- **`display/Numeric.tsx` (212 render sites).** It formats a number and renders `null` as an em
  dash — which means it *can* express absence — but it has no prop for scope, sample, page-bound-ness
  or partial-ness, and no call site passes `title`. Routing a count here satisfies
  `number-and-cost-formatting` and does nothing for this leaf. Confirms
  [`data-provenance-disclosure` §8 Gap 1](./data-provenance-disclosure.md) from a second direction.
- **`display/Badge.tsx`.** A colour/shape token carrier taking `children: ReactNode`. It has no idea
  it is holding a number.
- **`display/StatusBadge.tsx`, `display/StatCard.tsx`, `KpiTile`.** Status and value tiles;
  `value` is `string | number` and carries no scope.
- **`KpiMetric` in `MemoriesPageDense.tsx:543` and `MemoriesPageGraph.tsx:521`.** A hand-rolled
  count-display component, **defined twice, byte-similar, in two sibling files** — the shape §8
  Gap 1 says should be shared, invented locally and then copied.

---

## 4. Steps

1. **Name the set out loud before you write the number.** "Pending reviews, all personas, all time."
   "Failed executions, this persona, last 7 days." If you cannot finish the sentence, you do not yet
   know what to fetch.
2. **Look for a counts door.** 18 exist (`count_executions`, `get_memory_count`,
   `get_message_count`, `get_unread_message_count`, `get_pending_review_count`,
   `get_manual_review_counts`, `get_thread_count`, `get_team_counts`, `count_dead_letter_events`,
   `count_design_reviews`, `count_event_listeners`, `count_team_channel_kinds`,
   `dev_tools_count_pending_acceptance`, `dev_tools_pending_counts`, `get_team_memory_count`,
   `get_frontend_crash_count`, `get_referral_count`, `companion_count_brain_items`). If yours
   exists, use it and skip to 5.
3. **If it does not, write one** — see [`paginated-list-query` §4 step 4](./paginated-list-query.md):
   the counts fn lives in the same module as the page fn and shares its WHERE-clause builder. Return
   **every bucket the UI will badge in one struct**, the way `ExecutionCounts` does; four badges from
   one `GROUP BY` beats four calls. Give it `#[ts(export)]`.
4. **Make the buckets exhaust the total, or say they don't.** `ExecutionCounts.total` counts every
   status and its three siblings cover four — so 22 live rows are in "All" and in nothing else.
   Either add the bucket or name the residue (`other`), but do not ship a set of tabs the user
   cannot reach the bottom of.
5. **Fetch the count with the same filter as the rows.** If the surface has a status tab, a window
   picker or an entity filter, the counts call takes them too. A counts call that ignores a filter
   the rows respect *will* produce §0's "Showing 50 of 2188".
6. **Type the count so unknown is representable.** `number | null` on the prop, `null` until the
   first fetch settles and after a failed one. Never `?? 0` on a value that came from a network read
   or a lookup keyed by an entity — that is the client asserting a fact it does not have.
7. **Decide what `null` renders as, at the primitive.** A dimmed dot, a `—`, a skeleton pill — never
   an absent badge, because absence already means "zero" and you have just spent it.
8. **Register it if it is an attention count.** One entry in `ATTENTION_REGISTRY` with its `scopes`;
   every surface then reads `useAttention(scope)`. **And then stop** — do not add a selector.
9. **Reconcile after every mutation.** Optimistic `+1`/`-1` on the store is fine for the pixel;
   re-ask the source in the same handler. `messageSlice.ts:130` is nine words of comment and one
   `await`.
10. **If the number is genuinely over a page, mark it on the pixel** — `"50+"`, a `scope` pill, or
    `"on this page"`. `EventLogList.tsx:284` is the one-line version.
11. **For a destructive confirm, count the operation's scope, not the list's.** Read the backend's
    own predicate. If they differ — as `delete_all`'s `tier != 'core'` differs from the list's
    `tier != 'archive' AND NOT (category='context' AND tier='working')` — the dialog must state the
    backend's, and the copy must not say "all" when it means "most".
12. **Stop.** No second badge for the same concept, no `.length` in a sentence a user reads as a
    total, no hiding a badge you have not measured.

### Can the type make the wrong call impossible? — asked before §9

**Split answer, and both halves are one-line edits to shared code.**

**T1 — YES for the unknown/zero axis, and this repo has already run the experiment on the exact
prop shape.** The bad state is `badge?: number` — a type in which "we have not measured this" and
"we measured zero" are the same value, and where the render then collapses both into *nothing*:

```ts
// FilterBar.tsx:13, :63 — today
badge?: number;
const showBadge = opt.badge != null && opt.badge > 0;
```

`badge?: number | null` with `null` meaning *unmeasured*, rendered as a dimmed placeholder, makes the
`?? 0` at every call site a type error instead of a habit. Held against the seven qualifications:

- **Q1 (a type carries only what it encodes).** `number | null` encodes *"there may be no
  measurement"*. It encodes **nothing** about scope — a `null`-able badge can still be a page count,
  which is why §2 (a), (b) and (g) are separate mandates and not folded in. This is the same
  qualification [`metric-definition`](./metric-definition.md) earned on `successRateSource`: the
  closed tag was right and the *unit* lived in the number beside it.
- **Q2 (requiredness ≠ closedness).** Making `badge` required changes nothing; the wrong value is
  `0`, not the absence of the prop.
- **Q3 (a type nobody constructs constrains nothing).** **This is the qualification that decides
  the scope.** `FilterBar` has **7** consuming files and `BadgeDefinition` **1** — small, closed,
  reachable; the edit lands. A general `Count` newtype across the 40 census sites and the 141 JSX
  `.length` renders does **not** meet Q3: there is no shared numeric wrapper in `src/lib/`, and
  inventing one 180 call sites must adopt is a refactor, not a type. **Ship the nullable prop on the
  two count primitives; treat the general wrapper as direction.**
- **Q4 (a type anyone can construct authenticates nothing).** `number | null` is not an
  authentication claim and does not pretend to be; a caller can still pass `xs.length`. That is what
  §9 ratchets and what T2 addresses.
- **Q5/Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is **the
  0-default**, not the number. Withholding the number would break the badge.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily).**
  Nothing today *forces* `?? 0`; the callers volunteer it. So the nullable type alone is inert
  unless the render arm changes too — `null` must render *something*. **Both edits or neither.**

**T2 — YES, and stronger, for the `N of M` axis, because the defect is a free-form string.**
`FilterBar.summary?: string` lets `LlmCallsTable` assemble a window-filtered numerator and an
all-time denominator into one sentence, and nothing objects because it is a `string`. Replace it:

```ts
summary?: { shown: number; total: number | null; scope?: string };
```

Now the two halves cross the boundary as data, `total: null` is spellable for "we did not ask", the
component owns the i18n key, and the *pairing* becomes the thing a reviewer can see. **This is the
[contract's fifth §9 failure mode](../golden-path-contract.md) in the good direction**: fix the
destination before ratcheting the callers — one edit at `FilterBar` reaches all 7 surfaces, and no
ratchet would have moved a single one.

**T3 — NO for "did you ask the source".** No type can distinguish `xs.length` where `xs` is a page
from `xs.length` where `xs` is the whole set, because both are `T[]`. The reachable approximation is
`paginated-list-query`'s: make the page type `{ rows, total }` so the total is *in scope* wherever
the rows are. §0 shows that is necessary and not sufficient — `memoriesTotal` was in scope, in the
same destructure, and the dialog counted the array anyway. **That residue is what §9 gates.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`.length` of a fetched array rendered as a total** | The number is a fact about your `LIMIT`, not about the world. Executed: a delete confirmation reading **100** for an operation that removes **6,535**; a KPI tile reading **100** where the truth is **3,132**. §0, §7 D1. |
| **A total that changes when you sort** | If a tile aggregates the page, re-ordering the page re-picks its members. Executed: "Total Access" **170 → 4,088** (24×) from one sort click, with no data change. §7 D1. |
| **A tile whose filter makes it structurally zero** | The Memories strip renders "Archive 0" from a list fetched with `tier != 'archive'`. The tile cannot ever be non-zero; 1,377 archived rows exist. A number that cannot vary is not a measurement. §7 D1. |
| **A denominator that ignores the filter the numerator respects** | "Showing 50 of 2188" on a tab whose own badge says 238. The sentence is false while both of its numbers are individually true. §0, §7 D2. |
| **Filter badges that do not exhaust the total** | `All 2188` vs `0 + 1928 + 238`. **22 rows are reachable through no tab.** A user who clicks every filter still has not seen the list. §7 D3. |
| **`?? 0` on a count read from a lookup keyed by an entity** | A map miss means *not in the map* — not loaded, not covered, read failed — and `0` says *this entity has none*. Executed: one failed summaries read renders "0 triggers" on **78** persona rows, **66** of which have triggers. **40 sites, 30 files** (§9). |
| **Hiding a badge when the count is zero** | `active: count > 0` / `badge != null && badge > 0`. Combined with the row above, a failed read produces **no badge at all**, which is the one rendering the user cannot question. §0, §7 D4. |
| **`catch { set({ someCount: 0 }) }`** | Same defect one layer up, and invisible to [`partial-failure-read-envelope`](./partial-failure-read-envelope.md)'s rule because there is no `.catch(`. `overviewSlice.ts:475`. |
| **Counting a page in a store field named `*Count`** | `pendingEventCount: events.filter(e => e.status === 'pending').length` over `listEvents(50)`. The *name* claims a cardinality; the *value* is a property of the fetch. Two of the five attention-registry domains do this. §7 D5. |
| **A second registry for the same concept** | Two modules in this app export `AttentionCounts`. The one built to prevent drift now has a peer it does not know about. §7 D6. |
| **An optimistic count delta never reconciled** | `markAllMessagesAsRead` derives the new unread count from the loaded page — and then re-fetches, with a comment saying why. It is the only site in five repos that does. Everywhere else the delta stands. §7 D7. |
| **`99+` with the real number nowhere** | A layout decision silently becoming an information decision. This repo escapes it only because `BadgeSlot`'s tooltip was written to list *states*, and happens to interpolate the count. §6 clause 6. |
| **A count in a destructive confirmation taken from the list** | The number is the entire content of the consent. §0, §7 D1, and the composition defect in §6. |
| **A `summary` / caption assembled as a free string** | `FilterBar.summary?: string` lets any numerator meet any denominator. The type is what should have refused. §8 Gap 1. |
| **Hardcoded English in a count label** | `` label: `${pendingReviewCount} pending review${pendingReviewCount !== 1 ? 's' : ''}` `` (`SidebarLevel1.tsx:92`) — the only user-visible text in `BadgeSlot`'s tooltip, in a 14-locale app, with hand-rolled English pluralisation. §7 D8. |

---

## 6. Evidence

**The ONE site to copy: `src/features/overview/sub_manual-review/components/ManualReviewList.tsx:138-152`,
together with the door it reads.**

```ts
// Filter-tab badges read the L0 counts (one GROUP BY) for the local
// reviews — accurate over the whole table even though only a page is
// loaded — plus the (small, fully-loaded) cloud set.
const statusCounts = useMemo(() => {
  const cloud = { pending: 0, approved: 0, rejected: 0, resolved: 0 };
  for (const r of enrichedCloudReviews) { if (r.status in cloud) cloud[r.status]++; }
  const c = reviewQueue.counts;
  return { all: (c?.total ?? 0) + enrichedCloudReviews.length,
           pending: (c?.pending ?? 0) + cloud.pending, … };
}, …);
```

Five things to copy: (1) the badge reads a **server `GROUP BY`**, not the page; (2) the comment
**names the hazard it is avoiding** — *"even though only a page is loaded"*; (3) it mixes in a
client tally **only for the set it knows is fully loaded**, and says which is which; (4) the counts
come from `useManualReviewQueue`, the same hook that fetches the page, so the filter cannot drift
between them; (5) it renders through `FilterBar`'s `badge` slot rather than inventing a pill.

Its backend half is `count_executions` (`commands/execution/executions.rs:83-95`) — copy the doc
comment as much as the function:

> *"Return precise counts for the Activity filter badges (total / running / completed / failed),
> optionally scoped to a persona. Unlike `list_all_executions` this is not paginated, so the
> frontend can display accurate totals regardless of how many rows have been loaded."*

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `stores/slices/overview/messageSlice.ts:41-56` | **The page and both counts in one `Promise.all`.** The list, its total and its unread badge cannot disagree unless the database does. |
| `messageSlice.ts:123-134` | **Reconcile after an optimistic mutation** — *"Fetch authoritative count in case the loaded list is a partial page."* One `await`. **The only count reconciliation in five repos.** |
| `stores/slices/overview/overviewSlice.ts:33-52` | **The type fix with its incident report attached.** A misnamed `total` that was really a `+1` sentinel got **renamed and retyped as a boolean to make misuse a type error** — and the field beside it carries the instruction *"read `globalExecutionCounts.total` for any 'N of M' display"*. This is Q5 withholding, executed, by this repo, before this path existed. |
| `db/src/repos/core/memories.rs:690-726` | **One filter builder, three consumers.** `get_all_with_stats` calls `build_memory_filters` for the stats and again for the page, so the count and the rows are over the same predicate by construction. |
| `lib/attention/registry.ts:1-15` | **The registry header**, which states the rule *and* the historical failure it exists to prevent. Copy the reasoning, not just the array. |
| `plugins/companion/attention/useAttentionCounts.ts:12-18` | **P5 in one sentence** — *"Reads the same stores the level-2 surfaces read, so a chip's count and the cards it reveals can never disagree."* |
| `features/overview/sub_events/components/EventLogList.tsx:284` | **Admitting the denominator is a page**: `` `${recentEvents.length}${serverHasMore ? '+' : ''}` `` → "of 50+". |
| `features/shared/chrome/sidebar/BadgeSlot.tsx:44-46, :96` | **`99+` whose tooltip carries the exact number** — because `label` interpolates the count and the whole slot is wrapped in `<Tooltip>`. Unique in the cohort. |
| `db/src/repos/execution/executions.rs:337-388` | Counts and rows sharing the **same `_ops` exclusion clause** — the one place a count query and its list query were kept in step by copying the predicate. (Its bucket set is still not exhaustive — §7 D3.) |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** `personas-cloud` has **zero** `.tsx` — it
is a headless Node monorepo, so the render-side clauses are structurally absent and are reported as
such, not counted as a choice. UI file counts: personas-web 597, vibeman 587, ascent 336,
brainiac 222.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **No shared count-badge primitive exists anywhere** | **PHYSICS AS AN ABSENCE (5/5)** | Grepped `Badge\|CountBadge\|NavBadge\|Pill\|Chip\|Tag` component exports in all four UI repos. Every hit is a *label/status* badge taking `children`/`label`, or — in `vibeman` — **gamification achievements** (`badgeStore.ts`, `types/badges.ts`), a pure name collision. `personas-web` duplicates the pill markup inline **3×** (`DesktopSidebar.tsx:52`, `MobileBottomNav.tsx`, `MobileTabBar.tsx:92`). **Nobody in the fleet has a component whose job is "render a number in a pill", and this repo's `FilterBar.badge` + sidebar `CountBadge` are the closest thing that exists.** |
| 2 | **Counts are computed from `.length` at scale, everywhere** | **PHYSICS (4/4 UI repos)** | Count-named identifiers vs rendered `.length`: personas-web **106 : 87**, brainiac **29 : 56**, vibeman **333 : 293**, ascent **91 : 118**. `vibeman` has the heaviest server machinery in the fleet (`_count` 338, `COUNT(` 194) **and its notification bell is still `notifications.filter(n => !n.read).length`** (`messageStore.ts:157`) *while an `unreadOnly=true` endpoint exists*. `personas-web`'s `pendingReviewCount` is likewise `reviews.filter(...).length`, and its nav badges are **mock constants** (`mock-dashboard-data.ts:1098`). |
| 3 | **A numerator and denominator over different populations** | **PHYSICS — and `brainiac` wrote this path's P3 down first, independently** | `brainiac/console/app/console/modules/reviews/ReviewWorklist.tsx:970-979`: *"The tabs count the whole org (the server's histogram is unfiltered), so 'open · 900' over a page of 50 is two honest numbers that read as one dishonest one unless the page says what it is"* → renders `showing the oldest {contradictions.length} of {contradictionsTotal} under this filter`, plus `:492` `{!scope.whole && <>on page · {scope.total} in all</>}`. **That is §0's "Showing 50 of 2188", diagnosed and fixed, by a different team, in a different language, with no shared document.** |
| 4 | **A central attention/badge registry** | **THIS REPO IS ALONE (1/5) — and the oracle confirmed its docstring's prediction in a sibling** | Grepped `useAttention\|attentionCount\|navBadge\|badgeCount\|sidebarBadge` across all four → **zero registries**. The closest is `personas-web`'s `useNavState().getBadge` (`DashboardNavigation.tsx:74-82`, 5 keys, consumed by 2 surfaces) — **and its third surface, `MobileTabBar.tsx:35-50`, bypasses it and rebuilds 3 of the 5 independently.** `lib/attention/registry.ts`'s header predicts exactly that ("each surface … drifted out of sync"); a sibling with the same idea and no enforcement is living it. Not physics — but **validated by a natural experiment rather than by agreement.** |
| 5 | **`?? 0` on a per-entity count lookup, rendered** | **PHYSICS (4/4)** | personas-web ~5 (`GuideCategoryGrid.tsx:98`, `templates/page.tsx:93,147`, `IncidentsFilters.tsx:68,80`), brainiac 2, **vibeman ≥7** (`ClusterMap.tsx:269,270`, `SystemMap/index.tsx:56`, `XRaySystemMap.tsx:530`, `SimulationSystemMap.tsx:332`, `ContextGroupSelector.tsx:56`, `ContextRowSelection.tsx:88`), ascent ~4. Here: **40**. The condition §9 gates is universal; **the proxy is not** — see the portability warning in the rule. |
| 6 | **A truncated count carrying its real value** | **THIS REPO IS ALONE (1/5), and by accident** | Three truncation sites in the cohort — `personas-web/MobileTabBar.tsx:94` (`> 9 ? "9+"`), `vibeman/ModuleNode.tsx:159` (`99+`), `vibeman/XRayModeToggle.tsx:99` (`999+`) — **and none carries a tooltip, `title=` or aria text with the exact number.** `vibeman`'s asserts the value away twice (`module.count!` at `:155` and `:159`). Ours carries it only because `BadgeSlot`'s tooltip was written to enumerate *states*. |
| 7 | **Typing an unmeasured count as absent** | **MINORITY (2/4), and `ascent` is ahead of us** | `personas-web/WaitlistHeader.tsx:14` `count: number \| null` + `:36` `{count !== null && count > 0 && (`; same on `MobileTabBar.tsx:19`. `ascent` renders `—` rather than a hidden badge in four places (`PrSignalsBand.tsx:52,75`, `AiRoiLedger.tsx:82,102,106`) and has the **lowest** `?? 0` density in the cohort (1 `.tsx`). `vibeman` is worst (7 `.tsx`, `\|\| 0` dominant, 138 repo-wide). |
| 8 | **Optimistic-count reconciliation after a mutation** | **THIS REPO IS ALONE (1/5)** | Grepped reconcile/revalidate around count state in all four. `personas-web/useReviewBulkActions.ts:159,203,266` recomputes `pendingReviewCount` from the local array **three times** after mutations and never checks it against a server count. Ours does, once, with the reason in the comment. |
| 9 | **Refusing to render a count you cannot honestly scope** | **`ascent` ALONE — and it is the better answer** | `ascent/src/app/org/[slug]/delivery/page.tsx:89-96`: *"allocated-$ figures are org-wide and can't be split to a filtered scope — refuse to render them under a filter instead of showing a total inflated by (org total)/(subset)"*, with a `SectionEmpty` where the number would be. And `liveWarRoomShared.ts:90-100` builds a denominator as `Math.max(1, scored, Σcounts)` documented as *"NOT normalized to the leading bucket… overstating it on a projected war-room wall"*, folding in both sources *"even if the two disagree"*. |

**Physics — keep as doctrine:** clauses 1, 2, 3, 5, 6 (1 and 6 as absences).
**Reported as MINORITY / this-repo-alone:** clauses 4, 7, 8, 9.
**Personas is ahead** on three things and they are worth defending: the **attention registry**
(nobody else has one, and the one sibling that tried is already drifting), the **count-door with a
written rationale** (`count_executions`), and **count reconciliation after a mutation**. Personas is
**behind** `ascent` on typing a count nullable and on the willingness to *refuse* a number.

> **The strongest external result is clause 9, and it is the opposite of everything else in this
> document.** `ascent` does not disclose a badly-scoped total; it **declines to render one**, and
> puts an explanation where the number would have been. A doctrine that says "always show the count"
> would have talked them out of the better move. §2 (b)'s *"or do not render the `of M` at all"* is
> there because of this finding.

### The composition defect with the neighbouring paths — offered upward

**(i) with [`informed-consent-gate`](./informed-consent-gate.md).** §0's dialog is a correct
consent gate: `ConfirmDialog`, `danger`, an explicit CTA, an irreversibility warning. It satisfies
that path in full **and lies inside it**, because the only quantity the user is consenting to comes
from `memories.length`. Following the consent path perfectly does not make the consent informed.
The one-line clause both paths need: **a consent gate's numbers are part of the gate, and must come
from the scope of the operation, not the scope of the view.**

**(ii) with [`paginated-list-query`](./paginated-list-query.md).** That path's §11 step is *"Read the
total from `counts`, never from `rows.length`"*, and its §9 lists *"whether the rendered total
describes the same set as the rendered rows"* under **what no gate can catch** — an accurate
disclaimer that leaves this leaf as the only owner. The two compose cleanly with one caveat worth
stating: **its prescription puts the true total in scope and this leaf's §0 shows that is not
enough.** `memoriesTotal` was in the same destructure as `memories`, 194 lines from the dialog, and
lost. Getting the total into scope is necessary; getting the call site to *reach for it* is the part
neither a page type nor a lint rule can do.

**(iii) with [`data-provenance-disclosure`](./data-provenance-disclosure.md).** Its P3 and this
path's P3 are the same observation with opposite prescriptions — *disclose the population
difference* vs *do not create one*. They do not conflict, but the order matters, and a reader
following the disclosure path first will label a difference they could have removed. **Remove the
difference where the source can answer; disclose it where it cannot** (a frozen rollup vs live
rows, its §0 case). Stated here so nobody ships a `scope` pill instead of a counts call.

---

## 7. Deviations

Every entry is live on `master` @ `e3c5e0d7f`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's database. All shipped under a green
`npm run check` (0 errors, 1,135 warnings — [`shared-facts.json`](../shared-facts.json)).

### D1 — The Memories page: a delete confirmation and a KPI strip, both counting the page · **executed**

Full replay in §0. `MemoriesPageDense.tsx:388` (`memories.length` → **100** vs **6,535** destroyed,
65×); `:151-165` (`tierCounts`/`totalAccess` over the page → Active **100** vs **3,132**, Total
Access **170** vs **95,644**, Archive **0** vs **1,377** and structurally unreachable); Total Access
swinging **170 → 4,088** on a sort click. `memoriesTotal` — the correct value for the header,
though still not the right one for the *delete* scope — is destructured at `:57` and used at `:194`.

**Fix, three parts, none behaviour-neutral so all three are notes:** (a) the dialog reads a real
count of the delete's own predicate, and the copy stops saying "all" while `tier='core'` survives;
(b) the strip's tier tiles read `memoryStats.category_counts`-style server buckets — the door
already returns per-category and per-agent breakdowns, just not per-tier; (c) `Total Access` is a
`SUM` and belongs in the same stats query.

### D2 — `N of M` where M ignores the filter M's own neighbour respects · **2 sites, one i18n key**

`overview.activity.showing` = *"Showing {count} of {total}"*, used twice:

| | numerator | denominator | live |
|---|---|---|---|
| `GlobalExecutionList.tsx:395` | `filteredExecutions.length` — the ≤50-row page, server-filtered by the active tab | `globalExecutionCounts.total` — **all statuses**, because `fetchGlobalExecutionCounts` takes only `personaId` | Failed tab: **"Showing 50 of 2188"** beside a badge reading **(238)** — 9.2× |
| `LlmCallsTable.tsx:278` | `rows.length` — the page filtered by a **client-side time window** (`7d` default) *and* a model filter | the same all-time total | **"Showing 0 of 2188"** today, on every tab but "all" |

`LlmCallsTable` is the worse of the two because its filter is applied *after* the fetch: the window
tab narrows a 50-row page rather than the query, so the numerator is bounded by the page and the
window simultaneously while the denominator is bounded by neither.

**Fix:** thread the status/window into `count_executions` (it already accepts `persona_id`; the
`GROUP BY` is unchanged), or type `summary` as `{ shown, total }` per §4 T2 so the pairing is
reviewable.

### D3 — The Activity filter badges do not exhaust their own "All" · **22 live rows**

`count_all_global` (`executions.rs:337-388`) increments `total` for **every** status row and buckets
only `running|queued|pending` → `running`, `completed`, `failed`; `cancelled` and `incomplete` fall
through the `_ => {}` arm. Live: `All 2188`, `0 + 1928 + 238 = 2166`, **22 unreachable**. The comment
at `:377-383` shows the same bug was already fixed once in the other direction (`queued` was
missing, *"made the Activity 'Running' badge silently under-count every execution that had not
started yet"*) — the exhaustiveness question was answered for one status and not asked for the set.

**Fix (note):** add an `other` bucket to `ExecutionCounts`, or a `#[non_exhaustive]`-style match that
fails the build when a status is added. This is the count-shaped instance of
`partial-terminal-status-set` (an existing census rule, Rust-side, on a different predicate family).

### D4 — A failed or unsettled count read renders as an absent badge · **2 layers, both live**

- `overviewSlice.ts:469-477` — `fetchPendingReviewCount`'s catch sets `pendingReviewCount: 0` and
  logs a warning. `SidebarLevel1.tsx:91` — `active: pendingReviewCount > 0`. **A failed read removes
  the badge.**
- `FilterBar.tsx:63` — `const showBadge = opt.badge != null && opt.badge > 0;`. Same collapse at the
  shared primitive, for all 7 consuming files.
- `personaSlice.ts:203-205` — `fetchPersonaSummaries`'s catch is a `logger.warn` and no state
  change, so `personaTriggerCounts` stays `{}`; four consumers read `triggerCounts[id] ?? 0`.
  **Executed: 78 persona rows would render "0 triggers" while 66 have triggers and 325 exist.**

The three sibling behaviours differ and none is documented: `pendingReviewCount` **resets to 0** on
failure, `unreadMessageCount` **keeps its last value** (`messageSlice.ts:158-162`), and
`personaTriggerCounts` **keeps `{}`**. Three failure semantics for three counts on one screen.

**Fix (note):** `number | null` per §4 T1 — and pick one failure semantic. "Keep the last value and
mark it stale" is defensible; "reset to zero" is not.

### D5 — Two of the five attention-registry counts are page-bound, and a third is `localStorage`

| domain | expression | bound |
|---|---|---|
| `pending_events` | `eventSlice.ts:28` — `events.filter(e => e.status === 'pending').length` over `listEvents(50)` | **50** |
| `active_alerts` | `selectors/activeAlertCount.ts` over `alertHistory` ← `listFiredAlerts(MAX_ALERT_HISTORY = 200)` | **200** |
| `memory_actions` | `memorySlice.ts:102` — `loadActions()`, a `localStorage` array | whatever survived |

Both page-bound counts are **also** maintained incrementally: `pushRecentEvent` (`eventSlice.ts:34-68`)
carries a hand-written `pendingDelta` including a decrement for a pending event *trimmed off the
200-item tail* — 30 lines of careful bookkeeping, with a test file (`eventSlice.test.ts`, 7 cases),
to keep a page-derived number self-consistent. **The invariant it maintains is "this count matches
the array", which is not the invariant the badge claims.** On this install the true value and the
page value are both 0 (all 4,972 events are `delivered` or `skipped`), so the defect is latent — and
it is latent in the direction that matters: a badge that under-counts *only once there is a backlog*.

`persona_events` also has a real count door in the tree already — `count_by_source`,
`count_by_type_and_source_since`, `count_dead_letter` — none of which is the one this badge needs.

### D6 — Two attention registries · **both exporting `AttentionCounts`**

`src/lib/attention/registry.ts` (5 domains, `AttentionScope`, "single source of truth") and
`src/features/plugins/companion/attention/attentionKinds.ts` + `useAttentionCounts.ts` (5 kinds:
`blocked`, `assignments`, `activity`, plus severity buckets). They share a **type name**, a concept
and a purpose; neither imports the other and neither mentions the other. The companion one carries
the better docstring (§6) and the worse sourcing (five `.length`s over store arrays); the shared one
carries the better sourcing (2 of 5 real counts) and no statement about agreeing with what it
labels. **The registry built to prevent drift acquired a sibling, which is the same event it was
built to prevent, one level up.**

### D7 — Optimistic count deltas, reconciled once out of many

`messageSlice.ts:130` reconciles (§6). Elsewhere the delta stands: `memorySlice.ts:149`
(`memoriesTotal + 1` on create), `:166` (`Math.max(0, memoriesTotal - 1)` on delete), `:202`
(`memoriesTotal - removedCount + 1` on merge). Each is correct arithmetic on a number the store may
have fetched under a *different filter* than the mutation applied to — `memoriesTotal` is the count
under `tier != 'archive'`, and `deleteMemory` can remove an archived row that was never in it.
`Math.max(0, …)` is the tell: the code already knows the running total can go negative.

### D8 — The sidebar badge's only user-visible text is hardcoded English

`SidebarLevel1.tsx:92,99`:

```ts
label: `${pendingReviewCount} pending review${pendingReviewCount !== 1 ? 's' : ''}`,
label: `${unreadMessageCount} unread message${unreadMessageCount !== 1 ? 's' : ''}`,
```

This string is the **tooltip** on the sidebar count badge — i.e. the one place the exact number
survives the `99+` truncation (§6 clause 6) — and it is hardcoded English with hand-rolled
pluralisation in a 14-locale app. Two more in the same map (`'Factory upgrade in progress'`,
`'Creative session in progress'`, `'Context scan in progress'`, `'Context scan complete'`,
`'Twin training studio in progress'`) are plain English literals; the two Obsidian ones next to them
correctly use `t.plugins.obsidian_brain.*`, so the file knows how.

**Fix:** an `en.json` key with ICU plurals per
[`i18n-string-authoring`](./i18n-string-authoring.md). Small, mechanical, and it is the count's only
disclosure channel.

### D9 — `KpiMetric` defined twice, byte-similar, in two sibling files

`MemoriesPageDense.tsx:543-549` and `MemoriesPageGraph.tsx:521-527`. A local count-display component
duplicated rather than shared — and both consume the same page-derived `stats` object from D1, so the
defect is duplicated with it. The shared-layer gap that produced it is §8 Gap 1.

### D10 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The primed `1928/2166` gap is this leaf's headline."** It is not — it belongs to
  [`data-provenance-disclosure` §0](./data-provenance-disclosure.md), which measured it (a card vs a
  chart, 32.1% apart, 697 rows in no execution row). What is **new here** is the neighbouring number:
  the Activity bar's "All" badge is **2,188**, so the product shows 2,166 and 2,188 for "executions"
  on two screens, and the 22-row difference is a bucket-exhaustiveness bug (D3), not a retention one.
- **"The attention registry does not exist."** It does, it is well-designed, its header states the
  rule, and it is `Object.freeze`d. Two of its five counts are exactly right. The defect is that
  three are page-bound and that a rival registry grew beside it. The path's job is to route people
  to it, not to invent one.
- **"Nobody in the repo knows this rule."** Six sites state it in prose: `count_executions`'s doc
  comment, `overviewSlice.ts:36-52`, `ManualReviewList.tsx:138-140`, `messageSlice.ts:130`,
  `attention/registry.ts:1-15`, `companion/.../useAttentionCounts.ts:12-18`. **The knowledge is
  present and written down, and the defects sit next to it** — the same mechanism
  [`metric-definition`](./metric-definition.md) found with `digest.rs:314` sitting 160 lines below
  the comment explaining why it is wrong.
- **`Numeric` is not the problem here.** I expected the 212-site formatter to be conflating zero with
  absent. It is not: it renders `null` as an em dash already. The absence is destroyed *upstream*, by
  `?? 0` and by `count > 0` render guards, before `Numeric` ever sees it.
- **The events badge is not currently wrong.** All 4,972 live `persona_events` rows are `delivered`
  (4,941) or `skipped` (31); zero pending. The page-derived count and the true count both read 0.
  Listed as latent (D5) rather than as a live divergence — and the pending-delta bookkeeping is
  real, careful code maintaining the wrong invariant.
- **The `99+` truncation is not a defect in this repo.** I set out to file it and found the tooltip
  carries the exact number. Three sibling repos truncate without it; we do not. Recorded as a
  strength (§6 clause 6) — and as a fragile one, since the property is incidental to why the tooltip
  exists.

---

## 8. Gaps

**Gap 1 — No shared component can render a count, so every surface renders a number and hopes.**
`FilterBar.badge?: number` is the only count-typed prop in the shared layer (7 files);
`BadgeSlot.BadgeDefinition.count?: number` is the sidebar's local equivalent; `Numeric`, `Badge`,
`StatusBadge`, `StatCard` and `KpiTile` take a number or a `ReactNode` and know nothing about it.
None can express *unmeasured*; none can express *over a page*; none couples a numerator to a
denominator (`summary?: string` is the proof). **This is upstream of D1, D2, D4 and D9**, and the
fix is the two-line type change in §4 T1/T2 plus a render arm for `null`. The convergence sweep
found the same absence in all four sibling UI repos, so this is not local neglect — it is a
component nobody in the fleet has built.

**Gap 2 — 18 count doors for 102 paginated reads, and no way to tell which lists have one.**
The doors that exist are excellent (`ExecutionCounts` returns four buckets from one `GROUP BY`;
`MemoriesWithStats` returns the page, the total and two breakdowns in one round trip). But a
developer adding a badge has no index of them, no naming convention (`count_*` vs `get_*_count` vs
`*_counts` vs `dev_tools_pending_counts`), and no signal on the list command that a counts sibling
exists. The cheapest fix is not a new abstraction: it is a doc-comment convention on every list
command naming its counts sibling, and a `#[ts(export)]`ed `*Counts` type per entity so the frontend
can *see* the door in the bindings.

**Gap 3 — `useLayeredList` has no `total`,** so the one client primitive that owns paging cannot feed
the badge that labels it. `Counts` is opaque `unknown`
([`paginated-list-query` Gap 5](./paginated-list-query.md)), which is why `useTaskQueue.ts:123`
abuses the *page* endpoint as a counts probe. This leaf inherits that gap and pays it at the pixel:
a surface that wants "50 of 2,188" must assemble three unrelated pieces by hand, which is exactly the
assembly D2 gets wrong.

**Gap 4 — Nothing can express "this count is over the loaded page".** `EventLogList.tsx:284`
concatenates a `'+'` into a string; that is the entire vocabulary. There is no `partial` flag on any
count type, no `scope` on any badge, and no i18n key of the shape *"{n} on this page"* among 19,112.
Where a true count is genuinely unavailable — a client-side facet over a filtered array, a
localStorage list — the honest rendering has nowhere to live. This is the seam with
[`data-provenance-disclosure`](./data-provenance-disclosure.md): its `scope` pill on `SlaCard` is the
only affordance in the app that does this, on 4 tiles in 1 file.

**Gap 5 — The census cannot express "these two numbers must be over the same set".** D2 is the
sharpest defect in this leaf and it is a *relation* between `rows.length` and
`globalExecutionCounts.total` — two individually well-formed expressions in one call. A regex can
find each and cannot know they are a fraction. §4 T2's `summary: { shown, total }` makes the pairing
a type instead; failing that, the cheap answer is a test per surface asserting that the counts call
and the page call receive the same filter object — the shape `ManualReviewList` achieves by
construction (one hook owns both).

**Gap 6 — The census rule keys on a TypeScript lookup idiom and cannot see the other three-quarters
of this leaf.** §9's signal matches `counts[id] ?? 0` / `counts.get(id) ?? 0`. It does **not** see
`.length` rendered as a total (141 JSX sites), a `catch` that sets a count to zero
(`overviewSlice.ts:475`), a mismatched `N of M` (D2), or a badge hidden at zero
(`FilterBar.tsx:63`). Stated so nobody reads a green census as coverage of this leaf. Three of those
four are §4's type edits; the fourth is Gap 5.

---

## 9. The missing gate

**The condition to enforce:** *a per-entity count is read out of a lookup keyed by that entity and
defaulted to the number zero, so "this entity is not in the map" — not fetched, not covered, the
read failed — is rendered as "this entity has none".* Not "a count is wrong" (unmeasurable), not
"the total disagrees with the rows" (a relation, Gap 5) — the one thing in this leaf that is a
correctness bug at any scale, that a machine can see locally, and that this repo does **40** times.

**Where it executes.** `npm run census:check` is inside **`npm run check`** (`package.json`) *and* is
the **`golden-path-census` pre-push job** in `lefthook.yml`, whose own comment records why it was
added: *"it was enforced NOWHERE: `census:check` lives only inside `npm run check`, which nothing
runs automatically."* That matters here — `ci.yml` is red on 10 pre-existing Rust failures, so **a
gate that only runs in CI runs nowhere.** This one runs on the developer's machine before the branch
leaves it.

**Existing rules checked for overlap before proposing this one — file overlap re-measured by
running each neighbour's own pattern and intersecting its file set with my 30:**

| neighbour rule | its files | overlap with my 30 | why it is a different condition |
|---|---:|---:|---|
| `empty-sample-as-confident-zero` ([`metric-definition`](./metric-definition.md)) | 16 | **0 (0%)** | Rust-only (`src-tauri/**`, `.rs`). The nearest neighbour *semantically* — same instinct, other language, and against a **rate** rather than a **cardinality**. It cannot see one line of this leaf. |
| `read-failure-as-empty-value` ([`partial-failure-read-envelope`](./partial-failure-read-envelope.md)) | 32 | **0 (0%)** | Requires a `.catch(` on a read-named call. Mine are synchronous lookups in render; none has a `.catch`. Its condition is *"the read failed"*; mine is *"the entity was never in the answer"* — which also fires when the read **succeeded** and simply did not cover that id. |
| `unknown-money-as-zero` ([`llm-spend-accounting`](./llm-spend-accounting.md)) | 21 | **0 (0%)** | Same operator family, money nouns only. Zero of my 40 identifiers is a money identifier. |
| `local-empty-state` ([`empty-and-demo-states`](./empty-and-demo-states.md)) | 37 | **3 (10%)** | Counts *authored empty-state components*; the largest overlap in the registry and still only 3 files, all research-lab surfaces that happen to do both. |
| `bindingless-catch-on-io` ([`swallowed-error-telemetry`](./swallowed-error-telemetry.md)) | 84 | **1 (3%)** | Bindingless `catch {`. Disjoint by construction. |
| `locale-blind-percent` | 55 | **1 (3%)** | Rendering a `%` glyph. |
| `stateless-disclosure-control` · `sample-derived-plot-scale` · `ordinal-denominator-in-bar-list` · `estimate-typed-as-measurement` · `env-default-conflates-unset-with-empty` | 56 / 7 / 4 / 11 / 4 | **0 each** | — |

Largest overlap **10%**, far under the 83% that correctly got a previous gate declined.

**Two independent implementations, and they disagreed twice — which is where the signal came from.**
Implementation #2 is a right-to-left bracket-balancing scanner: it starts from every `??`/`||`
operator followed by a bare `0`, walks **left** through balanced `(...)`/`[...]` to recover the whole
receiver expression, and only then asks whether the base identifier is count-named. It shares no
code, no direction and no comment-stripper with the census regex.

- **Round 1: 39 (walker) vs 27 (regex).** The regex required a **prefix** before the count word
  (`[A-Za-z_$][\w$]*(?:[Cc]ounts?…)`), so every *bare* `counts[…]`, `countById.get(…)`,
  `countByTeam.get(…)`, `countByPersona.get(…)` was invisible — **12 misses, including
  `SidebarLevel2.tsx:363`, which is a sidebar badge count and therefore this leaf's own headline
  surface.** The prefix was made optional.
- **Round 2: 40 (regex) vs 39 (walker).** Now the walker was wrong. `BacklogPanel.tsx:300` is
  `queue.counts?.[s] ?? 0` — a **filter-tab count**, and the walker's left-walk does not model the
  optional-index form `?.[`. A known, named recall gap in the verifier, kept rather than patched so
  the disagreement stays on the record.

**Final: 40 matches / 30 files, reconciled on 39 shared sites with one named disagreement in each
direction.** Neither error was visible with one implementation: the first reads as a clean codebase,
the second as a complete count.

**Precision, hand-verified 40/40 on the stated condition** — every match is literally a count-named
lookup defaulted to zero. On the stricter question *"does this zero reach a user"* the count is
**35/40 (87.5%)**. The five knowingly-included sites are **listed on purpose**, because separating
them requires knowing whether the value reaches a pixel, which no matcher can see:
`useHealthCheck.ts:336` (a dedupe counter whose `+ 1` is on the next statement, so the accumulator
lookahead misses it), `useCredentialHealth.ts:123,133` (refcount arithmetic),
`networkSlice.ts:619` (circuit-breaker control flow), `summary.ts:26` (`(counts[key] ?? 0) > 0` as a
boolean). The last is the least clear-cut of the five and is deliberately **not** excluded: a `> 0`
test on an unmeasured count is precisely the badge-hiding failure of §7 D4, just in a helper rather
than a badge.

**The positive control partitions the app's two answers to one question, and its number is the
finding.** Pointed at the **compliant** form over the same roots and extensions — a count *asked of
the source* through one of the 18 dedicated count doors — it returns **22 matches in 15 files**. So
the population is **40 counts manufactured from a lookup miss (30 files) : 22 counts fetched from a
door (15 files)**, and the two must move in opposite directions as the codebase improves. If
`absent-entity-count-as-zero` falls and the control does **not** rise, a count was deleted rather
than sourced. The control is also a liveness probe for the door vocabulary: if every `get*Count`
were renamed, it drops to zero and the run fails structurally.

**Fail-loud properties — not asserted, executed against the working tree with exit codes captured
(never through a pipe):**

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified, baseline 30/40) | **0** | `census OK — 2 rule(s), 9658 file-visits, 62 surviving violation(s) across 45 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] files rose 20 -> 30 (+10). New violations of …aggregate-count-display.md` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 99 -> 30 (-69) without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 3000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 3000` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" … or "principle"` |
| `exclude` path renamed | **1** | `[structural] exclude "src/GONE.tsx" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **POSITIVE CONTROL — gate pointed at the COMPLIANT form** | **1** | `[drift] files dropped 30 -> 15 (-15) … matches dropped 40 -> 22 (-18)` |
| **control given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |
| **control loses its population** (every count door renamed) | **1** | `[structural] matched zero files anywhere` |

**Validated standalone** against the real engine in a private scratch registry
(`node scripts/census/run-census.mjs --rules <scratch>/rules-aggregate-count-display-acd7k.json --check`),
never against the shared `rules.json`; **the full registry was not run** (doctrine §4).
Re-extracted from this finished document and re-run: **identical — 40/30 and 22/15 over 9,658
file-visits.**

**How this gate could still fail, stated so the next repo can re-derive it.** The signal proxies for
*"an unknown count is materialised as zero"* and it keys on **this repo's TypeScript lookup idiom**:
a count-named `Map`/`Record`, an index or `.get()`, and `?? 0` / `|| 0`. A repo that spells the same
defect as `counts[id] || 0` on an untyped bag, as `get(id) ?? {count: 0}`, as a SQL
`COALESCE(c.n, 0)` in the query, as Prisma's `_count` on a `LEFT JOIN`, or as a Rust
`.get(id).copied().unwrap_or(0)` will match nothing while the condition is present. The convergence
sweep confirms the *condition* is universal — personas-web ~5, brainiac 2, vibeman ≥7, ascent ~4 —
and that **none of them would be caught by this exact pattern's naming convention.** An adopting repo
must re-key on its own idiom, and should check the positive control's population before trusting a
green run.

**On severity.** This is proposed at the census layer, which is a ratchet, not an `"error"`. The
count may not rise; the existing 40 are a backlog. No argument from warning volume is made or
intended — and specifically, the reason this is a ratchet rather than an alarm is that every one of
the 40 renders a *plausible* zero: the defect is invisible at each individual site and legible only
as a population, and only in the moment the map is incomplete.

```json
{
  "id": "absent-entity-count-as-zero",
  "goldenPath": "docs/concepts/golden-paths/aggregate-count-display.md",
  "title": "A per-entity count is read out of a lookup keyed by that entity and defaulted to 0, so \"this entity is not in the map\" is rendered as \"this entity has none\"",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:[A-Za-z_$][\\w$]*)?(?:[Cc]ounts?|[Tt]otals?)(?:By[A-Z][\\w$]*)?\\s*(?:\\?\\.)?(?:\\.\\s*get\\s*\\(\\s*[^()]{0,80}?\\s*\\)|\\[\\s*[^\\]\\n]{0,80}?\\s*\\])\\s*(?:\\?\\?|\\|\\|)\\s*0(?![.\\d])(?!\\s*\\)?\\s*[+\\-])",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A count-named lookup container (a Map via `.get(key)`, or a Record/array via `[key]`, incl. the optional forms `?.get(` and `?.[`) whose MISS is defaulted to the number 0 with `?? 0` / `|| 0`. PROXY FOR the stack-free condition: an UNKNOWN count is materialised as ZERO, so \"this entity is not in the map\" — not fetched yet, not covered by the scan, the read failed — is rendered to the user as \"this entity has none\", and no later code can recover the distinction. The `(?!\\s*\\)?\\s*[+\\-])` tail is LOAD-BEARING: it removes the accumulator idiom `map.get(k) ?? 0 + 1`, where 0 is the correct identity element for a counter being CONSTRUCTED rather than a claim being DISPLAYED; without it the population is 40% noise. The optional leading `(?:[A-Za-z_$][\\w$]*)?` is also load-bearing and was MISSING in the first draft, which required a prefix before the count word and therefore skipped every bare `counts[...]`, `countById.get(...)`, `countByTeam.get(...)` and `countByPersona.get(...)` — 12 of 40 sites, including SidebarLevel2.tsx:363, a sidebar badge count and this leaf's own headline surface. WHAT THE MATCH COSTS, executed rather than reasoned: personaSlice.ts:184-206 fills personaTriggerCounts from getPersonaSummaries() and its catch is a logger.warn with NO state change, so a failed or unsettled read leaves the map `{}` and four consumers (PersonaOverviewCardList.tsx:122, PersonaOverviewColumns.tsx:146,149, PersonaOverviewFilters.tsx:103) read `triggerCounts[id] ?? 0`. Replayed against a read-only copy of the operator's live 347MB personas.db: the Agents overview would render \"0 triggers\" on ALL 78 persona rows while 66 of them have at least one enabled trigger and 325 enabled triggers exist — `?? 0` converting \"we don't know\" into \"none\" on 85% of the rows, silently. PRECISION 40/40 on the stated condition, every match hand-read; 35/40 (87.5%) on the stricter 'this zero reaches a user'. The five knowingly-included sites are LISTED ON PURPOSE because separating them needs knowledge of whether the value reaches a pixel, which no matcher has: useHealthCheck.ts:336 (a dedupe counter whose `+ 1` sits on the NEXT statement, so the accumulator lookahead cannot see it), useCredentialHealth.ts:123 and :133 (refcount arithmetic), networkSlice.ts:619 (circuit-breaker control flow), and summary.ts:26 (`(counts[key] ?? 0) > 0` as a boolean — deliberately kept, because a `> 0` test on an UNMEASURED count is exactly the badge-hiding failure this path's D4 measures). TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT 39 SHARED SITES WITH ONE NAMED DISAGREEMENT IN EACH DIRECTION: this regex (40 in 30 files) and a right-to-left bracket-balancing scanner that starts from every ??/|| operator followed by a bare 0 and walks LEFT through balanced parens/brackets to recover the receiver (39 in 29). Round 1 the walker won by 12 (the missing optional prefix, above); round 2 the regex won by 1 — BacklogPanel.tsx:300 `queue.counts?.[s] ?? 0`, a filter-tab count, which the walker misses because its left-walk does not model the optional-index form `?.[`. That miss is kept rather than patched so the disagreement stays on the record. LEGAL FIX: type the count `number | null`, leave the miss as null, and render a neutral affordance — never an absent badge, because absence in this app already means zero (FilterBar.tsx:63 `badge != null && badge > 0`, SidebarLevel1.tsx:91 `active: count > 0`). Where the map is a per-entity rollup, fetch the count from a dedicated door instead: this repo has 18 (count_executions, get_memory_count, get_message_count, get_unread_message_count, get_pending_review_count, get_manual_review_counts, ...) against 102 paginated reads, and count_executions' own doc comment states the rule: 'Unlike list_all_executions this is not paginated, so the frontend can display accurate totals regardless of how many rows have been loaded.' CONVERGENT AS A CONDITION, NOT AS A PROXY: the same defect is present in all four sibling UI repos — personas-web ~5 (GuideCategoryGrid.tsx:98, templates/page.tsx:93,147, IncidentsFilters.tsx:68,80), brainiac 2, vibeman >=7 (ClusterMap.tsx:269,270, SystemMap/index.tsx:56, XRaySystemMap.tsx:530, SimulationSystemMap.tsx:332), ascent ~4 — and NONE of them would be caught by this pattern's naming convention. PRECONDITION (must be re-derived per repo): this repo names its lookups `*Count`/`*Counts`/`*CountBy*` and defaults with `?? 0`. A repo spelling it as an untyped bag, `get(id) ?? {count: 0}`, SQL `COALESCE(c.n, 0)`, Prisma `_count` over a LEFT JOIN, or Rust `.get(id).copied().unwrap_or(0)` scores zero while the condition is present at scale. Do NOT silence a match by hoisting the default into the map's construction — that is moving the lie, not removing it."
  },
  "exclude": [],
  "baseline": { "files": 30, "matches": 40 },
  "floor": 3000
}
```

```json
{
  "id": "count-asked-of-the-source-positive-control",
  "goldenPath": "docs/concepts/golden-paths/aggregate-count-display.md",
  "title": "POSITIVE CONTROL — a displayed count fetched from a dedicated server COUNT door rather than derived from whatever the client is holding",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:countExecutions|getMemoryCount|getMessageCount|getUnreadMessageCount|getPendingReviewCount|getThreadCount|getTeamCounts|getTeamMemoryCount|getManualReviewCounts|getFrontendCrashCount|getReferralCount|countDeadLetterEvents|countDesignReviews|countEventListeners|countTeamChannelKinds|dev_tools_count_pending_acceptance|pendingCounts)\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. It matches the COMPLIANT answer to the same question the sibling rule catches wrong: a count ASKED OF THE SOURCE through one of this app's 18 dedicated count doors, rather than manufactured from a lookup miss or an array length. Returns 22 matches in 15 files against the violating rule's 40 in 30, so the population PARTITIONS 40 manufactured : 22 sourced, and the two counts must move in OPPOSITE directions as the codebase improves — if absent-entity-count-as-zero falls while this stays flat, a count was DELETED rather than sourced, and the ratchet would otherwise have recorded that as progress. THE NUMBER IS ITSELF THE FINDING: 18 count doors exist against 1,588 registered Tauri commands (1.1%) and 102 repo reads that hand back a truncated page via `limit.unwrap_or(N)` (47 of them defaulting to 50) — so the great majority of list surfaces in this application have no way to ask how many there are. It is also a LIVENESS PROBE for the door vocabulary: the violating rule and this control are the two halves of one question, so if every get*Count were renamed away this drops to zero and the run fails structurally instead of quietly reporting a healthy ratchet. NOTE it counts only the doors that exist TODAY; when a new counts command is added (per this path's §4 step 3) add its API wrapper name here or the control will under-report adoption. Test files are included deliberately — a count door exercised by a test is still a door that exists."
  },
  "exclude": [],
  "floor": 3000
}
```

**Three conditions in this leaf I am refusing to gate, with the measurement that justifies each
refusal:**

1. **A `.length` rendered as a total** is the leaf's largest population and I could not build a
   signal that discriminates. Measured: **141** JSX-child `{xs.length}` renders in 119 files;
   **277** `.filter(...).length` in 176 files; **215** i18n interpolations filling a `count`/`total`
   slot from an array length in 135 files; **91** `total`-named bindings from a `.length` in 69
   files. I then built the narrowest form — an `N of M` interpolation whose **denominator** slot is
   an array length — and ran it: **28 sites / 22 files**, and hand-verification put precision at
   roughly **20%**, because the majority are honestly complete client-owned collections
   (`visibleSteps.length` in a tour, `POWER_MOVES.length`, `selected.size`, a bulk-operation's own
   target list). **The discriminator is whether the array is a page, and that is not in the local
   syntax.** Per the corpus's own standard — 22% and 44% precision were both correctly declined — a
   gate that fires on `total: visibleSteps.length` is worse than no gate. §4 T2's
   `summary: { shown, total }` is the instrument that reaches this instead.
2. **A numerator and denominator over different populations** (D2) is the sharpest defect here and
   is **not a string**. It is a relation between `rows.length` and `globalExecutionCounts.total` —
   two well-formed expressions in one call, in one sentence. No regex can know they are a fraction.
   Recorded in Gap 5 rather than pretended into a signal; the durable answer is the typed `summary`
   pair, the cheap one is a per-surface test that the counts call and the page call receive the same
   filter.
3. **A `catch` that sets a count to zero** (`overviewSlice.ts:475`) is a real and distinct condition
   — invisible to `read-failure-as-empty-value` because there is no `.catch(` — and I built the
   pattern and ran it: the census-legal form `catch\s*(\(..\))?\s*\{[^{}]{0,400}?\b\w*Count\s*:\s*0`
   returns **0 matches**, because the assignment is inside a nested `set({ … })` and the
   brace-bounded window cannot cross it. A window permissive enough to cross would run past the
   catch block entirely — the same trade `read-failure-as-empty-value` documented. **Population of
   one, no safe pattern; named in D4 for a two-line fix instead.**

---

## 12. Corrections to the brief

1. **The spine says `sides: "client"` and `twoSided: true` in the same leaf, and the evidence says
   `twoSided` is right.** The two contradict, and a client-only reading would have missed the entire
   supply side: the count doors are Rust (`count_executions`'s doc comment is the clearest statement
   of this path's doctrine in the repo), the bucket-exhaustiveness bug (D3) is a `match` arm in
   `count_all_global`, the exhaustive-vs-partial predicate that makes §0's delete dialog wrong is
   `DELETE … WHERE tier != 'core'`, and the ratio that frames the whole leaf — **18 count doors
   against 102 paginated reads** — is only visible from the backend. **Recommend flipping `sides` to
   `both`.** (`fusedAcrossSides: false` beside `twoSided: true` suggests the flag was inherited from
   one of the three merged leaves rather than chosen — the same inconsistency
   [`partial-failure-read-envelope` §12.1](./partial-failure-read-envelope.md) reported.)
2. **The brief's primed headline — "1928/2166 executions vs a chart summing 2,865" — is not this
   leaf's, and re-deriving it would have duplicated a neighbour.** That gap belongs to
   [`data-provenance-disclosure` §0](./data-provenance-disclosure.md), which measured it in full
   (a card vs a chart six lines below, 32.1% apart, 697 rows that exist in no `persona_executions`
   row, caused by frozen `sla_daily` rollups outliving retention). **Verified, credited, not
   restated.** What is new is the number *beside* it: the Activity bar's "All" badge reads **2,188**
   because `count_all_global` counts every status, so the product displays **2,166** and **2,188**
   for "executions" on two screens, and the 22-row difference is a bucket-exhaustiveness bug (D3),
   not a retention one.
3. **"`Numeric` has 212 render sites and no provenance prop" is true and is not this leaf's defect.**
   `Numeric` renders `null` as an em dash, so it *can* carry absence. The absence is destroyed
   upstream — by `?? 0` on a lookup and by `count > 0` render guards — before `Numeric` is reached.
   The primitive that cannot tell the truth here is `FilterBar.badge?: number` and the sidebar's
   `BadgeDefinition.count?: number`, which is a **different** shared-layer gap needing a different
   one-line fix (§4 T1). Confirming the neighbour's Gap 1 from a second direction rather than
   re-filing it.
4. **"`empty-sample-as-confident-zero` is the server half" — it is a cousin, not a half.** Measured:
   **0 of my 30 files** overlap its 16, by construction (it walks `src-tauri/**/*.rs`). More
   substantively, it gates a **rate over an empty sample**; this gates a **cardinality over an
   unknown set**. `if n > 0 { .. } else { 0.0 }` and `counts[id] ?? 0` are the same instinct against
   two different quantities, and the fixes differ: `Option<f64>` for the first, `number | null` plus
   *a render arm that shows something* for the second — because a rate rendered as `0%` is at least
   visible, while a count rendered as `0` **removes the badge**.
5. **"Counts are often computed over a loaded page rather than the full set" — confirmed, and the
   brief understated where it bites.** The page-derived counts I expected to be the worst offence
   (the Activity list) are the *best-handled* surface in the app: server counts feed the badges,
   with a comment. The damage landed instead on (a) a **destructive confirmation** (§0, 65×), (b) a
   **KPI strip** whose own total contradicts its own parts by 31×, and (c) **three of the five
   domains of the registry built to prevent exactly this**. The pattern is not "lists get it wrong";
   it is **"the surface that shows rows gets it right, and the surfaces that only show numbers get
   it wrong"** — because the rows are what make the mismatch visible.
6. **"Whether a count of zero is distinguishable from a count that failed" — answered, and the answer
   is worse than the question assumed.** They are not distinguishable, and in this app **neither is
   distinguishable from an absent badge**: `active: count > 0` and
   `badge != null && badge > 0` collapse *unmeasured*, *zero* and *not rendered* into one pixel
   state. The three counts that can fail on one screen also fail *differently* and undocumentedly —
   reset-to-0, keep-last-value, keep-`{}` (D4).
7. **The brief asked me to check whether any badge disagrees with the list it labels; the sharper
   answer is that a badge can be right while its list is empty.** Executed on the Activity persona
   filter: badges are server-scoped to the selected persona (`fetchGlobalExecutionCounts(personaId)`)
   while rows are a **client-side** filter over a 50-row *global* page. **44 of the 59 personas with
   executions render a non-zero badge over an empty list.** Both numbers are individually defensible
   and the pair is not, which is P3 arriving from the other direction.
8. **A methodological correction to my own first pass, in the doctrine's own terms.** My first census
   regex and my first verifier agreed at 27 and were both wrong, in the same direction, for the same
   reason — I wrote both from the same mental template (`<something>Counts[...]`) and neither could
   see a bare `counts[...]`. The disagreement that found it came only after I rewrote the verifier to
   scan **from the operator leftwards** instead of from the identifier rightwards. **Two
   implementations are only independent if they enter the expression from different ends**; two
   written in the same direction are one implementation typed twice.
