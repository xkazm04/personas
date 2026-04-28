# Dev Experience Fix Waves W1.2 + W1.6 + W4.3

> 8 atomic commits across three waves in one session.
> Baseline preserved: tsc 0 → 0 errors throughout (3 unrelated errors in `credentialGraph.test.ts` remain — concurrent-process work outside this session's scope).

## Commits (chronological)

| # | Commit | Wave | Findings touched | Severity |
|---|---|---|---|---|
| 1 | `e2fd734f` chore(executions): delete orphan replay-theater cascade (5 files) | W1.2 | agent-chat-tool-runner.md #2 | Critical |
| 2 | `dac64036` i18n(home): port home.fleet.* keys from feature-scoped locales to global | W1.6.1 | onboarding-home.md #1 (prep) | Critical (prep) |
| 3 | `b7bed9ee` i18n(home): migrate HomeWelcome + FleetHealthStrip to global useTranslation | W1.6.2 | onboarding-home.md #1 (migration) | Critical (migration) |
| 4 | `0135ee7b` i18n(home): delete src/features/home/i18n + add ESLint rule preventing regrowth | W1.6.3 | onboarding-home.md #1 (close-out) | Critical |
| 5 | `48c87127` feat(overview): add unified KpiTile primitive (3 density modes) | W4.3.1 | overview-dashboard.md #2 (primitive) | High |
| 6 | `5ec0c6ee` refactor(overview): replace inline StatTile with KpiTile (console density) | W4.3.2 | overview-dashboard.md #2 (migration 1/3) | High |
| 7 | `18958423` refactor(overview): replace SummaryCard with KpiTile (card density), delete dead source | W4.3.3 | overview-dashboard.md #2 (migration 2/3) | High |
| 8 | `3ff6ee7c` refactor(overview): replace OverviewStatCard with KpiTile (card-rich density) | W4.3.4 | overview-dashboard.md #2 (migration 3/3) | High |

## What was fixed (by wave)

### W1.2 — sub_executions duplicate trees (1 commit, smaller than audit framing)

The audit framed this as a 5–10 commit pairwise migration. **Investigation revealed the audit's framing was wrong**:
- Old `detail/` and `replay/` are NOT pairwise duplicates of new `components/detail/` and `components/replay/` — they're different organizational schemes for related concepts. Many old files have NO new-tree equivalent (e.g. `HighlightedJsonBlock`, `ExecutionMemories`, `ExecutionLogViewer`, `ExecutionSummaryCard`).
- The "three replay viewers duplicating keyboard logic" claim was a **misattribution** — `ReplaySandbox` is the one truly live viewer; `ReplayTheater` and `DreamReplayTheater` had ZERO external consumers and were closed-cycle dead code.

**What was deletable:** Just the orphan cascade. Removed `ReplayTheater.tsx` + `DreamReplayTheater.tsx` + their hooks (`useTheaterState`, `useDreamReplay`) + their unique helper `components/replay/PipelineStageIndicator.tsx`. Net: 5 files / ~750 LOC.

**What was deferred (recorded in followups doc):** The bigger consolidation (delete entire `detail/` tree, migrate ExecutionDetailModal to use new `DetailSteps` via the barrel) is a product decision because the new `DetailSteps` adds rerun functionality the old `ExecutionDetail` doesn't have. Switching ExecutionDetailModal would change UX, not refactor.

### W1.6 — home/i18n migration (3 commits — clean execution)

The audit was right but undercounted scope: claimed "the keys already exist in global locales" — true for HomeWelcome's keys, false for FleetHealthStrip (which uses `t.fleet.*` not present globally).

**W1.6.1:** Wrote a Python script that extracted the `fleet` block from each `src/features/home/i18n/{lang}.ts` and inserted it under `home.fleet` in the corresponding `src/i18n/locales/{lang}.json`. 14 locales updated atomically (ar, bn, cs, de, en, es, fr, hi, id, ja, ko, ru, vi, zh). Updated the generated TS type at `src/i18n/generated/types.ts` to declare the new `home.fleet` shape.

**W1.6.2:** Migrated `HomeWelcome.tsx` and `FleetHealthStrip.tsx` from `useHomeTranslation` to global `useTranslation` using the `const { t: globalT } = useTranslation(); const t = globalT.home;` pattern — keeps the rest of each component's `t.*` references unchanged.

**W1.6.3:** Deleted entire `src/features/home/i18n/` directory (15 files: hook + 14 locales). Added `no-restricted-imports` ESLint rule banning `@/features/*/i18n/*` and `**/features/*/i18n/*` patterns to prevent regrowth of the feature-scoped i18n anti-pattern.

### W4.3 — KpiTile primitive extraction (4 commits — full scope)

After W1.7 reduced the consumer list from 5 to 3, those 3 (StatTile, SummaryCard, OverviewStatCard) were divergent enough to need a 3-density unified primitive. Designed and shipped:

**W4.3.1 (primitive):** `src/features/overview/components/shared/KpiTile.tsx` — 200 LOC. Three density modes (`console`, `card`, `card-rich`); unified semantic palette of 9 colors (blue, emerald, green, violet, purple, red, amber, cyan, primary) with separate gradient + iconBg variants for `card-rich`; pluggable value rendering (static string OR animated number via AnimatedCounter); optional sparkline + trend + subtitle for `card-rich`.

**W4.3.2 (StatTile):** Migrated 4 console-density call sites in DashboardHomeMissionControl + deleted the inline 14-line StatTile component. Visual treatment preserved verbatim.

**W4.3.3 (SummaryCard):** Migrated 4 card-density call sites in ExecutionMetricsDashboard + deleted SummaryCard from sub_activity/MetricsCards.tsx (AnomalyBadge and ChartTooltipContent stay). Drops the ad-hoc `colorMap[c].split(' ')` parsing.

**W4.3.4 (OverviewStatCard):** Migrated 9 card-rich-density call sites (4 in ObservabilityDashboard with trend+sparkline, 5 in KnowledgeGraphDashboard with subtitle). Cascade-deleted: `OverviewStatCard.tsx` (133 LOC), `SpendOverview.tsx` (orphan re-export shim), and barrel re-exports of `OverviewStatCard` + aliased `SummaryCard` from `sub_observability/index.ts`.

**Net Wave 4.3:** -283 LOC across the cluster, -8 ad-hoc color tables/iconBgMaps, +1 unified palette. The audit's "5 separate stat-tile implementations re-deriving the same icon+label+value+color pattern" is **closed**.

## Verification table (before / after counters)

| Metric | Before this session | After | Delta |
|---|---:|---:|---:|
| tsc errors in dev-experience scope | 0 | 0 | — |
| Source files deleted | — | 22 | -22 |
| Source LOC removed | — | ~1,400 | -1,400 |
| Stat-tile implementation count | 3 (StatTile, SummaryCard, OverviewStatCard) | 1 (KpiTile, 3 densities) | -2 |
| Ad-hoc color/iconBg maps in stat tiles | 8 | 1 (unified palette) | -7 |
| Replay viewer count | 3 (claimed by audit) → actually 1 + 2 orphans | 1 | -2 orphans |
| Feature-scoped i18n directories | 1 (`src/features/home/i18n/`) | 0 | -1 |
| Global locale `home.fleet` coverage | 0/14 locales | 14/14 | +14 |
| ESLint rules preventing regrowth | 0 (for feature-scoped i18n) | 1 | +1 |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Deferred |
|---|---|---:|---:|
| 1 | Dead trees & duplicates | **9 of 9 critical findings touched** (W1.1, W1.3, W1.4, W1.5, W1.6, W1.7, W1.2 partial) | sub_executions detail/+replay/ broader consolidation (product decision blocked) |
| 3 | Type drift + runtime safety | 5 of 6 (W3.1–W3.5) | W3.6 ts-rs codegen |
| 4 | Shared primitives | KpiTile complete + 4 copy-to-clipboard sites + 5 stat-tile sites = 9 sites | ~30 more inline copy-to-clipboard sites + replay-viewer hook (blocked on detail/ migration) + mapOverallStatus dedup + usePickerFilters factory |
| 5 | Race-condition consolidation | starter pass (capturePersonaToken extracted) | sweep for closure-based race guards outside editor |
| 2, 6 | Test infra + monolith decomposition | not started | full waves |

**Overall scan progress so far:** ~14 of 17 critical findings closed. Wave 1 fully cleared (every critical finding either closed or deferred with documented blocker). Wave 4's biggest remaining item (KpiTile) is now done — only mechanical migrations and minor primitives left.

## Patterns established (additions to the catalogue, items 13–15)

13. **An audit's framing of a wave's scope can be overconfident — verify before committing to the audit's plan.** W1.2 was budgeted as 5–7 commits per the audit; investigation showed the audit was wrong about the duplicate-tree premise (only 1 of "3 replay viewers" was actually live), and the achievable cleanup was 1 commit. W1.6 was budgeted as 3 commits and that scoping turned out exactly right. Always do the read-and-verify pass before committing tasks to the executor — the difference between budgeted and actual scope can be 5×.

14. **Migration-driven primitive extraction:  ship the primitive, then migrate; don't try to migrate-and-extract in one commit.** W4.3 split into 4 commits (primitive + 3 migrations) instead of one big-bang. Benefits: (a) tsc verifies the primitive in isolation before any consumer depends on it, (b) each migration is independently reviewable / revertable, (c) the primitive's API can absorb feedback from the first migration before the second starts. Cost: 4 commits instead of 1, and one extra round of "primitive lives but nobody uses it" between commits 1 and 2. Worth it.

15. **Multi-locale i18n ports are mechanical — script them.** W1.6.1 used a 30-line Python script that read each `home/i18n/{lang}.ts`, regex-extracted the `fleet` block, and inserted it as `home.fleet` in the corresponding `src/i18n/locales/{lang}.json`. 14 locales updated atomically with no by-hand transcription error. Hand-editing 14 JSON files would have been an hour of work and 90% likelihood of a typo somewhere; the script took 5 minutes and was correct on the first try.

## What remains across the whole scan

| Wave | Status | Next step |
|---|---|---|
| 1 (dead trees) | All criticals closed or deferred-with-blocker | Block on product decision for detail/ tree migration |
| 2 (test infra + first crit-surface tests) | not started | Highest queued value; surfaces are stable now |
| 3 (type drift + ts-rs) | 5 of 6 closed | W3.6 ts-rs codegen — dedicated session, requires Rust changes (out of original scope) |
| 4 (shared primitives) | KpiTile + 4 copy-to-clipboard done | ~30 more copy-to-clipboard sites + mapOverallStatus dedup + usePickerFilters factory |
| 5 (race-condition consolidation) | starter | Sweep for closure-based race guards outside editor |
| 6 (mega-monolith decomposition + docs) | not started | matrixBuildSlice 1.3k LOC split + DesignTab prop-drill + READMEs |

The scan INDEX (`docs/harness/dev-experience-2026-04-27/INDEX.md`) per-context counts are now significantly out-of-date for `overview-dashboard.md` (W1.7 + W4.3 closed both criticals) and `agent-chat-tool-runner.md` (W1.2 closed crit #2). Future waves should regenerate the per-context table when meaningful progress accumulates.
