# Loading Choreography — the Golden Pattern (v2)

> Single source of truth for how data-heavy surfaces present loading.
> **Reference implementation: `src/features/overview/sub_activity/components/GlobalExecutionList.tsx`**
> — study it before migrating any surface. v1 of this doc prescribed a
> whole-region cross-fade gate (`LoadingReveal`); live use proved that pattern
> WRONG (skeleton on every visit, content held after data arrived, one big-bang
> reveal). v2 replaces it with row/tile-level choreography.

## Scope — a surface, not a control

This document governs **a region fetching its data**: a tab, page, panel, list,
table, chart, KPI grid, on mount or on a parameter change. Nobody clicked
anything; the UI is filling itself in.

It does **not** govern **an action the user just triggered** — a save, a send, a
retry, a test-connection, a row-level approve. That is
[`docs/concepts/golden-paths/inline-busy-state.md`](../concepts/golden-paths/inline-busy-state.md),
and its prescriptions are the **opposite** of this document's on the one
mechanism the two share:

> ### Spinners are banned for surfaces and required for actions.

A spinner is never a surface loading state in this app — you paint calm ghosts
under permanent chrome (law 3/5 below). But on a control the person just
pressed, a spinner is the *only* honest signal, and `buttons/Button`
(`Button.tsx:230,:237`) and `buttons/AsyncButton` (`AsyncButton.tsx:85`) render
real ones **by design**. Do not "fix" those to match this document.

**`feedback/LoadingSpinner` satisfies neither half.** It renders `null`
(`LoadingSpinner.tsx:12-21`) — spinners are disabled app-wide — and emits only
an `sr-only` `role="status"` when given `label`. So `{busy ? <LoadingSpinner/>
: <Icon/>}` makes the icon vanish with nothing in its place, and
`{loading ? <LoadingSpinner/> : content}` is a blank rectangle, not a
placeholder. It is a compatibility shim, not a loading state of either kind.

*Until 2026-08-13 this document contained no occurrence of "button", "action",
"spinner" or "inline" — the surface half was written doctrine and the action
half was folklore. That gap is measurable: ~75 action controls render a busy
state that is literally invisible, and 184 files under `src/features/**`
hand-roll `animate-spin` because the documented shared answer visibly did
nothing. Both halves are now written down.*

## The six laws

1. **Data on screen is sacred.** A fetch never hides, dims, or replaces rows
   that are already rendered. Stores are usually pre-warmed (dashboard
   pipeline, previous visits) — that data paints on the **first frame**, and
   refreshes settle silently behind it. A loading flag decides only what an
   *empty* region shows.
2. **Content is never held.** The moment data exists it renders. No minimum
   placeholder duration, no grace gate on content, no `AnimatePresence
   mode="wait"` swap (placeholder-exit-then-content-enter is a forced delay).
   Placeholder → content is a plain conditional in identical geometry.
3. **The delay lives on the placeholder, not the content.** Ghosts enter via
   `animate-fade-in` (150ms, `fill-mode: both`) behind a staggered
   `animation-delay` starting at **≥120ms** — they are literally invisible
   until then, so a fast fetch never paints one. That CSS delay *is* the
   anti-flash: zero timers, zero JS, nothing ever waits on it.
4. **Life comes from item-level cascade, not block fades.** New content ripples
   in per row/tile (35ms stagger, first-viewport only), one-shot and
   id-guarded: polling, refreshing, and scrolling **never** replay it. A
   single realtime arrival fades in alone. Big-bang block reveals are banned.
5. **Static chrome always renders.** Headers, column headers, filter bars,
   tab strips, pane shells, KPI tile frames — never inside a loading branch.
   Ghosts render *under the real chrome*, in the real geometry.
6. **A region's placeholder is retired by that region's own data.** No region
   waits on another region's fetch. A surface with N regions runs N
   independent load cycles, each with its own flag, its own ghost and its own
   settle; it does not run one cycle over `Promise.all` and swap everything in
   on the same frame.

> **"The five laws" elsewhere in the repo means laws 1 to 5 of this file.** The
> count moved on 2026-10-03 and eight documents still say five:
> `page-loading.md:25,:168` (and its generated index), `tables.md:77` (quoting
> `UnifiedTable`'s own source comment), `error-boundary.md:798`,
> `partial-failure-read-envelope.md:337,:1103`,
> `streaming-chat-transcript.md:628`, and
> `paths/async-ui-states/applications/react--state-model.md:16`. Most are claims
> about what laws 1 to 5 do **not** cover, which stay true as written; the one
> that is now misleading by count is `page-loading.md:25`, "you get all five
> laws from two props", because `UnifiedTable` gives a region laws 1 to 5 and
> **cannot** give a surface law 6, which is about the surface's fetch topology
> and not about any one table. Left unswept deliberately: those are golden-path
> documents with generated indexes and `check:evidence` / `check:doc-map` gates
> behind them, and a count sweep is its own change with its own gate run.

### Why law 6 was missing until 2026-10-03, and what it is not

Laws 1 to 5 all govern **what to paint while ONE fetch is in flight**. Not one
of them says how many fetches a surface should have, or whether a region may
paint before its neighbour returns. Measured 2026-10-03: the strings
`Promise.all`, `fan-out`, `per-region`, `waterfall` and `parallel` occur **zero
times** across this file and `docs/concepts/golden-paths/page-loading.md`. The
reference implementation this doctrine was written from, `GlobalExecutionList`,
is a single list with a single fetch, which is exactly the case where the
question does not arise.

The consequence is that **a surface could be 100% conformant with laws 1 to 5
and still be the defect**: one `Promise.all` over nine commands, one
`setLoading(false)`, calm delayed geometry-matched ghosts under real chrome for
the whole 1.4s, and then nine regions appearing in one frame. The doctrine
called that a pass. The owner, walking the app on 2026-10-03, called it
"big bang causing freezes on cold loads".

**Law 6 is not a performance law, and must not be sold as one.** `tauriInvoke`
has no concurrency limiter (`src/lib/tauriInvoke.ts`), and async Tauri commands
are spawned on a multi-thread runtime, so the calls in a `Promise.all` genuinely
overlap: measured, 1,406ms of IPC inside a 1,321ms wall-clock window. **A
fan-out over N commands already costs `max(latency)`, not `sum`.** Splitting it
therefore does not make the surface *finish* sooner. It makes the surface
*start showing* sooner. Write that distinction into every commit message that
cites this law; a speed claim here is false.

It is also not a freeze law. Across 60 stop-measurements in this repo's own perf
harness (`docs/harness/perf-runs/2026-09-24T10-*.json`), only 2 recorded a long
task, 189ms of main-thread block in total, with long-task support confirmed on.
A page waiting on law 6 is **empty and waiting, not blocked**. The repo's one
genuine main-thread freeze is a different defect with its own note
(`long-list-rendering.md`: 6,535 rows to 52,281 DOM nodes and 4.46s).

### Applying law 6

- **The shell awaits only what decides WHAT to render**: auth, tier and
  entitlement, the active project, anything that can redirect. Everything else
  is a prewarm. Fire it, let the store fill, let each surface paint when its own
  data lands.
- **A server-side bundle is not a fix, it is a move.** One call that joins N
  regions on the backend is better on IPC count and *identical* on this law:
  still one await, still one state write, still one frame. Watch for the worst
  shape, a bundle nested inside a client fan-out.
- **Reuse, do not build.** `useLayeredList` already implements the staged shape
  and its own header says "Anti-'big-bang'". Measured 2026-10-03: **2 call sites
  in 4,829 files**. `useExecutionDashboardPipeline` is a worked example already
  in the tree. This repo's dominant defect is unadopted abstractions, not
  missing ones; prove the existing one does not fit before writing a new one.
- **A region that genuinely cannot paint alone is an exception worth writing
  down**, not a reason to fan out again: name it in the module's comment with
  what it is waiting for.

**Deprecated:** `LoadingReveal` + `useStableLoading` as a gate around primary
content (the v1 pattern). Do not add new usages; migrations remove existing
ones. (`Reveal` — the plain one-shot fade-in block — remains fine for panels
that mount after `DeferUntilIdle` or Suspense.)

## The mechanics (from the reference implementation)

### A. Semantics of the loading flag

```tsx
const [isFetching, setIsFetching] = useState(true);   // in-flight, nothing more
const showGhost = isFetching && rows.length === 0;    // ghosts ONLY into emptiness
// empty state ONLY when settled:
{showGhost ? <Ghosts/> : rows.length === 0 ? <EmptyState/> : <Rows/>}
```

### B. Row cascade — `RevealItem` + `useRevealTracker`

```tsx
const CASCADE_ROWS = 14; // ~first viewport; beyond it rows render plainly
const revealResetKey = `${filter}|${personaId}|${sort}`;  // replay on context switch
const enter = useRevealTracker(revealResetKey);
// in the (virtualized) row render, wrapping the row content:
<RevealItem
  revealId={item.id}
  order={index}
  hasEntered={(id) => index >= CASCADE_ROWS || enter.hasEntered(id)}
  markEntered={enter.markEntered}
  className="h-full"
>
  {row}
</RevealItem>
```
- Entered ids are remembered per `resetKey` → poll/refresh re-delivering the
  same ids animates nothing; a filter switch (client-side, same-frame) replays
  a quick ripple on its new result set — the cascade *is* the response.
- `RevealItem` caps stagger at 8×35ms and honors reduced motion.

### C. Ghost rows/blocks — module-local, geometry-matched

> **Not for a `UnifiedTable` / `DataGrid` surface** — those own their ghost
> (`TableGhostRows`) and get it from `isLoading` + `data`. A local ghost in
> front of either primitive is a deviation, not this recipe. §C is for a
> non-tabular region: a tile grid, a card list, a panel body, a chart box.

Build a small local `<XyzGhostRows>` for the surface (see `ActivityGhostRows`):
same row height / grid template / tile layout as the real content, calm bars
(`bg-primary/[0.06]`, **no `animate-pulse`**, ever), each element:

```tsx
className="… animate-fade-in"
style={{ height: ROW_H, animationDelay: `${120 + i * 35}ms` }}
```

Include a ghost of any group-header band the real list shows. `aria-hidden`.
Vary bar widths deterministically (`['w-40','w-28','w-36','w-32'][i % 4]`) so
it reads as rows, not a barcode.

### D. Chunk (Suspense) fallbacks

Route/subtab fallbacks follow the same law: **invisible for 150ms**
(`animate-fade-in` + `animationDelay: '150ms'` on the fallback root) and ghost
**only chrome every variant shares at the same position** (usually just the
header band — see `OverviewRouteSkeleton` in `OverviewPage.tsx`). Never fake
body geometry the incoming surface won't have. `fallback={null}` is acceptable
for small widgets; a *sized* delayed ghost is better when the widget's absence
would shift layout.

### E. Shell prefetch and warm return

Section primaries never suspend into `null`: `renderSectionRoute` defaults to
`RouteChunkSkeleton`, and so does every persona sub-surface in `PersonasPage`
(editor, build, create, cloud). A warm chunk resolves inside the 150ms delay and
paints nothing; a cold one shows the header ghost, never a collapsed blank area.

Chunks are warmed on three signals, all through one deduped map,
`shared/chrome/navPrefetch.ts` (`SECTION_CHUNKS`, which `sectionRouter` also
builds its lazy primaries from, so the two cannot drift):

- **Expressed intent**: the main rail calls `prefetchSectionOnIntent` on hover
  and focus. It fires after a 100ms rest and is cancelled on leave/blur, so a
  sweep across the rail fetches only where the pointer stops. Home's cards call
  `prefetchSection` directly.
- **Idle warm-up**: `PersonasPage` drains the primaries through `idlePrefetch`
  after the first data wave, ordered by predicted use; dev-only surfaces are
  skipped in production.
- **Dedupe**: the first call per section keeps its import promise; later calls
  return it. A failed prefetch drops its entry and logs, so the next intent retries.

Warm return: a `UnifiedTable` with `tableId` or `scrollRestoreKey` keeps its
entrance seen-set in a module cache (`useRevealTracker(resetKey, surfaceKey)`),
so coming back plays no cascade and only genuinely new rows enter. A table with
neither key keeps the per-mount set and replays on remount; give it a key.
Rows are memoized (`UnifiedTableRow`): pass memoized `columns` and keep clocks
and store reads inside cell components, or an unchanged row will not refresh.

## Per-surface recipes

### Lists & tables (activity, events, messages, reviews, memories, incidents, ledgers)

**Pass `isLoading` and `data` to `display/UnifiedTable`. That is the whole
recipe.** Since `889a5204a` (2026-07-30) the primitive bakes in the entire
cold-load contract, and its own header doc says so
(`UnifiedTable.tsx:9-26`): the permanent column header always renders (law 5);
the body is a strict three-state machine — `isLoading && data.length === 0` →
calm delayed `TableGhostRows` under that header, `!isLoading && data.length ===
0` → the settled empty state, otherwise rows; and the id-guarded first-viewport
entrance cascade is **coupled to `isLoading`** by `resolveRowReveal`
(`UnifiedTable.tsx:248-258`), so passing the flag turns the ripple on
automatically. Add `emptyTitle` / `emptyDescription` (both default to
hardcoded English `'No data'` — always translate them). `rowReveal={{ resetKey
}}` re-ripples the same ids on a context switch; `rowReveal={false}` opts out;
`rowReveal` alone forces it on for store-backed data with no `isLoading`.

So: **no local `<XyzGhostRows>`, no `RevealItem`, no `useRevealTracker`, no
skeleton component, no `isLoading={false}`.** `DataGrid` gives the same ghost
branch and shares `useRowRevealEntrance` (`DataGrid.tsx:204`).

Only §B/§C below (hand-built `RevealItem` cascade + a module-local ghost) —
that is, a **genuinely non-tabular** list or tile grid where no primitive owns
row rendering.

> **⚠️ This recipe used to say the opposite, and it is still producing
> deviations.** Until 2026-08-13 it told authors to build a module-local
> `<XyzGhostRows>` and, when the primitive "can't cascade without shared
> edits", to *"**report** the cascade gap instead of hacking it"*. That
> escape hatch was closed by `889a5204a` and the text was never updated. The
> result is call sites that suppress the primitive's ghost with
> `isLoading={false}` to render their own, carrying comments that cite **this
> section by name** as the license, on the very `<UnifiedTable>` element that
> already passes `rowReveal={{ resetKey }}` — the prop closing the gap they
> claim is open (`EventLogList.tsx:453-478`,
> `LlmCallsTable.tsx:33-42` vs `:334`). If you are reading a comment in this
> repo that says UnifiedTable cannot cascade, the comment is stale: check the
> element's props.

### Panels & metric grids (sla, director, certification, leaderboard, health)
- Panel shells/section chrome render instantly.
- Cold + fetching → a geometry-matched ghost of the grid (delayed entrance,
  §C). The swap to real content is a plain conditional the frame data lands.
- Real content entering may stagger per **tile/section** (existing
  `animate-fade-slide-in` + per-tile `animationDelay`, or `Reveal` with
  `delay={i * 0.045}`) — tiles ripple, the page never block-fades.
- Numbers: `AnimatedCounter` / `SpringCount` counting up **is** the reveal —
  never ghost a number you could animate.
- Data retained across a parameter change (e.g. SLA day-range) stays on
  screen while the refetch runs (law 1).

### Charts
Reserve the chart's final box height in the frame. Empty + fetching → calm
delayed ghost rectangle in that exact box; series fades/draws in when data
lands. Never let a chart's absence collapse layout.

## Reduced motion
`RevealItem` short-circuits (marked entered, no animation); the CSS
`animate-fade-*` utilities are neutralized by the global reduced-motion block;
counters snap. Never add motion outside these gates.

## Definition of done (per module)

- [ ] Zero `LoadingReveal` / `useStableLoading` usages remain in the module.
- [ ] Pre-warmed store data paints on the first frame — verified by reading the
      store/hook: what exactly is in state when the component mounts warm?
- [ ] No `animate-pulse` anywhere; ghosts are calm, delayed ≥120ms, geometry-matched.
- [ ] Rows/tiles cascade; nothing replays on poll/refresh/scroll. *(On a
      `UnifiedTable`/`DataGrid` surface this is satisfied by passing
      `isLoading` — there is no cascade gap left to report.)*
- [ ] Every list/table surface renders through `UnifiedTable`/`DataGrid` with a
      real `isLoading`, and the module contains **no** local `*GhostRows`,
      `*Skeleton`, `RevealItem` or `isLoading={false}` in front of one.
- [ ] Empty state renders only when `!isFetching`, and its title/description are
      translated (both primitives default to hardcoded English `'No data'`).
- [ ] Static chrome (headers/filters/tabs/shells) outside every loading branch.
- [ ] **No region waits on another region's fetch** (law 6). Count the awaited
      IPC calls on cold mount and say which part of the first screen each one
      decides; anything that decides nothing visible is a prewarm, not an await.
      A `Promise.all` with one `setLoading(false)` behind it fails this item
      even when every other box is ticked.
- [ ] **No spinner is used as a surface loading state** — no `<LoadingSpinner>`
      (it renders `null`), no centred `Loader2`/`RefreshCw animate-spin`, no
      `fallback={<SuspenseFallback/>}` on a route. Spinners in this module are
      legitimate only inside `Button`/`AsyncButton`, i.e. on a control the user
      pressed — see [Scope](#scope--a-surface-not-a-control).
- [ ] `eslint` clean on touched files; TS types reasoned through.
