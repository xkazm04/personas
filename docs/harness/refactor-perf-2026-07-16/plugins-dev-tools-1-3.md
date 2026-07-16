# plugins/dev-tools [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Plugins & Companion | Files read: 32 | Missing: 2

## 1. StatCard in CrossProjectMetadataModal builds Tailwind classes from template strings — all five stat tiles render unstyled
- **Severity**: High
- **Lens**: code-refactor
- **Category**: broken-dynamic-tailwind
- **File**: src/features/plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:476
- **Scenario**: Open Projects → Cross-Project Map after generating metadata. The stats row passes `color="amber"|"emerald"|"blue"|"violet"|"pink"` and StatCard interpolates `border-${color}-500/20`, `text-${color}-400`, `bg-${color}-500/5`. Tailwind's JIT can't see interpolated class names, so none of these classes exist in the built CSS — the tiles get no border tint, no icon color, no value color (`pink` isn't emitted anywhere else in the bundle, so that one can't even be rescued by coincidental usage elsewhere).
- **Root cause**: Dynamic class-name interpolation, the exact anti-pattern this codebase has already fixed twice with static lookup tables (see `DEPTH_COLOR_CLASSES` in TaskRunnerPage.tsx:121-128 and `PATTERN_ICON_CLASSES` in SelfHealingPanel.tsx:18-27, both with comments explaining why).
- **Impact**: User-visible: the cross-project stats summary silently loses all its color coding; also a trap for the next person who copies this component.
- **Fix sketch**: Replace the `color: string` prop with a typed union and a static `Record<Color, {border,bg,icon,text}>` map of full literal class strings, mirroring `STAT_COLORS` in OverviewParts.tsx:29-36 (which does it correctly for the sibling StatCard). Alternatively reuse/extend that existing `OverviewParts.StatCard` instead of keeping a second, broken StatCard in the same feature.

## 2. TaskRunnerPage re-renders the entire task queue on every streamed output line
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/dev-tools/sub_runner/TaskRunnerPage.tsx:452
- **Scenario**: Start a batch or Auto-Run with 20+ tasks. Every TASK_EXEC_OUTPUT event calls `appendTaskOutput`, which replaces `taskOutputBuffers` in the store; the page subscribes to the whole `taskOutputBuffers` object (line 452), so each streamed line re-renders the full page — the unmemoized `storeTasks.map(...)` view-model rebuild (line 462), five `.filter()` passes for the counters, the `reduce` grouping, and every `TaskCard` (none of which are memoized), plus a `storeTasks.find` per card inside the render loop (line 835). Claude CLI streams can emit many lines per second per running task.
- **Root cause**: Whole-map subscription plus non-memoized derived arrays and non-memoized cards means the streaming hot path pays the full-queue render cost per line instead of a single expanded card's cost.
- **Impact**: Measurable CPU burn / dropped frames in the WebView during exactly the moment the user watches this page (long auto-runs); scales linearly with queue size × output rate.
- **Fix sketch**: Wrap `TaskCard` in `React.memo` and move the output-lines subscription into the card (`useSystemStore((s) => s.taskOutputBuffers[task.id] ?? EMPTY)`), so only the card whose buffer changed re-renders. Memoize the `tasks` view-model and `tasksByStatus` with `useMemo` on `[storeTasks, taskWarnings]`, and build a `Map<id, DevTask>` once instead of `storeTasks.find` per card.

## 3. Three GitHub-repo URL parsers coexist inside the same dev-tools feature
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_runner/PrBridge.tsx:65
- **Scenario**: `PrBridge.parseGitHubRepo` (PrBridge.tsx:65), `parseGitHubUrl` in sub_overview/adapters.ts:43, and `parseRepoUrl` in sub_projects/GitHubRepoSelector.tsx:31 all parse a repo URL into owner/name, each with different edge-case behavior (SSH URLs only in PrBridge; `[^/.]+` in adapters breaks on repos containing dots; GitHubRepoSelector accepts any host). A URL that works in one surface silently fails or mis-parses in another.
- **Root cause**: Each sub-feature grew its own parser instead of sharing one utility.
- **Impact**: Behavioral drift between the Overview deep-links, the PR bridge, and the repo selector for the same `github_url` value; three places to patch when a URL shape (e.g. `owner/repo.js`) surfaces a bug — adapters.ts's `parseGitHubUrl` already truncates repo names containing a dot.
- **Fix sketch**: Extract one `parseRepoUrl` module (e.g. `dev-tools/lib/repoUrl.ts`) handling https + ssh + `.git` + dotted names, returning `{provider, owner, repo}`; re-point the three call sites. Keep GitHubRepoSelector's looser "any-host" variant as a thin wrapper if genuinely needed. Verify no cross-context importers of the current exports before deleting (`parseRepoUrl` is exported).

## 4. IdeaTriagePage does O(ideas × storeIdeas) `.find()` lookups inside filters and per-agent counts on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-lookup
- **File**: src/features/plugins/dev-tools/sub_triage/IdeaTriagePage.tsx:317
- **Scenario**: With a few hundred pending ideas (recent scans on this repo produced 500+), every render of the triage page runs `storeIdeas.find((si) => si.id === i.id)` per idea in the pending filter (line 317), again per idea inside the scan-type sidebar (`SCAN_AGENTS.filter(... ideas.some(i => storeIdeas.find(...)))` at lines 564-568 — agents × ideas × storeIdeas), and the page re-renders on every swipe, sort toggle, and filter change.
- **Root cause**: `TriageIdea` drops `scan_type` during mapping even though it's built 1:1 from `storeIdeas`, forcing a linear re-lookup to recover it; the sidebar then nests that lookup inside two more loops.
- **Impact**: Up to millions of comparisons per render at realistic idea counts (30 agents × 500 ideas × 500 finds) — perceptible input lag on the page whose whole point is rapid-fire keyboard swiping. Bounded, but on the hottest interactive surface of triage.
- **Fix sketch**: Add `scanType: i.scan_type` to `TriageIdea` in the existing `useMemo` map, replace all three `storeIdeas.find` sites with `i.scanType`, and precompute pending-count-per-agent with a single `Map<string, number>` pass in a `useMemo`. Also wrap `pendingIdeas`/`sortedPending` in `useMemo` while there.

## 5. useOverviewData double-fetches all repo + Sentry stats on mount / project switch
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: duplicate-fetch
- **File**: src/features/plugins/dev-tools/sub_overview/useOverviewData.ts:164
- **Scenario**: Open the Overview tab (or switch projects). `loadRepoStats` runs, calls `setActiveRepoCredId(cred.id)` (line 99), which changes `activeRepoCredId`, which is in `loadRepoStats`'s dep list (line 119), giving the callback a new identity; the load effect (line 164) depends on `loadRepoStats`/`loadMonitorStats`, so it fires again — re-running both loaders. `fetchGitHubStats` is 3 sequential API-proxy requests and `fetchSentryStats` is 2, so one page open costs ~10 proxied HTTP round-trips instead of ~5, and the vitals skeleton flashes back to loading mid-way.
- **Root cause**: A callback that writes state it also depends on, combined with an effect keyed on that callback's identity.
- **Impact**: Every Overview mount and project switch doubles the external API traffic (rate-limit budget on GitHub/Sentry) and re-triggers the loading state; not unbounded, but paid on a routine navigation.
- **Fix sketch**: Read the sticky cred via a ref (or `useSystemStore`-style `getState` snapshot) instead of listing `activeRepoCredId` in `loadRepoStats`'s deps; or key the load effect on `[credLoaded, activeProject?.id]` only and call the loaders through refs. Either way the effect should fire once per (project, credentials-loaded) transition.

## 6. Fourth hand-rolled relative-time formatter added in ProjectOverviewPage
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_overview/ProjectOverviewPage.tsx:678
- **Scenario**: `relativeTime(iso)` (line 678) reimplements what already exists as `relativeTime` in sub_scanner/ideaScannerHelpers.ts (imported by IdeaScannerCards.tsx:12), `formatRelativeTime` in @/lib/utils/formatters (used by ProjectTeamPreviewModal.tsx:11), and the `<RelativeTime>` component this very file already imports and uses for the header timestamp (line 291).
- **Root cause**: Convenience local helper written instead of reusing the shared formatter one import away.
- **Impact**: Four diverging "Nm ago" dialects in the same plugin (this one says "just now"/weeks; others differ), and copy/i18n fixes must be applied in four places — the strings here are hardcoded English while the rest of the file is i18n'd.
- **Fix sketch**: Replace the local function's call sites (MetaPill "pushed …" at line 372 and ActivityRow at line 711) with the shared `formatRelativeTime` from @/lib/utils/formatters or the `<RelativeTime>` component, then delete the local function. Two-minute change, no behavior risk beyond slightly different wording.
