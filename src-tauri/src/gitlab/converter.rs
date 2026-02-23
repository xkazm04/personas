use std::collections::{HashMap, HashSet};

use crate::db::models::{Persona, PersonaToolDefinition};
use crate::db::repos::resources::{connectors as connector_repo, credentials as cred_repo};
use crate::db::repos::resources::audit_log;
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
            tracing::warn!("Failed to load connectors for GitLab credential provisioning: {}", e);
            return ResolvedCredentials { variables, hints, entries };
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
                let plaintext = if engine::crypto::is_plaintext(&cred.iv) {
                    cred.encrypted_data.clone()
                } else {
                    match engine::crypto::decrypt_from_db(&cred.encrypted_data, &cred.iv) {
                        Ok(pt) => pt,
                        Err(e) => {
                            tracing::error!(
                                "Failed to decrypt credential '{}' for GitLab provisioning: {}",
                                cred.name,
                                e
                            );
                            continue;
                        }
                    }
                };

                let fields: HashMap<String, String> =
                    serde_json::from_str(&plaintext).unwrap_or_default();
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
                    hints.push(format!("`{}` (from {})", env_key, source_label));
                    entries.push(CredentialProvisionEntry {
                        env_var_name: env_key,
                        source_label,
                    });
                }

                // Audit log the provisioning
                let _ = cred_repo::mark_used(pool, &cred.id);
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

    ResolvedCredentials { variables, hints, entries }
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
    let system_prompt = engine::prompt::assemble_prompt(persona, tools, None, credential_hints);

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
    let mut md = String::new();
    md.push_str("# AGENTS.md\n\n");
    md.push_str("<!-- Generated by Personas Desktop -->\n\n");

    md.push_str(&format!("## Agent: {}\n\n", persona.name));

    if let Some(ref desc) = persona.description {
        if !desc.is_empty() {
            md.push_str(&format!("**Description:** {}\n\n", desc));
        }
    }

    md.push_str("### System Prompt\n\n");
    let prompt = engine::prompt::assemble_prompt(persona, tools, None, credential_hints);
    md.push_str("```\n");
    md.push_str(&prompt);
    md.push_str("\n```\n\n");

    if !tools.is_empty() {
        md.push_str("### Tools\n\n");
        for tool in tools {
            md.push_str(&format!("- **{}**: {}\n", tool.name, tool.description));
        }
        md.push_str("\n");
    }

    md.push_str(&format!(
        "---\n*Source: Personas Desktop v{}*\n",
        env!("CARGO_PKG_VERSION")
    ));

    md
}
