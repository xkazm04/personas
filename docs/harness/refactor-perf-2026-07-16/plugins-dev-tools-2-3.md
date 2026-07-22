# plugins/dev-tools [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 2 medium / 2 low)
> Context group: Plugins & Companion | Files read: 33 | Missing: 1 (sub_context/ContextCard.tsx)

## 1. RacingProgress builds Tailwind classes from template strings — milestone colors silently render unstyled
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dynamic-tailwind-class
- **File**: src/features/plugins/dev-tools/sub_lifecycle/competitions/RacingProgress.tsx:71
- **Scenario**: Any competition run: the milestone legend dots (`bg-${m.color}-400`, line 71), the running progress-bar gradient (`from-${currentMilestone.color}-500 to-${currentMilestone.color}-400`, line 100), and the milestone label (`text-${currentMilestone.color}-400`, line 118) are interpolated at runtime, so Tailwind's JIT never emits those classes unless another file happens to use the identical literal.
- **Root cause**: Runtime template-string class construction — the exact anti-pattern that FlowSteps.tsx in this same context already fixed and documents in its comment ("`bg-${color}-500/15` style template strings are invisible to the JIT and silently produce no styles").
- **Impact**: Legend dots are invisible and the racing bars lose their per-milestone color coding — the feature's core visual signal degrades to unstyled elements, and only for whichever color literals aren't coincidentally emitted elsewhere, making it look like a flaky theming bug.
- **Fix sketch**: Mirror the FlowSteps solution: add a static `MILESTONE_COLOR_CLASSES: Record<color, { dot: string; gradient: string; text: string }>` map with full literal class strings (or move it next to `MILESTONES` in strategyPresets so color and classes stay adjacent), and index into it instead of interpolating.

## 2. Dead goal view-model layer in projectManagerTypes.tsx (toGoal, Goal, GoalSignal, GOAL_ICONS, STATUS_STYLES)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/dev-tools/sub_projects/projectManagerTypes.tsx:65
- **Scenario**: Only three files import from this module (ProjectManagerPage, ProjectModal, ProjectStep), and they pull only `Project`, `toProject`, `PROJECT_TYPES`, `ProjectType`, `EditProjectData`, and the local `StatusBadge`. A repo-wide grep finds zero consumers of `toGoal` (line 65), `Goal`/`GoalSignal` (lines 26–40), `GOAL_ICONS` (line 113), or `STATUS_STYLES` (line 103).
- **Root cause**: Leftovers from the removed GoalBoard — ProjectManagerParts.tsx's header even states "the old GoalBoard was removed from the project manager", but its mapping/styling support code was never deleted. `STATUS_STYLES` also duplicates what the shared `StatusBadge` variant map (line 120) now handles.
- **Impact**: ~60 lines of unmaintained goal-mapping logic (including a status-normalization rule) that reads as live API; future goal work risks resurrecting a stale contract instead of the sub_goals module.
- **Fix sketch**: Delete `Goal`, `GoalSignal`, `toGoal`, `GOAL_ICONS`, and `STATUS_STYLES` plus the now-unused `Circle/Clock/CheckCircle2/AlertCircle` imports. Verified no cross-context importers via grep; a `tsc` run confirms in seconds.

## 3. Hardcoded English strings in otherwise fully i18n'd competition/triage UI
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: i18n-consistency
- **File**: src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionList.tsx:65
- **Scenario**: A non-English locale user opens the Competitions tab: heading "Competitions", the "Refresh" button, "Active"/"Past" section labels stay English (CompetitionList.tsx:65,74,105,114). Same in EffortRiskFilter ("Effort"/"Risk"/"Clear" and preset labels), ProjectManagerParts ("Delete Project" / `Delete "…"?`, lines 78), StrategyLeaderboard (title="Refresh", line 41), and LifecycleProjectPicker ('GitHub connected' / 'No GitHub repo —…' titles, line 85).
- **Root cause**: These strings were never routed through `t.plugins.*` even though every sibling string in the same files already is.
- **Impact**: Visible copy drift in localized builds; also blocks the translation-polish workflow from seeing these strings at all.
- **Fix sketch**: Add keys under `plugins.dev_tools` / `dev_lifecycle` / `dev_triage` and replace the literals. Mechanical, ~6 files.

## 4. MonitoringSection mounts useMonitoringPinpoints twice — duplicate credential fetch and a wasted full Sentry stats chain
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: duplicate-fetch
- **File**: src/features/plugins/dev-tools/sub_llm_overview/MonitoringSection.tsx:29
- **Scenario**: Opening the Monitoring tab renders `MonMatrix` (hook call at line 29) and the parent `MonitoringSection` (line 84), each with its own `useMonitoringPinpoints()` instance. Both fire `listCredentials()`, and both run the full `load()` chain — so `fetchSentryOrgs` + `fetchSentryStats` execute twice per mount, even though MonMatrix only ever uses `monCreds` and throws the stats away.
- **Root cause**: The hook bundles credential listing and stats fetching, and MonMatrix reuses it just to get the filtered credential list; state is per-instance, not shared.
- **Impact**: 2× network round-trips to the vault and to Sentry's API on every tab open (Sentry stats = multiple upstream HTTP calls), plus a correctness wrinkle: the header's `reload` button only refreshes the parent instance, so the two copies can disagree after an assignment change until `fetchProjects` happens to re-render both.
- **Fix sketch**: Hoist the single `useMonitoringPinpoints()` call into `MonitoringSection` and pass `monCreds` (and `reload`) into `MonMatrix` as props — the same "one hook per mount, so the table + header share state" contract useLlmPinpoints documents. Alternatively split a cheap `useMonitoringCreds()` (credentials only) out of the stats hook for MonMatrix.

## 5. ideaEvolution re-tokenizes every idea O(n²) times across three similarity passes
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-recompute
- **File**: src/features/plugins/dev-tools/sub_scanner/ideaEvolution.ts:40
- **Scenario**: IdeaEvolutionPanel runs `computeIdeaFitness(ideas)`, `generateSynthesisSuggestions(ideas)` (which calls `findSimilarPairs`) and `findSimilarPairs(ideas, 0.5)` on every ideas-array change. `findSimilarPairs` calls `jaccardSimilarity` per pair, and `jaccardSimilarity` re-runs `tokenize` (lowercase + regex replace + split over title+description) for both sides — so each idea's text is tokenized ~2n times per pass, ~3 passes, plus a second redundant tokenize pair for every above-threshold match (lines 52–53).
- **Root cause**: Tokenization lives inside the pairwise comparator instead of being precomputed per idea; the panel additionally triple-scans instead of sharing one pair computation.
- **Impact**: With scan batches in the hundreds of ideas (this app's scans routinely produce 100+ per project), that's on the order of 10⁵–10⁶ regex-tokenize calls on the main thread per triage-status change — visible jank on the Evolution panel; cost grows quadratically.
- **Fix sketch**: Precompute `Map<ideaId, Set<string>>` once per call (O(n)) and make `jaccardSimilarity` accept token sets; reuse the sets for `sharedTokens` instead of re-tokenizing matches. Optionally have the panel compute `findSimilarPairs` once and derive both the pairs list and syntheses from it.

## 6. WinningGeneProfile fetches competition details serially in a loop (sequential N+1)
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/plugins/dev-tools/sub_lifecycle/competitions/WinningGeneProfile.tsx:28
- **Scenario**: Clicking "Analyze" lists resolved competitions and then `await getCompetition(c.id)` one at a time inside a `for` loop — with 20 resolved competitions at ~50ms per IPC/DB round-trip, the spinner runs a full second when the calls are independent.
- **Root cause**: Sequential `await` in a loop over independent detail fetches (the comment already acknowledges the N+1; it just leaves it serial).
- **Impact**: Analysis latency scales linearly with competition history; bounded because it's button-triggered, but it is pure dead wait time.
- **Fix sketch**: `const details = await Promise.all(comps.map((c) => getCompetition(c.id)))` then fold winners' genes; or better, extend `listCompetitions`/the Rust side to return `winner_task_id` + winning slot's `strategy_prompt` in the list payload and drop the detail fetches entirely.
