# Follow-ups — 2026-04-28

## W4.3 deferred — KpiTile primitive extraction

**Why deferred:** Plan was "extract KpiTile + migrate 5 overview consumers". After W1.7 deleted DashboardHeaderBadges, AnalyticsSummaryCards, and RealtimeStatsBar, only 3 consumers remain — but they are visually divergent in ways that make a single primitive non-trivial:

| Component | Density | Colors | Trend | Sparkline | Animation | Special |
|---|---|---|---|---|---|---|
| `StatTile` (DashboardHomeMissionControl.tsx:435) | Console (font-mono dense) | tailwind class passed in directly | — | — | `AnimatedCounter` | — |
| `SummaryCard` (sub_activity/MetricsCards.tsx:20) | Card (3-line layout) | 4-key color map (blue/emerald/violet/amber) split via `colorMap[c].split(' ')` | — | — | `AnimatedCounter` (optional) | — |
| `OverviewStatCard` (sub_observability) | Card with gradient | 7-key color map + separate iconBgMap | TrendData with invertColor | `Sparkline` SVG, 7-key SPARKLINE_HEX | `useAnimatedNumber` | subtitle + subtitleColor |

A unified primitive needs to support `density: 'console' | 'card'`, both color-map shapes (3 vs 7 colors with merged-or-separate icon background), optional trend + sparkline + subtitle slots, and pluggable animation primitives. ~150–200 LOC with non-trivial visual-regression risk on each migration.

**Recommended for next session:** dedicated 4–5 commit wave:
1. Design `KpiTile` in `src/features/overview/components/shared/KpiTile.tsx` with discriminated `density` prop. Document the full color set (merge the 4-color and 7-color tables; pick canonical token values). Preserve `AnimatedCounter` and `useAnimatedNumber` consumer choice via prop.
2. Migrate `StatTile` (smallest delta).
3. Migrate `SummaryCard` (covers 4-color map case).
4. Migrate `OverviewStatCard` (full feature surface — trend, sparkline, subtitle).
5. (Optional) Add visual regression test for the 3 surfaces if Storybook/Chromatic is wired up.



## W1.2 deferred — sub_executions duplicate trees migration

**Why deferred from Wave 1:** The audit finding (`agent-chat-tool-runner.md` #1) framed this as a cleanup-by-deletion. Investigation showed it's actually a multi-step migration: the old `sub_executions/detail/` tree has live external consumers in three different feature trees:

- `features/execution/components/ExecutionMiniPlayer.tsx:27` → `detail/views/ExecutionSummaryCard`
- `features/shared/components/modals/ExecutionDetailModal/ExecutionDetailModal.tsx:2` → `detail/ExecutionDetail`
- `features/shared/components/modals/ExecutionDetailModal/ExecutionDetailContent.tsx:9-12` → 4 deep paths in `detail/inspector/` and `detail/views/`

The new `components/list/ExecutionDetail.tsx` is itself a thin re-export of `../detail/DetailSteps` (`components/list/ExecutionDetail.tsx:2`), and the old `detail/ExecutionDetail.tsx` cross-references the old `replay/` tree (`detail/ExecutionDetail.tsx:5-6`).

**What this actually is:** a 5–10 commit pairwise migration that should be its own wave:
1. Identify which files in old vs new are diff'd; merge unique fixes into the canonical copy.
2. Migrate the 7+ external consumer imports to point at the new tree.
3. Delete the loser tree.
4. Add `no-restricted-imports` ESLint rule banning the dead paths.

**Recommended next session:** `gsd-plan` a dedicated "sub_executions tree consolidation" wave, with each pairwise migration as its own atomic commit.

## W1.6 partial — home/i18n migration deferred

**Why partial:** The audit (`onboarding-home.md` #1) recommended deleting both `src/features/onboarding/i18n/` and `src/features/home/i18n/` entirely, claiming "the keys already exist in `src/i18n/locales/en.json` under `home.*`".

That is true for `HomeWelcome.tsx` (uses `t.greeting_morning`, `t.operator`, `t.quick_navigation`, `t.nav` — all present in `home.*` globally), but **not** for `FleetHealthStrip.tsx`, which uses `t.fleet.executions_today`, `t.fleet.success_rate`, `t.fleet.active_agents`, `t.fleet.credentials`. `home.fleet` does **not** exist in the global locale.

**What was done in W1.6:** deleted `src/features/onboarding/i18n/` (zero consumers — `useOnboardingTranslation` was only referenced by itself).

**What's left for a follow-up wave:**
1. Port the `fleet.*` keys from `src/features/home/i18n/en.ts` (and the 13 other locale files) into `src/i18n/locales/{en,zh,ar,...}.json` under `home.fleet.*`.
2. Migrate `HomeWelcome.tsx` and `FleetHealthStrip.tsx` from `useHomeTranslation` to the global `useTranslation` (use `const { t: globalT } = useTranslation(); const t = globalT.home;`).
3. Delete `src/features/home/i18n/` entirely.
4. Add the ESLint `no-restricted-imports` rule banning `@/features/*/i18n/*` to prevent regrowth.

This is roughly a 3–5 commit migration that should be its own session — multi-locale port + 2 component migrations + lint rule.

## W1.7 deferred — Overview Dashboard dead trees consolidation

**Why deferred from Wave 1:** The audit finding (`overview-dashboard.md` #1) lists ~15 files / ~2k LOC across three "dead" trees, but the trees aren't truly orphaned — sub-folder index files still re-export them (e.g. `sub_analytics/index.ts` exports `AnalyticsDashboard`, `sub_executions/index.ts` exports the old list/dashboard). `bundle-baseline.json` even tracks `RealtimeVisualizerPage: 56.3`. Cross-references between the dead trees mean a single delete-pass risks breaking compile.

**Files implicated (per audit):**
- `src/features/overview/sub_executions/components/*` (5 files; near-duplicates of `sub_activity/components/GlobalExecutionList.tsx`)
- `src/features/overview/sub_timeline/components/UnifiedActivityTimeline.tsx`
- `src/features/overview/sub_analytics/components/AnalyticsDashboard.tsx`
- `src/features/overview/sub_realtime/RealtimeVisualizerPage.tsx` + 5 flat siblings (vs. `sub_realtime/components/views/RealtimeVisualizerPage.tsx`)
- `components/dashboard/widgets/RecentActivityList.tsx`, `widgets/DashboardHeaderBadges.tsx`, `cards/RemoteControlCard.tsx`

**What this actually is:** a knip/ts-prune-driven dead-code pass with each cluster as its own atomic commit:
1. Run `knip` or `ts-prune` scoped to `src/features/overview/**` to confirm orphan set.
2. Update `sub_*/index.ts` barrels to stop re-exporting dead components (1 commit per barrel).
3. Delete each orphan cluster (1 commit per logical group: sub_executions cluster, sub_timeline, sub_analytics, sub_realtime flats, three orphan widgets).
4. Update `bundle-baseline.json` to drop the deleted entries.
5. Add an ESLint rule (or extend the existing `eslint-rules/`) forbidding two files with same basename inside `features/overview` unless one is `.test.ts`.

**Recommended next session:** dedicated "Overview dead-tree consolidation" wave, ~5–7 commits.

## Open

(none other)
