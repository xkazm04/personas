# `engine/` — compilers & cascade evaluator decision matrix

> Four files in this module share `Compile` / `Chain` vocabulary but have
> sharply different responsibilities. Confusing them has already produced
> duplicated parsing logic. This README is the source of truth for "which
> file do I extend?".

The four files are:

- `compiler.rs` — `PersonaCompiler`
- `intent_compiler.rs` — `IntentCompiler`
- `workflow_compiler.rs` — `WorkflowCompiler`
- `chain.rs` — `evaluate_chain_triggers` (NOT a `CompilationPipeline`)

The first three implement
[`CompilationPipeline`](./compilation_pipeline.rs); `chain.rs` is a runtime
event-cascade evaluator that just happens to live next to them.

## Decision matrix

| File / type | Input | Output artifact | Caller (entry point) | Implements `CompilationPipeline`? |
|---|---|---|---|---|
| `compiler.rs` — `PersonaCompiler` | `CompilationInput` (existing `Persona` + tools + connectors + `instruction`, optional `existing_result` for refinement) | `serde_json::Value` persona design (structured prompt, tools, triggers, summary, feasibility) | `commands::design::analysis::start_design_analysis` / `refine_design` | ✅ `pipeline_name() == "persona"` |
| `intent_compiler.rs` — `IntentCompiler` | `IntentInput` (empty `Persona` shell + tools + connectors + plain-language `intent`) | `serde_json::Value` design **+** intent extensions (`use_cases`, `model_recommendation`, `test_scenarios`) | `commands::design::analysis::compile_from_intent` | ✅ `pipeline_name() == "intent"` |
| `workflow_compiler.rs` — `WorkflowCompiler` | `String` workflow description (multi-persona prose) | `CompiledWorkflow` = `PersonaTeam` + members + connections + `TopologyBlueprint` | `commands::teams::teams::compose_team_from_workflow` → `persist_blueprint` | ✅ `pipeline_name() == "workflow"` |
| `chain.rs` — `evaluate_chain_triggers` | finished execution result (`source_persona_id`, status, output JSON, depth, visited set) | zero-or-more `PersonaEvent` rows + `CascadeMetrics` | `engine::handle_completion` (called once per execution result) | ❌ no LLM, no prompt assembly |

## When to extend which

Pick by the artifact you want to produce, not by the surface vocabulary:

- **Iterating on an *existing* persona's blueprint** → `compiler.rs`. Refinement
  mode is `existing_result: Some(_)` and reuses `engine::design`'s
  history-aware refinement prompt.
- **Compiling a *one-shot intent* into a brand-new persona configuration**
  (with use cases, model picks, and test scenarios) → `intent_compiler.rs`.
  Always greenfield; no `existing_result`. Do **not** add intent-only fields
  to `compiler.rs`.
- **Composing a multi-persona pipeline** from prose → `workflow_compiler.rs`.
  The actual prompt for topology lives in `engine::llm_topology`; this file
  owns the persistence transaction.
- **Firing follow-up triggers after an execution finishes** → `chain.rs`.
  This is *not* a compiler. It evaluates predicates and publishes events.

## Shared / delegated code paths

To keep the boundary clear, the three real compilers share helpers via
`engine::design` and `engine::compilation_pipeline`, **not** by inheriting
from each other:

| Concern | Owner module | Used by |
|---|---|---|
| Pipeline trait + stage enum + outcome enum | `engine::compilation_pipeline` | all three compilers |
| Persona-design prompt builders (`build_design_prompt`, `build_refinement_prompt_with_history`) | `engine::design` | `compiler.rs` |
| Intent prompt builder (`build_intent_prompt`) | `engine::intent_compiler` | `intent_compiler.rs` only — **deliberately not shared** |
| Topology prompt builder (`build_llm_topology_prompt`) | `engine::llm_topology` | `workflow_compiler.rs` only |
| Output extraction (`extract_design_question`, `extract_design_result`) | `engine::design` | `compiler.rs` and `intent_compiler.rs` (intent output is a strict superset of design output) |
| Feasibility check (`check_feasibility`) | `engine::design` | `compiler.rs` (also exposed via `commands::design::test_design_feasibility`) |
| Topology blueprint validation (out-of-bounds / self-loop) | `workflow_compiler::WorkflowCompiler::validate` | `workflow_compiler.rs` only |

## Anti-patterns to avoid

1. **Don't subclass `PersonaCompiler` from `IntentCompiler`** (or vice versa).
   They share parsing but not prompt assembly. If you need a third design
   variant, add it as its own `CompilationPipeline` impl and route shared
   helpers through `engine::design`.
2. **Don't add a fifth pipeline silently.** If you implement
   `CompilationPipeline`, register it in
   [`compilation_pipeline::PROMPT_ASSEMBLY_INVENTORY`](./compilation_pipeline.rs).
   The accompanying `const _: () = assert!(...);` will fail compilation if
   the inventory drifts from the documented count, forcing you to update
   this README at the same time.
3. **Don't conflate `chain.rs` with the compilers.** The "chain" in
   chain-triggers is an event cascade between executions, not a stage
   pipeline. It does not assemble prompts and does not produce design JSON.
4. **Don't duplicate prompt-assembly helpers.** Each compiler has exactly one
   canonical prompt-assembly entry point (see the inventory below). If you
   feel a need to copy-paste prompt text, factor it into `engine::design`
   instead.

## Canonical prompt-assembly entry points

(Mirrored by the compile-time inventory in
[`compilation_pipeline.rs`](./compilation_pipeline.rs) — keep both lists in
sync.)

- `engine::compiler::assemble_prompt` (and the trait
  `PersonaCompiler::assemble_prompt`)
- `engine::intent_compiler::build_intent_prompt` (and the trait
  `IntentCompiler::assemble_prompt`)
- `engine::workflow_compiler::WorkflowCompiler::assemble_prompt` (real prompt
  is in `engine::llm_topology::build_llm_topology_prompt`)

`chain.rs` deliberately has no entry in this list.
