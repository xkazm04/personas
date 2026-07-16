# Genome & Evolution — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Evolution promotion is a no-op for structured-prompt personas, yet writes unevaluated config genes to the live persona
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/evolution.rs:427-429, 654-677
- **Scenario**: A persona with a non-null `structured_prompt` has auto-evolution enabled. A cycle runs: each variant is evaluated with `variant_persona.structured_prompt = None` (line 429) so the mutated `system_prompt` is what gets scored. The winner beats the threshold and `promote_variant` fires — writing the new `system_prompt` but also `winner.structured_prompt`, which is an untouched clone of the incumbent's structured prompt (mutation never alters it).
- **Root cause**: Prompt assembly (src-tauri/src/engine/prompt/mod.rs:249, confirmed by test at :1214 — "system_prompt should NOT appear since structured_prompt is used") ignores `system_prompt` whenever `structured_prompt` exists. Promotion assumes the evaluated artifact (system_prompt with structured cleared) is what will run in production; it isn't. Additionally, promotion writes `timeout_ms`, `max_concurrent`, `model_profile`, `max_budget_usd`, `max_turns` from the winner genome — genes that `mutate()` randomizes (timeout ±20%, max_concurrent 1–5) but that were NEVER applied to the eval persona (`persona.clone()` keeps incumbent values), so they ship with zero evidence.
- **Impact**: Success theater: `promoted = true`, `total_promotions` increments, cycle UI reports an improvement — but the persona's runtime behavior is unchanged (structured prompt still wins). Meanwhile genuinely unevaluated config mutations (e.g. a −20% timeout jiggle or `max_concurrent: 5`) silently go live on the incumbent.
- **Fix sketch**: In `promote_variant`, set `structured_prompt = NULL` (the evaluated configuration) or refuse promotion for structured-prompt personas; only write model/config genes that were actually applied during evaluation (or apply them to `variant_persona` before evaluating).

## 2. One manual "trigger cycle" silently opts the persona into perpetual auto-evolution
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/execution/evolution.rs:171-187
- **Scenario**: A user with no evolution policy clicks "Trigger cycle" once to try the feature. `evolution_trigger_cycle` finds no policy and upserts a default one with `enabled: Some(true)`. From then on, the post-execution auto-trigger (src-tauri/src/engine/mod.rs:2535) fires a full evolution cycle every `min_executions_between` completed executions — spawning CLI evaluations (real token spend) and potentially overwriting the persona's prompt — without the user ever enabling auto-evolution.
- **Root cause**: "Run one cycle now" is conflated with "enable the closed-loop policy". The default policy created for a one-off manual run persists with `enabled = true`.
- **Impact**: Unrequested recurring LLM spend and unattended prompt rewrites on the live persona; the user only discovers it when cycles appear in history or the persona's prompt changes.
- **Fix sketch**: Create the implicit policy with `enabled: Some(false)` (manual `run_evolution_cycle` doesn't consult `enabled`), or use an ephemeral in-memory policy for manual triggers and require the explicit toggle for auto-evolution.

## 3. Transient CLI failures score as 0.0 and can promote a variant on infrastructure noise
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/evolution.rs:405-447, 618-626
- **Scenario**: During a cycle, the Claude CLI is briefly unavailable (usage limit, network blip) while the incumbent baseline is scored first — every `execute_scenario` errors and each failure is counted as score 0 (`count += 1` in the `Err` arm), so `incumbent_avg = 0.0`. The CLI recovers by the time variants are evaluated; any variant scoring above `improvement_threshold` (default ≤0.5) now "beats" the incumbent and is promoted.
- **Root cause**: Evaluation cannot distinguish "the persona performed badly" from "the harness failed to run the scenario"; both collapse to 0.0, and the promote decision is a bare `variant − incumbent` delta with no minimum-successful-run guard.
- **Impact**: The live persona's prompt (and config, see finding 1) is permanently overwritten based on an artifact of a transient outage, not measured quality. The reverse asymmetry (variants fail, incumbent fine) silently wastes the whole cycle's spend.
- **Fix sketch**: Track success/error counts separately in `evaluate_persona_on_scenarios`; if the incumbent (or a candidate winner) had zero successful scenario runs, fail the cycle instead of promoting. Optionally require N successful scenarios per side before comparing.

## 4. `genome_adopt_offspring` has no already-adopted guard — double-adopt mints duplicate personas and orphans the first
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/execution/genome.rs:377-492
- **Scenario**: User double-clicks "Adopt" on a breeding result (or adopts from two windows). Both invocations read `genome_json`, neither checks the `adopted` flag, and each inserts a brand-new persona. The second `UPDATE ... SET adopted = 1, adopted_persona_id = ?` overwrites the first persona's id, leaving persona #1 live but untracked by any breeding result.
- **Root cause**: The transaction guarantees atomicity of one adoption but the operation is not idempotent — there is no `WHERE adopted = 0` conditional or pre-check, so concurrent/repeated calls all succeed. Secondary gap at :413-421: if the first parent persona was since deleted, `project_id` silently falls back to `"default"`, dropping the offspring into the wrong project with no warning.
- **Impact**: Duplicate personas accumulate from UI double-clicks; the breeding-results screen shows one adopted persona while others exist unlinked; deleted-parent offspring land in the wrong project silently.
- **Fix sketch**: Make step 3 conditional (`UPDATE ... WHERE id = ?2 AND adopted = 0`) and abort the transaction with a Validation error ("already adopted") when 0 rows are affected; surface the project-fallback as an explicit error or warning instead of defaulting.

## 5. Breeding run reports "Bred N offspring" and Completed even when persisting offspring failed
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/execution/genome.rs:239-243, 257-273
- **Scenario**: During `run_breeding_pipeline`, `genome_repo::create_result` fails (locked DB, disk full, oversized genome JSON). The error is only `tracing::warn!`-ed, `offspring_count += 1` still executes, and the run finishes as `Completed` with summary "Bred N offspring across G generations" — while `genome_get_breeding_results` returns fewer (possibly zero) rows. Also, since `unwrap_or_default()` at :226 can serialize a genome to `""`, a persisted-but-empty `genome_json` row would later fail adoption with a confusing parse error.
- **Root cause**: Persistence failures are treated as non-events; the run's success status and the counter are decoupled from what actually landed in the DB (success theater at the trust boundary between the pipeline and its own storage).
- **Impact**: The UI shows a green completed run advertising N offspring, but the results list is shorter or empty — an undebuggable mismatch for the user; the fittest offspring may be exactly the ones lost.
- **Fix sketch**: Increment `offspring_count` only on successful insert; track a `failed_persists` counter and, if > 0, finish the run as Failed (or Completed-with-error) with the discrepancy in `error`/`summary`. Treat genome serialization failure as an error rather than persisting an empty string.
