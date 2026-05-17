# Perf-Audit Fix Wave 1 — i18n / useTranslation triad

> 5 commits, 5 findings closed (3 critical + 2 high).
> Baseline preserved: tsc 0→0, eslint 0→0, vitest 1412/1416 → 1412/1416 (same 4 pre-existing `useLifecycle.test.ts` drift).

The single highest-leverage cluster in the 201-finding catalog. `useTranslation()` is called by ~1300 sites across `src/` (hundreds mounted at any moment), and every consumer was paying for five compounding inefficiencies on every render. This wave defuses all five.

## Commits

| # | Commit | Finding closed | Severity | Files |
|--:|--------|----------------|----------|-------|
| 1 | `5f108d56b` | i18n #2 — `sectionsForRoute` returns a fresh array per call | critical | `src/i18n/routeSections.ts` |
| 2 | `00ce837e8` | i18n #1 — `useTranslation` subscribes to the whole `useI18nStore` | critical | `src/i18n/useTranslation.ts` |
| 3 | `9d162a922` | i18n #3 + #4 — fresh `{t, language, tx}` per render + `preloadSections` side-effect in render | critical + high | `src/i18n/useTranslation.ts` |
| 4 | `c67d38a63` | i18n #5 — `preloadSections` side-effect in bundle Proxy `get` handler | high | `src/i18n/useTranslation.ts` |
| 5 | `196aeb234` | i18n #6 — `useSidebarLabels` rebuilds 40-entry Map per consumer per render, unstable callback | high | `src/i18n/useSidebarTranslation.ts` |

## What was fixed

### 1. `sectionsForRoute` is now memoized by `SidebarSection`
The function used to return `[...new Set([...BASE_SECTIONS, ...(ROUTE_SECTIONS[section] ?? [])])]` — a fresh frozen-shape-but-fresh-identity array on every call. Because `useTranslation()` calls it on every render and passes the array to `preloadSections(...)`, every translated component allocated ~14 string spreads and 9-15 promise allocations per render, and any downstream `useMemo([routeSections])` was defeated.

The new implementation caches the result in `ROUTE_SECTIONS_CACHE: Map<SidebarSection, readonly TranslationSection[]>` and freezes the returned array. Identity is now stable for the lifetime of the process per route.

### 2. `useTranslation()` uses a selective `useI18nStore` subscription
The old `const { language } = useI18nStore();` was a destructure with no selector, so any change to `I18nState` triggered a re-render — including the `fontReady` flag that flips twice per language switch (`false` when CJK/Arabic/Indic font load begins, `true` on `<link>.onload`). Every translated component was therefore re-rendering **twice** per language switch on top of the legitimate `language` change.

`useI18nStore((s) => s.language)` isolates the hook from `fontReady` and from any future field added to `I18nState`.

### 3. `useTranslation()` returns a memoized object and preloads in `useEffect`
The return value was a fresh `{ t, language, tx }` object literal per render — so any consumer that destructured `t` and passed it to a `useMemo`/`useEffect` dep, a `React.memo`'d child, or a context provider, was getting churn even when only the parent re-rendered. Wrapped in `useMemo(() => ({ t, language, tx }), [bundle, language])`.

Concurrently, `preloadSections(language, routeSections)` was being called synchronously in render — kicking off async section loaders + `listeners.forEach` broadcasts as a side-effect of every component render. Moved into a `useEffect([language, routeSections])`. The dep array is stable because fix #1 made `routeSections` stable per route.

### 4. Bundle Proxy `get` handler is now a pure read
The Proxy that wraps non-English bundles used to fire `preloadSections(lang, [prop])` from inside `get(prop)` on every property access where the section wasn't cached. A single render of a translated component reads many sections (`t.common.save`, `t.errors.foo`, `t.sidebar.bar`), so first-touch on each kicked off a fresh loader + listener broadcast — which re-triggered `useSyncExternalStore` subscribers, causing more renders + more property accesses (a render storm hazard under language switch). The getter now just returns `getResolvedSection(lang, prop)` (which already falls back to English while loading), with no side-effects. The hook's `useEffect` covers route-aware preloading; `useLanguagePrefetch` covers hover-intent.

### 5. `useSidebarLabels` builds its 40-entry Map at module scope
Sidebar, SidebarLevel1, SidebarLevel2, SidebarSubNav all called `useSidebarLabels()`, and each instance ran its own `useMemo([t.sidebar])` that rebuilt the same 40-entry `Map` from scratch — 4× duplicated work per render. The build is now keyed by the `t.sidebar` reference in a module-scope `WeakMap<SidebarBundle, Map<string, string>>`. Section bundles are stable per language (cached in `mergedSectionCache` in `useTranslation`), so the map is built exactly once per language and shared across all sidebar consumers. The returned lookup is wrapped in `useCallback` so `React.memo`'d children keep their memoization.

## Verification table

| Gate | Baseline | After Wave 1 | Status |
|------|----------|--------------|:------:|
| `tsc --noEmit` | 0 errors | 0 errors | ✓ |
| `eslint --quiet src/` | 0 errors | 0 errors | ✓ |
| `vitest run` | 1412 / 1416 passing | 1412 / 1416 passing | ✓ |
| git HEAD | `329409f4a` | `196aeb234` | +5 commits |
| Test failures introduced | — | 0 | ✓ |

The 4 pre-existing failures in `src/features/agents/components/matrix/__tests__/useLifecycle.test.ts` are unchanged by this wave and remain in the active "Fix 31 failing tests" goal.

## Cumulative status

| Wave | Theme | Findings closed | Commits |
|------|-------|-----------------|---------|
| 1 | **i18n / useTranslation triad** | 5 (3C + 2H) | 5 |
| — | — | — | — |
| **Total** | | **5 / 201** | **5** |

## Patterns established (catalogue items 1-6)

These six patterns generalize beyond i18n. Future audits should grep for these shapes proactively.

1. **Selective Zustand subscriptions for hot hooks.** When a hook is called by hundreds of components, always destructure via selector (`useStore((s) => s.field)`) rather than `useStore()`. Whole-store subscription means *any* state change fans out to *every* consumer. Particularly dangerous when the store holds incidental flags (font load state, init flags) alongside the field consumers actually care about.

2. **Memoize lookup-table builders by input identity.** When a function returns a derived object/array deterministically from a stable input (e.g. `sectionsForRoute(SidebarSection)`), cache by input identity in a `Map` (or `WeakMap` when inputs are object refs). Stable output identity preserves React.memo / useMemo / useEffect dep equality downstream.

3. **No side-effects in render.** Don't kick off async loaders, listener broadcasts, or property-getter side-effects during render. Move to `useEffect`. This is doubly important for shared hooks (useTranslation) because the side-effect fans out N×. The bundle-Proxy `get`-side-effect pattern was the worst offender here — render-triggered loaders re-triggered renders.

4. **Module-scope caches for per-render derivations consumed by multiple components.** When 4+ component instances each `useMemo` the same derivation of a stable bundle (e.g. the sidebar label map), hoist the derivation to a module-scope `WeakMap` keyed by the bundle identity. The `useMemo` per consumer was technically correct but each instance maintained its own cache, multiplying memory + first-render work.

5. **Stable callbacks for hook return values consumed by React.memo children.** Wrap the returned function in `useCallback`, the returned object in `useMemo`. Cheap to add; expensive to omit when downstream components are `React.memo`'d.

6. **Pure bundle Proxy getters.** A translation/config/state bundle exposed as a Proxy should be pure — `get(prop)` resolves cached values; side-effect bootstrap belongs in the consuming hook's `useEffect`. Side-effects inside getters mix observation with mutation and break render purity.

## What remains

After Wave 1, the perf-audit catalogue still holds:
- **22 criticals** across 16 contexts — Realtime cascade (Wave 2 candidate), keystroke-rate editors (Wave 3), unvirtualized lists (Wave 4), polling/IPC (Wave 5), cascade-recompute (Wave 6), algorithmic + per-tile (Wave 7)
- **80 highs**, **73 mediums**, **21 lows**

The next-highest-leverage block is **Wave 2: Realtime event-bus coalescing** (6 criticals, 1 high, ~7 commits). After Wave 1's i18n fixes land, every realtime tick is now cheaper per subscriber — adding rAF coalescing on top compounds the win. See `INDEX.md` for the full wave plan.
