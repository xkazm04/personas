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
// `persona_credentials` — e.g. `codebase` (a Dev Tools project), `twin`
// (a Twin profile), or `obsidian_memory` (an Obsidian vault). Full
// rationale: `docs/architecture/connector-classification.md`.

/// Builtin connectors that are ready iff a backing local entity exists —
/// resolved globally at runtime (there is no per-persona binding, and the
/// connector seed declares no picker). `codebase` → a Dev Tools project,
/// `twin` → a Twin profile, `obsidian_memory` → an Obsidian vault. Each gets
/// a probe in `connector_readiness`. This registry encodes connector-specific
/// facts the `metadata` blob cannot express, so it is consulted before the
/// metadata-derived `ZeroConfig` rule.
pub const GLOBAL_PROBE_CONNECTORS: &[&str] = &["codebase", "twin", "obsidian_memory"];

/// How a connector's readiness is determined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorClass {
    /// Always ready — backed by a local service present from first launch
    /// (`local_drive`, `personas_database`, `codebases`, …). No setup gate.
    ZeroConfig,
    /// Needs a `persona_credentials` row (an API secret). API connectors,
    /// `mcp_gateway`.
    Credential,
    /// A builtin that is ready iff a backing local entity exists, resolved
    /// globally at runtime — `codebase`, `twin`, `obsidian_memory`. Readiness
    /// is a connector-specific probe (see `connector_readiness`).
    GlobalProbe,
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
}

/// Classify a connector by name + its `metadata` JSON blob.
///
/// `GLOBAL_PROBE_CONNECTORS` is consulted first: those connectors are seeded
/// `always_active` (the seed authors' "exposed automatically" intent) yet do
/// nothing useful until their backing entity exists, so they must NOT fall
/// through to `ZeroConfig`. Everything else is metadata-derived.
pub fn classify_connector(name: &str, metadata_json: Option<&str>) -> ConnectorClass {
    let name_l = name.trim().to_ascii_lowercase();
    if GLOBAL_PROBE_CONNECTORS.contains(&name_l.as_str()) {
        return ConnectorClass::GlobalProbe;
    }
    let meta: ConnectorClassMetadata = metadata_json
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_default();
    // Zero-config: a local service that is up from first launch.
    if meta.always_active {
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
        // `codebases` (all-projects) is always_active and NOT in the probe
        // registry — the all-projects aggregate works even with zero
        // projects, so it never gates a persona.
        let meta = r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#;
        assert_eq!(
            classify_connector("codebases", Some(meta)),
            ConnectorClass::ZeroConfig
        );
    }

    #[test]
    fn codebase_is_global_probe_despite_always_active() {
        // `codebase` is seeded `always_active:true`, but it does nothing
        // useful until a Dev Tools project exists — the probe registry is
        // checked first, so it classifies as GlobalProbe, not ZeroConfig.
        let meta = r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#;
        assert_eq!(
            classify_connector("codebase", Some(meta)),
            ConnectorClass::GlobalProbe
        );
    }

    #[test]
    fn twin_is_global_probe() {
        let meta = r#"{"is_builtin":true,"always_active":true,"connection_mode":"desktop_bridge"}"#;
        assert_eq!(
            classify_connector("twin", Some(meta)),
            ConnectorClass::GlobalProbe
        );
    }

    #[test]
    fn obsidian_memory_is_global_probe() {
        let meta = r#"{"is_builtin":true,"always_active":false,"connection_mode":"desktop_bridge"}"#;
        assert_eq!(
            classify_connector("obsidian_memory", Some(meta)),
            ConnectorClass::GlobalProbe
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
            ConnectorClass::GlobalProbe
        );
    }
}
