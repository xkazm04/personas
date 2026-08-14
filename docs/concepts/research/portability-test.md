# Portability test — do golden paths transfer to a different stack?

> Run 2026-08-13 against `personas-web` @ working tree (read-only; nothing was
> modified there). Subject paths: `tables.md`, `page-loading.md`,
> `form-field-and-validation.md`. Method: read the three paths and
> [`golden-path-contract.md`](../golden-path-contract.md), then measure
> `personas-web` directly — every count below came from a grep or a file read,
> none from estimation. Includes a full census of all **46 record-list surfaces**
> in `personas-web` (every one cited by `file:line`).

## The claim under test

The contract says (`golden-path-contract.md:14-16`):

> "Its head stays language-free so a sibling project in another stack can adopt
> the same doctrine; its manifestations are stack-specific."

That is a two-layer claim: (a) there is a head, (b) the head is language-free.
This test found (a) is true for two of three paths and (b) is **false for all
three as written** — but the reason is not the one the design anticipated.

**The paths are not Tauri-shaped. They are `src/features/shared/components`-shaped.**
Counted over the three documents: lines mentioning Tauri / IPC / Rust / SQLite /
desktop = **1 / 2 / 20** (the 20 is one section of the form path about backend
validation authority). Lines naming a Personas-specific primitive
(`UnifiedTable`, `DataGrid`, `FormField`, `RevealItem`, `RouteChunkSkeleton`,
`useRevealTracker`, `LoadingSpinner`, `ThemedSelect`, …) = **41 / 31 / 73**.
Lines citing a `src/**` file path = **78 / 69 / 152** out of **182 / 177 / 619**
total lines.

So roughly **40–45% of every line in every path names a file in this repo**, and
the coupling that actually blocks transfer is to *this repo's component library*,
not to Tauri. That is a better problem to have — component libraries can be
re-pointed, a runtime cannot — but it means the current documents are not
two-layer objects. They are one-layer objects with a prescriptive paragraph on
top.

---

## The subject, measured

`personas-web` — Next.js **16** (App Router), React 19.2, TypeScript 6,
Tailwind 4, Zustand 5, **SWR 2.4**, framer-motion 12, Supabase, Sentry,
recharts, shiki, lucide-react. Playwright + Vitest. No Tauri, no Rust, no local
database, no IPC. Data arrives over HTTP from Supabase / an external
orchestrator, or from in-repo mocks (`src/lib/mockApi.ts`) for the demo
dashboard.

| Dimension | Personas (desktop) | personas-web |
| --- | --- | --- |
| Files | ~1,200 components | 597 `.tsx` + 440 `.ts` |
| Rendering | SPA, all client | 12 server `page.tsx`, 25 client; **407 files carry `"use client"`** |
| Data | Tauri IPC → SQLite (local, ~instant) | HTTP → Supabase / mocks (network latency is real) |
| Fetch layer | hand-rolled `useEffect` + `invokeWithTimeout` | **SWR** (`isLoading`, `keepPreviousData`, `dedupingInterval`) + hand-rolled `useEffect` hooks |
| Code splitting | `React.lazy` + `Suspense` | `next/dynamic` (**31 `ssr:false` sites**) + `app/loading.tsx`; only **2** `<Suspense>` in the whole repo |
| i18n | `locales/en.json` → `t.section.key` | `src/i18n/en.ts` (TS module) → `t.namespace.key` — **same access shape** |
| Custom ESLint rules | 21 | **5** (4 `warn`, 1 `error`) |
| Shared UI catalog | ~115 primitives, `CATALOG.md` | `src/components/primitives/` = **5 files**; `src/components/dashboard/` is the de-facto library |
| Docs surface | `docs/features/` + `.claude/Design.md` + `CATALOG.md` | `docs/features/` per submodule **with a "Conventions & gotchas" section already** + `.claude/design.md` (566 lines) |
| Hard convention | — | **`max-tsx-lines: 200`** (lint-enforced) |

Two properties of the subject dominate every finding below:

1. **It already has doctrine.** `.claude/CLAUDE.md` has seven numbered
   "non-negotiable" conventions; `.claude/design.md` has a shared-primitive
   table; `docs/features/*.md` each carry a `Conventions & gotchas` section that
   *already documents* the loading and skeleton behaviour of each dashboard
   page. A golden path does not land on empty ground here.
2. **The framework solves several of the prescribed problems.** SWR's
   `isLoading`, `keepPreviousData`, `dedupingInterval`; Next's `loading.tsx`,
   `error.tsx`, `not-found.tsx`, `next/dynamic({loading})`. Several
   prescriptions the paths present as manual discipline are library defaults
   here — and one of them, if followed literally, would be a regression.

---

## Verdict per path

### 1. `tables.md` — **transfers with rewrite** (head survives, every prescription dies)

#### Does the principle head apply?

The head, quoted:

> "Do not build a table. Pick one of exactly three shared primitives and feed it
> a `columns` array."

**Yes, partly — and personas-web independently arrived at it.** It has
`src/components/dashboard/DataTable.tsx` (154 lines): a `columns` + `data` +
`keyExtractor` div-grid primitive with `role="table"`/`"row"`/`"columnheader"`,
an animated `expandable` detail row, `onRowClick`, `emptyState`, `rowClassName`.
Same shape, same idea, arrived at independently. That is genuine evidence the
head is a real principle and not a local habit.

But the *rest* of the head is arithmetic about this repo: "exactly three",
"`UnifiedTable` by default", "`DataGrid` only when you need pagination",
"`FacetedDecisionTable` when rows carry a slash-path taxonomy". personas-web has
**one** primitive with a **different capability set**. The dispatch table is 100%
of the head's operational content and 0% of it survives.

#### What is stack-bound and needs rewriting

Everything in §3 Mandated primitives, §4 Steps, §6 Evidence, §7 Deviations,
§8 Gaps. Specifically:

| Prescription | Status in personas-web |
| --- | --- |
| `UnifiedTable` / `DataGrid` / `FacetedDecisionTable` | do not exist |
| `useXColumns()` hook in a sibling `*Columns.tsx` | **already the convention** — `events-list-panel/EventsListColumns.tsx` does exactly this. Transfers verbatim, and is *reinforced* by the repo's own `max-tsx-lines: 200` rule |
| `width` as a CSS grid track (`'minmax(180px,2fr)'`) | wrong — `DataTable`'s `Column.className` is a flex class (`"flex-1"`, `"w-32"`). Flexbox, not grid |
| `display/Numeric`, `display/RelativeTime`, `display/StatusBadge`, `tokenLabel()` | `StatusBadge` and `StatBadge` exist; `Numeric` and `RelativeTime` do not (`relativeTime` is a function in `src/lib/format.ts`) |
| `tableId` / `scrollRestoreKey` / `groupBy` / `onEndReached` / `rowAccent` | none exist |
| "pass `isLoading` and stop" | **`DataTable` has no `isLoading` prop at all** |
| "never `.slice()`" | both call sites `.slice()` for a "load more" button — and `DataTable` gives them no alternative |
| `layout/ListSkeleton` / `TableSkeleton` are traps | do not exist; the local analogue (`SkeletonCard`) is deliberate, documented and reduced-motion-gated |

#### Does the primitive exist, an equivalent, or nothing?

**An equivalent, with a strictly different capability set — and the two sets
interlock in an interesting way.** `DataTable` *has* the thing `tables.md` lists
as **Gap #2** ("No expand-row / detail-row slot… A `renderExpandedRow?` +
`expandedKeys` unblocks both") — it ships `expandable` with an `AnimatePresence`
height transition and `aria-expanded` (`DataTable.tsx:18,97,132-147`). It
*lacks* sorting, filtering, pagination, virtualization, loading state, i18n
defaults, keyboard row nav, and sort persistence.

#### Would following the path improve the code?

**Partly yes, and one finding is worth the whole exercise.**

`DataTable.tsx:58`:

```tsx
if (data.length === 0 && emptyState) {
  return <>{emptyState}</>;
}
```

The empty state renders whenever `data` is empty — **including while the first
fetch is in flight**, because the primitive has no loading input. Both call
sites (`executions/page.tsx:143`, `EventsListPanel.tsx:124`) pass a rich
`emptyState`. So **2 of 2 adopters are structurally incapable of avoiding the
empty-flash**, and the flash is worse here than in the desktop app because the
data comes over the network. This is precisely the `tables.md` /
`page-loading.md` law, precisely the shape of `tables.md` Gap #5
(`FacetedDecisionTable` has no `isLoading` pass-through), and it is a real,
one-prop fix. The path found it — and six more of the same class outside the
primitive (see the page-loading section).

**But the path's *default* would damage two surfaces.**
`leaderboard-page/LeaderboardTable.tsx:79-120` renders each row as a
`<motion.button layout="position">` so rows physically animate to their new
positions when the sort changes — the entire point of a leaderboard. Piping it
through a `columns` array kills that. `KnowledgeDenseTable` is a density
showcase with a documented recipe (`.claude/design.md:553`, "monospace
numerics"). The path's §5 anti-pattern "Writing `<table>` for a flat list of
records" is fine; its "Hand-rolling sort state — 16 files carry their own"
would flag `LeaderboardTable.tsx:48-55` as a deviation when the correct answer
is that the sort logic is already extracted to a tested pure module
(`leaderboardSort.ts`) and the primitive that would own it doesn't support
sorting at all.

#### Measured deviations against the head

A full census found **46 record-list surfaces** in `personas-web` — 29 in the
dashboard, 5 mobile, 12 marketing/content.

| Principle from the head | Deviations in personas-web |
| --- | --- |
| Adoption of the columns-array primitive | **2 of 46.** Only `executions/page.tsx:143` and `EventsListPanel.tsx:124` use `DataTable`; **44 are hand-rolled** |
| "Do not build a table" (`<table>` for a flat list) | **0** — the only two `<table>`s are markdown renderers (`MarkdownReport.tsx:59`, `guide/blocks/MarkdownTable.tsx:16`), both legitimate |
| Hand-rolled `role="columnheader"` div-tables | **0** — 2 occurrences, both inside the primitive itself (`DataTable.tsx:70,74`) |
| `const GRID = 'grid grid-cols-[...]'` idiom | **5 occurrences, 1 true positive** (`LeaderboardTable.tsx:64`). The other 4 are time-axis swimlanes (`EventSwimlane.tsx:62,90`, `SwimlaneLane.tsx:33`, `AgentLane.tsx:36`), not tables |
| Hand-rolled sort state | **2 user-controlled** (`LeaderboardTable.tsx:48-55` + `leaderboardSort.ts`; `KnowledgeDenseTable.tsx:35-44` + `KnowledgeSortHeader.tsx`) plus **5 fixed module-scope comparators** (`useTriageQueue.ts:112`, `m/alerts/page.tsx:33-38`, `blog/page.tsx:41`, `Changelog.tsx:17`, `feature-voting/index.tsx:171`) |
| Hand-rolled pagination | **3** — real page-size paging at `messages/page.tsx:28,79-83`; incremental slice + "load more" at `executions/page.tsx:161-177` and `EventsListPanel.tsx:126-132` |
| Column labels at all | **Only 4 of 46 surfaces have a header row** (#1, #2 via `DataTable`; `KnowledgePatternTable.tsx:29`; `LeaderboardTable.tsx:64`). The rest are card/row lists with the field name inline |
| Empty state reachable during fetch | **8** — `DataTable.tsx:58` (×2 call sites), `ReviewList.tsx:24`, `SubscriptionsPanel.tsx:111`, `RecentActivityCard.tsx:75`, `TriagePane.tsx:103`, `TopPerformersCard.tsx:49`, `UpcomingRoutinesCard.tsx:36` |
| No empty state at all | **13** — incl. `LeaderboardTable` (renders a bare header with zero rows), `SLATargetGrid.tsx:64`, `health/page.tsx:68`, `HealthDigestPanel.tsx:112` |
| Missing `isLoading` on the table primitive | **1** (the primitive) — cascading to 100% of its call sites |
| Virtualization | **0 of 46.** The nearest thing is `content-visibility: auto` on mobile rows (`m/alerts/page.tsx:69,130,154`), which is a paint optimization, not windowing |

So the earlier read was wrong in the informative direction: `personas-web` **does**
have the adoption problem the path describes (2 of 46 — proportionally worse than
Personas' 24 canonical surfaces), it simply expresses it as *card lists* rather
than as `<table>` markup. The desktop repo's diagnostic signals (`<table>`,
`<thead>`, `role="columnheader"`, `const GRID`) are tuned to the markup its
deviations happen to use, and all four miss here — while the underlying
condition is present at scale.

#### The gate does not transfer at all

`tables.md` §9 proposes `custom/prefer-unified-table` keying on `<table>`+
`<thead>` and `role="columnheader"`, calling the latter "near-perfect — 6 files,
4 true positives."

Measured on personas-web: `role="columnheader"` → **2 occurrences in 1 file, and
that file is the primitive** (which the rule allowlists). `<thead>` → **2 files,
both markdown renderers** (which would need allowlisting). **True positives: 0.
False positives requiring allowlist entries: 2.** A gate that fires only on its
own allowlist is the "gate that no-ops" the contract warns about at
`golden-path-contract.md:47-52` — manufactured confidence.

**Verdict: transfers with rewrite.** The head's *first sentence* transfers. Its
dispatch table, all ten steps, all evidence, all deviations and the gate must be
written from scratch against a primitive with a different capability set.

---

### 2. `page-loading.md` — **transfers, with two prescriptions that are actively wrong here**

#### Does the principle head apply?

The head's opening, quoted:

> "Never gate a surface on a loading flag. Render the static chrome — header,
> filter bar, tab strip, column header, panel shell — unconditionally, outside
> every loading branch, and let the loading flag decide only what an **empty**
> body region shows. A fetch that is in flight while rows are already on screen
> must change nothing."

**Yes — fully, and this is the strongest transfer in the set.** Its *first*
clause is already honoured here without anyone having read the path; its later
clauses are broken at 22 sites. That split is itself the most useful thing this
test produced: the part that survived independent invention is the part that is
genuinely universal.

Chrome-outside-the-branch, verified by reading the three highest-traffic
dashboard pages:

- `sla/page.tsx:32-55` — title, subtitle, `StalenessIndicator` and
  `DashboardErrorBanner` all render **outside** the `loading ?` branch.
- `messages/page.tsx:160-183` — header, view switcher, error banner outside;
  and the body branches **three ways in exactly the prescribed order**:
  `loading ? ghosts : isEmpty ? empty : rows`. That is `page-loading.md` step 6,
  independently.
- `knowledge/page.tsx:136-150` — tab chrome outside; the loading branch is
  inside a `role="tabpanel"` that also carries **`aria-busy={loading}`** — an
  a11y affordance the golden path never mentions and should adopt.

Whole-surface early-return gates — the path's category A, its "highest value"
deviation class with ~30 sites in the desktop repo — number **exactly one** here:
`AuthGuard.tsx:37`, `if (isLoading) return <DashboardSkeleton />`. And it is
**correct**: it gates on *auth session resolution*, not on data. You cannot
render dashboard chrome for a viewer whose identity is unresolved. The desktop
app is local-first and has no auth boundary, so the path has no vocabulary for
this case and would flag its flagship anti-pattern at a site where the pattern
is right.

#### Which prescriptions are stack-bound

**Wrong for a web app — do not port:**

1. **"`animate-pulse` on a placeholder — banned outright"** and **"A shimmer
   sweep / looping framer-motion on a skeleton — same failure, more expensive."**
   In personas-web, pulse and shimmer are *the sanctioned house treatment*,
   exported as shared constants: `LazySection.tsx:8-10` exports
   `P = "animate-pulse bg-white/[0.03] rounded-2xl"`, `Ps`, `Pm` for reuse.
   `SkeletonCard.tsx` combines `animate-pulse` with an infinite framer-motion
   sweep — and gates **both** on `useReducedMotion()`, which is a lint-enforced
   repo convention (`custom-animation/require-animation-gating`). It is
   documented in `.claude/design.md:377` and in `docs/features/dashboard/shell-chrome.md:30`.
   Measured: **23 `animate-pulse` occurrences across 17 files; 22 `SkeletonCard`/
   `SkeletonChart` call sites.**
   The ban also rests on a latency premise the path never states. Its stated
   reason (`page-loading.md:58`) is that pulse "blinks through the ghost→content
   swap and cannot be delay-hidden" — which is true when the fetch resolves in
   tens of milliseconds off a local SQLite file, so the whole placeholder should
   ideally never paint (hence the ≥120ms `fill-mode: both` invisibility window,
   the mechanic the ban exists to protect). Over a network, a 400–1500ms wait is
   normal, the placeholder *will* paint, and motion on it is the correct signal
   that work is happening. The rule is sound; its unstated precondition —
   "your data resolves faster than a human notices" — does not hold here.
   **Porting this ban would make personas-web worse.**

2. **"A spinner is never a visual loading state in this app."** This is stated
   as doctrine but its actual cause is that `feedback/LoadingSpinner` in
   Personas *renders `null`* — a repo defect promoted to a design law. In
   personas-web spinners work: **36 `animate-spin` occurrences in 33 files**,
   including `app/loading.tsx` (Next's own route-segment fallback) and two
   *correct* uses — `ExecutionsFilters.tsx:39` and `SubscriptionsToolbar.tsx:44`
   put a small spinner **beside** the filter chrome while a refetch runs, which
   is exactly the "chrome stays, body doesn't move" behaviour the head asks for.
   The path would flag both.

**Framework-shadowed — the prescription is right but the mechanism is wrong:**

3. **"Wrap the lazy chunk — `<Suspense fallback={<RouteChunkSkeleton …/>}>`,
   never `fallback={null}`."** personas-web has **2** `<Suspense>` in 597 files.
   Its lazy-loading mechanism is `next/dynamic` with a `loading:` option (**31
   `ssr: false` sites**, factory at `LazySection.tsx:41-51`) and `app/loading.tsx`
   for route segments. A developer following this step literally would search
   for Suspense, find nothing, and miss where the repo actually makes this
   decision. `LazySection.tsx:25-39` even documents an **SSR decision tree**
   (above-the-fold / crawler-visible → `ssr:true`; browser-only APIs → `ssr:false`)
   — a whole dimension the path has zero content about, and the one that
   actually matters most for a marketing site's LCP.
   Worse: `app/loading.tsx` renders a centred spinner with the text "LOADING" —
   the path's single most-condemned shape — via the framework's designated
   mechanism.

4. **"Warm the remount if data is not store-backed — module-scoped cache keyed
   by project/entity."** This is `page-loading.md` mechanic 4 and Gap #3. In
   personas-web it is **already solved by SWR**: `dashboard-queries.ts:29-31`
   sets `dedupingInterval: 60_000, keepPreviousData: true, revalidateOnFocus: false`.
   Hand-rolling `let cachedX` next to a cache library would be a straight
   regression, and the path phrases it as a mandatory mechanic.

5. **`const showGhost = isFetching && rows.length === 0`.** Right principle,
   already delivered by the library: SWR's `isLoading` is *by contract*
   "request in flight **and** no loaded data" — it is false during
   revalidation. `useSystemHealth.ts:19` and `useAuditIncidents.ts:19` return it
   directly, so `health/page.tsx:59` and `incidents/page.tsx:71` are **correct by
   framework**, not by discipline. The path should say "if your fetch library
   distinguishes first-load from revalidation, use that flag; otherwise derive
   it" — as written it implies manual derivation is the only path.

#### Does the primitive exist, an equivalent, or nothing?

| `page-loading.md` mandates | personas-web |
| --- | --- |
| `UnifiedTable` (whole doctrine from two props) | **nothing** — `DataTable` has no loading input |
| `RouteChunkSkeleton` (150ms-invisible header-only fallback) | **partial** — `SectionSkeleton` (`LazySection.tsx:13`) and `DashboardSkeleton`; neither has the delay-hide, and `DashboardSkeleton` is a full body silhouette (the path's §5 "lies about the incoming geometry") |
| `RevealItem` + `useRevealTracker` (one-shot, **id-guarded** cascade) | **equivalent for the cascade, nothing for the guard** — `staggerContainer` (`animations.ts:82-90`, `staggerChildren: 0.12`) is used in **47 files**; there is no id-guard, so any branch that unmounts the list replays the cascade |
| `useProgressiveReveal(total, opts)` | **`useStaggeredReveal`** (`src/lib/useStaggeredReveal.ts`) — near-identical contract, near-identical docstring ("spreads the React reconciliation + framer-motion init cost over ~½–1s"), reduced-motion short-circuit included. Independent convergence. |
| `.animate-fade-in` with `fill-mode: both` as an invisibility window | **nothing** — the anti-flash delay mechanic has no analogue |
| `LoadingSpinner` renders null | n/a — spinners work |

#### Measured deviations against the head

Measured over the 46-surface census.

| Law | Deviations |
| --- | --- |
| Chrome outside every loading branch | **0 of 10** body-loading branches hide chrome. The 1 whole-surface gate (`AuthGuard.tsx:37`) is an auth boundary, not a data gate. **This law is fully honoured.** |
| Ghost only when the region is empty (`loading && items.length === 0`) | **11 surfaces gated on `loading` alone** — `knowledge/page.tsx:141` (×2), `leaderboard/page.tsx:91`, `incidents/page.tsx:71` (×2), `messages/page.tsx:175` (×2), `sla/page.tsx:49` (×2), `health/page.tsx:59` (×2). Their hooks re-set `loading = true` on every retry (`useSlaData.ts:50`; same shape in `useLeaderboardData`/`useMessagesData`/`useKnowledgeData`), so a retry wipes rows the user is reading. **5 are correct**: `agents/page.tsx:95` (`personasLoading && personas.length === 0`), `PerformanceView.tsx:77` (`loading && !metrics`), `UsageView.tsx:142`, `AgentDetail.tsx:58` (`if (!data)`), `SearchResultsPopover.tsx:48` (`isPending && results.length === 0`) |
| A surface that fetches has *some* placeholder | **30 of 46 have none at all** — incl. both `DataTable` sites, `SubscriptionsPanel.tsx:119`, `RecentActivityCard.tsx:82`, `TriagePane.tsx:110`, `ReviewList.tsx:29` (which instead shows a "Refreshing…" strip *below* the list) |
| Empty state unreachable until settled | **8 empty-flashes** (list in the tables section) + **13 surfaces with no empty state at all** |
| The loading flag actually reaches the surface | **2 outright bugs the path would catch**: `TopPerformersCard.tsx:32` and `UpcomingRoutinesCard.tsx:26` destructure only the data field from hooks that *do* return `loading` (`useTopPerformers.ts:50`, `useUpcomingRoutines.ts:108`), so in supabase mode both paint "no executions yet" during the fetch. Plus **1 dead skeleton**: `DashboardIntelligencePanels.tsx:17` branches on `ready`, whose only caller passes a literal `true` (`InstrumentsBay.tsx:57`), making `SkeletonCard` at `:28-29` unreachable |
| Cascade is one-shot and id-guarded | **47 files** use `staggerContainer` with no id-guard; `staggerChildren: 0.12` with **no cap** (the path caps at 8×35ms), so a 40-row list would take 4.8s to finish revealing |
| Never a body silhouette in a route fallback | **1** — `DashboardSkeleton` draws a sidebar + 6-card grid the incoming page may not match |
| Placeholder motion | **23 pulse + 22 shimmer sites — one deliberate, documented, reduced-motion-gated design decision expressed at ~45 call sites. Not deviations here.** |

**Total real findings: 22** (11 loading-alone gates + 8 empty-flashes + 2 dropped
flags + 1 dead skeleton), plus 30 surfaces with no placeholder where several
plainly want one. Every one of them is a genuine defect in a repo that had never
seen this document.

**Verdict: transfers.** The head is right, is *already lived* in this repo, and
would still find four real bugs (the retry-wipe) plus one structural one (the
empty flash). Four prescriptions in the body — the pulse ban, the spinner ban,
the Suspense mechanism, the module-scoped cache — must be dropped or inverted.

---

### 3. `form-field-and-validation.md` — **does not transfer**

#### Does the principle head apply?

The head, quoted:

> "Render every labelled control as `<FormField>` with the **render-prop child**,
> and let it own identity, association and error presentation… Then stop: no
> `<label htmlFor>`, no local `id` string, no `useState` for `touched`, no
> `text-red-400` paragraph, no local `Field` / `LabeledInput` / `FormRow`
> wrapper — the repo already has nineteen of those and they are the deviation,
> not the shortcut."

**No.** Not because the underlying a11y doctrine is wrong — a `<label>` must name
its control everywhere — but because **the situation barely occurs in this repo,
and the head's entire argument is an argument about consolidating nineteen
duplicates that do not exist here.**

Measured across all 597 `.tsx`:

| | Personas (desktop) | personas-web |
| --- | --- | --- |
| Files with a text-type input | 177 | **16** |
| `<input>` elements | ~300 | **17** |
| `<textarea>` | 119 files | **2** |
| `<label>` | 346 | **9** |
| `htmlFor` | 46 | **1** |
| `<form>` | 5 files | **3** |
| `aria-invalid` | 18 | **1** |
| `role="alert"` | — | 12 (mostly error banners) |
| Local field wrappers to consolidate | **19** | **0** |

And 13 of the 17 inputs are not form fields at all: **8 search/filter boxes**
(`blog/page.tsx:85`, `templates/page.tsx:133`, `CategoryTopics.tsx:41`,
`GuideSidebarContent.tsx:47`, `SearchCombobox.tsx:155`, `CatalogFilters.tsx:30`,
`EventsFiltersToolbar.tsx:49`, `ShortcutsOverlayDialog.tsx:83`), **3 read-only
copy targets** (`flow-composer/index.tsx:79`, `WaitlistSuccessPanel.tsx:96`,
`CopyButton.tsx:111`), **1 range slider** (`TourVolumeControl.tsx:20`), **1
checkbox inside a wrapping label** (`WaitlistForm.tsx:61`, which is correct).

That leaves **four** genuine labelled data-entry fields in the entire
application, and the one with real validation is already right:
`WaitlistForm.tsx:35-57` has `htmlFor` + `id` + `required` + `aria-invalid` +
`aria-describedby` + a `role="alert"` error paragraph, backed by a shared,
unit-tested validator (`src/lib/validation.ts` → `isValidEmail`, with
`validation.test.ts`). It is hand-rolled and it is correct.

The remaining defects are **three orphan labels** in one file
(`CreateSubscriptionForm.tsx:50,67,84`, over two `required` `<select>`s and one
`<input>`) — one file, one commit, ~10 minutes.

#### What is stack-bound

Nearly everything, plus one whole section that is meaningless here. The path's
§ "Where the authority actually lives" (`:404-465`) is ~60 lines about Rust
command-layer validation, `AppError::Validation`, `ts-rs` bindings, SQLite
`CHECK` constraints and `invokeWithTimeout` rethrow. personas-web has no Rust,
no IPC and no owned schema — its writes go to Supabase (`waitlist`, voting) via
`app/api/*/route.ts` handlers that call the *same* `isValidEmail` /
`isValidVoterId` validators the client uses (`src/lib/validation.ts:1-3`,
"Shared email validation used by all API routes and client-side forms"). The
desktop repo's central finding — "the client field is the only validation in the
product" — is **inverted** here: personas-web already shares one validator across
both sides of its boundary, which is the outcome the desktop path is asking for.

`ThemedSelect`, `Listbox`, `PasswordToggleField`, `FormErrorProvider`,
`FormErrorSummary`, `useFieldValidation`, `useAsyncFieldValidation`,
`CharBudget`, `INPUT_FIELD` / `inputFieldClass`, the `typo-*` label-token ramp —
none exist. The i18n instruction ("every label is `t.section.key`") transfers
verbatim, because the two repos share an access shape (`t.namespace.key`) — the
only prescription in the document that ports unchanged.

#### Would following it improve the code?

**Net negative.** Building a `FormField` primitive with render-prop a11y
plumbing, `validateOn`/`forceValidation`, `FormErrorProvider`,
`FormErrorSummary` and a char-budget meter, to serve **four** fields, in a repo
whose lint rule caps components at **200 lines**, is over-engineering by an order
of magnitude. The correct action for personas-web is: add `htmlFor` + `id` to
three labels; change four `<label>`s that sit over a JSON `<pre>` viewer to
`<span>` (`EventDrawerPayload.tsx:15`, `EventDrawerSummary.tsx:39`,
`EventDetailDrawer.tsx:88,109` — they label *output*, not a control); done.

#### The gate is measurably inert — this is the single strongest finding

`form-field-and-validation.md:538-547` proposes `custom/require-labelled-control`
with this signal, and this specific claim:

> "A `JSXElement` named `label` whose opening and closing tags are on the same
> line and which has no `htmlFor` attribute. Measured on the real corpus: **120
> matches across 49 files, of which 0 contain a nested control** — a single-line
> `<label>` cannot be wrapping anything, so the false-positive rate is zero by
> construction."

Run against personas-web:

```
single-line <label …>…</label>  → 1 occurrence
   …and that one HAS htmlFor    → 0 rule matches
genuine orphan labels present   → 3 (CreateSubscriptionForm.tsx:50,67,84)
```

**The rule's detection rate on the identical bug class in the sibling repo is
0%.** The reason is pure formatting: Personas writes labels on one line;
personas-web's Prettier settings plus its `max-tsx-lines: 200` rule produce
multi-line labels. The signal was tuned to a *code-formatting* accident and
mistaken for a semantic one. The zero-false-positive property the path is proud
of comes at the cost of zero recall the moment formatting changes — and the
contract's own requirement that a gate "fail loudly if its own precondition is
absent" (`golden-path-contract.md:47`) is exactly what would be violated: this
rule would sit in personas-web's config reporting green forever.

**Verdict: does not transfer.** The head is a consolidation argument for a
corpus that does not exist here; the backend half is about a runtime that does
not exist here; the gate detects nothing here. The a11y principle underneath it
(one line long) does transfer — everything built on top does not.

---

## Cross-cutting failure modes

**1. Repo-local accidents promoted to universal law.** Three examples, all in
`page-loading.md`: spinners banned (because *this repo's* spinner component
renders `null`), pulse banned (because *this repo's* data is local and resolves
before the pulse cycle), module-scoped caches mandated (because *this repo* has
no fetch library). Each is a correct local conclusion stated as a general one. A
reader in another repo cannot tell which of the head's clauses are physics and
which are local history, because the head never separates them.

**2. The head is not actually separable from the manifestation.** In all three
paths the "one way" paragraph names the mandated primitives inline — 8 mentions
in `tables.md`'s single paragraph, 6 in `page-loading.md`'s. Delete the
primitives and the paragraph loses its operational content, not just its
examples. That is the concrete meaning of "the head is not language-free".

**3. Every diagnostic signal is markup- or formatting-tuned, not
semantics-tuned.** Four were tested; all four score **0 true positives** on the
sibling repo while the condition they target is present:

| Signal | Personas | personas-web | Condition actually present? |
| --- | --- | --- | --- |
| `role="columnheader"` (`tables.md:171`, "near-perfect") | 6 files, 4 true positives | 2 occurrences, both in the primitive | yes — 44/46 hand-rolled lists |
| `<table>` + `<thead>` | 27 files, 23 deviations | 2 files, both markdown renderers | yes — same 44 |
| `const GRID = 'grid grid-cols-[...]'` | ≥8 instances | 5, of which 1 is a table | yes |
| single-line `<label>` without `htmlFor` (`form-field:540`, "false-positive rate is zero by construction") | 120 matches / 49 files | **0 matches** | yes — 3 orphan labels |

The reason is the same in every case: the signal keys on the *shape the
deviation happened to take in one repo* (table markup; one-line label
formatting), not on the semantic condition (a list of records without a shared
column model; a label that names nothing). A gate ported this way runs green
forever in the adopting repo, which is precisely the failure the contract warns
about at `golden-path-contract.md:47-52`.

**4. The paths have no vocabulary for the web's actual load-bearing concerns.**
Nothing in any of the three mentions: server vs client components, hydration,
streaming, `loading.tsx`/`error.tsx`, route prefetch, LCP/CLS, crawler
visibility, or the SSR-vs-client decision for a lazy chunk. `personas-web`'s
`LazySection.tsx:25-39` treats that last one as the primary decision of the
whole area. A `page-loading` path that cannot say anything about it is missing
the biggest lever on the subject repo's actual page-load experience.

**5. Independent convergence marks exactly which clauses are universal.**
`useStaggeredReveal` ≈ `useProgressiveReveal` (near-identical contract *and*
docstring). `EventsListColumns.tsx` ≈ the `useXColumns()` convention.
`messages/page.tsx:175-183` ≈ step 6's exact three-way branch. `DataTable` ≈ the
columns-array primitive. `AgentsLoadingGrid` gated on
`personasLoading && personas.length === 0` ≈ step 5, arrived at independently
and documented in `docs/features/dashboard/agents.md:17`.

Two engineers, two stacks, no shared document, same five mechanics. That is the
strongest possible evidence a principle head exists. It is also a free
portability oracle the composing process is not using: **a clause that a sibling
repo reinvented is physics; a clause that no sibling repo has any trace of
(the pulse ban, the spinner ban, the module-scoped cache) should be suspected of
being local calibration until proven otherwise.**

---

## The scorecard

| | `tables` | `page-loading` | `form-field-and-validation` |
| --- | --- | --- | --- |
| Head applies? | partly | **yes** | no |
| Primitive exists / equivalent / nothing | equivalent (weaker + one extra capability) | equivalent for cascade + progressive-mount; **nothing** for the loading contract | nothing (and nothing needed) |
| Corpus size the path addresses | 46 record-list surfaces | 46 surfaces, 16 with any placeholder | **4 real fields** |
| Real deviations found | **~20** — 44/46 hand-rolled, 8 empty-flashes, 2 sorts, 3 paginations, 13 missing empty states | **22** — 11 loading-alone gates, 8 empty-flashes, 2 dropped flags, 1 dead skeleton (+30 surfaces with no placeholder) | **3** (orphan labels, one file) |
| False deviations it would raise | 3 (`LeaderboardTable`, `KnowledgeDenseTable`, "load more"); plus the 3-primitive dispatch is unusable | 1 design decision at ~45 sites (pulse/shimmer) + 2 inline spinners + `AuthGuard` + `app/loading.tsx` | 4 (`<label>` over a `<pre>`) + a whole primitive to build |
| Gate true positives | **0** | n/a (proposes none) | **0** |
| Verdict | **transfers with rewrite** | **transfers** | **does not transfer** |

Signal-to-noise decides this. `page-loading` finds 22 real bugs against one
misapplied design ban; `tables` finds a genuine 2-of-46 adoption problem while
its four diagnostic signals all score zero; `form-field` finds 3 real bugs and
would prescribe building a 350-line primitive for 4 fields.

Note where the value actually came from: **every real finding above came from
the head — from "the empty state is unreachable until the fetch settles" and
"one primitive owns the list". None came from §3 Mandated primitives, §6
Evidence, §7 Deviations, §8 Gaps or §9 The missing gate — which are 78% of the
text.**

---

## What the head would have to lose to be genuinely stack-free

Rewriting the three heads to the point where they survive a stack change, and
keeping only what a `personas-web` developer could act on:

**Tables.** *"A list of records is a `columns` array plus a `data` array plus a
stable row key, fed to one primitive that owns sorting, the loading placeholder,
the settled-only empty state and the entrance cascade. If your primitive cannot
express the surface, extend the primitive — do not fork it into the feature.
Define the columns in a sibling module, not inline. A surface whose rows are the
interaction (they animate, reorder, or are the affordance) is not a table; leave
it alone."* — 4 sentences. No primitive names, no counts, no dispatch table. The
last sentence is new and only became visible from outside the repo.

**Page loading.** *"Static chrome renders outside every loading branch. A
placeholder is permitted only when the region is empty AND a fetch is in flight —
if your data layer already distinguishes first-load from revalidation, use its
flag rather than deriving one. The empty state is unreachable until the fetch
settles. When data lands it renders on that frame; no minimum display time. If
you animate entrance, cap it so the last row is not still arriving seconds
later, and guard it by row identity so a refetch does not replay it. Placeholder
motion is a repo-level design decision, not a law — decide it once, write it
down, and gate it on reduced-motion."* — the last clause is the one the current
document is missing, and it is what would have prevented the pulse ban from
travelling.

**Form field.** *"A label must name its control — via `htmlFor` + `id`, or by
wrapping it. Error text must be adjacent, announced (`role="alert"`), and
referenced by `aria-describedby`. The predicate that produces the errors is the
same predicate that gates submit. Show errors on blur and on submit, never on
the first keystroke. If more than a handful of fields share this shape, put it
behind one wrapper; if not, don't."* — 5 sentences, no primitive, and the final
conditional is what makes it honest in a 4-field repo.

Note what is gone from all three: every file path, every count, every primitive
name, the "and then stop" step, and the gate. **The material that carried the
value in the desktop repo is exactly the material that does not survive.** That
is not a flaw in the writing; it is what "prescriptive" means.

---

## Recommendation: keep the three-layer model, but stop pretending it exists in the document

The design is worth keeping. Two of three heads survived contact with a real
sibling repo, one of them fully, and the surviving heads found seven real bugs
in a codebase nobody had read them against. That is a good result for a doctrine
format.

But the current documents do not implement the model they claim. Concretely:

1. **Physically split the head out.** The head must be a separate artifact — its
   own file, or a fenced block at the top under a `## Principle` heading with a
   hard rule that **no repo path, no primitive name, and no count may appear
   inside it**. Enforce it with a check script; it is trivially checkable
   (`grep -E '\.tsx|\.rs|[A-Z][a-z]+Table|FormField'` inside the fence → fail).
   Today the head is discovered by reading §2 and mentally deleting the proper
   nouns, which is exactly the work the design claims to have already done.

2. **Tag each clause of the head with its warrant.** Every prescription is one
   of: *physics* (an a11y or perception fact — a label must name its control; an
   empty state that renders during a fetch is a lie), *ergonomics* (one
   predicate, not two), or *local calibration* (pulse is banned; spinners are
   banned; use a module-scoped cache). Only the first two are portable. Today
   all three are written in the same imperative voice, and a reader in another
   repo has no way to sort them. The pulse ban and the spinner ban are the proof:
   both are calibration, both read as physics, and both would degrade the sibling
   repo.

3. **Demote §9 from "mandatory" to "candidate, with its measured precondition."**
   A gate must carry the corpus property it depends on ("this repo formats labels
   on one line"; "this repo has 6 files containing `role=columnheader`"). Both
   proposed gates score zero on the sibling repo, and the contract's own
   fail-loudly clause is what they'd violate. A gate ported without its
   precondition is a green light wired to nothing.

4. **Give the head a scale condition.** `form-field` is not wrong in the abstract;
   it is wrong at four fields. Every consolidation head should state the corpus
   size at which its prescription starts paying — "if more than ~10 surfaces
   share this shape". Without it, a path is an instruction to build a component
   library the adopting repo does not need.

5. **Add the dimension the desktop repo cannot see.** Both `tables` and
   `page-loading` are silent on server rendering, hydration, streaming and the
   SSR-vs-client decision for a lazy chunk — the concerns that dominate the
   subject repo's real loading behaviour. A head written from one runtime will
   have blind spots shaped like the other runtime. Composing the next paths
   against *two* repos, not one, is the cheapest available fix.

Adoption cost, stated plainly: **the manifestation layer is ~85% of each
document and has to be written from scratch per repo** — `tables.md`'s 71 lines
of deviations and 13 of gaps, `form-field`'s 152 path-citing lines, are
irreducibly local. What a sibling repo can adopt in a day is a 4–5 sentence
head. What it would take to produce the equivalent document for `personas-web`
is a full sweep of `personas-web`. The three-layer model is real; the leverage
across repos is much smaller than the document size implies, and it lives almost
entirely in layer one.

---

## The question that matters most

**Would a developer in `personas-web` reading these three paths be better off,
worse off, or confused?**

**`page-loading.md`: clearly better off, then confused.** They would immediately
learn 22 true, actionable things — the 11 retry-wipes, the 8 empty-flashes, the
two cards that silently drop a `loading` flag their own hook computes
(`TopPerformersCard.tsx:32`, `UpcomingRoutinesCard.tsx:26`), the dead skeleton
branch at `DashboardIntelligencePanels.tsx:17`. Their own `docs/features/*.md`
describe all of these surfaces and caught none of them. Then they would hit
"animate-pulse is banned outright" and "a spinner is never a visual loading
state", both of which contradict their own `.claude/design.md:377`, their own
lint-enforced reduced-motion convention, and their own `LazySection.tsx:8-10`
shared constants — with no way to tell from the document that those two clauses
are local calibration and the twenty findings above them are physics. Best case
they discard those two and keep the rest; realistic case they discard the
document because two of its loudest claims are visibly wrong in their repo.
**This is the failure mode the design should fear most: 22 correct findings get
thrown out with 2 wrong ones, because nothing marks the boundary between
physics and local calibration.**

**`tables.md`: better off, narrowly, and for a reason the path didn't intend.**
It would hand them the `DataTable.tsx:58` empty-flash — a structural bug
affecting 100% of that primitive's call sites, which their own docs never
noticed — and, read at the level of "one primitive owns the list", the fact that
**44 of their 46 record-list surfaces are hand-rolled**. But every diagnostic it
supplies to *find* those surfaces (`<table>`, `<thead>`, `role="columnheader"`,
`const GRID`) scores zero here, because their deviations wear card markup
instead of table markup. So the developer gets the conclusion without the
method, the three-primitive dispatch is unusable, and the default answer would
damage `LeaderboardTable`. Net positive, but they'd have to do the census
themselves.

**`form-field-and-validation.md`: worse off.** 619 lines whose central
prescription is to build a primitive for four fields, whose backend section
describes a runtime that does not exist here, and whose proposed gate would
report green while three real orphan labels sit in
`CreateSubscriptionForm.tsx`. A conscientious reader would spend a day building
`FormField` and `FormErrorProvider` in a repo with a 200-line component cap. The
correct action — three `htmlFor` attributes and four `<label>`→`<span>` swaps —
is one paragraph long, and the document buries it under a consolidation argument
about nineteen wrappers that do not exist.
