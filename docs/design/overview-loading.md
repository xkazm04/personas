# Overview Loading Choreography — the Golden Pattern

> Single source of truth for how every Overview module (and, over time, any
> data-heavy surface) presents loading. The goal: **the layout is always there;
> rich backend content flows in calmly on top of it.** No pulsing skeletons, no
> blank flashes, no blinks.

## Why

The Overview loaders were an inconsistent mix of three anti-patterns:

1. **Pulsing skeletons** (`ListSkeleton` / `TableSkeleton` / `ContentHeaderSkeleton`, `animate-pulse`) — the pulse draws the eye, and the skeleton→content geometry swap *blinks*.
2. **Blank / empty-flash bodies** — several tabs render `null` (or a now-disabled spinner) while loading, so the body pops from empty → full.
3. **No shared rhythm** — each tab reinvents its loading state.

Every tab already keeps its `ContentHeader` frame stable. We build on that: keep
the frame, and replace the data-region treatment with a calm, staggered,
motion-faded reveal that is *deliberately paced* so heavy backend content never
janks in all at once.

## The four layers of a loading surface

| Layer | When | How |
|---|---|---|
| **1. Frame** | first commit, always | `ContentBox` + `ContentHeader` (title/subtitle/actions — all i18n/client-static) + section containers **at their final geometry**. Never gated on data. |
| **2. Primary content** | as data arrives | Cross-fade in with `<LoadingReveal>` / `<Reveal>`. Fast/cached → straight to content; slow → calm placeholder first. |
| **3. Rows / lists** | spread over time | Render the real (virtualized) list and stagger rows in with `useProgressiveReveal` + `RevealItem`. **Never** a pulse skeleton for the rows themselves. |
| **4. Below-fold / heavy** | deferred | `DeferUntilIdle` (`next-frame` for near-fold, `idle` for far) + a `<Reveal>` on mount. Keeps the first commit light (WebView2 hitch guard). |

## Rules (non-negotiable)

1. **Never `animate-pulse` for primary content.** Use a calm placeholder
   (`<ListSkeleton calm />` / `<TableSkeleton calm />`) or no placeholder at all.
2. **Never a blank/`null` body during load.** The frame is layer 1; the data
   region uses `<LoadingReveal>`. A blank body reads as broken.
3. **Fast loads show no placeholder.** `useStableLoading`'s grace window
   (140ms) means cached data fades straight to content — no flash.
4. **Shown placeholders honor a minimum duration.** `useStableLoading`'s
   min-visible (420ms) means a placeholder can't appear-and-vanish in a blink.
5. **Deliberately spread heavy content.** Above-the-fold first; below-the-fold
   via `DeferUntilIdle`; long lists via `useProgressiveReveal` (≈2s, size-invariant).
6. **Content-shaped placeholders only.** Match the final silhouette (row-height
   slots, sized chart box, KPI tiles) so the reveal is a *fade*, not a *resize*.
7. **All motion via the shared primitives**, which are reduced-motion aware —
   under `prefers-reduced-motion` everything collapses to an instant, movement-free swap.
8. **i18n + tokens.** Any loading label goes through `t.*`; use semantic design
   tokens (`bg-primary/*`, `typo-*`, `rounded-*`), never raw colors.

## The primitive toolbox

| Primitive | Path | Use |
|---|---|---|
| `useStableLoading(loading, { graceMs, minVisibleMs })` | `hooks/utility/interaction/useStableLoading.ts` | Anti-flash + anti-blink timing gate → `showLoading: boolean`. |
| `<Reveal delay? y?>` | `shared/components/feedback/Reveal.tsx` | Fade (+ slide-up) a single block in on mount. Replaces ad-hoc `motion.div variants={fadeUp}`. |
| `<LoadingReveal loading placeholder>` | `shared/components/feedback/LoadingReveal.tsx` | The workhorse: cross-fades a calm placeholder ↔ content, gated by `useStableLoading`. |
| `<ListSkeleton calm />` / `<TableSkeleton calm />` | `shared/components/layout/` | Content-shaped, **non-pulsing** placeholder for the loading branch. |
| `useProgressiveReveal(total, { resetKey })` + `RevealItem` / `useRevealTracker` | `hooks/utility/interaction/useProgressiveReveal.ts` | Spread the *mounting* of an already-fetched list over ~2s (size-invariant), staggered per row. |
| `DeferUntilIdle priority="next-frame"\|"idle"` | `shared/components/layout/DeferUntilIdle.tsx` | Hold heavy/below-fold subtrees out of the first commit. |
| `staggerContainer` / `fadeUp` / `revealFromBelow` | `overview/libs/animations.ts` | Variants for grouped staggered reveals (Overview-local). |
| `useMotion()` / `useReducedMotion()` | `hooks/utility/interaction/useMotion.ts` | Reduced-motion gate (the primitives already consult this). |

## Per-surface recipes

### A. Table / list module (events, activity, messages, knowledge-patterns, …)

```tsx
// Frame is always present (ContentHeader + toolbar). Gate ONLY the body.
<ContentBody flex>
  <LoadingReveal loading={q.loading} placeholder={<ListSkeleton calm rows={8} rowHeight={ROW_H} />}>
    <UnifiedTable data={rows} ... />   {/* rows staggered via useProgressiveReveal inside */}
  </LoadingReveal>
</ContentBody>
```
- Prefer feeding `UnifiedTable`/virtualized list through `useProgressiveReveal` so rows cascade in; the calm placeholder only covers the pre-first-page window.

### B. Dashboard of panels (home / mission-control) — already close

- Keep the instant frame. Wrap each pane in `<Reveal delay={i * 0.045}>` (or a
  `staggerContainer` parent) so panes cascade. Below-fold sections stay under
  `DeferUntilIdle priority="next-frame"` with a `<Reveal>` inside. Replace any
  `<Suspense fallback={null}>` on a *visible* widget with a calm sized box.

### C. Single-panel / metrics grid (sla, director, certification, leaderboard, incidents)

- Replace the full-body blank/spinner with:
```tsx
<LoadingReveal loading={loading} placeholder={<MetricsGridPlaceholder /* calm, sized */ />}>
  <MetricsGrid ... />
</LoadingReveal>
```
- Where a bespoke placeholder is overkill, omit `placeholder` — the frame shows,
  then content `<Reveal>`s in. Deliberately avoids the empty→full pop.

### D. Chart / KPI tiles

- Reserve the chart's final box (fixed height); `<LoadingReveal>` with a calm
  sized rectangle, or fade the chart in with `<Reveal>` once its series lands.
- KPI counters keep animating up (`AnimatedCounter`/`SpringCount`) from 0 — that
  *is* the reveal; don't skeleton them.

## Reduced motion

All primitives consult `useMotion()`/`useReducedMotion()`. Under
`prefers-reduced-motion: reduce` (and when the window is hidden — the app wraps
everything in `<MotionConfig reducedMotion="user">`), reveals collapse to an
instant, transform-free opacity settle and `useProgressiveReveal` shows
everything at once. Never add motion that bypasses these gates.

## Definition of done (per module)

- [ ] Frame renders on first commit; no data-gated header.
- [ ] No `animate-pulse` on primary content; no blank/`null` body.
- [ ] Data region wrapped in `<LoadingReveal>` (or rows via `useProgressiveReveal`).
- [ ] Fast/cached load shows no placeholder flash; slow load shows a calm, min-duration placeholder.
- [ ] Below-fold/heavy widgets deferred.
- [ ] Reduced-motion verified (instant, no movement).
- [ ] `npx tsc --noEmit` clean, `eslint` clean on touched files, any new strings in `en.json` + `check:i18n:strict` clean.
