# Dashboard & Mission Control — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: dashboard-and-mission-control | Group: Observability & Analytics
> Total: 5 | Critical: 0 | High: 3 | Medium: 2 | Low: 0

## 1. `overall_success_rate` is a 0..1 ratio but compared against `80` — "Fleet Running Smoothly" card is dead code
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: unit-mismatch / dead-code / wrong-at-a-glance-state
- **File**: src/features/overview/libs/fleetOptimizer.ts:271 (and :280)
- **Scenario**: A fleet with nothing else wrong (no anomalies, no costly/failing/troublesome personas) and, say, a real 95% success rate. The healthy-fleet branch evaluates `dashboard.overall_success_rate < HEALTHY_FLEET_SUCCESS_PCT` → `0.95 < 80` → `true` → `return null`. `generateFleetRecommendation` returns null, and `FleetOptimizationCard` renders nothing (line 247). The reassuring "Fleet Running Smoothly" card can NEVER appear.
- **Root cause**: The Rust producer computes `overall_success_rate = total_completed / total_executions` (src-tauri/src/db/repos/execution/metrics.rs:1303-1304) — a fraction in [0,1]. The rest of the app treats it as `precomputed_ratio` (metricIdentity.ts:38, useExecutionMetrics.ts:115). `HEALTHY_FLEET_SUCCESS_PCT = 80` (line 73) is a percentage. The gate added to suppress a false-positive healthy status (comment lines 266-269) silently broke the entire healthy path. As a bonus, the unreachable line 280 would render `Math.round(0.95)` → "1% success rate".
- **Impact**: The dashboard's headline positive signal is permanently missing; on a healthy fleet the whole Fleet Optimization card silently vanishes (no error, no card). If the gate were ever loosened, it would print a grossly wrong "1% success rate".
- **Fix sketch**: Compare against the ratio (`< 0.8`) or normalize once (`const pct = overall_success_rate * 100`) and use `pct` in both the gate (line 271) and the description (line 280). Add a test pinning the [0,1] convention.
- **Value**: impact=7 effort=1

## 2. UpcomingRoutinesCard fetches triggers once and never refetches — rows silently disappear over a session
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: stale-data / wrong-at-a-glance-state
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:61-72 (one-shot fetch) + :90 (past-time filter)
- **Scenario**: Open the dashboard with three schedule triggers due in 2m, 10m, 1h. The card stays mounted "for the whole session" (its own comment, line 44). `nowTick` advances every 30s and only re-filters/re-labels the already-fetched `triggers`. As wall-clock passes each `next_trigger_at`, the filter at line 90 (`new Date(row.nextAt).getTime() >= now`) drops that row. The backend scheduler fires the routine and advances `next_trigger_at` to the next occurrence, but the client never re-pulls `listAllTriggers`, so the row is removed instead of rolling forward. After ~1h every row has elapsed → the card shows EmptyState "no upcoming routines" while routines are very much still scheduled.
- **Root cause**: `triggers` is loaded in a mount-only effect with empty deps; only `nowTick` is reactive, and `nowTick` cannot resurrect a row whose stale `next_trigger_at` is now in the past. There is no polling, no event-bus invalidation, and no refetch tied to `nowTick`.
- **Impact**: Mission-control's "upcoming routines" becomes confidently wrong/empty during a long session, hiding scheduled work. Classic stale-aggregate-on-a-glanceable-card failure.
- **Fix sketch**: Refetch `listAllTriggers()` on the same 30s/visibility cadence as `nowTick` (or subscribe to a triggers-changed signal). At minimum, refetch when a row's `next_trigger_at` crosses `now` so the list rolls to the next occurrence instead of emptying.
- **Value**: impact=7 effort=3

## 3. Per-persona success rate counts ALL healing issues (resolved + auto-fixed) as failed executions
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: aggregation-semantics / misleading-recommendation
- **File**: src/features/overview/libs/fleetOptimizer.ts:101-107 (healing tally) + :122-124 (failure estimate) → surfaces at :197-209 ("High Cost, Low Success")
- **Scenario**: A costly persona (avg ≥ $0.10/run) accumulated 12 healing issues over its lifetime that were ALL auto-fixed or resolved months ago; it currently runs fine. Over a 30-day window it has ~20 executions. `healingByPersona` sums every issue regardless of status (`existing.total += 1`, no status filter, line 103). `failedEstimate = min(12, 20) = 12` → `successRate = (20-12)/20*100 = 40%` → below `LOW_SUCCESS_RATE_PCT (60)` → the card headlines "High Cost, Low Success" and urges investigation of a healthy agent.
- **Root cause**: `healing.total` is a lifetime, all-status count used as a proxy for *failed executions in the window*. The recent cap fix (lines 120-122) only prevents negative rates; it does not fix the semantic that resolved/auto-fixed issues are still treated as current failures. `openIssueCount` exists but is not used to gate the failure estimate.
- **Impact**: The single most prominent optimization rec can be flatly wrong — flagging a working, expensive persona as broken, eroding trust in the whole mission-control surface.
- **Fix sketch**: Base `failedEstimate` on open/recent issues only (e.g. `healing.open`, or issues within the dashboard window), not lifetime `total`; or derive failures from `daily_points` failed counts. Document the chosen proxy and its window alignment.
- **Value**: impact=6 effort=3

## 4. UpcomingRoutinesCard swallows fetch errors → card permanently invisible with no retry
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / error-handling
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:70 (silentCatch) + :99 (`if (!loaded) return null`)
- **Scenario**: `listAllTriggers()` rejects (backend hiccup, command error). `silentCatch` only logs a warn + Sentry breadcrumb (silentCatch.ts:71-83); it never touches component state. `setLoaded(true)` is only called in the success branch (line 67), so `loaded` stays false forever and the component returns `null` at line 99. The card disappears entirely with zero user-visible signal and is never retried for the rest of the session.
- **Root cause**: Loading/error are conflated into a single `loaded` boolean with no error state, and the catch path leaves it false. No retry/backoff and (per finding #2) no periodic refetch to recover.
- **Impact**: On a transient failure the routines card vanishes silently and indefinitely; the user has no idea data failed to load.
- **Fix sketch**: Add an `error` state set in the catch, render a small inline error/retry (or an empty-with-retry) instead of `null`, and let the refetch from finding #2 clear it on recovery.
- **Value**: impact=4 effort=2

## 5. FleetOptimizationCard recomputes the rec from two independently-fetched sources that can be mismatched/empty
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: race / incomplete-data
- **File**: src/features/overview/sub_missionControl/cards/FleetOptimizationCard.tsx:236-244 → src/features/overview/libs/fleetOptimizer.ts:165
- **Scenario**: `executionDashboard` (overviewSlice) and `healingIssues` (healingSlice) are fetched by separate store actions at separate times. On initial load the dashboard can resolve while `healingIssues` is still `[]`. The memo then computes `derivePerPersonaPerformance` with no healing data → every `successRate` = 100 → a costly persona surfaces a "Model Downgrade Opportunity" (path #3) or the healthy path; when `healingIssues` later loads, the rec re-derives and can flip to "High Cost, Low Success" / "Recurring Failures". Symmetrically, stale `healingIssues` from a prior view can over-count failures against a freshly-loaded dashboard.
- **Root cause**: No coherence guard that both inputs come from the same load generation / time window; the optimizer assumes a consistent pair but receives whatever each slice currently holds. The function's own comments already flag the lifetime-vs-windowed mismatch but not the cross-source timing gap.
- **Impact**: Transient or stale wrong recommendation on the dashboard's most prominent advisory card (flicker into/out of a false warning, or an actionable warning suppressed while healing data is absent).
- **Fix sketch**: Gate generation until both sources are present (or pass a "healing not yet loaded" flag so the optimizer skips healing-dependent recs and returns null/neutral rather than a falsely-healthy or falsely-downgrade rec); ensure both refresh together.
- **Value**: impact=5 effort=4
