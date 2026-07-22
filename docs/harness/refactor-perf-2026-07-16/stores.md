# stores — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 14 | Missing: 0

## 1. useScaledFontSize returns a new closure every render, defeating downstream useMemo in 6 chart components
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/stores/themeStore.ts:111
- **Scenario**: `useScaledFontSize()` returns `(basePx) => Math.round(...)` as a fresh function on every render. Consumers (verified: `src/features/overview/sub_observability/components/MetricsCharts.tsx:55-56`, plus 5 other chart files) do `useMemo(() => ({ fontSize: sf(10), ... }), [sf])` — since `sf` changes identity each render, those memos recompute every render and hand Recharts new tick/legend style objects, invalidating Recharts' own prop-equality checks on dashboards that re-render frequently (polling metrics widgets).
- **Root cause**: The hook closes over the multiplier without stabilizing the returned function; `sf` is only semantically dependent on `textScale`, which changes rarely.
- **Impact**: Every `useMemo([sf])` across 6 chart components is a no-op memo; Recharts receives new object props each parent render, causing avoidable subtree reconciliation on the most render-heavy screens (Overview activity/observability).
- **Fix sketch**: Stabilize the closure inside the hook: `const m = useThemeStore((s) => TEXT_SCALE_MULTIPLIERS[s.textScale]); return useCallback((basePx) => Math.round(basePx * m * 10) / 10, [m]);`. No consumer changes needed — their `[sf]` deps then only invalidate when the text scale actually changes.

## 2. notificationCenterStore serializes the full 50-item list to localStorage synchronously on every mutation, including per-item markRead
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src/stores/notificationCenterStore.ts:71
- **Scenario**: Each `addNotification`/`addProcessNotification`/`markRead`/`dismiss` runs `JSON.stringify` over up to 50 notifications (each carrying title/message/url strings) and a synchronous `localStorage.setItem` on the main thread. Bursts happen: the event bridge fires process notifications for executions, scans, matrix builds, and team assignments; opening the notification center and marking several read fires one full serialize+write per item.
- **Root cause**: Persistence is coupled 1:1 with every state transition instead of being debounced/batched; there is no coalescing for rapid successive writes.
- **Impact**: Bounded (50 items) but repeated main-thread JSON+storage work during event bursts and while interacting with the center — jank risk stacked on top of the UI updates those same events trigger.
- **Fix sketch**: Debounce the persist: keep `set(...)` immediate, but route `saveNotifications` through a trailing-edge debounce (~250ms) shared by all mutations, flushing on `pagehide`/`beforeunload`. Alternatively adopt zustand `persist` with `createDedupedJSONStorage()` like the sibling stores, which already dedupes identical writes.

## 3. authStore's extractError duplicates errMsg from storeTypes one directory away
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/authStore.ts:15
- **Scenario**: `extractError` (Error → message, `{error}` object → String(error), else String(err)) reimplements the shared `errMsg` helper in `src/stores/storeTypes.ts:68` that every slice already uses (20 usages across 7 store files).
- **Root cause**: authStore predates or bypassed the shared error-helper consolidation; the local copy also drops the structured `isTauriError` branch that `errMsg` handles.
- **Impact**: Two parsers for the same Tauri IPC error shape can drift — `errMsg` already gained `isTauriError` handling that `extractError` lacks, so auth errors from structured `AppError`s stringify slightly differently than everywhere else.
- **Fix sketch**: Delete `extractError` and call `errMsg(err, 'Authentication failed')` (import from `./storeTypes`) in `loginWithGoogle`/`logout`. Behavior converges with the rest of the app and structured Tauri errors get the same treatment.

## 4. notificationCenterStore repeats the save-and-recount block in all six mutations and stores derived unreadCount
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/stores/notificationCenterStore.ts:123
- **Scenario**: All six actions (`addNotification`, `addProcessNotification`, `markRead`, `markAllRead`, `dismiss`, `clearAll`) hand-roll the same tail: `saveNotifications(updated); set({ notifications: updated, unreadCount: updated.filter((x) => !x.read).length })`. `unreadCount` is pure derived state kept in sync by convention.
- **Root cause**: No shared commit helper; derived value stored instead of selected.
- **Impact**: Any future mutation must remember both the persist call and the recount — forgetting either silently desyncs the badge or loses history across restarts. Six near-identical blocks pad the file.
- **Fix sketch**: Add a private `commit(updated: PipelineNotification[])` that persists and sets both fields, and rewrite each action as a pure list transform passed to it. Optionally drop the stored `unreadCount` in favor of a `selectUnreadCount` selector (mirrors `selectAnyImproveRunning` in improveActivityStore); keep the stored field only if a consumer needs it outside React.
