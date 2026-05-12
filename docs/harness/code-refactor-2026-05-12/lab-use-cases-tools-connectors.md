# Code-refactor scan — Lab, Use Cases, Tools & Connectors

> Total: 12 findings (3 high, 4 medium, 5 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

## 1. `sub_tool_runner` module is fully orphaned

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/sub_tool_runner/index.ts:1` (also: `components/ToolInvocationCard.tsx:27`, `components/ToolRunnerPanel.tsx:12`, `libs/useToolRunner.ts:24` — 387 LOC total)
- **Scenario**: The whole `sub_tool_runner` module exports `ToolRunnerPanel`, `ToolInvocationCard`, and `useToolRunner`, but a repo-wide search shows zero external importers — every reference lives inside the module itself. The only adjacent breadcrumb is a `toolRunnerOpen`/`setToolRunnerOpen` state in `sub_use_cases/libs/useUseCasesTab.ts:14` which is also never consumed (see finding #4). The IPC `invoke_tool_direct` it wraps is still used by other features for direct tool execution, but the panel/card UI has no host.
- **Root cause**: The "Live tool-invocation surface inside a chat turn" surface described in `AGENTS.md` was never wired into the chat or use-case tabs after extraction; the dangling `toolRunnerOpen` flag confirms the integration was started and abandoned.
- **Impact**: 387 LOC of stale UI (incl. a non-trivial persona-scoped run hook with timeout + dedupe + cross-persona drift guards) that drifts away from the active `invokeToolDirect` API and confuses module ownership.
- **Fix sketch**: Delete `src/features/agents/sub_tool_runner/` entirely and the dead `toolRunnerOpen` state in `sub_use_cases/libs/useUseCasesTab.ts:14`. If the chat-turn surface is still planned, recreate it under `sub_use_cases/components/` when it has a host.

## 2. Duplicated lab command CRUD across 4 modes in `lab.rs`

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/commands/execution/lab.rs:126` (and lines 145, 155, 328, 338, 347, 357, 447, 457, 466, 476, 688, 698, 707, 717)
- **Scenario**: `lab_list_*_runs`, `lab_get_*_results`, `lab_delete_*_run`, and `lab_cancel_*` are reimplemented 4 times (arena/ab/matrix/eval) — bodies differ only in the repo module name. Same for the `tokio::spawn` panic-recovery block inside `lab_start_*` (lines 92–121, 294–323, 413–442, 654–683), where the only varying token is `*_repo::update_run_status`.
- **Root cause**: Lab modes were grown incrementally; the `lab_crud!` macro added at `db/repos/lab/mod.rs` covers the repo layer but the *command* layer never received the same treatment.
- **Impact**: ~340 LOC of mirrored command bodies. Every new lab mode multiplies the surface; a fix to (e.g.) `cancel_active_run_before_delete` semantics now has to be propagated 4× and any single miss is a silent divergence.
- **Fix sketch**: Introduce a `simple_lab_crud!` declarative macro alongside `lab_crud!` (or a generic helper accepting `repo: &dyn LabRunRepo`) covering list/results/delete/cancel/panic-spawn. Land it next to `lab/mod.rs:106` so it sits with the existing `get_all_active_progress`.

## 3. Duplicated `build_results_summary_*` builders in `lab_improve_prompt`

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/execution/lab.rs:986`, `:1005`, `:1026`, `:1046`
- **Scenario**: Four nearly-identical functions (`build_results_summary_arena/ab/matrix/eval`) each iterate the result rows and emit the same 7 base-field JSON keys. Arena differs by zero extra fields; A/B and eval add `version_id`/`version_number`; matrix adds `variant`.
- **Root cause**: Copy-paste expansion as new modes landed. The shared `LabResultBase` struct already exposes all the common fields but the builders re-spell them inline.
- **Impact**: ~80 LOC quadrupled; adding a new score field requires touching 4 sites. Drift risk: arena was missing `version_id` while A/B has it (correct) but if a metric is added it's easy to skip one mode.
- **Fix sketch**: Replace with one generic `build_results_summary<R: HasBase + Serialize>(results: &[R])` that flatten-serializes `base` and merges per-mode extra fields via a small `extra_fields_for(result)` callback. Land at `lab.rs:984`.

## 4. Dead `toolRunnerOpen` state in `useUseCasesTab`

- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/agents/sub_use_cases/libs/useUseCasesTab.ts:14`, `:85`
- **Scenario**: `const [toolRunnerOpen, setToolRunnerOpen] = useState(false);` is declared and re-exported but no consumer ever reads/writes `toolRunnerOpen`. Confirmed by grep across `src/` — only declaration sites match.
- **Root cause**: Companion of the orphaned `sub_tool_runner` module (finding #1) — the bridge UI that was supposed to read the flag never landed.
- **Impact**: Negligible LOC but seeds the false belief that a tool-runner panel is wired into use-cases.
- **Fix sketch**: Remove the `useState` line and drop `toolRunnerOpen`/`setToolRunnerOpen` from the return object. Same PR as finding #1.

## 5. `EvolutionLoader.tsx` is orphaned

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/agents/sub_lab/shared/EvolutionLoader.tsx:1` (222 LOC)
- **Scenario**: Exports `EvolutionLoader` + `EvolutionLoaderProps`; grep shows zero `import EvolutionLoader` callers anywhere in `src/`. Not re-exported from `sub_lab/shared/index.ts` either.
- **Root cause**: Visual prototype for the evolution panel that was superseded — `components/evolution/EvolutionPanel.tsx` and `EvolutionPanelLineage.tsx` ship without it.
- **Impact**: 222 LOC of unused motion/SVG component pulling `framer-motion` and `useMotion` references.
- **Fix sketch**: Delete the file. No re-export entry needs touching.

## 6. `labUtils.ts` is a dead re-export shim

- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/agents/sub_lab/shared/labUtils.ts:1` (18 LOC)
- **Scenario**: Re-exports the same names that `sub_lab/shared/index.ts` and `lib/eval/evalFramework` already export. Grep finds zero importers; the only mention is a historical comment in `lib/eval/evalFramework.ts:6` referring to its old contents.
- **Root cause**: Left behind by the consolidation noted in that comment — "logic that was spread across testUtils.ts, labUtils.ts, and test_runner.rs" was unified into `evalFramework.ts` but the file wasn't deleted.
- **Impact**: Minor, but actively misleading — anyone touching lab code has to read it to confirm it's a shim.
- **Fix sketch**: Delete `sub_lab/shared/labUtils.ts`. Verify no test references via grep before commit.

## 7. Two `shared/` directories under `sub_lab/` create import ambiguity

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/agents/sub_lab/shared/` (14 files, 1224 LOC) vs `src/features/agents/sub_lab/components/shared/` (20 files, 2580 LOC)
- **Scenario**: `sub_lab` has both `shared/` and `components/shared/`. They overlap conceptually (both hold cross-mode primitives) and split arbitrarily — diff helpers split between `shared/DiffViewer.tsx` and `components/shared/DraftDiffViewer.tsx`/`InlineDiffPreview.tsx`, all consuming the same `shared/labPrimitives.ts`. Components reach UP into `../../shared/` from `components/shared/InlineDiffPreview.tsx:3`.
- **Root cause**: The outer `shared/` was the first home; later additions defaulted to `components/shared/` next to other panel-local components. Nothing forces the split.
- **Impact**: New contributors have to guess which `shared/` to add to; today's pattern (cross-import) makes module ownership effectively flat. Reviewers can't tell "is this file presentational or behavioural?" from the path.
- **Fix sketch**: Merge into one directory. Recommended: move presentational primitives (`DiffViewer`, `VersionItem`, `LabActionButtons`, `LabPanelShell`, `LabVariantTabs`, toggle grids, `UseCaseFilterPicker`, `DisabledGuide`) into `components/shared/` and rename `sub_lab/shared/labPrimitives.ts` + `chartTheme.ts` to `sub_lab/libs/` (alongside `labAggregation.ts`). Update `sub_lab/shared/index.ts` → delete after migration.

## 8. `AbPanel`/`ArenaPanel` are pure 1-line wrappers around `*Studio`/`*Colosseum`

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/agents/sub_lab/components/ab/AbPanel.tsx:1` (5 LOC), `src/features/agents/sub_lab/components/arena/ArenaPanel.tsx:1` (5 LOC)
- **Scenario**: `AbPanel` returns `<AbPanelStudio />`; `ArenaPanel` returns `<ArenaPanelColosseum />`. No props, no logic, no naming-stability indirection — only one variant exists per mode.
- **Root cause**: Earlier A/B-test of multiple visual variants where the alternates were deleted, leaving the dispatcher behind.
- **Impact**: Confusing import chain (`LabTab` → `ArenaPanel` → `ArenaPanelColosseum`) and a misleading file name. Each adds a lazy boundary that may break tree-shaking.
- **Fix sketch**: Either rename `AbPanelStudio` → `AbPanel` and `ArenaPanelColosseum` → `ArenaPanel` (delete the wrappers), or — if the codename is intentional — re-export from `sub_lab/index.ts`. Update `LabTab.tsx:10–11`.

## 9. Deprecated `HEALTH_META`/`MODE_META` constants kept indefinitely

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase.ts:101–139`
- **Scenario**: `HEALTH_META` (lines 105–130) and `MODE_META` (lines 135–139) are `@deprecated` in favour of factory functions `getHealthMeta(t)`/`getModeMeta(t)` (lines 45–98). Grep for `HEALTH_META`/`MODE_META` shows only the declarations and self-comments — zero callers.
- **Root cause**: i18n migration in this module left compatibility-shim exports without scheduling their removal.
- **Impact**: ~40 LOC of English-only fallback labels that violate i18n-coverage gates. Two adjacent TODO comments (`displayUseCase.ts:259`, `:262`) reference the same incomplete migration.
- **Fix sketch**: Delete `HEALTH_META` and `MODE_META` exports plus their JSDoc. Resolve the two TODOs at lines 259/262 by threading `t` through `toDisplayUseCase` in the same PR.

## 10. `searchExecutions` IPC binding unused in frontend

- **Severity**: low
- **Category**: dead-code
- **File**: `src/api/agents/executions.ts:39`
- **Scenario**: `searchExecutions(query, limit, personaId) → invoke("search_executions")` is exported but grep over `src/` (excluding the file itself) finds zero importers. The Rust handler at `src-tauri/src/commands/execution/executions.rs:79` is registered and live.
- **Root cause**: Either an in-flight feature or a leftover from a removed search bar — the API stub was added in anticipation but the consumer never landed.
- **Impact**: Misleading API surface; `ExecutionSearchResult` binding gets exported with no UI. Removal is small but should be paired with deciding whether to also drop the Rust command (defer that to the orchestrator).
- **Fix sketch**: If the search UI is genuinely backlog, leave a comment linking the issue. Otherwise delete the TS export at `executions.ts:39` and (separately) consider unregistering `search_executions` from `src-tauri/src/lib.rs:1264`.

## 11. Triplicated `LabResultBase` JSON projection in lab repos

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/lab/arena.rs:83`, `ab.rs:96`, `matrix.rs:116`, `eval.rs:91`, `consensus.rs:107`
- **Scenario**: Each lab repo's `create_result` opens with the same 13-column `INSERT … (scenario_name, model_id, provider, status, output_preview, tool_accuracy_score, output_quality_score, protocol_compliance, input_tokens, output_tokens, cost_usd, duration_ms, rationale, suggestions, error_message, created_at)` block — only the table name and the (1-2) mode-specific columns differ. Same pattern in the parameter-binding list. ~50 LOC of insert SQL repeated 5×.
- **Root cause**: `lab_crud!` macro at `lab/mod.rs` covers read/update/delete but explicitly stops short of `create_result` because of the per-mode extra columns. So the common base columns got pasted at each call site.
- **Impact**: Adding a base column (e.g. a new score, a new cost field) requires editing 5 INSERTs in lockstep. The recent `tool_calls_expected/actual` migration already had to touch 5 files to keep the JSON dual-write coherent (see ADR 2026-05-02 references in comments).
- **Fix sketch**: Extract a helper `build_lab_result_insert_sql(table, extra_cols: &[&str]) -> (String, fn bind(...))` in `lab/mod.rs` that emits the shared columns and lets each repo append its (variant/version_id/sample_index) fragment. Alternatively extend the macro with `extra_columns: ["variant"]` syntax.

## 12. Lab progress label translations mix translated and inline strings

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/agents/sub_lab/components/shared/LabProgress.tsx:99`, `:122–124`; `src/features/agents/sub_lab/components/shared/LabTab.tsx:21–28`
- **Scenario**: `LabProgress.tsx:99` falls back to `\`Testing ${labProgress.modelId} \\u2014 ${labProgress.scenarioName}\`` instead of `t.agents.lab.*`. Lines 122–124 render `Tool: …`, `Output: …`, `Protocol: …` literally. `LabTab.tsx:21–28` hardcodes English labels (`'Arena'`, `'A/B'`, `'Improve'`, `'Breed'`, `'Evolve'`, `'Versions'`, `'Regression'`) while the rest of the panel goes through `t`. `LabTab.tsx:164` has an English `title` attribute. `AutoOptimizeToggle` `catch { /* management API not running */ }` and `catch { /* silent */ }` (`LabTab.tsx:130`, `:150`) silently swallow errors.
- **Root cause**: Incremental i18n migration that didn't sweep the lab progress + tab strip; the silent catches predate the `silentCatch` helper used elsewhere in `sub_lab`.
- **Impact**: Two non-translated user-visible strings; broken silent error pattern means a transient management-API outage is invisible in Sentry breadcrumbs. Minor.
- **Fix sketch**: Replace the hard-coded strings with `t.agents.lab.*` entries (or `t.agents.editor.tabs.*` which already exists for `lab`/`versions`-style labels). Swap the two empty catches for `silentCatch('LabTab:fetchAutoOptimize')` to match the pattern used in `sub_lab/components/shared/ScenarioDetailPanel.tsx:7`.
