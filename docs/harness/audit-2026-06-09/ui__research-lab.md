# UI Perfectionist — research-lab
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Every pipeline stage is error-blind — a fetch failure looks identical to "empty"
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx:114; src/features/plugins/research-lab/sub_hypotheses/HypothesesPanel.tsx:101; src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:119; src/features/plugins/research-lab/sub_findings/FindingsPanel.tsx:58; src/features/plugins/research-lab/sub_reports/ReportsPanel.tsx:71; src/features/plugins/research-lab/sub_experiments/ExperimentRunsDrawer.tsx:64
- **Scenario**: When `fetchSources`/`fetchHypotheses`/`listExperimentRuns` etc. reject (DB/IPC error), every panel resolves `loading=false` with an empty list and renders the cheerful "No sources yet — search to begin" empty state. The user thinks their data vanished or never existed, and the inviting CTA implies the store is fine. Failure is completely invisible across the whole question→sources→hypothesis→experiment→report pipeline.
- **Root cause**: `researchLabSlice` tracks only `*Loading` booleans (no `*Error` field); each fetch's catch block (researchLabSlice.ts:105/141/167/193/219/245) just flips loading off and swallows the error. The panels' render trees only branch on `loading` then jump straight to the empty state — there is no third "error" branch. The drawer (ExperimentRunsDrawer) does the same: a failed `listExperimentRuns` shows "No runs yet."
- **Impact**: error-blind
- **Fix sketch**: Add `research*Error: string | null` to the slice, set it in each catch. In each panel render a distinct error block (alert icon, the message, a Retry button calling the fetch again) ahead of the empty-state check: `loading ? <Loading/> : error ? <ErrorState onRetry={...}/> : items.length === 0 ? <EmptyState/> : <list/>`. Extract a shared `ErrorState` next to `EmptyState.tsx` so all six stages stay consistent.

## 2. Status badges are untranslated and visually flat in 3 of 5 stages
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:177; src/features/plugins/research-lab/sub_findings/FindingsPanel.tsx:88; src/features/plugins/research-lab/sub_reports/ReportsPanel.tsx:106
- **Scenario**: Experiment, finding, and report status pills all render `status.replace(/_/g, ' ')` inside the same neutral `bg-primary/10 text-primary` chip — so "in progress", "draft", "published", "completed" all look identical in color and appear in raw lowercase English, even when the app is localized. Meanwhile Projects (ResearchProjectList.tsx:145) and Sources (LiteratureSearchPanel.tsx:151) use translated labels AND status-specific color tokens (`projectStatusColor`/`sourceStatusColor`). Status carries zero meaning at a glance in three pipeline stages.
- **Root cause**: There is a `PROJECT_STATUS_COLORS`/`SOURCE_STATUS_COLORS` token + label pattern in tokens.ts, but no equivalent `EXPERIMENT_/FINDING_/REPORT_STATUS_COLORS` map or label helper, so those panels fell back to inline `.replace()` and a single primary tint.
- **Impact**: inconsistency
- **Scenario impact**: a "failed" experiment and a "passed" one are indistinguishable until you read the tiny text.
- **Fix sketch**: In tokens.ts add `experimentStatusColor/Label`, `findingStatusColor/Label`, `reportStatusColor/Label` mirroring the existing project/source pattern (map known statuses to color tokens, fall back to `FALLBACK_BADGE` + `t`-translated label). Replace the three inline `.replace()` chips with these helpers so status color/semantics are consistent across all five stages.

## 3. The source card / finding row / hypothesis card markup is copy-pasted, not extracted
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/plugins/research-lab/sub_findings/FindingsPanel.tsx:72; src/features/plugins/research-lab/sub_hypotheses/HypothesesPanel.tsx:119; src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:139; src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx:133
- **Scenario**: Findings, hypotheses, experiments and sources each hand-roll the exact same card shell: `rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group` + `flex items-start gap-3` + accent icon + `min-w-0 flex-1` body + the identical reveal-on-hover delete button (`opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-red-500/10 text-red-400/60 ...`). Four near-identical copies that already drift (Reports uses a 2-col grid, others a stack; delete button paddings differ).
- **Root cause**: No shared `EntityCard` / `CardDeleteButton` primitive exists even though `EmptyState`, `SectionHeader`, `SignalMeter` were already extracted — the row chrome was simply never lifted, so each new stage cloned it and small inconsistencies accumulate.
- **Impact**: inconsistency
- **Fix sketch**: Extract `<ResearchCard icon accentClass onDelete title …>{children}</ResearchCard>` (or at minimum a `<CardDeleteButton>`) into `shared/`. Have all five list rows render through it so spacing, hover border, and the delete affordance are defined once and can't drift.

## 4. Pipeline progression is invisible inside a stage — no breadcrumb or next-step affordance
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/plugins/research-lab/ResearchLabPage.tsx:30; src/features/plugins/research-lab/sub_hypotheses/HypothesesPanel.tsx:78; src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:110
- **Scenario**: The Dashboard sells research as a left-to-right pipeline (scoping → … → complete, ResearchDashboard.tsx:35-45), but once a project is open the individual tabs (literature/hypotheses/experiments/findings/reports) give no sense of order or "you are here." A `SectionHeader` shows only the stage title + a count; there is no indication that hypotheses come from sources, or a "Next: design an experiment" hand-off. Selecting a project always force-jumps to `literature` (ResearchProjectList.tsx:72, ResearchDashboard.tsx:92) with no way to see overall progress without returning to the dashboard.
- **Root cause**: Stage ordering lives only in the sidebar tab list and the dashboard's `buildPhases`; the per-stage panels share `SectionHeader` which has no concept of stage index / total / neighbors, so the pipeline metaphor evaporates inside a project.
- **Impact**: confusion
- **Fix sketch**: Add a thin stage-stepper strip under `ContentHeader` (reuse the phase icons/labels from `buildPhases`) highlighting the active stage with prev/next chips, or extend `SectionHeader` with optional `stageIndex/stageTotal` + a "Next →" link that advances `setResearchLabTab`, so progression reads the same inside a project as on the dashboard.

## 5. Run-output and report `<details>`/preview lack keyboard and label affordances
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/plugins/research-lab/sub_experiments/ExperimentRunsDrawer.tsx:104; src/features/plugins/research-lab/sub_reports/ReportsPanel.tsx:86; src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx:156
- **Scenario**: (a) A report card is a clickable `<div onClick>` (ReportsPanel.tsx:86) — not focusable or Enter/Space-activatable, so keyboard users can only reach the small Eye button, not the card the cursor opens. (b) The run "Output" `<summary>` (ExperimentRunsDrawer.tsx:106) has no accessible label distinguishing one run's output from another, and the run cards carry pass/fail only as colored icon + text with no `role`/`aria` grouping. (c) Source citation links (LiteratureSearchPanel.tsx:156) expose only an `ExternalLink` icon with `aria-label={source.url}` — screen readers read the raw URL with no "opens in new tab" cue, and the DOI beside it is plain text, never a link.
- **Root cause**: Interactive affordances were built as bare `<div onClick>` / icon-only anchors rather than semantic `<button>`/labelled links; the citation row treats DOI as static text and the external link as decorative.
- **Impact**: inaccessible
- **Fix sketch**: Make the report card a `<button>`/add `role="button" tabIndex=0` + `onKeyDown` Enter/Space; give the citation link a descriptive `aria-label` ("Open source: {title} (new tab)") and render DOI as `https://doi.org/{doi}` link; label each `<summary>` with the run number.

## 6. Empty/loading/error states are visually inconsistent across the pipeline
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/plugins/research-lab/shared/EmptyState.tsx:12; src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx:114; src/features/plugins/research-lab/sub_dashboard/ResearchDashboard.tsx:354; src/features/plugins/research-lab/sub_literature/LiteratureSearchPanelWorkbench.tsx:440
- **Scenario**: There are at least three different "empty" treatments: the shared `EmptyState` (bare 12×12 icon, no enclosing circle), the dashboard's `BenchEmptyState` (icon inside a `rounded-full bg-primary/10 border` chip + arrow CTA, ResearchDashboard.tsx:354), and the Workbench's `WorkbenchEmpty` (its own circle + dual CTA, line 440). Loading is just centered "Loading…" text everywhere (no skeleton matching the card list it replaces), and the "no matching after filter" empty for sources (LiteratureSearchPanel.tsx:128) drops the hint/CTA entirely while the Workbench version offers a "Clear filters" button. Same pipeline, three personalities.
- **Root cause**: `EmptyState` was extracted but two surfaces re-implemented their own richer version (circle-framed icon) instead of extending the shared one; loading has no shared skeleton primitive; the filtered-empty case has no shared variant with a clear-filter action.
- **Impact**: inconsistency
- **Fix sketch**: Give `EmptyState` the circle-framed icon treatment (matching `BenchEmptyState`) and an optional secondary action + `variant="filtered"` with a Clear-filters callback; add a shared `<ListSkeleton>` (3 placeholder cards) used by every panel's loading branch so loading mirrors the eventual list. Retire `BenchEmptyState`/`WorkbenchEmpty`/the inline filtered-empty in favor of the unified primitive.
