# Code Refactor Pipeline — Final Summary

> 7 waves complete. **46 findings closed across 41 atomic commits.**
> ~**13,771 LOC removed** from the personas TS/TSX surface (`src-tauri/` Rust intentionally descoped throughout).
> 1 real production bug fix landed (`devTools.ts` `safeInvoke` substring check), 1 cross-persona prompt-leak fix landed in `ModelABCompare`.

## Quality gate at end of wave 7

| Gate | Pre-Wave-1 baseline | After Wave 7 | Delta |
|---|---:|---:|---|
| `npx tsc --noEmit` | 1 error (in dead `useToolImpactData.test.ts`) | 0 errors | -1 ✓ |
| `npx vitest run` files | 75 | 76 | +1 (new safeInvoke regression test) |
| Tests passing | 1086 / 1087 | 1090 / 1091 | +4 / +4 |
| Failing tests | 1 (`useMatrixBuild.test.ts:244`) | 1 (same — pre-existing, `handleAnswer` widened to 4 args) | unchanged |

## Wave-by-wave totals

| Wave | Theme | Findings | Net LOC | Notable |
|---:|---|---:|---:|---|
| 1 | Delete orphan islands | 7 | -5,030 | sub_tools, provisioning wizard, OpenAPI autopilot, Universal AutoCred, React-Flow event-canvas, IconShowcase, composition |
| 2 | Resolve diverged near-copies | 8 | -3,869 | **Cross-persona prompt-leak fix landed** in canonical `ModelABCompare` (was sitting in dead code) |
| 3 | Smaller dead-component subtrees | 7 | -3,670 | EventSubscriptionSettings, BuildReviewPanel, detail/views/Execution*, CredentialCard chain (14 files), HealthStatusBar trio, SetupGuideModal |
| 4 | Dead APIs + reachability bombs | 6 | -692 | 9 network/identity/exposure exports, validation.ts, OCR API, revocation simulator workflow branch, buildSessionEnricher, PreRunPreview |
| 5 | Cross-cutting duplicate primitives | 6 | +65 | **Real bug fixed**: `devTools.ts` `safeInvoke` substring check (was swallowing real `dev_tools_*` errors); `safeInvoke` consolidated to `lib/utils/tauri/` with vitest regression test |
| 6 | Dead barrels + boundary blur | 7 | -96 | Dropped 16 dead barrels; `gitlab/` → `plugins/gitlab/`; `api/templates/` files split into `api/{recipes,design,discovery,skills,platforms}/` |
| 7 | i18n leaks + naming cleanup | 5 | -479 | SetupCards i18n'd; 4 dead overview namespaces dropped; templates `quickSetup`/`moderateSetup`/`involvedSetup` keys dropped; plugins `research-lab`/`twin` tile labels i18n'd; `CELL_FRIENDLY_NAMES` rewired to existing `templates.matrix.dim_*` keys |
| **Total** | | **46** | **-13,771** | |

## Pattern catalogue (durable findings across all waves)

These are shapes worth grepping for proactively in future audits. Each was repeated enough across the 150-finding scan to justify a wave-level fix discipline.

### From Wave 1
1. **Closed-cycle island** — Files import each other in a cycle, zero external imports. Each file passes "find unused" in isolation. Detection: project-wide grep for every symbol the cycle exports — if all hits are inside the cycle, delete the whole cluster. Examples: `home/IconShowcase` chain, `composition/`.
2. **Defensive ghost-fighting effect** — Live code containing a `useEffect`/guard whose only purpose is to fight against state another part of the codebase produces. Often signed with a comment like `// X was removed`. The comment is the smoking gun. Example: `useCredentialManagerState`'s defensive `wizardPhase !== 'closed'` effect.
3. **Half-shipped feature seam** — A toggle/state/setter wired through a hook and returned from its API, but no consumer reads it. Example: `showUniversal`/`setShowUniversal` in `useCredentialDesignModal`.
4. **Catalog vs barrel masquerade** — A barrel `index.ts` re-exports symbols. The barrel has consumers, but consumers only import a SUBSET — and the unused re-exports point at fully-orphan files. Example: `sub_executions/index.ts` re-exporting from `components/replay/` + `components/detail/`.
5. **Test-file baseline poison** — A test file inside an orphan subtree counts toward the project's tsc baseline. The test still passes, but the underlying code is dead. Deleting the dead subtree improves the baseline. Example: `useToolImpactData.test.ts` was the source of the 1-error tsc baseline.

### From Wave 2
6. **Drifted-twin safety regressor** — When two parallel implementations exist, contributors paradoxically tend to improve the "older / deprecated" one. Real safety improvements accumulate in the dead copy while the live exported copy stagnates. **Don't blind-delete dead copies — `git log --follow` each pair first.** Example: `ModelABCompare` cross-persona prompt-leak fix sat in dead code for an unknown duration.
7. **Hook/store parser drift** — Same parsing logic in (a) a React hook and (b) a Zustand slice. Hook gets richer over time; slice lags. **Resolution: hoist the parser as a pure exported function from the hook module** (verify it has no React deps before lifting), call it from both sides. Example: `mapOverallStatus` + `coerceIssueText` between `useHealthCheck` and `healthCheckSlice`.
8. **Non-deterministic ID accumulator across two paths** — Two code paths mint IDs for the same logical entity, one deterministic (FNV/hash) and one non-deterministic (`Date.now()_${seq++}`). Cross-screen "resolve" actions silently fail to match. Example: `digest_${Date.now()}_${issueSeq++}` in `healthCheckSlice` vs `makeIssueId()` (FNV-64) in the hook.
9. **Barrel re-export decay** — As code consolidates around fewer canonical files, barrel re-exports of intermediate paths can become stale but tsc-valid. Drop them when no external file imports the barrel-re-exported symbol. Example: 4 stale re-exports in `sub_executions/index.ts` (PipelineWaterfall, ReplaySandbox, TraceInspector, ExecutionInspector).

### From Wave 3
10. **Section-retirement comment marker** — When a code area carries a comment like `// X removed` or `// Y was deprecated`, that comment is the smoking gun that someone intended to delete X/Y but stopped halfway. Find X/Y and check if it actually shipped — almost always it's still in the tree. Detection: `grep -r "// .*\(removed\|deprecated\|deleted\)" src/`. Example: `// UseCaseSubscriptionsSection removed` in `PersonaConnectorsTab.tsx:10`.
11. **Filename-export mismatch as fuzzy-search hazard** — Files named after concepts that don't match what they export (e.g. `UseCaseTabHeader.tsx` exporting `UseCaseGeneralHistory`). Often a sign that a rename happened halfway. **These are usually dead code.** Detection: scan for files whose name doesn't contain any exported symbol.

### From Wave 4
12. **Always-passed-empty argument** — A function parameter is always called with `[]` or `null`/`undefined`. Half the function body becomes unreachable. The guarded branch keeps i18n strings, components, and rules alive that never execute. **Detection: function with default parameter handling that grep shows is always called with the default-shaped value.** Example: `simulateRevocation(workflows: Workflow[])` always called with `[]` — the `'critical'` severity branch + 5 i18n keys + entire `AffectedWorkflows` component lived only for that dead branch.

### From Wave 5
13. **Substring vs regex semantic drift across copies** — When a small string-matching helper is duplicated, one copy can be "fixed" with a regex while siblings stay on substring `.includes()`. The siblings silently coerce real errors into fallbacks. **Detection: search for `.includes("X")` checks where the X is a generic phrase like "not found" — these are often regex-fix candidates.** Example: `safeInvoke` in `devTools.ts` still using `msg.includes("not found")` years after `researchLab.ts` had moved to `^Command "..." not found$` regex.

### From Wave 6
14. **Top-level integration that should be a plugin** — When every sibling integration lives under `features/plugins/<name>/` and one outlier sits at `features/<name>/`, the outlier is almost always a historical artifact. Move it under the convention. Example: `features/gitlab/` → `features/plugins/gitlab/`.

### From Wave 7
15. **Dead i18n key cluster** — When a feature has its own scoped i18n directory (`features/<area>/i18n/`), the keys can rot independently of the main app i18n. Whole namespaces can become dead while the parent object is still consumed. **Detection: for each key in a feature-scoped locale, project-wide grep for that key string.** Example: `overview/i18n/` had 4 entire dead namespaces (anomaly, eventLog, reviewFocus, savedViews) — 29 keys total.

## What was NOT done (intentionally — backlog)

The 150-finding scan produced a substantial backlog beyond the 46 closed in the 7-wave plan. Roughly:

- **~38 medium-severity findings** that didn't make a wave (deferred until a future scan or until they pile up enough to justify a focused session)
- **~37 low-severity findings** (nits, opportunistic tidies — not worth a session on their own)
- **A few high-severity findings** that the 7-wave plan deferred:
  - `ChatBubbles` operation-line predicate drift (#7 in agent-chat-tool-runner) — display-side filter and dispatch-side parser predicate may diverge
  - `ExecutionMiniPlayer` double-subscribes (#2 in execution-engine) — same execution stream subscribed twice with two parallel 500-entry arrays
  - Three-way appearance-picker duplication (#3 in onboarding-home) — copy-pasted across `AppearanceStep`, `TourAppearanceContent`, `AppearanceSettings`

These should be the starting point for the NEXT code-refactor pipeline run.

## Files referenced

The full INDEX (`INDEX.md`) and per-context reports (17 files in `docs/harness/code-refactor-2026-05-02/`) remain available for cross-reference. Per-wave summaries:
- `FIXES-WAVE-1.md` (orphan islands)
- `FIXES-WAVE-2.md` (diverged near-copies)
- `FIXES-WAVE-3.md` (smaller dead subtrees)
- `FIXES-FINAL.md` (this document — covers Waves 4-7 inline above)
