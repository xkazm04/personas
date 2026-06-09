# UI Perfectionist — test-suites-assertions
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

> Surface note: This context is largely backend/store. The `testSlice` actions
> `activeTestResults`, `fetchTestResults`, `testRuns`, `fetchTestSuites`,
> `createTestSuite`, `deleteTestSuite` are defined but have **no UI consumer**
> anywhere in `src/features` (verified by repo-wide grep). The user-facing
> regression/test surface is the **Lab** editor tab (`src/features/agents/sub_lab`),
> which renders the consolidated `LabVersionsTable` (version × model regression
> matrix) plus the Arena measurement modal and the per-scenario detail panel.
> The use-case "Test" trigger (`sub_use_cases`) feeds the same lab pipeline.
> Findings below target the rendered test pass/fail surface, which is the
> highest-value place for a user to read regression results.

## 1. Regression table never shows a loading state — empty state masquerades as "no data" during fetch
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/agents/sub_lab/components/versions_table/LabVersionsTable.tsx:223
- **Scenario**: On opening the Lab tab (or switching personas), `fetchVersions` / `fetchVersionRatings` / `loadBaseline` fire in the effect (line 68). Until they resolve, `rows` is `[]`, so `UnifiedTable` renders its empty branch — `vr_empty_title` / `vr_empty_desc` ("no versions measured" type copy). The user briefly sees a definitive "nothing here" message that then flips to a populated table, implying their data was missing.
- **Root cause**: `UnifiedTable` accepts an `isLoading` prop that renders a proper loading row (UnifiedTable.tsx:381), but `LabVersionsTable` never passes it, and the component tracks no fetch-in-flight flag. Empty-because-loading and empty-because-no-data are conflated.
- **Impact**: confusion — a transient "no data" message reads as data loss / a broken persona.
- **Fix sketch**: Track a `loading` flag (set true before the three fetches, false in a `finally`/effect-settled) and pass `isLoading={loading && rows.length === 0}` to `UnifiedTable`. Better still, swap in the existing shape-matched `LabResultsSkeleton` so the table geometry lands before data and never jumps (it is the established loading twin for this surface).

## 2. Per-scenario pass/fail verdict is captured but never rendered
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/agents/sub_lab/components/shared/ScenarioDetailPanel.tsx:114
- **Scenario**: A user clicks a scenario cell to inspect a single test result. The panel shows composite/sub-scores, rationale, cost, duration, and (conditionally) an error block — but never a discrete PASS / FAIL / ERROR badge, even though `result.status` (line 17, populated from `selectedResult.status` in ArenaResultsView.tsx:357) carries exactly that verdict.
- **Root cause**: `status` is threaded through the props (`ScenarioResult.status`) but is dead on arrival — nothing in the JSX consumes it. Pass/fail is left to be inferred from a numeric score color, which is an analog signal, not a verdict.
- **Impact**: error-blind — a scenario that errored or hard-failed assertions looks like a merely low-scoring one; there is no at-a-glance test outcome.
- **Fix sketch**: Render a status badge in the panel header next to `scenarioName` (line 153), driven by `result.status`, reusing the shared `StatusBadge` (`variant="success"` for passed/completed, `"error"` for failed/error, `"warning"` for cancelled) with both an icon and the status word — so the verdict reads without relying on score color.

## 3. VersionStatusBadge hand-rolls badge markup instead of the shared StatusBadge primitive
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/agents/sub_lab/components/versions_table/VersionStatusBadge.tsx:29
- **Scenario**: The Status column pills (Active / Measured / Archived / Unmeasured) use bespoke classes (`bg-blue-500/10 text-blue-300`, `bg-primary/15 text-primary`, etc.) and a custom `px-2 py-0.5 rounded-full` shell. Sitting in the same app, `LabQualityBadge` (LabQualityBadge.tsx:39) and the rest of the codebase render status pills through the shared `StatusBadge` component, which has a defined `info`/`neutral`/`success` palette and consistent border + size tokens.
- **Root cause**: Local re-implementation of a solved primitive. The "Measured" pill even uses `text-blue-300` where the shared `info` variant standardizes on `text-blue-400` with a matching border — so the two diverge subtly on the same screen.
- **Impact**: inconsistency — two badge visual languages (border vs no-border, off-by-one blue) coexist in adjacent components.
- **Fix sketch**: Map the four states to `StatusBadge` variants (active → custom accent or `processing`, measured → `info`, archived → `neutral`, unmeasured → `neutral`/`slate`) and keep the active pulse dot via the `icon` slot. Removes ~15 lines of bespoke color logic and unifies with LabQualityBadge.

## 4. Regression delta relies on color + a threshold-gated icon — small regressions are color-only
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/agents/sub_lab/components/versions_table/LabVersionsTable.tsx:269
- **Scenario**: In the Delta column, a worse-than-baseline score renders red text; only a drop of ≥5 composite points (`REGRESSION_DROP`) adds an `AlertTriangle`. A drop of 1–4 points is a red number with no icon and no sign-word — distinguishable from an improvement (`+3`, green) only by hue. The leading `+` exists for gains but the minus is the only non-color cue for a loss.
- **Root cause**: Pass/fail (improved vs regressed) is encoded primarily in `text-emerald-400` vs `text-red-400`. The non-color affordance (icon) is gated behind a magnitude threshold, leaving sub-threshold regressions inaccessible to colorblind users.
- **Impact**: inaccessible — colorblind users cannot tell a small regression from a small gain.
- **Fix sketch**: Always pair direction with a non-color glyph — e.g. a `TrendingDown`/`TrendingUp` icon (already imported pattern in ArenaResultsView) for any non-zero delta, reserving `AlertTriangle` as the additional "crossed regression threshold" emphasis. Add an `aria-label` like "regression, -3 points" so the value is screen-reader-meaningful.

## 5. Score→label / score→color / score→bar logic is duplicated across result components
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/agents/sub_lab/components/shared/ScenarioDetailPanel.tsx:61
- **Scenario**: `scoreLabel()` (Excellent/Good/Fair/Weak/Poor) is defined identically in ScenarioDetailPanel.tsx:61 and ArenaResultsView.tsx:29. The metric score-bar color ternary (`>=80 emerald / >=50 amber / else red`) is copy-pasted between ScenarioDetailPanel.tsx:83 (`ScoreCard`) and ArenaResultsView.tsx:54 (`ScoreBar`), and a third score→bg map (`scoreBg`) lives only in ArenaResultsView. Meanwhile `scoreColor` is centralized in `evalFramework`, and `LabQualityBadge.scoreVariant` uses yet another set of thresholds (75/50). The thresholds silently disagree (80/60/40/20 for labels, 80/50 for bars, 75/50 for the quality badge).
- **Root cause**: No shared score-presentation module; each component re-derives its own thresholds, so the visual "pass/fail" boundary shifts depending on where you look.
- **Impact**: inconsistency — the same composite score can read "Good" green in one card and amber in an adjacent bar, eroding trust in the pass/fail signal.
- **Fix sketch**: Extract `scoreLabel`, `scoreBarClass`, and `scoreBg` into `evalFramework` (next to `scoreColor`) with one canonical threshold set, and have ScenarioDetailPanel, ArenaResultsView, and LabQualityBadge consume them. Reconcile the 75 vs 80 success cutoff to a single value.

## 6. LabVersionsTable empty state is a plain line while sibling history tables get an iconographic empty state with guidance
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/features/agents/sub_lab/components/versions_table/LabVersionsTable.tsx:229
- **Scenario**: With no measured versions, the regression table shows `UnifiedTable`'s minimal centered text (`emptyTitle` + `emptyDescription`, UnifiedTable.tsx:415). The adjacent Arena history surface uses `LabEmptyState` (LabHistoryTable.tsx:46) — a centered icon, title, subtitle, and optional action inside a bordered card. The two empty states on the same feature look unrelated, and the primary one offers no path to the obvious next step (run a measurement).
- **Root cause**: Two empty-state patterns coexist; the highest-traffic table uses the barer one and provides no CTA toward the "Measure" action that would populate it.
- **Impact**: unpolished — first-run users see a flat "no data" line with no guidance, inconsistent with the richer empty card elsewhere in Lab.
- **Fix sketch**: Render `LabEmptyState` (icon `GitBranch`/`FlaskConical`, `vr_empty_title`/`vr_empty_desc`) above/around the table when `rows.length === 0`, with an `action` button that opens the Measure (Arena) modal — matching the LabHistoryTable empty-state treatment and giving a clear first step.
