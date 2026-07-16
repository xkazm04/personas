# shared (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 1 findings (0 critical / 0 high / 1 medium / 0 low)
> Context group: Shared UI & Design System | Files read: 1 | Missing: 0

## 1. Two unrelated exported components named `LazyChart` (bundle-split wrapper vs viewport-defer skeleton)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: naming-collision
- **File**: src/features/shared/charts/RechartsWrapper.tsx:27
- **Scenario**: A developer adding a chart imports `LazyChart` via editor auto-import and gets the wrong one: `src/features/shared/charts/RechartsWrapper.tsx` exports `LazyChart` (render-prop code-splitting wrapper around the recharts chunk), while `src/features/overview/sub_usage/components/LazyChart.tsx` exports a same-named but completely different component (IntersectionObserver viewport-deferral skeleton with `height`/`children` props). Both are live and used across the overview features.
- **Root cause**: The recharts code-splitting wrapper reused the name `LazyChart` that already existed for the viewport-defer component, and neither was renamed when both became shared-ish utilities.
- **Impact**: Real maintenance hazard: wrong auto-import compiles only after prop errors surface, greps for `LazyChart` return two unrelated concepts, and the useElementVisible hook's doc comment ("Unlike LazyChart…") is already ambiguous about which one it means.
- **Fix sketch**: Rename the shared wrapper's export to `RechartsChart` (or `LazyRecharts`) to match its file `RechartsWrapper.tsx`, or rename the sub_usage component to `DeferredChart`/`ViewportDeferred`. Update the ~9 consumer imports mechanically and fix the reference in `src/hooks/utility/useElementVisible.ts` doc comment. No behavior change; tsc catches all call sites.

Notes (no finding warranted): the wrapper itself is well-designed — single shared recharts chunk, render-prop API documented with the reason (recharts child-identity checks break under per-component `lazy`), and a repo-wide grep confirms zero direct `import ... from 'recharts'` outside this file, so the payload/bundle discipline it exists for is intact.
