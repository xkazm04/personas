//! LLM-powered recipe versioning via the AI artifact flow.
//!
//! Compares the original recipe with user requirements to generate an updated version.

use crate::commands::credentials::ai_artifact_flow::AiArtifactMessages;
use crate::engine::design::extract_json_by_key;

// -- Messages ----------------------------------------------------

pub const RECIPE_VERSIONING_MESSAGES: AiArtifactMessages = AiArtifactMessages {
    status_event: "recipe-versioning-status",
    progress_event: "recipe-versioning-progress",
    id_field: "versioning_id",
    initial_status: "versioning",
    init_progress: "Analyzing current recipe...",
    streaming_progress: "Designing recipe changes...",
    complete_prefix: "Version ready",
    success_progress: "New version generated successfully",
    extraction_failed_error:
        "Failed to extract version from Claude output. Try describing your changes more specifically.",
    log_label: "recipe_versioning",
    timeout_secs: 300,
};

// -- Prompt builder ----------------------------------------------

pub fn build_recipe_versioning_prompt(
    recipe_name: &str,
    current_prompt_template: &str,
    current_input_schema: Option<&str>,
    change_requirements: &str,
) -> String {
    let schema_display = current_input_schema.unwrap_or("(none)");
    format!(
        r#"You are modifying an existing recipe called "{recipe_name}".

Current prompt template:
```
{current_prompt_template}
```

Current input schema: {schema_display}

The user wants the following changes:
{change_requirements}

Your task:
1. Understand the current recipe's purpose and structure
2. Apply the requested changes while preserving what works
3. Update the input schema if the changes require new or modified inputs
4. Generate realistic sample inputs for the updated schema
5. Provide a summary of what changed

Return ONLY a JSON object (in a ```json fenced block) with these exact fields:

```json
{{{{
  "prompt_template": "The updated prompt template with {{{{{{{{variable}}}}}}}} placeholders",
  "input_schema": "[{{{{\"key\":\"var_name\",\"type\":\"text\",\"label\":\"Human Label\",\"default\":\"\"}}}}]",
  "sample_inputs": "{{{{\"var_name\": \"realistic test value\"}}}}",
  "description": "Brief description of what this version does",
  "changes_summary": "What was changed and why"
}}}}
```

Important:
- The prompt_template should be a complete, self-contained instruction
- Preserve any working parts of the original recipe
- input_schema is a JSON array of field definitions
- sample_inputs is a JSON object matching input_schema keys with test values
- changes_summary should clearly describe what changed from the previous version"#
    )
}

// -- Extractor ---------------------------------------------------

pub fn extract_recipe_versioning_result(output: &str) -> Option<serde_json::Value> {
    extract_json_by_key(output, &["prompt_template", "changes_summary"])
}
