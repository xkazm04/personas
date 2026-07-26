# Loading Choreography — the Golden Pattern (v2)

> Single source of truth for how data-heavy surfaces present loading.
> **Reference implementation: `src/features/overview/sub_activity/components/GlobalExecutionList.tsx`**
> — study it before migrating any surface. v1 of this doc prescribed a
> whole-region cross-fade gate (`LoadingReveal`); live use proved that pattern
> WRONG (skeleton on every visit, content held after data arrived, one big-bang
> reveal). v2 replaces it with row/tile-level choreography.

## The five laws

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

## Per-surface recipes

### Lists & tables (activity, events, messages, reviews, memories, incidents, ledgers)
Copy the reference implementation: three-state body under permanent column
chrome (`ghost / empty / rows`), `RevealItem` cascade on the first viewport,
ghosts per §C. If the table primitive owns row rendering (`UnifiedTable`) and
can't cascade without shared edits: skip the cascade (rows paint instantly —
that's law 2), keep ghosts + settled-only empty state, and **report** the
cascade gap instead of hacking it.

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
- [ ] Rows/tiles cascade (or the gap is reported, not hacked); nothing replays
      on poll/refresh/scroll.
- [ ] Empty state renders only when `!isFetching`.
- [ ] Static chrome (headers/filters/tabs/shells) outside every loading branch.
- [ ] `eslint` clean on touched files; TS types reasoned through.
