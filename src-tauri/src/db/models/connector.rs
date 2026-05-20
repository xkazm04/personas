use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Connector Definitions
// ============================================================================

/// LLM-facing usage hint for a connector.
///
/// This is injected into the runtime system prompt (see `engine/prompt.rs`)
/// so the agent knows how to use the connector without burning tokens on
/// exploratory calls. Lives in `metadata.llm_usage_hint` inside each connector
/// JSON (`scripts/connectors/builtin/*.json`). Field budget: aim for
/// ~200-500 tokens per connector.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsageHint {
    /// One-paragraph description of what this connector exposes at runtime.
    /// Example: "GitHub REST API v3 -- repositories, issues, PRs, releases.
    /// Auth via PAT in $GITHUB_TOKEN."
    pub overview: String,
    /// 3-5 example tool calls with realistic params. Each is a curl/cli
    /// snippet the agent can adapt.
    pub examples: Vec<String>,
    /// Common gotchas or non-obvious behaviors.
    /// Example: "Pagination defaults to 30 items; use ?per_page=100."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gotchas: Option<Vec<String>>,
}

/// Partial deserialization target for the `metadata` JSON blob on a connector.
/// Only fields that are relevant to runtime prompt assembly are listed here;
/// the rest of the metadata remains untyped.
#[derive(Debug, Clone, Deserialize)]
pub struct ConnectorMetadataPartial {
    #[serde(default)]
    pub llm_usage_hint: Option<LlmUsageHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectorDefinition {
    pub id: String,
    pub name: String,
    pub label: String,
    pub icon_url: Option<String>,
    pub color: String,
    pub category: String,
    pub fields: String,
    pub healthcheck_config: Option<String>,
    pub services: String,
    pub events: String,
    pub metadata: Option<String>,
    /// JSON array of `ResourceSpec` objects describing user-pickable sub-resources
    /// (repos, projects, folders). NULL / missing = this connector has no 2nd-level
    /// resource selection. See `scripts/connectors/builtin/*.json -> resources[]`.
    #[serde(default)]
    pub resources: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateConnectorDefinitionInput {
    pub name: String,
    pub label: String,
    pub icon_url: Option<String>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub fields: String,
    pub healthcheck_config: Option<String>,
    pub services: Option<String>,
    pub events: Option<String>,
    pub metadata: Option<String>,
    pub is_builtin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateConnectorDefinitionInput {
    pub name: Option<String>,
    pub label: Option<String>,
    pub icon_url: Option<Option<String>>,
    pub color: Option<String>,
    pub category: Option<String>,
    pub fields: Option<String>,
    pub healthcheck_config: Option<Option<String>>,
    pub services: Option<String>,
    pub events: Option<String>,
    pub metadata: Option<Option<String>>,
}

// ============================================================================
// Connector classification
// ============================================================================
//
// Every connector belongs to exactly one `ConnectorClass`. The class decides
// how "is this connector ready for persona P?" is answered — see the unified
// `connector_readiness` resolver in `commands::design::connector_readiness`.
//
// Background: the codebase used to model connectors as a binary ("needs a
// vault credential" or not), enforced by two byte-identical
// `BUILTIN_LOCAL_CONNECTORS` allowlists. That binary has no slot for a
// builtin connector whose "configured?" signal lives somewhere other than
// `persona_credentials` — e.g. `codebase` (a Dev Tools project) or
// `obsidian_memory` (an Obsidian vault). Full rationale:
// `docs/architecture/connector-classification.md`.

/// Connectors whose configuration is a single global object — there is only
/// ever one, so there is nothing to pick per-persona. Readiness is a probe
/// against that global object (a settings blob). Kept here, next to
/// `classify_connector`, as the single source of truth.
pub const GLOBAL_SINGLETON_CONNECTORS: &[&str] = &["obsidian_memory"];

/// Builtin connectors whose `persona_credentials` row stores a *reference* to
/// a local entity (a Dev Tools project, a Twin profile) rather than an API
/// secret. Readiness = the row exists AND the referenced entity still
/// resolves. New binding-backed builtins are added here + given a probe in
/// `connector_readiness`.
pub const BOUND_CREDENTIAL_CONNECTORS: &[&str] = &["codebase", "twin"];

/// How a connector's readiness is determined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorClass {
    /// Always ready — backed by a local service present from first launch
    /// (`local_drive`, `personas_database`, `codebases`, …). No credential,
    /// no binding.
    ZeroConfig,
    /// Needs a `persona_credentials` row carrying an API secret.
    Credential,
    /// Needs a `persona_credentials` row whose payload references a local
    /// entity chosen via a picker (`codebase` → a Dev Tools project,
    /// `twin` → a Twin profile).
    BoundCredential,
    /// Ready iff a single global configuration exists (`obsidian_memory`).
    GlobalSingleton,
}

/// Subset of a connector's `metadata` JSON blob relevant to classification.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConnectorClassMetadata {
    #[serde(default)]
    pub always_active: bool,
    #[serde(default)]
    pub connection_mode: Option<String>,
    #[serde(default)]
    pub auth_type: Option<String>,
    #[serde(default)]
    pub requires_picker: Option<String>,
}

/// Classify a connector by name + its `metadata` JSON blob.
///
/// Order matters: the connector-specific registries (`GLOBAL_SINGLETON_*`,
/// `BOUND_CREDENTIAL_*`) are consulted first because they encode facts that
/// metadata cannot express (e.g. that `obsidian_memory`'s state is a settings
/// blob). Only then does the metadata-derived `ZeroConfig` check run — so a
/// connector mistakenly seeded `always_active: true` (as `codebase` was)
/// still classifies correctly.
pub fn classify_connector(name: &str, metadata_json: Option<&str>) -> ConnectorClass {
    let name_l = name.trim().to_ascii_lowercase();
    if GLOBAL_SINGLETON_CONNECTORS.contains(&name_l.as_str()) {
        return ConnectorClass::GlobalSingleton;
    }
    if BOUND_CREDENTIAL_CONNECTORS.contains(&name_l.as_str()) {
        return ConnectorClass::BoundCredential;
    }
    let meta: ConnectorClassMetadata = metadata_json
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_default();
    // Zero-config: a local service that is up from first launch and offers
    // nothing to pick. `requires_picker` rules out a connector that needs a
    // per-persona binding choice.
    if meta.always_active && meta.requires_picker.is_none() {
        return ConnectorClass::ZeroConfig;
    }
    // Credential-free local services seeded with auth_type "none" + a "local"
    // connection mode (`personas_messages`, `personas_vector_db`).
    let auth = meta.auth_type.as_deref().unwrap_or("");
    let mode = meta.connection_mode.as_deref().unwrap_or("");
    if auth == "none" && mode == "local" {
        return ConnectorClass::ZeroConfig;
    }
    ConnectorClass::Credential
}

#[cfg(test)]
mod classification_tests {
    use super::*;

    #[test]
    fn always_active_builtin_is_zero_config() {
        let meta = r#"{"is_builtin":true,"always_active":true}"#;
        assert_eq!(
            classify_connector("local_drive", Some(meta)),
            ConnectorClass::ZeroConfig
        );
    }

    #[test]
    fn local_mode_no_auth_is_zero_config() {
        let meta = r#"{"auth_type":"none","connection_mode":"local"}"#;
        assert_eq!(
            classify_connector("personas_messages", Some(meta)),
            ConnectorClass::ZeroConfig
        );
    }

    #[test]
    fn codebases_aggregate_is_zero_config() {
        // `codebases` (all-projects) is always_active and not in the bound
        // registry — the all-projects scope needs no per-persona binding.
        let meta = r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#;
        assert_eq!(
            classify_connector("codebases", Some(meta)),
            ConnectorClass::ZeroConfig
        );
    }

    #[test]
    fn codebase_is_bound_even_if_wrongly_always_active() {
        // `codebase` was historically mis-seeded `always_active:true`. The
        // bound registry is checked first, so it classifies correctly
        // regardless of the stale flag.
        let meta = r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#;
        assert_eq!(
            classify_connector("codebase", Some(meta)),
            ConnectorClass::BoundCredential
        );
    }

    #[test]
    fn twin_is_bound_credential() {
        let meta = r#"{"is_builtin":true,"connection_mode":"desktop_bridge","requires_picker":"twin"}"#;
        assert_eq!(
            classify_connector("twin", Some(meta)),
            ConnectorClass::BoundCredential
        );
    }

    #[test]
    fn obsidian_memory_is_global_singleton() {
        let meta = r#"{"is_builtin":true,"connection_mode":"desktop_bridge","requires_plugin":"obsidian-brain"}"#;
        assert_eq!(
            classify_connector("obsidian_memory", Some(meta)),
            ConnectorClass::GlobalSingleton
        );
    }

    #[test]
    fn api_connector_is_credential() {
        let meta = r#"{"auth_type":"api_key"}"#;
        assert_eq!(
            classify_connector("notion", Some(meta)),
            ConnectorClass::Credential
        );
    }

    #[test]
    fn missing_metadata_defaults_to_credential() {
        assert_eq!(
            classify_connector("some_unknown_connector", None),
            ConnectorClass::Credential
        );
    }

    #[test]
    fn name_match_is_case_insensitive() {
        assert_eq!(
            classify_connector("CodeBase", None),
            ConnectorClass::BoundCredential
        );
    }
}
