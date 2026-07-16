# api (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Core Libraries & State | Files read: 14 | Missing: 0

## 1. researchLab.ts hand-mirrors 8+ types that already exist as generated ts-rs bindings
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/api/researchLab/researchLab.ts:7
- **Scenario**: The file opens with "mirrors Rust models — ts-rs will auto-generate these at build time", and ts-rs HAS generated them: `src/lib/bindings/ResearchProject.ts`, `ResearchSource`, `ResearchHypothesis`, `ResearchExperiment`, `ResearchFinding`, `ResearchReport`, `ResearchDashboardStats`, `ResearchExperimentRun` all exist and are field-for-field identical (verified `ResearchProject`). Yet ~180 lines of hand-written interfaces remain and are what callers actually import.
- **Root cause**: The bindings landed after the API file was written and the hand-written mirrors were never swapped out — every other API file in this context (skills, twin, recipes, enclave, identity, teamPresets) already imports from `@/lib/bindings/*`.
- **Impact**: Two sources of truth for the same wire contract. Any Rust model change updates the binding silently while the hand-written interface drifts, producing type-checked-but-wrong frontend code (the exact failure class the bindings exist to prevent).
- **Fix sketch**: Replace each hand-written interface with `export type { X } from "@/lib/bindings/X"` (the twin.ts re-export pattern). Keep only genuinely frontend-local types (`CreateSourceResult` if no binding exists, the `Create*` input shapes if their bindings differ). Delete the "ts-rs will auto-generate" comment once true.

## 2. Dead exports: getMessagingMetrics (repeat offender) and the unused FEEDBACK_LABELS/getFeedbackLabels pair
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/api/network/discovery.ts:128
- **Scenario**: Repo-wide grep (excluding node_modules) finds `getMessagingMetrics` only at its definition — the store consumes messaging metrics via `getNetworkSnapshot().messagingMetrics` (networkSlice.ts:539). The 2026-07-10 scan flagged this exact export (alongside `getConnectionHealth`, which WAS removed); this one survived the cleanup wave. Similarly, `templateFeedback.ts:27,39` — `getFeedbackLabels` and the pre-resolved `FEEDBACK_LABELS` ("backward-compatible direct access") have zero callers outside their own file.
- **Root cause**: Wrappers kept "for symmetry" after the snapshot endpoint superseded per-metric calls; the FEEDBACK_LABELS back-compat shim outlived every consumer it was compatible with.
- **Impact**: Dead API surface invites new one-off IPC round-trips that duplicate snapshot data, and the templateFeedback shim eagerly builds a resolved-label record at module load for nobody. Also the second scan in a row to carry this finding — it will keep re-surfacing until deleted.
- **Fix sketch**: Delete `getMessagingMetrics` from discovery.ts. In templateFeedback.ts delete `FEEDBACK_LABELS`; if no external caller of `getFeedbackLabels` materializes on a final grep (components may resolve labels straight from `t.feedback_labels`), delete it and `FEEDBACK_LABEL_KEYS` too, or keep only the function if a feedback UI is about to consume it. Run tsc to confirm nothing dynamic breaks.

## 3. recipes.ts: duplicated section header with an empty first occurrence
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/api/recipes/recipes.ts:76
- **Scenario**: Lines 76–78 declare a "Use Case <-> Recipe Connection" banner with no code under it, immediately followed by the "Recipe Versioning" banner; the same "Use Case <-> Recipe Connection" banner appears again at lines 110–112 above the actual `promoteUseCaseToRecipe`.
- **Root cause**: A function was moved to the bottom of the file and its section banner was left behind at the original location.
- **Impact**: Misleading navigation — a reader landing at line 76 concludes the use-case connection surface is empty/removed. Pure noise otherwise.
- **Fix sketch**: Delete the empty banner at lines 76–78.

## Perf lens — no findings

All 14 files are thin single-`invoke` IPC wrappers with no loops, subscriptions, or render-path code. The only non-trivial computation is `validateKeyFactsJson` in twin.ts (TextEncoder + JSON.parse capped at 64 KB, once per user-triggered interaction) — bounded and deliberate as a trust-boundary check. `teamPresets` read-fresh-from-disk per call is documented as an intentional trade-off on a cold path. Nothing above micro-optimization threshold.
