# overview/leaderboard — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 2 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 9 | Missing: 0

## 1. Auto-load effect becomes an infinite refresh loop when the fleet is empty or health compute keeps failing
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: unbounded-retry
- **File**: src/features/overview/sub_leaderboard/components/LeaderboardPage.tsx:21
- **Scenario**: User opens the Leaderboard tab with zero personas (fresh install) or while `computePersonaHealth` persistently errors. The effect fires because `isEmpty && !loading`, schedules `refresh()`; the refresh flips `healthLoading` true→false but `healthSignals` stays `[]`, so the dep array `[isEmpty, loading, refresh]` changes and the effect re-fires — scheduling another refresh every ~200ms–2s for as long as the tab is open.
- **Root cause**: The "auto-load on first visit" effect has no attempted/once guard and never consults `healthError` or `healthLastRefreshedAt` (both exist on the slice, personaHealthSlice.ts:97-98). An empty-but-successfully-loaded result is indistinguishable from never-loaded, so success-with-zero-agents re-triggers forever.
- **Impact**: Continuous background churn on a desktop app hot path: each cycle runs `fetchExecutionDashboard()` + the full persona-health recompute (SQLite reads via Tauri IPC), burning CPU/battery and spamming `measureStoreAction` telemetry, invisible to the user because the empty state renders normally.
- **Fix sketch**: Gate the effect on "never loaded" instead of "currently empty": e.g. read `healthLastRefreshedAt` (and `healthError`) from the store and only schedule when `healthLastRefreshedAt === null && !healthError`, or keep a `useRef(false)` attempted-flag set before scheduling. One-shot semantics also let you drop `loading` from the dep list.

## 2. Cost/raw display values re-derived in the view, drifting from the scoring engine's own formatting
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_leaderboard/components/LeaderboardMatrixView.tsx:53
- **Scenario**: `costPerExec()` (self-described as "Mirrors leaderboardScoring's per-exec cost") re-implements the exact formula from leaderboardScoring.ts:150-152, and `subLabel()` re-derives success %, latency-in-seconds, and $/run strings that `computeLeaderboard` already emits into `ScoreDimension.raw` (leaderboardScoring.ts:154-160). The two formatters already disagree: `raw` renders `$0.003` (toFixed(3)) while `subLabel` renders `<$0.1`/`$X.X`.
- **Root cause**: The matrix view was written against its own formatting helpers instead of consuming the `raw` field the scoring engine populates for exactly this purpose, leaving two sources of truth for "raw measurement shown under a score".
- **Impact**: Any change to the cost formula (e.g. fixing the `recentExecutions/7` denominator) must now be made in two files or the displayed raw silently stops matching the score it sits under — the drift the mirror-comment warns about has already begun in the formatting.
- **Fix sketch**: Pick one owner. Either have `subLabel` read `entry.dimensions.find(d => d.key === key)?.raw` (moving the tier/grade special cases on top), deleting `costPerExec` and the numeric re-derivations from the view; or, if the view's terser format is preferred, move `d1`/`costPerExec`/`subLabel` into leaderboardScoring/viewHelpers and delete the `raw` field (see finding 3).

## 3. Dead payload: ScoreDimension.raw/label/weight and most FleetBenchmark fields are computed but never consumed; ScoreRadar's benchmarkValues prop has no caller
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts:23
- **Scenario**: Every leaderboard recompute builds `raw` (5 formatted strings per entry), `label` (hardcoded English, shadowed by i18n `labelKey`s in the matrix and by ScoreRadar's own `AXES` constant), and `weight` per dimension — no file in src/ reads any of them (grep across the repo: only definitions). Likewise `computeFleetBenchmark` averages `successRate/avgLatencyMs/dailyBurnRate/totalExecutions/recentExecutions` per render, but only `dimensionValues` is ever read (via `fleetValue`). ScoreRadar's `benchmarkValues` prop (ScoreRadar.tsx:17) is never passed by either caller (EmptyStates.tsx:32 SingleAgentView, and the matrix doesn't render a radar), so the dashed fleet-reference polygon branch is unreachable.
- **Root cause**: The single-agent "radar vs fleet benchmark" design was partially built (benchmark computed in the hook, prop + render branch in the radar) but the wiring in `SingleAgentView` was never completed; the label/raw fields predate the i18n and matrix rewrites.
- **Impact**: Maintenance hazard more than runtime cost: readers must keep the DIM_ORDER/benchmark alignment contract (leaderboardViewHelpers.ts:12-14) intact for fields that are 60% unread, and the "single agent vs fleet" feature silently looks implemented while doing nothing.
- **Fix sketch**: Either finish the wire — `SingleAgentView` takes `fleetBenchmark` and passes `benchmarkValues={fleetBenchmark?.dimensionValues}` (LeaderboardPage already has it in hand) — or delete the prop, the polygon branch, and slim `FleetBenchmark` to `dimensionValues`. Independently drop `label` and `weight` from `ScoreDimension` (callers use `key` + i18n), and resolve `raw` per finding 2. Cross-context check done: `computeLeaderboard` is also imported by TopPerformersWidget.tsx, which touches none of these fields.

## 4. Matrix headers and page badge bypass i18n with hardcoded English while the rest of the page is translated
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/overview/sub_leaderboard/components/LeaderboardMatrixView.tsx:12
- **Scenario**: A non-English locale renders translated column labels (`lb[opt.labelKey]`), title, and empty states next to hardcoded 'Agent', 'Fleet avg', 'Click a metric to sort', 'tied', the `speedCaveat` tooltip, `TIER_LABEL`, `gradeWord` ('Healthy'/'Degraded'), plus the literal `{leaderboard.length} agents` badge in LeaderboardPage.tsx:50.
- **Root cause**: The `COPY` block is flagged "Prototype-local copy — extracted to en.json at consolidation", but the surrounding page has since been consolidated onto `t.overview.leaderboard` + DebtText, leaving this island behind.
- **Impact**: Visible mixed-language UI on the leaderboard for every non-English user; bounded to ~10 strings.
- **Fix sketch**: Move `COPY`, `TIER_LABEL`, `gradeWord` outputs, and the 'agents' badge string into `overview.leaderboard` keys (or `debtText` auto-keys to match the existing debt pipeline) and delete the local constants. ScoreRadar's `AXES` axis labels are in the same boat if the sweep extends there.
