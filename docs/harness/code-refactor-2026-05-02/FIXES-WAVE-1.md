# Code Refactor Fix Wave 1 — Delete Orphan Islands

> 7 atomic commits, 7 findings closed.
> ~5,030 LOC of dead code removed across 6 feature areas, plus 1 doc + 1 harness scope-list update.
> Baseline preserved: tsc 1 → 0 errors (the dead `useToolImpactData.test.ts` was the source); tests 1086/1087 → 1086/1087 (one pre-existing failure unrelated to this wave).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `5a05b45d` | agent-tools-connectors #1 | high | sub_tools/ (17 deleted) + AGENTS.md + scenario-parser.ts |
| 2 | `5e1ada0b` | credentials-keys #1 | high | wizard/ (7 deleted) + provisioningWizardStore.ts + SidebarLevel2.tsx + useCredentialManagerState.ts |
| 3 | `82c55244` | credentials-keys #2 | high | autopilot/ (9 deleted) + api/vault/openapiAutopilot.ts |
| 4 | `1c742ce5` | connector-catalog #1 | high | 6 Universal AutoCred files + autoCred/steps/index.ts + useCredentialDesignModal.ts |
| 5 | `f0b60c30` | triggers-schedules #1 | high | 20 sub_builder/ files (canvas/nodes/edges/palettes/templates/hooks/libs subset) |
| 6 | `334935cf` | onboarding-home #1 | high | IconShowcase + CustomIcons + iconData + iconStyles (4 deleted) |
| 7 | `4c93b1b6` | agent-lab-matrix #3 / deployment-sharing-plugins #1 | high | src/features/composition/ (2 deleted) |

## What was fixed (grouped by sub-pattern)

1. **The "feature retired, files left behind" island** (`sub_tools/`, provisioning wizard, OpenAPI autopilot, Universal AutoCred, React-Flow event-canvas, IconShowcase). In each case a feature was retired or replaced — the rendering site was rewired to the new path, but the supporting code was never deleted. Project-wide grep confirmed zero external consumers in every case before delete.

2. **Defensive ghost-fighting effects.** `useCredentialManagerState.ts:64-70` had a `useEffect` literally watching `wizardPhase !== 'closed'` to force-close a store with the comment `// Wizard was removed`. The effect existed because the store survived but the consumer was deleted. Fix: delete both the store and the effect. **Heuristic: when you see a defensive effect with a "X was removed" comment, X is almost certainly an orphan island.**

3. **Half-shipped feature seams.** `showUniversal`/`setShowUniversal` was managed in `useCredentialDesignModal` and returned from the hook, but no consumer ever read it — the modal body branch that would render `<UniversalAutoCredPanel>` was never added. **Heuristic: if state is set/returned but never consumed, the consumer was never built (or was deleted) — the feature is dead.**

4. **Closed-cycle islands resistant to unused-export linters.** The home/ icon files (`IconShowcase` ← `iconData` ← `CustomIcons`, plus `iconStyles`) form a closed reference cycle. Each file has internal users, so a naive "find unused export" check passes for every file individually. Only project-wide search by symbol name reveals the whole cluster is unreachable. Same pattern in `src/features/composition/index.ts` (re-exports) → `libs/dagUtils.ts` (defines): the barrel re-exports look like consumers, masking that nothing reaches the barrel either.

5. **Dead test as baseline-error source.** `useToolImpactData.test.ts` was failing tsc the entire time (it was inside a dead subtree, exercising a hook no UI calls). Deleting the dead subtree improved the project's tsc baseline from 1 → 0. **Heuristic: when the tsc baseline is small (1-3), check whether the failing files are inside a dead subtree before assuming they're real bugs.**

6. **Cross-context orphan detection.** `src/features/composition/` was independently flagged by both the agent-lab-matrix scanner (finding #3) and the deployment-sharing-plugins scanner (finding #1). Two contexts independently surfacing the same orphan is a strong signal — the module's exports were "expected" by their importers but no actual import landed. Worth recording as a single fix that closes two findings.

7. **Live code with stale documentation.** `AGENTS.md` had a row for `sub_tools` ownership, a "Why tool-credential gating is in `sub_tools`" section, and a parenthetical citing it as a refactor cautionary tale. Once the directory was gone, all three became misleading — the doc claims a module exists when it doesn't. Same for `scenario-parser.ts` listing `sub_tools/` in two harness scope arrays. Fixing these alongside the delete keeps the doc/code synced atomically.

## Verification table (before/after)

| Gate | Before Wave 1 | After Wave 1 | Delta |
|---|---:|---:|---|
| `npx tsc --noEmit` | 1 error | 0 errors | **-1** (improved — dead test was the source) |
| `npx vitest run` (file count) | 75 | 75 | unchanged |
| `npx vitest run` (test count) | 1087 | 1087 | unchanged |
| Tests passing | 1086 | 1086 | unchanged (1 pre-existing failure in `useMatrixBuild.test.ts:244` — `handleAnswer` was widened to 4 args; test still asserts 2-arg call. Not from this wave; W1 did not touch matrix or hooks/build/.) |
| Files in repo (rough) | — | — | -84 deleted (sum of all 7 commits' `delete mode` lines) |

## Cumulative status (across all waves so far)

| Wave | Theme | Closed |
|---:|---|---:|
| 1 | Delete orphan islands | 7 |

## Patterns established (additions to the catalogue, items 1-5)

1. **Closed-cycle island** — Files that import each other in a closed cycle, with zero imports reaching in from outside. Each file passes "find unused" in isolation because it has internal consumers. **When it bites:** new contributors think the module is live; refactors waste cycles "improving" code nobody runs. **How to fix:** project-wide grep for every symbol the cycle exports — if all hits are inside the cycle, delete the whole cluster (don't try to delete individual files).

2. **Defensive ghost-fighting effect** — Live code that contains a `useEffect` (or guard, or default) whose only purpose is to fight against a state another part of the codebase produces. Often signed with a comment like `// X was removed`. **When it bites:** every reader of the live module wonders "why is this effect here?" — the answer is "because of code that no longer exists." **How to fix:** the comment is the smoking gun. Delete the store/component the effect is defending against, then delete the effect.

3. **Half-shipped feature seam** — A toggle, a state, or a setter that's wired through a hook and returned from its API, but no consumer reads it. The producer side of a feedback loop was built, the consumer was never built (or was deleted). **When it bites:** debugging "why doesn't X happen?" leads readers to the wired-but-unrendered toggle. **How to fix:** trace `setX(...)` to confirm the producer is alive but `X` reads only from inside the hook itself — then delete the entire toggle and any orphan render branches that were waiting for it.

4. **Catalog vs barrel masquerade** — A barrel `index.ts` re-exports symbols. The barrel has consumers (live), but those consumers only import a SUBSET of the re-exports — and the unused re-exports point at fully-orphaned files. The barrel makes the unused exports look "consumed by the barrel itself," masking deadness. **When it bites:** dead-code detection skips them because the barrel re-export is technically a "use." **How to fix:** for every barrel re-export, grep for the re-exported symbol — if no live consumer imports it, delete the re-export AND the underlying file together.

5. **Test-file baseline poison** — A test file inside an orphan subtree continues to count toward the project's tsc baseline. The test still passes (it's exercising real code), but the underlying code is dead and the test is propping up an outdated tsc-error count. **When it bites:** "Wave N's diff broke the tsc baseline" looks scary, but the baseline was wrong; fixing dead-tests-first reveals which baseline failures were always invisible. **How to fix:** before any baseline-vs-current comparison after a delete pass, confirm whether deleted tests were contributing to the prior count. Don't chase phantom regressions.

## What remains

After Wave 1 the remaining themes from the INDEX:

- **Wave 2** — Resolve diverged near-copies (≈6 findings, requires careful diff-and-port; one of these has a real cross-persona prompt-leak fix sitting in dead code)
- **Wave 3** — Delete smaller dead-component subtrees (≈7 findings, mechanical follow-through of Wave 1's pattern)
- **Wave 4** — Dead API exports + reachability bombs + half-shipped seams (≈6 findings)
- **Wave 5** — Cross-cutting duplicate primitives (≈6 findings, `safeInvoke` + `timeAgo` + `TRIGGER_ICONS` etc.)
- **Wave 6** — Dead barrels + misnamed files + boundary blur (≈7 findings)
- **Wave 7** — i18n leaks + naming/structure cleanup (≈6 findings, optional)
