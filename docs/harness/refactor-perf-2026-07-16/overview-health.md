# overview/health — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Observability & Monitoring | Files read: 16 | Missing: 0

## 1. Grade thresholding (80/50/0) duplicated in three places
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_health/components/StatusPageView.tsx:49
- **Scenario**: The score→grade mapping exists as `gradeFromScore` (heartbeats/model.ts:49), `computeGrade` (libs/compositeHealthScore.ts:133), and an inline `globalGrade` useMemo in StatusPageView.tsx:49-54 — three identical copies of the same 80/50/>0 threshold ladder within one feature.
- **Root cause**: StatusPageView and compositeHealthScore were built alongside the heartbeats model without importing its existing helper.
- **Impact**: If the grade bands ever shift (e.g. healthy raised to 85), the status page global chip, per-persona grades, and heartbeats view can silently disagree — the exact class of drift GRADE_THEME was centralized to prevent.
- **Fix sketch**: Keep one canonical `gradeFromScore` (compositeHealthScore.ts is the JSX-free lib, a natural home; or model.ts), have `computeGrade` delegate to it or be deleted, and replace the StatusPageView useMemo with a direct call (`GRADE_META[gradeFromScore(globalScore)]` needs no memo at all).

## 2. "Xs ago / Xm ago" relative-time label reimplemented four times in overview
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_health/components/PersonaHealthDashboard.tsx:54
- **Scenario**: The same last-refreshed formatter is hand-rolled in PersonaHealthDashboard.tsx:54-59, StatusPageView.tsx:42-47, sub_observability/IpcPerformancePanel.tsx:57-59, and sub_observability/AlertRulesPanel.tsx:209-211 — already drifting (Math.round vs Math.floor, seconds vs milliseconds input).
- **Root cause**: No shared `formatTimeAgo(timestamp)` utility; each panel copy-pasted the two-branch formatter.
- **Impact**: Four copies to touch for any change (hour granularity, i18n of "ago" — these are also untranslated English while the rest of the UI goes through `t`), and the existing rounding drift means adjacent panels can label the same age differently. Note also all copies compute `Date.now()` inside a useMemo keyed only on the timestamp, so the label freezes until the next refresh — a shared helper is the right place to fix that once.
- **Fix sketch**: Add `formatTimeAgo(ts: number): string` to a shared lib (e.g. `src/features/shared/libs/time.ts` or the i18n layer so "ago" is translatable) and replace all four call sites. Optionally pair with a small `useNow(30_000)` ticker hook so labels stay live.

## 3. Dead `byGrade` model field and unused `signals` variant prop
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_health/components/heartbeats/model.ts:89
- **Scenario**: `useHeartbeatsModel` builds and returns `byGrade` (model.ts:89,95-96,103) but no file in src/ reads it — VitalsLedger consumes only counts/sorted/unhealthy/healthy. Likewise `HeartbeatsVariantProps.signals` (model.ts:107-113) is threaded from HeartbeatsView into VitalsLedger, which destructures everything except `signals` (VitalsLedger.tsx:30) — it uses `model.sorted` instead.
- **Root cause**: Leftovers from the retired card-grid/severity-lane A/B variants that the Vitals Ledger consolidation replaced (per the file-header comments).
- **Impact**: Per-render allocation of four throwaway arrays and a misleading contract — a reader assumes variants still need raw `signals` and grade buckets. Grep-verified within src/; no dynamic access pattern applies.
- **Fix sketch**: Drop `byGrade` from `HeartbeatsModel` and the build loop (keep `counts`), and remove `signals` from `HeartbeatsVariantProps` and the `<VitalsLedger signals={...}>` call site in HeartbeatsView.tsx:45. With one variant left, `HeartbeatsVariantProps` could simply become `VitalsLedgerProps`.

## 4. Status-page entries read personas via non-reactive storeBus.get inside useMemo
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: stale-cache
- **File**: src/features/overview/sub_health/libs/useStatusPageData.ts:107
- **Scenario**: `entries` is memoized on `[executionDashboard, slaStats, healingIssues]` but pulls the persona list with `storeBus.get(AccessorKey.AGENTS_PERSONAS)` at line 107. If personas hydrate after the last of those deps settles (cold start straight into the status page), the memo returns `[]` and the view shows "no personas" until an unrelated dep changes — worst case the next 60s auto-refresh tick.
- **Root cause**: A snapshot accessor is used inside a reactive memo; the memo cannot observe persona-store updates.
- **Impact**: Up to a minute of wrong "empty" status page after launch, plus a hidden invalidation dependency that makes the data flow fragile (any future removal of the 60s poll turns this into a permanent blank).
- **Fix sketch**: Subscribe reactively instead of snapshotting: select personas from the agents store hook (or mirror them into local state via a `storeBus` subscription) and add them to the memo deps. Everything downstream (`globalScore`, `globalUptime`) then invalidates correctly for free.

## 5. computeCompositeHealth repeats persona-invariant work inside the per-persona loop
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-loop
- **File**: src/features/overview/sub_health/libs/compositeHealthScore.ts:223
- **Scenario**: For each persona, `dailyStatuses` scans `pt.persona_costs.some(c => c.persona_id === persona.id)` across 30 days (line 223-227) — O(personas × 30 × costs-per-day), effectively O(30·P²) array scans since costs-per-day grows with persona count. The trend block (lines 240-252) computes `avgRecent`/`avgPrior` from the global `pt.success_rate`, values identical for every persona, yet recomputes them P times.
- **Root cause**: The per-day activity lookup and the global trend were left inline in the persona loop instead of being precomputed once over `last30`.
- **Impact**: This runs on every status-page mount, every 60s auto-refresh, and every visibility-return, on the UI thread inside a useMemo. Bounded today (tens of personas ⇒ low milliseconds) but the shape is quadratic and it sits on a hot recurring path.
- **Fix sketch**: Before the persona loop, build `const activeByDay = last30.map(pt => new Set(pt.persona_costs.map(c => c.persona_id)))` and compute `dayStatusFromRate(pt.success_rate)` per day once; per persona the daily status becomes a Set lookup. Hoist `avgRecent`/`avgPrior`/`delta`/`trend` out of the loop entirely (they are persona-invariant — if per-persona trend was intended, that is a separate data-model change).
