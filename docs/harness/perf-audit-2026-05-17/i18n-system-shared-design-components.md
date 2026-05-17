# Perf-Optimizer Scan — i18n System & Shared Design Components

> Project: Personas (frontend-only)
> Scope: 21 paths in src/
> Total: 10 findings (3 C / 4 H / 2 M / 1 L)

## Scope notes

- `useTranslation()` is called from **hundreds** of components — verified by grep returning 1307 matches across `src/`. Any per-render cost compounds: at e.g. 200 mounted translated components × 60fps interaction, a 1µs overhead becomes a 12ms frame budget hit. Findings here are weighted by that fan-out.
- Scope drift: assigned path `src/i18n/locales` exists but is **not** the runtime locale source — runtime locales now live at `src/i18n/section-locales/{lang}/{section}.json` (50 sections × 13 non-en languages, ~11 MB total disk). `src/i18n/locales/*.json` are kept as legacy single-file dumps for the coverage gate. English at runtime is loaded as JSON *strings* from `src/i18n/generated/enSectionStrings.ts` (601KB source file, ~280k tokens) and `JSON.parse`d on first section access.
- Also surveyed (not in assigned list but architecturally critical): `src/i18n/englishSections.ts`, `src/i18n/routeSections.ts`, `src/stores/i18nStore.ts`, `src/features/shared/components/layout/sidebar/{Sidebar,SidebarLevel1,SidebarLevel2,SidebarSubNav}.tsx`, `src/features/shared/glyph/InteractiveSigil.tsx`, `src/features/shared/components/{display,buttons}/*`.

---

## 1. `useTranslation` subscribes to the WHOLE i18nStore — every component re-renders on `fontReady` flip

- **Severity**: critical
- **Category**: re-render
- **File**: `src/i18n/useTranslation.ts:320` (`const { language } = useI18nStore();`)
- **Scenario**: User switches language to `zh`/`ar`/`hi`/`bn`/`ja`/`ko`. `applyLangAttributes` flips `fontReady: false` in `i18nStore.ts:62`, and once the `<link>` loads `fontReady: true` in `i18nStore.ts:43`. Every single component currently mounted (1307 call sites grep'd, certainly hundreds rendered at any moment) re-renders twice on a language switch — once for `language` change (correct) and once more solely because `fontReady` toggled (wrong).
- **Root cause**: `useI18nStore()` with no selector subscribes to the full state object. Any field change triggers a re-render of every consumer. `fontReady` has nothing to do with translation but rides the same store.
- **Impact**: On language switches involving CJK/Indic/Arabic fonts the entire UI repaints **twice** (~2× the unavoidable cost). Also, any future field added to `I18nState` will silently fan out to the whole app.
- **Fix sketch**: Replace `const { language } = useI18nStore();` with `const language = useI18nStore((s) => s.language);`. Same pattern in `useTranslation.ts:301` (`useI18nStore.getState()`) is fine — it's a non-reactive read.

---

## 2. `useActiveI18nSections()` returns a fresh array on every render — kills downstream memos

- **Severity**: critical
- **Category**: re-render
- **File**: `src/i18n/routeSections.ts:30-31`, consumed at `src/i18n/useTranslation.ts:321,150`
- **Scenario**: Every render of every component that calls `useTranslation()` (hundreds of components) walks through `sectionsForRoute(sidebarSection)` which does `[...new Set([...BASE_SECTIONS, ...(ROUTE_SECTIONS[section] ?? [])])]`. That returns a brand-new array literal each call. `useTranslation()` then immediately passes it to `preloadSections(language, routeSections)` (line 324), which loops over all 9-15 sections and does a `getCachedSection` + `Promise.resolve()` lookup each time.
- **Root cause**: No memoization. The result is deterministic for a given `sidebarSection` value but is re-computed on every consumer render. Also the `useLanguagePrefetch` hook's `useMemo([routeSections])` (lines 152-155) is **defeated** because its dependency is the fresh array — the memo invalidates every render.
- **Impact**: Per render of every translated component: ~14 string spreads, 14 hash lookups, 14 promise allocations from `Promise.resolve()`, plus a `useMemo` cache miss in any consumer storing this array. At 200 mounted components × 60fps this is measurable GC pressure (thousands of throwaway promises/arrays per second under heavy scroll/animation).
- **Fix sketch**: Cache `sectionsForRoute` results by `section` key: `const ROUTE_SECTIONS_CACHE = new Map<SidebarSection, readonly TranslationSection[]>();`. Return a frozen, stable array per route. Alternatively, accept the de-dup cost but memoize the *output array reference* so React's downstream `useMemo`/`useEffect` deps stop invalidating.

---

## 3. `useTranslation()` returns a fresh `{ t, language, tx }` object every render

- **Severity**: critical
- **Category**: re-render
- **File**: `src/i18n/useTranslation.ts:327-337`
- **Scenario**: Any consumer that destructures `const { t } = useTranslation()` and then passes `t` (or a slice of it) to a `useMemo`/`useEffect` dependency, or to a `React.memo`'d child, breaks the memo because the parent's `t` is `bundleCache.get(lang)!` (which is stable — Proxy from `getBundle`) but **the wrapper object** is not. More importantly, `tx: interpolate` is the same function reference but the outer object literal changes, and code like `const { tx } = useTranslation()` followed by passing `tx` to a child that's `React.memo`d will compare `tx` itself (stable) — but any code passing the result `useTranslation()` itself to a context provider (e.g. test wrappers) or destructuring into a memo deps array hits churn.
- **Root cause**: No `useMemo` wrapping the return value of the hook.
- **Impact**: Compounding effect with finding #1 — even after fixing the store subscription, this hook still allocates a new object 200×60 = 12,000 times per second on a busy screen. Cheap individually but compounds with finding #2's array allocation and with any downstream consumer that uses the result as a memo dep.
- **Fix sketch**: Wrap the return in `useMemo(() => ({ t: bundle, language, tx: interpolate }), [bundle, language])`. `bundle` reference is stable per-lang already (cached at `useTranslation.ts:233-258`).

---

## 4. Every `useTranslation()` consumer subscribes to `useSystemStore` for `sidebarSection`

- **Severity**: high
- **Category**: re-render
- **File**: `src/i18n/routeSections.ts:35` (`useSystemStore((s) => s.sidebarSection)`) → called from `useTranslation.ts:321`
- **Scenario**: Every component that calls `useTranslation()` transitively subscribes to `useSystemStore` for `sidebarSection`. When the user clicks a top-level sidebar nav, `sidebarSection` changes, and **every translated component** in the app gets a state-change notification, re-renders, recomputes route sections, calls `preloadSections`, etc. The vast majority of those components don't care about `sidebarSection` for their own logic — they only care which i18n sections are loaded.
- **Root cause**: `useTranslation()` couples translation to route via `useActiveI18nSections()`. The route preload is correct in concept but should not be the job of the leaf consumer hook — it should run once at route boundary.
- **Impact**: A nav click is amplified to N component re-renders where N = all translated components currently mounted across the *whole* app (including off-screen tabs in keep-alive routes, modals, etc.).
- **Fix sketch**: Move `preloadSections` out of `useTranslation()`. Either:
  - Call `preloadI18nForCurrentRoute(...)` once in a top-level effect in `App.tsx` (already exported at `routeSections.ts:39`), OR
  - Use a non-reactive read: `preloadSections(language, sectionsForRoute(useSystemStore.getState().sidebarSection))` inside a `useEffect([language])` that also subscribes to sidebar changes via `useSystemStore.subscribe` at module level (one subscriber instead of N).

---

## 5. `getBundle` Proxy `get` handler triggers `preloadSections` as a side-effect of property access

- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/i18n/useTranslation.ts:234-260`
- **Scenario**: When a non-English bundle is requested, `getBundle` returns a `Proxy`. Every property access (e.g. `t.common.save`) goes through `get(_target, prop)` which, on cache miss, calls `preloadSections(lang, [prop])` (line 240) — kicking off loaders mid-render. A single render of a translated component touches many sections (e.g. `t.common.save`, `t.errors.foo`, `t.sidebar.bar`); each first-touch triggers a fresh `preloadSections` round, each of which iterates the section, looks up loaders, allocates promises, and broadcasts via `listeners.forEach`.
- **Root cause**: Mixing observer notification + lazy loading + cache fill into a property getter. Renders should be pure observations; loaders should be scheduled via effects/preload calls explicitly.
- **Impact**: Under language switch (non-en), first render of any page sees a cascade of `preloadSections` calls — one per *distinct top-level section* accessed during that render — each broadcasting a `bundleVersion++` + `listeners.forEach`, which retriggers `useSyncExternalStore` subscribers, causing more renders and more property accesses. This is a render storm hazard, especially because `getResolvedSection` at line 242 falls back to English while loading, so the rendered tree is "lying" until the chunk lands and then everything re-renders again.
- **Fix sketch**: Remove the in-render `preloadSections(lang, [prop])` from the getter — sections should be requested explicitly via `preloadSections` from route/intent handlers, not as a render side-effect. Keep the getter pure: just return `getResolvedSection(lang, prop)` (which already falls back to English). Hover/route prefetch is already wired via `useLanguagePrefetch`.

---

## 6. `useSidebarLabels` builds a 40-entry `Map` on every `t.sidebar` change

- **Severity**: high
- **Category**: re-render
- **File**: `src/i18n/useSidebarTranslation.ts:14-97`
- **Scenario**: `Sidebar`, `SidebarLevel1`, `SidebarLevel2`, `SidebarSubNav` all call `useSidebarLabels()`. Each instance memos a 40-entry `Map` keyed on `[t.sidebar]`. Combined with finding #3 (`t` *appears* stable per language but the wrapper changes), and finding #1 (whole-store subscription), this means the Map is rebuilt on every store-event-triggered re-render — for every sidebar surface that uses it.
- **Root cause**: The Map is per-component-instance instead of being module-level memoized. Translation bundles per-language are stable references; the Map could be cached by `t.sidebar` identity in a `WeakMap<TSidebar, Map<string, string>>` at module scope.
- **Impact**: SidebarSubNav calls `labelOf(item.id, item.label)` inside its `items.map` render — each render path creates the map, then does N lookups. Across `Sidebar` + `SidebarLevel1` + `SidebarLevel2` + `SidebarSubNav` it's 4× duplicated work for the same translation.
- **Fix sketch**: Hoist `labelMap` to module scope keyed by `t.sidebar` reference: `const CACHE = new WeakMap<object, Map<string,string>>();` Build once per language and share across all sidebar consumers. Alternatively, return a stable singleton resolver function from a context.

---

## 7. `pseudoLocale.buildPseudoBundle` cache never invalidates on English bundle change

- **Severity**: high
- **Category**: memory / correctness
- **File**: `src/i18n/pseudoLocale.ts:62-67` (`let cached: Translations | null = null;`)
- **Scenario**: Dev-only feature, but: `buildPseudoBundle` walks the entire English bundle, transforms every string, and caches the result. The cache is built on **first call** with whatever English bundle was passed. If subsequent calls pass a different/newer English bundle (e.g. after HMR or after lazy sections fill in), the cache silently returns the stale pseudo-bundle. Also `getBundle()` is called per render — even though `cached` short-circuits, the `transform(en)` call is unconditional on cache miss and walks ~600 KB of text.
- **Root cause**: Cache invalidation strategy is "never". `cached` survives HMR.
- **Impact**: Dev-only — but the first pseudo-locale render walks the entire JSON-parsed English tree, doing string accentuation on every leaf. Cold pseudo-mode first-paint stalls visibly. Also, because `getEnglishTranslations()` at `englishSections.ts:23` eagerly parses ALL 50 sections, pseudo activation forces parse of every section even ones the user never visits.
- **Fix sketch**: Build pseudo bundle as a `Proxy` mirroring `getBundle`, lazily accent-transforming each section on first access and caching per-section. Avoids the upfront eager walk.

---

## 8. `tokenLabel` re-walks `t.status_tokens[category]` per token resolution; no memo

- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/i18n/tokenMaps.ts:35-51`
- **Scenario**: Status badges and indicators call `tokenLabel(t, 'execution', row.status)` or `tokenLabel(t, 'severity', issue.severity)` per row. In a table with hundreds of rows + frequent status changes, each render does `t.status_tokens[category]` (proxy access; if lang is non-en this can hit `getResolvedSection` and the merge cache), then `token in section` (string-keyed lookup), then property read.
- **Root cause**: No batching/memoization. Per-row, per-render lookup is fine in isolation but tables with 500+ rows + animated status pulse can hit this 30k times/sec.
- **Impact**: Combined with finding #5 (Proxy getter side-effects), each `tokenLabel` call may also re-trigger `preloadSections` checks. Death by a thousand cuts in dense list views.
- **Fix sketch**: Provide a `useTokenResolver(category)` hook that builds a per-render-stable lookup function bound to the *resolved section object* (one section access, then plain `Record` reads). Or accept `(category, token)` pairs and memoize at the consumer layer.

---

## 9. `StatusBadge` / `Badge` join class-name array with `.filter(Boolean).join(' ')` on every render

- **Severity**: medium
- **Category**: re-render (micro)
- **File**: `src/features/shared/components/display/StatusBadge.tsx:99-106`, `src/features/shared/components/display/Badge.tsx:103-107`, also `src/features/shared/components/buttons/Button.tsx:157-176`
- **Scenario**: These primitives are referenced by virtually every feature. Each render allocates an array literal, filters it, joins it. Plus `Button.tsx:157` allocates a similarly large array. Class-name churn means the `class=` attribute is also a new string per render, defeating any DOM-diff fast path.
- **Root cause**: Eager string composition per render. The combinations are bounded by `(variant × size × accent × pill × className)` which is a small Cartesian.
- **Impact**: At ~200 badges/buttons on a dashboard, 200 array-filter-joins per render, ~12k/sec at 60fps under animation. CPU-cheap individually, but unnecessary GC. Plus changing `className` string forces React to write the attribute every render even when content is identical.
- **Fix sketch**: Memoize via a `useMemo` keyed on the variant/size/accent/className props, or use a tiny `clsx` helper. For the static-variant case (most consumers pass `variant="success"`), a lookup table keyed on `${variant}-${size}-${pill}` would give a stable string reference.

---

## 10. `GlyphCard` calls `useTranslation()` but only reads `t.templates.chronology` — and so does its child `InteractiveSigil`

- **Severity**: low
- **Category**: duplicate-call
- **File**: `src/features/shared/glyph/GlyphCard.tsx:48-49`, `src/features/shared/glyph/InteractiveSigil.tsx:107-108`
- **Scenario**: `GlyphCard` calls `useTranslation()` and reads `c = t.templates.chronology`. `InteractiveSigil` (rendered as a child) **also** calls `useTranslation()` and **also** reads `c = t.templates.chronology`. Both pay the full overhead of finding #1-#5 just to read the same slice. The card is rendered N×M times (N templates × M capabilities each) in catalog views, doubling the i18n hook cost vs. passing `c` down as a prop.
- **Root cause**: Convenience vs. perf trade — child re-fetches translation locally. Pre-finding-fixes, this means 2× the cost per glyph. Post-fixes, still 2× the cheap cost.
- **Impact**: Minor on its own. Becomes a measurable hot path when a "View All Templates" page renders 50 glyphs (each with 8-petal `InteractiveSigil` + nested `SigilPetal`s, all calling translation hooks).
- **Fix sketch**: Either pass the `chronology` slice down as a prop from `GlyphCard` to `InteractiveSigil`, or extract a `useTemplatesChronology()` hook that's a thin slice-only wrapper. Same pattern applies anywhere a parent and child both call `useTranslation()` for the same slice.

---

## Summary of compounding effects

Findings #1 + #2 + #3 + #4 + #5 are **architecturally linked** — every component that calls `useTranslation()` pays for *all five* on every render: (1) whole-store subscription, (2) fresh sections array, (3) fresh return object, (4) reactive sidebar subscription, (5) potential preload side-effect via Proxy. A focused refactor of `useTranslation.ts` + `routeSections.ts` (~30 lines changed) would defang findings 1-5 simultaneously and is the single highest-leverage change in this audit.
