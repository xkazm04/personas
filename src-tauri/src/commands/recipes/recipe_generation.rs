//! LLM-powered recipe generation via the AI artifact flow.
//!
//! Follows the same pattern as credential_design and negotiator:
//! spawn Claude CLI → stream progress → extract structured JSON result.

use crate::commands::credentials::ai_artifact_flow::AiArtifactMessages;
use crate::engine::design::extract_json_by_key;

// ── Messages ────────────────────────────────────────────────────

pub const RECIPE_GENERATION_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: "recipe-generation-status",
    progress_event: "recipe-generation-progress",
    id_field: "generation_id",
    initial_status: "generating",
    init_progress: "Researching API capabilities...",
    streaming_progress: "Designing recipe and testing integration...",
    complete_prefix: "Recipe ready",
    success_progress: "Recipe generated successfully",
    extraction_failed_error:
        "Failed to extract recipe from Claude output. Try describing your intent more specifically.",
    log_label: "recipe_generation",
    timeout_secs: 300,
};

// ── Prompt builder ──────────────────────────────────────────────

pub fn build_recipe_generation_prompt(
    description: &str,
    credential_name: &str,
    credential_service: &str,
) -> String {
    format!(
        r#"You are an API recipe designer for the "{credential_name}" credential (service: {credential_service}).

The user wants a reusable recipe that does:
{description}

Your task:
1. Research what API endpoints / capabilities are available for {credential_service}
2. Design a recipe that accomplishes the user's intent
3. Create a clear prompt template with {{{{variable}}}} placeholders for dynamic inputs
4. Determine the input schema (what the user needs to provide)
5. Run a mental integration test — verify the approach would work
6. Provide a realistic example result showing what the output would look like

Return ONLY a JSON object (in a ```json fenced block) with these exact fields:

```json
{{
  "name": "Short descriptive recipe name",
  "description": "What this recipe does in 1-2 sentences",
  "category": "analysis|generation|transform|automation|monitoring",
  "prompt_template": "The prompt template with {{{{variable}}}} placeholders",
  "input_schema": "[{{\"key\":\"var_name\",\"type\":\"text\",\"label\":\"Human Label\",\"default\":\"\"}}]",
  "tags": "comma,separated,tags",
  "example_result": "A realistic example of what the recipe would return when executed",
  "sample_inputs": "{{\"var_name\": \"realistic test value\", ...}}"
}}
```

Important:
- The prompt_template should be a complete, self-contained instruction
- input_schema is a JSON array of field definitions
- example_result should be realistic and detailed enough for the user to evaluate
- sample_inputs should be a JSON object with keys matching input_schema field keys and realistic test values"#
    )
}

// ── Extractor ───────────────────────────────────────────────────

pub fn extract_recipe_generation_result(output: &str) -> Option<serde_json::Value> {
    extract_json_by_key(output, &["name", "prompt_template"])
}
