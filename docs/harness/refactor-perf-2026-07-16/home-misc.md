# home (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: App Shell, Settings & Sharing | Files read: 2 | Missing: 0

## 1. Cockpit chunk excluded from all prefetch paths — only home tab that always pays a cold lazy-load
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: bundle-prefetch
- **File**: src/features/home/lib/prefetch.ts:53
- **Scenario**: `HomePage.tsx` lazy-loads three home-tab chunks (Releases, Learning, Cockpit), but `schedulePrefetchOtherHomeTabs()` only warms Releases and Learning, and the sidebar hover prefetch (`SidebarLevel2.tsx:151-154`) also only maps `roadmap` and `learning`. Every first open of the Cockpit tab hits the Suspense spinner and a cold chunk fetch, while its two siblings open instantly.
- **Root cause**: Cockpit was presumably added to `HomePage.tsx` (line 9) after prefetch.ts was written; no `prefetchHomeCockpit` was added, so both the idle scheduler and the hover map silently miss it. The function name ("other home tabs") no longer matches what it covers.
- **Impact**: User-visible spinner on a top-level home tab that the app otherwise goes to great lengths to make instant (keep-alive panes, idle prefetch, hover prefetch). Inconsistent with the stated WebView2 chunk discipline.
- **Fix sketch**: Add `export const prefetchHomeCockpit = cache(() => import('@/features/home/sub_cockpit/CockpitPanel'));` and call it inside `schedulePrefetchOtherHomeTabs()`. Add a `cockpit` branch (or use the registry from finding 2) to the SidebarLevel2 hover handler.

## 2. Home-tab prefetch mapping duplicated ad hoc in SidebarLevel2 instead of a registry like `prefetchNavTarget`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/home/lib/prefetch.ts:20
- **Scenario**: prefetch.ts already has the id→prefetcher registry pattern (`NAV_PREFETCHERS` + `prefetchNavTarget`) for sidebar sections, but home tabs are exposed as two loose named exports, forcing `SidebarLevel2.tsx:152-153` to hand-roll an if/else mapping (`'roadmap'` → `prefetchHomeReleases`, `'learning'` → `prefetchHomeLearning`) with a dynamic `import()` of the prefetch module on every hover.
- **Root cause**: The registry pattern was applied to nav sections but not to home tabs, so tab-id→chunk knowledge is split across two files and must be kept in sync by hand — which is exactly how Cockpit fell through (finding 1).
- **Impact**: Maintenance hazard: adding/renaming a home tab requires touching HomePage, prefetch.ts, and SidebarLevel2 in lockstep; a miss degrades silently (no prefetch). Also duplicates the id-dispatch logic.
- **Fix sketch**: Add `const HOME_TAB_PREFETCHERS: Record<string, Prefetcher>` (roadmap, learning, cockpit) and `export function prefetchHomeTab(id: string)` mirroring `prefetchNavTarget`. Replace the SidebarLevel2 if/else with a single `void import('@/features/home/lib/prefetch').then(m => m.prefetchHomeTab(id))`, and have `schedulePrefetchOtherHomeTabs` iterate the same record.

## 3. `KNOWN_TABS` array literal rebuilt inside the HomePage render body
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/home/components/HomePage.tsx:32
- **Scenario**: `KNOWN_TABS` is a constant list of valid `HomeTab` values, but it is declared inside the component function, so a fresh array is allocated and `includes` re-scanned on every render of HomePage.
- **Root cause**: Constant data placed in render scope instead of module scope.
- **Impact**: Negligible runtime cost (5-element array), but it misreads as render-dependent state and clutters the component body; module scope also lets TypeScript catch a missing tab in one place.
- **Fix sketch**: Hoist `const KNOWN_TABS: readonly HomeTab[] = [...]` (or a `Set<HomeTab>`) above the component, next to `PANE_CLASS`. Behavior is unchanged.
