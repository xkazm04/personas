> Context: overview/observability [2/2]
> Total: 6
> Critical: 0  High: 1  Medium: 3  Low: 2

## 1. Alert toast auto-dismiss timer resets on every container re-render
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/features/overview/sub_observability/components/AlertToastContainer.tsx:19-22, 52-54
- **Scenario**: `onDismiss` is created inline as `() => dismissToast(alert.id)` in the `.map()`, so a brand-new function is produced on every render of `AlertToastContainer`. The child's `useEffect(..., [onDismiss])` therefore tears down and re-arms its 8s `setTimeout` on each parent render. If alerts fire faster than every 8s (or anything else re-renders the store slice — a new alert pushed, another toast dismissed, `activeToasts` mutated), the older toasts' timers keep restarting and never reach `AUTO_DISMISS_MS`.
- **Root cause**: Auto-dismiss lifetime is tied to an unstable callback identity instead of the alert id.
- **Impact**: UX — toasts pile up and stay on screen indefinitely under sustained alerting, obscuring the dashboard; the "auto-dismiss after 8s" contract silently breaks exactly when it matters most (alert storm).
- **Fix sketch**: Make the effect depend on `alert.id` (stable) not `onDismiss`, or memoize the per-alert dismiss callback (`useCallback`) / call `dismissToast(alert.id)` from inside the timeout with the id captured. Use a ref for `onDismiss` if you must keep it in the dep-free effect.

## 2. useAthenaHealth has no stale-response guard on rapid filter change
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/overview/sub_observability/libs/useAthenaHealth.ts:19-35
- **Scenario**: Changing the Overview day-range recreates `load` and re-runs the effect, issuing a fresh `companionGetHealth(effectiveDays)`. If the user switches 7→30 days quickly, two calls are in flight; whichever resolves LAST wins `setData`, regardless of which range it belonged to. There is no sequence/AbortController guard — unlike the sibling `useAnomalyDrilldown`, which explicitly protects against exactly this.
- **Root cause**: Fire-and-forget promise writes to state with no check that it is still the latest request.
- **Impact**: UX/data-trust — the health panel can display a snapshot for a range the user is no longer viewing, misleading operational-health reads.
- **Fix sketch**: Add a `seqRef` bumped per `load()` (or an `AbortController` captured in the effect cleanup) and gate `setData/setError/setLoading` on `seq === seqRef.current`, mirroring `useAnomalyDrilldown`.

## 3. Global alert evaluator can run overlapping evaluations
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts:33-45
- **Scenario**: `setInterval(run, 60_000)` fires unconditionally. `run` awaits `fetchAlertRules`, `fetchAlertHistory`, and `getOverviewBundle`; if any is slow (companion under load, cold cache) and a single pass exceeds 60s, a second `run` starts while the first is still pending. Two concurrent `evaluateAlertRules(...)` calls can both pass the cooldown/history check before either records a firing, producing duplicate toasts / double-counted alert history.
- **Root cause**: The interval has no in-flight lock; `cancelled` only handles unmount, not concurrency between successive ticks.
- **Impact**: UX/correctness — duplicate alert notifications and potential cooldown-window corruption during exactly the slow-backend conditions alerts should surface.
- **Fix sketch**: Guard with an `isRunning` ref (`if (running) return; running = true; try {...} finally { running = false }`), or schedule the next tick with `setTimeout` chained after `run()` completes rather than a fixed `setInterval`.

## 4. HealingStatusBadge is an unused (dead) component
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/overview/sub_observability/components/HealingStatusBadge.tsx:1-49
- **Scenario**: Grep across `src` for `HealingStatusBadge` returns only the two self-references inside the file itself (the interface and the `export function`); no `<HealingStatusBadge`, no import, no barrel re-export. It is not Tauri-invoked (pure React component) so there is no dynamic-usage escape hatch.
- **Root cause**: Component was built for a healing-status surface that was removed or never wired; it now carries its own branch logic (circuit-breaker/pending/auto-fixed/severity) plus imports of `SEVERITY_COLORS`, `badgeClass`, `SEVERITY_STYLES`.
- **Impact**: Maintainability — ~50 lines of unused UI plus its dependency footprint mislead future edits and get dragged along in refactors of the severity token maps.
- **Fix sketch**: Delete the file (and drop the now-unneeded imports it kept alive), or wire it into the healing-issues list if that surface is intended. Confirm no `index.ts` barrel exports it before removal.

## 5. AlertToastContainer redefines a local severity style map
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/AlertToastContainer.tsx:7-11
- **Scenario**: A local `SEVERITY_STYLES` (info/warning/critical → border/bg/icon/iconColor) is hand-rolled here, while the codebase already centralizes severity accents in `@/lib/utils/designTokens` (`SEVERITY_STYLES`) and `@/lib/utils/formatters` (`SEVERITY_COLORS`) — the same maps the sibling `HealingStatusBadge` imports. The color values (blue/amber/red at /10-/30 opacity) restate the same semantic palette with a divergent key name (`critical` vs the token map's `error`).
- **Root cause**: Toast styling grew independently of the shared severity tokens; the icon association is the only genuinely local concern.
- **Impact**: Maintainability — a palette/opacity change must be made in 3 places and the `critical`/`error` key mismatch invites drift.
- **Fix sketch**: Derive border/bg from the central severity token map and keep only the `icon`/`iconColor` association local (a small `Record<severity, LucideIcon>`), normalizing the `critical`↔`error` key.

## 6. useAthenaHealth leaves stale error flag during reload
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/overview/sub_observability/libs/useAthenaHealth.ts:19-30
- **Scenario**: `load()` sets `loading = true` but does not reset `error`. After a failed fetch (`error = true`), a subsequent `reload()` (or filter change) keeps `error === true` for the entire in-flight window, so the panel renders an error state simultaneously with the loading state until the new promise resolves.
- **Root cause**: `error` is only cleared on the success path, not at request start.
- **Impact**: UX — momentary contradictory panel state (error + spinner) on retry; a retry that is about to succeed still flashes the error surface.
- **Fix sketch**: Add `setError(false)` at the top of `load()` alongside `setLoading(true)`.
