# Code Refactor Fix Wave 2 — Resolve Diverged Near-Copies

> 6 atomic commits, 6 findings closed (plus 2 same-theme follow-throughs folded into W2.3).
> ~3,975 LOC of duplicated/dead code removed across 5 feature areas, plus 1 real cross-persona prompt-leak fix landed in production code path.
> Baseline preserved: tsc 0 → 0 errors; tests 1086/1087 → 1086/1087 (the one pre-existing failure in `useMatrixBuild.test.ts:244` is unrelated to this wave).

## Commits

| # | Commit | Findings closed | Files | Net LOC |
|---|---|---|---|---:|
| 1 | `087aac39` | agent-tools-connectors #2 / health-validation-network #2 | 1 deleted | -25 |
| 2 | `3bbff03b` | agent-chat-tool-runner #1 | 3 (1 mod + 2 deleted) | -177 |
| 3 | `7bc88abb` | agent-chat-tool-runner #2 + #6 | 28 (3 mod + 20 deleted + 5 retargeted imports) | -2,928 |
| 4 | `8b09aca8` | agent-chat-tool-runner #4 | 4 (3 mod + 1 deleted) | -71 |
| 5 | `4b47fd72` | agent-editor-config #1 + #2 (CRITICAL — security fix ported) | 7 (2 mod + 5 deleted) | -661 |
| 6 | `40160a0b` | health-validation-network #4 | 2 modified | -7 |
|   | **Total** | | | **-3,869** |

## What was fixed (grouped by sub-pattern)

1. **Stale-top-level vs barrel-pointed twin (`HealthTab.tsx`)** — `sub_health/HealthTab.tsx` (25 LOC) was a stale copy missing a stale-data auto-refresh `useEffect` and an `aria-hidden` a11y attribute that `sub_health/components/HealthTab.tsx` (46 LOC) had. The barrel `index.ts` already re-exported the live one. **Pure delete-the-loser** — no port needed.

2. **Decomposed canonical vs monolithic shadow (`ExecutionDetail`)** — `detail/ExecutionDetail.tsx` (50 LOC, decomposed) was the modal's direct import; `components/detail/DetailSteps.tsx` (175 LOC monolith) was reached via the index barrel through a `components/list/ExecutionDetail.tsx` shim. Same execution rendered with different UIs depending on the entry point. **Switched the barrel to point at the decomposed copy and deleted the shim + monolith.**

3. **Whole-tree shadow (`replay/` + `components/replay/` + `components/detail/`)** — Two parallel trees (10 + 12 + 7 files), only the `replay/` and `detail/inspector/` paths actually wired to the canonical `detail/ExecutionDetail`. The `components/detail/TraceInspector.tsx` (243 LOC) had **richer live-trace-merge logic** that the canonical `detail/inspector/TraceInspector.tsx` (112 LOC) lacked. **Ported the EXECUTION_TRACE_SPAN listener / unified-trace merge into `useTraceData` first**, then deleted the doomed trees. Side cleanup: 4 stale barrel re-exports dropped from `sub_executions/index.ts`. Folded in finding #6 (`replay/ReplayHelpers.ts` dead — except actually had 3 in-tree importers; the audit's "zero importers" claim was wrong; the dedup target `libs/useReplayState.ts` was correct, repointed the 3 sites and then deleted).

4. **Hardcoded-English vs i18n-aware twin (`runnerHelpers.ts` vs `runnerTypes.tsx`)** — Both defined the same six exports; `runnerTypes.tsx` was a strict superset that added a `labelKey` field to `PHASE_META` for i18n. **Phase labels in `RunnerStreamView` were never translated, while `HealingCard`/`ExecutionSummaryCard` were.** Switched 3 consumers to `runnerTypes`, deleted `runnerHelpers.ts`.

5. **Drifted-twin safety regressor (`ModelABCompare`) — CRITICAL** — The flat root-level `sub_model_config/{ModelABCompare,ComparisonResults,CompareMetricCards,CompareOutputPreviews,compareModels}` (5 files, ~600 LOC) was the DEAD copy, but **someone kept improving it** thinking it was canonical. The dead copy accumulated three real safety improvements: (a) a persona-switch reset effect that cancels in-flight runs and clears `lastResults` on persona navigation — without it, an in-flight A/B compare for persona A could leak prompts/results into persona B's panel; (b) `aggregateResultsDetailed` + `missingModels` warning UI; (c) `capturePersonaToken`-based persona-staleness guard in `handleStart`. **Ported all three improvements into the live `components/compare/ModelABCompare.tsx`, moved `aggregateResultsDetailed` + `AggregateResult` into `libs/compareHelpers.ts`, then deleted the 5 dead files.** `capturePersonaToken` already existed at `src/lib/personas/personaToken.ts` — just imported into the live file.

6. **Hook/slice parser drift (`mapOverallStatus` + feasibility parsing)** — Same logic in `useHealthCheck.ts` and `healthCheckSlice.ts`, drifted in 3 ways: (a) hook used deterministic `makeIssueId()` (FNV-64), slice used non-deterministic `digest_${Date.now()}_${issueSeq++}` — same issue got different IDs from different paths, breaking `markIssueResolved` cross-screen identity; (b) hook had `coerceIssueText()` for non-string IPC entries, slice did `.map((text) => ...)` with `[object Object]` render risk; (c) hook ran `generateHealthProposal()`, slice always set `proposal: null` (intentional digest semantic). **Hoisted `mapOverallStatus`, `coerceIssueText`, `parseFeasibilityToHealthResult` as named exports from `useHealthCheck.ts` (pure functions, no React deps); slice now calls the shared parser with `withProposals: false` to preserve the digest semantic. Dropped the slice's `issueSeq` counter entirely.**

## Verification table (before/after)

| Gate | Before Wave 2 | After Wave 2 | Delta |
|---|---:|---:|---|
| `npx tsc --noEmit` | 0 errors | 0 errors | unchanged ✓ |
| `npx vitest run` | 75/75 files | 75/75 files | unchanged |
| Tests passing | 1086/1087 | 1086/1087 | unchanged (1 pre-existing `useMatrixBuild.test.ts:244` failure — `handleAnswer` widened to 4 args, test still asserts 2; not Wave 2) |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed | Net LOC |
|---:|---|---:|---:|
| 1 | Delete orphan islands | 7 | -5,030 |
| 2 | Resolve diverged near-copies | 6 + 2 same-theme | -3,869 |
| **Total** | | **15** | **-8,899** |

## Patterns established (additions to the catalogue, items 6-9)

6. **Drifted-twin safety regressor** — When two parallel implementations exist and one is "older" / "deprecated" / "soon to be deleted," contributors paradoxically tend to improve *that* copy because their natural pattern-match ("this is the file my colleague edited last") points them at the wrong file. Real safety improvements (cross-persona prompt-leak fix, IPC coercion, deterministic IDs) accumulate in the dead copy while the live exported copy stagnates. **Detection:** when you find two files with the same name and similar shape, check `git log --follow` on each — if the "deprecated" copy has more recent commits than the "live" one, the deprecated copy has accumulated value that needs porting before delete. **Don't blind-delete dead copies** without checking.

7. **Hook/store parser drift** — The same parsing logic in (a) a React hook and (b) a Zustand slice or other React-free runner. Hook gets richer over time; slice lags. **Detection:** any function name that appears in both `hooks/` (or `features/.../use*`) and `stores/slices/` paths is suspect. **Resolution:** hoist the parser as a pure exported function from the hook module (NOT into a separate "helpers" file unless it'd otherwise transitively pull React in) and call it from both sides. The boundary safety is "no React imports in the exported function" — verify by tracing imports before lifting.

8. **Non-deterministic ID accumulator across two paths** — Two code paths mint IDs for the same logical entity, one deterministic (FNV / hash of inputs) and one non-deterministic (`Date.now()_${seq++}` / `crypto.randomUUID()`). Cross-screen actions like "resolve issue" silently fail to match because the same issue gets different IDs depending on which path generated it. **Detection:** any ID generator using `Date.now()` or a module-level incrementing counter, especially when a sibling file uses a hash. **Resolution:** pick the deterministic one universally — drop the counter; have callers use the same `make<Type>Id(...)` everywhere.

9. **Barrel re-export decay** — As code consolidates around fewer canonical files, barrel `index.ts` re-exports of intermediate paths can become stale but tsc-valid. The symbol gets exported from the barrel, but no external file consumes it from the barrel — every external import goes through deep paths. **Detection:** for every line in `index.ts`, grep `from '<barrel-path>'` project-wide — if no consumer pulls that symbol from the barrel, it's contract that isn't real contract. **Resolution:** drop the line. If someone needs it later, they can deep-import. Keeping stale re-exports masks dead-code detection because the barrel re-export looks like a "use" of the underlying file.

## What remains

- **Wave 3** — Delete smaller dead-component subtrees (≈7 findings, mechanical follow-through of Wave 1's pattern). Some Wave 1 deletes already exposed adjacent dead surface; these clean up the rest.
- **Wave 4** — Dead API exports + reachability bombs + half-shipped seams (≈6 findings)
- **Wave 5** — Cross-cutting duplicate primitives (≈6 findings, `safeInvoke` + `timeAgo` + `TRIGGER_ICONS` etc.)
- **Wave 6** — Dead barrels + misnamed files + boundary blur (≈7 findings, Pattern 9 catalogued in Wave 2 will guide here)
- **Wave 7** — i18n leaks + naming/structure cleanup (≈6 findings, optional)
