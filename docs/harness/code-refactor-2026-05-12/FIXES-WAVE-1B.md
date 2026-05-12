# Code-Refactor Fix Wave 1B — Remaining Orphan Module Deletion

> 6 atomic commits, 8 high-severity orphan findings closed (some bundled).
> Baseline preserved: tsc 0 → 0, cargo check 0 → 0, lint 0 → 0.
> Cumulative warnings since Phase B2 baseline: cargo 142 → **132**, lint 12,543 → **12,172**.
> Continues the "verify zero importers, then `git rm`" mental model from Wave 1A.

## Commits

| # | Commit       | Findings closed                                  | LOC removed | Files                                                                                                                |
|---|--------------|--------------------------------------------------|------------:|-----------------------------------------------------------------------------------------------------------------------|
| 1 | `f92b59d1c`  | i18n-shared #4 (A2)                              | ~1,178      | 13 files across `src/features/shared/components/{display,forms,feedback,layout,progress}/` + `src/hooks/navigation/useBreadcrumbTrail.ts`; doc-comment cleanup in `FormField.tsx` |
| 2 | `a8f558ce1`  | analytics-sla-usage-leaderboard #1, #2 (A9 + A14)| ~525        | `src/features/overview/sub_usage/charts/` (5 files), `sub_usage/DashboardFilters.tsx`; i18n keys harvested into `DayRangePicker.tsx`     |
| 3 | `f59d81de0`  | schedules-cron-agents #1 (A10)                   | 191         | `src/features/overview/sub_cron_agents/CronAgentsPage.tsx` (legacy top-level)                                          |
| 4 | `2d533a13c`  | activity-events-realtime-bus #3, #4 (A11 + A12)  | ~288        | `src/features/overview/sub_realtime/components/renderers/{VisualizationNodes,VisualizationParticles}.tsx`, `libs/parseEventQuery.ts`     |
| 5 | `d929f4328`  | onboarding-home-simple-mode #2 (A13)             | ~272        | `src/features/onboarding/components/OnboardingProgressBar.tsx`, `src/features/home/components/FleetHealthStrip.tsx`, `lib/fleetHealth.ts` + `.test.ts`        |
| 6 | `1a67c0435`  | agent-chat-sessions (ChatThread orphan, A15)     | 80          | `src/features/agents/components/ChatThread.tsx`; stale entry removed from `lib/harness/scenario-parser.ts` typography manifest             |

**Total removed: ~2,534 LOC** across 6 commits. **All eight high-severity Theme-A findings remaining after Wave 1A are now closed.**

## What was fixed (grouped by sub-pattern)

### Wholesale orphan deletion (4 of 6 commits)

1. **`shared/components/*` orphans (~1,178 LOC, 13 files).** Speculative design-system components built ahead of consumers that never arrived. No tree-shaking signal because they all export named symbols. Each file confirmed via `grep \b<ExportName>\b` returning only its own definition. Two transitively-orphan companions handled in the same commit: `useShakeError.ts` (referenced only in a doc-comment in `FormField.tsx`, also tidied) and `RecoverySpiral.tsx` (only imported by the now-deleted `InlineErrorRecovery.tsx`). The hooks/navigation/useBreadcrumbTrail.ts sibling went with `BreadcrumbTrail.tsx`.

2. **Legacy `CronAgentsPage.tsx` (191 LOC).** Top-level file shadowed by a newer 85-LOC version in `components/`. The directory's `index.ts` re-exports only the components/ variant.

3. **`sub_realtime` orphans (~288 LOC).** `VisualizationNodes.tsx` + `VisualizationParticles.tsx` (circle-based ring renderers, superseded by `EventBusNodeRenderers` / `EventBusParticleRenderers` polygon-based diamond geometry). `parseEventQuery.ts` (132 LOC structured-query DSL that the `EventLogSidebar` was supposed to consume but never did — sidebar ships with a 5-line `toLowerCase().includes()` filter).

4. **`onboarding`/`home` orphans (~272 LOC).** `OnboardingProgressBar.tsx` (sidebar widget never wired up), `FleetHealthStrip.tsx` + `fleetHealth.ts` (home dashboard tile never rendered by `WelcomeLayout`), plus the `fleetHealth.test.ts` whose only purpose was testing the orphan module's `hasFailureSpike` helper. **Skill rule deviation noted in the commit message**: the skill normally says do not delete tests, but this test was the *sole* consumer of the orphan module — keeping it would have broken `vitest` after the source removal.

5. **`ChatThread.tsx` (80 LOC).** The smallest orphan in the wave. The only non-self reference was a string literal in `lib/harness/scenario-parser.ts` — a typography-migration manifest, not a runtime import. Cleaned up that stale entry in the same commit.

### Decomposition cleanup with i18n harvest (1 of 6 commits)

6. **`sub_usage` decomposition residue (~525 LOC, A9+A14).** Two findings in one mental model: an in-progress split (`charts/` → `libs/`+`components/`, and `DashboardFilters.tsx` → 3 split component files) that left the originals behind. The interesting detail: the orphan `DashboardFilters.tsx` was **better localized** than the live `DayRangePicker.tsx` — it used `t.overview.filters.start_date`/`.end_date` while the live file had hardcoded "Start Date"/"End Date" labels. Harvested the i18n keys to the live file before deleting the orphan, closing a real drift bug visible in any non-English locale.

## Verification table (before / after)

| Metric                       | Phase B2 baseline | After Wave 1A | After Wave 1B   | Cumulative Δ        |
|------------------------------|------------------:|--------------:|----------------:|---------------------|
| `tsc --noEmit` errors        | 0                 | 0             | 0               | unchanged ✓         |
| `cargo check` errors         | 0                 | 0             | 0               | unchanged ✓         |
| `cargo check` warnings       | 142               | 132           | 132             | **–10** since baseline |
| `npm run lint` errors        | 0                 | 0             | 0               | unchanged ✓         |
| `npm run lint` warnings      | 12,543            | 12,224        | **12,172**      | **–371** since baseline |

Wave 1B touched only frontend code, so cargo warnings are unchanged. Lint warnings dropped a further 52 from the silent-catch family.

## Cumulative status (Waves 1A + 1B)

| Wave   | Theme                          | High closed | LOC removed | Commits |
|--------|--------------------------------|------------:|------------:|--------:|
| 1A     | Whole-module orphan deletion   | 7 of 15     | ~6,950      | 7 (+1 docs) |
| 1B     | Remaining Theme-A orphans      | 8 of 8      | ~2,534      | 6       |
| **Σ**  | **Theme A complete**           | **15 of 15**| **~9,484**  | **14**  |

**Theme A is now fully closed.** The next wave should be Theme D (repo/DB-layer CRUD drift — 9 high-severity findings, biggest correctness payoff) per the INDEX recommendation.

## Patterns established (catalogue items 5–7)

5. **i18n harvest before deletion.** When an orphan file does something *better* than its live replacement (translation keys, accessibility props, validation), harvest the improvement to the live file in the same commit. Wave 1B's `DayRangePicker.tsx` i18n fix is the canonical example — discovered while reading the orphan, applied to the live, then orphan deleted. This catches drift bugs that would otherwise survive the cleanup.
6. **Test files that test orphan modules should die with the source.** Skill rule "do not delete tests" still holds for tests that *might* cover something unrelated, but a test that imports ONLY from a deleted source file has no reason to stay (and will break `vitest`). The commit message must call out the rule deviation so future readers know it was intentional.
7. **Doc-only manifests with stale file references should be cleaned in the same commit.** Wave 1B found two: `scenario-parser.ts` (typography migration manifest mentioning `ChatThread.tsx`) and `FormField.tsx` (docstring mentioning `useShakeError`). Treat them like the dead-import equivalent of a normal source reference: the deletion isn't complete if the manifest still claims the file exists.

## What remains in the scan

- **Themes B, C, D, E, F, G, H, I, J, K** — fully untouched. See INDEX.md for the wave roadmap.
- The strongest recommendation is **Wave 2 = Theme D** (repo/DB-layer CRUD drift, 9 highs, ~1,500 LOC), per the INDEX. Some duplications are already actively drifting (`update_persona`/`update_persona_parameters` cloud auto-sync block — neither forwards `parameters` or `gateway_exposure`).
- **Theme G (correctness bug)** — `DriveStatus.storageUsedBytes: number` vs ts-rs `bigint` — is a one-line fix that could slot in as a hotfix between Wave 1 and Wave 2.
- The two follow-ups carried from Wave 1A (slice + bridge cleanup; doc references to deleted workflow_compiler) are unchanged.
