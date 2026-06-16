# Bug Hunter — Analytics, SLA & Usage

> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)
> Context: analytics-sla-usage | Group: Observability & Analytics

## 1. SLA daily-trend bars render at zero height — the trend chart is silently blank
- **Severity**: High
- **Category**: Silent failure (success theater)
- **File**: `src/features/overview/sub_sla/components/SLACard.tsx:132`
- **Scenario**: `DailyTrendChart` maps each daily point to a column whose inner bar is `<div className={...rounded-t-interactive ${color}} />` with **no `height` / no inline style**. The success rate is computed and colored (`rateToHealth(p.success_rate)`), and a `title` tooltip is attached, but the bar element has no vertical extent, so every bar collapses to 0px. The user sees an empty 96px strip under the "Daily success rate" heading.
- **Root cause**: The height was never bound to `p.success_rate`. The column wrapper uses `justify-end` and a fixed `h-24`, expecting the child to set its own height (e.g. `style={{ height: `${p.success_rate * 100}%` }}`), but that binding is missing. `rounded-t-interactive` + `w-full` give it width but zero height.
- **Impact**: A headline reliability visualization shows nothing. Worse than an empty state — the card frame and heading render, implying data exists, so users assume "no problems" / "flat trend" when the data is actually present (only readable by hovering an invisible 1px-wide region). Classic success theater: looks fine, conveys nothing.
- **Fix sketch**: Bind height to the rate: `style={{ height: `${Math.max(2, p.success_rate * 100)}%` }}` (min 2% so a 0% day is still a visible nub), and guard `success_rate` to `[0,1]`. Add a visual test asserting non-zero bar height for a non-empty trend.

## 2. Heatmap day buckets are UTC on the server but local-time on the client — wrong-day attribution
- **Severity**: High
- **Category**: Edge case / wrong-but-plausible (timezone bucket misalignment)
- **File**: `src/features/overview/sub_analytics/components/ExecutionHeatmap.tsx:77` (and server `src-tauri/src/db/repos/execution/metrics.rs:1973`)
- **Scenario**: The server groups executions by `DATE(created_at)` (SQLite, UTC, since timestamps are stored in UTC) and computes `today = chrono::Utc::now().date_naive()`. The client `buildGrid` anchors the grid on `new Date(); today.setHours(0,0,0,0)` and lays cells out using `date.getDay()` / `getMonth()` / `formatIso(getFullYear/getMonth/getDate)` — all in the **browser's local timezone**. For any user not on UTC (e.g. UTC-7), an execution at 11pm local (06:00 UTC next day) is bucketed by the server into the next calendar day, and the client paints it onto a cell labeled with the *local* date. Near month boundaries the whole "today" rightmost column can be off by one day.
- **Root cause**: Two independent date authorities with no shared timezone contract. Server keys are UTC `YYYY-MM-DD` strings; client `formatIso(date)` produces local `YYYY-MM-DD` strings, and `byDate.get(isoDate)` matches them as if they were the same calendar system.
- **Impact**: Counts land on the wrong cell for off-UTC users; "today" may show 0 while yesterday double-counts; peak-day and streak alignment between server insights (UTC) and the painted grid (local) disagree. Plausible-but-wrong activity map — undetectable without cross-checking raw rows.
- **Fix sketch**: Pick one timezone for both ends. Either bucket server-side with the user's offset (`DATE(created_at, '<±HH:MM>')`) and send the offset down, or have the client build the grid from UTC (`Date.UTC` + `getUTCDay`) to match the server's UTC `DATE()`. Document the chosen contract next to both `buildGrid` and the SQL.

## 3. Speed & cost dimensions score a hardcoded 50 when the fleet average is 0 — masks real performance
- **Severity**: Medium
- **Category**: Silent failure / wrong-but-plausible (single-datapoint & empty-window stats)
- **File**: `src/features/overview/sub_leaderboard/libs/leaderboardScoring.ts:70`
- **Scenario**: `scoreSpeed(latencyMs, fleetAvgMs)` returns `50` whenever `fleetAvgMs <= 0 || latencyMs <= 0`; `scoreCostEfficiency` does the same on cost. When the fleet has no measured latency/cost yet (fresh install, all-cancelled runs, or `avgLatencyMs`/`dailyBurnRate` reported as 0), every persona gets exactly 50 on two 20%-weighted dimensions — i.e. a flat +20 composite contribution that is neither earned nor real. A genuinely fast/cheap agent and a slow/expensive one are scored identically.
- **Root cause**: The "no data → neutral 50" fallback is applied per-call without distinguishing "no fleet baseline exists" (should be *unknown*, excluded from the composite) from "this agent sits at the median" (legitimately 50). The fallback also fires for a **single** active agent, because that agent's own latency equals the fleet average → ratio 1.0 → 50, so a solo agent can never score above 50 on speed/cost.
- **Impact**: Leaderboard ranks and medals are decided partly by a constant, producing wrong-but-plausible ordering and "biggest opportunity" hints that point at dimensions the data can't actually evaluate. Tier badges (elite/strong) inflate or deflate uniformly.
- **Fix sketch**: Return a sentinel (e.g. `null`) for "no baseline" and renormalize the composite over only the dimensions that have data, rather than injecting 50. For the single-agent case, skip speed/cost from the composite (or surface "needs ≥2 agents to benchmark").

## 4. Global avg latency mis-weights by total executions instead of timed executions
- **Severity**: Medium
- **Category**: Wrong-number bug (numeric aggregation)
- **File**: `src-tauri/src/db/repos/communication/sla.rs:334`
- **Scenario**: `g_avg_dur` is a weighted mean: `Σ(p.avg_duration_ms * p.total_executions) / g_total`. But `avg_duration_ms` per persona is `AVG(duration_ms)` computed **only over rows where `duration_ms IS NOT NULL`** (and the durations batch query further restricts to `status IN ('completed','failed')`), while `total_executions` counts completed + failed + **cancelled** rows. The weights therefore include runs that contributed nothing to the per-persona average. A persona with many cancelled runs (no duration) gets over-weighted in the global mean.
- **Root cause**: Weight and value have different denominators — value averages over "timed runs", weight is "all decided+cancelled runs". A correct weighted mean must weight each persona's mean by the *count of values that produced that mean* (the timed-run count), which the query doesn't carry forward.
- **Impact**: The "Avg latency" headline SLA card shows a number skewed toward personas that cancel a lot, drifting from the true fleet average. Subtle and plausible — never NaN, just wrong — so it silently misinforms capacity/SLA decisions.
- **Fix sketch**: Carry a `timed_count` per persona (e.g. `SUM(CASE WHEN duration_ms IS NOT NULL THEN 1 ELSE 0 END)`) and weight by that: `Σ(avg_dur_i * timed_count_i) / Σ(timed_count_i)`. Add a test mixing cancelled runs with timed runs and assert the global avg ignores the cancelled-only persona's weight.

## 5. Heatmap & rotation parse server timestamps with `new Date(...)` — silent NaN on legacy/naive shapes
- **Severity**: Medium
- **Category**: Latent failure / silent failure (timestamp parsing across boundaries)
- **File**: `src/features/overview/sub_analytics/components/RotationOverviewPanel.tsx:63` (also `:78`)
- **Scenario**: `countdownParts` does `new Date(nextRotation).getTime() - Date.now()`, and `summaryStats` does `new Date(item.status.next_rotation_at).getTime()`. The Rust side (see `sla.rs:parse_execution_timestamp`) documents that timestamps in this DB come in **three shapes**: SQLite `"YYYY-MM-DD HH:MM:SS"` (space, no zone), RFC3339 with offset, and `Z`-suffixed. JS `new Date("2026-06-20 12:00:00")` is **not** part of the ISO spec — engines parse the space-separated naive form as *local time* (or, in some, return `Invalid Date`). For the naive shape the countdown is silently computed in local time (drifting by the UTC offset), and any unparseable value yields `NaN`, which flows into `diff <= 0 → { isDue: true }`, falsely flagging a credential as "rotation due now" / coloring the row amber.
- **Root cause**: The frontend assumes a single canonical ISO-8601-with-zone format, but the backend admits naive SQLite timestamps. `new Date()`'s lenient, engine-dependent parsing turns a format mismatch into a wrong number rather than an error, and `NaN <= 0` is `false`... but `NaN`-derived `Math.floor` days/hours render as `NaN`, and the `diff <= 0` due-now branch can be reached when subtraction produces `NaN`-adjacent edge values.
- **Impact**: Off-UTC users see rotation countdowns shifted by their offset; legacy/naive timestamps can render `NaN` days/hours or spuriously mark credentials "due now," eroding trust in the rotation panel (the same panel that drives the manual rotate action).
- **Fix sketch**: Normalize timestamps before parsing — reuse a shared parser that handles the space-separated naive form (treat as UTC) and RFC3339, mirroring `parse_execution_timestamp`. Guard `Number.isFinite(diff)` and render `—` (not "due now") when parsing fails.
