use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::cli_process::CliProcessDriver;
use super::event_registry::event_name;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// TTL-based in-memory cache for generated scenarios. Key is a hash of
/// (persona_id, system_prompt, tools, use_case_filter). Avoids re-running
/// the expensive CLI+LLM scenario generation during iterative model comparison.
static SCENARIO_CACHE: std::sync::LazyLock<Mutex<HashMap<u64, (Instant, Vec<TestScenario>)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

const SCENARIO_CACHE_TTL_SECS: u64 = 600;

/// Model for the lab/test/evolution tooling (scenario generation, result
/// summaries, draft + improvement passes). Pinned deliberately — without an
/// explicit `--model` these headless spawns ride the undeclared account default
/// (typically Opus 4.8), making cost neither predictable nor aligned with the
/// rest of the headless tier. Mirrors `DEFAULT_CAPABILITY_MODEL` /
/// `SYNTHESIS_MODEL` (tiger finding: lab tier rode account-default).
const LAB_MODEL: &str = "claude-sonnet-4-6";

/// Maximum number of lab cells (model × variant × scenario executions) allowed to
/// run their CLI child concurrently within a single run. `run_lab_loop` used to
/// `tokio::spawn` every model×variant pair for a scenario at once with no cap,
/// so a wide roster (e.g. 6 models × 2 variants) launched a dozen Claude CLI
/// children simultaneously — heavy on CPU, memory, and subscription rate limits.
/// A small semaphore bounds the in-flight fan-out while keeping enough parallelism
/// to hide per-cell latency. Tune here.
const LAB_CELL_CONCURRENCY: usize = 4;

/// Resolve when the shared cancellation flag flips to `true`, polling on a short
/// interval. Used to race a running cell's CLI execution against cancellation so
/// the in-flight child is dropped (and, via `kill_on_drop`, killed) within a
/// second or two of cancel rather than blocking on the per-cell CLI timeout.
async fn await_cancel(flag: &Arc<std::sync::atomic::AtomicBool>) {
    while !flag.load(std::sync::atomic::Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Truncate `s` to at most `max_chars` characters without splitting a multibyte
/// UTF-8 character. Byte-range slicing (`&s[..n]`) panics when `n` lands
/// mid-glyph, which LLM output (emoji, smart quotes, em-dashes, CJK) routinely
/// produces — so previews here must count characters, not bytes.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Cache key for a persona's generated test scenarios.
///
/// DELIBERATELY excludes the prompt text. The Lab's "Versions & Ratings" Δ column
/// compares two prompt *versions* of one persona, and a version-scoped measure
/// swaps that version's prompt onto the persona before generating scenarios
/// (`lab_start_arena` version resolution). If the prompt were in this key, v1 and
/// v2 would each generate — and be graded on — a *different* LLM-invented exam,
/// so the Δ would subtract scores earned on different questions. UAT 2026-07-20
/// proved it live: a one-line prompt tweak produced a 0-of-4-overlap scenario set
/// and a +54.7-pt "improvement" that was pure exam drift.
///
/// Keying on `(persona.id, tools, use_case_filter)` instead pins one scenario set
/// per persona, so every version is graded against the same questions and the Δ
/// is apples-to-apples. The tradeoff (accepted): a persona whose prompt was
/// materially rewritten keeps, for up to the cache TTL, an exam authored before
/// the rewrite. `fixture_inputs` runs already bypass the cache for fresh data,
/// and the TTL bounds staleness. Do NOT re-add the prompt here without also
/// making the Δ column scenario-set-aware.
fn scenario_cache_key(
    persona: &crate::db::models::Persona,
    tools: &[crate::db::models::PersonaToolDefinition],
    use_case_filter: Option<&str>,
) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    persona.id.hash(&mut hasher);
    for t in tools {
        t.name.hash(&mut hasher);
        t.description.hash(&mut hasher);
    }
    if let Some(f) = use_case_filter {
        f.hash(&mut hasher);
    }
    hasher.finish()
}

use super::types::EphemeralPersona;
use crate::db::models::{
    CreateAbResultInput, CreateArenaResultInput, CreateConsensusResultInput, CreateEvalResultInput,
    CreateLabResultBaseInput, CreateLabResultEventInput, CreateMatrixResultInput,
    CreateTestResultInput, LabResultKind, LabRunStatus, Persona, PersonaToolDefinition,
};
use crate::db::repos::execution::test_runs as repo;
use crate::db::repos::lab::ab as ab_repo;
use crate::db::repos::lab::arena as arena_repo;
use crate::db::repos::lab::consensus as consensus_repo;
use crate::db::repos::lab::eval as eval_repo;
use crate::db::repos::lab::events as events_repo;
use crate::db::repos::lab::matrix as matrix_repo;
use crate::db::DbPool;

use super::eval::{
    self, EvalInput, WEIGHT_OUTPUT_QUALITY, WEIGHT_PROTOCOL_COMPLIANCE, WEIGHT_TOOL_ACCURACY,
};
use super::parser;
use super::prompt;
use super::types::*;

// -- Types ------------------------------------------------------

/// Model configuration for a test run, passed from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestModelConfig {
    pub id: String,
    pub provider: String,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub auth_token: Option<String>,
    /// Effort level: "low" / "medium" / "high".
    /// `None` falls back to `prompt::DEFAULT_EFFORT` ("medium").
    /// The lab uses this to vary effort across test cells alongside model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

/// Parse and validate model configs from frontend JSON values.
pub fn parse_model_configs(
    models: Vec<serde_json::Value>,
) -> Result<Vec<TestModelConfig>, crate::error::AppError> {
    let mut configs: Vec<TestModelConfig> = Vec::new();
    for v in models {
        match serde_json::from_value(v.clone()) {
            Ok(config) => configs.push(config),
            Err(e) => {
                return Err(crate::error::AppError::Validation(format!(
                    "Invalid model config: {e}"
                )))
            }
        }
    }
    if configs.is_empty() {
        return Err(crate::error::AppError::Validation(
            "No valid models provided".into(),
        ));
    }
    Ok(configs)
}

/// A test scenario generated by the coordinator LLM.
///
/// Wire format: snake_case (no `rename_all` annotation). Frontend consumers must
/// read `input_data`, `mock_tools`, `expected_behavior`, `expected_tool_sequence`,
/// `expected_protocols` as snake_case. The `mapRunStatusPayload` bridge in
/// `src/hooks/realtime/useRunEventListener.ts` does NOT recursively camelCase
/// nested objects; this type is passed through.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TestScenario {
    pub name: String,
    pub description: String,
    pub input_data: Option<serde_json::Value>,
    pub mock_tools: Vec<MockToolResponse>,
    pub expected_behavior: String,
    pub expected_tool_sequence: Option<Vec<String>>,
    pub expected_protocols: Option<Vec<String>>,
}

/// A mock tool response within a scenario.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MockToolResponse {
    pub tool_name: String,
    pub description: Option<String>,
    pub mock_response: serde_json::Value,
}

/// Tauri event payload for test run progress.
///
/// Wire format: snake_case. Subscriber bridge: `mapRunStatusPayload` in
/// `src/hooks/realtime/useRunEventListener.ts` flattens snake_case → camelCase
/// for top-level fields but leaves `scores` and `scenarios` as-is.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct TestRunStatusEvent {
    pub run_id: String,
    pub phase: String,
    pub scenarios_count: Option<usize>,
    pub current: Option<usize>,
    pub total: Option<usize>,
    pub model_id: Option<String>,
    pub scenario_name: Option<String>,
    pub status: Option<String>,
    pub scores: Option<TestScores>,
    pub summary: Option<serde_json::Value>,
    pub error: Option<String>,
    /// Emitted once during the "generated" phase so the frontend can save scenarios to a suite.
    pub scenarios: Option<Vec<TestScenario>>,
    /// Elapsed wall-clock milliseconds since the run started (for live progress display).
    pub elapsed_ms: Option<u64>,
}

/// Per-scenario scores; serialized snake_case directly into TestRunStatusEvent.scores.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TestScores {
    pub tool_accuracy: Option<i32>,
    pub output_quality: Option<i32>,
    pub protocol_compliance: Option<i32>,
}

// -- Main entry point -------------------------------------------

/// Run a full test session: generate scenarios, execute across models, score, summarize.
/// If `preloaded_scenarios` is Some, skip generation and use those scenarios directly.
///
/// Thin wrapper around the shared `run_lab_loop` (the same engine arena, A/B,
/// eval, matrix, and consensus modes use) — see the refactor-audit note on
/// `run_lab_loop` for why this consolidation exists. What stays here, because
/// it genuinely isn't part of the generic shape: the `preloaded_scenarios` /
/// `fixture_inputs` passthrough (threaded into `run_lab_loop` as params), the
/// P2 aggregate-cost budget ledger (wired via `LabCallbacks::should_halt_budget`
/// / `record_cost`, register/finish as bookends), and the dashboard
/// "recent activity" feed (`process_activity`, which only standard test runs
/// emit — no other lab mode does).
#[allow(clippy::too_many_arguments)]
pub async fn run_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    model_configs: Vec<TestModelConfig>,
    _log_dir: PathBuf,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
    preloaded_scenarios: Option<Vec<TestScenario>>,
    fixture_inputs: Option<String>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;

    // P2: track aggregate cost across this run's scenario × model spawns.
    crate::engine::run_budget::ledger().register(
        &run_id,
        "lab",
        crate::engine::run_budget::lab_ceiling_usd(),
    );

    super::process_activity::emit_process_activity(
        &app,
        "test",
        "started",
        Some(&run_id),
        Some(&persona.name),
    );

    // Single unlabeled variant: standard tests don't compare persona
    // variants, only models — matching the (empty-label) key shape
    // `build_arena_summary` already expects.
    let variants = vec![LabVariant {
        persona,
        label: String::new(),
        tools: Vec::new(),
    }];

    let cb = LabCallbacks {
        event_name: event_name::TEST_RUN_STATUS,
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(|pool, run_id, _variant, scenario, model, status, scores| {
            let input = CreateTestResultInput {
                test_run_id: run_id.to_string(),
                scenario_name: scenario.name.clone(),
                model_id: model.id.clone(),
                provider: model.provider.clone(),
                status: status.to_string(),
                output_preview: scores.output_preview.clone(),
                tool_calls_expected: scenario
                    .expected_tool_sequence
                    .as_ref()
                    .map(|v| crate::db::models::Json(v.clone())),
                tool_calls_actual: scores.tool_calls_actual.clone(),
                tool_accuracy_score: scores.tool_accuracy,
                output_quality_score: scores.output_quality,
                protocol_compliance: scores.protocol_compliance,
                input_tokens: scores.input_tokens,
                output_tokens: scores.output_tokens,
                cost_usd: scores.cost_usd,
                duration_ms: scores.duration_ms,
                error_message: scores.error_message.clone(),
            };
            if let Err(e) = repo::create_result(pool, &input) {
                tracing::error!("Test result create failed: {e}");
            }
        }),
        build_summary: Box::new(build_arena_summary),
        // `persona_test_runs` has no llm_summary column (unlike the other lab
        // run tables) — the prose summary `run_lab_loop` generates is simply
        // not persisted for standard tests. Known trade-off of the
        // consolidation: standard runs now pay for that extra LLM call same
        // as every other lab mode, with nowhere (yet) to show the result.
        update_llm_summary: Box::new(|_pool, _id, _text| {}),
        should_halt_budget: Box::new(|run_id| crate::engine::run_budget::ledger().should_halt(run_id)),
        record_cost: Box::new(|run_id, cost_usd| {
            // scores.cost_usd mirrors lab_results.cost_usd, so the ledger
            // total tracks SUM(persona_test_results.cost_usd) for this run.
            let outcome = crate::engine::run_budget::ledger().record(run_id, cost_usd);
            if outcome.exceeded_now {
                tracing::warn!(
                    run_id,
                    spent_usd = outcome.spent_usd,
                    ceiling_usd = outcome.ceiling_usd,
                    "Lab run exceeded its aggregate budget ceiling (warn-only; run continues)",
                );
            }
        }),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        fixture_inputs.as_deref(),
        preloaded_scenarios,
        &cb,
    )
    .await;

    // P2: finalize + persist the run's budget (in-memory 30m; the row survives
    // restarts for cost-trend dashboards).
    if let Some(budget) = crate::engine::run_budget::ledger().finish(&run_id) {
        if let Err(e) = crate::db::repos::run_budget::persist(&pool, &budget) {
            tracing::warn!(run_id = %run_id, "run-budget persist failed: {e}");
        }
    }

    // Dashboard activity feed: only announce "completed" when the run
    // actually finalized as Completed (mirrors the old unconditional-success
    // emission, but now correctly stays silent on Failed/Cancelled instead of
    // always claiming success once the loop returns).
    if let Ok(run) = repo::get_run_by_id(&pool, &run_id) {
        if run.status == LabRunStatus::Completed {
            super::process_activity::emit_process_activity(
                &app,
                "test",
                "completed",
                Some(&run_id),
                Some(&persona.name),
            );
        }
    }
}

// -- Phase 1: Generate scenarios --------------------------------

pub(crate) async fn generate_scenarios(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    use_case_filter: Option<&str>,
    fixture_inputs: Option<&str>,
    pool: &DbPool,
) -> Result<Vec<TestScenario>, String> {
    // Check cache when no fixture inputs (fixtures imply custom data, not cacheable)
    if fixture_inputs.is_none() {
        let key = scenario_cache_key(persona, tools, use_case_filter);
        let cache = SCENARIO_CACHE.lock().await;
        if let Some((created, scenarios)) = cache.get(&key) {
            if created.elapsed().as_secs() < SCENARIO_CACHE_TTL_SECS {
                tracing::debug!(persona_id = %persona.id, "Using cached scenarios");
                return Ok(scenarios.clone());
            }
        }
        drop(cache);
    }

    let coordinator_prompt =
        build_coordinator_prompt(persona, tools, use_case_filter, fixture_inputs);

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(LAB_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let output = spawn_cli_and_collect(
        &cli_args,
        &coordinator_prompt,
        pool,
        crate::db::repos::llm_spend::SpendCtx {
            source: "evaluator",
            trigger_kind: "lab_scenario",
            model: Some(LAB_MODEL),
            persona_id: Some(&persona.id),
            project_id: None,
        },
    )
    .await?;
    let scenarios = parse_scenarios_from_output(&output)?;

    // Never cache empty results — doing so would poison the cache for up to 10 minutes,
    // causing all subsequent runs to silently complete with zero scenarios.
    if scenarios.is_empty() {
        tracing::warn!(persona_id = %persona.id, "Scenario generation produced no results, skipping cache");
        return Ok(scenarios);
    }

    // Store in cache when no fixture inputs
    if fixture_inputs.is_none() {
        let key = scenario_cache_key(persona, tools, use_case_filter);
        let mut cache = SCENARIO_CACHE.lock().await;
        // Evict expired entries opportunistically
        cache.retain(|_, (created, _)| created.elapsed().as_secs() < SCENARIO_CACHE_TTL_SECS);
        cache.insert(key, (Instant::now(), scenarios.clone()));
    }

    Ok(scenarios)
}

fn build_coordinator_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    use_case_filter: Option<&str>,
    fixture_inputs: Option<&str>,
) -> String {
    let mut p = String::new();

    p.push_str("# Test Scenario Generator\n\n");
    p.push_str("You are a QA engineer generating test scenarios for an AI agent.\n\n");

    // Agent identity
    p.push_str("## Agent Under Test\n");
    p.push_str(&format!("**Name**: {}\n", persona.name));
    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            p.push_str(&format!("**Description**: {desc}\n"));
        }
    }
    p.push('\n');

    // Agent prompt
    p.push_str("### Agent Prompt\n");
    if let Some(ref sp_json) = persona.structured_prompt {
        if let Ok(sp) = serde_json::from_str::<serde_json::Value>(sp_json) {
            for section in &[
                "identity",
                "instructions",
                "toolGuidance",
                "examples",
                "errorHandling",
            ] {
                if let Some(val) = sp.get(section).and_then(|v| v.as_str()) {
                    if !val.is_empty() {
                        p.push_str(&format!("**{section}**: {val}\n\n"));
                    }
                }
            }
        }
    } else if !persona.system_prompt.is_empty() {
        p.push_str(&persona.system_prompt);
        p.push_str("\n\n");
    }

    // Available tools
    if !tools.is_empty() {
        p.push_str("### Available Tools\n");
        for tool in tools {
            p.push_str(&format!(
                "- **{}** ({}): {}\n",
                tool.name, tool.category, tool.description
            ));
            if let Some(ref schema) = tool.input_schema {
                p.push_str(&format!("  Input schema: {schema}\n"));
            }
        }
        p.push('\n');
    }

    // Task instructions
    p.push_str("## Your Task\n");
    p.push_str("Generate 3-5 realistic test scenarios for this agent. Each scenario must:\n");
    p.push_str("1. Represent a plausible real-world situation this agent would handle\n");
    p.push_str("2. Include realistic mock tool responses for every tool the agent might call\n");
    p.push_str("3. Describe the expected behavior and output\n\n");

    // Output format
    p.push_str("## Output Format\n");
    p.push_str("Respond with ONLY a JSON array (no markdown fences, no extra text):\n");
    p.push_str(
        r#"[{
  "name": "Short scenario name",
  "description": "What this scenario tests",
  "input_data": {},
  "mock_tools": [{
    "tool_name": "tool_name_here",
    "description": "What this mock simulates",
    "mock_response": {}
  }],
  "expected_behavior": "Description of what a good response looks like",
  "expected_tool_sequence": ["tool1", "tool2"],
  "expected_protocols": ["user_message"]
}]"#,
    );

    // If a use case filter is provided, extract the matching use case from design_context
    // and append focused instructions
    if let Some(uc_id) = use_case_filter {
        if let Some(ref dc_json) = persona.design_context {
            if let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) {
                if let Some(use_cases) = dc.get("use_cases").and_then(|v| v.as_array()) {
                    for uc in use_cases {
                        let id = uc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if id == uc_id {
                            let title = uc
                                .get("title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown");
                            let desc = uc.get("description").and_then(|v| v.as_str()).unwrap_or("");
                            let category =
                                uc.get("category").and_then(|v| v.as_str()).unwrap_or("");

                            p.push_str("\n\n## FOCUS: Specific Use Case\n");
                            p.push_str(
                                "Generate ALL test scenarios specifically for this use case:\n",
                            );
                            p.push_str(&format!("- **Title**: {title}\n"));
                            if !desc.is_empty() {
                                p.push_str(&format!("- **Description**: {desc}\n"));
                            }
                            if !category.is_empty() {
                                p.push_str(&format!("- **Category**: {category}\n"));
                            }

                            // Include sample_input if available
                            if let Some(sample) = uc.get("sample_input") {
                                if !sample.is_null() {
                                    p.push_str(&format!(
                                        "- **Sample Input**: {}\n",
                                        serde_json::to_string_pretty(sample).unwrap_or_default()
                                    ));
                                }
                            }

                            p.push_str("\nAll scenarios must be realistic variations of this specific use case. ");
                            p.push_str("Do NOT generate scenarios for other use cases.\n");
                            break;
                        }
                    }
                }
            }
        }
    }

    // Include fixture inputs when provided -- these are user-defined test inputs
    // that should be used as the input_data for at least one generated scenario
    if let Some(inputs_json) = fixture_inputs {
        p.push_str("\n\n## Test Fixture Inputs\n");
        p.push_str("The user has provided specific test inputs. Use these as the `input_data` ");
        p.push_str("for at least one of the generated scenarios:\n```json\n");
        p.push_str(inputs_json);
        p.push_str("\n```\n");
        p.push_str("Generate at least one scenario that uses these exact inputs, ");
        p.push_str("and additional scenarios that are realistic variations.\n");
    }

    p
}

fn parse_scenarios_from_output(output: &str) -> Result<Vec<TestScenario>, String> {
    // Try to find a JSON array in the output
    // The output may contain other text before/after the JSON
    let trimmed = output.trim();

    // Try direct parse first
    if let Ok(scenarios) = serde_json::from_str::<Vec<TestScenario>>(trimmed) {
        return Ok(scenarios);
    }

    // Try to extract JSON array from the text
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            let json_str = &trimmed[start..=end];
            if let Ok(scenarios) = serde_json::from_str::<Vec<TestScenario>>(json_str) {
                return Ok(scenarios);
            }
        }
    }

    Err(format!(
        "Failed to parse test scenarios from coordinator output. Raw output (first 500 chars): {}",
        truncate_chars(trimmed, 500)
    ))
}

// -- Phase 2: Execute scenario with a specific model ------------

/// Per-scenario pass threshold on the composite score
/// (tool*0.4 + quality*0.4 + protocol*0.2). Mirrors eval.rs's `>= 50` verdict.
const SCENARIO_PASS_THRESHOLD: f64 = 50.0;

/// Weighted composite (0-100) renormalised over whichever sub-scores are
/// present, mirroring `db::repos::lab::ratings::composite_from_parts` (which does
/// the same at the aggregate rating level). `None` only when every sub-score is
/// absent.
///
/// This is what makes **sandbox cells** scorable. A sandbox scenario instructs
/// the agent NOT to call real tools (see [`build_sandbox_section`]), so its
/// `tool_accuracy` is deliberately absent (`score_result` stores NULL). Treating
/// that absence as a literal `0` — the old `unwrap_or(0)` — sank an
/// otherwise-passing cell (e.g. output_quality 80 / protocol 80 gave a composite
/// of 48, below the 50 threshold, so it "failed"). Renormalising over the
/// present weights instead scores it on its own terms (→ 80). Cells with all
/// three sub-scores present (every real-tool cell) renormalise over the full
/// weight base, so the result is identical to the previous weighted sum — real
/// scoring is unchanged.
fn renormalized_composite(ta: Option<f64>, oq: Option<f64>, pc: Option<f64>) -> Option<f64> {
    let mut sum = 0.0;
    let mut wsum = 0.0;
    for (val, w) in [
        (ta, WEIGHT_TOOL_ACCURACY),
        (oq, WEIGHT_OUTPUT_QUALITY),
        (pc, WEIGHT_PROTOCOL_COMPLIANCE),
    ] {
        if let Some(v) = val {
            sum += v * w;
            wsum += w;
        }
    }
    if wsum > 0.0 {
        Some(sum / wsum)
    } else {
        None
    }
}

/// Derive a real pass/fail verdict from the scores instead of conflating "the
/// CLI returned Ok" with "the scenario passed". A scenario whose evaluation did
/// not actually run — LLM eval timed out / fell back to heuristics, which return
/// optimistic "nothing-expected = 100" sentinels — is reported "inconclusive",
/// never "passed", so a total eval outage can't masquerade as green.
///
/// The composite renormalises over the *present* sub-scores (see
/// [`renormalized_composite`]): a sandbox cell carries no `tool_accuracy`, so it
/// must not be counted as a zero. A cell with no sub-scores at all is
/// "inconclusive" rather than a spurious "failed".
fn verdict_status(s: &ScoreResult) -> String {
    if matches!(
        s.eval_method.as_deref(),
        Some("timeout") | Some("heuristic_fallback")
    ) {
        return "inconclusive".to_string();
    }
    match renormalized_composite(
        s.tool_accuracy.map(|v| v as f64),
        s.output_quality.map(|v| v as f64),
        s.protocol_compliance.map(|v| v as f64),
    ) {
        Some(composite) if composite >= SCENARIO_PASS_THRESHOLD => "passed".to_string(),
        Some(_) => "failed".to_string(),
        None => "inconclusive".to_string(),
    }
}

pub(crate) struct ScoreResult {
    pub(crate) tool_accuracy: Option<i32>,
    pub(crate) output_quality: Option<i32>,
    pub(crate) protocol_compliance: Option<i32>,
    pub(crate) output_preview: Option<String>,
    pub(crate) tool_calls_actual: Option<crate::db::models::Json<Vec<String>>>,
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cost_usd: f64,
    pub(crate) duration_ms: i64,
    pub(crate) error_message: Option<String>,
    pub(crate) rationale: Option<String>,
    pub(crate) suggestions: Option<String>,
    pub(crate) eval_method: Option<String>,
    /// Captured stream events from the CLI execution. Carried through scoring
    /// so per-mode persist callbacks can write them into `lab_result_events`
    /// keyed by the freshly-created result row's id.
    pub(crate) events: Vec<CreateLabResultEventInput>,
}

impl ScoreResult {
    /// Build a placeholder result for a cancelled or errored cell: every
    /// score/telemetry field is empty/zeroed, and `error_message` carries `msg`.
    /// Callers that also want `output_preview` populated (the "error" branch,
    /// as opposed to "cancelled") should set it on the returned value.
    ///
    /// Replaces four verbatim-duplicated 17-field `ScoreResult` literals that
    /// had drifted apart across `run_test` and `run_lab_loop` (refactor audit,
    /// Theme I).
    fn from_error(msg: impl Into<String>) -> ScoreResult {
        let msg = msg.into();
        ScoreResult {
            tool_accuracy: None,
            output_quality: None,
            protocol_compliance: None,
            output_preview: None,
            tool_calls_actual: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            duration_ms: 0,
            error_message: Some(msg),
            rationale: None,
            suggestions: None,
            eval_method: None,
            events: Vec::new(),
        }
    }
}

pub(crate) async fn execute_scenario(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    scenario: &TestScenario,
    model: &TestModelConfig,
) -> Result<ExecutionOutput, String> {
    // Build the base prompt
    let base_prompt = prompt::assemble_prompt(
        persona,
        tools,
        scenario.input_data.as_ref(),
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );

    // Inject sandbox mock section before the EXECUTE NOW section
    let sandbox_section = build_sandbox_section(&scenario.mock_tools);
    let final_prompt = inject_sandbox_into_prompt(&base_prompt, &sandbox_section);

    // Build CLI args for this model
    let model_profile = ModelProfile {
        model: model.model.clone(),
        provider: Some(model.provider.clone()),
        base_url: model.base_url.clone(),
        auth_token: model.auth_token.clone(),
        prompt_cache_policy: None,
        // Lab can vary --effort across cells alongside model. Falls back to
        // prompt::DEFAULT_EFFORT when None.
        effort: model.effort.clone(),
    };

    // Native Ollama path: call HTTP API directly instead of spawning Claude CLI
    if model.provider == super::types::providers::OLLAMA {
        return execute_scenario_ollama(&final_prompt, &model_profile).await;
    }

    let mut cli_args = prompt::build_cli_args(None, Some(&model_profile));

    // Limit turns for sandbox testing
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("3".to_string());

    // Run the CLI and collect structured output
    spawn_cli_and_collect_structured(&cli_args, &final_prompt).await
}

/// Execute a test scenario using native Ollama HTTP API.
/// Bypasses CLI — calls `/api/chat` directly and returns structured output.
async fn execute_scenario_ollama(
    prompt: &str,
    profile: &ModelProfile,
) -> Result<ExecutionOutput, String> {
    let base_url = profile
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let model = profile.model.as_deref().unwrap_or("gemma4");
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

    let start = std::time::Instant::now();

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "stream": false
    });

    let client = crate::SHARED_HTTP.clone();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama API error ({}): {}",
            status,
            truncate_chars(&text, 200)
        ));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Ollama JSON parse failed: {e}"))?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let assistant_text = json
        .pointer("/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let eval_count = json.get("eval_count").and_then(|v| v.as_u64()).unwrap_or(0);
    let prompt_eval_count = json
        .get("prompt_eval_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let events = if assistant_text.is_empty() {
        Vec::new()
    } else {
        vec![CreateLabResultEventInput {
            event_index: 0,
            event_type: "assistant_text".to_string(),
            tool_name: None,
            tool_args_preview: None,
            tool_result_preview: None,
            text_preview: Some(assistant_text.clone()),
            ts_ms_relative: duration_ms as i64,
        }]
    };

    Ok(ExecutionOutput {
        assistant_text,
        tool_calls: Vec::new(), // local models don't use tool protocol
        input_tokens: prompt_eval_count,
        output_tokens: eval_count,
        cost_usd: 0.0,
        duration_ms,
        error: None,
        events,
    })
}

fn build_sandbox_section(mock_tools: &[MockToolResponse]) -> String {
    let mut section = String::new();
    section.push_str("\n## SANDBOX TESTING MODE -- Simulated Tool Environment\n");
    section.push_str("You are running in test mode. Do NOT call actual tools.\n");
    section
        .push_str("Instead, use these simulated tool responses as if the tools returned them:\n\n");

    for mock in mock_tools {
        section.push_str(&format!(
            "### Simulated response for `{}`\n",
            mock.tool_name
        ));
        if let Some(ref desc) = mock.description {
            section.push_str(&format!("Context: {desc}\n"));
        }
        section.push_str("Assume it returns:\n```json\n");
        section.push_str(&serde_json::to_string_pretty(&mock.mock_response).unwrap_or_default());
        section.push_str("\n```\n\n");
    }

    section.push_str("Process these simulated results exactly as you would real tool responses.\n");
    section.push_str("Complete your full workflow and emit all appropriate protocol messages.\n");
    section.push_str("Do NOT mention that you are in test mode.\n\n");

    section
}

fn inject_sandbox_into_prompt(base_prompt: &str, sandbox_section: &str) -> String {
    // Insert the sandbox section before "## EXECUTE NOW" if it exists
    if let Some(pos) = base_prompt.find("## EXECUTE NOW") {
        let mut result = String::with_capacity(base_prompt.len() + sandbox_section.len());
        result.push_str(&base_prompt[..pos]);
        result.push_str(sandbox_section);
        result.push_str(&base_prompt[pos..]);
        result
    } else {
        // Fallback: append at end
        format!("{base_prompt}\n{sandbox_section}")
    }
}

// -- Scoring (delegates to unified eval framework + LLM eval) ---

pub(crate) async fn score_result(
    output: &ExecutionOutput,
    scenario: &TestScenario,
    persona: &Persona,
    pool: &DbPool,
) -> ScoreResult {
    let expected_tools = scenario.expected_tool_sequence.as_deref();
    let expected_protocols = scenario.expected_protocols.as_deref();

    // A scenario with mock tools ran in sandbox mode: the agent was told NOT to
    // call real tools (see `build_sandbox_section`), so its real-tool-call
    // channel is empty by construction and `tool_accuracy` measured as
    // expected-vs-actual real calls is degenerate.
    let is_sandbox = !scenario.mock_tools.is_empty();

    let eval_input = EvalInput {
        output: &output.assistant_text,
        expected_behavior: Some(&scenario.expected_behavior),
        expected_tools,
        actual_tools: Some(&output.tool_calls),
        expected_protocols,
        has_tools: true,
    };

    let tool_calls_json = if output.tool_calls.is_empty() {
        None
    } else {
        Some(crate::db::models::Json(output.tool_calls.clone()))
    };

    let preview = if output.assistant_text.is_empty() {
        None
    } else {
        Some(truncate_chars(&output.assistant_text, 2000))
    };

    // Try LLM-based evaluation for richer scoring with rationale/suggestions
    let llm_result = eval::eval_with_llm(
        &eval_input,
        &persona.name,
        persona.description.as_deref().unwrap_or(""),
        &scenario.name,
        &scenario.description,
        is_sandbox,
        pool,
        Some(persona.id.as_str()),
    )
    .await;

    // Serialize structured rationale as JSON for rich frontend display.
    // The rationale field stores a JSON object with per-metric breakdowns
    // when available, falling back to a plain string for older results.
    let rationale_json = serde_json::json!({
        "summary": llm_result.rationale,
        "verdict": llm_result.verdict,
        "tool_accuracy": llm_result.tool_accuracy_rationale,
        "output_quality": llm_result.output_quality_rationale,
        "protocol": llm_result.protocol_rationale,
    });

    // Exclude tool_accuracy from sandbox cells: store NULL so the composite
    // renormalises over output_quality + protocol_compliance (see
    // `renormalized_composite`) and the ratings rollup flags `partial_coverage`
    // instead of auto-failing the cell on a degenerate zero. The judge's
    // tool-usage rationale is still preserved in `rationale_json` above.
    let tool_accuracy = if is_sandbox {
        None
    } else {
        Some(llm_result.tool_accuracy.clamp(0, 100))
    };
    let output_quality = Some(llm_result.output_quality.clamp(0, 100));
    let protocol_compliance = Some(llm_result.protocol_compliance.clamp(0, 100));


    ScoreResult {
        tool_accuracy,
        output_quality,
        protocol_compliance,
        output_preview: preview,
        tool_calls_actual: tool_calls_json,
        input_tokens: output.input_tokens as i64,
        output_tokens: output.output_tokens as i64,
        cost_usd: output.cost_usd,
        duration_ms: output.duration_ms as i64,
        error_message: output.error.clone(),
        rationale: Some(serde_json::to_string(&rationale_json).unwrap_or(llm_result.rationale)),
        suggestions: Some(llm_result.suggestions),
        eval_method: Some(llm_result.eval_method.as_str().to_string()),
        events: output.events.clone(),
    }
}

// -- Summary builder --------------------------------------------

/// Average only the non-None scores from an iterator of Option<i32>.
/// Returns None if no scored values exist.
fn avg_scored(iter: impl Iterator<Item = Option<i32>>) -> Option<f64> {
    let scored: Vec<i32> = iter.flatten().collect();
    if scored.is_empty() {
        None
    } else {
        Some(scored.iter().map(|&v| v as f64).sum::<f64>() / scored.len() as f64)
    }
}

/// Cost-decay rate for the value-score efficiency curve, in units of 1/USD.
///
/// The efficiency multiplier is `exp(-total_cost * RATE)`, an exponential decay
/// that starts at 1.0 for zero cost and halves roughly every `ln(2)/RATE ≈
/// $0.069`. Concretely, at RATE = 10: $0.001 → ~0.99, $0.01 → ~0.90,
/// $0.07 → ~0.50, $0.10 → ~0.37, $0.30 → ~0.05. The shape rewards near-free
/// runs almost fully while punishing runs past a few cents steeply — chosen so
/// a small quality edge can't justify a 10× cost blowout. Tune this single
/// constant to move the whole curve; larger = harsher cost penalty.
const VALUE_SCORE_COST_DECAY_RATE: f64 = 10.0;

/// Compute value_score on a consistent 0-100 scale for both free and paid models.
/// For paid models: composite * efficiency_factor, where efficiency_factor
/// penalizes higher costs but stays in [0, 1].
/// For free models: composite score directly (perfect efficiency).
///
/// NOTE: a caller must not pass a cost of 0.0 for a *cost-unknown* model (e.g.
/// Ollama, whose cost is hardcoded 0.0) expecting a meaningful value — that
/// would score it as a perfect-efficiency free model and let it win any
/// best-value ranking. Cost-unknown models are excluded upstream in the summary
/// builders instead.
fn compute_value_score(composite: f64, total_cost: f64) -> f64 {
    if total_cost > 0.0 {
        let efficiency = (-total_cost * VALUE_SCORE_COST_DECAY_RATE).exp();
        (composite * efficiency).clamp(0.0, 100.0)
    } else {
        composite // Free models get full composite as value
    }
}

/// Whether a provider reports a real per-call cost. Ollama's cost is hardcoded
/// to 0.0 in the runner, so a zero there means "unknown", not "free" — such
/// models must be excluded from the best-value verdict rather than treated as
/// infinitely efficient.
fn provider_cost_is_known(provider: &str) -> bool {
    provider != super::types::providers::OLLAMA
}

/// Pick the best-value model from a set of ranking objects, considering ONLY
/// cost-known models (`cost_unknown != true`). A cost-unknown model (Ollama)
/// has a hardcoded-zero cost that would otherwise score as perfect efficiency
/// and always win — so it can never be awarded the best-value verdict. Returns
/// `"unknown"` when every candidate is cost-unknown.
fn best_value_model(rankings: &[serde_json::Value]) -> String {
    rankings
        .iter()
        .filter(|r| !r.get("cost_unknown").and_then(|v| v.as_bool()).unwrap_or(false))
        .max_by_key(|r| r.get("value_score").and_then(|v| v.as_i64()).unwrap_or(0))
        .and_then(|r| r.get("model_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string()
}

// -- CLI helpers ------------------------------------------------

/// Structured output from a CLI execution.
pub(crate) struct ExecutionOutput {
    assistant_text: String,
    tool_calls: Vec<String>,
    input_tokens: u64,
    output_tokens: u64,
    pub(crate) cost_usd: f64,
    duration_ms: u64,
    error: Option<String>,
    /// Per-event capture of the CLI stream-JSON lines, in order. Used by lab
    /// modes to populate `lab_result_events` so the ScenarioDetailPanel can
    /// render the conversation post-hoc. Empty for paths that don't produce
    /// stream JSON (e.g., native Ollama HTTP).
    events: Vec<CreateLabResultEventInput>,
}

/// Build a configured CLI `Command` with a temporary working directory.
///
/// Creates the temp dir, configures args, piped stdin/stdout, null stderr,
/// Windows `CREATE_NO_WINDOW` flag, and env overrides/removals.
/// Spawn Claude CLI, pipe prompt to stdin, collect all output as a plain string.
/// Used for the coordinator (scenario generation).
async fn spawn_cli_and_collect(
    cli_args: &CliArgs,
    prompt_text: &str,
    pool: &DbPool,
    spend: crate::db::repos::llm_spend::SpendCtx<'_>,
) -> Result<String, String> {
    let mut driver = CliProcessDriver::spawn_temp_no_stderr(cli_args, "personas-test-coord")?;
    driver.write_stdin(prompt_text.as_bytes()).await;

    let mut assistant_text = String::new();
    let mut result_line: Option<String> = None;
    let timeout = tokio::time::Duration::from_secs(300);

    driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            match line_type {
                StreamLineType::AssistantText { text } => {
                    assistant_text.push_str(&text);
                    assistant_text.push('\n');
                }
                StreamLineType::Result { .. } => {
                    result_line = Some(line.to_string());
                }
                _ => {}
            }
        })
        .await?;

    let _ = driver.finish().await;

    // tiger #1: record headless spend in the dev_llm_spend ledger (best-effort).
    if let Some(rl) = &result_line {
        crate::db::repos::llm_spend::observe_line(pool, &spend, rl);
    }

    Ok(assistant_text)
}

/// Spawn Claude CLI, pipe prompt to stdin, collect structured execution output.
/// Used for the per-model persona execution.
async fn spawn_cli_and_collect_structured(
    cli_args: &CliArgs,
    prompt_text: &str,
) -> Result<ExecutionOutput, String> {
    let mut driver = CliProcessDriver::spawn_temp_no_stderr(cli_args, "personas-test-exec")?;
    let start = std::time::Instant::now();
    driver.write_stdin(prompt_text.as_bytes()).await;

    let mut assistant_text = String::new();
    let mut tool_calls: Vec<String> = Vec::new();
    let mut metrics = ExecutionMetrics::default();
    // Captured stream-event log for the lab event-stream sidecar.
    let mut events: Vec<CreateLabResultEventInput> = Vec::new();

    let timeout = tokio::time::Duration::from_secs(300);
    let stream_err = driver
        .collect_lines_with_timeout(timeout, |line| {
            let (line_type, _) = parser::parse_stream_line(line);
            let ts_ms = start.elapsed().as_millis() as i64;
            let idx = events.len() as i32;

            match line_type {
                StreamLineType::AssistantText { text } => {
                    assistant_text.push_str(&text);
                    assistant_text.push('\n');
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "assistant_text".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: Some(text),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::AssistantToolUse {
                    tool_name,
                    input_preview,
                } => {
                    tool_calls.push(tool_name.clone());
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "tool_use".to_string(),
                        tool_name: Some(tool_name),
                        tool_args_preview: Some(input_preview),
                        tool_result_preview: None,
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::AssistantTodoWrite { items } => {
                    tool_calls.push("TodoWrite".to_string());
                    let preview = serde_json::to_string(&items).unwrap_or_default();
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "tool_use".to_string(),
                        tool_name: Some("TodoWrite".to_string()),
                        tool_args_preview: Some(preview),
                        tool_result_preview: None,
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::ToolResult { content_preview } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "tool_result".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: Some(content_preview),
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::SystemInit { ref model, .. } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "system_init".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: Some(model.clone()),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::Result { .. } => {
                    parser::update_metrics_from_result(&mut metrics, &line_type);
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "result".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::TaskStarted {
                    description,
                    subagent_type,
                    ..
                } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "subagent_started".to_string(),
                        tool_name: Some(subagent_type),
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: Some(description),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::TaskNotification { status, .. } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "subagent_update".to_string(),
                        tool_name: None,
                        tool_args_preview: None,
                        tool_result_preview: Some(status),
                        text_preview: None,
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::SubagentMessage {
                    text, tool_name, ..
                } => {
                    events.push(CreateLabResultEventInput {
                        event_index: idx,
                        event_type: "subagent_message".to_string(),
                        tool_name,
                        tool_args_preview: None,
                        tool_result_preview: None,
                        text_preview: (!text.is_empty()).then_some(text),
                        ts_ms_relative: ts_ms,
                    });
                }
                StreamLineType::Unknown => {}
            }
        })
        .await;

    // On a collect-timeout the child is presumed hung (that's why the stream
    // never produced a `Result` line within the window) -- kill it instead of
    // awaiting a natural exit that may never come, which would otherwise wedge
    // this task (and the lab run's progress) with no upper time bound.
    let exit = if stream_err.is_err() {
        driver.kill().await;
        Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "collect_lines_with_timeout timed out",
        ))
    } else {
        driver.wait().await
    };
    let duration_ms = start.elapsed().as_millis() as u64;
    driver.cleanup_dir();

    let error = if stream_err.is_err() {
        Some("Execution timed out after 300 seconds".to_string())
    } else if let Ok(status) = exit {
        if !status.success() {
            Some(format!(
                "CLI exited with code {}",
                status.code().unwrap_or(-1)
            ))
        } else {
            None
        }
    } else {
        None
    };

    Ok(ExecutionOutput {
        assistant_text,
        tool_calls,
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        cost_usd: metrics.cost_usd,
        duration_ms,
        error,
        events,
    })
}

// ============================================================================
// Lab: Generic executor for standard tests, arena, A/B, eval, matrix, and
// consensus modes
// ============================================================================

fn emit_lab_status(
    app: &AppHandle,
    event_name: &str,
    run_id: &str,
    phase: &str,
    error: Option<&str>,
) {
    let _ = app.emit(
        event_name,
        TestRunStatusEvent {
            run_id: run_id.to_string(),
            phase: phase.to_string(),
            scenarios_count: None,
            current: None,
            total: None,
            model_id: None,
            scenario_name: None,
            status: None,
            scores: None,
            summary: None,
            error: error.map(|s| s.to_string()),
            scenarios: None,
            elapsed_ms: None,
        },
    );
}

/// A variant to test: a persona reference + a label used as tracker key prefix.
/// Each variant can carry its own tool set for full persona versioning.
struct LabVariant<'a> {
    persona: &'a Persona,
    label: String,
    /// Per-variant tools. If empty, falls back to shared tools from run_lab_loop.
    tools: Vec<PersonaToolDefinition>,
}

/// Callbacks that abstract mode-specific persistence and summary building.
#[allow(clippy::type_complexity)]
struct LabCallbacks<'a> {
    event_name: &'a str,
    update_status: Box<
        dyn Fn(&DbPool, &str, LabRunStatus, Option<i32>, Option<&str>, Option<&str>, Option<&str>)
            + Send
            + Sync
            + 'a,
    >,
    persist_result: Box<
        dyn Fn(&DbPool, &str, &LabVariant<'_>, &TestScenario, &TestModelConfig, &str, &ScoreResult)
            + Send
            + Sync
            + 'a,
    >,
    build_summary: Box<
        dyn Fn(
                &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
                &[TestModelConfig],
            ) -> serde_json::Value
            + Send
            + Sync
            + 'a,
    >,
    update_llm_summary: Box<dyn Fn(&DbPool, &str, &str) + Send + Sync + 'a>,
    /// Optional aggregate-cost ceiling check, polled once per scenario before
    /// spawning its cells. Only the standard test-run path wires a real budget
    /// ledger (see `run_budget`); other lab modes pass a constant `false` and
    /// are unaffected. Returning `true` halts further scenario launches (the
    /// run still finalizes using the partial results already collected — see
    /// `halted_by_budget` below, which keeps that intentional stop from
    /// tripping the completeness gate).
    should_halt_budget: Box<dyn Fn(&str) -> bool + Send + Sync + 'a>,
    /// Optional per-cell cost recorder, called once per completed cell with
    /// its `cost_usd`. Only the standard test-run path records into the
    /// budget ledger; other lab modes pass a no-op.
    record_cost: Box<dyn Fn(&str, f64) + Send + Sync + 'a>,
}

/// Generate a prose LLM summary of test results. Returns the summary text, or None on failure.
#[allow(clippy::type_complexity)]
async fn generate_llm_run_summary(
    persona_name: &str,
    persona_description: &str,
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    scenario_count: usize,
    pool: &DbPool,
) -> Option<String> {
    let mut results_text = String::new();
    for (key, entries) in tracker.iter() {
        let n = entries.len() as f64;
        if n == 0.0 {
            continue;
        }
        let avg_ta = avg_scored(entries.iter().map(|r| r.0)).unwrap_or(0.0);
        let avg_oq = avg_scored(entries.iter().map(|r| r.1)).unwrap_or(0.0);
        let avg_pc = avg_scored(entries.iter().map(|r| r.2)).unwrap_or(0.0);
        let total_cost = entries.iter().map(|r| r.3).sum::<f64>();
        // Renormalise over present sub-scores (sandbox runs omit tool_accuracy)
        // — mirrors `verdict_status`.
        let composite = renormalized_composite(
            avg_scored(entries.iter().map(|r| r.0)),
            avg_scored(entries.iter().map(|r| r.1)),
            avg_scored(entries.iter().map(|r| r.2)),
        )
        .unwrap_or(0.0);
        results_text.push_str(&format!(
            "- {key}: composite={:.0}/100 (tool_accuracy={:.0}, output_quality={:.0}, protocol={:.0}), cost=${:.4}, {:.0} scenarios\n",
            composite, avg_ta, avg_oq, avg_pc, total_cost, n
        ));
    }

    let prompt = format!(
        r#"Write a 3-4 sentence executive summary of these test results. Be specific and actionable.

Persona: {persona_name}
Purpose: {persona_description}
Scenarios tested: {scenario_count}

Results by variant/model:
{results_text}
Rules:
- Start with the key finding (which variant/model performed best and why)
- Mention the weakest dimension and its impact on usability
- End with the single most impactful improvement the user should make
- Be concise — no bullet points, no headers, just flowing prose
- Do not repeat the raw numbers — interpret them"#
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(LAB_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    match spawn_cli_and_collect(
        &cli_args,
        &prompt,
        pool,
        crate::db::repos::llm_spend::SpendCtx {
            source: "evaluator",
            trigger_kind: "lab_summary",
            model: Some(LAB_MODEL),
            persona_id: None,
            project_id: None,
        },
    )
    .await
    {
        Ok(output) => {
            let text = output.trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        Err(e) => {
            tracing::warn!("LLM run summary generation failed: {e}");
            None
        }
    }
}

/// Generic lab execution loop shared by standard tests, arena, A/B, eval,
/// matrix, and consensus modes.
#[allow(clippy::too_many_arguments)]
async fn run_lab_loop(
    app: &AppHandle,
    pool: &DbPool,
    run_id: &str,
    persona_for_scenarios: &Persona,
    tools: &[PersonaToolDefinition],
    model_configs: &[TestModelConfig],
    variants: &[LabVariant<'_>],
    cancelled: &Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<&str>,
    // Custom scenario-generation input. `None` for every mode except standard
    // tests, which can seed a saved suite's fixture data.
    fixture_inputs: Option<&str>,
    // When `Some`, skip generation entirely and use these scenarios directly
    // (standard tests re-running a saved suite). An empty vec fails the run
    // with the same "no scenarios" message generation-failure uses.
    preloaded_scenarios: Option<Vec<TestScenario>>,
    cb: &LabCallbacks<'_>,
) {
    let run_start = std::time::Instant::now();

    let scenarios = if let Some(preloaded) = preloaded_scenarios {
        if preloaded.is_empty() {
            let now = chrono::Utc::now().to_rfc3339();
            (cb.update_status)(
                pool,
                run_id,
                LabRunStatus::Failed,
                None,
                None,
                Some("Saved test suite has no scenarios"),
                Some(&now),
            );
            emit_lab_status(
                app,
                cb.event_name,
                run_id,
                "failed",
                Some("Saved test suite has no scenarios"),
            );
            return;
        }
        preloaded
    } else {
        emit_lab_status(app, cb.event_name, run_id, "generating", None);

        match generate_scenarios(persona_for_scenarios, tools, use_case_filter, fixture_inputs, pool)
            .await
        {
            Ok(s) if s.is_empty() => {
                let now = chrono::Utc::now().to_rfc3339();
                (cb.update_status)(
                    pool,
                    run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some("No test scenarios were generated"),
                    Some(&now),
                );
                emit_lab_status(
                    app,
                    cb.event_name,
                    run_id,
                    "failed",
                    Some("No test scenarios were generated"),
                );
                return;
            }
            Ok(s) => s,
            Err(e) => {
                let msg = format!("Scenario generation failed: {e}");
                let now = chrono::Utc::now().to_rfc3339();
                (cb.update_status)(
                    pool,
                    run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some(&msg),
                    Some(&now),
                );
                emit_lab_status(app, cb.event_name, run_id, "failed", Some(&msg));
                return;
            }
        }
    };

    let scenario_count = scenarios.len();
    (cb.update_status)(
        pool,
        run_id,
        LabRunStatus::Running,
        Some(scenario_count as i32),
        None,
        None,
        None,
    );

    let _ = app.emit(
        cb.event_name,
        TestRunStatusEvent {
            run_id: run_id.to_string(),
            phase: "generated".into(),
            scenarios_count: Some(scenario_count),
            // Standard test runs use this to let the frontend save the
            // generated scenarios into a reusable suite (see testSlice's
            // `scenarios` / `createTestSuite`). Harmless for other lab modes,
            // which don't read this field off their own progress payload.
            scenarios: Some(scenarios.clone()),
            elapsed_ms: Some(run_start.elapsed().as_millis() as u64),
            ..Default::default()
        },
    );

    let total = scenario_count * model_configs.len() * variants.len();
    let mut current = 0usize;
    // Set when a mode-specific budget ceiling halts further scenario launches
    // (see `should_halt_budget`). This is an intentional, disclosed partial
    // run — distinct from cells lost to task panics/errors — so it must not
    // trip the completeness gate below.
    let mut halted_by_budget = false;
    #[allow(clippy::type_complexity)]
    let mut tracker: HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>> =
        HashMap::new();

    // Cap concurrent CLI children across the whole run (see LAB_CELL_CONCURRENCY).
    let cell_semaphore = Arc::new(tokio::sync::Semaphore::new(LAB_CELL_CONCURRENCY));

    for scenario in &scenarios {
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            (cb.update_status)(
                pool,
                run_id,
                LabRunStatus::Cancelled,
                None,
                None,
                None,
                None,
            );
            emit_lab_status(app, cb.event_name, run_id, "cancelled", None);
            return;
        }

        // Mode-specific budget ceiling (currently only standard test runs):
        // stop launching further scenarios once the run's aggregate cost
        // ceiling is reached (warn-only never halts). The run still finalizes
        // below with the partial results already collected.
        if (cb.should_halt_budget)(run_id) {
            tracing::warn!(
                run_id,
                "Lab run halted scenario execution — budget ceiling reached (enforce mode)",
            );
            halted_by_budget = true;
            break;
        }

        // Spawn all model × variant pairs for this scenario concurrently
        let mut handles = Vec::new();
        for (mi, model) in model_configs.iter().enumerate() {
            for (vi, variant) in variants.iter().enumerate() {
                let persona_c = variant.persona.clone();
                let pool_c = pool.clone();
                let tools_c = if variant.tools.is_empty() {
                    tools.to_vec()
                } else {
                    variant.tools.clone()
                };
                let scenario_c = scenario.clone();
                let model_c = model.clone();
                let cancelled_c = cancelled.clone();
                // Acquire the concurrency permit BEFORE spawning so the loop
                // throttles the fan-out at the source; the task holds it for its
                // lifetime. `acquire_owned` only errors if the semaphore is
                // closed, which never happens here.
                let permit = cell_semaphore.clone().acquire_owned().await.ok();

                handles.push(tokio::spawn(async move {
                    let _permit = permit;
                    if cancelled_c.load(std::sync::atomic::Ordering::Acquire) {
                        return (
                            mi,
                            vi,
                            "cancelled".to_string(),
                            ScoreResult::from_error("Cancelled"),
                        );
                    }
                    // Race execution against cancellation. If cancel fires mid-run
                    // the execute future (which owns the CLI driver) is dropped;
                    // the driver's `kill_on_drop` terminates the child within the
                    // 200ms poll window rather than blocking on the CLI timeout.
                    let result = tokio::select! {
                        biased;
                        _ = await_cancel(&cancelled_c) => Err("Cancelled".to_string()),
                        r = execute_scenario(&persona_c, &tools_c, &scenario_c, &model_c) => r,
                    };
                    let (status, scores) = match &result {
                        Ok(r) => {
                            let s = score_result(r, &scenario_c, &persona_c, &pool_c).await;
                            (verdict_status(&s), s)
                        }
                        Err(e) => {
                            let mut sr = ScoreResult::from_error(e.clone());
                            sr.output_preview = Some(e.clone());
                            ("error".to_string(), sr)
                        }
                    };
                    (mi, vi, status, scores)
                }));
            }
        }

        // Collect results and process sequentially (persist, emit progress, update tracker)
        for handle in handles {
            let (mi, vi, status, scores) = match handle.await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("Lab task panicked: {e}");
                    continue;
                }
            };
            // Do not persist or count any cell once cancellation has been
            // requested — its result is either a killed-mid-flight stub or a
            // late arrival, and the run finalizes as Cancelled below. We still
            // drain the remaining handles (the loop) so no task is detached.
            if cancelled.load(std::sync::atomic::Ordering::Acquire) {
                continue;
            }
            current += 1;
            let model = &model_configs[mi];
            let variant = &variants[vi];

            let key = if variant.label.is_empty() {
                model.id.clone()
            } else {
                format!("{}:{}", variant.label, model.id)
            };
            tracker.entry(key).or_default().push((
                scores.tool_accuracy,
                scores.output_quality,
                scores.protocol_compliance,
                scores.cost_usd,
                scores.duration_ms,
            ));

            (cb.persist_result)(pool, run_id, variant, scenario, model, &status, &scores);
            (cb.record_cost)(run_id, scores.cost_usd);

            let _ = app.emit(
                cb.event_name,
                TestRunStatusEvent {
                    run_id: run_id.to_string(),
                    phase: "executing".into(),
                    scenarios_count: Some(scenario_count),
                    current: Some(current),
                    total: Some(total),
                    model_id: Some(model.id.clone()),
                    scenario_name: Some(scenario.name.clone()),
                    status: Some(status),
                    scores: Some(TestScores {
                        tool_accuracy: scores.tool_accuracy,
                        output_quality: scores.output_quality,
                        protocol_compliance: scores.protocol_compliance,
                    }),
                    summary: None,
                    error: scores.error_message,
                    scenarios: None,
                    elapsed_ms: Some(run_start.elapsed().as_millis() as u64),
                },
            );
        }
    }

    // Finalize as Cancelled if cancellation landed during the final scenario's
    // collection (the per-scenario guard at the loop top only catches cancels
    // between scenarios). Returning here keeps the status Cancelled and skips the
    // (CLI-spawning) summary work — and the completeness gate below, so a
    // cancelled run never mis-finalizes as Failed for having `current < total`.
    if cancelled.load(std::sync::atomic::Ordering::Acquire) {
        let now = chrono::Utc::now().to_rfc3339();
        (cb.update_status)(
            pool,
            run_id,
            LabRunStatus::Cancelled,
            None,
            None,
            None,
            Some(&now),
        );
        emit_lab_status(app, cb.event_name, run_id, "cancelled", None);
        return;
    }

    let summary = (cb.build_summary)(&tracker, model_configs);
    let summary_str = serde_json::to_string(&summary).unwrap_or_default();

    // Generate LLM prose summary (non-blocking, falls back to None on failure)
    emit_lab_status(app, cb.event_name, run_id, "summarizing", None);
    let llm_summary = generate_llm_run_summary(
        &persona_for_scenarios.name,
        persona_for_scenarios.description.as_deref().unwrap_or(""),
        &tracker,
        scenario_count as usize,
        pool,
    )
    .await;

    // Persist the LLM summary if available (best-effort, non-fatal)
    if let Some(ref text) = llm_summary {
        let _ = (cb.update_llm_summary)(pool, run_id, text);
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Guard: if the run was cancelled while we were finishing, do not overwrite
    // the "cancelled" status with "completed" — that would corrupt the state.
    if cancelled.load(std::sync::atomic::Ordering::Acquire) {
        tracing::info!(
            run_id,
            "Skipping completed status write — run was cancelled"
        );
        emit_lab_status(app, cb.event_name, run_id, "cancelled", None);
        return;
    }

    // Completeness gate: a run is "completed" only if every fanned-out cell
    // produced a result. Panicked / JoinError tasks are `continue`d above without
    // incrementing `current`, so `current < total` means cells were silently lost.
    // Finalize as Failed with a count rather than presenting a partial sample as a
    // trustworthy comparison (the leaderboards would average over missing data).
    //
    // Exception: a budget-halted run is *intentionally* short of `total` — the
    // scenario loop stopped on purpose, not because a cell was lost — so it
    // must not trip this gate.
    let incomplete = !halted_by_budget && current < total;
    let (run_status, status_error, phase): (LabRunStatus, Option<String>, &str) = if incomplete {
        let msg = format!(
            "Run incomplete: {current}/{total} cells produced results; {} lost to task panics/errors",
            total - current
        );
        tracing::error!(run_id, current, total, "{msg}");
        (LabRunStatus::Failed, Some(msg), "failed")
    } else {
        (LabRunStatus::Completed, None, "completed")
    };

    (cb.update_status)(
        pool,
        run_id,
        run_status,
        None,
        Some(&summary_str),
        None,
        Some(&now),
    );

    let _ = app.emit(
        cb.event_name,
        TestRunStatusEvent {
            run_id: run_id.to_string(),
            phase: phase.into(),
            scenarios_count: Some(scenario_count),
            current: Some(current),
            total: Some(total),
            summary: Some(summary),
            error: status_error,
            elapsed_ms: Some(run_start.elapsed().as_millis() as u64),
            ..Default::default()
        },
    );
}

/// Build a keyed summary (used by A/B, eval, matrix modes).
#[allow(clippy::type_complexity)]
fn build_keyed_summary(
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    _models: &[TestModelConfig],
) -> serde_json::Value {
    let mut summary_obj = serde_json::Map::new();
    for (key, results) in tracker.iter() {
        let count = results.len() as f64;
        let avg_ta = avg_scored(results.iter().map(|r| r.0)).unwrap_or(0.0);
        let avg_oq = avg_scored(results.iter().map(|r| r.1)).unwrap_or(0.0);
        let avg_pc = avg_scored(results.iter().map(|r| r.2)).unwrap_or(0.0);
        let total_cost: f64 = results.iter().map(|r| r.3).sum();
        // Renormalise over present sub-scores (sandbox runs omit tool_accuracy)
        // — mirrors `verdict_status`.
        let composite = renormalized_composite(
            avg_scored(results.iter().map(|r| r.0)),
            avg_scored(results.iter().map(|r| r.1)),
            avg_scored(results.iter().map(|r| r.2)),
        )
        .unwrap_or(0.0);
        summary_obj.insert(
            key.clone(),
            serde_json::json!({
                "avg_tool_accuracy": avg_ta.round() as i32,
                "avg_output_quality": avg_oq.round() as i32,
                "avg_protocol_compliance": avg_pc.round() as i32,
                "composite_score": composite.round() as i32,
                "total_cost_usd": (total_cost * 10000.0).round() / 10000.0,
                "scenarios_tested": count as i32,
            }),
        );
    }
    serde_json::Value::Object(summary_obj)
}

/// Build arena-style ranked summary.
#[allow(clippy::type_complexity)]
fn build_arena_summary(
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    models: &[TestModelConfig],
) -> serde_json::Value {
    let mut rankings: Vec<serde_json::Value> = Vec::new();
    for model in models {
        if let Some(results) = tracker.get(&model.id) {
            let count = results.len() as f64;
            let avg_ta = avg_scored(results.iter().map(|r| r.0)).unwrap_or(0.0);
            let avg_oq = avg_scored(results.iter().map(|r| r.1)).unwrap_or(0.0);
            let avg_pc = avg_scored(results.iter().map(|r| r.2)).unwrap_or(0.0);
            let total_cost: f64 = results.iter().map(|r| r.3).sum();
            let avg_duration = results.iter().map(|r| r.4 as f64).sum::<f64>() / count;
            // Renormalise over present sub-scores (sandbox runs omit
            // tool_accuracy) — mirrors `verdict_status`.
            let composite = renormalized_composite(
                avg_scored(results.iter().map(|r| r.0)),
                avg_scored(results.iter().map(|r| r.1)),
                avg_scored(results.iter().map(|r| r.2)),
            )
            .unwrap_or(0.0);
            let cost_known = provider_cost_is_known(&model.provider);
            let value_score = compute_value_score(composite, total_cost);
            rankings.push(serde_json::json!({
                "model_id": model.id,
                "provider": model.provider,
                "avg_tool_accuracy": avg_ta.round() as i32,
                "avg_output_quality": avg_oq.round() as i32,
                "avg_protocol_compliance": avg_pc.round() as i32,
                "composite_score": composite.round() as i32,
                "total_cost_usd": (total_cost * 10000.0).round() / 10000.0,
                "cost_unknown": !cost_known,
                "avg_duration_ms": avg_duration.round() as i64,
                "value_score": value_score.round() as i32,
                "scenarios_tested": count as i32,
            }));
        }
    }
    rankings.sort_by(|a, b| {
        let sa = a
            .get("composite_score")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let sb = b
            .get("composite_score")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        sb.cmp(&sa)
    });
    let best_model = rankings
        .first()
        .and_then(|r| r.get("model_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let best_value = best_value_model(&rankings);
    serde_json::json!({
        "best_quality_model": best_model,
        "best_value_model": best_value,
        "rankings": rankings,
    })
}

/// Common fields extracted from a scenario + model + scores for persisting lab results.
fn make_common_result_fields(
    scenario: &TestScenario,
    model: &TestModelConfig,
    status: &str,
    scores: &ScoreResult,
) -> CreateLabResultBaseInput {
    CreateLabResultBaseInput {
        scenario_name: scenario.name.clone(),
        model_id: model.id.clone(),
        provider: model.provider.clone(),
        status: status.to_string(),
        output_preview: scores.output_preview.clone(),
        tool_calls_expected: scenario
            .expected_tool_sequence
            .as_ref()
            .map(|v| crate::db::models::Json(v.clone())),
        tool_calls_actual: scores.tool_calls_actual.clone(),
        tool_accuracy_score: scores.tool_accuracy,
        output_quality_score: scores.output_quality,
        protocol_compliance: scores.protocol_compliance,
        input_tokens: scores.input_tokens,
        output_tokens: scores.output_tokens,
        cost_usd: scores.cost_usd,
        duration_ms: scores.duration_ms,
        error_message: scores.error_message.clone(),
        rationale: scores.rationale.clone(),
        suggestions: scores.suggestions.clone(),
        eval_method: scores.eval_method.clone(),
    }
}

// ============================================================================
// Lab: Arena
// ============================================================================

/// Resolve a persona's active production prompt version for result attribution.
///
/// Mirrors the frontend active-version rule (`LabVersionsTable`): the version
/// tagged `production` wins; otherwise the highest `version_number`. Returns
/// `None` when the persona has no prompt versions at all, so unscoped arena
/// results correctly stay version-less rather than being attributed to an
/// invented id. Read-only single-row query; a pool/query error degrades to
/// `None` (attribution is best-effort, never a reason to fail the run).
fn resolve_active_version(pool: &DbPool, persona_id: &str) -> Option<(String, i32)> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT id, version_number FROM persona_prompt_versions
         WHERE persona_id = ?1
         ORDER BY (tag = 'production') DESC, version_number DESC
         LIMIT 1",
        [persona_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?)),
    )
    .ok()
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_arena_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    model_configs: Vec<TestModelConfig>,
    _log_dir: std::path::PathBuf,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
    // When the arena was launched scoped to a specific prompt version (the
    // consolidated "Versions & Ratings" table), `ephemeral.persona` already
    // carries that version's prompt and this stamps the attribution onto each
    // result so the ratings rollup can group by (version, model). `None` = the
    // legacy current-prompt arena, results stay version-less.
    version: Option<(String, i32)>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;
    // `label` reflects the *explicit* version scope only: it keys the summary
    // tracker, and build_arena_summary looks results up by `model.id` (empty
    // label). Deriving it from the resolved attribution below would change the
    // key to `vN:model` and make the arena summary miss every cell — so it must
    // stay tied to the original `version` argument.
    let label = version
        .as_ref()
        .map(|(_, num)| format!("v{}", num))
        .unwrap_or_default();
    let variants = vec![LabVariant {
        persona,
        label,
        tools: Vec::new(),
    }];

    // Attribution version stamped onto every persisted result. When the arena
    // was launched version-scoped, that scope wins. Otherwise (the arena
    // chrome's own unscoped "Begin the Match") we resolve the persona's active
    // production version — the same rule the frontend uses — so these results
    // reach `get_version_ratings` (which filters `version_id IS NOT NULL`) and
    // the champion tally and ratings table stay in agreement. A persona with no
    // prompt versions at all keeps `None` (we never invent an id). Kept separate
    // from `label` so summary keying is unchanged.
    let attribution: Option<(String, i32)> = match &version {
        Some(v) => Some(v.clone()),
        None => resolve_active_version(&pool, &persona.id),
    };

    let cb = LabCallbacks {
        event_name: "lab-arena-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = arena_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(move |pool, run_id, _variant, scenario, model, status, scores| {
            let base = make_common_result_fields(scenario, model, status, scores);
            let (version_id, version_number) = match &attribution {
                Some((vid, vnum)) => (Some(vid.clone()), Some(*vnum)),
                None => (None, None),
            };
            match arena_repo::create_result(
                pool,
                &CreateArenaResultInput {
                    run_id: run_id.to_string(),
                    version_id,
                    version_number,
                    base,
                },
            ) {
                Ok(result) => {
                    if let Err(e) = events_repo::insert_events_batch(
                        pool,
                        &result.id,
                        LabResultKind::Arena,
                        &scores.events,
                    ) {
                        tracing::warn!(
                            "Failed to persist arena event stream for result {}: {e}",
                            result.id
                        );
                    }
                }
                Err(e) => tracing::error!("Arena result create failed: {e}"),
            }
        }),
        build_summary: Box::new(build_arena_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = arena_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// ============================================================================
// Lab: Consensus (stochastic multi-run agreement)
// ============================================================================

/// Run the same persona N times per scenario with natural temperature variation,
/// then compute agreement rate across samples. Uses the standard lab loop with
/// N identical "sample" variants pointing to the same persona config.
#[allow(clippy::too_many_arguments)]
#[allow(dead_code)] // pending: consensus mode unwired in commands::execution; standard lab loop is the only entry today
pub async fn run_consensus_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    model_config: TestModelConfig,
    num_samples: i32,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;
    let n = num_samples.clamp(2, 20) as usize;

    // Create N identical variants labeled sample-0..sample-N
    let variants: Vec<LabVariant<'_>> = (0..n)
        .map(|i| LabVariant {
            persona,
            label: format!("sample-{i}"),
            tools: Vec::new(),
        })
        .collect();

    // Track sample index from label
    let _sample_counter = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(0));

    let cb = LabCallbacks {
        event_name: "lab-consensus-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = consensus_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, variant, scenario, model, status, scores| {
                let idx: i32 = variant
                    .label
                    .strip_prefix("sample-")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let base = make_common_result_fields(scenario, model, status, scores);
                match consensus_repo::create_result(
                    pool,
                    &CreateConsensusResultInput {
                        run_id: run_id.to_string(),
                        sample_index: idx,
                        base,
                    },
                ) {
                    Ok(result) => {
                        if let Err(e) = events_repo::insert_events_batch(
                            pool,
                            &result.id,
                            LabResultKind::Consensus,
                            &scores.events,
                        ) {
                            tracing::warn!(
                                "Failed to persist consensus event stream for result {}: {e}",
                                result.id
                            );
                        }
                    }
                    Err(e) => tracing::error!("Consensus result create failed: {e}"),
                }
            },
        ),
        build_summary: Box::new(build_consensus_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = consensus_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    let model_configs = vec![model_config];
    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;

    // After the loop, compute and persist agreement rate
    if let Ok(results) = consensus_repo::get_results_by_run(&pool, &run_id) {
        let rate = compute_agreement_rate(&results);
        let _ = consensus_repo::update_agreement_rate(&pool, &run_id, rate);
    }
}

/// Compute agreement rate: for each scenario, check how many samples agree
/// on the dominant output quality bucket (high/medium/low). Returns 0.0-1.0.
#[allow(dead_code)] // pending: helper for run_consensus_test (also dormant)
fn compute_agreement_rate(results: &[crate::db::models::LabConsensusResult]) -> f64 {
    use std::collections::HashMap;

    // Group results by scenario
    let mut by_scenario: HashMap<&str, Vec<&crate::db::models::LabConsensusResult>> =
        HashMap::new();
    for r in results {
        by_scenario
            .entry(&r.base.scenario_name)
            .or_default()
            .push(r);
    }

    if by_scenario.is_empty() {
        return 0.0;
    }

    let mut total_agreement = 0.0;
    for (_scenario, samples) in &by_scenario {
        let n = samples.len() as f64;
        if n <= 1.0 {
            total_agreement += 1.0;
            continue;
        }

        // Bucket each sample by quality score tier: high(>=80), medium(50-79), low(<50)
        let mut buckets = [0i32; 3]; // [low, medium, high]
        for s in samples {
            match s.base.output_quality_score.unwrap_or(0) {
                80.. => buckets[2] += 1,
                50..=79 => buckets[1] += 1,
                _ => buckets[0] += 1,
            }
        }
        let dominant = *buckets.iter().max().unwrap_or(&0) as f64;
        total_agreement += dominant / n;
    }

    total_agreement / by_scenario.len() as f64
}

/// Build summary for consensus mode — reports per-scenario agreement.
#[allow(dead_code)] // pending: helper for run_consensus_test (also dormant)
fn build_consensus_summary(
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    models: &[TestModelConfig],
) -> serde_json::Value {
    // For consensus, all "models" in tracker are actually sample labels.
    // Flatten all results to compute aggregate stats.
    let all_results: Vec<_> = tracker.values().flatten().collect();
    let count = all_results.len() as f64;
    if count == 0.0 {
        return serde_json::json!({ "samples": 0, "agreement_note": "no results" });
    }
    let avg_oq = avg_scored(all_results.iter().map(|r| r.1)).unwrap_or(0.0);
    let total_cost: f64 = all_results.iter().map(|r| r.3).sum();
    let avg_duration = all_results.iter().map(|r| r.4 as f64).sum::<f64>() / count;

    serde_json::json!({
        "mode": "consensus",
        "total_samples": count as i32,
        "num_models": models.len(),
        "avg_output_quality": avg_oq.round() as i32,
        "total_cost_usd": (total_cost * 1000.0).round() / 1000.0,
        "avg_duration_ms": avg_duration.round() as i64,
        "agreement_note": "agreement_rate is computed post-loop and stored on the run"
    })
}

// ============================================================================
// Lab: A/B
// ============================================================================

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_ab_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    variants: Vec<(String, i32, Persona)>,
    tools: Vec<PersonaToolDefinition>,
    model_configs: Vec<TestModelConfig>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    // Capture version lookup data before borrowing personas
    let version_lookup: Vec<(String, i32)> = variants
        .iter()
        .map(|(vid, vnum, _)| (vid.clone(), *vnum))
        .collect();

    let lab_variants: Vec<LabVariant<'_>> = variants
        .iter()
        .map(|(_, num, p)| LabVariant {
            persona: p,
            label: format!("v{}", num),
            tools: Vec::new(),
        })
        .collect();
    let primary_persona = &variants[0].2;

    let cb = LabCallbacks {
        event_name: "lab-ab-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = ab_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, variant, scenario, model, status, scores| {
                let Some(src) = version_lookup
                    .iter()
                    .find(|(_, num)| format!("v{}", num) == variant.label)
                else {
                    tracing::error!(
                        "Version lookup failed for label '{}' during A/B persist_result",
                        variant.label
                    );
                    return;
                };
                let base = make_common_result_fields(scenario, model, status, scores);
                let _ = ab_repo::create_result(
                    pool,
                    &CreateAbResultInput {
                        run_id: run_id.to_string(),
                        version_id: src.0.clone(),
                        version_number: src.1,
                        base,
                    },
                );
            },
        ),
        build_summary: Box::new(build_keyed_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = ab_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        primary_persona,
        &tools,
        &model_configs,
        &lab_variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// ============================================================================
// Lab: Eval
// ============================================================================

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_eval_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    variants: Vec<(String, i32, Persona)>,
    tools: Vec<PersonaToolDefinition>,
    model_configs: Vec<TestModelConfig>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    let version_lookup: Vec<(String, i32)> = variants
        .iter()
        .map(|(vid, vnum, _)| (vid.clone(), *vnum))
        .collect();

    let lab_variants: Vec<LabVariant<'_>> = variants
        .iter()
        .map(|(_, num, p)| LabVariant {
            persona: p,
            label: format!("v{}", num),
            tools: Vec::new(),
        })
        .collect();
    let primary_persona = &variants[0].2;

    let cb = LabCallbacks {
        event_name: "lab-eval-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = eval_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, variant, scenario, model, status, scores| {
                let Some(src) = version_lookup
                    .iter()
                    .find(|(_, num)| format!("v{}", num) == variant.label)
                else {
                    tracing::error!(
                        "Version lookup failed for label '{}' during eval persist_result",
                        variant.label
                    );
                    return;
                };
                let base = make_common_result_fields(scenario, model, status, scores);
                let _ = eval_repo::create_result(
                    pool,
                    &CreateEvalResultInput {
                        run_id: run_id.to_string(),
                        version_id: src.0.clone(),
                        version_number: src.1,
                        base,
                    },
                );
            },
        ),
        build_summary: Box::new(build_keyed_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = eval_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        primary_persona,
        &tools,
        &model_configs,
        &lab_variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// ============================================================================
// Lab: Matrix -- draft generation + current vs draft comparison
// ============================================================================

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_matrix_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    user_instruction: String,
    model_configs: Vec<TestModelConfig>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;

    // Phase 0: Generate draft persona
    emit_lab_status(&app, "lab-matrix-status", &run_id, "drafting", None);

    let draft_prompt_text = build_draft_generation_prompt(persona, &user_instruction, None);
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(LAB_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let draft_output = match spawn_cli_and_collect(
        &cli_args,
        &draft_prompt_text,
        &pool,
        crate::db::repos::llm_spend::SpendCtx {
            source: "evaluator",
            trigger_kind: "lab_draft",
            model: Some(LAB_MODEL),
            persona_id: Some(persona.id.as_str()),
            project_id: None,
        },
    )
    .await
    {
        Ok(o) => o,
        Err(e) => {
            let msg = format!("Draft generation failed: {e}");
            let now = chrono::Utc::now().to_rfc3339();
            let _ = matrix_repo::update_run_status(
                &pool,
                &run_id,
                LabRunStatus::Failed,
                None,
                None,
                Some(&msg),
                Some(&now),
            );
            emit_lab_status(&app, "lab-matrix-status", &run_id, "failed", Some(&msg));
            return;
        }
    };

    let (draft_structured_prompt, draft_change_summary) =
        match parse_draft_from_output(&draft_output) {
            Ok(v) => v,
            Err(e) => {
                let msg = format!("Failed to parse draft: {e}");
                let now = chrono::Utc::now().to_rfc3339();
                let _ = matrix_repo::update_run_status(
                    &pool,
                    &run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some(&msg),
                    Some(&now),
                );
                emit_lab_status(&app, "lab-matrix-status", &run_id, "failed", Some(&msg));
                return;
            }
        };

    let draft_json_str = serde_json::to_string(&draft_structured_prompt).unwrap_or_default();
    let _ = matrix_repo::update_run_draft(&pool, &run_id, &draft_json_str, &draft_change_summary);

    let mut draft_persona = persona.clone();
    draft_persona.structured_prompt = Some(draft_json_str.clone());

    let variants = vec![
        LabVariant {
            persona,
            label: "current".to_string(),
            tools: Vec::new(),
        },
        LabVariant {
            persona: &draft_persona,
            label: "draft".to_string(),
            tools: Vec::new(),
        },
    ];

    let cb = LabCallbacks {
        event_name: "lab-matrix-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = matrix_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(|pool, run_id, variant, scenario, model, status, scores| {
            let base = make_common_result_fields(scenario, model, status, scores);
            let _ = matrix_repo::create_result(
                pool,
                &CreateMatrixResultInput {
                    run_id: run_id.to_string(),
                    variant: variant.label.clone(),
                    base,
                },
            );
        }),
        build_summary: Box::new(build_keyed_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = matrix_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    // Transition Drafting -> Generating so run_lab_loop can then go Generating -> Running -> Completed
    let _ = matrix_repo::update_run_status(
        &pool,
        &run_id,
        LabRunStatus::Generating,
        None,
        None,
        None,
        None,
    );

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// -- Matrix helpers ---------------------------------------------

fn build_draft_generation_prompt(
    persona: &Persona,
    user_instruction: &str,
    previous_results_summary: Option<&str>,
) -> String {
    let sp_json = persona.structured_prompt.as_deref().unwrap_or("{}");

    // Extract use cases from design_context if available
    let use_cases_section = persona
        .design_context
        .as_deref()
        .and_then(|ctx| {
            serde_json::from_str::<serde_json::Value>(ctx).ok().and_then(|v| {
                v.get("use_cases")
                    .or_else(|| v.get("useCases"))
                    .and_then(|uc| {
                        if uc.is_array() {
                            let items: Vec<String> = uc
                                .as_array()
                                .unwrap()
                                .iter()
                                .filter_map(|item| {
                                    item.as_str()
                                        .map(|s| s.to_string())
                                        .or_else(|| item.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                                })
                                .collect();
                            if items.is_empty() {
                                None
                            } else {
                                Some(format!(
                                    "\n## Persona Use Cases\nThis persona is designed for these use cases:\n{}",
                                    items.iter().map(|i| format!("- {i}")).collect::<Vec<_>>().join("\n")
                                ))
                            }
                        } else {
                            None
                        }
                    })
            })
        })
        .unwrap_or_default();

    let prev_results_section = previous_results_summary
        .map(|s| format!(
            "\n## Previous Test Results\nHere is a summary of how the current prompt performed in testing:\n{s}\nUse this context to address weaknesses in the current prompt."
        ))
        .unwrap_or_default();

    format!(
        r#"# Persona Prompt Optimizer

You are a prompt engineering expert. Given the current persona prompt and a user's
improvement instruction, generate an optimized version of the structured prompt.

## Current Persona: {}
## Current Structured Prompt:
{}
{use_cases_section}{prev_results_section}

## User's Instruction:
{}

## Improvement Guidelines
- Preserve all sections that don't need changes
- Only modify what the user requested
- Ensure tool guidance matches the persona's available tools
- Keep the prompt concise but thorough
- If the persona has use cases, ensure the prompt handles all of them well
- Add specific examples where they would improve clarity

## Output Format
Respond with ONLY a JSON object (no markdown fences, no extra text):
{{
  "structured_prompt": {{ "identity": "...", "instructions": "...", "toolGuidance": "...", "examples": "...", "errorHandling": "..." }},
  "change_summary": "Brief description of what was changed and why"
}}"#,
        persona.name, sp_json, user_instruction
    )
}

fn parse_draft_from_output(output: &str) -> Result<(serde_json::Value, String), String> {
    let trimmed = output.trim();

    // Try direct parse
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(sp) = obj.get("structured_prompt") {
            let summary = obj
                .get("change_summary")
                .and_then(|v| v.as_str())
                .unwrap_or("Draft generated")
                .to_string();
            return Ok((sp.clone(), summary));
        }
    }

    // Try to extract JSON object from text
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            let json_str = &trimmed[start..=end];
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(sp) = obj.get("structured_prompt") {
                    let summary = obj
                        .get("change_summary")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Draft generated")
                        .to_string();
                    return Ok((sp.clone(), summary));
                }
            }
        }
    }

    Err(format!(
        "Failed to parse draft from output. Raw output (first 500 chars): {}",
        truncate_chars(trimmed, 500)
    ))
}

// ============================================================================
// Prompt Improvement Engine -- Analyze test results, generate targeted patches
// ============================================================================

/// Analyze test results and generate targeted prompt improvements.
///
/// Returns (improved_structured_prompt_json, change_summary).
pub async fn generate_targeted_improvements(
    pool: &DbPool,
    persona: &Persona,
    run_results_summary: &str,
    user_feedback: Option<&str>,
) -> Result<(serde_json::Value, String), String> {
    let improvement_prompt = build_improvement_prompt(persona, run_results_summary, user_feedback);

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(LAB_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let output = spawn_cli_and_collect(
        &cli_args,
        &improvement_prompt,
        pool,
        crate::db::repos::llm_spend::SpendCtx {
            source: "evaluator",
            trigger_kind: "lab_improve",
            model: Some(LAB_MODEL),
            persona_id: Some(persona.id.as_str()),
            project_id: None,
        },
    )
    .await?;

    parse_draft_from_output(&output)
}

fn build_improvement_prompt(
    persona: &Persona,
    run_results_summary: &str,
    user_feedback: Option<&str>,
) -> String {
    let sp_json = persona.structured_prompt.as_deref().unwrap_or("{}");
    let description = persona.description.as_deref().unwrap_or("(no description)");

    let user_feedback_section = user_feedback
        .filter(|f| !f.is_empty())
        .map(|f| {
            format!(
                r#"
## User Feedback
The user provided the following feedback on the results:
{f}

Prioritize addressing the user's specific concerns alongside the data-driven improvements."#
            )
        })
        .unwrap_or_default();

    format!(
        r#"# Persona Prompt Improvement Engine

You are an expert prompt engineer specializing in iterative improvement. Your task is to
analyze test results for a persona and produce TARGETED patches to the structured prompt
that will increase scores by 20-40 points in the weakest areas.

## Current Persona
- Name: {name}
- Description: {description}

## Current Structured Prompt
{sp_json}

## Test Results Summary
The persona was evaluated across multiple scenarios and models. Here are the results:
{run_results_summary}

The three scoring dimensions (each 0-100) are:
- **tool_accuracy**: Did the persona select the correct tools and call them with the right parameters?
- **output_quality**: Was the output well-formatted, complete, and helpful?
- **protocol_compliance**: Did the persona follow its defined protocols, instructions, and constraints?
{user_feedback_section}

## Analysis Instructions

1. **Identify the weakest dimension(s)**: Which of tool_accuracy, output_quality, protocol_compliance scored lowest on average? Focus your improvements there.

2. **Read the rationale and suggestions**: The test evaluator provided per-scenario rationale and suggestions. Use these as your primary guide for what to fix.

3. **Make TARGETED patches** -- do NOT rewrite the entire prompt. Only modify the specific sections that address the weaknesses:

   - **For low tool_accuracy (< 70)**: Improve the `toolGuidance` section with:
     - Explicit tool selection rules (e.g., "When the user asks about X, ALWAYS use tool Y")
     - Parameter mapping guidance (which user inputs map to which tool parameters)
     - Decision trees for choosing between similar tools
     - Common mistakes to avoid

   - **For low output_quality (< 70)**: Improve the `instructions` and `examples` sections with:
     - Clearer formatting requirements (markdown structure, headers, bullet points)
     - Response length guidance (minimum/maximum)
     - Template patterns for common response types
     - Better examples showing the expected output format

   - **For low protocol_compliance (< 70)**: Add explicit protocol rules to `instructions`:
     - "ALWAYS do X before Y" rules
     - "NEVER do Z" constraints
     - Error handling protocols
     - Escalation/fallback behavior

4. **Preserve what works**: Sections with scores above 80 should be left mostly unchanged. Only add, don't remove content that's working.

5. **Be specific**: Replace vague guidance like "be helpful" with concrete rules like "Always include a summary section with 2-3 bullet points at the top of your response".

## Output Format
Respond with ONLY a JSON object (no markdown fences, no extra text):
{{
  "structured_prompt": {{ ... the full updated structured_prompt JSON ... }},
  "change_summary": "Concise description of each change and its expected impact on scores. Format: [dimension] change description (+X points expected)"
}}"#,
        name = persona.name,
        description = description,
        sp_json = sp_json,
        run_results_summary = run_results_summary,
        user_feedback_section = user_feedback_section,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_never_panics_on_multibyte_boundary() {
        // A 4-byte emoji straddling every byte index up to the char limit is the
        // exact condition that made `&s[..n]` panic. Counting chars must be safe.
        let s = "😀".repeat(50); // 50 chars, 200 bytes
        for n in 0..=60 {
            let out = truncate_chars(&s, n);
            assert_eq!(out.chars().count(), n.min(50));
            assert!(s.starts_with(&out));
        }
    }

    #[test]
    fn truncate_chars_keeps_short_strings_whole() {
        assert_eq!(truncate_chars("hello", 2000), "hello");
        assert_eq!(truncate_chars("", 500), "");
        // Smart quotes / em-dashes are multibyte too — must pass through intact.
        let mixed = "“café” — 你好 🚀";
        assert_eq!(truncate_chars(mixed, 2000), mixed);
    }

    /// REGRESSION (UAT 2026-07-20): the scenario cache key must be STABLE across
    /// a prompt change, so every version of a persona is graded on one scenario
    /// set and the Δ column compares like with like. When the prompt was in the
    /// key, a version-scoped measure (which swaps the version's prompt onto the
    /// persona) regenerated the exam and the Δ subtracted scores from different
    /// questions.
    #[test]
    fn scenario_cache_key_is_stable_across_prompt_changes() {
        let mut p = crate::db::models::Persona {
            id: "persona-1".into(),
            ..Default::default()
        };
        p.system_prompt = "v1 system prompt".into();
        p.structured_prompt = Some("{\"instructions\":\"v1\"}".into());
        let k1 = scenario_cache_key(&p, &[], None);

        // Simulate a version-scoped measure swapping v2's prompt onto the persona.
        p.system_prompt = "v2 system prompt — materially different".into();
        p.structured_prompt = Some("{\"instructions\":\"v2 rewritten\"}".into());
        let k2 = scenario_cache_key(&p, &[], None);

        assert_eq!(k1, k2, "prompt text must not change the scenario cache key");
    }

    /// The key must still discriminate on the axes that legitimately change the
    /// exam: persona identity, the tool surface, and the use-case filter.
    #[test]
    fn scenario_cache_key_discriminates_persona_tools_and_filter() {
        let p1 = crate::db::models::Persona { id: "a".into(), ..Default::default() };
        let p2 = crate::db::models::Persona { id: "b".into(), ..Default::default() };
        assert_ne!(
            scenario_cache_key(&p1, &[], None),
            scenario_cache_key(&p2, &[], None),
            "different personas must get different scenario sets"
        );
        assert_ne!(
            scenario_cache_key(&p1, &[], None),
            scenario_cache_key(&p1, &[], Some("uc-1")),
            "a use-case filter must change the scenario set"
        );
    }

    // -- Direction 1: unscoped-arena attribution --------------------------------

    fn insert_version(conn: &rusqlite::Connection, id: &str, persona_id: &str, num: i32, tag: &str) {
        conn.execute(
            "INSERT INTO persona_prompt_versions (id, persona_id, version_number, tag, created_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            rusqlite::params![id, persona_id, num, tag],
        )
        .unwrap();
    }

    /// The `production`-tagged version is the active one even when a later
    /// version has a higher number — matching `LabVersionsTable`'s rule so
    /// unscoped arena results attribute to the same version the UI calls live.
    #[test]
    fn resolve_active_version_prefers_production_then_highest_number() {
        let pool = crate::db::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        // Insert with FK checks off so we don't need to materialise a full persona.
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        let pid = "persona-arena-attr";
        insert_version(&conn, "v1", pid, 1, "experimental");
        insert_version(&conn, "v2", pid, 2, "production");
        insert_version(&conn, "v3", pid, 3, "experimental");
        drop(conn);
        assert_eq!(
            resolve_active_version(&pool, pid),
            Some(("v2".to_string(), 2))
        );
    }

    /// With no production tag, the highest `version_number` wins.
    #[test]
    fn resolve_active_version_falls_back_to_highest_number() {
        let pool = crate::db::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        let pid = "persona-no-prod";
        insert_version(&conn, "a1", pid, 1, "experimental");
        insert_version(&conn, "a2", pid, 5, "experimental");
        insert_version(&conn, "a3", pid, 3, "archived");
        drop(conn);
        assert_eq!(
            resolve_active_version(&pool, pid),
            Some(("a2".to_string(), 5))
        );
    }

    /// A persona with no prompt versions stays version-less — we never invent an
    /// id (the acceptance's explicit NULL-preserving case).
    #[test]
    fn resolve_active_version_none_when_no_versions() {
        let pool = crate::db::init_test_db().unwrap();
        assert_eq!(resolve_active_version(&pool, "persona-empty"), None);
    }

    // -- Direction 2: best-value must not be awarded on hardcoded-zero cost -----

    fn ranking(model: &str, value_score: i64, cost_unknown: bool) -> serde_json::Value {
        serde_json::json!({ "model_id": model, "value_score": value_score, "cost_unknown": cost_unknown })
    }

    /// A cost-unknown model (Ollama, hardcoded-zero cost) posts the top raw
    /// value_score but must never win best-value — the cost-known runner-up does.
    #[test]
    fn best_value_skips_cost_unknown_models() {
        let rankings = vec![
            ranking("ollama-local", 100, true),
            ranking("sonnet", 72, false),
            ranking("haiku", 88, false),
        ];
        assert_eq!(best_value_model(&rankings), "haiku");
    }

    /// When every candidate is cost-unknown there is no honest best-value winner.
    #[test]
    fn best_value_unknown_when_all_cost_unknown() {
        let rankings = vec![ranking("ollama-a", 90, true), ranking("ollama-b", 95, true)];
        assert_eq!(best_value_model(&rankings), "unknown");
    }

    /// Ollama is the documented cost-unknown provider; everything else is known.
    #[test]
    fn provider_cost_known_only_for_non_ollama() {
        assert!(!provider_cost_is_known(super::super::types::providers::OLLAMA));
        assert!(provider_cost_is_known("anthropic"));
        assert!(provider_cost_is_known("qwen"));
    }

    // -- Direction 3: bounded engine / prompt cancellation ----------------------

    /// The cell concurrency cap is a sane small positive number, not accidentally
    /// zero (which would deadlock the semaphore) or unbounded.
    #[test]
    fn lab_cell_concurrency_is_bounded() {
        assert!(LAB_CELL_CONCURRENCY >= 1 && LAB_CELL_CONCURRENCY <= 8);
    }

    /// `await_cancel` resolves promptly once the flag flips — this is what lets a
    /// running cell notice cancellation within the poll window.
    #[tokio::test]
    async fn await_cancel_resolves_when_flag_set() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let flag = std::sync::Arc::new(AtomicBool::new(false));
        let f = flag.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            f.store(true, Ordering::Release);
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), await_cancel(&flag))
            .await
            .expect("await_cancel should resolve shortly after the flag is set");
    }

    /// The biased cancel-race prefers cancellation over an in-flight execution,
    /// so a cell is abandoned (and its CLI child dropped/killed) immediately on
    /// cancel instead of blocking on the multi-minute CLI timeout.
    #[tokio::test]
    async fn cancel_race_wins_over_slow_execution() {
        use std::sync::atomic::AtomicBool;
        let flag = std::sync::Arc::new(AtomicBool::new(true)); // already cancelled
        let result: Result<(), String> = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            async {
                tokio::select! {
                    biased;
                    _ = await_cancel(&flag) => Err("Cancelled".to_string()),
                    _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => Ok(()),
                }
            },
        )
        .await
        .expect("cancel branch must win well before the 30s execution stub");
        assert_eq!(result, Err("Cancelled".to_string()));
    }

    // -- Direction 2: sandbox-aware scoring -------------------------------------

    /// Build a `ScoreResult` from just the three sub-scores + eval method; the
    /// rest is irrelevant to the verdict/composite paths under test.
    fn score(
        ta: Option<i32>,
        oq: Option<i32>,
        pc: Option<i32>,
        method: &str,
    ) -> ScoreResult {
        ScoreResult {
            tool_accuracy: ta,
            output_quality: oq,
            protocol_compliance: pc,
            output_preview: None,
            tool_calls_actual: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            duration_ms: 0,
            error_message: None,
            rationale: None,
            suggestions: None,
            eval_method: Some(method.to_string()),
            events: Vec::new(),
        }
    }

    /// The regression this direction fixes: a sandbox cell carries no
    /// `tool_accuracy` (the agent was told not to call real tools), so the old
    /// `unwrap_or(0)` composite scored output_quality 80 / protocol 80 as
    /// `0*0.4 + 80*0.4 + 80*0.2 = 48` → below the 50 threshold → a spurious
    /// "failed". Renormalising over the present weights scores it 80 → "passed".
    #[test]
    fn verdict_status_sandbox_cell_not_auto_failed_on_missing_tool_accuracy() {
        let s = score(None, Some(80), Some(80), "llm");
        assert_eq!(
            verdict_status(&s),
            "passed",
            "a strong sandbox cell must not fail just because tool_accuracy is absent",
        );
    }

    /// Real-tool cells (all three sub-scores present) are unchanged: the
    /// renormalised composite over the full weight base equals the previous
    /// weighted sum, so the pass/fail boundary is identical.
    #[test]
    fn verdict_status_real_cell_scoring_unchanged() {
        // 40*0.4 + 40*0.4 + 40*0.2 = 40 → below 50 → failed (was failed before).
        assert_eq!(verdict_status(&score(Some(40), Some(40), Some(40), "llm")), "failed");
        // 60*0.4 + 60*0.4 + 60*0.2 = 60 → passed (was passed before).
        assert_eq!(verdict_status(&score(Some(60), Some(60), Some(60), "llm")), "passed");
        // Mixed real cell straddling the boundary: 0*0.4 + 90*0.4 + 90*0.2 = 54
        // → passed; the zero here is a real judged tool_accuracy, not an absence.
        assert_eq!(verdict_status(&score(Some(0), Some(90), Some(90), "llm")), "passed");
    }

    /// A degraded evaluation (timeout / heuristic fallback) is still
    /// "inconclusive" regardless of the sub-scores — the sandbox change does not
    /// weaken that guard.
    #[test]
    fn verdict_status_degraded_eval_still_inconclusive() {
        assert_eq!(
            verdict_status(&score(None, Some(80), Some(80), "heuristic_fallback")),
            "inconclusive",
        );
        assert_eq!(
            verdict_status(&score(Some(90), Some(90), Some(90), "timeout")),
            "inconclusive",
        );
    }

    /// A cell with no sub-scores at all is inconclusive, never a spurious
    /// "failed".
    #[test]
    fn verdict_status_no_subscores_is_inconclusive() {
        assert_eq!(verdict_status(&score(None, None, None, "llm")), "inconclusive");
    }

    /// The renormalisation math: absent tool_accuracy reweights output_quality
    /// and protocol over their own base (0.4 + 0.2), so 80/80 → 80, while
    /// full-coverage renormalises to the same value as the plain weighted sum.
    #[test]
    fn renormalized_composite_reweights_present_scores() {
        // Sandbox: ta absent → (80*0.4 + 80*0.2) / 0.6 = 80.
        let sandbox = renormalized_composite(None, Some(80.0), Some(80.0)).unwrap();
        assert!((sandbox - 80.0).abs() < 1e-9, "got {sandbox}");
        // Full coverage equals the canonical weighted sum.
        let full = renormalized_composite(Some(50.0), Some(80.0), Some(90.0)).unwrap();
        let expected = 50.0 * WEIGHT_TOOL_ACCURACY
            + 80.0 * WEIGHT_OUTPUT_QUALITY
            + 90.0 * WEIGHT_PROTOCOL_COMPLIANCE;
        assert!((full - expected).abs() < 1e-9, "got {full}, expected {expected}");
        // Nothing present → None.
        assert_eq!(renormalized_composite(None, None, None), None);
    }
}
