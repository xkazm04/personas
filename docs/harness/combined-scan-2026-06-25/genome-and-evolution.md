# Genome & Evolution — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: genome-and-evolution | Group: Execution Engine
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Failed evolution cycles never advance `last_cycle_at`, causing an auto-trigger retry storm
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / cost-runaway / recovery-gap
- **File**: src-tauri/src/engine/evolution.rs:184-198, 319-345, 402-405 (early `return`s) vs. complete_cycle at :478; trigger at src-tauri/src/engine/mod.rs:2420-2436; gate at src-tauri/src/engine/evolution.rs:628-653
- **Scenario**: A persona has an enabled evolution policy. Scenario generation (`generate_scenarios`, :319) — or persona load (:184), or any status write (:178/307/402) — fails *persistently* for this persona (e.g. a prompt that always yields zero scenarios → the `Ok(_)` empty branch at :321). The cycle marks itself Failed and `return`s **without ever calling `complete_cycle`**. `complete_cycle` (db/repos/lab/evolution.rs:329-337) is the *only* writer of `evolution_policies.last_cycle_at` / `total_cycles`. So `last_cycle_at` is frozen. `should_evolve` (:628) counts `persona_executions … created_at > last_cycle_at`; that count only grows. The very next *successful* execution re-fires `run_evolution_cycle` (mod.rs:2422-2427), which fails identically — forever, once per completed run.
- **Root cause**: The Failed terminal paths update only `evolution_cycles.status` (`update_cycle_status`); they do not finalize the *policy* clock. The single-flight `InflightGuard` blocks only *concurrent* cycles, not serial re-fires.
- **Impact**: Unbounded repeated breeding + LLM-critique CLI spawns + scenario-eval CLI spawns, each a real-token/real-dollar cost, on every successful execution of an "evolving" persona — with zero forward progress. A self-inflicted spend leak triggered by one broken persona config.
- **Fix sketch**: On every terminal path (success *and* failure), stamp `last_cycle_at = now` (add a lightweight `mark_cycle_attempted(policy_id)` and call it in a `finally`-style guard, or have `update_cycle_status(Failed)` also bump `last_cycle_at`). That makes `should_evolve` require a fresh `min_executions_between` window before retrying a failing persona.
- **Value**: impact=8 effort=3

## 2. Breeding pipeline is fitness "success theater": parent fitness computed-then-discarded, offspring fitness never computed, "top offspring" selection is arbitrary
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: success-theater / unclear-evolution-semantics
- **File**: src-tauri/src/commands/execution/genome.rs:172-188 (parent_fitness), :201-208 (fitness None), :218-231 ("top offspring"); doc claim at :51-53
- **Scenario**: User starts a breeding run (doc: "breeds offspring across generations, computes fitness, and persists results"). The pipeline computes `parent_fitness` with elaborate NaN-aware sorting (:172-188) — then **never reads `parent_fitness` again**; generation 1 still seeds from the unsorted `parent_genomes`. Every persisted offspring is written with `fitness_json: None, fitness_overall: None` (:206-207) — fitness is *never* computed for any offspring. For multi-generation runs, the "use top offspring as new parents" step (:218-231) just does `.take(4)` in pairwise-emission order — i.e. the first four by parent index, not by fitness.
- **Root cause**: Fitness evaluation was wired for parents but never propagated to offspring or used to drive selection; the sort result is dead. The `generations > 1` path therefore performs an undirected random walk, not directed evolution.
- **Impact**: The breeding feature does not do what it claims. Results can't be ranked (the UI's `fitness_overall` column is always null), `genome_get_breeding_results` returns unscored blobs, and the user adopts offspring (`genome_adopt_offspring`) with no fitness signal. Multi-generation breeding is pure noise amplification — later generations are *less* related to good parents, not more.
- **Fix sketch**: After persisting each offspring, compute a fitness proxy (or run the lab eval) and write `fitness_overall`; rank by it for the next generation's seed set; either use `parent_fitness` to seed generation 1 or delete it. At minimum, document that this run is unevaluated and remove the "computes fitness / top offspring" wording.
- **Value**: impact=7 effort=4

## 3. Dream-replay double-counts the root span's aggregate into per-frame cumulative cost/tokens
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / wrong-results
- **File**: src-tauri/src/engine/dream_replay.rs:189-198 (accumulate on span end) and :239-246 (root totals); cost source at src-tauri/src/engine/trace.rs:420-426
- **Scenario**: `SpanTracer::finalize` sets `root.cost_usd = total_cost_usd` (trace.rs:423) — the *whole-execution aggregate* — while each child span already carries its own `cost_usd` from `end_span`. `build_dream_replay` iterates **all** spans (root included) and adds `span.cost_usd` to `cumulative_cost` whenever a span ends (:190-198). When the root's end event is processed, its aggregate total is added on top of the already-summed children, so the final frame's `cumulative_cost_usd` ≈ (sum of children) + (total) ≈ 2× the true total. Identical double-count for `cumulative_input/output_tokens`.
- **Root cause**: Mixing two cost conventions — per-leaf costs on children vs. a roll-up total on root — in one additive pass, without excluding the root (or any aggregate-bearing span) from accumulation.
- **Impact**: The VCR cost/token curve climbs to roughly double, and the last frame's cumulative disagrees with the session header `total_cost_usd` (:257, correctly taken from root). Erodes trust in the debugging tool and can mislead cost investigations. No crash/data loss (display-only).
- **Fix sketch**: Skip the root span (and any span whose `cost_usd` is a roll-up) when accumulating per-frame totals — e.g. `if span.parent_span_id.is_some()` before adding — or accumulate only leaf spans. Assert final `cumulative_cost == total_cost_usd` in a test.
- **Value**: impact=5 effort=2

## 4. Adoption silently drops the `sensitive` and `headless` genome genes (safety downgrade)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / safety-downgrade
- **File**: src-tauri/src/commands/execution/genome.rs:359-385 (INSERT); gene captured at src-tauri/src/engine/genome.rs:206-210
- **Scenario**: A genome bred/extracted from a **sensitive** persona carries `config.sensitive = true` and `config.headless`. `genome_adopt_offspring` inserts the new persona with `sensitive` hard-coded to `0i32` (:374, `// sensitive`) and omits `headless` from the column list entirely (:359-364). The offspring of a sensitive persona is therefore minted as non-sensitive, and the headless behavior gene is lost (falls to DB default).
- **Root cause**: The INSERT hand-maps genome fields but ignores `genome.config.sensitive` and `genome.config.headless`, despite both being first-class genes the rest of the pipeline crosses over and mutates.
- **Impact**: A persona that an operator marked sensitive (gating/approval semantics) loses that flag the moment it's adopted as offspring — a silent security/governance downgrade — and behavioral `headless` intent is discarded, changing how the adopted agent runs.
- **Fix sketch**: Bind `genome.config.sensitive` to the `sensitive` param and add a `headless` column to the INSERT bound to `genome.config.headless`. If intentional (e.g. "always re-review adopted personas"), document it and surface it in the adopt UI rather than silently flipping the bit.
- **Value**: impact=5 effort=2

## 5. `compute_fitness` undocumented saturation constants + zero-history collapses to 0.0 (indistinguishable from worst)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: magic-number / unclear-semantics / silent-degradation
- **File**: src-tauri/src/engine/genome.rs:507-514 (empty→0.0) and :549-555 (60_000.0, 1.0 ceilings)
- **Scenario**: Two undocumented normalization ceilings hardcode the fitness scale: `speed = 1 - avg_duration/60_000` and `cost = 1 - avg_cost/1.0`. Any persona whose mean duration > 60s, or mean cost > $1.00, saturates that component to 0 regardless of the objective's `speed`/`cost` weights — so a slow-but-excellent or expensive-but-excellent persona is scored purely on `quality`, and two such personas are indistinguishable on those axes. Separately, a persona with **no** `cost_quality` knowledge returns `overall: 0.0` (:507-514) — identical to a persona that always fails — so brand-new personas read as maximally unfit.
- **Root cause**: Hard-coded domain ceilings (60s, $1) with no config, no doc rationale, and no per-portfolio calibration; plus "no data" and "worst data" both map to 0.0 with no sentinel/`Option` to distinguish "unknown" from "bad."
- **Impact**: Fitness loses discrimination for slow/expensive cohorts and mis-labels untested personas as worst — skewing any ranking, the evolution incumbent-fitness report (evolution.rs:227/463), and (once finding #2 is fixed) breeding selection. Quietly degrades evolution quality with no warning.
- **Fix sketch**: Promote `60_000.0` and `1.0` to named, documented constants (or policy-configurable, percentile-calibrated bounds); return `Option<FitnessScore>`/a `has_data` flag so callers can treat "no history" as unknown rather than 0.0; log when a component saturates.
- **Value**: impact=5 effort=3
