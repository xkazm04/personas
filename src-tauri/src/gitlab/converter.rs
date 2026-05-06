use std::collections::HashSet;

use crate::db::models::{Persona, PersonaToolDefinition};
use crate::db::repos::resources::audit_log;
use crate::db::repos::resources::{connectors as connector_repo, credentials as cred_repo};
use crate::db::DbPool;
use crate::engine;
use crate::gitlab::types::{
    CredentialProvisionEntry, GitLabAgentDefinition, GitLabAgentTool, GitLabVariable,
};

/// Resolved credentials ready to be provisioned as GitLab CI/CD variables.
pub struct ResolvedCredentials {
    /// GitLab CI/CD variables to upsert (key, masked value)
    pub variables: Vec<GitLabVariable>,
    /// Prompt hint strings (env var name + source label, never the value)
    pub hints: Vec<String>,
    /// Summary entries for the deploy result (env var name + source label)
    pub entries: Vec<CredentialProvisionEntry>,
}

/// Resolve credentials for a persona's tools into GitLab CI/CD variables.
///
/// Mirrors the logic in `engine::runner::resolve_credential_env_vars` but outputs
/// `GitLabVariable` structs instead of process env var pairs. All variables are
/// created with `masked: true` and `protected: true` so GitLab never logs them.
pub fn resolve_credentials_for_gitlab(
    pool: &DbPool,
    tools: &[PersonaToolDefinition],
    persona_id: &str,
    persona_name: &str,
) -> ResolvedCredentials {
    let mut variables: Vec<GitLabVariable> = Vec::new();
    let mut hints: Vec<String> = Vec::new();
    let mut entries: Vec<CredentialProvisionEntry> = Vec::new();
    let mut seen_connectors: HashSet<String> = HashSet::new();

    let connectors = match connector_repo::get_all(pool) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                "Failed to load connectors for GitLab credential provisioning: {}",
                e
            );
            return ResolvedCredentials {
                variables,
                hints,
                entries,
            };
        }
    };

    for tool in tools {
        for connector in &connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });

            if !tool_listed || !seen_connectors.insert(connector.name.clone()) {
                continue;
            }

            let creds = match cred_repo::get_by_service_type(pool, &connector.name) {
                Ok(c) => c,
                Err(_) => continue,
            };

            if let Some(cred) = creds.first() {
                let fields = match cred_repo::get_decrypted_fields(pool, cred) {
                    Ok(f) => f,
                    Err(e) => {
                        tracing::error!(
                            "Failed to decrypt credential '{}' for GitLab provisioning: {}",
                            cred.name,
                            e
                        );
                        continue;
                    }
                };
                if let Err(e) = audit_log::log_decrypt(
                    pool,
                    &cred.id,
                    &cred.name,
                    "gitlab:provision_variables",
                    None,
                    None,
                ) {
                    tracing::warn!(credential_id = %cred.id, error = %e, "Failed to write audit log for credential decrypt");
                }
                let prefix = connector.name.to_uppercase().replace('-', "_");

                for (field_key, field_val) in &fields {
                    let env_key =
                        format!("{}_{}", prefix, field_key.to_uppercase().replace('-', "_"));

                    // GitLab masking requires values >= 8 chars and no newlines.
                    // If a value can't be masked, we still set masked: true (GitLab
                    // will silently ignore the flag if the value is too short) and
                    // we always set protected: true for defence in depth.
                    variables.push(GitLabVariable {
                        key: env_key.clone(),
                        value: field_val.clone(),
                        masked: true,
                        protected: true,
                        variable_type: "env_var".to_string(),
                    });

                    let source_label = format!("{} credential '{}'", connector.label, cred.name);
                    hints.push(format!("`{env_key}` (from {source_label})"));
                    entries.push(CredentialProvisionEntry {
                        env_var_name: env_key,
                        source_label,
                    });
                }

                // Audit log the provisioning
                let _ = cred_repo::record_usage(pool, &cred.id);
                let _ = audit_log::insert(
                    pool,
                    &cred.id,
                    &cred.name,
                    "gitlab_provision",
                    Some(persona_id),
                    Some(persona_name),
                    Some(&format!(
                        "provisioned as CI/CD variable(s) via connector '{}'",
                        connector.label
                    )),
                );
            }
        }
    }

    ResolvedCredentials {
        variables,
        hints,
        entries,
    }
}

/// Convert a Persona and its tools into a GitLab Duo Agent definition.
///
/// When `credential_hints` is provided (from `resolve_credentials_for_gitlab`),
/// the system prompt will include env var names so the agent knows how to
/// authenticate with external services. The actual secret values are never
/// included in the prompt.
pub fn persona_to_agent(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    credential_hints: Option<&[&str]>,
) -> GitLabAgentDefinition {
    let system_prompt = engine::prompt::assemble_prompt(
        persona,
        tools,
        None,
        credential_hints,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    build_agent_definition(persona, tools, system_prompt)
}

/// Build a GitLab Duo Agent definition using an explicit system prompt.
///
/// Used during rollback to deploy a historical snapshot prompt rather than
/// the current persona state.
pub fn persona_to_agent_with_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    system_prompt: String,
) -> GitLabAgentDefinition {
    build_agent_definition(persona, tools, system_prompt)
}

fn build_agent_definition(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    system_prompt: String,
) -> GitLabAgentDefinition {
    let agent_tools: Vec<GitLabAgentTool> = tools
        .iter()
        .map(|t| {
            let input_schema = t
                .input_schema
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok());

            GitLabAgentTool {
                name: t.name.clone(),
                description: t.description.clone(),
                input_schema,
            }
        })
        .collect();

    let metadata = serde_json::json!({
        "source": "personas-desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "persona_id": persona.id,
    });

    GitLabAgentDefinition {
        name: persona.name.clone(),
        description: persona.description.clone().unwrap_or_default(),
        system_prompt,
        model: persona.model_profile.clone(),
        tools: agent_tools,
        metadata: Some(metadata),
    }
}

/// Convert a Persona into AGENTS.md markdown content for the fallback path.
pub fn persona_to_agents_md(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    credential_hints: Option<&[&str]>,
) -> String {
    let prompt = engine::prompt::assemble_prompt(
        persona,
        tools,
        None,
        credential_hints,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    build_agents_md(persona, tools, &prompt)
}

/// Build AGENTS.md using an explicit system prompt (for rollback from snapshot).
pub fn persona_to_agents_md_with_prompt(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    system_prompt: String,
) -> String {
    build_agents_md(persona, tools, &system_prompt)
}

/// Pick a backtick-fence length that is strictly longer than any run of
/// backticks already present in `content`, with a minimum of 3.
///
/// CommonMark requires the closing fence to be at least as long as the
/// opening fence; by ensuring our fence is *longer* than any inner run we
/// guarantee the prompt round-trips even when it itself contains fenced
/// code blocks (examples, JSON, regex, etc.). Both writer and reader rely
/// on this convention — see `extract_prompt_from_agents_md` in
/// `commands/infrastructure/gitlab.rs`.
pub(crate) fn choose_code_fence_length(content: &str) -> usize {
    let mut max_run = 0usize;
    let mut current = 0usize;
    for ch in content.chars() {
        if ch == '`' {
            current += 1;
            if current > max_run {
                max_run = current;
            }
        } else {
            current = 0;
        }
    }
    std::cmp::max(3, max_run + 1)
}

/// Render the `### System Prompt` section using a dynamically sized fence so
/// the prompt round-trips even when it embeds its own fenced code blocks.
pub(crate) fn format_system_prompt_section(prompt: &str) -> String {
    let fence = "`".repeat(choose_code_fence_length(prompt));
    let mut out = String::with_capacity(prompt.len() + fence.len() * 2 + 32);
    out.push_str("### System Prompt\n\n");
    out.push_str(&fence);
    out.push('\n');
    out.push_str(prompt);
    out.push('\n');
    out.push_str(&fence);
    out.push_str("\n\n");
    out
}

fn build_agents_md(persona: &Persona, tools: &[PersonaToolDefinition], prompt: &str) -> String {
    let mut md = String::new();
    md.push_str("# AGENTS.md\n\n");
    md.push_str("<!-- Generated by Personas Desktop -->\n\n");

    md.push_str(&format!("## Agent: {}\n\n", persona.name));

    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            md.push_str(&format!("**Description:** {desc}\n\n"));
        }
    }

    md.push_str(&format_system_prompt_section(prompt));

    if !tools.is_empty() {
        md.push_str("### Tools\n\n");
        for tool in tools {
            md.push_str(&format!("- **{}**: {}\n", tool.name, tool.description));
        }
        md.push('\n');
    }

    md.push_str(&format!(
        "---\n*Source: Personas Desktop v{}*\n",
        env!("CARGO_PKG_VERSION")
    ));

    md
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fence_length_is_three_for_plain_content() {
        assert_eq!(choose_code_fence_length("hello world"), 3);
        assert_eq!(choose_code_fence_length(""), 3);
    }

    #[test]
    fn fence_length_grows_past_inner_runs() {
        // Inner triple-fence => need 4 backticks.
        assert_eq!(
            choose_code_fence_length("example:\n```python\nprint(1)\n```"),
            4
        );
        // Inner quadruple-fence => need 5.
        assert_eq!(choose_code_fence_length("````nested````"), 5);
    }

    #[test]
    fn system_prompt_section_uses_long_enough_fence() {
        let prompt = "Quote me:\n```json\n{\"a\": 1}\n```";
        let section = format_system_prompt_section(prompt);
        assert!(
            section.starts_with("### System Prompt\n\n````\n"),
            "expected 4-backtick fence, got: {section}"
        );
        assert!(
            section.contains("\n````\n\n"),
            "expected matching 4-backtick close fence, got: {section}"
        );
    }
}
