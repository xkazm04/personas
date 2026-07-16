# overview/observability [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 2 medium / 0 low)
> Context group: Observability & Monitoring | Files read: 4 | Missing: 1

Missing file: `src/features/overview/sub_observability/components/HealingStatusBadge.tsx` (no longer exists; skipped).

Files in this context are generally in good shape (well-commented sequence guard in `useAnomalyDrilldown`, ref-stabilized dismiss timer in `AlertToastContainer`, proper interval cleanup in `useGlobalAlertEvaluator`). Only two genuinely valuable findings.

## 1. Global alert evaluator fetches the full overview bundle every 60s even when no alert rule is enabled
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: wasted-fetch
- **File**: src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts:33
- **Scenario**: `useGlobalAlertEvaluator` is mounted in `BackgroundServices` (always on). Every 60 seconds for the app's entire lifetime it calls `getOverviewBundle(1)` — a multi-aggregation `get_overview_bundle` SQLite IPC on the Rust side — and then `evaluateAlertRules`, even for users who have zero alert rules or have disabled all of them. The API-level bundle cache is only 1s (src/api/overview/observability.ts:83), so it never dedupes across the 60s interval.
- **Root cause**: The hook fetches the metrics snapshot unconditionally; the "nothing to evaluate" check happens too late — `evaluateAlertRules` iterates `state.alertRules` and skips disabled ones only after the bundle has already been fetched.
- **Impact**: One unnecessary multi-query aggregation per minute per running app instance on a hot always-on path. Bounded per tick, but it is the single most frequent recurring backend call in an idle app, and it burns SQLite work + IPC serialization for a no-op.
- **Fix sketch**: After `await store.fetchAlertRules(false)`, read `useOverviewStore.getState().alertRules` and early-return before `getOverviewBundle` when `!alertRules.some(r => r.enabled)` (still let the pending-sync retry block run if desired by calling `evaluateAlertRules(undefined)` or extracting the retry into its own step). Rules are TTL-cached, so the guard itself stays cheap and reactivates automatically once a rule is enabled.

## 2. `useAthenaHealth` is a verbatim clone of `useAthenaUsage`, and both lack the stale-response guard the sibling hook already has
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_observability/libs/useAthenaHealth.ts:13
- **Scenario**: `useAthenaHealth` (this context) and `useAthenaUsage` (src/features/overview/sub_activity/libs/useAthenaUsage.ts:16) are structurally identical line-for-line — same `useOverviewFilterValues().effectiveDays` key, same `data/loading/error` state trio, same `load` callback with `silentCatch` + `setError(true)`, same `useEffect(load)` — differing only in the invoked API function and result type. The doc-comment even says "Mirrors useAthenaUsage (A3)".
- **Root cause**: The tab-local-fetch pattern was copy-pasted rather than extracted when the second consumer appeared. Neither copy carries the out-of-order-response guard that `useAnomalyDrilldown.ts:33` in this same folder documents and implements: rapid `effectiveDays` changes (day-range filter clicks) can let an older `companionGetHealth`/`companionGetUsageDashboard` response resolve last and overwrite the newer window's data.
- **Impact**: Two copies to keep in sync (the next fix — e.g. adding the seq guard — must be applied twice or drift), plus the shared latent stale-data bug in both panels.
- **Fix sketch**: Extract a generic `useDaysScopedFetch<T>(fetcher: (days: number) => Promise<T>, label: string)` in a shared lib (e.g. `src/features/overview/libs/`), returning `{ data, loading, error, reload }`. Include a fetch-sequence ref (same pattern as `useAnomalyDrilldown`) so only the latest response writes state. Reimplement both hooks as one-liners over it; `useAthenaUsage` additionally returns `days`, which the helper can expose.
