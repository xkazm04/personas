# Dashboard & Mission Control — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Failed eval-run detail load traps the user on an infinite spinner with no error and no way back
- **Severity**: High
- **Category**: bug
- **File**: src/features/overview/sub_certification/CertificationCommandCenter.tsx:89-95 (with src/stores/slices/overview/certificationSlice.ts:96-101)
- **Scenario**: User opens Certification Command Center, clicks a run in the history/overview list while the underlying bundle file is unreadable (deleted/renamed run dir under `docs/test/runs/`, malformed JSON, or any `fetchEvalRun` rejection). `loadEvalRunDetail` catches, sets `certDetailLoading: false` and `certError`, but leaves `evalRunDetail` null.
- **Root cause**: The detail branch renders `certDetailLoading || !evalRunDetail ? <LoadingSpinner/> : <RunDetailView/>` — it assumes a finished load always produces a detail object. The only error surface is `showEmptyError`, which is gated on `certStatus.length === 0 && evalRuns.length === 0`, i.e. it can never fire in detail mode (you needed non-empty lists to click a run). The spinner branch renders no back button (`onBack` only exists inside `RunDetailView`).
- **Impact**: Permanent spinner labeled "loading" after a failed detail fetch; the error is swallowed, and `detailMode` local state keeps the tabs/overview hidden. The user can only escape by navigating to a different Overview tab and back (remount resets local state) — classic silent-failure dead end.
- **Fix sketch**: In the detail branch, render an `InlineErrorBanner` with a Back button when `!certDetailLoading && !evalRunDetail` (optionally keying off a dedicated `certDetailError`), instead of falling through to the spinner.

## 2. Partial refresh failure silently blanks a previously loaded certification panel
- **Severity**: Medium
- **Category**: bug
- **File**: src/stores/slices/overview/certificationSlice.ts:60-61 (surfaced via CertificationCommandCenter.tsx:58)
- **Scenario**: Both panels loaded fine once. User hits Refresh while `fetchCertStatus` transiently fails (file lock, mid-write run bundle) but `fetchEvalRuns` succeeds.
- **Root cause**: `refreshCertification` maps a rejected settle to `[]` (`statusRes.status === "fulfilled" ? statusRes.value : []`) and writes it unconditionally, replacing known-good data with empty. The comment says allSettled prevents one failure from blanking "the other panel" — true, but the failed panel's own previously-good data IS blanked. And because `showEmptyError` requires both lists empty, `certError` is set yet never displayed when the other list is non-empty.
- **Impact**: A manual refresh can make the per-team cert status vanish with zero error indication — the user reads "no teams certified" (empty state) as truth. Data-honesty regression on a status dashboard.
- **Fix sketch**: On rejection, keep the previous slice value (`statusRes.status === "fulfilled" ? statusRes.value : get().certStatus`) and surface `certError` as a non-blocking banner/toast even when data is present.

## 3. UpcomingRoutinesCard has no loading or error state — it simply doesn't exist until a fetch succeeds
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:42, 71, 117
- **Scenario**: User opens the dashboard while `listAllTriggers` is slow or failing (backend busy, DB locked). The initial fetch rejects into `silentCatch`; `loaded` stays false; the card renders `null`.
- **Root cause**: `loaded` is only set on a successful fetch, and the catch path discards the error entirely. There is no skeleton for the in-flight state and no error/retry state at all — failure is indistinguishable from "feature not present". When a later 30s tick fails after a prior success, the stale list keeps rendering with no staleness cue either.
- **Impact**: On failure the mission-control column silently loses a whole card (layout shift when it eventually appears), and a user with scheduled routines gets no signal that the app can't read them — up to 30s minimum, forever if the backend keeps erroring.
- **Fix sketch**: Set `loaded` (or an `error` flag) in `.finally`/`.catch`; render the CardHeader with a compact error row + retry on failure, and a small skeleton while the first fetch is in flight.

## 4. Fleet Optimization card mixes translated chrome with hardcoded English content
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_missionControl/cards/FleetOptimizationCard.tsx:89-93, 171-189 (content strings in src/features/overview/libs/fleetOptimizer.ts:191-293)
- **Scenario**: User runs the app in any of the 13 non-English locales and the fleet optimizer produces a recommendation.
- **Root cause**: The card's title, tooltips and buttons go through `t.overview.fleet_optimization`, but `SEVERITY_LABEL` ("Urgent"/"Suggested"/"Insight") and the expanded-row labels ("Impact"/"Action"/"Agent") are hardcoded, and every recommendation title/description/impact/suggestedAction is composed as English prose inside `fleetOptimizer.ts`. The design assumed the optimizer output is data, but it is user-facing copy.
- **Impact**: A half-translated card in a project that enforces i18n key parity across 13 locales (lefthook `i18n-no-gaps`); the most prominent dashboard insight reads in the wrong language for most locales.
- **Fix sketch**: Move SEVERITY_LABEL and the three row labels into `t.overview.fleet_optimization.*`; have `generateFleetRecommendation` return i18n keys + params (or accept a `t`/`tx` pair) instead of prebuilt English strings.

## 5. Cost-anomaly recency window drifts by timezone and time-of-day
- **Severity**: Low
- **Category**: bug
- **File**: src/features/overview/libs/fleetOptimizer.ts:175-180
- **Scenario**: User in a non-UTC timezone (e.g. UTC+12 or UTC-8) views the dashboard; an anomaly dated exactly `ANOMALY_RECENCY_DAYS` ago sits at the window boundary.
- **Root cause**: `new Date(a.date)` on a date-only string (`YYYY-MM-DD`) parses as UTC midnight, while `recencyCutoff` is local now minus 3 days including the current time-of-day. The comparison mixes UTC-midnight instants with a local wall-clock cutoff, so the effective window is 3 days minus the current time-of-day, shifted by the UTC offset — a boundary anomaly is included or excluded off by up to ~a day depending on locale and hour.
- **Impact**: A still-relevant spike can be prematurely demoted (or a stale one briefly resurrected as a "critical" cost spike) purely by timezone/hour — inconsistent severity for the top-priority recommendation slot.
- **Fix sketch**: Compare date-to-date: derive the cutoff as a `YYYY-MM-DD` string (local or UTC, matching how the backend stamps `a.date`) and use lexicographic comparison `a.date >= cutoffDateStr`.
