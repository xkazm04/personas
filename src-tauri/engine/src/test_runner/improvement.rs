use personas_db::models::Persona;
use personas_db::DbPool;

use super::{spawn_cli_and_collect, truncate_chars, LAB_MODEL};
use crate::prompt;

// -- Matrix helpers ---------------------------------------------

pub(crate) fn build_draft_generation_prompt(
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

pub(crate) fn parse_draft_from_output(output: &str) -> Result<(serde_json::Value, String), String> {
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
        personas_db::repos::llm_spend::SpendCtx {
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
