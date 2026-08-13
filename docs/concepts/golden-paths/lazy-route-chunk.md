# Golden path — Lazy route chunk

> Situation node: `ui-system/empty-and-loading/lazy-route-chunk` · [situation spine](../situation-spine.json)
> `sides: client` · `risk: high` · `recurrence: 147` · dimensions: performance, resilience, ui, function
> Absorbs the retired topics *Route and chunk splitting*, *Route chunk loading*,
> *Route chunk prefetch*, *Deferred and idle work*.
>
> Composed 2026-08-13 from a ground-truth sweep: 4,829 `.ts`/`.tsx` files walked
> twice by two independent matchers (a scratch script and the census engine,
> which agreed exactly), the four boundary primitives read in full, the
> 2026-08-09 production `dist/` measured (1,393 chunks), plus a read-only
> code-splitting census of the sibling repo `personas-web` (Next.js 16 App
> Router — 53 lazily-chunked components) used as a portability oracle.
>
> **Sibling leaf.** [`page-loading.md`](./page-loading.md) owns the *surface*
> loading contract — what a placeholder looks like once a component is mounted
> and fetching data. **This path owns the boundary before that**: which module
> becomes its own chunk, what stands in while the chunk is in flight, and what
> happens when the chunk fetch fails. Where the two touch (fallback aesthetics),
> this path states the rule and cites `page-loading.md` for the per-file list
> rather than repeating it. Where they conflict — `page-loading.md` §5 says
> "`fallback={null}` on a full route/section" is always wrong — **this path is
> the authority and corrects it** (see §2, §5).
>
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

## 1. Trigger

- "This tab/panel is heavy — should it be its own chunk?"
- "I'm adding a `React.lazy(() => import(...))`" — **stop; you want `lazyRetry`.**
- "What goes in the `Suspense fallback` for this lazy route?" / "can I just use `null`?"
- "I killed the dev server and now a section is stuck forever / renders nothing until I reload."
- "First open of Fleet / the 3-D gallery / the calendar is sluggish, then it's instant."
- "The bundle-size CI step is complaining about the index chunk."
- "This click opens a modal but nothing happens for half a second, then it appears."

## 2. The one way

Every surface that is not needed for first paint becomes its own chunk, and the
chunk boundary is declared with **`lazyRetry`**, never raw `React.lazy` — a raw
`lazy` caches a rejected import promise permanently, so one failed fetch bricks
the surface until a full page reload (the 2026-06-07 incident). Declare the
boundary at the place that *decides* which surface to show — the router, the tab
switcher, the overlay host — never inside the surface itself, and pair it with an
`ErrorBoundary`, because Suspense catches the pending promise while only an error
boundary can catch the permanent failure. Choose the fallback by **who asked for
the surface, not by whether it is a "route" or an "overlay"**: if a user action
pointed at this surface, the fallback must occupy it (`RouteChunkSkeleton` for a
page or tab, a delayed sized box for anything else) — `null` there is a click that
does nothing; if the surface appears without being asked for (a background
service, a self-guarding toast, an invisible widget), `null` is the *only* correct
fallback and anything else is an uninvited flash. Keep the boundary invisible when
the chunk is warm: warm it with `idlePrefetch` off the startup critical path, and
give the fallback the 150ms `animate-fade-in` invisibility window so a resolved
chunk never paints a pixel of it. Splitting is not deferring — if the cost is
*committing the DOM* rather than *fetching the module*, that is `DeferUntilIdle`,
and the two compose. Then stop: do not hand-roll a retry, a fallback skeleton, an
idle scheduler, or a module-scope import cache; all four already exist.

**Warrant of each clause** (per [`research/portability-test.md`](../research/portability-test.md)
recommendation 2 — a reader in another repo must be able to sort physics from
local calibration):

| Clause | Warrant | Evidence it is not local taste |
|---|---|---|
| One wrapper owns every chunk boundary | **physics** | `personas-web` reinvented it as `createLazySection` (`LazySection.tsx:40-49`) and its factory forces a fallback: **22/22 factory sites have one, 2/31 hand-rolled sites do** |
| A chunk boundary needs a failure path | **physics** | `personas-web` has *none* (0 `ChunkLoadError`, 0 retry, 0 reload) and pays for it: a failed chunk there yields a stuck skeleton or an error card whose Retry re-runs the same failing import |
| Declare the boundary where the surface is chosen, not inside it | **physics** | independently arrived at in both repos: `sectionRouter.tsx:33-42` here, `sections/lazy.tsx` + `page.tsx:43-58` there |
| Split ≠ mount — separate primitives | **physics** | both repos built the pair independently: `lazyRetry` + `DeferUntilIdle` here, `dynamic` + `LazyMount` (`rootMargin: "800px 0px"`) there |
| Keep the first-paint surface a static import | **physics** | `feature-lazy.tsx:5-10` there ("DesignEngine stays a static import (above the fold) for LCP + SEO"); the app shell here |
| Heavy vendor libs get their own named chunk | **physics** | `vite.config.ts:119-161` here; per-named-export recharts splitting at `UsageChartCards.tsx:9-39` there |
| The fallback is chosen by *who asked*, not route-vs-overlay | **physics** (newly separated here) | neither repo states it; both repos' defects are exactly the cases the route/overlay dichotomy mislabels |
| `lazyRetry`'s specific mechanism (one stable `lazy`, one 1.5 s retry, permanent failure to the boundary) | **house convention** | calibrated to `React.lazy`'s promise caching; a `next/dynamic` repo needs a different mechanism for the same requirement |
| The 150 ms invisibility window on the fallback | **house convention** | rests on "chunks resolve off local disk in tens of ms". `personas-web` paints its skeleton immediately and deliberately, because its network latency is real. Same unstated precondition that made `page-loading.md`'s pulse ban non-portable |
| Idle-prefetch every deferred chunk | **house convention** | `personas-web` prefetches **no component chunks at all** (only `router.prefetch` on 3 dashboard routes). Justified here by a local-first app with no network cost per chunk; a metered-network repo should not copy it |
| `fallback={null}` being *allowed* at all | **house convention, and it is leaking** | `personas-web`'s factory makes a missing fallback unrepresentable. Here it is a default (`SectionFallback = null`) and 25 sites use it wrongly (§7 B) |

## 3. Mandated primitives

- **`lazyRetry(() => import(...))`** (`src/lib/lazyRetry.ts:63-76`) — the drop-in for
  `React.lazy`. One automatic retry after 1.5 s (`:23-34`) covers the transient
  case; a **permanent** rejection is rethrown to the nearest `ErrorBoundary`.
  Read `:52-60` before touching it: an earlier version swapped in a fresh `lazy`
  on rejection, which raced React's error propagation and produced an **infinite
  loading skeleton** against an unreachable chunk. A single stable instance is
  what guarantees the failure actually reaches a boundary. Consequence you must
  design around: **re-rendering the same boundary re-throws the cached error
  instantly — "Try Again" cannot recover a chunk failure. Only a reload can.**
- **`isChunkLoadError(error)`** (`lazyRetry.ts:12-17`) — matches the three engine
  messages (WebView2/Chromium, WebKit, Firefox). This is what turns a generic
  crash card into a recoverable one.
- **`feedback/ErrorBoundary`** (`ErrorBoundary.tsx:96`) — calls `isChunkLoadError`
  and adds a **"Reload app"** button (`:157-168`) alongside "Try again". The only
  reliable recovery for a chunk that no longer exists.
- **`layout/RouteChunkSkeleton`** (`RouteChunkSkeleton.tsx:31-45`) — the fallback
  for a route or tab chunk. Invisible for 150 ms via CSS `animationDelay` +
  `fill-mode: both` (no JS timer), then a header-band-only
  `ContentHeaderSkeleton calm`. Props `showIcon` / `showActions` / `showSubtitle`
  — match them to the header the route actually renders so the swap is shift-free.
  **Never fake body geometry** (`:14-17`).
- **`idlePrefetch(imports, { initialDelayMs })`** (`idlePrefetch.ts:83`) — warms
  chunks into the V8 module cache during idle time, **one chunk per idle slice**
  (`:65-82`: `import()` resolution is a synchronous, non-interruptible V8
  parse+evaluate that ignores the idle deadline; scheduling all N at once stacked
  into multi-hundred-ms main-thread blocks). Returns a cancel function. Order the
  list most-likely-needed first.
- **`layout/DeferUntilIdle`** (`DeferUntilIdle.tsx:3-32`) — the **mount** boundary,
  not the chunk boundary. `priority: 'idle' | 'next-frame' | 'mount-after'`, plus
  an optional one-shot `fallback`. Use it when the cost is committing DOM nodes
  (WebView2 hitches on large single commits), not fetching a module.
- **`installPreloadErrorRecovery()`** (`preloadErrorRecovery.ts:37`, wired at
  `main.tsx:147`) — listens for Vite's `vite:preloadError` and reloads once per
  30 s throttle window. **Production builds only** (see Gap 4).
- **`vite.config.ts:114-167` `manualChunks`** — the vendor split. A heavy library
  reachable from more than one lazy chunk belongs here, not inside whichever
  chunk happens to import it first (`:147-152` is the worked example for three.js).
- **`vite.config.ts:182-190` `optimizeDeps.include`** — a dependency imported
  *only* from a lazy chunk must be listed, or Vite first discovers it mid-session,
  kicks off a dep re-optimization and **504s the in-flight dynamic import**.

## 4. Steps

1. **Decide whether it should be a chunk at all.** Yes if it is a route, a tab
   panel, a plugin sub-page, an editor, a modal/drawer the user must click to
   open, or it pulls a heavy library (charts, xterm, three.js, markdown, flow).
   No if it renders on first paint, or if it is small and always visible — a
   chunk for a 3 KB component costs a round trip and buys nothing.
2. **Declare it with `lazyRetry`, at module scope of the file that chooses
   between surfaces** — the section router, the tab switcher, the overlay host.
   Not inside the surface, and never inside a component body (a new `lazy` per
   render remounts the tree on every parent render).
3. **Wrap it `ErrorBoundary → Suspense → <Component/>`**, in that order.
   `renderSectionRoute` (`sectionRouter.tsx:87-100`) is the canonical shape; copy
   it rather than re-deriving it.
4. **Pick the fallback from the trigger, not the shape.**
   - User navigated/clicked here → `<RouteChunkSkeleton …/>` for a page or tab;
     for a modal or drawer, a delayed sized box that reserves the surface.
   - The surface mounts itself (background service, toast host, self-guarding
     overlay) → `fallback={null}`, and nothing else.
   - Follow [`page-loading.md`](./page-loading.md) §3 for what the placeholder
     may look like; do not invent a second skeleton vocabulary here.
5. **Warm it.** Add the same `() => import(...)` to the nearest `idlePrefetch`
   list, ordered by visit frequency, behind an `initialDelayMs` that clears the
   startup contention window (`App.tsx:251` uses 2000 ms; `PersonasPage.tsx:208`
   uses 1500 ms). Prefetch is what makes a `null`-or-invisible fallback honest.
6. **If the chunk drags a heavy shared library in, add it to `manualChunks`**
   (`vite.config.ts:119`) so the library caches independently of your component.
   If the library is *only* reachable from lazy chunks, also add it to
   `optimizeDeps.include` (`:182`) or dev will 504 the first navigation.
7. **If the problem is commit cost, not fetch cost, reach for `DeferUntilIdle`
   instead** — or both: split the chunk *and* defer the mount.
8. **And then stop.** Do not write a retry, a reload prompt, a skeleton, an idle
   scheduler, or a `let cachedModule` — steps 2, 3, 4, 5 already delivered all five.
9. **Verify the boundary is real**: with the dev server killed mid-session,
   navigating to your surface must land on the `ErrorBoundary` card *with* the
   "Reload app" button — not a blank area, not a permanent skeleton.

## 5. Anti-patterns

- **`React.lazy(() => import(...))`** — caches the rejected promise forever; one
  transient failure bricks the surface until a full reload. This is the single
  most common violation here (**105 sites**, §7 A).
- **`fallback={null}` on a surface the user just asked for** — the click does
  nothing for the duration of the fetch, so the user clicks again. `page-loading.md`
  §5 frames this as "fine for overlays, wrong for a route"; that dichotomy is
  what let 17 click-opened research-lab modals pass as "overlays". **The test is
  who initiated it, not what shape it is.**
- **A fallback for a surface nobody asked for** — the mirror error. A skeleton
  for a background service or a toast host is a flash of UI the user never
  requested.
- **`Suspense` without an `ErrorBoundary` around it** — Suspense catches the
  pending promise and has no opinion about rejection. Without a boundary the
  error propagates to whatever ancestor exists, usually unmounting far more than
  the failed chunk.
- **A `SilentErrorBoundary`-style null-rendering boundary around a chunk** — the
  chunk failure becomes invisible: no card, no reload button, no signal (§7 G).
- **Relying on an error boundary's "Try again" / retry ladder to recover a chunk**
  — it cannot. `lazyRetry` keeps one stable `lazy` on purpose (`lazyRetry.ts:52-60`),
  so a remount re-throws the cached error instantly. Retry ladders burn their
  attempts in milliseconds.
- **`lazy()` inside a component body or a `useMemo`** — a new lazy identity per
  render; React remounts the subtree and re-suspends.
- **Declaring the boundary inside the surface it splits** — the parent still
  imports the surface to render it, so nothing is actually deferred.
- **A body-silhouette fallback** — lies about the incoming geometry; header band
  only (`RouteChunkSkeleton.tsx:14-17`).
- **Hand-rolling the 150 ms delayed blank div** — that *is* `RouteChunkSkeleton`;
  four sites re-implement it (§7 D).
- **A second idle scheduler** — `idlePrefetch` already serializes one chunk per
  slice for a measured reason; a parallel implementation reintroduces the burst
  it was rewritten to remove (§7 E).
- **Scheduling prefetch during the startup window** — chunk evaluation is
  synchronous and ignores the idle deadline; use `initialDelayMs`.
- **Adding a lazy-only dependency without `optimizeDeps.include`** — a dev-only
  504 on the very first navigation to the new surface.
- **A static import of a `*Page` module** — it lands in the index chunk and
  silently un-splits the route (guarded for exactly one file today; §8 Gap 5).

## 6. Evidence

**The one site to copy:** `src/features/personas/sectionRouter.tsx` — the whole
path in one 116-line file. Boundaries declared at the router (`:33-42`), the
`ErrorBoundary → Suspense → Component` shape factored into `renderSectionRoute`
(`:87-100`), the fallback parameterised with its decision rule written down
(`:77-85`), and a `satisfies Record<RoutableSection, SectionRoute>` guard that
fails the typecheck if a new section forgets to route.

- `src/lib/lazyRetry.ts:36-76` — the primitive and, more valuable, the recorded
  failure of its own v1 at `:52-60`.
- `src/lib/lazyRetry.test.tsx` — 4 cases including the permanent-failure-reaches-
  the-boundary assertion.
- `src/features/shared/components/feedback/ErrorBoundary.tsx:96,140-141,157-168` —
  chunk-specific copy plus the "Reload app" action.
- `src/App.tsx:104-108` — the rationale comment ("lazyRetry instead of raw
  React.lazy") at the largest deferred-overlay cluster; `:144-159` the matching
  prefetch list with the note that the `.then(m => ({default: m.X}))` transform
  is unnecessary for prefetch (module identity matches by URL); `:251` the
  2000 ms delayed start.
- `src/features/personas/PersonasPage.tsx:183-208` — route-level idle prefetch
  ordered by visit frequency, with the reasoning for each addition.
- `src/features/shared/components/layout/RouteChunkSkeleton.tsx:36-44` — the
  invisibility window; rationale `:10-17`.
- `src/features/plugins/fleet/FleetGridLayer.tsx:5-10` — the clearest
  *why-this-is-a-chunk* comment in the repo (xterm is heavy and WebView2-sensitive,
  and the footer status cluster needs none of it).
- `src/features/shared/chrome/useTitleBarTray.tsx:14-22` — same, for tray overlays
  ("the tray only needs a number until someone opens it").
- `src/features/overview/components/dashboard/ExecutionsWithSubtabs.tsx:6-8,52-61`
  — correctly distinguishes the *chunk* placeholder from the *data* placeholder,
  and says why it must not fake the incoming body.
- `vite.config.ts:147-152` — three.js hoisted out of the lazy `ThreeViewer` chunk
  so the 1 MB engine caches independently of the wrapper component.
- `vite.config.ts:172-190` — the xterm `optimizeDeps` note; the only written
  record of the lazy-chunk 504.
- `src/lib/recovery/preloadErrorRecovery.ts:1-9,47-66` — throttled reload on
  `vite:preloadError`; `preloadErrorRecovery.test.ts` covers the throttle.
- `src/__tests__/structural/personas-page-code-splitting.test.ts:1-35` — the only
  machine gate on the boundary today; its header is a good statement of *why*
  static page imports are a defect.
- `src/features/shared/components/layout/DeferUntilIdle.tsx:3-32` — the mount
  boundary and its three priorities.

## 7. Deviations found

**A. Chunk boundaries declared with raw `React.lazy` — no recovery from a failed fetch**

**105 call sites across 38 files** (whole-file match, comment lines excluded;
verified by two independent matchers). Against **68 `lazyRetry` sites across 7
files**. So **61 % of this repo's chunk boundaries cannot survive the exact
failure that produced the 2026-06-07 incident** — and the surfaces that *were*
fixed are the app shell and the two top-level routers, i.e. the incident was
patched where it was observed, not where the class lives.

| Cluster | Sites | What it splits |
|---|---|---|
| `settings/components/SettingsPage.tsx:9-21` | 13 | every Settings tab panel |
| `plugins/research-lab/ResearchLabPage.tsx:11-18` | 8 | every Research Lab tab |
| `plugins/dev-tools/DevToolsPage.tsx:5-11` | 7 | every Dev Tools tab |
| `plugins/twin/TwinPage.tsx:17-23` | 7 | every Twin tab |
| `plugins/obsidian-brain/ObsidianBrainPage.tsx:10-15` | 6 | every Obsidian Brain tab |
| `plugins/companion/CompanionPluginPage.tsx:13-16` · `plugins/dev-tools/sub_skills/SkillsManagerPage.tsx:36-39` · `agents/sub_editor/components/EditorLazyTabs.tsx:3-14` · `shared/chrome/DesktopFooter.tsx:24-32` | 4 each | tabs; footer widgets |
| `home/components/HomePage.tsx:8-10` · `onboarding/components/TourPanelBody.tsx:13-15` · `plugins/artist/ArtistPage.tsx:9-11` · `plugins/fleet/FleetPage.tsx:10-12` · `plugins/twin/sub_tone/TonePage.tsx:5-7` | 3 each | home tabs, tour steps, tabs |
| research-lab modals/forms across 10 files (`ExperimentsPanel.tsx:20-21`, `HypothesesPanel.tsx:17-18`, `LiteratureSearchPanel*.tsx`, `ResearchProjectList*.tsx`, `ReportsPanel.tsx:16-17`, `FindingsPanel.tsx:16`) | 16 | click-opened modals and drawers |
| `overview/sub_health/components/PersonaHealthDashboard.tsx:12,16` · `triggers/TriggersPage.tsx:25-26` · `shared/chrome/useTitleBarTray.tsx:17-20` | 2 each | tabs; tray overlays |
| `App.tsx:47` (DevInspector) · `agents/quick-answer/QuickAnswerPopover.tsx:27` · `agents/sub_design/DesignHub.tsx:20` · `overview/…/ExecutionsWithSubtabs.tsx:8` · `plugins/artist/sub_gallery/Gallery3D.tsx:14` · `plugins/fleet/FleetGridLayer.tsx:10` · `schedules/components/ScheduleTimeline.tsx:26` · `shared/charts/RechartsWrapper.tsx:14` · `home/sub_releases/HomeReleases.tsx:38` · `home/sub_welcome/WelcomeLayout.tsx:13` · `teams/sub_goals/GoalsTimeline.tsx:32` | 1 each | heavy libs, overlays, glyphs |

Three of these are the *highest-consequence* possible: `FleetGridLayer.tsx:10`
(→ the 489 KB `fleetTerminalManager` chunk), `Gallery3D.tsx:14` (→ the 1,008 KB
`vendor-three` chunk) and `RechartsWrapper.tsx:14` (→ the 450 KB `vendor-chart`
chunk). The larger the chunk, the likelier the fetch fails, and these three are
the only ones with no retry.

**B. `fallback={null}` where the user asked for the surface — 25 sites**

Of 33 `fallback={null}` / `fallback={SectionFallback}` sites, **8 are correct**
and 25 are dead clicks.

| Path | What's wrong |
|---|---|
| `personas/PersonasPage.tsx:257,287,290,366,368` | `const SectionFallback = null` (`:67`) behind the cloud deployment panels, the create-persona entry (×2), the build entry and the **persona editor** — five full content surfaces, each reached by an explicit click, each rendering a blank content area until its chunk lands. |
| `personas/sectionRouter.tsx:26,90` | the default fallback for **all ten section primaries** is `null`. Eight of the ten are reached with it (only `teams` passes `RouteChunkSkeleton`, `PersonasPage.tsx:321`). The docstring (`:81-85`) justifies this as "right for chunks that are idle-prefetched and warm" — but `HomePage` and `StudioPage` appear in **no** prefetch list (`App.tsx:144-159`, `PersonasPage.tsx:189-208`, `home/lib/prefetch.ts:30-38`), and `HomePage` is the *default landing route*, so the cold first paint of the app is governed by a `null` fallback. |
| research-lab, 17 sites in 10 files — `ExperimentsPanel.tsx:244,250` · `FindingsPanel.tsx:128` · `HypothesesPanel.tsx:184,190` · `LiteratureSearchPanel.tsx:220,226` · `…Atelier.tsx:167,172` · `…Workbench.tsx:227,232` · `ResearchProjectList.tsx:217` · `…Atelier.tsx:177,608` · `…Cartograph.tsx:161` · `ReportsPanel.tsx:150,156` | every "Add source / Add hypothesis / New project / Preview report" button opens a modal whose entire chunk sits behind `fallback={null}`. The button appears inert. This is the class `page-loading.md`'s route-vs-overlay rule mislabels as legitimate. |
| `plugins/fleet/FleetGridLayer.tsx:47` | footer click raises the grid; the xterm chunk loads behind `null`, so the overlay simply doesn't appear yet. |
| `shared/chrome/useTitleBarTray.tsx:194` | tray → Dispatch panel behind `null`, while the sibling branch at `:200` correctly uses an `OverlayFallback`. Two branches of one component, two different answers. |
| `agents/quick-answer/QuickAnswerPopover.tsx:103` | the popover's **entire body** is the lazy chunk; the popover opens empty. |

**Correct and to be left alone** (the surface mounts itself, no user asked):
`App.tsx:313` (dev inspector), `App.tsx:352` (`BackgroundServices` — renders no
UI), `App.tsx:364` (the self-guarding global overlay group, and it is
idle-prefetched), `shared/chrome/DesktopFooter.tsx:547,563,574,577` (footer
icons — a skeleton would be a flash in the chrome),
`plugins/artist/sub_gallery/ThreeViewer.tsx:137` (inner R3F probe under an outer
fallback at `:161`).

**C. Fallbacks that render an empty box** — 5 `<SuspenseFallback/>` route sites
(`DesignHub.tsx:102`, `EditorBody.tsx:182`, `WelcomeLayout.tsx:65`,
`FleetPage.tsx:88`, `SettingsPage.tsx:84`) plus 4 hand-rolled centred-spinner
boxes. `SuspenseFallback.tsx:13-16` centres a `LoadingSpinner`, and
`LoadingSpinner.tsx:12-20` **renders `null`** — so these are `py-12` voids.
Already enumerated in [`page-loading.md`](./page-loading.md) §7 D; not repeated
here. The chunk-boundary addition it misses: `agents/sub_glyph/personaCore/PersonaCoreModal.tsx:37`
(same shape, plus a hardcoded English string).

**D. `RouteChunkSkeleton` re-implemented — 4 copies**

| Path | What's wrong |
|---|---|
| `overview/components/dashboard/OverviewPage.tsx:35-60` | `OverviewRouteSkeleton` — the **origin** of the shared primitive (`RouteChunkSkeleton.tsx:8-9` names it as such) was never re-pointed at the extraction, so the original and the extraction now drift in parallel with duplicated doctrine comments. |
| `triggers/TriggersPage.tsx:39-48` | local `LazyWrap` wrapping the same 150 ms delayed blank div. |
| `overview/components/dashboard/ExecutionsWithSubtabs.tsx:52-61` | same inline div (with a good reason for ghosting nothing — but the *delay mechanic* is still copy-pasted). |
| `home/components/HomePage.tsx:53-59` | same again, as a local `fallback` const. |

**E. Two competing prefetch primitives**

`src/features/home/lib/prefetch.ts` is a second, independent implementation:
its own `cache()` memoiser (`:12-23`), its own idle scheduler (`:48-56`), and
`schedulePrefetchOtherHomeTabs` (`:59-64`) fires **both** chunks in one idle
callback — precisely the burst behaviour `idlePrefetch` was rewritten to
eliminate (`idlePrefetch.ts:65-76`). It also carries a wrong comment
(`:5-6`, "browser/webpack" — this is a Vite/Rolldown build). Only three callers
(`HomeWelcome.tsx:58`, `NavigationGrid.tsx:48`, `SidebarLevel2.tsx:185`), and its
hover-intent prefetch (`prefetchNavTarget`) fires **only from the Home welcome
nav grid** — clicking the same section in the sidebar rail prefetches nothing.

**F. Doctrine comments that contradict the primitive — 3 sites**

`PersonasPage.tsx:40-41`, `sectionRouter.tsx:31-32` and `ErrorBoundary.tsx:93-95`
all tell the next reader that `lazyRetry` "swaps in a fresh lazy instance after
failure, so the next error-boundary reset / remount re-imports" / "the lazyRetry
wrappers make 'Try Again' re-import". `lazyRetry.ts:52-60` documents that design
as **removed**, because it looped forever against an unreachable chunk, and
`:50-51` states the opposite: *"'Try Again' simply re-shows the error; it does
not loop."* Three files instruct future authors to rely on behaviour that was
deliberately deleted.

**G. A chunk failure inside the global overlay group is invisible**

`App.tsx:363` wraps thirteen overlays in one `Suspense`, inside
`SilentErrorBoundary` (`App.tsx:74-102`), whose `render()` is
`hasError ? null : children`. A chunk failure there removes the command palette,
toast containers, notification centre, mini-player, companion panel, tour and
onboarding **with no UI, no reload button and no user-visible signal** — only a
log line at `:87`. Its 3-retry ladder (`:79-80`, 5 s/15 s/45 s) cannot help,
because the stable `lazy` re-throws the cached error immediately; after ~65 s the
overlays are gone for the session. The group boundary was added to limit blast
radius (comment `:356-362`) and does that job for render crashes; for chunk
errors it converts a recoverable failure into a silent one.

**H. The mount boundary is essentially unadopted** — `DeferUntilIdle` has three
priorities, a `fallback` prop and its own test file, and **2 call sites**
(`WelcomeLayout.tsx:60`, `DashboardHomeMissionControl.tsx:347`). `personas-web`
gates 7 of its 10 homepage sections through the equivalent primitive.

## 8. Gaps in the primitive

1. **`lazyRetry` is a convention, not a chokepoint.** Nothing stops
   `import { lazy } from 'react'`; no ESLint `no-restricted-imports` entry, no
   type-level barrier. Contrast `invokeWithTimeout`, which *is* enforced that way,
   and contrast `personas-web`'s `createLazySection`, whose signature makes a
   missing fallback unrepresentable (`LazySection.tsx:40-49` — and the resulting
   compliance is 22/22 vs 2/31). **The single highest-leverage fix in this
   document is to give `lazyRetry` a `fallback` parameter and restrict the raw
   import**, which collapses deviation classes A, B and C into one change.
2. **The boundary and its fallback are declared in different places.**
   `lazyRetry` returns a component; the `Suspense` that decides what shows while
   it loads is written somewhere else, often in another file (`EditorLazyTabs.tsx`
   declares four chunks; their only boundary is `EditorBody.tsx:182`). That
   separation is why 25 boundaries ended up with `null`.
3. **No fallback primitive for a non-route chunk.** `RouteChunkSkeleton` is
   header-band-shaped by design. A modal, drawer, popover or overlay chunk has
   no shared answer, which is exactly why 17 research-lab modals and 3 overlays
   chose `null`. A `<ChunkFallback surface="modal"|"drawer"|"panel"/>` sibling
   would close deviation class B.
4. **`vite:preloadError` does not exist in dev.** The event is emitted by the
   build-time preload helper — present in the production output
   (`dist/assets/preload-helper-*.js`, verified) and absent in `vite dev`, where
   dynamic imports are native `import()`. So the repo's only *automatic* chunk
   recovery is off in the exact environment that produced the incident it was
   written for. The dev-side recovery is entirely the ErrorBoundary card — which
   deviation G shows is missing for the overlay group.
5. **The structural test guards exactly one file.**
   `personas-page-code-splitting.test.ts` asserts three genuinely good invariants
   (a `lazyRetry` count floor, no static import duplicating a lazy specifier, no
   static `*Page` import) — against `PersonasPage.tsx` only, via a hardcoded
   `import.meta.glob` path. `sectionRouter.tsx`, `OverviewPage.tsx`,
   `SettingsPage.tsx`, `DevToolsPage.tsx` and every plugin router have no
   equivalent. Generalising it over "files that render `Suspense`" is a
   ~20-line change.
6. **The byte budget's total half carries no information.**
   `scripts/lib/bundle-budget.mjs` sets `MAX_CHUNK_KB = 850` / `MAX_TOTAL_KB = 5000`.
   Measured against the working-tree production build (2026-08-09, 1,393 chunks):
   total JS is **31,293 KB — 6.3× the budget** — and three chunks exceed the
   per-chunk ceiling (`vendor-three` 1,009 KB, `index` 907 KB, `en` 888 KB). The
   per-chunk number is real and tuned; the total number has no relationship to
   the artifact it measures, so it can only ever report FAIL, which is
   informationally identical to reporting nothing. Either re-baseline it to the
   real total (and make it a ratchet) or delete it — but note this is a *byte*
   gate either way: it cannot see a boundary that was never declared, which is
   what §9 is for.
7. **`chunkSizeWarningLimit: 500` (`vite.config.ts:85`) is 350 KB below the CI
   ceiling**, so the build prints warnings on chunks CI accepts. A warning that
   fires on every build is not read.
8. **No written decision procedure for what becomes a chunk.** The good reasoning
   exists but is scattered across per-site comments (`FleetGridLayer.tsx:5-10`,
   `useTitleBarTray.tsx:14-22`, `App.tsx:104-106`, `vite.config.ts:147-152`).
   `personas-web` colocates its decision tree with the factory
   (`LazySection.tsx:25-39`) and its feature docs cite it *by line number* — the
   cheapest available improvement, and it is what §4 step 1 above is trying to be.
9. **`idlePrefetch` has no coverage assertion.** Its list and the `lazyRetry`
   declarations are two hand-maintained lists of the same modules
   (`App.tsx:144-159` even documents the duplication), and drift is silent: four
   section primaries are declared lazy and prefetched by nobody.

**Not a gap — confirmed working:** `vite:preloadError` recovery is live in
production builds (helper present in `dist/`, listener installed at
`main.tsx:147`, throttle unit-tested); `lazyRetry`'s no-swap design is correct and
its rationale is recorded; `manualChunks` demonstrably splits the four heaviest
vendors into independently-cacheable chunks.

## 9. The missing gate

**Every deviation above shipped under a green `npm run check`.** The only
existing machine gate on this situation is one structural test scoped to one file.

### The census rule (added — `scripts/census/rules.json`)

```jsonc
{
  "id": "raw-react-lazy",
  "goldenPath": "docs/concepts/golden-paths/lazy-route-chunk.md",
  "title": "Code-split boundary declared with raw React.lazy instead of lazyRetry",
  "roots": ["src"], "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?<![A-Za-z0-9_$.])lazy\\s*\\(", "flags": "g",
    "ignoreCommentLines": true,
    "description": "a chunk boundary declared with raw React.lazy(); lazyRetry() is the drop-in that survives a failed chunk fetch instead of caching the rejection forever (2026-06-07 incident). Proxy for: a dynamic-import boundary with no recovery path."
  },
  "baseline": { "files": 38, "matches": 105 },
  "floor": 4000
}
```

Verified: `node scripts/census/run-census.mjs --rule raw-react-lazy` reports
`38 / 105 / walked 4829`, matching an independently written scratch matcher
exactly (the contract's "verify through a second implementation before
baselining"). `npm run census:check` passes with all four rules.

**The semantic condition this signal proxies for** — *a dynamic-import boundary
declared without the wrapper that owns the repo's chunk-failure recovery.* The
text `lazy(` is not that condition; it is the shape the condition wears **here**,
where React.lazy is the only chunk mechanism and `lazyRetry` is the only wrapper.
An adopting repo must re-derive its own proxy: in `personas-web` the same
condition is "a `dynamic(` call that does not go through `createLazySection`",
and a `lazy(` signal would score **0 matches** there while 31 hand-rolled
boundaries — 29 of them with no fallback and none with any failure path — sit in
plain sight. That is the wave-1 failure mode, and it is why this section states
the condition instead of only the regex.

**Precondition, stated so it can be invalidated:** this repo has exactly two ways
to declare a chunk boundary, and they are textually distinguishable. The rule
becomes inert the day a third appears (a factory, a `next/dynamic`-style helper,
a routing library that splits for you). **Fail-loud is delegated to the census
engine**, which already exits 1 when the walk sees fewer files than `floor` ("the
matcher is broken, not the codebase clean"), when the rule matches zero files
anywhere, when a count rises, and — critically for a migration like this one —
when a count **drops** without the baseline being ratcheted.

**False positives: 0.** All 105 matches were read; every one is a
`React.lazy` component declaration. No `exclude` entries are needed and none were
added: `lazyRetry.ts:66` writes `lazy<T>(`, which the pattern does not match, and
the two test files contribute zero matches. (A speculative exclude would itself
fail the run as a stale exemption.)

**Expected trajectory:** this baseline should ratchet **down** to a small
allowlist, not stay flat. The correct terminal state is 0 — `lazyRetry` is a
prop-compatible drop-in, so every one of the 105 is a mechanical edit.

### The second assertion, which needs ESLint rather than the census

The fallback half of this path — deviation class B, 25 sites — **cannot** be
expressed as a text count. `fallback={null}` is correct at 8 sites and wrong at
25, and the discriminator is *what the boundary wraps and how it was reached*:
a self-mounting background service versus a surface a click pointed at. That is
a question about the JSX subtree under the `Suspense` and the component that
renders it, i.e. AST/graph shape, not text — the precise case
[`inline-busy-state.md`](./inline-busy-state.md) §9 identifies as ESLint's
territory. The rule:

- **Name:** `custom/lazy-chunk-fallback`.
- **Signal:** a `JSXElement` named `Suspense` whose `fallback` is `null` **and**
  whose descendant elements include an identifier bound at module scope to a
  `lazy(...)` / `lazyRetry(...)` initialiser, **and** which is not inside a
  component whose name matches the allowlist below. Report: *"a chunk the user
  navigated to needs a fallback that occupies the surface; `null` is a dead click."*
- **Allowlist, named:** `App.tsx`'s three overlay boundaries (self-mounting;
  documented at `:104-108` and `:356-362`), `DesktopFooter.tsx` footer icons,
  `ThreeViewer.tsx:137` (inner R3F probe under an outer fallback). Five entries,
  each with a prose reason, exactly as the census requires.
- **Autofix:** none — the correct fallback depends on the surface
  (`RouteChunkSkeleton` for a page/tab, a sized delayed box for a modal), which
  is why this wants a report, not a codemod.
- **Fixture-tested** with `RuleTester`, including the negative cases, so the rule
  fails loudly rather than silently matching nothing if the JSX shape changes.

The two compose in the documented way: **the ESLint rule reports, the census
ratchets.** Once the rule exists, add a second census entry keyed on its report
count so the fallback deviations can only go down.

### What no gate can cover

Gap 8 — *whether a surface should have been a chunk at all* — is a judgement, not
a predicate. The available substitute is documentation placed where the decision
is made: a decision tree colocated with `lazyRetry` and cited by line number from
the feature docs, which is what `personas-web` does
(`LazySection.tsx:25-39` ← `docs/features/marketing/homepage-hero.md:14`) and what
§4 step 1 of this path is a first draft of. That is a finding, not an omission.
