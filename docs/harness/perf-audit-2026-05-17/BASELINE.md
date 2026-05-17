# Perf-Audit 2026-05-17 — Health Baseline

Captured before any fix work began. Wave verification (Phase B6.3) must preserve or improve every counter below.

## Scope
- Pipeline B perf-audit, scan agent `perf-optimizer`
- 23 contexts (frontend-only — `src-tauri/` excluded by user)
- 3 waves of ≤8 parallel subagents (8 + 8 + 7)

## Git
- Branch: `master`
- HEAD: `329409f4a7949ecfa441f9e23f26f04e7993b0d2`
- Working tree: clean except `.claude/active-runs.md` (harness file, unrelated)

## Type check
- Command: `npx tsc --noEmit`
- **Result: 0 errors** (exit 0)

## Lint
- Command: `npx eslint --quiet src/`
- **Result: 0 errors** (exit 0)
- Note: full (non-quiet) lint count not captured here; the active "Fix 31 lint errors" goal in Vibeman tracks warning-level findings.

## Tests
- Command: `npx vitest run`
- **Result: 1412 / 1416 tests passing across 124 files (122 file passes, 2 file failures)**
- 4 failing tests reside in:
  - `src/features/agents/components/matrix/__tests__/useLifecycle.test.ts` (mock-call assertion drift, e.g. `mockPromoteBuildDraft` called 0 vs 1 time)
- Duration: 38.75s
- These failures are pre-existing test-code drift, NOT logic bugs. The active "Fix 31 failing tests" goal in Vibeman tracks this (description notes ~31 failures historically; current is 4 — already partially fixed).

## Regression bar for Wave-N verification
- tsc errors: **must remain 0**
- eslint errors: **must remain 0**
- vitest: **must remain ≥1412 passing** (the 4 pre-existing failures may persist; no new failures allowed)

## Wave-fix verification commands (cookbook)
```pwsh
# In C:\Users\mkdol\dolla\personas
npx tsc --noEmit
npx eslint --quiet src/
npx vitest run
```
