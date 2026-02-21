use super::design::{extract_fenced_json, find_matching_brace};

// ============================================================================
// Credential Negotiator Prompt Builder
// ============================================================================

/// Build a prompt that instructs Claude to produce a step-by-step provisioning plan
/// for obtaining API credentials from a service's developer portal.
pub fn build_negotiation_prompt(
    service_name: &str,
    connector_json: &serde_json::Value,
    field_keys: &[String],
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# API Credential Provisioning Plan\n\n");
    prompt.push_str("You are an expert developer relations engineer. The user needs to obtain API credentials ");
    prompt.push_str("for a service. Generate a detailed, step-by-step provisioning plan that walks them through ");
    prompt.push_str("the exact process of getting the required credentials.\n\n");

    prompt.push_str("## Service\n");
    prompt.push_str(service_name);
    prompt.push_str("\n\n");

    prompt.push_str("## Connector Definition\n");
    prompt.push_str(
        &serde_json::to_string_pretty(connector_json)
            .unwrap_or_else(|_| connector_json.to_string()),
    );
    prompt.push_str("\n\n");

    prompt.push_str("## Required Credential Fields\n");
    for key in field_keys {
        prompt.push_str(&format!("- `{}`\n", key));
    }
    prompt.push('\n');

    prompt.push_str(NEGOTIATION_OUTPUT_SCHEMA);

    prompt
}

/// Build a follow-up prompt for when the user needs help with a specific step.
pub fn build_step_help_prompt(
    service_name: &str,
    step_index: usize,
    step_title: &str,
    user_question: &str,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("# Step Help Request\n\n");
    prompt.push_str(&format!(
        "The user is provisioning credentials for **{}** and is on step {} ({}).\n",
        service_name,
        step_index + 1,
        step_title
    ));
    prompt.push_str("They need help. Provide a concise, actionable response.\n\n");

    prompt.push_str("## User Question\n");
    prompt.push_str(user_question);
    prompt.push_str("\n\n");

    prompt.push_str("## Output Format\n");
    prompt.push_str("Respond with ONLY a JSON block:\n\n");
    prompt.push_str("```json\n");
    prompt.push_str("{\n");
    prompt.push_str("  \"answer\": \"Concise markdown answer to the user's question\",\n");
    prompt.push_str("  \"updated_url\": null\n");
    prompt.push_str("}\n");
    prompt.push_str("```\n\n");
    prompt.push_str("`updated_url` — if you can provide a more specific URL for the user to visit, include it; otherwise null.\n");

    prompt
}

// ============================================================================
// Result Extractor
// ============================================================================

/// Extract a negotiation plan JSON from Claude's output text.
pub fn extract_negotiation_result(output: &str) -> Option<serde_json::Value> {
    // Strategy 1: Find fenced JSON code block
    if let Some(result) = extract_fenced_json(output) {
        if result.get("steps").is_some() {
            return Some(result);
        }
    }

    // Strategy 2: Find bare JSON object containing "steps" key
    let chars: Vec<char> = output.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '{' {
            if let Some(end) = find_matching_brace(&chars, i) {
                let candidate: String = chars[i..=end].iter().collect();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&candidate) {
                    if val.get("steps").is_some() {
                        return Some(val);
                    }
                }
            }
        }
        i += 1;
    }

    None
}

/// Extract a step help response from Claude's output text.
pub fn extract_step_help_result(output: &str) -> Option<serde_json::Value> {
    if let Some(result) = extract_fenced_json(output) {
        if result.get("answer").is_some() {
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
                    if val.get("answer").is_some() {
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

const NEGOTIATION_OUTPUT_SCHEMA: &str = r####"## Required Output Format

Generate a step-by-step provisioning plan. Each step should be a specific, actionable instruction with a direct URL when applicable.

Output ONLY a JSON code block:

```json
{
  "service_name": "GitHub",
  "estimated_time_seconds": 90,
  "prerequisites": [
    "A GitHub account (free tier works)"
  ],
  "steps": [
    {
      "title": "Open Developer Settings",
      "description": "Navigate to GitHub's personal access token settings page.",
      "action_type": "navigate",
      "url": "https://github.com/settings/tokens/new",
      "requires_human": false,
      "field_fills": null,
      "visual_hint": "Click 'Generate new token (classic)' if prompted to choose token type.",
      "wait_for": null
    },
    {
      "title": "Configure Token Permissions",
      "description": "Select the required scopes for your token.",
      "action_type": "configure",
      "url": null,
      "requires_human": true,
      "field_fills": null,
      "visual_hint": "Check 'repo' for full repository access. Check 'read:org' for organization access.",
      "wait_for": "User selects permissions and clicks 'Generate token'"
    },
    {
      "title": "Copy Token",
      "description": "Copy the generated personal access token. It will only be shown once.",
      "action_type": "capture",
      "url": null,
      "requires_human": true,
      "field_fills": {
        "personal_access_token": "The token starting with ghp_..."
      },
      "visual_hint": "Click the copy icon next to the token value. The token starts with 'ghp_'.",
      "wait_for": "User copies the token value"
    }
  ],
  "verification_hint": "After pasting your token, we'll test it by calling the GitHub API to verify it works.",
  "tips": [
    "Store your token securely — GitHub will not show it again",
    "Use fine-grained tokens for better security when available"
  ]
}
```

Important rules:
1. `action_type` must be one of: `navigate` (open a URL), `configure` (fill forms/select options on the portal), `create_account` (sign up for the service), `authorize` (OAuth/consent flow), `capture` (copy/capture a credential value), `verify` (email/phone verification).
2. `requires_human` — true if the step requires human interaction (CAPTCHA, clicking buttons, reading values). false only for simple navigation.
3. `field_fills` — maps credential field keys to descriptions of what value to capture at this step. Only set on `capture` steps.
4. `url` — provide the most specific, direct URL possible. Deep-link to the exact settings page, not the homepage.
5. `wait_for` — describes what the user action we're waiting for before proceeding. null if automatic.
6. `visual_hint` — brief instruction about what the user will see on the page and what to click/do.
7. `estimated_time_seconds` — realistic estimate for the entire flow.
8. `prerequisites` — list of things the user needs before starting (account, payment method, etc.).
9. `tips` — helpful tips about the credential (security, expiration, etc.).
10. `verification_hint` — what happens after all credentials are captured.
11. Steps should be ordered chronologically. Include account creation steps if the service requires sign-up.
12. Be specific about URLs — use the exact developer portal URLs, not generic homepages.
13. For OAuth services, include steps for creating an OAuth app/client in the developer portal.
14. Output ONLY the JSON block — no additional text before or after.
"####;

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_connector() -> serde_json::Value {
        serde_json::json!({
            "name": "github",
            "label": "GitHub",
            "category": "dev_tools",
            "color": "#24292F",
            "fields": [
                {"key": "personal_access_token", "label": "Personal Access Token", "type": "password", "required": true}
            ]
        })
    }

    #[test]
    fn test_build_negotiation_prompt_contains_service() {
        let prompt = build_negotiation_prompt(
            "GitHub",
            &sample_connector(),
            &["personal_access_token".into()],
        );
        assert!(prompt.contains("GitHub"));
        assert!(prompt.contains("personal_access_token"));
        assert!(prompt.contains("# API Credential Provisioning Plan"));
        assert!(prompt.contains("Required Output Format"));
    }

    #[test]
    fn test_extract_negotiation_result_fenced() {
        let json = serde_json::json!({
            "service_name": "GitHub",
            "estimated_time_seconds": 90,
            "prerequisites": [],
            "steps": [
                {
                    "title": "Open Settings",
                    "description": "Go to GitHub token settings",
                    "action_type": "navigate",
                    "url": "https://github.com/settings/tokens",
                    "requires_human": false,
                    "field_fills": null,
                    "visual_hint": "Click generate",
                    "wait_for": null
                }
            ],
            "verification_hint": "We'll test the token",
            "tips": []
        });
        let output = format!("Here:\n\n```json\n{}\n```\n", json);
        let result = extract_negotiation_result(&output);
        assert!(result.is_some());
        let val = result.unwrap();
        assert_eq!(
            val.get("service_name").and_then(|v| v.as_str()),
            Some("GitHub")
        );
    }

    #[test]
    fn test_extract_negotiation_result_bare() {
        let json = serde_json::json!({
            "steps": [{"title": "test"}],
            "service_name": "Test"
        })
        .to_string();
        let output = format!("Result: {}", json);
        let result = extract_negotiation_result(&output);
        assert!(result.is_some());
    }

    #[test]
    fn test_extract_no_steps() {
        let output = "I couldn't generate a plan.";
        let result = extract_negotiation_result(output);
        assert!(result.is_none());
    }

    #[test]
    fn test_build_step_help_prompt() {
        let prompt = build_step_help_prompt("GitHub", 1, "Configure Token", "Where do I find scopes?");
        assert!(prompt.contains("GitHub"));
        assert!(prompt.contains("Configure Token"));
        assert!(prompt.contains("Where do I find scopes?"));
    }
}
