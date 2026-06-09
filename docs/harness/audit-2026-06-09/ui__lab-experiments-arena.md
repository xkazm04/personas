# UI Perfectionist — lab-experiments-arena
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

## 1. Scenario-breakdown matrix is blind to per-cell run status (running / partial / error)
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:306-339
- **Scenario**: While some variants are still executing (or a cell errored), the comparison grid shows either `--` (missing key) or a computed composite number identical in style to a fully-scored, successful cell. A user comparing models cannot tell "this model failed this scenario" from "this model scored low" from "this scenario is still running."
- **Root cause**: The cell renderer only branches on `if (!r)` → `--`, otherwise it always renders a score button. The `LabArenaResult.status` field is fetched (it is passed through to `ScenarioDetailPanel` at line 357) but never consulted in the matrix. There is no running/error/partial visual treatment, and `compositeScoreFromRow` returning a number for a half-scored running row is rendered as if final.
- **Impact**: error-blind — the most comparison-critical surface conflates fail, low-score, and in-progress into the same glyph.
- **Fix sketch**: In the cell body, branch on `r.status`: `running` → a small `Loader2 animate-spin` + "running" caption (color-neutral); `failed`/error → an `AlertTriangle` in `text-status-error` with the cell tinted `bg-red-500/5`; `completed` → the existing score button. Reuse a single `<MatrixCellState>` helper so A/B and Matrix grids share it.

## 2. Winner / loss / delta emphasis relies on color alone (no shape or text cue)
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:206-214, 294-296, 326
- **Scenario**: In the model-comparison cards the only differentiator between "ahead of leader" and "behind leader" deltas is a green vs red arrow + colored number; the winning column header in the scenario table is distinguished only by `text-primary/80`; composite scores in cells are colored green/amber/red via `scoreColor` with no secondary cue.
- **Root cause**: `scoreColor()` returns a text-color-only class (`text-status-success | warning | error`, confirmed in evalFramework.ts:168-173), and the win/loss deltas pair it with `TrendingUp`/`TrendingDown` icons that are themselves only differentiated by color (both are arrows tinted at `/60` opacity, easy to confuse for color-blind users). The winning table column has no non-color marker (e.g. a Trophy) like the winner card does.
- **Impact**: inaccessible — deuteranopia/protanopia users cannot read the win/loss verdict, which is the core output of an arena.
- **Fix sketch**: Add the explicit `+`/`-` sign (already present) plus distinct icon shapes are fine, but raise opacity to full and add `aria-label` ("12 points ahead/behind leader"). On the winning scenario-table `<th>`, render a small `Trophy` icon next to the model name (mirroring the card badge at line 191) so the winner is identifiable without relying on `text-primary`.

## 3. Score-block / score-bar / scoreLabel markup is duplicated across result views
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:29-61 (scoreLabel, scoreBg, ScoreBar) vs src/features/agents/sub_lab/components/shared/ScenarioDetailPanel.tsx:61-112 (scoreLabel, ScoreCard)
- **Scenario**: The "Excellent/Good/Fair/Weak/Poor" thresholds, the 0/50/80 bar-color ramp, the composite-score hero block, and the `Math.max(value, 2)` bar-floor are reimplemented in at least three places (ArenaResultsView, ScenarioDetailPanel, and hand-mirrored again in LabResultsSkeleton.tsx). The two `scoreLabel` copies even disagree — ArenaResultsView's takes `number`, ScenarioDetailPanel's takes `number | null` and adds an "Unscored" tier.
- **Root cause**: No shared `ScoreBar` / `scoreLabel` / composite-hero primitive in `shared/`; each view grew its own. `LabResultCard.tsx` exists as a shell but the score internals were never extracted.
- **Impact**: inconsistency — the bar color ramp (`>=80 / >=50`) differs from `scoreColor`'s (`>=80 / >=50` text but `>=60` Good label), so a 55-score shows an amber bar but "Fair" vs "Good" wording can drift between surfaces as one copy is edited.
- **Fix sketch**: Extract `scoreLabel`, `scoreBg`, and a `<ScoreBar>` / `<MetricBar>` into `shared/scorePrimitives.tsx` (single null-aware `scoreLabel`), and have ArenaResultsView, ScenarioDetailPanel, and the skeleton import them so the loading twin stays geometry-locked automatically.

## 4. Scenario-matrix table lacks header scope and per-cell accessible labels
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:290-339
- **Scenario**: A screen-reader user navigating the comparison grid hears a bare number ("72") with no association to its scenario row or model column, and the clickable score cell announces only its concatenated text ("72 TA 80 OQ 70 PC 60 $0.0012 1.2s") with no role hint that it opens a detail panel.
- **Root cause**: `<th>` elements (lines 292-297) omit `scope="col"` / the row header omits `scope="row"`; the cell `<button>` (line 318) has no `aria-label` summarizing "scenario X, model Y, composite 72, open details", and `aria-pressed` is not set for the selected toggle state (the visual ring at line 321 has no programmatic equivalent).
- **Impact**: inaccessible — the densest data view is unnavigable non-visually.
- **Fix sketch**: Add `scope="col"` to the model `<th>`s and `scope="row"` to the scenario `<td>` (promote it to `<th scope="row">`); give the cell button `aria-label={`${scenario}, ${model}: composite ${comp}`}` and `aria-pressed={isSelected}`.

## 5. No "results still arriving" affordance while a run is in flight inside the modal
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/agents/sub_lab/components/arena/ArenaHistory.tsx:138-147; src/features/agents/sub_lab/components/shared/LabResultModal.tsx:52-61
- **Scenario**: When a run's `status` is `running`, the modal shows the status badge but the body renders the full `ArenaResultsView` over whatever partial rows exist — model cards rank as if final and the executive summary declares a "winner" mid-run. `footerActions` (Export / Improve) are correctly gated on `completed`, but the results body itself is not.
- **Root cause**: `ArenaResultsView` only distinguishes `results.length === 0` (skeleton) vs non-empty (final layout). There is no `partial`/`running` mode that labels aggregates as provisional or shows a "N of M scenarios complete" banner.
- **Impact**: confusion — a transient leader is presented as the verdict; the summary text ("outperforming X by N points") may flip as later results land.
- **Fix sketch**: Pass `run.status` into `ArenaResultsView`; when `running`, render a sticky banner ("Provisional — {scored}/{expected} scenarios scored") above the cards, suffix card scores with a subtle "so far" caption, and suppress the buildSummary verdict sentence until complete.

## 6. Insights/suggestions text truncated with a raw `slice(0,200)+'...'` mid-word
- **Severity**: low
- **Category**: polish
- **File**: src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx:256, 272
- **Scenario**: Evaluation rationale and improvement suggestions are hard-cut at 200 characters with a manual `'...'`, frequently slicing mid-word ("the model fail..."), with no way to read the rest inside the card.
- **Root cause**: Character-count truncation instead of CSS line-clamp; no expand affordance. Elsewhere in this view full content lives behind a `<details>` (line 239), so the pattern for "show more" already exists.
- **Impact**: unpolished — truncated insight reads as broken, and the full rationale is only reachable by opening the per-cell detail panel.
- **Fix sketch**: Replace the JS slice with `line-clamp-3` (Tailwind) on the `<p>`, or wrap long entries in the existing `<details>` disclosure so the full rationale/suggestion is one click away in-card.
