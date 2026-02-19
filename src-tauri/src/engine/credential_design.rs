use crate::db::models::ConnectorDefinition;
use super::design::{extract_fenced_json, find_matching_brace};

// ============================================================================
// Credential Design Prompt Builder
// ============================================================================

/// Build a prompt that instructs Claude to produce a connector definition + credential fields JSON.
pub fn build_credential_design_prompt(
    instruction: &str,
    existing_connectors: &[ConnectorDefinition],
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# Credential & Connector Design\n\n");
    prompt.push_str("You are an expert integration architect. The user wants to connect a tool or service.\n");
    prompt.push_str("The user may provide just a service name (e.g. \"Slack\", \"OpenAI\", \"GitHub\"), ");
    prompt.push_str("a service with credential type (e.g. \"GitHub personal access token\"), ");
    prompt.push_str("or a longer description. In all cases, design the appropriate connector and credential fields.\n\n");

    // Existing connectors
    if !existing_connectors.is_empty() {
        prompt.push_str("## Existing Connectors\n");
        prompt.push_str("These connectors are already registered in the system. ");
        prompt.push_str("If the user's request matches one, set `match_existing` to its name instead of creating a duplicate.\n\n");
        for conn in existing_connectors {
            prompt.push_str(&format!("- **{}** ({}) — {}\n", conn.name, conn.category, conn.label));
        }
        prompt.push('\n');
    }

    // User instruction
    prompt.push_str("## User Request\n");
    prompt.push_str(instruction);
    prompt.push_str("\n\n");

    // Output schema
    prompt.push_str(CREDENTIAL_DESIGN_OUTPUT_SCHEMA);

    prompt
}

/// Build a prompt to dynamically derive a healthcheck endpoint/config for a
/// concrete credential flow.
pub fn build_credential_healthcheck_prompt(
    instruction: &str,
    connector: &serde_json::Value,
    field_keys: &[String],
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# Credential Healthcheck Design\n\n");
    prompt.push_str("You are validating an API credential connector.\n");
    prompt.push_str("Choose a reliable auth/test endpoint and output ONLY JSON.\n\n");

    prompt.push_str("## User Request\n");
    prompt.push_str(instruction);
    prompt.push_str("\n\n");

    prompt.push_str("## Connector\n");
    prompt.push_str(&serde_json::to_string_pretty(connector).unwrap_or_else(|_| connector.to_string()));
    prompt.push_str("\n\n");

    prompt.push_str("## Available Credential Fields\n");
    if field_keys.is_empty() {
        prompt.push_str("- (none)\n");
    } else {
        for key in field_keys {
            prompt.push_str(&format!("- {}\n", key));
        }
    }
    prompt.push('\n');

    prompt.push_str(CREDENTIAL_HEALTHCHECK_OUTPUT_SCHEMA);
    prompt
}

// ============================================================================
// Result Extractor
// ============================================================================

/// Extract a credential design result JSON from Claude's output text.
/// Looks for fenced ```json blocks or bare JSON objects with a `connector` key.
pub fn extract_credential_design_result(output: &str) -> Option<serde_json::Value> {
    // Strategy 1: Find fenced JSON code block
    if let Some(result) = extract_fenced_json(output) {
        if result.get("connector").is_some() {
            return Some(result);
        }
    }

    // Strategy 2: Find bare JSON object containing "connector" key
    if let Some(result) = extract_bare_connector_json(output) {
        return Some(result);
    }

    None
}

/// Extract healthcheck config output from Claude text.
pub fn extract_healthcheck_config_result(output: &str) -> Option<serde_json::Value> {
    if let Some(result) = extract_fenced_json(output) {
        if result.get("skip").is_some() || result.get("endpoint").is_some() {
            return Some(result);
        }
    }

    let chars: Vec<char> = output.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '{' {
            if let Some(end) = find_matching_brace(&chars, i) {
                let candidate: String = chars[i..=end].iter().collect();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&candidate) {
                    if val.get("skip").is_some() || val.get("endpoint").is_some() {
                        return Some(val);
                    }
                }
            }
        }
        i += 1;
    }

    None
}

/// Find a bare JSON object in the output that contains a `connector` key.
fn extract_bare_connector_json(output: &str) -> Option<serde_json::Value> {
    let chars: Vec<char> = output.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '{' {
            if let Some(end) = find_matching_brace(&chars, i) {
                let candidate: String = chars[i..=end].iter().collect();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&candidate) {
                    if val.get("connector").is_some() {
                        return Some(val);
                    }
                }
            }
        }
        i += 1;
    }

    None
}

// ============================================================================
// Output Schema
// ============================================================================

const CREDENTIAL_DESIGN_OUTPUT_SCHEMA: &str = r####"## Required Output Format

You MUST output your result as a single JSON code block. The JSON must conform to this exact schema:

```json
{
  "match_existing": null,
  "connector": {
    "name": "service_name_snake_case",
    "label": "Service Display Name",
    "category": "category_name",
    "color": "#HEX_COLOR",
    "fields": [
      {
        "key": "field_key",
        "label": "Field Label",
        "type": "password",
        "required": true,
        "placeholder": "Example value..."
      }
    ],
    "healthcheck_config": {
      "url": "https://api.example.com/health",
      "method": "GET",
      "headers": { "Authorization": "Bearer {{api_key}}" },
      "expected_status": 200,
      "description": "Verifies API key is valid"
    },
    "services": [],
    "events": []
  },
  "setup_instructions": "## How to get your API key\n\n1. Go to ...\n2. Navigate to ...\n3. Copy the key",
  "summary": "One-line summary of what this connector does"
}
```

Important rules:
1. `match_existing` — set to the existing connector `name` string if the user's request matches an existing connector listed above, or `null` if a new connector is needed. When matching existing, still provide the full `connector` object matching the existing definition.
2. `connector.name` — lowercase snake_case identifier (e.g. `slack`, `github`, `openai_api`)
3. `connector.fields` — each field needs: `key` (snake_case), `label`, `type` ("text" or "password"), `required` (boolean), `placeholder`
4. `connector.fields[].type` — use "password" for API keys, tokens, and secrets; "text" for everything else
5. `connector.healthcheck_config` — provide if the service has a simple health/auth-check endpoint, otherwise set to `null`. Use `{{field_key}}` placeholders in URL and headers to reference credential field values.
6. `connector.services` — JSON array of service definitions (can be empty `[]`)
7. `connector.events` — JSON array of event definitions (can be empty `[]`)
8. `setup_instructions` — markdown instructions helping the user obtain the required credentials
9. `connector.color` — a brand-appropriate hex color for the service
10. Output ONLY the JSON block — no additional text before or after
"####;

const CREDENTIAL_HEALTHCHECK_OUTPUT_SCHEMA: &str = r####"## Required Output Format

Output exactly one JSON block with this schema:

```json
{
    "skip": false,
    "reason": null,
    "endpoint": "https://api.example.com/v1/me",
    "method": "GET",
    "headers": {
        "Authorization": "Bearer {{api_key}}"
    },
    "expected_status": 200,
    "description": "Validates that credential can access the user profile endpoint"
}
```

Rules:
1. If no safe/reliable endpoint exists, set `skip` to true and explain in `reason`.
2. Use placeholders like `{{api_key}}` from provided field keys.
3. Prefer low-risk identity/profile endpoints over write operations.
4. Output ONLY the JSON block.
"####;

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::ConnectorDefinition;

    fn test_connector() -> ConnectorDefinition {
        ConnectorDefinition {
            id: "c-1".into(),
            name: "slack".into(),
            label: "Slack".into(),
            icon_url: None,
            color: "#4A154B".into(),
            category: "messaging".into(),
            fields: "[]".into(),
            healthcheck_config: None,
            services: "[]".into(),
            events: "[]".into(),
            metadata: None,
            is_builtin: true,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn sample_result() -> String {
        serde_json::json!({
            "match_existing": null,
            "connector": {
                "name": "github",
                "label": "GitHub",
                "category": "dev_tools",
                "color": "#24292F",
                "fields": [
                    {"key": "personal_access_token", "label": "Personal Access Token", "type": "password", "required": true, "placeholder": "ghp_..."}
                ],
                "healthcheck_config": {
                    "url": "https://api.github.com/user",
                    "method": "GET",
                    "headers": {"Authorization": "Bearer {{personal_access_token}}"},
                    "expected_status": 200,
                    "description": "Verifies token is valid"
                },
                "services": [],
                "events": []
            },
            "setup_instructions": "Go to GitHub Settings",
            "summary": "GitHub API integration via personal access token"
        }).to_string()
    }

    #[test]
    fn test_prompt_contains_instruction() {
        let prompt = build_credential_design_prompt("Connect to GitHub API", &[]);
        assert!(prompt.contains("Connect to GitHub API"));
        assert!(prompt.contains("# Credential & Connector Design"));
        assert!(prompt.contains("Required Output Format"));
    }

    #[test]
    fn test_prompt_lists_existing_connectors() {
        let conn = test_connector();
        let prompt = build_credential_design_prompt("Connect to Slack", &[conn]);
        assert!(prompt.contains("## Existing Connectors"));
        assert!(prompt.contains("slack"));
        assert!(prompt.contains("Slack"));
    }

    #[test]
    fn test_prompt_no_existing_connectors() {
        let prompt = build_credential_design_prompt("Connect to Slack", &[]);
        assert!(!prompt.contains("## Existing Connectors"));
    }

    #[test]
    fn test_extract_fenced_result() {
        let json = sample_result();
        let output = format!("Here is the result:\n\n```json\n{}\n```\n\nDone.", json);
        let result = extract_credential_design_result(&output);
        assert!(result.is_some());
        let val = result.unwrap();
        assert!(val.get("connector").is_some());
        assert_eq!(
            val.get("connector").unwrap().get("name").and_then(|v| v.as_str()),
            Some("github")
        );
    }

    #[test]
    fn test_extract_bare_result() {
        let json = sample_result();
        let output = format!("Analysis complete. {}", json);
        let result = extract_credential_design_result(&output);
        assert!(result.is_some());
        let val = result.unwrap();
        assert!(val.get("connector").is_some());
    }

    #[test]
    fn test_extract_no_result() {
        let output = "I could not determine the connector configuration.";
        let result = extract_credential_design_result(output);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_match_existing() {
        let output = "```json\n{\"match_existing\":\"slack\",\"connector\":{\"name\":\"slack\",\"label\":\"Slack\",\"category\":\"messaging\",\"color\":\"#4A154B\",\"fields\":[{\"key\":\"bot_token\",\"label\":\"Bot Token\",\"type\":\"password\",\"required\":true,\"placeholder\":\"xoxb-...\"}],\"healthcheck_config\":null,\"services\":[],\"events\":[]},\"setup_instructions\":\"Use existing Slack connector\",\"summary\":\"Slack bot integration\"}\n```";
        let result = extract_credential_design_result(output);
        assert!(result.is_some());
        let val = result.unwrap();
        assert_eq!(
            val.get("match_existing").and_then(|v| v.as_str()),
            Some("slack")
        );
    }
}
