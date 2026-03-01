//! Intent Compiler — compiles plain-language intent into a complete persona configuration.
//!
//! Extends the design analysis pipeline with:
//! - Use cases with typed input_schema and sample data
//! - Model recommendation with budget optimization
//! - Test scenarios for pre-deployment validation
//! - Intent-level traceability for version tracking

use crate::db::models::{ConnectorDefinition, Persona, PersonaToolDefinition};
use crate::engine::design::DESIGN_OUTPUT_SCHEMA;

/// Build the intent compilation prompt.
///
/// Unlike the standard design prompt, this produces an extended output that includes
/// use_cases, model_recommendation, and test_scenarios alongside the standard design.
pub fn build_intent_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    connectors: &[ConnectorDefinition],
    intent: &str,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# Intent-to-Persona Compiler\n\n");
    prompt.push_str(
        "You are an expert AI systems architect. The user will describe what they want \
         their persona to accomplish in plain language. Your job is to compile this \
         intent into a **complete, production-ready persona configuration** — \
         covering every aspect from prompt to triggers to test scenarios.\n\n",
    );

    // Persona context
    prompt.push_str(&format!("## Target Persona: {}\n", persona.name));
    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            prompt.push_str(&format!("Description: {}\n", desc));
        }
    }
    prompt.push('\n');

    // Available tools
    if !tools.is_empty() {
        prompt.push_str("## Available Tools\n");
        for tool in tools {
            prompt.push_str(&format!(
                "- **{}** ({}): {}\n",
                tool.name, tool.category, tool.description
            ));
        }
        prompt.push('\n');
    }

    // Available connectors
    if !connectors.is_empty() {
        prompt.push_str("## Available Connectors\n");
        let mut groups: std::collections::BTreeMap<&str, Vec<&ConnectorDefinition>> =
            std::collections::BTreeMap::new();
        for conn in connectors {
            groups.entry(conn.category.as_str()).or_default().push(conn);
        }
        for (category, conns) in &groups {
            prompt.push_str(&format!("### {}\n", category));
            for conn in conns {
                prompt.push_str(&format!("- **{}**: {}\n", conn.name, conn.label));
            }
            prompt.push('\n');
        }
    }

    // User intent
    prompt.push_str("## User Intent\n");
    prompt.push_str(intent);
    prompt.push_str("\n\n");

    // Standard design schema (generates structured_prompt, tools, triggers, etc.)
    prompt.push_str(DESIGN_OUTPUT_SCHEMA);

    // Extended intent schema — appended AFTER the standard schema
    prompt.push_str(INTENT_EXTENSION_SCHEMA);

    prompt
}

/// Additional schema fields for intent compilation, appended to the standard design output.
const INTENT_EXTENSION_SCHEMA: &str = r##"

## Intent Compiler Extensions

In ADDITION to the standard output fields above, you MUST also include these fields in the same JSON output:

```json
{
  "intent_statement": "The original user intent, preserved verbatim for traceability",
  "use_cases": [
    {
      "id": "uc_1",
      "name": "Human-readable use case name",
      "description": "What this use case validates",
      "input_schema": {
        "type": "object",
        "properties": {
          "field_name": { "type": "string", "description": "What this field is" }
        },
        "required": ["field_name"]
      },
      "sample_input": { "field_name": "realistic example value" },
      "expected_behavior": "What the persona should do with this input",
      "execution_mode": "e2e|mock",
      "time_filter": "last_24h|last_7d|last_30d|all_time|null"
    }
  ],
  "model_recommendation": {
    "recommended_model": "haiku|sonnet|opus",
    "reasoning": "Why this model fits the intent complexity and budget",
    "estimated_cost_per_run_usd": 0.01,
    "complexity_level": "simple|moderate|complex",
    "quality_requirements": "What quality bar this intent demands"
  },
  "test_scenarios": [
    {
      "id": "ts_1",
      "name": "Test scenario name",
      "category": "happy_path|edge_case|error_handling|performance",
      "input": { "field": "value" },
      "expected_outcome": "What should happen",
      "assertions": ["Assertion 1", "Assertion 2"]
    }
  ]
}
```

Intent extension rules:
1. `intent_statement` MUST be the user's original intent, quoted verbatim
2. Generate 2-5 `use_cases` covering the primary workflows described in the intent
3. Each use case `input_schema` must be valid JSON Schema
4. `sample_input` must conform to the `input_schema` with realistic data
5. `execution_mode` should be "e2e" when tools/connectors are available, "mock" otherwise
6. `model_recommendation` should pick the cheapest model that meets quality needs:
   - "haiku" (~$0.25/1K tokens) for simple routing, filtering, formatting
   - "sonnet" (~$3/1K tokens) for analysis, summarization, multi-step reasoning
   - "opus" (~$15/1K tokens) for complex creative/strategic tasks
7. Generate 10-20 `test_scenarios` with good coverage:
   - At least 5 happy_path scenarios
   - At least 3 edge_case scenarios
   - At least 2 error_handling scenarios
8. Each test scenario `input` should match the relevant use case's `input_schema`
"##;
