# home/releases — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: App Shell, Settings & Sharing | Files read: 4 | Missing: 4

Note: the context spec is stale — `HomeRoadmapView.tsx`, `ReleaseDetailView.tsx`, `ReleaseNavRail.tsx`, and `releaseSelection.ts` were deleted when the feature was collapsed into the single `HomeReleases.tsx` view (its header comment documents the 5-file consolidation). `roadmapItems.ts` (+ test) exists in the directory but is not in the spec; it was read for context.

## 1. Dead translation surface survives the nav-rail/changelog deletion — in the shim, en.ts, and all 14 locale catalogs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/home/sub_releases/i18n/useReleasesTranslation.ts:33
- **Scenario**: `ReleasesTranslation` still declares and assembles `navBar.roadmapLabel`, `subtitle.changelog`, `summary.inProgress`, `summary.next`, and `empty`. Their only consumers were the deleted `ReleaseNavRail`/changelog components; a repo-wide grep finds no remaining reads. The backing keys (`nav_bar_roadmap_label`, `subtitle_changelog`, `summary_in_progress`, `summary_next`, …) are still defined in `src/i18n/generated/types.ts` and translated in every locale JSON (verified in zh.json, vi.json).
- **Root cause**: The 5-file → 1-file consolidation trimmed components but not the translation contract they consumed; the shim faithfully re-assembles keys nobody reads.
- **Impact**: Dead strings maintained across 14+ locale catalogs (translators keep localizing copy that never renders), plus type-surface noise that misleads future edits into thinking a changelog/nav-bar view still exists.
- **Fix sketch**: Delete `navBar`, `subtitle.changelog`, `summary`, and `empty` from `ReleasesTranslation` and its assembly (lines 33, 40, 42, 56-58, 84-87, 94); remove the corresponding `releases.whats_new.*` keys from `src/i18n/en.ts` and regenerate types; let the locale-catalog parity tooling drop them from the per-locale JSONs.

## 2. `useReleasesTranslation` rebuilds a ~120-property nested object on every render with no memoization
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/home/sub_releases/i18n/useReleasesTranslation.ts:50
- **Scenario**: Every render of `HomeReleases` (live status transitions, refresh toggles, `useWhatsNewIndicator`/`useSystemStore` updates — and the component stays mounted under the keep-alive HomePage) re-executes the shim, allocating the full nested `t` object: ~120 property reads plus fresh object literals for every release/item entry.
- **Root cause**: The compatibility shim (self-described as temporary) reassembles the flat en.ts keys into the legacy nested shape inline in the hook body, without `useMemo` on `raw`/`language`.
- **Impact**: `t`'s identity changes on every render, so it can never participate in memoization (`React.memo` on `LiveRoadmapStatusPill`/cards, or deps arrays) and guarantees the whole subtree re-renders; the allocation itself is measurable churn on a long-lived mounted view.
- **Fix sketch**: Wrap the assembly in `useMemo(() => ({...}), [raw])`. Better: finish the shim's own stated plan — have the two real consumers (`HomeReleases`, `LiveRoadmapStatusPill`) read `useTranslation().releases.whats_new` directly (the main i18n `t` is already stable) and delete the shim.

## 3. `HomeReleases` recomputes `buildDisplayItems` (dedupe + sort + Sentry breadcrumbs) on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/home/sub_releases/HomeReleases.tsx:139
- **Scenario**: `getNavReleases()`, the roadmap find/filter, and `buildDisplayItems(...)` run in the render body with no `useMemo`. `buildDisplayItems` is not pure-cheap: it maps, dedupes via Set, sorts, and emits `Sentry.addBreadcrumb` for every unknown status/priority and duplicate id. With a drifted live payload, those breadcrumbs re-fire on *every* render of a keep-alive-mounted component, flooding the Sentry breadcrumb ring buffer and pushing out useful trail context before any real error is captured.
- **Root cause**: Render-body computation of derived data whose inputs (`live.roadmap`, `language`, i18n slice) change rarely, while the component re-renders for unrelated reasons (refresh spinner, store selectors).
- **Impact**: Repeated O(n log n) work is bounded (dozens of items), but the per-render breadcrumb re-emission degrades observability signal-to-noise — the breadcrumbs exist precisely to make schema drift diagnosable.
- **Fix sketch**: `const roadmapItems = useMemo(() => roadmap ? buildDisplayItems(roadmap, live.roadmap, language, ...) : [], [roadmap, live.roadmap, language, t.releases])` (works once finding #2 stabilizes `t`), and hoist `getNavReleases()` similarly. That also makes each drift breadcrumb fire once per payload instead of once per render.

## 4. Self-declared temporary shim + `t` prop-drilling can now be retired
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/home/sub_releases/i18n/useReleasesTranslation.ts:9
- **Scenario**: The shim's doc comment says it is "kept for one cycle to avoid touching every consuming component". That cycle has passed and consumers collapsed to two files: `HomeReleases.tsx` and `LiveRoadmapStatusPill.tsx` (plus doc-comment mentions in `src/data/releases.ts`). `LiveRoadmapStatusPill` already imports `useTranslation` directly for `common.refresh` while also receiving the shim `t` and `language` as props.
- **Root cause**: Planned two-step migration whose second step (inline the main i18n accessor, drop the nested-shape re-assembly) was never executed.
- **Impact**: 144 lines of adapter code, a duplicate translation type, and unnecessary `t`/`language` prop-drilling into the pill — pure maintenance weight; also the root cause of finding #2.
- **Fix sketch**: Replace `t.foo.bar` reads in the two components with direct `raw.releases.whats_new.*` accesses (flat keys, e.g. `r.item_status_in_progress`), drop the `t`/`language` props from `LiveRoadmapStatusPill` (it can call `useTranslation()` itself), delete `i18n/useReleasesTranslation.ts`, and update the two doc comments in `src/data/releases.ts`.
