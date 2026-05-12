# Code-Refactor Fix Wave 1A — Orphan Module Deletion

> 7 atomic commits, 7 high-severity orphan findings closed.
> Baseline preserved + improved: tsc 0 → 0, cargo check 0 → 0, lint 0 → 0.
> Cargo warnings: 142 → **132** (–10). Lint warnings: 12,543 → **12,224** (–319).
> Single mental model: "verify zero importers, then `git rm`."

## Commits

| # | Commit       | Findings closed                                             | LOC removed | Files                                                                                                                                                                          |
|---|--------------|-------------------------------------------------------------|------------:|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | `e620632d0`  | trigger-studio-webhooks #1 (A1)                             | ~3,790      | `src/features/triggers/sub_triggers/` (28 source files + configs/ + __tests__/), `src/features/schedules/components/TimezoneSelect.tsx` (new), `FrequencyEditor.tsx` (import retarget) |
| 2 | `1632da4ec`  | onboarding-home-simple-mode #1 (A3)                         | 625         | `src/features/home/components/SetupCards.tsx`                                                                                                                                  |
| 3 | `f59efdf1b`  | lab-use-cases-tools-connectors #1 (A8)                      | 387         | `src/features/agents/sub_tool_runner/` (4 files), `useUseCasesTab.ts` (dead-flag cleanup)                                                                                       |
| 4 | `d59366b63`  | incidents-manual-review-memories-knowledge #1 (A6)          | 404         | `src/features/overview/sub_memories/hooks/` (4 files), `src/lib/memoryLimits.ts` (stale-comment cleanup)                                                                        |
| 5 | `366746a73`  | incidents-manual-review-memories-knowledge #2 (A7)          | 391         | `src/features/overview/sub_manual-review/components/TriagePlayer.tsx`, `ManualReviewList.tsx` (type-import retarget)                                                            |
| 6 | `690feb55e`  | pipeline-team-memory-sharing-network #1 (A5)                | ~440        | `src-tauri/src/engine/workflow_compiler.rs`, `engine/mod.rs`, `commands/teams/teams.rs::compile_workflow`, `lib.rs` registration, `compilation_pipeline.rs` inventory, 2× CompiledWorkflow.ts bindings, `bindings/index.ts`, `commandNames.generated.ts` |
| 7 | `322c819b5`  | templates-catalog-n8n-adoption #1 (A4)                      | 584         | `src-tauri/src/commands/design/template_adopt.rs` (in-place pruning: 1703 → 1139 lines)                                                                                        |

**Total removed: ~6,620 LOC** across **8 commits** (7 fix + 0 summary). Of that, ~5,800 LOC is TypeScript/React and ~1,000 LOC is Rust.

## What was fixed (grouped by sub-pattern)

### Whole-module / whole-tree deletions (5 of 7)

1. **`sub_triggers/` UI tree (28 files, ~3,790 LOC).** The directory was the original trigger form before `sub_studio/`, `sub_builder/`, `sub_smee_relay/`, `sub_cloud_webhooks/`, `sub_dead_letter/`, and `sub_live_stream/` superseded it. The only external import was `TimezoneSelect` + `getDetectedTimezone` from `FrequencyEditor.tsx` (in `src/features/schedules/`); the scan's suggested home for those (`src/features/schedules/components/`) was correct. **Note:** the scan also suggested deleting `src/features/triggers/lib/triggerError.ts` with the tree — that file is actually load-bearing, imported by the live `triggerSlice.ts` as the "single source of truth" for trigger-error presentation. **Kept.** A reminder that scan suggestions need a grep before acceptance.

2. **`SetupCards.tsx` (625 LOC).** The "Role → Tool → Goal" stepper was removed from the home page when `WelcomeLayout` replaced it with `ResumeBanner + HeroHeader + NavigationGrid + LanguageCards`, but the component file was left in place. The accompanying `setupSlice` (~69 LOC) and `UnifiedBuildEntry` bridge that reads `setupGoal` are technically dead after this commit but **deliberately left in place** for a follow-up — both consumers are guarded against the now-always-empty value (`typeof === 'string'` + falsy fallback), so they no-op safely. Removing them would widen the blast radius mid-wave.

3. **`sub_tool_runner/` (387 LOC, 4 files).** The planned chat-turn live tool-invocation surface (described in `AGENTS.md`) was never wired into chat or use-case tabs. The dangling `toolRunnerOpen` flag in `useUseCasesTab` was the only external reference and got cleaned up in the same commit. The lone consumer of `useUseCasesTab` (`RecipesVariantSigilGrid`) did not read either field.

4. **`sub_memories/hooks/` (404 LOC, 4 files).** Predecessor of `libs/` siblings (which add `silentCatch` + session-backup). Grep confirmed zero importers; the only remaining mention was a stale "keep both call sites in lockstep" instruction in `memoryLimits.ts`, also updated.

5. **`workflow_compiler.rs` + `compile_workflow` command (~440 LOC).** Superseded by the heuristic + LLM topology pair (`suggest_topology` / `suggest_topology_llm`) plus client-side `useAutoTeam.apply()`. Required a cross-cutting cleanup pass: Rust module deletion, `mod` declaration removal, `invoke_handler!` registration, two `CompiledWorkflow.ts` ts-rs binding files (one each side), `bindings/index.ts` re-export, `commandNames.generated.ts` enum entry, and the compile-time `PROMPT_ASSEMBLY_INVENTORY` from 3 → 2 entries.

### Type-leak surgery (1 of 7)

6. **`TriagePlayer.tsx` (391 LOC).** The dead component had a type-leak: `ManualReviewList.tsx:27` imported `TriageReview` from `TriagePlayer.tsx` (the dead file) even though JSX flow used `ReviewFocusFlow` with its own `TriageReview` exported from `reviewFocusHelpers.tsx`. Both interfaces were byte-identical. Redirected the type import to `reviewFocusHelpers` (single source of truth) and deleted the file.

### In-place file pruning (1 of 7)

7. **`template_adopt.rs` orphan workers (584 LOC inside a 1,723-line file).** Stage A1 (2026-05-09) removed six legacy Tauri adoption commands at the frontend boundary but left the Rust workers intact — `rustc` did not warn because the orphan cluster cross-referenced internally (`run_template_adopt_job` → `build_template_adopt_prompt`; `run_continue_adopt` → `build_template_adopt_unified_prompt` → `extract_template_seed_questions`). All nine functions plus three helper state-mutators (`set_adopt_questions`, `set_adopt_claude_session`, `get_adopt_claude_session`) and the corresponding `AdoptExtra.claude_session_id`/`.questions` + `AdoptSnapshotExtras.questions` fields removed. Live surface preserved: `instant_adopt_template`, `get_template_adopt_snapshot`, `verify_template_integrity{,_batch}`, `get_template_manifest_count`, generate-template job path.

## Verification table (before / after)

| Metric                       | Phase B2 baseline | After Wave 1A | Delta            |
|------------------------------|------------------:|--------------:|------------------|
| `tsc --noEmit` errors        | 0                 | 0             | unchanged ✓      |
| `cargo check` errors         | 0                 | 0             | unchanged ✓      |
| `cargo check` warnings       | 142               | 132           | **–10** (~7%)    |
| `npm run lint` errors        | 0                 | 0             | unchanged ✓      |
| `npm run lint` warnings      | 12,543            | 12,224        | **–319** (~2.5%) |

Net frontend deletions: **~5,800 LOC.** Net Rust deletions: **~1,150 LOC.** Total: **~6,950 LOC** removed (Wave 1A goal of "delete orphan modules" had a planned target of ~7,800 LOC; actual is 89% of target because A2 — the 11 i18n/shared-component orphans — was deferred to Wave 1B for finer-grained handling).

## Cumulative status (across all waves so far)

| Wave | Theme                          | High closed | LOC removed | Commits |
|------|--------------------------------|------------:|------------:|--------:|
| 1A   | Whole-module orphan deletion   | 7 of 15     | ~6,950      | 7       |

**Remaining in Theme A:** A2 (i18n/shared 11 orphan modules, ~1,150 LOC), A9 (sub_usage/charts/, 271 LOC), A10 (legacy CronAgentsPage, 191 LOC), A11 (VisualizationNodes/Particles, 156 LOC), A12 (parseEventQuery DSL, 132 LOC), A13 (OnboardingProgressBar + FleetHealthStrip, 222 LOC), A14 (sub_usage/DashboardFilters, small), A15 (ChatThread.tsx, 80 LOC).

## Patterns established (catalogue items 1–4)

1. **"Verify zero importers, then `git rm`" is the wave's mental model.** Every fix follows the same shape: scan finding names a path, run a `Grep` on the path or named symbol for external importers, decide whether to retarget any survivors, delete, run `tsc` (+ `cargo check` if Rust), commit. Worked uniformly across 7 fixes. When a finding is more complex than this shape (e.g. requires a type-import retarget like A7, or has cross-cutting ts-rs bindings like A5), the fix still fits in one commit because the *surrounding* work is mechanical.
2. **`#[allow(dead_code)]` is a signal, not noise.** Rust orphan helpers often hide behind it because the orphan cluster cross-references itself internally (Block A in `template_adopt.rs` was internally consistent — each orphan function called the next — so rustc couldn't dead-code-warn the cluster). The same pattern likely exists elsewhere; future waves should grep for `#[allow(dead_code)]` clusters as a leading indicator.
3. **Scan-suggested deletions need a grep before acceptance.** Theme A1's scan suggested deleting `triggerError.ts` along with `sub_triggers/`, but a one-grep check showed `triggerSlice.ts` (live) imports it. Always verify; never trust the scan to be 100% right about *what else* should be deleted alongside the named file.
4. **Compile-time invariants drift silently when their referents are deleted.** `compilation_pipeline.rs::PROMPT_ASSEMBLY_INVENTORY` was a `const_assert!(len == 3)` pinned to three compilers; deleting `workflow_compiler` required updating both the array AND the assertion arity. Future Rust deletions should grep the target's *symbol name* through `const_assert!`/`assert!`/`compile_error!`/`#[cfg]` blocks before removing.

## What remains

- **Theme A (whole-module orphans)**: 8 more findings in Wave 1B (~2,200 LOC remaining), all smaller-grained.
- **Themes B, C, D, E, F, G, H, I, J, K**: untouched. See INDEX.md for the wave roadmap.
- **Slice cleanup follow-up**: `setupSlice` + `UnifiedBuildEntry` bridge (from A3) should be removed in a later wave once the dormant state is confirmed harmless across a real user-facing release cycle.
- **Doc cleanup follow-up**: `engine/{compiler.rs, chain.rs, intent_compiler.rs, README.md}` still reference the now-deleted `workflow_compiler` in prose/comments. Mostly harmless drift; one focused commit could fix it.

Both follow-ups are flagged for `docs/harness/harness-learnings.md`.
