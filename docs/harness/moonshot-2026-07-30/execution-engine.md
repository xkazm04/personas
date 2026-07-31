# Moonshots — Execution Engine

## 1. The Counterfactual Engine — fork any past run at any span and re-execute it deterministically

- **Tier**: 1 (10x category-defining)
- **Category**: intelligence
- **Impact**: Every historical execution becomes a live, forkable simulation — debugging, prompt iteration, and regression testing happen against recorded reality at near-zero token cost, turning the replay surface from a movie player into a time machine.
- **Feasibility**: medium
- **Time-horizon**: months
- **Why it's a moonshot**: Today the engine records extraordinarily rich flight data — a full span tree (`trace.rs`), typed protocol events from the JSONL stream, per-tool usage rows, cost attribution — and then only lets you *watch* it (`ReplaySandbox` scrubs a static log). No agent platform on the market lets an operator scrub to the third tool call of a failed run, edit the prompt / swap the model / pin the recorded tool outputs, and re-run *from that point* as a counterfactual. This is `rr`-style record/replay debugging for AI agents. It also quietly solves the hardest problem in agent QA: real production runs become deterministic fixtures, so assertion suites and lab evals stop needing synthetic inputs and live (expensive, flaky) tool calls.
- **What exists today**:
  - `src/features/agents/sub_executions/replay/ReplaySandbox.tsx` + `useReplayTimeline` — passive scrub-only replay with transport controls, terminal/tool/cost panels (already has a "rerun with this input" seam via `setRerunInputData`).
  - `src-tauri/core/src/trace.rs` — full span tree (PromptAssembly, CliSpawn, ToolCall, StreamProcessing…) persisted to `execution_traces`.
  - `src-tauri/engine/src/parser.rs` / `protocol.rs` — the raw-CLI-bytes → typed-event boundary; everything needed to reconstruct conversation state up to any point.
  - `src-tauri/src/engine/dry_run.rs` — already assembles the *entire* validate stage (prompt, tool surface, credentials, model) without spawning; a fork is "dry run + conversation prefix + resume".
  - `src-tauri/src/engine/tool_runner.rs` + `mcp_tools.rs` — the single tool-dispatch broker where a fixture layer slots in; `tool_usage_log` already records calls.
  - `src-tauri/src/engine/http_engine/` — the OpenAI-compatible loop where mid-conversation injection is fully controllable (the CLI path is harder; the HTTP path is the beachhead).
  - `src-tauri/engine/src/prepared_run_cache.rs` — hash-keyed prepared-run blobs, the natural cache shape for fork snapshots.
- **Path to implementation**:
  1. **Fixture capture (doable now)**: extend `tool_runner.rs` dispatch to persist full tool inputs *and outputs* keyed by `(execution_id, span_id)` — most of the data already flows through `tool_usage` and `ToolCall` spans; this is a recording-completeness pass, no new architecture.
  2. Build a `FixtureToolBroker` mode in `tool_runner.rs`: on fork-replay, serve recorded outputs (VCR-style, with hash-match / fallthrough-to-live policy per tool) instead of dispatching.
  3. Implement `fork_execution(execution_id, span_id, overrides)` in the command layer: reuse `dry_run.rs` assembly for the validate stage, reconstruct the conversation prefix from the parsed JSONL log up to `span_id`, and run the remainder through the **HTTP engine path first** (deterministic message-array control), stamping the child run with a `forked_from` lineage column on `persona_executions`.
  4. UI: a "Fork from here" affordance on `TimelineScrubber` and span rows in `TraceInspector`, with an override sheet (prompt edit, model swap via the routing cascade, tool-fixture pin/unpin) — then render original-vs-fork using the existing comparison Web Worker in `execution-trace-primitives`.
  5. Amplify into the Lab: let `lab.rs` / assertion suites run against fixture-pinned forks of real executions — a regression corpus mined from production runs, executed for pennies.
- **Dependencies**: internal — tool_runner, dry_run, parser/protocol, trace, http_engine, replay UI, lab/assertions. External — none new (the point is *removing* live-API dependence).
- **Risks**: (1) The LLM itself stays nondeterministic — only tools are pinned, so forks are counterfactuals, not bit-exact replays; the UX must frame this honestly. (2) Conversation-prefix reconstruction on the Claude CLI path is constrained (session resume semantics); mitigated by shipping HTTP-path-first. (3) Fixture staleness/secret-leakage in recorded tool outputs requires redaction on capture.
- **What changes if we ship it**: Personas becomes the only agent platform where "what would have happened if…" is a button, not a thought experiment — and every real run silently grows the test corpus that guards every future change.

## 2. The Self-Tuning Fabric — the engine renegotiates its own routing, budgets, and healing policy from lived evidence

- **Tier**: 1 (10x category-defining)
- **Category**: data-moat
- **Impact**: The manually-authored model-routing stylesheet, budget ceilings, and healing strategy choices become *learned artifacts* — continuously proposed from real cost/quality/reliability telemetry, shadow-tested in the Lab, and promoted only through the quality gate — so every execution across every persona makes the whole fleet cheaper, faster, and more reliable without the operator touching a setting.
- **Feasibility**: medium
- **Time-horizon**: quarters (first proposal loop in weeks)
- **Why it's a moonshot**: All the organs of a closed loop already exist and are *not connected*: a declarative routing cascade (`model_routing.rs` — explicitly documented as "the foundation the per-use-case tiering wants to grow into"), a spend ledger (`dev_llm_spend`, `run_budget`), version×model benchmark machinery (`lab_start_matrix`), composite scoring (`score_weights.rs`), a healing-effectiveness ledger that already computes per-strategy confirm/revert rates (`HealingEffectivenessReport` in `db/src/repos/execution/healing.rs`), genome evolution with critique-driven mutation, and a promotion `quality_gate.rs`. Wiring them into one autonomous optimize→shadow-test→gate→promote loop turns Personas from a cockpit the operator flies into an aircraft that trims itself — and the accumulated evidence (which model wins which operation at what cost, which healing strategy holds for which failure class) becomes a moat no fresh install can copy.
- **What exists today**:
  - `src-tauri/db/src/model_routing.rs` — CSS-specificity routing cascade, today hand-written via `ModelRoutingSection.tsx` in `src/features/settings/sub_engine/`.
  - `src-tauri/db/src/repos/execution/metrics.rs`, `llm_spend.rs`, `run_budget.rs` — cost/latency/token evidence at multiple granularities; `provider_usage_stats` / `provider_usage_timeseries` from the BYOM layer.
  - `src/api/agents/lab.ts` + `src-tauri/src/commands/execution/lab.rs` — arena/A-B/matrix/eval runs, the ready-made shadow-testing rig.
  - `src-tauri/core/src/score_weights.rs` — single source of truth for composite quality scoring.
  - `src-tauri/db/src/quality_gate.rs` — pass/fail promotion enforcement, the natural gate for auto-generated policy.
  - `src-tauri/db/src/repos/execution/healing.rs` — per-category auto-fix success/revert rates already aggregated; `src-tauri/src/commands/execution/evolution.rs` — per-persona policy machinery (enable/threshold/strategy) whose *shape* this generalizes fleet-wide.
  - `src-tauri/src/engine/failover.rs` + `circuit_breaker` state — reliability signal per provider.
- **Path to implementation**:
  1. **Evidence aggregator (doable now)**: a new read-only repo query joining `persona_executions` × `dev_llm_spend` × lab scores × healing effectiveness into per-`(category, model, operation)` cost/quality/reliability triples — every table already exists.
  2. Proposal generator: emit candidate `ModelRoutingRule` diffs with quantified claims ("category=research on opus: $41/mo; sonnet scores within 2% on your assertion suites → projected −63% spend"), plus budget-ceiling and healing-strategy-weight proposals, persisted as a `policy_proposals` table.
  3. Shadow validation: auto-drive `lab_start_matrix` on the affected personas' recent real inputs under the proposed rule, scored via `ScoreWeights` (later: fixture-replay from Moonshot 1 makes this nearly free — synergy, not dependency).
  4. Promotion: route accepted proposals through `quality_gate.rs`; write the winning rules into `MODEL_ROUTING_RULES_KEY` with full provenance (evidence snapshot + shadow-run ids) so every active rule is auditable.
  5. UI: a "Proposals" feed inside `ModelRoutingSection.tsx` with three trust levels — review-each, auto-apply-below-risk-threshold, full autopilot per category — mirroring the consent shape already proven by `evolution_upsert_policy`.
  6. Extend the same loop to provider failover ordering (`failover.rs`) and BYOM compliance-aware routing, closing the circle with the capability matrix.
- **Dependencies**: internal — model_routing, lab, score_weights, quality_gate, metrics/spend repos, healing repo, settings UI. External — none; runs entirely on local SQLite evidence.
- **Risks**: (1) Lab/assertion scores are a proxy — a rule can win the benchmark and lose in production; mitigated by post-promotion monitoring with auto-rollback (the healing ledger's confirm/revert pattern, reused). (2) Feedback-loop oscillation (rules flapping between models) needs hysteresis and min-evidence thresholds. (3) Per-persona sample sparsity — early proposals must aggregate at category level and decline to propose below an evidence floor.
- **What changes if we ship it**: The operator stops being the routing table's author and becomes its editor-in-chief — and after six months of accumulated evidence, a Personas install is measurably smarter about running agents than any competitor's day-one product can be.
