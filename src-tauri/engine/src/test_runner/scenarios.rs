use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::Mutex;

use personas_db::models::{Persona, PersonaToolDefinition};
use personas_db::DbPool;

use super::{spawn_cli_and_collect, truncate_chars, TestScenario, LAB_MODEL};
use crate::prompt;

/// TTL-based in-memory cache for generated scenarios. Key is a hash of
/// (persona_id, system_prompt, tools, use_case_filter). Avoids re-running
/// the expensive CLI+LLM scenario generation during iterative model comparison.
static SCENARIO_CACHE: std::sync::LazyLock<Mutex<HashMap<u64, (Instant, Vec<TestScenario>)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

const SCENARIO_CACHE_TTL_SECS: u64 = 600;

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
pub(crate) fn scenario_cache_key(
    persona: &personas_db::models::Persona,
    tools: &[personas_db::models::PersonaToolDefinition],
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

// -- Phase 1: Generate scenarios --------------------------------

pub async fn generate_scenarios(
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
        personas_db::repos::llm_spend::SpendCtx {
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
