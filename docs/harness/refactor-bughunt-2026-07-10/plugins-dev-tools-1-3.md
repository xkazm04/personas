> Context: plugins/dev-tools [1/3]
> Total: 10
> Critical: 0  High: 0  Medium: 3  Low: 7

## 1. Sentry unresolved-issue count silently reports 0 when the X-Hits header is missing
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/plugins/dev-tools/sub_overview/adapters.ts:291-302
- **Scenario**: `fetchSentryStats` requests the issues endpoint with `limit=1` and derives the count *only* from `res.headers['x-hits'] ?? res.headers['X-Hits']`. If a Sentry deployment/proxy strips or renames that header (self-hosted, some SaaS tiers, or a proxy that lowercases differently), `totalHeader` is falsy and `unresolvedIssues` becomes `0`. The code comment says "or we count items" but no item-count fallback exists — and it can't work anyway because `limit=1` only ever returns one item.
- **Root cause**: single-source-of-truth on an optional response header, with `limit=1` deliberately preventing any count-by-items fallback.
- **Impact**: UX / success theater — ProjectOverviewPage renders `unresolvedTone = 'success'` (green PulseDot, "healthy") for a project that actually has unresolved production errors. The developer trusts a dashboard that is silently under-reporting.
- **Fix sketch**: When the header is absent, re-request with a larger `limit` (e.g. 100) and count the returned array, or surface an "unknown" state (`null`) that the tile renders as `—` rather than `0`.

## 2. Idea-lifecycle "most recent first" sort orders by random UUID, not by time
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/plugins/dev-tools/sub_scanner/IdeaEvolutionPanel.tsx:48-50
- **Scenario**: The lifecycle strip sorts accepted ideas with `.sort((a, b) => b.idea.id.localeCompare(a.idea.id))` and the comment claims "Most recent accepted ideas first; cap to 6". `DevIdea.id` is `uuid::Uuid::new_v4()` (verified in src-tauri/src/db/repos/dev_tools.rs — v4, fully random), so lexicographic id order is effectively arbitrary. `DevIdea` carries a real `created_at` field that is ignored here.
- **Root cause**: assumption that the id is time-sortable (would only hold for ULID/UUIDv7); the schema uses v4.
- **Impact**: UX / correctness — the "6 most recent" panel shows a random 6 accepted ideas and hides others; the freshest work is not guaranteed to appear.
- **Fix sketch**: Sort by `created_at` descending (`b.idea.created_at.localeCompare(a.idea.created_at)`), matching the stated intent.

## 3. CrossProjectMetadataModal StatCard builds Tailwind classes from a runtime `color` string — no styles are ever emitted
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:469-484 (used at 360-364)
- **Scenario**: The local `StatCard` composes `border-${color}-500/20 bg-${color}-500/5 text-${color}-400` from the `color` prop (`amber|emerald|blue|violet|pink`). Tailwind's JIT scans source for *literal* class strings and never sees these interpolated names, so it generates none of them — the five summary stat cards render with no border tint, no background, and default text color. This is the exact JIT foot-gun the codebase elsewhere documents and guards against with static maps (see TaskRunnerPage `DEPTH_COLOR_CLASSES` and SelfHealingPanel `PATTERN_ICON_CLASSES`). `color="pink"` (line 364) also isn't a status color used elsewhere, so even a safelist wouldn't cover it.
- **Root cause**: dynamic class-name template strings invisible to the Tailwind JIT; a second `StatCard` reinvented instead of reusing the static-class `StatCard` in OverviewParts.tsx.
- **Impact**: UX — the cross-project map's headline stat row is unstyled/monochrome, silently degrading a feature that looks fine in code review.
- **Fix sketch**: Replace with a static `Record<color, {bg,border,icon}>` lookup (mirror `STAT_COLORS` in OverviewParts.tsx) or reuse the exported `StatCard`; add a `pink` entry to the map.

## 4. GitHub/GitLab repo stats silently undercount past 100 items (per_page cap)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/plugins/dev-tools/sub_overview/adapters.ts:85-114, 192-210
- **Scenario**: Open-PR count is `Array.isArray(prData) ? prData.length : 0` from a single `?per_page=100` page (same for commits-last-week and GitLab MRs). A repo with >100 open PRs reports exactly 100, and since `openIssues = Math.max(0, open_issues_count - openPrs)` uses the true `open_issues_count` but the capped PR number, the derived issue count is also wrong. `commitsLastWeek` likewise saturates at 100 on busy repos.
- **Root cause**: treating a single paginated page length as a total; no `Link`-header pagination or count endpoint.
- **Impact**: UX — inaccurate vital tiles for high-volume repos; the numbers look precise but plateau.
- **Fix sketch**: Read the `Link` rel="last" header for a page-count estimate, or render "100+" when a full page is returned, rather than an exact-but-wrong integer.

## 5. Retrying a failed task drops its source-idea linkage
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/plugins/dev-tools/sub_runner/TaskRunnerPage.tsx:615-619, 778-786
- **Scenario**: `handleRetryAllFailed` and the SelfHealingPanel retry both call `createTask({ title: '[Retry] …', description, goalId })` but omit `sourceIdeaId`. The original failed `DevTask` carried `source_idea_id`; the retry copy does not. `computeAgentStats` (AgentScoreboard.tsx) links tasks→agents *only* via `source_idea_id`, so every retried task falls out of the per-agent implementation-rate aggregation, and IdeaEvolutionPanel's idea→task lifecycle loses the retry.
- **Root cause**: retry re-creates a bare task from the view-model, which never surfaced `source_idea_id`.
- **Impact**: correctness — agent impl-rate and idea-lifecycle metrics under-count retried work.
- **Fix sketch**: Thread `source_idea_id` through `RunnerTask`/the retry path so `createTask({ …, sourceIdeaId: task.source })` preserves attribution.

## 6. Dead export: `mutateTowardWinner` in strategyPresets.ts
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/plugins/dev-tools/sub_lifecycle/competitions/strategyPresets.ts:228-239
- **Scenario**: Grepped the whole `src/` tree for `mutateTowardWinner` — the only hit is its own definition. The gene-evolution flow that ships (NewCompetitionModal) uses `generateStrategies` + `parseGenesFromPrompt`; the per-loser mutation function is never wired in.
- **Root cause**: leftover from an earlier evolution design that was superseded by winner-biased `generateStrategies`.
- **Impact**: maintainability — dead surface implies a live evolution feature that doesn't exist.
- **Fix sketch**: Delete `mutateTowardWinner` (and, if desired, keep only the used exports).

## 7. Dead export: `fetchGitHubIssues` + `GitHubIssueSummary` in adapters.ts
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/plugins/dev-tools/sub_overview/adapters.ts:121-166
- **Scenario**: Grepped `src/` for `fetchGitHubIssues` — only the definition matches; no importer. The exported `GitHubIssueSummary` interface exists solely to type this function's return. (Contrast `fetchSentryProjects`, which IS used by OverviewParts.tsx — so this isn't a blanket "adapters are unused" claim.)
- **Root cause**: an issue-import flow that was scaffolded (the doc comment references "the import flow") but never connected to any caller.
- **Impact**: maintainability — ~45 lines of unreachable adapter code.
- **Fix sketch**: Remove `fetchGitHubIssues` and `GitHubIssueSummary`, or wire the intended issue-import UI if it's still planned.

## 8. Duplicated StatCard component (fold into the shared one)
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:469-484 vs src/features/plugins/dev-tools/sub_overview/OverviewParts.tsx:38-61
- **Scenario**: Two `StatCard` implementations in the same dev-tools feature render the same "icon + value + label in a tinted card" shape. OverviewParts' version already solves the color problem with a static `STAT_COLORS` map; the CrossProjectMetadataModal copy re-implements it with the broken dynamic classes flagged in finding #3.
- **Root cause**: a local re-implementation instead of importing the existing component.
- **Impact**: maintainability + it re-introduced the JIT color bug.
- **Fix sketch**: Import `StatCard` from OverviewParts (extending its `StatColor` map with `pink`) and delete the local copy.

## 9. Misplaced import statements interleaved with function definitions in PrBridge.tsx
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/plugins/dev-tools/sub_runner/PrBridge.tsx:1-51
- **Scenario**: `readDoneSteps`/`writeDoneSteps` (lines 20-39) are defined *before* a second block of `import` statements (lines 40-50), and `writeDoneSteps` references `silentCatch`, which is imported at line 50 — after its use site. It works only because ES module imports are hoisted, but the file reads as if a helper uses an undeclared symbol, and the import block is split in two.
- **Root cause**: helpers were pasted above the import list during an edit; imports never re-consolidated.
- **Impact**: maintainability / readability — invites confusion and accidental "fixes" that reorder things wrongly.
- **Fix sketch**: Move all `import` lines to the top of the file, above the helper definitions.

## 10. Third hand-rolled `relativeTime` in ProjectOverviewPage duplicates existing helpers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx:650-661
- **Scenario**: This module defines its own `relativeTime(iso)` (just-now/Nm/Nh/Nd/Nw) while it already imports `RelativeTime` (the component) at line 13, and `ideaScannerHelpers` exports a `relativeTime` used by IdeaScannerCards. Three parallel relative-time formatters drift independently (e.g. rounding vs flooring, week cutoffs).
- **Root cause**: local convenience copy instead of the shared formatter.
- **Impact**: maintainability — inconsistent relative-time strings across the same feature.
- **Fix sketch**: Use the `<RelativeTime>` component (already imported) or the shared `relativeTime` from ideaScannerHelpers; delete the local function.
