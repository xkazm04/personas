# Home & Roadmap — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: home-and-roadmap | Group: Onboarding, Home & Settings
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. FleetHealthStrip is built but never mounted — the context's headline "fleet health strip" never renders
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dead code / missing feature (built-but-unwired)
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:96 (and the absence of any reference in src/features/home/sub_welcome/WelcomeLayout.tsx:46-70)
- **Scenario**: Open the Home/Welcome surface. The "fleet health strip" the context describes (executions today, success rate, active agents, credentials) is nowhere on screen. `HomeWelcome` → `WelcomeLayout` renders `HeroHeader`, `WelcomeGetStarted`, `NavigationGrid`, and `LanguageCards` only.
- **Root cause**: A repo-wide search (`grep -rn "FleetHealthStrip" src`) finds the identifier only in a doc comment in `lib/fleetHealth.ts:2`. No file imports or renders `FleetHealthStrip`, so the component, its 30s polling `useFleetMetrics` loop, and all of its derived health logic are dead code.
- **Impact**: The advertised home fleet-health feature is silently absent; users get no at-a-glance health. It also ships as unexercised dead code, and — critically — it hides findings #2–#5 below: those defects can never be caught in review/QA because nothing renders them. This is the gating issue for the rest of this report.
- **Fix sketch**: Either mount `<FleetHealthStrip />` in `WelcomeLayout` (e.g. under `HeroHeader`) and fix #2–#5 first, or delete the component + `lib/fleetHealth.ts` if the feature was intentionally cut. Decide deliberately — don't leave it half-wired.
- **Value**: impact=6 effort=2

## 2. "Success rate" denominator counts non-terminal executions → misleading low green rate + suppressed failure spike
- **Severity**: High
- **Lens**: bug-hunter / ambiguity-guardian
- **Category**: wrong health aggregate
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:39-41 and :47 (root: src-tauri/src/db/repos/execution/metrics.rs:423-425)
- **Scenario**: Backend window has 5 `completed` + 5 `running` executions, 0 failed. `total=10`, `successful=5`. The pill shows "50%" with a calm **emerald check** and no pulse. Or: 3 `failed` + 3 `running`, 0 completed → `failed/total = 0.5`, which is **not** `> 0.5`, so `hasFailureSpike` returns false — the red spike never fires even though every *finished* run failed.
- **Root cause**: `get_summary` SQL sets `total_executions = COUNT(*)` (all statuses) but `successful = status='completed'` and `failed = status='failed'`. In-flight/cancelled/timeout rows inflate the denominator. The frontend computes `successRate = successful/total` and `hasFailureSpike = failed/total > 0.5` against that mixed denominator. "Success rate of *what*" is undocumented — of all executions, or of finished ones?
- **Impact**: During normal activity (many running) the strip paints an alarming-but-green low success rate; conversely a real failure spike is diluted/masked by in-flight rows. Either way the user-facing health signal is wrong.
- **Fix sketch**: Define the rate over terminal executions only: `rate = completed / (completed + failed)` (guard divide-by-zero), and compute `hasFailureSpike` on `failed / (completed + failed)`. Document the chosen denominator next to `hasFailureSpike` in `lib/fleetHealth.ts`.
- **Value**: impact=7 effort=3

## 3. "Executions today" label vs a UTC rolling-24h window (no timezone offset)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: timezone / label–data mismatch
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:34 (`getMetricsSummary(1)`) + label at :119 (`fleet.executions_today`); root: src-tauri/src/db/repos/execution/metrics.rs:429 (`WHERE created_at >= datetime('now', '-1 days')`)
- **Scenario**: A user in UTC+10 at 9am local sees the "Executions today" count include runs from late *yesterday* local (within the last 24h UTC) and exclude nothing by calendar day. Near local midnight the count jumps by a day's worth of runs that aren't "today" in any local sense.
- **Root cause**: `days=1` yields a SQLite `datetime('now','-1 days')` filter — a **rolling 24-hour, UTC-based** window — while the label asserts a calendar concept ("today"). Notably `get_execution_heatmap` deliberately passes `tzOffsetMinutes` for local-day bucketing; `getMetricsSummary` passes no offset, so the strip can't agree with the heatmap or the user's local day.
- **Impact**: The count labeled "today" is routinely wrong for non-UTC users and around midnight — a quietly misleading health number.
- **Fix sketch**: Either relabel to "Executions (24h)" to match the rolling window, or add a `tzOffsetMinutes` parameter to `get_metrics_summary` and filter on the local calendar day like the heatmap does. Document which "day" the strip means.
- **Value**: impact=5 effort=4

## 4. Fleet health fails silently: blank on first-load error, frozen-stale on refresh error, no loading/error/stale state
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent failure / swallowed error
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:49-51 (catch→`silentCatch`) and :109 (`if (!metrics) return null`)
- **Scenario**: (a) Backend is unreachable on mount → `getMetricsSummary`/`listCredentials` reject, `silentCatch` swallows, `metrics` stays `null`, and the strip renders nothing forever with no skeleton or error — indistinguishable from "no strip." (b) First load succeeds, then every 30s refresh throws → the error is swallowed and the strip keeps showing the last-good numbers indefinitely with **no staleness indication**.
- **Root cause**: The only failure handling is `silentCatch`, and the only empty state is `return null`. There is no loading skeleton, no error affordance, and — unlike the live roadmap, which carefully distinguishes `cache` (healthy) vs `stale` (degraded) sources — no concept of stale fleet data.
- **Impact**: A broken metrics backend is invisible; worse, the user reads confidently-rendered health numbers that may be many minutes out of date while the fleet is actually erroring. Directly the "health strip showing wrong/stale state" risk.
- **Fix sketch**: Track a `status: 'loading' | 'ok' | 'error'` and a `lastUpdated`; render a skeleton while loading, a muted/"stale" treatment when the last refresh failed, and keep the swallowed error as a breadcrumb. Mirror the roadmap's `stale` semantics.
- **Value**: impact=5 effort=4

## 5. Success pill reads "healthy green" while a large minority of runs fail (rounding to 100% + lenient spike threshold)
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: misleading presentation threshold
- **File**: src/features/home/sub_welcome/FleetHealthStrip.tsx:40 (`Math.round`) and :132-134 (color/pulse), threshold src/features/home/sub_welcome/lib/fleetHealth.ts:29
- **Scenario**: 199 of 200 runs succeed → `Math.round(99.5)` = **"100%"** displayed despite a real failure. Or 40% of runs fail (ratio 0.4) → below the strict `> 0.5` spike threshold, so the pill stays emerald with a check icon and shows e.g. "60%" — a calm "all good" visual while two of every five runs fail.
- **Root cause**: The displayed percentage is rounded (hiding the last failure), and the red/pulse health *color* is gated solely on `hasFailureSpike` (`>50%` failures), decoupled from the number shown. Distinct from #2: even with a correct terminal-only denominator, the presentation still over-reassures.
- **Impact**: Mild but real "wrong health shown" — a perfect-looking green strip can mask sustained partial failure, the exact thing a fleet-health glance should surface.
- **Fix sketch**: Use `Math.floor` (or show one decimal) so 99.x never reads 100%, and drive the pill color from a graded scale (e.g. <90% amber, <50% red) rather than only the binary spike flag.
- **Value**: impact=4 effort=3
