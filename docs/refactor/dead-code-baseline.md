# Dead-code baseline (knip) — Phase 0 output

> Generated 2026-05-24 as part of the [feature structure refactor](./feature-structure-refactor.md) Phase 0.
> Regenerate any time with `npm run check:dead:files` (files) or `npm run check:dead` (full: files + exports + deps).

## Tooling

- `knip` (devDependency) configured by `knip.json` at repo root.
- Entry points: `src/main.tsx` + all test/spec/script/config files.
- Ignored (generated / not real source): `lib/bindings/**`, `*.generated.ts`,
  `i18n/generated/**`, `i18n/section-locales/**`, `lib/harness/**`.
- Validated: knip flags **zero** live route/page shells (PersonasPage,
  OverviewPage, SettingsPage, etc.) → the import graph resolves correctly.

## Baseline numbers

| Report mode | Command | Count |
|---|---|---|
| Unused **files** (every export unused, module unreachable) | `npm run check:dead:files` | **455** |
| Unused **exports** (incl. barrel-hidden dead code) | `npm run check:dead` | **~1408** |

## ⚠️ The two modes are complementary — you need both

- **File-mode misses barrel-hidden dead code.** Example: `pipeline/sub_canvas/**`
  reports **0 unused files** because `sub_canvas/index.ts` re-exports every
  sibling, keeping them "reachable" — yet export-mode shows nearly all of those
  exports (`computeAlignments`, `ConnectionEdge`, `DryRunDebugger`, …) are unused.
  → For a folder you suspect is dead behind a barrel, check **export-mode** and/or
  delete the barrel's re-exports first, then re-run file-mode.
- **File-mode can have false positives** for code reached only via runtime
  patterns knip can't follow statically (web workers via `new Worker(new URL())`,
  fully dynamic registries). Spot-check before deleting.

**Rule for Phase 1:** delete cluster-by-cluster, re-run `tsc --noEmit` + `npm test`
after each cluster, commit atomically. Never bulk-delete the whole 455 list.

## High-confidence delete clusters (file-mode, manually spot-checked)

| Cluster | Files | Notes / evidence |
|---|---:|---|
| `agents/sub_executions/**` old runner+list | **31** | `PersonaRunner` & `ExecutionList` are exported from the barrel but **never rendered** (`<PersonaRunner>` / `<ExecutionList>` = 0 hits; only comments). Superseded by `ExecutionDetail` / overview `GlobalExecutionList`. Pulls in `runner/*`, `list/*`, `libs/useRunnerState`, `useExecutionList`, `comparisonDiff.worker`. **Verify the worker isn't loaded dynamically before deleting it.** |
| `pipeline/components/groups/**` | **4** | Post Groups→Teams migration. `GroupCard/GroupEditModal/GroupManagerPage/GroupMemoryListModal` — grep "hits" were comments + the unrelated `RoleGroupCard`. |
| `pipeline/sub_canvas/**` (export-mode) | ~27 | Legacy edge-wiring canvas. Hidden from file-mode by barrel — delete the barrel re-exports first, keep only `CanvasDragProvider` if still used by `PersonasPage`. |
| `agents/components/onboarding/**` | **3** | `OnboardingChecklist`, `OnboardingTemplateStep`, `useOnboardingChecklist`. (Keep `ConfigurationPopup` — it's used by SystemHealthPanel; relocate per plan §B3.) |
| `agents/components/preview/**` | **2** | `PreviewPanel`, `PreviewSection` — self-contained, no external refs. |
| `agents/components/` root strays | **3** | `ChatThread.tsx`, `ChatMessageContent.tsx`, `designUtils.ts`. |
| `agents/components/glyph/**` (subset) | up to 9 | Several glyph helpers flagged — verify against the live editor before deleting (some may be lazy/JSX-only). |

## Progress log

| Date | Commit | Removed | Net dead files |
|---|---|---|---|
| baseline | `b352d5e28` | — | 455 |
| 2026-05-24 | `f48a069ba` | 6: agents `designUtils` + `onboarding/{Checklist,useChecklist,TemplateStep}` + `preview/{Panel,Section}` | 449 |
| 2026-05-24 | `f16cbd8c7` | 9: agents `components/glyph/**` forked/dead leaves | 440 |

## ⚠️ The "executions dead island" — mapped, deferred (do NOT partial-delete)

The 31-file old `agents/sub_executions` runner/list cluster (`PersonaRunner`,
`ExecutionList`, `runner/*`, `list/*`, comparison libs, `comparisonDiff.worker`,
`ExecutionTerminal`, the `index.ts` barrel) is genuinely dead **but cannot be
deleted in isolation** — its only consumers are themselves dead, forming a
closed subgraph that spans **five features**:

- `agents/sub_executions/**` (31)
- `shared/components/use-cases/UseCaseExecutionPanel.tsx`
- `templates/sub_n8n/steps/N8nEditStep.tsx`
- `overview/sub_activity/{ExecutionRow.tsx, index.ts, …}`
- `overview/sub_observability/{SystemTraceViewer.tsx, ObservabilityDashboard.tsx, …}`
- `triggers/sub_triggers/{TriggerExecutionHistory.tsx, TriggerDetailDrawer.tsx, …}`

Apparent live edges are **false positives**: Playwright specs define a *local*
`interface ExecutionRow` (name collision, not an import); `traceInspectorTypes.ts`
and `lib/execution/systemTrace.ts` only mention `SystemTraceViewer` **in comments**.

**Why deferred:** (1) it can only be deleted as a whole closed set — removing the
agents 31 alone leaves the dead consumers with broken imports; (2) it bleeds into
the large `overview` (83) and `triggers` (37) dead pools and should be cleared
*with* them in one iterative `knip → delete → knip` pass; (3) `overview` is
concurrently edited by the Groups→Teams retire session — wait until that lands.
Recommended: do this in its own worktree once `overview` is calm. The LIVE
execution UI (`ExecutionDetail`, inspector, `ExecutionDetailModal`,
`ExecutionMiniPlayer`, `CircuitBreakerIndicator`, `traceHelpers`) is untouched by
this island.

## Larger candidate pools (need review, NOT all dead)

These totals are file-mode counts; treat as a review queue, not a delete list:

| Area | Flagged files | Caveat |
|---|---:|---|
| `features/overview` | 83 | Many sub_* analytics surfaces; some likely live via lazy tabs — review per sub_*. |
| `features/templates` | 54 | The earlier manual "sub_n8n is dead" claim was **FALSE**; review narrowly (`sub_diagrams`, `sub_presets` adapters). |
| `features/triggers` | 37 | Several sub_* (dead_letter, cloud_webhooks, studio) are `devOnly` — confirm dev-gated isn't the same as dead. |
| `features/recipes` | 28 | Cross-check vs `templates/sub_recipes`. |
| `features/onboarding` | 10 | Review alongside plan §C1. |

## How to work this queue

```bash
npm run check:dead:files          # current unused-file list
npm run check:dead                # full report (files + exports + deps)
npx knip --include exports        # export-level only (finds barrel-hidden dead code)
npx knip --reporter json > knip.json.out   # machine-readable for scripting a cluster
```
