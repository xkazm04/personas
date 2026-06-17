# Test Mastery — Dashboard & Mission Control
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

Context note: the manifest lists `src/stores/slices/overview/index.ts`, which does not exist. The
real store is `src/stores/overviewStore.ts`, assembled from per-slice creators; the in-scope
mission-control state actually lives in `src/stores/slices/overview/certificationSlice.ts`. Findings
below target the real files. The project has a healthy vitest setup (`vitest.config.ts`,
`src/test/setup.ts` with Tauri mocks) and 100+ test files, plus a clean, copyable slice-test harness
in `src/stores/slices/overview/eventSlice.test.ts` — but **zero** tests touch any
dashboard-mission-control file.

## 1. Fleet optimization recommendation engine is entirely untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/features/overview/libs/fleetOptimizer.ts:141-257 (whole `generateFleetRecommendation` + `derivePerPersonaPerformance`)
- **Current test state**: none
- **Scenario**: This pure function decides what cost/reliability guidance the user sees on the dashboard and drives spend decisions ("downgrade to Sonnet", "$X savings", "cost spike $A vs $B avg"). A regression in the priority ladder (anomaly → wasteful → downgrade → healing → healthy), in a threshold constant (`HIGH_COST_PER_EXEC_USD=0.10`, `LOW_SUCCESS_RATE_PCT=60`, `MIN_EXECUTIONS=5`, `ANOMALY_SIGMA_THRESHOLD=2.0`), or in the success-rate derivation (`(totalExecs - healingTotal)/totalExecs`) would silently surface wrong/misleading financial advice with full confidence. Today nothing catches it.
- **Root cause**: Pure module with no co-located `*.test.ts`; never had a test added despite being decision logic over money.
- **Impact**: Users act on bad recommendations (downgrade a model that actually needs the capability, or miss a real cost spike) — direct cost/quality consequences, and erodes trust in the whole mission-control surface.
- **Fix sketch**: **LLM-generatable** table-driven test. Build a small `makeDashboard()`/`makeHealingIssue()` fixture factory (shapes from `ExecutionDashboardData` / `DashboardCostAnomaly` / `PersonaHealingIssue` bindings) and assert business **invariants**, not exact strings: (a) `total_executions < MIN_EXECUTIONS` → `null`; (b) any anomaly with `deviation_sigma >= 2.0` outranks every persona-level rec (returns `cost_anomaly`, and picks the **max-sigma** anomaly); (c) a persona at `avg_cost_per_exec >= 0.10` AND `successRate < 60` → `investigate_failures` ("wasteful") and **outranks** a high-cost/high-success persona; (d) high-cost + `successRate >= 90` → `downgrade_model` with `estimatedSaving == totalCost * 0.6`; (e) `healingIssueCount >= 3` → `investigate_failures`; (f) otherwise `healthy_fleet`; (g) success-rate clamps to `[0,100]` even when `failedEstimate > totalExecs`.

## 2. `formatRelative` time math has no test (off-by-bucket / overdue-sign risk)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:13-29
- **Current test state**: none
- **Scenario**: Converts a next-run ISO timestamp into the `2m`/`3h`/`5d` / `-1h` label shown for every upcoming routine. Bucket boundaries (`mins<60`, `hours<48`, else days), the `now`/`-` overdue prefix, and `NaN`-guard for malformed ISO are all untested. A boundary regression (e.g. flipping `<` to `<=`, or dropping the NaN guard) renders nonsense or `NaN` labels and mislabels future vs. past runs.
- **Root cause**: Helper is defined inline in the component file and not exported, so it was never unit-targeted.
- **Impact**: The dashboard's "when does this fire next" — the card's entire reason to exist — shows wrong times; users mis-trust the scheduler.
- **Fix sketch**: **LLM-generatable** with a fixed `nowMs`. Export `formatRelative` (or test via the row memo). Invariants: `null`/`"not-an-iso"` → `null`; `diff < 60s` → `{label:'now', overdue:false}`; 90s → `2m`; 47h → `47h`; 50h → `2d`; a past time → `overdue:true` with a `-` prefix. Pin `now` (don't call `Date.now()` in the test) to keep it deterministic.

## 3. "Drop past / un-advanced runs" filter — previously-broken logic, still untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:74-97
- **Current test state**: none
- **Scenario**: The row memo filters triggers to `enabled && trigger_type ∈ {schedule,cron,polling}`, keeps only rows where `nextAt === null || nextAt >= now`, sorts ascending (nulls last via `Infinity`), and caps at `MAX_ROWS=5`. The inline comment documents that this exact filter was already a bug once (frozen `now` left fired routines lingering as "upcoming" and past times rendered as misleading overdue rows). A regression — e.g. someone "simplifies" the `>= now` back to keeping past rows, or includes disabled/non-schedule triggers — reintroduces the original defect with no guard.
- **Root cause**: Logic lives inside a `useMemo` in a component with no test; the regression-prone behavior is protected only by a comment.
- **Impact**: Mission control shows already-fired or disabled routines as "upcoming," directly contradicting the card's promise and masking that the scheduler isn't advancing.
- **Fix sketch**: Extract the pure filter/sort/cap into a helper `selectUpcoming(triggers, personas, now)` and test it (RTL render of the card is also fine but heavier). Invariants: past `next_trigger_at` is excluded; `next_trigger_at === null` is kept (pending first run) and sorted **after** all dated rows; `enabled === false` and non-schedule `trigger_type` excluded; result length ≤ 5 and ascending by time; `personaName` falls back to `persona_id.slice(0,8)` when the persona is missing.

## 4. Certification slice: stale-result race guard + partial-failure handling untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/stores/slices/overview/certificationSlice.ts:34-104
- **Current test state**: none (the project's `eventSlice.test.ts` harness is directly reusable here)
- **Scenario**: Two deliberate correctness mechanisms are unprotected: (1) `loadEvalRunDetail` uses a module-scoped monotonic `certDetailSeq` so a slow earlier fetch resolving last doesn't clobber the newer selected run's detail; (2) `refreshCertification` uses `Promise.allSettled` so one failing read (status vs runs) doesn't blank the other panel, and surfaces the first error. A refactor to plain `await`/`Promise.all` quietly reverts both: the wrong run's detail shows, or one transient failure wipes good data.
- **Root cause**: Subtle async-ordering logic with no test; the seq guard is invisible to type-checking and easy to "clean up."
- **Impact**: Users see another run's certification detail (wrong pass/fail verdict) or lose a fully-loaded panel because the sibling fetch failed — both are silent, confidence-eroding data-integrity bugs in a read surface people trust to make ship/no-ship calls.
- **Fix sketch**: Reuse the `makeHarness()` pattern from `eventSlice.test.ts`; `vi.mock("@/api/overview/certification")`. Tests: (a) fire `loadEvalRunDetail("A")` (slow) then `loadEvalRunDetail("B")` (fast), resolve A **after** B → `evalRunDetail` is B's and stays B's; (b) `refreshCertification` with `fetchCertStatus` rejecting but `fetchEvalRuns` resolving → `evalRuns` populated, `certStatus` `[]`, `certError` set, `certLoading=false`; (c) both succeed → `certError=null`, `certLastRefreshedAt` set.

## 5. FleetOptimizationCard suppression guards untested (render gating)
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/overview/sub_missionControl/cards/FleetOptimizationCard.tsx:234-263
- **Current test state**: none
- **Scenario**: The card returns `null` when there's no recommendation, and specifically hides the `healthy_fleet` rec when `total_executions < 10` (so a near-empty fleet doesn't get a smug "all good" banner). It also memoizes on `executionDashboard`/`healingIssues`. A regression in either guard either spams an unwarranted "Fleet Running Smoothly" card on a fresh install or hides genuine recommendations.
- **Root cause**: Gating thresholds (`< 10`) live in the component and duplicate intent already encoded in `fleetOptimizer` (`MIN_EXECUTIONS=5`); the two thresholds drifting apart is exactly the kind of bug a test pins.
- **Impact**: First-run UX shows misleading "healthy fleet" reassurance, or real cost/reliability recs get suppressed — undermines mission control on the most-viewed screen.
- **Fix sketch**: RTL render with a mocked `useOverviewStore` (mock `generateFleetRecommendation` or feed real fixtures). Assert: `recommendation === null` → renders nothing; `healthy_fleet` + `total_executions = 8` → renders nothing; `healthy_fleet` + `total_executions = 50` → renders the title; a `cost_anomaly` rec → renders regardless of count. Keep assertions on presence/role, not class names.

## 6. No per-area quality gate / new-code ratchet for `overview/libs` + `overview` slices
- **Severity**: medium
- **Category**: quality-gate
- **File**: vitest.config.ts:10-18 (no `coverage` block; no thresholds for `src/features/overview/libs/**` or `src/stores/slices/overview/**`)
- **Current test state**: n/a (config-level)
- **Scenario**: `fleetOptimizer.ts` (decision logic over spend) and the overview slices are pure/near-pure and cheap to cover, yet a new untested branch can land freely. There's no advisory threshold or new-code ratchet to keep the gap from regrowing after findings 1–4 are fixed.
- **Root cause**: `vitest.config.ts` defines `include` but no `coverage.thresholds`; CI has no per-path ratchet.
- **Impact**: Coverage added for the fixes above silently erodes as the dashboard evolves; the high-value pure logic drifts back to zero.
- **Fix sketch**: Add a `coverage` block scoped to the pure, high-leverage paths (`src/features/overview/libs/**`, `src/stores/slices/overview/**`) with an **advisory→blocking** threshold (start ~70% lines/branches on those globs only, not repo-wide) plus a new-code ratchet in CI. Calibrate to these globs so it catches real risk without forcing a giant UI-component backfill that would just get bypassed.

## 7. `useCertificationData` deferred-load gate untested
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/overview/sub_certification/useCertificationData.ts:29-40
- **Current test state**: none
- **Scenario**: The hook fires `refreshCertification` exactly once via `requestIdleCallback` (with `setTimeout` fallback), guarding on `certLastRefreshedAt || certLoading || already-has-data` so it doesn't re-fetch on every mount. A regression (broken guard) causes a fetch storm on every Overview→Certification navigation; a broken fallback means data never loads in environments without `requestIdleCallback`.
- **Root cause**: Effect-with-idle-callback logic, never exercised; `requestIdleCallback` is not mocked in `src/test/setup.ts`.
- **Impact**: Minor — redundant IPC chatter or a non-loading panel in fallback environments; low blast radius since it's a dev-only read surface.
- **Fix sketch**: Render the hook with a mocked store; stub/remove `requestIdleCallback` to exercise the `setTimeout` path; assert `refreshCertification` is called once when state is empty and **not** called when `certLastRefreshedAt` is set or data already present. (Add a `requestIdleCallback` shim to `src/test/setup.ts` so the idle path is also reachable.)
