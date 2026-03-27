use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::models::Persona;
use crate::db::models::PersonaGroup;
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::DbPool;
use crate::engine::prompt;
use crate::engine::types::ModelProfile;

/// Where a configuration value was inherited from.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ConfigSource {
    /// Value set directly on the agent (persona-level)
    Agent,
    /// Value inherited from the workspace (group-level)
    Workspace,
    /// Value inherited from global settings
    Global,
    /// No value configured at any level
    Default,
}

/// A single resolved config field with its effective value and inheritance source.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, concrete(T = String))]
#[serde(rename_all = "camelCase")]
pub struct ConfigField<T: Serialize + Clone + ts_rs::TS> {
    /// The effective (resolved) value, or None if no level provides it.
    pub value: Option<T>,
    /// Where the effective value was inherited from.
    pub source: ConfigSource,
    /// Whether this field was explicitly overridden at the agent level
    /// (i.e., agent has a different value than what workspace/global would provide).
    pub is_overridden: bool,
}

/// The full effective model configuration for a persona, with inheritance metadata.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveModelConfig {
    pub persona_id: String,
    pub persona_name: String,
    pub workspace_name: Option<String>,
    pub model: ConfigField<String>,
    pub provider: ConfigField<String>,
    pub base_url: ConfigField<String>,
    pub auth_token: ConfigField<String>,
    pub max_budget_usd: ConfigField<f64>,
    pub max_turns: ConfigField<i32>,
    pub prompt_cache_policy: ConfigField<String>,
}

/// Resolve the effective model configuration for a persona by merging:
/// 1. Global settings (lowest priority)
/// 2. Workspace/group defaults (medium priority)
/// 3. Persona-level overrides (highest priority)
///
/// Each resolved field logs which tier supplied the value so that config
/// inheritance is visible in traces rather than implicit in code.
pub fn resolve_effective_config(
    pool: &DbPool,
    persona: &Persona,
    workspace: Option<&PersonaGroup>,
) -> EffectiveModelConfig {
    // Parse model profiles at each level
    let agent_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let ws_profile = workspace
        .and_then(|ws| ws.default_model_profile.as_deref())
        .and_then(|s| prompt::parse_model_profile(Some(s)));

    // Build global-level model profile from settings
    let global_profile = resolve_global_model_profile(pool);

    // Resolve each field through the cascade
    let model = resolve_string_field(
        agent_profile.as_ref().and_then(|p| p.model.clone()),
        ws_profile.as_ref().and_then(|p| p.model.clone()),
        global_profile.as_ref().and_then(|p| p.model.clone()),
    );

    let provider = resolve_string_field(
        agent_profile.as_ref().and_then(|p| p.provider.clone()),
        ws_profile.as_ref().and_then(|p| p.provider.clone()),
        global_profile.as_ref().and_then(|p| p.provider.clone()),
    );

    let base_url = resolve_string_field(
        agent_profile.as_ref().and_then(|p| p.base_url.clone()),
        ws_profile.as_ref().and_then(|p| p.base_url.clone()),
        global_profile.as_ref().and_then(|p| p.base_url.clone()),
    );

    // Auth token: also check global provider-specific keys (Ollama API key, LiteLLM master key)
    let effective_provider = provider.value.as_deref();
    let global_auth = resolve_global_auth_token(pool, effective_provider, &global_profile);
    let auth_token = resolve_string_field(
        agent_profile.as_ref().and_then(|p| p.auth_token.clone()),
        ws_profile.as_ref().and_then(|p| p.auth_token.clone()),
        global_auth,
    );

    let max_budget_usd = resolve_f64_field(
        persona.max_budget_usd,
        workspace.and_then(|ws| ws.default_max_budget_usd),
        None, // No global budget default
    );

    let max_turns = resolve_i32_field(
        persona.max_turns,
        workspace.and_then(|ws| ws.default_max_turns),
        None, // No global turns default
    );

    let prompt_cache_policy = resolve_string_field(
        agent_profile.as_ref().and_then(|p| p.prompt_cache_policy.clone()),
        ws_profile.as_ref().and_then(|p| p.prompt_cache_policy.clone()),
        global_profile.as_ref().and_then(|p| p.prompt_cache_policy.clone()),
    );

    let config = EffectiveModelConfig {
        persona_id: persona.id.clone(),
        persona_name: persona.name.clone(),
        workspace_name: workspace.map(|ws| ws.name.clone()),
        model,
        provider,
        base_url,
        auth_token,
        max_budget_usd,
        max_turns,
        prompt_cache_policy,
    };

    // Log the resolution chain so admins can trace which tier won for each field.
    log_resolution(&config);

    config
}

/// Log the resolved config showing which tier supplied each value.
fn log_resolution(config: &EffectiveModelConfig) {
    fn source_label(source: &ConfigSource) -> &'static str {
        match source {
            ConfigSource::Agent => "agent",
            ConfigSource::Workspace => "workspace",
            ConfigSource::Global => "global",
            ConfigSource::Default => "default",
        }
    }

    tracing::debug!(
        persona_id = %config.persona_id,
        persona_name = %config.persona_name,
        model_source = source_label(&config.model.source),
        provider_source = source_label(&config.provider.source),
        budget_source = source_label(&config.max_budget_usd.source),
        turns_source = source_label(&config.max_turns.source),
        cache_source = source_label(&config.prompt_cache_policy.source),
        "Config resolution: model={} provider={} budget={} turns={} cache={}",
        config.model.value.as_deref().unwrap_or("--"),
        config.provider.value.as_deref().unwrap_or("--"),
        config.max_budget_usd.value.map_or("--".to_string(), |v| format!("${v:.2}")),
        config.max_turns.value.map_or("--".to_string(), |v| v.to_string()),
        config.prompt_cache_policy.value.as_deref().unwrap_or("--"),
    );
}

/// Build a global-level ModelProfile from app_settings.
fn resolve_global_model_profile(pool: &DbPool) -> Option<ModelProfile> {
    // Check for a global default model profile stored in settings
    let json = settings::get(pool, settings_keys::GLOBAL_MODEL_PROFILE).ok().flatten()?;
    serde_json::from_str::<ModelProfile>(&json).ok()
}

/// Resolve the global auth token based on the effective provider.
fn resolve_global_auth_token(
    pool: &DbPool,
    effective_provider: Option<&str>,
    global_profile: &Option<ModelProfile>,
) -> Option<String> {
    // First check the global profile's own auth_token
    if let Some(ref gp) = global_profile {
        if gp.auth_token.is_some() {
            return gp.auth_token.clone();
        }
    }

    // Then check provider-specific global settings
    match effective_provider {
        Some("ollama") => settings::get(pool, settings_keys::OLLAMA_API_KEY)
            .ok()
            .flatten()
            .filter(|k| !k.is_empty()),
        Some("litellm") => settings::get(pool, settings_keys::LITELLM_MASTER_KEY)
            .ok()
            .flatten()
            .filter(|k| !k.is_empty()),
        _ => None,
    }
}

fn resolve_string_field(
    agent: Option<String>,
    workspace: Option<String>,
    global: Option<String>,
) -> ConfigField<String> {
    let agent_has = agent.as_ref().is_some_and(|s| !s.is_empty());
    let ws_has = workspace.as_ref().is_some_and(|s| !s.is_empty());
    let global_has = global.as_ref().is_some_and(|s| !s.is_empty());

    if agent_has {
        ConfigField {
            value: agent,
            source: ConfigSource::Agent,
            is_overridden: ws_has || global_has,
        }
    } else if ws_has {
        ConfigField {
            value: workspace,
            source: ConfigSource::Workspace,
            is_overridden: false,
        }
    } else if global_has {
        ConfigField {
            value: global,
            source: ConfigSource::Global,
            is_overridden: false,
        }
    } else {
        ConfigField {
            value: None,
            source: ConfigSource::Default,
            is_overridden: false,
        }
    }
}

fn resolve_f64_field(
    agent: Option<f64>,
    workspace: Option<f64>,
    global: Option<f64>,
) -> ConfigField<f64> {
    if let Some(v) = agent {
        ConfigField {
            value: Some(v),
            source: ConfigSource::Agent,
            is_overridden: workspace.is_some() || global.is_some(),
        }
    } else if let Some(v) = workspace {
        ConfigField {
            value: Some(v),
            source: ConfigSource::Workspace,
            is_overridden: false,
        }
    } else if let Some(v) = global {
        ConfigField {
            value: Some(v),
            source: ConfigSource::Global,
            is_overridden: false,
        }
    } else {
        ConfigField {
            value: None,
            source: ConfigSource::Default,
            is_overridden: false,
        }
    }
}

fn resolve_i32_field(
    agent: Option<i32>,
    workspace: Option<i32>,
    global: Option<i32>,
) -> ConfigField<i32> {
    if let Some(v) = agent {
        ConfigField {
            value: Some(v),
            source: ConfigSource::Agent,
            is_overridden: workspace.is_some() || global.is_some(),
        }
    } else if let Some(v) = workspace {
        ConfigField {
            value: Some(v),
            source: ConfigSource::Workspace,
            is_overridden: false,
        }
    } else if let Some(v) = global {
        ConfigField {
            value: Some(v),
            source: ConfigSource::Global,
            is_overridden: false,
        }
    } else {
        ConfigField {
            value: None,
            source: ConfigSource::Default,
            is_overridden: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_string_agent_wins() {
        let result = resolve_string_field(
            Some("agent-model".into()),
            Some("ws-model".into()),
            Some("global-model".into()),
        );
        assert_eq!(result.value.as_deref(), Some("agent-model"));
        assert_eq!(result.source, ConfigSource::Agent);
        assert!(result.is_overridden);
    }

    #[test]
    fn test_resolve_string_workspace_fallback() {
        let result = resolve_string_field(
            None,
            Some("ws-model".into()),
            Some("global-model".into()),
        );
        assert_eq!(result.value.as_deref(), Some("ws-model"));
        assert_eq!(result.source, ConfigSource::Workspace);
        assert!(!result.is_overridden);
    }

    #[test]
    fn test_resolve_string_global_fallback() {
        let result = resolve_string_field(None, None, Some("global-model".into()));
        assert_eq!(result.value.as_deref(), Some("global-model"));
        assert_eq!(result.source, ConfigSource::Global);
        assert!(!result.is_overridden);
    }

    #[test]
    fn test_resolve_string_empty_skipped() {
        let result = resolve_string_field(
            Some("".into()),
            Some("ws-model".into()),
            None,
        );
        assert_eq!(result.value.as_deref(), Some("ws-model"));
        assert_eq!(result.source, ConfigSource::Workspace);
    }

    #[test]
    fn test_resolve_string_all_none() {
        let result = resolve_string_field(None, None, None);
        assert!(result.value.is_none());
        assert_eq!(result.source, ConfigSource::Default);
        assert!(!result.is_overridden);
    }
}
