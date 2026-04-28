# Ambiguity Audit — Fix Wave 1: Two-X-coexist (libs/ duplicates)

> 3 commits, 3 critical findings closed.
> Baseline preserved: tsc 0 errors → 0 errors; vitest 241 passed in agents+stores → 241 passed.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `53061f69` | `agent-chat-tool-runner.md` #1 | critical | `sub_tool_runner/libs/useToolRunner.ts` (modified), `sub_tool_runner/useToolRunner.ts` (deleted) |
| 2 | `8e524454` | `agent-tools-connectors-use-cases.md` #1 | critical | `sub_tools/libs/useToolImpactData.ts` (header only) |
| 3 | `27f0aa3d` | `agent-tools-connectors-use-cases.md` #2 | critical | `sub_tools/libs/useToolSelectorActions.ts` |

## What was fixed (grouped by sub-pattern)

1. **Genuine duplicate (`useToolRunner`).** The audit's headline finding was a real two-files-one-name in tree: `sub_tool_runner/useToolRunner.ts` (the protected version with personaId-tagged state, defense-in-depth getState check, 120s IPC timeout, and a surfaced "no active persona" error) sat next to `sub_tool_runner/libs/useToolRunner.ts` (a thinner version with only a runningRef double-click dedupe and silent no-ops on missing persona). `ToolRunnerPanel` and the feature's `index.ts` both imported from `libs/`, so the protected version was dead code and cross-persona result bleed + hung-IPC stuck-spinner were both reachable. Resolved by merging the union of safety guarantees into `libs/useToolRunner.ts` (the canonical home) and deleting the unused top-level. The merged hook keeps the runningRef dedupe, the synchronous personaId ref update (avoiding commit-vs-effect skew — see commit 18e6080d for the original fix that the libs/ version had reverted), the personaId-tagged state, the defense-in-depth getState check, the surfaced missing-persona error, and the 120s IPC timeout. Consumers needed no change.

2. **Phantom duplicate (`useToolImpactData`).** The audit reported divergent cost/co-occurrence math between a libs/ and a top-level file, but the live tree only contains the libs/ copy — the top-level twin exists in worktrees but not in main. The literal "delete the duplicate" fix did not apply, but the *risk that a future refactor reintroduces the split* is a real and documented pattern in this codebase (the `useToolRunner` finding above is exactly that shape). Closed by adding a module-level header that explicitly marks the libs/ file as canonical and forbids a sibling copy. Pure documentation; no behavior change. The existing 6 unit tests in `useToolImpactData.test.ts` still pass.

3. **Phantom duplicate hiding a real persona-safety bug (`useToolSelectorActions`).** Like #2, the live tree only contains the libs/ file — the top-level "useToolSelectorState" the audit referenced isn't in main. But the audit's *underlying* concern was a correctness bug in the surviving file: the undo toast stored only `{toolId, toolName}` and `handleUndo` closed over the live `personaId` prop. A persona switch between remove and undo (in the brief window before the persona-switch useEffect dismisses the toast) would route the undo to the new persona, silently re-adding the tool to the wrong agent. No test caught this because the hook's exported shape was identical. Resolved by capturing `personaId` at the moment of removal in the toast state itself and having `handleUndo` route by that captured id rather than the live prop. The existing useEffect that auto-dismisses the toast on persona switch remains as a UX safeguard, but the captured-id shape is now the authoritative correctness guarantee.

## Verification table (before / after)

| Counter | Before Wave 1 | After Wave 1 |
|---|---:|---:|
| `tsc --noEmit` errors | 0 | 0 |
| Tests passing (agents + stores) | 241 / 241 | 241 / 241 |
| Tests passing (`useToolImpactData.test.ts`) | 6 / 6 | 6 / 6 |
| Live duplicate hooks (audit theme A) | 1 (useToolRunner) | 0 |
| Phantom duplicates with real underlying bug | 1 (useToolSelectorActions) | 0 |
| Files declaring "this is canonical" for the patterns | 0 | 2 |

## Cumulative status (waves so far)

| Wave | Theme | Findings closed | Commits | Lines net |
|---|---|---:|---:|---:|
| 1 | Two-X-coexist (libs/ duplicates) | 3 critical | 3 | +123 / -148 net |
| 2 | Silent failure / lying state | (pending) | — | — |
| 3 | Cross-entity scoping | (pending) | — | — |

## Patterns established (additions to the catalogue, items 1-3)

1. **Two-X-coexist** — when a hook lives in both `feature/X.ts` and `feature/libs/X.ts`, treat the layout as a refactor in flight. Pick canonical (almost always the consumer-imported one), merge the union of safety guarantees into it, delete the other. Add an `@canonical` module header so the next refactor doesn't recreate the split.
2. **PersonaId-snapshot on async actions** — any callback that closes over a "current persona" prop AND awaits something (IPC, store action, network) MUST snapshot the persona at call time and re-key all post-await writes by the snapshot. The render-time prop is a moving target; closing over it lets a fast user switch reroute the operation to the wrong entity. Applies equally to teamId / runId / sessionId.
3. **Dedupe ref with persona-scoped clear** — when using a `runningRef` to dedupe rapid double-clicks, clear it in the same effect that clears persona-scoped state. Otherwise the new persona inherits the previous persona's "currently running" set and the first run for the new persona silently no-ops.

## What remains

- **Wave 2** (Silent failure / lying state) — 6-7 fixes from the 10 critical findings in theme B: `saveAll` / `checkSinglePersona` / clipboard wipe / `isThrottled` sticky-true / pipeline-events drop on team mismatch / BYOM open-access default / ConfigResolutionPanel fake loading.
- **Wave 3** (Cross-entity scoping) — 4 fixes: `enrichProcess` ignores `runId`, `pickNextActiveSessionId` ignores `personaId`, experiment poll vs realtime race, `hydrateBuildSession` discards lifecycle fields.
- **Out of scope this session** — themes D (validation gates), E (state/cache invalidation), F (sanitization & cross-boundary contracts). Their findings remain documented in the per-context reports.
