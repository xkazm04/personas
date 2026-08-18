---
layer: application
subject: app-shell
technique: lazy-section-loading
stack: react
---

# RouteChunkSkeleton + idlePrefetch + routeSections — lazy sections in this repo

## The placeholder contract, implemented in pure CSS

`src/features/shared/components/layout/RouteChunkSkeleton.tsx` is the
standard `Suspense` fallback for every lazy section/tab chunk, and it
implements two of the technique's rules exactly:

- **Delayed appearance with zero timer code**: the whole fallback sits behind
  `animation-delay: 150ms` with fill-mode `both` (`RouteChunkSkeleton.tsx:39-41`),
  so a warm or prefetched chunk resolves before a single pixel paints.
- **Never fake the incoming body**: only the header band ghosts
  (`ContentHeaderSkeleton`), because it is the one region every route shares
  at the same position — body silhouettes would lie about each page's
  geometry (the component's own docblock states this doctrine).

`src/features/plugins/dev-tools/DevToolsPage.tsx` is the canonical consumer:
seven lazy sub-pages behind **one** `Suspense` boundary
(`DevToolsPage.tsx:30-38`), one loadable unit per destination — no
per-widget waterfall.

## Prefetch on intent, idle warm-up, and the frame that never blanks

`App.tsx` defers the heavy machinery out of first paint and then warms it:
`idlePrefetch(LAZY_OVERLAY_IMPORTS, { initialDelayMs: 2000 })` (`App.tsx:251`)
drains one chunk per idle slice into the V8 module cache, so the lazy
boundary for the command palette resolves synchronously by the time the user
presses its shortcut — the technique's "idle warm-up" with an explicit
politeness delay to stay out of the contended first-load window
(`App.tsx:245-251`). The shell itself (titlebar, sidebar, banners) renders
eagerly around the routed content, so no chunk transition touches the frame.

Locale assets ride the same section boundary: `src/i18n/routeSections.ts`
declares which translation sections each sidebar section needs;
`BASE_SECTIONS` (`routeSections.ts:25-53`) is reserved for shell chrome, the
active route's sections preload before mount, and hover-intent prefetch warms
language chunks (`useLanguagePrefetch`). This is the technique's "the unit
includes what the section needs to render meaningfully" — code without its
strings paints a broken surface on time.

## Chunk failure is handled, and the poisoned-cache case was learned the hard way

`src/lib/lazyRetry.ts` wraps the lazy imports: a failed chunk load retries,
and the surrounding `ErrorBoundary` renders a stated failure rather than a
blank viewport. The motivating incident is on record — a killed dev server
left the module loader caching *rejected* chunk promises forever, so even
recovery replayed the failure; `lazyRetry` + boundary was the fix. That is
the technique's "the failed-unit record must not poison the session,"
demonstrated by its exact failure.

## Where the repo falls short of the standard (kept, not hidden)

- **Warm return is uneven.** Section pages unmount on nav-away (the content
  router mounts one section at a time), and only sections that adopted the
  module-scoped-cache pattern paint warm on return; others re-run cold-load
  choreography on every visit. The code chunk stays warm; the surface state
  does not, unless the section opted in.
- **An undeclared locale section fails as empty success.** A translation
  section listed nowhere in `routeSections.ts` is never fetched in any
  non-English locale and renders English forever with no runtime signal —
  the file's own header documents this trap. It is fenced by a checker
  script and a coverage test, but the runtime itself cannot tell "not
  needed" from "forgot to declare".
- **Hover-intent prefetch covers language chunks, not section code chunks.**
  Nav-entry hover does not begin fetching the target section's code; only
  the idle warm-up and the click path load it.
