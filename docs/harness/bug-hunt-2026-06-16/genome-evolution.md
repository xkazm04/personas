# Bug Hunter — Genome & Evolution

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: genome-evolution | Group: Execution Engine

## 1. Promotion compares two incompatible fitness scales
- **Severity**: Critical
- **Category**: Silent failure / logic error
- **File**: `src-tauri/src/engine/evolution.rs:377`
- **Scenario**: A cycle runs. `incumbent_fitness` comes from `compute_fitness` (a 0–1 weighted blend of *historical* knowledge: success rate, normalized cost, normalized duration). `best_variant_score` comes from `evaluate_persona_on_scenarios` (a 0–1 composite of *live test-run* `tool_accuracy*0.3 + output_quality*0.4 + protocol_compliance*0.3`). The promotion gate is `improvement = best_variant_score - incumbent_fitness.overall; if improvement >= threshold`.
- **Root cause**: The two numbers measure entirely different things on different distributions. Historical `compute_fitness` is dominated by cost/speed normalization (`1.0 - cost/$1`, `1.0 - dur/60s`), while the variant score is an LLM quality eval. A persona with cheap+fast history easily scores 0.9 on `incumbent_fitness` while *every* variant — including a genuinely better one — scores ~0.6 on the quality eval, so `improvement` is negative and nothing ever promotes. Conversely an expensive incumbent scores ~0.2 historically, so a mediocre 0.5 variant clears any threshold and gets promoted. The incumbent is *also* run through `evaluate_persona_on_scenarios` (`incumbent_avg`, line 326) on the *same* scale, but that value is never used in the promotion decision.
- **Impact**: The core decision of the entire evolution engine is comparing apples to oranges. Promotions are effectively random with respect to actual improvement; the system can replace a good prompt with a worse one, or never evolve at all. `incumbent_avg` is computed (burning CLI budget) and discarded.
- **Fix sketch**: Compare like-for-like: `improvement = best_variant_score - incumbent_avg` (both from `evaluate_persona_on_scenarios`). Keep `incumbent_fitness.overall` only for reporting. Persist both raw values in the summary for forensic comparison.

## 2. Concurrent evolution cycles for one persona — no in-flight guard
- **Severity**: High
- **Category**: Race condition
- **File**: `src-tauri/src/engine/mod.rs:2213` (and `commands/execution/evolution.rs:190`)
- **Scenario**: `should_evolve` counts completed executions with `created_at > last_cycle_at`. `last_cycle_at` is only written by `complete_cycle` (repo line 331), i.e. minutes later when the cycle finishes. Two successful executions finishing close together (or an auto-trigger overlapping a manual `evolution_trigger_cycle`) both see the threshold satisfied, both `create_cycle`, and both `tokio::spawn(run_evolution_cycle)` for the same persona.
- **Root cause**: There is no "is a cycle already running for this persona?" check before spawning. The threshold gate is not advanced until the cycle completes, so it cannot serialize concurrent triggers. `background_job.rs` has an `ensure_not_running` primitive, but evolution cycles bypass it entirely.
- **Impact**: 2× (or more) the intended CLI cost — each cycle spawns `variants × ≤3 scenarios × (run+eval)` Claude calls and registers its *own* independent budget ledger, so the per-persona ceiling is silently doubled. Both cycles also race to promote; the `updated_at` CAS in `promote_variant` (line 561) prevents a double-write, but the loser still wasted a full cycle of tokens, and `total_cycles` / `total_promotions` accounting double-counts.
- **Fix sketch**: Before `create_cycle`, atomically check there is no `evolution_cycles` row for this persona in a non-terminal status (`breeding`/`evaluating`/`promoting`), or guard via the existing `BackgroundJobs::ensure_not_running` keyed on `persona_id`. Skip/queue the second trigger.

## 3. Variant `prompt_segments` can be emptied → blank system prompt promoted/adopted
- **Severity**: High
- **Category**: Edge case / silent failure
- **File**: `src-tauri/src/engine/genome.rs:436` (mutate drop branch) and `:216` (reassemble)
- **Scenario**: `mutate` action `1` removes a random segment guarded by `len() > 1`, but the guard is checked *before* the action lottery and `mutate` is called repeatedly. Start with a 2-segment genome. First `mutate` (rate near 1.0) drops one → 1 segment. The outer `len() > 1` guard now blocks further segment mutation, so 1 survives *within a single call*. But evolution self-breeds by cloning + mutating once per variant, and `breed_generation`'s `crossover_segments` can also produce a child whose segments all came from a parent slice that was already length-1. More directly: a persona whose `system_prompt` is empty or whitespace yields `prompt_segments == []` from `split_prompt_segments` (line 632, `filter(!trim().is_empty())`). `reassemble_prompt` on `[]` returns `""`.
- **Root cause**: No invariant that a genome always has ≥1 non-empty segment. `from_persona` can produce an empty `prompt_segments` vec; `reassemble_prompt` happily returns an empty string; promotion (`new_prompt`, evolution.rs:381) and adoption (genome.rs:350) write that empty string straight into `personas.system_prompt`.
- **Impact**: An evolved or adopted persona can end up with a completely empty system prompt, silently destroying its behavior on the next real execution. No validation rejects it.
- **Fix sketch**: After mutation/crossover/critique, assert `!reassemble_prompt().trim().is_empty()`; if empty, fall back to the incumbent's prompt. Reject promotion/adoption when the reassembled prompt is empty.

## 4. Fitness/quality scores using NaN sort silently lose the best genome
- **Severity**: Medium
- **Category**: Silent failure / edge case
- **File**: `src-tauri/src/commands/execution/genome.rs:180` (and evolution.rs:363)
- **Scenario**: `compute_fitness` returns `overall` from arithmetic on `avg_cost_usd` / `avg_duration_ms` knowledge values. If a knowledge row has been corrupted to a non-finite value (e.g. an `avg_cost_usd` stored as `inf`, or division paths that produce NaN), `overall` becomes NaN. `parent_fitness.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal))` then treats every NaN comparison as `Equal`, producing a non-total order. In the evolution loop, `if variant_avg > best_variant_score` is always `false` when `variant_avg` is NaN, so a NaN-scoring variant can never win even if it is genuinely the best (it gets a 0 by default and is dropped).
- **Root cause**: `partial_cmp(...).unwrap_or(Equal)` masks NaN instead of surfacing it, and the `>` comparison against an `f64` initialized to `0.0` silently discards NaN candidates. There is no `is_finite` check after fitness computation or after the composite score (`evolution.rs:508-511`) divides by 100.
- **Impact**: With corrupted or extreme knowledge data, breeding ranks parents arbitrarily and evolution can lose the genuinely-best variant, defeating the optimization. Hard to diagnose because no error is raised.
- **Fix sketch**: Clamp/sanitize fitness and composite scores with `if !x.is_finite() { 0.0 }` immediately after computation; log a warning when a non-finite score is observed so the corrupt knowledge row can be found.

## 5. `breed_generation` mutates `crossover_point` floor when a parent has 0 segments
- **Severity**: Low
- **Category**: Edge case
- **File**: `src-tauri/src/engine/genome.rs:244`
- **Scenario**: Both parents have empty `prompt_segments` (e.g. both extracted from whitespace-only prompts, see finding 3). `max_seg = 0`, so the `if max_seg > 1` branch is false and `crossover_point` is hard-coded to `1`. `crossover_segments` is then called with `point = 1` on two empty slices: the `0..point` loop and `point..max_len` (where `max_len = 0`) loop both iterate over nothing, yielding two empty children — silently. More subtly, when exactly one parent has 1 segment and the other 0, `crossover_point = 1` still "works" but the swap semantics are meaningless (single-point crossover on a 1-element genome is a no-op disguised as recombination).
- **Root cause**: The crossover point is forced to `1` for any `max_seg <= 1` instead of being skipped, so crossover runs as a no-op/empty-producer on degenerate genomes rather than short-circuiting.
- **Impact**: Wasted work and misleading offspring lineage names (`A × B`) for genomes that received no actual recombination; combined with finding 3, contributes to empty-prompt offspring entering the population.
- **Fix sketch**: Early-return both parents unchanged (or skip the pair) when `max_seg < 2`; only attempt single-point crossover when both parents have ≥2 segments.
